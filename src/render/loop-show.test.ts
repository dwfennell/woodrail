import { Box3, BoxGeometry, Color, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Quaternion, Raycaster, Vector3, type BufferGeometry, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { Kit } from "../catalogue/kit";
import { loadAsset } from "../catalogue/registry";
import type { Materials } from "./materials";
import { bake, kitModelKey, PropLibrary } from "./props/library";
import { Economy } from "../economy";
import { CAR_SPECS, createSnapshot, Sim, SIM_HZ, type CarKind, type SimSnapshot } from "../sim";
import { connectorRef, createWorldConnector, KITS, Layout, LOOP_BESIDE, type PieceTypeId } from "../track";
import { hopAt, LOOP_CANCEL_S, LOOP_HOP, LOOP_HUB, LOOP_SCALE, LOOP_SWAP, loopPath, LoopShowView, loopTable, pathAt, poseAt, showAt } from "./loop-show";
import { AXLE_HEIGHT } from "./train-models";

const LOOP = "kit-loop-the-loop" as const;

describe("the loop-the-loop kit", () => {
  it("is a 216 straight trains crawl over, its model beside the line, its own little car left out", () => {
    const kit = KITS[LOOP];
    expect(kit.asset).toBe("mech-loop-the-loop");
    expect(kit.track.paths).toHaveLength(1);
    expect(kit.track.paths[0].geom).toMatchObject({ kind: "line", length: 216 });
    expect(kit.rails).toBe("track");
    expect(kit.crawl).toBe(40);
    expect(kit.show).toBe("loop");
    expect(kit.without).toEqual(["car"]);
    // Nothing for the sim but the crawl: no stop, no depot, no moving parts of KitView's.
    expect(kit.stop).toBeUndefined();
    expect(kit.depot).toBeUndefined();
    expect(kit.moves).toBeUndefined();
    // Its ground clear of the track (the track's edge is 20 off its line), the trestles' feet (56 out) inside it.
    for (const r of kit.footprint) expect(r.l - r.d / 2).toBeGreaterThanOrEqual(20);
    expect(LOOP_BESIDE - 57).toBeGreaterThanOrEqual(20);
  });

  it("its model is the catalogue's without its slabs of track or its little car, beside the line", async () => {
    const m = (c = "#ffffff") => new MeshStandardMaterial({ color: new Color(c) });
    const mats = new Proxy({ lacquer: (c: string) => m(c) } as unknown as Materials, { get: (t, k) => (k in t ? t[k as keyof Materials] : m()) });
    const lib = new PropLibrary(mats);
    const model = (await lib.load(kitModelKey(LOOP)))!;
    const asset = (await loadAsset("mech-loop-the-loop"))!;
    const verts = (parts: { geometry: BufferGeometry }[]) => parts.reduce((n, p) => n + p.geometry.getAttribute("position").count, 0);
    const built = asset.build(new Kit(mats, 0.5));
    const all = verts(bake(built, mats, { slabs: false }).parts);
    const noCar = verts(bake(built, mats, { slabs: false, without: new Set(["car"]) }).parts);
    expect(noCar).toBeLessThan(all);
    expect(verts(model.parts)).toBe(noCar);
    // Beside the line: nothing of it within the track's half width (20) of the line.
    const box = new Box3();
    for (const p of model.parts) {
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox!);
    }
    expect(box.min.z).toBeGreaterThan(20);
    expect(box.min.x).toBeGreaterThan(0);
    expect(box.max.x).toBeLessThan(216);
  });
});

