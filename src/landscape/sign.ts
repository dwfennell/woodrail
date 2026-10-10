import { TRACK_WIDTH } from "../track";
import type { Town } from "./generate";

export const SIGN_WIDTH = 84;
export const SIGN_THICKNESS = 3;
/** Along the station from its socket end: beyond the station house, inside the platform. */
const ALONG = 160;
/** At the back edge of the platform, clear of the canopy posts. */
const LATERAL = TRACK_WIDTH / 2 + 37;
/** Height of the board's centre: low enough to sit under the canopy. */
export const SIGN_Y = 41;

/**
 * Where a town's station name board stands (centre of the board in plan, facing the track). It stays within the
 * station's protected footprint, so no track can be laid through it.
 */
export function signPose(town: Town): { x: number; z: number; heading: number } {
  const s = town.station;
  const dx = Math.cos(s.heading);
  const dz = Math.sin(s.heading);
  return { x: s.x + dx * ALONG - dz * LATERAL, z: s.z + dz * ALONG + dx * LATERAL, heading: s.heading };
}
