// The perf harness (docs/agents/perf.md): load a few representative maps in a phone-sized page with the CPU throttled,
// and measure what a player pays for: load to interactive, idle (or steady, trains running) frames and main-thread
// time, frame cost while panning and zooming, the cost of common operations (a tray drag's pointer moves, opening the
// menu, the research board, a train's card, the autosave and the once-a-second HUD timer), draw calls, triangles,
// programs, heap; optionally growth over a long run. Writes a JSON and a markdown table, to compare runs.
//
//   npm run build && node tools/perf/run.mjs [--maps fresh,late,sandbox] [--throttle 4] [--dpr 2] [--idle 20] [--pan 40]
//       [--soak 600] [--out perf-out/<name>] [--root <dir with dist/>] [--trace]
//
// `--quick` is the shorter run `npm run perf:check` uses (tools/perf/check.mjs). The browser draws with SwiftShader
// (software WebGL), so the GPU's share lands on the CPU too: compare runs on the same machine, not with a phone.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { preview } from "vite";
import { firstDownload } from "./first-download.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? d : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const QUICK = flag("quick");
const MAPS = opt("maps", "fresh,late,sandbox").split(",");
const THROTTLE = Number(opt("throttle", 4));
const DPR = Number(opt("dpr", 2));
const IDLE_S = Number(opt("idle", QUICK ? 10 : 20));
const SOAK_S = Number(opt("soak", 0));
/** The most seconds the pan, and the tray drag, go on for. */
const PAN_S = Number(opt("pan", QUICK ? 15 : 40));
const OUT = opt("out", `perf-out/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`);
const ROOT = opt("root", process.cwd());
const TRACE = flag("trace");
/** CPU profiles of the idle and pan stretches (best with an unminified build: `vite build --minify false`). */
const PROFILE = flag("profile");
/** A reload after the first visit, measured too (and everything after it measured on the reloaded page). Not in --quick. */
const RELOAD = !QUICK && !flag("no-reload");
mkdirSync(OUT, { recursive: true });

/** The maps: how each opens. `load` is a copied map (tools/perf/maps), opened with the dev-only `?dev#load=`. */
const MAP_DEFS = {
  fresh: { label: "fresh Game map", mode: "game" },
  late: {
    label: "late Game map (goals play-through, 440 min)",
    mode: "game",
    load: "late-game.txt",
  },
  sandbox: {
    label: "big Sandbox map (277 pieces, 16 trains)",
    mode: "sandbox",
    load: "big-sandbox.txt",
  },
  // The late map with each newer feature built on it (tools/perf/feature-map.mjs), and spots that frame each one
  // (features.json): measured one at a time (`spots`, below).
  features: {
    label: "late Game map with every newer feature (crane, wells, gantry, chains, telegraph, tunnel, underpass, post, places, metro)",
    mode: "game",
    load: "features.txt",
    spots: "features.json",
  },
};
/** Seconds of each spot's running and paused stretches (a `spots` map). */
const SPOT_S = Number(opt("spot", QUICK ? 4 : 8));
/** Only these spots (`--only-spots crane,tunnel`). */
const ONLY_SPOTS = opt("only-spots", null)?.split(",") ?? null;

const server = await preview({
  root: ROOT,
  preview: { port: 0 },
  logLevel: "warn",
});
const BASE = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  headless: false,
  args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-precise-memory-info"],
});
const INSTRUMENT = readFileSync(`${HERE}/instrument.js`, "utf8");

// CPU of the whole Chromium tree (main, GPU and renderer processes), in seconds.
const TICK = 100;
const treeCpu = () => {
  let s = 0;
  for (const p of readdirSync("/proc")) {
    if (!/^\d+$/.test(p)) continue;
    try {
      const st = readFileSync(`/proc/${p}/stat`, "utf8");
      if (!/chrom/i.test(st.slice(0, 60))) continue;
      const f = st.slice(st.lastIndexOf(")") + 2).split(" ");
      s += +f[11] + +f[12];
    } catch {}
  }
  return s / TICK;
};

const q = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function metrics(cdp) {
  const { metrics: m } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
}

/** The top functions of a CPU profile, by self time and by total (inclusive) time, in ms. */
function topOf(profile, n = 30) {
  const byId = new Map(profile.nodes.map((x) => [x.id, x]));
  const dt = profile.timeDeltas;
  const selfMs = new Map();
  for (let i = 0; i < profile.samples.length; i++) selfMs.set(profile.samples[i], (selfMs.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0) / 1000);
  const label = (x) => `${x.callFrame.functionName || "(anonymous)"} ${x.callFrame.url.split("/").pop()}:${x.callFrame.lineNumber + 1}`;
  const self = new Map();
  const total = new Map();
  const visit = (id, stack) => {
    const x = byId.get(id);
    const l = label(x);
    const ms = selfMs.get(id) ?? 0;
    self.set(l, (self.get(l) ?? 0) + ms);
    // (Each function counted once a stack, however deep it recurses.)
    for (const k of new Set([...stack, l])) total.set(k, (total.get(k) ?? 0) + ms);
    for (const c of x.children ?? []) visit(c, [...stack, l]);
  };
  visit(profile.nodes[0].id, []);
  const top = (m) =>
    [...m]
      .filter(([k]) => !/^\((root|program|idle|garbage collector)\)/.test(k))
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => [k, r1(v)]);
  return {
    self: top(self),
    total: top(total),
    gcMs: r1(self.get([...self.keys()].find((k) => k.startsWith("(garbage collector)")) ?? "") ?? 0),
  };
}

