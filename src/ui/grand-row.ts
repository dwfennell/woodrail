import { CARGO, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { kindsOf, type Bag } from "../economy/goods";
import { grandOf, type GrandTile } from "../game/grand";

/** What the Projects pane's buttons do. */
export interface GrandActions {
  build(id: string): void;
  /** Show the project's site on the map. */
  show(id: string): void;
  /** A project's row tapped: its ticket opens (main keeps which across redraws). */
  pick(id: string): void;
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

/** Stages done of a tile's project (all of them once earned). */
const doneOf = (t: GrandTile): number => (t.state === "earned" ? grandOf(t.id)!.stages.length : t.stage ? t.stage.n - 1 : 0);

/** Its stages as pegs in holes: done green, under way blue. */
function pegs(t: GrandTile): HTMLElement {
  const g = grandOf(t.id)!;
  const done = doneOf(t);
  const s = el("span", "grand-pips");
  for (let i = 0; i < g.stages.length; i++) s.append(el("i", i < done ? "done" : i === done && t.state === "building" ? "now" : ""));
  s.title = `${done} of ${g.stages.length} stages done`;
  return s;
}

/** The mark on a project's row: its price stamped, or what stands in its way. */
function rowMark(t: GrandTile): HTMLElement {
  if (t.state === "build" || t.state === "short") return el("span", `grand-price${t.state === "short" ? " short" : ""}`, `${t.coins} 🪙`);
  return el("span", `grand-mark ${t.state}`, t.state === "earned" ? "🥇 Earned" : t.state === "building" ? "Under way" : t.note);
}

/** A project's ticket: its reward first, each stage with its goods (the one under way, what's come), and its button. */
function ticket(t: GrandTile, ring: boolean, on: GrandActions): HTMLElement {
  const g = grandOf(t.id)!;
  const box = el("div", `place-tile grand-tile grand-ticket ${t.state}`);
  box.dataset.grand = t.id;
  const head = el("div", "grand-ticket-head");
  head.append(el("span", "grand-icon", t.icon), el("b", "grand-name", t.name), pegs(t));
  box.append(head, el("p", "grand-reward", `🎁 ${t.reward}`));
  const list = el("ol", "grand-stages");
  const done = doneOf(t);
  g.stages.forEach((st, i) => {
    const now = i === done && t.state === "building";
    const li = el("li", i < done ? "done" : now ? "now" : "");
    li.append(el("i", "grand-stage-mark"), el("span", "grand-stage-name", `${i + 1}. ${st.name.replace(/^The /, "the ").replace(/^./, (c) => c.toUpperCase())}`));
    if (now && t.stage) {
      const got = goodsSpan(t.stage.goods, t.stage.got);
      // (Grand Central's last: riders carried through the station, a count, not goods.)
      if (t.stage.riders) {
        const r = el("span", "place-good", `${Math.min(t.stage.riders.got, t.stage.riders.want)}/${t.stage.riders.want} 🧑 riders through it`);
        if (t.stage.riders.got >= t.stage.riders.want) r.classList.add("done");
        got.append(r);
      }
      li.append(got);
    } else {
      const want = goodsSpan(st.goods);
      if (st.riders) want.append(el("span", "place-good", `${st.riders} 🧑`));
      li.append(want);
    }
    list.append(li);
  });
  box.append(list);
  const foot = el("div", "grand-foot");
  if (t.state === "build") {
    foot.append(el("span", "grand-foot-note", "Trains bring each stage's goods to this city's station"));
    const b = el("button", `place-btn grand-start${ring ? " ringed" : ""}`, `Start · ${t.coins} 🪙`);
    b.type = "button";
    b.dataset.grand = t.id;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      on.build(t.id);
    });
    foot.append(b);
  } else if (t.state === "building" || t.state === "earned") {
    foot.append(el("span", "grand-foot-note", t.state === "earned" ? "🥇 Earned: its reward holds for good" : "Trains bring this stage's goods to the station"));
    const b = el("button", "chip text grand-show", "Show the site");
    b.type = "button";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      on.show(t.id);
    });
    foot.append(b);
  } else foot.append(el("span", `place-note grand-why${ring ? " ringed" : ""}`, t.note));
  box.append(foot);
  return box;
}

/** A project not picked: a maple row (its picture, name, reward in a few words, price); a tap opens its ticket. */
function rowOf(t: GrandTile, on: GrandActions): HTMLElement {
  const r = el("button", `place-tile grand-tile grand-row ${t.state}`);
  r.type = "button";
  r.dataset.grand = t.id;
  const words = el("span", "grand-row-words");
  words.append(el("b", "grand-name", t.name), el("span", "grand-short", t.short));
  r.append(el("span", "grand-icon", t.icon), words, rowMark(t));
  r.addEventListener("click", (e) => {
    e.stopPropagation();
    on.pick(t.id);
  });
  return r;
}

/**
 * Draw a city's Projects pane (`grandRow`, game/grand.ts) at the end of `box`: a line on what they are, the picked
 * project's ticket (`picked`; its Start ringed when `ring`: the Journal brought the player here for it), then the
 * others as rows. Called only when the card's key changes.
 */
export function drawGrandRow(box: HTMLElement, tiles: readonly GrandTile[], picked: string, ring: boolean, on: GrandActions): void {
  const sec = el("div", "places-sec grand-sec");
  sec.dataset.section = "grand";
  sec.append(el("p", "places-sub", "Big builds for a City ★, one of each on the map. Pick one: trains bring its goods in stages, and finishing it gives a reward that lasts."));
  const shown = tiles.find((t) => t.id === picked) ?? tiles[0];
  if (shown) sec.append(ticket(shown, ring, on));
  const rows = el("div", "grand-rows");
  for (const t of tiles) if (t !== shown) rows.append(rowOf(t, on));
  sec.append(rows);
  box.append(sec);
}

/** Which project a city's Projects pane opens on: the one under way here, or the first it can start, or the first. */
export function defaultPick(tiles: readonly GrandTile[]): string {
  return (tiles.find((t) => t.state === "building") ?? tiles.find((t) => t.state === "build") ?? tiles.find((t) => t.state === "short") ?? tiles[0])?.id ?? "";
}
