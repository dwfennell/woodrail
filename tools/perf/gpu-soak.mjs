// Pixel-10-like page: measure JS heap and an estimate of GPU memory at load and over a long play, then a context loss.
// node soak.mjs <root with dist/> <map: late|sandbox|fresh> <minutes> <out.json> [throttle]
import { chromium } from "playwright-core";
import { preview } from "vite";
import { readFileSync, writeFileSync } from "node:fs";
const [root, mapId, minutes, outFile, thr] = process.argv.slice(2);
const HERE = new URL(".", import.meta.url).pathname;
const REPO = "/home/user/woodrail";
const maps = { late: "late-game.txt", sandbox: "big-sandbox.txt" };
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const BASE = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: Number(process.env.DPR ?? 2.625), hasTouch: true, isMobile: true, userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36" });
const page = await ctx.newPage();
const errors = [], logs = [];
const T0 = Date.now();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`${((Date.now() - T0) / 1000).toFixed(0)}s ${m.text().slice(0, 200)}`); });
await page.addInitScript(() => { localStorage.setItem("woodrail.helpSeen", "1"); localStorage.setItem("woodrail.stats.asked", "1"); });
await page.addInitScript(readFileSync(`${HERE}/gltrack.js`, "utf8"));
// LEAN=1: as after a lost drawing (render/quality.ts): the lean settings.
if (process.env.LEAN) await page.addInitScript(() => localStorage.setItem("woodrail.gpuLost", String(Date.now())));
if (process.env.GL_STACKS) await page.addInitScript(() => (window.__glStacks = true));
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(thr ?? 2) });
let url = BASE;
if (maps[mapId]) url = `${BASE}?dev#load=${readFileSync(`${REPO}/tools/perf/maps/${maps[mapId]}`, "utf8").trim()}`;
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.woodrail?.title, null, { timeout: 600000 });
await page.evaluate((fresh) => { if (!window.woodrail.title.shown) return; const b = [...document.querySelectorAll(fresh ? ".title-card.mode-game button" : ".title-card button")]; b.find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()); }, !maps[mapId]);
await page.waitForFunction(() => window.woodrail.framesDrawn > 3 && document.querySelector("#loading.done") && !window.woodrail.title.shown, null, { timeout: 600000 });
await page.waitForTimeout(5000);
const sample = async (label) => {
  const s = await page.evaluate(async () => {
    window.gc?.();
    const w = window.woodrail, c = w.renderer.domElement;
    const gl = window.__gl.summary();
    const canvasMB = Math.round((c.width * c.height * (4 * 2 + 4)) / 1048576 * 10) / 10; // front+back colour, depth/stencil
    return { t: Math.round(performance.now() / 1000), heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10, heapTotalMB: Math.round(performance.memory.totalJSHeapSize / 1048576), canvas: `${c.width}x${c.height}`, pr: w.renderer.getPixelRatio(), canvasMB, ...gl, geometries: w.renderer.info.memory.geometries, threeTextures: w.renderer.info.memory.textures, programs: w.renderer.info.programs?.length, frames: w.framesDrawn };
  });
  const m = await cdp.send("Performance.getMetrics");
  const g = (n) => m.metrics.find((x) => x.name === n)?.value;
  s.label = label; s.nodes = g("Nodes"); s.listeners = g("JSEventListeners");
  // WASM memories (Rapier's, the meshopt decoder's): their buffers count in the heap's external memory, not usedJSHeapSize.
  console.log(JSON.stringify({ label, t: s.t, heapMB: s.heapMB, gpuMB: s.allMB, peak: s.peakMB, canvasMB: s.canvasMB, geo: s.geometries, tex: s.threeTextures, frames: s.frames }));
  return s;
};
const out = { map: mapId, root, loadS: (Date.now() - t0) / 1000, samples: [] };
out.samples.push(await sample("load"));
const end = Date.now() + Number(minutes) * 60000;
let i = 0;
while (Date.now() < end) {
  i++;
  // a pan, a pinch-ish zoom by wheel, now and then a piece laid and taken back, and the menu opened
  await page.mouse.move(200, 450); await page.mouse.down();
  for (let k = 0; k < 8; k++) await page.mouse.move(200 + (i % 2 ? 1 : -1) * k * 15, 450 + k * 6);
  await page.mouse.up();
  await page.mouse.wheel(0, i % 3 === 0 ? 600 : -300);
  if (i % 3 === 0) {
    await page.evaluate(() => {
      const w = window.woodrail, ed = w.editor();
      try { const id = ed.place("straight-144", { x: 3000 + Math.random() * 500, z: 3000, heading: 0 }, 0, false); if (id >= 0) ed.undo(); } catch (e) { console.warn("place", e.message); }
    });
  }
  if (i % 4 === 0) { await page.keyboard.press("Escape"); }
  await page.waitForTimeout(15000);
  if (i % 4 === 0 && process.env.SIM) console.log(JSON.stringify(await page.evaluate(() => ({ sim: Math.round(window.woodrail.simSeconds), paused: window.woodrail.paused }))));
  if (i % 4 === 0) out.samples.push(await sample(`play ${Math.round((Date.now() - t0) / 60000)} min`));
}
out.samples.push(await sample("end"));
// Context loss: lose it, wait, restore, and see what's shown and whether the game draws again.
out.contextLoss = await page.evaluate(async () => {
  const w = window.woodrail, c = w.renderer.domElement;
  const ext = w.renderer.getContext().getExtension("WEBGL_lose_context");
  const f0 = w.framesDrawn;
  ext.loseContext();
  await new Promise((r) => setTimeout(r, 3000));
  const lost = { contextLost: w.renderer.getContext().isContextLost(), overlay: [...document.querySelectorAll("body > *")].filter((e) => !e.hidden && getComputedStyle(e).display !== "none" && /reload/i.test(e.textContent ?? "")).map((e) => e.className).slice(0, 5) };
  const card = document.querySelector(".gl-lost");
  lost.card = card ? !card.hidden : null;
  ext.restoreContext();
  w.invalidate?.();
  await new Promise((r) => setTimeout(r, 8000));
  w.invalidate?.();
  await new Promise((r) => setTimeout(r, 4000));
  const card2 = document.querySelector(".gl-lost");
  return { lost, restored: !w.renderer.getContext().isContextLost(), cardAfterRestore: card2 ? !card2.hidden : null, framesAfter: w.framesDrawn - f0, gl: window.__gl.summary() };
});
await page.screenshot({ path: outFile.replace(/\.json$/, "-after-restore.png"), timeout: 120000 }).catch(() => {});
out.errors = errors; out.logs = [...new Set(logs.map((l) => l.replace(/^\d+s /, "")))].map((u) => { const m = logs.filter((l) => l.endsWith(u)); return `${m.length}× first ${m[0].split(" ")[0]} last ${m.at(-1).split(" ")[0]}: ${u}`; });
writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out.contextLoss), errors.slice(0, 10));
await browser.close(); await server.close();
