#!/usr/bin/env node
/**
 * The long routing fuzz (src/routing/harness-fuzz.test.ts), for release points: 200 seeds × 30 game minutes each,
 * sharded over the cores, every invariant (src/sim/invariants.ts) checked every tick. No CI job runs it.
 *
 *   npm run fuzz:long                         (200 seeds × 1800 s, one shard a core)
 *   npm run fuzz:long -- --seeds 40 --seconds 600 --shards 2 [--out <dir>]
 *
 * Prints each seed that broke an invariant or stalled (as the test's long mode does), then a summary; the shards' full
 * logs go to <out> (default .fuzz-long/). Exits non-zero if any shard's tests failed.
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
const SEEDS = Number(opt("seeds", 200));
const SECONDS = Number(opt("seconds", 1800));
const SHARDS = Math.max(1, Math.min(SEEDS, Number(opt("shards", Math.max(1, cpus().length)))));
const OUT = opt("out", ".fuzz-long");
mkdirSync(OUT, { recursive: true });

const per = Math.ceil(SEEDS / SHARDS);
const t0 = Date.now();
console.log(`long fuzz: ${SEEDS} seeds × ${SECONDS} s in ${SHARDS} shards (logs in ${OUT}/)`);

function shard(k) {
  const first = 1 + k * per;
  const count = Math.min(per, SEEDS - k * per);
  if (count <= 0) return Promise.resolve({ k, code: 0, lines: [] });
  return new Promise((resolve) => {
    const env = { ...process.env, ROUTING_FUZZ: String(count), ROUTING_FUZZ_FIRST: String(first), ROUTING_FUZZ_SECONDS: String(SECONDS) };
    const child = spawn("npx", ["vitest", "run", "--silent=false", "src/routing/harness-fuzz.test.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("close", (code) => {
      writeFileSync(join(OUT, `shard-${k}.log`), log);
      const lines = log.split("\n").filter((l) => /^seed \d+/.test(l.trim())).map((l) => l.trim());
      console.log(`shard ${k} (seeds ${first}-${first + count - 1}): ${code === 0 ? "passed" : "FAILED"}, ${lines.length} lines, ${((Date.now() - t0) / 60000).toFixed(1)} min`);
      resolve({ k, code, lines });
    });
  });
}

const results = await Promise.all(Array.from({ length: SHARDS }, (_, k) => shard(k)));
const lines = results.flatMap((r) => r.lines).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
for (const l of lines) console.log(l);
const broke = lines.filter((l) => !l.includes(" stalls: "));
const stalled = lines.filter((l) => l.includes(" stalls: "));
console.log(`\nlong fuzz: ${SEEDS} seeds; ${broke.length} broke an invariant, ${stalled.length} stalled (said stuck); ${results.filter((r) => r.code !== 0).length} shards failed; ${((Date.now() - t0) / 60000).toFixed(1)} min`);
process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
