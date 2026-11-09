// End-to-end: finer turning of a held piece (`npm run e2e:rotate [-- <out dir>]`). Turn steps an eighth, as the curves
// do; a held piece can be turned finer, in 15° steps (src/game/headings.ts):
// - `touch`, on a 390×844 phone in Sandbox: a large curve dragged from the tray onto open ground, a second finger put
//   down beside it and twisted about the first by about 32°: the curve in hand turns 30° (a fine heading, not an
//   eighth), the second finger lifts and the first still holds it; let go, it lies at 30° from how it came out. A second
//   curve dragged onto its free end seats there and joins, turned on 45° from it. Two fingers on the map with nothing
//   held still move the view. The twist's cost per move, and 0 idle frames after.
// - `mouse`, on a 1440×900 desktop in Sandbox: a large curve dragged from the tray, Shift+R twice while held (15° each),
//   let go at 30° from how it came out; then seven more large curves from the tray, each clicked onto the free end
//   before it, and the eighth's end joins the first's: a loop that closes, from a piece at an in-between heading. Plain R
//   from 30° goes on to the next eighth (45°). The pointer-move cost while held, and 0 idle frames after.
// Pictures: docs/agents/shots/rotate-*.jpg (with an out dir: there instead). Groups: `-- --list`.
// Starts its own dev server on any free port. Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium if present.
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { batterySaverIn } from "./lib/fast.mjs";
import { groups } from "./lib/groups.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const suite = groups("rotate", { results, errors, check });
let server = null;
let b = null;
let p = null;
let ctx = null;
const DEG = Math.PI / 180;
/** Degrees from `a` to `b`, in (−180, 180]. */
const turnDeg = (a, bb) => {
  let d = (((bb - a) / DEG) % 360 + 360) % 360;
  if (d > 180) d -= 360;
  return d;
};

async function boot() {
  if (b) return;
  server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
  await server.listen();
  await server.warmupRequest("/src/main.ts");
  b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  // (Battery saver: nothing here looks at fine pixels, and the high tier's effects cost seconds a frame: lib/fast.mjs.)
  batterySaverIn(b);
}

/** A fresh Sandbox page, phone (touch) or desktop. Seed 24: open ground near the start of the view. */
async function openSandbox(phone) {
  await boot();
  await ctx?.close().catch(() => {});
  ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    localStorage.setItem("woodrail.favourites", "[]");
  });
  p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(`${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-24`);
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 120000 });
  await p.evaluate(() => {
    const help = document.querySelector(".help");
    if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
    document.querySelector(".coach:not([hidden]) .coach-skip")?.click();
  });
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await frames();
}

