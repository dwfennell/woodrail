// End-to-end touch tests on a phone (`npm run e2e:touch`): real touch taps (hasTouch, touchscreen.tap) at 390×844.
// A tap's click lands 10–20 ms after the finger lifts, wherever the finger was: on touch, on whatever a tap's pointerup
// put there (a tray shelf's Back, a card's Delete or Remove). The click shield (src/ui/click-shield.ts) drops it. Starts its own dev server on any free port. Chromium as for e2e:roads.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
// Have the dev server find and pre-bundle the game's dependencies now, so it doesn't reload the page mid-test.
await server.warmupRequest("/src/main.ts");
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];

/** Two frames from now (a layout and a paint): what a tap did has been drawn. */
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * Do `act` (a tap), then wait for that tap's own click to have been dispatched (counted before any game code sees it,
 * so a click the shield drops counts too), and a frame after it. No fixed waits: under load the click can lag seconds.
 */
async function tapped(page, act) {
  const before = await page.evaluate(() => window.__allClicks);
  await act();
  await page.waitForFunction((n) => window.__allClicks > n, before, { timeout: 60000 });
  await frames(page);
}

/** Taps on the map that open a card under the finger: the card's buttons mustn't take the tap's click. */
async function mapTaps(p) {
  await p.keyboard.press("Escape");
  // Close in on open ground in the middle of the screen.
  await p.evaluate(async () => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    const g = w.interaction.groundAt(195, 420);
    w.director.glideTo(g, frameDistance(320, w.camera.fov, w.camera.aspect), { duration: 0.3 });
  });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  /** Put a long straight down (across the screen) with its middle under screen point (sx, sy). */
  const placeAt = (sx, sy) =>
    p.evaluate(async ([sx, sy]) => {
      const w = window.woodrail;
      const { poseForCentre } = await import("/src/editor/editor.ts");
      const g = w.interaction.groundAt(sx, sy);
      return w.editor().place("straight-216", poseForCentre("straight-216", false, g.x, g.z, 0), 0, false);
    }, [sx, sy]);
  const visible = (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }, sel);
  const rectOf = (sel) => p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  const settle = () => frames(p);

  // 1. A piece: where does its card put Delete? Then a piece right there, tapped.
  await placeAt(195, 300);
  await tapped(p, () => p.touchscreen.tap(195, 300));
  await p.waitForFunction(() => !document.querySelector(".piece-card").hidden, null, { timeout: 60000 });
  const [dx, dy] = await rectOf(".piece-card .danger");
  await p.keyboard.press("Escape");
  await placeAt(dx, dy);
  const before = await p.evaluate(() => window.woodrail.layout.pieceCount);
  await tapped(p, () => p.touchscreen.tap(dx, dy));
  const after = await p.evaluate(() => window.woodrail.layout.pieceCount);
  check("a tap on a piece where its card's Delete opens doesn't delete it", after === before, `${before} → ${after} pieces`);
  check("…and its card is open", await visible(".piece-card"));
  await p.keyboard.press("Escape");
  // (That card opened over the piece, so the view may have glided to keep it clear (Interaction.keepClearOfCard), after
  // a pause that a loaded machine stretches: let it finish, then lay track where the engine goes, wherever it is now.)
  await new Promise((r) => setTimeout(r, 300));
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await placeAt(195, 300);

  // 2. An engine: where does its card put Go (the button a stray click would press: it'd start the engine)? Then an
  // engine right there, tapped.
  const addEngineAt = (sx, sy) =>
    p.evaluate(async ([sx, sy]) => {
      const w = window.woodrail;
      const { nearestCursor } = await import("/src/sim/nearest.ts");
      const g = w.interaction.groundAt(sx, sy);
      const near = nearestCursor(w.layout, g.x, g.z, 60, 0);
      const r = near && w.sim.addTrainAround(["engine"], near.cursor);
      w.invalidate();
      return r?.kind ?? "no track";
    }, [sx, sy]);
  check("an engine goes on the track", (await addEngineAt(195, 300)) === "placed");
  await settle();
  await tapped(p, () => p.touchscreen.tap(195, 300));
  await p.waitForFunction(() => !document.querySelector(".engine-card").hidden, null, { timeout: 60000 });
  const [rx, ry] = await rectOf(".engine-card .go");
  await p.keyboard.press("Escape");
  await placeAt(rx, ry);
  check("a second engine goes under where Go opens", (await addEngineAt(rx, ry)) === "placed");
  await settle();
  const trains = () => p.evaluate(() => window.woodrail.sim.trainIds().map((id) => window.woodrail.sim.getTrain(id).cars.map((c) => c.lever).join("")).join("|"));
  const t0 = await trains();
  await tapped(p, () => p.touchscreen.tap(rx, ry));
  const t1 = await trains();
  check("a tap on an engine where its card's Go opens neither starts nor removes it", t1 === t0, `${t0} → ${t1}`);
  check("…and its card is open", await visible(".engine-card"));
}

/**
 * Panning over the map never moves things by accident: a one-finger drag that starts on a piece (or a train) that isn't
 * selected pans the view and leaves it be; tap it first (selected), and then a drag moves it.
 */
async function selectThenDrag(ctx, p) {
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  /**
   * A one-finger drag from (x, y), `dx` px across, in small steps; then the scene is let settle. Returns what the
   * interaction was doing halfway (a drag of a piece or train, or "idle": the camera has the gesture).
   */
  // (Each event stamped with when it happens, 16 ms apart: a quick drag. A loaded machine delivers them late, and
  // unstamped, a quick drag would look like a finger resting first, which picks the piece up: QA saw it flake.)
  const at = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const drag = async (x, y, dx) => {
    const t0 = Date.now() / 1000;
    await at("touchStart", x, y, t0);
    let mid = "";
    for (let k = 1; k <= 12; k++) {
      await at("touchMove", x + (dx * k) / 12, y, t0 + k * 0.016);
      if (k === 6) mid = await p.evaluate(() => window.woodrail.interaction.mode.kind);
    }
    // (Still a moment before lifting, as a finger that means to stop does: no fling carries the view on.)
    await at("touchMove", x + dx, y, t0 + 12 * 0.016 + 0.15);
    await at("touchEnd", 0, 0, t0 + 12 * 0.016 + 0.16);
    await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
    return mid;
  };
  await p.keyboard.press("Escape");
  // A long straight across the middle of the screen, on open ground: clear of the track and the trains the steps
  // before put down (and of models), wherever they and the opening view left things. The view goes there first.
  const id = await p.evaluate(async () => {
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const { frameDistance } = await import("/src/game/camera-director.ts");
    const t = w.controls.target;
    // (Flat, within the view's bounds, clear of pieces and models: window.__clearAt.)
    const clear = (x, z) => window.__clearAt(x, z);
    for (let r = 0; r <= 9000; r += 216)
      for (let a = 0; a < (r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / 216))); a++) {
        const x = Math.round(t.x + r * Math.cos((a * 2 * Math.PI) / Math.max(8, Math.round((2 * Math.PI * r) / 216))));
        const z = Math.round(t.z + r * Math.sin((a * 2 * Math.PI) / Math.max(8, Math.round((2 * Math.PI * r) / 216))));
        if (!(await clear(x, z))) continue;
        const id = w.editor().place("straight-216", poseForCentre("straight-216", false, x, z, 0), 0, false);
        if (typeof id !== "number" || id < 0) continue;
        // (Close enough that the piece is a good size on screen: zoomed out, its middle is near enough an end that a
        // press there, drawing, draws from the end.)
        w.director.glideTo(t.clone().set(x, 0, z), Math.min(w.camera.position.distanceTo(t), frameDistance(700, w.camera.fov, w.camera.aspect)), { duration: 0.3 });
        return id;
      }
    throw new Error("no open ground for the straight");
  });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  const where = () =>
    p.evaluate((id) => {
      const w = window.woodrail;
      const piece = w.layout.getPiece(id);
      const t = w.controls.target;
      return { piece: piece ? [Math.round(piece.pose.x), Math.round(piece.pose.z)] : null, view: [Math.round(t.x), Math.round(t.z)] };
    }, id);
  const onScreen = () =>
    p.evaluate((id) => {
      const w = window.woodrail;
      const piece = w.layout.getPiece(id);
      const { x, z } = piece.pose;
      const c = new w.camera.position.constructor(x + Math.cos(piece.pose.heading) * 108, piece.y, z + Math.sin(piece.pose.heading) * 108).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
    }, id);
  const onPiece = () =>
    p.evaluate((id) => {
      const w = window.woodrail;
      const piece = w.layout.getPiece(id);
      const r = w.canvas.getBoundingClientRect();
      let first = null;
      for (const f of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const d = 216 * f;
        const c = new w.camera.position.constructor(piece.pose.x + Math.cos(piece.pose.heading) * d, piece.y, piece.pose.z + Math.sin(piece.pose.heading) * d).project(w.camera);
        const xy = [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
        first ??= xy;
        const hit = w.interaction.pick(xy[0], xy[1], true);
        if (hit?.kind === "piece" && hit.pieceId === id) return xy;
      }
      return first;
    }, id);
  // 1. Not selected: the drag pans, the piece stays.
  const a0 = await where();
  let [sx, sy] = await onScreen();
  const aMid = await drag(sx, sy, -120);
  const a1 = await where();
  check("a drag that starts on an unselected piece pans the view", aMid === "idle" && (a1.view[0] !== a0.view[0] || a1.view[1] !== a0.view[1]), `mid-drag ${aMid}, view ${a0.view} → ${a1.view}`);
  check("…and leaves the piece where it was", JSON.stringify(a1.piece) === JSON.stringify(a0.piece), `piece ${a0.piece} → ${a1.piece}`);
  // 2. Tapped (selected), then dragged: it moves.
  // (Where a tap takes the piece: its middle, or along it if a tree or a house stands in front of its middle there,
  // as one may once the view's been panned: then the tap selects that, rightly.)
  [sx, sy] = await onPiece();
  await p.touchscreen.tap(sx, sy);
  await p.waitForFunction(() => !document.querySelector(".piece-card").hidden, null, { timeout: 60000 });
  // (A short drag along the piece's own line, so it lands where it can go.)
  const bMid = await drag(sx, sy, -40);
  check("tap a piece to select it, then a drag picks it up and moves it", bMid === "drag-piece", `mid-drag ${bMid}; tapped ${await p.evaluate(([x, y]) => JSON.stringify(window.woodrail.interaction.pick(x, y, true)), [sx, sy])}`);
  await p.keyboard.press("Escape");
  // 2b. Long-press to pick up: let go of it first (nothing selected), then a finger resting on it picks it up into a drag.
  await p.keyboard.press("Escape");
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  /** Touch down at (x, y), rest `ms` (with a 3 px wobble), maybe put a second finger down, then report the mode. */
  // (The mode is read in the page, `ms` after the finger came down by the page's own clock: a slow machine's round
  // trips mustn't stretch a short press into a long one.)
  // (Its events stamped with when they were sent: on a loaded machine one delivered late would otherwise come after the
  // hold's time, its nudge then a finger leaving after a pickup.)
  let holdWhy = "";
  const holdAt = async (x, y, ms, second = false, [nx, ny] = [3, 2]) => {
    await p.evaluate(() => window.addEventListener("pointerdown", () => (window.__downAt = performance.now()), { capture: true, once: true }));
    const t0 = Date.now() / 1000;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp: t0, touchPoints: [{ x, y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", timestamp: t0 + 0.03, touchPoints: [{ x: x + nx, y: y + ny, id: 1 }] });
    if (second) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp: t0 + 0.05, touchPoints: [{ x: x + nx, y: y + ny, id: 1 }, { x: x + 80, y: y + 40, id: 2 }] });
    // (A hold is taken up a frame after its time, and on a loaded machine its timer and that frame run late: past its
    // time, what it became once it's no longer a press (or, if it stays one, 3 s on), unless checking that a short
    // press isn't one.)
    const kind = await p.evaluate(([ms, hold]) => new Promise((r) => setTimeout(() => {
      const kind = () => window.woodrail.interaction.mode.kind;
      if (!hold) return r(kind());
      const until = performance.now() + 3000;
      const wait = () => (kind() !== "press" || performance.now() > until ? r(kind()) : requestAnimationFrame(wait));
      requestAnimationFrame(() => requestAnimationFrame(wait));
    }, Math.max(0, window.__downAt + ms - performance.now()))), [ms, ms >= 380]);
    // What the hold was at the end (its state, the touches, the mode), for a failing check to say why.
    holdWhy = await p.evaluate(() => {
      const i = window.woodrail.interaction;
      const m = i.mode;
      const h = m.hold;
      return JSON.stringify({ mode: m.kind, press: m.press?.kind, branch: m.branch ?? null, hold: h ? { strayedAt: h.strayedAt, armed: !!h.armed, since: Math.round(performance.now() - h.t) } : null, touches: i.touches?.size, drawing: i.drawing, downAgo: Math.round(performance.now() - window.__downAt) });
    });
    return kind;
  };
  const lift = async () => {
    await touch("touchEnd", 0, 0);
    await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  };
  const c0 = await where();
  [sx, sy] = await onScreen();
  const held = await holdAt(sx, sy, 520);
  await lift();
  const c1 = await where();
  check("a long press on an unselected piece picks it up", held === "drag-piece", `after 520 ms: ${held} ${holdWhy}`);
  check("…and letting go without moving puts it back where it was (and selects it)", JSON.stringify(c1.piece) === JSON.stringify(c0.piece) && (await p.evaluate(() => !document.querySelector(".piece-card").hidden)), `${c0.piece} → ${c1.piece}`);
  await p.keyboard.press("Escape");
  // (Stamped with when it happened, as the slow-phone cases below: a busy machine delivers the lift late.)
  [sx, sy] = await onScreen();
  {
    const c = Date.now() / 1000;
    const before = await where();
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp: c, touchPoints: [{ x: sx, y: sy, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", timestamp: c + 0.2, touchPoints: [] });
    await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
    const short = await p.evaluate(() => window.woodrail.interaction.mode.kind);
    const after = await where();
    check("a short press (200 ms) doesn't pick it up (it's a tap: selected)", short === "idle" && JSON.stringify(after.piece) === JSON.stringify(before.piece) && (await p.evaluate(() => !document.querySelector(".piece-card").hidden)), `mode ${short}; piece ${before.piece} → ${after.piece}`);
  }
  await p.keyboard.press("Escape");
  [sx, sy] = await onScreen();
  const two = await holdAt(sx, sy, 520, true);
  check("a second finger during the hold cancels it (two fingers move the view)", two === "idle", `after 520 ms with two fingers: ${two}`);
  await lift();
  await p.keyboard.press("Escape");
  // Held, then dragged: it moves.
  // (Stamped with when they were sent, no earlier than the finger's own pace: late, the moves would read as faster.)
  // (The piece in the middle of the view first: the steps before may have left it by an edge, where a drag pans the
  // view at the edge rather than holding the piece over the finger, and the slow-phone holds after start in the band.)
  await p.evaluate((id) => {
    const w = window.woodrail;
    const q = w.layout.getPiece(id);
    const t = w.controls.target;
    w.director.glideTo(t.clone().set(q.pose.x + Math.cos(q.pose.heading) * 108, q.y, q.pose.z + Math.sin(q.pose.heading) * 108), w.camera.position.distanceTo(t), { duration: 0.2 });
  }, id);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  [sx, sy] = await onScreen();
  const hs = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp: hs, touchPoints: [{ x: sx, y: sy, id: 1 }] });
  await new Promise((r) => setTimeout(r, 520));
  let hMid = "";
  for (let k = 1; k <= 12; k++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", timestamp: Math.max(Date.now() / 1000, hs + 0.52 + k * 0.016), touchPoints: [{ x: sx - (40 * k) / 12, y: sy, id: 1 }] });
    if (k === 6) hMid = await p.evaluate(() => window.woodrail.interaction.mode.kind);
  }
  // Where it's held (QA I5): its middle just above the fingertip, by a set amount, however it was taken hold of.
  // (Read once it has caught up with the last move: on a loaded machine a frame can take most of a second, so wait
  // until it's stood still three frames running, 10 s at most.)
  const off = await p.evaluate(([fx, fy]) => new Promise((done) => {
    const read = () => {
      const w = window.woodrail;
      const m = w.interaction.mode;
      if (m.kind !== "drag-piece") return null;
      m.ghost.geometry.computeBoundingBox();
      const c = m.ghost.geometry.boundingBox.getCenter(new w.camera.position.constructor());
      m.ghost.updateMatrixWorld();
      m.ghost.localToWorld(c);
      // (Loose, a piece steps on an 18 mm grid: it can be up to half a step off where it's aimed, on screen this much.)
      const px = (v) => { const q = v.clone().project(w.camera); return [((q.x + 1) / 2) * innerWidth, ((1 - q.y) / 2) * innerHeight]; };
      const [cx, cy] = px(c);
      const step = Math.max(...[[18, 0], [0, 18]].map(([dx, dz]) => { const [x, y] = px(c.clone().add(new c.constructor(dx, 0, dz))); return Math.hypot(x - cx, y - cy); }));
      return [Math.round(cx - fx), Math.round(cy - fy), m.snap.kind, Math.round(step / 2)];
    };
    const until = performance.now() + 10000;
    let last = "", same = 0;
    const tick = () => {
      const o = read();
      same = JSON.stringify(o) === last ? same + 1 : 0;
      last = JSON.stringify(o);
      if (same >= 3 || performance.now() > until) done(o);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), [sx - 40, sy]);
  await lift();
  check("held, then dragged: it moves with the finger", hMid === "drag-piece", `mid-drag ${hMid}`);
  check("…its middle held just above the fingertip (QA I5)", !!off && (off[2] === "snapped" || (Math.abs(off[0]) <= 20 + off[3] && off[1] <= -40 + off[3] && off[1] >= -80 - off[3])), off ? `dx ${off[0]}, dy ${off[1]} (${off[2]}; grid ±${off[3]} px)` : "not held");
  await p.keyboard.press("Escape");
  // 2b'. A slow phone (QA): the hold is decided by when things happened (the events' own times), not by which arrives
  // first. The touches are stamped with the times they happened at, then delivered late.
  const stamped = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  // A pan whose moves (stamped 30–80 ms in) are only delivered after the hold's time is up: still a pan, put back.
  await p.keyboard.press("Escape");
  [sx, sy] = await onScreen();
  const before = await where();
  let s0 = Date.now() / 1000;
  await stamped("touchStart", sx, sy, s0);
  await new Promise((r) => setTimeout(r, 900));
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  for (let k = 1; k <= 6; k++) await stamped("touchMove", sx + 6 * k, sy, s0 + 0.03 + 0.01 * k);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const lateMoves = await p.evaluate(() => window.woodrail.interaction.mode.kind);
  await stamped("touchEnd", 0, 0, Date.now() / 1000);
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  const after = await where();
  check("slow phone: a pan's moves delivered after the hold's time is up stay a pan (put back)", lateMoves !== "drag-piece" && JSON.stringify(after.piece) === JSON.stringify(before.piece), `mode ${lateMoves}; piece ${before.piece} → ${after.piece}`);
  // A real hold whose timer is late: the drag's first moves, stamped 450 ms in, arrive first: picked up.
  await p.keyboard.press("Escape");
  [sx, sy] = await onScreen();
  s0 = Date.now() / 1000;
  await stamped("touchStart", sx, sy, s0);
  for (let k = 1; k <= 4; k++) await stamped("touchMove", sx - 8 * k, sy, s0 + 0.45 + 0.01 * k);
  const lateTimer = await p.evaluate(() => window.woodrail.interaction.mode.kind);
  await stamped("touchEnd", 0, 0, Date.now() / 1000);
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  check("slow phone: a real hold whose timer runs late still picks it up", lateTimer === "drag-piece", `mode ${lateTimer}`);
  await p.keyboard.press("Escape");
  // 2b''. Turn with a second finger while the first holds the piece (QA): it turns, still held (a browser sends no click
  // for a second finger). (Turn and Flip show while a shelf is open: shown here for the test.)
  await p.keyboard.press("Escape");
  await p.evaluate(() => (document.querySelector(".tray-orient").style.display = "flex"));
  [sx, sy] = await onScreen();
  const ts = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp: ts, touchPoints: [{ x: sx, y: sy, id: 1 }] });
  await new Promise((r) => setTimeout(r, 520));
  for (let k = 1; k <= 4; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", timestamp: Math.max(Date.now() / 1000, ts + 0.52 + k * 0.016), touchPoints: [{ x: sx - 6 * k, y: sy, id: 1 }] });
  const turn = await p.evaluate(() => { const b = [...document.querySelectorAll(".tray-orient .chip")].find((e) => /Turn/.test(e.textContent)); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  const h0 = await p.evaluate(() => window.woodrail.interaction.mode.heading);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx - 24, y: sy, id: 1 }, { x: turn[0], y: turn[1], id: 2 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ x: turn[0], y: turn[1], id: 2 }] });
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const [kind2, h1] = await p.evaluate(() => [window.woodrail.interaction.mode.kind, window.woodrail.interaction.mode.heading]);
  await lift();
  await p.evaluate(() => (document.querySelector(".tray-orient").style.display = ""));
  const turned = typeof h0 === "number" && typeof h1 === "number" && Math.abs(Math.abs(h1 - h0) - Math.PI / 4) < 0.01;
  check("a second finger on Turn turns the piece in hand, still held (QA)", kind2 === "drag-piece" && turned, `mode ${kind2}; heading ${h0?.toFixed?.(2)} → ${h1?.toFixed?.(2)}`);
  await p.keyboard.press("Escape");
  // 2c. Drawing on, a press on a line's body (Draw N1): edged across the line (past BRANCH_SLOP, 7 px) before the hold's
  // time, it's a branch setting off: no pickup, and nothing drawn till it goes on. Resting still, it picks the piece up.
  await p.evaluate(() => window.woodrail.interaction.setDrawing(true));
  [sx, sy] = await onScreen();
  // (8.5 px across the line as it lies on screen, rounded to whole pixels: past BRANCH_SLOP (7), short of HOLD_SLOP (10).)
  const across = await p.evaluate((id) => {
    const w = window.woodrail;
    const piece = w.layout.getPiece(id);
    const r = w.canvas.getBoundingClientRect();
    const px = (d) => { const c = new w.camera.position.constructor(piece.pose.x + Math.cos(piece.pose.heading) * d, piece.y, piece.pose.z + Math.sin(piece.pose.heading) * d).project(w.camera); return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height]; };
    const [a, b] = [px(58), px(158)];
    const n = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [Math.round((-(b[1] - a[1]) / n) * 8.5), Math.round(((b[0] - a[0]) / n) * 8.5)];
  }, id);
  const pieces0 = await p.evaluate(() => window.woodrail.layout.pieceCount);
  const drawHold = await holdAt(sx, sy, 520, false, across);
  await lift();
  const pieces1 = await p.evaluate(() => window.woodrail.layout.pieceCount);
  check("drawing on: a press on a line's body edged across it doesn't pick it up or draw (Draw N1)", drawHold !== "drag-piece" && pieces1 === pieces0, `nudged ${across}; after 520 ms: ${drawHold}; pieces ${pieces0} → ${pieces1}`);
  await p.keyboard.press("Escape");
  [sx, sy] = await onScreen();
  const c2 = await where();
  const stillHold = await holdAt(sx, sy, 520, false, [0, 0]);
  await lift();
  const c3 = await where();
  check("…resting still there, it picks the piece up (put back where it was)", stillHold === "drag-piece" && JSON.stringify(c3.piece) === JSON.stringify(c2.piece), `after 520 ms: ${stillHold}; ${c2.piece} → ${c3.piece} ${holdWhy}`);
  await p.evaluate(() => window.woodrail.interaction.setDrawing(false));
  await p.keyboard.press("Escape");
  // 2d. A placed industry (one the player may move: the playthrough's workshop) is picked up with a hold too.
  const shop = await p.evaluate(async () => {
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const { syncIndustries } = await import("/src/game/world.ts");
    for (const [fx, fy] of [[0.5, 0.3], [0.3, 0.25], [0.7, 0.25], [0.5, 0.2]]) {
      const g = w.interaction.groundAt(innerWidth * fx, innerHeight * fy);
      const r = w.editor().place("depot-workshop", poseForCentre("depot-workshop", false, g.x, g.z, 0), 0, false);
      const id = typeof r === "number" ? r : r?.id ?? -1;
      if (id < 0) continue;
      syncIndustries(w);
      w.invalidate();
      // (A point a finger there takes the workshop: across its yard, as pick finds it, not just where its piece starts.)
      const depot = w.economy.depotAtPiece(id)?.id;
      const piece = w.layout.getPiece(id);
      const V = w.camera.position.constructor;
      const c = Math.cos(piece.pose.heading), s = Math.sin(piece.pose.heading);
      for (const [t, l] of [[108, 72], [108, 40], [60, 72], [160, 72], [108, 0], [0, 0]]) {
        const v = new V(piece.pose.x + c * t - s * l, piece.y + 10, piece.pose.z + s * t + c * l).project(w.camera);
        const x = ((v.x + 1) / 2) * innerWidth, y = ((1 - v.y) / 2) * innerHeight;
        const hit = w.interaction.pick(x, y, true);
        if ((hit?.kind === "depot" && hit.depotId === depot) || (hit?.kind === "piece" && hit.pieceId === id)) return { id, x, y };
      }
      const v = new V(piece.pose.x, piece.y + 10, piece.pose.z).project(w.camera);
      return { id, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    }
    return null;
  });
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  if (shop) {
    const shopHold = await holdAt(shop.x, shop.y, 520);
    await lift();
    check("a long press on a placed workshop picks it up", shopHold === "drag-piece", `after 520 ms: ${shopHold} ${holdWhy}`);
  } else check("a workshop goes down for the hold check", false, "nowhere to put it");
  await p.keyboard.press("Escape");
  // 3. A train, not selected: the drag pans, the train stays.
  const placed = await p.evaluate(async (id) => {
    const w = window.woodrail;
    const { nearestCursor } = await import("/src/sim/nearest.ts");
    const piece = w.layout.getPiece(id);
    const near = nearestCursor(w.layout, piece.pose.x + Math.cos(piece.pose.heading) * 108, piece.pose.z + Math.sin(piece.pose.heading) * 108, 60, piece.pose.heading);
    const r = near && w.sim.addTrainAround(["engine"], near.cursor);
    w.invalidate();
    return r?.kind === "placed";
  }, id);
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  const trains = () => p.evaluate(() => JSON.stringify(window.woodrail.sim.trainIds().map((t) => window.woodrail.sim.getTrain(t).cars.map((c) => c.id))));
  const t0 = await trains();
  [sx, sy] = await onScreen();
  const vMid = await drag(sx, sy, 120);
  check("a drag that starts on an unselected engine pans (the camera has it) and leaves the train", placed && vMid === "idle" && (await trains()) === t0, `placed ${placed}, mid-drag ${vMid}`);
  // Held and let go without moving, a running train stays the same train at the same speed (QA): it's only selected.
  await p.keyboard.press("Escape");
  const run0 = await p.evaluate(() => {
    const w = window.woodrail;
    const id = w.sim.trainIds().at(-1);
    const engine = w.sim.getTrain(id).cars.find((c) => c.kind === "engine");
    engine.lever = 1;
    return id;
  });
  // (Running: under way, by the sim's own clock, not after a set time (a loaded machine steps it slower).)
  await p.waitForFunction((id) => (window.woodrail.sim.getTrain(id)?.speed ?? 0) > 20, run0, { timeout: 60000 }).catch(() => {});
  const speedBefore = await p.evaluate((id) => window.woodrail.sim.getTrain(id)?.speed ?? -1, run0);
  [sx, sy] = await p.evaluate((id) => {
    const w = window.woodrail;
    const car = w.sim.getTrain(id).cars[0];
    const v = new w.camera.position.constructor();
    w.trainView.carObject(car.id).getWorldPosition(v);
    v.y += 10;
    v.project(w.camera);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  }, run0);
  const trainHold = await holdAt(sx, sy, 520);
  await lift();
  const after2 = await p.evaluate((id) => { const t = window.woodrail.sim.getTrain(id); return t ? t.cars.find((c) => c.kind === "engine").lever : null; }, run0);
  check("held and let go, a running train stays the same train, still running", after2 === 1, `train ${run0}: lever after ${after2} (it was 1; speed then ${Math.round(speedBefore)}; hold mode ${trainHold})`);
  await p.evaluate((id) => { const t = window.woodrail.sim.getTrain(id); if (t) for (const c of t.cars) c.lever = 0; }, run0);
}

