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
    const clear = (x, z) =>
      [...w.layout.pieceIds()].every((i) => { const q = w.layout.getPiece(i).pose; return Math.hypot(q.x - x, q.z - z) > 700; }) &&
      [...w.props.all()].every((q) => Math.hypot(q.x - x, q.z - z) > 400);
    for (let r = 0; r <= 6000; r += 216)
      for (let a = 0; a < (r === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * r) / 216))); a++) {
        const x = Math.round(t.x + r * Math.cos((a * 2 * Math.PI) / Math.max(8, Math.round((2 * Math.PI * r) / 216))));
        const z = Math.round(t.z + r * Math.sin((a * 2 * Math.PI) / Math.max(8, Math.round((2 * Math.PI * r) / 216))));
        if (!clear(x, z)) continue;
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
    const clear = (x, z) =>
      [...w.layout.pieceIds()].every((i) => { const q = w.layout.getPiece(i).pose; return Math.hypot(q.x - x, q.z - z) > 700; }) &&
      [...w.props.all()].every((q) => Math.hypot(q.x - x, q.z - z) > 400);
    let r = -1;
    let g = null;
    for (let d = 0; d <= 6000 && r === -1; d += 216) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 216));
      for (let a = 0; a < n && r === -1; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        if (!clear(x, z)) continue;
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
      const posts = it.leversOnScreen().filter((q) => q.id === id);
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
    const clear = (x, z) =>
      [...w.layout.pieceIds()].every((i) => { const q = w.layout.getPiece(i).pose; return Math.hypot(q.x - x, q.z - z) > 700; }) &&
      [...w.props.all()].every((q) => Math.hypot(q.x - x, q.z - z) > 400);
    let g = null;
    for (let d = 0; d <= 6000 && !g; d += 216) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 216));
      for (let a = 0; a < n && !g; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        if ([0, 120, 240, 360, 480].every((dx) => clear(x + dx, z))) g = t.clone().set(x, 0, z);
      }
    }
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

// (E2E_ONLY=dead-end or trap: only the Continue check, or the third-train trap, in Sandbox.)
const ONLY = process.env.E2E_ONLY ?? "";
for (const mode of ONLY ? ["sandbox"] : ["sandbox", "game"]) {
  try {
    await runMode(mode);
  } catch (e) {
    check(`${mode}: ran to the end`, false, String(e?.message ?? e).split("\n")[0]);
  }
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
    const clear = (x, z) =>
      [...w.layout.pieceIds()].every((i) => { const q = w.layout.getPiece(i).pose; return Math.hypot(q.x - x, q.z - z) > 700; }) &&
      [...w.props.all()].every((q) => Math.hypot(q.x - x, q.z - z) > 400);
    let g = null;
    for (let d = 0; d <= 8000 && !g; d += 216) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 216));
      for (let a = 0; a < n && !g; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        if ([0, 400, 800, 1200, 1600].every((dx) => clear(x + dx, z))) g = t.clone().set(x, 0, z);
      }
    }
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
    // (Open ground for the line, found outward from the view's target.)
    const t = w.controls.target;
    const clear = (x, z) =>
      [...w.layout.pieceIds()].every((i) => { const q = w.layout.getPiece(i).pose; return Math.hypot(q.x - x, q.z - z) > 900; }) &&
      [...w.props.all()].every((q) => Math.hypot(q.x - x, q.z - z) > 500);
    let g = null;
    for (let d = 0; d <= 12000 && !g; d += 216) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 216));
      for (let a = 0; a < n && !g; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        if ([0, 500, 1000, 1500, 2000, 2500].every((dx) => clear(x + dx, z) && clear(x + dx, z + 300))) g = { x, z };
      }
    }
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
    return { E: [first.e, second.e, third.e], forest: forest.id, sawmill: sawmill.id, lineId: first.lineId };
  });
  // The toast, said as the third came on: once, in the line's numbers, and it fits a 360 px phone.
  await p.waitForFunction(() => document.querySelector(".toast")?.classList.contains("show"), null, { timeout: 60000 }).catch(() => {});
  const toast = await p.evaluate(() => {
    const t = document.querySelector(".toast");
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    const lh = parseFloat(cs.lineHeight) || 1.25 * parseFloat(cs.fontSize);
    return { said: window.__trapSaid.filter((m) => /^This line has room/.test(m)), shown: t.textContent, left: r.left, right: r.right, lines: Math.round((r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh), vw: innerWidth };
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
  await p.evaluate(async ({ forest, sawmill }) => {
    const w = window.woodrail;
    const { PILE_CAP } = await import("/src/economy/constants.ts");
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

async function runMode(mode) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  // No favourites: the shelves start in the tray's first slot, where Back appears when one opens (under the finger).
  await ctx.addInitScript(() => localStorage.setItem("woodrail.favourites", "[]"));
  // Every click, counted before the game's own listeners (the click shield's included) see it.
  await ctx.addInitScript(() => {
    window.__allClicks = 0;
    window.addEventListener("click", () => window.__allClicks++, { capture: true });
  });
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
  if (mode === "sandbox" && ONLY === "dead-end") await deadEndContinue(p);
  else if (mode === "sandbox" && ONLY === "trap") await putAwayButton(p);
  else if (mode === "sandbox") {
    await mapTaps(p);
    await selectThenDrag(ctx, p);
    await redrawnControl(ctx, p);
    await flickOut(ctx, p, tapOn);
    await leverPins(ctx, p);
    await shortUnderCar(ctx, p);
    await toastTapsThrough(p);
    await putAwayButton(p);
    await deadEndContinue(p);
  }
  await ctx.close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
