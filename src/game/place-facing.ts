/**
 * Which way a train held over the track faces: the way the pointer has been moving along the track.
 *
 * The pointer's recent motion is kept as one screen vector, the last `FACING_WINDOW_PX` of its path (each move added,
 * then the sum cut back to that length), so a twitch doesn't turn the train round. It's projected onto the track's
 * direction on screen at the point the train would go. Only a clear push along the track counts (`FACING_DEAD_PX`
 * of it): a pointer held still, or moved across the track, leaves the train as it was. Once the pointer has said a way,
 * it takes as much of a push the other way to turn it back, so it doesn't flicker either. No allocations: called on
 * every pointer move.
 */

/** How much of the pointer's recent path (px) says which way it's going. */
export const FACING_WINDOW_PX = 60;
/** How far along the track (px, of the window) the pointer must have gone to face that way. */
export const FACING_DEAD_PX = 22;

export interface PointerMotion {
  /** The recent motion (px, screen: y down). */
  dx: number;
  dy: number;
  /** The last pointer position seen, or NaN before the first. */
  x: number;
  y: number;
}

export const createPointerMotion = (): PointerMotion => ({ dx: 0, dy: 0, x: NaN, y: NaN });

/** Note the pointer at (x, y): the move since the last is added to the recent motion, kept to the window. */
export function notePointer(m: PointerMotion, x: number, y: number): void {
  if (!Number.isNaN(m.x)) {
    m.dx += x - m.x;
    m.dy += y - m.y;
    const l = Math.hypot(m.dx, m.dy);
    if (l > FACING_WINDOW_PX) {
      m.dx *= FACING_WINDOW_PX / l;
      m.dy *= FACING_WINDOW_PX / l;
    }
  }
  m.x = x;
  m.y = y;
}

/** Copy the recent motion (a carried ghost's, to the train a click puts down from it). */
export function copyPointerMotion(from: PointerMotion, to: PointerMotion): void {
  to.dx = from.dx;
  to.dy = from.dy;
  to.x = from.x;
  to.y = from.y;
}

/**
 * Should the train go the track's way (tx, ty: the screen direction of travel at its point, any length), as it stands?
 * 1: yes, the pointer's been going that way; −1: no, it's been going the other way, turn it round; 0: the pointer
 * hasn't said (held still, or moving across the track): leave it as it is.
 */
export function facingAlong(m: PointerMotion, tx: number, ty: number): -1 | 0 | 1 {
  const l = Math.hypot(tx, ty);
  if (l < 1e-9) return 0;
  const along = (m.dx * tx + m.dy * ty) / l;
  return along >= FACING_DEAD_PX ? 1 : along <= -FACING_DEAD_PX ? -1 : 0;
}
