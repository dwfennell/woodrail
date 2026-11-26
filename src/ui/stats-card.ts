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

const WHAT = "Share your play stats under a random number made on this device, so we can see how a player gets on (which goals, how long, any errors), and now and then a copy of your railway, to see what people build. No names, nothing that says who you are.";
/** Plain counts (on unless turned off), said in the menu's card. */
const COUNTS = "Either way, Woodrail counts how many games start, which goals are reached and how long play lasts, with no number or anything kept on your device: nothing tells one player from another.";
/** For a player who said yes before the question mentioned railways. */
const MAPS = "Can we also have a copy of your railway now and then? It shows us what people build. No names, nothing that says who you are.";

/**
 * "Help improve Woodrail": asks once (after the first goal) whether to share play stats under a random id, and from the
 * menu shows the answer and lets it be changed, and plain counts (no id) turned off or on (see stats/stats.ts).
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
    r.append(row, el("p", "cloud-credit", maps ? "You can change this any time in the ☰ menu." : "Without a yes, Woodrail only counts plays and goals, with nothing that tells players apart. Change either in the ☰ menu."));
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
    const counts = this.stats.countsOn;
    const countRow = el("div", "card-row");
    countRow.append(
      chip(counts ? "Stop counting" : "Count again", "stats-counts", () => {
        this.stats.setCounts(!counts);
        this.show();
      }),
    );
    r.append(row, el("p", "cloud-text stats-counts-text", COUNTS), el("div", "cloud-status stats-counts-status", counts ? (on ? "Counting: on (your shared stats count instead)" : "Counting: on") : "Counting: off"), countRow);
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
    this.toast(yes ? "Thank you! That helps a lot." : "No problem: your stats and railway stay with you.");
  }
}
