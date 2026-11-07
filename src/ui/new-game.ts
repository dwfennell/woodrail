import type { GameMode } from "../game/modes";
import { DEFAULT_HILLS, HILLINESS, HILLS_BLURB, HILLS_LABEL, isHilliness, type Hilliness } from "../landscape/hills";

/**
 * The new-game sheet: what the next map is to be like, chosen before it's made (from the title's New game or New map,
 * and ☰ New game or New map in play). One row per choice (`NEW_GAME_ROWS`): Hills, for now. A choice is saved with the
 * map it makes (`Landscape.hills`), and remembered here for the next new game. Nothing is drawn till it first opens.
 */

/** What a new map is made with. */
export interface NewGameChoices {
  hills: Hilliness;
}

export const DEFAULT_CHOICES: NewGameChoices = { hills: DEFAULT_HILLS };

/** A row of the sheet: its name and its steps (in order), each a chip. */
export interface NewGameRow<K extends keyof NewGameChoices = keyof NewGameChoices> {
  key: K;
  label: string;
  steps: readonly { value: NewGameChoices[K]; label: string; blurb: string; picture: string }[];
}

/** Little block hills for the Hills chips: flat felt to high peaks (24 × 14, stroked in the chip's ink). */
const HILL_PICTURES: Record<Hilliness, string> = {
  flat: "M1 12H23",
  gentle: "M1 12H7Q11 7 15 12H23",
  hilly: "M1 12Q5 5 9 12Q14 3 19 12H23",
  mountains: "M1 12L5 6L8 9L12 2L16 9L19 5L23 12",
};

export const NEW_GAME_ROWS: readonly NewGameRow[] = [
  {
    key: "hills",
    label: "Hills",
    steps: HILLINESS.map((h) => ({ value: h, label: HILLS_LABEL[h], blurb: HILLS_BLURB[h], picture: HILL_PICTURES[h] })),
  },
];

const STORE_KEY = "woodrail.newGame";

/** The choices made last time (or the defaults): each row's own, so one stored by an older build is kept or dropped alone. */
export function loadChoices(storage: Pick<Storage, "getItem"> | null = safeStorage()): NewGameChoices {
  const out = { ...DEFAULT_CHOICES };
  try {
    const raw = storage?.getItem(STORE_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
    if (v && isHilliness(v.hills)) out.hills = v.hills;
  } catch {
    // unreadable: the defaults
  }
  return out;
}

export function saveChoices(c: NewGameChoices, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(STORE_KEY, JSON.stringify(c));
  } catch {
    // no storage: asked afresh next time
  }
}

