/**
 * The routing cases the game gets wrong today, by case id: their mismatches (judge.ts), as a run finds them. Written by
 * `node tools/cases-known.mjs <dir>` from `CASES_OUT=<dir> npx vitest run src/routing/cases/`; what each means and which
 * proposed fix clears it: docs/agents/routing-cases.md.
 */
export const KNOWN: Record<string, string[]> = {
  "fuzz seed 19": ["stalls-live"],
  "ring1 3×one same sig:blocks2": ["stalls-live"],
  "siding-spare 3×one same": ["starves-live"],
  "terminus-spare 3×one opposed": ["starves-live","break:deadlock"],
  "terminus-spare 3×one same": ["starves-live","break:deadlock"],
  "wye-spare 3×one opposed": ["stalls-live:siding"],
  "wye-spare 3×one same": ["stalls-live:siding"],
};
