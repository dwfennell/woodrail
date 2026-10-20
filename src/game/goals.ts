import { connectedPairs, SURF_RIVER, type LandscapeGrid } from "../landscape";
import { acrossRiver, type AcrossRiver } from "./across-river";
import { getPieceDef, isBridge, type PieceTypeId } from "../track";
import { BLUEPRINTS } from "./blueprints";
import { workshops, workshopStock } from "./crafting";
import { THING_RULES, type ThingId } from "./things";
import { depotSpot } from "./depot-footprint";
import { schoolOf, siteWhy } from "./industries";
import { receivedBy } from "./town-life";
import { townStatus } from "./towns";
import { schoolTown, type World } from "./world";

/** How far along a goal is: done or not, with an optional count toward a target ("2 / 3 towns"). */
export interface GoalProgress {
  done: boolean;
  count?: number;
  target?: number;
  unit?: string;
  /** A nudge for how things stand now, in place of the goal's own. */
  hint?: string;
}

/** Where to look for a goal ("Show me"): places to frame and point at, and the tray tab that has what it needs. */
export interface GoalGuide {
  /** Places to frame, on the ground (mm). Empty: leave the camera be. */
  points: { x: number; z: number }[];
  /** Towns whose signs to flash. */
  towns: number[];
  /** Places to mark with a pulse (depots, trains): the towns' signs flash instead. */
  marks: { x: number; z: number }[];
  /** The tray tab to open, and a shelf in it. */
  tab?: "track" | "trains" | "industries";
  shelf?: string;
  /**
   * A piece the goal asks for, and the way round it fits at the guided spot: taken from the tray after "Show me", it
   * comes out turned that way (held so, a depot takes the straight's place that way round), not as the view would
   * turn it (QA: the workshop's spot was refused, its building over the river, in the starting view).
   */
  held?: { type: PieceTypeId; heading: number };
}

/** What a goal may ask beyond the world: the player's progress (blueprints learned). */
export interface GoalContext {
  learned: ReadonlySet<string>;
  /** The toy box (all owned, on the map or not), and the workshop's orders waiting: for "Make a switch". */
  owned?: ReadonlyMap<ThingId, number>;
  orders?: readonly ThingId[];
}

const NO_CONTEXT: GoalContext = { learned: new Set() };

export interface Goal {
  readonly id: string;
  readonly title: string;
  /** A nudge toward how to do it. */
  readonly hint: string;
  /** Reads only the world's state, so it holds after a reload as well as in play. */
  check(world: World, ctx?: GoalContext): GoalProgress;
  /** Where to look and what to reach for, from the world as it is now. */
  guide(world: World): GoalGuide;
  /** Blueprints to learn before it shows or counts (till then it's passed over). */
  readonly needs?: readonly string[];
  /** The blueprint it's after, if any (to research at a school). */
  readonly blueprint?: string;
  /** The tray item it asks to place: ringed on the tray while it's the goal and none is on the map (see `trayRing`). */
  readonly ring?: PieceTypeId;
}

/** Above this speed (mm/s) a train counts as running. */
const RUNNING = 5;

const running = (w: World) =>
  w.sim.trainIds().filter((id) => {
    const t = w.sim.getTrain(id);
    return t && !t.derailed && t.speed > RUNNING;
  });

/** The towns of the largest network of track joining two or more towns (empty when no two are joined). */
function largestNetwork(w: World): number[] {
  // Every pair within a network is listed, so a town's partners plus itself are its whole network.
  const partners = new Map<number, number[]>();
  for (const [a, b] of connectedPairs(w.layout, w.stations)) {
    partners.set(a, [...(partners.get(a) ?? []), b]);
    partners.set(b, [...(partners.get(b) ?? []), a]);
  }
  let best: number[] = [];
  for (const [town, others] of partners) if (others.length + 1 > best.length) best = [town, ...others];
  return best;
}

const towns = (w: World, target: number): GoalProgress => {
  const n = largestNetwork(w).length;
  return { done: n >= target, count: Math.min(n, target), target, unit: "towns" };
};

