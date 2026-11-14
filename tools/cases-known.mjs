// The routing cases the game gets wrong today (src/routing/cases/known.ts): from a run's judgements
// (CASES_OUT=<dir> npx vitest run src/routing/cases/), each mismatched case and its mismatches. Run after a change
// that rightly changes the list (a fix landed), and say why in the commit.
//
// Usage: node tools/cases-known.mjs <dir>
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const [DIR] = process.argv.slice(2);
const rows = readdirSync(DIR)
  .filter((f) => /^shard-\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")))
  .filter((r) => r.mismatches.length > 0)
  .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
let out = `/**
 * The routing cases the game gets wrong today, by case id: their mismatches (judge.ts), as a run finds them. Written by
 * \`node tools/cases-known.mjs <dir>\` from \`CASES_OUT=<dir> npx vitest run src/routing/cases/\`; what each means and which
 * proposed fix clears it: docs/agents/routing-cases.md.
 */
export const KNOWN: Record<string, string[]> = {
`;
for (const r of rows) out += `  ${JSON.stringify(r.id)}: ${JSON.stringify(r.mismatches)},\n`;
out += "};\n";
writeFileSync("src/routing/cases/known.ts", out);
console.log(`${rows.length} known`);
