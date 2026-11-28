// End-to-end Swap engine (spec docs/superpowers/specs/2026-11-23-swap-engine.md) in Game mode on a 390×844 phone, by
// taps (`npm run e2e:swap-engine [-- <out dir>]`):
//  1. A tank engine's train of two flatbeds running a line round an oval (forest, sawmill, workshop). A tap opens its
//     card: Engine in the tools row, 44 px, greyed while it runs ("Stop the train first").
//  2. Stop: Engine comes up. A tap opens the Swap engine sheet: a row per engine (44 px), the tank engine ✓ This one,
//     the goods engine "Pulls 8 · …", what isn't learned locked (the diesel). 0 frames drawn while it sits open, paused.
//  3. A tap on Goods engine: the sheet closes, the toast says so; the same engine (car id), its name, its line and its
//     next stop, its wagons and their loads kept; it pulls and runs as a goods engine (the sim's top speed), its model
//     built again as one.
//  4. Go: it runs on along its line and carries logs to the sawmill (the payoff).
//  5. Undo: a tank engine again, still on its line; Redo: the goods engine.
//  6. A reload keeps the goods engine, its name, on its line; no page errors.
// Pictures in the out dir (swap-engine-*.jpg; the card and sheet: docs/agents/shots/swap-engine-*.jpg). Starts its
// own dev server.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/swap-engine";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5427, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
testClockIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.E2E_PHONE_DPR ?? 2), hasTouch: true, isMobile: true });
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
let failures = 0;
let checks = 0;
const check = (what, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, ok ? "" : detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/swap-engine-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(350);
  await frames();
};
/** Tap the first visible element matching `selector` (its text starting with `text`, if given). */
const tap = async (selector, text) => {
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
  await tapped(() => p.touchscreen.tap(at.x, at.y));
  return true;
};
const glide = async (v, dist) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y ?? 0, v.z), dist, { duration: 0.2, inRoom: true }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
/** Tap a train's engine where the game's own pick finds it (as e2e:sandbox-chains' `tapEngine`), till its card is open. */
const tapEngine = async (engine, dist = 900) => {
  // (Paused while it's tapped: a moving train isn't where its picture was a moment ago. Unpaused after.)
  await p.evaluate(() => (window.woodrail.paused = true));
  try {
    return await tapEngineStill(engine, dist);
  } finally {
    await p.evaluate(() => (window.woodrail.paused = false));
  }
};
const tapEngineStill = async (engine, dist) => {
  for (let k = 0; k < 4; k++) {
    const v = await p.evaluate((id) => {
      const t = window.woodrail.sim.findCar(id).train;
      const [a, c] = [t.world[0], t.world[1]];
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
    }, engine);
    await glide(v, dist);
    await settle();
    const at = await p.evaluate((id) => {
      const w = window.woodrail;
      const o = w.trainView.carObject(id);
      if (!o) return null;
      const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
      const cx = ((v.x + 1) / 2) * innerWidth;
      const cy = ((1 - v.y) / 2) * innerHeight;
      const spots = [];
      for (let dx = -36; dx <= 36; dx += 6) for (let dy = -36; dy <= 36; dy += 6) spots.push([cx + dx, cy + dy]);
      spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      for (const [x, y] of spots) {
        if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1 || document.elementFromPoint(x, y) !== w.canvas) continue;
        const hit = w.interaction.pick(x, y, true);
        if (hit?.kind === "car" && hit.carId === id) return [x, y];
      }
      return null;
    }, engine);
    if (at) await tapped(() => p.touchscreen.tap(at[0], at[1]));
    await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 10000 }).catch(() => {});
    if (await p.evaluate(() => window.woodrail.hud.engineCardOpen)) return true;
  }
  return false;
};
const toastText = () => p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
/** The game's own sim and economy ticks (as Game.frame runs them, ahead of SwiftShader's few frames). */
const run = (seconds, forest, mill) =>
  p.evaluate(
    async ({ seconds, forest, mill }) => {
      const w = window.woodrail;
      const { CARGO } = await import("/src/economy/cargo.ts");
      const { PILE_CAP } = await import("/src/economy/constants.ts");
      const { SIM_HZ } = await import("/src/sim/index.ts");
      let toMill = 0;
      for (let i = 0; i < seconds * SIM_HZ; i++) {
        // (Harness shortcut: the forest kept stocked and the sawmill emptied, so the line always has loads to carry.)
        if (i % SIM_HZ === 0) {
          w.economy.depot(forest).piles[CARGO.log.index] = PILE_CAP;
          w.economy.depot(mill).piles.fill(0);
        }
        w.sim.tick();
        w.economy.tick();
        for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === mill) toMill++;
      }
      w.invalidate();
      return toMill;
    },
    { seconds, forest, mill },
  );

