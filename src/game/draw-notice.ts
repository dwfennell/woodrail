import { DRAW_LOOKAHEAD, type DrawLine, type PieceTypeId } from "../track";

/** The finger this far (mm) on with the line not growing (and nothing in its way): it's stuck (see `DrawNotice`). */
export const STALL_MM = 2 * DRAW_LOOKAHEAD + 100;
/**
 * Stuck, mid-stroke, it says so only once the finger has gone on this much further (mm) with the line still stuck: a
 * hitch the line gets past (QA: "Too sharp" on dead-straight strokes that then connected) says nothing. Stuck when
 * the finger lifts, it's said then.
 */
export const STALL_HOLD = 150;

export const TOO_SHARP = "Too sharp: draw a wider bend";

/**
 * What a drawn line says as it goes and when the finger lifts (DrawHand's toasts): stuck behind the finger ("Too
 * sharp", or which piece it needed and may not use), the piece it stopped at, or a piece it had to do without. Once a
 * stroke for being stuck. Pure: what to say is returned, for DrawHand to toast.
 */
export class DrawNotice {
  private told = false;
  /** How far the finger has gone (mm) since the line last grew, and in all; where it was; how far in all when it stuck. */
  private sinceGrown = 0;
  private travel = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private stuckAt: number | null = null;

  constructor(
    /** What to say of a piece the line needed and may not use: not learned yet, or none left in the box. */
    private readonly outOf: (type: PieceTypeId) => string,
    /** The piece's name for "No … left" (as the tray shows it). */
    private readonly name: (type: PieceTypeId) => string,
    /** A piece not learned yet (Game mode), as the tray says it, or null. */
    private readonly unlearned: (type: PieceTypeId) => string | null = () => null,
  ) {}

  /** A new stroke. */
  start(): void {
    this.told = false;
    this.sinceGrown = 0;
    this.travel = 0;
    this.lastX = NaN;
    this.lastZ = NaN;
    this.stuckAt = null;
  }

  /** The finger moved to `p` (on the ground), the line having had `before` pieces: what to say now, or null. */
  moved(line: DrawLine, p: { x: number; z: number }, before: number): string | null {
    // (Kept as numbers: nothing made on a pointer move.)
    if (!Number.isNaN(this.lastX)) {
      const d = Math.hypot(p.x - this.lastX, p.z - this.lastZ);
      this.sinceGrown += d;
      this.travel += d;
    }
    this.lastX = p.x;
    this.lastZ = p.z;
    // (Grown or taken back: not stuck. Nor while going back over the line.)
    if (line.pieces.length !== before || line.goingBack) this.sinceGrown = 0;
    // Stuck behind the finger (a corner no piece can turn, a circle too tight, or no piece left that fits), not where
    // it's blocked (that ghost shows red): said once a stroke, if it stays stuck a while.
    const stuck = line.stalled || (this.sinceGrown > STALL_MM && !line.stopped && !line.pieces.some((q) => q.blocked));
    if (!stuck) {
      this.stuckAt = null;
      return null;
    }
    this.stuckAt ??= this.travel;
    if (this.told || this.travel - this.stuckAt < STALL_HOLD) return null;
    this.told = true;
    return this.stuckWhy(line);
  }

  /** The finger lifted (the line finished): what to say, or null. `placed`: how many pieces go down. */
  lifted(line: DrawLine, placed: number): string | null {
    // (A closed line has nothing past where it closed: nothing to say.)
    const blocked = line.stopped === "closed" ? null : line.pieces.find((p) => p.blocked)?.blocked;
    if (blocked) return blocked;
    if (line.refused) {
      const why = this.unlearned(line.refused);
      if (why) return why;
      return `No ${this.name(line.refused)} left${placed > 0 ? ": the line used other pieces" : ""}`;
    }
    // Left behind, and not said yet (QA: a tight U-turn laid nothing and said nothing).
    if (!this.told && line.leftBehind) return this.stuckWhy(line);
    return null;
  }

  private stuckWhy(line: DrawLine): string {
    return line.refused ? this.outOf(line.refused) : TOO_SHARP;
  }
}
