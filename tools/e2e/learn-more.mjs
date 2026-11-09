// End-to-end: "Learn more" (src/ui/explainers.ts, explainer-sheet.ts), Game mode on a 390×844 phone with touch, by taps.
// Setup learns Switches and Routes (named shortcut: Signals come with them; not what's tested). Then:
//   1. The Signals shelf opened and the Signal tapped: the Signal tool is on, the place card says what it is, with a
//      Learn more at least 44 px tall.
//   2. Learn more tapped: the Signals sheet, its four sections each with a picture, on the screen; 0 frames drawn while
//      it's open (nothing moves).
//   3. "More about routes" opens Routes; Back goes back to Signals; ✕ closes it: the Signal tool still on, its card up.
//      Learn more again (the place card put by under it) and Back closes it too, still placing, the card back; a tap
//      beside the sheet closes it and places nothing; a tap on the track then puts a signal down.
//   4. A signal's card (long press on its post): Learn more about signals opens the sheet; ✕ closes it, the card stays.
//   5. The forest's card (opened as a tap on it would): Help (44 px) opens the forest's help page, which names what the
//      game's own recipe says it makes (logs); a tap on Logs opens its page (made at the forest, carried in a wagon);
//      Back goes back; 0 frames drawn while open; ✕ closes it and the card stays. Nothing opens a new tab.
//   6. ☰ Help topics: the front page; Industries, then Sawmill: it names logs in and planks out, from the recipe.
//   7. The research board on Mills (opened as a locked tile's note would): the ticket's Learn more (44 px) opens the
//      Mills page over the board, naming what the row unlocks (the mill, the van); Back closes it, the board still up.
// Pictures: learn-more-details.jpg, learn-more-sheet.jpg (and -sheet-2, the rest scrolled), learn-more-card.jpg,
// help-industry.jpg, help-good.jpg, help-index.jpg, help-sawmill.jpg, help-research.jpg.
//
// Usage: npm run e2e:learn-more [-- <out dir>]   (default out: e2e-out/learn-more)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";
import { quiet } from "../../scripts/e2e/lib/shot.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/learn-more";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks and industries held still: this counts idle frames.)
pinClocksIn(b);
stillIndustriesIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  window.__allClicks = 0;
  window.addEventListener("click", () => window.__allClicks++, { capture: true });
});
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapAt = (x, y) => tapped(() => p.touchscreen.tap(x, y));
/** The middle of the first element matching `sel` that's on the screen, or null. */
const centre = (sel) =>
  p.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);
const tapSel = async (sel) => {
  const at = await centre(sel);
  if (at) await tapAt(...at);
  return !!at;
};
const box = (sel) =>
  p.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    // (Its size as laid out, not as drawn: a card popping in is scaled a moment.)
    return { x: r.x, y: r.y, w: e.offsetWidth, h: e.offsetHeight, right: r.right, bottom: r.bottom };
  }, sel);
const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
const glideTo = async (v, dist = 900) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2 }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
const state = () =>
  p.evaluate(() => ({
    tool: window.woodrail.interaction.signalToolOn,
    card: window.woodrail.hud.placeCardShown,
    sheet: window.woodrail.hud.explainerShown,
  }));
/** The sheet showing `id` (or closed: null), waited for a moment (it's loaded the first time it's opened). */
const sheetIs = (id) => p.waitForFunction((id) => window.woodrail.hud.explainerShown === id, id, { timeout: 15000 }).catch(() => {});
/** The open sheet done popping in: no animation running on it or its scrim, and its box the same two frames running. */
const sheetSettled = () =>
  p
    .waitForFunction(
      () => {
        const e = document.querySelector(".explainer-sheet:not([hidden])");
        if (!e) return true;
        const r = e.getBoundingClientRect();
        const k = `${r.x.toFixed(1)},${r.y.toFixed(1)},${r.width.toFixed(1)}`;
        const busy = document.getAnimations().some((a) => a.playState === "running" && /explainer/.test(a.effect?.target?.className ?? ""));
        const same = window.__sheetBox === k;
        window.__sheetBox = k;
        return !busy && same;
      },
      null,
      { timeout: 10000, polling: "raf" },
    )
    .catch(() => {});
