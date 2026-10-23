import type { MapMarker } from "../game/map-markers";
import { declutterLabels, edgeNudge, rangeNudge, type LabelBox } from "./label-declutter";

export interface MapViewHandlers {
  /** A marker was tapped: go and look at it. */
  go(marker: MapMarker): void;
  close(): void;
}

/**
 * Which labels keep their spot when they'd cover one another: the player's own industries, then towns, then the map's
 * depots. A ruin's badge comes last and stays on its ruin (`pinned`, never nudged off it): one that would cover a label
 * (or another ruin) is hidden, so it never clashes with a town's or a station's label.
 */
function markerRank(m: MapMarker): { priority: number; pinned?: boolean } {
  if (m.kind === "ruin") return { priority: -1, pinned: true };
  return { priority: m.key.startsWith("site:") ? 2 : m.kind === "town" ? 1 : 0 };
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
    this.layer.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>(".map-marker");
      const m = b && this.markers.find((x) => x.key === b.dataset.key);
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
    const key = markers.map((m) => `${m.key}|${m.title}|${m.detail}|${m.fill ?? ""}|${m.icon ?? ""}${m.locked ? "L" : ""}`).join(";");
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
      b.innerHTML = `<span class="map-dot"></span><span class="map-text"><b>${m.title}</b><span>${m.detail}</span>${bar}</span>`;
      this.layer.appendChild(b);
      this.els.set(m.key, b);
    }
  }

  /**
   * Put each marker over its place: `project` gives screen px, or null when it's off screen. Labels that would cover
   * one another are nudged apart vertically (towns keep their spot over depots), and hidden if they still would.
   */
  place(project: (x: number, z: number) => { x: number; y: number } | null): void {
    // Read every label's size first, then move them (one layout, not one per marker).
    const sizes = this.markers.map((m) => {
      const e = this.els.get(m.key);
      return { w: e?.offsetWidth ?? 0, h: e?.offsetHeight ?? 0 };
    });
    // Labels stay between the top bar and the Map / Back bar (one under either can't be tapped).
    const lo = Math.round(document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0) + 8;
    const hi = Math.round(this.bar.getBoundingClientRect().top || window.innerHeight) - 8;
    const pts = this.markers.map((m) => project(m.x, m.z));
    const key = pts.map((p, k) => (p ? `${Math.round(p.x)},${Math.round(p.y)},${sizes[k].w},${sizes[k].h}` : "-")).join(";") + `@${window.innerWidth},${lo},${hi}`;
    if (key === this.placedKey) return;
    this.placedKey = key;
    // A label that would run off the right edge goes to the left of its dot instead.
    const flips = pts.map((p, k) => !!p && this.markers[k].kind !== "ruin" && p.x + sizes[k].w > window.innerWidth - 8 && p.x - sizes[k].w > 8);
    const idx: number[] = [];
    const boxes: LabelBox[] = [];
    // One that fits neither side (zoomed right out, a town at the edge) slides in to stay on screen.
    const nudges = pts.map(() => 0);
    const lifts = pts.map(() => 0);
    pts.forEach((p, k) => {
      if (!p) return;
      // The label's box starts 14px up-left of the dot (its css margin); a flipped one sits to the left of it.
      const w = sizes[k].w;
      const left = Math.round(p.x) + (flips[k] ? 14 - w : -14);
      nudges[k] = edgeNudge(left, w, window.innerWidth);
      lifts[k] = rangeNudge(Math.round(p.y) - 14, sizes[k].h, lo, hi);
      // (A ruin's badge stays on its ruin: under a bar or past the edge, it isn't shown.)
      if (this.markers[k].kind === "ruin" && (nudges[k] !== 0 || lifts[k] !== 0)) return;
      idx.push(k);
      boxes.push({ x: left + nudges[k], y: Math.round(p.y) - 14 + lifts[k], w, h: sizes[k].h, ...markerRank(this.markers[k]) });
    });
    const spots = declutterLabels(boxes);
    this.markers.forEach((m, k) => {
      const el = this.els.get(m.key);
      const p = pts[k];
      if (!el) return;
      const at = idx.indexOf(k);
      const off = !p || at < 0 || spots[at].hidden;
      el.classList.toggle("off", off);
      if (off || !p) return;
      el.classList.toggle("flip", flips[k]);
      // (A nudge apart can't take it back under a bar either.)
      const y = Math.round(p.y) + lifts[k] + spots[at].dy;
      const dy = rangeNudge(y - 14, sizes[k].h, lo, hi);
      el.style.transform = `translate(${Math.round(p.x) + nudges[k]}px, ${y + dy}px)${flips[k] ? " translateX(-100%)" : ""}`;
    });
  }
}
