// End-to-end tests for drawing track (`npm run e2e:draw`): the game in a headless browser on seed 7, the Draw chip
// switched on, lines drawn with real mouse drags, each result read back from the layout. Starts its own dev server.
// Screenshots go to the folder given as the first argument (default: e2e-out/). Chromium as for e2e:roads.
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const OUT = process.argv[2] ?? "e2e-out";
mkdirSync(OUT, { recursive: true });
// Any free port (other dev servers may be running).
const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
// Have the dev server find and pre-bundle the game's dependencies now, so it doesn't reload the page mid-test.
await server.warmupRequest("/src/main.ts");
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const T0 = Date.now();
const step = (name) => console.log(`...   ${((Date.now() - T0) / 1000).toFixed(0)}s  ${name}`);
const results = [];
/** A screenshot for looking at afterwards: never fails the run (under load one can wait a long time on fonts). */
const shot = async (page, path) => {
  try {
    await page.screenshot({ path, timeout: 60000 });
  } catch (e) {
    console.log(`(no screenshot ${path}: ${String(e?.message ?? e).split("\n")[0]})`);
  }
};
/** Click by selector without Playwright's wait for the page to be "stable" (the game's view is never still while it animates). */
const tapSel = async (page, sel) => {
  await page.waitForSelector(sel, { state: "attached", timeout: 120000 });
  await page.evaluate((sel) => document.querySelector(sel).click(), sel);
};
/** The scene has been still a few ticks (the game's own hook), within a generous cap: no fixed waits. */
const settled = (page) =>
  page.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((_, no) => setTimeout(() => no(new Error("never settled")), 120000))]));
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));

