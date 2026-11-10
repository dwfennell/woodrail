// The e2e suites' shared helpers: boot, report, waits in game time that throw with a reason, taps that throw on a miss,
// and world-to-screen. docs/agents/e2e.md, "The shared helpers"; audit docs/agents/audit-2026-11-09.md, item 1.
//
//   import { boot, reporter, frames, settled, until, tap } from "../../scripts/e2e/lib/e2e.mjs";
//   const { page: p, errors, close } = await boot({ name: "airport", pinClocks: true, stillIndustries: true });
//   const { check, finish } = reporter("airport", { errors, close });
//   await openGame(p);
//   await tap(p, { depot: 12 });                       // throws if the game's own hit test finds it nowhere
//   await tap(p, ".engine-extra .route-plan");          // throws if it isn't there, won't stand still, or is covered
//   await until(p, () => window.woodrail.hud.engineCardOpen, null, { why: "the engine's card open" });
//   await finish();                                     // "no page errors", "N/N passed", closes, exits
//
// Every wait here throws with what it waited for and what it saw, rather than going on after a fixed wall time. The
// one non-throwing form of each is named for it (`tryTap`, `tryUntil`), for a step that has its own fall-back.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { pinClocksIn, stillIndustriesIn } from "../pin-clocks.mjs";
import { aimAt } from "./aim.mjs";
import { testClockIn } from "./fast.mjs";
import { still } from "./still.mjs";

export { aimAt } from "./aim.mjs";
export { quiet, shot } from "./shot.mjs";
export { still } from "./still.mjs";

export const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
/** Headless Chromium drawing WebGL by SwiftShader, as every suite runs it. */
export const SWIFTSHADER = ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
/** A 390×844 phone with touch. */
export const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

// ---------------------------------------------------------------------------------------------------------------- boot

/**
 * The dev server, a browser and a page, the way the suites run the game.
 *
 *   name           the suite's name: its out dir is `e2e-out/<name>` unless argv[2] gives one (`out`)
 *   port           the dev server's first port to try (any free one after it)
 *   context        options for the browser context (default: the phone, `PHONE`); `dpr` its device scale (default 2)
 *   clock          the game's test clock (lib/fast.mjs `testClockIn`), on by default: `false`, or its options
 *   pinClocks      the station clocks held still (for idle-frame counts); `stillIndustries`: industries' motions too
 *   init           more init scripts for the context (functions, or [fn, arg]), before the page loads
 *
 * Every page: the help seen, `window.__allClicks` counting clicks (a tap's click is how `tap` knows it landed), and
 * page errors and console errors gathered in `errors`. `close()` closes the browser and the server.
 */
export async function boot({ name, port = 5390, context = PHONE, dpr = 2, clock = true, pinClocks = false, stillIndustries = false, init = [] } = {}) {
  const out = process.argv[2] ?? `e2e-out/${name}`;
  mkdirSync(out, { recursive: true });
  const { createServer } = await import("vite");
  const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port, strictPort: false }, logLevel: "error" });
  await server.listen();
  await server.warmupRequest("/src/main.ts");
  const url = server.resolvedUrls.local[0];
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: SWIFTSHADER });
  if (clock) testClockIn(browser, clock === true ? {} : clock);
  if (pinClocks) pinClocksIn(browser);
  if (stillIndustries) stillIndustriesIn(browser);
  const ctx = await browser.newContext({ deviceScaleFactor: dpr, ...context });
  await ctx.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    window.__allClicks = 0;
    window.addEventListener("click", () => window.__allClicks++, { capture: true });
  });
  for (const s of init) await (Array.isArray(s) ? ctx.addInitScript(...s) : ctx.addInitScript(s));
  const page = await ctx.newPage();
  const errors = [];
  watchErrors(page, errors);
  let cdp = null;
  return {
    server,
    browser,
    ctx,
    page,
    url,
    out,
    errors,
    /** The page's CDP session (one, made on first ask): for stamped touch events. */
    cdp: async () => (cdp ??= await ctx.newCDPSession(page)),
    close: async () => {
      await browser.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}

/** Page errors and console errors from `page` into `errors`. */
export function watchErrors(page, errors) {
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
}

/**
 * Into a mode from the title, as a player: Game's (or Sandbox's) primary button, a new game or Continue; the new-game
 * sheet's Hilly and Start if it opens (the land the suites were written on). Resolves once in play, loaded and settled,
 * with the help closed and the coach skipped. `moving`: as `settled`'s, for a page that keeps drawing by design.
 */
export async function openMode(page, mode = "game", { moving } = {}) {
  await until(page, () => window.woodrail?.title?.shown, null, { timeout: 240_000, why: "the title shown" });
  await page.evaluate((mode) => {
    const primary = [...document.querySelectorAll(`.title-card.mode-${mode} button`)].find((x) => !x.hidden && x.classList.contains("primary"));
    if (!primary) throw new Error(`no primary button on the ${mode} title card`);
    primary.click();
    document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click();
    document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click();
  }, mode);
  await until(page, (mode) => window.woodrail?.mode?.() === mode && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), mode, { timeout: 180_000, why: `in ${mode} mode, loaded` });
  // (A fresh page still draws its tray pictures, a few a frame, and under SwiftShader a frame then takes seconds: the
  // first still moment can be a minute or more away. Bounded as lib/shot.mjs `quiet` is.)
  await settled(page, { cap: 120_000, moving });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
}

