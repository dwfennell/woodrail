/**
 * "Your games" (spec docs/superpowers/specs/2026-11-16-multiple-saves.md): every Game-mode game kept on the device, the
 * last played first, each with its picture, name, when it was last played, the time played, its goals and coins, and
 * Open, Rename, Copy and Delete (which asks first). A page of its own, as the new-game screen is; nothing is drawn
 * behind it while it's open (the game is paused or on the title).
 */
import type { GameEntry } from "../persist/slots";
import { NAME_MAX } from "../persist/slots";

export interface GamesHandlers {
  list(): GameEntry[];
  picture(id: string): string | null;
  /** The game being played now (no Open, no Delete: it's the one on screen), or null (from the title). */
  playing(): string | null;
  /** Open a game. A message back: it couldn't (said on the sheet). */
  open(id: string): Promise<string | void>;
  rename(id: string, name: string): void;
  copy(id: string): Promise<string | void>;
  remove(id: string): void;
  /**
   * A "Copy map for a bug report" text pasted, to add as a game beside the others (never over one). What to say:
   * `ok` true when it was added.
   */
  addFromText?(text: string): Promise<{ ok: boolean; say: string }>;
  /** The sheet closed. */
  closed?(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function chip(label: string, cls: string, onTap: () => void): HTMLButtonElement {
  const b = el("button", `chip text ${cls}`, label);
  b.type = "button";
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!b.disabled) onTap();
  });
  return b;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When it was last played: "Today", "Yesterday", "16 Nov" (with the year when it isn't this year's). */
export function playedWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const n = new Date(now);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(n) - day(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== n.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
}

/** Time played: "under a minute", "12 min", "2 h 10 min". */
export function playedFor(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "under a minute";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return min % 60 === 0 ? `${h} h` : `${h} h ${min % 60} min`;
}

/** A game's line under its name. */
export function gameFacts(g: GameEntry, now = Date.now()): string {
  return `${playedWhen(g.played, now)} · ${playedFor(g.playMs)} · ${g.goals === 1 ? "1 goal" : `${g.goals} goals`} · ${g.coins} 🪙`;
}

export class GamesSheet {
  readonly root = el("div", "games-sheet");
  private readonly listEl = el("div", "games-list");
  private readonly noteEl = el("p", "games-note");
  /** "Load a map from text": a button, or the box to paste into (`pasting`). */
  private readonly loadEl = el("div", "games-load");

