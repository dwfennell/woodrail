/**
 * A secret site's card (spec 2026-11-05, "Secret sites"; src/game/secrets.ts). Not found yet: a guess at what's in the
 * mist and how to find it. Found: its halt's card, its tourist trips the big number (this year and the fares under
 * it), the Exploring sticker's progress over all secrets, and the towns its tourists came from. Drawn again only when
 * what it shows changes (`show` compares a key), never per frame for nothing.
 */

export interface SecretCardTown {
  name: string;
  trips: number;
}

export type SecretCardView =
  | { id: number; found: false; title: string; text: string }
  | {
      id: number;
      found: true;
      title: string;
      trips: number;
      thisYear: number;
      fares: number;
      /** The Exploring sticker: the tier reached ("" none yet), all secrets' trips, the next tier and its name (null: all). */
      tier: string;
      all: number;
      next: { at: number; name: string } | null;
      /** Its tourists' towns, most first (the rest summed as "Other towns"). */
      towns: SecretCardTown[];
      /** Midsummer at the stones: a line about it. */
      note: string;
    };

export interface SecretCardHandlers {
  close(): void;
}

/** Towns listed by name before the rest are summed. */
const TOWNS_SHOWN = 3;

export class SecretCard {
  readonly el: HTMLDivElement;
  private shownKey = "";
  private shownId = -1;

  /** The secret whose card is open (−1: none). */
  get openId(): number {
    return this.el.hidden ? -1 : this.shownId;
  }

  constructor(private readonly h: SecretCardHandlers) {
    this.el = document.createElement("div");
    this.el.className = "card secret-card";
    this.el.setAttribute("role", "dialog");
    this.el.hidden = true;
  }

  show(view: SecretCardView): void {
    this.shownId = view.id;
    this.el.hidden = false;
    const key = JSON.stringify(view);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.render(view);
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.shownKey = "";
  }

  private render(v: SecretCardView): void {
    const el = this.el;
    el.innerHTML = "";
    el.classList.toggle("found", v.found);
    el.append(text("card-title secret-title", v.title));
    if (!v.found) {
      el.append(text("secret-hint", v.text));
      el.append(button("close", "✕", "Close", () => this.h.close()));
      return;
    }
    const chips = div("secret-chips");
    chips.append(text("secret-chip found-chip", "🌟 Secret found"), text("secret-chip fare-chip", "🧑 Tourists ×2 fare"));
    el.append(chips);
    const count = div("secret-count");
    count.append(text("secret-trips", v.trips.toLocaleString("en-GB")), text("secret-trips-label", v.trips === 1 ? "tourist trip here" : "tourist trips here"));
    el.append(count);
    el.append(text("secret-year", `${v.thisYear.toLocaleString("en-GB")} this year · 🪙 ${Math.round(v.fares).toLocaleString("en-GB")} in fares`));
    // The Exploring sticker, over all secrets.
    const tier = div("secret-tier");
    const head = div("secret-tier-head");
    head.append(text("secret-tier-name", v.tier ? `🚩 ${v.tier}` : "🎫 Exploring"), text("secret-tier-count", v.next ? `all secrets: ${v.all} / ${v.next.at}` : `all secrets: ${v.all}`));
    tier.append(head);
    if (v.next) {
      const bar = div("secret-bar");
      const fill = div("secret-bar-fill");
      fill.style.width = `${Math.min(100, Math.round((v.all / v.next.at) * 100))}%`;
      bar.append(fill);
      tier.append(bar, text("secret-tier-next", `${v.next.name} at ${v.next.at}`));
    } else tier.append(text("secret-tier-next", "Every Exploring sticker earned"));
    el.append(tier);
    if (v.towns.length > 0) {
      const list = div("secret-towns");
      const top = v.towns.slice(0, TOWNS_SHOWN);
      const rest = v.towns.slice(TOWNS_SHOWN).reduce((n, t) => n + t.trips, 0);
      const rows = rest > 0 ? [...top, { name: "Other towns", trips: rest }] : top;
      const most = Math.max(...rows.map((r) => r.trips));
      for (const r of rows) {
        const row = div("secret-town");
        const bar = div("secret-town-bar");
        const fill = div("secret-town-fill");
        fill.style.width = `${Math.max(4, Math.round((r.trips / most) * 100))}%`;
        bar.append(fill);
        row.append(text("secret-town-name", `🧑 ${r.name}`), bar, text("secret-town-n", String(r.trips)));
        list.append(row);
      }
      el.append(list);
    }
    const foot = div("secret-foot");
    foot.innerHTML = `<b>No one lives here:</b> riders from every town get off for a day out, and pay twice the fare.`;
    el.append(foot);
    if (v.note) el.append(text("secret-note", v.note));
    el.append(button("close", "✕", "Close", () => this.h.close()));
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

function text(cls: string, t: string): HTMLDivElement {
  const d = div(cls);
  d.textContent = t;
  return d;
}

function button(cls: string, html: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.innerHTML = html;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
