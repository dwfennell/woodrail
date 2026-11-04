// Pictures for choosing how dark shadows are (`src/render/shadow-strength.ts`): the same three views (a town, a train on
// a busy stretch of track, hills) on a 390×844 phone at each strength, through the dev-only `?shadows=` override.
// The map is a saved bug-report map (`src/play/bugmaps`), loaded through the dev-only `#load=`.
//
// Usage: node tools/shots/shadows.mjs [<out dir>] [strengths]   (default out: e2e-out/shadows; strengths: before,bit,lighter,much)
//   VIEWS='{"name":{x,z,dist,phi}}' for other views; EXPLORE=1 prints the map's towns, trains and hills instead.
//   PNGs; the committed JPEGs in docs/agents/shots are these compressed to about 130 KB.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/shadows";
const STRENGTHS = (process.argv[3] ?? "before,bit,lighter,much").split(",");
const MAP = readFileSync(
  `${ROOT}/src/play/bugmaps/${process.env.MAP ?? "goals-long-ran-through-stop"}.txt`,
  "utf8",
).trim();
mkdirSync(OUT, { recursive: true });
const server = await createServer({
  root: ROOT,
  configFile: `${ROOT}/vite.config.ts`,
  server: { port: 5391, strictPort: false },
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
const phone = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
};

async function open(strength) {
  const ctx = await b.newContext(phone);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(`${PAGE}?shadows=${strength}#load=${encodeURIComponent(MAP)}`);
  await p.waitForFunction(
    () =>
      window.woodrail?.mode?.() &&
      !window.woodrail.title.shown &&
      !!document.querySelector("#loading.done"),
    null,
    { timeout: 240000 },
  );
  await p.keyboard.press("Escape");
  await p.evaluate(() =>
    document.querySelector(".coach:not([hidden]) .coach-skip")?.click(),
  );
  // Pictures of the world alone: the HUD hidden. Paused so a train stands still in the same place each time.
  await p.addStyleTag({
    content: "body > *:not(#scene) { visibility: hidden !important }",
  });
  await p.evaluate(() => {
    window.woodrail.paused = true;
  });
  return { ctx, p };
}
const look = (p, v) =>
  p.evaluate(async (v) => {
    const w = window.woodrail;
    w.director.glideTo(
      new w.camera.position.constructor(v.x, v.y ?? 0, v.z),
      v.dist,
      { duration: 0.05, phi: v.phi, theta: v.theta },
    );
    await new Promise((r) => setTimeout(r, 400));
    await Promise.race([
      w.settled(3),
      new Promise((r) => setTimeout(r, 20000)),
    ]);
  }, v);

if (process.env.EXPLORE) {
  const { p } = await open("before");
  const info = await p.evaluate(() => {
    const w = window.woodrail;
    const L = w.world.landscape;
    return {
      keys: Object.keys(w),
      towns: L.towns.map((t) => ({
        x: Math.round(t.centre.x),
        z: Math.round(t.centre.z),
      })),
      pieces: [...w.layout.pieceIds()].length,
      types: [
        ...new Set(
          [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id).type),
        ),
      ],
      bridges: [...w.layout.pieceIds()]
        .map((id) => w.layout.getPiece(id))
        .filter((q) => /bridge|ramp|viaduct/.test(q.type))
        .slice(0, 6)
        .map(
          (q) => `${q.type}@${Math.round(q.pose.x)},${Math.round(q.pose.z)}`,
        ),
      cam: w.camera.position.toArray().map(Math.round),
      trains: w.sim.trainIds().length,
      hills: (() => {
        const g = L.grid;
        const out = {};
        for (let x = -3000; x < 3000; x += 72)
          for (let z = -3000; z < 3000; z += 72) {
            const i = g.cellAtWorld(x, z);
            if (i >= 0 && g.groundY(i) > 20)
              out[`${Math.round(x / 360) * 360},${Math.round(z / 360) * 360}`] =
                (out[
                  `${Math.round(x / 360) * 360},${Math.round(z / 360) * 360}`
                ] ?? 0) + 1;
          }
        return out;
      })(),
      cars: (() => {
        const out = [];
        w.scene.traverse((o) => {
          if (o.userData?.carId !== undefined && out.length < 8) {
            const v = o.getWorldPosition(new w.camera.position.constructor());
            out.push([
              o.userData.carId,
              Math.round(v.x),
              Math.round(v.y),
              Math.round(v.z),
            ]);
          }
        });
        return out;
      })(),
    };
  });
  console.log(JSON.stringify(info, null, 1));
  await p.screenshot({ path: `${OUT}/explore.png` });
} else {
  // A town, the train on raised track beside hills, the hills with ramps and a bridge (camera target and distance in mm).
  const VIEWS = process.env.VIEWS
    ? JSON.parse(process.env.VIEWS)
    : {
        town: { x: -540, z: 108, dist: 1100, phi: 0.9 },
        train: { x: -760, z: -420, dist: 950, phi: 0.8 },
        hills: { x: 1150, z: -850, dist: 1500, phi: 0.9 },
      };
  for (const s of STRENGTHS) {
    const { ctx, p } = await open(s);
    for (const [name, v] of Object.entries(VIEWS)) {
      await look(p, v);
      await p.screenshot({
        path: `${OUT}/shadows-${s}-${name}.png`,
        timeout: 180000,
      });
      console.log("shot", s, name);
    }
    await ctx.close();
  }
}
await b.close();
await server.close();
