import type { Stats } from "../stats/stats";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function chip(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `chip text ${cls}`.trim(), label);
  b.type = "button";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

const WHAT = "Share anonymous play stats: which goals people reach, how long they play, and any errors. No railways, no names.";

/**
 * "Help improve Woodrail": asks once (after the first goal) whether to share anonymous play stats, and from the menu
 * shows the answer and lets it be changed. Nothing is sent before a yes (see stats/stats.ts).
 */
export class StatsCard {
  readonly root = el("div", "card cloud-card stats-card");

  constructor(
    parent: HTMLElement,
    private readonly stats: Stats,
    private readonly toast: (m: string) => void,
  ) {
    this.root.hidden = true;
    this.root.addEventListener("pointerdown", (e) => e.stopPropagation());
    parent.appendChild(this.root);
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /** The one-time question. */
  ask(): void {
    const r = this.root;
    r.replaceChildren(el("div", "card-title", "💛 Help improve Woodrail?"), el("p", "cloud-text", WHAT));
    const row = el("div", "card-row");
    row.append(
      chip("No thanks", "stats-no", () => this.answer(false)),
      chip("Yes, share", "primary stats-yes", () => this.answer(true)),
    );
    r.append(row, el("p", "cloud-credit", "You can change this any time in the ☰ menu."));
    r.hidden = false;
  }

  /** From the menu: what's chosen, and a switch. */
  show(): void {
    const r = this.root;
    const on = this.stats.consent === "yes";
    r.replaceChildren(
      el("div", "card-title", "💛 Help improve Woodrail"),
      el("p", "cloud-text", WHAT),
      el("div", "cloud-status", on ? "Sharing: thank you!" : "Not sharing"),
    );
    const row = el("div", "card-row");
    row.append(
      chip(on ? "Stop sharing" : "Share stats", on ? "" : "primary", () => {
        this.stats.setConsent(!on);
        this.show();
      }),
      chip("Done", "", () => this.hide()),
    );
    r.append(row);
    r.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private answer(yes: boolean): void {
    this.stats.setConsent(yes);
    this.hide();
    this.toast(yes ? "Thank you! That helps a lot." : "No problem: nothing is shared.");
  }
}
