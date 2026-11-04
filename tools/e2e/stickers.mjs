// End-to-end: stickers (spec 2026-10-31-achievements.md, step 2) on a 390×844 phone with touch, in Game mode.
// A sticker is earned by playing (Track layer: 40 pieces of track laid) while the core goals are still going: earned
// quietly, a dot on the Journal's chip, no Stickers tab and no sticker toast; the start's four towns all joined earn no
// town sticker (Every town asks for a map of 5 or more). Then the last core goal (here Buy some land) is met: its toast,
// then "Stickers!", whose tap opens the Journal on the new Stickers tab, with Track layer earned and the town stickers
// to collect (Connected 5, 8 and 12 towns, Every town); a tile's tap shows its ticket; looking at the tab clears the
// dot; the Goals tab says keep building, with See stickers (no New game: that is only in the ☰ menu). The new land's
// town joined earns Connected 5 towns and Every town, each toasted; the chip says "Goals ✓ · 🌟 3 / 25"; a reload
// keeps it all.
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

// 2. Setup shortcut (named; not what's tested): every core goal but "Buy some land" marked done, as if played (the
// goals play-through reaches them the player's way), so land bought is the goal that completes the core. (The last
// goal till 2026-11-04 was "Connect every town", now the Connected … towns and Every town stickers.) The stickers
// aren't touched.
const towns = await p.evaluate(async () => {
  const { GOALS } = await import("/src/game/goals.ts");
  const w = window.woodrail;
  const g = w.goals();
  for (const goal of GOALS) if (goal.id !== "buy-land") g.done.add(goal.id);
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
  // is a long one round the hills; 59 pieces in all). (Its four towns: Ashcombe, a fifth, is on older maps only.)
  const known = ["Larkfield", "Elderwick", "Brambleton", "Thimble Cross"];
  const names = new Set(w.world.landscape.towns.map((t) => t.name));
  if (names.size === known.length && known.every((n) => names.has(n))) return known.map((n) => w.world.landscape.towns.find((t) => t.name === n)).map((t) => ({ id: t.id, name: t.name }));
  return chain.map((t) => ({ id: t.id, name: t.name }));
});
check("setup: the map has 4 towns", towns.length === 4, towns.map((t) => t.name).join(", "));
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
const joinedTowns = () => p.evaluate(async () => (await import("/src/game/stickers.ts")).joinedTowns(window.woodrail.world));

// 3. The player joins the towns one by one, nearest first, from any station on the line: Track layer is earned along
// the way, quietly; every town of the start joined earns no town sticker (Every town asks for a map of 5 or more).
const joined = [towns[0]];
let laid = true;
for (const t of towns.slice(1)) {
  const r = await link(joined.map((x) => x.id).reverse(), t.id);
  if (!r.ok) {
    laid = false;
    break;
  }
  joined.push(t);
  check(`the player joins ${t.name}`, true, `${await track()} pieces of track, ${await joinedTowns()} towns joined`);
}
check("…every town of the start joined", laid && joined.length === 4 && (await joinedTowns()) === 4, joined.map((t) => t.name).join(", "));
if ((await track()) < 40) {
  // (Whether it gets there or not, what's laid is laid.)
  await link(["depot-forest"], "depot-sawmill");
  check("the player lays track from the forest yard toward the sawmill", true, `${await track()} pieces of track`);
}
const pieces = await track();
check("…40 pieces or more laid", pieces >= 40, `${pieces}`);
await p.waitForFunction(() => window.woodrail.stickers().has("track-layer"), null, { timeout: 60000, polling: 500 }).catch(() => {});
await settle();
await p.waitForTimeout(1500);
const quiet = await p.evaluate(() => ({ earned: window.woodrail.stickers().ids(), toasts: window.__toasts.filter((t) => t.includes("Sticker")), core: window.woodrail.goals().current()?.id ?? null }));
check("Track layer is earned by laying track", quiet.earned.includes("track-layer"), JSON.stringify(quiet));
check("…quietly: no sticker toast, the core not done (Buy some land to go)", quiet.toasts.length === 0 && quiet.core === "buy-land", JSON.stringify(quiet));
check("…no town sticker: four towns, all joined, isn't five, nor a map of five", !quiet.earned.some((id) => id === "all-towns" || id.startsWith("towns-")), JSON.stringify(quiet));
check("…a dot on the folded chip", await shown(".goals.collapsed .goals-dot"));
await tap(".goals-head");
await p.waitForFunction(() => !document.querySelector(".goals").classList.contains("collapsed"), null, { timeout: 10000 }).catch(() => {});
const tabs = await p.evaluate(() => [...document.querySelectorAll(".goals-tab")].filter((t) => !t.hidden).map((t) => t.textContent));
check("…the open Journal has no Stickers tab yet (Goals and News only)", !tabs.some((t) => t.startsWith("Stickers")), JSON.stringify(tabs));
await shot("1-dot-before-core");
await tap(".goals-close");
await p.waitForFunction(() => document.querySelector(".goals").classList.contains("collapsed"), null, { timeout: 10000 }).catch(() => {});

