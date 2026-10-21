/** The eraser (the Clear chip): what to say of what a sweep passed over and left. See `Interaction.setErasing`. */

/** Why something a clearing sweep passed over stays: a station or depot, a train, track a train's on, a town's house. */
export type EraseRefusal = "station" | "train" | "busy" | "house";

const ERASE_REFUSAL_NOUNS: Record<EraseRefusal, string> = { station: "stations and depots", train: "trains", busy: "track a train is on", house: "the town's houses" };

/**
 * What to say, once, when a clearing sweep is lifted, of what it passed over that stays (each kind's first reason): the
 * reason itself if there's one kind, else the kinds together ("Some things stay: stations and depots, trains"). Null if
 * nothing stayed.
 */
export function eraseRefusal(told: ReadonlyMap<EraseRefusal, string>): string | null {
  if (told.size === 0) return null;
  if (told.size === 1) return [...told.values()][0];
  return `Some things stay: ${[...told.keys()].map((k) => ERASE_REFUSAL_NOUNS[k]).join(", ")}`;
}
