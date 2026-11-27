// End-to-end: Flip on a curve being placed always mirrors it (`npm run e2e:flip [-- <out dir>]`). Reported 2026-11-27:
// "the flip button often doesn't work when placing curves". Carried onto the end of a curve, a curve is shown turning
// on as that curve does (`keepTurning`); Flip set the tray's hand to the other of its own, not of the one shown, so it
// came out just as shown. And a flipped curve that couldn't go where it was seated was seated by its other end, which
// for a curve is the same shape as before the Flip. Now Flip mirrors what's shown, and a flipped curve that can't go
// stays flipped, red, saying why.
// - `mouse`, on a 1440×900 desktop in Sandbox: a large curve carried from the tray (clicked, then moved), in each case
//   F or the tray's Flip, then a click lays it: held loose on open ground; on a straight's end; on a points' end; on a
//   curve's end (shown turning on, flipped to an S); on a curve's end after R; on a curve's end where the flipped one
//   is in the way of a straight (refused, saying so, nothing laid; Flip back lays it). Each laid piece is the mirror
//   of the one shown before the Flip. The pointer-move cost while held, and 0 idle frames after.
// - `touch`, on a 390×844 phone in Sandbox: a large curve dragged from the tray, the tray's Flip tapped with a second
//   finger, the first lifted: loose, on a points' end, on a curve's end, and on a curve's end after Turn.
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
const suite = groups("flip", { results, errors, check });
let server = null;
let b = null;
let p = null;
let ctx = null;
let phone = false;

async function boot() {
  if (b) return;
  server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
  await server.listen();
  await server.warmupRequest("/src/main.ts");
  b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  // (Battery saver: nothing here looks at fine pixels: lib/fast.mjs.)
  batterySaverIn(b);
}

/** A fresh Sandbox page, phone (touch) or desktop. Seed 24: open ground near the start of the view. */
async function openSandbox(onPhone) {
  await boot();
  phone = onPhone;
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
  // (Choosing a mode may reload the page into it: each step tried again after a reload, as the page comes back.)
  const steady = async (step) => {
    for (let k = 0; ; k++) {
      try {
        return await step();
      } catch (e) {
        if (k >= 3 || !/context was destroyed|navigation/i.test(String(e))) throw e;
        await p.waitForLoadState("load").catch(() => {});
      }
    }
  };
  await steady(() => p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 120000 }));
  await steady(() => p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click()));
  await steady(() => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))])));
  await frames();
}

const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const shot = (n) => p.screenshot({ path: `${OUT}/flip-${n}.jpg`, type: "jpeg", quality: 80, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const press = async (xy) => {
  if (phone) await p.touchscreen.tap(xy[0], xy[1]);
  else await p.mouse.click(xy[0], xy[1]);
  await frames();
};
const centre = (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const q = e.getBoundingClientRect(); return q.width ? [q.x + q.width / 2, q.y + q.height / 2] : null; }, sel);
/** A tray item by its key, its shelf opened for it as a player would (by the tray's own catalogue). */
const item = async (key) => {
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
  if (tabAt) await press(tabAt);
  const back = await centre(".scroller .tray-back");
  if (back) await press(back);
  const g = await p.evaluate((label) => { const e = [...document.querySelectorAll(".scroller .tray-group")].find((e) => e.querySelector(".label")?.textContent === label); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, shelf.shelf);
  if (g) await press(g);
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
/** Just past free end `c` of piece `id` (where a piece carried onto it is held). */
const pastEnd = async (id, c, ahead = 40) => {
  const e = await p.evaluate(async ([id, c]) => {
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const q = window.woodrail.layout.getPiece(id);
    const k = getPieceDef(q.type, q.flipped).connectors[c];
    return transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 });
  }, [id, c]);
  return screen(e.x + ahead * Math.cos(e.heading), 0, e.z + ahead * Math.sin(e.heading));
};
/**
 * The piece in hand (held, or the carried one shown under the mouse): its hand, whether it's seated on an end and
 * refused, the refusal shown, and its shape where it would go (its ends' places, to the mm: a curve flipped lies
 * otherwise; one seated by its other end, unflipped, lies the same).
 */
const shown = () =>
  p.evaluate(async () => {
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const i = window.woodrail.interaction;
    const m = i.mode.kind === "drag-piece" ? i.mode : i.preview;
    if (!m) return null;
    const pose = m.snap.kind === "snapped" ? m.snap.pose : m.pose;
    const shape = getPieceDef(m.type, m.flipped).connectors.map((k) => { const a = transformPose(pose, k.pose, { x: 0, z: 0, heading: 0 }); return `${Math.round(a.x)},${Math.round(a.z)}`; }).sort().join(" ");
    return { flipped: m.flipped, snapped: m.snap.kind === "snapped", blocked: m.blocked ?? null, hint: m.hint ?? null, shape, refusal: document.querySelector(".refusal:not([hidden])")?.textContent ?? null };
  });
/** A laid piece's hand and shape (as `shown`). */
const laid = (id) =>
  p.evaluate(async (id) => {
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const q = window.woodrail.layout.getPiece(id);
    if (!q) return null;
    const shape = getPieceDef(q.type, q.flipped).connectors.map((k) => { const a = transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 }); return `${Math.round(a.x)},${Math.round(a.z)}`; }).sort().join(" ");
    return { flipped: q.flipped, shape };
  }, id);
