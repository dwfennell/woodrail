/** A label's box on screen (px) and how much it matters (higher wins its spot). */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
}

export interface LabelSpot {
  /** Vertical nudge to apply (px). */
  dy: number;
  /** Still overlapping after every nudge: hide it. */
  hidden: boolean;
}

const GAP = 2;
/** At most this many nudges each way, so the cost stays bounded. */
const MAX_STEPS = 3;

const hits = (a: LabelBox, ay: number, b: LabelBox, by: number): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && ay < by + b.h + GAP && by < ay + a.h + GAP;

/**
 * Keep map labels from covering one another. Labels are settled in priority order (ties: the order given); each
 * takes the smallest vertical offset (0, then down, then up, a label height at a time) that clears the labels already
 * settled, and is hidden when none does. Returns one spot per input, in input order. O(n^2 * steps), n = labels.
 */
export function declutterLabels(boxes: readonly LabelBox[]): LabelSpot[] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[b].priority - boxes[a].priority || a - b);
  const out: LabelSpot[] = boxes.map(() => ({ dy: 0, hidden: false }));
  const placed: number[] = [];
  for (const i of order) {
    const b = boxes[i];
    let found = false;
    for (let s = 0; s <= MAX_STEPS * 2 && !found; s++) {
      const dy = s === 0 ? 0 : (s % 2 === 1 ? 1 : -1) * Math.ceil(s / 2) * (b.h + GAP);
      if (placed.every((j) => !hits(b, b.y + dy, boxes[j], boxes[j].y + out[j].dy))) {
        out[i].dy = dy;
        found = true;
      }
    }
    if (found) placed.push(i);
    else out[i].hidden = true;
  }
  return out;
}

/**
 * How far to slide a label sideways to keep it on screen (px): a label `w` wide whose box starts at `left`, on a screen
 * `screenW` wide, kept `margin` in from both edges (the left edge wins if it's wider than the room).
 */
export function edgeNudge(left: number, w: number, screenW: number, margin = 8): number {
  return rangeNudge(left, w, margin, screenW - margin);
}

/** How far to slide something `size` long that starts at `start` to keep it within `lo`..`hi` (`lo` wins if too long). */
export function rangeNudge(start: number, size: number, lo: number, hi: number): number {
  let d = 0;
  if (start + size > hi) d = hi - (start + size);
  if (start + d < lo) d = lo - start;
  return d;
}
