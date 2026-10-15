// End-to-end road tests (`npm run e2e:roads`): the game in a headless browser on seed 7, driven with real pointer
// drags and taps, each result read back from the map. Starts its own dev server (on 5199, or the next free port, so
// runs can go side by side). Screenshots go to the folder given as the first argument (default: e2e-out/).
//
// No fixed waits: each step waits for what it's waiting for (a frame, the scene to settle, a road or a message to
// appear), so a slow machine is only slower, not wrong. Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium if present,
// else Playwright's own (`npx playwright-core install chromium`).
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const OUT = process.argv[2] ?? "e2e-out";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: "warn" });
await server.listen();
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
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

/** The next frame drawn (or not) by the page: pointer events sent one per frame, as a finger's are. */
const frame = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
/** The scene still for a few ticks (camera glides, eases and animations over), or 20 s, whichever's first. */
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
/** Wait (up to 20 s) for something in the page to be true; the check after says whether it was. */
const until = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 20000, polling: 50 }).catch(() => {});

/** Close the help card that greets a new player, if it comes. */
async function letsPlay() {
  const btn = p.locator("button", { hasText: /let.s play/i }).first();
  if (await btn.waitFor({ state: "visible", timeout: 30000 }).then(() => true, () => false)) {
    await btn.click();
    await btn.waitFor({ state: "hidden", timeout: 20000 }).catch(() => {});
  }
}

