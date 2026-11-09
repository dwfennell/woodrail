// City card mocks (docs/agents/city-card-proposals.md): Game mode on the starter map, its first town grown to a City ★
// (deliveries written as trains would bring them: a setup shortcut, as e2e:grand), a line calling there, the town's
// services learned. Then each scene in scenes.mjs: the card or the Journal as it is today, or a mock (HTML/CSS over
// the game), screenshotted at the scene's size.
//
// Usage: node tools/shots/city-card-mocks/stage.mjs [<out dir>] [<scene,…>]   (default out: tools/shots/city-card-mocks/out)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const DIR = new URL(".", import.meta.url).pathname;
const OUT = process.argv[2] ?? `${DIR}out`;
const ONLY = process.argv[3]?.split(",");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const SIZES = { phone: { width: 390, height: 844, touch: true }, desktop: { width: 1440, height: 900, touch: false } };
const scenes = (await import(`${DIR}scenes.mjs?${Date.now()}`)).default;

for (const [size, vp] of Object.entries(SIZES)) {
  const todo = scenes.filter((s) => s.size === size && (!ONLY || ONLY.includes(s.name)));
  if (todo.length === 0) continue;
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.touch, isMobile: vp.touch });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

  // The first town a City ★, a third of the way to its next star (the levels one by one, as the grand e2e does).
  const town = await p.evaluate(() => {
    const w = window.woodrail;
    for (const id of ["switches", "routes", "passengers", "post-office", "town-hall", "park", "mills", "bakery", "sawmills", "quarries", "brickworks", "mines"]) w.learn(id);
    const t = w.world.landscape.towns[0];
    return { id: t.id, name: t.name, depot: w.world.economy.depotAtPiece(w.world.stations.get(t.id)).id };
  });
  for (let level = 1; level <= 5; level++) {
    await p.evaluate(
      async ({ level, id }) => {
        const { townLevel } = await import("/src/game/towns.ts");
        const w = window.woodrail;
        const bag = {};
        for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + Math.round(n * (k === 4 ? 0.35 : 1));
        w.economy.delivered.set(id, bag.planks ?? 0);
        w.economy.deliveredGoods.set(id, bag);
        w.invalidate();
      },
      { level, id: town.id },
    );
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.querySelectorAll(".growth-sheet:not([hidden]) .close").forEach((x) => x.click()));
  }
  await p.evaluate(() => {
    const w = window.woodrail;
    const pr = w.progress();
    pr.coins = 1240;
    w.hud.setCoins(pr.coins);
    w.paused = true;
  });
  await p.waitForTimeout(1200);
  await p.keyboard.press("Escape");
  const state = await p.evaluate(async (id) => {
    const { statusOf } = await import("/src/game/town-life.ts");
    return statusOf(window.woodrail.world, id);
  }, town.id);
  console.log(size, town.name, "level", state.level, state.name);

  for (const s of todo) {
    await s.run(p, { town, size, settle, css: (f) => readFileSync(`${DIR}${f}`, "utf8") });
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/${s.name}.jpg`, type: "jpeg", quality: 84, timeout: 180000 });
    console.log("shot", s.name);
    if (s.after) await s.after(p);
  }
  await ctx.close();
}
await b.close();
await server.close();
