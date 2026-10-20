import { hintSeen, markHintSeen } from "../ui/prefs";

/** What a pin does, said the first time a switch is pinned. */
export const PIN_HINT = "Pinned: trains on a route won't change this switch. Hold again to unpin.";

/** The one-time hint for pinning: said the first time ever (on this device) a switch is pinned, never after. */
export class PinHint {
  constructor(private seen = hintSeen("pin-switch")) {}

  /** A switch was pinned (`on`) or unpinned: the words to say, or null. */
  next(on: boolean): string | null {
    if (!on || this.seen) return null;
    this.seen = true;
    markHintSeen("pin-switch");
    return PIN_HINT;
  }
}
