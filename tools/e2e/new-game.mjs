// End-to-end the new-game screen (`npm run e2e:new-game [-- <out dir>]`), on a 390×844 phone, by taps: the title's New
// game opens the screen, a page of its own filling the window (Back top left, New game, a Hills row of four chips,
// Gentle picked, Start at the foot, each 44 px or more, nothing drawn while it's open); Mountainous picked and Back:
// no game, the title back; New game again,
// Flat and Start: a Game-mode map with no hills at its start, saved as Flat, its land kept after a reload (Continue);
// ☰ New game asks with the screen (it says the railway starts again), Back returns to the game as it was; then on a
// phone on its side (844×390) the same screen with everything in reach; Mountainous and Start: a map with more hills than
// before, kept after a reload; Sandbox's New map asks too ("Make the map"). Then the starting area of the first game
// (the starter map, one seed) at each step, a picture each: Hilly (the land as it was), Gentle, Flat and Mountainous,
// each with the hills its step says, fewest to most (about 5 min).
//
// Usage: npm run e2e:new-game [-- <out dir>]   (default out: e2e-out/new-game)
// Starts its own dev server (on 5398, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/new-game";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5398, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};

/** A fresh phone (no save: its first game is the starter map). */
async function phone() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  return { ctx, p };
}

/** Tap the first visible element matching `selector` (whose text includes `text`, if given) with a finger. */
async function tap(p, selector, text) {
  const at = await p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden]") && (!text || e.textContent.includes(text)));
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
  if (!at) return false;
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(400);
  return true;
}

const titleUp = (p) => p.waitForFunction(() => window.woodrail?.title?.shown && !window.woodrail.title.root.classList.contains("placing") && document.querySelector(".title-card.mode-game .title-buttons .primary:not([hidden])"), null, { timeout: 240000 });
const inGame = (p, mode = "game") => p.waitForFunction((mode) => window.woodrail?.mode?.() === mode && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), mode, { timeout: 240000 });
const settle = (p) => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
async function skipCoach(p) {
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}

/** The sheet as it stands: open, its title, chips (picked one, sizes), its words, its buttons. */
const sheet = (p) =>
  p.evaluate(() => {
    const s = document.querySelector(".new-game-sheet");
    const box = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const chips = [...s.querySelectorAll(".new-game-step")].map((c) => ({ hills: c.dataset.hills, label: c.textContent.trim(), on: c.getAttribute("aria-checked") === "true", ...box(c) }));
    return {
      open: !s.hidden,
      title: s.querySelector(".new-game-title")?.textContent,
      warn: s.querySelector(".new-game-warn")?.hidden ? "" : s.querySelector(".new-game-warn")?.textContent,
      label: s.querySelector(".new-game-label")?.textContent,
      blurb: s.querySelector(".new-game-blurb")?.textContent,
      chips,
      picked: chips.find((c) => c.on)?.hills,
      start: { text: s.querySelector(".new-game-start")?.textContent, ...(box(s.querySelector(".new-game-start")) ?? {}) },
      back: box(s.querySelector(".new-game-back")),
      card: box(s),
      scrollW: document.documentElement.scrollWidth,
    };
  });

/** The map in play: its hills setting, raised squares (all, and about the start's middle), and a sum of its heights. */
const land = (p) =>
  p.evaluate(() => {
    const l = window.woodrail.landscape;
    const g = l.grid;
    let raised = 0;
    let middle = 0;
    let sum = 0;
    for (let i = 0; i < g.cellCount; i++) {
      const h = g.height[i];
      sum = (sum * 31 + h + i) % 1000000007;
      if (h === 0) continue;
      raised++;
      if (Math.hypot((g.colOf(i) + 0.5) / 31, (g.rowOf(i) + 0.5) / 23) <= 0.5) middle++;
    }
    return { hills: l.hills ?? "(none)", seed: l.seed, starter: l.starter, towns: l.towns.length, raised, middle, sum };
  });

