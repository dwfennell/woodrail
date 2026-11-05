// End-to-end town places, treats and the paint shop in Game mode (`npm run e2e:civic [-- <out dir>]`), on a phone at
// 390×844 with touch (spec 2026-11-04-civic-leisure-design.md):
//  1. Larkfield a City (deliveries written as trains would bring them: a setup shortcut, as e2e:town-shape), Town hall
//     and Park learned (research isn't what's tested). Its card has Places, with only a town hall to build.
//  2. A tap on Build: its coins paid, the card says its goods come by train. Trains bring the planks to the station
//     (wagons of planks standing at its crane): the town hall goes up (a building of the town's, the News says so),
//     and the card offers the Park.
//  3. The Park the same way: then the town has 1 😊 and needs fewer planks to grow (the payoff), and the card says so.
//  4. Treats: a Fountain bought from the card, standing in the town, coins taken.
//  5. The paint shop: 🎨 on an engine's card, Red chosen and painted, coins taken, the engine built again in red.
//  6. A reload: the places, the smile and the paint are all still there. No errors on the page, 0 frames idle.
//
// Usage: npm run e2e:civic [-- <out dir>]   (default out: e2e-out/civic)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/civic";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5398, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks held still: this counts idle frames, and a clock in view draws one at each minute.)
pinClocksIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
let checks = 0;
const check = (what, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

/** Tap the middle of the first visible element matching `selector` (scrolled into view first). */
const tap = async (selector) => {
  const at = await p.evaluate((selector) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!at) return false;
  await p.waitForTimeout(250);
  // (Scrolled: its place again.)
  const again = await p.evaluate((selector) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await p.touchscreen.tap(again.x, again.y);
  await p.waitForTimeout(600);
  return true;
};

const openGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
};

await p.goto(PAGE);
await openGame();

// ---- 1. Larkfield a City; Town hall and Park learned ----------------------------------------------------------------
for (let level = 1; level <= 3; level++) {
  await p.evaluate(async (level) => {
    const { townLevel } = await import("/src/game/towns.ts");
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    const bag = {};
    for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n;
    w.economy.delivered.set(t.id, bag.planks ?? 0);
    w.economy.deliveredGoods.set(t.id, bag);
    w.invalidate();
  }, level);
  await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 30000 }).catch(() => console.log(`(level ${level} not seen)`));
  await p.waitForTimeout(1000);
  await p.evaluate(() => document.querySelector(".growth-sheet:not([hidden]) .close")?.click());
}
await p.evaluate(() => {
  const w = window.woodrail;
  w.learn("town-hall");
  w.learn("park");
  const pr = w.progress();
  pr.coins = 600;
  w.hud.setCoins(pr.coins);
});
await p.waitForTimeout(800);
await p.keyboard.press("Escape");
const town = await p.evaluate(() => {
  const w = window.woodrail;
  const t = w.world.landscape.towns[0];
  return { id: t.id, name: t.name, station: w.world.stations.get(t.id), depot: w.world.economy.depotAtPiece(w.world.stations.get(t.id)).id };
});
const openCard = () => p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), town.depot);
await openCard();
await p.waitForTimeout(800);
const tiles = () => p.evaluate(() => [...document.querySelectorAll(".places-sec:not(.treats) .place-tile")].map((t) => `${t.dataset.place}:${[...t.classList].find((c) => c !== "place-tile")}`));
check("1. the City's card has Places, with only a town hall to build", JSON.stringify(await tiles()) === JSON.stringify(["town-hall:build"]), JSON.stringify(await tiles()));
check("1. its line says a town hall comes first", (await p.evaluate(() => document.querySelector(".places-sub")?.textContent ?? "")).includes("town hall"));
const buildLabel = await p.evaluate(() => document.querySelector('.place-btn[data-place="town-hall"]')?.textContent ?? "");
check("1. the Build button says its coins and goods", /Build · 60 🪙 \+\s*12/.test(buildLabel), buildLabel);
await shot("1-places-card");

