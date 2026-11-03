// Pictures of tech tree 3's pieces on a phone (390×844): the car factory's yard with a loaded car carrier beside it,
// a town's own cars on its streets, and a harbour's quay with its catch of fish and a boat in. A Game, the yards put down by the editor and stocked by hand (a harness
// shortcut: it's for looking, not for testing; next-nodes.test.ts and e2e:research test the player's path).
//
// Usage: node tools/shots/tech-tree-3.mjs [<out dir>]   (default out: e2e-out/tech-tree-3)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/tech-tree-3";
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
const snap = (name) => p.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

const at = await p.evaluate(async () => {
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const w = window.woodrail;
  for (const id of ["foundry", "car-carrier", "car-factory"]) w.learn(id);
  const t = w.world.landscape.towns[0];
  const x = t.centre.x - 1400;
  const z = t.centre.z + 900;
  const g = w.world.landscape.grid;
  const y = g.groundY(g.cellAtWorld(x + 108, z + 72));
  const id = w.editor().place("depot-carworks", { x, z, heading: 0 }, y, false);
  const d = w.economy.depotAtPiece(id) ?? w.economy.addDepot("carworks", id);
  d.piles[CARGO.iron.index] = 4;
  d.piles[CARGO.planks.index] = 4;
  d.piles[CARGO.autos.index] = 4;
  // A straight on, and a car carrier standing there with three new cars (and a second with two, for the colour).
  let end = id;
  const straights = [];
  for (let k = 0; k < 3; k++) straights.push((end = appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ?? end));
  w.trackChanged();
  const r = w.sim.addTrain(["engine", "carrier", "carrier"], { pieceId: straights[1], pathIndex: 0, reversed: true, s: 180 });
  if (r.kind === "placed") {
    const cars = w.sim.getTrain(r.trainId).cars;
    w.economy.setCargo(cars[1].id, "autos", 3);
    w.economy.setCargo(cars[2].id, "autos", 2);
  }
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  return { x, z, placed: r.kind };
});
console.log("car factory:", JSON.stringify(at));
const look = (x, z, dist, phi = 0.8, theta = undefined) =>
  p.evaluate(({ x, z, dist, phi, theta }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, 0, z), dist, { duration: 0.1, phi, theta }), { x, z, dist, phi, theta });
await p.addStyleTag({ content: "body > *:not(#scene) { visibility: hidden !important }" });
await look(at.x + 108, at.z + 72, Number(process.env.DIST ?? 650), Number(process.env.PHI ?? 1.05), process.env.THETA ? Number(process.env.THETA) : undefined);
await p.waitForTimeout(1500);
await settle();
await snap("car-factory");
console.log("yard piles:", JSON.stringify(await p.evaluate(() => {
  const w = window.woodrail;
  const d = w.economy.allDepots().find((x) => x.role === "carworks");
  return { piles: [...d.piles].map((n, i) => n).join(","), role: d.role };
})));
// On the two car carriers, from the side.
const carriers = await p.evaluate(() => {
  const w = window.woodrail;
  const t = w.sim.getTrain(w.sim.trainIds()[w.sim.trainIds().length - 1]);
  const V = w.camera.position.constructor;
  const v = new V();
  w.trainView.carObject(t.cars[1].id).getWorldPosition(v);
  const a = { x: v.x, z: v.z };
  w.trainView.carObject(t.cars[2].id).getWorldPosition(v);
  return { x: (a.x + v.x) / 2, z: (a.z + v.z) / 2 };
});
await look(carriers.x, carriers.z, Number(process.env.CLOSE ?? 300), Number(process.env.CPHI ?? 1.1), process.env.CTHETA ? Number(process.env.CTHETA) : undefined);
await p.waitForTimeout(1200);
await settle();
await snap("car-carrier-close");

// A town's own cars: cars delivered to the first town (shortcut: its totals written, as a car carrier's delivery adds
// them), and the town's cars drive its streets (main.ts's TownCars, once a second).
const town = await p.evaluate(() => {
  const w = window.woodrail;
  const t = w.world.landscape.towns[0];
  w.economy.deliveredGoods.set(t.id, { ...(w.economy.deliveredGoods.get(t.id) ?? {}), autos: 12 });
  return { x: t.centre.x, z: t.centre.z };
});
await p.waitForFunction(() => window.woodrail.economy.roadVehicles.list.filter((v) => v.kind === "car" && v.leg === "out").length > 0, null, { timeout: 30000 }).catch(() => console.log("(no car out)"));
const carAt = await p.evaluate(() => {
  const v = window.woodrail.economy.roadVehicles.list.find((x) => x.kind === "car");
  return v ? { x: v.x, z: v.z } : null;
});
console.log("town car:", JSON.stringify(carAt));
await look(carAt?.x ?? town.x, carAt?.z ?? town.z, Number(process.env.TOWN ?? 420), 0.95);
await p.waitForTimeout(700);
await snap("town-cars");

// A harbour on the coast with its catch: the coast plot bought, a harbour put down where boats reach its quay, Fishing
// boats learned, a boat in and its catch landed (shortcut: landed as a boat lands it, `Economy.land`).
const quay = await p.evaluate(async () => {
  const w = window.woodrail;
  const { plotsForSale, landForSale } = await import("/src/game/world.ts");
  const { SURF_SEA, isWater } = await import("/src/landscape/index.ts");
  const { QUAY, waterWay } = await import("/src/game/harbours.ts");
  const { siteWhy } = await import("/src/game/industries.ts");
  const plot = plotsForSale(w.world.landscape).find((q) => {
    const g = landForSale(w.world.landscape, q.px, q.pz).grid;
    let sea = false;
    g.forEachCell((i) => {
      if (g.surface[i] === SURF_SEA) sea = true;
    });
    return sea;
  });
  if (!plot || !w.unlockPlot(plot.px, plot.pz)) return { error: "no coast plot" };
  for (const id of ["harbours", "fishing"]) w.learn(id);
  const g = w.world.landscape.grid;
  let pose = null;
  g.forEachCell((i, col, row) => {
    if (pose || g.surface[i] !== SURF_SEA) return;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const qx = g.centreX(col);
      const qz = g.centreZ(row);
      const at = { x: qx - c * QUAY.t + s * QUAY.l, z: qz - s * QUAY.t - c * QUAY.l, heading };
      const under = g.cellAtWorld(at.x + c * 108, at.z + s * 108);
      if (under === -1 || isWater(g.surface[under])) continue;
      if (siteWhy(w.world.landscape, "depot-harbour", at) === null && waterWay(w.world.landscape, at)) {
        pose = at;
        return;
      }
    }
  });
  if (!pose) return { error: "no harbour site" };
  const y = g.groundY(g.cellAtWorld(pose.x + Math.cos(pose.heading) * 108, pose.z + Math.sin(pose.heading) * 108));
  const id = w.editor().place("depot-harbour", pose, y, false);
  const d = w.economy.depotAtPiece(id) ?? w.economy.addDepot("harbour", id);
  w.economy.land(d, "fish", 4);
  w.boats.arrive(d.id, waterWay(w.world.landscape, pose), 0.5);
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: pose.x + c * 108 - s * 100, z: pose.z + s * 108 + c * 100 };
});
console.log("harbour:", JSON.stringify(quay));
if (!quay.error) {
  await p.waitForTimeout(2500);
  await look(quay.x, quay.z, Number(process.env.HARBOUR ?? 520), 0.95);
  await p.waitForTimeout(1500);
  await settle();
  await snap("fishing-harbour");
}
console.log(errors.length ? errors.join("\n") : "no errors");
await b.close();
await server.close();
