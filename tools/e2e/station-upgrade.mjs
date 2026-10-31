// End-to-end: a town's station upgraded in place (`npm run e2e:station-upgrade [-- <out dir>]`), on a phone at 390×844
// with touch. A new game's line between two towns laid (the play-through's own player) and a coach train routed along
// it, carrying people. Big stations learned: a tap on a served station opens its town's card, whose "⬆ Two-platform
// station" button (saying how many houses it moves) upgrades it: the same piece and depot, the line's and the route's
// stops kept, the houses in its way moved to lots facing a street, the kit drawn instead of the station house. The line
// keeps running and carrying people (riders counted, some at the upgraded station). Undo puts everything back. Then a
// town whose upgrade moves houses: the card says how many, they go to lots facing a street, and undo puts them back.
// Pictures before and after (1-before.png, 2-after.png; 4-houses-before.png, 5-houses-after.png).
//
// Setup shortcuts (named, not what's under test): Passengers, Routes and Big stations learned through the game's own
// `learned` (the studies skipped); one two-platform station put in the toy box, as the workshop would make it for 10
// planks; the train put on the line by the sim, its route set as the engine card sets it. People arrive by the game's own
// rule (`peopleArrive`), a second at a time as main.ts calls it, while the sim is stepped (headless, the page runs too
// slowly to wait on by clock).
//
// Starts its own dev server (on 5397, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/station-upgrade";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
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
const glided = () => p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 120000, polling: 250 }).catch(() => console.log("  (the camera was still gliding after 120 s)"));
/** Tap the middle of the first visible element matching `selector` (whose text starts with `text`, if given). */
const tap = async (selector, text) => {
  const box = await p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => (text === undefined || e.textContent.trim().startsWith(text)) && e.getBoundingClientRect().width > 0);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
  if (!box) return false;
  await p.touchscreen.tap(box.x, box.y);
  await p.waitForTimeout(500);
  return true;
};

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");

// 1. The line between the first two towns, a coach train routed along it, and which of its stations to upgrade (one
// whose upgrade moves houses, if either does).
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
  w.hud.refreshTrayBadges();
  let pick = null;
  for (const i of [0, 1]) {
    const town = world.landscape.towns[i];
    const plan = planUpgrade(world, town.id, "kit-two-platform-station", w.interaction.landEditor(), (t, pose, y, ignore) => w.interaction.placeWhy(t, pose, y, ignore));
    const at = { i, town: town.id, name: town.name, plan: typeof plan === "string" ? plan : { moves: plan.moves.length } };
    if (typeof plan !== "string" && (!pick || (pick.plan.moves === 0 && plan.moves.length > 0))) pick = at;
    console.log(`plan for ${town.name}: ${JSON.stringify(at.plan)}`);
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

// The train: an engine and two coaches on the line, routed between the two stations.
const trainSet = await p.evaluate(async () => {
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const world = w.world;
  const st = (i) => world.stations.get(world.landscape.towns[i].id);
  const next = Math.floor(world.layout.joinedConnector(connectorRef(st(0), 1)) / 8);
  let placed = { kind: "none" };
  for (const s of [200, 150, 100]) {
    placed = world.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: next, pathIndex: 0, reversed: false, s });
    if (placed.kind === "placed") break;
  }
  if (placed.kind !== "placed") return null;
  const engine = world.sim.getTrain(placed.trainId).cars.find((c) => c.kind === "engine").id;
  const stops = [0, 1].map((i) => ({ depotId: world.economy.depotAtPiece(st(i)).id, action: "both" }));
  world.economy.setRoute(engine, { stops, next: 1 });
  world.sim.setLever(engine, 1);
  window.__engine = engine;
  return { engine, stops: stops.map((s) => s.depotId) };
});
check("a coach train routed between the two stations", !!trainSet, JSON.stringify(trainSet));

/** Step the game `seconds` (sim and economy, people arriving each second): riders carried, and how many at `townId`'s station. */
const run = (seconds) =>
  p.evaluate(
    async ({ seconds, townId }) => {
      const { peopleArrive } = await import("/src/game/passengers.ts");
      const w = window.woodrail;
      const world = w.world;
      const pr = w.progress();
      const station = world.stations.get(townId);
      const depotId = world.economy.depotAtPiece(station).id;
      window.__clock ??= new Map();
      w.paused = true;
      const before = pr.riders;
      let boarded = 0;
      const coaches = () => {
        const t = world.sim.trainIds().map((id) => world.sim.getTrain(id)).find((t) => t.cars.some((c) => c.id === window.__engine));
        return t ? t.cars.filter((c) => c.kind === "passenger").map((c) => c.id) : [];
      };
      const was = new Map(coaches().map((c) => [c, world.economy.ridersOf(c)]));
      for (let k = 0; k < 120 * seconds; k++) {
        world.sim.tick();
        world.economy.tick();
        if (k % 120 === 0) peopleArrive(world, pr, 1, window.__clock);
        for (const c of coaches()) {
          const now = world.economy.ridersOf(c);
          const then = was.get(c) ?? { count: 0, from: -1 };
          if (now.count > then.count && now.from === depotId) boarded += now.count - then.count;
          was.set(c, now);
        }
      }
      w.paused = false;
      w.invalidate();
      return { riders: pr.riders - before, boarded };
    },
    { seconds, townId },
  );
