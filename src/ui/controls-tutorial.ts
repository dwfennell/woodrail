/**
 * The first-run camera tutorial: move, zoom, turn and tilt the view, each ticked off when the player does it, with a
 * small moving picture of how (the set for a mouse and keys, or for fingers: by the input last used, not the screen's
 * size). "Skip tutorial" is always there. Shown once a device (see `hud.firstVisitHelp`); "Show controls" in the menu
 * brings it back. It leads into the goals (Game) or the tray (Sandbox): `onDone`.
 *
 * Cost: nothing per frame. The game says when the camera moved (`cameraMoved`, only on a frame it did); the page is
 * touched only when a step is done or the input kind changes.
 */

export type CameraStep = "move" | "zoom" | "turn" | "tilt";

/**
 * A camera change this long after the player's last pointer, wheel or key is theirs (a glide or Show me starting later
 * isn't). Generous for a slow phone, whose frames, and the moves they draw, come a while after the touch (QA).
 */
const OWN_INPUT_MS = 1200;
export const CAMERA_STEPS: readonly CameraStep[] = ["move", "zoom", "turn", "tilt"];

/** The view as the tutorial reads it: where it looks (ground), how far, and from which way (radians). */
export interface ViewState {
  tx: number;
  tz: number;
  distance: number;
  azimuth: number;
  polar: number;
}

/** How much of each a step takes, summed over the player's own moves (radians; zoom in log of the distance). */
export const STEP_NEEDS: Record<CameraStep, number> = {
  // A third of the view's distance across the ground (QA: at a half, a light drag on a slow phone took 3-5 tries).
  move: 0.3,
  // About 1.35× in or out.
  zoom: 0.3,
  // About 30°.
  turn: 0.5,
  // About 8°.
  tilt: 0.14,
};

/**
 * One camera change, from `a` to `b`: how much of each step it was. A pan is a change that mostly moves where the view
 * looks (zooming toward the pointer moves it too, and a two-finger twist about the fingers: those aren't a pan; panning
 * over hills, the view's height follows the ground a little: that is).
 */
export function stepAmounts(a: ViewState, b: ViewState): Record<CameraStep, number> {
  const zoom = Math.abs(Math.log(b.distance / a.distance));
  let turn = Math.abs(b.azimuth - a.azimuth);
  if (turn > Math.PI) turn = 2 * Math.PI - turn;
  const tilt = Math.abs(b.polar - a.polar);
  const across = Math.hypot(b.tx - a.tx, b.tz - a.tz) / a.distance;
  const pan = across > 2 * Math.max(zoom, turn, tilt);
  return { move: pan ? across : 0, zoom, turn, tilt };
}

/** Steps done so far, from the player's camera changes (`feed`): the newly done ones. */
export class CameraSteps {
  readonly done = new Set<CameraStep>();
  private readonly sum: Record<CameraStep, number> = { move: 0, zoom: 0, turn: 0, tilt: 0 };

  feed(a: ViewState, b: ViewState): CameraStep[] {
    const d = stepAmounts(a, b);
    const now: CameraStep[] = [];
    for (const s of CAMERA_STEPS) {
      if (this.done.has(s)) continue;
      this.sum[s] += d[s];
      if (this.sum[s] >= STEP_NEEDS[s]) {
        this.done.add(s);
        now.push(s);
      }
    }
    return now;
  }

  /** The first step not done yet, or null when all are. */
  next(): CameraStep | null {
    return CAMERA_STEPS.find((s) => !this.done.has(s)) ?? null;
  }
}

export type InputKind = "mouse" | "touch";

/** What each step says, for a mouse and keys or for fingers (the game's real bindings: see Interaction, TouchCamera, Game's PAN_KEYS). */
export const STEP_TEXT: Record<CameraStep, { title: string; mouse: string; touch: string }> = {
  move: { title: "Move around", mouse: "Drag the map, or use W A S D or the arrow keys", touch: "Drag the map with one finger" },
  zoom: { title: "Zoom", mouse: "Scroll the mouse wheel, or pinch the trackpad", touch: "Pinch with two fingers" },
  turn: { title: "Turn", mouse: "Drag with the right mouse button, or press Q or E", touch: "Twist two fingers round each other" },
  tilt: { title: "Tilt", mouse: "Right-drag up or down, or press R or F", touch: "Drag two fingers up or down together" },
};

