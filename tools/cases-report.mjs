// The routing cases' table (docs/agents/routing-cases.md): from the judgements the cases write
// (CASES_OUT=<dir> npx vitest run src/routing/cases/), every case with the oracle's verdict, the game's result and
// pass / known / fail, by family; written between the doc's "cases table" markers.
//
// Usage: node tools/cases-report.mjs <dir> [doc]   (doc: docs/agents/routing-cases.md)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const [DIR, DOC = "docs/agents/routing-cases.md"] = process.argv.slice(2);
const rows = readdirSync(DIR)
  .filter((f) => /^shard-\d+\.json$/.test(f))
  .flatMap((f) => JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")));
const order = ["ring", "trains", "signals", "placement", "stops", "lengths", "fuzz"];
rows.sort((a, b) => order.indexOf(a.family) - order.indexOf(b.family) || a.id.localeCompare(b.id, "en", { numeric: true }));

const game = (r) => {
  const g = r.game;
  const stops = g.stops.map((s, k) => (s < 0 ? `${g.ran[k]} m` : `${s}`)).join(" / ");
  return g.stallAt >= 0 ? `stall at ${g.stallAt} s (${g.why.map((w) => w ?? "–").join(", ")}); ${stops}` : stops;
};
const status = (r) => (r.mismatches.length === 0 ? (r.known ? "**fixed?**" : "pass") : r.known ? `known: ${r.mismatches.join(", ")}${r.reason ? ` (${r.reason})` : ""}` : `**FAIL**: ${r.mismatches.join(", ")}`);
const verdict = (r) => `${r.verdict} (${r.oracle.best}/${r.oracle.n}${r.oracle.own !== undefined && r.oracle.own !== r.oracle.best ? `; own ends ${r.oracle.own}` : ""}${r.oracle.noSignals !== undefined ? `; no signals ${r.oracle.noSignals}` : ""}${r.oracle.anyEnds !== undefined ? `; through an industry siding ${r.oracle.anyEnds}` : ""})`;

let out = "";
const summary = {};
for (const fam of order) {
  const rs = rows.filter((r) => r.family === fam);
  if (rs.length === 0) continue;
  const bad = rs.filter((r) => r.mismatches.length > 0);
  summary[fam] = { cases: rs.length, mismatched: bad.length, kinds: {} };
  for (const r of bad) for (const m of r.mismatches) summary[fam].kinds[m] = (summary[fam].kinds[m] ?? 0) + 1;
  out += `\n### ${fam} (${rs.length} cases, ${bad.length} mismatched)\n\n| Case | Oracle | Game (stops per train; hand-run: metres) | Result |\n|---|---|---|---|\n`;
  for (const r of rs) out += `| ${r.id} | ${verdict(r)} | ${game(r)} | ${status(r)} |\n`;
}
let head = `\n${rows.length} cases; ${rows.filter((r) => r.mismatches.length > 0).length} mismatched.\n\n| Family | Cases | Mismatched | By kind |\n|---|---|---|---|\n`;
for (const [fam, s] of Object.entries(summary)) head += `| ${fam} | ${s.cases} | ${s.mismatched} | ${Object.entries(s.kinds).map(([k, v]) => `${k} ${v}`).join(", ") || "–"} |\n`;
const table = `<!-- cases table: node tools/cases-report.mjs -->${head}${out}<!-- /cases table -->`;
const doc = existsSync(DOC) ? readFileSync(DOC, "utf8") : "";
const re = /<!-- cases table[\s\S]*<!-- \/cases table -->/;
writeFileSync(DOC, re.test(doc) ? doc.replace(re, table) : `${doc}\n${table}\n`);
console.log(head);
