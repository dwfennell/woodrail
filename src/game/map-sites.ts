import {
  addExtraTown,
  CELL,
  flattenUnder,
  FEAT_FIELD,
  FEAT_NONE,
  FEAT_RUIN,
  FEAT_TREE,
  FIELD_STOCK,
  hashInts,
  isWater,
  PLOT_COLS,
  PLOT_ROWS,
  reachable,
  shoreDistance,
  SITE_TOWN_SPACING,
  siteRoomIn,
  siteSquares,
  snapshotRegion,
  snapToSquare,
  START_REGION,
  townSquares,
  SURF_GRASS,
  SURF_RIVER,
  SURF_SAND,
  SURF_SEA,
  type Landscape,
  type MapSite,
  type Region,
  type SiteRole,
} from "../landscape";
import { rng } from "../lib/rng";
import { waterWay } from "./harbours";
import { amountText, resourceAt, SITE_RULES, yardMiddle } from "./industries";
import type { GameMode } from "./modes";
import { techOf } from "./tech";
import { THING_RULES } from "./things";
import { COIN_ICON } from "../economy/cargo";
import { kindsOf, type Bag } from "../economy/goods";
import { costTag } from "../ui/cost-tag";
import type { PieceTypeId } from "../track";

/**
 * The map's own sites (spec docs/superpowers/specs/2026-10-21-map-sites-design.md): on every plot an old industry or
 * two (a farm with its fields, a quarry or a mine in the hills, a harbour on the water), drawn as a greyed, fenced
 * yard with a stub of track, and beyond the start more towns, by the sea and the rivers most. All of it from its own
 * random stream (`sitesStream`), after the land's towns, fields and depots are made, so those are as they always were.
 *
 * Step 1: the sites, their ruins, the locked card, clearing a ruin, the land card. Step 2: restoring a ruin into its
 * industry (its piece where the stub is: `restore.ts`), Show me pointing at one, the balance harness restoring them.
 */

/** Salt for the sites' random stream. */
const SITES_SALT = 0x517e5;

/** The random stream a plot's (or the start's) extras come from: the seed and where it is, nothing else. */
export function sitesStream(seed: number, px: number, pz: number, w = 1, h = 1): () => number {
  return rng(hashInts(seed, px, pz, w, h, SITES_SALT));
}

/** Spots an extra town tries (best first) for one where its plot's site still fits too. */
const TOWN_TRIES = 2;

/** Most sites on a plot. */
export const MAX_SITES = 2;
/** The chance a plot gets a second site (of another kind), where one fits. */
const SECOND_SITE = 0.4;

/**
 * The chance a plot beyond the start gets an extra town (where one fits), by what's on it: by the sea most, then by a
 * river, then anywhere. Chosen from a survey of 232 plots round the starts of 8 seeds (`map-sites-survey.test.ts`; the
 * spec has the figures): about one extra town for every three plots overall (where one fits: the generator's spacing
 * leaves little room beside a plot's own town), four in five plots by the sea (which have no towns of their own).
 */
export const EXTRA_TOWN_CHANCE = { coast: 1, river: 0.6, inland: 0.3 } as const;

/** A ruin's role, by name, for cards and the land card. */
export const SITE_NAMES: Record<SiteRole, string> = { farm: "farm", quarry: "quarry", mine: "mine", harbour: "harbour" };

/** What clearing a ruin costs (Game mode): a few coins. */
export const CLEAR_PRICE = 10;

/**
 * What restoring a ruin costs, as a share of a new industry's price (`THING_RULES`): goods rounded up, coins to the
 * nearest 5. The one knob the balance pass tunes.
 */
export const RESTORE_SHARE = 0.5;

/** The industry's piece a ruin of this kind is restored to. */
export const restoredType = (role: SiteRole): PieceTypeId => `depot-${role}` as PieceTypeId;

/** What restoring a ruin of this kind costs (Game mode): about half its new industry's price (3🪵 45🪙 for a farm). */
export function restorePrice(role: SiteRole): { goods: Bag; coins: number } {
  const rule = THING_RULES[`piece:${restoredType(role)}`];
  const goods: Bag = {};
  if (!rule) return { goods, coins: 0 };
  for (const k of kindsOf(rule.cost)) goods[k] = Math.ceil(rule.cost[k]! * RESTORE_SHARE);
  return { goods, coins: Math.round(((rule.coins ?? 0) * RESTORE_SHARE) / 5) * 5 };
}

/**
 * Something the extras added to a land, as a patch an older save can take (see `addSitesToOldSave`): every square it
 * stands on, keeps clear or changed, with what was there before it, and which it changed. Ids are the land's.
 */
export interface Extra {
  kind: "town" | "site";
  /** The town's or the site's id. */
  id: number;
  /** Its squares (stood on, kept clear, changed), each with height, surface, feature and road as they were before it. */
  before: Map<number, [number, number, number, number]>;
  /** Those it changed. */
  changed: number[];
}

