import { SIM_HZ } from "../sim";

/** Ticks in `seconds` of simulated time. */
export const ticks = (seconds: number) => Math.round(seconds * SIM_HZ);

/** Units a timber wagon carries, all of one kind. */
export const WAGON_CAPACITY = 3;
/** The most a wagon can hold, with every upgrade (heavy wagons). */
export const MAX_WAGON_CAPACITY = 5;
/** Most units any pile holds. */
export const PILE_CAP = 12;

export const FOREST_TICKS = ticks(15);
export const SAWMILL_TICKS = ticks(8);
export const TOWN_USE_TICKS = ticks(30);
/** The crane moves one unit in this time. */
export const CRANE_TICKS = ticks(0.6);
/** A train on a working depot crawls at this speed (mm/s). */
export const CRAWL_SPEED = 60;
