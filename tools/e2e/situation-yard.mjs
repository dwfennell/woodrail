// End-to-end: situation help, step 5 (docs/superpowers/specs/2026-11-18-situation-help.md, detector #9): a train too
// long for a yard, its tail on the points each time it's worked there, in Game mode on a 390×844 phone, by taps.
//
// Setup (named shortcuts, none of them what's tested): a flat map by its code; Routes and Sidings learned; the tutorial's
// goals done and the clock past a game's first minutes; laid by the editor, ⊐ forest ══ × 4 ══ points · sawmill ⊏ (the
// points' other road a stub), a timber train of three wagons on a line forest ↔ sawmill (the forest kept stocked, the
// mill emptied). Then, on the game's own clock (8×):
//   1. Worked at the sawmill twice with its tail on the points: the tip comes by itself ("too long for the sawmill").
//   2. The row: "Too long for the sawmill's yard", "Take a car off, or add a second track", 44 px buttons.
//   3. Show where: the train in view.
//   4. The fix, the player's way: its card's Stop, its last wagon's card and Decouple, that wagon's Remove, the
//      engine's Go.
//   5. The payoff: "✓ It fits the yard now", worked at the sawmill clear of the points, logs still delivered; done.
// Pictures: situation-yard-1-toast.jpg, -2-row.jpg, -3-show-where.jpg, -4-off.jpg, -5-fixed.jpg.
//
// Usage: npm run e2e:situation-yard [-- <out dir>]   (default out: e2e-out/situation-yard)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/situation-yard";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5449, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks and industries held still: this counts idle frames. Game time at 8× real time: the suite waits on trains.)
pinClocksIn(b);
stillIndustriesIn(b);
testClockIn(b, { speed: 8 });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
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
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/situation-yard-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapAt = (x, y) => tapped(() => p.touchscreen.tap(x, y));
const box = (sel) =>
  p.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: e.offsetWidth, h: e.offsetHeight, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, sel);
const tapSel = async (sel) => {
  const at = await box(sel);
  if (at) await tapAt(at.cx, at.cy);
  return !!at;
};
const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y ?? 0, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
const sim = () => p.evaluate(() => window.woodrail.simSeconds);
/** Wait (on wall time, `ms` at most) for the page's `fn(arg)` to hold. */
const until = (fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true, () => false);
const toastText = () => p.evaluate(() => document.querySelector(".toast.show")?.textContent ?? "");
const idleFrames = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    const n0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    return w.framesDrawn - n0;
  });
/** Paused or not, by the top bar's Pause button (not what's tested). */
const pause = async (on) => {
  if ((await p.evaluate(() => window.woodrail.paused)) !== on) await tapSel('.actions button[aria-label^="Pause"]');
  if ((await p.evaluate(() => window.woodrail.paused)) !== on) await p.keyboard.press("Space");
  await frames();
};

// A new game, on a flat map with no water (its code in the seed box): room for the long line.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-seed", { timeout: 30000 });
await p.evaluate(() => {
  const box = document.querySelector(".new-game-sheet:not([hidden]) .new-game-seed");
  box.value = "4242-flat-water-none-nocoast";
  box.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".new-game-sheet:not([hidden]) .new-game-start").click();
});
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

const glide = async (v, dist) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y ?? 0, v.z), dist, { duration: 0.2, inRoom: true }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
/**
 * Tap a car where the game's own pick finds it, till its card (`card`: "engine" or "car") is open. (Shortcut: paused by
 * the page while it's tapped, a moving train isn't where its picture was a moment ago; as it was after.)
 */
