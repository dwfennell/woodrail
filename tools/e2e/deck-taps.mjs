// End-to-end taps on a turntable's deck (QA, kit-signals): real touch taps at 390×844 in Sandbox, an engine standing
// still on the deck. A tap on the deck turns it (never picks the turntable up), wherever on the deck it lands, the
// engine's middle included; a tap on an engine on ordinary track still takes the engine; a turntable with a train on
// it isn't picked up by a drag.
// Usage: node tools/e2e/deck-taps.mjs. Starts its own dev server. Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((b) => !b.hidden && b.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();

// Every toast, and the interaction's mode after each pointer event.
await p.evaluate(() => {
  const w = window.woodrail;
  w.__toasts = [];
  const toast = w.hud.toast.bind(w.hud);
  w.hud.toast = (m, ...rest) => (w.__toasts.push(m), toast(m, ...rest));
  const refuse = w.hud.refuse.bind(w.hud);
  w.hud.refuse = (m, ...rest) => (w.__toasts.push(m), refuse(m, ...rest));
  w.__events = [];
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"])
    window.addEventListener(type, (e) => setTimeout(() => w.__events.push(`${type}@${e.timeStamp.toFixed(0)} → ${w.interaction.mode.kind}`)));
});

// A turntable on clear ground in the middle of the screen, close in; an engine standing on its deck.
const setup = await p.evaluate(async (frame) => {
  const w = window.woodrail;
  const { frameDistance } = await import("/src/game/camera-director.ts");
  const { poseForCentre } = await import("/src/editor/editor.ts");
  const { nearestCursor } = await import("/src/sim/nearest.ts");
  for (let ring = 0; ring < 12; ring++)
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const x = Math.round((Math.cos(a) * ring * 400) / 18) * 18;
      const z = Math.round((Math.sin(a) * ring * 400) / 18) * 18;
      const id = w.editor().place("kit-turntable", poseForCentre("kit-turntable", false, x, z, 0), 0, false);
      if (id === -1 || id === undefined || id === null) continue;
      await w.kitView.load("kit-turntable");
      w.syncKits(true);
      const centre = { x, y: 0, z };
      w.director.glideTo(new w.camera.position.constructor(x, 0, z), frameDistance(frame, w.camera.fov, w.camera.aspect), { duration: 0.2 });
      const near = nearestCursor(w.layout, x, z, 60, 0);
      const r = near && w.sim.addTrainAround(["engine"], near.cursor);
      w.invalidate();
      return { id, centre, train: r?.kind ?? "no track" };
    }
  return null;
}, Number(process.env.FRAME ?? 260));
check("a turntable goes down, an engine on its deck", !!setup && setup.train === "placed", JSON.stringify(setup));
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
await settle();

/** Screen point of a spot `along` mm from the turntable's centre, along its deck (the way it lies now). */
const deckPoint = (along) =>
  p.evaluate(
    ([id, along]) => {
      const w = window.woodrail;
      const piece = w.layout.getPiece(id);
      const st = w.layout.switchState(id) % 4;
      const h = piece.pose.heading + Math.PI + (st * Math.PI) / 4;
      // The centre is 92 along from the first end: the piece's pose is that end.
      const cx = piece.pose.x + 92 * Math.cos(piece.pose.heading);
      const cz = piece.pose.z + 92 * Math.sin(piece.pose.heading);
      const v = new w.camera.position.constructor(cx + along * Math.cos(h), piece.y + 8, cz + along * Math.sin(h)).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height, st];
    },
    [setup.id, along],
  );
const state = () =>
  p.evaluate((id) => {
    const w = window.woodrail;
    const t = w.sim.trainIds().map((i) => w.sim.getTrain(i));
    return { mode: w.interaction.mode.kind, deck: w.layout.switchState(id), lifted: !w.layout.getPiece(id) || w.layout.isLifted?.(id), derailed: t.some((x) => x.derailed), selected: w.interaction.selectedPiece, car: w.interaction.selectedCar };
  }, setup.id);
// (Selected, its card opens and the view may glide to keep the piece clear of it: let that finish.)
const select = async () => {
  await p.evaluate((id) => window.woodrail.interaction.selectPiece(id), setup.id);
  await new Promise((r) => setTimeout(r, 400));
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
};
/** The view still: no glide running (`director.busy`), and the frames after it drawn. */
const still = async () => {
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await settle();
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
};
/**
 * A screen point (`[x, y, ...]` from `at`) worked out once the view is still and staying still: re-projected until two
 * looks 300 ms apart agree (a card opening can start a glide a moment after a selection), just before the tap.
 */
const steady = async (at) => {
  for (let k = 0; ; k++) {
    await still();
    const a = await at();
    await new Promise((r) => setTimeout(r, 300));
    const b = await at();
    if (k >= 20 || (Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) < 1)) return b;
  }
};
const clear = () => p.evaluate(() => { window.woodrail.__toasts = []; window.woodrail.__events = []; });
const report = () => p.evaluate(() => ({ toasts: window.woodrail.__toasts, events: window.woodrail.__events }));
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y, timestamp) => cdp.send("Input.dispatchTouchEvent", { type, ...(timestamp ? { timestamp } : {}), touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });

