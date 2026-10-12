import { connectedPairs } from "../landscape";
import { getPieceDef, isBridge, type PieceTypeId } from "../track";
import type { World } from "./world";

/** How far along a goal is: done or not, with an optional count toward a target ("2 / 3 towns"). */
export interface GoalProgress {
  done: boolean;
  count?: number;
  target?: number;
  unit?: string;
}

export interface Goal {
  readonly id: string;
  readonly title: string;
  /** A nudge toward how to do it. */
  readonly hint: string;
  /** Reads only the world's state, so it holds after a reload as well as in play. */
  check(world: World): GoalProgress;
}

/** Above this speed (mm/s) a train counts as running. */
const RUNNING = 5;

const running = (w: World) =>
  w.sim.trainIds().filter((id) => {
    const t = w.sim.getTrain(id);
    return t && !t.derailed && t.speed > RUNNING;
  });

/** The most towns joined together by one network of track. */
function largestNetwork(w: World): number {
  // Every pair within a network is listed, so a network's size is one more than any of its towns' partners.
  const partners = new Map<number, number>();
  for (const [a, b] of connectedPairs(w.layout, w.stations)) {
    partners.set(a, (partners.get(a) ?? 0) + 1);
    partners.set(b, (partners.get(b) ?? 0) + 1);
  }
  let most = 0;
  for (const n of partners.values()) most = Math.max(most, n);
  return Math.min(w.landscape.towns.length, most + 1);
}

const towns = (w: World, target: number): GoalProgress => {
  const n = largestNetwork(w);
  return { done: n >= target, count: Math.min(n, target), target, unit: "towns" };
};

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
  },
  {
    id: "place-train",
    title: "Put a train on the track",
    hint: "Drag a train from the Trains tab onto your rails.",
    check: (w) => ({ done: w.sim.trainIds().length > 0 }),
  },
  {
    id: "get-moving",
    title: "Get a train moving",
    hint: "Tap the engine and push its lever forward.",
    check: (w) => ({ done: running(w).length > 0 }),
  },
  {
    id: "station-stop",
    title: "Run a train into a station",
    hint: "Drive a train onto a town's station.",
    check: (w) => {
      const stations = stationPieces(w);
      return { done: w.sim.trainIds().some((id) => w.sim.getTrain(id)?.bogies.some((b) => stations.has(b.pieceId))) };
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
  },
  {
    id: "load-logs",
    title: "Load logs at the forest",
    hint: "Lay track to the forest yard and stop a timber wagon under its crane.",
    check: (w) => ({ done: w.sim.trainIds().some((id) => w.sim.getTrain(id)?.cars.some((c) => w.economy.cargoOf(c.id).kind === "log")) }),
  },
  {
    id: "deliver-planks",
    title: "Deliver planks to a town",
    hint: "Take logs to the sawmill, then carry its planks to a town's station.",
    check: (w) => ({ done: deliveredTotal(w) > 0 }),
  },
  {
    id: "lay-switch",
    title: "Lay a switch",
    hint: "Switches are in the tray's Switch shelf. Tap the lever to change the points.",
    check: (w) => ({ done: hasPiece(w, (type, flipped) => getPieceDef(type, flipped).isSwitch) }),
  },
  {
    id: "build-bridge",
    title: "Build a bridge",
    hint: "Take your track over a river or another line. Bridges are in Ups & downs.",
    check: (w) => ({ done: hasPiece(w, (type) => isBridge(type)) }),
  },
  {
    id: "join-three",
    title: "Connect three towns",
    hint: "Grow your railway until three towns are on it.",
    check: (w) => towns(w, 3),
  },
  {
    id: "deliver-ten",
    title: "Deliver 10 bundles of planks",
    hint: "Keep the timber running: forest, sawmill, town.",
    check: (w) => {
      const n = deliveredTotal(w);
      return { done: n >= 10, count: Math.min(n, 10), target: 10, unit: "bundles" };
    },
  },
  {
    id: "two-trains",
    title: "Run two trains at once",
    hint: "Put a second train on the line and get both moving.",
    check: (w) => {
      const n = running(w).length;
      return { done: n >= 2, count: Math.min(n, 2), target: 2, unit: "trains" };
    },
  },
  {
    id: "join-all",
    title: "Connect every town",
    hint: "One railway that reaches every town on the map.",
    check: (w) => towns(w, w.landscape.towns.length),
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
