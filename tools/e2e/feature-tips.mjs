// End-to-end feature tips (src/game/feature-tips.ts), Game mode on a 390×844 phone with touch: light onboarding for
// the systems after the core goals. Setup shortcuts (not what's tested): blueprints learned through the game's own
// `learn` (as finishing a research does: its toast and all); a straight line with a mill and a workshop (stocked with
// the planks a second track costs) and an oval with a forest and a sawmill, laid by the editor on open ground as drops
// would; a train put down as the tray would; the train's line made in code (the route card is e2e:touch's).
// Then, by the player's taps:
//   1. A new game: no tip under the goals; the goal count is the core goals' alone.
//   2. Sidings learned: its toast says how ("Tap an industry, then Second track"); the Goals card has a 💡 row; its
//      Show me opens an industry's card with Second track on it. A tap on the mill, then Second track: two tracks
//      there, and the tip goes (the payoff: it was used).
//   3. Tunnels learned: the toast adds the tip ("💡 Lay a Long straight up to a hill's side…"); Show me opens the
//      Track tab on Straight and marks a hill by the line. Got it: the row goes.
//   4. Jam kitchen learned: Show me opens the Industries tab; a tap on the Jam kitchen's tile says what it makes
//      ("Makes jam from fruit and sugar"). Got it.
//   5. Telegraph learned: Show me opens Lineside; the Telegraph pole's tile says what it's for. Got it.
//   6. Leave now: a hand-run train stands under the forest's crane waiting for a full load: a one-time toast and the
//      tip; Show me opens its engine card; Leave now there sends it on, and the tip goes.
//   7. A route given past a sharing workshop: the keep stepper's tip and toast; Show me opens the workshop's card; a
//      tap on + there, and the tip goes. Then a ring line: the tip and its toast; Show me opens its line sheet with ⋯ open; Reverse there turns its train round; the tip goes.
//   8. Reloaded: every tip used or tapped away stays gone. Idle: no frames drawn (tips are checked with the goals).
//
// Pictures (390×844, at 2×) go to the out dir; `docs/agents/shots/onboarding-*.jpg` are copies.
// Usage: npm run e2e:feature-tips [-- <out dir>]   (default out: e2e-out/feature-tips)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/feature-tips";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks and industries' motions held still: this counts idle frames.)
pinClocksIn(b);
stillIndustriesIn(b);
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
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 60000 }).catch(() => {});
  await frames();
};
const worldAt = (what) =>
  p.evaluate((what) => {
    const w = window.woodrail;
    if (what.engine !== undefined) {
      const t = w.sim.findCar(what.engine).train;
      const [a, c] = [t.world[0], t.world[1]];
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
    }
    const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
    const q = piece.pose;
    // (A depot's yard, beside its track: what a player taps.)
    return { x: q.x + Math.cos(q.heading) * 108 - Math.sin(q.heading) * 60, y: piece.y, z: q.z + Math.sin(q.heading) * 108 + Math.cos(q.heading) * 60 };
  }, what);
const onScreen = async (what) => {
  const v = await worldAt(what);
  return p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
  }, v);
};
const showing = async (what, dist = 1300) => {
  const v = await worldAt(what);
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2 }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapOn = async (what) => {
  await showing(what);
  const [x, y] = await onScreen(what);
  await tapped(() => p.touchscreen.tap(x, y));
};
const visible = (sel) => p.evaluate((sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0), sel);
const tapButton = async (sel, text) => {
  await p.waitForFunction(([sel, text]) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text))), [sel, text], { timeout: 30000 });
  // (Scrolled into view first, as a finger would: the Goals sheet scrolls, and the tip's row may be below its fold.)
  await p.evaluate(([sel, text]) => [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text))).scrollIntoView({ block: "nearest" }), [sel, text]);
  await frames();
  await p.waitForTimeout(400);
  const [x, y] = await p.evaluate(([sel, text]) => {
    const r = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text))).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, [sel, text]);
  await tapped(() => p.touchscreen.tap(x, y));
};
const enterGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  // (The primary button: a new game, or, with a save, Continue.)
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
};
/** The toast showing now (its text), waited for till it has `text` (null if it never came). */
const toastWith = (text, timeout = 15000) =>
  p
    .waitForFunction((t) => [...document.querySelectorAll(".toast")].some((e) => e.textContent.includes(t)), text, { timeout })
    .then(() => p.evaluate((t) => [...document.querySelectorAll(".toast")].find((e) => e.textContent.includes(t)).textContent, text), () => null);
