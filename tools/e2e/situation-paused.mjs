// End-to-end: situation help, step 4 (docs/superpowers/specs/2026-11-18-situation-help.md, detector #5): "The game is
// paused", for a player who paused, forgot, and wonders why the trains stand still. Game mode on a 390×844 phone, by
// taps.
//
// Setup (named shortcuts, none of them what's tested): Routes learned; the tutorial's goals done and the clock past a
// game's first minutes; an oval laid by the editor with one hand-run goods train going round it. Then:
//   1. Paused by the bar's Pause, a tap on the train at once: its card, and no tip (they know they paused).
//   2. Ten seconds on, the card closed and the train tapped again: the toast ("The game is paused"), and the 💡 row
//      under the goals ("Trains stand still while it's paused. Tap the play button to run them."), stamped Tip, 44 px buttons.
//   3. Show where: the ▶ on the bar pulsed, the camera where it was; 0 frames drawn while it pulses.
//   4. ▶ tapped: the train runs on (the payoff: it moves), and the tip is gone from the row.
//   5. Paused again, a train tapped after the grace: no tip (once a session).
// Pictures: situation-paused-2-toast.jpg, -2-row.jpg, -3-pulse.jpg.
//
// Usage: npm run e2e:situation-paused [-- <out dir>]   (default out: e2e-out/situation-paused)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/situation-paused";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5447, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
testClockIn(b);
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
const shot = (n) => p.screenshot({ path: `${OUT}/situation-paused-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
  await frames();
};
const box = (sel) =>
  p.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { w: e.offsetWidth, h: e.offsetHeight, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, sel);
const tapSel = async (sel) => {
  const at = await box(sel);
  if (at) await tapped(() => p.touchscreen.tap(at.cx, at.cy));
  return !!at;
};
/** Wait (on wall time, `ms` at most) for the page's `fn(arg)` to hold. */
const until = (fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true, () => false);
const said = () => p.evaluate(() => [...window.__said]);
const paused = () => p.evaluate(() => window.woodrail.paused);
const tipShown = () => p.evaluate(() => document.querySelector(".goals [data-feature-tip]")?.dataset.featureTip ?? null);
const glide = async (v, dist) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y ?? 0, v.z), dist, { duration: 0.2, inRoom: true }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
/** Tap the (standing: paused) train's engine where the game's own pick finds it, till its card is open. */
const tapEngine = async (engine, dist = 900, quick = false) => {
  let tries;
  for (let k = 0; k < 4; k++) {
    const v = await p.evaluate((id) => {
      const t = window.woodrail.sim.findCar(id).train;
      const [a, c] = [t.world[0], t.world[1]];
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
    }, engine);
    // (Quick: tapped as soon as the view is on it, without waiting for it to settle: inside the seconds after Pause.)
    await glide(v, dist);
    if (!quick) await settle();
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
    // (Not found: nothing tapped, so no card to wait for. A quick one looks again next frame, as many as a dozen.)
    if (!at) {
      if (quick && k === 0 && (tries = (tries ?? 0) + 1) < 12) k--;
      await frames();
      continue;
    }
    await tapped(() => p.touchscreen.tap(at[0], at[1]));
    await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 10000 }).catch(() => {});
    if (await p.evaluate(() => window.woodrail.hud.engineCardOpen)) return true;
  }
  return false;
};
const closeCard = async () => {
  await tapSel(".engine-card:not([hidden]) .close");
  await until(() => !window.woodrail.hud.engineCardOpen, null, 10000);
};
const enginePos = (engine) => p.evaluate((id) => {
  const a = window.woodrail.sim.findCar(id).train.world[0];
  return { x: a.x, z: a.z };
}, engine);

// ---- Setup: a new game, an oval with one hand-run train (shortcuts: see the header) -------------------------------
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  w.learn("routes");
  const { GOALS } = await import("/src/game/goals.ts");
  // (The tutorial's goals marked done, by the tracker's own set: situation tips wait till the tutorial's over.)
  const tracker = w.goals();
  const open = GOALS.findIndex((g) => g.id === "build-bridge");
  for (const g of GOALS.slice(0, open)) tracker.done.add(g.id);
  w.simSeconds = Math.max(w.simSeconds, 150);
  const { Layout } = await import("/src/track/index.ts");
  const S = await import("/src/routing/scenarios.ts");
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
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
  const placed = w.editor().placeRun(ids.map((i) => {
    const q = scratch.getPiece(i);
    return { type: q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
  }));
  w.trackChanged?.();
  const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: placed[3], pathIndex: 0, s: 100, reversed: false });
  if (r.kind !== "placed") return null;
  const engine = w.sim.getTrain(r.trainId).cars[0].id;
  w.sim.setLever(engine, 1);
  // What the game says (each toast, as it's asked for).
  const h = w.hud;
  window.__said = [];
  const f = h.toast.bind(h);
  h.toast = (m, ...rest) => (m && window.__said.push(m), f(m, ...rest));
  w.invalidate();
  return { engine, pieces: placed.length };
});
check("setup: an oval with a hand-run train going round", !!setup && setup.pieces > 8, JSON.stringify(setup));
const engine = setup.engine;
// (Running a moment, from the start: the pause below is the player's.)
await until(() => !window.woodrail.paused, null, 5000);
if (await paused()) await p.evaluate(() => { window.woodrail.paused = false; window.woodrail.hud.setPaused(false); });
await p.waitForTimeout(1500);

// ---- 1. Paused by the player: a tap on the train at once says nothing --------------------------------------------
// (The train in view first, while it runs: the tap below comes straight after Pause.)
await glide(await enginePos(engine), 2000);
await tapSel('.actions button[aria-label^="Pause"]');
const pausedAt = await p.evaluate(() => performance.now());
check("1. the bar's Pause pauses the game, its button now ▶ (Resume)", (await paused()) && !!(await box('.actions button[aria-label^="Resume"]')));
check("1. a tap on the train: its card", await tapEngine(engine, 2000, true), `${Math.round((await p.evaluate(() => performance.now())) - pausedAt)} ms after Pause`);
await p.waitForTimeout(1500);
check("1. ... and no tip in the first seconds after the player paused", (await tipShown()) === null && !(await said()).some((t) => /paused/i.test(t)), JSON.stringify(await said()));
await closeCard();

// ---- 2. Ten seconds on: the train tapped, the tip --------------------------------------------------------------------
await until((t) => performance.now() - t > 11000, pausedAt, 30000);
check("2. the train tapped again, still paused: its card", (await paused()) && (await tapEngine(engine)));
const toasted = await until(() => window.__said.some((t) => /The game is paused/.test(t)), null, 10000);
check("2. the toast: The game is paused · Show where", toasted, JSON.stringify(await said()));
await shot("2-toast");
await closeCard();
await until(() => !document.querySelector(".toast.show"), null, 30000);
if (await p.evaluate(() => document.querySelector(".goals").classList.contains("collapsed"))) await tapSel(".goals-head");
await until(() => !document.querySelector(".goals").classList.contains("collapsed"), null, 10000);
const row = await p.evaluate(() => {
  const r = document.querySelector(".goals [data-feature-tip='paused']");
  if (!r) return null;
  const bs = [...r.querySelectorAll(".tip-buttons button")].map((x) => ({ t: x.textContent.trim(), h: x.offsetHeight }));
  return { stamp: r.querySelector(".tip-stamp")?.textContent ?? "", text: r.textContent, bs };
});
check("2. the 💡 row, stamped Tip: The game is paused, Tap ▶ to run them", !!row && row.stamp === "Tip" && /The game is paused/.test(row.text) && /Trains stand still while it's paused\. Tap the play button to run them\./.test(row.text), JSON.stringify(row));
check("2. ... Show where and Got it, 44 px", !!row && row.bs.map((x) => x.t).join(",") === "Show where,Got it" && row.bs.every((x) => x.h >= 44), JSON.stringify(row?.bs));
await shot("2-row");

// ---- 3. Show where: the ▶ pulsed, the camera where it was ------------------------------------------------------
const cam0 = await p.evaluate(() => window.woodrail.camera.position.toArray().map((v) => Math.round(v)));
await tapSel(".goals [data-feature-tip='paused'] .tip-where");
const pulse = await p.evaluate(() => {
  const b = document.querySelector('.actions button[aria-label^="Resume"]');
  return { on: !!b?.classList.contains("tip-pulse"), anim: b ? getComputedStyle(b).animationName : "" };
});
check("3. Show where: the ▶ on the bar pulsed", pulse.on && /tip-(pulse|ring)/.test(pulse.anim), JSON.stringify(pulse));
await shot("3-pulse");
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 2000));
  return w.framesDrawn - n0;
});
const cam1 = await p.evaluate(() => window.woodrail.camera.position.toArray().map((v) => Math.round(v)));
check("3. ... the camera where it was", JSON.stringify(cam0) === JSON.stringify(cam1), `${cam0} → ${cam1}`);
check("3. ... 0 frames drawn while it pulses, paused", idle === 0, `${idle}`);
await until(() => !document.querySelector(".tip-pulse"), null, 10000);

// ---- 4. ▶: the train runs on, the tip goes ----------------------------------------------------------------------
const at0 = await enginePos(engine);
await tapSel('.actions button[aria-label^="Resume"]');
check("4. ▶ tapped: the game runs", !(await paused()));
await p.waitForTimeout(3000);
const at1 = await enginePos(engine);
const moved = Math.hypot(at1.x - at0.x, at1.z - at0.z);
check("4. ... the train moves on (the payoff)", moved > 20, `${Math.round(moved)} mm`);
check("4. ... and the tip is gone from the row", await until(() => !document.querySelector(".goals [data-feature-tip='paused']"), null, 5000));

// ---- 5. Once a session -------------------------------------------------------------------------------------------------
await tapSel('.actions button[aria-label^="Pause"]');
const again = await p.evaluate(() => performance.now());
await until((t) => performance.now() - t > 11000, again, 30000);
const n0 = (await said()).filter((t) => /The game is paused/.test(t)).length;
await tapEngine(engine);
await p.waitForTimeout(2500);
const n1 = (await said()).filter((t) => /The game is paused/.test(t)).length;
check("5. paused again and a train tapped: no tip (once a session)", n1 === n0 && (await tipShown()) !== "paused", `${n0} → ${n1}`);

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "situation-paused: all passed" : `situation-paused: ${failures} failed`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
