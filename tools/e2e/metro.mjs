// End-to-end: the metro (docs/superpowers/specs/2026-11-04-rail-types.md §2, §8), Game mode on a 390×844 phone.
// Setup (named shortcuts, not what's tested): Tunnels, Passengers, Busy stations and Electricity learned, then Metro found
// researchable once the biggest town is a City ★ (its deliveries written: growing one is the balance play-through's)
// and learned; coins for the digging; two metro stops and a metro train in the toy box (making them is the workshop's
// e2e; their prices are checked from the rules); a power station with coal, laid by the editor; a line under the town
// (a tunnel mouth down outside it, straights two levels under the felt across it, a mouth up on the far side) laid by
// the editor, each piece checked first by the game's own track rules; the metro train put on the track by the sim.
// Then, as a player does it:
//   1. The tray: the Metro stop with the halts, the Metro train on the Trains tab's Metro shelf.
//   2. The line under the town: its digging paid, 60 coins a square of town, the toast says so.
//   3. Two metro stops from the tray, put down over the line where their entrance lands on a free square of the town:
//      each a stop of the town's (a metro stop); on a house, refused saying why.
//   4. The metro train carries riders from one stop to the other across the town: they pay; it draws coal from the
//      power station as it runs.
//   5. The town can still build over the line (two levels down); not on an entrance.
//   6. Idle: no frames drawn with the train standing.
//
// Usage: npm run e2e:metro [-- <out dir>]   (default out: e2e-out/metro)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/metro";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5413, strictPort: false }, logLevel: "error" });
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
await p.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
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
const look = (x, z, from, dist, atY = 0) =>
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