/**
 * A tap on the sheet's `sel` (✕) once it has settled, tapped again if the sheet is still up: a tap that came while it
 * was popping in (the ✕ moving under the finger) was missed now and then.
 */
const tapToClose = async (sel) => {
  for (let i = 0; i < 3; i++) {
    await sheetSettled();
    await tapSel(sel);
    await sheetIs(null);
    if ((await state()).sheet === null) return;
  }
};
const idleFrames = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    const n0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    return w.framesDrawn - n0;
  });

// A new game.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// Setup (not what's tested): Switches and Routes learned (Signals with them), and a line from the first town's
// station to the forest by the game's own pathfinder, with a joint between two plain pieces in the middle.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef, pieceOfRef } = await import("/src/track/layout.ts");
  const { jointPose } = await import("/src/game/signal-place.ts");
  const w = window.woodrail;
  for (const r of ["switches", "routes"]) w.learn(r);
  const station = w.world.stations.get(w.world.landscape.towns[0].id);
  const forest = [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === "depot-forest");
  const before = new Set(w.layout.pieceIds());
  let line = null;
  for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
    const r = play(w.world.layout, w.editor(), connectorRef(station, i), connectorRef(forest, j), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 });
    if (r.ok) {
      line = [...w.layout.pieceIds()].filter((id) => !before.has(id));
      break;
    }
  }
  if (!line) return { error: "no line to the forest" };
  const plain = (id) => /^(straight|curve)/.test(w.layout.getPiece(id).type);
  const pairs = [];
  for (const a of line) {
    if (!plain(a)) continue;
    for (const c of [0, 1]) {
      const o = w.layout.joinedConnector(connectorRef(a, c));
      if (o !== -1 && line.includes(pieceOfRef(o)) && plain(pieceOfRef(o))) pairs.push(connectorRef(a, c));
    }
  }
  if (pairs.length === 0) return { error: "no joint between plain pieces" };
  const at = pairs[Math.floor(pairs.length / 2)];
  w.invalidate();
  return { at, joint: jointPose(w.layout, at) };
});
check("setup: a line from the station to the forest", !setup.error, JSON.stringify(setup));

// ---- 1. The Signal tapped on the tray: its card, with Learn more ----------------------------------------------------
await glideTo(setup.joint, 800);
await settle();
const shelf = await p.evaluate(() => {
  const g = [...document.querySelectorAll(".scroller .tray-group")].find((x) => x.querySelector(".label")?.textContent === "Signals");
  if (!g) return null;
  g.scrollIntoView({ inline: "center" });
  const r = g.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
});
check("1. the Signals shelf is on the tray", !!shelf);
if (shelf) await tapAt(...shelf);
await p.evaluate(() => document.querySelector('.scroller .tray-item[data-key="signal"]')?.scrollIntoView({ inline: "center" }));
await frames();
check("1. the Signal tile is on its shelf", await tapSel('.scroller .tray-item[data-key="signal"]'));
await p.waitForFunction(() => window.woodrail.hud.placeCardShown === "signal", null, { timeout: 10000 }).catch(() => {});
let s = await state();
check("1. a tap on the Signal: the Signal tool on, its place card up", s.tool && s.card === "signal", JSON.stringify(s));
const link = await box(".place-card .learn-more");
check("1. the card has Learn more, a 44 px tap target", !!link && link.h >= 44 && link.w >= 44, JSON.stringify(link));
const cardText = await p.evaluate(() => document.querySelector(".place-card")?.textContent ?? "");
check("1. …under the Signal's name and line", /Signal/.test(cardText) && /joint/.test(cardText), cardText);
await quiet(p, 30000);
await shot("learn-more-details");

