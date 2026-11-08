// Before/after pictures for underpasses off a hill's edge and a line drawn at a slant under a bridge, on a 390×844
// phone (Sandbox #seed-24, device scale 2). Each scene is set up by the editor (a harness shortcut: for looking, not
// testing; e2e:low-bridge and e2e:draw test them), then played as a player would: a Bridge (or Curved bridge) from the
// tray held over a ramp's top and dropped, or a Draw stroke. "held" is the ghost before the drop (or the line's ghosts
// before the finger lifts), "down" after it.
//
// Usage: node tools/shots/underpass-3.mjs <out dir> <prefix> [<game root>]
//   e.g. node tools/shots/underpass-3.mjs docs/agents/shots underpass-3-after
//        node tools/shots/underpass-3.mjs docs/agents/shots underpass-3-before ../main-worktree   (a checkout of main)
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const OUT = process.argv[2] ?? "e2e-out/underpass-3";
const PREFIX = process.argv[3] ?? "underpass-3";
const ROOT = resolve(process.argv[4] ?? fileURLToPath(new URL("../..", import.meta.url)));
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.log(`page error: ${e.message}`));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const snap = async (name) => {
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/${PREFIX}-${name}.jpg`, type: "jpeg", quality: 80, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  console.log(`${OUT}/${PREFIX}-${name}.jpg`);
};
await p.goto(`${PAGE}/#seed-24`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

const screen = (x, y, z) =>
  p.evaluate(([x, y, z]) => {
    const w = window.woodrail;
    const v = new w.camera.position.constructor(x, y, z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, [x, y, z]);
const look = (x, z, from, dist, atY = 20) =>
  p.evaluate(([x, z, from, dist, atY]) => {
    const w = window.woodrail;
    const V = w.camera.position.constructor;
    const at = new V(x, atY, z);
    w.controls.target.copy(at);
    w.camera.position.copy(at.clone().add(new V(...from).normalize().multiplyScalar(dist)));
    w.camera.lookAt(at);
    w.controls.update?.();
    w.invalidate?.();
  }, [x, z, from, dist, atY]);
const item = async (key) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, key);
  for (let k = 0; k < 20; k++) {
    const r = await find();
    if (r) return r;
    const tap = async (sel, i = 0) => {
      const q = await p.evaluate(([sel, i]) => { const e = document.querySelectorAll(sel)[i]; if (!e) return null; e.scrollIntoView({ inline: "center" }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, [sel, i]);
      if (q) await p.mouse.click(q[0], q[1]);
      await frames();
      return !!q;
    };
    if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) await tap(".scroller .tray-back");
    if (!(await tap(".scroller .tray-group", k))) return null;
  }
  return null;
};

/** A hill a level up for x < edge (relative), a line along it on off its edge (on risers), a ramp up from the hilltop. */
const hillEdge = (edge, ramp) =>
  p.evaluate(
    async ([edge, ramp]) => {
      const w = window.woodrail;
      const { trackBlock, trackPlacement } = await import("/src/game/track-rules.ts");
      const { plotSlotOf } = await import("/src/landscape/edit.ts");
      const rules = w.interaction.rules;
      const g = w.landscape.grid;
      const t = w.controls.target;
      for (let d = 0; d < 9000; d += 72)
        for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
          const X = Math.round((t.x + d * Math.cos(a)) / 72) * 72;
          const Z = Math.round((t.z + d * Math.sin(a)) / 72) * 72 + 36;
          const cells = [];
          let ok = true;
          for (let x = X - 36; x <= X + 1116 && ok; x += 72)
            for (let z = Z - 324; z <= Z + 180 && ok; z += 72) {
              const i = g.cellAtWorld(x, z);
              if (i === -1 || g.height[i] !== 0 || trackBlock(rules, "straight-54", false, { x: x - 27, z, heading: 0 }, 0, -1) !== null) ok = false;
              else if (x < X + edge && z <= Z + 108) cells.push(i);
            }
          if (!ok) continue;
          const editor = w.interaction.landEditor();
          if (cells.some((i) => editor.check(i, 1) !== null)) continue;
          for (const i of cells) editor.apply(i, 1);
          w.editLand([...new Set(cells.map(plotSlotOf))]);
          for (const x of [0, 216, 432, 648, 864]) {
            const pose = { x: X + x, z: Z, heading: 0 };
            const placed = trackPlacement(rules, "straight-216", false, pose, 48, -1);
            w.editor().place("straight-216", pose, 48, false, placed.risers);
          }
          const r = w.editor().place("ramp", { x: X + ramp.x, z: Z + ramp.z, heading: Math.PI / 2 }, 48, false);
          const q = w.layout.getPiece(r);
          return { X, Z, top: { x: q.pose.x + 144 * Math.cos(q.pose.heading), z: q.pose.z + 144 * Math.sin(q.pose.heading), y: 96 } };
        }
      return null;
    },
    [edge, ramp],
  );

/** A bridge from the tray held over the ramp's top (picture), then dropped (picture). */
async function bridgeScene(name, key, edge, ramp) {
  const at = await hillEdge(edge, ramp);
  if (!at) return console.log(`${name}: no room`);
  await look(at.X + edge, at.Z - 20, [0.75, 0.6, 1], 620, 30);
  await settle();
  const r = await item(key);
  await p.mouse.click(r[0], r[1]);
  await frames();
  const pt = await screen(at.top.x, 96, at.top.z - 6);
  await p.mouse.move(pt[0], pt[1], { steps: 6 });
  await frames();
  await snap(`${name}-held`);
  await p.mouse.click(pt[0], pt[1]);
  await frames();
  await p.keyboard.press("Escape");
  await settle();
  await snap(`${name}-down`);
}

const SCENES = (process.env.SCENES ?? "hill-edge,hill-edge-curved,slant").split(",");
if (SCENES.includes("hill-edge")) await bridgeScene("hill-edge", "piece:bridge", 504, { x: 468, z: -252 });
if (SCENES.includes("hill-edge-curved")) await bridgeScene("hill-edge-curved", "piece:bridge-curve", 576, { x: 500, z: -198 });

// A line drawn at 20° to the grid from a straight's end, under a bridge (on a ramp) square across the stroke.
if (SCENES.includes("slant")) {
  const at = await p.evaluate(async () => {
    const w = window.woodrail;
    const { trackBlock } = await import("/src/game/track-rules.ts");
    const rules = w.interaction.rules;
    const t = w.controls.target;
    const ph = (20 * Math.PI) / 180;
    const bh = (110 * Math.PI) / 180;
    const cx = 468 * Math.cos(ph);
    const cz = 468 * Math.sin(ph);
    const bridge = { x: cx - 108 * Math.cos(bh), z: cz - 108 * Math.sin(bh), heading: bh };
    const ramp = { x: bridge.x - 144 * Math.cos(bh), z: bridge.z - 144 * Math.sin(bh), heading: bh };
    for (let d = 0; d < 9000; d += 72)
      for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
        const X = Math.round((t.x + d * Math.cos(a)) / 18) * 18;
        const Z = Math.round((t.z + d * Math.sin(a)) / 18) * 18;
        const at = (q) => ({ x: X + q.x, z: Z + q.z, heading: q.heading });
        if (trackBlock(rules, "straight-216", false, at({ x: -216, z: 0, heading: 0 }), 0, -1) !== null) continue;
        if (trackBlock(rules, "ramp", false, at(ramp), 0, -1) !== null || trackBlock(rules, "bridge", false, at(bridge), 48, -1) !== null) continue;
        let ok = true;
        for (let s = 0; s <= 1000 && ok; s += 72)
          for (const side of [-90, 0, 90]) {
            const x = s * Math.cos(ph) - side * Math.sin(ph);
            const z = s * Math.sin(ph) + side * Math.cos(ph);
            if (Math.hypot(x - cx, z - cz) < 130) continue;
            if (trackBlock(rules, "straight-54", false, at({ x: x - 27, z, heading: 0 }), 0, -1) !== null) ok = false;
          }
        if (!ok) continue;
        w.editor().place("straight-216", at({ x: -216, z: 0, heading: 0 }), 0, false);
        w.editor().place("ramp", at(ramp), 0, false);
        w.editor().place("bridge", at(bridge), 48, false);
        return { X, Z, mid: { x: X + cx, z: Z + cz } };
      }
    return null;
  });
  if (at) {
    await look(at.X + 300 * Math.cos(0.35), at.Z + 300 * Math.sin(0.35), [-0.25 * Math.cos(0.35), 1, -0.25 * Math.sin(0.35)], 2100, 0);
    await settle();
    await p.evaluate(() => document.querySelector(".tray-draw")?.click());
    await frames();
    const ph = (20 * Math.PI) / 180;
    const sc = [];
    for (const s of [-4, 200, 468, 700, 940]) sc.push(await screen(at.X + s * Math.cos(ph), 0, at.Z + s * Math.sin(ph)));
    await p.mouse.move(sc[0][0], sc[0][1]);
    await p.mouse.down();
    for (let i = 1; i < sc.length; i++) {
      const n = Math.max(1, Math.ceil(Math.hypot(sc[i][0] - sc[i - 1][0], sc[i][1] - sc[i - 1][1]) / 8));
      for (let k = 1; k <= n; k++) await p.mouse.move(sc[i - 1][0] + ((sc[i][0] - sc[i - 1][0]) * k) / n, sc[i - 1][1] + ((sc[i][1] - sc[i - 1][1]) * k) / n);
    }
    await frames();
    console.log(JSON.stringify(sc.map((q) => q.map(Math.round))), JSON.stringify(await p.evaluate(() => ({ drawing: window.woodrail.interaction.drawing, line: (window.woodrail.interaction.draw.line?.pieces ?? []).map((q) => q.type + (q.blocked ? "!" : "")), said: window.__said ?? null }))), JSON.stringify(sc[0]), JSON.stringify(at));
    await snap("slant-drawing");
    await p.mouse.up();
    await settle();
    await look(at.mid.x, at.mid.z, [0.7, 0.8, 0.9], 950, 0);
    await settle();
    await snap("slant-down");
  }
}

await b.close();
await server.close();
