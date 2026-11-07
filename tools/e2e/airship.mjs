// End-to-end: the airship tour (Game mode, a 390×844 phone with touch). Late-game spec B1
// (docs/superpowers/specs/2026-11-04-late-game-design.md).
//
//   1. Learned (a setup shortcut), the airship mast is on the Industries tab, unlocked.
//   2. Setup: track from the first town's station toward the forest, a straight on it swapped for a mast (as a drop
//      would), a train of an engine and two coaches put down by it.
//   3. Its route planned by taps: the engine, Plan a route, the mast, the town's station, Done.
//   4. The mast's card, by a tap: who's aboard, what there is to see, the fare a rider.
//   5. The payoff: people from the town ride to the mast and board; full, the airship takes off on its tour (flying a
//      loop over the railway, drawn while in view); it lands, and each rider pays the tour's fare.
//
// Harness shortcut (as e2e:warehouse's): the game's own sim and economy ticks run ahead of SwiftShader's few frames a
// second (`__run`); the airship keeps the game's clock (`simSeconds`), moved on with it.
//
// Usage: npm run e2e:airship [-- <out dir>]   (default out: e2e-out/airship)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/airship";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5400, strictPort: false }, logLevel: "error" });
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
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// 1. Learned (setup), the mast is on the Industries tab, unlocked.
await p.evaluate(() => {
  const w = window.woodrail;
  for (const t of ["passengers", "routes", "electricity", "harbours", "airport", "airship"]) w.learn(t);
  w.hud.trayLearned();
});
await p.evaluate(() => [...document.querySelectorAll(".tabs button")].find((e) => e.textContent.trim().startsWith("Industries"))?.click());
await p.waitForTimeout(600);
const tile = await p.evaluate(() => {
  const e = document.querySelector(".tray-item[data-key='piece:depot-mast']");
  return e ? { locked: /Locked/.test(e.textContent) } : null;
});
check("1. Airship learned: its mast is on the Industries tab, unlocked", !!tile && !tile.locked, JSON.stringify(tile));

// 2. Setup.
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
  const at = w.editor().swap(straights[Math.floor(straights.length / 2)], "depot-mast");
  if (at === -1) return { error: "no mast swapped in" };
  await new Promise((r) => setTimeout(r, 500));
  const mast = (w.economy.depotAtPiece(at) ?? w.economy.addDepot("mast", at)).id;
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
  window.__run = (secs) => {
    for (let i = 0; i < secs * 120; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    w.simSeconds += secs;
    w.invalidate();
  };
  w.invalidate();
  return { mast, town: townDepot, engine };
});
check("2. setup: the station's line, a mast on it, a coach train by it", !setup.error && setup.engine !== -1, JSON.stringify(setup));

if (!setup.error && setup.engine !== -1) {
  const { mast, town, engine } = setup;
  await planRoute(engine, [mast, town]);
  const stops = await routeStops(engine);
  check("3. its route by taps: the mast, then the town", JSON.stringify(stops) === JSON.stringify([mast, town]), JSON.stringify(stops));
  await p.keyboard.press("Escape");

  await tapOn({ depot: mast });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(800);
  const lines = await p.evaluate(() => [...document.querySelectorAll(".depot-extra .station-waiting")].map((e) => e.textContent));
  check("4. the mast's card: who's aboard, what there is to see, the fare a rider", lines.some((l) => /Aboard: 0 of 8/.test(l)) && lines.some((l) => /To see: .* · \d+ coins a rider/.test(l)), JSON.stringify(lines));
  await shot("1-mast-card");
  await p.keyboard.press("Escape");

  // 5. Town people ride to the mast and board; full, it tours; landing, each pays the fare.
  const boarded = await p.evaluate(async ({ town, mast, engine }) => {
    const w = window.woodrail;
    w.sim.setLever(engine, 1);
    for (let k = 0; k < 30 && w.economy.depot(mast).flyers < 8 && w.airships.state(mast).aboard === 0; k++) {
      w.economy.depot(town).waiting = Math.max(w.economy.depot(town).waiting, 8);
      window.__run(5);
    }
    w.sim.setLever(engine, 0);
    return { flyers: w.economy.depot(mast).flyers, state: w.airships.state(mast) };
  }, setup);
  check("5. town people ride to the mast and board the airship", boarded.flyers === 8 || boarded.state.aboard > 0, JSON.stringify(boarded));
  let touring = null;
  for (let k = 0; k < 20 && !touring; k++) {
    await p.evaluate(() => window.__run(1));
    touring = await p.waitForFunction((m) => window.woodrail.airships.state(m).touring && window.woodrail.airships.state(m), mast, { timeout: 1500 }).then((h) => h.jsonValue(), () => null);
  }
  check("…full, it takes off on its tour", !!touring && touring.aboard === 8, JSON.stringify(touring));
  if (touring) {
    await p.evaluate(() => window.__run(15));
    // (Posed on the next frame drawn: slow under SwiftShader.)
    await p.waitForFunction(() => (window.woodrail.airshipView.group.children[0]?.position.y ?? 0) > 200, null, { timeout: 30000 }).catch(() => {});
    const at = await p.evaluate(() => {
      const s = window.woodrail.airshipView.group.children[0];
      return s ? { x: s.position.x, y: s.position.y, z: s.position.z } : null;
    });
    if (at) {
      await p.evaluate((v) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y - 200, v.z), 1400, { duration: 0.2, phi: 1.05 }), at);
      await p.waitForTimeout(2000);
    }
    check("…flying high over the railway", !!at && at.y > 200, JSON.stringify(at));
    await shot("2-airship-touring");
    const c0 = await p.evaluate(() => window.woodrail.progress().coins);
    let landed = false;
    for (let k = 0; k < 40 && !landed; k++) {
      await p.evaluate(() => window.__run(1));
      landed = await p.waitForFunction((m) => !window.woodrail.airships.state(m).touring, mast, { timeout: 1500 }).then(() => true, () => false);
    }
    const c1 = await p.evaluate(() => window.woodrail.progress().coins);
    check("…it lands, and each rider pays the tour's fare", landed && c1 - c0 === 8 * touring.fare, JSON.stringify({ landed, paid: c1 - c0, fare: touring.fare }));
  }
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(`\n${failures === 0 ? "e2e:airship passed" : `e2e:airship: ${failures} failed`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