/** Measure a stretch: what the page's main thread, the frames and the input handlers cost in it. */
async function stretch(page, cdp, seconds, during, profileName) {
  if (PROFILE && profileName) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
    await cdp.send("Profiler.start");
  }
  await page.evaluate(() =>
    Object.assign(window.__perf, {
      rec: true,
      raf: [],
      events: [],
      timers: {},
      longtasks: [],
    }),
  );
  const m0 = await metrics(cdp);
  const c0 = treeCpu();
  const f0 = await page.evaluate(() => window.woodrail.framesDrawn);
  const t0 = Date.now();
  if (during) await during();
  const left = seconds * 1000 - (Date.now() - t0);
  if (left > 0) await sleep(left);
  const wall = (Date.now() - t0) / 1000;
  let profile = null;
  if (PROFILE && profileName) {
    const { profile: prof } = await cdp.send("Profiler.stop");
    writeFileSync(`${OUT}/${profileName}.cpuprofile`, JSON.stringify(prof));
    profile = topOf(prof);
  }
  const c1 = treeCpu();
  const m1 = await metrics(cdp);
  const p = await page.evaluate(() => {
    const P = window.__perf;
    P.rec = false;
    return {
      raf: P.raf,
      events: P.events.map((e) => [e.type, e.ms]),
      timers: P.timers,
      longtasks: P.longtasks,
      frames: window.woodrail.framesDrawn,
      simMs: window.woodrail.simMs,
    };
  });
  const drawnCb = p.raf.filter((x) => x[2] > 0).map((x) => x[1]);
  const drawnAt = p.raf.filter((x) => x[2] > 0).map((x) => x[0]);
  const gaps = drawnAt.slice(1).map((t, i) => t - drawnAt[i]);
  const allCb = p.raf.reduce((s, x) => s + x[1], 0);
  const events = {};
  for (const [type, ms] of p.events) (events[type] ??= []).push(ms);
  const timers = Object.fromEntries(Object.entries(p.timers).map(([k, t]) => [k, { perSecond: r2(t.ms / wall), avg: r2(t.ms / t.n), max: r1(t.max) }]));
  return {
    seconds: r1(wall),
    framesDrawn: p.frames - f0,
    fps: r1((p.frames - f0) / wall),
    // Main-thread time, as a share of wall time (throttled: a phone's slower CPU).
    mainThreadPct: r1(((m1.TaskDuration - m0.TaskDuration) / wall) * 100),
    scriptPct: r1(((m1.ScriptDuration - m0.ScriptDuration) / wall) * 100),
    layoutStylePct: r1(((m1.LayoutDuration - m0.LayoutDuration + (m1.RecalcStyleDuration - m0.RecalcStyleDuration)) / wall) * 100),
    // The whole browser (GPU process: SwiftShader's drawing too), % of one core.
    browserCpuPct: r1(((c1 - c0) / wall) * 100),
    rafMsPerSecond: r1(allCb / wall),
    frameMs: {
      p50: r2(q(drawnCb, 0.5)),
      p95: r2(q(drawnCb, 0.95)),
      max: r1(q(drawnCb, 1)),
    },
    // Draw calls and triangles of the frames drawn (median, and the most).
    drawCalls: {
      p50: q(
        p.raf.filter((x) => x[2] > 0).map((x) => x[3]),
        0.5,
      ),
      max: q(
        p.raf.filter((x) => x[2] > 0).map((x) => x[3]),
        1,
      ),
    },
    trianglesK: {
      p50: r1(
        q(
          p.raf.filter((x) => x[2] > 0).map((x) => x[4] / 1000),
          0.5,
        ),
      ),
      max: r1(
        q(
          p.raf.filter((x) => x[2] > 0).map((x) => x[4] / 1000),
          1,
        ),
      ),
    },
    frameGapMs: { p50: r1(q(gaps, 0.5)), p95: r1(q(gaps, 0.95)) },
    simMs: r2(p.simMs),
    events: Object.fromEntries(
      Object.entries(events).map(([k, v]) => [
        k,
        {
          n: v.length,
          p50: r2(q(v, 0.5)),
          p95: r2(q(v, 0.95)),
          max: r1(q(v, 1)),
        },
      ]),
    ),
    timers,
    ...(profile ? { profile } : {}),
    longTasks: {
      n: p.longtasks.length,
      ms: r1(p.longtasks.reduce((s, x) => s + x[1], 0)),
      max: r1(Math.max(0, ...p.longtasks.map((x) => x[1]))),
    },
  };
}

/** Put the camera over (x, z), `dist` mm out, looking down at a slant from the south-east (as a player looks). */
async function lookAt(page, x, z, dist) {
  await page.evaluate(
    ([x, z, dist]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const at = new V(x, 20, z);
      w.controls.target.copy(at);
      w.camera.position.copy(at.clone().add(new V(0.5, 1.1, 0.9).normalize().multiplyScalar(dist)));
      w.camera.lookAt(at);
      w.controls.update?.();
      w.invalidate();
    },
    [x, z, dist],
  );
}

