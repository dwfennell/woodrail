// Pictures of the six secrets on a real Game map (390×844 @2x): each hidden in its mist where the map put it, then
// found, its halt laid and a coach train standing at the platform.
//
// Harness shortcuts, for looking only (the player's path is e2e:secrets'): the plots on the way to each secret bought
// with `game.unlockPlot` (no coins); each found with `findSecret` (as laying track to it does); a short line of
// straights and a turnback out from its halt laid by the editor; the train put on the halt by the sim, the game paused
// so it stands. Not the starter map: a fresh seed (SEED, default 101) whose plan has all six, the shipwreck on its coast.
//
// Usage: node tools/shots/secret-sites.mjs [<out dir>]   (default out: docs/agents/shots). PICK=castle,shipwreck
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const PICK = process.env.PICK?.split(",");
const SEED = Number(process.env.SEED ?? 101);
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5433, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
p.on("pageerror", (e) => console.log("pageerror", e.message));
// (Not the first game: a fresh map from `SEED`, `freshGameWorld`'s random number fixed.)
await p.addInitScript((seed) => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.game.started", "1");
  window.__seed = seed;
}, SEED);
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
// The map: `SEED`'s, made the game's way (a harness shortcut: the title's New game picks a random seed).
await p.evaluate(async (seed) => {
  const w = window.woodrail;
  const { createWorld } = await import("/src/game/world.ts");
  w.setWorld?.(createWorld(seed, true));
}, SEED);
await settle();
const seedNow = await p.evaluate(() => window.woodrail.landscape.seed);
console.log("seed", seedNow);

const hideUi = (hidden) =>
  p.evaluate((hidden) => {
    for (const el of document.querySelectorAll(".toast, .card, .reward-badge, .growth-sheet, .tray")) el.style.visibility = hidden ? "hidden" : "";
  }, hidden);
const shot = async (name) => {
  await hideUi(true);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 82, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  await hideUi(false);
  console.log("shot", name);
};
const look = (x, z, dist, phi) =>
  p.evaluate(
    async ({ x, z, dist, phi }) => {
      const w = window.woodrail;
      w.lookAt(new w.camera.position.constructor(x, 0, z), dist, phi);
      w.invalidate();
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    },
    { x, z, dist, phi },
  );

const plan = await p.evaluate(() => (window.woodrail.landscape.secretPlan ?? []).filter((q) => !q.alt).map((q) => ({ ...q })));
console.log("plan", JSON.stringify(plan));
for (const q of plan) {
  if (PICK && !PICK.includes(q.kind)) continue;
  // Buy the plots on the way to it (and it), nearest first.
  const site = await p.evaluate(async (q) => {
    const w = window.woodrail;
    const { plotsForSale } = await import("/src/game/world.ts");
    const land = w.landscape;
    const has = () => (land.secrets ?? []).find((s) => s.kind === q.kind && !s.found);
    for (let k = 0; k < 12 && !has(); k++) {
      const sale = plotsForSale(land);
      if (sale.length === 0) break;
      sale.sort((a, b) => Math.hypot(a.px - q.px, a.pz - q.pz) - Math.hypot(b.px - q.px, b.pz - q.pz));
      w.unlockPlot(sale[0].px, sale[0].pz);
    }
    const s = has();
    return s ? { id: s.id, kind: s.kind, piece: s.piece } : null;
  }, q);
  if (!site) {
    console.log(`(no ${q.kind}: not placed on this map)`);
    continue;
  }
  const at = await p.evaluate(async (id) => {
    const { frameOf, frameToWorld } = await import("/src/landscape/secrets.ts");
    const s = window.woodrail.landscape.secrets[id];
    return { mid: frameToWorld(frameOf(s.piece), 0, 60), halt: frameToWorld(frameOf(s.piece), 0, 170), heading: s.piece.heading };
  }, site.id);
  await p.waitForFunction((k) => (window.woodrail.invalidate(), !!window.woodrail.propLibrary.model(`secret-${k}-hidden`)), site.kind, { timeout: 60000, polling: 500 });
  await look(at.mid.x, at.mid.z, 1000, 0.85);
  await shot(`secret-${site.kind}-hidden`);
  // Found, its line, a train at its halt.
  const made = await p.evaluate(async (id) => {
    const w = window.woodrail;
    const { findSecret } = await import("/src/game/secrets.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    const { appendPiece } = await import("/src/track/snap.ts");
    const s = w.landscape.secrets[id];
    const halt = findSecret(w.world, s);
    // Out from its open end: three straights and a turnback, along its line.
    let ref = connectorRef(halt, 0);
    for (let k = 0; k < 3; k++) {
      const id2 = appendPiece(w.layout, "straight-216", false, ref, 1);
      ref = connectorRef(id2, 0);
    }
    w.syncSecrets();
    w.trackChanged();
    const placed = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: halt, pathIndex: 0, reversed: false, s: 196 });
    w.paused = true;
    w.invalidate();
    return { halt, placed: placed.kind };
  }, site.id);
  console.log(site.kind, JSON.stringify(made));
  await p.waitForFunction((k) => (window.woodrail.invalidate(), !!window.woodrail.propLibrary.model(`kit:kit-secret-${k}`)), site.kind, { timeout: 60000, polling: 500 });
  await look(at.mid.x, at.mid.z, 1000, 0.85);
  await shot(`secret-${site.kind}-found`);
}

await b.close();
await server.close();
