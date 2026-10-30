import { connectorRef, getPieceDef, indexOfRef, MAX_CONNECTORS, pieceOfRef, type Layout } from "../track";
import { flipCursor, type Cursor, type Train } from "../sim";

/** How far ahead of a train (pieces) a switch is set for it: the next one it will choose at, within this many. */
const LOOK_AHEAD = 6;
/** The most track pieces a search for the way to a stop goes through. */
export const SEARCH = 4000;

/** Which switches count as pinned (the layout's own, by default; a caller may ask "what if this one weren't?"). */
export type PinnedTest = (pieceId: number) => boolean;

/**
 * The way out of a piece entered through `entry`: each path from that end (`option` counts them, as switch states do;
 * `path` is its index in the piece's paths), and where it leaves (−1: a buffer). A pinned switch (or a deck) has just
 * the one way it's set to, so `steer` passes it by and `distanceTo` follows only that route. `pinned` says which
 * switches are pinned (the layout's by default).
 */
export function waysFrom(
  layout: Layout,
  pieceId: number,
  entry: number,
  pinned: PinnedTest = (id) => layout.isPinned(id),
): { option: number; path: number; exit: number }[] {
  const piece = layout.getPiece(pieceId);
  if (!piece) return [];
  const def = getPieceDef(piece.type, piece.flipped);
  const paths = def.paths;
  // A deck (a turntable's): only the way it lies now goes anywhere (steering doesn't turn it).
  const open = def.gated ? (layout.deckTurning(pieceId) ? paths.length : layout.switchState(pieceId) % paths.length) : -1;
  const out: { option: number; path: number; exit: number }[] = [];
  for (let i = 0; i < paths.length; i++) {
    const p = paths[i];
    if (open !== -1 && i !== open) continue;
    if (p.from !== entry && p.to !== entry) continue;
    out.push({ option: out.length, path: i, exit: p.from === entry ? (p.to ?? -1) : p.from });
  }
  // A pinned switch: only the route it's set to goes anywhere (steering doesn't throw it), picked as `routeFrom` does.
  if (out.length > 1 && pinned(pieceId)) {
    const set = out[layout.switchState(pieceId) % out.length];
    return [{ option: 0, path: set.path, exit: set.exit }];
  }
  return out;
}

/** Where track leaving `pieceId` through connector `exit` goes on: the next piece and the end it's entered by. */
export function next(layout: Layout, pieceId: number, exit: number): { pieceId: number; entry: number } | null {
  if (exit < 0) return null;
  const joined = layout.joinedConnector(connectorRef(pieceId, exit));
  return joined === -1 ? null : { pieceId: pieceOfRef(joined), entry: indexOfRef(joined) };
}

/** What turning back at the end of a line costs a way to a stop, in pieces: a way straight on is better. */
export const TURN_COST = 12;

/**
 * How many pieces from (piece, entry) to `target` along the track; −1 if it can't be reached. A train turns back at
 * the end of a line (a buffer, or track that just stops), so a way may too, at a cost (`TURN_COST`). `pinned` as for
 * `waysFrom`.
 */
export function distanceTo(
  layout: Layout,
  start: { pieceId: number; entry: number },
  target: number,
  pinned: PinnedTest = (id) => layout.isPinned(id),
): number {
  const seen = new Set<number>([start.pieceId * MAX_CONNECTORS + start.entry]);
  // Ways by length: turning back puts a way further down the list.
  const byDepth: { pieceId: number; entry: number }[][] = [[start]];
  let count = 1;
  for (let depth = 0; depth < byDepth.length && count < SEARCH; depth++) {
    for (const at of byDepth[depth] ?? []) {
      if (at.pieceId === target) return depth;
      const push = (n: { pieceId: number; entry: number }, d: number) => {
        if (seen.has(n.pieceId * MAX_CONNECTORS + n.entry)) return;
        seen.add(n.pieceId * MAX_CONNECTORS + n.entry);
        (byDepth[d] ??= []).push(n);
        count++;
      };
      for (const w of waysFrom(layout, at.pieceId, at.entry, pinned)) {
        const n = next(layout, at.pieceId, w.exit);
        if (n) push(n, depth + 1);
        // The end of the line: the train comes back the way it came, through this piece and out where it came in.
        else {
          const back = next(layout, at.pieceId, at.entry);
          if (back) push(back, depth + TURN_COST);
        }
      }
    }
  }
  return -1;
}

/**
 * At a choice (`ways` out of `pieceId`, from `waysFrom`), the option that reaches `target` soonest (as `steer` chooses);
 * −1 if none does. `dist` is the search (`distanceTo` by default; a caller may pass a memo of it).
 */
export function wayToward(
  layout: Layout,
  pieceId: number,
  ways: readonly { option: number; exit: number }[],
  target: number,
  dist: (at: { pieceId: number; entry: number }) => number = (at) => distanceTo(layout, at, target),
): number {
  let best = -1;
  let bestD = Infinity;
  for (const w of ways) {
    const after = next(layout, pieceId, w.exit);
    const d = after ? (after.pieceId === target ? 0 : dist(after)) : -1;
    if (d >= 0 && d < bestD) {
      bestD = d;
      best = w.option;
    }
  }
  return best;
}

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
