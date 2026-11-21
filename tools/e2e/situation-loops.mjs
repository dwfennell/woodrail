// End-to-end: situation help, step 3 (docs/superpowers/specs/2026-11-18-situation-help.md, detector #4): two lines'
// trains nose to nose on single track, where a passing loop is the fix, in Game mode on a 390×844 phone with touch.
//
// Setup (named shortcuts, none of them what's tested): a flat map by its code; Switches, Routes and Signals learned; the
// tutorial's goals done and the clock past a game's first minutes; laid by the editor, ⊐ forest ══ × 4 ══ (a passing
// loop, its side road a straight short) ══ × 4 ══ sawmill ⊏, a timber train of the Red line at the forest end bound for
// the sawmill and one of the Blue line at the sawmill end bound for the forest. Then, on the game's own clock (8×):
//   1. They meet and stop nose to nose: the tip comes by itself ("Trains are stuck nose to nose").
//   2. The row: "Trains can't pass", "A passing loop in the middle lets them pass", and Learn more about passing loops,
//      the new Passing loops sheet (three sections, each with its picture).
//   3. Show where: both trains in view.
//   4. The fix, the player's way: a Long straight dragged by touch from the tray into the loop's gap, joined at both
//      ends.
//   5. The payoff: "✓ They pass now", neither train stuck, logs carried; done for this game.
// Pictures: situation-loops-1-toast.jpg, -2-row.jpg, -2-sheet.jpg, -3-show-where.jpg, -4-held.jpg, -5-fixed.jpg.
//
// Usage: npm run e2e:situation-loops [-- <out dir>]   (default out: e2e-out/situation-loops)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/situation-loops";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5445, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks and industries held still: this counts idle frames. Game time at 8× real time: the suite waits on trains.)
pinClocksIn(b);
stillIndustriesIn(b);
testClockIn(b, { speed: 8 });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  window.__allClicks = 0;
  window.addEventListener("click", () => window.__allClicks++, { capture: true });
});
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/situation-loops-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapAt = (x, y) => tapped(() => p.touchscreen.tap(x, y));
const box = (sel) =>
  p.evaluate((sel) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, w: e.offsetWidth, h: e.offsetHeight, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, sel);
const tapSel = async (sel) => {
  const at = await box(sel);
  if (at) await tapAt(at.cx, at.cy);
  return !!at;
};
const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y ?? 0, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
const sim = () => p.evaluate(() => window.woodrail.simSeconds);
/** Wait (on wall time, `ms` at most) for the page's `fn(arg)` to hold. */
const until = (fn, arg, ms) => p.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true, () => false);
const toastText = () => p.evaluate(() => document.querySelector(".toast.show")?.textContent ?? "");
const idleFrames = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    const n0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    return w.framesDrawn - n0;
  });
/** Paused or not, by the top bar's Pause button (not what's tested). */
const pause = async (on) => {
  if ((await p.evaluate(() => window.woodrail.paused)) !== on) await tapSel('.actions button[aria-label^="Pause"]');
  if ((await p.evaluate(() => window.woodrail.paused)) !== on) await p.keyboard.press("Space");
  await frames();
};