/**
 * Bring `n` planks to Larkfield's station by train: a train of wagons of planks driven in along a short line laid behind
 * the station (laid once, as the unit tests' `deliverByTrain` lays it: setup), which halts there and is unloaded by
 * the station's crane, then put back in the box. The game's own sim and economy, ticked here with the game paused (as
 * e2e:big-stations does: SwiftShader draws too few frames to run them in real time).
 */
const bringPlanks = async (n) => {
  const r = await p.evaluate(async ({ station, n }) => {
    const w = window.woodrail;
    const at = w.layout.getPiece(station).pose;
    const c = Math.cos(at.heading);
    const s = Math.sin(at.heading);
    const along = (k) => ({ x: at.x + c * 216 * k, z: at.z + s * 216 * k, heading: at.heading });
    if (window.__approach === undefined) {
      const before = [-6, -5, -4, -3, -2, -1].map((k) => w.layout.addPiece("straight-216", along(k)));
      window.__approach = before[before.length - 4];
      w.trackChanged();
    }
    const wagons = Math.ceil(n / 3);
    const placed = w.sim.addTrain(["engine", ...Array(wagons).fill("timber")], { pieceId: window.__approach, pathIndex: 0, reversed: false, s: 150 });
    if (placed.kind !== "placed") return { brought: 0, why: placed.kind };
    const train = w.sim.getTrain(placed.trainId);
    const cars = train.cars.map((x) => x.id);
    let left = n;
    for (const car of train.cars.slice(1)) {
      const k = Math.min(3, left);
      w.economy.setCargo(car.id, "planks", k);
      left -= k;
    }
    w.sim.setLever(train.cars[0].id, 1);
    const onBoard = () => cars.reduce((m, id) => m + (w.economy.cargoOf(id).kind === "planks" ? w.economy.cargoOf(id).count : 0), 0);
    w.paused = true;
    for (let k = 0; k < 120 * 240 && onBoard() > 0; k++) {
      w.sim.tick();
      w.economy.tick();
    }
    w.paused = false;
    const brought = n - onBoard();
    for (const id of new Set(cars.map((x) => w.sim.findCar(x)?.train.id))) if (id !== undefined) w.sim.removeTrain(id);
    return { brought };
  }, { station: town.station, n });
  // The place goes up on the next frame the game draws (slow under load): wait for the plan to be done with.
  await p.waitForFunction((id) => !window.woodrail.world.economy.placePlans.has(id), town.id, { timeout: 30000 }).catch(() => console.log("(the place under way didn't go up within 30 s)"));
  await p.waitForTimeout(500);
  return r;
};

// ---- 2. Build the town hall: coins, then its planks by train -------------------------------------------------------
const coins0 = await p.evaluate(() => window.woodrail.progress().coins);
await tap('.place-btn[data-place="town-hall"]');
const plan = await p.evaluate((id) => window.woodrail.world.economy.placePlans.get(id) ?? null, town.id);
check("2. Build: the town hall is under way", plan?.id === "town-hall", JSON.stringify(plan));
check("2. its 60 coins paid", (await p.evaluate(() => window.woodrail.progress().coins)) === coins0 - 60);
check("2. the card says its goods come by train", (await p.evaluate(() => document.querySelector(".place-plan")?.textContent ?? "")).includes("goods coming by train"));
await shot("2-under-way");
const growthBefore = await p.evaluate(async (id) => {
  const { growthOf } = await import("/src/game/town-life.ts");
  return growthOf(window.woodrail.world, id);
}, town.id);
const brought = await bringPlanks(12);
check("2. trains brought 12 planks to the station", brought.brought === 12, JSON.stringify(brought));
const after = await p.evaluate(async (id) => {
  const { townPlaces } = await import("/src/game/places.ts");
  const { growthOf } = await import("/src/game/town-life.ts");
  const w = window.woodrail;
  const t = w.world.landscape.towns.find((x) => x.id === id);
  return { places: [...townPlaces(t)], plan: w.world.economy.placePlans.has(id), growth: growthOf(w.world, id), news: (w.journal.toJSON().entries ?? []).map((e) => e.text).slice(0, 6) };
}, town.id);
check("2. the town hall stands in Larkfield", after.places.includes("town-hall") && !after.plan, JSON.stringify(after.places));
check("2. its planks went into it, not toward growth", JSON.stringify(after.growth) === JSON.stringify(growthBefore), `${JSON.stringify(growthBefore)} → ${JSON.stringify(after.growth)}`);
check("2. the News says so", after.news.some((t) => /new town hall/.test(t)), JSON.stringify(after.news));
await openCard();
await p.waitForTimeout(800);
check("2. now the card offers the Park", (await tiles()).includes("park:build"), JSON.stringify(await tiles()));

