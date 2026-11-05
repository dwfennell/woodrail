import { SURF_SEA, type Landscape } from "../landscape";
import type { Pose } from "../track";
import { depotPoint } from "./harbours";

/**
 * The train ferry abroad (Game mode's Train ferry; docs/superpowers/specs/2026-11-04-water-transport.md §5, choice E1):
 * a ferry slip on the shore, its track ending at the sea's edge. A train routed there rides the ferry out to sea and
 * comes back a few minutes later: its load sold abroad at a town's full price, its wagons filled with goods from abroad.
 */

/** The slip's line is this long; the ferry ties up past its end. */
export const SLIP_LENGTH = 216;

/** Why a ferry slip can't stand here (its end must be at the sea), or null. */
export function slipWhy(land: Landscape, pose: Pose): string | null {
  const g = land.grid;
  let sea = 0;
  for (const t of [SLIP_LENGTH + 40, SLIP_LENGTH + 110, SLIP_LENGTH + 180]) {
    const p = depotPoint(pose, t, 0);
    const cell = g.cellAtWorld(p.x, p.z);
    if (cell !== -1 && g.surface[cell] === SURF_SEA) sea++;
  }
  return sea >= 2 ? null : "A ferry slip goes on the shore, its end at the open sea";
}
