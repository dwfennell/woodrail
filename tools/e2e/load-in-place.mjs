// End-to-end load in place (spec docs/superpowers/specs/2026-11-16-load-in-place.md), on a 390×844 phone in Sandbox:
// a train of an engine and three flatbeds of logs, on a line sawmill → workshop, pulls up at the sawmill once, its nose
// short of the sawmill's far end, and stands still while the gantry runs along it: each wagon's logs off and planks on
// where it stands. Pictures of the crane at each wagon. The payoff: the planks are carried on and dropped at the
// workshop. Paused mid-load, 0 frames drawn; the crane at work draws.
//
// Setup, not what's tested (named harness shortcuts): the oval, the places, the train, its logs and its line put down in
// code (planning a line by taps is e2e:touch's route groups); the sawmill's plank pile filled in code; the sim and
// economy ticked ahead of SwiftShader's frames.
//
// Usage: npm run e2e:load-in-place [-- <out dir>]   (default out: e2e-out/load-in-place)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/load-in-place";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.favourites", "[]");
});
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));

let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
// Pictures of the world alone (the HUD hidden for them).
const shot = async (n) => {
  await p.addStyleTag({ content: "body.hl-shot * { visibility: hidden } body.hl-shot canvas { visibility: visible }" });
  await p.evaluate(() => document.body.classList.add("hl-shot"));
  await p.screenshot({ path: `${OUT}/${n}.jpg`, quality: 85, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
  await p.evaluate(() => document.body.classList.remove("hl-shot"));
};

await p.goto(PAGE);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 60000 });
await p.evaluate(() => {
  const help = document.querySelector(".help");
  if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
  document.querySelector(".coach:not([hidden]) .coach-skip")?.click();
});
await settle();

// The oval: the sawmill and the workshop across it, a train of three flatbeds of logs on its far side, on the line
// sawmill, workshop. (Setup: see the top.)
// The view: over the sawmill from its yard's side (LIP_VIEW=dist,phi,turn to try another).
const [vd, vp, vt] = (process.env.LIP_VIEW ?? "520,1.05,0.15").split(",").map(Number);
const setup = await p.evaluate(async (view) => {
  const w = window.woodrail;
  const { Layout } = await import("/src/track/index.ts");
  const S = await import("/src/routing/scenarios.ts");
  const L = await import("/src/game/lines.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const scratch = new Layout();
  const ids = S.oval(scratch).ids;
  const t = w.controls.target;
  const types = { 0: "depot-sawmill", 7: "depot-workshop" };
  const run = (g) => ids.map((i, k) => {
    const q = scratch.getPiece(i);
    return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
  });
  // Clear open ground near the view (the game's own placement check, piece by piece).
  let spot = null;
  for (let ring = 1; ring < 24 && !spot; ring++)
    for (let k = 0; k < 16 && !spot; k++) {
      const a = (k / 16) * Math.PI * 2;
      const g = { x: Math.round((t.x + Math.cos(a) * ring * 300) / 18) * 18, z: Math.round((t.z + Math.sin(a) * ring * 300) / 18) * 18 };
      if (run(g).every((q) => !w.interaction.placement(q.type, q.flipped, q.pose, 0, -1).reason)) spot = g;
    }
  if (!spot) throw new Error("no open ground");
  const placed = w.editor().placeRun(run(spot));
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const sawmill = depot(placed[0], "sawmill");
  const workshop = depot(placed[7], "workshop");
  const r = w.sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: placed[4], pathIndex: 0, s: 60, reversed: false });
  if (r.kind !== "placed") throw new Error("no room for a train");
  const train = w.sim.getTrain(r.trainId);
  const engine = train.cars[0].id;
  const wagons = train.cars.slice(1).map((c) => c.id);
  for (const id of wagons) w.economy.setCargo(id, "log", 3);
  w.sim.setLever(engine, 0);
  L.editLine(w.economy, engine, (l) => l.push({ depotId: sawmill.id, action: "auto" }, { depotId: workshop.id, action: "auto" }));
  sawmill.piles[CARGO.planks.index] = 12;
  workshop.piles[CARGO.planks.index] = 0;
  const mill = w.layout.getPiece(placed[0]).pose;
  // From the yard's side (its +l), a little along the track, over the depot's middle.
  const c = Math.cos(mill.heading);
  const sn = Math.sin(mill.heading);
  w.director.glideTo(new w.controls.target.constructor(mill.x + c * 60 - sn * 40, 0, mill.z + sn * 60 + c * 40), view.dist, { duration: 0.1, phi: view.phi, theta: -mill.heading + view.turn });
  // What happens at the sawmill, tick by tick (a harness shortcut: ticked ahead of the frames).
  const log = { stops: 0, moved: 0, served: new Set(), noseOff: 0, ticks: 0, wasMoving: true, at: null, done: false };
  window.__log = log;
  window.__run = (secs, until) => {
    for (let i = 0; i < secs * 120; i++) {
      w.sim.tick();
      w.economy.tick();
      w.economy.drainEvents();
      const tr = w.sim.findCar(engine).train;
      const atMill = w.economy.atStop(tr.id)?.id === sawmill.id;
      if (atMill && !log.done) {
        log.ticks++;
        if (tr.speed === 0 && log.wasMoving) log.stops++;
        const car = w.economy.servicedCar(sawmill.id);
        if (car !== -1) {
          log.served.add(car);
          const spot = tr.world.map((q) => [q.x, q.z]);
          if (log.at && spot.some((q, k) => Math.hypot(q[0] - log.at[k][0], q[1] - log.at[k][1]) > 1e-6)) log.moved++;
          log.at = spot;
          // Its nose on the sawmill's own piece: never over the far joint.
          if (tr.bogies[0].pieceId !== placed[0]) log.noseOff++;
        }
      }
      if (log.at && !atMill && tr.speed > 0) log.done = true;
      log.wasMoving = tr.speed > 0;
      if (until && until()) break;
    }
    w.invalidate();
    return { stops: log.stops, moved: log.moved, served: log.served.size, noseOff: log.noseOff, standing: log.ticks / 120 };
  };
  window.__crane = () => {
    const move = { kind: "log", toPile: false, carId: -1, phase: 0, run: -1 };
    return w.economy.craneMove(sawmill.id, move) ? { ...move } : null;
  };
  window.__loads = () => wagons.map((id) => w.economy.cargoOf(id));
  window.__workshop = () => workshop.piles[CARGO.planks.index];
  // Where the sawmill's crane is drawn: its trolley.
  window.__trolley = () => w.depotView.craneOf(sawmill.id).trolley.position.clone();
  w.invalidate();
  return { engine, wagons, sawmill: sawmill.id, workshop: workshop.id };
}, { dist: vd, phi: vp, turn: vt });
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
await settle();
// (At home, idle, the train not there yet: placed by the frames since the sawmill was laid.)
await p.evaluate(() => (window.__home = window.__trolley()));