/**
 * Changes near a spot, each timed from the change to the end of the next frame drawn (what the player waits for: the
 * rebuild and the frame): a straight laid on clear ground beside it and taken up again (track, its tile, the depots and
 * cuts near it), and a tree planted and taken out (props: the telegraph's wires look at every props change).
 */
async function spotChanges(page, spot) {
  return page.evaluate(async (spot) => {
    const w = window.woodrail;
    const nextFrame = async () => {
      const f0 = w.framesDrawn;
      w.invalidate();
      const t0 = performance.now();
      while (w.framesDrawn === f0 && performance.now() - t0 < 20000) await new Promise((r) => requestAnimationFrame(r));
    };
    // The change itself (its call), and the main thread's part of the frames until the next is drawn (the rAF
    // callbacks: the game's frame, the rebuilds it does, three's render calls; not SwiftShader's drawing).
    const P = window.__perf;
    const timed = async (fn) => {
      await nextFrame();
      Object.assign(P, { rec: true, raf: [] });
      const t0 = performance.now();
      const out = fn();
      const opMs = performance.now() - t0;
      await nextFrame();
      P.rec = false;
      const frameMs = P.raf.reduce((a, x) => a + x[1], 0);
      return { opMs: Math.round(opMs * 10) / 10, frameMs: Math.round(frameMs * 10) / 10, ok: out !== false && out !== undefined && out !== null };
    };
    const out = {};
    // Board near the spot for a straight (a harness shortcut: laid by the editor where there's board, not checked as a
    // drop is; it's taken up again at once).
    const g = w.world.landscape.grid;
    let at = null;
    for (let r = 500; r <= 1500 && !at; r += 250)
      for (let a = 0; a < 12 && !at; a++) {
        const x = spot.centre.x + Math.cos((a / 12) * Math.PI * 2) * r;
        const z = spot.centre.z + Math.sin((a / 12) * Math.PI * 2) * r;
        const cell = g.cellAtWorld(x, z);
        if (cell !== -1) at = { x, z, y: g.groundY(cell) };
      }
    if (at) {
      let id = -1;
      out.layStraight = await timed(() => (id = w.editor().place("straight-108", { x: at.x, z: at.z, heading: 0 }, at.y, false)));
      if (id > 0) out.takeUp = await timed(() => w.editor().remove(id));
    }
    let prop = null;
    out.plantTree = await timed(() => (prop = w.props.add("scene-lollipop-tree", { x: spot.centre.x + 400, z: spot.centre.z + 400, y: 0, heading: 0 })));
    if (prop) out.takeOutTree = await timed(() => w.props.remove(prop.id));
    return out;
  }, spot);
}

/** What one drawn frame draws (every render call of it: shadows, the scene, the post passes), and what's in memory. */
async function frameInfo(page) {
  return page.evaluate(async () => {
    const w = window.woodrail;
    const info = w.renderer.info;
    info.autoReset = false;
    info.reset();
    const f0 = w.framesDrawn;
    w.renderer.shadowMap.needsUpdate = true;
    w.invalidate();
    const t0 = performance.now();
    while (w.framesDrawn === f0 && performance.now() - t0 < 5000) await new Promise((r) => requestAnimationFrame(r));
    const out = {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      points: info.render.points,
      lines: info.render.lines,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? null,
      pixelRatio: w.renderer.getPixelRatio(),
      pieces: w.layout.pieceCount,
      trains: w.sim.trainIds().length,
      sceneObjects: (() => {
        let n = 0;
        w.scene.traverse(() => n++);
        return n;
      })(),
      domNodes: document.getElementsByTagName("*").length,
      // What's in the scene to draw, by the scene's top-level groups: meshes, and triangles (instances counted;
      // whether in view or not, and before any shadow pass). The biggest single meshes too.
      byGroup: (() => {
        const groups = {};
        const meshes = [];
        const label = (o) => o.name || o.userData?.name || o.constructor?.name || o.type;
        for (const top of w.scene.children) {
          const g = (groups[`${label(top)}`] ??= { meshes: 0, trianglesK: 0, casters: 0 });
          top.traverseVisible((o) => {
            if (!o.isMesh) return;
            const geo = o.geometry;
            const per = (geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)) / 3;
            const n = o.isInstancedMesh ? o.count : 1;
            const range = Number.isFinite(geo.drawRange.count) ? Math.min(geo.drawRange.count / 3, per) : per;
            const tris = range * n;
            g.meshes++;
            g.trianglesK += tris / 1000;
            if (o.castShadow) g.casters++;
            meshes.push([`${label(top)}/${label(o)}${o.isInstancedMesh ? ` x${n}` : ""}`, Math.round(tris / 1000)]);
          });
        }
        for (const g of Object.values(groups)) g.trianglesK = Math.round(g.trianglesK);
        return { groups, biggest: meshes.sort((a, b) => b[1] - a[1]).slice(0, 12) };
      })(),
    };
    info.autoReset = true;
    return out;
  });
}

async function heap(cdp, gc = true) {
  if (gc) await cdp.send("HeapProfiler.collectGarbage");
  const h = await cdp.send("Runtime.getHeapUsage");
  return r1(h.usedSize / 1048576);
}

/** Time from a tap (in the page, synchronous handlers included) to the next frame painted after it. */
async function tapToPaint(page, selector) {
  return page.evaluate(async (sel) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : null;
    if (!el) return null;
    const t0 = performance.now();
    el.click();
    const sync = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      syncMs: Math.round(sync * 10) / 10,
      toPaintMs: Math.round((performance.now() - t0) * 10) / 10,
    };
  }, selector);
}

