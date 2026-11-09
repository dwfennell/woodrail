/**
 * ☰ Credits: the things Woodrail is made with that ask to be named. The EFF's word list (CC BY 3.0, for the cloud
 * save's code words) needs its attribution and licence link somewhere a player can find it; the font and the
 * libraries are named with their licences too. Opened from the menu; nothing is drawn till it is.
 */

export interface Credit {
  /** What it is, as a player would call it. */
  what: string;
  /** Who made it. */
  by: string;
  /** What it's used for in the game. */
  use: string;
  licence: string;
  /** The licence's text, or the work's own page where it gives the licence. */
  link: string;
  /** The work's page (optional). */
  home?: string;
}

export const CREDITS: readonly Credit[] = [
  {
    what: "EFF Short Wordlist 1",
    by: "Electronic Frontier Foundation",
    use: "The words in your cloud save code (cut to 1024 words)",
    licence: "CC BY 3.0",
    link: "https://creativecommons.org/licenses/by/3.0/",
    home: "https://www.eff.org/dice",
  },
  {
    what: "Nunito",
    by: "Vernon Adams, Cyreal and Jacques Le Bailly",
    use: "The lettering",
    licence: "SIL Open Font License 1.1",
    link: "https://openfontlicense.org/",
    home: "https://fonts.google.com/specimen/Nunito",
  },
  {
    what: "Lilita One",
    by: "Juan Montoreano",
    use: "The titles and buttons",
    licence: "SIL Open Font License 1.1",
    link: "https://openfontlicense.org/",
    home: "https://fonts.google.com/specimen/Lilita+One",
  },
  { what: "three.js", by: "The three.js authors", use: "Drawing the 3D world", licence: "MIT", link: "https://github.com/mrdoob/three.js/blob/dev/LICENSE" },
  { what: "three-mesh-bvh and three-bvh-csg", by: "Garrett Johnson", use: "Carving the track pieces", licence: "MIT", link: "https://github.com/gkjohnson/three-mesh-bvh/blob/master/LICENSE" },
  { what: "polygon-clipping", by: "Mike Fogel", use: "Shaping the track pieces", licence: "MIT", link: "https://github.com/mfogel/polygon-clipping/blob/master/LICENSE" },
  { what: "meshoptimizer", by: "Arseny Kapoulkine", use: "Simpler buildings far away", licence: "MIT", link: "https://github.com/zeux/meshoptimizer/blob/master/LICENSE.md" },
  { what: "Zod", by: "Colin McDonnell", use: "Checking saves as they load", licence: "MIT", link: "https://github.com/colinhacks/zod/blob/main/LICENSE" },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function link(href: string, text: string): HTMLAnchorElement {
  const a = el("a", "credits-link", text);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  return a;
}

export class CreditsSheet {
  readonly root = el("div", "card report-card credits-sheet");
  private drawn = false;

  constructor(parent: HTMLElement) {
    const r = this.root;
    r.hidden = true;
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-label", "Credits");
    r.addEventListener("pointerdown", (e) => e.stopPropagation());
    r.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.hide();
      e.stopPropagation();
    });
    parent.appendChild(r);
  }

  private draw(): void {
    const list = el("ul", "credits-list");
    for (const c of CREDITS) {
      const li = el("li", "credits-item");
      const head = el("div", "credits-what");
      head.append(c.home ? link(c.home, c.what) : el("span", "", c.what));
      li.append(head, el("div", "credits-by", `${c.by}. ${c.use}.`));
      const lic = el("div", "credits-licence");
      lic.append(link(c.link, c.licence));
      li.append(lic);
      list.append(li);
    }
    const row = el("div", "card-row");
    const close = el("button", "chip text primary credits-close", "Close");
    close.type = "button";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hide();
    });
    row.append(close);
    this.root.append(el("div", "card-title", "Credits"), el("p", "credits-intro", "Woodrail is made with these, with thanks."), list, row);
    this.drawn = true;
  }

  show(): void {
    if (!this.drawn) this.draw();
    this.root.hidden = false;
    this.root.querySelector<HTMLButtonElement>(".credits-close")?.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
  }
}