const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const shot = (n) => p.screenshot({ path: `${OUT}/rotate-${n}.jpg`, type: "jpeg", quality: 80, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const press = async (xy, touch) => {
  if (touch) await p.touchscreen.tap(xy[0], xy[1]);
  else await p.mouse.click(xy[0], xy[1]);
  await frames();
};
/** A tray item by its key, its shelf opened for it as a player would (by the tray's own catalogue). */
const item = async (key, touch) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return q.width ? [q.x + q.width / 2, q.y + q.height / 2] : null; }, key);
  const r0 = await find();
  if (r0) return r0;
  const shelf = await p.evaluate(async (key) => {
    const { trayTabs, trayKey } = await import("/src/ui/tray-catalogue.ts");
    for (const t of trayTabs(window.woodrail.mode())) for (const g of t.groups) if (g.items.some((i) => trayKey(i) === key)) return { tab: t.label, shelf: g.label };
    return null;
  }, key);
  if (!shelf) return null;
  const tabAt = await p.evaluate((label) => { const t = [...document.querySelectorAll(".tray .tabs .tab")].find((t) => t.textContent.trim() === label); if (!t) return null; const q = t.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, shelf.tab);
  if (tabAt) await press(tabAt, touch);
  const back = await p.evaluate(() => { const e = document.querySelector(".scroller .tray-back"); if (!e) return null; const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
  if (back) await press(back, touch);
  const g = await p.evaluate((label) => { const e = [...document.querySelectorAll(".scroller .tray-group")].find((e) => e.querySelector(".label")?.textContent === label); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, shelf.shelf);
  if (g) await press(g, touch);
  return find();
};
/** Where on screen a world point is. */
const screen = (x, y, z) =>
  p.evaluate(([x, y, z]) => {
    const w = window.woodrail;
    const v = new w.camera.position.constructor(x, y, z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, [x, y, z]);
const held = () => p.evaluate(() => { const m = window.woodrail.interaction.mode; return m.kind === "drag-piece" ? { heading: m.heading, type: m.type, blocked: m.blocked ?? null, snap: m.snap.kind } : { kind: m.kind }; });
/** The pieces' ids now (to find the one a drop laid). */
const ids = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
/** The piece laid since `before` (ids), of `type` (risers aside), or null. */
const laidSince = (before, type = "curve-large") =>
  p.evaluate(([before, type]) => {
    const l = window.woodrail.layout;
    const id = [...l.pieceIds()].find((i) => !before.includes(i) && l.getPiece(i).type === type);
    if (id === undefined) return null;
    const q = l.getPiece(id);
    return { id, type: q.type, heading: q.pose.heading, x: q.pose.x, z: q.pose.z };
  }, [before, type]);
const joined = (a, bb) =>
  p.evaluate(async ([a, bb]) => {
    const { pieceOfRef } = await import("/src/track/layout.ts");
    return [...window.woodrail.layout.joints()].some((j) => (pieceOfRef(j.a) === a && pieceOfRef(j.b) === bb) || (pieceOfRef(j.a) === bb && pieceOfRef(j.b) === a));
  }, [a, bb]);
/** A piece's free end `c` in the world, a little back along the piece (so the press is on the end, not past it). */
const endOf = (id, c) =>
  p.evaluate(async ([id, c]) => {
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const q = window.woodrail.layout.getPiece(id);
    const k = getPieceDef(q.type, q.flipped).connectors[c];
    const at = transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 });
    return { x: at.x - 12 * Math.cos(at.heading), z: at.z - 12 * Math.sin(at.heading), heading: at.heading };
  }, [id, c]);

/**
 * Open ground for a circle of eight large curves, the first at `heading`, its middle at the spot: checked by the game's
 * own placement rules (`placeWhy`) for each of the eight, on the land in view. The spot's ground point, or null.
 */
const roomForCircle = (heading) =>
  p.evaluate(async (heading) => {
    const w = window.woodrail;
    const { Layout, connectorRef } = await import("/src/track/layout.ts");
    const { appendPiece } = await import("/src/track/snap.ts");
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const r = w.canvas.getBoundingClientRect();
    for (let fy = 0.35; fy <= 0.6; fy += 0.05) {
      for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
        const g = w.interaction.groundAt(r.left + r.width * fx, r.top + r.height * fy);
        if (!g) continue;
        // (With room to spare: the circle shifted 45 mm each way fits too, as the piece goes down on the quarter-square
        // grid, a little off where it's held.)
        const fits = (dx, dz) => {
          const l = new Layout();
          let id = l.addPiece("curve-large", poseForCentre("curve-large", false, g.x + dx, g.z + dz, heading));
          const all = [id];
          for (let k = 1; k < 8; k++) all.push((id = appendPiece(l, "curve-large", false, connectorRef(id, 1))));
          return all.every((i) => w.interaction.placeWhy("curve-large", l.getPiece(i).pose, 0, -1) === null);
        };
        if ([[0, 0], [45, 0], [-45, 0], [0, 45], [0, -45]].every(([dx, dz]) => fits(dx, dz))) return { x: g.x, z: g.z };
      }
    }
    return null;
  }, heading);

/** No frames drawn in 2 s once all is still (boats held still, as in e2e:touch). */
const idleFrames = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    const sail = w.boats.update;
    w.boats.update = () => false;
    await new Promise((r) => setTimeout(r, 1500));
    const f1 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    w.boats.update = sail;
    return w.framesDrawn - f1;
  });

/** The median (ms) of `n` calls of the held piece's pointer-move work at the finger (`updateDrag`), and of a twist's. */
const moveCost = (x, y, n = 30) =>
  p.evaluate(([x, y, n]) => {
    const i = window.woodrail.interaction;
    const times = [];
    for (let k = 0; k < n; k++) {
      const t0 = performance.now();
      i.updateDrag(x + (k % 5), y + (k % 3));
      times.push(performance.now() - t0);
    }
    times.sort((a, bb) => a - bb);
    return times[Math.floor(n / 2)];
  }, [x, y, n]);

