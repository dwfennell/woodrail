// End-to-end delivery history (spec docs/superpowers/specs/2026-11-28-delivery-history.md) in Game mode on a 390×844
// phone, by taps, on the game's test clock at 8× (`npm run e2e:history [-- <out dir>]`):
//  train  The starter map: track from its forest yard to its sawmill and on to the nearest town, a train of two
//         flatbeds on a line forest → sawmill → town (setup shortcuts: the pathfinder lays the track, the line is made as
//         the Lines list makes one; routing by taps is e2e:routes-ux's). It runs by game time: logs to the sawmill,
//         planks to the town. A tap on the engine, History on its card (44 px): the sheet (its name, the summary, a row
//         a stop, newest first): at the forest "Picked up … logs → <sawmill>", at the sawmill "Dropped … logs from
//         <forest> · <time>", at the town planks dropped from the sawmill with their coins "+N🪙" (the payoff: the coins
//         the town paid, in the log). The stop's row is 44 px; a tap on it frames the stop on the map and the sheet
//         stays. 0 frames drawn while it sits open, paused. A reload keeps it: the same rows.
//  boat   Two river landings put on the bank (as a drop would), logs on the first, a tug launched there and its route
//         the two landings (setup shortcuts: buying and routing a boat by taps is e2e:water's). It sails by game time and
//         drops the logs at the second. A tap on the boat, History on its card: "Picked up … logs → <landing 2>" and
//         "Dropped … logs from <landing 1>". A reload keeps it.
// Pictures in the out dir (history-*.jpg; for the docs: docs/agents/shots/history-*.jpg). Starts its own dev server.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/history";
mkdirSync(OUT, { recursive: true });
const ONLY = (process.env.E2E_ONLY ?? "").split(",").filter(Boolean);
if (process.argv.includes("--list")) {
  console.log("train\nboat");
  process.exit(0);
}
const want = (g) => ONLY.length === 0 || ONLY.includes(g);
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5433, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (At 8×: the trains' and the boat's runs wait on game time, minutes of it. Each frame's step up to 8 s of it.)
testClockIn(b, { speed: 8, maxDt: 8 });

let failures = 0;
let checks = 0;
const check = (what, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, ok ? "" : detail);
};

