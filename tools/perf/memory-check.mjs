// `npm run perf:memory`: the memory budget check (docs/agents/perf.md, Memory budgets). Part of `npm run perf:check`
// (it runs this after the frame-time run), or on its own after `npm run build` (it measures dist/). About 3–4 min.
//
// The features map (the late Game map with every newer feature built on it: tools/perf/maps/features.txt) opened in a
// Pixel-10-like page (412×915 at DPR 2.625, touch, mobile: the mobile tier, as e2e:gl-lost), and in a desktop page
// (1440×900, DPR 1: the high tier), each in its own context, side by side. For each, once the map has finished
// building itself and nothing changes any more:
//
//   - GPU bytes by the game's own tally (gpu-tally.js: every WebGL allocation): geometry (buffers), textures (maps),
//     render targets (textures drawn into, and renderbuffers), the canvas's own buffers;
//   - the JS heap after GC: V8's objects, and the ArrayBuffers outside it (vertex data);
//   - counts: three's geometries, textures and programs, and WebGL's buffers and textures;
//   - leaks: the same again after rebuild cycles (pieces laid and taken up, a zoom out and back, the menu opened and
//     shut), against before them.
//
// Checked against tools/perf/memory-budgets.json: exit 1 when a measure is over its `max`. The budgets change only by
// an edit of that file (`--suggest` prints the values this run would give, for you to copy in, with the reason, in
// the same commit).
//
//   npm run perf:memory [-- --tiers mobile,desktop] [--cycles 8] [--root <dir with dist/>] [--out <dir>]
//                       [--from <memory.json>] [--suggest] [--parallel] [--no-leaks]
//
// Deterministic: a fixed map, the game paused from the moment it's ready (the sim and the trains hold still), the
// drawing resolution held at the tier's own (the governor steps down on a slow machine: a smaller target), the
// device's memory pinned at 8 GB (a 4 GB machine would go lean), the clocks and the industries' movers still.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { preview } from "vite";
import { pinClocks } from "../../scripts/e2e/pin-clocks.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BUDGETS = `${HERE}memory-budgets.json`;
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? d : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const budgets = JSON.parse(readFileSync(BUDGETS, "utf8"));
const TIERS = opt("tiers", budgets.run.tiers.join(",")).split(",");
const CYCLES = Number(opt("cycles", budgets.run.cycles));
const MAP = opt("map", budgets.run.map);
const ROOT = opt("root", process.cwd());
const OUT = opt("out", "perf-out/memory-check");
mkdirSync(OUT, { recursive: true });

const PAGES = {
  // A Pixel 10 (1080×2424, DPR about 2.6): the mobile tier, at the pixel ratio it draws at (capped at 2).
  mobile: {
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
    isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  },
  // A laptop: the high tier (ambient occlusion, depth of field, a 4096 shadow map).
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};

const r1 = (x) => Math.round(x * 10) / 10;
const MB = (b) => r1(b / 1048576);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)} s]`, ...a);

let result;
if (opt("from")) result = JSON.parse(readFileSync(opt("from"), "utf8"));
else {
  const server = await preview({ root: ROOT, preview: { port: 0 }, logLevel: "warn" });
  const BASE = server.resolvedUrls.local[0];
  // A browser of its own for each tier: in one browser the second tier's load went faster (the GPU process had its
  // shaders already), and what a load leaves built moved by a percent or two with its timing.
  const launch = () =>
    chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
      headless: false,
      args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"],
    });
  const url = `${BASE}?dev#load=${readFileSync(`${HERE}/maps/${MAP}`, "utf8").trim()}`;
  result = { when: new Date().toISOString(), map: MAP, cycles: CYCLES, tiers: {} };
  const one = async (tier) => {
    const browser = await launch();
    try {
      result.tiers[tier] = await measureTier(browser, url, tier);
    } catch (e) {
      result.tiers[tier] = { failed: String(e?.stack ?? e).slice(0, 600) };
      log(`${tier}: failed: ${String(e).split("\n")[0]}`);
    }
    await browser.close();
  };
  // One after the other (side by side, each its own context, they took longer: SwiftShader shares the cores), or
  // `--parallel`.
  if (flag("parallel")) await Promise.all(TIERS.map(one));
  else for (const t of TIERS) await one(t);
  result.seconds = Math.round((Date.now() - t0) / 1000);
  await server.close();
  writeFileSync(`${OUT}/memory.json`, JSON.stringify(result, null, 2) + "\n");
}

