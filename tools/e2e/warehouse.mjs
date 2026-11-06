// End-to-end: warehouses (Game mode, a 390×844 phone with touch). A new game; track from the first town's station to
// the forest yard and on to the sawmill, a warehouse on the way. A hand-run train standing at the warehouse: its card
// and a toast say why nothing happens there ("Warehouses trade with trains on a route…"). Then its route planned by
// taps (its engine, Plan a route, the forest, the sawmill, the warehouse, Done; the warehouse stop's chip tapped: its
// options say what Drop & pick up does there): it runs, and planks are dropped at the warehouse. Then a second train, its
// route warehouse → town by taps: planks are picked up there and delivered to the town. Goods counted by the crane's
// own events. The warehouse's own setting per good, by taps: before anything arrives, planks listed ("+ Add a good")
// and set to Takes only: route 1 still drops them, route 2 picks none up and its card says why ("Not picking up
// planks: the warehouse is set to Takes only"); set back to Takes and gives, route 2 takes them to the town. Last, a
// mine on the line set by a tap to give coal only: a hopper train there leaves with coal only. Then a hopper's own
// card: coal switched off and "Same for all wagons like this on this train": the train leaves with ore only.
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
    if (what.engine !== undefined || what.car !== undefined) {
      const found = w.sim.findCar(what.engine ?? what.car);
      const t = found.train;
      const i = what.car !== undefined ? found.index : 0;
      const [a, c] = [t.world[2 * i], t.world[2 * i + 1]];
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
    }
    const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
    const q = piece.pose;
    const along = what.along ?? 108;
    return { x: q.x + Math.cos(q.heading) * along, y: piece.y, z: q.z + Math.sin(q.heading) * along };
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
  // (Another straight, nearer the station, for the mine later.)
  window.__mineAt = straights[1];
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
  window.__store = ids.warehouse;
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

  // 4b. Its goods, by taps before any arrive: "+ Add a good", Planks, then planks' Takes only.
  const others = await p.evaluate(() => [...document.querySelectorAll(".depot-store .store-row")].map((r) => r.textContent));
  check("…a row for Any other goods, set to Takes and gives", others.length === 1 && /Any other goods/.test(others[0]) && /Takes and gives/.test(others[0]), JSON.stringify(others));
  await tapButton(".depot-store .store-add");
  await tapButton('.depot-store [data-list="planks"]');
  await tapButton('.depot-store [data-kind="planks"][data-mode="in"]');
  const set = await p.evaluate(() => {
    const card = document.querySelector(".depot-card").getBoundingClientRect();
    const btns = [...document.querySelectorAll(".depot-store button:not(.store-unlist)")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.getBoundingClientRect());
    // The small ✕ (take planks off the list) is drawn 22 px with an invisible 44 px reach: a tap 18 px off its middle finds it.
    const x = document.querySelector(".depot-store .store-unlist")?.getBoundingClientRect();
    const reach = !!x && [[18, 0], [-18, 0], [0, 18], [0, -18]].every(([dx, dy]) => document.elementFromPoint(x.left + x.width / 2 + dx, x.top + x.height / 2 + dy)?.closest(".store-unlist"));
    return {
      rows: [...document.querySelectorAll(".depot-store .store-row")].map((r) => r.querySelector(".store-what").textContent),
      pressed: document.querySelector('.depot-store [data-kind="planks"][aria-pressed="true"]')?.dataset.mode,
      mode: window.woodrail.economy.depot(window.__store).modes,
      inside: card.left >= 0 && card.right <= 390,
      small: Math.min(...btns.map((r) => Math.min(r.width, r.height))),
      reach,
    };
  });
  check("…planks listed by taps and set to Takes only (before any arrive)", set.pressed === "in" && /Planks.*0\/24 · Takes only/.test(set.rows[0] ?? ""), JSON.stringify(set));
  check("…the card inside a 390 px screen, its choices 44 px (the ✕'s reach too)", set.inside && set.small >= 44 && set.reach, JSON.stringify(set));
  await shot("3b-warehouse-planks-takes-only");
  await p.keyboard.press("Escape");

  // 5. Its route by taps: the forest, the sawmill, the warehouse. The card points to the warehouse stop's options; its
  // chip tapped, they say what Drop & pick up does there.
  await planRoute(engine, [forest, sawmill, warehouse]);
  const stops1 = await routeStops(engine);
  check("route 1 planned by taps: forest, sawmill, warehouse", JSON.stringify(stops1) === JSON.stringify([forest, sawmill, warehouse]), JSON.stringify(stops1));
  // Under each stop's chip, what it picks up and drops (the economy's own plan).
  const goods1 = await p.evaluate(() => [...document.querySelectorAll(".engine-extra .route-chip")].map((c) => c.querySelector(".route-goods")?.textContent ?? ""));
  check("…each stop shows what it picks up and drops: forest ⬆🪵, sawmill ⬆\uE000 ⬇🪵, warehouse ⬇\uE000", JSON.stringify(goods1) === JSON.stringify(["⬆🪵", "⬆\uE000 ⬇🪵", "⬇\uE000"]), JSON.stringify(goods1));
  const fits = await p.evaluate(() => {
    const card = document.querySelector(".engine-card").getBoundingClientRect();
    const chips = [...document.querySelectorAll(".engine-extra .route-chip")].map((c) => c.getBoundingClientRect().height);
    return { left: card.left, right: card.right, chips };
  });
  check("…the card inside the screen, chips one height", fits.left >= 0 && fits.right <= 390 && new Set(fits.chips.map(Math.round)).size === 1, JSON.stringify(fits));
  const hint = await p.evaluate(() => [...document.querySelectorAll(".engine-extra .route-hint")].map((e) => e.textContent));
  check("…the card points to the warehouse stop's options", hint.includes("Tap the warehouse stop to set Only drop or Only pick up"), JSON.stringify(hint));
  await tapButton(".engine-extra .route-chip:nth-child(3)");
  const opts = await p.evaluate(() => ({ words: document.querySelector(".engine-extra .route-plan-words")?.textContent, action: document.querySelector(".engine-extra .route-mode.on")?.textContent, what: document.querySelector(".engine-extra .route-store")?.textContent, hints: [...document.querySelectorAll(".engine-extra .route-hint")].map((e) => e.textContent) }));
  check("…its chip tapped: \"Drops planks\", Drop & pick up, and what that does at a warehouse", opts.words === "Drops planks" && opts.action === "Drop & pick up" && opts.what === "Leaves goods no later stop wants, takes what a later stop wants" && !opts.hints.some((h) => /Tap the warehouse/.test(h)), JSON.stringify(opts));
  await shot("4-route-1-stop-options");
  await p.keyboard.press("Escape");

  // 6. It runs: planks are dropped at the warehouse.
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine);
  const run1 = await p.evaluate(() => window.__run(420));
  const dropped = run1.unloaded[`${warehouse}:planks`] ?? 0;
  const held = await planks(warehouse);
  check("route 1: planks dropped at the warehouse (Takes only lets them in)", dropped >= 4 && held >= 4, JSON.stringify({ dropped, held, run1 }));
  check("…and logs taken to the sawmill, planks loaded there", (run1.unloaded[`${sawmill}:log`] ?? 0) > 0 && (run1.loaded[`${sawmill}:planks`] ?? 0) > 0, JSON.stringify(run1));
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), engine);
  await p.evaluate(() => window.__run(20));
  await tapOn({ depot: warehouse });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await settle();
  const stockNow = await p.evaluate(() => document.querySelector(".depot-stock")?.textContent);
  const heldNow = await planks(warehouse);
  const rowNow = await p.evaluate(() => document.querySelector(".depot-store .store-row")?.textContent);
  check("…the warehouse's card lists the planks it holds", rowNow?.includes(`Planks`) && rowNow.includes(`${heldNow}/24 · Takes only`) && stockNow === "", JSON.stringify({ rowNow, stockNow }));
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
  const routeCard = () => p.evaluate(() => ({ goods: [...document.querySelectorAll(".engine-extra .route-chip")].map((c) => c.querySelector(".route-goods")?.textContent ?? ""), warn: [...document.querySelectorAll(".engine-extra .route-store-block")].map((e) => e.textContent) }));
  const held2 = await routeCard();
  check("…planks Takes only: nothing to pick up at the warehouse, and the card says why", JSON.stringify(held2.goods) === JSON.stringify(["", ""]) && JSON.stringify(held2.warn) === JSON.stringify(["Not picking up planks: the warehouse is set to Takes only"]), JSON.stringify(held2));
  await shot("6a-route-2-takes-only");
  await p.keyboard.press("Escape");
  const kept = await planks(warehouse);
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine2);
  const run0 = await p.evaluate(() => window.__run(120));
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), engine2);
  await p.evaluate(() => window.__run(10));
  check("route 2 with planks Takes only: none picked up, none delivered", (run0.loaded[`${warehouse}:planks`] ?? 0) === 0 && (run0.unloaded[`${town}:planks`] ?? 0) === 0 && (await planks(warehouse)) === kept, JSON.stringify({ kept, run0 }));

  // Planks set back to Takes and gives, by taps on the warehouse's card.
  await tapOn({ depot: warehouse });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await tapButton('.depot-store [data-kind="planks"][data-mode="both"]');
  const back = await p.evaluate(() => document.querySelector('.depot-store [data-kind="planks"][aria-pressed="true"]')?.dataset.mode);
  check("…planks set back to Takes and gives by a tap", back === "both", JSON.stringify(back));
  await p.keyboard.press("Escape");
  await tapOn({ engine: engine2 });
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  if (!(await p.evaluate(() => window.woodrail.hud.engineCardOpen))) await tapOn({ engine: engine2 });
  await settle();
  const goods2 = await routeCard();
  check("…its stops show it: warehouse ⬆\uE000, town ⬇\uE000, and no warning", JSON.stringify(goods2.goods) === JSON.stringify(["⬆\uE000", "⬇\uE000"]) && goods2.warn.length === 0, JSON.stringify(goods2));
  await shot("6-route-2-plan");
  await p.keyboard.press("Escape");
  const before = await planks(warehouse);
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine2);
  const run2 = await p.evaluate(() => window.__run(300));
  const picked = run2.loaded[`${warehouse}:planks`] ?? 0;
  const delivered = run2.unloaded[`${town}:planks`] ?? 0;
  const after = await planks(warehouse);
  check("route 2: planks picked up at the warehouse and delivered to the town", picked >= 4 && delivered >= 4 && after < before, JSON.stringify({ before, after, picked, delivered, run2 }));
  check("…as many delivered as were picked up (give or take a load on board)", delivered <= picked && picked - delivered <= 6, JSON.stringify({ picked, delivered }));
  await shot("7-route-2-run");

  // 8. An industry that gives two goods: a mine (swapped in on the station's run, as a drop would put one in a line;
  // harness shortcut, as the warehouse's), ore set to Doesn't give by a tap on its card: a hand-run hopper train there
  // leaves with coal only, and the mine keeps its ore.
  const mineSetup = await p.evaluate(async (e2) => {
    const w = window.woodrail;
    w.sim.removeTrain(w.sim.findCar(e2).train.id);
    const piece = w.editor().swap(window.__mineAt, "depot-mine");
    if (piece === -1) return { error: "no mine swapped in" };
    const { CARGO } = await import("/src/economy/cargo.ts");
    const mine = w.economy.depotAtPiece(piece) ?? w.economy.addDepot("mine", piece);
    mine.piles[CARGO.coal.index] = 8;
    mine.piles[CARGO.ore.index] = 8;
    // (Its train is put down after its card is set: standing on the mine, a tap there would take the train.)
    window.__hoppers = (at = piece) => {
      for (const s of [0, 20, 40, 60]) {
        const r = w.sim.addTrain(["engine", "hopper", "hopper"], { pieceId: at, pathIndex: 0, reversed: false, s });
        if (r.kind === "placed") {
          const engine = w.sim.getTrain(r.trainId).cars[0].id;
          w.sim.setLever(engine, 0);
          w.invalidate();
          return engine;
        }
      }
      return -1;
    };
    w.invalidate();
    return { mine: mine.id, ore: CARGO.ore.index };
  }, engine2);
  check("setup: a mine on the line", !mineSetup.error, JSON.stringify(mineSetup));
  if (!mineSetup.error) {
    // (The mine's piece is longer than a straight, its gantry off its middle: a tap along it till its card opens.)
    for (const along of [108, 60, 160, 20, 220, 300]) {
      await tapOn({ depot: mineSetup.mine, along });
      await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 3000 }).catch(() => {});
      if (await p.evaluate(() => window.woodrail.hud.depotCardOpen)) break;
      await p.keyboard.press("Escape");
    }
    await settle();
    const rows0 = await p.evaluate(() => [...document.querySelectorAll(".depot-store .store-row")].map((r) => r.querySelector(".store-what").textContent));
    check("the mine's card: coal and ore, each Gives (and goes in a hopper)", rows0.length === 2 && /Coal.*Gives · 🚃 Hopper$/.test(rows0[0]) && /Ore.*Gives · 🚃 Hopper$/.test(rows0[1]), JSON.stringify(rows0));
    await tapButton('.depot-store [data-kind="ore"][data-mode="off"]');
    const rows1 = await p.evaluate(() => ({ rows: [...document.querySelectorAll(".depot-store .store-row")].map((r) => r.querySelector(".store-what").textContent), small: Math.min(...[...document.querySelectorAll(".depot-store button")].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))) }));
    check("…ore set to Doesn't give by a tap (44 px choices)", /Ore.*Doesn't give · 🚃 Hopper$/.test(rows1.rows[1] ?? "") && rows1.small >= 44, JSON.stringify(rows1));
    await shot("8-mine-coal-only");
    await p.keyboard.press("Escape");
    mineSetup.engine = await p.evaluate(() => window.__hoppers());
    check("…a hopper train put down at the mine", mineSetup.engine !== -1);
    const oreBefore = await p.evaluate(([d, i]) => window.woodrail.economy.depot(d).piles[i], [mineSetup.mine, mineSetup.ore]);
    await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), mineSetup.engine);
    const run3 = await p.evaluate(() => window.__run(60));
    const onBoard = await p.evaluate((e) => window.woodrail.sim.findCar(e).train.cars.filter((c) => c.kind === "hopper").map((c) => window.woodrail.economy.cargoOf(c.id)), mineSetup.engine);
    const oreAfter = await p.evaluate(([d, i]) => window.woodrail.economy.depot(d).piles[i], [mineSetup.mine, mineSetup.ore]);
    check(
      "mine set to coal only: the hopper train leaves with coal only, the ore stays",
      (run3.loaded[`${mineSetup.mine}:coal`] ?? 0) > 0 && (run3.loaded[`${mineSetup.mine}:ore`] ?? 0) === 0 && onBoard.every((c) => c.kind === "coal" || c.count === 0) && oreAfter >= oreBefore,
      JSON.stringify({ run3, onBoard, oreBefore, oreAfter }),
    );

    // 9. A wagon's own goods: the mine set back to give both (a tap); a fresh hopper train at the (empty) warehouse,
    // clear of the mine's piles (a tap there would hand it a load); on a hopper's card (its train tapped, then the
    // hopper), coal switched off, then "Same for all wagons like this on this train". Run back past the mine: it
    // leaves with ore only.
    await p.evaluate((e) => (window.woodrail.sim.removeTrain(window.woodrail.sim.findCar(e).train.id), window.woodrail.invalidate()), mineSetup.engine);
    for (const along of [108, 60, 160, 20, 220, 300]) {
      await tapOn({ depot: mineSetup.mine, along });
      await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 3000 }).catch(() => {});
      if (await p.evaluate(() => window.woodrail.hud.depotCardOpen)) break;
      await p.keyboard.press("Escape");
    }
    await tapButton('.depot-store [data-kind="ore"][data-mode="both"]');
    check("the mine set back to give ore too, by a tap", await p.evaluate((d) => window.woodrail.economy.depot(d).modes.every((m) => m === null || m === "both"), mineSetup.mine));
    await p.keyboard.press("Escape");
    const engine4 = await p.evaluate((d) => window.__hoppers(window.woodrail.economy.depot(d).pieceId), warehouse);
    const hoppers = await p.evaluate((e) => window.woodrail.sim.findCar(e).train.cars.filter((c) => c.kind === "hopper").map((c) => c.id), engine4);
    check("a fresh train of two hoppers at the warehouse", engine4 !== -1 && hoppers.length === 2, JSON.stringify(hoppers));
    // A first tap takes the train (its engine's card); a second, on the hopper, opens the hopper's own card.
    // (Framed close and above any open card, as train-summary's wagon tap: the engine's card covers the middle.)
    const tapCar = async (id) => {
      const v = await worldAt({ car: id });
      await p.evaluate((v) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), 520, { duration: 0.1, inRoom: true }), v);
      await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
      await settle();
      const [x, y] = await onScreen({ car: id });
      await tapped(() => p.touchscreen.tap(x, y));
      await p.waitForTimeout(600);
    };
    await tapCar(hoppers[0]);
    await p.waitForFunction(() => window.woodrail.hud.engineCardOpen || window.woodrail.hud.carCardOpen, null, { timeout: 20000 }).catch(() => {});
    if (!(await p.evaluate(() => window.woodrail.hud.carCardOpen))) await tapCar(hoppers[0]);
    await p.waitForFunction(() => window.woodrail.hud.carCardOpen, null, { timeout: 20000 }).catch(() => {});
    if (!(await p.evaluate(() => window.woodrail.hud.carCardOpen))) await tapCar(hoppers[0]);
    await settle();
    const card0 = await p.evaluate(() => ({ open: window.woodrail.hud.carCardOpen, rows: [...document.querySelectorAll(".car-goods .store-row")].map((r) => r.querySelector(".store-what").textContent), same: !!document.querySelector(".car-goods [data-same]") }));
    check("the hopper's card: coal, grain, stone, ore, each Takes, and Same for all wagons like this", card0.open && card0.rows.length === 4 && card0.rows.every((r) => /Takes$/.test(r)) && card0.same, JSON.stringify(card0));
    await tapButton('.car-goods [data-kind="coal"][data-mode="off"]');
    await tapButton(".car-goods [data-same]");
    // (Layout sizes: a button just tapped can still be scaled by its press.)
    const set4 = await p.evaluate((ids) => ({ off: ids.map((id) => window.woodrail.economy.carOffKinds(id)), row: [...document.querySelectorAll(".car-goods .store-row")].map((r) => r.querySelector(".store-what").textContent).find((t) => /Coal/.test(t)), small: Math.min(...[...document.querySelectorAll(".car-goods button")].map((b) => Math.min(b.offsetWidth, b.offsetHeight))), card: document.querySelector(".car-card").getBoundingClientRect().right }), hoppers);
    check("…coal switched off by a tap, and Same for all sets the other hopper too (44 px buttons, inside 390 px)", JSON.stringify(set4.off) === JSON.stringify([["coal"], ["coal"]]) && /Off$/.test(set4.row ?? "") && set4.small >= 44 && set4.card <= 390, JSON.stringify(set4));
    await shot("9-hopper-card-no-coal");
    await p.keyboard.press("Escape");
    // (Back toward the station, past the mine; the other way too if it didn't pass it.)
    await p.evaluate((e) => window.woodrail.sim.setLever(e, -1), engine4);
    let run4 = await p.evaluate(() => window.__run(120));
    if (!run4.loaded[`${mineSetup.mine}:ore`]) {
      await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine4);
      run4 = await p.evaluate(() => window.__run(120));
    }
    const onBoard4 = await p.evaluate((ids) => ids.map((id) => window.woodrail.economy.cargoOf(id)), hoppers);
    check(
      "hoppers set not to take coal: the train leaves the mine with ore only",
      (run4.loaded[`${mineSetup.mine}:ore`] ?? 0) > 0 && (run4.loaded[`${mineSetup.mine}:coal`] ?? 0) === 0 && onBoard4.every((c) => c.kind === "ore" || c.count === 0),
      JSON.stringify({ run4, onBoard4 }),
    );
  }
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
