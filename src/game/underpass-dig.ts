import {
  connectorRef,
  createSample,
  crossesLow,
  getPieceDef,
  ignores,
  isBridge,
  isPlainStraight,
  lowCrossings,
  pathLength,
  pieceOfRef,
  RISER_HEIGHT,
  samplePath,
  straightLength,
  straightsFor,
  supportInTrench,
  UNDERPASS_LENGTH,
  type Ignore,
  type PieceTypeId,
  type Pose,
} from "../track";
import { trackBlock, type TrackRules } from "./track-rules";

/** A piece to put down: where, how high, which way round. */
export interface DigPiece {
  readonly type: PieceTypeId;
  readonly pose: Pose;
  readonly y: number;
  readonly flipped: boolean;
}

/** Why a bridge one level up over track can't have an underpass dug under it. */
export type DigRefusal = "curve" | "points" | "lines" | "short" | "angle" | "centre" | "pier" | "signal" | "ground" | "busy";

/** Said when a train stands on the straights an underpass would take up (the caller knows the trains, not the plan). */
export const DIG_TRAIN = "A train's on the track under the bridge: move it first";

/** Said of a drawn line on the ground meeting a bridge one level up where no underpass fits under it. */
export const UNDER_BRIDGE = "Too low under the bridge: draw straight under its middle and an underpass goes in";

export const DIG_MESSAGES: Record<DigRefusal, string> = {
  curve: "An underpass needs straight track under the bridge: this is a curve",
  points: "Points can't go in an underpass: put the bridge over plain straight track",
  lines: "Only one line can go under a bridge one level up",
  short: "Not enough straight track here for an underpass: it needs two long straights' worth",
  angle: "Cross the line more squarely for an underpass to fit under",
  centre: "Put the bridge over the middle of the underpass",
  pier: "The bridge's end would stand in the underpass: cross the line nearer the bridge's middle",
  signal: "A signal is on the track under the bridge: move it off before an underpass can go in",
  ground: "An underpass needs flat open ground under the bridge",
  busy: "Something's in the way of an underpass under this bridge",
};

/**
 * What putting a bridge down here does to the track under it. `dig`: the straights under it (`covers`) are taken up and
 * `pieces` go down in their place, an underpass among them, so the bridge (one level up) clears the trains. `refused`:
 * the track under it can't take an underpass, and why. Null when it doesn't apply: not a bridge, nothing under it, or
 * something under it that isn't one level down.
 */
export type DigPlan = { readonly kind: "dig"; readonly covers: readonly number[]; readonly pieces: readonly DigPiece[] } | { readonly kind: "refused"; readonly why: DigRefusal };

/** A straight in the run under the bridge: its id and where it lies along the run's line (mm, `a` < `b`). */
interface RunPiece {
  id: number;
  a: number;
  b: number;
  /** Laid along the line's way (its first end at `a`), or against it. */
  forward: boolean;
}

const LATTICE = 18;
const sample = createSample();

/**
 * Plan an underpass for a bridge at `pose`/`y` over track one level down (see `DigPlan`). Bounded work: a walk along
 * the straights under it and the track rules for the few pieces it would put down. Called while a bridge is held over
 * track (the caller caches it per spot).
 */