async function measureTier(browser, url, tier) {
  const tl = Date.now();
  const ctx = await browser.newContext(PAGES[tier]);
  await pinClocks(ctx);
  await ctx.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    localStorage.setItem("woodrail.stats.asked", "1");
    // (The industries' little movers held still, as `prefers-reduced-motion` does: nothing to draw while it settles.)
    window.__woodrailStillIndustries = true;
    // 8 GB, as Chrome reports a Pixel 10's 12 (it caps at 8): a machine with 4 GB or less would make the game lean.
    Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => 8, configurable: true });
    // The game paused from the moment it's there, and kept so (a harness shortcut: what's measured is what it holds,
    // not play). Running until the check could pause it, the trains got further on a slower page (the high tier's),
    // and what they'd reached (goods heaps, what's in view) moved the numbers by a percent or two.
    const iv = setInterval(() => {
      const w = window.woodrail;
      if (!w) return;
      clearInterval(iv);
      Object.defineProperty(w, "paused", { configurable: true, get: () => true, set: () => {} });
    }, 5);
  });
  await ctx.addInitScript(readFileSync(`${HERE}/gpu-tally.js`, "utf8"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 300)));
  const cdp = await ctx.newCDPSession(page);

  await page.goto(url);
  await page.waitForFunction(() => window.woodrail?.title, null, { timeout: 300000 });
  await page.evaluate(() => {
    const w = window.woodrail;
    // Hold the drawing resolution where the tier starts it (the governor never judges a frame), and the world still.
    w.settleResolution(1e12);
    if (!w.title.shown) return;
    const b = [...document.querySelectorAll(".title-card button")];
    b.find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click();
  });
  await page.waitForFunction(() => window.woodrail.framesDrawn > 3 && document.querySelector("#loading.done") && !window.woodrail.title.shown, null, { timeout: 300000 });
  await page.evaluate(() => {
    window.woodrail.paused = true;
    window.woodrail.settleResolution(1e12);
  });
  await page.keyboard.press("Escape");
  const loadS = Math.round((Date.now() - tl) / 1000);
  log(`${tier}: in play`);
  // The first visit's own work (tray pictures, track carved), then the map finishing itself (the land around,
  // scenery): until two looks a few seconds apart see the same GPU bytes and geometries.
  await page.evaluate(() => Promise.race([window.woodrail.trayThumbnailsSaved(), new Promise((r) => setTimeout(r, 120000))]));
  log(`${tier}: tray pictures kept`);
  const steady = await untilSteady(page, 120000);
  log(`${tier}: steady (${steady.looks} looks)`);
  const atLoad = await measure(page, cdp);
  log(`${tier}: measured: GPU ${atLoad.gpu.totalMB} MB, JS ${atLoad.js.heapMB} + ${atLoad.js.arrayBuffersMB} MB`);

  const pieces = await page.evaluate(() => window.woodrail.layout.pieceCount);
  if (!budgets.run.leakTiers.includes(tier) || flag("no-leaks")) {
    await ctx.close();
    return { ...atLoad, pieces, loadS, errors };
  }
  // Leaks: one cycle first (first-time work: shaders, caches, buffers for things first seen zoomed out), then the
  // cycles, measured before and after.
  await cycle(page, 0);
  await untilSteady(page, 60000);
  const before = await measure(page, cdp);
  for (let i = 1; i <= CYCLES; i++) await cycle(page, i);
  await untilSteady(page, 60000);
  const after = await measure(page, cdp);
  log(`${tier}: ${CYCLES} cycles: heap ${before.js.heapMB} → ${after.js.heapMB} MB, GPU ${before.gpu.totalMB} → ${after.gpu.totalMB} MB`);
  await ctx.close();
  return {
    ...atLoad,
    leak: {
      cycles: CYCLES,
      heapMB: r1(after.js.heapMB - before.js.heapMB),
      arrayBuffersMB: r1(after.js.arrayBuffersMB - before.js.arrayBuffersMB),
      gpuMB: r1(after.gpu.totalMB - before.gpu.totalMB),
      geometries: after.counts.geometries - before.counts.geometries,
      textures: after.counts.textures - before.counts.textures,
      glBuffers: after.counts.glBuffers - before.counts.glBuffers,
      before,
      after,
    },
    pieces,
    loadS,
    errors,
  };
}