async function tapCase(name, along, how) {
  await select();
  await still();
  const [x, y] = await steady(() => deckPoint(along));
  const before = await state();
  await clear();
  await how(x, y);
  await settle();
  await new Promise((r) => setTimeout(r, 300));
  const after = await state();
  const rep = await report();
  check(`${name}: not picked up`, after.mode === "idle" && !after.derailed, `${JSON.stringify(after)} ${JSON.stringify(rep)}`);
  check(`${name}: the deck turned`, after.deck !== before.deck, `deck ${before.deck} → ${after.deck}; toasts ${JSON.stringify(rep.toasts)}`);
  // Let the deck finish turning (and the engine ride round) before the next tap.
  await p.waitForFunction((id) => !window.woodrail.sim.deckRefusal(id), setup.id, { timeout: 60000 });
}
if (process.env.PROBE) {
  for (const a of [-90, -80, -60, -40, 0, 40, 60, 70, 80, 86, 90]) {
    const [x, y] = await deckPoint(a);
    console.log(a, Math.round(x), Math.round(y), JSON.stringify(await p.evaluate(([x, y]) => [window.woodrail.interaction.pickExact(x, y), window.woodrail.interaction.pick(x, y, true)], [x, y])));
  }
}

// 1. Playwright's tap on the deck's free end, and on the engine's middle (2).
await tapCase("tap on the deck's free end", Number(process.env.ALONG ?? 78), (x, y) => p.touchscreen.tap(x, y));
await tapCase("tap on the deck where the engine stands", 0, (x, y) => p.touchscreen.tap(x, y));
// A finger's tap: down, a wobble of 8 px, up 62 ms after (stamped), delivered late after a slow frame.
await tapCase("a 62 ms tap with an 8 px wobble", 78, async (x, y) => {
  const t = Date.now() / 1000;
  await touch("touchStart", x, y, t);
  await touch("touchMove", x + 6, y + 5, t + 0.03);
  await touch("touchEnd", 0, 0, t + 0.062);
});
await tapCase("a 62 ms tap on the engine, delivered late", 0, async (x, y) => {
  const t = Date.now() / 1000;
  await touch("touchStart", x, y, t);
  await p.evaluate(() => { const t0 = performance.now(); while (performance.now() - t0 < 600); });
  await touch("touchEnd", 0, 0, t + 0.062);
});

// A drag that starts on the selected turntable, train on it: not picked up.
{
  await select();
  await still();
  const [x, y] = await steady(() => deckPoint(78));
  await clear();
  await touch("touchStart", x, y);
  let mid = "";
  for (let k = 1; k <= 10; k++) {
    await touch("touchMove", x + 6 * k, y);
    if (k === 6) mid = (await state()).mode;
  }
  await touch("touchEnd", 0, 0);
  await settle();
  const after = await state();
  const rep = await report();
  check("a drag on a turntable with a train on it doesn't pick it up", mid !== "drag-piece" && !after.derailed, `mid ${mid}; ${JSON.stringify(after)}; toasts ${JSON.stringify(rep.toasts)}`);
}

// The turntable not selected: a tap on the engine standing on it takes the engine (its card, to drive it off).
{
  await p.evaluate(() => window.woodrail.interaction.clearSelection());
  // (The card closing may glide the view back: project the point only once it's still.)
  await still();
  const [x, y] = await steady(() => deckPoint(0));
  const before = await state();
  await p.touchscreen.tap(x, y);
  await settle();
  const after = await state();
  check("not selected, a tap on the engine on the deck takes the engine", after.car !== -1 && after.deck === before.deck, JSON.stringify(after));
}

// An engine on ordinary track: a tap takes the engine, as ever.
{
  await still();
  const at = await p.evaluate(async () => {
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const { nearestCursor } = await import("/src/sim/nearest.ts");
    w.interaction.clearSelection();
    // Above the turntable on screen, wherever the view is now.
    const g = w.interaction.groundAt(195, 240);
    const x = Math.round(g.x / 18) * 18, z = Math.round(g.z / 18) * 18;
    const id = w.editor().place("straight-216", poseForCentre("straight-216", false, x, z, 0), 0, false);
    const near = nearestCursor(w.layout, x, z, 60, 0);
    const r = near && w.sim.addTrainAround(["engine"], near.cursor);
    w.invalidate();
    return { id, r: r?.kind, x, z };
  });
  // Clearing the selection may start a glide: the engine's screen point is worked out only once the view is still,
  // just before the tap (a point projected mid-glide misses).
  const [sx, sy] = await steady(() =>
    p.evaluate(({ x, z }) => {
      const w = window.woodrail;
      const v = new w.camera.position.constructor(x, 30, z).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    }, at),
  );
  const pt = { sx, sy };
  Object.assign(at, pt);
  await p.touchscreen.tap(at.sx, at.sy);
  await settle();
  const s = await state();
  check("a tap on an engine on ordinary track selects it", s.car !== -1 && s.mode === "idle", JSON.stringify({ at, s }));
}

console.log(errors.length ? `page errors: ${errors.join("; ")}` : "no page errors");
await b.close();
await server.close();
process.exit(failures || errors.length ? 1 : 0);
