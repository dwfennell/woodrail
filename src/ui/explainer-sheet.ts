import { helpPage, type HelpBlock, type HelpLink, type HelpPage } from "./help";
import { HELP_HOME } from "./help-link";

/**
 * The "Learn more" sheet: a help page (help.ts) as a card over the game: an explainer (explainers.ts), its sections
 * each a heading, a few lines and a small picture; or an industry's, a research row's, a good's, an engine's or a
 * wagon's facts, its links each to another page in the sheet (never out of the game). Built the first time it's opened
 * (nothing is made, drawn or listened to before), and redrawn only when another page is shown. Back goes back a page,
 * and closes it from the first; ✕ or Escape closes it; what was being placed is still ready.
 */
export class ExplainerSheet {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private shownId: string | null = null;
  /** The pages this one was opened from ("More about routes" from Signals): Back goes to the last. */
  private trail: string[] = [];
  private onClose: (() => void) | null = null;
  private body: HTMLElement;
  private titleEl: HTMLElement;
  private back: HTMLButtonElement;

  constructor(parent: HTMLElement) {
    // A dimmed backdrop over the game (a tap on it closes the sheet, and never reaches the map), the card on it.
    const scrim = (this.root = document.createElement("div"));
    scrim.className = "explainer-scrim";
    scrim.hidden = true;
    const r = (this.card = document.createElement("div"));
    r.className = "card explainer-sheet";
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-modal", "true");
    scrim.append(r);
    // (Taps on it are its own: none reaches the map or the tray under it.)
    for (const t of ["pointerdown", "pointerup", "wheel", "touchstart"] as const) scrim.addEventListener(t, (e) => e.stopPropagation(), { passive: true });
    scrim.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === scrim) this.hide();
    });
    scrim.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
      e.stopPropagation();
    });
    this.titleEl = document.createElement("div");
    this.titleEl.className = "card-title explainer-title";
    this.titleEl.id = "explainer-title";
    r.setAttribute("aria-labelledby", this.titleEl.id);
    const x = document.createElement("button");
    x.type = "button";
    x.className = "close explainer-x";
    x.textContent = "✕";
    x.title = "Close";
    x.setAttribute("aria-label", "Close");
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
    });
    this.body = document.createElement("div");
    this.body.className = "explainer-body";
    const row = document.createElement("div");
    row.className = "card-row explainer-row";
    this.back = document.createElement("button");
    this.back.type = "button";
    this.back.className = "chip text primary explainer-back";
    this.back.textContent = "Back";
    this.back.addEventListener("click", (e) => {
      e.stopPropagation();
      const last = this.trail.pop();
      if (last) this.show(last);
      else this.hide();
    });
    row.append(this.back);
    r.append(this.titleEl, x, this.body, row);
    parent.appendChild(scrim);
  }

  /** Is it open? */
  get shown(): string | null {
    return this.shownId;
  }

  /** Open help page `ref` (an explainer's id, "industries/sawmill", …; `onClose` when it's closed). */
  show(ref: string, onClose?: () => void): void {
    if (onClose) this.trail = [];
    const page = helpPage(ref);
    if (this.shownId !== page.ref) this.draw(page);
    this.shownId = page.ref;
    this.onClose = onClose ?? this.onClose;
    this.root.hidden = false;
    this.card.scrollTop = 0;
    this.back.focus({ preventScroll: true });
  }

  hide(): void {
    if (this.shownId === null) return;
    this.shownId = null;
    this.trail = [];
    this.root.hidden = true;
    const done = this.onClose;
    this.onClose = null;
    done?.();
  }

  /** A link to page `l.ref` (opened in the sheet, this page kept for Back), or its plain words if it has none. */
  private link(l: HelpLink, cls: string): HTMLElement {
    const b = document.createElement(l.ref ? "button" : "span");
    b.className = cls;
    if (l.icon) {
      const i = document.createElement("span");
      i.className = "help-icon";
      i.setAttribute("aria-hidden", "true");
      i.textContent = l.icon;
      b.append(i);
    }
    const name = document.createElement("span");
    name.className = "help-name";
    name.textContent = l.name;
    b.append(name);
    if (l.line) {
      const line = document.createElement("span");
      line.className = "help-line";
      line.textContent = l.line;
      b.append(line);
    }
    if (l.ref && b instanceof HTMLButtonElement) {
      const ref = l.ref;
      b.type = "button";
      b.dataset.help = ref;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.shownId) this.trail.push(this.shownId);
        this.show(ref);
      });
    }
    return b;
  }

  private block(b: HelpBlock): HTMLElement {
    const sec = document.createElement("section");
    const heading = (text: string | undefined) => {
      if (!text) return;
      const h = document.createElement("h3");
      h.className = "explainer-heading";
      h.textContent = text;
      sec.append(h);
    };
    if (b.kind === "section") {
      const s = b.section;
      sec.className = "explainer-section";
      const pic = document.createElement("div");
      pic.className = "explainer-picture";
      pic.setAttribute("role", "img");
      pic.setAttribute("aria-label", s.alt);
      // (Our own drawings, from explainers.ts: no outside text goes in here.)
      pic.innerHTML = s.picture;
      sec.append(pic);
      heading(s.heading);
      const p = document.createElement("p");
      p.className = "explainer-text";
      p.textContent = s.text;
      sec.append(p);
    } else if (b.kind === "list") {
      sec.className = "help-section";
      heading(b.heading);
      const ul = document.createElement("ul");
      ul.className = "help-list";
      for (const l of b.links) {
        const li = document.createElement("li");
        li.append(this.link(l, l.ref ? "help-item" : "help-item plain"));
        ul.append(li);
      }
      sec.append(ul);
    } else {
      sec.className = "help-section";
      heading(b.heading);
      const dl = document.createElement("dl");
      dl.className = "help-facts";
      for (const f of b.facts) {
        const row = document.createElement("div");
        const dt = document.createElement("dt");
        dt.textContent = f.term;
        const dd = document.createElement("dd");
        if (f.text) {
          const t = document.createElement("span");
          t.className = "help-fact-text";
          t.textContent = f.text;
          dd.append(t);
        }
        for (const l of f.links ?? []) dd.append(this.link(l, "learn-more help-chip"));
        row.append(dt, dd);
        dl.append(row);
      }
      sec.append(dl);
    }
    return sec;
  }

  private draw(x: HelpPage): void {
    this.titleEl.textContent = x.title;
    this.card.style.setProperty("--band", x.band ?? "transparent");
    this.card.classList.toggle("banded", !!x.band);
    const parts: HTMLElement[] = [];
    if (x.intro) {
      const intro = document.createElement("p");
      intro.className = "explainer-intro";
      intro.textContent = x.intro;
      parts.push(intro);
    }
    for (const b of x.blocks) parts.push(this.block(b));
    const more = document.createElement("div");
    more.className = "explainer-more";
    for (const l of x.more ?? []) {
      const b = this.link(l, "learn-more explainer-see");
      b.dataset.explainer = l.ref;
      more.append(b);
    }
    // Every page but the front one leads to it: the way to any other topic.
    if (x.ref !== HELP_HOME) more.append(this.link({ name: "All help topics", ref: HELP_HOME }, "learn-more help-home"));
    parts.push(more);
    this.body.replaceChildren(...parts);
  }
}
