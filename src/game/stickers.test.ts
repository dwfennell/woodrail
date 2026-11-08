import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, type PieceTypeId } from "../track";
import { buildStarterWorld, type World } from "./world";
import { BUSY_TRAINS, DELIVERED_LOTS, DELIVERED_SOME, deliveredTotal, INDUSTRY_KINDS, industryKinds, joinedTowns, LONG_LINE, TOWN_TIERS, ownTrack, RUSH_HOUR, SEA_TRADER, STICKERS, StickerTracker, TRACK_LAYER, TWO_STARS, townLevels, type StickerContext } from "./stickers";
import { BLUEPRINTS } from "./blueprints";
import { THING_RULES } from "./things";
import { CARGO } from "../economy";
import { HarbourTrade, type HarbourEvent } from "./harbours";
import { coastWorld, harbourSite } from "./harbours-testing";
import { Progress } from "./progress";
import { syncIndustries } from "./world";
import harboursSrc from "./harbours.ts?raw";
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
  });

  it("Connected 5, 8 and 12 towns, then Every town: towns joined in one network, as the player's track joins them", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    // (A row of stations end to end, far off the start, as `n` towns: each joined to the next as track is, by its
    // joints. The map's towns are these, so Every town asks for all of them.)
    const stations = new Map<number, number>();
    const towns = [] as World["landscape"]["towns"];
    let last = -1;
    const like = w.landscape.towns[0];
    const add = () => {
      const i = towns.length;
      const id = last === -1 ? w.layout.addPiece("station", { x: 0, z: 6000, heading: 0 }) : appendPiece(w.layout, "station", false, connectorRef(last, 1));
      last = id;
      stations.set(100 + i, id);
      towns.push({ ...like, id: 100 + i, name: `Town ${i}` });
    };
    for (const [id, piece] of [...w.stations]) {
      w.stations.delete(id);
      w.layout.removePiece(piece);
    }
    w.landscape.towns = towns;
    const sync = () => {
      for (const [id, piece] of stations) w.stations.set(id, piece);
    };
    for (let i = 0; i < 4; i++) add();
    sync();
    expect(joinedTowns(w)).toBe(4);
    // Four towns, all joined: not five, and Every town waits for a map of five or more.
    expect(t.update(w, ctx(), 0).map((s) => s.id)).toEqual([]);
    add();
    sync();
    expect(t.update(w, ctx(), 0).map((s) => s.id)).toEqual(["towns-5", "all-towns"]);
    for (let i = 0; i < 2; i++) add();
    sync();
    expect(t.update(w, ctx(), 0).map((s) => s.id)).toEqual([]);
    add();
    sync();
    expect(t.update(w, ctx(), 0).map((s) => s.id)).toEqual(["towns-8"]);
    for (let i = 0; i < 4; i++) add();
    sync();
    expect(joinedTowns(w)).toBe(12);
    expect(t.update(w, ctx(), 0).map((s) => s.id)).toEqual(["towns-12"]);
    expect(TOWN_TIERS).toEqual([5, 8, 12]);
  });

  it("Every town: never from the old goal alone", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    // (The goal "Connect every town" is gone: a save that holds it earns nothing by it.)
    expect(t.update(w, ctx({ goalsDone: (id) => id === "join-all" }), 24).map((s) => s.id)).toEqual([]);
  });

  it("the town stickers' icons are the game's own (its icon font draws them), not emoji", () => {
    const drawn = Object.keys(import.meta.glob("../icons/*.svg")).map((f) => parseInt(/\/u([0-9A-F]+)-/i.exec(f)![1], 16));
    for (const id of [...TOWN_TIERS.map((n) => `towns-${n}`), "all-towns"]) {
      const s = STICKERS.find((x) => x.id === id)!;
      expect(drawn, id).toContain(s.icon.codePointAt(0));
    }
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
      expect([...calls.keys()], "the track changed").toEqual(STICKERS.filter((s) => s.deps.includes("pieces")).map((s) => s.id));
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

describe("harbour stickers: Ahoy, seller! and Ahoy, buyer!", () => {
  /** A harbour on the coast plot, its boats, and the progress the checks read (as `checkStickers` passes it). */
  function harbour() {
    const w = coastWorld();
    const id = w.layout.addPiece("depot-harbour", harbourSite(w));
    syncIndustries(w);
    const d = w.economy.depotAtPiece(id)!;
    const p = Progress.fresh();
    const trade = new HarbourTrade();
    const c = () => ctx({ coins: p.coins, counts: p.counts });
    /** Seconds of play till a boat event of this kind (once a second, as `main.ts` runs them). */
    const until = (kind: HarbourEvent["kind"]) => {
      for (let t = 0; t < 400; t++) if (trade.update(w, p).some((e) => e.kind === kind)) return;
      throw new Error(`no ${kind}`);
    };
    return { w, d, p, trade, c, until };
  }

  it("a boat taking goods left on the quay earns Ahoy, seller! (and not the buyer's)", () => {
    const { w, d, c, until } = harbour();
    const t = new StickerTracker();
    t.update(w, c(), 0);
    expect(t.has("harbour-seller")).toBe(false);
    d.piles[CARGO.planks.index] = 4;
    until("sold");
    expect(t.update(w, c(), 0).map((s) => s.id)).toEqual(["harbour-seller"]);
    expect(t.has("harbour-buyer")).toBe(false);
  });

  it("goods ordered from the harbour's card and landed by a boat earn Ahoy, buyer!", () => {
    const { w, d, p, trade, c, until } = harbour();
    const t = new StickerTracker();
    p.coins = 100;
    t.update(w, c(), 0);
    expect(trade.order(d.id, "planks")).toBe(true);
    until("bought");
    expect(p.counts.get("imported")).toBe(3);
    // (The coins went down too: Piggy bank isn't near, and nothing was sold.)
    expect(t.update(w, c(), 0).map((s) => s.id)).toEqual(["harbour-buyer"]);
  });

  it("an order that all went back (no coins) buys nothing: no sticker", () => {
    const { w, d, p, trade, c, until } = harbour();
    const t = new StickerTracker();
    p.coins = 0;
    trade.order(d.id, "planks");
    until("bought");
    expect(p.counts.get("imported") ?? 0).toBe(0);
    expect(t.update(w, c(), 0).some((s) => s.id === "harbour-buyer")).toBe(false);
  });

  it("Sea trader (hidden) wants a hundred goods traded by sea, sold and bought together", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    const sea = (exported: number, imported: number) => ctx({ counts: new Map([["exported", exported], ["imported", imported]]) });
    expect(t.update(w, sea(SEA_TRADER - 31, 30), 0).map((s) => s.id)).toEqual(["harbour-seller", "harbour-buyer"]);
    expect(t.update(w, sea(SEA_TRADER - 30, 30), 0).map((s) => s.id)).toEqual(["sea-trader"]);
    expect(STICKERS.find((s) => s.id === "sea-trader")!.hidden).toBe(true);
  });

  it("are checked only when a boat trades (the sea counts change), not on other counts or coins", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    const calls: string[] = [];
    const sea = STICKERS.filter((s) => s.deps.includes("sea"));
    expect(sea.map((s) => s.id).sort()).toEqual(["harbour-buyer", "harbour-seller", "sea-trader"]);
    const spied = sea.map((s) => [s, s.check] as const);
    for (const [s, check] of spied)
      (s as { check: typeof check }).check = (...a) => {
        calls.push(s.id);
        return check(...a);
      };
    try {
      const counts = new Map([["loadsMoved", 3]]);
      t.update(w, ctx({ counts }), 0);
      calls.length = 0;
      counts.set("loadsMoved", 4);
      t.update(w, ctx({ counts, coins: 7 }), 0);
      expect(calls, "loads moved and coins: not a boat's trade").toEqual([]);
      counts.set("exported", 2);
      t.update(w, ctx({ counts, coins: 7 }), 0);
      expect(calls.sort()).toEqual(["harbour-buyer", "harbour-seller", "sea-trader"]);
    } finally {
      for (const [s, check] of spied) (s as { check: typeof check }).check = check;
    }
  });

  it("the counts are kept by the boats' trades only (HarbourTrade), as the player's sold and bought goods", () => {
    expect(harboursSrc.match(/counts\.set\("exported"/g)?.length).toBe(1);
    expect(harboursSrc.match(/counts\.set\("imported"/g)?.length).toBe(1);
  });
});

describe("milestone stickers", () => {
  const earn = (t: StickerTracker, w: World, c = ctx()) => t.update(w, c, 0).map((s) => s.id);

  it("Long line: 200 pieces of track, a tier above Track layer", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    lay(w, LONG_LINE - 1);
    expect(earn(t, w)).toEqual(["track-layer"]);
    lay(w, 1);
    expect(earn(t, w)).toEqual(["long-line"]);
  });

  it("Special delivery and Big deliveries: goods the towns have received, every kind (planks as the old saves keep them)", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    const [a, b] = w.landscape.towns;
    // (Setup: the economy's totals, as deliveries leave them; the play-through earns these by running trains.)
    w.economy.delivered.set(a.id, DELIVERED_SOME - 10);
    w.economy.deliveredGoods.set(a.id, { planks: DELIVERED_SOME - 10, flour: 9 });
    expect(deliveredTotal(w)).toBe(DELIVERED_SOME - 1);
    expect(earn(t, w).filter((id) => id.startsWith("delivered"))).toEqual([]);
    w.economy.deliveredGoods.set(b.id, { stone: 1 });
    expect(earn(t, w).filter((id) => id.startsWith("delivered"))).toEqual(["delivered-some"]);
    w.economy.deliveredGoods.set(b.id, { stone: DELIVERED_LOTS - DELIVERED_SOME + 1 });
    expect(earn(t, w).filter((id) => id.startsWith("delivered"))).toEqual(["delivered-lots"]);
  });

  it("City ★★: a town two stars past a city", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    const town = w.landscape.towns[0];
    const lots = (n: number) => ({ planks: n, flour: n, stone: n, iron: n, furniture: n, tools: n });
    const give = (n: number) => {
      w.economy.delivered.set(town.id, n);
      w.economy.deliveredGoods.set(town.id, lots(n));
      return townLevels(w)[0];
    };
    let n = 0;
    while (give(n) < TWO_STARS - 1) n += 5;
    expect(earn(t, w)).toContain("city-star");
    expect(t.has("city-two-stars")).toBe(false);
    while (give(n) < TWO_STARS) n += 5;
    expect(earn(t, w)).toEqual(["city-two-stars"]);
  });

  it("The whole works: every kind of industry on the map, each one a player can build", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    // Each kind is a thing the workshop makes, from a blueprint that can be learned (not "coming soon").
    for (const role of INDUSTRY_KINDS) {
      const rule = THING_RULES[`piece:depot-${role}` as keyof typeof THING_RULES];
      expect(rule, role).toBeTruthy();
      const tech = (rule as { tech?: string }).tech;
      expect(tech && !BLUEPRINTS.find((b) => b.id === tech)?.plan, role).toBe(true);
    }
    expect(earn(t, w)).not.toContain("all-industries");
    // (Setup: the depots put down straight, away from the starter's; site rules are the tray's, not this check's.)
    let x = 3000;
    for (const role of INDUSTRY_KINDS) if (!industryKinds(w).has(role)) w.layout.addPiece(`depot-${role}` as PieceTypeId, { x: (x += 400), z: 3000, heading: 0 });
    syncIndustries(w);
    expect(industryKinds(w).size).toBe(INDUSTRY_KINDS.length);
    expect(earn(t, w)).toContain("all-industries");
  });

  it("Busy timetable and Rush hour (hidden): trains running at once, checked when that number changes", () => {
    const w = buildStarterWorld();
    const t = new StickerTracker();
    // (A stand-in sim: so many trains, each running or stopped.)
    let speeds: number[] = [];
    const sim = { trains: () => speeds.map((speed, id) => ({ id, derailed: false, speed })).values() };
    const v = Object.assign(Object.create(Object.getPrototypeOf(w)), w, { sim }) as World;
    speeds = [...Array(BUSY_TRAINS - 1).fill(100), 0, 0];
    expect(earn(t, v)).not.toContain("five-trains");
    speeds[BUSY_TRAINS - 1] = 100;
    expect(earn(t, v)).toEqual(["five-trains"]);
    speeds = Array(RUSH_HOUR).fill(100);
    expect(earn(t, v)).toEqual(["rush-hour"]);
    expect(STICKERS.find((s) => s.id === "rush-hour")!.hidden).toBe(true);
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
    expect(fn).toMatch(/checkStickers\(announce/);
    expect(mainSrc.match(/stickers\.update\(/g)?.length).toBe(1);
  });
});

describe("a sticker's ticket (the Stickers tab)", () => {
  it("says how to earn it; a hidden one not yet earned gives only its hint", async () => {
    const { stickerTicket } = await import("../ui/goals-panel");
    const track = STICKERS.find((s) => s.id === "track-layer")!;
    const hidden = STICKERS.find((s) => s.hidden)!;
    expect(stickerTicket(track, false)).toBe("Lay 40 pieces of track.");
    expect(stickerTicket(track, true)).toBe("Earned! Lay 40 pieces of track.");
    expect(stickerTicket(hidden, false)).toBe(`Hint: ${hidden.hint}`);
    expect(stickerTicket(hidden, true)).toBe(`Earned! ${hidden.how}.`);
  });
});
