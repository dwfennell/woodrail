/**
 * The routing harness's scenarios (docs/superpowers/specs/2026-10-30-train-routing.md §8, §12): layouts laid from the
 * loop fixtures, trains, their routes and what the player does. Test-only (harness.test.ts).
 */
import type { CarKind } from "../sim";
import { appendPiece, connectorRef, type Layout, type PieceTypeId } from "../track";
import { chain, loopOn } from "../economy/loop-fixtures";
import type { HarnessRun, Scenario, ScriptedEvent, TrainSpec } from "./harness";

const S: PieceTypeId = "straight-216";
const C: PieceTypeId = "curve-large";
/** A stop: a depot piece is plain track to the sim (there are no depots in the harness). */
const STOP: PieceTypeId = "depot-forest";
const BUFFER: PieceTypeId = "buffer-turnback";

/** Three-car trains, as the sections QA runs. */
const CARS: CarKind[] = ["engine", "timber", "timber"];

/** `stop ══ ══ … ══ stop` between buffers: the pieces (first and last are the stops). */
function shuttleLine(layout: Layout, straights: number): number[] {
  const ids = chain(layout, [STOP, ...Array<PieceTypeId>(straights).fill(S), STOP]);
  appendPiece(layout, BUFFER, false, connectorRef(ids[0], 0));
  appendPiece(layout, BUFFER, false, connectorRef(ids[ids.length - 1], 1));
  return ids;
}

/** An oval: A ══ ══ (half round) B ══ ══ (half round) back to A. Its pieces, and the stops A and B. */
function oval(layout: Layout) {
  const ids = chain(layout, [STOP, S, S, C, C, C, C, STOP, S, S, C, C, C, C]);
  if (layout.joinedConnector(connectorRef(ids[0], 0)) === -1) throw new Error("the oval doesn't close");
  return { ids, a: ids[0], b: ids[7] };
}

/**
 * An oval with a siding to a mine off one side by a wye, whose straight across is the oval's track (so the siding can
 * be reached going either way round): A ══ ══ (round) B ═ wye ═ (round) A, the wye's stem ══ Mine ⊏. The wye is left
 * set for the oval (the straight across, from either end: its corners 1 and 2 levers, state 0b110), as a player lays it.
 */
function ovalWithSiding(layout: Layout) {
  const [a, s1, , c1, , , , b] = chain(layout, [STOP, S, S, C, C, C, C, STOP]);
  const wye = appendPiece(layout, "wye", false, connectorRef(b, 1), 2);
  chain(layout, ["straight-72", C, C, C, C], connectorRef(wye, 1));
  if (layout.joinedConnector(connectorRef(a, 0)) === -1) throw new Error("the oval doesn't close");
  const [spur, mine] = chain(layout, [S, STOP], connectorRef(wye, 0));
  appendPiece(layout, BUFFER, false, connectorRef(mine, 1));
  layout.setSwitchState(wye, 0b110);
  return { a, b, wye, spur, mine, s1, c1 };
}

/**
 * A trunk ⊐ Y ══ ══ ══ (or `trunk` straights) into points of `type`, entered at its connector `at`; two ways on (`ways`, connectors), each
 * ══ ══ stop ⊏. Its pieces: the trunk's straights (t1 nearest the points), the points and the two stops.
 */
function junction(layout: Layout, type: "switch" | "wye" | "crossover", at: number, ways: [number, number], trunk = 3) {
  const ids = chain(layout, [STOP, ...Array<PieceTypeId>(trunk).fill(S)]);
  const [y, t2, t1] = [ids[0], ids[ids.length - 2], ids[ids.length - 1]];
  appendPiece(layout, BUFFER, false, connectorRef(y, 0));
  const sw = appendPiece(layout, type, false, connectorRef(t1, 1), at);
  const stops = ways.map((c, k) => {
    // (A switch's curved road: a curve back the other way, so the two ways part. The stop has room beyond it for a train.)
    const ids = chain(layout, type === "switch" && k === 1 ? [C, S, STOP, S, S] : [S, STOP, S, S], connectorRef(sw, c), [type === "switch" && k === 1]);
    appendPiece(layout, BUFFER, false, connectorRef(ids[ids.length - 1], 1));
    return ids[ids.length - 3];
  });
  return { y, t1, t2, sw, x: stops[0], p: stops[1], trunk: ids };
}