async function closeCards(page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape");
  await settleView(page, 3000);
}

async function settle(page, ms = 15000) {
  await page.evaluate((ms) => Promise.race([window.woodrail.settled(5), new Promise((r) => setTimeout(r, ms))]), ms);
}

/**
 * After a camera move or a card closed, before a measure: wait for the view to come to rest (the move's last frames,
 * far and near detail swapped, pieces carved), with the game paused for the wait if it's running and then running
 * again. Running, `settled()` never comes while a train moves in view (each tick draws), so every such wait ran out
 * its whole time (8 s a spot: 90 s of the features map). What's measured after is the same: the game is running again
 * before it.
 */
async function settleView(page, ms = 15000) {
  const was = await page.evaluate(() => {
    const p = window.woodrail.paused;
    window.woodrail.paused = true;
    return p;
  });
  await settle(page, ms);
  await page.evaluate((p) => (window.woodrail.paused = p), was);
}

async function runMap(id) {
  const def = MAP_DEFS[id];
  // Where the run's time goes, by phase (printed as it goes, and kept in the results: `phases`, seconds).
  const phases = {};
  let lap = Date.now();
  const phase = (name) => {
    const s = Math.round((Date.now() - lap) / 100) / 10;
    phases[name] = Math.round(((phases[name] ?? 0) + s) * 10) / 10;
    lap = Date.now();
  };
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: DPR,
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    // (No "Help improve Woodrail?" question or tutorial toasts in the way.)
    localStorage.setItem("woodrail.stats.asked", "1");
  });
  await page.addInitScript(INSTRUMENT);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const result = { map: id, label: def.label, errors };

  // 1. Load to interactive: a first visit (nothing cached), then a reload (the build's tray pictures and carved track
  // cached, as a returning player has them). Everything after runs on the reloaded page.
  let url = BASE;
  if (def.load) url = `${BASE}?dev#load=${readFileSync(`${HERE}/maps/${def.load}`, "utf8").trim()}`;
  const open = async (go) => {
    const t0 = Date.now();
    await go();
    await page.waitForFunction(() => window.woodrail?.title && (window.woodrail.title.shown || window.__perf.readyAt !== null), null, { timeout: 300000 });
    // Past the title (a new game, or Continue), as a player's tap is.
    await page.evaluate(
      (fresh) => {
        if (!window.woodrail.title.shown) return;
        const buttons = [...document.querySelectorAll(fresh ? ".title-card.mode-game button" : ".title-card button")];
        buttons.find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click();
      },
      def.mode === "game" && !def.load,
    );
    await page.waitForFunction(() => window.__perf.readyAt !== null, null, {
      timeout: 300000,
    });
    const r = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      const res = performance.getEntriesByType("resource");
      return {
        readyMs: Math.round(window.__perf.readyAt),
        domContentLoadedMs: Math.round(n.domContentLoadedEventEnd),
        transferKB: Math.round(res.reduce((s, x) => s + (x.transferSize || 0), 0) / 1024),
        mode: window.woodrail.mode(),
      };
    });
    return { ...r, wallMs: Date.now() - t0 };
  };
  const cold = await open(() => page.goto(url));
  // The first visit's own work after it's ready (tray pictures drawn and kept, track carved), timed to its end.
  const bg0 = Date.now();
  await page.evaluate((ms) => Promise.race([window.woodrail.trayThumbnailsSaved(), new Promise((r) => setTimeout(r, ms))]), RELOAD ? 300000 : 20000);
  await settle(page, RELOAD ? 60000 : 10000);
  cold.backgroundMs = Date.now() - bg0;
  let warm = null;
  if (RELOAD) {
    await page.waitForTimeout(5500); // (an autosave: the map kept for the reload)
    if (PROFILE) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
      await cdp.send("Profiler.start");
    }
    warm = await open(() => page.reload());
    if (PROFILE) {
      const { profile } = await cdp.send("Profiler.stop");
      writeFileSync(`${OUT}/${id}-reload.cpuprofile`, JSON.stringify(profile));
      warm.profile = topOf(profile);
    }
  }
  result.load = { cold, warm };
  phase("load");
  await page.keyboard.press("Escape");
  await settle(page, 20000);
  await page.waitForTimeout(2000);

  // 2. Idle (trains, if the map's are running: steady): nothing touched.
  result.frame = await frameInfo(page);
  result.heapMB = await heap(cdp);
  const trainsRunning = await page.evaluate(() => window.woodrail.sim.trainIds().some((id) => window.woodrail.sim.getTrain(id).speed > 0));
  result.idle = await stretch(page, cdp, IDLE_S, null, `${id}-idle`);
  result.idle.trainsRunning = trainsRunning;
  phase("settle, frame, idle");

  // 3. Paused, as still as the game gets (the idle floor).
  if (trainsRunning) {
    await page.evaluate(() => (window.woodrail.paused = true));
    await settle(page);
    result.paused = await stretch(page, cdp, Math.min(IDLE_S, 10), null, `${id}-paused`);
    await page.evaluate(() => (window.woodrail.paused = false));
  }

  // 4. Pan and zoom: a finger's drags and a few wheel steps, as fast as a player moves.
  if (TRACE)
    await browser.startTracing(page, {
      path: `${OUT}/${id}-pan.trace.json`,
      categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink.user_timing"],
    });
  result.pan = await stretch(
    page,
    cdp,
    0,
    async () => {
      // (Bounded by time, not by moves: each move waits for a frame, and SwiftShader's frames are slow.)
      const cx = 195;
      const cy = 420;
      const until = Date.now() + PAN_S * 1000;
      for (let k = 0; k < 3 && Date.now() < until; k++) {
        await page.mouse.move(cx - 100, cy);
        await page.mouse.down();
        for (let i = 0; i <= 30 && Date.now() < until; i++) await page.mouse.move(cx - 100 + i * 7, cy + Math.sin(i / 5) * 60);
        await page.mouse.up();
        for (let i = 0; i < 4 && Date.now() < until; i++) {
          await page.mouse.move(cx, cy);
          await page.mouse.wheel(0, k % 2 ? 160 : -160);
          await page.waitForTimeout(60);
        }
      }
      await page.waitForTimeout(500);
    },
    `${id}-pan`,
  );
  if (TRACE) await browser.stopTracing();
  await settleView(page);
  phase("paused, pan");

  // 5. Operations.
  const ops = {};
  // The ☰ menu.
  ops.menu = await tapToPaint(page, 'button[aria-label="Menu"]');
  await closeCards(page);
  // The research board (Game).
  if (def.mode === "game") {
    if (PROFILE) {
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
      await cdp.send("Profiler.start");
    }
    ops.researchBoard = await tapToPaint(page, "button.research-btn");
    if (PROFILE) {
      const { profile } = await cdp.send("Profiler.stop");
      writeFileSync(`${OUT}/${id}-research.cpuprofile`, JSON.stringify(profile));
      ops.researchBoard.profile = topOf(profile);
    }
    await closeCards(page);
  }
  // A train's card: a tap on its engine (as a player taps it).
  const engineAt = await page.evaluate(() => {
    const w = window.woodrail;
    const s = w.snapshot;
    for (let i = 0; i < s.count; i++) {
      const o = w.trainView.carObject(s.ids[i]);
      if (!o) continue;
      const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
      if (Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.6 && v.z < 1) {
        const r = w.canvas.getBoundingClientRect();
        return {
          x: r.left + ((v.x + 1) / 2) * r.width,
          y: r.top + ((1 - v.y) / 2) * r.height,
        };
      }
    }
    return null;
  });
  if (engineAt) {
    await page.evaluate(() => Object.assign(window.__perf, { rec: true, events: [] }));
    const t = Date.now();
    await page.touchscreen.tap(engineAt.x, engineAt.y);
    await page.waitForFunction(() => !!document.querySelector(".card:not([hidden])"), null, { timeout: 5000 }).catch(() => {});
    const ev = await page.evaluate(() => {
      window.__perf.rec = false;
      return window.__perf.events.map((e) => e.ms);
    });
    ops.trainCard = {
      tapHandlersMs: r1(ev.reduce((a, b) => a + b, 0)),
      wallMs: Date.now() - t,
      opened: await page.evaluate(() => !!document.querySelector(".card:not([hidden])")),
    };
    await closeCards(page);
  }
  // A tray drag: a straight from the Track tray, dragged across the map and back over the tray (no drop): the cost of
  // each pointer move (snapping, placement checks, the preview).
  const tile = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".tray-item[data-key]")].find((b) => /straight/.test(b.dataset.key) && b.offsetParent);
    if (!el) return null;
    el.scrollIntoView({ inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, key: el.dataset.key };
  });
  if (tile) {
    ops.trayDrag = await stretch(page, cdp, 0, async () => {
      const until = Date.now() + PAN_S * 1000;
      await page.mouse.move(tile.x, tile.y);
      await page.mouse.down();
      let i = 1;
      for (; i <= 40 && Date.now() < until; i++) await page.mouse.move(tile.x + Math.sin(i / 6) * 120, tile.y - 40 - i * 9);
      // Back over the tray (no drop).
      await page.mouse.move(tile.x, tile.y - 100);
      await page.mouse.move(tile.x, tile.y);
      await page.mouse.up();
    }, `${id}-tray`);
    ops.trayDrag = {
      piece: tile.key,
      pointermove: ops.trayDrag.events.pointermove ?? null,
      frameMs: ops.trayDrag.frameMs,
    };
    await closeCards(page);
  }
  // The autosave and the HUD's once-a-second work: from the idle stretch's timers.
  ops.autosave = result.idle.timers["interval:5000"] ?? null;
  ops.hudSecond = Object.fromEntries(Object.entries(result.idle.timers).filter(([k]) => k === "interval:1000" || k === "interval:500"));
  result.ops = ops;
  phase("operations");

  // 5b. Spots (a map with `spots`): the camera on each feature alone, as a player looks at it. For each: one full
  // frame there (draw calls, triangles), a running stretch (frames drawn, frame cost, main thread), a paused one (the
  // floor: nothing should draw), and changes near it (a straight laid and taken up, a tree planted and taken out): the
  // frame after each, which pays for the rebuild. Then the camera away from them all, running: frames drawn while
  // nothing moving is in view (ambient motion off screen asks for none).
  if (def.spots) {
    const spots = JSON.parse(readFileSync(`${HERE}/maps/${def.spots}`, "utf8")).features.filter((x) => !ONLY_SPOTS || ONLY_SPOTS.includes(x.id));
    result.spots = {};
    for (const spot of spots) {
      const r = {};
      try {
        await lookAt(page, spot.centre.x, spot.centre.z, spot.dist ?? 900);
        await settleView(page, 8000);
        await page.waitForTimeout(800);
        phase("spots: look, settle");
        const f = await frameInfo(page);
        phase("spots: frame");
        r.frame = { drawCalls: f.drawCalls, triangles: f.triangles, programs: f.programs, geometries: f.geometries };
        const run = await stretch(page, cdp, SPOT_S, null, PROFILE ? `${id}-${spot.id}-run` : null);
        phase("spots: running");
        r.running = { framesDrawn: run.framesDrawn, fps: run.fps, mainThreadPct: run.mainThreadPct, frameMs: run.frameMs, rafMsPerSecond: run.rafMsPerSecond };
        await page.evaluate(() => (window.woodrail.paused = true));
        await settle(page, 5000);
        const pz = await stretch(page, cdp, Math.min(SPOT_S, 4), null, null);
        r.paused = { framesDrawn: pz.framesDrawn, mainThreadPct: pz.mainThreadPct, rafMsPerSecond: pz.rafMsPerSecond };
        phase("spots: paused");
        r.changes = await spotChanges(page, spot);
        phase("spots: changes");
        await page.evaluate(() => (window.woodrail.paused = false));
      } catch (e) {
        r.failed = String(e).slice(0, 300);
        await page.evaluate(() => (window.woodrail.paused = false)).catch(() => {});
      }
      result.spots[spot.id] = r;
      console.log(`  ${id} spot ${spot.id}: ${JSON.stringify(r)}`);
    }
    // Away from every feature (high over an empty corner of the board), the game running: what still asks for frames.
    const away = spots.reduce((a, x) => ({ x: Math.max(a.x, x.centre.x), z: Math.max(a.z, x.centre.z) }), { x: -Infinity, z: -Infinity });
    await lookAt(page, away.x + 30000, away.z + 30000, 900);
    await settleView(page, 8000);
    const aw = await stretch(page, cdp, SPOT_S, null, null);
    phase("away");
    result.spots.away = { running: { framesDrawn: aw.framesDrawn, mainThreadPct: aw.mainThreadPct, rafMsPerSecond: aw.rafMsPerSecond } };
    // Every train stopped (levers to 0, as a player stops them; the game running): what's left moving is ambient
    // motion (a pumpjack, a saw, road vehicles), which asks for frames only where it's seen. Each spot again, and away.
    await page.evaluate(() => {
      const w = window.woodrail;
      for (const id of w.sim.trainIds()) for (const c of w.sim.getTrain(id).cars) if (c.kind === "engine") w.sim.setLever(c.id, 0);
    });
    await page.waitForFunction(() => window.woodrail.sim.trainIds().every((id) => window.woodrail.sim.getTrain(id).speed === 0), null, { timeout: 60000 }).catch(() => {});
    phase("trains stopping");
    for (const spot of spots) {
      try {
        await lookAt(page, spot.centre.x, spot.centre.z, spot.dist ?? 900);
        await settleView(page, 6000);
        const st = await stretch(page, cdp, SPOT_S, null, null);
        phase("spots: still");
        result.spots[spot.id].still = { framesDrawn: st.framesDrawn, mainThreadPct: st.mainThreadPct, frameMs: st.frameMs, rafMsPerSecond: st.rafMsPerSecond };
      } catch (e) {
        result.spots[spot.id].still = { failed: String(e).slice(0, 200) };
      }
    }
    {
      const far = spots.reduce((a, x) => ({ x: Math.max(a.x, x.centre.x), z: Math.max(a.z, x.centre.z) }), { x: -Infinity, z: -Infinity });
      await lookAt(page, far.x + 30000, far.z + 30000, 900);
      await settleView(page, 6000);
      const st = await stretch(page, cdp, SPOT_S, null, null);
      phase("away still");
      result.spots.awayStill = { framesDrawn: st.framesDrawn, mainThreadPct: st.mainThreadPct, rafMsPerSecond: st.rafMsPerSecond };
    }
    // A breakdown crane at work (crane spot): sent to lift the train nearest it off the line, watched once it's there,
    // then paused, then with the camera away (it works on unseen: no frames). Last, as it takes a train off the map.
    const crane = spots.find((x) => x.id === "crane");
    if (crane) {
      const r = {};
      try {
        r.sent = await page.evaluate(([craneCar, line, siding]) => {
          const w = window.woodrail;
          // A wagon put on the crane's own line, its first piece (a harness shortcut: the target, by the sim, as a
          // train dragged out is), for the crane to lift off.
          let placed = null;
          for (const pieceId of line) {
            if (pieceId === siding) continue;
            for (const s of [20, 60, 100]) {
              placed = w.sim.addTrain(["van"], { pieceId, pathIndex: 0, s, reversed: false });
              if (placed.kind === "placed") break;
            }
            if (placed.kind === "placed") break;
          }
          if (placed?.kind !== "placed") return { placed: placed?.kind ?? null };
          const id = w.sim.trainIds().at(-1);
          const target = w.sim.getTrain(id).cars[0].id;
          const res = w.economy.breakdown.send(target, "remove");
          return { target, res: JSON.stringify(res) };
        }, [crane.crane, crane.pieces, crane.siding]);
        // Until it's at work (past driving out), up to a minute.
        await page.waitForFunction((c) => { const j = window.woodrail.economy.breakdown.jobOf(c); return !j || j.phase !== "drive"; }, crane.crane, { timeout: 120000 }).catch(() => {});
        const at = await page.evaluate((c) => { const o = window.woodrail.trainView.carObject(c); return o && { x: o.position.x, z: o.position.z }; }, crane.crane);
        if (at) await lookAt(page, at.x, at.z, crane.dist ?? 800);
        const work = await stretch(page, cdp, SPOT_S, null, PROFILE ? `${id}-crane-work` : null);
        r.working = { framesDrawn: work.framesDrawn, mainThreadPct: work.mainThreadPct, frameMs: work.frameMs, phase: await page.evaluate((c) => window.woodrail.economy.breakdown.jobOf(c)?.phase ?? null, crane.crane) };
        await page.evaluate(() => (window.woodrail.paused = true));
        const pz = await stretch(page, cdp, Math.min(SPOT_S, 4), null, null);
        r.paused = { framesDrawn: pz.framesDrawn, mainThreadPct: pz.mainThreadPct, busy: await page.evaluate(() => window.woodrail.economy.breakdown.busy) };
        await page.evaluate(() => (window.woodrail.paused = false));
        await lookAt(page, (at?.x ?? 0) + 30000, (at?.z ?? 0) + 30000, 900);
        await settleView(page, 4000);
        const aw = await stretch(page, cdp, Math.min(SPOT_S, 4), null, null);
        r.away = { framesDrawn: aw.framesDrawn, mainThreadPct: aw.mainThreadPct, busy: await page.evaluate(() => window.woodrail.economy.breakdown.busy) };
      } catch (e) {
        r.failed = String(e).slice(0, 300);
        await page.evaluate(() => (window.woodrail.paused = false)).catch(() => {});
      }
      result.spots.craneWork = r;
      phase("crane at work");
      console.log(`  ${id} crane at work: ${JSON.stringify(r)}`);
    }
  }

  // 6. A long run: heap and frames, with a pan now and then.
  if (SOAK_S > 0) {
    const h0 = await heap(cdp);
    const d0 = (await frameInfo(page)).geometries;
    const samples = [];
    const tEnd = Date.now() + SOAK_S * 1000;
    while (Date.now() < tEnd) {
      await page.mouse.move(150, 400);
      await page.mouse.down();
      for (let i = 0; i < 10; i++) await page.mouse.move(150 + i * 10, 400);
      await page.mouse.up();
      await page.waitForTimeout(30000);
      samples.push({
        t: Math.round((SOAK_S * 1000 - (tEnd - Date.now())) / 1000),
        heapMB: await heap(cdp, false),
      });
    }
    const h1 = await heap(cdp);
    const info = await frameInfo(page);
    result.soak = {
      seconds: SOAK_S,
      heapStartMB: h0,
      heapEndMB: h1,
      heapGrowthMB: r1(h1 - h0),
      geometriesStart: d0,
      geometriesEnd: info.geometries,
      texturesEnd: info.textures,
      samples,
    };
  }
  result.heapEndMB = await heap(cdp);
  phase("end");
  result.phases = phases;
  console.error(`perf: ${id} phases (s): ${JSON.stringify(phases)}`);
  result.errors = errors;
  await ctx.close();
  return result;
}

