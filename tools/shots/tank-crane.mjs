// Pictures of Tank wagons and the Breakdown crane on a phone (390×844): an oil well with a tank wagon train beside it,
// a water pump by the water, and a breakdown crane that has driven out to a derailed goods train, lifting it back on.
// A Game, the yards and track put down by the editor and stocked by hand (a harness shortcut: it's for looking, not
// for testing; tank-crane.test.ts and e2e:research test the player's path). The sim is stepped by hand while paused,
// so the crane is caught mid-lift.
//
// Usage: node tools/shots/tank-crane.mjs [<out dir>]   (default out: e2e-out/tank-crane)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/tank-crane";
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
const snap = (name) => p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
const look = (x, z, dist, phi = 0.8, theta = undefined) =>
  p.evaluate(({ x, z, dist, phi, theta }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, 0, z), dist, { duration: 0.1, phi, theta }), { x, z, dist, phi, theta });

// An oil well, three straights on, and a tank wagon train standing there loaded with oil.
const well = await p.evaluate(async () => {
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const w = window.woodrail;
  for (const id of ["dairy", "tankers", "goods-engine", "cranes1", "breakdown"]) w.learn(id);
  const t = w.world.landscape.towns[0];
  const x = t.centre.x - 1400;
  const z = t.centre.z + 900;
  const g = w.world.landscape.grid;
  const y = g.groundY(g.cellAtWorld(x + 108, z + 72));
  const id = w.editor().place("depot-oilwell", { x, z, heading: 0 }, y, false);
  const d = w.economy.depotAtPiece(id) ?? w.economy.addDepot("oilwell", id);
  d.piles[CARGO.oil.index] = 5;
  let end = id;
  const straights = [];
  for (let k = 0; k < 3; k++) straights.push((end = appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ?? end));
  w.trackChanged();
  window.__straights = straights;
  const r = w.sim.addTrain(["engine", "oiltank", "oiltank"], { pieceId: straights[1], pathIndex: 0, reversed: true, s: 180 });
  if (r.kind === "placed") {
    const cars = w.sim.getTrain(r.trainId).cars;
    w.economy.setCargo(cars[1].id, "oil", 3);
    w.economy.setCargo(cars[2].id, "water", 3);
  }
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  window.__oilTrain = r.kind === "placed" ? r.trainId : -1;
  return { x, z, placed: r.kind };
});
console.log("oil well:", JSON.stringify(well));
await p.addStyleTag({ content: "body > *:not(#scene) { visibility: hidden !important }" });
await look(well.x + 200, well.z + 30, Number(process.env.DIST ?? 700), Number(process.env.PHI ?? 0.75));
await p.waitForTimeout(1500);
await settle();
await snap("tank-crane-oil-well");

// A water pump by the water (a river or the sea on the map: the first spot its site rule takes).
const pump = await p.evaluate(async () => {
  const w = window.woodrail;
  const { isWater, SURF_SEA } = await import("/src/landscape/index.ts");
  const { siteWhy } = await import("/src/game/industries.ts");
  const { plotsForSale, landForSale } = await import("/src/game/world.ts");
  // (The coast plot bought, as the harbour pictures do: the pump stands on the shore.)
  const plot = plotsForSale(w.world.landscape).find((q) => {
    const g = landForSale(w.world.landscape, q.px, q.pz).grid;
    let sea = false;
    g.forEachCell((i) => {
      if (g.surface[i] === SURF_SEA) sea = true;
    });
    return sea;
  });
  if (!plot || !w.unlockPlot(plot.px, plot.pz)) return { error: "no coast plot" };
  const g = w.world.landscape.grid;
  let pose = null;
  g.forEachCell((i, col, row) => {
    if (pose || g.surface[i] !== SURF_SEA) return;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const at = { x: g.centreX(col) - c * 108 + s * 150, z: g.centreZ(row) - s * 108 - c * 150, heading };
      const under = g.cellAtWorld(at.x + c * 108, at.z + s * 108);
      if (under === -1 || isWater(g.surface[under]) || g.height[under] > 0) continue;
      if (siteWhy(w.world.landscape, "depot-waterpump", at) === null) {
        pose = at;
        return;
      }
    }
  });
  if (!pose) return { error: "no pump site" };
  const y = g.groundY(g.cellAtWorld(pose.x + Math.cos(pose.heading) * 108, pose.z + Math.sin(pose.heading) * 108));
  const id = w.editor().place("depot-waterpump", pose, y, false);
  const d = w.economy.depotAtPiece(id) ?? w.economy.addDepot("waterpump", id);
  d.piles[20] = 4;
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: pose.x + c * 108 - s * 90, z: pose.z + s * 108 + c * 90 };
});
console.log("water pump:", JSON.stringify(pump));
if (!pump.error) {
  await look(pump.x, pump.z, Number(process.env.PUMP ?? 520), 0.95);
  await p.waitForTimeout(1500);
  await settle();
  await snap("tank-crane-water-pump");
}