/** The moving picture for a step (CSS-animated: nothing runs in script). */
function hintArt(step: CameraStep, input: InputKind): string {
  if (input === "touch") {
    const dots = step === "move" ? `<i class="f f1"></i>` : `<i class="f f1"></i><i class="f f2"></i>`;
    return `<span class="coach-art touch ${step}" aria-hidden="true">${dots}</span>`;
  }
  const keys: Record<CameraStep, string[]> = { move: ["W", "A", "S", "D"], zoom: [], turn: ["Q", "E"], tilt: ["R", "F"] };
  const caps = keys[step].map((k, i) => `<kbd style="--i:${i}">${k}</kbd>`).join("");
  return `<span class="coach-art mouse ${step}" aria-hidden="true"><span class="m"><i class="w"></i></span>${caps ? `<span class="caps">${caps}</span>` : ""}</span>`;
}

const SEEN_KEY = "woodrail.controlsSeen";

export class ControlsTutorial {
  readonly root = document.createElement("div");
  private steps = new CameraSteps();
  private input: InputKind;
  private last: ViewState | null = null;
  /** When the player last used the pointer, wheel or keys: camera changes long after aren't theirs (a glide, Show me). */
  private inputAt = -Infinity;
  /** When the last camera change that was the player's came (see `cameraMoved`), or null. */
  private ownAt: number | null = null;
  /** Camera keys held down (a key held pans or turns the whole time, sending its keydown only once, or slowly). */
  private readonly keys = new Set<string>();
  private finished = false;
  private readonly listeners: [string, EventListener, AddEventListenerOptions][] = [];

  /** Done or skipped (`skipped`): what comes next is shown (the goals, or the tray). */
  onDone: ((skipped: boolean) => void) | null = null;
  /** The last card's "More help": the help card. */
  onMoreHelp: (() => void) | null = null;
  /** Shown (or a step's card changed): to place it (see the HUD). */
  onShow: (() => void) | null = null;

  constructor(
    private readonly view: () => ViewState,
    /** What comes next, said on the last card (`touch`: for fingers). */
    private readonly ending: (touch: boolean) => string,
    /** Is the camera gliding on its own (Show me, a framing): not the player's doing. */
    private readonly gliding: () => boolean = () => false,
  ) {
    this.root.className = "coach";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Camera controls");
    this.root.tabIndex = -1;
    this.input = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
    // (The wheel from the start, ahead of Interaction's wheel zoom, which stops the event for anything after it. It only
    // notes the time, and only while shown.)
    window.addEventListener(
      "wheel",
      (e) => {
        if (this.shown) this.used(e);
      },
      { capture: true, passive: true },
    );
  }

  /** The player used the pointer, wheel or keys (not over the coach or the HUD's controls, which aren't the camera). */
  private used(e: Event): void {
    const t = e.target as Element | null;
    if (t && t.closest?.(".coach, button, .tray, .card, .menu")) return;
    this.inputAt = performance.now();
  }

  get shown(): boolean {
    return !this.root.hidden;
  }