export function planUnderpass(rules: TrackRules, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore): DigPlan | null {
  if (!isBridge(type)) return null;
  const layout = rules.layout;
  const lows = lowCrossings(layout, type, flipped, pose, y, ignore);
  if (lows.length === 0) return null;
  const below = y - RISER_HEIGHT;
  for (const id of lows) if (Math.abs(layout.getPiece(id)!.y - below) > 1) return null;
  for (const id of lows) {
    const t = layout.getPiece(id)!.type;
    if (t === "underpass") return { kind: "refused", why: "centre" };
    if (!isPlainStraight(t)) {
      const def = getPieceDef(t, false);
      const why: DigRefusal = def.isSwitch || def.paths.length > 1 ? "points" : def.paths[0]?.geom.kind === "line" ? "busy" : "curve";
      return { kind: "refused", why };
    }
  }

  // The run of plain straights the first one under the bridge is in, along one line.
  const first = layout.getPiece(lows[0])!;
  const h = first.pose.heading;
  const ux = Math.cos(h);
  const uz = Math.sin(h);
  const along = (x: number, z: number) => (x - first.pose.x) * ux + (z - first.pose.z) * uz;
  const across = (x: number, z: number) => -(x - first.pose.x) * uz + (z - first.pose.z) * ux;
  const run = new Map<number, RunPiece>();
  const queue = [lows[0]];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (run.has(id)) continue;
    const p = layout.getPiece(id)!;
    const len = straightLength(p.type, p.flipped);
    const dh = Math.cos(p.pose.heading - h);
    if (!isPlainStraight(p.type) || Math.abs(p.y - below) > 1 || Math.abs(Math.abs(dh) - 1) > 1e-4 || Math.abs(across(p.pose.x, p.pose.z)) > 1) continue;
    const s = along(p.pose.x, p.pose.z);
    run.set(id, dh > 0 ? { id, a: s, b: s + len, forward: true } : { id, a: s - len, b: s, forward: false });
    for (let k = 0; k < 2; k++) {
      const j = layout.joinedConnector(connectorRef(id, k));
      if (j !== -1 && !ignores(ignore, pieceOfRef(j)) && !layout.isLifted(pieceOfRef(j))) queue.push(pieceOfRef(j));
    }
  }
  if (lows.some((id) => !run.has(id))) return { kind: "refused", why: "lines" };

  // Where the bridge's track crosses the line (along it), from its path in steps of 4 mm.
  const g = getPieceDef(type, flipped).paths[0].geom;
  const len = pathLength(g);
  const c = Math.cos(pose.heading);
  const sn = Math.sin(pose.heading);
  let t: number | null = null;
  let last = 0;
  for (let i = 0, n = Math.ceil(len / 4); i <= n; i++) {
    samplePath(g, (len * i) / n, sample);
    const x = pose.x + sample.x * c - sample.z * sn;
    const z = pose.z + sample.x * sn + sample.z * c;
    const d = across(x, z);
    if (i > 0 && Math.sign(d) !== Math.sign(last) && t === null) {
      // (Between this sample and the last: near enough, 4 mm apart.)
      t = along(x, z);
    }
    last = d;
  }
  if (t === null) return { kind: "refused", why: "angle" };

  // The underpass's start: its middle under the crossing, on the 18 mm lattice, or a step or two either side if the
  // straights left over can't be made from the box's lengths.
  const pieces = [...run.values()].sort((p, q) => p.a - q.a);
  const start = pieces[0].a;
  const end = pieces[pieces.length - 1].b;
  const centred = start + Math.round((t - UNDERPASS_LENGTH / 2 - start) / LATTICE) * LATTICE;
  let fitted = false;
  let pier = false;
  for (const k of [0, -1, 1, -2, 2]) {
    const s0 = centred + k * LATTICE;
    const s1 = s0 + UNDERPASS_LENGTH;
    if (s0 < start - 0.5 || s1 > end + 0.5) continue;
    const covered = pieces.filter((p) => p.b > s0 + 0.5 && p.a < s1 - 0.5);
    // A signal on any joint of the straights taken up would go with them: the player moves it first.
    if (covered.some((p) => signalOn(layout, p.id))) return { kind: "refused", why: "signal" };
    const forward = covered[0].forward;
    if (covered.some((p) => p.forward !== forward)) continue;
    const a = covered[0].a;
    const b = covered[covered.length - 1].b;
    const before = s0 - a < 0.5 ? [] : straightsFor(s0 - a);
    const after = b - s1 < 0.5 ? [] : straightsFor(b - s1);
    if (!before || !after) continue;
    fitted = true;
    // Laid along the line from `a`, each piece facing as the ones it replaces did.
    const out: DigPiece[] = [];
    let s = a;
    for (const type of [...before, "underpass" as PieceTypeId, ...after]) {
      const l = type === "underpass" ? UNDERPASS_LENGTH : straightLength(type, false);
      const at = forward ? s : s + l;
      out.push({ type, pose: { x: first.pose.x + at * ux, z: first.pose.z + at * uz, heading: forward ? h : h + Math.PI }, y: below, flipped: false });
      s += l;
    }
    const verdict = check(rules, { type, flipped, pose, y }, covered.map((p) => p.id), out, ignore);
    if (verdict === null) return { kind: "dig", covers: covered.map((p) => p.id), pieces: out };
    if (verdict !== "angle" && verdict !== "pier") return { kind: "refused", why: verdict };
    pier ||= verdict === "pier";
  }
  return { kind: "refused", why: !fitted ? "short" : pier ? "pier" : "angle" };
}