/**
 * A control drawn afresh while the finger is down (the workshop's + and −, redrawn as it crafts): the tap's click on
 * the new one counts. A different control drawn there instead: it doesn't.
 */
async function redrawnControl(ctx, p) {
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  for (const [what, same] of [["the same control", true], ["a different control", false]]) {
    await p.evaluate(() => {
      window.__hits = 0;
      const b = document.createElement("button");
      b.className = "chip test-redraw";
      b.dataset.recipe = "rail";
      b.textContent = "+";
      Object.assign(b.style, { position: "fixed", left: "150px", top: "200px", width: "90px", height: "60px", zIndex: 99 });
      b.addEventListener("click", () => window.__hits++);
      document.body.appendChild(b);
    });
    await frames(p);
    await touch("touchStart", 195, 230);
    // Drawn afresh under the finger.
    await p.evaluate((same) => {
      const old = document.querySelector(".test-redraw");
      const b = old.cloneNode(true);
      if (!same) b.dataset.recipe = "wheel";
      b.addEventListener("click", () => window.__hits++);
      old.replaceWith(b);
    }, same);
    const before = await p.evaluate(() => window.__allClicks);
    await touch("touchEnd", 0, 0);
    await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 60000 });
    await frames(p);
    const clicks = await p.evaluate(() => window.__hits);
    check(`a tap on a control redrawn under the finger as ${what}: ${same ? "counts" : "is dropped"}`, clicks === (same ? 1 : 0), `${clicks} clicks`);
    await p.evaluate(() => document.querySelector(".test-redraw")?.remove());
  }
}

/**
 * A flick out of the tray (QA): one move between the finger coming down on a piece and lifting, the browser running a
 * fast swipe's moves into it. The piece is put down where the finger lifted, or refused with a word why, never dropped
 * back in the box without a word.
 */
async function flickOut(ctx, p, tapOn) {
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await p.keyboard.press("Escape");
  const index = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-group")].findIndex((b) => b.querySelector(".label")?.textContent === "Straight"));
  await tapOn(`.scroller .tray-group:nth-child(${index + 1 + (await p.evaluate(() => document.querySelectorAll(".scroller > :not(.tray-group)").length))})`);
  const item = await p.evaluate(() => { const e = document.querySelector(".scroller .tray-item:not(.tray-back):not(.tray-group)"); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.evaluate(() => {
    const h = window.woodrail.hud;
    window.__said = [];
    const toast = h.toast.bind(h);
    h.toast = (m, ...a) => (window.__said.push(m), toast(m, ...a));
    const refuse = h.setRefusal.bind(h);
    h.setRefusal = (m, ...a) => (m && window.__said.push(m), refuse(m, ...a));
  });
  const before = await p.evaluate(() => window.woodrail.layout.pieceCount);
  await touch("touchStart", item[0], item[1]);
  await touch("touchMove", 195, 380);
  await touch("touchEnd", 0, 0);
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await frames(p);
  const after = await p.evaluate(() => ({ pieces: window.woodrail.layout.pieceCount, mode: window.woodrail.interaction.mode.kind, said: window.__said }));
  check("a flick out of the tray (one move, then lift) puts the piece down, or says why not", after.mode === "idle" && (after.pieces === before + 1 || after.said.length > 0), `pieces ${before} → ${after.pieces}; said ${JSON.stringify(after.said)}`);
}

/**
 * A switch's lever (Clearer switches): a tap flips it, the lever swinging over and its chevrons sliding across, and once
 * that's settled nothing more is drawn; a long press pins it (a red peg; the first time ever, a toast says what that
 * means), or unpins it; a tap still flips a pinned switch. A long press on the switch piece itself still picks it up.
 */
async function leverPins(ctx, p) {
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y, timestamp) => cdp.send("Input.dispatchTouchEvent", { type, ...(timestamp ? { timestamp } : {}), touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const settled = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await p.keyboard.press("Escape");
  // A switch on open ground (clear of the track and trains the steps before put down, and of models, wherever they left
  // the view), framed close.
  const id = await p.evaluate(async () => {
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const { frameDistance } = await import("/src/game/camera-director.ts");
    const t = w.controls.target;
    // (Flat, within the view's bounds, clear of pieces and models: window.__clearAt.)
    const clear = (x, z) => window.__clearAt(x, z);
    let r = -1;
    let g = null;
    for (let d = 0; d <= 9000 && r === -1; d += 216) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 216));
      for (let a = 0; a < n && r === -1; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        if (!(await clear(x, z))) continue;
        const placed = w.editor().place("switch", poseForCentre("switch", false, x, z, 0), 0, false);
        const pid = typeof placed === "number" ? placed : (placed?.id ?? -1);
        if (pid >= 0) {
          r = pid;
          g = t.clone().set(x, 0, z);
        }
      }
    }
    if (g) w.director.glideTo(g, frameDistance(200, w.camera.fov, w.camera.aspect), { duration: 0.3 });
    // (Its own list: an earlier check's spy may still be wrapped round the toast, and says each toast too.)
    window.__pinSaid = [];
    // (What the pin hints did, for a failure's message.)
    window.__pinDiag = [];
    const it = w.interaction;
    const tp = it.togglePin.bind(it);
    it.togglePin = (...a) => (window.__pinDiag.push(`pin ${a[0]} @${Math.round(performance.now())}`), tp(...a));
    const hp = it.hintPinHow.bind(it);
    it.hintPinHow = () => (window.__pinDiag.push(`hint ${JSON.stringify(it.pinHint)} @${Math.round(performance.now())}`), hp());
    const tl = it.throwLever.bind(it);
    it.throwLever = (...a) => (window.__pinDiag.push(`throw ${a[0]} @${Math.round(performance.now())}`), tl(...a));
    const h = w.hud;
    const toast = h.toast.bind(h);
    h.toast = (m, ...a) => (window.__pinSaid.push(m), toast(m, ...a));
    // (A toast taken back, a pin undone when a late lift showed it was a tap, wasn't said: off the list too.)
    const withdraw = h.withdrawToast.bind(h);
    h.withdrawToast = (m) => {
      const i = window.__pinSaid.lastIndexOf(m);
      if (i >= 0) window.__pinSaid.splice(i, 1);
      window.__pinDiag.push(`withdrawn ${m.slice(0, 12)} @${Math.round(performance.now())}`);
      return withdraw(m);
    };
    window.__pinAt = g ? [g.x, g.z] : null;
    return r;
  });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await settled();
  // (Framed on it, by where the view is and the lever's on screen, not by the glide having ended: under load a gesture
  // left from the checks before can cut the glide short or move the view after, and every tap missed the lever.)
  for (let tries = 0; id >= 0 && tries < 5; tries++) {
    const framed = await p.evaluate((id) => {
      const w = window.woodrail;
      const [x, z] = window.__pinAt;
      const lever = w.trackView.group.children.find((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id);
      if (!lever) return false;
      lever.updateMatrixWorld(true);
      const v = new w.camera.position.constructor(0, 14, 0).applyMatrix4(lever.matrixWorld).project(w.camera);
      return Math.hypot(w.controls.target.x - x, w.controls.target.z - z) < 60 && Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8 && w.interaction.mode.kind === "idle";
    }, id);
    if (framed) break;
    await p.keyboard.press("Escape");
    await p.evaluate(async () => {
      const w = window.woodrail;
      const { frameDistance } = await import("/src/game/camera-director.ts");
      const [x, z] = window.__pinAt;
      w.director.glideTo(w.controls.target.clone().set(x, 0, z), frameDistance(200, w.camera.fov, w.camera.aspect), { duration: 0.3 });
    });
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
    await settled();
  }
  if (id < 0) {
    check("a switch goes down for the lever checks", false);
    return;
  }
  /** Where on screen: the lever's stick, or a point on the piece away from it. */
  const screenOf = (what) =>
    p.evaluate(([id, what]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      let at;
      if (what === "lever") {
        const lever = w.trackView.group.children.find((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id);
        lever.updateMatrixWorld(true);
        at = new V(0, 14, 0).applyMatrix4(lever.matrixWorld);
      } else {
        const piece = w.layout.getPiece(id);
        at = new V(piece.pose.x + Math.cos(piece.pose.heading) * 110, piece.y + 12, piece.pose.z + Math.sin(piece.pose.heading) * 110);
      }
      const v = at.project(w.camera);
      return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
    }, [id, what]);
  const state = () => p.evaluate((id) => ({ way: window.woodrail.layout.switchState(id), pinned: window.woodrail.layout.isPinned(id), peg: window.woodrail.trackView.pinShown(id) }), id);
  /** A press on (x, y) resting `ms` (by the page's clock), then let go. */
  const press = async (x, y, ms) => {
    const t = Date.now() / 1000;
    await touch("touchStart", x, y, t);
    await new Promise((r) => setTimeout(r, ms));
    // (The pin's frame comes a frame after its time.)
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await touch("touchEnd", 0, 0, Date.now() / 1000);
    await settled();
  };
  /**
   * A quick tap at (x, y), its touches stamped 50 ms apart (QA: an unstamped start and end, delivered late on a loaded
   * machine, can land more than the pin's 450 ms apart and pin instead of throwing).
   */
  const quickTap = async (x, y) => {
    const t = Date.now() / 1000;
    await touch("touchStart", x, y, t);
    await touch("touchEnd", 0, 0, t + 0.05);
    await frames(p);
  };
  // (Where the lever is: found afresh before each press, since it leans the other way once flipped.)
  let [lx, ly] = await screenOf("lever");
  // (The pin hints as on a device that's never pinned, nor been told how, from here: how to pin is said at the first
  // lever tap. Set once the gestures before are done: under load an earlier one could still pin, or a train throw a
  // switch in view, and either uses the hint up: QA, 58/59 once in three runs.)
  await p.waitForFunction(() => window.woodrail.interaction.mode.kind === "idle", null, { timeout: 60000 });
  await p.evaluate(() => {
    Object.assign(window.woodrail.interaction.pinHint, { seen: false, howSeen: false });
    window.__pinSaid.length = 0;
    window.__pinDiag.push(`hints reset @${Math.round(performance.now())}`);
  });
  // 1. A tap flips it: drawn while it swings, then nothing once it's settled. (Boats held still, as in e2e:draw.)
  const s0 = await state();
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await quickTap(lx, ly);
  const swung = await p.evaluate(() => window.woodrail.trackView.swinging || window.woodrail.flourishes.count > 0);
  await settled();
  const s1 = await state();
  const [during, idle] = await p.evaluate(async (f0) => {
    const w = window.woodrail;
    const during = w.framesDrawn - f0;
    const sail = w.boats.update;
    w.boats.update = () => false;
    await new Promise((r) => setTimeout(r, 1500));
    const f1 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    const idle = w.framesDrawn - f1;
    w.boats.update = sail;
    return [during, idle];
  }, f0);
  check("a tap on a lever flips the switch", s1.way !== s0.way && !s1.pinned, `way ${s0.way} → ${s1.way}${swung ? " (swinging)" : ""}`);
  check("…drawn while it swings, then no frames once it's settled", during > 0 && idle === 0, `${during} frames for the flip, then ${idle} in 2 s`);
  [lx, ly] = await screenOf("lever");
  // 2. A long press pins it (its peg shows; the first time, a toast says what pinning means), and doesn't flip it.
  await press(lx, ly, 650);
  const s2 = await state();
  const said = await p.evaluate(() => window.__pinSaid.slice());
  check("a long press on a lever pins the switch (and leaves it set as it was)", s2.pinned && s2.peg && s2.way === s1.way, JSON.stringify(s2));
  check("…and the first time, a toast says what a pin does", said.filter((m) => /^Pinned: trains on a route/.test(m)).length === 1, JSON.stringify(said));
  [lx, ly] = await screenOf("lever");
  // 3. A tap still flips a pinned switch by hand.
  await quickTap(lx, ly);
  await settled();
  const s3 = await state();
  check("a tap still flips a pinned switch (it stays pinned)", s3.way !== s2.way && s3.pinned && s3.peg, JSON.stringify(s3));
  [lx, ly] = await screenOf("lever");
  // 4. Held again: unpinned. And pinned once more: the toast isn't said again.
  await press(lx, ly, 650);
  const s4 = await state();
  await press(lx, ly, 650);
  const s5 = await state();
  const said2 = await p.evaluate(() => window.__pinSaid.filter((m) => /^Pinned: trains on a route/.test(m)).length);
  check("held again, it's unpinned (its peg goes); and pinned once more", !s4.pinned && !s4.peg && s5.pinned && s4.way === s3.way && s5.way === s3.way, `${JSON.stringify(s4)} then ${JSON.stringify(s5)}`);
  check("…the pin's toast is only said the first time", said2 === 1, `${said2} times`);
  {
    const words = await p.evaluate(() => window.__pinSaid.slice());
    check("an unpin says so (QA N3)", words.includes("Unpinned"), JSON.stringify(words));
    const diag = await p.evaluate(() => window.__pinDiag);
    check("…and how to pin was said once, at the first tap on a lever, before the first pin (QA N3)", words.filter((m) => /^Hold a switch's lever to pin it/.test(m)).length === 1 && words.findIndex((m) => /^Hold a switch's lever/.test(m)) < words.findIndex((m) => /^Pinned: trains/.test(m)), JSON.stringify(words) + " DIAG " + JSON.stringify(diag));
  }
  [lx, ly] = await screenOf("lever");
  // 5. A slow phone: a short press (200 ms by its own times) delivered late is a tap, a flip, not a pin.
  {
    const t = Date.now() / 1000;
    await touch("touchStart", lx, ly, t);
    await new Promise((r) => setTimeout(r, 700));
    await touch("touchEnd", 0, 0, t + 0.2);
    await settled();
    const s6 = await state();
    check("slow phone: a short press delivered late flips the switch, doesn't unpin it", s6.way !== s5.way && s6.pinned, JSON.stringify(s6));
  }
  // 5b. A fingertip's slack (QA N2): a tap on the floor 14 px out from the lever (away from the track) throws it.
  {
    const s7 = await state();
    // A spot on the bare floor 12–16 px from the lever and its semaphore (neither nearer), that a fingertip's slack
    // gives the lever: found by looking round the lever on screen.
    const [tx, ty, near] = await p.evaluate((id) => {
      const it = window.woodrail.interaction;
      // (On screen, each post is by its index in leverPosts(): a wye has three, #15.)
      const all = window.woodrail.trackView.leverPosts();
      const posts = it.leversOnScreen(all).filter((q) => all[q.id].pieceId === id);
      const seg = (q, x, y) => {
        const dx = q.bx - q.ax, dy = q.by - q.ay, L = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((x - q.ax) * dx + (y - q.ay) * dy) / L));
        return Math.hypot(q.ax + t * dx - x, q.ay + t * dy - y);
      };
      const l = posts[0];
      for (let a = 0; a < 64; a++)
        for (const r of [17, 16, 18, 15, 19]) {
          const x = (l.ax + l.bx) / 2 + Math.cos((a / 64) * 2 * Math.PI) * r;
          const y = (l.ay + l.by) / 2 + Math.sin((a / 64) * 2 * Math.PI) * r;
          const d = Math.min(...posts.map((q) => seg(q, x, y)));
          if (d >= 12 && d <= 16 && it.pickExact(x, y) === null && it.pick(x, y, true)?.kind === "lever") return [x, y, Math.round(d)];
        }
      return [-1, -1, -1];
    }, id);
    const exact = tx < 0 ? "no spot" : await p.evaluate(([x, y]) => window.woodrail.interaction.pickExact(x, y)?.kind ?? null, [tx, ty]);
    await quickTap(tx, ty);
    await settled();
    const s8 = await state();
    check("a tap on the floor a fingertip from a lever throws it (QA N2)", exact === null && s8.way !== s7.way, `${near} px off, exactly under: ${exact}; way ${s7.way} → ${s8.way}`);
    // A finger resting there 700 ms (a slow-starting pan) doesn't pin it: the slack is for taps.
    await press(tx, ty, 700);
    const s9 = await state();
    check("a finger resting on the floor a fingertip from a lever doesn't pin it", s9.pinned === s8.pinned && s9.way === s8.way, `${JSON.stringify(s8)} → ${JSON.stringify(s9)}`);
    // A double tap there zooms, as on bare floor; the lever is thrown by its first tap at most (QA: it was thrown twice
    // and the zoom swallowed).
    const view = () => p.evaluate(() => { const w = window.woodrail; const t = w.controls.target; return [Math.round(w.camera.position.distanceTo(t)), Math.round(t.x), Math.round(t.z)]; });
    const d0 = await view();
    const t = Date.now() / 1000;
    await touch("touchStart", tx, ty, t);
    await touch("touchEnd", 0, 0, t + 0.05);
    await touch("touchStart", tx, ty, t + 0.15);
    await touch("touchEnd", 0, 0, t + 0.2);
    await p.waitForFunction(() => window.woodrail.director.busy, null, { timeout: 5000 }).catch(() => {});
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
    await settled();
    const d1 = await view();
    const s10 = await state();
    const throws = s10.way !== s9.way ? 1 : 0;
    check("a double tap on the floor by a lever focuses the view there (its second tap isn't the lever's)", JSON.stringify(d1) !== JSON.stringify(d0) && throws === 1, `view (distance, target) ${d0} → ${d1}; lever thrown ${throws} time(s) (way ${s9.way} → ${s10.way})`);
  }
  // 5c. A lever behind a hill (QA, sc3): a tap right on it, its ray meeting it through the hill (the hills aren't
  // raycast), neither picks nor throws it. The hill is the ground raised on every square but the switch's own, for the
  // pick's look along the line only (nothing is redrawn); put back after.
  {
    // (Looked at from a slant, high enough over the land first: from where the steps before leave the view, a real hill
    // may already hide it; looked straight down at, the made hill below couldn't come between, its ray through the
    // lever's own square.)
    await p.evaluate((id) => {
      const w = window.woodrail;
      const lever = w.trackView.leverPosts().find((q) => q.pieceId === id);
      const t = w.controls.target;
      w.director.glideTo(t.clone().set(lever.x, 0, lever.z), w.camera.position.distanceTo(t), { phi: 0.8, duration: 0.3 });
    }, id);
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
    await settled();
    [lx, ly] = await screenOf("lever");
    const s0 = await state();
    const seen = await p.evaluate(([x, y]) => window.woodrail.interaction.pickExact(x, y)?.kind ?? null, [lx, ly]);
    const hidden = await p.evaluate(async ([id, x, y]) => {
      const w = window.woodrail;
      const grid = w.landscape.grid;
      const { MAX_HEIGHT } = await import("/src/landscape/grid.ts");
      const { RISER_HEIGHT } = await import("/src/track/index.ts");
      const piece = w.layout.getPiece(id);
      const own = grid.cellAtWorld(piece.pose.x, piece.pose.z);
      const lever = w.trackView.leverPosts().find((q) => q.pieceId === id);
      const leverCell = grid.cellAtWorld(lever.x, lever.z);
      grid.groundY = (i) => (i === own || i === leverCell ? grid.height[i] * RISER_HEIGHT : MAX_HEIGHT * RISER_HEIGHT);
      return { exact: w.interaction.pickExact(x, y)?.kind ?? null, touch: w.interaction.pick(x, y, true)?.kind ?? null };
    }, [id, lx, ly]);
    await quickTap(lx, ly);
    await settled();
    const s1 = await state();
    await p.evaluate(() => delete window.woodrail.landscape.grid.groundY);
    await p.keyboard.press("Escape");
    check("a tap right on a lever hidden behind a hill doesn't throw it (QA sc3)", seen === "lever" && hidden.exact !== "lever" && hidden.touch !== "lever" && s1.way === s0.way, `seen: ${seen}; hidden: exact ${hidden.exact}, touch ${hidden.touch}; way ${s0.way} → ${s1.way}`);
  }
  // 6. A long press on the switch piece itself (not its lever) still picks the piece up.
  await p.evaluate((id) => window.woodrail.layout.setPinned(id, false), id);
  const [bx, by] = await screenOf("piece");
  await p.evaluate(() => window.addEventListener("pointerdown", () => (window.__downAt = performance.now()), { capture: true, once: true }));
  await touch("touchStart", bx, by);
  const held = await p.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => r(window.woodrail.interaction.mode.kind))), Math.max(0, window.__downAt + 520 - performance.now()))));
  await touch("touchEnd", 0, 0);
  await settled();
  check("a long press on the switch piece itself still picks it up", held === "drag-piece", `after 520 ms: ${held}`);
  await p.keyboard.press("Escape");
}

