import type { CarKind } from "../sim";
import type { PieceTypeId } from "../track";
import { pieceIcon, trainIcon, uiIcon } from "./icons";

export type TrayItem = { kind: "piece"; type: PieceTypeId; label: string } | { kind: "train"; cars: CarKind[]; label: string };

export const TRACK_ITEMS: TrayItem[] = [
  { kind: "piece", type: "straight-216", label: "Long" },
  { kind: "piece", type: "straight-144", label: "Medium" },
  { kind: "piece", type: "straight-108", label: "Short" },
  { kind: "piece", type: "straight-54", label: "Mini" },
  { kind: "piece", type: "straight-36", label: "Tiny" },
  { kind: "piece", type: "straight-288", label: "Extra long" },
  { kind: "piece", type: "curve-large", label: "Curve" },
  { kind: "piece", type: "curve-small", label: "Tight curve" },
  { kind: "piece", type: "curve-wide", label: "Wide curve" },
  { kind: "piece", type: "s-curve", label: "S-curve" },
  { kind: "piece", type: "s-curve-short", label: "Short S" },
  { kind: "piece", type: "switch", label: "Switch" },
  { kind: "piece", type: "switch-y", label: "Y switch" },
  { kind: "piece", type: "switch-3way", label: "Three-way" },
  { kind: "piece", type: "crossing", label: "Crossing" },
  { kind: "piece", type: "crossing-45", label: "45° crossing" },
  { kind: "piece", type: "ramp", label: "Ramp" },
  { kind: "piece", type: "bridge", label: "Bridge" },
  { kind: "piece", type: "bridge-curve", label: "Curved bridge" },
  { kind: "piece", type: "riser", label: "Riser" },
  { kind: "piece", type: "buffer", label: "Buffer" },
  { kind: "piece", type: "buffer-turnback", label: "Turnback" },
  { kind: "piece", type: "adapter-peg", label: "Peg–peg" },
  { kind: "piece", type: "adapter-socket", label: "Hole–hole" },
];

export const TRAIN_ITEMS: TrayItem[] = [
  { kind: "train", cars: ["engine", "hopper", "passenger", "caboose"], label: "Full train" },
  { kind: "train", cars: ["engine", "timber", "timber", "timber"], label: "Timber train" },
  { kind: "train", cars: ["engine"], label: "Engine" },
  { kind: "train", cars: ["hopper"], label: "Coal wagon" },
  { kind: "train", cars: ["timber"], label: "Timber wagon" },
  { kind: "train", cars: ["passenger"], label: "Coach" },
  { kind: "train", cars: ["caboose"], label: "Caboose" },
];

/** A shelf of the tray: a few related items behind one button. */
export interface TrayGroup {
  label: string;
  items: TrayItem[];
}

const pieces = (...types: PieceTypeId[]) => types.map((t) => TRACK_ITEMS.find((i) => i.kind === "piece" && i.type === t)!);

export const TRACK_GROUPS: TrayGroup[] = [
  { label: "Straight", items: pieces("straight-288", "straight-216", "straight-144", "straight-108", "straight-54", "straight-36") },
  { label: "Curve", items: pieces("curve-large", "curve-small", "curve-wide", "s-curve", "s-curve-short") },
  { label: "Switch", items: pieces("switch", "switch-y", "switch-3way", "crossing", "crossing-45") },
  { label: "Ups & downs", items: pieces("ramp", "riser", "bridge", "bridge-curve") },
  { label: "Ends", items: pieces("buffer", "buffer-turnback") },
  { label: "Adapters", items: pieces("adapter-peg", "adapter-socket") },
];

