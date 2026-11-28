// The town station's house standing on the ground (2026-11-26: "the station just floats there"): a town's fixed
// station framed close and low from four sides, on a saved map (the user's, by `#load=`) and on a new game's starter
// map grown a level at a time (deliveries written in, as tools/shots/town-rows.mjs does).
// `node tools/shots/station-house.mjs [<out dir>] [--map=<file>] [--town=<part of a name>] [--levels=0,5]`:
// <out>/station-<map|lvlN>-<view>.jpg, 1440×900 with the HUD hidden.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const OUT = args.find((a) => !a.startsWith("--")) ?? "e2e-out/station-house";
const MAP = opt("map");
const TOWN = opt("town") ?? "";
const levels = (opt("levels") ?? "0,5").split(",").filter(Boolean).map(Number);
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

/** Four sides of the station, low: [name, yaw offset from the station's heading, pitch]. */
const VIEWS = [["back", 0, 1.2], ["end", Math.PI / 2, 1.2], ["front", Math.PI, 1.1], ["corner", -Math.PI / 4, 1.0]];

async function frame(p, tag, part = TOWN) {
  for (const [view, yawOff, pitch] of VIEWS) {
    await p.evaluate(async ([part, yawOff, pitch]) => {
      const { TRACK_WIDTH } = await import("/src/track/index.ts");
      const w = window.woodrail;
      const towns = w.world.landscape.towns;
      const t = towns.find((x) => x.name.includes(part) && !x.upgraded) ?? towns.find((x) => !x.upgraded);
      const s = t.station;
      const dx = Math.cos(s.heading);
      const dz = Math.sin(s.heading);
      const lat = TRACK_WIDTH / 2 + 40;
      const V = w.camera.position.constructor;
      // (The house's back corner, between the platform and the house: where the gap under it shows.)
      w.lookAt(new V(s.x + dx * 108 - dz * lat, 10, s.z + dz * 108 + dx * lat), 330, pitch, -s.heading + yawOff);
      for (const el of document.body.querySelectorAll("*")) if (el.tagName !== "CANVAS" && !el.querySelector("canvas") && !el.closest("canvas")) el.style.visibility = "hidden";
      w.invalidate();
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    }, [part, yawOff, pitch]);
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/station-${tag}-${view}.jpg`, type: "jpeg", quality: 84, timeout: 240000 });
    await p.evaluate(() => {
      for (const el of document.body.querySelectorAll("*")) el.style.visibility = "";
    });
  }
}

async function page() {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  return p;
}
const inGame = (p) =>
  p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title?.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });

if (MAP) {
  const p = await page();
  await p.goto(`${PAGE}#load=${encodeURIComponent(readFileSync(MAP, "utf8").trim())}`);
  await inGame(p);
  await p.keyboard.press("Escape");
  await frame(p, "map");
  await p.close();
}
if (levels.length > 0) {
  const p = await page();
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-start", { timeout: 60000 });
  await p.click('.new-game-sheet:not([hidden]) [data-hills="hilly"]');
  await p.click(".new-game-sheet:not([hidden]) .new-game-start");
  await inGame(p);
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
    if (levels.includes(level)) await frame(p, `lvl${level}`, await p.evaluate(() => window.woodrail.world.landscape.towns[0].name));
  }
  await p.close();
}
await b.close();
await server.close();
