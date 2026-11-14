/**
 * The routing cases the game gets wrong today, by case id: their mismatches (judge.ts), as a run finds them. Written by
 * `node tools/cases-known.mjs <dir>` from `CASES_OUT=<dir> npx vitest run src/routing/cases/`; what each means and which
 * proposed fix clears it: docs/agents/routing-cases.md.
 */
export const KNOWN: Record<string, string[]> = {
  "ring1 3×one same sig:blocks2": ["stalls-live"],
};