/** What a plot holds the most of, for the kind of site it gets. */
interface Character {
  sea: number;
  river: number;
  hills: number;
  cells: number;
}

function characterOf(land: Landscape, region: Region): Character {
  const g = land.grid;
  const out: Character = { sea: 0, river: 0, hills: 0, cells: 0 };
  forRegion(region, (col, row) => {
    const i = g.index(col, row);
    if (i === -1) return;
    out.cells++;
    const s = g.surface[i];
    if (s === SURF_SEA) out.sea++;
    else if (s === SURF_RIVER) out.river++;
    if (g.height[i] > 0) out.hills++;
  });
  return out;
}

function forRegion(region: Region, visit: (col: number, row: number) => void): void {
  const col0 = region.px0 * PLOT_COLS;
  const row0 = region.pz0 * PLOT_ROWS;
  for (let row = row0; row < row0 + region.h * PLOT_ROWS; row++) for (let col = col0; col < col0 + region.w * PLOT_COLS; col++) visit(col, row);
}

/** The kinds of site to try on a plot, best first: water for a harbour, hills for a quarry or mine, else a farm. */
function rolesFor(c: Character, random: () => number): SiteRole[] {
  const hillRole: SiteRole = random() < 0.6 ? "quarry" : "mine";
  const other: SiteRole = hillRole === "quarry" ? "mine" : "quarry";
  const wet = c.sea + c.river > 0;
  const hilly = c.hills > c.cells * 0.2;
  if (wet) return hilly ? ["harbour", hillRole, "farm", other] : ["harbour", "farm", hillRole, other];
  if (hilly) return [hillRole, "farm", other];
  return ["farm", hillRole, other];
}

/** A place a site could go: its stub's middle and heading (the yard on its +lateral side). */
interface Spot {
  x: number;
  z: number;
  heading: number;
  /** Lower is better. */
  score: number;
  /** A farm's two fields' squares. */
  fields?: number[][];
}

const pieceAt = (s: { x: number; z: number; heading: number }) => ({ x: s.x - Math.cos(s.heading) * 108, z: s.z - Math.sin(s.heading) * 108, heading: s.heading });

/** A site's stub keeps this far (mm, middle to middle) from depots, other sites and the shed (`SITE_TOWN_SPACING` from towns). */
export const SITE_SPACING = 450;

/** No site's stub has its middle nearer a region's edge than this (mm): the edge band, and half a stub. */
const EDGE = 7 * CELL;

/** A site's squares (`siteSquares`) for each way round, as offsets from its middle's square: the same everywhere. */
const OFFSETS = new Map<number, { yard: [number, number][]; approaches: [number, number][] }>();

function offsetsFor(heading: number): { yard: [number, number][]; approaches: [number, number][] } {
  const k = Math.round(heading / (Math.PI / 2)) & 3;
  let o = OFFSETS.get(k);
  if (!o) OFFSETS.set(k, (o = siteSquares({ x: CELL / 2, z: CELL / 2 }, heading)));
  return o;
}

/** A site's squares with its stub's middle at (x, z) (a square's middle), heading a quarter turn. */
function squaresAt(x: number, z: number, heading: number): { yard: [number, number][]; approaches: [number, number][] } {
  const o = offsetsFor(heading);
  const col = Math.floor(x / CELL);
  const row = Math.floor(z / CELL);
  const move = (list: [number, number][]) => list.map(([c, r]): [number, number] => [c + col, r + row]);
  return { yard: move(o.yard), approaches: move(o.approaches) };
}

/** How far from where it's wanted (the start) a site is looked for first (mm). */
const NEAR = 16 * CELL;

/** Options for where sites may go. */
interface SiteOptions {
  /** Squares kept free besides the generator's own (the starter line's strip). */
  keepOff?: (col: number, row: number) => boolean;
  /** Prefer spots near here (the start). */
  near?: { x: number; z: number };
  /** Try every other square's middle (`every`: every square's), each way round in a random order, not a few hundred random spots. */
  exhaustive?: boolean | "every";
}

/**
 * Spots for a `role` site in a region (from `tries` random places, or as `opt` says): room for its yard, stub and
 * approaches on open ground, away from towns, depots and other sites, and (with a farm's two fields planted) all the
 * resource the role's site rule wants (`SITE_RULES`), a harbour's boats able to reach it. Best first.
 */
