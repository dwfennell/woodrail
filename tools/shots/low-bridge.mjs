// Pictures of the low-bridge prototype: a line on the ground through an underpass (its middle sunk 30 mm into the
// board), a bridge one level up across it drawn as a girder span, and a train with the tallest cars under it. Built by
// the editor (a harness shortcut, for looking, not testing), each piece checked first by the game's own track rules.
//
// Usage: node tools/shots/low-bridge.mjs [<out dir>]   (default out: e2e-out/low-bridge)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/low-bridge";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5373, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1000, height: 720 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (name) => p.screenshot({ path: `${OUT}/${name}`, type: "jpeg", quality: 85, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
await p.goto(`${PAGE}/#seed-24`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

const built = await p.evaluate(async () => {
  const w = window.woodrail;
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { findLowCrossing } = await import("/src/track/overlap.ts");
  const rules = w.interaction.rules;
  // The lower line along x (two straights, the underpass, two straights); the upper along z: a ramp up, a bridge one
  // level up centred over the underpass's middle, a ramp down.
  const plan = (X, Z) => {
    const mid = X + 432 + 144;
    const lower = [
      { type: "straight-216", pose: { x: X, z: Z, heading: 0 }, y: 0, flipped: false },
      { type: "straight-216", pose: { x: X + 216, z: Z, heading: 0 }, y: 0, flipped: false },
      { type: "underpass", pose: { x: X + 432, z: Z, heading: 0 }, y: 0, flipped: false },
      { type: "straight-216", pose: { x: X + 720, z: Z, heading: 0 }, y: 0, flipped: false },
      { type: "straight-216", pose: { x: X + 936, z: Z, heading: 0 }, y: 0, flipped: false },
    ];
    const upper = [
      { type: "ramp", pose: { x: mid, z: Z - 252, heading: Math.PI / 2 }, y: 0, flipped: false },
      { type: "bridge", pose: { x: mid, z: Z - 108, heading: Math.PI / 2 }, y: 48, flipped: false },
      { type: "ramp", pose: { x: mid, z: Z + 252, heading: -Math.PI / 2 }, y: 0, flipped: true },
    ];
    return { lower, upper, mid };
  };
  const t = w.controls.target;
  const tally = {};
  for (let d = 0; d < 6000; d += 72) {
    for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
      const X = Math.round((t.x + d * Math.cos(a) - 576) / 18) * 18;
      const Z = Math.round((t.z + d * Math.sin(a)) / 18) * 18;
      const { lower, upper, mid } = plan(X, Z);
      const all = [...lower, ...upper];
      const whys = all.map((q) => trackBlock(rules, q.type, q.flipped, q.pose, q.y, -1));
      if (whys.some((x) => x !== null)) {
        whys.forEach((x, i) => x && (tally[`${all[i].type}:${x}`] = (tally[`${all[i].type}:${x}`] ?? 0) + 1));
        continue;
      }
      const lo = w.editor().placeRun(lower);
      // The rules again for the upper line, now the lower one is down (it must go over: "headroom" is what refuses it).
      const why = upper.map((q) => trackBlock(rules, q.type, q.flipped, q.pose, q.y, -1));
      const up = w.editor().placeRun(upper);
      // The same bridge one level up over plain straights instead, for comparison (what the rules say, not placed).
      const plainWhy = findLowCrossing(w.layout, "bridge", false, { x: mid, z: Z - 108, heading: Math.PI / 2 }, 48, new Set([...lo, ...up]));
      return { X, Z, mid, lo, up, why, plainWhy };
    }
  }
  return { tally };
});
console.log(JSON.stringify(built));
if (!built?.lo) throw new Error("no open ground");

// The bridge over plain track, as today: the rules' answer.
const today = await p.evaluate(async ({ X, Z, mid }) => {
  const { findLowCrossing } = await import("/src/track/overlap.ts");
  const { Layout } = await import("/src/track/layout.ts");
  const l = new Layout();
  l.addPiece("straight-216", { x: mid - 108, z: Z, heading: 0 }, 0, false);
  return findLowCrossing(l, "bridge", false, { x: mid, z: Z - 108, heading: Math.PI / 2 }, 48, -1);
}, built);
console.log(`a one-level bridge over a plain straight: ${today === -1 ? "allowed" : "refused (headroom)"}; over the underpass: ${built.why.every((x) => x === null) ? "allowed" : JSON.stringify(built.why)}`);

const look = async (name, fromX, fromY, fromZ, atY = 20, dist) =>
  p.evaluate(
    async ({ mid, Z, fromX, fromY, fromZ, atY, dist }) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const at = new V(mid, atY, Z);
      const dir = new V(fromX, fromY, fromZ).normalize();
      w.controls.target.copy(at);
      w.camera.position.copy(at.clone().add(dir.multiplyScalar(dist)));
      w.camera.lookAt(at);
      w.controls.update?.();
      w.invalidate?.();
    },
    { ...built, fromX, fromY, fromZ, atY, dist },
  ).then(async () => {
    await settle();
    await p.waitForTimeout(500);
    await snap(name);
  });

// The trench on its own, before the train comes.
await look("low-bridge-trench.jpg", 1, 1.1, 0.55, 0, 460);

// A train with the tallest cars: the electric engine, a double-decker, a caboose; stopped with the double-decker under the bridge.
const train = await p.evaluate(({ lo }) => {
  const w = window.woodrail;
  const r = w.sim.addTrain(["engine", "passenger", "passenger", "caboose"], { pieceId: lo[2], pathIndex: 0, s: 230, reversed: false });
  if (r.kind !== "placed") return r;
  const tr = w.sim.getTrain(r.trainId);
  const ids = tr.cars.map((c) => c.id);
  w.sim.setLook(ids[0], "electric");
  w.sim.setLook(ids[1], "double-decker");
  w.sim.setLook(ids[2], "double-decker");
  w.trainView?.sync?.();
  w.invalidate?.();
  return { ...r, ids };
}, built);
console.log(JSON.stringify(train));
await settle();

await look("low-bridge-wide.jpg", 0.7, 0.75, 1, 20, 1100);
await look("low-bridge-under.jpg", 1, 0.32, 0.25, 10, 420);
// Run the train on through, by the sim's own ticks: every car goes down into the dip, under the bridge and up out of
// it; the lowest each car's body got, and the highest its top could reach there (its model's height over its base).
const ran = await p.evaluate(async ({ train, mid }) => {
  const w = window.woodrail;
  const { createSnapshot } = await import("/src/sim/sim.ts");
  w.sim.setLever(train.ids[0], 1);
  const snap = createSnapshot();
  const low = new Map();
  for (let k = 0; k < 2400; k++) {
    w.sim.tick();
    w.sim.writeSnapshot(snap);
    for (let c = 0; c < snap.count; c++) {
      const id = snap.ids[c];
      const x = snap.transforms[c * 6];
      const y = snap.transforms[c * 6 + 1];
      if (Math.abs(x - mid) < 20) low.set(id, Math.min(low.get(id) ?? Infinity, y));
    }
  }
  w.sim.setLever(train.ids[0], 0);
  w.invalidate?.();
  return { underBridgeY: Object.fromEntries([...low].map(([id, y]) => [id, Math.round(y * 10) / 10])) };
}, { train, mid: built.mid });
console.log(`cars' track base under the bridge (deck base at 48): ${JSON.stringify(ran)}`);
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no page errors");
await b.close();
await server.close();
