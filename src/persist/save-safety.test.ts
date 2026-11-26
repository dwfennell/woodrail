/**
 * Save safety (spec docs/superpowers/specs/2026-11-26-save-safety.md): the backups (layer 1), the write guard (layer 2)
 * on the game's own start-up and autosave path (`openGameSave`, `autosaveGame`, as main.ts runs them), a restore, and
 * the load report (layer 4). The corpus gate (layer 3) is corpus.test.ts.
 *
 * The wipe it's for (2026-11-22): the player's game in the live keys, the page playing the starter map instead (a
 * bug), and the first autosave writing it over the game. Here the page is made to play the starter map over the
 * player's real map (fixtures/2026-11-23-lift-warehouse-game.txt) and the guard must stop it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import userMap from "./fixtures/2026-11-23-lift-warehouse-game.txt?raw";
import wipedMap from "../../docs/agents/reports/2026-11-23-wiped-after-update.txt?raw";
import { buildStarterWorld } from "../game/world";
import { Journal } from "../game/journal";
import { readMapText } from "./bug-map";
import { BACKUPS_INDEX_KEY, backupDataKey, BackupStore, KEEP } from "./backups";
import { deserializeWorld, describeLoad, GAME_SLOT_KEYS, newLoadReport, reportLine, savesLocked, serializeWorld } from "./save";
import { parkedKey, SlotStore, unpackKeys } from "./slots";
import { autosaveGame, openGameSave, type SaveSafety } from "./startup";
import { railFacts, REAL_WEIGHT, tripOf, WriteGuard } from "./write-guard";

const K = GAME_SLOT_KEYS;
const DAY = 86_400_000;

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

const store = () => ({ getItem: (k: string) => localStorage.getItem(k), setItem: (k: string, v: string) => localStorage.setItem(k, v), removeItem: (k: string) => localStorage.removeItem(k) });

/** The user's game's keys (railway, session, goals, progress), as their phone had them on 2026-11-23. */
async function usersKeys(text = userMap): Promise<Record<string, string>> {
  const copy = await readMapText(text);
  return Object.fromEntries(Object.entries(copy!.keys).filter(([k]) => (K.live as readonly string[]).includes(k)));
}

const session = () => ({ clock: 1, paused: false, journal: new Journal(() => 0).toJSON() });

function safetyOver(clock: { t: number }, said: string[], budget?: number): SaveSafety {
  return { guard: new WriteGuard(), backups: new BackupStore(store(), K, () => clock.t, budget), say: (t) => said.push(t) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the write guard's rule", () => {
  it("the 2026-11-22 write is refused: the starter map over the user's railway", async () => {
    const real = railFacts(JSON.parse((await usersKeys())[K.save]));
    const wiped = railFacts(JSON.parse((await usersKeys(wipedMap))[K.save]));
    expect(real).toMatchObject({ seed: 770187, starterMap: false, pieces: 267 });
    expect(wiped).toMatchObject({ seed: 7, starterMap: true, pieces: 7, cars: 0 });
    expect(tripOf(real, wiped)).toBe("starter");
  });

  it("another seed, or near-empty, over a real railway; nothing over a small one or the same railway grown or cut a little", () => {
    const big = { seed: 5, starterMap: false, pieces: 200, cars: 30 };
    expect(tripOf(big, { ...big, seed: 6 })).toBe("seed");
    expect(tripOf(big, { ...big, pieces: 40, cars: 10 })).toBe("empty");
    expect(tripOf(big, { ...big, pieces: 120 })).toBeNull();
    expect(tripOf(big, { ...big, pieces: 260 })).toBeNull();
    // (Small railways aren't guarded: a new game's first minutes, a starter map torn up.)
    const small = { seed: 7, starterMap: true, pieces: REAL_WEIGHT - 6, cars: 3 };
    expect(tripOf(small, { seed: 7, starterMap: true, pieces: 7, cars: 0 })).toBeNull();
    expect(tripOf(null, big)).toBeNull();
    // (A real starter-map game cut down to its start: near-empty.)
    expect(tripOf({ seed: 7, starterMap: true, pieces: 150, cars: 12 }, { seed: 7, starterMap: true, pieces: 7, cars: 0 })).toBe("empty");
  });

  it("a stored text that doesn't parse is a trip (kept first); one kept safe isn't", () => {
    const g = new WriteGuard();
    expect(g.check("{not json", { seed: 1, starterMap: false, pieces: 1, cars: 0 })).toBe("unreadable");
    g.keptSafe("{not json");
    expect(g.check("{not json", { seed: 1, starterMap: false, pieces: 1, cars: 0 })).toBeNull();
  });
});

