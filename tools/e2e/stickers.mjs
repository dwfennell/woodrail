// End-to-end: stickers (spec 2026-10-31-achievements.md, step 2) on a 390×844 phone with touch, in Game mode.
// A sticker is earned by playing (Track layer: 40 pieces of track laid between towns) while the core goals are still
// going: earned quietly, a dot on the Journal's chip, no Stickers tab and no sticker toast. Then the last core goal
// (Connect every town) is met by laying the last link: its toast, then "Stickers!", whose tap opens the Journal on the
// new Stickers tab, with Track layer and Every town earned; a tile's tap shows its ticket; looking at the tab clears
// the dot; the chip says "Goals ✓ · 🌟 n / 27"; the Goals tab says keep building, with See stickers (no New game: that is only in the ☰ menu); a reload keeps it all.
//
// Usage: npm run e2e:stickers [-- <out dir>]   (default out: e2e-out/stickers)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/stickers";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5395, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const shown = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).display !== "none" && !e.closest("[hidden]") && e.getBoundingClientRect().width > 0), sel);
/** Tap an element as a finger does, once it's drawn and has stood still past the card tap guard. */
const tap = async (selector, text) => {
  await settle();
  await p.waitForTimeout(400);
  const r = await p.evaluate(
    ({ s, text }) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)));
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    { s: selector, text },
  );
  if (r) await p.touchscreen.tap(r.x, r.y);
  return !!r;
};
const start = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
};

// 1. A new game.
await p.goto(PAGE);
await start();
// Every toast shown, as it shows.
await p.evaluate(() => {
  window.__toasts = [];
  const t = document.querySelector(".toast");
  new MutationObserver(() => {
    if (t.classList.contains("show") && window.__toasts.at(-1) !== t.textContent) window.__toasts.push(t.textContent);
  }).observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
});

// 2. Setup shortcut (named; not what's tested): every core goal but "Connect every town" marked done, as if played
// (the goals play-through reaches them the player's way). That includes "Buy some land" (after Connect three towns):
// Connect every town is the last goal in the goals' order, so the last link is the goal that completes the core. The stickers aren't touched.
const towns = await p.evaluate(async () => {
  const { GOALS } = await import("/src/game/goals.ts");
  const w = window.woodrail;
  const g = w.goals();
  for (const goal of GOALS) if (goal.id !== "join-all") g.done.add(goal.id);
  // The towns in a chain, each to the nearest not yet in it, so the links are short.
  // (From the town farthest out, so the last one to join is among the others, near the line.)
  const all = [...w.world.landscape.towns];
  const mid = { x: all.reduce((a, t) => a + t.centre.x, 0) / all.length, z: all.reduce((a, t) => a + t.centre.z, 0) / all.length };
  all.sort((a, b) => Math.hypot(b.centre.x - mid.x, b.centre.z - mid.z) - Math.hypot(a.centre.x - mid.x, a.centre.z - mid.z));
  const chain = [all.shift()];
  while (all.length > 0) {
    const at = chain.at(-1).centre;
    all.sort((a, b) => Math.hypot(a.centre.x - at.x, a.centre.z - at.z) - Math.hypot(b.centre.x - at.x, b.centre.z - at.z));
    chain.push(all.shift());
  }
  // On the starter map, an order the pathfinder is known to manage (probed headless: the last link, to Thimble Cross,
  // is a long one round the hills).
  const known = ["Larkfield", "Elderwick", "Ashcombe", "Brambleton", "Thimble Cross"];
  const names = new Set(w.world.landscape.towns.map((t) => t.name));
  if (names.size === known.length && known.every((n) => names.has(n))) return known.map((n) => w.world.landscape.towns.find((t) => t.name === n)).map((t) => ({ id: t.id, name: t.name }));
  return chain.map((t) => ({ id: t.id, name: t.name }));
});
check("setup: the map has 3 or more towns", towns.length >= 3, towns.map((t) => t.name).join(", "));
await settle();
check("…a sticker not yet earned, no dot, no Stickers tab", (await p.evaluate(() => window.woodrail.stickers().count)) === 0 && !(await shown(".goals-dot")) && !(await shown(".goals-tab:nth-child(3)")));

