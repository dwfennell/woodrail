#!/usr/bin/env node
/**
 * The balance play-through (src/play/balance.test.ts, `BALANCE=1`) over a wide range of player seeds, a few at a time
 * over the cores, each checked against spec §5's bands at 180 min. For release points and balance changes: about a
 * minute of CPU a seed (0–200: about 50 min on 4 cores). No CI job runs it.
 *
 * `BALANCE_SEED` seeds the simulated player's choices (the reward cards it's offered and the ones it picks); the map is
 * always the starter map (`buildStarterWorld`, `STARTER_SEED`). So a seed that fails is one player's path through it.
 *
 *   npm run balance:sweep                                (seeds 0-200, one run a core)
 *   npm run balance:sweep -- --from 0 --to 40 --jobs 2 [--out <dir>]
 *
 * Other BALANCE_* settings pass through from the environment (e.g. BALANCE_SCHOOL=first for an A/B). Prints each seed's
 * BANDS line and the bands it missed, then a summary; each run's full log goes to <out> (default .balance-sweep/).
 * Exits non-zero if any seed missed a band.
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
const FROM = Number(opt("from", 0));
const TO = Number(opt("to", 200));
const JOBS = Math.max(1, Number(opt("jobs", Math.max(1, cpus().length))));
const OUT = opt("out", ".balance-sweep");
mkdirSync(OUT, { recursive: true });

const seeds = Array.from({ length: TO - FROM + 1 }, (_, i) => FROM + i);
const t0 = Date.now();
console.log(`balance sweep: seeds ${FROM}-${TO} (${seeds.length}), ${JOBS} at a time (logs in ${OUT}/)`);

function run(seed) {
  return new Promise((resolve) => {
    const env = { ...process.env, BALANCE: "1", BALANCE_SEED: String(seed) };
    const child = spawn("npx", ["vitest", "run", "--silent=false", "src/play/balance.test.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("close", (code) => {
      writeFileSync(join(OUT, `seed-${seed}.log`), log);
      const bands = log.split("\n").find((l) => l.startsWith("BANDS"))?.trim() ?? "(no BANDS line)";
      // (The soft expectations' messages: "AssertionError: no planks into a town for 45 min: expected …".)
      const missed = [...new Set([...log.matchAll(/AssertionError: ([^:\n]+):/g)].map((m) => m[1]))];
      const failed = code !== 0;
      console.log(`seed ${seed}: ${failed ? `FAILED (${missed.join("; ") || "see log"})` : "ok"} ${bands}`);
      resolve({ seed, failed, missed });
    });
  });
}

const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(JOBS, seeds.length) }, async () => {
    while (next < seeds.length) results.push(await run(seeds[next++]));
  }),
);
const failed = results.filter((r) => r.failed).sort((a, b) => a.seed - b.seed);
const by = new Map();
for (const r of failed) for (const m of r.missed.length ? r.missed : ["see log"]) by.set(m, [...(by.get(m) ?? []), r.seed]);
console.log(`\nbalance sweep: ${seeds.length} seeds, ${failed.length} missed a band${failed.length ? `: ${failed.map((r) => r.seed).join(", ")}` : ""}; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
for (const [m, s] of by) console.log(`  ${m}: ${s.join(", ")}`);
process.exit(failed.length ? 1 : 0);
