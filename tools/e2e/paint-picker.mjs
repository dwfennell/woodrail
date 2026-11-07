// End-to-end your own colours at the paint shop in Game mode (`npm run e2e:paint-picker [-- <out dir>]`), on a phone at
// 390×844 with touch (late-game spec, paint: the user's ask of 2026-11-05):
//  1. A Town (deliveries written as trains would bring them: a setup shortcut, as e2e:civic), the Dye works learned, a
//     train of an engine, a coach and a hopper.
//  2. The paint shop has only its ready-made liveries; Paint your trains is a blueprint after the Dye works.
//  3. Learned (research isn't what's tested): the workshop asks trains for paint and its card lists it; the sheet has
//     a grid of colours, and Paint says it needs 3 paint for the engine and its 2 wagons.
//  4. Paint at the workshop (its delivery by train is unit tested: a setup shortcut here). Body and Trim picked by
//     taps; Paint all 3: each car painted and built again in those colours, 3 pots taken.
//  5. 0 frames drawn idle; after a reload the train is still painted. No errors on the page.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/paint-picker";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5402, strictPort: false }, logLevel: "error" });
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
    // (Scrolled only when not in view: a scroll under a late click would land it elsewhere.)
    el.scrollIntoView({ block: "nearest" });
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
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
};


await p.goto(PAGE);
await openGame();

// ---- 1. A Town (the paint shop opens), the Dye works learned; a train of an engine and two wagons ---------------------
for (let level = 1; level <= 2; level++) {
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
await p.evaluate(() => document.querySelector(".growth-sheet:not([hidden]) .close")?.click());
await p.evaluate(() => {
  const w = window.woodrail;
  for (const id of ["farming", "paint"]) w.learn(id);
});
await p.waitForTimeout(800);
await p.keyboard.press("Escape");
// (A line with a workshop on it, laid on open ground, and the train put on it: setup, not what's tested.)
const train = await p.evaluate(async () => {
  const w = window.woodrail;
  // (Beside the station's line, at its level: the ground there is flat.)
  const st = w.world.layout.getPiece(w.world.stations.get(w.world.landscape.towns[0].id)).pose;
  const c = Math.cos(st.heading);
  const sn = Math.sin(st.heading);
  const along = (k) => ({ x: st.x + c * 216 * (k - 3) - sn * 300, z: st.z + sn * 216 * (k - 3) + c * 300, heading: st.heading, y: st.y ?? 0 });
  const line = [0, 1, 2, 3, 4, 5].map((k) => w.world.layout.addPiece("straight-216", along(k)));
  w.world.layout.addPiece("depot-workshop", along(6));
  w.world.layout.addPiece("straight-216", along(7));
  w.invalidate();
  await new Promise((r) => setTimeout(r, 1500));
  const placed = w.sim.addTrain(["engine", "passenger", "hopper"], { pieceId: line[5], pathIndex: 0, reversed: false, s: 150 });
  return placed.kind === "placed" ? w.sim.getTrain(placed.trainId).cars.map((c) => c.id) : null;
});
check("1. setup: a train of an engine, a coach and a hopper", !!train && train.length === 3, JSON.stringify(train));
const [engine] = train ?? [-1];

const openSheet = async () => {
  await p.evaluate((id) => window.woodrail.interaction.openEngineCard(id), engine);
  await p.waitForTimeout(800);
  // (A tap on a button that moved under the finger a moment ago is ignored by the card, as for a person: tap again.)
  for (let k = 0; k < 3 && (await p.evaluate(() => document.querySelector(".paint-sheet")?.hidden !== false)); k++) {
    await p.waitForTimeout(600);
    await tap(".paint-engine");
  }
  return p.evaluate(() => !document.querySelector(".paint-sheet")?.hidden);
};
const closeSheet = () =>
  p.evaluate(() => {
    document.querySelector(".paint-sheet .close")?.click();
    document.querySelector(".engine-card > .close")?.click();
  });

// ---- 2. Before Paint your trains: the ready-made liveries only; Paint your trains is on the research board ------------
check("2. the paint shop opens", await openSheet());
check("2. no own colours yet", (await p.evaluate(() => document.querySelectorAll(".paint-colour").length)) === 0);
await closeSheet();
const row = await p.evaluate(async () => {
  const { BLUEPRINTS } = await import("/src/game/blueprints.ts");
  const b = BLUEPRINTS.find((x) => x.id === "paint-trains");
  return { plan: b?.plan ?? null, needs: b?.needs };
});
check("2. Paint your trains is a blueprint after the Dye works (not a plan for later)", row.plan === null && JSON.stringify(row.needs) === '["paint"]', JSON.stringify(row));

// ---- 3. Learned (research isn't what's tested): the workshop takes paint, the sheet has the grid ----------------------
await p.evaluate(() => window.woodrail.learn("paint-trains"));
await p.waitForTimeout(800);
await p.keyboard.press("Escape");
const shop = await p.evaluate(async () => {
  const w = window.woodrail;
  const d = w.world.economy.allDepots().find((x) => x.role === "workshop" && w.world.layout.getPiece(x.pieceId));
  return d ? { id: d.id, owes: w.world.economy.owes?.("paint") ?? 0 } : null;
});
check("3. the workshop asks trains for 6 paint", shop?.owes === 6, JSON.stringify(shop));
if (shop) {
  await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), shop.id);
  await p.waitForTimeout(800);
  const card = await p.evaluate(() => document.querySelector(".depot-card:not([hidden])")?.textContent ?? "");
  check("3. its card lists Paint", /Paint/.test(card), card.slice(0, 160));
  await p.keyboard.press("Escape");
  await p.evaluate(() => window.woodrail.hud.closeCards?.());
}
check("3. the sheet has your own colours", (await openSheet()) && (await p.evaluate(() => document.querySelectorAll(".paint-colour").length)) >= 20);
const noPaint = await p.evaluate(() => ({ go: document.querySelector(".paint-own-go")?.textContent, off: document.querySelector(".paint-own-go")?.disabled, wagons: document.querySelector(".paint-wagons")?.textContent }));
check("3. with no paint at the workshop, Paint says what it needs", noPaint.off === true && /Needs 3 🎨 paint/.test(noPaint.go ?? ""), JSON.stringify(noPaint));
check("3. …for the engine and its 2 wagons", /And its 2 wagons/.test(noPaint.wagons ?? ""), JSON.stringify(noPaint));
await closeSheet();

