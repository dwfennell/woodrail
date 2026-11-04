// The top functions of a CPU profile (`node tools/perf/profile-top.mjs <file.cpuprofile> [<regex>] [--n 30]`): by total
// (inclusive) time, those whose name or file matches the regex if one's given. For a run.mjs --profile output.
import { readFileSync } from "node:fs";
const [file, pattern] = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--n");
const n = Number(process.argv[process.argv.indexOf("--n") + 1]) || 30;
const p = JSON.parse(readFileSync(file, "utf8"));
const byId = new Map(p.nodes.map((x) => [x.id, x]));
const self = new Map();
p.samples.forEach((s, i) => self.set(s, (self.get(s) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000));
const label = (x) => `${x.callFrame.functionName || "(anonymous)"} ${x.callFrame.url.split("/").pop()}:${x.callFrame.lineNumber + 1}`;
const total = new Map();
const selfBy = new Map();
const visit = (id, stack) => {
  const x = byId.get(id);
  const l = label(x);
  const ms = self.get(id) ?? 0;
  selfBy.set(l, (selfBy.get(l) ?? 0) + ms);
  for (const k of new Set([...stack, l])) total.set(k, (total.get(k) ?? 0) + ms);
  for (const c of x.children ?? []) visit(c, [...stack, l]);
};
visit(p.nodes[0].id, []);
const re = pattern ? new RegExp(pattern, "i") : null;
for (const [k, v] of [...total].filter(([k]) => !re || re.test(k)).sort((a, b) => b[1] - a[1]).slice(0, n)) console.log(`${v.toFixed(0).padStart(8)} ms total ${(selfBy.get(k) ?? 0).toFixed(0).padStart(7)} self  ${k}`);
