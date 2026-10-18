import { Color, MeshStandardMaterial, PerspectiveCamera } from "three";
import { describe, expect, it } from "vitest";
import { Sim, SIM_HZ } from "../sim";
import { Layout, LIFT_RISE, LIFT_SECONDS } from "../track";
import { KitView } from "./kit-view";
import type { Materials } from "./materials";
import { kitModelKey, PropLibrary } from "./props/library";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

describe("KitView's moving parts", () => {
  it("a kit at rest is drawn whole; triggered, its parts are drawn live; let go, they settle and go", async () => {
    const lib = new PropLibrary(stubMaterials());
    await lib.load(kitModelKey("kit-castle-gate"));
    expect(lib.model(kitModelKey("kit-castle-gate", true))).toBeTruthy();
    expect(lib.moversOf("kit-castle-gate")).toBeDefined();
    const layout = new Layout();
    const gate = layout.addPiece("kit-castle-gate", { x: 100, z: 50, heading: 0.5 });
    layout.addPiece("kit-platform-furnished", { x: -300, z: 0, heading: 0 });
    const view = new KitView(lib);
    view.sync(layout);
    expect(view.hasMovers).toBe(true);
    const liveGroups = () => view.group.children.filter((c) => c.name === "movers").length;
    expect(liveGroups()).toBe(0);
    // Nothing triggered: nothing done.
    expect(view.update(() => false, 1 / 60)).toBe("still");
    expect(view.animating).toBe(false);
    // A train on it: the portcullis rises, drawn live where the piece stands.
    let trains = true;
    const asked: number[] = [];
    const on = (id: number) => (asked.push(id), trains);
    expect(view.update(on, 1 / 60)).toBe("moving");
    // Only the moving kit is asked about (not the platform).
    expect(new Set(asked)).toEqual(new Set([gate]));
    expect(liveGroups()).toBe(1);
    const live = view.group.children.find((c) => c.name === "movers")!;
    expect(live.position.x).toBe(100);
    expect(live.rotation.y).toBeCloseTo(-0.5);
    expect(view.animating).toBe(true);
    let results: string[] = [];
    for (let i = 0; i < 120; i++) results.push(view.update(on, 1 / 60));
    // Risen and holding: still, nothing to draw while the train's under it.
    expect(results.at(-1)).toBe("still");
    expect(view.animating).toBe(false);
    const portcullis = live.getObjectByName("portcullis")!;
    expect(portcullis.position.y).toBeCloseTo(64, 3);
    // The train's gone: it drops, then the live parts go and the whole model is drawn again.
    trains = false;
    results = [];
    for (let i = 0; i < 120; i++) results.push(view.update(on, 1 / 60));
    expect(results[0]).toBe("moving");
    expect(results).toContain("changed");
    expect(results.at(-1)).toBe("still");
    expect(liveGroups()).toBe(0);
    expect(view.animating).toBe(false);
  });

  it("paused, a triggered kit holds where it is; out of view, it moves on unseen and asks for no frames", async () => {
    const lib = new PropLibrary(stubMaterials());
    await lib.load(kitModelKey("kit-castle-gate"));
    const layout = new Layout();
    layout.addPiece("kit-castle-gate", { x: 100, z: 50, heading: 0 });
    const view = new KitView(lib);
    view.sync(layout);
    const camera = new PerspectiveCamera(50, 390 / 844, 10, 100000);
    const look = (x: number, z: number) => {
      camera.position.set(x, 900, z + 700);
      camera.lookAt(x, 0, z);
      camera.updateMatrixWorld();
    };
    look(100, 50);
    expect(view.update(() => true, 1 / 30, false, camera)).toBe("moving");
    const portcullis = view.group.children.find((c) => c.name === "movers")!.getObjectByName("portcullis")!;
    const y = portcullis.position.y;
    // Paused: nothing moves, nothing to draw.
    for (let i = 0; i < 60; i++) expect(view.update(() => true, 1 / 30, true, camera)).toBe("still");
    expect(portcullis.position.y).toBe(y);
    // Running, out of view: it rises unseen, drawing nothing.
    look(30000, 30000);
    expect(view.update(() => true, 1 / 30, false, camera)).toBe("still");
    expect(portcullis.position.y).toBeGreaterThan(y);
    // In view again: it's drawn moving.
    look(100, 50);
    expect(view.update(() => true, 1 / 30, false, camera)).toBe("moving");
  });
});

