import { hashInts } from "../landscape/edges";
import { CELL, FEAT_BUILDING, FEAT_STATION, SURF_ROAD, type LandscapeGrid } from "../landscape/grid";
import { pieceForEdges, type Edge } from "./pieces";

/**
 * Towns that grow: one set of rules lays a town out on a new map and grows it in play, a building at a time (see the
 * road-system design, §3a). A town starts as its station and three squares of Station Road in front of the platform
 * (some towns also a street behind the station, across the line). Each step puts up one building on the best empty
 * square beside a street, close to the station, beside other buildings and opposite them, so both sides of a street
 * fill together. Only when there's no room close in does it lay street: a street run on, or a side street off a
 * stretch that has houses, out a block's depth and then along, so the town grows in blocks; ribbons run out toward
 * other towns once it has a core. As it grows, its middle changes: houses near the station become shops and gain a
 * floor. Pure and deterministic: everything comes from where the town is and what's on the map.
 */

/** A town as growth sees it. */
export interface GrowingTown {
  centre: { x: number; z: number };
  /** The station's heading: along a map axis. The platform is on its +lateral side. */
  heading: number;
  /** Its squares (station, streets, buildings). */
  cells: readonly number[];
  buildings: readonly { id: number; cells: readonly number[]; kind: "house" | "shop"; floors: 1 | 2; front?: Edge; landmark?: string }[];
}

/** One step of growth: a new building, the street squares laid or re-pieced for it, and buildings that change. */
export interface GrowthStep {
  /** Its squares: one, or two side by side along the street (a terrace or a big building). */
  cells: number[];
  /** The grid edge its front door faces (onto its street). */
  front: Edge;
  corner: boolean;
  /** Street squares set by this step (new ones, and old ones whose piece changes to join them), with road bytes. */
  streets: [number, number][];
  /**
   * Buildings that change as the town grows: a house becomes a shop, or gains a floor. By id; an id below zero is the
   * building put up by step `-1 - id` of the same call.
   */
  changes: { id: number; kind?: "shop"; floors?: 2 }[];
}

export interface GrowOptions {
  /** May a building or street go on square `i`? (Open, level ground the player isn't using.) */
  canUse(i: number): boolean;
  /** Other towns (or anywhere a road leads): the town's ribbons reach toward the nearest. */
  toward?: readonly { x: number; z: number }[];
  /** The first this many buildings take two squares where there's any such lot (for big buildings: landmarks). */
  wide?: number;
}

/** How far a town may grow from its centre, in squares. */
export const TOWN_REACH = 6.5;
/** A street is held back every this many squares along it, where a side street can leave later. */
const GAP_EVERY = 3;
/** The town opens a street behind its station (if it didn't start with one) at this many buildings. */
const FAR_SIDE_AT = 14;
/** Ribbons out toward other towns start at this many buildings. */
const RIBBONS_AT = 12;
/** About this share of buildings take a second square beside them along the street. */
const PAIRED = 0.35;
/** Shops from this many buildings; second floors from this many. */
const SHOPS_AT = 6;
const FLOORS_AT = 12;

const FREE = 1;
const STREET = 2;
const BUILT = 3;
const EDGES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;

/** Does a town with its centre here start with a street behind the station too? (About two in five do.) */
export function startsBothSides(centre: { x: number; z: number }): boolean {
  return hashInts(Math.floor(centre.x / CELL), Math.floor(centre.z / CELL), 0x6a1) % 5 < 2;
}

