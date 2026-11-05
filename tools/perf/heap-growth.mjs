// What keeps the JS heap growing: the sampling heap profiler over a stretch of play (objects still alive at its end,
// by where they were allocated). Best with an unminified build (`vite build --minify false`).
// node tools/perf/heap-growth.mjs <root with dist/> <late|sandbox> <seconds> [out.png]
import { chromium } from "playwright-core";
import { preview } from "vite";
import { readFileSync } from "node:fs";
const [root, mapId = "late", seconds = "180", shot] = process.argv.slice(2);
const maps = { late: "late-game.txt", sandbox: "big-sandbox.txt" };
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.addInitScript(() => { localStorage.setItem("woodrail.helpSeen", "1"); localStorage.setItem("woodrail.stats.asked", "1"); });
// FROM_START=1: sampled from before the page loads, so the end's live heap is all there, by where it was allocated.
const early = process.env.FROM_START ? await ctx.newCDPSession(page) : null;
if (early) {
  await early.send("HeapProfiler.enable");
  await early.send("HeapProfiler.startSampling", { samplingInterval: 32768 });
}
await page.goto(`${server.resolvedUrls.local[0]}?dev#load=${readFileSync(`tools/perf/maps/${maps[mapId]}`, "utf8").trim()}`);
await page.waitForFunction(() => window.woodrail?.title && window.woodrail.framesDrawn > 3 && document.querySelector("#loading.done") && !window.woodrail.title.shown, null, { timeout: 600000 });
await page.waitForTimeout(20000);
const cdp = early ?? (await ctx.newCDPSession(page));
const heap = () => page.evaluate(() => (window.gc(), Math.round(performance.memory.usedJSHeapSize / 1048576 * 10) / 10));
const state = () => page.evaluate(() => ({ frames: window.woodrail.framesDrawn, paused: window.woodrail.paused, trains: window.woodrail.sim.trainIds().length, sim: Math.round(window.woodrail.simSeconds) }));
const h0 = await heap(); const s0 = await state();
{
  const u = await cdp.send("Runtime.getHeapUsage");
  const mb = (x) => Math.round((x ?? 0) / 1048576);
  const arrays = await page.evaluate(() => {
    // Typed arrays three keeps for geometry (its attributes and index), counted once per buffer.
    const seen = new Set(); let bytes = 0;
    window.woodrail.scene.traverse((o) => {
      const g = o.geometry; if (!g) return;
      for (const a of [...Object.values(g.attributes), g.index, ...(o.isInstancedMesh ? [o.instanceMatrix, o.instanceColor] : [])]) {
        const arr = a?.array; if (!arr || seen.has(arr.buffer)) continue; seen.add(arr.buffer); bytes += arr.buffer.byteLength;
      }
    });
    return Math.round(bytes / 1048576);
  });
  console.log(JSON.stringify({ v8UsedMB: mb(u.usedSize), v8TotalMB: mb(u.totalSize), embedderMB: mb(u.embedderHeapUsedSize), backingStoresMB: mb(u.backingStorageSize), sceneGeometryArraysMB: arrays }));
}
if (!early) {
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.startSampling", { samplingInterval: 16384 });
}
await page.waitForTimeout(Number(seconds) * 1000);
await heap();
const { profile } = await cdp.send("HeapProfiler.getSamplingProfile");
await cdp.send("HeapProfiler.stopSampling");
const h1 = await heap(); const s1 = await state();
if (shot) await page.screenshot({ path: shot });
// Self size by function (with its caller chain, short), live at the end.
const rows = [];
const walk = (n, chain) => {
  const f = n.callFrame;
  const here = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
  const c = [here, ...chain].slice(0, 6);
  if (n.selfSize) rows.push({ size: n.selfSize, chain: c.join(" < ") });
  for (const k of n.children) walk(k, c);
};
walk(profile.head, []);
const byChain = new Map();
for (const r of rows) byChain.set(r.chain, (byChain.get(r.chain) ?? 0) + r.size);
const top = [...byChain].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP ?? 25));
// And by function alone (self), and by the game's own frames (the first frame of a chain in the game's code).
const byFn = new Map();
for (const r of rows) { const f = r.chain.split(" < ")[0]; byFn.set(f, (byFn.get(f) ?? 0) + r.size); }
const byGame = new Map();
for (const r of rows) { const g = r.chain.split(" < ").find((c) => /index-|blender-models/.test(c) && !/three/.test(c)) ?? r.chain.split(" < ")[0]; byGame.set(g, (byGame.get(g) ?? 0) + r.size); }
const total = rows.reduce((s, r) => s + r.size, 0);
console.log(`sampled live: ${(total / 1048576).toFixed(1)} MB`);
console.log("-- by game function --");
for (const [c, s] of [...byGame].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`${(s / 1048576).toFixed(2)} MB  ${c}`);
console.log("-- by allocating function --");
for (const [c, s] of [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${(s / 1048576).toFixed(2)} MB  ${c}`);
console.log("-- by chain --");
console.log(JSON.stringify({ seconds: Number(seconds), heapStart: h0, heapEnd: h1, s0, s1 }));
for (const [c, s] of top) console.log(`${(s / 1048576).toFixed(2)} MB  ${c}`);
await browser.close(); await server.close();