// ---- The sheet from the title, Back, Flat, a reload ----
{
  const { ctx, p } = await phone();
  await p.goto(PAGE);
  await titleUp(p);
  await p.waitForTimeout(800);
  // (What the still title draws by itself in a while, to hold the sheet to.)
  const t0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(1200);
  const titleFrames = (await p.evaluate(() => window.woodrail.framesDrawn)) - t0;
  check("the title's New game is a tap", await tap(p, ".title-card.mode-game .title-buttons .chip", "New game"));
  let s = await sheet(p);
  check("…it opens the new-game sheet, titled New game, with its Hills row", s.open && s.title === "New game" && s.label === "Hills", JSON.stringify({ open: s.open, title: s.title, label: s.label }));
  check("…four steps, flattest to highest: Flat, Gentle, Hilly, Mountainous", s.chips.map((c) => c.label).join(",") === "Flat,Gentle,Hilly,Mountainous", s.chips.map((c) => c.label).join(","));
  check("…Gentle (the default) picked, saying so", s.picked === "gentle" && /Open ground/.test(s.blurb), JSON.stringify({ picked: s.picked, blurb: s.blurb }));
  const small = [...s.chips, s.start, s.back].filter((c) => c.h < 44 || c.w < 44);
  check("…every chip and button 44 px or more each way", small.length === 0, JSON.stringify(small));
  check("…a page of its own: the whole window, Back at the top left, Start at the foot", s.card.l === 0 && s.card.t === 0 && s.card.w === 390 && s.card.h === 844 && s.back.l < 40 && s.back.t < 70 && s.start.b > 844 - 90 && s.start.b <= 844, JSON.stringify({ card: s.card, back: s.back, start: s.start }));
  check("…all on the screen, no sideways scroll", s.scrollW <= 390 && s.chips.every((c) => c.l >= 0 && c.r <= 390 && c.b <= s.start.t), JSON.stringify({ scrollW: s.scrollW }));
  check("…Start says Start", s.start.text === "Start", s.start.text);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/new-game-1-sheet.png` });
  await p.waitForTimeout(500);
  const drawn0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(1200);
  const drawn1 = await p.evaluate(() => window.woodrail.framesDrawn);
  check("…it draws nothing more while it's open than the still title does", drawn1 - drawn0 <= titleFrames + 1, `${drawn1 - drawn0} frames (the title alone: ${titleFrames})`);

  await tap(p, ".new-game-step", "Mountainous");
  s = await sheet(p);
  check("a tap on Mountainous picks it (and only it)", s.picked === "mountains" && s.chips.filter((c) => c.on).length === 1 && /High hills/.test(s.blurb), JSON.stringify({ picked: s.picked, blurb: s.blurb }));
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/new-game-2-mountainous.png` });
  await tap(p, ".new-game-back");
  s = await sheet(p);
  const still = await p.evaluate(() => ({ title: window.woodrail.title.shown }));
  check("Back closes the screen: no game started, the title back", !s.open && still.title, JSON.stringify({ open: s.open, ...still }));

  await tap(p, ".title-card.mode-game .title-buttons .chip", "New game");
  s = await sheet(p);
  check("New game again: the sheet's back on Gentle (Back kept nothing)", s.open && s.picked === "gentle", s.picked);
  await tap(p, ".new-game-step", "Flat");
  check("…Flat picked", (await sheet(p)).picked === "flat");
  await tap(p, ".new-game-start");
  await inGame(p);
  await settle(p);
  await skipCoach(p);
  const flat = await land(p);
  check("Start: a Game-mode game on the starter map, its hills Flat", flat.hills === "flat" && flat.starter && flat.towns >= 2, JSON.stringify(flat));
  check("…no hills at its start", flat.middle === 0, JSON.stringify(flat));
  const goals = await p.evaluate(() => document.querySelector(".goals-panel, .goals")?.textContent ?? "");
  check("…the first goal is up (Join two towns)", /Join two towns/.test(goals), goals.slice(0, 80));
  await p.evaluate(() => window.woodrail.save?.());
  await p.waitForTimeout(1500);
  await p.reload();
  await titleUp(p);
  check("after a reload, Continue (no sheet: it's the same game)", await tap(p, ".title-card.mode-game .title-buttons .chip", "Continue"));
  check("…no sheet opened", !(await sheet(p)).open);
  await inGame(p);
  await settle(p);
  const flatBack = await land(p);
  check("…the same map: Flat, every square's height as it was", flatBack.hills === "flat" && flatBack.sum === flat.sum && flatBack.seed === flat.seed, JSON.stringify({ flat, flatBack }));

  // ---- ☰ New game in play ----
  await skipCoach(p);
  await tap(p, ".hud button[title='Menu'], button[aria-label='Menu']");
  check("☰ New game is a tap", await tap(p, ".menu .menu-item", "New game"));
  s = await sheet(p);
  check("…it asks with the screen: New game, saying the railway starts again", s.open && s.title === "New game" && /start again/.test(s.warn), JSON.stringify({ open: s.open, warn: s.warn }));
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/new-game-3-in-play.png` });
  await tap(p, ".new-game-back");
  const backIn = await p.evaluate(() => ({ open: !document.querySelector(".new-game-sheet").hidden, mode: window.woodrail.mode(), title: window.woodrail.title.shown, hills: window.woodrail.landscape.hills }));
  check("…Back returns to the game as it was (nothing new made)", !backIn.open && backIn.mode === "game" && !backIn.title && backIn.hills === "flat", JSON.stringify(backIn));
  // A phone on its side: the same screen, Back, every chip and Start on it without a scroll.
  await p.setViewportSize({ width: 844, height: 390 });
  await p.waitForTimeout(800);
  await tap(p, ".hud button[title='Menu'], button[aria-label='Menu']");
  await tap(p, ".menu .menu-item", "New game");
  s = await sheet(p);
  const side = [s.back, s.start, ...s.chips].filter((c) => c.t < 0 || c.b > 390 || c.l < 0 || c.r > 844 || c.h < 44);
  check("on its side (844×390): the screen fills it, Back, the chips and Start all on it, 44 px or more, the warning kept", s.open && s.card.w === 844 && s.card.h === 390 && side.length === 0 && /start again/.test(s.warn), JSON.stringify({ card: s.card, side }));
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/new-game-3b-in-play-sideways.png` });
  await tap(p, ".new-game-back");
  await p.setViewportSize({ width: 390, height: 844 });
  await p.waitForTimeout(800);
  await tap(p, ".hud button[title='Menu'], button[aria-label='Menu']");
  await tap(p, ".menu .menu-item", "New game");
  await tap(p, ".new-game-step", "Mountainous");
  await tap(p, ".new-game-start");
  await p.waitForFunction(() => window.woodrail.landscape.hills === "mountains", null, { timeout: 120000 });
  await settle(p);
  const high = await land(p);
  check("…Mountainous and Start: a new map, Mountainous, with far more hills than Flat's", high.hills === "mountains" && high.raised > flat.raised * 4 && high.middle > 0, JSON.stringify(high));
  await p.waitForTimeout(1500);
  await p.reload();
  await titleUp(p);
  await tap(p, ".title-card.mode-game .title-buttons .chip", "Continue");
  await inGame(p);
  const highBack = await land(p);
  check("…kept after a reload", highBack.hills === "mountains" && highBack.sum === high.sum, JSON.stringify(highBack));

  // ---- Sandbox's New map ----
  await p.goto(PAGE);
  await titleUp(p);
  check("Sandbox's New map is a tap", await tap(p, ".title-card.mode-sandbox .title-buttons .chip", "New map"));
  s = await sheet(p);
  check("…it asks too: New map, Make the map, on the last pick (Mountainous)", s.open && s.title === "New map" && s.start.text === "Make the map" && s.picked === "mountains", JSON.stringify({ title: s.title, start: s.start.text, picked: s.picked }));
  await tap(p, ".new-game-step", "Gentle");
  await tap(p, ".new-game-start");
  await inGame(p, "sandbox");
  const sand = await land(p);
  check("…a Sandbox map, Gentle", sand.hills === "gentle" && !sand.starter, JSON.stringify(sand));
  await ctx.close();
}

