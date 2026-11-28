import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { engineSound, IDLE_SUSPEND_MS, ToyAudio } from "./audio";

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
    bank.get = (n: string) => (loaded && n === "engineSteam" ? { duration: 2 } : null);
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

  it("one looping source however often the level is set, gain following the level and rate following the pace", () => {
    loadLoop(true);
    audio.setHum(0.5, 0.5);
    audio.setHum(0.5, 0.5);
    expect(loops()).toHaveLength(1);
    expect(ctx.oscillators).toBe(0);
    const src = loops()[0];
    expect(src.started).toBe(1);
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(0.8 + 0.5 * 0.5);
    audio.setHum(1, 1);
    expect(loops()).toHaveLength(1);
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(1.3);
    audio.setHum(7, 9); // past 1 is clamped
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(1.3);
  });

  it("zooming (the level changes, the pace doesn't) leaves the rate alone; a speed change moves it; tiny pace changes are ignored", () => {
    loadLoop(true);
    audio.setHum(0.3, 0.5);
    const src = loops()[0];
    const rates = () => src.playbackRate.targets.length;
    audio.setHum(0.9, 0.5);
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(0.8 + 0.5 * 0.5);
    audio.setHum(0.9, 1);
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(1.3);
    const n = rates();
    audio.setHum(0.9, 1.004); // under 0.01 and the same level: a no-op
    expect(rates()).toBe(n);
    audio.setHum(0.9, 0.2);
    expect(src.playbackRate.targets.at(-1)![0]).toBeCloseTo(0.9);
  });

  it("muting while the loop plays stops it, zeroes the level and lets the context sleep", () => {
    loadLoop(true);
    audio.setHum(0.5, 0.5);
    const src = loops()[0];
    audio.setMuted(true);
    expect(src.stops).toHaveLength(1);
    expect((audio as unknown as { humLevel: Record<string, number> }).humLevel.steam).toBe(0);
    expect((audio as unknown as { loops: Record<string, unknown> }).loops.steam).toBeUndefined();
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 2 + 1000);
    expect(ctx.state).toBe("suspended");
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

describe("each kind of engine has its own loop", () => {
  let audio: ToyAudio;
  let ctx: FakeContext;
  const bank = (loaded: readonly string[]) => {
    (audio as unknown as { clips: { get: (n: string) => unknown } }).clips.get = (n: string) => (loaded.includes(n) ? { duration: 2, name: n } : null);
  };
  const loops = () => ctx.sources.filter((s) => s.loop);
  beforeEach(() => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal("window", { addEventListener: (t: string, f: () => void) => (listeners[t] = f), AudioContext: class extends FakeContext {} });
    vi.stubGlobal("document", { hidden: false, addEventListener: () => {} });
    vi.stubGlobal("fetch", async () => ({ ok: false }));
    audio = new ToyAudio();
    listeners.pointerdown();
    ctx = (audio as unknown as { ctx: FakeContext }).ctx;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("engines sound by their look: diesels diesel, electrics and metros electric, the rest steam", () => {
    expect(engineSound("diesel")).toBe("diesel");
    expect(engineSound("electric")).toBe("electric");
    expect(engineSound("metro")).toBe("electric");
    for (const look of ["classic", "tank", "express", "goods", "rack", "royal"] as const) expect(engineSound(look)).toBe("steam");
  });

  it("steam and diesel running together: two loops, each its own clip, each stopping alone", () => {
    bank(["engineSteam", "engineDiesel", "engineElectric"]);
    audio.setHum(0.5, 0.5, "steam");
    audio.setHum(0.3, 0.5, "diesel");
    audio.setHum(0, 0, "electric");
    expect(loops().map((s) => (s.buffer as { name: string }).name)).toEqual(["engineSteam", "engineDiesel"]);
    audio.setHum(0, 0, "diesel");
    expect(loops()[1].stops).toHaveLength(1);
    expect(loops()[0].stops).toHaveLength(0);
  });

  it("a kind whose clip hasn't loaded hums synthesised while another plays its loop; the hum goes when it stops", () => {
    bank(["engineSteam"]);
    audio.setHum(0.5, 0.5, "steam");
    audio.setHum(0.5, 0.5, "electric");
    expect(loops()).toHaveLength(1);
    expect((audio as unknown as { hum: unknown }).hum).not.toBeNull();
    audio.setHum(0, 0, "electric");
    expect((audio as unknown as { hum: unknown }).hum).toBeNull();
  });

  it("muting stops every kind's loop", () => {
    bank(["engineSteam", "engineDiesel", "engineElectric"]);
    for (const k of ["steam", "diesel", "electric"] as const) audio.setHum(0.4, 0.5, k);
    audio.setMuted(true);
    for (const s of loops()) expect(s.stops).toHaveLength(1);
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
    expect(audio.playClip("magnet", 0.5, 0)).toBe(true);
    expect(audio.playClip("magnet", 0.5, 0, 0)).toBe(false);
    expect(audio.playClip("magnet", 0.5, 0, -1)).toBe(false);
    doc.hidden = true;
    expect(audio.playClip("magnet", 0.5, 0)).toBe(false);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
