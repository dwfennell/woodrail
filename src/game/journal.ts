/**
 * Game mode's Journal: a short feed of what happened (deliveries, boats, growth) and what was achieved (goals,
 * blueprints, landmarks). Pure data, no DOM. Events are logged quietly (an unread badge, no toast); milestones are
 * logged and still toasted; refusals aren't logged at all.
 */

export type JournalKind = "event" | "milestone";
/** What a caller reports: a refusal is only ever a plain toast, never logged. */
export type NoteKind = JournalKind | "refusal";

export interface JournalPlace {
  x: number;
  z: number;
}

export interface JournalEntry {
  kind: JournalKind;
  /** What is shown, with the merged count ("×5") and quantity worked in. */
  text: string;
  place?: JournalPlace;
  /** When it was added or last merged into (ms on the journal's clock). */
  time: number;
  /** Bursts with the same key within the window merge into one entry. */
  key?: string;
  /** How many reports are in this entry. */
  count: number;
  /** Running quantity (planks delivered, coins, ...) when the report carries one. */
  qty: number;
  /** Counts up with each add or merge: unread means newer than when the News tab was last read. */
  seq: number;
}

export interface NoteInput {
  kind: NoteKind;
  text: string;
  place?: JournalPlace;
  key?: string;
  /** This report's quantity; summed when merged. */
  qty?: number;
  /** The text for a running quantity (e.g. `(n) => "Delivered " + n + " planks to Larkfield"`). Defaults to `text`. */
  format?: (qty: number, count: number) => string;
}

export interface NoteResult {
  /** Show a toast for it (milestones and refusals). */
  toast: boolean;
  /** The entry it landed in (null for a refusal). */
  entry: JournalEntry | null;
}

export const JOURNAL_CAP = 50;
export const MERGE_WINDOW_MS = 60_000;

export class Journal {
  /** Newest first. */
  private list: JournalEntry[] = [];
  private seq = 0;
  private readSeq = 0;

  constructor(
    private readonly clock: () => number = () => performance.now(),
    private readonly cap = JOURNAL_CAP,
    private readonly windowMs = MERGE_WINDOW_MS,
  ) {}

  /** The entries, newest first. */
  get entries(): readonly JournalEntry[] {
    return this.list;
  }

  /** Entries added to or merged into since the News tab was last read. */
  get unread(): number {
    let n = 0;
    for (const e of this.list) if (e.seq > this.readSeq) n++;
    return n;
  }

  markRead(): void {
    this.readSeq = this.seq;
  }

  clear(): void {
    this.list = [];
    this.seq = 0;
    this.readSeq = 0;
  }

  add(input: NoteInput, now = this.clock()): NoteResult {
    if (input.kind === "refusal") return { toast: true, entry: null };
    const toast = input.kind === "milestone";
    const qty = input.qty ?? 0;
    const format = input.format ?? (() => input.text);
    const at = input.key === undefined ? -1 : this.list.findIndex((e) => e.key === input.key && e.kind === input.kind);
    const old = at === -1 ? null : this.list[at];
    if (old && now - old.time <= this.windowMs) {
      this.list.splice(at, 1);
      old.count += 1;
      old.qty += qty;
      old.time = now;
      old.seq = ++this.seq;
      old.text = shown(format(old.qty, old.count), old.count);
      if (input.place) old.place = input.place;
      this.list.unshift(old);
      return { toast, entry: old };
    }
    const entry: JournalEntry = { kind: input.kind, text: format(qty, 1), place: input.place, time: now, key: input.key, count: 1, qty, seq: ++this.seq };
    this.list.unshift(entry);
    if (this.list.length > this.cap) this.list.length = this.cap;
    return { toast, entry };
  }
}

const shown = (text: string, count: number): string => (count > 1 ? `${text} (×${count})` : text);

/** "just now", "2 min ago", "3 h ago": how long ago, for the feed. */
export function ago(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  return `${Math.floor(min / 60)} h ago`;
}