/**
 * A 36 mm piece between an engine's two axles (56 mm apart): neither wheel on it, but it's under the car. A long press
 * on it must not pick it up (QA: it counted as free, and came up from under the train).
 */
async function shortUnderCar(ctx, p) {
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y, timestamp) => cdp.send("Input.dispatchTouchEvent", { type, ...(timestamp ? { timestamp } : {}), touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const settled = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await p.keyboard.press("Escape");
  const ids = await p.evaluate(async () => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    // (A run of its own on open ground, found outward from the view's target, whatever earlier checks left there or
    // wherever they left the view: a glide cut short by a touch stops nearer where it set off.)
    const t = w.controls.target;
    const o = await window.__openGround(window.__runFootprint(480));
    const g = o && t.clone().set(o.x, 0, o.z);
    if (!g) throw new Error("no open ground for the run");
    const x0 = g.x;
    const run = w.editor().placeRun([
      { type: "straight-216", pose: { x: x0, z: g.z, heading: 0 }, y: 0, flipped: false },
      { type: "straight-36", pose: { x: x0 + 216, z: g.z, heading: 0 }, y: 0, flipped: false },
      { type: "straight-216", pose: { x: x0 + 252, z: g.z, heading: 0 }, y: 0, flipped: false },
    ]);
    const placed = w.sim.addTrain(["engine"], { pieceId: run[2], pathIndex: 0, s: 15, reversed: false });
    const at = g.clone();
    at.x = x0 + 234;
    w.director.glideTo(at, frameDistance(160, w.camera.fov, w.camera.aspect), { duration: 0.3 });
    window.__underSaid = [];
    const h = w.hud;
    const toast = h.toast.bind(h);
    h.toast = (m, ...a) => (window.__underSaid.push(m), toast(m, ...a));
    return { run, placed: placed.kind, occupied: w.sim.pieceOccupied(run[1]), wheels: placed.kind === "placed" ? w.sim.getTrain(placed.trainId).bogies.map((b) => b.pieceId) : [] };
  });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await settled();
  check("a 36 between an engine's axles counts as under the train", ids.placed === "placed" && ids.occupied && !ids.wheels.includes(ids.run[1]), JSON.stringify(ids));
  // (On the piece beside the car's body: the track's edge, clear of the car, so the press is the piece's.)
  const [x, y] = await p.evaluate((id) => {
    const w = window.woodrail;
    const V = w.camera.position.constructor;
    const piece = w.layout.getPiece(id);
    const v = new V(piece.pose.x + 18, piece.y + 4, piece.pose.z + 18).project(w.camera);
    return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  }, ids.run[1]);
  const what = await p.evaluate(([x, y]) => window.woodrail.interaction.pressAt?.(x, y)?.kind ?? null, [x, y]);
  await p.evaluate(() => window.addEventListener("pointerdown", () => (window.__downAt = performance.now()), { capture: true, once: true }));
  await touch("touchStart", x, y, Date.now() / 1000);
  const held = await p.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
    const m = window.woodrail.interaction.mode;
    r(m.kind === "drag-piece" ? `drag-piece ${JSON.stringify([...(m.ids ?? m.pieces ?? []), m.pieceId, m.press?.pieceId].filter((x) => x !== undefined))}` : m.kind);
  })), Math.max(0, window.__downAt + 700 - performance.now()))));
  await touch("touchEnd", 0, 0);
  await settled();
  const after = await p.evaluate((id) => ({ there: !!window.woodrail.layout.getPiece(id), said: window.__underSaid }), ids.run[1]);
  check("a long press on it doesn't pick it up, and says a train is on it", !held.startsWith("drag-piece") && after.there && after.said.includes("A train is on that track"), `mode ${held}; pressed ${what}; ${JSON.stringify(after)}`);
  await p.keyboard.press("Escape");

  // The piece under the engine's wheels, selected (its card up): the card's Rotate and Delete are refused, and said so
  // (QA N1: Delete took it up, derailing the engine; Rotate turned it under it).
  const under = ids.run[2];
  const pose = () => p.evaluate((id) => { const q = window.woodrail.layout.getPiece(id); return q ? JSON.stringify([q.pose, q.flipped]) : null; }, under);
  const was = await pose();
  await p.evaluate((id) => {
    window.__underSaid.length = 0;
    window.woodrail.interaction.selectPiece(id);
  }, under);
  await frames(p);
  const pressCard = (label) =>
    p.evaluate((label) => {
      const b = [...document.querySelectorAll(".piece-card button")].find((b) => b.textContent.trim() === label && b.offsetParent !== null);
      if (!b) return false;
      b.click();
      return true;
    }, label);
  const rotated = await pressCard("Rotate");
  await settled();
  const afterRotate = await pose();
  const deleted = await pressCard("Delete");
  await settled();
  const end = await p.evaluate(({ id, run }) => {
    const w = window.woodrail;
    const t = [...w.sim.trainIds()].map((i) => w.sim.getTrain(i)).find((t) => t.bogies.some((b) => run.includes(b.pieceId)));
    return { there: !!w.layout.getPiece(id), derailed: t?.derailed ?? null, said: [...window.__underSaid], card: !document.querySelector(".piece-card")?.hidden };
  }, { id: under, run: ids.run });
  check(
    "the card's Rotate and Delete on the piece under an engine are refused: “A train is on that track”, the engine still on the rails",
    rotated && deleted && afterRotate === was && (await pose()) === was && end.there && end.derailed === false && end.said.filter((m) => m === "A train is on that track").length === 2,
    `pressed rotate ${rotated}, delete ${deleted}; ${was} → ${afterRotate} → ${await pose()}; ${JSON.stringify(end)}`,
  );
  // Select more from it: picking starts, without it (said so), as a group with it couldn't move or be taken up.
  await p.evaluate(() => (window.__underSaid.length = 0));
  const more = await pressCard("Select more");
  await frames(p);
  const picking = await p.evaluate(() => ({ picking: window.woodrail.interaction.picking, picked: [...window.woodrail.interaction.picked], said: [...window.__underSaid] }));
  check("Select more from the piece under an engine leaves it out, and says why", more && picking.picking && picking.picked.length === 0 && picking.said.includes("A train is on that track"), JSON.stringify({ more, ...picking }));
  await p.keyboard.press("Escape");
}

/**
 * The wye's three levers (#15), by the player's path: a wye dragged out of the Switch shelf by touch onto open ground,
 * a leg of track off each corner; each corner's lever tapped by touch (each throws its own corner only), and a train run
 * by hand through the wye takes each of its three ways: A → C from the trunk, C → B across, B → C across the other way,
 * then (corner 1's lever tapped back) B → A to the trunk. The points never move under it. Then all is still: 0 frames.
 */
async function wyeLevers(ctx, p, tapOn) {
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y, timestamp) => cdp.send("Input.dispatchTouchEvent", { type, ...(timestamp ? { timestamp } : {}), touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const settled = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await p.keyboard.press("Escape");
  // Open ground for the wye and its legs as they'll lie (the tray puts a piece down at the view's heading and its own
  // turns): the pieces laid on a copy round (0, 0), and room asked for every point along them. Framed on it.
  const spot = await p.evaluate(async () => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const T = await import("/src/track/index.ts");
    const it = w.interaction;
    // The footprint for a wye laid facing `heading`.
    const footprint = (heading) => {
      const scratch = new T.Layout();
      const sw = scratch.addPiece("wye", poseForCentre("wye", false, 0, 0, heading), 0, false);
      for (const c of [0, 1, 2]) {
        let ref = T.connectorRef(sw, c);
        for (const type of ["straight-216", "straight-216", "buffer-turnback"]) {
          const end = scratch.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
          const flipped = T.getPieceDef(type, false).connectors.every((k) => k.kind === end.kind);
          const via = T.getPieceDef(type, flipped).connectors.findIndex((k) => k.kind !== end.kind);
          const id = T.appendPiece(scratch, type, flipped, ref, via);
          ref = T.connectorRef(id, 1 - via);
        }
      }
      const points = [];
      const smp = T.createSample();
      for (const id of scratch.pieceIds()) {
        const q = scratch.getPiece(id);
        for (const path of T.getPieceDef(q.type, q.flipped).paths) {
          const len = T.pathLength(path.geom);
          for (let d = 0; d <= len; d += 100) {
            T.samplePath(path.geom, d, smp);
            const c = Math.cos(q.pose.heading), sn = Math.sin(q.pose.heading);
            points.push([q.pose.x + smp.x * c - smp.z * sn, q.pose.z + smp.x * sn + smp.z * c]);
          }
        }
      }
      return points;
    };
    // The view as it is first; else turned an eighth at a time, as a player turns the view to find room (the tray lays
    // a piece facing away from the camera, so the land the steps before leave may fit the wye only turned).
    // (On the mat: the wye comes from the tray, and the game won't put it down past the map's edge.)
    const off = new w.camera.position.constructor().subVectors(w.camera.position, w.controls.target);
    const theta0 = Math.atan2(off.x, off.z);
    let o = null;
    let theta = null;
    for (let k = 0; k < 8 && !o; k++) {
      const th = theta0 + (k * Math.PI) / 4;
      // (Facing away from the camera, to the nearest eighth, as `cameraHeading` rounds it.)
      const along = Math.round(Math.atan2(-Math.cos(th), -Math.sin(th)) / (Math.PI / 4)) * (Math.PI / 4);
      o = await window.__openGround(footprint(along + (it.trayTurns * Math.PI) / 4), { pieceGap: 400, onMat: true });
      if (o) (theta = k === 0 ? null : th), (o.heading = along);
    }
    if (!o) {
      const points = footprint(it.cameraHeading() + (it.trayTurns * Math.PI) / 4);
      window.__wyeWhy = { pieces: w.layout.pieceCount, noPieceGap: !!(await window.__openGround(points, { pieceGap: 0, onMat: true })), noGaps: !!(await window.__openGround(points, { pieceGap: 0, propGap: 0, margin: 0, onMat: true })), bounds: w.director.bounds };
      return null;
    }
    w.director.glideTo(w.controls.target.clone().set(o.x, 0, o.z), frameDistance(560, w.camera.fov, w.camera.aspect), { duration: 0.3, ...(theta === null ? {} : { theta }) });
    o.turned = theta !== null;
    return o;
  });
  if (!spot) throw new Error(`wye: no open ground for the wye and its legs ${JSON.stringify(await p.evaluate(() => window.__wyeWhy))}`);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await settled();
  // (Turned to the heading the room was found for.)
  const facing = await p.evaluate(() => window.woodrail.interaction.cameraHeading());
  if (Math.abs(Math.sin((facing - spot.heading) / 2)) > 0.01) throw new Error(`wye: the view faces ${facing}, not ${spot.heading} as the room was found for`);
  // 1. Laid from the tray: the Switch shelf opened, the Wye dragged out onto the spot (stamped touches), let go there.
  const shelf = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-group")].findIndex((b) => b.querySelector(".label")?.textContent === "Switch"));
  await tapOn(`.scroller .tray-group:nth-child(${shelf + 1 + (await p.evaluate(() => document.querySelectorAll(".scroller > :not(.tray-group)").length))})`);
  await p.evaluate(() => document.querySelector('.scroller .tray-item[data-key="piece:wye"]')?.scrollIntoView({ inline: "center" }));
  await frames(p);
  const from = await p.evaluate(() => { const e = document.querySelector('.scroller .tray-item[data-key="piece:wye"]'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  if (!from) throw new Error("wye: no Wye in the Switch shelf");
  const to = await p.evaluate(({ x, z }) => {
    const w = window.woodrail;
    const v = new w.camera.position.constructor(x, 0, z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    // (On touch a held piece rides TOUCH_LIFT_PX, 56 px, above the finger: the finger lifts that far below the spot,
    // so the wye goes down on it, as a player puts it where they see it.)
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height + 56];
  }, spot);
  const before = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
  // (What was said, and what the finger held before it lifted: for a failure's message.)
  await p.evaluate(() => {
    const h = window.woodrail.hud;
    window.__wyeSaid = [];
    if (!h.__wyeSpy) {
      h.__wyeSpy = true;
      const toast = h.toast.bind(h);
      h.toast = (m, ...a) => (window.__wyeSaid?.push(m), toast(m, ...a));
      const refuse = h.setRefusal.bind(h);
      h.setRefusal = (m, ...a) => (m && window.__wyeSaid?.push(m), refuse(m, ...a));
    }
  });
  let t = Date.now() / 1000;
  await touch("touchStart", from[0], from[1], t);
  for (let k = 1; k <= 12; k++) await touch("touchMove", from[0] + ((to[0] - from[0]) * k) / 12, from[1] + ((to[1] - from[1]) * k) / 12, (t += 0.03));
  const held = await p.evaluate(() => { const m = window.woodrail.interaction.mode; return m.kind === "drag-piece" ? { kind: m.kind, visible: m.ghost.visible, blocked: m.blocked ?? null, hint: m.hint ?? null } : { kind: m.kind }; });
  await touch("touchEnd", 0, 0, (t += 0.05));
  await settled();
  await p.keyboard.press("Escape");
  const wye = await p.evaluate((before) => {
    const w = window.woodrail;
    const id = [...w.layout.pieceIds()].find((i) => !before.includes(i) && w.layout.getPiece(i).type === "wye");
    return id ?? -1;
  }, before);
  check("wye: dragged out of the Switch shelf by touch, a wye is laid", wye >= 0, JSON.stringify({ from, to, spot, held, said: await p.evaluate(() => window.__wyeSaid), mode: await p.evaluate(() => window.woodrail.interaction.mode.kind) }));
  if (wye < 0) return;
  // Harness shortcut (setup, not what's tested): a leg of two straights and a turn-back buffer off each corner, laid
  // through the editor as dropping them would (each seated on the end before, worked out on a copy of the wye).
  const legs = await p.evaluate(async (wye) => {
    const w = window.woodrail;
    const T = await import("/src/track/index.ts");
    const q = w.layout.getPiece(wye);
    const scratch = new T.Layout();
    const sw = scratch.addPiece("wye", q.pose, q.y, false);
    const lay = (ref, type) => {
      const end = scratch.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      for (const flipped of [false, true]) {
        const via = T.getPieceDef(type, flipped).connectors.findIndex((c) => c.kind !== end.kind);
        if (via !== -1) return { id: T.appendPiece(scratch, type, flipped, ref, via), via, flipped };
      }
      throw new Error(`no way to lay ${type}`);
    };
    const out = [];
    for (const c of [0, 1, 2]) {
      const run = [];
      let ref = T.connectorRef(sw, c);
      for (const type of ["straight-216", "straight-216", "buffer-turnback"]) {
        const l = lay(ref, type);
        const s = scratch.getPiece(l.id);
        run.push({ type, pose: s.pose, y: s.y, flipped: l.flipped });
        if (type !== "buffer-turnback") ref = T.connectorRef(l.id, 1 - l.via);
      }
      out.push(w.editor().placeRun(run));
    }
    w.invalidate();
    return out.map((ids) => ids.slice(0, 2));
  }, wye);
  const joined = await p.evaluate(([wye, legs]) => [0, 1, 2].every((c) => window.woodrail.layout.joinedConnector(wye * 8 + c) !== -1) && legs.every((l) => l.length === 2), [wye, legs]);
  check("wye: a leg laid off each of its corners", joined, JSON.stringify(legs));
  if (!joined) return;
  // A train on leg A (the trunk's), stopped (harness shortcut: put down in code, as the tray would).
  const engine = await p.evaluate(([legs]) => {
    const w = window.woodrail;
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: legs[0][1], pathIndex: 0, s: 108, reversed: false });
    if (r.kind !== "placed") return -1;
    const e = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(e, 0);
    w.invalidate();
    return e;
  }, [legs]);
  if (engine < 0) throw new Error("wye: no room for a train");
  // 2. Each corner's lever tapped by touch (stamped 50 ms apart: a tap, never a pin's hold): 1, then 0, then 2. Each
  // throws only its own corner.
  const leverAt = (corner) =>
    p.evaluate(([wye, corner]) => {
      const w = window.woodrail;
      const lever = w.trackView.group.children.find((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === wye && (c.userData.corner ?? 0) === corner);
      if (!lever) return null;
      lever.updateMatrixWorld(true);
      const v = new w.camera.position.constructor(0, 14, 0).applyMatrix4(lever.matrixWorld).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      const at = [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      const pick = w.interaction.pick(at[0], at[1], true);
      return { at, pick: pick ? { kind: pick.kind, pieceId: pick.pieceId, corner: pick.corner ?? 0 } : null };
    }, [wye, corner]);
  const state = () => p.evaluate((wye) => window.woodrail.layout.switchState(wye), wye);
  const tapLever = async (corner) => {
    // (Framed on the wye, the view still: a gesture left from before can move it.)
    await p.evaluate(({ x, z }) => {
      const w = window.woodrail;
      if (Math.hypot(w.controls.target.x - x, w.controls.target.z - z) > 60) w.director.glideTo(w.controls.target.clone().set(x, 0, z), w.camera.position.distanceTo(w.controls.target), { duration: 0.2 });
    }, spot);
    await p.waitForFunction(() => !window.woodrail.director.busy && window.woodrail.interaction.mode.kind === "idle", null, { timeout: 60000 });
    await settled();
    const l = await leverAt(corner);
    const was = await state();
    if (!l) return { was, now: was, l };
    const t = Date.now() / 1000;
    await touch("touchStart", l.at[0], l.at[1], t);
    await touch("touchEnd", 0, 0, t + 0.05);
    await settled();
    return { was, now: await state(), l };
  };
  const taps = [];
  for (const corner of [1, 0, 2]) {
    const r = await tapLever(corner);
    taps.push({ corner, ...r });
    check(`wye: a tap on corner ${corner}'s lever throws that corner only`, (r.was ^ r.now) === 1 << corner, JSON.stringify(r));
  }
  // 3. The train run by hand (harness shortcut: its lever set in code, and the game's own sim and economy ticks run
  // ahead of SwiftShader's few frames, as `Game.frame` runs them): the wye's road its front takes each time onto it,
  // until it's wholly on leg `until`; and any move of the points with a car on them.
  const run = (until, go) =>
    p.evaluate(([wye, legs, engine, until, go]) => {
      const w = window.woodrail;
      if (go) w.sim.setLever(engine, 1);
      const roads = [];
      let on = false;
      let last = w.layout.switchState(wye);
      let under = 0;
      for (let i = 0; i < 120 * 120; i++) {
        w.sim.tick();
        w.economy.tick();
        const t = w.sim.findCar(engine).train;
        const front = t.bogies[0].pieceId === wye ? t.bogies[0] : t.bogies[t.bogies.length - 1].pieceId === wye ? t.bogies[t.bogies.length - 1] : null;
        if (front && !on) roads.push(front.pathIndex);
        on = !!front;
        const s = w.layout.switchState(wye);
        if (s !== last && w.sim.pointsHeld(wye)) under++;
        last = s;
        if (t.bogies.every((b) => legs[until].includes(b.pieceId))) break;
      }
      w.invalidate();
      return { roads, under, ticks: w.sim.ticks, on: [...w.sim.piecesUnder(w.sim.findCar(engine).train.id)] };
    }, [wye, legs, engine, until, go]);
  // (Paths: 0 trunk–corner 1, 1 trunk–corner 2, 2 across. Legs: 0 the trunk's (A), 1 corner 1's (B), 2 corner 2's (C).)
  const toC = await run(2, true);
  check("wye: from the trunk, corner 0's lever sends the train right, to leg C", toC.roads.includes(1) && !toC.roads.includes(0) && toC.under === 0, JSON.stringify(toC));
  const toB = await run(1, false);
  check("wye: from leg C, corner 2's lever sends it across, to leg B", toB.roads.includes(2) && toB.under === 0, JSON.stringify(toB));
  const backToC = await run(2, false);
  check("wye: from leg B, corner 1's lever sends it across, back to leg C", backToC.roads.includes(2) && !backToC.roads.includes(0) && backToC.under === 0, JSON.stringify(backToC));
  // Corner 1's lever tapped back to the trunk while the train is on leg C, then by B and on to the trunk.
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), engine);
  const back = await tapLever(1);
  check("wye: corner 1's lever tapped back throws corner 1 only", (back.was ^ back.now) === 0b010, JSON.stringify(back));
  const viaB = await run(1, true);
  const toA = await run(0, false);
  check("wye: from leg B, corner 1's lever set back sends it to the trunk, leg A: every way through the wye run", toA.roads.includes(0) && viaB.under === 0 && toA.under === 0, JSON.stringify({ viaB, toA }));
  // 4. Stopped, nothing is drawn once all is still (with no other train running).
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), engine);
  await p.evaluate(() => { for (let i = 0; i < 600; i++) window.woodrail.sim.tick(); window.woodrail.invalidate(); });
  await settled();
  await p.waitForTimeout(1000);
  await settled();
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(3000);
  const idle = await p.evaluate(() => ({ f: window.woodrail.framesDrawn, moving: [...window.woodrail.sim.trainIds()].filter((i) => window.woodrail.sim.getTrain(i).speed > 0).length }));
  check("wye: no frames drawn once settled (with no train moving)", idle.moving > 0 || idle.f === f0, JSON.stringify({ f0, ...idle }));
}