describe("the loop's spline", () => {
  const path = loopPath();
  const r = (p: Vector3) => Math.hypot(p.x, p.y - LOOP_HUB);

  it("is built once, and runs smoothly: evenly spaced samples, no jumps", () => {
    expect(loopPath()).toBe(path);
    const n = path.points.length;
    const step = path.length / (n - 1);
    for (let i = 1; i < n; i++) {
      const d = path.points[i].distanceTo(path.points[i - 1]);
      expect(d).toBeGreaterThan(step * 0.8);
      expect(d).toBeLessThan(step * 1.2);
      // The tangent turns a little at each step (no kinks).
      expect(path.tangents[i].dot(path.tangents[i - 1])).toBeGreaterThan(0.99);
    }
  });

  it("is a closed loop round the hub: once round and a little, from just before the bottom to just after", () => {
    const table = loopTable();
    const radius = r(table[0]);
    for (const p of path.points) expect(Math.abs(r(p) - radius)).toBeLessThan(0.6);
    // The copy's origin about 2 mm inside where its wheels run (radius 54 less the chord, plus its wheels' feet).
    expect(radius).toBeGreaterThan(54);
    expect(radius).toBeLessThan(60);
    // The way it heads turns once round, and the lead in and out (0.3 rad each).
    let turned = 0;
    for (let i = 1; i < path.tangents.length; i++) {
      const a = Math.atan2(path.tangents[i - 1].y, path.tangents[i - 1].x);
      const b = Math.atan2(path.tangents[i].y, path.tangents[i].x);
      turned += Math.atan2(Math.sin(b - a), Math.cos(b - a));
    }
    expect(turned).toBeCloseTo(2 * Math.PI + 0.6, 1);
    // Starts and ends near the bottom (either side of it), heading along +x.
    const first = path.points[0];
    const last = path.points.at(-1)!;
    expect(first.x).toBeLessThan(0);
    expect(last.x).toBeGreaterThan(0);
    expect(Math.abs(first.x + last.x)).toBeLessThan(0.5);
    expect(path.tangents[0].x).toBeGreaterThan(0.9);
    expect(path.tangents.at(-1)!.x).toBeGreaterThan(0.9);
    // It drifts across the ring (40 deep: ±20), in by one side and out by the other, the copy (19 wide) inside it.
    for (let i = 1; i < path.points.length; i++) expect(path.points[i].z).toBeGreaterThanOrEqual(path.points[i - 1].z - 1e-6);
    expect(first.z).toBeCloseTo(-8, 3);
    expect(last.z).toBeCloseTo(8, 3);
    expect(8 + (32 * LOOP_SCALE) / 2).toBeLessThanOrEqual(20);
  });

  it("its frames turn smoothly (no flip), up toward the hub: upside down at the top", () => {
    const up = new Vector3();
    for (let i = 0; i < path.points.length; i++) {
      expect(Math.abs(path.normals[i].dot(path.tangents[i]))).toBeLessThan(1e-3);
      if (i > 0) {
        expect(path.normals[i].dot(path.normals[i - 1])).toBeGreaterThan(0.99);
        expect(Math.abs(path.quats[i].dot(path.quats[i - 1]))).toBeGreaterThan(0.999);
      }
      // Up is toward the hub.
      const toHub = new Vector3(-path.points[i].x, LOOP_HUB - path.points[i].y, 0).normalize();
      expect(path.normals[i].dot(toHub)).toBeGreaterThan(0.99);
      // The quaternion turns the car's +x to the tangent, its +y to up.
      expect(new Vector3(1, 0, 0).applyQuaternion(path.quats[i]).dot(path.tangents[i])).toBeGreaterThan(0.9999);
      expect(up.set(0, 1, 0).applyQuaternion(path.quats[i]).dot(path.normals[i])).toBeGreaterThan(0.9999);
    }
    // At the top, upside down, and running back along −x.
    const pos = new Vector3();
    const q = path.quats[0].clone();
    let top = 0;
    for (let i = 0; i < path.points.length; i++) if (path.points[i].y > path.points[top].y) top = i;
    poseAt(path, top / (path.points.length - 1), pos, q);
    expect(pos.y).toBeGreaterThan(LOOP_HUB + 50);
    expect(up.set(0, 1, 0).applyQuaternion(q).y).toBeLessThan(-0.99);
    expect(new Vector3(1, 0, 0).applyQuaternion(q).x).toBeLessThan(-0.99);
    // At the bottom, upright.
    poseAt(path, 0.5 * (pathAt(path, 0) + pathAt(path, 0.0001)), pos, q);
    expect(up.set(0, 1, 0).applyQuaternion(q).y).toBeGreaterThan(0.9);
  });

  it("its timing: from start to end in step, slower over the top; the engine and the copy trade places at the ends", () => {
    expect(pathAt(path, 0)).toBe(0);
    expect(pathAt(path, 1)).toBe(1);
    let last = 0;
    for (let i = 1; i <= 100; i++) {
      const s = pathAt(path, i / 100);
      expect(s).toBeGreaterThan(last);
      last = s;
    }
    // Half the time gets it less than half way (the top half is the slow one): fine, it's under half round by then.
    expect(pathAt(path, 0.5)).toBeCloseTo(0.5, 1);
    const start = showAt(0);
    const middle = showAt(0.5);
    const end = showAt(1);
    expect([start.grow, start.run]).toEqual([0, 0]);
    expect([end.grow, end.run]).toEqual([0, 1]);
    expect(middle.grow).toBe(1);
    expect(showAt(LOOP_SWAP).grow).toBe(1);
    expect(showAt(LOOP_SWAP).run).toBe(0);
    expect(showAt(1 - LOOP_SWAP).run).toBe(1);
  });
});

