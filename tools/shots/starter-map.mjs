// The way from the sawmill to Larkfield (the first town) on a new Game map (`node tools/shots/starter-map.mjs [<out
// dir>] [<name>:<hills>:<seed> …]`), on a 390×844 phone: each map started from the new-game screen (its seed typed, its
// hills picked) on a fresh page, then framed on the sawmill and the town, the HUD hidden. Default: the starter map
// (seed 7) with Gentle and with Hilly hills.
//
// Starts its own dev server (on 5386, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/starter-map";
const MAPS = (process.argv.length > 3 ? process.argv.slice(3) : ["starter-gentle:gentle:7", "starter-hilly:hilly:7"]).map((s) => {
  const [name, hills, seed] = s.split(":");
  return { name, hills, seed };
});
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5386, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

for (const map of MAPS) {
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  // The title's New game, then the new-game screen: the seed typed, the hills picked, Start.
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-start", { timeout: 60000 });
  await p.fill(".new-game-sheet:not([hidden]) .new-game-seed", map.seed);
  await p.click(`.new-game-sheet:not([hidden]) [data-hills="${map.hills}"]`);
  await p.click(".new-game-sheet:not([hidden]) .new-game-start");
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.keyboard.press("Escape");
  const where = await p.evaluate(async () => {
    const w = window.woodrail;
    const land = w.world.landscape;
    const town = land.towns[0];
    const saw = land.depots.find((d) => d.kind === "sawmill");
    const V = w.camera.position.constructor;
    // Between the two, looking from the town toward the sawmill: the way between them up the screen (a phone upright).
    w.lookAt(new V((town.centre.x + saw.centre.x) / 2, 0, (town.centre.z + saw.centre.z) / 2), 2400, 0.95, Math.PI / 2);
    for (const el of document.body.querySelectorAll("*")) if (el.tagName !== "CANVAS" && !el.querySelector("canvas") && !el.closest("canvas")) el.style.visibility = "hidden";
    w.invalidate();
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    return { town: town.name, seed: land.seed, hills: land.hills ?? "hilly" };
  });
  await p.screenshot({ path: `${OUT}/${map.name}.jpg`, type: "jpeg", quality: 72, timeout: 120000 });
  console.log(`${map.name}: seed ${where.seed}, ${where.hills}, sawmill and ${where.town}`);
  await p.close();
}
await b.close();
await server.close();
