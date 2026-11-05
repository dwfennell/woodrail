import { LIVERIES, paintState, stripeColours, type PaintState, type Stripe } from "../game/paint-shop";
import type { Progress } from "../game/progress";
import { townLevel } from "../game/towns";

/**
 * The paint shop's sheet (game/paint-shop.ts): an engine's name, a swatch per livery (as it came first), and Paint.
 * Built when it opens and after each tap; never per frame.
 */
export class PaintSheet {
  readonly root = document.createElement("div");
  private carId = -1;
  private chosen = "";
  /** When it opened: the tap that opened it isn't a tap on its backdrop (a phone's click follows the touch). */
  private openedAt = 0;

  constructor(
    private readonly on: {
      /** Paint engine `carId` in `id` ("": as it came). True if it was painted. */
      paint(carId: number, id: string): boolean;
      progress(): Progress;
      liveryOf(carId: number): string;
      nameOf(carId: number): string;
    },
  ) {
    this.root.className = "growth-sheet paint-sheet";
    this.root.hidden = true;
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root && performance.now() - this.openedAt > 450) this.close();
    });
    document.body.append(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  show(carId: number): void {
    this.carId = carId;
    this.chosen = this.on.liveryOf(carId);
    this.openedAt = performance.now();
    this.root.hidden = false;
    this.draw();
  }

  close(): void {
    this.root.hidden = true;
    this.carId = -1;
  }

  private draw(): void {
    const p = this.on.progress();
    const current = this.on.liveryOf(this.carId);
    const name = this.on.nameOf(this.carId) || "this engine";
    const panel = document.createElement("div");
    panel.className = "gs-panel paint-panel";
    const head = document.createElement("div");
    head.className = "gs-head";
    const h = document.createElement("h2");
    h.textContent = "🎨 Paint shop";
    const x = document.createElement("button");
    x.className = "close";
    x.type = "button";
    x.textContent = "✕";
    x.title = "Close";
    x.addEventListener("click", () => this.close());
    head.append(h, x);
    const sub = document.createElement("p");
    sub.className = "paint-sub";
    sub.textContent = `Paint ${name} in your own colours. More colours as your towns grow.`;
    const grid = document.createElement("div");
    grid.className = "paint-swatches";
    const states = new Map<string, PaintState>();
    const swatch = (id: string, label: string, body: string, trim: string, note: string, state: PaintState, stripe?: Stripe) => {
      states.set(id, state);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `paint-swatch ${state}${this.chosen === id ? " chosen" : ""}`;
      b.dataset.livery = id || "as-it-came";
      b.disabled = state === "locked";
      const dot = document.createElement("i");
      // (A stripe across the middle: a gold line, or the rainbow's bands.)
      const bands = stripe ? stripeColours(stripe) : [];
      const w = bands.length > 1 ? 4 : 3;
      const top = 50 - (bands.length * w) / 2;
      const stripes = bands.map((c, i) => `linear-gradient(to bottom, transparent ${top + i * w}%, ${c} ${top + i * w}% ${top + (i + 1) * w}%, transparent ${top + (i + 1) * w}%)`);
      dot.style.background = [...stripes, `linear-gradient(135deg, ${body} 0 62%, ${trim} 62% 100%)`].join(", ");
      const l = document.createElement("span");
      l.textContent = label;
      const n = document.createElement("small");
      n.textContent = note;
      b.append(dot, l, n);
      b.addEventListener("click", () => {
        this.chosen = id;
        this.draw();
      });
      grid.append(b);
    };
    swatch("", "As it came", "#2d6b3f", "#c8442f", current === "" ? "✓" : "Free", current === "" ? "have" : "paint");
    for (const l of LIVERIES) {
      const s = paintState(p, l, current);
      const note = s === "have" ? "✓" : s === "locked" ? `🔒 ${townLevel(l.level).name}` : `${l.price} 🪙`;
      swatch(l.id, l.label, l.body, l.trim, note, s, l.stripe);
    }
    const go = document.createElement("button");
    go.type = "button";
    go.className = "chip text primary paint-go";
    const chosen = this.chosen;
    const state = states.get(chosen) ?? "have";
    const label = chosen === "" ? "as it came" : (LIVERIES.find((l) => l.id === chosen)?.label.toLowerCase() ?? "");
    const price = LIVERIES.find((l) => l.id === chosen)?.price ?? 0;
    go.textContent = state === "have" ? "Painted ✓" : state === "saving" ? "Research first" : state === "short" ? `Needs ${price} 🪙` : chosen === "" ? "Paint it as it came" : `Paint ${label} · ${price} 🪙`;
    go.disabled = state !== "paint";
    go.addEventListener("click", () => {
      if (this.on.paint(this.carId, chosen)) this.draw();
    });
    panel.append(head, sub, grid, go);
    this.root.replaceChildren(panel);
  }
}
