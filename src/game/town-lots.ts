import { SURF_TOWN, type Landscape } from "../landscape";

/**
 * A town's lots, as the industries' site rules (`SITE_RULES`) count them. Kept apart from `world.ts` so the rules can
 * be read while `world.ts` itself is still loading (it generates the map's sites with them: `map-sites.ts`).
 */

/** How far (mm) from a school's yard a town's lots may be: it stands beside the town (see `schoolTown`). */
export const SCHOOL_REACH = 300;

/** Is square `i` one of a town's lots (its buildings, its station, its built-up ground)? */
export const isTownLot = (land: Landscape, i: number): boolean => land.grid.surface[i] === SURF_TOWN;