// -------------------------------------------------------------------------------------------------------------- report

/**
 * A suite's checks: `check(what, ok, detail)` prints PASS or FAIL; `finish()` adds "no page errors", prints
 * "N/N passed" (the gate's line), closes and exits 0 only if all passed. A suite that throws prints the FAIL and what
 * threw, closes and exits 1.
 */
export function reporter(name, { errors = [], close = async () => {} } = {}) {
  let passes = 0;
  let failures = 0;
  const check = (what, ok, detail = "") => {
    if (ok) passes++;
    else failures++;
    console.log(ok ? "PASS" : "FAIL", what, detail);
    return !!ok;
  };
  const end = async (code) => {
    await close();
    process.exit(code);
  };
  const threw = async (e) => {
    failures++;
    console.log(`FAIL (${name} threw) ${e?.stack ?? e}`);
    if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(" | ")}`);
    console.log(`\n${passes}/${passes + failures} passed`);
    await end(1);
  };
  process.on("unhandledRejection", threw);
  process.on("uncaughtException", threw);
  const finish = async () => {
    check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
    console.log(`\n${passes}/${passes + failures} passed`);
    await end(failures === 0 ? 0 : 1);
  };
  return {
    check,
    finish,
    get failures() {
      return failures;
    },
    get passes() {
      return passes;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------- wait

/** `n` animation frames of the page (two by default: one drawn and the next begun). Throws if none comes in `timeout` ms. */
export function frames(page, n = 2, { timeout = 60_000 } = {}) {
  return page.evaluate(
    ([n, timeout]) =>
      new Promise((done, fail) => {
        const t = setTimeout(() => fail(new Error(`frames: ${n} frames not drawn in ${timeout / 1000} s`)), timeout);
        let k = 0;
        const step = () => (++k >= n ? (clearTimeout(t), done()) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    [n, timeout],
  );
}

/** What in the page may be moving: trains, the camera, a drag, frames drawn lately (for a wait's reason). */
function moving(page) {
  return page
    .evaluate(() => {
      const w = window.woodrail;
      if (!w) return { game: "not loaded" };
      let trains = 0;
      for (const id of w.sim.trainIds()) if (Math.abs(w.sim.getTrain(id)?.speed ?? 0) > 0.5) trains++;
      return { trains, glide: !!w.director?.busy, mode: w.interaction?.mode?.kind ?? null, paused: !!w.paused, framesDrawn: w.framesDrawn, simSeconds: Math.round(w.simSeconds * 10) / 10 };
    })
    .catch((e) => ({ error: e.message.split("\n")[0] }));
}

/**
 * The scene still for `ticks` ticks (`woodrail.settled`), at most `cap` ms. Past the cap: a train running is a reason
 * for frames (it resolves false); anything else throws with what was moving. `trains: false` throws then too.
 * `moving: "<why>"`: something the suite knows keeps drawing (an ambient motion it tests, left running): past the cap
 * it says so and resolves false.
 */
export async function settled(page, { ticks = 3, cap = 20_000, trains = true, moving: known } = {}) {
  const f0 = await page.evaluate(() => window.woodrail.framesDrawn);
  const done = await page.evaluate(([ticks, cap]) => Promise.race([window.woodrail.settled(ticks).then(() => true), new Promise((r) => setTimeout(() => r(false), cap))]), [ticks, cap]);
  if (done) return true;
  const m = await moving(page);
  if (trains && m.trains > 0) return false;
  if (known) {
    console.log(`(not still after ${cap / 1000} s, ${m.framesDrawn - f0} frames: ${known})`);
    return false;
  }
  throw new Error(`settled: not still after ${cap / 1000} s (${m.framesDrawn - f0} frames drawn meanwhile): ${JSON.stringify(m)}`);
}

/** Game time on by `seconds` (`woodrail.simSeconds`). Throws if it hasn't in max(120, 4 × seconds) s of wall time. */
export async function waitGame(page, seconds, { cap = Math.max(120, seconds * 4) * 1000 } = {}) {
  const t0 = await page.evaluate(() => window.woodrail.simSeconds);
  const ok = await page.waitForFunction(([t0, s]) => window.woodrail.simSeconds - t0 >= s, [t0, seconds], { timeout: cap, polling: 100 }).then(() => true, () => false);
  if (!ok) throw new Error(`waitGame: ${seconds} s of game time not passed in ${cap / 1000} s: ${JSON.stringify(await moving(page))}`);
}

/**
 * `fn(arg)` true in the page. Bounded by `timeout` ms of wall time, or with `game` by that many seconds of game time
 * (and a wall bound of max(120, 4 × game) s, as e2e:water's playUntil had). Throws with `why` and what was moving; `tryUntil` returns false instead.
 * Resolves to `fn`'s value.
 */
export async function until(page, fn, arg, opts = {}) {
  const r = await tryUntil(page, fn, arg, opts);
  if (r === false) throw new Error(`until: ${opts.why ?? fn.toString().slice(0, 160)}: not so after ${opts.game ? `${opts.game} s of game time` : `${(opts.timeout ?? 30_000) / 1000} s`}: ${JSON.stringify(await moving(page))}`);
  return r;
}

/** `until` that resolves to false instead of throwing: for a step with its own fall-back. */
export async function tryUntil(page, fn, arg, { timeout = 30_000, game, polling = 100 } = {}) {
  if (!game) {
    const h = await page.waitForFunction(fn, arg, { timeout, polling }).catch((e) => (/Timeout/i.test(e.message) ? null : Promise.reject(e)));
    return h ? await h.jsonValue().catch(() => true) : false;
  }
  const t0 = await page.evaluate(() => window.woodrail.simSeconds);
  const wall = Date.now() + Math.max(120, game * 4) * 1000;
  for (;;) {
    const r = await page.evaluate(fn, arg);
    if (r) return r;
    const t = await page.evaluate(() => window.woodrail.simSeconds);
    if (t - t0 > game || Date.now() > wall) return false;
    await page.waitForTimeout(polling < 250 ? 250 : polling);
  }
}

// ------------------------------------------------------------------------------------------------------ world, screen

/** A world point's place on the page (CSS px). */
export function screenOf(page, v) {
  return page.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y ?? 0, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
}

/**
 * The world point of a target: `{ at }` itself; `{ depot, along?, across? }` a point on its piece (`along` it, 108 by
 * default, `across` to its left); `{ engine }` between its first two bogies.
 */
export function worldOf(page, what) {
  return page.evaluate((what) => {
    const w = window.woodrail;
    if (what.at) return { y: 0, ...what.at };
    if (what.engine !== undefined) {
      const t = w.sim.findCar(what.engine).train;
      const i = t.cars.findIndex((c) => c.id === what.engine);
      const [a, c] = [t.world[2 * i], t.world[2 * i + 1]];
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
    }
    const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
    const q = piece.pose;
    const along = what.along ?? 108;
    const across = what.across ?? 0;
    return { x: q.x + Math.cos(q.heading) * along - Math.sin(q.heading) * across, y: piece.y, z: q.z + Math.sin(q.heading) * along + Math.cos(q.heading) * across };
  }, what);
}

/** The camera glided onto world point `v`, `dist` away (more `opts` to `director.glideTo`), and stopped there. */
export async function glideTo(page, v, dist = 1300, opts = {}) {
  await page.evaluate(([v, dist, opts]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y ?? 0, v.z), dist, { duration: 0.2, ...opts }), [v, dist, opts]);
  await until(page, () => !window.woodrail.director.busy, null, { why: "the camera's glide over" });
  await frames(page);
}

/** The camera on a target (as `worldOf` takes), `dist` away. */
export async function showing(page, what, dist = 1300, opts = {}) {
  await glideTo(page, await worldOf(page, what), dist, opts);
}

// ----------------------------------------------------------------------------------------------------------------- act

/**
 * A tap that lands, or throws saying why not. `target`:
 *   "selector" or { sel, text }      the first drawn element matching (its text including `text`; `exact` or `starts`
 *                                    for its trimmed text equal to it or starting with it): scrolled into view
 *                                    as a finger would, waited for till it stands still (lib/still.mjs) and is the
 *                                    element under its middle, then tapped there
 *   { depot, along?, cars? }         a depot, framed (`dist`) and aimed by the game's own hit test (lib/aim.mjs)
 *   { engine }                       an engine, the same
 *   { at }                           a world point, framed and tapped where it is on the canvas (no hit test)
 *   [x, y]                           a page point
 * Each waits for the tap's click (`__allClicks`) and a frame. `expect` (a page function, with `arg`): waited for after
 * the tap, or it throws. `dist`, `glide` (more glideTo options) and `cars` (lib/aim.mjs) for world targets.
 */
export async function tap(page, target, opts = {}) {
  const at = await aim(page, target, opts);
  // (Where the last tap went and what was there: for a check's detail when what it did isn't what was wanted.)
  tap.last = { target, at: at.map(Math.round), under: await underFinger(page, ...at) };
  await tapAt(page, at, target);
  if (opts.expect) await until(page, opts.expect, opts.arg, { timeout: opts.timeout ?? 20_000, why: `after a tap on ${describe(target)}: ${opts.why ?? opts.expect.toString().slice(0, 120)}` });
}

/** `tap` that resolves to false where `tap` would throw (and true when it lands): for a step with its own fall-back. */
export async function tryTap(page, target, opts = {}) {
  try {
    await tap(page, target, opts);
    return true;
  } catch (e) {
    if (process.env.E2E_DEBUG) console.log(`(tryTap: ${e.message.split("\n")[0]})`);
    return false;
  }
}

const describe = (t) => (typeof t === "string" ? t : JSON.stringify(t));

/** A page point and its click seen (`__allClicks` up), then a frame. Throws if no click comes in 30 s. */
async function tapAt(page, [x, y], target) {
  const before = await page.evaluate(() => window.__allClicks);
  await page.touchscreen.tap(x, y);
  const ok = await page.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30_000 }).then(() => true, () => false);
  if (!ok) throw new Error(`tap on ${describe(target)} at ${Math.round(x)},${Math.round(y)}: no click came (${await underFinger(page, x, y)})`);
  await frames(page);
}

/** What's at a page point: the element, and the game's pick if it's the canvas. */
function underFinger(page, x, y) {
  return page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    const el = e ? `${e.tagName.toLowerCase()}${[...e.classList].map((c) => `.${c}`).join("")}` : "nothing";
    const pk = e?.tagName === "CANVAS" ? window.woodrail?.interaction?.pick(x, y, true) : null;
    return `under the finger: ${el}${pk ? ` (pick: ${JSON.stringify(pk)})` : ""}`;
  }, [x, y]);
}

/** Where to tap `target` (see `tap`), or throw. */
async function aim(page, target, opts) {
  if (Array.isArray(target)) return target;
  if (typeof target === "string" || target.sel) return aimDom(page, typeof target === "string" ? { sel: target } : target, opts);
  const dist = opts.dist ?? 1300;
  if (target.at) {
    await glideTo(page, target.at, dist, opts.glide);
    const [x, y] = await screenOf(page, target.at);
    const onCanvas = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.tagName === "CANVAS", [x, y]);
    if (!onCanvas) throw new Error(`tap on ${describe(target)}: it isn't on the map at ${Math.round(x)},${Math.round(y)} (${await underFinger(page, x, y)})`);
    return [x, y];
  }
  // A depot or an engine: framed, then aimed where the game's own hit test finds it; once more from closer if not.
  for (const d of [dist, dist * 0.6]) {
    await showing(page, target, d, opts.glide);
    const at = await aimAt(page, target, { cars: opts.cars });
    if (at) return at;
  }
  const [x, y] = await screenOf(page, await worldOf(page, target));
  throw new Error(`tap on ${describe(target)}: the game's hit test finds it nowhere on screen (its middle at ${Math.round(x)},${Math.round(y)}: ${await underFinger(page, x, y)})`);
}