function spotsFor(land: Landscape, region: Region, role: SiteRole, random: () => number, opt: SiteOptions, tries = 320): Spot[] {
  const g = land.grid;
  const wet = role === "harbour";
  // A harbour stands at the water's edge: its yard may come nearer the sea than a town's.
  const room = siteRoomIn(region, wet ? null : (land.coast ?? null));
  const corridors = new Set(land.corridors);
  const towns = land.towns.map((t) => t.centre);
  const taken = [...land.depots.map((d) => d.centre), ...(land.sites ?? []).filter((s) => !s.cleared).map((s) => s.centre), ...(land.shed ? [land.shed] : [])];
  // Which of the region's squares a site's approaches (`ground`) and yard (`yard`: only a harbour's on the sand) may
  // be on, worked out once: in from the edge, nothing on them but grass and trees. (Hills are fine: a site's ground is
  // flattened as it's placed, like a quarry cut into the hillside.)
  const col0 = region.px0 * PLOT_COLS;
  const row0 = region.pz0 * PLOT_ROWS;
  const cols = region.w * PLOT_COLS;
  const rows = region.h * PLOT_ROWS;
  const ground = new Uint8Array(cols * rows);
  const yardOk = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const col = col0 + c;
      const row = row0 + r;
      const i = g.index(col, row);
      if (i === -1 || !room(col, row) || g.road[i] !== 0 || corridors.has(i) || (opt.keepOff?.(col, row) ?? false)) continue;
      const s = g.surface[i];
      if ((s !== SURF_GRASS && s !== SURF_SAND) || (g.feature[i] !== FEAT_NONE && g.feature[i] !== FEAT_TREE)) continue;
      ground[r * cols + c] = 1;
      if (wet || s === SURF_GRASS) yardOk[r * cols + c] = 1;
    }
  }
  const allOk = (list: readonly (readonly [number, number])[], col: number, row: number, mask: Uint8Array) => {
    for (const [dc, dr] of list) {
      const c = col + dc - col0;
      const r = row + dr - row0;
      if (c < 0 || r < 0 || c >= cols || r >= rows || !mask[r * cols + c]) return false;
    }
    return true;
  };
  const rule = SITE_RULES[role]!;
  // (All of it: a restored industry runs at full speed. QA: old harbours with 5 of 8 ran at 0.75.)
  const want = rule.need;
  const x0 = col0 * CELL;
  const z0 = row0 * CELL;
  const w = cols * CELL;
  const d = rows * CELL;
  const out: Spot[] = [];
  // Where to look: wanted near somewhere (the start), every square's middle within `NEAR` of it, each way round, nearest
  // (its yard's middle) first; else every other square's middle each way round in a random order (`exhaustive`; `every`:
  // every square's), else random spots in from the edge.
  type At = { x: number; z: number; turn: number; near: number };
  let order: At[] | null = null;
  if (opt.near) {
    order = [];
    const c0 = Math.max(0, Math.floor((opt.near.x - NEAR - x0) / CELL));
    const c1 = Math.min(cols - 1, Math.floor((opt.near.x + NEAR - x0) / CELL));
    const r0 = Math.max(0, Math.floor((opt.near.z - NEAR - z0) / CELL));
    const r1 = Math.min(rows - 1, Math.floor((opt.near.z + NEAR - z0) / CELL));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        for (let turn = 0; turn < 4; turn++) {
          const x = x0 + (c + 0.5) * CELL;
          const z = z0 + (r + 0.5) * CELL;
          const m = yardMiddle(pieceAt({ x, z, heading: (turn - 1) * (Math.PI / 2) }));
          order.push({ x, z, turn, near: Math.hypot(m.x - opt.near.x, m.z - opt.near.z) / CELL });
        }
      }
    }
    order.sort((a, b) => a.near - b.near);
  } else if (opt.exhaustive) {
    // (Every other square's, each way: a site's yard is three squares across, so none is missed by much.)
    const step = opt.exhaustive === "every" ? 1 : 2;
    const across = Math.ceil(cols / step);
    order = Array.from(shuffled(across * Math.ceil(rows / step) * 4, random), (n) => ({
      x: x0 + (((n >> 2) % across) * step + 0.5) * CELL,
      z: z0 + (Math.floor((n >> 2) / across) * step + 0.5) * CELL,
      turn: n & 3,
      near: 0,
    }));
  }
  const count = order ? order.length : tries;
  // (In order: the first three that fit. Random spots: the best of up to eight.)
  const enough = order ? 3 : 8;
  for (let k = 0; k < count && out.length < enough; k++) {
    const at = order ? order[k] : { x: snapToSquare(x0 + EDGE + random() * (w - 2 * EDGE)), z: snapToSquare(z0 + EDGE + random() * (d - 2 * EDGE)), turn: Math.floor(random() * 4), near: 0 };
    const { x, z } = at;
    const heading = (at.turn - 1) * (Math.PI / 2);
    if (towns.some((c) => Math.hypot(c.x - x, c.z - z) < SITE_TOWN_SPACING) || taken.some((c) => Math.hypot(c.x - x, c.z - z) < SITE_SPACING)) continue;
    const shape = offsetsFor(heading);
    const col = Math.floor(x / CELL);
    const row = Math.floor(z / CELL);
    if (!allOk(shape.yard, col, row, yardOk) || !allOk(shape.approaches, col, row, ground)) continue;
    const pose = pieceAt({ x, z, heading });
    let score: number;
    let fields: number[][] | undefined;
    if (role === "farm") {
      const sq = squaresAt(x, z, heading);
      const yard = new Set([...sq.yard, ...sq.approaches].map(([c, r]) => g.index(c, r)));
      const found = farmFields(land, pose, yard, corridors, opt.keepOff);
      if (!found) continue;
      fields = found;
      score = random();
    } else {
      const r = resourceAt(land, role, pose)!;
      if (r.count < want || (role === "harbour" && !waterWay(land, pose, true))) continue;
      score = -Math.min(r.count, rule.need * 1.5) + random();
    }
    if (opt.near) score = at.near + score * 0.01;
    out.push({ x, z, heading, score, fields });
  }
  return out.sort((a, b) => a.score - b.score);
}

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
 * A farm's two 2 × 2 fields for a yard at `pose`: on open, flat grass, every square within the farm's reach of the
 * yard's middle (so the farm has all 8 it wants), not touching each other, the yard's approaches or anything but
 * grass and trees. Nearest the yard first; null if two don't fit.
 */