// A new game, on a flat map with no water (its code in the seed box): room for the long line.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-seed", { timeout: 30000 });
await p.evaluate(() => {
  const box = document.querySelector(".new-game-sheet:not([hidden]) .new-game-seed");
  box.value = "4242-flat-water-none-nocoast";
  box.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".new-game-sheet:not([hidden]) .new-game-start").click();
});
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// ---- Setup (shortcuts: see the header) ---------------------------------------------------------------------------
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  w.paused = true;
  for (const id of ["switches", "routes", "signals"]) w.learn(id);
  const { GOALS } = await import("/src/game/goals.ts");
  // (The tutorial's goals marked done, by the tracker's own set: situation tips wait till the tutorial's over.)
  const tracker = w.goals();
  const open = GOALS.findIndex((g) => g.id === "build-bridge");
  for (const g of GOALS.slice(0, open)) tracker.done.add(g.id);
  // (Past a game's first two minutes, when no tip is said.)
  w.simSeconds = Math.max(w.simSeconds, 150);
  const { Layout, appendPiece, connectorRef } = await import("/src/track/index.ts");
  const { chain, loopOn } = await import("/src/economy/loop-fixtures.ts");
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
  const { startLine } = await import("/src/game/lines.ts");
  // ⊐ forest ══ × 4 ══ (loop, its side road a straight short) ══ × 4 ══ sawmill ⊏ (src/routing/situation-loop.test.ts).
  const scratch = new Layout();
  const S = "straight-216";
  const [a, ...wl] = chain(scratch, ["depot-forest", S, S, S, S]);
  appendPiece(scratch, "buffer-turnback", false, connectorRef(a, 0));
  const l = loopOn(scratch, connectorRef(wl[3], 1), [S, S], [S]);
  const e = chain(scratch, [S, S, S, S, "depot-sawmill"], connectorRef(l.s2, 0));
  appendPiece(scratch, "buffer-turnback", false, connectorRef(e[4], 1));
  const gapId = l.side[1];
  const ids = [...scratch.pieceIds()].filter((i) => i !== gapId);
  const t = w.world.landscape.towns[0].centre;
  const ok = (x, z) => {
    if (w.landscape.grid.cellAtWorld(x, z) === -1) return false;
    for (const i of w.layout.pieceIds()) {
      const q = w.layout.getPiece(i).pose;
      if (Math.hypot(q.x - x, q.z - z) <= 400) return false;
    }
    return [0, Math.PI / 2].some((h) => checkPlacement(w.landscape, S, false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
  };
  const rot = (r, x, z) => [x * Math.cos(r) - z * Math.sin(r), x * Math.sin(r) + z * Math.cos(r)];
  const all = [...ids, gapId];
  let g = null;
  for (let d = 0; d < 16000 && !g; d += 108) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / 108));
    for (let k = 0; k < n && !g; k++)
      for (const r of [0, Math.PI / 2]) {
        const x = Math.round(t.x + d * Math.cos((k * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((k * 2 * Math.PI) / n));
        if (all.every((i) => { const q = scratch.getPiece(i).pose; const [dx, dz] = rot(r, q.x, q.z); return ok(x + dx, z + dz); })) {
          g = { x, z, r };
          break;
        }
      }
  }
  if (!g) return { error: "no ground for the line" };
  const place = (i) => {
    const q = scratch.getPiece(i);
    const [dx, dz] = rot(g.r, q.pose.x, q.pose.z);
    return { type: q.type, pose: { x: dx + g.x, z: dz + g.z, heading: q.pose.heading + g.r }, y: 0, flipped: q.flipped };
  };
  const placed = w.editor().placeRun(ids.map(place));
  const at = (i) => placed[ids.indexOf(i)];
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const A = depot(at(a), "forest").id;
  const B = depot(at(e[4]), "sawmill").id;
  // Two lines' trains, one each way along the single line: Red from the forest end for the sawmill, Blue the other way.
  const engines = [
    [at(wl[0]), false],
    [at(e[1]), true],
  ].map(([pieceId, reversed]) => {
    const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed });
    if (r.kind !== "placed") throw new Error("no room for a train");
    const eng = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(eng, 1);
    return eng;
  });
  const red = startLine(w.economy, engines[0], [{ depotId: A, action: "auto" }, { depotId: B, action: "auto" }]);
  const blue = startLine(w.economy, engines[1], [{ depotId: B, action: "auto" }, { depotId: A, action: "auto" }]);
  for (const eng of engines) w.economy.routeOf(eng).next = 1;
  w.trackChanged?.();
  const { CARGO } = await import("/src/economy/cargo.ts");
  setInterval(() => {
    // (The forest kept stocked: shortcut.)
    w.economy.depot(A).piles[CARGO.log.index] = Math.max(w.economy.depot(A).piles[CARGO.log.index], 12);
  }, 500);
  window.__loads = () => w.economy.loadsMoved;
  // What the game says (each toast, as it's asked for).
  const h = w.hud;
  window.__said = [];
  const f = h.toast.bind(h);
  h.toast = (m, ...rest) => (m && window.__said.push(m), f(m, ...rest));
  w.invalidate();
  const gp = place(gapId).pose;
  return { A, B, engines, lines: [red.name, blue.name], pieces: placed.length, gap: { x: gp.x, z: gp.z, heading: gp.heading } };
});
check("setup: the single line laid, its loop a straight short, a train of each of two lines coming at each other", !setup.error && setup.pieces > 15, JSON.stringify(setup));
await p.evaluate(() => {
  window.woodrail.paused = false;
  window.woodrail.hud.setPaused(false);
});

