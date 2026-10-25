import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COIN_GAP_MS, CUE_GAP_MS, IDLE_SUSPEND_MS, MAX_VOICES, ToyAudio } from "./audio";

/** Any node or param the synth asks for: every method returns another such stub (connect() chains). */
const stub = (): unknown =>
  new Proxy(function () {}, {
    get: (_t, k) => (k === "then" ? undefined : stub()),
    set: () => true,
    apply: () => stub(),
  });

class FakeContext {
  state: string = "running";
  currentTime = 0;
  sampleRate = 8000;
  destination = stub();
  suspends = 0;
  resumes = 0;
  suspend() {
    this.suspends++;
    this.state = "suspended";
    return Promise.resolve();
  }
  resume() {
    this.resumes++;
    this.state = "running";
    return Promise.resolve();
  }
  createBuffer() {
    return { getChannelData: (_: number) => new Float32Array(100) };
  }
}
/** Each oscillator made: its `onended`, to end it by hand. */
let oscillators: { onended?: () => void }[] = [];
(FakeContext.prototype as unknown as Record<string, unknown>).createOscillator = () => {
  const ends: { onended?: () => void } = {};
  oscillators.push(ends);
  return new Proxy(ends, {
    get: (t, k) => (k === "onended" ? t.onended : k === "then" ? undefined : stub()),
    set: (t, k, v) => {
      if (k === "onended") t.onended = v;
      return true;
    },
  });
};
for (const m of ["createGain", "createDynamicsCompressor", "createStereoPanner", "createBufferSource", "createBiquadFilter"])
  (FakeContext.prototype as unknown as Record<string, unknown>)[m] = () => stub();

describe("the audio context sleeps when nothing's heard (and wakes for the next sound)", () => {
  let listeners: Record<string, () => void>;
  let doc: { hidden: boolean };
  let ctx: FakeContext;
  let audio: ToyAudio;

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = {};
    oscillators = [];
    doc = { hidden: false };
    const on = (type: string, f: () => void) => (listeners[type] = f);
    vi.stubGlobal("window", { addEventListener: on, AudioContext: class extends FakeContext {} });
    vi.stubGlobal("document", { get hidden() { return doc.hidden; }, addEventListener: on });
    audio = new ToyAudio();
    listeners.pointerdown(); // the first gesture starts it
    ctx = (audio as unknown as { ctx: FakeContext }).ctx;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("suspends a while after the last sound, not before", () => {
    audio.tap();
    vi.advanceTimersByTime(IDLE_SUSPEND_MS - 100);
    expect(ctx.state).toBe("running");
    audio.tap(); // a later sound keeps it awake from then
    vi.advanceTimersByTime(IDLE_SUSPEND_MS - 100);
    expect(ctx.state).toBe("running");
    vi.advanceTimersByTime(500);
    expect(ctx.state).toBe("suspended");
    expect(ctx.suspends).toBe(1);
  });

  it("started by a gesture with no sound after it, it sleeps too", () => {
    vi.advanceTimersByTime(IDLE_SUSPEND_MS + 400);
    expect(ctx.state).toBe("suspended");
  });

  it("the next sound wakes it", () => {
    audio.tap();
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 2);
    expect(ctx.state).toBe("suspended");
    audio.clack(0.5, 0);
    expect(ctx.state).toBe("running");
  });

  it("stays awake while a motor hums, and sleeps once it's quiet", () => {
    audio.setHum(0.5);
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 5);
    expect(ctx.state).toBe("running");
    audio.setHum(0);
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 2 + 1000);
    expect(ctx.state).toBe("suspended");
  });

  it("a hum level that's already set (as every frame sets it) doesn't wake a sleeping context", () => {
    audio.setHum(0);
    vi.advanceTimersByTime(IDLE_SUSPEND_MS * 2);
    audio.setHum(0);
    expect(ctx.resumes).toBe(0);
  });

  it("sleeps at once when the page is hidden or the sound is muted; plays nothing while hidden", () => {
    audio.tap();
    doc.hidden = true;
    listeners.visibilitychange();
    expect(ctx.state).toBe("suspended");
    audio.tap();
    expect(ctx.state).toBe("suspended");
    doc.hidden = false;
    audio.tap();
    expect(ctx.state).toBe("running");
    audio.setMuted(true);
    expect(ctx.state).toBe("suspended");
    audio.tap();
    expect(ctx.state).toBe("suspended");
  });

  it("a burst of deliveries clinks once; the next after the gap clinks again", () => {
    expect(audio.coins(0.6, 0)).toBe(true);
    expect(audio.coins(0.6, 0)).toBe(false);
    vi.advanceTimersByTime(COIN_GAP_MS - 50);
    expect(audio.coins(0.6, 0)).toBe(false);
    vi.advanceTimersByTime(100);
    expect(audio.coins(0.6, 0)).toBe(true);
  });

  it("a burst of milestones plays one tune, unless a bigger one comes; after the gap, any", () => {
    expect(audio.cue("grew")).toBe(true);
    expect(audio.cue("goal")).toBe(false); // (the goal its growth ticked)
    expect(audio.cue("learned")).toBe(false); // (as big: not twice)
    expect(audio.cue("land")).toBe(true); // (bigger news)
    vi.advanceTimersByTime(CUE_GAP_MS + 10);
    expect(audio.cue("goal")).toBe(true);
  });

  it("a pile-up of sounds is held to MAX_VOICES; one ending makes room", () => {
    for (let i = 0; i < MAX_VOICES + 10; i++) audio.tap();
    const started = oscillators.filter((o) => o.onended).length;
    expect(started).toBe(MAX_VOICES);
    oscillators.find((o) => o.onended)!.onended!();
    audio.tap();
    expect(oscillators.filter((o) => o.onended).length).toBe(MAX_VOICES + 1);
    // Tunes aren't held back by it.
    expect(audio.cue("land")).toBe(true);
  });

  it("the volume scales the master level, and mute still silences it", () => {
    const master = { gain: { value: -1 } };
    (audio as unknown as { master: unknown }).master = master;
    audio.setVolume(0.5);
    expect(master.gain.value).toBeCloseTo(0.4);
    audio.setMuted(true);
    expect(master.gain.value).toBe(0);
    audio.setVolume(0.25);
    expect(master.gain.value).toBe(0);
    audio.setMuted(false);
    expect(master.gain.value).toBeCloseTo(0.2);
  });

  it("a tap starts it again if the system stopped it (iOS: interrupted by a call)", () => {
    ctx.state = "interrupted";
    listeners.pointerdown();
    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe("running");
  });
});
