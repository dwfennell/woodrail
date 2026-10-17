import type { MapMarker } from "../game/map-markers";
import { declutterLabels, type LabelBox } from "./label-declutter";

export interface MapViewHandlers {
  /** A marker was tapped: go and look at it. */
  go(marker: MapMarker): void;
  close(): void;
}

/**
 * The map view's overlay: a label over each town and depot (positioned by the caller from the camera), and a way
 * back. Only built while open; repositioned only on frames that draw.
 */
export class MapView {
  readonly root = document.createElement("div");
  private readonly layer = document.createElement("div");
  private markers: MapMarker[] = [];
  private readonly els = new Map<string, HTMLButtonElement>();
  /** What's shown now, so an unchanged refresh touches nothing. */
  private shownKey = "";
  /** What the last placement was made from, so an unmoved map costs nothing. */
  private placedKey = "";

  constructor(parent: HTMLElement, handlers: MapViewHandlers) {
    this.root.className = "map-view";
    this.root.hidden = true;
    this.layer.className = "map-layer";
    const bar = document.createElement("div");
    bar.className = "map-bar";
    bar.innerHTML = `<b>Map</b><span>Tap a place to go there</span>`;
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
    const key = markers.map((m) => `${m.key}|${m.title}|${m.detail}|${m.fill ?? ""}`).join(";");
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.placedKey = "";
    this.layer.innerHTML = "";
    this.els.clear();
    for (const m of markers) {
      const b = document.createElement("button");
      b.className = `map-marker kind-${m.kind}`;
      b.dataset.key = m.key;
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
    const pts = this.markers.map((m) => project(m.x, m.z));
    const key = pts.map((p, k) => (p ? `${Math.round(p.x)},${Math.round(p.y)},${sizes[k].w},${sizes[k].h}` : "-")).join(";") + `@${window.innerWidth}`;
    if (key === this.placedKey) return;
    this.placedKey = key;
    // A label that would run off the right edge goes to the left of its dot instead.
    const flips = pts.map((p, k) => !!p && p.x + sizes[k].w > window.innerWidth - 8 && p.x - sizes[k].w > 8);
    const idx: number[] = [];
    const boxes: LabelBox[] = [];
    pts.forEach((p, k) => {
      if (!p) return;
      // The label's box starts 14px up-left of the dot (its css margin); a flipped one sits to the left of it.
      const w = sizes[k].w;
      idx.push(k);
      boxes.push({ x: Math.round(p.x) + (flips[k] ? 14 - w : -14), y: Math.round(p.y) - 14, w, h: sizes[k].h, priority: this.markers[k].kind === "town" ? 1 : 0 });
    });
    const spots = declutterLabels(boxes);
    this.markers.forEach((m, k) => {
      const el = this.els.get(m.key);
      const p = pts[k];
      if (!el) return;
      const at = idx.indexOf(k);
      const off = !p || spots[at].hidden;
      el.classList.toggle("off", off);
      if (off || !p) return;
      el.classList.toggle("flip", flips[k]);
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y) + spots[at].dy}px)${flips[k] ? " translateX(-100%)" : ""}`;
    });
  }
}
