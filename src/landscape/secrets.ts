import { HALT_Z, SECRET_HALT, SHIPWRECK_SEA_Z, SITE_BOUNDS } from "../catalogue/secret-frame";
import { rng } from "../lib/rng";
import type { Pose, SecretKind } from "../track";
import { seaPlot, shoreLine, type Coast } from "./coast";
import { hashInts, type Region } from "./edges";
import { flattenUnder, reachable, SITE_TOWN_SPACING, snapshotRegion, START_REGION, type Landscape } from "./generate";
import { CELL, FEAT_NONE, FEAT_SECRET, FEAT_TREE, PLOT_COLS, PLOT_ROWS, SURF_GRASS, SURF_SAND, SURF_SEA, type PlotCoord } from "./grid";

/**
 * Secrets on the map (spec docs/superpowers/specs/2026-11-05-character-and-goals.md, "Secret sites"): six hidden
 * places, each found by laying track to it (src/game/secrets.ts), then a tourist stop with its own halt.
 *
 * Where they go is planned once per map (`planSecrets`, saved with the land as `Landscape.secretPlan`), so a plot's
 * land for sale has the same secret every time it's made, whatever order the plots are made or bought in:
 * - at most one in the start (the plots a game begins with), the rest in land that's bought;
 * - spread out: no two in the same or neighbouring plots (diagonals too), in the first rings of plots round the start;
 * - the shipwreck only on a coast plot, on its beach (its stern at the water's edge); a map with no coast (a save from
 *   before the coast) gets another of the inland ones in its place.
 * Each is placed as its plot's land is made (`addPlotSecret`, after the plot's own towns, depots and old sites), on
 * open ground it levels and clears of trees, its squares kept as a ruin's are (`FEAT_SECRET`).
 */

/** The secrets that stand inland (all but the shipwreck), in the order a map with no coast takes a second from. */
export const INLAND_SECRETS: readonly SecretKind[] = ["castle", "stones", "lost-mine", "lake", "footprint"];

/** A secret planned for a plot (`planSecrets`). */
export interface SecretPlan {
  kind: SecretKind;
  px: number;
  pz: number;
  /** An alternate (1, 2): its kind goes here only if every earlier choice for it (`alt` less) had no room. */
  alt?: number;
}

/** A secret site on the map: where it stands, and whether it's been found. Ids are places in `Landscape.secrets`. */
export interface SecretSite {
  id: number;
  kind: SecretKind;
  /** Its halt's straight: where it starts (the open end a line joins), heading along it to the buffer. */
  piece: Pose;
  /** The plot it was placed in. */
  plot: PlotCoord;
  /** Found (track laid to it): its halt is laid, and it's a tourist stop from then on (src/game/secrets.ts). */
  found?: boolean;
  /** Tourist trips to it: riders who got off at its halt (and the fares they paid, coins). */
  trips?: number;
  fares?: number;
  /** Its trips by the town each rider came from (town id → trips). */
  from?: Record<number, number>;
  /** Its trips this year: [the year, trips]. */
  year?: [number, number];
}

/** Salt for the secrets' plan and placement streams. */
const SALT = 0x5ec3e7;

/** How many rings of plots round the start the plan looks at before giving up (it always finds room by then). */
const MAX_RING = 6;

/** A plot's ring round the start: 0 in it, 1 for the plots touching it (diagonals too), and so on. */
export function ringOf(px: number, pz: number): number {
  const r = START_REGION;
  const dx = px < r.px0 ? r.px0 - px : px >= r.px0 + r.w ? px - (r.px0 + r.w - 1) : 0;
  const dz = pz < r.pz0 ? r.pz0 - pz : pz >= r.pz0 + r.h ? pz - (r.pz0 + r.h - 1) : 0;
  return Math.max(dx, dz);
}

/** No two secrets in the same plot or neighbouring ones (diagonals count). */
const apart = (a: { px: number; pz: number }, b: { px: number; pz: number }) => Math.max(Math.abs(a.px - b.px), Math.abs(a.pz - b.pz)) >= 2;