  /** Has this device seen it (done or skipped)? */
  static seen(): boolean {
    try {
      return localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  start(): void {
    this.steps = new CameraSteps();
    this.finished = false;
    this.last = this.view();
    this.root.hidden = false;
    this.listen();
    this.render();
    this.onShow?.();
    // (A dialog: focus goes into it, so Esc and a screen reader start there. Not scrolled to: it's fixed in view.)
    this.root.focus({ preventScroll: true });
  }

  /** The camera moved (a frame drew it somewhere new): the player's own change counts toward the steps. */
  cameraMoved(): void {
    if (!this.shown || this.finished) return;
    const now = this.view();
    const prev = this.last;
    this.last = now;
    // The player's: while they use the pointer, wheel or keys (and OWN_INPUT_MS on), or as a move of theirs eases to a stop
    // (a key let go turns on a little, a fling glides): a change following one of theirs within 1.5 s, the camera not
    // gliding on its own (Show me). On a slow phone those tails come a frame or two at a time, long after the keys.
    const t = performance.now();
    const own = this.keys.size > 0 || t - this.inputAt <= OWN_INPUT_MS || (this.ownAt !== null && t - this.ownAt < 1500 && !this.gliding());
    this.ownAt = own ? t : null;
    if (!prev || !own) return;
    if (this.steps.feed(prev, now).length === 0) return;
    this.render();
    if (this.steps.next() === null) this.finish();
  }

  /** Close it (done, or skipped), and remember this device has seen it. */
  close(skipped: boolean): void {
    if (!this.shown) return;
    this.root.hidden = true;
    this.unlisten();
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // storage unavailable: it shows again next visit
    }
    this.onDone?.(skipped);
  }

  private finish(): void {
    this.finished = true;
    this.render();
  }

  private listen(): void {
    this.unlisten();
    const on = (type: string, fn: EventListener) => {
      const opts = { capture: true, passive: true };
      window.addEventListener(type, fn, opts);
      this.listeners.push([type, fn, opts]);
    };
    const used = (e: Event) => this.used(e);
    on("pointerdown", (e) => {
      const kind: InputKind = (e as PointerEvent).pointerType === "touch" ? "touch" : "mouse";
      if (kind !== this.input) {
        this.input = kind;
        this.render();
      }
      used(e);
    });
    on("pointermove", (e) => {
      if ((e as PointerEvent).buttons !== 0) used(e);
    });
    on("keydown", (e) => {
      const k = (e as KeyboardEvent).key.toLowerCase();
      // Esc closes it (skipped), as it closes the game's other cards.
      if (k === "escape") {
        this.close(true);
        return;
      }
      if (!/^(w|a|s|d|q|e|r|f|arrow(up|down|left|right))$/.test(k)) return;
      if (this.input !== "mouse") {
        this.input = "mouse";
        this.render();
      }
      this.keys.add(k);
      this.inputAt = performance.now();
    });
    on("keyup", (e) => {
      if (this.keys.delete((e as KeyboardEvent).key.toLowerCase())) this.inputAt = performance.now();
    });
    on("blur", () => this.keys.clear());
  }

  private unlisten(): void {
    this.keys.clear();
    for (const [type, fn, opts] of this.listeners) window.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
  }

  private render(): void {
    const step = this.steps.next();
    const dots = CAMERA_STEPS.map((s) => `<i class="dot${this.steps.done.has(s) ? " done" : ""}${s === step ? " now" : ""}" title="${STEP_TEXT[s].title}"></i>`).join("");
    if (this.finished || step === null) {
      this.root.innerHTML = `
        <div class="coach-row"><span class="coach-art done" aria-hidden="true">✓</span>
          <div class="coach-text"><b>That's the camera!</b><span>${this.ending(this.input === "touch")}</span></div></div>
        <div class="coach-foot"><span class="coach-dots">${dots}</span><button class="chip text coach-more">More help</button><button class="chip text primary coach-go">Let's play</button></div>`;
      this.root.querySelector(".coach-go")!.addEventListener("click", () => this.close(false));
      this.root.querySelector(".coach-more")!.addEventListener("click", () => {
        this.close(false);
        this.onMoreHelp?.();
      });
      return;
    }
    const t = STEP_TEXT[step];
    const n = CAMERA_STEPS.indexOf(step) + 1;
    this.root.innerHTML = `
      <div class="coach-row">${hintArt(step, this.input)}
        <div class="coach-text"><b>${t.title} <small>${n} of ${CAMERA_STEPS.length}</small></b><span>${this.input === "touch" ? t.touch : t.mouse}</span></div></div>
      <div class="coach-foot"><span class="coach-dots">${dots}</span><button class="chip text coach-skip">Skip tutorial</button></div>`;
    this.root.querySelector(".coach-skip")!.addEventListener("click", () => this.close(true));
  }
}

/** The view state of a camera looking at `target` from `position` (Three.js vectors, or anything with x, y, z). */
export function viewOf(position: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }): ViewState {
  const dx = position.x - target.x;
  const dy = position.y - target.y;
  const dz = position.z - target.z;
  const distance = Math.max(1e-6, Math.hypot(dx, dy, dz));
  return { tx: target.x, tz: target.z, distance, azimuth: Math.atan2(dx, dz), polar: Math.acos(Math.max(-1, Math.min(1, dy / distance))) };
}
