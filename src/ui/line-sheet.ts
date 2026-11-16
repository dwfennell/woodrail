/**
 * The line sheet (routes UX, option B, 2026-11-06; one diagram, lines UI redesign 2026-11-16): one line, run by trains
 * or by none, at the bottom of the screen (docked at the right on a desktop). The line drawn down a painted spine: each
 * stop's number, name and the goods it drops and picks up, and its trains riding the spine before the stop each is
 * heading for (a waiting or stuck one says why, where it is); then free trains to add. A stop tapped opens in place: what moves
 * there in sentences, two ticks (Drop, Pick up; untick both and the train passes by), Wait to fill, ↑ ↓ and ✕. Its
 * height is capped (`.line-sheet` max-height) so the map stays above it to tap places on. Rebuilt only when its model
 * changes (`show` compares a key); nothing per frame.
 */

/** A stop as the sheet shows it. */
export interface SheetStop {
  name: string;
  /** A place's own number ("Forest yard 2": "2"), in a lighter weight. */
  placeNum?: string;
  drop: boolean;
  pick: boolean;
  waitFill: boolean;
  /** Goods dropped and picked up here, short: "🪵 logs". */
  drops: string[];
  picks: string[];
  /** Open: what moves here, in sentences ("Drops 🪵 logs from Forest yard 2"). */
  sentences: string[];
  /** The stop the line's trains (the first) head for next. */
  next: boolean;
  /** Its place was taken up. */
  lost: boolean;
  /** Can it pass by (untick both): three stops or more, and on the map. */
  canPass: boolean;
  /** A warehouse's word on what this stop's ticks do there. */
  note?: string;
  /** Places it passes on the way to the next stop (via points), by name ("" plain track). */
  vias: { name: string; stop: boolean }[];
}

export interface SheetTrain {
  engine: number;
  name: string;
  status: string;
  /** The stop it's heading for (an index into the stops), or −1: none (not drawn on the spine). */
  heading: number;
  /** Standing at that stop (drawn after it, not before). */
  here: boolean;
  /** How it's doing: a waiting or stuck train is a gold tile, its whole status said. */
  health: "moving" | "waiting" | "stuck";
}

export interface SheetFree {
  engine: number;
  name: string;
  /** "near Sawmill 2" */
  where: string;
}

export type SheetHealth = "none" | "moving" | "waiting" | "stuck";

export interface SheetModel {
  /** −1: a new line, no stop yet. */
  id: number;
  name: string;
  colour: string;
  /** Ink for text on the line's colour (dark on light colours). */
  ink: string;
  /** What the sheet shows first: its stops, or its trains (scrolled to Add a train, where a line has none). */
  focus: "stops" | "trains";
  /** The train row opened (Show, Take off line), or −1. */
  trainOpen: number;
  stops: SheetStop[];
  /** The open stop, or −1; a via `{k, i}` open instead. */
  open: number;
  openVia: { k: number; i: number } | null;
  trains: SheetTrain[];
  free: SheetFree[];
  health: SheetHealth;
  healthWords: string;
  /** "Carries 🪵 logs and planks · 18 loads a month", or "". */
  carries: string;
  /** Under the stops: what a tap on the map does now. */
  hint: string;
  warnings: string[];
  /** Plain words under the stops, not a warning ("Changes the line for all 2 of its trains"). */
  notes: string[];
  /** "+ Pass by…" asked: the next track tapped is passed by. */
  viaAsked: boolean;
  /** A + between stops tapped: the next place tapped goes in here (an index into the stops), or −1. */
  insertAt: number;
  /** A place just put in by a tap: where it went, said, with Move to end (put in between by the game) and Undo. */
  added: { k: number; text: string; toEnd: boolean } | null;
  menu: boolean;
  palette: boolean;
  renaming: boolean;
  /** Delete asked once (a second tap deletes). */
  deleteAsked: boolean;
  palettes: readonly { colour: string; name: string }[];
  nameMax: number;
  /** Planning a train's route that has no line yet: the train's name ("" for a new line with no train). */
  forTrain: string;
}

