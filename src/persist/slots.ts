/**
 * Game mode's games, side by side ("Your games": spec docs/superpowers/specs/2026-11-16-multiple-saves.md).
 *
 * The open game lives in the keys Game mode always used (`modeKeys("game")` less the device's own flag): the autosave,
 * the cloud, the bug map and the snapshots read it there as before. Which game it is rides in its session key
 * (`slot`: an id and a name), so a cloud copy says which game it is and an older build still reads it. Every other game
 * is parked under a key of its own, its keys gzipped, with a small picture beside it, and an index lists them all.
 *
 * Nothing here loses a game: the open game is parked (and read back) before its keys are written over, and a write
 * that doesn't fit is taken out again, the player told there's no room.
 */
import { err, ok, type Result } from "../lib/result";
import { LEGACY_HILLS } from "../landscape/hills";
import { LEGACY_WATER, mapCode } from "../landscape/water";
import { STARTER_SEED } from "../game/world";
import { fromBase64, gunzip, gzip, toBase64 } from "./cloud";

export const GAMES_INDEX_KEY = "woodrail.games.v1";
export const parkedKey = (id: string): string => `woodrail.games.slot.${id}`;
export const pictureKey = (id: string): string => `woodrail.games.pic.${id}`;
/** A picture's data URL is no longer than this (about 12 KB of image). */
export const PICTURE_MAX_CHARS = 16_000;
/** The longest name. */
export const NAME_MAX = 40;
/** Deleted games remembered (so the cloud never brings one back). */
const DELETED_MAX = 50;

export const NO_ROOM = "No room for another game on this device: delete one in Your games first";
export const UNREADABLE = "That game couldn't be read";

export interface GameEntry {
  id: string;
  name: string;
  /** When it was made (ms). */
  created: number;
  /** When it was last played (ms). */
  played: number;
  /** Time played, in play with the page in view (ms). */
  playMs: number;
  /** Goals done. */
  goals: number;
  coins: number;
}

export interface GamesIndex {
  v: 1;
  /** The game in the live keys (null: none there). */
  open: string | null;
  games: GameEntry[];
  deleted: string[];
}

export interface SlotTag {
  id: string;
  name: string;
}

export type SlotStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Keys = Record<string, string>;

export interface SlotKeys {
  /** The open game's keys, as `modeKeys("game")` has them, less the device's own (`woodrail.game.started`). */
  live: readonly string[];
  /** Of those: the autosave, the session (the tag rides in it), the goals and the progress. */
  save: string;
  session: string;
  goals: string;
  progress: string;
}

const randomId = (): string => Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

/** A game's name from its map: "Starter map" (the first game's), or its map code (what ☰ shows, a seed box takes). */
export function nameOfLand(l: { seed?: unknown; starter?: unknown; hills?: unknown; water?: unknown; coast?: unknown }): string {
  if (typeof l.seed !== "number") return "A railway";
  // (Every Game map is starter-style: only the starter map's own seed is the starter map.)
  if (l.starter && l.seed === STARTER_SEED) return "Starter map";
  return mapCode({ seed: l.seed, hills: (typeof l.hills === "string" ? l.hills : LEGACY_HILLS) as never, water: (typeof l.water === "string" ? l.water : LEGACY_WATER) as never, coast: !!l.coast });
}

/** A game's name from its save (`nameOfLand`). */
export function nameOfSave(raw: string | null | undefined): string {
  try {
    const l = (JSON.parse(raw ?? "null") as { landscape?: Parameters<typeof nameOfLand>[0] } | null)?.landscape;
    return l ? nameOfLand(l) : "A railway";
  } catch {
    return "A railway";
  }
}

export const cleanName = (name: string): string => name.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