/** Wait until the GPU tally and three's counts are the same at two looks a few seconds apart (or `ms` runs out). */
async function untilSteady(page, ms) {
  const end = Date.now() + ms;
  let last = null;
  let looks = 0;
  while (Date.now() < end) {
    await page.evaluate(() => Promise.race([window.woodrail.settled(5), new Promise((r) => setTimeout(r, 15000))]));
    await page.waitForTimeout(1500);
    const k = await page.evaluate(() => {
      const g = window.__gpu;
      const m = window.woodrail.renderer.info.memory;
      return `${g.buffers()} ${g.textures()} ${g.renderbuffers()} ${m.geometries} ${m.textures}`;
    });
    looks++;
    if (k === last) return { looks };
    last = k;
  }
  return { looks, timedOut: true };
}

async function measure(page, cdp) {
  // (Twice, a moment apart: what the first frees can let the second free more.)
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(300);
  await cdp.send("HeapProfiler.collectGarbage");
  const h = await cdp.send("Runtime.getHeapUsage");
  const m = await page.evaluate(() => {
    const w = window.woodrail;
    const info = w.renderer.info;
    const g = window.__gpu;
    const c = g.counts();
    return {
      buffers: g.buffers(),
      textures: g.textures(),
      targetTextures: g.targetTextures(),
      renderbuffers: g.renderbuffers(),
      canvas: g.drawingBuffer(),
      geometries: info.memory.geometries,
      threeTextures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      glBuffers: c.buffers,
      glTextures: c.textures,
      pixelRatio: w.renderer.getPixelRatio(),
      // (Which of the scene's groups holds how many geometries: to find what moved when a count moves.)
      byGroup: (() => {
        const out = {};
        for (const top of w.scene.children) {
          const seen = new Set();
          top.traverse((o) => o.geometry && seen.add(o.geometry));
          out[top.name || top.type] = (out[top.name || top.type] ?? 0) + seen.size;
        }
        return out;
      })(),
      quality: `${w.quality.tier}${w.quality.lean ? " lean" : ""}`,
      textureTop: g
        .textureList()
        .slice(0, 8)
        .map(([b, x, y, f, k]) => `${(b / 1048576).toFixed(1)} MB ${x}x${y} 0x${f.toString(16)} ${k}`),
    };
  });
  const total = m.buffers + m.textures + m.renderbuffers + m.canvas;
  return {
    gpu: {
      totalMB: MB(total),
      geometryMB: MB(m.buffers),
      texturesMB: MB(m.textures - m.targetTextures),
      targetsMB: MB(m.targetTextures + m.renderbuffers),
      canvasMB: MB(m.canvas),
    },
    js: { heapMB: MB(h.usedSize), arrayBuffersMB: MB(h.backingStorageSize ?? 0), totalMB: MB(h.usedSize + (h.backingStorageSize ?? 0)) },
    counts: { geometries: m.geometries, textures: m.threeTextures, programs: m.programs, glBuffers: m.glBuffers, glTextures: m.glTextures },
    pixelRatio: m.pixelRatio,
    quality: m.quality,
    geometriesByGroup: m.byGroup,
    textureTop: m.textureTop,
  };
}

/**
 * One rebuild cycle, as rebuild-leak.mjs's round: three pieces laid near the view and taken up again (undo: track
 * rebuilds), a zoom out and back every other cycle (far detail, culling, tiles first seen), the ☰ menu opened and
 * shut (the DOM). Harness shortcut: laid through the editor, not dragged from the tray (what's tested is that a
 * rebuild gives back what it took, not the drop).
 */
async function cycle(page, i) {
  const tc = Date.now();
  const parts = await page.evaluate(async (i) => {
    const T = [performance.now()];
    const w = window.woodrail;
    const ed = w.editor();
    const frame = async () => {
      w.invalidate();
      const f = w.framesDrawn;
      const t = performance.now();
      while (w.framesDrawn === f && performance.now() - t < 5000) await new Promise((r) => requestAnimationFrame(r));
    };
    const t = w.controls.target;
    const types = ["straight-144", "straight-216", "curve-large", "straight-54", "curve-small"];
    let laid = 0;
    for (let k = 0; k < 3; k++) if (ed.place(types[(i + k) % types.length], { x: t.x + 300 + k * 250, z: t.z + 300 + (i % 3) * 60, heading: ((i % 8) * Math.PI) / 4 }, 0, false) >= 0) laid++;
    await frame();
    T.push(performance.now());
    for (let k = 0; k < laid; k++) ed.undo();
    await frame();
    T.push(performance.now());
    if (i % 2 === 0) {
      const p = w.camera.position.clone();
      w.camera.position.sub(t).multiplyScalar(6).add(t);
      w.controls.update();
      await frame();
      w.camera.position.copy(p);
      w.controls.update();
      await frame();
    }
    T.push(performance.now());
    return T.slice(1).map((t, k) => Math.round(t - T[k]));
  }, i);
  // (A click in the page: a locator's click waits for the button to hold still, seconds here.)
  if (await page.evaluate(() => (document.querySelector('button[aria-label="Menu"]')?.click(), true))) {
    await page.waitForTimeout(100);
    await page.keyboard.press("Escape");
  }
  if (process.env.MEM_DEBUG) log(`cycle ${i}: ${Date.now() - tc} ms (lay, undo, zoom: ${parts.join(", ")})`);
}

