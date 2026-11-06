// End-to-end: tech tree 5 (Stone viaduct, Lift bridge, Lift and load, Night sleepers, Observation car, Observatory),
// Game mode on a 390×844 phone.
// Setup (named shortcuts, not what's tested): each row checked not researchable before what it needs, then researchable
// once it is (the needs learned, riders counted, a school beside a city noted), then learned; a viaduct, a lift bridge
// and an observatory put in the toy box (making them is the workshop's e2e; their prices are checked from the rules);
// two hills two levels up with a valley between set on open felt (squares the Raise tool's land editor would raise); straights laid
// by the editor up to where the tested pieces go; trains put on the track by the sim; riders put on the coaches (they
// board at stations in play: passengers.test.ts); the sim and economy ticked in the page, with the game's
// once-a-second look for views (`noteViews`) called as its clock would. Then, as a player does it:
//   1. The tray: the Stone viaduct on the Bridges shelf, the Lift bridge with the Railway kit, the Observatory with the
//      halts, the Sleeper and the Observation car with the coaches.
//   2. The viaduct from the tray put down at the line's end on the first hilltop: it snaps there, two levels up, and
//      its far end is on the second hilltop across the valley.
//   3. The observatory from the tray put down at the viaduct's end on the hilltop: a stop. On the felt it's refused,
//      saying why.
//   4. A train (an express, a coach, a sleeper and an observation car) with riders from the farthest town runs over
//      the viaduct to the observatory: they get off there and pay three times the fare, half as much again for the
//      view, and the sleeper's two and a half times again for the long trip.
//   5. The lift bridge from the tray put down at a line's end on a river's bank: it crosses the river at the ground. A
//      tap raises it; a train set going halts at its end, its card saying why; once it's down the train crosses.
//      A boat's ask (`askToPass`) raises it too.
//   6. Lift and load: a warehouse's card says it holds three times as much, and a train's two wagons of planks are
//      unloaded into it quicker than before.
//   7. Idle: no frames drawn.
//
// Usage: npm run e2e:tech-tree-5 [-- <out dir>]   (default out: e2e-out/tech-tree-5)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/tech-tree-5";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5414, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
const results = [];
const check = (what, ok, detail = "") => {
  results.push({ what, ok });
  console.log(ok ? "PASS" : "FAIL", what, ok ? "" : detail);
};
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const snap = async (name) => {
  await settle();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}`, type: "jpeg", quality: 80, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
};

await p.goto(`${PAGE}/#seed-24`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-game .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary").click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
await p.evaluate(() => {
  const h = window.woodrail.hud;
  window.__said = [];
  for (const k of ["toast", "refuse", "setRefusal"]) {
    const f = h[k].bind(h);
    h[k] = (m, ...a) => (m && window.__said.push(m), f(m, ...a));
  }
});
const said = () => p.evaluate(() => window.__said.splice(0));
const pressAt = async (sel, k = 0) => {
  const r = await p.evaluate(([sel, k]) => { const e = document.querySelectorAll(sel)[k]; if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, [sel, k]);
  if (r) await p.mouse.click(r[0], r[1]);
  await frames();
  return !!r;
};
const tab = async (label) => {
  const ok = await p.evaluate((label) => { const t = [...document.querySelectorAll(".tabs button")].find((e) => e.textContent.includes(label)); t?.click(); return !!t; }, label);
  await frames();
  return ok;
};
const item = async (key) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, key);
  for (let k = 0; k < 24; k++) {
    const r = await find();
    if (r) return r;
    if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) await pressAt(".scroller .tray-back");
    if (!(await pressAt(".scroller .tray-group", k))) return null;
  }
  return null;
};
const screen = (x, y, z) =>
  p.evaluate(([x, y, z]) => {
    const w = window.woodrail;
    const v = new w.camera.position.constructor(x, y, z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, [x, y, z]);
const look = (x, z, from, dist, atY = 20) =>
  p.evaluate(
    ([x, z, from, dist, atY]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const at = new V(x, atY, z);
      w.controls.target.copy(at);
      w.camera.position.copy(at.clone().add(new V(...from).normalize().multiplyScalar(dist)));
      w.camera.lookAt(at);
      w.controls.update?.();
      w.invalidate?.();
    },
    [x, z, from, dist, atY],
  );
const pieces = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()].map((i) => ({ id: i, ...window.woodrail.layout.getPiece(i) })));
const putDown = async (key, x, y, z) => {
  const r = await item(key);
  if (!r) return false;
  const at = await screen(x, y, z);
  await p.mouse.click(r[0], r[1]);
  await frames();
  await p.mouse.move(at[0], at[1], { steps: 6 });
  await frames();
  await p.mouse.click(at[0], at[1]);
  await frames();
  await p.keyboard.press("Escape");
  await settle();
  return true;
};
const ROWS = ["viaduct", "lift-bridge", "lift-load", "sleeper", "observation", "observatory"];

