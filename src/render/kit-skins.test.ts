import { Color, MeshStandardMaterial, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { Sim, SIM_DT } from "../sim";
import { appendPiece, connectorRef, kitForAsset, kitOf, Layout, type PieceTypeId } from "../track";
import { KIT_MOTIONS } from "./kit-motions";
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
async function viewOf(layout: Layout, types: PieceTypeId[], signals?: (id: number) => number): Promise<KitView> {
  const lib = new PropLibrary(stubMaterials());
  for (const t of types) await lib.load(kitModelKey(t));
  const view = new KitView(lib);
  if (signals) view.signalState = signals;
  view.sync(layout);
  return view;
}

describe("signal skins' state: their signals' aspects", () => {
  it("Sim.redSignals: 0 at clear, a bit for each road at red; it changes only with signalsVersion", () => {
    const { layout, ids } = chain(["straight-216", "kit-colour-light-signal", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    sim.tick();
    expect(sim.redSignals(ids[1])).toBe(0);
    const v = sim.signalsVersion;
    sim.toggleSwitch(ids[1]);
    expect(sim.redSignals(ids[1])).toBe(1);
    expect(sim.signalsVersion).toBeGreaterThan(v);
    // Nothing changes: the version stays (so the game looks at no kit).
    const w = sim.signalsVersion;
    run(sim, 1);
    expect(sim.signalsVersion).toBe(w);
    // Not a signal: 0.
    expect(sim.redSignals(ids[0])).toBe(0);
  });

  it("the gantry's: a bit for each road at red", () => {
    const { layout, ids } = chain(["straight-216", "kit-signal-gantry", "straight-216", "buffer"]);
    const sim = new Sim(layout);
    sim.tick();
    expect(sim.redSignals(ids[1])).toBe(0);
    sim.toggleSignal(ids[1], 1);
    expect(sim.redSignals(ids[1])).toBe(2);
    sim.addTrain(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 100 });
    sim.tick();
    expect(sim.redSignals(ids[1])).toBe(3);
  });

  it("the signal skins' motions follow the signals (not the switch states), the lamps at once", () => {
    for (const asset of ["mech-semaphore-signal", "mech-colour-light-signal", "mech-signal-gantry"]) {
      expect(KIT_MOTIONS[asset].state?.source, asset).toBe("signals");
      expect(kitOf(kitForAsset(asset)!)!.moves, asset).toBe("state");
    }
    expect(KIT_MOTIONS["mech-colour-light-signal"].state!.glide).toBe(0);
    expect(KIT_MOTIONS["mech-signal-gantry"].state!.glide).toBe(0);
    // The turntable's still follows its switch state.
    expect(KIT_MOTIONS["mech-turntable"].state?.source ?? "switches").toBe("switches");
  });
});

describe("signal skins drawn", () => {
  it("the colour light: green at clear, red at red, switched at once, then still", async () => {
    const { layout, ids } = chain(["straight-216", "kit-colour-light-signal"]);
    let red = 0;
    const view = await viewOf(layout, ["kit-colour-light-signal"], () => red);
    const lamps = live(view)[0];
    expect([part(lamps, "red").visible, part(lamps, "green").visible, part(lamps, "amber").visible]).toEqual([false, true, false]);
    // Nothing changed: still.
    expect(view.update(() => false, 1 / 60)).toBe("still");
    // Red: red lit and green dark, in the one update.
    red = 1;
    expect(view.update(() => false, 1 / 60)).toBe("moving");
    expect([part(lamps, "red").visible, part(lamps, "green").visible, part(lamps, "amber").visible]).toEqual([true, false, false]);
    // And held there: nothing animates (no frame wanted).
    expect(view.animating).toBe(false);
    for (let i = 0; i < 10; i++) expect(view.update(() => false, 1 / 60)).toBe("still");
    red = 0;
    view.update(() => false, 1 / 60);
    expect([part(lamps, "red").visible, part(lamps, "green").visible]).toEqual([false, true]);
    // Tapped, its parts are its signal's (not a deck's lever).
    let mesh: Object3D | null = null;
    lamps.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) mesh ??= o;
    });
    expect(view.pieceAt(mesh!, undefined)).toBe(ids[1]);
    expect((mesh as unknown as Object3D).userData.deck).toBeUndefined();
  });

  it("the semaphore: its arm drops level at red, gliding, and rises again to clear", async () => {
    const { layout } = chain(["straight-216", "kit-semaphore-signal"]);
    let red = 0;
    const view = await viewOf(layout, ["kit-semaphore-signal"], () => red);
    const arm = part(live(view)[0], "arm");
    expect(arm.rotation.x).toBeCloseTo(0.7, 6);
    red = 1;
    const steps: string[] = [];
    for (let i = 0; i < 60; i++) steps.push(view.update(() => false, 1 / 60));
    expect(arm.rotation.x).toBeCloseTo(0, 6);
    expect(steps[0]).toBe("moving");
    expect(steps.at(-1)).toBe("still");
    red = 0;
    for (let i = 0; i < 60; i++) view.update(() => false, 1 / 60);
    expect(arm.rotation.x).toBeCloseTo(0.7, 6);
  });

  it("the gantry: each head over its own road shows that road's aspect", async () => {
    const { layout } = chain(["straight-216", "kit-signal-gantry"]);
    let red = 2;
    const view = await viewOf(layout, ["kit-signal-gantry"], () => red);
    const heads = live(view)[0];
    // Road 1 at red only. Turned onto its piece, the model's head 0 is over road 1, its head 1 over road 0.
    expect([part(heads, "r0").visible, part(heads, "g0").visible]).toEqual([true, false]);
    expect([part(heads, "r1").visible, part(heads, "g1").visible]).toEqual([false, true]);
    red = 1;
    view.update(() => false, 1 / 60);
    expect([part(heads, "r0").visible, part(heads, "g0").visible]).toEqual([false, true]);
    expect([part(heads, "r1").visible, part(heads, "g1").visible]).toEqual([true, false]);
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
