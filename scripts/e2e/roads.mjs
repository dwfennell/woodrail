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

// The help card that greets a first visit is taken as read (it would cover the tray, arriving whenever loading's done).
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));

/** The game loaded and on screen: the map entered, the loading screen gone. */
async function ready() {
  await p.waitForFunction(() => !!window.woodrail?.landscape?.grid && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
}

async function boot() {
  await p.goto(URL);
  await ready();
  await helpers();
}

/** Helpers in the page: squares, projection to the screen, toasts collected. */
async function helpers() {
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
  if (!held.startsWith("drag")) {
    const top = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return `${e?.tagName}.${e?.className}`; }, [sx, sy]);
    console.log(`(${label}: not picked up from the tray: ${held}; on top at the press: ${top})`);
    await shot(`not-picked-${label}`);
  }
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

/**
 * Tap square i: the pointer comes to it (a frame to see it there), then a quick press and release, as a finger's tap
 * (a release a slow frame later, under software drawing, would read as a long press).
 */
async function tap(i) {
  // Aimed with the view at rest (a glide still under way would move the square from under the click).
  await settle();
  const [x, y] = await p.evaluate((i) => T.screen(i), i);
  await p.mouse.move(x, y);
  await frame();
  await p.mouse.down();
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
await ready();
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
// Settled (the scene drew nothing for a good while): then count what it draws over 5 s, which should be nothing.
await p.evaluate(() => Promise.race([window.woodrail.settled(30), new Promise((r) => setTimeout(r, 60000))]));
const frames = await p.evaluate(async () => {
  const w = window.woodrail;
  const n = w.framesDrawn;
  await new Promise((res) => setTimeout(res, 5000));
  return w.framesDrawn - n;
});
check("J1 an idle scene with the player's roads, a bridge, ramps and a level crossing draws (next to) no frames", frames <= 1, `${frames} frames drawn in 5 s`);

// ---- K: Game mode's Roads, once learned (roads spec D1, D3, D4) ------------------------------------------------------
// Setup shortcuts (named, not what's under test): the blueprints learned through the game's own `learn` (the study
// skipped); coins given as towns would pay them. The road squares are laid by the player's path: dragged from the tray.
const tabsOf = () => p.evaluate(() => [...document.querySelectorAll(".tab")].map((t) => t.dataset.tab));
const badgeOf = (label) => p.evaluate((label) => [...document.querySelectorAll(".tray-item")].find((b) => b.textContent.includes(label))?.querySelector(".have")?.textContent ?? null, label);
const roadItems = () => p.evaluate(() => [...document.querySelectorAll(".tray-item")].filter((b) => b.offsetParent).map((b) => b.textContent.trim()));
const sandboxTabs = await tabsOf();
await p.goto(URL.replace(/#.*$/, ""));
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await helpers();
const gameTabs = await tabsOf();
check("K1 Game mode's tray has no Roads tab until Roads is learned; Sandbox's does", sandboxTabs.includes("roads") && !gameTabs.includes("roads"), `game: ${gameTabs.join(", ")}; sandbox: ${sandboxTabs.join(", ")}`);
// A free level square on the Game map, well inside the land, with no road beside it.
const spot = await p.evaluate(() => {
  const w = window.woodrail;
  const G = T.g();
  const nb = G.neighbours();
  const corr = new Set(w.landscape.corridors);
  const inner = (i) => [[4, 4], [-4, -4], [4, -4], [-4, 4]].every(([dc, dr]) => G.index(G.colOf(i) + dc, G.rowOf(i) + dr) !== -1);
  const free = (i) => i !== -1 && inner(i) && G.surface[i] === 0 && G.feature[i] === 0 && !corr.has(i) && G.road[i] === 0 && G.height[i] === 0;
  const clear = (i) => [0, 1, 2, 3].every((e) => { const j = nb[i * 4 + e]; return j === -1 || (G.road[j] === 0 && G.surface[j] !== 2); });
  const props = (i) => w.props && [...w.props.all()].some((q) => Math.abs(q.x - G.centreX(G.colOf(i))) < 80 && Math.abs(q.z - G.centreZ(G.rowOf(i))) < 80);
  for (let i = 0; i < G.cellCount; i++) {
    const j = nb[i * 4];
    if (free(i) && free(j) && clear(i) && clear(j) && !props(i) && !props(j) && w.layout.pieceIds().every((id) => { const q = w.layout.getPiece(id).pose; return Math.hypot(q.x - G.centreX(G.colOf(i)), q.z - G.centreZ(G.rowOf(i))) > 400; })) return { a: i, b: j };
  }
  return null;
});
check("K found two free squares on the Game map", !!spot, JSON.stringify(spot));
await p.evaluate(() => {
  const w = window.woodrail;
  w.learn("passengers");
  w.learn("roads");
  w.progress().coins = 5;
  w.hud.setCoins(5);
});
await until(() => !!document.querySelector('.tab[data-tab="roads"]'));
const learnedTabs = await tabsOf();
await p.evaluate(() => document.querySelector('.tab[data-tab="roads"]')?.click());
await p.locator(".tray-item", { hasText: "Straight" }).first().waitFor({ state: "visible", timeout: 20000 });
const shown = await roadItems();
const firstBadge = await badgeOf("Straight");
check("K2 learned, the Roads tab shows its plain roads (no zebra, bridge or ramp yet), each 2🪙", learnedTabs.includes("roads") && shown.some((t) => t.includes("Straight")) && !shown.some((t) => /Zebra|Road bridge|Ramp/.test(t)) && firstBadge === "2🪙", `${learnedTabs.join(", ")}; ${shown.join(", ")}; badge ${firstBadge}`);
await shot("K-game-roads-tab");
if (spot) {
  await focusOn(spot.a);
  const coins0 = await p.evaluate(() => window.woodrail.progress().coins);
  await trayDrag("Straight", spot.a);
  const after = await p.evaluate((i) => ({ road: T.g().road[i], coins: window.woodrail.progress().coins, toasts: T.toasts() }), spot.a);
  check("K3 a straight dragged onto grass is laid and costs 2🪙", after.road !== 0 && after.coins === coins0 - 2 && after.toasts.some((t) => t.includes("2🪙")), JSON.stringify(after));
  await shot("K-game-road-laid");
  // Undone: back in the box (coins kept, as a track piece goes back in the toy box); laid again, free.
  await p.evaluate(() => window.woodrail.editor().undo());
  await frame();
  const undone = await p.evaluate((i) => ({ road: T.g().road[i], coins: window.woodrail.progress().coins }), spot.a);
  const boxBadge = await badgeOf("Straight");
  check("K4 undone, the square goes back in the box: the badge says 1, coins as they were after paying", undone.road === 0 && undone.coins === coins0 - 2 && boxBadge === "1", `${JSON.stringify(undone)}, badge ${boxBadge}`);
  await trayDrag("Straight", spot.b);
  const again = await p.evaluate((i) => ({ road: T.g().road[i], coins: window.woodrail.progress().coins }), spot.b);
  check("K5 laid again from the box: no coins", again.road !== 0 && again.coins === coins0 - 2, JSON.stringify(again));
  // Short of coins, the box empty: refused, said, nothing laid.
  await p.evaluate(() => {
    window.woodrail.progress().coins = 1;
    window.woodrail.hud.setCoins(1);
    T.toasts();
  });
  await trayDrag("Straight", spot.a);
  const refused = await p.evaluate((i) => ({ road: T.g().road[i], coins: window.woodrail.progress().coins, toasts: T.toasts() }), spot.a);
  check("K6 short of coins with the box empty: refused, \"Road: needs 1🪙 more\"", refused.road === 0 && refused.coins === 1 && refused.toasts.includes("Road: needs 1🪙 more"), JSON.stringify(refused));
}
// Crossing gates: the zebra on the tray, and the crossing styles (out of Scenery kit) known.
await p.evaluate(() => window.woodrail.learn("road-crossings"));
await p.locator(".tray-item", { hasText: "Zebra crossing" }).first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
const gates = await p.evaluate(() => ({ zebra: [...document.querySelectorAll(".tray-item")].some((b) => b.offsetParent && b.textContent.includes("Zebra")), styles: ["prop:mech-level-crossing", "prop:mech-gated-crossing"].every((id) => window.woodrail.progress().knows(id)) }));
check("K7 Crossing gates learned: the zebra on the Roads tab, both crossing styles known", gates.zebra && gates.styles, JSON.stringify(gates));
const saved = await p.evaluate(() => window.woodrail.progress().toJSON().roads);
check("K8 the road squares owned are saved with the game", saved >= 1, `roads ${saved}`);

// ---- N: two towns joined by road (roads spec D2) ----------------------------------------------------------------------
// The player's path: auto roads dragged from the tray, square by square, from one town's street to another's, coins
// paid. Setup shortcuts (named): coins given as towns would pay them; the card opened by its handler, as a tap on the
// station does; nine planks put on the town's station pile as a crane does (the delivery isn't what's under test).
const route = await p.evaluate(async () => {
  const { RoadPlacer } = await import("/src/roads/place.ts");
  const { edgesOf, encodeRoad } = await import("/src/roads/pieces.ts");
  const { propsInRect } = await import("/src/props/placement.ts");
  const w = window.woodrail;
  const land = w.landscape;
  const G = land.grid;
  const nb = G.neighbours();
  const placer = new RoadPlacer(land, w.layout, { inRect: (x0, z0, x1, z1) => propsInRect(w.props, w.propLibrary.footprint, x0, z0, x1, z1) });
  const inner = (i) => [[3, 3], [-3, -3], [3, -3], [-3, 3]].every(([dc, dr]) => G.index(G.colOf(i) + dc, G.rowOf(i) + dr) !== -1);
  // A square an auto road can go on whatever shape it takes (a bend too: so no track under it, no station's way in).
  const open = (i) => i !== -1 && inner(i) && G.road[i] === 0 && placer.check(i, encodeRoad("curve", 0)) === null && placer.check(i, encodeRoad("straight", 0)) === null;
  // Where each town's streets end open onto a square a road can go on: town id → [square, height].
  const ends = new Map();
  for (const t of land.towns) {
    const list = [];
    for (const s of t.cells) {
      if (G.surface[s] !== 2 || G.road[s] === 0) continue;
      for (let e = 0; e < 4; e++) if (edgesOf(G.road[s]) & (1 << e)) { const j = nb[s * 4 + e]; if (open(j) && G.height[j] === G.height[s]) list.push(j); }
    }
    ends.set(t.id, list);
  }
  let best = null;
  for (const t of land.towns) {
    const start = ends.get(t.id);
    if (start.length === 0) continue;
    const targets = new Map();
    for (const u of land.towns) if (u.id !== t.id) for (const j of ends.get(u.id)) targets.set(j, u.id);
    const from = new Map(start.map((i) => [i, -1]));
    const queue = [...start];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (targets.has(i)) {
        const path = [];
        for (let k = i; k !== -1; k = from.get(k)) path.unshift(k);
        if (!best || path.length < best.path.length) best = { a: t.id, b: targets.get(i), path };
        break;
      }
      for (let e = 0; e < 4; e++) {
        const j = nb[i * 4 + e];
        if (from.has(j) || !open(j) || G.height[j] !== G.height[i]) continue;
        from.set(j, i);
        queue.push(j);
      }
    }
  }
  if (!best) return null;
  const name = (id) => land.towns.find((t) => t.id === id).name;
  const station = w.world.economy.allDepots().find((d) => d.role === "town" && d.townId === best.a);
  return { ...best, aName: name(best.a), bName: name(best.b), station: station?.id };
});
check("N found a way to lay a road between two towns", !!route && route.path.length <= 60, route ? `${route.aName} to ${route.bName}, ${route.path.length} squares` : "none");
if (route && route.path.length <= 60) {
  await p.evaluate(() => {
    const w = window.woodrail;
    w.progress().coins = 500;
    w.hud.setCoins(500);
    T.toasts();
  });
  const box = await p.evaluate(async () => {
    const { roadsOnMap, roadsSpare } = await import("/src/game/road-box.ts");
    return roadsSpare(window.woodrail.progress().roads, roadsOnMap(window.woodrail.landscape.grid));
  });
  for (const i of route.path) {
    await focusOn(i);
    await trayDrag("Road", i);
  }
  const after = await p.evaluate(async ({ path, a }) => {
    const { townLinks } = await import("/src/roads/graph.ts");
    const w = window.woodrail;
    return { laid: path.filter((i) => T.g().road[i] !== 0).length, coins: w.progress().coins, links: townLinks(w.landscape).get(a) ?? [] };
  }, route);
  const paid = 2 * Math.max(0, route.path.length - box);
  check("N1 every square laid from the tray, each beyond the box for 2🪙", after.laid === route.path.length && after.coins === 500 - paid, `${after.laid}/${route.path.length} laid, coins ${after.coins} (expected ${500 - paid})`);
  check(`N2 ${route.aName} and ${route.bName} are joined by road`, after.links.includes(route.b), JSON.stringify(after.links));
  await shot("N-joined");
  await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), route.station);
  await until((n) => [...document.querySelectorAll(".ledger-rows")].some((r) => r.textContent.includes(`Joined by road to ${n}`)), route.bName);
  const card = await p.evaluate(() => [...document.querySelectorAll(".ledger-rows")].map((r) => r.textContent).join(" | "));
  check("N3 the town's card says \"Joined by road to …: grows faster\"", card.includes(`Joined by road to ${route.bName}`) && card.includes("grows faster"), card);
  await shot("N-card");
  await until(() => window.woodrail.stickers().has("road-link"));
  const sticker = await p.evaluate(() => window.woodrail.stickers().has("road-link"));
  check("N4 the \"On the road\" sticker is earned", sticker);
  // The payoff: what the joined town receives counts a ninth more toward growing.
  const growth = await p.evaluate(async ({ a, station }) => {
    const { growthOf, receivedBy } = await import("/src/game/town-life.ts");
    const w = window.woodrail;
    const e = w.world.economy;
    const before = { got: receivedBy(w.world, a).planks ?? 0, growth: growthOf(w.world, a).planks ?? 0 };
    for (let k = 0; k < 9; k++) e.put({ kind: "pile", depotId: station, cargo: "planks" }, "planks");
    return { before, after: { got: receivedBy(w.world, a).planks ?? 0, growth: growthOf(w.world, a).planks ?? 0 }, roadGot: e.roadGot.get(a) };
  }, route);
  check("N5 nine planks delivered to the joined town count as ten toward its growth", growth.after.got - growth.before.got === 9 && growth.after.growth - growth.before.growth === 10, JSON.stringify(growth));
}