/** The plots of ring `r`, in a fixed random order for this seed. */
function ringPlots(seed: number, r: number): PlotCoord[] {
  const s = START_REGION;
  const out: { p: PlotCoord; k: number }[] = [];
  for (let pz = s.pz0 - r; pz < s.pz0 + s.h + r; pz++)
    for (let px = s.px0 - r; px < s.px0 + s.w + r; px++) if (ringOf(px, pz) === r) out.push({ p: { px, pz }, k: hashInts(seed, px, pz, SALT) });
  return out.sort((a, b) => a.k - b.k).map((o) => o.p);
}

/** Is this a coast plot (the row or column of plots the shore runs through)? */
function coastPlot(c: Coast, px: number, pz: number): boolean {
  return c.side === "n" || c.side === "s" ? pz === c.plot : px === c.plot;
}

/** Choices a kind has besides its first, used in turn where the one before had no room: the shipwreck's (a shore
 *  can be crowded with a harbour and its town), and every other's. */
const ALTERNATES: Record<SecretKind, number> = { shipwreck: 2, castle: 1, stones: 1, "lost-mine": 1, lake: 1, footprint: 1 };

/**
 * Where a map's secrets go (pure: the seed, the coast and which plots to keep off): the shipwreck on the nearest coast
 * plot; one inland secret in the start (not beside the shipwreck's plot), unless `skip` keeps off the start (an older
 * save gaining secrets: none go on land it already has); the rest in the first rings round the start, each on a plot
 * of land (not the open sea) with no secret on it or beside it. Then each kind's alternates (`alt` 1, 2), further out
 * and apart from every other choice too: a plot whose land has no room for its kind's secret passes it on to the next.
 */
export function planSecrets(seed: number, coast: Coast | null, skip: (px: number, pz: number) => boolean = () => false): SecretPlan[] {
  const random = rng(hashInts(seed, SALT));
  const inland = [...INLAND_SECRETS];
  for (let i = inland.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [inland[i], inland[j]] = [inland[j], inland[i]];
  }
  const out: SecretPlan[] = [];
  const free = (px: number, pz: number) => !skip(px, pz) && !seaPlot(coast, px, pz) && out.every((o) => apart(o, { px, pz }));
  const wreck = () => {
    for (let r = 1; r <= MAX_RING; r++) {
      const p = ringPlots(seed, r).find((q) => coastPlot(coast!, q.px, q.pz) && free(q.px, q.pz));
      if (p) return p;
    }
    return null;
  };
  const anywhere = (from: number) => {
    for (let r = from; r <= MAX_RING; r++) {
      const p = ringPlots(seed, r).find((q) => free(q.px, q.pz));
      if (p) return p;
    }
    return null;
  };
  const kinds: SecretKind[] = coast ? ["shipwreck", ...inland] : [...inland, inland[0]];
  // (No coast, no shipwreck: another inland secret takes its place, above.)
  for (const kind of kinds) {
    const p = kind === "shipwreck" ? wreck() : anywhere(out.some((o) => ringOf(o.px, o.pz) === 0) ? 1 : 0);
    if (p) out.push({ kind, ...p });
  }
  const firsts = [...out];
  for (let alt = 1; alt <= 2; alt++)
    for (const first of firsts) {
      if (ALTERNATES[first.kind] < alt || !out.some((o) => o.kind === first.kind && (o.alt ?? 0) === alt - 1)) continue;
      const p = first.kind === "shipwreck" ? wreck() : anywhere(1);
      if (p) out.push({ kind: first.kind, ...p, alt });
    }
  return out;
}

// ---- a site's frame ---------------------------------------------------------------------------------------------

/** A site's frame in the world: its model's origin and heading (the model's +x along its halt toward the buffer). */
export interface SiteFrame {
  x: number;
  z: number;
  heading: number;
}

const JOIN = SECRET_HALT.joins;

/** A site's frame from its halt's pose (the straight starts at the frame's (−108, `HALT_Z`), heading along +x). */
export function frameOf(piece: Pose): SiteFrame {
  const c = Math.cos(piece.heading);
  const s = Math.sin(piece.heading);
  return { x: piece.x - (JOIN.x * c - HALT_Z * s), z: piece.z - (JOIN.x * s + HALT_Z * c), heading: piece.heading };
}

/** A site's halt pose from its frame. */
export function haltOf(f: SiteFrame): Pose {
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  return { x: f.x + JOIN.x * c - HALT_Z * s, z: f.z + JOIN.x * s + HALT_Z * c, heading: f.heading };
}

