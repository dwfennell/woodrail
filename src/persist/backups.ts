/**
 * Backups of Game-mode games (spec docs/superpowers/specs/2026-11-26-save-safety.md, layer 1): the last few good copies
 * of each game's keys, kept beside Your games (`slots.ts`), so a bug that writes over a game, or loads it lossily,
 * can't lose it. ☰ Your games, Earlier versions, lists them and restores one.
 *
 * A copy is taken each time a game loads cleanly (`load`; the first of a day is that day's, `day`), when the write
 * guard keeps a railway it wouldn't write over (`kept`), and before a restore replaces a game (`replaced`). It's the
 * game's keys gzipped and base64'd as a parked game's are, written, read back and unpacked: it counts (is listed) only
 * when what comes back is byte for byte what was given. Copies are keyed by the game's id, bounded per game
 * (`KEEP`) and in all (`BACKUP_BUDGET`), the least precious going first.
 */
import { packKeys, unpackKeys, type SlotKeys, type SlotStorage } from "./slots";

export const BACKUPS_INDEX_KEY = "woodrail.games.backups.v1";
export const backupDataKey = (gameId: string, n: number): string => `woodrail.games.backup.${gameId}.${n}`;

export type BackupKind = "load" | "day" | "kept" | "replaced";

export interface Backup {
  /** Its number within its game (its key's: `backupDataKey`). */
  n: number;
  /** When it was taken (ms). */
  at: number;
  kind: BackupKind;
  trains: number;
  pieces: number;
  coins: number;
  /** Its size as stored (chars). */
  chars: number;
  /** A hash of its keys (`keysHash`), to tell a copy the same as the last, and one that came back wrong. */
  hash: string;
}

/** Copies kept of each kind, per game. */
export const KEEP: Readonly<Record<BackupKind, number>> = { load: 3, day: 4, kept: 2, replaced: 2 };
/** All games' copies together stay under this (chars): about a quarter of a phone's 5 M char localStorage. */
export const BACKUP_BUDGET = 1_200_000;
/** Which kinds go first when there's no room: the most often taken first. */
const LET_GO: readonly BackupKind[] = ["load", "day", "replaced", "kept"];

type Keys = Record<string, string>;
type Index = Record<string, Backup[]>;

