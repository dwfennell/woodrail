/** Per-viewer preferences kept in localStorage. Storage can be missing or throw (private mode); defaults apply. */

const MUTED_KEY = "woodrail.muted";

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    // storage unavailable: the choice lasts for this session only
  }
}