/** A point of a site's frame in the world. */
export function frameToWorld(f: SiteFrame, fx: number, fz: number): { x: number; z: number } {
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  return { x: f.x + fx * c - fz * s, z: f.z + fx * s + fz * c };
}

/** A world point in a site's frame. */
export function worldToFrame(f: SiteFrame, x: number, z: number): { fx: number; fz: number } {
  const c = Math.cos(f.heading);
  const s = Math.sin(f.heading);
  const dx = x - f.x;
  const dz = z - f.z;
  return { fx: dx * c + dz * s, fz: -dx * s + dz * c };
}

/** The site itself (all but its halt's track), in its frame: nothing else stands or runs here. */
export const SITE_BODY = { x0: SITE_BOUNDS.x0, x1: SITE_BOUNDS.x1, z0: SITE_BOUNDS.z0, z1: HALT_Z - 20.5 } as const;
/** The shipwreck's: to its seaward edge, the sea past it the map's own. */
const WRECK_BODY = { ...SITE_BODY, z0: SHIPWRECK_SEA_Z } as const;
const bodyOf = (kind: SecretKind) => (kind === "shipwreck" ? WRECK_BODY : SITE_BODY);
/** Its halt's track bed, from the join to past the buffer: kept clear for the halt till it's found. */
export const SITE_STRIP = { x0: JOIN.x, x1: SITE_BOUNDS.x1, z0: HALT_Z - 20.5, z1: SITE_BOUNDS.z1 } as const;

const inRect = (r: { x0: number; x1: number; z0: number; z1: number }, fx: number, fz: number) => fx > r.x0 && fx < r.x1 && fz > r.z0 && fz < r.z1;

/**
 * Is a plan point on a secret site? Its body always; its halt's track bed too until it's found (then its halt's own
 * track is there, laid by the game).
 */
export function inSecretFootprint(land: Landscape, id: number, x: number, z: number): boolean {
  const site = land.secrets?.[id];
  if (!site) return false;
  const { fx, fz } = worldToFrame(frameOf(site.piece), x, z);
  return inRect(bodyOf(site.kind), fx, fz) || (!site.found && inRect(SITE_STRIP, fx, fz));
}

/** The squares a site of `kind` at frame `f` covers (any part of its body or track bed), as [col, row]. */
export function siteCells(f: SiteFrame, kind: SecretKind): [number, number][] {
  const BODY = bodyOf(kind);
  const corners = [SITE_BOUNDS.x0, SITE_BOUNDS.x1].flatMap((fx) => [SITE_BOUNDS.z0, SITE_BOUNDS.z1].map((fz) => frameToWorld(f, fx, fz)));
  const x0 = Math.min(...corners.map((p) => p.x));
  const x1 = Math.max(...corners.map((p) => p.x));
  const z0 = Math.min(...corners.map((p) => p.z));
  const z1 = Math.max(...corners.map((p) => p.z));
  const out: [number, number][] = [];
  for (let row = Math.floor(z0 / CELL); row * CELL < z1; row++)
    for (let col = Math.floor(x0 / CELL); col * CELL < x1; col++) {
      // (Quarter turns only: the site's bounds are a rectangle on the squares. A square only touched by the halt's
      // approach, past the join, is the line's, not the site's.)
      const mid = worldToFrame(f, (col + 0.5) * CELL, (row + 0.5) * CELL);
      // (Less a hair: a square only touching the site's edge, as the sea's first square touches the shipwreck's, isn't it.)
      const half = CELL / 2 - 0.5;
      const body = mid.fx + half > BODY.x0 && mid.fx - half < BODY.x1 && mid.fz + half > BODY.z0 && mid.fz - half < BODY.z1;
      const strip = mid.fx + half > SITE_STRIP.x0 && mid.fx - half < SITE_STRIP.x1 && mid.fz + half > SITE_STRIP.z0 && mid.fz - half < SITE_STRIP.z1;
      if (body || strip) out.push([col, row]);
    }
  return out;
}