/** A short hash of a game's keys (FNV-1a over their JSON, hex). */
export function keysHash(keys: Readonly<Keys>): string {
  const text = JSON.stringify(Object.keys(keys).sort().map((k) => [k, keys[k]]));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(16)}-${text.length}`;
}

/** The local day of a time ("2026-11-26"), for a day's copy. */
const dayOf = (t: number): string => {
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};

export class BackupStore {
  constructor(
    private readonly storage: SlotStorage,
    private readonly keys: SlotKeys,
    private readonly now: () => number = () => Date.now(),
    readonly budget = BACKUP_BUDGET,
  ) {}

  private index(): Index {
    try {
      const v = JSON.parse(this.storage.getItem(BACKUPS_INDEX_KEY) ?? "{}") as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) return {};
      const out: Index = {};
      const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
      for (const [id, list] of Object.entries(v as Record<string, unknown>)) {
        if (!Array.isArray(list)) continue;
        out[id] = list.flatMap((b: Partial<Backup>) =>
          b && typeof b.n === "number" && typeof b.hash === "string" && LET_GO.includes(b.kind as BackupKind)
            ? [{ n: b.n, at: num(b.at), kind: b.kind as BackupKind, trains: num(b.trains), pieces: num(b.pieces), coins: num(b.coins), chars: num(b.chars), hash: b.hash }]
            : [],
        );
      }
      return out;
    } catch {
      return {};
    }
  }

  private writeIndex(i: Index): boolean {
    for (const id of Object.keys(i)) if (i[id].length === 0) delete i[id];
    try {
      if (Object.keys(i).length === 0) {
        this.storage.removeItem(BACKUPS_INDEX_KEY);
        return true;
      }
      this.storage.setItem(BACKUPS_INDEX_KEY, JSON.stringify(i));
      return true;
    } catch {
      return false;
    }
  }

  /** A game's copies, the newest first. */
  list(gameId: string): Backup[] {
    return [...(this.index()[gameId] ?? [])].sort((a, b) => b.at - a.at || b.n - a.n);
  }

  /** All games' copies' size as stored (chars). */
  totalChars(): number {
    return Object.values(this.index()).reduce((a, l) => a + l.reduce((s, b) => s + b.chars, 0), 0);
  }

  /** The facts a copy is listed with, from its keys. */
  private factsOf(keys: Readonly<Keys>): Pick<Backup, "trains" | "pieces" | "coins"> {
    let trains = 0;
    let pieces = 0;
    let coins = 0;
    try {
      const s = JSON.parse(keys[this.keys.save] ?? "null") as { trains?: unknown[]; pieces?: unknown[] } | null;
      trains = Array.isArray(s?.trains) ? s.trains.length : 0;
      pieces = Array.isArray(s?.pieces) ? s.pieces.length : 0;
    } catch {
      // (not a railway that reads: listed with none)
    }
    try {
      const c = (JSON.parse(keys[this.keys.progress] ?? "null") as { coins?: unknown } | null)?.coins;
      coins = typeof c === "number" && Number.isFinite(c) ? c : 0;
    } catch {
      // none
    }
    return { trains, pieces, coins };
  }

  /**
   * A copy of a game's keys taken, read back and checked. A `load` copy the same as the game's newest copy isn't
   * taken again (that one's given back); the first of a day is that day's (`day`). The copy, or null when it couldn't
   * be kept (no room, or it didn't come back as given: then nothing of it is left).
   */
  async take(gameId: string, keys: Readonly<Keys>, kind: "load" | "kept" | "replaced"): Promise<Backup | null> {
    const own: Keys = {};
    for (const k of this.keys.live) if (typeof keys[k] === "string") own[k] = keys[k];
    if (own[this.keys.save] === undefined) return null;
    const hash = keysHash(own);
    const before = this.list(gameId);
    const t = this.now();
    if (kind === "load" && before[0]?.hash === hash) return before[0];
    const as: BackupKind = kind === "load" && !before.some((b) => b.kind === "day" && dayOf(b.at) === dayOf(t)) ? "day" : kind;
    const packed = await packKeys(own);
    const n = Math.max(0, ...before.map((b) => b.n)) + 1;
    const key = backupDataKey(gameId, n);
    if (!this.put(key, packed, gameId, n)) return null;
    // Good only once read back: the stored text as written, and its keys unpacked byte for byte as given.
    const back = this.get(key);
    const keysBack = back === packed ? await unpackKeys(back) : null;
    if (!keysBack || keysHash(keysBack) !== hash || Object.keys(own).some((k) => keysBack[k] !== own[k])) {
      this.remove1(key);
      return null;
    }
    const b: Backup = { n, at: t, kind: as, ...this.factsOf(own), chars: packed.length, hash };
    const i = this.index();
    i[gameId] = [...(i[gameId] ?? []), b];
    if (!this.writeIndex(i)) {
      this.remove1(key);
      return null;
    }
    this.prune(gameId);
    this.fitBudget({ gameId, n });
    return b;
  }

  /** A copy's keys, checked against its hash, or null (gone, or it doesn't read back as it was taken). */
  async read(gameId: string, n: number): Promise<Keys | null> {
    const b = this.list(gameId).find((x) => x.n === n);
    const packed = b ? this.get(backupDataKey(gameId, n)) : null;
    const keys = packed === null ? null : await unpackKeys(packed);
    return keys && b && keysHash(keys) === b.hash ? keys : null;
  }

  /** A game's copies all let go (the game deleted). */
  removeGame(gameId: string): void {
    const i = this.index();
    for (const b of i[gameId] ?? []) this.remove1(backupDataKey(gameId, b.n));
    delete i[gameId];
    this.writeIndex(i);
  }

  /**
   * The least precious copy let go, to make room for a save (an autosave that didn't fit). Never a game's last copy.
   * False when there's none to let go.
   */
  freeOne(): boolean {
    const pick = this.leastPrecious(null, true);
    if (!pick) return false;
    this.drop(pick.gameId, pick.n);
    return true;
  }

  /** Each kind's copies past `KEEP` let go, the oldest first. */
  private prune(gameId: string): void {
    const list = this.list(gameId);
    for (const kind of LET_GO) {
      const of = list.filter((b) => b.kind === kind);
      for (const b of of.slice(KEEP[kind])) this.drop(gameId, b.n);
    }
  }

  /** Copies let go until all fit the budget: never `keep` (the one just taken). */
  private fitBudget(keep: { gameId: string; n: number } | null): void {
    while (this.totalChars() > this.budget) {
      const pick = this.leastPrecious(keep, true) ?? this.leastPrecious(keep, false);
      if (!pick) return;
      this.drop(pick.gameId, pick.n);
    }
  }

  /**
   * The copy to let go first: by kind (`LET_GO`), then the oldest. `spareLast`: never a game's newest copy.
   */
  private leastPrecious(keep: { gameId: string; n: number } | null, spareLast: boolean): { gameId: string; n: number } | null {
    const i = this.index();
    const all: { gameId: string; b: Backup }[] = [];
    for (const [gameId, list] of Object.entries(i)) {
      const newest = [...list].sort((a, b) => b.at - a.at || b.n - a.n)[0];
      for (const b of list) {
        if (keep && keep.gameId === gameId && keep.n === b.n) continue;
        if (spareLast && b === newest) continue;
        all.push({ gameId, b });
      }
    }
    all.sort((x, y) => LET_GO.indexOf(x.b.kind) - LET_GO.indexOf(y.b.kind) || x.b.at - y.b.at);
    return all[0] ? { gameId: all[0].gameId, n: all[0].b.n } : null;
  }

  private drop(gameId: string, n: number): void {
    this.remove1(backupDataKey(gameId, n));
    const i = this.index();
    i[gameId] = (i[gameId] ?? []).filter((b) => b.n !== n);
    this.writeIndex(i);
  }

  /** Write a copy, letting go of others (not this game's newest) while there's no room. False: it didn't fit. */
  private put(key: string, value: string, gameId: string, n: number): boolean {
    for (let tries = 0; tries < 20; tries++) {
      try {
        this.storage.setItem(key, value);
        return true;
      } catch {
        this.remove1(key);
        const pick = this.leastPrecious({ gameId, n }, true);
        if (!pick) return false;
        this.drop(pick.gameId, pick.n);
      }
    }
    return false;
  }

  private get(k: string): string | null {
    try {
      return this.storage.getItem(k);
    } catch {
      return null;
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
