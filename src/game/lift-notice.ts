/**
 * What the player is told about train lifts: the toast for a train too long for a lift's platform (once per train, not
 * on every approach), and the first-time tip when a lift is first put down.
 */

/** The train lift's name everywhere the player reads it (the tray, its card, toasts, the catalogue). */
export const LIFT_NAME = "Train lift";

/** What a train too long for a lift is told. */
export const TOO_LONG_MESSAGE = "That train's too long for the train lift: an engine and two cars fit";

/** How long (ms) before the same train is told again that it's too long (a player may have forgotten by then). */
export const TOO_LONG_AGAIN_MS = 5 * 60_000;

/**
 * Trains told they're too long for a lift. Keyed by their cars, not the train's id: a train turned back at a lift's
 * end (as one too long is) comes back as a new train, its cars keeping theirs. A few entries (one per car told).
 */
export class TooLongNotice {
  private readonly told = new Map<number, number>();

  /** Tell this train (its cars' ids) now (`now`, ms)? Yes the first time, and again only after `TOO_LONG_AGAIN_MS`. */
  shouldTell(carIds: readonly number[], now: number): boolean {
    for (const [id, at] of this.told) if (now - at >= TOO_LONG_AGAIN_MS) this.told.delete(id);
    if (carIds.some((id) => this.told.has(id))) return false;
    for (const id of carIds) this.told.set(id, now);
    return true;
  }
}

/**
 * Why a lift can't be taken up, moved or turned now (`Sim.liftFree`): a train on it (standing, or being carried), as
 * the turntable says; or it's going (empty) to its other end.
 */
export const liftHeldMessage = (trainOnIt: boolean): string => (trainOnIt ? "A train is on it" : "The train lift is still moving");

/** The first-time tip when a train lift is put down. */
export const LIFT_TIP = "Tap the train lift to send it";
const LIFT_TIP_KEY = "woodrail.liftTip";

/** Has this device been shown the lift tip (as "woodrail.loopTip")? Storage unavailable: not yet. */
export function liftTipSeen(): boolean {
  try {
    return localStorage.getItem(LIFT_TIP_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remember the lift tip as shown. */
export function markLiftTipSeen(): void {
  try {
    localStorage.setItem(LIFT_TIP_KEY, "1");
  } catch {
    // storage unavailable: it may show again next visit
  }
}