// Setup: research.
const research = await p.evaluate(async (ROWS) => {
  const w = window.woodrail;
  const { canResearch } = await import("/src/game/research.ts");
  const progress = w.progress();
  const before = Object.fromEntries(ROWS.map((id) => [id, canResearch(progress, id)]));
  for (const id of ["switches", "bridges", "junctions", "routes", "passengers", "halts", "dining", "first-class", "stations", "double-decker", "express", "farming", "mills", "tank", "goods-engine", "quarries", "mines", "foundry", "carpentry", "scenery", "college", "warehouses", "cranes1", "cranes2", "harbours", "signal-boxes", "telegraph", "university"]) w.learn(id);
  progress.riders = 500;
  // (Tier 3 is taught at a school beside a city: noted as the map would note it.)
  progress.landmarks.add("city-school");
  const after = Object.fromEntries(ROWS.map((id) => [id, canResearch(progress, id)]));
  for (const id of ROWS) w.learn(id);
  progress.coins += 2000;
  for (const id of ["piece:viaduct", "piece:kit-observatory", "piece:kit-lift-bridge"]) progress.add(id, 1);
  w.hud.refreshTrayBadges?.();
  return { before, after };
}, ROWS);
check("setup: none of the six is researchable before what it needs", ROWS.every((id) => !research.before[id]), JSON.stringify(research.before));
check("setup: each is researchable once it is", ROWS.every((id) => research.after[id]), JSON.stringify(research.after));
const price = await p.evaluate(async () => {
  const { costOf } = await import("/src/game/crafting.ts");
  const c = costOf(new Map([["piece:viaduct", 1], ["piece:kit-lift-bridge", 1], ["piece:kit-observatory", 1]]));
  return { coins: c.coins, ...c.goods };
});
check("a viaduct, a lift bridge and an observatory cost 210 coins, 20 planks, 4 stone and 6 iron at the workshop", price.coins === 210 && price.planks === 20 && price.stone === 4 && price.iron === 6, JSON.stringify(price));

// 1. The tray.
await tab("Track");
check("the Bridges shelf has the Stone viaduct", !!(await item("piece:viaduct")));
check("the Railway kit has the Lift bridge", !!(await item("piece:kit-lift-bridge")));
await tab("Industries");
check("the Observatory is with the halts (Industries tab)", !!(await item("piece:kit-observatory")));
await tab("Trains");
check("the Sleeper is with the coaches", !!(await item("train:Sleeper")));
check("…and the Observation car", !!(await item("train:Observation car")));
await p.keyboard.press("Escape");
await tab("Track");
await frames();

