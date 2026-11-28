import type { World } from "../game/world";
import { lockSaves, loadFromStorage, newLoadReport, readSave, saveProgress, saveSession, saveToStorage, savesLocked, serializeWorld, writeSave, type LoadReport, type SessionData } from "./save";
import { nameOfSave, tagOfSession, UNREADABLE_PREFIX, type SlotStore } from "./slots";
import type { Backup, BackupStore } from "./backups";
import { railFacts, tripText, type RailFacts, type Trip, type WriteGuard } from "./write-guard";

// Game mode's start-up and autosave, as main.ts runs them, in a module of their own so a test can run the same path
// (unreadable-startup.test.ts: the 2026-11-23 wipe, a save that won't load and the first autosave after it;
// save-safety.test.ts: the backups and the write guard, spec 2026-11-26-save-safety.md).

/**
 * Save safety's parts (spec 2026-11-26-save-safety.md): the write guard, the backups, and how to tell the player. One a
 * page, in Game mode.
 */
export interface SaveSafety {
  readonly guard: WriteGuard;
  readonly backups: BackupStore;
  /** Tell the player (a toast). */
  say(text: string): void;
  /** A kept copy being made after the guard tripped: nothing of the game is written till it's done. */
  pending?: boolean;
}

/** What the open Game save gave at start-up, and what the game says about it, once, if anything. */
export interface GameAtStart {
  /** The save loaded (ok), one turned away that's still in the live keys (its saves locked), or null: none to open. */
  readonly saved: ReturnType<typeof loadFromStorage>;
  /** Said once as the game is entered: why the game couldn't be opened, and where it's kept. Null: nothing to say. */
  readonly note: string | null;
  /** What the load clamped or dropped (empty: nothing). */
  readonly report: LoadReport;
  /** The save loaded cleanly: take its `load` backup (later, off the start-up path: the keys as they loaded). */
  readonly backup: (() => Promise<Backup | null>) | null;
}

/** A loaded world's facts for the guard (as its save has them, without parsing it). */
export function worldFacts(world: World): RailFacts {
  let cars = 0;
  for (const t of world.sim.trains()) cars += t.cars.length;
  const { seed, starter } = world.landscape;
  return { ...railFacts({ landscape: { seed, starter } }), pieces: world.layout.pieceCount, cars };
}

/**
 * At start-up, before anything is made or saved: the open Game save loaded once. One this build can't read is parked
 * in Your games as it is ("Couldn't open: …", to try again after an update), and Game mode starts with no game open;
 * with no room to park it, it's left in place and Game mode's saves are locked for this page, so the map made instead
 * never overwrites it. (A save that fails to load is never written over: 2026-11-23, a player's game lost so.) One that
 * loads cleanly is known to the guard, and its keys as they loaded are held for its backup.
 */
export async function openGameSave(slots: SlotStore, safety?: SaveSafety): Promise<GameAtStart> {
  const report = newLoadReport();
  const saved = loadFromStorage("game", report);
  if (!saved || saved.ok) {
    let backup: GameAtStart["backup"] = null;
    if (saved?.ok) {
      slots.noteReadable();
      const keys = slots.liveKeys();
      const raw = keys[slots.keys.save];
      const id = slots.openId;
      if (safety && raw !== undefined) safety.guard.know(raw, worldFacts(saved.value));
      if (safety && raw !== undefined && id !== null) backup = () => safety.backups.take(id, keys, "load");
    }
    return { saved, note: null, report, backup };
  }
  console.warn(`Woodrail: the game's save couldn't be loaded (${saved.error}): kept, not overwritten`);
  const name = await slots.keepUnreadable();
  if (name !== null) {
    return { saved: null, report, backup: null, note: `“${name.slice(UNREADABLE_PREFIX.length)}” couldn't be opened by this version of the game. It's kept safe in ☰ Your games: open it there to try again after an update.` };
  }
  lockSaves("game");
  return { saved, report, backup: null, note: "Your game couldn't be opened by this version of the game. It's kept as it was and this one won't be saved over it: please tell us (☰ Report a bug)." };
}

/**
 * Game mode's autosave: the railway, then (a railway no game is open for, the starter map from a first start, becoming
 * one) its session tagged with the open game, and its progress. Nothing is written while its saves are locked. With
 * `safety`: the write guard first (nothing written when it trips, till the stored game is kept), and a railway that
 * doesn't fit makes room by letting a backup go.
 */
export function autosaveGame(world: World, slots: SlotStore, session: Omit<SessionData, "slot">, progress: unknown, safety?: SaveSafety): void {
  if (savesLocked("game")) return;
  if (!safety) saveToStorage(world, "game");
  else {
    if (safety.pending) return;
    const data = serializeWorld(world);
    const facts = railFacts(data);
    const trip = safety.guard.check(readSave("game"), facts);
    if (trip) {
      void keepAfterTrip(trip, slots, safety);
      return;
    }
    const raw = JSON.stringify(data);
    if (writeSave("game", raw, () => safety.backups.freeOne())) safety.guard.know(raw, facts);
  }
  if (slots.openId === null) slots.startUp();
  const slot = slots.openTag();
  saveSession("game", { ...session, ...(slot ? { slot } : {}) });
  saveProgress(progress);
}

/**
 * The guard tripped: the stored game's keys kept as a `kept` backup (read back) before anything's written over them.
 * Kept: saves go on from the next autosave. Not (no room): Game mode's saves locked for the page. Said either way.
 */
async function keepAfterTrip(trip: Trip, slots: SlotStore, safety: SaveSafety): Promise<void> {
  safety.pending = true;
  const stored = slots.liveKeys();
  const raw = stored[slots.keys.save];
  // (Named as the railway kept calls itself: its session's tag, else its map; not whatever's in play now.)
  const name = tagOfSession(stored[slots.keys.session])?.name || nameOfSave(raw);
  let kept: Backup | null = null;
  try {
    kept = raw === undefined ? null : await safety.backups.take(slots.openId ?? "unslotted", stored, "kept");
  } catch {
    kept = null;
  }
  console.warn(`Woodrail: the write guard stopped a save over “${name}” (${trip}): ${kept ? "kept as a backup" : "no room to keep it: saves locked"}`);
  if (kept && raw !== undefined) {
    safety.guard.keptSafe(raw);
    safety.pending = false;
  } else lockSaves("game");
  safety.say(tripText(trip, !!kept, name));
}