// 4. Land bought, with a town on it: Buy some land, the last core goal. Its toast, then the Stickers one.
// Setup shortcut (named): the plot is bought with the game's own `unlockPlot` (what the land card's Add this land does,
// without the coins and the taps: buying land by taps is e2e:sites'), the plot for sale whose town is nearest a town.
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
const plot = await p.evaluate(async () => {
  const { plotsForSale, landForSale } = await import("/src/game/world.ts");
  const w = window.woodrail;
  const land = w.world.landscape;
  const centres = land.towns.map((t) => t.centre);
  let best = null;
  for (const q of plotsForSale(land)) {
    for (const t of landForSale(land, q.px, q.pz).towns) {
      const d = Math.min(...centres.map((c) => Math.hypot(c.x - t.centre.x, c.z - t.centre.z)));
      if (!best || d < best.d) best = { px: q.px, pz: q.pz, d };
    }
  }
  if (!best) return null;
  const got = w.unlockPlot(best.px, best.pz);
  w.invalidate();
  return got ? { ...best, towns: got.towns.map((id) => ({ id, name: land.towns[id].name })) } : null;
});
check("setup: a plot bought with a town on it", !!plot && plot.towns.length > 0, JSON.stringify(plot));
await p.waitForFunction(() => window.woodrail.goals().isDone("buy-land"), null, { timeout: 60000, polling: 500 }).catch(() => {});
check("…Buy some land is done: the core goals are all done", await p.evaluate(() => window.woodrail.goals().current() === null && window.woodrail.goals().lockedCount === 0));
await p.waitForFunction(() => window.__toasts.some((t) => t.startsWith("🌟 Stickers!")), null, { timeout: 60000, polling: 300 }).catch(() => {});
const toasts = await p.evaluate(() => window.__toasts.slice());
const at = toasts.findIndex((t) => t.startsWith("🌟 Stickers!"));
check("…a toast: “🌟 Stickers! You've earned 1 already…”, after the goal's own", at > 0 && /earned 1 already/.test(toasts[at]) && toasts.slice(0, at).some((t) => /Buy some land/.test(t)), JSON.stringify(toasts));
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
const paneNow = () =>
  p.evaluate(() => ({
    open: !document.querySelector(".goals").classList.contains("collapsed"),
    tab: document.querySelector(".goals-tab.on")?.textContent,
    count: document.querySelector(".stickers-count")?.textContent,
    got: [...document.querySelectorAll(".sticker.got")].map((e) => e.dataset.id),
    hidden: [...document.querySelectorAll(".sticker:not(.got)")].filter((e) => e.textContent.includes("???")).length,
    tiles: [...document.querySelectorAll(".sticker")].map((e) => Math.round(e.getBoundingClientRect().width)),
  }));
const pane = await paneNow();
await shot("2-toast-tapped");
check("a tap on the toast opens the Journal on the Stickers tab", tapped && pane.open && pane.tab === "Stickers", JSON.stringify(pane));
check("…“🌟 1 / 25 stickers”, Track layer in colour", pane.count === "🌟 1 / 25 stickers" && pane.got.includes("track-layer") && pane.got.length === 1, JSON.stringify(pane));
check("…hidden ones as ???; tiles 64 px or more (44 px taps)", pane.hidden >= 1 && pane.tiles.every((w) => w >= 64), JSON.stringify(pane.tiles));
// The town stickers to collect: Connected 5, 8 and 12 towns, then Every town.
const tiers = await p.evaluate(() => ["towns-5", "towns-8", "towns-12", "all-towns"].map((id) => document.querySelector(`.sticker[data-id="${id}"]`)?.textContent ?? null));
check("…Connected 5, 8 and 12 towns and Every town to collect", tiers[0]?.includes("Connected 5 towns") && tiers[1]?.includes("Connected 8 towns") && tiers[2]?.includes("Connected 12 towns") && tiers[3]?.includes("Every town"), JSON.stringify(tiers));
await shot("3-stickers-tab");
// The harbour stickers (earned on a boat's trade: unit tests in stickers.test.ts) are there to collect, not yet earned.
const sea = await p.evaluate(() => ["harbour-seller", "harbour-buyer", "sea-trader", "long-line", "rush-hour"].map((id) => document.querySelector(`.sticker[data-id="${id}"]`)?.textContent ?? null));
check("…Ahoy, seller!, Ahoy, buyer! and Long line to collect; Sea trader and Rush hour as ???", sea[0]?.includes("Ahoy, seller!") && sea[1]?.includes("Ahoy, buyer!") && sea[2]?.includes("???") && sea[3]?.includes("Long line") && sea[4]?.includes("???"), JSON.stringify(sea));
await tap('.sticker[data-id="track-layer"]');
const t1 = await p.evaluate(() => document.querySelector(".sticker-ticket")?.textContent);
check("a tap on Track layer shows its ticket", /Track layer.*Earned! Lay 40 pieces of track/.test(t1 ?? ""), t1);
await tap('.sticker[data-id="towns-5"]');
const t5 = await p.evaluate(() => document.querySelector(".sticker-ticket")?.textContent);
check("a tap on Connected 5 towns says how to earn it", /Connected 5 towns.*Join 5 towns by rail, in one network/.test(t5 ?? ""), t5);
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