/** Load the game and start playing (condition waits: software rendering under load can be slow). */
const boot = async (page, tries = 3) => {
  // (A start that stalls, or a page the dev server reloads while starting: start again.)
  try {
    await bootOnce(page);
  } catch (e) {
    if (tries <= 1) throw e;
    console.log(`(boot again: ${String(e?.message ?? e).split("\n")[0]})`);
    await boot(page, tries - 1);
  }
};
const bootOnce = async (page) => {
  // (From another page first: going to the URL the page is already on, hash and all, doesn't load it again.)
  if (page.url() !== "about:blank") await page.goto("about:blank");
  await page.goto(URL);
  await page.waitForFunction(() => !!window.woodrail && [...document.querySelectorAll("button")].some((b) => /let.s play/i.test(b.textContent ?? "")), null, { timeout: 180000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /let.s play/i.test(b.textContent ?? ""))?.click());
  await page.waitForFunction(() => document.querySelector(".tray-draw") !== null && window.woodrail.layout.pieceCount > 0, null, { timeout: 60000 });
  // A new player's opening camera move (if any) has finished, so it doesn't undo the test's framing.
  await page.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
};
await boot(p);
/** The page's test helpers: toasts kept, and `D` (screen points, piece and joint counts). */
const installD = (page) =>
  page.evaluate(() => {
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
await installD(p);

/** Only the ramps and bridges cases (E2E_ONLY=specials): quick to run on their own. */
const ONLY_SPECIALS = process.env.E2E_ONLY === "specials";

// Favourites: first on the Track tab, a ★ on a shelf's piece adds it, and it's remembered.
if (!process.env.E2E_ONLY) {
  await p.evaluate(() => localStorage.removeItem("woodrail.favourites"));
  await tapSel(p, ".tabs [data-tab=track]");
  const favs = await p.$$eval(".scroller > .tray-item:not(.tray-group)", (bs) => bs.map((b) => b.querySelector(".label")?.textContent));
  check("the Track tab shows favourites before its shelves", favs.length === 5, favs.join(", "));
  await shot(p, `${OUT}/fav-0-row.png`);
  await p.click(".scroller .tray-group:has-text('Curve')", { timeout: 120000, force: true });
  await p.click(".scroller .tray-item:has-text('Wide curve') .fav", { timeout: 120000, force: true });
  await tapSel(p, ".tabs [data-tab=track]");
  const after = await p.$$eval(".scroller > .tray-item:not(.tray-group)", (bs) => bs.map((b) => b.querySelector(".label")?.textContent));
  const saved = await p.evaluate(() => localStorage.getItem("woodrail.favourites") ?? "");
  check("★ on a shelf's piece adds it to the favourites, and it's saved", after.at(-1) === "Wide curve" && saved.includes("curve-wide"), after.join(", "));
  await p.click(".scroller > .tray-item:has-text('Wide curve') .fav", { timeout: 120000, force: true });
  const removed = await p.$$eval(".scroller > .tray-item:not(.tray-group)", (bs) => bs.length);
  check("★ again on the favourites row takes it off", removed === 5, `${removed}`);
}

// A drag up on a shelf (not opened) takes out its first piece: the first thing a new player tries.
if (!process.env.E2E_ONLY) {
  await tapSel(p, ".tabs [data-tab=track]");
  const shelf = await p.$(".scroller .tray-group:has-text('Curve')");
  const box = await shelf.boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.down();
  for (let k = 1; k <= 12; k++) await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - k * 25);
  const held = await p.evaluate(() => window.woodrail.interaction.mode.kind === "drag-piece" && window.woodrail.interaction.mode.type);
  await p.keyboard.press("Escape");
  await p.mouse.up();
  check("a drag up on a shelf takes out its first piece", held === "curve-large", String(held));
}

/** A free end of track on level ground with clear, level, empty land ahead of it (found from the map). */
const site = await p.evaluate(async () => {
  const w = window.woodrail;
  const { connectorRef, createWorldConnector } = await import("/src/track/layout.ts");
  const G = w.landscape.grid;
  const c = createWorldConnector();
  for (const id of w.layout.pieceIds()) {
    const piece = w.layout.getPiece(id);
    for (let i = 0; i < 4; i++) {
      const ref = connectorRef(id, i);
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

/**
 * Frame the view on (x, z) with about `r` mm round it in view: one glide straight there (a focus only ever comes 30%
 * closer), waited out (software rendering can be slow, a phone's 2x screen more so).
 */
const focus = async (x, z, r = 320, page = p) => {
  await page.evaluate(async ([x, z, r]) => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    w.director.glideTo(new w.camera.position.constructor(x, 0, z), frameDistance(r, w.camera.fov, w.camera.aspect), { duration: 0.3 });
  }, [x, z, r]);
  await page.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
};
/** Drag the mouse through world points (x, z) on the ground (or (x, z, y), up at height y), a few px a step. */
const drawThrough = async (pts, { shotAt = -1, shotName = "", stepPx = 14 } = {}) => {
  const screen = await p.evaluate((pts) => pts.map(([x, z, y = 0]) => D.screen(x, y, z)), pts);
  await p.mouse.move(screen[0][0], screen[0][1]);
  await p.mouse.down();
  for (let i = 1; i < screen.length; i++) {
    const [ax, ay] = screen[i - 1];
    const [bx, by] = screen[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / stepPx));
    for (let k = 1; k <= n; k++) await p.mouse.move(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    if (i === shotAt) await shot(p, `${OUT}/${shotName}`);
  }
  // The ghosts showing just before the finger lifts: what goes down must be exactly these.
  const shown = await p.evaluate(() => window.woodrail.interaction.draw.line?.pieces.length ?? 0);
  await p.mouse.up();
  // The line's pieces have settled (their flourishes done).
  await settled(p);
  return shown;
};

if (ONLY_SPECIALS) {
  await specials();
  await finishRun();
}

/** Only the junctions (N2 phase 2: a branch, a merge) and the planning guard (E2E_ONLY=junctions). */
if (process.env.E2E_ONLY === "junctions") {
  await junctions(false);
  await loopOffStraight();
  await finishRun();
}

/** Only the passing loop off a straight (E2E_ONLY=loop). */
if (process.env.E2E_ONLY === "loop") {
  await loopOffStraight();
  await finishRun();
}

/** Only QA's terrace 2 drawn again on one page (E2E_ONLY=terrace-repeat): a part of qa-slant, quick on its own. */
if (process.env.E2E_ONLY === "terrace-repeat") {
  await terraceRepeat();
  await finishRun();
}

/** Only the phone on its side, a straight swipe off the grid (E2E_ONLY=phone): step 7b on its own. */
if (process.env.E2E_ONLY === "phone") {
  await phoneSwipe();
  await finishRun();
}

/** Only QA's replay of the slanted river crossings and the terrace climb (E2E_ONLY=qa-slant). */
if (process.env.E2E_ONLY === "qa-slant") {
  await qaReplay();
  await finishRun();
}

if (site) {
  const { x, z, heading: h } = site;
  const fx = Math.cos(h);
  const fz = Math.sin(h);
  // Left of the way the line runs.
  const lx = -fz;
  const lz = fx;
  await focus(x + fx * 250, z + fz * 250);
  // Switch drawing on with the chip.
  await tapSel(p, ".tray-draw");
  const on = await p.evaluate(() => window.woodrail.interaction.isDrawing);
  check("the Draw chip switches drawing on", on);

  // 1. Straight on from the free end.

  step("1");
  const before = await p.evaluate(() => [D.pieces(), D.joints()]);
  const line = [0, 100, 200, 300, 400].map((d) => [x + fx * d, z + fz * d]);
  await drawThrough(line, { shotAt: 3, shotName: "draw-1-midway.png" });
  await shot(p, `${OUT}/draw-1-laid.png`);
  const after = await p.evaluate(() => [D.pieces(), D.joints()]);
  const added = after[0] - before[0];
  check("a straight stroke from a free end lays track", added >= 2, `${added} pieces`);
  check("the drawn pieces are joined to the track and each other", after[1] - before[1] === added, `${after[1] - before[1]} joints for ${added} pieces`);

  // 2. One undo takes the whole line back up.

  step("2");
  await p.evaluate(() => window.woodrail.interaction.undo());
  const undone = await p.evaluate(() => D.pieces());
  check("one undo takes the whole line up", undone === before[0], `${undone} vs ${before[0]}`);

  // 3. A turn: straight on, then round to one side (the other side if a hill or a river is in the way of the first).

  step("3");
  const r = 180;
  let types = [];
  let curves = 0;
  let said = [];
  for (const turnSide of [1, -1]) {
    const tx = lx * turnSide;
    const tz = lz * turnSide;
    const turn = [];
    for (let d = 0; d <= 200; d += 25) turn.push([x + fx * d, z + fz * d]);
    for (let a = 0; a <= Math.PI / 2; a += Math.PI / 16) {
      const along = 200 + r * Math.sin(a);
      const side = r * (1 - Math.cos(a));
      turn.push([x + fx * along + tx * side, z + fz * along + tz * side]);
    }
    const n0 = await p.evaluate(() => D.pieces());
    await focus(x + fx * 250 + tx * 120, z + fz * 250 + tz * 120, 380);
    await drawThrough(turn, { shotAt: turn.length - 2, shotName: "draw-2-turn-midway.png" });
    await shot(p, `${OUT}/draw-2-turn.png`);
    types = await p.evaluate((n0) => [...window.woodrail.layout.pieceIds()].slice(n0).map((id) => window.woodrail.layout.getPiece(id).type), n0);
    curves = types.filter((t) => t.startsWith("curve")).length;
    said = await p.evaluate(() => D.toasts());
    if (types.length > 0) await p.evaluate(() => window.woodrail.interaction.undo());
    if (curves >= 2) break;
  }
  check("a stroke that turns lays curves", curves >= 2, `${types.join(" ")}${said.length ? ` · toasts: ${said.join(" | ")}` : ""}`);

  // 4. Retracing takes ghosts off: out and back to the start lays nothing.

  step("4");
  const n0 = await p.evaluate(() => D.pieces());
  const outBack = [...[0, 150, 300, 450, 600].map((d) => [x + fx * d, z + fz * d]), ...[450, 300, 150, 10].map((d) => [x + fx * d, z + fz * d])];
  await drawThrough(outBack);
  const n1 = await p.evaluate(() => D.pieces());
  check("drawing out and back again lays nothing", n1 === n0, `${n1 - n0} pieces`);
  // The same with dense points (a finger's), stopping a little short of the start (the unit tests cover the other
  // stopping points: each mouse move is slow in software rendering).
  await focus(x + fx * 300, z + fz * 300, 700);
  // QA's cases: back to 40 mm short of the start, 5 mm to one side; and lifted halfway back, 8 mm to one side. Either
  // way, what's laid is exactly the ghosts showing before the lift.
  for (const [stop, side] of [[40, 5], [200, 8]]) {
    const dense = [...[0, 150, 300, 450, 600].map((d) => [x + fx * d, z + fz * d]), ...[...[450, 300, 150].filter((d) => d > stop), stop].map((d) => [x + fx * d + lx * side, z + fz * d + lz * side])];
    const shown = await drawThrough(dense, { stepPx: 4 });
    const n = await p.evaluate(() => D.pieces());
    // Back to 40 mm short, nothing's left; halfway back, the piece before the finger may stay (shown as a ghost).
    check(`dense out and back to ${stop} mm from the start, ${side} mm aside, lays just the ghosts shown`, n - n0 === shown && (stop > 100 || shown === 0), `${shown} shown, ${n - n0} laid`);
    if (n !== n0) await p.evaluate(() => window.woodrail.interaction.undo());
  }

  // QA's turn: out 600 mm, back to 300, then off at 90° (toward open ground): the line draws on round the corner.
  {
    const side = await p.evaluate(([x, z, fx, fz]) => {
      const G = window.woodrail.landscape.grid;
      const open = (px, pz) => {
        const c = G.cellAtWorld(px, pz);
        return c !== -1 && G.height[c] === 0 && G.surface[c] === 0 && G.feature[c] <= 1 && G.road[c] === 0;
      };
      for (const s of [1, -1]) if ([100, 200, 300].every((d) => open(x + fx * 300 - fz * d * s, z + fz * 300 + fx * d * s))) return s;
      return 1;
    }, [x, z, fx, fz]);
    const n0 = await p.evaluate(() => D.pieces());
    const turn = [...[0, 200, 400, 600].map((d) => [x + fx * d, z + fz * d]), ...[450, 300].map((d) => [x + fx * d, z + fz * d]), ...[100, 200, 300].map((d) => [x + fx * 300 + lx * d * side, z + fz * 300 + lz * d * side])];
    await drawThrough(turn, { stepPx: 6 });
    const types = await p.evaluate((n0) => [...window.woodrail.layout.pieceIds()].slice(n0).map((id) => window.woodrail.layout.getPiece(id).type), n0);
    check("retrace part way, then turn 90°: the line draws on round the corner", types.length >= 2 && types.some((t) => t.startsWith("curve")), types.join(" "));
    if (types.length) await p.evaluate(() => window.woodrail.interaction.undo());
  }

  // 5. A new line on empty ground (away from track).

  step("5");
  const gx = x + fx * 300 + lx * 300;
  const gz = z + fz * 300 + lz * 300;
  await focus(gx + fx * 150, gz + fz * 150, 380);
  await drawThrough([0, 80, 160, 240, 320].map((d) => [gx + fx * d, gz + fz * d]));
  const n2 = await p.evaluate(() => D.pieces());
  check("a stroke on empty ground starts a new line", n2 - n1 >= 1, `${n2 - n1} pieces`);
  await shot(p, `${OUT}/draw-5-ground.png`);

  // 6. Esc puts the pencil down; a drag then pans as usual.

  // 5b. A loop drawn on open ground, back round to where it started: it closes on its own start (no "would cross
  // itself"), every piece joined.
  step("5b");
  const open = await p.evaluate(() => {
    const w = window.woodrail;
    const G = w.landscape.grid;
    const B = w.director.bounds;
    const free = (px, pz) => {
      const cell = G.cellAtWorld(px, pz);
      return cell !== -1 && G.height[cell] === 0 && G.surface[cell] === 0 && G.feature[cell] <= 1 && G.road[cell] === 0;
    };
    for (let pz = B.z0 + 600; pz < B.z1 - 600; pz += 72) {
      for (let px = B.x0 + 600; px < B.x1 - 600; px += 72) {
        let ok = true;
        for (let dz = -288; dz <= 288 && ok; dz += 72) for (let dx = -288; dx <= 288 && ok; dx += 72) ok = free(px + dx, pz + dz) && w.layout.queryFreeConnectors(px + dx, pz + dz, 72, []) === 0;
        if (ok) return { x: px, z: pz };
      }
    }
    return null;
  });
  if (open) {
    // Framed with room all round (near the edges the view pans, and the finger's points move under it).
    await focus(open.x, open.z + 180, 900);
    await p.evaluate(() => window.__toasts.splice(0));
    const [n0, j0] = await p.evaluate(() => [D.pieces(), D.joints()]);
    const loop = [];
    for (let a = -Math.PI / 2; a <= -Math.PI / 2 + 2 * Math.PI + 0.35; a += Math.PI / 24) loop.push([open.x + 180 * Math.cos(a), open.z + 180 + 180 * Math.sin(a)]);
    await drawThrough(loop, { shotAt: loop.length - 2, shotName: "draw-5b-loop.png" });
    const [n1, j1] = await p.evaluate(() => [D.pieces(), D.joints()]);
    const toasts = await p.evaluate(() => window.__toasts.splice(0));
    check("a loop back to its start closes there (no 'cross itself')", !toasts.some((t) => /cross itself/.test(t)), JSON.stringify(toasts));
    check("…every piece of the loop joined, the last to the first", n1 - n0 >= 6 && j1 - j0 === n1 - n0, `${n1 - n0} pieces, ${j1 - j0} joints`);
  } else check("found open ground for a loop", false);

  step("6");
  await p.keyboard.press("Escape");
  const off = await p.evaluate(() => !window.woodrail.interaction.isDrawing && !document.querySelector(".tray-draw").classList.contains("active"));
  check("Esc switches drawing off", off);
}

// 7. On a phone: a one-finger touch drag on open ground, up the screen then round to the right.

step("7");
if (site) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  await boot(q);
  // A big patch of open, level ground, the view centred on it: a new line is drawn there in screen space (from a free
  // end is checked on the desktop above).
  const patch = await q.evaluate(() => {
    const w = window.woodrail;
    const G = w.landscape.grid;
    const B = w.director.bounds;
    const open = (px, pz) => {
      const cell = G.cellAtWorld(px, pz);
      // (Trees step aside for track.)
      return cell !== -1 && G.height[cell] === 0 && G.surface[cell] === 0 && G.feature[cell] <= 1 && G.road[cell] === 0;
    };
    for (let pz = B.z0 + 600; pz < B.z1 - 600; pz += 72) {
      for (let px = B.x0 + 600; px < B.x1 - 600; px += 72) {
        let ok = true;
        for (let dz = -216; dz <= 216 && ok; dz += 72) for (let dx = -216; dx <= 216 && ok; dx += 72) ok = open(px + dx, pz + dz) && w.layout.queryFreeConnectors(px + dx, pz + dz, 72, []) === 0;
        if (ok) return { x: px, z: pz };
      }
    }
    return null;
  });
  check("on a phone, found open ground to draw on", !!patch, JSON.stringify(patch));
  if (!patch) throw new Error("no open ground");
  // Framed on it (again, if something else moved the view meanwhile): the open ground under the stroke's start.
  for (let k = 0; k < 3; k++) {
    await focus(patch.x, patch.z, 420, q);
    const off = await q.evaluate(([px, pz]) => {
      const g = window.woodrail.interaction.groundAt(195, 460);
      return g ? Math.hypot(g.x - px, g.z - pz) : Infinity;
    }, [patch.x, patch.z]);
    if (off < 200) break;
  }
  await q.tap(".tray-draw");
  // Up the screen from the middle, then round to the right: about a third of the screen.
  const pts = [];
  for (let k = 0; k <= 10; k++) pts.push([195, 520 - k * 12]);
  for (let a = Math.PI / 12; a <= Math.PI / 2 + 0.01; a += Math.PI / 12) pts.push([195 + 90 * (1 - Math.cos(a)), 400 - 90 * Math.sin(a)]);
  const cdp = await ctx.newCDPSession(q);
  const touch = (type, tx, ty) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: tx, y: ty, id: 1 }] });
  const n0 = await q.evaluate(() => window.woodrail.layout.pieceCount);
  await touch("touchStart", pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
    for (let k = 1; k <= n; k++) await touch("touchMove", ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    if (i === pts.length - 3) await shot(q, `${OUT}/draw-7-phone-drawing.png`);
  }
  await touch("touchEnd", 0, 0);
  await settled(q);
  await shot(q, `${OUT}/draw-7-phone-laid.png`);
  const added = await q.evaluate((n0) => {
    const w = window.woodrail;
    return [...w.layout.pieceIds()].slice(n0).map((id) => w.layout.getPiece(id).type);
  }, n0);
  check("on a phone, a one-finger drag lays a line that bends", added.length >= 2 && added.some((t) => t.startsWith("curve")), added.join(" "));
  // Nothing happening: no frames drawn. (Boats sail on and draw as they go: held still while this is measured, and the
  // frames they draw counted on their own.)
  const [idle, sailing] = await q.evaluate(async () => {
    const w = window.woodrail;
    const r = w.renderer;
    const frames = async () => {
      const f0 = r.info.render.frame;
      await new Promise((res) => setTimeout(res, 2000));
      return r.info.render.frame - f0;
    };
    await new Promise((res) => setTimeout(res, 2500));
    const sailing = await frames();
    const sail = w.boats.update;
    w.boats.update = () => false;
    await new Promise((res) => setTimeout(res, 500));
    const idle = await frames();
    w.boats.update = sail;
    return [idle, sailing];
  });
  check("idle after drawing: no frames drawn", idle === 0, `${idle} frames in 2 s (${sailing} with boats sailing)`);
  await ctx.close();
}

