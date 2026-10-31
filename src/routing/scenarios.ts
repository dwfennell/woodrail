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
export function shuttleLine(layout: Layout, straights: number): number[] {
  const ids = chain(layout, [STOP, ...Array<PieceTypeId>(straights).fill(S), STOP]);
  appendPiece(layout, BUFFER, false, connectorRef(ids[0], 0));
  appendPiece(layout, BUFFER, false, connectorRef(ids[ids.length - 1], 1));
  return ids;
}

/** An oval: A ══ ══ (half round) B ══ ══ (half round) back to A. Its pieces, and the stops A and B. */
export function oval(layout: Layout) {
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
  const [e1, e2, b] = chain(layout, [S, S, STOP], connectorRef(loop.s2, 0));
  appendPiece(layout, BUFFER, false, connectorRef(b, 1));
  return { a, b, w1, w2, e1, e2, loop };
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
 * Each runs a line of its own, working its single track alone (`ownLines`, harness-only: the router's wait at the points
 * is what's tested), so nothing keeps them apart on the way back: the run ends once both are through the points and at
 * their stops. `shared`: as in the game, the two lines work the single track together (sections), and the one behind
 * waits at its slot's end, short of the points, for the junction to be clear (and, for the same road, for X's siding).
 */
function follower(name: string, type: "switch" | "wye" | "crossover", at: number, ways: [number, number], same: boolean, shared = false): Scenario {
  return {
    name,
    seconds: 15,
    ownLines: !shared,
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
export const followerSameRoadShared = follower("a follower of another line needing the same road (single-line working)", "switch", 0, [1, 2], true, true);
export const followerOtherRoadShared = follower("a follower of another line needing the other road (single-line working)", "switch", 0, [1, 2], false, true);

/**
 * The user's #3 (follow-up): two routed trains at one switch needing different roads. The first, for X, is near the
 * points; the second, for P, comes up behind at speed from Y. The points are set for the first; the second must stop a
 * little short of them, wait (never run over them set for X, nor have them thrown under the first), and go to P once the
 * first is by and the points are set for it.
 */
export const twoRoadsOneSwitch: Scenario = {
  name: "#3: two routed trains needing different roads at one switch",
  seconds: 30,
  // (Harness-only: the router's own wait at the points; in the game sections hold the second at its slot's end first.)
  ownLines: true,
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

/**
 * The same three trains, and the player's fix once they're stuck (stalls.ts: too many trains for the line): the held
 * one put away (its card's Put away), at 2 minutes. The other two then pass at the loop and deliver.
 */
export const threeTrainsPutAway: Scenario = {
  ...threeTrainsOneLoop,
  name: "three trains on a line with one loop, the held one put away",
  build: (layout) => ({ ...threeTrainsOneLoop.build(layout), events: [{ at: 120, do: (run) => run.putAway(run.engines.findIndex((e) => run.sections.heldForRoom(e))) }] }),
};

/**
 * Two single-train lines head on along one shuttle line, no passing place: `⊐ A ══ … ══ B ⊏`, Red from A for B, Blue from
 * B for A. Neither line is managed (one train each), so they meet nose to nose in the middle and stand there for good
 * (routing §16 Q3: nothing turns either back), each stuck in the other's way.
 */
export const headOnTwoLines: Scenario = {
  name: "two single-train lines head on along one line",
  seconds: 120,
  build: (layout) => {
    const ids = shuttleLine(layout, 6);
    return {
      trains: [
        { pieceId: ids[1], reversed: false, stops: [ids[ids.length - 1], ids[0]], cars: CARS },
        { pieceId: ids[ids.length - 2], reversed: true, stops: [ids[0], ids[ids.length - 1]], cars: CARS },
      ],
    };
  },
};

/**
 * A ring of waits on one line: its two trains (a loop, so room for both) put down face to face in one line end, each on
 * the other's way (sections' `facing`). Neither turns back: each waits on the other, stuck in its way.
 */
export const facingInLineEnd: Scenario = {
  name: "two trains of a line put down face to face in a line end",
  seconds: 120,
  build: (layout) => {
    const l = lineWithLoop(layout);
    return {
      trains: [
        { pieceId: l.e1, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
        { pieceId: l.e2, reversed: true, stops: [l.a, l.b], next: 0, line: 1, cars: CARS },
      ],
    };
  },
};

// ── Single-line working across lines (sections shared by the lines on one network) ─────────────────────────────────

/** `⊐ A ══ ══ (loop) ══ ══ (loop) ══ ══ B ⊏`: a shuttle line with two passing loops. */
function lineWithTwoLoops(layout: Layout) {
  const [a, w1, w2] = chain(layout, [STOP, S, S]);
  appendPiece(layout, BUFFER, false, connectorRef(a, 0));
  const l1 = loopOn(layout, connectorRef(w2, 1), [S, S], [S]);
  const [m1, m2] = chain(layout, [S, S], connectorRef(l1.s2, 0));
  const l2 = loopOn(layout, connectorRef(m2, 1), [S, S], [S]);
  const [e1, e2, b] = chain(layout, [S, S, STOP], connectorRef(l2.s2, 0));
  appendPiece(layout, BUFFER, false, connectorRef(b, 1));
  return { a, b, w1, w2, m1, m2, e1, e2, l1, l2 };
}

/**
 * Two single-train lines, Red and Blue, both A to B on one shuttle line with a passing loop in the middle, put down at
 * either end heading in: they meet at the loop, each on its own road, and pass (single-line working: one train in each
 * stretch of single track, trains meet at loops).
 */
export const twoLinesOneLoop: Scenario = {
  name: "two single-train lines on one line with a passing loop",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const l = lineWithLoop(layout);
    return {
      trains: [
        { pieceId: l.w1, reversed: true, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
        { pieceId: l.e2, reversed: true, stops: [l.a, l.b], next: 0, line: 2, cars: CARS },
      ],
    };
  },
};

/** The same, the lines' trains put down nose to nose on the single track with no loop: they stand, stuck (no fix but a loop). */
export const twoLinesNoLoop: Scenario = {
  name: "two single-train lines head on along one line, no loop",
  seconds: 120,
  build: (layout) => {
    const ids = shuttleLine(layout, 6);
    return {
      trains: [
        { pieceId: ids[2], stops: [ids[ids.length - 1], ids[0]], line: 1, cars: CARS },
        { pieceId: ids[ids.length - 3], reversed: true, stops: [ids[0], ids[ids.length - 1]], line: 2, cars: CARS },
      ],
    };
  },
};

/** Three single-train lines over one shuttle line with two passing loops (a loop for each pair of trains). */
export const threeLinesTwoLoops: Scenario = {
  name: "three single-train lines on one line with two passing loops",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const l = lineWithTwoLoops(layout);
    return {
      trains: [
        { pieceId: l.w1, reversed: true, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
        { pieceId: l.m1, stops: [l.a, l.b], next: 1, line: 2, cars: CARS },
        { pieceId: l.e2, reversed: true, stops: [l.a, l.b], next: 0, line: 3, cars: CARS },
      ],
    };
  },
};

/** A line of two trains and a single-train line, all three A to B on the line with two loops. */
export const twoLinesThreeTrains: Scenario = {
  name: "a two-train line and a single-train line on one line with two passing loops",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const l = lineWithTwoLoops(layout);
    return {
      trains: [
        { pieceId: l.w1, reversed: true, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
        { pieceId: l.m1, stops: [l.a, l.b], next: 1, line: 2, cars: CARS },
        { pieceId: l.e2, reversed: true, stops: [l.a, l.b], next: 0, line: 1, cars: CARS },
      ],
    };
  },
};

/**
 * A single-train line and a hand-run train (no route, its lever on) on the line with a passing loop: the hand-run one
 * shuttles between the buffers as the points lie; the line's train meets it at the loop, on the other road.
 */
export const linelessWithLine: Scenario = {
  name: "a hand-run train and a single-train line on one line with a passing loop",
  seconds: KID_SECONDS,
  maxStill: KID_STILL,
  build: (layout) => {
    const l = lineWithLoop(layout);
    return {
      trains: [
        { pieceId: l.w1, reversed: true, stops: [l.a, l.b], next: 1, line: 1, cars: CARS },
        { pieceId: l.e2, reversed: true, cars: CARS },
      ],
    };
  },
};

export const SHARED: readonly Scenario[] = [twoLinesOneLoop, twoLinesNoLoop, threeLinesTwoLoops, twoLinesThreeTrains, linelessWithLine];

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

// ── Step 6: forward costs (#7) ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * A way round, or a reverse: `⊐ T ══ M ══ ══ points`; on their straight road `approach` straights to a way round
 * (`round`: a balloon loop; or a wye, its corners joined by a loop of track); on their curved road a short dead-end spur
 * (a curve and a straight to buffers). Route T, M: from M the train heads on, away from T, so it must turn, round or at
 * the spur's buffers. By piece counts (to step 5) the spur costs less; in mm (step 6) the way round.
 */
function roundOrSpur(layout: Layout, round: "balloon" | "wye", approach: number) {
  const [t, s1, m, s2] = chain(layout, [STOP, S, STOP, S]);
  appendPiece(layout, BUFFER, false, connectorRef(t, 0));
  const sw = appendPiece(layout, "switch", false, connectorRef(s2, 1));
  const way = chain(layout, Array<PieceTypeId>(approach).fill(S), connectorRef(sw, 1));
  const end = connectorRef(way[way.length - 1], 1);
  let wye = -1;
  if (round === "balloon") appendPiece(layout, "balloon-loop", false, end);
  else {
    wye = appendPiece(layout, "wye", false, end, 0);
    chain(layout, [C, C, C, C, S, "straight-144", C, C, C, C], connectorRef(wye, 1));
    if (layout.joinedConnector(connectorRef(wye, 2)) === -1) throw new Error("the wye's loop doesn't close");
  }
  const spur = chain(layout, [C, S], connectorRef(sw, 2), [true]);
  appendPiece(layout, BUFFER, false, connectorRef(spur[1], 1));
  return { t, s1, m, sw, wye, spur };
}

export const balloonOverSpur: Scenario = {
  name: "step 6: a balloon loop or a dead-end spur to turn",
  seconds: 600,
  build: (layout) => {
    const l = roundOrSpur(layout, "balloon", 8);
    return { trains: [{ pieceId: l.s1, stops: [l.t, l.m], next: 1, cars: CARS }], watch: l.spur };
  },
};

export const wyeOverSpur: Scenario = {
  name: "step 6: a wye turn (its corners joined by a loop) or a dead-end spur",
  seconds: 600,
  build: (layout) => {
    const l = roundOrSpur(layout, "wye", 3);
    return { trains: [{ pieceId: l.s1, stops: [l.t, l.m], next: 1, cars: CARS }], watch: l.spur };
  },
};

/**
 * Round an oval, or a reverse: `B A ══ ══ points (round) ─────── (round)` closed into an oval, its far side short
 * straights (many pieces, the same length), the points' curved road a dead-end spur. Route A, B: B is just behind A, so
 * from A it goes round the oval, or into the spur and back (fewer pieces, 6 m less track by far).
 */
export const loopOverSpur: Scenario = {
  name: "step 6: round an oval or back from a dead-end spur",
  seconds: 600,
  build: (layout) => {
    const far = Array<PieceTypeId>(14).fill("straight-72");
    const [b, a, , , sw] = chain(layout, [STOP, STOP, S, S, "switch", C, C, C, C, ...far, C, C, C, C]);
    if (layout.joinedConnector(connectorRef(b, 0)) === -1) throw new Error("the oval doesn't close");
    const spur = chain(layout, [C, S], connectorRef(sw, 2), [true]);
    appendPiece(layout, BUFFER, false, connectorRef(spur[1], 1));
    return { trains: [{ pieceId: a, stops: [a, b], cars: CARS }], watch: spur };
  },
};

/** The §8.1 shuttle with the engine coupled at the back by the player: it pushes its wagons one way, pulls them back. */
export const pushingShuttle: Scenario = {
  name: "step 6: a shuttle the player set up engine-last",
  seconds: 600,
  build: (layout) => {
    const ids = shuttleLine(layout, 4);
    return { trains: [{ pieceId: ids[2], stops: [ids[ids.length - 1], ids[0]], cars: ["timber", "timber", "engine"] }] };
  },
};

export const FORWARD: readonly Scenario[] = [balloonOverSpur, wyeOverSpur, loopOverSpur, pushingShuttle];

export const OTHERS: readonly Scenario[] = [
  followerSameRoad,
  twoRoadsOneSwitch,
  followerOtherRoad,
  followerSameRoadShared,
  followerOtherRoadShared,
  wyeFromBranch,
  crossoverAt3,
  pinnedOnRoute,
  deadEndSiding,
  balloonBehindOpenRoad,
  crossoverRing,
  threeTrainsOneLoop,
  threeTrainsPutAway,
  headOnTwoLines,
  facingInLineEnd,
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

// ── Step 7: hand-run trains respect locks ───────────────────────────────────────────────────────────────────────────

/**
 * A junction (`junction`, switch, 6 straights of trunk), its points left set for X by the player. A routed train for P
 * (5 cars, so the points stay set for it a while) comes up the trunk and has them set for P; a hand-run train comes
 * down X's road toward them (trailing, going the way they lie) just then. It must stand short of them while they're set
 * for P (never run over them), and go once the routed train is by and they're back as the player left them. Each runs
 * alone (no line in common), so only the router keeps them apart. The test drives it in steps (`HarnessRun.run`).
 */
export function handAtLock(): { scenario: Scenario; j: () => ReturnType<typeof junction> } {
  let j: ReturnType<typeof junction> | null = null;
  return {
    j: () => j!,
    scenario: {
      name: "step 7: a hand-run train meets points set for a routed train",
      seconds: 30,
      build: (layout) => {
        j = junction(layout, "switch", 0, [1, 2], 6);
        return {
          trains: [
            { pieceId: j.trunk[4], stops: [j.p, j.y], cars: ["engine", "timber", "timber", "timber", "timber"], s: 150 },
            // (On X's stop, facing back toward the points: hand-run, no stops.)
            { pieceId: j.x, reversed: true, s: 120, cars: CARS },
          ],
        };
      },
    },
  };
}

/**
 * A shuttle line (buffers at both ends), one hand-run train heading for the far buffer. The test puts a second train
 * down close behind it once it waits there to turn, so there's no room to turn it round.
 */
export function noRoomToTurn(): { scenario: Scenario; ids: () => number[] } {
  let ids: number[] = [];
  return {
    ids: () => ids,
    scenario: {
      name: "step 7: no room to turn round at the end of the line",
      seconds: 30,
      build: (layout) => {
        ids = shuttleLine(layout, 4);
        return { trains: [{ pieceId: ids[4], cars: CARS }] };
      },
    },
  };
}