// ---- 4. Paint at the workshop (by train in the unit tests, game/paint-own.test.ts: a setup shortcut here), colours chosen by taps, painted
await p.evaluate(async (d) => {
  const { CARGO } = await import("/src/economy/cargo.ts");
  window.woodrail.world.economy.allDepots().find((x) => x.id === d).piles[CARGO.paint.index] = 5;
}, shop?.id ?? -1);
check("4. the sheet again", await openSheet());
/**
 * Tap until `done` holds (a few tries): on a loaded machine a tap's click can come late, after the next tap's press,
 * and the click shield (ui/click-shield.ts) rightly drops it, as it would a person's.
 */
const tapUntil = async (selector, done) => {
  for (let k = 0; k < 4; k++) {
    await tap(selector);
    if (await p.evaluate(done)) return true;
    await p.waitForTimeout(800);
  }
  return false;
};
const part = (want) => `document.querySelector(".paint-part.on")?.dataset.part === "${want}"`;
const picked = (want) => `document.querySelector(".paint-colour.chosen")?.dataset.colour === "${want}"`;
const looks = () => p.evaluate(() => document.querySelector(".paint-own-look")?.style.background ?? "");
const pick = async () => [
  await tapUntil('.paint-part[data-part="body"]', part("body")),
  await tapUntil('.paint-colour[data-colour="#1f5aa6"]', picked("#1f5aa6")),
  await tapUntil('.paint-part[data-part="trim"]', part("trim")),
  await tapUntil('.paint-colour[data-colour="#f3d27a"]', picked("#f3d27a")),
];
let taps = await pick();
// (A stray late click on a loaded machine can set a colour twice: then picked again, as a person would.)
for (let k = 0; k < 2 && !/rgb\(31, 90, 166\) 0px.*rgb\(243, 210, 122\) 62%/.test(await looks()); k++) {
  console.log(`(picked again: ${await looks()})`);
  taps = await pick();
}
check("4. each tap on Body, a colour, Trim, a colour takes", taps.every(Boolean), JSON.stringify(taps));
const ready = await p.evaluate(() => ({ go: document.querySelector(".paint-own-go")?.textContent, off: document.querySelector(".paint-own-go")?.disabled, look: document.querySelector(".paint-own-look")?.style.background }));
check("4. Body blue, Trim gold; Paint all 3 for 3 paint", ready.off === false && /Paint all 3 · 3 🎨 paint/.test(ready.go ?? ""), JSON.stringify(ready));
await shot("1-own-colours");
const sheetFits = await p.evaluate(() => {
  const panel = document.querySelector(".paint-panel");
  const r = panel.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, h: innerHeight, scrolls: panel.scrollHeight > panel.clientHeight + 1, at: panel.scrollTop };
});
check("4. the sheet fits the phone, scrolling inside (its top and ✕ in reach)", sheetFits.top >= 0 && sheetFits.bottom <= sheetFits.h + 1, JSON.stringify(sheetFits));
await tap(".paint-own-go");
await p.waitForTimeout(800);
const after = { liveries: await p.evaluate((cars) => cars.map((c) => window.woodrail.sim.liveryOf(c)), train) };
const pots = await p.evaluate(async (d) => {
  const { CARGO } = await import("/src/economy/cargo.ts");
  return window.woodrail.world.economy.allDepots().find((x) => x.id === d)?.piles[CARGO.paint.index];
}, shop?.id ?? -1);
check("4. the engine and both wagons painted blue and gold", after.liveries.every((l) => l === "custom:1f5aa6:f3d27a"), JSON.stringify(after.liveries));
check("4. 3 pots of paint taken from the workshop (2 left)", pots === 2, String(pots));
const built = await p.evaluate(async (cars) => {
  const w = window.woodrail;
  await Promise.race([w.settled(2), new Promise((r) => setTimeout(r, 8000))]);
  const seen = {};
  w.scene.traverse((o) => {
    const id = o.userData?.carId;
    if (cars.includes(id) && o.material?.color) {
      const hex = o.material.color.getHexString();
      if (hex === "1f5aa6" || hex === "f3d27a") (seen[id] ??= new Set()).add(hex);
    }
  });
  return cars.map((c) => [...(seen[c] ?? [])].sort().join("+"));
}, train);
check("4. each car is built again in blue and gold (the payoff)", built.every((s) => s === "1f5aa6+f3d27a"), JSON.stringify(built));
await closeSheet();
await p.evaluate(async (id) => {
  const w = window.woodrail;
  // (From above and a little to the side, the whole train in the picture: its middle car where it stands.)
  const f = w.sim.findCar(id);
  const mid = f.train.cars[Math.floor(f.train.cars.length / 2)].id;
  const V = w.camera.position.constructor;
  const at = new V();
  w.scene.traverse((o) => {
    if (o.userData?.carId === mid && o.parent && o.parent.userData?.carId !== mid) o.getWorldPosition(at);
  });
  w.lookAt(at, 650, 0.75, 0.5);
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
}, engine);
await p.waitForTimeout(1500);
await shot("2-painted-train");

// ---- 5. Idle, then a reload: still painted ----------------------------------------------------------------------------
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 3000));
  return w.framesDrawn - n0;
});
check("5. 0 frames drawn idle", idle === 0, `${idle} frames`);
await p.waitForTimeout(3000); // (saved)
await p.reload();
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
const back = await p.evaluate((cars) => cars.map((c) => window.woodrail.sim.liveryOf(c)), train);
check("5. after a reload, the train is still blue and gold", back.every((l) => l === "custom:1f5aa6:f3d27a"), JSON.stringify(back));
check("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(`${checks - failures}/${checks} passed`);
await b.close();
await server.close();
process.exit(failures > 0 ? 1 : 0);
