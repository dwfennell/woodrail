// Pictures of the paused game (`node tools/shots/paused.mjs [<out dir>] [tag]`): a new game at 390×844 and 1440×900,
// paused by the bar's Pause, the whole screen. For judging the paused sign, before and after. Starts its own dev server.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/paused-shots";
const TAG = process.argv[3] ?? "after";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function at(width, height) {
  const phone = width < 700;
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone });
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1500);
  const pause = await p.evaluate(() => {
    const btn = [...document.querySelectorAll(".actions button")].find((x) => /Pause/.test(x.title));
    btn?.click();
    return !!btn;
  });
  await p.waitForTimeout(1500);
  const name = `paused-${TAG}-${width}`;
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 85 });
  console.log(name, "paused:", pause && (await p.evaluate(() => window.woodrail.paused)));
  await p.close();
}
await at(390, 844);
await at(1440, 900);
await b.close();
await server.close();
