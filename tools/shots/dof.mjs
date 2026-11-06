// Pictures for choosing how much depth of field (`src/render/dof.ts`): the same three views (close, mid, far over a town
// and river) at each level through the dev-only `?dof=`, on a 390×844 phone at DPR 2 and a 1440×900 desktop at DPR 1,
// both on the high tier (a phone's own tier, mobile, has no depth of field). Map: tools/perf/maps/late-game.txt.
//
// Usage: node tools/shots/dof.mjs [<out dir>] [levels]   (default out: e2e-out/dof; levels: today,half,tilt,off)
//   VIEWS='{"name":{x,z,dist,phi,theta}}' for other views; EXPLORE=1 prints the map's towns and river cells instead.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/dof";
const LEVELS = (process.argv[3] ?? "today,half,tilt,off").split(",");
const MAP = readFileSync(`${ROOT}/${process.env.MAP ?? "tools/perf/maps/late-game.txt"}`, "utf8").trim();
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

async function open(device, level) {
  const ctx = await b.newContext(DEVICES[device]);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    localStorage.setItem("woodrail.quality", "high");
  });
  await p.goto(`${PAGE}?dof=${level}#load=${encodeURIComponent(MAP)}`);
  await p.waitForFunction(() => window.woodrail?.mode?.() && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 300000 });
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  await p.addStyleTag({ content: "body > *:not(#scene) { visibility: hidden !important }" });
  await p.evaluate(() => {
    window.woodrail.paused = true;
  });
  return { ctx, p };
}
const look = (p, v) =>
  p.evaluate(async (v) => {
    const w = window.woodrail;
    w.director.glideTo(new w.camera.position.constructor(v.x, v.y ?? 0, v.z), v.dist, { duration: 0.05, phi: v.phi, theta: v.theta });
    await new Promise((r) => setTimeout(r, 400));
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  }, v);

if (process.env.EXPLORE) {
  const { p } = await open("desktop", "today");
  const info = await p.evaluate(() => {
    const w = window.woodrail;
    const L = w.world.landscape;
    const g = L.grid;
    const water = {};
    for (let x = -6000; x < 6000; x += 72)
      for (let z = -6000; z < 6000; z += 72) {
        const i = g.cellAtWorld(x, z);
        if (i >= 0 && (g.surface[i] === 1 || g.surface[i] === 5)) {
          const k = `${Math.round(x / 720) * 720},${Math.round(z / 720) * 720}:${g.surface[i]}`;
          water[k] = (water[k] ?? 0) + 1;
        }
      }
    return { towns: L.towns.map((t) => [Math.round(t.centre.x), Math.round(t.centre.z), t.buildings?.length]), water, cam: w.camera.position.toArray().map(Math.round) };
  });
  console.log(JSON.stringify(info));
  await p.screenshot({ path: `${OUT}/explore.png` });
} else {
  const VIEWS = process.env.VIEWS ? JSON.parse(process.env.VIEWS) : { close: { x: -540, z: 108, dist: 900, phi: 1.0 }, mid: { x: -450, z: 420, dist: 2400, phi: 1.12 }, far: { x: -200, z: -200, dist: 6000, phi: 1.0 } };
  for (const device of (process.env.DEVICES ?? "desktop,phone").split(","))
    for (const level of LEVELS) {
      const { ctx, p } = await open(device, level);
      for (const [name, v] of Object.entries(VIEWS)) {
        await look(p, v);
        await p.screenshot({ path: `${OUT}/dof-${device}-${name}-${level}.png`, timeout: 180000 });
        console.log("shot", device, name, level);
      }
      await ctx.close();
    }
}
await b.close();
await server.close();
