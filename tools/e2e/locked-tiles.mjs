// End-to-end: the polish's leftovers (`npm run e2e:locked [-- <out dir>]`), Game mode on phones with touch, headless.
// 1. 360×640: every Game tab's row shows whole beside the tools (Draw, Clear, Turn, Flip), no sideways scroll, with the
//    Roads tab too; each tab still a finger's height. A tab tapped there opens.
// 2. 360×640: a tap on the locked Switch tile says how to unlock it ("Research Switches to unlock") in a note over it,
//    picks nothing up and makes nothing; its "Show in Research" opens the Research picker on Switches, whose Research
//    button then starts it (the payoff: the player's next step, by taps). A tap elsewhere puts the note away. Hover with
//    a mouse (1440×900) shows the same words in the tooltip.
// 3. 844×390 (a phone on its side): a town's card in two columns, its ✕ at the top right, its ledger whole (no scroll),
//    and its Automatic switch works by a tap.
//
// Setup shortcuts (named, not what's under test): Roads learned by `woodrail.learn` (the game's own learned()), for the tabs' fit only.
// Starts its own dev server (on 5431, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/locked-tiles";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5431, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const errors = [];

async function newGame(viewport, touch = true) {
  const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  return { ctx, p };
}
/**
 * Wait (about a minute at most) for the page to go quiet: the game settled and no long task on the main thread for
 * 1.5 s. Just after a game opens, the tray's pictures are still being made (stalls of seconds on software GL) and the
 * tray's items drawn again: a tile hovered then is taken away under the mouse, and its tip never shows (tooltip.ts:
 * not for an item no longer on the page). A player's next move of the mouse would show it; the check waits instead.
 */
const quiet = (p) =>
  p.evaluate(async () => {
    await Promise.race([window.woodrail.settled?.(), new Promise((r) => setTimeout(r, 30000))]);
    await new Promise((res) => {
      let last = performance.now();
      const obs = new PerformanceObserver((l) => {
        if (l.getEntries().length) last = performance.now();
      });
      obs.observe({ type: "longtask" });
      const t0 = performance.now();
      const look = () => {
        if (performance.now() - last >= 1500 || performance.now() - t0 > 30000) {
          obs.disconnect();
          res();
        } else setTimeout(look, 250);
      };
      setTimeout(look, 250);
    });
  });
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
/** The middle of the first visible element matching `selector` whose text includes `text`. */
const centre = (p, selector, text = "") =>
  p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.includes(text) && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
const tapOn = async (p, selector, text = "") => {
  const c = await centre(p, selector, text);
  if (!c) return false;
  await p.touchscreen.tap(c.x, c.y);
  await p.waitForTimeout(600);
  return true;
};
const tabRow = (p) =>
  p.evaluate(() => {
    const t = document.querySelector(".tray .tabs");
    const tabs = [...t.querySelectorAll(".tab")].map((x) => { const r = x.getBoundingClientRect(); return { id: x.dataset.tab, w: Math.round(r.width), h: Math.round(r.height), left: r.left, right: r.right }; });
    const box = t.getBoundingClientRect();
    return { scroll: t.scrollWidth, client: t.clientWidth, cls: t.className, tabs, inside: tabs.every((x) => x.left >= box.left - 1 && x.right <= box.right + 1) };
  });