/** The squares a line comes in on to a site's halt: the two along the halt's line past its join. */
export function approachCells(f: SiteFrame): [number, number][] {
  return [JOIN.x - CELL / 2, JOIN.x - (3 * CELL) / 2].map((fx) => {
    const p = frameToWorld(f, fx, HALT_Z);
    return [Math.floor(p.x / CELL), Math.floor(p.z / CELL)] as [number, number];
  });
}

// ---- placing one ------------------------------------------------------------------------------------------------

/** No site's middle nearer a town's than this, nor an old site's or a depot's than `NEAR_SITE` (mm). */
const NEAR_SITE = 420;

/** The site's middle, in its frame (between its body and its halt). */
const MIDDLE = { fx: 0, fz: (SITE_BOUNDS.z0 + SITE_BOUNDS.z1) / 2 };

/** Options for placing a site. */
export interface SecretOptions {
  /** Squares kept free besides the generator's own (a starter map's first line). */
  keepOff?: (col: number, row: number) => boolean;
}

/**
 * Place a secret of `kind` in `region` (a plot, or the start), and record it in `land.secrets`; null if none fits.
 * Inland: on open ground (grass, trees cleared, hills levelled), away from towns, depots and old sites, off roads and
 * the generator's corridors, with two open squares on its halt's line for a line to come in on; turned a quarter turn,
 * its halt's middle on a square's. The shipwreck: on a coast plot's beach, its seaward edge (`SHIPWRECK_SEA_Z`) on the
 * line where the sand meets the sea, along a stretch where the shore runs straight.
 */
export function placeSecret(land: Landscape, region: Region, kind: SecretKind, plot: PlotCoord, opt: SecretOptions = {}): SecretSite | null {
  const g = land.grid;
  const random = rng(hashInts(land.seed, region.px0, region.pz0, region.w, region.h, SALT, INLAND_SECRETS.indexOf(kind) + 1));
  const col0 = region.px0 * PLOT_COLS;
  const row0 = region.pz0 * PLOT_ROWS;
  const cols = region.w * PLOT_COLS;
  const rows = region.h * PLOT_ROWS;
  const corridors = new Set(land.corridors);
  const inside = (col: number, row: number) => col >= col0 + 1 && col < col0 + cols - 1 && row >= row0 + 1 && row < row0 + rows - 1;
  const open = (col: number, row: number, sand: boolean) => {
    if (!inside(col, row) || opt.keepOff?.(col, row)) return false;
    const i = g.index(col, row);
    if (i === -1 || g.road[i] !== 0 || corridors.has(i)) return false;
    const s = g.surface[i];
    // (The shipwreck's: its beach, and a little of the sea where the shore wanders, filled with sand as it's placed.)
    if (s !== SURF_GRASS && !(sand && (s === SURF_SAND || s === SURF_SEA))) return false;
    return g.feature[i] === FEAT_NONE || g.feature[i] === FEAT_TREE;
  };
  const towns = land.towns.map((t) => t.centre);
  const taken = [...land.depots.map((d) => d.centre), ...(land.sites ?? []).filter((s) => !s.cleared).map((s) => s.centre), ...(land.secrets ?? []).map((s) => frameToWorld(frameOf(s.piece), MIDDLE.fx, MIDDLE.fz))];
  const fits = (f: SiteFrame, sand: boolean) => {
    const m = frameToWorld(f, MIDDLE.fx, MIDDLE.fz);
    if (towns.some((c) => Math.hypot(c.x - m.x, c.z - m.z) < SITE_TOWN_SPACING) || taken.some((c) => Math.hypot(c.x - m.x, c.z - m.z) < NEAR_SITE)) return false;
    return siteCells(f, kind).every(([c, r]) => open(c, r, sand)) && approachCells(f).every(([c, r]) => open(c, r, sand));
  };
  const frames: SiteFrame[] = [];
  if (kind === "shipwreck") {
    const c = land.coast;
    if (!c) return null;
    // Frame −z out to sea; its origin 144 inland of the shore (the seaward edge on it).
    const out = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[c.side];
    const heading = { s: Math.PI, n: 0, e: Math.PI / 2, w: -Math.PI / 2 }[c.side];
    const along = c.side === "n" || c.side === "s";
    const [a0, n] = along ? [col0, cols] : [row0, rows];
    for (const k of shuffled(n, random)) {
      const at = a0 + k;
      // The site's middle across the shore on this square's middle, its seaward edge on the shore's furthest out under
      // it (where it wanders in, by a square or two, its sea is filled with sand).
      const mid = (at + 0.5) * CELL;
      const lines: number[] = [];
      for (let a = Math.floor((mid + SITE_BOUNDS.x0) / CELL); a * CELL < mid + SITE_BOUNDS.x1; a++) lines.push(shoreLine(c, a));
      const seaward = c.side === "s" || c.side === "e" ? Math.max(...lines) : Math.min(...lines);
      if (Math.max(...lines) - Math.min(...lines) > WANDER) continue;
      const shore = seaward * CELL;
      const f: SiteFrame = along ? { x: mid, z: shore + SHIPWRECK_SEA_Z * out[1], heading } : { x: shore + SHIPWRECK_SEA_Z * out[0], z: mid, heading };
      if (fits(f, true)) frames.push(f);
      if (frames.length >= 3) break;
    }
  } else {
    for (const k of shuffled(cols * rows * 4, random)) {
      const turn = k & 3;
      const cell = k >> 2;
      const col = col0 + (cell % cols);
      const row = row0 + Math.floor(cell / cols);
      const heading = turn * (Math.PI / 2) - Math.PI / 2;
      // Its halt's middle (the frame's (0, HALT_Z)) on this square's middle.
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const f: SiteFrame = { x: (col + 0.5) * CELL + HALT_Z * s, z: (row + 0.5) * CELL - HALT_Z * c, heading };
      if (fits(f, false)) frames.push(f);
      if (frames.length >= 3) break;
    }
  }
  for (const f of frames) {
    const keep = snapshotRegion(land);
    const secrets = (land.secrets ??= []);
    // (Its plot: the one its middle is in, in the start's region.)
    const m = frameToWorld(f, MIDDLE.fx, MIDDLE.fz);
    const site: SecretSite = { id: secrets.length, kind, piece: haltOf(f), plot: region.w === 1 && region.h === 1 ? { ...plot } : { px: Math.floor(m.x / (PLOT_COLS * CELL)), pz: Math.floor(m.z / (PLOT_ROWS * CELL)) } };
    const cells = siteCells(f, kind).map(([c, r]) => g.index(c, r));
    const approach = approachCells(f).map(([c, r]) => g.index(c, r));
    // (Levelled: a site stands on the felt.)
    flattenUnder(land, region, [...cells, ...approach]);
    for (const i of cells) {
      if (g.surface[i] === SURF_SEA) g.surface[i] = SURF_SAND;
      g.feature[i] = FEAT_SECRET;
      g.owner[i] = site.id;
    }
    for (const i of approach) if (g.feature[i] === FEAT_TREE) g.feature[i] = FEAT_NONE;
    secrets.push(site);
    if (reachable(land)) return site;
    keep();
    secrets.pop();
  }
  return null;
}