async function boot() {
  await p.goto(URL);
  await p.waitForFunction(() => !!window.woodrail, null, { timeout: 120000 });
  await letsPlay();
  await settle();
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

/** The road on square i and how many messages have shown: what a drop changes (a road laid, or a refusal said). */
const mark = (i) => p.evaluate((i) => ({ road: T.g().road[i], toasts: window.__toasts.length }), i);
const changed = (i, m) => until(({ i, m }) => T.g().road[i] !== m.road || window.__toasts.length > m.toasts, { i, m });

/** Drag a tray item (by its label) onto square i, and wait for the drop to lay a road there or say why not. */
async function trayDrag(label, i) {
  const m = await mark(i);
  const btn = p.locator(".tray-item", { hasText: label }).first();
  const box = await btn.boundingBox();
  const sx = box.x + box.width / 2;
  const sy = box.y + box.height / 2;
  await p.mouse.move(sx, sy);
  await p.mouse.down();
  for (let k = 1; k <= 4; k++) {
    await p.mouse.move(sx, sy - 20 * k);
    await frame();
  }
  // Picked up (the tray saw the press go up and out): in hand before it's carried over the map.
  await until(() => window.woodrail.interaction.mode.kind.startsWith("drag"));
  const held = await p.evaluate(() => window.woodrail.interaction.mode.kind);
  if (!held.startsWith("drag")) console.log(`(${label}: not picked up from the tray: ${held}, tray scrolled to ${await p.evaluate(() => document.querySelector(".tray-item")?.parentElement?.scrollLeft)})`);
  const [x, y] = await p.evaluate((i) => T.screen(i), i);
  const ty = sy - 80;
  for (let k = 1; k <= 10; k++) {
    await p.mouse.move(sx + ((x - sx) * k) / 10, ty + ((y - ty) * k) / 10);
    await frame();
  }
  // Aim again (the view may have moved), then let go.
  for (let k = 0; k < 2; k++) {
    await frame();
    const [ax, ay] = await p.evaluate((i) => T.screen(i), i);
    await p.mouse.move(ax, ay);
    await frame();
  }
  // In hand over the map (its ghost following the pointer) before it's let go.
  await until(() => window.woodrail.interaction.mode.kind.startsWith("drag"));
  await p.mouse.up();
  await changed(i, m);
}

/** Tap square i (a click, as a finger's tap: down and up a frame apart). */
async function tap(i) {
  const [x, y] = await p.evaluate((i) => T.screen(i), i);
  await p.mouse.move(x, y);
  await p.mouse.down();
  await frame();
  await p.mouse.up();
  await frame();
}
const cardShown = () => until(() => [...document.querySelectorAll(".piece-card")].some((c) => !c.hidden));

/** Press on square a and drag to square b (or to a screen point), a step a frame, as a finger does. */
async function dragSquare(a, b) {
  const [x0, y0] = await p.evaluate((i) => T.screen(i), a);
  const [x1, y1] = typeof b === "number" ? await p.evaluate((i) => T.screen(i), b) : b;
  await p.mouse.move(x0, y0);
  await p.mouse.down();
  await frame();
  for (let k = 1; k <= 12; k++) {
    await p.mouse.move(x0 + ((x1 - x0) * k) / 12, y0 + ((y1 - y0) * k) / 12);
    await frame();
  }
  await p.mouse.up();
  await frame();
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
  await settle();
}

const road = (i) => p.evaluate((i) => T.g().road[i], i);
const toasts = () => p.evaluate(() => T.toasts());
// A picture for a person to look at: slow under software drawing, and never a reason to stop the run.
const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png`, timeout: 60000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const imp = (path) => `import(${JSON.stringify(path)})`;

await boot();
const sites = await findSites();
check("found test sites on seed 7", !!(sites.gate && sites.river && sites.hill && sites.auto && sites.ready && sites.way !== null), JSON.stringify({ gate: !!sites.gate, river: !!sites.river, hill: !!sites.hill, auto: !!sites.auto, ready: !!sites.ready, way: sites.way !== null }));
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Roads")?.click());
await p.locator(".tray-item", { hasText: "Road bridge" }).first().waitFor({ state: "visible", timeout: 20000 });

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
await frame();
await tap(G.line[3]);
await cardShown();
const card = await p.evaluate(() => [...document.querySelectorAll(".piece-card")].find((c) => !c.hidden)?.textContent ?? "");
check("B1 a tap selects a placed road and shows its card", /Road bend/.test(card), card.slice(0, 40));
const before = await road(G.line[3]);
await p.locator(".piece-card button", { hasText: "Rotate" }).click();
await until(({ i, before }) => T.g().road[i] !== before, { i: G.line[3], before });
const rotated = await road(G.line[3]);
check("B2 Rotate turns it a quarter", rotated !== before && (rotated & 63) === (before & 63), `${before} -> ${rotated}`);
await p.evaluate(() => window.woodrail.interaction.undo());
check("B3 Undo puts the turn back", (await road(G.line[3])) === before);
await tap(G.line[3]);
await cardShown();
await p.locator(".piece-card button", { hasText: "Delete" }).click();
await until((i) => T.g().road[i] === 0, G.line[3]);
check("B4 Delete takes it away", (await road(G.line[3])) === 0);
await p.evaluate(() => window.woodrail.interaction.undo());
check("B5 Undo brings it back", (await road(G.line[3])) === before);
await p.evaluate(() => window.woodrail.interaction.redo());
check("B6 Redo takes it away again", (await road(G.line[3])) === 0);
await p.evaluate(() => window.woodrail.interaction.undo());

// ---- C: a drag on an unselected road pans; on a selected one, moves it ------------------------------------------
await p.mouse.click(1100, 120);
await frame();
await settle();
const camBefore = await p.evaluate(() => window.woodrail.controls.target.toArray());
await dragSquare(G.line[3], G.side);
await settle();
const camAfter = await p.evaluate(() => window.woodrail.controls.target.toArray());
check("C1 dragging an unselected road pans the view, leaving the road", (await road(G.line[3])) !== 0 && (await road(G.side)) === 0 && camBefore.some((v, k) => Math.abs(v - camAfter[k]) > 1));
await focusOn(G.line[1]);
await tap(G.line[3]);
await cardShown();
await dragSquare(G.line[3], G.side);
await until(({ a, b }) => T.g().road[a] === 0 && T.g().road[b] !== 0, { a: G.line[3], b: G.side });
check("C2 dragging a selected road moves it to the square under the finger", (await road(G.line[3])) === 0 && (await road(G.side)) !== 0);
await p.evaluate(() => window.woodrail.interaction.undo());
check("C3 Undo moves it back", (await road(G.line[3])) !== 0 && (await road(G.side)) === 0);

// ---- D: drop back on the tray removes it --------------------------------------------------------------------------
await tap(G.line[3]);
await cardShown();
const trayBox = await p.locator(".tray-item").first().boundingBox();
await dragSquare(G.line[3], [trayBox.x + 200, trayBox.y + 20]);
await until((i) => T.g().road[i] === 0, G.line[3]);
check("D1 a road dragged back onto the tray is removed", (await road(G.line[3])) === 0);
await p.evaluate(() => window.woodrail.interaction.undo());

// ---- E: refusals ---------------------------------------------------------------------------------------------------
await toasts();
await trayDrag("Road", G.street);
const streetToast = (await toasts()).join(" | ");
check("E1 a road on a town street is refused, and the street is unchanged", streetToast.includes("Town streets") && (await p.evaluate((i) => T.g().surface[i], G.street)) === 2, streetToast);
await trayDrag("Road bridge", G.side);
const dryToast = (await toasts()).join(" | ");
check("E2 a road bridge on dry land is refused", (await road(G.side)) === 0 && dryToast.includes("Bridges go over the river"), dryToast);
await trayDrag("Ramp", G.side);
const slopeToast = (await toasts()).join(" | ");
const sideRoad = await road(G.side);
check("E3 a ramp on level ground is laid as a bottom half (no step needed)", sideRoad !== 0 || slopeToast.includes("ramp"), `road ${sideRoad}, ${slopeToast}`);
if (sideRoad !== 0) await p.evaluate(() => window.woodrail.interaction.undo());
// A station's way in takes a straight road across the line (a level crossing once track is laid), nothing else.
await focusOn(sites.way);
await trayDrag("Road", sites.way);
const way = await p.evaluate(async (i) => {
  const { pieceOf } = await import("/src/roads/pieces.ts");
  const w = window.woodrail;
  const g = T.g();
  const t = [...w.landscape.towns.map((x) => ({ c: x.centre, h: x.station.heading })), ...w.landscape.depots.map((d) => ({ c: d.centre, h: d.piece.heading }))]
    .sort((a, b) => Math.hypot(a.c.x - g.centreX(g.colOf(i)), a.c.z - g.centreZ(g.rowOf(i))) - Math.hypot(b.c.x - g.centreX(g.colOf(i)), b.c.z - g.centreZ(g.rowOf(i))))[0];
  const road = g.road[i];
  // A straight at an odd turn runs along z: across a line along x.
  const lineAlongX = Math.abs(Math.cos(t.h)) > 0.5;
  return { id: pieceOf(road)?.id ?? null, across: road !== 0 && ((road >> 6) & 1) === (lineAlongX ? 1 : 0) };
}, sites.way);
check("E4 a road on a station's way in goes down as a straight across the line", way.id === "straight" && way.across, JSON.stringify(way));
await p.evaluate(() => window.woodrail.interaction.undo());
await shot("E-refusals");

// ---- F: a road bridge over the river --------------------------------------------------------------------------------
const R = sites.river;
await focusOn(R.river);
await toasts();
await trayDrag("Road", R.river);
const riverToast = (await toasts()).join(" | ");
check("F1 a plain road on the river is refused", (await road(R.river)) === 0 && riverToast.includes("road bridge"), riverToast);
await trayDrag("Road", R.a);
await trayDrag("Road bridge", R.river);
await trayDrag("Road", R.c);
const bridge = await p.evaluate(
  async ({ R }) => {
    const { roadsJoin, pieceOf } = await import("/src/roads/pieces.ts");
    const g = T.g();
    return { id: pieceOf(g.road[R.river])?.id, surface: g.surface[R.river], a: roadsJoin(g.road[R.a], R.dir, g.road[R.river]), c: roadsJoin(g.road[R.river], R.dir, g.road[R.c]) };
  },
  { R },
);
check("F2 a road bridge goes on the river, stays river underneath, and joins the roads both sides", bridge.id === "bridge" && bridge.surface === 1 && bridge.a && bridge.c, JSON.stringify(bridge));
await shot("F-bridge");

// ---- G: ramps up a hill ---------------------------------------------------------------------------------------------
const H = sites.hill;
await focusOn(H.line[1]);
// As a player would: the ramp up against the step first, then down to the road, then on along the hilltop.
for (const [label, i] of [["Ramp", H.line[0]], ["Ramp", H.line[1]], ["Road", H.line[2]], ["Road", H.top]]) {
  await trayDrag(label, i);
}
const ramp = await p.evaluate(
  async ({ H }) => {
    const { roadsJoin, pieceOf } = await import("/src/roads/pieces.ts");
    const g = T.g();
    const back = (H.dir + 2) & 3;
    const chain = [H.line[2], H.line[1], H.line[0], H.top];
    return {
      ids: chain.map((i) => pieceOf(g.road[i])?.id ?? null),
      joins: chain.slice(1).map((i, k) => roadsJoin(g.road[chain[k]], back, g.road[i], g.height[i] - g.height[chain[k]])),
    };
  },
  { H },
);
check("G1 road, bottom half, top half and a road on the hilltop, all joined", JSON.stringify(ramp.ids) === JSON.stringify(["straight", "ramp-low", "ramp-high", "straight"]) && ramp.joins.every(Boolean), JSON.stringify(ramp));
await shot("G-ramp");

// ---- L: auto roads bend to meet each other, and go back -----------------------------------------------------------
const L = sites.auto;
await focusOn(L.b);
const shape = (i) => p.evaluate(async (i) => { const { pieceOf, edgesOf, isAutoRoad } = await import("/src/roads/pieces.ts"); const r = T.g().road[i]; return { id: pieceOf(r)?.id ?? null, edges: edgesOf(r), auto: isAutoRoad(r) }; }, i);
await trayDrag("Road", L.a);
await trayDrag("Road", L.b);
const two = [await shape(L.a), await shape(L.b)];
// Grid edges as bits: +col 1, +row 2, −col 4, −row 8.
check("L1 two auto roads side by side join as straights", two.every((x) => x.id === "straight" && x.auto && x.edges === 5), JSON.stringify(two));
await trayDrag("Road", L.c);
const bent = await shape(L.b);
check("L2 a third laid beside the second bends it to meet it", bent.id === "curve" && bent.edges === (4 | 8), JSON.stringify(bent));
await tap(L.c);
await cardShown();
await p.locator(".piece-card button", { hasText: "Delete" }).click();
await until((i) => T.g().road[i] === 0, L.c);
const back = await shape(L.b);
check("L3 taking the third away straightens it again", back.id === "straight" && back.edges === 5, JSON.stringify(back));
await p.evaluate(() => window.woodrail.interaction.undo());
check("L4 Undo brings back the third and the bend in one step", (await shape(L.c)).auto && (await shape(L.b)).id === "curve");
await shot("L-auto");

// ---- M: on a desktop, a road tapped in the tray is laid by clicking the map ----------------------------------------
const M = sites.ready;
await focusOn(M.b);
await p.locator(".tray-item", { hasText: "Road" }).first().click();
await frame();
for (const i of [M.a, M.b, M.c]) {
  await tap(i);
  await until((i) => T.g().road[i] !== 0, i);
}
const laid = [await shape(M.a), await shape(M.b), await shape(M.c)];
const cardOpen = await p.evaluate(() => [...document.querySelectorAll(".piece-card")].some((c) => !c.hidden));
check("M1 a road tapped in the tray is laid at each click, joined up", laid.every((x) => x.id === "straight" && x.edges === 5), JSON.stringify(laid));
check("M2 laying roads opens no card to get in the way", !cardOpen);
await p.keyboard.press("Escape");
await frame();
await tap(M.b);
await cardShown();
check("M3 after Esc, a click selects a road again (and opens its card)", await p.evaluate(() => [...document.querySelectorAll(".piece-card")].some((c) => !c.hidden)));
await p.mouse.click(1100, 120);
await frame();

// ---- H: track and roads: level crossings ----------------------------------------------------------------------------
const crossing = await p.evaluate(
  async ({ G }) => {
    const w = window.woodrail;
    const { checkPlacement, findCrossings } = await import("/src/landscape/index.ts");
    const g = T.g();
    const i = G.line[1];
    const cx = g.centreX(g.colOf(i));
    const cz = g.centreZ(g.rowOf(i));
    // The road runs along G.dir (0/2: along x, 1/3: along z).
    const alongX = G.dir % 2 === 0;
    const across = alongX ? Math.PI / 2 : 0;
    const along = alongX ? 0 : Math.PI / 2;
    const pose = (h) => ({ x: cx - Math.cos(h) * 108, z: cz - Math.sin(h) * 108, heading: h });
    const a = checkPlacement(w.landscape, "straight-216", false, pose(across), g.groundY(i));
    const b = checkPlacement(w.landscape, "straight-216", false, pose(along), g.groundY(i));
    // Lay the crossing track through the editor (as a drop would), then look for the crossing.
    const id = w.editor().place("straight-216", pose(across), g.groundY(i), false);
    const found = findCrossings(w.landscape, w.layout).length;
    return { across: a.kind, along: b.kind === "blocked" ? b.reason : b.kind, placed: id !== -1, found };
  },
  { G },
);
check("H1 track straight across a road is allowed, along it is refused", crossing.across === "clear" && crossing.along === "road", JSON.stringify(crossing));
check("H2 track across a road makes a level crossing", crossing.found >= 1, `crossings found: ${crossing.found}`);
await focusOn(G.line[1]);
await toasts();
await trayDrag("Crossroads", G.line[1]);
const crossToast = (await toasts()).join(" | ");
const stillStraight = await p.evaluate(async (i) => (await import("/src/roads/pieces.ts")).pieceOf(T.g().road[i])?.id, G.line[1]);
check("H3 a junction can't replace the straight under the track", stillStraight === "straight" && crossToast.includes("Track"), `${stillStraight}, ${crossToast}`);
await shot("H-crossing");

// ---- I: saved and loaded --------------------------------------------------------------------------------------------
const snapshot = await p.evaluate(() => {
  const g = T.g();
  const out = [];
  for (let i = 0; i < g.cellCount; i++) if (g.road[i] && g.surface[i] !== 2) out.push([g.colOf(i), g.rowOf(i), g.road[i]]);
  return JSON.stringify(out);
});
// Leaving the page saves it (as closing the tab does); then the reloaded map's roads, once it's built.
await p.reload();
await p.waitForFunction(() => !!window.woodrail?.landscape?.grid, null, { timeout: 120000 });
await until((n) => {
  const g = window.woodrail.landscape.grid;
  let k = 0;
  for (let i = 0; i < g.cellCount; i++) if (g.road[i] && g.surface[i] !== 2) k++;
  return k === n;
}, JSON.parse(snapshot).length);
const reloaded = await p.evaluate(() => {
  const g = window.woodrail.landscape.grid;
  const out = [];
  for (let i = 0; i < g.cellCount; i++) if (g.road[i] && g.surface[i] !== 2) out.push([g.colOf(i), g.rowOf(i), g.road[i]]);
  return JSON.stringify(out);
});
check("I1 the player's roads survive a reload (autosave)", snapshot === reloaded, `${JSON.parse(snapshot).length} road squares before, ${JSON.parse(reloaded).length} after`);

// ---- J: idle cost ---------------------------------------------------------------------------------------------------
await letsPlay();
// Settled (the scene drew nothing for a good while): then count what it draws over 5 s, which should be nothing.
await p.evaluate(() => Promise.race([window.woodrail.settled(30), new Promise((r) => setTimeout(r, 60000))]));
const frames = await p.evaluate(async () => {
  const w = window.woodrail;
  const n = w.framesDrawn;
  await new Promise((res) => setTimeout(res, 5000));
  return w.framesDrawn - n;
});
check("J1 an idle scene with the player's roads, a bridge, ramps and a level crossing draws (next to) no frames", frames <= 1, `${frames} frames drawn in 5 s`);

// ---- K: Game mode has the Roads tab ----------------------------------------------------------------------------------
const tabs = await p.evaluate(async () => (await import("/src/ui/tray-catalogue.ts")).trayTabs("game").map((t) => t.id));
check("K1 Game mode's tray has the Roads tab", tabs.includes("roads"), tabs.join(", "));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await b.close();
await server.close();
process.exit(failed === 0 ? 0 : 1);
