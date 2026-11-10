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
import { boot, openMode, planRoute, reporter, shot, tap, tryUntil } from "../../scripts/e2e/lib/e2e.mjs";

const { page: p, url, out: OUT, errors, close } = await boot({ name: "airship", port: 5400, pinClocks: true, stillIndustries: true });
const { check, finish } = reporter("airship", { errors, close });
const pic = (n) => shot(p, `${OUT}/${n}.png`);
const routeStops = (e) => p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, e);

// A new game.
await p.goto(url);
await openMode(p, "game");

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
  await planRoute(p, engine, [mast, town]);
  const stops = await routeStops(engine);
  check("3. its route by taps: the mast, then the town", JSON.stringify(stops) === JSON.stringify([mast, town]), JSON.stringify(stops));
  await p.keyboard.press("Escape");

  await tap(p, { depot: mast }, { expect: () => window.woodrail.hud.depotCardOpen, why: "the mast's card open" });
  await p.waitForTimeout(800);
  const lines = await p.evaluate(() => [...document.querySelectorAll(".depot-extra .station-waiting")].map((e) => e.textContent));
  check("4. the mast's card: who's aboard, what there is to see, the fare a rider", lines.some((l) => /Aboard: 0 of 8/.test(l)) && lines.some((l) => /To see: .* · \d+ coins a rider/.test(l)), JSON.stringify(lines));
  await pic("1-mast-card");
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
    await tryUntil(p, () => (window.woodrail.airshipView.group.children[0]?.position.y ?? 0) > 200, null);
    const at = await p.evaluate(() => {
      const s = window.woodrail.airshipView.group.children[0];
      return s ? { x: s.position.x, y: s.position.y, z: s.position.z } : null;
    });
    if (at) {
      await p.evaluate((v) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y - 200, v.z), 1400, { duration: 0.2, phi: 1.05 }), at);
      await p.waitForTimeout(2000);
    }
    check("…flying high over the railway", !!at && at.y > 200, JSON.stringify(at));
    await pic("2-airship-touring");
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

await finish();