// ---- V: a van that only drives (roads spec step 4) -------------------------------------------------------------------
// The vehicle layer on the road just laid between the two towns. Setup shortcuts (named): in step 4 nothing in play
// sends a van yet (D5 does), so the show van is sent by `vans.drive`; the game is ticked ahead in `evaluate` where only
// the trip's end matters (software drawing runs the game slowly: the sim is capped at 0.1 s a frame).
if (route && route.path.length <= 60) {
  const ahead = (seconds) => p.evaluate((n) => { const w = window.woodrail; for (let k = 0; k < n; k++) { w.sim.tick(); w.economy.tick(); } }, Math.round(seconds * 120));
  const van = () => p.evaluate(() => { const w = window.woodrail; const v = w.economy.roadVehicles.list[0]; return v ? { leg: v.leg, sq: w.landscape.grid.cellAtWorld(v.x, v.z), x: v.x, z: v.z, t: v.t } : null; });
  const sent = await p.evaluate(({ a, b }) => window.woodrail.vans.drive(a, b), route);
  const home = await p.evaluate((a) => window.woodrail.vans.homeOf(a), route.a);
  // Drawn while it drives in view (frames come from the van alone: no train runs).
  await p.evaluate(() => { const w = window.woodrail; const v = w.economy.roadVehicles.list[0]; const V = w.camera.position.constructor; w.director.focus(new V(v.x, v.y, v.z), 260); });
  await settle().catch(() => {});
  // (Up to 30 s for it to move and be drawn: software drawing manages about a frame a second here.)
  const drawn = await p.evaluate(async () => {
    const w = window.woodrail;
    const v = w.economy.roadVehicles.list[0];
    const f = w.framesDrawn;
    const t = v.t;
    for (let k = 0; k < 300 && !(w.framesDrawn > f && v.t > t); k++) await new Promise((r) => setTimeout(r, 100));
    return { frames: w.framesDrawn - f, moved: v.t - t, leg: v.leg };
  });
  // (The scene had settled: any frame drawn is the van's.)
  check("V1 a van sent from the station drives out along the road, drawn as it goes", sent && drawn.frames >= 1 && drawn.moved > 0, `${JSON.stringify(drawn)}, sent ${sent}`);
  await shot("V-van-driving");
  // The payoff: it gets to the other town's streets, and back home, where it parks.
  const there = await p.evaluate(({ b }) => {
    const w = window.woodrail;
    const v = w.economy.roadVehicles.list[0];
    const cells = new Set(w.landscape.towns.find((t) => t.id === b).cells);
    for (let k = 0; k < 120 * 120 && v.leg === "out"; k++) { w.sim.tick(); w.economy.tick(); }
    return { leg: v.leg, inTown: cells.has(w.landscape.grid.cellAtWorld(v.x, v.z)) };
  }, route);
  await ahead(60);
  const back = await van();
  check(`V2 it reaches ${route.bName}'s streets, comes back and parks by the station`, there.leg === "there" && there.inTown && back.leg === "home" && back.sq === home, `${JSON.stringify(there)} → ${JSON.stringify(back)} (home ${home})`);
  // Parked: a still instance, no frames.
  await p.evaluate(() => Promise.race([window.woodrail.settled(30), new Promise((r) => setTimeout(r, 60000))]));
  const idle = await p.evaluate(async () => {
    const w = window.woodrail;
    const n = w.framesDrawn;
    await new Promise((res) => setTimeout(res, 5000));
    return w.framesDrawn - n;
  });
  check("V3 with the van parked, an idle scene draws (next to) no frames", idle <= 1, `${idle} frames drawn in 5 s`);
  // Measured on a 360×740 phone view: eight vans on the move (seven more sent the same way: a measuring shortcut).
  await p.setViewportSize({ width: 360, height: 740 });
  await settle().catch(() => {});
  const measured = await p.evaluate(async ({ a, b }) => {
    const w = window.woodrail;
    const rv = w.economy.roadVehicles;
    const vans = w.vans;
    const home = vans.homeOf(a);
    const cells = new Set(w.landscape.towns.find((t) => t.id === b).cells);
    const G = w.landscape.grid;
    const extra = [];
    vans.drive(a, b);
    for (let k = 0; k < 7; k++) {
      for (let j = 0; j < 40; j++) w.economy.tick();
      const v = vans.park("van", home);
      extra.push(v);
      vans.send(v, { home, goalKey: `town${b}`, goal: (i) => cells.has(i) && G.surface[i] === 2, reach: 64, to: -1 });
    }
    const first = rv.list[0];
    const V = w.camera.position.constructor;
    w.director.focus(new V(first.x, first.y, first.z), 500);
    await new Promise((r) => setTimeout(r, 1500));
    let viewMs = 0;
    let tickMs = 0;
    let ticks = 0;
    const view = w.roadVehiclesView;
    const upd = view.update;
    view.update = function (...args) { const t0 = performance.now(); const r = upd.apply(this, args); viewMs += performance.now() - t0; return r; };
    const tick = rv.tick;
    rv.tick = function (dt) { const t0 = performance.now(); tick.call(this, dt); tickMs += performance.now() - t0; ticks++; };
    const f0 = w.framesDrawn;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 5000));
    const frames = w.framesDrawn - f0;
    const ms = performance.now() - t0;
    const out = { moving: rv.moving, frames, msPerFrame: +(ms / Math.max(1, frames)).toFixed(1), vehiclesMsPerFrame: +((viewMs + tickMs) / Math.max(1, frames)).toFixed(3), tickUs: +((tickMs * 1000) / Math.max(1, ticks)).toFixed(2), drawCalls: view.drawCalls, shadowsCast: view.group.children.some((m) => m.castShadow) };
    delete view.update;
    delete rv.tick;
    for (const v of extra) rv.remove(v);
    return out;
  }, route);
  console.log(`(measured, 360×740, software drawing: ${JSON.stringify(measured)})`);
  check("V4 eight vans moving: a few draw calls in all, no shadow casters, under a millisecond a frame for the vehicles", measured.moving === 8 && measured.drawCalls <= 6 && !measured.shadowsCast && measured.vehiclesMsPerFrame < 1, JSON.stringify(measured));
  await shot("V-eight-vans-phone");
  await p.setViewportSize({ width: 1200, height: 800 });
  await ahead(90);
  // A road taken up ahead of it (the player's path: Undo takes back the last square laid, the one beside Elderwick's
  // street, with the game paused for it): it turns back and comes home. Redo lays it again.
  await p.evaluate(({ a, b }) => window.woodrail.vans.drive(a, b), route);
  await ahead(1);
  const cut = route.path[route.path.length - 1];
  await p.evaluate(() => {
    window.woodrail.paused = true;
    window.woodrail.interaction.undo();
  });
  await until((i) => T.g().road[i] === 0, cut);
  const cutDone = await road(cut);
  // (Unpaused, a tick at a time: the leg it takes once the edit is seen.)
  const turned = await p.evaluate(() => {
    const w = window.woodrail;
    w.paused = false;
    const v = w.economy.roadVehicles.list[0];
    for (let k = 0; k < 120 && v.leg === "out"; k++) {
      w.sim.tick();
      w.economy.tick();
    }
    return { leg: v.leg, sq: w.landscape.grid.cellAtWorld(v.x, v.z), t: v.t };
  });
  await ahead(60);
  const home2 = await van();
  check("V5 the road ahead taken up mid-trip (Undo): the van turns back and comes home", cutDone === 0 && turned.leg === "back" && home2.leg === "home" && home2.sq === home, `cut ${cutDone}, ${JSON.stringify(turned)} → ${JSON.stringify(home2)}`);
  await p.evaluate(() => window.woodrail.interaction.redo());
  await until((i) => T.g().road[i] !== 0, cut);
  check("V6 Redo lays it again: the towns are joined", (await road(cut)) !== 0 && (await p.evaluate(async ({ a, b }) => (await import("/src/roads/graph.ts")).townLinks(window.woodrail.landscape).get(a)?.includes(b), route)));
}

