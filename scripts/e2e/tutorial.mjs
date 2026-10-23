// End-to-end first-run camera tutorial (`npm run e2e:tutorial`): on a first visit to Game mode the coach shows in
// place of the help card; each step ticks off when the player does it (a drag, the wheel and keys on a desktop; a finger on a
// phone, the hints switching to fingers); its last card leads into the goals (Show me lights up); it's not shown
// again; "Show controls" in the menu brings it back; "Skip tutorial" closes it. It keeps off the middle of the map at
// 360×740, 667×375 and 1280×800. Starts its own dev server on any free port. Chromium as for e2e:roads.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const OUT = process.env.SHOTS;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];

/** A fresh profile into Game mode (nothing seen: no help, no tutorial). */
async function firstVisit(ctx) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(URL);
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-game .title-buttons .primary") !== null, null, { timeout: 180000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary").click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown, null, { timeout: 120000 });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  return p;
}
const coach = (p) =>
  p.evaluate(() => {
    const c = document.querySelector(".coach");
    if (!c || c.hidden) return null;
    return { title: c.querySelector(".coach-text b")?.textContent ?? "", text: c.querySelector(".coach-text span")?.textContent ?? "", done: c.querySelectorAll(".dot.done").length, touch: !!c.querySelector(".coach-art.touch") };
  });
const helpShown = (p) => p.evaluate(() => !document.querySelector(".help").hidden);
const settle = (p) => p.evaluate(() => new Promise((r) => { const w = window.woodrail; let last = "", same = 0; const t = () => { const c = w.camera.position; const k = `${c.x.toFixed(1)},${c.y.toFixed(1)},${c.z.toFixed(1)}`; same = k === last ? same + 1 : 0; last = k; if (same > 6) r(); else requestAnimationFrame(t); }; requestAnimationFrame(t); }));
/** The coach's box, and whether it covers the middle of the screen. */
const box = (p) =>
  p.evaluate(() => {
    const r = document.querySelector(".coach").getBoundingClientRect();
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    return { r: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], middle: cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom, onScreen: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
  });
/** Do `act` again till `n` steps are done (headless frames come slowly, so a held key covers less ground), 12 at most. */
const until = async (p, n, act) => {
  for (let k = 0; k < 12 && ((await coach(p))?.done ?? 99) < n; k++) await act();
};
const hold = async (p, key, ms) => {
  await p.keyboard.down(key);
  await new Promise((r) => setTimeout(r, ms));
  await p.keyboard.up(key);
  await settle(p);
};

