// End-to-end: situation help, step 2 (docs/superpowers/specs/2026-11-18-situation-help.md, detector #4a): signals
// laid closer together than the line's trains, so they can't wait between them, in Game mode on a 390×844 phone with
// touch, by taps.
//
// Setup (named shortcuts, none of them what's tested): as e2e:situation-help's (a flat map by its code; Switches,
// Routes and Signals learned; the tutorial's goals done and the clock past a game's first minutes; the line laid by
// the editor, a passing loop at each end of a stretch bent round to fit, three timber trains bunched on one line), and
// two signals put down by the editor one straight apart on the stretch (216 mm: a timber train is 268 mm). Then, on the
// game's own clock (the test clock, 8×):
//   1. A train waits there: the tip comes by itself (its toast once, "nowhere to wait between these signals").
//   2. The row: "Signals too close together", the line's trains' length, "Space signals at least a train apart".
//   3. Show where: the block and the waiting train in view, the too-short signal's card open, saying so.
//   4. The fix, the player's way: the card's Remove takes that signal off.
//   5. The payoff: no block too short for the line's trains is left, the tip goes with "✓ They have room to wait
//      now", loads keep moving; done for this game.
// Pictures: situation-blocks-1-toast.jpg, -2-row.jpg, -3-show-where.jpg, -5-fixed.jpg.
//
// Usage: npm run e2e:situation-blocks [-- <out dir>]   (default out: e2e-out/situation-blocks)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/situation-blocks";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5443, strictPort: false }, logLevel: "error" });
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
const shot = (n) => p.screenshot({ path: `${OUT}/situation-blocks-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
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
  const { startLine, joinLine } = await import("/src/game/lines.ts");
  const scratch = new Layout();
  const S = "straight-216";
  const [a, , w2] = chain(scratch, ["depot-forest", S, S]);
  appendPiece(scratch, "buffer-turnback", false, connectorRef(a, 0));
  const l1 = loopOn(scratch, connectorRef(w2, 1), [S, S], [S]);
  // (A passing loop at each end, the long stretch between them bent round by curves to fit the map: with one loop the
  // leader comes back toward the follower, and no signal helps.)
  const m1 = chain(scratch, Array(3).fill(S), connectorRef(l1.s2, 0));
  const bend = chain(scratch, Array(8).fill("curve-large"), connectorRef(m1[2], 1), Array(8).fill(true));
  const m2 = chain(scratch, Array(3).fill(S), connectorRef(bend[7], 1));
  const mid = [...m1, ...bend, ...m2];
  const l2 = loopOn(scratch, connectorRef(m2[2], 1), [S, S], [S]);
  const [, , bb] = chain(scratch, [S, S, "depot-sawmill"], connectorRef(l2.s2, 0));
  appendPiece(scratch, "buffer-turnback", false, connectorRef(bb, 1));
  const ids = [...scratch.pieceIds()];
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
  let g = null;
  for (let d = 0; d < 16000 && !g; d += 108) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / 108));
    for (let k = 0; k < n && !g; k++)
      for (const r of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
        const x = Math.round(t.x + d * Math.cos((k * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((k * 2 * Math.PI) / n));
        if (ids.every((i) => ok(x + rot(r, scratch.getPiece(i).pose.x, scratch.getPiece(i).pose.z)[0], z + rot(r, scratch.getPiece(i).pose.x, scratch.getPiece(i).pose.z)[1]))) {
          g = { x, z, r };
          break;
        }
      }
  }
  if (!g) return { error: "no ground for the line" };
  const placed = w.editor().placeRun(
    ids.map((i) => {
      const q = scratch.getPiece(i);
      const [dx, dz] = rot(g.r, q.pose.x, q.pose.z);
      return { type: q.type, pose: { x: dx + g.x, z: dz + g.z, heading: q.pose.heading + g.r }, y: 0, flipped: q.flipped };
    }),
  );
  const at = (i) => placed[ids.indexOf(i)];
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const A = depot(at(a), "forest").id;
  const B = depot(at(bb), "sawmill").id;
  // (Three trains: with the close signals a follower edges on, and two alone wait only a few seconds at a time.)
  const engines = [at(mid[1]), at(l1.main[0]), at(bend[5])].map((pieceId) => {
    const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed: false });
    if (r.kind !== "placed") throw new Error("no room for a train");
    const e = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(e, 1);
    return e;
  });
  const red = startLine(w.economy, engines[0], [{ depotId: A, action: "auto" }, { depotId: B, action: "auto" }]);
  joinLine(w.economy, engines[1], red.id);
  joinLine(w.economy, engines[2], red.id);
  // Two signals one straight apart on the stretch, just past the first loop where a follower waits, by the editor (shortcut: the tip is what's tested, not laying them).
  // (The first two straights past the loop: room for a train, 432 mm. The second one straight on: 216 mm, short.)
  const close = [w.editor().addSignal(connectorRef(at(m1[1]), 1)), w.editor().addSignal(connectorRef(at(m1[2]), 1))];
  // (Both bound for the sawmill, the follower behind the leader, as the follow hint's own test starts them: a line's
  // trains bunched, going the same way. Left to settle, two trains on a line with a loop at each end take turns and
  // pass at the loops.)
  for (const e of engines) w.economy.routeOf(e).next = 1;
  w.trackChanged?.();
  // The forest kept stocked (the trains always have logs to carry: shortcut), and the sawmill's logs taken in.
  const { trainState } = await import("/src/game/engine-status.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  // The longest a train has stood waiting for the other in one go (game s), by the game's own trainState: the
  // payoff, step 6, compares it before and after the signal.
  window.__waits = { longest: 0, streak: new Map(), last: w.simSeconds };
  setInterval(() => {
    const s = window.__waits;
    const now = w.simSeconds;
    const dt = now - s.last;
    s.last = now;
    if (dt <= 0 || dt > 30) return;
    for (const tr of w.sim.trains()) {
      const kind = trainState(w.sim, w.economy, tr, 1).kind;
      const n = /line-wait/.test(kind) ? (s.streak.get(tr.id) ?? 0) + dt : 0;
      s.streak.set(tr.id, n);
      s.longest = Math.max(s.longest, n);
    }
    w.economy.depot(A).piles[CARGO.log.index] = Math.max(w.economy.depot(A).piles[CARGO.log.index], 12);
  }, 100);
  // (Loads the cranes have moved: logs onto trains at the forest and off them at the sawmill.)
  window.__logsIn = () => w.economy.loadsMoved;
  w.invalidate();
  return { A, B, engines, line: red.id, name: red.name, pieces: placed.length, close };
});
check("setup: the long line laid, three trains on one line, two signals one straight apart", !setup.error && setup.pieces > 20 && setup.close.every((id) => id >= 0), JSON.stringify(setup));
// (Every toast's words as it shows, so one up and gone between two looks is still seen.)
await p.evaluate(() => {
  window.__toasts = [];
  const seen = () => {
    const t = document.querySelector(".toast.show")?.textContent ?? "";
    if (t && window.__toasts.at(-1) !== t) window.__toasts.push(t);
  };
  new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
});
await p.evaluate(() => {
  window.woodrail.paused = false;
  window.woodrail.hud.setPaused(false);
});


// ---- 1. The tip comes by itself ---------------------------------------------------------------------------------------
const diag = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    const { trainState } = await import("/src/game/engine-status.ts");
    return { t: Math.round(w.simSeconds), tip: w.situations().current()?.id ?? null, trains: [...w.sim.trains()].map((tr) => trainState(w.sim, w.economy, tr, 1).kind) };
  });
let toasted = false;
for (let k = 0; k < 40 && !toasted; k++) {
  toasted = await until(() => window.__toasts.some((t) => /nowhere to wait between these signals/.test(t)), null, 15000);
  if (!toasted) console.log("  waiting:", JSON.stringify(await diag()));
}
check("1. a train waits by the close signals: a toast says so", toasted, JSON.stringify(await p.evaluate(() => window.__toasts.filter((t) => /signals/.test(t)))));
await shot("1-toast");

// ---- 2. The row -------------------------------------------------------------------------------------------------------
await pause(true);
await until(() => !document.querySelector(".toast.show"), null, 60000);
await tapSel(".goals-head");
await until(() => !document.querySelector(".goals").classList.contains("collapsed"), null, 10000);
const row = await p.evaluate(() => {
  const r = document.querySelector(".situation-tip");
  return { title: r?.querySelector("b")?.textContent, text: r?.querySelector("p")?.textContent, where: r?.querySelector(".tip-where")?.offsetHeight ?? 0 };
});
check("2. the row: Signals too close together", /Signals too close together/.test(row.title ?? ""), JSON.stringify(row));
check("2. …the line's trains' length, and the fix", /Red line's trains \(\d+ mm\)/.test(row.text ?? "") && /Space signals at least a train apart/.test(row.text ?? "") && row.where >= 44, row.text);
await shot("2-row");

// ---- 3. Show where ----------------------------------------------------------------------------------------------------
await tapSel(".situation-tip .tip-where");
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
await settle();
const where = await p.evaluate(() => {
  const w = window.woodrail;
  const s = w.situations().current();
  const pose = (id) => w.layout.getPiece(id)?.pose;
  const b = s?.engine === undefined ? undefined : w.sim.findCar(s.engine)?.train.bogies[0];
  return {
    markId: s?.markId,
    block: s?.pieces?.map(pose).filter(Boolean).map((q) => ({ x: q.x, z: q.z })) ?? [],
    train: b ? pose(b.pieceId) : null,
    card: document.querySelector(".piece-card:not([hidden])")?.textContent ?? "",
    folded: document.querySelector(".goals").classList.contains("collapsed"),
  };
});
const inView = async (q) => {
  const [x, y] = await screenOf(q);
  return x > 0 && x < 390 && y > 0 && y < 844;
};
const blockIn = where.block.length > 0 && (await inView(where.block[0]));
const trainIn = !!where.train && (await inView(where.train));
check("3. Show where: the sheet folds, the block and the waiting train in view", where.folded && blockIn && trainIn, JSON.stringify({ blockIn, trainIn }));
check("3. …the too-short signal's card open, saying so", /Too short for a train to wait here/.test(where.card), where.card.slice(0, 160));
await shot("3-show-where");

// ---- 4. The fix: the card's Remove -------------------------------------------------------------------------------------
const marks0 = await p.evaluate(() => [...window.woodrail.layout.signals()].length);
await tapSel(".piece-card:not([hidden]) .chip.danger");
await frames();
const marks1 = await p.evaluate(() => [...window.woodrail.layout.signals()].length);
check("4. Remove on the card takes the signal off", marks1 === marks0 - 1, `${marks0} → ${marks1}`);

// ---- 5. The payoff ----------------------------------------------------------------------------------------------------
const loads0 = await p.evaluate(() => window.__logsIn());
await pause(false);
const short = await p.evaluate(async () => {
  const w = window.woodrail;
  const { shortBlocks } = await import("/src/game/situation-tips.ts");
  const { trainLength } = await import("/src/sim/train-cars.ts");
  let longest = 0;
  for (const t of w.sim.trains()) longest = Math.max(longest, trainLength(t));
  return shortBlocks(w.layout, longest).length;
});
check("5. no block too short for the line's trains is left", short === 0, `${short} short`);
const fixed = await until(() => window.__toasts.some((t) => /They have room to wait now/.test(t)), null, 900000);
check("5. the tip goes with \"✓ They have room to wait now\"", fixed, await toastText());
await shot("5-fixed");
const loads1 = await p.evaluate(() => window.__logsIn());
check("5. logs still carried: the cranes keep loading and unloading", loads1 > loads0, `${loads0} → ${loads1} loads moved`);
const done = await p.evaluate(() => ({ done: window.woodrail.situations().isDone("short-blocks"), row: !!document.querySelector(".situation-tip") }));
check("5. done for this game, the row gone", done.done && !done.row, JSON.stringify(done));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