/** Is there a signal on either side of either of this straight's joints? */
function signalOn(layout: TrackRules["layout"], id: number): boolean {
  if (layout.signalCount === 0) return false;
  for (let k = 0; k < 2; k++) {
    const ref = connectorRef(id, k);
    if (layout.signalAt(ref)) return true;
    const j = layout.joinedConnector(ref);
    if (j !== -1 && layout.signalAt(j)) return true;
  }
  return false;
}

/** Would the bridge and the pieces dug under it all go down (the covered straights taken up)? Why not, or null. */
function check(rules: TrackRules, bridge: DigPiece, covers: readonly number[], pieces: readonly DigPiece[], ignore: Ignore): DigRefusal | null {
  const without = new Set<number>(covers);
  if (typeof ignore === "number") without.add(ignore);
  else for (const id of ignore) without.add(id);
  // The bridge clears the new pieces (a crossing too slanted reaches the underpass's slopes).
  for (const p of pieces) if (crossesLow(bridge, p)) return "angle";
  // Nor stands in its trench (a curved bridge crossing near its end).
  for (const p of pieces) if (supportInTrench(bridge, p)) return "pier";
  // The bridge itself, but for the track under it.
  if (trackBlock(rules, bridge.type, bridge.flipped, bridge.pose, bridge.y, without) !== null) return "busy";
  for (const p of pieces) {
    const why = trackBlock(rules, p.type, p.flipped, p.pose, p.y, without);
    if (why !== null) return p.type === "underpass" ? "ground" : "busy";
  }
  return null;
}

/**
 * A plain straight put down on the ground under a bridge already standing one level up: in its place, straights from
 * its end up to an underpass whose middle is under the bridge (see `planUnderpass`, the other way about). Laid from
 * whichever of its ends joins track already there (else from its first end; only that with `forward`), along its line. Null when it doesn't
 * apply (not a plain straight, or nothing a level up over it but a bridge).
 */
export function planUnderpassAhead(rules: TrackRules, type: PieceTypeId, flipped: boolean, pose: Pose, y: number, ignore: Ignore, forward = false): DigPlan | null {
  if (!isPlainStraight(type)) return null;
  const layout = rules.layout;
  // (Laying on from a line's end, the bridge is looked for two long straights' length ahead: from a piece or two back.)
  if (forward) type = "straight-288";
  const lows = lowCrossings(layout, type, flipped, pose, y, ignore);
  if (forward) {
    const on = { x: pose.x + 288 * Math.cos(pose.heading), z: pose.z + 288 * Math.sin(pose.heading), heading: pose.heading };
    for (const id of lowCrossings(layout, type, flipped, on, y, ignore)) if (!lows.includes(id)) lows.push(id);
  }
  if (lows.length === 0) return null;
  const bridges = lows.map((id) => layout.getPiece(id)!).filter((q) => isBridge(q.type) && Math.abs(q.y - y - RISER_HEIGHT) < 1);
  if (bridges.length !== 1 || lows.length !== 1) return null;
  const bridge = bridges[0];
  const len = straightLength(type, flipped);
  const h = pose.heading;
  const ux = Math.cos(h);
  const uz = Math.sin(h);
  // Where the bridge's track crosses this straight's line, along it from its first end.
  const t = crossingAlong(bridge, pose.x, pose.z, h);
  if (t === null) return { kind: "refused", why: "angle" };
  // The two ways to lay it: on from its first end, or back from its far end. The end joined to track first.
  const ends = [
    { x: pose.x, z: pose.z, way: 1 },
    { x: pose.x + len * ux, z: pose.z + len * uz, way: -1 },
  ];
  const joined = (e: { x: number; z: number }) => hasEndAt(layout, e.x, e.z, y, ignore);
  // (A drawn line lays on from where it's got to: its first end only, `forward`.)
  if (forward) ends.length = 1;
  else ends.sort((a, b) => Number(joined(b)) - Number(joined(a)));
  let why: DigRefusal = "short";
  for (const e of ends) {
    // Distance from this end to the crossing, the way the pieces go.
    const d = e.way === 1 ? t : len - t;
    for (const k of [0, -1, 1]) {
      const s0 = Math.round((d - UNDERPASS_LENGTH / 2) / LATTICE) * LATTICE + k * LATTICE;
      if (s0 < -0.5) continue;
      const fill = s0 < 0.5 ? [] : straightsFor(s0);
      if (!fill) continue;
      const heading = e.way === 1 ? h : h + Math.PI;
      const out: DigPiece[] = [];
      let s = 0;
      for (const p of [...fill, "underpass" as PieceTypeId]) {
        out.push({ type: p, pose: { x: e.x + e.way * s * ux, z: e.z + e.way * s * uz, heading }, y, flipped: false });
        s += p === "underpass" ? UNDERPASS_LENGTH : straightLength(p, false);
      }
      const verdict = checkAhead(rules, bridge, out, ignore);
      if (verdict === null) return { kind: "dig", covers: [], pieces: out };
      why = verdict;
    }
  }
  return { kind: "refused", why };
}

