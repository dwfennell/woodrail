// End-to-end save safety (`npm run e2e:save-safety [-- <out dir>]`; spec docs/superpowers/specs/2026-11-26-save-safety.md)
// on a 390×844 phone, by taps, on the user's own game (src/persist/fixtures/2026-11-23-lift-warehouse-game.txt: seed
// 770187, 267 pieces, 10 trains):
//   restore: the game opened (Continue), its backup taken a few seconds in (a day's copy, 267 pieces, read back byte for
//     byte); a straight laid from the tray (268); ☰ Your games, Restore an earlier version on its row: the copy listed
//     by date with 10 trains and 267 pieces; Replace asks first ("What it is now is kept"), Replace: the page starts
//     again on the copy (267 pieces, seed 770187), and what it was (268) is listed as "Before a restore".
//   guard: the 2026-11-22 wipe's state: the starter map in play (the title's New game), the user's game in the game's
//     keys under the same game (the stored save the page didn't read); a straight laid by taps: the autosave is
//     refused (the keys still the user's), the toast says it's kept, the kept copy is the user's game byte for byte;
//     ☰ Your games, Restore an earlier version lists it (10 trains, 267 pieces, Kept safe); Add as a game, Open: the
//     user's game in play, seed 770187 and every piece.
// 44 px buttons; pictures in the out dir (about 5 min).
//
// Usage: npm run e2e:save-safety [-- <out dir>]   (default out: e2e-out/save-safety; E2E_ONLY=restore,guard)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { still } from "../../scripts/e2e/lib/still.mjs";
import { groups } from "../../scripts/e2e/lib/groups.mjs";
import { shownToast, toastLogIn, toastMark, toastsSince } from "../../scripts/e2e/lib/toasts.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/save-safety";
mkdirSync(OUT, { recursive: true });
const TEXT = readFileSync(`${ROOT}/src/persist/fixtures/2026-11-23-lift-warehouse-game.txt`, "utf8").trim();
const COPY = JSON.parse(gunzipSync(Buffer.from(TEXT.slice("woodrail-map:1:".length).replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString());
const SAVE = "woodrail.game.v2";
const LIVE = ["woodrail.game.v2", "woodrail.game.v2.session", "woodrail.game.goals.v1", "woodrail.game.stickers.v1", "woodrail.game.progress.v1"];
const USERS = Object.fromEntries(Object.entries(COPY.keys).filter(([k]) => LIVE.includes(k)));
const PIECES = JSON.parse(USERS[SAVE]).pieces.length;
const TRAINS = JSON.parse(USERS[SAVE]).trains.length;

const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5449, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const results = [];
const check = (what, ok, detail = "") => {
  results.push({ ok });
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.jpg`, quality: 80, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = (p) => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));

/** A fresh phone, `init` run before each load (once: the first page only, by its own flag). */
async function phone(init, arg) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await toastLogIn(ctx);
  await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  if (init) await ctx.addInitScript(init, arg);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return { ctx, p, cdp: await ctx.newCDPSession(p) };
}

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
const inGame = (p) => p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
const titleUp = (p) => p.waitForFunction(() => window.woodrail?.title?.shown && !window.woodrail.title.root.classList.contains("placing") && document.querySelector(".title-card.mode-game .title-buttons .primary:not([hidden])"), null, { timeout: 240000 });
async function skipCoach(p) {
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}
async function menu(p, item) {
  await tap(p, ".hud button[title='Menu'], button[aria-label='Menu']");
  return tap(p, ".menu .menu-item", item);
}
const state = (p) =>
  p.evaluate(() => {
    const w = window.woodrail;
    return { seed: w.landscape.seed, pieces: [...w.layout.pieceIds()].length, trains: w.sim.trainIds().length, open: w.slots.openId, games: w.slots.list().map((g) => ({ id: g.id, name: g.name })) };
  });
/** A game's backups as stored: the index's list, and each copy's railway unpacked. */
const backups = (p, id) =>
  p.evaluate(async (id) => {
    const { unpackKeys } = await import("/src/persist/slots.ts");
    const list = JSON.parse(localStorage.getItem("woodrail.games.backups.v1") ?? "{}")[id] ?? [];
    const out = [];
    for (const c of list) {
      const keys = await unpackKeys(localStorage.getItem(`woodrail.games.backup.${id}.${c.n}`) ?? "");
      out.push({ ...c, save: keys?.["woodrail.game.v2"] ?? null });
    }
    return out;
  }, id);
/** The earlier versions as Your games shows them for a row: each copy's line and buttons (and any under 44 px). */
const earlierShown = (p, id) =>
  p.evaluate((id) => {
    const row = document.querySelector(`.games-row[data-id="${id}"]`);
    return [...(row?.querySelectorAll(".games-copy-item") ?? [])].map((i) => ({ n: Number(i.dataset.n), facts: i.querySelector(".games-copy-facts")?.textContent ?? "", buttons: [...i.querySelectorAll("button")].map((x) => x.textContent), small: [...row.querySelectorAll("button")].filter((x) => x.getBoundingClientRect().height < 44).length }));
  }, id);

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
 * The player lays a straight (as e2e:saves does): the camera on a free end (a station's, else a plain straight's with
 * nothing past it), a Long straight dragged by a finger from the tray to just past it, where it snaps on. True when one
 * more piece is laid.
 */
async function layStraight(p, cdp) {
  const before = (await state(p)).pieces;
  const end = await p.evaluate(async () => {
    const w = window.woodrail;
    const { connectorRef, createWorldConnector } = await import("/src/track/layout.ts");
    const ids = [...w.world.stations.values(), ...[...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id).type === "straight-216")];
    for (const id of ids) {
      const piece = w.layout.getPiece(id);
      for (let i = 0; i < 2; i++) {
        const ref = connectorRef(id, i);
        if (w.layout.joinedConnector(ref) !== -1) continue;
        const c = w.layout.worldConnector(ref, createWorldConnector());
        const dx = c.x - piece.pose.x;
        const dz = c.z - piece.pose.z;
        const d = Math.hypot(dx, dz) || 1;
        const x = c.x + (dx / d) * 108;
        const z = c.z + (dz / d) * 108;
        // (Room past it: no piece within a straight's length of where the new one goes.)
        if ([...w.layout.pieceIds()].some((o) => o !== id && Math.hypot(w.layout.getPiece(o).pose.x - x, w.layout.getPiece(o).pose.z - z) < 200)) continue;
        return { x, z, y: c.y };
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

/** Your games opened by ☰, and a row's Restore an earlier version. */
async function earlierOf(p, id) {
  if (!(await p.evaluate(() => !!document.querySelector(".games-sheet:not([hidden])")))) check("☰ Your games is a tap", await menu(p, "Your games"));
  await p.waitForTimeout(600);
  check("…the row's Restore an earlier version is a tap", await tap(p, `.games-row[data-id="${id}"] .games-earlier-open`));
  await p.waitForTimeout(400);
  return earlierShown(p, id);
}

const suite = groups("save-safety", { results, errors, check });

suite.add("restore", async () => {
  const { ctx, p, cdp } = await phone(
    ({ keys }) => {
      if (sessionStorage.getItem("save-safety.seeded")) return;
      sessionStorage.setItem("save-safety.seeded", "1");
      localStorage.clear();
      localStorage.setItem("woodrail.helpSeen", "1");
      for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v);
      localStorage.setItem("woodrail.lastMode", "game");
    },
    { keys: USERS },
  );
  await p.goto(PAGE);
  await titleUp(p);
  check("restore: the title's Continue is a tap", await tap(p, ".title-card.mode-game .title-buttons .chip", "Continue"));
  await inGame(p);
  await settle(p);
  await skipCoach(p);
  const s0 = await state(p);
  check("restore: the user's game in play", s0.seed === 770187 && s0.pieces === PIECES, JSON.stringify(s0));
  const id = s0.open;
  await p.waitForFunction((id) => (JSON.parse(localStorage.getItem("woodrail.games.backups.v1") ?? "{}")[id] ?? []).length > 0, id, { timeout: 60000 }).catch(() => {});
  const taken = await backups(p, id);
  check("restore: a few seconds in, its backup: the day's copy, 267 pieces, 10 trains", taken.length === 1 && taken[0].kind === "day" && taken[0].pieces === PIECES && taken[0].trains === TRAINS, JSON.stringify(taken.map(({ save, ...c }) => c)));
  check("restore: …read back byte for byte as it loaded", taken[0]?.save === USERS[SAVE]);
  check("restore: a straight laid from the tray", await layStraight(p, cdp));
  await p.waitForFunction((n) => JSON.parse(localStorage.getItem("woodrail.game.v2")).pieces.length === n, PIECES + 1, { timeout: 30000 }).catch(() => {});
  check("restore: …and saved (268 pieces)", await p.evaluate(() => JSON.parse(localStorage.getItem("woodrail.game.v2")).pieces.length) === PIECES + 1);
  const shown = await earlierOf(p, id);
  await shot(p, "restore-1-earlier");
  check("restore: the copy listed by date, with its trains and pieces", shown.length === 1 && /^Today \d\d:\d\d · 10 trains · 267 pieces · \d+ 🪙 · Day's copy$/.test(shown[0].facts), JSON.stringify(shown));
  check("restore: …Add as a game and Replace, 44 px or more", shown[0]?.buttons.join() === "Add as a game,Replace" && shown[0].small === 0, JSON.stringify(shown[0]));
  check("restore: Replace is a tap", await tap(p, `.games-row[data-id="${id}"] .games-copy-replace`));
  const ask = await p.evaluate(() => document.querySelector(".games-copy-item .games-ask")?.textContent ?? "");
  await shot(p, "restore-2-asks");
  check("restore: …it asks first, saying what it is now is kept", /^Replace “770187-gentle” with this copy\? What it is now is kept as an earlier version\.$/.test(ask), ask);
  const nav = p.waitForNavigation({ timeout: 120000 });
  check("restore: Replace again", await tap(p, ".games-copy-item .games-copy-confirm"));
  await nav;
  await inGame(p);
  await settle(p);
  const s1 = await state(p);
  await shot(p, "restore-3-restored");
  check("restore: the page starts again on the copy: 267 pieces, the same game", s1.seed === 770187 && s1.pieces === PIECES && s1.open === id && s1.games.length === 1, JSON.stringify(s1));
  const after = await backups(p, id);
  const was = after.find((c) => c.kind === "replaced");
  check("restore: what it was is kept as an earlier version (268 pieces, Before a restore)", !!was && was.pieces === PIECES + 1 && JSON.parse(was.save).pieces.length === PIECES + 1, JSON.stringify(after.map(({ save, ...c }) => c)));
  const shown2 = await earlierOf(p, id);
  check("restore: …listed so", shown2.some((c) => /268 pieces · \d+ 🪙 · Before a restore$/.test(c.facts)), JSON.stringify(shown2.map((c) => c.facts)));
  await ctx.close();
});

suite.add("guard", async () => {
  const { ctx, p, cdp } = await phone();
  await p.goto(PAGE);
  await titleUp(p);
  check("guard: the title's New game, Start: the starter map in play", (await tap(p, ".title-card.mode-game .title-buttons .chip", "New game")) && (await tap(p, ".new-game-sheet .new-game-start")));
  await inGame(p);
  await settle(p);
  await skipCoach(p);
  const s0 = await state(p);
  check("guard: …the starter map, seed 7", s0.seed === 7 && s0.games.length === 1, JSON.stringify(s0));
  const id = s0.open;
  await p.waitForFunction(() => localStorage.getItem("woodrail.game.v2") !== null, null, { timeout: 30000 });
  // The 2026-11-22 state, set up (not by taps: it's a bug's): the game's keys hold the user's game, under the open
  // game's tag, while the page plays the starter map it made instead.
  await p.evaluate(
    ({ keys, id }) => {
      for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, k.endsWith(".session") ? JSON.stringify({ ...JSON.parse(v), slot: { id, name: "770187-gentle" } }) : v);
    },
    { keys: USERS, id },
  );
  const mark = await toastMark(p);
  check("guard: a straight laid from the tray", await layStraight(p, cdp));
  const said = await shownToast(p, "is kept safe", { from: mark, ms: 30000 });
  await shot(p, "guard-1-toast");
  check("guard: the toast says the game is kept, and where", !!said && /the starter map was about to be saved over it/.test(said.text) && /Your games, Earlier versions/.test(said.text), said?.text ?? (await toastsSince(p, mark)));
  const kept = await backups(p, id);
  check("guard: the kept copy is the user's game, byte for byte (10 trains, 267 pieces)", kept.length === 1 && kept[0].kind === "kept" && kept[0].save === USERS[SAVE] && kept[0].trains === TRAINS && kept[0].pieces === PIECES, JSON.stringify(kept.map(({ save, ...c }) => ({ ...c, same: save === USERS[SAVE] }))));
  const shown = await earlierOf(p, id);
  await shot(p, "guard-2-earlier");
  check("guard: Restore an earlier version lists it: 10 trains, 267 pieces, Kept safe", shown.length === 1 && /· 10 trains · 267 pieces · \d+ 🪙 · Kept safe$/.test(shown[0].facts), JSON.stringify(shown));
  check("guard: Add as a game is a tap", await tap(p, `.games-row[data-id="${id}"] .games-copy-add`));
  await p.waitForTimeout(800);
  const s1 = await state(p);
  const added = s1.games.find((g) => g.id !== id);
  const note = await p.evaluate(() => document.querySelector(".games-sheet:not([hidden]) .games-note:not([hidden])")?.textContent ?? "");
  check("guard: …added beside it, saying so", !!added && /^770187-gentle \(\d+ \w{3} \d\d:\d\d\)$/.test(added.name) && /^Added “.*”\. Open it to play\.$/.test(note), JSON.stringify({ games: s1.games, note }));
  check("guard: Open it", await tap(p, `.games-row[data-id="${added?.id}"] .games-open`));
  await inGame(p);
  await settle(p);
  const s2 = await state(p);
  await shot(p, "guard-3-opened");
  check("guard: …the user's game in play: seed 770187, every piece and train", s2.seed === 770187 && s2.pieces === PIECES && s2.trains === TRAINS && s2.open === added?.id, JSON.stringify(s2));
  await ctx.close();
});

await suite.run();
await b.close();
await server.close();
suite.finish();
