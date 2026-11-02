// Pictures of the industries at work and of towns' little touches (busy industries' motions, life in town, station
// themes, the first-train marker): a Game, every industry put down beside the first town (a harness shortcut: placed
// by the editor and stocked by hand, not by the player's path; it's for looking, not for testing), the camera on each.
// Also measures the frame cost idle and with every industry working.
//
// Usage: node tools/shots/industry-life.mjs [<out dir>]   (default out: e2e-out/industry-life)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/industry-life";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5371, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (path) => p.screenshot({ path, timeout: 180000 }).catch((e) => console.log(`(no picture ${path}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE + (process.env.SEED ? `#seed-${process.env.SEED}` : ""));
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

const ROLES = ["forest", "sawmill", "farm", "mill", "quarry", "mine", "foundry", "carpenter", "smithy", "power"];
const placed = await p.evaluate(async (roles) => {
  const { CARGO } = await import("/src/economy/cargo.ts");
  const w = window.woodrail;
  const t = w.world.landscape.towns[0];
  const out = [];
  roles.forEach((role, i) => {
    const x = t.centre.x - 1400 + (i % 5) * 300;
    const z = t.centre.z + 900 + Math.floor(i / 5) * 350;
    const g = w.world.landscape.grid;
    const y = g.groundY(g.cellAtWorld(x + 108, z + 72));
    const id = w.editor().place(`depot-${role}`, { x, z, heading: 0 }, y, false);
    const d = w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    out.push({ role, id, depot: d.id, x, z });
  });
  w.depotView.setWorld(w.economy, w.layout);
  const { RECIPES, capAt } = await import("/src/economy/economy.ts");
  window.__stock = (on) => {
    for (const d of w.economy.allDepots()) {
      if (!roles.includes(d.role)) continue;
      d.piles.fill(0);
      // Idle: nothing to work on, and a full yard where it makes something from nothing (a forest, a farm, a quarry).
      if (!on) for (const k of RECIPES[d.role].gives) if (Object.keys(RECIPES[d.role].cycle?.uses ?? {}).length === 0) d.piles[CARGO[k].index] = capAt(d);
      if (!on) continue;
      for (const k of ["log", "grain", "coal", "ore", "planks", "iron"]) d.piles[CARGO[k].index] = 6;
    }
  };
  return out;
}, ROLES);
const look = (x, z, dist, phi = 0.75, theta = undefined) =>
  p.evaluate(
    ({ x, z, dist, phi, theta }) => {
      const w = window.woodrail;
      w.director.glideTo(new w.camera.position.constructor(x, 0, z), dist, { duration: 0.1, phi, theta });
    },
    { x, z, dist, phi, theta },
  );
// Pictures of the world alone: the HUD hidden.
await p.addStyleTag({ content: "body > *:not(#scene) { visibility: hidden !important }" });
// Frames drawn, and the time (ms) the frame's code and the depots' update take, over `ms` (SwiftShader draws slowly, so
// the frame time is the CPU's side: compare runs on one machine, not with a phone).
await p.evaluate(() => {
  const w = window.woodrail;
  const stats = (window.__cost = { frame: 0, frames: 0, depots: 0, updates: 0 });
  const frame = w.frame.bind(w);
  w.frame = () => {
    const t0 = performance.now();
    frame();
    stats.frame += performance.now() - t0;
    stats.frames++;
  };
  const update = w.depotView.update.bind(w.depotView);
  w.depotView.update = (...a) => {
    const t0 = performance.now();
    const r = update(...a);
    stats.depots += performance.now() - t0;
    stats.updates++;
    return r;
  };
});
const measure = async (ms) =>
  p.evaluate(async (ms) => {
    const w = window.woodrail;
    const c = window.__cost;
    Object.assign(c, { frame: 0, frames: 0, depots: 0, updates: 0 });
    const f0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, ms));
    const drawn = w.framesDrawn - f0;
    // The depots' update alone, 600 times with the game clock running on (the CPU cost of what moves, apart from
    // drawing), and what a frame draws: draw calls and triangles.
    let sim = w.simSeconds;
    let updateUs = Infinity;
    for (let round = 0; round < 5; round++) {
      const t0 = performance.now();
      for (let k = 0; k < 600; k++) w.depotView.update(w.economy, w.snapshot.ids, w.snapshot.count, (id) => w.trainView.carObject(id), (sim += 1 / 60), false);
      updateUs = Math.min(updateUs, ((performance.now() - t0) / 600) * 1000);
    }
    w.renderer.info.autoReset = false;
    w.renderer.info.reset();
    w.post.render(w.clock.elapsedTime);
    const { calls, triangles } = w.renderer.info.render;
    w.renderer.info.autoReset = true;
    return { framesDrawnPerSec: +((drawn * 1000) / ms).toFixed(2), depotsUpdateUs: +updateUs.toFixed(1), drawCalls: calls, triangles };
  }, ms);

