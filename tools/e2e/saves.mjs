// End-to-end Your games, several Game-mode games side by side (`npm run e2e:saves [-- <out dir>]`; spec
// docs/superpowers/specs/2026-11-16-multiple-saves.md), on a 390×844 phone, by taps:
//   1. the title's New game starts game A; a straight dragged from the tray onto a station's free end;
//   2. ☰ New game (saying this game is kept) starts game B on a fresh seed, beside A; a straight laid there too;
//   3. ☰ Your games lists both, the last played first, each with its picture, name, date, time played and goals;
//      0 frames drawn while it's open; Open on A: the page starts again on A, its straight there;
//   4. Rename A (kept after a reload), Copy B ("(copy)", its picture too), Delete asks first (Keep keeps it, Delete
//      deletes it, its picture and parked copy gone);
//   5. Open B, then a reload: the title's Continue opens B, the game played last, its straight there;
//   6. an old single save (the keys as an older game left them, no Your games yet) on a fresh phone: Continue, it's
//      game 1 in Your games, its save byte for byte as it was, its track there; kept after a reload.
// Pictures in the out dir (about 6 min).
//
// Usage: npm run e2e:saves [-- <out dir>]   (default out: e2e-out/saves)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { still } from "../../scripts/e2e/lib/still.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/saves";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5446, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
let failures = 0;
let checks = 0;
const check = (what, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};

/** A fresh phone (no save, unless `init` puts one in storage before the game starts). */
async function phone(init) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  if (init) await ctx.addInitScript(init.fn, init.arg);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  const cdp = await ctx.newCDPSession(p);
  return { ctx, p, cdp };
}

