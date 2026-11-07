// The e2e suites on GitHub Actions (.github/workflows/e2e.yml), in parallel: `node scripts/e2e/ci.mjs <command>`.
//
//   plan [--suites "<units>"] [--all] [--shards n]   which suites (and groups) to run, split into shards balanced by
//                                                      rough duration (scripts/e2e/durations.json); prints JSON
//   run --units "<units>" [--shard i]                 run one shard's units as the landing gate does
//                                                      (`npm run -s e2e:<suite>`, E2E_ONLY for groups), one retry each;
//                                                      writes e2e-results/shard-<i>.json and logs to e2e-logs/
//   summary <dir> --plan <plan.json>                   every shard's results: a table ($GITHUB_STEP_SUMMARY), and
//                                                      e2e-results.json; exits 1 unless every unit passed
//
// A unit is "suite" (whole) or "suite:group,group" (E2E_ONLY), space separated: the form the gate and
// `npm run e2e:affected` use. Without --suites or --all, plan takes `node scripts/e2e/affected.mjs origin/main --json`
// plus SMOKE. Run from the tested tree (cwd); this file may be a newer copy than the tree's own (the workflow runs the
// tooling of the commit it was started from, so a dispatched older ref still plans). See docs/agents/e2e.md, "CI".
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, createWriteStream, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const CWD = process.cwd();
const HERE = dirname(fileURLToPath(import.meta.url));
const PASS_LINE = /all passed$|ALL PASS|^([0-9]+)\/\1 passed$|^([0-9]+)\/\2 PASS/i;

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name, dflt = null) => {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? dflt : (argv[i + 1] ?? "");
};
const flag = (name) => argv.includes(`--${name}`);

const pkg = () => JSON.parse(readFileSync(join(CWD, "package.json"), "utf8"));
async function suitesOf() {
  return (await import(pathToFileURL(join(CWD, "scripts/e2e/affected.mjs")).href)).SUITES;
}
function durations() {
  const own = join(CWD, "scripts/e2e/durations.json");
  return JSON.parse(readFileSync(existsSync(own) ? own : join(HERE, "durations.json"), "utf8"));
}

/** "touch:a,b kits" → Map(suite → Set | "all"). */
function parseUnits(text) {
  const want = new Map();
  for (const tok of String(text ?? "").split(/[\s]+/).filter(Boolean)) {
    const [suite, gl] = tok.split(":");
    if (!gl) want.set(suite, "all");
    else if (want.get(suite) !== "all") want.set(suite, new Set([...(want.get(suite) ?? []), ...gl.split(",").filter(Boolean)]));
  }
  return want;
}
const unitText = (suite, groups) => (groups === "all" ? suite : `${suite}:${[...groups].join(",")}`);

/** A grouped suite's groups in a full run (its `--list`, leaving out those run only when named). */
function groupsOf(suites, suite) {
  const script = pkg().scripts[suites[suite].script];
  const file = script.match(/(\S+\.mjs)\s*$/)[1];
  return execFileSync("node", [file, "--list"], { cwd: CWD, encoding: "utf8" })
    .split("\n")
    .filter((l) => l.trim() && !l.includes("(only when named)"))
    .map((l) => l.split("\t")[0].trim());
}

