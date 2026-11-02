// End-to-end station clocks (`npm run e2e:station-clock`): a station clock's hands show the player's real local time,
// in Game mode and in Sandbox, on a 390×844 phone. The page's clock is Playwright's (a mocked `Date`, timers and
// frames): the hands match the time; between minutes, with nothing else going on, no frame is drawn; at the minute's
// start the hands move on and one frame is drawn; and a page hidden and shown again ten minutes on sets them at once.
//
// Setup shortcut (not the thing under test): the clock is put down with `props.add` (as e2e:kits does), not dragged
// off the tray: what's tested is its hands, not placing it.
//
// Usage: npm run e2e:station-clock [-- <out dir>]   (default out: e2e-out/station-clock)
// Starts its own dev server (on 5362, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/station-clock";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5362, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const TURN = Math.PI * 2;
/** The hands' angles for a local time (as `handAngles` in src/render/clock-view.ts: the hour hand moves on with the minutes). */
const expected = (h, m) => ({ hour: (((h % 12) + m / 60) / 12) * TURN, minute: (m / 60) * TURN });
/** Same angle, round the turn. */
const near = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-3;

async function run(mode) {
  // A fixed time zone, so the local time the page sees is the one written here.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, timezoneId: "Europe/London" });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  const shot = (n) => p.screenshot({ path: `${OUT}/${mode}-${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  // The page's clock: mocked from the start, running on by itself while the game loads.
  await p.clock.install({ time: new Date("2026-11-02T14:00:00") });
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate((mode) => [...document.querySelectorAll(`.title-card.mode-${mode} button`)].find((b) => !b.hidden && b.classList.contains("primary")).click(), mode);
  await p.waitForFunction((mode) => window.woodrail?.mode?.() === mode && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), mode, { timeout: 180000 });
  await p.keyboard.press("Escape").catch(() => {});

  // A clock beside the first town's station (Game) or the middle of the mat (Sandbox), the camera close on it, and
  // the game paused (no trains: nothing else to draw).
  const placed = await p.evaluate(async () => {
    const w = window.woodrail;
    w.hud.hideCards?.();
    const t = w.landscape.towns?.[0];
    const at = t ? { x: t.station.x - Math.sin(t.station.heading) * -120, z: t.station.z + Math.cos(t.station.heading) * -120 } : { x: 0, z: 0 };
    const clock = w.props.add("bldg-station-clock", { x: at.x, z: at.z, heading: t ? t.station.heading : 0, y: 0 });
    w.propsChanged();
    w.paused = true;
    w.director.glideTo(new w.camera.position.constructor(clock.x, 40, clock.z), 220, { duration: 0.1 });
    return { id: clock.id };
  });
  // Its model arrives (fetched and built), its hands with it.
  await p.waitForFunction(() => window.woodrail.clockView.count >= 1, null, { timeout: 60000 }).catch(() => {});
  await p.evaluate(() => Promise.race([window.woodrail.settled(5), new Promise((r) => setTimeout(r, 30000))]));
  check(`${mode}: the clock is drawn with hands of its own`, (await p.evaluate(() => window.woodrail.clockView.count)) >= 1, JSON.stringify(placed));

  /** The page's local time, the angles the view says it shows, and each hand mesh's turn from rest (about its face's axis). */
  const read = () =>
    p.evaluate(() => {
      const w = window.woodrail;
      const turns = { hour: [], minute: [] };
      for (const c of w.clockView.clocks.values())
        for (const name of ["hour", "minute"])
          for (const h of c.parts.get(name)) {
            const rest = h.userData.rest;
            const q = rest ? rest.clone().invert().multiply(h.quaternion) : h.quaternion;
            // A turn of −angle about x (see setHands): back to a clockwise angle.
            turns[name].push(-2 * Math.atan2(q.x, q.w));
          }
      const d = new Date();
      return { h: d.getHours(), m: d.getMinutes(), s: d.getSeconds(), shown: w.clockView.shown, turns, frames: w.framesDrawn, inView: w.clockView.count };
    });
  const handsMatch = (r) => {
    const e = expected(r.h, r.m);
    return near(r.shown.hour, e.hour) && near(r.shown.minute, e.minute) && r.turns.hour.length > 0 && r.turns.minute.length > 0 && r.turns.hour.every((a) => near(a, e.hour)) && r.turns.minute.every((a) => near(a, e.minute));
  };

  // What asks for a frame (for a failure's detail). And the tray's track pieces are carved in the background after the
  // game starts, each batch asking for a frame as it lands: wait for that to be over (10 s with nothing asked, as the
  // page's clock runs by itself), so the frames counted below are only what the clocks ask for.
  await p.evaluate(() => {
    const w = window.woodrail;
    w.__asked = [];
    w.__askedAt = performance.now();
    const real = w.invalidate.bind(w);
    w.invalidate = () => {
      w.__asked.push(new Error().stack.split("\n").slice(2, 5).join(" < ").replace(/\s+/g, " "));
      w.__askedAt = performance.now();
      real();
    };
  });
  await p.waitForFunction(() => performance.now() - window.woodrail.__askedAt > 10_000, null, { timeout: 240000, polling: 500 }).catch(() => console.log("(still carving after 4 min)"));
  // Pause the page's clock 5 s into a minute, run it a second (the frame for the minute it jumped past is drawn), then
  // on 49 s: no frame drawn (the hands haven't moved).
  const base = await p.evaluate(() => Date.now());
  const into = new Date(Math.ceil((base + 60_000) / 60_000) * 60_000 + 5_000);
  await p.clock.pauseAt(into);
  await p.clock.runFor(1_000);
  await p.evaluate(() => (window.woodrail.__asked = []));
  const before = await read();
  check(`${mode}: the hands show the page's local time (${before.h}:${String(before.m).padStart(2, "0")})`, handsMatch(before), JSON.stringify(before));
  await shot("1-clock");
  await p.clock.runFor(49_000);
  const quiet = await read();
  quiet.asked = await p.evaluate(() => window.woodrail.__asked);
  check(`${mode}: between minutes, nothing drawn (49 s of the page's time)`, quiet.frames === before.frames && quiet.m === before.m, JSON.stringify({ before: before.frames, after: quiet.frames, at: `${quiet.h}:${quiet.m}:${quiet.s}`, asked: quiet.asked }));
  // On past the minute's start: the hands move on to it, and a frame is drawn for it (one, maybe two with the camera's
  // own settle), and none after for the rest of that minute.
  await p.clock.runFor(10_000);
  const moved = await read();
  check(`${mode}: at the minute's start the hands move on (${moved.h}:${String(moved.m).padStart(2, "0")})`, moved.m !== quiet.m && handsMatch(moved), JSON.stringify(moved));
  check(`${mode}: and a frame is drawn for it`, moved.frames - quiet.frames >= 1 && moved.frames - quiet.frames <= 2, `${moved.frames - quiet.frames} frame(s)`);
  await p.clock.runFor(45_000);
  const after = await read();
  check(`${mode}: then nothing more until the next minute`, after.frames === moved.frames, `${after.frames - moved.frames} frame(s)`);
  await shot("2-next-minute");

  // Hidden (no timer), then shown again ten minutes on: the hands are set at once.
  const hidden = await p.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    return Date.now();
  });
  await p.clock.setSystemTime(new Date(hidden + 10 * 60_000));
  await p.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const back = await read();
  check(`${mode}: shown again ten minutes on, the hands are set at once (${back.h}:${String(back.m).padStart(2, "0")})`, handsMatch(back) && (back.m - after.m + 60) % 60 >= 9, JSON.stringify(back));
  check(`${mode}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

try {
  await run("game");
  await run("sandbox");
} finally {
  await b.close();
  await server.close();
}
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
