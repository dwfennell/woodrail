// End-to-end: what a train carries, on its cards (#9), in Game mode on a 360×740 phone with touch. A new game; track
// from the first town's station to the forest yard; an engine and a flatbed on it, sent off with the engine card's Go.
// Once the forest's crane has loaded logs onto the flatbed, a tap on the train opens its engine card: the summary says
// "1 car · 40 km/h" and the logs on board, in two lines that fit the card at 360 px, its buttons 44 px or more; it
// follows the load as it changes, and is set only then (not per frame). A second tap, on the wagon, opens its card with
// its load ("🌲 Logs: 3 of 3").
//
// Usage: npm run e2e:train-summary [-- <out dir>]   (default out: e2e-out/train-summary)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/train-summary";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
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
/** A card button tapped as a finger does, once it's drawn and has stood still past the card tap guard. */
const tapButton = async (selector) => {
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
/** Where car `id` is on the screen. */
const carOnScreen = (id) =>
  p.evaluate((id) => {
    const w = window.woodrail;
    const o = w.trainView.carObject(id);
    if (!o) return null;
    const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, id);
const lookAt = async (id, dist = 520) => {
  // (A car new on the map gets its model on the next frame drawn.)
  await p.waitForFunction((id) => (window.woodrail.invalidate(), !!window.woodrail.trainView.carObject(id)), id, { timeout: 60000, polling: 500 });
  await p.evaluate(
    ({ id, dist }) => {
      const w = window.woodrail;
      const o = w.trainView.carObject(id);
      const at = o.getWorldPosition(new w.camera.position.constructor());
      w.director.glideTo(new w.camera.position.constructor(at.x, 0, at.z), dist, { duration: 0.1 });
    },
    { id, dist },
  );
};

// 1. A new game, on a 360 px phone.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");

// 2. Setup (not what's tested; train-parts drags these from the tray): track from the first town's station to the
// forest yard, laid by the player's own pathfinder, and an engine and a flatbed put on it by the station.
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
  // (On a straight near the station end of the new track, as a player drops one.)
  const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id) && w.layout.getPiece(id).type.startsWith("straight"));
  let placed = { kind: "none" };
  for (const id of laid.slice(1)) {
    placed = w.sim.addTrain(["engine", "timber"], { pieceId: id, pathIndex: 0, reversed: false, s: 20 });
    if (placed.kind === "placed") break;
  }
  w.invalidate();
  if (placed.kind !== "placed") return { error: `no train: ${placed.kind}`, laid: laid.length };
  const t = w.sim.getTrain(w.sim.trainIds().at(-1));
  return { engine: t.cars.find((c) => c.kind === "engine").id, wagon: t.cars.find((c) => c.kind === "timber").id };
});
check("setup: track to the forest yard, an engine and a flatbed on it", !setup.error, JSON.stringify(setup));
if (!setup.error) {
  const { engine, wagon } = setup;
  await lookAt(engine);
  await settle();

  // 3. A tap on the train: its engine card. Go (the card's own button) sends it off.
  let at = await carOnScreen(engine);
  if (at) await p.touchscreen.tap(at.x, at.y);
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  check("a tap on the train opens its engine card", await p.evaluate(() => window.woodrail.hud.engineCardOpen));
  const before = await p.evaluate(() => ({ about: document.querySelector(".summary-about")?.textContent, load: document.querySelector(".summary-load")?.textContent }));
  check("…its summary: one car, its speed, empty", before.about === "1 car · 40 km/h" && before.load === "Empty", JSON.stringify(before));
  await tapButton(".engine-card .chip.go");
  await p.waitForFunction((e) => window.woodrail.sim.findCar(e)?.train.speed > 0, engine, { timeout: 30000 }).catch(() => {});
  check("Go sends it off", await p.evaluate((e) => window.woodrail.sim.findCar(e)?.train.speed > 0, engine));

  // 4. The forest's crane loads logs onto the flatbed (the game's own rules: the train stops under it), the card open
  // all the while: its load line follows, and is set only as the load changes (counted against the frames drawn).
  const follow = await p.evaluate(
    async ({ wagon }) => {
      const w = window.woodrail;
      const hud = w.hud;
      let sets = 0;
      const was = hud.setEngineSummary;
      hud.setEngineSummary = function (...a) {
        sets++;
        return was.apply(this, a);
      };
      const v0 = w.economy.loadsVersion;
      const f0 = w.framesDrawn;
      const seen = new Set();
      const t0 = performance.now();
      while (performance.now() - t0 < 900000) {
        await new Promise((r) => setTimeout(r, 500));
        if (!hud.engineCardOpen) {
          seen.add("card closed");
          break;
        }
        const c = w.economy.cargoOf(wagon);
        const want = c.count > 0 ? `🌲 ${c.count}` : "Empty";
        const got = document.querySelector(".summary-load").textContent;
        seen.add(got === want ? "ok" : `${got} != ${want}`);
        if (c.count >= 1) break;
      }
      hud.setEngineSummary = was;
      return { sets, changes: w.economy.loadsVersion - v0, frames: w.framesDrawn - f0, seen: [...seen] };
    },
    { wagon },
  );
  check("the summary follows the load as the crane loads it", follow.seen.every((s) => s === "ok") && follow.changes > 0, JSON.stringify(follow));
  check("…set only when the load changes, not per frame", follow.sets >= 1 && follow.sets <= follow.changes && follow.sets < follow.frames, JSON.stringify(follow));
  await p.evaluate(() => window.woodrail.hud.hideCards());
  const loaded = await p.evaluate((id) => window.woodrail.economy.cargoOf(id), wagon);
  check("the flatbed is loaded with logs at the forest yard", loaded.kind === "log" && loaded.count >= 1, JSON.stringify(loaded));

  // 5. The engine card, opened now: the logs on board, in two lines that fit.
  await lookAt(engine, 480);
  await settle();
  at = await carOnScreen(engine);
  // (A first tap on any car takes the train and opens its engine's card.)
  await p.evaluate(() => window.woodrail.interaction.clearSelection?.());
  if (at) await p.touchscreen.tap(at.x, at.y);
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  await settle();
  const card = await p.evaluate(
    ({ wagon }) => {
      const w = window.woodrail;
      const c = w.economy.cargoOf(wagon);
      const s = document.querySelector(".engine-summary");
      const lines = [...s.children].filter((e) => getComputedStyle(e).display !== "none");
      const box = document.querySelector(".engine-card").getBoundingClientRect();
      const buttons = [...document.querySelectorAll(".engine-card button")].filter((e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().width > 0).map((e) => {
        const r = e.getBoundingClientRect();
        return { t: e.title || e.textContent, w: Math.round(r.width), h: Math.round(r.height) };
      });
      return {
        open: w.hud.engineCardOpen,
        count: c.count,
        about: lines[0]?.textContent,
        load: lines[1]?.textContent,
        lines: lines.length,
        clipped: lines.some((e) => e.scrollWidth > e.clientWidth + 1),
        height: s.getBoundingClientRect().height,
        lineHeight: parseFloat(getComputedStyle(s).lineHeight),
        card: { left: box.left, right: box.right },
        small: buttons.filter((x) => x.w < 44 || x.h < 44),
      };
    },
    { wagon },
  );
  check("the engine card opens on the loaded train", card.open);
  check("the summary says the logs on board", card.about === "1 car · 40 km/h" && card.load === `🌲 ${card.count}`, JSON.stringify({ about: card.about, load: card.load, count: card.count }));
  check("…in two lines at 360 px, neither cut short", card.lines === 2 && card.height <= 2 * card.lineHeight + 1 && !card.clipped, JSON.stringify(card));
  check("…the card inside the screen", card.card.left >= 0 && card.card.right <= 360, JSON.stringify(card.card));
  check("…its buttons 44 px or more", card.small.length === 0, JSON.stringify(card.small));
  await shot("1-engine-card-loaded");

  // 7. A second tap, on the wagon: its own card, with its load.
  await lookAt(wagon, 420);
  await settle();
  await p.evaluate((e) => {
    const w = window.woodrail;
    // (Held still for the tap: the wagon stays under the finger.)
    w.sim.setLever(e, 0);
  }, engine);
  await p.waitForFunction((e) => Math.abs(window.woodrail.sim.findCar(e)?.train.speed ?? 1) < 1, engine, { timeout: 30000 }).catch(() => {});
  await lookAt(wagon, 420);
  await settle();
  // (The first tap takes the train, its engine's card; the next, on the wagon, the wagon's own.)
  at = await carOnScreen(wagon);
  if (at) await p.touchscreen.tap(at.x, at.y);
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen || window.woodrail.hud.carCardOpen, null, { timeout: 20000 }).catch(() => {});
  await settle();
  await p.waitForTimeout(600);
  at = await carOnScreen(wagon);
  if (at && !(await p.evaluate(() => window.woodrail.hud.carCardOpen))) await p.touchscreen.tap(at.x, at.y);
  await p.waitForFunction(() => window.woodrail.hud.carCardOpen, null, { timeout: 20000 }).catch(() => {});
  await settle();
  const wagonCard = await p.evaluate((id) => ({ open: window.woodrail.hud.carCardOpen, text: document.querySelector(".car-load")?.textContent, count: window.woodrail.economy.cargoOf(id).count, room: window.woodrail.economy.wagonCapacity }), wagon);
  check("a tap on the wagon opens its card, with its load", wagonCard.open && (wagonCard.count > 0 ? wagonCard.text === `🌲 Logs: ${wagonCard.count} of ${wagonCard.room}` : /^Empty/.test(wagonCard.text ?? "")), JSON.stringify(wagonCard));
  await shot("2-wagon-card");
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
