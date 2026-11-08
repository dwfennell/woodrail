// End-to-end small touches of life (`npm run e2e:life`), in Game mode on a 390×844 phone with touch:
// - The first train's marker: none on a new map; the player's first train sent off with its engine card's Go puts one
//   down beside the track where it stood; a reload keeps it, in the same place, and running on puts down no other.
// - A busy industry moves: the forest yard by the track works (it cuts logs while it has room), its woodcutter's axe
//   swings while the game runs and it's in view, frames being drawn; paused, it holds still and no frames are drawn.
// - Life in town: the first town has its touches (as many as its level asks) and a child at the end of its platform.
//
// Usage: npm run e2e:life [-- <out dir>]   (default out: e2e-out/life)
// Starts its own dev server. Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium if present, else Playwright's.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/life";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks held still: this counts idle frames, and a clock in view draws one at each minute; e2e:station-clock tests that.)
pinClocksIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const start = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
};
/** A button tapped as a finger does, once it's drawn and has stood still past the card tap guard. */
const tap = async (selector) => {
  await settle();
  await p.waitForTimeout(400);
  const r = await p.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, selector);
  if (r) await p.touchscreen.tap(r.x, r.y);
  return !!r;
};
const carOnScreen = (id) =>
  p.evaluate((id) => {
    const w = window.woodrail;
    const o = w.trainView.carObject(id);
    if (!o) return null;
    const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, id);
const look = (x, z, dist) =>
  p.evaluate(
    ({ x, z, dist }) => {
      const w = window.woodrail;
      w.director.glideTo(new w.camera.position.constructor(x, 0, z), dist, { duration: 0.1 });
    },
    { x, z, dist },
  );

// 1. A new game: no marker yet; the first town has its touches and its child.
await p.goto(PAGE);
await start().catch(async (e) => {
  console.log("FAIL the game didn't start:", e.message.split("\n")[0], errors.slice(0, 5).join(" | "));
  await b.close();
  await server.close();
  process.exit(1);
});
const fresh = await p.evaluate(() => {
  const w = window.woodrail;
  const town = w.world.landscape.towns[0];
  return { mark: w.landscape.firstTrain ?? null, shown: w.touches.marked, kid: w.touches.wavesOf().has(town.id), touches: w.touches.spots.length, towns: w.world.landscape.towns.length };
});
check("a new map has no first train's marker", fresh.mark === null && fresh.shown === null, JSON.stringify(fresh));
check("the towns have touches of life, and the first town a child on its platform", fresh.kid && fresh.touches >= fresh.towns, JSON.stringify(fresh));

// 2. Setup (not what's tested; train-summary does the same): track from the first town's station to the forest yard,
// laid by the player's own pathfinder, and an engine and a flatbed put on it by the station.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const station = w.world.stations.get(w.world.landscape.towns[0].id);
  const forest = [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === "depot-forest");
  if (forest === undefined) return { error: "no forest yard" };
  const before = new Set(w.layout.pieceIds());
  let r = null;
  for (const [a, f] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
    r = play(w.world.layout, w.editor(), connectorRef(station, a), connectorRef(forest, f), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 });
    if (r.ok) break;
  }
  if (!r?.ok) return { error: "no track to the forest" };
  const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id) && w.layout.getPiece(id).type.startsWith("straight"));
  let placed = { kind: "none" };
  for (const id of laid.slice(1)) {
    placed = w.sim.addTrain(["engine", "timber"], { pieceId: id, pathIndex: 0, reversed: false, s: 20 });
    if (placed.kind === "placed") break;
  }
  w.invalidate();
  if (placed.kind !== "placed") return { error: `no train: ${placed.kind}` };
  const t = w.sim.getTrain(w.sim.trainIds().at(-1));
  const forestDepot = w.economy.depotAtPiece(forest).id;
  return { engine: t.cars.find((c) => c.kind === "engine").id, forest, forestDepot };
});
check("setup: track to the forest yard, an engine and a flatbed on it", !setup.error, JSON.stringify(setup));

