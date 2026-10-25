import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDLE_SUSPEND_MS, ToyAudio } from "./audio";

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
for (const m of ["createGain", "createDynamicsCompressor", "createStereoPanner", "createBufferSource", "createBiquadFilter", "createOscillator"])
  (FakeContext.prototype as unknown as Record<string, unknown>)[m] = () => stub();

describe("the audio context sleeps when nothing's heard (and wakes for the next sound)", () => {
  let listeners: Record<string, () => void>;
  let doc: { hidden: boolean };
  let ctx: FakeContext;
  let audio: ToyAudio;

  beforeEach(() => {
    vi.useFakeTimers();
    listeners = {};
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

  it("a tap starts it again if the system stopped it (iOS: interrupted by a call)", () => {
    ctx.state = "interrupted";
    listeners.pointerdown();
    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe("running");
  });
});
