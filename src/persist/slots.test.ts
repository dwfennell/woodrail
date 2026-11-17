import { describe, expect, it } from "vitest";
import { GAME_SLOT_KEYS } from "./save";
import { GAMES_INDEX_KEY, NO_ROOM, nameOfSave, packKeys, parkedKey, pictureKey, SlotStore, tagOfSession, unpackKeys, withTag, type SlotStorage } from "./slots";

const K = GAME_SLOT_KEYS;

/** A Storage in a Map, that throws (as a full localStorage does) past `quota` characters in all. */
class Store implements SlotStorage {
  readonly m = new Map<string, string>();
  constructor(public quota = Infinity) {}
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    const used = [...this.m].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0);
    if (used + k.length + v.length > this.quota) throw new DOMException("full", "QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  get used(): number {
    return [...this.m].reduce((n, [k, v]) => n + k.length + v.length, 0);
  }
}

/** A Game save's keys, as the game writes them (a world with `n` pieces on a map of this seed). */
function gameKeys(seed: number, n: number, starter = false): Record<string, string> {
  const pieces = Array.from({ length: n }, (_, id) => ({ id, type: "straight", x: id * 100, z: 0, heading: 0, y: 0, flipped: false }));
  return {
    [K.save]: JSON.stringify({ version: 20, landscape: { seed, starter, hills: "gentle", water: "none", coast: null }, pieces }),
    [K.session]: JSON.stringify({ clock: n, paused: false, journal: { entries: [], seq: 0, readSeq: 0 } }),
    [K.goals]: JSON.stringify(Array.from({ length: n % 7 }, (_, i) => `g${i}`)),
    [K.progress]: JSON.stringify({ coins: n * 10 }),
  };
}

function put(s: Store, keys: Record<string, string>): void {
  for (const [k, v] of Object.entries(keys)) s.setItem(k, v);
}

let ids = 0;
const store = (s: Store, now = () => 1000) => new SlotStore(s, K, now, () => `id${++ids}`);
const piecesOf = (s: SlotStorage) => (JSON.parse(s.getItem(K.save)!) as { pieces: unknown[] }).pieces.length;

