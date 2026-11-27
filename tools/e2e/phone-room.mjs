// End-to-end: more of the map on a phone (`npm run e2e:phone-room [-- <out dir>]`). A tester on an iPhone, 2026-11-24:
// "On a phone the usable area seems pretty small". Game mode on a 390×844 phone, by taps, headless:
//   fold: the tray's pull (a finger's 44 px) folds it to its tabs and tools, and the map's share of the screen grows by
//         a tenth or more (elementFromPoint on a grid: what a finger reaches); 0 frames drawn while it stands folded;
//         kept after a reload; a tab tapped opens the tray on that tab, and a piece dragged from its shelf onto the map
//         is laid (the payoff: the tray still lays track); with a card open the pull steps aside; the goal bar one line
//         a finger tall, under the top bar.
//   home-screen: on an iPhone (its user agent) ☰ has "Play full screen", which says how to add Woodrail to the home
//         screen; the page's manifest is served (standalone, with its icons); an Android phone's ☰ has no such item.
//   wide: at 1440×900 there's no pull, and the tray is as it was.
// Groups: `-- --list`, E2E_ONLY (scripts/e2e/lib/groups.mjs). Starts its own dev server; Chromium: $CHROMIUM_PATH.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { groups } from "../../scripts/e2e/lib/groups.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "e2e-out/phone-room";
mkdirSync(OUT, { recursive: true });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const suite = groups("phone-room", { results, errors, check });
let server = null;
let PAGE = "";
let b = null;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

async function boot() {
  server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5433, strictPort: false }, logLevel: "error" });
  await server.listen();
  PAGE = server.resolvedUrls.local[0];
  const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--mute-audio", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}

/** A new Game on a fresh page (Hilly, as the other suites), past the camera coach. */
async function newGame(viewport, { touch = true, userAgent } = {}) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch, ...(userAgent ? { userAgent } : {}) });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-start", { timeout: 60000 });
  await p.evaluate(() => {
    document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]').click();
    document.querySelector(".new-game-sheet:not([hidden]) .new-game-start").click();
  });
  await inPlay(p);
  return { ctx, p };
}
async function inPlay(p) {
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  await p.waitForTimeout(400);
}
const settle = (p) => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 75, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
/** The share of the screen a finger reaches the map in (an 8 px grid). */
const mapShare = (p) =>
  p.evaluate(() => {
    const canvas = document.querySelector("canvas");
    let map = 0;
    let all = 0;
    for (let y = 4; y < innerHeight; y += 8)
      for (let x = 4; x < innerWidth; x += 8) {
        all++;
        if (document.elementFromPoint(x, y) === canvas) map++;
      }
    return map / all;
  });
const box = (p, sel) =>
  p.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().height > 0);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
  }, sel);
const shown = (p, sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].some((x) => x.getBoundingClientRect().height > 0), sel);