/**
 * The player lays track from what's on the line (a station or yard with a free end) to `to` (a station or yard): the
 * game's own pathfinder, through the editor (the placement rules the player's draws go through; drawing by finger is
 * e2e:draw's). Each end tried in turn.
 */
const link = (froms, to) =>
  p.evaluate(
    async ({ froms, to }) => {
      const { play } = await import("/src/play/player.ts");
      const { rulesFor } = await import("/src/play/rules.ts");
      const { connectorRef } = await import("/src/track/layout.ts");
      const w = window.woodrail;
      const piece = (x) => (typeof x === "number" ? w.world.stations.get(x) : [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === x));
      const z = piece(to);
      for (const from of froms.map(piece))
        for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
          if (from === undefined || z === undefined || w.layout.joinedConnector(connectorRef(from, i)) >= 0) continue;
          const r = play(w.world.layout, w.editor(), connectorRef(from, i), connectorRef(z, j), { blocked: rulesFor(w.world), maxPieces: 120, fiddle: 3 });
          if (r.ok) return { ok: true };
        }
      return { ok: false };
    },
    { froms, to },
  );
const track = () => p.evaluate(async () => (await import("/src/game/stickers.ts")).ownTrack(window.woodrail.world));
const joinedTowns = () => p.evaluate(() => window.woodrail.goals().current()?.check(window.woodrail.world)?.count ?? 0);

// 3. The player joins the towns one by one, nearest first, from any station on the line, then lays a goods line from
// the forest yard to the sawmill: Track layer is earned along the way, quietly, before the last town is joined.
const joined = [towns[0]];
const left = towns.slice(1);
let laid = true;
while (left.length > 1) {
  let done = -1;
  for (let k = 0; k < left.length && done < 0; k++) {
    // (The last town left is kept for the last link.)
    if ((await link(joined.map((t) => t.id).reverse(), left[k].id)).ok) done = k;
  }
  if (done < 0) {
    laid = false;
    break;
  }
  const [t] = left.splice(done, 1);
  joined.push(t);
  check(`the player joins ${t.name}`, true, `${await track()} pieces of track, ${await joinedTowns()} towns joined`);
}
check("…every town but one joined", laid && left.length === 1, left.map((t) => t.name).join(", "));
if ((await track()) < 40) {
  // (Whether it gets there or not, what's laid is laid.)
  await link(["depot-forest"], "depot-sawmill");
  check("the player lays track from the forest yard toward the sawmill", true, `${await track()} pieces of track`);
}
const pieces = await track();
check("…40 pieces or more laid before the last link", pieces >= 40, `${pieces}`);
await p.waitForFunction(() => window.woodrail.stickers().has("track-layer"), null, { timeout: 60000, polling: 500 }).catch(() => {});
await settle();
const quiet = await p.evaluate(() => ({ earned: window.woodrail.stickers().ids(), toasts: window.__toasts.filter((t) => t.includes("Sticker")), joinAll: window.woodrail.goals().isDone("join-all") }));
check("Track layer is earned by laying track", quiet.earned.includes("track-layer"), JSON.stringify(quiet));
check("…quietly: no sticker toast, the core not done", quiet.toasts.length === 0 && !quiet.joinAll, JSON.stringify(quiet));
check("…a dot on the folded chip", await shown(".goals.collapsed .goals-dot"));
await tap(".goals-head");
await p.waitForFunction(() => !document.querySelector(".goals").classList.contains("collapsed"), null, { timeout: 10000 }).catch(() => {});
const tabs = await p.evaluate(() => [...document.querySelectorAll(".goals-tab")].filter((t) => !t.hidden).map((t) => t.textContent));
check("…the open Journal has no Stickers tab yet (Goals and News only)", !tabs.some((t) => t.startsWith("Stickers")), JSON.stringify(tabs));
await shot("1-dot-before-core");
await tap(".goals-close");
await p.waitForFunction(() => document.querySelector(".goals").classList.contains("collapsed"), null, { timeout: 10000 }).catch(() => {});