const ids = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
const newPiece = async (before) => (await ids()).find((i) => !before.includes(i));
/** The tray as it was: not flipped, not turned, nothing ready (between cases, so each starts alike). */
const reset = () => p.evaluate(() => { const i = window.woodrail.interaction; i.arm(null); i.trayFlipped = false; i.trayTurns = 0; i.trayFine = 0; window.woodrail.hud.setTrayOrientation(false); });

/**
 * Setup (not what's tested): track laid by the editor on open ground in view, by the game's placement rules: a straight,
 * a set of points and two curves, each alone with its ends free; and a straight beside the second curve where a curve
 * flipped onto its end would go (the one turning on still fits).
 */
const layOut = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const { Layout, connectorRef } = await import("/src/track/layout.ts");
    const { appendPiece } = await import("/src/track/snap.ts");
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const r = w.canvas.getBoundingClientRect();
    const h = w.interaction.cameraHeading();
    const why = (type, pose, flipped = false) => w.interaction.placeWhyIgnoring(type, flipped, pose, 0, -1);
    const ok = (type, pose) => why(type, pose) === null;
    const ground = (fx, fy) => w.interaction.groundAt(r.left + r.width * fx, r.top + r.height * fy);
    const free = [];
    for (let fy = 0.3; fy <= 0.62; fy += 0.08) for (let fx = 0.18; fx <= 0.82; fx += 0.16) {
      const g = ground(fx, fy);
      if (g) free.push(g);
    }
    const placed = {};
    const used = [];
    // Each piece on its own spot, well clear of the others (and of open ground left for the loose case).
    const spot = (type, test) => {
      for (const g of free) {
        if (used.some((u) => Math.hypot(u.x - g.x, u.z - g.z) < 700)) continue;
        const pose = poseForCentre(type, false, g.x, g.z, h);
        if (!ok(type, pose) || (test && !test(pose))) continue;
        used.push(g);
        return pose;
      }
      return null;
    };
    const lay = (type, pose) => w.editor().place(type, pose, 0, false);
    // (A curve on a piece's end `c` in a scratch layout: where it'd lie, plain or mirrored.)
    const curveOn = (type, pose, c, flipped) => {
      const l = new Layout();
      const a = l.addPiece(type, pose, 0, false);
      const n = appendPiece(l, "curve-large", flipped, connectorRef(a, c));
      return n < 0 ? null : l.getPiece(n);
    };
    const s = spot("straight-216");
    if (s) placed.straight = lay("straight-216", s);
    const pts = spot("switch");
    if (pts) placed.points = lay("switch", pts);
    const c1 = spot("curve-large", (pose) => [false, true].every((f) => { const n = curveOn("curve-large", pose, 1, f); return n && ok("curve-large", n.pose) && why("curve-large", n.pose, n.flipped) === null; }));
    if (c1) placed.curve = lay("curve-large", c1);
    // The second curve: the one turning on from it fits; flipped (an S) it'd run into a straight laid across its far end.
    const c2 = spot("curve-large", (pose) => {
      const on = curveOn("curve-large", pose, 1, false);
      const s = curveOn("curve-large", pose, 1, true);
      if (!on || !s) return false;
      const far = transformPose(s.pose, getPieceDef(s.type, s.flipped).connectors[1].pose, { x: 0, z: 0, heading: 0 });
      const bp = poseForCentre("straight-108", false, far.x, far.z, far.heading + Math.PI / 2);
      return ok("straight-108", bp) && why("curve-large", on.pose, on.flipped) === null;
    });
    if (c2) {
      placed.blockedCurve = lay("curve-large", c2);
      const s = curveOn("curve-large", c2, 1, true);
      const far = transformPose(s.pose, getPieceDef(s.type, s.flipped).connectors[1].pose, { x: 0, z: 0, heading: 0 });
      placed.blocker = lay("straight-108", poseForCentre("straight-108", false, far.x, far.z, far.heading + Math.PI / 2));
    }
    // Open ground for a curve held loose, clear of all of it.
    const g = free.find((g) => !used.some((u) => Math.hypot(u.x - g.x, u.z - g.z) < 700) && ok("curve-large", poseForCentre("curve-large", false, g.x, g.z, h)) && ok("curve-large", poseForCentre("curve-large", true, g.x, g.z, h)));
    placed.loose = g ? { x: g.x, z: g.z } : null;
    await w.settled();
    return placed;
  });