const first = await run(240);
check("before: the line carries people", first.riders > 0, JSON.stringify(first));

// 2. The station on screen: a picture before.
const look = async () => {
  await p.evaluate((townId) => {
    const w = window.woodrail;
    const pose = w.world.layout.getPiece(w.world.stations.get(townId)).pose;
    w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 900, { duration: 0.1 });
  }, townId);
  await glided();
  await settle();
};
await look();
await shot("1-before");
const houses = () =>
  p.evaluate((townId) => {
    const town = window.woodrail.world.landscape.towns.find((t) => t.id === townId);
    return Object.fromEntries(town.buildings.map((b) => [b.id, b.cells.join(",")]));
  }, townId);
const housesBefore = await houses();
const stateOf = () =>
  p.evaluate((townId) => {
    const w = window.woodrail;
    const world = w.world;
    const id = world.stations.get(townId);
    const d = world.economy.depotAtPiece(id);
    const route = world.economy.routeOf(window.__engine);
    return { id, type: world.layout.getPiece(id).type, depot: d?.id, halt: d ? world.economy.isHalt(d) : null, upgraded: world.landscape.towns.find((t) => t.id === townId).upgraded ?? null, route: route?.stops.map((s) => s.depotId) };
  }, townId);
const before = await stateOf();

// 3. A tap on the station: its town's card, with the upgrade button.
const at = await p.evaluate((townId) => {
  const w = window.woodrail;
  const pose = w.world.layout.getPiece(w.world.stations.get(townId)).pose;
  const v = new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 12, pose.z + 108 * Math.sin(pose.heading)).project(w.camera);
  const r = w.canvas.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}, townId);
await p.touchscreen.tap(at.x, at.y);
await p.waitForTimeout(1200);
const button = await p.evaluate(() => [...document.querySelectorAll(".station-upgrade-btn")].map((x) => x.textContent.trim()));
const moves = setup.pick.plan.moves;
const label = `⬆ Two-platform station · 10🪵${moves ? ` (moves ${moves} house${moves === 1 ? "" : "s"})` : ""}`;
check(`a tap on the station: its card offers "${label}"`, button.includes(label), JSON.stringify(button));
await shot("1b-card");

// 4. Tap it: upgraded in place.
await tap(".station-upgrade-btn", "⬆ Two-platform station");
await p.waitForTimeout(1500);
const after = await stateOf();
check("upgraded: the same piece and depot, now a two-platform station, still the town's station (not a halt)", after.id === before.id && after.depot === before.depot && after.type === "kit-two-platform-station" && after.halt === false && after.upgraded === "kit-two-platform-station", JSON.stringify({ before, after }));
check("…the route's stops kept", JSON.stringify(after.route) === JSON.stringify(before.route), JSON.stringify({ before: before.route, after: after.route }));
const housesAfter = await houses();
const movedIds = Object.keys(housesBefore).filter((id) => housesBefore[id] !== housesAfter[id]);
check(`…${moves} house(s) moved`, movedIds.length === moves, JSON.stringify(movedIds));
const facing = await p.evaluate(
  async ({ townId, ids }) => {
    const { SURF_ROAD } = await import("/src/landscape/grid.ts");
    const land = window.woodrail.world.landscape;
    const g = land.grid;
    const town = land.towns.find((t) => t.id === townId);
    const E = [
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ];
    return ids.map((id) => {
      const b = town.buildings.find((x) => String(x.id) === id);
      return b.front !== undefined && b.cells.some((c) => g.surface[g.index(g.colOf(c) + E[b.front][0], g.rowOf(c) + E[b.front][1])] === SURF_ROAD);
    });
  },
  { townId, ids: movedIds },
);
check("…each moved house faces a street", facing.every(Boolean), JSON.stringify(facing));
await p.keyboard.press("Escape");
await look();
await p.evaluate(() => window.woodrail.kitView.load("kit-two-platform-station").then(() => window.woodrail.syncKits(true)));
await settle();
await shot("2-after");

// 5. The line keeps running and carrying, people boarding at the upgraded station.
const later = await run(360);
check("after: the line keeps carrying people, some boarding at the upgraded station", later.riders > 0 && later.boarded > 0, JSON.stringify(later));

// 6. Undo (the top bar's button): the plain station again, the houses back where they were.
await tap("button[aria-label='Undo (Ctrl+Z)']");
await p.waitForTimeout(1200);
const back = await stateOf();
const housesBack = await houses();
check("undo: the plain station again, the same depot and route, every house where it was", back.type === "station" && back.depot === before.depot && back.upgraded === null && JSON.stringify(back.route) === JSON.stringify(before.route) && JSON.stringify(housesBack) === JSON.stringify(housesBefore), JSON.stringify({ back, same: JSON.stringify(housesBack) === JSON.stringify(housesBefore) }));
await settle();
await shot("3-undone");

