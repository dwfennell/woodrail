// Pictures of the bridges on a copied map (the user's of 2026-11-15, the viaduct on a hill's edge): each bridge or ramp
// on arches framed from a few sides, with its levels and arch openings printed.
//
// Usage: node tools/shots/viaduct-hill-map.mjs <map.txt> [<out dir>] [<prefix>]
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const text = readFileSync(process.argv[2], "utf8").trim();
const OUT = process.argv[3] ?? "e2e-out/viaduct-hill-map";
const PREFIX = process.argv[4] ?? "map";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1 });
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
try {
  await p.goto(`${PAGE}#load=${encodeURIComponent(text)}`);
  await p.waitForFunction(() => !!window.woodrail?.mode?.() && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  await p.keyboard.press("Escape");
  await p.evaluate(() => (window.woodrail.paused = true));
  // The HUD's panels off the picture (the goals sheet covers the left side).
  await p.addStyleTag({ content: ".goals, .goal-panel, .side-panel { visibility: hidden !important; }" });
  await settle();
  const arches = await p.evaluate(async () => {
    const w = window.woodrail;
    const { getPieceDef, pathLength, samplePath, createSample } = await import("/src/track/index.ts");
    const out = [];
    for (const id of w.layout.pieceIds()) {
      const q = w.layout.getPiece(id);
      const levels = w.bridgeLevelsOf(q);
      if (levels < 1 || q.type === "underpass") continue;
      const g = getPieceDef(q.type, q.flipped).paths[0].geom;
      const m = samplePath(g, pathLength(g) / 2, createSample());
      const c = Math.cos(q.pose.heading), s = Math.sin(q.pose.heading);
      out.push({ id, type: q.type, y: q.y, levels, floors: w.archFloorsOf(q), x: q.pose.x + m.x * c - m.z * s, z: q.pose.z + m.x * s + m.z * c, heading: q.pose.heading });
    }
    return out;
  });
  console.log(JSON.stringify(arches));
  const ids = process.env.IDS?.split(",").map(Number);
  for (const a of ids ? arches.filter((a) => ids.includes(a.id)) : arches.slice(0, Number(process.env.MAX ?? 6))) {
    for (const [k, phi, theta] of [["a", 0.9, 0], ["b", 0.9, Math.PI / 2], ["c", 0.9, Math.PI], ["d", 0.9, -Math.PI / 2]]) {
      await p.evaluate(({ a, phi, theta }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(a.x, a.y, a.z), 650, { duration: 0.1, phi, theta }), { a, phi, theta });
      await p.waitForTimeout(1500);
      await settle();
      await p.screenshot({ path: `${OUT}/${PREFIX}-${a.id}-${k}.jpg`, type: "jpeg", quality: 85, timeout: 180000 });
    }
  }
} catch (e) {
  console.log("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close();
}
