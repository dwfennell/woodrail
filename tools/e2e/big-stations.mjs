// End-to-end big stations in Game mode (`npm run e2e:big-stations [-- <out dir>]`): a terminus is a halt of the town it's
// by. A new game's line between the first two towns laid (the play-through's own player), Big stations learned, a
// terminus put on past the second town's station, and a coach train routed between the first town's station and the
// terminus: people get on at the terminus and get off there, and pay (riders counted).
//
// Setup shortcuts (named, not what's under test): Passengers, Routes and Big stations learned through the game's own
// `learned` (the studies skipped); the terminus put down by the editor where the tray would (the tray's drag is
// `e2e:kits-game`'s); the train put on the line by the sim, its route set as the engine card sets it. People arrive by the
// game's own rule (`peopleArrive`), a second at a time as main.ts calls it, while the sim is stepped (headless, the page
// runs too slowly to wait on by clock).
//
// Starts its own dev server (on 5391, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/big-stations";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "error" });
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

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");

// 1. The line between the first two towns, and a terminus past the second town's station.
const laid = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
  const r = play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
  for (const t of ["passengers", "routes", "big-stations"]) w.learn(t);
  // Past the second town's station: up to three straights, then the terminus, wherever it first fits.
  const end = connectorRef(st(1), 1);
  const at = (ref) => {
    const c = w.world.layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    return { x: c.x, z: c.z, heading: c.heading };
  };
  let ref = end;
  const laidStraights = [];
  for (let k = 0; k <= 3; k++) {
    const pose = at(ref);
    if (!w.interaction.placement("kit-grand-terminus", false, pose, 0, -1).reason) {
      const id = w.editor().place("kit-grand-terminus", pose, 0, false);
      w.invalidate();
      return { joined: r.ok, terminus: id, straights: laidStraights.length, town: w.world.landscape.towns[1].name };
    }
    if (w.interaction.placement("straight-216", false, pose, 0, -1).reason) break;
    const s = w.editor().place("straight-216", pose, 0, false);
    laidStraights.push(s);
    ref = connectorRef(s, 1);
  }
  return { joined: r.ok, terminus: null, why: w.interaction.placement("kit-grand-terminus", false, at(ref), 0, -1).reason };
});
check("the line laid between the first two towns, and a terminus past the second's station", laid.joined && laid.terminus !== null, JSON.stringify(laid));
await p.waitForTimeout(1200);

if (laid.terminus !== null) {
  // 2. It's a stop of the second town's, named for itself.
  const stop = await p.evaluate(async (terminus) => {
    const { routeStops } = await import("/src/game/route-stops.ts");
    const w = window.woodrail;
    const d = w.world.economy.depotAtPiece(terminus);
    if (!d) return null;
    return { id: d.id, role: d.role, town: d.townId, halt: w.world.economy.isHalt(d), name: routeStops(w.world).find((s) => s.depotId === d.id)?.name };
  }, laid.terminus);
  check("the terminus is a stop of the town it's by, on the route stops by name", !!stop && stop.role === "town" && stop.halt && stop.name === `${laid.town} terminus`, JSON.stringify(stop));

  // 3. A coach train routed between the first town's station and the terminus: riders counted.
  const r = await p.evaluate(async ({ terminus, depotId }) => {
    const { peopleArrive } = await import("/src/game/passengers.ts");
    const w = window.woodrail;
    const world = w.world;
    const pr = w.progress();
    const st0 = world.stations.get(world.landscape.towns[0].id);
    w.paused = true;
    // On the line just past the first town's station (its front a piece along, the coaches behind it).
    const { connectorRef } = await import("/src/track/layout.ts");
    const next = Math.floor(world.layout.joinedConnector(connectorRef(st0, 1)) / 8);
    let placed = { kind: "none" };
    for (const s of [200, 150, 100]) {
      placed = world.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: next, pathIndex: 0, reversed: false, s });
      if (placed.kind === "placed") break;
    }
    if (placed.kind !== "placed") return { placed: placed.kind, trains: world.sim.trainIds().length, next: world.layout.getPiece(next)?.type };
    // (Found by its engine each time: a train's id can change as it turns back.)
    const first = world.sim.getTrain(placed.trainId);
    const engine = first.cars.find((c) => c.kind === "engine").id;
    const train = () => world.sim.trainIds().map((id) => world.sim.getTrain(id)).find((t) => t.cars.some((c) => c.id === engine));
    const coaches = first.cars.filter((c) => c.kind === "passenger").map((c) => c.id);
    world.economy.setRoute(engine, { stops: [{ depotId: world.economy.depotAtPiece(st0).id, action: "both" }, { depotId, action: "both" }], next: 1 });
    world.sim.setLever(engine, 1);
    const clock = new Map();
    const before = pr.riders;
    let boardedAt = 0;
    let droppedAt = 0;
    let visits = 0;
    let wasOn = false;
    const from = new Map(coaches.map((c) => [c, world.economy.ridersOf(c)]));
    const HZ = 120;
    for (let k = 0; k < HZ * 60 * 12 && (boardedAt === 0 || droppedAt === 0); k++) {
      world.sim.tick();
      world.economy.tick();
      if (k % HZ === 0) peopleArrive(world, pr, 1, clock);
      const t = train();
      if (!t) return { placed: "lost", k };
      const on = t.bogies.some((b) => b.pieceId === terminus);
      if (on && !wasOn) visits++;
      wasOn = on;
      for (const c of coaches) {
        const now = world.economy.ridersOf(c);
        const was = from.get(c);
        if (on && now.count > was.count && now.from === depotId) boardedAt += now.count - was.count;
        if (on && now.count < was.count) droppedAt += was.count - now.count;
        from.set(c, now);
      }
    }
    w.paused = false;
    w.invalidate();
    return { placed: "placed", visits, boardedAt, droppedAt, riders: pr.riders - before, coins: pr.coins, waiting: world.economy.depot(depotId).waiting };
  }, { terminus: laid.terminus, depotId: stop?.id ?? -1 });
  check("the routed coach train calls at the terminus", r.placed === "placed" && r.visits > 0, JSON.stringify(r));
  check("…people get on there, from the second town", r.boardedAt > 0, JSON.stringify(r));
  check("…and people from the first town get off there, and pay (riders counted)", r.droppedAt > 0 && r.riders >= r.droppedAt && r.coins > 0, JSON.stringify(r));
  await p.evaluate((id) => {
    const w = window.woodrail;
    const pose = w.world.layout.getPiece(id).pose;
    w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 900, { duration: 0.1 });
  }, laid.terminus);
  await p.waitForTimeout(1500);
  await settle();
  await shot("1-terminus");
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
