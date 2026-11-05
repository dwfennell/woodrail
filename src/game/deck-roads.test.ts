/**
 * Turntable controls (tech-tree T5): a tap on a road turns the deck straight to it (`deckRoadAt`, `Sim.turnDeckTo`),
 * carrying round an engine standing on it, the way the deck's model turns.
 */
import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { connectorRef, createRouteStep, createWorldConnector, DECK_GLIDE_S, Layout, routeFrom, transformPose, getPieceDef, type PieceTypeId } from "../track";
import { deckLiesAlong, deckRoadAt } from "./deck-roads";
import { BLUEPRINTS } from "./blueprints";

function onEnd(layout: Layout, id: number, index: number, type: PieceTypeId): number {
  const c = createWorldConnector();
  layout.worldConnector(connectorRef(id, index), c);
  return layout.addPiece(type, { x: c.x, z: c.z, heading: c.heading });
}

/** A turntable with a straight (and a turnback buffer) off ends 0, 2 and 3. */
function yard() {
  const layout = new Layout();
  const id = layout.addPiece("kit-turntable", { x: 0, z: 0, heading: 0 });
  const roads = new Map<number, number>();
  for (const k of [0, 2, 3]) {
    const s = onEnd(layout, id, k, "straight-216");
    roads.set(k, s);
    onEnd(layout, s, 1, "buffer-turnback");
  }
  return { layout, id, roads, sim: new Sim(layout) };
}

/** World point of end `k` of piece `id`, `inward` mm in toward the piece. */
function endPoint(layout: Layout, id: number, k: number, inward: number): { x: number; z: number } {
  const c = createWorldConnector();
  layout.worldConnector(connectorRef(id, k), c);
  return { x: c.x - Math.cos(c.heading) * inward, z: c.z - Math.sin(c.heading) * inward };
}

describe("turntable controls (T5)", () => {
  it("is a tier-2 Track blueprint after the turntable, a feature (no pieces)", () => {
    const b = BLUEPRINTS.find((x) => x.id === "turntable-controls")!;
    expect(b.branch).toBe("track");
    expect(b.needs).toEqual(["turntable"]);
    expect(b.plan).toBeUndefined();
    expect(b.feature).toBeTruthy();
  });

  it("a tap on the deck by one of its roads means that road; on its hub, none (a tap there steps it, as before)", () => {
    const { layout, id } = yard();
    for (let k = 0; k < 8; k++) expect(deckRoadAt(layout, id, endPoint(layout, id, k, 20).x, endPoint(layout, id, k, 20).z)).toEqual({ deck: id, road: k % 4 });
    const middle = transformPose(layout.getPiece(id)!.pose, { x: 92, z: 0, heading: 0 }, { x: 0, z: 0, heading: 0 });
    expect(deckRoadAt(layout, id, middle.x + 10, middle.z - 10)).toBeNull();
  });

  it("a tap on a road leading off the turntable means that road; off the road, or on track not joined to a deck, none", () => {
    const { layout, id, roads } = yard();
    for (const k of [0, 2, 3]) {
      const s = roads.get(k)!;
      const on = endPoint(layout, s, 1, 100);
      expect(deckRoadAt(layout, s, on.x, on.z)).toEqual({ deck: id, road: k % 4 });
    }
    const s = roads.get(2)!;
    const p = endPoint(layout, s, 1, 100);
    const c = createWorldConnector();
    layout.worldConnector(connectorRef(s, 1), c);
    // (60 mm to one side of it.)
    expect(deckRoadAt(layout, s, p.x - Math.sin(c.heading) * 60, p.z + Math.cos(c.heading) * 60)).toBeNull();
    const lone = layout.addPiece("straight-216", { x: 3000, z: 0, heading: 0 });
    expect(deckRoadAt(layout, lone, 3100, 0)).toBeNull();
  });

  it("the sim turns the deck straight to that road in one glide, and the road joins up", () => {
    const { layout, id, roads, sim } = yard();
    expect(deckLiesAlong(layout, { deck: id, road: 0 })).toBe(true);
    expect(sim.turnDeckTo(id, 0)).toBe(false);
    expect(sim.turnDeckTo(id, 3)).toBe(true);
    expect(layout.switchState(id)).toBe(3);
    expect(layout.deckTurning(id)).toBe(true);
    // (Still turning: no road joins yet.)
    const step = createRouteStep();
    expect(routeFrom(layout, roads.get(3)!, 0, step)).toBe(false);
    for (let k = 0; k < DECK_GLIDE_S * SIM_HZ; k++) sim.tick();
    expect(layout.deckTurning(id)).toBe(false);
    expect(routeFrom(layout, roads.get(3)!, 0, step)).toBe(true);
    expect([step.pieceId, step.pathIndex]).toEqual([id, 3]);
    // Not a lift (its platform is sent, not turned), nor plain track.
    expect(sim.turnDeckTo(roads.get(3)!, 0)).toBe(false);
  });

  it("an engine standing on the deck is carried round with it, the way the deck turns (three eighths on, not one back)", () => {
    const { id, sim } = yard();
    const len = 2 * 92;
    const placed = sim.addTrain(["engine"], { pieceId: id, pathIndex: 0, reversed: false, s: len / 2 + 30 });
    expect(placed.kind).toBe("placed");
    const t = () => sim.getTrain(sim.trainIds()[0])!;
    const h0 = t().world[0].heading;
    expect(sim.turnDeckTo(id, 3)).toBe(true);
    // Half way through the glide: turned about half of 3/8 of a turn, forward.
    for (let k = 0; k < (DECK_GLIDE_S * SIM_HZ) / 2; k++) sim.tick();
    const mid = Math.atan2(Math.sin(t().world[0].heading - h0), Math.cos(t().world[0].heading - h0));
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan((3 * Math.PI) / 4);
    for (let k = 0; k < DECK_GLIDE_S * SIM_HZ; k++) sim.tick();
    expect(t().bogies.every((b) => b.pieceId === id && b.pathIndex === 3)).toBe(true);
    expect(t().derailed).toBe(false);
    const end = Math.atan2(Math.sin(t().world[0].heading - h0), Math.cos(t().world[0].heading - h0));
    expect(end).toBeCloseTo((3 * Math.PI) / 4, 1);
  });

  it("not a lift", () => {
    const layout = new Layout();
    const lift = layout.addPiece("kit-train-lift", { x: 0, z: 0, heading: 0 });
    expect(getPieceDef("kit-train-lift", false).gated).toBe(true);
    expect(deckRoadAt(layout, lift, 10, 0)).toBeNull();
    expect(new Sim(layout).turnDeckTo(lift, 1)).toBe(false);
  });
});