/** `⊐ A ══ ══ (loop) ══ ══ B ⊏`: a shuttle line with one passing loop in the middle. */
function lineWithLoop(layout: Layout) {
  const [a, w1, w2] = chain(layout, [STOP, S, S]);
  appendPiece(layout, BUFFER, false, connectorRef(a, 0));
  const loop = loopOn(layout, connectorRef(w2, 1), [S, S], [S]);
  const [e1, , b] = chain(layout, [S, S, STOP], connectorRef(loop.s2, 0));
  appendPiece(layout, BUFFER, false, connectorRef(b, 1));
  return { a, b, w1, w2, e1, loop };
}

/** The first tick `when` holds, do `then`. */
export function once(when: (run: HarnessRun) => boolean, then: (run: HarnessRun) => void): ScriptedEvent {
  return { when, do: then };
}

/** Is train `k`'s front within `pieces` pieces (by its bogies) of `pieceId`, not on it yet? */
function nearing(run: HarnessRun, k: number, pieceId: number, ahead: readonly number[]): boolean {
  const t = run.sim.findCar(run.engines[k])?.train;
  if (!t || t.bogies.some((b) => b.pieceId === pieceId)) return false;
  return ahead.includes(t.bogies[0].pieceId);
}

// ── §8: simple automations a young kid can make ─────────────────────────────────────────────────────────────────────

/** The §8 automations deliver for 30 game minutes, no wait over 20 s. */
const KID_SECONDS = 30 * 60;
const KID_STILL = 20;

export const shuttle: Scenario = {
  name: "§8.1 shuttle: two stations, buffers at both ends, one train",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const ids = shuttleLine(layout, 4);
    return { trains: [{ pieceId: ids[2], stops: [ids[0], ids[ids.length - 1]], cars: CARS }] };
  },
};

export const roundAndRound: Scenario = {
  name: "§8.2 round and round: a loop with two stations, one train",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const o = oval(layout);
    return { trains: [{ pieceId: o.ids[1], stops: [o.a, o.b], cars: CARS }] };
  },
};

export const branchDelivery: Scenario = {
  name: "§8.3 branch delivery: a loop with a siding to a mine (route Mine, Town)",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const o = ovalWithSiding(layout);
    return { trains: [{ pieceId: o.s1, stops: [o.mine, o.a], cars: CARS }] };
  },
};

export const twoTrainsOneLoop: Scenario = {
  name: "§8.4 two trains, one passing loop, one line",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const l = lineWithLoop(layout);
    return {
      trains: [
        { pieceId: l.w1, reversed: true, stops: [l.a, l.b], next: 0, line: 1, cars: CARS },
        { pieceId: l.e1, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
      ],
    };
  },
};

export const balloon: Scenario = {
  name: "§8.5 turn round at the end: a terminus with a balloon loop",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const [a, , s2, , , last] = chain(layout, [STOP, S, S, S, S, S]);
    appendPiece(layout, BUFFER, false, connectorRef(a, 0));
    const loop = appendPiece(layout, "balloon-loop", false, connectorRef(last, 1));
    return { trains: [{ pieceId: s2, stops: [loop, a], cars: CARS }] };
  },
};

export const KID: readonly Scenario[] = [shuttle, roundAndRound, branchDelivery, twoTrainsOneLoop, balloon];

// ── §12: the rest ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A lone train run by hand (no route) along a line with a passing loop: what it does is the sim's alone. */
export const loneUnrouted: Scenario = {
  name: "lone train, unrouted",
  seconds: 180,
  build: (layout) => {
    const l = lineWithLoop(layout);
    return { trains: [{ pieceId: l.w1, cars: CARS }] };
  },
};

/** A lone routed train on the branch-delivery layout. */
export const loneRouted: Scenario = { ...branchDelivery, name: "lone train, routed", seconds: 180, maxStill: undefined };

/**
 * Two routed trains on the trunk heading in, the one behind close behind: A for X; B for X too, or for P (the other road).
 * Each runs a line of its own, so nothing keeps them apart on the way back: the run ends once both are through the points
 * and at their stops.
 */