// (E2E_ONLY: Sandbox's checks by name, one or a comma list, in the full run's order: map-taps, select-drag, redrawn,
// flick, lever-pins, under-car, toast-through, trap (the third-train trap), dead-end (Continue), routes (two trains'
// routes), defaults (a lever's default kept through a reload), restore (a route setting points and putting them back),
// wait (a train waiting at points set for another), wye (a wye's three levers, #15), stuck (two trains of a line head
// on, the loop laid from the tray), stuck-lines (the same, two lines' trains), forward (a route round a wye's loop
// rather than into a dead-end spur, routing step 6).)
const ONLY = process.env.E2E_ONLY ?? "";
let openContext = null;

/**
 * Open ground, in the page (window.__clearAt, window.__openGround). The Sandbox seed's land (its mat) is about
 * 4.2 × 3.2 m, most of it hills, a town and its own track: its open ground has no room for the longer runs (the trap's
 * line, restore's and wait's, 2 to 2.6 m). So a spot's points may each be on the land where the game's own rule
 * (`checkPlacement`) would take a straight there, either way round (no hill, road, river, town, field or site), or
 * past the land's edge on the flat table (harness shortcut, setup only: a player can't lay track there, but it's flat
 * and nothing hides it), and inside the view's bounds (where the view can go). Each point clear of every piece and
 * model. Searched over all of it, outward from the view's target (where the steps before left it): null if there's
 * none anywhere.
 */
function openGroundScript() {
  let checkPlacement = null;
  const ready = () => (checkPlacement ? Promise.resolve() : import("/src/landscape/clearance.ts").then((m) => void (checkPlacement = m.checkPlacement)));
  // (`onMat`: only where a player may build, for pieces laid from the tray. Without it, past the land's edge on the
  // flat table too: a named harness shortcut, for runs the harness lays itself.)
  const groundOk = (x, z, onMat) => {
    const w = window.woodrail;
    if (w.landscape.grid.cellAtWorld(x, z) === -1) return !onMat;
    return [0, Math.PI / 2].every((h) => {
      const c = checkPlacement(w.landscape, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0);
      return c.kind === "clear" || (!onMat && c.reason === "off-mat");
    });
  };
  // (On the land, on the mat: a straight there is clear either way round, not just past the mat's edge.)
  const onLand = (x, z) => {
    const w = window.woodrail;
    if (w.landscape.grid.cellAtWorld(x, z) === -1) return false;
    return [0, Math.PI / 2].some((h) => checkPlacement(w.landscape, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
  };
  window.__clearAt = async (x, z, opts) => (await ready(), clearAt(x, z, opts));
  const clearAt = (x, z, { pieceGap = 700, propGap = 400, margin = 250, onMat = false } = {}) => {
    const w = window.woodrail;
    const b = w.director.bounds;
    if (!(x > b.x0 + margin && x < b.x1 - margin && z > b.z0 + margin && z < b.z1 - margin)) return false;
    for (const i of w.layout.pieceIds()) { const q = w.layout.getPiece(i).pose; if (Math.hypot(q.x - x, q.z - z) <= pieceGap) return false; }
    for (const q of w.props.all()) if (Math.hypot(q.x - x, q.z - z) <= propGap) return false;
    return groundOk(x, z, onMat);
  };
  // `points`: the footprint, as [dx, dz] from the spot (no more than 216 mm apart along a run, so a hill between two
  // can't be missed). The first spot, outward from the view's target, where all are clear.
  window.__openGround = async (points, opts = {}) => {
    await ready();
    const w = window.woodrail;
    const t = w.controls.target;
    const b = w.director.bounds;
    const reach = Math.max(...[[b.x0, b.z0], [b.x0, b.z1], [b.x1, b.z0], [b.x1, b.z1]].map(([x, z]) => Math.hypot(x - t.x, z - t.z)));
    for (let d = 0; d <= Math.min(reach, 40000); d += 54) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 54));
      for (let a = 0; a < n; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        // (`onLand`: points that must be on the land itself, not the table past its edge: where the player lays track.)
        if (points.every(([dx, dz]) => clearAt(x + dx, z + dz, opts)) && (opts.onLand ?? []).every(([dx, dz]) => onLand(x + dx, z + dz)) && (!opts.ok || opts.ok(x, z))) return { x, z };
      }
    }
    return null;
  };
  // A run's footprint: points every 108 mm from (0, 0) to (length, 0), on each of the rows `dz`.
  window.__runFootprint = (length, rows = [0]) => rows.flatMap((dz) => Array.from({ length: Math.floor(length / 108) + 1 }, (_, k) => [k * 108, dz]));
}

for (const mode of ONLY ? ["sandbox"] : ["sandbox", "game"]) {
  try {
    await runMode(mode);
  } catch (e) {
    check(`${mode}: ran to the end`, false, String(e?.message ?? e).split("\n")[0]);
  } finally {
    // (A mode that threw leaves its page running, a sim and a renderer the next mode's load would share the CPU with.)
    await openContext?.close().catch(() => {});
    openContext = null;
  }
}

/**
 * Taps on things on the map, as a player makes them: where an engine or a place is on screen, the view panned to it
 * first (the steps before may have left it off screen), and a tap on a card's button once it's there and still.
 */
function mapHelpers(p) {
  // Where a thing is in the world: an engine (between its bogies), a place (its piece's middle).
  const worldAt = (what) => p.evaluate((what) => {
    const w = window.woodrail;
    if (what.engine !== undefined) {
      const t = w.sim.findCar(what.engine).train;
      const [a, b] = [t.world[0], t.world[1]];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    }
    // (A piece's pose is at its start: its middle is half its 216 mm on.)
    const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
    const q = piece.pose;
    return { x: q.x + Math.cos(q.heading) * 108, y: piece.y, z: q.z + Math.sin(q.heading) * 108 };
  }, what);
  const onScreen = async (what) => {
    const v = await worldAt(what);
    return p.evaluate((v) => {
      const w = window.woodrail;
      const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
      return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
    }, v);
  };
  const still = async () => {
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
    await frames(p);
  };
  // A thing tapped as a player does: the view panned to it first (the steps before, and planning's own framing, may
  // have left it off screen), then a tap where it's seen.
  const showing = async (what) => {
    const v = await worldAt(what);
    await p.evaluate((v) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), 1500, { duration: 0.2 }), v);
    await still();
  };
  const tapOn = async (what) => {
    await showing(what);
    const [x, y] = await onScreen(what);
    await tapped(p, () => p.touchscreen.tap(x, y));
  };
  const tapButton = async (sel) => {
    await p.waitForFunction((sel) => { const b = document.querySelector(sel); return !!b && b.offsetParent !== null; }, sel, { timeout: 30000 });
    await frames(p);
    await p.waitForTimeout(250);
    const [x, y] = await p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
    await tapped(p, () => p.touchscreen.tap(x, y));
  };
  return { worldAt, onScreen, still, showing, tapOn, tapButton };
}

/**
 * Two routes (#4), by the player's path: two trains, each given its own route with real taps (its engine, "Plan a
 * route", its two places on the map, Done). Then a finger rests on the first train and lets go where it stands (a hold
 * picks a train up: the slow tap a phone often makes, or a drag on the train whose card is open). Both keep their own
 * lines, show them on their cards, deliver on them, and keep them after a reload.
 */
async function twoRoutes(ctx, p) {
  await p.keyboard.press("Escape");
  const cdp = await ctx.newCDPSession(p);
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    // (Open, flat ground for two runs side by side, anywhere the view can go: window.__openGround.)
    const t = w.controls.target;
    const o = await window.__openGround(window.__runFootprint(1080, [0, 500]));
    const g = o;
    if (!g) throw new Error("no open ground for the runs");
    // Harness shortcut (setup, not what's tested): two runs laid through the editor, as dropping the pieces would, a
    // forest at one end and a sawmill at the other, and a train on each put down in code, as the tray would.
    const types = ["depot-sawmill", "straight-216", "straight-216", "straight-216", "depot-forest"];
    const runs = [0, 500].map((dz) => w.editor().placeRun(types.map((type, i) => ({ type, pose: { x: g.x + i * 216, z: g.z + dz, heading: 0 }, y: 0, flipped: false }))));
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const places = runs.map((run) => [depot(run[4], "forest").id, depot(run[0], "sawmill").id]);
    const engines = runs.map((run) => {
      const r = w.sim.addTrain(["engine", "timber"], { pieceId: run[2], pathIndex: 0, s: 150, reversed: false });
      if (r.kind !== "placed") throw new Error("no room for a train");
      const e = w.sim.getTrain(r.trainId).cars[0].id;
      w.sim.setLever(e, 1);
      return e;
    });
    // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of SwiftShader's
    // few frames a second; the forests kept stocked (their logs aren't what's tested). Counts goods unloaded at each
    // run's sawmill (only that run's train can reach it).
    const { PILE_CAP } = await import("/src/economy/constants.ts");
    const { CARGO } = await import("/src/economy/cargo.ts");
    window.__run2 = (secs, mills) => {
      const goods = mills.map(() => 0);
      for (let i = 0; i < secs * 120; i++) {
        if (i % 120 === 0) for (const d of w.economy.allDepots()) if (d.role === "forest") d.piles[CARGO.log.index] = PILE_CAP;
        w.sim.tick();
        w.economy.tick();
        for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded") mills.forEach((m, k) => { if (ev.depotId === m) goods[k]++; });
      }
      w.invalidate();
      return goods;
    };
    return { engines, places };
  });
  const { onScreen, showing, tapOn, tapButton } = mapHelpers(p);
  const lineText = () => p.evaluate(() => document.querySelector(".engine-extra .route-line-text")?.textContent ?? null);
  // Each train's route, as a player plans it: its engine tapped, Plan a route, its forest then its sawmill, Done.
  const planned = [];
  for (const [k, e] of setup.engines.entries()) {
    await tapOn({ engine: e });
    const open = await p.evaluate(() => window.woodrail.interaction.openEngineCarId);
    await tapButton(".engine-extra .route-plan");
    for (const d of setup.places[k]) await tapOn({ depot: d });
    await tapButton(".engine-extra .route-plan.on");
    planned.push({ open, line: await lineText(), stops: await p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, e) });
    await p.keyboard.press("Escape");
  }
  const ownStops = (k) => JSON.stringify(planned[k].stops) === JSON.stringify(setup.places[k]);
  check("routes: each train's route planned by taps on its card and the map", planned.every((x, k) => x.open === setup.engines[k] && ownStops(k)) && planned[0].line !== planned[1].line, JSON.stringify(planned));
  // A finger rests on the first train (a pickup's hold), moves it a little along its track, and lets go there: the
  // train moved, as a player does to make room or tidy up (or, on a slow tap, by accident).
  await showing({ engine: setup.engines[0] });
  const [hx, hy] = await onScreen({ engine: setup.engines[0] });
  // (Along its track: toward its sawmill, at the run's far end from where it's heading.)
  const [ax, ay] = await onScreen({ depot: setup.places[0][1] });
  const toward = Math.hypot(ax - hx, ay - hy) || 1;
  const ts = Date.now() / 1000;
  // (What the finger came down on, for a failure's message.)
  const pressed = { under: await p.evaluate(([x, y]) => window.woodrail.interaction.pick(x, y, true)?.kind ?? null, [hx, hy]) };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp: ts, touchPoints: [{ x: hx, y: hy, id: 1 }] });
  // (Past the hold's time by the page's clock, and its frame: then the moves lift it.)
  await p.waitForFunction(() => window.woodrail.interaction.mode.hold?.armed === true, null, { timeout: 10000 }).catch(() => {});
  Object.assign(pressed, await p.evaluate(() => { const m = window.woodrail.interaction.mode; return { mode: m.kind, press: m.press?.kind ?? null, armed: m.hold?.armed ?? null }; }));
  // (40 px, in 12 moves; each stamped after the last, the finger's lift too.)
  let last = ts;
  for (let k = 1; k <= 12; k++) {
    const f = ((k / 12) * 40) / toward;
    last = Math.max(Date.now() / 1000, ts + 0.52 + k * 0.016, last + 0.016);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", timestamp: last, touchPoints: [{ x: hx + (ax - hx) * f, y: hy + (ay - hy) * f, id: 1 }] });
  }
  // (Read once the moves have caught up: on a loaded machine a frame can take most of a second.)
  await p.waitForFunction(() => window.woodrail.interaction.mode.kind === "drag-train", null, { timeout: 10000 }).catch(() => {});
  const lifted = await p.evaluate(() => window.woodrail.interaction.mode.kind);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", timestamp: Math.max(Date.now() / 1000, last + 0.016), touchPoints: [] });
  await frames(p);
  await p.waitForFunction(() => window.woodrail.interaction.mode.kind === "idle", null, { timeout: 10000 }).catch(() => {});
  const moved = await p.evaluate((e) => !!window.woodrail.sim.findCar(e), setup.engines[0]);
  const lines = () => p.evaluate((E) => E.map((e) => { const w = window.woodrail; const id = w.economy.lineIdOf.get(e); return { line: id === undefined ? null : w.economy.lines.get(id)?.name ?? null, stops: w.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null }; }), setup.engines);
  const afterHold = await lines();
  check("routes: a train picked up and moved keeps its route, and the other keeps its own (#4)", lifted === "drag-train" && moved && afterHold.every((x, k) => JSON.stringify(x.stops) === JSON.stringify(setup.places[k])) && afterHold[0].line === planned[0].line && afterHold[1].line === planned[1].line, JSON.stringify({ lifted, moved, afterHold, pressed }));
  // Each card shows its own line.
  const cards = [];
  for (const e of setup.engines) {
    await tapOn({ engine: e });
    await frames(p);
    cards.push(await lineText());
    await p.keyboard.press("Escape");
  }
  check("routes: each train's card shows its own line", cards[0] === planned[0].line && cards[1] === planned[1].line, JSON.stringify(cards));
  // The payoff: each train runs its own route, logs from its forest to its sawmill.
  const goods = await p.evaluate((mills) => window.__run2(90, mills), setup.places.map((pl) => pl[1]));
  check("routes: both trains deliver on their own routes (goods at each one's sawmill in 90 s)", goods.every((n) => n >= 2), JSON.stringify(goods));
  // A reload: both lines back, each on its own train (found by where it stands: car ids change on load).
  const where = await p.evaluate((E) => E.map((e) => { const t = window.woodrail.sim.findCar(e).train; return { x: t.world[0].x, z: t.world[0].z }; }), setup.engines);
  await p.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await p.waitForTimeout(1500);
  await p.reload();
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
  await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 60000 });
  const reloaded = await p.evaluate((where) => {
    const w = window.woodrail;
    return where.map((at) => {
      let best = null;
      for (const id of w.sim.trainIds()) {
        const t = w.sim.getTrain(id);
        const d = Math.hypot(t.world[0].x - at.x, t.world[0].z - at.z);
        if (d < 400 && (!best || d < best.d)) best = { d, e: t.cars.find((c) => c.kind === "engine")?.id };
      }
      const id = best ? w.economy.lineIdOf.get(best.e) : undefined;
      const line = id === undefined ? null : w.economy.lines.get(id);
      return { line: line?.name ?? null, places: line ? line.stops.map((s) => w.economy.depot(s.depotId)?.pieceId) : null };
    });
  }, where);
  check("routes: after a reload each train still runs its own line", reloaded[0].line === planned[0].line && reloaded[1].line === planned[1].line && JSON.stringify(reloaded[0].places) !== JSON.stringify(reloaded[1].places) && reloaded.every((r) => r.places?.length === 2), JSON.stringify(reloaded));
  await p.keyboard.press("Escape");
}

