/**
 * The routing cases the game gets wrong today with the train dispatcher on (cases-on-*.test.ts; default-on waits for it to be empty), by case id: their mismatches (judge.ts), as a run finds them. Written by
 * `node tools/cases-known.mjs --on <dir>` from `CASES_OUT=<dir> npx vitest run src/routing/cases/`; what each means and which
 * proposed fix clears it: docs/agents/routing-cases.md.
 */
export const KNOWN_ON: Record<string, string[]> = {
  "branch 2×one opposed stops:far": ["stalls-live"],
  "branch 2×own opposed stops:far": ["stalls-live"],
  "fuzz seed 37": ["stalls-live"],
  "fuzz seed 125": ["stalls-live"],
  "ring1 2×mix opposed": ["break:deadlock"],
};
