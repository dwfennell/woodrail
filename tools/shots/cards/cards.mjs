// The game's cards and sheets in their live states, for judging the card system before and after a change
// (docs/agents/card-system.md): Game mode, the HUD tour's oval (forest, sawmill, workshop; two lines, three trains),
// a signal on it, and a tug launched at a river landing with a second landing down the river. Each card opened the
// way the game opens it (its own calls: a tap's handler, a card's buttons), shot at each size as
// <out>/cards-<TAG>-<W>x<H>-<screen>.jpg, and its box, against the subject's place on screen, written to
// <out>/cards-<TAG>-<W>x<H>.json: the card's size in each state (does it jump?) and whether it covers what it's about.
//
// node tools/shots/cards/cards.mjs [<out>] [screen,…]   TAG=before|after (default "now"), SIZES=390x844,1440x900
//
// Setup shortcuts (only to get to the states pictured; nothing here is tested): research learned, the oval and its
// places and trains put down in code (as hud-tour/stage.mjs does), landings placed by the editor's own `place` at a
// spot the water e2e's search finds, and a tug launched there by the fleet (e2e:water builds one at a boatyard).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");
const OUT = process.argv[2] ?? "e2e-out/cards";
const ONLY = process.argv[3]?.split(",");
const TAG = process.env.TAG ?? "now";
const SIZES = (process.env.SIZES ?? "390x844,1440x900").split(",");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);