type Point = { x: number; z: number };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const townAt = (w: World, id: number): Point => w.landscape.towns.find((t) => t.id === id)!.centre;
const piecePoint = (w: World, id: number): Point => w.layout.getPiece(id)!.pose;

/** Where a train is (its first bogie's piece). */
const trainPoint = (w: World, trainId: number): Point | null => {
  const b = w.sim.getTrain(trainId)?.bogies[0];
  return b ? piecePoint(w, b.pieceId) : null;
};
const trainPoints = (w: World) => w.sim.trainIds().flatMap((id) => trainPoint(w, id) ?? []);

/** The player's own track (not stations or depots). */
const trackPoints = (w: World): Point[] => {
  const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
  return [...w.layout.pieceIds()].filter((id) => !fixed.has(id)).map((id) => piecePoint(w, id));
};

/** The closest pair of `from` and `to` (null when either is empty). */
function closest<A, B>(from: readonly A[], to: readonly B[], at: (x: A | B) => Point): [A, B] | null {
  let best: [A, B] | null = null;
  let d = Infinity;
  for (const a of from)
    for (const b of to) {
      const e = dist(at(a), at(b));
      if (e < d && (a as unknown) !== b) [best, d] = [[a, b], e];
    }
  return best;
}

/**
 * The next town to join, and the town on the railway nearest it. With no two towns joined yet: a starter map's first
 * two towns (they have a clear run between them), or else the two towns closest together.
 */
function nextTowns(w: World): number[] {
  const all = w.landscape.towns.map((t) => t.id);
  const joined = largestNetwork(w);
  if (joined.length === 0 && w.landscape.starter && all.length >= 2) return all.slice(0, 2);
  const left = all.filter((id) => !joined.includes(id));
  const pair = joined.length > 0 ? closest(joined, left, (id) => townAt(w, id)) : closest(all, all, (id) => townAt(w, id));
  return pair ?? [];
}

const guideTowns = (w: World, ids: number[]): GoalGuide => ({ points: ids.map((id) => townAt(w, id)), towns: ids, marks: [] });

/** The schools on the map. */
const schools = (w: World) => w.economy.allDepots().filter((d) => d.role === "school");

/**
 * Where research goes on: the school (and the sawmill, for its planks); with none on the map yet, a straight of the
 * line beside the town that's grown most (its station first), where the school fits and would take that town's name;
 * else beside the next town grown most. The town is named over its station, so the spot and the school's name agree
 * (QA: the spot near one town's station was beside another, whose name the school took).
 */
export function guideSchool(w: World): GoalGuide {
  const school = schools(w)[0];
  if (school) {
    const at = piecePoint(w, school.pieceId);
    return { points: [at, ...guideDepot(w, "sawmill").points.slice(0, 1)], towns: [], marks: [at] };
  }
  const guide: GoalGuide = { ...guideTrains(w), tab: "industries", shelf: "Industries" };
  const towns = [...w.landscape.towns].sort((a, b) => townStatus(receivedBy(w, b.id)).fill - townStatus(receivedBy(w, a.id)).fill);
  for (const town of towns) {
    const station = w.stations.get(town.id);
    if (station === undefined) continue;
    const fits = (pose: { x: number; z: number; heading: number }) => schoolTown(w.landscape, pose)?.town.id === town.id && !siteWhy(w.landscape, "depot-school", pose, (id) => schoolOf(w, id));
    const spot = depotSpot(w, "depot-school", [piecePoint(w, station)], fits);
    if (spot) return { ...guide, points: [{ x: spot.x, z: spot.z }], towns: [town.id], marks: [{ x: spot.x, z: spot.z }], held: { type: "depot-school", heading: spot.heading } };
  }
  const town = towns.find((t) => w.stations.has(t.id));
  if (!town) return guide;
  return { ...guide, ...guideTowns(w, [town.id]), tab: "industries", shelf: "Industries" };
}

/**
 * The tray item to ring for this goal (the current one), or null: the piece it asks to place while none is on the map
 * (QA: during "Place a school by a town" the Workshop was ringed, as it was whenever none was placed).
 */