const tapCar = async (carId, card) => {
  const was = await p.evaluate(() => window.woodrail.paused);
  await p.evaluate(() => (window.woodrail.paused = true));
  try {
    for (let k = 0; k < 4; k++) {
      const v = await p.evaluate((id) => {
        const o = window.woodrail.trainView.carObject(id);
        const q = o.getWorldPosition(new window.woodrail.camera.position.constructor());
        return { x: q.x, y: q.y, z: q.z };
      }, carId);
      await glide(v, 900);
      await settle();
      const at = await p.evaluate((id) => {
        const w = window.woodrail;
        const o = w.trainView.carObject(id);
        if (!o) return null;
        const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
        const cx = ((v.x + 1) / 2) * innerWidth;
        const cy = ((1 - v.y) / 2) * innerHeight;
        const spots = [];
        for (let dx = -30; dx <= 30; dx += 5) for (let dy = -30; dy <= 30; dy += 5) spots.push([cx + dx, cy + dy]);
        spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
        for (const [x, y] of spots) {
          if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1 || document.elementFromPoint(x, y) !== w.canvas) continue;
          const hit = w.interaction.pick(x, y, true);
          if (hit?.kind === "car" && hit.carId === id) return [x, y];
        }
        return null;
      }, carId);
      if (!at) continue;
      await tapAt(at[0], at[1]);
      const open = await until((c) => (c === "engine" ? window.woodrail.hud.engineCardOpen : window.woodrail.hud.carCardOpen), card, 10000);
      if (open) return true;
    }
    return false;
  } finally {
    await p.evaluate((was) => (window.woodrail.paused = was), was);
  }
};
const trainsNow = () => p.evaluate(() => [...window.woodrail.sim.trains()].map((t) => ({ id: t.id, cars: t.cars.map((c) => c.id), speed: Math.abs(t.speed) })));

// ---- Setup (shortcuts: see the header) ---------------------------------------------------------------------------
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  w.paused = true;
  for (const id of ["switches", "routes", "sidings"]) w.learn(id);
  const { GOALS } = await import("/src/game/goals.ts");
  // (The tutorial's goals marked done, by the tracker's own set: situation tips wait till the tutorial's over.)
  const tracker = w.goals();
  const open = GOALS.findIndex((g) => g.id === "build-bridge");
  for (const g of GOALS.slice(0, open)) tracker.done.add(g.id);
  w.simSeconds = Math.max(w.simSeconds, 150);
  const { Layout, appendPiece, connectorRef } = await import("/src/track/index.ts");
  const { chain } = await import("/src/economy/loop-fixtures.ts");
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
  const { startLine } = await import("/src/game/lines.ts");
  // ⊐ forest ══ × 4 ══ points · sawmill ⊏, the points' other road a stub (src/routing/situation-reach.test.ts).
  const scratch = new Layout();
  const S = "straight-216";
  const [forest, ...wl] = chain(scratch, ["depot-forest", S, S, S, S]);
  appendPiece(scratch, "buffer-turnback", false, connectorRef(forest, 0));
  const sw = appendPiece(scratch, "switch", false, connectorRef(wl[3], 1), 0);
  const [mill] = chain(scratch, ["depot-sawmill"], connectorRef(sw, 1));
  appendPiece(scratch, "buffer-turnback", false, connectorRef(mill, 1));
  chain(scratch, [S], connectorRef(sw, 2));
  const ids = [...scratch.pieceIds()];
  const t = w.world.landscape.towns[0].centre;
  const ok = (x, z) => {
    if (w.landscape.grid.cellAtWorld(x, z) === -1) return false;
    for (const i of w.layout.pieceIds()) {
      const q = w.layout.getPiece(i).pose;
      if (Math.hypot(q.x - x, q.z - z) <= 400) return false;
    }
    return [0, Math.PI / 2].some((h) => checkPlacement(w.landscape, S, false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
  };
  let g = null;
  for (let d = 0; d < 16000 && !g; d += 108) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / 108));
    for (let k = 0; k < n && !g; k++) {
      const x = Math.round(t.x + d * Math.cos((k * 2 * Math.PI) / n));
      const z = Math.round(t.z + d * Math.sin((k * 2 * Math.PI) / n));
      if (ids.every((i) => { const q = scratch.getPiece(i).pose; return ok(x + q.x, z + q.z); })) g = { x, z };
    }
  }
  if (!g) return { error: "no ground for the line" };
  const placed = w.editor().placeRun(ids.map((i) => {
    const q = scratch.getPiece(i);
    return { type: q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
  }));
  const at = (i) => placed[ids.indexOf(i)];
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const A = depot(at(forest), "forest").id;
  const B = depot(at(mill), "sawmill").id;
  w.depotView?.setWorld?.(w.economy, w.layout);
  const r = w.sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: at(wl[1]), pathIndex: 0, s: 100, reversed: false });
  if (r.kind !== "placed") return { error: "no room for the train" };
  const engine = w.sim.getTrain(r.trainId).cars[0].id;
  w.sim.setLever(engine, 1);
  const line = startLine(w.economy, engine, [{ depotId: A, action: "auto" }, { depotId: B, action: "auto" }]);
  w.trackChanged?.();
  const { CARGO } = await import("/src/economy/cargo.ts");
  setInterval(() => {
    // (The forest kept stocked and the mill emptied, so the line always has a load: shortcut.)
    w.economy.depot(A).piles[CARGO.log.index] = Math.max(w.economy.depot(A).piles[CARGO.log.index], 12);
    w.economy.depot(B).piles.fill(0);
  }, 500);
  window.__loads = () => w.economy.loadsMoved;
  // Each time the train is worked at the sawmill: whether its tail was on the points.
  window.__visits = [];
  let was = false;
  setInterval(() => {
    const t = w.sim.findCar(engine)?.train;
    const d = t ? w.economy.standsOnPoints(t.id) : null;
    const worked = t ? w.economy.servicedCar(B) !== -1 && t.cars.some((c) => c.id === w.economy.servicedCar(B)) : false;
    if (worked && !was) window.__visits.push({ t: Math.round(w.simSeconds), onPoints: !!d });
    was = worked;
  }, 100);
  const h = w.hud;
  window.__said = [];
  const f = h.toast.bind(h);
  h.toast = (m, ...rest) => (m && window.__said.push(m), f(m, ...rest));
  w.invalidate();
  return { A, B, engine, line: line.name, pieces: placed.length };
});
check("setup: the line laid, its sawmill's yard shorter than the train, the train on a line forest ↔ sawmill", !setup.error && setup.pieces >= 9, JSON.stringify(setup));
await p.evaluate(() => {
  window.woodrail.paused = false;
  window.woodrail.hud.setPaused(false);
});