async function touchGroup() {
  await openSandbox(true);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const facing = await p.evaluate(() => window.woodrail.interaction.cameraHeading());
  const spot = await roomForCircle(facing + 30 * DEG);
  check("touch: open ground for a circle in view", !!spot);
  if (!spot) return;
  const from = await item("piece:curve-large", true);
  check("touch: the large curve is on the tray", !!from);
  if (!from) return;
  // On touch the held piece rides 56 px above the finger: the finger goes that far below the spot.
  const s = await screen(spot.x, 0, spot.z);
  const to = [s[0], s[1] + 56];
  await touch("touchStart", [{ x: from[0], y: from[1], id: 1 }]);
  for (let k = 1; k <= 12; k++) {
    await touch("touchMove", [{ x: from[0] + ((to[0] - from[0]) * k) / 12, y: from[1] + ((to[1] - from[1]) * k) / 12, id: 1 }]);
    if (k % 4 === 0) await frames();
  }
  await frames();
  const h0 = await held();
  check("touch: a curve dragged from the tray is held", h0.type === "curve-large", JSON.stringify(h0));
  // The second finger 110 px to the right of the first, then turned about it, in steps, by 32° (on the ground).
  const g1 = await p.evaluate(([x, y]) => { const g = window.woodrail.interaction.groundAt(x, y); return g && { x: g.x, z: g.z }; }, to);
  // (110 px, in mm on the ground there.)
  const r = 110 * (await p.evaluate(([x, y]) => { const i = window.woodrail.interaction; const a = i.groundAt(x, y); const c = i.groundAt(x + 10, y); return a.distanceTo(c) / 10; }, to));
  const a0 = 0;
  const finger2 = async (a) => screen(g1.x + r * Math.cos(a), 0, g1.z + r * Math.sin(a));
  let f2 = await finger2(a0);
  await touch("touchStart", [{ x: to[0], y: to[1], id: 1 }, { x: f2[0], y: f2[1], id: 2 }]);
  await frames();
  const stillHeld = (await held()).type === "curve-large";
  const target0 = await p.evaluate(() => window.woodrail.controls.target.clone());
  let worst = 0;
  for (let k = 1; k <= 8; k++) {
    f2 = await finger2(a0 + (32 * DEG * k) / 8);
    const t0 = Date.now();
    await touch("touchMove", [{ x: to[0], y: to[1], id: 1 }, { x: f2[0], y: f2[1], id: 2 }]);
    worst = Math.max(worst, Date.now() - t0);
  }
  await frames();
  const h1 = await held();
  const twisted = turnDeg(h0.heading, h1.heading);
  await shot("touch-twist");
  const target1 = await p.evaluate(() => window.woodrail.controls.target.clone());
  check("touch: a second finger on the map doesn't drop the held piece (it twists it)", stillHeld && h1.type === "curve-large", JSON.stringify(h1));
  check("touch: twisted 32°, the curve in hand turns 30° (a fine step, not an eighth)", Math.abs(Math.abs(twisted) - 30) < 0.01, `${twisted.toFixed(2)}°`);
  check("touch: the view stays put while twisting", Math.hypot(target1.x - target0.x, target1.z - target0.z) < 1, `moved ${Math.hypot(target1.x - target0.x, target1.z - target0.z).toFixed(1)} mm`);
  // The second finger lifts: the first still holds.
  await touch("touchMove", [{ x: to[0], y: to[1], id: 1 }]);
  await frames();
  const h2 = await held();
  check("touch: the second finger lifts, the first still holds the piece, turned as twisted", h2.type === "curve-large" && Math.abs(turnDeg(h1.heading, h2.heading)) < 0.01, JSON.stringify(h2));
  const cost = await moveCost(to[0], to[1]);
  console.log(`(touch: a held piece's move ${cost.toFixed(2)} ms median at the finger; a twist's move round trip ${worst} ms worst)`);
  check("touch: a held piece's pointer move costs a few ms", cost < 8, `${cost.toFixed(2)} ms`);
  const before = await ids();
  await touch("touchEnd", []);
  await frames();
  await p.evaluate(() => window.woodrail.settled());
  const laid = await laidSince(before);
  check("touch: let go, the curve lies at 30° from how it came out", !!laid && Math.abs(Math.abs(turnDeg(h0.heading, laid.heading)) - 30) < 0.01, JSON.stringify({ laid, twisted: laid && turnDeg(h0.heading, laid.heading) }));
  if (!laid) return;
  // A second curve onto its free end: it seats and joins (the in-between heading meets the curves).
  const endC = await endOf(laid.id, 1);
  const e = await screen(endC.x, 0, endC.z);
  const from2 = await item("piece:curve-large", true);
  const to2 = [e[0], e[1] + 56];
  await touch("touchStart", [{ x: from2[0], y: from2[1], id: 1 }]);
  for (let k = 1; k <= 12; k++) {
    await touch("touchMove", [{ x: from2[0] + ((to2[0] - from2[0]) * k) / 12, y: from2[1] + ((to2[1] - from2[1]) * k) / 12, id: 1 }]);
    if (k % 4 === 0) await frames();
  }
  await frames();
  const h3 = await held();
  const before2 = await ids();
  await touch("touchEnd", []);
  await frames();
  await p.evaluate(() => window.woodrail.settled());
  const next = await laidSince(before2);
  const turned = next ? turnDeg(laid.heading, next.heading) : NaN;
  check("touch: a second curve held at its free end seats there", h3.snap === "snapped", JSON.stringify(h3));
  check("touch: …and joins it, turned on an eighth (45°)", !!next && (await joined(laid.id, next.id)) && Math.abs(Math.abs(turned) - 45) < 0.01, `${turned.toFixed(2)}°`);
  await shot("touch-laid");
  // Two fingers with nothing held still move the view (a pinch/pan).
  const v0 = await p.evaluate(() => window.woodrail.controls.target.clone());
  const c = [195, 300];
  await touch("touchStart", [{ x: c[0] - 60, y: c[1], id: 1 }, { x: c[0] + 60, y: c[1], id: 2 }]);
  for (let k = 1; k <= 8; k++) await touch("touchMove", [{ x: c[0] - 60 + 10 * k, y: c[1] + 8 * k, id: 1 }, { x: c[0] + 60 + 10 * k, y: c[1] + 8 * k, id: 2 }]);
  await touch("touchEnd", []);
  await frames();
  const v1 = await p.evaluate(() => window.woodrail.controls.target.clone());
  check("touch: two fingers with nothing held still move the view", Math.hypot(v1.x - v0.x, v1.z - v0.z) > 5, `moved ${Math.hypot(v1.x - v0.x, v1.z - v0.z).toFixed(0)} mm`);
  await p.evaluate(() => window.woodrail.settled());
  const idle = await idleFrames();
  check("touch: 0 frames drawn once still", idle === 0, `${idle} frames in 2 s`);
}