export function trayRing(goal: Goal | null | undefined, w: World): PieceTypeId | null {
  const type = goal?.ring;
  if (!type) return null;
  const role = type === "depot-school" ? "school" : type === "depot-workshop" ? "workshop" : null;
  return role && w.economy.allDepots().some((d) => d.role === role) ? null : type;
}

/** Look at what's on the board: the trains (or failing that the track, or the first towns) and reach for a tab. */
function guideTrains(w: World, tab?: GoalGuide["tab"], shelf?: string): GoalGuide {
  const trains = trainPoints(w);
  const points = trains.length > 0 ? trains : trackPoints(w);
  if (points.length === 0) return { ...guideTowns(w, nextTowns(w)), tab, shelf };
  return { points, towns: [], marks: trains, tab, shelf };
}

/** A depot of this kind nearest the railway (or the trains), framed with the nearest town on the railway. */
function guideDepot(w: World, kind: "forest" | "sawmill"): GoalGuide {
  const depots = w.landscape.depots.filter((d) => d.kind === kind).map((d) => piecePoint(w, w.depots.get(d.id)!));
  const joined = largestNetwork(w);
  const towns = joined.length > 0 ? joined : nextTowns(w);
  const pair = closest(depots, towns.map((id) => townAt(w, id)), (p) => p);
  if (!pair) return guideTowns(w, towns);
  const town = towns.find((id) => townAt(w, id) === pair[1])!;
  return { points: [pair[0], pair[1]], towns: [town], marks: [pair[0]] };
}

/** River squares' centres by grid, rebuilt when the grid changes (a plot added or a square edited). */
const riverCache = new WeakMap<LandscapeGrid, { revision: number; points: Point[] }>();

function riverPoints(grid: LandscapeGrid): Point[] {
  const hit = riverCache.get(grid);
  if (hit && hit.revision === grid.revision) return hit.points;
  const points: Point[] = [];
  grid.forEachCell((i, col, row) => {
    if (grid.surface[i] === SURF_RIVER) points.push({ x: grid.centreX(col), z: grid.centreZ(row) });
  });
  riverCache.set(grid, { revision: grid.revision, points });
  return points;
}

/** Most anchors compared with the river squares on one tap (the track is thinned to this many points). */
const MAX_ANCHORS = 80;

/** The player's line, for what's across the river from it: their track and the towns on their railway (or the next towns to join). */
function lineOf(w: World): Point[] {
  const track = trackPoints(w);
  const joined = largestNetwork(w);
  const ids = joined.length > 0 ? joined : track.length > 0 ? [] : nextTowns(w);
  return [...track, ...ids.map((id) => w.landscape.towns.find((t) => t.id === id)!.station)];
}

/** `acrossRiver` from the line, by world, kept while the track (pieces and where they lie) and the land are the same. */
const acrossCache = new WeakMap<World, { key: string; hit: AcrossRiver | null }>();

function bridgeTarget(w: World): AcrossRiver | null {
  const land = w.landscape;
  const key = `${w.layout.revision}|${land.grid.revision}|${land.towns.length}|${land.depots.length}`;
  const cached = acrossCache.get(w);
  if (cached?.key === key) return cached.hit;
  const hit = riverPoints(land.grid).length === 0 ? null : acrossRiver(land, lineOf(w), land.depots.map((d) => d.centre));
  acrossCache.set(w, { key, hit });
  return hit;
}

/** The bridge goal's hint when there's a river but nothing across it to reach. */
export const NOTHING_ACROSS_HINT = "Nothing's across the river yet. Research bridges, make one and lay it over the water.";
/** The same, with bridges learned already: nothing to say about learning them. */
export const NOTHING_ACROSS_KNOWN = "Nothing's across the river yet. Make a bridge at your workshop and lay it over the water.";
/** The bridge goal's hint with bridges learned. */
export const BRIDGE_KNOWN_HINT = "Make a bridge at your workshop, then take your track over a river.";

