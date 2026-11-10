import { MODES, type GameMode } from "../game/modes";
import { parseCode } from "./sync-code";

/**
 * The cloud codes this device has used (its own, made for it, and ones typed in from another device), each with what
 * was last seen of its copies in the cloud: when each mode's was saved, by which save format, and a few words about it
 * ("42 pieces"). Kept in storage, so the title screen can offer "Continue from cloud" without asking the cloud first
 * (`titleOffers`); `CloudSync.refreshKnown` brings it up to date in the background.
 */

/** What was last seen of one mode's copy under a code. */
export interface KnownCopy {
  /** When the game made it (ms). */
  savedAt: number;
  /** Its save format (`SAVE_VERSION`). */
  saveVersion: number;
  /** A few words about it ("42 pieces"), when known. */
  desc?: string;
}

export interface KnownCode {
  code: string;
  /** When this device last used it (made it, typed it in, synced with it: ms). */
  usedAt: number;
  modes: Partial<Record<GameMode, KnownCopy>>;
}

export const KNOWN_KEY = "woodrail.cloud.known.v1";
/** At most this many codes are remembered (the most recently used). */
export const MAX_KNOWN = 5;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class KnownCodes {
  private list_: KnownCode[];

  constructor(private readonly storage: Store) {
    this.list_ = read(storage);
  }

  /** The codes, the most recently used first. */
  list(): readonly KnownCode[] {
    return this.list_;
  }

  get(code: string): KnownCode | null {
    return this.list_.find((k) => k.code === code) ?? null;
  }

  /** The code is the one in use now (made, typed in, or synced with at start): first on the list. */
  used(code: string, now: number): void {
    const k = this.entry(code);
    k.usedAt = now;
    this.write();
  }

  /** A mode's copy under the code, as seen now (an upload's answer, a check's, a copy taken). Null: none there. */
  saw(code: string, mode: GameMode, copy: { savedAt: number; saveVersion: number; desc?: string } | null): void {
    const k = this.get(code);
    if (!k) return;
    const was = k.modes[mode];
    if (copy === null) {
      if (!was) return;
      delete k.modes[mode];
    } else {
      // (The words stay from before when the new sight hasn't any: a check sees only when, not what.)
      const desc = copy.desc ?? (was && was.savedAt === copy.savedAt ? was.desc : undefined);
      if (was && was.savedAt === copy.savedAt && was.saveVersion === copy.saveVersion && was.desc === desc) return;
      k.modes[mode] = { savedAt: copy.savedAt, saveVersion: copy.saveVersion, ...(desc ? { desc } : {}) };
    }
    this.write();
  }

  forget(code: string): void {
    const n = this.list_.length;
    this.list_ = this.list_.filter((k) => k.code !== code);
    if (this.list_.length !== n) this.write();
  }

  forgetAll(): void {
    this.list_ = [];
    try {
      this.storage.removeItem(KNOWN_KEY);
    } catch {
      // (gone anyway)
    }
  }

  private entry(code: string): KnownCode {
    let k = this.get(code);
    if (!k) {
      k = { code, usedAt: 0, modes: {} };
      this.list_.push(k);
    }
    return k;
  }

  private write(): void {
    this.list_.sort((a, b) => b.usedAt - a.usedAt);
    this.list_ = this.list_.slice(0, MAX_KNOWN);
    try {
      this.storage.setItem(KNOWN_KEY, JSON.stringify(this.list_));
    } catch {
      // No room: remembered till the page closes.
    }
  }
}

function read(storage: Store): KnownCode[] {
  try {
    const raw = storage.getItem(KNOWN_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(v)) return [];
    const out: KnownCode[] = [];
    for (const k of v as Partial<KnownCode>[]) {
      if (!k || typeof k.code !== "string" || parseCode(k.code) !== k.code) continue;
      const modes: KnownCode["modes"] = {};
      for (const m of MODES) {
        const c = k.modes?.[m];
        if (c && typeof c.savedAt === "number" && typeof c.saveVersion === "number") modes[m] = { savedAt: c.savedAt, saveVersion: c.saveVersion, ...(typeof c.desc === "string" ? { desc: c.desc.slice(0, 60) } : {}) };
      }
      out.push({ code: k.code, usedAt: typeof k.usedAt === "number" ? k.usedAt : 0, modes });
    }
    return out.sort((a, b) => b.usedAt - a.usedAt).slice(0, MAX_KNOWN);
  } catch {
    return [];
  }
}

/** A railway in the cloud the title screen offers to carry on with. */
export interface TitleOffer {
  code: string;
  mode: GameMode;
  savedAt: number;
  desc?: string;
  /** Under the code this device syncs with now (its newer copy, from another device), or one used before. */
  current: boolean;
  /** Saved by a newer game than this one: shown, but it can't be opened till the game updates. */
  newer: boolean;
}

/** What the device knows of the code it syncs with now, for `titleOffers`. */
export interface CurrentCode {
  code: string;
  modes: Record<GameMode, { /** The copy it last sent or took (its savedAt; 0: none). */ remoteSavedAt: number; /** It has a railway of its own for the mode. */ here: boolean }>;
}

/** At most this many offers on the title (the newest). */
export const MAX_OFFERS = 3;

/**
 * The cloud railways the title offers, newest first: under the current code, a mode's copy that's newer than the one
 * this device last had (another device's, not yet taken: the start-up check was cut off, or offline), or one this
 * device hasn't a railway of its own for; under a code used before, each mode's copy. What Continue would load anyway
 * isn't offered.
 */
export function titleOffers(known: readonly KnownCode[], current: CurrentCode | null, saveVersion: number): TitleOffer[] {
  const out: TitleOffer[] = [];
  for (const k of known) {
    const isCurrent = current?.code === k.code;
    for (const mode of MODES) {
      const c = k.modes[mode];
      if (!c) continue;
      if (isCurrent) {
        const m = current!.modes[mode];
        if (m.here && c.savedAt <= m.remoteSavedAt) continue;
      }
      out.push({ code: k.code, mode, savedAt: c.savedAt, ...(c.desc ? { desc: c.desc } : {}), current: isCurrent, newer: c.saveVersion > saveVersion });
    }
  }
  return out.sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_OFFERS);
}

/** When a copy was saved, in a few words: "just now", "5 min ago", "today at 3:40 pm", "3 Nov". */
export function savedWhen(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const d = new Date(at);
  const today = new Date(now);
  if (d.toDateString() === today.toDateString()) return `today at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** A short description of a mode's railway from its keys as stored (its autosave first): "42 pieces". */
export function describeRailway(save: string | null | undefined): string | undefined {
  if (!save) return undefined;
  try {
    const d = JSON.parse(save) as { pieces?: unknown[] };
    if (!Array.isArray(d.pieces)) return undefined;
    const n = d.pieces.length;
    return n === 1 ? "1 piece" : `${n} pieces`;
  } catch {
    return undefined;
  }
}
