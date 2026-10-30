/**
 * Routing: the one owner of which way a routed train goes, and of setting points for it (and of a lever tap on points).
 * Migration step 1 (docs/superpowers/specs/2026-10-30-train-routing.md §13): today's steering, moved here unchanged:
 * every `STEER_TICKS`, or at once for a train sections just granted a move, the next switch ahead of each routed train
 * is set toward its stop (`steerSwitch`), never under a train, on another's granted way, or before a train ahead.
 */
import { getPieceDef, type Layout } from "../track";
import { flipCursor, type Cursor, type Sim, type Train } from "../sim";
import { next, waysFrom, wayToward } from "./graph";

/** How far ahead of a train (pieces) a switch is set for it: the next one it will choose at, within this many. */
const LOOK_AHEAD = 6;
/** How often (sim ticks) the switches ahead of routed trains are set. */
const STEER_TICKS = 8;

/** Pieces and paths a train would rather keep off (see `steer`). */
export type AvoidTest = (pieceId: number, pathIndex: number) => boolean;

/** Is this way out of a switch onto avoided track: its path through the switch, or one just after it? */
function avoided(layout: Layout, pieceId: number, way: { path: number; exit: number }, avoid: AvoidTest): boolean {
  if (avoid(pieceId, way.path)) return true;
  const n = next(layout, pieceId, way.exit);
  return !!n && waysFrom(layout, n.pieceId, n.entry).some((w) => avoid(n.pieceId, w.path));
}

/** `wayToward`, passing over avoided ways while another still reaches `target` (as `steer` chooses; `dist` as for `wayToward`). */
export function chooseWay(
  layout: Layout,
  pieceId: number,
  ways: readonly { option: number; path: number; exit: number }[],
  target: number,
  avoid: AvoidTest | undefined,
  dist?: (at: { pieceId: number; entry: number }) => number,
): number {
  if (avoid) {
    const kept = ways.filter((w) => !avoided(layout, pieceId, w, avoid));
    if (kept.length > 0 && kept.length < ways.length) {
      const best = wayToward(layout, pieceId, kept, target, dist);
      if (best !== -1) return best;
    }
  }
  return wayToward(layout, pieceId, ways, target, dist);
}

/**
 * Set the next switch ahead of a train (the next piece it enters where it has a choice) toward the piece `target`,
 * the shortest way on. Leaves it as it is if no way leads there. Returns true if a switch was changed. A pinned switch
 * is never thrown: it offers no choice (`waysFrom`), so the next one beyond it is set instead.
 *
 * `avoid` (pieces and paths a caller would rather the train kept off, such as a passing loop's track another train is
 * on): at the switch, a way whose path through it, or a path just after it, is avoided is passed over, so long as
 * another way still reaches `target`; if none does, the hint is ignored (a train is never stranded by it). Without it,
 * the choice is the same as ever.
 *
 * `follow` (the way a train has been given, such as the track it holds a claim on): at the switch, if exactly one
 * way's path through it is followed, that way is taken, whatever the distance (it beats `avoid`). Otherwise the choice
 * is as without it. A pinned switch still offers one way (`waysFrom`), so it wins over both.
 *
 * `occupied` (a train on the piece): a switch with a train on it is left as it is, never thrown under it (its cars behind
 * would take the other road).
 *
 * `ahead` (another train on the way to the switch, going the same way, ahead of this one): it comes to the switch first,
 * so the switch is left as it is for it (thrown for the one behind, it would send the first down the other road). Asked
 * of the front's piece with the front's cursor (only one ahead of it on its path counts), and of each piece on the way by
 * the connector the way leaves it.
 */
export function steer(
  layout: Layout,
  train: Train,
  forward: boolean,
  target: number,
  avoid?: AvoidTest,
  follow?: AvoidTest,
  occupied?: (pieceId: number) => boolean,
  ahead?: AheadTest,
): boolean {
  return steerSwitch(layout, train, forward, target, avoid, follow, occupied, ahead) !== -1;
}

/**
 * Is another train on piece `pieceId`, going the way a train would, ahead of it? On the train's front piece, `from` (its
 * front's cursor, `exit` −1): one ahead of the front on its path. On a piece further on: one heading out at `exit`.
 */
export type AheadTest = (pieceId: number, exit: number, from?: Cursor) => boolean;

/** (`steerSwitch`'s pieces on the way, reused: piece, exit, piece, exit, ...) */
const way: number[] = [];

