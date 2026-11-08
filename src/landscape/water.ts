import { isHilliness, LEGACY_HILLS, type Hilliness } from "./hills";

/**
 * How much water a map has: rivers (and the lakes they end in where they can't join up), chosen before a new game (the
 * new-game screen, `ui/new-game.ts`) and saved with the map (`Landscape.water`), so land bought later has the same.
 * In order, driest first. The sea is its own choice (`Landscape.coast`, on or off).
 */
export const WATER = ["none", "some", "lots"] as const;
export type Water = (typeof WATER)[number];

/** A new map's water unless the player picks other: the rivers as they always were. */
export const DEFAULT_WATER: Water = "some";
/** The water of a map saved before there was a choice (no `water` in its save): the rivers as they were made then. */
export const LEGACY_WATER: Water = "some";

export const WATER_LABEL: Record<Water, string> = { none: "None", some: "Some", lots: "Lots" };
export const WATER_BLURB: Record<Water, string> = {
  none: "No rivers or lakes at the start; a few far out",
  some: "Rivers and the odd lake, as the land has always had",
  lots: "Rivers everywhere, and more lakes",
};

export const isWaterSetting = (v: unknown): v is Water => typeof v === "string" && (WATER as readonly string[]).includes(v);

/** The start region's plots (see `START_REGION`): px −1…0, pz −1…0. */
const START = { px0: -1, px1: 0, pz0: -1, pz1: 0 };
const inStart = (px: number, pz: number) => px >= START.px0 && px <= START.px1 && pz >= START.pz0 && pz <= START.pz1;

/**
 * The chance a river crosses a plot's edge (its west edge if `vertical`, else its north: see `edgeContract`). Some is
 * the chance it always was, 0.38: an older map's rivers come out as they were. None: no river into or between the start
 * region's plots (so none in it, and no lake), and a few further out (a bridge, a landing or a water pump still have
 * somewhere to go, on land bought). Lots: most edges.
 */
export function riverChance(water: Water, vertical: boolean, px: number, pz: number): number {
  if (water === "some") return 0.38;
  if (water === "lots") return 0.7;
  const other = vertical ? { px: px - 1, pz } : { px, pz: pz - 1 };
  return inStart(px, pz) || inStart(other.px, other.pz) ? 0 : 0.15;
}

/**
 * A map's code, to share: its seed, then what isn't as an older map was made (the same words a `#seed-…` link takes):
 * "12345-gentle", "7-flat-water-lots-nocoast". The seed alone is the land as it always was (Hilly, Some water, the sea).
 */
export interface MapSettings {
  seed: number;
  hills: Hilliness;
  water: Water;
  coast: boolean;
}

export function mapCode(m: MapSettings): string {
  const parts = [String(m.seed)];
  if (m.hills !== LEGACY_HILLS) parts.push(m.hills);
  if (m.water !== LEGACY_WATER) parts.push(`water-${m.water}`);
  if (!m.coast) parts.push("nocoast");
  return parts.join("-");
}

/** The most digits a seed has (a link's `#seed-…` takes up to 9). */
export const MAX_SEED = 999_999_999;

/** A map code read back (`mapCode`'s, or a seed alone): null if it isn't one. Settings it doesn't name are the old map's. */
export function parseMapCode(text: string): MapSettings | null {
  const m = /^\s*(\d{1,9})((?:-[a-z]+)*)\s*$/.exec(text.toLowerCase());
  if (!m) return null;
  const out: MapSettings = { seed: Number(m[1]), hills: LEGACY_HILLS, water: LEGACY_WATER, coast: true };
  const words = m[2].split("-").filter(Boolean);
  for (let k = 0; k < words.length; k++) {
    const w = words[k];
    if (isHilliness(w)) out.hills = w;
    else if (w === "water" && isWaterSetting(words[k + 1])) out.water = words[++k] as Water;
    else if (w === "nocoast") out.coast = false;
    else return null;
  }
  return out;
}
