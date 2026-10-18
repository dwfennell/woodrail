// End-to-end loop-the-loop show in Sandbox (`npm run e2e:loop`): a line built with the loop kit in it, a train stepped
// across (sim and economy ticked directly, the trains and the show updated by hand as the frame loop would: headless
// frames are slow), pictures of the copy part way round and at the top of the loop, then idle frames with the kit in
// view. Phone-sized (390×844).
//
// Usage: npm run e2e:loop [-- <out dir>]   (default out: e2e-out/loop)
// Starts its own dev server (on 5352, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/loop";
/** Seconds to count idle frames over (each case). */
const IDLE_S = Number(process.env.IDLE_S ?? 30);
mkdirSync(OUT, { recursive: true });
const started = Date.now();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5352, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
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
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((b) => !b.hidden && b.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

/** Frames drawn over `s` seconds once the scene has settled. */
const idleFrames = (s) =>
  p.evaluate(async (s) => {
    const w = window.woodrail;
    w.invalidate();
    await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
    await new Promise((r) => setTimeout(r, 1000));
    const f0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, s * 1000));
    return w.framesDrawn - f0;
  }, s);

// Helpers in the page (as tools/e2e/track-props.mjs has them).
await p.evaluate(() => {
  const w = window.woodrail;
  w.__build = async (seq, nextEnd = {}) => {
    const i = w.interaction;
    const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    for (let ring = 1; ring < 20; ring++)
      for (let k = 0; k < 16; k++)
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const a = (k * Math.PI) / 8;
          let t = { x: Math.round((Math.cos(a) * ring * 360) / 18) * 18, z: Math.round((Math.sin(a) * ring * 360) / 18) * 18, heading };
          const ids = [];
          let ok = true;
          for (const type of seq) {
            const pose = { x: t.x, z: t.z, heading: t.heading };
            const r = i.placement(type, false, pose, 0, -1);
            if (r.reason) {
              ok = false;
              w.__lastWhy = `${type}: ${r.reason}`;
              break;
            }
            const id = w.editor().place(type, pose, 0, false);
            ids.push(id);
            const end = nextEnd[type] ?? 1;
            if (end >= 0) t = c(id, end);
          }
          if (ok) {
            for (const type of seq) if (type.startsWith("kit-")) await w.kitView.load(type);
            w.syncKits(true);
            return { ids };
          }
          for (const id of ids.reverse()) w.editor().remove(id);
        }
    return null;
  };
  // Step the world n ticks (the game's own loop paused), the cars and the show updated as the frame loop would.
  w.__step = (n, each) => {
    w.paused = true;
    for (let k = 0; k < n; k++) {
      w.sim.tick();
      w.economy.tick();
      w.sim.writeSnapshot(w.snapshot);
      w.trainView.update(w.snapshot, 1 / 120);
      w.__last = w.loopShow.update(w.snapshot, w.trainView, w.camera);
      if (each && each(k) === true) return k;
    }
    return n;
  };
  // Look at the loop face on, from across the line (the loop's plane is along it, 80 to its left).
  w.__look = (pieceId, dist) => {
    const pose = w.layout.getPiece(pieceId).pose;
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    const x = pose.x + c * 108 - s * 60;
    const z = pose.z + s * 108 + c * 60;
    w.controls.target.set(x, 50, z);
    w.camera.position.set(x + s * dist, 50 + dist * 0.45, z - c * dist);
    w.controls.update();
    w.invalidate();
  };
  w.__clear = () => {
    for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
  };
  /** The copy's up (world), and the share of the engine's way across, if a show is on at `kit`. */
  w.__copy = (kit) => {
    const copy = w.loopShow.copyAt(kit);
    if (!copy) return null;
    copy.updateWorldMatrix(true, false);
    const up = new w.camera.position.constructor(0, 1, 0).transformDirection(copy.matrixWorld);
    const at = new w.camera.position.constructor().setFromMatrixPosition(copy.matrixWorld);
    return { upY: up.y, y: at.y, visible: copy.visible };
  };
});

