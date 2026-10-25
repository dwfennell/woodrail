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

/** How the workshop's yard shares planks (its card's two-way choice): `keeps` and `cap` are said in the hint. */
export interface YardMode {
  takesAll: boolean;
  /** Planks it keeps while sharing (`yardKeeps`). */
  keeps: number;
  /** What those planks are for (a waiting order, or the next thing to build: `shopSpare`), said in the hint. */
  keptFor?: string;
  /** Its yard's cap. */
  cap: number;
  /** A school is on the map (Takes all still leaves it what its research needs: the hint says so). */
  school?: boolean;
}

export const SHARES_LABEL = "Shares with towns";
export const TAKES_ALL_LABEL = "Takes all planks";

/** The line under the choice: what the workshop does with the planks trains bring. */
export function yardHint(m: YardMode): string {
  if (!m.takesAll) return `Leaves planks for towns further on, keeping ${m.keeps} for you${m.keptFor ? `, enough for ${/^[aeiou]/i.test(m.keptFor) ? "an" : "a"} ${m.keptFor}` : ""}`;
  return `Fills its yard first, up to ${m.cap}${m.school ? " (your school still gets what it needs)" : ""}`;
}

/** The workshop's two-way choice, Shares with towns / Takes all planks, and its hint. */
export function yardModeHtml(m: YardMode): string {
  const chip = (all: boolean, label: string) =>
    `<button class="chip text${m.takesAll === all ? " active" : ""}" data-yard="${all ? "all" : "share"}" aria-pressed="${m.takesAll === all}">${label}</button>`;
  return `<div class="yard-mode" role="group" aria-label="Planks">${chip(false, SHARES_LABEL)}${chip(true, TAKES_ALL_LABEL)}</div><div class="yard-hint">${yardHint(m)}</div>`;
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

  /**
   * `root`: the card's box for what it makes; `yardRoot`: a box of its own for the plank choice, on the card beside
   * it (a phone on its side moves it up under the title, where the short card has room for it), or none (it goes on
   * top of `root`).
   */
  constructor(
    private readonly root: HTMLElement,
    handlers: { order(id: ThingId): void; cancel(id: ThingId): void; takesAll?(on: boolean): void },
    private readonly yardRoot: HTMLElement | null = null,
  ) {
    const onClick = (e: MouseEvent) => {
      const y = (e.target as HTMLElement).closest<HTMLElement>("[data-yard]");
      if (y) {
        e.stopPropagation();
        if (!y.classList.contains("active")) handlers.takesAll?.(y.dataset.yard === "all");
        return;
      }
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-make]");
      if (!b) return;
      e.stopPropagation();
      const id = b.dataset.make as ThingId;
      if (b.dataset.less) handlers.cancel(id);
      else handlers.order(id);
    };
    root.addEventListener("click", onClick);
    yardRoot?.addEventListener("click", onClick);
  }

  hide(): void {
    this.root.hidden = true;
    if (this.yardRoot) this.yardRoot.hidden = true;
    this.forget();
  }

  /**
   * Forget what was drawn, leaving the box alone: another card has it now (it's shared with a town's ledger, a
   * depot's notes), and hiding it would hide what that card just drew there.
   */
  forget(): void {
    this.shownKey = "";
    this.bar = null;
  }

  /** `yard`: its two-way plank choice, on top (null: none). */
  show(now: MakeNow | null, rows: MakeRow[], yard: YardMode | null = null): void {
    const fill = now ? Math.round(now.fill * 100) : -1;
    // The card's made again only when what it says changes, not as the bar fills (a tap on a button mid-way
    // would be lost).
    const key = JSON.stringify([now && { ...now, fill: 0 }, rows, yard]);
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
    if (this.yardRoot) {
      this.yardRoot.innerHTML = yard ? yardModeHtml(yard) : "";
      this.yardRoot.hidden = !yard;
      this.root.innerHTML = head + body;
    } else this.root.innerHTML = (yard ? yardModeHtml(yard) : "") + head + body;
    this.bar = this.root.querySelector<HTMLElement>(".make-now .bar > i");
    this.barShown = fill;
  }
}