const clearToasts = () => p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.click()));
/** The Goals card unfolded (a tap on its head), and the tip's row there for `id` (waited for the goals' check). */
const tipRow = async (id) => {
  const shown = await p.waitForFunction((id) => window.woodrail.tips().current()?.id === id, id, { timeout: 15000 }).then(() => true, () => false);
  if (await p.evaluate(() => document.querySelector(".goals").classList.contains("collapsed"))) await tapButton(".goals-head");
  const row = await p.evaluate((id) => document.querySelector(`.goal.feature-tip[data-feature-tip="${id}"]`)?.innerText ?? null, id);
  return { shown, row };
};
const tipGone = (id) =>
  p
    .waitForFunction((id) => window.woodrail.tips().isDone(id) && !document.querySelector(`.goal.feature-tip[data-feature-tip="${id}"]`), id, { timeout: 15000 })
    .then(() => true, () => false);
const learn = (...ids) => p.evaluate((ids) => ids.forEach((id) => window.woodrail.learn(id)), ids);
const gotIt = async (id) => {
  await tipRow(id);
  await tapButton(`.goal.feature-tip[data-feature-tip="${id}"] .tip-done`);
  return tipGone(id);
};

// 1. A new game.
await p.goto(PAGE);
await enterGame();
const fresh = await p.evaluate(() => ({ row: !!document.querySelector(".goal.feature-tip"), tip: window.woodrail.tips().current()?.id ?? null, count: document.querySelector(".goals-count")?.textContent }));
// (The count is the core goals' only: tips add none. Read from the page, not a number fixed here: new systems add goals.)
const goalsTotal = await p.evaluate(async () => (await import("/src/game/goals.ts")).GOALS.length);
check("a new game: no tip under the goals; the count is the core goals'", !fresh.row && fresh.tip === null && new RegExp(`/ ${goalsTotal}$`).test(fresh.count ?? ""), JSON.stringify({ ...fresh, goalsTotal }));