function follower(name: string, type: "switch" | "wye" | "crossover", at: number, ways: [number, number], same: boolean): Scenario {
  return {
    name,
    seconds: 15,
    build: (layout) => {
      const j = junction(layout, type, at, ways);
      return {
        trains: [
          { pieceId: j.t1, stops: [j.x, j.y], cars: CARS, s: 150 },
          { pieceId: j.t2, stops: [same ? j.x : j.p, j.y], cars: CARS, s: 20 },
        ],
      };
    },
  };
}

export const followerSameRoad = follower("a follower needing the same road", "switch", 0, [1, 2], true);
export const followerOtherRoad = follower("a follower needing the other road", "switch", 0, [1, 2], false);
/** A wye entered at its branch (connector 1): on to its stem (0) or across to its other branch (2), picked by the lever. */
export const wyeFromBranch = follower("a wye from its branch, with a follower needing the other road", "wye", 1, [0, 2], false);
/** A crossover entered at its connector 3: on along its line (to 2) or over by the link (to 0), picked by the lever. */
export const crossoverAt3 = follower("a crossover at connector 3, with a follower needing the other road", "crossover", 3, [2, 0], false);

/**
 * The user's #3 (follow-up): two routed trains at one switch needing different roads. The first, for X, is near the
 * points; the second, for P, comes up behind at speed from Y. The points are set for the first; the second must stop a
 * little short of them, wait (never run over them set for X, nor have them thrown under the first), and go to P once the
 * first is by and the points are set for it.
 */
export const twoRoadsOneSwitch: Scenario = {
  name: "#3: two routed trains needing different roads at one switch",
  seconds: 30,
  build: (layout) => {
    const j = junction(layout, "switch", 0, [1, 2], 6);
    return {
      trains: [
        // (A long train for X: the points stay set for it a good while after the second comes up.)
        { pieceId: j.t1, stops: [j.x, j.y], cars: ["engine", "timber", "timber", "timber", "timber"], s: 200 },
        { pieceId: j.trunk[4], stops: [j.p, j.y], cars: CARS, s: 150 },
      ],
    };
  },
};

/** Pinned points on the route: set (and pinned) for X, the train routed for P. It never gets there; the pin holds. */
export const pinnedOnRoute: Scenario = {
  name: "pinned points on the route",
  seconds: 180,
  build: (layout) => {
    const j = junction(layout, "switch", 0, [1, 2]);
    return {
      trains: [{ pieceId: j.t1, stops: [j.p, j.y], cars: CARS }],
      events: [{ at: 0, do: (run) => run.pin(j.sw, true) }],
    };
  },
};

/** A shuttle with a dead-end siding beside the way, its switch left set for the siding by the player. */
export const deadEndSiding: Scenario = {
  name: "a dead-end siding beside the way (left set for it)",
  seconds: 300,
  build: (layout) => {
    const [a, w1, w2] = chain(layout, [STOP, S, S]);
    appendPiece(layout, BUFFER, false, connectorRef(a, 0));
    const sw = appendPiece(layout, "switch", false, connectorRef(w2, 1));
    const [, , b] = chain(layout, [S, S, STOP], connectorRef(sw, 1));
    appendPiece(layout, BUFFER, false, connectorRef(b, 1));
    const siding = chain(layout, [C, S], connectorRef(sw, 2), [true]);
    appendPiece(layout, BUFFER, false, connectorRef(siding[1], 1));
    layout.setSwitchState(sw, 1);
    return { trains: [{ pieceId: w1, stops: [b, a], cars: CARS }], watch: siding };
  },
};

/**
 * A train heading away from its stop comes to points: on their straight road two straights to more points, set for a
 * balloon loop on their curve, their straight road left open (unfinished track); on their curve, a straight to buffers.
 * Round the balloon it comes back engine first and needs no reverse; into the siding it reverses at the buffers. Today's
 * `distanceTo` overcounts the balloon's way (it marks the turn-back at the open road seen first, and drops the shorter
 * way round the balloon to the same place), so today's steering takes the siding; the plan search (step 3) takes the
 * balloon. A finding for the shadow, not a failure: both reach the stop.
 */
