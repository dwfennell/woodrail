// Towns in rows (spec 2026-11-14-town-rows-design.md): the starter map's Larkfield grown a level at a time (deliveries
// written in, as e2e:town-shape does), drawn on this machine's GPU at 1440×900 with the HUD hidden.
// `node tools/shots/town-rows.mjs [<out dir>] [--levels=0,3,5]`: <out>/rows-<level>-rows-<wide|street>.jpg. (The towns
// as they were before rows: docs/agents/shots/town-rows-*-now-*.jpg.)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) ?? "e2e-out/town-rows";
const only = args.find((a) => a.startsWith("--only="))?.slice(7);
const levels = (args.find((a) => a.startsWith("--levels="))?.slice(9) ?? "0,1,2,3,4,5").split(",").map(Number);
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5396, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const VIEWS = { wide: [1700, 0.75, 0], street: [620, 0.5, 0.6], ...(process.env.TOP ? { top: [1300, 0.03, 0] } : {}) };
for (const [name, query] of [["rows", ""]].filter(([n]) => !only || n === only)) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(`${server.resolvedUrls.local[0]}${query}`);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-start", { timeout: 60000 });
  await p.click('.new-game-sheet:not([hidden]) [data-hills="hilly"]');
  await p.click(".new-game-sheet:not([hidden]) .new-game-start");
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.keyboard.press("Escape");
  for (let level = 0; level <= Math.max(...levels); level++) {
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
    if (!levels.includes(level)) continue;
    for (const [view, [dist, pitch, yaw]] of Object.entries(VIEWS)) {
      await p.evaluate(async ([dist, pitch, yaw]) => {
        const w = window.woodrail;
        const t = w.world.landscape.towns[0];
        const V = w.camera.position.constructor;
        w.lookAt(new V(t.centre.x, 0, t.centre.z), dist, pitch, yaw);
        for (const el of document.body.querySelectorAll("*")) if (el.tagName !== "CANVAS" && !el.querySelector("canvas") && !el.closest("canvas")) el.style.visibility = "hidden";
        w.invalidate();
        await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
      }, [dist, pitch, yaw]);
      await p.waitForTimeout(900);
      await p.screenshot({ path: `${OUT}/rows-${level}-${name}-${view}.jpg`, type: "jpeg", quality: 84 });
      await p.evaluate(() => {
        for (const el of document.body.querySelectorAll("*")) el.style.visibility = "";
      });
    }
    console.log(name, "level", level, await p.evaluate(() => window.woodrail.world.landscape.towns[0].buildings.length), "buildings");
  }
  await p.close();
}
await b.close();
await server.close();