// Setup (shortcuts, not what's tested): open ground for a straight line (8 straights, the mill, 3 straights, the
// workshop, a straight: room on its −l side for more tracks), and for an oval (a forest, two straights, round, the
// sawmill, a straight, a straight, round again), each asked of the game's drop rule; laid by the editor.
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { Layout, appendPiece, connectorRef } = await import("/src/track/index.ts");
  const g = w.world.landscape.grid;
  const t = w.controls.target;
  const why = new Map();
  const free = (pieces) =>
    pieces.every((q) => {
      const r = w.interaction.placeWhyIgnoring(q.type, q.flipped, q.pose, q.y, -1);
      if (r) why.set(r, (why.get(r) ?? 0) + 1);
      return r === null;
    });
  /** The nearest open ground where `make(X, Z)` gives pieces the drop rule takes (and `taken` doesn't overlap). */
  const ground = (make, avoid) => {
    for (let d = 300; d < 9000; d += 72)
      for (let a = 0; a < Math.max(1, Math.round(d / 72) * 4); a++) {
        const X = Math.round((t.x + d * Math.cos(a)) / 18) * 18;
        const Z = Math.round((t.z + d * Math.sin(a)) / 18) * 18;
        if (g.groundY(g.cellAtWorld(X, Z)) !== 0) continue;
        const { pieces, probes } = make(X, Z);
        // (Clear of track laid already: the line, its extra tracks' room beside it.)
        if (avoid && pieces.some((q) => avoid.some((a) => Math.hypot(q.pose.x - a.x, q.pose.z - a.z) < 520))) continue;
        if (pieces.every((q) => g.cellAtWorld(q.pose.x, q.pose.z) !== -1) && free([...pieces, ...probes])) return { X, Z, pieces };
      }
    return null;
  };
  // The straight line (heading 0): the mill at index 8, its extra tracks on −l (z −72, −144).
  const types = [...Array(8).fill("straight-216"), "depot-mill", ...Array(3).fill("straight-216"), "depot-workshop", "straight-216"];
  const line = ground((X, Z) => {
    const at = (i, l) => ({ x: X + (i - 8) * 216, z: Z + l, heading: 0 });
    const probes = [];
    for (let i = 5; i <= 11; i++) for (const l of [-72, -144]) probes.push({ type: "straight-216", pose: at(i, l), y: 0, flipped: false });
    return { pieces: types.map((type, i) => ({ type, pose: at(i, 0), y: 0, flipped: false })), probes };
  });
  if (!line) return { error: "no open ground for the line" };
  const ids = w.editor().placeRun(line.pieces);
  const mill = w.economy.depotAtPiece(ids[8]) ?? w.economy.addDepot("mill", ids[8]);
  const shop = w.economy.depotAtPiece(ids[12]) ?? w.economy.addDepot("workshop", ids[12]);
  shop.piles[CARGO.planks.index] = 22;
  // The oval, laid first on a scratch layout from (0, 0).
  const s = new Layout();
  const C = "curve-large";
  const S = "straight-216";
  const chain = ["depot-forest", S, S, C, C, C, C, "depot-sawmill", S, S, C, C, C, C];
  const o = [s.addPiece(chain[0], { x: 0, z: 0, heading: 0 }, 0, false)];
  for (const type of chain.slice(1)) o.push(appendPiece(s, type, false, connectorRef(o[o.length - 1], 1)));
  const shape = o.map((id) => s.getPiece(id));
  const oval = ground(
    (X, Z) => ({ pieces: shape.map((q) => ({ type: q.type, pose: { x: X + q.pose.x, z: Z + q.pose.z, heading: q.pose.heading }, y: 0, flipped: q.flipped })), probes: [] }),
    line.pieces.map((q) => q.pose),
  );
  if (!oval) return { error: "no open ground for the oval", why: [...why].sort((a, b) => b[1] - a[1]).slice(0, 4) };
  const ov = w.editor().placeRun(oval.pieces);
  const forest = w.economy.depotAtPiece(ov[0]) ?? w.economy.addDepot("forest", ov[0]);
  const sawmill = w.economy.depotAtPiece(ov[7]) ?? w.economy.addDepot("sawmill", ov[7]);
  w.depotView.setWorld(w.economy, w.layout);
  w.editor().clearHistory();
  w.invalidate();
  return { mill: mill.id, shop: shop.id, forest: forest.id, sawmill: sawmill.id, oval: ov };
});
check("setup: a line with a mill and a stocked workshop, and an oval with a forest and a sawmill", !setup.error, JSON.stringify(setup));

