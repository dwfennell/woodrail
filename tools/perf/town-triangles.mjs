// What a town's buildings cost to draw as it grows (`node tools/perf/town-triangles.mjs [--rows]`): the starter map's
// Larkfield grown a level at a time (deliveries written in, as e2e:town-shape does: a harness shortcut), and at each
// level its buildings and the triangles of their models (each prop's drawn model, summed). `--rows`: the dev server's
// `?rows` (towns in rows: spec 2026-11-14-town-rows-design.md), to hold to 1.3 times the plain numbers.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const rows = process.argv.includes("--rows");
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5383, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 844, height: 600 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await p.goto(`${server.resolvedUrls.local[0]}${rows ? "?rows" : ""}`);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-start", { timeout: 60000 });
await p.click('.new-game-sheet:not([hidden]) [data-hills="hilly"]');
await p.click(".new-game-sheet:not([hidden]) .new-game-start");
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.keyboard.press("Escape");
const count = () =>
  p.evaluate(async () => {
    const { drawnKey } = await import("/src/render/props/library.ts");
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    let triangles = 0;
    let props = 0;
    for (const q of w.world.props.all()) {
      if (q.town !== t.id || q.building === undefined) continue;
      const key = drawnKey(q.asset, q.variant, q.storeys);
      const m = w.propLibrary.model(key) ?? (await w.propLibrary.load(key));
      if (!m) continue;
      props++;
      for (const part of m.parts) triangles += (part.geometry.index ? part.geometry.index.count : part.geometry.getAttribute("position").count) / 3;
    }
    return { buildings: t.buildings.length, props, triangles: Math.round(triangles) };
  });
console.log(`level buildings props triangles${rows ? " (rows)" : ""}`);
for (let level = 0; level <= 5; level++) {
  if (level > 0) {
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
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
  }
  const c = await count();
  console.log(`${level} ${c.buildings} ${c.props} ${c.triangles}`);
}
await b.close();
await server.close();
