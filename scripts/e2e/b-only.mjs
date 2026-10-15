// End-to-end road tests (`npm run e2e:roads`): the game in a headless browser on seed 7, driven with real pointer
// drags and taps, each result read back from the map. Starts its own dev server. Screenshots go to the folder given
// as the first argument (default: e2e-out/). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium if present,
// else Playwright's own (`npx playwright-core install chromium`).
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const OUT = process.argv[2] ?? "e2e-out";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: "warn" });
await server.listen();
const URL = "http://localhost:5199/#seed-7";
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

// Software WebGL, so it runs without a GPU.
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));

async function boot() {
  await p.goto(URL);
  await p.waitForFunction(() => !!window.woodrail, null, { timeout: 120000 });
  await p.waitForTimeout(4000);
  await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => /let.s play/i.test(b.textContent ?? ""))?.click());
  await p.waitForTimeout(1000);
  // Helpers in the page: squares, projection to the screen, toasts collected.
  await p.evaluate(() => {
    const w = window.woodrail;
    window.__toasts = [];
    const orig = w.hud.toast.bind(w.hud);
    w.hud.toast = (m, ...a) => {
      window.__toasts.push(m);
      return orig(m, ...a);
    };
    const g = () => w.landscape.grid;
    const V = w.camera.position.constructor;
    window.T = {
      g,
      at: (c, r) => g().index(c, r),
      info: (i) => ({ col: g().colOf(i), row: g().rowOf(i), h: g().height[i], s: g().surface[i], f: g().feature[i], road: g().road[i] }),
      screen(i) {
        const G = g();
        const v = new V(G.centreX(G.colOf(i)), G.groundY(i) + 4, G.centreZ(G.rowOf(i))).project(w.camera);
        const r = w.canvas.getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
      focus(i, radius = 260) {
        const G = g();
        w.director.focus(new V(G.centreX(G.colOf(i)), G.groundY(i), G.centreZ(G.rowOf(i))), radius);
      },
      toasts: () => window.__toasts.splice(0),
    };
  });
}

