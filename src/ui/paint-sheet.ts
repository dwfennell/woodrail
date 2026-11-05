import { LIVERIES, ownColours, PAINT_COLOURS, paintState, type PaintState } from "../game/paint-shop";
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
  /** Your own colours (Paint your trains learned): the body and trim picked, which the grid sets, and the wagons too? */
  private own = { body: PAINT_COLOURS[11], trim: PAINT_COLOURS[1], part: "body" as "body" | "trim", wagons: true };
  /** When it opened: the tap that opened it isn't a tap on its backdrop (a phone's click follows the touch). */
  private openedAt = 0;

  constructor(
    private readonly on: {
      /** Paint engine `carId` in `id` ("": as it came). True if it was painted. */
      paint(carId: number, id: string): boolean;
      progress(): Progress;
      liveryOf(carId: number): string;
      nameOf(carId: number): string;
      /** Your own colours open (Paint your trains learned)? */
      ownOpen(): boolean;
      /** The wagons in engine `carId`'s train that can be painted. */
      wagonsOf(carId: number): number[];
      /** Pots of paint at the workshops. */
      pots(): number;
      /** Paint cars `carIds` in your own colours (a pot a car). True if it did. */
      paintOwn(carIds: number[], body: string, trim: string): boolean;
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
    const own = ownColours(this.chosen);
    if (own) Object.assign(this.own, own);
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
    const swatch = (id: string, label: string, body: string, trim: string, note: string, state: PaintState) => {
      states.set(id, state);
      const b = document.createElement("button");
      b.type = "button";
      b.className = `paint-swatch ${state}${this.chosen === id ? " chosen" : ""}`;
      b.dataset.livery = id || "as-it-came";
      b.disabled = state === "locked";
      const dot = document.createElement("i");
      dot.style.background = `linear-gradient(135deg, ${body} 0 62%, ${trim} 62% 100%)`;
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
    if (this.on.ownOpen()) {
      const t = document.createElement("h3");
      t.className = "paint-title";
      t.textContent = "Ready-made";
      grid.before(t);
    }
    swatch("", "As it came", "#2d6b3f", "#c8442f", current === "" ? "✓" : "Free", current === "" ? "have" : "paint");
    for (const l of LIVERIES) {
      const s = paintState(p, l, current);
      const note = s === "have" ? "✓" : s === "locked" ? `🔒 ${townLevel(l.level).name}` : `${l.price} 🪙`;
      swatch(l.id, l.label, l.body, l.trim, note, s);
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
    panel.append(head, sub, ...(this.on.ownOpen() ? this.ownBlock() : []), grid, go);
    this.root.replaceChildren(panel);
  }

  /**
   * Your own colours: a swatch of the engine as it'd look, Body and Trim to pick which the grid sets, a grid of
   * `PAINT_COLOURS`, "and its N wagons", and Paint (a pot of paint a car, from the workshop).
   */
  private ownBlock(): HTMLElement[] {
    const o = this.own;
    const t = document.createElement("h3");
    t.className = "paint-title";
    t.textContent = "Your own colours";
    const row = document.createElement("div");
    row.className = "paint-own-row";
    const look = document.createElement("i");
    look.className = "paint-own-look";
    look.style.background = `linear-gradient(135deg, ${o.body} 0 62%, ${o.trim} 62% 100%)`;
    row.append(look);
    for (const part of ["body", "trim"] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip text paint-part${o.part === part ? " on" : ""}`;
      b.dataset.part = part;
      b.setAttribute("aria-pressed", String(o.part === part));
      const dot = document.createElement("i");
      dot.style.background = o[part];
      b.append(dot, part === "body" ? "Body" : "Trim");
      b.addEventListener("click", () => {
        o.part = part;
        this.draw();
      });
      row.append(b);
    }
    const grid = document.createElement("div");
    grid.className = "paint-colours";
    for (const c of PAINT_COLOURS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `paint-colour${o[o.part] === c ? " chosen" : ""}`;
      b.dataset.colour = c;
      b.title = c;
      b.setAttribute("aria-label", `${o.part === "body" ? "Body" : "Trim"} ${c}`);
      b.style.background = c;
      b.addEventListener("click", () => {
        o[o.part] = c;
        this.draw();
      });
      grid.append(b);
    }
    const wagons = this.on.wagonsOf(this.carId);
    const extra: HTMLElement[] = [];
    if (wagons.length > 0) {
      const w = document.createElement("button");
      w.type = "button";
      w.className = `chip text paint-wagons${o.wagons ? " on" : ""}`;
      w.setAttribute("aria-pressed", String(o.wagons));
      w.textContent = `${o.wagons ? "✓ " : ""}And its ${wagons.length === 1 ? "wagon" : `${wagons.length} wagons`}`;
      w.addEventListener("click", () => {
        o.wagons = !o.wagons;
        this.draw();
      });
      extra.push(w);
    }
    const cars = [this.carId, ...(o.wagons ? wagons : [])];
    const pots = this.on.pots();
    const go = document.createElement("button");
    go.type = "button";
    go.className = "chip text primary paint-own-go";
    go.textContent = pots < cars.length ? `Needs ${cars.length} 🎨 paint at the workshop (has ${pots})` : `Paint ${cars.length === 1 ? "it" : `all ${cars.length}`} · ${cars.length} 🎨 paint`;
    go.disabled = pots < cars.length;
    go.addEventListener("click", () => {
      if (this.on.paintOwn(cars, o.body, o.trim)) {
        this.chosen = this.on.liveryOf(this.carId);
        this.draw();
      }
    });
    const foot = document.createElement("div");
    foot.className = "paint-own-foot";
    foot.append(...extra, go);
    return [t, row, grid, foot];
  }
}