/**
 * A lever tap sets the points' default (routing spec §3.4: the way routes put them back to), and it's kept through a
 * save and reload. By the player's path: points laid, a tap on their lever, then they're thrown by something that isn't
 * the player (as a route will from routing step 4), the game saved as it is on leaving the page, and reloaded. The
 * default must be the tap's, not how the points lie at the save.
 */
async function leverDefault(ctx, p) {
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y, timestamp) => cdp.send("Input.dispatchTouchEvent", { type, ...(timestamp ? { timestamp } : {}), touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const settled = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await p.keyboard.press("Escape");
  // Points on open, flat ground (clear of what the checks before put down), framed close: found outward from the view's
  // target. (Flat for 500 mm round: a hill's square beside them would bury their lever in its block, unseen and not
  // to be tapped, as a player would see. The full run once found such a spot, from where the steps before left the view.)
  const id = await p.evaluate(async () => {
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const t = w.controls.target;
    const bounds = w.director.bounds;
    const grid = w.landscape.grid;
    const ground = (x, z) => { const i = grid.cellAtWorld(x, z); return i === -1 ? 0 : grid.groundY(i); };
    const flat = (x, z) => { for (let dx = -500; dx <= 500; dx += 100) for (let dz = -500; dz <= 500; dz += 100) if (ground(x + dx, z + dz) !== 0) return false; return true; };
    const clear = (x, z) =>
      x > bounds.x0 + 500 && x < bounds.x1 - 500 && z > bounds.z0 + 500 && z < bounds.z1 - 500 && flat(x, z) &&
      [...w.layout.pieceIds()].every((i) => { const q = w.layout.getPiece(i).pose; return Math.hypot(q.x - x, q.z - z) > 700; }) &&
      [...w.props.all()].every((q) => Math.hypot(q.x - x, q.z - z) > 400);
    for (let d = 0; d <= 8000; d += 216) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 216));
      for (let a = 0; a < n; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        if (!clear(x, z)) continue;
        const placed = w.editor().place("switch", poseForCentre("switch", false, x, z, 0), 0, false);
        const pid = typeof placed === "number" ? placed : (placed?.id ?? -1);
        if (pid >= 0) {
          window.__defaultAt = [x, z];
          return pid;
        }
      }
    }
    return -1;
  });
  if (id < 0) {
    check("defaults: points go down for the lever-default check", false);
    return;
  }
  /**
   * Framed on the points, the view still, the lever on screen, nothing in hand, and the lever what a tap there picks (as
   * a player taps what they see): where its lever is on screen (null: not yet). Seen but not to be picked (a hill
   * between, from this side), the view turns a quarter round, as a player would turn it.
   */
  const frame = (turn) =>
    p.evaluate(async ([id, turn]) => {
      const w = window.woodrail;
      const { frameDistance } = await import("/src/game/camera-director.ts");
      const [x, z] = window.__defaultAt;
      const lever = w.trackView.group.children.find((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id);
      if (lever) {
        lever.updateMatrixWorld(true);
        const v = new w.camera.position.constructor(0, 14, 0).applyMatrix4(lever.matrixWorld).project(w.camera);
        // (On the canvas as the game reads a tap: from its own box.)
        const r = w.canvas.getBoundingClientRect();
        const at = [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
        const framed = Math.hypot(w.controls.target.x - x, w.controls.target.z - z) < 60 && Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8 && !w.director.busy && w.interaction.mode.kind === "idle";
        const picked = framed ? w.interaction.pick(at[0], at[1], true) : null;
        if (picked?.kind === "lever" && picked.pieceId === id) return at;
        window.__defaultWhy = { lever: true, framed, picked: picked?.kind ?? null, hidden: w.trackView.leverPosts().filter((q) => q.pieceId === id).every((q) => w.interaction.hiddenFromEye({ x: q.x, y: q.y + q.height / 2, z: q.z })) };
      } else window.__defaultWhy = { lever: false };
      const theta = turn ? new w.camera.position.constructor().subVectors(w.camera.position, w.controls.target) : null;
      w.director.glideTo(w.controls.target.clone().set(x, 0, z), frameDistance(200, w.camera.fov, w.camera.aspect), { duration: 0.3, ...(theta ? { theta: Math.atan2(theta.x, theta.z) + Math.PI / 2 } : {}) });
      Object.assign(window.__defaultWhy, { off: Math.round(Math.hypot(w.controls.target.x - x, w.controls.target.z - z)), mode: w.interaction.mode.kind });
      return null;
    }, [id, turn]);
  let at = null;
  // (Escape first: pressed after, it would cut the glide short.)
  for (let tries = 0; tries < 6 && !at; tries++) {
    await p.keyboard.press("Escape");
    // (Turned only once framed on the points: a hill between, from this side.)
    at = await frame(tries > 0 && (await p.evaluate(() => window.__defaultWhy.framed === true)));
    if (at) break;
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
    await settled();
  }
  const state = () => p.evaluate((id) => ({ way: window.woodrail.layout.switchState(id), def: window.woodrail.economy.router.defaultOf(id), pinned: window.woodrail.layout.isPinned(id) }), id);
  const s0 = await state();
  check("defaults: points as laid default to the way they're laid", s0.def === s0.way, JSON.stringify(s0));
  if (!at) {
    check("defaults: the lever is framed on screen for a tap", false, JSON.stringify(await p.evaluate(() => window.__defaultWhy)));
    return;
  }
  // A tap on the lever (its touches stamped 50 ms apart: a tap, never a pin's hold). What's under the finger, and what
  // was said, for a failure's message.
  const under = await p.evaluate(([[x, y], id]) => {
    const w = window.woodrail;
    return { pick: w.interaction.pick(x, y, true)?.kind ?? null, mode: w.interaction.mode.kind, hidden: w.trackView.leverPosts().filter((q) => q.pieceId === id).every((q) => w.interaction.hiddenFromEye({ x: q.x, y: q.y + q.height / 2, z: q.z })) };
  }, [at, id]);
  await p.evaluate(() => {
    window.__defaultSaid = [];
    const h = window.woodrail.hud;
    const toast = h.toast.bind(h);
    h.toast = (m, ...a) => (window.__defaultSaid.push(m), toast(m, ...a));
  });
  const tap = async () => {
    const t = Date.now() / 1000;
    await touch("touchStart", at[0], at[1], t);
    await touch("touchEnd", 0, 0, t + 0.05);
    await settled();
  };
  await tap();
  let s1 = await state();
  // (Once, late in the full run under load, a tap here didn't throw: then a second real tap, the first one's result in
  // the message. A pin a late lift left (a hold, as a slow phone reads one) is taken off first: setup, not what's tested.)
  let missed = null;
  if (s1.way === s0.way) {
    missed = { ...s1, said: await p.evaluate(() => window.__defaultSaid.slice()) };
    await p.evaluate((id) => window.woodrail.layout.setPinned(id, false), id);
    await tap();
    s1 = await state();
  }
  const said = await p.evaluate(() => window.__defaultSaid);
  const tapped = s1.way !== s0.way;
  check("defaults: a tap on the lever throws the points, and that's their default", tapped && s1.def === s1.way, `${JSON.stringify(s0)} → ${JSON.stringify(s1)}; under the finger ${JSON.stringify(under)} at ${at.map(Math.round)}; said ${JSON.stringify(said)}${missed ? `; first tap missed: ${JSON.stringify(missed)}` : ""}`);
  if (!tapped) return;
  // Harness shortcut (not what's tested): the points thrown as a route will throw them (routing step 4), not by the player.
  await p.evaluate((id) => { window.woodrail.sim.toggleSwitch(id); window.woodrail.invalidate(); }, id);
  const s2 = await state();
  check("defaults: points thrown by something else keep the player's default", s2.way !== s1.way && s2.def === s1.way, JSON.stringify(s2));
  // Saved as on leaving the page, then reloaded (piece ids are kept by a save; car ids aren't, and none is used).
  await p.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await p.waitForTimeout(1500);
  await p.reload();
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
  await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 60000 });
  const s3 = await p.evaluate((id) => ({ there: !!window.woodrail.layout.getPiece(id), way: window.woodrail.layout.switchState(id), def: window.woodrail.economy.router.defaultOf(id) }), id);
  // (Since routing step 4, points off their default that no train holds go back to it at routing's first look after a
  // load: lying as saved, or already back to the tap's way.)
  check("defaults: after a reload the points lie as saved (or are back to their default), and their default is still the lever tap's", s3.there && (s3.way === s2.way || s3.way === s1.way) && s3.def === s1.way, JSON.stringify(s3));
  await p.keyboard.press("Escape");
}

/**
 * Routes set points and put them back (#5, routing step 4), by the player's path: a run from a forest through points
 * to a sawmill, the points' lever thrown by hand for their curve (an open end: the hand-set way), then a train given
 * the route Forest, Sawmill with real taps. On its way to the sawmill its route throws the points to their straight
 * road just before it, it runs over them, and once its last car is off them the lever swings back to the curve the
 * player set, with its soft click. Its logs reach the sawmill.
 */
async function routeRestore(ctx, p) {
  await p.keyboard.press("Escape");
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    // (Open, flat ground for the run, anywhere the view can go: window.__openGround.)
    const t = w.controls.target;
    const o = await window.__openGround(window.__runFootprint(1656, [0, 400]));
    const g = o;
    if (!g) throw new Error("no open ground for the run");
    // Harness shortcut (setup, not what's tested): the run laid through the editor, as dropping the pieces would:
    // forest, three straights, points (their straight road on to the sawmill, their curve left open), two straights,
    // sawmill; a train put down in code on the first straights, as the tray would.
    const types = [["depot-forest", 216], ["straight-216", 216], ["straight-216", 216], ["straight-216", 216], ["switch", 144], ["straight-216", 216], ["straight-216", 216], ["depot-sawmill", 216]];
    let x = g.x;
    const run = w.editor().placeRun(types.map(([type, len]) => ({ type, pose: { x: (x += len) - len, z: g.z, heading: 0 }, y: 0, flipped: false })));
    const points = run[4];
    window.__restoreRun = run[0];
    if (w.layout.joinedConnector(points * 8 + 1) === -1 || w.layout.joinedConnector(points * 8) === -1) throw new Error("the points didn't join");
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const places = [depot(run[0], "forest").id, depot(run[7], "sawmill").id];
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: run[2], pathIndex: 0, s: 150, reversed: true });
    if (r.kind !== "placed") throw new Error("no room for a train");
    const engine = w.sim.getTrain(r.trainId).cars[0].id;
    // (Lever off while the route's planned: it starts once it has one.)
    w.sim.setLever(engine, 0);
    w.invalidate();
    return { engine, places, points, run };
  });
  // Harness shortcut (setup): the points' lever thrown for the curve as a tap does (the game's own lever path: the
  // router's gate, the swing and the clunk); a tap on a lever by touch is `defaults`' check. That's their default now.
  const handSet = await p.evaluate((id) => {
    const w = window.woodrail;
    w.interaction.throwLever(id);
    return { way: w.layout.switchState(id), def: w.economy.router.defaultOf(id) };
  }, setup.points);
  check("restore: the points' lever thrown by hand for their curve, their default", handSet.way === 1 && handSet.def === 1, JSON.stringify(handSet));
  // The route, as a player plans it: the engine tapped, Plan a route, the forest then the sawmill, Done; then Go.
  const { tapOn, tapButton, showing, onScreen } = mapHelpers(p);
  // (Which tap a timeout came in, for its message.)
  let stage = "the engine";
  try {
    // (Once in the full run a tap on the engine brought no click, the view still and nothing else under it: then a
    // second tap, the first one's miss in the message if that fails too.)
    await tapOn({ engine: setup.engine }).catch(async () => {
      stage = "the engine, a second time";
      await tapOn({ engine: setup.engine });
    });
    stage = "Plan a route";
    await tapButton(".engine-extra .route-plan");
    for (const d of setup.places) {
      stage = `place ${d}`;
      await tapOn({ depot: d });
    }
    stage = "Done";
    await tapButton(".engine-extra .route-plan.on");
  } catch (e) {
    const at = await onScreen({ engine: setup.engine });
    const why = await p.evaluate((at) => ({ at: at.map(Math.round), pick: window.woodrail.interaction.pick(at[0], at[1], true)?.kind ?? null, mode: window.woodrail.interaction.mode.kind, card: window.woodrail.interaction.openEngineCarId, busy: window.woodrail.director.busy, target: [Math.round(window.woodrail.controls.target.x), Math.round(window.woodrail.controls.target.z)], run: (({ x, z }) => [Math.round(x), Math.round(z)])(window.woodrail.layout.getPiece(window.__restoreRun).pose), bounds: window.woodrail.director.bounds }), at);
    throw new Error(`restore: tapping ${stage}: ${String(e?.message ?? e).split("\n")[0]} ${JSON.stringify(why)}`);
  }
  const stops = await p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, setup.engine);
  check("restore: the train's route planned by taps (Forest, Sawmill)", JSON.stringify(stops) === JSON.stringify(setup.places), JSON.stringify(stops));
  await p.keyboard.press("Escape");
  // The points in view (their lever's swing and click are shown only there), the view still.
  await p.evaluate((id) => {
    const w = window.woodrail;
    const q = w.layout.getPiece(id).pose;
    w.director.glideTo(new w.controls.target.constructor(q.x + 72, 0, q.z), 1500, { duration: 0.2 });
  }, setup.points);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames(p);
  // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of SwiftShader's few
  // frames a second, the forest kept stocked (its logs aren't what's tested). Each move of the points: their way, whether
  // a car is on them, where on the run the train's axles are; each soft click (the routed throw's sound) and lever
  // swing noted.
  const seen = await p.evaluate(async ({ id, engine, places, run }) => {
    const w = window.woodrail;
    const { PILE_CAP } = await import("/src/economy/constants.ts");
    const { CARGO } = await import("/src/economy/cargo.ts");
    const clicks = [];
    const click = w.audio.softSwitchClunk.bind(w.audio);
    w.audio.softSwitchClunk = (...a) => (clicks.push(w.sim.ticks), click(...a));
    // (A lever told to swing over: `Game.switchesChanged`'s `swing` says so for these points.)
    const swings = [];
    const changed = w.switchesChanged.bind(w);
    w.switchesChanged = (swing) => (swing?.(id) && swings.push(w.sim.ticks), changed(swing));
    w.sim.setLever(engine, 1);
    const log = [];
    let goods = 0;
    let under = 0;
    let last = w.layout.switchState(id);
    for (let i = 0; i < 90 * 120; i++) {
      if (i % 120 === 0) for (const d of w.economy.allDepots()) if (d.role === "forest") d.piles[CARGO.log.index] = PILE_CAP;
      w.sim.tick();
      w.economy.tick();
      for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === places[1]) goods++;
      const way = w.layout.switchState(id);
      const held = w.sim.pointsHeld(id);
      const t = w.sim.findCar(engine).train;
      if (way !== last) {
        // (Thrown with a car on them: the train would split.)
        if (held) under++;
        log.push({ tick: w.sim.ticks, way, onIt: held, at: t.bogies.map((b) => run.indexOf(b.pieceId)) });
        last = way;
      }
      if (held && log.length > 0 && !log[log.length - 1].crossed) log[log.length - 1].crossed = w.sim.ticks;
    }
    w.audio.softSwitchClunk = click;
    w.switchesChanged = changed;
    w.invalidate();
    return { log, goods, under, clicks, swings, way: w.layout.switchState(id), def: w.economy.router.defaultOf(id), locked: w.economy.router.locked(id) };
  }, { ...setup, id: setup.points });
  const [set, back] = seen.log;
  // Set for the train: to their straight road, with no car on them, before it came onto them (its front short of them).
  check("restore: the route throws the points for the train before it reaches them", !!set && set.way === 0 && !set.onIt && set.at.every((k) => k < 4) && !!set.crossed, JSON.stringify(seen.log));
  // Back once the train's off them: to the curve the player set, with the lever's swing and its soft click both times.
  const clicked = (t) => seen.clicks.includes(t) && seen.swings.includes(t);
  check(
    "restore: once the train is by, the lever swings back to the hand-set way, with its click",
    !!back && back.way === 1 && !back.onIt && back.tick > set.crossed && clicked(set.tick) && clicked(back.tick) && seen.under === 0,
    JSON.stringify({ log: seen.log, clicks: seen.clicks, swings: seen.swings, under: seen.under }),
  );
  check("restore: the train delivers (logs at the sawmill in 90 s), and the points end as the player set them", seen.goods >= 2 && (seen.locked || seen.way === seen.def) && seen.def === 1, JSON.stringify({ goods: seen.goods, way: seen.way, def: seen.def, locked: seen.locked, moves: seen.log.length }));
  // Nothing drawn once all is still: the train stopped, the frames stop (a restore is a swing, not a per-frame cost). (A
  // train stopped lets go the points it held ahead, and they go back: one redraw, so that's waited for first.)
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), setup.engine);
  await showing({ engine: setup.engine });
  await p.waitForFunction((id) => !window.woodrail.economy.router.locked(id), setup.points, { timeout: 30000 }).catch(() => {});
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await p.waitForTimeout(1000);
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  const was = await p.evaluate(() => {
    const w = window.woodrail;
    const r = w.economy.router;
    window.__idleSwitch = [];
    const on = r.onSwitch;
    r.onSwitch = (id) => (window.__idleSwitch.push(id), on?.(id));
    window.__idleOn = on;
    return { f: w.framesDrawn, granted: r.granted, restored: r.restored };
  });
  await p.waitForTimeout(3000);
  const now = await p.evaluate(() => {
    const w = window.woodrail;
    const r = w.economy.router;
    r.onSwitch = window.__idleOn;
    return { f: w.framesDrawn, granted: r.granted, restored: r.restored, switched: window.__idleSwitch, moving: [...w.sim.trainIds()].map((i) => w.sim.getTrain(i).speed).filter((v) => v > 0).length, ticks: w.sim.ticks };
  });
  check("restore: once the train has stopped, routing moves nothing (no points set or put back)", now.switched.length === 0 && now.granted === was.granted && now.restored === was.restored, JSON.stringify({ was, now }));
  // (In the full run other checks' trains are still running: frames are drawn for them, so 0 frames is asked only when
  // no train moves; the check above shows routing did nothing either way.)
  check("restore: no frames drawn once settled (with no train moving)", now.moving > 0 || now.f === was.f, JSON.stringify({ was, now }));
  await p.keyboard.press("Escape");
}

/**
 * Routing step 6 (#7, forward costs), by the player's path: a line from a forest (buffers behind it) past a sawmill to
 * points: their straight road on to a wye whose two corners a loop of track joins (a way round), their curve a short
 * dead-end spur. The route planned with real taps (its engine, Plan a route, the forest then the sawmill, Done). From the
 * sawmill the train must turn to go back: it goes round the wye's loop, engine first, never into the spur, and turns
 * only at the forest's buffers (the end of the line, by the flip). The way drawn from its front goes round too. By
 * piece counts (step 5) it took the spur and reversed there.
 */
