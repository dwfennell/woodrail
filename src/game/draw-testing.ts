import { hillsOf, inRiver, type BlockReason } from "../landscape";
import {
  createWorldConnector,
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
} from "../track";
import { drawMessage, drawRefusal, trackMessage, trackPlacement, type TrackRules } from "./track-rules";
import type { World } from "./world";

// Helpers for the tests of drawing track (not part of the game).

/** As DrawHand sets a line up (see `DrawHand.start`). */
export function drawOptions(world: World, startHeld: boolean): DrawOptions {
  const land = world.landscape;
  const layout = world.layout;
  const rules: TrackRules = { land, layout, props: world.props, footprint: () => undefined };
  const hills = hillsOf(land.grid);
  return {
    check: (c) => {
      const p = trackPlacement(rules, c.type, c.flipped, c.pose, c.y, -1);
      const why = drawRefusal(land, c.type, c.flipped, c.pose, c.y, p.reason, p.risers);
      return why ? { reason: why.reason, message: drawMessage(why.reason, why.levels, (r) => trackMessage(r as BlockReason, why.levels)), levels: why.levels } : null;
    },
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
    freeEnds: (e, reach, out) => {
      out.length = 0;
      const near: number[] = [];
      const w = createWorldConnector();
      const n = layout.queryFreeConnectors(e.x, e.z, reach, near);
      for (let i = 0; i < n; i++) {
        layout.worldConnector(near[i], w);
        if (Math.abs(w.y - e.y) > 2 || Math.hypot(w.x - e.x, w.z - e.z) > reach) continue;
        if (Math.cos(w.heading - e.heading - Math.PI) < -0.2) continue;
        out.push({ x: w.x, z: w.z, heading: w.heading, y: w.y, kind: w.kind });
      }
      return out.length;
    },
    startHeld,
    groundAt: (x, z) => hills.groundAt(x, z),
    wet: (x, z) => inRiver(land.grid, x, z),
    onMap: (x, z) => land.grid.cellAtWorld(x, z) !== -1,
    outOf: (type) => `Out of ${type}`,
  };
}
