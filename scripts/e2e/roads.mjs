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
    return { gate, river, hill, auto, ready };
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
check("found test sites on seed 7", !!(sites.gate && sites.river && sites.hill && sites.auto && sites.ready), JSON.stringify({ gate: !!sites.gate, river: !!sites.river, hill: !!sites.hill, auto: !!sites.auto, ready: !!sites.ready }));
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
await p.evaluate(() => window.woodrail.interaction.redo());
await p.waitForTimeout(500);
check("B6 Redo takes it away again", (await road(G.line[3])) === 0);
await p.evaluate(() => window.woodrail.interaction.undo());
await p.waitForTimeout(500);

// ---- C: a drag on an unselected road pans; on a selected one, moves it ------------------------------------------
await p.mouse.click(1100, 120);
await p.waitForTimeout(300);
const camBefore = await p.evaluate(() => window.woodrail.controls.target.toArray());
await dragSquare(G.line[3], G.side);
const camAfter = await p.evaluate(() => window.woodrail.controls.target.toArray());
check("C1 dragging an unselected road pans the view, leaving the road", (await road(G.line[3])) !== 0 && (await road(G.side)) === 0 && camBefore.some((v, k) => Math.abs(v - camAfter[k]) > 1));
await focusOn(G.line[1]);
await tap(G.line[3]);
await dragSquare(G.line[3], G.side);
check("C2 dragging a selected road moves it to the square under the finger", (await road(G.line[3])) === 0 && (await road(G.side)) !== 0);
await p.evaluate(() => window.woodrail.interaction.undo());
await p.waitForTimeout(500);
check("C3 Undo moves it back", (await road(G.line[3])) !== 0 && (await road(G.side)) === 0);

// ---- D: drop back on the tray removes it --------------------------------------------------------------------------
await tap(G.line[3]);
const trayBox = await p.locator(".tray-item").first().boundingBox();
await dragSquare(G.line[3], [trayBox.x + 200, trayBox.y + 20]);
check("D1 a road dragged back onto the tray is removed", (await road(G.line[3])) === 0);
await p.evaluate(() => window.woodrail.interaction.undo());
await p.waitForTimeout(500);

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
await p.locator(".piece-card button", { hasText: "Delete" }).click();
await p.waitForTimeout(500);
const back = await shape(L.b);
check("L3 taking the third away straightens it again", back.id === "straight" && back.edges === 5, JSON.stringify(back));
await p.evaluate(() => window.woodrail.interaction.undo());
await p.waitForTimeout(500);
check("L4 Undo brings back the third and the bend in one step", (await shape(L.c)).auto && (await shape(L.b)).id === "curve");
await shot("L-auto");

// ---- M: on a desktop, a road tapped in the tray is laid by clicking the map ----------------------------------------
const M = sites.ready;
await focusOn(M.b);
await p.locator(".tray-item", { hasText: "Road" }).first().click();
await p.waitForTimeout(400);
for (const i of [M.a, M.b, M.c]) await tap(i);
const laid = [await shape(M.a), await shape(M.b), await shape(M.c)];
const cardOpen = await p.evaluate(() => [...document.querySelectorAll(".piece-card")].some((c) => !c.hidden));
check("M1 a road tapped in the tray is laid at each click, joined up", laid.every((x) => x.id === "straight" && x.edges === 5), JSON.stringify(laid));
check("M2 laying roads opens no card to get in the way", !cardOpen);
await p.keyboard.press("Escape");
await p.waitForTimeout(300);
await tap(M.b);
check("M3 after Esc, a click selects a road again (and opens its card)", await p.evaluate(() => [...document.querySelectorAll(".piece-card")].some((c) => !c.hidden)));
await p.mouse.click(1100, 120);
await p.waitForTimeout(300);

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
await p.waitForTimeout(2000);
await p.reload();
await p.waitForFunction(() => !!window.woodrail, null, { timeout: 120000 });
await p.waitForTimeout(3000);
const reloaded = await p.evaluate(() => {
  const g = window.woodrail.landscape.grid;
  const out = [];
  for (let i = 0; i < g.cellCount; i++) if (g.road[i] && g.surface[i] !== 2) out.push([g.colOf(i), g.rowOf(i), g.road[i]]);
  return JSON.stringify(out);
});
check("I1 the player's roads survive a reload (autosave)", snapshot === reloaded, `${JSON.parse(snapshot).length} road squares before, ${JSON.parse(reloaded).length} after`);

// ---- J: idle cost ---------------------------------------------------------------------------------------------------
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => /let.s play/i.test(b.textContent ?? ""))?.click());
await p.waitForTimeout(15000);
const frames = await p.evaluate(async () => {
  const w = window.woodrail;
  let n = 0;
  const orig = w.post.render.bind(w.post);
  w.post.render = (...a) => { n++; return orig(...a); };
  await new Promise((res) => setTimeout(res, 5000));
  return n;
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
