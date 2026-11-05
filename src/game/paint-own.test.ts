import { describe, expect, it } from "vitest";
import { CARGO } from "../economy/cargo";
import { deserializeWorld, serializeWorld } from "../persist/save";
import trainsPy from "../../tools/blender/trains.py?raw";
import { paintable, WAGON_SLOTS, wagonRecolor } from "../render/train-models";
import type { CarKind, CarLook } from "../sim";
import { BLUEPRINTS } from "./blueprints";
import { shopOwes } from "./crafting";
import { coatWhy, liveryOf, ownColours, ownColoursOpen, ownLivery, PAINT_COLOURS, PAINT_KEPT, paintOwn, paintPots } from "./paint-shop";
import { Progress } from "./progress";
import { deliverByTrain, inYards, owesAsTheGameDoes } from "./workshop-testing";
import { buildStarterWorld, syncIndustries } from "./world";

/**
 * Your own colours (late-game spec, paint; the user's ask of 2026-11-05): after the Dye works, Paint your trains opens
 * a grid of colours at the paint shop, for an engine and its wagons. A coat takes a pot of paint from the workshop.
 */

/** The starter map, a workshop out of the way, a train of an engine and three wagons, and a Game player. */
function setup(learned: boolean) {
  const w = buildStarterWorld();
  const p = Progress.fresh();
  p.bestLevel = 2;
  if (learned) p.learned.add("paint-trains");
  const shop = w.layout.addPiece("depot-workshop", { x: -40000, z: -40000, heading: 0 });
  syncIndustries(w, true);
  owesAsTheGameDoes(w, p);
  return { w, p, shop };
}

/** A train of an engine and three wagons (a coach, a hopper, a tank wagon), on a line of its own. */
function train(w: ReturnType<typeof buildStarterWorld>): number[] {
  const line = [0, 1, 2, 3, 4, 5].map((k) => w.layout.addPiece("straight-216", { x: -60000 + 216 * k, z: -60000, heading: 0 }));
  const placed = w.sim.addTrain(["engine", "passenger", "hopper", "tanker"], { pieceId: line[5], pathIndex: 0, reversed: false, s: 150 });
  if (placed.kind !== "placed") throw new Error("no room");
  return w.sim.getTrain(placed.trainId)!.cars.map((c) => c.id);
}

describe("your own colours", () => {
  it("is a blueprint after the Dye works, studied like any other", () => {
    const b = BLUEPRINTS.find((x) => x.id === "paint-trains")!;
    expect([b.plan, b.needs]).toEqual([undefined, ["paint"]]);
    const p = Progress.fresh();
    expect(ownColoursOpen(p)).toBe(false);
    p.learned.add("paint-trains");
    expect(ownColoursOpen(p)).toBe(true);
  });

  it("a colour pair is a livery id, saved and read back; a wide grid to choose from", () => {
    expect(PAINT_COLOURS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PAINT_COLOURS).size).toBe(PAINT_COLOURS.length);
    const id = ownLivery("#1f5aa6", "#f3d27a");
    expect(id.length).toBeLessThanOrEqual(24);
    expect(ownColours(id)).toEqual({ body: "#1f5aa6", trim: "#f3d27a" });
    expect(liveryOf(id)).toEqual({ id, body: "#1f5aa6", trim: "#f3d27a" });
    expect(ownColours("custom:zz")).toBeNull();
  });

  it("the workshop takes paint by train only once it's learned, up to the pots it keeps", () => {
    const off = setup(false);
    expect(shopOwes(off.w, off.p, "paint")).toBe(0);
    expect(deliverByTrain(off.w, off.shop, "paint", 6)).toBe(6);
    expect(inYards(off.w, "paint")).toBe(0);
    const on = setup(true);
    expect(shopOwes(on.w, on.p, "paint")).toBe(PAINT_KEPT);
    expect(deliverByTrain(on.w, on.shop, "paint", PAINT_KEPT + 3)).toBe(3);
    expect(paintPots(on.w)).toBe(PAINT_KEPT);
    expect(shopOwes(on.w, on.p, "paint")).toBe(0);
  }, 30_000);

  it("the payoff: an engine and its wagons painted, a pot a car, saved with them", () => {
    const { w, p, shop } = setup(true);
    expect(coatWhy(p, w, 4)).toMatch(/Needs 4 paint at the workshop: it has 0/);
    deliverByTrain(w, shop, "paint", 6);
    expect(paintPots(w)).toBe(6);
    const cars = train(w);
    const [engine, ...wagons] = cars;
    expect(coatWhy(p, w, 4)).toBeNull();
    expect(paintOwn(p, w, w.sim, [engine], "#1f5aa6", "#f3d27a")).toBe(true);
    expect(paintPots(w)).toBe(5);
    expect(coatWhy(p, w, 6)).toMatch(/Needs 6 paint at the workshop: it has 5/);
    expect(paintOwn(p, w, w.sim, [...cars, ...cars], "#1f5aa6", "#f3d27a")).toBe(false);
    expect(paintPots(w)).toBe(5);
    expect(paintOwn(p, w, w.sim, cars, "#1f5aa6", "#f3d27a")).toBe(true);
    expect(paintPots(w)).toBe(1);
    expect(w.economy.depotAtPiece(shop)!.piles[CARGO.paint.index]).toBe(1);
    for (const c of cars) expect(w.sim.liveryOf(c)).toBe("custom:1f5aa6:f3d27a");
    // Short for all four: nothing taken, nothing painted.
    expect(paintOwn(p, w, w.sim, [engine, ...wagons], "#c8442f", "#2a2b2e")).toBe(false);
    expect(w.sim.liveryOf(engine)).toBe("custom:1f5aa6:f3d27a");
    expect(paintPots(w)).toBe(1);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (back.ok) for (const c of cars) expect([c, back.value.sim.hasCar(c), back.value.sim.liveryOf(c)]).toEqual([c, true, "custom:1f5aa6:f3d27a"]);
  }, 30_000);

  it("a painted wagon's modelled body and trim colours swap to the livery's; a code-made wagon can't be painted", () => {
    // (The models' own colours, tools/blender/trains.py: each slot is a colour the wagon is modelled in.)
    const py = trainsPy.toLowerCase();
    for (const [kind, looks] of Object.entries(WAGON_SLOTS)) {
      for (const [look, slots] of Object.entries(looks!)) {
        expect(paintable(kind as CarKind, look as CarLook), `${kind} ${look}`).toBe(true);
        for (const c of [...slots!.body, ...slots!.trim]) expect(py.includes(c.toLowerCase()), `${kind} ${look} ${c}`).toBe(true);
        const map = wagonRecolor(kind as CarKind, look as CarLook, { body: "#123456", trim: "#abcdef" })!;
        for (const c of slots!.body) expect(map[c]).toBe("#123456");
        for (const c of slots!.trim) expect(map[c]).toBe("#abcdef");
      }
    }
    expect(paintable("tanker", "classic")).toBe(false);
    expect(paintable("engine", "classic")).toBe(true);
  });
});