// 7b. A phone on its side: a straight one-finger swipe across the screen over open ground. The view is turned off the
// grid, so on the ground it's a straight line off the eighths the track runs on: a staircase of straights under the
// finger (QA N1), not a snake of curves, and never "too sharp".

step("7b");
await phoneSwipe();

async function phoneSwipe() {
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  await boot(q);
  await q.evaluate(() => {
    const w = window.woodrail;
    window.__toasts = [];
    const orig = w.hud.toast.bind(w.hud);
    w.hud.toast = (m, ...a) => {
      window.__toasts.push(m);
      return orig(m, ...a);
    };
  });
  // Open, level ground round the middle of the map, plenty of it: the swipe is drawn across the middle of the screen.
  const patches = await q.evaluate(() => {
    const w = window.woodrail;
    const G = w.landscape.grid;
    const B = w.director.bounds;
    const open = (px, pz) => {
      const cell = G.cellAtWorld(px, pz);
      return cell !== -1 && G.height[cell] === 0 && G.surface[cell] === 0 && G.feature[cell] <= 1 && G.road[cell] === 0;
    };
    const out = [];
    for (let pz = B.z0 + 700; pz < B.z1 - 700 && out.length < 6; pz += 144) {
      for (let px = B.x0 + 700; px < B.x1 - 700 && out.length < 6; px += 144) {
        let ok = true;
        for (let dz = -432; dz <= 432 && ok; dz += 72) for (let dx = -432; dx <= 432 && ok; dx += 72) ok = open(px + dx, pz + dz) && w.layout.queryFreeConnectors(px + dx, pz + dz, 72, []) === 0;
        if (ok) out.push({ x: px, z: pz });
      }
    }
    return out;
  });
  check("on a phone on its side, found open ground to draw on", patches.length > 0, JSON.stringify(patches[0]));
  // Left to right across the middle of the screen, clear of its edges (the view pans there) and of the tray.
  const pts = [];
  for (let x = 250; x <= 600; x += 7) pts.push([x, 170]);
  // Framed on a patch where all the swipe lies on open ground (the view may not go quite where it's asked).
  let ground = null;
  for (const patch of patches) {
    // (A glide may stop short of where it's asked: again, till the swipe's middle is over the patch.)
    for (let k = 0; k < 4; k++) {
      await focus(patch.x, patch.z, 360, q);
      const off = await q.evaluate(([px, pz]) => {
        const g = window.woodrail.interaction.groundAt(425, 170);
        return g ? Math.hypot(g.x - px, g.z - pz) : Infinity;
      }, [patch.x, patch.z]);
      if (off < 120) break;
    }
    ground = await q.evaluate((pts) => {
      const w = window.woodrail;
      const G = w.landscape.grid;
      const gs = pts.map(([sx, sy]) => w.interaction.groundAt(sx, sy));
      const ok = gs.every((g) => {
        if (!g) return false;
        const cell = G.cellAtWorld(g.x, g.z);
        return cell !== -1 && G.height[cell] === 0 && G.surface[cell] === 0 && G.feature[cell] <= 1 && G.road[cell] === 0 && w.layout.queryFreeConnectors(g.x, g.z, 144, []) === 0;
      });
      return ok ? gs.map((g) => ({ x: g.x, z: g.z })) : null;
    }, pts);
    if (ground) break;
  }
  check("…the swipe framed over open ground", !!ground);
  if (ground) {
    const first = ground[0];
    const last = ground[ground.length - 1];
    const deg = (Math.atan2(last.z - first.z, last.x - first.x) * 180) / Math.PI;
    const length = Math.hypot(last.x - first.x, last.z - first.z);
    await q.tap(".tray-draw");
    await q.evaluate(() => window.__toasts.splice(0));
    const cdp = await ctx.newCDPSession(q);
    const touch = (type, tx, ty) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: tx, y: ty, id: 1 }] });
    const n0 = await q.evaluate(() => window.woodrail.layout.pieceCount);
    await touch("touchStart", pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      await touch("touchMove", pts[i][0], pts[i][1]);
      if (i === pts.length - 4) await shot(q, `${OUT}/draw-7b-landscape-drawing.png`);
    }
    await touch("touchEnd", 0, 0);
    await settled(q);
    await shot(q, `${OUT}/draw-7b-landscape-laid.png`);
    // The new line's pieces, and how near its far end comes to where the finger lifted.
    const got = await q.evaluate(
      async ([n0, last]) => {
        const w = window.woodrail;
        const { connectorRef, createWorldConnector } = await import("/src/track/layout.ts");
        const c = createWorldConnector();
        const ids = [...w.layout.pieceIds()].slice(n0);
        let near = Infinity;
        for (const id of ids)
          for (let i = 0; i < 2; i++) {
            try {
              w.layout.worldConnector(connectorRef(id, i), c);
            } catch {
              continue;
            }
            if (w.layout.joinedConnector(connectorRef(id, i)) === -1) near = Math.min(near, Math.hypot(c.x - last.x, c.z - last.z));
          }
        return { types: ids.map((id) => w.layout.getPiece(id).type), near, toasts: window.__toasts.splice(0) };
      },
      [n0, last],
    );
    const straights = got.types.filter((t) => t.startsWith("straight")).length;
    const what = `${got.types.join(" ")} (${length.toFixed(0)} mm at ${deg.toFixed(0)}°)`;
    check("on a phone on its side, a straight swipe lays a line", got.types.length >= 3, what);
    check("…mostly straights (a staircase, not a snake of curves)", straights >= got.types.length / 2, what);
    check("…ending near the finger", got.near < 90, `${got.near.toFixed(0)} mm`);
    check("…and never 'too sharp'", !got.toasts.some((t) => /too sharp/i.test(t)), JSON.stringify(got.toasts));
  }
  await ctx.close();
}

// 8. Ramps and bridges (N2 phase 1), and QA's replay.

step("8");
await specials();
step("9");
await qaReplay();
step("10");
await junctions();
await loopOffStraight();
await finishRun();

/**
 * Ramps and bridges come into a drawn line where it needs them (N2 phase 1): a stroke from open ground across the
 * river (a ramp up, bridges, a ramp down), and one from open ground up onto a hill a level up (a ramp, in a cutting).
 * Both drawn as new lines on empty ground, found on the map: straight along a row or column of squares.
 */