// ---- The check ----

const get = (o, path) => path.split(".").reduce((x, k) => (x === null || x === undefined ? x : x[k]), o);
const fmt = (v, unit) => (typeof v === "number" ? `${v}${unit ? ` ${unit}` : ""}` : "–");

if (flag("suggest")) {
  // What this run would make each budget: its value plus the measure's margin (rounded up), or the leak's own floor.
  const out = JSON.parse(JSON.stringify(budgets));
  for (const [key, b] of Object.entries(out.budgets)) {
    const v = get(result.tiers, key);
    if (typeof v !== "number") continue;
    const kind = budgets.kinds[b.kind];
    b.measured = v;
    const max = kind.absolute !== undefined ? v + kind.absolute : Math.max(v * (1 + kind.margin), v + kind.floor);
    b.max = b.unit ? roundUp(max) : Math.ceil(max);
  }
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nperf:memory: suggested budgets above (from this run; copy what you mean to change into ${BUDGETS})`);
  process.exit(0);
}

function roundUp(x) {
  if (x <= 10) return Math.ceil(x * 10) / 10;
  if (x <= 200) return Math.ceil(x);
  return Math.ceil(x / 5) * 5;
}

let failed = 0;
const rows = [];
for (const [key, b] of Object.entries(budgets.budgets)) {
  const [tier] = key.split(".");
  if (!TIERS.includes(tier) && !opt("from")) continue;
  const t = result.tiers[tier];
  const v = get(result.tiers, key);
  if (t && !t.failed && key.startsWith(`${tier}.leak.`) && !t.leak) continue; // (--no-leaks)
  let verdict;
  let by = "";
  if (!t) verdict = "not run";
  else if (t.failed) {
    verdict = "FAIL (tier failed)";
    failed++;
  } else if (typeof v !== "number") {
    verdict = "FAIL (missing)";
    failed++;
  } else if (v > b.max) {
    const over = v - b.max;
    by = `+${r1(over)}${b.unit ? ` ${b.unit}` : ""}${b.max > 0 ? ` (+${r1((over / b.max) * 100)}%)` : ""}`;
    verdict = "FAIL: over budget";
    failed++;
  } else {
    by = `${r1(v - b.max)}`;
    verdict = "ok";
  }
  rows.push(`| ${key} | ${fmt(v, b.unit)} | ${fmt(b.max, b.unit)} | ${fmt(b.measured, b.unit)} | ${by} | ${verdict} |`);
}
console.log(`\nMemory (${result.map}, ${result.when}${result.seconds ? `, ${result.seconds} s` : ""})\n`);
console.log(`| measure | this run | budget (max) | measured when set | vs budget | |\n|---|---|---|---|---|---|\n${rows.join("\n")}`);
for (const [tier, t] of Object.entries(result.tiers)) {
  if (t.failed) {
    console.log(`\n${tier} failed: ${t.failed}`);
    continue;
  }
  console.log(`\n${tier}: ${t.quality} at pixel ratio ${t.pixelRatio}, ${t.pieces} pieces; biggest textures: ${t.textureTop.slice(0, 4).join("; ")}`);
  if (t.pixelRatio !== budgets.run.pixelRatio[tier]) {
    console.log(`${tier}: FAIL: drew at pixel ratio ${t.pixelRatio}, not ${budgets.run.pixelRatio[tier]} (the numbers aren't comparable)`);
    failed++;
  }
  if (t.errors?.length) console.log(`${tier}: page errors: ${t.errors.slice(0, 3).join(" | ")}`);
}
console.log(
  failed
    ? `\nperf:memory: ${failed} over budget or failed. A change that rightly holds more: edit ${BUDGETS.replace(/.*tools/, "tools")} (--suggest prints this run's values) and say why in the commit (AGENTS.md, Budgets).`
    : "\nperf:memory: within budget",
);
process.exit(failed ? 1 : 0);
