import { CARGO, GOODS_ICON, STORE_MODES, type CargoKind, type StoreMode } from "../economy";
import { GIVES_MODE_ICON, GIVES_MODE_WORDS, GIVES_MODES, WAGON_MODE_ICON, WAGON_MODE_WORDS, WAGON_MODES, STORE_ADD, STORE_MODE_ICON, STORE_MODE_WORDS, STORE_OTHERS } from "../game/warehouse-text";

/** One good on a warehouse's card: how many it holds, what it lets trains do with it, and whether it's on its list. */
export interface StoreRow {
  readonly kind: CargoKind;
  readonly count: number;
  readonly cap: number;
  readonly mode: StoreMode;
  /** On the warehouse's own list (set by the player), not only held: it can be taken off while it holds none. */
  readonly listed: boolean;
}

/**
 * What a warehouse's card shows of its goods (`Hud.setStore`); or (`gives`) an industry's that gives several: a
 * two-way Gives / Doesn't give per good, no "Any other goods" and nothing to add.
 */
export interface StoreView {
  readonly rows: readonly StoreRow[];
  /** "Any other goods" (null: no such row). */
  readonly others: StoreMode | null;
  readonly gives?: boolean;
  /** A wagon's card: on or off per good it can carry (no counts: `cap` 0). */
  readonly wagon?: boolean;
  /** Goods "+ Add a good" offers: ones the player knows, not shown yet. */
  readonly addable: readonly CargoKind[];
}

/** The words and pictures of one set of choices: a warehouse's four, or an industry's two. */
interface Choices {
  readonly modes: readonly StoreMode[];
  readonly words: Partial<Record<StoreMode, string>>;
  readonly icons: Partial<Record<StoreMode, string>>;
}
const STORE: Choices = { modes: STORE_MODES, words: STORE_MODE_WORDS, icons: STORE_MODE_ICON };
const GIVES: Choices = { modes: GIVES_MODES, words: GIVES_MODE_WORDS, icons: GIVES_MODE_ICON };
const WAGON: Choices = { modes: WAGON_MODES, words: WAGON_MODE_WORDS, icons: WAGON_MODE_ICON };

/** The choice for one good (`kind` "": any other good), each a 44 px button with its picture and its name. */
function choice(c: Choices, kind: CargoKind | "", mode: StoreMode, what: string): string {
  return `<div class="store-modes" role="group" aria-label="${what}">${c.modes
    .map((m) => `<button class="chip store-mode${m === mode ? " active" : ""}" data-kind="${kind}" data-mode="${m}" aria-pressed="${m === mode}" aria-label="${c.words[m]}" title="${c.words[m]}">${c.icons[m]}</button>`)
    .join("")}</div>`;
}

/** A row: the good's name and count over what it's set to (in words), then its buttons. */
function row(c: Choices, kind: CargoKind | "", name: string, sub: string, mode: StoreMode, unlist: boolean): string {
  const off = unlist ? `<button class="store-unlist" data-unlist="${kind}" aria-label="Take ${name} off the list" title="Take off the list">✕</button>` : "";
  return `<div class="store-row${mode === "off" ? " closed" : ""}"><div class="store-what"><span class="store-line"><span class="store-name">${name}</span>${off}</span><span class="store-sub">${sub}</span></div>${choice(c, kind, mode, name)}</div>`;
}

/** The warehouse's goods rows, "Any other goods", and "+ Add a good" (with its picker open: the goods to add). */
export function storeHtml(v: StoreView, adding: boolean): string {
  const c = v.wagon ? WAGON : v.gives ? GIVES : STORE;
  const rows = v.rows.map((r) => row(c, r.kind, `${GOODS_ICON[r.kind]} ${CARGO[r.kind].label}`, `${r.cap > 0 ? `${r.count}/${r.cap} · ` : ""}${c.words[r.mode]}`, r.mode, c === STORE && r.listed && r.count === 0)).join("");
  const others = v.others === null ? "" : row(c, "", STORE_OTHERS, STORE_MODE_WORDS[v.others], v.others, false);
  const add = v.addable.length
    ? `<button class="chip text store-add${adding ? " active" : ""}" data-add aria-expanded="${adding}">${STORE_ADD}</button>` +
      (adding ? `<div class="store-pick" role="group" aria-label="Goods to add">${v.addable.map((k) => `<button class="chip text" data-list="${k}">${GOODS_ICON[k]} ${CARGO[k].label}</button>`).join("")}</div>` : "")
    : "";
  return rows + others + add;
}
