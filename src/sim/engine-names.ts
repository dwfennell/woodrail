/**
 * Engines' names: a friendly toy name painted on each engine's cab (its name plate) and shown as its card's title.
 * One is picked from `ENGINE_NAMES` as an engine is first put on the track (`pickEngineName`), kept by its car id
 * (which lasts across pick-ups, undo and saves), saved with the train, and the player may rename it from its card.
 */

/** The most letters a name may have (the plate is small, and the card's title one line). */
export const MAX_ENGINE_NAME = 14;

/** Names an engine may be given, all short enough for the plate. */
export const ENGINE_NAMES: readonly string[] = [
  "Bramble",
  "Pip",
  "Juniper",
  "Clover",
  "Hazel",
  "Bumble",
  "Rowan",
  "Thistle",
  "Puffin",
  "Maple",
  "Wren",
  "Biscuit",
  "Acorn",
  "Willow",
  "Pepper",
  "Sorrel",
  "Nutmeg",
  "Fern",
  "Tansy",
  "Barley",
  "Conker",
  "Marigold",
  "Poppy",
  "Sprocket",
  "Dandelion",
  "Robin",
  "Teasel",
  "Bluebell",
  "Muffin",
  "Elder",
  "Pickle",
  "Holly",
];

/**
 * The name a new engine (car id `id`) is given: the first of `ENGINE_NAMES`, counting on from a start its id picks,
 * that no other engine on the track has (`taken`); with every name taken, a numbered one ("Bramble 2"). Depends only
 * on the id and what's taken, so the same map gets the same names.
 */
export function pickEngineName(id: number, taken: ReadonlySet<string>): string {
  const n = ENGINE_NAMES.length;
  // (A stride coprime with the list's length, so ids in a row get names far apart in it.)
  const start = (Math.imul(id, 13) >>> 0) % n;
  for (let k = 0; k < n; k++) {
    const name = ENGINE_NAMES[(start + k) % n];
    if (!taken.has(name)) return name;
  }
  for (let round = 2; ; round++) {
    for (let k = 0; k < n; k++) {
      const name = `${ENGINE_NAMES[(start + k) % n]} ${round}`;
      if (name.length <= MAX_ENGINE_NAME && !taken.has(name)) return name;
    }
  }
}

/**
 * A name as the player typed it, made fit for a plate: spaces trimmed and run together, control characters dropped,
 * cut to `MAX_ENGINE_NAME` letters (by code point, so an emoji isn't cut in half). Null when nothing's left.
 */
export function cleanEngineName(raw: string): string | null {
  // eslint-disable-next-line no-control-regex
  const flat = raw.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const cut = Array.from(flat).slice(0, MAX_ENGINE_NAME).join("").trim();
  return cut.length > 0 ? cut : null;
}
