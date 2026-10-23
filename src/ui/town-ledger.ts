import type { TownLedger } from "../game/town-ledger";

/** What the ledger's rows do when tapped. */
export interface LedgerActions {
  /** The school's row: its card. */
  school(depotId: number): void;
  /** A line's chip: the Lines view. */
  lines(): void;
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

/**
 * Draw a town's ledger (see `game/town-ledger.ts`) into `box`, replacing what was there: its level and what it's
 * growing into, a bar per good it needs, what's holding it back, its school, market and station, the lines that call,
 * and how it pays. Called only when the ledger's key changes.
 */
export function drawLedger(box: HTMLElement, v: TownLedger, on: LedgerActions): void {
  box.innerHTML = "";
  box.classList.add("ledger");

  const head = el("div", "ledger-head");
  // A city grows on into a bigger one (City ★, City ★★…): say that, not the stars.
  const next = v.next.includes("★") ? "grow bigger" : `become a ${v.next.toLowerCase()}`;
  head.append(el("span", "ledger-level", v.level), el("span", "ledger-growing", `${v.have} of ${v.need} goods to ${next}`));
  box.append(head);
  // A bar for all its goods, over a bar for each, when there's more than one (one good: its own bar says it all).
  if (v.goods.length > 1) {
    const total = el("div", "ledger-bar total");
    const fill = el("div", "ledger-fill");
    fill.style.width = `${Math.round((100 * v.have) / Math.max(1, v.need))}%`;
    total.append(fill);
    box.append(total);
  }

  const goods = el("div", "ledger-goods");
  for (const g of v.goods) {
    const done = g.have >= g.need;
    const r = el("div", `ledger-good${done ? " done" : ""}`);
    const bar = el("div", "ledger-bar");
    const f = el("div", "ledger-fill");
    f.style.width = `${Math.round((100 * g.have) / Math.max(1, g.need))}%`;
    bar.append(f);
    r.append(el("span", "ledger-good-name", `${g.icon} ${g.label}`), bar, el("span", "ledger-good-count", done ? `${g.have}/${g.need} ✓` : `${g.have}/${g.need}`));
    goods.append(r);
  }
  box.append(goods);
  if (v.holding) box.append(el("p", "ledger-holding", v.holding));

  const rows = el("div", "ledger-rows");
  if (v.school) {
    const id = v.school.depotId;
    rows.append(row(v.school.name, v.school.note, () => on.school(id)));
  }
  if (v.market > 1) rows.append(row("Market", "pays extra for goods"));
  if (v.station) rows.append(row("Station", `${v.station.waiting} of ${v.station.room} waiting · ${v.station.carried} carried in all`));
  if (rows.childElementCount > 0) box.append(rows);

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
    box.append(chips);
  }
  box.append(el("p", "ledger-pay", "Full pay for goods it needs, half for others."));
}
