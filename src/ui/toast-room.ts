/** A box on screen (px). */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A label on the map view: a badge is a small tappable icon (a ruin's), the worst thing for a toast to hide. */
export interface Label extends Box {
  badge?: boolean;
}

/** Where a toast goes: its middle across, and its top. */
export interface Spot {
  x: number;
  top: number;
}

/** Kept between a toast and a label (a shown toast is tilted 0.8°: its corners reach a couple of px further). */
const MARGIN = 4;
/** Kept from the sides of the screen. */
const SIDE = 8;

/**
 * The middles a toast `w` wide can take across `area`: in the middle, at the left, at the right, then just clear of
 * each label's side (beside a badge in a strip that's otherwise free). On screen, each once.
 */
function middles(w: number, area: Box, labels: readonly Label[]): number[] {
  const lo = area.left + SIDE + w / 2;
  const hi = area.right - SIDE - w / 2;
  const xs = [(area.left + area.right) / 2, lo, hi];
  for (const q of labels) xs.push(q.left - MARGIN - w / 2 - 1, q.right + MARGIN + w / 2 + 1);
  const out: number[] = [];
  for (const x of xs) {
    if (x < lo - 0.5 || x > hi + 0.5) continue;
    const r = Math.round(x);
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

/**
 * The highest place in `area` where a toast `w` by `h` covers no label: in the middle if it's as high there, else at a
 * side or beside a label. Null if there is none. (A few dozen labels: cheap, and asked only when a toast shows.)
 */
export function clearSpot(labels: readonly Label[], w: number, h: number, area: Box): Spot | null {
  if (w + 2 * SIDE > area.right - area.left) return null;
  let best: Spot | null = null;
  for (const x of middles(w, area, labels)) {
    const l = x - w / 2 - MARGIN;
    const r = x + w / 2 + MARGIN;
    const rows = labels.filter((q) => q.right > l && q.left < r).sort((a, b) => a.top - b.top);
    let top = area.top;
    for (const q of rows) {
      if (q.top - MARGIN >= top + h) break;
      top = Math.max(top, q.bottom + MARGIN);
    }
    if (top + h <= area.bottom && (!best || top < best.top)) best = { x, top: Math.round(top) };
  }
  return best;
}

/**
 * With no clear place: the one hiding least, a badge counting far more than a label (a label stays readable and
 * tappable round a toast's edge; a badge is all under it).
 */
export function leastCovered(labels: readonly Label[], w: number, h: number, area: Box): Spot & { cost: number } {
  const tops = new Set([area.top, Math.max(area.top, area.bottom - h)]);
  for (const q of labels) if (q.bottom + MARGIN + h <= area.bottom && q.bottom + MARGIN >= area.top) tops.add(Math.round(q.bottom + MARGIN));
  let best = { x: Math.round((area.left + area.right) / 2), top: area.top, cost: Infinity };
  for (const x of middles(w, area, labels)) {
    for (const top of tops) {
      let cost = 0;
      for (const q of labels) {
        const ow = Math.min(q.right, x + w / 2 + MARGIN) - Math.max(q.left, x - w / 2 - MARGIN);
        const oh = Math.min(q.bottom, top + h + MARGIN) - Math.max(q.top, top - MARGIN);
        if (ow > 0 && oh > 0) cost += q.badge ? 1e6 : ow * oh;
      }
      if (cost < best.cost) best = { x, top, cost };
    }
  }
  return best;
}
