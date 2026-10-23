import { hintSeen, markHintSeen } from "../ui/prefs";

/** What a pin does, said the first time a switch is pinned. */
export const PIN_HINT = "Pinned: trains on a route won't change this switch. Hold again to unpin.";
/** How to pin, said once before the first pin: the first time a lever is tapped, or a train throws a switch in view. */
export const PIN_HOW_HINT = "Hold a switch's lever to pin it: trains on a route then leave it as it is";
/** Said each time a switch is unpinned (its peg goes, its burned chevrons turn from red back to brown). */
export const UNPINNED = "Unpinned";

/**
 * The pinning hints (QA N3): how to pin, once before the first pin (the first time a lever is tapped, or a routed
 * train throws a switch in view, whichever comes first, and never once a switch has been pinned); what a pin does, the
 * first time ever one is; and a word each time one is unpinned. Once means once on this device.
 */
export class PinHint {
  constructor(
    private seen = hintSeen("pin-switch"),
    private howSeen = hintSeen("pin-switch-how"),
  ) {}

  /** A switch was pinned (`on`) or unpinned: the words to say, or null. */
  next(on: boolean): string | null {
    if (!on) return UNPINNED;
    // (Pinned already: how to pin goes without saying from now on.)
    this.markHow();
    if (this.seen) return null;
    this.seen = true;
    markHintSeen("pin-switch");
    return PIN_HINT;
  }

  /** A lever was tapped, or a train threw a switch in view: how to pin, the first time (before any pin), else null. */
  how(): string | null {
    if (this.howSeen || this.seen) return null;
    this.markHow();
    return PIN_HOW_HINT;
  }

  private markHow(): void {
    if (this.howSeen) return;
    this.howSeen = true;
    markHintSeen("pin-switch-how");
  }
}
