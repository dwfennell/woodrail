/**
 * A line's stop on another railway than its train (the user's 2026-11-26 map: Warehouse 2 moved onto the main line
 * beside Orange line 2's loop, never joined to it): no way leads there whatever the switches, so the train goes on to
 * the next of its stops on its own railway (`Economy.apartSkipOf`), serving the rest of its line, and its card and the
 * situation tip name that stop and the fix. Before, it ran round its own stops for good, stopping at none, and the card
 * named the stop beside it ("Can't reach Farm yard: no track leads there").
 */
import { describe, expect, it } from "vitest";
import { appendPiece, connectorRef, Layout, type PieceTypeId } from "../track";
import { chain } from "../economy/loop-fixtures";
import { Sim, SIM_HZ } from "../sim";
import { Economy } from "../economy/economy";
import { editLine, stopApart } from "../game/lines";
import { engineStatus } from "../game/engine-status";
import { UNREACHABLE, type SituationContext } from "../game/situation-tips";
import type { World } from "../game/world";

const S: PieceTypeId = "straight-216";

/** ⊐ forest ══ ══ sawmill ⊏, and apart from it ⊐ ══ second sawmill ⊏ (or joined on, `joined`). */
function lay(joined: boolean) {
  const layout = new Layout();
  const [forest, ...w] = chain(layout, ["depot-forest", S, S, S]);
  appendPiece(layout, "buffer-turnback", false, connectorRef(forest, 0));
  const mill = appendPiece(layout, "depot-sawmill", false, connectorRef(w[2], 1));
  let far: number;
  if (joined) {
    const x = chain(layout, [S, S], connectorRef(mill, 1));
    far = appendPiece(layout, "depot-sawmill", false, connectorRef(x[1], 1));
    appendPiece(layout, "buffer-turnback", false, connectorRef(far, 1));
  } else {
    appendPiece(layout, "buffer-turnback", false, connectorRef(mill, 1));
    // (A railway of its own, laid off to one side: nothing joins it to the first.)
    const b = layout.addPiece(S, { x: 0, z: 2000, heading: 0 });
    far = appendPiece(layout, "depot-sawmill", false, connectorRef(b, 1));
    appendPiece(layout, "buffer-turnback", false, connectorRef(far, 1));
  }
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const f = economy.addDepot("forest", forest);
  const m = economy.addDepot("sawmill", mill);
  const m2 = economy.addDepot("sawmill", far);
  const placed = sim.addTrain(["engine", "timber"], { pieceId: w[0], pathIndex: 0, reversed: false, s: 100 });
  if (placed.kind !== "placed") throw new Error("no room");
  const engine = sim.getTrain(placed.trainId)!.cars[0].id;
  const line = editLine(economy, engine, (st) => st.push({ depotId: f.id, action: "auto" }, { depotId: m.id, action: "auto" }, { depotId: m2.id, action: "auto" }))!;
  sim.setLever(engine, 1);
  return { layout, sim, economy, engine, line, f, m, m2 };
}

function run(w: ReturnType<typeof lay>, seconds: number) {
  const seen = new Map<number, number>();
  let was = -1;
  for (let k = 0; k < seconds * SIM_HZ; k++) {
    w.sim.tick();
    w.economy.tick();
    const r = w.economy.routeOf(w.engine)!;
    const now = r.at ? r.stops[r.next % r.stops.length].depotId : -1;
    if (now !== -1 && now !== was) seen.set(now, (seen.get(now) ?? 0) + 1);
    was = now;
  }
  return seen;
}

describe("a line's stop on another railway", { timeout: 120_000 }, () => {
  it("is skipped: the train serves the stops on its railway, and its card and the tip say which and why", () => {
    const w = lay(false);
    expect(w.economy.railwayOf(w.m2.pieceId)).not.toBe(w.economy.railwayOf(w.m.pieceId));
    expect(stopApart(w.economy, w.line.stops, 2)).toBe(true);
    expect(stopApart(w.economy, w.line.stops, 0)).toBe(false);
    const names = (id: number) => (id === w.m2.id ? "the far sawmill" : id === w.m.id ? "the sawmill" : "the forest");
    const said = new Set<string>();
    const seen = new Map<number, number>();
    for (let s = 0; s < 240; s += 2) {
      for (const [k, v] of run(w, 2)) seen.set(k, (seen.get(k) ?? 0) + v);
      said.add(engineStatus(w.sim, w.economy, w.engine, names));
    }
    // (Back and forth between the forest and the sawmill, lap after lap; never at the one it can't get to.)
    expect(seen.get(w.f.id) ?? 0).toBeGreaterThanOrEqual(2);
    expect(seen.get(w.m.id) ?? 0).toBeGreaterThanOrEqual(2);
    expect(seen.get(w.m2.id) ?? 0).toBe(0);
    expect([...said]).toContain("Skips the far sawmill: no track joins it to the track this train is on. Join its track to this line's, or take it off the line");
    // (Mid-lap, heading back for the forest, past the skipped stop: the tip names it.)
    let sit = null as ReturnType<typeof UNREACHABLE.look>;
    const ctx: SituationContext = { learned: null, nameOf: names, now: 1000 };
    for (let s = 0; s < 120 && !sit; s++) {
      run(w, 1);
      sit = UNREACHABLE.look({ layout: w.layout, sim: w.sim, economy: w.economy } as unknown as World, ctx);
    }
    expect(sit?.title).toBe(`The ${w.line.name} skips the far sawmill`);
    expect(sit?.text).toBe(`No track joins the far sawmill to the track the ${w.line.name} runs on. Join them, or take it off the line.`);
  });

  it("joined to the line, it isn't: the train calls at all three", () => {
    const w = lay(true);
    expect(stopApart(w.economy, w.line.stops, 2)).toBe(false);
    const seen = run(w, 300);
    expect(w.economy.apartSkipOf(w.engine)).toBeNull();
    expect(seen.get(w.m2.id) ?? 0).toBeGreaterThanOrEqual(1);
    expect(seen.get(w.f.id) ?? 0).toBeGreaterThanOrEqual(1);
  });
});