function farmFields(land: Landscape, pose: { x: number; z: number; heading: number }, yard: ReadonlySet<number>, corridors: ReadonlySet<number>, keepOff?: (col: number, row: number) => boolean): number[][] | null {
  const g = land.grid;
  const rule = SITE_RULES.farm!;
  const m = yardMiddle(pose);
  const col0 = g.colAt(m.x);
  const row0 = g.rowAt(m.z);
  const r = Math.ceil(rule.reach / CELL);
  const inReach = (c: number, w: number) => Math.hypot(g.centreX(c) - m.x, g.centreZ(w) - m.z) <= rule.reach;
  const chosen = new Set<number>();
  const open = (c: number, w: number) => {
    const i = g.index(c, w);
    return i !== -1 && !yard.has(i) && !corridors.has(i) && !chosen.has(i) && g.road[i] === 0 && g.surface[i] === SURF_GRASS && (g.feature[i] === FEAT_NONE || g.feature[i] === FEAT_TREE) && !(keepOff?.(c, w) ?? false);
  };
  // Round a field: grass or trees only (no water, town, station, other fields), and not the other field.
  const quiet = (c: number, w: number) => {
    const i = g.index(c, w);
    return i !== -1 && !chosen.has(i) && (g.surface[i] === SURF_GRASS || g.surface[i] === SURF_SAND) && (g.feature[i] === FEAT_NONE || g.feature[i] === FEAT_TREE || yard.has(i));
  };
  // (A quick count first: room for two fields' eight squares within reach at all?)
  let room = 0;
  for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) if (inReach(col0 + dc, row0 + dr) && open(col0 + dc, row0 + dr)) room++;
  if (room < 8) return null;
  const out: number[][] = [];
  for (let k = 0; k < 2; k++) {
    let best: number[] | null = null;
    let bestD = Infinity;
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        const c = col0 + dc;
        const w = row0 + dr;
        let ok = true;
        for (let y = -1; y <= 2 && ok; y++) {
          for (let x = -1; x <= 2 && ok; x++) {
            const inside = y >= 0 && y <= 1 && x >= 0 && x <= 1;
            ok = inside ? open(c + x, w + y) && inReach(c + x, w + y) : quiet(c + x, w + y);
          }
        }
        if (!ok) continue;
        const dist = Math.hypot(g.centreX(c) + CELL / 2 - m.x, g.centreZ(w) + CELL / 2 - m.z);
        if (dist < bestD) {
          bestD = dist;
          best = [g.index(c, w), g.index(c + 1, w), g.index(c, w + 1), g.index(c + 1, w + 1)];
        }
      }
    }
    if (!best) return null;
    out.push(best);
    for (const i of best) chosen.add(i);
  }
  return out;
}

/**
 * Put a site at `spot`: its yard and stub squares a ruin (trees felled), its approaches kept clear, a farm's fields
 * planted. Kept only if every town, depot and site can still be reached; returns it, or null with the land as it was.
 */
