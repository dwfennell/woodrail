import { CELL, SURF_RIVER, SURF_SEA, type Landscape, type LandscapeGrid } from "../landscape";
import { SITE_RULES } from "./industries";

type Point = { x: number; z: number };

/** What there is across the river worth a bridge: a town off the railway, a depot, or ground an industry could use. */
export type AcrossKind = "town" | "depot" | "forest" | "farm" | "hill";

export interface AcrossRiver {
  kind: AcrossKind;
  /** Where it is (a town's centre, a depot's middle, a square's centre). */
  at: Point;
  /** The town, for a town. */
  town?: number;
  /** The middle of the river where the shortest way from the line to it crosses, and the ground either side. */
  river: Point;
  near: Point;
  far: Point;
}

/** Ground for industries, as they need it (`SITE_RULES`): enough of their resource near a square for one to stand. */
const SITES: { kind: AcrossKind; role: "forest" | "farm" | "quarry" }[] = [
  { kind: "forest", role: "forest" },
  { kind: "farm", role: "farm" },
  { kind: "hill", role: "quarry" },
];
const SITE_NONE = 255;

/** Squares of bank either side of the river kept in view. */
const BANK = 2;

const isLand = (g: LandscapeGrid, i: number) => g.surface[i] !== SURF_RIVER && g.surface[i] !== SURF_SEA;

interface GridFacts {
  revision: number;
  /** Each square's stretch of land (river and sea part them), −1 on water. */
  region: Int32Array;
  regions: number;
  /** Per square: the first of `SITES` an industry could stand on there, or `SITE_NONE` (worked out when first asked). */
  site: Uint8Array | null;
}

/** The land's stretches and industry ground, by grid: they change only when squares do, not with the track. */
const factsCache = new WeakMap<LandscapeGrid, GridFacts>();

function factsOf(g: LandscapeGrid): GridFacts {
  const hit = factsCache.get(g);
  if (hit && hit.revision === g.revision) return hit;
  const n = g.cellCount;
  const nb = g.neighbours();
  const region = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  let regions = 0;
  for (let i = 0; i < n; i++) {
    if (region[i] !== -1 || !isLand(g, i)) continue;
    region[i] = regions;
    stack.push(i);
    while (stack.length > 0) {
      const c = stack.pop()!;
      for (let d = 0; d < 4; d++) {
        const m = nb[c * 4 + d];
        if (m !== -1 && region[m] === -1 && isLand(g, m)) {
          region[m] = regions;
          stack.push(m);
        }
      }
    }
    regions++;
  }
  const facts = { revision: g.revision, region, regions, site: null };
  factsCache.set(g, facts);
  return facts;
}

/**
 * Industry ground (`GridFacts.site`): each rule's squares on the same stretch of land, counted over a disc round each
 * square (its resource over the river is no reason to cross). On the plots' bounding box, square by square.
 */
function sitesOf(land: Landscape, facts: GridFacts): Uint8Array {
  if (facts.site) return facts.site;
  const g = land.grid;
  const { region } = facts;
  const n = g.cellCount;
  const site = new Uint8Array(n).fill(SITE_NONE);
  const e = g.extent();
  const w = e.col1 - e.col0;
  const h = e.row1 - e.row0;
  const at = new Int32Array(w * h).fill(-1);
  g.forEachCell((i, col, row) => {
    at[(row - e.row0) * w + (col - e.col0)] = i;
  });
  const has = new Uint8Array(n);
  SITES.forEach(({ role }, k) => {
    const rule = SITE_RULES[role]!;
    const least = Math.ceil(rule.need / 2);
    const r = Math.floor(rule.reach / CELL);
    const half = Array.from({ length: 2 * r + 1 }, (_, j) => Math.floor(Math.sqrt((rule.reach / CELL) ** 2 - (j - r) ** 2)));
    let any = false;
    for (let i = 0; i < n; i++) {
      has[i] = region[i] !== -1 && rule.counts(land, i) ? 1 : 0;
      any ||= has[i] === 1;
    }
    if (!any) return;
    for (let y0 = 0; y0 < h; y0++)
      for (let x0 = 0; x0 < w; x0++) {
        const i = at[y0 * w + x0];
        if (i === -1 || site[i] !== SITE_NONE || region[i] === -1) continue;
        const own = region[i];
        let count = 0;
        for (let j = 0; j <= 2 * r && count < least; j++) {
          const y = y0 + j - r;
          if (y < 0 || y >= h) continue;
          const x1 = Math.min(w - 1, x0 + half[j]);
          for (let x = Math.max(0, x0 - half[j]); x <= x1; x++) {
            const m = at[y * w + x];
            if (m !== -1 && has[m] === 1 && region[m] === own) count++;
          }
        }
        if (count >= least) site[i] = k;
      }
  });
  facts.site = site;
  return site;
}