for (const size of SIZES) {
  const [W, H] = size.split("x").map(Number);
  const phone = W < 700;
  const p = await b.newPage(phone ? { viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : { viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  if (process.env.CARDS_DEBUG) { p.on("console", (m) => console.log("console", m.text())); await p.addInitScript(() => (window.__dbgFrame = true)); }
  await p.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    localStorage.setItem("woodrail.favourites", "[]");
  });
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  await p.addStyleTag({ content: ".toast { visibility: hidden !important; }" });

  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    for (const id of ["switches", "routes", "warehouses", "signals", "cranes1", "barges"]) {
      try { w.learn(id); } catch {}
    }
    const { Layout } = await import("/src/track/index.ts");
    const S = await import("/src/routing/scenarios.ts");
    const { checkPlacement } = await import("/src/landscape/clearance.ts");
    const { startLine, joinLine } = await import("/src/game/lines.ts");
    const { siteWhy } = await import("/src/game/industries.ts");
    const { waterAt } = await import("/src/game/boats.ts");
    const scratch = new Layout();
    const ids = S.oval(scratch).ids;
    const pts = ids.map((i) => [scratch.getPiece(i).pose.x, scratch.getPiece(i).pose.z]);
    const t = w.world.landscape.towns[0].centre;
    const ok = (x, z) => {
      if (w.landscape.grid.cellAtWorld(x, z) === -1) return false;
      for (const i of w.layout.pieceIds()) { const q = w.layout.getPiece(i).pose; if (Math.hypot(q.x - x, q.z - z) <= 500) return false; }
      return [0, Math.PI / 2].some((h) => checkPlacement(w.landscape, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
    };
    let g = null;
    for (let d = 600; d < 8000 && !g; d += 54) {
      const n = Math.max(8, Math.round((2 * Math.PI * d) / 54));
      for (let a = 0; a < n && !g; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n)), z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        if (pts.every(([dx, dz]) => ok(x + dx, z + dz))) g = { x, z };
      }
    }
    if (!g) throw new Error("no ground");
    const types = { 0: "depot-forest", 7: "depot-sawmill", 9: "depot-workshop" };
    const placed = w.editor().placeRun(ids.map((i, k) => {
      const q = scratch.getPiece(i);
      return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
    }));
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const places = [depot(placed[0], "forest").id, depot(placed[7], "sawmill").id, depot(placed[9], "workshop").id];
    const engines = [placed[2], placed[5], placed[12]].map((pieceId, k) => {
      const r = w.sim.addTrain(["engine", k === 1 ? "van" : "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed: false });
      if (r.kind !== "placed") throw new Error("no room for a train");
      const e = w.sim.getTrain(r.trainId).cars[0].id;
      w.sim.setLever(e, 1);
      return e;
    });
    const red = startLine(w.economy, engines[0], [{ depotId: places[0], action: "auto" }, { depotId: places[1], action: "auto", waitFill: true }, { depotId: places[2], action: "drop" }]);
    joinLine(w.economy, engines[2], red.id);
    startLine(w.economy, engines[1], [{ depotId: places[1], action: "pick" }, { depotId: places[2], action: "auto" }]);
    // A signal on a joint of the oval's far side (straight to straight).
    const { connectorRef } = await import("/src/track/index.ts");
    let signal = -1;
    for (const pid of [...placed.slice(3, 7), ...placed]) if (signal === -1) signal = w.layout.addSignal(connectorRef(pid, 1));
    // A river: two landings on one water, far apart (the water e2e's search, its −z bank).
    const gr = w.world.landscape.grid;
    const spots = [];
    for (let i = 0; i < gr.cellCount && spots.length < 400; i++) {
      if (gr.surface[i] !== 1) continue;
      const c = gr.colOf(i), r = gr.rowOf(i);
      const at = (dc, dr) => gr.surface[gr.index(c + dc, r + dr)] ?? -1;
      let run = true;
      for (let k = -4; k <= 4; k++) if (at(k, 0) !== 1 || at(k, -1) === 1 || at(k, -2) === 1 || at(k, 2) === 1) run = false;
      if (!run) continue;
      const cx = gr.centreX(c);
      const pose = { x: cx - 108, z: gr.centreZ(r) - 100, heading: 0 };
      const y = gr.groundY(gr.cellAtWorld(cx, pose.z));
      if (siteWhy(w.world.landscape, "kit-landing", pose) !== null || w.interaction.placeWhy("kit-landing", pose, y, -1)) continue;
      spots.push({ pose, y, wet: waterAt(w.world.landscape, { x: cx, z: pose.z + 100 }) });
    }
    let pair = null;
    for (const a of spots) for (const s of spots) if (a.wet === s.wet && Math.abs(a.pose.x - s.pose.x) > 900 && Math.abs(a.pose.x - s.pose.x) < 2600 && (!pair || Math.abs(a.pose.x - s.pose.x) > Math.abs(pair[0].pose.x - pair[1].pose.x))) pair = [a, s];
    let landings = [];
    if (pair) {
      for (const s of pair) {
        const pid = w.editor().place("kit-landing", s.pose, s.y, false);
        if (pid !== -1) landings.push((w.economy.depotAtPiece(pid) ?? w.economy.addDepot("landing", pid)).id);
      }
      const A = w.economy.depot(landings[0]);
      if (A) A.piles[(await import("/src/economy/cargo.ts")).CARGO.log.index] = 8;
    }
    w.trackChanged?.();
    w.invalidate();
    window.__cards = { engines, places, g, signal, landings };
    return { engines, places, g, signal, landings };
  });
  console.log(size, JSON.stringify(setup));
  await p.evaluate(() => { const w = window.woodrail; for (let i = 0; i < 120 * 40; i++) { w.sim.tick(); w.economy.tick(); w.economy.drainEvents(); } w.invalidate(); });
  await p.evaluate(() => (window.woodrail.paused = true));

  const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const tick = (secs, until = "") => p.evaluate(({ secs, until }) => {
    const w = window.woodrail;
    const stop = until ? new Function("w", `return ${until}`) : () => false;
    for (let i = 0; i < secs * 120; i++) { w.sim.tick(); w.economy.tick(); w.economy.drainEvents(); if (stop(w)) break; }
    w.invalidate();
  }, { secs, until });
  const click = (sel, text) => p.evaluate(([sel, text]) => {
    const e = [...document.querySelectorAll(sel)].find((x) => x.offsetParent && (!text || x.textContent.trim().startsWith(text)));
    e?.click();
    return !!e;
  }, [sel, text ?? null]);
  const reset = async () => {
    for (let i = 0; i < 3; i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(120); }
    await p.evaluate(() => {
      window.woodrail.hud.hideCards();
      const v = (sel) => [...document.querySelectorAll(sel)].find((e) => e.offsetParent);
      v(".line-sheet .ls-done")?.click();
      if (v(".menu")) document.querySelector('button[aria-label="Menu"]')?.click();
    });
    await p.waitForTimeout(300);
  };
  const look = (pt, dist = 1500) => p.evaluate(({ pt, dist }) => {
    const w = window.woodrail;
    w.director.glideTo(new w.controls.target.constructor(pt.x, 0, pt.z), dist, { duration: 0.05 });
  }, { pt, dist }).then(() => p.waitForTimeout(500));
  const depotAt = (id) => p.evaluate((id) => { const w = window.woodrail; const q = w.layout.getPiece(w.economy.depot(id).pieceId).pose; return { x: q.x, z: q.z }; }, id);
  const carAt = (id) => p.evaluate((id) => { const o = window.woodrail.trainView.carObject(id); const v = o && o.getWorldPosition(new o.position.constructor()); return v ? { x: v.x, z: v.z } : null; }, id);
  const boatAt = () => p.evaluate(() => { const w = window.woodrail; const bt = [...w.economy.boats.values()][0]; const q = bt && w.fleet.where(bt); return q ? { x: q.x, z: q.z } : null; });

  /** The open card's box and where its subjects (world points) fall on screen: covered by the card, or off screen. */
  const measure = (subjects) => p.evaluate((subjects) => {
    const w = window.woodrail;
    const card = [...document.querySelectorAll(".hud .card, .hud .line-sheet")].find((e) => !e.hidden && e.offsetParent && e.getBoundingClientRect().width > 0);
    const r = card?.getBoundingClientRect();
    const box = r ? { cls: card.className, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } : null;
    const V = w.camera.position.constructor;
    const cr = w.canvas.getBoundingClientRect();
    const tray = document.querySelector(".hud .tray")?.getBoundingClientRect();
    const seen = subjects.filter(Boolean).map((s) => {
      const v = new V(s.x, s.y ?? 20, s.z).project(w.camera);
      const x = cr.left + ((v.x + 1) / 2) * cr.width, y = cr.top + ((1 - v.y) / 2) * cr.height;
      const off = v.z > 1 || x < 0 || y < 0 || x > cr.width || y > cr.height;
      const under = r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const underTray = tray && x >= tray.left && x <= tray.right && y >= tray.top && y <= tray.bottom;
      return { name: s.name, x: Math.round(x), y: Math.round(y), visible: !off && !under && !underTray, why: off ? "off screen" : under ? "under the card" : underTray ? "under the tray" : "" };
    });
    return { box, seen };
  }, subjects);

  const results = {};
  const shoot = async (name, subjects = []) => {
    await p.waitForTimeout(500);
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 8000 }).catch(() => {});
    await frames();
    await p.waitForTimeout(250);
    await p.screenshot({ path: `${OUT}/cards-${TAG}-${size}-${name}.jpg`, type: "jpeg", quality: 82 });
    results[name] = await measure(subjects);
    console.log(size, name, JSON.stringify(results[name]));
  };
  const want = (n) => !ONLY || ONLY.some((o) => n.startsWith(o));
  const sub = (name, pt, y = 20) => pt && { name, x: pt.x, y, z: pt.z };

  // ——— The engine card: running, at its stop, its line edited ———
  if (want("engine")) {
    await reset();
    const e = setup.engines[0];
    await look(await carAt(e));
    await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), e);
    await shoot("engine-running", [sub("engine", await carAt(e))]);
    await tick(80, `w.economy.atStop(w.sim.findCar(${e}).train.id) !== null`);
    await p.waitForTimeout(1500);
    await shoot("engine-at-stop", [sub("engine", await carAt(e))]);
    await click(".engine-extra .route-plan");
    await p.waitForTimeout(900);
    await shoot("engine-edit", [sub("engine", await carAt(e)), ...(await Promise.all(setup.places.map(async (d, i) => sub(`stop ${i + 1}`, await depotAt(d)))))]);
    await click(".engine-extra .route-plan.on, .engine-extra .route-done");
  }
  // ——— The line sheet (☰ Lines, a line, a stop opened) ———
  if (want("linesheet")) {
    await reset();
    await look(await depotAt(setup.places[1]), 2600);
    await click('button[aria-label="Menu"]');
    await p.waitForTimeout(300);
    await click(".menu button", "Lines");
    await p.waitForTimeout(900);
    await shoot("lines-list");
    await click(".lines-row");
    await p.waitForTimeout(900);
    // (The line the sheet is open on: its stops; with one opened, that stop.)
    const sheetStops = () => p.evaluate(() => {
      const w = window.woodrail;
      return (w.economy.lines.get(w.lines.sheetLine())?.stops ?? []).map((st) => { const q = w.layout.getPiece(w.economy.depot(st.depotId).pieceId).pose; return { x: q.x, z: q.z }; });
    });
    await shoot("linesheet", (await sheetStops()).map((pt, i) => sub(`stop ${i + 1}`, pt)));
    await click(".ls-stop[data-stop='1'] .ls-stop-main");
    await p.waitForTimeout(600);
    await shoot("linesheet-stop", [(await sheetStops()).map((pt, i) => sub(`stop ${i + 1}`, pt))[1]]);
  }
  // ——— Industry, workshop, town (its station), signal ———
  for (const [name, id] of [["industry", setup.places[1]], ["workshop", setup.places[2]]]) {
    if (!want(name)) continue;
    await reset();
    await look(await depotAt(id));
    await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), id);
    await shoot(name, [sub(name, await depotAt(id))]);
  }
  if (want("town")) {
    await reset();
    const town = await p.evaluate(() => { const w = window.woodrail; const d = [...w.economy.depots.values()].find((x) => x.role === "town"); return d?.id ?? -1; });
    await look(await depotAt(town));
    await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), town);
    await shoot("town", [sub("station", await depotAt(town))]);
  }
  if (want("signal") && setup.signal !== -1) {
    await reset();
    const at = await p.evaluate((id) => { const t = window.woodrail.marksView.topOf(id); return t && { x: t.x, z: t.z }; }, setup.signal);
    if (at) await look(at, 1200);
    await p.evaluate((id) => window.woodrail.interaction.selectMark(id), setup.signal);
    await shoot("signal", [sub("signal", at, 40)]);
  }
  // ——— The boat: launched (no route: planning at once), both landings tapped, then Done and sailing ———
  if (want("boat") && setup.landings.length === 2) {
    await reset();
    const [A, B] = setup.landings;
    const id = await p.evaluate((A) => window.woodrail.fleet.launch(A)?.id ?? -1, A);
    await look(await depotAt(A), 1500);
    await p.evaluate((id) => window.woodrail.interaction.onBoatTap(id), id);
    await shoot("boat-planning-1", [sub("boat", await boatAt()), sub("landing 1", await depotAt(A))]);
    // A tap on the second landing (the planner's own hook, as a tap on its jetty calls it).
    await look(await depotAt(B), 1500);
    await p.evaluate((B) => window.woodrail.interaction.onPickPlace?.(B), B);
    await p.evaluate(() => window.woodrail.invalidate());
    await shoot("boat-planning-2", [sub("boat", await boatAt()), sub("landing 1", await depotAt(A)), sub("landing 2", await depotAt(B))]);
    console.log(size, "boat stops", await p.evaluate(() => JSON.stringify([...window.woodrail.economy.boats.values()][0].stops)));
    await click(".boat-card .route-plan.on");
    await p.evaluate(() => (window.woodrail.paused = false));
    await tick(12);
    await p.evaluate(() => (window.woodrail.paused = true));
    // (Its card closed, the boat in the middle of the view, and tapped again: as a player opens it.)
    await reset();
    await look(await boatAt(), 1500);
    await p.evaluate((id) => window.woodrail.interaction.onBoatTap(id), id);
    await shoot("boat-sailing", [sub("boat", await boatAt())]);
  }
  writeFileSync(`${OUT}/cards-${TAG}-${size}.json`, JSON.stringify(results, null, 1));
  await p.close();
}
await b.close();
await server.close();