describe("the wipe at start-up, with the write guard", () => {
  it("the starter map isn't saved over the user's game: nothing written till it's kept, then kept byte for byte and listed", async () => {
    const m = memory();
    const keys = await usersKeys();
    for (const [k, v] of Object.entries(keys)) m.set(k, v);
    const clock = { t: Date.UTC(2026, 10, 22, 18) };
    const said: string[] = [];
    const safety = safetyOver(clock, said);
    const slots = new SlotStore(store(), K, () => clock.t);
    slots.startUp();
    const id = slots.openId!;
    const atStart = await openGameSave(slots, safety);
    expect(atStart.saved?.ok).toBe(true);
    expect(describeLoad(atStart.report)).toBeNull();
    // The bug: the page plays the starter map though the game loaded. Its autosave: nothing written.
    const starter = buildStarterWorld(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    autosaveGame(starter, slots, session(), {}, safety);
    for (const [k, v] of Object.entries(keys)) if (k !== K.session) expect(m.get(k), k).toBe(v);
    // (And while the copy's being made, the next autosave writes nothing either.)
    autosaveGame(starter, slots, session(), {}, safety);
    expect(m.get(K.save)).toBe(keys[K.save]);
    await vi.waitFor(() => expect(said).toHaveLength(1));
    expect(said[0]).toContain("kept safe");
    expect(said[0]).toContain("Earlier versions");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("write guard"))).toBe(true);
    const [b] = safety.backups.list(id);
    expect(b).toMatchObject({ kind: "kept", trains: 10, pieces: 267 });
    const back = await safety.backups.read(id, b.n);
    for (const k of Object.keys(keys)) expect(back![k], k).toBe(m.get(k) === undefined ? keys[k] : keys[k] === m.get(k) ? keys[k] : back![k]);
    expect(back![K.save]).toBe(keys[K.save]);
    // Kept: saves go on (the next autosave writes the map in play), and it never trips on that copy again.
    autosaveGame(starter, slots, session(), {}, safety);
    expect(JSON.parse(m.get(K.save)!).landscape.seed).toBe(7);
    expect(said).toHaveLength(1);
    // Its backup at load, taken later as main.ts does: the keys as they loaded, not what's in the live keys now.
    // (The same keys as the kept copy: that one's given back, not a second copy of them.)
    const loaded = await atStart.backup!();
    expect(loaded?.n).toBe(b.n);
    expect(safety.backups.list(id)).toHaveLength(1);
  });

  it("an autosave of the same railway, grown, writes as it always did", async () => {
    const m = memory();
    for (const [k, v] of Object.entries(await usersKeys())) m.set(k, v);
    const said: string[] = [];
    const safety = safetyOver({ t: 0 }, said);
    const slots = new SlotStore(store(), K);
    slots.startUp();
    const atStart = await openGameSave(slots, safety);
    const world = atStart.saved?.ok ? atStart.saved.value : null;
    autosaveGame(world!, slots, session(), {}, safety);
    expect(m.get(K.save)).toBe(JSON.stringify(serializeWorld(world!)));
    expect(said).toEqual([]);
  });

  // (Last in this describe: it locks Game mode's saves for the page, as main.ts does.)
  it("with no room to keep it: nothing written, saves locked, the player told", async () => {
    const probe = memory();
    for (const [k, v] of Object.entries(await usersKeys())) probe.set(k, v);
    new SlotStore(store(), K).startUp();
    const quota = [...probe].reduce((n, [k, v]) => n + k.length + v.length, 0) + 2000;
    const m = memory(quota);
    const keys = await usersKeys();
    for (const [k, v] of Object.entries(keys)) m.set(k, v);
    const said: string[] = [];
    const safety = safetyOver({ t: 0 }, said);
    const slots = new SlotStore(store(), K);
    slots.startUp();
    await openGameSave(slots, safety);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    autosaveGame(buildStarterWorld(true), slots, session(), {}, safety);
    await vi.waitFor(() => expect(said).toHaveLength(1));
    expect(said[0]).toContain("wasn't saved over");
    expect(savesLocked("game")).toBe(true);
    autosaveGame(buildStarterWorld(true), slots, session(), {}, safety);
    for (const [k, v] of Object.entries(keys)) if (k !== K.session) expect(m.get(k), k).toBe(v);
  });
});

