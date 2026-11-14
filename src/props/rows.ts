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
  return { body: ROW_BODIES[body], second: ROW_BODIES[secondOf(body)], roof: ROW_ROOFS[Math.floor(v / ROW_BODIES.length) % ROW_ROOFS.length], door: ROW_DOORS[body] };
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

/** The second house's body colour for a body (a pair's, a terrace's: three on round the list, so the two never match). */
const secondOf = (body: number): number => (body + 3) % ROW_BODIES.length;

/**
 * A new slice's `variant`: from the town's palette by `hash` (its squares' and its town's). Never the body colour of
 * a slice already standing beside it (`besides`: their variants) while the palette has another; and, where it can,
 * neither of its colours either colour of a pair beside it (a pair's second house is a colour of its own).
 */
export function rowVariant(palette: RowPalette, hash: number, besides: readonly number[]): number {
  const bodies = new Set(besides.map((v) => Math.floor(v) % ROW_BODIES.length));
  const seconds = new Set([...bodies].map(secondOf));
  const h = hash >>> 0;
  let body = palette.bodies[h % palette.bodies.length];
  let best = Infinity;
  for (let k = 0; k < palette.bodies.length; k++) {
    const c = palette.bodies[(h + k) % palette.bodies.length];
    // (A body the same as a neighbour's is the worst; a second colour meeting one of theirs, less so.)
    const clash = (bodies.has(c) ? 4 : 0) + (seconds.has(c) ? 1 : 0) + (bodies.has(secondOf(c)) || seconds.has(secondOf(c)) ? 1 : 0);
    if (clash < best) {
      best = clash;
      body = c;
    }
  }
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

/** Every row house's and shop's id (each made four ways, to stack storeys from: see `stackOf`). */
export const rowAssetIds = (): string[] => [...Object.values(ROW_ASSETS.one).flat(), ...Object.values(ROW_ASSETS.two), ...Object.values(ROW_ASSETS.four)];

/**
 * Landmarks and civic places in the style: the model each of today's becomes, by its lot's squares (1; 2 along the
 * street; 4, a 2 x 2 block, the building on the street's two squares and its grounds behind). Each is made for its lot,
 * tile and all, so none is ever drawn smaller than modelled.
 */
export const ROW_CIVIC: Readonly<Record<string, { readonly 1?: string; readonly 2?: string; readonly 4?: string }>> = {
  "bldg-church": { 2: "row-church", 4: "row-church-4" },
  "bldg-market-hall": { 2: "row-market-hall", 4: "row-market-hall-4" },
  "bldg-library": { 1: "row-library-1", 2: "row-library" },
  "bldg-town-hall": { 2: "row-town-hall", 4: "row-town-hall-4" },
  "bldg-fire-station": { 1: "row-fire-station-1", 2: "row-fire-station" },
  "bldg-police-station": { 1: "row-police-station-1", 2: "row-police-station" },
  "bldg-hospital": { 1: "row-hospital-1", 2: "row-hospital", 4: "row-hospital-4" },
  "bldg-station-clock": { 1: "row-clock-tower", 2: "row-clock-tower-2" },
  "bldg-castle-gate": { 4: "row-castle-gate-4" },
  "bldg-lighthouse": { 1: "row-lighthouse", 2: "row-lighthouse-2" },
  "bldg-ice-cream-kiosk": { 1: "row-kiosk", 2: "row-kiosk-2" },
  // (A cinema stands in the toy shop's model: on two squares it has one of its own.)
  "bldg-toy-shop": { 2: "row-cinema" },
};

/** Every civic row model's id, with its lot: squares along the street, and squares deep. */
export function civicAssets(): { id: string; squares: 1 | 2; deep: 1 | 2 }[] {
  const out: { id: string; squares: 1 | 2; deep: 1 | 2 }[] = [];
  for (const by of Object.values(ROW_CIVIC)) {
    if (by[1]) out.push({ id: by[1], squares: 1, deep: 1 });
    if (by[2]) out.push({ id: by[2], squares: 2, deep: 1 });
    if (by[4]) out.push({ id: by[4], squares: 2, deep: 2 });
  }
  return out;
}

/**
 * The civic row one of today's models becomes on a lot of `squares` (none: it has none for that lot). On a 2 x 2
 * block, one made for two squares stands on the street's two.
 */
export function civicRow(old: string, squares: number): string | undefined {
  const by = ROW_CIVIC[old];
  if (!by) return undefined;
  return squares >= 4 ? (by[4] ?? by[2]) : squares === 2 ? by[2] : by[1];
}

/** The squares of the lot a row model is made for: 1, 2 along the street, or 4 (a 2 x 2 block). */
export function rowSquares(asset: string): 1 | 2 | 4 {
  const civic = civicAssets().find((c) => c.id === asset);
  if (civic) return civic.deep === 2 ? 4 : civic.squares;
  if ((Object.values(ROW_ASSETS.four) as string[]).includes(asset)) return 4;
  return (Object.values(ROW_ASSETS.two) as string[]).includes(asset) ? 2 : 1;
}

/** Is this row model one of the churches (a town has one)? */
export const isChurch = (asset: string): boolean => asset === "bldg-church" || asset.startsWith("row-church");

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
