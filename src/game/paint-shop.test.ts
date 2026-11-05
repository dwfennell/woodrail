import { describe, expect, it } from "vitest";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Box3, type Material } from "three";
import type { Materials } from "../render/materials";
import { addStripes, liveryRecolor, LIVERY_SLOTS } from "../render/train-models";
import { CAR_LOOKS } from "../sim/cars";
import { LINING, LIVERIES, liveryById, liveryOf, paint, paintOpen, paintState, RAINBOW } from "./paint-shop";
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
      ["lining", "locked"],
      ["gold", "locked"],
      ["starlight", "locked"],
      ["rainbow", "locked"],
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

  it("Lined (a City's, 80🪙) and Rainbow (City ★★'s, 600🪙) carry a painted stripe; the others none", () => {
    expect(liveryById("lining")).toMatchObject({ stripe: "lining", price: 80, level: 3 });
    expect(liveryById("rainbow")).toMatchObject({ stripe: "rainbow", price: 600, level: 5 });
    expect(liveryOf("lining")!.stripes).toEqual([LINING]);
    expect(liveryOf("rainbow")!.stripes).toEqual(RAINBOW);
    expect(RAINBOW).toHaveLength(6);
    for (const l of LIVERIES.filter((x) => x.id !== "lining" && x.id !== "rainbow")) expect(liveryOf(l.id)!.stripes, l.id).toBeUndefined();
    // Saved on the engine like any livery.
    const w = buildStarterWorld();
    const placed = w.sim.addTrain(["engine"], { pieceId: w.stations.values().next().value!, pathIndex: 0, reversed: false, s: 100 });
    if (placed.kind !== "placed") throw new Error("no room");
    const car = w.sim.getTrain(placed.trainId)!.cars[0].id;
    const p = Progress.fresh();
    p.bestLevel = 5;
    p.coins = 700;
    expect(paint(p, w.sim, car, "rainbow")).toBe(true);
    expect(p.coins).toBe(100);
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
    if (back.ok) expect(back.value.sim.liveryOf(car)).toBe("rainbow");
  });

  it("the stripe: a band of its colours along both sides of each body panel big enough, at its middle and widest", () => {
    const cache = new Map<string, Material>();
    const mats = { lacquer: (c: string) => cache.get(c) ?? (cache.set(c, new MeshStandardMaterial({ color: c })), cache.get(c)!) } as unknown as Materials;
    const body = mats.lacquer("#f6f3ec");
    const root = new Group();
    // A cab (a box, 30 long, 20 high, 28 wide), a boiler (a cylinder along x), a dome too small, and a black chassis.
    const cab = new Mesh(new BoxGeometry(30, 20, 28), body);
    cab.position.set(-20, 30, 0);
    const boiler = new Mesh(new CylinderGeometry(10, 10, 40, 16).rotateZ(Math.PI / 2), body);
    boiler.position.set(15, 26, 0);
    const dome = new Mesh(new BoxGeometry(6, 6, 6), body);
    const chassis = new Mesh(new BoxGeometry(80, 6, 30), mats.lacquer("#2a2b2e"));
    root.add(cab, boiler, dome, chassis);
    expect(addStripes(root, mats, [body], RAINBOW)).toBe(6);
    const stripes = root.children.filter((o) => o.name === "livery-stripe") as Mesh[];
    expect(stripes.map((m) => m.material)).toEqual(RAINBOW.map((c) => mats.lacquer(c)));
    // Each colour: a band on each side of the cab and of the boiler (4 boxes), none on the dome or chassis.
    for (const m of stripes) {
      const box = new Box3().setFromObject(m);
      expect(box.max.z).toBeGreaterThan(14);
      expect(box.min.z).toBeLessThan(-14);
      expect(box.max.z).toBeLessThan(14.6);
      expect(box.min.x).toBeGreaterThan(-36);
      expect(box.max.x).toBeLessThan(36);
      // (Two panels, two sides, a box each: 24 vertices a box.)
      expect(m.geometry.getAttribute("position").count).toBe(4 * 24);
    }
    // Top to bottom in the rainbow's order, about the panels' middle height.
    const ys = stripes.map((m) => new Box3().setFromObject(m).getCenter(new Box3().min).y);
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1]);
    // Lined: one gold band.
    const plain = new Group();
    plain.add(new Mesh(new BoxGeometry(30, 20, 28), body));
    expect(addStripes(plain, mats, [body], [LINING])).toBe(1);
    // Nothing body-coloured: nothing added.
    expect(addStripes(new Group(), mats, [body], [LINING])).toBe(0);
  });
});
