import { describe, expect, it } from "vitest";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { liveryRecolor, LIVERY_SLOTS } from "../render/train-models";
import { CAR_LOOKS } from "../sim/cars";
import { LIVERIES, liveryById, liveryOf, paint, paintOpen, paintState } from "./paint-shop";
import { Progress } from "./progress";
import { buildStarterWorld } from "./world";

/** The paint shop (spec 2026-11-04-civic-leisure-design.md §4): liveries open as towns grow, paid in coins, looks only. */
describe("the paint shop", () => {
  it("opens with the first Town; colours by the biggest town's level", () => {
    const p = Progress.fresh();
    expect(paintOpen(p)).toBe(false);
    p.bestLevel = 2;
    expect(paintOpen(p)).toBe(true);
    p.coins = 1000;
    const states = () => LIVERIES.map((l) => [l.id, paintState(p, l, "")]);
    expect(states()).toEqual([
      ["red", "paint"],
      ["green", "paint"],
      ["royal", "paint"],
      ["yellow", "paint"],
      ["plum", "locked"],
      ["black", "locked"],
      ["gold", "locked"],
      ["starlight", "locked"],
    ]);
    p.bestLevel = 5;
    expect(states().every(([, s]) => s === "paint")).toBe(true);
    p.coins = 100;
    expect(paintState(p, liveryById("gold")!, "")).toBe("short");
    expect(paintState(p, liveryById("red")!, "red")).toBe("have");
    // Research waiting for coins comes first.
    p.research.next = "boilers";
    expect(paintState(p, liveryById("red")!, "")).toBe("saving");
  });

  it("paint pays and paints; as it came is free; refused when it can't", () => {
    const w = buildStarterWorld();
    const placed = w.sim.addTrain(["engine"], { pieceId: w.stations.values().next().value!, pathIndex: 0, reversed: false, s: 100 });
    expect(placed.kind).toBe("placed");
    if (placed.kind !== "placed") return;
    const car = w.sim.getTrain(placed.trainId)!.cars[0].id;
    const p = Progress.fresh();
    p.bestLevel = 2;
    p.coins = 100;
    const v = w.sim.liveriesVersion;
    expect(paint(p, w.sim, car, "gold")).toBe(false);
    expect(paint(p, w.sim, car, "red")).toBe(true);
    expect(p.coins).toBe(40);
    expect(w.sim.liveryOf(car)).toBe("red");
    expect(w.sim.liveriesVersion).toBe(v + 1);
    // The same again: refused (it has it), nothing paid.
    expect(paint(p, w.sim, car, "red")).toBe(false);
    expect(p.coins).toBe(40);
    expect(paint(p, w.sim, car, "green")).toBe(false);
    expect(paint(p, w.sim, car, "")).toBe(true);
    expect(w.sim.liveryOf(car)).toBe("");
    expect(p.coins).toBe(40);
    // Saved with the engine.
    w.sim.setLivery(car, "royal");
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value.sim.liveryOf(car)).toBe("royal");
  });

  it("a livery swaps every engine look's modelled body and trim colours, and nothing else", () => {
    for (const look of CAR_LOOKS.engine) {
      const slots = LIVERY_SLOTS[look]!;
      expect(slots, look).toBeDefined();
      const map = liveryRecolor(look, { body: "#111111", trim: "#222222" });
      for (const c of slots.body) expect(map[c]).toBe("#111111");
      for (const c of slots.trim) expect(map[c]).toBe("#222222");
      expect(Object.keys(map).length).toBe(slots.body.length + slots.trim.length);
    }
    expect(liveryOf("")).toBeNull();
    expect(liveryOf("nope")).toBeNull();
    expect(liveryOf("gold")).toMatchObject({ id: "gold" });
  });
});
