import type { MapMarker } from "../game/map-markers";
import { declutterLabels, edgeNudge, rangeNudge, type LabelBox } from "./label-declutter";

export interface MapViewHandlers {
  /** A marker was tapped: go and look at it. */
  go(marker: MapMarker): void;
  close(): void;
  /**
   * A finger (or the mouse) put down on a marker has moved off as a drag: this press, where it went down, is handed to
   * the map (the canvas) so the drag pans it, as one from the ground does.
   */
  handoff?(down: PointerEvent): void;
}

/** How far (px) a ruin's lock reaches past its badge's right and bottom edges (`.map-ruin-lock`'s right and bottom). */
export const LOCK_OUT = 8;

/**
 * Below this height (px) the band between the bars (`MapView.band`) takes compact labels: a town's or depot's name
 * alone on one line, smaller, with its dot (and a depot's goods icon), no line under it or progress bar. A phone on its
 * side has about 190–235 px there, upright 600 or more; the full labels (49 px tall) left room for 2 of the starter
 * map's 5 towns at 667×375. Measured from the band, not the device, so a short window on a desk gets them too.
 */
export const COMPACT_BAND = 300;

/** Does a band `lo`..`hi` (px) take compact labels? */
export const compactBand = (lo: number, hi: number): boolean => hi - lo < COMPACT_BAND;

/** How far (px) a press on a marker moves before it's a drag of the map, not a tap on the marker. */
const DRAG_PX = 8;

/**
 * Which labels keep their spot when they'd cover one another: the player's own industries, then the ruins on the
 * player's land, then towns, then the map's depots. A ruin's badge stays on its ruin (`pinned`, never nudged off it):
 * one on the player's land (its card a tap away) keeps it, and towns' and depots' labels are nudged off it (QA: on a
 * big map, upright, the towns' labels covered every ruin, and moved with them when panned, so none could be got at);
 * one on the land around comes last, hidden where it would cover a label or another badge. Either way no badge is
 * ever under a label.
 */
function markerRank(m: MapMarker): { priority: number; pinned?: boolean } {
  if (m.kind === "ruin") return { priority: m.ruin !== undefined ? 1.5 : -1, pinned: true };
  return { priority: m.key.startsWith("site:") ? 2 : m.kind === "town" ? 1 : 0 };
}

/** Where a marker's box goes on screen (px), and whether its label is to the left of its dot. */
export interface MarkerSpot {
  x: number;
  y: number;
  w: number;
  h: number;
  flip: boolean;
}

/**
 * Where each marker's box goes (null: not shown), from where its place is on screen (`pts`, null off it) and its size:
 * kept between `lo` and `hi` (the bars) and on a screen `screenW` wide, and none over another (labels nudged apart
 * vertically by `markerRank`, hidden if they still would be; a ruin's badge only on its ruin). Slid into range first,
 * then decluttered within it, so the boxes returned are where they end up (QA: a slide into range after the declutter
 * put labels back over badges and one another). O(n^2), n = markers on screen: run on a map refresh, not per frame.
 */
export function layoutMarkers(
  markers: readonly MapMarker[],
  pts: readonly ({ x: number; y: number } | null)[],
  sizes: readonly { w: number; h: number }[],
  screenW: number,
  lo: number,
  hi: number,
): (MarkerSpot | null)[] {
  const idx: number[] = [];
  const boxes: LabelBox[] = [];
  const flips: boolean[] = [];
  pts.forEach((p, k) => {
    if (!p) return;
    const { w, h } = sizes[k];
    const ruin = markers[k].kind === "ruin";
    // A label that would run off the right edge goes to the left of its dot instead.
    const flip = !ruin && p.x + w > screenW - 8 && p.x - w > 8;
    // The label's box starts 14px up-left of the dot (its css margin); a flipped one sits to the left of it.
    const left = Math.round(p.x) + (flip ? 14 - w : -14);
    const top = Math.round(p.y) - 14;
    // One that fits neither side (zoomed right out, a town at the edge) slides in to stay on screen, and between the bars.
    const dx = edgeNudge(left, w, screenW);
    const dy = rangeNudge(top, h, lo, hi);
    // (A ruin's badge stays on its ruin: under a bar or past the edge, it isn't shown.)
    if (ruin && (dx !== 0 || dy !== 0)) return;
    idx.push(k);
    flips.push(flip);
    boxes.push({ x: left + dx, y: top + dy, w, h, ...markerRank(markers[k]) });
  });
  const spots = declutterLabels(boxes, { lo, hi });
  const out: (MarkerSpot | null)[] = markers.map(() => null);
  idx.forEach((k, i) => {
    if (!spots[i].hidden) out[k] = { x: boxes[i].x, y: boxes[i].y + spots[i].dy, w: boxes[i].w, h: boxes[i].h, flip: flips[i] };
  });
  return out;
}

