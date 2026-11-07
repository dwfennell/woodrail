// Pictures of tech tree 5 on a phone (390×844): the stone viaduct across a valley, the lift bridge over a river
// (down, and up for a boat with a train waiting), a warehouse with Lift and load's goods lift, the observatory on a
// hilltop, a train with a sleeper and an observation car, and the research board on the new rows. Setup by shortcuts
// (blueprints learned, land raised, pieces put down by the editor): it's for looking, not testing (the unit tests and
// e2e:tech-tree-5 test the player's path).
//
// Usage: node tools/shots/tech-tree-5.mjs [<out dir>]   (default out: docs/agents/shots)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5395, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (name) => p.screenshot({ path: `${OUT}/tech-tree-5-${name}.jpg`, type: "jpeg", quality: 82, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const quiet = async () => {
  await p.evaluate(() => {
    document.querySelector(".growth-sheet .close")?.click();
    for (const t of document.querySelectorAll(".toast.show")) t.classList.remove("show");
  });
  await p.waitForTimeout(300);
};
const look = async (x, z, dist, phi = 0.8, theta, y = 0) => {
  await p.evaluate(({ x, z, dist, phi, theta, y }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, y, z), dist, { duration: 0.1, phi, ...(theta === undefined ? {} : { theta }) }), { x, z, dist, phi, theta, y });
  await p.waitForTimeout(1200);
  await settle();
  await quiet();
};
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

await p.evaluate(() => {
  const w = window.woodrail;
  w.paused = true;
  for (const id of ["switches", "bridges", "junctions", "routes", "passengers", "halts", "dining", "first-class", "stations", "double-decker", "express", "farming", "mills", "tank", "goods-engine", "quarries", "mines", "foundry", "carpentry", "scenery", "college", "warehouses", "cranes1", "cranes2", "harbours", "telegraph", "signal-boxes", "university", "viaduct", "lift-bridge", "lift-load", "sleeper", "observation", "observatory"]) w.learn(id);
  w.progress().coins = 5000;
  w.hud.setCoins(5000);
});
await p.waitForTimeout(1000);
await quiet();

// Open, flat ground: a block of `w` × `h` squares at the felt with nothing on it, the nearest to the first town.
const open = (w, h) =>
  p.evaluate(
    async ({ w, h }) => {
      const { FEAT_NONE, SURF_GRASS } = await import("/src/landscape/grid.ts");
      const W = window.woodrail;
      const g = W.world.landscape.grid;
      const t = W.world.landscape.towns[0];
      let best = null;
      g.forEachCell((i, col, row) => {
        for (let dc = 0; dc < w; dc++)
          for (let dr = 0; dr < h; dr++) {
            const j = g.index(col + dc, row + dr);
            if (j < 0 || g.height[j] !== 0 || g.feature[j] !== FEAT_NONE || g.surface[j] !== SURF_GRASS || g.road[j] !== 0) return;
          }
        const d = Math.hypot(g.centreX(col) - t.centre.x - 1200, g.centreZ(row) - t.centre.z);
        if (!best || d < best.d) best = { col, row, d, x: g.centreX(col) - 36, z: g.centreZ(row) - 36 };
      });
      return best;
    },
    { w, h },
  );

// 1. The stone viaduct across a valley: two hills two levels up, a valley four squares wide between, the viaduct on
// the hilltops, a straight on each.
const vSpot = await open(14, 5);
const via = await p.evaluate(async (s) => {
  const W = window.woodrail;
  const { setHeights } = await import("/src/landscape/edit.ts");
  const { RISER_HEIGHT } = await import("/src/track/index.ts");
  const g = W.world.landscape.grid;
  const heights = new Map();
  // Columns: 2 2 2 2 1 0 0 1 2 2 2 2 (12), rows 1..3 of the block.
  const prof = [2, 2, 2, 2, 1, 0, 0, 1, 2, 2, 2, 2];
  for (let c = 0; c < prof.length; c++) for (let r = 0; r < 5; r++) heights.set(g.index(s.col + 1 + c, s.row + r), r === 0 || r === 4 ? Math.min(1, prof[c]) : prof[c]);
  W.editLand(setHeights(W.world.landscape, heights));
  const z = s.z + 2.5 * 72;
  const x0 = s.x + (1 + 3) * 72;
  const y = 2 * RISER_HEIGHT;
  const ed = W.editor();
  const a = ed.place("straight-216", { x: x0 - 216, z, heading: 0 }, y, false);
  const v = ed.place("viaduct", { x: x0, z, heading: 0 }, y, false);
  const c = ed.place("straight-216", { x: x0 + 432, z, heading: 0 }, y, false);
  W.trackChanged();
  W.invalidate();
  return { a, v, c, x: x0 + 216, z };
}, vSpot);
console.log("viaduct:", JSON.stringify(via));
await look(via.x, via.z, 1500, 1.05, 0.5, 60);
await snap("viaduct");

