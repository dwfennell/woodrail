// Pictures of bridges meeting hills: a bridge, a curved bridge and the stone viaduct across a river at a hill's edge,
// from the low ground up onto a hilltop (an S: a curved ramp up onto the higher block). Built by the editor (a harness
// shortcut, for looking), the hills set by `setHeights`. Before/after for the bridge-on-hill look.
//
// Usage: node tools/shots/viaduct-hill.mjs [<out dir>] [<prefix>]   (default out: e2e-out/viaduct-hill)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/viaduct-hill";
const PREFIX = process.argv[3] ?? "viaduct-hill";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5383, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1000, height: 720 }, deviceScaleFactor: 1 });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
await p.addInitScript((tier) => {
  localStorage.setItem("woodrail.helpSeen", "1");
  if (tier) localStorage.setItem("woodrail.quality", tier);
}, process.env.TIER ?? "");
const snap = (name) => p.screenshot({ path: `${OUT}/${PREFIX}-${name}.jpg`, type: "jpeg", quality: 85, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// Open flat ground, 16 × 16 squares, nearest the camera's target.
const spot = await p.evaluate(async () => {
  const { FEAT_NONE, SURF_GRASS } = await import("/src/landscape/grid.ts");
  const W = window.woodrail;
  const g = W.world.landscape.grid;
  const t = W.controls.target;
  let best = null;
  g.forEachCell((i, col, row) => {
    for (let dc = 0; dc < 16; dc++)
      for (let dr = 0; dr < 16; dr++) {
        const j = g.index(col + dc, row + dr);
        if (j < 0 || (g.feature[j] !== FEAT_NONE && g.feature[j] !== 1) || g.surface[j] !== SURF_GRASS) return;
      }
    const d = Math.hypot(g.centreX(col) - t.x, g.centreZ(row) - t.z);
    if (!best || d < best.d) best = { col, row, d, x: g.centreX(col) - 36, z: g.centreZ(row) - 36 };
  });
  return best;
});
console.log("spot", JSON.stringify(spot));

const scenes = await p.evaluate(async (s) => {
  const W = window.woodrail;
  const { setHeights } = await import("/src/landscape/edit.ts");
  const { SURF_RIVER, SURF_GRASS } = await import("/src/landscape/grid.ts");
  const { getPieceDef, RISER_HEIGHT } = await import("/src/track/index.ts");
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const g = W.world.landscape.grid;
  // Three bands of rows (z), each its own profile of hill levels along x (columns 0..11); R: a river at the felt.
  const R = -1;
  const bands = [
    [2, 2, 2, R, R, 1, 2, 2, 2, 2, 2, 2],
    [2, 2, 2, R, R, 1, 2, 2, 2, 2, 2, 2],
    [0, 0, 0, R, R, 1, 1, 2, 2, 2, 2, 2],
    // The user's (2026-11-15): a river one square wide in a cut between level-1 blocks, the felt off the left one.
    [0, 0, 0, 1, 1, R, 1, 1, 2, 2, 2, 2],
  ];
  const heights = new Map();
  for (let band = 0; band < 4; band++)
    for (let c = 0; c < 12; c++)
      for (let r = band * 4; r < band * 4 + 4; r++) {
        const i = g.index(s.col + c, s.row + r);
        g.feature[i] = 0;
        g.surface[i] = bands[band][c] === R ? SURF_RIVER : SURF_GRASS;
        heights.set(i, Math.max(0, bands[band][c]));
      }
  W.editLand(setHeights(W.world.landscape, heights));
  const ed = W.editor();
  const out = [];
  const only = s.only;
  const want = (name) => !only || only.includes(name);
  // Lay a chain of pieces from a start pose: each next piece starts at the last one's far end.
  const chain = (start, y0, list) => {
    let pose = { ...start };
    let y = y0;
    const ids = [];
    for (const [type, flipped] of list) {
      const def = getPieceDef(type, flipped);
      const why = trackBlock(W.interaction.rules, type, flipped, pose, y, -1);
      const id = ed.place(type, { ...pose }, y, flipped);
      ids.push({ type, why, id, levels: W.bridgeLevelsOf?.(W.layout.getPiece(id)), floors: W.archFloorsOf?.(W.layout.getPiece(id)) });
      const peg = def.connectors[1];
      const c = Math.cos(pose.heading), sn = Math.sin(pose.heading);
      pose = { x: pose.x + peg.pose.x * c - peg.pose.z * sn, z: pose.z + peg.pose.x * sn + peg.pose.z * c, heading: pose.heading + peg.pose.heading };
      y += peg.y;
    }
    return ids;
  };
  const X = s.x; // column 0's west edge
  const rowZ = (r) => s.z + r * 72 + 36;
  // 1: a bridge two levels up, between the hills' edges exactly.
  if (want("bridge")) out.push({ name: "bridge", z: rowZ(1), ids: chain({ x: X + 0, z: rowZ(1), heading: 0 }, 96, [["straight-216", false], ["bridge", false], ["straight-216", false], ["curve-large", true]]) });
  // 2: the viaduct two levels up, its ends on the hilltops, over the river and the level-1 block.
  if (want("viaduct")) out.push({ name: "viaduct", z: rowZ(3), ids: chain({ x: X + 0, z: rowZ(3), heading: 0 }, 96, [["straight-144", false], ["viaduct", false], ["curve-large", false]]) });
  // 3: the viaduct off the squares by half a square.
  if (want("viaduct-half")) out.push({ name: "viaduct-half", z: rowZ(5) + 36, ids: chain({ x: X + 72, z: rowZ(5) + 36, heading: 0 }, 96, [["straight-36", false], ["viaduct", false], ["curve-large", true]]) });
  // 4: a curved bridge two levels up.
  if (want("curve")) out.push({ name: "curve", z: rowZ(7), ids: chain({ x: X + 0, z: rowZ(7), heading: 0 }, 96, [["straight-216", false], ["bridge-curve", false]]) });
  // 5: low ground: a ramp up, a bridge one level up over the river, a ramp up onto the hill, a curve on the hilltop.
  if (want("low")) out.push({ name: "low", z: rowZ(10), ids: chain({ x: X + 0, z: rowZ(10), heading: 0 }, 0, [["ramp", false], ["bridge", false], ["ramp", false], ["curve-large", true], ["curve-large", false]]) });
  // 6: the user's: a bridge two levels up across the cut at a slant, its start over the felt past the left block, then
  // on up an S onto the hill.
  if (want("user")) out.push({ name: "user", x: X + 353, z: rowZ(12) + 32, ids: chain({ x: X + 250, z: rowZ(12), heading: 0.3 }, 96, [["bridge", false], ["curve-large", true], ["ramp", false]]) });
  W.trackChanged();
  W.invalidate();
  return { out, X };
}, { ...spot, only: process.env.SCENES?.split(",") });
console.log(JSON.stringify(scenes));

const look = async (name, x, z, dist, phi, theta, y = 40) => {
  await p.evaluate(({ x, z, dist, phi, theta, y }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, y, z), dist, { duration: 0.1, phi, theta }), { x, z, dist, phi, theta, y });
  await p.waitForTimeout(1500);
  await settle();
  await snap(name);
};
const cx = scenes.X + 5 * 72;
// Close up under the arches (the soffits), low and from the side.
const user = scenes.out.find((o) => o.name === "user");
if (user) {
  const at = await p.evaluate((id) => {
    const q = window.woodrail.layout.getPiece(id);
    return { x: q.pose.x + 108 * Math.cos(q.pose.heading), z: q.pose.z + 108 * Math.sin(q.pose.heading) };
  }, user.ids[0].id);
  for (const [k, phi, theta] of [["a", 0.85, -0.6], ["b", 0.9, 0.4], ["c", 1.2, -0.2], ["d", 0.9, 2.6]]) await look(`user-${k}`, at.x, at.z, 520, phi, theta, 50);
}
for (const theta of (process.env.THETAS ?? "").split(",").filter(Boolean).map(Number)) await look(`t${theta}`, scenes.X + 380, scenes.out[2].z, 700, 1.3, theta, 40);
for (const sc of scenes.out) await look(`${sc.name}-arch`, scenes.X + 360, sc.z, 480, 0.95, Number(process.env.SIDE ?? 0), 40);
if (process.env.ARCH_ONLY) process.exit(0);
await look("wide", cx + 100, spot.z + 6 * 72, 2200, 0.9, 0.6);
for (const sc of scenes.out) {
  await look(`${sc.name}-side`, cx, sc.z, 900, 1.15, 0.35);
  await look(`${sc.name}-front`, cx, sc.z, 900, 1.0, -0.9);
  await look(`${sc.name}-back`, cx, sc.z, 900, 1.1, 2.6);
}
console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no page errors");
await b.close();
await server.close();
