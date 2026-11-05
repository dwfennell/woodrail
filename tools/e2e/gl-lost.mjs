// End-to-end: the game's drawing taken away (a lost WebGL context, as when a phone runs short of memory), on a phone
// like a Pixel 10 (412×915, DPR 2.625, touch), in Game mode. Lost for a moment: nothing shows, and when it's back the
// game draws again (shadows and the environment map made again, the card gone). Lost for good: "The picture stopped",
// a tap on "Tap to reload", and the game is back in play with the railway as it was (saved as the drawing went), lean
// from then on (a pixel ratio of 1.5). Idle, it draws nothing, before and after.
//
// Harness shortcuts (named; not what's tested): the context is lost and given back with WEBGL_lose_context (what the
// browser does on its own); the piece laid to tell the railway is kept is laid through the editor, not the tray; the
// idle checks pause the game by its flag (a running train draws).
//
// Usage: npm run e2e:gl-lost [-- <out dir>]   (default out: e2e-out/gl-lost)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocks } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/gl-lost";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true });
// (The station clocks held still: they draw a frame each minute, which an idle check could catch.)
await pinClocks(ctx);
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
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
const q0 = await p.evaluate(() => ({ tier: window.woodrail.quality.tier, lean: window.woodrail.quality.lean, pr: window.woodrail.renderer.getPixelRatio() }));
check("a phone: the mobile tier at a pixel ratio of 2, not lean", q0.tier === "mobile" && !q0.lean && q0.pr === 2, JSON.stringify(q0));
{
  const n = await idleFrames();
  check("idle: nothing drawn", n === 0, `${n} frames`);
}

// 2. Lost for a moment, and back.
await lose();
await p.waitForTimeout(800);
check("lost: no card at once (it may come back)", !(await cardShown()));
await p.evaluate(() => window.__lose.restoreContext());
await p.waitForFunction(() => !window.woodrail.renderer.getContext().isContextLost(), null, { timeout: 20000 }).catch(() => {});
await settle();
const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
const lum = await drawn();
check("back: the game draws again", (await p.evaluate(() => window.woodrail.framesDrawn)) > f1 && lum > 20, `brightness ${lum.toFixed(0)}`);
check("…and no card", !(await cardShown()));
await shot("1-restored");

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

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
