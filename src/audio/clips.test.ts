import { describe, expect, it, vi } from "vitest";
import { CLIP_FILES, ClipBank, type ClipName } from "./clips";

const NAMES = Object.keys(CLIP_FILES) as ClipName[];
const BUFFER = { duration: 1 } as unknown as AudioBuffer;
const flush = () => new Promise((r) => setTimeout(r, 0));

const okFetch = () => vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Response);
const ctxWith = (decode: () => Promise<AudioBuffer>) => ({ decodeAudioData: vi.fn(decode) }) as unknown as BaseAudioContext;

describe("the clip bank", () => {
  it("has a file for every clip, one .m4a each", () => {
    expect(NAMES).toContain("engineLoop");
    expect(new Set(Object.values(CLIP_FILES)).size).toBe(NAMES.length);
    for (const f of Object.values(CLIP_FILES)) expect(f).toMatch(/sounds\/[\w-]+\.m4a$/);
  });

  it("has nothing before load, and every clip decoded after", async () => {
    const bank = new ClipBank(okFetch());
    expect(bank.get("clack1")).toBeNull();
    bank.load(ctxWith(async () => BUFFER));
    expect(bank.get("clack1")).toBeNull(); // not yet resolved
    await flush();
    for (const n of NAMES) expect(bank.get(n)).toBe(BUFFER);
  });

  it("leaves a clip null for good on a 404, never retrying, never throwing", async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response);
    const bank = new ClipBank(fetchFn);
    const ctx = ctxWith(async () => BUFFER);
    bank.load(ctx);
    await flush();
    bank.load(ctx);
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(NAMES.length);
    expect(ctx.decodeAudioData).not.toHaveBeenCalled();
    for (const n of NAMES) expect(bank.get(n)).toBeNull();
  });

  it("leaves a clip null when fetch rejects or decoding fails", async () => {
    const down = new ClipBank(vi.fn(async () => { throw new Error("offline"); }));
    down.load(ctxWith(async () => BUFFER));
    const fetchFn = okFetch();
    const bad = new ClipBank(fetchFn);
    bad.load(ctxWith(async () => { throw new Error("bad data"); }));
    await flush();
    for (const n of NAMES) {
      expect(down.get(n)).toBeNull();
      expect(bad.get(n)).toBeNull();
    }
    expect(fetchFn).toHaveBeenCalledTimes(NAMES.length);
  });

  it("fetches once per clip however often load is called", async () => {
    const fetchFn = okFetch();
    const bank = new ClipBank(fetchFn);
    const ctx = ctxWith(async () => BUFFER);
    bank.load(ctx);
    bank.load(ctx);
    await flush();
    bank.load(ctx);
    expect(fetchFn).toHaveBeenCalledTimes(NAMES.length);
  });
});