/** The next `n` steps of a town's growth (fewer if it runs out of room). Changes nothing. */
export function growTown(grid: LandscapeGrid, town: GrowingTown, n: number, options: GrowOptions): GrowthStep[] {
  const cc = Math.floor(town.centre.x / CELL);
  const cr = Math.floor(town.centre.z / CELL);
  const ac = Math.round(Math.cos(town.heading));
  const ar = Math.round(Math.sin(town.heading));
  const lc = -ar;
  const lr = ac;
  const at = (a: number, b: number) => grid.index(cc + a * ac + b * lc, cr + a * ar + b * lr);
  const frame = (i: number) => {
    const dc = grid.colOf(i) - cc;
    const dr = grid.rowOf(i) - cr;
    return { a: dc * ac + dr * ar, b: dc * lc + dr * lr };
  };
  const seed = hashInts(cc, cr, 0x6a0);
  const noise = (...v: number[]) => hashInts(seed, ...v) / 4294967296;
  const nb = grid.neighbours();
  const station = town.cells.find((i) => grid.feature[i] === FEAT_STATION);
  const level = station === undefined ? 0 : grid.height[station];

  // The town's own picture of the land within reach: free, street, built (or neither: blocked).
  const state = new Map<number, number>();
  for (let dr = -Math.ceil(TOWN_REACH); dr <= Math.ceil(TOWN_REACH); dr++) {
    for (let dc = -Math.ceil(TOWN_REACH); dc <= Math.ceil(TOWN_REACH); dc++) {
      if (Math.hypot(dc, dr) > TOWN_REACH) continue;
      const i = grid.index(cc + dc, cr + dr);
      if (i === -1) continue;
      if (grid.surface[i] === SURF_ROAD) state.set(i, STREET);
      else if (grid.feature[i] === FEAT_BUILDING) state.set(i, BUILT);
      else if (grid.feature[i] !== FEAT_STATION && grid.height[i] === level && options.canUse(i)) state.set(i, FREE);
    }
  }
  const is = (i: number, s: number) => i !== -1 && state.get(i) === s;
  const isStreet = (i: number) => is(i, STREET);
  const builtBeside = (i: number) => {
    let k = 0;
    for (let e = 0; e < 4; e++) if (is(nb[i * 4 + e], BUILT)) k++;
    return k;
  };
  const streetsBeside = (i: number) => {
    let k = 0;
    for (let e = 0; e < 4; e++) if (isStreet(nb[i * 4 + e])) k++;
    return k;
  };
  const step = (i: number, e: number, k = 1) => grid.index(grid.colOf(i) + EDGES[e][0] * k, grid.rowOf(i) + EDGES[e][1] * k);
  const away = (i: number) => {
    const { a, b } = frame(i);
    return Math.hypot(a, b * 1.3);
  };

  // Road bytes: each street square joins its street neighbours; a dead end stays open straight on, for a road laid on.
  const roads = new Map<number, number>();
  for (const [i, s] of state) if (s === STREET) roads.set(i, grid.road[i]);
  const pieceOf = (i: number) => {
    let mask = 0;
    for (let e = 0; e < 4; e++) if (isStreet(nb[i * 4 + e]) || (nb[i * 4 + e] !== -1 && !state.has(nb[i * 4 + e]) && grid.surface[nb[i * 4 + e]] === SURF_ROAD)) mask |= 1 << e;
    if (mask === 1 || mask === 4) mask = 5;
    else if (mask === 2 || mask === 8) mask = 10;
    else if (mask === 0) mask = 5;
    return pieceForEdges(mask);
  };
  /** Lay street squares; returns every square set (them, and neighbours whose piece changes). */
  const lay = (cells: readonly number[]): [number, number][] => {
    for (const i of cells) state.set(i, STREET);
    const touched = new Set<number>(cells);
    for (const i of cells) for (let e = 0; e < 4; e++) if (isStreet(nb[i * 4 + e])) touched.add(nb[i * 4 + e]);
    const out: [number, number][] = [];
    for (const i of touched) {
      // An old save's street with no piece (drawn as felt) joins anything: leave it.
      if (!cells.includes(i) && roads.get(i) === 0) continue;
      const road = pieceOf(i);
      if (roads.get(i) === road) continue;
      roads.set(i, road);
      out.push([i, road]);
    }
    return out;
  };

  // Buildings already there: where they are, which way they face, and what they are.
  const records = new Map<number, { id: number; kind: "house" | "shop"; floors: 1 | 2; front?: Edge; landmark?: string }>();
  for (const b of town.buildings) records.set(b.cells[0], { id: b.id, kind: b.kind, floors: b.floors, front: b.front, landmark: b.landmark });
  let count = town.buildings.length;

  // Station Road (in front of the platform), and behind the station for a town that starts on both sides.
  const front = [-1, 0, 1].map((a) => at(a, 2));
  const back = [-1, 0, 1].map((a) => at(a, -2));
  const roots = () => [...front, ...back].filter(isStreet);
  const both = startsBothSides(town.centre);
  const opening = (side: number[]) => side.filter((i) => is(i, FREE));

  const dist = new Map<number, number>();
  const measure = () => {
    dist.clear();
    const todo = roots();
    if (todo.length === 0) for (const [i, s] of state) if (s === STREET) todo.push(i); // no Station Road: any street
    for (const i of todo) dist.set(i, 0);
    for (let k = 0; k < todo.length; k++) {
      const i = todo[k];
      for (let e = 0; e < 4; e++) {
        const j = nb[i * 4 + e];
        if (isStreet(j) && !dist.has(j)) {
          dist.set(j, dist.get(i)! + 1);
          todo.push(j);
        }
      }
    }
  };
  const d = (i: number) => dist.get(i) ?? Infinity;

  const gapAt = seed % GAP_EVERY;
  /** Held back while there's other room: straight on from a street's end, and a gap every few squares along a street. */
  const reserved = (i: number, s: number, e: number) => {
    if (isStreet(step(s, (e + 2) & 3))) return true;
    const { a, b } = frame(i);
    const along = Math.abs(EDGES[e][0] * ac + EDGES[e][1] * ar) === 1 ? b : a;
    return (((along + gapAt) % GAP_EVERY) + GAP_EVERY) % GAP_EVERY === 0;
  };
  type Lot = { i: number; s: number; e: Edge; dist: number; reserved: boolean };
  const lots = (): Lot[] => {
    const out: Lot[] = [];
    for (const [i, s] of state) {
      if (s !== FREE) continue;
      let best = -1;
      let be = 0;
      for (let e = 0; e < 4; e++) {
        const j = nb[i * 4 + e];
        if (isStreet(j) && (best === -1 || d(j) < d(best))) {
          best = j;
          be = e;
        }
      }
      if (best !== -1 && d(best) < Infinity) out.push({ i, s: best, e: be as Edge, dist: d(best), reserved: reserved(i, best, (be + 2) & 3) });
    }
    return out;
  };
  const lotScore = (l: Lot) => {
    // Opposite a building across the street: both sides fill together.
    const opposite = is(step(l.s, l.e), BUILT) ? 0.7 : 0;
    return -0.35 * l.dist - 0.35 * away(l.i) + 0.9 * builtBeside(l.i) + opposite + 0.5 * noise(11, l.i);
  };

  const toward = (options.toward ?? []).filter((p) => Math.hypot(p.x - town.centre.x, p.z - town.centre.z) > CELL);
  const pullTo = (from: number, to: number) => {
    let pull = 0;
    for (const p of toward) {
      const dd = (i: number) => Math.hypot(grid.centreX(grid.colOf(i)) - p.x, grid.centreZ(grid.rowOf(i)) - p.z) / CELL;
      pull = Math.max(pull, dd(from) - dd(to));
    }
    return pull;
  };
  type Extension = { s: number; t: number; e: number; branch: boolean; score: number };
  const extensions = (): Extension[] => {
    const out: Extension[] = [];
    for (const [s, st] of state) {
      if (st !== STREET || d(s) === Infinity) continue;
      for (let e = 0; e < 4; e++) {
        const t = nb[s * 4 + e];
        if (!is(t, FREE)) continue;
        // Never a street two wide, and two lots' depth between parallel streets.
        const sides = [(e + 1) & 3, (e + 3) & 3];
        if (sides.some((p) => isStreet(step(t, p)) || isStreet(step(t, p, 2)))) continue;
        const straight = isStreet(step(s, (e + 2) & 3));
        if (!straight && builtBeside(s) === 0) continue; // a side street leaves a stretch with houses
        if (!straight) {
          // ...a plain stretch, not beside a corner or another junction.
          let plain = true;
          for (let k = 0; k < 4 && plain; k++) {
            const b = nb[s * 4 + k];
            if (!isStreet(b)) continue;
            const ns = [0, 1, 2, 3].map((q) => isStreet(nb[b * 4 + q]));
            const c = ns.filter(Boolean).length;
            plain = c === 1 || (c === 2 && ((ns[0] && ns[2]) || (ns[1] && ns[3])));
          }
          if (!plain) continue;
          // A street's end turns a corner only after running on a little.
          if (streetsBeside(s) === 1) {
            const k = [0, 1, 2, 3].find((q) => isStreet(nb[s * 4 + q]))!;
            if (!isStreet(step(s, k, 2))) continue;
          }
        }
        let empty = 0;
        for (let k = 0, j = s; k < 3 && isStreet(j); k++, j = step(j, (e + 2) & 3)) {
          if (builtBeside(j) > 0) break;
          empty++;
        }
        const pull = count >= RIBBONS_AT ? pullTo(s, t) : 0;
        if (empty >= 1 && pull <= 0) continue; // don't run on along a street with nothing built on it
        let run = 0;
        for (let j = s; isStreet(j) && run < 8; j = step(j, (e + 2) & 3)) run++;
        const corner = !straight && streetsBeside(s) === 1;
        // A side street runs out a block's depth, then turns or runs on; plain ribbons only toward a road out.
        const shape = straight ? (run < 3 ? 1 : pull > 0 ? 0.6 : 0.3 - 0.3 * (run - 3)) : corner ? 0.9 : 0.6;
        const fs = frame(s);
        const ft = frame(t);
        const out_ = Math.abs(ft.b) > Math.abs(fs.b) ? 0.6 : 0;
        const join = isStreet(step(t, e)) ? 1.4 : 0;
        const alongside = sides.some((p) => isStreet(step(t, p, 3))) ? 0.6 : 0;
        const score = -0.45 * away(t) + shape + out_ + 0.9 * pull + join + alongside + 0.6 * noise(12, t);
        out.push({ s, t, e, branch: !straight, score });
      }
    }
    return out.sort((x, y) => y.score - x.score || x.t - y.t);
  };

  /** The square beside a lot along its street that could join it (free, facing the same street), or −1. */
  const partner = (l: Lot): number => {
    for (const p of [(l.e + 1) & 3, (l.e + 3) & 3]) {
      const j = step(l.i, p);
      if (is(j, FREE) && isStreet(step(j, l.e)) && !reserved(j, step(j, l.e), (l.e + 2) & 3)) return j;
    }
    return -1;
  };
  let wide = options.wide ?? 0;

  const steps: GrowthStep[] = [];
  // A town with no Station Road yet (a new one) lays it first.
  let pending: [number, number][] = [];
  if (roots().length === 0) {
    const first = [...opening(front), ...(both ? opening(back) : [])];
    if (first.length === 0) return steps;
    pending = lay(first);
  }
  while (steps.length < n) {
    const streets: [number, number][] = pending;
    pending = [];
    if (count >= FAR_SIDE_AT && !back.some(isStreet) && opening(back).length === 3) streets.push(...lay(opening(back)));
    let built: Lot | null = null;
    for (let tries = 0; tries < 6 && !built; tries++) {
      measure();
      const all = lots();
      let edge = 0;
      for (const [i, s] of state) if (s === BUILT && records.get(i)?.front !== undefined) edge = Math.max(edge, d(step(i, records.get(i)!.front!)));
      const near = all.filter((l) => l.dist <= edge + 1 && !l.reserved);
      const ext = tries < 5 ? extensions() : [];
      if (near.length >= 2 || (all.length > 0 && ext.length === 0)) {
        const open = all.filter((l) => !l.reserved);
        let pool = near.length >= 2 ? near : open.length > 0 ? open : all;
        if (wide > 0) {
          // A big building wants two squares: the best lot that has them, close in if it can be.
          const pairs = (ls: Lot[]) => ls.filter((l) => partner(l) !== -1);
          pool = [pairs(pool), pairs(open), pairs(all)].find((ls) => ls.length > 0) ?? pool;
        }
        built = pool.reduce((x, y) => (lotScore(y) > lotScore(x) || (lotScore(y) === lotScore(x) && y.i < x.i) ? y : x));
      } else if (ext.length > 0) streets.push(...lay([ext[0].t]));
      else break;
    }
    if (!built) break;
    state.set(built.i, BUILT);
    const cells = [built.i];
    // Sometimes (or when asked for) two squares side by side along the street, both facing it.
    if (wide > 0 || noise(15, built.i) < PAIRED) {
      const j = partner(built);
      if (j !== -1) {
        state.set(j, BUILT);
        cells.push(j);
      }
    }
    if (wide > 0) wide--;
    count++;
    const corner = cells.some((i) => streetsBeside(i) >= 2);
    records.set(built.i, { id: -1 - steps.length, kind: "house", floors: 1, front: built.e });
    // The middle evolves: one change a step at most, and only to buildings already standing.
    measure();
    const changes: GrowthStep["changes"] = [];
    const central = (i: number) => {
      const f = records.get(i)?.front;
      return f === undefined ? Infinity : d(step(i, f));
    };
    const standing = [...records].filter(([i, r]) => i !== built!.i && !r.landmark).sort(([x], [y]) => central(x) - central(y) || x - y);
    if (count >= SHOPS_AT && count % 2 === 0) {
      const reach = 1 + Math.floor(count / 9);
      const shop = standing.find(([i, r]) => r.kind === "house" && central(i) <= reach && noise(14, i) < (streetsBeside(i) >= 2 ? 0.75 : 0.45));
      if (shop) {
        shop[1].kind = "shop";
        changes.push({ id: shop[1].id, kind: "shop" });
      }
    } else if (count >= FLOORS_AT && count % 3 === 0) {
      const up = standing.find(([i, r]) => r.floors === 1 && central(i) <= 2);
      if (up) {
        up[1].floors = 2;
        changes.push({ id: up[1].id, floors: 2 });
      }
    }
    steps.push({ cells, front: built.e, corner, streets, changes });
  }
  return steps;
}