async function forwardRoute(ctx, p) {
  await p.keyboard.press("Escape");
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    // Harness shortcut (setup, not what's tested): the layout of the routing harness's `wyeOverSpur` (laid there at
    // the origin), moved to open, flat ground and put down through the editor as dropping its pieces would.
    const { Layout } = await import("/src/track/index.ts");
    const S = await import("/src/routing/scenarios.ts");
    const scratch = new Layout();
    const built = S.wyeOverSpur.build(scratch);
    const ids = [...scratch.pieceIds()];
    const local = ids.map((i) => scratch.getPiece(i).pose);
    const g = await window.__openGround(local.map((q) => [q.x, q.z]), { pieceGap: 500 });
    if (!g) throw new Error("no open ground for the run");
    const t = built.trains[0];
    // (The harness's stops are all forest depots' pieces, plain track to it: the second is a sawmill's here.)
    const placed = w.editor().placeRun(ids.map((i) => {
      const q = scratch.getPiece(i);
      return { type: i === t.stops[1] ? "depot-sawmill" : q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
    }));
    const at = (i) => placed[ids.indexOf(i)];
    const [forest, sawmill] = [at(t.stops[0]), at(t.stops[1])];
    const spur = built.watch.map(at);
    const wye = placed.find((i) => w.layout.getPiece(i).type === "wye");
    if (w.layout.joinedConnector(wye * 8 + 2) === -1 || w.layout.joinedConnector(wye * 8) === -1) throw new Error("the wye's loop didn't join");
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const places = [depot(forest, "forest").id, depot(sawmill, "sawmill").id];
    // A train put down in code (as the tray would) between the forest and the sawmill, heading for the sawmill.
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: at(t.pieceId), pathIndex: 0, s: 150, reversed: false });
    if (r.kind !== "placed") throw new Error("no room for a train");
    const engine = w.sim.getTrain(r.trainId).cars[0].id;
    // (Lever off while the route's planned: it starts once it has one.)
    w.sim.setLever(engine, 0);
    w.invalidate();
    return { engine, places, forest, sawmill, spur, wye, run: placed, roles: places.map((d) => w.economy.depot(d).role) };
  });
  const { tapOn, tapButton } = mapHelpers(p);
  await tapOn({ engine: setup.engine });
  await tapButton(".engine-extra .route-plan");
  for (const d of setup.places) await tapOn({ depot: d });
  await tapButton(".engine-extra .route-plan.on");
  const stops = await p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, setup.engine);
  check("forward: the train's route planned by taps (Forest, Sawmill)", JSON.stringify(stops) === JSON.stringify(setup.places), JSON.stringify(stops));
  await p.keyboard.press("Escape");
  // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of SwiftShader's few
  // frames a second, the forest kept stocked (its logs aren't what's tested). Each arrival at a stop (whether the engine
  // leads), each turn (where), the spur and the wye's loop entered, and the way drawn from the train's front as it
  // leaves the sawmill.
  const seen = await p.evaluate(async (o) => {
    const w = window.woodrail;
    const { PILE_CAP } = await import("/src/economy/constants.ts");
    const { CARGO } = await import("/src/economy/cargo.ts");
    const { legFromCursor } = await import("/src/game/route-path.ts");
    const loop = new Set(o.run.filter((i) => w.layout.getPiece(i).type === "curve-large" && !o.spur.includes(i)));
    // (The buffers behind the forest: the end of the line. Connector refs are piece × 8 + connector.)
    const forestBuffer = Math.floor(w.layout.joinedConnector(o.forest * 8) / 8);
    w.sim.setLever(o.engine, 1);
    const arrivals = [];
    const turns = [];
    let goods = 0;
    let loaded = 0;
    let onSpur = 0;
    let round = 0;
    let drawn = null;
    let lastTurn = null;
    let at = null;
    for (let i = 0; i < 240 * 120; i++) {
      if (i % 120 === 0) for (const d of w.economy.allDepots()) if (d.role === "forest") d.piles[CARGO.log.index] = PILE_CAP;
      w.sim.tick();
      w.economy.tick();
      for (const ev of w.economy.drainEvents()) {
        if (ev.kind === "unloaded" && ev.depotId === o.places[1]) goods++;
        if (ev.kind === "loaded") loaded++;
      }
      const t = w.sim.findCar(o.engine).train;
      const on = t.bogies.map((b) => b.pieceId);
      if (on.some((id) => o.spur.includes(id))) onSpur++;
      if (on.some((id) => loop.has(id))) round++;
      if (t.lastTurn && t.lastTurn.tick !== lastTurn) {
        lastTurn = t.lastTurn.tick;
        turns.push(t.lastTurn.pieceId === o.forest || t.lastTurn.pieceId === forestBuffer ? "forest" : t.lastTurn.pieceId);
      }
      const stop = on.includes(o.forest) ? "forest" : on.includes(o.sawmill) ? "sawmill" : null;
      if (stop && stop !== at) {
        let net = 0;
        for (const c of t.cars) if (c.kind === "engine") net += c.lever * c.facing;
        arrivals.push({ stop, engineFirst: t.cars[net >= 0 ? 0 : t.cars.length - 1].kind === "engine" });
      }
      // (Off the sawmill again, heading on: the way drawn from its front, once.)
      if (!stop && at === "sawmill" && !drawn) {
        const leg = legFromCursor(w.layout, t.bogies[0], o.forest) ?? [];
        drawn = { spur: leg.filter((r) => o.spur.includes(r.pieceId)).length, round: leg.filter((r) => loop.has(r.pieceId)).length, wye: leg.filter((r) => r.pieceId === o.wye).length };
      }
      at = stop;
    }
    w.invalidate();
    return { arrivals, turns, goods, loaded, onSpur, round, drawn };
  }, { ...setup });
  check("forward: the train delivers (logs at the sawmill in 4 min)", seen.goods >= 2, JSON.stringify({ goods: seen.goods, loaded: seen.loaded, arrivals: seen.arrivals.length, roles: setup.roles }));
  check("forward: round the wye's loop, never into the dead-end spur", seen.round > 0 && seen.onSpur === 0, JSON.stringify({ round: seen.round, onSpur: seen.onSpur }));
  check("forward: turns only at the end of the line (the forest's buffers)", seen.turns.length > 0 && seen.turns.every((t) => t === "forest"), JSON.stringify(seen.turns));
  check("forward: engine first at every stop", seen.arrivals.length >= 3 && seen.arrivals.every((a) => a.engineFirst), JSON.stringify(seen.arrivals));
  check("forward: the way drawn from the sawmill goes round the wye, not into the spur", !!seen.drawn && seen.drawn.spur === 0 && seen.drawn.round > 0 && seen.drawn.wye > 0, JSON.stringify(seen.drawn));
  await p.keyboard.press("Escape");
}

/**
 * A train waits at points set for another (#3 follow-up, routing step 5), by the player's path: a trunk from a forest
 * into points, their straight road to one sawmill, their curve to another. Two trains of logs on the trunk, the second
 * close behind the first; each given its route with real taps (its engine, Plan a route, its sawmill then the forest,
 * Done): the first to the straight road's sawmill, the second to the curve's. The points are set for the first; the
 * second stops a little short of them, its card saying who it waits for, and goes once the first is by and they're
 * set for it. Both deliver, neither takes the other's road, and the points never move under a train.
 */
