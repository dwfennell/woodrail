// End-to-end station touches in Game mode (`npm run e2e:station-touches [-- <out dir>]`), on a phone at 390×844: a
// town's station upgraded to a two-platform station by a tap on its town card's button, a coach train on a line
// between the first two towns. As the train halts there, the people at the top of the platform's queue lean toward it
// and get on (hopping into the coach), people from the other town get off; as it sets off the guard raises his flag
// (and the soft whistle is asked for); the departure board says the line and where it heads next, painted only when a
// train's next stop changes. Afterwards nothing of it moves, and an idle frame loop draws nothing.
//
// Setup shortcuts (named, not what's under test): Passengers, Routes and Big stations learned through the game's own
// `learned` (the studies skipped); the line laid by the play-through's own player; the town card opened by
// `openDepotCard` (the tap on a station is e2e:station-upgrade's); the kit put in the toy box; the train put on by the
// sim and its line made as the engine card makes one (`startLine`). The sim is stepped headless (the page runs too
// slowly to wait on by clock) up to the train halting at the station, then the page runs in real time for the stop.
//
// Starts its own dev server (on 5393, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/station-touches";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
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
const state = () => p.evaluate(() => window.woodrail.stationTouches.state());

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");

// 1. The line between the first two towns, and a station whose upgrade fits.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const { planUpgrade } = await import("/src/game/station-upgrade.ts");
  const w = window.woodrail;
  const world = w.world;
  const st = (i) => world.stations.get(world.landscape.towns[i].id);
  const r = play(world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(world), maxPieces: 60, fiddle: 3 });
  for (const t of ["passengers", "routes", "big-stations"]) w.learn(t);
  w.progress().add("piece:kit-two-platform-station", 1);
  let pick = null;
  for (const i of [1, 0]) {
    const town = world.landscape.towns[i];
    const plan = planUpgrade(world, town.id, "kit-two-platform-station", w.interaction.landEditor(), (t, pose, y, ignore) => w.interaction.placeWhy(t, pose, y, ignore));
    if (!pick && typeof plan !== "string") pick = { i, town: town.id, name: town.name, other: world.landscape.towns[1 - i].name };
  }
  w.invalidate();
  return { joined: r.ok, pick };
});
check("the line laid between the first two towns, and a station whose upgrade fits", setup.joined && !!setup.pick, JSON.stringify(setup));
if (!setup.pick) {
  await b.close();
  await server.close();
  process.exit(1);
}
const { town: townId, i: townIndex } = setup.pick;

// 2. Upgraded by a tap on the town card's button.
await p.evaluate((townId) => {
  const w = window.woodrail;
  w.interaction.openDepotCard(w.world.economy.depotAtPiece(w.world.stations.get(townId)).id);
}, townId);
await p.waitForTimeout(800);
const findButton = () =>
  p.evaluate(() => {
    const el = [...document.querySelectorAll(".station-upgrade-btn")].find((e) => e.textContent.trim().startsWith("⬆ Two-platform station") && e.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: el.textContent.trim() };
  });
// (The card may still be settling as it opens: tapped again, up to three times, until the station is upgraded.)
let button = null;
for (let k = 0; k < 3; k++) {
  await findButton();
  await p.waitForTimeout(600);
  const at = await findButton();
  button ??= at;
  if (!at) break;
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(1500);
  if (await p.evaluate((townId) => window.woodrail.world.layout.getPiece(window.woodrail.world.stations.get(townId)).type !== "station", townId)) break;
}
check("the town card offers the upgrade", !!button, JSON.stringify(button));
await p.keyboard.press("Escape");
const station = await p.evaluate((townId) => {
  const w = window.woodrail;
  const id = w.world.stations.get(townId);
  return { id, type: w.world.layout.getPiece(id).type };
}, townId);
check("the station is a two-platform station now", station.type === "kit-two-platform-station", JSON.stringify(station));
await p.waitForTimeout(500);
let s = await state();
check("…with a guard and a departure board on it", s.bigs.some((x) => x.pieceId === station.id), JSON.stringify(s.bigs));
if (!s.bigs.some((x) => x.pieceId === station.id)) {
  await b.close();
  await server.close();
  process.exit(1);
}
const board0 = s.bigs.find((x) => x.pieceId === station.id);

