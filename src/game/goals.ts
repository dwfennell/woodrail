import { connectedPairs } from "../landscape";
import { getPieceDef, isBridge, type PieceTypeId } from "../track";
import { receivedBy } from "./town-life";
import { townStatus } from "./towns";
import type { World } from "./world";

/** How far along a goal is: done or not, with an optional count toward a target ("2 / 3 towns"). */
export interface GoalProgress {
  done: boolean;
  count?: number;
  target?: number;
  unit?: string;
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
  tab?: "track" | "trains" | "bridges";
  shelf?: string;
}

export interface Goal {
  readonly id: string;
  readonly title: string;
  /** A nudge toward how to do it. */
  readonly hint: string;
  /** Reads only the world's state, so it holds after a reload as well as in play. */
  check(world: World): GoalProgress;
  /** Where to look and what to reach for, from the world as it is now. */
  guide(world: World): GoalGuide;
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
    hint: "Tap the engine and push its lever forward.",
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
    title: "Make up a timber train",
    hint: "Couple a timber wagon to an engine.",
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
    hint: "Lay track to the forest yard and stop a timber wagon under its crane.",
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
    id: "lay-switch",
    title: "Lay a switch",
    hint: "Learn switches on the blueprint board, make one at your workshop, then lay it from the Switch shelf.",
    check: (w) => ({ done: hasPiece(w, (type, flipped) => getPieceDef(type, flipped).isSwitch) }),
    guide: (w) => guideTrains(w, "track", "Switch"),
  },
  {
    id: "build-bridge",
    title: "Build a bridge",
    hint: "Learn bridges on the blueprint board and make one at your workshop. Then take your track over a river.",
    check: (w) => ({ done: hasPiece(w, (type) => isBridge(type)) }),
    guide: (w) => guideTrains(w, "bridges"),
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
    hint: "Put a second train on the line and get both moving.",
    check: (w) => {
      const n = running(w).length;
      return { done: n >= 2, count: Math.min(n, 2), target: 2, unit: "trains" };
    },
    guide: (w) => guideTrains(w, "trains"),
  },
  {
    id: "join-all",
    title: "Connect every town",
    hint: "One railway that reaches every town on the map.",
    check: (w) => towns(w, w.landscape.towns.length),
    guide: (w) => guideTowns(w, nextTowns(w)),
  },
];

/**
 * Goals done, in the order they were done. A goal once done stays done; goals may be done out of order (laying a
 * switch before running a train), but the panel shows the first one not yet done.
 */
export class GoalTracker {
  private readonly done: Set<string>;

  constructor(done: Iterable<string> = []) {
    const known = new Set(GOALS.map((g) => g.id));
    this.done = new Set([...done].filter((id) => known.has(id)));
  }

  /** Check every goal not yet done; returns the ones done now, in goal order. */
  update(world: World): Goal[] {
    const fresh: Goal[] = [];
    for (const g of GOALS) {
      if (this.done.has(g.id)) continue;
      if (g.check(world).done) {
        this.done.add(g.id);
        fresh.push(g);
      }
    }
    return fresh;
  }

  isDone(id: string): boolean {
    return this.done.has(id);
  }

  get doneCount(): number {
    return this.done.size;
  }

  /** The first goal not yet done (null when all are). */
  current(): Goal | null {
    return GOALS.find((g) => !this.done.has(g.id)) ?? null;
  }

  /** The goal after the current one. */
  next(): Goal | null {
    const left = GOALS.filter((g) => !this.done.has(g.id));
    return left[1] ?? null;
  }

  ids(): string[] {
    return [...this.done];
  }
}
