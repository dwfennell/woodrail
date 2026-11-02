// End-to-end hopper loads (`npm run e2e:hopper-load [-- <out dir>]`), in Sandbox, headless: hoppers placed on a line
// show their open, empty bins (no modelled coal, no heap); loaded, each shows one heap of what it carries (coal black,
// grain gold, ore rusty, stone grey), higher the fuller it is; unloaded again, the heap goes. Pictures of empty, a
// third, two thirds and full hoppers of two goods go to the out dir (docs/agents/shots/hopper-*.jpg were cut from them).
//
// Harness shortcut (named): the loads are set with `economy.setCargo`, not by a loader: what's under test is how a
// load looks, not how it gets there (e2e:warehouse and the play-through carry goods by the player's path).
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/hopper-load";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 720, height: 420 } });
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
// Pictures of the world alone (the HUD and tray hidden for them, put back after).
const shot = (n) =>
  p
    .addStyleTag({ content: "body.hl-shot * { visibility: hidden } body.hl-shot canvas { visibility: visible }" })
    .then(() => p.evaluate(() => document.body.classList.add("hl-shot")))
    .then(() => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }))
    .catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`))
    .finally(() => p.evaluate(() => document.body.classList.remove("hl-shot")));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

try {
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((b) => !b.hidden && b.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();

  // A straight line somewhere clear, and a train of an engine and seven hoppers on it, standing.
  const built = await p.evaluate(() => {
    const w = window.woodrail;
    const i = w.interaction;
    const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    for (let ring = 1; ring < 20; ring++)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        let t = { x: Math.round((Math.cos(a) * ring * 360) / 18) * 18, z: Math.round((Math.sin(a) * ring * 360) / 18) * 18, heading: 0 };
        const ids = [];
        let ok = true;
        for (let n = 0; n < 5; n++) {
          const pose = { x: t.x, z: t.z, heading: t.heading };
          if (i.placement("straight-216", false, pose, 0, -1).reason) {
            ok = false;
            break;
          }
          const id = w.editor().place("straight-216", pose, 0, false);
          ids.push(id);
          t = c(id, 1);
        }
        if (ok) return { ids };
        for (const id of ids.reverse()) w.editor().remove(id);
      }
    return null;
  });
  check("a clear line for the train", !!built);
  const cars = await p.evaluate((ids) => {
    const w = window.woodrail;
    const r = w.sim.addTrain(["engine", "hopper", "hopper", "hopper", "hopper", "hopper", "hopper", "hopper"], { pieceId: ids[4], pathIndex: 0, reversed: false, s: 200 });
    if (r.kind !== "placed") return null;
    w.changed?.();
    w.invalidate();
    return w.sim.getTrain(w.sim.trainIds().at(-1)).cars.filter((c) => c.kind === "hopper").map((c) => c.id);
  }, built.ids);
  check("a train of seven hoppers placed", cars?.length === 7);
  await settle();

  /** What's drawn for the hoppers: heap instances by goods, and whether any modelled coal shows. */
  const drawn = () =>
    p.evaluate((cars) => {
      const w = window.woodrail;
      const heaps = Object.fromEntries(Object.entries(w.depotView.heaps).map(([k, u]) => [k, u.parts[0].count]));
      let coal = 0;
      for (const id of cars)
        w.trainView.carObject(id)?.traverse((o) => {
          if (o.name.startsWith("coal") && o.visible && o.isMesh) coal++;
        });
      return { heaps, coal };
    }, cars);
  const look = async (from, at = 3) => {
    await p.evaluate(
      ({ id, from }) => {
        const w = window.woodrail;
        w.interaction.clearSelection?.();
        w.hud.hideCards?.();
        const o = w.trainView.carObject(id);
        const v = new w.camera.position.constructor();
        o.getWorldPosition(v);
        w.director.glideTo(v.setY(30), from.d, { phi: from.phi, theta: from.theta, duration: 0.1 });
      },
      { id: cars[at], from },
    );
    await p.waitForTimeout(600);
    await settle();
  };

  const empty = await drawn();
  check("placed empty in Sandbox: no heap, no modelled coal", Object.values(empty.heaps).every((n) => n === 0) && empty.coal === 0, JSON.stringify(empty));
  // The train runs along x: look across it from a little above.
  const view = { d: 640, phi: 0.7, theta: 0.3 };
  await look(view);
  await shot("hopper-empty");

  const loads = [null, ["coal", 1], ["coal", 2], ["coal", 3], ["grain", 1], ["grain", 2], ["grain", 3]];
  await p.evaluate(
    ({ cars, loads }) => {
      const w = window.woodrail;
      cars.forEach((id, k) => loads[k] && w.economy.setCargo(id, loads[k][0], loads[k][1]));
      w.invalidate();
    },
    { cars, loads },
  );
  await settle();
  const loaded = await drawn();
  check("loaded: three coal heaps and three grain heaps, one empty bin", loaded.heaps.coal === 3 && loaded.heaps.grain === 3 && loaded.coal === 0, JSON.stringify(loaded));
  const ys = await p.evaluate((cars) => {
    const w = window.woodrail;
    const u = w.depotView.heaps.coal.parts[0];
    const m = new w.camera.matrix.constructor();
    const v = new w.camera.position.constructor();
    return [0, 1, 2].map((k) => (u.getMatrixAt(k, m), v.setFromMatrixPosition(m).y));
  }, cars);
  check("the coal heaps rise with the load (1, 2, 3)", ys[0] < ys[1] && ys[1] < ys[2], ys.map((y) => y.toFixed(1)).join(" < "));
  await look(view);
  await shot("hopper-loads");
  await look({ d: 330, phi: 0.6, theta: 0.25 });
  await shot("hopper-loads-close");

  // Ore and stone, full, beside an empty one.
  await p.evaluate((cars) => {
    const w = window.woodrail;
    w.economy.setCargo(cars[1], "ore", 3);
    w.economy.setCargo(cars[2], "stone", 3);
    w.economy.setCargo(cars[3], "coal", 0);
    w.invalidate();
  }, cars);
  await settle();
  await look({ d: 330, phi: 0.6, theta: 0.25 }, 2);
  await shot("hopper-ore-stone");
  const after = await drawn();
  check("ore and stone heaps; the unloaded hopper's heap gone", after.heaps.ore === 1 && after.heaps.stone === 1 && after.heaps.coal === 0, JSON.stringify(after));

  // With Game mode's modelled heaps (fetched as Game mode does: `loadGameModels`, then the goods rebuilt).
  await p.evaluate((cars) => {
    const w = window.woodrail;
    w.economy.setCargo(cars[1], "coal", 1);
    w.economy.setCargo(cars[2], "coal", 2);
    w.economy.setCargo(cars[3], "coal", 3);
  }, cars);
  await p.evaluate(async () => {
    const w = window.woodrail;
    await (await import("/src/render/blender-models.ts")).loadGameModels();
    w.depotView.rebuildUnits();
    w.depotView.setWorld(w.economy, w.layout);
    w.invalidate();
  });
  await settle();
  const modelled = await drawn();
  check("Game mode's heaps: the same counts", modelled.heaps.coal === 3 && modelled.heaps.grain === 3 && modelled.coal === 0, JSON.stringify(modelled));
  await look(view);
  await shot("hopper-loads-game");
  await look({ d: 330, phi: 0.6, theta: 0.25 });
  await shot("hopper-loads-game-close");

  // Idle with loads: no frames asked for (the loads' look is redrawn only when it changes).
  const idle = await p.evaluate(async () => {
    const w = window.woodrail;
    await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
    await new Promise((r) => setTimeout(r, 1000));
    const f0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 5000));
    return w.framesDrawn - f0;
  });
  check("idle with loaded hoppers: no frames drawn", idle <= 1, `${idle} frames over 5 s`);
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  failures++;
  console.log("FAIL (threw)", e.message);
} finally {
  await b.close();
  await server.close();
}
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