async function phone() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.E2E_PHONE_DPR ?? 1), hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    window.__allClicks = 0;
    window.addEventListener("click", () => window.__allClicks++, { capture: true });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  const h = { p, ctx, errors };
  h.shot = (n) => p.screenshot({ path: `${OUT}/history-${n}.jpg`, type: "jpeg", quality: 84, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
  h.frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  h.settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  h.tapped = async (act) => {
    const before = await p.evaluate(() => window.__allClicks);
    await act();
    await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(350);
    await h.frames();
  };
  /** Tap the first visible element matching `selector` (its text starting with `text`, if given). */
  h.tap = async (selector, text) => {
    await p.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)].some((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.trim().startsWith(text))), { selector, text }, { timeout: 15000 }).catch(() => {});
    const at = await p.evaluate(
      ({ selector, text }) => {
        const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.trim().startsWith(text)));
        if (!el) return null;
        el.scrollIntoView({ block: "nearest" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      { selector, text },
    );
    if (!at) return false;
    // (Past the card's tap guard: a button just drawn is let stand a moment.)
    await p.waitForTimeout(400);
    await h.tapped(() => p.touchscreen.tap(at.x, at.y));
    return true;
  };
  h.glide = async (v, dist) => {
    await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y ?? 0, v.z), dist, { duration: 0.2, inRoom: true }), [v, dist]);
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
    await h.frames();
  };
  /** Tap a car object (an engine, by car id) or a tug (by boat id) where the game's own pick finds it, paused. */
  h.tapThing = async (what, isOpen, dist = 900) => {
    await p.evaluate(() => (window.woodrail.paused = true));
    try {
      for (let k = 0; k < 4; k++) {
        const v = await p.evaluate((what) => {
          const w = window.woodrail;
          const o = what.engine !== undefined ? w.trainView.carObject(what.engine) : w.riverBoats.tugOf(what.boat);
          if (!o) return null;
          const q = o.getWorldPosition(new w.camera.position.constructor());
          return { x: q.x, y: q.y, z: q.z };
        }, what);
        if (!v) return false;
        await h.glide(v, dist);
        await h.settle();
        const at = await p.evaluate((what) => {
          const w = window.woodrail;
          const o = what.engine !== undefined ? w.trainView.carObject(what.engine) : w.riverBoats.tugOf(what.boat);
          const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
          const cx = ((v.x + 1) / 2) * innerWidth;
          const cy = ((1 - v.y) / 2) * innerHeight;
          const spots = [];
          for (let dx = -36; dx <= 36; dx += 6) for (let dy = -36; dy <= 36; dy += 6) spots.push([cx + dx, cy + dy]);
          spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
          for (const [x, y] of spots) {
            if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1 || document.elementFromPoint(x, y) !== w.canvas) continue;
            const hit = w.interaction.pick(x, y, true);
            if (what.engine !== undefined ? hit?.kind === "car" && hit.carId === what.engine : hit?.kind === "boat" || hit === null) return [x, y];
          }
          return [cx, cy];
        }, what);
        if (at) await h.tapped(() => p.touchscreen.tap(at[0], at[1]));
        await p.waitForFunction(isOpen, null, { timeout: 10000 }).catch(() => {});
        if (await p.evaluate(isOpen)) return true;
      }
      return false;
    } finally {
      await p.evaluate(() => (window.woodrail.paused = false));
    }
  };
  /** Play on (the game's own frames, on the test clock) until `fn(arg)` is truthy, or `seconds` of game time pass. */
  h.playUntil = async (fn, arg, seconds) => {
    const t0 = await p.evaluate(() => window.woodrail.simSeconds);
    const until = Date.now() + Math.max(180, seconds) * 1000;
    for (;;) {
      const r = await p.evaluate(fn, arg);
      if (r) return r;
      const t = await p.evaluate(() => window.woodrail.simSeconds);
      if (t - t0 > seconds) return null;
      if (Date.now() > until) {
        console.log(`(game time crawled: ${(t - t0).toFixed(1)} of ${seconds} s)`);
        return null;
      }
      await p.waitForTimeout(1000);
    }
  };
  h.start = () => p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  h.open = async () => {
    await p.goto(PAGE);
    await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
    await h.start();
    await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
    await h.settle();
    await p.keyboard.press("Escape");
    await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  };
  /** Save, reload the page and open the game again (Continue). */
  h.reload = async () => {
    await p.evaluate(() => window.woodrail.saveNow?.());
    await p.waitForTimeout(3000);
    await p.reload();
    await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
    await h.start();
    await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
    await h.settle();
  };
  /** The open History sheet as shown: its title, sub, summary, and each row's stop, time and lines. */
  h.sheet = () =>
    p.evaluate(() => {
      const s = document.querySelector(".history-sheet:not([hidden])");
      if (!s) return null;
      return {
        title: s.querySelector("h2")?.textContent,
        sub: s.querySelector(".history-sub")?.textContent,
        summary: s.querySelector(".history-summary")?.textContent,
        rows: [...s.querySelectorAll(".history-visit")].map((v) => ({ stop: v.querySelector(".history-stop-name")?.textContent, h: v.querySelector(".history-stop").getBoundingClientRect().height, ago: v.querySelector(".history-ago")?.textContent, lines: [...v.querySelectorAll(".history-line")].map((l) => l.textContent) })),
      };
    });
  /** Frames drawn in 2.5 s, paused and settled (`framesDrawn`). */
  h.idle = () =>
    p.evaluate(async () => {
      const w = window.woodrail;
      w.paused = true;
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
      const n0 = w.framesDrawn;
      await new Promise((r) => setTimeout(r, 2500));
      const n = w.framesDrawn - n0;
      w.paused = false;
      return n;
    });
  h.done = async (what) => {
    check(`${what}: no page errors`, errors.length === 0, errors.slice(0, 5).join(" | "));
    await ctx.close();
  };
  return h;
}

