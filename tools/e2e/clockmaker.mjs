// End-to-end: the clockmaker's time control (Game mode, a 390×844 phone with touch). Late-game spec, Clockmaker CA
// (docs/superpowers/specs/2026-11-04-late-game-design.md).
//
//   1. A new game: no clock on the HUD.
//   2. Clockmaker learned (a setup shortcut: the study isn't what's tested): the clock shows "1×" beside Pause, and
//      fits the phone's top bar.
//   3. A tap: "2×", and the payoff: the game's time runs twice as fast (its seconds per second of the page's, over a
//      stretch of each, the view still), and the calendar with it.
//   4. Clock tower learned: taps go 2× → 3× → 1×.
//   5. A phone too slow for 3× (the game's own slow-phone call, made by hand: a setup shortcut, the detection is unit
//      tested): back to 2×, and the player is told.
//
// Usage: npm run e2e:clockmaker [-- <out dir>]   (default out: e2e-out/clockmaker)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/clockmaker";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5401, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
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
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const clock = () =>
  p.evaluate(() => {
    const e = document.querySelector("button.speed");
    if (!e || e.hidden) return null;
    const r = e.getBoundingClientRect();
    return { text: e.textContent, x: r.x, y: r.y, w: r.width, h: r.height };
  });
const tapClock = async () => {
  await p.waitForTimeout(400);
  const c = await clock();
  if (!c) return false;
  const before = await p.evaluate(() => window.__allClicks);
  await p.touchscreen.tap(c.x + c.w / 2, c.y + c.h / 2);
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(300);
  return true;
};
/** The game's seconds per second of the page's, over `ms` (the view still: frames come at their fastest). */
const rate = (ms) =>
  p.evaluate(async (ms) => {
    const w = window.woodrail;
    const s0 = w.simSeconds;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, ms));
    return (w.simSeconds - s0) / ((performance.now() - t0) / 1000);
  }, ms);

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// 1. No clock yet.
check("1. a new game: no clock on the HUD", (await clock()) === null);

// 2. Clockmaker learned.
await p.evaluate(() => window.woodrail.learn("clockmaker"));
await p.waitForFunction(() => !document.querySelector("button.speed")?.hidden, null, { timeout: 5000 }).catch(() => {});
const c1 = await clock();
const fits = await p.evaluate(() => {
  const bar = [...document.querySelectorAll("button.speed, button[title^='Pause'], button[title^='Resume']")].map((e) => e.getBoundingClientRect());
  const coins = document.querySelector(".coins, .hud-coins")?.getBoundingClientRect();
  return bar.every((r) => r.right <= innerWidth && r.left >= 0) && (!coins || bar.every((r) => r.left >= coins.right - 1));
});
check("2. Clockmaker learned: the clock shows 1× by Pause, on the phone's bar", c1?.text === "1×" && c1.w >= 40 && fits, JSON.stringify({ c1, fits }));
await shot("1-clock");

// 3. 2×: the game's time runs twice as fast.
const date0 = await p.evaluate(() => document.querySelector(".date, .hud-date")?.textContent ?? null);
await p.evaluate(() => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(0, 0, -4000), 3000, { duration: 0.1 }));
await settle();
const one = await rate(6000);
await tapClock();
const c2 = await clock();
const two = await rate(6000);
check("3. a tap: 2×", c2?.text === "2×" && (await p.evaluate(() => window.woodrail.timeScale)) === 2, JSON.stringify(c2));
check("…and the game's time runs about twice as fast", two / one > 1.6, JSON.stringify({ one: one.toFixed(2), two: two.toFixed(2) }));
await shot("2-two-times");
void date0;

// 4. Clock tower: 3×, then round to 1×.
await p.evaluate(() => window.woodrail.learn("clock-tower"));
await p.waitForTimeout(1500);
await tapClock();
const c3 = await clock();
await shot("3-three-times");
check("4. Clock tower learned: the next tap, 3×", c3?.text === "3×", JSON.stringify(c3));

// 5. Too slow for 3× (the game's own call, made by hand): back to 2×, said.
await p.evaluate(() => {
  const hud = window.woodrail.hud;
  const toast = hud.toast.bind(hud);
  window.__toasts = [];
  hud.toast = (m, ...a) => {
    window.__toasts.push(m);
    return toast(m, ...a);
  };
  window.woodrail.onTooSlow();
});
await p.waitForTimeout(500);
const back = { clock: (await clock())?.text, said: await p.evaluate(() => window.__toasts.join(" | ")) };
check("5. a phone too slow for 3×: back to 2×, and told", back.clock === "2×" && /back to 2×/.test(back.said), JSON.stringify(back));
await tapClock();
check("…and a tap from 2× goes on to 3×", (await clock())?.text === "3×");
await tapClock();
check("…then round to 1×", (await clock())?.text === "1×");

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(`\n${failures === 0 ? "e2e:clockmaker passed" : `e2e:clockmaker: ${failures} failed`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