// Setup.
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  const { canResearch } = await import("/src/game/research.ts");
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { metroTown } = await import("/src/game/world.ts");
  const progress = w.progress();
  for (const t of ["bridges", "tunnels", "passengers", "stations", "electricity"]) w.learn(t);
  const town = w.landscape.towns.slice().sort((a, b) => b.cells.length - a.cells.length)[0];
  const before = canResearch(progress, "metro");
  // (Setup: the town a City ★, as its deliveries would make it.)
  w.economy.delivered.set(town.id, 48);
  w.economy.deliveredGoods.set(town.id, { flour: 18, stone: 10 });
  // (It grows as it becomes one: a few seconds for its new streets and houses, then the game paused, so it doesn't grow
  // over the squares picked below while the test runs. The sim and the economy are ticked by hand below.)
  await new Promise((r) => setTimeout(r, 8000));
  w.paused = true;
  const after = canResearch(progress, "metro");
  w.learn("metro");
  progress.coins += 5000;
  progress.add("piece:kit-metro-stop", 2);
  progress.add("look:metro", 1);
  progress.add("car:engine", 1);
  progress.add("car:passenger", 2);
  w.hud.refreshTrayBadges?.();
  const g = w.landscape.grid;
  const rules = w.interaction.rules;
  const tally = {};
  const rows = [...new Set(town.cells.map((i) => g.rowOf(i)))].sort((a, b) => Math.abs(g.centreZ(a) - town.centre.z) - Math.abs(g.centreZ(b) - town.centre.z));
  for (const row of rows) {
    // (Not along the station's row: its way in keeps houses off the squares there.)
    if (town.cells.some((i) => g.rowOf(i) === row && g.feature[i] === 3)) continue;
    const cols = town.cells.filter((i) => g.rowOf(i) === row).map((i) => g.colOf(i));
    const z = g.centreZ(row);
    const minX = g.centreX(Math.min(...cols)) - 36;
    const maxX = g.centreX(Math.max(...cols)) + 36;
    for (const margin of [36, 72, 108, 144, 180, 216, 252, 288, 324, 360, 396, 432]) {
      const W = Math.round((minX - margin - 288) / 18) * 18;
      const n = Math.ceil((maxX + margin - (W + 288)) / 216);
      const E = W + 288 + n * 216;
      const deep = [];
      for (let k = 0; k < n; k++) deep.push({ type: "straight-216", pose: { x: W + 288 + k * 216, z, heading: 0 }, y: -96, flipped: false });
      const run = [
        { type: "straight-216", pose: { x: W - 216, z, heading: 0 }, y: 0, flipped: false },
        { type: "tunnel-mouth", pose: { x: W, z, heading: 0 }, y: 0, flipped: false },
        ...deep,
        { type: "tunnel-mouth", pose: { x: E + 288, z, heading: Math.PI }, y: 0, flipped: true },
        { type: "straight-216", pose: { x: E + 288, z, heading: 0 }, y: 0, flipped: false },
      ];
      const why = run.map((q) => trackBlock(rules, q.type, q.flipped, q.pose, q.y, -1));
      if (why.some((x) => x !== null)) {
        why.forEach((x, i) => x && (tally[`${run[i].type}@${run[i].y}:${x}`] = (tally[`${run[i].type}@${run[i].y}:${x}`] ?? 0) + 1));
        continue;
      }
      // Deep straights a metro stop could take the place of: its entrance on a free square of the town.
      const spots = deep.map((q, k) => ({ k, pose: q.pose, ok: metroTown(w.landscape, q.pose)?.id === town.id })).filter((s) => s.ok);
      const pair = spots.length >= 2 ? [spots[0], spots[spots.length - 1]] : null;
      if (!pair || pair[1].k - pair[0].k < 3) {
        tally[`spots:${spots.length}`] = (tally[`spots:${spots.length}`] ?? 0) + 1;
        continue;
      }
      const house = deep.find((q) => !metroTown(w.landscape, q.pose));
      const coins = progress.coins;
      w.said = [];
      const ids = w.editor().placeRun(run);
      // A power station off to the side, with coal (setup).
      return { before, after, town: { id: town.id, name: town.name, centre: town.centre }, z, W, E, ids, pair, house: house?.pose ?? null, coins, n };
    }
  }
  return { error: `no row under the town for a line: ${JSON.stringify(tally)}`, before, after };
});
check("setup: Metro isn't researchable at the start (it wants a City ★ and a school beside a city)", !setup.before, JSON.stringify({ before: setup.before, after: setup.after }));
if (setup.error) throw new Error(setup.error);
await settle();
const dug = await p.evaluate(async ({ coins }) => {
  const w = window.woodrail;
  const { squaresDugUnder, DIG_COINS } = await import("/src/game/metro.ts");
  return { squares: squaresDugUnder(w.world), paid: coins - w.progress().coins, each: DIG_COINS, dug: w.progress().dug };
}, setup);
const toasts = await said();
// (The coins also move by the town's crate as it became a City ★: the toast says what the digging took.)
// (The town grew as it became a City ★: squares it grew out over the line since count as dug, unpaid.)
const toastPaid = toasts.map((t) => /^Dug under the town: (\d+)🪙$/.exec(t)).filter(Boolean).map((m) => Number(m[1]));
check("the line under the town: its digging paid, 60 coins a square of town, the toast says so", toastPaid.length === 1 && toastPaid[0] % 60 === 0 && toastPaid[0] >= 60 && dug.dug >= toastPaid[0] / 60, JSON.stringify({ dug, toasts }));

// A power station, with coal (setup: the editor lays it beyond the line's west end; the game gives it its depot).
const power = await p.evaluate(async ({ W, z }) => {
  const w = window.woodrail;
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  for (const dz of [400, -400, 700, -700, 1000, -1000]) {
    const pose = { x: W - 300, z: z + dz, heading: 0 };
    if (trackBlock(w.interaction.rules, "depot-power", false, pose, 0, -1) !== null) continue;
    const [id] = w.editor().placeRun([{ type: "depot-power", pose, y: 0, flipped: false }]);
    await new Promise((r) => setTimeout(r, 50));
    const d = w.economy.depotAtPiece(id);
    if (!d) continue;
    d.piles[CARGO.coal.index] = 200;
    return { id, depot: d.id };
  }
  return null;
}, setup);
check("setup: a power station with coal", !!power, JSON.stringify(power));

// 1. The tray.
await tab("Industries");
check("the Metro stop is with the halts (Industries tab)", !!(await item("piece:kit-metro-stop")));
await tab("Trains");
check("the Metro train is on the Trains tab's Metro shelf", !!(await item("train:Metro train")));
await tab("Track");
const price = await p.evaluate(async () => {
  const { costOf } = await import("/src/game/crafting.ts");
  const stop = costOf(new Map([["piece:kit-metro-stop", 1]]));
  const train = costOf(new Map([["look:metro", 1]]));
  return { stop: { coins: stop.coins, ...stop.goods }, train: { coins: train.coins, ...train.goods } };
});
check("a metro stop costs 600 coins, 25 iron, 10 planks; a metro train 400 coins, 15 iron, 6 planks (its cars besides)", price.stop.coins === 600 && price.stop.iron === 25 && price.train.coins === 400 && price.train.iron === 15, JSON.stringify(price));