// ---- 2. Learn more: the Signals sheet --------------------------------------------------------------------------------
await tapSel(".place-card .learn-more");
await sheetIs("signals");
s = await state();
check("2. Learn more opens the Signals sheet", s.sheet === "signals", JSON.stringify(s));
// (Measured once it has popped in, not mid-way.)
await p.waitForTimeout(300);
const sheet = await p.evaluate(() => {
  const r = document.querySelector(".explainer-sheet");
  const b = r?.getBoundingClientRect();
  return {
    title: r?.querySelector(".card-title")?.textContent,
    sections: r?.querySelectorAll(".explainer-section").length ?? 0,
    pictures: [...(r?.querySelectorAll(".explainer-section svg") ?? [])].filter((x) => x.getBoundingClientRect().width > 200).length,
    headings: [...(r?.querySelectorAll(".explainer-heading") ?? [])].map((h) => h.textContent),
    inView: !!b && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight,
    close: (() => {
      const x = r?.querySelector(".explainer-x");
      return x ? Math.min(x.offsetWidth, x.offsetHeight) : 0;
    })(),
  };
});
check("2. its title, four sections, each with its picture drawn", sheet.title === "Signals" && sheet.sections === 4 && sheet.pictures === 4, JSON.stringify(sheet));
check("2. it fits the screen, ✕ a 44 px target", sheet.inView && sheet.close >= 44, JSON.stringify(sheet));
await shot("learn-more-sheet");
await p.evaluate(() => document.querySelector(".explainer-sheet").scrollTo(0, 99999));
await frames();
await shot("learn-more-sheet-2");
const idle = await idleFrames();
check("2. 0 frames drawn while the sheet is open", idle === 0, `${idle} frames`);

// ---- 3. Routes, Back, ✕: still placing --------------------------------------------------------------------------------
await tapSel('.explainer-sheet .explainer-see[data-explainer="routes"]');
await sheetIs("routes");
s = await state();
check("3. More about routes opens Routes", s.sheet === "routes", JSON.stringify(s));
await tapSel(".explainer-sheet .explainer-back");
s = await state();
check("3. Back goes back to Signals", s.sheet === "signals", JSON.stringify(s));
await tapToClose(".explainer-sheet .explainer-x");
s = await state();
check("3. ✕ closes it: the Signal tool still on, its card still up", s.sheet === null && s.tool && s.card === "signal", JSON.stringify(s));
await tapSel(".place-card .learn-more");
await sheetIs("signals");
s = await state();
const hiddenCard = await p.evaluate(() => document.querySelector(".place-card").hidden);
check("3. Learn more again opens it, the place card put by under it", s.sheet === "signals" && hiddenCard, JSON.stringify({ ...s, hiddenCard }));
await tapSel(".explainer-sheet .explainer-back");
s = await state();
const backCard = await p.evaluate(() => !document.querySelector(".place-card").hidden);
check("3. Back closes it, still placing, the place card back", s.sheet === null && s.tool && backCard, JSON.stringify({ ...s, backCard }));
// A tap on the dimmed game beside the sheet closes it too, and puts nothing down.
const before3 = await p.evaluate(() => [...window.woodrail.layout.signals()].length);
await tapSel(".place-card .learn-more");
await sheetIs("signals");
await tapAt(3, 422);
s = await state();
const after3 = await p.evaluate(() => [...window.woodrail.layout.signals()].length);
check("3. a tap beside the sheet closes it, nothing placed by it", s.sheet === null && s.tool && after3 === before3, JSON.stringify({ ...s, before3, after3 }));
// And it places: a tap on the track a little short of the joint, the way trains go.
const marks0 = await p.evaluate(() => [...window.woodrail.layout.signals()].length);
const [tx, ty] = await screenOf({ x: setup.joint.x - Math.cos(setup.joint.heading) * 30, y: setup.joint.y, z: setup.joint.z - Math.sin(setup.joint.heading) * 30 });
await tapAt(tx, ty);
await settle();
const marks1 = await p.evaluate(() => [...window.woodrail.layout.signals()].map((m) => m.id));
check("3. …and a tap on the track puts a signal down", marks1.length > marks0, `${marks0} → ${marks1.length}`);

