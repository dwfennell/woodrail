#!/usr/bin/env node
/**
 * Trajectory hashes: prove a refactor leaves the trains' moves unchanged. Records a hash of every Sim's trains and
 * switches once a simulated second (record.ts) while vitest runs some tests, on this tree and on a base ref, and diffs.
 *
 *   node scripts/trajectory/trajectory.mjs [--base origin/main] [--out <dir>] [--env K=V]... -- <vitest args>
 *
 * e.g. `--env BALANCE=1 --env BALANCE_SEED=1 -- src/play/balance.test.ts`; `--env TRAJ_SWITCHES=0` hashes the trains
 * only (points restored after a train has gone change the switches, not where it runs). The base is checked out in a worktree
 * (.trajectory/base-<sha>, node_modules linked) and reused, and so is its recording (`--fresh` redoes it); its tests
 * run unchanged, only the recorder is added. Prints
 * each test's sims and seconds compared, and the first second that differs; exits 1 on any difference. Each run's
 * vitest output is kept beside its hashes (vitest.log: for SHOW=1 rows and the like).
 * `--rename <new>=<old>` runs a moved test file under its old path on the base. `--diff <a> <b>` compares two recorded
 * folders; `--base-only` records just the base (to reuse later).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(new URL("../..", import.meta.url).pathname);
const config = join(repo, "scripts/trajectory/vitest.config.ts");
const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const opts = dash === -1 ? argv : argv.slice(0, dash);
const vitestArgs = dash === -1 ? [] : argv.slice(dash + 1);
const opt = (name, dflt) => {
  const i = opts.indexOf(name);
  return i === -1 ? dflt : opts[i + 1];
};
const envs = Object.fromEntries(opts.flatMap((o, i) => (opts[i - 1] === "--env" ? [o.split(/=(.*)/s).slice(0, 2)] : [])));

function read(dir) {
  const out = new Map();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsv"))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line) continue;
      const [key, t, h] = line.split("\t");
      // (Keyed by the test's name and the sim's number in it, not the file: a test file may move.)
      const k = key;
      if (!out.has(k)) out.set(k, []);
      out.get(k).push([t, h]);
    }
  }
  return out;
}

function diff(a, b) {
  const A = read(a);
  const B = read(b);
  let bad = 0;
  let seconds = 0;
  for (const k of new Set([...A.keys(), ...B.keys()])) {
    const x = A.get(k) ?? [];
    const y = B.get(k) ?? [];
    let first = -1;
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i]?.[0] !== y[i]?.[0] || x[i]?.[1] !== y[i]?.[1]) {
        first = i;
        break;
      }
    }
    seconds += x.length;
    if (first !== -1) {
      bad++;
      console.log(`DIFF ${k}: first at ${x[first]?.[0] ?? y[first]?.[0]} s (${x.length} vs ${y.length} s recorded)`);
    }
  }
  console.log(`${A.size} sims (${seconds} s) in base, ${B.size} in head: ${bad === 0 ? "identical" : `${bad} differ`}`);
  return bad === 0;
}

/** `--rename new=old`: a test file the base has under another path (the base's run asks for the old one). */
const renames = opts.flatMap((o, i) => (opts[i - 1] === "--rename" ? [o.split("=")] : []));
const baseArgs = vitestArgs.map((a) => renames.find(([n]) => n === a)?.[1] ?? a);

function record(tree, out, args) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const r = spawnSync("npx", ["vitest", "run", "-c", config, ...args], {
    cwd: tree,
    env: { ...process.env, ...envs, TRAJ_OUT: out },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  writeFileSync(join(out, "vitest.log"), r.stdout + r.stderr);
  const tail = (r.stdout + r.stderr).split("\n").filter((l) => /Test Files|Tests |FAIL|Duration/.test(l));
  console.log(`[${tree === repo ? "head" : "base"}] ${tail.join(" · ")}`);
}

if (opts[0] === "--diff") process.exit(diff(opts[1], opts[2]) ? 0 : 1);

const base = opt("--base", "origin/main");
const out = resolve(opt("--out", join(repo, ".trajectory/run")));
const sha = execFileSync("git", ["rev-parse", base], { cwd: repo, encoding: "utf8" }).trim();
const wt = join(repo, ".trajectory", `base-${sha.slice(0, 10)}`);
if (!existsSync(wt)) {
  execFileSync("git", ["worktree", "add", "--detach", wt, sha], { cwd: repo, stdio: "ignore" });
  symlinkSync(join(repo, "node_modules"), join(wt, "node_modules"));
}
// (The base's recording is kept per base commit, env and args, and reused: the base doesn't change.)
const key = createHash("sha1").update(JSON.stringify([sha, envs, baseArgs])).digest("hex").slice(0, 12);
const baseRec = join(repo, ".trajectory", `rec-${key}`);
if (!existsSync(join(baseRec, ".done")) || opts.includes("--fresh")) {
  record(wt, baseRec, baseArgs);
  writeFileSync(join(baseRec, ".done"), "");
} else console.log(`[base] reused ${baseRec}`);
// (`--base-only`: just record the base, to be reused by a later run.)
if (opts.includes("--base-only")) process.exit(0);
record(repo, join(out, "head"), vitestArgs);
process.exit(diff(baseRec, join(out, "head")) ? 0 : 1);