/** The cars' models, as TrainView would have them: a group each (a box in it), set where the snapshot has them. */
class Cars {
  readonly objects = new Map<number, Group>();
  carObject = (id: number): Object3D | undefined => this.objects.get(id);
  sync(snap: SimSnapshot): void {
    const seen = new Set<number>();
    for (let i = 0; i < snap.count; i++) {
      const id = snap.ids[i];
      seen.add(id);
      let o = this.objects.get(id);
      if (!o) {
        o = new Group();
        o.add(new Mesh(new BoxGeometry(90, 50, 30)));
        o.userData.carId = id;
        this.objects.set(id, o);
      }
      o.position.set(snap.transforms[i * 6], snap.transforms[i * 6 + 1], snap.transforms[i * 6 + 2]);
      o.rotation.y = -snap.transforms[i * 6 + 3];
    }
    for (const id of [...this.objects.keys()]) if (!seen.has(id)) this.objects.delete(id);
  }
}

/** A straight line along +x: a turnback buffer, a straight (the train starts on it), the loop kit, a straight, a buffer. */
function line(cars: CarKind[] = ["engine", "hopper"], before = 1) {
  const layout = new Layout();
  const c = createWorldConnector();
  layout.addPiece("buffer-turnback", { x: 0, z: 0, heading: Math.PI });
  let at = { x: 0, z: 0, heading: 0 };
  const ids: number[] = [];
  for (const type of [...Array(before).fill("straight-216"), LOOP, "straight-216", "straight-216"] as PieceTypeId[]) {
    const id = layout.addPiece(type, at);
    ids.push(id);
    layout.worldConnector(connectorRef(id, 1), c);
    at = { x: c.x, z: c.z, heading: c.heading };
  }
  layout.addPiece("buffer-turnback", at);
  const sim = new Sim(layout);
  const economy = new Economy(layout, sim);
  const placed = sim.addTrain(cars, { pieceId: ids[0], pathIndex: 0, reversed: false, s: 200 });
  if (placed.kind !== "placed") throw new Error("no room");
  const train = () => sim.getTrain(sim.trainIds()[0])!;
  const engine = train().cars.find((x) => x.kind === "engine")!.id;
  sim.setLever(engine, 1);
  const snap = createSnapshot();
  const objects = new Cars();
  const view = new LoopShowView();
  view.sync(layout);
  const kit = ids[before];
  const step = (camera: PerspectiveCamera | null = null) => {
    sim.tick();
    economy.tick();
    sim.writeSnapshot(snap);
    objects.sync(snap);
    return view.update(snap, objects, camera, 1 / SIM_HZ);
  };
  // The kit's place: its piece's pose, and a world point's place against it (t along its line, l across, up).
  const pose = layout.getPiece(kit)!.pose;
  const local = (p: Vector3) => {
    const dx = p.x - pose.x;
    const dz = p.z - pose.z;
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    return { t: dx * c + dz * s, l: -dx * s + dz * c, y: p.y };
  };
  return { layout, sim, economy, train, engine, view, kit, step, objects, snap, local };
}

/** A camera over (x, z), or far away from it. */
function cameraAt(x: number, z: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(30, 390 / 844, 5, 40000);
  camera.position.set(x, 700, z + 600);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld();
  return camera;
}

