import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { Editor } from "../editor/editor";
import { hillsOf, inRiver, type BlockReason } from "../landscape";
import { deserializeWorld, serializeWorld } from "../persist/save";
import { SIM_DT } from "../sim";
import {
  connectorRef,
  createWorldConnector,
  DrawLine,
  fitAutoStraight,
  getPieceDef,
  JOINT_ANGLE_TOLERANCE,
  JOINT_POS_TOLERANCE,
  normalizeAngle,
  pieceOfRef,
  solveParentPose,
  transformPose,
  type DrawCandidate,
  type DrawEnd,
  type DrawOptions,
  type Layout,
  type PieceTypeId,
} from "../track";
import { Progress } from "./progress";
import { isFree, thingsFor } from "./things";
import { drawMessage, drawRefusal, trackMessage, trackPlacement, type TrackRules } from "./track-rules";
import { createWorld, type World } from "./world";

/**
 * QA: a drawn line from the sawmill to Larkfield (seed 7, the starter map, a fresh Game) closed with two joints over
 * the joint tolerance (8.1° at the sawmill, 6.3° mid-line). They held while playing but were refused on load, so the
 * track split after Continue. Drawn here as the game draws it (QA's camera on a 360 × 740 touch screen, the stroke's
 * moves read on the ground), put down through the game's editor (stations and depots fixed), saved and loaded.
 */

function gameStock(world: World, progress: Progress = Progress.fresh()) {
  return (type: PieceTypeId): number => {
    let n = Infinity;
    for (const [id, k] of thingsFor({ kind: "piece", type })) {
      if (!progress.knows(id)) return 0;
      if (isFree(id)) continue;
      n = Math.min(n, Math.floor(progress.available(world, id) / k));
    }
    return n;
  };
}

/** As DrawHand sets a line up (see draw-qa.test.ts). */
function drawOptions(world: World): DrawOptions {
  const land = world.landscape;
  const layout = world.layout;
  const rules: TrackRules = { land, layout, props: world.props, footprint: () => undefined };
  const hills = hillsOf(land.grid);
  const stock = gameStock(world);
  return {
    check: (c) => {
      const p = trackPlacement(rules, c.type, c.flipped, c.pose, c.y, -1);
      const why = drawRefusal(land, c.type, c.flipped, c.pose, c.y, p.reason, p.risers);
      return why ? { reason: why.reason, message: drawMessage(why.reason, why.levels, (r) => trackMessage(r as BlockReason, why.levels)), levels: why.levels } : null;
    },
    allow: (type, line) => line.filter((p) => p.type === type).length < stock(type),
    meet: (e: DrawEnd): DrawCandidate | null => {
      const seated = e.kind === "peg" ? 0 : 1;
      const long = getPieceDef("straight-216", false);
      const pose = solveParentPose(long.connectors[seated].pose, { x: e.x, z: e.z, heading: e.heading + Math.PI }, { x: 0, z: 0, heading: 0 });
      const fit = fitAutoStraight(layout, pose, e.y, seated, []);
      if (!fit || fit.gap) return null;
      const def = getPieceDef(fit.type, fit.flipped);
      if (def.connectors.length !== 2) return null;
      const exit = 1 - seated;
      const w = transformPose(fit.pose, def.connectors[exit].pose, { x: 0, z: 0, heading: 0 });
      return { type: fit.type, flipped: fit.flipped, pose: fit.pose, y: e.y, entry: seated, exit, length: fit.length, end: { x: w.x, z: w.z, heading: w.heading, y: e.y, kind: def.connectors[exit].kind } };
    },
    closes: (e) => {
      const near: number[] = [];
      const w = createWorldConnector();
      const n = layout.queryFreeConnectors(e.x, e.z, JOINT_POS_TOLERANCE, near);
      for (let i = 0; i < n; i++) {
        layout.worldConnector(near[i], w);
        if (Math.abs(w.y - e.y) > 2 || Math.hypot(w.x - e.x, w.z - e.z) > JOINT_POS_TOLERANCE) continue;
        if (Math.abs(normalizeAngle(w.heading - e.heading - Math.PI)) <= JOINT_ANGLE_TOLERANCE) return true;
      }
      return false;
    },
    nearTrack: (e, reach) => layout.queryFreeConnectors(e.x, e.z, reach, []) > 0,
    groundAt: (x, z) => hills.groundAt(x, z),
    wet: (x, z) => inRiver(land.grid, x, z),
    onMap: (x, z) => land.grid.cellAtWorld(x, z) !== -1,
    outOf: (type) => `Out of ${type}`,
  };
}

