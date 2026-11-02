/** One line as the Lines view lists it. */
export interface LineRow {
  id: number;
  name: string;
  colour: string;
  trains: number;
  stops: number;
}

export interface LinesViewHandlers {
  /** A line's name changed (typed and confirmed). */
  rename(id: number, name: string): void;
  /** A line's colour picked from the palette. */
  recolour(id: number, colour: string): void;
  /** Frame a line's places on the map. */
  show(id: number): void;
  /** Edit a line's stops: its train's card, planning (audit F12). */
  edit(id: number): void;
  /** Put another train on a line: the nearest free one that track leads from to it. */
  addTrain(id: number): void;
  /** A new line: the nearest free train's card, planning. */
  newLine(): void;
  close(): void;
}

/**
 * The Lines view: every line in a list (its colour, its name, its trains and stops), over the map with every line's
 * ribbon drawn. A line's swatch opens a row of colours to pick from; its name is edited in place. A sheet at the bottom,
 * like the cards, for one thumb. Built only when what it lists changes (`show` compares a key).
 */
export class LinesView {
  readonly root = document.createElement("div");
  private readonly list = document.createElement("div");
  private shownKey = "";
  /** The line whose palette is open, or −1. */
  private picking = -1;
  private rows: readonly LineRow[] = [];

  constructor(
    parent: HTMLElement,
    private readonly palette: readonly { colour: string; name: string }[],
    private readonly nameMax: number,
    private readonly handlers: LinesViewHandlers,
  ) {
    this.root.className = "lines-view card";
    this.root.hidden = true;
    const head = document.createElement("div");
    head.className = "lines-head";
    const title = document.createElement("b");
    title.textContent = "Lines";
    const close = document.createElement("button");
    close.className = "chip text";
    close.textContent = "Done";
    close.title = "Close the lines";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.close();
    });
    // (A new line from here, not only from a train's card: audit F12.)
    const add = document.createElement("button");
    add.className = "chip text lines-new";
    add.textContent = "+ New line";
    add.title = "Plan a new line for a train that runs none";
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.newLine();
    });
    head.append(title, add, close);
    this.list.className = "lines-list";
    this.root.append(head, this.list);
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(on: boolean): void {
    this.root.hidden = !on;
    if (!on) this.picking = -1;
    this.shownKey = "";
  }

  /** List these lines (only redrawn when they've changed). */
  show(rows: readonly LineRow[]): void {
    if (this.root.hidden) return;
    const key = `${this.picking}|${rows.map((r) => `${r.id}:${r.name}:${r.colour}:${r.trains}:${r.stops}`).join("|")}`;
    if (key === this.shownKey) return;
    // (Not while a name is being typed: it would lose the caret.)
    if (this.list.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === "INPUT") return;
    this.shownKey = key;
    this.rows = rows;
    this.list.innerHTML = "";
    if (rows.length === 0) {
      const none = document.createElement("div");
      none.className = "lines-none";
      none.textContent = "No lines yet: tap + New line, or a train and Plan a route";
      this.list.append(none);
      return;
    }
    for (const r of rows) this.list.append(this.row(r));
  }

  private row(r: LineRow): HTMLElement {
    const row = document.createElement("div");
    row.className = "lines-row";
    const swatch = document.createElement("button");
    swatch.className = "lines-swatch";
    swatch.style.background = r.colour;
    swatch.title = "Change its colour";
    swatch.addEventListener("click", (e) => {
      e.stopPropagation();
      this.picking = this.picking === r.id ? -1 : r.id;
      this.show(this.rows);
    });
    const name = document.createElement("input");
    name.className = "lines-name";
    name.value = r.name;
    name.maxLength = this.nameMax;
    name.setAttribute("aria-label", "Line name");
    name.enterKeyHint = "done";
    const commit = () => {
      if (name.value.trim() && name.value.trim() !== r.name) this.handlers.rename(r.id, name.value);
      else name.value = r.name;
    };
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") name.blur();
      if (e.key === "Escape") {
        name.value = r.name;
        name.blur();
      }
      e.stopPropagation();
    });
    name.addEventListener("blur", commit);
    const info = document.createElement("span");
    info.className = "lines-info";
    info.textContent = `${r.trains} ${r.trains === 1 ? "train" : "trains"} · ${r.stops} ${r.stops === 1 ? "stop" : "stops"}`;
    const show = document.createElement("button");
    show.className = "chip text lines-show";
    show.textContent = "Show";
    show.title = "Show this line's places on the map";
    show.addEventListener("click", (e) => {
      e.stopPropagation();
      this.handlers.show(r.id);
    });
    const main = document.createElement("div");
    main.className = "lines-main";
    main.append(name, info);
    row.append(swatch, main, show);
    // Under it, what to do with the line: edit its stops, put another train on it.
    const acts = document.createElement("div");
    acts.className = "lines-actions";
    const act = (text: string, tip: string, fn: () => void) => {
      const b = document.createElement("button");
      b.className = "chip text";
      b.textContent = text;
      b.title = tip;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      return b;
    };
    acts.append(act("Edit stops", "Change this line's stops (all its trains run them)", () => this.handlers.edit(r.id)), act("+ Train", "Put another train on this line", () => this.handlers.addTrain(r.id)));
    const wrap = document.createElement("div");
    wrap.className = "lines-row-wrap";
    if (this.picking !== r.id) {
      wrap.append(row, acts);
      return wrap;
    }
    const colours = document.createElement("div");
    colours.className = "lines-palette";
    for (const c of this.palette) {
      const b = document.createElement("button");
      b.className = "lines-swatch";
      b.style.background = c.colour;
      b.title = c.name;
      b.classList.toggle("on", c.colour === r.colour);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        this.picking = -1;
        this.handlers.recolour(r.id, c.colour);
      });
      colours.append(b);
    }
    wrap.append(row, colours, acts);
    return wrap;
  }
}
