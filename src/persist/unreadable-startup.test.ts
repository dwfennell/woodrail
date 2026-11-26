/**
 * The 2026-11-23 wipe, end to end at start-up in Game mode, on the game's own path (`openGameSave`, then a first
 * `autosaveGame`, as main.ts runs them): a save that fails validation, for a reason that has nothing to do with the
 * limits, is loaded once at start-up, the starter map is made in its place, one autosave runs, and the player's game
 * must still be there byte for byte, in its own slot, not written over.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildStarterWorld } from "../game/world";
import { Journal } from "../game/journal";
import { Progress } from "../game/progress";
import { GAME_SLOT_KEYS, saveGoals, serializeWorld } from "./save";
import { GAMES_INDEX_KEY, parkedKey, SlotStore, UNREADABLE_PREFIX, unpackKeys } from "./slots";
import { autosaveGame, openGameSave } from "./startup";

const K = GAME_SLOT_KEYS;

afterEach(() => vi.unstubAllGlobals());

/** localStorage in a Map (the game's save functions use it), throwing past `quota` characters. */
function memory(quota = Infinity): Map<string, string> {
  const m = new Map<string, string>();
  const used = (but: string) => [...m].reduce((n, [k, v]) => n + (k === but ? 0 : k.length + v.length), 0);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (used(k) + k.length + v.length > quota) throw new DOMException("full", "QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  });
  return m;
}

/** Your games over that storage (the stubbed localStorage, `_m` its contents), as main.ts makes it. */
const slotsOver = (_m: Map<string, string>) => new SlotStore({ getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v), removeItem: (k) => localStorage.removeItem(k) }, K);

/**
 * A player's game in the live keys: a real railway (not the starter map: another seed's look, a train), its session
 * tagged with its slot, goals and progress, but with one thing this build's schema turns away that isn't a number
 * over a limit (so `mendTooBig` can't read it either): a piece of a type the game doesn't know.
 */
function playersGame(m: Map<string, string>): Record<string, string> {
  const world = buildStarterWorld(true);
  const data = serializeWorld(world) as unknown as { landscape: { starter: boolean; seed: number }; pieces: { type: string }[] };
  data.landscape.starter = false;
  data.landscape.seed = 770187;
  data.pieces[0].type = "piece-from-a-newer-build";
  const progress = new Progress();
  progress.coins = 21000;
  const keys = {
    [K.save]: JSON.stringify(data),
    [K.session]: JSON.stringify({ clock: 32173, paused: false, journal: { entries: [], seq: 0, readSeq: 0 }, slot: { id: "e2zlzkgb", name: "770187-gentle" } }),
    [K.goals]: JSON.stringify(["join-two", "place-train"]),
    [K.progress]: JSON.stringify(progress.toJSON()),
  };
  for (const [k, v] of Object.entries(keys)) m.set(k, v);
  return keys;
}

/** Start-up as main.ts runs it, then the first autosave of whatever world it opened with. */
async function startAndAutosave(slots: SlotStore) {
  slots.startUp();
  const atStart = await openGameSave(slots);
  // (initialWorld: the save's world, else the starter map.)
  const world = atStart.saved?.ok ? atStart.saved.value : buildStarterWorld(true);
  const progress = new Progress();
  autosaveGame(world, slots, { clock: 1, paused: false, journal: new Journal(() => 0).toJSON() }, progress.toJSON());
  saveGoals([]);
  return atStart;
}

describe("start-up in Game mode with a save that won't load, and one autosave", () => {
  it("keeps the player's game byte for byte in its own slot; the starter map is saved as another game", async () => {
    const m = memory();
    const keys = playersGame(m);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const slots = slotsOver(m);
    const atStart = await startAndAutosave(slots);
    expect(atStart.saved).toBeNull();
    expect(atStart.note).toContain("770187-gentle");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("couldn't be loaded"))).toBe(true);

    // The live keys are the starter map now, under a slot of its own.
    expect(m.get(K.save)).not.toBe(keys[K.save]);
    expect(JSON.parse(m.get(K.save)!).landscape.starter).toBe(true);
    const open = JSON.parse(m.get(K.session)!).slot;
    expect(open.id).not.toBe("e2zlzkgb");
    // The player's game: parked, every key byte for byte, its slot not written over.
    const parked = await unpackKeys(m.get(parkedKey("e2zlzkgb"))!);
    for (const [k, v] of Object.entries(keys)) if (k !== K.session) expect(parked![k], k).toBe(v);
    // (Its session as it was, but for its tag's name: "Couldn't open: …", by design, till a build opens it.)
    const session = JSON.parse(keys[K.session]);
    expect(JSON.parse(parked![K.session])).toEqual({ ...session, slot: { ...session.slot, name: `${UNREADABLE_PREFIX}770187-gentle` } });
    const index = JSON.parse(m.get(GAMES_INDEX_KEY)!) as { open: string; games: { id: string; name: string }[] };
    expect(index.open).toBe(open.id);
    expect(index.games.find((g) => g.id === "e2zlzkgb")?.name).toBe(`${UNREADABLE_PREFIX}770187-gentle`);
    expect(index.games).toHaveLength(2);

    // A second start (a reload) and autosave: still there, still untouched.
    const again = await startAndAutosave(slotsOver(m));
    expect(again.saved?.ok).toBe(true);
    expect(await unpackKeys(m.get(parkedKey("e2zlzkgb"))!)).toEqual(parked);
  });

  // (Last in the file: it locks Game mode's saves for the page, as main.ts does, and they stay locked.)
  it("with no room to park it: the live keys are left as they were, the autosave writes nothing", async () => {
    const probe = memory();
    playersGame(probe);
    slotsOver(probe).startUp();
    const quota = [...probe].reduce((n, [k, v]) => n + k.length + v.length, 0) + 200;
    const m = memory(quota);
    const keys = playersGame(m);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const atStart = await startAndAutosave(slotsOver(m));
    expect(atStart.saved?.ok).toBe(false);
    expect(atStart.note).toContain("won't be saved over");
    for (const [k, v] of Object.entries(keys)) expect(m.get(k), k).toBe(v);
  });
});
