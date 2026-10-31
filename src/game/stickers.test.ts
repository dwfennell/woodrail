import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef } from "../track";
import { buildStarterWorld, type World } from "./world";
import { ownTrack, STICKERS, StickerTracker, TRACK_LAYER, type StickerContext } from "./stickers";
import mainSrc from "../main.ts?raw";
import saveSrc from "../persist/save.ts?raw";
import { gameMerger } from "../persist/progress-merge";

const ctx = (over: Partial<StickerContext> = {}): StickerContext => ({ coins: 0, counts: new Map(), learned: new Set(), goalsDone: () => false, ...over });

/** Lay `n` straights out of the first town's station, as the player lays track. */
function lay(w: World, n: number): void {
  let last = w.stations.get(w.landscape.towns[0].id)!;
  for (let i = 0; i < n; i++) last = appendPiece(w.layout, "straight-54", false, connectorRef(last, 1));
}

describe("the stickers table", () => {
  it("has unique ids, a title, a how, an icon and deps for each; the hidden ones (a few) each have a hint", () => {
    const ids = STICKERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STICKERS) {
      expect(s.title && s.how && s.icon, s.id).toBeTruthy();
      expect(s.deps.length, s.id).toBeGreaterThan(0);
      if (s.hidden) expect(s.hint, s.id).toBeTruthy();
    }
    const hidden = STICKERS.filter((s) => s.hidden).length;
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThan(STICKERS.length / 3);
  });
});

describe("StickerTracker", () => {
  it("earns Track layer once enough track is laid, and keeps it", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    lay(w, TRACK_LAYER - 1);
    expect(ownTrack(w)).toBe(TRACK_LAYER - 1);
    expect(t.update(w, ctx(), 0)).toEqual([]);
    lay(w, 1);
    expect(t.update(w, ctx(), 0).map((s) => s.id)).toEqual(["track-layer"]);
    expect(t.has("track-layer")).toBe(true);
    // (Earned stays earned, the track taken up again.)
    for (const id of [...w.layout.pieceIds()]) if (w.layout.getPiece(id)!.type === "straight-54") w.layout.removePiece(id);
    expect(t.update(w, ctx(), 0)).toEqual([]);
    expect(t.ids()).toEqual(["track-layer"]);
  });

  it("reads the progress: coins, loads moved, blueprints, goals", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    expect(t.update(w, ctx({ coins: 999 }), 0)).toEqual([]);
    expect(t.update(w, ctx({ coins: 1000 }), 0).map((s) => s.id)).toEqual(["rich"]);
    expect(t.update(w, ctx({ counts: new Map([["loadsMoved", 500]]) }), 0).map((s) => s.id)).toEqual(["busy-loads"]);
    expect(t.update(w, ctx({ learned: new Set(Array.from({ length: 25 }, (_, i) => `b${i}`)) }), 0).map((s) => s.id)).toEqual(["scholar"]);
    expect(t.update(w, ctx({ goalsDone: (id) => id === "join-all" }), 22).map((s) => s.id)).toEqual(["all-towns"]);
  });

  it("checks a sticker only when what it reads has changed, and none once earned", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    const calls = new Map<string, number>();
    const spied = STICKERS.map((s) => [s, s.check] as const);
    for (const [s, check] of spied)
      (s as { check: typeof check }).check = (...a) => {
        calls.set(s.id, (calls.get(s.id) ?? 0) + 1);
        return check(...a);
      };
    try {
      const c = ctx();
      t.update(w, c, 0);
      expect(calls.size, "the first check reads everything").toBe(STICKERS.length);
      calls.clear();
      t.update(w, c, 0);
      expect([...calls.keys()], "nothing changed: nothing checked").toEqual([]);
      lay(w, 1);
      t.update(w, c, 0);
      expect([...calls.keys()], "the track changed").toEqual(["track-layer"]);
      calls.clear();
      t.update(w, ctx({ coins: 5 }), 0);
      expect([...calls.keys()]).toEqual(["rich"]);
      calls.clear();
      t.update(w, ctx({ coins: 1000 }), 0);
      t.update(w, ctx({ coins: 2000 }), 0);
      expect(calls.get("rich"), "earned: not checked again").toBe(1);
      // A new world (a load): everything once more.
      calls.clear();
      t.update(buildStarterWorld(), ctx({ coins: 2000 }), 0);
      expect(calls.size).toBe(STICKERS.length - 1);
    } finally {
      for (const [s, check] of spied) (s as { check: typeof check }).check = check;
    }
  });

  it("earns at most `max` a check; the rest wait for the next, even with nothing changed", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    const c = ctx({ coins: 1000, counts: new Map([["loadsMoved", 600]]) });
    expect(t.update(w, c, 0, 1).map((s) => s.id)).toEqual(["rich"]);
    expect(t.update(w, c, 0, 1).map((s) => s.id)).toEqual(["busy-loads"]);
    expect(t.update(w, c, 0, 1)).toEqual([]);
    // (Quiet, as on a load: all at once.)
    const u = new StickerTracker();
    expect(u.update(w, c, 0).length).toBe(2);
  });

  it("forgets ids it doesn't know (an old or newer save)", () => {
    const t = new StickerTracker(["rich", "no-such-sticker"]);
    expect(t.ids()).toEqual(["rich"]);
    expect(t.count).toBe(1);
  });
});

describe("saves and the cloud", () => {
  it("are saved under their own key, a progress key the cloud merges as a union (earned on either side stays earned)", () => {
    expect(saveSrc).toMatch(/STICKERS_KEY = "woodrail\.game\.stickers\.v1"/);
    expect(saveSrc).toMatch(/PROGRESS_KEYS = \{[^}]*stickers: STICKERS_KEY/);
    const m = gameMerger({ progress: "p", goals: "g", stickers: "s" });
    expect(m.keys.game).toContain("s");
    const out = m.merge("game", {}, { s: JSON.stringify(["rich"]) }, { s: JSON.stringify(["scholar", "rich"]) }, "local");
    expect(JSON.parse(out.s!)).toEqual(["rich", "scholar"]);
  });

  it("are checked in the goals' pass (checkGoals), not per frame", () => {
    const fn = mainSrc.slice(mainSrc.indexOf("function checkGoals("), mainSrc.indexOf("function checkGoals(") + 4000);
    expect(fn).toMatch(/checkStickers\(\)/);
    expect(mainSrc.match(/stickers\.update\(/g)?.length).toBe(1);
  });
});