describe("KitView's decks (kits that move with their state)", () => {
  it("a turntable's deck is drawn live from the start, stands as its state says, and glides the same way round", async () => {
    const lib = new PropLibrary(stubMaterials());
    await lib.load(kitModelKey("kit-turntable"));
    const layout = new Layout();
    const id = layout.addPiece("kit-turntable", { x: 0, z: 0, heading: 0 });
    // Loaded turned three roads round: it stands there at once (no glide).
    layout.setSwitchState(id, 3);
    const view = new KitView(lib);
    view.sync(layout);
    const live = view.group.children.find((c) => c.name === "movers")!;
    expect(live).toBeDefined();
    const deck = live.getObjectByName("deck")!;
    expect(deck.rotation.y).toBeCloseTo((-3 * Math.PI) / 4);
    expect(view.animating).toBe(false);
    // Tapped (as a switch's lever), it turns to the next: the same way round, half a turn on from the first.
    deck.traverse((o) => expect(o.userData).toMatchObject({ kind: "switch-lever", pieceId: id, deck: true }));
    expect(view.update(() => false, 1 / 60)).toBe("still");
    layout.setSwitchState(id, 0);
    expect(view.update(() => false, 1 / 60)).toBe("moving");
    expect(view.animating).toBe(true);
    let last = "";
    let prev = deck.rotation.y;
    for (let i = 0; i < 240 && view.animating; i++) {
      last = view.update(() => false, 1 / 60);
      // Always the same way round (a model's turn is the other way to a heading).
      expect(deck.rotation.y).toBeLessThanOrEqual(prev + 1e-9);
      prev = deck.rotation.y;
    }
    expect(last).toBe("moving");
    expect(view.animating).toBe(false);
    expect(deck.rotation.y).toBeCloseTo(-Math.PI);
    // Done: nothing more to do till it's tapped again.
    expect(view.update(() => false, 1 / 60)).toBe("still");
  });

  it("a transfer table's deck slides back and forth across its roads", async () => {
    const lib = new PropLibrary(stubMaterials());
    await lib.load(kitModelKey("kit-transfer-table"));
    const layout = new Layout();
    const id = layout.addPiece("kit-transfer-table", { x: 0, z: 0, heading: 0 });
    const view = new KitView(lib);
    view.sync(layout);
    const deck = view.group.children.find((c) => c.name === "movers")!.getObjectByName("deck")!;
    for (const [state, l] of [
      [1, 60],
      [2, -60],
      [0, 0],
    ]) {
      layout.setSwitchState(id, state);
      for (let i = 0; i < 300; i++) view.update(() => false, 1 / 60);
      expect(view.animating).toBe(false);
      expect(deck.position.z).toBeCloseTo(l);
    }
  });
});

describe("KitView's train lift (a kit whose state is a ride)", () => {
  /** A lift with an engine on its platform, its view following the sim's ride, and a camera on it (or away). */
  async function setup() {
    const lib = new PropLibrary(stubMaterials());
    await lib.load(kitModelKey("kit-train-lift"));
    const layout = new Layout();
    const lift = layout.addPiece("kit-train-lift", { x: 0, z: 0, heading: 0 });
    const sim = new Sim(layout);
    expect(sim.addTrain(["engine"], { pieceId: lift, pathIndex: 0, reversed: false, s: 200 }).kind).toBe("placed");
    const view = new KitView(lib);
    view.ridePosition = (id) => sim.liftPosition(id);
    view.sync(layout);
    const platform = view.group.children.find((c) => c.name === "movers")!.getObjectByName("lift")!;
    const camera = new PerspectiveCamera(50, 390 / 844, 10, 100000);
    const look = (x: number, z: number) => {
      camera.position.set(x, 900, z + 700);
      camera.lookAt(x, 0, z);
      camera.updateMatrixWorld();
    };
    look(144, 0);
    /** As the game's frame loop asks: only when the sim's ride moved on, or the view says it's still animating. */
    let seen = sim.ridesVersion;
    const frame = (paused = false) => {
      if (!paused) sim.tick();
      if (sim.ridesVersion === seen && !view.animating) return "not asked";
      seen = sim.ridesVersion;
      return view.update(() => false, 1 / 120, paused, camera);
    };
    return { layout, sim, lift, view, platform, look, frame };
  }

  it("still, it's never asked and draws nothing; riding, it's drawn moving with the sim's ride, up to the top", async () => {
    const w = await setup();
    expect(w.platform.position.y).toBe(0);
    // Still: no frames asked for at all (30 s of ticks).
    const still = new Set<string>();
    for (let i = 0; i < 30 * SIM_HZ; i++) still.add(w.frame());
    expect(still).toEqual(new Set(["not asked"]));
    expect(w.view.animating).toBe(false);
    // Sent up: drawn moving every tick it rises, never down, then still at the top.
    expect(w.sim.toggleSwitch(w.lift)).toBe(true);
    const seen: string[] = [];
    let last = 0;
    for (let i = 0; i < (LIFT_SECONDS + 1) * SIM_HZ; i++) {
      seen.push(w.frame());
      expect(w.platform.position.y).toBeGreaterThanOrEqual(last);
      last = w.platform.position.y;
    }
    expect(seen.slice(0, LIFT_SECONDS * SIM_HZ - 1).every((r) => r === "moving")).toBe(true);
    expect(seen.at(-1)).toBe("not asked");
    expect(w.platform.position.y).toBeCloseTo(LIFT_RISE, 6);
    // The engine's drawn up there with it.
    expect(w.sim.getTrain(w.sim.trainIds()[0])!.world[0].y).toBeCloseTo(LIFT_RISE, 6);
  });

  it("paused mid-ride, it holds and asks for no frames; off screen it moves on unseen; back in view it's drawn", async () => {
    const w = await setup();
    expect(w.sim.toggleSwitch(w.lift)).toBe(true);
    for (let i = 0; i < SIM_HZ; i++) w.frame();
    const y = w.platform.position.y;
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(LIFT_RISE);
    // Paused (30 s): no frames, the platform where it was.
    const paused = new Set<string>();
    for (let i = 0; i < 30 * SIM_HZ; i++) paused.add(w.frame(true));
    expect(paused).toEqual(new Set(["not asked"]));
    expect(w.platform.position.y).toBe(y);
    // Running again, off screen: it carries on rising, asking for no frame.
    w.look(30000, 30000);
    expect(w.frame()).toBe("still");
    expect(w.platform.position.y).toBeGreaterThan(y);
    // In view again: drawn moving.
    w.look(144, 0);
    expect(w.frame()).toBe("moving");
  });
});
