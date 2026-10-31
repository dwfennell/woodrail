// End-to-end: warehouses (Game mode, a 390×844 phone with touch). A new game; track from the first town's station to
// the forest yard and on to the sawmill, a warehouse on the way. A hand-run train standing at the warehouse: its card
// and a toast say why nothing happens there ("Warehouses trade with trains on a route…"). Then its route planned by
// taps (its engine, Plan a route, the forest, the sawmill, the warehouse, Done; the warehouse stop's chip tapped: its
// options say what Automatic does there): it runs, and planks are dropped at the warehouse. Then a second train, its
// route warehouse → town by taps: planks are picked up there and delivered to the town. Goods counted by the crane's
// own events.
//
// Usage: npm run e2e:warehouse [-- <out dir>]   (default out: e2e-out/warehouse)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/warehouse";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5394, strictPort: false }, logLevel: "error" });
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
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
/** A tap, then its click seen (the click shield counts it too) and a frame after. */
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 60000 }).catch(() => {});
  await frames();
};
const worldAt = (what) =>
  p.evaluate((what) => {
    const w = window.woodrail;
    if (what.engine !== undefined) {
      const t = w.sim.findCar(what.engine).train;
      const [a, c] = [t.world[0], t.world[1]];
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
    }
    const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
    const q = piece.pose;
    return { x: q.x + Math.cos(q.heading) * 108, y: piece.y, z: q.z + Math.sin(q.heading) * 108 };
  }, what);
const onScreen = async (what) => {
  const v = await worldAt(what);
  return p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
  }, v);
};
const showing = async (what, dist = 1300) => {
  const v = await worldAt(what);
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2 }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapOn = async (what) => {
  await showing(what);
  const [x, y] = await onScreen(what);
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
const routeStops = (e) => p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, e);
/** A route planned by taps: the engine, Plan a route, each place on the map, Done. */
const planRoute = async (engine, places) => {
  await tapOn({ engine });
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  if (!(await p.evaluate(() => window.woodrail.hud.engineCardOpen))) await tapOn({ engine });
  await tapButton(".engine-extra .route-plan");
  for (const d of places) await tapOn({ depot: d });
  await tapButton(".engine-extra .route-plan.on");
};

