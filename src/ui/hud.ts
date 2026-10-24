import { installTooltips } from "./tooltip";
import type { GameMode } from "../game/modes";
import { note } from "../debug/report";
import { blockWord } from "./blocks";
import { costTagSize } from "./cost-tag";
import { pieceIcon, trainIcon, uiIcon } from "./icons";
import { roadIcon } from "./road-icons";
import { isKit } from "../track";
import { crossingStyleOf } from "../landscape/crossing-styles";
import { canFavourite, DEFAULT_FAVOURITES, favouriteItems, propGroups, shownGroups, toggleFavourite, trayKey, trayTabs, type LandTool, type TrayGroup, type TrayItem, type TrayTab } from "./tray-catalogue";
import { loadFavourites, saveFavourites } from "./prefs";
import { pillText, type PillView } from "../game/research-text";

export { trayKey, type TrayItem } from "./tray-catalogue";
import { ControlsTutorial, type ViewState } from "./controls-tutorial";
import { clearSpot, leastCovered, type Label, type Spot } from "./toast-room";

export interface HudHandlers {
  /** The camera's view now, for the first-run camera tutorial (see ControlsTutorial). */
  cameraView(): ViewState;
  /** Is the camera gliding on its own (Show me, a framing), for the camera tutorial: not the player's doing. */
  cameraGliding?(): boolean;
  /** The camera tutorial was done or skipped: what comes next is shown (the goals' Show me, say). */
  tutorialDone?(skipped: boolean): void;
  trayPointerDown(item: TrayItem, e: PointerEvent): void;
  /** A tray piece tapped (the ready one is put away). */
  /** A tap on a tray item (`pointerType`: what tapped it, a mouse, pen or finger). */
  trayTap(item: TrayItem, pointerType: string): void;
  /** Another tray tab opened (the ready piece is put away). */
  trayTabChanged(): void;
  /** The Track tab opened or closed (building: free track ends show their end boards). */
  trackTab?(open: boolean): void;
  undo(): void;
  redo(): void;
  rerailAll(): void;
  togglePause(): void;
  lever(value: -1 | 0 | 1): void;
  follow(): void;
  removeTrain(): void;
  /** The engine card of a line with a train too many: that train (this one, or the one held) back in the box. */
  putAway(): void;
  /** A wagon's card: turn it round where it stands (its other magnet leads). */
  turnCar(): void;
  /** The engine card: the engine runs round to the other end of its train. */
  swapEnds(): void;
  /** Either card: uncouple there (a wagon from the cars on its engine's side; an engine from its cars). */
  decouple(): void;
  rotate(): void;
  flip(): void;
  deletePiece(): void;
  /** Piece card: start picking several pieces, to move or turn them together. */
  selectMore(): void;
  /** Group card: add all track joined to the picked pieces. */
  selectJoined(): void;
  /** Group card: finished picking (the selection is let go). */
  doneSelecting(): void;
  newLayout(): void;
  /** Start or stop choosing land to add. */
  toggleExpand(): void;
  /** Game mode: open or close the map view. */
  toggleMap(): void;
  /** Game mode: open or close the Research picker (the blueprint board); `pill`: tapped on the research pill. */
  toggleBoard(pill?: boolean): void;
  /** Add the plot chosen on the land card. */
  buyLand(): void;
  /** "Clear the ruin" on an old industry's card. */
  clearRuin?(): void;
  /** "Restore" on an old industry's card (its blueprint learned). */
  restoreRuin?(): void;
  resetStarter(): void;
  /** Game mode: start the goals again on the starter map. */
  newGame(): void;
  /** Open the Lines view (every line: its colour, name and trains). */
  openLines(): void;
  /** Back to the title screen. */
  titleScreen(): void;
  /** The brand tapped: back to the player's railway (the view frames their track). */
  home(): void;
  toggleQuality(): void;
  closeCards(): void;
  /** Tray: turn the piece in hand and the ones taken out next (an eighth turn). */
  trayTurn(): void;
  /** Tray: mirror the piece in hand and the ones taken out next. */
  trayFlip(): void;
  /** Tray: drawing track switched on or off (the Draw chip). */
  trayDraw(on: boolean): void;
  /** Tray: clearing switched on or off (the Clear chip). */
  trayErase(on: boolean): void;
  /** Depot card: turn automatic loading on or off. */
  depotAuto(): void;
  /** Depot card: trains wait for a full load, or not. */
  depotWaitFull(): void;
  toggleSound(): void;
  /** Any HUD button pressed (for a soft click). */
  buttonTap(): void;
  /** The Land tab's tool chosen (null: land editing off). */
  landTool(tool: LandTool | null): void;
  /** Send a debug report (the player's note, the view, the save) to Claude. */
  sendReport(note: string): Promise<void>;
  /** Tray items shown without a picture yet: draw them (a few at a time) and hand each back with `setThumbnail`. */
  needThumbnails(items: TrayItem[]): void;
  /** Kit pieces shown in the tray (pictured or not): their models can be built ahead of a drag (see `Interaction.warmKits`). */
  kitsShown?(items: TrayItem[]): void;
}

/** Movement (px) before a press on a tray item becomes a scroll or a pick-up. */
const TRAY_DECIDE_PX = 8;
/** A flung tray slows with this time constant (ms). */
const TRAY_GLIDE_MS = 320;

export interface HudOptions {
  /** Rendered pictures of tray items by key (`piece:<type>` or `train:<label>`); SVG drawings are the fallback. */
  thumbnails?: ReadonlyMap<string, string>;
  muted: boolean;
}


const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = "", html = ""): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** How long a menu item that asks first (New game) waits for the second tap (ms). */
const ASK_MS = 4000;