/**
 * Where a bridge is wanted: where the shortest way from the line to the nearest thing across the river (a town off the
 * railway, a depot, ground for an industry: `acrossRiver`) crosses it, framed with both banks (and the thing, when
 * it's near). With nothing across: the river square nearest the player's line (their track and the towns on their
 * railway, or else the next towns to join), framed with that bit of the line. With no river on the map: the line as
 * it is. The Track tab opens on its Bridges shelf.
 */
function guideBridge(w: World): GoalGuide {
  const tab = "track";
  const shelf = "Bridges";
  const river = riverPoints(w.landscape.grid);
  if (river.length === 0) return guideTrains(w, tab, shelf);
  const ahead = bridgeTarget(w);
  if (ahead) {
    const points = [ahead.river, ahead.near, ahead.far];
    if (dist(ahead.at, ahead.river) <= SHOW_ACROSS) points.push(ahead.at);
    return { points, towns: ahead.town === undefined ? [] : [ahead.town], marks: [ahead.river], tab, shelf };
  }
  const joined = largestNetwork(w);
  const track = trackPoints(w);
  const step = Math.max(1, Math.ceil(track.length / MAX_ANCHORS));
  const anchors: Point[] = [...track.filter((_, i) => i % step === 0), ...(joined.length > 0 ? joined : nextTowns(w)).map((id) => townAt(w, id))];
  if (anchors.length === 0) anchors.push(...w.landscape.towns.map((t) => t.centre));
  const pair = closest(anchors, river, (p) => p);
  if (!pair) return guideTrains(w, tab, shelf);
  return { points: [pair[1], pair[0]], towns: [], marks: [pair[1]], tab, shelf };
}

/** What's across the river is framed with the crossing when it's this near it (mm); further, just the crossing. */
const SHOW_ACROSS = 1500;

const deliveredTotal = (w: World) => {
  let n = 0;
  for (const v of w.economy.delivered.values()) n += v;
  return n;
};

const hasPiece = (w: World, test: (type: PieceTypeId, flipped: boolean) => boolean) =>
  [...w.layout.pieceIds()].some((id) => {
    const p = w.layout.getPiece(id)!;
    return test(p.type, p.flipped);
  });

const stationPieces = (w: World) => new Set(w.stations.values());

/** The Game mode's goals, worked through in order. */
/** "Run two trains at once" with one train on the map. */
/** "Make a switch": choose it first; the workshop keeps planks only for an order (`orderPlanks`). */
export const MAKE_SWITCH_HINT = "Tap your workshop and choose Switch. Trains then bring its planks.";
export const SWITCH_ORDERED_HINT = "Ordered: trains bring the workshop its planks.";

export const TWO_TRAINS_HINT = "Put a second engine on the track, then lay a passing loop with signals.";

/**
 * What to say of the second engine when "Run two trains at once" opens: where it is (one free in the toy box), or to
 * make one (fewer than two owned); nothing if both are on the map already.
 */
export function secondEngineTip(free: number, owned: number): string {
  if (free > 0) return "Engine in the Trains tab";
  if (owned < 2) return "Make an engine at the workshop";
  return "";
}