export const balloonBehindOpenRoad: Scenario = {
  name: "a balloon behind points with an open road, and a dead-end siding",
  seconds: 180,
  build: (layout) => {
    const [t, s1, s2] = chain(layout, [STOP, S, S]);
    appendPiece(layout, BUFFER, false, connectorRef(t, 0));
    const j = appendPiece(layout, "switch", false, connectorRef(s2, 1), 0);
    const [, a2] = chain(layout, [S, S], connectorRef(j, 1));
    const q = appendPiece(layout, "switch", false, connectorRef(a2, 1), 0);
    appendPiece(layout, "balloon-loop", false, connectorRef(q, 2), 0);
    const [siding] = chain(layout, [S], connectorRef(j, 2));
    appendPiece(layout, BUFFER, false, connectorRef(siding, 1));
    return { trains: [{ pieceId: s1, stops: [t], cars: CARS }], watch: [siding] };
  },
};

/**
 * Two lines over a crossover pair (a ring): two crossovers end to end, double track out to buffers at all four ends.
 * Red runs from the top west end over both links... to the bottom east end; Blue from the bottom west to the top east.
 * Both use the middle (the first crossover's bottom road and link, the second's link), from opposite ends.
 */
export const crossoverRing: Scenario = {
  name: "two lines over a crossover pair (a ring)",
  seconds: 300,
  build: (layout) => {
    const x1 = layout.addPiece("crossover", { x: 0, z: 0, heading: 0 });
    const x2 = appendPiece(layout, "crossover", true, connectorRef(x1, 1), 1);
    const end = (x: number, c: number) => {
      const ids = chain(layout, [S, S, STOP], connectorRef(x, c));
      appendPiece(layout, BUFFER, false, connectorRef(ids[2], 1));
      return ids;
    };
    const wt = end(x1, 0);
    const wb = end(x1, 2);
    const et = end(x2, 0);
    const eb = end(x2, 2);
    return {
      trains: [
        { pieceId: wt[1], reversed: true, stops: [eb[2], wt[2]], cars: CARS },
        { pieceId: et[1], reversed: true, stops: [wb[2], et[2]], cars: CARS },
      ],
    };
  },
};

