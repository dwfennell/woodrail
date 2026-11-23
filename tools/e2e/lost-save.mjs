// End-to-end: a Game save this build can't open is never written over, and a copied map gets a game back
// (`npm run e2e:lost-save [-- <out dir>]`; 2026-11-23: a player's game turned away on a reload and a starter map saved
// over it), on a 390×844 phone, by taps:
//   1. a phone whose Game save won't load (the player's lost game, a warehouse pile past any limit), reloaded from play
//      (straight back into Game mode, as the "Couldn't fetch…" toast's reload does): the title, not a starter map in
//      play; Your games open over it saying the game is kept; the save parked byte for byte as "Couldn't open: …";
//      no game's keys written in its place;
//   2. a reload: still parked, still byte for byte, still one entry;
//   3. Your games, Load a map from text, the player's pre-wipe "Copy map for a bug report" text pasted, Add to Your
//      games: "(from text)" added beside it (nothing replaced); Open: the page starts again on it, its seed 770187 and
//      all its pieces, in play; and saved again it loads (kept after a reload).
// Pictures in the out dir (about 3 min).
//
// Usage: npm run e2e:lost-save [-- <out dir>]   (default out: e2e-out/lost-save)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { still } from "../../scripts/e2e/lib/still.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/lost-save";
mkdirSync(OUT, { recursive: true });
const TEXT = readFileSync(`${ROOT}/src/persist/fixtures/2026-11-23-lift-warehouse-game.txt`, "utf8").trim();
const COPY = JSON.parse(gunzipSync(Buffer.from(TEXT.slice("woodrail-map:1:".length).replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString());
const SAVE = "woodrail.game.v2";
const PIECES = JSON.parse(COPY.keys[SAVE]).pieces.length;
// The lost game made unreadable by any build: a warehouse pile far past every limit.
const badSave = (() => {
  const d = JSON.parse(COPY.keys[SAVE]);
  d.depots.find((x) => x.role === "warehouse").piles[0] = 999999;
  return JSON.stringify(d);
})();

const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5447, strictPort: false }, logLevel: "error" });
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
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.jpg`, quality: 80, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));

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

const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
// (Once, on the first page only: the phone as the player's was, reloaded from play into Game mode.)
await ctx.addInitScript(
  ({ keys, badSave }) => {
    if (sessionStorage.getItem("lost-save.seeded")) return;
    sessionStorage.setItem("lost-save.seeded", "1");
    localStorage.clear();
    localStorage.setItem("woodrail.helpSeen", "1");
    for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v);
    localStorage.setItem("woodrail.game.v2", badSave);
    localStorage.setItem("woodrail.lastMode", "game");
    sessionStorage.setItem("woodrail.resume", "game");
  },
  { keys: COPY.keys, badSave },
);
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
});
const gamesUp = () => p.waitForFunction(() => !!document.querySelector(".games-sheet:not([hidden]) .games-row"), null, { timeout: 240000 });
const parked = () =>
  p.evaluate(() => ({
    live: localStorage.getItem("woodrail.game.v2"),
    games: window.woodrail.slots.list().map((g) => ({ id: g.id, name: g.name })),
    open: window.woodrail.slots.openId,
    inGame: window.woodrail.mode?.() === "game" && !window.woodrail.title.shown,
    note: document.querySelector(".games-sheet:not([hidden]) .games-note:not([hidden])")?.textContent ?? "",
  }));
const parkedSave = (id) =>
  p.evaluate(async (id) => {
    const packed = localStorage.getItem(`woodrail.games.slot.${id}`);
    const { unpackKeys } = await import("/src/persist/slots.ts");
    const keys = packed === null ? null : await unpackKeys(packed);
    return keys?.["woodrail.game.v2"] ?? null;
  }, id);

try {
  await p.goto(PAGE);
  await gamesUp();
  await p.waitForTimeout(800);
  let s = await parked();
  await shot(p, "1-kept");
  check("1. not in play on a starter map: the title, with Your games over it", !s.inGame, JSON.stringify({ inGame: s.inGame }));
  check("1. …saying the game is kept", /couldn't be opened/.test(s.note) && /Your games/.test(s.note), s.note);
  check("1. …listed as Couldn't open", s.games.length === 1 && s.games[0].name === "Couldn't open: 770187-gentle", JSON.stringify(s.games));
  check("1. …nothing in the game's keys in its place", s.live === null && s.open === null);
  const id = s.games[0]?.id;
  check("1. …parked byte for byte", (await parkedSave(id)) === badSave);

  await p.evaluate(() => sessionStorage.setItem("woodrail.resume", "game"));
  await p.reload();
  await gamesUp().catch(() => {});
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  s = await parked();
  check("2. after a reload: still parked, one entry, byte for byte", s.games.length === 1 && s.games[0].id === id && (await parkedSave(id)) === badSave, JSON.stringify(s.games));

  if (!(await p.evaluate(() => !!document.querySelector(".games-sheet:not([hidden])")))) check("3. Your games from the title", await tap(p, ".title-card.mode-game .title-games"));
  check("3. Load a map from text", await tap(p, ".games-sheet .games-load-open"));
  await p.fill(".games-load-text", TEXT);
  check("3. Add to Your games", await tap(p, ".games-sheet .games-load-add"));
  await p.waitForTimeout(600);
  s = await parked();
  await shot(p, "3-added");
  const added = s.games.find((g) => g.name === "770187-gentle (from text)");
  check("3. …added beside it, nothing replaced", !!added && s.games.length === 2 && (await parkedSave(id)) === badSave, JSON.stringify(s.games));
  check("3. …says so", /Added/.test(s.note), s.note);
  check("3. Open it", await tap(p, `.games-row[data-id="${added?.id}"] .games-open`));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  await p.waitForTimeout(1500);
  const w = await p.evaluate(() => ({ seed: window.woodrail.landscape.seed, pieces: [...window.woodrail.layout.pieceIds()].length, open: window.woodrail.slots.openId }));
  await shot(p, "3-opened");
  check("3. …in play: the player's game, its seed and every piece", w.seed === 770187 && w.pieces === PIECES && w.open === added?.id, JSON.stringify(w));
  await p.evaluate(() => sessionStorage.setItem("woodrail.resume", "game"));
  await p.reload();
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  const w2 = await p.evaluate(() => ({ seed: window.woodrail.landscape.seed, pieces: [...window.woodrail.layout.pieceIds()].length, games: window.woodrail.slots.list().length }));
  check("3. …kept after a reload (saved and loaded again)", w2.seed === 770187 && w2.pieces === PIECES && w2.games === 2, JSON.stringify(w2));
} catch (e) {
  check("ran to the end", false, e.message.split("\n")[0]);
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`${failures === 0 ? "ALL PASS" : `${failures} FAILED`} (${checks} checks)`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
