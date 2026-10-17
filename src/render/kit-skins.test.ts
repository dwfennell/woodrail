import { Color, MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { KIT_STATES, kitStateLevel, kitStatesVersion } from "../game/kit-states";
import { Sim, SIM_DT } from "../sim";
import { appendPiece, connectorRef, kitOf, Layout, type PieceTypeId } from "../track";
import { KitView } from "./kit-view";
import type { Materials } from "./materials";
import { kitModelKey, PropLibrary } from "./props/library";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

function chain(types: PieceTypeId[]): { layout: Layout; ids: number[] } {
  const layout = new Layout();
  const ids = [layout.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (let i = 1; i < types.length; i++) ids.push(appendPiece(layout, types[i], false, connectorRef(ids[i - 1], 1)));
  return { layout, ids };
}

const run = (sim: Sim, seconds: number) => {
  for (let i = Math.round(seconds / SIM_DT); i > 0; i--) sim.tick();
};

const live = (view: KitView) => view.group.children.filter((c) => c.name === "movers");
const part = (o: Object3D, name: string) => o.getObjectByName(name)!;

/** A view of `layout`'s kits, their models loaded. */
async function viewOf(layout: Layout, types: PieceTypeId[]): Promise<KitView> {
  const lib = new PropLibrary(stubMaterials());
  for (const t of types) await lib.load(kitModelKey(t));
  const view = new KitView(lib);
  view.sync(layout);
  return view;
}

describe("the \"state\" trigger: signals' aspects", () => {
  it("a signal skin's level is 0 at clear and 1 at red; the version follows the sim's aspects", () => {
    const { layout, ids } = chain(["straight-216", "kit-colour-light-signal", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const world = { sim, layout };
    const kit = kitOf("kit-colour-light-signal")!;
    sim.tick();
    expect(kitStateLevel(world, ids[1], kit)).toBe(0);
    const v = kitStatesVersion(world);
    expect(v).toBe(KIT_STATES.signal.version(world));
    sim.toggleSwitch(ids[1]);
    expect(kitStateLevel(world, ids[1], kit)).toBe(1);
    expect(kitStatesVersion(world)).toBeGreaterThan(v);
    // Nothing changes: the version stays (so the game looks at no kit).
    const w = kitStatesVersion(world);
    run(sim, 1);
    expect(kitStatesVersion(world)).toBe(w);
  });

  it("the gantry's level has a bit for each road at red", () => {
    const { layout, ids } = chain(["straight-216", "kit-signal-gantry", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    const world = { sim, layout };
    const kit = kitOf("kit-signal-gantry")!;
    sim.tick();
    // Road 0 runs on to the buffer (a clear block); road 1 ends at the gantry (no block: clear).
    expect(kitStateLevel(world, ids[1], kit)).toBe(0);
    sim.toggleSignal(ids[1], 1);
    expect(kitStateLevel(world, ids[1], kit)).toBe(2);
    sim.addTrain(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 100 });
    sim.tick();
    expect(kitStateLevel(world, ids[1], kit)).toBe(3);
  });
});

describe("signal skins drawn", () => {
  it("the colour light: green at clear (its model as baked), red at red, switched at once and then still", async () => {
    const { layout } = chain(["straight-216", "kit-colour-light-signal"]);
    const view = await viewOf(layout, ["kit-colour-light-signal"]);
    expect(view.hasMovers).toBe(true);
    // Clear: nothing live, nothing to do.
    expect(view.update(() => 0, 1 / 60)).toBe("still");
    expect(live(view)).toHaveLength(0);
    // Red: its lamps drawn live, red lit and green dark, at once.
    let level = 1;
    expect(view.update(() => level, 1 / 60)).toBe("moving");
    const lamps = live(view)[0];
    expect(lamps).toBeDefined();
    expect([part(lamps, "red").visible, part(lamps, "green").visible, part(lamps, "amber").visible]).toEqual([true, false, false]);
    // And held there: the next look is still, and nothing animates (no frame wanted).
    expect(view.update(() => level, 1 / 60)).toBe("still");
    expect(view.animating).toBe(false);
    for (let i = 0; i < 10; i++) expect(view.update(() => level, 1 / 60)).toBe("still");
    // Clear again: back to its whole model at once, the live lamps gone.
    level = 0;
    expect(view.update(() => level, 1 / 60)).toBe("changed");
    expect(live(view)).toHaveLength(0);
  });

  it("the semaphore: its arm drops level at red, easing, and rises again to clear", async () => {
    const { layout } = chain(["straight-216", "kit-semaphore-signal"]);
    const view = await viewOf(layout, ["kit-semaphore-signal"]);
    let level = 1;
    const steps: string[] = [];
    for (let i = 0; i < 60; i++) steps.push(view.update(() => level, 1 / 60));
    const arm = part(live(view)[0], "arm");
    expect(arm.rotation.x).toBeCloseTo(0, 6);
    expect(steps[0]).toBe("moving");
    expect(steps.at(-1)).toBe("still");
    level = 0;
    steps.length = 0;
    for (let i = 0; i < 60; i++) steps.push(view.update(() => level, 1 / 60));
    expect(steps).toContain("changed");
    expect(steps.at(-1)).toBe("still");
    expect(live(view)).toHaveLength(0);
  });

  it("the gantry: each head over its own road shows that road's aspect", async () => {
    const { layout } = chain(["straight-216", "kit-signal-gantry"]);
    const view = await viewOf(layout, ["kit-signal-gantry"]);
    // Road 1 at red only (level 2).
    view.update(() => 2, 1 / 60);
    const heads = live(view)[0];
    // Turned onto its piece, the model's head 0 is over road 1, its head 1 over road 0.
    expect([part(heads, "r0").visible, part(heads, "g0").visible]).toEqual([true, false]);
    expect([part(heads, "r1").visible, part(heads, "g1").visible]).toEqual([false, true]);
    view.update(() => 1, 1 / 60);
    expect([part(heads, "r0").visible, part(heads, "g0").visible]).toEqual([false, true]);
    expect([part(heads, "r1").visible, part(heads, "g1").visible]).toEqual([true, false]);
  });

  it("a skin's model is tapped as its piece: its drawing's instance, or its live parts", async () => {
    const { layout, ids } = chain(["straight-216", "kit-colour-light-signal"]);
    const view = await viewOf(layout, ["kit-colour-light-signal"]);
    view.update(() => 1, 1 / 60);
    const lamps = live(view)[0];
    let mesh: Object3D | null = null;
    lamps.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) mesh ??= o;
    });
    expect(view.pieceAt(mesh!, undefined)).toBe(ids[1]);
  });
});

describe("the buffer-stop lamp", () => {
  it("a train runs up to it and turns back, as at a plain buffer; its lamp lights while the train stands there", async () => {
    const plain = chain(["straight-216", "straight-216", "buffer"]);
    const lamp = chain(["straight-216", "straight-216", "kit-buffer-stop-lamp"]);
    const at: { s: number; piece: number }[] = [];
    for (const { layout, ids } of [plain, lamp]) {
      const sim = new Sim(layout);
      const r = sim.addTrain(["engine"], { pieceId: ids[0], pathIndex: 0, reversed: false, s: 100 });
      if (r.kind !== "placed") throw new Error();
      sim.setLever(sim.getTrain(r.trainId)!.cars[0].id, 1);
      // Up to the buffer, where it stands a moment before turning back.
      let standing = -1;
      for (let i = 0; i < 6 / SIM_DT && standing === -1; i++) {
        sim.tick();
        const t = sim.getTrain(sim.trainIds()[0])!;
        if (t.speed === 0 && sim.pieceOccupied(ids[2])) standing = t.bogies[0].s;
      }
      at.push({ s: standing, piece: ids[2] });
      if (layout === lamp.layout) {
        expect(sim.pieceOccupied(ids[2])).toBe(true);
        const view = await viewOf(layout, ["kit-buffer-stop-lamp"]);
        const trigger = (id: number) => sim.pieceOccupied(id);
        for (let i = 0; i < 30; i++) view.update(trigger, 1 / 60);
        expect(part(live(view)[0], "lamp").visible).toBe(true);
        // Settled: lit and still (nothing to draw while the train stands).
        expect(view.update(trigger, 1 / 60)).toBe("still");
        // The train goes: the lamp goes out, and its live part with it.
        for (const id of sim.trainIds()) sim.removeTrain(id);
        for (let i = 0; i < 30; i++) view.update(trigger, 1 / 60);
        expect(live(view)).toHaveLength(0);
      }
    }
    // Stood where it stands at a plain buffer.
    expect(at[1].s).toBeGreaterThan(0);
    expect(at[1].s).toBeCloseTo(at[0].s, 6);
  });
});
