/**
 * The bar at the foot while a grand project's site is being placed, before it's paid for (spec
 * 2026-11-22-grand-placement.md, step 2): what it is and where, ⟳ to turn it, Cancel, and Build here with its price.
 * While it's up the tray and the goals are hidden (`.hud.siting`), so the thumb is on the bar, not under the site.
 * Nothing per frame: written only when it opens or the site moves.
 */
export interface SiteBarActions {
  build(): void;
  cancel(): void;
  turn(): void;
}

export class SiteBar {
  readonly el = document.createElement("div");
  private readonly text = document.createElement("div");
  private readonly buildBtn = document.createElement("button");

  constructor(
    private readonly hud: HTMLElement,
    actions: SiteBarActions,
  ) {
    this.el.className = "site-bar";
    this.el.hidden = true;
    this.text.className = "site-text";
    const row = document.createElement("div");
    row.className = "site-row";
    const turn = button("chip site-turn", "⟳", actions.turn);
    turn.title = "Turn it";
    turn.setAttribute("aria-label", "Turn it");
    const cancel = button("chip text site-cancel", "Cancel", actions.cancel);
    this.buildBtn = button("chip primary site-build", "Build here", actions.build);
    row.append(turn, cancel, this.buildBtn);
    this.el.append(this.text, row);
    hud.append(this.el);
  }

  get open(): boolean {
    return !this.el.hidden;
  }

  /** Up, for project `name` (its icon) by `town`, at `coins`. */
  show(icon: string, name: string, town: string, coins: number): void {
    this.text.textContent = `${icon} Drag the ${name} where you'd like it by ${town}`;
    this.buildBtn.textContent = `Build here · 🪙 ${coins}`;
    this.el.hidden = false;
    this.hud.classList.add("siting");
  }

  hide(): void {
    this.el.hidden = true;
    this.hud.classList.remove("siting");
  }
}

function button(cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}
