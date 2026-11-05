// End-to-end water transport (docs/superpowers/specs/2026-11-04-water-transport.md), Game mode on a 390×844 phone
// with touch, headless:
//  1. river: River barges learned; two river landings dragged from the Industries tab's Water shelf onto the river's
//     bank by a finger (a refusal first, dropped on dry land); logs on the first landing's jetty; its card's
//     "+ New barge" tapped (coins paid, the barge loads the logs, planning starts with this landing stop 1); the second
//     landing tapped (stop 2), Done; the boat sails by game time and drops the logs at the second landing (the payoff),
//     "Float goods down the river" ticked; a tap on the boat opens its card; + Barge; paused, it holds still; 0 frames
//     drawn idle with every boat tied up.
//  2. ship: the coast bought; Harbours and Cargo ships learned; a harbour by the sea (put down as the workshop would),
//     a lighthouse dragged from the Water shelf beside it (its card says so); planks on the quay; the cargo ship calls,
//     takes them and pays a town's full price (the payoff), "Send a ship abroad" ticked.
//  3. ferry: Train ferry learned; a ferry slip dragged from the Water shelf onto the shore, track behind it, a train
//     with planks put on its line; its route planned by taps (the engine, Plan a route, the slip, Done): it goes
//     aboard (its planks sold at full price, the train hidden, the ferry sailing), and comes back with goods from abroad.
//
// Usage: npm run e2e:water [-- <out dir>]   (default out: e2e-out/water). Pictures of each moment in the out dir.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/water";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5398, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
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
let passes = 0;
const check = (what, ok, detail = "") => {
  if (ok) passes++;
  else failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.jpg`, quality: 85, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
  await frames();
};
const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
/** A world point's place on screen (CSS px). */
const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y ?? 0, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
/** The camera on a point, from overhead-ish (in the room above any card: `inRoom`). */
const look = async (v, dist = 1300) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, 0, v.z), dist, { duration: 0.2, inRoom: true }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapWorld = async (v) => {
  const [x, y] = await screenOf(v);
  await tapped(() => p.touchscreen.tap(x, y));
};
/** A card button, once it's drawn and has stood still past the card tap guard. */
const tapButton = async (sel) => {
  await p.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0), sel, { timeout: 30000 });
  await frames();
  await p.waitForTimeout(400);
  const [x, y] = await p.evaluate((sel) => {
    const r = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);
  await tapped(() => p.touchscreen.tap(x, y));
};
/** A tray tab, then a shelf on it, by their words. */
const openShelf = async (tab, shelf) => {
  await p.evaluate(() => window.woodrail.hud.hideCards());
  const t = await p.evaluate((tab) => {
    const e = [...document.querySelectorAll(".tabs button")].find((b) => b.textContent.includes(tab));
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, tab);
  await tapped(() => p.touchscreen.tap(...t));
  const back = await p.evaluate(() => {
    const e = [...document.querySelectorAll(".scroller .tray-item")].find((b) => b.querySelector(".label")?.textContent === "Back");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  if (back) await tapped(() => p.touchscreen.tap(...back));
  const s = await p.evaluate((shelf) => {
    const e = [...document.querySelectorAll(".scroller .tray-group")].find((b) => b.querySelector(".label")?.textContent === shelf);
    if (!e) return null;
    e.scrollIntoView({ inline: "center" });
    const r = e.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, shelf);
  if (!s) return false;
  await tapped(() => p.touchscreen.tap(...s));
  return true;
};
/** A tray item dragged out by a finger and let go over a world point (the piece's middle there). */
const dragOut = async (key, v) => {
  await p.evaluate((key) => document.querySelector(`.scroller .tray-item[data-key="${key}"]`)?.scrollIntoView({ inline: "center" }), key);
  await frames();
  const from = await p.evaluate((key) => {
    const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, key);
  if (!from) return false;
  const [tx, ty] = await screenOf(v);
  let t = Date.now() / 1000;
  await touch("touchStart", from[0], from[1], t);
  for (let k = 1; k <= 16; k++) await touch("touchMove", from[0] + ((tx - from[0]) * k) / 16, from[1] + ((ty - from[1]) * k) / 16, (t += 0.04));
  // (A moment held still over the spot: the ghost settles there.)
  for (let k = 0; k < 4; k++) await touch("touchMove", tx, ty, (t += 0.05));
  await frames();
  if (process.env.WATER_DEBUG) await shot(`debug-drag-${key.replace(/[:]/g, "_")}-${Date.now() % 100000}`);
  await touch("touchEnd", 0, 0, (t += 0.05));
  await settle();
  return true;
};
const pieceIds = (type) => p.evaluate((type) => [...window.woodrail.layout.pieceIds()].filter((id) => window.woodrail.layout.getPiece(id).type === type), type);
/** The tray's ↻ Turn chip tapped `n` times (an eighth of a turn each: the next piece out turns with it). */
const turnTray = async (n) => {
  for (let k = 0; k < n; k++) {
    const at = await p.evaluate(() => {
      const e = [...document.querySelectorAll(".tray button.chip")].find((b) => b.textContent.includes("↻"));
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    if (at) await tapped(() => p.touchscreen.tap(...at));
  }
};
const toast = () => p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
/** Game time passing (the page's own clock), up to `seconds` of it, till `done` is true in the page. */
const playUntil = async (fn, arg, seconds) => {
  const t0 = await p.evaluate(() => window.woodrail.simSeconds);
  for (;;) {
    const r = await p.evaluate(fn, arg);
    if (r) return r;
    const t = await p.evaluate(() => window.woodrail.simSeconds);
    if (t - t0 > seconds) return null;
    await p.waitForTimeout(1000);
  }
};

// A new game.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// ——— 1. River ———
// Setup (not what's tested): Train routes, Cranes 1 and River barges learned (a shortcut to the state), 400 coins, and
// two landings in the toy box (as the workshop's order would make them). A straight run of river on this map: where
// the landings go, on its flat bank.
const river = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const r of ["routes", "cranes1", "barges"]) w.learn(r);
  w.progress().coins = 400;
  w.hud.setCoins(400);
  w.progress().add("piece:kit-landing", 2);
  w.hud.refreshTrayBadges();
  const { siteWhy } = await import("/src/game/industries.ts");
  const g = w.world.landscape.grid;
  // Landings on the −z bank of a river running along x: the piece's middle 100 back from the water's middle.
  const spots = [];
  const why = { runs: 0, site: 0, place: [] };
  for (let i = 0; i < g.cellCount; i++) {
    if (g.surface[i] !== 1) continue;
    const c = g.colOf(i);
    const r = g.rowOf(i);
    const at = (dc, dr) => g.surface[g.index(c + dc, r + dr)] ?? -1;
    let run = true;
    for (let k = -4; k <= 4; k++) if (at(k, 0) !== 1 || at(k, -1) === 1 || at(k, -2) === 1 || at(k, 2) === 1) run = false;
    if (!run) continue;
    why.runs++;
    const pose = { x: g.centreX(c) - 108, z: g.centreZ(r) - 100, heading: 0 };
    if (siteWhy(w.world.landscape, "kit-landing", pose) !== null) continue;
    why.site++;
    // Flat, clear ground for the quay.
    const no = w.interaction.placeWhy("kit-landing", pose, g.groundY(g.cellAtWorld(pose.x + 108, pose.z)), -1);
    if (no) {
      if (why.place.length < 5) why.place.push(no);
      continue;
    }
    spots.push({ ...pose, mid: { x: pose.x + 108, z: pose.z } });
  }
  // Two far apart on the same water.
  const { waterAt } = await import("/src/game/boats.ts");
  let best = null;
  for (const a of spots)
    for (const b of spots)
      if (waterAt(w.world.landscape, { x: a.mid.x, z: a.mid.z + 100 }) === waterAt(w.world.landscape, { x: b.mid.x, z: b.mid.z + 100 }) && Math.abs(a.x - b.x) > 500 && (!best || Math.abs(a.x - b.x) > Math.abs(best[0].x - best[1].x))) best = [a, b];
  return best ? { a: best[0], b: best[1], n: spots.length } : { n: spots.length, why };
});
check("a straight run of river with room for two landings", !!river.a, JSON.stringify(river));
// (WATER_SKIP_RIVER=1: on to the sea, for working on its groups.)
if (river.a && !process.env.WATER_SKIP_RIVER) {
  const { a, b: bb } = river;
  // The Water shelf.
  const shelfOk = await openShelf("Industries", "Water");
  check("the Industries tab has a Water shelf once River barges is learned", shelfOk);
  const keys = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item[data-key]")].map((e) => e.dataset.key));
  check("…with the river landing on it", keys.includes("piece:kit-landing"), JSON.stringify(keys));
  await shot("1-water-shelf");
  // Dropped on dry land, far from the water: refused, saying why.
  await look(a.mid, 1500);
  await dragOut("piece:kit-landing", { x: a.mid.x, z: a.mid.z - 500 });
  const refused = (await pieceIds("kit-landing")).length === 0;
  if (process.env.WATER_DEBUG) console.log("heading", await p.evaluate(() => JSON.stringify([...window.woodrail.layout.pieceIds()].slice(-3).map((id) => window.woodrail.layout.getPiece(id)))));
  if (process.env.WATER_DEBUG) console.log("after dry drop", JSON.stringify(await pieceIds("kit-landing")), await p.evaluate(() => JSON.stringify([window.woodrail.progress().owned.get("piece:kit-landing"), window.woodrail.layout.pieceIds().length])));
  check("a landing dropped on dry land is refused", refused, await toast());
  // On the bank, turned so its jetty faces the water (the tray's ↻ Turn, half way round): placed.
  await openShelf("Industries", "Water");
  await turnTray(Number(process.env.WATER_TURNS ?? 4));
  await look(a.mid, 1500);
  await dragOut("piece:kit-landing", a.mid);
  await openShelf("Industries", "Water");
  await look(bb.mid, 1500);
  await dragOut("piece:kit-landing", bb.mid);
  const landings = await p.evaluate(() => {
    const w = window.woodrail;
    return [...w.layout.pieceIds()]
      .filter((id) => w.layout.getPiece(id).type === "kit-landing")
      .map((id) => ({ piece: id, depot: w.economy.depotAtPiece(id)?.id, role: w.economy.depotAtPiece(id)?.role, x: w.layout.getPiece(id).pose.x, z: w.layout.getPiece(id).pose.z, heading: w.layout.getPiece(id).pose.heading }));
  });
  check("two landings dragged out onto the river bank, each a landing depot", landings.length === 2 && landings.every((l) => l.role === "landing"), JSON.stringify(landings));
  if (landings.length === 2) {
    // Logs on the first landing's jetty (setup: as a train set to drop them there would leave them).
    const [A, B] = [...landings].sort((u, v) => Math.hypot(u.x - a.x, u.z - a.z) - Math.hypot(v.x - a.x, v.z - a.z));
    await p.evaluate(async (id) => {
      const { CARGO } = await import("/src/economy/cargo.ts");
      window.woodrail.economy.depot(id).piles[CARGO.log.index] = 8;
    }, A.depot);
    const quay = (L) => ({ x: L.x + Math.cos(L.heading) * 108 - Math.sin(L.heading) * 45, z: L.z + Math.sin(L.heading) * 108 + Math.cos(L.heading) * 45 });
    await look(quay(A), 1100);
    await tapWorld(quay(A));
    if (process.env.WATER_DEBUG) await shot("debug-landing-tap");
    const card = await p.evaluate(() => document.querySelector(".depot-card:not(.boat-card):not([hidden]) .card-title")?.textContent ?? null);
    if (process.env.WATER_DEBUG) console.log("cards", await p.evaluate(() => [...document.querySelectorAll(".card:not([hidden])")].map((c) => c.className + ":" + c.textContent.slice(0, 60)).join(" || ")));
    check("a tap on the landing opens its card", card === "River landing", String(card));
    await p.waitForSelector(".landing-buy", { timeout: 20000 }).catch(() => {});
    const coins0 = await p.evaluate(() => window.woodrail.progress().coins);
    await shot("2-landing-card");
    await tapButton(".landing-buy");
    const bought = await p.evaluate(() => {
      const w = window.woodrail;
      const boats = [...w.economy.boats.values()];
      return { n: boats.length, coins: w.progress().coins, load: boats[0]?.load, card: !document.querySelector(".boat-card").hidden, planning: !!w.interaction.onPickPlace };
    });
    check("+ New barge: a boat bought for 80 coins, loaded with the logs on the jetty, its card open and planning", bought.n === 1 && bought.coins === coins0 - 80 && bought.load?.log === 4 && bought.card && bought.planning, JSON.stringify(bought));
    await shot("3-boat-bought");
    // The second landing tapped: stop 2. Done.
    await look(quay(B), 1300);
    await tapWorld(quay(B));
    await shot("4-planning");
    await tapButton(".boat-card .route-plan.on");
    const route = await p.evaluate(() => [...window.woodrail.economy.boats.values()][0].stops);
    check("the route planned by taps: the first landing (Pick up), the second (Only drop)", route.length === 2 && route[0].depotId === A.depot && route[1].depotId === B.depot && route[0].action === "pick" && route[1].action === "drop", JSON.stringify(route));
    // It sails, by game time, and drops the logs at the second landing.
    await look({ x: (A.x + B.x) / 2 + 108, z: A.z + 120 }, 2200);
    await p.evaluate(() => window.woodrail.hud.hideCards());
    const sailing = await playUntil(() => [...window.woodrail.economy.boats.values()][0]?.docked === false, null, 30);
    check("it sets off down the river", !!sailing);
    await p.waitForTimeout(3000);
    await shot("5-sailing");
    const delivered = await playUntil(
      async (B) => {
        const { CARGO } = await import("/src/economy/cargo.ts");
        const w = window.woodrail;
        const n = w.economy.depot(B).piles[CARGO.log.index];
        return n > 0 ? { n, delivered: w.economy.boatDelivered } : null;
      },
      B.depot,
      240,
    );
    check("the logs come off at the second landing (the payoff)", !!delivered && delivered.n === 4 && delivered.delivered === 4, JSON.stringify(delivered));
    const goal = await playUntil(() => window.woodrail.goals().isDone("float-goods"), null, 10);
    check("…and Float goods down the river is ticked", !!goal);
    await look(quay(B), 1000);
    await shot("6-delivered");
    // A tap on the boat: its card.
    const tug = await p.evaluate(() => {
      const o = window.woodrail.riverBoats.tugOf([...window.woodrail.economy.boats.keys()][0]);
      return o ? { x: o.position.x, y: 10, z: o.position.z } : null;
    });
    if (tug) {
      await look(tug, 900);
      await tapWorld(tug);
    }
    const boatCard = await p.evaluate(() => (document.querySelector(".boat-card")?.hidden === false ? document.querySelector(".boat-card .boat-name")?.textContent : null));
    check("a tap on the boat opens its card", !!boatCard, String(boatCard));
    await shot("7-boat-card");
    // + Barge.
    if (boatCard) await tapButton(".boat-card .boat-actions .chip");
    const barges = await p.evaluate(() => [...window.woodrail.economy.boats.values()][0].barges);
    check("+ Barge on its card: a second barge", barges === 2, String(barges));
    // Paused: it holds still (its place by game time).
    await p.evaluate(() => (window.woodrail.paused = true));
    const at0 = await p.evaluate(() => JSON.stringify(window.woodrail.fleet.poses([...window.woodrail.economy.boats.values()][0], 0)));
    await p.waitForTimeout(3000);
    const at1 = await p.evaluate(() => JSON.stringify(window.woodrail.fleet.poses([...window.woodrail.economy.boats.values()][0], 0)));
    check("paused, the boat holds still", at0 === at1);
    await p.evaluate(() => (window.woodrail.paused = false));
    // Idle with every boat tied up: no frames drawn.
    await p.evaluate(() => {
      for (const bt of window.woodrail.economy.boats.values()) bt.going = false;
      window.woodrail.hud.hideCards();
    });
    await settle();
    const drawn = await p.evaluate(async () => {
      const w = window.woodrail;
      const before = w.framesDrawn;
      await new Promise((r) => setTimeout(r, 3000));
      return w.framesDrawn - before;
    });
    check("idle with the boats tied up: no frames drawn", drawn === 0, `${drawn} frames`);
  }
}

// ——— 2. Ship ———
// Setup (not what's tested): the coast bought (as Add land would), Harbours, Cargo ships and Lighthouse learned, a
// harbour by the sea put down (as the workshop's would be: the harbour isn't what's tested), a lighthouse in the toy
// box, and planks and stone on its quay (as trains would leave them).
const sea = await p.evaluate(async () => {
  const w = window.woodrail;
  const { plotsForSale, syncIndustries } = await import("/src/game/world.ts");
  const { siteWhy } = await import("/src/game/industries.ts");
  const { QUAY } = await import("/src/game/harbours.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const coast = w.world.landscape.coast;
  for (const q of plotsForSale(w.world.landscape)) if ((coast.side === "s" && q.pz === coast.plot) || (coast.side === "n" && q.pz === -coast.plot) || (coast.side === "e" && q.px === coast.plot) || (coast.side === "w" && q.px === -coast.plot)) w.unlockPlot(q.px, q.pz);
  for (const r of ["warehouses", "bridges", "harbours", "cargo-ships", "lighthouse", "junctions", "ferry"]) w.learn(r);
  w.progress().add("prop:bldg-lighthouse", 1);
  w.progress().add("piece:kit-ferry-slip", 1);
  w.progress().coins = 400;
  w.hud.setCoins(400);
  w.hud.refreshTrayBadges();
  const g = w.world.landscape.grid;
  let harbour = null;
  for (let i = 0; i < g.cellCount && !harbour; i++) {
    if (g.surface[i] !== 5) continue;
    const col = g.colOf(i);
    const row = g.rowOf(i);
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const pose = { x: g.centreX(col) - c * QUAY.t + s * QUAY.l, z: g.centreZ(row) - s * QUAY.t - c * QUAY.l, heading };
      const under = g.cellAtWorld(pose.x + c * 108, pose.z + s * 108);
      if (under === -1 || g.surface[under] === 5 || g.surface[under] === 1) continue;
      if (siteWhy(w.world.landscape, "depot-harbour", pose) !== null) continue;
      if (w.interaction.placeWhy("depot-harbour", pose, g.groundY(under), -1)) continue;
      harbour = pose;
      break;
    }
  }
  if (!harbour) return null;
  const id = w.editor().place("depot-harbour", harbour, g.groundY(g.cellAtWorld(harbour.x + Math.cos(harbour.heading) * 108, harbour.z + Math.sin(harbour.heading) * 108)), false);
  syncIndustries(w.world, true);
  w.depotView.setWorld(w.economy, w.layout);
  const d = w.economy.depotAtPiece(id);
  d.piles[CARGO.planks.index] = 14;
  d.piles[CARGO.stone.index] = 6;
  // Where a lighthouse could stand: land a few squares from the quay, clear of the harbour's yard.
  const q = { x: harbour.x + Math.cos(harbour.heading) * QUAY.t - Math.sin(harbour.heading) * QUAY.l, z: harbour.z + Math.sin(harbour.heading) * QUAY.t + Math.cos(harbour.heading) * QUAY.l };
  let light = null;
  for (const r of [260, 220, 300, 180, 340])
    for (let k = 0; k < 16 && !light; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = q.x + Math.cos(a) * r;
      const z = q.z + Math.sin(a) * r;
      const cell = g.cellAtWorld(x, z);
      if (cell === -1 || g.surface[cell] === 5 || g.surface[cell] === 1) continue;
      if (Math.hypot(x - (harbour.x + Math.cos(harbour.heading) * 108), z - (harbour.z + Math.sin(harbour.heading) * 108)) < 200) continue;
      light = { x, z };
    }
  return { harbour, depot: d.id, quay: q, light, coins: w.progress().coins };
});
check("the coast bought and a harbour by the sea", !!sea, JSON.stringify(sea));
if (sea) {
  // The lighthouse, from the Water shelf onto the shore near the harbour.
  if (sea.light) {
    await openShelf("Industries", "Water");
    await look(sea.light, 1300);
    await dragOut("prop:bldg-lighthouse", sea.light);
  }
  const lit = await p.evaluate(() => [...window.woodrail.world.props.all()].filter((x) => x.asset === "bldg-lighthouse").map((x) => ({ x: x.x, z: x.z })));
  check("a lighthouse dragged from the Water shelf onto the shore", lit.length === 1, JSON.stringify({ lit, toast: await toast() }));
  const card = await p.evaluate(async (id) => {
    const w = window.woodrail;
    const { lighthouseNear } = await import("/src/game/harbours.ts");
    return lighthouseNear(w.world, w.layout.getPiece(w.economy.depot(id).pieceId).pose);
  }, sea.depot);
  check("…near the harbour: its ships come twice as often", card === true);
  // The cargo ship calls, takes the goods and pays a town's full price.
  await look(sea.quay, 1600);
  const coins0 = await p.evaluate(() => window.woodrail.progress().coins);
  const sold = await playUntil(() => (window.woodrail.economy.shipLoads > 0 ? { loads: window.woodrail.economy.shipLoads, coins: window.woodrail.progress().coins } : null), null, 120);
  const full = await p.evaluate(async () => {
    const { PRICES } = await import("/src/game/towns.ts");
    return 14 * PRICES.planks + 6 * PRICES.stone;
  });
  check("a cargo ship calls and takes the 20 loads off the quay at a town's full price (the payoff)", !!sold && sold.loads === 20 && sold.coins - coins0 === full, JSON.stringify({ sold, coins0, full }));
  const goal = await playUntil(() => window.woodrail.goals().isDone("ship-abroad"), null, 10);
  check("…and Send a ship abroad is ticked", !!goal);
  await p.evaluate(() => window.woodrail.hud.hideCards());
  await p.waitForTimeout(1500);
  await shot("8-cargo-ship");

  // ——— 3. Ferry ———
  // A ferry slip from the Water shelf onto the shore, turned to face the sea.
  const slipAt = await p.evaluate(async () => {
    const w = window.woodrail;
    const { slipWhy } = await import("/src/game/ferry.ts");
    const g = w.world.landscape.grid;
    for (let i = 0; i < g.cellCount; i++) {
      if (g.surface[i] !== 5) continue;
      for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const c = Math.cos(heading);
        const s = Math.sin(heading);
        const pose = { x: g.centreX(g.colOf(i)) - c * 256, z: g.centreZ(g.rowOf(i)) - s * 256, heading };
        const back = g.cellAtWorld(pose.x - c * 216, pose.z - s * 216);
        const start = g.cellAtWorld(pose.x, pose.z);
        if (back === -1 || start === -1 || g.surface[start] === 5 || g.surface[back] === 5) continue;
        if (slipWhy(w.world.landscape, pose) !== null) continue;
        if (w.interaction.placeWhy("kit-ferry-slip", pose, g.groundY(start), -1)) continue;
        if (w.interaction.placeWhy("straight-216", { x: pose.x - c * 216, z: pose.z - s * 216, heading }, g.groundY(back), -1)) continue;
        // (Clear of the harbour and its ship's way.)
        if ([...w.layout.pieceIds()].some((id) => Math.hypot(w.layout.getPiece(id).pose.x - pose.x, w.layout.getPiece(id).pose.z - pose.z) < 700)) continue;
        return { ...pose, mid: { x: pose.x + c * 108, z: pose.z + s * 108 } };
      }
    }
    return null;
  });
  check("a shore for a ferry slip", !!slipAt, JSON.stringify(slipAt));
  if (slipAt) {
    await openShelf("Industries", "Water");
    // (The tray's next piece faces half way round: eighth turns to bring it to face the sea.)
    const turns = (((Math.round((slipAt.heading - Math.PI) / (Math.PI / 4)) % 8) + 8) % 8);
    await turnTray(turns);
    await look(slipAt.mid, 1500);
    await dragOut("piece:kit-ferry-slip", slipAt.mid);
    if (process.env.WATER_DEBUG) console.log("slip pieces", await p.evaluate(() => JSON.stringify([...window.woodrail.layout.pieceIds()].slice(-2).map((id) => window.woodrail.layout.getPiece(id)))));
    const slip = await p.evaluate(() => {
      const w = window.woodrail;
      const id = [...w.layout.pieceIds()].find((i) => w.layout.getPiece(i).type === "kit-ferry-slip");
      return id === undefined ? null : { piece: id, depot: w.economy.depotAtPiece(id)?.id, role: w.economy.depotAtPiece(id)?.role, pose: w.layout.getPiece(id).pose };
    });
    check("a ferry slip dragged from the Water shelf onto the shore, its end at the sea", !!slip && slip.role === "slip", JSON.stringify({ slip, toast: await toast() }));
    if (slip) {
      // Setup: the line to it (as Draw would lay it) and a train on it with planks (as the tray would put one down).
      const train = await p.evaluate(async (slip) => {
        const w = window.woodrail;
        const { connectorRef } = await import("/src/track/layout.ts");
        const { appendPiece } = await import("/src/track/index.ts");
        appendPiece(w.layout, "straight-216", false, connectorRef(slip.piece, 0));
        w.syncKits?.(true);
        const placed = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: slip.piece, pathIndex: 0, reversed: false, s: 150 });
        if (placed.kind !== "placed") return { error: placed.kind };
        const t = w.sim.getTrain(placed.trainId);
        w.economy.setCargo(t.cars[1].id, "planks", 3);
        w.economy.setCargo(t.cars[2].id, "planks", 3);
        w.invalidate();
        return { engine: t.cars[0].id, cars: t.cars.map((c) => c.id) };
      }, slip);
      check("a train with 6 planks on the slip's line", !train.error, JSON.stringify(train));
      if (!train.error) {
        // Its route by taps: the engine, Plan a route, the slip, Done.
        const engineAt = await p.evaluate((id) => {
          const f = window.woodrail.sim.findCar(id);
          const [a, c] = [f.train.world[0], f.train.world[1]];
          return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
        }, train.engine);
        await look(engineAt, 1000);
        await tapWorld(engineAt);
        await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
        if (process.env.WATER_DEBUG) await shot("debug-engine-tap");
        await tapButton(".engine-extra .route-plan");
        // (Its coins before: it goes aboard as soon as its route has the slip, at the next second of play.)
        const coins1 = await p.evaluate(() => window.woodrail.progress().coins);
        // (Where the slip stands: the drop snapped it to the lattice.)
        const slipMid = { x: slip.pose.x + Math.cos(slip.pose.heading) * 60, y: 12, z: slip.pose.z + Math.sin(slip.pose.heading) * 60 };
        await look(slipMid, 1300);
        await tapWorld(slipMid);
        if (process.env.WATER_DEBUG) await shot("debug-slip-tap");
        await tapButton(".engine-extra .route-plan.on");
        const routed = await p.evaluate((id) => window.woodrail.economy.routeOf(id)?.stops.map((s) => s.depotId) ?? null, train.engine);
        check("its route planned by taps: the ferry slip", !!routed && routed.includes(slip.depot), JSON.stringify(routed));
        await p.evaluate(() => window.woodrail.hud.hideCards());
        await look({ x: slipAt.mid.x + Math.cos(slipAt.heading) * 500, z: slipAt.mid.z + Math.sin(slipAt.heading) * 500 }, 2000);
        const aboard = await playUntil((id) => (window.woodrail.economy.held.has(id) ? { coins: window.woodrail.progress().coins, hidden: window.woodrail.trainView.carObject(id)?.visible === false } : null), train.engine, 20);
        await p.waitForTimeout(500);
        const aboard2 = await p.evaluate((id) => window.woodrail.trainView.carObject(id)?.visible === false, train.engine);
        const plankPrice = await p.evaluate(async () => (await import("/src/game/towns.ts")).PRICES.planks);
        check("aboard the ferry: its planks sold abroad at a town's full price, the train off the line", !!aboard && aboard.coins - coins1 === 6 * plankPrice && aboard2, JSON.stringify({ aboard, aboard2, coins1 }));
        await p.waitForTimeout(6000);
        await shot("9-ferry-out");
        const back = await playUntil(
          (cars) => {
            const w = window.woodrail;
            if (w.economy.held.has(cars[0]) || w.trainView.carObject(cars[0])?.visible !== true) return null;
            return { loads: cars.map((c) => w.economy.cargoOf(c)), visible: w.trainView.carObject(cars[0])?.visible };
          },
          train.cars,
          130,
        );
        check("back from abroad with its wagons full of goods from abroad, on the line again", !!aboard && !!back && back.loads[1].count > 0 && back.loads[1].kind !== "planks" && back.loads[2].count > 0 && back.visible === true, JSON.stringify(back));
        await look(slipAt.mid, 1200);
        await shot("10-ferry-back");
      }
    }
  }
}

console.log(errors.length ? `page errors: ${errors.join(" / ")}` : "no page errors");
if (errors.length) failures++;
console.log(`${passes}/${passes + failures} passed`);
await b.close();
await server.close();
process.exit(failures ? 1 : 0);
