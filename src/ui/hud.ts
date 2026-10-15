import { installTooltips } from "./tooltip";
import type { GameMode } from "../game/modes";
import { note } from "../debug/report";
import { blockWord } from "./blocks";
import { pieceIcon, trainIcon, uiIcon } from "./icons";
import { roadIcon } from "./road-icons";
import { propGroups, trayKey, trayTabs, type LandTool, type TrayGroup, type TrayItem, type TrayTab } from "./tray-catalogue";

export { trayKey, type TrayItem } from "./tray-catalogue";

export interface HudHandlers {
  trayPointerDown(item: TrayItem, e: PointerEvent): void;
  /** A tray piece tapped (the ready one is put away). */
  trayTap(item: TrayItem): void;
  /** Another tray tab opened (the ready piece is put away). */
  trayTabChanged(): void;
  undo(): void;
  redo(): void;
  rerailAll(): void;
  togglePause(): void;
  lever(value: -1 | 0 | 1): void;
  follow(): void;
  removeTrain(): void;
  turnCar(): void;
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
  /** Game mode: open or close the blueprint board. */
  toggleBoard(): void;
  /** Add the plot chosen on the land card. */
  buyLand(): void;
  resetStarter(): void;
  /** Game mode: start the goals again on the starter map. */
  newGame(): void;
  /** Back to the title screen. */
  titleScreen(): void;
  toggleQuality(): void;
  closeCards(): void;
  /** Tray: turn the piece in hand and the ones taken out next (an eighth turn). */
  trayTurn(): void;
  /** Tray: mirror the piece in hand and the ones taken out next. */
  trayFlip(): void;
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

/** A celebration message shows at least this long (ms) before the next one replaces it. */
const TOAST_READ_MS = 1800;

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
  private readonly doneBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly selectMoreBtn: HTMLButtonElement;
  private readonly joinedBtn: HTMLButtonElement;
  private rotateBtn!: HTMLButtonElement;
  private readonly depotCard = el("div", "card depot-card");
  /** Below a depot card's switches: filled by the game for some depots (Game mode's workshop), else hidden. */
  readonly depotExtra = el("div", "depot-extra");
  /** Room on the engine card for Game mode's own rows (where the train delivers), filled by main. */
  readonly engineExtra = el("div", "engine-extra");
  /** While choosing land to add: what the chosen plot brings, and a button to add it. */
  private readonly landCard = el("div", "card land-card");
  private readonly landText = el("div", "land-text");
  private landBuyBtn!: HTMLButtonElement;
  private landBtn!: HTMLButtonElement;
  private soundItem!: HTMLButtonElement;
  private redoItem!: HTMLButtonElement;
  private landItem!: HTMLButtonElement;
  private readonly depotTitle = el("div", "card-title");
  private readonly depotStock = el("div", "depot-stock");
  private depotAutoBtn!: HTMLButtonElement;
  private depotWaitBtn!: HTMLButtonElement;
  private readonly flipBtn: HTMLButtonElement;
  private readonly leverBtns: HTMLButtonElement[] = [];
  private readonly followBtn: HTMLButtonElement;
  private readonly toastEl = el("div", "toast");
  private readonly menu = el("div", "menu");
  private readonly help = el("div", "help");
  private readonly modeTag = el("span", "mode-tag");
  /** Game mode's coins, by the logo. */
  private readonly coinTag = el("span", "coins");
  /** Menu items for each mode's maps. */
  private readonly reportItem = button("Send to Claude…", "Send what you see, your railway and a note to Claude, for debugging", () => {
    this.menu.hidden = true;
    this.openReport();
  }, "menu-item");
  private readonly reportCard = el("div", "card report-card");
  private readonly reportNote = document.createElement("textarea");
  private readonly sandboxItems: HTMLButtonElement[];
  private readonly gameItems: HTMLButtonElement[];
  readonly perf = el("div", "perf");
  private toastTimer = 0;
  private readonly toastQueue: { message: string; celebrate: boolean; ms: number }[] = [];
  /** Until when (performance.now) the message showing may not be replaced. */
  private toastHeldUntil = 0;
  private toastFlushTimer = 0;

