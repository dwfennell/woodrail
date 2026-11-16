import { Box3, Color, Group, MeshStandardMaterial, PerspectiveCamera, Quaternion, Vector3, type Mesh, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { CARGO, Economy } from "../economy";
import { Sim, SIM_DT } from "../sim";
import { Layout } from "../track";
import { Editor } from "../editor/editor";
import { planUpgrade, upgradeLand, UPGRADE_UNDO_REFUSED, type StationUpgrade, type UpgradePlan } from "../game/station-upgrade";
import { buildStarterWorld, syncIndustries } from "../game/world";
import { LandEditor } from "../landscape/edit";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { DepotView, siteLayout } from "./depot-view";
import { AmbientEye } from "./ambient";
import { cullTiles, detailReach, viewReach } from "./dressing/tiles";
import type { Materials } from "./materials";

/** Plain stand-ins for the game's materials (theirs need a canvas for textures). */
function stubMaterials(): Materials {
  const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
  const lacquer = (c: string) => m(c);
  return new Proxy({ lacquer } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
}

/** A sawmill with logs to cut (so it's working), a train far off, drawn by a DepotView; a camera looking at it, or away. */
function world() {
  const layout = new Layout();
  const at = layout.addPiece("depot-sawmill", { x: 0, z: 0, heading: 0 });
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const saw = economy.addDepot("sawmill", at);
  saw.piles[CARGO.log.index] = 6;
  // A train far off, so the planks have somewhere to go (with none on the map, industries stand still).
  sim.addTrain(["engine"], { pieceId: layout.addPiece("straight-216", { x: 0, z: 90000, heading: 0 }), pathIndex: 0, reversed: false, s: 100 });
  const view = new DepotView(stubMaterials());
  view.setWorld(economy, layout);
  const camera = new PerspectiveCamera(50, 390 / 844, 10, 100000);
  const look = (x: number, z: number) => {
    camera.position.set(x, 900, z + 700);
    camera.lookAt(x, 0, z);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  };
  look(108, 60);
  return { economy, saw, view, camera, look };
}

/**
 * The game's loop, as far as depots go (`Game.frame`): the sim runs unless paused, the view is updated, and a frame
 * is drawn (culling what's out of view first) only if the view asked for one. Frames drawn over `seconds`.
 */
function run(w: ReturnType<typeof world>, seconds: number, paused: boolean, clock: { sim: number }): number {
  let drawn = 0;
  const reach = viewReach(1100);
  for (let f = 0; f < seconds * 30; f++) {
    if (!paused)
      for (let k = 0; k < 4; k++) {
        w.economy.tick();
        clock.sim += SIM_DT;
      }
    const r = w.view.update(w.economy, [], 0, () => undefined, clock.sim, paused);
    if (r === "still") continue;
    cullTiles([w.view.group], w.camera, reach, detailReach(1100));
    drawn++;
  }
  return drawn;
}

describe("DepotView: a working depot draws only while the game runs and it's in view", () => {
  it("paused, a working sawmill asks for no frames, and its saw holds still", () => {
    const w = world();
    const clock = { sim: 0 };
    run(w, 1, false, clock); // drawn once, in view
    expect(w.economy.working(w.saw)).toBe(true);
    const turn = (o: { quaternion: Quaternion }) => o.quaternion.clone();
    const saws = w.view.group.children.filter((o) => o.userData.depotMoving);
    const before = saws.map(turn);
    expect(run(w, 30, true, clock)).toBe(0);
    expect(saws.map(turn).every((q, i) => q.equals(before[i]))).toBe(true);
    // Resumed: it turns on, and asks for frames.
    expect(run(w, 1, false, clock)).toBeGreaterThan(20);
    expect(saws.map(turn).some((q, i) => !q.equals(before[i]))).toBe(true);
  });

  it("running, a working sawmill in view keeps drawing; out of view it draws (about) nothing", () => {
    const w = world();
    const clock = { sim: 0 };
    expect(run(w, 2, false, clock)).toBe(60);
    // The camera looks far away: the move draws (culling the sawmill's moving parts), then nothing more.
    w.look(30000, 30000);
    w.view.update(w.economy, [], 0, () => undefined, clock.sim, false);
    cullTiles([w.view.group], w.camera, viewReach(1100), detailReach(1100));
    expect(w.economy.working(w.saw)).toBe(true);
    // 30 s off screen with the trains stopped: the logs it cuts (one every 8 s) change its piles unseen, drawn nothing.
    const logs = w.saw.piles[CARGO.log.index];
    expect(run(w, 30, false, clock)).toBe(0);
    expect(w.saw.piles[CARGO.log.index]).toBeLessThan(logs);
    expect(w.view.update(w.economy, [], 0, () => undefined, clock.sim + SIM_DT, false)).toBe("still");
    // Back in view: the camera move draws, and from the next frame it animates again.
    w.look(108, 60);
    cullTiles([w.view.group], w.camera, viewReach(1100), detailReach(1100));
    expect(w.view.update(w.economy, [], 0, () => undefined, clock.sim + 2 * SIM_DT, false)).toBe("moving");
    expect(run(w, 1, false, clock)).toBe(30);
  });

  it("zoomed out, a working sawmill in view but too small to see its saw turn asks for no frames (the ambient rule)", () => {
    const w = world();
    const clock = { sim: 0 };
    // Far above it (about 6.5 m off), still within the crane's reach and in view: its saw is a few pixels across.
    w.camera.position.set(108, 4600, 4600);
    w.camera.lookAt(108, 0, 60);
    w.camera.updateMatrixWorld();
    cullTiles([w.view.group], w.camera, viewReach(6500), detailReach(6500));
    const eye = new AmbientEye();
    eye.set(w.camera, 844);
    const saw = w.view.group.children.find((o) => o.userData.depotMoving)!;
    expect(saw.visible).toBe(true);
    expect(w.economy.working(w.saw)).toBe(true);
    // Without the rule it would draw every frame; with it, none (and the saw still turns by the game's time, unseen).
    const tick = () => {
      for (let k = 0; k < 4; k++) {
        w.economy.tick();
        clock.sim += SIM_DT;
      }
    };
    // (The first update starts its clock.)
    w.view.update(w.economy, [], 0, () => undefined, clock.sim, false);
    tick();
    expect(w.view.update(w.economy, [], 0, () => undefined, clock.sim, false)).toBe("moving");
    let asked = 0;
    for (let f = 0; f < 60; f++) {
      tick();
      if (w.view.update(w.economy, [], 0, () => undefined, clock.sim, false, false, eye) !== "still") asked++;
    }
    expect(asked).toBe(0);
    // Close in again: it asks for frames, and only for ambient motion (drawn at the ambient rate).
    w.look(108, 60);
    eye.set(w.camera, 844);
    tick();
    expect(w.view.update(w.economy, [], 0, () => undefined, clock.sim, false, false, eye)).toBe("moving");
    expect(w.view.ambientOnly).toBe(true);
  });

  it("the saw turns by the game's time, not by frames", () => {
    const w = world();
    const saws = w.view.group.children.filter((o) => o.userData.depotMoving);
    w.view.update(w.economy, [], 0, () => undefined, 10, false);
    const q0 = saws.map((o) => o.quaternion.clone());
    // Many frames, the same game time: nothing turns.
    for (let i = 0; i < 20; i++) w.view.update(w.economy, [], 0, () => undefined, 10, false);
    expect(saws.every((o, i) => o.quaternion.equals(q0[i]))).toBe(true);
    // Half a second of game time in one frame or in many: the same turn.
    const a = world();
    const b = world();
    const sa = a.view.group.children.filter((o) => o.userData.depotMoving);
    const sb = b.view.group.children.filter((o) => o.userData.depotMoving);
    a.view.update(a.economy, [], 0, () => undefined, 0, false);
    b.view.update(b.economy, [], 0, () => undefined, 0, false);
    a.view.update(a.economy, [], 0, () => undefined, 0.5, false);
    for (let i = 1; i <= 50; i++) b.view.update(b.economy, [], 0, () => undefined, i * 0.01, false);
    for (let i = 0; i < sa.length; i++) expect(sa[i].quaternion.angleTo(sb[i].quaternion)).toBeLessThan(1e-6);
  });
});

describe("DepotView.depotAt: a tap on a depot's yard or buildings means that depot (QA: the workshop's far end went to the town beside it)", () => {
  for (const heading of [0, Math.PI / 3]) {
    it(`by the yard it's on, its far end too (heading ${heading.toFixed(2)})`, () => {
      const layout = new Layout();
      const at = layout.addPiece("depot-workshop", { x: 500, z: -300, heading });
      const economy = new Economy(layout, new Sim(layout));
      const shop = economy.addDepot("workshop", at);
      const view = new DepotView(stubMaterials());
      view.setWorld(economy, layout);
      // In the site's frame (t along the track, l across): the yard runs t 10..206, l 30..114.
      const world = (t: number, l: number) => ({ x: 500 + Math.cos(heading) * t - Math.sin(heading) * l, z: -300 + Math.sin(heading) * t + Math.cos(heading) * l });
      for (const [t, l] of [[190, 100], [200, 40], [20, 110], [108, 72]]) {
        const p = world(t, l);
        expect(view.depotAt(p.x, p.z), `t ${t}, l ${l}`).toBe(shop.id);
      }
      const off = world(108, 200);
      expect(view.depotAt(off.x, off.z)).toBe(-1);
    });
  }
});

describe("DepotView: a crane setting down a good its yard has a pile for or not (QA: iron or stone into a workshop threw)", () => {
  const cases: [string, "workshop" | "town", "iron" | "stone"][] = [
    ["a workshop's iron", "workshop", "iron"],
    ["a workshop's stone (a harbour's, owed)", "workshop", "stone"],
    ["a town's iron (no pile for it on the platform)", "town", "iron"],
  ];
  for (const [name, role, kind] of cases) {
    it(`${name}: unloaded with the view drawing, nothing throws`, () => {
      const layout = new Layout();
      const ids = ["straight-216", "straight-216", "depot-workshop", "straight-216", "straight-216"].map((t, i) => layout.addPiece(t as "straight-216", { x: i * 216, z: 0, heading: 0 }));
      const sim = new Sim(layout);
      const placed = sim.addTrain(["engine", kind === "iron" ? "timber" : "hopper"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
      if (placed.kind !== "placed") throw new Error("no room");
      const economy = new Economy(layout, sim);
      const d = economy.addDepot(role, ids[2], role === "town" ? 0 : -1);
      economy.owes = () => 3;
      const train = sim.getTrain(placed.trainId)!;
      const wagon = train.cars[1].id;
      economy.setCargo(wagon, kind, 3);
      sim.setLever(train.cars[0].id, 1);
      const view = new DepotView(stubMaterials());
      view.setWorld(economy, layout);
      for (let i = 0; i < 60 * 120; i++) {
        sim.tick();
        economy.tick();
        if (i % 4 === 0) view.update(economy, [], 0, () => undefined, i * SIM_DT, false);
      }
      expect(economy.cargoOf(wagon).count).toBe(0);
      if (role === "workshop") expect(d.piles[CARGO[kind].index]).toBe(3);
    });
  }
});

describe("DepotView: a town's station upgraded in place keeps its goods crane (the station-upgrade follow-up)", () => {
  for (const type of ["kit-two-platform-station", "kit-grand-terminus"] as StationUpgrade[]) {
    it(`${type}: the crane on the kit's first platform at the same stop; only that station drawn again; saved and loaded; undo`, () => {
      const w = buildStarterWorld(true);
      syncIndustries(w, true);
      const checker = new LandEditor(w.landscape, w.layout);
      // (The drop rule stood in for by the land's, as in station-upgrade.test.ts: the game's full rule is in the e2e.)
      const plan = w.landscape.towns.map((t) => planUpgrade(w, t.id, type, checker, () => null)).find((p): p is UpgradePlan => typeof p !== "string");
      expect(plan).toBeDefined();
      if (!plan) return;
      const view = new DepotView(stubMaterials());
      view.setWorld(w.economy, w.layout);
      const depot = w.economy.depotAtPiece(plan.stationId)!;
      const before = view.craneOf(depot.id)!;
      expect(before.drawn).toBe("station");
      expect(before.l).toBeGreaterThan(0);
      const others = w.economy.allDepots().filter((d) => d !== depot).map((d) => [d.id, view.craneOf(d.id)?.trolley] as const);
      const children = view.group.children.length;
      expect(view.syncStations(w.economy, w.layout)).toBe(false);

      // Upgraded, as the town card does it (`upgradeStation` in main.ts): the land, then the retype as one undo step.
      const editor = new Editor(w.layout, w.sim, () => {}, (id) => id === plan.stationId);
      const land = upgradeLand(w, plan);
      land.do();
      expect(editor.retype(plan.stationId, type, land, UPGRADE_UNDO_REFUSED)).toBe(true);
      expect(view.syncStations(w.economy, w.layout)).toBe(true);
      const after = view.craneOf(depot.id)!;
      // The same crane at the same place along the track (wagons stop where they did), across the line on the kit's
      // first platform, where its people wait.
      expect(after.drawn).toBe(type);
      expect(after.t).toBe(before.t);
      expect(after.l).toBe(-before.l);
      expect(before.trolley.parent).toBeNull();
      expect(after.trolley.parent).toBe(view.group);
      // No other site drawn again, and nothing left behind.
      for (const [id, trolley] of others) expect(view.craneOf(id)?.trolley).toBe(trolley);
      expect(view.group.children.length).toBe(children);
      expect(view.syncStations(w.economy, w.layout)).toBe(false);

      // Saved and loaded: drawn with its crane from the start.
      const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w))));
      expect(back.ok).toBe(true);
      if (!back.ok) return;
      const loaded = new DepotView(stubMaterials());
      loaded.setWorld(back.value.economy, back.value.layout);
      const again = loaded.craneOf(back.value.economy.depotAtPiece(plan.stationId)!.id)!;
      expect([again.drawn, again.t, again.l]).toEqual([type, after.t, after.l]);

      // Undo: the plain station's crane again, where it was.
      expect(editor.undo()).toBe(true);
      expect(view.syncStations(w.economy, w.layout)).toBe(true);
      const undone = view.craneOf(depot.id)!;
      expect([undone.drawn, undone.t, undone.l]).toEqual(["station", before.t, before.l]);
      for (const [id, trolley] of others) expect(view.craneOf(id)?.trolley).toBe(trolley);
      expect(view.group.children.length).toBe(children);
    });
  }

  it("a big station built as one (a halt: passengers only) has no goods corner of its own here", () => {
    expect(siteLayout("town", "kit-two-platform-station", false)).toBeNull();
    expect(siteLayout("town", "kit-grand-terminus", false)).toBeNull();
    expect(siteLayout("town", "kit-country-halt", true)).toBeNull();
    expect(siteLayout("town", "kit-two-platform-station", true)).not.toBeNull();
  });
});

