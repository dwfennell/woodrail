import type { BoatStopAction } from "../economy";

/**
 * A boat's card (Game mode's River barges; docs/superpowers/specs/2026-11-04-water-transport.md §7), in the cards' one
 * layout (docs/agents/card-system.md): its name and barges at the head; what it carries and what it's doing; its route
 * as a row a stop (a tap on a stop's action changes what it does there, its ✕ takes it off while planning); ✎ Route
 * (Done while planning: taps on landings add stops) and Go/Stop at the foot; more barges are built for it at a
 * boatyard. Drawn again only when what it shows changes (`show` compares a key), never per frame for nothing.
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
  /** How it gets more barges (built at a boatyard), or "" at the most. */
  more: string;
  going: boolean;
}

export interface BoatCardHandlers {
  close(): void;
  plan(on: boolean): void;
  cycleStop(index: number): void;
  removeStop(index: number): void;
  goStop(): void;
  /** Its History sheet (ui/history-sheet.ts). */
  history?(): void;
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
    el.classList.toggle("planning-boat", v.planning);
    // Head, as every place's card's: ✕ at the corner, the name on its own line, what it is under it.
    el.append(button("close", "✕", "Close", () => this.h.close()));
    const title = div("card-title boat-name");
    title.textContent = v.name;
    el.append(title);
    el.append(text("card-sub boat-kind", `Tug and ${v.barges === 1 ? "a barge" : `${v.barges} barges`}`));
    // Body: what it carries and what it's doing (each kept two lines tall, so the card doesn't jump as they change).
    el.append(text("card-line boat-load", v.load));
    el.append(text("card-line live boat-status", v.planning ? "Tap landings on this river, in order: each one is a stop." : v.status));
    // The route: a row a stop, on the river's blue rail: its number, its landing, what the boat does there (a tap
    // changes it), and while planning its own ✕ at the row's end.
    const stops = document.createElement("ol");
    stops.className = "boat-stops";
    stops.style.setProperty("--line", BOAT_LINE);
    v.stops.forEach((s, i) => {
      const row = document.createElement("li");
      row.className = `boat-stop${s.current ? " next" : ""}`;
      const num = document.createElement("span");
      num.className = "boat-stop-num";
      num.textContent = String(i + 1);
      const name = document.createElement("span");
      name.className = "boat-stop-name";
      name.textContent = s.label;
      row.append(num, name, button("chip text boat-stop-action", ACTION_LABEL[s.action], `Stop ${i + 1}, ${s.label}: ${ACTION_LABEL[s.action]}. Tap to change what the boat does here`, () => this.h.cycleStop(i)));
      if (v.planning && v.stops.length > 1) row.append(button("boat-unstop", "✕", `Take ${s.label} off the route`, () => this.h.removeStop(i)));
      stops.append(row);
    });
    // (Planning: where the next tap goes, a pencilled row of its own.)
    if (v.planning) {
      const next = document.createElement("li");
      next.className = "boat-stop boat-stop-next";
      next.innerHTML = `<span class="boat-stop-num">${v.stops.length + 1}</span><span class="boat-stop-name">Tap a landing</span>`;
      stops.append(next);
    }
    el.append(stops);
    // Actions: Route (Done while planning) and Go / Stop, side by side at the foot; one painted block at a time.
    const row = div("card-actions boat-actions");
    row.append(button(`chip text route-plan${v.planning ? " on" : ""}`, v.planning ? "Done" : "✎ Route", v.planning ? "Done planning" : "Plan this boat's route: tap landings in order", () => this.h.plan(!v.planning)));
    if (!v.planning && this.h.history) row.append(button("chip text boat-history", "History", "What this boat picked up and dropped off lately, stop by stop", () => this.h.history?.()));
    row.append(button(`chip text boat-go${v.going ? " going" : " primary"}`, v.going ? `<span class="go-icon">■</span> Stop` : "Go", v.going ? "Stop the boat where it is" : "Set the boat going", () => this.h.goStop()));
    el.append(row);
    if (v.more) el.append(text("card-foot boat-more", v.more));
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