/** Along a line from (x, z) going `heading`, where a bridge's track crosses it (from 4 mm steps), or null. */
function crossingAlong(bridge: DigPiece, x0: number, z0: number, heading: number): number | null {
  const ux = Math.cos(heading);
  const uz = Math.sin(heading);
  const g = getPieceDef(bridge.type, bridge.flipped).paths[0].geom;
  const len = pathLength(g);
  const c = Math.cos(bridge.pose.heading);
  const sn = Math.sin(bridge.pose.heading);
  let last = 0;
  for (let i = 0, n = Math.ceil(len / 4); i <= n; i++) {
    samplePath(g, (len * i) / n, sample);
    const x = bridge.pose.x + sample.x * c - sample.z * sn - x0;
    const z = bridge.pose.z + sample.x * sn + sample.z * c - z0;
    const d = -x * uz + z * ux;
    if (i > 0 && Math.sign(d) !== Math.sign(last)) return x * ux + z * uz;
    last = d;
  }
  return null;
}

/** Is there an end of track (a connector of a piece not ignored) at this point and height? */
function hasEndAt(layout: TrackRules["layout"], x: number, z: number, y: number, ignore: Ignore): boolean {
  for (const id of layout.pieceIds()) {
    if (ignores(ignore, id) || layout.isLifted(id)) continue;
    const p = layout.getPiece(id)!;
    if (Math.abs(p.pose.x - x) > 400 || Math.abs(p.pose.z - z) > 400) continue;
    const def = getPieceDef(p.type, p.flipped);
    for (let k = 0; k < def.connectors.length; k++) {
      const w = layout.worldConnector(connectorRef(id, k), end);
      if (Math.abs(w.x - x) < 2 && Math.abs(w.z - z) < 2 && Math.abs(w.y - y) < 2) return true;
    }
  }
  return false;
}
const end = { x: 0, z: 0, heading: 0, y: 0, kind: "peg" as const };

/** Would these pieces all go down, and the bridge already there clear them? Why not, or null. */
function checkAhead(rules: TrackRules, bridge: DigPiece, pieces: readonly DigPiece[], ignore: Ignore): DigRefusal | null {
  for (const p of pieces) if (crossesLow(bridge, p)) return "angle";
  for (const p of pieces) if (supportInTrench(bridge, p)) return "pier";
  for (const p of pieces) {
    const why = trackBlock(rules, p.type, p.flipped, p.pose, p.y, ignore);
    if (why !== null) return p.type === "underpass" ? "ground" : "busy";
  }
  return null;
}