describe("backups", () => {
  const keysOf = (n: number) => ({ [K.save]: JSON.stringify({ pieces: Array(n).fill(0), trains: [{}] }), [K.progress]: JSON.stringify({ coins: n }) });

  it("a copy is read back and checked; the same keys again aren't copied; the first of a day is the day's", async () => {
    memory();
    const clock = { t: Date.UTC(2026, 10, 20, 12) };
    const b = new BackupStore(store(), K, () => clock.t);
    const first = await b.take("g", keysOf(10), "load");
    expect(first).toMatchObject({ kind: "day", pieces: 10, trains: 1, coins: 10 });
    expect(await b.take("g", keysOf(10), "load")).toEqual(first);
    clock.t += 60_000;
    expect((await b.take("g", keysOf(11), "load"))?.kind).toBe("load");
    clock.t += DAY;
    expect((await b.take("g", keysOf(12), "load"))?.kind).toBe("day");
    expect(b.list("g").map((x) => x.pieces)).toEqual([12, 11, 10]);
    expect((await b.read("g", first!.n))![K.save]).toBe(keysOf(10)[K.save]);
  });

  it("keeps a few of each kind, the newest", async () => {
    const m = memory();
    const clock = { t: Date.UTC(2026, 10, 1, 12) };
    const b = new BackupStore(store(), K, () => clock.t);
    for (let i = 0; i < 20; i++) {
      clock.t += DAY / 4;
      await b.take("g", keysOf(i + 1), "load");
    }
    const list = b.list("g");
    expect(list.filter((x) => x.kind === "load")).toHaveLength(KEEP.load);
    expect(list.filter((x) => x.kind === "day")).toHaveLength(KEEP.day);
    expect(list[0].pieces).toBe(20);
    // (And the data of those let go is gone too.)
    expect([...m.keys()].filter((k) => k.startsWith("woodrail.games.backup.g.")).length).toBe(list.length);
  });

  it("all games' copies fit the budget, the least precious going first; never a game's last", async () => {
    const m = memory();
    const clock = { t: 0 };
    const big = (n: number) => ({ [K.save]: JSON.stringify({ pieces: Array.from({ length: 3000 }, (_, i) => (i * 7919 + n) % 9973), trains: [] }) });
    const one = await new BackupStore(store(), K, () => clock.t).take("a", big(0), "kept");
    const b = new BackupStore(store(), K, () => clock.t, one!.chars * 3 + 10);
    for (let i = 1; i <= 6; i++) {
      clock.t += 1000;
      await b.take(i % 2 ? "b" : "c", big(i), "load");
    }
    expect(b.totalChars()).toBeLessThanOrEqual(b.budget);
    expect(b.list("a")).toHaveLength(1);
    expect(b.list("b").length).toBeGreaterThan(0);
    expect(b.list("c").length).toBeGreaterThan(0);
    const listed = new Set(["a", "b", "c"].flatMap((g) => b.list(g).map((x) => backupDataKey(g, x.n))));
    for (const k of m.keys()) if (k.startsWith("woodrail.games.backup.")) expect(listed.has(k), k).toBe(true);
    // (Only each game's last copy is left: none to let go for a save.)
    expect(b.list("b").length + b.list("c").length + b.list("a").length).toBe(3);
    expect(b.freeOne()).toBe(false);
  });

  it("a copy that doesn't come back as written isn't kept; one changed in storage doesn't read", async () => {
    const m = memory();
    const b = new BackupStore(
      { getItem: (k) => (k.startsWith("woodrail.games.backup.g.") ? "garbage" : m.get(k) ?? null), setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) },
      K,
    );
    expect(await b.take("g", keysOf(3), "load")).toBeNull();
    expect([...m.keys()].filter((k) => k.startsWith("woodrail.games.backup.g."))).toEqual([]);
    memory();
    const ok = new BackupStore(store(), K);
    const c = await ok.take("h", keysOf(3), "load");
    localStorage.setItem(backupDataKey("h", c!.n), (await import("./slots")).GAMES_INDEX_KEY);
    expect(await ok.read("h", c!.n)).toBeNull();
    expect(JSON.parse(localStorage.getItem(BACKUPS_INDEX_KEY)!).h).toHaveLength(1);
  });
});

