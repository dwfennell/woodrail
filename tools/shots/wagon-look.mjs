// Pictures of a passenger train beside a goods train from above, as a player sees them on a phone (390×844 @2x): every
// wagon kind side by side, to check that coaches and goods wagons read apart from a high camera, in their own colours
// and in your own paint (Body and Trim from the paint shop). A Game, track put down by the editor and the trains placed
// by hand (a harness shortcut: it's for looking, not for testing).
//
// Usage: node tools/shots/wagon-look.mjs [<out dir>] [<prefix>]   (default out: e2e-out/wagon-look, prefix wagon-look)
// docs/agents/shots/wagon-look-before-*.jpg and wagon-look-after-*.jpg are its, with prefix wagon-look-before / -after.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/wagon-look";
const PREFIX = process.argv[3] ?? "wagon-look";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5394, strictPort: false }, logLevel: "error" });
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
const snap = (name) => p.screenshot({ path: `${OUT}/${PREFIX}-${name}.jpg`, type: "jpeg", quality: 82, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
const look = (x, z, dist, phi, theta) =>
  p.evaluate(({ x, z, dist, phi, theta }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, 0, z), dist, { duration: 0.1, phi, theta }), { x, z, dist, phi, theta });

// Two lines of straights side by side on flat dry ground near the first town, running up the screen: an express of
// every coach look on one, a goods train of every goods wagon on the other (the hopper heaped with coal, logs on the
// timber wagon).
const scene = await p.evaluate(async () => {
  const { isWater } = await import("/src/landscape/index.ts");
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const w = window.woodrail;
  const g = w.world.landscape.grid;
  const t = w.world.landscape.towns[0];
  const ok = (x0, z0) => {
    let h0 = null;
    for (let x = x0 - 60; x <= x0 + 1140; x += 30)
      for (let z = z0 - 80; z <= z0 + 200; z += 30) {
        const i = g.cellAtWorld(x, z);
        if (i < 0 || isWater(g.surface[i]) || g.height[i] !== 0 || (g.road && g.road[i])) return false;
      }
    return true;
  };
  let site = null;
  for (let r = 300; r < 4000 && !site; r += 150)
    for (let a = 0; a < 16 && !site; a++) {
      const x = Math.round(t.centre.x + r * Math.cos((a / 16) * 2 * Math.PI));
      const z = Math.round(t.centre.z + r * Math.sin((a / 16) * 2 * Math.PI));
      if (ok(x, z)) site = { x, z };
    }
  if (!site) return "no site";
  const lines = [];
  for (const dz of [0, 110]) {
    const z = site.z + dz;
    const y = g.groundY(g.cellAtWorld(site.x, z));
    let end = w.editor().place("straight-216", { x: site.x, z, heading: 0 }, y, false);
    const pieces = [end];
    for (let k = 0; k < 4; k++) pieces.push((end = appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ?? end));
    lines.push(pieces);
  }
  w.trackChanged();
  const pax = w.sim.addTrain(["engine", "passenger", "passenger", "passenger", "passenger", "passenger", "caboose"], { pieceId: lines[0][4], pathIndex: 0, reversed: false, s: 150 });
  const goods = w.sim.addTrain(["engine", "van", "hopper", "timber", "reefer", "tanker", "oiltank", "mailvan"], { pieceId: lines[1][4], pathIndex: 0, reversed: false, s: 150 });
  const ids = {};
  if (pax.kind === "placed") {
    const cars = w.sim.getTrain(pax.trainId).cars;
    w.sim.setLook(cars[0].id, "express");
    ["classic", "dining", "sleeper", "first-class", "double-decker"].forEach((l, i) => w.sim.setLook(cars[i + 1].id, l));
    ids.pax = cars.map((c) => c.id);
  }
  if (goods.kind === "placed") {
    const cars = w.sim.getTrain(goods.trainId).cars;
    w.sim.setLook(cars[0].id, "goods");
    w.economy.setCargo(cars[2].id, "coal", 3);
    w.economy.setCargo(cars[3].id, "log", 3);
    ids.goods = cars.map((c) => c.id);
  }
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  window.__ids = ids;
  return { x: site.x, z: site.z, pax: pax.kind, goods: goods.kind };
});

console.log("scene:", JSON.stringify(scene));
// (INTERACTIVE=1: run the JS in e2e-out/wl-cmd.js each time it appears, with p, look, snap and settle in reach, for
// framing by hand; "exit" in it ends.)
if (process.env.INTERACTIVE) {
  const { readFileSync, unlinkSync, writeFileSync } = await import("node:fs");
  for (;;) {
    let src = null;
    try {
      src = readFileSync("e2e-out/wl-cmd.js", "utf8");
      unlinkSync("e2e-out/wl-cmd.js");
    } catch {}
    if (src === null) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    if (src.trim() === "exit") break;
    let out;
    try {
      out = await eval(`(async () => { ${src} })()`);
    } catch (e) {
      out = `error: ${e.message}`;
    }
    writeFileSync("e2e-out/wl-out.txt", JSON.stringify(out ?? null) + "\n");
  }
  await b.close();
  await server.close();
  process.exit(0);
}

await p.addStyleTag({ content: "body > *:not(#scene) { visibility: hidden !important }" });
// The trains run along +x from scene.x: the camera turned a quarter so they run up the phone's screen.
const cx = scene.x + 565;
const cz = scene.z + 55;
const shoot = async (name, dist, phi, theta = Math.PI / 2, dx = 0) => {
  await look(cx + dx, cz, dist, phi, theta);
  await p.waitForTimeout(1500);
  await settle();
  await snap(name);
};
await shoot("mixed", 2300, 0.5);
await shoot("mixed-near", 1250, 0.55, Math.PI / 2, 30);
await shoot("side", 900, 1.0, Math.PI / 2 + 0.5, -110);
// Both trains in one livery of your own (red body, dark trim): the hardest case, as a coach's trim is its roof.
await p.evaluate(async () => {
  const { ownLivery } = await import("/src/game/paint-shop.ts");
  const w = window.woodrail;
  const id = ownLivery("#c8442f", "#2a2b2e");
  for (const c of [...window.__ids.pax, ...window.__ids.goods]) w.sim.setLivery(c, id);
  w.invalidate();
});
await shoot("painted", 2300, 0.5);
await shoot("painted-near", 1250, 0.55, Math.PI / 2, 30);
if (errors.length) console.log("errors:", errors.slice(0, 5).join("\n"));
await b.close();
await server.close();
