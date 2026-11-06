import type { LineHealth } from "../game/line-health";

/** One line as the Lines list shows it. */
export interface LineRow {
  id: number;
  name: string;
  colour: string;
  /** Its stops' names, in order. */
  stops: string[];
  trains: number;
  /** The goods it carries, as icons ("🪵"); "" for none yet. */
  carries: string;
  health: LineHealth;
  healthWords: string;
  /** "18 loads a month", or "". */
  loads: string;
  /**
   * Why Reverse couldn't turn some of its trains round on a ring (they keep their way, the long way round to each
   * stop), said under the row with a Turn round to try again; none when all were turned.
   */
  note?: string;
}

export interface LinesViewHandlers {
  /** A line tapped: its sheet (stops and trains). */
  open(id: number): void;
  /** Try again to turn round the trains Reverse couldn't on a ring line (`LineRow.note`). */
  turnRound(id: number): void;
  /** A new line: the sheet with no line yet, made at the first place tapped (no train needed). */
  newLine(): void;
  close(): void;
}

/** The order rows are listed in: lines that need the player first (stuck, no trains), then waiting, then moving. */
const ORDER: Readonly<Record<LineHealth, number>> = { stuck: 0, none: 1, waiting: 2, moving: 3 };

/** Rows in the list's order: problems first, then by name. */
export function sortRows(rows: readonly LineRow[]): LineRow[] {
  return [...rows].sort((a, b) => ORDER[a.health] - ORDER[b.health] || a.name.localeCompare(b.name) || a.id - b.id);
}

/**
 * The Lines list (☰ Lines, or a train card's line name): every line as a row to tap (its colour, name, a small line
 * diagram of its stops, its trains, what it carries, how it's doing, loads a month), problems first, over the map with
 * every line's ribbon drawn. A row opens the line's sheet. A sheet at the bottom, like the cards, for one thumb. Built
 * only when what it lists changes (`show` compares a key).
 */
export class LinesView {
  readonly root = document.createElement("div");
  private readonly list = document.createElement("div");
  private readonly count = document.createElement("span");
  private shownKey = "";

  constructor(
    parent: HTMLElement,
    private readonly handlers: LinesViewHandlers,
  ) {
    this.root.className = "lines-view card";
    this.root.hidden = true;
    const head = document.createElement("div");
    head.className = "lines-head";
    const title = document.createElement("b");
    title.textContent = "Lines";
    this.count.className = "lines-count";
    const add = document.createElement("button");
    add.className = "chip text lines-new";
    add.textContent = "+ New line";
    add.title = "Make a line: tap its places on the map, then put trains on it";
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.newLine();
    });
    const close = document.createElement("button");
    close.className = "close lines-close";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close the lines");
    close.title = "Close the lines";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.close();
    });
    head.append(title, this.count, add, close);
    this.list.className = "lines-list";
    this.root.append(head, this.list);
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(on: boolean): void {
    this.root.hidden = !on;
    this.shownKey = "";
  }

  /** List these lines (only redrawn when they've changed). */
  show(rows: readonly LineRow[]): void {
    if (this.root.hidden) return;
    const sorted = sortRows(rows);
    const key = JSON.stringify(sorted);
    if (key === this.shownKey) return;
    this.shownKey = key;
    const trains = rows.reduce((n, r) => n + r.trains, 0);
    this.count.textContent = rows.length === 0 ? "" : `${rows.length} ${rows.length === 1 ? "line" : "lines"} · ${trains} ${trains === 1 ? "train" : "trains"}`;
    this.list.innerHTML = "";
    if (rows.length === 0) {
      const none = document.createElement("div");
      none.className = "lines-none";
      none.textContent = "No lines yet. Tap + New line, then the places it should stop at";
      this.list.append(none);
      return;
    }
    for (const r of sorted) this.list.append(this.row(r));
  }

  private row(r: LineRow): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "lines-row-wrap";
    const row = document.createElement("button");
    row.className = `lines-row ${r.health}`;
    row.dataset.line = String(r.id);
    row.style.setProperty("--line", r.colour);
    row.title = `${r.name}: its stops and trains`;
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.open(r.id);
    });
    const top = document.createElement("span");
    top.className = "lines-top";
    const dot = document.createElement("i");
    dot.className = "lines-dot";
    const name = document.createElement("span");
    name.className = "lines-name";
    name.textContent = r.name;
    const chev = document.createElement("span");
    chev.className = "lines-chev";
    chev.textContent = "›";
    chev.setAttribute("aria-hidden", "true");
    top.append(dot, name, chev);
    // The line drawn small: its ends named, a dot a stop between ("+3" beyond five).
    const diag = document.createElement("span");
    diag.className = "lines-diag";
    diag.setAttribute("aria-label", `Stops: ${r.stops.join(", ")}`);
    const shown = r.stops.length <= 5 ? r.stops : [r.stops[0], r.stops[1], "", r.stops[r.stops.length - 2], r.stops[r.stops.length - 1]];
    shown.forEach((s, i) => {
      const stop = document.createElement("span");
      stop.className = `lines-stop${s === "" ? " more" : ""}`;
      const label = document.createElement("span");
      label.className = "lines-stop-name";
      // (Only the ends named: between them, names would run into each other on a phone.)
      label.textContent = s === "" ? `+${r.stops.length - 4}` : i === 0 || i === shown.length - 1 ? s : "";
      stop.append(label);
      diag.append(stop);
    });
    const meta = document.createElement("span");
    meta.className = "lines-meta";
    const trains = document.createElement("span");
    trains.className = "lines-trains";
    trains.textContent = `🚂 ${r.trains}`;
    trains.setAttribute("aria-label", `${r.trains} ${r.trains === 1 ? "train" : "trains"}`);
    meta.append(trains);
    if (r.carries) {
      const goods = document.createElement("span");
      goods.className = "lines-goods";
      goods.textContent = r.carries;
      meta.append(goods);
    }
    const pill = document.createElement("span");
    pill.className = `lines-pill ${r.health}`;
    pill.append(document.createElement("i"), r.healthWords);
    meta.append(pill);
    if (r.loads) {
      const loads = document.createElement("span");
      loads.className = "lines-loads";
      loads.textContent = r.loads;
      meta.append(loads);
    }
    row.append(top, diag, meta);
    wrap.append(row);
    // (Reversed on a ring, a train that couldn't be turned round: why, and Turn round to try again.)
    if (r.note) {
      const note = document.createElement("div");
      note.className = "lines-note";
      note.setAttribute("role", "status");
      const text = document.createElement("span");
      text.textContent = r.note;
      const again = document.createElement("button");
      again.className = "chip text";
      again.textContent = "Turn round";
      again.title = "Try again to turn these trains round, so they run the line's new way";
      again.addEventListener("click", (e) => {
        e.stopPropagation();
        this.handlers.turnRound(r.id);
      });
      note.append(text, again);
      wrap.append(note);
    }
    return wrap;
  }
}