/** The tag in a session's JSON, or null. */
export function tagOfSession(raw: string | null | undefined): SlotTag | null {
  if (!raw) return null;
  try {
    const s = (JSON.parse(raw) as { slot?: { id?: unknown; name?: unknown } } | null)?.slot;
    return s && typeof s.id === "string" && s.id.length > 0 ? { id: s.id, name: typeof s.name === "string" ? s.name : "" } : null;
  } catch {
    return null;
  }
}

/** A session's JSON with this tag in it (a session that doesn't read: a fresh one's head, with the tag). */
export function withTag(raw: string | null | undefined, tag: SlotTag): string {
  let s: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(raw ?? "null");
    if (v && typeof v === "object" && !Array.isArray(v)) s = v as Record<string, unknown>;
  } catch {
    // (a fresh one)
  }
  return JSON.stringify({ ...(s ?? { clock: 0, paused: false, journal: { entries: [], seq: 0, readSeq: 0 } }), slot: { id: tag.id, name: tag.name } });
}

export async function packKeys(keys: Keys): Promise<string> {
  return toBase64(await gzip(JSON.stringify(keys)));
}

export async function unpackKeys(packed: string): Promise<Keys | null> {
  try {
    const v = JSON.parse(await gunzip(fromBase64(packed))) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const out: Keys = {};
    for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
    return out;
  } catch {
    return null;
  }
}

export class SlotStore {
  constructor(
    private readonly storage: SlotStorage,
    readonly keys: SlotKeys,
    private readonly now: () => number = () => Date.now(),
    private readonly newId: () => string = randomId,
  ) {}

  /** The index as stored (an empty one if there's none or it doesn't read). */
  index(): GamesIndex {
    return this.readIndex() ?? { v: 1, open: null, games: [], deleted: [] };
  }

  private readIndex(): GamesIndex | null {
    try {
      const raw = this.storage.getItem(GAMES_INDEX_KEY);
      if (raw === null) return null;
      const v = JSON.parse(raw) as Partial<GamesIndex> | null;
      if (!v || v.v !== 1 || !Array.isArray(v.games)) return null;
      const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
      const games = v.games.flatMap((g: Partial<GameEntry>) =>
        g && typeof g.id === "string" && g.id ? [{ id: g.id, name: typeof g.name === "string" ? g.name : "A railway", created: num(g.created), played: num(g.played), playMs: num(g.playMs), goals: num(g.goals), coins: num(g.coins) }] : [],
      );
      const open = typeof v.open === "string" ? v.open : null;
      return { v: 1, open, games, deleted: Array.isArray(v.deleted) ? v.deleted.filter((d): d is string => typeof d === "string") : [] };
    } catch {
      return null;
    }
  }

  private writeIndex(i: GamesIndex): boolean {
    try {
      this.storage.setItem(GAMES_INDEX_KEY, JSON.stringify(i));
      return true;
    } catch {
      return false;
    }
  }

  /** The games, the last played first. */
  list(): GameEntry[] {
    return [...this.index().games].sort((a, b) => b.played - a.played);
  }

  get openId(): string | null {
    return this.index().open;
  }

  /** The open game's entry, or null. */
  openEntry(): GameEntry | null {
    const i = this.index();
    return i.games.find((g) => g.id === i.open) ?? null;
  }

  /** The open game's tag (for its session as it's saved), or null. */
  openTag(): SlotTag | null {
    const e = this.openEntry();
    return e ? { id: e.id, name: e.name } : null;
  }

  /** Is a game parked here (not open)? */
  isParked(id: string): boolean {
    return this.get(parkedKey(id)) !== null;
  }