// ---- 1. the tabs fit at 360 ----------------------------------------------------------------------------------
{
  const { ctx, p } = await newGame({ width: 360, height: 640 });
  for (const tab of ["track", "trains", "industries"]) {
    await tapOn(p, `.tray .tab[data-tab=${tab}]`);
    const row = await tabRow(p);
    check(`360: ${tab} open, the tab row shows whole (no sideways scroll)`, row.scroll <= row.client + 1 && row.inside, JSON.stringify(row));
    check(`360: ${tab}: each tab a finger's height and at least 40 wide`, row.tabs.every((x) => x.h >= 44 && x.w >= 40), JSON.stringify(row.tabs));
    check(`360: ${tab}: the tab tapped is the open one`, await p.evaluate((tab) => document.querySelector(`.tray .tab[data-tab=${tab}]`).classList.contains("active"), tab));
  }
  await shot(p, "1-tabs-360-industries");
  // (Shortcut: Roads learned, for its tab.)
  await p.evaluate(() => window.woodrail.learn("roads"));
  await p.waitForTimeout(500);
  for (const tab of ["industries", "roads", "track"]) {
    const ok = await tapOn(p, `.tray .tab[data-tab=${tab}]`);
    const row = await tabRow(p);
    check(`360 with Roads: ${tab} open, the row shows whole`, ok && row.scroll <= row.client + 1 && row.inside, JSON.stringify(row));
    check(`360 with Roads: ${tab}: tabs a finger's size`, row.tabs.every((x) => x.h >= 44 && x.w >= 40), JSON.stringify(row.tabs));
  }
  await tapOn(p, ".tray .tab[data-tab=industries]");
  await shot(p, "1-tabs-360-roads");
  await ctx.close();
}