async function routeWait(ctx, p) {
  await p.keyboard.press("Escape");
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    const { Layout, appendPiece, connectorRef } = await import("/src/track/index.ts");
    // The run, laid first on a scratch layout from (0, 0) heading +x (to read each piece's pose): the forest, six
    // straights, the points; on their straight road a straight, a sawmill, a straight; on their curve a curve the other
    // way, a straight, a sawmill, a straight.
    const s = new Layout();
    const types = ["depot-forest", ...Array(6).fill("straight-216")];
    const trunk = [s.addPiece(types[0], { x: 0, z: 0, heading: 0 }, 0, false)];
    for (const t of types.slice(1)) trunk.push(appendPiece(s, t, false, connectorRef(trunk[trunk.length - 1], 1)));
    const points = appendPiece(s, "switch", false, connectorRef(trunk[trunk.length - 1], 1), 0);
    const road = (from, list) => {
      const ids = [];
      for (const [t, flip] of list) ids.push(appendPiece(s, t, flip, ids.length ? connectorRef(ids[ids.length - 1], 1) : from));
      return ids;
    };
    const a = road(connectorRef(points, 1), [["straight-216", false], ["depot-sawmill", false], ["straight-216", false]]);
    const b = road(connectorRef(points, 2), [["curve-large", true], ["straight-216", false], ["depot-sawmill", false], ["straight-216", false]]);
    const order = [...trunk, points, ...a, ...b];
    const poses = order.map((id) => s.getPiece(id));
    // (Open, flat ground for the run, anywhere the view can go: window.__openGround.)
    const t = w.controls.target;
    const o = await window.__openGround(poses.flatMap((q) => [0, 108, 216].map((d) => [q.pose.x + d * Math.cos(q.pose.heading), q.pose.z + d * Math.sin(q.pose.heading)])));
    const g = o;
    if (!g) throw new Error("no open ground for the run");
    // Harness shortcut (setup, not what's tested): the run laid through the editor, as dropping the pieces would; two
    // trains put down in code on the trunk, as the tray would, their timber wagons full of logs (as from the forest).
    const ids = w.editor().placeRun(poses.map((q) => ({ type: q.type, pose: { x: g.x + q.pose.x, z: g.z + q.pose.z, heading: q.pose.heading }, y: 0, flipped: q.flipped })));
    const at = (id) => ids[order.indexOf(id)];
    const sw = at(points);
    for (const c of [0, 1, 2]) if (w.layout.joinedConnector(sw * 8 + c) === -1) throw new Error(`the points didn't join at ${c}`);
    window.__waitRun = at(trunk[0]);
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const forest = depot(at(trunk[0]), "forest").id;
    const millA = depot(at(a[1]), "sawmill").id;
    const millB = depot(at(b[2]), "sawmill").id;
    const put = (cars, places) => {
      for (const [k, s0] of places) {
        const r = w.sim.addTrain(cars, { pieceId: at(trunk[k]), pathIndex: 0, s: s0, reversed: false });
        if (r.kind !== "placed") continue;
        const tr = w.sim.getTrain(r.trainId);
        for (const c of tr.cars) if (c.kind === "timber") w.economy.setCargo(c.id, "log", 5);
        // (Lever off while its route's planned.)
        w.sim.setLever(tr.cars[0].id, 0);
        return tr.cars[0].id;
      }
      throw new Error("no room for a train");
    };
    const first = put(["engine", "timber", "timber", "timber"], [[6, 200]]);
    const second = put(["engine", "timber"], [[4, 200], [4, 150], [4, 100], [3, 200], [3, 100]]);
    w.invalidate();
    return { first, second, forest, millA, millB, points: sw, roadA: a.map(at), roadB: b.map(at) };
  });
  const { tapOn, tapButton, showing } = mapHelpers(p);
  // Each route, as a player plans it: the engine tapped, Plan a route, its sawmill then the forest, Done.
  const plan = async (engine, mill) => {
    let stage = "the engine";
    try {
      await tapOn({ engine }).catch(async () => {
        stage = "the engine, a second time";
        await tapOn({ engine });
      });
      stage = "Plan a route";
      await tapButton(".engine-extra .route-plan");
      for (const d of [mill, setup.forest]) {
        stage = `place ${d}`;
        await tapOn({ depot: d });
      }
      stage = "Done";
      await tapButton(".engine-extra .route-plan.on");
    } catch (e) {
      throw new Error(`wait: tapping ${stage}: ${String(e?.message ?? e).split("\n")[0]}`);
    }
    await p.keyboard.press("Escape");
    return p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, engine);
  };
  const r1 = await plan(setup.first, setup.millA);
  const r2 = await plan(setup.second, setup.millB);
  check("wait: two routes planned by taps (each its own sawmill, then the forest)", JSON.stringify(r1) === JSON.stringify([setup.millA, setup.forest]) && JSON.stringify(r2) === JSON.stringify([setup.millB, setup.forest]), JSON.stringify({ r1, r2 }));
  // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of SwiftShader's few
  // frames a second; both told to go as the card's Go does (both start together, the second close behind). Run till the
  // second stands waiting at the points (or 60 s), watching every move of the points and every axle on the roads.
  const watch = `(() => {
    const w = window.woodrail;
    const s = window.__wait;
    for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded") s.goods[ev.depotId] = (s.goods[ev.depotId] ?? 0) + 1;
    const way = w.layout.switchState(s.points);
    if (way !== s.last) {
      if (w.sim.pointsHeld(s.points)) s.under++;
      s.moves.push({ tick: w.sim.ticks, way });
      s.last = way;
    }
    const on = (e, road) => w.sim.findCar(e).train.bogies.some((b) => road.includes(b.pieceId));
    if (on(s.first, s.roadB)) s.wrong.push("first on B");
    if (on(s.second, s.roadA)) s.wrong.push("second on A");
    if (s.goneAt < 0 && on(s.second, s.roadB)) s.goneAt = w.sim.ticks;
  })`;
  const waited = await p.evaluate(({ setup, watch }) => {
    const w = window.woodrail;
    window.__wait = { ...setup, goods: {}, moves: [], under: 0, wrong: [], last: w.layout.switchState(setup.points), stood: 0, near: Infinity, far: -Infinity, goneAt: -1, held: 0 };
    window.__waitWatch = (0, eval)(watch);
    w.sim.setLever(setup.first, 1);
    w.sim.setLever(setup.second, 1);
    const s = window.__wait;
    for (let i = 0; i < 60 * 120 && s.stood < 120; i++) {
      w.sim.tick();
      w.economy.tick();
      window.__waitWatch();
      const t = w.sim.findCar(setup.second).train;
      const wt = w.economy.router.waitOf(setup.second);
      if (wt?.kind === "points" && t.speed === 0) {
        s.stood++;
        const gap = w.economy.router.gapTo(t);
        s.near = Math.min(s.near, gap);
        s.far = Math.max(s.far, gap);
        s.by = wt.by;
      }
      // (Or, the two lines working the single track together (sections shared by the lines on one network), held by
      // sections at its slot's end, short of the points, while the first holds the junction's section.)
      const sw = w.economy.sections.waitOf(setup.second);
      if (sw && "engine" in sw && t.speed === 0 && !w.sim.piecesUnder(t.id).has(setup.points)) {
        s.held++;
        s.by = sw.engine;
        if (s.held >= 120) s.stood = Math.max(s.stood, s.held);
      }
    }
    // (Paused while its card is opened and read: the game's own frames would run the sim on meanwhile, and the first
    // train be by, before SwiftShader's slow frames have shown the card.)
    w.paused = true;
    w.invalidate();
    return { stood: s.stood, held: s.held, near: s.near, far: s.far, by: s.by, onPoints: w.sim.piecesUnder(w.sim.findCar(setup.second).train.id).has(setup.points), way: w.layout.switchState(setup.points) };
  }, { setup, watch });
  // (Short of the points by the router (its nose 30–40 mm short), or held by sections at its slot's end, which is
  // where two lines' trains sharing the track now wait: the first holds the section with the points.)
  const shortOf = waited.held >= 120 || (waited.near >= 30 && waited.far <= 40);
  check("wait: the second train stops short of the points while the first has them (a second or more, never on them)", waited.stood >= 120 && shortOf && !waited.onPoints && waited.by === setup.first && waited.way === 0, JSON.stringify(waited));
  // Its card, opened by a tap on it while it waits, says who for.
  await tapOn({ engine: setup.second });
  await p.waitForFunction(() => !!document.querySelector(".engine-status")?.textContent, null, { timeout: 30000 }).catch(() => {});
  const said = await p.evaluate(() => document.querySelector(".engine-status")?.textContent ?? "");
  const lineName = await p.evaluate((e) => window.woodrail.economy.lines.get(window.woodrail.economy.lineIdOf.get(e))?.name, setup.first);
  check("wait: its card says it's waiting for the first train", said === `Waiting for the train on the ${lineName} to pass the points` || said === "Waiting: another train is in the way", JSON.stringify({ said, lineName }));
  await p.keyboard.press("Escape");
  // The first by, the points are set for the second (it goes on). Before it's on them, two taps on their lever (§16 Q1,
  // as changed at step 5): they stay set for it, a toast says so, and the second tap's way (their curve, as set for
  // it) is their default from now on. (Harness shortcut: the lever thrown as a tap throws it, the game's own lever
  // path, its gate and its toast; a lever tapped by touch is `defaults`' check.)
  const locked = await p.evaluate(({ setup }) => {
    const w = window.woodrail;
    const s = window.__wait;
    const r = w.economy.router;
    // (Its move granted by sections too: held at its slot's end, the points' lock is still the first's.)
    for (let i = 0; i < 30 * 120 && !(r.locked(setup.points) && !r.waitOf(setup.second) && !w.economy.sections.waitOf(setup.second) && !w.sim.pointsHeld(setup.points)); i++) {
      w.sim.tick();
      w.economy.tick();
      window.__waitWatch();
    }
    const said = [];
    const toast = w.hud.toast.bind(w.hud);
    w.hud.toast = (m, ...a) => (said.push(m), toast(m, ...a));
    const before = { way: w.layout.switchState(setup.points), def: r.defaultOf(setup.points) };
    w.interaction.throwLever(setup.points);
    const once = { way: w.layout.switchState(setup.points), def: r.defaultOf(setup.points) };
    w.interaction.throwLever(setup.points);
    const twice = { way: w.layout.switchState(setup.points), def: r.defaultOf(setup.points), locked: r.locked(setup.points) };
    w.hud.toast = toast;
    w.invalidate();
    return { before, once, twice, said, line: w.economy.lines.get(w.economy.lineIdOf.get(setup.second))?.name };
  }, { setup });
  check(
    "wait: a lever tap on points set for the second train leaves them set for it, and says so",
    locked.before.way === 1 && locked.once.way === 1 && locked.twice.way === 1 && locked.twice.locked && locked.once.def === 0 && locked.twice.def === 1 && locked.said.length === 2 && locked.said.every((m) => m === `Set for the train on the ${locked.line}. They'll switch to your way after it passes`),
    JSON.stringify(locked),
  );
  // On: it goes its way, the points set for it; both deliver, each on its own road.
  const after = await p.evaluate(({ setup }) => {
    const w = window.woodrail;
    const s = window.__wait;
    w.paused = false;
    for (let i = 0; i < 120 * 120 && !((s.goods[setup.millA] ?? 0) >= 2 && (s.goods[setup.millB] ?? 0) >= 1); i++) {
      w.sim.tick();
      w.economy.tick();
      window.__waitWatch();
    }
    const goneAt = s.goneAt;
    w.invalidate();
    const r = w.economy.router;
    return { goods: s.goods, moves: s.moves, under: s.under, wrong: s.wrong.slice(0, 3), goneAt, way: w.layout.switchState(setup.points), def: r.defaultOf(setup.points), locked: r.locked(setup.points) };
  }, { setup });
  check("wait: then it goes its own way and delivers, as does the first (logs at both sawmills)", after.goneAt > 0 && (after.goods[setup.millA] ?? 0) >= 2 && (after.goods[setup.millB] ?? 0) >= 1, JSON.stringify(after));
  // (The points moved once, for the second, to their curve: the tapped default, so not put back after it.)
  check("wait: no wrong-road moves, and the points never moved under a train", after.wrong.length === 0 && after.under === 0 && after.moves.length >= 1 && after.moves[0].way === 1, JSON.stringify(after));
  check("wait: the tapped way is the points' default, where they lie once no train holds them", after.def === 1 && (after.locked || after.way === 1), JSON.stringify(after));
  // Nothing drawn once all is still (both stopped, and done at their depots: the sim run on 30 s, a harness shortcut, so
  // a crane still unloading the second at its sawmill has finished).
  await p.evaluate((s) => {
    const w = window.woodrail;
    w.sim.setLever(s.first, 0);
    w.sim.setLever(s.second, 0);
    for (let i = 0; i < 30 * 120; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    w.economy.drainEvents();
    w.invalidate();
  }, setup);
  await showing({ engine: setup.second });
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await p.waitForTimeout(1000);
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  // (A station clock in view moves its hands as the game's minute turns, and a sawmill in view saws the logs it was
  // given: frames for those are counted, not routing's. Routing's own part is watched too: no points set or put back.)
  const f0 = await p.evaluate(() => {
    const w = window.woodrail;
    const r = w.economy.router;
    window.__waitIdle = { clock: 0, switched: 0, granted: r.granted, restored: r.restored };
    const tick = w.clockView.tick.bind(w.clockView);
    window.__waitClock = tick;
    w.clockView.tick = (...a) => { const t = tick(...a); if (t) window.__waitIdle.clock++; return t; };
    const on = r.onSwitch;
    window.__waitOn = on;
    r.onSwitch = (id) => (window.__waitIdle.switched++, on?.(id));
    // (What asked for a frame, for a failure's message.)
    window.__waitIdle.why = [];
    const inv = w.invalidate.bind(w);
    window.__waitInv = inv;
    w.invalidate = () => (window.__waitIdle.why.length < 3 && window.__waitIdle.why.push(new Error().stack.split("\n").slice(2, 5).map((l) => l.trim().replace(/\(.*\/src\//, "(")).join(" < ")), inv());
    window.__waitDepots = [];
    const dv = w.depotView.update.bind(w.depotView);
    window.__waitDv = dv;
    w.depotView.update = (...a) => { const r = dv(...a); if (r !== "still") window.__waitDepots.push(r); return r; };
    return w.framesDrawn;
  });
  await p.waitForTimeout(3000);
  const idle = await p.evaluate(() => {
    const w = window.woodrail;
    const r = w.economy.router;
    w.clockView.tick = window.__waitClock;
    r.onSwitch = window.__waitOn;
    w.invalidate = window.__waitInv;
    w.depotView.update = window.__waitDv;
    const i = window.__waitIdle;
    return { f: w.framesDrawn, why: i.why, depots: window.__waitDepots.length, clock: i.clock, switched: i.switched, granted: r.granted - i.granted, restored: r.restored - i.restored, moving: [...w.sim.trainIds()].map((k) => w.sim.getTrain(k).speed).filter((v) => v > 0).length };
  });
  check("wait: no frames drawn once settled (no train moving), but for a working depot or a clock; routing moves nothing", idle.moving > 0 || (idle.f - f0 <= idle.clock + idle.depots && idle.why.length === 0 && idle.switched === 0 && idle.granted === 0 && idle.restored === 0), JSON.stringify({ f0, ...idle }));
  await p.keyboard.press("Escape");
}

/**
 * A toast up over the map: a tap on it dismisses it, but while the map takes taps (picking pieces, drawing) it goes
 * through to the map (QA: picking, a tap on a piece under the toast hit the toast, twice).
 */
async function toastTapsThrough(p) {
  await p.keyboard.press("Escape");
  const r = await p.evaluate(async () => {
    const w = window.woodrail;
    const t = document.querySelector(".toast");
    const at = () => {
      const q = t.getBoundingClientRect();
      const e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      return e === t || t.contains(e) ? "toast" : e?.tagName === "CANVAS" ? "CANVAS" : `${e?.tagName ?? "nothing"}.${String(e?.className ?? "").slice(0, 40)} toast ${Math.round(q.top)}-${Math.round(q.bottom)} it ${e ? Math.round(e.getBoundingClientRect().top) + "-" + Math.round(e.getBoundingClientRect().bottom) : ""}`;
    };
    w.hud.toast("A toast over the map, for the test", false, 60000);
    // (Up: shown, its slide in done, by what it is, not after a set time.)
    for (let i = 0; i < 600 && !(t.classList.contains("show") && getComputedStyle(t).transform.endsWith(", 0)")); i++) await new Promise((r) => setTimeout(r, 50));
    const idle = at();
    // (Each a couple of frames on, as a finger comes: a card that opens with the mode (picking's) has had its resize
    // seen, and the toast put clear of it.)
    const later = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    w.interaction.setDrawing(true);
    await later();
    const drawing = at();
    w.interaction.setDrawing(false);
    w.interaction.selectMore();
    await later();
    const picking = at();
    w.interaction.doneSelecting();
    await later();
    const after = at();
    w.hud.dismissToast();
    return { idle, drawing, picking, after };
  });
  check("a toast takes a tap, but lets it through to the map (the canvas) while picking pieces or drawing (QA)", r.idle === "toast" && r.drawing === "CANVAS" && r.picking === "CANVAS" && r.after === "toast", JSON.stringify(r));
}

/**
 * A routed train held at a forest where the track just stops (waiting to fill, with no logs): its card offers
 * Continue, and a touch tap on it turns the train round, engine first, and sends it back to its next stop.
 */
async function deadEndContinue(p) {
  await p.keyboard.press("Escape");
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    // (A run of its own on open ground, found outward from the view's target.)
    const t = w.controls.target;
    const o = await window.__openGround(window.__runFootprint(1600));
    const g = o && t.clone().set(o.x, 0, o.z);
    if (!g) throw new Error("no open ground for the run");
    // Harness shortcuts, for setup only (not what's tested): the track laid and the route set straight through the
    // editor and economy, as dropping pieces and planning the route on the card would.
    const types = ["depot-sawmill", "straight-216", "straight-216", "straight-216", "straight-216", "depot-forest"];
    const run = w.editor().placeRun(types.map((type, i) => ({ type, pose: { x: g.x + i * 216, z: g.z, heading: 0 }, y: 0, flipped: false })));
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const sawmill = depot(run[0], "sawmill");
    const forest = depot(run[5], "forest");
    const placed = w.sim.addTrain(["engine", "timber"], { pieceId: run[3], pathIndex: 0, s: 150, reversed: false });
    if (placed.kind !== "placed") throw new Error("no room for the train");
    const engine = w.sim.getTrain(placed.trainId).cars[0].id;
    w.economy.setRoute(engine, { stops: [{ depotId: forest.id, action: "both", waitFill: true }, { depotId: sawmill.id, action: "both" }], next: 0 });
    w.sim.setLever(engine, 1);
    // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of the frames, which
    // SwiftShader draws only a few a second: to the forest, and a while held there.
    let held = 0;
    for (let i = 0; i < 120 * 60 && held < 120 * 3; i++) {
      w.sim.tick();
      w.economy.tick();
      const tr = w.sim.findCar(engine).train;
      if (tr.turnback >= 0 && tr.lastTurn?.cause === "open-end") held++;
    }
    const at = g.clone();
    at.x = g.x + 4 * 216;
    w.director.glideTo(at, frameDistance(900, w.camera.fov, w.camera.aspect), { duration: 0.3 });
    w.interaction.openEngineCard(engine);
    w.invalidate();
    return { engine, run };
  });
  // Up to the forest at the end of the track, held there: Continue shows.
  const shown = await p.waitForFunction(() => { const b = document.querySelector(".engine-card .continue"); return !!b && !b.hidden && b.offsetParent !== null; }, null, { timeout: 120000 }).then(() => true, () => false);
  const card = await p.evaluate(() => {
    const c = document.querySelector(".engine-card");
    const s = c.querySelector(".engine-status");
    const b = c.querySelector(".continue").getBoundingClientRect();
    // (Two lines at most: under 2.8 of its font's size tall.)
    const two = s.getBoundingClientRect().height < 2.8 * parseFloat(getComputedStyle(s).fontSize);
    return { status: s.textContent, two, w: Math.round(c.getBoundingClientRect().width), bw: Math.round(b.width), bh: Math.round(b.height) };
  });
  check("dead end: a routed train held where the track ends shows Continue", shown && card.status === "Turning back: the track ends here", JSON.stringify(card));
  check("dead end: Continue is a thumb's size, the card fits the phone (its status in 2 lines)", card.bh >= 44 && card.bw >= 120 && card.w <= 390 - 32 && card.two, JSON.stringify(card));
  if (!shown) return;
  // As a finger would: once Continue has been drawn, and has stood in place longer than the card tap guard's window
  // (`CARD_MOVED_MS`). Shown in the DOM isn't drawn: SwiftShader may take seconds to the next frame, and a tap sent
  // before it lands just after the frame that first lays the button out, which the guard rightly drops (#19).
  await frames(p);
  await p.waitForTimeout(250);
  const [x, y] = await p.evaluate(() => { const r = document.querySelector(".engine-card .continue").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await tapped(p, () => p.touchscreen.tap(x, y));
  const after = await p.evaluate(({ engine }) => {
    const t = window.woodrail.sim.findCar(engine).train;
    return { first: t.cars[0].kind, turnback: t.turnback, hidden: document.querySelector(".engine-card .continue").hidden };
  }, setup);
  check("dead end: a tap on Continue turns the train round, engine first", after.first === "engine" && after.turnback === -1 && after.hidden, JSON.stringify(after));
  // The payoff: off back down the line, engine leading all the way, to the sawmill (its next stop). (Ticked ahead as
  // above: the same ticks the game runs.)
  const reached = await p.evaluate(({ engine, run }) => {
    const w = window.woodrail;
    for (let i = 0; i < 120 * 60; i++) {
      w.sim.tick();
      w.economy.tick();
      const t = w.sim.findCar(engine)?.train;
      if (!t || t.cars[0].kind !== "engine") return false;
      if (t.bogies.some((b) => b.pieceId === run[0])) return true;
    }
    return false;
  }, setup);
  const end = await p.evaluate(({ engine }) => {
    const t = window.woodrail.sim.findCar(engine)?.train;
    return { first: t?.cars[0].kind, next: window.woodrail.economy.routeOf(engine)?.next };
  }, setup);
  check("dead end: …and it runs back to its next stop with the engine leading", reached && end.next === 1, JSON.stringify(end));
  await p.keyboard.press("Escape");
}

/**
 * The third-train trap, by the player's path: a line with one passing loop and three trains. The third is held (the
 * newest), the player's told once (the real toast, at 360 px), and its card offers "Put away": a touch tap puts it back
 * in the box, and the other two deliver. Undo puts it back. A reload keeps the same train held, and says nothing again.
 */
async function putAwayButton(p) {
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 360, height: 740 });
  await frames(p);
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    const { Layout, appendPiece, connectorRef } = await import("/src/track/index.ts");
    const { loopOn } = await import("/src/economy/loop-fixtures.ts");
    const { editLine, joinLine } = await import("/src/game/lines.ts");
    const { frameDistance } = await import("/src/game/camera-director.ts");
    // (Open, flat ground for the line, anywhere the view can go: window.__openGround.)
    const t = w.controls.target;
    const o = await window.__openGround(window.__runFootprint(2916, [0, 300]).map(([x, z]) => [x - 216, z]), { pieceGap: 900, propGap: 500 });
    const g = o;
    if (!g) throw new Error("no open ground for the line");
    // Harness shortcut (setup, not what's tested): QA's N1 line (a forest, two straights, one passing loop, two
    // straights, a sawmill, a turnback buffer at each end) worked out on a scratch layout and laid in one go, as the
    // player's pieces would be.
    const L = new Layout();
    const a = L.addPiece("depot-forest", { x: g.x, z: g.z, heading: 0 });
    appendPiece(L, "buffer-turnback", false, connectorRef(a, 0));
    const chain = (n, from) => { const ids = []; for (let k = 0; k < n; k++) { ids.push(appendPiece(L, "straight-216", false, from)); from = connectorRef(ids[k], 1); } return ids; };
    const west = chain(2, connectorRef(a, 1));
    const loop = loopOn(L, connectorRef(west[1], 1), ["straight-216", "straight-216"], ["straight-216"]);
    const east = chain(2, connectorRef(loop.s2, 0));
    const b = appendPiece(L, "depot-sawmill", false, connectorRef(east[1], 1));
    appendPiece(L, "buffer-turnback", false, connectorRef(b, 1));
    const scratch = [...L.pieceIds()];
    const run = w.editor().placeRun(scratch.map((id) => { const q = L.getPiece(id); return { type: q.type, pose: { ...q.pose }, y: 0, flipped: q.flipped }; }));
    const real = (id) => run[scratch.indexOf(id)];
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const forest = depot(real(a), "forest");
    const sawmill = depot(real(b), "sawmill");
    // Harness shortcut (setup): the trains put down and joined to one line in code, as the tray and the card's line
    // would; the third comes on a moment later, as the player adds it.
    const put = (piece, s, next, lineId) => {
      const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: real(piece), pathIndex: 0, reversed: false, s });
      if (r.kind !== "placed") throw new Error("no room for a train");
      const e = w.sim.getTrain(r.trainId).cars[0].id;
      w.sim.setLever(e, 1);
      const line = lineId === undefined ? editLine(w.economy, e, (st) => st.push({ depotId: forest.id, action: "auto" }, { depotId: sawmill.id, action: "auto" })) : joinLine(w.economy, e, lineId);
      w.economy.routeOf(e).next = next;
      return { e, lineId: line.id };
    };
    const first = put(west[0], 200, 1);
    const second = put(east[0], 200, 0, first.lineId);
    // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of SwiftShader's
    // few frames a second; the forest kept stocked (its logs aren't what's tested). Counts goods unloaded at the sawmill.
    window.__run = (secs) => {
      const { PILE_CAP } = window.__consts;
      let goods = 0;
      for (let i = 0; i < secs * 120; i++) {
        const f = w.economy.depot(forest.id);
        if (f && i % 120 === 0) f.piles[window.__logIndex] = PILE_CAP;
        w.sim.tick();
        w.economy.tick();
        for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === sawmill.id) goods++;
      }
      w.invalidate();
      return goods;
    };
    const { PILE_CAP } = await import("/src/economy/constants.ts");
    const { CARGO } = await import("/src/economy/cargo.ts");
    window.__consts = { PILE_CAP };
    window.__logIndex = CARGO.log.index;
    // What the player's told (the real toasts, recorded on their way).
    window.__trapSaid = [];
    const toast = w.hud.toast.bind(w.hud);
    w.hud.toast = (m, ...rest) => (window.__trapSaid.push(m), toast(m, ...rest));
    window.__run(30);
    const third = put(west[1], 100, 1, first.lineId);
    window.__run(1);
    const at = { x: g.x + 1200, z: g.z };
    w.director.glideTo(w.controls.target.clone().set(at.x, 0, at.z), frameDistance(1600, w.camera.fov, w.camera.aspect), { duration: 0.3 });
    // (Where the two places stand: a reload gives out depot ids afresh, as it does car ids.)
    const standsAt = (d) => { const q = w.layout.getPiece(d.pieceId).pose; return [q.x, q.z]; };
    return { E: [first.e, second.e, third.e], forest: forest.id, sawmill: sawmill.id, forestAt: standsAt(forest), sawmillAt: standsAt(sawmill), lineId: first.lineId };
  });
  // The toast, said as the third came on: once, in the line's numbers, and it fits a 360 px phone.
  await p.waitForFunction(() => document.querySelector(".toast")?.classList.contains("show"), null, { timeout: 60000 }).catch(() => {});
  const toast = await p.evaluate(() => {
    const t = document.querySelector(".toast");
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    // (Lines counted by its own line's height: a one-line toast of the same style, measured as laid out. Not the font
    // size × 1.25 (Nunito's line, "normal", is about 1.36 once the web font has loaded), nor the box on screen (tilted
    // and sliding in).)
    const one = t.cloneNode(false);
    one.textContent = "Line";
    Object.assign(one.style, { visibility: "hidden" });
    t.after(one);
    const lh = one.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    one.remove();
    return { said: window.__trapSaid.filter((m) => /^This line has room/.test(m)), shown: t.textContent, left: r.left, right: r.right, lines: Math.round((t.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh), lh, font: document.fonts.check(`${cs.fontWeight} ${cs.fontSize} Nunito`), vw: innerWidth };
  });
  check("trap: a third train on a 1-loop line: the player's told once, how to fix it", toast.said.length === 1 && toast.said[0] === "This line has room for 2 trains. Lay another passing loop, or put one away (on its card).", JSON.stringify(toast.said));
  check("trap: the line's toast fits a 360 px phone (three lines at most)", toast.left >= 0 && toast.right <= toast.vw && toast.lines <= 3, JSON.stringify(toast));
  // The newest is held; the line delivers nothing while it is (the trap).
  const trapped = await p.evaluate(({ E }) => {
    const s = window.woodrail.economy.sections;
    return { held: E.map((e) => (s.heldForRoom(e) ? "held" : "room")).join("/"), goods: window.__run(90) };
  }, setup);
  check("trap: the newest train is the one held, and the line delivers nothing", trapped.held === "room/room/held" && trapped.goods === 0, JSON.stringify(trapped));
  // Reloaded (saved as the page goes): the same train is held, and the player isn't told again.
  const before = await p.evaluate(({ E }) => E.map((e) => { const q = window.woodrail.sim.findCar(e).train.world[0]; return [q.x, q.z]; }), setup);
  await p.reload();
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
  await p.evaluate(() => {
    window.__trapSaid = [];
    const h = window.woodrail.hud;
    const toast = h.toast.bind(h);
    h.toast = (m, ...rest) => (window.__trapSaid.push(m), toast(m, ...rest));
    document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click();
  });
  await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 60000 });
  await frames(p);
  const reloaded = await p.evaluate(({ before }) => {
    const w = window.woodrail;
    // The same trains, found where they stood (car ids are given out afresh on loading; running ones went on a little
    // before the page saved).
    const E = before.map(([x, z]) => {
      let best = -1;
      let d = 400;
      for (const id of w.sim.trainIds()) {
        const t = w.sim.getTrain(id);
        const q = t.world[0];
        const k = Math.hypot(q.x - x, q.z - z);
        if (k < d && t.cars[0].kind === "engine") [best, d] = [t.cars[0].id, k];
      }
      return best;
    });
    w.sim.tick();
    w.economy.tick();
    const s = w.economy.sections;
    return { E, held: E.map((e) => (e < 0 ? "?" : s.heldForRoom(e) ? "held" : "room")).join("/"), said: window.__trapSaid.filter((m) => /^This line has room/.test(m)) };
  }, { before });
  check("trap: after a reload the same train is held, and the player isn't told again", reloaded.held === "room/room/held" && reloaded.said.length === 0, JSON.stringify(reloaded));
  const E = reloaded.E;
  // Harness shortcut: the run-ahead helper again (the page was reloaded); it's the same as above.
  await p.evaluate(async ({ forestAt, sawmillAt }) => {
    const w = window.woodrail;
    const { PILE_CAP } = await import("/src/economy/constants.ts");
    // (The two places found where they stand: their ids were given out afresh on loading.)
    const placeAt = ([x, z]) => {
      for (const id of w.layout.pieceIds()) { const q = w.layout.getPiece(id).pose; if (Math.hypot(q.x - x, q.z - z) < 1) return w.economy.depotAtPiece(id)?.id ?? -1; }
      return -1;
    };
    const forest = placeAt(forestAt);
    const sawmill = placeAt(sawmillAt);
    const { CARGO } = await import("/src/economy/cargo.ts");
    window.__run = (secs) => {
      let goods = 0;
      for (let i = 0; i < secs * 120; i++) {
        const f = w.economy.depot(forest);
        if (f && i % 120 === 0) f.piles[CARGO.log.index] = PILE_CAP;
        w.sim.tick();
        w.economy.tick();
        for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === sawmill) goods++;
      }
      w.invalidate();
      return goods;
    };
  }, setup);
  // The held train's card: "Put away" (opened in code: opening a card is tested above; the button is what's tested here).
  await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), E[2]);
  const shown = await p.waitForFunction(() => { const b = document.querySelector(".engine-card .put-away"); return !!b && !b.hidden && b.offsetParent !== null; }, null, { timeout: 60000 }).then(() => true, () => false);
  const fit = await p.evaluate(() => {
    const el = document.querySelector(".engine-card .put-away");
    const b = el.getBoundingClientRect();
    const c = document.querySelector(".engine-card").getBoundingClientRect();
    const s = document.querySelector(".engine-card .engine-status");
    return { left: b.left, right: b.right, h: b.height, card: [c.left, c.right], vw: innerWidth, status: s.textContent, statusLines: Math.round(s.getBoundingClientRect().height / (1.25 * parseFloat(getComputedStyle(s).fontSize))) };
  });
  check("trap: the held train's card offers Put away, and it fits at 360 px", shown && fit.left >= 0 && fit.right <= fit.vw && fit.right <= fit.card[1] && fit.h >= 40 && fit.statusLines <= 2, JSON.stringify(fit));
  if (!shown) return;
  const n0 = await p.evaluate(() => window.woodrail.sim.trainIds().length);
  const putAway = async () => {
    // (Once the card has settled: its line's part comes in a frame or two after it opens, and the card, held at the
    // bottom, grows up, moving the button. Still over four frames, SwiftShader's slow ones.)
    await p.waitForFunction(() => new Promise((r) => {
      const at = () => JSON.stringify(document.querySelector(".engine-card .put-away").getBoundingClientRect());
      const route = document.querySelector(".engine-card .engine-extra");
      const a = at();
      let n = 0;
      const step = () => (++n < 4 ? requestAnimationFrame(step) : r(at() === a && !!route && !route.hidden));
      requestAnimationFrame(step);
    }), null, { timeout: 60000, polling: 100 });
    const box = await (await p.$(".engine-card .put-away")).boundingBox();
    await tapped(p, () => p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2));
  };
  await putAway();
  const gone = await p.evaluate((E) => ({ on: E.map((e) => !!window.woodrail.sim.findCar(e)), card: !document.querySelector(".engine-card").hidden }), E);
  check("trap: a tap on Put away puts the held train in the box", JSON.stringify(gone.on) === "[true,true,false]" && !gone.card, JSON.stringify(gone));
  // Undo at once (its spot still free): back where it stood.
  await p.keyboard.press("Control+z");
  await frames(p);
  const back = await p.evaluate((e) => ({ n: window.woodrail.sim.trainIds().length, on: !!window.woodrail.sim.findCar(e) }), E[2]);
  check("trap: undo puts it back", back.n === n0 && back.on, JSON.stringify({ n0, ...back }));
  // Away again, from its card: the payoff, the other two deliver (QA's plain 2-train run: 24 goods in 150 s).
  await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), E[2]);
  await p.waitForFunction(() => { const b = document.querySelector(".engine-card .put-away"); return !!b && !b.hidden && b.offsetParent !== null; }, null, { timeout: 60000 });
  await putAway();
  const goods = await p.evaluate(() => window.__run(150));
  check("trap: put away, the other two deliver", goods >= 12, `${goods} goods in 150 s`);
  await p.setViewportSize({ width: 390, height: 844 });
  await frames(p);
}

/**
 * Stuck, and the player's fix (routing §16 Q3: nothing turns a train back short of the end of the track). Two trains on
 * one line head on along single track: a passing loop laid in the middle but for one straight of its side road, so no
 * loop yet. The line has room for one: the second is held at its end, the first comes up to it and stands. Neither
 * turns back: both stand, and the first's card says it's stuck and what to do ("… Put one away or add a loop"), in two
 * lines on a 360 px phone. The player drags the missing straight out of the tray into the gap: the loop is whole, both
 * are let run, they pass at the loop and deliver logs to the sawmill.
 *
 * `lines`: the same, the two trains on two lines (single-line working across lines, sections.ts): neither is held (each
 * line has room for its one train), each waits at its end of the line for the other's, both stuck in each other's way;
 * the first's card says so and that a passing loop lets them pass ("… Add a passing loop here"). The player lays the
 * loop's missing straight from the tray, and the two lines' trains meet at the loop, pass, and both deliver.
 */