// Sent on (its lever, as Go sets it: Go is e2e:touch's).
await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), setup.engine);
// At the sawmill: a picture of the crane at each wagon, mid-move.
for (let k = 0; k < 3; k++) {
  const at = await p.evaluate(
    ([wagon]) => {
      for (let n = 0; n < 400; n++) {
        window.__run(0.1);
        const m = window.__crane();
        if (m && m.carId === wagon && m.phase > 0.55) return m;
      }
      return null;
    },
    [setup.wagons[k]],
  );
  // (The crane works the nearest wagon first: if it went to them in another order, the shot is of whichever it's at.)
  const now = at ?? (await p.evaluate(() => window.__crane()));
  await p.evaluate(() => {
    window.woodrail.paused = true;
    window.woodrail.invalidate();
  });
  await settle();
  if (k === 0) {
    // Paused mid-load: nothing drawn.
    const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
    await p.waitForTimeout(3000);
    const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
    check("paused mid-load: 0 frames drawn", f1 - f0 === 0, JSON.stringify({ frames: f1 - f0 }));
  }
  await shot(`${k + 1}-crane-at-wagon-${k + 1}`);
  check(`the crane at work on a wagon (${k + 1} of 3)`, !!now, JSON.stringify(now));
  await p.evaluate(() => (window.woodrail.paused = false));
}
// The crane at work draws (real time: it moves in view).
const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
await p.waitForTimeout(2000);
const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
check("the crane at work, in view: frames drawn", f1 - f0 > 0, JSON.stringify({ frames: f1 - f0 }));

const visit = await p.evaluate(() => window.__run(60, () => window.__log.done));
check("it stops once at the sawmill", visit.stops === 1, JSON.stringify(visit));
check("…and doesn't move while it's served", visit.moved === 0, JSON.stringify(visit));
check("…every wagon served where it stands", visit.served === 3, JSON.stringify(visit));
check("…its nose short of the sawmill's far end (never over the joint)", visit.noseOff === 0, JSON.stringify(visit));
const loads = await p.evaluate(() => window.__loads());
check("all three wagons left with planks", loads.every((c) => c.kind === "planks" && c.count === 3), JSON.stringify(loads));
// The train gone, the crane goes home (QA 2026-11-16: a farm's jib was left turned out over the track, its rope reaching
// to where a wagon had stood): its trolley back where it was before the train came, drawn so.
const stowed = await p.evaluate(async () => {
  window.__run(3);
  const t0 = performance.now();
  // (Drawn by the game's own frames: the crane eases home over 1.2 s of the game's time.)
  while (performance.now() - t0 < 60000 && window.__trolley().distanceTo(window.__home) > 0.5) await new Promise((r) => setTimeout(r, 200));
  return { off: window.__trolley().distanceTo(window.__home), crane: window.__crane() };
});
check("the train gone, the crane is back home (drawn there, not reaching out over the track)", stowed.off <= 0.5 && stowed.crane === null, JSON.stringify(stowed));
await shot("4-crane-home");

// The payoff: the planks are dropped at the workshop.
const planks = await p.evaluate(() => {
  window.__run(90, () => window.__workshop() >= 9);
  return window.__workshop();
});
check("the planks delivered to the workshop", planks >= 9, JSON.stringify({ planks }));

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