// (The page's finder for a DOM target, kept on the page: its first drawn match, its text including `text`, equal to it
// (`exact`) or starting with it (`starts`).)
const FIND = `(sel, text, how) => [...document.querySelectorAll(sel)].find((e) => {
  if (!(e.getBoundingClientRect().width > 0) || e.closest("[hidden]")) return false;
  if (!text) return true;
  const t = e.textContent.trim();
  return how === "exact" ? t === text : how === "starts" ? t.startsWith(text) : t.includes(text);
})`;
const finder = (page) => page.evaluate((src) => (window.__e2eFind ??= (0, eval)(src), true), FIND);

/** A DOM target's middle once it's drawn, in view, standing still and on top; or throw saying which of those failed. */
async function aimDom(page, { sel, text, exact = false, starts = false }, { timeout = 30_000 } = {}) {
  const what = text ? `${sel} "${text}"` : sel;
  const how = exact ? "exact" : starts ? "starts" : "includes";
  await finder(page);
  const found = await tryUntil(page, (a) => !!window.__e2eFind(...a), [sel, text, how], { timeout });
  if (!found) throw new Error(`tap on ${what}: not drawn in ${timeout / 1000} s`);
  // (Scrolled into view as a finger would: a sheet's list, the tray's strip. Marked, for still() to find that one.)
  const marked = await page.evaluate((a) => {
    document.querySelectorAll("[data-e2e-tap]").forEach((e) => delete e.dataset.e2eTap);
    const el = window.__e2eFind(...a);
    if (!el) return false;
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
    el.dataset.e2eTap = "1";
    return true;
  }, [sel, text, how]);
  if (!marked) throw new Error(`tap on ${what}: gone before the tap`);
  await frames(page);
  if (!(await still(page, "[data-e2e-tap]", undefined, timeout))) throw new Error(`tap on ${what}: still moving after ${timeout / 1000} s (or gone)`);
  const end = Date.now() + 10_000;
  for (;;) {
    const r = await page.evaluate(() => {
      const el = document.querySelector("[data-e2e-tap]");
      if (!el) return { gone: true };
      const b = el.getBoundingClientRect();
      const [x, y] = [b.left + b.width / 2, b.top + b.height / 2];
      const top = document.elementFromPoint(x, y);
      const on = !!top && (el === top || el.contains(top));
      return { x, y, on, top: top ? `${top.tagName.toLowerCase()}${[...top.classList].map((c) => `.${c}`).join("")}` : "nothing" };
    });
    if (r.gone) throw new Error(`tap on ${what}: gone before the tap`);
    if (r.on) return [r.x, r.y];
    if (Date.now() > end) throw new Error(`tap on ${what}: covered at ${Math.round(r.x)},${Math.round(r.y)} by ${r.top}`);
    await frames(page);
  }
}