export interface SheetHandlers {
  done(): void;
  /** A train's row tapped: its Show and Take off line (tapped again: closed). */
  openTrain(engine: number): void;
  open(k: number): void;
  openVia(k: number, i: number): void;
  ticks(k: number, drop: boolean, pick: boolean): void;
  wait(k: number): void;
  move(k: number, to: number): void;
  remove(k: number): void;
  viaStop(k: number, i: number): void;
  viaRemove(k: number, i: number): void;
  askVia(): void;
  /** The + after stop `k` tapped: the next place tapped goes in after it (tapped again: not). */
  insert(k: number): void;
  addedToEnd(): void;
  addedUndo(): void;
  rename(name: string): void;
  startRename(): void;
  recolour(colour: string): void;
  togglePalette(): void;
  toggleMenu(): void;
  copy(): void;
  reverse(): void;
  remove_line(): void;
  showTrain(engine: number): void;
  takeOff(engine: number): void;
  addTrain(engine: number): void;
  show(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class LineSheet {
  readonly root = el("div", "card line-sheet");
  private shownKey = "";
  /** A stop's handle held: the sheet holds still till it's let go. */
  private dragging = false;
  /** A finger (or the mouse) down on the sheet: it isn't built again under it (its tap's click would be lost). */
  private pressing = false;
  /** The model that came while pressing, shown once the press is over (after its click). */
  private pending: SheetModel | null = null;

  constructor(
    parent: HTMLElement,
    private readonly h: SheetHandlers,
  ) {
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Line");
    // (Taps on the sheet are the sheet's, not the map's below it.)
    this.root.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      this.pressing = true;
    });
    const up = () => {
      if (!this.pressing) return;
      // (After the click that ends the press: a rebuild then can't take it.)
      window.setTimeout(() => {
        this.pressing = false;
        const m = this.pending;
        this.pending = null;
        if (m && !this.root.hidden) this.show(m);
      }, 60);
    };
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    // (A click on the sheet ends its press first: what the click does shows at once, built for it.)
    this.root.addEventListener(
      "click",
      () => {
        this.pressing = false;
        this.pending = null;
      },
      true,
    );
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  close(): void {
    this.root.hidden = true;
    this.shownKey = "";
  }

  /** Show this model (rebuilt only when it changed, and not while a stop is dragged or a name typed). */
  show(m: SheetModel): void {
    const key = JSON.stringify(m);
    this.root.hidden = false;
    if (key === this.shownKey || this.dragging) return;
    if (this.pressing) {
      this.pending = m;
      return;
    }
    // Only the trains' doings changed (they run on): those words updated in place, not the sheet built again, so a tap
    // on a button isn't lost to a rebuild under the finger.
    if (this.shownKey !== "" && this.shape(key) === this.shape(this.shownKey)) {
      this.shownKey = key;
      for (const t of m.trains) this.placeTrain(t);
      const pill = this.root.querySelector<HTMLElement>(".ls-pill");
      if (pill && !pill.classList.contains(m.health)) {
        pill.className = `ls-pill ${m.health}`;
        pill.lastChild!.textContent = m.healthWords;
      }
      for (const f of m.free) {
        const where = this.root.querySelector<HTMLElement>(`.ls-add-train[data-engine="${f.engine}"] span`);
        if (where && where.textContent !== ` · ${f.where}`) where.textContent = ` · ${f.where}`;
      }
      const carries = this.root.querySelector<HTMLElement>(".ls-carries");
      if (carries && carries.textContent !== m.carries) carries.textContent = m.carries;
      return;
    }
    if (this.root.contains(document.activeElement) && (document.activeElement as HTMLElement).tagName === "INPUT") return;
    const scroll = this.root.querySelector(".ls-body")?.scrollTop ?? 0;
    const sameLine = this.shownKey !== "" && (JSON.parse(this.shownKey) as SheetModel).id === m.id;
    this.shownKey = key;
    this.root.innerHTML = "";
    this.root.style.setProperty("--line", m.colour);
    this.root.style.setProperty("--line-ink", m.ink);
    this.root.append(this.head(m));
    if (m.palette) this.root.append(this.palette(m));
    if (m.menu) this.root.append(this.menu(m));
    const body = el("div", "ls-body");
    const foot = el("div", "ls-foot");
    this.diagram(m, body, foot);
    this.root.append(body);
    // (What a tap on the map does now, and + Pass by…: under the list, never scrolled away.)
    if (this.addedRow) this.root.append(this.addedRow);
    this.addedRow = null;
    if (foot.childElementCount > 0) this.root.append(foot);
    if (sameLine) body.scrollTop = scroll;
    // (Opened on its trains, a line no train runs: Add a train in view.)
    else if (m.focus === "trains") requestAnimationFrame(() => body.querySelector(".ls-add")?.scrollIntoView({ block: "nearest" }));
    // The open stop (else one just put in by a tap) scrolled into the sheet's view.
    const target = body.querySelector<HTMLElement>(".ls-stop.open, .ls-via.open, .ls-stop.added");
    // (Its top: an open stop can be taller than the sheet, and its name says which it is.)
    // (Where the sheet is short, on a phone on its side: then its ticks, the stop's controls, in view too.)
    if (target)
      requestAnimationFrame(() => {
        if (!target.isConnected) return;
        target.scrollIntoView({ block: target.offsetHeight > body.clientHeight ? "start" : "nearest" });
        const ticks = target.querySelector(".ls-ticks");
        if (ticks && ticks.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom) ticks.scrollIntoView({ block: "nearest" });
      });
  }

  /** A model's key without what changes as trains run (statuses, where free trains are, loads): its shape. */
  private shape(key: string): string {
    const m = JSON.parse(key) as SheetModel;
    // (Where each train is and how it's doing change as it runs: moved and said in place, not built again.)
    return JSON.stringify({ ...m, trains: m.trains.map((t) => t.engine), free: m.free.map((f) => f.engine), carries: !!m.carries, health: m.health, healthWords: "" });
  }

  private button(text: string, cls: string, tip: string, fn: () => void): HTMLButtonElement {
    const b = el("button", `chip text ${cls}`, text);
    b.title = tip;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  }

  private head(m: SheetModel): HTMLElement {
    const head = el("div", "ls-head");
    const swatch = el("button", "ls-swatch");
    swatch.setAttribute("aria-label", "Change the line's colour");
    swatch.title = "Change its colour";
    swatch.addEventListener("click", (e) => (e.stopPropagation(), this.h.togglePalette()));
    head.append(swatch);
    if (m.renaming) {
      const input = el("input", "ls-name-input");
      input.value = m.name;
      input.maxLength = m.nameMax;
      input.setAttribute("aria-label", "Line name");
      input.enterKeyHint = "done";
      const commit = () => this.h.rename(input.value);
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") input.blur();
        if (e.key === "Escape") {
          input.value = m.name;
          input.blur();
        }
      });
      input.addEventListener("blur", commit);
      head.append(input);
      requestAnimationFrame(() => (input.focus(), input.select()));
    } else {
      const name = el("button", "ls-name");
      name.append(el("span", "ls-name-text", m.id === -1 ? (m.forTrain ? `New route · ${m.forTrain}` : "New line") : m.name));
      if (m.id !== -1) name.append(el("span", "ls-name-edit", "✎"));
      name.title = "Rename the line";
      name.setAttribute("aria-label", m.id === -1 ? "New line" : `${m.name}: rename`);
      name.disabled = m.id === -1;
      name.addEventListener("click", (e) => (e.stopPropagation(), this.h.startRename()));
      // (The name and, under it, how its trains are doing: the name has the row's width, two lines if it must. A long
      // name was cut to "Thi…" at 360 px beside the stamp, harden 2026-11-16.)
      const title = el("div", "ls-title");
      title.append(name);
      if (m.id !== -1 && m.trains.length > 0) {
        const pill = el("span", `ls-pill ${m.health}`);
        pill.append(el("i"), m.healthWords);
        title.append(pill);
      }
      head.append(title);
    }
    if (m.id !== -1) {
      const more = this.button("⋯", "ls-more", "More: copy, reverse or delete the line", () => this.h.toggleMenu());
      more.setAttribute("aria-label", "More");
      more.setAttribute("aria-expanded", String(m.menu));
      head.append(more);
    }
    head.append(this.button("Done", "primary route-plan on ls-done", "Done with this line", () => this.h.done()));
    return head;
  }

  private palette(m: SheetModel): HTMLElement {
    const row = el("div", "ls-palette");
    for (const c of m.palettes) {
      const b = el("button", "ls-colour");
      b.style.background = c.colour;
      b.title = c.name;
      b.setAttribute("aria-label", c.name);
      b.setAttribute("aria-pressed", String(c.colour === m.colour));
      b.addEventListener("click", (e) => (e.stopPropagation(), this.h.recolour(c.colour)));
      row.append(b);
    }
    return row;
  }

  private menu(m: SheetModel): HTMLElement {
    const row = el("div", "ls-menu");
    row.append(this.button("Copy", "ls-copy", "A new line with the same stops (no train on it yet)", () => this.h.copy()));
    if (m.stops.length > 1) row.append(this.button("Reverse", "ls-reverse", "Run its stops the other way round", () => this.h.reverse()));
    row.append(this.button("Show", "ls-show", "Show the whole line on the map", () => this.h.show()));
    const del = this.button(m.deleteAsked ? "Delete?" : "Delete", `ls-delete${m.deleteAsked ? " danger" : ""}`, "Delete the line: its trains go anywhere again", () => this.h.remove_line());
    row.append(del);
    if (m.deleteAsked) row.append(el("div", "ls-note warn", `Tap again to delete ${m.name}`));
    return row;
  }

  private diagram(m: SheetModel, body: HTMLElement, foot: HTMLElement): void {
    const list = el("ol", `ls-stops${m.stops.length > 1 ? " pegs" : ""}`);
    list.setAttribute("aria-label", "Stops, in order, and the trains between them");
    m.stops.forEach((st, k) => {
      const rows = [this.stopRow(m, st, k), ...st.vias.map((v, i) => this.viaRow(m, v, k, i))];
      list.append(...rows);
      // (A + on the line after each stop's rows: a place tapped next goes in there. On the last row, so it sits on the
      // line between this stop and the next.)
      if (m.stops.length > 1) rows.at(-1)!.append(this.insertPeg(m, k));
    });
    body.append(list);
    // Its trains on the spine, each before the stop it's heading for (after it, standing there).
    for (const t of m.trains) this.placeTrain(t, m, list);
    if (m.id !== -1) this.addTrains(m, body);
    if (m.stops.length > 1) this.dragRows(list, m);
    const hint = el("div", "ls-hint route-plan-hint", m.hint);
    if (m.stops.length === 0) {
      hint.classList.add("empty");
      body.append(hint);
    } else {
      const via = this.button(m.viaAsked ? "Tap the track…" : "+ Pass by…", `ls-add-via${m.viaAsked ? " on" : ""}`, "Go by a place or some track without stopping: then tap it on the map", () => this.h.askVia());
      via.setAttribute("aria-pressed", String(m.viaAsked));
      foot.append(hint, via);
    }
    for (const n of m.notes) body.append(el("div", "ls-note", n));
    for (const w of m.warnings) body.append(el("div", "ls-note warn", w));
    if (m.added) {
      const added = el("div", "ls-added");
      added.setAttribute("role", "status");
      added.append(el("span", "ls-added-text", m.added.text));
      if (m.added.toEnd) added.append(this.button("Move to end", "ls-added-end", "Put it at the end of the line instead", () => this.h.addedToEnd()));
      added.append(this.button("Undo", "ls-added-undo", "Take it off again", () => this.h.addedUndo()));
      this.addedRow = added;
    }
  }

  /** The row saying where a place just tapped went (shown above the foot), or null. */
  private addedRow: HTMLElement | null = null;

  /** The + on the line after stop `k`: a peg to tap, then a place on the map goes in there. */
  private insertPeg(m: SheetModel, k: number): HTMLElement {
    const on = m.insertAt === k + 1;
    const last = k === m.stops.length - 1;
    const b = el("button", `ls-insert${on ? " on" : ""}${last ? " last" : ""}`);
    b.dataset.after = String(k);
    b.setAttribute("aria-pressed", String(on));
    const here = last ? `at the end, after ${m.stops[k].name}` : `between ${m.stops[k].name} and ${m.stops[k + 1].name}`;
    b.setAttribute("aria-label", `Add a stop ${here}`);
    b.title = on ? "Now tap a place on the map (tap + again: not here)" : `Add a stop ${here}`;
    const peg = el("span", "ls-insert-peg", "+");
    peg.setAttribute("aria-hidden", "true");
    b.append(peg);
    b.addEventListener("click", (e) => (e.stopPropagation(), this.h.insert(k)));
    return b;
  }

  private stopRow(m: SheetModel, st: SheetStop, k: number): HTMLElement {
    const open = m.open === k;
    const li = el("li", `ls-stop${open ? " open" : ""}${st.lost ? " lost" : ""}${st.next ? " next" : ""}${m.added?.k === k ? " added" : ""}`);
    li.dataset.stop = String(k);
    const handle = el("span", "ls-handle", "⠿");
    handle.setAttribute("aria-hidden", "true");
    handle.title = "Hold and drag to move this stop";
    const num = el("span", "ls-num", `${k + 1}`);
    const main = el("button", "ls-stop-main");
    main.setAttribute("aria-expanded", String(open));
    main.title = open ? "Close this stop" : "This stop's options";
    const name = el("span", "ls-stop-name", st.name);
    if (st.placeNum) name.append(el("span", "ls-place-num", ` ${st.placeNum}`));
    if (!st.drop || !st.pick) name.append(el("span", "ls-tag", st.drop ? "drop only" : "pick up only"));
    if (st.waitFill) name.append(el("span", "ls-tag wait", "⏳ fills up"));
    const goods = el("span", "ls-goods");
    if (st.drops.length) goods.append(el("span", "ls-down", `⬇ ${st.drops.join(", ")}`));
    if (st.picks.length) goods.append(el("span", "ls-up", `⬆ ${st.picks.join(", ")}`));
    if (!st.drops.length && !st.picks.length) goods.append(el("span", "ls-none", st.lost ? "Taken up" : "Nothing to move here yet"));
    main.append(name, goods);
    main.addEventListener("click", (e) => (e.stopPropagation(), this.h.open(k)));
    li.append(handle, num, main);
    if (!open) return li;
    const opts = el("div", "ls-opts");
    if (st.sentences.length) {
      const says = el("div", "ls-says");
      for (const s of st.sentences) says.append(el("div", "", s));
      opts.append(says);
    }
    const tick = (text: string, on: boolean, cls: string, tip: string, fn: () => void) => {
      const b = this.button("", `ls-tick ${cls}${on ? " on" : ""}`, tip, fn);
      b.setAttribute("aria-pressed", String(on));
      // (The ✓ is drawn by CSS: the button's words are only its name, its state is aria-pressed.)
      const box = el("span", "ls-box");
      box.setAttribute("aria-hidden", "true");
      b.append(box, text);
      return b;
    };
    const row = el("div", "ls-ticks");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "What the train does here");
    row.append(
      tick("Drop", st.drop, "ls-drop", "Drop goods off here", () => this.h.ticks(k, !st.drop, st.pick)),
      tick("Pick up", st.pick, "ls-pick", "Pick goods up here", () => this.h.ticks(k, st.drop, !st.pick)),
    );
    if (st.pick) row.append(tick("Wait to fill", st.waitFill, "ls-wait route-wait", "Wait here till the wagons are full (of goods a later stop wants)", () => this.h.wait(k)));
    opts.append(row);
    if (st.note) opts.append(el("div", "ls-note", st.note));
    // (Reordering is the grip's (and ← → with a keyboard); Remove stop a stamp at the end of the row, after a word on
    // passing by. Critique 2026-11-16: ↑ ↓ and Take off fell below the sheet's foot on a phone.)
    const acts = el("div", "ls-acts");
    acts.append(el("div", "ls-note", st.canPass ? "Take both pegs out: it passes by" : "A stop must drop or pick up: pass by needs 3 stops"));
    acts.append(this.button("Remove stop", "ls-remove route-remove", "Take this stop off the line", () => this.h.remove(k)));
    opts.append(acts);
    li.append(opts);
    return li;
  }

  private viaRow(m: SheetModel, v: { name: string; stop: boolean }, k: number, i: number): HTMLElement {
    const open = m.openVia?.k === k && m.openVia.i === i;
    const li = el("li", `ls-via${open ? " open" : ""}`);
    const main = el("button", "ls-stop-main");
    main.append(el("span", "ls-tag pass", "Passes by"), el("span", "ls-via-name", v.name || "this track"));
    main.title = "Goes this way, no stop: tap for options";
    main.addEventListener("click", (e) => (e.stopPropagation(), this.h.openVia(k, i)));
    li.append(el("span", "ls-handle none"), el("span", "ls-via-dot"), main);
    if (open) {
      const acts = el("div", "ls-acts");
      if (v.stop) acts.append(this.button("Stop here", "ls-via-stop", "Make it a stop", () => this.h.viaStop(k, i)));
      acts.append(this.button("Take off", "ls-via-remove route-remove", "Take this off the way", () => this.h.viaRemove(k, i)));
      li.append(acts);
    }
    return li;
  }

  /** A stop's handle held and dragged up or down: a bar shows where it goes; let go, it moves there. */
  private dragRows(list: HTMLElement, m: SheetModel): void {
    list.addEventListener("pointerdown", (e) => {
      const handle = (e.target as HTMLElement).closest<HTMLElement>(".ls-handle:not(.none)");
      if (!handle) return;
      const row = handle.closest<HTMLElement>(".ls-stop");
      if (!row) return;
      e.preventDefault();
      const from = Number(row.dataset.stop);
      const rows = [...list.querySelectorAll<HTMLElement>(".ls-stop")];
      const mids = rows.map((r) => {
        const b = r.getBoundingClientRect();
        return b.top + b.height / 2;
      });
      const top = row.getBoundingClientRect().top;
      const y0 = e.clientY;
      const bar = el("div", "ls-drop-bar");
      list.append(bar);
      const listTop = list.getBoundingClientRect().top;
      this.dragging = true;
      row.classList.add("lifted");
      handle.setPointerCapture?.(e.pointerId);
      let slot = from;
      const moveTo = (y: number) => {
        row.style.transform = `translateY(${y - y0}px)`;
        slot = mids.filter((mid) => mid < y).length;
        const at = slot < rows.length ? rows[slot].getBoundingClientRect().top - listTop : rows.at(-1)!.getBoundingClientRect().bottom - listTop;
        bar.style.top = `${at - 2}px`;
      };
      moveTo(top + (e.clientY - top));
      const move = (ev: PointerEvent) => moveTo(ev.clientY);
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        this.dragging = false;
        bar.remove();
        row.classList.remove("lifted");
        row.style.transform = "";
        const to = slot > from ? slot - 1 : slot;
        this.shownKey = "";
        if (to !== from) this.h.move(from, to);
        else this.show(JSON.parse(JSON.stringify(m)) as SheetModel);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
  }

  /** A train's row on the spine: its engine as a token on the line, its name and what it's doing; opened, Show and Take off line. */
  private trainRow(m: SheetModel, t: SheetTrain): HTMLElement {
    const open = m.trainOpen === t.engine;
    const li = el("li", `ls-train ${t.health}${open ? " open" : ""}`);
    li.dataset.engine = String(t.engine);
    const token = el("span", "ls-train-token");
    token.setAttribute("aria-hidden", "true");
    const main = el("button", "ls-train-main");
    main.setAttribute("aria-expanded", String(open));
    main.title = open ? "Close" : `${t.name}: show it, or take it off this line`;
    main.append(el("b", "ls-train-name", t.name), el("span", "ls-train-status", t.status));
    main.addEventListener("click", (e) => (e.stopPropagation(), this.h.openTrain(t.engine)));
    li.append(el("span", "ls-handle none"), token, main);
    // (Waiting or stuck: Show at once, to see why. Else in its opened row.)
    const show = () => this.button("Show", "ls-train-show", `Show ${t.name} on the map`, () => this.h.showTrain(t.engine));
    if (t.health !== "moving" && !open) li.append(show());
    if (open) {
      const acts = el("div", "ls-acts");
      acts.append(show(), this.button("Take off line", "ls-train-off", `Take ${t.name} off this line: it stops and is run by hand`, () => this.h.takeOff(t.engine)));
      li.append(acts);
    }
    return li;
  }

  /**
   * Put a train's row where it is on the spine (made, the first time: `m`), and say what it's doing: before the stop
   * it's heading for, or after it (and its via rows) standing there. Moved and said in place as it runs: the sheet
   * isn't built again for it.
   */
  private placeTrain(t: SheetTrain, m?: SheetModel, into?: HTMLElement): void {
    const list = into ?? this.root.querySelector<HTMLElement>(".ls-stops");
    if (!list) return;
    let li = list.querySelector<HTMLElement>(`.ls-train[data-engine="${t.engine}"]`);
    if (!li) {
      if (!m || t.heading < 0) return;
      li = this.trainRow(m, t);
    } else {
      const status = li.querySelector<HTMLElement>(".ls-train-status");
      if (status && status.textContent !== t.status) status.textContent = t.status;
      for (const h of ["moving", "waiting", "stuck"] as const) li.classList.toggle(h, t.health === h);
    }
    const stop = list.querySelector<HTMLElement>(`.ls-stop[data-stop="${t.heading}"]`);
    if (!stop) return li.remove();
    let at: Element | null = stop;
    if (t.here) {
      // (After its stop and that stop's via rows, ahead of the trains already standing there.)
      at = stop.nextElementSibling;
      while (at && at.classList.contains("ls-via")) at = at.nextElementSibling;
      while (at && at.classList.contains("ls-train") && at !== li && at.classList.contains("here")) at = at.nextElementSibling;
    }
    li.classList.toggle("here", t.here);
    if (li.nextElementSibling !== at || li.parentElement !== list) list.insertBefore(li, at);
  }

  /** Under the spine: free trains to put on the line (or why none), and what it carries. */
  private addTrains(m: SheetModel, body: HTMLElement): void {
    const box = el("div", "ls-add");
    box.append(el("div", "ls-h", m.trains.length === 0 ? "No train runs it yet: add one" : "Add a train"));
    if (m.free.length === 0) box.append(el("div", "ls-note", "No free train can reach this line. Put an engine on its track (the tray's Trains tab), then add it here."));
    const free = el("div", "ls-free");
    for (const f of m.free) {
      const b = this.button("", "ls-add-train", `Put ${f.name} on this line`, () => this.h.addTrain(f.engine));
      b.dataset.engine = String(f.engine);
      b.append(el("b", "", `+ ${f.name}`), el("span", "", ` · ${f.where}`));
      free.append(b);
    }
    if (m.free.length > 0) box.append(free);
    body.append(box);
    if (m.carries) body.append(el("div", "ls-carries", m.carries));
  }
}