  /**
   * At start-up: the index made or mended from what's in the live keys. No index and a Game save: that save becomes
   * game 1 (its keys as they are, but for the tag in its session). Live keys with no tag are the open game's; a tag
   * the index doesn't list (a game from the cloud) is added. No save there: no game open.
   */
  startUp(): void {
    const had = this.readIndex();
    const i = had ?? { v: 1 as const, open: null, games: [], deleted: [] };
    const before = JSON.stringify(i);
    const raw = this.get(this.keys.save);
    if (raw !== null) {
      const session = this.get(this.keys.session);
      const tag = tagOfSession(session);
      const id = tag?.id ?? i.open ?? this.freshId(i);
      let e = i.games.find((g) => g.id === id);
      if (!e) {
        const t = this.now();
        e = { id, name: cleanName(tag?.name || nameOfSave(raw)) || "A railway", created: t, played: t, playMs: 0, ...this.factsOf((k) => this.get(k)) };
        i.games.push(e);
      }
      i.deleted = i.deleted.filter((d) => d !== id);
      i.open = id;
      // (A parked copy of the open game is an old one: the live keys are the game.)
      if (this.isParked(id)) this.remove1(parkedKey(id));
      if (!tag || tag.id !== id || tag.name !== e.name) this.set1(this.keys.session, withTag(session, { id, name: e.name }));
    } else if (i.open !== null) {
      const id = i.open;
      i.open = null;
      if (!this.isParked(id)) i.games = i.games.filter((g) => g.id !== id);
    }
    // Entries with no game behind them go (a parked key cleared by hand).
    i.games = i.games.filter((g) => g.id === i.open || this.isParked(g.id));
    if (!had || JSON.stringify(i) !== before) this.writeIndex(i);
  }

  private freshId(i: GamesIndex): string {
    for (;;) {
      const id = this.newId();
      if (!i.games.some((g) => g.id === id) && !i.deleted.includes(id) && !this.isParked(id)) return id;
    }
  }

  /** The goals done and coins, from a game's keys. */
  private factsOf(get: (k: string) => string | null | undefined): { goals: number; coins: number } {
    let goals = 0;
    let coins = 0;
    try {
      const g: unknown = JSON.parse(get(this.keys.goals) ?? "[]");
      goals = Array.isArray(g) ? g.length : 0;
    } catch {
      // none
    }
    try {
      const c = (JSON.parse(get(this.keys.progress) ?? "null") as { coins?: unknown } | null)?.coins;
      coins = typeof c === "number" && Number.isFinite(c) ? c : 0;
    } catch {
      // none
    }
    return { goals, coins };
  }

  /** The open game's keys as they're stored now. */
  liveKeys(): Keys {
    const out: Keys = {};
    for (const k of this.keys.live) {
      const v = this.get(k);
      if (v !== null) out[k] = v;
    }
    return out;
  }

  /** Write a game's keys into the live keys (a key it hasn't is removed). Throws when they don't fit. */
  private writeLive(keys: Keys): void {
    for (const k of this.keys.live) {
      const v = keys[k];
      if (v === undefined) this.storage.removeItem(k);
      else this.storage.setItem(k, v);
    }
  }

  /** Put the live keys back as they were (after a write that didn't fit). */
  private restoreLive(keys: Keys): void {
    try {
      this.writeLive(keys);
    } catch {
      // (They were there a moment ago, so they fit, but for what was written since: the parked copy keeps it.)
    }
  }

  /**
   * Park the open game: its keys zipped under its own key (read back to check). Its live keys stay (whoever's next
   * writes over them). True when it's safe (or there's nothing to park), false when it didn't fit.
   */
  async park(): Promise<boolean> {
    const i = this.index();
    const id = i.open;
    const live = this.liveKeys();
    if (id === null || live[this.keys.save] === undefined) return true;
    const e = i.games.find((g) => g.id === id);
    if (e) Object.assign(e, this.factsOf((k) => live[k]));
    live[this.keys.session] = withTag(live[this.keys.session], { id, name: e?.name ?? nameOfSave(live[this.keys.save]) });
    const packed = await packKeys(live);
    try {
      this.storage.setItem(parkedKey(id), packed);
    } catch {
      this.remove1(parkedKey(id));
      return false;
    }
    if (this.get(parkedKey(id)) !== packed) return false;
    this.writeIndex(i);
    return true;
  }

