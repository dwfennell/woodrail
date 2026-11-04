// The starting area as its towns grow (`node tools/shots/starter-room.mjs [<out dir>] [<prefix>]`), Game mode on a
// 390×844 phone: a new game's start (the 2 × 2 plots), then every town grown to a town (level 2), a city (3) and a
// city ★★ (5), the same camera each time. Deliveries are written as trains would bring them (a harness shortcut, as in
// e2e:town-shape); growth itself is the game's own (TownLife on the next frame). Prints the towns and how much of the
// start region's ground is still free (flat grass with nothing on it) at each step, for the crowding question.
//
// Starts its own dev server (on 5386, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/starter-room";
const PREFIX = process.argv[3] ?? "starter-room";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5386, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");

/** The towns, and the start region's free ground: flat-or-not grass with no feature on it, in squares. */
const measure = () =>
  p.evaluate(() => {
    const w = window.woodrail.world;
    const land = w.landscape;
    const g = land.grid;
    let free = 0;
    let all = 0;
    const near = new Map(land.towns.map((t) => [t.id, 0]));
    g.forEachCell((i, col, row) => {
      all++;
      if (g.surface[i] !== 0 || g.feature[i] !== 0) return;
      free++;
      const x = g.centreX(col);
      const z = g.centreZ(row);
      for (const t of land.towns) if (Math.hypot(x - t.centre.x, z - t.centre.z) < 700) near.set(t.id, near.get(t.id) + 1);
    });
    return { towns: land.towns.map((t) => ({ id: t.id, name: t.name, x: t.centre.x, z: t.centre.z, buildings: t.buildings.length, freeWithin700: near.get(t.id) })), free, all };
  });

/** Every town to `level`: what each level wants, delivered (the towns grow on the next frame drawn). */
const growAll = async (level) => {
  await p.evaluate(async (level) => {
    const { townLevel } = await import("/src/game/towns.ts");
    const w = window.woodrail;
    const bag = {};
    for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n;
    for (const t of w.world.landscape.towns) {
      w.economy.delivered.set(t.id, bag.planks ?? 0);
      w.economy.deliveredGoods.set(t.id, { ...bag });
    }
    w.invalidate();
  }, level);
  await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 60000 }).catch(() => console.log(`(level ${level} not seen)`));
  await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll(".growth-sheet .close").forEach((x) => x.click()));
  await p.keyboard.press("Escape");
};

const picture = async (name) => {
  await p.evaluate(async () => {
    const w = window.woodrail;
    const V = w.camera.position.constructor;
    // The start region's middle, from high enough to see its four plots on a phone held upright.
    w.lookAt(new V(-200, 0, -350), 8200, 0.42, Math.PI / 2);
    for (const el of document.body.querySelectorAll("*")) if (el.tagName !== "CANVAS" && !el.querySelector("canvas") && !el.closest("canvas")) el.style.visibility = "hidden";
    w.invalidate();
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  });
  await p.screenshot({ path: `${OUT}/${PREFIX}-${name}.jpg`, type: "jpeg", quality: 72, timeout: 120000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  await p.evaluate(() => {
    for (const el of document.body.querySelectorAll("*")) el.style.visibility = "";
  });
};

const report = async (label) => {
  const m = await measure();
  console.log(`${label}: free ${m.free} of ${m.all} squares; ` + m.towns.map((t) => `${t.name} (${t.x},${t.z}) ${t.buildings} bldg, ${t.freeWithin700} free near`).join("; "));
};

await report("start");
await picture("start");
for (const [level, name] of process.env.START_ONLY ? [] : [[2, "town"], [3, "city"], [5, "city2"]]) {
  await growAll(level);
  await report(name);
  await picture(name);
}
await b.close();
await server.close();