// 4. The last link: every town joined. The goal's toast, then the Stickers one.
// Harness shortcut (named; not what's tested): the Stickers toast is kept up for a minute, not its 5.2 s. Headless,
// SwiftShader takes 3–5 s to draw one frame of the map at this size, and a tap sent as the toast came on was handled
// only after that frame, 8 s later, by when the toast had gone and the tap fell to the map (QA 2026-11-01: 7 fails;
// traced with long-animation-frame entries: 27 ms of script, the rest the GPU). On a phone a frame is milliseconds. What
// is tested is that the toast comes, after the goal's, and that a tap on it opens the Stickers tab, not how long it stays.
await p.evaluate(() => {
  const hud = window.woodrail.hud;
  const toast = hud.toast.bind(hud);
  hud.toast = (message, celebrate, ms, tap) => toast(message, celebrate, message.startsWith("🌟 Stickers!") ? 60000 : ms, tap);
});
const last = await link(joined.map((t) => t.id).reverse(), left[0].id);
check(`the player lays the last link, to ${left[0].name}`, last.ok, `${await track()} pieces of track`);
await p.waitForFunction(() => window.woodrail.goals().isDone("join-all"), null, { timeout: 60000, polling: 500 }).catch(() => {});
check("…Connect every town is done: the core goals are all done", await p.evaluate(() => window.woodrail.goals().current() === null && window.woodrail.goals().lockedCount === 0));
await p.waitForFunction(() => window.__toasts.some((t) => t.startsWith("🌟 Stickers!")), null, { timeout: 60000, polling: 300 }).catch(() => {});
const toasts = await p.evaluate(() => window.__toasts.slice());
const at = toasts.findIndex((t) => t.startsWith("🌟 Stickers!"));
check("…a toast: “🌟 Stickers! You've earned 2 already…”, after the goal's own", at > 0 && /earned 2 already/.test(toasts[at]) && toasts.slice(0, at).some((t) => /Connect every town/.test(t)), JSON.stringify(toasts));
check("…Every town earned too", await p.evaluate(() => window.woodrail.stickers().has("all-towns")));
check("…the dot still on the chip (not seen yet)", await shown(".goals.collapsed .goals-dot"));
// The toast is tapped while it's up (it waits its turn in the queue).
await p.waitForFunction(() => document.querySelector(".toast.show")?.textContent.startsWith("🌟 Stickers!"), null, { timeout: 60000, polling: 200 }).catch(() => {});
// (Tapped at once: it's up for 5 s, and a headless frame can take seconds.)
const where = await p.evaluate(() => {
  const t = document.querySelector(".toast.show");
  if (!t?.textContent.startsWith("🌟 Stickers!")) return null;
  const r = t.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
if (where) await p.touchscreen.tap(where.x, where.y);
const tapped = !!where;
await p.waitForFunction(() => !document.querySelector(".goals").classList.contains("collapsed"), null, { timeout: 10000 }).catch(() => {});
const pane = await p.evaluate(() => ({
  open: !document.querySelector(".goals").classList.contains("collapsed"),
  tab: document.querySelector(".goals-tab.on")?.textContent,
  count: document.querySelector(".stickers-count")?.textContent,
  got: [...document.querySelectorAll(".sticker.got")].map((e) => e.dataset.id),
  hidden: [...document.querySelectorAll(".sticker:not(.got)")].filter((e) => e.textContent.includes("???")).length,
  tiles: [...document.querySelectorAll(".sticker")].map((e) => Math.round(e.getBoundingClientRect().width)),
  rows: new Set([...document.querySelectorAll(".stickers-grid")].slice(0, 1).flatMap((g) => [...g.children].map((e) => Math.round(e.getBoundingClientRect().top)))).size,
}));
await shot("2-toast-tapped");
check("a tap on the toast opens the Journal on the Stickers tab", tapped && pane.open && pane.tab === "Stickers", JSON.stringify(pane));
check("…“🌟 2 / 27 stickers”, Track layer and Every town in colour", pane.count === "🌟 2 / 27 stickers" && pane.got.includes("track-layer") && pane.got.includes("all-towns") && pane.got.length === 2, JSON.stringify(pane));
check("…hidden ones as ???; tiles 64 px or more (44 px taps)", pane.hidden >= 1 && pane.tiles.every((w) => w >= 64), JSON.stringify(pane.tiles));
await shot("3-stickers-tab");
// The harbour stickers (earned on a boat's trade: unit tests in stickers.test.ts) are there to collect, not yet earned.
const sea = await p.evaluate(() => ["harbour-seller", "harbour-buyer", "sea-trader", "long-line", "rush-hour"].map((id) => document.querySelector(`.sticker[data-id="${id}"]`)?.textContent ?? null));
check("…Ahoy, seller!, Ahoy, buyer! and Long line to collect; Sea trader and Rush hour as ???", sea[0]?.includes("Ahoy, seller!") && sea[1]?.includes("Ahoy, buyer!") && sea[2]?.includes("???") && sea[3]?.includes("Long line") && sea[4]?.includes("???"), JSON.stringify(sea));
await tap('.sticker[data-id="track-layer"]');
const t1 = await p.evaluate(() => document.querySelector(".sticker-ticket")?.textContent);
check("a tap on Track layer shows its ticket", /Track layer.*Earned! Lay 40 pieces of track/.test(t1 ?? ""), t1);
await tap(".sticker:not(.got)", "???");
const t2 = await p.evaluate(() => document.querySelector(".sticker-ticket")?.textContent);
check("a tap on a hidden one shows its hint", /^\?\?\? Hint: /.test(t2 ?? ""), t2);
await p.waitForFunction(() => !document.querySelector(".goals-dot") || document.querySelector(".goals-dot").hidden, null, { timeout: 5000 }).catch(() => {});
check("looking at the tab clears the dot", !(await shown(".goals-dot")));
await tap(".goals-tab", "Goals");
const allDone = await p.evaluate(() => document.querySelector(".goals-pane")?.textContent ?? "");
check("the Goals tab: all done, keep building and collect stickers", /All goals done!/.test(allDone) && /Keep building, and collect stickers/.test(allDone), allDone);
check("…no New game in the card (it lives in the ☰ menu)", !(await shown(".goals-pane .goals-new")) && !/New game/.test(allDone), allDone);
await shot("4-goals-done");
await tap(".goals-pane .goals-stickers", "See stickers");
const onTab = await p.evaluate(() => ({ tab: document.querySelector(".goals-tab.on")?.textContent, grid: !!document.querySelector(".stickers-pane:not([hidden]) .sticker") }));
check("…See stickers opens the Stickers tab", /^Stickers/.test(onTab.tab ?? "") && onTab.grid, JSON.stringify(onTab));
await tap(".goals-close");
await p.waitForFunction(() => document.querySelector(".goals").classList.contains("collapsed"), null, { timeout: 10000 }).catch(() => {});
const chip = await p.evaluate(() => document.querySelector(".goals-now")?.textContent);
check("the folded chip: “Goals ✓ · 🌟 2 / 27”", chip === "Goals ✓ · 🌟 2 / 27", chip);
await shot("5-chip");

// 5. A reload keeps the stickers (and the tab, with no toast this time).
await p.evaluate(() => window.woodrail.flushSave?.());
await p.waitForTimeout(3000);
await p.reload();
await start();
await p.waitForFunction(() => window.woodrail.goals().current() === null, null, { timeout: 30000 }).catch(() => {});
await settle();
const after = await p.evaluate(() => ({ ids: window.woodrail.stickers().ids(), tab: [...document.querySelectorAll(".goals-tab")].some((t) => !t.hidden && t.textContent.startsWith("Stickers")), dot: !document.querySelector(".goals-dot").hidden }));
check("a reload keeps them: the tab there, no dot", after.ids.includes("track-layer") && after.ids.includes("all-towns") && after.tab && !after.dot, JSON.stringify(after));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