const box = (p, sel) => p.evaluate((sel) => {
  const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
  if (!e) return null;
  const r = e.getBoundingClientRect();
  return { w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
}, sel);

const group = async (name, body) => {
  if (!want(name)) return;
  console.log(`--- ${name}`);
  try {
    await body();
  } catch (e) {
    check(`${name}: ran to the end`, false, e.stack?.split("\n").slice(0, 3).join(" | "));
  }
};

// ---- A train ----------------------------------------------------------------------------------------------------------
await group("train", async () => {
  const h = await phone();
  const { p } = h;
  await h.open();
  // Setup (not what's tested): routes learned; track from the starter map's forest yard to its sawmill and on to the
  // nearest town, by the player's own pathfinder; a train of two flatbeds at the forest yard on a line forest →
  // sawmill → town, made as the Lines list makes one, lever on.
  const setup = await p.evaluate(async () => {
    const { play } = await import("/src/play/player.ts");
    const { rulesFor } = await import("/src/play/rules.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    const L = await import("/src/game/lines.ts");
    const { routeStops } = await import("/src/game/route-stops.ts");
    const w = window.woodrail;
    for (const id of ["switches", "routes"]) w.learn(id);
    w.hud.refreshTrayBadges();
    const land = w.world.landscape;
    const pieceOf = (kind) => w.world.depots.get(land.depots.find((d) => d.kind === kind).id);
    const [millPiece, forestPiece] = [pieceOf("sawmill"), pieceOf("forest")];
    const join = (a, b) => {
      for (const maxPieces of [120, 240])
        for (const [i, j] of [[1, 0], [0, 0], [1, 1], [0, 1]]) {
          const before = new Set(w.layout.pieceIds());
          const r = play(w.world.layout, w.editor(), connectorRef(a, i), connectorRef(b, j), { blocked: rulesFor(w.world), maxPieces, fiddle: 3 });
          const fresh = [...w.layout.pieceIds()].filter((id) => !before.has(id));
          if (r.ok) return fresh;
          for (const id of fresh.reverse()) w.editor().remove(id);
        }
      return null;
    };
    const one = join(forestPiece, millPiece);
    if (!one) return { error: "no track from the forest yard to the sawmill" };
    const mill = w.layout.getPiece(millPiece).pose;
    const towns = land.towns.filter((t) => w.world.stations.has(t.id)).sort((a, b) => Math.hypot(a.centre.x - mill.x, a.centre.z - mill.z) - Math.hypot(b.centre.x - mill.x, b.centre.z - mill.z));
    let town = null;
    for (const t of towns)
      if (join(millPiece, w.world.stations.get(t.id))) {
        town = t;
        break;
      }
    if (!town) return { error: "no track from the sawmill to a town" };
    const forest = w.economy.depotAtPiece(forestPiece).id;
    const sawmill = w.economy.depotAtPiece(millPiece).id;
    const station = w.economy.depotAtPiece(w.world.stations.get(town.id)).id;
    let engine = -1;
    for (const pieceId of [forestPiece, ...one])
      for (const s of [20, 60, 100, 140]) {
        if (engine !== -1) break;
        const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, reversed: false, s });
        if (r.kind === "placed") engine = w.sim.getTrain(r.trainId).cars[0].id;
      }
    if (engine === -1) return { error: "no room for the train" };
    const line = L.createLine(w.economy, [forest, sawmill, station].map((depotId) => ({ depotId, action: "auto" })));
    L.joinLine(w.economy, engine, line.id);
    w.sim.setLever(engine, 1);
    w.trackChanged?.();
    w.invalidate();
    const names = routeStops(w.world);
    const name = (id) => names.find((st) => st.depotId === id)?.name;
    return { engine, forest, sawmill, station, names: { forest: name(forest), sawmill: name(sawmill), station: name(station) } };
  });
  check("train: setup, a line forest → sawmill → town on the starter map", !setup.error, JSON.stringify(setup));
  if (setup.error) return h.done("train");
  // It runs, by game time: logs to the sawmill, planks to the town, the town's coins in its log.
  const ran = await h.playUntil(
    ({ engine, station }) => {
      const w = window.woodrail;
      const f = w.sim.findCar(engine);
      if (!f) return null;
      let key = Infinity;
      for (const c of f.train.cars) if (c.kind === "engine") key = Math.min(key, c.id);
      const log = w.economy.history.trains.get(key);
      const paid = log?.visits().some((v) => v.depotId === station && v.lines.some((l) => l.drop && l.coins > 0));
      return paid ? { visits: log.ring.length } : null;
    },
    setup,
    1500,
  );
  check("train: it carries logs to the sawmill and planks to the town, which pays (the payoff, in its log)", !!ran, JSON.stringify(ran));
  // Its card by a tap, History on it.
  const opened = await h.tapThing({ engine: setup.engine }, () => window.woodrail.hud.engineCardOpen);
  check("train: a tap on the engine opens its card", opened);
  const btn = await box(p, ".engine-card:not([hidden]) .train-history");
  check("train: History on its card, 44 px", !!btn && btn.h >= 44 && btn.w >= 44, JSON.stringify(btn));
  await h.shot("1-card");
  await p.evaluate(() => (window.woodrail.paused = true));
  await h.tap(".engine-card:not([hidden]) .train-history");
  await p.waitForSelector(".history-sheet:not([hidden]) .history-visit", { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  const s = await h.sheet();
  const { forest, sawmill, station } = setup.names;
  const row = (stop) => s?.rows.find((r) => r.stop === stop);
  const pick = row(forest)?.lines.find((l) => /^Picked up \d+ 🪵 logs/.test(l.replace(/^[↑↓]/, "")));
  const logDrop = row(sawmill)?.lines.find((l) => l.includes("logs") && l.includes("Dropped"));
  const plankDrop = row(station)?.lines.find((l) => l.includes("planks") && l.includes("Dropped"));
  check("train: the sheet, its name and the summary with coins", !!s && s.title === "History" && s.sub.includes(await p.evaluate((e) => window.woodrail.sim.nameOf(e), setup.engine)) && /: .*dropped off · \+\d+🪙/.test(s.summary), JSON.stringify(s && { title: s.title, sub: s.sub, summary: s.summary }));
  check("train: newest first, a row a stop", !!s && s.rows.length >= 3 && s.rows[s.rows.length - 1].stop === forest, JSON.stringify(s?.rows.map((r) => r.stop)));
  check(`train: at the forest, the logs picked up meant for the sawmill ("→ ${sawmill}")`, !!pick && pick.includes(`→ ${sawmill}`), JSON.stringify(row(forest)));
  check("train: at the sawmill, the logs dropped from the forest, with how long they rode", !!logDrop && logDrop.includes(`from ${forest}`) && /· \d+ (s|min)/.test(logDrop), JSON.stringify(row(sawmill)));
  check("train: at the town, the planks dropped from the sawmill, with the coins the town paid", !!plankDrop && plankDrop.includes(`from ${sawmill}`) && /\+\d+🪙$/.test(plankDrop), JSON.stringify(row(station)));
  check("train: each stop's row 44 px tall (a tap target)", !!s && s.rows.every((r) => r.h >= 44), JSON.stringify(s?.rows.map((r) => r.h)));
  const x = await box(p, ".history-sheet:not([hidden]) .close");
  check("train: the sheet's ✕ 44 px", !!x && x.h >= 44 && x.w >= 44, JSON.stringify(x));
  const panel = await box(p, ".history-sheet:not([hidden]) .history-panel");
  check("train: the sheet fits the phone (no wider, at most 62% of its height: the map above it)", !!panel && panel.left >= 0 && panel.right <= 390 && panel.h <= 844 * 0.63, JSON.stringify(panel));
  await h.shot("2-sheet");
  const idle = await h.idle();
  check("train: 0 frames drawn while the sheet sits open, paused", idle === 0, `${idle} frames`);
  // A tap on the sawmill's row frames it (in the room above the sheet); the sheet stays.
  await h.tap(".history-sheet:not([hidden]) .history-stop", sawmill);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 20000 }).catch(() => {});
  await h.frames();
  const framed = await p.evaluate((d) => {
    const w = window.woodrail;
    const piece = w.layout.getPiece(w.economy.depot(d).pieceId);
    const q = piece.pose;
    const c = new w.camera.position.constructor(q.x + Math.cos(q.heading) * 108, piece.y, q.z + Math.sin(q.heading) * 108).project(w.camera);
    const x = ((c.x + 1) / 2) * innerWidth;
    const y = ((1 - c.y) / 2) * innerHeight;
    const sheet = document.querySelector(".history-sheet:not([hidden]) .history-panel")?.getBoundingClientRect();
    return { x: Math.round(x), y: Math.round(y), sheetTop: Math.round(sheet?.top ?? -1), open: !!sheet };
  }, setup.sawmill);
  check("train: a tap on the sawmill's row frames it on the map, above the sheet; the sheet stays", framed.open && framed.x > 0 && framed.x < 390 && framed.y > 0 && framed.y < framed.sheetTop, JSON.stringify(framed));
  await h.settle();
  await h.shot("3-framed");
  // Kept after a reload: the same rows.
  const rowsBefore = s.rows.map((r) => [r.stop, r.lines]);
  await h.reload();
  const back = await p.evaluate(({ engine }) => {
    const w = window.woodrail;
    const f = w.sim.findCar(engine);
    return !!f;
  }, setup);
  check("train: after a reload the train is there", back);
  await p.evaluate(() => (window.woodrail.paused = true));
  const reopened = await h.tapThing({ engine: setup.engine }, () => window.woodrail.hud.engineCardOpen);
  if (reopened) await h.tap(".engine-card:not([hidden]) .train-history");
  await p.evaluate(() => (window.woodrail.paused = true));
  await p.waitForSelector(".history-sheet:not([hidden]) .history-visit", { timeout: 20000 }).catch(() => {});
  const s2 = await h.sheet();
  const kept = !!s2 && rowsBefore.every(([stop, lines]) => s2.rows.some((r) => r.stop === stop && lines.every((l) => r.lines.includes(l))));
  check("train: after a reload, History shows the same pickups and drops", kept, JSON.stringify({ before: rowsBefore.slice(0, 4), after: s2?.rows.slice(0, 4).map((r) => [r.stop, r.lines]) }));
  await h.done("train");
});