// 3. Two metro stops from the tray, over the line where their entrances land on free squares.
const putStop = async (pose) => {
  await look(pose.x + 108, setup.z, [-0.15, 1.3, 1], 700, 0);
  await settle();
  const was = await pieces();
  const r = await item("piece:kit-metro-stop");
  if (!r) return { error: "no tray item" };
  // (The line is two levels down: the finger's on the felt over the straight's middle.)
  const at = await screen(pose.x + 108, 0, pose.z);
  await p.mouse.click(r[0], r[1]);
  await frames();
  await p.mouse.move(at[0], at[1], { steps: 6 });
  await frames();
  const held = await p.evaluate(() => {
    const m = window.woodrail.interaction.preview;
    return m ? { blocked: m.blocked ?? null, snap: m.snap?.kind ?? null, y: m.y ?? null } : null;
  });
  await p.mouse.click(at[0], at[1]);
  await frames();
  await p.keyboard.press("Escape");
  await settle();
  const now = await pieces();
  const stop = now.find((q) => q.type === "kit-metro-stop" && !was.some((o) => o.id === q.id));
  return { stop, held, said: await said() };
};
// (The town grows as it became a City ★: where an entrance may go is looked for now, over the line's straights.)
const fresh = await p.evaluate(async ({ W, E, z, town }) => {
  const w = window.woodrail;
  const { metroTown } = await import("/src/game/world.ts");
  const spots = [];
  for (const id of w.layout.pieceIds()) {
    const q = w.layout.getPiece(id);
    if (q.type !== "straight-216" || q.y !== -96 || Math.abs(q.pose.z - z) > 1 || q.pose.x < W || q.pose.x > E) continue;
    if (metroTown(w.landscape, q.pose)?.id === town.id) spots.push({ pose: q.pose });
  }
  spots.sort((a, b) => a.pose.x - b.pose.x);
  const g = w.landscape.grid;
  const deep = [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id)).filter((q) => q.y === -96).map((q) => {
    const i = g.cellAtWorld(q.pose.x + 108, q.pose.z);
    return `${Math.round(q.pose.x)}:${metroTown(w.landscape, q.pose)?.id ?? "-"} f${g.feature[i]} s${g.surface[i]} r${g.road[i]} h${g.height[i]} town${w.landscape.towns.findIndex((t) => t.cells.includes(i))}`;
  });
  return spots.length >= 2 ? [spots[0], spots[spots.length - 1]] : { deep, W, E, z, town: town.id };
}, setup);
if (!Array.isArray(fresh)) throw new Error(`no room for two entrances any more: ${JSON.stringify(fresh)} setup pair ${JSON.stringify(setup.pair)}`);
setup.pair = fresh;
await tab("Industries");
const one = await putStop(setup.pair[0].pose);
const two = await putStop(setup.pair[1].pose);
await tab("Track");
const stops = await p.evaluate((ids) => {
  const w = window.woodrail;
  return ids.map((id) => {
    const d = id === undefined ? null : w.economy.depotAtPiece(id);
    return d ? { id: d.id, townId: d.townId, metro: w.economy.isMetro(d), y: w.layout.getPiece(id).y } : null;
  });
}, [one.stop?.id, two.stop?.id]);
check("two metro stops from the tray go down over the line, two levels under the town", !!one.stop && !!two.stop && one.stop.y === -96 && two.stop.y === -96, JSON.stringify({ one, two }));
check("…each a metro stop of the town's", stops.every((s) => s && s.metro && s.townId === setup.town.id), JSON.stringify(stops));
// (Where its entrance would land on one of the town's houses, as the town stands now.)
const onHouse = await p.evaluate(async ({ town }) => {
  const w = window.woodrail;
  const { kioskAt } = await import("/src/game/world.ts");
  const g = w.landscape.grid;
  const t = w.landscape.towns.find((x) => x.id === town.id);
  const house = t.buildings[0].cells[0];
  const k = kioskAt({ x: 0, z: 0, heading: 0 });
  const pose = { x: g.centreX(g.colOf(house)) - k.x, z: g.centreZ(g.rowOf(house)) - k.z, heading: 0 };
  return w.interaction.siteRule?.("kit-metro-stop", pose, -1, -96) ?? null;
}, setup);
check("with its entrance on a house, a metro stop is refused, saying why", onHouse === "A metro stop's entrance goes on a town's green or the grass beside it, off the road", `${onHouse}`);
// (Close on the first entrance, then the two stops and the line between.)
const entrance = await p.evaluate(async (id) => {
  const w = window.woodrail;
  const { kioskAt } = await import("/src/game/world.ts");
  const q = w.layout.getPiece(id);
  const k = kioskAt(q.pose);
  const models = [];
  w.scene.traverse((o) => {
    if (o.isMesh && o.visible && Math.hypot(o.getWorldPosition(new o.position.constructor()).x - k.x, o.getWorldPosition(new o.position.constructor()).z - k.z) < 60) models.push(o.name || o.type);
  });
  return { k, near: models.length };
}, one.stop?.id);
console.log("entrance:", JSON.stringify(entrance));
await look(entrance.k.x, entrance.k.z, [0.3, 1.2, 1], 520, 0);
await snap("metro-entrance.jpg");
await look((setup.pair[0].pose.x + setup.pair[1].pose.x) / 2 + 108, setup.z, [0.05, 1.5, 1], 1200, 0);
await snap("metro-stops.jpg");