function placeSite(land: Landscape, region: Region, role: SiteRole, spot: Spot, plot: { px: number; pz: number }, want: number, random: () => number): MapSite | null {
  const g = land.grid;
  const keep = snapshotRegion(land);
  const sites = (land.sites ??= []);
  const site: MapSite = { id: sites.length, role, centre: { x: spot.x, z: spot.z }, piece: pieceAt(spot), plot: { ...plot }, fields: [] };
  const sq = siteSquares(site.centre, spot.heading);
  for (const [c, r] of sq.yard) {
    const i = g.index(c, r);
    g.feature[i] = FEAT_RUIN;
    g.owner[i] = site.id;
  }
  const corridors = new Set(land.corridors);
  for (const [c, r] of sq.approaches) {
    const i = g.index(c, r);
    g.feature[i] = FEAT_NONE;
    if (!corridors.has(i)) land.corridors.push(i);
  }
  for (const [k, cells] of (spot.fields ?? []).entries()) {
    const id = land.fields.length;
    for (const i of cells) {
      g.feature[i] = FEAT_FIELD;
      g.owner[i] = id;
    }
    // Crops for the farm's grain, and a paddock of animals beside them.
    land.fields.push({ id, cells: [...cells], animal: k === 0 ? "crops" : FIELD_STOCK[Math.floor(random() * (FIELD_STOCK.length - 1))] });
    site.fields.push(id);
  }
  flattenUnder(land, region, [...sq.yard, ...sq.approaches].map(([c, r]) => g.index(c, r)).concat((spot.fields ?? []).flat()));
  sites.push(site);
  // (Flattening its yard may have taken some of the hillside it wanted.)
  if ((role === "farm" || resourceAt(land, role, site.piece)!.count >= want) && reachable(land)) return site;
  keep();
  return null;
}

/** Record what `add` changes on the land as an `Extra` (see `addSitesToOldSave`), or null if it added nothing. */
function recorded(land: Landscape, kind: Extra["kind"], add: () => { id: number; guard: number[] } | null): Extra | null {
  const g = land.grid;
  const n = g.cellCount;
  const was = [g.height.slice(0, n), g.surface.slice(0, n), g.feature.slice(0, n), g.road.slice(0, n)];
  const made = add();
  if (!made) return null;
  const changed: number[] = [];
  for (let i = 0; i < n; i++) {
    if (g.height[i] !== was[0][i] || g.surface[i] !== was[1][i] || g.feature[i] !== was[2][i] || g.road[i] !== was[3][i]) changed.push(i);
  }
  const before = new Map<number, [number, number, number, number]>();
  for (const i of new Set([...made.guard, ...changed])) before.set(i, [was[0][i], was[1][i], was[2][i], was[3][i]]);
  return { kind, id: made.id, before, changed };
}

/** The squares a site stands on and keeps clear (its yard, stub and approaches, and a farm's fields). */
function siteGuard(land: Landscape, site: MapSite): number[] {
  const g = land.grid;
  const sq = siteSquares(site.centre, site.piece.heading);
  return [...sq.yard, ...sq.approaches].map(([c, r]) => g.index(c, r)).concat(site.fields.flatMap((f) => land.fields[f].cells));
}

/** Try each role in turn (each with its own spots, best first) until a site goes down; that site, or null. */
function firstSite(land: Landscape, region: Region, roles: readonly SiteRole[], random: () => number, plot: { px: number; pz: number }, opt: SiteOptions, out: Extra[]): MapSite | null {
  for (const role of roles) {
    for (const spot of spotsFor(land, region, role, random, opt).slice(0, 3)) {
      let site: MapSite | null = null;
      const extra = recorded(land, "site", () => {
        site = placeSite(land, region, role, spot, plot, SITE_RULES[role]!.need, random);
        return site ? { id: site.id, guard: siteGuard(land, site) } : null;
      });
      if (extra && site) {
        out.push(extra);
        return site;
      }
    }
  }
  return null;
}

/** Squares from the nearest water (sea or river) in a region, 4-neighbour steps over its land: for a town's place. */
function waterDistance(land: Landscape, region: Region): (x: number, z: number) => number {
  const g = land.grid;
  const dist = new Map<number, number>();
  const queue: number[] = [];
  let mouths = 0;
  forRegion(region, (col, row) => {
    const i = g.index(col, row);
    if (i !== -1 && isWater(g.surface[i])) {
      dist.set(i, 0);
      queue.push(i);
      // A river running into the sea: its mouth (a town there is a port).
      if (g.surface[i] === SURF_RIVER && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => g.surface[g.index(col + dc, row + dr)] === SURF_SEA)) mouths++;
    }
  });
  for (let k = 0; k < queue.length; k++) {
    const i = queue[k];
    const col = g.colOf(i);
    const row = g.rowOf(i);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = g.index(col + dc, row + dr);
      if (n === -1 || dist.has(n)) continue;
      dist.set(n, dist.get(i)! + 1);
      queue.push(n);
    }
  }
  const sea = land.coast ?? null;
  return (x, z) => {
    const col = g.colAt(x);
    const row = g.rowAt(z);
    const d = dist.get(g.index(col, row)) ?? 99;
    // The sea counts a little more than a river, a river's mouth most.
    const bySea = sea ? Math.max(0, shoreDistance(sea, col, row)) * 0.8 : 99;
    return Math.min(d, bySea) - (mouths > 0 ? 3 : 0);
  };
}