async function specials() {
  await focus(0, 0, 400);
  const found = await p.evaluate(() => {
    const w = window.woodrail;
    const G = w.landscape.grid;
    const B = w.director.bounds;
    const C = 72;
    const at = (x, z) => G.cellAtWorld(x, z);
    // (Trees step aside for track.)
    const grass = (x, z) => {
      const c = at(x, z);
      return c !== -1 && G.height[c] === 0 && G.surface[c] === 0 && G.feature[c] <= 1 && G.road[c] === 0;
    };
    const water = (x, z) => {
      const c = at(x, z);
      return c !== -1 && G.surface[c] === 1 && G.feature[c] === 0 && G.road[c] === 0;
    };
    const hill = (x, z) => {
      const c = at(x, z);
      return c !== -1 && G.height[c] === 1 && G.surface[c] === 0 && G.feature[c] <= 1 && G.road[c] === 0;
    };
    const track = [];
    for (const id of w.layout.pieceIds()) track.push(w.layout.getPiece(id).pose);
    const clear = (x, z) => track.every((q) => Math.hypot(q.x - x, q.z - z) > 400);
    /** From the middle of square (x, z), along (dx, dz): `lead` squares of `first`, then `mid` of `then`, then `tail` of `last`, on three rows side by side. */
    const run = (x, z, dx, dz, lead, first, mid, then, tail, last, sides = 1) => {
      for (let side = -sides; side <= sides; side++) {
        const sx = x - dz * side * C;
        const sz = z + dx * side * C;
        let k = 0;
        for (; k < lead; k++) if (!first(sx + dx * k * C, sz + dz * k * C) || !clear(sx + dx * k * C, sz + dz * k * C)) return false;
        for (let m = 0; m < mid; m++, k++) if (!then(sx + dx * k * C, sz + dz * k * C) || !clear(sx + dx * k * C, sz + dz * k * C)) return false;
        for (let t = 0; t < tail; t++, k++) if (!last(sx + dx * k * C, sz + dz * k * C) || !clear(sx + dx * k * C, sz + dz * k * C)) return false;
      }
      return true;
    };
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let river = null;
    let up = null;
    // (Hills on the map are smaller than rivers are long: the best way up there is, roomiest first.)
    for (const [lead, len, sides] of [[5, 6, 1], [5, 4, 1], [4, 4, 0], [4, 3, 0]]) {
      for (let z = B.z0 + 400; z < B.z1 - 400 && !(river && up); z += C) {
        for (let x = B.x0 + 400; x < B.x1 - 400 && !(river && up); x += C) {
          const cx = (Math.floor(x / C) + 0.5) * C;
          const cz = (Math.floor(z / C) + 0.5) * C;
          for (const [dx, dz] of dirs) {
            if (!river)
              for (const width of [1, 2, 3, 4])
                if (run(cx, cz, dx, dz, 5, grass, width, water, 6, grass)) {
                  river = { x: cx, z: cz, dx, dz, squares: 5 + width + 5, width };
                  break;
                }
            if (!up && run(cx, cz, dx, dz, lead, grass, len, hill, 0, hill, sides)) up = { x: cx, z: cz, dx, dz, squares: lead + len - 1, lead };
          }
        }
      }
      if (up) break;
    }
    return { river, up, mode: w.mode() };
  });
  check("found a straight way across the river, and one up onto a hill, from open ground", !!found.river && !!found.up, JSON.stringify(found));
  // Drawing on (it's off after Esc, above).
  if (!(await p.evaluate(() => window.woodrail.interaction.isDrawing))) await tapSel(p, ".tray-draw");
  check("…with drawing on", await p.evaluate(() => window.woodrail.interaction.isDrawing));
  // Draw it, and read back the new line's pieces (types and heights), its joints and what it said.
  const drawAcross = async (way, height, name) => {
    const len = way.squares * 72;
    // From a little in from the start square's middle, to its end; up on the hill (from its edge), seen at its height.
    const pts = [];
    for (let d = 0; d <= len; d += 36) pts.push([way.x + way.dx * d, way.z + way.dz * d, height(d)]);
    await focus(way.x + (way.dx * len) / 2, way.z + (way.dz * len) / 2, len / 2 + 150);
    await p.evaluate(() => window.__toasts.splice(0));
    const [n0, j0] = await p.evaluate(() => [D.pieces(), D.joints()]);
    await drawThrough(pts, { shotAt: pts.length - 3, shotName: `draw-8-${name}-drawing.png` });
    await shot(p, `${OUT}/draw-8-${name}-laid.png`);
    return p.evaluate(
      ([n0, j0]) => {
        const w = window.woodrail;
        const ids = [...w.layout.pieceIds()].slice(n0);
        const pieces = ids.map((id) => {
          const q = w.layout.getPiece(id);
          return { type: q.type, y: q.y, flipped: q.flipped };
        });
        return { pieces, joints: D.joints() - j0, toasts: D.toasts() };
      },
      [n0, j0],
    );
  };
  const show = (got) => `${got.pieces.map((q) => `${q.type}@${q.y}`).join(" ")}${got.toasts.length ? ` · toasts: ${got.toasts.join(" | ")}` : ""}`;
  if (found.river) {
    // A straight line on the screen, as over the ground (once the line is up a level, the finger is seen at that
    // height: the line drifts a little to one side of where it would be on the ground, and follows that).
    const got = await drawAcross(found.river, () => 0, "river");
    const types = got.pieces.map((q) => q.type);
    const firstRamp = types.indexOf("ramp");
    const lastRamp = types.lastIndexOf("ramp");
    const bridges = got.pieces.filter((q) => q.type.startsWith("bridge"));
    check(
      "a stroke across the river from the ground: a ramp up, bridges over, a ramp down",
      firstRamp !== -1 && lastRamp > firstRamp && bridges.length >= 1 && types.indexOf("bridge") > firstRamp && types.lastIndexOf("bridge") < lastRamp,
      show(got),
    );
    check("…straight bridges under a straight stroke (no curved bridges: no S over the water)", !types.includes("bridge-curve"), show(got));
    check("…every piece joined, the bridges a level up, and back on the ground at the far end", got.joints === got.pieces.length - 1 && bridges.every((q) => q.y === 48) && got.pieces.at(-1)?.y === 0, show(got));
    if (got.pieces.length) await p.evaluate(() => window.woodrail.interaction.undo());
  }
  if (found.up) {
    // The hill starts `lead` squares on (from the start square's middle, half a square less): past there the finger is
    // over the hilltop.
    const got = await drawAcross(found.up, (d) => (d > (found.up.lead - 0.5) * 72 ? 48 : 0), "hill");
    const ramps = got.pieces.filter((q) => q.type === "ramp");
    check("a stroke up onto a hill a level up lays a ramp, and runs on on the hilltop", ramps.length === 1 && got.pieces.at(-1)?.y === 48 && got.joints === got.pieces.length - 1, show(got));
    // The ramp is let into the hill: a cutting in its blocks.
    const cut = await p.evaluate(async () => {
      const { hillsOf } = await import("/src/landscape/hill-shape.ts");
      return hillsOf(window.woodrail.landscape.grid).cutBlocks().length;
    });
    check("…in a cutting", cut > 0, `${cut} blocks cut`);
    if (got.pieces.length) await p.evaluate(() => window.woodrail.interaction.undo());
  }
  await slantedRiver();
}

/**
 * QA: a swipe straight up the screen at the default camera (about 23° off the grid on the map) across the river crosses
 * it (a ramp up in time, bridges, a ramp down), rather than stopping red at the bank. Looked for over the river's
 * squares: framed from the default camera's side and tilt, a vertical swipe through the water that starts and ends on
 * open grass with nothing else in the way.
 */
async function slantedRiver() {
  const cands = await p.evaluate(() => {
    const w = window.woodrail;
    const G = w.landscape.grid;
    const out = [];
    for (let i = 0; i < G.cellCount && out.length < 40; i += 7) if (G.surface[i] === 1 && G.road[i] === 0) out.push({ x: G.centreX(G.colOf(i)), z: G.centreZ(G.rowOf(i)) });
    return out;
  });
  const seqs = [];
  for (const c of cands) {
    for (const dir of [1, -1]) {
      // The default view: from (700, 620, 1050) off the target, looking down at it.
      const got0 = await p.evaluate(async ([cx, cz, dir]) => {
        const w = window.woodrail;
        const V = w.camera.position.constructor;
        w.lookAt(new V(cx, 0, cz), Math.hypot(700, 620, 1050), Math.atan2(Math.hypot(700, 1050), 620), Math.atan2(700, 1050));
        await new Promise((r) => requestAnimationFrame(() => r()));
        const r = w.canvas.getBoundingClientRect();
        const [sx, sy] = D.screen(cx, 0, cz);
        if (sx < r.left + 100 || sx > r.right - 100) return { seq: "off side" };
        const G = w.landscape.grid;
        const kind = (g) => {
          if (!g) return "x";
          const i = G.cellAtWorld(g.x, g.z);
          if (i === -1 || G.road[i] !== 0 || G.feature[i] > 1) return "x";
          if (G.surface[i] === 1) return "w";
          // (Sand on a bank is ground as grass is.)
          if ((G.surface[i] !== 0 && G.surface[i] !== 6) || G.height[i] !== 0 || w.layout.queryFreeConnectors(g.x, g.z, 250, []) > 0) return "x";
          return "g";
        };
        const pts = [];
        let seq = "";
        for (let k = -44; k <= 44; k++) {
          const y = sy - dir * k * 5;
          if (y < r.top + 60 || y > r.bottom - 170) return { seq: "off screen" };
          seq += kind(w.interaction.groundAt(sx, y));
          pts.push([sx, y]);
        }
        // Grass, then the water, then grass: a clear crossing, with room for a ramp either side (300 mm on the ground).
        const m = /^(g+)w+(g+)$/.exec(seq);
        if (!m) return { seq };
        const at = (k) => w.interaction.groundAt(pts[k][0], pts[k][1]);
        const a0 = at(0);
        const a1 = at(m[1].length);
        const b0 = at(seq.length - m[2].length - 1);
        const b1 = at(seq.length - 1);
        const room = Math.min(Math.hypot(a1.x - a0.x, a1.z - a0.z), Math.hypot(b1.x - b0.x, b1.z - b0.z));
        return room >= 300 ? { pts } : { seq: `${seq} (${room.toFixed(0)} mm)` };
      }, [c.x, c.z, dir]);
      if (!got0?.pts) {
        seqs.push(got0?.seq ?? "none");
        continue;
      }
      const pts = got0.pts;
      await p.evaluate(() => window.__toasts.splice(0));
      const n0 = await p.evaluate(() => D.pieces());
      await p.mouse.move(pts[0][0], pts[0][1]);
      await p.mouse.down();
      for (const [x, y] of pts.slice(1)) await p.mouse.move(x, y);
      await p.mouse.up();
      await settled(p);
      await shot(p, `${OUT}/draw-8-slanted-river.png`);
      const got = await p.evaluate((n0) => {
        const w = window.woodrail;
        const pieces = [...w.layout.pieceIds()].slice(n0).map((id) => ({ type: w.layout.getPiece(id).type, y: w.layout.getPiece(id).y }));
        return { pieces, toasts: D.toasts() };
      }, n0);
      const types = got.pieces.map((q) => q.type);
      const what = `${got.pieces.map((q) => `${q.type}@${q.y}`).join(" ")}${got.toasts.length ? ` · toasts: ${got.toasts.join(" | ")}` : ""} (swipe ${dir > 0 ? "up" : "down"} the screen)`;
      check("a swipe straight up the screen at the default camera crosses the river: ramp up, bridges, ramp down", types.filter((t) => t === "ramp").length >= 2 && types.some((t) => t.startsWith("bridge")) && got.pieces.at(-1)?.y === 0 && !got.toasts.some((t) => /bridge over the river/.test(t)), what);
      if (got.pieces.length) await p.evaluate(() => window.woodrail.interaction.undo());
      return;
    }
  }
  check("found a river to swipe across at the default camera", false, seqs.slice(0, 6).join(" / "));
}

