import type { CardState, ResearchCardView } from "../game/research-text";

/** One blueprint, as a tag on the board's web. */
export interface Station {
  id: string;
  label: string;
  blurb: string;
  /** Its branch (a band of the web). */
  branch: string;
  /**
   * What it lets you make: a name and a small picture (SVG) each, and the key of its tray picture (`piece:<type>`,
   * `prop:<asset>`) shown instead once there is one (see `BlueprintBoardHandlers.picture`).
   */
  makes: { label: string; icon: string; picture?: string }[];
  /**
   * learned: painted. researching: under way at the schools. next: up next. ready: can be picked for research now.
   * locked: later (needs another blueprint first, or something done). soon: not in the game yet.
   */
  state: CardState;
  /** How much of it a player sees: all of it, a "?" (it's next to something they know), or nothing yet. */
  seen: "shown" | "hint" | "unseen";
  /** Blueprints to learn first. */
  needs: string[];
  /** What researching it takes, in a few words ("10🪵 20🪙"), or "free". */
  price: string;
  /** For researching, next and ready: its goods chips, study time, how it stands and its one button. */
  research?: ResearchCardView;
  /** The current goal asks for it (its card's button is lit for the goal). */
  goal?: boolean;
  /** What must be done first, in words, and whether it is. */
  requires: { text: string; met: boolean }[];
  /** For `locked`: what it waits for. For `soon`: when (next, coming soon, someday). */
  waits?: string;
}

export interface BoardView {
  stations: Station[];
  /** The web's bands, in order. */
  branches: { id: string; label: string; color: string }[];
  /** Choices from towns that grew: pick one of each pair, free (until the growth menu, P3). */
  offers: { from: string; ids: string[]; crate?: string }[];
  /** The card to open on when the picker opens (the current goal's research), if any. */
  focus?: string;
}

export interface BlueprintBoardHandlers {
  choose(offer: number, id: string): void;
  /** Take an offer's crate instead of a blueprint. */
  crate(offer: number): void;
  /** Pick it for research: it starts if nothing is under way, else waits up next (the one up next: the two swap). */
  pick(id: string): void;
  close(): void;
  /** A thing's tray picture (an image URL) by its key, if drawn. */
  picture?(key: string): string | undefined;
  /**
   * The ticket shows things whose pictures aren't drawn yet (their SVG stands in): draw them if they can be (a kit's,
   * a prop's or a car's model), first, calling `pictureCame` with each as it comes. Each call replaces the last: the
   * ticket showing's (none, [], once it's left or the board's shut).
   */
  needPictures?(keys: string[]): void;
}

/** Where a tag goes on the web (px from the web's top left), and where each band starts. */
export interface WebLayout {
  at: Map<string, { x: number; y: number }>;
  bands: { id: string; top: number; height: number }[];
  width: number;
  height: number;
}

/** Tag size and spacing on the web (px). */
export const TAG_W = 148;
const COL_W = 176;
const ROW_H = 62;
const BAND_PAD = 10;
const LABEL_W = 92;

/**
 * Lay out the web: each blueprint one column right of its furthest prerequisite (among those drawn), each branch a band
 * across the web, and within a band's column the tags ordered by where their prerequisites sit (a few sweeps), so lines
 * mostly run straight. Bands with nothing drawn take no room. Pure: the board draws from it, tests check it.
 */
