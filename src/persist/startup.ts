import type { World } from "../game/world";
import { loadFromStorage, lockSaves, saveProgress, saveSession, saveToStorage, type SessionData } from "./save";
import { UNREADABLE_PREFIX, type SlotStore } from "./slots";

// Game mode's start-up and autosave, as main.ts runs them, in a module of their own so a test can run the same path
// (unreadable-startup.test.ts: the 2026-11-23 wipe, a save that won't load and the first autosave after it).

/** What the open Game save gave at start-up, and what the game says about it, once, if anything. */
export interface GameAtStart {
  /** The save loaded (ok), one turned away that's still in the live keys (its saves locked), or null: none to open. */
  readonly saved: ReturnType<typeof loadFromStorage>;
  /** Said once as the game is entered: why the game couldn't be opened, and where it's kept. Null: nothing to say. */
  readonly note: string | null;
}

/**
 * At start-up, before anything is made or saved: the open Game save loaded once. One this build can't read is parked
 * in Your games as it is ("Couldn't open: …", to try again after an update), and Game mode starts with no game open;
 * with no room to park it, it's left in place and Game mode's saves are locked for this page, so the map made instead
 * never overwrites it. (A save that fails to load is never written over: 2026-11-23, a player's game lost so.)
 */
export async function openGameSave(slots: SlotStore): Promise<GameAtStart> {
  const saved = loadFromStorage("game");
  if (!saved || saved.ok) {
    if (saved?.ok) slots.noteReadable();
    return { saved, note: null };
  }
  console.warn(`Woodrail: the game's save couldn't be loaded (${saved.error}): kept, not overwritten`);
  const name = await slots.keepUnreadable();
  if (name !== null) {
    return { saved: null, note: `“${name.slice(UNREADABLE_PREFIX.length)}” couldn't be opened by this version of the game. It's kept safe in ☰ Your games: open it there to try again after an update.` };
  }
  lockSaves("game");
  return { saved, note: "Your game couldn't be opened by this version of the game. It's kept as it was and this one won't be saved over it: please tell us (☰ Report a bug)." };
}

/**
 * Game mode's autosave: the railway, then (a railway no game is open for, the starter map from a first start, becoming
 * one) its session tagged with the open game, and its progress. Nothing is written while its saves are locked.
 */
export function autosaveGame(world: World, slots: SlotStore, session: Omit<SessionData, "slot">, progress: unknown): void {
  saveToStorage(world, "game");
  if (slots.openId === null) slots.startUp();
  const slot = slots.openTag();
  saveSession("game", { ...session, ...(slot ? { slot } : {}) });
  saveProgress(progress);
}
