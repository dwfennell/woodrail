/** The eraser (the Clear chip): what to say of what a sweep passed over and left. See `Interaction.setErasing`. */

/**
 * Why something a clearing sweep passed over stays: a station or depot, a train, track a train's on, a town's house,
 * a road, a tree of the map's.
 */
export type EraseRefusal = "station" | "train" | "busy" | "house" | "road" | "tree";

const ERASE_REFUSAL_NOUNS: Record<EraseRefusal, string> = { station: "stations and depots", train: "trains", busy: "track a train is on", house: "the town's houses", road: "roads", tree: "trees" };

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
const ERASE_REFUSAL_ORDER: readonly EraseRefusal[] = ["busy", "train", "station", "house", "road", "tree"];
const ERASE_NAMED = 3;
