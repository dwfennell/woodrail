// The routing cases the game gets wrong today (src/routing/cases/known.ts): from a run's judgements
// (CASES_OUT=<dir> npx vitest run src/routing/cases/), each mismatched case and its mismatches. Run after a change
// that rightly changes the list (a fix landed), and say why in the commit.
//
// Usage: node tools/cases-known.mjs [--on] <dir>   (--on: the dispatcher-on cases, src/routing/cases/known-on.ts)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
// (--on: the dispatcher-on run's (shard-on-*.json) into known-on.ts.)
const ON = args.includes("--on");
const [DIR] = args.filter((a) => a !== "--on");
const rows = readdirSync(DIR)
  .filter((f) => (ON ? /^shard-on-\d+\.json$/ : /^shard-\d+\.json$/).test(f))
  .flatMap((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")))
  .filter((r) => r.mismatches.length > 0)
  .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
let out = `/**
 * The routing cases the game gets wrong today${ON ? " with the train dispatcher on (cases-on-*.test.ts; default-on waits for it to be empty)" : ""}, by case id: their mismatches (judge.ts), as a run finds them. Written by
 * \`node tools/cases-known.mjs ${ON ? "--on " : ""}<dir>\` from \`CASES_OUT=<dir> npx vitest run src/routing/cases/\`; what each means and which
 * proposed fix clears it: docs/agents/routing-cases.md.
 */
export const ${ON ? "KNOWN_ON" : "KNOWN"}: Record<string, string[]> = {
`;
for (const r of rows) out += `  ${JSON.stringify(r.id)}: ${JSON.stringify(r.mismatches)},\n`;
out += "};\n";
writeFileSync(ON ? "src/routing/cases/known-on.ts" : "src/routing/cases/known.ts", out);
console.log(`${rows.length} known`);