// 3. A coach train on a line between the two stations (as the engine card makes one), heading for the upgraded one.
const line = await p.evaluate(
  async ({ townIndex }) => {
    const { connectorRef } = await import("/src/track/layout.ts");
    const { startLine } = await import("/src/game/lines.ts");
    const w = window.woodrail;
    const world = w.world;
    const st = (i) => world.stations.get(world.landscape.towns[i].id);
    const other = 1 - townIndex;
    // On the line just past the other town's station, heading on toward the upgraded one.
    const end = other === 0 ? connectorRef(st(0), 1) : connectorRef(st(1), 0);
    const next = Math.floor(world.layout.joinedConnector(end) / 8);
    let placed = { kind: "none" };
    for (const reversed of [false, true])
      for (const s of [200, 150, 100]) {
        if (placed.kind === "placed") break;
        placed = world.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: next, pathIndex: 0, reversed, s });
      }
    if (placed.kind !== "placed") return null;
    const engine = world.sim.getTrain(placed.trainId).cars.find((c) => c.kind === "engine").id;
    // Heading for the upgraded station first.
    const stops = [townIndex, other].map((i) => ({ depotId: world.economy.depotAtPiece(st(i)).id, action: "auto" }));
    const l = startLine(world.economy, engine, stops);
    world.sim.setLever(engine, 1);
    window.__engine = engine;
    return { engine, name: l.name, colour: l.colour };
  },
  { townIndex },
);
check("a coach train on a line between the two stations", !!line, JSON.stringify(line));
await p.waitForTimeout(800);
// (Frames are slow headless: wait for the board's next paint rather than a while.)
await p.waitForFunction((id) => window.woodrail.stationTouches.state().bigs.some((b) => b.pieceId === id && b.paints > 0), station.id, { timeout: 30000 }).catch(() => {});
s = await state();
const board1 = s.bigs.find((x) => x.pieceId === station.id);
check("the board says the line and where it heads next", board1.rows.includes(`${line.name} → ${setup.pick.other}`), JSON.stringify(board1));
check("…painted once for it", board1.paints === board0.paints + 1, `${board0.paints} → ${board1.paints}`);
// Unchanged frames later (nothing's next stop changed): not painted again.
await p.waitForTimeout(1500);
const board1b = (await state()).bigs.find((x) => x.pieceId === station.id);
check("…and not again while nothing changes", board1b.paints === board1.paints, `${board1.paints} → ${board1b.paints}`);

/** Step the sim headless until the train halts at the station (people arriving each second as main.ts has them). */
const runUntilHalted = (limit, visit = 1) =>
  p.evaluate(
    async ({ limit, pieceId, townId, visit }) => {
      const { peopleArrive } = await import("/src/game/passengers.ts");
      const w = window.woodrail;
      const world = w.world;
      const pr = w.progress();
      const depot = world.economy.depotAtPiece(pieceId);
      window.__clock ??= new Map();
      w.paused = true;
      const train = () => world.sim.trainIds().map((id) => world.sim.getTrain(id)).find((t) => t.cars.some((c) => c.id === window.__engine));
      let visits = 0;
      let wasOn = false;
      let k = 0;
      for (; k < 120 * limit; k++) {
        world.sim.tick();
        world.economy.tick();
        if (k % 120 === 0) {
          peopleArrive(world, pr, 1, window.__clock);
          // At least four waiting there, as a busy platform has.
          if (depot.waiting < 4) depot.waiting = Math.min(4, depot.waiting + 1);
          w.setWaiting(townId, depot.waiting);
        }
        const on = !!train()?.bogies.some((b) => b.pieceId === pieceId);
        if (on && !wasOn) visits++;
        wasOn = on;
        if (visits >= visit && world.economy.servicedCar(depot.id) >= 0) break;
      }
      return { seconds: k / 120, waiting: depot.waiting, halted: world.economy.servicedCar(depot.id) >= 0, nextVersion: world.economy.nextVersion };
    },
    { limit, pieceId: station.id, townId, visit },
  );
// Its second call there: on round from the other town, with people from there aboard to get off.
const halted = await runUntilHalted(900, 2);
check("the train comes to the upgraded station and halts", halted.halted, JSON.stringify(halted));