// ---- 2. a locked tile says how to unlock it, and opens Research there -----------------------------------------
{
  const { ctx, p } = await newGame({ width: 360, height: 640 });
  // (Shortcut: the line between the first two towns laid and the school placed by the play-through's own player, as
  // e2e:research does, so Research can start from the picker. Not what's under test.)
  const placed = await p.evaluate(async () => {
    const { play } = await import("/src/play/player.ts");
    const { rulesFor, schoolOn } = await import("/src/play/rules.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    const w = window.woodrail;
    const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
    const r = play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
    const school = schoolOn(w.world, w.editor(), new Set());
    w.invalidate();
    return { joined: r.ok, school };
  });
  check("(setup) a line and a school", placed.joined && typeof placed.school === "number", JSON.stringify(placed));
  await p.waitForTimeout(600);
  await tapOn(p, ".tray .tab[data-tab=track]");
  // The Switch tile: its shelf, then the tile (scrolled into view).
  const before = await p.evaluate(() => ({ coins: window.woodrail.progress().coins, owned: JSON.stringify([...window.woodrail.progress().owned]), pieces: window.woodrail.layout.pieceIds().length }));
  const tile = await p.evaluate(() => {
    const t = [...document.querySelectorAll(".tray-item.locked")].find((x) => x.querySelector(".label")?.textContent === "Switch");
    if (!t) return null;
    t.scrollIntoView({ inline: "center" });
    const r = t.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top };
  });
  check("a locked Switch tile on the Track tab", !!tile);
  await p.waitForTimeout(400);
  await p.touchscreen.tap(tile.x, tile.y);
  await p.waitForTimeout(800);
  // (Measured once it has popped in: mid-way it's 0.96 of its size.)
  await p.waitForFunction(() => { const n = document.querySelector(".lock-note"); return n && !n.hidden && n.getAnimations().every((a) => a.playState === "finished"); }, null, { timeout: 30000 }).catch(() => {});
  const note = await p.evaluate(() => {
    const n = document.querySelector(".lock-note");
    if (!n || n.hidden) return null;
    const r = n.getBoundingClientRect();
    const go = n.querySelector(".lock-note-go")?.getBoundingClientRect();
    return { text: n.textContent, bottom: r.bottom, left: r.left, right: r.right, goH: go?.height ?? 0 };
  });
  check("tapped, a note says how to unlock it", !!note && note.text.includes("Switch") && note.text.includes("Research Switches to unlock"), JSON.stringify(note));
  check("the note sits over the tile, on the screen", !!note && note.bottom <= tile.top && note.left >= 0 && note.right <= 360, JSON.stringify(note));
  check("its Show in Research is a finger's height", !!note && note.goH >= 44, String(note?.goH));
  const after = await p.evaluate(() => ({ coins: window.woodrail.progress().coins, owned: JSON.stringify([...window.woodrail.progress().owned]), pieces: window.woodrail.layout.pieceIds().length, armed: !!document.querySelector(".tray-item.armed, .tray-item.carried") }));
  check("nothing picked up, made or spent", after.coins === before.coins && after.owned === before.owned && after.pieces === before.pieces && !after.armed, JSON.stringify({ before, after }));
  await shot(p, "2-locked-note-360");
  // A tap elsewhere (the map) puts it away; tapped again, it's back.
  await p.touchscreen.tap(180, 300);
  await p.waitForTimeout(600);
  check("a tap on the map puts the note away", await p.evaluate(() => document.querySelector(".lock-note")?.hidden !== false));
  await p.touchscreen.tap(tile.x, tile.y);
  await p.waitForTimeout(800);
  await tapOn(p, ".lock-note-go");
  await p.waitForTimeout(800);
  const board = await p.evaluate(() => {
    const t = document.querySelector(".board-sheet .bp-ticket");
    return { open: !!document.querySelector(".board-panel:not([hidden])"), name: t?.querySelector("b")?.textContent ?? null, note: document.querySelector(".lock-note")?.hidden !== false };
  });
  check("Show in Research opens the picker on Switches", board.open && /Switches/.test(board.name ?? ""), JSON.stringify(board));
  check("and the note is gone", board.note);
  await shot(p, "3-research-switches-360");
  // The payoff: the player's next step from there, by a tap.
  const pickable = await centre(p, ".board-sheet button[data-act=pick]", "Research");
  if (pickable) {
    await tapOn(p, ".board-sheet button[data-act=pick]", "Research");
    const r = await p.evaluate(() => ({ current: window.woodrail.progress().research.current, next: window.woodrail.progress().research.next }));
    check("its Research button starts Switches", r.current === "switches" || r.next === "switches", JSON.stringify(r));
  } else check("its Research button is there", false);
  // The Signal (signals' own tray mark, on the Switch shelf): locked till Signals and routes is learned, its tap shows the same note.
  // (Setup, not what's tested: Switches learned, so the shelf opens; the board closed by its ✕, clicked in the page.)
  await p.evaluate(() => window.woodrail.learn("switches"));
  await p.evaluate(() => document.querySelector(".board-panel:not([hidden]) .board-head .close")?.click());
  await p.waitForTimeout(600);
  const shelf = await p.evaluate(() => {
    if (document.querySelector('.scroller .tray-item[data-key="signal"]')) return null;
    const g = [...document.querySelectorAll(".scroller .tray-group")].find((b) => b.querySelector(".label")?.textContent === "Switch");
    if (!g) return null;
    g.scrollIntoView({ inline: "center" });
    const r = g.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (shelf) await p.touchscreen.tap(shelf.x, shelf.y);
  await p.waitForTimeout(600);
  const sig = await p.evaluate(() => {
    const e = document.querySelector('.scroller .tray-item[data-key="signal"]');
    if (!e) return null;
    e.scrollIntoView({ inline: "center" });
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, locked: e.classList.contains("locked") };
  });
  check("the Signal on the Switch shelf, locked", !!sig && sig.locked, JSON.stringify(sig ?? { shelf, dbg: await p.evaluate(() => ({ board: !!document.querySelector(".board-panel:not([hidden])"), items: [...document.querySelectorAll(".scroller .tray-item, .scroller .tray-group")].map((e) => e.dataset.key ?? e.querySelector(".label")?.textContent) })) }));
  if (sig) {
    await p.waitForTimeout(300);
    await p.touchscreen.tap(sig.x, sig.y);
    await p.waitForFunction(() => { const n = document.querySelector(".lock-note"); return n && !n.hidden; }, null, { timeout: 10000 }).catch(() => {});
    const sn = await p.evaluate(() => { const n = document.querySelector(".lock-note"); return { text: n && !n.hidden ? n.textContent : null, armed: !!document.querySelector(".tray-item.armed") }; });
    check("tapped, its note says how to unlock it (Signals and routes), nothing picked up", !!sn.text && sn.text.includes("Signal") && /Signals and routes/.test(sn.text) && !sn.armed, JSON.stringify(sn));
    await shot(p, "3b-locked-signal-360");
  }
  await ctx.close();
}
{
  // A mouse: hover shows the same words in the tooltip.
  const { ctx, p } = await newGame({ width: 1440, height: 900 }, false);
  await quiet(p);
  const c = await p.evaluate(() => {
    const t = [...document.querySelectorAll(".tray-item.locked")].find((x) => x.querySelector(".label")?.textContent === "Switch");
    t?.scrollIntoView({ inline: "center" });
    const r = t?.getBoundingClientRect();
    return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await p.mouse.move(c.x, c.y);
  await p.waitForTimeout(1200);
  const tip = await p.evaluate(() => { const t = document.querySelector(".tooltip"); return t && !t.hidden ? t.textContent : null; });
  check("desktop: hover on the locked Switch says how to unlock it", !!tip && tip.includes("Research Switches to unlock"), String(tip));
  await p.mouse.click(c.x, c.y);
  await p.waitForTimeout(800);
  check("desktop: a click shows the note too (not a carry)", await p.evaluate(() => document.querySelector(".lock-note")?.hidden === false && !document.querySelector(".tray-item.carried")));
  await ctx.close();
}

// ---- 3. the town card on its side ---------------------------------------------------------------------------
for (const viewport of [{ width: 844, height: 390 }, { width: 740, height: 360 }]) {
  const { ctx, p } = await newGame(viewport);
  const town = await p.evaluate(() => window.woodrail.economy.allDepots().find((d) => d.role === "town")?.id);
  // Opened as a tap on its station does (the e2e for that tap is station-upgrade's).
  await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), town);
  await p.waitForFunction(() => { const c = document.querySelector(".depot-card"); return c && !c.hidden && c.getAnimations().every((a) => a.playState === "finished"); }, null, { timeout: 30000 });
  await p.waitForTimeout(400);
  const card = await p.evaluate(() => {
    const c = document.querySelector(".depot-card");
    const r = c.getBoundingClientRect();
    const x = c.querySelector(":scope > .close").getBoundingClientRect();
    const main = c.querySelector(".ledger-main").getBoundingClientRect();
    const auto = [...c.querySelectorAll(".card-row button")].find((b) => b.textContent.includes("Automatic")).getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), left: r.left, scroll: c.scrollHeight - c.clientHeight, x: { top: x.top - r.top, right: r.right - x.right, w: x.width, h: x.height }, main: { left: main.left - r.left, bottom: main.bottom - r.top }, auto: { left: auto.left - r.left } };
  });
  const tag = `${viewport.width}×${viewport.height}`;
  check(`${tag}: the town card's ✕ at its top right, 44 px`, card.x.top <= 4 && card.x.right <= 4 && card.x.w >= 44 && card.x.h >= 44, JSON.stringify(card.x));
  check(`${tag}: two columns (ledger left, Automatic right)`, card.main.left < 30 && card.auto.left > card.w / 2 - 10, JSON.stringify(card));
  check(`${tag}: the ledger shows whole, no scroll`, card.scroll <= 1 && card.main.bottom <= card.h, JSON.stringify(card));
  check(`${tag}: the card keeps right of 40% of the screen`, card.left >= viewport.width * 0.4 - 1, String(card.left));
  await shot(p, `4-town-card-${tag}`);
  const was = await p.evaluate((id) => window.woodrail.economy.allDepots().find((d) => d.id === id).auto, town);
  await tapOn(p, ".depot-card .card-row button", "Automatic");
  const now = await p.evaluate((id) => window.woodrail.economy.allDepots().find((d) => d.id === id).auto, town);
  check(`${tag}: Automatic switches by a tap`, now === !was, `${was} → ${now}`);
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures ? `${failures} FAILED` : "ALL PASS");
await b.close();
await server.close();
process.exit(failures ? 1 : 0);
