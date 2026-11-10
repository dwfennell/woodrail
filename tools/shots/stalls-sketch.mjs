// Track sketches of the long fuzz's stalled seeds (docs/agents/stalls-verify-2026-11-10.md): from the dumps
// src/routing/stalls-verify.test.ts writes (STALLS_OUT), each seed drawn twice, as put down and at its first stall;
// the trains as thick bars with an arrow at the end they drive to, what each waits for, the oracle's verdict.
//
// Usage: node tools/shots/stalls-sketch.mjs <dump dir> <out.jpg> <title> <seed,seed,…>
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const [DIR, OUT, TITLE, SEEDS] = process.argv.slice(2);
const seeds = SEEDS.split(",").map(Number);
const COL = ["#d1495b", "#2e86ab", "#3b9c4b"];
const W = 760, H = 200;

function panel(d, which, label) {
  const trains = which === "start" ? d.start : (d.atStall ?? d.end);
  const pts = d.track.flatMap((p) => p.paths.flat());
  const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
  const x0 = Math.min(...xs) - 60, x1 = Math.max(...xs) + 60, z0 = Math.min(...zs) - 120, z1 = Math.max(...zs) + 120;
  const k = Math.min((W - 20) / (x1 - x0), (H - 50) / (z1 - z0));
  const X = (x) => 10 + (x - x0) * k, Z = (z) => 40 + (z - z0) * k;
  const stops = new Set(d.start.flatMap((t) => t.stops ?? []));
  let s = `<g><text x="10" y="18" class="h">${label}</text>`;
  for (const p of d.track) {
    const cls = p.type.startsWith("buffer") ? "buf" : p.type === "switch" ? "sw" : stops.has(p.id) ? "stop" : "rail";
    for (const path of p.paths) s += `<polyline class="${cls}" points="${path.map((q) => `${X(q[0]).toFixed(1)},${Z(q[1]).toFixed(1)}`).join(" ")}"/>`;
    const mid = p.paths[0][4];
    s += `<text class="id" x="${X(mid[0]).toFixed(1)}" y="${(Z(mid[1]) + (p.type === "switch" ? -9 : 16)).toFixed(1)}">${stops.has(p.id) ? "▣" : ""}${p.id}</text>`;
  }
  trains.forEach((t, i) => {
    if (t.gone) return;
    const c = COL[i % 3];
    const q = t.pts.map((p) => [X(p[0]), Z(p[1])]);
    s += `<polyline style="stroke:${c}" class="train" points="${q.map((p) => p.join(",")).join(" ")}"/>`;
    // (Arrow at the front, the end it drives to: pts are front first.)
    const [f, b] = [q[0], q[1] ?? q[0]];
    const a = Math.atan2(f[1] - b[1], f[0] - b[0]);
    const tip = [f[0] + Math.cos(a) * 16, f[1] + Math.sin(a) * 16];
    s += `<polygon style="fill:${c}" points="${tip.join(",")} ${f[0] + Math.cos(a + 2.2) * 13},${f[1] + Math.sin(a + 2.2) * 13} ${f[0] + Math.cos(a - 2.2) * 13},${f[1] + Math.sin(a - 2.2) * 13}"/>`;
    const why = t.stuck ? `stuck: ${t.stuck.kind}` : t.sectionsWait ? `waits (${t.sectionsWait.kind})` : t.speed > 0 ? "running" : t.heldHow ? `held (${t.heldHow})` : "";
    const route = t.stops ? `stops ${t.stops.join("⇄")}` : "hand-run";
    s += `<text class="lab" style="fill:${c}" x="${(10 + i * 250)}" y="${H - 4}">t${i}: ${route}, next ${t.goal ?? "-"}${which === "start" ? "" : ` · ${why}`}</text>`;
  });
  return s + "</g>";
}

let body = "";
let y = 50;
for (const seed of seeds) {
  const d = JSON.parse(readFileSync(`${DIR}/seed-${seed}.json`, "utf8"));
  const o = d.oracle;
  const n = d.start.length;
  const v = (r) => `${r.best} of ${n}`;
  body += `<text class="seed" x="12" y="${y}">seed ${seed} — oracle: trains that could keep delivering, from the start ${v(o.startAny)}, from the stall ${v(o.stallAny)} · game: stops ${d.arrivals.join("/")} in 30 min</text>`;
  body += `<g transform="translate(0 ${y + 6})">${panel(d, "start", "as put down")}</g>`;
  body += `<g transform="translate(${W + 20} ${y + 6})">${panel(d, "stall", `at the stall (${d.stallAt} s)`)}</g>`;
  y += H + 40;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * W + 30}" height="${y}" viewBox="0 0 ${2 * W + 30} ${y}">
<style>
text{font-family:Helvetica,Arial,sans-serif}
.t{font-size:20px;font-weight:700;fill:#222}.seed{font-size:15px;font-weight:700;fill:#333}.h{font-size:13px;fill:#666}
.id{font-size:10px;fill:#888;text-anchor:middle}.lab{font-size:12px;font-weight:600}
polyline{fill:none;stroke-linecap:round;stroke-linejoin:round}
.rail{stroke:#b9a27c;stroke-width:5}.sw{stroke:#7a5c2e;stroke-width:5}.stop{stroke:#e6b800;stroke-width:9}.buf{stroke:#333;stroke-width:9}
.train{stroke-width:11;opacity:.9}
</style><rect width="100%" height="100%" fill="#fbf8f2"/><text class="t" x="12" y="26">${TITLE}</text>${body}</svg>`;
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: CHROMIUM });
const p = await b.newPage({ viewport: { width: 2 * W + 30, height: y }, deviceScaleFactor: 1 });
await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await p.screenshot({ path: OUT, type: "jpeg", quality: 85, fullPage: true });
await b.close();
console.log(OUT);