/** Squares used by the scenarios, found from the map. */
async function findSites() {
  return p.evaluate(async () => {
    const { edgesOf } = await import("/src/roads/pieces.ts");
    const w = window.woodrail;
    const G = T.g();
    const nb = G.neighbours();
    const corr = new Set(w.landscape.corridors);
    // Well inside the land (the camera can't centre on its very edge).
    const inner = (i) => [[4, 4], [-4, -4], [4, -4], [-4, 4]].every(([dc, dr]) => G.index(G.colOf(i) + dc, G.rowOf(i) + dr) !== -1);
    const free = (i) => i !== -1 && inner(i) && G.surface[i] === 0 && (G.feature[i] === 0 || G.feature[i] === 1) && !corr.has(i) && G.road[i] === 0;
    const step = (i, e, k = 1) => {
      let j = i;
      for (let n = 0; n < k && j !== -1; n++) j = nb[j * 4 + e];
      return j;
    };
    // A town street's open end with four free level squares straight out from it, and one beside the fourth.
    let gate = null;
    for (let i = 0; i < G.cellCount && !gate; i++) {
      if (G.surface[i] !== 2 || G.road[i] === 0) continue;
      for (let e = 0; e < 4; e++) {
        const back = nb[i * 4 + ((e + 2) & 3)];
        if (!(edgesOf(G.road[i]) & (1 << e)) || back === -1 || G.surface[back] !== 2) continue;
        const line = [1, 2, 3, 4].map((k) => step(i, e, k));
        const side = step(line[2], (e + 1) & 3);
        if (line.every((j) => free(j) && G.height[j] === G.height[i]) && free(side) && G.height[side] === G.height[i]) gate = { gate: i, dir: e, line, side, street: back };
      }
    }
    // A river square with free level grass either side along a line.
    let river = null;
    for (let i = 0; i < G.cellCount && !river; i++) {
      if (G.surface[i] !== 1 || G.road[i] !== 0) continue;
      for (const e of [0, 1]) {
        const a = nb[i * 4 + e];
        const c = nb[i * 4 + e + 2];
        if (free(a) && free(c) && G.height[a] === 0 && G.height[c] === 0) river = { river: i, dir: e, a, c };
      }
    }
    // A one-block step with three free level squares below it in a line.
    let hill = null;
    for (let i = 0; i < G.cellCount && !hill; i++) {
      if (G.height[i] !== 1 || !free(i)) continue;
      for (let e = 0; e < 4; e++) {
        const line = [1, 2, 3].map((k) => step(i, e, k));
        // The step only on that side of the ramp's top square, so its way up is plain.
        const sides = [(e + 1) & 3, (e + 3) & 3].map((f) => nb[line[0] * 4 + f]);
        if (line.every((j) => free(j) && G.height[j] === 0) && sides.every((j) => j !== -1 && G.height[j] === 0)) hill = { top: i, dir: e, line };
      }
    }
    // Open ground for auto roads: a 3 × 3 block of free level squares with no road beside it.
    let auto = null;
    const noRoadNear = (i) => [0, 1, 2, 3].every((e) => { const j = nb[i * 4 + e]; return j === -1 || (G.road[j] === 0 && G.surface[j] !== 2); });
    for (let i = 0; i < G.cellCount && !auto; i++) {
      const block = [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => G.index(G.colOf(i) + dc, G.rowOf(i) + dr)));
      if (block.every((j) => free(j) && G.height[j] === 0 && noRoadNear(j))) auto = { a: G.index(G.colOf(i) - 1, G.rowOf(i)), b: i, c: G.index(G.colOf(i), G.rowOf(i) - 1) };
    }
    // A second open stretch, well away from the first, for roads laid by clicking.
    let ready = null;
    for (let i = 0; i < G.cellCount && !ready && auto; i++) {
      const row = [0, 1, 2].map((dc) => G.index(G.colOf(i) + dc, G.rowOf(i)));
      const far = Math.hypot(G.colOf(i) - G.colOf(auto.b), G.rowOf(i) - G.rowOf(auto.b)) > 6;
      if (far && row.every((j) => free(j) && G.height[j] === 0 && noRoadNear(j))) ready = { a: row[0], b: row[1], c: row[2] };
    }
    // A station's way in: a level square of it, inside the land, with no road on it.
    let way = null;
    for (const i of w.landscape.corridors) if (!way && inner(i) && G.height[i] === 0 && G.road[i] === 0 && G.feature[i] === 0) way = i;
    return { gate, river, hill, auto, ready, way };
  });
}

/** Drag a tray item (by its label) onto square i. */
async function trayDrag(label, i) {
  const [x, y] = await p.evaluate((i) => T.screen(i), i);
  const btn = p.locator(".tray-item", { hasText: label }).first();
  const box = await btn.boundingBox();
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  for (let k = 1; k <= 4; k++) {
    await p.mouse.move(sx, sy - 20 * k);
    await p.waitForTimeout(40);
  }
  const ty = sy - 80;
  for (let k = 1; k <= 10; k++) {
    await p.mouse.move(sx + ((x - sx) * k) / 10, ty + ((y - ty) * k) / 10);
    await p.waitForTimeout(40);
  }
  // Aim again (the view may have moved), then let go.
  for (let k = 0; k < 2; k++) {
    await p.waitForTimeout(200);
    const [ax, ay] = await p.evaluate((i) => T.screen(i), i);
    await p.mouse.move(ax, ay);
  }
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForTimeout(600);
}

async function tap(i) {
  const [x, y] = await p.evaluate((i) => T.screen(i), i);
  await p.mouse.click(x, y);
  await p.waitForTimeout(500);
}

/** Press on square a and drag to square b (or to a screen point). */
async function dragSquare(a, b) {
  const [x0, y0] = await p.evaluate((i) => T.screen(i), a);
  const [x1, y1] = typeof b === "number" ? await p.evaluate((i) => T.screen(i), b) : b;
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  for (let k = 1; k <= 12; k++) {
    await p.mouse.move(x0 + ((x1 - x0) * k) / 12, y0 + ((y1 - y0) * k) / 12);
    await p.waitForTimeout(40);
  }
  await p.waitForTimeout(250);
  await p.mouse.up();
  await p.waitForTimeout(600);
}

