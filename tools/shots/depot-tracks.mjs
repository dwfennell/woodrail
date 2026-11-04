// Pictures of the depot-tracks prototype (docs/superpowers/specs/2026-11-04-depot-tracks.md) on a 390×844 phone: a mill
// on a straight line, its card's "Second track" button with the price, the mill at 1 → 2 → 3 tracks by taps on that
// button (the game's own planner, its drop rules and the workshop's planks and stone), and two trains worked by the
// mill's two cranes at once. The line, the mill, the workshop's stock and the trains are a harness shortcut (placed by
// the editor and stocked by hand), for looking, not testing; the upgrade itself is the card's button.
//
// Usage: node tools/shots/depot-tracks.mjs [<out dir>]   (default out: docs/agents/shots)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5379, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (name, quality = 80) => p.screenshot({ path: `${OUT}/${name}`, type: "jpeg", quality, timeout: 180000, scale: "css" }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
await p.goto(`${PAGE}/${process.env.SEED ? `#seed-${process.env.SEED}` : ""}`);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// A straight line on open ground: three straights, the mill, two straights, a workshop, a straight (along x; the mill's
// yard on +z, its further tracks to come on −z). Each piece, and room for two tracks beside it, asked of the game's rules.
const built = await p.evaluate(async () => {
  const w = window.woodrail;
  const types = ["straight-216", "straight-216", "straight-216", "depot-mill", "straight-216", "straight-216", "depot-workshop", "straight-216"];
  const t = w.controls.target;
  const g = w.world.landscape.grid;
  for (let d = 300; d < 7000; d += 72) {
    for (let a = 0; a < Math.max(1, Math.round(d / 72) * 4); a++) {
      const X = Math.round((t.x + d * Math.cos(a) - 756) / 18) * 18;
      const Z = Math.round((t.z + d * Math.sin(a)) / 18) * 18;
      const y = g.groundY(g.cellAtWorld(X, Z));
      if (y !== 0) continue;
      const pieces = types.map((type, i) => ({ type, pose: { x: X + i * 216, z: Z, heading: 0 }, y: 0, flipped: false }));
      const probes = [];
      for (let i = 0; i < 8; i++) for (const l of [-72, -144]) probes.push({ type: "straight-216", pose: { x: X + i * 216, z: Z + l, heading: 0 }, y: 0, flipped: false });
      if ([...pieces, ...probes].some((q) => w.interaction.placeWhyIgnoring(q.type, q.flipped, q.pose, q.y, -1) !== null)) continue;
      const ids = w.editor().placeRun(pieces);
      const mill = w.economy.depotAtPiece(ids[3]) ?? w.economy.addDepot("mill", ids[3]);
      const shop = w.economy.depotAtPiece(ids[6]) ?? w.economy.addDepot("workshop", ids[6]);
      const { CARGO } = await import("/src/economy/cargo.ts");
      shop.piles[CARGO.planks.index] = 24;
      shop.piles[CARGO.stone.index] = 12;
      mill.piles[CARGO.flour.index] = 8;
      mill.piles[CARGO.grain.index] = 2;
      w.depotView.setWorld(w.economy, w.layout);
      w.invalidate?.();
      return { X, Z, ids, mill: mill.id };
    }
  }
  return null;
});
console.log(JSON.stringify(built));
if (!built) throw new Error("no open ground");
const millX = built.X + 3 * 216 + 108;

const look = async (x, z, dist, phi = 0.62, theta = 0.5, inRoom = false) => {
  await p.evaluate(
    ({ x, z, dist, phi, theta, inRoom }) => {
      const w = window.woodrail;
      w.director.glideTo(new w.camera.position.constructor(x, 0, z), dist, { duration: 0.05, phi, theta, inRoom });
    },
    { x, z, dist, phi, theta, inRoom },
  );
  await p.waitForTimeout(400);
  await settle();
};
const openCard = () => p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), built.mill);
const cardText = () => p.evaluate(() => document.querySelector(".depot-tracks")?.innerText ?? "(no tracks row)");

// 1. One track, the card open: the "Second track" button and its price.
const cardLook = () => look(millX + 60, built.Z - 10, 1150, 0.78, Math.PI / 2 + 0.45, true);
await cardLook();
await openCard();
await p.waitForTimeout(1200);
await settle();
console.log("1 track:", JSON.stringify(await cardText()));
await snap("depot-tracks-1-card.jpg");

// 2. Tap the button: a second track. 3. Tap again: a third.
for (const n of [2, 3]) {
  await p.evaluate(() => document.querySelector(".depot-tracks-btn")?.click());
  await p.waitForTimeout(1500);
  await settle();
  const toast = await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.innerText).join(" | "));
  console.log(`${n} tracks:`, JSON.stringify(await cardText()), "toast:", JSON.stringify(toast));
  await openCard();
  await cardLook();
  await p.waitForTimeout(800);
  await settle();
  await snap(`depot-tracks-${n}-card.jpg`);
}
const roads = await p.evaluate((id) => window.woodrail.economy.roadsOf(id).map((r) => r.pieceId), built.mill);
console.log("roads:", JSON.stringify(roads));

// 4. Two trains at once: a hopper of grain on the mill's own track, a van for flour on its second; both run up to the
// cranes and stand while each crane works its own train.
await p.evaluate(() => window.woodrail.hud.closeCards?.());
await p.keyboard.press("Escape");
const trains = await p.evaluate(
  async ({ ids, roads }) => {
    const w = window.woodrail;
    const out = [];
    const put = (pieceId, kinds, s, load) => {
      const r = w.sim.addTrain(kinds, { pieceId, pathIndex: 0, s, reversed: false });
      if (r.kind !== "placed") return r;
      const tr = w.sim.getTrain(r.trainId);
      if (load) for (const c of tr.cars) if (c.kind === "hopper") w.economy.setCargo(c.id, "grain", 4);
      w.sim.setLever(tr.cars[0].id, 1);
      out.push(r.trainId);
      return r;
    };
    const a = put(ids[3], ["engine", "hopper", "hopper"], 200, true);
    const b2 = put(roads[0], ["engine", "van", "van"], 200, false);
    w.trainView?.sync?.();
    w.invalidate?.();
    return { a, b: b2, out };
  },
  { ids: built.ids, roads },
);
console.log("trains:", JSON.stringify(trains));
// Run till both are standing under their cranes, each crane mid-move.
const both = await p.evaluate(
  async ({ mill, roads, millPiece }) => {
    const w = window.woodrail;
    const t0 = performance.now();
    while (performance.now() - t0 < 60000) {
      const a = w.economy.cranePhase(mill, millPiece);
      const b = w.economy.cranePhase(mill, roads[0]);
      if (a > 0.3 && a < 0.6 && b > 0.3) return { a, b };
      await new Promise((r) => setTimeout(r, 30));
    }
    return { a: w.economy.cranePhase(mill, millPiece), b: w.economy.cranePhase(mill, roads[0]) };
  },
  { mill: built.mill, roads, millPiece: built.ids[3] },
);
console.log("cranes:", JSON.stringify(both));
await p.evaluate(() => (window.woodrail.paused = true));
await p.evaluate(() => window.woodrail.setPaused?.(true));
await look(millX - 20, built.Z - 20, 720, 0.9, Math.PI - 0.55);
await snap("depot-tracks-two-trains.jpg");
await look(millX, built.Z - 72, 1900, 0.4, Math.PI / 2);
await snap("depot-tracks-overview.jpg");

console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no errors");
await b.close();
await server.close();