// Setup: two hills two levels up, a valley four squares wide between, on open felt far from one town (the sleeper's
// long trip), straights on the first hilltop up to the valley's edge.
const site = await p.evaluate(async () => {
  const w = window.woodrail;
  const { setHeights } = await import("/src/landscape/edit.ts");
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { SLEEPER_TRIP } = await import("/src/game/passengers.ts");
  const g = w.landscape.grid;
  const rules = w.interaction.rules;
  const editor = w.interaction.landEditor();
  const towns = w.landscape.towns;
  const starts = [];
  g.forEachCell((i, col, row) => starts.push([g.centreX(col) - 36, g.centreZ(row)]));
  for (const [X, Z] of starts) {
      // Far from some town's station (a long trip).
      const farthest = Math.max(...towns.map((t) => Math.hypot(t.centre.x - X - 1100, t.centre.z - Z)));
      if (farthest < SLEEPER_TRIP + 150) continue;
      let ok = true;
      for (let c = -1; c < 24 && ok; c++)
        for (let r = -2; r <= 2 && ok; r++) {
          const i = g.cellAtWorld(X + c * 72 + 36, Z + r * 72);
          if (i === -1 || g.height[i] !== 0 || trackBlock(rules, "straight-54", false, { x: X + c * 72 + 9, z: Z + r * 72, heading: 0 }, 0, -1) !== null) ok = false;
        }
      if (!ok) continue;
      // Hill A on columns 0..9 (two levels on 1..8), hill B on 12..22 (two levels on 13..21).
      const one = [];
      const two = [];
      for (let r = -2; r <= 2; r++)
        for (let c = 0; c <= 22; c++) {
          if (c === 10 || c === 11) continue;
          one.push(g.cellAtWorld(X + c * 72 + 36, Z + r * 72));
          if (Math.abs(r) <= 1 && (c >= 1 && c <= 8) || (c >= 13 && c <= 21)) two.push(g.cellAtWorld(X + c * 72 + 36, Z + r * 72));
        }
      if (one.some((i) => editor.check(i, 1) !== null)) continue;
      // (Set as the Raise tool leaves them, a block at a time: one level, then the hilltops' second.)
      const heights = new Map();
      for (const i of one) heights.set(i, 1);
      for (const i of two) heights.set(i, 2);
      w.editLand(setHeights(w.landscape, heights));
      if (two.some((i) => g.height[i] !== 2)) return { error: "hills not two levels" };
      const ids = w.editor().placeRun([
        { type: "straight-288", pose: { x: X + 72, z: Z, heading: 0 }, y: 96, flipped: false },
        { type: "straight-288", pose: { x: X + 360, z: Z, heading: 0 }, y: 96, flipped: false },
      ]);
      // The town farthest away: its station is where the riders got on.
      let far = towns[0];
      for (const t of towns) if (Math.hypot(t.centre.x - X - 1100, t.centre.z - Z) > Math.hypot(far.centre.x - X - 1100, far.centre.z - Z)) far = t;
      return { X, Z, ids, far: far.id };
  }
  return { error: "no room", towns: towns.map((t) => [Math.round(t.centre.x), Math.round(t.centre.z)]), cells: starts.length };
});

if (site.error) throw new Error(JSON.stringify(site));
const { X, Z } = site;

// 2. The viaduct at the first hilltop's line end.
const edge = X + 648;
await look(edge + 40, Z, [-1, 0.9, 0.2], 900, 90);
await settle();
const had = await pieces();
await said();
const putVia = await putDown("piece:viaduct", edge, 96, Z);
const via = (await pieces()).find((q) => q.type === "viaduct" && !had.some((o) => o.id === q.id));
check("the viaduct from the tray snaps onto the line's end on the hilltop, two levels up", putVia && !!via && Math.abs(via.pose.x - edge) < 1 && via.y === 96, JSON.stringify({ via, said: await said() }));
const arches = await p.evaluate((id) => (id === undefined ? null : window.woodrail.bridgeLevelsOf(window.woodrail.layout.getPiece(id))), via?.id);
check("…on arches down to the valley floor (two levels)", arches === 2, `${arches}`);
await snap("viaduct.jpg");

