// Memory on a phone (docs/agents/perf.md): load a map in an emulated Pixel 10 (412×915 at DPR 2.625) and measure what
// the game holds: the JS heap after GC, the GPU's allocations (every WebGL buffer, texture and renderbuffer the page
// makes, tallied by a hook on the context: `gpu.mjs`'s estimate), three's renderer.info, and the CPU-side copies of
// geometry three keeps; at load and again after `--play` seconds of play (trains running, pans now and then). Also load
// time and frame time. `--snapshots` writes heap snapshots at load and at the end (open both in DevTools: Comparison).
//
//   npm run build && node tools/perf/memory.mjs [--map late] [--play 600] [--root <dir with dist/>] [--out <dir>]
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { preview } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? d : args[i + 1];
};
const MAP = opt("map", "late");
const PLAY_S = Number(opt("play", 600));
const ROOT = opt("root", process.cwd());
const OUT = opt("out", `perf-out/memory-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
const SNAPSHOTS = args.includes("--snapshots");
/** Measure the moment it's ready, not once its background work has settled (what grows after load), and sample every 10 s. */
const EARLY = args.includes("--early");
mkdirSync(OUT, { recursive: true });
const MAPS = { late: "late-game.txt", sandbox: "big-sandbox.txt", fresh: null };

const server = await preview({ root: ROOT, preview: { port: 0 }, logLevel: "warn" });
const BASE = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  headless: false,
  args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"],
});
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// (The game's own console errors; not WebGL's, which the browser reports by the hundred.)
page.on("console", (m) => {
  if (m.type() === "error" && /Woodrail|THREE/.test(m.text())) errors.push(m.text().slice(0, 300));
});
await page.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.stats.asked", "1");
});
await page.addInitScript(readFileSync(`${HERE}/instrument.js`, "utf8"));
await page.addInitScript(readFileSync(`${HERE}/gpu-tally.js`, "utf8"));
const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");

const r1 = (x) => Math.round(x * 10) / 10;
const MB = (b) => r1(b / 1048576);

async function snapshot(name) {
  const file = `${OUT}/${name}.heapsnapshot`;
  const out = createWriteStream(file);
  const onChunk = (p) => out.write(p.chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", onChunk);
  await new Promise((r) => out.end(r));
}

async function measure() {
  await cdp.send("HeapProfiler.collectGarbage");
  const h = await cdp.send("Runtime.getHeapUsage");
  const m = await page.evaluate(() => {
    const w = window.woodrail;
    const info = w.renderer.info;
    // The CPU-side vertex and index data the scene's geometries hold (each array once).
    const seen = new Set();
    let cpu = 0;
    let geos = 0;
    const geoSeen = new Set();
    w.scene.traverse((o) => {
      const g = o.geometry;
      if (!g || geoSeen.has(g)) return;
      geoSeen.add(g);
      geos++;
      for (const a of [...Object.values(g.attributes), g.index]) {
        const arr = a?.array ?? a?.data?.array;
        if (!arr || seen.has(arr)) continue;
        seen.add(arr);
        cpu += arr.byteLength;
      }
    });
    const t = window.__gpu;
    return {
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      sceneGeometries: geos,
      sceneCpuGeometryBytes: cpu,
      gpu: { buffers: t.buffers(), textures: t.textures(), renderbuffers: t.renderbuffers(), drawingBuffer: t.drawingBuffer() },
      jsHeapPerf: performance.memory?.usedJSHeapSize ?? 0,
    };
  });
  const gpuTotal = m.gpu.buffers + m.gpu.textures + m.gpu.renderbuffers + m.gpu.drawingBuffer;
  return {
    // The V8 heap, and the ArrayBuffers' backing stores outside it (typed arrays: vertex data); their sum is what the
    // page's JavaScript holds.
    jsHeapMB: MB(h.usedSize),
    backingStoreMB: MB(h.backingStorageSize ?? 0),
    jsTotalMB: MB(h.usedSize + (h.backingStorageSize ?? 0)),
    perfMemoryMB: MB(m.jsHeapPerf),
    gpuMB: MB(gpuTotal),
    gpuBuffersMB: MB(m.gpu.buffers),
    gpuTexturesMB: MB(m.gpu.textures),
    gpuRenderbuffersMB: MB(m.gpu.renderbuffers),
    drawingBufferMB: MB(m.gpu.drawingBuffer),
    totalMB: MB(h.usedSize + (h.backingStorageSize ?? 0) + gpuTotal),
    sceneCpuGeometryMB: MB(m.sceneCpuGeometryBytes),
    geometries: m.geometries,
    sceneGeometries: m.sceneGeometries,
    textures: m.textures,
    programs: m.programs,
  };
}

const url = MAPS[MAP] ? `${BASE}?dev#load=${readFileSync(`${HERE}/maps/${MAPS[MAP]}`, "utf8").trim()}` : BASE;
const t0 = Date.now();
await page.goto(url);
await page.waitForFunction(() => window.woodrail?.title && (window.woodrail.title.shown || window.__perf.readyAt !== null), null, { timeout: 600000 });
await page.evaluate((fresh) => {
  if (!window.woodrail.title.shown) return;
  const b = [...document.querySelectorAll(fresh ? ".title-card.mode-game button" : ".title-card button")];
  b.find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click();
}, !MAPS[MAP]);
await page.waitForFunction(() => window.__perf.readyAt !== null, null, { timeout: 600000 });
const readyMs = await page.evaluate(() => Math.round(window.__perf.readyAt));
const wallMs = Date.now() - t0;
await page.keyboard.press("Escape");
if (!EARLY) {
  await page.evaluate(() => Promise.race([window.woodrail.settled(5), new Promise((r) => setTimeout(r, 30000))]));
  await page.waitForTimeout(3000);
}
const atLoad = await measure();
console.log("load", readyMs, "ms", atLoad);
if (SNAPSHOTS) await snapshot("load");

// Play: trains run (unpaused), a pan or zoom every 20 s, frames timed.
await page.evaluate(() => {
  window.woodrail.paused = false;
  Object.assign(window.__perf, { rec: true, raf: [], events: [], timers: {}, longtasks: [] });
});
const samples = [];
const tp = Date.now();
let k = 0;
while (Date.now() - tp < PLAY_S * 1000) {
  const cx = 206;
  const cy = 450;
  if (k % 2 === 0) {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx + (k % 4 === 0 ? 12 : -12) * i, cy + 6 * i);
    await page.mouse.up();
  } else {
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, k % 4 === 1 ? -300 : 300);
  }
  k++;
  await page.waitForTimeout(EARLY ? 10000 : 20000);
  if (EARLY || k % 6 === 0) {
    const h = await cdp.send("Runtime.getHeapUsage");
    samples.push([Math.round((Date.now() - tp) / 1000), MB(h.usedSize), MB(h.backingStorageSize ?? 0)]);
    console.log("t", samples.at(-1));
  }
}
const frames = await page.evaluate(() => {
  const P = window.__perf;
  P.rec = false;
  const ms = P.raf.filter((x) => x[2] > 0).map((x) => x[1]).sort((a, b) => a - b);
  return { drawn: ms.length, p50: ms[Math.floor(ms.length / 2)] ?? null, p95: ms[Math.floor(ms.length * 0.95)] ?? null };
});
const afterPlay = await measure();
if (SNAPSHOTS) await snapshot("end");
const result = { map: MAP, root: ROOT, readyMs, wallMs, atLoad, afterPlay, playSeconds: PLAY_S, heapSamples: samples, frames: { drawn: frames.drawn, p50: frames.p50 && r1(frames.p50), p95: frames.p95 && r1(frames.p95) }, errors };
writeFileSync(`${OUT}/memory.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await browser.close();
await server.close();
