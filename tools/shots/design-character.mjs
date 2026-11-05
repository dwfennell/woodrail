// Design pictures for docs/superpowers/specs/2026-11-05-character-and-goals.md: a fresh Game on a 390×844 phone,
// its towns' cards as they are today, the towns grown (a harness shortcut, as in starter-room.mjs: deliveries written
// as trains would bring them; growth is the game's own), and mock-ups of the proposals drawn as HTML over the real
// game. Mocks only: nothing here is a feature.
//
// Usage: node tools/shots/design-character.mjs [<out dir>]   (default out: e2e-out/design-character)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/design-character";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const shot = (name) => p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 78, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
await settle();

const towns = await p.evaluate(() => {
  const w = window.woodrail;
  return w.world.landscape.towns.map((t) => ({ id: t.id, name: t.name, x: t.centre.x, z: t.centre.z, depot: w.economy.allDepots().find((d) => d.role === "town" && d.townId === t.id)?.id }));
});
console.log("towns", JSON.stringify(towns));
await shot("look-start");

const look = (x, z, dist, phi = 0.8, theta = null) =>
  p.evaluate(
    async ({ x, z, dist, phi, theta }) => {
      const w = window.woodrail;
      w.lookAt(new w.camera.position.constructor(x, 0, z), dist, phi, theta);
      w.invalidate();
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    },
    { x, z, dist, phi, theta },
  );

const card = async (t, name) => {
  await look(t.x, t.z, 1500);
  await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), t.depot);
  await p.waitForTimeout(800);
  await shot(name);
  await p.keyboard.press("Escape");
};
for (const [i, t] of towns.entries()) if (t.depot !== undefined && i < 2) await card(t, `look-card-${i}`);

/** Every town to `level` (deliveries written; growth is TownLife's on the next frame). */
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
await growAll(3);
await settle();
for (const [i, t] of towns.entries()) {
  await look(t.x, t.z, 1700, 0.85, Math.PI / 4);
  await shot(`look-city-${i}`);
}
if (towns[0].depot !== undefined) await card(towns[0], "look-city-card");
await look(-200, -350, 8200, 0.42, Math.PI / 2);
await shot("look-overview");

await b.close();
await server.close();