// 2. The lift bridge over a river at the ground: down, then up for a boat with a train held at its end.
const river = await p.evaluate(async () => {
  const W = window.woodrail;
  const { SURF_RIVER, FEAT_NONE } = await import("/src/landscape/grid.ts");
  const g = W.world.landscape.grid;
  const t = W.world.landscape.towns[0];
  let best = null;
  // A river one or two squares wide along z, with three dry squares either side along x.
  g.forEachCell((i, col, row) => {
    if (g.surface[i] !== SURF_RIVER) return;
    for (const wide of [1, 2]) {
      const ok = (c, wet) => {
        const j = g.index(c, row);
        return j >= 0 && (wet ? g.surface[j] === SURF_RIVER : g.surface[j] !== SURF_RIVER && g.height[j] === 0 && g.feature[j] === FEAT_NONE && g.road[j] === 0);
      };
      if (!ok(col - 1, false) || !ok(col - 2, false) || !ok(col - 3, false)) continue;
      let fits = true;
      for (let k = 0; k < wide; k++) fits &&= ok(col + k, true);
      for (let k = 0; k < 3; k++) fits &&= ok(col + wide + k, false);
      if (!fits) continue;
      const d = Math.hypot(g.centreX(col) - t.centre.x, g.centreZ(row) - t.centre.z);
      if (!best || d < best.d) best = { col, row, wide, d, x: g.centreX(col) - 36 + (wide * 72) / 2, z: g.centreZ(row) };
    }
  });
  if (!best) return null;
  const ed = W.editor();
  const x0 = best.x - 108;
  const lb = ed.place("kit-lift-bridge", { x: x0, z: best.z, heading: 0 }, 0, false);
  const left = ed.place("straight-216", { x: x0 - 216, z: best.z, heading: 0 }, 0, false);
  const left2 = ed.place("straight-216", { x: x0 - 432, z: best.z, heading: 0 }, 0, false);
  ed.place("straight-216", { x: x0 + 216, z: best.z, heading: 0 }, 0, false);
  W.trackChanged();
  const r = W.sim.addTrain(["engine", "passenger", "passenger", "passenger"], { pieceId: left, pathIndex: 0, reversed: false, s: 200 });
  // (Its coaches: a sleeper, first class and the observation car at the back, behind the express.)
  if (r.kind === "placed") {
    const ids = W.sim.getTrain(r.trainId).cars.map((c) => c.id);
    W.sim.setLook(ids[0], "express");
    W.sim.setLook(ids[1], "sleeper");
    W.sim.setLook(ids[2], "first-class");
    W.sim.setLook(ids[3], "observation");
  }
  W.invalidate();
  return { ...best, lb, left, left2, train: r.kind === "placed" ? r.trainId : r.kind };
});
console.log("lift bridge:", JSON.stringify(river));
if (river) {
  await look(river.x - 60, river.z, 1150, 1.0, 0.45);
  await snap("lift-bridge-down");
  // Up for a boat, then the train set going: it runs up to the bridge's end and waits there.
  console.log("raised:", await p.evaluate(({ lb, train }) => {
    const W = window.woodrail;
    const up = W.sim.raiseBridge(lb);
    W.sim.setLever(W.sim.getTrain(train).cars[0].id, 1);
    // (By the sim's own ticks: 4 s, the span up and the train come to its end.)
    for (let i = 0; i < 4 * 120; i++) {
      W.sim.tick();
      W.economy.tick();
    }
    W.invalidate();
    return { up, at: W.sim.liftPosition(lb), held: W.sim.bridgeWait(W.sim.trainIds().find((t) => W.sim.getTrain(t).cars.length === 4)) };
  }, river));
  await look(river.x - 60, river.z, 1150, 1.0, 0.45);
  await snap("lift-bridge-up");
}