// The breakdown crane: a line of straights, a crane train at one end, a goods train at the other, derailed. The crane
// sets out by itself; the sim is stepped (paused) until it's lifting the train.
const line = await p.evaluate(async () => {
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const w = window.woodrail;
  // (A flat stretch east of the oil well, on the same row: the starter map's ground there is level.)
  const g = w.world.landscape.grid;
  const x = 160;
  const z = 1008;
  const y = g.groundY(g.cellAtWorld(x, z));
  let end = w.editor().place("straight-216", { x, z, heading: 0 }, y, false);
  const ids = [end];
  for (let k = 0; k < 6; k++) ids.push((end = appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ?? end));
  w.trackChanged();
  const crane = w.sim.addTrain(["crane", "engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
  const goods = w.sim.addTrain(["engine", "van", "van"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 120 });
  if (crane.kind !== "placed" || goods.kind !== "placed") return { error: "no room" };
  const goodsCar = w.sim.getTrain(goods.trainId).cars[0].id;
  w.paused = true;
  w.sim.trackChanged([w.sim.getTrain(goods.trainId).bogies[0].pieceId]);
  return { x: x + 216 * 3.2, z, goodsCar };
});
console.log("crane line:", JSON.stringify(line));
const step = (until) =>
  p.evaluate(
    ({ until, goodsCar }) => {
      const w = window.woodrail;
      window.__log ??= [];
      for (let i = 0; i < 120 * 120; i++) {
        w.sim.tick();
        w.economy.tick();
        const job = w.economy.breakdown.jobFor(goodsCar);
        if (job && (i % 60 === 0 || job.phase !== window.__lastPhase)) {
          window.__lastPhase = job.phase;
          const c = w.sim.findCar(job.crane).train;
          const t = w.sim.findCar(goodsCar).train;
          window.__log.push(`${until} ${i} ${job.phase} spd ${c.speed.toFixed(0)} crane ${c.world.map((q) => q.x.toFixed(0))} tgt ${t.world.map((q) => q.x.toFixed(0) + "/" + q.z.toFixed(0))} lev ${c.cars.map((x) => x.lever)}`);
        }
        if (until === "drive" && job?.phase === "drive" && i > 240) break;
        if (until === "lift" && job?.phase === "lift" && job.hoist > 0.55) break;
        if (until === "done" && !job && !w.sim.findCar(goodsCar)?.train.derailed) break;
      }
      w.invalidate();
      const job = w.economy.breakdown.jobFor(goodsCar);
      return job ? { phase: job.phase, hoist: job.hoist } : null;
    },
    { until, goodsCar: line.goodsCar },
  );
if (!line.error) {
  // Toppled, before the crane sets out.
  await look(line.x, line.z, Number(process.env.CRANE ?? 1000), Number(process.env.PHI2 ?? 1.0), process.env.CTHETA ? Number(process.env.CTHETA) : undefined);
  await p.waitForTimeout(2500);
  await settle();
  await snap("tank-crane-derailed");
  console.log("driving:", JSON.stringify(await step("drive")));
  await p.waitForTimeout(800);
  await settle();
  await snap("tank-crane-on-its-way");
  console.log("lifting:", JSON.stringify(await step("lift")));
  const mid = await p.evaluate((goodsCar) => {
    const w = window.woodrail;
    // (Between the crane car and the train it lifts, as the sim has them.)
    const job = w.economy.breakdown.jobFor(goodsCar);
    const c = w.sim.findCar(job.crane);
    const a = c.train.world[2 * c.index];
    const t = w.sim.findCar(goodsCar).train;
    const z = t.world[t.world.length - 1];
    return { x: (a.x * 2 + z.x) / 3, z: (a.z * 2 + z.z) / 3 };
  }, line.goodsCar);
  console.log("mid:", JSON.stringify(mid));
  await look(mid.x, mid.z, Number(process.env.CLOSE ?? 560), Number(process.env.PHI3 ?? 1.15), process.env.CTHETA ? Number(process.env.CTHETA) : undefined);
  await p.waitForTimeout(1200);
  await settle();
  await snap("tank-crane-lifting");
  console.log("done:", JSON.stringify(await step("done")));
  await p.waitForTimeout(800);
  await settle();
  await snap("tank-crane-back-on");
}
console.log((await p.evaluate(() => window.__log ?? [])).slice(0, 40).join("\n"));
console.log(errors.length ? errors.join("\n") : "no errors");
await b.close();
await server.close();
