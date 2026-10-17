import type { PropStore } from "../props/store";
import { createSample, getPieceDef, pathLength, samplePath, type Layout } from "../track";

/**
 * Lineside furniture that does something by nearness (see docs/superpowers/specs/2026-10-17-track-props-design.md,
 * "Lineside props without track"): props, not pieces, each acting on the track near it. Nearness is worked out when
 * the props or the track change (or on a tap), never per frame.
 */

/** The whistle post: an engine coming onto track near one whistles. */
export const WHISTLE_POST = "mech-whistle-post";
/** How near (mm) a piece's track must come to a whistle post for engines on it to whistle. */
export const WHISTLE_REACH = 150;

/** The signal box and lever frame: a tap lists the points and signals near it, to throw. */
export const LEVER_PROPS: ReadonlySet<string> = new Set(["bldg-signal-box", "mech-lever-frame"]);
/** How near (mm) a switch or signal must be to a signal box or lever frame to be worked from it. */
export const LEVER_REACH = 400;

/** Sample spacing along track for nearness (mm). */
const STEP = 12;
const sample = createSample();

/** How near a piece's track comes to (x, z) (mm, plan distance; Infinity for a piece with no track). */
export function trackDistance(layout: Layout, pieceId: number, x: number, z: number): number {
  const p = layout.getPiece(pieceId);
  if (!p) return Infinity;
  const def = getPieceDef(p.type, p.flipped);
  const c = Math.cos(p.pose.heading);
  const s = Math.sin(p.pose.heading);
  let best = Infinity;
  for (const path of def.paths) {
    const len = pathLength(path.geom);
    const n = Math.max(1, Math.ceil(len / STEP));
    for (let i = 0; i <= n; i++) {
      samplePath(path.geom, (len * i) / n, sample);
      const wx = p.pose.x + sample.x * c - sample.z * s;
      const wz = p.pose.z + sample.x * s + sample.z * c;
      const d = Math.hypot(wx - x, wz - z);
      if (d < best) best = d;
    }
  }
  return best;
}

/** A rough reach of a piece's track from its pose (mm): its connectors' furthest, and a little (curves bulge). */
function roughReach(layout: Layout, pieceId: number): number {
  const p = layout.getPiece(pieceId)!;
  let r = 0;
  for (const c of getPieceDef(p.type, p.flipped).connectors) r = Math.max(r, Math.hypot(c.pose.x, c.pose.z));
  return r + 60;
}

/** The pieces whose track comes within `WHISTLE_REACH` of a whistle post. */
export function whistlePieces(layout: Layout, props: PropStore): Set<number> {
  const out = new Set<number>();
  const posts = [...props.all()].filter((p) => p.asset === WHISTLE_POST);
  if (posts.length === 0) return out;
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    const reach = roughReach(layout, id) + WHISTLE_REACH;
    for (const post of posts) {
      if (Math.hypot(p.pose.x - post.x, p.pose.z - post.z) > reach) continue;
      if (trackDistance(layout, id, post.x, post.z) <= WHISTLE_REACH) {
        out.add(id);
        break;
      }
    }
  }
  return out;
}

/**
 * The whistle posts' near track, kept up to date with the props and the track (`sync`: two numbers compared, the work
 * done only when either changed).
 */
export class WhistlePosts {
  private propsVersion = -1;
  private trackVersion = -1;
  private near = new Set<number>();

  /** Bring the near pieces up to date (cheap when nothing changed). */
  sync(layout: Layout, props: PropStore, trackVersion: number): void {
    if (props.version === this.propsVersion && trackVersion === this.trackVersion) return;
    this.propsVersion = props.version;
    this.trackVersion = trackVersion;
    this.near = whistlePieces(layout, props);
  }

  /** Does an engine coming onto this piece whistle? */
  has(pieceId: number): boolean {
    return this.near.has(pieceId);
  }

  get size(): number {
    return this.near.size;
  }
}

/** A switch or signal near a signal box or lever frame. */
export interface Lever {
  readonly pieceId: number;
  readonly kind: "points" | "signal";
  /** Which of a signal piece's signals (a gantry has one on each road); 0 for points. */
  readonly road: number;
  /** How far from the prop (mm). */
  readonly distance: number;
}

/** The switches and signals within `LEVER_REACH` of (x, z), nearest first. */
export function leversNear(layout: Layout, x: number, z: number): Lever[] {
  const out: Lever[] = [];
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    if (layout.isLifted(id)) continue;
    const def = getPieceDef(p.type, p.flipped);
    const kind = def.signal ? "signal" : def.isSwitch ? "points" : null;
    if (!kind) continue;
    if (Math.hypot(p.pose.x - x, p.pose.z - z) > roughReach(layout, id) + LEVER_REACH) continue;
    const distance = trackDistance(layout, id, x, z);
    if (distance > LEVER_REACH) continue;
    // A signal on each of a signal piece's roads.
    const roads = kind === "signal" ? def.paths.length : 1;
    for (let road = 0; road < roads; road++) out.push({ pieceId: id, kind, road, distance });
  }
  return out.sort((a, b) => a.distance - b.distance);
}

/**
 * Which of a signal piece's signals a tap at world (x, z) is for: the road (path) whose line is nearest across the
 * piece (a gantry's two roads), 0 for a plain signal; −1 if the piece isn't a signal.
 */
export function signalRoadAt(layout: Layout, pieceId: number, x: number, z: number): number {
  const p = layout.getPiece(pieceId);
  if (!p) return -1;
  const def = getPieceDef(p.type, p.flipped);
  if (!def.signal) return -1;
  // Across the piece, in its own frame.
  const dx = x - p.pose.x;
  const dz = z - p.pose.z;
  const across = -dx * Math.sin(p.pose.heading) + dz * Math.cos(p.pose.heading);
  let best = 0;
  for (let road = 1; road < def.paths.length; road++)
    if (Math.abs(def.paths[road].geom.start.z - across) < Math.abs(def.paths[best].geom.start.z - across)) best = road;
  return best;
}

/** Which way a switch is set, in words ("straight", "left", "right"), from the route its state picks. */
export function pointsWay(layout: Layout, pieceId: number): string {
  const p = layout.getPiece(pieceId);
  if (!p) return "";
  const routes = getPieceDef(p.type, p.flipped).paths.filter((r) => r.from === 0);
  const route = routes[layout.switchState(pieceId) % Math.max(1, routes.length)];
  if (!route) return "";
  if (route.geom.kind !== "arc") return "straight";
  return route.geom.sweep > 0 ? "left" : "right";
}
