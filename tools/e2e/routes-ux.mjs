// End-to-end routes UX (option B: the line sheet and the Lines list) in Game mode on a 390×844 phone, by taps
// (`npm run e2e:routes-ux [-- <out dir>]`):
//  1. ☰ Lines with no line yet: + New line opens the line sheet with no line and no train; rings round the places a
//     tap can add.
//  2. Places tapped on the map, by their buildings and yards (not their track): a forest yard, a sawmill, a workshop's
//     yard ground, and a town's house (its station): a line with four stops, run by no train.
//  4. The town's stop dragged by its handle to the top, then opened and taken off: three stops, in a new order, then
//     put back in order with ↓ ↑.
//  5. A stop opened: what moves there in sentences; Pick up unticked (drop only) and ticked again.
//  6. Done: back to the Lines list; the line listed first ("No trains"), with its stops drawn.
//  7. A train put on the track by the line (as the tray would: a harness shortcut, not what's tested); the line tapped
//     in the list opens its Trains tab, + Add puts the train on it; the line runs (the payoff): logs carried from the
//     forest to the sawmill, counted as the line's loads; the list says Moving and its loads a month.
//  8. ⋯ Copy: a second line with the same stops and no train; a reload keeps both (one with no train).
//  9. A town with no station tapped: "… needs a station first", nothing added.
// 10. Every sheet and list button 44 px or more; 0 frames drawn idle with the sheet open; no page errors.
// Pictures in the out dir (routes-ux-*.jpg). Starts its own dev server.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/routes-ux";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5403, strictPort: false }, logLevel: "error" });
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
const shot = (n) => p.screenshot({ path: `${OUT}/routes-ux-${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
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

// ---- Setup: a new game, Signals and routes learned, and an oval of track with a forest, a sawmill and a workshop
// laid by the editor (a harness shortcut: what's tested is the routes UX on top of it).
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
  const types = { 0: "depot-forest", 7: "depot-sawmill", 9: "depot-workshop" };
  const placed = w.editor().placeRun(ids.map((i, k) => {
    const q = scratch.getPiece(i);
    return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
  }));
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const forest = depot(placed[0], "forest").id;
  const mill = depot(placed[7], "sawmill").id;
  const workshop = depot(placed[9], "workshop").id;
  w.depotView.setWorld(w.economy, w.layout);
  w.trackChanged?.();
  w.invalidate();
  // A house of the first town (a tap on it means its station), and a second town whose station is taken up (a
  // harness shortcut: a town with no station to tap).
  const house = [...w.props.all()].find((q) => q.town === town.id && q.building !== undefined);
  const station = w.economy.allDepots().find((d) => d.role === "town" && d.townId === town.id);
  const other = w.world.landscape.towns[1];
  return { g, placed, forest, mill, workshop, house: house && { x: house.x, y: house.y ?? 0, z: house.z }, townStation: station?.id ?? -1, townName: town.name, other: other && { id: other.id, name: other.name, x: other.centre.x, z: other.centre.z } };
});
check("setup: an oval with a forest, a sawmill and a workshop", !!setup && setup.placed.length === 14, JSON.stringify(setup));
if (!setup) process.exit(1);
/** A place's yard middle (where its building and yard are, not its track). */
const yardOf = (depotId) => p.evaluate((id) => window.woodrail.depotView.placeSpots().find((s) => s.depotId === id), depotId);

// ---- 1. ☰ Lines, + New line --------------------------------------------------------------------------------------
await tap('button[aria-label="Menu"]');
check("1. ☰ has Lines with no line yet", await tap(".menu button", "Lines"));
await p.waitForFunction(() => { const v = document.querySelector(".lines-view"); return v && !v.hidden; }, null, { timeout: 15000 });
check("1. …the list says there are none, with + New line", await p.evaluate(() => !!document.querySelector(".lines-none") && !!document.querySelector(".lines-new")));
await tap(".lines-new");
const fresh = await p.evaluate(() => ({ open: !document.querySelector(".line-sheet").hidden, title: document.querySelector(".line-sheet .ls-name-text")?.textContent, lines: window.woodrail.economy.lines.size, rings: window.woodrail.scene.getObjectByName("place-rings")?.visible ?? false }));
check("1. + New line opens the sheet: a new line, no line made yet, rings round the places to tap", fresh.open && fresh.title === "New line" && fresh.lines === 0 && fresh.rings, JSON.stringify(fresh));

// ---- 2. Places tapped by their buildings and yards ---------------------------------------------------------------
for (const [what, id] of [["the forest yard", setup.forest], ["the sawmill", setup.mill], ["the workshop's yard", setup.workshop]]) {
  const spot = await yardOf(id);
  await tapWorld(spot);
  const l = await sheetLine();
  check(`2. ${what} tapped by its building or yard: a stop`, !!l && l.stops.at(-1) === id, JSON.stringify({ l, spot }));
}
await shot("1-new-line-stops");
if (setup.house && setup.townStation !== -1) {
  await tapWorld(setup.house, 1600);
  const l = await sheetLine();
  check(`2. a house in ${setup.townName} tapped: its station is a stop`, !!l && l.stops.at(-1) === setup.townStation, JSON.stringify({ l, setup: setup.house }));
} else check("2. a town house to tap", false, JSON.stringify(setup));
const made = await sheetLine();
check("2. a line of four stops, run by no train", !!made && made.stops.length === 4 && made.trains.length === 0, JSON.stringify(made));

// ---- 4. Reorder by a handle, take off, ↑ ↓ -----------------------------------------------------------------------
const dragRow = async (from, to) => {
  const pts = await p.evaluate(([from, to]) => {
    const row = (k) => document.querySelector(`.ls-stop[data-stop='${k}']`);
    row(from).scrollIntoView({ block: "nearest" });
    const h = row(from).querySelector(".ls-handle").getBoundingClientRect();
    const t = row(to).getBoundingClientRect();
    return { x: h.x + h.width / 2, y: h.y + h.height / 2, ty: to < from ? t.top + 6 : t.bottom - 6 };
  }, [from, to]);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await touch("touchStart", pts.x, pts.y);
  for (let k = 1; k <= 12; k++) {
    await touch("touchMove", pts.x, pts.y + ((pts.ty - pts.y) * k) / 12);
    await p.waitForTimeout(25);
  }
  await touch("touchEnd", 0, 0);
  await p.waitForTimeout(600);
  await frames();
};
const before = await sheetLine();
await dragRow(3, 0);
const dragged = await sheetLine();
check("4. the town's stop dragged by its handle to the top", JSON.stringify(dragged?.stops) === JSON.stringify([before.stops[3], ...before.stops.slice(0, 3)]), JSON.stringify({ before: before?.stops, dragged: dragged?.stops }));
await tap(".ls-stop[data-stop='0'] .ls-stop-main");
await tap(".ls-stop.open .ls-remove");
const three = await sheetLine();
check("4. …opened and taken off: three stops, the forest's first", JSON.stringify(three?.stops) === JSON.stringify([setup.forest, setup.mill, setup.workshop]), JSON.stringify(three));
await tap(".ls-stop[data-stop='1'] .ls-stop-main");
await tap(".ls-stop.open .ls-down-btn");
const down = await sheetLine();
await tap(".ls-stop.open .ls-up-btn");
const up = await sheetLine();
check("4. ↓ then ↑ on the open stop move it and back", JSON.stringify(down?.stops) === JSON.stringify([setup.forest, setup.workshop, setup.mill]) && JSON.stringify(up?.stops) === JSON.stringify([setup.forest, setup.mill, setup.workshop]), JSON.stringify({ down, up }));

// ---- 5. An open stop ---------------------------------------------------------------------------------------------
const openStop = await p.evaluate(() => {
  const s = document.querySelector(".ls-stop.open");
  return { says: s?.querySelector(".ls-says")?.textContent ?? "", ticks: [...(s?.querySelectorAll(".ls-tick") ?? [])].map((t) => `${t.textContent}:${t.getAttribute("aria-pressed")}`) };
});
check("5. the sawmill's stop says what moves there: logs from the forest yard, planks for the workshop", /Drops .*logs from Forest yard/.test(openStop.says) && /Picks up .*planks for Workshop/.test(openStop.says), JSON.stringify(openStop));
check("5. …two ticks on (Drop, Pick up) and Wait to fill", openStop.ticks.join(",").includes("Drop:true") && openStop.ticks.join(",").includes("Pick up:true") && openStop.ticks.some((t) => t.startsWith("Wait to fill")), JSON.stringify(openStop));
await shot("3-open-stop");
await tap(".ls-stop.open .ls-pick");
const dropOnly = await sheetLine();
check("5. Pick up unticked: the stop only drops (tagged so)", dropOnly?.actions[1] === "drop" && (await p.evaluate(() => document.querySelector(".ls-stop[data-stop='1'] .ls-tag")?.textContent)) === "drop only", JSON.stringify(dropOnly));
await tap(".ls-stop.open .ls-pick");
check("5. …ticked again: drops and picks up", (await sheetLine())?.actions[1] === "auto");
check("5. the sheet's buttons are 44 px or more", (await small(".line-sheet")).length === 0, JSON.stringify(await small(".line-sheet")));
// (0 frames drawn idle, the sheet open and the game paused.)
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  w.paused = true;
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 2500));
  const n = w.framesDrawn - n0;
  w.paused = false;
  return n;
});
check("5. 0 frames drawn idle with the sheet open", idle === 0, `${idle} frames`);

// ---- 6. Done: the Lines list -------------------------------------------------------------------------------------
await tap(".ls-done");
await p.waitForFunction(() => { const v = document.querySelector(".lines-view"); return v && !v.hidden; }, null, { timeout: 15000 }).catch(() => {});
const listed = await p.evaluate(() => [...document.querySelectorAll(".lines-row")].map((r) => ({ name: r.querySelector(".lines-name")?.textContent, pill: r.querySelector(".lines-pill")?.textContent, stops: r.querySelectorAll(".lines-stop").length, ends: [...r.querySelectorAll(".lines-stop-name")].map((n) => n.textContent).filter(Boolean) })));
check("6. Done: back to the Lines list, the line there with No trains and its three stops drawn", listed.length === 1 && listed[0].pill === "No trains" && listed[0].stops === 3 && listed[0].ends[0].startsWith("Forest yard"), JSON.stringify(listed));
check("6. the list's buttons are 44 px or more", (await small(".lines-view")).length === 0, JSON.stringify(await small(".lines-view")));

// ---- 7. A train on it, and the line runs -------------------------------------------------------------------------
// (Harness shortcut, setup: a goods train put on the oval as the tray would, its lever on; the forest kept stocked.)
const engine = await p.evaluate((pieceId) => {
  const w = window.woodrail;
  const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed: false });
  if (r.kind !== "placed") return -1;
  const e = w.sim.getTrain(r.trainId).cars[0].id;
  w.sim.setLever(e, 1);
  w.invalidate();
  return e;
}, setup.placed[3]);
check("7. (setup) a goods train on the oval", engine !== -1);
await p.waitForTimeout(600);
await tap(".lines-row");
await p.waitForFunction(() => document.querySelector(".line-sheet .ls-tab.on")?.dataset.tab === "trains", null, { timeout: 10000 }).catch(() => {});
await p.waitForFunction(() => !!document.querySelector(".ls-add-train"), null, { timeout: 15000 }).catch(() => {});
const offered = await p.evaluate(() => [...document.querySelectorAll(".ls-add-train")].map((b) => Number(b.dataset.engine)));
check("7. the line with no train opens on its Trains tab: no train yet, the free train offered", offered.includes(engine) && !!(await p.evaluate(() => document.querySelector(".ls-empty"))), JSON.stringify(offered));
await shot("4-add-train");
await tap(`.ls-add-train[data-engine='${engine}']`);
const run = await sheetLine();
check("7. + Add: the train runs the line", run?.trains.includes(engine), JSON.stringify(run));
// The payoff: the game's own sim and economy ticks (as Game.frame runs them, ahead of SwiftShader's few frames).
const moved = await p.evaluate(async ({ forest, mill, lineId }) => {
  const w = window.woodrail;
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { PILE_CAP } = await import("/src/economy/constants.ts");
  let toMill = 0;
  for (let i = 0; i < 90 * 120; i++) {
    if (i % 120 === 0) w.economy.depot(forest).piles[CARGO.log.index] = PILE_CAP;
    w.sim.tick();
    w.economy.tick();
    for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === mill) toMill++;
  }
  w.invalidate();
  return { toMill, loads: w.economy.lineLoadsLately(lineId) };
}, { forest: setup.forest, mill: setup.mill, lineId: run.id });
check("7. the line runs: logs carried from the forest to the sawmill, counted as the line's loads", moved.toMill > 0 && moved.loads >= moved.toMill, JSON.stringify(moved));
await p.waitForTimeout(700);
await tap(".ls-tab", "Trains");
await p.waitForTimeout(600);
await shot("5-trains");
await tap(".ls-done");
await p.waitForTimeout(1200);
const health = await p.evaluate(() => [...document.querySelectorAll(".lines-row")].map((r) => ({ pill: r.querySelector(".lines-pill")?.textContent, loads: r.querySelector(".lines-loads")?.textContent ?? "", trains: r.querySelector(".lines-trains")?.textContent })));
check("7. the list says it's running: a train, its health, its loads a month", health[0]?.trains === "🚂 1" && ["Moving", "Waiting"].includes(health[0]?.pill) && /loads? a month/.test(health[0]?.loads), JSON.stringify(health));
await shot("6-lines-list");

// ---- 8. Copy, and a reload ---------------------------------------------------------------------------------------
await tap(".lines-row");
await tap(".ls-more");
// (⋯ opened the menu, Copy on it: else Copy was never tapped, and only the count below would say something's wrong.)
const menuOpen = await p.waitForSelector(".line-sheet:not([hidden]) .ls-copy", { timeout: 10000 }).then(() => true, () => false);
check("8. ⋯ opens the line's menu, Copy on it", menuOpen, menuOpen ? "" : JSON.stringify(await p.evaluate(() => ({ sheet: !document.querySelector(".line-sheet")?.hidden, more: !!document.querySelector(".ls-more"), expanded: document.querySelector(".ls-more")?.getAttribute("aria-expanded") ?? null, toast: document.querySelector(".toast.show")?.textContent ?? "" }))));
await tap(".ls-copy");
const lines = await p.evaluate(() => [...window.woodrail.economy.lines.values()].map((l) => ({ id: l.id, name: l.name, stops: l.stops.map((s) => s.depotId), trains: [...window.woodrail.economy.lineIdOf].filter(([, x]) => x === l.id).length })));
check("8. ⋯ Copy: a second line, the same stops, no train on it", lines.length === 2 && JSON.stringify(lines[0].stops) === JSON.stringify(lines[1].stops) && lines[1].trains === 0, JSON.stringify(lines));
await tap(".ls-done");
await p.waitForTimeout(2500); // (saved)
await p.reload();
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
const back = await p.evaluate(() => [...window.woodrail.economy.lines.values()].map((l) => ({ name: l.name, stops: l.stops.length, trains: [...window.woodrail.economy.lineIdOf].filter(([, x]) => x === l.id).length })));
check("8. after a reload: both lines, the copy still with no train", back.length === 2 && back.some((l) => l.trains === 1) && back.some((l) => l.trains === 0 && l.stops === 3), JSON.stringify(back));

// ---- 9. A town with no station (last: its shortcut, a station taken up, kept out of the save above) ------------
if (setup.other) {
  // (Harness shortcut: the second town's station taken up, so it has none.)
  await p.evaluate((townId) => {
    const w = window.woodrail;
    const d = w.economy.allDepots().find((x) => x.role === "town" && x.townId === townId);
    if (d) w.layout.removePiece(d.pieceId);
    w.trackChanged?.();
  }, setup.other.id);
  const cell = await p.evaluate((o) => {
    const w = window.woodrail;
    const t = w.world.landscape.towns.find((x) => x.id === o.id);
    const house = [...w.props.all()].find((q) => q.town === o.id && q.building !== undefined);
    return house ? { x: house.x, y: house.y ?? 0, z: house.z } : { x: t.centre.x, y: 0, z: t.centre.z };
  }, setup.other);
  // (Planning again: + New line, from the list.)
  await tap('button[aria-label="Menu"]');
  await tap(".menu button", "Lines");
  await tap(".lines-new");
  await tapWorld(cell, 1600);
  const said = await toastText();
  const after = await sheetLine();
  check(`9. ${setup.other.name}, with no station, tapped: "needs a station first", nothing added`, said.includes(`${setup.other.name} needs a station first`) && !after, JSON.stringify({ said, after }));
  await shot("2-needs-station");
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? `${checks}/${checks} passed` : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
