// End-to-end "Copy map for a bug report" (`npm run e2e:copy-map [-- <out dir>]`), on a 390×844 phone: a new game,
// some track of the player's own and a marked coin count; ☰ → "Copy map for a bug report" shows "Copied — paste it to
// us" and puts the map on the clipboard; a fresh browser (no storage) opened at `#load=<that text>` (the dev-only load)
// goes straight into Game mode with the same railway (every piece, the added one too) and the same coins.
//
// Usage: npm run e2e:copy-map [-- <out dir>]   (default out: e2e-out/copy-map)
// Starts its own dev server (on 5383, or the next free port).
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/copy-map";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5383, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const errors = [];
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
async function page() {
  const ctx = await b.newContext(phone);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(PAGE).origin });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  return p;
}
const inGame = (p) => p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
/** The railway: its pieces (type and where, rounded), sorted; and the coins. */
const railway = (p) =>
  p.evaluate(() => {
    const L = window.woodrail.layout;
    const pieces = [...L.pieceIds()].map((id) => {
      const q = L.getPiece(id);
      return `${q.type}@${Math.round(q.pose.x)},${Math.round(q.pose.z)}`;
    });
    return { pieces: pieces.sort().join("|"), count: pieces.length, coins: window.woodrail.progress().coins };
  });

try {
  // 1. A new game, a straight of the player's own on a free end, and a coin count to know it by.
  const a = await page();
  await a.goto(PAGE);
  await a.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await a.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await inGame(a);
  await a.keyboard.press("Escape");
  const added = await a.evaluate(() => {
    const w = window.woodrail;
    // (Setup shortcut, not what's tested: a piece put down far off on its own, and the coins marked.)
    const id = w.layout.addPiece("straight-216", { x: 1234, z: -987, heading: 0.5 });
    w.progress().coins = 4321;
    w.invalidate();
    return id;
  });
  const before = await railway(a);
  check("the player's railway has the added piece", added >= 0 && before.pieces.includes("straight-216@1234,-987"), `${before.count} pieces`);

  // 2. ☰ → Copy map for a bug report.
  await a.evaluate(() => document.querySelector('button[aria-label="Menu"]').click());
  await a.waitForTimeout(300);
  const item = await a.evaluate(() => {
    const it = [...document.querySelectorAll(".menu .menu-item")].find((x) => x.textContent === "Copy map for a bug report");
    if (!it) return false;
    it.click();
    return true;
  });
  check("☰ has Copy map for a bug report", item);
  await a.waitForFunction(() => document.querySelector(".toast")?.textContent?.includes("Copied"), null, { timeout: 10000 }).catch(() => {});
  const toast = await a.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
  check("the toast says Copied — paste it to us", toast.includes("Copied — paste it to us"), JSON.stringify(toast));
  await a.screenshot({ path: `${OUT}/1-copied.png` }).catch(() => {});
  const text = await a.evaluate(() => navigator.clipboard.readText());
  check("the clipboard has the map", text.startsWith("woodrail-map:1:"), `${text.length} chars`);

  // 3. Another device: no storage, opened at #load=<text>.
  const c = await page();
  await c.goto(`${PAGE}#load=${encodeURIComponent(text)}`);
  await inGame(c);
  const after = await railway(c);
  check("it opens in Game mode with the same railway", after.pieces === before.pieces, `${after.count} pieces (was ${before.count})`);
  check("and the same coins", after.coins === 4321, `${after.coins}`);
  check("the link's #load= is cleared", await c.evaluate(() => !location.hash.startsWith("#load=")));
  await c.screenshot({ path: `${OUT}/2-loaded.png` }).catch(() => {});
} catch (e) {
  failures++;
  console.log("FAIL", e.message);
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "));
console.log(failures === 0 ? "copy-map: all passed" : `copy-map: ${failures} failed`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
