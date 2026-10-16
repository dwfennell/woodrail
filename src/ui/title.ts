import type { GameMode } from "../game/modes";
import type { PieceTypeId } from "../track";
import { blockWord } from "./blocks";

export interface TitleHandlers {
  /** Play a mode: carry on with its autosave, or start it afresh. */
  play(mode: GameMode, fresh: boolean): void;
}

export interface TitleOptions {
  /** Rendered tray pictures by key, to illustrate the cards (optional). */
  thumbnails?: ReadonlyMap<string, string> | null;
}

/** The pictures on the cards: a piece (carved before the title shows) and a train. */
export const TITLE_ART_PIECE: PieceTypeId = "switch-3way";
export const TITLE_ART_TRAIN = "Full train";

const CARDS: { mode: GameMode; name: string; blurb: string; fresh: string; freshTitle: string; art: string; beta?: boolean }[] = [
  {
    mode: "sandbox",
    name: "Sandbox",
    blurb: "Build anything, anywhere. Every piece, every train, no rules.",
    fresh: "New map",
    freshTitle: "Start a new landscape of towns, hills and rivers",
    art: `piece:${TITLE_ART_PIECE}`,
  },
  {
    mode: "game",
    name: "Game",
    blurb: "Connect the towns and keep them supplied, one goal at a time.",
    fresh: "New game",
    freshTitle: "Start the goals from the beginning on the starter map",
    art: `train:${TITLE_ART_TRAIN}`,
    beta: true,
  },
];

/** The title screen: the name and one card per mode, over a still, wide view of the map. */
export class TitleScreen {
  readonly root = document.createElement("div");
  private readonly continueBtns = new Map<GameMode, HTMLButtonElement>();

  constructor(parent: HTMLElement, handlers: TitleHandlers, opts: TitleOptions = {}) {
    this.root.className = "title-screen";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="title-head">
        <h1 class="title-logo"></h1>
      </div>
      <div class="title-cards"></div>`;
    this.root.querySelector(".title-logo")!.appendChild(blockWord("Woodrail"));
    const cards = this.root.querySelector(".title-cards")!;
    for (const c of CARDS) {
      const card = document.createElement("section");
      card.className = `title-card mode-${c.mode}`;
      card.innerHTML = `
        <span class="title-art"></span>
        <h2>${c.name}${c.beta ? ` <span class="beta">Beta</span>` : ""}</h2>
        <p>${c.blurb}</p>
        <div class="title-buttons"></div>`;
      const art = card.querySelector<HTMLElement>(".title-art")!;
      const url = opts.thumbnails?.get(c.art);
      if (url) art.style.backgroundImage = `url(${url})`;
      const buttons = card.querySelector(".title-buttons")!;
      const go = button("Continue", `Carry on with your ${c.name.toLowerCase()} railway`, "chip text primary", () => handlers.play(c.mode, false));
      const fresh = button(c.fresh, c.freshTitle, "chip text", () => handlers.play(c.mode, true));
      buttons.append(go, fresh);
      this.continueBtns.set(c.mode, go);
      cards.appendChild(card);
    }
    parent.appendChild(this.root);
  }

  /** Show the title. Continue appears for the modes that have a save. */
  show(saved: Record<GameMode, boolean>): void {
    for (const [mode, b] of this.continueBtns) {
      b.hidden = !saved[mode];
      // Without a save, the fresh start is the main button.
      b.nextElementSibling?.classList.toggle("primary", !saved[mode]);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  get shown(): boolean {
    return !this.root.hidden;
  }
}

function button(label: string, title: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
