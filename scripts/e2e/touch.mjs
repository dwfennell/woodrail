// End-to-end touch tests on a phone (`npm run e2e:touch`): real touch taps (hasTouch, touchscreen.tap) at 390×844.
// A tap's click lands 10–20 ms after the finger lifts, wherever the finger was: on touch, on whatever a tap's pointerup
// put there (a tray shelf's Back, a card's Delete or Remove). The click shield (src/ui/click-shield.ts) drops it. Starts its own dev server on any free port. Chromium as for e2e:roads.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

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
  await p.waitForFunction(() => !document.querySelector(".piece-card").hidden, null, { timeout: 10000 });
  const [dx, dy] = await rectOf(".piece-card .danger");
  await p.keyboard.press("Escape");
  await placeAt(dx, dy);
  const before = await p.evaluate(() => window.woodrail.layout.pieceCount);
  await tapped(p, () => p.touchscreen.tap(dx, dy));
  const after = await p.evaluate(() => window.woodrail.layout.pieceCount);
  check("a tap on a piece where its card's Delete opens doesn't delete it", after === before, `${before} → ${after} pieces`);
  check("…and its card is open", await visible(".piece-card"));
  await p.keyboard.press("Escape");

  // 2. An engine: where does its card put Remove? Then an engine right there, tapped.
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
  await p.waitForFunction(() => !document.querySelector(".engine-card").hidden, null, { timeout: 10000 });
  const [rx, ry] = await rectOf(".engine-card .danger");
  await p.keyboard.press("Escape");
  await placeAt(rx, ry);
  check("a second engine goes under where Remove opens", (await addEngineAt(rx, ry)) === "placed");
  await settle();
  const trains = () => p.evaluate(() => window.woodrail.sim.trainIds().map((id) => window.woodrail.sim.getTrain(id).cars.map((c) => c.lever).join("")).join("|"));
  const t0 = await trains();
  await tapped(p, () => p.touchscreen.tap(rx, ry));
  const t1 = await trains();
  check("a tap on an engine where its card's Remove opens neither removes nor starts it", t1 === t0, `${t0} → ${t1}`);
  check("…and its card is open", await visible(".engine-card"));
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
  await p.waitForFunction(() => { const h = document.querySelector(".help"); return !h || h.hidden || getComputedStyle(h).display === "none"; }, null, { timeout: 10000 });
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
