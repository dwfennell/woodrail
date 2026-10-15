/** One blueprint, as a station on the line map. */
export interface Station {
  id: string;
  label: string;
  blurb: string;
  /** What it lets you make: a name and a small picture (SVG) each. */
  makes: { label: string; icon: string }[];
  /**
   * learned: painted. offered: a town that grew offers it, free. ready: on the board, to learn with planks.
   * locked: later (needs another blueprint first, or waits for a town to offer it).
   */
  state: "learned" | "offered" | "ready" | "locked";
  /** Blueprints to learn first: the track leading to this station. */
  needs: string[];
  /** For `ready`: "6 planks", how many planks, and can it be paid for now. */
  cost?: string;
  planks?: number;
  affordable?: boolean;
  /** For `offered`: which offer (to choose it). */
  offer?: number;
  /** For `locked`: what it waits for. */
  waits?: string;
}

export interface BoardView {
  stations: Station[];
  /** Choices from towns that grew: pick one of each pair, free. */
  offers: { from: string; ids: string[]; crate?: string }[];
  /** Planks in the workshop's yard (or null: no workshop yet). */
  planks: number | null;
  /** "The workshop's yard has 7 planks" (or how to get one). */
  stock: string;
}

export interface BlueprintBoardHandlers {
  choose(offer: number, id: string): void;
  /** Take an offer's crate instead of a blueprint. */
  crate(offer: number): void;
  learn(id: string): void;
  close(): void;
}

/** Grid placement of the stations: a terminus (the workshop) with a line out to each first blueprint. */
interface Placed {
  station: Station;
  col: number;
  row: number;
}

/**
 * Lay the blueprints out as a railway: each first blueprint (needing nothing) on its own line off the workshop's
 * trunk; a blueprint that needs another follows it along its line (the first such) or branches off below it.
 */
export function layoutLines(stations: readonly Station[]): Placed[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const children = new Map<string, Station[]>();
  for (const s of stations) {
    const parent = s.needs.find((n) => byId.has(n));
    if (!parent) continue;
    let list = children.get(parent);
    if (!list) children.set(parent, (list = []));
    list.push(s);
  }
  const out: Placed[] = [];
  let nextRow = 0;
  const place = (s: Station, col: number, row: number) => {
    out.push({ station: s, col, row });
    (children.get(s.id) ?? []).forEach((c, i) => place(c, col + 1, i === 0 ? row : nextRow++));
  };
  for (const s of stations) {
    if (s.needs.some((n) => byId.has(n))) continue;
    place(s, 1, nextRow++);
  }
  return out;
}

