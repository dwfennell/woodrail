// End-to-end tests for drawing track (`npm run e2e:draw`): the game in a headless browser on seed 7, the Draw chip
// switched on, lines drawn with real mouse drags, each result read back from the layout. Starts its own dev server.
// Screenshots go to the folder given as the first argument (default: e2e-out/). Chromium as for e2e:roads.
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const OUT = process.argv[2] ?? "e2e-out";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5198, strictPort: true }, logLevel: "warn" });
await server.listen();
const URL = "http://localhost:5198/#seed-7";
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));

await p.goto(URL);
await p.waitForFunction(() => !!window.woodrail, null, { timeout: 120000 });
await p.waitForTimeout(4000);
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => /let.s play/i.test(b.textContent ?? ""))?.click());
await p.waitForTimeout(1000);
await p.evaluate(() => {
  const w = window.woodrail;
  window.__toasts = [];
  const orig = w.hud.toast.bind(w.hud);
  w.hud.toast = (m, ...a) => {
    window.__toasts.push(m);
    return orig(m, ...a);
  };
  const V = w.camera.position.constructor;
  window.D = {
    V,
    screen(x, y, z) {
      const v = new V(x, y, z).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    },
    pieces: () => w.layout.pieceCount,
    joints: () => w.layout.jointCount,
    toasts: () => window.__toasts.splice(0),
  };
});

/** A free end of track on level ground with clear, level, empty land ahead of it (found from the map). */
const site = await p.evaluate(async () => {
  const w = window.woodrail;
  const { createWorldConnector } = await import("/src/track/layout.ts");
  const G = w.landscape.grid;
  const c = createWorldConnector();
  for (const id of w.layout.pieceIds()) {
    const piece = w.layout.getPiece(id);
    for (let i = 0; i < 4; i++) {
      const ref = id * 4 + i;
      if (w.layout.joinedConnector(ref) !== -1) continue;
      try {
        w.layout.worldConnector(ref, c);
      } catch {
        continue;
      }
      if (!Number.isFinite(c.x) || c.y !== 0) continue;
      // 4 squares ahead must be plain level grass.
      let ok = true;
      for (let d = 72; d <= 72 * 9 && ok; d += 36) {
        const cell = G.cellAtWorld(c.x + Math.cos(c.heading) * d, c.z + Math.sin(c.heading) * d);
        ok = cell !== -1 && G.height[cell] === 0 && G.surface[cell] === 0 && G.feature[cell] <= 1 && G.road[cell] === 0;
      }
      if (ok) return { x: c.x, z: c.z, heading: c.heading };
    }
  }
  return null;
});
check("found a free end with open ground ahead", !!site, JSON.stringify(site));

const focus = async (x, z, r = 320) => {
  await p.evaluate(([x, z, r]) => window.woodrail.director.focus(new D.V(x, 0, z), r), [x, z, r]);
  await p.waitForTimeout(1500);
};
/** Drag the mouse through world points (x, z) on the ground, a few px a step. */
const drawThrough = async (pts, { shotAt = -1, shot = "" } = {}) => {
  const screen = await p.evaluate((pts) => pts.map(([x, z]) => D.screen(x, 0, z)), pts);
  await p.mouse.move(screen[0][0], screen[0][1]);
  await p.mouse.down();
  for (let i = 1; i < screen.length; i++) {
    const [ax, ay] = screen[i - 1];
    const [bx, by] = screen[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 14));
    for (let k = 1; k <= n; k++) await p.mouse.move(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    if (i === shotAt) await p.screenshot({ path: `${OUT}/${shot}` });
  }
  await p.mouse.up();
  await p.waitForTimeout(1200);
};

if (site) {
  const { x, z, heading: h } = site;
  const fx = Math.cos(h);
  const fz = Math.sin(h);
  // Left of the way the line runs.
  const lx = -fz;
  const lz = fx;
  await focus(x + fx * 250, z + fz * 250);
  // Switch drawing on with the chip.
  await p.click(".tray-draw");
  const on = await p.evaluate(() => window.woodrail.interaction.isDrawing);
  check("the Draw chip switches drawing on", on);

  // 1. Straight on from the free end.
  const before = await p.evaluate(() => [D.pieces(), D.joints()]);
  const line = [0, 100, 200, 300, 400].map((d) => [x + fx * d, z + fz * d]);
  await drawThrough(line, { shotAt: 3, shot: "draw-1-midway.png" });
  await p.screenshot({ path: `${OUT}/draw-1-laid.png` });
  const after = await p.evaluate(() => [D.pieces(), D.joints()]);
  const added = after[0] - before[0];
  check("a straight stroke from a free end lays track", added >= 2, `${added} pieces`);
  check("the drawn pieces are joined to the track and each other", after[1] - before[1] === added, `${after[1] - before[1]} joints for ${added} pieces`);

  // 2. One undo takes the whole line back up.
  await p.evaluate(() => window.woodrail.interaction.undo());
  await p.waitForTimeout(300);
  const undone = await p.evaluate(() => D.pieces());
  check("one undo takes the whole line up", undone === before[0], `${undone} vs ${before[0]}`);

  // 3. A turn: straight on, then round to the left.
  const r = 180;
  const turn = [];
  for (let d = 0; d <= 200; d += 25) turn.push([x + fx * d, z + fz * d]);
  for (let a = 0; a <= Math.PI / 2; a += Math.PI / 16) {
    const along = 200 + r * Math.sin(a);
    const side = r * (1 - Math.cos(a));
    turn.push([x + fx * along + lx * side, z + fz * along + lz * side]);
  }
  await focus(x + fx * 250 + lx * 120, z + fz * 250 + lz * 120, 380);
  await drawThrough(turn, { shotAt: turn.length - 2, shot: "draw-2-turn-midway.png" });
  await p.screenshot({ path: `${OUT}/draw-2-turn.png` });
  const types = await p.evaluate((n) => [...window.woodrail.layout.pieceIds()].slice(-n).map((id) => window.woodrail.layout.getPiece(id).type), 12);
  const curves = types.filter((t) => t.startsWith("curve")).length;
  check("a stroke that turns lays curves", curves >= 2, types.join(" "));
  await p.evaluate(() => window.woodrail.interaction.undo());

  // 4. Retracing takes ghosts off: out and back to the start lays nothing.
  const n0 = await p.evaluate(() => D.pieces());
  const outBack = [...[0, 150, 300, 450, 600].map((d) => [x + fx * d, z + fz * d]), ...[450, 300, 150, 10].map((d) => [x + fx * d, z + fz * d])];
  await drawThrough(outBack);
  const n1 = await p.evaluate(() => D.pieces());
  check("drawing out and back again lays nothing", n1 === n0, `${n1 - n0} pieces`);

  // 5. A new line on empty ground (away from track).
  const gx = x + fx * 300 + lx * 300;
  const gz = z + fz * 300 + lz * 300;
  await focus(gx + fx * 150, gz + fz * 150, 380);
  await drawThrough([0, 80, 160, 240, 320].map((d) => [gx + fx * d, gz + fz * d]));
  const n2 = await p.evaluate(() => D.pieces());
  check("a stroke on empty ground starts a new line", n2 - n1 >= 1, `${n2 - n1} pieces`);
  await p.screenshot({ path: `${OUT}/draw-5-ground.png` });

  // 6. Esc puts the pencil down; a drag then pans as usual.
  await p.keyboard.press("Escape");
  const off = await p.evaluate(() => !window.woodrail.interaction.isDrawing && !document.querySelector(".tray-draw").classList.contains("active"));
  check("Esc switches drawing off", off);
}

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
