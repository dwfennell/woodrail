/**
 * Why a known case (known.ts) is known, where it's a decision rather than a fault to fix: shown in its test's title
 * and the table. By case id.
 */
const CONVOY =
  "the user's decision 4: two of a line's trains following into a line end stay one train to a section (the card says add a passing loop), though the oracle finds a §16 Q9 turn behind the one standing there";

export const REASONS: Record<string, string> = {
  "fuzz seed 125": "the user's decision 4: boxed in past a passing loop, a convoy into a dead end (boxed.ts's own case), said stuck; the oracle finds a way through stepping aside into the siding off plain points",
  "fuzz seed 136": CONVOY,
  "fuzz seed 149": CONVOY,
};