describe("restoring an earlier version", () => {
  it("replaces the open game's keys (its id and name kept), or a parked one's; or adds it as a game beside", async () => {
    const m = memory();
    const keys = await usersKeys();
    for (const [k, v] of Object.entries(keys)) m.set(k, v);
    const slots = new SlotStore(store(), K);
    slots.startUp();
    const id = slots.openId!;
    const b = new BackupStore(store(), K);
    const copy = await b.take(id, slots.liveKeys(), "load");
    const back = (await b.read(id, copy!.n))!;
    m.set(K.save, JSON.stringify(serializeWorld(buildStarterWorld(true))));
    expect((await slots.replace(id, back)).ok).toBe(true);
    expect(m.get(K.save)).toBe(keys[K.save]);
    expect(slots.openId).toBe(id);
    const added = await slots.add(back, "22 Nov");
    expect(added.ok && added.value.name).toBe("770187-gentle (22 Nov)");
    const parked = added.ok ? added.value.id : "";
    expect((await slots.replace(parked, { ...back, [K.save]: JSON.stringify({ x: 1 }) })).ok).toBe(true);
    expect((await unpackKeys(m.get(parkedKey(parked))!))![K.save]).toBe(JSON.stringify({ x: 1 }));
    expect((await slots.keysOf(parked))![K.save]).toBe(JSON.stringify({ x: 1 }));
  });
});

describe("the load report", () => {
  it("counts what a load clamped and dropped, names it for the player, and gives the counts alone for a crash report", async () => {
    const save = JSON.parse((await usersKeys())[K.save]) as { trains: { lead: { pieceId: number } }[]; depots: { piles: number[] }[]; delivered: [number, number][] };
    save.trains[0].lead.pieceId = 99_999;
    save.depots[0].piles[0] = 1_000_000;
    save.delivered.push([4242, 3]);
    const r = newLoadReport();
    expect(deserializeWorld(save, { report: r }).ok).toBe(true);
    expect(r.dropped).toEqual({ trains: 1, "town records": 1 });
    expect(r.clamped).toEqual({ "depots.piles": 1 });
    expect(describeLoad(r)).toBe("Your game loaded, but this version couldn't keep all of it: 1 town record left out, 1 train left out, 1 pile cut to the limit.");
    expect(reportLine(r)).toBe("dropped town records×1, trains×1; clamped depots.piles×1");
  });
});

it("backups' data of games deleted goes with them", async () => {
  const m = memory();
  const b = new BackupStore(store(), K);
  await b.take("g", { [K.save]: "{}" }, "kept");
  b.removeGame("g");
  expect([...m.keys()].filter((k) => k.startsWith("woodrail.games.backup"))).toEqual([]);
  await settle();
});