  /**
   * Open a parked game: the open one parked first, then this one's keys written into the live keys (and its parked copy
   * let go). The page should start again on them (`reloadInto`).
   */
  async open(id: string): Promise<Result<void, string>> {
    const i0 = this.index();
    if (i0.open === id) return ok(undefined);
    const packed = this.get(parkedKey(id));
    const keys = packed === null ? null : await unpackKeys(packed);
    if (!keys || keys[this.keys.save] === undefined) return err(UNREADABLE);
    const leaving = i0.open;
    const before = this.liveKeys();
    const wasParked = leaving !== null && this.isParked(leaving);
    if (!(await this.park())) return err(NO_ROOM);
    const i = this.index();
    const e = i.games.find((g) => g.id === id);
    const name = e?.name ?? (tagOfSession(keys[this.keys.session])?.name || nameOfSave(keys[this.keys.save]));
    keys[this.keys.session] = withTag(keys[this.keys.session], { id, name });
    try {
      this.writeLive(keys);
    } catch {
      this.restoreLive(before);
      if (leaving !== null && !wasParked) this.remove1(parkedKey(leaving));
      return err(NO_ROOM);
    }
    this.remove1(parkedKey(id));
    i.open = id;
    if (e) e.played = this.now();
    else i.games.push({ id, name, created: this.now(), played: this.now(), playMs: 0, ...this.factsOf((k) => keys[k]) });
    this.writeIndex(i);
    return ok(undefined);
  }

  /**
   * A new game: the open one parked, the live keys cleared but for the new game's tag. Its id, or why not (no room:
   * nothing changed). The caller then makes its map and saves it into the live keys, as a new game always did.
   */
  async beginNew(name: string): Promise<Result<string, string>> {
    if (!(await this.park())) return err(NO_ROOM);
    const i = this.index();
    const id = this.freshId(i);
    const t = this.now();
    const clean = cleanName(name) || "A railway";
    i.games.push({ id, name: clean, created: t, played: t, playMs: 0, goals: 0, coins: 0 });
    i.open = id;
    for (const k of this.keys.live) this.remove1(k);
    this.set1(this.keys.session, withTag(null, { id, name: clean }));
    if (!this.writeIndex(i)) return err(NO_ROOM);
    return ok(id);
  }

  /** A copy of a game, parked beside it ("… (copy)"), its picture too. Its id, or why not (nothing changed). */
  async copy(id: string): Promise<Result<string, string>> {
    const i = this.index();
    const src = i.games.find((g) => g.id === id);
    if (!src) return err(UNREADABLE);
    let keys: Keys | null;
    if (i.open === id) keys = this.liveKeys();
    else {
      const packed = this.get(parkedKey(id));
      keys = packed === null ? null : await unpackKeys(packed);
    }
    if (!keys || keys[this.keys.save] === undefined) return err(UNREADABLE);
    const copyId = this.freshId(i);
    const name = cleanName(`${src.name.replace(/ \(copy\)$/, "").slice(0, NAME_MAX - 7)} (copy)`);
    keys[this.keys.session] = withTag(keys[this.keys.session], { id: copyId, name });
    const packed = await packKeys(keys);
    try {
      this.storage.setItem(parkedKey(copyId), packed);
      const pic = this.get(pictureKey(id));
      if (pic !== null) this.storage.setItem(pictureKey(copyId), pic);
    } catch {
      this.remove1(parkedKey(copyId));
      this.remove1(pictureKey(copyId));
      return err(NO_ROOM);
    }
    const t = this.now();
    i.games.push({ ...src, ...this.factsOf((k) => keys[k]), id: copyId, name, created: t, played: t });
    if (!this.writeIndex(i)) {
      this.remove1(parkedKey(copyId));
      this.remove1(pictureKey(copyId));
      return err(NO_ROOM);
    }
    return ok(copyId);
  }

