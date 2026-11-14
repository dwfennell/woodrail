import type { TownLedger } from "../game/town-ledger";
import type { TownTab } from "../game/town-next";

/** What the card's rows and buttons do when tapped. */
export interface LedgerActions {
  /** The school's row: its card. */
  school(depotId: number): void;
  /** A line's chip: the Lines view. */
  lines(): void;
  /** A tab picked (the card shows its pane; main keeps it open across redraws). */
  tab(tab: TownTab): void;
  /** A good nothing makes: open the tray at its industry (`piece:depot-…`). */
  findMaker(key: string): void;
  /** Its industry not learned yet: the Research board at that blueprint. */
  research(tech: string): void;
}

/** A tab of the card: its words, and a peg when something's ready there (a project to start, a place to build). */
export interface TownTabView {
  id: TownTab;
  label: string;
  ready: boolean;
}

/** The card's Next up: a maple tile on its tab's pane, with the card's one painted button (if it has one). */
export interface NextUpView {
  tab: TownTab;
  title: string;
  sub: string;
  button?: { label: string; paint: "go" | "blue"; cls: string; act(): void };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A row of the ledger: what it is on the left, a word on it on the right (a button if it goes somewhere). */
function row(name: string, note: string, onTap?: () => void): HTMLElement {
  const r = onTap ? el("button", "ledger-row go") : el("div", "ledger-row");
  if (onTap) {
    (r as HTMLButtonElement).type = "button";
    r.addEventListener("click", onTap);
  }
  // (The arrow kept to the note's last word, never on a line of its own.)
  r.append(el("span", "ledger-row-name", name), el("span", "ledger-row-note", onTap ? `${note}\u00a0›` : note));
  return r;
}

/** The Next up tile: what the town needs most, said plainly, and its button. */
function nextTile(n: NextUpView): HTMLElement {
  const t = el("div", "town-next");
  const k = el("div", "town-next-k");
  k.append(el("i", "town-peg"), document.createTextNode("Next up"));
  const words = el("div", "town-next-t", n.title);
  if (n.sub) words.append(el("small", "town-next-sub", n.sub));
  t.append(k, words);
  if (n.button) {
    const btn = n.button;
    const b = el("button", `chip text town-next-btn ${btn.paint === "go" ? "primary" : "paint-blue"} ${btn.cls}`, btn.label);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      btn.act();
    });
    t.append(b);
  }
  return t;
}

/** A good nothing makes, as a row with its way to get one: Find a mill ›, or Show in Research › (or words alone). */
function needRow(v: TownLedger, on: LedgerActions): HTMLElement {
  const r = el("div", "ledger-holding");
  const m = v.missing;
  r.append(el("p", "ledger-holding-t", v.holding ?? ""));
  if (m) {
    const b = el("button", "chip text ledger-holding-btn", m.tech ? `Learn ${m.techName} ›` : `Find a ${m.makerName.toLowerCase()} ›`);
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (m.tech) on.research(m.tech);
      else on.findMaker(m.maker);
    });
    r.append(b);
  }
  return r;
}

/**
 * Draw a town's card (see `game/town-ledger.ts`) into `box`, replacing what was there: a header (its level, and its
 * goods toward the next), a groove of tabs, and a pane for each tab, only `tab`'s showing. Grow (its goods, what holds
 * it back, what it always buys) and Station (school, market, road, post and station rows, its lines) are drawn here;
 * Build and Projects are left empty for main (places, treats and grand projects), and so is the rest of Station (New
 * route, the upgrades). The Next up tile goes first on its tab's pane. Called only when the card's key changes; a
 * tab's tap only shows its pane.
 */
