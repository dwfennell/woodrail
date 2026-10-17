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

/** How long (ms) before a train that whistled may whistle again: once as it passes a post, not at every piece near it. */
export const WHISTLE_EVERY = 4000;

/**
 * Which engines whistle, and how loud. Engines coming onto whistle-post track in a frame are `offer`ed with their
 * volume and pan as heard from the camera (the frame loop's `listen`, as for clacks); `flush` at the frame's end plays
 * the loudest, the train nearest the camera, so a far train never takes the whistle from a near one. A train whose
 * whistle wasn't heard (a louder one won, or the audio turned it down) isn't held back: it may whistle at its next
 * joint by the post.
 */
export class WhistleCalls {
  /** When each train last whistled (ms). */
  private readonly last = new Map<number, number>();
  private best = -1;
  private volume = 0;
  private pan = 0;

  /** An engine came onto whistle-post track, heard at `volume` and `pan` (ignored if it whistled under 4 s ago). */
  offer(trainId: number, volume: number, pan: number, now: number): void {
    if (now - (this.last.get(trainId) ?? -Infinity) < WHISTLE_EVERY) return;
    if (this.best !== -1 && volume <= this.volume) return;
    this.best = trainId;
    this.volume = volume;
    this.pan = pan;
  }

  /**
   * The frame's offers are in: the loudest whistles (`play` returns whether it was heard). `alive` says whether a train
   * still exists, to forget ones gone. A frame with no offers costs one compare.
   */
  flush(now: number, play: (volume: number, pan: number) => boolean, alive: (trainId: number) => boolean): void {
    if (this.best === -1) return;
    const id = this.best;
    this.best = -1;
    if (!play(this.volume, this.pan)) return;
    this.last.set(id, now);
    if (this.last.size > 64) for (const t of this.last.keys()) if (!alive(t)) this.last.delete(t);
  }
}

/** A switch or signal near a signal box or lever frame. */
export interface Lever {
  readonly pieceId: number;
  readonly kind: "points" | "signal";
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
    if (distance <= LEVER_REACH) out.push({ pieceId: id, kind, distance });
  }
  return out.sort((a, b) => a.distance - b.distance);
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