/**
 * A large curve from the tray, by mouse: clicked on the tray (carried), moved to `at`, `before` done (R, say), the shape
 * shown noted, Flip by `how` ("key": F; "button": the tray's Flip, the mouse going there and back), the shape shown
 * again, then a click to lay it. The piece laid (or none), and what was shown before and after the Flip.
 */
async function mouseTrial(at, how, before = async () => {}) {
  await reset();
  const from = await item("piece:curve-large");
  await p.mouse.click(from[0], from[1]);
  await frames();
  for (let s = 1; s <= 4; s++) await p.mouse.move(from[0] + ((at[0] - from[0]) * s) / 4, from[1] + ((at[1] - from[1]) * s) / 4);
  await before();
  await p.mouse.move(at[0] + 1, at[1]);
  await p.mouse.move(at[0], at[1]);
  await frames();
  const a = await shown();
  if (how === "key") await p.keyboard.press("f");
  else {
    const fb = await centre(".tray-flip");
    await p.mouse.move(fb[0], fb[1], { steps: 3 });
    await p.mouse.click(fb[0], fb[1]);
    await p.mouse.move(at[0], at[1], { steps: 3 });
  }
  await p.mouse.move(at[0] + 1, at[1]);
  await p.mouse.move(at[0], at[1]);
  await frames();
  const f = await shown();
  const lit = await p.evaluate(() => document.querySelector(".tray-flip")?.classList.contains("active") ?? false);
  const was = await ids();
  await p.mouse.click(at[0], at[1]);
  await frames();
  await p.evaluate(() => window.woodrail.settled());
  const id = await newPiece(was);
  const piece = id === undefined ? null : await laid(id);
  return { a, f, id, piece, lit };
}

/** A large curve from the tray dragged by a finger to `at` (held 56 px above it), `before` done, Flip tapped with a second finger, lifted. */
async function touchTrial(at, before = async () => {}) {
  await reset();
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const from = await item("piece:curve-large");
  const to = [at[0], at[1] + 56];
  await touch("touchStart", [{ x: from[0], y: from[1], id: 1 }]);
  for (let k = 1; k <= 10; k++) {
    await touch("touchMove", [{ x: from[0] + ((to[0] - from[0]) * k) / 10, y: from[1] + ((to[1] - from[1]) * k) / 10, id: 1 }]);
    if (k % 5 === 0) await frames();
  }
  await frames();
  const tap2 = async (sel) => {
    const xy = await centre(sel);
    await touch("touchStart", [{ x: to[0], y: to[1], id: 1 }, { x: xy[0], y: xy[1], id: 2 }]);
    await touch("touchEnd", [{ x: to[0], y: to[1], id: 1 }]);
    await frames();
  };
  await before(tap2);
  const a = await shown();
  await tap2(".tray-flip");
  await touch("touchMove", [{ x: to[0] + 1, y: to[1], id: 1 }]);
  await touch("touchMove", [{ x: to[0], y: to[1], id: 1 }]);
  await frames();
  const f = await shown();
  const was = await ids();
  await touch("touchEnd", []);
  await frames();
  await p.evaluate(() => window.woodrail.settled());
  await cdp.detach();
  const id = await newPiece(was);
  return { a, f, id, piece: id === undefined ? null : await laid(id) };
}

