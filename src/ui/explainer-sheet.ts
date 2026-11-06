import { explainer, type Explainer, type ExplainerId } from "./explainers";

/**
 * The "Learn more" sheet: an explainer (explainers.ts) as a card over the game, its sections each a heading, a few
 * lines and a small picture. Built the first time it's opened (nothing is made, drawn or listened to before), and
 * redrawn only when another explainer is shown. ✕, Back or Escape closes it; what was being placed is still ready.
 */
export class ExplainerSheet {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private shownId: ExplainerId | null = null;
  /** The explainers this one was opened from ("More about routes" from Signals): Back goes to the last. */
  private trail: ExplainerId[] = [];
  private onClose: (() => void) | null = null;
  private body: HTMLElement;
  private titleEl: HTMLElement;
  private back: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    // A dimmed backdrop over the game (a tap on it closes the sheet, and never reaches the map), the card on it.
    const scrim = (this.root = document.createElement("div"));
    scrim.className = "explainer-scrim";
    scrim.hidden = true;
    const r = (this.card = document.createElement("div"));
    r.className = "card explainer-sheet";
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-modal", "true");
    scrim.append(r);
    // (Taps on it are its own: none reaches the map or the tray under it.)
    for (const t of ["pointerdown", "pointerup", "wheel", "touchstart"] as const) scrim.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    scrim.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === scrim) this.hide();
    });
    scrim.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
      e.stopPropagation();
    });
    this.titleEl = document.createElement("div");
    this.titleEl.className = "card-title explainer-title";
    this.titleEl.id = "explainer-title";
    r.setAttribute("aria-labelledby", this.titleEl.id);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "close explainer-x";
    x.textContent = "✕";
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
    });
    this.body = document.createElement("div");
    this.body.className = "explainer-body";
    const row = document.createElement("div");
    row.className = "card-row explainer-row";
    this.back = document.createElement("button");
    this.back.type = "button";
    this.back.className = "chip text primary explainer-back";
    this.back.textContent = "Back";
    this.back.addEventListener("click", (e) => {
      e.stopPropagation();
      const last = this.trail.pop();
      if (last) this.show(last);
      else this.hide();
    });
    row.append(this.back);
    r.append(this.titleEl, x, this.body, row);
    parent.appendChild(scrim);
  }

  /** Is it open? */
  get shown(): ExplainerId | null {
    return this.shownId;
  }

  /** Open explainer `id` (`onClose` when it's closed). */
  show(id: ExplainerId, onClose?: () => void): void {
    if (onClose) this.trail = [];
    if (this.shownId !== id) this.draw(explainer(id));
    this.shownId = id;
    this.onClose = onClose ?? this.onClose;
    this.root.hidden = false;
    this.card.scrollTop = 0;
    this.back.focus({ preventScroll: true });
  }

  hide(): void {
    if (this.shownId === null) return;
    this.shownId = null;
    this.trail = [];
    this.root.hidden = true;
    const done = this.onClose;
    this.onClose = null;
    done?.();
  }

  private draw(x: Explainer): void {
    this.titleEl.textContent = x.title;
    const parts: HTMLElement[] = [];
    const intro = document.createElement("p");
    intro.className = "explainer-intro";
    intro.textContent = x.intro;
    parts.push(intro);
    for (const s of x.sections) {
      const sec = document.createElement("section");
      sec.className = "explainer-section";
      const pic = document.createElement("div");
      pic.className = "explainer-picture";
      pic.setAttribute("role", "img");
      pic.setAttribute("aria-label", s.alt);
      // (Our own drawings, from explainers.ts: no outside text goes in here.)
      pic.innerHTML = s.picture;
      const h = document.createElement("h3");
      h.className = "explainer-heading";
      h.textContent = s.heading;
      const p = document.createElement("p");
      p.className = "explainer-text";
      p.textContent = s.text;
      sec.append(pic, h, p);
      parts.push(sec);
    }
    if (x.seeAlso?.length) {
      const more = document.createElement("div");
      more.className = "explainer-more";
      for (const id of x.seeAlso) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "learn-more explainer-see";
        b.dataset.explainer = id;
        b.textContent = `More about ${explainer(id).title.toLowerCase()}`;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (this.shownId) this.trail.push(this.shownId);
          this.show(id);
        });
        more.append(b);
      }
      parts.push(more);
    }
    this.body.replaceChildren(...parts);
  }
}