describe("LoopShowView", () => {
  it("an engine crossing the kit gets a show lasting the crawl over 216 (5.4 s); the copy goes upside down over the top", () => {
    const w = line();
    let started = -1;
    let ended = -1;
    let upsideDown = false;
    let hidden = false;
    const up = new Vector3();
    for (let k = 0; k < 20 * SIM_HZ; k++) {
      w.step();
      const on = w.view.showing(w.kit);
      if (on !== -1 && started < 0) started = k;
      if (on === -1 && started >= 0 && ended < 0) ended = k;
      const copy = w.view.copyAt(w.kit);
      if (copy) {
        copy.updateWorldMatrix(true, false);
        up.set(0, 1, 0).transformDirection(copy.matrixWorld);
        if (up.y < -0.99 && copy.visible) upsideDown = true;
        if (!w.objects.carObject(w.engine)!.visible && copy.visible) hidden = true;
      }
      if (ended >= 0) break;
    }
    expect(w.view.count).toBe(1);
    expect(started).toBeGreaterThan(0);
    expect(ended).toBeGreaterThan(started);
    // The engine crosses the whole kit at the crawl (its leading axle was on before its middle was).
    expect((ended - started) / SIM_HZ).toBeCloseTo(216 / KITS[LOOP].crawl!, 1);
    expect(upsideDown).toBe(true);
    // The engine's model was hidden while its copy stood in for it, and shows again after (never shrunk).
    expect(hidden).toBe(true);
    // Called off at once (in logic), the engine eased back (drawn) over a moment, then still.
    let easing = 0;
    while (w.view.busy) {
      easing++;
      w.step();
    }
    expect(easing / SIM_HZ).toBeLessThanOrEqual(LOOP_CANCEL_S + 2 / SIM_HZ);
    const obj = w.objects.carObject(w.engine)!;
    expect(obj.scale.x).toBe(1);
    expect(obj.visible).toBe(true);
    expect(w.view.group.children).toHaveLength(0);
    expect(w.view.running).toBe(false);
    // The train comes out the far end at speed (the sim's own run: the show changed nothing).
    for (let k = 0; k < 5 * SIM_HZ; k++) w.step();
    expect(w.train().speed).toBe(120);
  });

  it("the copy is the engine's own model (sharing its geometry and materials), not its selection shells", () => {
    const w = line();
    const shell = new Mesh(new BoxGeometry(1, 1, 1));
    shell.userData.ring = false;
    let copy: Group | undefined;
    for (let k = 0; k < 10 * SIM_HZ && !copy; k++) {
      // (Its shells as TrainView makes them, the first time it's selected.)
      const obj = w.objects.carObject(w.engine);
      if (obj && !shell.parent) obj.children[0].add(shell);
      w.step();
      copy = w.view.copyAt(w.kit);
    }
    expect(copy).toBeDefined();
    const meshes: Mesh[] = [];
    copy!.traverse((o) => {
      if ((o as Mesh).isMesh) meshes.push(o as Mesh);
    });
    const real = w.objects.carObject(w.engine)!.children[0] as Mesh;
    expect(meshes).toHaveLength(1);
    expect(meshes[0].geometry).toBe(real.geometry);
    expect(meshes[0].material).toBe(real.material);
  });

  it("asks for frames only while it moves in view: none while the train stands, or off screen", () => {
    const w = line();
    const piece = w.layout.getPiece(w.kit)!.pose;
    const near = cameraAt(piece.x + 108, piece.z + 40);
    const far = cameraAt(piece.x + 20000, piece.z + 20000);
    // Off screen: the show runs its course unseen, never asking for a frame.
    const offScreen: string[] = [];
    let ran = false;
    for (let k = 0; k < 20 * SIM_HZ; k++) {
      offScreen.push(w.step(far));
      if (w.view.running) ran = true;
      if (ran && !w.view.running) break;
    }
    expect(ran).toBe(true);
    expect(offScreen.every((r) => r === "still")).toBe(true);

    // In view: "moving" while it runs; the train stopped mid-show, it holds still and asks for nothing.
    const v = line();
    const results: string[] = [];
    while (!v.view.running) results.push(v.step(near));
    for (let k = 0; k < SIM_HZ; k++) results.push(v.step(near));
    expect(results.filter((r) => r === "moving").length).toBeGreaterThan(SIM_HZ - 2);
    v.sim.setLever(v.engine, 0);
    for (let k = 0; k < 3 * SIM_HZ; k++) v.step(near);
    expect(v.train().speed).toBe(0);
    expect(v.view.running).toBe(true);
    const copy = v.view.copyAt(v.kit)!;
    const at = copy.position.clone();
    for (let k = 0; k < 2 * SIM_HZ; k++) expect(v.step(near)).toBe("still");
    expect(copy.position.equals(at)).toBe(true);
    // Paused: the sim isn't ticked, the snapshot is as it was: the same.
    for (let k = 0; k < 60; k++) expect(v.view.update(v.snap, v.objects, near)).toBe("still");
    // Going again, it carries on from there.
    v.sim.setLever(v.engine, 1);
    let moving = false;
    for (let k = 0; k < SIM_HZ; k++) if (v.step(near) === "moving") moving = true;
    expect(moving).toBe(true);
  });

  it("the hand-off: the engine hops off the line onto the loop's start, shrinking, and back on at the far end, growing, with no jumps", () => {
    const w = line(["engine", "hopper"]);
    const at = new Vector3();
    const engineAt = new Vector3();
    const frames: { u: number; copy: Vector3; engine: Vector3; scale: number; hidden: boolean }[] = [];
    let endedVisible = false;
    for (let k = 0; k < 20 * SIM_HZ; k++) {
      w.step();
      const copy = w.view.copyAt(w.kit);
      if (copy) {
        copy.updateWorldMatrix(true, false);
        at.setFromMatrixPosition(copy.matrixWorld);
        w.objects.carObject(w.engine)!.getWorldPosition(engineAt);
        frames.push({ u: w.view.progress(w.kit), copy: at.clone(), engine: engineAt.clone(), scale: copy.scale.x, hidden: !w.objects.carObject(w.engine)!.visible });
      } else if (frames.length > 0) {
        // Over: the engine shows at once (the copy landed on it: nothing to ease), no copy left.
        endedVisible = w.objects.carObject(w.engine)!.visible && w.view.group.children.length === 0 && !w.view.busy;
        break;
      }
    }
    expect(frames.length).toBeGreaterThan(5 * SIM_HZ);
    expect(endedVisible).toBe(true);
    // The engine's model hidden all through (the copy stands in for it).
    expect(frames.every((f) => f.hidden)).toBe(true);
    // At first the copy covers the engine exactly, whole; at the last, it has landed on it again.
    const first = frames[0];
    const last = frames.at(-1)!;
    expect(first.u).toBeLessThan(0.01);
    expect(first.copy.distanceTo(first.engine)).toBeLessThan(1);
    expect(first.scale).toBeGreaterThan(0.99);
    expect(last.u).toBeGreaterThan(0.99);
    expect(last.copy.distanceTo(last.engine)).toBeLessThan(1);
    expect(last.scale).toBeGreaterThan(0.99);
    // On the way out to the ring: across from the line to the ring's start (its plane `LOOP_BESIDE` off it, the copy
    // drifting 8 in), shrinking all the way, lifted by the hop on the way; on the ring by the end of the hop.
    const hopIn = frames.filter((f) => f.u <= LOOP_SWAP);
    const hopOut = frames.filter((f) => f.u >= 1 - LOOP_SWAP);
    for (let i = 1; i < hopIn.length; i++) {
      expect(w.local(hopIn[i].copy).l).toBeGreaterThanOrEqual(w.local(hopIn[i - 1].copy).l - 1e-6);
      expect(hopIn[i].scale).toBeLessThanOrEqual(hopIn[i - 1].scale + 1e-9);
    }
    for (let i = 1; i < hopOut.length; i++) {
      expect(w.local(hopOut[i].copy).l).toBeLessThanOrEqual(w.local(hopOut[i - 1].copy).l + 1e-6);
      expect(hopOut[i].scale).toBeGreaterThanOrEqual(hopOut[i - 1].scale - 1e-9);
    }
    const ringStart = new Vector3();
    poseAt(loopPath(), 0, ringStart, new Quaternion());
    const onRing = frames.find((f) => f.u >= LOOP_SWAP)!;
    expect(w.local(onRing.copy).l).toBeCloseTo(LOOP_BESIDE + ringStart.z, 0);
    expect(onRing.scale).toBeCloseTo(LOOP_SCALE, 5);
    // The hop: half way, it's well above the straight line between the line and the ring's start.
    const mid = hopIn.reduce((a, b) => (Math.abs(showAt(b.u).grow - 0.5) < Math.abs(showAt(a.u).grow - 0.5) ? b : a));
    expect(w.local(mid.copy).y - (first.copy.y + (onRing.copy.y - first.copy.y) * showAt(mid.u).grow)).toBeGreaterThan(LOOP_HOP * 0.8);
    expect(hopAt(0)).toBe(0);
    expect(hopAt(1)).toBeCloseTo(0, 9);
    // No jumps: from one tick to the next the copy moves a few mm at most (the hop is the quickest part).
    let jump = 0;
    for (let i = 1; i < frames.length; i++) jump = Math.max(jump, frames[i].copy.distanceTo(frames[i - 1].copy));
    expect(jump).toBeLessThan(3);
  });

  it("the cars coast on behind on a tow rope to the copy; an engine on its own has none", () => {
    const w = line(["engine", "hopper"]);
    while (w.view.progress(w.kit) < 0.5) w.step();
    const ropes = w.view.ropesAt(w.kit);
    // Two lengths (to its sag), from the hopper's end toward the engine to the copy's back.
    expect(ropes).toHaveLength(2);
    expect(ropes[0].to.distanceTo(ropes[1].from)).toBeLessThan(1e-6);
    const i = [...w.snap.ids.slice(0, w.snap.count)].findIndex((id) => id !== w.engine);
    const o = i * 6;
    const h = w.snap.transforms[o + 3];
    const half = CAR_SPECS.hopper.length / 2;
    const ends = [1, -1].map((sg) => new Vector3(w.snap.transforms[o] + sg * Math.cos(h) * half, w.snap.transforms[o + 1] + AXLE_HEIGHT, w.snap.transforms[o + 2] + sg * Math.sin(h) * half));
    const engine = w.objects.carObject(w.engine)!.position;
    const front = ends.reduce((a, b) => (a.distanceTo(engine) < b.distanceTo(engine) ? a : b));
    expect(ropes[0].from.distanceTo(front)).toBeLessThan(1e-3);
    const copy = w.view.copyAt(w.kit)!;
    copy.updateWorldMatrix(true, false);
    const back = new Vector3(-CAR_SPECS.engine.length / 2, AXLE_HEIGHT, 0).applyMatrix4(copy.matrixWorld);
    expect(ropes[1].to.distanceTo(back)).toBeLessThan(1e-3);
    // Sagging a little, below the straight line between its ends.
    expect(ropes[0].to.y).toBeLessThan((ropes[0].from.y + ropes[1].to.y) / 2);
    const alone = line(["engine"]);
    while (alone.view.progress(alone.kit) < 0.5) alone.step();
    expect(alone.view.ropesAt(alone.kit)).toHaveLength(0);
  });

  it("a tap on the copy is a tap on its engine (the pick's `engineAt`); the ropes and other cars aren't", () => {
    const w = line(["engine", "hopper"]);
    while (w.view.progress(w.kit) < 0.5) w.step();
    const copy = w.view.copyAt(w.kit)!;
    copy.updateWorldMatrix(true, true);
    w.view.group.updateMatrixWorld(true);
    // A ray from above, straight down onto the copy, as a tap on it casts.
    const centre = new Box3().setFromObject(copy).getCenter(new Vector3());
    const ray = new Raycaster(new Vector3(centre.x, centre.y + 500, centre.z), new Vector3(0, -1, 0));
    const hits = ray.intersectObject(w.view.group, true);
    expect(hits.length).toBeGreaterThan(0);
    expect(w.view.engineAt(hits[0].object)).toBe(w.engine);
    copy.traverse((o) => expect(w.view.engineAt(o)).toBe(w.engine));
    expect(w.view.engineAt(w.objects.carObject(w.engine)!)).toBe(-1);
    // The ropes aren't picked (a tap on them goes through, to the cars or track behind).
    const ropes: Object3D[] = [];
    w.view.group.traverse((o) => {
      if (o.name === "loop-rope") ropes.push(o);
    });
    expect(ropes.length).toBeGreaterThan(0);
    for (const r of ropes) {
      const out: unknown[] = [];
      r.raycast(ray, out as never);
      expect(out).toHaveLength(0);
    }
  });

  it("an eased call-off asks for frames for a moment, the copy going back to the engine, then none", () => {
    const w = line(["engine", "hopper"]);
    const piece = w.layout.getPiece(w.kit)!.pose;
    const near = cameraAt(piece.x + 108, piece.z + 40);
    while (w.view.progress(w.kit) < 0.4) w.step(near);
    // Lever back: it slows, stops and backs up; the show's off the tick it backs.
    w.sim.setLever(w.engine, -1);
    while (w.view.running) w.step(near);
    const copy = w.view.copyAt(w.kit) ?? (w.view.group.children[0]?.getObjectByName("loop-copy") as Group);
    expect(copy).toBeDefined();
    const engineAt = new Vector3();
    const gaps: number[] = [];
    const results: string[] = [];
    while (w.view.busy) {
      copy.updateWorldMatrix(true, false);
      w.objects.carObject(w.engine)!.getWorldPosition(engineAt);
      gaps.push(new Vector3().setFromMatrixPosition(copy.matrixWorld).distanceTo(engineAt));
      results.push(w.step(near));
    }
    // About `LOOP_CANCEL_S` of frames, each moving, the copy closing on the engine all the way.
    expect(results.length / SIM_HZ).toBeGreaterThan(LOOP_CANCEL_S - 0.02);
    expect(results.length / SIM_HZ).toBeLessThanOrEqual(LOOP_CANCEL_S + 2 / SIM_HZ);
    expect(results.every((r) => r === "moving")).toBe(true);
    for (let k = 1; k < gaps.length; k++) expect(gaps[k]).toBeLessThan(gaps[k - 1] + 0.5);
    expect(gaps.at(-1)!).toBeLessThan(gaps[0] * 0.1);
    // Over: the engine shows, whole, and nothing more is asked for: lever off, standing, no frames.
    expect(w.objects.carObject(w.engine)!.visible).toBe(true);
    expect(w.view.group.children).toHaveLength(0);
    w.sim.setLever(w.engine, 0);
    for (let k = 0; k < 2 * SIM_HZ; k++) w.step(near);
    expect(w.train().speed).toBe(0);
    for (let k = 0; k < 60; k++) expect(w.view.update(w.snap, w.objects, near, 1 / 60)).toBe("still");
    expect(w.view.busy).toBe(false);
  });

  it("one show at a time: a second engine coming on during a show gets none, nor after it once inside", () => {
    const layout = new Layout();
    const kit = layout.addPiece(LOOP, { x: 0, z: 0, heading: 0 });
    const view = new LoopShowView();
    view.sync(layout);
    const cars = new Cars();
    const snap = createSnapshot();
    // Two engines, each at x along the kit's line.
    const at = (a: number, b: number) => {
      snap.count = 2;
      snap.ids.set([1, 2]);
      snap.kinds.set([0, 0]);
      snap.transforms.fill(0);
      snap.transforms[0] = a;
      snap.transforms[6] = b;
      cars.sync(snap);
      return view.update(snap, cars);
    };
    at(-5, -200);
    at(5, -200);
    expect(view.showing(kit)).toBe(1);
    // The second comes on behind it.
    at(60, -30);
    at(80, 2);
    at(100, 20);
    expect(view.showing(kit)).toBe(1);
    // The first gets to the far end: its show's over; the second, already on, gets none.
    at(217, 120);
    expect(view.showing(kit)).toBe(-1);
    at(230, 140);
    at(260, 220);
    expect(view.showing(kit)).toBe(-1);
    // (It was last drawn mid-loop, the test jumping it to the end: its copy eases back to it over a moment.)
    for (let k = 0; k < LOOP_CANCEL_S * 60 + 2; k++) at(260, 220);
    expect(view.busy).toBe(false);
    expect(view.group.children).toHaveLength(0);
    // A third comes on from the far end, running the other way: it gets a show, the copy run round backwards.
    snap.count = 1;
    snap.ids[0] = 3;
    snap.transforms.fill(0);
    snap.transforms[0] = 230;
    snap.transforms[3] = Math.PI;
    cars.sync(snap);
    view.update(snap, cars);
    snap.transforms[0] = 214;
    view.update(snap, cars);
    expect(view.showing(kit)).toBe(3);
    const copy = view.copyAt(kit)!;
    // The copy turned round, running the path back from its end (the loop's far side), the way the engine runs.
    expect(copy.children[0].rotation.y).toBeCloseTo(Math.PI);
    expect(copy.position.x).toBeGreaterThan(10);
    expect(new Vector3(1, 0, 0).applyQuaternion(copy.quaternion).x).toBeGreaterThan(0.9);
  });

  it("an engine backing out mid-show calls it off cleanly: the copy gone, the engine whole", () => {
    const w = line(["engine", "hopper"]);
    for (let k = 0; k < 20 * SIM_HZ && !(w.view.running && w.view.progress(w.kit) > 0.3); k++) w.step();
    expect(w.view.running).toBe(true);
    // Lever back: it slows, stops and backs up.
    w.sim.setLever(w.engine, -1);
    let off = -1;
    for (let k = 0; k < 6 * SIM_HZ && off < 0; k++) {
      w.step();
      if (!w.view.running) off = k;
    }
    expect(off).toBeGreaterThanOrEqual(0);
    // Called off at once (in logic), the engine eased back (drawn) over a moment, then still.
    let easing = 0;
    while (w.view.busy) {
      easing++;
      w.step();
    }
    expect(easing / SIM_HZ).toBeLessThanOrEqual(LOOP_CANCEL_S + 2 / SIM_HZ);
    const obj = w.objects.carObject(w.engine)!;
    expect(obj.scale.x).toBe(1);
    expect(obj.visible).toBe(true);
    expect(w.view.group.children).toHaveLength(0);
    // Backing on out the way it came, and in again: no show while it backs, a new one as it comes back on.
    for (let k = 0; k < 4 * SIM_HZ; k++) {
      w.step();
      expect(w.view.running).toBe(false);
    }
    w.sim.setLever(w.engine, 1);
    let again = false;
    for (let k = 0; k < 10 * SIM_HZ && !again; k++) {
      w.step();
      if (w.view.running) again = true;
    }
    expect(again).toBe(true);
  });

  it("a kit taken up or moved mid-show, or the engine taken away, calls it off", () => {
    const w = line();
    while (!w.view.running) w.step();
    while (w.view.progress(w.kit) < 0.3) w.step();
    w.layout.liftPiece(w.kit);
    w.view.sync(w.layout);
    // Off at once; the engine eased back over a moment (the frame loop asks while it's busy), then shown.
    expect(w.view.running).toBe(false);
    expect(w.view.count).toBe(0);
    expect(w.view.busy).toBe(true);
    for (let k = 0; k < LOOP_CANCEL_S * SIM_HZ + 2; k++) w.step();
    expect(w.view.busy).toBe(false);
    expect(w.objects.carObject(w.engine)!.visible).toBe(true);
    expect(w.objects.carObject(w.engine)!.scale.x).toBe(1);
    expect(w.view.group.children).toHaveLength(0);
    // The engine taken away mid-loop: the copy shrinks away where it is, over a moment.
    const v = line();
    while (v.view.progress(v.kit) < 0.3) v.step();
    const copy = v.view.copyAt(v.kit)!;
    v.sim.removeTrain(v.train().id);
    v.step();
    expect(v.view.running).toBe(false);
    const scales: number[] = [];
    while (v.view.busy) {
      scales.push(copy.scale.x);
      v.step();
    }
    expect(scales.length).toBeGreaterThan(LOOP_CANCEL_S * SIM_HZ * 0.8);
    for (let k = 1; k < scales.length; k++) expect(scales[k]).toBeLessThan(scales[k - 1]);
    expect(v.view.group.children).toHaveLength(0);
  });
});