// 3. The observatory at the viaduct's far end, on the second hilltop.
const far = edge + 432;
const rule = await p.evaluate(({ X, Z }) => window.woodrail.interaction.siteRule?.("kit-observatory", { x: X, z: Z + 400, heading: 0 }, -1) ?? null, { X, Z });
check("on the felt, the observatory is refused, saying why", rule === "An observatory stands on a hilltop two levels up or more", `${rule}`);
await look(far + 40, Z, [-1, 0.9, 0.2], 800, 90);
await settle();
const was = await pieces();
await tab("Industries");
const putObs = await putDown("piece:kit-observatory", far, 96, Z);
await tab("Track");
const obs = (await pieces()).find((q) => q.type === "kit-observatory" && !was.some((o) => o.id === q.id));
const stop = await p.evaluate((id) => {
  const w = window.woodrail;
  const d = id === undefined ? null : w.economy.depotAtPiece(id);
  return d ? { role: d.role, sight: w.economy.isLookout(d) } : null;
}, obs?.id);
check("the observatory from the tray goes down on the hilltop at the viaduct's end", putObs && !!obs && obs.y === 96 && Math.abs(obs.pose.x - far) < 1, JSON.stringify({ obs, said: await said() }));
check("…and it's a stop where riders get off", !!stop && stop.role === "town" && stop.sight, JSON.stringify(stop));
await snap("observatory.jpg");

// 4. Stargazers by sleeper and observation car, over the viaduct.
const ride = await p.evaluate(async ({ ids, obs, farTown, Z }) => {
  const w = window.woodrail;
  const { noteViews, FIRST_CLASS, SLEEPER, SLEEPER_TRIP, OBSERVATION, STARGAZER_FARE } = await import("/src/game/passengers.ts");
  void FIRST_CLASS;
  const progress = w.progress();
  const station = w.economy.depotAtPiece(w.world.stations.get(farTown));
  const o = w.economy.depotAtPiece(obs);
  if (!station || !o) return { error: "no stops" };
  const r = w.sim.addTrain(["engine", "passenger", "passenger", "passenger"], { pieceId: ids[1], pathIndex: 0, s: 280, reversed: false });
  if (r.kind !== "placed") return { error: r.kind };
  const cars = w.sim.getTrain(r.trainId).cars.map((c) => c.id);
  const [engine, plain, sleeper, observation] = cars;
  w.sim.setLook(engine, "express");
  w.sim.setLook(sleeper, "sleeper");
  w.sim.setLook(observation, "observation");
  w.economy.setRiders(plain, 2, station.id);
  w.economy.setRiders(sleeper, 2, station.id);
  // What each should pay: the distance's fare, three times for the stars, half again for the view, and the sleeper's.
  const a = w.layout.getPiece(station.pieceId).pose;
  const bpose = w.layout.getPiece(o.pieceId).pose;
  const dist = Math.hypot(a.x - bpose.x, a.z - bpose.z);
  const base = Math.max(1, Math.round(dist / 800));
  const want = { plain: Math.round(base * OBSERVATION * STARGAZER_FARE), sleeper: Math.round(base * SLEEPER * OBSERVATION * STARGAZER_FARE) };
  const paid = [];
  const onAlight = w.economy.onAlight;
  w.economy.onAlight = (from, to, carId) => {
    const before = progress.coins;
    onAlight(from, to, carId);
    paid.push({ car: carId === sleeper ? "sleeper" : "plain", fare: progress.coins - before, at: to.id === o.id });
  };
  let crossed = false;
  w.sim.setLever(engine, 1);
  for (let k = 0; k < 90 * 120 && paid.length < 4; k++) {
    w.sim.tick();
    w.economy.tick();
    if (k % 120 === 0) noteViews(w.world);
    if (w.sim.getTrain(w.sim.findCar(engine).train.id).bogies.some((b) => w.layout.getPiece(b.pieceId)?.type === "viaduct")) crossed = true;
  }
  w.economy.onAlight = onAlight;
  w.sim.setLever(engine, 0);
  for (let k = 0; k < 240; k++) w.sim.tick();
  w.invalidate();
  void Z;
  return { crossed, dist: Math.round(dist), long: dist >= SLEEPER_TRIP, want, paid, engine };
}, { ids: site.ids, obs: obs?.id, farTown: site.far, Z });
check("the train runs over the viaduct to the observatory", !!ride.crossed, JSON.stringify(ride));
check("…the riders get off there", ride.paid?.length === 4 && ride.paid.every((x) => x.at), JSON.stringify(ride));
check("…a coach's riders pay three times the fare and half as much again for the view", ride.paid?.filter((x) => x.car === "plain").every((x) => x.fare === ride.want.plain), JSON.stringify(ride));
check("…the sleeper's, on a long trip, two and a half times that again", ride.long && ride.paid?.filter((x) => x.car === "sleeper").every((x) => x.fare === ride.want.sleeper) && ride.want.sleeper > ride.want.plain, JSON.stringify(ride));
if (ride.engine) {
  const at = await p.evaluate((id) => {
    const f = window.woodrail.sim.findCar(id);
    const c = f.train.world[2 * f.index];
    return [c.x, c.z];
  }, ride.engine);
  await look(at[0] - 100, at[1], [-0.5, 0.8, 1], 700, 90);
  await snap("stargazers.jpg");
}