describe("DepotView.syncSites: only what changed is drawn again (QA 2026-11-04, 9: a pick-up rebuilt every yard)", () => {
  it("picking one industry up keeps the others' static parts; putting it back elsewhere draws it there; same as setWorld", () => {
    const layout = new Layout();
    const sim = new Sim(layout);
    const economy = new Economy(layout, sim);
    const a = layout.addPiece("depot-sawmill", { x: 0, z: 0, heading: 0 });
    const far = layout.addPiece("depot-forest", { x: 20000, z: 20000, heading: 0 });
    economy.addDepot("sawmill", a);
    economy.addDepot("forest", far);
    const view = new DepotView(stubMaterials());
    view.setWorld(economy, layout);
    const statics = () => view.group.children.filter((o) => o.userData.depotStatic);
    const before = statics();
    expect(before.length).toBe(2);
    const farTile = before.find((g) => Math.abs(new Box3().setFromObject(g).getCenter(new Vector3()).x - 20000) < 2000)!;
    expect(farTile).toBeDefined();
    layout.liftPiece(a);
    view.syncSites(economy, layout);
    // The sawmill's tile is gone (nothing else in it); the forest's is the very same group.
    expect(statics()).toEqual([farTile]);
    expect(view.craneOf(0)).toBeNull();
    layout.dropPiece(a, { x: 400, z: 0, heading: 0 }, 0);
    view.syncSites(economy, layout);
    expect(statics()).toContain(farTile);
    expect(statics().length).toBe(2);
    expect(view.craneOf(0)?.drawn).toBe("depot-sawmill");
    // The same triangles as drawing it all afresh.
    const tris = () => statics().reduce((n, g) => n + g.children.reduce((k, m) => k + ((m as Mesh).geometry.getAttribute("position")?.count ?? 0), 0), 0);
    const synced = tris();
    view.setWorld(economy, layout);
    expect(tris()).toBe(synced);
  });

  it("the held model is made once per kind and handed out as copies (each the caller's to dispose)", () => {
    const view = new DepotView(stubMaterials());
    const one = view.model("forest");
    const two = view.model("forest");
    const geoms = (g: Object3D) => g.children.map((m) => (m as Mesh).geometry);
    expect(geoms(one).length).toBeGreaterThan(0);
    expect(geoms(one).every((g, i) => g !== geoms(two)[i])).toBe(true);
    for (const g of geoms(one)) g.dispose();
    expect(geoms(view.model("forest")).map((g) => g.getAttribute("position").count)).toEqual(geoms(two).map((g) => g.getAttribute("position").count));
  });
});

