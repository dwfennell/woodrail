/**
 * A save that won't load is never written over (2026-11-23: a player's game, its Lift-and-load warehouse holding 72
 * planks past the schema's limit of 40, failed to load after a reload and a fresh starter map was saved over it).
 */
import lostGame from "./fixtures/2026-11-23-lift-warehouse-game.txt?raw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { capOf, LIFT_STACK, MAX_SHEDS, RECIPES, SHED_CAP } from "../economy";
import type { DepotRole } from "../economy";
import { readMapText } from "./bug-map";
import { MAX_PILE } from "./save-limits";
import { deserializeWorld, GAME_SLOT_KEYS, loadFromStorage, lockSaves, saveGoals, saveSession, saveToStorage, unreadableKey } from "./save";
import { parkedKey, SlotStore, UNREADABLE_PREFIX, unpackKeys } from "./slots";

const K = GAME_SLOT_KEYS;

function memory(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  return store;
}

afterEach(() => vi.unstubAllGlobals());

describe("the save's pile limit", () => {
  it("holds every depot's fullest pile: a warehouse stacked by Lift and load, a harbour with all its sheds", () => {
    for (const role of Object.keys(RECIPES) as DepotRole[]) expect(capOf(role) * LIFT_STACK + MAX_SHEDS * SHED_CAP, role).toBeLessThanOrEqual(MAX_PILE);
  });

  it("loads the player's game that was lost (a warehouse with 70 and 72 planks)", async () => {
    const copy = await readMapText(lostGame);
    const data = JSON.parse(copy!.keys[K.save]) as { depots: { role: string; piles: number[] }[] };
    expect(Math.max(...data.depots.filter((d) => d.role === "warehouse").flatMap((d) => d.piles))).toBeGreaterThan(40);
    const r = deserializeWorld(data, { sandbox: false });
    expect(r.ok ? "ok" : r.error).toBe("ok");
  });
});

describe("a save this build can't load", () => {
  const bad = JSON.stringify({ version: 15, landscape: { seed: 770187 }, depots: "not a list" });

  it("is kept aside under a key of its own as it loads", () => {
    const store = memory();
    store.set(K.save, bad);
    const r = loadFromStorage("game");
    expect(r?.ok).toBe(false);
    expect(store.get(unreadableKey("game", bad))).toBe(bad);
  });

  it("with its mode's saves locked, nothing of the mode is written", () => {
    const store = memory();
    store.set(K.save, bad);
    store.set(K.goals, "[\"a\"]");
    lockSaves("game");
    saveGoals(["b"]);
    saveSession("game", { clock: 1, paused: false, journal: { entries: [], seq: 0, readSeq: 0 } } as never);
    expect(saveToStorage({} as never, "game")).toBe(false);
    expect(store.get(K.save)).toBe(bad);
    expect(store.get(K.goals)).toBe("[\"a\"]");
    expect(store.has(K.session)).toBe(false);
  });
});

/** A Storage in a Map that throws past `quota` characters. */
function slotStore(quota = Infinity) {
  const m = new Map<string, string>();
  const s = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      const used = [...m].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
      if (used + k.length + v.length > quota) throw new DOMException("full", "QuotaExceededError");
      m.set(k, v);
    },
    removeItem: (k: string) => void m.delete(k),
  };
  return { m, store: new SlotStore(s, K) };
}

describe("Your games: keepUnreadable", () => {
  const keys = {
    [K.save]: JSON.stringify({ version: 15, landscape: { seed: 770187, starter: true, hills: "gentle" }, depots: [{ piles: [72] }] }),
    [K.session]: JSON.stringify({ clock: 32173, paused: false, journal: { entries: [], seq: 0, readSeq: 0 }, slot: { id: "e2zlzkgb", name: "770187-gentle" } }),
    [K.goals]: JSON.stringify(["join-two", "place-train"]),
    [K.progress]: JSON.stringify({ coins: 21000 }),
  };

  it("parks the open game as it is, named Couldn't open, and lets the live keys go", async () => {
    const { m, store } = slotStore();
    for (const [k, v] of Object.entries(keys)) m.set(k, v);
    store.startUp();
    expect(await store.keepUnreadable()).toBe(`${UNREADABLE_PREFIX}770187-gentle`);
    for (const k of K.live) expect(m.has(k), k).toBe(false);
    expect(store.openId).toBeNull();
    const parked = await unpackKeys(m.get(parkedKey("e2zlzkgb"))!);
    expect(parked![K.save]).toBe(keys[K.save]);
    expect(parked![K.progress]).toBe(keys[K.progress]);
    expect(store.list()).toMatchObject([{ id: "e2zlzkgb", name: `${UNREADABLE_PREFIX}770187-gentle`, coins: 21000, goals: 2 }]);
    // A new game made after it, then saved: the parked one is untouched.
    store.startUp();
    expect((await store.beginNew("Starter map")).ok).toBe(true);
    m.set(K.save, "{\"version\":15}");
    expect(await unpackKeys(m.get(parkedKey("e2zlzkgb"))!)).toEqual(parked);
  });

  it("opened again and failing again: the same game, not a second copy, and its name not prefixed twice", async () => {
    const { m, store } = slotStore();
    for (const [k, v] of Object.entries(keys)) m.set(k, v);
    store.startUp();
    await store.keepUnreadable();
    expect((await store.open("e2zlzkgb")).ok).toBe(true);
    store.startUp();
    expect(await store.keepUnreadable()).toBe(`${UNREADABLE_PREFIX}770187-gentle`);
    expect(store.list().map((g) => g.id)).toEqual(["e2zlzkgb"]);
    // Opened by a build that reads it: its name back.
    await store.open("e2zlzkgb");
    store.startUp();
    store.noteReadable();
    expect(store.openEntry()?.name).toBe("770187-gentle");
  });

  it("with no room to park it, it's left in the live keys (null: the page locks its saves)", async () => {
    const { m, store } = slotStore();
    for (const [k, v] of Object.entries(keys)) m.set(k, v);
    store.startUp();
    const used = [...m].reduce((n, [k, v]) => n + k.length + v.length, 0);
    const tight = slotStore(used + 40);
    for (const [k, v] of m) tight.m.set(k, v);
    expect(await tight.store.keepUnreadable()).toBeNull();
    for (const [k, v] of Object.entries(keys)) if (k !== K.session) expect(tight.m.get(k)).toBe(v);
  });
});

describe("Your games: a map pasted as text", () => {
  it("is added beside the open game under a new id, never over it, and opens", async () => {
    const copy = await readMapText(lostGame);
    const { m, store } = slotStore();
    const open = { [K.save]: "{\"version\":15,\"landscape\":{\"seed\":7,\"starter\":true}}", [K.session]: JSON.stringify({ clock: 21, slot: { id: "e2zlzkgb", name: "770187-gentle" } }) };
    for (const [k, v] of Object.entries(open)) m.set(k, v);
    store.startUp();
    const r = await store.add(copy!.keys);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).not.toBe("e2zlzkgb");
    expect(r.value.name).toBe("770187-gentle (from text)");
    expect(m.get(K.save)).toBe(open[K.save]);
    expect(store.list().find((g) => g.id === r.value.id)).toMatchObject({ coins: expect.any(Number) });
    expect((await store.open(r.value.id)).ok).toBe(true);
    expect(m.get(K.save)).toBe(copy!.keys[K.save]);
    expect(store.isParked("e2zlzkgb")).toBe(true);
  });
});
