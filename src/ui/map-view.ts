import type { MapMarker } from "../game/map-markers";

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
    }
  }

  /** Show these markers (rebuilt only when what they say changed). */
  show(markers: MapMarker[]): void {
    this.markers = markers;
    const key = markers.map((m) => `${m.key}|${m.title}|${m.detail}|${m.fill ?? ""}`).join(";");
    if (key === this.shownKey) return;
    this.shownKey = key;
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

  /** Put each marker over its place: `project` gives screen px, or null when it's off screen. */
  place(project: (x: number, z: number) => { x: number; y: number } | null): void {
    // Read every label's width first, then move them (one layout, not one per marker).
    const widths = this.markers.map((m) => this.els.get(m.key)?.offsetWidth ?? 0);
    this.markers.forEach((m, k) => {
      const el = this.els.get(m.key);
      if (!el) return;
      const p = project(m.x, m.z);
      el.hidden = !p;
      if (!p) return;
      // A label that would run off the right edge goes to the left of its dot instead.
      const flip = p.x + widths[k] > window.innerWidth - 8 && p.x - widths[k] > 8;
      el.classList.toggle("flip", flip);
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)${flip ? " translateX(-100%)" : ""}`;
    });
  }
}