function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export interface NewGameAsk {
  mode: GameMode;
  /** Said above the rows: what starting now does to the railway in play (from ☰), if anything. */
  warn?: string;
  start(choices: NewGameChoices): void;
  /** Back (or Esc, or a tap beside the sheet): nothing is made. */
  cancel?(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class NewGameSheet {
  readonly root = el("div", "card new-game-sheet");
  private readonly shade = el("div", "new-game-shade");
  private ask: NewGameAsk | null = null;
  private choices: NewGameChoices = { ...DEFAULT_CHOICES };
  private drawn = false;
  private readonly titleEl = el("div", "card-title");
  private readonly warnEl = el("p", "new-game-warn");
  private readonly startBtn = el("button", "chip text primary new-game-start");
  private readonly rowEls = new Map<keyof NewGameChoices, { chips: HTMLButtonElement[]; blurb: HTMLElement }>();

  constructor(parent: HTMLElement) {
    const r = this.root;
    r.hidden = true;
    this.shade.hidden = true;
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-modal", "true");
    r.addEventListener("pointerdown", (e) => e.stopPropagation());
    r.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.cancel();
      e.stopPropagation();
    });
    // A tap beside the sheet is Back.
    this.shade.addEventListener("pointerdown", (e) => e.stopPropagation());
    this.shade.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cancel();
    });
    parent.append(this.shade, r);
  }

  get shown(): boolean {
    return !this.root.hidden;
  }

  /** What the sheet has picked now. */
  get picked(): NewGameChoices {
    return { ...this.choices };
  }

  /** Open the sheet for a new map in `ask.mode`, on the choices made last time. */
  open(ask: NewGameAsk): void {
    if (!this.drawn) this.draw();
    this.ask = ask;
    this.choices = loadChoices();
    const game = ask.mode === "game";
    this.titleEl.textContent = game ? "New game" : "New map";
    this.root.setAttribute("aria-label", this.titleEl.textContent);
    this.startBtn.textContent = game ? "Start" : "Make the map";
    this.warnEl.textContent = ask.warn ?? "";
    this.warnEl.hidden = !ask.warn;
    this.sync();
    this.shade.hidden = false;
    this.root.hidden = false;
    this.startBtn.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
    this.shade.hidden = true;
    this.ask = null;
  }

  /** Pick a row's step (a chip's tap). */
  pick<K extends keyof NewGameChoices>(key: K, value: NewGameChoices[K]): void {
    this.choices[key] = value;
    this.sync();
  }

  private start(): void {
    const ask = this.ask;
    if (!ask) return;
    const c = this.picked;
    saveChoices(c);
    this.hide();
    ask.start(c);
  }

  private cancel(): void {
    const ask = this.ask;
    this.hide();
    ask?.cancel?.();
  }

  private draw(): void {
    const rows = el("div", "new-game-rows");
    for (const row of NEW_GAME_ROWS) {
      const box = el("div", `new-game-row row-${row.key}`);
      const name = el("div", "new-game-label", row.label);
      name.id = `new-game-${row.key}`;
      const group = el("div", "new-game-steps");
      group.setAttribute("role", "radiogroup");
      group.setAttribute("aria-labelledby", name.id);
      const blurb = el("p", "new-game-blurb");
      blurb.setAttribute("aria-live", "polite");
      const chips = row.steps.map((s) => {
        const b = el("button", "chip text new-game-step");
        b.type = "button";
        b.setAttribute("role", "radio");
        b.dataset[row.key] = String(s.value);
        b.title = s.blurb;
        b.innerHTML = `<svg class="new-game-pic" viewBox="0 0 24 14" aria-hidden="true"><path d="${s.picture}"/></svg><span></span>`;
        b.querySelector("span")!.textContent = s.label;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          this.pick(row.key, s.value);
        });
        group.append(b);
        return b;
      });
      // Arrow keys move along the steps (a radio group's keys).
      group.addEventListener("keydown", (e) => {
        const at = chips.indexOf(document.activeElement as HTMLButtonElement);
        const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (at === -1 || step === 0) return;
        e.preventDefault();
        const next = chips[(at + step + chips.length) % chips.length];
        next.focus();
        next.click();
      });
      box.append(name, group, blurb);
      rows.append(box);
      this.rowEls.set(row.key, { chips, blurb });
    }
    const foot = el("div", "card-row new-game-foot");
    const back = el("button", "chip text new-game-back", "Back");
    back.type = "button";
    back.addEventListener("click", (e) => {
      e.stopPropagation();
      this.cancel();
    });
    this.startBtn.type = "button";
    this.startBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.start();
    });
    foot.append(back, this.startBtn);
    this.root.append(this.titleEl, this.warnEl, rows, foot);
    this.drawn = true;
  }

  /** Each row's chips and words as the choices stand. */
  private sync(): void {
    for (const row of NEW_GAME_ROWS) {
      const els = this.rowEls.get(row.key);
      if (!els) continue;
      const value = this.choices[row.key];
      row.steps.forEach((s, k) => {
        const on = s.value === value;
        const chip = els.chips[k];
        chip.classList.toggle("active", on);
        chip.setAttribute("aria-checked", String(on));
        chip.tabIndex = on ? 0 : -1;
      });
      els.blurb.textContent = row.steps.find((s) => s.value === value)?.blurb ?? "";
    }
  }
}
