// The depth-of-field pass's cost (`src/render/dof.ts`): on the late map at a mid and a far view, for each level (dev
// `?dof=`), the time of a full draw (post.render then a 1-pixel readPixels, so SwiftShader's drawing is waited for)
// over 30 draws, and the GPU's render targets by the game's own tally (`gpu-tally.js`). High tier on a 390×844 phone
// at DPR 2 and a 1440×900 desktop at DPR 1. SwiftShader is software: compare levels with each other, not with a phone GPU.
//
// Usage: node tools/perf/dof-cost.mjs [levels]   (default: today,off)
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const LEVELS = (process.argv[2] ?? "today,off").split(",");
const MAP = readFileSync(`${ROOT}/tools/perf/maps/late-game.txt`, "utf8").trim();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5394, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const VIEWS = { mid: { x: -450, z: 420, dist: 2400, phi: 1.12 }, far: { x: -200, z: -200, dist: 6000, phi: 1.0 } };
const rows = [];
for (const device of Object.keys(DEVICES))
  for (const level of LEVELS) {
    const ctx = await b.newContext(DEVICES[device]);
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      localStorage.setItem("woodrail.helpSeen", "1");
      localStorage.setItem("woodrail.quality", "high");
    });
    await p.addInitScript(readFileSync(`${ROOT}/tools/perf/gpu-tally.js`, "utf8"));
    await p.goto(`${PAGE}?dof=${level}#load=${encodeURIComponent(MAP)}`);
    await p.waitForFunction(() => window.woodrail?.mode?.() && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 300000 });
    await p.keyboard.press("Escape");
    await p.evaluate(() => {
      window.woodrail.paused = true;
    });
    for (const [view, v] of Object.entries(VIEWS)) {
      const r = await p.evaluate(async (v) => {
        const w = window.woodrail;
        w.director.glideTo(new w.camera.position.constructor(v.x, 0, v.z), v.dist, { duration: 0.05, phi: v.phi });
        await new Promise((r) => setTimeout(r, 400));
        await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
        const gl = w.renderer.getContext();
        const px = new Uint8Array(4);
        const draw = () => {
          w.post.render(performance.now());
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        };
        for (let i = 0; i < 5; i++) draw();
        const ms = [];
        for (let i = 0; i < 30; i++) {
          const t = performance.now();
          draw();
          ms.push(performance.now() - t);
        }
        ms.sort((a, b) => a - b);
        const g = window.__gpu;
        return {
          medianMs: +ms[15].toFixed(1),
          p10Ms: +ms[3].toFixed(1),
          targetsMB: +((g.targetTextures() + g.renderbuffers()) / 2 ** 20).toFixed(1),
          gpuMB: +((g.buffers() + g.textures() + g.renderbuffers() + g.drawingBuffer()) / 2 ** 20).toFixed(1),
          counts: g.counts(),
          drawing: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          calls: w.renderer.info.render.calls,
        };
      }, v);
      rows.push({ device, level, view, ...r });
      console.log(JSON.stringify(rows.at(-1)));
    }
    await ctx.close();
  }
await b.close();
await server.close();
