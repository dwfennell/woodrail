import { describe, expect, it, vi } from "vitest";
import { AVAILABLE_CLIPS, CLIP_FILES, ClipBank, type ClipName } from "./clips";

const NAMES = Object.keys(CLIP_FILES) as ClipName[];
/** The clips a bank under test fetches. */
const SOME: readonly ClipName[] = ["magnet", "engineSteam", "whistle"];
const BUFFER = { duration: 1 } as unknown as AudioBuffer;
const flush = () => new Promise((r) => setTimeout(r, 0));

const okFetch = () => vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Response);
const ctxWith = (decode: () => Promise<AudioBuffer>) => ({ decodeAudioData: vi.fn(decode) }) as unknown as BaseAudioContext;

describe("the clip bank", () => {
  it("has a file for every clip: .m4a for one-shots, .wav for the engine loops (no gap at the seam)", () => {
    expect(NAMES).toContain("engineSteam");
    expect(new Set(Object.values(CLIP_FILES)).size).toBe(NAMES.length);
    for (const [name, f] of Object.entries(CLIP_FILES)) expect(f).toMatch(name.startsWith("engine") ? /sounds\/[\w-]+\.wav$/ : /sounds\/[\w-]+\.m4a$/);
  });

  it("every clip it fetches is in public/sounds", () => {
    const files = new Set(Object.keys(import.meta.glob("../../public/sounds/*")).map((f) => f.split("/").pop()));
    for (const n of AVAILABLE_CLIPS) expect(files, n).toContain(CLIP_FILES[n].split("/").pop());
  });

  it("has nothing before load, and every clip decoded after", async () => {
    const bank = new ClipBank(okFetch(), SOME);
    expect(bank.get("magnet")).toBeNull();
    bank.load(ctxWith(async () => BUFFER));
    expect(bank.get("magnet")).toBeNull(); // not yet resolved
    await flush();
    for (const n of SOME) expect(bank.get(n)).toBe(BUFFER);
    expect(bank.get("crash")).toBeNull(); // not in the list: never fetched
  });

  it("leaves a clip null for good on a 404, never retrying, never throwing", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response);
    const bank = new ClipBank(fetchFn, SOME);
    const ctx = ctxWith(async () => BUFFER);
    bank.load(ctx);
    await flush();
    bank.load(ctx);
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(SOME.length);
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    for (const n of NAMES) expect(bank.get(n)).toBeNull();
  });

  it("leaves a clip null when fetch rejects or decoding fails", async () => {
    const down = new ClipBank(vi.fn(async () => { throw new Error("offline"); }), SOME);
    down.load(ctxWith(async () => BUFFER));
    const fetchFn = okFetch();
    const bad = new ClipBank(fetchFn, SOME);
    bad.load(ctxWith(async () => { throw new Error("bad data"); }));
    await flush();
    for (const n of NAMES) {
      expect(down.get(n)).toBeNull();
      expect(bad.get(n)).toBeNull();
    }
    expect(fetchFn).toHaveBeenCalledTimes(SOME.length);
  });

  it("fetches once per clip however often load is called", async () => {
    const fetchFn = okFetch();
    const bank = new ClipBank(fetchFn, SOME);
    const ctx = ctxWith(async () => BUFFER);
    bank.load(ctx);
    bank.load(ctx);
    await flush();
    bank.load(ctx);
    expect(fetchFn).toHaveBeenCalledTimes(SOME.length);
  });

  it("the real bank fetches only the available clips (no 404s for a real player)", async () => {
    const fetchFn = okFetch();
    new ClipBank(fetchFn).load(ctxWith(async () => BUFFER));
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(AVAILABLE_CLIPS.length);
    for (const n of AVAILABLE_CLIPS) expect(NAMES).toContain(n);
  });
});
