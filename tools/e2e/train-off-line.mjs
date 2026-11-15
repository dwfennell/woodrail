// End-to-end Leave line (a train taken off its line) in Game mode on a 390×844 phone, by taps (`npm run e2e:train-off-line [-- <out dir>]`):
//  1. Two goods trains running one line round an oval (forest, sawmill, workshop). A tap on the first opens its card:
//     the line's box has Leave line beside Edit, 44 px.
//  2. Leave line: the train is off the line and hand-run, its toast says so (and Undo); it stands where it is, not
//     on points; the line is kept, its other train still on it and still running. The card now offers Run a line….
//  3. Undo puts it back on the line; Redo takes it off again.
//  4. The line sheet's Trains tab (☰ Lines, the line): Take off for the second train; the Lines list says No trains.
//  5. The first train put back on the line from its card (Run a line…, the line), Go: it carries logs to the sawmill
//     again (the payoff).
//  6. 0 frames drawn idle with the card open, paused; a reload keeps the line and which train runs it; no page errors.
// Pictures in the out dir (off-line-*.jpg). Starts its own dev server.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/train-off-line";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5411, strictPort: false }, logLevel: "error" });
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
const shot = (n) => p.screenshot({ path: `${OUT}/off-line-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
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
const trainState = (engine) =>
  p.evaluate(async (engine) => {
    const w = window.woodrail;
    const { getPieceDef } = await import("/src/track/index.ts");
    const f = w.sim.findCar(engine);
    if (!f) return null;
    const onPoints = [...w.sim.piecesUnder(f.train.id)].some((id) => {
      const q = w.layout.getPiece(id);
      const d = q && getPieceDef(q.type, q.flipped);
      return !!d?.isSwitch && !d.gated && !d.signal;
    });
    const at = f.train.world[0];
    return { line: w.economy.lineIdOf.get(engine) ?? -1, routed: !!w.economy.routeOf(engine), lever: f.train.cars[f.index].lever, speed: Math.abs(f.train.speed), onPoints, x: at.x, z: at.z };
  }, engine);

// ---- Setup: a new game, routes learned, an oval with a forest, a sawmill and a workshop laid by the editor, and two
// goods trains on it running one line (harness shortcuts, as e2e:routes-ux's: what's tested is taking a train off).
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
const start = () => p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await start();
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const id of ["switches", "routes"]) w.learn(id);
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
  const engines = [placed[3], placed[11]].map((pieceId) => {
    const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed: false });
    if (r.kind !== "placed") return -1;
    const e = w.sim.getTrain(r.trainId).cars[0].id;
    L.joinLine(w.economy, e, line.id);
    w.sim.setLever(e, 1);
    return e;
  });
  w.invalidate();
  return { placed, forest, mill, workshop, engines, line: line.id, lineName: line.name };
});
check("setup: an oval with a forest, a sawmill and a workshop, two trains running one line", !!setup && setup.engines.every((e) => e !== -1), JSON.stringify(setup));
if (!setup) process.exit(1);
const [first, second] = setup.engines;
await run(20, setup.forest, setup.mill);

// ---- 1. The card's line box: Leave line beside Edit ------------------------------------------------------------
check("1. a tap on the first train opens its card", await tapEngine(first));
await p.waitForFunction(() => !!document.querySelector(".engine-card:not([hidden]) .route-off"), null, { timeout: 15000 }).catch(() => {});
const box = await p.evaluate(() => {
  const b = document.querySelector(".engine-card:not([hidden]) .route-off");
  const edit = document.querySelector(".engine-card:not([hidden]) .route-head .route-plan");
  if (!b || !edit) return null;
  const card = document.querySelector(".engine-card:not([hidden])").getBoundingClientRect();
  const r = b.getBoundingClientRect();
  const e = edit.getBoundingClientRect();
  return { text: b.textContent.trim(), w: r.width, h: r.height, sameRow: Math.abs(r.top + r.height / 2 - (e.top + e.height / 2)) < 4, inCard: r.left >= card.left && e.right <= card.right + 0.5, line: document.querySelector(".engine-card:not([hidden]) .route-line-text")?.textContent, cut: (() => { const t = document.querySelector(".engine-card:not([hidden]) .route-line-text"); return !t || t.scrollWidth > t.clientWidth + 0.5; })(), editH: e.height, oneRow: (() => { const n = document.querySelector(".engine-card:not([hidden]) .route-line-name").getBoundingClientRect(); return Math.abs(n.top + n.height / 2 - (r.top + r.height / 2)) < 4; })() };
});
check("1. the line's box has Leave line, beside Edit, 44 px, inside the card, on one row with the line's whole name", box?.text === "Leave line" && box.w >= 43.5 && box.h >= 43.5 && box.sameRow && box.inCard && box.line === setup.lineName && !box.cut && box.oneRow, JSON.stringify(box));
await shot("1-card-on-line");

// ---- 2. Leave line ----------------------------------------------------------------------------------------------
const secondBefore = await trainState(second);
await tap(".engine-card:not([hidden]) .route-off");
// (Toasts take turns: setup's may still be showing.)
await p.waitForFunction((name) => [...document.querySelectorAll(".toast")].some((t) => t.textContent.includes(`off ${name}`)), setup.lineName, { timeout: 20000 }).catch(() => {});
const said = await toastText();
const justOff = await trainState(first);
check("2. Leave line: off the line, hand-run", justOff?.line === -1 && !justOff.routed, JSON.stringify(justOff));
check("2. …the toast says so, and how to put it back", said.includes(`off ${setup.lineName}`) && said.includes("Undo"), said);
await run(6, setup.forest, setup.mill);
const stood = await trainState(first);
const secondAfter = await trainState(second);
check("2. …it stands where it is (its lever off, still), not on points", stood?.lever === 0 && stood.speed < 1e-6 && !stood.onPoints, JSON.stringify(stood));
check("2. the line is kept, its other train still on it and running", (await p.evaluate((id) => window.woodrail.economy.lines.has(id), setup.line)) && secondAfter?.line === setup.line && Math.hypot(secondAfter.x - secondBefore.x, secondAfter.z - secondBefore.z) > 50, JSON.stringify({ secondBefore, secondAfter }));
await p.waitForTimeout(500);
await frames();
const offCard = await p.evaluate(() => ({ off: !!document.querySelector(".engine-card:not([hidden]) .route-off"), run: document.querySelector(".engine-card:not([hidden]) .route-join-open")?.textContent ?? "", label: document.querySelector(".engine-card:not([hidden]) .route-head .engine-extra-label")?.textContent ?? "" }));
check("2. the card now shows a train with no line: Run a line… offered, no Leave line", !offCard.off && offCard.run.startsWith("Run a line"), JSON.stringify(offCard));
await shot("2-card-off-line");

// ---- 3. Undo and Redo --------------------------------------------------------------------------------------------
await tap('button[title^="Undo"]');
const undone = await trainState(first);
check("3. Undo: back on the line, on its way", undone?.line === setup.line && undone.routed && undone.lever !== 0, JSON.stringify(undone));
await tap('button[title^="Redo"]');
await run(6, setup.forest, setup.mill);
const redone = await trainState(first);
check("3. Redo: off it again, standing, not on points", redone?.line === -1 && redone.lever === 0 && !redone.onPoints, JSON.stringify(redone));

// ---- 4. The line sheet's Take off --------------------------------------------------------------------------------
await tap(".engine-card:not([hidden]) .close");
await tap('button[aria-label="Menu"]');
await tap(".menu button", "Lines");
await tap(".lines-row");
await tap(".ls-tab", "Trains");
check("4. the line's Trains tab lists its other train with Take off", await p.evaluate((e) => !!document.querySelector(`.ls-train[data-engine='${e}'] .ls-train-off`), second));
await shot("3-sheet-trains");
await tap(`.ls-train[data-engine='${second}'] .ls-train-off`);
const secondOff = await trainState(second);
check("4. Take off in the sheet: that train off the line, hand-run (the same as the card's)", secondOff?.line === -1 && !secondOff.routed, JSON.stringify(secondOff));
await run(6, setup.forest, setup.mill);
const secondStood = await trainState(second);
check("4. …and it stands, not on points", secondStood?.lever === 0 && secondStood.speed < 1e-6 && !secondStood.onPoints, JSON.stringify(secondStood));
await tap(".ls-done");
await p.waitForFunction(() => { const v = document.querySelector(".lines-view"); return v && !v.hidden; }, null, { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(600);
const pills = await p.evaluate(() => [...document.querySelectorAll(".lines-row")].map((r) => r.querySelector(".lines-pill")?.textContent));
check("4. the Lines list keeps the line, saying No trains", pills.length === 1 && pills[0] === "No trains", JSON.stringify(pills));
await shot("4-lines-no-trains");
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".lines-view:not([hidden]) .lines-close, .lines-view:not([hidden]) .close")?.click());
await p.waitForTimeout(400);

// ---- 5. Back on the line from the card, and it delivers ----------------------------------------------------------
check("5. the first train's card opens again", await tapEngine(first));
await tap(".engine-card:not([hidden]) .route-join-open");
await tap(".engine-card:not([hidden]) .route-join-line", setup.lineName);
const rejoined = await trainState(first);
check("5. Run a line…, the line: the train runs it again", rejoined?.line === setup.line && rejoined.routed, JSON.stringify(rejoined));
if (rejoined?.lever === 0) await tap(".engine-card:not([hidden]) .chip.go");
const going = await trainState(first);
check("5. …Go: it sets off", going?.lever !== 0, JSON.stringify(going));
const delivered = await run(120, setup.forest, setup.mill);
check("5. it carries logs to the sawmill again (the payoff)", delivered > 0, `${delivered} loads`);
await shot("5-card-back-on-line");

// ---- 6. Idle, a reload, errors -----------------------------------------------------------------------------------
const idle = await p.evaluate(async (e) => {
  const w = window.woodrail;
  w.paused = true;
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 2500));
  const n = w.framesDrawn - n0;
  w.paused = false;
  return { n, open: w.hud.engineCardOpen };
}, first);
check("6. 0 frames drawn idle with the card open, paused", idle.n === 0, JSON.stringify(idle));
await p.evaluate(() => window.woodrail.saveNow?.());
await p.waitForTimeout(2500);
await p.reload();
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await start();
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
const back = await p.evaluate(() => {
  const w = window.woodrail;
  const engines = w.sim.trainIds().map((id) => w.sim.getTrain(id).cars[0].id);
  return { lines: [...w.economy.lines.values()].map((l) => l.name), onLine: engines.filter((e) => w.economy.lineIdOf.has(e)).length, handRun: engines.filter((e) => !w.economy.lineIdOf.has(e)).length };
});
check("6. after a reload: the line, one train on it, the other hand-run", back.lines.length === 1 && back.lines[0] === setup.lineName && back.onLine === 1 && back.handRun >= 1, JSON.stringify(back));
check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? `${checks}/${checks} passed` : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