// ---- Setup: a new game, routes learned, an oval with a forest, a sawmill and a workshop laid by the editor, and two
// goods trains on it running one line (harness shortcuts, as e2e:routes-ux's: what's tested is taking a train off).
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
/** Save, reload the page and start the game again (its save opened as Continue). */
const reload = async () => {
  await p.evaluate(() => window.woodrail.saveNow?.());
  await p.waitForTimeout(2500);
  await p.reload();
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await start();
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
};
const start = () => p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await start();
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const id of ["switches", "routes", "tank", "goods-engine"]) w.learn(id);
  const { Layout } = await import("/src/track/index.ts");
  const S = await import("/src/routing/scenarios.ts");
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
  const L = await import("/src/game/lines.ts");
  const scratch = new Layout();
  const ids = S.oval(scratch).ids;
  const pts = ids.map((i) => [scratch.getPiece(i).pose.x, scratch.getPiece(i).pose.z]);
  const town = w.world.landscape.towns[0];
  const ok = (x, z) => {
    if (w.landscape.grid.cellAtWorld(x, z) === -1) return false;
    for (const i of w.layout.pieceIds()) {
      const q = w.layout.getPiece(i).pose;
      if (Math.hypot(q.x - x, q.z - z) <= 500) return false;
    }
    return [0, Math.PI / 2].some((h) => checkPlacement(w.landscape, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
  };
  let g = null;
  for (let d = 600; d < 9000 && !g; d += 54) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / 54));
    for (let a = 0; a < n && !g; a++) {
      const x = Math.round(town.centre.x + d * Math.cos((a * 2 * Math.PI) / n));
      const z = Math.round(town.centre.z + d * Math.sin((a * 2 * Math.PI) / n));
      if (pts.every(([dx, dz]) => ok(x + dx, z + dz))) g = { x, z };
    }
  }
  if (!g) return null;
  const types = { 0: "depot-forest", 7: "depot-sawmill", 9: "depot-workshop" };
  const placed = w.editor().placeRun(ids.map((i, k) => {
    const q = scratch.getPiece(i);
    return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
  }));
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const forest = depot(placed[0], "forest").id;
  const mill = depot(placed[7], "sawmill").id;
  const workshop = depot(placed[9], "workshop").id;
  w.depotView.setWorld(w.economy, w.layout);
  w.trackChanged?.();
  const line = L.createLine(w.economy, [
    { depotId: forest, action: "auto" },
    { depotId: mill, action: "auto" },
  ]);
  const engines = [placed[3]].map((pieceId) => {
    const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed: false });
    if (r.kind !== "placed") return -1;
    const e = w.sim.getTrain(r.trainId).cars[0].id;
    // (A tank engine: the kind the player swaps for a goods engine.)
    w.sim.setLook(e, "tank");
    L.joinLine(w.economy, e, line.id);
    w.sim.setLever(e, 1);
    return e;
  });
  w.invalidate();
  return { placed, forest, mill, workshop, engines, line: line.id, lineName: line.name };
});
check("setup: an oval with a forest, a sawmill and a workshop, a tank engine's train running a line", !!setup && setup.engines.every((e) => e !== -1), JSON.stringify(setup));
if (!setup) process.exit(1);
const [engine] = setup.engines;
await run(20, setup.forest, setup.mill);

const state = () =>
  p.evaluate((e) => {
    const w = window.woodrail;
    const f = w.sim.findCar(e);
    if (!f) return null;
    const t = f.train;
    return {
      look: w.sim.lookOf(e),
      name: w.sim.nameOf(e),
      line: w.economy.lineIdOf.get(e) ?? -1,
      next: w.economy.routeOf(e)?.next ?? -1,
      cars: t.cars.map((c) => c.id),
      loads: t.cars.map((c) => w.economy.cargoOf(c.id).count),
      lever: t.cars[f.index].lever,
      speed: Math.abs(t.speed),
      top: w.sim.topSpeed ? Math.round(w.sim.topSpeed(t)) : -1,
    };
  }, engine);
const box = (selector) =>
  p.evaluate((selector) => {
    const b = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { text: b.textContent.trim(), w: r.width, h: r.height, off: b.getAttribute("aria-disabled") === "true", title: b.title, right: r.right };
  }, selector);

// ---- 1. The card: Engine, greyed while it runs --------------------------------------------------------------------
check("1. a tap on the train opens its card", await tapEngine(engine));
await p.waitForTimeout(400);
const running = await box(".engine-card:not([hidden]) .swap-engine");
check("1. the card's tools row has Engine, 44 px, inside the screen", running?.text === "Engine" && running.h >= 43.5 && running.right <= 390, JSON.stringify(running));
check("1. …greyed while the train runs: Stop the train first", running?.off === true && running.title === "Stop the train first", JSON.stringify(running));
await shot("1-card-running");