  /** A game renamed (an empty name: nothing). Its tag too, when it's the open one. */
  rename(id: string, name: string): boolean {
    const clean = cleanName(name);
    const i = this.index();
    const e = i.games.find((g) => g.id === id);
    if (!e || !clean) return false;
    e.name = clean;
    if (i.open === id) this.set1(this.keys.session, withTag(this.get(this.keys.session), { id, name: clean }));
    return this.writeIndex(i);
  }

  /** A game deleted (the caller asked first): its parked copy and picture, or the live keys for the open one. */
  remove(id: string): void {
    const i = this.index();
    if (i.open === id) {
      for (const k of this.keys.live) this.remove1(k);
      i.open = null;
    }
    this.remove1(parkedKey(id));
    this.remove1(pictureKey(id));
    i.games = i.games.filter((g) => g.id !== id);
    i.deleted = [...i.deleted.filter((d) => d !== id), id].slice(-DELETED_MAX);
    this.writeIndex(i);
  }

  /** The open game's entry brought up to date (played, time played; goals and coins from its keys). Written only if changed. */
  noteOpen(facts: { played?: number; addMs?: number } = {}): void {
    const i = this.index();
    const e = i.games.find((g) => g.id === i.open);
    if (!e) return;
    const before = JSON.stringify(e);
    Object.assign(e, this.factsOf((k) => this.get(k)));
    if (facts.played !== undefined) e.played = facts.played;
    if (facts.addMs) e.playMs += Math.max(0, Math.round(facts.addMs));
    if (JSON.stringify(e) !== before) this.writeIndex(i);
  }

  /** A game's picture (a data URL), or null. */
  picture(id: string): string | null {
    return this.get(pictureKey(id));
  }

  /** Keep a game's picture (one too big, or with no room: not kept). */
  setPicture(id: string, url: string): boolean {
    if (url.length > PICTURE_MAX_CHARS || !url.startsWith("data:image/")) return false;
    try {
      this.storage.setItem(pictureKey(id), url);
      return true;
    } catch {
      return false;
    }
  }

  // The cloud's side (`CloudSync`'s `slots`): one game syncs, the open one, and a copy of another is parked here.

  /** Is this bundle's game another game than the open one? (No tag: an older build's copy, taken as the open game.) */
  isOther(keys: Readonly<Record<string, string | null | undefined>>): boolean {
    const tag = tagOfSession(keys[this.keys.session]);
    return !!tag && tag.id !== this.index().open;
  }

  /**
   * Another game's copy from the cloud, parked here as that game (added, or its parked copy replaced if the cloud's is
   * the later). A deleted game's is let be. True when it's done with (kept or not wanted), false: try again later.
   */
  async keepOther(keys: Keys, savedAt: number): Promise<boolean> {
    const tag = tagOfSession(keys[this.keys.session]);
    if (!tag || keys[this.keys.save] === undefined) return true;
    const i = this.index();
    if (i.deleted.includes(tag.id) || i.open === tag.id) return true;
    const e = i.games.find((g) => g.id === tag.id);
    if (e && e.played >= savedAt && this.isParked(tag.id)) return true;
    const packed = await packKeys(keys);
    try {
      this.storage.setItem(parkedKey(tag.id), packed);
    } catch {
      return false;
    }
    const facts = this.factsOf((k) => keys[k]);
    if (e) Object.assign(e, facts, { played: savedAt });
    else i.games.push({ id: tag.id, name: cleanName(tag.name) || nameOfSave(keys[this.keys.save]), created: savedAt, played: savedAt, playMs: 0, ...facts });
    this.writeIndex(i);
    return true;
  }

  private get(k: string): string | null {
    try {
      return this.storage.getItem(k);
    } catch {
      return null;
    }
  }

  private set1(k: string, v: string): void {
    try {
      this.storage.setItem(k, v);
    } catch {
      // (no room: mended at the next start)
    }
  }

  private remove1(k: string): void {
    try {
      this.storage.removeItem(k);
    } catch {
      // gone anyway
    }
  }
}