describe("DepotView: piles, loads and cranes are placed again only when something they follow changed", () => {
  it("idle, nothing is placed; a pile that grows is placed and drawn; with trains moving, placed every update", () => {
    const w = world();
    const clock = { sim: 0 };
    w.view.update(w.economy, [], 0, () => undefined, clock.sim, true, false);
    const logs = w.view.group.children.find((o) => (o as { isInstancedMesh?: boolean }).isInstancedMesh && (o as { count: number }).count > 0) as unknown as {
      count: number;
      instanceMatrix: { version: number };
    };
    expect(logs.count).toBe(6);
    const version = logs.instanceMatrix.version;
    // Paused, nothing moving: no unit placed again (the matrices' version stays).
    for (let k = 0; k < 10; k++) expect(w.view.update(w.economy, [], 0, () => undefined, clock.sim, true, false)).toBe("still");
    expect(logs.instanceMatrix.version).toBe(version);
    // A pile grows (a delivery): placed again, and a frame asked for.
    w.saw.piles[CARGO.log.index] = 7;
    expect(w.view.update(w.economy, [], 0, () => undefined, clock.sim, true, false)).toBe("changed");
    expect(logs.count).toBe(7);
    expect(logs.instanceMatrix.version).toBeGreaterThan(version);
    // Trains moving: placed every update (loads ride on them).
    const v2 = logs.instanceMatrix.version;
    w.view.update(w.economy, [], 0, () => undefined, clock.sim, true, true);
    expect(logs.instanceMatrix.version).toBeGreaterThan(v2);
  });
});

