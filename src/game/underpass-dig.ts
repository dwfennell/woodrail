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
export type DigRefusal = "curve" | "points" | "lines" | "short" | "angle" | "centre" | "pier" | "ground" | "busy";

export const DIG_MESSAGES: Record<DigRefusal, string> = {
  curve: "An underpass needs straight track under the bridge: this is a curve",
  points: "Points can't go in an underpass: put the bridge over plain straight track",
  lines: "Only one line can go under a bridge one level up",
  short: "Not enough straight track here for an underpass: it needs two long straights' worth",
  angle: "Cross the line more squarely for an underpass to fit under",
  centre: "Put the bridge over the middle of the underpass",
  pier: "The bridge's end would stand in the underpass: cross the line nearer the bridge's middle",
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
