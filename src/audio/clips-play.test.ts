import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUARD_WHISTLE_GAP_MS, ToyAudio } from "./audio";

type Param = Record<string, any>;
const param = (value = 0): Param => ({
  value,
  targets: [],
  setTargetAtTime(v: number, t: number, tc: number) {
    this.targets.push([v, t, tc]);
  },
  setValueAtTime() {},
  linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {},
});

class FakeContext {
  state = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = this.node();
  gains: ReturnType<FakeContext["node"]>[] = [];
  oscillators = 0;
  sources: { buffer: unknown; starts: unknown[][] }[] = [];
  node() {
    const n: Record<string, unknown> = { gain: param(), frequency: param(), pan: param(), Q: param(), connect: () => n, start() {}, stop() {} };
    return n as { gain: Param } & Record<string, unknown>;
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createBuffer() {
    return { getChannelData: () => new Float32Array(100) };
  }
  createGain = () => {
    const n = this.node();
    this.gains.push(n);
    return n;
  };
  createDynamicsCompressor = () => this.node();
  createStereoPanner = () => this.node();
  createBiquadFilter = () => this.node();
  createOscillator = () => {
    this.oscillators++;
    return this.node();
  };
  createBufferSource() {
    const n = this.node();
    const src = { ...n, buffer: null as unknown, starts: [] as unknown[][], playbackRate: param(1), start: (...a: unknown[]) => void src.starts.push(a) };
    this.sources.push(src);
    return src;
  }
}

describe("one-shots play recorded clips, and synthesise without them", () => {
  let audio: ToyAudio;
  let ctx: FakeContext;

  const load = (duration = 0.3) => {
    (audio as unknown as { clips: { get: () => unknown } }).clips.get = () => ({ duration });
  };
  const played = () => ctx.sources.length;

  beforeEach(() => {
    vi.useFakeTimers();
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal("window", { addEventListener: (t: string, f: () => void) => (listeners[t] = f), AudioContext: class extends FakeContext {} });
    vi.stubGlobal("document", { hidden: false, addEventListener: () => {} });
    vi.stubGlobal("fetch", async () => ({ ok: false }));
    audio = new ToyAudio();
    listeners.pointerdown();
    ctx = (audio as unknown as { ctx: FakeContext }).ctx;
    vi.advanceTimersByTime(1000);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const once: [string, () => unknown][] = [
    ["magnet", () => audio.magnet(1, 0)],
    ["bump", () => audio.bump(1, 0)],
    ["crash", () => audio.crash(1, 0)],
    ["clunk", () => audio.clunk(1, 0)],
    ["switchClunk", () => audio.switchClunk(1, 0)],
    ["liftClunk", () => audio.liftClunk(1, 0)],
    ["whistle", () => audio.whistle(1, 0)],
    ["guardWhistle", () => audio.guardWhistle(1, 0)],
    ["bell", () => audio.bell()],
    ["crossingBell", () => audio.crossingBell(1, 0)],
  ];

  for (const [name, call] of once) {
    it(`${name}: one clip and no synthesis when loaded`, () => {
      load();
      call();
      vi.advanceTimersByTime(1000);
      expect(played()).toBe(1);
      expect(ctx.oscillators).toBe(0);
    });
    it(`${name}: synthesised when no clip is loaded`, () => {
      call();
      vi.advanceTimersByTime(1000);
      // (a knock makes a noise source and an oscillator; the others, oscillators)
      expect(ctx.oscillators + played()).toBeGreaterThan(0);
      expect(ctx.oscillators).toBeGreaterThan(0);
    });
  }

  it("bump keeps its 450 ms gap", () => {
    load();
    audio.bump(1, 0);
    vi.advanceTimersByTime(200);
    audio.bump(1, 0);
    expect(played()).toBe(1);
  });

  it("guardWhistle keeps its gap", () => {
    load();
    expect(audio.guardWhistle(1, 0)).toBe(true);
    expect(audio.guardWhistle(1, 0)).toBe(false);
    vi.advanceTimersByTime(GUARD_WHISTLE_GAP_MS + 1);
    expect(audio.guardWhistle(1, 0)).toBe(true);
    expect(played()).toBe(2);
  });

  it("whistle: a quieter one within 0.6 s is dropped, a clearly louder one replaces it and fades the first clip", () => {
    load();
    expect(audio.whistle(0.5, 0)).toBe(true);
    const first = ctx.gains.at(-1)!;
    vi.advanceTimersByTime(100);
    expect(audio.whistle(0.6, 0)).toBe(false);
    expect(audio.whistle(0.9, 0)).toBe(true);
    expect(played()).toBe(2);
    expect(first.gain.targets.at(-1)![0]).toBe(0);
  });

  it("muted, nothing plays and nothing synthesises", () => {
    load();
    audio.setMuted(true);
    for (const [, call] of once) call();
    expect(played()).toBe(0);
    expect(ctx.oscillators).toBe(0);
  });
});