// ---- 1. The tip comes by itself ---------------------------------------------------------------------------------------
const said = () => p.evaluate(() => [...window.__said]);
let toasted = false;
for (let k = 0; k < 40 && !toasted; k++) {
  toasted = await until(() => window.__said.some((t) => /stuck nose to nose/.test(t)), null, 15000);
  if (!toasted) console.log("  waiting:", JSON.stringify(await p.evaluate(() => ({ t: Math.round(window.woodrail.simSeconds), tip: window.woodrail.situations().current()?.id ?? null }))));
}
check("1. the trains stop nose to nose: a toast says so", toasted, JSON.stringify((await said()).filter((t) => /nose|pass/.test(t))));
await shot("1-toast");

// ---- 2. The row, and Learn more: the Passing loops sheet -------------------------------------------------------------
await pause(true);
await until(() => !document.querySelector(".toast.show"), null, 60000);
await tapSel(".goals-head");
await until(() => !document.querySelector(".goals").classList.contains("collapsed"), null, 10000);
const row = await p.evaluate(() => {
  const r = document.querySelector(".situation-tip");
  return { title: r?.querySelector("b")?.textContent, text: r?.querySelector("p")?.textContent, more: r?.querySelector(".tip-more")?.textContent };
});
check("2. the row: Trains can't pass, the fix a passing loop", /Trains can't pass/.test(row.title ?? "") && /A passing loop in the middle lets them pass/.test(row.text ?? ""), JSON.stringify(row));
check("2. …Learn more about passing loops", /passing loops/.test(row.more ?? ""), row.more);
await shot("2-row");
await tapSel(".situation-tip .tip-more");
const sheet = await until(() => window.woodrail.hud.explainerShown === "loops", null, 15000);
await p.waitForTimeout(500);
const sheetInfo = await p.evaluate(() => {
  const r = document.querySelector(".explainer-sheet");
  return { title: r?.querySelector(".card-title")?.textContent, sections: r?.querySelectorAll(".explainer-section").length ?? 0, pictures: [...(r?.querySelectorAll(".explainer-section svg") ?? [])].length };
});
check("2. it opens the Passing loops sheet: three sections, each with its picture", sheet && sheetInfo.title === "Passing loops" && sheetInfo.sections === 3 && sheetInfo.pictures === 3, JSON.stringify(sheetInfo));
await shot("2-sheet");
await tapSel(".explainer-sheet .explainer-x");
await until(() => window.woodrail.hud.explainerShown === null, null, 10000);

// ---- 3. Show where ----------------------------------------------------------------------------------------------------
if (await p.evaluate(() => document.querySelector(".goals").classList.contains("collapsed"))) await tapSel(".goals-head");
await tapSel(".situation-tip .tip-where");
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
await settle();
const fronts = await p.evaluate(() => [...window.woodrail.sim.trains()].map((t) => { const q = window.woodrail.layout.getPiece(t.bogies[0].pieceId).pose; return { x: q.x, z: q.z }; }));
let both = true;
for (const q of fronts) {
  const [x, y] = await screenOf(q);
  if (!(x > 0 && x < 390 && y > 0 && y < 844)) both = false;
}
check("3. Show where: both trains in view", both, JSON.stringify(fronts));
await shot("3-show-where");

// ---- 4. The fix, the player's way: a Long straight from the tray into the loop's gap -----------------------------------
const trayItem = async (key) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, key);
  for (let k = 0; k < 24; k++) {
    const r = await find();
    if (r) return r;
    if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) await tapSel(".scroller .tray-back");
    const shelves = await p.evaluate(() => document.querySelectorAll(".scroller .tray-group").length);
    if (k >= shelves) return null;
    const box = await p.evaluate((k) => { const e = document.querySelectorAll(".scroller .tray-group")[k]; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, k);
    await tapAt(box[0], box[1]);
  }
  return null;
};
// The gap's middle (a straight's pose is its first end), the view on it.
const gapMid = { x: setup.gap.x + Math.cos(setup.gap.heading) * 108, y: 0, z: setup.gap.z + Math.sin(setup.gap.heading) * 108 };
await p.evaluate((v) => {
  const w = window.woodrail;
  w.director.glideTo(new w.controls.target.constructor(v.x, 0, v.z), 900, { duration: 0.1 });
}, gapMid);
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
await settle();
const pieces0 = await p.evaluate(() => [...window.woodrail.layout.pieceIds()].length);
const item = await trayItem("piece:straight-216");
check("4. a Long straight on the tray", !!item);
if (item) {
  const [tx, ty] = await screenOf(gapMid);
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  let t = Date.now() / 1000;
  // (Dragged by touch from the tray to the gap; a held piece rides a little above the finger: aimed below it.)
  await touch("touchStart", item[0], item[1], t);
  for (let k = 1; k <= 16; k++) await touch("touchMove", item[0] + ((tx - item[0]) * k) / 16, item[1] + ((ty + 56 - item[1]) * k) / 16, (t += 0.04));
  await p.waitForTimeout(400);
  await frames();
  await shot("4-held");
  await touch("touchEnd", 0, 0, (t += 0.05));
  await frames();
  await p.waitForTimeout(800);
  await settle();
}
const laid = await p.evaluate(async () => {
  const w = window.woodrail;
  const { connectorRef } = await import("/src/track/index.ts");
  const ids = [...w.layout.pieceIds()];
  const last = ids[ids.length - 1];
  const p = w.layout.getPiece(last);
  return { n: ids.length, type: p?.type, joined: [0, 1].map((c) => w.layout.joinedConnector(connectorRef(last, c)) !== -1) };
});
check("4. laid in the gap, joined at both ends: the loop is whole", laid.n === pieces0 + 1 && laid.type === "straight-216" && laid.joined.every(Boolean), JSON.stringify(laid));

// ---- 5. The payoff ----------------------------------------------------------------------------------------------------
const loads0 = await p.evaluate(() => window.__loads());
await pause(false);
const fixed = await until(() => window.__said.some((t) => /They pass now/.test(t)), null, 900000);
check("5. the tip goes with \"✓ They pass now\"", fixed, JSON.stringify((await said()).slice(-4)));
await shot("5-fixed");
const t5 = await p.evaluate(() => window.woodrail.simSeconds);
await until((t) => window.woodrail.simSeconds > t + 120, t5, 600000);
const after = await p.evaluate(() => ({ loads: window.__loads(), stuck: [...window.woodrail.sim.trains()].map((t) => !!window.woodrail.economy.stalls.stuckOf(t.cars[0].id)) }));
check("5. they pass and carry logs: neither stuck, loads moved", after.stuck.every((s) => !s) && after.loads > loads0, JSON.stringify({ loads0, ...after }));
const done = await p.evaluate(() => ({ done: window.woodrail.situations().isDone("jam-loop"), row: !!document.querySelector(".situation-tip") }));
check("5. done for this game, the row gone", done.done && !done.row, JSON.stringify(done));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
