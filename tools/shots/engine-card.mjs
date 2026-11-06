// Pictures of the engine card on a 390×844 phone (2×), for the engine card's layout: a 3-car train on a 4-stop line,
// its card as it stands, and in its route's edit view. A sandbox oval with four places, the train and its line put down
// in code (only to get to the state pictured; nothing here is tested). `MOCK=<file.mjs>` runs that module's
// `default(p, shot)` after the setup, to try a layout on the live card.
//
// Usage: node tools/shots/engine-card.mjs [<out dir>]   (default: e2e-out/engine-card)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/engine-card";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
// (`VIEW=844x390`: another phone size, on its side say.)
const [VW, VH] = (process.env.VIEW ?? "390x844").split("x").map(Number);
const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.favourites", "[]");
});
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.goto(PAGE);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 60000 });
await p.evaluate(() => {
  const help = document.querySelector(".help");
  if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
  document.querySelector(".coach:not([hidden]) .coach-skip")?.click();
});
await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));

const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  const { Layout } = await import("/src/track/index.ts");
  const S = await import("/src/routing/scenarios.ts");
  const L = await import("/src/game/lines.ts");
  const scratch = new Layout();
  const ids = S.oval(scratch).ids;
  const t = w.controls.target;
  // Far off on the table, clear of the starter map (only a backdrop for the card).
  const g = { x: t.x + 4000, z: t.z + 3000 };
  const types = { 0: "depot-forest", 2: "depot-farm", 7: "depot-sawmill", 9: "depot-mill" };
  const placed = w.editor().placeRun(ids.map((i, k) => {
    const q = scratch.getPiece(i);
    return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
  }));
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const places = [depot(placed[0], "forest").id, depot(placed[2], "farm").id, depot(placed[7], "sawmill").id, depot(placed[9], "mill").id];
  const r = w.sim.addTrain(["engine", "timber", "timber", "hopper"], { pieceId: placed[4], pathIndex: 0, s: 60, reversed: false });
  if (r.kind !== "placed") throw new Error("no room for a train");
  const cars = w.sim.getTrain(r.trainId).cars;
  const engine = cars[0].id;
  w.sim.setLever(engine, 0);
  L.editLine(w.economy, engine, (l) => {
    for (const d of places) l.push({ depotId: d, action: "auto" });
  });
  w.economy.setCargo(cars[1].id, "log", 3);
  w.economy.setCargo(cars[2].id, "planks", 2);
  w.economy.setCargo(cars[3].id, "grain", 4);
  const mid = w.layout.getPiece(placed[4]).pose;
  w.director.glideTo(new w.controls.target.constructor(mid.x, 0, mid.z + 300), 2200, { duration: 0.1 });
  w.invalidate();
  return { engine, places, pieces: placed };
});
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
// Its card, as a tap opens it.
await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), setup.engine);
await p.waitForTimeout(800);
const opened = await p.evaluate(() => !document.querySelector(".engine-card").hidden);
if (!opened) {
  // A tap on the engine, as a finger does.
  const at = await p.evaluate((id) => {
    const w = window.woodrail;
    const o = w.trainView.carObject(id);
    const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  }, setup.engine);
  await p.touchscreen.tap(at[0], at[1]);
  await p.waitForTimeout(1200);
}
const shot = async (name) => {
  await p.evaluate(() => Promise.race([window.woodrail.settled(2), new Promise((r) => setTimeout(r, 8000))]));
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}.jpg`, quality: 85, timeout: 120000 });
  console.log("shot", `${OUT}/${name}.jpg`);
};
if (process.env.MOCK) {
  const mod = await import(pathToFileURL(process.env.MOCK).href);
  await mod.default(p, shot, setup);
} else {
  await shot("now-card");
  await p.evaluate(() => document.querySelector(".engine-extra .route-plan")?.click());
  await p.waitForTimeout(600);
  await shot("now-edit");
}
await b.close();
await server.close();
