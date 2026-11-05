import type { BoatStopAction } from "../economy";

/**
 * A boat's card (Game mode's River barges; docs/superpowers/specs/2026-11-04-water-transport.md §7): its name and
 * barges, what it carries, what it's doing, its route as numbered chips (a tap on one changes what it does there),
 * ✎ Route to plan (taps on landings add stops), + Barge, Go/Stop and Sell. Laid out as the engine card is; drawn again
 * only when what it shows changes (`show` compares a key), never per frame for nothing.
 */

export interface BoatCardStop {
  label: string;
  action: BoatStopAction;
  /** The stop it's at or heading for. */
  current: boolean;
}

export interface BoatCardView {
  id: number;
  name: string;
  barges: number;
  maxBarges: number;
  /** "Carrying 8 of 12: 🪵 8 logs", or what it can carry while empty. */
  load: string;
  status: string;
  stops: BoatCardStop[];
  planning: boolean;
  /** + Barge's price, or null at the most barges. */
  bargePrice: number | null;
  canAddBarge: boolean;
  going: boolean;
  sellsFor: number;
}

export interface BoatCardHandlers {
  close(): void;
  plan(on: boolean): void;
  cycleStop(index: number): void;
  removeStop(index: number): void;
  addBarge(): void;
  goStop(): void;
  sell(): void;
}

/** The boats' route colour (the river's blue, darker so it reads on wood). */
export const BOAT_LINE = "#2f6db5";

export const ACTION_LABEL: Record<BoatStopAction, string> = { both: "Drop and pick up", pick: "Pick up", drop: "Only drop" };

export class BoatCard {
  readonly el: HTMLDivElement;
  private shownKey = "";
  private boatId = -1;
  /** The boat whose card is open (−1: none). */
  get openId(): number {
    return this.el.hidden ? -1 : this.boatId;
  }

  constructor(private readonly h: BoatCardHandlers) {
    this.el = document.createElement("div");
    this.el.className = "card depot-card boat-card";
    this.el.setAttribute("role", "dialog");
    this.el.hidden = true;
  }

  /** Show (or keep showing) a boat's card: drawn again only when what it shows changed. */
  show(view: BoatCardView): void {
    this.boatId = view.id;
    this.el.hidden = false;
    const key = JSON.stringify(view);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.render(view);
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.shownKey = "";
  }

  private render(v: BoatCardView): void {
    const el = this.el;
    el.innerHTML = "";
    const head = div("route-head");
    const sw = document.createElement("span");
    sw.className = "route-swatch";
    sw.style.background = BOAT_LINE;
    const title = document.createElement("b");
    title.className = "boat-name";
    title.textContent = v.name;
    const what = document.createElement("span");
    what.className = "route-none";
    what.textContent = `tug and ${v.barges === 1 ? "a barge" : `${v.barges} barges`}`;
    head.append(sw, title, what);
    el.append(head);
    el.append(text("depot-stock boat-load", v.load));
    el.append(text("route-hint boat-status", v.planning ? "Tap landings on this river, in order: each is a stop." : v.status));
    // The route: a chip a stop, numbered; a tap changes what the boat does there.
    const stops = div("route-stops boat-stops");
    v.stops.forEach((s, i) => {
      const chip = button(`chip text route-chip has-goods${s.current ? " next" : ""}`, "", `Stop ${i + 1}: ${s.label}. Tap to change what the boat does here`, () => this.h.cycleStop(i));
      chip.style.setProperty("--line", BOAT_LINE);
      chip.innerHTML = `<span class="route-num">${i + 1}</span> ${escape(s.label)}<span class="route-goods">${ACTION_LABEL[s.action]}</span>`;
      stops.append(chip);
      if (v.planning && v.stops.length > 1) stops.append(button("chip text boat-unstop", "✕", `Take ${s.label} off the route`, () => this.h.removeStop(i)));
    });
    stops.append(button(`chip text route-plan${v.planning ? " on" : ""}`, v.planning ? "Done" : "✎ Route", v.planning ? "Done planning" : "Plan this boat's route: tap landings in order", () => this.h.plan(!v.planning)));
    el.append(stops);
    const row = div("card-row boat-actions");
    if (v.bargePrice !== null) {
      const add = button("chip text", `+ Barge · ${v.bargePrice} 🪙`, "Another barge: 4 more loads", () => this.h.addBarge());
      add.disabled = !v.canAddBarge;
      row.append(add);
    }
    const go = button(`chip text${v.going ? "" : " primary"}`, v.going ? `<span class="go-icon">■</span> Stop` : "Go", v.going ? "Stop the boat where it is" : "Set the boat going", () => this.h.goStop());
    row.append(go, button("chip text", `Sell · ${v.sellsFor} 🪙`, "Sell the boat: half what it cost back", () => this.h.sell()));
    el.append(row);
    el.append(button("close", "✕", "Close", () => this.h.close()));
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

function text(cls: string, t: string): HTMLDivElement {
  const d = div(cls);
  d.textContent = t;
  return d;
}

function button(cls: string, html: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.innerHTML = html;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