/** What the map's bar says to do, as a rule. */
const MAP_HINT = "Tap a place to go there";

/**
 * The map view's overlay: a label over each town and depot (positioned by the caller from the camera), and a way
 * back. Only built while open; repositioned only on frames that draw.
 */
export class MapView {
  readonly root = document.createElement("div");
  private readonly layer = document.createElement("div");
  private readonly bar = document.createElement("div");
  private markers: MapMarker[] = [];
  private readonly els = new Map<string, HTMLButtonElement>();
  /** What's shown now, so an unchanged refresh touches nothing. */
  private shownKey = "";
  /** What the last placement was made from, so an unmoved map costs nothing. */
  private placedKey = "";

  /** What the bar says to do (planning a route, a place gone to is then tapped to add it). */
  setHint(text: string | null): void {
    const hint = this.bar.querySelector(".map-hint");
    if (hint) hint.textContent = text ?? MAP_HINT;
  }

  constructor(parent: HTMLElement, handlers: MapViewHandlers) {
    this.root.className = "map-view";
    this.root.hidden = true;
    this.layer.className = "map-layer";
    const bar = this.bar;
    bar.className = "map-bar";
    bar.innerHTML = `<b>Map</b><span class="map-hint">${MAP_HINT}</span>`;
    const back = document.createElement("button");
    back.className = "chip text primary";
    back.textContent = "Back";
    back.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.close();
    });
    bar.appendChild(back);
    this.root.append(this.layer, bar);
    // A drag that starts on a label or a badge pans the map, as one on the ground does; only a tap goes to the place
    // (QA: on a big map, upright, the labels cover much of the screen, and a drag from one did nothing, so the coast
    // couldn't be got to). Its press is handed to the canvas once it has moved `DRAG_PX`, where it went down.
    const downs = new Map<number, { x: number; y: number; handed: boolean }>();
    let dragged = false;
    this.layer.addEventListener("pointerdown", (e) => {
      if (!(e.target as HTMLElement).closest(".map-marker")) return;
      if (downs.size === 0) dragged = false;
      downs.set(e.pointerId, { x: e.clientX, y: e.clientY, handed: false });
    });
    // (Before the camera's own listener sees this move: handed over first, the move then pans.)
    window.addEventListener(
      "pointermove",
      (e) => {
        if (downs.size === 0) return;
        const d = downs.get(e.pointerId);
        if (!d || d.handed || Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_PX) return;
        d.handed = true;
        dragged = true;
        handlers.handoff?.(new PointerEvent("pointerdown", { pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, clientX: d.x, clientY: d.y, button: 0, buttons: 1, bubbles: true }));
      },
      { capture: true },
    );
    const lift = (e: PointerEvent) => downs.delete(e.pointerId);
    window.addEventListener("pointerup", lift);
    window.addEventListener("pointercancel", lift);
    this.layer.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(".map-marker");
      const m = b && this.markers.find((x) => x.key === b.dataset.key);
      // (A drag from it panned the map: not a tap.)
      if (m && dragged) {
        dragged = false;
        e.stopPropagation();
        return;
      }
      if (m) {
        e.stopPropagation();
        handlers.go(m);
      }
    });
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    if (!open) {
      this.layer.innerHTML = "";
      this.els.clear();
      this.shownKey = "";
      this.placedKey = "";
    }
  }

  /** Show these markers (rebuilt only when what they say changed). */
  show(markers: MapMarker[]): void {
    this.markers = markers;
    const key = markers.map((m) => `${m.key}|${m.title}|${m.detail}|${m.fill ?? ""}|${m.icon ?? ""}|${m.glyph ?? ""}${m.locked ? "L" : ""}`).join(";");
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.placedKey = "";
    this.layer.innerHTML = "";
    this.els.clear();
    for (const m of markers) {
      const b = document.createElement("button");
      b.className = `map-marker kind-${m.kind}`;
      b.dataset.key = m.key;
      if (m.kind === "ruin") {
        // An old industry's ruin: its icon alone in a small round badge, a lock on it while its blueprint isn't learned.
        b.classList.toggle("locked", !!m.locked);
        b.setAttribute("aria-label", m.locked ? `${m.title}, locked` : m.title);
        b.title = m.title;
        b.innerHTML = `<span class="map-ruin-icon">${m.icon ?? ""}</span>${m.locked ? `<span class="map-ruin-lock">🔒</span>` : ""}`;
        this.layer.appendChild(b);
        this.els.set(m.key, b);
        continue;
      }
      const bar = m.fill !== undefined ? `<span class="map-fill"><i style="width:${Math.round(m.fill * 100)}%"></i></span>` : "";
      // (A compact label, `.compact`, shows the name and a depot's goods icon alone: the line under it and the bar hidden.)
      const glyph = m.glyph ? `<i class="map-glyph">${m.glyph}</i>` : "";
      b.innerHTML = `<span class="map-dot"></span><span class="map-text"><b>${m.title}${glyph}</b><span>${m.detail}</span>${bar}</span>`;
      this.layer.appendChild(b);
      this.els.set(m.key, b);
    }
  }

  /**
   * Where markers may go on screen (client px, top to bottom): between the top bar and the Map / Back bar (one under
   * either can't be tapped). Only meaningful while open.
   */
  band(): { top: number; bottom: number } {
    return {
      top: Math.round(document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) + 8,
      bottom: Math.round(this.bar.getBoundingClientRect().top || window.innerHeight) - 8,
    };
  }

  /**
   * Put each marker over its place: `project` gives screen px, or null when it's off screen. Labels that would cover
   * one another are nudged apart vertically (towns keep their spot over depots), and hidden if they still would.
   */
  place(project: (x: number, z: number) => { x: number; y: number } | null): void {
    const { top: lo, bottom: hi } = this.band();
    // A short band (a phone on its side): compact labels, so most of the towns' fit (set before their sizes are read).
    const compact = compactBand(lo, hi);
    if (compact !== this.root.classList.contains("compact")) this.root.classList.toggle("compact", compact);
    // Read every label's size first, then move them (one layout, not one per marker).
    // (A locked badge's lock reaches past its corner: its box takes that in, so no label covers it.)
    const sizes = this.markers.map((m) => {
      const e = this.els.get(m.key);
      const out = m.kind === "ruin" && m.locked ? LOCK_OUT : 0;
      return { w: (e?.offsetWidth ?? 0) + out, h: (e?.offsetHeight ?? 0) + out };
    });
    const pts = this.markers.map((m) => project(m.x, m.z));
    const key = pts.map((p, k) => (p ? `${Math.round(p.x)},${Math.round(p.y)},${sizes[k].w},${sizes[k].h}` : "-")).join(";") + `@${window.innerWidth},${lo},${hi}`;
    if (key === this.placedKey) return;
    this.placedKey = key;
    const spots = layoutMarkers(this.markers, pts, sizes, window.innerWidth, lo, hi);
    this.markers.forEach((m, k) => {
      const el = this.els.get(m.key);
      if (!el) return;
      const at = spots[k];
      el.classList.toggle("off", !at);
      if (!at) return;
      el.classList.toggle("flip", at.flip);
      // (The box's corner is 14px up-left of the dot, its css margin; a flipped one's right edge 14px right of it.)
      const x = at.flip ? at.x + at.w - 14 : at.x + 14;
      el.style.transform = `translate(${x}px, ${at.y + 14}px)${at.flip ? " translateX(-100%)" : ""}`;
    });
  }
}