// ---- 4. A signal's card: Learn more about signals ----------------------------------------------------------------------
// (The Signal tool put away by a tap on its tile, then a long press on the post opens its card.)
await tapSel('.scroller .tray-item[data-key="signal"]');
s = await state();
check("4. the Signal tool put away", !s.tool, JSON.stringify(s));
if (marks1.length) {
  // (Its card opened by the game's own selection, as the long press does: e2e:signals tests the press itself.)
  await p.evaluate((id) => window.woodrail.interaction.selectMark(id), marks1[marks1.length - 1]);
  await frames();
  await p.waitForTimeout(400);
  const cardLink = await box(".piece-card .card-learn");
  check("4. a signal's card has Learn more about signals, 44 px tall", !!cardLink && cardLink.h >= 44, JSON.stringify(cardLink));
  await shot("learn-more-card");
  await tapSel(".piece-card .card-learn");
  await sheetIs("signals");
  s = await state();
  check("4. …it opens the Signals sheet", s.sheet === "signals", JSON.stringify(s));
  await tapToClose(".explainer-sheet .explainer-x");
  const still = await p.evaluate(() => !document.querySelector(".piece-card").hidden);
  s = await state();
  check("4. ✕ closes it, the signal's card still open", s.sheet === null && still, JSON.stringify({ ...s, still }));
}

