// End-to-end the ☰ "Train dispatcher" switch (`npm run e2e:dispatcher [-- <out dir>]`), in Game mode on a phone at
// 390×844 with touch. An old save (a reference map, src/play/bugmaps/reference/rowan-3.txt, with no `dispatcher` in it,
// opened by the dev-only #load= link: setup) keeps it off: ☰ has "Train dispatcher: off" with its line of help, 44 px;
// a tap turns it on (the economy's dispatcher holds the trains) and the trains go on calling at their stops; after a
// reload (the game continued from its save) it's still on; a tap turns it off and the trains still run. Then, with
// nothing saved, the title's New game and Start: a new game has it on (`asNewGame`), ☰ says so; a tap turns it off,
// and after a reload it's still off.
//
// Usage: npm run e2e:dispatcher [-- <out dir>]   (default out: e2e-out/dispatcher)
// Starts its own dev server (on 5397, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/dispatcher";
mkdirSync(OUT, { recursive: true });
const MAP = readFileSync(`${ROOT}/src/play/bugmaps/reference/rowan-3.txt`, "utf8").trim();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
// (The test clock at 8×: the checks wait on trains' runs, game time.)
const b = testClockIn(await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }), { speed: 8 });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
let p = await ctx.newPage();
const errors = [];
// (The dev build's train invariants with the dispatcher on (its open breaks are the jams bar's, not this switch's),
// noted, not counted as page errors. Any other console error is.)
const notes = [];
/** A page's errors and notes, and its click counter (`tap` waits on it). */
const watch = (pg) => {
  pg.on("pageerror", (e) => errors.push(e.message));
  pg.on("console", (m) => {
    if (m.type() !== "error") return;
    if (m.text().startsWith("[invariants]")) notes.push(m.text());
    else errors.push(`console: ${m.text()}`);
  });
  return pg.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    window.__clicks = 0;
    document.addEventListener("click", () => window.__clicks++, true);
  });
};
await watch(p);
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const inGame = () => p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
/** The middle of the first visible element matching `selector`. */
const centre = (selector, text) =>
  p.evaluate(({ selector, text }) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, h: r.height };
  }, { selector, text });
const tap = async (selector, text) => {
  const at = await centre(selector, text);
  if (!at) return false;
  // (Wait for the click to land: under SwiftShader with the test clock a frame can take seconds.)
  const before = await p.evaluate(() => window.__clicks);
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForFunction((n) => window.__clicks > n, before, { timeout: 60000 }).catch(() => console.log(`(no click landed on ${selector})`));
  await p.waitForTimeout(500);
  return true;
};
/** ☰ open (a tap on Menu only if it's shut: a second tap shuts it). A town's growth offer that came up meanwhile (the
 * test clock runs the game fast: towns grow) is closed first, by its ✕, as a player would. */
const menuOpen = async () => {
  while (await p.evaluate(() => [...document.querySelectorAll(".growth-sheet")].some((g) => !g.hidden && g.getBoundingClientRect().width > 0))) await tap(".growth-sheet .close");
  if (await p.evaluate(() => document.querySelector(".menu")?.hidden !== false)) await tap('button[aria-label="Menu"]');
  await p.waitForFunction(() => !document.querySelector(".menu")?.hidden, null, { timeout: 30000 });
};
const item = () => p.evaluate(() => {
  const i = document.querySelector(".dispatcher-item");
  return i ? { text: i.firstElementChild?.textContent ?? "", help: i.querySelector(".menu-item-help")?.textContent ?? "", h: i.getBoundingClientRect().height } : null;
});
const HELP = "Plans who goes first so trains don't block each other. Off: trains go by the signals alone";
const dispatching = () => p.evaluate(() => !!window.woodrail.economy.dispatcher);
/** Stops the routed trains come to over `s` seconds of game time (one coming to its stop), the game unpaused. */
const stopsOver = (s) =>
  p.evaluate(async (s) => {
    const w = window.woodrail;
    if (w.paused) w.paused = false;
    const e = w.economy;
    const was = new Map();
    let n = 0;
    const look = () => {
      for (const id of e.lineIdOf.keys()) {
        const r = e.routeOf(id);
        const at = !!r?.at;
        if (at && was.get(id) === false) n++;
        was.set(id, at);
      }
    };
    const end = w.sim.ticks + s * 120;
    const give = performance.now() + 300000;
    while (w.sim.ticks < end && performance.now() < give) {
      look();
      await new Promise((r) => setTimeout(r, 50));
    }
    return n;
  }, s);