/**
 * A plot's extras, beyond the start, on its land as `generatePlot` made it (before it's bought): maybe an extra town
 * (more likely by the sea or a river: `EXTRA_TOWN_CHANCE`), then one or two old industries' sites, the first of the
 * kind the plot is richest in. Every plot gets at least one site where any fits. Returns what was added, as patches.
 */
export function addPlotExtras(land: Landscape, px: number, pz: number, sites = true): Extra[] {
  const random = sitesStream(land.seed, px, pz);
  const region: Region = { px0: px, pz0: pz, w: 1, h: 1 };
  const out: Extra[] = [];
  land.sites ??= [];
  const c = characterOf(land, region);
  // A town: by the sea, a river, or anywhere, by chance.
  const chance = c.sea > 0 ? EXTRA_TOWN_CHANCE.coast : c.river > 0 ? EXTRA_TOWN_CHANCE.river : EXTRA_TOWN_CHANCE.inland;
  const near = waterDistance(land, region);
  const addTown = (skip: number) => {
    const extra = recorded(land, "town", () => {
      const town = addExtraTown(land, region, random, (p) => near(p.x, p.z), skip);
      if (!town) return null;
      const sq = townSquares(town.centre, town.station.heading);
      const g = land.grid;
      return { id: town.id, guard: [...sq.station, ...sq.approaches, ...sq.ground].map(([col, row]) => g.index(col, row)) };
    });
    if (extra) out.push(extra);
    return !!extra;
  };
  // Sites: the kind the plot is richest in first, then the others; any spot at all (every other square's, then every
  // square's) only if nothing fits. Always with all the resource the kind wants (`SITE_RULES`: restored, it runs at full
  // speed), so a kind that can't have it here gives way to the next.
  const roles = rolesFor(c, random);
  const plot = { px, pz };
  // (A harbour needs the open sea: on a plot without any, it's left out of the wider search.)
  const dry = roles.filter((r) => r !== "harbour" || c.sea > 0);
  // (A Sandbox map's plot: its town, and no sites.)
  if (!sites) {
    if (random() < chance) addTown(0);
    return out;
  }
  const site = () =>
    firstSite(land, region, roles, random, plot, {}, out) ??
    firstSite(land, region, dry, random, plot, { exhaustive: true }, out) ??
    firstSite(land, region, dry, random, plot, { exhaustive: "every" }, out);
  // A town first, near the water (a harbour town by the sea), if the plot gets one and its site still fits beside it:
  // else the town tries its next best spot, and then gives way to the site (every plot has a site).
  let first: MapSite | null = null;
  if (random() < chance) {
    for (let skip = 0; skip < TOWN_TRIES && !first; skip++) {
      const keep = snapshotRegion(land);
      if (!addTown(skip)) break;
      first = site();
      if (!first) {
        keep();
        out.length = 0;
      }
    }
  }
  first ??= site();
  if (first && random() < SECOND_SITE && land.sites.filter((s) => s.plot.px === px && s.plot.pz === pz).length < MAX_SITES) {
    firstSite(land, region, roles.filter((r) => r !== first!.role && !(isHill(r) && isHill(first!.role))), random, plot, {}, out);
  }
  return out;
}

const isHill = (r: SiteRole) => r === "quarry" || r === "mine";

/**
 * The start's sites (a new game's 2 × 2 plots): an old farm with its fields near the first towns, where a new player
 * sees it early (Farming is the first industry they learn), and on other starts (Sandbox's maps), where one fits, one
 * more of the kind the start is richest in (a harbour, a quarry or a mine). On a starter map the farm keeps off the
 * starter line (the strip from the sawmill past the first two towns to the forest yard, `STARTER_KEEP_OFF` rows either
 * side) and off the sawmill's side of it altogether, so a new player's first line and the industries they build by it
 * (the balance harness's and the grand tour's too) have the room they always had. Returns what was added, as patches.
 */