/**
 * QA's replay (N2 phase 1, QA on 32891ec): seed 7, fresh, a phone (390×844, touch), Draw on, QA's exact world lines
 * across the river at a slant to the grid, with QA's camera, each point seen at the ground's height, touch moves every
 * 10 px, a fresh page for each. Each must cross (a bridge), with no curved bridge, both its ends on the ground; the
 * clean case (40°, back) stays clean. And the terrace climb (a level, then another) where one move took 118.6 ms (the
 * second ramp's cutting preview): DrawHand.move under 16 ms at worst.
 */
async function qaReplay() {
  // QA's exact world lines (seed 7, fresh, Sandbox), and QA's camera for each (phi 0.95, theta −1.1659).
  const cases = [
    { name: "slant 23 there", x: -36, z: -1620, h: 2.7576202181510405, total: 972, back: false, cam: [-481, -1440.2, 3662.2] },
    { name: "slant 30 back", x: -252, z: -1620, h: 2.0943951023931953, total: 972, back: true, cam: [-492, -1204.3, 4760.9] },
    { name: "slant 10 back", x: -180, z: -1620, h: 2.5307274153917776, total: 852, back: true, cam: [-524, -1379.1, 3662.2] },
    { name: "slant -23 back", x: -36, z: -1620, h: 2.7401669256310974, total: 972, back: true, cam: [-477.8, -1432.4, 3662.2] },
    { name: "slant 10 there", x: -180, z: -1620, h: 2.5307274153917776, total: 852, back: false, cam: [-524, -1379.1, 3662.2] },
    { name: "slant 40 back (the clean case)", x: -252, z: -1620, h: 2.2689280275926285, total: 852, back: true, cam: [-522, -1298.3, 3662.2] },
    { name: "terrace: a level up, then another", terrace: true, lanes: [0] },
    // QA's second terrace site (heading 180°, a square a level up, then another), at QA's world line and camera (as
    // the unit replay has it; a search for such a site found another, by the map's edge): a ramp at the first rise,
    // and never "too sharp" on a straight stroke.
    { name: "terrace 2: a square a level up, then another", x: -1764, z: -1620, h: Math.PI, total: 480, back: false, cam: [-2004, -1620, 3662.2], climb: true, noTurn: true },
  ];
  for (const c of cases) {
    // A fresh page for each, as QA ran them.
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const q = await ctx.newPage();
    q.on("pageerror", (e) => errors.push(e.message));
    await boot(q);
    await q.evaluate(() => {
      const w = window.woodrail;
      window.__toasts = [];
      const orig = w.hud.toast.bind(w.hud);
      w.hud.toast = (m, ...a) => {
        window.__toasts.push(m);
        return orig(m, ...a);
      };
      // DrawHand.move's times, for the hitch.
      const d = w.interaction.draw;
      const move = d.move.bind(d);
      window.__moves = [];
      d.move = (x, y) => {
        const t0 = performance.now();
        move(x, y);
        window.__moves.push(performance.now() - t0);
      };
    });
    await q.tap(".tray-draw");
    // (Drawing switched on gets ready when idle, a job at a time: a player's finger comes later than a script's.)
    await q.waitForFunction(() => window.woodrail.interaction.draw.ready, null, { timeout: 60000 }).catch(() => {});
    const cdp = await ctx.newCDPSession(q);
    const touch = (type, tx, ty) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: tx, y: ty, id: 1 }] });
    // The terrace: QA's search (one lane) for a level up then another, at 135°.
    const run = c.terrace
      ? await q.evaluate((lanes) => {
          const segs = [["g0", 250, 450], ["h1", 36, 200], ["h2", 72, 400]];
          const w = window.woodrail;
          const G = w.landscape.grid;
          const kindAt = (x, z) => {
            const i = G.cellAtWorld(x, z);
            if (i === -1) return "off";
            if (G.road[i] || G.feature[i] > 1) return "x";
            if (G.surface[i] === 1) return "river";
            if (G.surface[i] === 5) return "x";
            const h = G.height[i];
            return h === 0 ? (G.surface[i] === 0 || G.surface[i] === 6 ? "g0" : "x") : "h" + h;
          };
          const pcs = [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id).pose);
          for (let i = 0; i < G.cellCount; i++)
            for (let k = 0; k < 8; k++) {
              const h = (k * Math.PI) / 4;
              const fx = Math.cos(h);
              const fz = Math.sin(h);
              const ox = G.centreX(G.colOf(i));
              const oz = G.centreZ(G.rowOf(i));
              let d = 0;
              let ok = true;
              for (const [kind, mn, mx] of segs) {
                let len = 0;
                while (len < mx) {
                  const x = ox + fx * (d + len);
                  const z = oz + fz * (d + len);
                  if (lanes.some((sd) => kindAt(x - fz * sd, z + fx * sd) !== kind) || pcs.some((p) => Math.hypot(p.x - x, p.z - z) < 140)) break;
                  len += 12;
                }
                if (len < mn) {
                  ok = false;
                  break;
                }
                d += len;
              }
              if (ok) return { x: ox, z: oz, h, total: d, back: false };
            }
          return null;
        }, c.lanes)
      : c;
    if (!run) {
      check(`QA replay, ${c.name}: found its run`, false);
      await ctx.close();
      continue;
    }
    // The finger's path every 15 mm along the world line, seen at the ground's height, with QA's camera (or, for the
    // terrace, the smallest view that frames it).
    const screen = await q.evaluate(([run, cam]) => {
      const w = window.woodrail;
      const G = w.landscape.grid;
      const V = w.camera.position.constructor;
      const pts = [];
      for (let d = 0; d <= run.total; d += 15) pts.push([run.x + Math.cos(run.h) * d, run.z + Math.sin(run.h) * d]);
      if (run.back) pts.reverse();
      const project = () =>
        pts.map(([x, z]) => {
          const i = G.cellAtWorld(x, z);
          const v = new V(x, i === -1 ? 0 : G.groundY(i), z).project(w.camera);
          const r = w.canvas.getBoundingClientRect();
          return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
        });
      if (cam) {
        w.lookAt(new V(cam[0], 0, cam[1]), cam[2], 0.95, -1.1659);
        return project();
      }
      const cx = pts.reduce((t, p) => t + p[0], 0) / pts.length;
      const cz = pts.reduce((t, p) => t + p[1], 0) / pts.length;
      const trayTop = document.querySelector(".tray")?.getBoundingClientRect().top ?? 644;
      let dist = 450;
      for (let n = 0; n < 12; n++, dist *= 1.3) {
        w.lookAt(new V(cx, 0, cz), dist, 0.95, -1.1659);
        const sp = project();
        if (sp.every(([x, y]) => x >= 60 && x <= 330 && y >= 110 && y <= trayTop - 50)) return sp;
      }
      return project();
    }, [run, c.cam ?? null]);
    const ids0 = await q.evaluate(() => [...window.woodrail.layout.pieceIds()]);
    /** QA's stroke, once: what it laid (its free ends' heights), the toasts, and DrawHand.move's worst and p95 times. */
    const strokeOnce = async (shotName) => {
      await q.evaluate(() => {
        window.__toasts.splice(0);
        window.__moves.splice(0);
      });
      await touch("touchStart", screen[0][0], screen[0][1]);
      for (let i = 1; i < screen.length; i++) {
        const [ax, ay] = screen[i - 1];
        const [bx, by] = screen[i];
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
        for (let k = 1; k <= n; k++) await touch("touchMove", ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
      }
      await touch("touchEnd", 0, 0);
      await settled(q);
      if (shotName) await shot(q, shotName);
      return q.evaluate(async ([ids0]) => {
        const w = window.woodrail;
        const { connectorRef, createWorldConnector } = await import("/src/track/layout.ts");
        const was = new Set(ids0);
        const ids = [...w.layout.pieceIds()].filter((id) => !was.has(id));
        const cn = createWorldConnector();
        const ends = [];
        for (const id of ids)
          for (let k = 0; k < 2; k++) {
            const ref = connectorRef(id, k);
            if (w.layout.joinedConnector(ref) !== -1) continue;
            w.layout.worldConnector(ref, cn);
            ends.push(cn.y);
          }
        const moves = window.__moves.slice().sort((a, b) => a - b);
        return { types: ids.map((id) => w.layout.getPiece(id).type), ends, toasts: window.__toasts.splice(0), worst: moves[moves.length - 1] ?? 0, p95: moves[Math.floor(moves.length * 0.95)] ?? 0 };
      }, [ids0]);
    };
    const got = await strokeOnce(`${OUT}/draw-9-qa-${c.name.replace(/[^a-z0-9]+/gi, "-")}.png`);
    // The same stroke again, twice, each after undoing the last (warm: its geometry and the page's code ready, as
    // on a player's second stroke): the better of the two is the one timed against the budget. Software GL on this
    // machine's 4 cores takes most of them, and a cold first stroke's worst move swings from 8 to 17 ms run to run.
    const warm = [];
    for (let k = 0; k < 2; k++) {
      await q.evaluate(() => window.woodrail.interaction.undo());
      await settled(q);
      warm.push(await strokeOnce(""));
    }
    const best = warm.reduce((x, y) => (y.worst < x.worst ? y : x));
    const ms = (r) => `move worst ${r.worst.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms`;
    const what = `${got.types.join(" ")}${got.toasts.length ? ` · toasts: ${got.toasts.join(" | ")}` : ""} · cold ${ms(got)} · warm ${ms(best)}`;
    const same = warm.every((r) => r.types.join(" ") === got.types.join(" "));
    if (!c.terrace && !c.climb) {
      const ok = got.types.includes("bridge") && !got.types.includes("bridge-curve") && got.ends.length === 2 && got.ends.every((y) => y <= 1);
      check(`QA replay, ${c.name}: crosses, no curved bridge, both ends on the ground`, ok, what);
    } else {
      check(`QA replay, ${c.name}: climbs (a ramp)`, got.types.includes("ramp"), what);
      if (c.noTurn) check(`QA replay, ${c.name}: no curve, and never "too sharp"`, !got.types.some((t) => t.startsWith("curve")) && !got.toasts.some((t) => /too sharp/i.test(t)), what);
    }
    // No hitch on the moves that lay it (QA: 17.5 to 25 ms on one move each crossing; about 4 ms wanted at 1×): 16 ms
    // warm, and the cold first stroke within 50 ms (a real regression, such as a rebuild on every move, still fails).
    check(`QA replay, ${c.name}: the same stroke again lays the same line`, same, `${warm.map((r) => r.types.join(" ")).join(" / ")}`);
    check(`QA replay, ${c.name}: warm, no move over 16 ms`, best.worst < 16, what);
    check(`QA replay, ${c.name}: cold, no move over 50 ms`, got.worst < 50, what);
    await ctx.close();
  }
  await terraceRepeat();

}

