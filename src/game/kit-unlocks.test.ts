import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { appendPiece, connectorRef, isKit, kitOf, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { craftNow, Crafting, lacking, workshopStock } from "./crafting";
import { Progress, inUse } from "./progress";
import { crateFor } from "./rewards";
import { built, ready, techOf, unlocksOf } from "./tech";
import { costText, isFree, ruleOf, THING_RULES, thingsFor, type ThingId } from "./things";
import { buildStarterWorld, syncIndustries } from "./world";

/** Game mode's railway kits and lineside furniture, by the blueprint that unlocks them: the table as decided. */
const UNLOCKS: Record<string, ThingId[]> = {
  signals: ["piece:signal", "piece:kit-semaphore-signal"],
  electricity: ["piece:depot-power", "piece:kit-colour-light-signal"],
  junctions: ["piece:switch-3way", "piece:crossing", "piece:crossing-45", "piece:crossover", "piece:wye", "piece:double-straight", "piece:double-curve", "piece:balloon-loop", "piece:balloon-loop-small", "piece:kit-signal-gantry"],
  "engine-shed": ["piece:kit-engine-shed", "piece:kit-water-tower", "piece:kit-coal-stage", "piece:kit-water-crane", "piece:kit-coaling-crane"],
  turntable: ["piece:kit-turntable", "piece:kit-roundhouse-segment", "piece:kit-transfer-table"],
  halts: ["piece:kit-country-halt", "piece:kit-mountain-station", "piece:kit-harbour-station", "piece:kit-platform-furnished"],
  scenery: [
    "piece:kit-castle-gate",
    "piece:kit-train-wash",
    "piece:kit-weighbridge",
    "car:cleaner",
    "prop:bldg-station-clock",
    "prop:mech-whistle-post",
    "prop:bldg-signal-box",
    "prop:mech-lever-frame",
    "prop:mech-level-crossing",
    "prop:mech-gated-crossing",
  ],
};

/** The starter map with a workshop out of the first station's far end, holding `planks` (and `iron`). */
function withWorkshop(planks: number, iron = 0) {
  const w = buildStarterWorld();
  const station = w.stations.get(w.landscape.towns[0].id)!;
  const piece = appendPiece(w.layout, "depot-workshop", false, connectorRef(station, 0));
  syncIndustries(w);
  const d = w.economy.depotAtPiece(piece)!;
  d.piles[CARGO.planks.index] = planks;
  d.piles[CARGO.iron.index] = iron;
  return { w, d, piece };
}

describe("railway kits in Game mode", () => {
  it("each blueprint unlocks exactly its kits", () => {
    for (const [tech, things] of Object.entries(UNLOCKS)) expect(new Set(unlocksOf(tech)), tech).toEqual(new Set(things));
    // And no other blueprint unlocks a kit or furniture.
    const kits = (Object.keys(THING_RULES) as ThingId[]).filter((id) => id.startsWith("prop:") || id === "car:cleaner" || (id.startsWith("piece:") && isKit(id.slice(6) as PieceTypeId)));
    for (const id of kits) expect(Object.keys(UNLOCKS), id).toContain(ruleOf(id)!.tech);
  });

  it("their blueprints are built now (no longer coming soon), on their tiers; tunnels, the viaduct and the lift bridge still wait", () => {
    for (const id of Object.keys(UNLOCKS)) expect(built(techOf(id)!), id).toBe(true);
    expect([techOf("signals")!.tier, techOf("junctions")!.tier, techOf("engine-shed")!.tier, techOf("turntable")!.tier, techOf("scenery")!.tier]).toEqual([1, 1, 2, 2, 1]);
    for (const id of ["tunnels", "viaduct", "lift-bridge"]) expect(techOf(id)!.plan, id).toBeDefined();
    const halts = techOf("halts")!;
    expect([halts.branch, halts.needs]).toEqual(["passengers", ["passengers"]]);
    expect(BLUEPRINTS.filter((b) => b.id === "halts")).toHaveLength(1);
  });

  it("no cargo loaders or unloaders: Sandbox's endless heaps stay Sandbox's", () => {
    for (const id of Object.keys(THING_RULES)) if (id.startsWith("piece:kit-")) expect(kitOf(id.slice(6) as PieceTypeId)!.depot, id).toBeUndefined();
    expect(ruleOf("piece:kit-goods-shed")).toBeUndefined();
  });

  it("a kit not learned can't be taken out, nor ordered; learned, it can", () => {
    const { w } = withWorkshop(20);
    const p = Progress.fresh();
    for (const item of [{ kind: "piece" as const, type: "kit-water-tower" as PieceTypeId }, { kind: "prop" as const, asset: "mech-level-crossing" }, { kind: "train" as const, cars: ["cleaner" as const] }]) {
      const [id] = [...thingsFor(item).keys()];
      expect(p.knows(id), id).toBe(false);
      expect(p.short(w, thingsFor(item)), id).toBe(id);
      expect(p.hasAnother(w, item), id).toBe(false);
    }
    const crafting = new Crafting(p);
    crafting.order("piece:kit-water-tower");
    expect(p.orders).toEqual([]);
    p.learned.add("engine-shed");
    p.learned.add("scenery");
    expect(p.knows("piece:kit-water-tower")).toBe(true);
    crafting.order("piece:kit-water-tower");
    expect(p.orders).toEqual(["piece:kit-water-tower"]);
    // A crossing style, learned, is free: nothing to make, never short, not orderable.
    expect(p.short(w, thingsFor({ kind: "prop", asset: "mech-level-crossing" }))).toBeNull();
    crafting.order("prop:mech-level-crossing");
    expect(p.orders).toEqual(["piece:kit-water-tower"]);
  });

  it("made from the tray at the workshop for its planks (and iron), as any piece", () => {
    const p = Progress.fresh();
    for (const t of Object.keys(UNLOCKS)) p.learned.add(t);
    const cases: [ThingId, Record<string, number>][] = [
      ["piece:kit-water-tower", { planks: 4 }],
      ["piece:kit-engine-shed", { planks: 12 }],
      ["piece:kit-semaphore-signal", { planks: 3 }],
      ["piece:kit-colour-light-signal", { planks: 2, iron: 1 }],
      ["piece:kit-turntable", { planks: 10 }],
      ["piece:kit-country-halt", { planks: 6 }],
      ["prop:bldg-signal-box", { planks: 4 }],
      ["car:cleaner", { planks: 3 }],
    ];
    for (const [id, cost] of cases) {
      const { w } = withWorkshop(20, 5);
      const before = p.owned.get(id) ?? 0;
      expect(lacking(w, p, new Map([[id, 1]])), id).toEqual(new Map([[id, 1]]));
      expect(craftNow(w, p, new Map([[id, 1]])), id).toBeNull();
      expect(p.owned.get(id), id).toBe(before + 1);
      expect(workshopStock(w).planks, id).toBe(20 - cost.planks);
      expect(workshopStock(w).iron ?? 0, id).toBe(5 - (cost.iron ?? 0));
    }
    expect(costText(ruleOf("piece:kit-colour-light-signal")!)).toBe("2🪵 1🔩");
    // Short of planks: says so, takes nothing.
    const { w } = withWorkshop(3);
    expect(craftNow(w, p, new Map([["piece:kit-engine-shed", 1]]))).toEqual({ goods: { planks: 9 }, coins: 0 });
    expect(workshopStock(w).planks).toBe(3);
  });

  it("the crossing styles are free once learned, and never in a crate", () => {
    expect(isFree("prop:mech-level-crossing")).toBe(true);
    expect(isFree("prop:mech-gated-crossing")).toBe(true);
    expect(isFree("prop:bldg-signal-box")).toBe(false);
    const p = Progress.fresh();
    p.learned.add("carpentry");
    p.learned.add("scenery");
    for (let k = 0; k < 50; k++) for (const [id] of crateFor(p, 3, Math.random)) expect(isFree(id), id).toBe(false);
  });

  it("furniture on the map counts against the toy box; a town's own buildings don't", () => {
    const w = buildStarterWorld();
    const before = inUse(w, "prop:bldg-signal-box");
    w.props.add("bldg-signal-box", { x: 0, z: 0, heading: 0, y: 0 });
    expect(inUse(w, "prop:bldg-signal-box")).toBe(before + 1);
    w.props.add("bldg-signal-box", { x: 100, z: 0, heading: 0, y: 0 }, undefined, { building: 1, town: 0 });
    expect(inUse(w, "prop:bldg-signal-box")).toBe(before + 1);
    const p = Progress.fresh();
    p.learned.add("scenery");
    p.add("prop:bldg-signal-box", before + 1);
    expect(p.available(w, "prop:bldg-signal-box")).toBe(0);
  });

  it("halts can be learned once passengers are, at the board's price", () => {
    const p = Progress.fresh();
    expect(ready(p, "halts")).toBe(false);
    p.learned.add("passengers");
    expect(ready(p, "halts")).toBe(true);
  });
});