describe("DepotView: the crane goes home once the train it worked has gone (QA 2026-11-16: a farm's jib left out over the track)", () => {
  type Yard = "farm" | "forest" | "quarry" | "mine" | "sawmill";
  /** Each yard, the goods it gives, the wagon that carries them, and a place that takes them (the route's second stop). */
  const yards: [Yard, "grain" | "log" | "stone" | "coal" | "planks", "hopper" | "timber", "mill" | "sawmill" | "town" | "power" | "workshop"][] = [
    ["farm", "grain", "hopper", "mill"],
    ["forest", "log", "timber", "sawmill"],
    ["quarry", "stone", "hopper", "town"],
    ["mine", "coal", "hopper", "power"],
    ["sawmill", "planks", "timber", "workshop"],
  ];

  /**
   * A place that takes the goods, four straights, the yard with goods to give, three straights; an engine and four
   * wagons (longer than the yard: the last stand back on the track it came in on) routed yard then place, drawn with
   * its cars where the sim has them.
   */
  function yardLine([role, good, wagon, to]: (typeof yards)[number]) {
    const layout = new Layout();
    const types = [to === "town" ? "station" : `depot-${to}`, ...Array(4).fill("straight-216"), `depot-${role}`, ...Array(3).fill("straight-216")];
    const ids = types.map((t, i) => layout.addPiece(t as "straight-216", { x: i * 216, z: 0, heading: 0 }));
    const sim = new Sim(layout);
    const placed = sim.addTrain(["engine", wagon, wagon, wagon, wagon], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 120 });
    if (placed.kind !== "placed") throw new Error("no room");
    const economy = new Economy(layout, sim);
    const place = to === "town" ? economy.addDepot("town", ids[0], 0, 30) : economy.addDepot(to, ids[0]);
    const yard = economy.addDepot(role, ids[5]);
    yard.piles[CARGO[good].index] = 12;
    const engine = sim.getTrain(placed.trainId)!.cars[0].id;
    economy.setRoute(engine, { stops: [{ depotId: yard.id, action: "both" }, { depotId: place.id, action: "both" }], next: 0 });
    sim.setLever(engine, 1);
    const view = new DepotView(stubMaterials());
    view.setWorld(economy, layout);
    // Each car an object where the sim has it (between its bogies, turned along the track), as the train view's are.
    const cars = new Map<number, Object3D>();
    const carObject = (id: number): Object3D | undefined => {
      const found = sim.findCar(id);
      if (!found) return undefined;
      let o = cars.get(id);
      if (!o) cars.set(id, (o = new Group()));
      o.userData.carKind = found.train.cars[found.index].kind;
      const a = found.train.world[2 * found.index];
      const b = found.train.world[2 * found.index + 1];
      o.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      o.rotation.set(0, -Math.atan2(a.z - b.z, a.x - b.x), 0);
      o.updateMatrixWorld(true);
      return o;
    };
    const carIds = () => sim.getTrain(placed.trainId)!.cars.map((c) => c.id);
    return { sim, economy, yard, view, carObject, carIds, trainId: placed.trainId, yardPiece: ids[5] };
  }

  for (const spec of yards) {
    it(`worked in place and gone, the ${spec[0]}'s crane is drawn back at home (then nothing of it to draw), its runs never off the yard's piece`, () => {
      const w = yardLine(spec);
      const draw = (sim: number) => w.view.update(w.economy, w.carIds(), w.carIds().length, w.carObject, sim, false);
      const crane = w.view.craneOf(w.yard.id)!;
      // (Placed by the first update: at home, nothing yet at work.)
      draw(0);
      const home = crane.trolley.position.clone();
      let sim = 0;
      let worked = false;
      let gone = false;
      let after = 0;
      for (let i = 0; i < 90 * 120 && after < 10 * 120; i++) {
        // (Once gone, it's stopped where it is, out of the yard: the crane is watched going home.)
        if (gone && after++ === 0) {
          const engine = w.sim.getTrain(w.trainId)!.cars[0].id;
          w.economy.setRoute(engine, null);
          w.sim.setLever(engine, 0);
        }
        w.sim.tick();
        w.economy.tick();
        sim += SIM_DT;
        // A run never goes off the yard's piece (a wagon beyond it is reached for from there).
        const at = w.economy.cranePosition(w.yard.id);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThanOrEqual(216);
        if (w.economy.servicedCar(w.yard.id) !== -1) worked = true;
        gone ||= worked && w.sim.getTrain(w.trainId)!.bogies.every((b) => b.pieceId !== w.yardPiece);
        if (i % 4 === 0) draw(sim);
      }
      expect(worked).toBe(true);
      expect(gone).toBe(true);
      const out = { kind: spec[1], toPile: false, carId: -1, phase: 0, run: -1 } as Parameters<Economy["craneMove"]>[1];
      expect(w.economy.craneMove(w.yard.id, out)).toBe(false);
      // Drawn at home: the trolley where it started (the rope hanging straight down from it).
      expect(crane.trolley.position.distanceTo(home)).toBeLessThan(0.5);
      // And then nothing of the crane's to draw (the yard's own life, a farm's animals, may still move: ambient only).
      for (let k = 0; k < 10; k++) {
        const r = draw((sim += 4 * SIM_DT));
        expect(r === "still" || w.view.ambientOnly).toBe(true);
      }
    });
  }
});
