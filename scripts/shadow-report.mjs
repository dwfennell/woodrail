#!/usr/bin/env node
/**
 * The reservation shadow's disagreements with today's guards (routing redesign §4 step 2;
 * docs/superpowers/specs/2026-11-07-routing-redesign.md): the fuzz's seeds (plain, with signals, rings) and the bug
 * maps run with the shadow on (src/routing/shadow-report.test.ts), sharded over the cores; prints the counts by kind,
 * held-free by what holds the train today, refusals by what met the core's booking, the worst runs, and the shadow's
 * own cost. Test-only: nothing in the game runs it.
 *
 *   npm run shadow:report                                   (40 seeds × 600 s each part, and the bug maps)
 *   npm run shadow:report -- --seeds 200 --seconds 1800 --shards 4 [--parts plain,signals,ring,maps] [--out <dir>]
 *
 * Writes every run's line to <out>/runs.jsonl (default .shadow-report/) and the totals to <out>/totals.json.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const SEEDS = Number(opt("seeds", 40));
const SECONDS = Number(opt("seconds", 600));
const SHARDS = Math.max(1, Math.min(SEEDS, Number(opt("shards", Math.max(1, cpus().length)))));
const PARTS = opt("parts", "plain,signals,ring,maps");
const OUT = opt("out", ".shadow-report");
mkdirSync(OUT, { recursive: true });

const per = Math.ceil(SEEDS / SHARDS);
const t0 = Date.now();
console.log(`shadow report: ${SEEDS} seeds × ${SECONDS} s (${PARTS}) in ${SHARDS} shards`);

function shard(k) {
  const first = 1 + k * per;
  const count = Math.min(per, SEEDS - k * per);
  if (count <= 0) return Promise.resolve({ k, code: 0, runs: [] });
  return new Promise((resolve) => {
    const env = { ...process.env, SHADOW_REPORT: "1", SHADOW_SEEDS: String(count), SHADOW_FIRST: String(first), SHADOW_SECONDS: String(SECONDS), SHADOW_PARTS: PARTS };
    const child = spawn("npx", ["vitest", "run", "--silent=false", "src/routing/shadow-report.test.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("close", (code) => {
      writeFileSync(join(OUT, `shard-${k}.log`), log);
      const runs = log
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("SHADOW "))
        .map((l) => JSON.parse(l.slice(7)));
      console.log(`shard ${k} (seeds ${first}-${first + count - 1}): ${code === 0 ? "done" : "FAILED"}, ${runs.length} runs, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
      resolve({ k, code, runs });
    });
  });
}

const results = await Promise.all(Array.from({ length: SHARDS }, (_, k) => shard(k)));
const runs = results.flatMap((r) => r.runs);
writeFileSync(join(OUT, "runs.jsonl"), runs.map((r) => JSON.stringify(r)).join("\n") + "\n");

const add = (into, from) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v;
  return into;
};
const part = (r) => r.run.split(" ")[0];
const totals = {};
for (const r of runs) {
  const p = part(r);
  totals[p] ??= { runs: 0, counts: {}, heldFreeBy: {}, refusedBy: {}, bookings: 0, ms: 0, ticks: 0, with: {} };
  const t = totals[p];
  t.runs++;
  add(t.counts, r.counts);
  add(t.heldFreeBy, r.heldFreeBy);
  add(t.refusedBy, r.refusedBy);
  t.bookings += r.bookings;
  t.ms += r.ms;
  t.ticks += r.ticks;
  for (const [k, v] of Object.entries(r.counts)) if (v > 0) t.with[k] = (t.with[k] ?? 0) + 1;
}
writeFileSync(join(OUT, "totals.json"), JSON.stringify(totals, null, 2) + "\n");

const sorted = (o) =>
  Object.entries(o)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
for (const [p, t] of Object.entries(totals)) {
  console.log(`\n${p}: ${t.runs} runs, ${(t.ticks / 120 / 60).toFixed(0)} game minutes`);
  for (const [k, v] of Object.entries(t.counts)) console.log(`  ${k.padEnd(15)} ${String(v).padStart(6)}  (in ${t.with[k] ?? 0} of ${t.runs} runs)`);
  if (Object.keys(t.heldFreeBy).length) console.log(`  held-free by what holds it today: ${sorted(t.heldFreeBy)}`);
  if (Object.keys(t.refusedBy).length) console.log(`  ran-unbooked and green-unbooked, by what met the booking: ${sorted(t.refusedBy)}`);
  console.log(`  shadow cost: ${t.bookings} bookings, ${((t.ms * 1000) / Math.max(1, t.bookings)).toFixed(1)} µs each, ${((t.ms * 1000) / Math.max(1, t.ticks)).toFixed(2)} µs a tick`);
}
const score = (r) => r.counts["held-free"] + r.counts["ran-unbooked"] + r.counts["shared-points"] + r.counts["green-unbooked"] + r.counts["red-booked"];
const worst = [...runs].sort((a, b) => score(b) - score(a)).slice(0, 8);
console.log(`\nworst runs (held-free + ran-unbooked + shared-points + green-unbooked + red-booked):`);
for (const r of worst) console.log(`  ${r.run}: ${score(r)} (${Object.entries(r.counts).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(", ")})${r.first["held-free"][0] ? `; e.g. ${r.first["held-free"][0]}` : ""}`);
console.log(`\nshadow report: ${runs.length} runs in ${((Date.now() - t0) / 60000).toFixed(1)} min; ${results.filter((r) => r.code !== 0).length} shards failed`);
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