const run = {
  when: new Date().toISOString(),
  commit: (() => {
    try {
      return readFileSync(".git/HEAD", "utf8").trim();
    } catch {
      return null;
    }
  })(),
  settings: {
    throttle: THROTTLE,
    dpr: DPR,
    viewport: "390x844",
    idleSeconds: IDLE_S,
    soakSeconds: SOAK_S,
    quick: QUICK,
    cores: cpus().length,
  },
  bundle: bundleSize(),
  maps: {},
};

function bundleSize() {
  const dir = `${ROOT}/dist/assets`;
  let js = 0;
  let css = 0;
  let entry = 0;
  try {
    for (const f of readdirSync(dir)) {
      const n = readFileSync(`${dir}/${f}`).length;
      if (f.endsWith(".js")) js += n;
      if (f.endsWith(".css")) css += n;
      if (/^index-.*\.js$/.test(f)) entry = Math.max(entry, n);
    }
  } catch {}
  // The entry and the chunks it imports statically: what a first visit fetches before any of the game runs.
  let first = 0;
  try {
    for (const f of firstDownload(`${ROOT}/dist`)) first += readFileSync(`${ROOT}/dist/${f}`).length;
  } catch {}
  return {
    jsKB: Math.round(js / 1024),
    entryJsKB: Math.round(entry / 1024),
    firstJsKB: Math.round(first / 1024),
    cssKB: Math.round(css / 1024),
  };
}

