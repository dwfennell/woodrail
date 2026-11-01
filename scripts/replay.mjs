#!/usr/bin/env node
/**
 * Replay a copied map ("Copy map for a bug report": a `woodrail-map:1:…` text in a file) headless, seeded, with the
 * train invariants on every tick (src/play/bugmap.ts), and print the first break, or that they held.
 *
 *   npm run replay -- <file> [--seconds 600] [--seed 1] [--all]
 *
 * `--all` runs on past the first break and lists them all. Exits 1 on a break (or a map that doesn't load).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const file = args.find((a, i) => !a.startsWith("--") && !["--seconds", "--seed"].includes(args[i - 1]));
if (!file || !existsSync(file)) {
  console.error("usage: npm run replay -- <file with a copied map> [--seconds 600] [--seed 1] [--all]");
  process.exit(2);
}
const env = { ...process.env, REPLAY_FILE: resolve(file), REPLAY_SECONDS: opt("seconds") ?? "600", REPLAY_SEED: opt("seed") ?? "1", ...(args.includes("--all") ? { REPLAY_ALL: "1" } : {}) };
const r = spawnSync("npx", ["vitest", "run", "--silent=false", "src/play/bugmaps/bugmaps.test.ts", "-t", "replay a copied map"], { env, encoding: "utf8" });
const out = (r.stdout ?? "") + (r.stderr ?? "");
const lines = out.split("\n").filter((l) => l.startsWith("replay: "));
for (const l of lines) console.log(l.slice("replay: ".length));
if (lines.length === 0) console.log(out.split("\n").filter((l) => /Error|FAIL/.test(l)).slice(0, 10).join("\n") || out.slice(-2000));
process.exit(r.status ?? 1);