if (!setup.error) {
  // 2. Sidings.
  await learn("sidings");
  const sidingsToast = await toastWith("Learned Sidings");
  check("Sidings learned: its toast says how to start ('Tap an industry, then Second track')", !!sidingsToast?.includes("Tap an industry, then Second track"), sidingsToast ?? "no toast");
  await shot("onboarding-sidings-toast");
  await clearToasts();
  const sid = await tipRow("sidings");
  check("the Goals card has the tip's row: 💡 New: Sidings, what to do, Show me and Got it", sid.shown && !!sid.row?.includes("New: Sidings") && sid.row.includes("Second track") && sid.row.includes("Show me") && sid.row.includes("Got it"), JSON.stringify(sid));
  await shot("onboarding-sidings-tip");
  await tapButton(`.goal.feature-tip[data-feature-tip="sidings"] .tip-show`);
  const card = await p
    .waitForFunction(() => window.woodrail.interaction.openDepotId !== -1 && !!document.querySelector(".depot-tracks-btn"), null, { timeout: 20000 })
    .then(() => p.evaluate(() => ({ role: window.woodrail.economy.depot(window.woodrail.interaction.openDepotId)?.role, button: document.querySelector(".depot-tracks-btn")?.textContent, folded: document.querySelector(".goals").classList.contains("collapsed") })), () => null);
  check("its Show me opens an industry's card (folding the goals), Second track on it", !!card && !!card.button?.includes("Second track") && card.folded, JSON.stringify(card));
  await shot("onboarding-sidings-showme");
  await p.keyboard.press("Escape");
  await tapOn({ depot: setup.mill });
  await tapButton(".depot-tracks-btn");
  const two = await p.waitForFunction((m) => window.woodrail.economy.trackCount(m) === 2, setup.mill, { timeout: 20000 }).then(() => true, () => false);
  check("a tap on the mill, then Second track: two tracks there", two);
  check("…and the tip goes (it was used)", await tipGone("sidings"));
  await p.keyboard.press("Escape");

  // 3. Tunnels.
  await learn("tunnels");
  const tunToast = await toastWith("Learned Tunnels");
  check("Tunnels learned: the toast adds the tip ('💡 Lay a Long straight up to a hill's side')", !!tunToast?.includes("💡 Lay a Long straight up to a hill's side"), tunToast ?? "no toast");
  await shot("onboarding-tunnels-toast");
  await clearToasts();
  const tun = await tipRow("tunnels");
  check("the Tunnels tip shows under the goals", tun.shown && !!tun.row?.includes("New: Tunnels"), JSON.stringify(tun));
  await tapButton(`.goal.feature-tip[data-feature-tip="tunnels"] .tip-show`);
  await settle();
  const tray = await p.evaluate(() => ({ tab: document.querySelector(".tab.active[data-tab]")?.dataset.tab ?? null, spots: window.woodrail.interaction.guideSpots.length, straight: [...document.querySelectorAll(".tray-item")].some((e) => e.getBoundingClientRect().width > 0 && /Long/.test(e.textContent + (e.dataset.tipName ?? ""))) }));
  check("its Show me opens the Track tab on its straights and marks a hill by the line", tray.tab === "track" && tray.spots === 1 && tray.straight, JSON.stringify(tray));
  await shot("onboarding-tunnels-showme");
  check("Got it: the row goes, for good", await gotIt("tunnels"));

  // 4. Jam kitchen.
  await learn("jam");
  await toastWith("Learned Jam kitchen");
  await clearToasts();
  const jam = await tipRow("jam");
  check("the Jam kitchen's tip shows under the goals", jam.shown && !!jam.row?.includes("fruit and sugar"), JSON.stringify(jam));
  await shot("onboarding-jam-tip");
  await tapButton(`.goal.feature-tip[data-feature-tip="jam"] .tip-show`);
  await tapButton(`.tray-item[data-tip-name="Jam kitchen"]`);
  const jamCard = await p.waitForFunction(() => document.querySelector(".place-card:not([hidden])")?.textContent.includes("Makes jam"), null, { timeout: 15000 }).then(() => p.evaluate(() => document.querySelector(".place-card").innerText), () => null);
  check("its Show me opens Industries; a tap on the Jam kitchen's tile says what it makes, from what", !!jamCard?.includes("Makes jam from fruit and sugar"), jamCard ?? "no card");
  await shot("onboarding-jam-tray");
  check("Got it: the jam tip goes", await gotIt("jam"));

  // 5. Telegraph.
  await learn("signal-boxes", "telegraph");
  await clearToasts();
  const tel = await tipRow("telegraph");
  check("the Telegraph's tip shows under the goals", tel.shown && !!tel.row?.includes("telegraph poles"), JSON.stringify(tel));
  await tapButton(`.goal.feature-tip[data-feature-tip="telegraph"] .tip-show`);
  await tapButton(`.tray-item[data-tip-name="Telegraph pole"]`);
  const telCard = await p.waitForFunction(() => document.querySelector(".place-card:not([hidden])")?.textContent.includes("signal box"), null, { timeout: 15000 }).then(() => p.evaluate(() => document.querySelector(".place-card").innerText), () => null);
  check("its Show me opens Lineside; the Telegraph pole's tile says what it's for", !!telCard?.includes("A chain of poles carries a signal box's reach"), telCard ?? "no card");
  await shot("onboarding-telegraph-tray");
  check("Got it: the telegraph tip goes", await gotIt("telegraph"));
  await p.keyboard.press("Escape");

  // 6. Leave now: a hand-run train on the oval, the forest set to wait for a full load (its card's switch: e2e:touch
  // "wait" tests that); the game's own ticks run ahead (SwiftShader's frames are slow) till it stands waiting.
  const waiting = await p.evaluate((o) => {
    const w = window.woodrail;
    w.economy.setWaitFull(o.forest, true);
    w.economy.depot(o.forest).piles.fill(0);
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: o.oval[11], pathIndex: 0, s: 60, reversed: false });
    if (r.kind !== "placed") return { error: r.kind };
    const engine = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(engine, 1);
    let i = 0;
    while (!w.economy.waitingToFill(r.trainId) && i++ < 90 * 120) (w.sim.tick(), w.economy.tick());
    w.invalidate();
    return { engine, train: r.trainId, at: w.economy.waitingToFill(r.trainId)?.id ?? null };
  }, setup);
  check("setup: a hand-run train stands under the forest's crane, waiting for a full load", waiting.at === setup.forest, JSON.stringify(waiting));
  const leaveToast = await toastWith("💡 A train is waiting for a full load");
  check("the first wait: a one-time toast says Leave now", !!leaveToast, leaveToast ?? "no toast");
  await shot("onboarding-leave-now-toast");
  await clearToasts();
  const lv = await tipRow("leave-now");
  check("…and the tip shows under the goals", lv.shown && !!lv.row?.includes("Leave now"), JSON.stringify(lv));
  await tapButton(`.goal.feature-tip[data-feature-tip="leave-now"] .tip-show`);
  const engineCard = await p.waitForFunction(() => { const b = document.querySelector(".engine-card .leave-now"); return !!b && !b.hidden && b.offsetParent !== null; }, null, { timeout: 20000 }).then(() => true, () => false);
  check("its Show me opens the waiting train's engine card, Leave now on it", engineCard && (await p.evaluate(() => window.woodrail.interaction.openEngineCarId)) === waiting.engine);
  await shot("onboarding-leave-now-showme");
  await tapButton(".engine-card .leave-now");
  const left = await p.waitForFunction((t) => !window.woodrail.economy.waitingToFill(t), waiting.train, { timeout: 15000 }).then(() => true, () => false);
  check("Leave now sends it on with what it has, and the tip goes", left && (await tipGone("leave-now")));
  await p.keyboard.press("Escape");

  // 7. A ring line: Train routes learned, the train given a line round the oval (forest, sawmill) in code.
  await learn("routes");
  await clearToasts();
  const ring = await p.evaluate(async (o) => {
    const w = window.woodrail;
    const { editLine } = await import("/src/game/lines.ts");
    editLine(w.economy, o.engine, (s) => s.push({ depotId: o.forest, action: "auto" }, { depotId: o.sawmill, action: "auto" }));
    w.economy.setWaitFull(o.forest, false);
    return w.economy.lineIdOf.get(o.engine) ?? null;
  }, { ...setup, ...waiting });
  check("setup: the train runs a line round the oval", ring !== null, String(ring));
  // A route given (the goal ticks) with a workshop sharing its planks: its keep stepper's tip comes first.
  const keepToast = await toastWith("💡 Tap your workshop");
  check("a train on a route past a sharing workshop: a one-time toast says its − and + set what it keeps", !!keepToast, keepToast ?? "no toast");
  await clearToasts();
  const kp = await tipRow("keeps");
  check("…and the keeps tip shows under the goals", kp.shown && !!kp.row?.includes("keeps"), JSON.stringify(kp));
  await shot("onboarding-keeps-tip");
  await tapButton(`.goal.feature-tip[data-feature-tip="keeps"] .tip-show`);
  const keepCard = await p.waitForFunction((s) => window.woodrail.interaction.openDepotId === s && !!document.querySelector('.keep-row [data-step="1"]'), setup.shop, { timeout: 20000 }).then(() => true, () => false);
  check("its Show me opens the workshop's card, its keep stepper there", keepCard);
  await shot("onboarding-keeps-showme");
  await tapButton('.keep-row [data-step="1"]');
  check("a tap on + sets what it keeps, and the tip goes (it was used)", await tipGone("keeps"));
  await p.keyboard.press("Escape");
  const ringToast = await toastWith("💡 A ring line");
  check("a ring line with a train: a one-time toast says Reverse turns its trains round", !!ringToast, ringToast ?? "no toast");
  await clearToasts();
  const rg = await tipRow("ring-reverse");
  check("…and the tip shows under the goals", rg.shown && !!rg.row?.includes("Reverse"), JSON.stringify(rg));
  await shot("onboarding-ring-tip");
  await tapButton(`.goal.feature-tip[data-feature-tip="ring-reverse"] .tip-show`);
  // (Reverse is in the line sheet's ⋯ menu: Show me opens the ring line's sheet with that menu open, Reverse one tap away.)
  const lines = await p
    .waitForFunction(
      (id) => {
        const b = document.querySelector(".line-sheet .ls-reverse");
        const r = b?.getBoundingClientRect();
        return window.woodrail.lines.sheetLine() === id && !!r && r.width >= 44 && r.height >= 44 && r.top >= 0 && r.bottom <= innerHeight;
      },
      ring,
      { timeout: 20000 },
    )
    .then(() => true, () => false);
  check("its Show me opens the ring line's sheet, its ⋯ menu open, Reverse there (44 px, in view)", lines);
  await shot("onboarding-ring-showme");
  const beforeDir = await p.evaluate((e) => window.woodrail.sim.findCar(e).train.cars[0].id === e && window.woodrail.economy.routeOf(e)?.next, waiting.engine);
  await tapButton(".line-sheet .ls-reverse");
  const turned = await toastWith("runs the other way round now");
  check("Reverse turns the train round on the ring (the payoff), and the tip goes", !!turned && (await tipGone("ring-reverse")), JSON.stringify({ turned, beforeDir }));
  await p.keyboard.press("Escape");

  // 8. Reloaded: the tips used or tapped away stay gone.
  await p.evaluate(() => window.woodrail.save?.());
  await p.waitForTimeout(1500);
  await p.reload();
  await enterGame();
  await p.waitForTimeout(2500);
  const after = await p.evaluate(() => ({ row: document.querySelector(".goal.feature-tip")?.dataset.featureTip ?? null, current: window.woodrail.tips().current()?.id ?? null, done: window.woodrail.tips().toJSON().done }));
  check("after a reload no tip used or tapped away comes back", after.row === null && after.current === null && ["sidings", "tunnels", "jam", "telegraph", "leave-now", "keeps", "ring-reverse"].every((id) => after.done.includes(id)), JSON.stringify(after));

  // Idle: nothing drawn while nothing moves (the tips are checked with the goals, never per frame).
  await p.evaluate(() => {
    const w = window.woodrail;
    for (const id of w.sim.trainIds()) for (const c of w.sim.getTrain(id).cars) if (c.kind === "engine") w.sim.setLever(c.id, 0);
  });
  await settle();
  await p.waitForTimeout(1500);
  await settle();
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(2000);
  const idle = (await p.evaluate(() => window.woodrail.framesDrawn)) - f0;
  check("idle: no frames drawn over 2 s", idle === 0, `${idle} frames`);
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
