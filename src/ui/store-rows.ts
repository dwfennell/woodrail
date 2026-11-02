import { CARGO, GOODS_ICON, STORE_MODES, type CargoKind, type StoreMode } from "../economy";
import { STORE_ADD, STORE_MODE_ICON, STORE_MODE_WORDS, STORE_OTHERS } from "../game/warehouse-text";

/** One good on a warehouse's card: how many it holds, what it lets trains do with it, and whether it's on its list. */
export interface StoreRow {
  readonly kind: CargoKind;
  readonly count: number;
  readonly cap: number;
  readonly mode: StoreMode;
  /** On the warehouse's own list (set by the player), not only held: it can be taken off while it holds none. */
  readonly listed: boolean;
}

/** What a warehouse's card shows of its goods (`Hud.setStore`). */
export interface StoreView {
  readonly rows: readonly StoreRow[];
  /** "Any other goods". */
  readonly others: StoreMode;
  /** Goods "+ Add a good" offers: ones the player knows, not shown yet. */
  readonly addable: readonly CargoKind[];
}

/** The four-way choice for one good (`kind` "": any other good), each a 44 px button with its picture and its name. */
function choice(kind: CargoKind | "", mode: StoreMode, what: string): string {
  return `<div class="store-modes" role="group" aria-label="${what}">${STORE_MODES.map(
    (m) => `<button class="chip store-mode${m === mode ? " active" : ""}" data-kind="${kind}" data-mode="${m}" aria-pressed="${m === mode}" aria-label="${STORE_MODE_WORDS[m]}" title="${STORE_MODE_WORDS[m]}">${STORE_MODE_ICON[m]}</button>`,
  ).join("")}</div>`;
}

/** A row: the good's name and count over what it's set to (in words), then its four buttons. */
function row(kind: CargoKind | "", name: string, sub: string, mode: StoreMode, unlist: boolean): string {
  const off = unlist ? `<button class="store-unlist" data-unlist="${kind}" aria-label="Take ${name} off the list" title="Take off the list">✕</button>` : "";
  return `<div class="store-row${mode === "off" ? " closed" : ""}"><div class="store-what"><span class="store-line"><span class="store-name">${name}</span>${off}</span><span class="store-sub">${sub}</span></div>${choice(kind, mode, name)}</div>`;
}

/** The warehouse's goods rows, "Any other goods", and "+ Add a good" (with its picker open: the goods to add). */
export function storeHtml(v: StoreView, adding: boolean): string {
  const rows = v.rows.map((r) => row(r.kind, `${GOODS_ICON[r.kind]} ${CARGO[r.kind].label}`, `${r.count}/${r.cap} · ${STORE_MODE_WORDS[r.mode]}`, r.mode, r.listed && r.count === 0)).join("");
  const others = row("", STORE_OTHERS, STORE_MODE_WORDS[v.others], v.others, false);
  const add = v.addable.length
    ? `<button class="chip text store-add${adding ? " active" : ""}" data-add aria-expanded="${adding}">${STORE_ADD}</button>` +
      (adding ? `<div class="store-pick" role="group" aria-label="Goods to add">${v.addable.map((k) => `<button class="chip text" data-list="${k}">${GOODS_ICON[k]} ${CARGO[k].label}</button>`).join("")}</div>` : "")
    : "";
  return rows + others + add;
}