// 4. The stop, in real time: the guard's whistle counted as it's asked for.
await p.evaluate((townId) => {
  const w = window.woodrail;
  const pose = w.world.layout.getPiece(w.world.stations.get(townId)).pose;
  w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 420, { duration: 0.1 });
  window.__whistles = 0;
  const a = w.audio;
  const was = a.guardWhistle.bind(a);
  a.guardWhistle = (v, pan) => {
    window.__whistles++;
    return was(v, pan);
  };
  w.paused = false;
}, townId);
// Watch the stop, a frame at a time, for what the people and the guard do.
const seen = await p.evaluate(
  ({ pieceId }) =>
    new Promise((done) => {
      const w = window.woodrail;
      const out = { heard: null, leaned: 0, maxDolls: 0, on: 0, off: 0, flag: false, wave: 0, flagAngle: null, frames: 0 };
      const t0 = performance.now();
      const look = () => {
        const s = w.stationTouches.state();
        const v = s.visits.find((x) => x.pieceId === pieceId);
        out.frames++;
        if (v) {
          out.maxDolls = Math.max(out.maxDolls, v.dolls.length);
          out.leaned = Math.max(out.leaned, ...v.dolls.filter((d) => d.mode === "stand").map((d) => d.lean), 0);
          out.on = Math.max(out.on, v.dolls.filter((d) => d.mode === "on").length);
          out.off = Math.max(out.off, v.dolls.filter((d) => d.mode === "off").length);
          if (out.on > 0 && !window.__shotHop) window.__shotHop = performance.now();
        }
        const big = s.bigs.find((x) => x.pieceId === pieceId);
        if (big?.flagUp) {
          out.flag = true;
          out.wave = Math.max(out.wave, Math.abs(big.wave));
          out.flagAngle = big.flag;
        }
        out.heard = s.heard;
        if ((out.flag && !big?.flagUp && s.visits.length === 0) || performance.now() - t0 > 300000) done(out);
        else requestAnimationFrame(look);
      };
      look();
    }),
  { pieceId: station.id },
);
check("people on the platform lean toward the halted train", seen.maxDolls > 0 && seen.leaned > 0.1, JSON.stringify(seen));
check("…someone hops on", seen.on > 0, JSON.stringify(seen));
check("…someone from the other town hops off", seen.off > 0, JSON.stringify(seen));
check("as it sets off, the guard raises his flag (and waves it)", seen.flag && seen.wave > 0.05, JSON.stringify(seen));
const whistles = await p.evaluate(() => window.__whistles);
// (One per train off from there heard: stops stepped while paused are heard together when it runs again.)
check("…and his whistle is asked for, once a departure", whistles >= 1 && whistles <= seen.heard.left, `${whistles} for ${seen.heard.left} heard`);
s = await state();
check("afterwards: no stand-ins left, nothing moving", s.visits.length === 0 && !s.bigs.some((x) => x.flagUp), JSON.stringify(s));

// 5. Pictures: the stop again (the board, the people leaning, someone hopping, the flag), by stepping to the next halt.
// (Its next stop moves on once it's clear of the station, a little after the flag: the board is painted then.)
await p.waitForFunction(({ id, paints }) => window.woodrail.stationTouches.state().bigs.some((b) => b.pieceId === id && b.paints > paints), { id: station.id, paints: board1.paints }, { timeout: 180000 }).catch(() => {});
const board2 = (await state()).bigs.find((x) => x.pieceId === station.id);
check("the board changed as the train's next stop did (not per frame)", board2.paints <= board1.paints + 4 && board2.paints > board1.paints && board2.rows === "", `${board1.paints} → ${board2.paints}: ${board2.rows}`);
await p.evaluate(() => (window.woodrail.paused = true));
const again = await runUntilHalted(900, 2);
check("round again: the train halts there again", again.halted, JSON.stringify(again));
await p.evaluate((townId) => {
  const w = window.woodrail;
  const pose = w.world.layout.getPiece(w.world.stations.get(townId)).pose;
  const c = { x: pose.x + 108 * Math.cos(pose.heading), z: pose.z + 108 * Math.sin(pose.heading) };
  w.director.glideTo(new w.camera.position.constructor(c.x, 0, c.z), 780, { duration: 0.1, phi: 0.95 });
  w.paused = false;
}, townId);
// Mid-stop: someone getting on (the sim on, frames real).
await p.waitForFunction(() => window.woodrail.stationTouches.state().visits.some((v) => v.dolls.some((d) => d.mode !== "stand" || d.lean > 0.15)), null, { timeout: 60000 }).catch(() => {});
await p.evaluate(() => (window.woodrail.paused = true));
await p.waitForTimeout(300);
await shot("1-people-board");
await p.evaluate(() => (window.woodrail.paused = false));
await p.waitForFunction(() => window.woodrail.stationTouches.state().bigs.some((b) => b.flagUp && b.flag < 0.5), null, { timeout: 90000 }).catch(() => {});
await p.evaluate(() => (window.woodrail.paused = true));
await p.waitForTimeout(300);
await shot("2-guard-flag");

// 6. Idle: the train stopped (lever off) and everything settled, frames stop.
await p.evaluate(() => {
  const w = window.woodrail;
  w.world.sim.setLever(window.__engine, 0);
  w.paused = false;
});
await p.waitForFunction(() => !window.woodrail.stationTouches.busy, null, { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(4000);
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  const f0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 3000));
  return { frames: w.framesDrawn - f0, busy: w.stationTouches.busy };
});
check("idle: the touches ask for no frames (a stop standing still included)", !idle.busy && idle.frames <= 1, JSON.stringify(idle));
// The board close up.
await p.evaluate((pieceId) => {
  const w = window.woodrail;
  const pose = w.world.layout.getPiece(pieceId).pose;
  // From across the line (the board faces the second road), looking at it from its front.
  const c = { x: pose.x + 22 * Math.cos(pose.heading) - 110 * Math.sin(pose.heading), z: pose.z + 22 * Math.sin(pose.heading) + 110 * Math.cos(pose.heading) };
  w.director.glideTo(new w.camera.position.constructor(c.x, 20, c.z), 420, { duration: 0.1, phi: 1.15, theta: Math.atan2(Math.sin(pose.heading), -Math.cos(pose.heading)) });
}, station.id);
await p.waitForTimeout(1500);
await settle();
await shot("3-departure-board");

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