/** `steer`, saying which switch it threw (its piece id), or −1 if none (for showing it thrown: its lever swings). */
export function steerSwitch(
  layout: Layout,
  train: Train,
  forward: boolean,
  target: number,
  avoid?: AvoidTest,
  follow?: AvoidTest,
  occupied?: (pieceId: number) => boolean,
  ahead?: AheadTest,
): number {
  // The cursor at the train's front, pointing the way it goes.
  const b = forward ? train.bogies[0] : train.bogies[train.bogies.length - 1];
  const c: Cursor = { ...b };
  if (!forward) flipCursor(layout, c);
  const piece = layout.getPiece(c.pieceId);
  if (!piece || c.pieceId === target) return -1;
  const def = getPieceDef(piece.type, piece.flipped);
  const path = def.paths[c.pathIndex];
  let exit = c.reversed ? path.from : (path.to ?? -1);
  let at = c.pieceId;
  // (The pieces on the way, and where the way leaves each: asked of `ahead` only if a switch is to be thrown.)
  way.length = 0;
  for (let k = 0; k < LOOK_AHEAD; k++) {
    const n = next(layout, at, exit);
    if (!n || n.pieceId === target) return -1;
    const ways = waysFrom(layout, n.pieceId, n.entry);
    if (ways.length > 1) {
      const followed = follow ? ways.filter((w) => follow(n.pieceId, w.path)) : [];
      const best = followed.length === 1 ? followed[0].option : chooseWay(layout, n.pieceId, ways, target, avoid);
      if (best === -1 || layout.switchState(n.pieceId) % ways.length === best) return -1;
      // (Never under a train: its cars behind would take the other road.)
      if (occupied?.(n.pieceId)) return -1;
      // (Nor before one ahead on the way: it comes to it first.)
      if (ahead) {
        if (ahead(c.pieceId, -1, c)) return -1;
        for (let i = 0; i < way.length; i += 2) if (ahead(way[i], way[i + 1])) return -1;
      }
      layout.setSwitchState(n.pieceId, best);
      return n.pieceId;
    }
    if (ways.length === 0) return -1;
    at = n.pieceId;
    exit = ways[0].exit;
    way.push(at, exit);
  }
  return -1;
}

/** What a lever tap on points came to: thrown, or refused while a car is on or over them (`Sim.pointsHeld`). */
export type LeverResult = { ok: true } | { refused: "under-train" };

/** What the router asks of the game (the economy, today): its routed trains and their stops, and sections' hints. */
export interface RouterHost {
  readonly layout: Layout;
  readonly sim: Pick<Sim, "findCar" | "pieceOccupied" | "pointsHeld" | "toggleSwitch" | "trainAhead">;
  /** The routed engines, in the order they're steered (the economy's routes). */
  readonly routed: { readonly size: number; keys(): Iterable<number> };
  /** The piece of a routed engine's next stop; −1 while it has none on the map. */
  goal(engine: number): number;
  /** A train's net drive toward its front (sign only matters; 0: not driven). */
  drive(train: Train): number;
  /** Sections' hint for a train holding a move: its way (`follow`), aimed at a piece of the slot it goes to. */
  granted(engine: number): { follow: AvoidTest; aim: number } | undefined;
  /** Is a switch on the granted way of another train of this engine's line (sections)? Then it isn't thrown for this one. */
  heldFor(engine: number, pieceId: number): boolean;
  /** Engines sections just granted a move (steered at once, and cleared here). */
  readonly soon: Set<number>;
}

/**
 * The one owner of routing decisions. Step 1: today's steering (`steerSwitch`), on today's cadence, and the lever gate.
 * Costs nothing with no routed train; otherwise a look a few pieces ahead per routed train every `STEER_TICKS`.
 */
export class Router {
  /** Called when a route has set a switch (its piece id: the game redraws its lever, swinging it over if it's in view). */
  onSwitch: ((pieceId: number) => void) | null = null;
  private steerTicks = 0;

  constructor(private readonly host: RouterHost) {}

  /** One sim tick: the switches ahead of routed trains, a few times a second (a train covers a few mm a tick). */
  tick(): void {
    const h = this.host;
    if (h.routed.size === 0) return;
    if (++this.steerTicks % STEER_TICKS === 0) this.steerTrains();
    // (And any just granted a move: the switches on its way, now.)
    else if (h.soon.size > 0) this.steerTrains(h.soon);
    h.soon.clear();
  }

  /**
   * A lever tap on points (not a signal, a deck or a lift): thrown, unless a car is on or over them (the cars still to
   * come would take the other road, and the train would split).
   */
  lever(pieceId: number): LeverResult {
    const sim = this.host.sim;
    if (sim.pointsHeld(pieceId) || !sim.toggleSwitch(pieceId)) return { refused: "under-train" };
    return { ok: true };
  }

  /** Set the switches ahead of each routed train (or just `only`) toward its next stop. */
  private steerTrains(only?: ReadonlySet<number>): void {
    const { layout, sim } = this.host;
    for (const engine of this.host.routed.keys()) {
      if (only && !only.has(engine)) continue;
      const found = sim.findCar(engine);
      if (!found || found.train.derailed) continue;
      const net = this.host.drive(found.train);
      const goal = this.host.goal(engine);
      if (net === 0 || goal === -1) continue;
      // (Holding a move (sections): its way, aimed past it into the slot it goes to, so a stop on the way doesn't end the
      // look ahead short of the switch beyond it.)
      const held = this.host.granted(engine);
      // (Never under a train, nor a switch on another train's granted way: it would send that train onto a road it
      // doesn't hold.)
      const occupied = (pieceId: number) => sim.pieceOccupied(pieceId) || this.host.heldFor(engine, pieceId);
      // (Nor one another train ahead on the way comes to first: thrown for the one behind, it would send that one down
      // the other road (issue #3).)
      const ahead = (pieceId: number, exit: number, from?: Cursor) => sim.trainAhead(found.train, pieceId, exit, from);
      const thrown = steerSwitch(layout, found.train, net > 0, held?.aim ?? goal, undefined, held?.follow, occupied, ahead);
      if (thrown !== -1) this.onSwitch?.(thrown);
    }
  }
}
