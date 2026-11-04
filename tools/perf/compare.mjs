// Two perf runs side by side (`node tools/perf/compare.mjs <before/perf.json> <after/perf.json>`): the main measures
// of each map both ran, with the change. For a commit message or a report (docs/agents/perf.md).
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")));
const get = (o, path) => path.split(".").reduce((x, k) => (x === null || x === undefined ? x : x[k]), o);
const ROWS = [
  ["load: first visit to ready (ms)", "load.cold.readyMs"],
  ["load: reload to ready (ms)", "load.warm.readyMs"],
  ["idle: frames drawn", "idle.framesDrawn"],
  ["idle: main thread %", "idle.mainThreadPct"],
  ["paused: main thread %", "paused.mainThreadPct"],
  ["pan: frame ms p50", "pan.frameMs.p50"],
  ["pan: pointermove ms p95", "pan.events.pointermove.p95"],
  ["tray drag: pointermove ms p95", "ops.trayDrag.pointermove.p95"],
  ["research board: tap handler ms", "ops.researchBoard.syncMs"],
  ["autosave ms each", "ops.autosave.avg"],
  ["draw calls, full frame", "frame.drawCalls"],
  ["triangles k, full frame", (m) => (m.frame ? Math.round(m.frame.triangles / 1000) : undefined)],
  ["pan: triangles k, median frame", "pan.trianglesK.p50"],
  ["programs", "frame.programs"],
  ["heap MB after GC", "heapMB"],
];
const fmt = (x) => (x === undefined || x === null ? "–" : String(x));
let out = `Before: ${a.when} (${a.commit}); after: ${b.when} (${b.commit}); throttle ${b.settings.throttle}×, DPR ${b.settings.dpr}\n`;
for (const id of Object.keys(b.maps).filter((k) => a.maps[k] && !a.maps[k].failed && !b.maps[k].failed)) {
  out += `\n**${b.maps[id].label}**\n\n| | before | after | change |\n|---|---|---|---|\n`;
  for (const [name, path] of ROWS) {
    const va = typeof path === "function" ? path(a.maps[id]) : get(a.maps[id], path);
    const vb = typeof path === "function" ? path(b.maps[id]) : get(b.maps[id], path);
    if (va === undefined && vb === undefined) continue;
    const change = typeof va === "number" && typeof vb === "number" && va !== 0 ? `${vb > va ? "+" : ""}${Math.round(((vb - va) / va) * 100)}%` : "";
    out += `| ${name} | ${fmt(va)} | ${fmt(vb)} | ${change} |\n`;
  }
}
console.log(out);