export const GOALS: readonly Goal[] = [
  {
    id: "join-two",
    title: "Join two towns",
    hint: "Lay track from one town's station to another's.",
    check: (w) => towns(w, 2),
    guide: (w) => guideTowns(w, nextTowns(w)),
  },
  {
    id: "place-train",
    title: "Put a train on the track",
    hint: "Drag a train from the Trains tab onto your rails.",
    check: (w) => ({ done: w.sim.trainIds().length > 0 }),
    guide: (w) => guideTrains(w, "trains"),
  },
  {
    id: "get-moving",
    title: "Get a train moving",
    hint: "Tap the engine, then tap Go.",
    check: (w) => ({ done: running(w).length > 0 }),
    guide: (w) => guideTrains(w),
  },
  {
    id: "station-stop",
    title: "Run a train into a station",
    hint: "Drive a train onto a town's station.",
    check: (w) => {
      const stations = stationPieces(w);
      return { done: running(w).some((id) => w.sim.getTrain(id)?.bogies.some((b) => stations.has(b.pieceId))) };
    },
    guide: (w) => {
      const trains = trainPoints(w);
      const stations = [...w.stations.keys()];
      const pair = closest(trains, stations, (x) => (typeof x === "number" ? townAt(w, x) : x));
      if (!pair) return guideTrains(w, "trains");
      return { points: [pair[0], townAt(w, pair[1])], towns: [pair[1]], marks: [pair[0]] };
    },
  },
  {
    id: "timber-train",
    title: "Make up a flatbed train",
    hint: "Couple a flatbed wagon to an engine.",
    check: (w) => ({
      done: w.sim.trainIds().some((id) => {
        const cars = w.sim.getTrain(id)?.cars ?? [];
        return cars.some((c) => c.kind === "engine") && cars.some((c) => c.kind === "timber");
      }),
    }),
    guide: (w) => guideTrains(w, "trains"),
  },
  {
    id: "load-logs",
    title: "Load logs at the forest",
    hint: "Lay track to the forest yard and stop a flatbed wagon under its crane.",
    check: (w) => ({ done: w.sim.trainIds().some((id) => w.sim.getTrain(id)?.cars.some((c) => w.economy.cargoOf(c.id).kind === "log")) }),
    guide: (w) => guideDepot(w, "forest"),
  },
  {
    id: "deliver-planks",
    title: "Deliver planks to a town",
    hint: "Take logs to the sawmill, then carry its planks to a town's station.",
    check: (w) => ({ done: deliveredTotal(w) > 0 }),
    guide: (w) => guideDepot(w, "sawmill"),
  },
  {
    id: "grow-town",
    title: "Grow a town into a village",
    hint: "A town's sign shows what it wants. Fill its bar and it grows.",
    check: (w) => {
      const best = Math.max(0, ...w.landscape.towns.map((t) => townStatus(receivedBy(w, t.id)).level));
      return { done: best >= 1 };
    },
    guide: (w) => {
      // The town nearest to growing.
      const fills = w.landscape.towns.map((t) => ({ id: t.id, fill: townStatus(receivedBy(w, t.id)).fill }));
      const best = fills.sort((a, b) => b.fill - a.fill)[0];
      return best ? { ...guideTowns(w, [best.id]), marks: [] } : guideDepot(w, "sawmill");
    },
  },
  {
    id: "place-school",
    title: "Place a school by a town",
    hint: "Your village's present: drop it from the Industries tab on a straight beside a town.",
    ring: "depot-school",
    check: (w) => ({ done: schools(w).length > 0 }),
    guide: guideSchool,
  },
  {
    id: "learn-switches",
    blueprint: "switches",
    ring: "depot-school",
    title: "Research switches",
    hint: "Pick Switches, then bring 4 planks to the school.",
    check: (w, ctx = NO_CONTEXT) => ({ done: ctx.learned.has("switches"), ...(ctx.learned.has("switches") || schools(w).length > 0 ? {} : { hint: "Place your school beside a town (Industries tab)." }) }),
    guide: guideSchool,
  },
  {
    id: "place-workshop",
    title: "Place your workshop",
    hint: "Drop it from the Industries tab onto a straight on your line.",
    ring: "depot-workshop",
    // (Only the workshop itself: switches are researched at the school, so knowing them says nothing of a workshop.)
    check: (w) => ({ done: workshops(w).length > 0 }),
    guide: (w) => {
      const guide: GoalGuide = { ...guideTrains(w), tab: "industries", shelf: "Industries" };
      // A straight of the line where the workshop fits, yard and all: nearest the map's stations and depots.
      const near = [...w.depots.values(), ...w.stations.values()].map((id) => piecePoint(w, id));
      const spot = depotSpot(w, "depot-workshop", near);
      if (spot) return { ...guide, points: [{ x: spot.x, z: spot.z }], towns: [], marks: [{ x: spot.x, z: spot.z }], held: { type: "depot-workshop", heading: spot.heading } };
      // No straight where it fits yet: still a marker, on the line where it's nearest the stations and depots (with
      // no line yet, the towns' stations are ringed).
      const line = closest(trackPoints(w), near, (p) => p);
      return line ? { ...guide, points: [line[0], line[1]], towns: [], marks: [line[0]] } : guide;
    },
  },
  {
    // The workshop keeps planks only for an order waiting (`orderPlanks`), so the order comes first and trains then
    // bring its planks (QA P4: "Bring planks to the workshop" stalled, towns taking every plank with nothing ordered).
    id: "make-switch",
    title: "Make a switch",
    hint: MAKE_SWITCH_HINT,
    check: (w, ctx = NO_CONTEXT) => {
      if ((ctx.owned?.get("piece:switch") ?? 0) > 0 || hasPiece(w, (type, flipped) => getPieceDef(type, flipped).isSwitch)) return { done: true };
      if (!ctx.orders?.includes("piece:switch")) return { done: false };
      // Ordered: its planks on their way.
      const need = THING_RULES["piece:switch"]!.cost.planks ?? 0;
      const have = Math.min(need, workshopStock(w).planks ?? 0);
      return { done: false, count: have, target: need, unit: "planks", hint: SWITCH_ORDERED_HINT };
    },
    guide: (w) => {
      const shop = workshops(w)[0];
      const saw = guideDepot(w, "sawmill");
      if (!shop) return saw;
      const at = piecePoint(w, shop.pieceId);
      return { points: [at, ...saw.points.slice(0, 1)], towns: [], marks: [at] };
    },
  },
  {
    id: "lay-switch",
    title: "Lay a switch",
    hint: "Lay your switch from the Switch shelf on the Track tab.",
    check: (w) => ({ done: hasPiece(w, (type, flipped) => getPieceDef(type, flipped).isSwitch) }),
    guide: (w) => guideTrains(w, "track", "Switch"),
  },
  {
    id: "build-bridge",
    blueprint: "bridges",
    title: "Build a bridge",
    hint: "Research bridges, make one at your workshop, then take your track over a river.",
    check: (w, ctx = NO_CONTEXT) => {
      if (hasPiece(w, (type) => isBridge(type))) return { done: true };
      // (Bridges learned already: the hints skip the learning.)
      const known = ctx.learned.has("bridges");
      if (riverPoints(w.landscape.grid).length > 0 && !bridgeTarget(w)) return { done: false, hint: known ? NOTHING_ACROSS_KNOWN : NOTHING_ACROSS_HINT };
      return known ? { done: false, hint: BRIDGE_KNOWN_HINT } : { done: false };
    },
    guide: guideBridge,
  },
  {
    id: "join-three",
    title: "Connect three towns",
    hint: "Grow your railway until three towns are on it.",
    check: (w) => towns(w, 3),
    guide: (w) => guideTowns(w, nextTowns(w)),
  },
  {
    id: "deliver-ten",
    title: "Deliver 10 bundles of planks",
    hint: "Keep the timber running: forest, sawmill, town.",
    check: (w) => {
      const n = deliveredTotal(w);
      return { done: n >= 10, count: Math.min(n, 10), target: 10, unit: "bundles" };
    },
    guide: (w) => guideDepot(w, "sawmill"),
  },
  {
    id: "two-trains",
    title: "Run two trains at once",
    hint: "Lay a passing loop with signals so they can pass.",
    // On one line two trains only turn each other back: this goal waits till the player can build a passing loop (two
    // switches, learned before signals) with signals to hold one train while the other passes.
    needs: ["signals"],
    check: (w) => {
      const n = running(w).length;
      // One train on the map: the second engine first (QA: what to do wasn't said).
      const p: GoalProgress = { done: n >= 2, count: Math.min(n, 2), target: 2, unit: "trains" };
      return n < 2 && w.sim.trainIds().length < 2 ? { ...p, hint: TWO_TRAINS_HINT } : p;
    },
    guide: (w) => guideTrains(w, "trains", "Engines"),
  },
  {
    id: "join-all",
    title: "Connect every town",
    hint: "One railway that reaches every town on the map.",
    check: (w) => towns(w, w.landscape.towns.length),
    guide: (w) => guideTowns(w, nextTowns(w)),
  },
];