export function drawLedger(box: HTMLElement, v: TownLedger, tabs: readonly TownTabView[], tab: TownTab, next: NextUpView | null, on: LedgerActions): Record<TownTab, HTMLElement> {
  box.innerHTML = "";
  box.classList.add("ledger", "town-card");
  box.dataset.tab = tab;

  const head = el("div", "ledger-head town-head");
  // A city grows on into a bigger one (City ★, City ★★…): say that, not the stars.
  const grow = v.next.includes("★") ? "grow bigger" : `become a ${v.next.toLowerCase()}`;
  head.append(el("span", "ledger-level", v.level), el("span", "ledger-growing", `${v.have} of ${v.need} goods to ${grow}`));
  const total = el("div", "ledger-bar total");
  const fill = el("div", "ledger-fill");
  fill.style.width = `${Math.round((100 * v.have) / Math.max(1, v.need))}%`;
  total.append(fill);
  box.append(head, total);

  // The tabs: a groove with a maple block slid to the open one (as the Journal's and the line sheet's).
  const groove = el("div", "town-tabs");
  groove.setAttribute("role", "tablist");
  const panes = {} as Record<TownTab, HTMLElement>;
  const show = (t: TownTab) => {
    box.dataset.tab = t;
    for (const b of groove.children) {
      const on = (b as HTMLElement).dataset.tab === t;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    }
    for (const [id, pane] of Object.entries(panes)) pane.hidden = id !== t;
  };
  for (const t of tabs) {
    const b = el("button", "town-tab", t.label);
    b.type = "button";
    b.dataset.tab = t.id;
    b.setAttribute("role", "tab");
    if (t.ready) {
      const peg = el("i", "town-peg");
      peg.title = "Something's ready here";
      b.append(peg);
    }
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      show(t.id);
      on.tab(t.id);
    });
    groove.append(b);
  }
  box.append(groove);
  for (const t of tabs) {
    const pane = el("div", `town-pane town-pane-${t.id}`);
    pane.dataset.pane = t.id;
    pane.setAttribute("role", "tabpanel");
    panes[t.id] = pane;
    box.append(pane);
  }
  if (next && panes[next.tab]) panes[next.tab].append(nextTile(next));

  // Grow: a bar for each good it needs, over the wagon that brings it; what holds it back; what it always buys.
  const g = panes.grow;
  const goods = el("div", "ledger-goods");
  for (const good of v.goods) {
    const done = good.have >= good.need;
    const r = el("div", `ledger-good${done ? " done" : ""}`);
    const bar = el("div", "ledger-bar");
    const f = el("div", "ledger-fill");
    f.style.width = `${Math.round((100 * good.have) / Math.max(1, good.need))}%`;
    bar.append(f);
    // (Its bar over the wagon that brings it, small: "🚃 Flatbed". In the bar's column, so the row is hardly taller.)
    const mid = el("span", "ledger-good-mid");
    mid.append(bar);
    if (good.wagon) mid.append(el("span", "ledger-good-wagon", good.wagon));
    r.append(el("span", "ledger-good-name", `${good.icon} ${good.label}`), mid, el("span", "ledger-good-count", done ? `${good.have}/${good.need} ✓` : `${good.have}/${good.need}`));
    goods.append(r);
  }
  g.append(goods);
  // (Said by Next up already when it's the town's first need.)
  if (v.holding && !(next && next.tab === "grow" && next.button)) g.append(needRow(v, on));
  if (v.buys) g.append(el("p", "ledger-buys", v.buys));
  g.append(el("p", "ledger-pay", "Full pay for goods it needs, half for others."));

  // Station: what the town has (school, market, road, vans, buses, post, the station), then the lines that call.
  const st = panes.station;
  if (st) {
    const rows = el("div", "ledger-rows");
    if (v.school) {
      const id = v.school.depotId;
      rows.append(row(v.school.name, v.school.note, () => on.school(id)));
    }
    if (v.market > 1) rows.append(row("Market", "pays extra for goods"));
    if (v.road) rows.append(row("Road", `${v.road}: grows faster`));
    if (v.van) rows.append(row("Van", v.van));
    if (v.bus) rows.append(row("Bus", v.bus));
    if (v.post) rows.append(row("Post", v.post));
    if (v.station) rows.append(row("Station", `${v.station.waiting} of ${v.station.room} waiting · ${v.station.carried} carried in all`));
    if (rows.childElementCount > 0) st.append(rows);
    if (v.lines.length > 0) {
      const chips = el("div", "ledger-lines");
      for (const l of v.lines) {
        const c = el("button", "ledger-line");
        c.type = "button";
        const dot = el("span", "ledger-line-dot");
        dot.style.background = l.colour;
        c.append(dot, document.createTextNode(`${l.name} · ${l.trains} ${l.trains === 1 ? "train" : "trains"}`));
        c.addEventListener("click", () => on.lines());
        chips.append(c);
      }
      st.append(chips);
    }
  }
  show(tab);
  return panes;
}
