import { TRACK_WIDTH } from "../track";
import type { Town } from "./generate";

export const SIGN_WIDTH = 120;
export const SIGN_HEIGHT = 32;
export const SIGN_THICKNESS = 3;
/** Top of the station house's roof, which the board stands on. */
export const STATION_ROOF_TOP = 14 + 48 + 2.5;
/** Along the station from its socket end: over the middle of the station house. */
const ALONG = 108;
/** Over the station house, behind the platform and its canopy. */
const LATERAL = TRACK_WIDTH / 2 + 58;
/** Height of the board's centre: on posts above the roof, its bottom above the canopy, so neither hides it. */
export const SIGN_Y = STATION_ROOF_TOP + 24 + SIGN_HEIGHT / 2;

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