// 7. A town whose upgrade moves houses: a tap on its station, the card says how many, a tap moves them (each to a lot
// facing a street) and upgrades it; undo puts them back.
const mover = await p.evaluate(async () => {
  const { planUpgrade } = await import("/src/game/station-upgrade.ts");
  const w = window.woodrail;
  const world = w.world;
  w.progress().add("piece:kit-two-platform-station", 1);
  for (const town of world.landscape.towns) {
    if (!world.stations.has(town.id)) continue;
    const plan = planUpgrade(world, town.id, "kit-two-platform-station", w.interaction.landEditor(), (t, pose, y, ignore) => w.interaction.placeWhy(t, pose, y, ignore));
    if (typeof plan !== "string" && plan.moves.length > 0) return { town: town.id, name: town.name, moves: plan.moves.length };
  }
  return null;
});
check("a town whose station's upgrade moves houses", !!mover, JSON.stringify(mover));
if (mover) {
  const tId = mover.town;
  const stationAt = () =>
    p.evaluate((tId) => {
      const w = window.woodrail;
      const pose = w.world.layout.getPiece(w.world.stations.get(tId)).pose;
      const v = new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 12, pose.z + 108 * Math.sin(pose.heading)).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    }, tId);
  await p.evaluate((tId) => {
    const w = window.woodrail;
    const pose = w.world.layout.getPiece(w.world.stations.get(tId)).pose;
    w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 1100, { duration: 0.1 });
  }, tId);
  await glided();
  await settle();
  await shot("4-houses-before");
  const homes = () =>
    p.evaluate((tId) => {
      const town = window.woodrail.world.landscape.towns.find((t) => t.id === tId);
      return Object.fromEntries(town.buildings.map((b) => [b.id, b.cells.join(",")]));
    }, tId);
  const homesBefore = await homes();
  const pt = await stationAt();
  await p.touchscreen.tap(pt.x, pt.y);
  await p.waitForTimeout(1200);
  const want = `⬆ Two-platform station · 10🪵 (moves ${mover.moves} house${mover.moves === 1 ? "" : "s"})`;
  const offered = await p.evaluate(() => [...document.querySelectorAll(".station-upgrade-btn")].map((x) => x.textContent.trim()));
  check(`${mover.name}'s card offers "${want}"`, offered.includes(want), JSON.stringify(offered));
  await tap(".station-upgrade-btn", "⬆ Two-platform station");
  await p.waitForTimeout(1500);
  const homesAfter = await homes();
  const moved = Object.keys(homesBefore).filter((id) => homesBefore[id] !== homesAfter[id]);
  const ok = await p.evaluate(
    async ({ tId, ids }) => {
      const { SURF_ROAD, FEAT_STATION } = await import("/src/landscape/grid.ts");
      const w = window.woodrail;
      const land = w.world.landscape;
      const g = land.grid;
      const town = land.towns.find((t) => t.id === tId);
      const E = [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ];
      const facing = ids.map((id) => {
        const b = town.buildings.find((x) => String(x.id) === id);
        return b.front !== undefined && b.cells.some((c) => g.surface[g.index(g.colOf(c) + E[b.front][0], g.rowOf(c) + E[b.front][1])] === SURF_ROAD) && b.cells.every((c) => g.feature[c] !== FEAT_STATION);
      });
      // Their props stand on their new lots (the picture follows the record).
      const props = ids.map((id) => {
        const prop = [...w.props.all()].find((q) => String(q.building) === id);
        const b = town.buildings.find((x) => String(x.id) === id);
        return !!prop && b.cells.includes(g.cellAtWorld(prop.x, prop.z));
      });
      return { type: w.world.layout.getPiece(w.world.stations.get(tId)).type, facing, props };
    },
    { tId, ids: moved },
  );
  check(`…upgraded, ${mover.moves} houses moved, each facing a street, its model on its new lot`, ok.type === "kit-two-platform-station" && moved.length === mover.moves && ok.facing.every(Boolean) && ok.props.every(Boolean), JSON.stringify({ moved, ok }));
  await p.keyboard.press("Escape");
  await p.evaluate(() => window.woodrail.kitView.load("kit-two-platform-station").then(() => window.woodrail.syncKits(true)));
  // (The same view as before, to compare.)
  await p.evaluate((tId) => {
    const w = window.woodrail;
    const pose = w.world.layout.getPiece(w.world.stations.get(tId)).pose;
    w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 1100, { duration: 0.1 });
  }, tId);
  await glided();
  await settle();
  await shot("5-houses-after");
  await tap("button[aria-label='Undo (Ctrl+Z)']");
  await p.waitForTimeout(1200);
  const homesBack = await homes();
  const backType = await p.evaluate((tId) => window.woodrail.world.layout.getPiece(window.woodrail.world.stations.get(tId)).type, tId);
  check("…undo: the plain station, and every house back where it was", backType === "station" && JSON.stringify(homesBack) === JSON.stringify(homesBefore), JSON.stringify({ backType }));
  await settle();
  await shot("6-houses-undone");
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
