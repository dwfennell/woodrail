// A sideways swipe never takes the player back (or forward) a page: a Mac trackpad's two-finger swipe, Chrome's
// overscroll navigation, a horizontal mouse wheel.
//
// - CSS: overscroll-behavior: none on html and body and the scroll boxes (style.css), and touch-action: none on the
//   canvas, so a scroll that reaches an edge doesn't chain to the page (Chrome and Firefox navigate on that).
// - The wheel: a horizontal wheel anywhere is stopped here (non-passive), and a box that scrolls sideways (the tray, the
//   research board's web) is scrolled by hand instead. Safari on a Mac swipes back on an unhandled horizontal wheel,
//   whatever the CSS says; a cancelled one it leaves alone. (The canvas's wheel is Interaction's: it cancels them all.)
// - History: a last resort, on a top-level page only. One entry is pushed after the first tap, and a Back that lands
//   on it pushes it again and stays. Not in an iframe (a claude.ai Artifact, itch.io): there the entries are the host's
//   page's too, and its own Back button would be eaten.
//
// What a page can't stop: iOS Safari's edge swipe (and Android's system back gesture) is the browser's or the OS's;
// with the history entry it at most leaves the page in place on top-level pages.

const LINE = 16;
const PAGE = 400;

/** Is this box one that scrolls sideways, with room to? */
function scrollsX(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth + 1) return false;
  const o = getComputedStyle(el).overflowX;
  return o === "auto" || o === "scroll";
}

/** The wheel event's sideways part in pixels (its vertical part, too, for a shift-wheel on a mouse). */
function deltaPx(e: WheelEvent): { dx: number; dy: number } {
  const k = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? PAGE : 1;
  return { dx: e.deltaX * k, dy: e.deltaY * k };
}

/** Is this wheel mostly sideways? (Exported for tests.) */
export function isHorizontalWheel(dx: number, dy: number): boolean {
  return Math.abs(dx) > Math.abs(dy);
}

export function installSwipeGuard(): void {
  window.addEventListener(
    "wheel",
    (e) => {
      if (e.defaultPrevented || e.ctrlKey) return; // (ctrl: a trackpad pinch, which isn't a swipe)
      const { dx, dy } = deltaPx(e);
      if (!isHorizontalWheel(dx, dy)) return;
      e.preventDefault();
      // The box under the pointer that scrolls sideways takes it, by hand (it would have, but cancelled it won't).
      for (let el = e.target instanceof Element ? e.target : null; el && el !== document.documentElement; el = el.parentElement) {
        if (scrollsX(el)) {
          el.scrollLeft += dx;
          return;
        }
      }
    },
    { passive: false },
  );
  armHistoryGuard();
}

let armed = false;

/** One history entry of our own, pushed after the first tap (so the browser counts it), held on a Back. */
function armHistoryGuard(): void {
  let top = false;
  try {
    top = window.top === window.self;
  } catch {
    top = false;
  }
  if (!top || armed) return;
  const arm = () => {
    if (armed) return;
    armed = true;
    window.removeEventListener("pointerdown", arm, true);
    window.removeEventListener("keydown", arm, true);
    try {
      history.pushState({ woodrailGuard: true }, "", location.href);
    } catch {
      return;
    }
    window.addEventListener("popstate", () => {
      // Back landed under our entry: put it back and stay. (A popstate onto our own entry is a Forward: nothing to do.)
      if ((history.state as { woodrailGuard?: boolean } | null)?.woodrailGuard) return;
      try {
        history.pushState({ woodrailGuard: true }, "", location.href);
      } catch {
        /* nothing more a page can do */
      }
    });
  };
  window.addEventListener("pointerdown", arm, true);
  window.addEventListener("keydown", arm, true);
}
