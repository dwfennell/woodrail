import { getPieceDef } from "../track";
import type { World } from "./world";

/**
 * Lift bridges and boats: the hook the water's boats (claude/water) use to get under one. A boat coming along a river
 * finds the lift bridges over its way (`liftBridgesNear`) and asks each to let it through (`askToPass`): the span goes
 * up if no train is on it or coming (`Sim.raiseBridge`), stays up a while and comes down by itself; the boat passes
 * while it's `"open"`, and waits and asks again on `"wait"`. Today a tap on the bridge raises it too (`Sim.toggleSwitch`).
 */
export type PassAnswer = "open" | "rising" | "wait";

/** Ask a lift bridge to let a boat through: open now, on its way up, or wait (a train's on it or coming). */
export function askToPass(world: World, pieceId: number): PassAnswer {
  const sim = world.sim;
  if (sim.bridgeOpen(pieceId)) return "open";
  if (sim.bridgeRaised(pieceId)) return "rising";
  return sim.raiseBridge(pieceId) ? "rising" : "wait";
}

/** The lift bridges whose span passes within `reach` (mm) of (x, z): those over a boat's way there. A few pieces: cheap. */
export function liftBridgesNear(world: World, x: number, z: number, reach: number): number[] {
  const out: number[] = [];
  for (const id of world.layout.pieceIds()) {
    const p = world.layout.getPiece(id)!;
    const def = getPieceDef(p.type, p.flipped);
    if (!def.drawbridge) continue;
    const g = def.paths[0].geom;
    if (g.kind !== "line") continue;
    // The span's middle line in the world, and the nearest point on it.
    const ch = Math.cos(p.pose.heading);
    const sh = Math.sin(p.pose.heading);
    const ax = p.pose.x + g.start.x * ch - g.start.z * sh;
    const az = p.pose.z + g.start.x * sh + g.start.z * ch;
    const hd = p.pose.heading + g.start.heading;
    const u = Math.max(0, Math.min(g.length, (x - ax) * Math.cos(hd) + (z - az) * Math.sin(hd)));
    if (Math.hypot(ax + u * Math.cos(hd) - x, az + u * Math.sin(hd) - z) <= reach) out.push(id);
  }
  return out;
}
