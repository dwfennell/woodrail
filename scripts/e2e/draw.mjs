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
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
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

/** Load the game and start playing (condition waits: software rendering under load can be slow). */
const boot = async (page) => {
  await page.goto(URL);
  await page.waitForFunction(() => !!window.woodrail && [...document.querySelectorAll("button")].some((b) => /let.s play/i.test(b.textContent ?? "")), null, { timeout: 180000 });
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /let.s play/i.test(b.textContent ?? ""))?.click());
  await page.waitForFunction(() => document.querySelector(".tray-draw") !== null && window.woodrail.layout.pieceCount > 0, null, { timeout: 60000 });
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
  await p.click(".tabs [data-tab=track]");
  const favs = await p.$$eval(".scroller > .tray-item:not(.tray-group)", (bs) => bs.map((b) => b.querySelector(".label")?.textContent));
  check("the Track tab shows favourites before its shelves", favs.length === 5, favs.join(", "));
  await p.screenshot({ path: `${OUT}/fav-0-row.png` });
  await p.click(".scroller .tray-group:has-text('Curve')");
  await p.click(".scroller .tray-item:has-text('Wide curve') .fav");
  await p.click(".tabs [data-tab=track]");
  const after = await p.$$eval(".scroller > .tray-item:not(.tray-group)", (bs) => bs.map((b) => b.querySelector(".label")?.textContent));
  const saved = await p.evaluate(() => localStorage.getItem("woodrail.favourites") ?? "");
  check("★ on a shelf's piece adds it to the favourites, and it's saved", after.at(-1) === "Wide curve" && saved.includes("curve-wide"), after.join(", "));
  await p.click(".scroller > .tray-item:has-text('Wide curve') .fav");
  const removed = await p.$$eval(".scroller > .tray-item:not(.tray-group)", (bs) => bs.length);
  check("★ again on the favourites row takes it off", removed === 5, `${removed}`);
}

// A drag up on a shelf (not opened) takes out its first piece: the first thing a new player tries.
{
  await p.click(".tabs [data-tab=track]");
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

// A focus glides at most 30% closer at a time: a few, to come in from the whole-map view.
// (Software rendering can be slow, a phone's 2× screen more so: each glide is waited out before the next.)
const focus = async (x, z, r = 320, page = p) => {
  let last = Infinity;
  for (let k = 0; k < 8; k++) {
    await page.evaluate(([x, z, r]) => window.woodrail.director.focus(new window.woodrail.camera.position.constructor(x, 0, z), r), [x, z, r]);
    await page.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 8000 }).catch(() => {});
    // Done once a glide no longer brings it meaningfully closer.
    const d = await page.evaluate(() => window.woodrail.camera.position.distanceTo(window.woodrail.controls.target));
    if (d > last * 0.97) break;
    last = d;
  }
};
/** Drag the mouse through world points (x, z) on the ground, a few px a step. */
const drawThrough = async (pts, { shotAt = -1, shot = "", stepPx = 14 } = {}) => {
  const screen = await p.evaluate((pts) => pts.map(([x, z]) => D.screen(x, 0, z)), pts);
  await p.mouse.move(screen[0][0], screen[0][1]);
  await p.mouse.down();
  for (let i = 1; i < screen.length; i++) {
    const [ax, ay] = screen[i - 1];
    const [bx, by] = screen[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / stepPx));
    for (let k = 1; k <= n; k++) await p.mouse.move(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    if (i === shotAt) await p.screenshot({ path: `${OUT}/${shot}` });
  }
  await p.mouse.up();
  // The line's pieces have settled (their flourishes done).
  await p.waitForFunction(() => window.woodrail.flourishes.count === 0, null, { timeout: 30000 });
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
  const undone = await p.evaluate(() => D.pieces());
  check("one undo takes the whole line up", undone === before[0], `${undone} vs ${before[0]}`);

  // 3. A turn: straight on, then round to one side (the other side if a hill or a river is in the way of the first).
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
    await drawThrough(turn, { shotAt: turn.length - 2, shot: "draw-2-turn-midway.png" });
    await p.screenshot({ path: `${OUT}/draw-2-turn.png` });
    types = await p.evaluate((n0) => [...window.woodrail.layout.pieceIds()].slice(n0).map((id) => window.woodrail.layout.getPiece(id).type), n0);
    curves = types.filter((t) => t.startsWith("curve")).length;
    said = await p.evaluate(() => D.toasts());
    if (types.length > 0) await p.evaluate(() => window.woodrail.interaction.undo());
    if (curves >= 2) break;
  }
  check("a stroke that turns lays curves", curves >= 2, `${types.join(" ")}${said.length ? ` · toasts: ${said.join(" | ")}` : ""}`);

  // 4. Retracing takes ghosts off: out and back to the start lays nothing.
  const n0 = await p.evaluate(() => D.pieces());
  const outBack = [...[0, 150, 300, 450, 600].map((d) => [x + fx * d, z + fz * d]), ...[450, 300, 150, 10].map((d) => [x + fx * d, z + fz * d])];
  await drawThrough(outBack);
  const n1 = await p.evaluate(() => D.pieces());
  check("drawing out and back again lays nothing", n1 === n0, `${n1 - n0} pieces`);
  // The same with dense points (a finger's), stopping back at the start, a little past it, and a little short of it.
  for (const stop of [0, -30, 40]) {
    const dense = [...[0, 150, 300, 450, 600].map((d) => [x + fx * d, z + fz * d]), ...[450, 300, 150, stop].map((d) => [x + fx * d, z + fz * d])];
    await drawThrough(dense, { stepPx: 3 });
    const n = await p.evaluate(() => D.pieces());
    check(`dense out and back to ${stop} mm from the start lays nothing`, n === n0, `${n - n0} pieces`);
    if (n !== n0) await p.evaluate(() => window.woodrail.interaction.undo());
  }

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

