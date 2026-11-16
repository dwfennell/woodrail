// Putting a stop into a line that runs (route-insert, 2026-11-16: "it's still quite difficult to add a stop where
// you want to add one in an existing route"), in Game mode on a 390×844 phone, by taps (`npm run e2e:route-insert
// [-- <out dir>]`):
//  1. A line A → B → C made by taps (☰ Lines, + New line, three yards on an oval: A and B forest yards, C a workshop),
//     a goods train put on it from Add a train in its sheet.
//  2. The line opened again, the sawmill D (lying between B and C round the oval) tapped: it goes in between B and C,
//     not at the end; the sheet says so ("Added Sawmill between Forest yard 2 and Workshop"), the train still heads
//     for the stop it was. Move to end puts it last; the note's Undo puts it back between; the bar's Undo takes it off.
//  3. The + on the line after B tapped (painted, the hint says where), then D: in between B and C again. Undone, and
//     the + peg on the map's ribbon between B and C tapped, then D: in between them once more.
//  4. The train runs the line (the payoff): it calls at B, then D, then C, in that order; logs are unloaded at the
//     sawmill, and planks at the workshop.
//  5. The card's line, read only: a peg a stop, where the train's going, no +; a peg tapped opens the sheet at its stop.
//  6. Every sheet button 44 px or more (the + pegs too); 0 frames drawn idle with the sheet open; no page errors.
// Pictures in the out dir (route-insert-*.jpg). Starts its own dev server.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/route-insert";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5431, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
let checks = 0;
const check = (what, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, ok ? "" : detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/route-insert-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const still = async () => {
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
/** Tap the first visible element matching `selector` (its text starting with `text`, if given). */
const tap = async (selector, text) => {
  const at = await p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.trim().startsWith(text)));
      if (!el) return null;
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
  if (!at) return false;
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(450);
  await frames();
  return true;
};
/** Where a world point is on the screen. */
const onScreen = (pt) =>
  p.evaluate((pt) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(pt.x, pt.y ?? 0, pt.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }, pt);
/** Look at a world point from above (the map's room above the sheet), then tap it. */
const tapWorld = async (pt, dist = 1300) => {
  await p.evaluate(
    ({ pt, dist }) => {
      const w = window.woodrail;
      w.director.glideTo(new w.camera.position.constructor(pt.x, pt.y ?? 0, pt.z), dist, { duration: 0.1, phi: 0.7, inRoom: true });
    },
    { pt, dist },
  );
  await p.waitForTimeout(400);
  await still();
  const at = await onScreen(pt);
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(500);
  await frames();
  return at;
};
const sheetLine = () =>
  p.evaluate(() => {
    const w = window.woodrail;
    const id = w.lines?.sheetLine?.() ?? -1;
    const l = w.economy.lines.get(id);
    return l ? { id, name: l.name, stops: l.stops.map((s) => s.depotId), actions: l.stops.map((s) => s.action), trains: [...w.economy.lineIdOf].filter(([, x]) => x === id).map(([e]) => e) } : null;
  });