if (!setup.error) {
  const { engine } = setup;
  const where = () =>
    p.evaluate((e) => {
      const w = window.woodrail;
      const i = [...w.snapshot.ids.slice(0, w.snapshot.count)].indexOf(e);
      return i < 0 ? null : { x: w.snapshot.transforms[i * 6], z: w.snapshot.transforms[i * 6 + 2] };
    }, engine);
  await p.evaluate((e) => {
    const w = window.woodrail;
    const at = w.trainView.carObject(e)?.getWorldPosition(new w.camera.position.constructor());
    w.invalidate();
    if (at) w.director.glideTo(new w.camera.position.constructor(at.x, 0, at.z), 520, { duration: 0.1 });
  }, engine);
  await p.waitForFunction((e) => (window.woodrail.invalidate(), !!window.woodrail.trainView.carObject(e)), engine, { timeout: 60000, polling: 500 });
  await settle();
  check("put on the track, it hasn't run: still no marker", (await p.evaluate(() => window.woodrail.landscape.firstTrain ?? null)) === null);
  const stood = await where();

  // 3. The player's first train: a tap on it, Go on its engine card.
  const at = await carOnScreen(engine);
  if (at) await p.touchscreen.tap(at.x, at.y);
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  await tap(".engine-card .chip.go");
  await p.waitForFunction((e) => window.woodrail.sim.findCar(e)?.train.speed > 0, engine, { timeout: 30000 }).catch(() => {});
  await p.waitForFunction(() => !!window.woodrail.touches.marked, null, { timeout: 20000 }).catch(() => {});
  const mark = await p.evaluate(() => ({ saved: window.woodrail.landscape.firstTrain ?? null, shown: window.woodrail.touches.marked }));
  const off = mark.saved && stood ? Math.hypot(mark.saved.x - stood.x, mark.saved.z - stood.z) : Infinity;
  check("Go: the first train's marker goes down beside the track where it stood", !!mark.saved && !!mark.shown && off < 90, `${JSON.stringify(mark)} ${Math.round(off)} mm from where it stood`);
  await p.keyboard.press("Escape");
  if (mark.saved) {
    await look(mark.saved.x, mark.saved.z, 260);
    await settle();
    await shot("1-first-train-marker");
  }

  // 4. A busy industry moves: the forest yard, working, its axe swinging while the game runs and it's in view.
  const forestAt = await p.evaluate((id) => {
    const pc = window.woodrail.layout.getPiece(id);
    const c = Math.cos(pc.pose.heading);
    const s = Math.sin(pc.pose.heading);
    return { x: pc.pose.x + c * 150 - s * 88, z: pc.pose.z + s * 150 + c * 88 };
  }, setup.forest);
  await look(forestAt.x, forestAt.z, 380);
  await settle();
  /** The forest's axe (its motes' first instance of that kind), and frames drawn so far. */
  const axe = () =>
    p.evaluate((depotId) => {
      const w = window.woodrail;
      const d = w.economy.allDepots().find((x) => x.id === depotId);
      let m = null;
      w.depotView.group.traverse((o) => {
        if (!m && o.isInstancedMesh && o.userData.mote === "axe") m = [...o.instanceMatrix.array.slice(0, 16)];
      });
      return { working: w.economy.working(d), m, frames: w.framesDrawn };
    }, setup.forestDepot);
  const a0 = await axe();
  await p.waitForTimeout(1500);
  const a1 = await axe();
  const moved = a0.m && a1.m && a0.m.some((v, i) => Math.abs(v - a1.m[i]) > 1e-4);
  check("the forest yard works and its axe swings, frames drawn while it does", a0.working && a1.working && moved && a1.frames > a0.frames, JSON.stringify({ working: a1.working, moved, frames: a1.frames - a0.frames }));
  await shot("2-forest-busy");
  // Paused: it holds still and nothing is drawn.
  await tap("button[title^='Pause']");
  await p.waitForFunction(() => window.woodrail.paused, null, { timeout: 10000 }).catch(() => {});
  await settle();
  const b0 = await axe();
  await p.waitForTimeout(2500);
  const b1 = await axe();
  const still = b0.m && b1.m && b0.m.every((v, i) => Math.abs(v - b1.m[i]) < 1e-6);
  check("paused: the axe holds still and no frames are drawn", still && b1.frames === b0.frames, JSON.stringify({ still, frames: b1.frames - b0.frames }));
  await tap("button[title^='Pause'], button[title^='Play'], button[title^='Resume']");

  // 5. A reload keeps the one marker, where it was; running on puts down no other.
  await p.evaluate(() => window.woodrail.flushSave?.());
  await p.waitForTimeout(3000);
  await p.reload();
  await start();
  await p.waitForTimeout(3000);
  const back = await p.evaluate(() => ({ saved: window.woodrail.landscape.firstTrain ?? null, shown: window.woodrail.touches.marked, running: window.woodrail.sim.trainIds().length }));
  const same = back.saved && mark.saved && Math.hypot(back.saved.x - mark.saved.x, back.saved.z - mark.saved.z) < 0.01;
  check("a reload keeps the marker in the same place, and no other is put down", same && back.shown && Math.hypot(back.shown.x - mark.saved.x, back.shown.z - mark.saved.z) < 0.01, JSON.stringify(back));
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
