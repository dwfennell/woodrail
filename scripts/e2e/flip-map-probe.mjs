// Probe (temporary): on a saved map, a curve carried to every free end, shown (the hover path), then Flip: does the
// shape it would lay change? `node scripts/e2e/flip-map-probe.mjs <map.txt>`
import { existsSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { batterySaverIn } from "./lib/fast.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const text = readFileSync(process.argv[2], "utf8").trim();
const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
batterySaverIn(b);
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror", String(e)));
await p.goto(`${server.resolvedUrls.local[0].replace(/\/$/, "")}/#load=${encodeURIComponent(text)}`);
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 300000 });
await p.keyboard.press("Escape");
await p.evaluate(() => (window.woodrail.paused = true));
const types = (process.env.TYPES ?? "curve-large,curve-small,curve-wide").split(",");
const out = await p.evaluate(async (types) => {
  const w = window.woodrail;
  const i = w.interaction;
  const { getPieceDef } = await import("/src/track/pieces.ts");
  const { transformPose } = await import("/src/track/math.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const V = w.camera.position.constructor;
  // (Harness: every tray piece allowed, as Sandbox has it; what's tested is where the ghost goes, not the toy box.)
  i.trayAllowed = null;
  const shapeOf = (m) => {
    if (!m || m.snap.kind !== "snapped") return null;
    const pose = m.snap.pose;
    return getPieceDef(m.type, m.flipped).connectors.map((k) => { const a = transformPose(pose, k.pose, { x: 0, z: 0, heading: 0 }); return `${Math.round(a.x)},${Math.round(a.z)}`; }).sort().join(" ");
  };
  const r = w.canvas.getBoundingClientRect();
  const ends = [];
  for (const id of w.layout.pieceIds()) {
    const q = w.layout.getPiece(id);
    const def = getPieceDef(q.type, q.flipped);
    def.connectors.forEach((k, c) => {
      if (w.layout.joinedConnector(connectorRef(id, c)) !== -1) return;
      const a = transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 });
      ends.push({ id, c, type: q.type, x: a.x, z: a.z, y: q.y + k.y, heading: a.heading });
    });
  }
  const rows = [];
  for (const type of types) {
    for (const e of ends) {
      w.lookAt(new V(e.x, 0, e.z), 900, 0.9);
      const at = new V(e.x + 40 * Math.cos(e.heading), e.y, e.z + 40 * Math.sin(e.heading)).project(w.camera);
      const sx = r.left + ((at.x + 1) / 2) * r.width, sy = r.top + ((1 - at.y) / 2) * r.height;
      i.trayFlipped = false;
      i.carryTrayItem({ kind: "piece", type, label: type });
      i.carryAt = { x: sx, y: sy };
      i.showPreview(sx, sy);
      const a = i.preview;
      const sa = shapeOf(a), ba = a?.blocked ?? null, fa = a?.flipped;
      i.flipSelected();
      const f = i.preview;
      const sf = shapeOf(f), bf = f?.blocked ?? null, ff = f?.flipped;
      rows.push({ type, end: `${e.id}:${e.c}`, on: e.type, plain: sa, plainBlocked: ba, plainF: fa, flipped: sf, flippedBlocked: bf, flippedF: ff, hint: f?.hint ?? null });
      i.arm(null);
    }
  }
  return rows;
}, types);
let snapped = 0, same = 0;
const why = {};
for (const r of out) {
  if (!r.plain || !r.flipped) continue;
  snapped++;
  if (r.plain === r.flipped) {
    same++;
    const k = `${r.type} on ${r.on} plainBlocked=${r.plainBlocked} flippedBlocked=${r.flippedBlocked} f ${r.plainF}->${r.flippedF}`;
    why[k] = (why[k] ?? 0) + 1;
  }
}
console.log(`ends×types tried ${out.length}, snapped both ways ${snapped}, flip changed nothing ${same}`);
for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${k}`);
await b.close();
await server.close();
