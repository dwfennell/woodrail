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

const WHAT = "Share anonymous play stats (which goals people reach, how long they play, any errors) and now and then a copy of your railway, so we can see what people build. No names, nothing that says who you are.";
/** For a player who said yes before the question mentioned railways. */
const MAPS = "Can we also have a copy of your railway now and then? It shows us what people build. No names, nothing that says who you are.";

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

  /**
   * The one-time question. (Or, for a player sharing stats from before railways were part of it, the one about
   * railways alone: a no keeps the stats.)
   */
  ask(): void {
    const r = this.root;
    const maps = this.stats.asksAboutMaps;
    r.replaceChildren(el("div", "card-title", maps ? "💛 Thanks for sharing stats!" : "💛 Help improve Woodrail?"), el("p", "cloud-text", maps ? MAPS : WHAT));
    const row = el("div", "card-row");
    row.append(
      maps ? chip("Just stats", "stats-no", () => this.answerMaps(false)) : chip("No thanks", "stats-no", () => this.answer(false)),
      maps ? chip("Yes, share it", "primary stats-yes", () => this.answerMaps(true)) : chip("Yes, share", "primary stats-yes", () => this.answer(true)),
    );
    r.append(row, el("p", "cloud-credit", "You can change this any time in the ☰ menu."));
    r.hidden = false;
  }

  /** From the menu: what's chosen, and a switch. */
  show(): void {
    const r = this.root;
    const on = this.stats.consent === "yes";
    const maps = this.stats.shareMaps;
    r.replaceChildren(
      el("div", "card-title", "💛 Help improve Woodrail"),
      el("p", "cloud-text", WHAT),
      el("div", "cloud-status", on ? (maps ? "Sharing: thank you!" : "Sharing stats, not your railway: thank you!") : "Not sharing"),
    );
    const row = el("div", "card-row");
    row.append(
      chip(on ? "Stop sharing" : "Share", on ? "" : "primary", () => {
        this.stats.setConsent(!on);
        this.show();
      }),
    );
    // (Sharing: the railway can go on or off by itself.)
    if (on) {
      row.append(
        chip(maps ? "Not my railway" : "Share my railway too", "", () => {
          this.stats.setMaps(!maps);
          this.show();
        }),
      );
    }
    row.append(chip("Done", "", () => this.hide()));
    r.append(row);
    r.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  private answerMaps(yes: boolean): void {
    this.stats.setMaps(yes);
    this.hide();
    this.toast(yes ? "Thank you! We'd love to see it." : "No problem: just the stats, then.");
  }

  private answer(yes: boolean): void {
    this.stats.setConsent(yes);
    this.hide();
    this.toast(yes ? "Thank you! That helps a lot." : "No problem: nothing is shared.");
  }
}
