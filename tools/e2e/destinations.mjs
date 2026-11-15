// End-to-end: passenger destinations (spec docs/superpowers/specs/2026-11-15-passenger-destinations.md), Game mode on a
// 390×844 phone with touch.
//
//   1. Setup (a harness shortcut, not what's tested): Passengers and Routes learned; track laid by the game's own
//      planner (src/play/player.ts) from town A's station through town B's station on to town C's, and from A's other
//      end to town D's; a train of an engine and two coaches by A on each side.
//   2. Two lines from A planned by taps (the engine, Plan a route, the stations, Done): Red A → C (through B, no stop
//      there) and Blue A → D.
//   3. People at A (six put on its platform: setup) are dealt places: only C and D (the places the lines go), none for
//      B (no line stops there), none for "anywhere". A's card, by a tap, says who's going where ("Going to").
//   4. The payoff: the Red train takes A's people for C (not D's), runs through B with them aboard (no one gets off
//      there), and they get off at C; each pays the fare for the whole trip, A to C, more than A to B would have paid.
//      Its card, while they ride, says where they're going ("to C").
//   5. No page errors.
//
// Harness shortcut (as e2e:airport's): the game's own sim and economy ticks run ahead of SwiftShader's few frames a
// second (`__run`), with the people's places refreshed as the game does once a second.
//
// Usage: npm run e2e:destinations [-- <out dir>]   (default out: e2e-out/destinations)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/destinations";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5411, strictPort: false }, logLevel: "error" });
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
  console.log(ok ? "PASS" : "FAIL", what, ok ? "" : detail);
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
  await tapButton(".line-sheet .route-plan.on");
};

// A new game.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// 1. Setup: learned, track A–B–C and A–D by the game's own planner, a coach train on each side of A.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef, pieceOfRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  for (const t of ["passengers", "routes"]) w.learn(t);
  w.hud.trayLearned();
  const towns = w.world.landscape.towns;
  const station = (t) => w.world.stations.get(t.id);
  const free = (piece, i) => w.layout.joinedConnector(connectorRef(piece, i)) === -1;
  /** Track from an end of `from`'s station to an end of `to`'s: the ends used, or null. */
  const join = (from, to, fromEnds = [0, 1]) => {
    for (const i of fromEnds)
      for (const j of [0, 1]) {
        if (!free(station(from), i) || !free(station(to), j)) continue;
        const r = play(w.world.layout, w.editor(), connectorRef(station(from), i), connectorRef(station(to), j), { blocked: rulesFor(w.world), maxPieces: 120, fiddle: 3 });
        if (r.ok) return { i, j };
      }
    return null;
  };
  const far = (a, c) => Math.hypot(a.station.x - c.station.x, a.station.z - c.station.z);
  // Every pick of A, B (nearer A), C (farther) and D, the first the planner can lay.
  for (const A of towns)
    for (const B of towns)
      for (const C of towns)
        for (const D of towns) {
          if (new Set([A, B, C, D].map((t) => t.id)).size < 4 || Math.round(far(A, C) / 800) <= Math.round(far(A, B) / 800)) continue;
          const before = new Set(w.layout.pieceIds());
          const undo = () => {
            const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id));
            if (laid.length > 0) w.editor().removeGroup(laid);
          };
          const ab = join(A, B);
          if (!ab) continue;
          const bc = join(B, C, [1 - ab.j]);
          const ad = bc && join(A, D, [1 - ab.i]);
          if (!bc || !ad) {
            undo();
            continue;
          }
          await new Promise((r) => setTimeout(r, 500));
          const depot = (t) => w.economy.depotAtPiece(station(t)).id;
          // A coach train on the first piece out of each end of A's station.
          const trains = [];
          for (const end of [ab.i, 1 - ab.i]) {
            // (Four pieces out, clear of A's platform: a tap on A is a tap on A.)
            let piece = station(A);
            let ref = connectorRef(station(A), end);
            for (let k = 0; k < 4; k++) {
              const next = w.layout.joinedConnector(ref);
              if (next === -1) break;
              piece = pieceOfRef(next);
              const other = [0, 1].map((i) => connectorRef(piece, i)).find((r) => r !== next);
              if (other === undefined) break;
              ref = other;
            }
            let engine = -1;
            for (const s of [10, 40, 80]) {
              const r = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: piece, pathIndex: 0, reversed: false, s });
              if (r.kind === "placed") {
                engine = w.sim.getTrain(r.trainId).cars[0].id;
                w.sim.setLever(engine, 0);
                break;
              }
            }
            trains.push(engine);
          }
          const { refreshReach } = w.economy;
          window.__run = (secs) => {
            for (let i = 0; i < secs * 120; i++) {
              w.sim.tick();
              w.economy.tick();
              if (i % 120 === 0) refreshReach.call(w.economy);
            }
            w.simSeconds += secs;
            w.invalidate();
          };
          w.invalidate();
          return { A: depot(A), B: depot(B), C: depot(C), D: depot(D), names: [A, B, C, D].map((t) => t.name), townIds: [A, B, C, D].map((t) => t.id), red: trains[0], blue: trains[1] };
        }
  return { error: "no towns the planner could join" };
});
check("1. setup: track A–B–C and A–D, a coach train each side of A", !setup.error && setup.red !== -1 && setup.blue !== -1, JSON.stringify(setup));