/** How far (squares) the shore may wander in under the shipwreck's width: its sea there is filled with sand. */
const WANDER = 2;

/** 0 … n − 1 in a random order. */
function shuffled(n: number, random: () => number): Int32Array {
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}

/**
 * The secret a plot's land gets (its plan's, `planSecrets`), placed on it; null if it has none or none fits. An
 * alternate goes down only if every earlier choice for its kind had no room: `placed` says whether one did (its plot's
 * land made to see).
 */
export function addPlotSecret(land: Landscape, plan: readonly SecretPlan[], px: number, pz: number, placed: (p: SecretPlan) => boolean = () => false): SecretSite | null {
  const p = plan.find((q) => q.px === px && q.pz === pz);
  if (!p) return null;
  if (p.alt && plan.some((q) => q.kind === p.kind && (q.alt ?? 0) < p.alt! && placed(q))) return null;
  return placeSecret(land, { px0: px, pz0: pz, w: 1, h: 1 }, p.kind, { px, pz });
}

/** The start's secret, if its plan has one there (`planSecrets`), placed on the start's land. */
export function addStartSecret(land: Landscape, plan: readonly SecretPlan[], opt: SecretOptions = {}): SecretSite | null {
  const p = plan.find((q) => ringOf(q.px, q.pz) === 0 && !q.alt);
  return p ? placeSecret(land, START_REGION, p.kind, { px: p.px, pz: p.pz }, opt) : null;
}