/**
 * Junctions (N2 phase 2): on open ground, a straight line of long straights is drawn, then a branch off its middle (a
 * switch goes in, one undo takes it back up), then a line drawn in at 45° and let go on it (a merge). And the planning
 * guard: while a train's route is planned (`onPickPlace` set), a press draws nothing and branches nothing, the Draw
 * chip can't be pressed, and a station tapped is a stop.
 */
async function junctions(fresh = true) {
  // A fresh map (earlier cases leave track about, which a branch's press could land on, and their autosave): a page of
  // its own, in a context of its own, as when run alone.
  if (fresh) {
    await p.close();
    p = await b.newPage({ viewport: { width: 1200, height: 800 } });
    p.on("pageerror", (e) => errors.push(e.message));
    await boot(p);
  }
  await installD(p);
  await stationClose();
  const open = await p.evaluate(() => {
    const w = window.woodrail;
    const G = w.landscape.grid;
    const B = w.director.bounds;
    const free = (px, pz) => {
      const cell = G.cellAtWorld(px, pz);
      return cell !== -1 && G.height[cell] === 0 && G.surface[cell] === 0 && G.feature[cell] <= 1 && G.road[cell] === 0;
    };
    for (let pz = B.z0 + 600; pz < B.z1 - 600; pz += 72)
      for (let px = B.x0 + 600; px < B.x1 - 600; px += 72) {
        let ok = true;
        for (let dz = -360; dz <= 432 && ok; dz += 72) for (let dx = -504; dx <= 504 && ok; dx += 72) ok = free(px + dx, pz + dz) && w.layout.queryFreeConnectors(px + dx, pz + dz, 72, []) === 0;
        if (ok) return { x: Math.round(px / 18) * 18, z: Math.round(pz / 18) * 18 };
      }
    return null;
  });
  check("junctions: found open ground", !!open, JSON.stringify(open));
  if (!open) return;
  await focus(open.x, open.z, 520);
  if (!(await p.evaluate(() => window.woodrail.interaction.isDrawing))) await tapSel(p, ".tray-draw");
  const types = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()].map((id) => window.woodrail.layout.getPiece(id).type));
  const count = async (t) => (await types()).filter((x) => x === t).length;
  // The line: 864 mm along +x through the patch.
  const x0 = open.x - 432;
  const [n0, j0] = await p.evaluate(() => [D.pieces(), D.joints()]);
  await drawThrough([0, 150, 300, 450, 600, 750, 900].map((d) => [x0 + d, open.z]));
  const [n1, j1] = await p.evaluate(() => [D.pieces(), D.joints()]);
  check("junctions: a straight line drawn to branch off", n1 - n0 >= 3 && j1 - j0 === n1 - n0 - 1, `${n1 - n0} pieces, ${j1 - j0} joints`);
  // Its second piece's middle, where the branch starts.
  const mid = await p.evaluate(([n0]) => {
    const w = window.woodrail;
    const ids = [...w.layout.pieceIds()].slice(n0);
    const q = w.layout.getPiece(ids[1]);
    const half = q.type === "straight-216" ? 108 : 72;
    return { x: q.pose.x + Math.cos(q.pose.heading) * half, z: q.pose.z + Math.sin(q.pose.heading) * half, id: ids[1], type: q.type };
  }, [n0]);
  // A branch: pressed on it, off at 45° to +z (framed close: track is taken hold of only from close by).
  await focus(mid.x + 120, mid.z + 120, 420);
  const sw0 = await count("switch");
  await drawThrough([0, 40, 80, 160, 240, 320, 400].map((d) => [mid.x + d * Math.SQRT1_2, mid.z + d * Math.SQRT1_2]), { shotAt: 5, shotName: "draw-10-branch.png" });
  const [n2, j2] = await p.evaluate(() => [D.pieces(), D.joints()]);
  const sw1 = await count("switch");
  // (Every piece joined: the line through the switch as before, and the branch on from it: one joint for each piece
  // more, as the new line's first piece is joined to the switch.)
  check("junctions: a stroke off a line's body branches through a switch put in its place", sw1 === sw0 + 1 && n2 > n1 && j2 - j1 === n2 - n1, `${sw1 - sw0} switch, ${n2 - n1} pieces, ${j2 - j1} joints`);
  await p.evaluate(() => window.woodrail.interaction.undo());
  const [n3] = await p.evaluate(() => [D.pieces()]);
  check("junctions: one undo takes the branch and its switch up, and the line is as it was", n3 === n1 && (await count("switch")) === sw0, `${n3} vs ${n1}`);
  // A merge: from open ground above the line, in at 45°, let go on it.
  const mx = open.x + 60;
  await focus(mx - 170, open.z + 170, 420);
  const sw2 = await count("switch");
  await drawThrough([0, 60, 120, 180, 240, 300, 340].map((d) => [mx - 340 + d, open.z + 340 - d]), { shotAt: 5, shotName: "draw-10-merge.png" });
  const sw3 = await count("switch");
  const [n4, j4] = await p.evaluate(() => [D.pieces(), D.joints()]);
  check("junctions: a line drawn in at 45° and let go on a line merges through a switch", sw3 === sw2 + 1 && n4 > n1 && j4 - j1 === n4 - n1, `${sw3 - sw2} switch, ${n4 - n1} pieces, ${j4 - j1} joints`);
  await p.evaluate(() => window.woodrail.interaction.undo());
  // A crossing: from open ground beside the line, square across it and well on past.
  const cx0 = open.x + 18;
  await focus(cx0, open.z + 120, 460);
  const [n7, j7] = await p.evaluate(() => [D.pieces(), D.joints()]);
  const cr0 = await count("crossing");
  await drawThrough([0, 80, 160, 240, 320, 400, 480, 560, 640].map((d) => [cx0, open.z - 300 + d]), { shotAt: 7, shotName: "draw-10-crossing.png" });
  const cr1 = await count("crossing");
  const [n8, j8] = await p.evaluate(() => [D.pieces(), D.joints()]);
  check("junctions: a line drawn square across a line goes on through a crossing put in its place", cr1 === cr0 + 1 && n8 > n7 && j8 - j7 === n8 - n7, `${cr1 - cr0} crossing, ${n8 - n7} pieces, ${j8 - j7} joints`);
  if (n8 !== n7) await p.evaluate(() => window.woodrail.interaction.undo());
  // The planning guard: a route being planned (as the engine card's Plan does), Draw on.
  await p.evaluate(() => {
    const w = window.woodrail;
    window.__picked = [];
    w.interaction.onPickPlace = (id) => {
      window.__picked.push(id);
      return true;
    };
    w.hud.setPlanning(true);
  });
  const disabled = await p.evaluate(() => document.querySelector(".tray-draw").disabled);
  await focus(mid.x + 60, mid.z + 120, 420);
  const n5 = await p.evaluate(() => D.pieces());
  await drawThrough([0, 100, 200, 300].map((d) => [open.x - 200 + d, open.z + 250]));
  await drawThrough([0, 40, 80, 160, 240].map((d) => [mid.x + d * Math.SQRT1_2, mid.z + d * Math.SQRT1_2]));
  const n6 = await p.evaluate(() => D.pieces());
  check("planning a route: the Draw chip can't be pressed, and a press draws no line and no branch", disabled && n6 === n5, `disabled ${disabled}, ${n6 - n5} pieces`);
  // A station tapped while planning is a stop, as routes expect.
  const st = await p.evaluate(() => {
    const w = window.woodrail;
    for (const id of w.layout.pieceIds()) {
      const q = w.layout.getPiece(id);
      if (q.type === "station" && w.economy.depotAtPiece(id)) return { x: q.pose.x + Math.cos(q.pose.heading) * 108, z: q.pose.z + Math.sin(q.pose.heading) * 108 };
    }
    return null;
  });
  if (st) {
    await focus(st.x, st.z, 400);
    const [sx, sy] = await p.evaluate(([x, z]) => D.screen(x, 0, z), [st.x, st.z]);
    await p.mouse.click(sx, sy);
    await settled(p);
    const picked = await p.evaluate(() => window.__picked.length);
    check("planning a route with Draw on: a station tapped is a stop", picked === 1, `${picked} picked`);
  } else check("planning a route: found a station to tap", false);
  await p.evaluate(() => {
    const w = window.woodrail;
    w.interaction.onPickPlace = null;
    w.hud.setPlanning(false);
  });
}

