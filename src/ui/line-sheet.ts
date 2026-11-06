/**
 * The line sheet (routes UX, option B, 2026-11-06): one line, run by trains or by none, at the bottom of the screen.
 * Two tabs: Stops, a vertical line diagram (the line's colour as a spine, each stop's number, name and the goods it
 * drops and picks up), and Trains (the trains on it, and free trains to add). A stop tapped opens in place: what moves
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
  tab: "stops" | "trains";
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
  /** "+ Pass by…" asked: the next track tapped is passed by. */
  viaAsked: boolean;
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
  tab(t: "stops" | "trains"): void;
  open(k: number): void;
  openVia(k: number, i: number): void;
  ticks(k: number, drop: boolean, pick: boolean): void;
  wait(k: number): void;
  move(k: number, to: number): void;
  remove(k: number): void;
  viaStop(k: number, i: number): void;
  viaRemove(k: number, i: number): void;
  askVia(): void;
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

  constructor(
    parent: HTMLElement,
    private readonly h: SheetHandlers,
  ) {
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Line");
    // (Taps on the sheet are the sheet's, not the map's below it.)
    this.root.addEventListener("pointerdown", (e) => e.stopPropagation());
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
    // Only the trains' doings changed (they run on): those words updated in place, not the sheet built again, so a tap
    // on a button isn't lost to a rebuild under the finger.
    if (this.shownKey !== "" && this.shape(key) === this.shape(this.shownKey)) {
      this.shownKey = key;
      for (const t of m.trains) {
        const status = this.root.querySelector<HTMLElement>(`.ls-train[data-engine="${t.engine}"] .ls-train-status`);
        if (status && status.textContent !== t.status) status.textContent = t.status;
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
    if (m.id !== -1) this.root.append(this.tabs(m));
    const body = el("div", "ls-body");
    if (m.tab === "stops" || m.id === -1) this.stopsTab(m, body);
    else this.trainsTab(m, body);
    this.root.append(body);
    if (sameLine) body.scrollTop = scroll;
    // The open stop (else the last, just added while planning) scrolled into the sheet's view.
    const target = body.querySelector<HTMLElement>(".ls-stop.open, .ls-via.open");
    // (Its top: an open stop can be taller than the sheet, and its name says which it is.)
    if (target) requestAnimationFrame(() => target.isConnected && target.scrollIntoView({ block: target.offsetHeight > body.clientHeight ? "start" : "nearest" }));
  }

  /** A model's key without what changes as trains run (statuses, where free trains are, loads): its shape. */
  private shape(key: string): string {
    const m = JSON.parse(key) as SheetModel;
    return JSON.stringify({ ...m, trains: m.trains.map((t) => t.engine), free: m.free.map((f) => f.engine), carries: !!m.carries, health: m.health });
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
      head.append(name);
    }
    if (m.id !== -1 && m.trains.length > 0) {
      const pill = el("span", `ls-pill ${m.health}`);
      pill.append(el("i"), m.healthWords);
      head.append(pill);
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

  private tabs(m: SheetModel): HTMLElement {
    const tabs = el("div", "ls-tabs");
    tabs.setAttribute("role", "tablist");
    const tab = (t: "stops" | "trains", text: string) => {
      const b = el("button", `ls-tab${m.tab === t ? " on" : ""}`, text);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(m.tab === t));
      b.dataset.tab = t;
      b.addEventListener("click", (e) => (e.stopPropagation(), this.h.tab(t)));
      return b;
    };
    tabs.append(tab("stops", `Stops · ${m.stops.length}`), tab("trains", `Trains · ${m.trains.length}`));
    return tabs;
  }

  private stopsTab(m: SheetModel, body: HTMLElement): void {
    const list = el("ol", "ls-stops");
    list.setAttribute("aria-label", "Stops, in order");
    m.stops.forEach((st, k) => {
      list.append(this.stopRow(m, st, k));
      st.vias.forEach((v, i) => list.append(this.viaRow(m, v, k, i)));
    });
    body.append(list);
    if (m.stops.length > 1) this.dragRows(list, m);
    const tools = el("div", "ls-tools");
    if (m.stops.length > 0) {
      const via = this.button(m.viaAsked ? "Tap the track…" : "+ Pass by…", `ls-add-via${m.viaAsked ? " on" : ""}`, "Go by a place or some track without stopping: then tap it on the map", () => this.h.askVia());
      via.setAttribute("aria-pressed", String(m.viaAsked));
      tools.append(via);
    }
    const hint = el("div", "ls-hint route-plan-hint", m.hint);
    if (m.stops.length === 0) hint.classList.add("empty");
    body.append(...(m.stops.length === 0 ? [hint] : [hint, tools]));
    for (const w of m.warnings) body.append(el("div", "ls-note warn", w));
  }

  private stopRow(m: SheetModel, st: SheetStop, k: number): HTMLElement {
    const open = m.open === k;
    const li = el("li", `ls-stop${open ? " open" : ""}${st.lost ? " lost" : ""}${st.next ? " next" : ""}`);
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
    opts.append(el("div", "ls-note", st.canPass ? "Untick both: the train passes by without stopping" : "A stop must drop or pick up (pass by needs 3 stops)"));
    if (st.note) opts.append(el("div", "ls-note", st.note));
    const acts = el("div", "ls-acts");
    const up = this.button("↑", "ls-up-btn route-move", "Move this stop earlier", () => this.h.move(k, k - 1));
    up.setAttribute("aria-label", "Move earlier");
    up.disabled = k === 0;
    const down = this.button("↓", "ls-down-btn route-move", "Move this stop later", () => this.h.move(k, k + 1));
    down.setAttribute("aria-label", "Move later");
    down.disabled = k === m.stops.length - 1;
    const remove = this.button("Take off", "ls-remove route-remove", "Take this stop off the line", () => this.h.remove(k));
    if (m.stops.length > 1) acts.append(up, down);
    acts.append(remove);
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

  private trainsTab(m: SheetModel, body: HTMLElement): void {
    if (m.trains.length === 0) body.append(el("div", "ls-empty", "No train runs this line yet"));
    const list = el("ul", "ls-trains");
    for (const t of m.trains) {
      const li = el("li", "ls-train");
      li.dataset.engine = String(t.engine);
      const text = el("div", "ls-train-text");
      text.append(el("b", "", t.name), el("span", "ls-train-status", t.status));
      const show = this.button("Show", "ls-train-show", `Show ${t.name} on the map`, () => this.h.showTrain(t.engine));
      const off = this.button("Take off", "ls-train-off", `Take ${t.name} off this line: it goes anywhere again`, () => this.h.takeOff(t.engine));
      li.append(text, show, off);
      list.append(li);
    }
    if (m.trains.length > 0) body.append(list);
    body.append(el("div", "ls-h", "Add a train"));
    if (m.free.length === 0) body.append(el("div", "ls-note", "No free train can reach this line. Put an engine on its track (the Trains tab), then add it here."));
    const free = el("div", "ls-free");
    for (const f of m.free) {
      const b = this.button("", "ls-add-train", `Put ${f.name} on this line`, () => this.h.addTrain(f.engine));
      b.dataset.engine = String(f.engine);
      b.append(el("b", "", `+ ${f.name}`), el("span", "", ` · ${f.where}`));
      free.append(b);
    }
    body.append(free);
    if (m.carries) body.append(el("div", "ls-carries", m.carries));
  }
}
