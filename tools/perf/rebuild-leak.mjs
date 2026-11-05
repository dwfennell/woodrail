// Do rebuilds leak? Lay pieces and take them up again (each a track rebuild), zoom out and back (culling, detail),
// open and close the menu, many times over, and compare geometries, textures, programs, GPU memory (gltrack.js) and
// the JS heap and its ArrayBuffers before and after. node tools/perf/rebuild-leak.mjs <root with dist/> [late|sandbox] [rounds]
import { chromium } from "playwright-core";
import { preview } from "vite";
import { readFileSync } from "node:fs";
const HERE = new URL(".", import.meta.url).pathname;
const [root, mapId = "late", rounds = "150"] = process.argv.slice(2);
const maps = { late: "late-game.txt", sandbox: "big-sandbox.txt" };
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => { localStorage.setItem("woodrail.helpSeen", "1"); localStorage.setItem("woodrail.stats.asked", "1"); });
await page.addInitScript(readFileSync(`${HERE}/gltrack.js`, "utf8"));
await page.goto(`${server.resolvedUrls.local[0]}?dev#load=${readFileSync(`${HERE}/maps/${maps[mapId]}`, "utf8").trim()}`);
await page.waitForFunction(() => window.woodrail?.title && window.woodrail.framesDrawn > 3 && document.querySelector("#loading.done") && !window.woodrail.title.shown, null, { timeout: 600000 });
await page.evaluate(() => (window.woodrail.paused = true));
await page.evaluate(() => window.woodrail.settled(5));
const cdp = await ctx.newCDPSession(page);
const measure = async () => {
  await page.evaluate(async () => { window.gc(); await new Promise((r) => setTimeout(r, 300)); window.gc(); });
  const u = await cdp.send("Runtime.getHeapUsage");
  const m = await page.evaluate(() => { const w = window.woodrail; const g = window.__gl.summary(); return { geometries: w.renderer.info.memory.geometries, textures: w.renderer.info.memory.textures, programs: w.renderer.info.programs.length, gpuMB: g.allMB, glBuffers: g.buffers, glTextures: g.textures, pieces: w.layout.pieceCount, sceneObjects: (() => { let n = 0; w.scene.traverse(() => n++); return n; })() }; });
  return { ...m, v8MB: Math.round(u.usedSize / 1048576 * 10) / 10, arrayBuffersMB: Math.round(u.backingStorageSize / 1048576 * 10) / 10 };
};
// One round first (first-time work: shaders, caches), then the baseline.
const round = (i) => page.evaluate(async (i) => {
  const w = window.woodrail, ed = w.editor();
  const frame = async () => { w.invalidate(); const f = w.framesDrawn; const t = performance.now(); while (w.framesDrawn === f && performance.now() - t < 3000) await new Promise((r) => requestAnimationFrame(r)); };
  const t = w.controls.target;
  const types = ["straight-144", "straight-216", "curve-large", "straight-54", "curve-small"];
  const ids = [];
  for (let k = 0; k < 3; k++) {
    const id = ed.place(types[(i + k) % types.length], { x: t.x + 300 + k * 250, z: t.z + 300 + (i % 3) * 60, heading: (i % 8) * Math.PI / 4 }, 0, false);
    if (id >= 0) ids.push(id);
  }
  await frame();
  for (let k = 0; k < ids.length; k++) ed.undo();
  await frame();
  // Zoom out and back (culling and far detail), every few rounds.
  if (i % 5 === 0) {
    const p = w.camera.position.clone();
    w.camera.position.sub(t).multiplyScalar(6).add(t); w.controls.update(); await frame();
    w.camera.position.copy(p); w.controls.update(); await frame();
  }
  return ids.length;
}, i);
await round(0);
await page.evaluate(() => window.woodrail.settled(5));
const before = await measure();
await page.evaluate(() => window.__gl.mark());
let placed = 0;
for (let i = 1; i <= Number(rounds); i++) placed += await round(i);
await page.evaluate(() => window.woodrail.settled(5));
const after = await measure();
after.newBuffers = await page.evaluate(() => window.__gl.newSince());
console.log(JSON.stringify({ map: mapId, rounds: Number(rounds), placed, before, after, errors: errors.slice(0, 5) }, null, 1));
await browser.close(); await server.close();
