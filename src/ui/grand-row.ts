import { CARGO, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { kindsOf, type Bag } from "../economy/goods";
import { grandOf, type GrandTile } from "../game/grand";
import { achievementPips } from "./goals-panel";

/** What the row's buttons do. */
export interface GrandActions {
  build(id: string): void;
  /** Show the project's site on the map. */
  show(id: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** "3/20 🪨 20 🪵" (each good as count and icon, its name in the title; a filled good ticked green). */
function goodsSpan(goods: Bag, got?: Bag): HTMLElement {
  const s = el("span", "place-goods");
  for (const k of kindsOf(goods)) {
    const g = el("span", "place-good", `${got ? `${Math.min(got[k] ?? 0, goods[k]!)}/` : ""}${goods[k]} ${GOODS_ICON[k as CargoKind]}`);
    g.title = CARGO[k as CargoKind].label;
    if (got && (got[k] ?? 0) >= goods[k]!) g.classList.add("done");
    s.append(g);
  }
  return s;
}

function tile(t: GrandTile, on: GrandActions): HTMLElement {
  const box = el("div", `place-tile grand-tile ${t.state}`);
  box.dataset.grand = t.id;
  const head = el("b", "place-name");
  head.append(el("span", "place-icon", t.icon), document.createTextNode(t.name));
  const g = grandOf(t.id)!;
  const done = t.state === "earned" ? g.stages.length : t.stage ? t.stage.n - 1 : 0;
  const pips = el("span", "grand-pips", achievementPips(done, g.stages.length, t.state === "building"));
  pips.title = `${done} of ${g.stages.length} stages done`;
  box.append(head, pips, el("span", "place-blurb grand-reward", `🎁 ${t.reward}`));
  if (t.stage) {
    const s = el("div", "place-plan grand-stage");
    s.append(el("b", "place-plan-name", `Stage ${t.stage.n} of ${t.stage.of}: ${t.stage.name}`), goodsSpan(t.stage.goods, t.stage.got));
    box.append(s);
  }
  if (t.state === "build") {
    const b = el("button", "place-btn", t.note);
    b.type = "button";
    b.dataset.grand = t.id;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      on.build(t.id);
    });
    box.append(b);
  } else if (t.state === "building" || t.state === "earned") {
    const b = el("button", "place-stop grand-show", t.state === "earned" ? "🏆 Earned · Show me" : "Show me the site");
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      on.show(t.id);
    });
    box.append(b);
  } else box.append(el("span", "place-note", t.note));
  return box;
}

/**
 * Draw a city's Grand projects row (`grandRow`, game/grand.ts) at the end of `box` (the card's extra part). Called only
 * when its key changes.
 */
export function drawGrandRow(box: HTMLElement, tiles: readonly GrandTile[], on: GrandActions): void {
  const sec = el("div", "places-sec grand-sec");
  sec.dataset.section = "grand";
  const head = el("div", "places-head");
  head.append(el("span", "places-title", "Grand projects"), el("span", "places-note", "achievements"));
  sec.append(head, el("p", "places-sub", "Big builds for a City ★, one of each on the map. Trains bring each stage's goods to the station; finish one for a lasting reward."));
  const grid = el("div", "place-grid");
  for (const t of tiles) grid.append(tile(t, on));
  sec.append(grid);
  box.append(sec);
}