export const threeTrainsOneLoop: Scenario = {
  name: "three trains on a line with one loop",
  seconds: 600,
  build: (layout) => {
    const l = lineWithLoop(layout);
    return {
      trains: [
        { pieceId: l.w1, reversed: true, stops: [l.a, l.b], next: 0, line: 1, cars: CARS },
        { pieceId: l.e1, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
        { pieceId: l.loop.main[0], stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
      ],
    };
  },
};

/** The branch delivery, with the player doing `what` once the wye is set for the siding and the train is coming to it. */
function duringLock(name: string, what: (run: HarnessRun, o: ReturnType<typeof ovalWithSiding>) => void): Scenario {
  return {
    name,
    seconds: 300,
    build: (layout) => {
      const o = ovalWithSiding(layout);
      return {
        trains: [{ pieceId: o.s1, stops: [o.mine, o.a], cars: CARS }],
        // (Its corner from B, 2, set for the stem: the siding.)
        events: [once((run) => ((run.layout.switchState(o.wye) >> 2) & 1) === 0 && nearing(run, 0, o.wye, [o.b]), (run) => what(run, o))],
      };
    },
  };
}

export const leverDuringLock = duringLock("a lever tap on points set for a train coming to them", (run, o) => {
  if (!run.lever(o.wye, 2)) throw new Error("the tap was refused");
});
export const saveDuringLock = duringLock("a save and load with points set for a train coming to them", (run) => run.saveAndLoad());
export const removedUnderLock = duringLock("the stop taken up while points are set for the way to it", (run, o) => run.takeUp(o.mine));

export const OTHERS: readonly Scenario[] = [
  followerSameRoad,
  twoRoadsOneSwitch,
  followerOtherRoad,
  wyeFromBranch,
  crossoverAt3,
  pinnedOnRoute,
  deadEndSiding,
  balloonBehindOpenRoad,
  crossoverRing,
  threeTrainsOneLoop,
  leverDuringLock,
  saveDuringLock,
  removedUnderLock,
];

// ── Seeded fuzz over the loop fixtures ──────────────────────────────────────────────────────────────────────────────

/** A small seeded random (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random line from the loop fixtures: a shuttle between buffers with 0–2 passing loops (some with a stop on a road),
 * maybe a dead-end siding, 1–3 trains on one line or each its own, some switches set the other way, the odd lever tap.
 */
export function fuzz(seed: number, seconds: number): Scenario {
  return {
    name: `fuzz seed ${seed}`,
    seconds,
    build: (layout) => {
      const r = rng(seed);
      const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
      const [a, w1, w2] = chain(layout, [STOP, S, S]);
      appendPiece(layout, BUFFER, false, connectorRef(a, 0));
      const stops = [a];
      const places = [w1, w2];
      const switches: number[] = [];
      let from = connectorRef(w2, 1);
      const loops = Math.floor(r() * 3);
      for (let i = 0; i < loops; i++) {
        const l = loopOn(layout, from, [S, S], r() < 0.3 ? [STOP] : [S]);
        if (layout.getPiece(l.side[1])!.type === STOP) stops.push(l.side[1]);
        switches.push(l.s1, l.s2);
        places.push(...l.main);
        const m = chain(layout, [S, S], connectorRef(l.s2, 0));
        places.push(...m);
        from = connectorRef(m[1], 1);
      }
      if (r() < 0.5) {
        const sw = appendPiece(layout, "switch", false, from);
        switches.push(sw);
        const siding = chain(layout, [C, S, S], connectorRef(sw, 2), [true]);
        appendPiece(layout, BUFFER, false, connectorRef(siding[2], 1));
        if (r() < 0.5) stops.push(siding[2]);
        from = connectorRef(sw, 1);
      }
      const [e1, e2, b] = chain(layout, [S, S, STOP], from);
      appendPiece(layout, BUFFER, false, connectorRef(b, 1));
      places.push(e1, e2);
      stops.push(b);
      for (const sw of switches) if (r() < 0.3) layout.setSwitchState(sw, 1);
      const n = 1 + Math.floor(r() * Math.min(3, loops + 2));
      const shared = r() < 0.7;
      const route = r() < 0.5 ? [a, b] : stops;
      const used = new Set<number>();
      const trains: TrainSpec[] = [];
      for (let k = 0; k < n; k++) {
        const free = places.map((_, i) => i).filter((i) => !used.has(i));
        if (free.length === 0) break;
        const i = pick(free);
        // (Room either side: no other train on the pieces next to it.)
        used.add(i - 1).add(i).add(i + 1);
        trains.push({ pieceId: places[i], reversed: r() < 0.5, stops: shared ? route : r() < 0.8 ? [pick(stops), pick(stops)] : undefined, line: shared ? 1 : undefined, cars: CARS, next: Math.floor(r() * 2), optional: true });
      }
      for (const t of trains) if (t.stops && t.stops[0] === t.stops[1]) t.stops = [t.stops[0], b === t.stops[0] ? a : b];
      const events: ScriptedEvent[] = [];
      for (const sw of switches) if (r() < 0.3) events.push({ at: Math.floor(r() * seconds), do: (run) => void run.lever(sw) });
      return { trains, events };
    },
  };
}

// ── Negative controls: the checks catch what they're for ────────────────────────────────────────────────────────────

/**
 * A lone hand-run train coming in at a wye's branch, and a bad writer (not the router, not the lever: straight to the
 * layout) throwing the wye while the train is on it, pinned first if `pinned`. The cars still to come take the other
 * road: a split, points moved under a train (and a pinned switch moved).
 */
export function thrownUnder(pinned: boolean): Scenario {
  return {
    name: `control: a wye thrown under a train${pinned ? " (pinned)" : ""}`,
    seconds: 10,
    build: (layout) => {
      const j = junction(layout, "wye", 1, [0, 2]);
      const on = (run: HarnessRun) => run.sim.findCar(run.engines[0])!.train.bogies.slice(2).some((b) => b.pieceId === j.sw);
      return {
        trains: [{ pieceId: j.t1, cars: CARS }],
        events: [
          ...(pinned ? [{ at: 0, do: (run: HarnessRun) => run.pin(j.sw, true) }] : []),
          // (Every corner's lever thrown.)
          once(on, (run) => run.layout.setSwitchState(j.sw, run.layout.switchState(j.sw) ^ 0b111)),
        ],
      };
    },
  };
}
