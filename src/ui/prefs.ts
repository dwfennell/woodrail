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

const FAVOURITES_KEY = "woodrail.favourites";

/** The tray favourites (tray keys, in order), or null if none were ever chosen. */
export function loadFavourites(): string[] | null {
  try {
    const raw = localStorage.getItem(FAVOURITES_KEY);
    if (raw === null) return null;
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string") : null;
  } catch {
    return null;
  }
}

export function saveFavourites(keys: readonly string[]): void {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(keys));
  } catch {
    // storage unavailable: the choice lasts for this session only
  }
}