const toastText = () => p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
/** Every visible button in `sel` at least 44 px both ways. */
const small = (sel) =>
  p.evaluate((sel) => {
    const out = [];
    for (const b of document.querySelectorAll(`${sel} button, ${sel} [role=button]`)) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.width < 43.5 || r.height < 43.5) out.push(`${b.className || b.tagName}:${(b.textContent || "").trim().slice(0, 12)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  }, sel);

// ---- Setup: a new game, routes learned, and an oval laid by the editor with two forest yards, a sawmill and a
// workshop (a harness shortcut: what's tested is putting a stop in, on top of it).
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const id of ["switches", "routes"]) w.learn(id);
  const { Layout } = await import("/src/track/index.ts");
  const S = await import("/src/routing/scenarios.ts");
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
  const scratch = new Layout();
  const ids = S.oval(scratch).ids;
  const pts = ids.map((i) => [scratch.getPiece(i).pose.x, scratch.getPiece(i).pose.z]);
  const town = w.world.landscape.towns[0];
  const ok = (x, z) => {
    if (w.landscape.grid.cellAtWorld(x, z) === -1) return false;
    for (const i of w.layout.pieceIds()) {
      const q = w.layout.getPiece(i).pose;
      if (Math.hypot(q.x - x, q.z - z) <= 500) return false;
    }
    return [0, Math.PI / 2].some((h) => checkPlacement(w.landscape, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
  };
  let g = null;
  for (let d = 600; d < 9000 && !g; d += 54) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / 54));
    for (let a = 0; a < n && !g; a++) {
      const x = Math.round(town.centre.x + d * Math.cos((a * 2 * Math.PI) / n));
      const z = Math.round(town.centre.z + d * Math.sin((a * 2 * Math.PI) / n));
      if (pts.every(([dx, dz]) => ok(x + dx, z + dz))) g = { x, z };
    }
  }
  if (!g) return null;
  // (Round the oval: A at 0, B at 2, D at 7, C at 9.)
  const types = { 0: "depot-forest", 2: "depot-forest", 7: "depot-sawmill", 9: "depot-workshop" };
  const placed = w.editor().placeRun(ids.map((i, k) => {
    const q = scratch.getPiece(i);
    return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
  }));
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const A = depot(placed[0], "forest").id;
  const B = depot(placed[2], "forest").id;
  const D = depot(placed[7], "sawmill").id;
  const C = depot(placed[9], "workshop").id;
  w.depotView.setWorld(w.economy, w.layout);
  w.trackChanged?.();
  w.invalidate();
  return { placed, A, B, C, D };
});
check("setup: an oval with two forest yards, a sawmill and a workshop", !!setup && setup.placed.length === 14, JSON.stringify(setup));
if (!setup) process.exit(1);
const yardOf = (depotId) => p.evaluate((id) => window.woodrail.depotView.placeSpots().find((s) => s.depotId === id), depotId);
const tapPlace = async (id) => tapWorld(await yardOf(id));
const sheetState = () =>
  p.evaluate(() => ({
    hint: document.querySelector(".line-sheet .ls-hint")?.textContent ?? "",
    added: document.querySelector(".line-sheet .ls-added-text")?.textContent ?? "",
    toEnd: !!document.querySelector(".line-sheet .ls-added-end"),
    undo: !!document.querySelector(".line-sheet .ls-added-undo"),
    ringed: [...document.querySelectorAll(".line-sheet .ls-stop.added")].map((r) => Number(r.dataset.stop)),
    armed: [...document.querySelectorAll(".line-sheet .ls-insert.on")].map((b) => Number(b.dataset.after)),
    pegs: document.querySelectorAll(".line-sheet .ls-insert").length,
  }));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const { A, B, C, D } = setup;

// ---- 1. A line A → B → C by taps, a train on it --------------------------------------------------------------------
await tap('button[aria-label="Menu"]');
await tap(".menu button", "Lines");
await p.waitForFunction(() => { const v = document.querySelector(".lines-view"); return v && !v.hidden; }, null, { timeout: 15000 });
await tap(".lines-new");
for (const id of [A, B, C]) await tapPlace(id);
const abc = await sheetLine();
check("1. a new line, A, B and C tapped in order: A → B → C (a line being made keeps the order tapped)", same(abc?.stops, [A, B, C]), JSON.stringify(abc));
// (Harness shortcut, setup: a goods train put on the oval between A and B as the tray would, its lever on; the
// forests kept stocked below.)
const engine = await p.evaluate((pieceId) => {
  const w = window.woodrail;
  w.paused = true;
  const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 60, reversed: false });
  if (r.kind !== "placed") return -1;
  const e = w.sim.getTrain(r.trainId).cars[0].id;
  w.sim.setLever(e, 1);
  w.invalidate();
  return e;
}, setup.placed[1]);
check("1. (setup) a goods train on the oval", engine !== -1);
await p.waitForFunction((e) => !!document.querySelector(`.ls-add-train[data-engine='${e}']`), engine, { timeout: 15000 }).catch(() => {});
await tap(`.ls-add-train[data-engine='${engine}']`);
const run = await sheetLine();
check("1. + Add: the train runs A → B → C", !!run?.trains.includes(engine), JSON.stringify(run));
await tap(".ls-done");
await p.waitForFunction(() => { const v = document.querySelector(".lines-view"); return v && !v.hidden; }, null, { timeout: 15000 }).catch(() => {});

// ---- 2. The line opened again, D tapped ---------------------------------------------------------------------------
await tap(".lines-row");
const heading = () => p.evaluate((e) => { const r = window.woodrail.economy.routeOf(e); return r ? { next: r.next, depot: r.stops[r.next]?.depotId } : null; }, engine);
const was = await heading();
const opened = await sheetState();
check("2. an open line of three: a + peg on the line after each stop, the hint says a place goes in where it fits", opened.pegs === 3 && /where it fits/.test(opened.hint), JSON.stringify(opened));
await shot("1-pegs");
await tapPlace(D);
const abdc = await sheetLine();
const said = await sheetState();
check("2. D tapped, lying between B and C: it goes in between them, not at the end", same(abdc?.stops, [A, B, D, C]), JSON.stringify(abdc));
check("2. …the sheet says where it went, with Move to end and Undo; its stop ringed", /^Added Sawmill.* between Forest yard.* and Workshop/.test(said.added) && said.toEnd && said.undo && same(said.ringed, [2]), JSON.stringify(said));
const now = await heading();
check("2. …the train still heads for the stop it was (its index moved with it)", !!was && !!now && now.depot === was.depot && (was.next < 2 ? now.next === was.next : now.next === was.next + 1), JSON.stringify({ was, now }));
// (Its train rides the sheet's spine, before the stop it's heading for: lines UI redesign 2026-11-16.)
const ride = await p.evaluate((e) => {
  const li = document.querySelector(`.ls-train[data-engine='${e}']`);
  let n = li?.nextElementSibling;
  while (n && !n.classList.contains("ls-stop")) n = n.nextElementSibling;
  let b = li?.previousElementSibling;
  while (b && !b.classList.contains("ls-stop")) b = b.previousElementSibling;
  return { row: !!li, before: n ? Number(n.dataset.stop) : -1, after: b ? Number(b.dataset.stop) : -1, here: !!li?.classList.contains("here"), status: li?.querySelector(".ls-train-status")?.textContent ?? "" };
}, engine);
check("2. its train rides the sheet's spine before the stop it's heading for (after it, standing there), saying what it's doing", ride.row && (ride.here ? ride.after === now.next : ride.before === now.next) && ride.status.length > 0, JSON.stringify({ ride, now }));
check("2. the sheet's buttons are 44 px or more (the pegs and the note's too)", (await small(".line-sheet")).length === 0, JSON.stringify(await small(".line-sheet")));
await shot("2-added-between");
await tap(".ls-added-end");
const atEnd = await sheetLine();
const movedSaid = await sheetState();
check("2. Move to end: D last", same(atEnd?.stops, [A, B, C, D]) && /^Moved Sawmill.* to the end/.test(movedSaid.added), JSON.stringify({ atEnd, movedSaid }));
await tap(".ls-added-undo");
const backBetween = await sheetLine();
check("2. …the note's Undo: D between B and C again", same(backBetween?.stops, [A, B, D, C]), JSON.stringify(backBetween));
await tap('.hud button[title^="Undo"]');
const offAgain = await sheetLine();
check("2. …the bar's Undo: D off, A → B → C", same(offAgain?.stops, [A, B, C]), JSON.stringify(offAgain));

// ---- 3. The + after B, then D -------------------------------------------------------------------------------------
await tap(".line-sheet .ls-insert[data-after='1']");
const armed = await sheetState();
check("3. the + after B tapped: painted, the hint says a place goes in between B and C", same(armed.armed, [1]) && /^Now tap a place: it goes between Forest yard.* and Workshop/.test(armed.hint), JSON.stringify(armed));
await shot("3-plus-armed");
await tapPlace(D);
const viaPlus = await sheetLine();
const plusSaid = await sheetState();
check("3. …then D tapped: in between B and C, said (no Move to end: it was put there by hand), the + let go", same(viaPlus?.stops, [A, B, D, C]) && /^Added Sawmill.* between/.test(plusSaid.added) && !plusSaid.toEnd && plusSaid.armed.length === 0, JSON.stringify({ viaPlus, plusSaid }));
await shot("4-plus-added");

// ---- 3b. The + on the map: a peg on the ribbon between B and C ------------------------------------------------------
await tap(".ls-added-undo");
const undoneAgain = await sheetLine();
check("3b. (the note's Undo: A → B → C again)", same(undoneAgain?.stops, [A, B, C]), JSON.stringify(undoneAgain));
// (The view may glide to frame the line after the edit: the pegs measured once it's still.)
await p.waitForTimeout(400);
await still();
await p.waitForTimeout(300);
/** The map's + pegs: where each is on the screen, and which stop it follows (built with the line's ribbon). */
const mapPegs = () =>
  p.evaluate(() => {
    const w = window.woodrail;
    const out = [];
    w.scene.getObjectByName("route")?.traverse((o) => {
      if (o.userData?.kind !== "route-insert") return;
      const c = o.position.clone().project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      out.push({ after: o.userData.after, x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height });
    });
    return out.sort((a, b) => a.after - b.after);
  });
const pegs = await mapPegs();
check("3b. planning, the map has a + peg on each leg of the line (three, a ring of three stops)", pegs.length === 3 && same(pegs.map((q) => q.after), [0, 1, 2]), JSON.stringify(pegs));
const peg = pegs.find((q) => q.after === 1);
const sheetTop = await p.evaluate(() => document.querySelector(".line-sheet").getBoundingClientRect().top);
check("3b. …each peg in view, above the sheet (the line framed with its pegs)", pegs.every((q) => q.y > 0 && q.y < sheetTop - 10 && q.x > 0 && q.x < 390), JSON.stringify({ pegs, sheetTop }));
if (peg) {
  await p.touchscreen.tap(peg.x, peg.y);
  await p.waitForTimeout(500);
  await frames();
}
const mapArmed = await sheetState();
check("3b. the map's + between B and C tapped: the sheet's + there painted, the hint says between B and C", same(mapArmed.armed, [1]) && /^Now tap a place: it goes between Forest yard.* and Workshop/.test(mapArmed.hint), JSON.stringify({ mapArmed, peg }));
await shot("4b-map-plus-armed");
await tapPlace(D);
const viaMap = await sheetLine();
check("3b. …then D tapped: in between B and C", same(viaMap?.stops, [A, B, D, C]), JSON.stringify(viaMap));
// (0 frames drawn idle, the sheet open and the game paused.)
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 2500));
  return w.framesDrawn - n0;
});
check("3. 0 frames drawn idle with the sheet open", idle === 0, `${idle} frames`);

// ---- 4. The payoff: the train calls at B, D, C in order, and delivers --------------------------------------------
// (The game's own sim and economy ticks, as Game.frame runs them, ahead of SwiftShader's few frames.)
const ran = await p.evaluate(async ({ engine, A, B, D, C }) => {
  const w = window.woodrail;
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { PILE_CAP } = await import("/src/economy/constants.ts");
  const calls = [];
  let logsToMill = 0;
  let planksToWorkshop = 0;
  let last = w.economy.routeOf(engine)?.next;
  for (let i = 0; i < 150 * 120; i++) {
    if (i % 120 === 0) for (const f of [A, B]) w.economy.depot(f).piles[CARGO.log.index] = PILE_CAP;
    w.sim.tick();
    w.economy.tick();
    for (const ev of w.economy.drainEvents()) {
      if (ev.kind !== "unloaded") continue;
      if (ev.depotId === D && ev.cargo === "log") logsToMill++;
      if (ev.depotId === C && ev.cargo === "planks") planksToWorkshop++;
    }
    const r = w.economy.routeOf(engine);
    if (r && r.next !== last) {
      calls.push(r.stops[last]?.depotId);
      last = r.next;
    }
  }
  w.invalidate();
  return { calls, logsToMill, planksToWorkshop };
}, { engine, A, B, D, C });
const names = { [A]: "A", [B]: "B", [C]: "C", [D]: "D" };
const order = ran.calls.map((d) => names[d] ?? "?").join("");
check("4. the train calls at B, then D, then C, round and round", /BDC/.test(order) && !/BC/.test(order) && !/DB/.test(order), JSON.stringify({ order }));
check("4. …logs unloaded at the sawmill and planks at the workshop (the payoff)", ran.logsToMill > 0 && ran.planksToWorkshop > 0, JSON.stringify(ran));

// ---- 5. The card: its line read only, a stop's peg opens the sheet at that stop --------------------------------------
await tap(".ls-done");
await p.waitForTimeout(600);
await p.keyboard.press("Escape");
// (Harness shortcut: the train's card opened as a tap on it would.)
await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), engine);
await p.waitForSelector(".engine-extra .route-mini .route-chip", { timeout: 15000 }).catch(() => {});
await p.waitForTimeout(700); // (the card's scale-in)
const rail = await p.evaluate(() => ({
  pegs: [...document.querySelectorAll(".engine-extra .route-mini .route-chip")].map((b) => b.getAttribute("aria-label")),
  plus: document.querySelectorAll(".engine-extra .route-insert").length,
  where: document.querySelector(".engine-extra .route-where")?.textContent ?? "",
}));
check("5. the card's line: a peg a stop (named for a screen reader), where the train's going, no + (the sheet edits)", rail.pegs.length === 4 && /^Stop 3, Sawmill/.test(rail.pegs[2] ?? "") && rail.plus === 0 && /^(Going to|At) /.test(rail.where), JSON.stringify(rail));
check("5. …its pegs 44 px or more", (await small(".engine-extra .route-mini")).length === 0, JSON.stringify(await small(".engine-extra .route-mini")));
await shot("5-card-line");
await tap('.engine-extra .route-chip[data-stop="2"]');
const fromPeg = await p.evaluate(() => ({ open: !document.querySelector(".line-sheet").hidden, stop: document.querySelector(".ls-stop.open")?.dataset.stop }));
check("5. …stop 3's peg tapped: the sheet opens at it", fromPeg.open && fromPeg.stop === "2", JSON.stringify(fromPeg));
await shot("6-from-peg");

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? `${checks}/${checks} passed` : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
