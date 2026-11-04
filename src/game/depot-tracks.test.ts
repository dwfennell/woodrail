import { describe, expect, it } from "vitest";
import { Sim, type Train } from "../sim";
import { connectorRef, Layout, type PieceTypeId } from "../track";
import { CARGO } from "../economy/cargo";
import { Economy } from "../economy";
import { planTracks, recordTracks, trackCount, type PlaceCheck } from "./depot-tracks";

/** PROTOTYPE (docs/superpowers/specs/2026-11-04-depot-tracks.md): the ladder planner and two trains worked at once. */

/** A mill in a straight line along +x: three straights, the mill, three straights. No room rules (`open`). */
function line() {
  const layout = new Layout();
  const types: PieceTypeId[] = ["straight-216", "straight-216", "straight-216", "depot-mill", "straight-216", "straight-216", "straight-216"];
  const ids = types.map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const mill = economy.addDepot("mill", ids[3]);
  return { layout, sim, economy, ids, mill };
}
const open: PlaceCheck = () => null;

/** Do a plan as the editor would (`replaceRun`): take up the covers, put the pieces down. */
function apply(w: ReturnType<typeof line>, plan: Exclude<ReturnType<typeof planTracks>, string>) {
  for (const id of plan.covers) w.layout.removePiece(id);
  const ids = plan.pieces.map((p) => w.layout.addPiece(p.type, p.pose, p.y, p.flipped));
  return recordTracks(w, plan, ids, w.mill);
}

describe("depot tracks (prototype)", () => {
  it("lays a second, then a third track, joined at both ends by crossovers", () => {
    const w = line();
    const two = planTracks(w, w.ids[3], open);
    if (typeof two === "string") throw new Error(two);
    expect(two.tracks).toBe(2);
    expect([...two.covers].sort()).toEqual([w.ids[2], w.ids[4]].sort());
    expect(two.pieces.map((p) => p.type).sort()).toEqual(["buffer", "buffer", "crossover", "crossover", "straight-216"]);
    apply(w, two);
    expect(trackCount(w, w.ids[3])).toBe(2);
    // Every new piece's ends are joined (no stray open end: the stubs end at buffers).
    for (const id of w.layout.pieceIds()) {
      const p = w.layout.getPiece(id)!;
      if (p.type === "crossover") for (let i = 0; i < 4; i++) expect(w.layout.joinedConnector(connectorRef(id, i))).not.toBe(-1);
    }
    const three = planTracks(w, w.ids[3], open);
    if (typeof three === "string") throw new Error(three);
    apply(w, three);
    expect(trackCount(w, w.ids[3])).toBe(3);
    expect([...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id)!.type === "crossover")).toHaveLength(4);
    expect(planTracks(w, w.ids[3], open)).toMatch(/3 tracks already/);
  });

  it("says why when the line bends or ends too soon", () => {
    const layout = new Layout();
    const ids = (["straight-216", "depot-mill", "curve-large"] as PieceTypeId[]).map((t, i) => layout.addPiece(t, { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    expect(planTracks({ layout, sim }, ids[1], open)).toMatch(/straight track/);
  });

  it("works a train on each track at once, from the same piles", () => {
    const w = line();
    const plan = planTracks(w, w.ids[3], open);
    if (typeof plan === "string") throw new Error(plan);
    const [road] = apply(w, plan);
    w.mill.piles[CARGO.flour.index] = 8;
    const put = (pieceId: number, kinds: ("engine" | "hopper" | "van")[]) => {
      const r = w.sim.addTrain(kinds, { pieceId, pathIndex: 0, reversed: false, s: 200 });
      if (r.kind !== "placed") throw new Error("no room");
      const t = w.sim.getTrain(r.trainId) as Train;
      w.sim.setLever(t.cars[0].id, 1);
      return t;
    };
    const a = put(w.ids[3], ["engine", "hopper"]);
    w.economy.setCargo(a.cars[1].id, "grain", 4);
    const b = put(road.pieceId, ["engine", "van"]);
    let both = false;
    for (let i = 0; i < 60 * 40 && !both; i++) {
      w.sim.tick();
      w.economy.tick();
      both = w.economy.cranePhase(w.mill.id, w.ids[3]) >= 0 && w.economy.cranePhase(w.mill.id, road.pieceId) >= 0;
    }
    expect(both).toBe(true);
    for (let i = 0; i < 60 * 60; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    // The hopper's grain went onto the mill's pile; the van took flour from the same yard.
    expect(w.economy.cargoOf(a.cars[1].id).count).toBe(0);
    expect(w.economy.cargoOf(b.cars[1].id).kind).toBe("flour");
    expect(w.economy.allDepots()).toHaveLength(1);
  });
});
