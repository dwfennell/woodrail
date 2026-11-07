// Pictures of the signals' lamps: a pair on the user's mill map (a copied map, loaded by the dev-only #load=) on a
// 390×844 phone at 2×, from above and at a low angle, red and green both shown. Setup only: the map is the user's, the
// camera placed by the director, the game paused.
//
// Usage: node tools/shots/signal-lamps.mjs <copied map file> [<out dir>] [<prefix>]   (default out: docs/agents/shots)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MAP = process.argv[2];
const OUT = process.argv[3] ?? "docs/agents/shots";
const PREFIX = process.argv[4] ?? "signal-lamps";
if (!MAP || !existsSync(MAP)) {
  console.error("usage: node tools/shots/signal-lamps.mjs <copied map file> [<out dir>] [<prefix>]");
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });
const text = readFileSync(MAP, "utf8").trim();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5412, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("page error:", e.message));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const shot = async (name) => {
  await frames();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${PREFIX}-${name}.jpg`, type: "jpeg", quality: 82, timeout: 120000 });
  console.log(`${OUT}/${PREFIX}-${name}.jpg`);
};
/** Run the game `s` seconds of its time, then pause it. */
const runFor = async (s) => {
  await p.evaluate(() => (window.woodrail.paused = false));
  await p.waitForFunction((end) => window.woodrail.simSeconds >= end, (await p.evaluate(() => window.woodrail.simSeconds)) + s, { timeout: 300000 });
  await p.evaluate(() => {
    window.woodrail.paused = true;
    window.woodrail.invalidate();
  });
};
/** Look at the middle of these pieces from `dist`, at polar angle `phi` (high: near the steepest a player may tilt). */
const look = async (pieces, dist, phi = 0.55, theta) => {
  await p.evaluate(
    ([pieces, dist, phi, theta]) => {
      const w = window.woodrail;
      let x = 0;
      let z = 0;
      for (const id of pieces) {
        const q = w.layout.getPiece(id).pose;
        x += q.x / pieces.length;
        z += q.z / pieces.length;
      }
      w.director.glideTo(new w.controls.target.constructor(x, 0, z), dist, { phi, theta, duration: 0.2 });
    },
    [pieces, dist, phi, theta],
  );
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
};

try {
  await p.goto(`${PAGE}#load=${encodeURIComponent(text)}`);
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  await p.keyboard.press("Escape");
  await p.evaluate(() => (window.woodrail.paused = true));
  await runFor(14);
  // The pair before the mill (piece 221's end 1 and its partner): one held red, so both colours show.
  await p.evaluate(() => {
    const w = window.woodrail;
    const m = w.layout.signalAt(221 * 8 + 1);
    w.sim.setMarkMode(m.id, "red");
    const o = w.layout.signalPartner(m.id);
    if (o) w.sim.setMarkMode(o.id, "green");
    w.invalidate();
  });
  // From above (as a phone looks down), and at a low angle (down by the track).
  await look([221, 220], 420, 0.25);
  await shot("above");
  await look([221, 220], 360, 1.15);
  await shot("low");
  await look([221, 220], 360, 1.15, Math.PI);
  await shot("low-other-side");
  console.log("draws:", await p.evaluate(() => window.woodrail.marksView.drawCalls));
} catch (e) {
  console.log("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close();
}