/**
 * Draw into a station end closes (QA: a line drawn into Fernhill's west end stopped just short of it, buffers facing):
 * from open ground south of Gorsemoor, a bend up into its south end and a little on. Before, no one piece met the end
 * within the joints' play, and the line went on beside it, red into the house there ("That's a house — go around it");
 * now it lays its last pieces so they meet the end, bending its joints within their play: every piece is joined, and
 * the station is where it was.
 */
async function stationClose() {
  const st = await p.evaluate(async () => {
    const w = window.woodrail;
    const { connectorRef, createWorldConnector } = await import("/src/track/layout.ts");
    const town = w.landscape.towns.find((t) => t.name === "Gorsemoor");
    const id = town && w.stations.get(town.id);
    if (id === undefined) return null;
    const c = w.layout.worldConnector(connectorRef(id, 0), createWorldConnector());
    return { id, ref: connectorRef(id, 0), x: c.x, z: c.z, heading: c.heading, pose: { ...w.layout.getPiece(id).pose } };
  });
  check("draw into a station end: found Gorsemoor's south end", !!st && Math.abs(st.x - 828) < 1 && Math.abs(st.z + 576) < 1, JSON.stringify(st));
  if (!st) return;
  // A smooth stroke from 550 mm off, 10° to one side of the station's line, in along it and 40 mm on.
  const a = st.heading - (10 * Math.PI) / 180;
  const [sx, sz] = [st.x + 550 * Math.cos(a), st.z + 550 * Math.sin(a)];
  const [hs, ht] = [a + Math.PI, st.heading + Math.PI];
  const L = Math.hypot(st.x - sx, st.z - sz);
  const pts = [[sx, sz]];
  const n = Math.ceil((L * 1.3) / 40);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const [h0, h1, h2, h3] = [2 * t ** 3 - 3 * t ** 2 + 1, t ** 3 - 2 * t ** 2 + t, -2 * t ** 3 + 3 * t ** 2, t ** 3 - t ** 2];
    pts.push([h0 * sx + h1 * L * Math.cos(hs) + h2 * st.x + h3 * L * Math.cos(ht), h0 * sz + h1 * L * Math.sin(hs) + h2 * st.z + h3 * L * Math.sin(ht)]);
  }
  pts.push([st.x + 40 * Math.cos(ht), st.z + 40 * Math.sin(ht)]);
  await focus((sx + st.x) / 2, (sz + st.z) / 2, 420);
  if (!(await p.evaluate(() => window.woodrail.interaction.isDrawing))) await tapSel(p, ".tray-draw");
  await p.evaluate(() => D.toasts());
  const [n0, j0] = await p.evaluate(() => [D.pieces(), D.joints()]);
  await drawThrough(pts, { shotAt: pts.length - 2, shotName: "draw-11-station.png" });
  const after = await p.evaluate(async ([ref, id]) => {
    const w = window.woodrail;
    const tol = await import("/src/track/constants.ts");
    let worst = 0;
    let gap = 0;
    for (const j of w.layout.joints()) {
      worst = Math.max(worst, j.angleError);
      gap = Math.max(gap, j.posError);
    }
    const ok = worst <= tol.JOINT_ANGLE_TOLERANCE + 1e-9 && gap <= tol.JOINT_POS_TOLERANCE + 1e-9;
    return { joined: w.layout.joinedConnector(ref) !== -1, pieces: D.pieces(), joints: D.joints(), snug: ok, worst: (worst * 180) / Math.PI, gap, pose: { ...w.layout.getPiece(id).pose }, toasts: D.toasts() };
  }, [st.ref, st.id]);
  await shot(p, `${OUT}/draw-11-station-closed.png`);
  const laid = after.pieces - n0;
  check(
    "draw into a station end closes: joined, every piece joined, joints within play, the station unmoved",
    after.joined && laid >= 2 && after.joints - j0 === laid && after.snug && after.pose.x === st.pose.x && after.pose.z === st.pose.z && after.pose.heading === st.pose.heading,
    `${laid} pieces, ${after.joints - j0} joints, worst ${after.worst.toFixed(2)}° ${after.gap.toFixed(1)} mm, toasts ${JSON.stringify(after.toasts)}`,
  );
  // (Taken up again: the junctions' cases find their open ground on the map as it was.)
  if (laid > 0) await p.evaluate(() => window.woodrail.interaction.undo());
}

async function finishRun() {
  check("no page errors", errors.length === 0, errors.join(" | "));
  await b.close();
  await server.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
}

/**
 * QA's terrace 2 drawn again on the same page (QA: the second time, after an undo or any stroke, it laid straight-144
 * and a ramp and said "The hill is a level up here"): QA's conditions, Sandbox #seed-7 on a 390 × 844 touch screen
 * at device scale 1, QA's world line seen at each square's ground height, QA's lookAt put back before each of three
 * strokes on one page, undoing between. The same line each time; a toast about the hill only if the first said it
 * too. (It was a tie between two plans that a camera a hair off after the undo broke the other way: see `best`.)
 */
