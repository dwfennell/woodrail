/**
 * The boxed-in convoy (routing spec §16, the user's decision (4), 2026-11-02, kept 2026-11-06): a stall a route makes on
 * a single line where hand-run trains would run as a convoy into a dead end. A hand-run train stands between the end of
 * the line and the routed train, nothing on its far side but plain track to the end (no facing points to go another
 * way, no other train), and the routed train's next stop is on that side, behind it. All hand-run, the two give way and
 * run end to end, the one behind following the other into the dead end (§16 Q9); with a route, single-line working lets
 * only one train into the dead end, so they stand, said stuck "in the way" with the card's fix a passing loop. Kept so:
 * "a route never makes it worse" (harness-fuzz.test.ts) excuses a stall of exactly this shape, and only it.
 *
 * Since 2026-11-07 nothing turns a train round short of the end of its line (the user, firm), so the shape is any such
 * true deadlock: the routed train's way runs into the box (its next stop there, or the line's end there to reverse at),
 * whether or not a passing loop is elsewhere on the line (behind the routed train, it can't be reached going forwards);
 * and trains queued behind the two, waiting on one of them, stand with them. (From 2026-11-05 to 2026-11-07 a train
 * turned round to give way here: fuzz seeds 68, 74 and 125.)
 */
import { getPieceDef, type Layout } from "../track";
import { flipCursor, type Cursor, type Train } from "../sim";
import { next, walkOn } from "./graph";
import { plan } from "./plan";
import type { HarnessRun } from "./harness";

/** How far (pieces) a box is walked: further than any line the fuzz lays. */
const WALK = 64;

/**
 * The dead end a train is boxed into: its pieces and the plain track from one of its ends on to the end of the line (no
 * facing points, no other train); null if neither end runs so. (Both ends: a train alone on a plain line; then the box
 * is the side away from `toward`'s pieces, if given.)
 */
export function boxOf(layout: Layout, trains: readonly Train[], t: Train, toward?: ReadonlySet<number>): Set<number> | null {
  if (t.bogies.length === 0) return null;
  const others = new Set<number>();
  for (const o of trains) if (o.id !== t.id && !o.derailed) for (const b of o.bogies) others.add(b.pieceId);
  const own = new Set(t.bogies.map((b) => b.pieceId));
  const front: Cursor = { ...t.bogies[0] };
  const back: Cursor = { ...t.bogies[t.bogies.length - 1] };
  flipCursor(layout, back);
  for (const c of [front, back]) {
    const walked = plainToEnd(layout, c, others);
    if (!walked) continue;
    if (toward && [...walked].some((p) => toward.has(p))) continue;
    return new Set([...own, ...walked]);
  }
  return null;
}

/** From cursor `c` on out its way: the pieces to the end of the line, or null at facing points or another train. */
function plainToEnd(layout: Layout, c: Cursor, others: ReadonlySet<number>): Set<number> | null {
  const piece = layout.getPiece(c.pieceId);
  if (!piece) return null;
  const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
  const out = new Set<number>();
  let blocked = false;
  const end = walkOn(
    layout,
    c.pieceId,
    c.reversed ? path.from : (path.to ?? -1),
    (id, _entry, ways) => {
      if (others.has(id) || ways.length > 1) {
        blocked = true;
        return false;
      }
      out.add(id);
    },
    WALK,
  );
  return blocked || end === "far" ? null : out;
}


/**
 * Are the trains said stuck now a boxed-in convoy, and only that? Each stuck routed train is "in the way" of a hand-run
 * one with the card's fix a passing loop (`loop`), that hand-run train boxed into a dead end (`boxOf`) on the side away
 * from the routed one, with the routed train's next stop in that box. Each other stuck train is hand-run, "in the way"
 * of a stuck routed one, and boxed in too. Anything else (two routed trains, too many for a line, a parked train, signals,
 * a hand-run train with a road out, a stop not behind it) isn't.
 */
/**
 * Does a train's way on to piece `goal` (its front's way, planned) run into `box`, `by`'s: its goal there, a piece
 * beyond `by`, or its reverse at the line's end there? Not just over `by`'s own pieces and on: standing on points, `by`
 * may be on its way to another road.
 */
function wayInto(layout: Layout, t: Train, goal: number, box: ReadonlySet<number>, by: Train): boolean {
  if (goal < 0 || t.bogies.length === 0) return false;
  if (box.has(goal)) return true;
  const own = new Set(by.bogies.map((b) => b.pieceId));
  const beyond = (id: number) => box.has(id) && !own.has(id);
  const c = t.bogies[0];
  const piece = layout.getPiece(c.pieceId);
  if (!piece) return false;
  const path = getPieceDef(piece.type, piece.flipped).paths[c.pathIndex];
  const exit = c.reversed ? path.from : (path.to ?? -1);
  const n = exit < 0 ? null : next(layout, c.pieceId, exit);
  if (!n) return false;
  if (beyond(n.pieceId)) return true;
  const p = plan(layout, { pieceId: n.pieceId, entry: n.entry, lead: true }, goal);
  return !!p && p.steps.some((s) => beyond(s.pieceId) || (s.reverse && box.has(s.pieceId)));
}

export function boxedConvoy(run: HarnessRun): boolean {
  const { sim, layout } = run;
  const trains = sim.trainIds().map((id) => sim.getTrain(id)!);
  const engineOf = (t: Train) => t.cars.find((c) => c.kind === "engine")?.id ?? -1;
  const stuck = trains.filter((t) => run.stalls.stuckOf(engineOf(t)) !== null);
  const routed = stuck.filter((t) => run.routed(engineOf(t)));
  if (routed.length === 0) return false;
  /** The convoys' trains (engines): each stuck routed train and the hand-run one boxed in ahead of it. */
  const convoy = new Set<number>();
  for (const r of routed) {
    const why = run.stalls.stuckOf(engineOf(r))!;
    if (why.kind !== "in-way") return false;
    const h = sim.findCar(why.by)?.train;
    if (!h || run.routed(engineOf(h)) || !stuck.includes(h)) return false;
    // (Boxed in on the side away from the routed train, which waits on it: its way runs into the box, to its stop there
    // or to the line's end to reverse at.)
    const box = boxOf(layout, trains, h, new Set(r.bogies.map((b) => b.pieceId)));
    if (!box || r.bogies.some((b) => box.has(b.pieceId)) || !wayInto(layout, r, run.target(engineOf(r)), box, h)) return false;
    convoy.add(engineOf(r));
    convoy.add(engineOf(h));
  }
  for (const h of stuck) {
    if (routed.includes(h)) continue;
    const why = run.stalls.stuckOf(engineOf(h))!;
    if (why.kind !== "in-way") return false;
    const by = sim.findCar(why.by)!.train;
    // (Boxed in by a routed train of the convoy, or queued behind one of the convoy's trains, waiting on it.)
    if (convoy.has(engineOf(h)) && run.routed(engineOf(by)) && boxOf(layout, trains, h, new Set(by.bogies.map((b) => b.pieceId)))) continue;
    if (!run.routed(engineOf(h)) && convoy.has(engineOf(by))) continue;
    return false;
  }
  return true;
}
