#!/usr/bin/env node
/**
 * Every routed train's stand over 20 s on the reference maps (src/play/jams.test.ts JAMS_STANDS), sharded, raw rows
 * written as JSON lines: `node scripts/jams-stands.mjs --out stands.jsonl [--maps a.txt,b.txt] [--seeds 3] [--seconds 1800]`.
 * `node tools/stands-report.mjs stands.jsonl` sorts them proper or needless, by class. Env passes through (JAMS_DISPATCHER,
 * and any routing switch under test).
 */
import { spawn } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";

const args = process.argv.slice(2);
const opt = (n, d) => (args.indexOf(`--${n}`) === -1 ? d : args[args.indexOf(`--${n}`) + 1]);
const DIR = "src/play/bugmaps/reference";
const maps = (opt("maps", "") || readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort().join(",")).split(",");
const SEEDS = Number(opt("seeds", 3));
const SECONDS = opt("seconds", "1800");
const runs = maps.flatMap((m) => Array.from({ length: SEEDS }, (_, i) => `${m}@${i + 1}`));
const N = Math.min(runs.length, Number(opt("shards", cpus().length)));
const shards = Array.from({ length: N }, (_, k) => runs.filter((_, i) => i % N === k));
const rows = (await Promise.all(shards.map((list) => new Promise((res) => {
  const c = spawn("npx", ["vitest", "run", "--silent=false", "src/play/jams.test.ts"], { env: { ...process.env, JAMS: "1", JAMS_STANDS: "1", JAMS_RUNS: list.join(","), JAMS_SECONDS: SECONDS }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  c.stdout.on("data", (d) => (log += d));
  c.stderr.on("data", (d) => (log += d));
  c.on("close", () => res(log.split("\n").filter((l) => l.startsWith("JAMS ")).map((l) => l.slice(5))));
})))).flat();
writeFileSync(opt("out", "stands.jsonl"), rows.join("\n") + "\n");
console.log(`${rows.length}/${runs.length} runs`);