// ---- desktop: keys and the wheel ----
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await firstVisit(ctx);
  const c0 = await coach(p);
  check("a first visit shows the camera tutorial, not the help card", !!c0 && !(await helpShown(p)) && /Move around/.test(c0.title) && !c0.touch, JSON.stringify(c0));
  const b0 = await box(p);
  check("1280×800: it keeps off the middle of the map", b0.onScreen && !b0.middle, JSON.stringify(b0));
  if (OUT) await p.screenshot({ path: `${OUT}/coach-1280.png` });
  // A camera change that isn't the player's (a glide) doesn't count.
  await p.evaluate(() => { const w = window.woodrail; const t = w.controls.target; w.director.glideTo(t.clone().setX(t.x + 600), w.camera.position.distanceTo(t), { duration: 0.2 }); });
  await settle(p);
  check("a glide (not the player) doesn't tick a step", (await coach(p))?.done === 0, JSON.stringify(await coach(p)));
  await p.mouse.move(640, 400);
  // (A left drag pans. Held keys pan too, by time: a frame a second in headless software GL covers too little to test.)
  await until(p, 1, async () => {
    await p.mouse.move(800, 420);
    await p.mouse.down();
    await p.mouse.move(480, 380, { steps: 12 });
    await p.mouse.up();
    await settle(p);
  });
  const c1 = await coach(p);
  check("a left drag ticks Move; Zoom is next", c1?.done === 1 && /Zoom/.test(c1.title), JSON.stringify(c1));
  await until(p, 2, async () => {
    await p.mouse.wheel(0, 200);
    await settle(p);
  });
  const c2 = await coach(p);
  check("the wheel ticks Zoom; Turn is next", c2?.done === 2 && /Turn/.test(c2.title), JSON.stringify(c2));
  // (A right-drag turns and tilts by how far it goes. Q and E, R and F do it by time, a held key's turn at most a tenth
  // of a second a frame: software GL here draws a frame every few seconds, too few for them; QA checks the keys.)
  const rightDrag = async (dx, dy) => {
    await p.mouse.move(640, 400);
    await p.mouse.down({ button: "right" });
    await p.mouse.move(640 + dx, 400 + dy, { steps: 10 });
    await p.mouse.up({ button: "right" });
    await settle(p);
  };
  await until(p, 3, () => rightDrag(220, 0));
  const c3 = await coach(p);
  check("a right-drag sideways ticks Turn; Tilt is next", c3?.done === 3 && /Tilt/.test(c3.title), JSON.stringify(c3));
  // (Up, then down: whichever way it can still go.)
  for (const dy of [-120, 120]) await until(p, 4, () => rightDrag(0, dy));
  const c4 = await coach(p);
  check("a right-drag up or down ticks Tilt: the last card leads into the goals", c4?.done === 4 && /That's the camera/.test(c4.title) && /Show me/.test(c4.text), JSON.stringify(c4));
  await p.evaluate(() => document.querySelector(".coach .coach-go").click());
  const nudged = await p.evaluate(() => !!document.querySelector(".goals-show-icon.nudge"));
  check("Let's play closes it, and Show me lights up", !(await coach(p)) && nudged, `nudge ${nudged}`);
  await p.reload();
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-game .title-buttons .primary") !== null, null, { timeout: 180000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary").click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown, null, { timeout: 120000 });
  check("not shown again on this device (nor the help card)", !(await coach(p)) && !(await helpShown(p)));
  await p.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].find((b) => b.textContent === "Show controls").click());
  const again = await coach(p);
  await p.evaluate(() => document.querySelector(".coach .coach-skip").click());
  check("“Show controls” in the menu brings it back; Skip tutorial closes it", !!again && again.done === 0 && !(await coach(p)), JSON.stringify(again));
  // QA's notes (tutorial-2).
  const showControls = () => p.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].find((b) => b.textContent === "Show controls").click());
  await showControls();
  const look = await p.evaluate(() => {
    const c = document.querySelector(".coach");
    const caps = [...c.querySelectorAll(".coach-art.move kbd")].map((k) => { const r = k.getBoundingClientRect(); return { k: k.textContent, x: Math.round(r.x), y: Math.round(r.y) }; });
    const anims = [...c.querySelectorAll(".coach-art, .coach-art *")].map((e) => getComputedStyle(e)).filter((st) => st.animationName !== "none").map((st) => st.animationIterationCount);
    return { focused: document.activeElement === c, caps, anims };
  });
  const [W, A, S, D] = look.caps;
  check("W sits over A S D, as on a keyboard (QA)", !!D && W.y < A.y && A.y === S.y && S.y === D.y && A.x < S.x && S.x < D.x && Math.abs(W.x - S.x) <= 1, JSON.stringify(look.caps));
  check("its pictures move a few times, not for ever (QA)", look.anims.length > 0 && look.anims.every((n) => n !== "infinite" && Number(n) <= 4), JSON.stringify(look.anims));
  check("focus goes into it (a dialog)", look.focused);
  // A toast that comes while it's up waits, and shows once it's closed.
  await p.evaluate(() => window.woodrail.hud.toast("A toast while the coach is up"));
  const during = await p.evaluate(() => document.querySelector(".toast").classList.contains("show"));
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => document.querySelector(".toast").classList.contains("show") && document.querySelector(".toast").textContent === "A toast while the coach is up", null, { timeout: 10000 }).catch(() => {});
  const after = await p.evaluate(() => document.querySelector(".toast").classList.contains("show") && document.querySelector(".toast").textContent);
  check("Esc closes it (QA); a toast raised while it was up waited, and shows now", !(await coach(p)) && !during && after === "A toast while the coach is up", `during: ${during}; after: ${after}`);
  // How to play while it's up: the help card only, not both.
  await showControls();
  await p.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].find((b) => b.textContent === "How to play").click());
  check("“How to play” while it's up shows the help card instead, not both (QA)", !(await coach(p)) && (await helpShown(p)));
  await ctx.close();
}

// ---- a phone: a finger; held upright and on its side ----
for (const [w, h] of [[360, 740], [667, 375]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await firstVisit(ctx);
  const c0 = await coach(p);
  const b0 = await box(p);
  if (OUT) await p.screenshot({ path: `${OUT}/coach-${w}x${h}.png` });
  check(`${w}×${h}: the tutorial shows with the fingers' hints, off the middle of the map`, !!c0 && c0.touch && /one finger/.test(c0.text) && b0.onScreen && !b0.middle, `${JSON.stringify(c0)} ${JSON.stringify(b0)}`);
  if (w === 360) {
    // One finger across the map: Move ticks.
    const cdp = await ctx.newCDPSession(p);
    const [sx, sy] = [w * 0.8, h * 0.4];
    await until(p, 1, async () => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1 }] });
      for (let k = 1; k <= 14; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: sx - k * 16, y: sy + k * 3, id: 1 }] });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await settle(p);
    });
    const c1 = await coach(p);
    check("a one-finger drag ticks Move; Zoom says pinch", c1?.done === 1 && /Pinch/.test(c1.text), JSON.stringify(c1));
    const tb = await p.evaluate(() => { const r = document.querySelector(".coach .coach-skip").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await p.touchscreen.tap(tb[0], tb[1]);
    await settle(p);
    check("Skip tutorial (a tap) closes it", !(await coach(p)) && !(await helpShown(p)));
  }
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
