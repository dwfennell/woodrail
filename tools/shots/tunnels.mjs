// Pictures of the tunnels prototype (docs/superpowers/specs/2026-11-04-tunnels.md), on a 390×844 phone:
// - a line bored through a hill two levels high (`planTunnel`: plain straights, in at one side, out at the other), a
//   train going in (its cars in the tunnel drawn as ghosts through the hill) and the far portal;
// - cut and cover: a line down a tunnel mouth two levels into the board, under another line on the felt, and back up;
// - the dashes painted over each tunnel.
// Built by the editor and the land editor (harness shortcuts, for looking, not testing), each piece checked first by
// the game's own track rules with tunnels on. Trains are run by the sim's own ticks.
//
// Usage: node tools/shots/tunnels.mjs [<out dir>]   (default out: e2e-out/tunnels)
import { existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/tunnels";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5374, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const QUALITY = Number(process.env.JPEG_QUALITY ?? 72);
const snap = async (name) => {
  await p.screenshot({ path: `${OUT}/${name}`, type: "jpeg", quality: QUALITY, timeout: 240000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  if (existsSync(`${OUT}/${name}`)) console.log(`${name}: ${Math.round(statSync(`${OUT}/${name}`).size / 1024)} KB`);
};
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
await p.goto(`${PAGE}/#seed-24`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// Tunnels on (the prototype's switch; in Game mode, the Tunnels research).
await p.evaluate(async () => {
  const { setTunnels } = await import("/src/landscape/hill-shape.ts");
  setTunnels(true);
});

// 1. A hill two levels high (three in its middle) raised on open felt, and a line bored through it.
const hill = await p.evaluate(async () => {
  const w = window.woodrail;
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { planTunnel } = await import("/src/game/tunnel-dig.ts");
  const { plotSlotOf } = await import("/src/landscape/edit.ts");
  const rules = w.interaction.rules;
  const g = w.landscape.grid;
  const t = w.controls.target;
  // Open felt 22 squares along x and 9 across, every square clear for track.
  for (let d = 0; d < 9000; d += 72) {
    for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
      const X = Math.round((t.x + d * Math.cos(a) - 800) / 72) * 72;
      const Z = Math.round((t.z + d * Math.sin(a)) / 72) * 72 + 36;
      let ok = true;
      for (let x = X + 36; x <= X + 22 * 72 && ok; x += 72)
        for (let z = Z - 4 * 72; z <= Z + 4 * 72 && ok; z += 72) {
          const i = g.cellAtWorld(x, z);
          if (i === -1 || g.height[i] !== 0 || trackBlock(rules, "straight-54", false, { x: x - 27, z, heading: 0 }, 0, -1) !== null) ok = false;
        }
      if (!ok) continue;
      const editor = w.interaction.landEditor();
      // The hill: squares 7 to 13 along, 3 either side of the line; a level more in its middle; a shoulder one level
      // high beside the line (not over it) so it isn't a plain box.
      const raise = [];
      for (let c = 7; c <= 13; c++)
        for (let r = -3; r <= 3; r++) {
          let h = 2;
          if (c >= 9 && c <= 11 && Math.abs(r) <= 1) h = 3;
          if ((c === 7 || c === 13) && Math.abs(r) === 3) h = 1;
          if (c === 13 && r === -2) h = 1;
          raise.push([g.cellAtWorld(X + c * 72 + 36, Z + r * 72), h]);
        }
      if (raise.some(([i]) => i === -1 || editor.check(i, 1) !== null)) continue;
      for (let level = 1; level <= 3; level++) for (const [i, h] of raise) if (h >= level) editor.apply(i, 1);
      w.editLand([...new Set(raise.map(([i]) => plotSlotOf(i)))]);
      // The line: two long straights up to the hill, then the bore from there.
      const approach = [0, 216].map((x) => ({ type: "straight-216", pose: { x: X + x, z: Z, heading: 0 }, y: 0, flipped: false }));
      const plan = planTunnel(rules, { x: X + 432, z: Z, heading: 0 }, 0);
      if (plan.kind !== "bore") { const { hillsOf } = await import("/src/landscape/hill-shape.ts"); const prof = []; for (let x = X + 432; x < X + 1100; x += 36) prof.push(hillsOf(g).groundAt(x, Z)); return { refused: plan, prof, hts: raise.map(([i]) => g.height[i]).join("") }; }
      const after = { x: X + 432 + plan.length, z: Z };
      const beyond = [0, 216].map((x) => ({ type: "straight-216", pose: { x: after.x + x, z: Z, heading: 0 }, y: 0, flipped: false }));
      const all = [...approach, ...plan.pieces, ...beyond];
      const whys = all.map((q) => trackBlock(rules, q.type, q.flipped, q.pose, q.y, -1));
      const ids = w.editor().placeRun(all);
      // The same straight with tunnels off: what the rules say today.
      const { setTunnels } = await import("/src/landscape/hill-shape.ts");
      setTunnels(false);
      const today = trackBlock(rules, "straight-216", false, { x: X + 504, z: Z, heading: 0 }, 0, new Set(ids));
      setTunnels(true);
      // A slanting line into the hill, and one under the shoulder: refused, and why.
      const slant = planTunnel(rules, { x: X + 432, z: Z - 140, heading: 0.3 }, 0);
      const shoulder = planTunnel(rules, { x: X + 380, z: Z + 3 * 72, heading: 0 }, 0);
      return { X, Z, ids, whys, inside: plan.inside, length: plan.length, pieces: plan.pieces.map((q) => q.type), today, slant, shoulder, portals: w.tunnelsView.found.portals.length, dashes: w.tunnelsView.found.dashes.length };
    }
  }
  return null;
});
console.log("hill:", JSON.stringify(hill));
if (!hill?.ids) throw new Error("no hill tunnel");

// 2. Cut and cover: a line along x down a tunnel mouth, two levels under the felt for 432, up another; a line along
// z on the felt across it over the tunnel.
const cover = await p.evaluate(async () => {
  const w = window.woodrail;
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const rules = w.interaction.rules;
  const t = w.controls.target;
  const plan = (X, Z) => {
    const mid = X + 432 + 288 + 216;
    const lower = [
      { type: "straight-216", pose: { x: X, z: Z, heading: 0 }, y: 0, flipped: false },
      { type: "straight-216", pose: { x: X + 216, z: Z, heading: 0 }, y: 0, flipped: false },
      { type: "tunnel-mouth", pose: { x: X + 432, z: Z, heading: 0 }, y: 0, flipped: false },
      { type: "straight-216", pose: { x: X + 720, z: Z, heading: 0 }, y: -96, flipped: false },
      { type: "straight-216", pose: { x: X + 936, z: Z, heading: 0 }, y: -96, flipped: false },
      // Back up: a mouth turned round (its low end towards the tunnel), flipped so its ends fit.
      { type: "tunnel-mouth", pose: { x: X + 1440, z: Z, heading: Math.PI }, y: 0, flipped: true },
      { type: "straight-216", pose: { x: X + 1440, z: Z, heading: 0 }, y: 0, flipped: false },
      { type: "straight-216", pose: { x: X + 1656, z: Z, heading: 0 }, y: 0, flipped: false },
    ];
    const upper = [-324, -108, 108].map((dz) => ({ type: "straight-216", pose: { x: mid, z: Z + dz, heading: Math.PI / 2 }, y: 0, flipped: false }));
    return { lower, upper, mid };
  };
  const tally = {};
  for (let d = 0; d < 9000; d += 72) {
    for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
      const X = Math.round((t.x + d * Math.cos(a) - 900) / 18) * 18;
      const Z = Math.round((t.z + d * Math.sin(a)) / 18) * 18;
      const { lower, upper, mid } = plan(X, Z);
      // Open felt round it, for a clear look (no hill beside the cutting).
      let open = true;
      const g = w.landscape.grid;
      for (let x = X + 360; x <= X + 1520 && open; x += 36)
        for (let z = Z - 108; z <= Z + 108 && open; z += 36) {
          const i = g.cellAtWorld(x, z);
          if (i === -1 || g.height[i] !== 0) open = false;
        }
      if (!open) continue;
      const all = [...lower, ...upper];
      const whys = all.map((q) => trackBlock(rules, q.type, q.flipped, q.pose, q.y, -1));
      if (whys.some((x) => x !== null)) {
        whys.forEach((x, i) => x && (tally[`${all[i].type}@${all[i].y}:${x}`] = (tally[`${all[i].type}@${all[i].y}:${x}`] ?? 0) + 1));
        continue;
      }
      const lo = w.editor().placeRun(lower);
      const why = upper.map((q) => trackBlock(rules, q.type, q.flipped, q.pose, q.y, -1));
      const up = w.editor().placeRun(upper);
      const joints = w.layout.jointCount;
      return { X, Z, mid, lo, up, why, joints, portals: w.tunnelsView.found.portals.length };
    }
  }
  return { tally };
});
console.log("cut and cover:", JSON.stringify(cover));
if (!cover?.lo) throw new Error("no room for cut and cover");

const look = async (name, at, from, dist) => {
  await p.evaluate(
    ({ at, from, dist }) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const target = new V(at[0], at[1], at[2]);
      const dir = new V(from[0], from[1], from[2]).normalize();
      w.controls.target.copy(target);
      w.camera.position.copy(target.clone().add(dir.multiplyScalar(dist)));
      w.camera.lookAt(target);
      w.controls.update?.();
      w.invalidate?.();
    },
    { at, from, dist },
  );
  await settle();
  await p.waitForTimeout(400);
  await settle();
  if (name) await snap(name);
};

// Trains: on the hill line, an engine and three coaches; on the cut-and-cover line, a goods train; on the top line, a
// short train.
const trains = await p.evaluate(({ hill, cover }) => {
  const w = window.woodrail;
  const add = (kinds, pieceId, s) => {
    const r = w.sim.addTrain(kinds, { pieceId, pathIndex: 0, s, reversed: false });
    return r.kind === "placed" ? w.sim.getTrain(r.trainId).cars.map((c) => c.id) : r;
  };
  const a = add(["engine", "passenger", "passenger", "caboose"], hill.ids[2], 40);
  const b = add(["engine", "timber", "hopper"], cover.lo[1], 60);
  w.trainView.sync?.();
  w.invalidate?.();
  return { a, b };
}, { hill, cover });
console.log("trains:", JSON.stringify(trains));

/** Run the sim's ticks with a train's lever forward until its engine is `past` mm along x past `x`, or ticks run out. */
const runTo = (ids, x, ticks = 4000) =>
  p.evaluate(
    async ({ ids, x, ticks }) => {
      const w = window.woodrail;
      const { createSnapshot } = await import("/src/sim/sim.ts");
      const s = createSnapshot();
      w.sim.setLever(ids[0], 1);
      let at = null;
      const lowest = {};
      for (let k = 0; k < ticks; k++) {
        w.sim.tick();
        w.sim.writeSnapshot(s);
        for (let c = 0; c < s.count; c++) lowest[s.ids[c]] = Math.min(lowest[s.ids[c]] ?? Infinity, Math.round(s.transforms[c * 6 + 1]));
        const i = [...s.ids.slice(0, s.count)].indexOf(ids[0]);
        if (i >= 0 && s.transforms[i * 6] >= x) {
          at = { x: Math.round(s.transforms[i * 6]), y: Math.round(s.transforms[i * 6 + 1]), k };
          break;
        }
      }
      w.sim.setLever(ids[0], 0);
      for (let k = 0; k < 400; k++) w.sim.tick();
      w.invalidate?.();
      return { at, lowest };
    },
    { ids, x, ticks },
  );

const hy = 40;
await look(null, [hill.X + 560, hy, hill.Z], [-1, 0.8, 0.55], 900);
await p.waitForTimeout(3000);
// The hill: the engine and its first coach gone in.
const r1 = await runTo(trains.a, hill.X + 504 + 140);
console.log("hill train in:", JSON.stringify(r1));
await look("tunnels-hill-enter.jpg", [hill.X + 560, hy, hill.Z], [-1, 0.8, 0.55], 900);
// The far portal: the train coming out.
const r2 = await runTo(trains.a, hill.X + 1004 + 60);
console.log("hill train out:", JSON.stringify(r2));
await look("tunnels-hill-far.jpg", [hill.X + 930, hy, hill.Z], [1, 0.85, -0.55], 820);

// Cut and cover: the goods train going down the mouth, its engine in the tunnel.
const r0 = await runTo(trains.b, cover.X + 720 + 50);
console.log("cut-and-cover train in:", JSON.stringify(r0));
await look("tunnels-mouth.jpg", [cover.X + 620, -30, cover.Z], [-1, 1.1, 0.75], 620);
// Cut and cover: the goods train under the top line.
const r3 = await runTo(trains.b, cover.mid + 40);
console.log("cut-and-cover train under:", JSON.stringify(r3));
const top = await p.evaluate(({ cover }) => {
  const w = window.woodrail;
  const r = w.sim.addTrain(["engine", "passenger"], { pieceId: cover.up[1], pathIndex: 0, s: 30, reversed: false });
  w.invalidate?.();
  return r;
}, { cover });
console.log("top train:", JSON.stringify(top));
await look("tunnels-cut-cover.jpg", [cover.mid - 60, 0, cover.Z], [-0.55, 1.05, 0.9], 1150);
// Close on the felt over the tunnel: the dashes and the ghost of the goods train under it.
await look("tunnels-xray.jpg", [cover.mid + 40, 0, cover.Z], [0.25, 1.2, 0.75], 560);

// Costs: the tunnel rules on a pointer move (a straight held into the hill), the tunnels found again on a track
// change, the cuttings set again (every plain straight now may cut a hill).
const costs = await p.evaluate(async ({ hill }) => {
  const w = window.woodrail;
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { syncCuttings } = await import("/src/landscape/cuttings.ts");
  const { setTunnels } = await import("/src/landscape/hill-shape.ts");
  const rules = w.interaction.rules;
  const time = (f, n) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) f(i);
    return Math.round(((performance.now() - t0) / n) * 1000) / 1000;
  };
  const held = (i) => trackBlock(rules, "straight-216", false, { x: hill.X + 480 + (i % 7), z: hill.Z, heading: 0 }, 0, -1);
  const on = time(held, 300);
  setTunnels(false);
  const off = time(held, 300);
  const cutsOff = time(() => syncCuttings(w.landscape, w.layout), 20);
  setTunnels(true);
  const cutsOn = time(() => syncCuttings(w.landscape, w.layout), 20);
  const found = time(() => w.tunnelsView.sync(w.layout, w.landscape), 20);
  return { pieces: w.layout.pieceCount ?? [...w.layout.pieceIds()].length, heldOn: on, heldOff: off, cutsOff, cutsOn, tunnelsSync: found };
}, { hill });
console.log("costs (ms):", JSON.stringify(costs));

// Idle: nothing moving, no frames.
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await w.settled?.(3);
  const before = w.renderer.info.render.frame;
  await new Promise((r) => setTimeout(r, 2000));
  return w.renderer.info.render.frame - before;
});
console.log(`frames drawn in 2 s idle: ${idle}`);
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no page errors");
await b.close();
await server.close();
