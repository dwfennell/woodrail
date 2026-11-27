// How much of a phone's screen shows the map in Game mode: a fresh game on a 390×844 and a 360×740 phone (touch),
// each point of an 4 px grid asked what's on top there (`elementFromPoint`): the map's canvas, or a part of the HUD.
// Prints the map's share, what covers the rest (by part), and the clear band down the middle (from the last thing
// along the top to the first thing at the bottom). Pictures: <out>/phone-room-<w>x<h>.jpg.
// `node tools/shots/phone-room.mjs [<out dir>] [--sizes=390x844,360x740]` (its own dev server; this machine's GPU).
// (Not what the browser's own bars take: Chrome on an iPhone keeps its address bar and toolbar, about a fifth more.)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) ?? "e2e-out/phone-room";
const sizes = (args.find((a) => a.startsWith("--sizes="))?.slice(8) ?? "390x844,360x740").split(",").map((s) => s.split("x").map(Number));
const tag = args.find((a) => a.startsWith("--tag="))?.slice(6) ?? "";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const gl = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--mute-audio", ...gl] });

/** In the page: the map's share of the screen, what covers the rest, and the clear band down the middle. */
function measure() {
  const canvas = document.querySelector("canvas");
  const parts = new Map();
  let map = 0;
  let all = 0;
  const STEP = 4;
  const partOf = (e) => {
    const p = e.closest(".topbar, .goals, .tray, .research-pill, .toast, .coach, .hud-card, [class*='card'], [class*='sheet']");
    return p ? (typeof p.className === "string" ? p.className.split(" ")[0] : p.tagName) : e.tagName.toLowerCase();
  };
  for (let y = STEP / 2; y < innerHeight; y += STEP)
    for (let x = STEP / 2; x < innerWidth; x += STEP) {
      all++;
      const e = document.elementFromPoint(x, y);
      if (!e || e === canvas) map++;
      else {
        const k = partOf(e);
        parts.set(k, (parts.get(k) ?? 0) + 1);
      }
    }
  // The clear band: down the middle column, the longest run of map.
  let best = [0, 0];
  let start = -1;
  for (let y = 0; y <= innerHeight; y++) {
    const e = y < innerHeight ? document.elementFromPoint(innerWidth / 2, y) : null;
    const clear = y < innerHeight && (!e || e === canvas);
    if (clear && start < 0) start = y;
    if (!clear && start >= 0) {
      if (y - start > best[1] - best[0]) best = [start, y];
      start = -1;
    }
  }
  const box = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.height ? `${Math.round(r.top)}–${Math.round(r.bottom)}` : null;
  };
  return {
    boxes: Object.fromEntries([".actions", ".brand", ".goals", ".goals-head", ".goals-fold", ".goals-show-icon", ".tray", ".tray-head", ".tray .scroller"].map((s) => [s, box(s)])),
    map: map / all,
    parts: [...parts].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, n / all]),
    band: { top: best[0], bottom: best[1], share: (best[1] - best[0]) / innerHeight },
  };
}

for (const [w, h] of sizes) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(server.resolvedUrls.local[0]);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-start", { timeout: 60000 });
  await p.tap('.new-game-sheet:not([hidden]) [data-hills="hilly"]');
  await p.tap(".new-game-sheet:not([hidden]) .new-game-start");
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1500);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const report = async (state) => {
    const m = await p.evaluate(measure);
    console.log(`${w}×${h}${state}: map ${pct(m.map)} of the screen; clear band down the middle ${m.band.top}–${m.band.bottom} px (${pct(m.band.share)})`);
    for (const [k, s] of m.parts) if (s >= 0.005) console.log(`  ${k.padEnd(24)} ${pct(s)}`);
    console.log("  " + Object.entries(m.boxes).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", "));
    await p.screenshot({ path: `${OUT}/phone-room-${w}x${h}${tag ? `-${tag}` : ""}${state ? `-${state.trim()}` : ""}.jpg`, type: "jpeg", quality: 80 });
  };
  await report("");
  // The tray folded to its tabs by its pull, where it has one (a phone; hud.ts `setTrayFolded`).
  if (await p.locator(".tray-fold").isVisible()) {
    await p.tap(".tray-fold");
    await p.waitForTimeout(600);
    await report(" folded");
    await p.tap(".tray-fold");
  }
  await ctx.close();
}
await b.close();
await server.close();