/** Put the camera straight over square i, looking down at it from a fixed angle and distance, and let it settle. */
async function focusOn(i, distance = 900) {
  await p.evaluate(
    ({ i, distance }) => {
      const w = window.woodrail;
      const g = T.g();
      w.director.cancel?.();
      const t = w.controls.target;
      t.set(g.centreX(g.colOf(i)), g.groundY(i), g.centreZ(g.rowOf(i)));
      // From the south-east, 55° up.
      const up = (55 * Math.PI) / 180;
      w.camera.position.set(t.x + distance * Math.cos(up) * 0.6, t.y + distance * Math.sin(up), t.z + distance * Math.cos(up) * 0.8);
      w.controls.update();
      w.invalidate();
    },
    { i, distance },
  );
  await p.waitForTimeout(1500);
}

const road = (i) => p.evaluate((i) => T.g().road[i], i);
const toasts = () => p.evaluate(() => T.toasts());
const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png` });
const imp = (path) => `import(${JSON.stringify(path)})`;

await boot();
const sites = await findSites();
check("found test sites on seed 7", !!(sites.gate && sites.river && sites.hill && sites.auto && sites.ready && sites.way !== null), JSON.stringify({ gate: !!sites.gate, river: !!sites.river, hill: !!sites.hill, auto: !!sites.auto, ready: !!sites.ready, way: sites.way !== null }));
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Roads")?.click());
await p.waitForTimeout(800);

// ---- A: lay roads out of a town street's open end; each turns to join --------------------------------------------------------
const G = sites.gate;
await focusOn(G.line[1]);
for (const i of G.line.slice(0, 3)) await trayDrag("Road", i);
const joins = await p.evaluate(
  async ({ G }) => {
    const { roadsJoin, edgesOf } = await import("/src/roads/pieces.ts");
    const g = T.g();
    const chain = [G.gate, ...G.line.slice(0, 3)];
    return chain.slice(1).map((i, k) => roadsJoin(g.road[chain[k]], G.dir, g.road[i], g.height[i] - g.height[chain[k]]) && edgesOf(g.road[i]) !== 0);
  },
  { G },
);
check("A1 three roads laid from a town street's end, each joined to the last", joins.every(Boolean), JSON.stringify(joins));
await trayDrag("Bend", G.line[3]);
const bendJoins = await p.evaluate(
  async ({ G }) => {
    const { roadsJoin, pieceOf } = await import("/src/roads/pieces.ts");
    const g = T.g();
    return { id: pieceOf(g.road[G.line[3]])?.id, join: roadsJoin(g.road[G.line[2]], G.dir, g.road[G.line[3]]) };
  },
  { G },
);
check("A2 a bend turns to join the road it's laid on", bendJoins.id === "curve" && bendJoins.join, JSON.stringify(bendJoins));
await shot("A-laid");

// ---- B: select, rotate, delete, undo, redo ------------------------------------------------------------------------
await p.mouse.click(1100, 120); // clear any selection
await p.waitForTimeout(300);
await tap(G.line[3]);
const card = await p.evaluate(() => [...document.querySelectorAll(".piece-card")].find((c) => !c.hidden)?.textContent ?? "");
check("B1 a tap selects a placed road and shows its card", /Road bend/.test(card), card.slice(0, 40));
const before = await road(G.line[3]);
await p.locator(".piece-card button", { hasText: "Rotate" }).click();
await p.waitForTimeout(500);
const rotated = await road(G.line[3]);
check("B2 Rotate turns it a quarter", rotated !== before && (rotated & 63) === (before & 63), `${before} -> ${rotated}`);
await p.evaluate(() => window.woodrail.interaction.undo());
await p.waitForTimeout(500);
check("B3 Undo puts the turn back", (await road(G.line[3])) === before);
await tap(G.line[3]);
await p.locator(".piece-card button", { hasText: "Delete" }).click();
await p.waitForTimeout(500);
check("B4 Delete takes it away", (await road(G.line[3])) === 0);
await p.evaluate(() => window.woodrail.interaction.undo());
await p.waitForTimeout(500);
check("B5 Undo brings it back", (await road(G.line[3])) === before);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await b.close();
await server.close();
process.exit(failed === 0 ? 0 : 1);