if (!setup.error && setup.red !== -1 && setup.blue !== -1) {
  const { A, B, C, D, red, blue, names, townIds } = setup;
  const [nameA, nameB, nameC, nameD] = names;
  // 2. Two lines from A by taps: Red A → C (through B), Blue A → D.
  await planRoute(red, [A, C]);
  check("2. Red's route by taps: A, then C (through B, no stop there)", JSON.stringify(await routeStops(red)) === JSON.stringify([A, C]), JSON.stringify(await routeStops(red)));
  await p.keyboard.press("Escape");
  await planRoute(blue, [A, D]);
  check("2. Blue's route by taps: A, then D", JSON.stringify(await routeStops(blue)) === JSON.stringify([A, D]), JSON.stringify(await routeStops(blue)));
  await p.keyboard.press("Escape");

  // 3. People at A (setup: six on its platform), dealt places by the lines: C and D only.
  const dealt = await p.evaluate(({ A, B, C, D }) => {
    const w = window.woodrail;
    for (const id of [A, B, C, D]) w.economy.depot(id).waiting = 0;
    w.economy.depot(A).waiting = 6;
    w.economy.refreshReach();
    const d = w.economy.depot(A);
    return { reach: [...w.economy.placesFrom(d)].sort(), wants: d.wants.slice(0, d.waiting) };
  }, setup);
  const wantC = dealt.wants.filter((k) => k === townIds[2]).length;
  const wantD = dealt.wants.filter((k) => k === townIds[3]).length;
  check("3. A's reach is C and D (the lines' places), not B", JSON.stringify(dealt.reach) === JSON.stringify([townIds[2], townIds[3]].sort()), JSON.stringify(dealt));
  check("…A's people want C or D, some each, none B or anywhere", wantC > 0 && wantD > 0 && wantC + wantD === 6, JSON.stringify(dealt));
  await tapOn({ depot: A });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await tapButton('.town-tab[data-tab="station"]').catch(() => {});
  await p.waitForTimeout(800);
  const rows = await p.evaluate(() => [...document.querySelectorAll(".ledger-row")].map((r) => r.textContent));
  const going = rows.find((r) => r.startsWith("Going to")) ?? "";
  check("…A's card says who's going where", going.includes(`${nameC} ${wantC}`) && going.includes(`${nameD} ${wantD}`), JSON.stringify(rows));
  await shot("1-town-card-going-to");
  await p.keyboard.press("Escape");

  // 4. The payoff: Red takes C's riders through B to C, each paying the whole trip's fare.
  const fares = await p.evaluate(async ({ A, B, C, red }) => {
    const w = window.woodrail;
    const { fareFor } = await import("/src/game/passengers.ts");
    const coach = w.sim.findCar(red).train.cars.find((c) => c.kind === "passenger").id;
    window.__offs = [];
    const pay = w.economy.onAlight;
    w.economy.onAlight = (from, to, car) => {
      window.__offs.push({ from: from.id, to: to.id, fare: fareFor(w.world, from, to, car) });
      pay?.(from, to, car);
    };
    return { toC: fareFor(w.world, w.economy.depot(A), w.economy.depot(C), coach), toB: fareFor(w.world, w.economy.depot(A), w.economy.depot(B), coach), coins: w.progress().coins };
  }, setup);
  check("…a fare to C is more than one to B (it's farther)", fares.toC > fares.toB, JSON.stringify(fares));
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), red);
  // On board at A, then on through B.
  let aboard = 0;
  for (let k = 0; k < 150 && aboard < wantC; k++) {
    await p.evaluate(() => window.__run(2));
    aboard = await p.evaluate((red) => window.woodrail.sim.findCar(red).train.cars.reduce((n, c) => n + (c.kind === "passenger" ? window.woodrail.economy.ridersOf(c.id).count : 0), 0), red);
  }
  const left = await p.evaluate((A) => window.woodrail.economy.depot(A).wants.slice(0, window.woodrail.economy.depot(A).waiting), A);
  const where = await p.evaluate((red) => {
    const w = window.woodrail;
    const t = w.sim.findCar(red).train;
    const r = w.economy.routeOf(red);
    return { piece: t.bogies[0].pieceId, speed: t.speed, next: r?.next, at: r?.at, stops: r?.stops.map((s) => s.depotId), held: w.sim.heldBy?.(t.id) ?? null, serving: w.economy.servingDepot(t.id)?.id ?? null };
  }, red);
  check("…Red takes A's people for C, and leaves those for D waiting", aboard === wantC && left.length === wantD && left.every((k) => k === townIds[3]), JSON.stringify({ aboard, left, where }));
  await tapOn({ engine: red });
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(600);
  const load = await p.evaluate(() => document.querySelector(".summary-load")?.textContent ?? "");
  check("…Red's card says where its riders are going", load.includes(`to ${nameC} ${wantC}`), load);
  await shot("2-train-card-riders-to");
  await p.keyboard.press("Escape");
  // (People turning up at B and C meanwhile: kept off for now, one thing at a time.)
  let offs = [];
  for (let k = 0; k < 120; k++) {
    await p.evaluate(({ B, C }) => {
      window.__run(2);
      window.woodrail.economy.depot(B).waiting = 0;
      window.woodrail.economy.depot(C).waiting = 0;
    }, setup);
    offs = await p.evaluate(() => window.__offs);
    if (offs.filter((o) => o.from === A).length >= wantC) break;
  }
  const fromA = offs.filter((o) => o.from === A);
  check("…no one gets off at B on the way (they stay aboard past the nearer town)", !offs.some((o) => o.to === B), JSON.stringify(offs));
  check("…they all get off at C, each paying the A–C fare", fromA.length === wantC && fromA.every((o) => o.to === C && o.fare === fares.toC), JSON.stringify(offs));
  const coins = await p.evaluate(() => window.woodrail.progress().coins);
  check("…and the coins went up by those fares", coins - fares.coins >= wantC * fares.toC, JSON.stringify({ was: fares.coins, now: coins }));
  await showing({ depot: C }, 900);
  await shot("3-at-C");
  void nameA;
  void nameB;
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(`\n${failures === 0 ? "e2e:destinations: all passed" : `e2e:destinations: ${failures} failed`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