/**
 * The nearest thing across the river from the line (the squares under `line`, the player's track and towns): one on a
 * stretch of land (river and sea part them) the line has no part of, so only a bridge gets there. A town or a depot
 * (`depots`, their middles) if there's one across, else ground an industry could stand on (trees, fields, hillside:
 * `SITE_RULES`). Found by a walk out from the line over land and river (not sea), square by square, so the river
 * point is on the shortest way to it. Null when nothing's across.
 */
export function acrossRiver(land: Landscape, line: readonly Point[], depots: readonly Point[]): AcrossRiver | null {
  const g = land.grid;
  const facts = factsOf(g);
  const { region, regions } = facts;
  // The line's stretches.
  const ours = new Uint8Array(regions);
  const seeds: number[] = [];
  for (const p of line) {
    const i = g.cellAtWorld(p.x, p.z);
    if (i === -1 || region[i] === -1) continue;
    ours[region[i]] = 1;
    seeds.push(i);
  }
  if (seeds.length === 0 || ours.every((o) => o === 1)) return null;
  const across = (i: number) => i !== -1 && region[i] !== -1 && ours[region[i]] === 0;

  // Towns and depots across, by square.
  const place = new Map<number, { kind: AcrossKind; at: Point; town?: number }>();
  for (const t of land.towns) {
    const it = { kind: "town" as const, at: t.centre, town: t.id };
    for (const i of [...t.cells, g.cellAtWorld(t.station.x, t.station.z)]) if (across(i) && !place.has(i)) place.set(i, it);
  }
  for (const d of depots) {
    const i = g.cellAtWorld(d.x, d.z);
    if (across(i) && !place.has(i)) place.set(i, { kind: "depot", at: d });
  }
  const centre = (i: number): Point => ({ x: g.centreX(g.colOf(i)), z: g.centreZ(g.rowOf(i)) });
  const way = place.size > 0 ? walk(g, seeds, (i) => place.has(i)) : null;
  const site = way ? null : sitesOf(land, facts);
  const found = way ?? walk(g, seeds, (i) => site![i] !== SITE_NONE && across(i));
  if (!found) return null;
  const end = found[found.length - 1];
  const what = place.get(end) ?? { kind: SITES[site![end]].kind, at: centre(end) };
  // The first run of river squares on the way out is the crossing.
  const first = found.findIndex((i) => g.surface[i] === SURF_RIVER);
  let last = first;
  while (last + 1 < found.length && g.surface[found[last + 1]] === SURF_RIVER) last++;
  return {
    ...what,
    river: centre(found[(first + last) >> 1]),
    near: centre(found[Math.max(0, first - BANK)]),
    far: centre(found[Math.min(found.length - 1, last + BANK)]),
  };
}

/** The shortest way (squares, line first) from `seeds` over land and river to a square that's `wanted`, or null. */
function walk(g: LandscapeGrid, seeds: readonly number[], wanted: (i: number) => boolean): number[] | null {
  const n = g.cellCount;
  const nb = g.neighbours();
  const from = new Int32Array(n).fill(-2);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const i of seeds) {
    if (from[i] !== -2) continue;
    from[i] = -1;
    queue[tail++] = i;
  }
  while (head < tail) {
    const c = queue[head++];
    if (wanted(c)) {
      const way: number[] = [];
      for (let k = c; k !== -1; k = from[k]) way.push(k);
      return way.reverse();
    }
    for (let d = 0; d < 4; d++) {
      const m = nb[c * 4 + d];
      if (m === -1 || from[m] !== -2 || g.surface[m] === SURF_SEA) continue;
      from[m] = c;
      queue[tail++] = m;
    }
  }
  return null;
}
