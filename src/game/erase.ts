/** The eraser (the Clear chip): what to say of what a sweep passed over and left. See `Interaction.setErasing`. */

/**
 * Why something a clearing sweep passed over stays: a station or depot, a train or track it's on, a town's house,
 * a road, a tree of the map's.
 */
export type EraseRefusal = "station" | "train" | "house" | "road" | "tree";

/** (A train and the track it's on are one kind: a standing train shouldn't use up two of the names.) */
const ERASE_REFUSAL_NOUNS: Record<EraseRefusal, string> = { station: "stations and depots", train: "trains and their track", house: "the town's houses", road: "roads", tree: "trees" };

/**
 * What to say, once, when a clearing sweep is lifted, of what it passed over that stays (each kind's first reason): the
 * reason itself if there's one kind, else the kinds together ("Some things stay: stations and depots, trains"). Null if
 * nothing stayed.
 */
export function eraseRefusal(told: ReadonlyMap<EraseRefusal, string>): string | null {
  if (told.size === 0) return null;
  if (told.size === 1) return [...told.values()][0];
  // In one order whatever order the sweep met them in, and at most three named.
  const kinds = ERASE_REFUSAL_ORDER.filter((k) => told.has(k)).map((k) => ERASE_REFUSAL_NOUNS[k]);
  const named = kinds.length > ERASE_NAMED ? [...kinds.slice(0, ERASE_NAMED), `and ${kinds.length - ERASE_NAMED} more`] : kinds;
  return `Some things stay: ${named.join(", ")}`;
}

/** The order the kinds are named in (the ones a player most likely meant to clear first), and how many at most. */
const ERASE_REFUSAL_ORDER: readonly EraseRefusal[] = ["train", "station", "house", "road", "tree"];
const ERASE_NAMED = 3;

/**
 * Where a sweep looks along the way the pointer came (`way`: where it was, then each point since): evenly by distance
 * along it, one look every `step` px, but at most `most` (then further apart, still reaching the way's end). None if
 * it hasn't moved.
 */
export function sweepLooks(way: readonly { x: number; y: number }[], step: number, most: number): { x: number; y: number }[] {
  const lengths = [0];
  for (let i = 1; i < way.length; i++) lengths.push(lengths[i - 1] + Math.hypot(way[i].x - way[i - 1].x, way[i].y - way[i - 1].y));
  const total = lengths[lengths.length - 1];
  if (!(total > 0)) return [];
  const count = Math.min(most, Math.max(1, Math.ceil(total / step)));
  const out: { x: number; y: number }[] = [];
  let seg = 1;
  for (let k = 1; k <= count; k++) {
    const at = (total * k) / count;
    while (seg < way.length - 1 && lengths[seg] < at) seg++;
    const a = way[seg - 1];
    const b = way[seg];
    const span = lengths[seg] - lengths[seg - 1];
    const t = span > 0 ? (at - lengths[seg - 1]) / span : 1;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}
