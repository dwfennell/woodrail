// End-to-end: a routed train says why it won't load at its next stop (`Economy.notLoadingAt`, the engine card's status),
// on a 390×844 phone in Sandbox. The user, 2026-11-06: a train on a sawmill → workshop line passed the sawmill empty,
// "On its way to the sawmill 1", with nothing said. An oval with a sawmill and a workshop; a flatbed train on the line
// sawmill, workshop; the workshop full of planks. A tap on the train: its card says "Not loading planks at the sawmill:
// the workshop is full". The payoff: run on, it passes the sawmill with no plank; the workshop given room, the note goes
// and the train loads planks there. 0 frames drawn while it all stands still.
//
// Setup, not what's tested (named harness shortcuts): the oval, the places, the train and its line put down in code
// (planning a line by taps is e2e:touch's route groups); the workshop's yard filled and emptied in code (a workshop
// using planks up is the economy's own tests); the sim and economy ticked ahead of SwiftShader's frames.
//
// Usage: npm run e2e:not-loading [-- <out dir>]   (default out: e2e-out/not-loading)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/not-loading";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.favourites", "[]");
});
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

await p.goto(PAGE);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 60000 });
await p.evaluate(() => {
  const help = document.querySelector(".help");
  if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
  document.querySelector(".coach:not([hidden]) .coach-skip")?.click();
});
await settle();

// The oval: the sawmill and the workshop across it, a flatbed train on its far side, on the line sawmill, workshop;
// the workshop full. (Setup: see the top.)
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  const { Layout } = await import("/src/track/index.ts");
  const S = await import("/src/routing/scenarios.ts");
  const L = await import("/src/game/lines.ts");
  const { capAt } = await import("/src/economy/economy.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const scratch = new Layout();
  const ids = S.oval(scratch).ids;
  const t = w.controls.target;
  const g = { x: t.x + 4000, z: t.z + 3000 };
  const types = { 0: "depot-sawmill", 7: "depot-workshop" };
  const placed = w.editor().placeRun(ids.map((i, k) => {
    const q = scratch.getPiece(i);
    return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
  }));
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const sawmill = depot(placed[0], "sawmill");
  const workshop = depot(placed[7], "workshop");
  const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: placed[4], pathIndex: 0, s: 60, reversed: false });
  if (r.kind !== "placed") throw new Error("no room for a train");
  const engine = w.sim.getTrain(r.trainId).cars[0].id;
  w.sim.setLever(engine, 0);
  L.editLine(w.economy, engine, (l) => l.push({ depotId: sawmill.id, action: "auto" }, { depotId: workshop.id, action: "auto" }));
  sawmill.piles[CARGO.planks.index] = 6;
  workshop.piles[CARGO.planks.index] = capAt(workshop);
  const mid = w.layout.getPiece(placed[4]).pose;
  w.director.glideTo(new w.controls.target.constructor(mid.x, 0, mid.z + 300), 2200, { duration: 0.1 });
  // Ticked ahead (a harness shortcut): the sawmill kept at 6 planks and the workshop full unless `room`.
  window.__run = (secs, room) => {
    for (let i = 0; i < secs * 120; i++) {
      sawmill.piles[CARGO.planks.index] = Math.max(sawmill.piles[CARGO.planks.index], 6);
      if (!room) workshop.piles[CARGO.planks.index] = capAt(workshop);
      w.sim.tick();
      w.economy.tick();
      w.economy.drainEvents();
    }
    w.invalidate();
    const train = w.sim.findCar(engine).train;
    return train.cars.reduce((n, c) => n + w.economy.cargoOf(c.id).count, 0);
  };
  window.__room = () => (workshop.piles[CARGO.planks.index] = 0);
  w.invalidate();
  return { engine, sawmill: sawmill.id, workshop: workshop.id };
});
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
await settle();

// A tap on the train opens its card, as a finger does (aimed with the game's own pick).
const at = await p.evaluate((id) => {
  const w = window.woodrail;
  const o = w.trainView.carObject(id);
  const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
  return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
}, setup.engine);
await p.touchscreen.tap(at[0], at[1]);
await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 10000 }).catch(() => {});
// (A harness shortcut if the tap missed (a car's middle can be under the goals from some views): its card opened as the
// tap does. Opening a card by a tap is e2e:touch's and e2e:train-summary's.)
if (!(await p.evaluate(() => window.woodrail.hud.engineCardOpen))) await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), setup.engine);
// Sent on (its lever, as Go sets it: Go is e2e:touch's).
await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), setup.engine);
const status = () => p.evaluate(() => document.querySelector(".engine-card .engine-status")?.textContent ?? "");
await p.waitForFunction(() => /^Not loading/.test(document.querySelector(".engine-card .engine-status")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
const said = await status();
const box = await p.evaluate(() => {
  const s = document.querySelector(".engine-card .engine-status");
  const r = s.getBoundingClientRect();
  return { lines: Math.round(r.height / parseFloat(getComputedStyle(s).lineHeight)), right: r.right };
});
check("the card says why it won't load at the sawmill: the workshop is full", /^Not loading planks at the sawmill( \d+)?: the workshop( \d+)? is full$/.test(said), JSON.stringify(said));
check("…in two lines at most, on the phone", box.lines >= 1 && box.lines <= 2 && box.right > 0 && box.right <= 390, JSON.stringify(box));
await p.evaluate(() => (window.woodrail.paused = true));
await settle();
await p.screenshot({ path: `${OUT}/1-not-loading.jpg`, quality: 85 });
await p.evaluate(() => (window.woodrail.paused = false));

// The payoff: it's the rule the card names. Round the oval twice: no plank goes on at the sawmill.
const carried = await p.evaluate(() => window.__run(60, false));
check("run on with the workshop full, it passes the sawmill without a plank", carried === 0, JSON.stringify({ carried }));
// The workshop given room: the note goes, and the train loads planks at the sawmill.
await p.evaluate(() => window.__room());
await p.waitForFunction(() => !/^Not loading/.test(document.querySelector(".engine-card .engine-status")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
const after = await status();
check("the workshop with room: the note goes", !/^Not loading/.test(after), JSON.stringify(after));
const loaded = await p.evaluate(() => window.__run(60, true));
check("…and the train loads planks at the sawmill", loaded > 0, JSON.stringify({ loaded }));

// Standing still, paused, with its card open: nothing drawn.
await p.evaluate((e) => {
  window.woodrail.sim.setLever(e, 0);
  window.woodrail.paused = true;
}, setup.engine);
await settle();
const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
await p.waitForTimeout(3000);
const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
check("paused with the card open: 0 frames drawn", f1 - f0 === 0, JSON.stringify({ frames: f1 - f0 }));

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