function button(label: string, title: string, onClick: () => void, cls = "chip"): HTMLButtonElement {
  const b = el("button", cls, label);
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** A switch: a label and a pill with a knob, on or off (role="switch"). Its name is its label; `title` is the tooltip. */
function toggle(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", "chip text toggle");
  b.title = title;
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", "false");
  b.append(el("span", "toggle-label", label), el("span", "toggle-pill"));
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

function setToggle(b: HTMLButtonElement, on: boolean): void {
  b.classList.toggle("active", on);
  b.setAttribute("aria-checked", String(on));
}

/** A little camera (Follow). */
const CAMERA_ICON = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 8h3l1.6-2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13.5" r="3.4" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
/** The way arrow, pointing right before it's turned. */
const WAY_ARROW = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M4 12h13M12 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** `angle` (degrees), plus or minus whole turns, nearest `from`. */
function nearestTurn(from: number, angle: number): number {
  return from + ((((angle - from) % 360) + 540) % 360) - 180;
}

/**
 * How long a toast stays up (ms), and before the next replaces it: long enough to read, at least 3 s (a celebration
 * 4 s), longer for longer text. One timing for every toast. Tapping one dismisses it early.
 */
export function toastMs(message: string, celebrate: boolean, ms = 0): number {
  return Math.max(ms, celebrate ? 4000 : 3000, 1200 + message.length * 45);
}
/** Toasts waiting their turn at most (a busy moment drops the oldest plain ones). */
const TOAST_QUEUE = 3;
/** A toast this soon after a HUD button is pressed answers it (ms). */
const TOAST_ANSWER_MS = 600;
/** A toast that came on less than this before a refusal pushed it off (ms) shows again after the refusal. */
const REFUSAL_BUMP_MS = 1000;
/**
 * A toast up this long (ms) has been read: a card opening over it puts it away for good, not back to wait (QA: a goal's
 * tick shown, then shown again whole once the workshop's card closed).
 */
const TOAST_SEEN_MS = 1500;
/** How far above its place a toast starts its slide in (px: `.toast` in style.css, translate −14 px till shown). */
const TOAST_SLIDE = 14;
/** The help card's tips drawn with tray pictures: the picture's key, and the tip's art. */
const HELP_ART: Record<string, string> = { "piece:curve-large": ".art-build", "train:Full train": ".art-run" };


/** The HTML overlay: top bar, piece tray, context cards, menu, help, toasts and perf readout. */
export class Hud {
  readonly root = el("div", "hud");
  readonly tray = el("div", "tray");
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly rerailBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly engineCard = el("div", "card engine-card");
  private readonly carCard = el("div", "card car-card");
  private readonly pieceCard = el("div", "card piece-card");
  private readonly pieceTitle = el("div", "card-title", "Track piece");
  private readonly groupHint = el("div", "card-hint");
  private readonly groupRow = el("div", "card-row");
  private readonly pieceRow = el("div", "card-row");
  /** A signal box's or lever frame's card: the points and signals near it, each a chip to throw (see `showLevers`). */
  private readonly leverList = el("div", "card-row lever-list");
  private readonly doneBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly selectMoreBtn: HTMLButtonElement;
  private readonly joinedBtn: HTMLButtonElement;
  private rotateBtn!: HTMLButtonElement;
  private readonly depotCard = el("div", "card depot-card");
  /** Below a depot card's switches: filled by the game for some depots (Game mode's workshop), else hidden. */
  readonly depotExtra = el("div", "depot-extra");
  /** The depot card's choice of how it shares (the workshop's planks): beside the extra, its own so it can move up. */
  readonly depotYard = el("div", "depot-yard");
  /** Room on the engine card for Game mode's own rows (where the train delivers), filled by main. */
  readonly engineExtra = el("div", "engine-extra");
  /** While choosing land to add: what the chosen plot brings, and a button to add it. */
  private readonly landCard = el("div", "card land-card");
  private readonly landText = el("div", "land-text");
  /** An old industry's ruin: its card (tap a ruin). */
  private readonly ruinCard = el("div", "card ruin-card");
  private readonly ruinTitle = el("div", "card-title");
  private readonly ruinResource = el("div", "ruin-resource");
  private readonly ruinStatus = el("div", "ruin-status");
  private readonly ruinOwn = el("div", "ruin-own");
  private ruinClearBtn!: HTMLButtonElement;
  private ruinRestoreBtn!: HTMLButtonElement;
  private landBuyBtn!: HTMLButtonElement;
  private landBtn!: HTMLButtonElement;
  private soundItem!: HTMLButtonElement;
  private redoItem!: HTMLButtonElement;
  private landItem!: HTMLButtonElement;
  private readonly depotTitle = el("div", "card-title");
  private readonly depotStock = el("div", "depot-stock");
  /** A school's card with nothing under way or up next: a button for the Research picker. */
  private readonly depotPickBtn: HTMLButtonElement;
  private depotAutoBtn!: HTMLButtonElement;
  private depotWaitBtn!: HTMLButtonElement;
  private readonly flipBtn: HTMLButtonElement;
  /** The engine card: Go/Stop, the way it goes (an arrow as on screen), what it's doing, and the rest tucked away. */
  private readonly goBtn: HTMLButtonElement;
  /** "Put away", on an engine card whose line has a train too many (see `setPutAway`). */
  private readonly putAwayBtn: HTMLButtonElement;
  private putAwayShown = false;
  private readonly wayBtn: HTMLButtonElement;
  private readonly engineStatus = el("div", "engine-status");
  private readonly engineMore = el("div", "engine-more");
  private readonly followBtn: HTMLButtonElement;
  /** The engine's lever as last shown, and the way Go will send it (+1: its own front first). */
  private engineLever = 0;
  /** The train is held at its stop for spacing: Go reads "Go now" (see `setGoNow`). */
  private goNow = false;
  private engineWay: 1 | -1 = 1;
  /** Shown status and arrow angle (degrees), to touch the page only when they change. */
  private shownStatus = "";
  private shownAngle = NaN;
  /** The arrow's angle as last set, unwrapped (it runs on past ±180°), kept when the shown one is forgotten. */
  private wayAngle = 0;
  private readonly toastEl = el("div", "toast");
  private readonly menu = el("div", "menu");
  private menuBtn!: HTMLButtonElement;
  private readonly help = el("div", "help");
  /** The first-run camera tutorial (in place of the help card on a first visit: see `firstVisitHelp`). */
  readonly coach: ControlsTutorial;
  private readonly modeTag = el("span", "mode-tag");
  /** Game mode's coins, by the logo. */
  private readonly coinTag = el("span", "coins");
  /** Game mode: the railway's date ("Mar 2001", see game/calendar.ts). */
  private readonly dateTag = el("span", "game-date");
  /** Game mode: the research under way and how far ("📘 Bridges 6/10🪵"), or "Pick research"; tap: the picker. */
  private readonly researchPill = el("button", "research-pill") as HTMLButtonElement;
  /** What the pill shows now (its whole text and fill): it's redrawn only when this changes. */
  private pillShown = "";
  /** The menu's Lines item (see `setLinesAvailable`). */
  private linesItem!: HTMLButtonElement;
  /** Menu items for each mode's maps. */
  private readonly reportItem = button("Send to Claude…", "Send what you see, your railway and a note to Claude, for debugging", () => {
    this.menu.hidden = true;
    this.openReport();
  }, "menu-item");
  private readonly reportCard = el("div", "card report-card");
  private readonly reportNote = document.createElement("textarea");
  private readonly sandboxItems: HTMLButtonElement[];
  private readonly gameItems: HTMLButtonElement[];
  /** The menu's New game (it asks first: see `stopAsking`), and the timer that stops it asking. */
  private readonly newGameItem: HTMLButtonElement;
  private newGameAsk = 0;
  readonly perf = el("div", "perf");
  private toastTimer = 0;
  private readonly toastQueue: { message: string; celebrate: boolean; ms: number; urgent: boolean; tap?: () => void }[] = [];
  /** When a button of the HUD was last pressed: a toast soon after answers it (it shows even over a card). */
  private lastButtonAt = -Infinity;
  /** A toast waits for an open card to close (there was no room for it above the card). */
  private toastWaitsForCard = false;
  /** The toast on screen, from the queue (null: none, or a held piece's refusal). */
  private toastShowing: { message: string; celebrate: boolean; ms: number; urgent: boolean; tap?: () => void } | null = null;
  /** Until when (performance.now) the message showing may not be replaced. */
  private toastHeldUntil = 0;
  /** When (performance.now) the toast showing came on. */
  private toastShownAt = 0;
  private toastFlushTimer = 0;

  private readonly handlers: HudHandlers;
  private readonly mapBtn: HTMLButtonElement;
  private readonly boardBtn: HTMLButtonElement;
  /** Tray pictures by key: those drawn at start-up, and catalogue models' as they're drawn. */
  private readonly thumbs: Map<string, string>;
  private flipTrayBtn!: HTMLButtonElement;
  private drawBtn!: HTMLButtonElement;
  private eraseBtn!: HTMLButtonElement;
  private erasing = false;
  /** The tray favourites (tray keys, in order): first on the Track and Trains tabs. */
  private favourites: string[] = loadFavourites() ?? [...DEFAULT_FAVOURITES];
  private drawing = false;

  constructor(parent: HTMLElement, h: HudHandlers, qualityLabel: () => string, opts: HudOptions) {
    this.handlers = h;
    this.thumbs = new Map(opts.thumbnails ?? []);
    parent.appendChild(this.root);
    this.root.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") && !t.closest(".tray-item")) h.buttonTap();
      if (t.closest("button")) this.lastButtonAt = performance.now();
    });

    const top = el("header", "topbar");
    const brand = el("div", "brand");
    brand.append(blockWord("W", "brand-block"), el("span", "brand-name", "Woodrail"));
    brand.appendChild(this.modeTag);
    this.coinTag.hidden = true;
    this.coinTag.title = "Coins: towns pay them for deliveries; they buy land";
    brand.appendChild(this.coinTag);
    this.dateTag.hidden = true;
    this.dateTag.title = "The date on your railway: a month every two minutes of play";
    brand.appendChild(this.dateTag);
    // Tapped: back to my railway (after a pinch or a pan out over empty land, the way home).
    brand.setAttribute("role", "button");
    brand.tabIndex = 0;
    brand.title = "Back to my railway";
    brand.addEventListener("click", () => h.home());
    brand.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        h.home();
      }
    });
    top.appendChild(brand);
    this.researchPill.type = "button";
    this.researchPill.hidden = true;
    this.researchPill.innerHTML = `<span class="rp-text"><span class="rp-line"><span class="rp-icon" aria-hidden="true">📘</span><span class="rp-name"></span></span><span class="rp-count"></span></span><span class="rp-bar"></span>`;
    this.researchPill.addEventListener("click", () => h.toggleBoard(true));
    top.appendChild(this.researchPill);
    // (Refitted when its room changes: the coins or the date grow, the screen turns. Not per frame.)
    let pillRefit = 0;
    const fitPill = () => {
      cancelAnimationFrame(pillRefit);
      pillRefit = requestAnimationFrame(() => this.fitPill());
    };
    new ResizeObserver(fitPill).observe(this.researchPill);
    addEventListener("resize", fitPill);
    const actions = el("div", "actions");
    this.undoBtn = button(uiIcon("undo"), "Undo (Ctrl+Z)", h.undo);
    this.redoBtn = button(uiIcon("redo"), "Redo (Ctrl+Shift+Z)", h.redo);
    this.pauseBtn = button(uiIcon("pause"), "Pause (Space)", h.togglePause);
    this.rerailBtn = button("Re-rail", "Put derailed trains back on the track", h.rerailAll, "chip text attention");
    this.rerailBtn.hidden = true;
    this.soundBtn = button(uiIcon(opts.muted ? "mute" : "sound"), opts.muted ? "Sound on" : "Sound off", h.toggleSound);
    this.landBtn = button(uiIcon("land"), "Add land", h.toggleExpand);
    this.mapBtn = button(uiIcon("map"), "Map: what's where", h.toggleMap);
    this.mapBtn.hidden = true;
    this.boardBtn = button(uiIcon("blueprint"), "Research: learn new things", () => h.toggleBoard(), "chip research-btn");
    this.boardBtn.hidden = true;
    // On a phone the bar can't hold them all: these move into the menu (see `.narrow-menu`).
    for (const b of [this.landBtn, this.redoBtn, this.soundBtn]) b.classList.add("wide-only");
    actions.append(this.rerailBtn, this.boardBtn, this.mapBtn, this.landBtn, this.undoBtn, this.redoBtn, this.pauseBtn, this.soundBtn);
    this.menuBtn = button(uiIcon("menu"), "Menu", () => this.toggleMenu());
    actions.append(this.menuBtn);
    top.appendChild(actions);
    this.root.appendChild(top);
    installTooltips(this.root);
    // A card that grows once it's open (a workshop's list fills in a frame later) may come up under a toast: it's put
    // clear again (only when a card's size changes, not per frame).
    if (typeof ResizeObserver !== "undefined") {
      const refit = new ResizeObserver(() => {
        this.refitToast();
        this.onCardResize?.();
      });
      for (const c of [this.engineCard, this.carCard, this.pieceCard, this.depotCard]) refit.observe(c);
    }

    // Menu
    this.menu.hidden = true;
    const quality = button(`Graphics: ${qualityLabel()}`, "Switch graphics quality (reloads)", () => h.toggleQuality(), "menu-item");
    this.sandboxItems = [
      button("Starter map", "Back to the starter map", () => {
        this.menu.hidden = true;
        h.resetStarter();
      }, "menu-item"),
      button("New map", "Generate a new landscape of towns, hills and rivers", () => {
        this.menu.hidden = true;
        h.newLayout();
      }, "menu-item"),
    ];
    // Starting over loses the game's progress: the first tap asks, a second (while it asks) does it.
    const newGame = button("New game", "Start the goals again on the starter map", () => {
      if (!newGame.classList.contains("asking")) {
        newGame.classList.add("asking");
        newGame.textContent = "Start over? Tap again";
        window.clearTimeout(this.newGameAsk);
        this.newGameAsk = window.setTimeout(() => this.stopAsking(newGame), ASK_MS);
        return;
      }
      this.stopAsking(newGame);
      this.menu.hidden = true;
      h.newGame();
    }, "menu-item");
    this.newGameItem = newGame;
    this.gameItems = [newGame];
    // The bar's buttons that don't fit on a phone.
    const narrow = (label: string, title: string, act: () => void) =>
      button(label, title, () => {
        this.menu.hidden = true;
        act();
      }, "menu-item narrow-only");
    this.soundItem = narrow(opts.muted ? "Sound: off" : "Sound: on", "Sound on or off", h.toggleSound);
    this.redoItem = narrow("Redo", "Redo what was undone", h.redo);
    this.landItem = narrow("Add land", "Choose land to add to the map", h.toggleExpand);
    this.menu.append(this.redoItem, this.landItem, this.soundItem);
    this.linesItem = button("Lines", "Every line: its colour, its name, its trains", () => {
      this.menu.hidden = true;
      h.openLines();
    }, "menu-item");
    this.linesItem.hidden = true;
    this.menu.append(
      this.linesItem,
      button("Title screen", "Save and go back to the title screen", () => {
        this.menu.hidden = true;
        h.titleScreen();
      }, "menu-item"),
      ...this.sandboxItems,
      ...this.gameItems,
      quality,
      button("How to play", "Show help", () => {
        this.menu.hidden = true;
        // (Not both at once: the help card takes the camera tutorial's place, as on a first visit.)
        this.coach.close(true);
        this.showHelp();
      }, "menu-item"),
      button("Show controls", "Show the camera controls again", () => {
        this.menu.hidden = true;
        this.help.hidden = true;
        this.coach.start();
      }, "menu-item"),
      this.reportItem,
    );
    this.reportItem.hidden = true;
    this.buildReportCard();
    this.root.appendChild(this.menu);

    // Engine card
    this.engineCard.hidden = true;
    this.engineCard.appendChild(el("div", "card-title", "Engine"));
    // Follow (the camera rides along) in the top corner, and a ⋯ for swapping ends or putting the train away.
    this.followBtn = button("", "Follow this train with the camera", h.follow, "corner follow");
    this.followBtn.innerHTML = CAMERA_ICON;
    const more = button("⋯", "More", () => (this.engineMore.hidden = !this.engineMore.hidden), "corner more");
    this.engineCard.append(this.followBtn, more);
    this.engineStatus.setAttribute("aria-live", "polite");
    this.engineCard.appendChild(this.engineStatus);
    this.putAwayBtn = button("Put away", "Put this line's extra train back in the box: then the others can run", h.putAway, "chip text put-away");
    this.putAwayBtn.hidden = true;
    this.engineCard.appendChild(this.putAwayBtn);
    const controls = el("div", "engine-controls");
    // One big button: Go (the way the arrow shows) or Stop.
    // (Held at its stop for spacing: "Go now" sends it on with one tap, the lever as it is.)
    this.goBtn = button("", "Go", () => h.lever(this.goNow && this.engineLever !== 0 ? (this.engineLever as -1 | 1) : this.engineLever !== 0 ? 0 : this.engineWay), "chip go");
    // Which way: the arrow points where the train will go on screen; a tap turns it round (at once, if it's moving).
    this.wayBtn = button("", "Which way it goes: tap to change", () => {
      this.engineWay = this.engineWay === 1 ? -1 : 1;
      if (this.engineLever !== 0) h.lever(this.engineWay);
      else this.drawEngine();
    }, "chip way");
    this.wayBtn.innerHTML = `<span class="way-arrow">${WAY_ARROW}</span><span class="way-hint" aria-hidden="true">⇄</span>`;
    controls.append(this.goBtn, this.wayBtn);
    this.engineCard.appendChild(controls);
    this.engineMore.hidden = true;
    this.engineMore.append(
      button("Swap ends", "Move the engine to the other end of its train", () => {
        this.engineMore.hidden = true;
        h.swapEnds();
      }, "chip text"),
      button("Decouple", "Uncouple the engine from its cars", () => {
        this.engineMore.hidden = true;
        h.decouple();
      }, "chip text"),
      button("Remove", "Put this train back in the box", h.removeTrain, "chip text danger"),
    );
    this.engineCard.appendChild(this.engineMore);
    this.engineExtra.hidden = true;
    this.engineCard.appendChild(this.engineExtra);
    this.engineCard.appendChild(button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.engineCard);

    // Wagon card
    this.carCard.hidden = true;
    this.carCard.appendChild(el("div", "card-title", "Wagon"));
    const carRow = el("div", "card-row");
    carRow.append(
      button("Turn around", "Flip the wagon so its other magnet leads", h.turnCar, "chip text"),
      button("Decouple", "Uncouple this wagon (and those behind it) from the cars on the engine's side", h.decouple, "chip text"),
      button("Remove", "Put this train back in the box", h.removeTrain, "chip text danger"),
    );
    this.carCard.appendChild(carRow);
    this.carCard.appendChild(button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.carCard);

    // Piece card
    this.pieceCard.hidden = true;
    this.flipBtn = button("Flip", "Mirror this piece (F)", h.flip, "chip text");
    const pieceRow = this.pieceRow;
    this.rotateBtn = button("Rotate", "Rotate 45° (R)", h.rotate, "chip text");
    this.deleteBtn = button("Delete", "Remove this piece (Del)", h.deletePiece, "chip text danger");
    pieceRow.append(this.rotateBtn, this.flipBtn, this.deleteBtn);
    // Picking several pieces: from a single piece's card, or Shift+click.
    this.selectMoreBtn = button("Select more", "Pick more track to move together (or Shift+click)", h.selectMore, "chip text select-more");
    this.joinedBtn = button("Joined track", "Add all the track joined to these pieces", h.selectJoined, "chip text");
    this.doneBtn = button("Done", "Finish picking", h.doneSelecting, "chip text primary");
    this.groupRow.append(this.joinedBtn, this.doneBtn);
    this.leverList.hidden = true;
    this.pieceCard.append(this.pieceTitle, this.groupHint, this.leverList, pieceRow, this.selectMoreBtn, this.groupRow, button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.pieceCard);

    // Depot card: what's on its piles, and how it treats trains.
    this.depotCard.hidden = true;
    this.depotAutoBtn = toggle("Automatic", "The crane loads and unloads trains by itself", h.depotAuto);
    this.depotWaitBtn = toggle("Wait for a full load", "Trains wait under the crane until each wagon is full", h.depotWaitFull);
    const depotRow = el("div", "card-row");
    depotRow.append(this.depotAutoBtn, this.depotWaitBtn);
    this.depotExtra.hidden = true;
    this.depotPickBtn = button("📘 Research", "Pick what the school learns next", () => h.toggleBoard(true), "chip text primary depot-pick");
    this.depotPickBtn.hidden = true;
    this.depotYard.hidden = true;
    this.depotCard.append(this.depotTitle, this.depotStock, this.depotPickBtn, depotRow, this.depotYard, this.depotExtra, button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.depotCard);

    // Land card: shown while choosing a plot to add.
    this.landCard.hidden = true;
    this.landBuyBtn = button("Add this land", "Add the chosen plot to your land", h.buyLand, "chip text attention");
    const landRow = el("div", "card-row");
    landRow.append(this.landBuyBtn, button("Done", "Stop adding land", h.toggleExpand, "chip text"));
    this.landCard.append(el("div", "card-title", "Add land"), this.landText, landRow);
    this.root.appendChild(this.landCard);

    // An old industry's ruin: what's around it, what opens it, and clearing it away.
    this.ruinCard.hidden = true;
    this.ruinRestoreBtn = button("Restore", "Make it work again", () => h.restoreRuin?.(), "chip text primary ruin-restore");
    this.ruinClearBtn = button("Clear the ruin", "Take the ruin and its track away", () => h.clearRuin?.(), "chip text ruin-clear");
    const ruinRow = el("div", "card-row");
    ruinRow.append(this.ruinRestoreBtn, this.ruinClearBtn);
    this.ruinCard.append(this.ruinTitle, this.ruinResource, this.ruinStatus, this.ruinOwn, ruinRow, button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.ruinCard);

    // Tray with tabs
    const tabs = el("div", "tabs");
    const scroller = el("div", "scroller");
    // Fade whichever ends have more items scrolled out of view.
    const edges = () => {
      this.tray.classList.toggle("more-left", scroller.scrollLeft > 4);
      this.tray.classList.toggle("more-right", scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4);
    };
    scroller.addEventListener("scroll", edges, { passive: true });
    window.addEventListener("resize", edges);
    // Pictures not drawn yet (catalogue models, drawn on demand) wait as a placeholder until `setThumbnail`.
    const missing: TrayItem[] = [];
    const kits: TrayItem[] = [];
    const picture = (item: TrayItem) => {
      const key = trayKey(item);
      if (item.kind === "piece" && isKit(item.type)) kits.push(item);
      const thumb = this.thumbs.get(key);
      if (thumb) return `<img src="${thumb}" alt="" draggable="false">`;
      // A piece or train not drawn yet shows its icon till its picture comes (`setThumbnail` swaps it in). A kit piece
      // (on a catalogue shelf) is drawn when its shelf is first shown, with its model.
      if (item.kind === "piece" && isKit(item.type)) missing.push(item);
      if (item.kind === "piece") return `<span class="thumb-icon" data-thumb="${key}">${pieceIcon(item.type)}</span>`;
      if (item.kind === "tool") return uiIcon(item.tool);
      if (item.kind === "road") return roadIcon(item.auto ? "auto" : item.piece);
      if (item.kind === "train") return `<span class="thumb-icon" data-thumb="${key}">${trainIcon(item.cars)}</span>`;
      missing.push(item);
      return `<span class="thumb-pending" data-thumb="${key}"></span>`;
    };
    /** A label that doesn't fit its tile, a long word ("Warehouse" at 70 px) or more lines than it has ("Farmer with
     * pitchfork"), is set smaller with a third line rather than broken or cut. */
    const fitLabels = () => {
      const labels = [...scroller.querySelectorAll<HTMLElement>(".label")];
      // (Not while the tray isn't laid out: behind the title screen everything measures 0.)
      if (labels.length === 0 || scroller.clientWidth === 0) return;
      // (A line cut off is a whole line taller, ~13 px; a pixel or two is just how the lines round.)
      const wide = (l: HTMLElement) => l.scrollWidth > l.clientWidth + 1 || l.scrollHeight > l.clientHeight + 4;
      for (const l of labels) l.classList.remove("squeeze");
      for (const l of labels.filter(wide)) l.classList.add("squeeze");
    };
    this.fitTrayLabels = fitLabels;
    // Again when the tiles change size (the phone turns) and when the type's font has come (it's wider than the one
    // standing in for it).
    let refit = 0;
    addEventListener("resize", () => {
      clearTimeout(refit);
      refit = window.setTimeout(fitLabels, 200);
    });
    document.fonts?.addEventListener("loadingdone", () => requestAnimationFrame(fitLabels));
    const show = () => {
      requestAnimationFrame(edges);
      // Now, before the shelf is first drawn (a shelf opened from a frame's own work would show a frame of labels cut
      // off), and again next frame in case the tiles weren't laid out yet.
      fitLabels();
      requestAnimationFrame(fitLabels);
      if (missing.length > 0) this.handlers.needThumbnails(missing.splice(0));
      if (kits.length > 0) this.handlers.kitsShown?.(kits.splice(0));
    };
    // Top level: one button per group; open one to see its items, with a way back first in the row.
    const showGroups = (groups: TrayGroup[]) => {
      this.trayGlide++;
      scroller.innerHTML = "";
      scroller.scrollLeft = 0;
      this.tray.classList.remove("in-group");
      // Favourites first: pieces to drag straight out, without opening a shelf.
      this.trayButtons = [];
      const favs = openDef?.favourites ? favouriteItems(this.favourites, groups) : [];
      this.tray.classList.toggle("has-favourites", favs.length > 0);
      for (const item of favs) scroller.appendChild(itemButton(item, () => showGroups(groups)));
      if (favs.length > 0) scroller.appendChild(el("span", "tray-divider"));
      for (const group of groups) {
        const b = el("button", "tray-item tray-group");
        b.innerHTML = `<span class="icon">${picture(group.items[0])}</span><span class="label">${group.label}</span><span class="count">${group.items.length}</span>`;
        b.title = `${group.label}: ${group.items.map((i) => i.label).join(", ")}`;
        // A tap opens the shelf; a drag up takes out its first item (the first thing a new player tries).
        const first = group.items[0];
        const pick = first.kind === "tool" ? undefined : (move: PointerEvent) => this.handlers.trayPointerDown(first, move);
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.trayPress(e, scroller, { pick, tap: () => showItems(groups, group) });
        });
        scroller.appendChild(b);
      }
      show();
    };
    const showItems = (groups: TrayGroup[], group: TrayGroup, back = true) => {
      this.trayGlide++;
      scroller.innerHTML = "";
      scroller.scrollLeft = 0;
      this.tray.classList.add("in-group");
      if (back) {
        const b = el("button", "tray-item tray-back");
        b.innerHTML = `<span class="icon">‹</span><span class="label">Back</span>`;
        b.title = "Back to all kinds";
        // Handled as a press like the tray's other buttons: on touch, the tap that opened this shelf lifts with Back now
        // under the finger, and the browser's click for that tap lands on it (the click shield drops that one).
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.trayPress(e, scroller, { tap: () => showGroups(groups) });
        });
        // And on click, for the keyboard (a tap's own click is dropped: Back has gone by then, see click-shield.ts).
        b.addEventListener("click", () => showGroups(groups));
        scroller.appendChild(b);
      }
      this.trayButtons = [];
      this.tray.classList.remove("has-favourites");
      for (const item of group.items) scroller.appendChild(itemButton(item, null));
      show();
    };
    /** A tray item's button. `unpinned` redraws the row when its ★ is taken off (the favourites row). */
    const itemButton = (item: TrayItem, unpinned: (() => void) | null): HTMLElement => {
      const b = el("button", "tray-item");
      b.innerHTML = `<span class="icon">${picture(item)}</span><span class="label">${item.label}</span>`;
      if (item.kind !== "tool") {
        this.trayButtons.push([b, item]);
        this.decorate(b, item);
      }
      if (item.kind === "tool") {
        // A tool is chosen with a tap, then used on the land.
        const tool = item.tool;
        b.classList.add("tray-tool");
        b.dataset.tool = tool;
        b.classList.toggle("active", this.landTool === tool);
        b.title = `${item.label}: tap the land`;
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.trayPress(e, scroller, { tap: () => this.chooseLandTool(tool) });
        });
      } else if (item.kind === "piece" || item.kind === "road") {
        // A piece is dragged out; once placed it stays ready (the next waits at the end it left: tap it to add it).
        // Clicked (a mouse or pen), it's carried: each click on the map puts one down. A road is dragged out, or tapped
        // to make it ready (then each click on the map lays one). A tap on the ready one here puts it away.
        const key = trayKey(item);
        b.dataset.key = key;
        b.classList.toggle("armed", this.armedKey === key);
        b.classList.toggle("carried", this.armedKey === key && this.armedCarried);
        b.title = `Drag onto the map, or click then click the map: ${item.label}`;
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.trayPress(e, scroller, { pick: (move) => this.handlers.trayPointerDown(item, move), tap: (up) => this.handlers.trayTap(item, up.pointerType) });
        });
      } else {
        // A crossing's style (barriers, gates) only goes on a level crossing: it says it needs a road.
        // A tap says so too, since a phone never shows a title.
        // Clicked (a mouse or pen), a model or train is carried, as a piece is: each click on the map puts one down.
        const crossing = item.kind === "prop" && crossingStyleOf(item.asset);
        const tip = crossing ? `${item.label}: goes where track crosses a road` : `Drag onto the map, or click then click the map: ${item.label}`;
        const key = trayKey(item);
        b.dataset.key = key;
        b.classList.toggle("armed", this.armedKey === key);
        b.classList.toggle("carried", this.armedKey === key && this.armedCarried);
        b.title = tip;
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.trayPress(e, scroller, {
            pick: (move) => this.handlers.trayPointerDown(item, move),
            tap: (up) => {
              if (up.pointerType !== "touch") this.handlers.trayTap(item, up.pointerType);
              else if (crossing) this.toast(tip);
            },
          });
        });
      }
      if (openDef?.favourites && canFavourite(item)) {
        // ★: a favourite (shown first on the tab). Tapped, it's added or taken off.
        const key = trayKey(item);
        const star = el("span", "fav");
        const mark = () => {
          const on = this.favourites.includes(key);
          star.textContent = on ? "★" : "☆";
          star.classList.toggle("on", on);
          star.title = on ? "Take off favourites" : "Add to favourites";
        };
        mark();
        star.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.favourites = toggleFavourite(this.favourites, key);
          saveFavourites(this.favourites);
          this.handlers.buttonTap();
          mark();
          if (unpinned) unpinned();
        });
        b.appendChild(star);
      }
      return b;
    };
    // The tabs for the mode; a tab with a single shelf opens straight onto its items.
    // A tab's catalogue shelves, once loaded (their code is fetched the first time the tab opens).
    const loadedGroups = new Map<string, TrayGroup[]>();
    let openId = "";
    let openDef: TrayTab | null = null;
    const openTab = (tab: TrayTab, shelf?: string) => {
      if (openId !== "" && openId !== tab.id) this.handlers.trayTabChanged();
      openId = tab.id;
      openDef = tab;
      // The Land tab switches land editing on (with its first tool), any other tab off.
      this.chooseLandTool(tab.land ? (this.landTool ?? "move") : null);
      tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", (x as HTMLElement).dataset.tab === tab.id));
      this.tray.classList.toggle("track-tab", !!tab.orient);
      // Drawing track is on the Track tab only: another tab puts the pencil down.
      this.tray.classList.toggle("draw-tab", tab.id === "track");
      if (tab.id !== "track" && this.drawing) this.handlers.trayDraw(false);
      this.handlers.trackTab?.(tab.id === "track");
      this.tray.classList.toggle("turn-only", tab.orient === "turn");
      this.propsTab = tab.orient === "turn";
      let groups = tab.groups;
      if (tab.props) {
        const loaded = loadedGroups.get(tab.id);
        if (loaded) groups = [...tab.groups, ...loaded];
        else {
          void propGroups(tab.props).then((g) => {
            loadedGroups.set(tab.id, g);
            // (Opened on a shelf, as "Show me" does: it opens on that shelf once its props are in.)
            if (openId === tab.id) openTab(tab, shelf);
          });
          if (groups.length === 0) {
            this.trayGlide++;
            scroller.innerHTML = `<div class="tray-loading">Unpacking…</div>`;
            return;
          }
        }
      }
      // Game mode: kits and furniture not learned yet stay off the tray (`shownGroups`).
      if (this.trayKnown) groups = shownGroups(groups, this.trayKnown);
      const open = shelf ? groups.find((g) => g.label === shelf) : undefined;
      if (groups.length === 1) showItems(groups, groups[0], false);
      else if (open) showItems(groups, open);
      else showGroups(groups);
    };
    let list: TrayTab[] = [];
    this.openTrayTab = (id, shelf) => {
      const tab = list.find((t) => t.id === id);
      if (tab) openTab(tab, shelf);
    };
    this.reopenTray = () => {
      if (openDef) openTab(openDef);
    };
    this.showTabs = (mode) => {
      tabs.innerHTML = "";
      list = trayTabs(mode);
      for (const tab of list) {
        // Tapping a tab (even the open one) goes back to its groups. (Drawing on a phone on its side, the tray is only
        // its tabs, its shelves put away for the map's sake: a tab tapped there puts the pencil down, so they show.)
        const t = button(tab.label, `${tab.label}`, () => {
          if (this.drawing && getComputedStyle(scroller).display === "none") this.handlers.trayDraw(false);
          openTab(tab);
        }, "tab");
        t.dataset.tab = tab.id;
        tabs.appendChild(t);
      }
      openTab(list[0]);
    };
    // Turn and flip, for track pieces: set how the next piece comes out, or turn the one in hand (with another finger).
    const orient = el("div", "tray-orient");
    // (On a phone they sit in the tray's tab row as icons: their words go.)
    this.flipTrayBtn = button(`⇋<span class="chip-word"> Flip</span>`, "Mirror the next piece (or the one you're holding)", () => this.handlers.trayFlip(), "chip text tray-flip");
    const turnBtn = button(`↻<span class="chip-word"> Turn</span><span class="turn-arrow">↑</span>`, "Turn the next piece (or the one you're holding) an eighth of a turn", () => this.handlers.trayTurn(), "chip text");
    // Tapped with a second finger while the first holds a piece (QA): a browser sends no click for a finger that isn't
    // the first, so these act on that finger's lift over them (the first finger's tap still clicks, once).
    const secondFinger = (b: HTMLButtonElement, act: () => void) =>
      b.addEventListener("pointerup", (e) => {
        if (e.pointerType === "touch" && !e.isPrimary && b.contains(document.elementFromPoint(e.clientX, e.clientY))) act();
      });
    secondFinger(turnBtn, () => this.handlers.trayTurn());
    secondFinger(this.flipTrayBtn, () => this.handlers.trayFlip());
    orient.append(turnBtn, this.flipTrayBtn);
    // Draw: a drag on the map lays a line of track behind the finger (see DrawHand).
    this.drawBtn = button(`✎<span class="draw-word"> Draw</span>`, "Draw track: drag from the end of a track, or across the ground", () => this.handlers.trayDraw(!this.drawing), "chip text tray-draw");
    // The tab row and the tools (Draw, Turn, Flip): on a big screen the tools float above the tray (the row is just the
    // tabs); on a phone they share the tab row, at its right, the tabs scrolling in what's left (they never cover a tab,
    // nor the track being laid). First in the page, as they were, for a keyboard and a screen reader; on a phone the
    // row shows them after the tabs.
    // Clear: a tap takes away what's under it, a sweep all it passes over (any tab).
    this.eraseBtn = button(`🧽<span class="chip-word"> Clear</span>`, "Clear: tap or sweep over track and things to take them away", () => this.handlers.trayErase(!this.erasing), "chip text tray-erase");
    const pens = el("div", "tray-pens");
    pens.append(this.drawBtn, this.eraseBtn);
    const tools = el("div", "tray-tools");
    tools.append(pens, orient);
    const head = el("div", "tray-head");
    head.append(tools, tabs);
    this.tray.append(head, scroller);
    this.root.appendChild(this.tray);

    // Beside the HUD, not in it, so a toast shows over the panels opened over the HUD too (the Blueprints board).
    this.root.after(this.toastEl);
    // A tap dismisses a toast early (and the next waiting comes on); one with something to open opens it.
    this.toastEl.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = this.toastShowing;
      const tap = t && this.toastEl.textContent === t.message ? t.tap : undefined;
      this.dismissToast();
      tap?.();
    });

    this.help.hidden = true;
    this.help.innerHTML = `
      <div class="help-card">
        <h2>Welcome to Woodrail</h2>
        <div class="tips">
          <div class="tip"><span class="tip-art art-build"></span><b>Build</b><span>Tap a shelf in the tray, then drag a piece out. Or tap ✎ Draw and draw a line of track with a finger.</span></div>
          <div class="tip"><span class="tip-art art-run"></span><b>Run</b><span>Drop a train on the track and tap the engine to set it going.</span></div>
          <div class="tip"><span class="tip-art art-look"></span><b>Look around</b><span>Drag to pan, pinch or scroll to zoom, double-tap to take a closer look.</span></div>
        </div>
        <p class="help-goals"><b>Goals</b> at the top say what to do next: tap <b>Show me</b> to see where.</p>
        <details class="more-help">
          <summary>More help</summary>
          <ul>
            <li><b>Pegs</b> click into holes when they're close.</li>
            <li><b>Edit:</b> tap a piece to rotate, flip or delete it. Drag it to move it; drop it on the tray to put it away.</li>
            <li><b>Switches:</b> tap the yellow lever to change the points.</li>
            <li><b>Towns:</b> join two stations with track to connect their towns.</li>
            <li><b>Camera:</b> right-drag or two-finger twist to orbit.</li>
          </ul>
          <p class="help-keys">Keys: WASD or arrows pan · Q E turn · R F tilt (Shift: faster) · R rotate, F (or tap Cmd/Ctrl) flip what’s selected · Del delete · Ctrl+Z undo · Space pause · \` performance</p>
        </details>
      </div>`;
    // Illustrate the tips with the same rendered pictures as the tray (or, on a first visit, once they're drawn).
    for (const key of Object.keys(HELP_ART)) {
      const url = this.thumbs.get(key);
      if (url) this.setHelpArt(key, url);
    }
    const look = this.help.querySelector<HTMLElement>(".art-look");
    if (look) look.innerHTML = `<svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="#6a4a2c" stroke-width="3" stroke-linecap="round"><circle cx="21" cy="21" r="11"/><path d="m29.5 29.5 9 9"/><path d="M21 16v10M16 21h10"/></svg>`;
    const ok = button("Let's play", "Close help", () => {
      this.help.hidden = true;
      this.flushToasts();
      try {
        localStorage.setItem("woodrail.helpSeen", "1");
      } catch {
        // storage unavailable: help shows again next visit
      }
    }, "chip text primary");
    this.help.querySelector(".help-card")!.appendChild(ok);
    this.root.appendChild(this.help);
    this.coach = new ControlsTutorial(
      () => h.cameraView(),
      (touch) =>
        this.trayMode === "game"
          ? `Your goals are at the top: ${touch ? "tap" : "click"} Show me to see where.`
          : touch
            ? "Now build: drag a piece out of the tray."
            : "Now build: drag a piece out of the tray, or click one and then the map.",
      () => h.cameraGliding?.() ?? false,
    );
    this.coach.onDone = (skipped) => {
      // (Seen: the help card doesn't come up on its own after it. It's in the menu, and the coach's last card.)
      try {
        localStorage.setItem("woodrail.helpSeen", "1");
      } catch {
        // storage unavailable
      }
      this.flushToasts();
      h.tutorialDone?.(skipped);
    };
    this.coach.onMoreHelp = () => this.showHelp();
    // Held upright, a phone's coach sits just above the tray and its chips (see .coach in style.css).
    const placeCoach = () => this.coach.root.style.setProperty("--coach-bottom", `${Math.round(innerHeight - this.chipsTop() + 10)}px`);
    this.coach.onShow = placeCoach;
    addEventListener("resize", () => {
      if (this.coach.shown) placeCoach();
    });
    this.root.appendChild(this.coach.root);

    this.perf.hidden = true;
    this.root.appendChild(this.perf);
    this.setMode("sandbox");
  }

  /** Where the tray's chips start (Draw, Turn and Flip above it), or the tray where none show: in client pixels. */
  chipsTop(): number {
    let top = this.tray.getBoundingClientRect().top;
    for (const chip of [this.drawBtn, this.eraseBtn, this.tray.querySelector<HTMLElement>(".tray-orient")]) {
      const r = chip?.getBoundingClientRect();
      if (r && r.height > 0) top = Math.min(top, r.top);
    }
    return top;
  }

  /**
   * What's taking taps on the map now (picking pieces, drawing, clearing, picking a route's stops): while any is, a tap
   * on a toast goes through it to the map (QA: picking, a tap on a piece under it hit the toast instead, twice), and it
   * isn't dismissed by a tap.
   */
  private readonly mapTaps = new Set<string>();
  setMapTaps(why: string, on: boolean): void {
    if (on === this.mapTaps.has(why)) return;
    if (on) this.mapTaps.add(why);
    else this.mapTaps.delete(why);
    this.toastEl.classList.toggle("taps-through", this.mapTaps.size > 0);
  }

  /** Show whether drawing track is on (the Draw chip lit). */
  setDrawing(on: boolean): void {
    this.setMapTaps("drawing", on);
    this.drawing = on;
    this.drawBtn.classList.toggle("active", on);
    this.tray.classList.toggle("drawing", on);
  }

  /** Show whether clearing is on (the Clear chip lit). */
  setErasing(on: boolean): void {
    this.setMapTaps("erasing", on);
    this.erasing = on;
    this.eraseBtn.classList.toggle("active", on);
    this.tray.classList.toggle("erasing", on);
  }

  /** The land tool in use (the Land tab open), or null. */
  private landTool: LandTool | null = null;

  /** Choose a land tool (null when leaving the Land tab): mark it in the tray and tell the game. */
  chooseLandTool(tool: LandTool | null): void {
    if (tool === this.landTool) return;
    this.landTool = tool;
    for (const b of this.tray.querySelectorAll<HTMLElement>(".tray-tool")) b.classList.toggle("active", b.dataset.tool === tool);
    this.handlers.landTool(tool);
  }

  /** A tray picture drawn: keep it, and put it in place of any placeholder showing. */
  setThumbnail(key: string, url: string): void {
    this.thumbs.set(key, url);
    this.setHelpArt(key, url);
    for (const node of this.tray.querySelectorAll<HTMLElement>(`[data-thumb="${CSS.escape(key)}"]`)) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.draggable = false;
      node.replaceWith(img);
    }
  }

  /** A help tip's picture, if `key` is one of theirs. */
  private setHelpArt(key: string, url: string): void {
    const sel = HELP_ART[key];
    const node = sel ? this.help.querySelector<HTMLElement>(sel) : null;
    if (node) node.style.backgroundImage = `url(${url})`;
  }

  /** Show the help card if this player hasn't closed it before. */
  firstVisitHelp(): void {
    let seen = false;
    try {
      seen = localStorage.getItem("woodrail.helpSeen") === "1";
    } catch {
      seen = false;
    }
    // A first visit: the camera tutorial (it leads into the goals); the help card is in the menu, and its last card.
    if (!seen && !ControlsTutorial.seen()) this.coach.start();
  }

  /** Label the mode by the logo and offer its own map items in the menu. */
  /** Rebuild the tray's tabs for a mode (set in the constructor, where the tray is built). */
  private showTabs: (mode: GameMode) => void = () => {};
  private openTrayTab: (id: string, shelf?: string) => void = () => {};
  private reopenTray: () => void = () => {};

  /**
   * Which of the tray's items hidden till learned (`unlearned: "hide"`: Game mode's kits) show: set by the game (null:
   * all of them, as in Sandbox). `trayLearned` shows the tray again once something's learned.
   */
  trayKnown: ((item: TrayItem) => boolean) | null = null;

  /** Something was learned: the open tab shows again, with what it brought (back at its shelves). */
  trayLearned(): void {
    this.reopenTray();
  }

  /**
   * What a tray item's corner says (Game mode's toy box: how many are left, or that it's locked), or null for nothing.
   * Set by the game; `refreshTrayBadges` applies it to the items showing.
   */
  trayBadge: ((item: TrayItem) => { text: string; empty: boolean; attention?: boolean; craft?: boolean; locked?: boolean } | null) | null = null;
  private trayButtons: [HTMLElement, TrayItem][] = [];

  refreshTrayBadges(): void {
    for (const [b, item] of this.trayButtons) this.decorate(b, item);
  }

  private decorate(b: HTMLElement, item: TrayItem): void {
    const badge = this.trayBadge?.(item) ?? null;
    let tag = b.querySelector<HTMLElement>(".have");
    b.classList.toggle("attention", badge?.attention === true);
    // None left, but it can be made on the spot: its cost shows instead of a dead zero.
    b.classList.toggle("craft", badge?.craft === true);
    // Not learned yet: says so in its corner (and no ★ to make it a favourite).
    b.classList.toggle("locked", badge?.locked === true);
    if (!badge) {
      tag?.remove();
      b.classList.remove("empty");
      return;
    }
    if (!tag) b.appendChild((tag = el("span", "have")));
    if (tag.textContent !== badge.text) {
      tag.textContent = badge.text;
      // One line always: a long cost ("30🪵 10🪨 100🪙") in smaller type.
      const size = costTagSize(badge.text);
      tag.classList.toggle("long", size !== null);
      tag.style.fontSize = size === null ? "" : `${size}px`;
    }
    b.classList.toggle("empty", badge.empty);
  }

  /** Open a tray tab (and one of its shelves), as if tapped: "Show me" reaches for what a goal needs. */
  openTray(id: string, shelf?: string): void {
    this.openTrayTab(id, shelf);
  }
  private trayMode: GameMode | null = null;

  setMode(mode: GameMode): void {
    if (mode !== this.trayMode) {
      this.trayMode = mode;
      this.showTabs(mode);
    }
    this.modeTag.innerHTML = mode === "game" ? `Game <span class="beta">Beta</span>` : "Sandbox";
    this.modeTag.className = `mode-tag mode-${mode}`;
    for (const b of this.sandboxItems) b.hidden = mode !== "sandbox";
    for (const b of this.gameItems) b.hidden = mode !== "game";
    // (The help's line about goals: only Game has them.)
    const goalsHelp = this.help.querySelector<HTMLElement>(".help-goals");
    if (goalsHelp) goalsHelp.hidden = mode !== "game";
    this.mapBtn.hidden = mode !== "game";
    this.boardBtn.hidden = mode !== "game";
    if (mode !== "game") this.setResearchPill(null);
  }

  /**
   * The research pill: shown with what's being researched ("📘 Bridges 6/10🪵", a bar for how far), "Pick research"
   * with nothing picked, or hidden (null). Called when the research changes (`pillKey`); the DOM is touched only when
   * what it shows does.
   */
  setResearchPill(v: PillView | null): void {
    const text = pillText(v);
    const key = v ? `${text}|${Math.round(v.fill * 100)}` : "";
    if (key === this.pillShown) return;
    this.pillShown = key;
    this.researchPill.hidden = !v;
    if (!v) return;
    this.researchPill.querySelector(".rp-name")!.textContent = v.name;
    this.researchPill.querySelector(".rp-count")!.textContent = v.count;
    this.researchPill.style.setProperty("--fill", `${Math.round(v.fill * 100)}%`);
    this.researchPill.classList.toggle("idle", v.idle);
    this.researchPill.title = v.idle ? "Pick research" : `${text.slice(3)}: tap for Research`;
    this.researchPill.setAttribute("aria-label", v.idle ? "Pick research" : `Research: ${text.slice(3)}`);
    this.fitPill();
  }

  /**
   * The pill's name whole where it can be (QA: "Train ro…" at 360 px): a little smaller if it's cut, and then over two
   * lines if it's still cut (shortened with "…" only past that). Measured when the name or its room changes.
   */
  private fitPill(): void {
    const p = this.researchPill;
    p.classList.remove("rp-small", "rp-wrap");
    const n = p.querySelector<HTMLElement>(".rp-name")!;
    if (p.hidden || n.clientWidth === 0) return;
    const cut = () => n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1;
    if (cut()) p.classList.add("rp-small");
    if (cut()) p.classList.add("rp-wrap");
  }

  /** Show the railway's date (null: hide it, outside Game mode). The page is touched only when the text changes. */
  setDate(text: string | null): void {
    const hidden = text === null;
    if (this.dateTag.hidden !== hidden) this.dateTag.hidden = hidden;
    if (text !== null && this.dateTag.textContent !== text) this.dateTag.textContent = text;
  }

  /** Show the coins (null: hide them, outside Game mode). A rise pops the count. */
  setCoins(n: number | null): void {
    this.coinTag.hidden = n === null;
    if (n === null) return;
    const text = String(n);
    const was = Number(this.coinTag.dataset.n ?? n);
    if (this.coinTag.dataset.n === text) return;
    this.coinTag.dataset.n = text;
    // (A short count on a phone's top bar: 12k, not 12345.)
    this.coinTag.innerHTML = `<i></i>${n >= 10000 ? `${Math.floor(n / 1000)}k` : text}`;
    this.coinTag.title = `${n} coins: towns pay them for deliveries; they buy land`;
    if (n > was) {
      this.coinTag.classList.remove("pop");
      void this.coinTag.offsetWidth;
      this.coinTag.classList.add("pop");
    }
  }

  /** The Research button (and the pill standing in for it on a phone): lit while the picker's open. */
  setBoardButton(open: boolean): void {
    this.boardBtn.classList.toggle("active", open);
    this.researchPill.classList.toggle("active", open);
  }

  /**
   * A newer build is out: offered in the menu (its button gets a dot) and said once in a toast. Nothing new on the map
   * or over the tray, so it never covers a control or a card, on a phone or not.
   */
  showUpdate(onTap: () => void): void {
    if (this.menu.querySelector(".menu-update")) return;
    const item = button("New version · Update", "A newer version of Woodrail is ready: saves, then reloads", () => {
      this.menu.hidden = true;
      onTap();
    }, "menu-item menu-update");
    this.menu.prepend(item);
    this.menuBtn.classList.add("icon-btn-alert");
    this.toast("A new version is ready: Update is in the menu", false, 6000);
  }

  /** The map view is open: its button lit, the goals and tray put away. */
  setMapOpen(open: boolean): void {
    this.mapBtn.classList.toggle("active", open);
    this.root.classList.toggle("map-open", open);
    // A toast up as it opens or closes goes where it should now (the goals put away or back); again once the view has
    // glided to the whole map (`mapSettled`: the labels it keeps clear of have moved).
    this.refitToast();
  }

  /** Hide or show the whole play overlay (the title screen covers the game). */
  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    this.toastEl.hidden = !visible;
    if (!visible) this.menu.hidden = true;
    else requestAnimationFrame(() => this.fitTrayLabels());
  }

  /** Mark the tray's labels too long for their tiles (see the tray's `fitLabels`). */
  private fitTrayLabels: () => void = () => {};

  showHelp(): void {
    this.help.hidden = false;
  }

  /** A menu item that asks before it acts goes back to its plain self. */
  private stopAsking(item: HTMLButtonElement): void {
    window.clearTimeout(this.newGameAsk);
    item.classList.remove("asking");
    item.textContent = "New game";
  }

  toggleMenu(): void {
    this.menu.hidden = !this.menu.hidden;
    // (Opened or closed, New game asks afresh.)
    this.stopAsking(this.newGameItem);
    // The toast showing is over the menu's top items: it goes (the next waiting, if any, comes on under the menu).
    if (!this.menu.hidden && this.toastEl.classList.contains("show")) this.dismissToast();
  }

  setHistory(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
    // (On a phone the bar shows Redo, beside Undo, only while there's something to redo: after an Undo, till an edit.)
    this.redoBtn.classList.toggle("can-redo", canRedo);
    this.redoItem.disabled = !canRedo;
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.innerHTML = uiIcon(paused ? "play" : "pause");
    this.pauseBtn.title = paused ? "Resume (Space)" : "Pause (Space)";
    this.pauseBtn.setAttribute("aria-label", this.pauseBtn.title);
    this.pauseBtn.classList.toggle("active", paused);
  }

  setMuted(muted: boolean): void {
    this.soundBtn.innerHTML = uiIcon(muted ? "mute" : "sound");
    this.soundBtn.title = muted ? "Sound on" : "Sound off";
    this.soundBtn.setAttribute("aria-label", this.soundBtn.title);
    this.soundItem.textContent = muted ? "Sound: off" : "Sound: on";
  }

  /** Show the Re-rail button only while something is off the rails. */
  setRerailVisible(visible: boolean): void {
    if (this.rerailBtn.hidden === !visible) return;
    this.rerailBtn.hidden = !visible;
  }

  /** A short buzz on phones that support it. */
  haptic(kind: "snap" | "refuse"): void {
    try {
      navigator.vibrate?.(kind === "snap" ? 12 : [18, 40, 18]);
    } catch {
      // vibration blocked (e.g. no user gesture yet): skip it
    }
  }

  showEngineCard(lever: number, following: boolean): void {
    this.hideCards();
    this.engineCard.hidden = false;
    this.engineMore.hidden = true;
    this.root.classList.add("card-open");
    this.shownStatus = "";
    this.shownAngle = NaN;
    this.engineLever = Number.NaN;
    // A new card starts the engine's own front first (a way turned round on another engine's card isn't carried over).
    this.engineWay = 1;
    this.updateEngineCard(lever, following);
  }

  updateEngineCard(lever: number, following: boolean): void {
    // Moving: Go keeps going that way. Stopped: the way it last went (or forward).
    if (lever !== 0) this.engineWay = lever > 0 ? 1 : -1;
    this.engineLever = lever;
    this.followBtn.classList.toggle("active", following);
    this.followBtn.title = following ? "Following this train (tap to stop)" : "Follow this train with the camera";
    this.drawEngine();
  }

  /** The engine's lever as the card shows it (to notice the train changing it by itself, turning back). */
  get engineLeverShown(): number {
    return this.engineLever;
  }

  /** Stopped: Go sends it this way (main picks the open way when one end is up against a buffer). */
  setEngineWay(way: 1 | -1): void {
    if (this.engineLever !== 0 || way === this.engineWay) return;
    this.engineWay = way;
    this.drawEngine();
  }

  /**
   * What the engine's doing ("Waiting at a red signal"), and which way its own front points on screen (degrees,
   * clockwise from screen right): the way arrow turns to match. Only what changed is redrawn.
   */
  setEngineView(status: string, frontAngle: number): void {
    if (status !== this.shownStatus) {
      this.shownStatus = status;
      this.engineStatus.textContent = status;
    }
    const a = frontAngle + (this.engineWay === 1 ? 0 : 180);
    // Turned the short way from the angle shown (not round the long way when it passes ±180°): the angle set is
    // unwrapped, so the arrow's turn eases straight there.
    const target = nearestTurn(this.wayAngle, a);
    if (Number.isNaN(this.shownAngle) || Math.abs(target - this.shownAngle) >= 4) {
      this.shownAngle = this.wayAngle = target;
      this.wayBtn.style.setProperty("--way", `${target.toFixed(0)}deg`);
    }
  }

  /** The open engine's train is (or isn't) held at its stop for spacing: Go reads "Go now", and one tap sends it on. */
  /** The open engine's line has a train too many: "Put away" shows (this train, or the one held, back in the box). */
  setPutAway(on: boolean, self: boolean): void {
    const title = self ? "Put this train back in the box: the line has no room for it" : "Put the train this line has no room for back in the box";
    if (on === this.putAwayShown && this.putAwayBtn.title === title) return;
    this.putAwayShown = on;
    this.putAwayBtn.hidden = !on;
    this.putAwayBtn.title = title;
    this.putAwayBtn.setAttribute("aria-label", title);
  }

  setGoNow(on: boolean): void {
    if (on === this.goNow) return;
    this.goNow = on;
    this.drawEngine();
  }

  private drawEngine(): void {
    const moving = this.engineLever !== 0;
    const now = moving && this.goNow;
    this.goBtn.classList.toggle("stop", moving && !now);
    // Go goes the way the arrow beside it shows (no triangle of its own pointing elsewhere).
    this.goBtn.innerHTML = now ? "Go now" : moving ? `<span class="go-icon">■</span>Stop` : "Go";
    this.goBtn.title = now ? "Go now, without waiting to space out" : moving ? "Stop" : "Go";
    // The arrow's angle depends on the way chosen: redrawn on the next view update.
    this.shownAngle = NaN;
  }

  /** Planning a train's route: the engine card slims to its route, and the tray is put away (see style.css). */
  setPlanning(on: boolean): void {
    this.root.classList.toggle("planning", on);
    // (No drawing track while a route is planned: a press picks a stop.)
    this.drawBtn.disabled = on;
    this.eraseBtn.disabled = on;
  }

  /** The Lines view open (the tray goes, as when planning: the map wants the room). */
  setLinesOpen(on: boolean): void {
    this.root.classList.toggle("lines-open", on);
  }

  /** The menu's Lines item, where there are lines to show (and routes are allowed). */
  setLinesAvailable(on: boolean): void {
    this.linesItem.hidden = !on;
  }

  get engineCardOpen(): boolean {
    return !this.engineCard.hidden;
  }

  showCarCard(): void {
    this.hideCards();
    this.carCard.hidden = false;
    this.root.classList.add("card-open");
  }

  /** The card for a selected track piece, or (with a title, and no Flip) a prop, or (no Rotate either) scenery. */
  showPieceCard(flippable: boolean, title = "Track piece", canFlip = true, canRotate = true, canGroup = false): void {
    this.hideCards();
    this.pieceCard.hidden = false;
    this.root.classList.add("card-open");
    this.pieceTitle.textContent = title;
    this.flipBtn.hidden = !canFlip;
    this.rotateBtn.hidden = !canRotate;
    this.flipBtn.disabled = !flippable;
    if (this.rotateBtn.parentElement !== this.pieceRow) this.pieceRow.append(this.rotateBtn, this.flipBtn, this.deleteBtn);
    this.pieceRow.hidden = false;
    this.rotateBtn.textContent = "Rotate";
    this.rotateBtn.disabled = false;
    this.deleteBtn.disabled = false;
    this.deleteBtn.title = "Remove this piece (Del)";
    this.selectMoreBtn.hidden = !canGroup;
    this.groupHint.hidden = true;
    this.groupRow.hidden = true;
    this.leverList.hidden = true;
    this.pieceCard.classList.remove("group");
  }

  /**
   * On the open piece card (a signal box or lever frame's): the points and signals near it, each a chip saying which
   * way it's set; a tap throws it (`onThrow` with its index). An empty list says there are none near.
   */
  showLevers(levers: readonly { label: string; title: string }[], onThrow: (i: number) => void): void {
    this.leverList.replaceChildren(
      ...(levers.length === 0 ? [el("div", "card-hint", "No points or signals near: put it by a junction")] : levers.map((l, i) => button(l.label, l.title, () => onThrow(i), "chip text lever-chip"))),
    );
    this.leverList.hidden = false;
  }

  /** The card while picking several pieces: how many, what a tap and a drag do, and what can be done to them all. */
  showGroupCard(count: number, canAddJoined: boolean): void {
    if (this.pieceCard.hidden || !this.pieceCard.classList.contains("group")) {
      this.hideCards();
      this.pieceCard.hidden = false;
      this.root.classList.add("card-open");
      this.pieceCard.classList.add("group");
      this.root.classList.add("picking");
    }
    this.pieceTitle.textContent = count === 1 ? "1 piece picked" : `${count} pieces picked`;
    this.groupHint.textContent = count === 0 ? "Tap track to pick it" : "Tap track to pick more · drag to move together";
    // One row: what to do to them all, then Done.
    if (this.rotateBtn.parentElement !== this.groupRow) this.groupRow.insertBefore(this.rotateBtn, this.doneBtn);
    this.groupRow.insertBefore(this.deleteBtn, this.doneBtn);
    this.pieceRow.hidden = true;
    this.groupHint.hidden = false;
    this.groupRow.hidden = false;
    this.flipBtn.hidden = true;
    this.rotateBtn.hidden = false;
    this.rotateBtn.textContent = "Turn";
    this.rotateBtn.disabled = count === 0;
    this.deleteBtn.disabled = count === 0;
    this.deleteBtn.title = "Remove these pieces (Del)";
    this.joinedBtn.disabled = !canAddJoined;
    this.selectMoreBtn.hidden = true;
  }

  /**
   * A press in the tray: after a few pixels, a mostly upward drag picks the item up (`pick`, out onto the mat) and a
   * mostly sideways one scrolls the tray, gliding on when let go; a press that hardly moves is a tap (`tap`).
   * Decided by us, so it behaves the same every time.
   */
  private trayPress(down: PointerEvent, scroller: HTMLElement, on: { pick?: (move: PointerEvent) => void; tap?: (up: PointerEvent) => void }): void {
    this.trayGlide++;
    const id = down.pointerId;
    const x0 = down.clientX;
    const y0 = down.clientY;
    const scroll0 = scroller.scrollLeft;
    let mode: "undecided" | "scroll" = "undecided";
    let lastX = x0;
    let lastT = down.timeStamp;
    let velocity = 0; // px per ms, of the content
    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (mode === "undecided") {
        if (Math.hypot(dx, dy) < TRAY_DECIDE_PX) return;
        if (on.pick && -dy > Math.abs(dx) * 0.7) {
          // Up and out: pick the item up.
          stop();
          on.pick(e);
          return;
        }
        mode = "scroll";
      }
      scroller.scrollLeft = scroll0 - dx;
      const dt = Math.max(1, e.timeStamp - lastT);
      velocity = velocity * 0.4 + ((lastX - e.clientX) / dt) * 0.6;
      lastX = e.clientX;
      lastT = e.timeStamp;
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      stop();
      if (mode === "undecided" && e.type === "pointerup") on.tap?.(e);
      // A quick swipe glides on, slowing down.
      else if (mode === "scroll" && e.timeStamp - lastT < 80 && Math.abs(velocity) > 0.05) this.glideTray(scroller, velocity);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /** Bumped to stop a running tray glide. */
  private trayGlide = 0;

  private glideTray(scroller: HTMLElement, velocity: number): void {
    const run = ++this.trayGlide;
    let v = velocity;
    let last = performance.now();
    const step = (now: number) => {
      if (run !== this.trayGlide) return;
      const dt = Math.min(50, now - last);
      last = now;
      scroller.scrollLeft += v * dt;
      v *= Math.exp(-dt / TRAY_GLIDE_MS);
      if (Math.abs(v) > 0.02) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Offer Cloud save in the menu (the build has a cloud to save to: `VITE_CLOUD_URL`). */
  addCloudItem(onTap: () => void): void {
    this.linesItem.after(
      button("☁ Cloud save", "Keep your railway online, and carry on on another device", () => {
        this.menu.hidden = true;
        onTap();
      }, "menu-item"),
    );
  }

  /** Show how tray pieces will come out: the Turn arrow points their way, and Flip lights up when mirroring. */
  /** Show "Send to Claude…" in the menu (the page can store reports). */
  enableReports(): void {
    this.reportItem.hidden = false;
  }

  private buildReportCard(): void {
    const c = this.reportCard;
    c.hidden = true;
    this.reportNote.rows = 3;
    this.reportNote.placeholder = "What were you trying to do, and what went wrong?";
    this.reportNote.className = "report-note";
    const status = el("div", "report-status");
    const send = button("Send", "Send the report", async () => {
      send.disabled = true;
      status.textContent = "Sending…";
      try {
        await this.handlers.sendReport(this.reportNote.value.trim());
        c.hidden = true;
        this.reportNote.value = "";
        this.toast("Sent to Claude, with a picture of this view");
      } catch (e) {
        status.textContent = `Couldn't send: ${(e as { code?: string; message?: string }).code ?? (e as Error).message ?? e}`;
      } finally {
        send.disabled = false;
      }
    }, "chip text");
    const cancel = button("Cancel", "Close", () => (c.hidden = true), "chip text");
    const row = el("div", "card-row");
    row.append(cancel, send);
    c.append(el("div", "card-title", "Send to Claude"), this.reportNote, status, row);
    this.root.appendChild(c);
  }

  private openReport(): void {
    this.reportCard.querySelector(".report-status")!.textContent = "The picture is taken as you send, so the view stays as it is now.";
    this.reportCard.hidden = false;
    this.reportNote.focus();
  }

  /** The open tab holds models (its Turn turns the next model, not the next piece). */
  propsTab = false;
  private trayArrowDeg = NaN;
  private trayArrowWanted = NaN;

  setTrayOrientation(flipped: boolean): void {
    this.flipTrayBtn.classList.toggle("active", flipped);
  }

  /** Point the Turn arrow (degrees clockwise on screen from straight up). Cheap to call every frame. */
  private holdingKit = false;

  /** A kit piece is in hand: on a models tab (Turn only) Flip shows too, to turn its building to the other side. */
  setHoldingKit(on: boolean): void {
    if (on === this.holdingKit) return;
    this.holdingKit = on;
    this.tray.classList.toggle("holding-kit", on);
  }

  setTrayArrow(deg: number): void {
    const d = Math.round(deg);
    if (d === this.trayArrowWanted) return;
    this.trayArrowWanted = d;
    // The short way round from where it points now, so the arrow's turn never spins the long way.
    const from = Number.isNaN(this.trayArrowDeg) ? d : this.trayArrowDeg;
    this.trayArrowDeg = from + ((((d - from) % 360) + 540) % 360) - 180;
    this.tray.style.setProperty("--tray-turn", `${this.trayArrowDeg}deg`);
  }

  showDepotCard(title: string): void {
    this.hideCards();
    this.depotTitle.textContent = title;
    this.depotExtra.hidden = true;
    this.depotExtra.innerHTML = "";
    this.depotYard.hidden = true;
    this.depotYard.innerHTML = "";
    // (Back to a depot's own: a town's ledger, once drawn here, marks it.)
    this.depotExtra.className = "depot-extra";
    this.depotCard.hidden = false;
    // (A card scrolled on a phone opens at its top again: its title and ✕ in view.)
    this.depotCard.scrollTop = 0;
    this.root.classList.add("card-open");
  }

  /**
   * Refresh the open depot card: one line per pile ("Logs ●●●○○…  5"), and the two switches. `waitFull` is null
   * where it doesn't apply (a depot that gives nothing). `idle`: a school with nothing to research (its line in amber,
   * and a button for the picker).
   */
  updateDepotCard(piles: { label: string; count: number; cap: number }[], auto: boolean, waitFull: boolean | null, note = "", idle = false): void {
    const text = [...piles.map((p) => `${p.label} ${p.count}/${p.cap}`), ...(note ? [note] : [])].join("   ·   ");
    if (this.depotStock.textContent !== text) this.depotStock.textContent = text;
    this.depotStock.classList.toggle("idle", idle);
    this.depotPickBtn.hidden = !idle;
    setToggle(this.depotAutoBtn, auto);
    this.depotWaitBtn.hidden = waitFull === null;
    setToggle(this.depotWaitBtn, !!waitFull);
    this.depotWaitBtn.disabled = !auto;
  }

  /** Show the land card (null: none, while choosing), or hide it (`text` null). */
  setLandCard(text: string | null, canBuy = false): void {
    this.landBtn.classList.toggle("active", text !== null);
    this.landCard.hidden = text === null;
    if (text === null) return;
    this.landText.textContent = text;
    this.landBuyBtn.hidden = !canBuy;
  }

  /** Show an old industry's card (see `ruinCard` in map-sites.ts). */
  showRuinCard(card: { title: string; resource: string; status: string; own: string | null; clear: string; restore: string | null }): void {
    this.hideCards();
    this.ruinTitle.textContent = card.title;
    this.ruinResource.textContent = card.resource;
    this.ruinResource.hidden = !card.resource;
    this.ruinStatus.textContent = card.status;
    this.ruinOwn.textContent = card.own ?? "";
    this.ruinOwn.hidden = !card.own;
    this.ruinClearBtn.textContent = card.clear;
    this.ruinRestoreBtn.textContent = card.restore ?? "";
    this.ruinRestoreBtn.hidden = !card.restore;
    this.ruinCard.hidden = false;
    this.root.classList.add("card-open");
  }

  get ruinCardOpen(): boolean {
    return !this.ruinCard.hidden;
  }

  get depotCardOpen(): boolean {
    return !this.depotCard.hidden;
  }

  /** Called when a card changes size (as it opens, as its rows fill in): the view may make room for what it's for. */
  onCardResize: (() => void) | null = null;

  /** Where the open card for one thing (an engine, a car, a piece, a depot) is on screen, or null. */
  openCardRect(): DOMRect | null {
    for (const c of [this.engineCard, this.carCard, this.pieceCard, this.depotCard, this.ruinCard]) {
      if (!c.hidden && !c.classList.contains("group") && c.offsetParent !== null) return c.getBoundingClientRect();
    }
    return null;
  }

  hideCards(): void {
    // A toast waiting for room: once the cards are put away (and any card opening in their place is up), it comes on.
    if (this.toastWaitsForCard) requestAnimationFrame(() => this.flushToasts());
    this.root.classList.remove("card-open");
    this.depotCard.hidden = true;
    this.ruinCard.hidden = true;
    this.engineCard.hidden = true;
    this.carCard.hidden = true;
    this.pieceCard.hidden = true;
    this.pieceCard.classList.remove("group");
    this.root.classList.remove("picking");
  }

  /** The tray piece readied for placing with taps (`trayKey`), or null. */
  private armedKey: string | null = null;
  private armedCarried = false;

  /** Mark the tray item that's ready (`carried`: clicked, following the mouse, marked apart), or none (null). */
  setArmed(key: string | null, carried = false): void {
    if (key === this.armedKey && carried === this.armedCarried) return;
    this.armedKey = key;
    this.armedCarried = carried;
    this.tray.querySelectorAll<HTMLElement>(".tray-item[data-key]").forEach((b) => {
      b.classList.toggle("armed", b.dataset.key === key);
      b.classList.toggle("carried", b.dataset.key === key && carried);
    });
  }

  /**
   * Show a message. A celebration stays up long enough to read: messages that come while it's fresh wait their turn
   * (several things often happen at once: a connection, a goal done, a hint). A plain message gives way at once.
   */
  /**
   * Show a message. Toasts come one at a time, each up long enough to read; celebrations go ahead of plain ones
   * waiting, a few wait at most, and the same message isn't queued twice.
   */
  toast(message: string, celebrate = false, ms = 2200, tap?: () => void): void {
    this.queueToast(message, celebrate, ms, performance.now() - this.lastButtonAt < TOAST_ANSWER_MS, tap);
  }

  /** Is toast `message` showing, or waiting its turn (not yet gone)? */
  hasToast(message: string): boolean {
    if (this.toastQueue.some((t) => t.message === message)) return true;
    const t = this.toastShowing;
    return !!t && t.message === message && this.toastEl.classList.contains("show") && this.toastEl.textContent === message;
  }

  /** Take toast `message` back, showing or waiting (what it said was undone): the next waiting comes on. */
  withdrawToast(message: string): void {
    const i = this.toastQueue.findIndex((t) => t.message === message);
    if (i >= 0) this.toastQueue.splice(i, 1);
    const t = this.toastShowing;
    if (t && t.message === message && this.toastEl.classList.contains("show") && this.toastEl.textContent === message) {
      this.toastShowing = null;
      this.dismissToast();
    }
  }

  /**
   * Say `message` in place of toast `old` (several goals ticked together become one line): changed where it shows or
   * waits, its time to read starting again; a plain toast if `old` has gone.
   */
  retoast(old: string, message: string, celebrate = false, ms = 2200): void {
    const queued = this.toastQueue.find((t) => t.message === old);
    if (queued) {
      queued.message = message;
      return;
    }
    const t = this.toastShowing;
    if (t && t.message === old && this.toastEl.classList.contains("show") && this.toastEl.textContent === old) {
      note("toast", message);
      t.message = message;
      this.showToast(message, celebrate, ms, t.urgent);
      this.toastShownAt = performance.now();
      this.toastHeldUntil = this.toastShownAt + toastMs(message, celebrate, ms);
      return;
    }
    this.toast(message, celebrate, ms);
  }

  /**
   * `urgent`: it answers what the player just did (a refusal, a button's "can't"): it shows at once, even over an open
   * card. Anything else (a hint, news of the world) waits while an open card leaves it no room (see `placeToast`).
   */
  private queueToast(message: string, celebrate: boolean, ms: number, urgent: boolean, tap?: () => void): void {
    note("toast", message);
    const showing = this.toastHeldUntil > performance.now() && this.toastEl.textContent === message;
    if (showing || this.toastQueue.some((t) => t.message === message)) return;
    const t = { message, celebrate, ms, urgent, ...(tap ? { tap } : {}) };
    // (Never ahead of a refusal: that answers what was just done.)
    const plain = celebrate ? this.toastQueue.findIndex((q) => !q.celebrate && !q.urgent) : -1;
    if (plain !== -1) this.toastQueue.splice(plain, 0, t);
    else this.toastQueue.push(t);
    while (this.toastQueue.length > TOAST_QUEUE) {
      const old = this.toastQueue.findIndex((q) => !q.celebrate);
      this.toastQueue.splice(old === -1 ? 0 : old, 1);
    }
    this.flushToasts();
  }

  /** The toast showing goes now, and the next waiting comes on. */
  private dismissToast(): void {
    clearTimeout(this.toastTimer);
    this.toastEl.classList.remove("show");
    this.toastHeldUntil = 0;
    this.heldRefusal = null;
    this.flushToasts();
  }

  private flushToasts(): void {
    clearTimeout(this.toastFlushTimer);
    // Held while the help card or the camera tutorial is up (they'd cover each other); closing it lets them through.
    if (!this.help.hidden || this.coach.shown) return;
    const wait = this.toastHeldUntil - performance.now();
    if (wait > 0) {
      this.toastFlushTimer = window.setTimeout(() => this.flushToasts(), wait);
      return;
    }
    if (this.toastQueue.length === 0) return;
    // The first that may show: one with no room (a card open) waits till the cards close (`hideCards`), and lets one
    // that answers the player go ahead of it.
    const i = this.toastQueue.findIndex((q) => this.placeToast(q.message, q.urgent));
    this.toastWaitsForCard = i === -1;
    if (i === -1) return;
    const [next] = this.toastQueue.splice(i, 1);
    this.showToast(next.message, next.celebrate, next.ms, next.urgent);
    this.toastShowing = next;
    this.toastShownAt = performance.now();
    this.toastHeldUntil = this.toastShownAt + toastMs(next.message, next.celebrate, next.ms);
    if (this.toastQueue.length > 0) this.flushToasts();
  }

  /**
   * A card changed size under the toast showing: move it clear, or, with no room left, put it back to wait for the
   * cards to close if it had only just come on; one up long enough to read (`TOAST_SEEN_MS`) just goes, so it isn't
   * shown twice.
   */
  private refitToast(): void {
    const t = this.toastShowing;
    if (!t || !this.toastEl.classList.contains("show") || this.toastEl.textContent !== t.message) return;
    if (this.placeToast(t.message, t.urgent)) return;
    clearTimeout(this.toastTimer);
    this.toastEl.classList.remove("show");
    this.toastShowing = null;
    this.toastHeldUntil = 0;
    if (performance.now() - this.toastShownAt >= TOAST_SEEN_MS) {
      this.flushToasts();
      return;
    }
    this.toastQueue.unshift(t);
    this.toastWaitsForCard = true;
  }

  /** The refusal showing while a held piece is over where it can't go (kept up until it can, or it's put down). */
  private heldRefusal: string | null = null;

  /**
   * Why the piece in hand can't go where it is (null: it can now). Stays on screen as long as that's so, rather than
   * flashing by; once it can go, it goes after a short while (it may still be being read).
   */
  setRefusal(message: string | null): void {
    if (message === this.heldRefusal) return;
    this.heldRefusal = message;
    if (message) {
      this.toastQueue.length = 0;
      this.toastShowing = null;
      this.showToast(message, false, 600000, true);
      this.toastHeldUntil = performance.now() + toastMs(message, false);
    } else if (this.toastEl.classList.contains("show")) {
      clearTimeout(this.toastTimer);
      // (Quickly: the piece in hand now shows it can go, so the old reason reads as stale if it lingers.)
      this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 400);
      // It no longer holds the toast: what comes next (the drop's "Joined", a hint) may show at once.
      this.toastHeldUntil = 0;
    }
  }

  /**
   * A refusal when something's put down where it can't go: up long enough to read (`toastMs`, as every toast). It
   * answers what was just done, so it goes first, never waiting behind another toast (the "Made a switch" of the same
   * drop). One that had only just come on (or a celebration) shows again after it.
   */
  refuse(message: string): void {
    this.heldRefusal = null;
    note("toast", message);
    const now = performance.now();
    const ms = 2200;
    const up = this.toastEl.classList.contains("show") && this.toastEl.textContent === message;
    if (up) {
      // Already showing (it was the held refusal): it stays up long enough to read from now.
      this.toastQueue.splice(0, this.toastQueue.length, ...this.toastQueue.filter((q) => q.message !== message));
      clearTimeout(this.toastTimer);
      this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), toastMs(message, false, ms));
      this.toastShowing = { message, celebrate: false, ms, urgent: true };
      this.toastShownAt = now;
      this.toastHeldUntil = now + toastMs(message, false, ms);
      return;
    }
    const queue = this.toastQueue.filter((q) => q.message !== message);
    const was = this.toastShowing;
    if (was && this.toastHeldUntil > now && this.toastEl.textContent === was.message && (was.celebrate || now - this.toastShownAt < REFUSAL_BUMP_MS)) queue.unshift(was);
    this.toastQueue.splice(0, this.toastQueue.length, { message, celebrate: false, ms, urgent: true }, ...queue.slice(0, TOAST_QUEUE));
    this.toastShowing = null;
    this.toastHeldUntil = 0;
    this.flushToasts();
  }

  private showToast(message: string, celebrate: boolean, ms: number, urgent = false): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle("celebrate", celebrate);
    this.toastEl.classList.remove("show");
    this.placeToast(message, urgent);
    // Restart the slide-in even when a toast is already showing.
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), toastMs(message, celebrate, ms));
  }

  /**
   * Put the toast (with `message`) clear of what's pinned under the top bar (the goals; the picking card): below it if
   * they'd overlap (on a phone they always do). Clear of an open card too: beside it if there's room (a phone on its
   * side), else just above it. False if a card leaves it no room (it'd cover the card's top rows). Measured when a toast
   * shows, not per frame.
   */
  private placeToast(message: string, urgent = false): boolean {
    if (!this.fitToast(message, urgent)) return false;
    // Wherever it went, clear of the tray (QA, 667x375: a three-line toast beside a docked card reached 2 px into it).
    const t = this.toastEl;
    const tray = this.tray.getBoundingClientRect();
    // (By layout, not its box: the toast slides in, its box a little higher till it's shown. Shown, it's tilted 0.8°,
    // a corner that much lower: QA, a wide one cleared the tray by 1-2 px.)
    const tilt = Math.ceil((t.offsetWidth * Math.sin((0.8 * Math.PI) / 180)) / 2);
    if (tray.height > 0 && getComputedStyle(this.tray).visibility !== "hidden" && t.offsetTop + t.offsetHeight + tilt > tray.top - 6) t.style.top = `${Math.max(8, Math.round(tray.top - 6 - tilt - t.offsetHeight))}px`;
    return true;
  }

  /** Where a toast goes (see `placeToast`): false if there's no room for it now. */
  private fitToast(message: string, urgent: boolean): boolean {
    const t = this.toastEl;
    t.textContent = message;
    t.style.top = t.style.left = t.style.maxWidth = "";
    let r = t.getBoundingClientRect();
    const cards = [...this.root.querySelectorAll<HTMLElement>(".card")].filter((c) => !c.hidden && c.offsetParent !== null && !c.classList.contains("group")).map((c) => c.getBoundingClientRect());
    const over = (q: DOMRect) => !(q.right < r.left || q.left > r.right || q.bottom < r.top || q.top > r.bottom);
    // Beside a card (on a phone on its side, cards dock at the right, under the top bar): in the room to its left.
    const beside = cards.find((q) => over(q) && q.left >= 200);
    if (beside) {
      t.style.left = `${Math.round(beside.left / 2)}px`;
      t.style.maxWidth = `${Math.round(beside.left - 24)}px`;
      r = t.getBoundingClientRect();
    }
    // Below what's pinned under the top bar where it would be.
    const underPinned = () => {
      let below = 0;
      for (const p of this.root.querySelectorAll<HTMLElement>(".goals, .piece-card.group")) {
        // (Put away by the map or the board, the goals keep their box: QA, the toast went under them, over the map's labels.)
        if (p.hidden || p.offsetParent === null || getComputedStyle(p).visibility === "hidden") continue;
        const q = p.getBoundingClientRect();
        if (q.width === 0 || q.right < r.left || q.left > r.right || q.bottom < r.top) continue;
        below = Math.max(below, q.bottom);
      }
      if (below > 0) {
        t.style.top = `${Math.round(below + 22)}px`;
        r = t.getBoundingClientRect();
      }
    };
    underPinned();
    if (beside) {
      // Too tall for the room beside the card, down to the tray (QA, 667 wide: six lines, pushed up off the tray over
      // the goals and the date): it goes over the card instead, at its own width, under the goals.
      const tray = this.tray.getBoundingClientRect();
      const floor = tray.height > 0 && getComputedStyle(this.tray).visibility !== "hidden" ? tray.top - 6 : window.innerHeight - 8;
      if (t.offsetTop + t.offsetHeight + 4 <= floor) return true;
      t.style.top = t.style.left = t.style.maxWidth = "";
      r = t.getBoundingClientRect();
      underPinned();
      return true;
    }
    if (this.root.classList.contains("map-open")) {
      this.fitToastOnMap();
      return true;
    }
    // Over a card (a tall one, on a phone held upright): just above its top edge if it fits there, else no room.
    const card = cards.find(over);
    if (!card) return true;
    const h = t.offsetHeight;
    if (card.top - t.offsetTop >= h + 8) {
      t.style.top = `${Math.round(card.top - h - 8)}px`;
      return true;
    }
    // No room above it: a toast that answers the player (urgent) shows now all the same, at the card's foot, just
    // above the tray (QA: over its top it hid the card's ✕ and title); any other waits for the card to close.
    if (!urgent) return false;
    t.style.top = `${Math.round(card.bottom - h - 10)}px`;
    return true;
  }

  /**
   * The map open: the toast clear of its labels and badges (QA: it covered the top ones), between the top bar and the
   * map's bar. The highest clear place, in the middle or at a side; else made narrower (more lines) and tried again;
   * else wherever it hides least, never a badge if a label will do (see `leastCovered`). Measured as it shows (and again
   * once the view settles: `mapSettled`), a few layouts, nothing per frame.
   */
  private fitToastOnMap(): void {
    const t = this.toastEl;
    const labels: Label[] = [...this.root.querySelectorAll<HTMLElement>(".map-marker:not(.off)")].map((m) => {
      const q = m.getBoundingClientRect();
      return { left: q.left, top: q.top, right: q.right, bottom: q.bottom, badge: m.classList.contains("kind-ruin") };
    });
    const bar = this.root.querySelector<HTMLElement>(".map-bar")?.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const area = { left: 0, right: vw, top: t.offsetTop - TOAST_SLIDE, bottom: bar && bar.height > 0 ? bar.top - 12 : window.innerHeight - 12 };
    const natural = t.offsetWidth;
    // (Narrower a step at a time, more lines each, down to a readable 220 px: a gap between labels is found at most a
    // step's width short. Each is one layout.)
    const widths = [0];
    for (let w = natural * 0.85; w > 220 && widths.length < 7; w *= 0.85) widths.push(Math.round(w));
    if (natural > 220) widths.push(220);
    let fallback: { width: number; spot: Spot; cost: number } | null = null;
    for (const width of widths) {
      t.style.maxWidth = width ? `${width}px` : "";
      // (Its slide in starts `TOAST_SLIDE` px higher: clear of the labels there too, not only once it's in.)
      const w = t.offsetWidth;
      const h = t.offsetHeight + TOAST_SLIDE;
      const spot = clearSpot(labels, w, h, area);
      if (spot) {
        t.style.left = `${spot.x}px`;
        t.style.top = `${spot.top + TOAST_SLIDE}px`;
        return;
      }
      const least = leastCovered(labels, w, h, area);
      if (!fallback || least.cost < fallback.cost) fallback = { width, spot: least, cost: least.cost };
    }
    if (!fallback) return;
    t.style.maxWidth = fallback.width ? `${fallback.width}px` : "";
    t.style.left = `${fallback.spot.x}px`;
    t.style.top = `${fallback.spot.top + TOAST_SLIDE}px`;
  }

  /** The map's view has settled (its glide done): a toast up goes where it's clear of the labels where they are now. */
  mapSettled(): void {
    this.refitToast();
  }

  /** Is the screen point over the tray (dropping there cancels / deletes)? */
  isOverTray(x: number, y: number): boolean {
    const r = this.tray.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
}
