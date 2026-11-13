/**
 * The routing cases the game gets wrong today, by case id: their mismatches (judge.ts), as a run finds them. Written by
 * `node tools/cases-known.mjs <dir>` from `CASES_OUT=<dir> npx vitest run src/routing/cases/`; what each means and which
 * proposed fix clears it: docs/agents/routing-cases.md.
 */
export const KNOWN: Record<string, string[]> = {
  "branch 2×mix opposed": ["waits-on-points"],
  "branch 2×one opposed": ["waits-on-points"],
  "branch 2×one opposed stops:far": ["stalls-live","waits-on-points"],
  "branch 2×own opposed": ["waits-on-points"],
  "branch 2×own opposed stops:far": ["stalls-live"],
  "branch-spare 2×mix opposed": ["waits-on-points"],
  "branch-spare 2×one opposed": ["stalls-live:siding","waits-on-points"],
  "branch-spare 2×own opposed": ["stalls-live:siding","waits-on-points"],
  "fuzz seed 19": ["stalls-live"],
  "line1 2×hand opposed facing": ["waits-on-points"],
  "line1+siding 2×hand same": ["waits-on-points"],
  "line1+siding-spare 2×hand same": ["waits-on-points"],
  "ring1 2×one opposed long": ["waits-on-points"],
  "ring1 3×one same sig:blocks2": ["stalls-live"],
  "siding-spare 3×one same": ["stalls-live:siding"],
  "terminus-spare 3×one opposed": ["stalls-live:siding"],
  "terminus-spare 3×one same": ["stalls-live:siding"],
  "wye 2×hand opposed": ["waits-on-points"],
  "wye-spare 2×hand opposed": ["waits-on-points"],
  "wye-spare 3×one opposed": ["stalls-live:siding"],
  "wye-spare 3×one same": ["stalls-live:siding"],
};