describe("a yard's track isn't held for a train on another railway", { timeout: 120_000 }, () => {
  it("a train whose stops are all on another railway doesn't keep a train of that railway out of the yard", () => {
    // ⊐ forest ══ ══ points ══ sawmill ⊏ (the points' other road a stub; the sawmill with a second track beside it joined
    // to nothing, as the user's Warehouse 2's was), and apart from it ⊐ ══ ══ ══ ⊏ with a train whose line is the forest and the sawmill.
    const layout = new Layout();
    const [forest, ...w] = chain(layout, ["depot-forest", S, S, S]);
    appendPiece(layout, "buffer-turnback", false, connectorRef(forest, 0));
    const sw = appendPiece(layout, "switch", false, connectorRef(w[2], 1), 0);
    const [x, mill] = chain(layout, [S, "depot-sawmill"], connectorRef(sw, 1));
    appendPiece(layout, "buffer-turnback", false, connectorRef(mill, 1));
    void x;
    chain(layout, [S], connectorRef(sw, 2));
    // (Beside the sawmill, where the card's Second track goes, joined to nothing.)
    const yard = layout.getPiece(mill)!.pose;
    const loose = layout.addPiece(S, { x: yard.x + 72 * Math.sin(yard.heading), z: yard.z - 72 * Math.cos(yard.heading), heading: yard.heading });
    const a = layout.addPiece(S, { x: 0, z: 3000, heading: 0 });
    const far = chain(layout, [S, S, S], connectorRef(a, 1));
    appendPiece(layout, "buffer-turnback", false, connectorRef(a, 0));
    appendPiece(layout, "buffer-turnback", false, connectorRef(far[2], 1));
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const f = economy.addDepot("forest", forest);
    const m = economy.addDepot("sawmill", mill);
    economy.setTracks(m, [loose], [], []);
    expect(economy.trackCount(m.id)).toBe(2);
    const put = (pieceId: number) => {
      const placed = sim.addTrain(["engine", "timber"], { pieceId, pathIndex: 0, reversed: false, s: 100 });
      if (placed.kind !== "placed") throw new Error("no room");
      const e = sim.getTrain(placed.trainId)!.cars[0].id;
      editLine(economy, e, (st) => st.push({ depotId: m.id, action: "auto" }, { depotId: f.id, action: "auto" }));
      sim.setLever(e, 1);
      return e;
    };
    // (The one apart first, so it's given the sawmill's track first.)
    const apart = put(far[0]);
    const home = put(w[0]);
    let calls = 0;
    let was = false;
    let full = 0;
    for (let k = 0; k < 240 * SIM_HZ; k++) {
      sim.tick();
      economy.tick();
      // (Told the sawmill is full, its one track given to the train that can never come: it waited at the points.)
      if (economy.fullAt(home)) full++;
      const r = economy.routeOf(home)!;
      const at = !!r.at && r.stops[r.next % r.stops.length].depotId === m.id;
      if (at && !was) calls++;
      was = at;
    }
    expect(economy.apartSkipOf(apart)?.none).toBe(true);
    expect(full).toBe(0);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe("a yard's further track left behind", () => {
  it("counts only beside its yard: moved away from it, not a track of it; moved back, one again", () => {
    const layout = new Layout();
    const [, mill] = chain(layout, [S, "depot-sawmill", S]);
    const yard = layout.getPiece(mill)!.pose;
    const c = Math.cos(yard.heading);
    const s = Math.sin(yard.heading);
    // (Beside it, where the card's Second track goes.)
    const road = layout.addPiece(S, { x: yard.x + 72 * s, z: yard.z - 72 * c, heading: yard.heading });
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const m = economy.addDepot("sawmill", mill);
    economy.setTracks(m, [road], [], []);
    expect(economy.trackCount(m.id)).toBe(2);
    layout.movePiece(road, { x: yard.x + 2000, z: yard.z + 900, heading: yard.heading }, 0);
    expect(economy.trackCount(m.id)).toBe(1);
    layout.movePiece(road, { x: yard.x + 72 * s, z: yard.z - 72 * c, heading: yard.heading }, 0);
    expect(economy.trackCount(m.id)).toBe(2);
  });
});