// ---- 1. The tip comes by itself ---------------------------------------------------------------------------------------
const said = () => p.evaluate(() => [...window.__said]);
let toasted = false;
for (let k = 0; k < 40 && !toasted; k++) {
  toasted = await until(() => window.__said.some((t) => /too long for (the )?sawmill( \d+)?/i.test(t)), null, 15000);
  if (!toasted) console.log("  waiting:", JSON.stringify(await p.evaluate(() => ({ t: Math.round(window.woodrail.simSeconds), visits: window.__visits, tip: window.woodrail.situations().current()?.id ?? null }))));
}
const visits1 = await p.evaluate(() => window.__visits);
check("1. worked at the sawmill with its tail on the points, twice", visits1.filter((v) => v.onPoints).length >= 2, JSON.stringify(visits1));
check("1. the tip by itself: a toast says it's too long for the sawmill", toasted, JSON.stringify((await said()).filter((t) => /long|yard/.test(t))));
await shot("1-toast");

// ---- 2. The row ---------------------------------------------------------------------------------------------------------
await until(() => !document.querySelector(".toast.show"), null, 60000);
if (await p.evaluate(() => document.querySelector(".goals").classList.contains("collapsed"))) await tapSel(".goals-head");
await until(() => !document.querySelector(".goals").classList.contains("collapsed"), null, 10000);
const row = await p.evaluate(() => {
  const r = document.querySelector(".situation-tip");
  return { title: r?.querySelector("b")?.textContent, text: r?.querySelector("p")?.textContent, bs: [...(r?.querySelectorAll(".tip-buttons button") ?? [])].map((x) => ({ t: x.textContent.trim(), h: x.offsetHeight })) };
});
check("2. the row: Too long for the sawmill's yard, its fix", /Too long for (the )?sawmill( \d+)?'s yard/i.test(row.title ?? "") && /tail on the points/.test(row.text ?? "") && /Take a car off, or add a second track\./.test(row.text ?? ""), JSON.stringify(row));
check("2. …Show where and Got it, 44 px", row.bs.map((x) => x.t).join(",") === "Show where,Got it" && row.bs.every((x) => x.h >= 44), JSON.stringify(row.bs));
await shot("2-row");

// ---- 3. Show where ----------------------------------------------------------------------------------------------------
await tapSel(".situation-tip .tip-where");
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
await settle();
const front = await p.evaluate((e) => { const q = window.woodrail.sim.findCar(e).train.world[0]; return { x: q.x, y: q.y, z: q.z }; }, setup.engine);
const [fx, fy] = await screenOf(front);
check("3. Show where: the train in view", fx > 0 && fx < 390 && fy > 0 && fy < 844, `${Math.round(fx)},${Math.round(fy)}`);
await shot("3-show-where");

// ---- 4. The fix, by taps: a wagon off -----------------------------------------------------------------------------------
/**
 * A card's button tapped till what it does holds (`done` in the page, with `arg`), the card opened again first when it
 * isn't: under a loaded box a tap can land as the card comes in and miss. Returns whether it held.
 */
const tapTill = async (carId, card, sel, done, arg, tries = 3) => {
  for (let k = 0; k < tries; k++) {
    const open = await p.evaluate((c) => (c === "engine" ? window.woodrail.hud.engineCardOpen : window.woodrail.hud.carCardOpen), card);
    if (!open && !(await tapCar(carId, card))) continue;
    await p.waitForTimeout(400);
    await tapSel(sel);
    if (await until(done, arg, 15000)) return true;
  }
  return false;
};
const card = (c) => `.${c}-card:not([hidden])`;
check("4. a tap on the engine: its card", await tapCar(setup.engine, "engine"));
const stood = await tapTill(setup.engine, "engine", `${card("engine")} .chip.go`, (e) => window.woodrail.sim.findCar(e).train.cars.find((c) => c.id === e).lever === 0, setup.engine);
const still = stood && (await until((e) => Math.abs(window.woodrail.sim.findCar(e).train.speed) < 1, setup.engine, 120000));
check("4. its card's Stop: the train stands", still);
await tapSel(`${card("engine")} .close`);
const before = (await trainsNow()).find((t) => t.cars.includes(setup.engine));
const last = before.cars[0] === setup.engine ? before.cars[before.cars.length - 1] : before.cars[0];
check("4. a tap on its last wagon: the wagon's card", await tapCar(last, "car"));
const parted = await tapTill(last, "car", `${card("car")} .decouple`, ([e, c]) => window.woodrail.sim.findCar(c)?.train.cars.length === 1 && window.woodrail.sim.findCar(e).train.cars.length === 3, [setup.engine, last]);
check("4. Decouple: the wagon left on its own, the train an engine and two", parted, JSON.stringify(await trainsNow()));
let gone = false;
// (Only the wagon alone: its card's Remove puts its whole train back in the box.)
if (parted) {
  await tapSel(`${card("car")} .close`);
  await p.evaluate(() => (window.__markRemove = () => [...document.querySelectorAll(".car-card:not([hidden]) .card-row button")].find((x) => x.textContent.trim() === "Remove")?.setAttribute("data-e2e", "remove")));
  for (let k = 0; k < 3 && !gone; k++) {
    if (!(await p.evaluate(() => window.woodrail.hud.carCardOpen)) && !(await tapCar(last, "car"))) continue;
    await p.waitForTimeout(400);
    await p.evaluate(() => window.__markRemove());
    await tapSel(`${card("car")} [data-e2e="remove"]`);
    gone = await until((c) => !window.woodrail.sim.findCar(c), last, 15000);
  }
}
check("4. the wagon's Remove: put back in the box, the train kept", gone && (await p.evaluate((e) => !!window.woodrail.sim.findCar(e), setup.engine)), JSON.stringify(await trainsNow()));
await shot("4-off");
await tapSel(`${card("car")} .close`);
const going = gone && (await tapTill(setup.engine, "engine", `${card("engine")} .chip.go`, (e) => window.woodrail.sim.findCar(e).train.cars.find((c) => c.id === e).lever !== 0, setup.engine));
check("4. Go, on its card: it runs its line again", going);
await tapSel(`${card("engine")} .close`);

// ---- 5. The payoff ----------------------------------------------------------------------------------------------------
const loads0 = await p.evaluate(() => window.__loads());
const n0 = await p.evaluate(() => window.__visits.length);
// (The fix not made: nothing to wait for; failed above, said here quickly.)
const fixed = going && (await until(() => window.__said.some((t) => /It fits the yard now/.test(t)), null, 120000));
check("5. the tip goes with \"✓ It fits the yard now\"", fixed, JSON.stringify((await said()).slice(-4)));
await shot("5-fixed");
if (going) await until((n) => window.__visits.length >= n + 2, n0, 240000);
const after = await p.evaluate((n) => ({ loads: window.__loads(), visits: window.__visits.slice(n) }), n0);
check("5. worked at the sawmill clear of the points, logs still delivered", after.visits.length >= 2 && after.visits.every((v) => !v.onPoints) && after.loads > loads0, JSON.stringify({ loads0, ...after }));
const done = await p.evaluate(() => ({ done: window.woodrail.situations().isDone("too-long"), row: !!document.querySelector(".situation-tip") }));
check("5. done for this game, the row gone", done.done && !done.row, JSON.stringify(done));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