async function mouseGroup() {
  await openSandbox(false);
  const facing = await p.evaluate(() => window.woodrail.interaction.cameraHeading());
  const spot = await roomForCircle(facing + 30 * DEG);
  check("mouse: open ground for a circle in view", !!spot);
  if (!spot) return;
  const from = await item("piece:curve-large", false);
  check("mouse: the large curve is on the tray", !!from);
  if (!from) return;
  const to = await screen(spot.x, 0, spot.z);
  // Dragged out (button held), Shift+R twice while held, let go.
  await p.mouse.move(from[0], from[1]);
  await p.mouse.down();
  for (let k = 1; k <= 8; k++) await p.mouse.move(from[0] + ((to[0] - from[0]) * k) / 8, from[1] + ((to[1] - from[1]) * k) / 8);
  await frames();
  const h0 = await held();
  check("mouse: a curve dragged from the tray is held", h0.type === "curve-large", JSON.stringify(h0));
  await p.keyboard.press("Shift+R");
  await frames();
  const h1 = await held();
  await p.keyboard.press("Shift+R");
  await frames();
  const h2 = await held();
  check("mouse: Shift+R turns the held curve 15°, and again to 30°", Math.abs(turnDeg(h0.heading, h1.heading) - 15) < 0.01 && Math.abs(turnDeg(h0.heading, h2.heading) - 30) < 0.01, `${turnDeg(h0.heading, h1.heading).toFixed(2)}°, ${turnDeg(h0.heading, h2.heading).toFixed(2)}°`);
  await p.mouse.move(to[0] + 2, to[1] + 1);
  await p.mouse.move(to[0], to[1]);
  await frames();
  const cost = await moveCost(to[0], to[1]);
  console.log(`(mouse: a held piece's move ${cost.toFixed(2)} ms median)`);
  check("mouse: a held piece's pointer move costs a few ms", cost < 8, `${cost.toFixed(2)} ms`);
  await shot("mouse-held");
  const before = await ids();
  await p.mouse.up();
  await frames();
  await p.evaluate(() => window.woodrail.settled());
  const first = await laidSince(before);
  check("mouse: let go, the curve lies at 30° from how it came out", !!first && Math.abs(turnDeg(h0.heading, first.heading) - 30) < 0.01, JSON.stringify(first));
  if (!first) return;
  // Seven more, each from the tray clicked onto the free end before it (carried, as ramps.mjs lays a lane).
  let last = first.id;
  const loop = [first.id];
  for (let k = 1; k < 8; k++) {
    const end = await endOf(last, 1);
    const at = await screen(end.x, 0, end.z);
    const r = await item("piece:curve-large", false);
    if (!r) break;
    const was = await ids();
    await p.mouse.click(r[0], r[1]);
    await frames();
    // Turned (R, as Turn) till it faces on round the circle, as a player turns the curve in hand to go on round.
    const turns = await p.evaluate((h) => { const t = window.woodrail.interaction.trayHeading(); return ((Math.round((h - t) / (Math.PI / 4)) % 8) + 8) % 8; }, end.heading);
    for (let t = 0; t < turns; t++) await p.keyboard.press("r");
    for (let s = 1; s <= 4; s++) await p.mouse.move(r[0] + ((at[0] - r[0]) * s) / 4, r[1] + ((at[1] - r[1]) * s) / 4);
    await frames();
    await p.mouse.click(at[0], at[1]);
    await frames();
    await p.keyboard.press("Escape");
    await p.evaluate(() => window.woodrail.settled());
    const n = await laidSince(was);
    if (!n || !(await joined(last, n.id))) {
      console.log(`(curve ${k + 1} didn't join: ${JSON.stringify(n)}; said ${await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "))})`);
      break;
    }
    loop.push(n.id);
    last = n.id;
  }
  check("mouse: seven more curves from the tray, each joined to the one before", loop.length === 8, `${loop.length} laid`);
  const closed = loop.length === 8 && (await joined(loop[7], loop[0]));
  check("mouse: the eighth's end joins the first's: the loop from a piece at 30° closes", closed);
  await shot("mouse-loop");
  // Plain R on a placed piece at 30°... goes on to the next eighth: a picked one, by its card's Rotate (keys: R).
  const firstNow = await p.evaluate((id) => window.woodrail.layout.getPiece(id).pose.heading, first.id);
  const lone = await p.evaluate(async (heading) => {
    // (Setup, not what's tested: a lone straight put down by the editor at 30° past an eighth, away from the loop.)
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const r = w.canvas.getBoundingClientRect();
    for (let fy = 0.3; fy <= 0.7; fy += 0.05) for (let fx = 0.2; fx <= 0.8; fx += 0.05) {
      const g = w.interaction.groundAt(r.left + r.width * fx, r.top + r.height * fy);
      if (!g) continue;
      const pose = poseForCentre("straight-108", false, g.x, g.z, heading);
      if (w.interaction.placeWhy("straight-108", pose, 0, -1) !== null) continue;
      const id = w.editor().place("straight-108", pose, 0, false);
      if (typeof id === "number" && id >= 0) return { id, x: g.x, z: g.z };
    }
    return null;
  }, firstNow);
  if (lone) {
    const at = await screen(lone.x, 0, lone.z);
    await p.mouse.click(at[0], at[1]);
    await frames();
    const sel = await p.evaluate(() => window.woodrail.interaction.selectedPiece);
    await p.keyboard.press("r");
    await frames();
    await p.evaluate(() => window.woodrail.settled());
    const h = await p.evaluate((id) => window.woodrail.layout.getPiece(id).pose.heading, lone.id);
    check("mouse: R on a piece at 30° turns it on to the next eighth (45°)", sel === lone.id && Math.abs(turnDeg(facing, h) - 45) < 0.01, `${turnDeg(facing, h).toFixed(2)}° from the view's eighth`);
    await p.keyboard.press("Escape");
  } else check("mouse: room for a lone straight", false);
  await p.evaluate(() => window.woodrail.settled());
  const idle = await idleFrames();
  check("mouse: 0 frames drawn once still", idle === 0, `${idle} frames in 2 s`);
}

suite.add("touch", touchGroup, { about: "a held curve twisted 30° by a second finger on a 390×844 phone, laid, and a curve joined on" });
suite.add("mouse", mouseGroup, { about: "a held curve turned 30° by Shift+R on a 1440×900 desktop, laid, and a loop of eight that closes" });
await suite.run();
check("no page errors", errors.length === 0, errors.join(" | "));
await b?.close();
await server?.close();
suite.finish();
