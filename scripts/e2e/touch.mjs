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
  const drag = async (x, y, dx) => {
    await touch("touchStart", x, y);
    let mid = "";
    for (let k = 1; k <= 12; k++) {
      await touch("touchMove", x + (dx * k) / 12, y);
      if (k === 6) mid = await p.evaluate(() => window.woodrail.interaction.mode.kind);
    }
    await touch("touchEnd", 0, 0);
    await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
    return mid;
  };
  await p.keyboard.press("Escape");
  // A long straight across the middle of the screen.
  const id = await p.evaluate(async () => {
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const g = w.interaction.groundAt(195, 360);
    return w.editor().place("straight-216", poseForCentre("straight-216", false, g.x, g.z, 0), 0, false);
  });
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
  // 1. Not selected: the drag pans, the piece stays.
  const a0 = await where();
  let [sx, sy] = await onScreen();
  const aMid = await drag(sx, sy, -120);
  const a1 = await where();
  check("a drag that starts on an unselected piece pans the view", aMid === "idle" && (a1.view[0] !== a0.view[0] || a1.view[1] !== a0.view[1]), `mid-drag ${aMid}, view ${a0.view} → ${a1.view}`);
  check("…and leaves the piece where it was", JSON.stringify(a1.piece) === JSON.stringify(a0.piece), `piece ${a0.piece} → ${a1.piece}`);
  // 2. Tapped (selected), then dragged: it moves.
  [sx, sy] = await onScreen();
  await p.touchscreen.tap(sx, sy);
  await p.waitForFunction(() => !document.querySelector(".piece-card").hidden, null, { timeout: 60000 });
  // (A short drag along the piece's own line, so it lands where it can go.)
  const bMid = await drag(sx, sy, -40);
  check("tap a piece to select it, then a drag picks it up and moves it", bMid === "drag-piece", `mid-drag ${bMid}`);
  await p.keyboard.press("Escape");
  // 2b. Long-press to pick up: let go of it first (nothing selected), then a finger resting on it picks it up into a drag.
  await p.keyboard.press("Escape");
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  /** Touch down at (x, y), rest `ms` (with a 3 px wobble), maybe put a second finger down, then report the mode. */
  // (The mode is read in the page, `ms` after the finger came down by the page's own clock: a slow machine's round
  // trips mustn't stretch a short press into a long one.)
  const holdAt = async (x, y, ms, second = false) => {
    await p.evaluate(() => window.addEventListener("pointerdown", () => (window.__downAt = performance.now()), { capture: true, once: true }));
    await touch("touchStart", x, y);
    await touch("touchMove", x + 3, y + 2);
    if (second) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x + 3, y: y + 2, id: 1 }, { x: x + 80, y: y + 40, id: 2 }] });
    // (A hold is taken up a frame after its time: let a frame or two by, unless checking that a short press isn't one.)
    return p.evaluate(([ms, frames]) => new Promise((r) => setTimeout(() => {
      const read = () => r(window.woodrail.interaction.mode.kind);
      if (!frames) return read();
      requestAnimationFrame(() => requestAnimationFrame(read));
    }, Math.max(0, window.__downAt + ms - performance.now()))), [ms, ms >= 380]);
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
  check("a long press on an unselected piece picks it up", held === "drag-piece", `after 520 ms: ${held}`);
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
  [sx, sy] = await onScreen();
  await touch("touchStart", sx, sy);
  await new Promise((r) => setTimeout(r, 520));
  let hMid = "";
  for (let k = 1; k <= 12; k++) {
    await touch("touchMove", sx - (40 * k) / 12, sy);
    if (k === 6) hMid = await p.evaluate(() => window.woodrail.interaction.mode.kind);
  }
  await lift();
  check("held, then dragged: it moves with the finger", hMid === "drag-piece", `mid-drag ${hMid}`);
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
  // 2c. Drawing on: a finger resting on a piece neither picks it up nor starts a line.
  await p.evaluate(() => window.woodrail.interaction.setDrawing(true));
  [sx, sy] = await onScreen();
  const pieces0 = await p.evaluate(() => window.woodrail.layout.pieceCount);
  const drawHold = await holdAt(sx, sy, 520);
  await lift();
  const pieces1 = await p.evaluate(() => window.woodrail.layout.pieceCount);
  check("drawing on: a long press on a piece doesn't pick it up or draw", drawHold !== "drag-piece" && pieces1 === pieces0, `after 520 ms: ${drawHold}; pieces ${pieces0} → ${pieces1}`);
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
      const piece = w.layout.getPiece(id);
      const v = new w.camera.position.constructor(piece.pose.x, piece.y + 10, piece.pose.z).project(w.camera);
      return { id, x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    }
    return null;
  });
  await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  if (shop) {
    const shopHold = await holdAt(shop.x, shop.y, 520);
    await lift();
    check("a long press on a placed workshop picks it up", shopHold === "drag-piece", `after 520 ms: ${shopHold}`);
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
  await new Promise((r) => setTimeout(r, 1500));
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

for (const mode of ["sandbox", "game"]) {
  try {
    await runMode(mode);
  } catch (e) {
    check(`${mode}: ran to the end`, false, String(e?.message ?? e).split("\n")[0]);
  }
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
  // A first visit shows the help over everything: close it as a player would.
  await p.evaluate(() => {
    const help = document.querySelector(".help");
    if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
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
  if (mode === "sandbox") {
    await mapTaps(p);
    await selectThenDrag(ctx, p);
    await redrawnControl(ctx, p);
  }
  await ctx.close();
}
check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
