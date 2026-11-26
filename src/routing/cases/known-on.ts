/**
 * The routing cases the game gets wrong today with the train dispatcher on (cases-on-*.test.ts; default-on waits for it to be empty), by case id: their mismatches (judge.ts), as a run finds them. Written by
 * `node tools/cases-known.mjs --on <dir>` from `CASES_OUT=<dir> npx vitest run src/routing/cases/`; what each means and which
 * proposed fix clears it: docs/agents/routing-cases.md.
 */
export const KNOWN_ON: Record<string, string[]> = {
  "branch 2×one opposed stops:far": ["stalls-live"],
  "branch 2×own opposed stops:far": ["stalls-live"],
  "branch-spare 2×own opposed": ["stalls-live:siding"],
  "crossing 2×mix same": ["break:deadlock"],
  "fuzz seed 34": ["stalls-live"],
  "fuzz seed 37": ["stalls-live","break:wrongRoad"],
  "fuzz seed 94": ["stalls-live:siding"],
  "fuzz seed 111": ["stalls-live"],
  "fuzz seed 125": ["stalls-live"],
  "fuzz seed 126": ["stalls-live"],
  "fuzz seed 165": ["stalls-live"],
  "fuzz seed 189": ["stalls-live:siding"],
  "line1+siding 3×one opposed": ["stalls-live"],
  "line1+siding 3×one same": ["stalls-live"],
  "line1+siding-spare 3×one opposed": ["stalls-live"],
  "line2 3×mix opposed": ["waits-on-points"],
  "line3 2×mix opposed": ["waits-on-points"],
  "line3 3×mix same": ["waits-on-points"],
  "ring1 2×mix opposed": ["break:deadlock"],
  "ring1 2×one opposed short": ["stalls-live","waits-on-points"],
  "ring2 2×mix opposed": ["break:deadlock"],
  "siding-spare 2×own opposed": ["stalls-live:siding"],
  "siding-spare 2×own same": ["stalls-live:siding"],
  "terminus-spare 2×own opposed": ["stalls-live:siding"],
  "terminus-spare 2×own same": ["stalls-live:siding"],
  "terminus-spare 3×one opposed": ["stalls-live:siding"],
  "wye 2×mix opposed": ["waits-on-points"],
  "wye-spare 2×mix opposed": ["waits-on-points"],
  "wye-spare 2×own opposed": ["stalls-live:siding"],
  "wye-spare 2×own same": ["stalls-live:siding"],
  "wye-spare 3×one opposed": ["stalls-live:siding"],
};