/** The free end at (x, z) (where the stroke is pressed). */
function freeEndAt(layout: Layout, x: number, z: number): DrawEnd {
  const near: number[] = [];
  const n = layout.queryFreeConnectors(x, z, 20, near);
  expect(n).toBeGreaterThan(0);
  const w = layout.worldConnector(near[0], createWorldConnector());
  return { x: w.x, z: w.z, heading: w.heading, y: w.y, kind: w.kind };
}

/**
 * QA's stroke: the game's camera on a 360 × 740 screen (PerspectiveCamera 30°), centred on (−1062, 18) at 1900 mm as
 * `Game.lookAt` puts it, tilted 0.95, from theta −2 (which lays QA's very line, joints to 0.001°: 8.149° at the sawmill,
 * 2.244, 3.596, 6.338, 2.330, 0.394 and 2.264° at Larkfield); the stroke's world points seen on the ground, touch
 * moves every 10 px, each read on the plane at the line's height.
 */
function qaStroke(world: World, pts: readonly [number, number][]): DrawLine {
  const W = 360;
  const H = 740;
  const [tx, tz, dist] = [-1062, 18, 1900];
  const camera = new PerspectiveCamera(30, W / H, 5, 40000);
  const phi = 0.95;
  const theta = -2;
  camera.position.set(tx + Math.sin(theta) * Math.sin(phi) * dist, Math.cos(phi) * dist, tz + Math.cos(theta) * Math.sin(phi) * dist);
  camera.lookAt(tx, 0, tz);
  camera.updateMatrixWorld();
  const ray = new Raycaster();
  const level = new Plane(new Vector3(0, 1, 0), 0);
  const planeAt = (sx: number, sy: number, y: number) => {
    ray.setFromCamera(new Vector2((sx / W) * 2 - 1, -(sy / H) * 2 + 1), camera);
    level.constant = -y;
    const v = ray.ray.intersectPlane(level, new Vector3());
    return v ? { x: v.x, z: v.z } : null;
  };
  const toScreen = (x: number, z: number): [number, number] => {
    const v = new Vector3(x, 0, z).project(camera);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  };
  const screen: [number, number][] = [toScreen(...pts[0])];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = toScreen(...pts[i - 1]);
    const [bx, by] = toScreen(...pts[i]);
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
    for (let k = 1; k <= n; k++) screen.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  const line = new DrawLine(freeEndAt(world.layout, ...pts[0]), drawOptions(world));
  for (const [sx, sy] of screen.slice(1)) line.addSeen((y) => planeAt(sx, sy, y));
  line.finish();
  return line;
}

const deg = (r: number) => (r * 180) / Math.PI;
const jointsOf = (layout: Layout) => [...layout.joints()].map((j) => `${j.a}-${j.b}`).sort();
const report = (layout: Layout) => [...layout.joints()].map((j) => `${pieceOfRef(j.a)}-${pieceOfRef(j.b)}: ${deg(j.angleError).toFixed(3)}° ${j.posError.toFixed(2)} mm`).join("\n");