// ---- The first game's starting area at each step: one seed (the starter map's), a picture each ----
{
  const seen = {};
  for (const [hills, label, file] of [["hilly", "Hilly", "4-start-hilly-as-before"], ["gentle", "Gentle", "5-start-gentle-default"], ["flat", "Flat", "6-start-flat"], ["mountains", "Mountainous", "7-start-mountainous"]]) {
    const { ctx, p } = await phone();
    await p.goto(PAGE);
    await titleUp(p);
    await tap(p, ".title-card.mode-game .title-buttons .chip", "New game");
    await tap(p, ".new-game-step", label);
    await tap(p, ".new-game-start");
    await inGame(p);
    await settle(p);
    await skipCoach(p);
    await settle(p);
    await p.waitForTimeout(1500);
    seen[hills] = await land(p);
    await p.screenshot({ path: `${OUT}/new-game-${file}.png` });
    check(`the first game on ${label}: the starter map, saved as ${label}`, seen[hills].starter && (seen[hills].hills === hills || (hills === "hilly" && seen[hills].hills === "(none)")), JSON.stringify(seen[hills]));
    await ctx.close();
  }
  const r = seen;
  check("…the same seed every time", new Set(Object.values(r).map((x) => x.seed)).size === 1, JSON.stringify(Object.values(r).map((x) => x.seed)));
  check("…hills fewest to most: Flat < Gentle < Hilly < Mountainous", r.flat.raised < r.gentle.raised && r.gentle.raised < r.hilly.raised && r.hilly.raised < r.mountains.raised, JSON.stringify({ flat: r.flat.raised, gentle: r.gentle.raised, hilly: r.hilly.raised, mountains: r.mountains.raised }));
  check("…Gentle (the new default) has well under two thirds of Hilly's hills, and few about the start's middle", r.gentle.raised < r.hilly.raised * 0.66 && r.gentle.middle < r.hilly.middle / 4, JSON.stringify({ gentle: r.gentle, hilly: r.hilly }));
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