// 3. A warehouse with Lift and load: its goods lift and two more floors, its piles full.
const wSpot = await open(5, 4);
const wh = await p.evaluate(async (s) => {
  const W = window.woodrail;
  const { CARGO } = await import("/src/economy/cargo.ts");
  const id = W.editor().place("depot-warehouse", { x: s.x, z: s.z + 36, heading: 0 }, 0, false);
  const d = W.economy.depotAtPiece(id) ?? W.economy.addDepot("warehouse", id);
  for (const k of ["log", "planks", "grain", "flour", "stone"]) d.piles[CARGO[k].index] = 50;
  W.depotView.setWorld(W.economy, W.layout);
  W.invalidate();
  return { x: s.x + 108, z: s.z + 108, cap: (await import("/src/economy/economy.ts")).capAt(d) };
}, wSpot);
console.log("warehouse:", JSON.stringify(wh));
await look(wh.x, wh.z, 900, 0.95, 0.6);
await snap("warehouse-lift");

// 4. The observatory on a hilltop two levels up, a straight on along it.
const obs = await p.evaluate(async () => {
  const W = window.woodrail;
  const { hillsOf } = await import("/src/landscape/hill-shape.ts");
  const g = W.world.landscape.grid;
  const hills = hillsOf(g);
  const t = W.world.landscape.towns[0];
  let best = null;
  g.forEachCell((i, col, row) => {
    if (g.height[i] < 2) return;
    const x = g.centreX(col) - 36;
    const z = g.centreZ(row);
    for (let k = 0; k < 6; k++) if (hills.groundAt(x + k * 72 + 36, z) < 96 || hills.groundAt(x + k * 72 + 36, z + 100) < 96) return;
    const d = Math.hypot(x - t.centre.x, z - t.centre.z);
    if (!best || d < best.d) best = { x, z, d, y: hills.groundAt(x + 36, z) };
  });
  if (!best) return null;
  const ed = W.editor();
  const id = ed.place("kit-observatory", { x: best.x + 108, z: best.z, heading: 0 }, best.y, false);
  ed.place("straight-216", { x: best.x - 108, z: best.z, heading: 0 }, best.y, false);
  W.trackChanged();
  W.invalidate();
  return { ...best, id };
});
console.log("observatory:", JSON.stringify(obs));
if (obs) {
  await look(obs.x + 216, obs.z + 80, 900, 0.9, -0.6, obs.y);
  await snap("observatory");
}

// 5. The coaches close up: the train held at the lift bridge (an express, a sleeper, first class, the observation car).
if (river) {
  await look(river.x - 430, river.z, 650, 1.0, 0.9);
  await snap("coaches");
}

// 6. The research board on the new rows.
const board = async (open) => {
  for (let i = 0; i < 3; i++) {
    if (!!(await p.evaluate(() => document.querySelector(".board-open"))) === open) return;
    await p.evaluate((open) => (open ? document.querySelector(".research-pill") : document.querySelector(".board-head .close"))?.click(), open);
    await p.waitForTimeout(600);
  }
};
const select = (name) =>
  p.evaluate((name) => {
    const el = [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === name);
    if (!el) return false;
    el.click();
    el.scrollIntoView({ block: "center" });
    return true;
  }, name);
// (Forget them again, so the board shows them as things to research.)
await p.evaluate(() => {
  const pr = window.woodrail.progress();
  for (const id of ["viaduct", "lift-bridge", "lift-load", "sleeper", "observation", "observatory"]) pr.learned.delete(id);
});
await board(true);
for (const [name, file] of [
  ["Stone viaduct", "board-viaduct"],
  ["Night sleepers", "board-sleeper"],
  ["Observatory", "board-observatory"],
]) {
  console.log(name, await select(name));
  await p.waitForTimeout(700);
  await quiet();
  await snap(file);
}
await board(false);
console.log(errors.length ? `page errors: ${errors.slice(0, 3).join(" | ")}` : "no page errors");
await b.close();
await server.close();
process.exit(0);