describe("QA: a drawn line's joints hold through a save and load", () => {
  it("the stroke from the sawmill to Larkfield closes with every joint within tolerance, and loads joined the same", () => {
    const world = createWorld(7, true);
    const fixed = new Set([...world.stations.values(), ...world.depots.values()]);
    const editor = new Editor(world.layout, world.sim, () => {}, (id) => fixed.has(id));
    const line = qaStroke(world, [
      [-1476, -72],
      [-1476, 60],
      [-1300, 108],
      [-648, 108],
    ]);
    const ids = editor.placeRun(line.placeable());
    const why = `${line.pieces.map((p) => p.type).join(", ")}\n${report(world.layout)}`;
    for (const j of world.layout.joints()) {
      expect(j.angleError, why).toBeLessThanOrEqual(JOINT_ANGLE_TOLERANCE);
      expect(j.posError, why).toBeLessThanOrEqual(JOINT_POS_TOLERANCE);
    }
    // Every drawn piece joined at both ends: the line runs unbroken from the sawmill to Larkfield.
    for (const id of ids) for (const i of [0, 1]) expect(world.layout.joinedConnector(connectorRef(id, i)), why).not.toBe(-1);
    const loaded = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(world))));
    if (!loaded.ok) throw new Error(loaded.error);
    expect(jointsOf(loaded.value.layout)).toEqual(jointsOf(world.layout));
  });
});

/** QA's line as main laid it (the live poses QA logged), with joints of 8.149° at the sawmill and 6.338° mid-line. */
const QA_LINE = [
  { id: 8, type: "straight-54", flipped: false, pose: { x: -1474.82136001023, z: -71.81197803187507, heading: 1.4285617612548278 } },
  { id: 9, type: "curve-small", flipped: true, pose: { x: -1465.9882092722885, z: -18.16943831057526, heading: 1.3893997557748223 } },
  { id: 10, type: "curve-wide", flipped: true, pose: { x: -1427.4013016877939, z: 39.85794598990954, heading: 0.6667587358107459 } },
  { id: 11, type: "straight-216", flipped: false, pose: { x: -1227.2856270410823, z: 95.9700965295593, heading: -0.00802620568061186 } },
  { id: 12, type: "straight-144", flipped: false, pose: { x: -1010.1134451490739, z: 94.41579872082777, heading: 0.03263674638071597 } },
  { id: 13, type: "straight-216", flipped: false, pose: { x: -865.0107362523145, z: 99.29026086462507, heading: 0.03952016712254344 } },
] as const;

/** Is there a way along joints from piece `from` to piece `to`? */
function joinedThrough(layout: Layout, from: number, to: number): boolean {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) {
    const id = todo.pop()!;
    if (id === to) return true;
    const p = layout.getPiece(id)!;
    for (let i = 0; i < getPieceDef(p.type, p.flipped).connectors.length; i++) {
      const other = layout.joinedConnector(connectorRef(id, i));
      if (other === -1 || seen.has(pieceOfRef(other))) continue;
      seen.add(pieceOfRef(other));
      todo.push(pieceOfRef(other));
    }
  }
  return false;
}

