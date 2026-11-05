// End-to-end: the game's drawing taken away (a lost WebGL context, as when a phone runs short of memory), on a phone
// like a Pixel 10 (412×915, DPR 2.625, touch), in Game mode. Lost for a moment: nothing shows, and when it's back the
// game draws again (shadows and the environment map made again, the card gone). Lost for good: "The picture stopped",
// a tap on "Tap to reload", and the game is back in play with the railway as it was (saved as the drawing went), lean
// from then on (a pixel ratio of 1.5). Idle, it draws nothing, before and after.
// Crash reports (src/feedback/crash.ts): the first loss sends one, holding only the error and the device (no map, no
// save); the second sends none (one a session). ☰ "Crash reports: on" switches them off, and an error then sends
// nothing; on again (a new session), an uncaught error sends one with its stack's links cut short.
//
// Harness shortcuts (named; not what's tested): the context is lost and given back with WEBGL_lose_context (what the
// browser does on its own); the piece laid to tell the railway is kept is laid through the editor, not the tray; the
// idle checks pause the game by its flag (a running train draws); the Worker's /crash is answered by the page's route,
// read with the Worker's own parser (its handling is cloud/test/crash.test.ts's); a new session is a cleared flag.
//
// A phone frees its drawn-only geometry once uploaded (gpu-only.ts, the mobile tier only), so a loss there goes to the
// card at once. `npm run e2e:gl-lost:desktop` (GL_LOST_DESKTOP=1) runs on a desktop instead (1440×900, a mouse, the
// high tier): its copies are kept, and a brief loss comes back in place, the scene drawn again with no card; then it
// stops (what follows is the phone's: the reload into a lean phone).
//
// Usage: npm run e2e:gl-lost [-- <out dir>]   (default out: e2e-out/gl-lost)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocks } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DESKTOP = process.env.GL_LOST_DESKTOP === "1";
const OUT = process.argv[2] ?? (DESKTOP ? "e2e-out/gl-lost-desktop" : "e2e-out/gl-lost");
/** The device, as the crash report should give it. */
const DEVICE = DESKTOP ? { dpr: 1, pr: 1, tier: "high" } : { dpr: 2.625, pr: 2, tier: "mobile" };
mkdirSync(OUT, { recursive: true });
const FEEDBACK = "http://feedback.test";
process.env.VITE_FEEDBACK_URL = FEEDBACK;
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const { parseCrash } = await server.ssrLoadModule("/cloud/src/crash.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext(DESKTOP ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true });
// (The station clocks held still: they draw a frame each minute, which an idle check could catch.)
await pinClocks(ctx);
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => { if (!e.message.includes("e2e: on purpose")) errors.push(e.message); });
// (A geometry uploaded again after its data was freed draws nothing: gpu-only.ts says so.)
p.on("console", (m) => { if (m.type() === "error" && m.text().includes("uploaded again")) errors.push(m.text().slice(0, 200)); });
/** Crash reports the game sent, as posted. */
const crashes = [];
await ctx.route(`${FEEDBACK}/**`, async (route) => {
  if (route.request().url().endsWith("/crash")) crashes.push(route.request().postData() ?? "");
  await route.fulfill({ status: 201, body: "{}", headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" } });
});
const tap = async (selector, text) => {
  await p.waitForTimeout(400);
  const r = await p.evaluate(({ s, text }) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden]") && (!text || e.textContent.includes(text)));
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, { s: selector, text });
  if (r) await p.touchscreen.tap(r.x, r.y);
  return !!r;
};
/** Open ☰, unless it's open already (Escape closes it in some versions, not in others). */
const openMenu = async () => {
  const open = await p.evaluate(() => [...document.querySelectorAll(".menu-item")].some((e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden]")));
  if (!open) await tap(".hud button[title='Menu'], button[aria-label='Menu']");
};
const menuItem = (text) => p.evaluate((t) => [...document.querySelectorAll(".menu-item")].find((e) => e.textContent.startsWith(t))?.textContent ?? null, text);
/**
 * Tap ☰'s "Crash reports" till it reads `want` (waited for, not slept on: under load a tap can land late or not at
 * all; tapped again only if it never changed).
 */
const switchCrashReports = async (want) => {
  const reads = () => p.waitForFunction((w) => [...document.querySelectorAll(".menu-item")].some((e) => e.textContent === w), want, { timeout: 8000 }).then(() => true, () => false);
  for (let i = 0; i < 2; i++) {
    await openMenu();
    await tap(".menu-item", "Crash reports");
    if (await reads()) return;
  }
};
/** Wait for the next crash report to be posted (up to 20 s), then for it to be in `crashes`. */
const nextCrash = async (n) => {
  await p.waitForRequest((r) => r.url().endsWith("/crash"), { timeout: 20000 }).catch(() => {});
  // (The route's handler records it a moment after the request.)
  for (let i = 0; i < 40 && crashes.length < n; i++) await p.waitForTimeout(50);
};
await p.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.stats.asked", "1");
});
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
const cardShown = () => p.evaluate(() => { const c = document.querySelector(".gl-lost"); return !!c && !c.hidden && c.getBoundingClientRect().width > 0; });
const inPlay = () => p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 300000 });
const lose = () => p.evaluate(() => { const ext = window.woodrail.renderer.getContext().getExtension("WEBGL_lose_context"); window.__lose = ext; ext.loseContext(); });
/** Frames drawn over a few still seconds, paused (should be none: a running train would draw). */
const idleFrames = async () => {
  await p.evaluate(() => (window.woodrail.paused = true));
  // (A first visit's own work done first: tray pictures drawn and kept, track carved, each landing with a frame.)
  await p.evaluate(() => Promise.race([window.woodrail.trayThumbnailsSaved(), new Promise((r) => setTimeout(r, 60000))]));
  await settle();
  await p.waitForTimeout(1500);
  await settle();
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(4000);
  const n = (await p.evaluate(() => window.woodrail.framesDrawn)) - f0;
  await p.evaluate(() => (window.woodrail.paused = false));
  return n;
};
/** How bright the middle of a frame drawn now is (0–255): something was drawn there, not black. */
const drawn = () => p.evaluate(async () => {
  const blob = await window.woodrail.capture();
  if (!blob) return 0;
  const img = await createImageBitmap(blob);
  const c = document.createElement("canvas"); c.width = c.height = 8;
  const g = c.getContext("2d");
  g.drawImage(img, img.width / 2 - 4, img.height / 2 - 4, 8, 8, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data; let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
  return sum / 64 / 3;
});

// 1. A new game on the phone: full density (2), not lean.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 300000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await inPlay();
await settle();
await p.keyboard.press("Escape");
const q0 = await p.evaluate(() => ({ tier: window.woodrail.quality.tier, lean: window.woodrail.quality.lean, pr: window.woodrail.renderer.getPixelRatio(), inPlace: window.woodrail.restoreInPlace }));
if (DESKTOP) {
  check("a desktop: the high tier, its CPU copies kept (restores in place)", q0.tier === "high" && !q0.lean && q0.inPlace === true, JSON.stringify(q0));
} else {
  check("a phone: the mobile tier at a pixel ratio of 2, not lean", q0.tier === "mobile" && !q0.lean && q0.pr === 2, JSON.stringify(q0));
  check("…its drawn-only geometry freed once uploaded (a loss reloads)", q0.inPlace === false, JSON.stringify(q0));
}
{
  const n = await idleFrames();
  check("idle: nothing drawn", n === 0, `${n} frames`);
}

// 2. Lost for a moment. With drawn-only geometry freed after upload (gpu-only.ts, on by default), the scene can't be
// uploaded again, so the game can't come back in place (Game.restoreInPlace false): the card at once, and a tap reloads.
// With it off, it comes back by itself, with no card.
const inPlace = await p.evaluate(() => window.woodrail.restoreInPlace);
await lose();
await p.waitForTimeout(800);
if (!inPlace) {
  check("lost, freed geometry: the card at once", await cardShown());
  const b0 = await p.evaluate(() => { const r = document.querySelector(".gl-lost button")?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; });
  await p.waitForTimeout(500);
  const c0 = crashes[0] ? JSON.parse(crashes[0]) : null;
  check("a crash report sent for the loss", crashes.length === 1 && c0?.kind === "context-lost", `${crashes.length} sent`);
  check("…holding only the error and the device: no map, no save", !!c0 && JSON.stringify(Object.keys(c0).sort()) === JSON.stringify(["build", "kind", "message", "pixelRatio", "quality", "screen", "stack", "userAgent"]) && !crashes[0].includes("woodrail-map"), crashes[0]);
  check("…the screen, DPR and tier", c0?.screen?.dpr === DEVICE.dpr && c0?.pixelRatio === DEVICE.pr && c0?.quality === DEVICE.tier, JSON.stringify({ screen: c0?.screen, pr: c0?.pixelRatio, q: c0?.quality }));
  check("…which the Worker takes", typeof parseCrash(c0) === "object");
  await shot("1-card-at-once");
  if (b0) await p.touchscreen.tap(b0.x, b0.y);
  await p.waitForLoadState("load");
  await inPlay();
  await settle();
  const lum0 = await drawn();
  check("…a tap: reloaded straight into play, and it draws", !(await p.evaluate(() => window.woodrail.title.shown)) && lum0 > 20, `brightness ${lum0.toFixed(0)}`);
} else {
check("lost: no card at once (it may come back)", !(await cardShown()));
await p.evaluate(() => window.__lose.restoreContext());
await p.waitForFunction(() => !window.woodrail.renderer.getContext().isContextLost(), null, { timeout: 20000 }).catch(() => {});
await settle();
const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
const lum = await drawn();
check("back: the game draws again", (await p.evaluate(() => window.woodrail.framesDrawn)) > f1 && lum > 20, `brightness ${lum.toFixed(0)}`);
check("…and no card", !(await cardShown()));
await shot("1-restored");
await p.waitForTimeout(500);
const first = crashes[0] ? JSON.parse(crashes[0]) : null;
check("a crash report sent for the loss", crashes.length === 1 && first?.kind === "context-lost", `${crashes.length} sent`);
check("…holding only the error and the device: no map, no save", !!first && JSON.stringify(Object.keys(first).sort()) === JSON.stringify(["build", "kind", "message", "pixelRatio", "quality", "screen", "stack", "userAgent"]) && !crashes[0].includes("woodrail-map"), crashes[0]);
check("…the screen, DPR and tier", first?.screen?.dpr === DEVICE.dpr && first?.pixelRatio === DEVICE.pr && first?.quality === DEVICE.tier, JSON.stringify({ screen: first?.screen, pr: first?.pixelRatio, q: first?.quality }));
check("…which the Worker takes", typeof parseCrash(first) === "object");
}

// The desktop's run ends here: the rest is the phone's (a reload into a lean phone, by taps).
if (DESKTOP) {
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
  await b.close();
  await server.close();
  process.exit(failures === 0 ? 0 : 1);
}

// 3. Lost for good: a piece laid just before, the card, a tap to reload.
const pieces = await p.evaluate(() => {
  const w = window.woodrail, t = w.controls.target;
  const id = w.editor().place("straight-144", { x: t.x + 400, z: t.z + 400, heading: 0 }, 0, false);
  return { id, count: w.layout.pieceCount };
});
check("a piece laid", pieces.id >= 0, JSON.stringify(pieces));
await lose();
await p.waitForTimeout(3500);
check("lost, not back: “The picture stopped”", await cardShown(), await p.evaluate(() => document.querySelector(".gl-lost")?.textContent ?? ""));
const btn = await p.evaluate(() => { const r = document.querySelector(".gl-lost button")?.getBoundingClientRect(); return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height } : null; });
check("…its button 44 px or more", !!btn && btn.h >= 44 && btn.w >= 44, JSON.stringify(btn));
check("…the device kept as lean from now", await p.evaluate(() => Number(localStorage.getItem("woodrail.gpuLost")) > 0));
check("…no second crash report (one a session)", crashes.length === 1, `${crashes.length} sent`);
await shot("2-card");
await p.touchscreen.tap(btn.x, btn.y);
await p.waitForLoadState("load");
await inPlay();
await settle();
const q1 = await p.evaluate(() => ({ lean: window.woodrail.quality.lean, pr: window.woodrail.renderer.getPixelRatio(), shadow: window.woodrail.stage.sun.shadow.mapSize.x, count: window.woodrail.layout.pieceCount, title: window.woodrail.title.shown }));
check("reloaded straight into play, the railway as it was", !q1.title && q1.count === pieces.count, JSON.stringify(q1));
check("…lean: a pixel ratio of 1.5, a 1024 shadow map", q1.lean && q1.pr === 1.5 && q1.shadow === 1024, JSON.stringify(q1));
const lum2 = await drawn();
check("…it draws", lum2 > 20, `brightness ${lum2.toFixed(0)}`);
{
  const n = await idleFrames();
  check("idle, lean: nothing drawn", n === 0, `${n} frames`);
}
await shot("3-lean");

