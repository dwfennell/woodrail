// Design screenshots: the HUD and its cards in Game mode at phone portrait, phone landscape and desktop. Not a test.
// node tools/design/capture.mjs <out dir> [viewports: p,l,d]
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/design";
const WHICH = (process.argv[3] ?? "p,l,d").split(",");
mkdirSync(OUT, { recursive: true });
const VIEWS = {
  p: { name: "portrait", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  l: { name: "landscape", viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  d: { name: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
};
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5401, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

for (const k of WHICH) {
  const v = VIEWS[k];
  const { name, ...opts } = v;
  const ctx = await b.newContext(opts);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  const shot = (n) => p.screenshot({ path: `${OUT}/${name}-${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no ${n}: ${e.message.split("\n")[0]})`));
  const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  const esc = async () => { await p.keyboard.press("Escape"); await p.waitForTimeout(300); await settle(); };
  await p.goto(PAGE);
  await p.waitForTimeout(1500);
  await shot("01-loading");
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.waitForTimeout(800);
  await shot("02-title");
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.waitForTimeout(500);
  await shot("03-help");
  await esc();
  await shot("04-hud");
  // Goals / Journal open
  await p.evaluate(() => document.querySelector(".goals-head")?.click());
  await p.waitForTimeout(500); await settle();
  await shot("05-goals");
  await p.evaluate(() => document.querySelector(".goals-head")?.click());
  await p.waitForTimeout(300);
  // Tray: Trains tab, Industries tab
  for (const [i, label] of [["06", "Trains"], ["07", "Industr"]]) {
    await p.evaluate((label) => [...document.querySelectorAll("button.tab")].find((b) => b.textContent.includes(label))?.click(), label);
    await p.waitForTimeout(800); await settle();
    await shot(`${i}-tray-${label.toLowerCase()}`);
  }
  // Menu
  await p.evaluate(() => window.woodrail.hud.toggleMenu());
  await p.waitForTimeout(400); await settle();
  await shot("08-menu");
  await p.evaluate(() => window.woodrail.hud.toggleMenu());
  await p.waitForTimeout(300);
  // Research board
  await p.evaluate(() => document.querySelector(".research-pill")?.click());
  await p.waitForTimeout(800); await settle();
  await shot("09-research");
  await p.evaluate(() => document.querySelector(".board-head .close")?.click());
  await p.waitForTimeout(400);
  // Town card
  await p.evaluate(() => {
    const d = window.woodrail.economy.allDepots().find((d) => d.role === "town");
    if (d) window.woodrail.interaction.openDepotCard(d.id);
  });
  await p.waitForTimeout(1200); await settle();
  await shot("10-town-card");
  await p.evaluate(() => window.woodrail.hud.hideCards());
  // Industry card
  await p.evaluate(() => {
    const d = window.woodrail.economy.allDepots().find((d) => d.role !== "town");
    if (d) window.woodrail.interaction.openDepotCard(d.id);
  });
  await p.waitForTimeout(1200); await settle();
  await shot("11-industry-card");
  await p.evaluate(() => window.woodrail.hud.hideCards());
  // Toast
  await p.evaluate(() => window.woodrail.hud.toast("You laid your first track! Now put a train on it.", true, 20000));
  await p.waitForTimeout(1200);
  await shot("12-toast");
  await ctx.close();
}
await b.close();
await server.close();