// 5. The new land's town joined: five towns in one network, every town on the map: Connected 5 towns and Every town,
// each with its toast.
let fifth = { ok: false };
for (const t of plot?.towns ?? []) {
  fifth = await link(joined.map((x) => x.id).reverse(), t.id);
  if (fifth.ok) joined.push(t);
}
check(`the player joins the new land's town${(plot?.towns.length ?? 0) > 1 ? "s" : ""}`, fifth.ok && joined.length === 4 + (plot?.towns.length ?? 0), `${await track()} pieces of track, ${await joinedTowns()} towns joined`);
await p.waitForFunction(() => window.woodrail.stickers().has("towns-5") && window.woodrail.stickers().has("all-towns"), null, { timeout: 60000, polling: 500 }).catch(() => {});
await p.waitForFunction(() => window.__toasts.filter((t) => t.startsWith("🌟 Sticker:")).length >= 2, null, { timeout: 30000, polling: 300 }).catch(() => {});
const five = await p.evaluate(() => ({ ids: window.woodrail.stickers().ids(), toasts: window.__toasts.filter((t) => t.startsWith("🌟 Sticker:")) }));
check("…Connected 5 towns and Every town earned", five.ids.includes("towns-5") && five.ids.includes("all-towns") && !five.ids.includes("towns-8"), JSON.stringify(five));
check("…each with its toast: “🌟 Sticker: Connected 5 towns!”, “🌟 Sticker: Every town!”", five.toasts.includes("🌟 Sticker: Connected 5 towns!") && five.toasts.includes("🌟 Sticker: Every town!"), JSON.stringify(five.toasts));
await tap(".goals-head");
await p.waitForFunction(() => !document.querySelector(".goals").classList.contains("collapsed"), null, { timeout: 10000 }).catch(() => {});
await tap(".goals-tab", "Stickers");
await tap('.sticker[data-id="towns-5"]');
const pane3 = await paneNow();
const t5got = await p.evaluate(() => document.querySelector(".sticker-ticket")?.textContent);
check("the Stickers tab: “🌟 3 / 25 stickers”, Connected 5 towns and Every town in colour", pane3.count === "🌟 3 / 25 stickers" && ["track-layer", "towns-5", "all-towns"].every((id) => pane3.got.includes(id)), JSON.stringify(pane3));
check("…Connected 5 towns' ticket: earned", /Connected 5 towns.*Earned!/.test(t5got ?? ""), t5got);
await shot("5-town-stickers");
await p.screenshot({ path: `${OUT}/town-stickers.jpg`, type: "jpeg", quality: 80, timeout: 120000 }).catch(() => {});
await tap(".goals-close");
await p.waitForFunction(() => document.querySelector(".goals").classList.contains("collapsed"), null, { timeout: 10000 }).catch(() => {});
const chip = await p.evaluate(() => document.querySelector(".goals-now")?.textContent);
check("the folded chip: “Goals ✓ · 🌟 3 / 25”", chip === "Goals ✓ · 🌟 3 / 25", chip);
await shot("6-chip");

// 7. A reload keeps the stickers (and the tab, with no toast this time).
await p.evaluate(() => window.woodrail.flushSave?.());
await p.waitForTimeout(3000);
await p.reload();
await start();
await p.waitForFunction(() => window.woodrail.goals().current() === null, null, { timeout: 30000 }).catch(() => {});
await settle();
const after = await p.evaluate(() => ({ ids: window.woodrail.stickers().ids(), tab: [...document.querySelectorAll(".goals-tab")].some((t) => !t.hidden && t.textContent.startsWith("Stickers")), dot: !document.querySelector(".goals-dot").hidden }));
check("a reload keeps them: the tab there, no dot", ["track-layer", "towns-5", "all-towns"].every((id) => after.ids.includes(id)) && after.tab && !after.dot, JSON.stringify(after));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