export function addStartSites(land: Landscape): Extra[] {
  const region = START_REGION;
  const random = sitesStream(land.seed, region.px0, region.pz0, region.w, region.h);
  const out: Extra[] = [];
  land.sites ??= [];
  const g = land.grid;
  const [a, b] = land.towns;
  let keepOff: SiteOptions["keepOff"];
  if (land.starter && a && b) {
    const xs = [a.centre.x, b.centre.x, ...land.depots.map((d) => d.centre.x)];
    const x0 = Math.min(...xs) - 6 * CELL;
    const x1 = Math.max(...xs) + 6 * CELL;
    // (And the sawmill's side of the line: the branch to it turns that way, and so do a player's first industries.)
    const sawmill = land.depots.find((d) => d.kind === "sawmill");
    const side = sawmill ? Math.sign(sawmill.centre.z - a.centre.z) : 0;
    keepOff = (col, row) => {
      const x = g.centreX(col);
      const z = g.centreZ(row);
      return (x > x0 && x < x1 && Math.abs(z - a.centre.z) < STARTER_KEEP_OFF * CELL) || (side !== 0 && Math.sign(z - a.centre.z) === side);
    };
  }
  const near = a && b ? { x: (a.centre.x + b.centre.x) / 2, z: (a.centre.z + b.centre.z) / 2 } : a ? a.centre : { x: 0, z: 0 };
  const plotOf = (s: MapSite) => ({ px: Math.floor(s.centre.x / (PLOT_COLS * CELL)), pz: Math.floor(s.centre.z / (PLOT_ROWS * CELL)) });
  const farm = firstSite(land, region, ["farm"], random, { px: region.px0, pz: region.pz0 }, { keepOff, near }, out);
  if (farm) farm.plot = plotOf(farm);
  // (The starter map, where every new player begins, has just the farm: its first lines, and the industries a player
  // builds beside them, have room as they always had.)
  if (land.starter) return out;
  const c = characterOf(land, region);
  const second = rolesFor(c, random).filter((r) => r !== "farm");
  const other = firstSite(land, region, second, random, { px: region.px0, pz: region.pz0 }, { keepOff, near }, out);
  if (other) other.plot = plotOf(other);
  return out;
}

/** Rows either side of the starter line kept free of the start's sites. */
export const STARTER_KEEP_OFF = 5;

// ---- what the player is told ------------------------------------------------------------------------------------

/** What a ruin's resource is called on its card, and its icon. */
const RESOURCE: Record<SiteRole, { what: string; icon: string }> = {
  farm: { what: "Farm fields", icon: "🌾" },
  quarry: { what: "Hillside", icon: "⛰️" },
  mine: { what: "Hillside", icon: "⛰️" },
  harbour: { what: "Water", icon: "🌊" },
};

/** The blueprint that opens a kind of site (its industry's), by name: "Farming", "Quarries". */
export function siteBlueprint(role: SiteRole): { id: string; label: string } | null {
  const id = THING_RULES[`piece:depot-${role}`]?.tech;
  const t = id ? techOf(id) : undefined;
  return id && t ? { id, label: t.label } : null;
}

/** A ruin's card (tap a ruin): its name, what's around it, and what opens it. Short: a phone's card, read by a child. */
export interface RuinCard {
  /** "Old farm". */
  title: string;
  /** "🌾 Farm fields nearby: 2 of 2" (whole fields: `amountText`). */
  resource: string;
  /**
   * What opens it: "🔒 Learn Farming at a school to open this farm", or once that's learned (and in Sandbox) what
   * restoring it is: "🔧 Half the price of a new farm yard".
   */
  status: string;
  /** Learned (or Sandbox): it can be restored. */
  open: boolean;
  /** The restore button, once it's open: "Restore · 3🪵 45🪙" ("Restore" in Sandbox); null while locked, or a harbour's boats can't reach it. */
  restore: string | null;
  /** "Or build your own anywhere from the Industries tab." (Game mode.) */
  own: string | null;
  /** The clear button: "Clear the ruin · 10🪙". */
  clear: string;
}

/** A harbour ruin's card when its boats can't reach it (no Restore then). */
export const HARBOUR_STRANDED = "⛵ Boats can't reach this water now";

/**
 * An old harbour its boats can't reach any more (a river one in an old save, its river ending in land bought since):
 * it can't be restored, so Show me and the map view pass it over. Only a harbour's water is searched.
 */
export function harbourStranded(land: Landscape, site: MapSite): boolean {
  return site.role === "harbour" && !waterWay(land, site.piece);
}

export function ruinCard(land: Landscape, site: MapSite, mode: GameMode, learned: (id: string) => boolean): RuinCard {
  const name = SITE_NAMES[site.role];
  const r = resourceAt(land, site.role, site.piece);
  const res = RESOURCE[site.role];
  // (All it needs: "8 of 8", however many more there are.)
  // (A farm's in whole fields, "2 of 2", as the player sees them: not squares, "8 of 8", beside two fields.)
  const resource = r ? `${res.icon} ${res.what} nearby: ${amountText(r.rule, Math.min(r.count, r.need))} of ${amountText(r.rule, r.need)}` : "";
  const bp = siteBlueprint(site.role);
  const open = mode === "sandbox" || !bp || learned(bp.id);
  const fresh = THING_RULES[`piece:${restoredType(site.role)}`]?.label.toLowerCase() ?? name;
  const price = restorePrice(site.role);
  const priced = mode === "game" ? costTag(price.goods, price.coins) : "";
  // (A harbour whose water no longer leads off the land or out to sea: a river one in an old save, its river ending in
  // land bought since. New harbour sites are only where the sea is reached, which buying land can't cut. Restore would
  // fail, so the card says why instead of offering it.)
  const stranded = open && harbourStranded(land, site);
  return {
    title: `Old ${name}`,
    resource,
    status: !open ? `🔒 Learn ${bp!.label} at a school to open this ${name}` : stranded ? HARBOUR_STRANDED : mode === "game" ? `🔧 ${RESTORE_SHARE === 0.5 ? "Half the price of" : "Cheaper than"} a new ${fresh}` : `🔧 Restore it to work again`,
    open,
    restore: open && !stranded ? (priced ? `Restore · ${priced}` : "Restore") : null,
    own: mode === "game" ? "Or build your own anywhere from the Industries tab." : null,
    clear: mode === "game" ? `Clear the ruin · ${CLEAR_PRICE}${COIN_ICON}` : "Clear the ruin",
  };
}

