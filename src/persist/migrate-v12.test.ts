import { describe, expect, it, vi } from "vitest";
import fixture from "./fixtures/v12-game.json?raw";
import { Progress } from "../game/progress";
import { redrawOldOffers } from "../game/rewards";
import { townStatus } from "../game/towns";
import { receivedBy } from "../game/town-life";
import { rng } from "../lib/rng";
import { backupKey, hasOlderSave, loadFromStorage, loadProgress, SAVE_VERSION, saveProgress, saveToStorage, serializeWorld } from "./save";

/**
 * A v12 Game save, recorded with main's (v12) save writer and `Progress` (fixtures/v12-game.json): the starter map with
 * a line and a train, Larkfield and Elderwick supplied, Mills being researched, Halts on the board, 325 coins, and
 * two town offers waiting (two blueprints each, and a crate).
 */
const v12 = JSON.parse(fixture) as { version: number; towns: string[]; save: { version: number }; progress: unknown };

function withStorage<T>(store: Map<string, string>, f: () => T): T {
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  try {
    return f();
  } finally {
    vi.unstubAllGlobals();
  }
}

describe("a v12 Game save carries over into v13", () => {
  it("its map loads as it was, not turned away, and saves again as v13", () => {
    expect([v12.version, v12.save.version]).toEqual([12, 12]);
    const store = new Map([["woodrail.game.v2", JSON.stringify(v12.save)]]);
    withStorage(store, () => {
      expect(hasOlderSave("game")).toBe(false);
      const r = loadFromStorage("game");
      expect(r?.ok).toBe(true);
      if (!r?.ok) return;
      const w = r.value;
      expect(w.landscape.towns.slice(0, 2).map((t) => t.name)).toEqual(v12.towns);
      // (And the start's old sites, gained as it loads: a stub each, where none of its track is.)
      expect(w.ruins.size).toBeGreaterThan(0);
      expect(w.landscape.sites!.length).toBe(w.ruins.size);
      expect(w.layout.pieceCount).toBe((v12.save as unknown as { pieces: unknown[] }).pieces.length + w.ruins.size);
      expect(w.sim.trainCount).toBe(1);
      expect(w.economy.delivered.get(w.landscape.towns[0].id)).toBe(60);
      // Read as it is: no backup kept.
      expect(store.has(backupKey("game", 12))).toBe(false);
      expect(saveToStorage(w, "game")).toBe(true);
      expect(JSON.parse(store.get("woodrail.game.v2")!).version).toBe(SAVE_VERSION);
    });
  });

  it("its progress keeps coins, learned and research (its board goes: anything ready can be researched); each town's offer is drawn again as cards at its level", () => {
    const store = new Map([["woodrail.game.v2", JSON.stringify(v12.save)], ["woodrail.game.progress.v1", JSON.stringify(v12.progress)]]);
    withStorage(store, () => {
      const r = loadFromStorage("game");
      if (!r?.ok) throw new Error("v12 map didn't load");
      const w = r.value;
      const p = Progress.fromJSON(loadProgress());
      expect(p.coins).toBe(325);
      expect([...p.learned].sort()).toEqual(["farming", "switches"]);
      expect("board" in p.toJSON()).toBe(false);
      expect(p.research.current).toBe("mills");
      expect(p.owned.get("piece:depot-workshop")).toBe(1);
      // The blueprints and crates are gone; the towns are kept till the map's in.
      expect(p.offers).toEqual([]);
      expect(p.oldOffers).toEqual(["Larkfield", "Elderwick"]);
      // Saved before then (they're kept).
      expect(Progress.fromJSON(JSON.parse(JSON.stringify(p.toJSON()))).oldOffers).toEqual(["Larkfield", "Elderwick"]);
      expect(redrawOldOffers(p, w, rng(7))).toBe(true);
      expect(p.oldOffers).toEqual([]);
      const levels = v12.towns.map((name) => Math.max(1, townStatus(receivedBy(w, w.landscape.towns.find((t) => t.name === name)!.id)).level));
      expect(levels[0]).toBeGreaterThanOrEqual(2);
      expect(p.offers.map((o) => [o.from, o.level])).toEqual(v12.towns.map((name, i) => [name, levels[i]]));
      for (const o of p.offers) {
        expect(o.cards.length).toBeGreaterThan(1);
        expect(new Set(o.cards.map((c) => c.kind)).size).toBe(o.cards.length);
        expect(JSON.stringify(o.cards)).not.toMatch(/"ids"|mills|routes|passengers|junctions/);
      }
      // Once only; and the v13 progress saves and loads with its cards.
      expect(redrawOldOffers(p, w, rng(7))).toBe(false);
      saveProgress(p.toJSON());
      const again = Progress.fromJSON(loadProgress());
      expect(again.offers).toEqual(p.offers);
      expect(again.oldOffers).toEqual([]);
      // (The map too, unchanged by any of this.)
      expect(serializeWorld(w).version).toBe(SAVE_VERSION);
    });
  });

  it("an offer whose town isn't on the map is drawn at a village's level", () => {
    const store = new Map([["woodrail.game.v2", JSON.stringify(v12.save)]]);
    withStorage(store, () => {
      const r = loadFromStorage("game");
      if (!r?.ok) throw new Error("v12 map didn't load");
      const p = Progress.fromJSON({ owned: [], learned: [], offers: [{ from: "Nowhere", ids: ["mills"] }] });
      redrawOldOffers(p, r.value, rng(2));
      expect(p.offers.map((o) => [o.from, o.level])).toEqual([["Nowhere", 1]]);
    });
  });

  it("a save older than v12 is still turned away and kept aside under its backup key", () => {
    const old = { ...v12.save, version: 11 };
    const raw = JSON.stringify(old);
    const store = new Map([["woodrail.game.v2", raw]]);
    withStorage(store, () => {
      expect(hasOlderSave("game")).toBe(true);
      expect(loadFromStorage("game")?.ok).toBe(false);
      expect(store.get("woodrail.game.v2.backup-v11")).toBe(raw);
    });
  });
});

describe("no ready-made trains in Game mode: an old save", () => {
  it("its toy box was always parts (an engine, flatbeds): it loads and saves as it was, no split needed; the train on its map keeps its cars", () => {
    const store = new Map([["woodrail.game.v2", JSON.stringify(v12.save)], ["woodrail.game.progress.v1", JSON.stringify(v12.progress)]]);
    withStorage(store, () => {
      const r = loadFromStorage("game");
      if (!r?.ok) throw new Error("v12 map didn't load");
      const p = Progress.fromJSON(loadProgress());
      const owned = [...p.owned].sort();
      expect(owned).toEqual([["car:engine", 1], ["car:timber", 3], ["piece:buffer-turnback", 2], ["piece:depot-workshop", 1]]);
      saveProgress(p.toJSON());
      expect([...Progress.fromJSON(loadProgress()).owned].sort()).toEqual(owned);
      // The made-up train on the map (engine, hopper, caboose) is left as it is, and saves so.
      const cars = (w: typeof r.value) => w.sim.trainIds().map((id) => w.sim.getTrain(id)!.cars.map((c) => c.kind));
      expect(cars(r.value)).toEqual([["engine", "hopper", "caboose"]]);
      expect(saveToStorage(r.value, "game")).toBe(true);
      const again = loadFromStorage("game");
      if (!again?.ok) throw new Error("saved map didn't load");
      expect(cars(again.value)).toEqual([["engine", "hopper", "caboose"]]);
    });
  });
});
