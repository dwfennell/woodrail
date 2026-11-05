/**
 * When the browser takes the game's drawing away (the WebGL context lost: on a phone, most often short of memory) and
 * doesn't give it back soon, a card over the frozen picture: the railway is saved, and a tap reloads. If it does come
 * back, the card goes and play carries on.
 */

/** How long a lost drawing has to come back by itself before the card shows (ms). */
export const LOST_CARD_DELAY_MS = 2500;

export const LOST_TITLE = "The picture stopped";
export const LOST_TEXT = "Your device ran short of memory for the game's picture. Your railway is saved.";
export const LOST_BUTTON = "Tap to reload";

export class ContextLostCard {
  readonly root: HTMLDivElement;
  private timer = 0;

  constructor(onReload: () => void) {
    const r = (this.root = document.createElement("div"));
    r.className = "gl-lost";
    r.hidden = true;
    r.setAttribute("role", "alertdialog");
    r.setAttribute("aria-labelledby", "gl-lost-title");
    const card = document.createElement("div");
    card.className = "gl-lost-card";
    const h = document.createElement("h2");
    h.id = "gl-lost-title";
    h.textContent = LOST_TITLE;
    const p = document.createElement("p");
    p.textContent = LOST_TEXT;
    const b = document.createElement("button");
    b.className = "chip primary";
    b.textContent = LOST_BUTTON;
    b.addEventListener("click", onReload);
    card.append(h, p, b);
    r.append(card);
    document.body.append(r);
  }

  /** The drawing is lost: the card, unless it's back within `LOST_CARD_DELAY_MS`. */
  lost(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.root.hidden = false;
      this.root.querySelector("button")?.focus();
    }, LOST_CARD_DELAY_MS);
  }

  /** It's back. */
  restored(): void {
    clearTimeout(this.timer);
    this.root.hidden = true;
  }
}