// ---- 5. An industry card's Help: the forest's page, from the game's own recipe ----------------------------------------
await p.evaluate(() => {
  // (Any new tab the help might open, counted: none should.)
  window.__opened = 0;
  const open = window.open;
  window.open = (...a) => (window.__opened++, open.apply(window, a));
});
const forest = await p.evaluate(async () => {
  const w = window.woodrail;
  const { RECIPES } = await import("/src/economy/economy.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const id = [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === "depot-forest");
  // (Its card opened as a tap on it does: e2e:touch and others test the tap itself.)
  w.interaction.openDepotCard(w.economy.depotAtPiece(id).id);
  return { makes: RECIPES.forest.gives.map((k) => CARGO[k].label), takes: RECIPES.forest.takes.map((k) => CARGO[k].label) };
}).catch((e) => ({ error: e.message }));
await frames();
await p.waitForTimeout(400);
const helpBtn = await box(".depot-card .depot-learn");
check("5. the forest's card has Help, a 44 px target", !!helpBtn && helpBtn.h >= 44 && helpBtn.w >= 44, JSON.stringify({ helpBtn, forest }));
await tapSel(".depot-card .depot-learn");
await sheetIs("industries/forest");
s = await state();
const helpText = () => p.evaluate(() => document.querySelector(".explainer-sheet")?.innerText ?? "");
let text = await helpText();
// (The forest's piece is the Harvester's: a forest yard, the tray's name for it.)
check("5. Help opens the forest's page in the sheet", s.sheet === "industries/forest" && /^Harvester/.test(text), JSON.stringify(s));
check("5. …naming what the forest really makes (from its recipe)", !!forest.makes?.length && forest.makes.every((g) => text.includes(g)) && /Goods out/.test(text), JSON.stringify({ forest, text: text.slice(0, 300) }));
const targets = await p.evaluate(() => [...document.querySelectorAll(".explainer-sheet button")].filter((b) => b.offsetWidth > 0).map((b) => [b.textContent.slice(0, 20), b.offsetHeight]).filter(([, h]) => h < 44));
check("5. every button on the page is a 44 px target", targets.length === 0, JSON.stringify(targets));
await sheetSettled();
await shot("help-industry");
const idle5 = await idleFrames();
check("5. 0 frames drawn while it's open", idle5 === 0, `${idle5} frames`);
await tapSel('.explainer-sheet [data-help="goods/log"]');
await sheetIs("goods/log");
text = await helpText();
check("5. a tap on Logs opens its page: made at the forest yard, carried in a wagon", /Made at\s+Harvester/.test(text) && /Carried in\s+Flatbed wagon/.test(text), text.slice(0, 300));
await shot("help-good");
await tapSel(".explainer-sheet .explainer-back");
s = await state();
check("5. Back goes back to the forest", s.sheet === "industries/forest", JSON.stringify(s));
await tapToClose(".explainer-sheet .explainer-x");
const depotStill = await p.evaluate(() => !document.querySelector(".depot-card").hidden);
check("5. ✕ closes it, the forest's card still open", (await state()).sheet === null && depotStill);
await p.keyboard.press("Escape");
await frames();

// ---- 6. ☰ Help topics: the front page, Industries, the sawmill ----------------------------------------------------------
await tapSel('button[aria-label="Menu"]');
await frames();
const topics = await p.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].find((b) => b.textContent === "Help topics" && b.offsetWidth > 0));
check("6. ☰ has Help topics (and no wiki link out)", topics && (await p.evaluate(() => ![...document.querySelectorAll(".menu .menu-item")].some((b) => /wiki/i.test(b.textContent)))));
await tapped(() => p.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].find((b) => b.textContent === "Help topics")?.click()));
await sheetIs("help");
text = await helpText();
check("6. Help topics opens the front page: How things work, and every section", /Signals/.test(text) && /Industries/.test(text) && /Research/.test(text) && /Goods/.test(text) && /Engines/.test(text), text.slice(0, 300));
await sheetSettled();
await shot("help-index");
await tapSel('.explainer-sheet [data-help="industries"]');
await sheetIs("industries");
await p.evaluate(() => document.querySelector('.explainer-sheet [data-help="industries/sawmill"]')?.scrollIntoView({ block: "center" }));
await frames();
await tapSel('.explainer-sheet [data-help="industries/sawmill"]');
await sheetIs("industries/sawmill");
const saw = await p.evaluate(async () => {
  const { RECIPES } = await import("/src/economy/economy.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  return { takes: RECIPES.sawmill.takes.map((k) => CARGO[k].label), gives: RECIPES.sawmill.gives.map((k) => CARGO[k].label) };
});
text = await helpText();
check("6. the Sawmill's page names its real goods in and out", saw.takes.every((g) => text.includes(g)) && saw.gives.every((g) => text.includes(g)) && /Goods in/.test(text) && /Goods out/.test(text), JSON.stringify({ saw, text: text.slice(0, 300) }));
await shot("help-sawmill");
await tapToClose(".explainer-sheet .explainer-x");

// ---- 7. A research ticket's Learn more: the row's page over the board ------------------------------------------------
// (The board opened on Mills as a locked tile's note opens it: e2e:locked and e2e:research test those taps.)
await p.evaluate(() => window.woodrail.hud.handlers.showResearch?.("mills"));
await p.waitForFunction(() => !!document.querySelector(".board-open"), null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(400);
// (On a phone the ticket's facts are folded: opened as a tap on their line does.)
await p.evaluate(() => {
  const d = document.querySelector(".board-sheet details.bp-more");
  if (d && !d.open) d.querySelector("summary")?.click();
});
await frames();
const learnBtn = await box('.board-sheet .bp-learn[data-id="research/mills"]');
check("7. the Mills ticket has Learn more, a 44 px target", !!learnBtn && learnBtn.h >= 44, JSON.stringify(learnBtn));
await tapSel('.board-sheet .bp-learn[data-id="research/mills"]');
await sheetIs("research/mills");
const mills = await p.evaluate(async () => {
  const { unlocksOf } = await import("/src/game/tech.ts");
  const { THING_RULES } = await import("/src/game/things.ts");
  return unlocksOf("mills").map((t) => THING_RULES[t].label);
});
text = await helpText();
check("7. Learn more opens the Mills page over the board", (await state()).sheet === "research/mills" && /Mills/.test(text));
check("7. …naming what Mills really unlocks", mills.length > 0 && mills.every((m) => text.toLowerCase().includes(m.toLowerCase())) && /What it unlocks/.test(text), JSON.stringify({ mills, text: text.slice(0, 400) }));
await sheetSettled();
await shot("help-research");
await tapSel(".explainer-sheet .explainer-back");
const boardStill = await p.evaluate(() => !!document.querySelector(".board-open"));
const s7 = await state();
check("7. Back closes it, the board still up", s7.sheet === null && boardStill, JSON.stringify({ ...s7, boardStill }));
const opened = await p.evaluate(() => window.__opened);
check("5–7. nothing opened a new tab", opened === 0, `${opened}`);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
