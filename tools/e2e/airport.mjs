// End-to-end: the airport (Game mode, a 390×844 phone with touch). Late-game spec A1
// (docs/superpowers/specs/2026-11-04-late-game-design.md).
//
//   1. Learned (a setup shortcut: the study isn't what's tested), the airport is on the Industries tab, unlocked.
//   2. Setup: track from the first town's station toward the forest, a straight on it swapped for an airport (as a drop
//      would), a train of an engine and two coaches put down by the airport.
//   3. Its route planned by taps: the engine, Plan a route, the airport, the town's station, Done.
//   4. The airport's card, by a tap: when the next plane lands, the lounge, what each rider pays.
//   5. A plane lands (its clock set to land soon: a setup shortcut, not the player's path): it stands on the apron,
//      and leaves visitors on the platform. The payoff: the train takes them to the town, where they pay 1.5× the fare.
//   6. People waiting in the town ride to the airport and get off into its lounge (paying nothing yet); the next plane
//      takes them, and each pays 12 coins.
//
// Harness shortcut (as e2e:warehouse's): the game's own sim and economy ticks run ahead of SwiftShader's few frames a
// second (`__run`); the planes keep the game's clock (`simSeconds`), moved on with it.
//
// Usage: npm run e2e:airport [-- <out dir>]   (default out: e2e-out/airport)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/airport";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5398, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
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
const planRoute = async (engine, places) => {
  await tapOn({ engine });
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  if (!(await p.evaluate(() => window.woodrail.hud.engineCardOpen))) await tapOn({ engine });
  await tapButton(".engine-extra .route-plan");
  for (const d of places) await tapOn({ depot: d });
  await tapButton(".engine-extra .route-plan.on");
};

// A new game.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// 1. Learned (setup), the airport is on the Industries tab, unlocked.
await p.evaluate(() => {
  const w = window.woodrail;
  for (const t of ["passengers", "routes", "electricity", "harbours", "airport"]) w.learn(t);
  w.hud.trayLearned();
});
await p.evaluate(() => [...document.querySelectorAll(".tabs button")].find((e) => e.textContent.trim().startsWith("Industries"))?.click());
await p.waitForTimeout(600);
const tile = await p.evaluate(() => {
  const e = document.querySelector(".tray-item[data-key='piece:depot-airport']");
  return e ? { locked: /Locked/.test(e.textContent) } : null;
});
check("1. Airport learned: it's on the Industries tab, unlocked", !!tile && !tile.locked, JSON.stringify(tile));

// 2. Setup: the station's line toward the forest, a straight on it swapped for the airport, a coach train by it.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const town = w.world.landscape.towns[0].id;
  const station = w.world.stations.get(town);
  const forest = [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === "depot-forest");
  const before = new Set(w.layout.pieceIds());
  let laid = null;
  for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
    if (w.layout.joinedConnector(connectorRef(station, i)) !== -1 || w.layout.joinedConnector(connectorRef(forest, j)) !== -1) continue;
    const r = play(w.world.layout, w.editor(), connectorRef(station, i), connectorRef(forest, j), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 });
    if (r.ok) {
      laid = [...w.layout.pieceIds()].filter((id) => !before.has(id));
      break;
    }
  }
  if (!laid) return { error: "no track to the forest" };
  const straights = laid.filter((id) => w.layout.getPiece(id).type === "straight-216");
  if (straights.length < 4) return { error: `too few straights: ${straights.length}` };
  const at = w.editor().swap(straights[Math.floor(straights.length / 2)], "depot-airport");
  if (at === -1) return { error: "no airport swapped in" };
  await new Promise((r) => setTimeout(r, 500));
  const airport = (w.economy.depotAtPiece(at) ?? w.economy.addDepot("airport", at)).id;
  const townDepot = w.economy.depotAtPiece(station).id;
  let engine = -1;
  for (const s of [10, 30, 60, 90]) {
    const r = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: at, pathIndex: 0, reversed: false, s });
    if (r.kind === "placed") {
      engine = w.sim.getTrain(r.trainId).cars[0].id;
      w.sim.setLever(engine, 0);
      break;
    }
  }
  // Harness shortcut: the game's own ticks, run ahead of SwiftShader's frames; the game's clock moved on with them.
  window.__run = (secs) => {
    for (let i = 0; i < secs * 120; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    w.simSeconds += secs;
    w.invalidate();
  };
  w.invalidate();
  return { airport, town: townDepot, engine };
});
check("2. setup: the station's line, an airport on it, a coach train by it", !setup.error && setup.engine !== -1, JSON.stringify(setup));