/** Each line of the map is this tall (px), its stations' dots this far down it: the track is drawn through the dots. */
const ROW_H = 86;
const DOT_Y = 24;

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The blueprint board (Game mode), drawn as a line map: the workshop at the head of the line, each blueprint a
 * station, and what a blueprint needs first the track leading to it. Painted stations are learned, lit ones can be
 * learned now (gold: free, a town's choice), pencilled ones come later. Tapping a station opens its ticket: what it
 * makes, what it costs against the planks in the yard, and Learn. Rebuilt only when what it shows changed.
 */
export class BlueprintBoard {
  readonly root = document.createElement("div");
  private readonly body = document.createElement("div");
  private shownKey = "";
  private view: BoardView | null = null;
  /** The station whose ticket is showing. */
  private selected = "";

  constructor(parent: HTMLElement, handlers: BlueprintBoardHandlers) {
    this.root.className = "board-panel";
    this.root.hidden = true;
    const head = document.createElement("div");
    head.className = "board-head";
    head.innerHTML = `<h2>Blueprints</h2><span class="board-sub">Learn a station to make its pieces</span>`;
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "✕";
    close.title = "Close";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.close();
    });
    head.appendChild(close);
    this.body.className = "board-body";
    this.root.append(head, this.body);
    this.body.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!b || (b as HTMLButtonElement).disabled) return;
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === "select") {
        this.selected = b.dataset.id!;
        this.render();
      } else if (act === "choose") handlers.choose(Number(b.dataset.offer), b.dataset.id!);
      else if (act === "crate") handlers.crate(Number(b.dataset.offer));
      else if (act === "learn") handlers.learn(b.dataset.id!);
    });
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (!open) {
      this.shownKey = "";
      this.selected = "";
    }
  }

  show(v: BoardView): void {
    const key = JSON.stringify(v);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.view = v;
    // Keep the ticket that's showing; else open on what's most worth doing (a free choice, then what can be paid).
    if (!v.stations.some((s) => s.id === this.selected)) {
      const pick = v.stations.find((s) => s.state === "offered") ?? v.stations.find((s) => s.state === "ready" && s.affordable) ?? v.stations.find((s) => s.state === "ready") ?? v.stations[0];
      this.selected = pick?.id ?? "";
    }
    this.render();
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    const placed = layoutLines(v.stations);
    const rows = Math.max(1, ...placed.map((p) => p.row + 1));
    const cols = Math.max(2, ...placed.map((p) => p.col + 1));
    const at = new Map(placed.map((p) => [p.station.id, p]));
    // Across, the track layer's 0–100 box stretches to the map's width; down, it's in pixels (the rows' fixed height).
    const cx = (col: number) => ((col + 0.5) / cols) * 100;
    const cy = (row: number) => row * ROW_H + DOT_Y;
    const learned = (id: string) => at.get(id)?.station.state === "learned";

    // The track: the workshop's trunk down the first column, a line out to each first blueprint, and on from each
    // blueprint to those that need it. Track to a learned station is laid (wood); the rest is pencilled.
    let rails = "";
    const segment = (d: string, laid: boolean) => {
      rails += `<path d="${d}" class="bp-rail${laid ? " laid" : ""}" vector-effect="non-scaling-stroke"/>`;
    };
    const roots = placed.filter((p) => p.col === 1);
    if (roots.length > 0) segment(`M${cx(0)} ${cy(0)} V${cy(roots[roots.length - 1].row)}`, roots.some((r) => learned(r.station.id)));
    for (const p of placed) {
      const parent = p.station.needs.map((n) => at.get(n)).find((x) => x);
      const from = parent ? { x: cx(parent.col), y: cy(parent.row) } : { x: cx(0), y: cy(p.row) };
      const to = { x: cx(p.col), y: cy(p.row) };
      const laid = learned(p.station.id);
      if (from.y === to.y) segment(`M${from.x} ${from.y} H${to.x}`, laid);
      else {
        // Branching off: down from the parent a little way along, then on to the station.
        const mid = from.x + (to.x - from.x) * 0.45;
        segment(`M${from.x} ${from.y} H${mid} V${to.y} H${to.x}`, laid);
      }
    }

    const stationHtml = (p: Placed) => {
      const s = p.station;
      const tag = s.state === "offered" ? `<span class="bp-tag free">Free</span>` : s.state === "ready" ? `<span class="bp-tag">${esc(s.cost ?? "")}</span>` : "";
      return `<button class="bp-station ${s.state}${s.state === "ready" && s.affordable ? " can" : ""}${s.id === this.selected ? " selected" : ""}" style="grid-column:${p.col + 1};grid-row:${p.row + 1}" data-act="select" data-id="${s.id}" aria-label="${esc(s.label)}"><span class="bp-dot">${s.state === "learned" ? "✓" : ""}</span><span class="bp-name">${esc(s.label)}</span>${tag}</button>`;
    };
    const workshop = `<div class="bp-station terminus" style="grid-column:1;grid-row:1"><span class="bp-dot">🚂</span><span class="bp-name">Your workshop</span></div>`;

    let html = "";
    // A town's choice, at the top: it's free, and the other goes on the board.
    v.offers.forEach((o, k) => {
      const choices = o.ids
        .map((id) => at.get(id)?.station)
        .filter((s): s is Station => !!s)
        .map((s) => `<button class="chip text primary" data-act="choose" data-offer="${k}" data-id="${s.id}">${esc(s.label)}</button>`);
      // Or a crate of things for the toy box (the blueprints then wait on the board).
      if (o.crate) choices.push(`<button class="chip text bp-crate" data-act="crate" data-offer="${k}" title="Into your toy box; the blueprints go on the board">📦 ${esc(o.crate)}</button>`);
      const buttons = choices.join(`<span class="or">or</span>`);
      const ask = o.crate ? (o.ids.length > 0 ? "Learn one free, or take a crate:" : "Take a crate:") : "Learn one free:";
      const said = o.from.endsWith(" school") ? "has an idea!" : "grew!";
      html += `<div class="bp-offer"><span>${esc(o.from)} ${said} ${ask}</span><span class="bp-offer-row">${buttons}</span></div>`;
    });
    html += `<div class="bp-map" style="grid-template-columns:repeat(${cols},1fr);grid-template-rows:repeat(${rows},${ROW_H}px)"><svg class="bp-track" viewBox="0 0 100 ${rows * ROW_H}" preserveAspectRatio="none" style="height:${rows * ROW_H}px" aria-hidden="true">${rails}</svg>${workshop}${placed.map(stationHtml).join("")}</div>`;
    html += `<div class="bp-legend"><span class="bp-key learned"></span>Learned<span class="bp-key ready"></span>Learn with planks<span class="bp-key offered"></span>Free choice<span class="bp-key locked"></span>Later</div>`;
    const s = at.get(this.selected)?.station;
    if (s) html += this.ticket(s, v);
    this.body.innerHTML = html;
  }

  /** The ticket for a station: what it is, what it makes, and how to get it. */
  private ticket(s: Station, v: BoardView): string {
    const makes = s.makes.map((m) => `<span class="bp-make">${m.icon}<span>${esc(m.label)}</span></span>`).join("");
    let foot = "";
    if (s.state === "learned") foot = `<span class="bp-done">Learned: make these at the workshop</span>`;
    else if (s.state === "offered") foot = `<button class="chip text primary" data-act="choose" data-offer="${s.offer}" data-id="${s.id}">Learn free</button>`;
    else if (s.state === "ready") {
      const have = v.planks ?? 0;
      const need = s.planks ?? 0;
      const gauge =
        v.planks === null
          ? `<span class="bp-gauge-text">${esc(v.stock)}</span>`
          : `<span class="bp-gauge"><span class="bp-gauge-fill" style="width:${Math.min(100, need > 0 ? (have / need) * 100 : 100)}%"></span></span><span class="bp-gauge-text">${Math.min(have, need)} of ${need} planks in the yard</span>`;
      foot = `<span class="bp-cost">${gauge}</span><button class="chip text${s.affordable ? " primary" : ""}" data-act="learn" data-id="${s.id}" ${s.affordable ? "" : "disabled"}>Learn · ${esc(s.cost ?? "")}</button>`;
    } else foot = `<span class="bp-waits">${esc(s.waits ?? "Later")}</span>`;
    return `<div class="bp-ticket ${s.state}"><div class="bp-ticket-head"><b>${esc(s.label)}</b><span>${esc(s.blurb)}</span></div><div class="bp-makes">${makes}</div><div class="bp-ticket-foot">${foot}</div></div>`;
  }
}
