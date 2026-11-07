import type { GameMode } from "../game/modes";
import { DEFAULT_HILLS, HILLINESS, HILLS_BLURB, HILLS_LABEL, isHilliness, type Hilliness } from "../landscape/hills";
import { DEFAULT_WATER, isWaterSetting, MAX_SEED, parseMapCode, WATER, WATER_BLURB, WATER_LABEL, type Water } from "../landscape/water";

/**
 * The new-game screen (a page of its own, over the title or the map, as the title is; Back top left returns to where it
 * was opened from): what the next map is to be like, chosen before it's made (from the title's New game or New map,
 * and ☰ New game or New map in play). Its map seed first (shown, a new one by the dice, or typed: a map code's
 * settings come with it), then one row per choice (`NEW_GAME_ROWS`): Hills, Water, Sea. The choices are saved with the
 * map they make (`Landscape.hills`, `water`, `coast`), and remembered here for the next new game (the seed isn't: each
 * new map gets its own). Nothing is drawn till it first opens.
 */

/** What a new map is made with, besides its seed. */
export interface NewGameChoices {
  hills: Hilliness;
  water: Water;
  /** The sea along one side, or none. */
  coast: boolean;
}

export const DEFAULT_CHOICES: NewGameChoices = { hills: DEFAULT_HILLS, water: DEFAULT_WATER, coast: true };

/** A row of the screen: its name and its steps (in order), each a chip. */
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

/** Rivers for the Water chips: dry felt, a river, two. */
const WATER_PICTURES: Record<Water, string> = {
  none: "M1 12H23",
  some: "M1 8Q4 4 7 8T13 8T19 8T25 8",
  lots: "M1 5Q4 1 7 5T13 5T19 5T25 5M1 11Q4 7 7 11T13 11T19 11T25 11",
};