async function terraceRepeat() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  await boot(q);
  await q.evaluate(() => {
    const w = window.woodrail;
    window.__toasts = [];
    const orig = w.hud.toast.bind(w.hud);
    w.hud.toast = (m, ...a) => {
      window.__toasts.push(m);
      return orig(m, ...a);
    };
  });
  await q.tap(".tray-draw");
  await q.waitForFunction(() => window.woodrail.interaction.draw.ready, null, { timeout: 60000 }).catch(() => {});
  const cdp = await ctx.newCDPSession(q);
  const touch = (type, tx, ty) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: tx, y: ty, id: 1 }] });
  const once = async () => {
    // QA's world line, each point seen at its square's ground height, at QA's camera (put back before each stroke).
    const path = await q.evaluate(() => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      w.director.cancel?.();
      w.lookAt(new V(-2004, 0, -1620), 3662.2, 0.95, -1.1659);
      window.__toasts.splice(0);
      const G = w.landscape.grid;
      const r = w.canvas.getBoundingClientRect();
      const pts = [];
      for (let d = 0; d <= 480; d += 15) {
        const x = -1764 - d;
        const z = -1620;
        const v = new V(x, G.groundY(G.cellAtWorld(x, z)), z).project(w.camera);
        pts.push([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
      }
      return pts;
    });
    await settled(q);
    const ids0 = await q.evaluate(() => [...window.woodrail.layout.pieceIds()]);
    await touch("touchStart", path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) {
      const [ax, ay] = path[i - 1];
      const [bx, by] = path[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
      for (let k = 1; k <= n; k++) await touch("touchMove", ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    }
    await touch("touchEnd", 0, 0);
    await settled(q);
    return q.evaluate(([ids0]) => {
      const w = window.woodrail;
      const was = new Set(ids0);
      return { types: [...w.layout.pieceIds()].filter((id) => !was.has(id)).map((id) => w.layout.getPiece(id).type), toasts: window.__toasts.splice(0) };
    }, [ids0]);
  };
  const runs = [];
  for (let k = 0; k < 3; k++) {
    if (k > 0) {
      await q.evaluate(() => window.woodrail.interaction.undo());
      await settled(q);
    }
    runs.push(await once());
  }
  const what = runs.map((r) => `${r.types.join(" ")}${r.toasts.length ? ` [${r.toasts.join(" | ")}]` : ""}`).join(" / ");
  check("QA replay, terrace 2 again on the same page (QA's screen path, lookAt put back, after an undo): the same line each time", runs.every((r) => r.types.join(" ") === runs[0].types.join(" ")), what);
  check("…and no 'a level up here' the first time didn't say", runs.every((r) => r.toasts.some((t) => /level up/i.test(t)) === runs[0].toasts.some((t) => /level up/i.test(t))), what);
  await ctx.close();
}

/**
 * QA's playtest: a passing loop drawn off the middle of the Larkfield–Elderwick straight (seed 7, a 360 × 740
 * phone, the camera 1300 mm off): pressed on the straight, out to one side, along beside
 * it, and back in, in one stroke. A switch out, the run beside, and a switch back in (QA: it laid nothing, and said
 * "Turn it to fit" and "Another piece is in the way").
 */
async function loopOffStraight() {
  const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  const q = await ctx.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  // Game mode's start (seed 7's starting map), as e2e:touch starts it: the Game card's main button, then the help closed.
  await q.goto(URL.replace(/#.*$/, ""), { timeout: 180000 });
  await q.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-game .title-buttons .primary") !== null, null, { timeout: 180000 });
  await q.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary").click());
  await q.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null && window.woodrail.mode() === "game", null, { timeout: 180000 });
  await q.evaluate(() => {
    const help = document.querySelector(".help");
    if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
  });
  await q.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 }).catch(() => {});
  await settled(q);
  await q.evaluate(() => {
    const w = window.woodrail;
    window.__toasts = [];
    const orig = w.hud.toast.bind(w.hud);
    w.hud.toast = (m, ...a) => {
      window.__toasts.push(m);
      return orig(m, ...a);
    };
    const refuse = w.hud.refuse?.bind(w.hud);
    if (refuse)
      w.hud.refuse = (m, ...a) => {
        window.__toasts.push(m);
        return refuse(m, ...a);
      };
  });
  // The line between Larkfield's station and Elderwick's (as QA had laid it: four long straights, end to end), and
  // switches learned (the passing-loop goal's).
  const laid = await q.evaluate(async () => {
    const w = window.woodrail;
    // (And pieces enough in the box for a loop: two switches, and track to run beside the line.)
    const { thingsFor } = await import("/src/game/things.ts");
    for (const type of ["switch", "straight-216", "straight-144", "straight-108", "straight-54", "curve-large", "curve-small", "curve-wide"])
      for (const [id, k] of thingsFor({ kind: "piece", type })) w.progress().add(id, 10 * k);
    const at = (name) => {
      const town = w.landscape.towns.find((t) => t.name === name);
      const id = town && w.stations.get(town.id);
      return id === undefined ? null : w.layout.getPiece(id).pose;
    };
    const a = at("Larkfield");
    const c = at("Elderwick");
    if (!a || !c) return "no stations";
    w.progress().learned.add("switches");
    const x0 = a.x + 216;
    const n = Math.round((c.x - x0) / 216);
    w.editor().placeRun(Array.from({ length: n }, (_, i) => ({ type: "straight-216", pose: { x: x0 + i * 216, z: a.z, heading: 0 }, y: 0, flipped: false })));
    return `${n} straights from ${x0} to ${c.x}, ${w.layout.jointCount} joints`;
  });
  check("passing loop: the line between Larkfield and Elderwick laid", !/no/.test(laid), laid);
  await settled(q);
  // The straight halfway between Larkfield's station and Elderwick's.
  const site = await q.evaluate(() => {
    const w = window.woodrail;
    const at = (name) => {
      const town = w.landscape.towns.find((t) => t.name === name);
      const id = town && w.stations.get(town.id);
      return id === undefined ? null : w.layout.getPiece(id).pose;
    };
    const a = at("Larkfield");
    const c = at("Elderwick");
    if (!a || !c) return { missing: w.landscape.towns.map((t) => `${t.name}:${w.stations.get(t.id) ?? "-"}`).join(", "), seed: w.landscape.seed };
    const mx = (a.x + c.x) / 2;
    const mz = (a.z + c.z) / 2;
    let best = null;
    for (const id of w.layout.pieceIds()) {
      const p = w.layout.getPiece(id);
      if (!/^straight-\d+$/.test(p.type) || p.type === "straight-54") continue;
      const l = Number(p.type.slice(9));
      const cx = p.pose.x + (Math.cos(p.pose.heading) * l) / 2;
      const cz = p.pose.z + (Math.sin(p.pose.heading) * l) / 2;
      const d = Math.hypot(cx - mx, cz - mz);
      if (!best || d < best.d) best = { id, d, x: cx, z: cz, heading: p.pose.heading, y: p.y };
    }
    return best ?? { missing: [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id).type).join(" "), a, c };
  });
  check("passing loop: found the Larkfield–Elderwick straight", !!site && !site.missing, JSON.stringify(site));
  if (!site || site.missing) return await ctx.close();
  // The camera 1300 mm off, over the straight; the straight's way and its side, on the screen.
  const view = await q.evaluate((s) => {
    const w = window.woodrail;
    const V = w.camera.position.constructor;
    w.director.cancel?.();
    w.lookAt(new V(s.x, 0, s.z), 1300, 0.95, -1.1659);
    w.camera.updateMatrixWorld();
    const r = w.canvas.getBoundingClientRect();
    const scr = (x, y, z) => {
      const v = new V(x, y, z).project(w.camera);
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    };
    const c = scr(s.x, s.y, s.z);
    const f = scr(s.x + Math.cos(s.heading) * 100, s.y, s.z + Math.sin(s.heading) * 100);
    let ux = f[0] - c[0];
    let uy = f[1] - c[1];
    const l = Math.hypot(ux, uy);
    ux /= l;
    uy /= l;
    // Across it, toward the top of the screen (away from Larkfield's houses below the line, and the tray).
    let nx = -uy;
    let ny = ux;
    if (ny > 0) {
      nx = -nx;
      ny = -ny;
    }
    return { c, u: [ux, uy], n: [nx, ny], pxPerMm: l / 100, switches: [...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id).type.startsWith("switch")).length, pieces: w.layout.pieceCount };
  }, site);
  await settled(q);
  // (The title can come back over a fresh game while it settles: Continue, as a player would.)
  const titleAgain = await q.evaluate(() => window.woodrail.title.shown);
  if (titleAgain) {
    await q.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary")?.click());
    await q.waitForFunction(() => !window.woodrail.title.shown, null, { timeout: 120000 }).catch(() => {});
    await settled(q);
    await q.evaluate((s) => {
      const w = window.woodrail;
      w.director.cancel?.();
      w.lookAt(new w.camera.position.constructor(s.x, 0, s.z), 1300, 0.95, -1.1659);
    }, site);
    await settled(q);
  }
  // (Draw switched on as its chip does: at 360 px in Game mode the chip can be under the goal's card.)
  const drawOn = await q.evaluate(() => {
    if (!window.woodrail.interaction.isDrawing) document.querySelector(".tray-draw")?.click();
    return window.woodrail.interaction.isDrawing;
  });
  check("passing loop: Draw is on, nothing over the map", drawOn && !(await q.evaluate(() => window.woodrail.title.shown)), `title came back: ${titleAgain}; now ${await q.evaluate(() => window.woodrail.title.shown)}; pieces ${await q.evaluate(() => window.woodrail.layout.pieceCount)}`);
  await q.waitForFunction(() => window.woodrail.interaction.draw.ready, null, { timeout: 60000 }).catch(() => {});
  await shot(q, `${OUT}/draw-10-loop-before.png`);
  const cdp = await ctx.newCDPSession(q);
  // Each move stamped 16 ms after the last, as a finger's are on a phone (the game decides a hold by the events' own
  // times): without, every move here is stamped when the script gets round to it, under software GL a long while
  // later, and the press reads as a finger resting long enough to pick the straight up (as QA's harness saw it).
  const t0 = Date.now() / 1000;
  let ti = 0;
  const touch = (type, tx, ty) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t0 + 0.016 * ti++, touchPoints: type === "touchEnd" ? [] : [{ x: tx, y: ty, id: 1 }] });
  // QA's shape (along the straight, and across it): out 60 along and 92 across, 140 along beside it, and back in over
  // the last 60, starting on the straight 80 before its middle.
  const [cx, cy] = view.c;
  // (QA's numbers are screen px at about a pixel a millimetre: taken here as millimetres, on the screen at this view's scale.)
  const k = view.pxPerMm;
  const pt = (a, b) => [cx + (view.u[0] * a + view.n[0] * b) * k, cy + (view.u[1] * a + view.n[1] * b) * k];
  const corners = [pt(-80, 0), pt(-20, 92), pt(120, 92), pt(180, 0)];
  const modes = [];
  const mode = () => q.evaluate(() => {
    const m = window.woodrail.interaction.mode;
    return `${m.kind}${m.branch !== undefined ? ":branch" + m.branch : ""}${m.press?.kind ? ":" + m.press.kind : ""}`;
  });
  await touch("touchStart", corners[0][0], corners[0][1]);
  modes.push(await mode());
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1];
    const [bx, by] = corners[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 5));
    for (let k = 1; k <= n; k++) await touch("touchMove", ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    modes.push(await mode());
  }
  await touch("touchEnd", 0, 0);
  await settled(q);
  await shot(q, `${OUT}/draw-10-loop.png`);
  const got = await q.evaluate(() => {
    const w = window.woodrail;
    return { switches: [...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id).type.startsWith("switch")).length, pieces: w.layout.pieceCount, toasts: window.__toasts.splice(0) };
  });
  const what = `${got.switches - view.switches} switches, ${got.pieces - view.pieces} pieces more · ${view.pxPerMm.toFixed(2)} px/mm · modes ${modes.join(" > ")} · press at ${corners[0].map(Math.round)}${got.toasts.length ? " · " + got.toasts.join(" | ") : ""}`;
  check("passing loop off the straight: a switch out, the run beside it, a switch back in", got.switches - view.switches === 2 && got.pieces > view.pieces, what);
  check("…and no 'Turn it to fit' while drawing", !got.toasts.some((t) => /turn it to fit/i.test(t)), what);
  await ctx.close();
}