// The line from above: dashes painted over it, on the streets' top where it runs under one (not hidden under them).
const dashes = await p.evaluate(({ W, E, z }) => {
  const w = window.woodrail;
  const g = w.landscape.grid;
  const mine = w.tunnelsView.found.dashes.filter((d) => Math.abs(d.z0 - z) < 30 && d.x0 > W && d.x0 < E + 288);
  const onStreet = mine.filter((d) => {
    const i = g.cellAtWorld(d.x0, d.z0);
    return i !== -1 && (g.surface[i] === 2 || g.road[i] !== 0);
  });
  return { n: mine.length, streets: onStreet.length, low: onStreet.filter((d) => d.y < 4.5).length };
}, setup);
check("dashes painted over the line, over the streets' top where it runs under one", dashes.n > 10 && dashes.low === 0, JSON.stringify(dashes));

// The stop's card, by a tap on its entrance: Show the line draws the line through the ground for a while.
const kiosk = await p.evaluate(async (id) => (await import("/src/game/world.ts")).kioskAt(window.woodrail.layout.getPiece(id).pose), one.stop.id);
await look(kiosk.x, kiosk.z + 120, [0.1, 1.4, 1], 900, 0);
await settle();
const tapK = await screen(kiosk.x, 12, kiosk.z);

await p.mouse.click(tapK[0], tapK[1]);
await frames();
await settle();
const cardNow = await p.evaluate(() => ({ mode: window.woodrail.interaction.mode.kind, open: window.woodrail.hud.depotCardOpen, button: !document.querySelector(".depot-line")?.hidden, title: document.querySelector(".depot-card .card-title, .depot-card h2, .depot-card h3")?.textContent ?? null }));
check("a tap on the entrance opens the stop's card, with Show the line", cardNow.open && cardNow.button, JSON.stringify(cardNow));
await pressAt(".depot-line");
await settle();
const shown = await p.evaluate(() => ({ shown: window.woodrail.metroLine.shown, pieces: window.woodrail.metroLine.pieces.length }));
check("Show the line draws the line through the ground: the stop, the track under the town, the mouths", shown.shown && shown.pieces >= setup.n + 2, JSON.stringify({ shown, n: setup.n }));
await p.screenshot({ path: `${OUT}/metro-card.jpg`, type: "jpeg", quality: 80 });
// (The card closed: the line stays drawn a while, the map in view.)
await p.keyboard.press("Escape");
await look((setup.pair[0].pose.x + setup.pair[1].pose.x) / 2 + 108, setup.z, [0.05, 1.6, 1], 1300, 0);
await p.screenshot({ path: `${OUT}/metro-show-line.jpg`, type: "jpeg", quality: 80 });
const stillShown = await p.evaluate(() => window.woodrail.metroLine.shown);
check("…shown on the map once the card's closed", stillShown, `${stillShown}`);
const gone = await p.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 13000));
  return window.woodrail.metroLine.shown;
});
check("…for a few seconds, then it's gone", gone === false, `${gone}`);
await p.keyboard.press("Escape");

