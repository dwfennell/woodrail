#!/usr/bin/env node
/**
 * The wiki's pictures (src/wiki/pictures/): each industry's, engine's and wagon's tray picture, drawn by the game
 * itself, so they look as they do on the tray. After a build:
 *
 *   npm run build && npm run wiki:pictures
 *
 * Opens the build (vite preview) in headless Chromium, starts a new Game (whose industry models draw their pictures),
 * asks the tray for the rest as a shelf does when first shown (props, kits) and writes each as WebP. Run it again when
 * a model changes; `src/wiki/wiki.test.ts` fails when a page has no picture.
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { createServer, preview } from "vite";

const OUT = resolve("src/wiki/pictures");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
if (!existsSync("dist/index.html")) {
  console.error("No dist/: run `npm run build` first.");
  process.exit(2);
}

// What to draw, from the wiki's data (loaded as `npm run wiki` loads it).
const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true, include: [] } });
let wanted;
try {
  wanted = (await vite.ssrLoadModule("/src/wiki/data.ts")).wikiPictureItems();
} finally {
  await vite.close();
}

const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: "warn" });
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(server.resolvedUrls.local[0]);
  // Game mode: its industries' models are fetched only there, and their pictures drawn once they're in.
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-game button.primary") !== null, null, { timeout: 240000 });
  await p.locator(".title-card.mode-game button", { hasText: "New game" }).click();
  // New game opens its own page now: Start there, as it's set.
  await p.locator(".new-game-sheet:not([hidden]) .new-game-start").click();
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  await p.evaluate(() => window.woodrail.trayThumbnailsSaved());
  // The rest asked for as a shelf asks when it's first shown (the HUD's `needThumbnails` handler).
  await p.evaluate((items) => window.woodrail.hud.handlers.needThumbnails(items), wanted.map((w) => w.item));
  const keys = wanted.map((w) => w.key);
  await p.waitForFunction((keys) => keys.every((k) => window.woodrail.hud.thumbs.has(k)), keys, { timeout: Number(process.env.WAIT_MS ?? 300000), polling: 500 }).catch(async (e) => {
    const missing = await p.evaluate((keys) => keys.filter((k) => !window.woodrail.hud.thumbs.has(k)), keys);
    throw new Error(`pictures not drawn: ${missing.join(", ")}`, { cause: e });
  });
  const urls = await p.evaluate((keys) => keys.map((k) => window.woodrail.hud.thumbs.get(k)), keys);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  wanted.forEach((w, i) => {
    const m = /^data:image\/webp;base64,(.+)$/.exec(urls[i] ?? "");
    if (!m) throw new Error(`${w.key}: not a WebP picture`);
    writeFileSync(join(OUT, w.file), Buffer.from(m[1], "base64"));
  });
  console.log(`wrote ${readdirSync(OUT).length} pictures to ${OUT}`);
  if (errors.length) console.warn(`page errors:\n${errors.join("\n")}`);
} finally {
  await b.close();
  await new Promise((r) => server.httpServer.close(r));
}
