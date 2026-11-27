// The Fullscreen API, with Safari's webkit prefix. Where element fullscreen isn't offered (iPhone Safari, or an iframe
// without allow="fullscreen", such as a host that doesn't grant it) `fullscreenAvailable()` is false and the HUD shows
// no button: a button that does nothing is worse than none.

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = (): WebkitDocument => document as WebkitDocument;

/** Can this page go fullscreen? (False on iPhone Safari and in an iframe not allowed it.) */
export function fullscreenAvailable(): boolean {
  const d = doc();
  const el = d.documentElement as WebkitElement;
  if (d.fullscreenEnabled === true && typeof el.requestFullscreen === "function") return true;
  return d.webkitFullscreenEnabled === true && typeof el.webkitRequestFullscreen === "function";
}

/** Is the page fullscreen now? */
export function isFullscreen(): boolean {
  const d = doc();
  return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
}

/** Into fullscreen, or out of it. (Must be called from a tap or click: the browser asks for a user gesture.) */
export function toggleFullscreen(): void {
  const d = doc();
  const run = (f: (() => Promise<void> | void) | undefined, self: object) => {
    try {
      const r = f?.call(self);
      // A refusal (no gesture, a policy) is left as it was: the icon follows fullscreenchange, which then doesn't come.
      if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => {});
    } catch {
      /* as above */
    }
  };
  if (isFullscreen()) run(d.exitFullscreen ?? d.webkitExitFullscreen, d);
  else {
    const el = d.documentElement as WebkitElement;
    run(el.requestFullscreen ?? el.webkitRequestFullscreen, el);
  }
}

/** Calls `f` when the page goes into or out of fullscreen (by the button, Esc, or the browser's own controls). */
export function onFullscreenChange(f: (on: boolean) => void): void {
  const fire = () => f(isFullscreen());
  document.addEventListener("fullscreenchange", fire);
  document.addEventListener("webkitfullscreenchange", fire);
}

/**
 * Should ☰ offer the home screen? On an iPhone (no fullscreen for a page there: Safari's and Chrome's bars stay) in
 * the browser, where this page is a home-screen app (its manifest: the GitHub Pages copy, not itch's frame): added to
 * the home screen, it opens with no browser bars. Not once opened from there, nor inside another site's frame.
 */
export function homeScreenOffered(): boolean {
  const n = navigator as Navigator & { standalone?: boolean };
  if (!/iPhone|iPod/.test(n.userAgent)) return false;
  if (n.standalone === true || matchMedia("(display-mode: standalone)").matches) return false;
  if (window.self !== window.top) return false;
  return !!document.querySelector('link[rel="manifest"]');
}

/** What ☰'s "Play full screen" says on an iPhone. */
export const HOME_SCREEN_HOW = "Tap Share, then Add to Home Screen: Woodrail opens from there with no browser bars. Bring this railway along with ☰ ☁ Cloud save.";
