// End-to-end town shape as it grows (`npm run e2e:town-shape [-- <out dir>]`), Game mode at 844×600: a new game's
// Larkfield grown a level at a time to city ★★ (deliveries written as trains would bring them: a harness shortcut,
// as in e2e:growth; growth itself is the game's own, TownLife on the next frame). Checks what it's for: only some of
// its houses rise, the middle ones; the outer fifth of the town and the buildings each level put up stay
// single-storey; each level puts up new buildings. A picture at each level (the same camera), for before/after.
//
// Usage: npm run e2e:town-shape [-- <out dir>]   (default out: e2e-out/town-shape)
// Starts its own dev server (on 5384, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/town-shape";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5384, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 844, height: 600 }, deviceScaleFactor: 1.5 });
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
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");

/** Larkfield as it stands: each house that can stack (its share out from the centre, storeys, the level it went up at). */
const town = () =>
  p.evaluate(async () => {
    const { stacks } = await import("/src/props/storeys.ts");
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    const g = w.world.landscape.grid;
    const dist = (b) => {
      const xs = b.cells.map((c) => g.centreX(g.colOf(c)));
      const zs = b.cells.map((c) => g.centreZ(g.rowOf(c)));
      return Math.hypot(xs.reduce((a, v) => a + v, 0) / xs.length - t.centre.x, zs.reduce((a, v) => a + v, 0) / zs.length - t.centre.z);
    };
    const sorted = t.buildings.map(dist).sort((a, b) => a - b);
    const share = (b) => sorted.findIndex((d) => d >= dist(b) - 1e-6) / Math.max(1, sorted.length - 1);
    const houses = [...w.world.props.all()]
      .filter((q) => q.town === t.id && q.building !== undefined && stacks(q.asset))
      .map((q) => {
        const b = t.buildings.find((x) => x.id === q.building);
        return { id: b.id, share: share(b), storeys: q.storeys ?? 0, born: b.born ?? 0 };
      });
    return { name: t.name, buildings: t.buildings.length, houses };
  });

/** One level more for Larkfield: what it wants next, delivered (the towns are looked at on the next frame drawn). */
const growOne = async (level) => {
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
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
};

const picture = async (name) => {
  await p.evaluate(async () => {
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    const V = w.camera.position.constructor;
    w.lookAt(new V(t.centre.x, 0, t.centre.z), 1700, 0.75);
    // (The picture is of the town: the HUD hidden, everything but the canvas and what holds it.)
    for (const el of document.body.querySelectorAll("*")) if (el.tagName !== "CANVAS" && !el.querySelector("canvas") && !el.closest("canvas")) el.style.visibility = "hidden";
    w.invalidate();
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  });
  await p.screenshot({ path: `${OUT}/${name}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  await p.evaluate(() => {
    for (const el of document.body.querySelectorAll("*")) el.style.visibility = "";
  });
};

await picture("level-0");
let had = (await town()).buildings;
const NAMES = ["hamlet", "village", "town", "city", "city-star", "city-star2"];
for (let level = 1; level <= 5; level++) {
  await growOne(level);
  const t = await town();
  const tall = t.houses.filter((h) => h.storeys > 0);
  console.log(`${t.name} ${NAMES[level]}: ${t.buildings} buildings, ${tall.length} of ${t.houses.length} houses taller, most ${Math.max(0, ...t.houses.map((h) => h.storeys))}`);
  check(`${NAMES[level]}: new buildings put up`, t.buildings > had, `${had} → ${t.buildings}`);
  check(`${NAMES[level]}: not every house rises`, tall.length < t.houses.length * 0.7, `${tall.length} of ${t.houses.length}`);
  check(`${NAMES[level]}: the outer fifth stays single-storey`, t.houses.every((h) => h.share < 0.8 || h.storeys === 0), JSON.stringify(t.houses.filter((h) => h.share >= 0.8 && h.storeys)));
  check(`${NAMES[level]}: this level's new buildings are single-storey`, t.houses.every((h) => h.born < level || h.storeys === 0), JSON.stringify(t.houses.filter((h) => h.born === level && h.storeys)));
  if (level >= 3) check(`${NAMES[level]}: its middle is taller`, tall.length > 0);
  had = t.buildings;
  await picture(`level-${level}-${NAMES[level]}`);
}
check("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
