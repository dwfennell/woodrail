/**
 * Will this page's storage last? Not in a frame from another site on WebKit: there a framed page's localStorage and
 * IndexedDB are its own, cut off from the site's, and short-lived (the owner's iPhone, 2026-11-26: Woodrail's games on
 * itch.io, a frame on html-classic.itch.zone, gone at every reload). On an iPhone or iPad every browser is WebKit; on a
 * Mac, Safari is. So the local save and the sync code go together, and the code typed in again is the way back.
 */

export interface PageFacts {
  /** In a frame (`self !== top`). */
  framed: boolean;
  /** The frame is on another site than the page round it (its top can't be read, or is another origin). */
  crossSite: boolean;
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
}

/** An iPhone, iPad or iPod (an iPad asks for the desktop site: a Mac with a touch screen). */
export const isIOS = (f: Pick<PageFacts, "userAgent" | "platform" | "maxTouchPoints">): boolean => /iPhone|iPad|iPod/.test(f.userAgent) || (f.platform === "MacIntel" && f.maxTouchPoints > 1);

/** WebKit's own storage rules: anything on iOS, or Safari on a Mac (not Chrome, Edge, Opera or Firefox). */
export function webkitStorage(f: Pick<PageFacts, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  if (isIOS(f)) return true;
  return /AppleWebKit/.test(f.userAgent) && /Safari\//.test(f.userAgent) && !/Chrome\/|Chromium|Edg\/|OPR\/|Firefox\//.test(f.userAgent);
}

/** The page's storage may be forgotten when the player leaves (see the top). */
export function storageMayNotLast(f: PageFacts = pageFacts()): boolean {
  return f.framed && f.crossSite && webkitStorage(f);
}

export function pageFacts(): PageFacts {
  let framed = false;
  let crossSite = false;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  if (framed) {
    try {
      // (Another site's top can't be read: that throws.)
      crossSite = window.top!.location.origin !== location.origin;
    } catch {
      crossSite = true;
    }
  }
  return { framed, crossSite, userAgent: navigator.userAgent, platform: navigator.platform ?? "", maxTouchPoints: navigator.maxTouchPoints ?? 0 };
}
