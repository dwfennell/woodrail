import { aOrAn } from "../economy/goods";
import type { ThingId } from "../game/things";

export interface MakeRow {
  id: ThingId;
  label: string;
  /** "3 planks". */
  cost: string;
  /** In the toy box now. */
  have: number;
  /** Ordered and not yet made. */
  queued: number;
  shelf: string;
  /** A short line under its name ("Needs Signals to share a line"). */
  note?: string | null;
}

/** One row of the workshop's card. */
export function makeRowHtml(r: MakeRow): string {
  const note = r.note ? `<span class="make-note">${r.note}</span>` : "";
  return `<div class="make-row"><span><b>${r.label}</b> <span class="cost">${r.cost}</span>${note}</span><span class="box">${r.have} in box${r.queued ? ` · ${r.queued} to make` : ""}</span>${r.queued ? `<button class="chip text" data-make="${r.id}" data-less="1" title="Make one fewer">−</button>` : "<span></span>"}<button class="chip text primary" data-make="${r.id}" title="Make one more">+</button></div>`;
}

export interface MakeNow {
  label: string;
  fill: number;
  /** Waiting for goods: what for. */
  waiting: string | null;
}

/**
 * The workshop's card (Game mode): what it's making now, and everything it can make, by shelf, each with its cost,
 * how many are in the toy box, and buttons to order one more or one fewer.
 */
export class WorkshopPanel {
  private shownKey = "";
  /** The progress bar's fill now (and the % it shows), set in place as it fills: the card isn't made again. */
  private bar: HTMLElement | null = null;
  private barShown = -1;

  constructor(
    private readonly root: HTMLElement,
    handlers: { order(id: ThingId): void; cancel(id: ThingId): void },
  ) {
    root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-make]");
      if (!b) return;
      e.stopPropagation();
      const id = b.dataset.make as ThingId;
      if (b.dataset.less) handlers.cancel(id);
      else handlers.order(id);
    });
  }

  hide(): void {
    this.root.hidden = true;
    this.shownKey = "";
    this.bar = null;
  }

  show(now: MakeNow | null, rows: MakeRow[]): void {
    const fill = now ? Math.round(now.fill * 100) : -1;
    // The card's made again only when what it says changes, not as the bar fills (a tap on a button mid-way
    // would be lost).
    const key = JSON.stringify([now && { ...now, fill: 0 }, rows]);
    // (Still there: the card's box can be emptied by others, e.g. when another card opens.)
    const intact = this.bar ? this.root.contains(this.bar) : this.root.firstElementChild !== null;
    if (key === this.shownKey && intact) {
      if (this.bar && fill !== this.barShown) this.bar.style.width = `${(this.barShown = fill)}%`;
      return;
    }
    this.shownKey = key;
    this.root.hidden = false;
    const head = now
      ? `<div class="make-now">${now.waiting ? `Waiting for ${now.waiting} to make ${aOrAn(now.label.toLowerCase())}` : `Making ${aOrAn(now.label.toLowerCase())}`}<span class="bar"><i style="width:${Math.round(now.fill * 100)}%"></i></span></div>`
      : `<div class="make-now">Choose what to make: trains bring the planks.</div>`;
    let body = "";
    let shelf = "";
    for (const r of rows) {
      if (r.shelf !== shelf) body += `<div class="make-head">${(shelf = r.shelf)}</div>`;
      body += makeRowHtml(r);
    }
    this.root.innerHTML = head + body;
    this.bar = this.root.querySelector<HTMLElement>(".make-now .bar > i");
    this.barShown = fill;
  }
}
