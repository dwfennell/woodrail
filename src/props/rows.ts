import { hashInts } from "../landscape/edges";

/**
 * Towns in rows (spec 2026-11-14-town-rows-design.md): a town's houses and shops drawn as joined rows on pavement
 * tiles (the `row-*` models, tools/blender/bldg_rows.py), in a palette of the town's own. Dev only for now, behind
 * `rowsOn`: nothing here is used without it.
 */

/** The dev server with `?rows` in the address. */
export const rowsOn = (): boolean => import.meta.env.DEV && typeof location !== "undefined" && new URLSearchParams(location.search).has("rows");

/** A row model's id (a catalogue asset in the `row` file). */
export const isRow = (asset: string): boolean => asset.startsWith("row-");

/** The body colours a row building can wear, and each one's door. (The first four are what an old save's 0 to 3 mean.) */
export const ROW_BODIES = ["#f3e7cb", "#c8483a", "#e6ae3e", "#57a394", "#3f6fb0", "#d98a6a", "#a9c4cf", "#7d9a4a"] as const;
const ROW_DOORS = ["#2f6048", "#f3e7cb", "#3f6fb0", "#f3e7cb", "#f3e7cb", "#2f6048", "#c8483a", "#f3e7cb"] as const;
/** The roof colours: tile, slate, moss, brown. */
export const ROW_ROOFS = ["#b9462f", "#4d5d6e", "#2f6048", "#7a5a48"] as const;

/** The colours a row model's slots take for a prop's `variant`: a body (and its door) and a roof, the same in every town. */
export function rowColours(variant: number): { body: string; second: string; roof: string; door: string } {
  const v = Math.max(0, Math.floor(variant));
  const body = v % ROW_BODIES.length;
  // (The second house of a pair or a terrace: three on round the list, so the two never match.)
  return { body: ROW_BODIES[body], second: ROW_BODIES[(body + 3) % ROW_BODIES.length], roof: ROW_ROOFS[Math.floor(v / ROW_BODIES.length) % ROW_ROOFS.length], door: ROW_DOORS[body] };
}

/** The stand-in colours a row model is made in (tools/blender/bldg_rows.py), and what each becomes for `variant`. */
export function rowPaint(variant: number): (colour: string) => string {
  const c = rowColours(variant);
  const swap: Record<string, string> = { "#ff00a0": c.body, "#ffa000": c.second, "#00ffa0": c.roof, "#a000ff": c.door };
  return (colour) => swap[colour] ?? colour;
}

/** The colours a town builds in (indices into `ROW_BODIES` and `ROW_ROOFS`): five bodies, two roofs, three from a city on. */
export interface RowPalette {
  bodies: number[];
  roofs: number[];
}

/** `n` numbers below `of`, in an order of the town's own. */
function drawn(of: number, n: number, seed: number): number[] {
  return Array.from({ length: of }, (_, k) => k)
    .sort((a, b) => hashInts(seed, a) - hashInts(seed, b) || a - b)
    .slice(0, n);
}

export function townPalette(seed: number, townId: number, level: number): RowPalette {
  const s = hashInts(seed, townId, 0x70a1);
  return { bodies: drawn(ROW_BODIES.length, 5, s), roofs: drawn(ROW_ROOFS.length, level >= 3 ? 3 : 2, s ^ 0x5eed) };
}

/**
 * A new slice's `variant`: from the town's palette by `hash` (its squares' and its town's), never the body colour of
 * a slice already standing beside it (`besides`: their variants) while the palette has another.
 */
export function rowVariant(palette: RowPalette, hash: number, besides: readonly number[]): number {
  const taken = new Set(besides.map((v) => Math.floor(v) % ROW_BODIES.length));
  const h = hash >>> 0;
  let body = palette.bodies[h % palette.bodies.length];
  for (let k = 1; k < palette.bodies.length && taken.has(body); k++) body = palette.bodies[(h + k) % palette.bodies.length];
  const roof = palette.roofs[(h >>> 8) % palette.roofs.length];
  return body + ROW_BODIES.length * roof;
}

/** The row models, by the squares their lot has. */
export const ROW_ASSETS = {
  one: {
    /** Two narrow houses side by side under their own roofs. */
    pair: ["row-pair-a", "row-pair-b", "row-pair-c"],
    /** One house the width of its lot. */
    wide: ["row-wide-a", "row-wide-b", "row-wide-c"],
    /** A cottage or a bungalow: it stays low. */
    low: ["row-low-a", "row-low-b"],
    shop: ["row-shop", "row-toy-shop"],
    corner: ["row-corner-shop"],
  },
  two: { terrace: "row-terrace", bakery: "row-bakery", cafe: "row-cafe", post: "row-post", flats: "row-flats" },
  four: { court: "row-court" },
} as const;

/** Every row model's id. */
export const rowAssetIds = (): string[] => [...Object.values(ROW_ASSETS.one).flat(), ...Object.values(ROW_ASSETS.two), ...Object.values(ROW_ASSETS.four)];

/** The plain houses a town picks its three one-square styles from. */
export const ROW_HOUSES_1: readonly string[] = [...ROW_ASSETS.one.pair, ...ROW_ASSETS.one.wide, ...ROW_ASSETS.one.low];

const OLD: Readonly<Record<string, string>> = {
  "bldg-townhouse": "row-pair-a",
  "bldg-narrow-house": "row-pair-b",
  "bldg-brick-house": "row-wide-a",
  "bldg-timber-house": "row-wide-b",
  "bldg-thatched-cottage": "row-low-a",
  "bldg-bungalow": "row-low-b",
  "bldg-semi-detached": "row-terrace",
  "bldg-villa": "row-terrace",
  "bldg-terrace": "row-terrace",
  "bldg-cottage-row": "row-terrace",
  "bldg-corner-shop": "row-shop",
  "bldg-toy-shop": "row-toy-shop",
  "bldg-apartment-block": "row-flats",
  "bldg-bakery": "row-bakery",
  "bldg-cafe": "row-cafe",
  "bldg-post-office": "row-post",
};

/** The row a building dressed with one of today's house or shop models becomes (none: it keeps its model). */
export const rowFor = (old: string): string | undefined => OLD[old];