/**
 * Said when track meets an old industry's ruin: what it is, and what a tap on it offers ("An old farm is in the way:
 * tap it to restore or clear it"; "…to clear it" while it can't be restored).
 */
export function ruinInWay(site: MapSite, canRestore: boolean): string {
  return `An old ${SITE_NAMES[site.role]} is in the way: tap it to ${canRestore ? "restore or clear" : "clear"} it`;
}

/**
 * The standing ruin one of whose squares (yard or stub) is nearest (x, z), within `reach` mm; −1 if none. Looks at the
 * few dozen squares round the point: for a refusal's message, while a piece is held over a ruin.
 */
export function ruinNear(land: Landscape, x: number, z: number, reach = 360): number {
  const g = land.grid;
  const r = Math.ceil(reach / CELL);
  const col = g.colAt(x);
  const row = g.rowAt(z);
  let best = -1;
  let d = Infinity;
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      const i = g.index(col + dc, row + dr);
      if (i === -1 || g.feature[i] !== FEAT_RUIN) continue;
      const e = Math.hypot(g.centreX(col + dc) - x, g.centreZ(row + dr) - z);
      if (e <= reach && e < d) [best, d] = [g.owner[i], e];
    }
  }
  return best;
}

/** Words for a count of things: "a town", "2 towns". */
const some = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** Is a town by the sea (the sea within a few squares of its station)? */
function bySea(land: Landscape, t: { centre: { x: number; z: number } }): boolean {
  const g = land.grid;
  return !!land.coast && shoreDistance(land.coast, g.colAt(t.centre.x), g.rowAt(t.centre.z)) <= 8;
}

/**
 * What a plot would bring, in a few words, for the land card: its towns (by the sea, if they are), its old sites, its
 * depots and what the land is like. "2 towns by the sea, an old harbour, a forest yard, the coast and hills."
 */
export function describeLand(land: Landscape): string {
  const parts: string[] = [];
  const sea = land.towns.filter((t) => bySea(land, t)).length;
  const inland = land.towns.length - sea;
  if (sea > 0 && inland === 0) parts.push(`${some(sea, "a town", "towns")} by the sea`);
  else if (land.towns.length > 0) parts.push(some(land.towns.length, "a town", "towns"));
  // Old sites: "an old farm", "2 old quarries".
  const sites = (land.sites ?? []).filter((s) => !s.cleared);
  for (const role of ["farm", "quarry", "mine", "harbour"] as const) {
    const n = sites.filter((s) => s.role === role).length;
    if (n > 0) parts.push(n === 1 ? `an old ${SITE_NAMES[role]}` : `${n} old ${role === "quarry" ? "quarries" : `${SITE_NAMES[role]}s`}`);
  }
  const forests = land.depots.filter((d) => d.kind === "forest").length;
  const mills = land.depots.filter((d) => d.kind === "sawmill").length;
  if (forests) parts.push(forests > 1 ? `${forests} forest yards` : "a forest yard");
  if (mills) parts.push("a sawmill");
  const g = land.grid;
  let river = false;
  let water = false;
  let hills = 0;
  for (let i = 0; i < g.cellCount; i++) {
    if (g.surface[i] === SURF_RIVER) river = true;
    if (g.surface[i] === SURF_SEA) water = true;
    if (g.height[i] > 0) hills++;
  }
  if (water && sea === 0) parts.push("the coast");
  if (river) parts.push("a river");
  if (hills > g.cellCount * 0.25) parts.push("hills");
  if (parts.length === 0) return "Open countryside.";
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return list.charAt(0).toUpperCase() + list.slice(1) + ".";
}

/** The standing ruin whose yard or stub (with a little to spare: its fence, its sign) is at plan point (x, z), or −1. */
export function ruinAt(land: Landscape, x: number, z: number): number {
  for (const site of land.sites ?? []) {
    if (site.cleared) continue;
    const c = Math.cos(site.piece.heading);
    const s = Math.sin(site.piece.heading);
    const dx = x - site.piece.x;
    const dz = z - site.piece.z;
    const t = c * dx + s * dz;
    const l = -s * dx + c * dz;
    if (t >= -12 && t <= 228 && l >= -30 && l <= 130) return site.id;
  }
  return -1;
}
