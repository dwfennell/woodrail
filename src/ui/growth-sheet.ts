import type { CardView } from "../game/rewards";

/** What the growth sheet shows: the first offer waiting (its town, its cards as they read now), and how many more wait. */
export interface GrowthSheetView {
  /** "Larkfield grew! Pick one". */
  title: string;
  cards: CardView[];
  /** Offers waiting after this one. */
  more: number;
}

export interface GrowthSheetHandlers {
  /** Take card `i` of the offer showing (one tap, no confirm). */
  take(i: number): void;
  /** Closed: the offer keeps waiting. */
  close(): void;
  /** The reward badge tapped: open the sheet on the offer waiting. */
  reopen(): void;
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "Larkfield grew! Pick one" (a second offer from the same town in a row: "grew again!"). */
export function sheetTitle(offers: readonly { from: string }[], k = 0): string {
  const from = offers[k].from;
  const again = offers.slice(0, k).some((o) => o.from === from);
  return `${from} grew${again ? " again" : ""}! Pick one`;
}

/** The sheet's inside: its title, a close button, and the cards (one button each, at least 44 px: a large tap). */
export function growthSheetHtml(v: GrowthSheetView): string {
  const cards = v.cards
    .map(
      (c, i) =>
        `<button type="button" class="gs-card gs-${c.kind}${c.ok ? "" : " held"}" data-card="${i}"${c.ok ? "" : ` aria-disabled="true"`}><span class="gs-icon" aria-hidden="true">${c.icon}</span><span class="gs-amount">${esc(c.amount)}</span><span class="gs-line">${esc(c.ok ? c.line : (c.why ?? c.line))}</span></button>`,
    )
    .join("");
  const more = v.more > 0 ? `<p class="gs-more">${v.more === 1 ? "1 more reward waiting" : `${v.more} more rewards waiting`}</p>` : "";
  return `<div class="gs-head"><h2>${esc(v.title)}</h2><button type="button" class="close" data-close="1" title="Close: it keeps till later" aria-label="Close">✕</button></div><div class="gs-cards">${cards}</div>${more}`;
}

/**
 * The growth menu on a phone (Game mode): a bottom sheet "Larkfield grew! Pick one" with three large cards (an icon,
 * an amount, one line each). One tap takes a card; closing it keeps the offer waiting (reopened from the growth toast
 * or the reward badge). Written only when what it shows changes; nothing runs while it's open.
 */
export class GrowthSheet {
  readonly root = document.createElement("div");
  private readonly panel = document.createElement("div");
  /** The small badge that says rewards wait while the sheet is closed (a tap opens it). */
  readonly badge = document.createElement("button");
  private shownKey = "";
  private badgeShown = -1;

  constructor(parent: HTMLElement, handlers: GrowthSheetHandlers) {
    this.badge.type = "button";
    this.badge.className = "reward-badge";
    this.badge.hidden = true;
    this.badge.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.reopen();
    });
    this.badge.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.appendChild(this.badge);
    this.root.className = "growth-sheet";
    this.root.hidden = true;
    this.panel.className = "gs-panel";
    this.panel.setAttribute("role", "dialog");
    this.panel.setAttribute("aria-modal", "true");
    this.root.appendChild(this.panel);
    this.root.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = e.target as HTMLElement;
      // A tap on the shade around the sheet closes it too.
      if (t === this.root || t.closest("[data-close]")) {
        handlers.close();
        return;
      }
      const b = t.closest<HTMLElement>("[data-card]");
      if (!b || b.getAttribute("aria-disabled") === "true") return;
      handlers.take(Number(b.dataset.card));
    });
    // (Presses on the sheet are its own: nothing reaches the map under it.)
    this.root.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** Rewards waiting (0: none, or the sheet's open): the badge shows while some wait and the sheet's closed. */
  setWaiting(n: number): void {
    const shown = this.open ? 0 : n;
    if (shown === this.badgeShown) return;
    this.badgeShown = shown;
    this.badge.hidden = shown === 0;
    this.badge.innerHTML = `<span aria-hidden="true">🎁</span>${shown > 1 ? `<span class="rb-count">${shown}</span>` : ""}`;
    const words = shown === 1 ? "A reward is waiting: pick one" : `${shown} rewards are waiting: pick one`;
    this.badge.title = words;
    this.badge.setAttribute("aria-label", words);
  }

  /** Show this offer (null: close). */
  show(v: GrowthSheetView | null): void {
    if (!v) {
      this.root.hidden = true;
      this.shownKey = "";
      return;
    }
    const html = growthSheetHtml(v);
    this.root.hidden = false;
    if (html === this.shownKey) return;
    this.shownKey = html;
    this.panel.innerHTML = html;
    this.panel.setAttribute("aria-label", v.title);
  }
}