try {
  // 1. A game with trains running on their lines.
  await p.goto(`${PAGE}#load=${encodeURIComponent(MAP)}`);
  await inGame();
  const trains = await p.evaluate(() => window.woodrail.economy.lineIdOf.size);
  check("a game with trains on lines", trains >= 3, `${trains} routed engines`);
  check("an old save (no dispatcher in it): off to begin with", !(await dispatching()));

  // 2. ☰ has the switch, off, with its help, 44 px tall.
  await menuOpen();
  const off = await item();
  check("an old save: ☰ has Train dispatcher: off", off?.text === "Train dispatcher: off", JSON.stringify(off));
  check("…with its line of help", off?.help === HELP, JSON.stringify(off?.help));
  check("…44 px at least", (off?.h ?? 0) >= 44, `${off?.h}`);
  await shot("1-menu-off");

  // 3. A tap: on. The trains go on calling at their stops.
  await tap(".dispatcher-item");
  check("a tap turns the dispatcher on", await dispatching());
  await menuOpen();
  check("…and ☰ says so", (await item())?.text === "Train dispatcher: on", JSON.stringify(await item()));
  await shot("2-menu-on");
  await p.keyboard.press("Escape");
  const onStops = await stopsOver(60);
  check("with it on, the trains call at their stops", onStops >= 3, `${onStops} stops in 60 s of game time`);
  await shot("3-running-on");

  // 4. Reloaded, the game continued from its save: still on.
  await p.waitForTimeout(3000); // (saved)
  await p.reload();
  // (The title: Continue, the game played last.)
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary"))?.click());
  await inGame();
  check("after a reload the dispatcher is still on", await dispatching());
  await menuOpen();
  check("…and ☰ says so", (await item())?.text === "Train dispatcher: on", JSON.stringify(await item()));
  const backStops = await stopsOver(30);
  check("…and the trains run", backStops >= 2, `${backStops} stops in 30 s of game time`);

  // 5. A tap: off again. The trains still run.
  await menuOpen();
  await tap(".dispatcher-item");
  check("a tap turns it off", !(await dispatching()));
  await menuOpen();
  check("…and ☰ says so", (await item())?.text === "Train dispatcher: off", JSON.stringify(await item()));
  await p.keyboard.press("Escape");
  const offStops = await stopsOver(60);
  check("with it off, the trains still call at their stops", offStops >= 3, `${offStops} stops in 60 s of game time`);

  // 6. A new game (nothing saved: a context of its own): the title's New game, Start. On, and ☰ says so.
  await p.close();
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  p = await ctx2.newPage();
  await watch(p);
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  // (Its new-game screen, then Start; or, a first game on this device, straight into it. Tapped again if the title
  // wasn't taking taps yet, under SwiftShader's slow first frames.)
  const sheet = () => { const s = document.querySelector(".new-game-sheet"); return !!s && !s.hidden && s.getBoundingClientRect().width > 0; };
  const away = (sheet) => new Function(`return (${sheet})()`)() || (window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown);
  let left = false;
  for (let n = 0; n < 3 && !left; n++) {
    await p.waitForTimeout(2000);
    await tap(".title-card.mode-game .title-buttons button", "New game");
    left = await p.waitForFunction(away, sheet.toString(), { timeout: 60000 }).then(() => true, () => false);
  }
  check("the title's New game is a tap", left);
  if (await p.evaluate(sheet)) check("…Start is a tap", await tap(".new-game-start"));
  await inGame();
  check("a new game has the dispatcher on", await dispatching());
  await menuOpen();
  const on = await item();
  check("…and ☰ says Train dispatcher: on", on?.text === "Train dispatcher: on", JSON.stringify(on));
  check("…with its line of help, 44 px at least", on?.help === HELP && (on?.h ?? 0) >= 44, JSON.stringify(on));
  await shot("4-new-game-on");

  // 7. A tap turns it off for this game; reloaded, still off (saved as the player left it).
  await tap(".dispatcher-item");
  check("a tap turns it off in the new game", !(await dispatching()));
  await p.waitForTimeout(3000); // (saved)
  await p.reload();
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary"))?.click());
  await inGame();
  check("after a reload it's still off", !(await dispatching()));
  await menuOpen();
  check("…and ☰ says so", (await item())?.text === "Train dispatcher: off", JSON.stringify(await item()));
} catch (e) {
  failures++;
  console.log("FAIL", e.message);
  await shot("fail");
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "));
for (const n of notes.slice(0, 5)) console.log("NOTE", n);
console.log(failures === 0 ? "dispatcher: all passed" : `dispatcher: ${failures} failed`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
