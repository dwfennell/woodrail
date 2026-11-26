#!/usr/bin/env node
/**
 * The stands `scripts/jams-stands.mjs` logged, sorted proper or needless and counted by class (what the train's card
 * said most of the stand). Proper: it ended, and the train it named moved, or was worked at its stop, for at least half of it (it used the track).
 * Needless: `deadlock` (cleared as a jam, or still standing at the end), `blocker-still` (the train named stood too),
 * `long` (named one moved for under half of it), `none-named` (nothing named: the way ahead was free, or the card
 * couldn't say).
 *
 *   node tools/stands-report.mjs stands.jsonl [--list] [--map part] [--class points-wait]
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.indexOf(`--${n}`) === -1 ? d : args[args.indexOf(`--${n}`) + 1]);
const rows = readFileSync(args[0], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const seeds = new Set(rows.map((r) => r.seed)).size;
const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
export function verdict(s) {
  if (s.end === "cleared" || s.end === "end") return "deadlock";
  if (s.by < 0) return "none-named";
  // (The named train using the track: moving, or worked where it stands (loading at its stop).)
  const using = s.byMovingS + (s.byKinds?.worked ?? 0) + (s.byKinds?.["at-stop"] ?? 0);
  if (using === 0) return "blocker-still";
  if (using < s.seconds / 2) return "long";
  return "proper";
}
const all = [];
for (const r of rows) for (const s of r.stands ?? []) all.push({ map: r.map, seed: r.seed, ...s, cls: top(s.kinds), v: verdict(s) });
const want = all.filter((s) => (!opt("map") || s.map.includes(opt("map"))) && (!opt("class") || s.cls === opt("class")));
const tab = new Map();
for (const s of want) {
  const k = s.cls;
  const t = tab.get(k) ?? { n: 0, secs: 0 };
  t.n++;
  t.secs += s.seconds;
  t[s.v] = (t[s.v] ?? 0) + 1;
  tab.set(k, t);
}
const V = ["proper", "long", "blocker-still", "none-named", "deadlock"];
console.log(`${want.length} stands over ${rows.length} runs (${seeds} seeds), per seed ${(want.length / seeds).toFixed(1)}`);
console.log(["class".padEnd(22), "n".padStart(5), "s".padStart(7), ...V.map((v) => v.padStart(14))].join(""));
for (const [k, t] of [...tab].sort((a, b) => b[1].n - a[1].n)) console.log([k.padEnd(22), String(t.n).padStart(5), String(t.secs).padStart(7), ...V.map((v) => String(t[v] ?? 0).padStart(14))].join(""));
const byMap = new Map();
for (const s of want) byMap.set(s.map, (byMap.get(s.map) ?? 0) + 1);
console.log("\nby map: " + [...byMap].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m.replace(".txt", "")} ${n}`).join(", "));
if (args.includes("--list")) for (const s of want) console.log(`${s.map}@${s.seed} t=${s.at} ${s.seconds}s ${s.name}(${s.engine}) ${s.cls} ${JSON.stringify(s.kinds)} by=${s.byName}(${s.by}) moved ${s.byMovingS}s byKinds=${JSON.stringify(s.byKinds)} end=${s.end} v=${s.v} piece=${s.piece}`);
