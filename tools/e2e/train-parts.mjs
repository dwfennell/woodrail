// End-to-end trains made up from parts in Game mode (`npm run e2e:train-parts [-- <out dir>]`), on a phone at 390×844
// with touch: a new game's Trains tab shows only Engines, Wagons and Coaches (no ready-made trains); the first goal
// past joining two towns asks for an engine; an engine dragged from the Engines shelf onto the line goes down, a
// flatbed wagon dragged from the Wagons shelf onto it couples on, and the train gets moving. A caboose (#13) from the
// Coaches shelf says "Makes its train a bit faster" and, dropped at the train's tail, makes it run a tenth faster over
// a measured stretch.
//
// Usage: npm run e2e:train-parts [-- <out dir>]   (default out: e2e-out/train-parts)
// Starts its own dev server (on 5391, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/train-parts";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
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
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });

/** The middle of the first visible element matching `selector` (whose label starts with `text`, if given). */
const centre = (selector, text) =>
  p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && (!text || (e.querySelector(".label")?.textContent ?? e.textContent).trim().startsWith(text)));
      if (!el) return null;
      el.scrollIntoView({ inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
const tap = async (selector, text) => {
  const at = await centre(selector, text);
  if (!at) return false;
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(500);
  return true;
};
/** Drag with a finger from `from` to `to`, in steps. */
const drag = async (from, to) => {
  await touch("touchStart", from.x, from.y);
  for (let k = 1; k <= 20; k++) {
    await touch("touchMove", from.x + ((to.x - from.x) * k) / 20, from.y + ((to.y - from.y) * k) / 20);
    await p.waitForTimeout(30);
  }
  await p.waitForTimeout(300);
  await touch("touchEnd", 0, 0);
  await p.waitForTimeout(800);
};
const shelves = () => p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item.tray-group .label")].map((l) => l.textContent));
/** Where a world point (on the ground) is on the screen. */
const onScreen = (pt) =>
  p.evaluate((pt) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(pt.x, pt.y ?? 0, pt.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }, pt);
const trains = () => p.evaluate(() => window.woodrail.sim.trainIds().map((id) => window.woodrail.sim.getTrain(id).cars.map((c) => c.kind)));

// 1. A new game, on a phone.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");

// 2. The Trains tab: Engines, Wagons and Coaches only.
await tap(".tabs button", "Trains");
await p.waitForTimeout(2500);
await settle();
const tab = await shelves();
check("Game mode's Trains tab: only Engines, Wagons and Coaches (no ready-made Trains shelf)", JSON.stringify(tab) === JSON.stringify(["Engines", "Wagons", "Coaches"]), JSON.stringify(tab));
await shot("1-game-trains-tab");
if (process.env.SHOT_ONLY) {
  await b.close();
  await server.close();
  process.exit(0);
}

// 3. The first two towns joined, as a new player does first; the camera on the middle of the line.
const line = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
  const before = new Set(w.layout.pieceIds());
  const r = play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
  const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id) && w.layout.getPiece(id).type.startsWith("straight"));
  const mid = laid[Math.floor(laid.length / 2)];
  w.invalidate();
  return { ok: r.ok, mid, pose: mid === undefined ? null : w.layout.getPiece(mid).pose };
});
check("the first two towns joined", line.ok && line.pose, JSON.stringify(line));
await p.waitForTimeout(1500);
const goalHint = await p.evaluate(async () => {
  const { GOALS } = await import("/src/game/goals.ts");
  const g = GOALS.find((x) => x.id === "place-train");
  return { title: g.title, hint: g.hint, guide: g.guide(window.woodrail.world) };
});
check("the next goal asks for an engine, and Show me opens the Engines shelf", /engine/i.test(goalHint.title) && /engine/i.test(goalHint.hint) && goalHint.guide.tab === "trains" && goalHint.guide.shelf === "Engines", JSON.stringify({ ...goalHint, guide: { tab: goalHint.guide.tab, shelf: goalHint.guide.shelf } }));
if (line.pose) {
  await p.evaluate((pose) => {
    const w = window.woodrail;
    w.director.glideTo(new w.camera.position.constructor(pose.x, 0, pose.z), 900, { duration: 0.1 });
  }, line.pose);
  await p.waitForTimeout(800);
  await settle();

  // 4. An engine from the Engines shelf, dragged onto the line.
  await tap(".scroller .tray-item.tray-group", "Engines");
  const engineAt = await centre(".scroller .tray-item:not(.tray-group):not(.tray-back)", "Engine");
  check("the Engines shelf opens with a plain engine first", !!engineAt);
  await shot("2-engines-shelf");
  const target = await onScreen(line.pose);
  if (engineAt) await drag(engineAt, target);
  await settle();
  const t1 = await trains();
  check("the engine, dragged out, is on the track", t1.length === 1 && JSON.stringify(t1[0]) === '["engine"]', JSON.stringify(t1));
  check("…and the goal \"Put an engine on the track\" is met", await p.evaluate(async () => (await import("/src/game/goals.ts")).GOALS.find((g) => g.id === "place-train").check(window.woodrail.world).done));

  // 5. A flatbed wagon from the Wagons shelf, dropped onto the engine: it couples on.
  await tap(".scroller .tray-back");
  await tap(".scroller .tray-item.tray-group", "Wagons");
  const wagonAt = await centre(".scroller .tray-item:not(.tray-group):not(.tray-back)", "Flatbed wagon");
  check("the Wagons shelf has the flatbed wagon", !!wagonAt);
  // (Dropped at the engine's end: cars dropped near a train's end couple on to it.)
  const enginePos = await p.evaluate(() => {
    const w = window.woodrail;
    const id = w.sim.trainIds()[0];
    const t = id === undefined ? null : w.sim.getTrain(id);
    const end = t?.world[t.world.length - 1];
    return end ? { x: end.x, y: end.y, z: end.z } : null;
  });
  if (wagonAt && enginePos) await drag(wagonAt, await onScreen(enginePos));
  await settle();
  const t2 = await trains();
  check("the flatbed wagon, dropped on the engine, couples on: one train, engine and flatbed", t2.length === 1 && t2[0].includes("engine") && t2[0].includes("timber"), JSON.stringify(t2));
  await shot("3-engine-and-wagon");

  // 6. Get it moving (as Go does: the engine's lever forward).
  const moving = await p.evaluate(async () => {
    const w = window.woodrail;
    const id = w.sim.trainIds()[0];
    if (id === undefined) return { speed: 0, done: false };
    const engine = w.sim.getTrain(id).cars.find((c) => c.kind === "engine");
    w.sim.setLever(engine.id, 1);
    w.invalidate();
    await new Promise((r) => setTimeout(r, 3000));
    return { speed: w.sim.getTrain(id).speed, done: (await import("/src/game/goals.ts")).GOALS.find((g) => g.id === "get-moving").check(w.world).done };
  });
  check("the train gets moving (\"Get a train moving\" met)", Math.abs(moving.speed) > 0 && moving.done, JSON.stringify(moving));
  await shot("4-moving");

  // 7. A caboose (#13). Setup shortcuts (not what's under test): Passengers learned, and one caboose put in the toy box
  // (as the workshop would make it for 2 planks). Its speed is measured over the stretch the train runs in 1.5 s
  // (180 sim ticks) at full speed, by its front axle's travel, before and after.
  // (Game paused and the game's own sim stepped tick by tick: headless, the page runs it too slowly to time by clock.)
  // The second run goes back the way the first came (the line between the towns is short); the sim runs either way alike.
  const measure = (way) =>
    p.evaluate((way) => {
      const w = window.woodrail;
      const was = w.paused;
      w.paused = true;
      const engineId = w.sim.getTrain(w.sim.trainIds()[0]).cars.find((c) => c.kind === "engine").id;
      const train = () => w.sim.trainIds().map((id) => w.sim.getTrain(id)).find((t) => t.cars.some((c) => c.id === engineId));
      w.sim.setLever(engineId, way);
      for (let i = 0; i < 240; i++) w.sim.tick();
      const a = { ...train().world[0] };
      for (let i = 0; i < 180; i++) w.sim.tick();
      const b = { ...train().world[0] };
      w.sim.setLever(engineId, 0);
      for (let i = 0; i < 600 && train().speed > 0; i++) w.sim.tick();
      w.paused = was;
      w.invalidate();
      return Math.hypot(b.x - a.x, b.z - a.z) / 1.5;
    }, way);
  // (Stopped first: step 6 left it going.)
  await p.evaluate(async () => {
    const w = window.woodrail;
    const t = w.sim.getTrain(w.sim.trainIds()[0]);
    w.sim.setLever(t.cars.find((c) => c.kind === "engine").id, 0);
    const s = Date.now();
    while (w.sim.getTrain(t.id).speed > 1 && Date.now() - s < 8000) await new Promise((r) => setTimeout(r, 100));
  });
  const before = await measure(1);
  await p.evaluate(() => {
    window.woodrail.learn("passengers");
    window.woodrail.progress().add("car:caboose");
    window.woodrail.hud.trayLearned();
  });
  await p.waitForTimeout(800);
  await tap(".scroller .tray-back");
  await tap(".scroller .tray-item.tray-group", "Coaches");
  const cabooseTip = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item")].find((e) => e.querySelector(".label")?.textContent === "Caboose")?.title ?? null);
  check("the Coaches shelf's caboose says what it does", cabooseTip === "Caboose: Makes its train a bit faster", JSON.stringify(cabooseTip));
  const cabooseAt = await centre(".scroller .tray-item:not(.tray-group):not(.tray-back)", "Caboose");
  // (Dropped at the train's end away from its engine: its tail.)
  const tailPos = await p.evaluate(() => {
    const w = window.woodrail;
    const t = w.sim.getTrain(w.sim.trainIds()[0]);
    const end = t.cars[0].kind === "engine" ? t.world[t.world.length - 1] : t.world[0];
    return { x: end.x, y: end.y, z: end.z };
  });
  if (cabooseAt) await drag(cabooseAt, await onScreen(tailPos));
  await settle();
  const t3 = await trains();
  check("the caboose, dropped at the train's tail, couples on there", t3.length === 1 && t3[0].length === 3 && (t3[0][0] === "caboose" || t3[0][2] === "caboose"), JSON.stringify(t3));
  await shot("5-caboose");
  const after = await measure(-1);
  check("with a caboose at its tail the train runs a bit faster (about 1.1×) over the measured stretch", after / before > 1.06 && after / before < 1.14, `before ${before.toFixed(0)} mm/s, after ${after.toFixed(0)} mm/s (${(after / before).toFixed(3)}×)`);
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