describe("QA: a save from before saves listed their joints (the line it split)", () => {
  /** Seed 7's starter map with QA's line on it, saved as an older build saved it: no `joints`. */
  function oldSave() {
    const world = createWorld(7, true);
    for (const p of QA_LINE) world.layout.restorePiece(p.id, p.type, p.pose, 0, p.flipped);
    const data = JSON.parse(JSON.stringify(serializeWorld(world)));
    delete data.joints;
    return { world, data };
  }

  it("comes back joined from the sawmill to Larkfield, every joint brought within the tolerance, and a train runs through", () => {
    const { world, data } = oldSave();
    const sawmill = 6;
    const larkfield = world.stations.get(world.landscape.towns[0].id)!;
    expect(world.layout.getPiece(sawmill)!.type).toBe("depot-sawmill");
    // (Seated afresh by the tolerance, as loading did: the sawmill joint and 10-11 part.)
    expect(joinedThrough(world.layout, sawmill, larkfield)).toBe(false);
    const t0 = performance.now();
    const loaded = deserializeWorld(data);
    const ms = performance.now() - t0;
    if (!loaded.ok) throw new Error(loaded.error);
    const { layout } = loaded.value;
    const why = `${report(layout)}\n(loaded in ${ms.toFixed(1)} ms)`;
    expect(joinedThrough(layout, sawmill, larkfield), why).toBe(true);
    for (const p of QA_LINE) for (const i of [0, 1]) expect(layout.joinedConnector(connectorRef(p.id, i)), why).not.toBe(-1);
    for (const j of layout.joints()) {
      expect(j.angleError, why).toBeLessThanOrEqual(JOINT_ANGLE_TOLERANCE);
      expect(j.posError, why).toBeLessThanOrEqual(JOINT_POS_TOLERANCE);
    }
    // Stations and depots where they were.
    for (const id of [sawmill, larkfield]) expect(layout.getPiece(id)!.pose).toEqual(world.layout.getPiece(id)!.pose);
    // A train on the middle of the line runs to each end (one facing each way, on loads of their own).
    const visited = new Set<number>();
    for (const reversed of [false, true]) {
      const w = deserializeWorld(data);
      if (!w.ok) throw new Error(w.error);
      const placed = w.value.sim.addTrain(["engine"], { pieceId: 11, pathIndex: 0, reversed, s: 100 });
      expect(placed.kind).toBe("placed");
      if (placed.kind !== "placed") return;
      const train = w.value.sim.getTrain(placed.trainId)!;
      w.value.sim.setLever(train.cars[0].id, 1);
      for (let i = 0; i < 40 / SIM_DT && !train.derailed; i++) {
        w.value.sim.tick();
        visited.add(train.bogies[0].pieceId);
      }
      expect(train.derailed).toBe(false);
    }
    for (const id of [sawmill, ...QA_LINE.map((p) => p.id), larkfield]) expect([...visited], why).toContain(id);
    // And it saves with its joints from now on: loaded again, the same.
    const again = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(loaded.value))));
    if (!again.ok) throw new Error(again.error);
    expect(jointsOf(again.value.layout)).toEqual(jointsOf(layout));
  });

  it("leaves ends apart that are further apart than the tolerances", () => {
    // QA's line with its last straight pulled 12 mm short of Larkfield, and with the curve-wide turned 12° off.
    for (const [shift, turn] of [[12, 0], [0, (12 * Math.PI) / 180]] as const) {
      const world = createWorld(7, true);
      for (const p of QA_LINE) {
        const pose = p.id === 13 ? { ...p.pose, x: p.pose.x - shift } : p.pose;
        world.layout.restorePiece(p.id, p.type, pose, 0, p.flipped);
      }
      if (turn) {
        // Pieces 11-13 turned about the 10-11 joint.
        const at = world.layout.worldConnector(connectorRef(10, 1), createWorldConnector());
        const turned = new Map(
          [11, 12, 13].map((id) => {
            const q = world.layout.getPiece(id)!.pose;
            const x = q.x - at.x;
            const z = q.z - at.z;
            return [id, { x: at.x + x * Math.cos(turn) - z * Math.sin(turn), z: at.z + x * Math.sin(turn) + z * Math.cos(turn), heading: q.heading + turn }];
          }),
        );
        world.layout.nudgePieces(turned);
      }
      const data = JSON.parse(JSON.stringify(serializeWorld(world)));
      delete data.joints;
      const loaded = deserializeWorld(data);
      if (!loaded.ok) throw new Error(loaded.error);
      const larkfield = world.stations.get(world.landscape.towns[0].id)!;
      const why = `${shift} mm, ${turn} rad\n${report(loaded.value.layout)}`;
      if (shift) expect(loaded.value.layout.joinedConnector(connectorRef(13, 1)), why).toBe(-1);
      else expect(joinedThrough(loaded.value.layout, 10, 11) && loaded.value.layout.jointAt(connectorRef(10, 1))?.b === connectorRef(11, 0), why).toBe(false);
      expect(joinedThrough(loaded.value.layout, 6, larkfield), why).toBe(false);
    }
  });
});