// ---- 3. The Park: a smile, and the town needs fewer goods ----------------------------------------------------------
const wantsBefore = await p.evaluate(async (id) => {
  const { statusOf } = await import("/src/game/town-life.ts");
  return statusOf(window.woodrail.world, id).wants;
}, town.id);
await tap('.place-btn[data-place="park"]');
await bringPlanks(8);
const park = await p.evaluate(async (id) => {
  const { townSmiles, townPlaces } = await import("/src/game/places.ts");
  const { statusOf } = await import("/src/game/town-life.ts");
  const w = window.woodrail;
  const t = w.world.landscape.towns.find((x) => x.id === id);
  return { smiles: townSmiles(t), park: townPlaces(t).has("park"), wants: statusOf(w.world, id).wants };
}, town.id);
check("3. the park stands, +1 😊", park.park && park.smiles === 1, JSON.stringify(park));
check("3. the payoff: the town needs fewer planks to grow", (park.wants.planks ?? 0) < (wantsBefore.planks ?? 0), `${wantsBefore.planks} → ${park.wants.planks}`);
await openCard();
await p.waitForTimeout(800);
check("3. the card says 1 smile, 5% fewer goods", (await p.evaluate(() => document.querySelector(".places-sub")?.textContent ?? "")).includes("5% fewer"));
await p.evaluate(() => document.querySelector(".places-sec")?.scrollIntoView({ block: "start" }));
await p.waitForTimeout(400);
await shot("3-places-with-park");

// ---- 4. Treats: a fountain -------------------------------------------------------------------------------------------
const coins4 = await p.evaluate(() => window.woodrail.progress().coins);
check("4. the Treats row is on sale (a City on the map)", (await p.evaluate(() => !!document.querySelector('.places-sec.treats .place-btn[data-place="fountain"]'))) === true);
await tap('.places-sec.treats .place-btn[data-place="fountain"]');
const fountain = await p.evaluate(async (id) => {
  const { townPlaces } = await import("/src/game/places.ts");
  const w = window.woodrail;
  return { has: townPlaces(w.world.landscape.towns.find((x) => x.id === id)).has("fountain"), coins: w.progress().coins, prop: [...w.world.props.all()].some((q) => q.asset === "scene-fountain" && q.town === id) };
}, town.id);
check("4. the fountain stands in Larkfield, drawn", fountain.has && fountain.prop, JSON.stringify(fountain));
check("4. 100 coins paid", fountain.coins === coins4 - 100, `${coins4} → ${fountain.coins}`);
await openCard();
await p.waitForTimeout(800);
await p.evaluate(() => document.querySelector(".places-sec.treats")?.scrollIntoView({ block: "start" }));
await p.waitForTimeout(400);
await shot("4-treats");
await p.keyboard.press("Escape");
await p.evaluate(() => window.woodrail.hud.closeCards?.());
await p.waitForTimeout(500);