  constructor(parent: HTMLElement, private readonly h: GamesHandlers) {
    const r = this.root;
    r.hidden = true;
    r.setAttribute("role", "dialog");
    r.setAttribute("aria-modal", "true");
    r.setAttribute("aria-label", "Your games");
    r.addEventListener("pointerdown", (e) => e.stopPropagation());
    r.addEventListener("wheel", (e) => e.stopPropagation());
    r.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
      e.stopPropagation();
    });
    const head = el("div", "new-game-head games-head");
    const back = chip("‹ Back", "new-game-back games-back", () => this.close());
    head.append(back, el("h2", "new-game-title", "Your games"));
    this.noteEl.setAttribute("role", "status");
    this.noteEl.hidden = true;
    const body = el("div", "games-body");
    body.append(this.noteEl, this.listEl);
    if (h.addFromText) body.append(this.loadEl);
    r.append(head, body);
    parent.append(r);
  }

  get shown(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.say("");
    this.draw();
    this.loadClosed();
    this.root.hidden = false;
    this.root.querySelector<HTMLElement>(".games-back")?.focus({ preventScroll: true });
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.listEl.replaceChildren();
    this.h.closed?.();
  }

  /** A note over the list (why something couldn't be done), or none. */
  say(text: string, good = false): void {
    this.noteEl.textContent = text;
    this.noteEl.hidden = !text;
    this.noteEl.classList.toggle("good", good);
  }

  /** "Load a map from text", folded: one button. */
  private loadClosed(): void {
    this.loadEl.replaceChildren(chip("Load a map from text…", "games-load-open", () => this.pasting()));
  }

  /** The box to paste a copied map into, with Add to Your games and Cancel. */
  private pasting(): void {
    const box = el("textarea", "games-load-text");
    box.setAttribute("aria-label", "Map text");
    box.placeholder = "Paste a map copied with ☰ Copy map for a bug report (woodrail-map:1:…)";
    box.rows = 4;
    box.spellcheck = false;
    box.addEventListener("keydown", (e) => e.stopPropagation());
    const add: HTMLButtonElement = chip("Add to Your games", "primary games-load-add", async () => {
      add.disabled = true;
      let r: { ok: boolean; say: string };
      try {
        r = await this.h.addFromText!(box.value);
      } finally {
        add.disabled = false;
      }
      if (this.root.hidden) return;
      if (r.ok) {
        this.draw();
        this.loadClosed();
      }
      this.say(r.say, r.ok);
      this.root.querySelector(".games-body")?.scrollTo({ top: 0 });
    });
    const buttons = el("div", "games-buttons");
    buttons.append(add, chip("Cancel", "games-load-cancel", () => this.loadClosed()));
    this.loadEl.replaceChildren(el("p", "games-load-help", "A game copied as text, from this device or another, is added here as a new game. Nothing is replaced."), box, buttons);
    box.focus();
  }

  /** The list drawn again from the store. */
  draw(): void {
    const playing = this.h.playing();
    const games = this.h.list();
    this.listEl.replaceChildren();
    if (games.length === 0) {
      this.listEl.append(el("p", "games-empty", "No games yet. Start one with New game."));
      return;
    }
    const now = Date.now();
    for (const g of games) this.listEl.append(this.row(g, g.id === playing, now));
  }

  private row(g: GameEntry, isPlaying: boolean, now: number): HTMLElement {
    const row = el("section", "games-row");
    row.dataset.id = g.id;
    const pic = el("div", "games-pic");
    const url = this.h.picture(g.id);
    if (url) {
      const img = el("img", "games-img");
      img.alt = "";
      img.src = url;
      pic.append(img);
    } else pic.classList.add("none");
    const text = el("div", "games-text");
    const name = el("h3", "games-name", g.name);
    text.append(name, el("p", "games-facts", gameFacts(g, now)));
    const top = el("div", "games-top");
    top.append(pic, text);
    const buttons = el("div", "games-buttons");
    const busy = async (b: HTMLButtonElement, run: () => Promise<string | void>) => {
      for (const x of this.listEl.querySelectorAll("button")) x.disabled = true;
      b.classList.add("busy");
      let said: string | void;
      try {
        said = await run();
      } finally {
        b.classList.remove("busy");
      }
      if (this.root.hidden) return;
      this.draw();
      this.say(said ?? "");
    };
    if (isPlaying) buttons.append(el("span", "games-playing", "Playing now"));
    else {
      const open = chip("Open", "primary games-open", () => void busy(open, () => this.h.open(g.id)));
      buttons.append(open);
    }
    const copy: HTMLButtonElement = chip("Copy", "games-copy", () => void busy(copy, () => this.h.copy(g.id)));
    buttons.append(chip("Rename", "games-rename", () => this.renaming(row, g)), copy);
    if (!isPlaying) buttons.append(chip("Delete", "games-delete", () => this.confirming(row, g)));
    row.append(top, buttons);
    return row;
  }

  /** Rename: the name becomes a box, with Save and Cancel. */
  private renaming(row: HTMLElement, g: GameEntry): void {
    const name = row.querySelector(".games-name")!;
    const buttons = row.querySelector(".games-buttons")!;
    const input = el("input", "games-name-input");
    input.value = g.name;
    input.maxLength = NAME_MAX;
    input.setAttribute("aria-label", "Name");
    const save = () => {
      const v = input.value.trim();
      if (v) this.h.rename(g.id, v);
      this.draw();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save();
      else if (e.key === "Escape") {
        e.preventDefault();
        this.draw();
      }
      e.stopPropagation();
    });
    name.replaceWith(input);
    buttons.replaceChildren(chip("Save", "primary games-save", save), chip("Cancel", "games-cancel", () => this.draw()));
    input.focus();
    input.select();
  }

  /** Delete asks first, on the row: Delete (red) or Keep. */
  private confirming(row: HTMLElement, g: GameEntry): void {
    const buttons = row.querySelector(".games-buttons")!;
    const ask = el("p", "games-ask", `Delete “${g.name}”? It can't be undone.`);
    buttons.replaceChildren(
      ask,
      chip("Delete", "danger games-confirm", () => {
        this.h.remove(g.id);
        this.draw();
      }),
      chip("Keep", "games-keep", () => this.draw()),
    );
  }
}

/**
 * A small copy of a frame (`Game.grabSmall`) as a game's picture: WebP (JPEG where the browser can't), at falling
 * quality until its data URL is under `maxChars`. Null if it can't be made small enough.
 */
export function smallPicture(c: HTMLCanvasElement, maxChars: number): string | null {
  for (const q of [0.7, 0.5, 0.35]) {
    let url = c.toDataURL("image/webp", q);
    if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/jpeg", q);
    if (url.length <= maxChars) return url;
  }
  return null;
}