  private readonly handlers: HudHandlers;
  private readonly mapBtn: HTMLButtonElement;
  private readonly boardBtn: HTMLButtonElement;
  /** Tray pictures by key: those drawn at start-up, and catalogue models' as they're drawn. */
  private readonly thumbs: Map<string, string>;
  private flipTrayBtn!: HTMLButtonElement;

  constructor(parent: HTMLElement, h: HudHandlers, qualityLabel: () => string, opts: HudOptions) {
    this.handlers = h;
    this.thumbs = new Map(opts.thumbnails ?? []);
    parent.appendChild(this.root);
    this.root.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") && !t.closest(".tray-item")) h.buttonTap();
    });

    const top = el("header", "topbar");
    const brand = el("div", "brand");
    brand.append(blockWord("W", "brand-block"), el("span", "brand-name", "Woodrail"));
    brand.appendChild(this.modeTag);
    this.coinTag.hidden = true;
    this.coinTag.title = "Coins: towns pay them for deliveries; they buy land";
    brand.appendChild(this.coinTag);
    top.appendChild(brand);
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
    this.boardBtn = button(uiIcon("blueprint"), "Blueprints: learn new things", h.toggleBoard);
    this.boardBtn.hidden = true;
    // On a phone the bar can't hold them all: these move into the menu (see `.narrow-menu`).
    for (const b of [this.landBtn, this.redoBtn, this.soundBtn]) b.classList.add("wide-only");
    actions.append(this.rerailBtn, this.boardBtn, this.mapBtn, this.landBtn, this.undoBtn, this.redoBtn, this.pauseBtn, this.soundBtn);
    actions.append(button(uiIcon("menu"), "Menu", () => this.toggleMenu()));
    top.appendChild(actions);
    this.root.appendChild(top);
    installTooltips(this.root);

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
    this.gameItems = [
      button("New game", "Start the goals again on the starter map", () => {
        this.menu.hidden = true;
        h.newGame();
      }, "menu-item"),
    ];
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
    this.menu.append(
      button("Title screen", "Save and go back to the title screen", () => {
        this.menu.hidden = true;
        h.titleScreen();
      }, "menu-item"),
      ...this.sandboxItems,
      ...this.gameItems,
      quality,
      button("How to play", "Show help", () => {
        this.menu.hidden = true;
        this.showHelp();
      }, "menu-item"),
      this.reportItem,
    );
    this.reportItem.hidden = true;
    this.buildReportCard();
    this.root.appendChild(this.menu);

    // Engine card
    this.engineCard.hidden = true;
    this.engineCard.appendChild(el("div", "card-title", "Engine"));
    const levers = el("div", "lever-row");
    for (const [v, label, title] of [
      [-1, "◀", "Reverse"],
      [0, "■", "Stop"],
      [1, "▶", "Forward"],
    ] as const) {
      const b = button(label, title, () => h.lever(v), "chip lever");
      b.dataset.value = String(v);
      this.leverBtns.push(b);
      levers.appendChild(b);
    }
    this.engineCard.appendChild(levers);
    const row = el("div", "card-row");
    this.followBtn = button("Follow", "Follow this train with the camera", h.follow, "chip text");
    row.append(this.followBtn, button("Turn", "Turn this engine around", h.turnCar, "chip text"), button("Remove", "Put this train back in the box", h.removeTrain, "chip text danger"));
    this.engineCard.appendChild(row);
    this.engineExtra.hidden = true;
    this.engineCard.appendChild(this.engineExtra);
    this.engineCard.appendChild(button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.engineCard);

    // Wagon card
    this.carCard.hidden = true;
    this.carCard.appendChild(el("div", "card-title", "Wagon"));
    const carRow = el("div", "card-row");
    carRow.append(button("Turn around", "Flip the wagon so its other magnet leads", h.turnCar, "chip text"), button("Remove", "Put this train back in the box", h.removeTrain, "chip text danger"));
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
    this.pieceCard.append(this.pieceTitle, this.groupHint, pieceRow, this.selectMoreBtn, this.groupRow, button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.pieceCard);

    // Depot card: what's on its piles, and how it treats trains.
    this.depotCard.hidden = true;
    this.depotAutoBtn = button("Automatic", "The crane loads and unloads trains by itself", h.depotAuto, "chip text");
    this.depotWaitBtn = button("Wait for a full load", "Trains wait under the crane until each wagon is full", h.depotWaitFull, "chip text");
    const depotRow = el("div", "card-row");
    depotRow.append(this.depotAutoBtn, this.depotWaitBtn);
    this.depotExtra.hidden = true;
    this.depotCard.append(this.depotTitle, this.depotStock, depotRow, this.depotExtra, button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.depotCard);

    // Land card: shown while choosing a plot to add.
    this.landCard.hidden = true;
    this.landBuyBtn = button("Add this land", "Add the chosen plot to your land", h.buyLand, "chip text attention");
    const landRow = el("div", "card-row");
    landRow.append(this.landBuyBtn, button("Done", "Stop adding land", h.toggleExpand, "chip text"));
    this.landCard.append(el("div", "card-title", "Add land"), this.landText, landRow);
    this.root.appendChild(this.landCard);

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
    const picture = (item: TrayItem) => {
      const key = trayKey(item);
      const thumb = this.thumbs.get(key);
      if (thumb) return `<img src="${thumb}" alt="" draggable="false">`;
      if (item.kind === "piece") return pieceIcon(item.type);
      if (item.kind === "tool") return uiIcon(item.tool);
      if (item.kind === "road") return roadIcon(item.auto ? "auto" : item.piece);
      if (item.kind === "train") return trainIcon(item.cars);
      missing.push(item);
      return `<span class="thumb-pending" data-thumb="${key}"></span>`;
    };
    const show = () => {
      requestAnimationFrame(edges);
      if (missing.length > 0) this.handlers.needThumbnails(missing.splice(0));
    };
    // Top level: one button per group; open one to see its items, with a way back first in the row.
    const showGroups = (groups: TrayGroup[]) => {
      this.trayGlide++;
      scroller.innerHTML = "";
      scroller.scrollLeft = 0;
      this.tray.classList.remove("in-group");
      for (const group of groups) {
        const b = el("button", "tray-item tray-group");
        b.innerHTML = `<span class="icon">${picture(group.items[0])}</span><span class="label">${group.label}</span><span class="count">${group.items.length}</span>`;
        b.title = `${group.label}: ${group.items.map((i) => i.label).join(", ")}`;
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.trayPress(e, scroller, { tap: () => showItems(groups, group) });
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
        b.addEventListener("click", () => showGroups(groups));
        scroller.appendChild(b);
      }
      this.trayButtons = [];
      for (const item of group.items) {
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
        } else if (item.kind === "piece") {
          // A piece is dragged out; once placed it stays ready (the next waits at the end it left: tap it to add it).
          // A tap on the ready one here puts it away.
          const key = trayKey(item);
          b.dataset.key = key;
          b.classList.toggle("armed", this.armedKey === key);
          b.title = `Drag onto the floor: ${item.label}`;
          b.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            this.trayPress(e, scroller, { pick: (move) => this.handlers.trayPointerDown(item, move), tap: () => this.handlers.trayTap(item) });
          });
        } else {
          b.title = `Drag onto the floor: ${item.label}`;
          b.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            this.trayPress(e, scroller, { pick: (move) => this.handlers.trayPointerDown(item, move) });
          });
        }
        scroller.appendChild(b);
      }
      show();
    };
    // The tabs for the mode; a tab with a single shelf opens straight onto its items.
    // A tab's catalogue shelves, once loaded (their code is fetched the first time the tab opens).
    const loadedGroups = new Map<string, TrayGroup[]>();
    let openId = "";
    const openTab = (tab: TrayTab, shelf?: string) => {
      if (openId !== "" && openId !== tab.id) this.handlers.trayTabChanged();
      openId = tab.id;
      // The Land tab switches land editing on (with its first tool), any other tab off.
      this.chooseLandTool(tab.land ? (this.landTool ?? "move") : null);
      tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", (x as HTMLElement).dataset.tab === tab.id));
      this.tray.classList.toggle("track-tab", !!tab.orient);
      this.tray.classList.toggle("turn-only", tab.orient === "turn");
      this.propsTab = tab.orient === "turn";
      let groups = tab.groups;
      if (tab.props) {
        const loaded = loadedGroups.get(tab.id);
        if (loaded) groups = [...tab.groups, ...loaded];
        else {
          void propGroups(tab.props).then((g) => {
            loadedGroups.set(tab.id, g);
            if (openId === tab.id) openTab(tab);
          });
          if (groups.length === 0) {
            this.trayGlide++;
            scroller.innerHTML = `<div class="tray-loading">Unpacking…</div>`;
            return;
          }
        }
      }
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
    this.showTabs = (mode) => {
      tabs.innerHTML = "";
      list = trayTabs(mode);
      for (const tab of list) {
        // Tapping a tab (even the open one) goes back to its groups.
        const t = button(tab.label, `${tab.label}`, () => openTab(tab), "tab");
        t.dataset.tab = tab.id;
        tabs.appendChild(t);
      }
      openTab(list[0]);
    };
    // Turn and flip, for track pieces: set how the next piece comes out, or turn the one in hand (with another finger).
    const orient = el("div", "tray-orient");
    this.flipTrayBtn = button("⇋ Flip", "Mirror the next piece (or the one you're holding)", () => this.handlers.trayFlip(), "chip text tray-flip");
    orient.append(
      button(`↻ Turn<span class="turn-arrow">↑</span>`, "Turn the next piece (or the one you're holding) an eighth of a turn", () => this.handlers.trayTurn(), "chip text"),
      this.flipTrayBtn,
    );
    this.tray.append(orient, tabs, scroller);
    this.root.appendChild(this.tray);

    this.root.appendChild(this.toastEl);

    this.help.hidden = true;
    this.help.innerHTML = `
      <div class="help-card">
        <h2>Welcome to Woodrail</h2>
        <div class="tips">
          <div class="tip"><span class="tip-art art-build"></span><b>Build</b><span>Drag track from the tray. Pegs click into holes when they're close.</span></div>
          <div class="tip"><span class="tip-art art-run"></span><b>Run</b><span>Drop a train on the track and tap the engine to set it going.</span></div>
          <div class="tip"><span class="tip-art art-look"></span><b>Look around</b><span>Drag to pan, pinch or scroll to zoom, double-tap to take a closer look.</span></div>
        </div>
        <details class="more-help">
          <summary>More help</summary>
          <ul>
            <li><b>Edit:</b> tap a piece to rotate, flip or delete it. Drag it to move it; drop it on the tray to put it away.</li>
            <li><b>Switches:</b> tap the yellow lever to change the points.</li>
            <li><b>Towns:</b> join two stations with track to connect their towns.</li>
            <li><b>Camera:</b> right-drag or two-finger twist to orbit.</li>
          </ul>
          <p class="help-keys">Keys: WASD or arrows pan · Q E turn · R F tilt (Shift: faster) · R rotate, F (or tap Cmd/Ctrl) flip what’s selected · Del delete · Ctrl+Z undo · Space pause · \` performance</p>
        </details>
      </div>`;
    // Illustrate the tips with the same rendered pictures as the tray.
    const art: [string, string | undefined][] = [
      [".art-build", opts.thumbnails?.get("piece:curve-large")],
      [".art-run", opts.thumbnails?.get("train:Full train")],
    ];
    for (const [sel, url] of art) {
      const node = this.help.querySelector<HTMLElement>(sel);
      if (node && url) node.style.backgroundImage = `url(${url})`;
    }
    const look = this.help.querySelector<HTMLElement>(".art-look");
    if (look) look.innerHTML = `<svg viewBox="0 0 48 48" width="44" height="44" fill="none" stroke="#6a4a2c" stroke-width="3" stroke-linecap="round"><circle cx="21" cy="21" r="11"/><path d="m29.5 29.5 9 9"/><path d="M21 16v10M16 21h10"/></svg>`;
    const ok = button("Let's play", "Close help", () => {
      this.help.hidden = true;
      try {
        localStorage.setItem("woodrail.helpSeen", "1");
      } catch {
        // storage unavailable: help shows again next visit
      }
    }, "chip text primary");
    this.help.querySelector(".help-card")!.appendChild(ok);
    this.root.appendChild(this.help);

    this.perf.hidden = true;
    this.root.appendChild(this.perf);
    this.setMode("sandbox");
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
    for (const node of this.tray.querySelectorAll<HTMLElement>(`[data-thumb="${CSS.escape(key)}"]`)) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.draggable = false;
      node.replaceWith(img);
    }
  }

  /** Show the help card if this player hasn't closed it before. */
  firstVisitHelp(): void {
    let seen = false;
    try {
      seen = localStorage.getItem("woodrail.helpSeen") === "1";
    } catch {
      seen = false;
    }
    if (!seen) this.showHelp();
  }

  /** Label the mode by the logo and offer its own map items in the menu. */
  /** Rebuild the tray's tabs for a mode (set in the constructor, where the tray is built). */
  private showTabs: (mode: GameMode) => void = () => {};
  private openTrayTab: (id: string, shelf?: string) => void = () => {};

  /**
   * What a tray item's corner says (Game mode's toy box: how many are left, or that it's locked), or null for nothing.
   * Set by the game; `refreshTrayBadges` applies it to the items showing.
   */
  trayBadge: ((item: TrayItem) => { text: string; empty: boolean } | null) | null = null;
  private trayButtons: [HTMLElement, TrayItem][] = [];

  refreshTrayBadges(): void {
    for (const [b, item] of this.trayButtons) this.decorate(b, item);
  }

  private decorate(b: HTMLElement, item: TrayItem): void {
    const badge = this.trayBadge?.(item) ?? null;
    let tag = b.querySelector<HTMLElement>(".have");
    if (!badge) {
      tag?.remove();
      b.classList.remove("empty");
      return;
    }
    if (!tag) b.appendChild((tag = el("span", "have")));
    if (tag.textContent !== badge.text) tag.textContent = badge.text;
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
    this.mapBtn.hidden = mode !== "game";
    this.boardBtn.hidden = mode !== "game";
  }

  /** Show the coins (null: hide them, outside Game mode). A rise pops the count. */
  setCoins(n: number | null): void {
    this.coinTag.hidden = n === null;
    if (n === null) return;
    const text = String(n);
    const was = Number(this.coinTag.dataset.n ?? n);
    if (this.coinTag.dataset.n === text) return;
    this.coinTag.dataset.n = text;
    this.coinTag.innerHTML = `<i></i>${text}`;
    if (n > was) {
      this.coinTag.classList.remove("pop");
      void this.coinTag.offsetWidth;
      this.coinTag.classList.add("pop");
    }
  }

  /** The blueprint board's button: lit while open, a pulsing dot while a town's choice waits. */
  setBoardButton(open: boolean, alert: boolean): void {
    this.boardBtn.classList.toggle("active", open);
    this.boardBtn.classList.toggle("icon-btn-alert", alert);
  }

  /** The map view is open: its button lit, the goals and tray put away. */
  setMapOpen(open: boolean): void {
    this.mapBtn.classList.toggle("active", open);
    this.root.classList.toggle("map-open", open);
  }

  /** Hide or show the whole play overlay (the title screen covers the game). */
  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (!visible) this.menu.hidden = true;
  }

  showHelp(): void {
    this.help.hidden = false;
  }

  toggleMenu(): void {
    this.menu.hidden = !this.menu.hidden;
  }

  setHistory(canUndo: boolean, canRedo: boolean): void {
    this.undoBtn.disabled = !canUndo;
    this.redoBtn.disabled = !canRedo;
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
    this.root.classList.add("card-open");
    this.updateEngineCard(lever, following);
  }

  updateEngineCard(lever: number, following: boolean): void {
    for (const b of this.leverBtns) b.classList.toggle("active", Number(b.dataset.value) === lever);
    this.followBtn.classList.toggle("active", following);
    this.followBtn.textContent = following ? "Following" : "Follow";
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
    this.pieceCard.classList.remove("group");
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
  private trayPress(down: PointerEvent, scroller: HTMLElement, on: { pick?: (move: PointerEvent) => void; tap?: () => void }): void {
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
      if (mode === "undecided" && e.type === "pointerup") on.tap?.();
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
    this.depotCard.hidden = false;
    this.root.classList.add("card-open");
  }

  /**
   * Refresh the open depot card: one line per pile ("Logs ●●●○○…  5"), and the two switches. `waitFull` is null
   * where it doesn't apply (a depot that gives nothing).
   */
  updateDepotCard(piles: { label: string; count: number; cap: number }[], auto: boolean, waitFull: boolean | null, note = ""): void {
    const text = piles.map((p) => `${p.label} ${p.count}/${p.cap}`).join("   ·   ") + (note ? `   ·   ${note}` : "");
    if (this.depotStock.textContent !== text) this.depotStock.textContent = text;
    this.depotAutoBtn.classList.toggle("active", auto);
    this.depotWaitBtn.hidden = waitFull === null;
    this.depotWaitBtn.classList.toggle("active", !!waitFull);
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

  get depotCardOpen(): boolean {
    return !this.depotCard.hidden;
  }

  hideCards(): void {
    this.root.classList.remove("card-open");
    this.depotCard.hidden = true;
    this.engineCard.hidden = true;
    this.carCard.hidden = true;
    this.pieceCard.hidden = true;
    this.pieceCard.classList.remove("group");
    this.root.classList.remove("picking");
  }

  /** The tray piece readied for placing with taps (`trayKey`), or null. */
  private armedKey: string | null = null;

  setArmed(key: string | null): void {
    if (key === this.armedKey) return;
    this.armedKey = key;
    this.tray.querySelectorAll<HTMLElement>(".tray-item[data-key]").forEach((b) => b.classList.toggle("armed", b.dataset.key === key));
  }

  /**
   * Show a message. A celebration stays up long enough to read: messages that come while it's fresh wait their turn
   * (several things often happen at once: a connection, a goal done, a hint). A plain message gives way at once.
   */
  toast(message: string, celebrate = false, ms = 2200): void {
    note("toast", message);
    this.toastQueue.push({ message, celebrate, ms });
    this.flushToasts();
  }

  private flushToasts(): void {
    clearTimeout(this.toastFlushTimer);
    const wait = this.toastHeldUntil - performance.now();
    if (wait > 0) {
      this.toastFlushTimer = window.setTimeout(() => this.flushToasts(), wait);
      return;
    }
    const next = this.toastQueue.shift();
    if (!next) return;
    this.showToast(next.message, next.celebrate, next.ms);
    this.toastHeldUntil = next.celebrate ? performance.now() + Math.min(next.ms, TOAST_READ_MS) : 0;
    if (this.toastQueue.length > 0) this.flushToasts();
  }

  private showToast(message: string, celebrate: boolean, ms: number): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle("celebrate", celebrate);
    this.toastEl.classList.remove("show");
    this.clearOfPanels();
    // Restart the slide-in even when a toast is already showing.
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  /**
   * Keep a toast clear of what's pinned under the top bar (the goals; the picking card): below it if they'd overlap
   * (on a phone they always do), else where it goes. Measured when a toast shows, not per frame.
   */
  private clearOfPanels(): void {
    const t = this.toastEl;
    t.style.top = "";
    const r = t.getBoundingClientRect();
    let below = 0;
    for (const p of this.root.querySelectorAll<HTMLElement>(".goals, .piece-card.group")) {
      if (p.hidden || p.offsetParent === null) continue;
      const q = p.getBoundingClientRect();
      if (q.width === 0 || q.right < r.left || q.left > r.right || q.bottom < r.top) continue;
      below = Math.max(below, q.bottom);
    }
    if (below > 0) t.style.top = `${Math.round(below + 22)}px`;
  }

  /** Is the screen point over the tray (dropping there cancels / deletes)? */
  isOverTray(x: number, y: number): boolean {
    const r = this.tray.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
}
