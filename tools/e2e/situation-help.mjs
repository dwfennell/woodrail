// End-to-end: situation help, step 1 (docs/superpowers/specs/2026-11-18-situation-help.md): a line's trains queuing for
// a whole stretch a signal could split, in Game mode on a 390×844 phone with touch, by taps.
//
// Setup (named shortcuts, none of them what's tested): a flat map by its code; Switches, Routes and Signals learned;
// the tutorial's goals marked done and the clock past a game's first two minutes (situation tips wait for both); the
// follow hint's own layout (signal-slots.test.ts: ⊐ forest ══ loop ══ ⌒ ══ loop ══ sawmill ⊏, its stretch bent by curves) laid by the editor beside the
// first town, two timber trains on one line forest → sawmill. Then, on the game's own clock (the test clock, 8×):
//   1. The follower waits for the whole stretch: the tip comes by itself, a toast ("Red line trains are stuck in a
//      queue · Show where ›") and the chip saying "💡 Trains queuing" while it's up; then the chip is the goal again,
//      a 💡 beside it.
//   2. The Goals sheet: the row stamped Tip, "Trains queuing on the Red line", where they're bound, a Learn more link,
//      Got it and Show where (printed), each 44 px; 0 frames drawn while it's open, paused.
//   3. Learn more opens the Signals sheet; ✕ closes it.
//   4. Show where: the sheet folds, the camera frames the waiting train and the spot, the ghost signal there with
//      "Put a signal here", the Signal ringed on its shelf.
//   5. The Signal tapped on its shelf and the track tapped by the spot: a signal there.
//   6. The payoff: run on, and the trains follow each other: the longest a train stands waiting for the other in one
//      go is shorter than before the signal (the whole stretch then, half now); the queue doesn't form again, so the
//      tip goes with a "✓ They follow now" toast; logs still reach the sawmill; it's done for this game.
//   7. After a reload: kept done (the game's session), no tip.
//   8. ☰ Tips: off, then on.
// Pictures: situation-help-1-toast.jpg, -2-row.jpg, -4-show-where.jpg, -6-fixed.jpg.
//
// Usage: npm run e2e:situation-help [-- <out dir>]   (default out: e2e-out/situation-help)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";
import { shownToast, toastLogIn, toastsSince } from "../../scripts/e2e/lib/toasts.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/situation-help";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5441, strictPort: false }, logLevel: "error" });
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
// (Every toast kept as it shows, with the goals chip as it was while it was up: a toast is up a few wall-clock seconds,
// and a loaded box can look too late.)
await toastLogIn(ctx, () => document.querySelector(".goals-now")?.textContent ?? "");
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
const shot = (n) => p.screenshot({ path: `${OUT}/situation-help-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
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
  const engines = [at(mid[1]), at(l1.main[0])].map((pieceId) => {
    const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed: false });
    if (r.kind !== "placed") throw new Error("no room for a train");
    const e = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(e, 1);
    return e;
  });
  const red = startLine(w.economy, engines[0], [{ depotId: A, action: "auto" }, { depotId: B, action: "auto" }]);
  joinLine(w.economy, engines[1], red.id);
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
  return { A, B, engines, line: red.id, name: red.name, pieces: placed.length };
});
check("setup: the long line laid, two trains on one line", !setup.error && setup.pieces > 20, JSON.stringify(setup));
await p.evaluate(() => {
  window.woodrail.paused = false;
  window.woodrail.hud.setPaused(false);
});

// ---- 1. The tip comes by itself: the toast, and the chip saying it while it's up ------------------------------------
/** What the tip waits on, said while waiting (a failure says why). */
const diag = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    const { trainState } = await import("/src/game/engine-status.ts");
    return {
      t: Math.round(w.simSeconds),
      paused: w.paused,
      tutorial: w.goals().inTutorial(),
      follow: w.economy.sections.followWait(),
      tip: w.situations().current()?.id ?? null,
      saved: w.situations().toJSON(),
      trains: [...w.sim.trains()].map((tr) => trainState(w.sim, w.economy, tr, 1).kind),
    };
  });
let shown1 = null;
for (let k = 0; k < 40 && !shown1; k++) {
  shown1 = await shownToast(p, /stuck in a queue/, { ms: 15000 });
  if (!shown1) console.log("  waiting:", JSON.stringify(await diag()));
}
const toast1 = shown1?.text ?? (await toastsSince(p));
const chip1 = (shown1?.also ?? []).join(" | ");
const said1 = await p.evaluate(() => window.__toasts.filter((t) => /stuck in a queue/.test(t.text)).length);
check("1. the follower waits for the whole stretch: a toast says so, once", !!shown1 && said1 === 1 && /Red line trains are stuck in a queue/.test(toast1) && /Show where/.test(toast1), `${toast1} (said ${said1}×)`);
check("1. …the chip says it while the toast is up", /💡 Trains queuing/.test(chip1), chip1);
const before = await p.evaluate(() => Math.round(window.__waits.longest));
await shot("1-toast");
await until(() => !document.querySelector(".toast.show"), null, 120000);
await until(() => !/Trains queuing/.test(document.querySelector(".goals-now")?.textContent ?? ""), null, 60000);
const chip2 = await p.evaluate(() => ({ now: document.querySelector(".goals-now")?.textContent ?? "", badge: !document.querySelector(".goals-tip-badge")?.hidden }));
check("1. then the chip is the goal again, a 💡 beside it", !/Trains queuing/.test(chip2.now) && chip2.badge, JSON.stringify(chip2));

// ---- 2. The Goals sheet: the row ------------------------------------------------------------------------------------
await pause(true);
await tapSel(".goals-head");
await until(() => !document.querySelector(".goals").classList.contains("collapsed"), null, 10000);
const row = await p.evaluate(() => {
  const r = document.querySelector(".situation-tip");
  const size = (sel) => {
    const e = r?.querySelector(sel);
    return e ? { w: e.offsetWidth, h: e.offsetHeight, text: e.textContent } : null;
  };
  return { title: r?.querySelector("b")?.textContent, text: r?.querySelector("p")?.textContent, stamp: !!r?.querySelector(".tip-stamp"), more: size(".tip-more"), done: size(".tip-done"), where: size(".tip-where"), painted: r ? getComputedStyle(r.querySelector(".tip-where")).color : "" };
});
check("2. the row: stamped Tip, the line named", row.stamp && /Trains queuing on the Red line/.test(row.title ?? ""), JSON.stringify(row));
check("2. …where they're bound, and the fix", /reaches .*sawmill/i.test(row.text ?? "") && /signal halfway/.test(row.text ?? ""), row.text);
check("2. Learn more, Got it and Show where, each 44 px tall", row.more?.h >= 44 && row.done?.h >= 44 && row.where?.h >= 44 && /signals/.test(row.more?.text ?? ""), JSON.stringify(row));
await shot("2-row");
const idle = await idleFrames();
check("2. 0 frames drawn with the row open, paused", idle === 0, `${idle} frames`);

// ---- 3. Learn more: the Signals sheet -------------------------------------------------------------------------------
await tapSel(".situation-tip .tip-more");
const sheet = await until(() => window.woodrail.hud.explainerShown === "signals", null, 15000);
check("3. Learn more opens the Signals sheet", sheet);
await p.waitForTimeout(500);
await tapSel(".explainer-sheet .explainer-x");
await until(() => window.woodrail.hud.explainerShown === null, null, 10000);

// ---- 4. Show where --------------------------------------------------------------------------------------------------
if (await p.evaluate(() => document.querySelector(".goals").classList.contains("collapsed"))) await tapSel(".goals-head");
await tapSel(".situation-tip .tip-where");
// (The label is up for a few seconds: looked for at once.)
const labelled = await until(() => [...document.querySelectorAll(".goal-label")].some((l) => /Put a signal here/.test(l.textContent)), null, 8000);
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
await settle();
const where = await p.evaluate(async () => {
  const w = window.woodrail;
  const s = w.situations().current();
  const { postAt } = await import("/src/game/signal-place.ts");
  const post = postAt(w.layout, s.signalAt);
  const b = w.sim.findCar(s.engine).train.bogies[0];
  const tr = w.layout.getPiece(b.pieceId).pose;
  return { at: s.signalAt, post, train: { x: tr.x, z: tr.z }, folded: document.querySelector(".goals").classList.contains("collapsed"), ringed: !!document.querySelector('.tray-item.pointed[data-key="signal"]') };
});
const onScreen = ([x, y]) => x > 0 && x < 390 && y > 0 && y < 844;
const postAt = await screenOf(where.post);
const trainAt = await screenOf(where.train);
check("4. Show where: the sheet folds, the spot and the waiting train both in view", where.folded && onScreen(postAt) && onScreen(trainAt), JSON.stringify({ postAt, trainAt }));
check("4. …\"Put a signal here\" over it, the Signal ringed on its shelf", labelled && where.ringed, JSON.stringify({ labelled, ...where }));
await shot("4-show-where");

// ---- 5. The Signal from its shelf, the track tapped by the spot ---------------------------------------------------
const marks0 = await p.evaluate(() => [...window.woodrail.layout.signals()].length);
await tapSel('.scroller .tray-item[data-key="signal"]');
await p.waitForFunction(() => window.woodrail.interaction.signalToolOn, null, { timeout: 10000 }).catch(() => {});
const joint = await p.evaluate(async (at) => (await import("/src/game/signal-place.ts")).jointPose(window.woodrail.layout, at), where.at);
// (A little short of the joint, the way the trains go.)
const [tx, ty] = await screenOf({ x: joint.x - Math.cos(joint.heading) * 30, y: joint.y, z: joint.z - Math.sin(joint.heading) * 30 });
await tapAt(tx, ty);
await settle();
const marks = await p.evaluate(() => [...window.woodrail.layout.signals()].map((m) => m.id));
check("5. a signal put down by the spot", marks.length > marks0, JSON.stringify({ marks0, marks }));
await tapSel('.scroller .tray-item[data-key="signal"]');

// ---- 6. The payoff --------------------------------------------------------------------------------------------------
// Before the signal the follower stood in the loop for the whole stretch to the sawmill; with it, a train waits at most
// till the one ahead is past the signal. Measured over a few trips, then the tip goes as the queue doesn't form again.
const logs0 = await p.evaluate(() => window.__logsIn());
await p.evaluate(() => {
  window.__waits.longest = 0;
  window.__waits.streak.clear();
  window.__waits.last = window.woodrail.simSeconds;
});
await pause(false);
const fixed = await shownToast(p, /They follow now/, { ms: 600000 });
check("6. the tip goes with \"✓ They follow now\"", !!fixed, fixed?.text ?? (await toastsSince(p)));
await shot("6-fixed");
const logs1 = await p.evaluate(() => window.__logsIn());
const after = await p.evaluate(() => Math.round(window.__waits.longest));
check("6. the trains follow: the longest wait behind the other train is shorter with the signal", before >= 20 && after < before, `${before} s → ${after} s`);
check("6. logs still carried: the cranes keep loading and unloading", logs1 > logs0, `${logs0} → ${logs1} loads moved`);
const done = await p.evaluate(() => ({ done: window.woodrail.situations().isDone("jam-follow"), row: !!document.querySelector(".situation-tip") }));
check("6. done for this game, the row gone", done.done && !done.row, JSON.stringify(done));

// ---- 7. A reload: kept done ------------------------------------------------------------------------------------------
await pause(true);
await p.waitForTimeout(1500);
await p.reload();
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
const kept = await p.evaluate(() => window.woodrail.situations().toJSON());
check("7. after a reload the tip is still done (saved with the game)", kept.done.includes("jam-follow") && kept.toasted.includes("jam-follow"), JSON.stringify(kept));

// ---- 8. ☰ Tips: off, then on -----------------------------------------------------------------------------------------
await p.keyboard.press("Escape");
/** ☰ open (a tap on Menu only if it's shut: a second tap shuts it), and done appearing. */
const menuOpen = async () => {
  if (await p.evaluate(() => document.querySelector(".menu")?.hidden !== false)) await tapSel('button[aria-label="Menu"]');
  await until(() => !document.querySelector(".menu")?.hidden, null, 5000);
  await p.waitForTimeout(400);
};
await menuOpen();
const item = await p.evaluate(() => document.querySelector(".tips-item")?.textContent ?? null);
check("8. ☰ has Tips: on", item === "Tips: on", item);
await tapSel(".tips-item");
await menuOpen();
const off = await p.evaluate(() => ({ text: document.querySelector(".tips-item")?.textContent, stored: localStorage.getItem("woodrail.tips") }));
check("8. a tap: Tips: off, kept", off.text === "Tips: off" && off.stored === "0", JSON.stringify(off));
await menuOpen();
await tapSel(".tips-item");
const on = await p.evaluate(() => ({ text: document.querySelector(".tips-item")?.textContent, stored: localStorage.getItem("woodrail.tips"), done: window.woodrail.situations().isDone("jam-follow") }));
check("8. again: on, and the kinds done this game may show again", on.text === "Tips: on" && on.stored === "1" && !on.done, JSON.stringify(on));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