// ---- W: delivery vans (roads spec D5) ---------------------------------------------------------------------------------
// The player's path for what's tested: Delivery vans learned, the station put on the line, a train's wagons unloaded at
// it by the crane, the van taking the share for the town off the line there, and that town receiving it and growing.
// Setup shortcuts (named, not what's tested): the blueprint learned through the game's own `learn` (the study skipped);
// the step-4 show van taken away; the track to the forest laid by the player's own pathfinder (`play`, as the warehouse
// e2e does); a train of planks put down by the station as the tray would, its wagons loaded as the sawmill's crane
// loads them; the game ticked ahead in `evaluate` (software drawing is slow).
if (route && route.path.length <= 60) {
  const vanState = () => p.evaluate((a) => {
    const w = window.woodrail;
    const d = w.economy.allDepots().find((x) => x.role === "town" && x.townId === a);
    const v = w.economy.roadVehicles.list.find((x) => x.data?.depotId === d.id);
    return { vans: w.economy.roadVehicles.list.length, leg: v?.leg ?? null, yard: w.economy.vanYard.get(d.id) ?? null, depot: d.id };
  }, route.a);
  await p.evaluate(() => {
    const w = window.woodrail;
    w.economy.roadVehicles.clear();
    w.learn("warehouses");
    w.learn("vans");
  });
  // A second for the once-a-second update to look.
  await p.waitForTimeout(1500);
  const before = await vanState();
  check(`W1 Delivery vans learned, but ${route.aName}'s station isn't on the line yet: no van`, before.vans === 0, JSON.stringify(before));
  const laid = await p.evaluate(async (a) => {
    const { play } = await import("/src/play/player.ts");
    const { rulesFor } = await import("/src/play/rules.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    const w = window.woodrail;
    const station = w.world.stations.get(a);
    const forest = [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === "depot-forest");
    for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
      const r = play(w.world.layout, w.editor(), connectorRef(station, i), connectorRef(forest, j), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 });
      if (r.ok) return { ok: true, end: i };
    }
    return { ok: false };
  }, route.a);
  await until((a) => {
    const w = window.woodrail;
    const d = w.economy.allDepots().find((x) => x.role === "town" && x.townId === a);
    return w.economy.roadVehicles.list.some((x) => x.data?.depotId === d.id);
  }, route.a);
  const parked = await vanState();
  check(`W2 its station on the line, a van parks by it (for ${route.bName}, off the line)`, laid.ok && parked.vans === 1 && parked.leg === "home", `${JSON.stringify(laid)} ${JSON.stringify(parked)}`);
  await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), parked.depot);
  await until((n) => [...document.querySelectorAll(".ledger-rows")].some((r) => r.textContent.includes(`Van to ${n}`)), route.bName);
  const vanCard = await p.evaluate(() => [...document.querySelectorAll(".ledger-rows")].map((r) => r.textContent).join(" | "));
  check(`W3 the station's card says "Van to ${route.bName} (off the line)"`, vanCard.includes(`Van to ${route.bName} (off the line)`), vanCard);
  await p.keyboard.press("Escape");
  // A train of planks stops at the station; the crane unloads it.
  const fed = await p.evaluate(async ({ a, b, end }) => {
    const { growthOf, receivedBy } = await import("/src/game/town-life.ts");
    const { townStatus } = await import("/src/game/towns.ts");
    const w = window.woodrail;
    const station = w.world.stations.get(a);
    const d = w.economy.allDepots().find((x) => x.role === "town" && x.townId === a);
    const lacks = (t) => { const s = townStatus(growthOf(w.world, t)); return { level: s.level, planks: (s.wants.planks ?? 0) - (s.got.planks ?? 0) }; };
    const b0 = { ...lacks(b), got: receivedBy(w.world, b).planks ?? 0 };
    let engine = -1;
    for (const reversed of [false, true]) {
      for (const s of [0, 20, 40, 60, 80]) {
        const r = w.sim.addTrain(["engine", "timber", "timber", "timber"], { pieceId: station, pathIndex: 0, reversed, s });
        if (r.kind !== "placed") continue;
        const t = w.sim.getTrain(r.trainId);
        for (const c of t.cars.slice(1)) w.economy.setCargo(c.id, "planks", 3);
        engine = t.cars[0].id;
        break;
      }
      if (engine !== -1) break;
    }
    // Off toward the forest: it passes the crane.
    w.sim.setLever(engine, 1);
    let left = 0;
    const out = { unloaded: 0, vanLeft: false };
    for (let k = 0; k < 120 * 90; k++) {
      w.sim.tick();
      w.economy.tick();
      for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === d.id) out.unloaded++;
      const v = w.economy.roadVehicles.list[0];
      if (v && v.leg === "out") out.vanLeft = true;
      if (out.vanLeft && v.leg === "home") break;
    }
    w.invalidate();
    return { b0, engine, ...out, yard: w.economy.vanYard.get(d.id) ?? null };
  }, { a: route.a, b: route.b, end: laid.end });
  check(`W4 a train's planks unloaded at ${route.aName}: the van loads its share and drives off`, fed.unloaded > 0 && fed.vanLeft, JSON.stringify(fed));
  await p.waitForTimeout(1500);
  const after = await p.evaluate(async (b) => {
    const { growthOf, receivedBy } = await import("/src/game/town-life.ts");
    const { townStatus } = await import("/src/game/towns.ts");
    const w = window.woodrail;
    const s = townStatus(growthOf(w.world, b));
    return { level: s.level, got: receivedBy(w.world, b).planks ?? 0, coins: w.progress().coins };
  }, route.b);
  const got = after.got - fed.b0.got;
  check(`W5 ${route.bName}, off the line, receives the planks by van${fed.b0.planks <= got ? " and grows" : ""}`, got > 0 && got <= 8 && (fed.b0.planks > got || after.level > fed.b0.level), `${got} planks; level ${fed.b0.level} → ${after.level} (it lacked ${fed.b0.planks})`);
  await shot("W-van-delivered");
  await p.evaluate((b) => {
    const w = window.woodrail;
    const d = w.economy.allDepots().find((x) => x.role === "town" && x.townId === b);
    w.interaction.openDepotCard(d.id);
  }, route.b);
  await until((n) => [...document.querySelectorAll(".ledger-rows")].some((r) => r.textContent.includes(`Goods by van from ${n}`)), route.aName);
  const bCard = await p.evaluate(() => [...document.querySelectorAll(".ledger-rows")].map((r) => r.textContent).join(" | "));
  check(`W6 ${route.bName}'s card says "Goods by van from ${route.aName}"`, bCard.includes(`Goods by van from ${route.aName}`), bCard);
  await p.keyboard.press("Escape");
}