async function stuckHeadOn(ctx, p, tapSel, lines = false) {
  const tag = lines ? "stuck-lines" : "stuck";
  await p.keyboard.press("Escape");
  await p.setViewportSize({ width: 360, height: 740 });
  await frames(p);
  const setup = await p.evaluate(async (two) => {
    const w = window.woodrail;
    const { Layout, appendPiece, connectorRef } = await import("/src/track/index.ts");
    const { loopOn } = await import("/src/economy/loop-fixtures.ts");
    const { editLine, joinLine } = await import("/src/game/lines.ts");
    const { frameDistance } = await import("/src/game/camera-director.ts");
    // Harness shortcut (setup, not what's tested): QA's N1 line (a forest, two straights, a passing loop, two straights,
    // a sawmill, a turnback buffer at each end) worked out on a scratch layout and laid in one go, as the player's
    // pieces would be; all but the loop's side straight, which the player lays below.
    const { checkPlacement } = await import("/src/landscape/clearance.ts");
    const L = new Layout();
    const a = L.addPiece("depot-forest", { x: 0, z: 0, heading: 0 });
    appendPiece(L, "buffer-turnback", false, connectorRef(a, 0));
    const chain = (n, from) => { const ids = []; for (let k = 0; k < n; k++) { ids.push(appendPiece(L, "straight-216", false, from)); from = connectorRef(ids[k], 1); } return ids; };
    const west = chain(2, connectorRef(a, 1));
    const loop = loopOn(L, connectorRef(west[1], 1), ["straight-216", "straight-216"], ["straight-216"]);
    const east = chain(2, connectorRef(loop.s2, 0));
    const b = appendPiece(L, "depot-sawmill", false, connectorRef(east[1], 1));
    appendPiece(L, "buffer-turnback", false, connectorRef(b, 1));
    const gap = loop.side[1];
    // (Open, flat ground for the line, anywhere the view can go (`__openGround`), the run turned any of four ways; the
    // gap on the land itself, where the player can lay track: the table past the land's edge may take the rest.)
    const scratch = [...L.pieceIds()].filter((id) => id !== gap);
    let g = null;
    let turn = 0;
    const turned = (q, th) => ({ x: q.x * Math.cos(th) - q.z * Math.sin(th), z: q.x * Math.sin(th) + q.z * Math.cos(th), heading: q.heading + th });
    for (let k = 0; k < 4 && !g; k++) {
      turn = (k * Math.PI) / 2;
      const pts = (id) => { const q = turned(L.getPiece(id).pose, turn); return [0, 54, 108, 162, 216].map((d) => [q.x + d * Math.cos(q.heading), q.z + d * Math.sin(q.heading)]); };
      // (Each piece where it'd go clear, or past the mat's edge (the table); the gap's straight clear, on the land.)
      const ok = (x, z) =>
        [...L.pieceIds()].every((id) => {
          const q = L.getPiece(id);
          const t = turned(q.pose, turn);
          const c = checkPlacement(w.landscape, q.type, q.flipped, { x: x + t.x, z: z + t.z, heading: t.heading }, 0);
          return c.kind === "clear" || (id !== gap && c.reason === "off-mat");
        });
      g = await window.__openGround([...L.pieceIds()].flatMap(pts), { pieceGap: 450, propGap: 350, onLand: pts(gap), ok });
    }
    if (!g) throw new Error("no open ground for the line, its gap on the land");
    const at = (q) => { const t = turned(q, turn); return { x: g.x + t.x, z: g.z + t.z, heading: t.heading }; };
    const gapPiece = { pose: at(L.getPiece(gap).pose) };
    const run = w.editor().placeRun(scratch.map((id) => { const q = L.getPiece(id); return { type: q.type, pose: at(q.pose), y: 0, flipped: q.flipped }; }));
    const real = (id) => run[scratch.indexOf(id)];
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const forest = depot(real(a), "forest");
    const sawmill = depot(real(b), "sawmill");
    // Harness shortcut (setup): the trains put down and joined to one line in code, as the tray and the card's line
    // would; the second comes on a moment after the first, so it's the newest (the one held).
    const put = (piece, s, reversed, next, lineId) => {
      const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: real(piece), pathIndex: 0, reversed, s });
      if (r.kind !== "placed") throw new Error("no room for a train");
      const e = w.sim.getTrain(r.trainId).cars[0].id;
      w.sim.setLever(e, 1);
      const line = lineId === undefined ? editLine(w.economy, e, (st) => st.push({ depotId: forest.id, action: "auto" }, { depotId: sawmill.id, action: "auto" })) : joinLine(w.economy, e, lineId);
      w.economy.routeOf(e).next = next;
      return { e, lineId: line.id };
    };
    const first = put(west[0], 200, false, 1);
    // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of SwiftShader's
    // few frames a second; the forest kept stocked (its logs aren't what's tested). Counts logs unloaded at the sawmill,
    // and each train's arrivals there.
    const { PILE_CAP } = await import("/src/economy/constants.ts");
    const { CARGO } = await import("/src/economy/cargo.ts");
    window.__stuckRun = (secs, E) => {
      let goods = 0;
      const at = {};
      const was = {};
      for (let i = 0; i < secs * 120; i++) {
        const f = w.economy.depot(forest.id);
        if (f && i % 120 === 0) f.piles[CARGO.log.index] = PILE_CAP;
        w.sim.tick();
        w.economy.tick();
        for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === sawmill.id) goods++;
        for (const e of E ?? []) {
          const r = w.economy.routeOf(e);
          const here = !!r?.at && r.stops[r.next % r.stops.length]?.depotId === sawmill.id;
          if (here && !was[e]) at[e] = (at[e] ?? 0) + 1;
          was[e] = here;
        }
      }
      w.invalidate();
      return { goods, at };
    };
    window.__stuckRun(1);
    const second = put(east[0], 200, true, 0, two ? undefined : first.lineId);
    // (What the player's told: the real toasts, recorded on their way.)
    window.__stuckSaid = [];
    // (Wrapped once: a second run's wrapper round the first's would count each toast twice.)
    if (!w.hud.__stuckSaid) {
      const toast = w.hud.toast.bind(w.hud);
      w.hud.toast = (m, ...rest) => (window.__stuckSaid.push(m), toast(m, ...rest));
      w.hud.__stuckSaid = true;
    }
    // Where the gap is: its straight's middle, on the ground.
    const q = gapPiece.pose;
    const mid = { x: q.x + Math.cos(q.heading) * 108, z: q.z + Math.sin(q.heading) * 108, heading: q.heading };
    w.director.glideTo(w.controls.target.clone().set(mid.x, 0, mid.z), frameDistance(1400, w.camera.fov, w.camera.aspect), { duration: 0.3 });
    return { E: [first.e, second.e], mid, c1: real(loop.side[0]), c2: real(loop.side[2]), sawmill: sawmill.id };
  }, lines);
  // A minute on: the second is held for room, the first stands short of it; neither turned back; stalls say so.
  const stood = await p.evaluate(({ E }) => {
    const w = window.woodrail;
    const run = window.__stuckRun(60, E);
    return {
      run,
      speeds: E.map((e) => Math.round(w.sim.findCar(e).train.speed)),
      turns: E.map((e) => w.sim.findCar(e).train.lastTurn?.cause ?? null),
      held: E.map((e) => w.economy.sections.heldForRoom(e)),
      stuck: E.map((e) => w.economy.stalls.stuckOf(e)?.kind ?? null),
    };
  }, setup);
  if (lines) check("stuck-lines: two lines' trains head on, no loop: both stand, neither turns back nor is held, each stuck in the other's way", stood.speeds.every((v) => v === 0) && stood.turns.every((c) => c === null || c === "buffer") && stood.held.every((h) => !h) && stood.stuck.every((k) => k === "in-way") && stood.run.goods === 0, JSON.stringify(stood));
  else check("stuck: two trains head on, one line, no loop: both stand, neither turns back (the second held, the first stuck: too many trains)", stood.speeds.every((v) => v === 0) && stood.turns.every((c) => c === null || c === "buffer") && stood.held[1] && !stood.held[0] && stood.stuck[0] === "too-many" && stood.run.goods === 0, JSON.stringify(stood));
  // Its card, opened by a tap on it: stuck, and what to do, in two lines at 360 px. (Paused while it's read: the game's
  // own frames would run the sim on meanwhile.)
  await p.evaluate(() => {
    window.woodrail.paused = true;
    window.woodrail.invalidate();
  });
  const { tapOn } = mapHelpers(p);
  await tapOn({ engine: setup.E[0] });
  await p.waitForFunction(() => /^Stuck/.test(document.querySelector(".engine-card .engine-status")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
  const card = await p.evaluate(() => {
    const s = document.querySelector(".engine-card .engine-status");
    const one = s.cloneNode(false);
    one.textContent = "Line";
    one.style.visibility = "hidden";
    s.after(one);
    const lh = one.getBoundingClientRect().height;
    one.remove();
    const r = s.getBoundingClientRect();
    return { said: s.textContent, lines: Math.round(r.height / lh), left: r.left, right: r.right, vw: innerWidth };
  });
  const fixSaid = lines ? /^Stuck: (the train on the [A-Za-z]+ line|another train) is in the way\. Add a passing loop here$/.test(card.said) : card.said === "Stuck: too many trains for this line. Put one away or add a loop";
  check(`${tag}: the first's card says it's stuck and the fix, in two lines at 360 px`, fixSaid && card.lines <= 2 && card.left >= 0 && card.right <= card.vw, JSON.stringify(card));
  // (The once-ever head-on tip, if it came with this stall: what works, a passing loop; no signals needed.)
  if (lines) {
    const tips = await p.evaluate(() => window.__stuckSaid.filter((m) => /^Trains met head on/.test(m)));
    check("stuck-lines: the head-on tip, if told, says a passing loop lets trains pass", tips.every((m) => m === "Trains met head on. A passing loop lets trains pass"), JSON.stringify(tips));
  }
  await p.keyboard.press("Escape");
  await p.evaluate(() => {
    window.woodrail.paused = false;
  });
  // The player's fix: the loop's missing straight, dragged out of the tray (the Straight shelf) by touch and let go
  // over the gap, the piece held its lift above the finger (`TOUCH_LIFT_PX`, 56 px). Every CDP event stamped after the
  // last, the touchEnd too.
  const cdp = await ctx.newCDPSession(p);
  let stamp = Date.now() / 1000;
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }], timestamp: (stamp += 0.016) });
  // (The Straight shelf, unless it's open already: left open by the run before, stuck then stuck-lines.)
  if (!(await p.evaluate(() => !!document.querySelector('.scroller .tray-item[data-key="piece:straight-216"]')))) {
    // (Another shelf left open by the run before, the wye's Switch shelf: Back to the shelves first.)
    if (await p.evaluate(() => !document.querySelector(".scroller .tray-group") && !!document.querySelector(".scroller .tray-back"))) {
      await tapSel(".scroller .tray-back");
      await p.waitForFunction(() => document.querySelector(".scroller .tray-group") !== null, null, { timeout: 10000 });
    }
    const index = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-group")].findIndex((b) => b.querySelector(".label")?.textContent === "Straight"));
    await tapSel(`.scroller .tray-group:nth-child(${index + 1 + (await p.evaluate(() => document.querySelectorAll(".scroller > :not(.tray-group)").length))})`);
  }
  const item = await p.evaluate(() => {
    const e = document.querySelector('.scroller .tray-item[data-key="piece:straight-216"]');
    if (!e) return null;
    e.scrollIntoView({ inline: "center" });
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  if (!item) throw new Error("no straight-216 in the Straight shelf");
  // (The view back on the gap, a little above the middle of the screen: opening the card panned to the engine, and a
  // drag near the screen's edge pans the view.)
  await p.evaluate((m) => {
    const w = window.woodrail;
    w.director.glideTo(w.controls.target.clone().set(m.x, 0, m.z), 1200, { duration: 0.2 });
  }, setup.mid);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames(p);
  const target = await p.evaluate((m) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(m.x, 0, m.z).project(w.camera);
    return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight + 56];
  }, setup.mid);
  const before = await p.evaluate(() => {
    const h = window.woodrail.hud;
    window.__dropSaid = [];
    const refuse = h.setRefusal.bind(h);
    h.setRefusal = (m, ...a) => (m && window.__dropSaid.push(m), refuse(m, ...a));
    return window.woodrail.layout.pieceCount;
  });
  await touch("touchStart", item[0], item[1]);
  for (let k = 1; k <= 20; k++) await touch("touchMove", item[0] + ((target[0] - item[0]) * k) / 20, item[1] + ((target[1] - item[1]) * k) / 20);
  // (Held over the gap, the finger nudged as a player's would, by what's seen: the ghost's middle onto the gap's, till
  // it seats there, joined at both ends.)
  let finger = [...target];
  let holding = null;
  for (let k = 0; k < 10; k++) {
    await touch("touchMove", finger[0], finger[1]);
    await frames(p);
    holding = await p.evaluate((m) => {
      const w = window.woodrail;
      const mode = w.interaction.mode;
      if (!mode.pose) return { mode: mode.kind };
      const q = mode.pose;
      const c = { x: q.x + 108 * Math.cos(q.heading), z: q.z + 108 * Math.sin(q.heading) };
      const px = (v) => { const r = new w.camera.position.constructor(v.x, 0, v.z).project(w.camera); return [((r.x + 1) / 2) * innerWidth, ((1 - r.y) / 2) * innerHeight]; };
      return { mode: mode.kind, snap: mode.snap?.kind ?? null, off: Math.hypot(c.x - m.x, c.z - m.z), ghost: px(c), gap: px(m) };
    }, setup.mid);
    if (!holding.ghost) break;
    if (holding.snap === "snapped" && holding.off < 5) break;
    finger = [finger[0] + holding.gap[0] - holding.ghost[0], finger[1] + holding.gap[1] - holding.ghost[1]];
  }
  await touch("touchEnd", 0, 0);
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  await frames(p);
  const laid = await p.evaluate(({ c1, c2 }) => {
    const w = window.woodrail;
    // (The loop whole: the curves either side of the gap each joined at both ends.)
    const joined = (id) => [0, 1].every((c) => w.layout.joinedConnector(id * 8 + c) !== -1);
    return { pieces: w.layout.pieceCount, whole: joined(c1) && joined(c2), said: window.__dropSaid };
  }, setup);
  check(`${tag}: the missing straight dragged from the tray closes the loop`, laid.pieces === before + 1 && laid.whole, JSON.stringify({ before, ...laid, holding, item, target, mid: setup.mid }));
  // With the loop whole the line has room for both: they're let run, pass at the loop and deliver.
  const after = await p.evaluate(({ E }) => {
    const w = window.woodrail;
    const run = window.__stuckRun(240, E);
    return { run, held: E.map((e) => w.economy.sections.heldForRoom(e)), stuck: w.economy.stalls.count, turns: E.map((e) => w.sim.findCar(e).train.lastTurn?.cause ?? null) };
  }, setup);
  check(`${tag}: loop laid, both run, pass at the loop and deliver logs to the sawmill (none stuck)`, after.run.goods >= 4 && setup.E.every((e) => (after.run.at[e] ?? 0) >= 1) && after.held.every((h) => !h) && after.stuck === 0, JSON.stringify(after));
}

async function runMode(mode) {
  const ctx = (openContext = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }));
  // No favourites: the shelves start in the tray's first slot, where Back appears when one opens (under the finger).
  await ctx.addInitScript(() => localStorage.setItem("woodrail.favourites", "[]"));
  // Every click, counted before the game's own listeners (the click shield's included) see it.
  await ctx.addInitScript(() => {
    window.__allClicks = 0;
    window.addEventListener("click", () => window.__allClicks++, { capture: true });
  });
  await ctx.addInitScript(openGroundScript);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(URL);
  // The mode's card on the title screen: its main button (Continue, or the fresh start without a save).
  await p.waitForFunction((m) => !!window.woodrail && document.querySelector(`.title-card.mode-${m} .title-buttons .primary`) !== null, mode, { timeout: 180000 });
  await p.evaluate((m) => document.querySelector(`.title-card.mode-${m} .title-buttons .primary`).click(), mode);
  await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 60000 });
  // A first visit shows the camera tutorial (or, before it, the help over everything): close it as a player would.
  await p.evaluate(() => {
    const help = document.querySelector(".help");
    if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
    document.querySelector(".coach:not([hidden]) .coach-skip")?.click();
  });
  await p.waitForFunction(() => { const h = document.querySelector(".help"); return !h || h.hidden || getComputedStyle(h).display === "none"; }, null, { timeout: 60000 });
  const inGroup = () => p.evaluate(() => document.querySelector(".tray").classList.contains("in-group"));
  const tapOn = async (selector) => {
    // (On a phone the favourites come first: a shelf may be scrolled out of view.)
    await p.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ inline: "center" }), selector);
    await frames(p);
    const el = await p.$(selector);
    if (!el) throw new Error(`no ${selector}`);
    const box = await el.boundingBox();
    await tapped(p, () => p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2));
  };
  for (const shelf of ["Straight", "Curve", "Switch"]) {
    const index = await p.evaluate((name) => [...document.querySelectorAll(".scroller .tray-group")].findIndex((b) => b.querySelector(".label")?.textContent === name), shelf);
    await tapOn(`.scroller .tray-group:nth-child(${index + 1 + (await p.evaluate(() => document.querySelectorAll(".scroller > :not(.tray-group)").length))})`);
    // (`tapOn` waited for the tap's click: the shelf must still be open after it.)
    check(`${mode}: a touch tap on the ${shelf} shelf opens it (and it stays open)`, await inGroup());
    if (!(await inGroup())) continue;
    await tapOn(".scroller .tray-back");
    check(`${mode}: a touch tap on Back goes back to the shelves (and stays there)`, !(await inGroup()));
  }
  /**
   * Each check on its own: one that can't set up, or throws, fails only itself ("<name>: ran to the end") and the run
   * goes on. Then what it laid is taken up (harness shortcut, setup only: the trains on it, then its pieces, places
   * with them), so the small Sandbox map has room for the next, whatever the checks before did.
   */
  const step = async (name, fn) => {
    // (Pieces by type and where they lie: a reload, as some checks make, gives out piece and car ids afresh.)
    const pieceKeys = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()].map((i) => { const q = window.woodrail.layout.getPiece(i); return `${q.type}@${Math.round(q.pose.x)},${Math.round(q.pose.z)}`; }));
    const before = await pieceKeys();
    try {
      await fn();
    } catch (e) {
      check(`${name}: ran to the end`, false, String(e?.message ?? e).split("\n")[0]);
    }
    await p.keyboard.press("Escape");
    const left = await p.evaluate((before) => {
      const w = window.woodrail;
      w.paused = false;
      const key = (i) => { const q = w.layout.getPiece(i); return `${q.type}@${Math.round(q.pose.x)},${Math.round(q.pose.z)}`; };
      const ids = [...w.layout.pieceIds()].filter((i) => !before.includes(key(i))).reverse();
      // Trains standing on what's taken up go first (a train put down on the seed's own track stays).
      for (const id of w.sim.trainIds()) if (w.sim.getTrain(id).bogies.some((b) => ids.includes(b.pieceId))) w.sim.removeTrain(id);
      w.economy.prune();
      // (A piece may hold up another, as points hold their roads: taken up over a few passes.)
      for (let pass = 0; pass < 4; pass++) for (const id of ids) if (w.layout.getPiece(id)) w.editor().remove(id);
      w.invalidate();
      return ids.filter((id) => w.layout.getPiece(id)).length;
    }, before);
    if (left) check(`${name}: what it laid is taken up after`, false, `${left} pieces left`);
  };
  const SANDBOX = { "map-taps": () => mapTaps(p), "select-drag": () => selectThenDrag(ctx, p), redrawn: () => redrawnControl(ctx, p), flick: () => flickOut(ctx, p, tapOn), "lever-pins": () => leverPins(ctx, p), "under-car": () => shortUnderCar(ctx, p), "toast-through": () => toastTapsThrough(p), trap: () => putAwayButton(p), "dead-end": () => deadEndContinue(p), routes: () => twoRoutes(ctx, p), defaults: () => leverDefault(ctx, p), restore: () => routeRestore(ctx, p), wait: () => routeWait(ctx, p), wye: () => wyeLevers(ctx, p, tapOn), stuck: () => stuckHeadOn(ctx, p, tapOn), "stuck-lines": () => stuckHeadOn(ctx, p, tapOn, true), forward: () => forwardRoute(ctx, p) };
  // (E2E_ONLY: one check, or a comma list run in the full run's order, e.g. "routes,defaults,restore".)
  if (mode === "sandbox") {
    const only = ONLY ? ONLY.split(",") : null;
    for (const name of Object.keys(SANDBOX)) if (!only || only.includes(name)) await step(name, SANDBOX[name]);
  }
  await ctx.close();
  openContext = null;
}
check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