// 1. A new game.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// 2. Setup (not what's tested): Routes and Warehouses learned (a shortcut to the state), track from the first town's
// station to the forest yard and on to the sawmill, laid by the player's own pathfinder, and a straight on the way
// swapped for a warehouse (as a drop would put one in a line). An engine and two flatbeds put down at the warehouse
// (as the tray would), lever off.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  w.learn("routes");
  w.learn("warehouses");
  const town = w.world.landscape.towns[0].id;
  const station = w.world.stations.get(town);
  const depotPiece = (type) => [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === type);
  const forest = depotPiece("depot-forest");
  const sawmill = depotPiece("depot-sawmill");
  if (forest === undefined || sawmill === undefined) return { error: "no forest or sawmill" };
  const lay = (a, b) => {
    const before = new Set(w.layout.pieceIds());
    for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
      if (w.layout.joinedConnector(connectorRef(a, i)) !== -1 || w.layout.joinedConnector(connectorRef(b, j)) !== -1) continue;
      const r = play(w.world.layout, w.editor(), connectorRef(a, i), connectorRef(b, j), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 });
      if (r.ok) return [...w.layout.pieceIds()].filter((id) => !before.has(id));
    }
    return null;
  };
  const toForest = lay(station, forest);
  if (!toForest) return { error: "no track to the forest" };
  const toMill = lay(forest, sawmill);
  if (!toMill) return { error: "no track from the forest to the sawmill" };
  // (A straight in the middle of the station's run, away from both ends.)
  const straights = toForest.filter((id) => w.layout.getPiece(id).type === "straight-216");
  if (straights.length < 3) return { error: `too few straights to the forest: ${straights.length}` };
  const store = w.editor().swap(straights[Math.floor(straights.length / 2)], "depot-warehouse");
  if (store === -1) return { error: "no warehouse swapped in" };
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const ids = { forest: depot(forest, "forest").id, sawmill: depot(sawmill, "sawmill").id, warehouse: depot(store, "warehouse").id, town: w.economy.depotAtPiece(station)?.id };
  const put = () => {
    for (const s of [0, 20, 40, 60]) {
      const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: store, pathIndex: 0, reversed: false, s });
      if (r.kind === "placed") {
        const e = w.sim.getTrain(r.trainId).cars[0].id;
        w.sim.setLever(e, 0);
        return e;
      }
    }
    return -1;
  };
  window.__put = put;
  // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of SwiftShader's few
  // frames a second; the forest kept stocked (its logs aren't what's tested). The crane's events counted by depot.
  const { PILE_CAP } = await import("/src/economy/constants.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  window.__run = (secs) => {
    const n = { loaded: {}, unloaded: {} };
    for (let i = 0; i < secs * 120; i++) {
      if (i % 120 === 0) for (const d of w.economy.allDepots()) if (d.role === "forest") d.piles[CARGO.log.index] = PILE_CAP;
      w.sim.tick();
      w.economy.tick();
      for (const ev of w.economy.drainEvents()) {
        if (ev.kind !== "loaded" && ev.kind !== "unloaded") continue;
        const k = `${ev.depotId}:${ev.cargo}`;
        n[ev.kind][k] = (n[ev.kind][k] ?? 0) + 1;
      }
    }
    w.invalidate();
    return n;
  };
  const engine = put();
  w.invalidate();
  return { ...ids, engine, laid: toForest.length + toMill.length };
});
check("setup: station → warehouse → forest → sawmill, a train at the warehouse", !setup.error && setup.engine !== -1 && setup.town !== undefined, JSON.stringify(setup));
if (!setup.error && setup.engine !== -1) {
  const { forest, sawmill, warehouse, town, engine } = setup;
  const STORE_NO_ROUTE = "Warehouses trade with trains on a route. Plan a route with a stop here";
  const planks = (d) => p.evaluate(async (d) => (await import("/src/economy/cargo.ts")).CARGO.planks.index, null).then((i) => p.evaluate(([d, i]) => window.woodrail.economy.depot(d).piles[i], [d, i]));

  // 3. A hand-run train at the warehouse: a toast says why nothing happens (once), and so does its card.
  await p.waitForFunction((t) => window.woodrail.hud.hasToast(t), STORE_NO_ROUTE, { timeout: 30000 }).catch(() => {});
  check("a hand-run train at the warehouse: a toast says why and what to do", await p.evaluate((t) => window.woodrail.hud.hasToast(t), STORE_NO_ROUTE));
  await shot("1-toast");
  await tapOn({ engine });
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  await settle();
  const status = await p.evaluate(() => document.querySelector(".engine-card .engine-status")?.textContent ?? [...document.querySelectorAll(".engine-card *")].map((e) => e.textContent).find((t) => /Warehouses trade/.test(t)) ?? null);
  check("…its engine card says it too", status === STORE_NO_ROUTE, JSON.stringify(status));
  await shot("2-card-hand-run");
  await p.keyboard.press("Escape");

  // 4. The warehouse's own card: what it holds, and how to use it.
  await tapOn({ depot: warehouse });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await settle();
  const storeCard = await p.evaluate(() => ({ open: window.woodrail.hud.depotCardOpen, stock: document.querySelector(".depot-stock")?.textContent, help: document.querySelector(".depot-help")?.textContent }));
  check("the warehouse's card: Empty, and how to use it", storeCard.open && storeCard.stock === "Empty" && /^Drop goods here to keep them for later/.test(storeCard.help ?? ""), JSON.stringify(storeCard));
  await shot("3-warehouse-card");
  await p.keyboard.press("Escape");

  // 5. Its route by taps: the forest, the sawmill, the warehouse. The card points to the warehouse stop's options; its
  // chip tapped, they say what Automatic does there.
  await planRoute(engine, [forest, sawmill, warehouse]);
  const stops1 = await routeStops(engine);
  check("route 1 planned by taps: forest, sawmill, warehouse", JSON.stringify(stops1) === JSON.stringify([forest, sawmill, warehouse]), JSON.stringify(stops1));
  const hint = await p.evaluate(() => [...document.querySelectorAll(".engine-extra .route-hint")].map((e) => e.textContent));
  check("…the card points to the warehouse stop's options", hint.includes("Tap the warehouse stop to set Only drop or Only pick up"), JSON.stringify(hint));
  await tapButton(".engine-extra .route-chip:nth-child(3)");
  const opts = await p.evaluate(() => ({ action: document.querySelector(".engine-extra .route-action")?.textContent, what: document.querySelector(".engine-extra .route-store")?.textContent, hints: [...document.querySelectorAll(".engine-extra .route-hint")].map((e) => e.textContent) }));
  check("…its chip tapped: Automatic, and what that does at a warehouse", opts.action === "Automatic" && opts.what === "Leaves goods no later stop wants, takes what a later stop wants" && !opts.hints.some((h) => /Tap the warehouse/.test(h)), JSON.stringify(opts));
  await shot("4-route-1-stop-options");
  await p.keyboard.press("Escape");

  // 6. It runs: planks are dropped at the warehouse.
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine);
  const run1 = await p.evaluate(() => window.__run(420));
  const dropped = run1.unloaded[`${warehouse}:planks`] ?? 0;
  const held = await planks(warehouse);
  check("route 1: planks dropped at the warehouse", dropped >= 4 && held >= 4, JSON.stringify({ dropped, held, run1 }));
  check("…and logs taken to the sawmill, planks loaded there", (run1.unloaded[`${sawmill}:log`] ?? 0) > 0 && (run1.loaded[`${sawmill}:planks`] ?? 0) > 0, JSON.stringify(run1));
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), engine);
  await p.evaluate(() => window.__run(20));
  await tapOn({ depot: warehouse });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await settle();
  const stockNow = await p.evaluate(() => document.querySelector(".depot-stock")?.textContent);
  const heldNow = await planks(warehouse);
  check("…the warehouse's card lists the planks it holds", stockNow?.includes(`Planks ${heldNow}/24`), JSON.stringify(stockNow));
  await shot("5-warehouse-card-planks");
  await p.keyboard.press("Escape");

  // 7. The first train put away (harness shortcut: the toy box, as a drag there would); a second at the warehouse, its
  // route warehouse → town by taps: planks picked up there, delivered to the town.
  await p.evaluate((e) => (window.woodrail.sim.removeTrain(window.woodrail.sim.findCar(e).train.id), window.woodrail.invalidate()), engine);
  const engine2 = await p.evaluate(() => window.__put());
  check("a second train at the warehouse", engine2 !== -1);
  await planRoute(engine2, [warehouse, town]);
  const stops2 = await routeStops(engine2);
  check("route 2 planned by taps: warehouse, town", JSON.stringify(stops2) === JSON.stringify([warehouse, town]), JSON.stringify(stops2));
  await p.keyboard.press("Escape");
  const before = await planks(warehouse);
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine2);
  const run2 = await p.evaluate(() => window.__run(300));
  const picked = run2.loaded[`${warehouse}:planks`] ?? 0;
  const delivered = run2.unloaded[`${town}:planks`] ?? 0;
  const after = await planks(warehouse);
  check("route 2: planks picked up at the warehouse and delivered to the town", picked >= 4 && delivered >= 4 && after < before, JSON.stringify({ before, after, picked, delivered, run2 }));
  check("…as many delivered as were picked up (give or take a load on board)", delivered <= picked && picked - delivered <= 6, JSON.stringify({ picked, delivered }));
  await shot("6-route-2");
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