/** The first of the open goals (a bridge, three towns, ten deliveries...): from here on, done as soon as they're met. */
const FIRST_OPEN_GOAL = "build-bridge";

/**
 * Goals done. A tutorial goal met early (a switch laid before any train runs) waits, met, until its turn; the open
 * goals after the tutorial count as soon as they're met. One is ticked off a check, so a busy moment doesn't tick off
 * several at once. A goal once met stays met (some only hold for a moment, like a train moving).
 */
export class GoalTracker {
  private readonly done: Set<string>;
  /** Met, not yet ticked off (its turn hasn't come). */
  private readonly met = new Set<string>();

  constructor(done: Iterable<string> = []) {
    const known = new Set(GOALS.map((g) => g.id));
    this.done = new Set([...done].filter((id) => known.has(id)));
  }

  /**
   * Check every goal not yet done; returns the one ticked off now, or none. The tutorial's goals wait their turn (the
   * current one is ticked off when met); the open goals after it (from `FIRST_OPEN_GOAL`) are ticked off as soon as
   * they're met, whatever the current goal. One a check either way.
   */
  update(world: World, ctx: GoalContext = NO_CONTEXT): Goal[] {
    this.learned = ctx.learned;
    for (const g of GOALS) if (!this.done.has(g.id) && !this.met.has(g.id) && this.open(g) && g.check(world, ctx).done) this.met.add(g.id);
    const now = this.current();
    const open = GOALS.findIndex((g) => g.id === FIRST_OPEN_GOAL);
    const next = GOALS.find((g, i) => this.met.has(g.id) && (g === now || i >= open));
    if (!next) return [];
    this.met.delete(next.id);
    this.done.add(next.id);
    return [next];
  }