// 4. Crash reports switched off in ☰, then on again.
await openMenu();
check("☰ says “Crash reports: on”", (await menuItem("Crash reports")) === "Crash reports: on");
await shot("4-menu");
await switchCrashReports("Crash reports: off");
check("…a tap: “Crash reports: off”, kept", (await menuItem("Crash reports")) === "Crash reports: off" && (await p.evaluate(() => localStorage.getItem("woodrail.crashReports"))) === "off");
await p.keyboard.press("Escape");
// (A new session: the once-a-session flag cleared.)
await p.evaluate(() => { sessionStorage.removeItem("woodrail.crashSent"); setTimeout(() => { throw new Error("e2e: on purpose, off"); }); });
await p.waitForTimeout(1500);
check("off: an error sends nothing", crashes.length === 1, `${crashes.length} sent`);
await switchCrashReports("Crash reports: on");
check("…on again", (await menuItem("Crash reports")) === "Crash reports: on");
await p.keyboard.press("Escape");
const posted = nextCrash(2);
await p.evaluate(() => setTimeout(() => { throw new Error("e2e: on purpose, on"); }));
await posted;
const err = crashes[1] ? JSON.parse(crashes[1]) : null;
check("on: an uncaught error sends one, its stack's links cut short", crashes.length === 2 && err?.kind === "error" && err.message.includes("on purpose, on") && !/https?:|localhost/.test(err.stack) && err.quality === "mobile-lean", crashes[1] ?? "");

// 5. A scene that can't be uploaded again (its CPU copies freed: Game.restoreInPlace false): the card at once, and it
// stays when the context comes back (only a reload brings the scene back), nothing drawn.
await p.evaluate(() => (window.woodrail.restoreInPlace = false));
await lose();
await p.waitForTimeout(600);
check("no CPU copies: lost, the card at once", await cardShown());
await p.evaluate(() => window.__lose.restoreContext());
await p.waitForTimeout(3000);
const held = await p.evaluate(() => ({ lost: window.woodrail.contextLost, f: window.woodrail.framesDrawn }));
await p.waitForTimeout(1500);
check("…back: the card stays, nothing drawn", (await cardShown()) && held.lost && (await p.evaluate(() => window.woodrail.framesDrawn)) === held.f, JSON.stringify(held));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
