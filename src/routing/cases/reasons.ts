/**
 * Why a known case (known.ts) is known, where it's a decision rather than a fault to fix: shown in its test's title
 * and the table. By case id.
 */
const CONVOY =
  "the user's decision 4: two of a line's trains following into a line end stay one train to a section (the card says add a passing loop), though the oracle finds a §16 Q9 turn behind the one standing there";

/** (Waiting on the user's call, decision 4 against §16 Q9: docs/agents/routing-cases.md, "Stepping aside".) */
const OFF_PLAIN =
  "waiting on the user's call: the spare end is off plain points, so only one way in; to get by, one train follows the other into the line end and turns behind it (§16 Q9), a convoy decision 4 keeps out";
const THREE =
  "waiting on the user's call: with three trains the one aside in the spare end must wait for two to pass, the second behind it as a convoy (§16 Q9), which decision 4 keeps out";

export const REASONS: Record<string, string> = {
  "fuzz seed 125": "the user's decision 4: boxed in past a passing loop, a convoy into a dead end (boxed.ts's own case), said stuck; the oracle finds a way through stepping aside into the siding off plain points",
  "fuzz seed 136": CONVOY,
  "fuzz seed 149": CONVOY,
  "siding-spare 2×one opposed": OFF_PLAIN,
  "siding-spare 2×one same": OFF_PLAIN,
  "siding-spare 2×own opposed": OFF_PLAIN,
  "siding-spare 2×own same": OFF_PLAIN,
  "terminus-spare 2×one opposed": OFF_PLAIN,
  "terminus-spare 2×one same": OFF_PLAIN,
  "terminus-spare 2×own opposed": OFF_PLAIN,
  "terminus-spare 2×own same": OFF_PLAIN,
  "terminus-spare 3×one opposed": OFF_PLAIN,
  "terminus-spare 3×one same": OFF_PLAIN,
  "wye-spare 3×one opposed": THREE,
  "wye-spare 3×one same": THREE,
};