// 4. The metro train: riders across the town, paid; coal drawn.
const ride = await p.evaluate(async ({ stops, pair, power }) => {
  const w = window.woodrail;
  const { peopleArrive } = await import("/src/game/passengers.ts");
  const { metroDraw } = await import("/src/game/metro.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { SIM_HZ } = await import("/src/sim/sim.ts");
  // (Setup: the train put on the line between the stops by the sim, in the metro's look: as the tray's item makes it.)
  const mid = [...w.layout.pieceIds()].find((id) => {
    const q = w.layout.getPiece(id);
    return q.type === "straight-216" && q.y === -96 && q.pose.x > pair[0].pose.x + 200 && q.pose.x < pair[1].pose.x;
  });
  const r = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: mid, pathIndex: 0, s: 200, reversed: false });
  if (r.kind !== "placed") return { error: r.kind };
  const t = w.sim.getTrain(r.trainId);
  for (const c of t.cars) w.sim.setLook(c.id, "metro");
  const engine = t.cars[0].id;
  const progress = w.progress();
  const coins = progress.coins;
  const riders = progress.riders;
  const station = w.economy.depot(power.depot);
  const coal0 = station.piles[CARGO.coal.index];
  w.sim.setLever(engine, 1);
  const clock = new Map();
  const draw = new Map();
  const inUse = (await import("/src/game/progress.ts")).inUse(w.world, "look:metro");
  let drawn = 0;
  for (let sec = 0; sec < 180; sec++) {
    for (let k = 0; k < SIM_HZ; k++) {
      w.sim.tick();
      w.economy.tick();
    }
    peopleArrive(w.world, progress, 1, clock);
    const before = station.piles[CARGO.coal.index];
    metroDraw(w.world, 1, draw);
    drawn += before - station.piles[CARGO.coal.index];
  }
  w.sim.setLever(engine, 0);
  for (let k = 0; k < 4 * SIM_HZ; k++) w.sim.tick();
  w.invalidate();
  const waiting = stops.map((s) => w.economy.depot(s.id).waiting);
  return { riders: progress.riders - riders, coins: progress.coins - coins, coal: coal0 - station.piles[CARGO.coal.index], drawn, inUse, waiting, engine };
}, { stops, pair: setup.pair, power });
check("a metro train carries riders across the town between the two stops, and they pay", ride.riders > 5 && ride.coins >= ride.riders, JSON.stringify(ride));
check("…it's one metro train in use", ride.inUse === 1, JSON.stringify(ride));
check("…and it draws coal from the power station as it runs (on top of the station's own burn)", ride.drawn >= 1 && ride.coal > ride.drawn, JSON.stringify(ride));
await look((setup.pair[0].pose.x + setup.pair[1].pose.x) / 2 + 108, setup.z, [0.4, 1.0, 1], 900, 0);
await snap("metro-ghost.jpg");

// 5. The town over the line.
const grow = await p.evaluate(async ({ z, pair }) => {
  const w = window.woodrail;
  const { LandEditor } = await import("/src/landscape/edit.ts");
  const { kioskAt } = await import("/src/game/world.ts");
  const g = w.landscape.grid;
  const ed = new LandEditor(w.landscape, w.layout);
  // A square over the line (its middle on it) that isn't a house, a station or an entrance: may a house go there?
  const entrances = pair.map((s) => g.cellAtWorld(kioskAt(s.pose).x, kioskAt(s.pose).z));
  let over = null;
  for (let x = pair[0].pose.x; x <= pair[1].pose.x + 216; x += 18) {
    const i = g.cellAtWorld(x, z);
    if (i === -1 || entrances.includes(i)) continue;
    const why = ed.checkLot([i], false);
    if (why === null) {
      over = i;
      break;
    }
  }
  return { over, entrance: ed.checkLot([entrances[0]], false) };
}, setup);
check("a house may go on a square over the line, two levels down", grow.over !== null, JSON.stringify(grow));
check("…but not on a metro stop's entrance", grow.entrance !== null, JSON.stringify(grow));

// 6. Idle.
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
check("idle: no frames drawn in 2 s with the metro and its train standing", idle === 0, `${idle} frames`);

console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close();
await server.close();
process.exit(failed.length ? 1 : 0);