export function layoutWeb(stations: readonly Station[], branches: readonly string[]): WebLayout {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const depth = new Map<string, number>();
  const depthOf = (s: Station): number => {
    let d = depth.get(s.id);
    if (d === undefined) {
      depth.set(s.id, 0); // (a guard against loops in bad data)
      d = 1 + Math.max(0, ...s.needs.map((n) => byId.get(n)).filter((x): x is Station => !!x).map(depthOf));
      depth.set(s.id, d);
    }
    return d;
  };
  stations.forEach(depthOf);
  const cells = new Map<string, Station[]>();
  for (const s of stations) {
    const key = `${s.branch}:${depth.get(s.id)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(s);
  }
  const cols = Math.max(1, ...depth.values());
  const order = new Map(stations.map((s, k) => [s.id, k]));
  const y = new Map<string, number>();
  let bands: WebLayout["bands"] = [];
  let height = 0;
  const place = () => {
    bands = [];
    let top = 0;
    for (const b of branches) {
      let rows = 0;
      for (let c = 1; c <= cols; c++) {
        const list = cells.get(`${b}:${c}`) ?? [];
        list.forEach((s, r) => y.set(s.id, top + BAND_PAD + r * ROW_H));
        rows = Math.max(rows, list.length);
      }
      if (rows === 0) continue;
      const h = BAND_PAD * 2 + rows * ROW_H;
      bands.push({ id: b, top, height: h });
      top += h;
    }
    height = top;
  };
  place();
  const kids = new Map<string, Station[]>();
  for (const s of stations) for (const n of s.needs) if (byId.has(n)) kids.set(n, [...(kids.get(n) ?? []), s]);
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const list of cells.values()) {
      const key = (s: Station) => {
        const ps = s.needs.filter((n) => y.has(n)).map((n) => y.get(n)!);
        if (ps.length) return ps.reduce((a, b) => a + b, 0) / ps.length;
        const ks = (kids.get(s.id) ?? []).map((k) => y.get(k.id)!);
        return ks.length ? Math.min(...ks) : 1e6 + order.get(s.id)!;
      };
      list.sort((a, b) => key(a) - key(b) || order.get(a.id)! - order.get(b.id)!);
    }
    place();
  }
  const at = new Map(stations.map((s) => [s.id, { x: LABEL_W + (depth.get(s.id)! - 1) * COL_W, y: y.get(s.id)! }]));
  return { at, bands, width: LABEL_W + (cols - 1) * COL_W + TAG_W + 12, height };
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The Research picker (Game mode), the blueprint board drawn as a web: a band for each branch (track, trains,
 * industry, food…), each blueprint a tag, an arrow from each to what it opens in its branch. Painted tags are learned,
 * the blue one is under way at the schools (another is up next), lit ones can be picked now, plain ones come later,
 * dashed ones are coming soon to the game. A player sees what they know and what's next to it; further on is a "?", and
 * beyond that nothing yet. Tapping a tag opens its ticket: what it brings, its goods and study time, what it needs, and
 * one button (Research, or Next up). Rebuilt only when what it shows changed.
 */
/**
 * What a town's offer says it did: "grew!", or, for its second offer in the list, "grew again!" (two in a row both
 * headed "Larkfield grew!" read as a repeat); a school "has an idea!".
 */
export function offerSaid(offers: readonly { from: string }[], k: number): string {
  const from = offers[k].from;
  const again = offers.slice(0, k).some((o) => o.from === from);
  if (from.endsWith(" school")) return again ? "has another idea!" : "has an idea!";
  return again ? "grew again!" : "grew!";
}

/** The small tag on a card in the web, by its state. */
const NODE_TAG: Partial<Record<CardState, (s: Station) => string>> = {
  researching: () => `<span class="bp-tag now">📘 Researching</span>`,
  next: () => `<span class="bp-tag next">Next up</span>`,
  ready: (s) => `<span class="bp-tag">${esc(s.price)}</span>`,
  soon: () => `<span class="bp-tag soon">Soon</span>`,
};

/**
 * A research card's foot: its goods as chips ("🪵 6/10", the coins red while short) and its study time, a bar for the
 * one under way, how it stands, and its one button (Research, Next up, or Research now to swap), 44 px tall.
 */
export function researchFoot(id: string, r: ResearchCardView, goal: boolean): string {
  const chips = r.chips.map((c) => `<span class="bp-chip${c.short ? " short" : ""}">${esc(c.text)}</span>`).join("") + `<span class="bp-chip study">⏱ ${esc(r.study)}</span>`;
  const bar = r.fill !== undefined ? `<span class="bp-gauge"><span class="bp-gauge-fill" style="width:${Math.round(r.fill * 100)}%"></span></span>` : "";
  const why = r.why ? `<span class="${r.blocked ? "bp-why" : "bp-gauge-text"}">${esc(r.why)}</span>` : "";
  const button = r.action
    ? `<button class="chip text${r.blocked ? "" : " primary"}${goal && !r.blocked ? " bp-goal" : ""}" data-act="pick" data-id="${id}"${r.blocked ? ` aria-disabled="true" title="${esc(r.why ?? "")}"` : ""}>${esc(r.action)}</button>`
    : `<span class="bp-now">📘 Researching</span>`;
  return `<span class="bp-cost"><span class="bp-chips">${chips}</span>${bar}${why}</span>${button}`;
}

export class BlueprintBoard {
  readonly root = document.createElement("div");
  private readonly body = document.createElement("div");
  /** The selected blueprint's ticket: a sheet under the web, always in full view (its Learn button with it). */
  private readonly sheet = document.createElement("div");
  private shownKey = "";
  private view: BoardView | null = null;
  /** The tag whose ticket is showing. */
  private selected = "";
  /** Pictures the ticket showing waits for (`needPictures`), and whether it's to be rebuilt for one that came. */
  private wanted = new Set<string>();
  private redraw = false;

  constructor(parent: HTMLElement, private readonly handlers: BlueprintBoardHandlers) {
    this.root.className = "board-panel";
    this.root.hidden = true;
    const head = document.createElement("div");
    head.className = "board-head";
    head.innerHTML = `<h2>Research</h2><span class="board-sub">Pick one; trains bring its goods to your school</span><details class="bp-legend-box"><summary aria-label="What the colours mean">ⓘ</summary><div class="bp-legend"><span class="bp-key learned"></span>Learned<span class="bp-key researching"></span>Researching<span class="bp-key next"></span>Next up<span class="bp-key ready"></span>Can research<span class="bp-key locked"></span>Later<span class="bp-key soon"></span>Soon<span class="bp-key hint">?</span>Not found yet</div></details>`;
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
    this.sheet.className = "board-sheet";
    this.root.append(head, this.body, this.sheet);
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
      if (!b || (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true") return;
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === "select") {
        this.selected = b.dataset.id!;
        this.render();
      } else if (act === "choose") handlers.choose(Number(b.dataset.offer), b.dataset.id!);
      else if (act === "crate") handlers.crate(Number(b.dataset.offer));
      else if (act === "pick") handlers.pick(b.dataset.id!);
    };
    this.body.addEventListener("click", onClick);
    this.sheet.addEventListener("click", onClick);
    parent.appendChild(this.root);
    // Turning a phone (or resizing a window) across the phone width switches between the web and the lists.
    let wasNarrow = this.narrow();
    window.addEventListener("resize", () => {
      const now = this.narrow();
      if (now === wasNarrow) return;
      wasNarrow = now;
      if (this.open) this.render();
    });
  }

  /** A phone-width panel: the web is shown as lists. */
  private narrow(): boolean {
    return typeof window !== "undefined" && window.matchMedia?.("(max-width: 560px)").matches === true;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (!open) {
      this.shownKey = "";
      this.selected = "";
      // Its pictures not drawn yet aren't waited for any more.
      if (this.wanted.size > 0) {
        this.wanted = new Set();
        this.handlers.needPictures?.([]);
      }
    }
  }

  /** Open on this card ("Show me" for a goal's research): its ticket shows, whatever was showing before. */
  focus(id: string): void {
    this.selected = id;
    if (this.open && this.view) this.render();
  }

  /**
   * A tray picture was drawn: if the ticket showing is waiting for it (`needPictures`), the ticket is rebuilt to show
   * it (once for pictures that come together; the web isn't).
   */
  pictureCame(key: string): void {
    if (!this.open || !this.wanted.has(key) || this.redraw) return;
    this.redraw = true;
    queueMicrotask(() => {
      this.redraw = false;
      if (this.open && this.view) this.renderSheet(this.view);
    });
  }

  show(v: BoardView): void {
    const key = JSON.stringify(v);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.view = v;
    // Keep the ticket that's showing; else open on the goal's research, or the one under way, or one to pick.
    const shown = v.stations.filter((s) => s.seen === "shown");
    if (!shown.some((s) => s.id === this.selected)) {
      const pick = shown.find((s) => s.id === v.focus) ?? shown.find((s) => s.state === "researching") ?? shown.find((s) => s.state === "ready") ?? shown[0];
      this.selected = pick?.id ?? "";
    }
    this.render();
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    const drawn = v.stations.filter((s) => s.seen !== "unseen");
    const byId = new Map(drawn.map((s) => [s.id, s]));
    const web = layoutWeb(drawn, v.branches.map((b) => b.id));
    const color = new Map(v.branches.map((b) => [b.id, b.color]));
    // The selected tag's whole path: what it needs, all the way back, and what it opens.
    const path = new Set<string>([this.selected]);
    const back = (id: string) => {
      for (const n of byId.get(id)?.needs ?? []) if (!path.has(n) && byId.has(n)) (path.add(n), back(n));
    };
    back(this.selected);
    for (const s of drawn) if (s.needs.includes(this.selected)) path.add(s.id);

    let html = "";
    // A town's choice, at the top: it's free, and the other goes on the board.
    v.offers.forEach((o, k) => {
      const choices = o.ids
        .map((id) => v.stations.find((s) => s.id === id))
        .filter((s): s is Station => !!s)
        .map((s) => `<button class="chip text primary" data-act="choose" data-offer="${k}" data-id="${s.id}">${esc(s.label)}</button>`);
      // Or a crate of things for the toy box (the blueprints then wait on the board).
      if (o.crate) choices.push(`<button class="chip text bp-crate" data-act="crate" data-offer="${k}" title="Into your toy box">📦 ${esc(o.crate)}</button>`);
      const buttons = choices.join(`<span class="or">or</span>`);
      const ask = o.crate ? (o.ids.length > 0 ? "Learn one free, or take a crate:" : "Take a crate:") : "Learn one free:";
      const said = offerSaid(v.offers, k);
      html += `<div class="bp-offer"><span>${esc(o.from)} ${said} ${ask}</span><span class="bp-offer-row">${buttons}</span></div>`;
    });

    let svg = `<defs><marker id="bp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="context-stroke"/></marker></defs>`;
    for (const s of drawn) {
      const to = web.at.get(s.id)!;
      for (const n of s.needs) {
        const from = web.at.get(n);
        if (!from) continue;
        const cross = byId.get(n)!.branch !== s.branch;
        const lit = path.has(s.id) && path.has(n);
        // Within a branch, always drawn; across branches, only on the selected path (the ticket names the rest).
        if (cross && !lit) continue;
        const x0 = from.x + TAG_W, y0 = from.y + 22, x1 = to.x - 2, y1 = to.y + 22, dx = Math.max(18, (x1 - x0) / 2);
        const cls = `bp-link${lit ? " lit" : ""}${byId.get(n)!.state === "learned" ? " laid" : ""}`;
        svg += `<path class="${cls}" style="stroke:${color.get(byId.get(n)!.branch)}" marker-end="url(#bp-arrow)" d="M${x0} ${y0} C${x0 + dx} ${y0} ${x1 - dx} ${y1} ${x1} ${y1}"/>`;
      }
    }
    let bands = "";
    web.bands.forEach((b, i) => {
      const br = v.branches.find((x) => x.id === b.id)!;
      bands += `<div class="bp-band${i % 2 ? " alt" : ""}" style="top:${b.top}px;height:${b.height}px"><span class="bp-band-label" style="border-left-color:${br.color}">${esc(br.label)}</span></div>`;
    });
    const node = (s: Station, p: { x: number; y: number } | null) => {
      const hint = s.seen === "hint";
      const tag = hint ? "" : (NODE_TAG[s.state]?.(s) ?? "");
      const cls = `bp-node ${hint ? "hint" : s.state}${s.id === this.selected ? " selected" : ""}`;
      const at = p ? `left:${p.x}px;top:${p.y}px;` : "";
      return `<button class="${cls}" style="${at}--c:${color.get(s.branch)}" data-act="select" data-id="${s.id}" aria-label="${hint ? "Not found yet" : esc(s.label)}"><span class="bp-dot">${s.state === "learned" && !hint ? "✓" : ""}</span><span class="bp-name">${hint ? "?" : esc(s.label)}</span>${tag}</button>`;
    };
    const tags = drawn.map((s) => node(s, web.at.get(s.id)!)).join("");
    if (this.narrow()) {
      // A phone: each branch a list of its tags, earliest first, in columns that fit the width (no sideways
      // scrolling, and only the panel scrolls). A tag's ticket names what it needs.
      for (const b of web.bands) {
        const br = v.branches.find((x) => x.id === b.id)!;
        const mine = drawn.filter((s) => s.branch === b.id).sort((a, c) => web.at.get(a.id)!.x - web.at.get(c.id)!.x || web.at.get(a.id)!.y - web.at.get(c.id)!.y);
        html += `<div class="bp-list-band"><span class="bp-band-label" style="border-left-color:${br.color}">${esc(br.label)}</span><div class="bp-list">${mine.map((s) => node(s, null)).join("")}</div></div>`;
      }
    } else html += `<div class="bp-web-scroll"><div class="bp-web" style="width:${web.width}px;height:${web.height}px">${bands}<svg class="bp-links" width="${web.width}" height="${web.height}" aria-hidden="true">${svg}</svg>${tags}</div></div>`;
    this.renderSheet(v, byId);
    const scroll = this.body.querySelector(".bp-web-scroll");
    const kept = scroll ? { left: scroll.scrollLeft, top: scroll.scrollTop } : null;
    this.body.innerHTML = html;
    // Keep the web where it was scrolled to; on first opening, bring the selected tag into view.
    const pane = this.body.querySelector<HTMLElement>(".bp-web-scroll");
    const sel = this.body.querySelector<HTMLElement>(".bp-node.selected");
    if (pane && kept) {
      pane.scrollLeft = kept.left;
      pane.scrollTop = kept.top;
    } else if (pane && sel) {
      pane.scrollLeft = Math.max(0, sel.offsetLeft - 100);
      pane.scrollTop = Math.max(0, sel.offsetTop - 60);
    }
  }

  /**
   * The ticket under the web (alone when a picture it waits for comes: the web is as it was), and the pictures it
   * waits for asked for (none, so the last ticket's stop being waited for).
   */
  private renderSheet(v: BoardView, byId = new Map(v.stations.filter((s) => s.seen !== "unseen").map((s) => [s.id, s]))): void {
    const s = byId.get(this.selected);
    this.wanted = new Set();
    const sheet = s ? this.ticket(s, v, byId) : "";
    if (this.sheet.innerHTML !== sheet) this.sheet.innerHTML = sheet;
    this.handlers.needPictures?.([...this.wanted]);
  }

  /** The ticket for a tag: what it is, what it brings, what it needs, and how to get it. */
  private ticket(s: Station, v: BoardView, byId: Map<string, Station>): string {
    if (s.seen === "hint") {
      const known = s.needs.map((n) => byId.get(n)).filter((x): x is Station => !!x && x.seen === "shown");
      return `<div class="bp-ticket hint"><div class="bp-ticket-head"><b>Not found yet</b><span>Something new${known.length ? ` after ${esc(known.map((k) => k.label).join(" and "))}` : ""}. Learn what leads to it to see what it is.</span></div></div>`;
    }
    // Each thing as its tray picture (its model) where it's drawn; else its SVG, and the picture asked for.
    const wanted = new Set<string>();
    const makes = s.makes
      .map((m) => {
        const url = m.picture ? this.handlers.picture?.(m.picture) : undefined;
        if (m.picture && !url) wanted.add(m.picture);
        return `<span class="bp-make">${url ? `<img src="${url}" alt="" draggable="false">` : m.icon}<span>${esc(m.label)}</span></span>`;
      })
      .join("");
    this.wanted = wanted;
    // What it needs and what it opens, in words (on a phone the list draws no links between them).
    const needs = s.needs.map((n) => {
      const x = byId.get(n);
      return x ? `${x.label}${x.state === "learned" ? " ✓" : ""}` : "something not found yet";
    });
    const opens = [...byId.values()].filter((x) => x.needs.includes(s.id) && x.seen === "shown").map((x) => x.label);
    const reqs = s.requires.map((r) => `<span class="bp-req${r.met ? " met" : ""}">${r.met ? "✓ " : ""}${esc(r.text)}</span>`).join("");
    let foot = "";
    if (s.state === "learned") foot = `<span class="bp-done">Learned</span>`;
    else if (s.research) foot = researchFoot(s.id, s.research, !!s.goal);
    else foot = `<span class="bp-waits">${esc(s.waits ?? "Later")}</span>`;
    return `<div class="bp-ticket ${s.state}" style="--c:${v.branches.find((b) => b.id === s.branch)?.color ?? "#b8a68c"}"><div class="bp-ticket-head"><b>${esc(s.label)}</b>${s.goal ? `<span class="bp-tag goal">🎯 Goal</span>` : ""}<span>${esc(s.blurb)}</span></div>${makes ? `<div class="bp-makes">${makes}</div>` : ""}<div class="bp-ticket-needs">${needs.length ? `<span>Needs: ${esc(needs.join(" + "))}</span>` : ""}${opens.length ? `<span>Opens: ${esc(opens.slice(0, 2).join(", "))}${opens.length > 2 ? "…" : ""}</span>` : ""}${s.state !== "learned" && ((!s.research && s.price !== "free") || reqs) ? `<span>${!s.research && s.price !== "free" ? `Cost: ${esc(s.price)}` : ""}</span>${reqs}` : ""}</div><div class="bp-ticket-foot">${foot}</div></div>`;
  }
}
