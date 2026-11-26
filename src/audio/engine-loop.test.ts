import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_SUSPEND_MS, ToyAudio } from "./audio";

type Param = { value: number; targets: [number, number, number][]; setTargetAtTime(v: number, t: number, tc: number): void };
const param = (value = 0): Param => ({
  value,
  targets: [],
  setTargetAtTime(v, t, tc) {
    this.targets.push([v, t, tc]);
  },
});
const node = () => {
  const n: Record<string, unknown> = { gain: param(), frequency: param(), pan: param(), connect: () => n, start() {}, stop() {} };
  return n;
};

class FakeContext {
  state = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = node();
  suspends = 0;
  sources: { buffer: unknown; loop: boolean; playbackRate: Param; started: number; stops: number[]; connect: () => unknown; start(): void; stop(t?: number): void }[] = [];
  oscillators = 0;
  suspend() {
    this.suspends++;
    this.state = "suspended";
    return Promise.resolve();
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 0.5 });
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(100) };
  }
  createGain = node;
  createDynamicsCompressor = node;
  createStereoPanner = node;
  createBiquadFilter = node;
  createOscillator = () => {
    this.oscillators++;
    return node();
  };
  createBufferSource() {
    const src = {
      buffer: null as unknown,
      loop: false,
      playbackRate: param(1),
      started: 0,
      stops: [] as number[],
      connect: () => gainNode,
      start() {
        src.started++;
      },
      stop(t = 0) {
        src.stops.push(t);
      },
    };
    const gainNode = node();
    this.sources.push(src);
    return src;
  }
}

describe("the recorded engine loop replaces the hum", () => {
  let audio: ToyAudio;
  let ctx: FakeContext;
  let doc: { hidden: boolean };

  /** The test seam: the bank's `get` answers with a loaded fake buffer for the engine loop (or none). */
  const loadLoop = (loaded: boolean) => {
    const bank = (audio as unknown as { clips: { get: (n: string) => unknown } }).clips;
    bank.get = (n: string) => (loaded && n === "engineLoop" ? { duration: 2 } : null);
  };
  const loops = () => ctx.sources.filter((s) => s.loop);

  beforeEach(() => {
    vi.useFakeTimers();
    doc = { hidden: false };
    const on = () => {};
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal("window", { addEventListener: (t: string, f: () => void) => (listeners[t] = f), AudioContext: class extends FakeContext {} });
    vi.stubGlobal("document", { get hidden() { return doc.hidden; }, addEventListener: on });
    vi.stubGlobal("fetch", async () => ({ ok: false }));
    audio = new ToyAudio();
    listeners.pointerdown();
    ctx = (audio as unknown as { ctx: FakeContext }).ctx;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("builds nothing for silence", () => {
    loadLoop(true);
    audio.setHum(0);
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.oscillators).toBe(0);
  });

  it("one looping source however often the level is set, rate and gain following the level", () => {
    loadLoop(true);
    audio.setHum(0.5);
    audio.setHum(0.5);
    expect(loops()).toHaveLength(1);
    expect(ctx.oscillators).toBe(0);
    const src = loops()[0];
    expect(src.started).toBe(1);
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(0.8 + 0.5 * 0.5);
    audio.setHum(1);
    expect(loops()).toHaveLength(1);
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(1.3);
    audio.setHum(7); // past 1 is clamped
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(1.3);
  });

  it("level 0 ramps it out and stops the source after, and the context sleeps", () => {
    loadLoop(true);
    audio.setHum(0.5);
    const src = loops()[0];
    audio.setHum(0);
    expect(src.stops).toHaveLength(1);
    expect(src.stops[0]).toBeGreaterThan(0.15 * 3);
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 2 + 1000);
    expect(ctx.state).toBe("suspended");
    audio.setHum(0); // nothing new
    expect(ctx.sources).toHaveLength(1);
    audio.setHum(0.4); // a fresh source
    expect(loops()).toHaveLength(2);
    expect(loops()[1].started).toBe(1);
  });

  it("stays awake while it plays", () => {
    loadLoop(true);
    audio.setHum(0.5);
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 5);
    expect(ctx.state).toBe("running");
  });

  it("muted: nothing built", () => {
    loadLoop(true);
    audio.muted = true;
    audio.setHum(0.8);
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.oscillators).toBe(0);
  });

  it("with no clip, the sawtooth hum is built", () => {
    loadLoop(false);
    audio.setHum(0.5);
    expect(loops()).toHaveLength(0);
    expect(ctx.oscillators).toBe(2);
  });

  it("a clip that arrives after the hum began takes over at the next level change, the hum fading out", () => {
    loadLoop(false);
    audio.setHum(0.5);
    const hum = (audio as unknown as { hum: unknown }).hum;
    expect(hum).not.toBeNull();
    loadLoop(true);
    audio.setHum(0.6);
    expect(loops()).toHaveLength(1);
    expect((audio as unknown as { hum: unknown }).hum).toBeNull();
  });
});

describe("playClip declines when it can't or shouldn't play", () => {
  it("false when the page is hidden or the rate isn't positive", () => {
    vi.useFakeTimers();
    const doc = { hidden: false };
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal("window", { addEventListener: (t: string, f: () => void) => (listeners[t] = f), AudioContext: class extends FakeContext {} });
    vi.stubGlobal("document", { get hidden() { return doc.hidden; }, addEventListener: () => {} });
    const audio = new ToyAudio();
    listeners.pointerdown();
    (audio as unknown as { clips: { get: () => unknown } }).clips.get = () => ({ duration: 0.5 });
    expect(audio.playClip("clack1", 0.5, 0)).toBe(true);
    expect(audio.playClip("clack1", 0.5, 0, 0)).toBe(false);
    expect(audio.playClip("clack1", 0.5, 0, -1)).toBe(false);
    doc.hidden = true;
    expect(audio.playClip("clack1", 0.5, 0)).toBe(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
