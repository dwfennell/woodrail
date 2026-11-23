// Wagon loads at a heavy wagon's 4 and 5 (Smithy: `Economy.wagonCapacity` 5), and at a plain wagon's 3 beside them,
// drawn by the game in Sandbox, headless: `node tools/shots/heavy-loads.mjs [<out dir>] [--count=5]`:
// [--only=log,planks]: <out>/<wagon>-<goods>-<n>.png (and -top, from higher), close up, one per wagon and load, and <out>/train-<n>.png of the whole train.
// For judging how a load stacks (src/render/cargo-layout.ts `wagonSlot`), before and after a change.
//
// Harness shortcuts (named): the loads are set with `economy.setCargo` and the capacity by `economy.wagonCapacity = 5`
// (as Smithy learned sets it), not by loaders and research: what's under test is how a load looks. Game mode's
// modelled goods are loaded into Sandbox (as e2e:hopper-load does): heavy wagons are Game mode's.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) ?? "e2e-out/heavy-loads";
const COUNTS = (args.find((a) => a.startsWith("--count="))?.slice(8) ?? "3,4,5").split(",").map(Number);
/** [wagon, goods]: each wagon kind with the goods that ride on it, the ones stacked by `wagonSlot`. */
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const ALL = [
  ["timber", "log"],
  ["timber", "planks"],
  ["timber", "iron"],
  ["timber", "bricks"],
  ["timber", "fruit"],
  ["timber", "flowers"],
  ["van", "furniture"],
  ["van", "flour"],
  ["van", "tools"],
  ["hopper", "coal"],
  ["tanker", "milk"],
  ["oiltank", "oil"],
  ["reefer", "icecream"],
  ["carrier", "autos"],
  ["mailvan", "mail"],
];
const CARS = ALL.filter(([w, g]) => !ONLY || ONLY.some((o) => `${w}-${g}`.includes(o)));
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5396, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const p = await b.newPage({ viewport: { width: 480, height: 360 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const shot = (n) =>
  p
    .addStyleTag({ content: "body.hl-shot * { visibility: hidden } body.hl-shot canvas { visibility: visible }" })
    .then(() => p.evaluate(() => document.body.classList.add("hl-shot")))
    .then(() => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }))
    .finally(() => p.evaluate(() => document.body.classList.remove("hl-shot")));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
try {
  await p.goto(server.resolvedUrls.local[0]);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((b) => !b.hidden && b.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  // Lines somewhere clear (as e2e:hopper-load finds one), a train of five wagons on each.
  const line = () =>
    p.evaluate((n) => {
      const w = window.woodrail;
      const i = w.interaction;
      const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      for (let ring = 1; ring < 20; ring++)
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          let t = { x: Math.round((Math.cos(a) * ring * 360) / 18) * 18, z: Math.round((Math.sin(a) * ring * 360) / 18) * 18, heading: 0 };
          const ids = [];
          let ok = true;
          for (let m = 0; m < n; m++) {
            const pose = { x: t.x, z: t.z, heading: t.heading };
            if (i.placement("straight-216", false, pose, 0, -1).reason) {
              ok = false;
              break;
            }
            const id = w.editor().place("straight-216", pose, 0, false);
            ids.push(id);
            t = c(id, 1);
          }
          if (ok) return ids;
          for (const id of ids.reverse()) w.editor().remove(id);
        }
      return null;
    }, 4);
  const cars = [];
  for (let at = 0; at < CARS.length; at += 5) {
    const ids = await line();
    if (!ids) throw new Error("no clear line");
    const made = await p.evaluate(
      ({ ids, kinds }) => {
        const w = window.woodrail;
        const r = w.sim.addTrain(["engine", ...kinds], { pieceId: ids.at(-1), pathIndex: 0, reversed: false, s: 200 });
        if (r.kind !== "placed") return JSON.stringify(r);
        w.changed?.();
        w.economy.wagonCapacity = 5;
        return w.sim.getTrain(w.sim.trainIds().at(-1)).cars.slice(1).map((c) => c.id);
      },
      { ids, kinds: CARS.slice(at, at + 5).map(([k]) => k) },
    );
    if (!Array.isArray(made)) throw new Error(`train not placed: ${made}`);
    cars.push(...made);
  }
  // Game mode's modelled goods (heavy wagons are Game mode's: Smithy), fetched as Game mode does, the goods rebuilt.
  await p.evaluate(async () => {
    const w = window.woodrail;
    await (await import("/src/render/blender-models.ts")).loadGameModels();
    w.depotView.rebuildUnits();
    w.depotView.setWorld(w.economy, w.layout);
    w.invalidate();
  });
  const look = async (id, d, phi, theta) => {
    await p.evaluate(
      ({ id, d, phi, theta }) => {
        const w = window.woodrail;
        const v = new w.camera.position.constructor();
        w.trainView.carObject(id).getWorldPosition(v);
        w.director.glideTo(v.setY(v.y + 12), d, { phi, theta, duration: 0.1 });
      },
      { id, d, phi, theta },
    );
    await p.waitForTimeout(500);
    await settle();
  };
  for (const n of COUNTS) {
    await p.evaluate(
      ({ cars, goods, n }) => {
        const w = window.woodrail;
        cars.forEach((id, k) => w.economy.setCargo(id, goods[k], n));
        w.invalidate();
      },
      { cars, goods: CARS.map(([, g]) => g), n },
    );
    await settle();
    const drawn = await p.evaluate(() => {
      const w = window.woodrail;
      return { calls: (w.renderer ?? w.view?.renderer).info.render.calls, triangles: w.renderer.info.render.triangles };
    });
    console.log(`${n} a wagon: ${drawn.calls} draw calls, ${drawn.triangles} triangles (the last frame)`);
    for (let k = 0; k < cars.length; k++) {
      await look(cars[k], 150, 0.95, 0.55);
      await shot(`${CARS[k][0]}-${CARS[k][1]}-${n}`);
      // From higher up, the top of the load.
      await look(cars[k], 170, 0.5, 0.55);
      await shot(`${CARS[k][0]}-${CARS[k][1]}-${n}-top`);
    }
    for (let at = 0; at < cars.length; at += 5) {
      await look(cars[Math.min(at + 2, cars.length - 1)], 420, 0.9, 0.4);
      await shot(`train-${at / 5 + 1}-${n}`);
    }
  }
  console.log(`pictures in ${OUT}`);
} finally {
  await b.close();
  await server.close();
}
