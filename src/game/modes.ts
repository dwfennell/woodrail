/**
 * The two ways to play. Sandbox: build anything, any time. Game (Beta): the same building, with goals to work
 * through (resources and a tech tree may come later). Each mode keeps its own autosave.
 */
export type GameMode = "sandbox" | "game";

export const MODES: readonly GameMode[] = ["sandbox", "game"];

export const MODE_NAMES: Record<GameMode, string> = { sandbox: "Sandbox", game: "Game" };

const LAST_MODE_KEY = "woodrail.lastMode";

/** The mode played last (its map is the title screen's backdrop). Sandbox when unknown. */
export function loadLastMode(): GameMode {
  try {
    return localStorage.getItem(LAST_MODE_KEY) === "game" ? "game" : "sandbox";
  } catch {
    return "sandbox";
  }
}

export function saveLastMode(mode: GameMode): void {
  try {
    localStorage.setItem(LAST_MODE_KEY, mode);
  } catch {
    // storage unavailable: the title shows the sandbox map next time
  }
}