if (!setup.error && setup.engine !== -1) {
  const { airport, town, engine } = setup;
  // 3. The route by taps.
  await planRoute(engine, [airport, town]);
  const stops = await routeStops(engine);
  check("3. its route by taps: the airport, then the town", JSON.stringify(stops) === JSON.stringify([airport, town]), JSON.stringify(stops));
  await p.keyboard.press("Escape");

  // 4. The airport's card.
  await tapOn({ depot: airport });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(800);
  const lines = await p.evaluate(() => [...document.querySelectorAll(".depot-extra .station-waiting")].map((e) => e.textContent));
  check("4. the airport's card: the next plane, the lounge, what each pays", lines.some((l) => /Next plane in \d+:\d\d/.test(l)) && lines.some((l) => /Waiting to fly: 0 of 12 · each pays 12 coins/.test(l)), JSON.stringify(lines));
  await shot("1-airport-card");
  await p.keyboard.press("Escape");

  // 5. A plane lands (its clock set to land in 3 s: setup), leaves visitors; the train takes them to town at 1.5×.
  await p.evaluate((id) => window.woodrail.airports.landIn(id, 3), airport);
  // (The game's clock moved on by the harness's ticks: under SwiftShader its frames come slowly. The planes' own
  // clock is moved on by the game, once a second.)
  let landed = false;
  for (let k = 0; k < 30 && !landed; k++) {
    await p.evaluate(() => window.__run(1));
    landed = await p.waitForFunction((id) => window.woodrail.economy.depot(id).waiting > 0, airport, { timeout: 2000 }).then(() => true, () => false);
  }
  check("5. a plane lands: visitors wait on the airport's platform", landed, JSON.stringify(await p.evaluate((id) => window.woodrail.economy.depot(id).waiting, airport)));
  await showing({ depot: airport }, 900);
  await p.waitForTimeout(1500);
  const plane = await p.evaluate(() => window.woodrail.planesView.count);
  check("…its plane stands on the apron", plane === 1, String(plane));
  // (The picture: the plane on its apron, the airport beside it.)
  await p.evaluate(async () => {
    const w = window.woodrail;
    const V = w.camera.position.constructor;
    const at = new V();
    let found = false;
    w.planesView.group.traverse((o) => {
      if (!found && o.isMesh && o.visible) {
        o.getWorldPosition(at);
        found = true;
      }
    });
    if (found) w.lookAt(new V(at.x, 0, at.z), 800, 0.85);
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  });
  await p.waitForTimeout(1500);
  await shot("2-plane-landed");
  const before = await p.evaluate(async ({ airport, town, engine }) => {
    const w = window.woodrail;
    const { fareFor } = await import("/src/game/passengers.ts");
    const coach = w.sim.findCar(engine).train.cars.find((c) => c.kind === "passenger").id;
    const plain = fareFor(w.world, { ...w.economy.depot(airport), role: "town" }, w.economy.depot(town), coach);
    const visitor = fareFor(w.world, w.economy.depot(airport), w.economy.depot(town), coach);
    return { coins: w.progress().coins, riders: w.progress().riders, plain, visitor, waiting: w.economy.depot(airport).waiting };
  }, setup);
  check("…a visitor's fare is 1.5× the plain one", before.visitor === Math.round(before.plain * 1.5), JSON.stringify(before));
  // The town's people kept off the platform for now (setup: one thing at a time).
  await p.evaluate((town) => (window.woodrail.economy.depot(town).waiting = 0), town);
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine);
  let after = before;
  for (let k = 0; k < 12; k++) {
    await p.evaluate(() => window.__run(10));
    await p.evaluate((town) => (window.woodrail.economy.depot(town).waiting = 0), town);
    after = await p.evaluate(() => ({ coins: window.woodrail.progress().coins, riders: window.woodrail.progress().riders }));
    if (after.riders - before.riders >= before.waiting) break;
  }
  const carried = after.riders - before.riders;
  check("…the train takes the visitors on, and each pays 1.5× the fare in town", carried >= 4 && after.coins - before.coins === carried * before.visitor, JSON.stringify({ before, after, carried }));

  // 6. Town people to the airport: off into the lounge (nothing paid yet); the next plane takes them, 12 coins each.
  const lounge = await p.evaluate(async ({ town, airport }) => {
    const w = window.woodrail;
    w.economy.depot(town).waiting = 6;
    const c0 = w.progress().coins;
    for (let k = 0; k < 15 && w.economy.depot(airport).flyers < 6; k++) {
      window.__run(10);
      w.economy.depot(town).waiting = Math.max(0, w.economy.depot(town).waiting);
    }
    return { flyers: w.economy.depot(airport).flyers, coins: w.progress().coins - c0 };
  }, setup);
  check("6. town people ride to the airport and wait in its lounge", lounge.flyers >= 4, JSON.stringify(lounge));
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), engine);
  const c0 = await p.evaluate(() => window.woodrail.progress().coins);
  const flyers = await p.evaluate((id) => window.woodrail.economy.depot(id).flyers, airport);
  await p.evaluate((id) => window.woodrail.airports.landIn(id, 3), airport);
  for (let k = 0; k < 30; k++) {
    await p.evaluate(() => window.__run(1));
    if (await p.waitForFunction((id) => window.woodrail.economy.depot(id).flyers === 0, airport, { timeout: 2000 }).then(() => true, () => false)) break;
  }
  const c1 = await p.evaluate(() => window.woodrail.progress().coins);
  check("…the next plane takes them, each paying 12 coins", c1 - c0 === Math.min(8, flyers) * 12, JSON.stringify({ flyers, paid: c1 - c0 }));
  await tapOn({ depot: airport });
  await p.waitForTimeout(800);
  await shot("3-airport-after");
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(`\n${failures === 0 ? "e2e:airport: all passed" : `e2e:airport: ${failures} failed`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
