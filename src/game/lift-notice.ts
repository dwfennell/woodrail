import { TRAIN_ON_TRACK } from "../editor/editor";
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
 * end (as one too long is) comes back as a new train, its cars keeping theirs. No car ids (missing or empty): keyed by
 * the train's id instead, so it's still told only once and not on every approach. A few entries (one per car told).
 */
export class TooLongNotice {
  /** When each was told: "c<car id>" for a car, "t<train id>" for a train whose cars weren't known. */
  private readonly told = new Map<string, number>();

  /**
   * Tell this train (its cars' ids; else its id, `trainId`) now (`now`, ms)? Yes the first time, and again only after
   * `TOO_LONG_AGAIN_MS`. Neither cars nor a train id: no (there's nothing to tell it once by).
   */
  shouldTell(carIds: readonly number[] | undefined, now: number, trainId?: number): boolean {
    for (const [key, at] of this.told) if (now - at >= TOO_LONG_AGAIN_MS) this.told.delete(key);
    const keys = carIds && carIds.length > 0 ? carIds.map((id) => `c${id}`) : trainId !== undefined ? [`t${trainId}`] : [];
    if (keys.length === 0 || keys.some((k) => this.told.has(k))) return false;
    for (const k of keys) this.told.set(k, now);
    return true;
  }
}

/**
 * Why a lift can't be taken up, moved or turned now (`Sim.liftFree`): a train on it (standing, or being carried), as
 * the turntable says; or it's going (empty) to its other end.
 */
export const liftHeldMessage = (trainOnIt: boolean): string => (trainOnIt ? TRAIN_ON_TRACK : "The train lift is still moving");

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