async function plan() {
  const suites = await suitesOf();
  const d = durations();
  let want;
  let source;
  if (flag("all")) {
    want = new Map(Object.keys(suites).map((s) => [s, "all"]));
    source = "all";
  } else if (opt("suites")?.trim()) {
    want = parseUnits(opt("suites"));
    source = "given";
  } else {
    const a = JSON.parse(execFileSync("node", ["scripts/e2e/affected.mjs", "origin/main", "--json"], { cwd: CWD, encoding: "utf8" }));
    const { SMOKE } = await import(pathToFileURL(join(CWD, "scripts/e2e/affected.mjs")).href);
    want = parseUnits([...Object.entries(a.suites).map(([s, g]) => unitText(s, g === "all" ? "all" : g)), ...SMOKE].join(" "));
    source = `affected (${a.paths.length} paths, ${a.unmapped.length} unmapped) + smoke`;
  }
  for (const s of want.keys()) if (!suites[s]) throw new Error(`ci.mjs: no suite ${s} (scripts/e2e/affected.mjs SUITES)`);

  // Units to pack: a grouped suite over SPLIT seconds is split by its groups; anything else is one unit.
  const SPLIT = 480;
  const secs = (suite, group) => {
    const whole = d.suites[suite] ?? 300;
    if (!group) return whole;
    return d.groups?.[suite]?.[group] ?? whole / Math.max(1, (d._count ??= {})[suite] ?? 1);
  };
  const units = [];
  for (const [suite, sel] of want) {
    const info = suites[suite];
    if (!info.groups) {
      units.push({ suite, groups: "all", seconds: secs(suite) });
      continue;
    }
    const all = groupsOf(suites, suite);
    (d._count ??= {})[suite] = all.length;
    const chosen = sel === "all" ? all : [...sel];
    const total = chosen.reduce((t, g) => t + secs(suite, g), 0);
    if (total <= SPLIT) units.push({ suite, groups: sel === "all" ? "all" : new Set(chosen), seconds: total });
    else for (const g of chosen) units.push({ suite, groups: new Set([g]), seconds: secs(suite, g) });
  }
  const work = units.reduce((t, u) => t + u.seconds, 0);
  const overhead = d.overhead ?? 45;
  // About 9 minutes of tests a shard, at most --shards (12: GitHub Free runs 20 jobs at once across the account, shared with other branches and Pages): a small batch on few runners (each pays a minute or two
  // to start), a wide one on many.
  const max = Number(opt("shards", "12")) || 12;
  const n = Math.max(1, Math.min(max, Math.ceil(work / 540), units.length));
  // Longest first, each to the least loaded shard (a suite's first unit on a shard pays its start-up).
  const shards = Array.from({ length: n }, () => ({ load: 0, units: [] }));
  for (const u of [...units].sort((a, b) => b.seconds - a.seconds)) {
    const cost = (s) => s.load + u.seconds + (s.units.some((x) => x.suite === u.suite) ? 0 : overhead);
    const best = shards.reduce((a, b) => (cost(b) < cost(a) ? b : a));
    best.load = cost(best);
    best.units.push(u);
  }
  // One invocation per suite per shard (its groups together, in the suite's own order).
  const include = shards
    .filter((s) => s.units.length)
    .map((s, i) => {
      const bySuite = new Map();
      for (const u of s.units) {
        const prev = bySuite.get(u.suite);
        if (u.groups === "all" || prev === "all") bySuite.set(u.suite, "all");
        else bySuite.set(u.suite, new Set([...(prev ?? []), ...u.groups]));
      }
      const text = [...bySuite]
        .map(([suite, g]) => {
          if (g === "all") return suite;
          const order = groupsOf(suites, suite);
          return unitText(suite, [...g].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
        })
        .join(" ");
      const dist = [...bySuite.keys()].some((suite) => /^npm run build && /.test(pkg().scripts[suites[suite].script]));
      return { shard: String(i + 1), units: text, minutes: Math.round(s.load / 6) / 10, dist };
    });
  const out = { source, shards: include.length, work_minutes: Math.round(work / 6) / 10, units: [...want].map(([s, g]) => unitText(s, g)), include };
  console.log(JSON.stringify(out, null, flag("pretty") ? 1 : 0));
}

/** Run a command, streaming and logging its output; resolves { code, last, seconds }. Killed past `timeoutMs`. */
function exec(command, env, logPath, timeoutMs) {
  return new Promise((done) => {
    const t0 = Date.now();
    const log = createWriteStream(logPath, { flags: "a" });
    const child = spawn("sh", ["-c", command], { cwd: CWD, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let tail = "";
    const take = (d) => {
      process.stdout.write(d);
      log.write(d);
      tail = (tail + d.toString()).split("\n").slice(-60).join("\n");
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      take(`\n(ci.mjs: timed out after ${Math.round(timeoutMs / 60000)} min; killed)\n`);
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
    }, timeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      // (Anything the suite left behind: a browser, a dev server.)
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
      log.end();
      const last = tail.split("\n").map((l) => l.trim()).filter((l) => PASS_LINE.test(l)).at(-1) ?? "";
      done({ code: code ?? (signal ? 1 : 0), timedOut, last, seconds: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

async function run() {
  const suites = await suitesOf();
  const d = durations();
  const shard = opt("shard", "1");
  const want = parseUnits(opt("units"));
  mkdirSync(join(CWD, "e2e-logs"), { recursive: true });
  mkdirSync(join(CWD, "e2e-results"), { recursive: true });
  const results = [];
  const scripts = pkg().scripts;
  const deadline = Date.now() + Number(process.env.E2E_DEADLINE_MIN ?? 70) * 60000;
  for (const [suite, groups] of want) {
    const info = suites[suite];
    const unit = unitText(suite, groups);
    const env = { ...process.env, CI: "1" };
    if (groups !== "all") env.E2E_ONLY = [...groups].join(",");
    // A suite whose script builds first (tray) runs on the build job's dist/ instead: one build a workflow.
    let command = `npm run -s ${info.script}`;
    const body = scripts[info.script];
    if (/^npm run build && /.test(body) && existsSync(join(CWD, "dist/index.html"))) command = body.replace(/^npm run build && /, "");
    const est = groups === "all" ? (d.suites[suite] ?? 300) : [...groups].reduce((t, g) => t + (d.groups?.[suite]?.[g] ?? 300), 0);
    // (A hung suite is killed: twice its estimate, 10 to 40 min. The durations are from a 4-core box; GitHub's runners
    // ran the suites in about half that.)
    const timeoutMs = Math.min(40, Math.max(10, Math.ceil((est * 2) / 60))) * 60000;
    const logPath = join(CWD, "e2e-logs", `${suite}.log`);
    const attempts = [];
    if (Date.now() > deadline) {
      console.log(`::error::${unit} not run: the shard is out of time (E2E_DEADLINE_MIN)`);
      results.push({ unit, suite, groups: groups === "all" ? "all" : [...groups], result: "fail", seconds: 0, attempts: [{ ok: false, code: null, seconds: 0, last: "not run: shard out of time" }] });
      continue;
    }
    for (let k = 1; k <= 2; k++) {
      const head = `${env.E2E_ONLY ? `E2E_ONLY=${env.E2E_ONLY} ` : ""}${command}${k > 1 ? "   (retry: groups that passed are cached)" : ""}`;
      console.log(`::group::${unit}${k > 1 ? " (retry)" : ""}`);
      console.log(`=== ${head}`);
      appendFileSync(logPath, `\n=== attempt ${k}: ${head}\n`);
      const r = await exec(command, env, logPath, timeoutMs);
      console.log("::endgroup::");
      const ok = r.code === 0 && !!r.last;
      attempts.push({ ok, code: r.code, timedOut: r.timedOut, seconds: r.seconds, last: r.last });
      console.log(`${ok ? "PASS" : "FAIL"} ${unit} in ${r.seconds}s${r.last ? ` (${r.last})` : " (no pass line)"}${r.code ? ` exit ${r.code}` : ""}`);
      if (ok) break;
      // (No retry past the shard's budget, E2E_DEADLINE_MIN after it started: the job's own timeout would kill it
      // and lose every result.)
      const left = deadline - Date.now();
      if (k === 1 && left < Math.min(timeoutMs, r.seconds * 1000 + 60000)) {
        console.log(`::warning::${unit} failed (exit ${r.code}${r.timedOut ? ", timed out" : ""}); no time left in the shard to retry`);
        break;
      }
      if (k === 1) console.log(`::warning::${unit} failed (exit ${r.code}${r.timedOut ? ", timed out" : ""}); retrying once`);
    }
    const passed = attempts.at(-1).ok;
    const result = passed ? (attempts.length > 1 ? "flaky" : "pass") : "fail";
    if (!passed) console.log(`::error::${unit} failed twice: see e2e-logs-${shard} (${suite}.log)`);
    results.push({ unit, suite, groups: groups === "all" ? "all" : [...groups], result, seconds: attempts.reduce((t, a) => t + a.seconds, 0), attempts });
  }
  const out = { shard, tree: git("rev-parse", "HEAD^{tree}"), sha: git("rev-parse", "HEAD"), results };
  writeFileSync(join(CWD, "e2e-results", `shard-${shard}.json`), JSON.stringify(out, null, 1));
  const bad = results.filter((r) => r.result === "fail");
  console.log(`\nshard ${shard}: ${results.length - bad.length}/${results.length} suites passed`);
  process.exit(bad.length ? 1 : 0);
}

function git(...a) {
  try { return execFileSync("git", a, { cwd: CWD, encoding: "utf8" }).trim(); } catch { return ""; }
}

function summary() {
  const dir = argv[1];
  const planned = JSON.parse(readFileSync(opt("plan"), "utf8"));
  const shards = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => /shard-.*\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8"))) : [];
  const results = shards.flatMap((s) => s.results.map((r) => ({ ...r, shard: s.shard })));
  const trees = [...new Set(shards.map((s) => s.tree))];
  // A shard that never wrote its results (cancelled, crashed, its runner lost): its units are missing, not passed.
  const seen = new Set(shards.map((s) => s.shard));
  for (const sh of planned.include) if (!seen.has(sh.shard)) for (const unit of sh.units.split(" ")) results.push({ unit, suite: unit.split(":")[0], result: "missing", seconds: 0, shard: sh.shard });
  const tree = process.env.E2E_TREE || trees[0] || "";
  const failed = results.filter((r) => r.result === "fail" || r.result === "missing");
  const treeOk = trees.length <= 1 && (!process.env.E2E_TREE || trees.every((t) => t === process.env.E2E_TREE));
  const ok = failed.length === 0 && treeOk && results.length > 0 === planned.include.length > 0;
  // Measured seconds a suite or group, to refresh durations.json (a unit of one group: that group's).
  const measured = { suites: {}, groups: {} };
  for (const r of results) {
    if (r.result !== "pass") continue;
    if (r.groups === "all") measured.suites[r.suite] = r.seconds;
    else if (r.groups?.length === 1) (measured.groups[r.suite] ??= {})[r.groups[0]] = r.seconds;
  }
  const file = {
    ok,
    tree,
    trees,
    ref: process.env.E2E_REF ?? "",
    sha: process.env.E2E_SHA ?? "",
    main: process.env.E2E_MAIN ?? "",
    source: planned.source,
    units: planned.units,
    runner_seconds: results.reduce((t, r) => t + r.seconds, 0),
    results: results.map(({ attempts, ...r }) => ({ ...r, attempts: attempts?.length ?? 0, last: attempts?.at(-1)?.last ?? "" })),
    measured,
  };
  writeFileSync("e2e-results.json", JSON.stringify(file, null, 1));
  const icon = { pass: "✅ pass", flaky: "⚠️ flaky (passed on retry)", fail: "❌ fail", missing: "❌ missing (shard didn't report)" };
  const lines = [
    `## e2e: ${ok ? "✅ passed" : "❌ failed"}`,
    "",
    `Tested tree \`${tree}\` (${process.env.E2E_REF ?? ""} merged with main \`${(process.env.E2E_MAIN ?? "").slice(0, 10)}\`). Selection: ${planned.source}; ${planned.include.length} shards, ${planned.work_minutes} min estimated.`,
    treeOk ? "" : `\n**Shards tested different trees: ${trees.join(", ")}**`,
    "",
    "| suite | result | seconds | shard |",
    "|---|---|---:|---:|",
    ...results.sort((a, b) => (a.result === "pass") - (b.result === "pass") || b.seconds - a.seconds).map((r) => `| \`${r.unit}\` | ${icon[r.result]} | ${r.seconds} | ${r.shard} |`),
    "",
    `Suite time, summed: ${Math.round(file.runner_seconds / 60)} min. Logs of a failed shard: artifact \`e2e-logs-<shard>\`. Results: artifact \`e2e-results\` (e2e-results.json).`,
  ];
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  process.exit(ok ? 0 : 1);
}

if (cmd === "plan") await plan();
else if (cmd === "run") await run();
else if (cmd === "summary") summary();
else {
  console.error("usage: node scripts/e2e/ci.mjs plan|run|summary …");
  process.exit(2);
}