// 5. The lift bridge over a river.
const river = await p.evaluate(async () => {
  const w = window.woodrail;
  const { SURF_RIVER, FEAT_NONE } = await import("/src/landscape/grid.ts");
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const g = w.landscape.grid;
  const rules = w.interaction.rules;
  let best = null;
  // A river one or two squares wide, crossed along x or along z: six dry squares before it (two straights), three
  // after; the bridge's middle over the water.
  for (const [dc, dr, heading] of [[1, 0, 0], [0, 1, Math.PI / 2]])
    g.forEachCell((i, col, row) => {
      if (best || g.surface[i] !== SURF_RIVER) return;
      const at = (k) => g.index(col + dc * k, row + dr * k);
      const dry = (k) => {
        const j = at(k);
        return j >= 0 && g.surface[j] !== SURF_RIVER && g.height[j] === 0 && g.feature[j] === FEAT_NONE && g.road[j] === 0;
      };
      if (!dry(-1)) return;
      const wide = g.surface[at(1)] === SURF_RIVER ? 2 : 1;
      for (let k = 2; k <= 6; k++) if (!dry(-k)) return;
      for (let k = wide; k < wide + 3; k++) if (!dry(k)) return;
      const ux = Math.cos(heading);
      const uz = Math.sin(heading);
      // The water's middle, then the bridge's start 108 back from it.
      const mx = g.centreX(col) + (dc * (wide - 1) * 72) / 2;
      const mz = g.centreZ(row) + (dr * (wide - 1) * 72) / 2;
      const x0 = mx - 108 * ux;
      const z0 = mz - 108 * uz;
      for (let s = 1; s <= 2; s++) if (trackBlock(rules, "straight-216", false, { x: x0 - 216 * s * ux, z: z0 - 216 * s * uz, heading }, 0, -1) !== null) return;
      best = { x0, z0, ux, uz, heading, mx, mz };
    });
  if (!best) return { error: "no river" };
  const { x0, z0, ux, uz, heading } = best;
  const ids = w.editor().placeRun([
    { type: "straight-216", pose: { x: x0 - 432 * ux, z: z0 - 432 * uz, heading }, y: 0, flipped: false },
    { type: "straight-216", pose: { x: x0 - 216 * ux, z: z0 - 216 * uz, heading }, y: 0, flipped: false },
  ]);
  return { ...best, ids };
});
check("setup: a river with dry banks for the lift bridge", !river.error, JSON.stringify(river));
if (!river.error) {
  await look(river.x0, river.z0, [-river.ux, 0.9, -river.uz + 0.2], 800, 20);
  await settle();
  const had2 = await pieces();
  const putLift = await putDown("piece:kit-lift-bridge", river.x0, 0, river.z0);
  const lb = (await pieces()).find((q) => q.type === "kit-lift-bridge" && !had2.some((o) => o.id === q.id));
  check("the lift bridge from the tray goes down at the line's end, across the river at the ground", putLift && !!lb && Math.hypot(lb.pose.x - river.x0, lb.pose.z - river.z0) < 1 && lb.y === 0, JSON.stringify({ lb, said: await said() }));
  if (lb) {
    // (A straight on beyond it, for the train to cross onto.)
    await p.evaluate(({ x0, z0, ux, uz, heading }) => window.woodrail.editor().placeRun([{ type: "straight-216", pose: { x: x0 + 216 * ux, z: z0 + 216 * uz, heading }, y: 0, flipped: false }]), river);
    // A tap on it raises it (the game running).
    await p.evaluate(() => (window.woodrail.paused = false));
    const tapAt = await screen(river.mx, 6, river.mz);
    await p.mouse.click(tapAt[0], tapAt[1]);
    await frames();
    const tapped = await p.evaluate((id) => window.woodrail.sim.bridgeRaised(id), lb.id);
    if (!tapped) await p.evaluate((id) => window.woodrail.sim.toggleSwitch(id), lb.id);
    const words = await said();
    check("a tap on the lift bridge raises its span, saying so", tapped && words.includes("Up goes the lift bridge, for a boat"), JSON.stringify(words));
    const held = await p.evaluate(({ ids, lb }) => {
      const w = window.woodrail;
      const r = w.sim.addTrain(["engine", "passenger"], { pieceId: ids[1], pathIndex: 0, s: 205, reversed: false });
      if (r.kind !== "placed") return { error: r.kind };
      const engine = w.sim.getTrain(r.trainId).cars[0].id;
      w.sim.setLever(engine, 1);
      for (let k = 0; k < 4 * 120; k++) {
        w.sim.tick();
        w.economy.tick();
      }
      w.invalidate();
      const t = w.sim.findCar(engine).train;
      return { engine, speed: t.speed, on: t.bogies.some((b) => b.pieceId === lb), wait: w.sim.bridgeWait(t.id), up: w.sim.liftPosition(lb), turnback: t.turnback };
    }, { ids: river.ids, lb: lb.id });
    check("a train set going halts at its end while it's up (no turning back)", held.speed === 0 && !held.on && held.wait && held.up === 1 && held.turnback === -1, JSON.stringify(held));
    await look(river.mx, river.mz, [0.6, 0.9, 1], 800, 30);
    await snap("lift-bridge-up.jpg");
    const enginePos = await p.evaluate((id) => {
      const f = window.woodrail.sim.findCar(id);
      const c = f.train.world[2 * f.index];
      const r = f.train.world[2 * f.index + 1];
      return [(c.x + r.x) / 2, (c.y + r.y) / 2 + 30, (c.z + r.z) / 2];
    }, held.engine);
    await p.evaluate(() => (window.woodrail.paused = true));
    await look(enginePos[0], enginePos[2], [0.6, 0.9, 1], 600, 20);
    await settle();
    const tapE = await screen(...enginePos);
    await p.mouse.click(tapE[0], tapE[1]);
    await frames();
    await settle();
    const status = await p.evaluate(() => document.querySelector(".engine-card:not([hidden]) .engine-status")?.textContent ?? null);
    check("…its card says why", status === "Waiting: the lift bridge is up for a boat", `${status}`);
    await snap("lift-bridge-card.jpg");
    await p.keyboard.press("Escape");
    const on = await p.evaluate(({ engine, lb, ux, uz }) => {
      const w = window.woodrail;
      const p0 = w.layout.getPiece(lb).pose;
      let crossed = false;
      for (let k = 0; k < 15 * 120 && !crossed; k++) {
        w.sim.tick();
        w.economy.tick();
        const t = w.sim.findCar(engine).train;
        // (Wholly past it: every axle on the far side, along the line.)
        crossed = t.world.every((q) => (q.x - p0.x) * ux + (q.z - p0.z) * uz > 216 + 4);
      }
      w.sim.setLever(engine, 0);
      return { crossed, down: !w.sim.bridgeRaised(lb) };
    }, { engine: held.engine, lb: lb.id, ux: river.ux, uz: river.uz });
    check("…once it's down, the train crosses the river", on.crossed && on.down, JSON.stringify(on));
    const boat = await p.evaluate(async (lb) => {
      const w = window.woodrail;
      const { askToPass, liftBridgesNear } = await import("/src/game/lift-bridges.ts");
      const p = w.layout.getPiece(lb).pose;
      const near = liftBridgesNear(w.world, p.x + 108 * Math.cos(p.heading), p.z + 108 * Math.sin(p.heading), 40);
      const first = askToPass(w.world, lb);
      for (let k = 0; k < 3 * 120; k++) w.sim.tick();
      return { near: near.includes(lb), first, then: askToPass(w.world, lb) };
    }, lb.id);
    check("a boat's ask raises it, and it's open for the boat once up", boat.near && boat.first === "rising" && boat.then === "open", JSON.stringify(boat));
  }
}

