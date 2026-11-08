import { describe, expect, it } from "vitest";
import { describeRailway, KNOWN_KEY, KnownCodes, MAX_KNOWN, MAX_OFFERS, savedWhen, titleOffers, type CurrentCode, type KnownCode } from "./cloud-known";

class MemStore {
  readonly m = new Map<string, string>();
  full = false;
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.full) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
}

const A = "acorn-badge-otter-0420";
const B = "acorn-badge-otter-0421";
const C = "acorn-badge-otter-0422";

describe("remembered cloud codes", () => {
  it("keeps codes most recently used first, with what was last seen of each mode, across restarts", () => {
    const store = new MemStore();
    const k = new KnownCodes(store);
    k.used(A, 100);
    k.saw(A, "game", { savedAt: 90, saveVersion: 13, desc: "4 pieces" });
    k.used(B, 200);
    expect(k.list().map((x) => x.code)).toEqual([B, A]);
    const again = new KnownCodes(store);
    expect(again.list().map((x) => x.code)).toEqual([B, A]);
    expect(again.get(A)?.modes.game).toEqual({ savedAt: 90, saveVersion: 13, desc: "4 pieces" });
  });

  it("a sight without words keeps the words of the same copy, and drops them for a new one", () => {
    const k = new KnownCodes(new MemStore());
    k.used(A, 1);
    k.saw(A, "sandbox", { savedAt: 10, saveVersion: 13, desc: "3 pieces" });
    k.saw(A, "sandbox", { savedAt: 10, saveVersion: 13 });
    expect(k.get(A)?.modes.sandbox?.desc).toBe("3 pieces");
    k.saw(A, "sandbox", { savedAt: 20, saveVersion: 13 });
    expect(k.get(A)?.modes.sandbox).toEqual({ savedAt: 20, saveVersion: 13 });
    k.saw(A, "sandbox", null);
    expect(k.get(A)?.modes.sandbox).toBeUndefined();
    // (Of a code not used here: nothing.)
    k.saw(B, "sandbox", { savedAt: 1, saveVersion: 13 });
    expect(k.get(B)).toBeNull();
  });

  it(`remembers ${MAX_KNOWN} codes at most, forgets one or all, and reads junk as none`, () => {
    const store = new MemStore();
    const k = new KnownCodes(store);
    for (let i = 0; i < MAX_KNOWN + 2; i++) k.used(`acorn-badge-otter-${String(i).padStart(4, "0")}`, i);
    expect(k.list()).toHaveLength(MAX_KNOWN);
    expect(k.list()[0].code).toBe(`acorn-badge-otter-${String(MAX_KNOWN + 1).padStart(4, "0")}`);
    k.forget(k.list()[0].code);
    expect(k.list()).toHaveLength(MAX_KNOWN - 1);
    k.forgetAll();
    expect(new KnownCodes(store).list()).toEqual([]);
    store.setItem(KNOWN_KEY, "{not json");
    expect(new KnownCodes(store).list()).toEqual([]);
    store.setItem(KNOWN_KEY, JSON.stringify([{ code: "not a code", usedAt: 1, modes: {} }, { code: A, usedAt: 2, modes: { game: { savedAt: "x" } } }]));
    expect(new KnownCodes(store).list()).toEqual([{ code: A, usedAt: 2, modes: {} }]);
  });

  it("storage full: remembered till the page closes, no throw", () => {
    const store = new MemStore();
    store.full = true;
    const k = new KnownCodes(store);
    k.used(A, 1);
    expect(k.list()).toHaveLength(1);
  });
});

describe("the title's cloud offers", () => {
  const known = (code: string, usedAt: number, modes: KnownCode["modes"]): KnownCode => ({ code, usedAt, modes });
  const current = (code: string, sandbox: [number, boolean], game: [number, boolean]): CurrentCode => ({
    code,
    modes: { sandbox: { remoteSavedAt: sandbox[0], here: sandbox[1] }, game: { remoteSavedAt: game[0], here: game[1] } },
  });

  it("offers nothing when the code in use's copies are the ones this device has (Continue opens them)", () => {
    const list = [known(A, 5, { sandbox: { savedAt: 100, saveVersion: 13 }, game: { savedAt: 50, saveVersion: 13 } })];
    expect(titleOffers(list, current(A, [100, true], [50, true]), 13)).toEqual([]);
    expect(titleOffers([], null, 13)).toEqual([]);
  });

  it("offers the code in use's copy when it's newer than this device's, or this device has none of its own", () => {
    const list = [known(A, 5, { sandbox: { savedAt: 200, saveVersion: 13 }, game: { savedAt: 50, saveVersion: 13, desc: "8 pieces" } })];
    expect(titleOffers(list, current(A, [100, true], [50, false]), 13)).toEqual([
      { code: A, mode: "sandbox", savedAt: 200, current: true, newer: false },
      { code: A, mode: "game", savedAt: 50, desc: "8 pieces", current: true, newer: false },
    ]);
  });

  it("offers every mode's copy under a code used before, newest first, at most a few; a newer game's is marked", () => {
    const list = [
      known(A, 9, { sandbox: { savedAt: 10, saveVersion: 13 } }),
      known(B, 8, { sandbox: { savedAt: 40, saveVersion: 13 }, game: { savedAt: 30, saveVersion: 14 } }),
      known(C, 7, { game: { savedAt: 20, saveVersion: 13 }, sandbox: { savedAt: 5, saveVersion: 13 } }),
    ];
    const offers = titleOffers(list, null, 13);
    expect(offers.map((o) => [o.code, o.mode, o.newer])).toEqual([
      [B, "sandbox", false],
      [B, "game", true],
      [C, "game", false],
    ]);
    expect(offers).toHaveLength(MAX_OFFERS);
  });
});

describe("cloud copy words", () => {
  it("says when, briefly", () => {
    const now = new Date(2026, 10, 7, 15, 0).getTime();
    expect(savedWhen(now - 10_000, now)).toBe("just now");
    expect(savedWhen(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(savedWhen(now - 3 * 3600_000, now)).toMatch(/^today at /);
    expect(savedWhen(new Date(2026, 10, 3, 9).getTime(), now)).toMatch(/3/);
  });

  it("counts a save's pieces", () => {
    expect(describeRailway('{"version":13,"pieces":[{"id":1},{"id":2}]}')).toBe("2 pieces");
    expect(describeRailway('{"pieces":[{}]}')).toBe("1 piece");
    expect(describeRailway("not json")).toBeUndefined();
    expect(describeRailway(null)).toBeUndefined();
  });
});