const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = (p) => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.jpg`, quality: 80, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));

/** Tap the first visible element matching `selector` (whose text includes `text`, if given) with a finger. */
async function tap(p, selector, text) {
  await still(p, selector, text);
  const at = await p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden]") && (!text || e.textContent.includes(text)));
      if (!el) return null;
      el.scrollIntoView({ block: "nearest" });
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
const inGame = (p) => p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
async function skipCoach(p) {
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}
async function menu(p, item) {
  await tap(p, ".hud button[title='Menu'], button[aria-label='Menu']");
  return tap(p, ".menu .menu-item", item);
}

/** The game in play: its seed, its pieces, and the open game's entry. */
const state = (p) =>
  p.evaluate(() => {
    const w = window.woodrail;
    return { seed: w.landscape.seed, pieces: [...w.layout.pieceIds()].length, open: w.slots.openId, games: w.slots.list().map((g) => ({ id: g.id, name: g.name })) };
  });

/** A tray item by its key, opening shelves for it as a player would; its middle on screen. */
async function trayItem(p, key) {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, key);
  const pressAt = async (sel, k = 0) => {
    const r = await p.evaluate(([sel, k]) => { const e = document.querySelectorAll(sel)[k]; if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, [sel, k]);
    if (r) await p.touchscreen.tap(r[0], r[1]);
    await frames(p);
    return !!r;
  };
  for (let k = 0; k < 24; k++) {
    const r = await find();
    if (r) return r;
    if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) await pressAt(".scroller .tray-back");
    if (!(await pressAt(".scroller .tray-group", k))) return null;
  }
  return null;
}

/**
 * The player lays a straight: the camera on a station's free end, a Long straight dragged by a finger from the tray to
 * just past it (the piece rides a little above the finger: aimed below), where it snaps on. True when one more piece
 * is laid.
 */
async function layStraight(p, cdp) {
  const before = (await state(p)).pieces;
  const end = await p.evaluate(async () => {
    const w = window.woodrail;
    const { connectorRef, createWorldConnector } = await import("/src/track/layout.ts");
    for (const id of w.world.stations.values()) {
      const piece = w.layout.getPiece(id);
      for (let i = 0; i < 2; i++) {
        const ref = connectorRef(id, i);
        if (w.layout.joinedConnector(ref) !== -1) continue;
        const c = w.layout.worldConnector(ref, createWorldConnector());
        const dx = c.x - piece.pose.x;
        const dz = c.z - piece.pose.z;
        const d = Math.hypot(dx, dz) || 1;
        return { x: c.x + (dx / d) * 108, z: c.z + (dz / d) * 108, y: c.y };
      }
    }
    return null;
  });
  if (!end) return false;
  await p.evaluate((v) => {
    const w = window.woodrail;
    const V = w.camera.position.constructor;
    if (w.lookAt) w.lookAt(new V(v.x, 0, v.z), 700, 0.9);
    else w.director.glideTo(new V(v.x, 0, v.z), 700, { duration: 0.1 });
    w.invalidate();
  }, end);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await settle(p);
  const item = await trayItem(p, "piece:straight-216");
  if (!item) return false;
  const [tx, ty] = await p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y ?? 0, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, end);
  const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  let t = Date.now() / 1000;
  await touch("touchStart", item[0], item[1], t);
  for (let k = 1; k <= 16; k++) await touch("touchMove", item[0] + ((tx - item[0]) * k) / 16, item[1] + ((ty + 56 - item[1]) * k) / 16, (t += 0.04));
  await p.waitForTimeout(400);
  await frames(p);
  await touch("touchEnd", 0, 0, (t += 0.05));
  await frames(p);
  await p.waitForTimeout(800);
  await settle(p);
  return (await state(p)).pieces === before + 1;
}

/** Your games as it shows: its rows (name, facts, picture, buttons) and its note. */
const sheet = (p) =>
  p.evaluate(() => {
    const r = document.querySelector(".games-sheet");
    const rows = [...(r?.querySelectorAll(".games-row") ?? [])].map((row) => ({
      id: row.dataset.id,
      name: row.querySelector(".games-name")?.textContent ?? "",
      facts: row.querySelector(".games-facts")?.textContent ?? "",
      picture: !!row.querySelector("img.games-img")?.getAttribute("src")?.startsWith("data:image/"),
      pictureLoaded: (row.querySelector("img.games-img")?.naturalWidth ?? 0) > 0,
      buttons: [...row.querySelectorAll(".games-buttons button")].map((x) => x.textContent),
      small: [...row.querySelectorAll(".games-buttons button")].filter((x) => x.getBoundingClientRect().height < 44).length,
      playing: !!row.querySelector(".games-playing"),
    }));
    return { open: !!r && !r.hidden, rows, note: r?.querySelector(".games-note:not([hidden])")?.textContent ?? "" };
  });
const rowTap = (p, id, button) => tap(p, `.games-row[data-id="${id}"] .games-buttons button`, button);

try {
  const { p, cdp } = await phone();
  await p.goto(PAGE);
  await titleUp(p);
  // ---- 1. Game A ----
  check("1. the title's New game opens the new-game screen", await tap(p, ".title-card.mode-game .title-buttons .chip", "New game"));
  await tap(p, '.new-game-sheet [data-hills="hilly"]');
  await tap(p, ".new-game-sheet .new-game-start");
  await inGame(p);
  await settle(p);
  await skipCoach(p);
  check("1. a straight laid in game A, from the tray onto a station's end", await layStraight(p, cdp));
  const a = await state(p);
  check("1. …game A is the one game in Your games, open, named after its map", a.games.length === 1 && a.open === a.games[0].id && a.games[0].name === "Starter map", JSON.stringify(a));

  // ---- 2. Game B, beside it ----
  check("2. ☰ New game is a tap", await menu(p, "New game"));
  const warn = await p.evaluate(() => document.querySelector(".new-game-sheet:not([hidden]) .new-game-warn")?.textContent ?? "");
  check("2. …the screen says this game is kept in Your games", /This game is kept in Your games/.test(warn), warn);
  await tap(p, ".new-game-sheet .new-game-dice");
  await tap(p, ".new-game-sheet .new-game-start");
  await p.waitForFunction((seed) => window.woodrail.landscape.seed !== seed, a.seed, { timeout: 120000 });
  await settle(p);
  await skipCoach(p);
  const b0 = await state(p);
  check("2. …a second game on a new map, named by its code, A kept beside it", b0.games.length === 2 && /^\d+(-|$)/.test(b0.games.find((g) => g.id === b0.open)?.name ?? "") && b0.open !== a.open && b0.games.some((g) => g.id === a.open) && b0.seed !== a.seed, JSON.stringify(b0));
  check("2. a straight laid in game B", await layStraight(p, cdp));
  const bState = await state(p);

  // ---- 3. Your games ----
  check("3. ☰ Your games is a tap", await menu(p, "Your games"));
  await p.waitForTimeout(800);
  let s = await sheet(p);
  await shot(p, "3-your-games");
  check("3. …it lists both, the last played (B, playing now) first", s.open && s.rows.length === 2 && s.rows[0].id === bState.open && s.rows[0].playing && s.rows[1].id === a.open, JSON.stringify(s));
  check("3. …each with its picture", s.rows.every((r) => r.picture && r.pictureLoaded), JSON.stringify(s.rows.map((r) => [r.name, r.picture, r.pictureLoaded])));
  check("3. …each with its name, date, time played and goals", s.rows.every((r) => r.name.length > 0 && /^(Today|Yesterday|\d+ \w{3}).* · .* · \d+ goals? · \d+ 🪙$/.test(r.facts)), JSON.stringify(s.rows.map((r) => [r.name, r.facts])));
  check("3. …B (in play) has no Open or Delete; A has Open, Rename, Copy, Delete; all 44 px or more", !s.rows[0].buttons.includes("Open") && !s.rows[0].buttons.includes("Delete") && ["Open", "Rename", "Copy", "Delete"].every((x) => s.rows[1].buttons.includes(x)) && s.rows.every((r) => r.small === 0), JSON.stringify(s.rows.map((r) => r.buttons)));
  const idle = await p.evaluate(async () => {
    const w = window.woodrail;
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    const n0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 3000));
    return w.framesDrawn - n0;
  });
  check("3. 0 frames drawn while it's open", idle === 0, `${idle} frames`);
  const nava = p.waitForNavigation({ timeout: 120000 });
  await rowTap(p, a.open, "Open");
  await nava;
  await inGame(p);
  await settle(p);
  const a2 = await state(p);
  check("3. Open on A: the page starts again on A, its straight there", a2.open === a.open && a2.seed === a.seed && a2.pieces === a.pieces, JSON.stringify({ a, a2 }));

  // ---- 4. Rename, copy, delete ----
  await skipCoach(p);
  await menu(p, "Your games");
  await rowTap(p, a.open, "Rename");
  await p.locator(".games-name-input").fill("My first line");
  await rowTap(p, a.open, "Save");
  s = await sheet(p);
  check("4. Rename: A is “My first line”", s.rows.find((r) => r.id === a.open)?.name === "My first line", JSON.stringify(s.rows.map((r) => r.name)));
  await rowTap(p, bState.open, "Copy");
  await p.waitForFunction(() => document.querySelectorAll(".games-row").length === 3, null, { timeout: 20000 }).catch(() => {});
  s = await sheet(p);
  const copy = s.rows.find((r) => r.name.endsWith("(copy)"));
  check("4. Copy on B: a third game, “… (copy)”, with B's picture", s.rows.length === 3 && !!copy && copy.picture, JSON.stringify(s.rows.map((r) => [r.name, r.picture])));
  await rowTap(p, copy?.id, "Delete");
  const ask = await p.evaluate((id) => document.querySelector(`.games-row[data-id="${id}"] .games-ask`)?.textContent ?? "", copy?.id);
  check("4. Delete asks first", /Delete “.*\(copy\)”\? It can't be undone\./.test(ask), ask);
  await shot(p, "4-delete-asks");
  await rowTap(p, copy?.id, "Keep");
  s = await sheet(p);
  check("4. …Keep keeps it", s.rows.length === 3 && s.rows.some((r) => r.id === copy?.id));
  await rowTap(p, copy?.id, "Delete");
  await tap(p, `.games-row[data-id="${copy?.id}"] .games-confirm`);
  s = await sheet(p);
  const gone = await p.evaluate((id) => ({ parked: localStorage.getItem(`woodrail.games.slot.${id}`), pic: localStorage.getItem(`woodrail.games.pic.${id}`) }), copy?.id);
  check("4. …Delete deletes it: two games, its copy and picture gone", s.rows.length === 2 && !s.rows.some((r) => r.id === copy?.id) && gone.parked === null && gone.pic === null, JSON.stringify({ rows: s.rows.map((r) => r.name), gone }));

  // ---- 5. Continue opens the game played last ----
  const navb = p.waitForNavigation({ timeout: 120000 });
  await rowTap(p, bState.open, "Open");
  await navb;
  await inGame(p);
  await settle(p);
  const b2 = await state(p);
  check("5. Open on B: B, its straight there", b2.open === bState.open && b2.seed === bState.seed && b2.pieces === bState.pieces, JSON.stringify({ bState, b2 }));
  await p.reload();
  await titleUp(p);
  const titleGames = await p.evaluate(() => !!document.querySelector(".title-card.mode-game .title-games:not([hidden])"));
  check("5. after a reload the title offers Your games", titleGames);
  await shot(p, "5-title");
  check("5. …Continue", await tap(p, ".title-card.mode-game .title-buttons .chip", "Continue"));
  await inGame(p);
  await settle(p);
  const b3 = await state(p);
  check("5. …opens B, the game played last, its straight there", b3.open === bState.open && b3.seed === bState.seed && b3.pieces === bState.pieces, JSON.stringify(b3));
  const renamed = b3.games.find((g) => g.id === a.open)?.name;
  check("5. …and A's new name kept", renamed === "My first line", renamed);

  // ---- 6. An old single save migrates ----
  // (The keys as an older game left them: game A's, read from storage, its session without the game's tag, and no
  // Your games index.)
  const old = await p.evaluate(async (id) => {
    const { unpackKeys } = await import("/src/persist/slots.ts");
    const keys = await unpackKeys(localStorage.getItem(`woodrail.games.slot.${id}`));
    const session = JSON.parse(keys["woodrail.game.v2.session"]);
    delete session.slot;
    keys["woodrail.game.v2.session"] = JSON.stringify(session);
    return keys;
  }, a.open);
  const o = await phone({
    fn: (keys) => {
      if (localStorage.getItem("woodrail.games.v1") !== null || localStorage.getItem("woodrail.game.v2") !== null) return;
      for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v);
      localStorage.setItem("woodrail.game.started", "1");
      localStorage.setItem("woodrail.lastMode", "game");
    },
    arg: old,
  });
  await o.p.goto(PAGE);
  await titleUp(o.p);
  const m = await o.p.evaluate(() => ({ games: window.woodrail.slots.list(), open: window.woodrail.slots.openId, save: localStorage.getItem("woodrail.game.v2"), button: !!document.querySelector(".title-card.mode-game .title-games:not([hidden])") }));
  check("6. an old single save is game 1 in Your games, open, its save byte for byte as it was", m.games.length === 1 && m.open === m.games[0].id && m.save === old["woodrail.game.v2"] && m.button, JSON.stringify({ games: m.games, open: m.open, same: m.save === old["woodrail.game.v2"] }));
  await tap(o.p, ".title-card.mode-game .title-buttons .chip", "Continue");
  await inGame(o.p);
  await settle(o.p);
  const m2 = await state(o.p);
  check("6. …Continue opens it, its track there", m2.seed === a.seed && m2.pieces === a.pieces, JSON.stringify(m2));
  await o.p.reload();
  await titleUp(o.p);
  const m3 = await o.p.evaluate(() => ({ games: window.woodrail.slots.list().map((g) => g.id), open: window.woodrail.slots.openId }));
  check("6. …kept after a reload: the same one game", m3.games.length === 1 && m3.games[0] === m.open && m3.open === m.open, JSON.stringify(m3));
} catch (e) {
  check("ran to the end", false, String(e?.stack ?? e));
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? `${checks}/${checks} passed` : `${failures} of ${checks} FAILED`);
process.exit(failures === 0 ? 0 : 1);
