import { PILE_CAP, RECIPES } from "../economy";

// The save's version and limits: shared by `save.ts` and its schemas (`save-schema.ts`, loaded on its own), so
// the schemas needn't load the save's module (and what it loads) with them.

/**
 * Save format, version 15 (town buildings record the level they went up at, `Building.born`, and only some houses rise:
 * an older save's town storeys are dropped as it loads and given again by the new rule, `TOWN_STOREYS_FROM`; 14: car
 * ids and the sim's id counters, so ids last across a load: older saves load with fresh ids, as before; 13: the growth menu: a town's offer is three cards, never a blueprint, saved with the progress;
 * 12: research, the school a depot beside a town, saved with its town's id; 11: town
 * buildings at their new sizes, the biggest landmarks on 2×2 lots; 10: lines, routes with a colour and a name). Plain JSON validated with Zod (`save-schema.ts`, loaded
 * on its own: `schemas.ts`); only these modules (and `landscape-data`) know its shape. The landscape is saved square by square (see `landscape-data.ts`): loading
 * never regenerates it. No backward compatibility until the game reaches v1: a save older than `MIGRATES_FROM` is
 * turned away (`OLDER_SAVE`), and the game starts afresh.
 */
export const SAVE_VERSION = 15;

/** The biggest pile any depot keeps (a warehouse's). */
export const MAX_PILE = Math.max(PILE_CAP, ...Object.values(RECIPES).map((r) => r.cap ?? 0));
/** The fastest a train is saved going (mm/s): well over any engine's top speed. */
export const MAX_SAVED_SPEED = 1000;
/** Most people saved riding one coach, or waiting at one station. */
export const MAX_RIDERS = 24;