const remove = async (id) => {
  if (id !== undefined) await p.evaluate((id) => window.woodrail.editor().remove(id), id);
  await frames();
};

/** The checks for one trial: flipped from what was shown, and laid as shown after. */
function mirrored(name, t, { snapped = true } = {}) {
  const detail = JSON.stringify({ before: t.a && { f: t.a.flipped, s: t.a.shape, snap: t.a.snapped }, after: t.f && { f: t.f.flipped, s: t.f.shape, blocked: t.f.blocked }, laid: t.piece });
  check(`${name}: shown ${snapped ? "seated on the end" : "loose"} before the Flip`, !!t.a && t.a.snapped === snapped && !t.a.blocked, detail);
  check(`${name}: Flip mirrors what's shown`, !!t.a && !!t.f && t.f.flipped !== t.a.flipped && (snapped ? t.f.shape !== t.a.shape : true), detail);
  check(`${name}: laid as shown after the Flip, not as before`, !!t.piece && t.piece.flipped === t.f?.flipped && (!snapped || (t.piece.shape === t.f.shape && t.piece.shape !== t.a.shape)), detail);
}

async function mouseGroup() {
  await openSandbox(false);
  const at = await layOut();
  check("mouse: track laid for each case (straight, points, two curves, a blocker, open ground)", at.straight >= 0 && at.points >= 0 && at.curve >= 0 && at.blockedCurve >= 0 && at.blocker >= 0 && !!at.loose, JSON.stringify(at));
  await shot("mouse-layout");
  let t = await mouseTrial(await screen(at.loose.x, 0, at.loose.z), "key");
  mirrored("mouse, loose, F", t, { snapped: false });
  check("mouse: F lights the tray's Flip", t.lit);
  await remove(t.id);
  t = await mouseTrial(await pastEnd(at.straight, 1), "button");
  mirrored("mouse, a straight's end, Flip button", t);
  await remove(t.id);
  t = await mouseTrial(await pastEnd(at.points, 2), "key");
  mirrored("mouse, the points' end, F", t);
  await remove(t.id);
  // The reported case: a curve on a curve's end is shown turning on round; Flip makes it an S.
  t = await mouseTrial(await pastEnd(at.curve, 1), "button");
  mirrored("mouse, a curve's end, Flip button", t);
  await shot("mouse-curve-end");
  await remove(t.id);
  t = await mouseTrial(await pastEnd(at.curve, 1), "key");
  mirrored("mouse, a curve's end, F", t);
  await remove(t.id);
  t = await mouseTrial(await pastEnd(at.curve, 1), "key", async () => {
    await p.keyboard.press("r");
    await frames();
  });
  mirrored("mouse, a curve's end after R, F", t);
  await remove(t.id);
  // Flipped where it can't go: it stays flipped (not seated by its other end, as it was), red, and says why.
  const end = await pastEnd(at.blockedCurve, 1);
  t = await mouseTrial(end, "key");
  const detail = JSON.stringify({ before: t.a, after: t.f, laid: t.piece });
  check("mouse, flipped into a straight: shown fitting before the Flip", !!t.a && t.a.snapped && !t.a.blocked, detail);
  check("mouse, flipped into a straight: stays flipped, refused", !!t.f && t.f.flipped !== t.a?.flipped && t.f.shape !== t.a?.shape && !!t.f.blocked, detail);
  check("mouse, flipped into a straight: says why (Flipped, it won't fit: another piece, Flip back)", /Flipped, it won't fit/.test(t.f?.hint ?? "") && /Flip back/.test(t.f?.hint ?? ""), t.f?.hint);
  check("mouse, flipped into a straight: the click lays nothing (never the unflipped one in its place)", t.piece === null, detail);
  const said = await p.evaluate(() => [...document.querySelectorAll(".toast, .refusal")].map((e) => e.textContent).join(" | "));
  check("mouse, flipped into a straight: the click says why", /Flipped, it won't fit/.test(said), said);
  await shot("mouse-refused");
  // Flip back: it fits, and goes down turning on.
  await p.keyboard.press("f");
  await p.mouse.move(end[0] + 1, end[1]);
  await p.mouse.move(end[0], end[1]);
  await frames();
  const back = await shown();
  const was = await ids();
  await p.mouse.click(end[0], end[1]);
  await frames();
  await p.evaluate(() => window.woodrail.settled());
  const nb = await newPiece(was);
  const lb = nb === undefined ? null : await laid(nb);
  check("mouse, flipped into a straight: Flip back, it fits and is laid as first shown", !!lb && !back.blocked && lb.shape === t.a?.shape, JSON.stringify({ back, laid: lb }));
  // The pointer-move cost with a flipped curve on a curve's end.
  await reset();
  const from = await item("piece:curve-large");
  await p.mouse.click(from[0], from[1]);
  const ce = await pastEnd(at.curve, 1);
  await p.mouse.move(ce[0], ce[1], { steps: 4 });
  await p.keyboard.press("f");
  await p.mouse.move(ce[0] + 1, ce[1]);
  const cost = await p.evaluate(([x, y]) => {
    const i = window.woodrail.interaction;
    const times = [];
    for (let k = 0; k < 30; k++) {
      const t0 = performance.now();
      i.showPreview(x + (k % 5), y + (k % 3));
      times.push(performance.now() - t0);
    }
    times.sort((a, c) => a - c);
    return times[15];
  }, ce);
  console.log(`(mouse: a flipped curve's move ${cost.toFixed(2)} ms median)`);
  check("mouse: a flipped curve's pointer move costs a few ms", cost < 8, `${cost.toFixed(2)} ms`);
  await p.keyboard.press("Escape");
  await reset();
  await p.evaluate(() => window.woodrail.settled());
  const idle = await p.evaluate(async () => {
    const w = window.woodrail;
    const sail = w.boats.update;
    w.boats.update = () => false;
    await new Promise((r) => setTimeout(r, 1500));
    const f1 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    w.boats.update = sail;
    return w.framesDrawn - f1;
  });
  check("mouse: 0 frames drawn once still", idle === 0, `${idle} frames in 2 s`);
}

async function touchGroup() {
  await openSandbox(true);
  const at = await layOut();
  check("touch: track laid for each case", at.points >= 0 && at.curve >= 0 && !!at.loose, JSON.stringify(at));
  let t = await touchTrial(await screen(at.loose.x, 0, at.loose.z));
  mirrored("touch, loose", t, { snapped: false });
  await remove(t.id);
  t = await touchTrial(await pastEnd(at.points, 2));
  mirrored("touch, the points' end", t);
  await remove(t.id);
  t = await touchTrial(await pastEnd(at.curve, 1));
  mirrored("touch, a curve's end", t);
  await shot("touch-curve-end");
  await remove(t.id);
  t = await touchTrial(await pastEnd(at.curve, 1), async (tap2) => tap2(".tray-orient button:first-child"));
  mirrored("touch, a curve's end after Turn", t);
  await remove(t.id);
}

suite.add("mouse", mouseGroup, { about: "a carried curve flipped (F or Flip) loose, on a straight's, points' and curve's end, after R, and where it can't go, on a 1440×900 desktop" });
suite.add("touch", touchGroup, { about: "a held curve flipped by a second finger on Flip, loose, on a points' and a curve's end, after Turn, on a 390×844 phone" });
await suite.run();
check("no page errors", errors.length === 0, errors.join(" | "));
await b?.close();
await server?.close();
suite.finish();
