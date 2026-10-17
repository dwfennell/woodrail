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
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
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
  await page.goto(URL);
  await page.waitForFunction(() => !!window.woodrail && [...document.querySelectorAll("button")].some((b) => /let.s play/i.test(b.textContent ?? "")), null, { timeout: 180000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /let.s play/i.test(b.textContent ?? ""))?.click());
  await page.waitForFunction(() => document.querySelector(".tray-draw") !== null && window.woodrail.layout.pieceCount > 0, null, { timeout: 60000 });
  // A new player's opening camera move (if any) has finished, so it doesn't undo the test's framing.
  await page.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
};
await boot(p);
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

// Favourites: first on the Track tab, a ★ on a shelf's piece adds it, and it's remembered.
{
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
{
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
/** Drag the mouse through world points (x, z) on the ground, a few px a step. */
const drawThrough = async (pts, { shotAt = -1, shotName = "", stepPx = 14 } = {}) => {
  const screen = await p.evaluate((pts) => pts.map(([x, z]) => D.screen(x, 0, z)), pts);
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
{
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
        const { createWorldConnector } = await import("/src/track/layout.ts");
        const c = createWorldConnector();
        const ids = [...w.layout.pieceIds()].slice(n0);
        let near = Infinity;
        for (const id of ids)
          for (let i = 0; i < 2; i++) {
            try {
              w.layout.worldConnector(id * 4 + i, c);
            } catch {
              continue;
            }
            if (w.layout.joinedConnector(id * 4 + i) === -1) near = Math.min(near, Math.hypot(c.x - last.x, c.z - last.z));
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

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