// Before: idle frames with no loop on the map.
const before = await idleFrames(IDLE_S);
console.log(`idle frames over ${IDLE_S} s before any loop kit:`, before);

const built = await p.evaluate(() =>
  window.woodrail.__build(["buffer-turnback", "straight-216", "straight-216", "kit-loop-the-loop", "straight-216", "straight-216", "buffer-turnback"], { "buffer-turnback": 0 }),
);
check("built a line with the loop-the-loop", !!built, built ? JSON.stringify(built) : await p.evaluate(() => window.woodrail.__lastWhy));
if (built) {
  const [, s1, , kit, after] = built.ids;
  await p.evaluate(() => window.woodrail.__clear());
  const placed = await p.evaluate(
    ({ s1 }) => {
      const w = window.woodrail;
      const r = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: s1, pathIndex: 0, reversed: false, s: 200 });
      if (r.kind !== "placed") return null;
      const t = w.sim.getTrain(r.trainId);
      const engine = t.cars.find((c) => c.kind === "engine").id;
      w.sim.setLever(engine, 1);
      w.__engine = engine;
      return { train: r.trainId, engine };
    },
    { s1 },
  );
  check("a train on the line", !!placed);
  await p.evaluate((id) => window.woodrail.__look(id, 520), kit);
  await p.waitForTimeout(3000);
  // Up to part way round the loop (the copy climbing its far side): a picture.
  const first = await p.evaluate(
    ({ kit }) => {
      const w = window.woodrail;
      let started = -1;
      let hidden = false;
      const k = w.__step(120 * 20, (k) => {
        if (started < 0 && w.loopShow.showing(kit) !== -1) started = k;
        const obj = w.trainView.carObject(w.__engine);
        if (obj && !obj.visible) hidden = true;
        const c = w.__copy(kit);
        // A quarter round: the copy on its side, climbing.
        return !!c && c.visible && Math.abs(c.upY) < 0.15 && c.y > 50;
      });
      return { started, k, hidden, copy: w.__copy(kit), last: w.__last };
    },
    { kit },
  );
  check("the show starts as the engine comes on: the engine goes, its copy climbs the loop", first.started >= 0 && first.hidden && !!first.copy, JSON.stringify(first));
  await p.evaluate(() => window.woodrail.invalidate());
  await p.waitForTimeout(3000);
  await shot("loop-mid-way");
  const top = await p.evaluate(
    ({ kit }) => {
      const w = window.woodrail;
      const k = w.__step(120 * 10, () => {
        const c = w.__copy(kit);
        return !!c && c.upY < -0.98;
      });
      return { k, copy: w.__copy(kit) };
    },
    { kit },
  );
  check("the copy goes over the top upside down", !!top.copy && top.copy.upY < -0.98 && top.copy.y > 100, JSON.stringify(top));
  await p.evaluate(() => window.woodrail.invalidate());
  await p.waitForTimeout(3000);
  await shot("loop-top");
  // On to the end: the show ends at the far end, the engine whole again; the train comes out the far end at speed.
  const end = await p.evaluate(
    ({ kit, after }) => {
      const w = window.woodrail;
      let ended = -1;
      let endedOn = -1;
      let movingShows = 0;
      const k = w.__step(120 * 30, (k) => {
        if (w.__last === "moving") movingShows++;
        const t = w.sim.getTrain(w.sim.trainIds()[0]);
        if (ended < 0 && w.loopShow.showing(kit) === -1) {
          ended = k;
          // Where the engine (the first car) was when its show ended: its front axle past the kit.
          endedOn = t.bogies[0].pieceId;
        }
        // The whole train out past the kit, at speed.
        return ended >= 0 && t.bogies.every((b) => b.pieceId === after || b.pieceId === after + 1) && t.speed >= 119;
      });
      const obj = w.trainView.carObject(w.__engine);
      const t = w.sim.getTrain(w.sim.trainIds()[0]);
      return { ended, endedOn, k, movingShows, engine: obj ? { visible: obj.visible, scale: obj.scale.x } : null, copies: w.loopShow.group.children.length, speed: t.speed, on: t.bogies.map((b) => b.pieceId) };
    },
    { kit, after },
  );
  check("the show ends at the far end: no copy left, the engine whole", end.ended >= 0 && end.endedOn === after && end.copies === 0 && end.engine?.visible === true && end.engine.scale === 1, JSON.stringify(end));
  check("the train comes out the far end at speed", end.on.every((id) => id === after || id === after + 1) && end.speed >= 119);
  await p.evaluate(() => {
    window.woodrail.paused = false;
  });

  // Idle frames, the kit in view: no trains; a train standing mid-show; the game paused mid-show.
  await p.evaluate(() => window.woodrail.__clear());
  await p.evaluate((id) => window.woodrail.__look(id, 520), kit);
  const none = await idleFrames(IDLE_S);
  // The same with the show's hook off (as if there were no loop kit).
  await p.evaluate(() => Object.defineProperty(window.woodrail.loopShow, "count", { get: () => 0, configurable: true }));
  const noneWithout = await idleFrames(IDLE_S);
  await p.evaluate(() => delete window.woodrail.loopShow.count);
  const standing = await p.evaluate(
    ({ s1, kit }) => {
      const w = window.woodrail;
      const r = w.sim.addTrain(["engine", "passenger"], { pieceId: s1, pathIndex: 0, reversed: false, s: 200 });
      const engine = w.sim.getTrain(r.trainId).cars.find((c) => c.kind === "engine").id;
      w.sim.setLever(engine, 1);
      w.__engine = engine;
      w.__step(120 * 20, () => {
        const c = w.__copy(kit);
        return !!c && c.visible && c.upY < 0;
      });
      w.sim.setLever(engine, 0);
      w.__step(120 * 3);
      w.paused = false;
      return { running: w.loopShow.running, speed: w.sim.getTrain(r.trainId).speed };
    },
    { s1, kit },
  );
  const stood = await idleFrames(IDLE_S);
  const paused = await p.evaluate(() => {
    const w = window.woodrail;
    w.sim.setLever(w.__engine, 1);
    w.paused = true;
    return w.loopShow.running;
  });
  const pausedFrames = await idleFrames(IDLE_S);
  console.log(`idle frames over ${IDLE_S} s, the loop in view:`, { before, none, noneWithout, standing: stood, paused: pausedFrames });
  check(`idle, the loop in view, no trains: no more frames in ${IDLE_S} s than before it was built, or with its hook off`, none <= Math.min(before, noneWithout), JSON.stringify({ before, none, noneWithout }));
  check(`a train standing mid-show (the show on): no frames in ${IDLE_S} s`, standing.running && standing.speed === 0 && stood <= before, JSON.stringify({ standing, stood }));
  check(`paused mid-show, the train's lever on: no frames in ${IDLE_S} s`, paused && pausedFrames <= before, String(pausedFrames));
  // The cost of an update with a show on (the frame loop's, every frame while one runs).
  const cost = await p.evaluate(() => {
    const w = window.woodrail;
    const n = 20000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) w.loopShow.update(w.snapshot, w.trainView, w.camera);
    return Math.round(((performance.now() - t0) / n) * 1000 * 100) / 100;
  });
  console.log("LoopShowView.update with a show on (µs):", cost);
  check("an update with a show on costs well under a millisecond", cost < 100, String(cost));
  await p.evaluate(() => {
    window.woodrail.paused = false;
  });
}

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(failures ? `${failures} FAILED` : "ALL PASS", `(${Math.round((Date.now() - started) / 1000)} s)`);
await b.close();
await server.close();
process.exit(failures ? 1 : 0);
