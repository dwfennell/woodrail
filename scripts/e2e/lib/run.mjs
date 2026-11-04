// Run an end-to-end suite that has no groups of its own as one group, "all": `node scripts/e2e/lib/run.mjs <script.mjs>
// [args]`. The package.json e2e scripts go through this, so every suite answers `-- --list`, E2E_ONLY and resume the
// same way (scripts/e2e/lib/groups.mjs): a full run that passed is recorded for the source tree, and run again on the
// same tree it prints "group all: cached pass" and the run's last line again ("ALL PASS", "N/N passed", …), so a
// gate that greps it still finds it. A suite with groups of its own (it imports groups.mjs) is just run.
//
// Not cached: a run given arguments (an out dir for pictures: it's run for them), or E2E_ONLY naming anything but
// "all" (passed through to the suite as it is).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ROOT, sourceKey } from "./groups.mjs";

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error("usage: node scripts/e2e/lib/run.mjs <script.mjs> [args]");
  process.exit(2);
}
const file = resolve(ROOT, script);
const own = readFileSync(file, "utf8").includes("lib/groups.mjs");
const suite = basename(file, ".mjs");
// The line a gate greps for (scripts/e2e/README: `all passed$|ALL PASS|^N/N passed$|^N/N PASS`).
const PASS_LINE = /all passed$|ALL PASS|^([0-9]+)\/\1 passed$|^([0-9]+)\/\2 PASS/i;

const exec = (env = process.env) =>
  new Promise((done) => {
    const child = spawn(process.execPath, [file, ...args], { cwd: ROOT, env, stdio: ["inherit", "pipe", "inherit"] });
    let last = "";
    let tail = "";
    child.stdout.on("data", (d) => {
      process.stdout.write(d);
      tail = (tail + d.toString()).split("\n").slice(-50).join("\n");
    });
    // (Forward a kill to the suite, so its browser goes with it.)
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
    child.on("close", (code, signal) => {
      last = tail.split("\n").map((l) => l.trim()).filter((l) => PASS_LINE.test(l)).at(-1) ?? "";
      done({ code: code ?? (signal ? 1 : 0), last });
    });
  });

if (own) {
  const r = await exec();
  process.exit(r.code);
}

if (args.includes("--list")) {
  console.log("all\tthe whole suite (no groups of its own yet)");
  process.exit(0);
}
const only = (process.env.E2E_ONLY ?? "").split(",").filter(Boolean);
// E2E_ONLY=all is this one group; anything else is the suite's own (passed through, uncached).
const env = { ...process.env };
if (only.length === 1 && only[0] === "all") delete env.E2E_ONLY;
const cacheable = args.length === 0 && !env.E2E_ONLY && !process.env.E2E_SHARD;
if (process.env.E2E_SHARD && !/^1\//.test(process.env.E2E_SHARD)) {
  // (One group: it's in the first slice only.)
  console.log(`(${suite}: one group, in slice 1 only)\n0/0 passed`);
  process.exit(0);
}
const key = sourceKey();
const store = join(ROOT, ".e2e-cache", suite, `${key}.json`);
if (cacheable && process.env.E2E_RESUME !== "0" && existsSync(store)) {
  try {
    const prior = JSON.parse(readFileSync(store, "utf8")).groups?.all;
    if (prior?.last) {
      console.log(`group all: cached pass (${prior.seconds}s on ${prior.at}; source ${key}; E2E_RESUME=0 runs it again)`);
      console.log(prior.last);
      process.exit(0);
    }
  } catch {
    /* run it */
  }
}
const t0 = Date.now();
const r = await exec(env);
if (cacheable && r.code === 0 && r.last) {
  mkdirSync(join(ROOT, ".e2e-cache", suite), { recursive: true });
  const state = { suite, key, groups: { all: { last: r.last, seconds: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() } } };
  writeFileSync(store + ".tmp", JSON.stringify(state, null, 1));
  renameSync(store + ".tmp", store);
}
process.exit(r.code);
