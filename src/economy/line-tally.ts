/**
 * How much each line has carried lately: goods unloaded from its trains, over the last `window` ticks (a game month for
 * the Lines list). Kept as a few buckets a line, so a count costs nothing per frame and nothing grows: a load unloaded
 * adds one to the line's current bucket; buckets older than the window are dropped as time moves on.
 */
export class LineTally {
  private readonly lines = new Map<number, { start: number; counts: number[] }>();
  private readonly bucket: number;

  constructor(
    /** The span counted, in ticks. */
    readonly window: number,
    private readonly buckets = 6,
  ) {
    this.bucket = Math.max(1, Math.ceil(window / buckets));
  }

  /** One load unloaded by a train on line `lineId`, at tick `tick`. */
  add(lineId: number, tick: number, n = 1): void {
    let t = this.lines.get(lineId);
    const at = Math.floor(tick / this.bucket);
    if (!t) this.lines.set(lineId, (t = { start: at, counts: [] }));
    this.roll(t, at);
    t.counts[t.counts.length - 1] += n;
  }

  /** Loads unloaded on line `lineId` in the window up to tick `tick` (the current bucket, part done, and the rest). */
  count(lineId: number, tick: number): number {
    const t = this.lines.get(lineId);
    if (!t) return 0;
    const at = Math.floor(tick / this.bucket);
    const first = at - this.buckets + 1;
    let n = 0;
    t.counts.forEach((c, i) => {
      const b = t.start + i;
      if (b >= first && b <= at) n += c;
    });
    return n;
  }

  /** Forget lines not in `keep`. */
  prune(keep: ReadonlySet<number>): void {
    for (const id of this.lines.keys()) if (!keep.has(id)) this.lines.delete(id);
  }

  /** Move a line's buckets on to bucket `at`, dropping those past the window. */
  private roll(t: { start: number; counts: number[] }, at: number): void {
    const last = t.start + t.counts.length - 1;
    if (t.counts.length === 0) {
      t.start = at;
      t.counts.push(0);
      return;
    }
    if (at <= last) return;
    for (let b = last + 1; b <= at && b - last <= this.buckets; b++) t.counts.push(0);
    if (at - last > this.buckets) {
      t.start = at;
      t.counts = [0];
      return;
    }
    while (t.counts.length > this.buckets) {
      t.counts.shift();
      t.start++;
    }
    // (Buckets skipped when more than one went by: those pushed above are empty, and the start follows the shift.)
    t.start = at - t.counts.length + 1;
  }
}