export const TRAIN_GROUPS: TrayGroup[] = [
  { label: "Trains", items: TRAIN_ITEMS.slice(0, 2) },
  { label: "Engine & wagons", items: TRAIN_ITEMS.slice(2) },
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

/** Tray thumbnail key for an item. */
export function trayKey(item: TrayItem): string {
  return item.kind === "piece" ? `piece:${item.type}` : `train:${item.label}`;
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
  private readonly rerailBtn: HTMLButtonElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly engineCard = el("div", "card engine-card");
  private readonly carCard = el("div", "card car-card");
  private readonly pieceCard = el("div", "card piece-card");
  private readonly depotCard = el("div", "card depot-card");
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
  readonly perf = el("div", "perf");
  private toastTimer = 0;

  private readonly handlers: HudHandlers;
  private flipTrayBtn!: HTMLButtonElement;

  constructor(parent: HTMLElement, h: HudHandlers, qualityLabel: () => string, opts: HudOptions) {
    this.handlers = h;
    parent.appendChild(this.root);
    this.root.addEventListener("pointerdown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("button") && !t.closest(".tray-item")) h.buttonTap();
    });

    const top = el("header", "topbar");
    top.appendChild(el("div", "brand", `<span class="brand-mark"></span><span class="brand-name">Woodrail</span>`));
    const actions = el("div", "actions");
    this.undoBtn = button(uiIcon("undo"), "Undo (Ctrl+Z)", h.undo);
    this.redoBtn = button(uiIcon("redo"), "Redo (Ctrl+Shift+Z)", h.redo);
    this.pauseBtn = button(uiIcon("pause"), "Pause (Space)", h.togglePause);
    this.rerailBtn = button("Re-rail", "Put derailed trains back on the track", h.rerailAll, "chip text attention");
    this.rerailBtn.hidden = true;
    this.soundBtn = button(uiIcon(opts.muted ? "mute" : "sound"), opts.muted ? "Sound on" : "Sound off", h.toggleSound);
    actions.append(this.rerailBtn, this.undoBtn, this.redoBtn, this.pauseBtn, this.soundBtn);
    actions.append(button(uiIcon("menu"), "Menu", () => this.toggleMenu()));
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

    // Depot card: what's on its piles, and how it treats trains.
    this.depotCard.hidden = true;
    this.depotAutoBtn = button("Automatic", "The crane loads and unloads trains by itself", h.depotAuto, "chip text");
    this.depotWaitBtn = button("Wait for a full load", "Trains wait under the crane until each wagon is full", h.depotWaitFull, "chip text");
    const depotRow = el("div", "card-row");
    depotRow.append(this.depotAutoBtn, this.depotWaitBtn);
    this.depotCard.append(this.depotTitle, this.depotStock, depotRow, button("✕", "Close", h.closeCards, "close"));
    this.root.appendChild(this.depotCard);

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
    const picture = (item: TrayItem) => {
      const thumb = opts.thumbnails?.get(trayKey(item));
      return thumb ? `<img src="${thumb}" alt="" draggable="false">` : item.kind === "piece" ? pieceIcon(item.type) : trainIcon(item.cars);
    };
    const show = () => requestAnimationFrame(edges);
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
    const showItems = (groups: TrayGroup[], group: TrayGroup) => {
      this.trayGlide++;
      scroller.innerHTML = "";
      scroller.scrollLeft = 0;
      this.tray.classList.add("in-group");
      const back = el("button", "tray-item tray-back");
      back.innerHTML = `<span class="icon">‹</span><span class="label">Back</span>`;
      back.title = "Back to all kinds";
      back.addEventListener("click", () => showGroups(groups));
      scroller.appendChild(back);
      for (const item of group.items) {
        const b = el("button", "tray-item");
        b.innerHTML = `<span class="icon">${picture(item)}</span><span class="label">${item.label}</span>`;
        b.title = `Drag onto the floor: ${item.label}`;
        b.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          this.trayPress(e, scroller, { pick: (move) => this.handlers.trayPointerDown(item, move) });
        });
        scroller.appendChild(b);
      }
      show();
    };
    for (const [name, groups] of [
      ["Track", TRACK_GROUPS],
      ["Trains", TRAIN_GROUPS],
    ] as const) {
      const t = button(name, `${name} pieces`, () => {
        tabs.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === t));
        this.tray.classList.toggle("track-tab", groups === TRACK_GROUPS);
        // Tapping a tab (even the open one) goes back to its groups.
        showGroups(groups);
      }, "tab");
      tabs.appendChild(t);
    }
    (tabs.firstChild as HTMLButtonElement).classList.add("active");
    this.tray.classList.add("track-tab");
    showGroups(TRACK_GROUPS);
    // Turn and flip, for track pieces: set how the next piece comes out, or turn the one in hand (with another finger).
    const orient = el("div", "tray-orient");
    this.flipTrayBtn = button("⇋ Flip", "Mirror the next piece (or the one you're holding)", () => this.handlers.trayFlip(), "chip text");
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
          <p class="help-keys">Keys: WASD or arrows pan (Shift: faster) · R rotate · F flip · Del delete · Ctrl+Z undo · Space pause · \` performance</p>
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
    this.pauseBtn.innerHTML = uiIcon(paused ? "play" : "pause");
    this.pauseBtn.title = paused ? "Resume (Space)" : "Pause (Space)";
    this.pauseBtn.setAttribute("aria-label", this.pauseBtn.title);
    this.pauseBtn.classList.toggle("active", paused);
  }

  setMuted(muted: boolean): void {
    this.soundBtn.innerHTML = uiIcon(muted ? "mute" : "sound");
    this.soundBtn.title = muted ? "Sound on" : "Sound off";
    this.soundBtn.setAttribute("aria-label", this.soundBtn.title);
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

  showPieceCard(flippable: boolean): void {
    this.hideCards();
    this.pieceCard.hidden = false;
    this.root.classList.add("card-open");
    this.flipBtn.disabled = !flippable;
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
  setTrayOrientation(turns: number, flipped: boolean): void {
    this.tray.style.setProperty("--tray-turn", `${turns * 45}deg`);
    this.flipTrayBtn.classList.toggle("active", flipped);
  }

  showDepotCard(title: string): void {
    this.hideCards();
    this.depotTitle.textContent = title;
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

  get depotCardOpen(): boolean {
    return !this.depotCard.hidden;
  }

  hideCards(): void {
    this.root.classList.remove("card-open");
    this.depotCard.hidden = true;
    this.engineCard.hidden = true;
    this.carCard.hidden = true;
    this.pieceCard.hidden = true;
  }

  toast(message: string, celebrate = false, ms = 2200): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.toggle("celebrate", celebrate);
    this.toastEl.classList.remove("show");
    // Restart the slide-in even when a toast is already showing.
    void this.toastEl.offsetWidth;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  /** Is the screen point over the tray (dropping there cancels / deletes)? */
  isOverTray(x: number, y: number): boolean {
    const r = this.tray.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }
}
