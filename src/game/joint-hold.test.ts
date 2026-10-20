import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from "three";
import { Editor } from "../editor/editor";
import { hillsOf, inRiver, type BlockReason } from "../landscape";
import { deserializeWorld, serializeWorld } from "../persist/save";
import {
  connectorRef,
  createWorldConnector,
  DrawLine,
  fitAutoStraight,
  getPieceDef,
  JOINT_ANGLE_TOLERANCE,
  JOINT_POS_TOLERANCE,
  normalizeAngle,
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
const report = (layout: Layout) => [...layout.joints()].map((j) => `${Math.floor(j.a / 4)}-${Math.floor(j.b / 4)}: ${deg(j.angleError).toFixed(3)}° ${j.posError.toFixed(2)} mm`).join("\n");

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
