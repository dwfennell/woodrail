#!/usr/bin/env node
/**
 * The dispatcher in shadow (dispatcher spec §8 step 1, docs/superpowers/specs/2026-11-18-dispatcher.md): where its
 * grant/hold model (src/routing/dispatch-stretch-shadow.ts, the per-stretch search in src/routing/stretch.ts) would
 * decide differently from today's rules, by kind, over the reference maps (bench/dispatch.bench.ts, plain Node,
 * each jam also judged by the per-stretch judge) and the fuzz's seeds (src/routing/dispatch-report.test.ts), sharded
 * over the cores. Also each decision's cost (p50, p98, max ms). Test and script only: nothing in the game runs it.
 *
 *   npm run dispatch:report                               (the maps 1800 s; 40 seeds × 600 s, plain and with signals)
 *   npm run dispatch:report -- --seeds 200 --seconds 1800 --map-seconds 1800 --jobs 4 [--parts plain,signals,maps] [--out <dir>]
 *
 * Writes every run's line to <out>/runs.jsonl (default .dispatch-report/) and the totals to <out>/totals.json.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const SEEDS = Number(opt("seeds", 40));
const SECONDS = Number(opt("seconds", 600));
const MAP_SECONDS = Number(opt("map-seconds", 1800));
const JOBS = Math.max(1, Number(opt("jobs", Math.max(1, cpus().length))));
const PARTS = new Set(opt("parts", "plain,signals,maps").split(","));
const OUT = opt("out", ".dispatch-report");
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();

const jobs = [];
if (PARTS.has("maps")) {
  const b = spawnSync("npx", ["vite", "build", "--config", "bench/vite.config.ts", "--logLevel", "warn"], { stdio: "inherit" });
  if (b.status !== 0) process.exit(1);
  for (const f of readdirSync("src/play/bugmaps/reference").filter((x) => x.endsWith(".txt")).sort())
    jobs.push({ name: `map ${f}`, cmd: "node", argv: ["dist-bench/dispatch.js"], env: { DISPATCH_MAP: f, DISPATCH_SECONDS: String(MAP_SECONDS) } });
}
const fuzzParts = ["plain", "signals"].filter((p) => PARTS.has(p)).join(",");
if (fuzzParts) {
  const per = Math.max(1, Math.ceil(SEEDS / JOBS));
  for (let first = 1; first <= SEEDS; first += per)
    jobs.push({
      name: `fuzz ${first}-${Math.min(SEEDS, first + per - 1)}`,
      cmd: "npx",
      argv: ["vitest", "run", "--silent=false", "src/routing/dispatch-report.test.ts"],
      env: { DISPATCH_REPORT: "1", DISPATCH_FIRST: String(first), DISPATCH_SEEDS: String(Math.min(per, SEEDS - first + 1)), DISPATCH_SECONDS: String(SECONDS), DISPATCH_PARTS: fuzzParts },
    });
}
console.log(`dispatch report: ${jobs.length} jobs (${[...PARTS].join(", ")}) on ${JOBS} at once`);

const runs = [];
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    await new Promise((resolve) => {
      const child = spawn(j.cmd, j.argv, { env: { ...process.env, ...j.env }, stdio: ["ignore", "pipe", "pipe"] });
      let log = "";
      child.stdout.on("data", (d) => (log += d));
      child.stderr.on("data", (d) => (log += d));
      child.on("close", (code) => {
        const got = log
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("DISPATCH "))
          .map((l) => JSON.parse(l.slice(9)));
        runs.push(...got.map((r) => ({ ...r, kind: j.name.startsWith("map") ? "map" : "fuzz" })));
        console.log(`${j.name}: ${code === 0 ? "done" : "FAILED"}, ${got.length} runs, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
        if (code !== 0) writeFileSync(join(OUT, `${j.name.replace(/\W+/g, "-")}.log`), log);
        resolve();
      });
    });
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));
writeFileSync(join(OUT, "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");

const pad = (s, n) => String(s).padEnd(n);
const pct = (a, p) => (a.length === 0 ? 0 : [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]);
const totals = {};
for (const kind of ["map", "fuzz"]) {
  const rs = runs.filter((r) => r.kind === kind);
  if (rs.length === 0) continue;
  const counts = {};
  const heldBy = {};
  const verdicts = {};
  const ms = [];
  let decisions = 0;
  let capped = 0;
  let events = 0;
  let agreeGo = 0;
  let agreeHold = 0;
  for (const r of rs) {
    for (const [k, v] of Object.entries(r.counts)) counts[k] = (counts[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.heldBy ?? {})) heldBy[k] = (heldBy[k] ?? 0) + v;
    for (const [k, v] of Object.entries(r.verdicts ?? {})) verdicts[k] = (verdicts[k] ?? 0) + v;
    ms.push(...(r.decisionMs ?? []));
    decisions += r.decisions;
    capped += r.capped;
    events += r.events;
    agreeGo += r.agreeGo;
    agreeHold += r.agreeHold;
  }
  totals[kind] = { runs: rs.length, counts, heldBy, verdicts, decisions, events, capped, agreeGo, agreeHold, ms: { p50: pct(ms, 0.5), p98: pct(ms, 0.98), max: pct(ms, 1) } };
  console.log(`\n${kind === "map" ? "the reference maps" : `the fuzz (${fuzzParts})`}: ${rs.length} runs, ${events} events, ${decisions} decisions (${capped} capped)`);
  for (const [k, v] of Object.entries(counts)) console.log(`  ${pad(k, 24)}${v}`);
  console.log(`  agreed: went when granted ${agreeGo}, held where it stood ${agreeHold}`);
  if (Object.keys(heldBy).length) console.log(`  grant-held by what held it today: ${Object.entries(heldBy).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (Object.keys(verdicts).length) console.log(`  jams judged: ${Object.entries(verdicts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`  decision ms: p50 ${totals[kind].ms.p50}, p98 ${totals[kind].ms.p98}, max ${totals[kind].ms.max}`);
}
if (runs.some((r) => r.kind === "map")) {
  console.log(`\n${pad("map", 18)}${pad("jams", 6)}${pad("verdicts", 52)}${pad("decisions", 11)}p50 / p98 / max ms`);
  for (const r of runs.filter((x) => x.kind === "map").sort((a, b) => a.map.localeCompare(b.map)))
    console.log(`${pad(r.map, 18)}${pad(r.jams, 6)}${pad(Object.entries(r.verdicts).map(([k, v]) => `${k} ${v}`).join(", "), 52)}${pad(r.decisions, 11)}${r.ms.p50} / ${r.ms.p98} / ${r.ms.max}`);
}
writeFileSync(join(OUT, "totals.json"), JSON.stringify(totals, null, 1));
console.log(`\n(${((Date.now() - t0) / 60000).toFixed(1)} min; runs in ${OUT}/runs.jsonl)`);