describe("SlotStore", () => {
  it("migrates an old single save to game 1: its save untouched, kept after a reload", () => {
    const s = new Store();
    const old = gameKeys(12345, 30);
    put(s, old);
    const a = store(s);
    a.startUp();
    const list = a.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "12345-gentle-water-none-nocoast", goals: 2, coins: 300 });
    expect(a.openId).toBe(list[0].id);
    // (The save byte for byte; the session keeps everything and gains the tag.)
    expect(s.getItem(K.save)).toBe(old[K.save]);
    expect(s.getItem(K.goals)).toBe(old[K.goals]);
    expect(s.getItem(K.progress)).toBe(old[K.progress]);
    expect(JSON.parse(s.getItem(K.session)!)).toMatchObject({ clock: 30, slot: { id: list[0].id } });
    // A reload: the same game, nothing written.
    const index = s.getItem(GAMES_INDEX_KEY);
    const b = store(s);
    b.startUp();
    expect(s.getItem(GAMES_INDEX_KEY)).toBe(index);
    expect(b.list().map((g) => g.id)).toEqual([list[0].id]);
  });

  it("starts with no games when there's no save, and names the starter map", () => {
    const s = new Store();
    const a = store(s);
    a.startUp();
    expect(a.list()).toEqual([]);
    expect(a.openId).toBeNull();
    expect(nameOfSave(gameKeys(7, 1, true)[K.save])).toBe("Starter map");
    expect(nameOfSave("not json")).toBe("A railway");
  });

  it("a new game parks the open one; opening it again brings it back whole", async () => {
    const s = new Store();
    const first = gameKeys(1, 40);
    put(s, first);
    const a = store(s);
    a.startUp();
    const one = a.openId!;
    const made = await a.beginNew("Second");
    expect(made.ok).toBe(true);
    const two = made.ok ? made.value : "";
    expect(a.openId).toBe(two);
    expect(a.isParked(one)).toBe(true);
    // The live keys are the new game's: only its tag till it's saved.
    expect(s.getItem(K.save)).toBeNull();
    expect(tagOfSession(s.getItem(K.session))).toEqual({ id: two, name: "Second" });
    put(s, { ...gameKeys(2, 5), [K.session]: JSON.stringify({ clock: 5, paused: false, journal: { entries: [], seq: 0, readSeq: 0 }, slot: { id: two, name: "Second" } }) });
    expect((await a.open(one)).ok).toBe(true);
    expect(a.openId).toBe(one);
    expect(s.getItem(K.save)).toBe(first[K.save]);
    expect(s.getItem(K.progress)).toBe(first[K.progress]);
    expect(a.isParked(one)).toBe(false);
    expect(a.isParked(two)).toBe(true);
    const parked = await unpackKeys(s.getItem(parkedKey(two))!);
    expect(JSON.parse(parked![K.save]).pieces).toHaveLength(5);
    // After a reload, the open game is still the first.
    const b = store(s);
    b.startUp();
    expect(b.openId).toBe(one);
    expect(b.list()).toHaveLength(2);
  });

  it("parks a late game small (gzipped)", async () => {
    const s = new Store();
    put(s, gameKeys(3, 1500));
    const a = store(s);
    a.startUp();
    const raw = a.liveKeys();
    const rawSize = Object.values(raw).reduce((n, v) => n + v.length, 0);
    await a.beginNew("Next");
    const parked = s.getItem(parkedKey(a.list().find((g) => g.name !== "Next")!.id))!;
    expect(parked.length).toBeLessThan(rawSize / 4);
  });

  it("copies, renames and deletes", async () => {
    const s = new Store();
    put(s, gameKeys(4, 20));
    const a = store(s);
    a.startUp();
    const one = a.openId!;
    a.setPicture(one, "data:image/webp;base64,AAAA");
    const c = await a.copy(one);
    expect(c.ok).toBe(true);
    const copy = c.ok ? c.value : "";
    expect(a.list().find((g) => g.id === copy)!.name).toBe("4-gentle-water-none-nocoast (copy)");
    expect(a.picture(copy)).toBe("data:image/webp;base64,AAAA");
    const keys = await unpackKeys(s.getItem(parkedKey(copy))!);
    expect(tagOfSession(keys![K.session])!.id).toBe(copy);
    expect(keys![K.save]).toBe(s.getItem(K.save));
    // A copy of a copy is "(copy)" once.
    const cc = await a.copy(copy);
    expect(a.list().find((g) => g.id === (cc.ok ? cc.value : ""))!.name).toBe("4-gentle-water-none-nocoast (copy)");
    expect(a.rename(one, "  My   line ")).toBe(true);
    expect(a.list().find((g) => g.id === one)!.name).toBe("My line");
    expect(tagOfSession(s.getItem(K.session))!.name).toBe("My line");
    expect(a.rename(one, "   ")).toBe(false);
    a.remove(copy);
    expect(s.getItem(parkedKey(copy))).toBeNull();
    expect(s.getItem(pictureKey(copy))).toBeNull();
    expect(a.list().map((g) => g.id)).not.toContain(copy);
    // The open one: its live keys go, no game open.
    a.remove(one);
    expect(s.getItem(K.save)).toBeNull();
    expect(a.openId).toBeNull();
    expect(a.index().deleted).toEqual(expect.arrayContaining([copy, one]));
  });

  it("refuses a new game or a copy when storage is full, losing nothing", async () => {
    const s = new Store();
    put(s, gameKeys(5, 300));
    const a = store(s);
    a.startUp();
    const one = a.openId!;
    const before = new Map(s.m);
    s.quota = s.used + 50;
    expect(await a.beginNew("No room")).toEqual({ ok: false, error: NO_ROOM });
    expect(new Map(s.m)).toEqual(before);
    expect(await a.copy(one)).toEqual({ ok: false, error: NO_ROOM });
    expect(new Map(s.m)).toEqual(before);
    expect(a.list()).toHaveLength(1);
  });

  it("opening a game that doesn't fit puts the open one back as it was", async () => {
    const s = new Store();
    put(s, gameKeys(6, 400));
    const a = store(s);
    a.startUp();
    const one = a.openId!;
    await a.beginNew("Small");
    const two = a.openId!;
    put(s, { ...gameKeys(7, 10), [K.session]: JSON.stringify({ clock: 1, paused: false, journal: { entries: [], seq: 0, readSeq: 0 }, slot: { id: two, name: "Small" } }) });
    const live = a.liveKeys();
    // Room for the open one parked, but not for the first's bigger keys written in.
    const packed = await packKeys({ ...live, [K.session]: withTag(live[K.session], { id: two, name: "Small" }) });
    s.quota = s.used + parkedKey(two).length + packed.length + 100;
    const res = await a.open(one);
    expect(res).toEqual({ ok: false, error: NO_ROOM });
    expect(a.liveKeys()).toEqual(live);
    expect(a.openId).toBe(two);
    expect(a.isParked(one)).toBe(true);
    expect(a.isParked(two)).toBe(false);
    // With room, it opens.
    s.quota = Infinity;
    expect((await a.open(one)).ok).toBe(true);
    expect(piecesOf(s)).toBe(400);
  });

  it("parks another game's cloud copy and never writes it over the open one", async () => {
    const s = new Store();
    put(s, gameKeys(8, 10));
    const a = store(s, () => 5000);
    a.startUp();
    const one = a.openId!;
    const other = { ...gameKeys(9, 3), [K.session]: JSON.stringify({ clock: 3, paused: false, journal: { entries: [], seq: 0, readSeq: 0 }, slot: { id: "remote1", name: "From the tablet" } }) };
    expect(a.isOther(other)).toBe(true);
    expect(a.isOther(a.liveKeys())).toBe(false);
    // (No tag: an older build's copy, the open game.)
    expect(a.isOther(gameKeys(9, 3))).toBe(false);
    expect(await a.keepOther(other, 9000)).toBe(true);
    expect(a.openId).toBe(one);
    expect(piecesOf(s)).toBe(10);
    expect(a.list()[0]).toMatchObject({ id: "remote1", name: "From the tablet", played: 9000 });
    // An older copy of it doesn't replace the one here; a deleted game's isn't taken back.
    const parked = s.getItem(parkedKey("remote1"));
    await a.keepOther({ ...other, [K.save]: gameKeys(9, 1)[K.save] }, 8000);
    expect(s.getItem(parkedKey("remote1"))).toBe(parked);
    a.remove("remote1");
    await a.keepOther(other, 10000);
    expect(a.isParked("remote1")).toBe(false);
    expect(a.list().map((g) => g.id)).toEqual([one]);
  });

  it("start-up mends: a cloud game in the live keys is added, and keys cleared under it leave no entry", () => {
    const s = new Store();
    put(s, gameKeys(10, 2));
    s.setItem(K.session, JSON.stringify({ clock: 0, paused: false, journal: { entries: [], seq: 0, readSeq: 0 }, slot: { id: "zz", name: "Elsewhere" } }));
    const a = store(s);
    a.startUp();
    expect(a.openId).toBe("zz");
    expect(a.list()[0].name).toBe("Elsewhere");
    for (const k of K.live) s.removeItem(k);
    a.startUp();
    expect(a.openId).toBeNull();
    expect(a.list()).toEqual([]);
  });

  it("notes the open game's play time, goals and coins, writing only a change", () => {
    const s = new Store();
    put(s, gameKeys(11, 3));
    const a = store(s);
    a.startUp();
    a.noteOpen({ addMs: 60_000, played: 2000 });
    expect(a.openEntry()).toMatchObject({ playMs: 60_000, played: 2000, goals: 3, coins: 30 });
    const index = s.getItem(GAMES_INDEX_KEY);
    s.setItem(GAMES_INDEX_KEY, index!);
    a.noteOpen();
    expect(s.getItem(GAMES_INDEX_KEY)).toBe(index);
    expect(a.setPicture(a.openId!, "data:image/webp;base64," + "A".repeat(20_000))).toBe(false);
  });
});