await p.evaluate(() => window.__stock(false));
await look(placed[2].x + 400, placed[2].z + 100, 1500);
await settle();
console.log("idle, nothing working:", JSON.stringify(await measure(6000)));
await snap(`${OUT}/all-idle.png`);
await p.evaluate(() => window.__stock(true));
await p.waitForTimeout(1500);
console.log("every industry working, all in view:", JSON.stringify(await measure(6000)));
await snap(`${OUT}/all-busy.png`);
// Still working, but out of view (the camera on the furthest town): nothing to draw for them.
const far = await p.evaluate((at) => {
  const t = [...window.woodrail.world.landscape.towns].sort((a, b) => Math.hypot(b.centre.x - at.x, b.centre.z - at.z) - Math.hypot(a.centre.x - at.x, a.centre.z - at.z))[0];
  return { x: t.centre.x, z: t.centre.z, d: Math.hypot(t.centre.x - at.x, t.centre.z - at.z) };
}, placed[2]);
await look(far.x, far.z, 700);
await settle();
console.log(`every industry working, none in view (camera ${Math.round(far.d)} mm away):`, JSON.stringify(await measure(6000)));
if (process.env.MEASURE_ONLY) {
  console.log(errors.length ? errors.join("\n") : "no errors");
  await b.close();
  await server.close();
  process.exit(0);
}
for (const s of process.env.ONLY === "towns" ? [] : placed) {
  await look(s.x + 108, s.z + 70, 420, Number(process.env.PHI ?? 0.75));
  await p.waitForTimeout(1200);
  await snap(`${OUT}/${s.role}.png`);
}
// The industries rest (the towns' pictures are taken on a still scene).
await p.evaluate(() => window.__stock(false));
// Towns.
const towns = await p.evaluate(() => window.woodrail.world.landscape.towns.map((t) => ({ x: t.centre.x, z: t.centre.z, name: t.name })));
for (const [i, t] of towns.slice(0, 3).entries()) {
  await look(t.x, t.z, 900);
  await settle();
  await snap(`${OUT}/town-${i}.png`);
}
// Close up: a few of the towns' touches, and a child at the end of a platform.
const spots = await p.evaluate(() => (window.woodrail.touches?.spots ?? []).slice(0, 6).map((s) => ({ kind: s.kind, x: s.x, z: s.z })));
for (const [i, s] of spots.entries()) {
  await look(s.x, s.z, 260, 0.95);
  await settle();
  await snap(`${OUT}/touch-${i}-${s.kind}.png`);
}
// A train on the first town's station, lever on: it runs, the child at the platform's end waves as it goes by, and the
// first train's marker is put down where it first ran (harness shortcut: the engine put down by the sim, not the tray).
const ran = await p.evaluate(async () => {
  const w = window.woodrail;
  const town = w.world.landscape.towns[0];
  const station = w.world.stations.get(town.id);
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  let end = station;
  for (let k = 0; k < 2; k++) end = appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ?? end;
  w.trackChanged();
  const r = w.sim.addTrain(["engine", "passenger"], { pieceId: station, pathIndex: 0, reversed: true, s: 60 });
  if (r.kind !== "placed") return { error: r.kind };
  w.sim.setLever(w.sim.getTrain(r.trainId).cars[0].id, 1);
  return { town: town.id, x: town.station.x, z: town.station.z, h: town.station.heading };
});
console.log("train:", JSON.stringify(ran));
if (!ran.error) {
  // Watched from the platform's side, close: the picture is taken as the child waves.
  const kid = await p.evaluate(async (id) => {
    const { kidSpot } = await import("/src/game/touches.ts");
    return kidSpot(window.woodrail.world.landscape.towns[id]);
  }, ran.town);
  await look(kid.x, kid.z, 170, 1.0, Math.atan2(-Math.cos(kid.heading), -Math.sin(kid.heading)));
  let waved = false;
  for (let k = 0; k < 240 && !waved; k++) {
    await p.waitForTimeout(100);
    waved = await p.evaluate((t) => window.woodrail.touches.wavesOf().get(t)?.waving ?? false, ran.town);
  }
  console.log("the child waved:", waved);
  await snap(`${OUT}/kid-wave.png`);
  const mark = await p.evaluate(() => window.woodrail.touches.marked);
  console.log("first train's marker:", JSON.stringify(mark));
  if (mark) {
    await look(mark.x, mark.z, 240, 0.8);
    await settle();
    await snap(`${OUT}/first-train.png`);
  }
}
console.log(errors.length ? errors.join("\n") : "no errors");
await b.close();
await server.close();
