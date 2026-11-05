import { CARGO, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { kindsOf, type Bag } from "../economy/goods";
import { MAX_SMILES } from "../game/places";
import type { PlaceRowView, PlaceTile } from "../game/place-row";

/** What the rows' buttons do. */
export interface PlaceActions {
  build(id: string): void;
  stop(): void;
  treat(id: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** "10 🪵 6 🪨" (each good as count and icon, its name in the title). */
function goodsSpan(goods: Bag, got?: Bag): HTMLElement {
  const s = el("span", "place-goods");
  for (const k of kindsOf(goods)) {
    const g = el("span", "place-good", `${got ? `${Math.min(got[k] ?? 0, goods[k]!)}/` : ""}${goods[k]} ${GOODS_ICON[k as CargoKind]}`);
    g.title = CARGO[k as CargoKind].label;
    if (got && (got[k] ?? 0) >= goods[k]!) g.classList.add("done");
    s.append(g);
  }
  return s;
}

function tile(t: PlaceTile, onTap: (() => void) | null): HTMLElement {
  const box = el("div", `place-tile ${t.state}`);
  box.dataset.place = t.id;
  const head = el("b", "place-name");
  head.append(el("span", "place-icon", t.icon), document.createTextNode(t.name));
  box.append(head, el("span", "place-blurb", t.blurb));
  if (onTap) {
    const b = el("button", "place-btn");
    b.type = "button";
    b.dataset.place = t.id;
    b.append(document.createTextNode(t.note));
    // (Its goods on the button: "Build · 120 🪙 + 10 🪵 6 🪨".)
    if (kindsOf(t.goods).length > 0) b.append(document.createTextNode(" + "), goodsSpan(t.goods));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onTap();
    });
    box.append(b);
  } else {
    const n = el("span", "place-note", t.note);
    if (t.state === "short" && kindsOf(t.goods).length > 0) n.append(document.createTextNode(" + "), goodsSpan(t.goods));
    box.append(n);
  }
  return box;
}

/**
 * Draw a town card's Places and Treats rows (`placeRow`, game/place-row.ts) at the end of `box` (the card's extra
 * part, after the ledger). Called only when the rows' key changes.
 */
export function drawPlaceRows(box: HTMLElement, v: PlaceRowView, on: PlaceActions): void {
  const sec = el("div", "places-sec");
  sec.dataset.section = "places";
  const head = el("div", "places-head");
  head.append(el("span", "places-title", "Places"));
  const smiles = el("span", "places-smiles", "😊".repeat(v.smiles) + "◯".repeat(MAX_SMILES - v.smiles));
  smiles.title = `${v.smiles} of ${MAX_SMILES} smiles`;
  head.append(smiles);
  sec.append(head, el("p", "places-sub", v.needsHall ? "Build a town hall to plan this town's places." : v.smileLine));
  // The place under way: its goods coming in, and a way to stop.
  if (v.plan) {
    const plan = el("div", "place-plan");
    plan.append(el("b", "place-plan-name", `${v.plan.icon} ${v.plan.name}: ${v.plan.stuck ? "waiting for room to build" : "goods coming by train"}`), goodsSpan(v.plan.goods, v.plan.got));
    const stop = el("button", "place-stop", "Stop (coins back)");
    stop.type = "button";
    stop.addEventListener("click", (e) => {
      e.stopPropagation();
      on.stop();
    });
    plan.append(stop);
    sec.append(plan);
  }
  const grid = el("div", "place-grid");
  for (const t of v.tiles) grid.append(tile(t, t.state === "build" ? () => on.build(t.id) : null));
  if (v.tiles.length > 0) sec.append(grid);
  box.append(sec);

  if (!v.treats) return;
  const tr = el("div", "places-sec treats");
  tr.dataset.section = "treats";
  const th = el("div", "places-head");
  th.append(el("span", "places-title", "Treats"), el("span", "places-note", "just for fun"));
  tr.append(th, el("p", "places-sub", "Treats don't pay. They make a town look loved."));
  const tg = el("div", "place-grid");
  for (const t of v.treats) tg.append(tile(t, t.state === "build" ? () => on.treat(t.id) : null));
  tr.append(tg);
  box.append(tr);
}