// 6. Lift and load: a warehouse three times as big, and quicker to unload.
const store = await p.evaluate(async ({ X, Z }) => {
  const w = window.woodrail;
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { capAt } = await import("/src/economy/economy.ts");
  const { applyCranes } = await import("/src/game/upgrades.ts");
  // A line on the felt beyond the hills: a straight, the warehouse, two straights.
  const z = Z + 360;
  const ids = w.editor().placeRun([
    { type: "straight-216", pose: { x: X, z, heading: 0 }, y: 0, flipped: false },
    { type: "straight-216", pose: { x: X + 216, z, heading: 0 }, y: 0, flipped: false },
    { type: "depot-warehouse", pose: { x: X + 432, z, heading: 0 }, y: 0, flipped: false },
    { type: "straight-216", pose: { x: X + 648, z, heading: 0 }, y: 0, flipped: false },
    { type: "straight-216", pose: { x: X + 864, z, heading: 0 }, y: 0, flipped: false },
  ]);
  const d = w.economy.depotAtPiece(ids[2]);
  if (!d) return { error: "no warehouse", ids };
  const run = () => {
    d.piles[CARGO.planks.index] = 0;
    const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") return -1;
    const [engine, w1, w2] = w.sim.getTrain(r.trainId).cars.map((c) => c.id);
    w.economy.setRoute(engine, { stops: [{ depotId: d.id, action: "drop" }], next: 0 });
    w.economy.setCargo(w1, "planks", 3);
    w.economy.setCargo(w2, "planks", 3);
    w.sim.setLever(engine, 1);
    // (From the first planks in to the last: the crane's work, not the run in.)
    let t = -1;
    let first = -1;
    for (let k = 0; k < 40 * 120; k++) {
      w.sim.tick();
      w.economy.tick();
      if (first < 0 && d.piles[CARGO.planks.index] > 0) first = k;
      if (d.piles[CARGO.planks.index] === 6) {
        t = (k - first) / 120;
        break;
      }
    }
    w.sim.removeTrain(w.sim.findCar(engine).train.id);
    return t;
  };
  const pr = w.progress();
  pr.learned.delete("lift-load");
  applyCranes(w.economy, pr);
  const plainCap = capAt(d);
  const plain = run();
  w.learn("lift-load");
  const cap = capAt(d);
  const lifted = run();
  w.interaction.openDepotCard(d.id);
  await new Promise((r) => setTimeout(r, 300));
  const rows = [...document.querySelectorAll(".store-row, .pile-row, .piece-card .store .row")].map((e) => e.textContent).slice(0, 3);
  return { plainCap, cap, plain, lifted, rows, x: X + 540, z };
}, { X, Z });
check("Lift and load: a warehouse holds three times as much", store.cap === store.plainCap * 3, JSON.stringify(store));
check("…and a train's two wagons of planks are unloaded into it quicker", store.plain > 0 && store.lifted > 0 && store.lifted <= store.plain - 0.5, JSON.stringify(store));
check("…its card shows the bigger piles", (store.rows ?? []).some((t) => t.includes(`${store.cap}`)), JSON.stringify(store.rows));
await look(store.x, store.z, [-0.3, 0.9, 1], 800, 20);
await snap("warehouse-lift.jpg");
await p.keyboard.press("Escape");

// 7. Idle.
await p.evaluate(() => (window.woodrail.paused = true));
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await w.settled(3);
  let least = Infinity;
  for (let k = 0; k < 3; k++) {
    const before = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    least = Math.min(least, w.framesDrawn - before);
  }
  return least;
});
check("idle: no frames drawn in 2 s with the viaduct, the lift bridge and the observatory standing", idle === 0, `${idle} frames`);

console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close();
await server.close();
process.exit(failed.length ? 1 : 0);