/** A finger dragged from `from` to `to` (page points) over CDP, `n` moves, stamped `dt` s apart. */
export async function drag(page, cdp, from, to, { n = 12, dt = 0.03, hold = 0 } = {}) {
  let t = Date.now() / 1000;
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: (t += dt), touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await touch("touchStart", ...from);
  for (let k = 1; k <= n; k++) await touch("touchMove", from[0] + ((to[0] - from[0]) * k) / n, from[1] + ((to[1] - from[1]) * k) / n);
  for (let k = 0; k < hold; k++) await touch("touchMove", ...to);
  await frames(page);
  await touch("touchEnd", 0, 0);
}

// -------------------------------------------------------------------------------------------------------------- routes

/**
 * A train's route planned by taps, as a player does: its engine (its card open; tapped again if the first tap only
 * framed it), Plan a route, each place's depot in turn (a car standing there counts as it: lib/aim.mjs `cars`), Done.
 */
export async function planRoute(page, engine, places) {
  const open = () => window.woodrail.hud.engineCardOpen;
  if (!(await tryTap(page, { engine }, { expect: open, why: "the engine's card open" }))) await tap(page, { engine }, { expect: open, why: "the engine's card open" });
  await tap(page, ".engine-extra .route-plan");
  for (const d of places) await tap(page, { depot: d }, { cars: true, glide: { inRoom: true } });
  await tap(page, ".line-sheet .route-plan.on");
}