// ---- X: buses (roads spec D6) -----------------------------------------------------------------------------------------
// The player's path for what's tested: Buses learned, the bus stop dragged from the tray beside the station on the line,
// the bus fetching the people waiting in the town off the line, and them waiting at the station for a train. Setup
// shortcuts (named): Halts and Buses learned through `learn` (the study skipped); people turned up at the stations as the
// once-a-second update has them (`peopleArrive` run for a minute's worth); the station's own people taken (as a coach
// boards them) so there's room; the game ticked ahead in `evaluate`.
if (route && route.path.length <= 60) {
  await p.evaluate(() => {
    const w = window.woodrail;
    w.learn("halts");
    w.learn("buses");
  });
  // (The Industries tab shows its shelves as folders: the Lineside one opened, as a tap does.)
  // (Pressed with the pointer, scrolled into view first: the Lineside shelf is the last on the tab, as kits-game does.)
  const press = async (selector, text) => {
    const at = await p.evaluate(
      ({ selector, text }) => {
        const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().startsWith(text) && e.getBoundingClientRect().width > 0);
        if (!el) return null;
        el.scrollIntoView({ inline: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      { selector, text },
    );
    if (at) await p.mouse.click(at.x, at.y);
    return !!at;
  };
  const openLineside = async () => {
    await p.evaluate(() => document.querySelector('.tab[data-tab="industries"]')?.click());
    await p.locator(".tray-item.tray-group", { hasText: "Lineside" }).first().waitFor({ state: "attached", timeout: 20000 }).catch(() => {});
    await press(".tray-item.tray-group", "Lineside");
    await p.locator(".tray-item", { hasText: "Bus stop" }).first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
    await p.evaluate(() => [...document.querySelectorAll(".tray-item")].find((b) => b.textContent.includes("Bus stop"))?.scrollIntoView({ inline: "center" }));
  };
  // (W's Elderwick grew: its "grew! Pick one" sheet is up over the tray. Closed with its ✕, as a player does: the offer
  // waits with a badge.)
  const sheetClose = await p.evaluate(() => {
    const b = document.querySelector(".growth-sheet:not([hidden]) .close");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (sheetClose) {
    await p.mouse.click(sheetClose.x, sheetClose.y);
    await p.waitForFunction(() => document.querySelector(".growth-sheet")?.hidden !== false, null, { timeout: 10000 }).catch(() => {});
  }
  await openLineside();
  const shelf = await p.evaluate(() => [...document.querySelectorAll(".tray-item")].some((b) => b.offsetParent && b.textContent.includes("Bus stop")));
  check("X1 Buses learned: the bus stop is on the Industries tab's Lineside shelf", shelf);
  // Squares beside the station, nearest first, open grass (the prop's own rules say where it may go).
  const spots = await p.evaluate((a) => {
    const w = window.woodrail;
    const G = T.g();
    const pose = w.layout.getPiece(w.world.stations.get(a)).pose;
    const out = [];
    for (let i = 0; i < G.cellCount; i++) {
      const d = Math.hypot(G.centreX(G.colOf(i)) - pose.x, G.centreZ(G.rowOf(i)) - pose.z);
      if (d < 220 && G.surface[i] === 0 && G.feature[i] === 0 && G.road[i] === 0) out.push([d, i]);
    }
    return out.sort((x, y) => x[0] - y[0]).map((x) => x[1]).slice(0, 6);
  }, route.a);
  const propsNow = () => p.evaluate(() => [...window.woodrail.props.all()].filter((q) => q.asset === "scene-bus-stop").length);
  let placed = false;
  for (const i of spots) {
    const n0 = await propsNow();
    await focusOn(i, 600);
    if (!(await p.evaluate(() => [...document.querySelectorAll(".tray-item")].some((b) => b.offsetParent && b.textContent.includes("Bus stop"))))) await openLineside();
    const btn = p.locator(".tray-item", { hasText: "Bus stop" }).first();
    const box = await btn.boundingBox({ timeout: 20000 }).catch(() => null);
    if (!box) break;
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    // (As `trayDrag`: lifted off the tray, in hand, carried over, aimed again, let go.)
    await p.mouse.move(sx, sy);
    await p.mouse.down();
    for (let k = 1; k <= 4; k++) {
      await p.mouse.move(sx, sy - 20 * k);
      await frame();
    }
    await until(() => window.woodrail.interaction.mode.kind.startsWith("drag"));
    const [x, y] = await p.evaluate((i) => T.screen(i), i);
    for (let k = 1; k <= 10; k++) {
      await p.mouse.move(sx + ((x - sx) * k) / 10, sy - 80 + ((y - sy + 80) * k) / 10);
      await frame();
    }
    for (let k = 0; k < 2; k++) {
      await frame();
      const [ax, ay] = await p.evaluate((i) => T.screen(i), i);
      await p.mouse.move(ax, ay);
      await frame();
    }
    await p.mouse.up();
    await until((n0) => [...window.woodrail.props.all()].filter((q) => q.asset === "scene-bus-stop").length > n0, n0);
    if ((await propsNow()) > n0) {
      placed = true;
      break;
    }
  }
  await until((a) => {
    const w = window.woodrail;
    return w.economy.roadVehicles.list.some((v) => v.kind === "bus");
  }, route.a);
  const bus0 = await p.evaluate(() => window.woodrail.economy.roadVehicles.list.filter((v) => v.kind === "bus").map((v) => v.leg));
  check(`X2 the bus stop dropped beside ${route.aName}'s station: a bus parks there`, placed && bus0.length === 1, `placed ${placed}, buses ${JSON.stringify(bus0)}`);
  await shot("X-bus-stop");
  const ready = await p.evaluate(async ({ a, b }) => {
    const { peopleArrive } = await import("/src/game/passengers.ts");
    const w = window.woodrail;
    const st = (t) => w.economy.allDepots().find((d) => d.role === "town" && d.townId === t && w.world.stations.get(t) === d.pieceId);
    peopleArrive(w.world, w.progress(), 60, new Map());
    st(a).waiting = 0;
    return { far: st(b).waiting, home: st(a).waiting };
  }, route);
  // The bus looks once a second (with people arriving): it gets ready and goes.
  await until(() => window.woodrail.economy.roadVehicles.list.some((v) => v.kind === "bus" && v.leg !== "home"));
  const fetched = await p.evaluate(({ a, b }) => {
    const w = window.woodrail;
    const st = (t) => w.economy.allDepots().find((d) => d.role === "town" && d.townId === t && w.world.stations.get(t) === d.pieceId);
    const bus = w.economy.roadVehicles.list.find((v) => v.kind === "bus");
    let wasOut = false;
    for (let k = 0; k < 120 * 60; k++) {
      w.sim.tick();
      w.economy.tick();
      if (bus.leg === "out") wasOut = true;
      if (wasOut && (bus.leg === "home" || bus.leg === "loading")) break;
    }
    w.invalidate();
    return { wasOut, leg: bus.leg, far: st(b).waiting, home: st(a).waiting };
  }, route);
  check(`X3 the bus brings ${route.bName}'s waiting people to ${route.aName}'s station, to wait for a train`, ready.far > 0 && fetched.wasOut && fetched.home > ready.home && fetched.far < ready.far, `${JSON.stringify(ready)} → ${JSON.stringify(fetched)}`);
  await shot("X-bus-back");
  await p.evaluate((a) => {
    const w = window.woodrail;
    const d = w.economy.allDepots().find((x) => x.role === "town" && x.townId === a && w.world.stations.get(a) === x.pieceId);
    w.interaction.openDepotCard(d.id);
  }, route.a);
  await until((n) => [...document.querySelectorAll(".ledger-rows")].some((r) => r.textContent.includes(`Bus from ${n}`)), route.bName);
  const busCard = await p.evaluate(() => [...document.querySelectorAll(".ledger-rows")].map((r) => r.textContent).join(" | "));
  check(`X4 the station's card says "Bus from ${route.bName}: brings people to your trains"`, busCard.includes(`Bus from ${route.bName}: brings people to your trains`), busCard);
  await p.keyboard.press("Escape");
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await b.close();
await server.close();
process.exit(failed === 0 ? 0 : 1);