// ---- 5. The paint shop -----------------------------------------------------------------------------------------------
const engine = await p.evaluate(() => {
  const w = window.woodrail;
  const station = w.world.stations.get(w.world.landscape.towns[0].id);
  const placed = w.sim.addTrain(["engine"], { pieceId: station, pathIndex: 0, reversed: false, s: 60 });
  if (placed.kind !== "placed") return null;
  const id = w.sim.getTrain(placed.trainId).cars[0].id;
  w.interaction.openEngineCard(id);
  return id;
});
await p.waitForTimeout(800);
check("5. 🎨 Paint on the engine's card", (await p.evaluate(() => !document.querySelector(".paint-engine")?.hidden)) === true);
// (A tap on a button that moved under the finger a moment ago is ignored by the card, as for a person: tap again.)
for (let k = 0; k < 3 && (await p.evaluate(() => document.querySelector(".paint-sheet")?.hidden !== false)); k++) {
  await p.waitForTimeout(600);
  await tap(".paint-engine");
}
check("5. the paint shop opens", (await p.evaluate(() => !document.querySelector(".paint-sheet")?.hidden)) === true);
check("5. City colours open, City ★ ones locked", (await p.evaluate(() => [...document.querySelectorAll(".paint-swatch")].map((s) => `${s.dataset.livery}:${s.classList.contains("locked")}`).join(","))).includes("plum:false,black:false,lining:false,gold:true"));
await tap('.paint-swatch[data-livery="red"]');
await shot("5-paint-shop");
const coins5 = await p.evaluate(() => window.woodrail.progress().coins);
await tap(".paint-go");
await p.waitForTimeout(800);
const painted = await p.evaluate((id) => ({ livery: window.woodrail.sim.liveryOf(id), coins: window.woodrail.progress().coins }), engine);
check("5. painted red, 60 coins paid", painted.livery === "red" && painted.coins === coins5 - 60, JSON.stringify(painted));
const red = await p.evaluate(async (id) => {
  const w = window.woodrail;
  await Promise.race([w.settled(2), new Promise((r) => setTimeout(r, 8000))]);
  let found = false;
  w.scene.traverse((o) => {
    if (o.userData?.carId === id && o.material?.color && o.material.color.getHexString() === "c8442f") found = true;
  });
  return found;
}, engine);
check("5. the engine is built again in red", red);
await p.evaluate(() => document.querySelector(".paint-sheet .close")?.click());
await p.evaluate(() => document.querySelector(".engine-card > .close")?.click());
// The town's new places, from close by: the park's bandstand in the middle of the picture.
await p.evaluate(async (id) => {
  const w = window.woodrail;
  const V = w.camera.position.constructor;
  const park = [...w.world.props.all()].find((q) => q.town === id && q.asset === "scene-bandstand");
  const t = w.world.landscape.towns.find((x) => x.id === id);
  w.lookAt(new V(park?.x ?? t.centre.x, 0, park?.z ?? t.centre.z), 900, 0.85);
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
}, town.id);
await p.waitForTimeout(1500);
await shot("5-town");

// ---- 6. Idle frames, then a reload -----------------------------------------------------------------------------------
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  w.sim.trainIds().forEach((id) => w.sim.setLever(w.sim.getTrain(id).cars.find((c) => c.kind === "engine")?.id ?? -1, 0));
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 3000));
  return w.framesDrawn - n0;
});
check("6. 0 frames drawn idle with the places in view", idle === 0, `${idle} frames`);
await p.waitForTimeout(3000); // (saved)
await p.reload();
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
const back = await p.evaluate(async ({ id, engine }) => {
  const { townPlaces, townSmiles } = await import("/src/game/places.ts");
  const w = window.woodrail;
  const t = w.world.landscape.towns.find((x) => x.id === id);
  return { places: [...townPlaces(t)].sort(), smiles: townSmiles(t), livery: w.sim.liveryOf(engine) };
}, { id: town.id, engine });
check("6. after a reload: the town hall, park and fountain, 1 😊, and the red engine", JSON.stringify(back.places) === JSON.stringify(["fountain", "park", "town-hall"]) && back.smiles === 1 && back.livery === "red", JSON.stringify(back));
check("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(`${checks - failures}/${checks} passed`);
await b.close();
await server.close();
process.exit(failures > 0 ? 1 : 0);