suite.add("fold", async () => {
  const { ctx, p } = await newGame({ width: 390, height: 844 });
  const pull = await box(p, ".tray-fold");
  check("a phone's tray has its pull", !!pull, JSON.stringify(pull));
  // (Its reach: a finger 20 px above the drawn tab still lands on it, and so a finger's 44 px tall.)
  const reach = await p.evaluate(({ x, top }) => [document.elementFromPoint(x, top - 24)?.closest(".tray-fold") !== null, document.elementFromPoint(x, top + 16)?.closest(".tray-fold") !== null], pull);
  check("the pull is a finger's 44 px to tap", reach[0] && reach[1], JSON.stringify(reach));
  const goal = await box(p, ".goals");
  const bar = await box(p, ".topbar .actions");
  const now = await p.evaluate(() => { const n = document.querySelector(".goals-now"); return { lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)) }; });
  check("the goal bar is one line a finger tall, just under the top bar", goal && goal.h <= 46 && goal.top - bar.bottom <= 8 && now.lines === 1, JSON.stringify({ goal, barBottom: bar?.bottom, now }));
  const open = await mapShare(p);
  await shot(p, "fold-open");

  await p.touchscreen.tap(pull.x, pull.y);
  await p.waitForTimeout(500);
  const folded = await p.evaluate(() => ({ folded: document.querySelector(".tray").classList.contains("folded"), shelf: document.querySelector(".tray .scroller").getBoundingClientRect().height, room: getComputedStyle(document.documentElement).getPropertyValue("--tray-room") }));
  const share = await mapShare(p);
  check("a tap on the pull folds the tray to its tabs (no shelf)", folded.folded && folded.shelf === 0, JSON.stringify(folded));
  check("folded, the map's share of the screen grows by a tenth or more", share - open >= 0.1, `${Math.round(open * 100)}% → ${Math.round(share * 100)}%`);
  check("the tabs and Draw are still there", (await shown(p, ".tray .tab")) && (await shown(p, ".tray .tray-draw")));
  await shot(p, "fold-folded");
  await settle(p);
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(3000);
  const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
  check("folded and still: 0 frames drawn in 3 s", f1 - f0 === 0, `${f1 - f0} frames`);

  // Kept after a reload: the game comes back with the tray folded.
  await p.reload();
  // (Back on the title screen, or straight into play: whichever the game does, Continue where it asks.)
  await p.waitForFunction(() => window.woodrail?.title?.shown || !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  await p.waitForTimeout(1500);
  if (await p.evaluate(() => window.woodrail.title.shown)) await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await shot(p, "fold-reloaded");
  await inPlay(p);
  check("kept after a reload: the tray still folded", await p.evaluate(() => document.querySelector(".tray").classList.contains("folded")));

  // A tab tapped opens it, on that tab; then a straight from its shelf dragged onto the map is laid.
  const track = await p.evaluate(() => { const t = document.querySelector('.tray .tab[data-tab="track"]'); const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.touchscreen.tap(track.x, track.y);
  await p.waitForTimeout(600);
  const reopened = await p.evaluate(() => ({ folded: document.querySelector(".tray").classList.contains("folded"), shelf: document.querySelector(".tray .scroller").getBoundingClientRect().height, active: document.querySelector(".tray .tab.active")?.dataset.tab }));
  check("a tab tapped opens the folded tray, on that tab", !reopened.folded && reopened.shelf > 40 && reopened.active === "track", JSON.stringify(reopened));
  await p.evaluate(() => document.querySelector(".tray .scroller .tray-back")?.click());
  const tile = await p.evaluate(() => {
    const t = [...document.querySelectorAll(".tray .scroller .tray-item")].find((e) => e.querySelector(".label")?.textContent.trim() === "Medium");
    if (!t) return null;
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  check("the Medium straight is on the Track shelf", !!tile);
  if (tile) {
    const before = await p.evaluate(() => window.woodrail.layout.pieceCount);
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
    // (Open grass right of the first town, clear of its station: dropped by the station it snaps there and is refused.)
    const to = { x: 320, y: 480 };
    await touch("touchStart", tile.x, tile.y);
    for (let k = 1; k <= 20; k++) {
      await touch("touchMove", tile.x + ((to.x - tile.x) * k) / 20, tile.y + ((to.y - tile.y) * k) / 20);
      await p.waitForTimeout(30);
    }
    await p.waitForTimeout(300);
    await touch("touchEnd", 0, 0);
    await p.waitForTimeout(1000);
    const after = await p.evaluate(() => window.woodrail.layout.pieceCount);
    check("the tray still lays track: a straight dragged from its shelf onto the map is laid", after === before + 1, `${before} → ${after}`);
  }
  // A town's card over the tray: the pull steps aside (its reach is over the card's foot, where its buttons are).
  // (Opened as a tap on its station does: the e2e for that tap is station-upgrade's.)
  const town = await p.evaluate(() => window.woodrail.economy.allDepots().find((d) => d.role === "town")?.id);
  await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), town);
  await p.waitForFunction(() => { const c = document.querySelector(".depot-card"); return c && !c.hidden; }, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(400);
  const withCard = await p.evaluate(() => ({ card: !document.querySelector(".depot-card").hidden, pull: document.querySelector(".tray-fold").getBoundingClientRect().height }));
  check("with a card open over the tray, the pull steps aside", withCard.card && withCard.pull === 0, JSON.stringify(withCard));
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.querySelector(".depot-card").hidden, null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(400);
  // Folded again, an open card stands on the folded tray, not where the open one ended.
  await p.touchscreen.tap(pull.x, (await box(p, ".tray-fold")).y);
  await p.waitForTimeout(500);
  const room = await p.evaluate(() => ({ room: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tray-room")), tray: innerHeight - document.querySelector(".tray").getBoundingClientRect().top }));
  check("folded, the cards' footing (--tray-room) is the folded tray's", Math.abs(room.room - room.tray) <= 2 && room.tray < 80, JSON.stringify(room));
  // …at once, not a frame on: opened and folded again in one go, the footing follows each (on CI's busy software GL
  // the next frame came after the check above, 2026-11-27: room 159 over a 59 px tray, every run).
  const atOnce = await p.evaluate(() => {
    const pull = document.querySelector(".tray-fold");
    const read = () => ({ room: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--tray-room")), tray: Math.round(innerHeight - document.querySelector(".tray").getBoundingClientRect().top) });
    pull.click();
    const opened = read();
    pull.click();
    return { opened, folded: read() };
  });
  check("…and at once, with no frame between: opened, then folded again", atOnce.opened.room === atOnce.opened.tray && atOnce.opened.tray > 100 && atOnce.folded.room === atOnce.folded.tray && atOnce.folded.tray < 80, JSON.stringify(atOnce));
  await ctx.close();
});

suite.add("home-screen", async () => {
  const { ctx, p } = await newGame({ width: 390, height: 844 }, { userAgent: IPHONE });
  await p.evaluate(() => document.querySelector(".topbar .actions button[aria-label='Menu']").click());
  await p.waitForTimeout(400);
  const item = await box(p, ".menu .home-screen-item");
  check("on an iPhone, ☰ offers Play full screen (44 px)", !!item && item.h >= 44, JSON.stringify(item));
  if (item) {
    await p.touchscreen.tap(item.x, item.y);
    await p.waitForTimeout(800);
    const toast = await p.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
    check("…and says how: Share, then Add to Home Screen", toast.includes("Add to Home Screen"), toast);
    await shot(p, "home-screen-toast");
  }
  const manifest = await p.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.href;
    if (!href) return null;
    const m = await (await fetch(href)).json();
    const icons = await Promise.all(m.icons.map(async (i) => (await fetch(new URL(i.src, href))).status));
    const touch = await fetch(document.querySelector('link[rel="apple-touch-icon"]').href);
    return { display: m.display, icons, touchIcon: touch.status, capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content };
  });
  check("the page's manifest opens it standalone, its icons served", manifest?.display === "standalone" && manifest.icons.every((s) => s === 200) && manifest.touchIcon === 200 && manifest.capable === "yes", JSON.stringify(manifest));
  await ctx.close();

  const android = await newGame({ width: 412, height: 915 }, { userAgent: ANDROID });
  check("an Android phone's ☰ has no Play full screen (it has Fullscreen)", !(await android.p.evaluate(() => !document.querySelector(".menu .home-screen-item").hidden)));
  await android.ctx.close();
});

suite.add("wide", async () => {
  const { ctx, p } = await newGame({ width: 1440, height: 900 }, { touch: false });
  check("a big screen's tray has no pull", !(await shown(p, ".tray-fold")));
  const shelf = await p.evaluate(() => document.querySelector(".tray .scroller").getBoundingClientRect().height);
  check("…and its shelf shows", shelf > 60, `${shelf}`);
  await ctx.close();
});

await suite.run(async (g, go) => {
  if (!b) await boot();
  await go();
});
if (b) {
  console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await b.close();
  await server.close();
}
suite.finish();
