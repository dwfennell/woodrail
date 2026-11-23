import type { SwapChoice } from "../game/swap-engine";
import type { CarLook } from "../sim";

/**
 * Swap engine's sheet (game/swap-engine.ts, spec 2026-11-23-swap-engine.md): the open engine's name, and a row per
 * engine kind it could become (what it does, and a note where it matters). A tap on a row swaps it and closes the
 * sheet. Built when it opens; never per frame.
 */
export class EngineSheet {
  readonly root = document.createElement("div");
  private carId = -1;
  /** When it opened: the tap that opened it isn't a tap on its backdrop (a phone's click follows the touch). */
  private openedAt = 0;

  constructor(
    private readonly on: {
      /** The rows for engine `carId` (`swapChoices`). */
      choices(carId: number): SwapChoice[];
      nameOf(carId: number): string;
      /** Swap engine `carId` for `look`. True if it was (the sheet closes). */
      swap(carId: number, look: CarLook): boolean;
    },
  ) {
    this.root.className = "growth-sheet engine-sheet";
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
    this.openedAt = performance.now();
    this.root.hidden = false;
    this.draw();
  }

  close(): void {
    this.root.hidden = true;
    this.carId = -1;
  }

  private draw(): void {
    const name = this.on.nameOf(this.carId) || "this train";
    const panel = document.createElement("div");
    panel.className = "gs-panel engine-panel";
    const head = document.createElement("div");
    head.className = "gs-head";
    const h = document.createElement("h2");
    h.textContent = "Swap engine";
    const x = document.createElement("button");
    x.className = "close";
    x.type = "button";
    x.textContent = "✕";
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", () => this.close());
    head.append(h, x);
    const sub = document.createElement("p");
    sub.className = "paint-sub";
    sub.textContent = `A new engine for ${name}: it keeps its name, line, cars and loads.`;
    const list = document.createElement("div");
    list.className = "engine-choices";
    for (const c of this.on.choices(this.carId)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `engine-choice ${c.state}`;
      b.dataset.look = c.look;
      if (c.state === "current" || c.state === "locked") b.setAttribute("aria-disabled", "true");
      const label = document.createElement("span");
      label.className = "engine-choice-label";
      label.textContent = c.label;
      const stats = document.createElement("small");
      stats.className = "engine-choice-stats";
      stats.textContent = c.stats;
      stats.hidden = !c.stats;
      const note = document.createElement("small");
      note.className = "engine-choice-note";
      note.textContent = c.state === "current" ? `✓ ${c.note}` : c.state === "locked" ? `🔒 ${c.note}` : c.note;
      note.hidden = !c.note;
      b.append(label, stats, note);
      b.addEventListener("click", () => {
        if (b.getAttribute("aria-disabled") === "true") return;
        if (this.on.swap(this.carId, c.look)) this.close();
      });
      list.append(b);
    }
    panel.append(head, sub, list);
    this.root.replaceChildren(panel);
  }
}