// ---- A boat -----------------------------------------------------------------------------------------------------------
await group("boat", async () => {
  const h = await phone();
  const { p } = h;
  await h.open();
  // Setup (not what's tested): River barges learned; two landings on a straight run of the river's bank (as a drop puts
  // one: the game's own placement checks), logs on the first, a tug launched there, its route the two landings.
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    for (const r of ["routes", "cranes1", "barges"]) w.learn(r);
    const { siteWhy } = await import("/src/game/industries.ts");
    const { waterAt } = await import("/src/game/boats.ts");
    const { syncIndustries } = await import("/src/game/world.ts");
    const { CARGO } = await import("/src/economy/cargo.ts");
    const { routeStops } = await import("/src/game/route-stops.ts");
    const g = w.world.landscape.grid;
    const spots = [];
    for (let i = 0; i < g.cellCount; i++) {
      if (g.surface[i] !== 1) continue;
      const c = g.colOf(i);
      const r = g.rowOf(i);
      const at = (dc, dr) => g.surface[g.index(c + dc, r + dr)] ?? -1;
      let run = true;
      for (let k = -4; k <= 4; k++) if (at(k, 0) !== 1 || at(k, -1) === 1 || at(k, -2) === 1 || at(k, 2) === 1) run = false;
      if (!run) continue;
      const cx = g.centreX(c);
      const pose = { x: cx - 108, z: g.centreZ(r) - 100, heading: 0 };
      const y = g.groundY(g.cellAtWorld(cx, pose.z));
      if (siteWhy(w.world.landscape, "kit-landing", pose) !== null || w.interaction.placeWhy("kit-landing", pose, y, -1)) continue;
      spots.push({ pose, y, mid: { x: cx, z: pose.z } });
    }
    let best = null;
    const wet = (s) => waterAt(w.world.landscape, { x: s.mid.x, z: s.mid.z + 100 });
    for (const a of spots) for (const b of spots) if (wet(a) === wet(b) && Math.abs(a.pose.x - b.pose.x) > 500 && (!best || Math.abs(a.pose.x - b.pose.x) > Math.abs(best[0].pose.x - best[1].pose.x))) best = [a, b];
    if (!best) return { error: `no two landing spots on one water (${spots.length} spots)` };
    const ids = best.map((s) => w.layout.addPiece("kit-landing", s.pose, s.y));
    syncIndustries(w.world, true);
    w.depotView.setWorld(w.economy, w.layout);
    w.trackChanged?.();
    const [A, B] = ids.map((id) => w.economy.depotAtPiece(id).id);
    w.economy.depot(A).piles[CARGO.log.index] = 8;
    const boat = w.fleet.launch(A);
    if (!boat) return { error: "no boat launched" };
    w.fleet.addStop(boat.id, B);
    boat.going = true;
    w.invalidate();
    const names = routeStops(w.world);
    const name = (id) => names.find((st) => st.depotId === id)?.name;
    return { boat: boat.id, A, B, names: { A: name(A), B: name(B) } };
  });
  check("boat: setup, a tug on a route between two landings, logs on the first", !setup.error && !!setup.names.A && !!setup.names.B, JSON.stringify(setup));
  if (setup.error) return h.done("boat");
  const dropped = await h.playUntil(
    ({ boat, B }) => {
      const log = window.woodrail.economy.history.boats.get(boat);
      return log?.visits().some((v) => v.depotId === B && v.lines.some((l) => l.drop)) ? true : null;
    },
    setup,
    900,
  );
  check("boat: it sails and drops the logs at the second landing (the payoff, in its log)", !!dropped);
  const opened = await h.tapThing({ boat: setup.boat }, () => document.querySelector(".boat-card")?.hidden === false, 800);
  check("boat: a tap on the boat opens its card", opened);
  const btn = await box(p, ".boat-card:not([hidden]) .boat-history");
  check("boat: History on its card, 44 px", !!btn && btn.h >= 44, JSON.stringify(btn));
  await h.shot("4-boat-card");
  await p.evaluate(() => (window.woodrail.paused = true));
  await h.tap(".boat-card:not([hidden]) .boat-history");
  await p.waitForSelector(".history-sheet:not([hidden]) .history-visit", { timeout: 20000 }).catch(() => {});
  await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  const s = await h.sheet();
  const { A, B } = setup.names;
  const pick = s?.rows.find((r) => r.stop === A)?.lines.find((l) => l.includes("Picked up") && l.includes("logs"));
  const drop = s?.rows.find((r) => r.stop === B)?.lines.find((l) => l.includes("Dropped") && l.includes("logs"));
  check(`boat: the logs picked up at the first landing meant for the second ("→ ${B}")`, !!pick && pick.includes(`→ ${B}`), JSON.stringify(s?.rows));
  check("boat: dropped at the second landing from the first, with how long they rode", !!drop && drop.includes(`from ${A}`) && /· \d+ (s|min)/.test(drop), JSON.stringify(s?.rows));
  await h.shot("5-boat-sheet");
  const rowsBefore = s?.rows.map((r) => [r.stop, r.lines]) ?? [];
  await h.reload();
  await p.evaluate(() => (window.woodrail.paused = true));
  const boatId = await p.evaluate(() => [...window.woodrail.economy.boats.keys()][0]);
  const reopened = await h.tapThing({ boat: boatId }, () => document.querySelector(".boat-card")?.hidden === false, 800);
  if (reopened) await h.tap(".boat-card:not([hidden]) .boat-history");
  await p.evaluate(() => (window.woodrail.paused = true));
  await p.waitForSelector(".history-sheet:not([hidden]) .history-visit", { timeout: 20000 }).catch(() => {});
  const s2 = await h.sheet();
  const kept = !!s2 && rowsBefore.length > 0 && rowsBefore.every(([stop, lines]) => s2.rows.some((r) => r.stop === stop && lines.every((l) => r.lines.includes(l))));
  check("boat: after a reload, History shows the same pickups and drops", kept, JSON.stringify({ before: rowsBefore, after: s2?.rows.map((r) => [r.stop, r.lines]) }));
  await h.done("boat");
});

await b.close();
await server.close();
console.log(failures === 0 ? `${checks}/${checks} passed` : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
