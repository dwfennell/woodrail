import type { CarKind } from "../sim";
import type { PieceTypeId } from "../track";
import { pieceIcon, trainIcon } from "./icons";

export type TrayItem = { kind: "piece"; type: PieceTypeId; label: string } | { kind: "train"; cars: CarKind[]; label: string };

export const TRACK_ITEMS: TrayItem[] = [
  { kind: "piece", type: "straight-216", label: "Long" },
  { kind: "piece", type: "straight-144", label: "Medium" },
  { kind: "piece", type: "straight-108", label: "Short" },
  { kind: "piece", type: "straight-54", label: "Mini" },
  { kind: "piece", type: "curve-large", label: "Curve" },
  { kind: "piece", type: "curve-small", label: "Tight curve" },
  { kind: "piece", type: "switch", label: "Switch" },
  { kind: "piece", type: "crossing", label: "Crossing" },
  { kind: "piece", type: "ramp", label: "Ramp" },
  { kind: "piece", type: "bridge", label: "Bridge" },
  { kind: "piece", type: "riser", label: "Riser" },
  { kind: "piece", type: "buffer", label: "Buffer" },
  { kind: "piece", type: "adapter-peg", label: "Peg–peg" },
  { kind: "piece", type: "adapter-socket", label: "Hole–hole" },
];

export const TRAIN_ITEMS: TrayItem[] = [
  { kind: "train", cars: ["engine", "hopper", "passenger", "caboose"], label: "Full train" },
  { kind: "train", cars: ["engine"], label: "Engine" },
  { kind: "train", cars: ["hopper"], label: "Coal wagon" },
  { kind: "train", cars: ["passenger"], label: "Coach" },
  { kind: "train", cars: ["caboose"], label: "Caboose" },
];

export interface HudHandlers {
  trayPointerDown(item: TrayItem, e: PointerEvent): void;
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
  newLayout(): void;
  resetStarter(): void;
  toggleQuality(): void;
  closeCards(): void;
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

/** The HTML overlay: top bar, piece tray, context cards, menu, help, toasts and perf readout. */
export class Hud {
  readonly root = el("div", "hud");
  readonly tray = el("div", "tray");
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly engineCard = el("div", "card engine-card");
  private readonly carCard = el("div", "card car-card");
  private readonly pieceCard = el("div", "card piece-card");
  private readonly flipBtn: HTMLButtonElement;
  private readonly leverBtns: HTMLButtonElement[] = [];
  private readonly followBtn: HTMLButtonElement;
  private readonly toastEl = el("div", "toast");
  private readonly menu = el("div", "menu");
  private readonly help = el("div", "help");
  readonly perf = el("div", "perf");
  private toastTimer = 0;

  constructor(parent: HTMLElement, h: HudHandlers, qualityLabel: () => string) {
    parent.appendChild(this.root);

    const top = el("header", "topbar");
    top.appendChild(el("div", "brand", `<span class="brand-mark"></span>Woodrail`));
    const actions = el("div", "actions");
    this.undoBtn = button("↶", "Undo (Ctrl+Z)", h.undo);
    this.redoBtn = button("↷", "Redo (Ctrl+Shift+Z)", h.redo);
    this.pauseBtn = button("❚❚", "Pause (Space)", h.togglePause);
    actions.append(this.undoBtn, this.redoBtn, button("Re-rail", "Put derailed trains back on the track", h.rerailAll, "chip text"), this.pauseBtn);
    actions.append(button("☰", "Menu", () => this.toggleMenu()));
    top.appendChild(actions);
    this.root.appendChild(top);

    // Menu
    this.menu.hidden = true;
    const quality = button(`Graphics: ${qualityLabel()}`, "Switch graphics quality (reloads)", () => h.toggleQuality(), "menu-item");
    this.menu.append(
      button("Starter map", "Back to the starter map", () => {
        this.menu.hidden = true;
        h.resetStarter();
      }, "menu-item"),
      button("New map", "Generate a new landscape of towns, hills and rivers", () => {
        this.menu.hidden = true;
        h.newLayout();
      }, "menu-item"),
      quality,
      button("How to play", "Show help", () => {
        this.menu.hidden = true;
        this.showHelp();
      }, "menu-item"),
    );
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
    const pieceRow = el("div", "card-row");
    pieceRow.append(button("Rotate", "Rotate 45° (R)", h.rotate, "chip text"), this.flipBtn, button("Delete", "Remove this piece (Del)", h.deletePiece, "chip text danger"));
    this.pieceCard.append(el("div", "card-title", "Track piece"), pieceRow, button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.pieceCard);

    // Tray with tabs
    const tabs = el("div", "tabs");
    const scroller = el("div", "scroller");
    const fill = (items: TrayItem[]) => {
      scroller.innerHTML = "";
      for (const item of items) {
        const b = el("button", "tray-item");
        b.innerHTML = `<span class="icon">${item.kind === "piece" ? pieceIcon(item.type) : trainIcon(item.cars)}</span><span class="label">${item.label}</span>`;
        b.title = `Drag onto the floor: ${item.label}`;
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          h.trayPointerDown(item, e);
        });
        scroller.appendChild(b);
      }
    };
    for (const [name, items] of [
      ["Track", TRACK_ITEMS],
      ["Trains", TRAIN_ITEMS],
    ] as const) {
      const t = button(name, `${name} pieces`, () => {
        tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === t));
        fill(items);
      }, "tab");
      tabs.appendChild(t);
    }
    (tabs.firstChild as HTMLButtonElement).classList.add("active");
    fill(TRACK_ITEMS);
    this.tray.append(tabs, scroller);
    this.root.appendChild(this.tray);

    this.root.appendChild(this.toastEl);

    this.help.hidden = true;
    this.help.innerHTML = `
      <div class="help-card">
        <h2>Welcome to Woodrail</h2>
        <ul>
          <li><b>Build:</b> drag pieces from the tray. Pegs snap into holes when they're close.</li>
          <li><b>Edit:</b> tap a piece to rotate, flip or delete it. Drag it to move it.</li>
          <li><b>Trains:</b> drag a train onto the track, then tap the engine to start it.</li>
          <li><b>Switches:</b> tap the yellow lever to change the points.</li>
          <li><b>Camera:</b> drag the floor to pan. Pinch or scroll to zoom. Right-drag or two-finger twist to orbit.</li>
        </ul>
        <p class="help-keys">Keys: R rotate · F flip · Del delete · Ctrl+Z undo · Space pause · \` performance</p>
      </div>`;
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

    let seen = false;
    try {
      seen = localStorage.getItem("woodrail.helpSeen") === "1";
    } catch {
      seen = false;
    }
    if (!seen) this.showHelp();
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
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? "▶" : "❚❚";
    this.pauseBtn.title = paused ? "Resume (Space)" : "Pause (Space)";
  }

  showEngineCard(lever: number, following: boolean): void {
    this.hideCards();
    this.engineCard.hidden = false;
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
  }

  showPieceCard(flippable: boolean): void {
    this.hideCards();
    this.pieceCard.hidden = false;
    this.flipBtn.disabled = !flippable;
  }

  hideCards(): void {
    this.engineCard.hidden = true;
    this.carCard.hidden = true;
    this.pieceCard.hidden = true;
  }

  toast(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 2200);
  }

  /** Is the screen point over the tray (dropping there cancels / deletes)? */
  isOverTray(x: number, y: number): boolean {
    const r = this.tray.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
}