  /** Is this goal met, waiting for its turn? */
  waiting(id: string): boolean {
    return this.met.has(id);
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  get doneCount(): number {
    return this.done.size;
  }

  /** The first goal not yet done (null when all are). */
  current(): Goal | null {
    return this.left()[0] ?? null;
  }

  /** The goal after the current one. */
  next(): Goal | null {
    return this.left()[1] ?? null;
  }

  /** Blueprints learned, as of the last check (a goal that needs some waits for them). */
  private learned: ReadonlySet<string> = NO_CONTEXT.learned;

  /** Can this goal show and count yet (its blueprints learned)? */
  private open(g: Goal): boolean {
    return !g.needs || g.needs.every((id) => this.learned.has(id));
  }

  /** The goals not done that can show now, in order (one waiting for its blueprints is hidden, and not counted). */
  private left(): Goal[] {
    return GOALS.filter((g) => !this.done.has(g.id) && this.open(g));
  }

  /** The goals counted now: those done and those open ("3 / 16" while one waits for its blueprints). */
  get total(): number {
    return GOALS.filter((g) => this.done.has(g.id) || this.open(g)).length;
  }

  /** The goals still to come that wait for blueprints (hidden, but counted on the panel: "16 / 17", not "16 / 16"). */
  get lockedCount(): number {
    return GOALS.filter((g) => !this.done.has(g.id) && !this.open(g)).length;
  }

  /** A goal still to come that waits for blueprints, in a few words: "Research Signals to unlock a goal" (or null). */
  lockedHint(): string | null {
    const g = GOALS.find((x) => !this.done.has(x.id) && !this.open(x));
    if (!g) return null;
    const names = g.needs!.filter((id) => !this.learned.has(id)).map((id) => BLUEPRINTS.find((b) => b.id === id)?.label ?? id);
    return `Research ${names.join(" and ")} to unlock a goal`;
  }

  /**
   * The goals learning blueprint `tech` opens (all their blueprints now in `learned`), not yet done: for the "Learned"
   * news to name (QA: "Run two trains at once" opened unseen behind the current goal).
   */
  openedBy(tech: string, learned: ReadonlySet<string>): Goal[] {
    return GOALS.filter((g) => !this.done.has(g.id) && !!g.needs?.includes(tech) && g.needs.every((id) => learned.has(id)));
  }

  /** The goals to save: those done, and those met and waiting (they're ticked off after a reload). */
  ids(): string[] {
    return [...this.done, ...this.met];
  }
}
