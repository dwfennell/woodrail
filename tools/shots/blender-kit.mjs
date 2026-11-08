// Pictures for the Blender-or-Kit report (docs/agents/2026-11-07-blender-or-kit.md), on a 390×844 phone @2x:
//   train-*:   one goods train of Blender wagons (van, hopper, flatbed) and Kit ones (cold van, milk tank, tank wagon,
//              mail van, car carrier, circus cage) on the track, from the phone's usual height and from low and near;
//   tray-*:    the tray's Trains tab (its pictures are drawn from the same car models as the track's);
//   viewer-*:  the dev-only catalogue viewer (catalogue/index.html), where the old Kit sketches of trains sit beside the
//              game's own cars.
// A Game, track put down by the editor and the train placed by hand (a harness shortcut: it's for looking, not testing).
//
// Usage: node tools/shots/blender-kit.mjs [<out dir>]   (default out: e2e-out/blender-kit)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/blender-kit";
mkdirSync(OUT, { recursive: true });
const server = await createServer({
  root: ROOT,
  configFile: `${ROOT}/vite.config.ts`,
  server: { port: 5395, strictPort: false },
  logLevel: "error",
});
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM =
  process.env.CHROMIUM_PATH ??
  (existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined);
const b = await chromium.launch({
  executablePath: CHROMIUM,
  headless: false,
  args: [
    "--headless=new",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const p = await b.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (name) =>
  p
    .screenshot({
      path: `${OUT}/${name}.jpg`,
      type: "jpeg",
      quality: 82,
      timeout: 180000,
    })
    .catch((e) =>
      console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`),
    );
const settle = () =>
  p.evaluate(() =>
    Promise.race([
      window.woodrail.settled(3),
      new Promise((r) => setTimeout(r, 20000)),
    ]),
  );

// ——— The catalogue viewer ———
for (const [name, q] of [
  ["viewer-mail-van", "mail van"],
  ["viewer-tank", "tank"],
]) {
  await p.goto(`${PAGE}catalogue/`);
  await p.waitForSelector("#search", { timeout: 120000 });
  await p.fill("#search", q);
  await p.waitForTimeout(6000);
  await snap(name);
}

// ——— The game ———
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, {
  timeout: 240000,
});
await p.evaluate(() =>
  [...document.querySelectorAll(".title-card.mode-game button")]
    .find((x) => !x.hidden && x.classList.contains("primary"))
    .click(),
);
await p.waitForFunction(
  () =>
    window.woodrail?.mode?.() === "game" &&
    !window.woodrail.title.shown &&
    !!document.querySelector("#loading.done"),
  null,
  { timeout: 180000 },
);
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() =>
  document.querySelector(".coach:not([hidden]) .coach-skip")?.click(),
);

// The tray's Trains tab.
await p.evaluate(() =>
  [...document.querySelectorAll(".tray button, .tray [role=tab]")]
    .find((x) => x.textContent.trim() === "Trains")
    ?.click(),
);
await p.waitForTimeout(2500);
await snap("tray-trains");

const look = (x, z, dist, phi, theta) =>
  p.evaluate(
    ({ x, z, dist, phi, theta }) =>
      window.woodrail.director.glideTo(
        new window.woodrail.camera.position.constructor(x, 0, z),
        dist,
        { duration: 0.1, phi, theta },
      ),
    { x, z, dist, phi, theta },
  );

// One line of straights on flat dry ground near the first town, a goods train of Blender and Kit wagons on it.
const scene = await p.evaluate(async () => {
  const { isWater } = await import("/src/landscape/index.ts");
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const w = window.woodrail;
  const g = w.world.landscape.grid;
  const t = w.world.landscape.towns[0];
  const ok = (x0, z0) => {
    for (let x = x0 - 60; x <= x0 + 1140; x += 30)
      for (let z = z0 - 80; z <= z0 + 120; z += 30) {
        const i = g.cellAtWorld(x, z);
        if (
          i < 0 ||
          isWater(g.surface[i]) ||
          g.height[i] !== 0 ||
          (g.road && g.road[i])
        )
          return false;
      }
    return true;
  };
  let site = null;
  for (let r = 300; r < 4000 && !site; r += 150)
    for (let a = 0; a < 16 && !site; a++) {
      const x = Math.round(t.centre.x + r * Math.cos((a / 16) * 2 * Math.PI));
      const z = Math.round(t.centre.z + r * Math.sin((a / 16) * 2 * Math.PI));
      if (ok(x, z)) site = { x, z };
    }
  if (!site) return "no site";
  const y = g.groundY(g.cellAtWorld(site.x, site.z));
  let end = w
    .editor()
    .place("straight-216", { x: site.x, z: site.z, heading: 0 }, y, false);
  const pieces = [end];
  for (let k = 0; k < 4; k++)
    pieces.push(
      (end =
        appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ??
        end),
    );
  w.trackChanged();
  // Blender: engine, van, hopper, flatbed. Kit: cold van, milk tank, tank wagon, mail van, car carrier, circus cage.
  const goods = w.sim.addTrain(
    [
      "engine",
      "van",
      "reefer",
      "hopper",
      "tanker",
      "timber",
      "oiltank",
      "mailvan",
      "carrier",
      "cage",
    ],
    { pieceId: pieces[4], pathIndex: 0, reversed: false, s: 200 },
  );
  if (goods.kind === "placed") {
    const cars = w.sim.getTrain(goods.trainId).cars;
    w.economy.setCargo(cars[3].id, "coal", 3);
    w.economy.setCargo(cars[5].id, "log", 3);
  }
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  return { x: site.x, z: site.z, goods: goods.kind };
});
console.log("scene:", JSON.stringify(scene));

await p.addStyleTag({
  content: "body > *:not(#scene) { visibility: hidden !important }",
});
const shoot = async (name, dx, dist, phi, theta) => {
  await look(scene.x + dx, scene.z, dist, phi, theta);
  await p.waitForTimeout(1500);
  await settle();
  await snap(name);
};
// The train runs along +x: turned a quarter so it runs up the screen.
await shoot("train-phone", 560, 2000, 0.55, Math.PI / 2);
await shoot("train-near", 480, 650, 1.05, Math.PI / 2 + 0.6);
await shoot("train-near-2", 760, 650, 1.05, Math.PI / 2 + 0.6);
if (errors.length) console.log("errors:", errors.slice(0, 5).join("\n"));
await b.close();
await server.close();