// ---- 2. Stop, and the sheet -----------------------------------------------------------------------------------------
const before = await state();
await tap(".engine-card:not([hidden]) .chip.go");
await run(4, setup.forest, setup.mill);
await frames();
const stopped = await state();
check("2. Stop: it stands, still on its line", stopped?.lever === 0 && stopped.speed < 1e-6 && stopped.line === setup.line, JSON.stringify(stopped));
await p.waitForFunction(() => document.querySelector(".engine-card:not([hidden]) .swap-engine")?.getAttribute("aria-disabled") !== "true", null, { timeout: 10000 }).catch(() => {});
check("2. …Engine is no longer greyed", (await box(".engine-card:not([hidden]) .swap-engine"))?.off === false);
await shot("2-card-stopped");
await tap(".engine-card:not([hidden]) .swap-engine");
await p.waitForFunction(() => !!document.querySelector(".engine-sheet:not([hidden]) .engine-choice"), null, { timeout: 15000 }).catch(() => {});
const rows = await p.evaluate(() =>
  [...document.querySelectorAll(".engine-sheet:not([hidden]) .engine-choice")].map((b) => {
    const r = b.getBoundingClientRect();
    return { look: b.dataset.look, cls: b.className, text: b.textContent, h: r.height, w: r.width, off: b.getAttribute("aria-disabled") === "true" };
  }),
);
const row = (look) => rows.find((r) => r.look === look);
check("2. the sheet: a row per engine kind, each at least 44 px", rows.length === 7 && rows.every((r) => r.h >= 44 && r.w >= 44), JSON.stringify(rows.map((r) => [r.look, r.h])));
check("2. …the tank engine ticked: This one", row("tank")?.cls.includes("current") && row("tank").text.includes("This one") && row("tank").off, JSON.stringify(row("tank")));
check("2. …the goods engine with its numbers", row("goods")?.text.includes("Pulls 8") && !row("goods").off, JSON.stringify(row("goods")));
check("2. …the diesel locked: learn it first", row("diesel")?.cls.includes("locked") && row("diesel").text.includes("Learn Diesel first"), JSON.stringify(row("diesel")));
// (Its slide up finished: the picture is of the sheet as it sits.)
await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
await frames();
await shot("3-sheet");
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  w.paused = true;
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 2500));
  const n = w.framesDrawn - n0;
  w.paused = false;
  return n;
});
check("2. 0 frames drawn while the sheet sits open, paused", idle === 0, `${idle} frames`);

// ---- 3. The swap ----------------------------------------------------------------------------------------------------
await tap('.engine-sheet:not([hidden]) .engine-choice[data-look="goods"]');
await p.waitForFunction(() => document.querySelector(".engine-sheet")?.hidden !== false, null, { timeout: 10000 }).catch(() => {});
const said = await toastText();
const after = await state();
check("3. the sheet closes, the toast says what it is now", (await p.evaluate(() => document.querySelector(".engine-sheet").hidden)) && said.includes(`${before.name} is a goods engine now`), said);
check("3. a goods engine: the same car, its name, line and next stop, its wagons and loads kept", after?.look === "goods" && after.name === before.name && after.line === setup.line && after.next === stopped.next && JSON.stringify(after.cars) === JSON.stringify(stopped.cars) && JSON.stringify(after.loads) === JSON.stringify(stopped.loads), JSON.stringify({ stopped, after }));
const tops = await p.evaluate(async (e) => {
  const w = window.woodrail;
  const { ENGINES } = await import("/src/game/engines.ts");
  const t = w.sim.findCar(e).train;
  return { now: w.sim.topSpeed(t), goods: ENGINES.goods.speed, tank: ENGINES.tank.speed };
}, engine);
check("3. …it runs as a goods engine: its top speed the goods engine's, slower than the tank engine's", tops.now > 0 && Math.abs(tops.now / before.top - tops.goods / tops.tank) < 0.05, JSON.stringify({ tops, before: before.top }));
await frames();
await frames();
const card = await box(".engine-card:not([hidden]) .engine-summary");
check("3. the card is still open on it", !!card, JSON.stringify(card));
await shot("4-swapped");

// ---- 4. Go: it carries on along its line and delivers -------------------------------------------------------------
await tap(".engine-card:not([hidden]) .chip.go");
const going = await state();
check("4. Go: it sets off, on its line", going?.lever !== 0 && going.line === setup.line, JSON.stringify(going));
const delivered = await run(120, setup.forest, setup.mill);
check("4. it carries logs to the sawmill (the payoff)", delivered > 0, `${delivered} loads`);
check("4. …a goods engine still, on its line", (await state())?.look === "goods" && (await state()).line === setup.line);

// ---- 5. Undo and Redo -----------------------------------------------------------------------------------------------
await tap(".engine-card:not([hidden]) .close");
await tap('button[title^="Undo"]');
const undone = await state();
check("5. Undo: a tank engine again, still on its line", undone?.look === "tank" && undone.line === setup.line && undone.name === before.name, JSON.stringify(undone));
await tap('button[title^="Redo"]');
const redone = await state();
check("5. Redo: the goods engine", redone?.look === "goods" && redone.line === setup.line, JSON.stringify(redone));

// ---- 6. A reload, errors --------------------------------------------------------------------------------------------
await reload();
const back = await state();
check("6. after a reload: the goods engine, its name, on its line", back?.look === "goods" && back.name === before.name && back.line !== -1, JSON.stringify(back));
check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? `${checks}/${checks} passed` : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