// 7. On a phone: a one-finger touch drag on open ground, up the screen then round to the right.
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
      return cell !== -1 && G.height[cell] === 0 && G.surface[cell] === 0 && G.feature[cell] === 0 && G.road[cell] === 0;
    };
    for (let pz = B.z0 + 600; pz < B.z1 - 600; pz += 72) {
      for (let px = B.x0 + 600; px < B.x1 - 600; px += 72) {
        let ok = true;
        for (let dz = -360; dz <= 360 && ok; dz += 72) for (let dx = -360; dx <= 360 && ok; dx += 72) ok = open(px + dx, pz + dz) && w.layout.queryFreeConnectors(px + dx, pz + dz, 72, []) === 0;
        if (ok) return { x: px, z: pz };
      }
    }
    return null;
  });
  check("on a phone, found open ground to draw on", !!patch, JSON.stringify(patch));
  if (!patch) throw new Error("no open ground");
  await focus(patch.x, patch.z, 420, q);
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
    if (i === pts.length - 3) await q.screenshot({ path: `${OUT}/draw-7-phone-drawing.png` });
  }
  await touch("touchEnd", 0, 0);
  await q.waitForFunction(() => window.woodrail.flourishes.count === 0, null, { timeout: 30000 });
  await q.screenshot({ path: `${OUT}/draw-7-phone-laid.png` });
  const added = await q.evaluate((n0) => {
    const w = window.woodrail;
    return [...w.layout.pieceIds()].slice(n0).map((id) => w.layout.getPiece(id).type);
  }, n0);
  check("on a phone, a one-finger drag lays a line that bends", added.length >= 2 && added.some((t) => t.startsWith("curve")), added.join(" "));
  // Nothing happening: no frames drawn.
  const idle = await q.evaluate(async () => {
    const r = window.woodrail.renderer;
    await new Promise((res) => setTimeout(res, 2500));
    const f0 = r.info.render.frame;
    await new Promise((res) => setTimeout(res, 2000));
    return r.info.render.frame - f0;
  });
  check("idle after drawing: no frames drawn", idle === 0, `${idle} frames in 2 s`);
}

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
