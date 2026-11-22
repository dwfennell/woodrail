#!/usr/bin/env node
/**
 * The jams bar (dispatcher spec §8 step 0, docs/superpowers/specs/2026-11-18-dispatcher.md): the reference maps in
 * src/play/bugmaps/reference/ run as a player would play them, each jam cleared as a player would clear it
 * (src/play/jams.ts), sharded over the cores. Prints per map: jams, stops made, the longest stand, the first invariant
 * broken. Its floor is src/play/bugmaps/reference/baseline.json (main's numbers).
 *
 *   npm run jams                         (every map, 1800 s)
 *   npm run jams -- --check              (fails on a map worse than its baseline: more jams, fewer stops, or a break)
 *   npm run jams -- --update             (writes this run as the baseline)
 *   npm run jams -- --maps wren.txt,complex-1.txt --seconds 600 --shards 4
 *   npm run jams -- --seeds 3 [--out a.json] [--against b.json]
 *                                        (each map run with seeds 1…3 (src/play/jams.ts `startsOf`: its trains set going a
 *                                        few seconds apart; seed 1 is the map as saved): mean, min and max per map;
 *                                        `--out` writes them, `--against` a run written so compares its means)
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const DIR = "src/play/bugmaps/reference";
const BASE = `${DIR}/baseline.json`;
const SECONDS = Number(opt("seconds", 1800));
const maps = (opt("maps", "") || readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort().join(",")).split(",");
const SEEDS = Math.max(1, Number(opt("seeds", 1)));
const runsAll = maps.flatMap((m) => Array.from({ length: SEEDS }, (_, i) => `${m}@${i + 1}`));
const SHARDS = Math.max(1, Math.min(runsAll.length, Number(opt("shards", Math.max(1, cpus().length)))));
const t0 = Date.now();
console.log(`jams: ${maps.length} maps${SEEDS > 1 ? ` × ${SEEDS} seeds` : ""} × ${SECONDS} s in ${SHARDS} shards`);

function run(list) {
  return new Promise((resolve) => {
    const env = { ...process.env, JAMS: "1", ...(SEEDS > 1 ? { JAMS_RUNS: list.join(",") } : { JAMS_MAPS: list.map((x) => x.split("@")[0]).join(",") }), JAMS_SECONDS: String(SECONDS), ...(args.includes("--shadow") ? { JAMS_SHADOW: "1" } : {}) };
    const child = spawn("npx", ["vitest", "run", "--silent=false", "src/play/jams.test.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("close", (code) => {
      const rows = log.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("JAMS ")).map((l) => JSON.parse(l.slice(5)));
      if (code !== 0 || rows.length !== list.length) console.log(`  ${list.join(",")}: ${code !== 0 ? "FAILED" : "missing rows"}\n${log.slice(-2000)}`);
      resolve(rows);
    });
  });
}

const shards = Array.from({ length: SHARDS }, (_, k) => runsAll.filter((_, i) => i % SHARDS === k));
const all = (await Promise.all(shards.map(run))).flat().sort((a, b) => a.map.localeCompare(b.map) || (a.seed ?? 1) - (b.seed ?? 1));
if (SEEDS > 1) {
  // (Seeds: per map, mean (min–max) of stops and jams, and how many seeds broke an invariant (the first's, said).)
  const by = new Map();
  for (const r of all) by.set(r.map, [...(by.get(r.map) ?? []), r]);
  const against = (() => {
    const f = opt("against", "");
    return f ? JSON.parse(readFileSync(f, "utf8")) : null;
  })();
  const pad = (s, n) => String(s).padEnd(n);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(`${pad("map", 30)}${pad("stops mean (min–max)", 26)}${against ? pad("vs", 14) : ""}${pad("1st jam s", 14)}${pad("stuck s", 9)}${pad("jams mean", 11)}${pad("breaks", 8)}${process.env.JAMS_DISPATCHER ? pad("decide p98/max", 18) : ""}first break`);
  const out = {};
  let lower = 0;
  for (const [map, rs] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    const st = rs.map((r) => r.arrivals);
    const ms = rs.map((r) => r.dispatcher?.ms).filter(Boolean);
    const fj = rs.map((r) => r.firstJam ?? SECONDS);
    const m = { stops: mean(st), min: Math.min(...st), max: Math.max(...st), firstJam: mean(fj), firstJamMin: Math.min(...fj), stuckBefore: mean(rs.map((r) => r.stuckBefore ?? 0)), jams: mean(rs.map((r) => r.jams)), ...(ms.length ? { p98: Math.max(...ms.map((x) => x.p98)), maxMs: Math.max(...ms.map((x) => x.max)) } : {}), breaks: rs.filter((r) => r.firstBreak).length, firstBreak: rs.find((r) => r.firstBreak)?.firstBreak ?? null, seeds: rs.length, seconds: SECONDS };
    // (Seconds granted trains stood short of their grants, by what held them, mean over seeds: §13.5 step 1.)
    const ov = {};
    for (const r of rs) for (const [k, v] of Object.entries(r.dispatcher?.overruled ?? {})) ov[k] = (ov[k] ?? 0) + v / rs.length;
    if (Object.keys(ov).length) m.overruled = Object.fromEntries(Object.entries(ov).map(([k, v]) => [k, Math.round(v)]));
    out[map] = m;
    const a = against?.[map];
    const d = a ? m.stops - a.stops : 0;
    // (Lower: stops mean below, or a first jam sooner on the mean, or more seeds broken. `--bar first-jam`: the first
    // jam no sooner on the mean, stops no lower than the other's min, no more seeds broken.)
    const firstBar = opt("bar", "") === "first-jam";
    const flag = a && (firstBar ? m.firstJam < (a.firstJam ?? SECONDS) || m.min < a.min || m.breaks > a.breaks : d < 0 || m.breaks > a.breaks) ? "   LOWER" : "";
    if (flag) lower++;
    console.log(`${pad(map, 30)}${pad(`${m.stops.toFixed(0)} (${m.min}–${m.max})`, 26)}${a ? pad(`${a.stops.toFixed(0)} ${d >= 0 ? "+" : ""}${d.toFixed(0)}`, 14) : ""}${pad(`${m.firstJam.toFixed(0)}${a?.firstJam !== undefined ? ` (${a.firstJam.toFixed(0)})` : ""}`, 14)}${pad(m.stuckBefore.toFixed(0), 9)}${pad(m.jams.toFixed(1), 11)}${pad(`${m.breaks}/${rs.length}`, 8)}${m.p98 !== undefined ? pad(`${m.p98}/${m.maxMs} ms`, 18) : ""}${m.firstBreak ?? "-"}${flag}`);
  }
  if (Object.values(out).some((m) => m.overruled)) {
    console.log(`\ngrants overruled (s granted trains stood short, mean over seeds, by what held them)`);
    for (const [map, m] of Object.entries(out)) if (m.overruled) console.log(`${pad(map, 30)}${Object.entries(m.overruled).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("  ")}`);
  }
  console.log(`(${((Date.now() - t0) / 60000).toFixed(1)} min${against ? `; ${lower} map(s) lower on the mean, or more seeds broken, than ${opt("against", "")}` : ""})`);
  if (opt("out", "")) {
    writeFileSync(opt("out", ""), JSON.stringify(out, null, 1) + "\n");
    console.log(`wrote ${opt("out", "")}`);
  }
  process.exit(all.length === runsAll.length ? 0 : 1);
}
const rows = all;
const base = (() => {
  try {
    return JSON.parse(readFileSync(BASE, "utf8"));
  } catch {
    return {};
  }
})();
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("map", 26)}${pad("jams", 12)}${pad("stops", 14)}${pad("longest s", 12)}break`);
let worse = 0;
for (const r of rows) {
  const b = base[r.map];
  const bad = b && b.seconds === r.seconds && (r.jams > b.jams || r.arrivals < b.arrivals || (r.firstBreak && !b.firstBreak));
  if (bad) worse++;
  const vs = (x, y) => (b && b.seconds === r.seconds ? `${x} (${y})` : `${x}`);
  console.log(`${pad(r.map, 26)}${pad(vs(r.jams, b?.jams), 12)}${pad(vs(r.arrivals, b?.arrivals), 14)}${pad(r.longestStand, 12)}${r.firstBreak ?? "-"}${bad ? "   WORSE" : ""}`);
}
console.log(`(baseline in brackets; ${((Date.now() - t0) / 60000).toFixed(1)} min)`);
// (--shadow: the dispatcher's first report: each jam judged by the oracle, now and before it began.)
if (args.includes("--shadow")) {
  console.log(`\ndispatcher shadow: each jam, could a dispatcher keep every train going?`);
  console.log(`${pad("map", 26)}${pad("resolvable", 12)}${pad("avoidable", 11)}${pad("backup", 8)}${pad("layout", 8)}${pad("unknown", 9)}search ms (max)`);
  const all = { resolvable: 0, avoidable: 0, backup: 0, layout: 0, unknown: 0 };
  for (const r of rows) {
    const c = { resolvable: 0, avoidable: 0, backup: 0, layout: 0, unknown: 0 };
    let ms = 0;
    for (const j of r.shadow ?? []) {
      c[j.verdict]++;
      all[j.verdict]++;
      ms = Math.max(ms, j.now.ms, j.before?.ms ?? 0);
    }
    console.log(`${pad(r.map, 26)}${pad(c.resolvable, 12)}${pad(c.avoidable, 11)}${pad(c.backup, 8)}${pad(c.layout, 8)}${pad(c.unknown, 9)}${ms}`);
  }
  console.log(`${pad("all", 18)}${pad(all.resolvable, 12)}${pad(all.avoidable, 11)}${pad(all.backup, 8)}${pad(all.layout, 8)}${pad(all.unknown, 9)}`);
  writeFileSync(".jams-shadow.json", JSON.stringify(rows.map((r) => ({ map: r.map, shadow: r.shadow })), null, 1));
  console.log("(each jam's judgements in .jams-shadow.json)");
}
if (args.includes("--update")) {
  const out = { ...base };
  for (const r of rows) out[r.map] = { jams: r.jams, arrivals: r.arrivals, longestStand: r.longestStand, firstBreak: r.firstBreak, seconds: r.seconds };
  writeFileSync(BASE, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${BASE}`);
}
if (rows.length !== maps.length) process.exit(1);
if (args.includes("--check") && worse > 0) {
  console.log(`${worse} map(s) worse than the baseline`);
  process.exit(1);
}
