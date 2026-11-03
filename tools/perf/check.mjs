// `npm run perf:check`: a short perf run (tools/perf/run.mjs --quick) checked against tools/perf/budgets.json. Fails
// (exit 1) when a measure is over its budget by more than its margin. Run after `npm run build` (it measures dist/).
// See docs/agents/perf.md.
//
//   npm run perf:check [-- --update] [-- --from perf-out/check/perf.json]
//
// `--update` writes the budgets afresh from this run (each budget its value with the headroom below, rounded up):
// for after a change that rightly costs more (say why in the commit), or that saved a lot (tighten them).
// `--from` checks a run already made instead of making one.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BUDGETS = `${HERE}/budgets.json`;
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const budgets = JSON.parse(readFileSync(BUDGETS, "utf8"));
const OUT = "perf-out/check";

let file = opt("from");
if (!file) {
  const r = spawnSync("node", [`${HERE}/run.mjs`, "--quick", ...budgets.run, "--out", OUT], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) {
    console.error("perf:check: the run failed");
    process.exit(2);
  }
  file = `${OUT}/perf.json`;
}
const run = JSON.parse(readFileSync(file, "utf8"));

const get = (o, path) => path.split(".").reduce((x, k) => (x === null || x === undefined ? x : x[k]), o);
/** A measure's value in this run: `bundle.…` from the run's bundle, else `<map>.<path>` from that map's results. */
const value = (key) => {
  const [head, ...rest] = key.split(".");
  if (head === "bundle") return get(run.bundle, rest.join("."));
  const m = run.maps[head];
  if (!m || m.failed) return undefined;
  return get(m, rest.join("."));
};

if (args.includes("--update")) {
  for (const [key, b] of Object.entries(budgets.budgets)) {
    const v = value(key);
    if (typeof v !== "number") continue;
    const kind = budgets.kinds[b.kind];
    b.max = roundUp(Math.max(v * kind.headroom, v + kind.floor));
  }
  writeFileSync(BUDGETS, JSON.stringify(budgets, null, 2) + "\n");
  console.log(`perf:check: budgets written from ${file}`);
  process.exit(0);
}

function roundUp(x) {
  if (x <= 10) return Math.ceil(x * 10) / 10;
  if (x <= 100) return Math.ceil(x);
  const p = 10 ** (Math.floor(Math.log10(x)) - 2);
  return Math.ceil(x / p) * p;
}

let failed = 0;
const rows = [];
for (const [key, b] of Object.entries(budgets.budgets)) {
  const v = value(key);
  const kind = budgets.kinds[b.kind];
  const limit = b.max * (1 + kind.margin);
  let verdict;
  if (typeof v !== "number") {
    verdict = run.maps[key.split(".")[0]]?.failed ? "FAIL (map failed)" : "missing";
    if (verdict.startsWith("FAIL")) failed++;
  } else if (v > limit) {
    verdict = "FAIL";
    failed++;
  } else if (v > b.max) verdict = "over budget, within margin";
  else if (v < b.max / (kind.headroom * 1.5) && b.max > kind.floor * 2) verdict = "ok (well under: tighten with --update?)";
  else verdict = "ok";
  rows.push(`| ${key} | ${v ?? "–"} | ${b.max} (+${Math.round(kind.margin * 100)}%) | ${verdict} |`);
}
console.log(`\n| measure | this run | budget | |\n|---|---|---|---|\n${rows.join("\n")}`);
for (const [id, m] of Object.entries(run.maps)) if (m.errors?.length) console.log(`\n${id}: page errors: ${m.errors.slice(0, 3).join(" | ")}`);
console.log(failed ? `\nperf:check: ${failed} over budget (see docs/agents/perf.md)` : "\nperf:check: within budget");
process.exit(failed ? 1 : 0);