for (const id of MAPS) {
  const t = Date.now();
  try {
    run.maps[id] = await runMap(id);
  } catch (e) {
    run.maps[id] = { map: id, failed: String(e?.stack ?? e) };
  }
  console.error(`perf: ${id} done in ${((Date.now() - t) / 1000).toFixed(0)} s`);
  // (Kept as it goes: a run stopped part way keeps the maps it did.)
  writeFileSync(`${OUT}/perf.json`, JSON.stringify(run, null, 2) + "\n");
}
await browser.close();
await server.close();

// Resolve the commit for the record.
try {
  const head = run.commit?.startsWith("ref: ") ? readFileSync(`.git/${run.commit.slice(5)}`, "utf8").trim() : run.commit;
  run.commit = head?.slice(0, 10) ?? null;
} catch {}

writeFileSync(`${OUT}/perf.json`, JSON.stringify(run, null, 2) + "\n");
const md = table(run);
writeFileSync(`${OUT}/perf.md`, md);
console.log(md);
console.log(`\nwritten: ${OUT}/perf.json, ${OUT}/perf.md`);

function table(run) {
  const ids = Object.keys(run.maps);
  const get = (m, path) => path.split(".").reduce((o, k) => (o === null || o === undefined ? o : o[k]), m);
  const rows = [
    ["load: first visit, ready (ms)", "load.cold.readyMs"],
    ["load: first visit, its work after (ms)", "load.cold.backgroundMs"],
    ["load: transferred, first visit (KB)", "load.cold.transferKB"],
    ["load: reload, ready (ms)", "load.warm.readyMs"],
    ["idle: frames drawn", "idle.framesDrawn"],
    ["idle: main thread %", "idle.mainThreadPct"],
    ["idle: browser CPU % of a core", "idle.browserCpuPct"],
    ["idle: frame ms p50 / p95", (m) => fmt2(get(m, "idle.frameMs.p50"), get(m, "idle.frameMs.p95"))],
    ["idle: sim ms (last frame)", "idle.simMs"],
    ["paused: frames / main thread %", (m) => (m.paused ? `${m.paused.framesDrawn} / ${m.paused.mainThreadPct}` : "–")],
    ["pan: fps", "pan.fps"],
    ["pan: frame ms p50 / p95", (m) => fmt2(get(m, "pan.frameMs.p50"), get(m, "pan.frameMs.p95"))],
    ["pan: frame gap ms p50 / p95", (m) => fmt2(get(m, "pan.frameGapMs.p50"), get(m, "pan.frameGapMs.p95"))],
    ["pan: pointermove ms p50 / p95", (m) => fmt2(get(m, "pan.events.pointermove.p50"), get(m, "pan.events.pointermove.p95"))],
    ["pan: long tasks (n / ms)", (m) => fmt2(get(m, "pan.longTasks.n"), get(m, "pan.longTasks.ms"))],
    ["tray drag: pointermove ms p50 / p95", (m) => fmt2(get(m, "ops.trayDrag.pointermove.p50"), get(m, "ops.trayDrag.pointermove.p95"))],
    ["menu: tap handler / to paint (ms)", (m) => fmt2(get(m, "ops.menu.syncMs"), get(m, "ops.menu.toPaintMs"))],
    ["research board: tap handler / to paint (ms)", (m) => fmt2(get(m, "ops.researchBoard.syncMs"), get(m, "ops.researchBoard.toPaintMs"))],
    ["train card: tap handlers (ms)", "ops.trainCard.tapHandlersMs"],
    ["autosave (ms each)", "ops.autosave.avg"],
    ["1 s HUD timer (ms each)", "ops.hudSecond.interval:1000.avg"],
    ["draw calls / frame (with shadows)", "frame.drawCalls"],
    ["triangles / frame, with shadows (k)", (m) => (m.frame ? Math.round(m.frame.triangles / 1000) : "–")],
    ["pan: draw calls / triangles (k), median frame", (m) => fmt2(get(m, "pan.drawCalls.p50"), get(m, "pan.trianglesK.p50"))],
    ["programs / geometries / textures", (m) => (m.frame ? `${m.frame.programs} / ${m.frame.geometries} / ${m.frame.textures}` : "–")],
    ["scene objects / DOM nodes", (m) => (m.frame ? `${m.frame.sceneObjects} / ${m.frame.domNodes}` : "–")],
    ["pixel ratio at the end", "frame.pixelRatio"],
    ["heap after GC (MB)", "heapMB"],
    ["soak: heap growth (MB)", "soak.heapGrowthMB"],
    ["page errors", (m) => (m.errors ? m.errors.length : "–")],
  ];
  function fmt2(a, b) {
    return a === undefined || a === null ? "–" : `${a} / ${b}`;
  }
  const head = `Perf run ${run.when} (${run.commit ?? "?"}), throttle ${run.settings.throttle}×, DPR ${run.settings.dpr}, 390×844; bundle JS ${run.bundle.jsKB} KB (entry ${run.bundle.entryJsKB} KB, first download ${run.bundle.firstJsKB} KB)\n\n`;
  let s = head + `| | ${ids.map((i) => run.maps[i].label ?? i).join(" | ")} |\n|---|${ids.map(() => "---").join("|")}|\n`;
  for (const [name, path] of rows) {
    const cells = ids.map((i) => {
      const m = run.maps[i];
      if (m.failed) return "failed";
      const v = typeof path === "function" ? path(m) : get(m, path);
      return v === undefined || v === null ? "–" : String(v);
    });
    if (cells.every((c) => c === "–")) continue;
    s += `| ${name} | ${cells.join(" | ")} |\n`;
  }
  for (const i of ids) if (run.maps[i].failed) s += `\n${i} failed: ${run.maps[i].failed.split("\n")[0]}\n`;
  return s;
}
