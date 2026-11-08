import type { GameMode } from "../game/modes";
import { savedWhen, type TitleOffer } from "../persist/cloud-known";
import type { PieceTypeId } from "../track";
import { blockWord } from "./blocks";

export interface TitleHandlers {
  /** Play a mode: carry on with its autosave, or start it afresh. */
  play(mode: GameMode, fresh: boolean): void;
  /** "Load a cloud save" (shown only when given: a build with a cloud): open the code entry over the title. */
  loadCloud?(): void;
  /**
   * "Continue from cloud" on a mode's card (`setCloudOffers`): carry on with that railway. A message back: it couldn't
   * (offline, gone), said on the card under the button (the HUD's toasts don't show over the title).
   */
  continueCloud?(offer: TitleOffer): Promise<string | void>;
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
  /** Each card's "Continue from cloud" row (hidden till there's a railway in the cloud to offer). */
  private readonly cloudRows = new Map<GameMode, HTMLElement>();
  private readonly handlers: TitleHandlers;

  constructor(parent: HTMLElement, handlers: TitleHandlers, opts: TitleOptions = {}) {
    this.handlers = handlers;
    this.root.className = "title-screen";
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="title-head">
        <h1 class="title-logo"></h1>
      </div>
      <div class="title-cards"></div>
      <div class="title-foot" hidden></div>`;
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
      const cloudRow = document.createElement("div");
      cloudRow.className = "title-cloud-offer";
      cloudRow.hidden = true;
      card.appendChild(cloudRow);
      this.cloudRows.set(c.mode, cloudRow);
      cards.appendChild(card);
    }
    if (handlers.loadCloud) {
      const foot = this.root.querySelector<HTMLElement>(".title-foot")!;
      foot.append(button("☁ Load a cloud save", "Carry on with a railway saved on another device: type its code", "title-cloud", () => handlers.loadCloud!()));
      foot.hidden = false;
    }
    parent.appendChild(this.root);
  }

  /**
   * Show the title. Continue appears for the modes that have a save it can load; one from an older version of the
   * game (`older`) can't, so there's no Continue, only the fresh start (the old save is kept aside, not lost).
   */
  show(saved: Record<GameMode, boolean>, older: Partial<Record<GameMode, boolean>> = {}): void {
    for (const [mode, b] of this.continueBtns) {
      const canContinue = saved[mode] && !older[mode];
      b.hidden = !canContinue;
      // Without a save to carry on, the fresh start is the main button.
      b.nextElementSibling?.classList.toggle("primary", !canContinue);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /**
   * The railways in the cloud to offer (`titleOffers`, newest first): the newest of each mode on its card, as
   * "☁ Continue from cloud" and what it is and when it was saved. One saved by a newer game is shown, but can't be
   * opened. None: the rows go.
   */
  setCloudOffers(offers: readonly TitleOffer[], now = Date.now()): void {
    for (const [mode, row] of this.cloudRows) {
      const o = offers.find((x) => x.mode === mode);
      row.replaceChildren();
      row.hidden = !o || !this.handlers.continueCloud;
      if (!o || row.hidden) continue;
      const what = `${o.desc ? `${o.desc}, ` : ""}saved ${savedWhen(o.savedAt, now)}`;
      const b = button("☁ Continue from cloud", o.newer ? "Saved by a newer version of the game: update this one to open it" : `Carry on with your railway saved online (${what})`, "title-cloud-go", async () => {
        if (b.disabled) return;
        b.disabled = true;
        b.classList.add("busy");
        let said: string | void = undefined;
        try {
          said = await this.handlers.continueCloud!(o);
        } finally {
          b.disabled = o.newer;
          b.classList.remove("busy");
        }
        if (said && row.contains(b)) {
          let err = row.querySelector<HTMLElement>(".title-cloud-error");
          if (!err) {
            err = document.createElement("div");
            err.className = "title-cloud-error";
            err.setAttribute("role", "status");
            row.append(err);
          }
          err.textContent = said;
        }
      });
      b.dataset.code = o.code;
      b.disabled = o.newer;
      const sub = document.createElement("span");
      sub.className = "title-cloud-when";
      sub.textContent = o.newer ? "Saved by a newer version: update the game to open it" : what;
      b.append(sub);
      row.append(b);
    }
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
  // A tap that came down on it acts as it lifts, wherever the button has got to: the cards still settle (they slide
  // in; a phone's bar coming or going moves them), and a click whose press and lift fell on different things goes to
  // the card round them, which did nothing (QA: Continue's first tap, now and then). The click after it isn't twice.
  let down: { id: number; x: number; y: number } | null = null;
  let actedAt = -Infinity;
  b.addEventListener("pointerdown", (e) => {
    down = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  window.addEventListener("pointerup", (e) => {
    if (!down || e.pointerId !== down.id) return;
    const tap = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 10;
    down = null;
    if (!tap || b.disabled || !b.isConnected || b.closest("[hidden]")) return;
    actedAt = e.timeStamp;
    onClick();
  });
  window.addEventListener("pointercancel", (e) => {
    if (down && e.pointerId === down.id) down = null;
  });
  // (A click with no tap before it: the keyboard's, or a test's.)
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.timeStamp - actedAt < 1000) return;
    onClick();
  });
  return b;
}