export const NEW_GAME_ROWS: readonly NewGameRow[] = [
  {
    key: "hills",
    label: "Hills",
    steps: HILLINESS.map((h) => ({ value: h, label: HILLS_LABEL[h], blurb: HILLS_BLURB[h], picture: HILL_PICTURES[h] })),
  },
  {
    key: "water",
    label: "Rivers and lakes",
    steps: WATER.map((w) => ({ value: w, label: WATER_LABEL[w], blurb: WATER_BLURB[w], picture: WATER_PICTURES[w] })),
  },
  {
    key: "coast",
    label: "Sea",
    steps: [
      { value: true, label: "Coast", blurb: "The sea along one side, a plot or two out: harbours, ships and the ferry", picture: "M1 7Q4 3 7 7T13 7T19 7T25 7M1 12H23" },
      { value: false, label: "No sea", blurb: "Land all round: no harbours, ships or ferry", picture: "M1 12H23M5 12Q12 3 19 12" },
    ],
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
    if (v && isWaterSetting(v.water)) out.water = v.water;
    if (v && typeof v.coast === "boolean") out.coast = v.coast;
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
  /** The seed the new map would have (`newMapSeed`): shown, and the player may roll or type another. */
  seed: number;
  /** A fresh seed, for the dice. */
  roll(): number;
  /** Said above the rows: what starting now does to the railway in play (from ☰), if anything. */
  warn?: string;
  start(choices: NewGameChoices, seed: number): void;
  /** Back (or Esc): nothing is made. */
  cancel?(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class NewGameSheet {
  readonly root = el("div", "new-game-sheet");
  private ask: NewGameAsk | null = null;
  private choices: NewGameChoices = { ...DEFAULT_CHOICES };
  private drawn = false;
  private readonly titleEl = el("h2", "new-game-title");
  private readonly warnEl = el("p", "new-game-warn");
  private readonly startBtn = el("button", "chip text primary new-game-start");
  private readonly rowEls = new Map<keyof NewGameChoices, { chips: HTMLButtonElement[]; blurb: HTMLElement }>();
  private readonly seedInput = el("input", "new-game-seed");
  private readonly seedNote = el("p", "new-game-blurb new-game-seed-note");
  /** The seed as it stands (null: what's typed isn't one). */
  private seed: number | null = null;

  constructor(parent: HTMLElement) {
    const r = this.root;
    r.hidden = true;
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-modal", "true");
    r.addEventListener("pointerdown", (e) => e.stopPropagation());
    r.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.cancel();
      e.stopPropagation();
    });
    parent.append(r);
  }

  get shown(): boolean {
    return !this.root.hidden;
  }

  /** What the screen has picked now. */
  get picked(): NewGameChoices {
    return { ...this.choices };
  }

  /** The seed it would start with now (null: what's typed isn't a seed). */
  get pickedSeed(): number | null {
    return this.seed;
  }

  /** Open the sheet for a new map in `ask.mode`, on the choices made last time. */
  open(ask: NewGameAsk): void {
    if (!this.drawn) this.draw();
    this.ask = ask;
    this.choices = loadChoices();
    this.setSeed(ask.seed);
    const game = ask.mode === "game";
    this.titleEl.textContent = game ? "New game" : "New map";
    this.root.setAttribute("aria-label", this.titleEl.textContent);
    this.startBtn.textContent = game ? "Start" : "Make the map";
    this.warnEl.textContent = ask.warn ?? "";
    this.warnEl.hidden = !ask.warn;
    this.sync();
    this.root.hidden = false;
    this.startBtn.focus({ preventScroll: true });
  }

  hide(): void {
    this.root.hidden = true;
    this.ask = null;
  }

  /** Pick a row's step (a chip's tap). */
  pick<K extends keyof NewGameChoices>(key: K, value: NewGameChoices[K]): void {
    this.choices[key] = value;
    this.sync();
  }

  private start(): void {
    const ask = this.ask;
    if (!ask || this.seed === null) return;
    const c = this.picked;
    const seed = this.seed;
    saveChoices(c);
    this.hide();
    ask.start(c, seed);
  }

  /** Show a seed in the box (a fresh one, or the one asked with). */
  private setSeed(seed: number): void {
    this.seed = seed;
    this.seedInput.value = String(seed);
    this.seedTyped(false);
  }

  /**
   * What's in the seed box, read: a seed (up to 9 digits), or a map code ("12345-gentle-water-lots"), whose settings
   * are picked with it (`parseMapCode`: a code names only what isn't as an older map was, so its seed alone is Hilly,
   * Some water and the sea). Anything else: no seed, and Start waits.
   */
  private seedTyped(fromKeys: boolean): void {
    const text = this.seedInput.value.trim();
    const code = parseMapCode(text);
    const ok = code !== null && code.seed <= MAX_SEED;
    this.seed = ok ? code.seed : null;
    if (ok && fromKeys && /-/.test(text)) {
      this.choices = { hills: code.hills, water: code.water, coast: code.coast };
      this.sync();
    }
    this.seedInput.classList.toggle("bad", !ok);
    this.seedInput.setAttribute("aria-invalid", String(!ok));
    this.seedNote.textContent = ok ? "The same seed and choices make the same map" : "A seed is a number, up to 9 digits";
    this.seedNote.classList.toggle("bad", !ok);
    this.startBtn.disabled = !ok;
  }

  private cancel(): void {
    const ask = this.ask;
    this.hide();
    ask?.cancel?.();
  }

  private draw(): void {
    const rows = el("div", "new-game-rows");
    // The map seed: its box, and the dice for a new one.
    const seedRow = el("div", "new-game-row row-seed");
    const seedName = el("label", "new-game-label", "Map seed");
    seedName.htmlFor = this.seedInput.id = "new-game-seed";
    const seedLine = el("div", "new-game-seed-line");
    const s = this.seedInput;
    s.type = "text";
    s.inputMode = "numeric";
    s.autocomplete = "off";
    s.spellcheck = false;
    s.maxLength = 48;
    s.setAttribute("aria-describedby", (this.seedNote.id = "new-game-seed-note"));
    s.addEventListener("input", () => this.seedTyped(true));
    s.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.start();
    });
    // (A die drawn here, not the emoji: the game's pictographs are its own font's, and it has no die.)
    const dice = el("button", "chip text new-game-dice");
    dice.innerHTML = `<svg class="new-game-die" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="16" height="16" rx="4"/><circle cx="6.5" cy="6.5" r="1.6"/><circle cx="13.5" cy="6.5" r="1.6"/><circle cx="10" cy="10" r="1.6"/><circle cx="6.5" cy="13.5" r="1.6"/><circle cx="13.5" cy="13.5" r="1.6"/></svg><span>New</span>`;
    dice.type = "button";
    dice.title = "A new seed: a new map";
    dice.setAttribute("aria-label", "A new seed");
    dice.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.ask) this.setSeed(this.ask.roll());
    });
    seedLine.append(s, dice);
    seedRow.append(seedName, seedLine, this.seedNote);
    rows.append(seedRow);
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
    // Top: Back (to where it was opened from) and the screen's name. The rows scroll between it and Start, at the foot.
    const head = el("div", "new-game-head");
    const foot = el("div", "new-game-foot");
    const back = el("button", "chip text new-game-back", "‹ Back");
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
    head.append(back, this.titleEl);
    foot.append(this.startBtn);
    const body = el("div", "new-game-body");
    body.append(this.warnEl, rows);
    this.root.append(head, body, foot);
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
