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
  /** Several spots to frame together (new houses, a connection's two stations); x, z is their centre. */
  points?: { x: number; z: number }[];
}

export interface JournalEntry {
  kind: JournalKind;
  /** What is shown: the quantity worked in, or the merged count ("×5") when the text carries no quantity. */
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
  /** The text for a running quantity (e.g. `(n) => "Delivered " + n + " planks to Larkfield"`). Defaults to `text`.
   * With a `format` the text carries the quantity, so no " (×N)" is added (it would read as a multiple of it). */
  format?: (qty: number, count: number) => string;
}

export interface NoteResult {
  /** Show a toast for it (milestones and refusals). */
  toast: boolean;
  /** The entry it landed in (null for a refusal). */
  entry: JournalEntry | null;
}

/** A journal as saved (`Journal.toJSON`). */
export interface JournalData {
  entries: JournalEntry[];
  seq: number;
  readSeq: number;
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

  /** Now, on the journal's clock (what entries' `time`s are measured against). */
  now(): number {
    return this.clock();
  }

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

  /** Change an entry's text (something joined it): it counts as news again and moves to the top, like a merge. */
  amend(entry: JournalEntry, text: string): void {
    const i = this.list.indexOf(entry);
    if (i < 0) return;
    entry.text = text;
    entry.seq = ++this.seq;
    this.list.splice(i, 1);
    this.list.unshift(entry);
  }

  clear(): void {
    this.list = [];
    this.seq = 0;
    this.readSeq = 0;
  }

  /** The entries and what's been read, to save beside the railway. */
  toJSON(): JournalData {
    return { entries: this.list.map((e) => ({ ...e })), seq: this.seq, readSeq: this.readSeq };
  }

  /** Back as saved (`toJSON`): newest first, no more than the cap. */
  restore(data: JournalData): void {
    this.list = data.entries.slice(0, this.cap).map((e) => ({ ...e }));
    this.seq = Math.max(data.seq, ...this.list.map((e) => e.seq));
    this.readSeq = Math.min(data.readSeq, this.seq);
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
      old.text = input.format ? format(old.qty, old.count) : shown(format(old.qty, old.count), old.count);
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
