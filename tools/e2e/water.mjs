// End-to-end water transport (docs/superpowers/specs/2026-11-04-water-transport.md), Game mode on a 390×844 phone
// with touch, headless:
//  1. river: River barges learned; two river landings dragged from the Industries tab's Water shelf onto the river's
//     bank by a finger (a refusal first, dropped on dry land); logs on the first landing's jetty; its card's
//     "+ New barge" tapped (coins paid, the barge loads the logs, planning starts with this landing stop 1); the second
//     landing tapped (stop 2), Done; the boat sails by game time and drops the logs at the second landing (the payoff),
//     "Float goods down the river" ticked; a tap on the boat opens its card; + Barge; paused, it holds still; 0 frames
//     drawn idle with every boat tied up.
//  2. ship: the coast bought; Harbours and Cargo ships learned; a harbour by the sea (put down as the workshop would),
//     a lighthouse dragged from the Water shelf beside it (its card says so); planks on the quay; the cargo ship calls,
//     takes them and pays a town's full price (the payoff), "Send a ship abroad" ticked.
//  3. ferry: Train ferry learned; a ferry slip dragged from the Water shelf onto the shore, track behind it, a train
//     with planks put on its line; its route planned by taps (the engine, Plan a route, the slip, Done): it goes
//     aboard (its planks sold at full price, the train hidden, the ferry sailing), and comes back with goods from abroad.
//
// Usage: npm run e2e:water [-- <out dir>]   (default out: e2e-out/water). Pictures of each moment in the out dir.
import { boot, frames, glideTo, openMode, reporter, screenOf, settled, shot, tap, tryUntil } from "../../scripts/e2e/lib/e2e.mjs";

// (The test clock: the boats' runs wait on game time, and at a frame or two a second under SwiftShader a frame's 0.1 s
// step made 240 game seconds an hour of real time: a CI shard killed it at 20 min, mid-voyage. See lib/fast.mjs.)
const { page: p, url, out: OUT, errors, close, cdp: cdpOf } = await boot({ name: "water", port: 5398 });
const { check, finish } = reporter("water", { errors, close });
const cdp = await cdpOf();
const pic = (n) => shot(p, `${OUT}/${n}.jpg`, { quality: 85 });
const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
/** The camera on a point, from overhead-ish (in the room above any card: `inRoom`). */
const look = (v, dist = 1300) => glideTo(p, { x: v.x, y: 0, z: v.z }, dist, { inRoom: true });
/** A tap on a world point where it is on screen now. */
const tapWorld = async (v) => tap(p, await screenOf(p, v));
/** A tray tab, then a shelf on it, by their words (false if there's no such shelf). */
const openShelf = async (tab, shelf) => {
  await p.evaluate(() => window.woodrail.hud.hideCards());
  await tap(p, { sel: ".tabs button", text: tab });
  if (await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item .label")].some((l) => l.textContent === "Back"))) await tap(p, { sel: ".scroller .tray-item .label", text: "Back", exact: true });
  if (!(await p.evaluate((shelf) => [...document.querySelectorAll(".scroller .tray-group .label")].some((l) => l.textContent === shelf), shelf))) return false;
  await tap(p, { sel: ".scroller .tray-group .label", text: shelf, exact: true });
  return true;
};
/** A tray item dragged out by a finger and let go over a world point (the piece's middle there). */
const dragOut = async (key, v, want = null) => {
  await p.evaluate((key) => document.querySelector(`.scroller .tray-item[data-key="${key}"]`)?.scrollIntoView({ inline: "center" }), key);
  await frames(p);
  const from = await p.evaluate((key) => {
    const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, key);
  if (!from) return false;
  let [tx, ty] = await screenOf(p, v);
  let t = Date.now() / 1000;
  await touch("touchStart", from[0], from[1], t);
  for (let k = 1; k <= 16; k++) await touch("touchMove", from[0] + ((tx - from[0]) * k) / 16, from[1] + ((ty - from[1]) * k) / 16, (t += 0.04));
  // (A moment held still over the spot: the ghost settles there.)
  for (let k = 0; k < 4; k++) await touch("touchMove", tx, ty, (t += 0.05));
  await frames(p);
  // (Held, the ghost sits off the finger: nudged, as a player does, until it stands where it's wanted.)
  for (let n = 0; want && n < 3; n++) {
    const at = await p.evaluate(() => window.woodrail.interaction.mode?.pose ?? null);
    if (!at) break;
    const dx = want.x - at.x;
    const dz = want.z - at.z;
    if (Math.hypot(dx, dz) < 6) break;
    v = { x: v.x + dx, z: v.z + dz };
    const [nx, ny] = await screenOf(p, v);
    for (let k = 1; k <= 6; k++) await touch("touchMove", tx + ((nx - tx) * k) / 6, ty + ((ny - ty) * k) / 6, (t += 0.04));
    for (let k = 0; k < 3; k++) await touch("touchMove", nx, ny, (t += 0.05));
    [tx, ty] = [nx, ny];
    await frames(p);
  }
  if (process.env.WATER_DEBUG) await pic(`debug-drag-${key.replace(/[:]/g, "_")}-${Date.now() % 100000}`);
  if (process.env.WATER_DEBUG) console.log("drop", key, v, await p.evaluate(() => { const m = window.woodrail.interaction.mode; return JSON.stringify({ kind: m.kind, pose: m.pose, snap: m.snap?.kind, blocked: m.blocked ?? null, hint: m.hint ?? null }); }));
  await touch("touchEnd", 0, 0, (t += 0.05));
  await settled(p);
  return true;
};
const pieceIds = (type) => p.evaluate((type) => [...window.woodrail.layout.pieceIds()].filter((id) => window.woodrail.layout.getPiece(id).type === type), type);
/** Eighth turns given to the tray's next piece so far (it keeps them from one drag to the next). */
let trayTurns = 0;
/** The tray's ↻ Turn chip tapped `n` times (an eighth of a turn each: the next piece out turns with it). */
const turnTray = async (n) => {
  for (let k = 0; k < n; k++) {
    trayTurns = (trayTurns + 1) % 8;
    await tap(p, { sel: ".tray button.chip", text: "↻" });
  }
};
const toast = () => p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
/**
 * Game time passing (the page's own clock), up to `seconds` of it, till `done` is true in the page (null if not).
 * Bounded in real time too (lib/e2e.mjs `tryUntil`): game time that stops or crawls fails the check, not the run.
 */
const playUntil = async (fn, arg, seconds) => (await tryUntil(p, fn, arg, { game: seconds, polling: 1000 })) || null;

// A new game.
await p.goto(url);
await openMode(p, "game");

// ——— 1. River ———
// Setup (not what's tested): Train routes, Cranes 1 and River barges learned (a shortcut to the state), 400 coins, and
// two landings in the toy box (as the workshop's order would make them). A straight run of river on this map: where
// the landings go, on its flat bank.
const river = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const r of ["routes", "cranes1", "barges"]) w.learn(r);
  w.progress().coins = 400;
  w.hud.setCoins(400);
  w.progress().add("piece:kit-landing", 2);
  w.progress().add("piece:kit-boatyard", 1);
  w.hud.refreshTrayBadges();
  const { siteWhy } = await import("/src/game/industries.ts");
  const g = w.world.landscape.grid;
  // Landings on the −z bank of a river running along x: the piece's middle 100 back from the water's middle.
  const spots = [];
  const why = { runs: 0, site: 0, place: [] };
  // Either bank: the −z bank (the piece facing +x, its jetty out to +z) or the +z bank (facing −x, its jetty to −z).
  for (let i = 0; i < g.cellCount; i++) {
    if (g.surface[i] !== 1) continue;
    const c = g.colOf(i);
    const r = g.rowOf(i);
    const at = (dc, dr) => g.surface[g.index(c + dc, r + dr)] ?? -1;
    for (const side of [1, -1]) {
      let run = true;
      for (let k = -4; k <= 4; k++) if (at(k, 0) !== 1 || at(k, -side) === 1 || at(k, -2 * side) === 1 || at(k, 2 * side) === 1) run = false;
      if (!run) continue;
      why.runs++;
      const heading = side > 0 ? 0 : Math.PI;
      const cx = g.centreX(c);
      const pose = { x: cx - side * 108, z: g.centreZ(r) - side * 100, heading };
      const y = g.groundY(g.cellAtWorld(cx, pose.z));
      // (A landing: only on the −z bank, the way the tray's turned for them.)
      let landOk = side > 0 && siteWhy(w.world.landscape, "kit-landing", pose) === null;
      if (landOk) {
        why.site++;
        const no = w.interaction.placeWhy("kit-landing", pose, y, -1);
        if (no && why.place.length < 5) why.place.push(no);
        landOk = !no;
      }
      // (A boatyard, with room to spare: a drop snaps to the lattice, a square either way along the bank, a little
      // toward or away from the water.)
      const yardOk = [[-36, 0], [0, 0], [36, 0]].every(([dx, dz]) => {
        const q = { ...pose, x: pose.x + dx, z: pose.z + dz };
        return siteWhy(w.world.landscape, "kit-boatyard", q) === null && !w.interaction.placeWhy("kit-boatyard", q, g.groundY(g.cellAtWorld(cx + dx, q.z)), -1);
      });
      // (And clear of other track: a drop near a free end snaps to it.)
      const clear = [...w.layout.pieceIds()].every((id) => Math.hypot(w.layout.getPiece(id).pose.x - cx, w.layout.getPiece(id).pose.z - pose.z) > 520);
      spots.push({ ...pose, mid: { x: cx, z: pose.z }, landOk, yardOk: yardOk && clear });
    }
  }
  // Two far apart on the same water.
  const { waterAt } = await import("/src/game/boats.ts");
  let best = null;
  const lands = spots.filter((s) => s.landOk);
  for (const a of lands)
    for (const b of lands)
      if (waterAt(w.world.landscape, { x: a.mid.x, z: a.mid.z + 100 }) === waterAt(w.world.landscape, { x: b.mid.x, z: b.mid.z + 100 }) && Math.abs(a.x - b.x) > 500 && (!best || Math.abs(a.x - b.x) > Math.abs(best[0].x - best[1].x))) best = [a, b];
  // A boatyard's spot on the same water, clear of both.
  const wet = (s) => waterAt(w.world.landscape, { x: s.mid.x, z: s.mid.z + 100 });
  const c = best && spots.filter((s) => s.yardOk && wet(s) === wet(best[0]) && Math.abs(s.x - best[0].x) > 320 && Math.abs(s.x - best[1].x) > 320).sort((u, v) => Math.abs(u.x - best[0].x) - Math.abs(v.x - best[0].x))[0];
  return best && c ? { a: best[0], b: best[1], c, n: spots.length } : { n: spots.length, why };
});
check("a straight run of river with room for two landings", !!river.a, JSON.stringify(river));
// (WATER_SKIP_RIVER=1: on to the sea, for working on its groups.)
if (river.a && !process.env.WATER_SKIP_RIVER) {
  const { a, b: bb, c: cc } = river;
  // The Water shelf.
  const shelfOk = await openShelf("Industries", "Water");
  check("the Industries tab has a Water shelf once River barges is learned", shelfOk);
  const keys = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item[data-key]")].map((e) => e.dataset.key));
  check("…with the river landing on it", keys.includes("piece:kit-landing"), JSON.stringify(keys));
  await pic("1-water-shelf");
  // Dropped on dry land, far from the water: refused, saying why.
  await look(a.mid, 1500);
  await dragOut("piece:kit-landing", { x: a.mid.x, z: a.mid.z - 500 });
  const refused = (await pieceIds("kit-landing")).length === 0;
  if (process.env.WATER_DEBUG) console.log("heading", await p.evaluate(() => JSON.stringify([...window.woodrail.layout.pieceIds()].slice(-3).map((id) => window.woodrail.layout.getPiece(id)))));
  if (process.env.WATER_DEBUG) console.log("after dry drop", JSON.stringify(await pieceIds("kit-landing")), await p.evaluate(() => JSON.stringify([window.woodrail.progress().owned.get("piece:kit-landing"), window.woodrail.layout.pieceIds().length])));
  check("a landing dropped on dry land is refused", refused, await toast());
  // On the bank, turned so its jetty faces the water (the tray's ↻ Turn, half way round): placed.
  await openShelf("Industries", "Water");
  await turnTray(Number(process.env.WATER_TURNS ?? 4));
  await look(a.mid, 1500);
  await dragOut("piece:kit-landing", a.mid);
  await openShelf("Industries", "Water");
  await look(bb.mid, 1500);
  await dragOut("piece:kit-landing", bb.mid);
  const landings = await p.evaluate(() => {
    const w = window.woodrail;
    return [...w.layout.pieceIds()]
      .filter((id) => w.layout.getPiece(id).type === "kit-landing")
      .map((id) => ({ piece: id, depot: w.economy.depotAtPiece(id)?.id, role: w.economy.depotAtPiece(id)?.role, x: w.layout.getPiece(id).pose.x, z: w.layout.getPiece(id).pose.z, heading: w.layout.getPiece(id).pose.heading }));
  });
  check("two landings dragged out onto the river bank, each a landing depot", landings.length === 2 && landings.every((l) => l.role === "landing"), JSON.stringify(landings));
  if (landings.length === 2) {
    // Logs on the first landing's jetty (setup: as a train set to drop them there would leave them).
    const [A, B] = [...landings].sort((u, v) => Math.hypot(u.x - a.x, u.z - a.z) - Math.hypot(v.x - a.x, v.z - a.z));
    await p.evaluate(async (id) => {
      const { CARGO } = await import("/src/economy/cargo.ts");
      window.woodrail.economy.depot(id).piles[CARGO.log.index] = 8;
    }, A.depot);
    const quay = (L) => ({ x: L.x + Math.cos(L.heading) * 108 - Math.sin(L.heading) * 45, z: L.z + Math.sin(L.heading) * 108 + Math.cos(L.heading) * 45 });
    await look(quay(A), 1100);
    await tapWorld(quay(A));
    if (process.env.WATER_DEBUG) await pic("debug-landing-tap");
    const card = await p.evaluate(() => document.querySelector(".depot-card:not(.boat-card):not([hidden]) .card-title")?.textContent ?? null);
    if (process.env.WATER_DEBUG) console.log("cards", await p.evaluate(() => [...document.querySelectorAll(".card:not([hidden])")].map((c) => c.className + ":" + c.textContent.slice(0, 60)).join(" || ")));
    check("a tap on the landing opens its card", card === "River landing", String(card));
    await pic("2-landing-card");
    // A boatyard from the Water shelf onto the bank (the tray still turned to face the water).
    // (Refused, a player moves it a little nearer the water and tries again: the yard's grab point is its model's
    // middle, out from its line.)
    for (const dz of [0, 24, 48, -24]) {
      if ((await pieceIds("kit-boatyard")).length > 0) break;
      await openShelf("Industries", "Water");
      // (Turned to face the water: the tray's next piece faces half way round to start with.)
      const want = (((Math.round((cc.heading - Math.PI) / (Math.PI / 4)) % 8) + 8) % 8);
      await turnTray((want - trayTurns + 8) % 8);
      await look(cc.mid, 1500);
      await dragOut("piece:kit-boatyard", { x: cc.mid.x, z: cc.mid.z + dz * (cc.heading === 0 ? 1 : -1) }, { x: cc.x, z: cc.z + dz * (cc.heading === 0 ? 1 : -1) });
      if (process.env.WATER_DEBUG) console.log("yard drop", dz, await p.evaluate(() => JSON.stringify({ kits: [...window.woodrail.layout.pieceIds()].map((id) => window.woodrail.layout.getPiece(id).type).filter((t) => t.startsWith("kit")), owned: window.woodrail.progress().owned.get("piece:kit-boatyard"), avail: window.woodrail.progress().available(window.woodrail.world, "piece:kit-boatyard"), toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent) })));
    }
    const C = await p.evaluate(() => {
      const w = window.woodrail;
      const id = [...w.layout.pieceIds()].find((i) => w.layout.getPiece(i).type === "kit-boatyard");
      return id === undefined ? null : { piece: id, depot: w.economy.depotAtPiece(id)?.id, role: w.economy.depotAtPiece(id)?.role, x: w.layout.getPiece(id).pose.x, z: w.layout.getPiece(id).pose.z, heading: w.layout.getPiece(id).pose.heading };
    });
    check("a boatyard dragged from the Water shelf onto the bank", C?.role === "boatyard", JSON.stringify({ C, cc, toast: await toast() }));
    if (!C) throw new Error("no boatyard");
    // Its card: build a tug and a barge.
    await look(quay(C), 1100);
    await tapWorld(quay(C));
    await p.waitForSelector(".yard-build[data-build=tug]", { timeout: 20000 }).catch(() => {});
    await tap(p, ".yard-build[data-build=tug]");
    const ordered = await p.evaluate((id) => window.woodrail.economy.yardOrders.get(id)?.build ?? null, C.depot);
    check("its card: Build a tug and a barge, ordered", ordered === "tug", String(ordered));
    // Half the goods, as trains bring them (setup: on its piles, as a train's crane would leave them): half built.
    const bringTo = (id, goods) =>
      p.evaluate(
        async ([id, goods]) => {
          const { CARGO } = await import("/src/economy/cargo.ts");
          const d = window.woodrail.economy.depot(id);
          for (const [k, n] of Object.entries(goods)) d.piles[CARGO[k].index] += n;
        },
        [id, goods],
      );
    await bringTo(C.depot, { planks: 10, iron: 2 });
    const half = await playUntil(
      async (id) => {
        const { progressOf } = await import("/src/game/yards.ts");
        const o = window.woodrail.economy.yardOrders.get(id);
        // (The card redraws on the frame after the tick that put the goods in.)
        const needs = document.querySelector(".yard-needs")?.textContent ?? "";
        return o && progressOf(o) >= 0.5 && /10/.test(needs) ? { needs } : null;
      },
      C.depot,
      10,
    );
    check("…half the goods in: half built, the card saying what's still to come by train", !!half && /Still to come by train: 10.*planks.*2.*iron/.test(half.needs), JSON.stringify(half));
    await p.waitForTimeout(1500);
    await pic("3-yard-building");
    await bringTo(C.depot, { planks: 10, iron: 2 });
    const launched = await playUntil(() => (window.woodrail.economy.boats.size > 0 ? [...window.woodrail.economy.boats.values()][0] : null), null, 10);
    check("…the rest in: the tug and its barge slide into the river at the yard (the payoff)", !!launched && launched.home === C.depot && launched.barges === 1, JSON.stringify(launched));
    await p.waitForTimeout(1200);
    await pic("4-launched");
    // Its route: from the boat's chip on the yard's card, ✎ Route, the two landings, Done; the first landing set to
    // drop and pick up (a tap on its chip).
    await tap(p, ".landing-boat-chips .chip");
    // (A boat with no route yet opens planning: ✎ Route only if it didn't.)
    await p.waitForSelector(".boat-card:not([hidden]) .route-plan", { timeout: 20000 });
    if (!(await p.evaluate(() => !!document.querySelector(".boat-card .route-plan.on")))) await tap(p, ".boat-card .route-plan");
    await look(quay(A), 1300);
    await tapWorld(quay(A));
    await look(quay(B), 1300);
    await tapWorld(quay(B));
    await pic("5-planning");
    await tap(p, ".boat-card .route-plan.on");
    const chip2 = await p.evaluate(() => {
      const e = document.querySelectorAll(".boat-card .route-chip")[1];
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    });
    if (chip2) await tap(p, chip2);
    const route = await p.evaluate(() => [...window.woodrail.economy.boats.values()][0].stops);
    check("the route planned by taps: the yard, the first landing (drop and pick up), the second (only drop)", route.length === 3 && route[0].depotId === C.depot && route[1].depotId === A.depot && route[2].depotId === B.depot && route[1].action === "both" && route[2].action === "drop", JSON.stringify(route));
    // It sails, by game time, and drops the logs at the second landing.
    await look({ x: (A.x + B.x) / 2 + 108, z: A.z + 120 }, 2200);
    await p.evaluate(() => window.woodrail.hud.hideCards());
    const sailing = await playUntil(() => [...window.woodrail.economy.boats.values()][0]?.docked === false, null, 30);
    check("it sets off down the river", !!sailing);
    await p.waitForTimeout(6000);
    // (The camera on the tow, for its picture.)
    const tow = await p.evaluate(() => {
      const o = window.woodrail.riverBoats.tugOf([...window.woodrail.economy.boats.keys()][0]);
      return o ? { x: o.position.x, z: o.position.z } : null;
    });
    if (tow) await look(tow, 1100);
    await pic("6-sailing");
    const delivered = await playUntil(
      async (B) => {
        const { CARGO } = await import("/src/economy/cargo.ts");
        const w = window.woodrail;
        const n = w.economy.depot(B).piles[CARGO.log.index];
        return n > 0 ? { n, delivered: w.economy.boatDelivered } : null;
      },
      B.depot,
      240,
    );
    check("the logs come off at the second landing (the payoff)", !!delivered && delivered.n === 4 && delivered.delivered === 4, JSON.stringify(delivered));
    const goal = await playUntil(() => window.woodrail.goals().isDone("float-goods"), null, 10);
    check("…and Float goods down the river is ticked", !!goal);
    await look(quay(B), 1000);
    await pic("7-delivered");
    // A tap on the boat: its card.
    const tug = await p.evaluate(() => {
      const o = window.woodrail.riverBoats.tugOf([...window.woodrail.economy.boats.keys()][0]);
      return o ? { x: o.position.x, y: 10, z: o.position.z } : null;
    });
    if (tug) {
      await look(tug, 900);
      await tapWorld(tug);
    }
    const boatCard = await p.evaluate(() => (document.querySelector(".boat-card")?.hidden === false ? document.querySelector(".boat-card .boat-name")?.textContent : null));
    check("a tap on the boat opens its card", !!boatCard, String(boatCard));
    await pic("8-boat-card");
    // Another barge, built at the boatyard from 8 planks.
    await look(quay(C), 1100);
    await tapWorld(quay(C));
    await p.waitForSelector(".yard-build[data-build=barge]", { timeout: 20000 }).catch(() => {});
    await tap(p, ".yard-build[data-build=barge]");
    await bringTo(C.depot, { planks: 8 });
    const barges = await playUntil(() => ([...window.woodrail.economy.boats.values()][0].barges === 2 ? 2 : null), null, 10);
    check("a barge built at the boatyard from 8 planks joins the tug", barges === 2, String(barges));
    // Paused: it holds still (its place by game time).
    await p.evaluate(() => (window.woodrail.paused = true));
    const at0 = await p.evaluate(() => JSON.stringify(window.woodrail.fleet.poses([...window.woodrail.economy.boats.values()][0], 0)));
    await p.waitForTimeout(3000);
    const at1 = await p.evaluate(() => JSON.stringify(window.woodrail.fleet.poses([...window.woodrail.economy.boats.values()][0], 0)));
    check("paused, the boat holds still", at0 === at1);
    await p.evaluate(() => (window.woodrail.paused = false));
    // Idle with every boat tied up: no frames drawn.
    await p.evaluate(() => {
      for (const bt of window.woodrail.economy.boats.values()) bt.going = false;
      window.woodrail.hud.hideCards();
    });
    await settled(p);
    const drawn = await p.evaluate(async () => {
      const w = window.woodrail;
      const before = w.framesDrawn;
      await new Promise((r) => setTimeout(r, 3000));
      return w.framesDrawn - before;
    });
    check("idle with the boats tied up: no frames drawn", drawn === 0, `${drawn} frames`);
  }
}

// ——— 2. Ship ———
// Setup (not what's tested): the coast bought (as Add land would), Harbours, Cargo ships and Lighthouse learned, a
// harbour by the sea put down (as the workshop's would be: the harbour isn't what's tested), a lighthouse in the toy
// box, and planks and stone on its quay (as trains would leave them).
const sea = await p.evaluate(async () => {
  const w = window.woodrail;
  const { plotsForSale, syncIndustries } = await import("/src/game/world.ts");
  const { siteWhy } = await import("/src/game/industries.ts");
  const { QUAY } = await import("/src/game/harbours.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const coast = w.world.landscape.coast;
  for (const q of plotsForSale(w.world.landscape)) if ((coast.side === "s" && q.pz === coast.plot) || (coast.side === "n" && q.pz === -coast.plot) || (coast.side === "e" && q.px === coast.plot) || (coast.side === "w" && q.px === -coast.plot)) w.unlockPlot(q.px, q.pz);
  for (const r of ["warehouses", "bridges", "harbours", "shipyards", "cargo-ships", "lighthouse", "junctions", "ferry"]) w.learn(r);
  w.progress().add("piece:kit-shipyard", 1);
  w.progress().add("prop:bldg-lighthouse", 1);
  w.progress().add("piece:kit-ferry-slip", 1);
  w.progress().coins = 400;
  w.hud.setCoins(400);
  w.hud.refreshTrayBadges();
  const g = w.world.landscape.grid;
  let harbour = null;
  for (let i = 0; i < g.cellCount && !harbour; i++) {
    if (g.surface[i] !== 5) continue;
    const col = g.colOf(i);
    const row = g.rowOf(i);
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const pose = { x: g.centreX(col) - c * QUAY.t + s * QUAY.l, z: g.centreZ(row) - s * QUAY.t - c * QUAY.l, heading };
      const under = g.cellAtWorld(pose.x + c * 108, pose.z + s * 108);
      if (under === -1 || g.surface[under] === 5 || g.surface[under] === 1) continue;
      if (siteWhy(w.world.landscape, "depot-harbour", pose) !== null) continue;
      if (w.interaction.placeWhy("depot-harbour", pose, g.groundY(under), -1)) continue;
      harbour = pose;
      break;
    }
  }
  if (!harbour) return null;
  const id = w.editor().place("depot-harbour", harbour, g.groundY(g.cellAtWorld(harbour.x + Math.cos(harbour.heading) * 108, harbour.z + Math.sin(harbour.heading) * 108)), false);
  syncIndustries(w.world, true);
  w.depotView.setWorld(w.economy, w.layout);
  const d = w.economy.depotAtPiece(id);
  // Where a lighthouse could stand: land a few squares from the quay, clear of the harbour's yard.
  const q = { x: harbour.x + Math.cos(harbour.heading) * QUAY.t - Math.sin(harbour.heading) * QUAY.l, z: harbour.z + Math.sin(harbour.heading) * QUAY.t + Math.cos(harbour.heading) * QUAY.l };
  let light = null;
  for (const r of [260, 220, 300, 180, 340])
    for (let k = 0; k < 16 && !light; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = q.x + Math.cos(a) * r;
      const z = q.z + Math.sin(a) * r;
      const cell = g.cellAtWorld(x, z);
      if (cell === -1 || g.surface[cell] === 5 || g.surface[cell] === 1) continue;
      if (Math.hypot(x - (harbour.x + Math.cos(harbour.heading) * 108), z - (harbour.z + Math.sin(harbour.heading) * 108)) < 200) continue;
      light = { x, z };
    }
  // A shipyard's spot on the shore, well clear of the harbour: its ways (out across its line) down into the sea.
  const { shipyardWhy } = await import("/src/game/yards.ts");
  let yard = null;
  for (let i = 0; i < g.cellCount && !yard; i++) {
    if (g.surface[i] !== 5) continue;
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const c = Math.cos(heading);
      const s = Math.sin(heading);
      const pose = { x: g.centreX(g.colOf(i)) - c * 108 + s * 130, z: g.centreZ(g.rowOf(i)) - s * 108 - c * 130, heading };
      if (Math.hypot(pose.x - harbour.x, pose.z - harbour.z) < 600) continue;
      const under = g.cellAtWorld(pose.x + c * 108, pose.z + s * 108);
      if (under === -1 || g.surface[under] === 5) continue;
      const shifted = [[0, 0], [36, 0], [-36, 0], [0, 54], [0, -54]].map(([side, along]) => ({ x: pose.x - s * side + c * along, z: pose.z + c * side + s * along, heading }));
      if (shifted.some((q) => shipyardWhy(w.world.landscape, q) !== null)) continue;
      if (w.interaction.placeWhy("kit-shipyard", pose, g.groundY(under), -1)) continue;
      yard = { ...pose, mid: { x: pose.x + c * 108, z: pose.z + s * 108 } };
      break;
    }
  }
  return { harbour, depot: d.id, quay: q, light, yard, coins: w.progress().coins };
});
check("the coast bought and a harbour by the sea", !!sea, JSON.stringify(sea));
if (sea) {
  // The lighthouse, from the Water shelf onto the shore near the harbour.
  if (sea.light) {
    await openShelf("Industries", "Water");
    await look(sea.light, 1300);
    await dragOut("prop:bldg-lighthouse", sea.light);
  }
  const lit = await p.evaluate(() => [...window.woodrail.world.props.all()].filter((x) => x.asset === "bldg-lighthouse").map((x) => ({ x: x.x, z: x.z })));
  check("a lighthouse dragged from the Water shelf onto the shore", lit.length === 1, JSON.stringify({ lit, toast: await toast() }));
  const card = await p.evaluate(async (id) => {
    const w = window.woodrail;
    const { lighthouseNear } = await import("/src/game/harbours.ts");
    return lighthouseNear(w.world, w.layout.getPiece(w.economy.depot(id).pieceId).pose);
  }, sea.depot);
  check("…near the harbour: its ships come twice as often", card === true);
  // A shipyard from the Water shelf onto the shore: a cargo ship built there from goods brought by train, then a ferry.
  if (sea.yard) {
    await openShelf("Industries", "Water");
    const want = (((Math.round((sea.yard.heading - Math.PI) / (Math.PI / 4)) % 8) + 8) % 8);
    await turnTray((want - trayTurns + 8) % 8);
    await look(sea.yard.mid, 1600);
    await dragOut("piece:kit-shipyard", sea.yard.mid, sea.yard);
  }
  const Y = await p.evaluate(() => {
    const w = window.woodrail;
    const id = [...w.layout.pieceIds()].find((i) => w.layout.getPiece(i).type === "kit-shipyard");
    return id === undefined ? null : { depot: w.economy.depotAtPiece(id)?.id, role: w.economy.depotAtPiece(id)?.role, pose: w.layout.getPiece(id).pose };
  });
  check("a shipyard dragged from the Water shelf onto the shore", Y?.role === "shipyard", JSON.stringify({ Y, yard: sea.yard, toast: await toast() }));
  if (Y) {
    const yq = { x: Y.pose.x + Math.cos(Y.pose.heading) * 108 - Math.sin(Y.pose.heading) * 50, z: Y.pose.z + Math.sin(Y.pose.heading) * 108 + Math.cos(Y.pose.heading) * 50 };
    const build = async (what, goods) => {
      await look(yq, 1400);
      await tapWorld({ ...yq, y: 12 });
      await p.waitForSelector(`.yard-build[data-build=${what}]`, { timeout: 20000 }).catch(() => {});
      await tap(p, `.yard-build[data-build=${what}]`);
      await p.evaluate(
        async ([id, goods]) => {
          const { CARGO } = await import("/src/economy/cargo.ts");
          const d = window.woodrail.economy.depot(id);
          for (const [k, n] of Object.entries(goods)) d.piles[CARGO[k].index] += n;
        },
        [Y.depot, goods],
      );
    };
    // (Setup: the goods put on its piles, as trains' cranes would leave them; first half the iron, for its picture.)
    await build("ship", { iron: 15, planks: 20, tools: 6 });
    await p.waitForTimeout(2500);
    await pic("9-shipyard-building");
    await p.evaluate(async (id) => {
      const { CARGO } = await import("/src/economy/cargo.ts");
      window.woodrail.economy.depot(id).piles[CARGO.iron.index] += 15;
    }, Y.depot);
    const ships = await playUntil(() => window.woodrail.economy.shipsBuilt || null, null, 10);
    check("a cargo ship built at the shipyard from iron, planks and tools, launched into the sea", ships === 1, String(ships));
    await build("ferry", { iron: 20, planks: 16, tools: 4 });
    const ferries = await playUntil(() => window.woodrail.economy.ferriesBuilt || null, null, 10);
    check("…and a train ferry", ferries === 1, String(ferries));
  }
  // Planks and stone on the quay (as trains would leave them), once there's a cargo ship.
  await p.evaluate(async (id) => {
    const { CARGO } = await import("/src/economy/cargo.ts");
    const d = window.woodrail.economy.depot(id);
    d.piles[CARGO.planks.index] = 14;
    d.piles[CARGO.stone.index] = 6;
  }, sea.depot);
  // The cargo ship calls, takes the goods and pays a town's full price.
  await look(sea.quay, 1600);
  const coins0 = await p.evaluate(() => window.woodrail.progress().coins);
  const sold = await playUntil(() => (window.woodrail.economy.shipLoads > 0 ? { loads: window.woodrail.economy.shipLoads, coins: window.woodrail.progress().coins } : null), null, 220);
  const full = await p.evaluate(async () => {
    const { PRICES } = await import("/src/game/towns.ts");
    return 14 * PRICES.planks + 6 * PRICES.stone;
  });
  check("a cargo ship calls and takes the 20 loads off the quay at a town's full price (the payoff)", !!sold && sold.loads === 20 && sold.coins - coins0 === full, JSON.stringify({ sold, coins0, full }));
  const goal = await playUntil(() => window.woodrail.goals().isDone("ship-abroad"), null, 10);
  check("…and Send a ship abroad is ticked", !!goal);
  await p.evaluate(() => window.woodrail.hud.hideCards());
  await p.waitForTimeout(1500);
  await pic("10-cargo-ship");

  // ——— 3. Ferry ———
  // A ferry slip from the Water shelf onto the shore, turned to face the sea.
  const slipAt = await p.evaluate(async () => {
    const w = window.woodrail;
    const { slipWhy } = await import("/src/game/ferry.ts");
    const g = w.world.landscape.grid;
    for (let i = 0; i < g.cellCount; i++) {
      if (g.surface[i] !== 5) continue;
      for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const c = Math.cos(heading);
        const s = Math.sin(heading);
        const pose = { x: g.centreX(g.colOf(i)) - c * 256, z: g.centreZ(g.rowOf(i)) - s * 256, heading };
        const back = g.cellAtWorld(pose.x - c * 216, pose.z - s * 216);
        const start = g.cellAtWorld(pose.x, pose.z);
        if (back === -1 || start === -1 || g.surface[start] === 5 || g.surface[back] === 5) continue;
        // (Room to spare: it still meets the sea dropped a square to either side, or a little along.)
        const shifted = [[0, 0], [72, 0], [-72, 0], [0, 36], [0, -36]].map(([side, along]) => ({ x: pose.x - s * side + c * along, z: pose.z + c * side + s * along, heading }));
        if (shifted.some((q) => slipWhy(w.world.landscape, q) !== null)) continue;
        if (w.interaction.placeWhy("kit-ferry-slip", pose, g.groundY(start), -1)) continue;
        if (w.interaction.placeWhy("straight-216", { x: pose.x - c * 216, z: pose.z - s * 216, heading }, g.groundY(back), -1)) continue;
        // (Clear of the harbour and its ship's way.)
        if ([...w.layout.pieceIds()].some((id) => Math.hypot(w.layout.getPiece(id).pose.x - pose.x, w.layout.getPiece(id).pose.z - pose.z) < 700)) continue;
        return { ...pose, mid: { x: pose.x + c * 108, z: pose.z + s * 108 } };
      }
    }
    return null;
  });
  check("a shore for a ferry slip", !!slipAt, JSON.stringify(slipAt));
  if (slipAt) {
    await openShelf("Industries", "Water");
    // (The tray's next piece faces half way round: eighth turns to bring it to face the sea.)
    const want = (((Math.round((slipAt.heading - Math.PI) / (Math.PI / 4)) % 8) + 8) % 8);
    const turns = (want - trayTurns + 8) % 8;
    await turnTray(turns);
    await look(slipAt.mid, 1500);
    await dragOut("piece:kit-ferry-slip", slipAt.mid);
    if (process.env.WATER_DEBUG) console.log("slip pieces", await p.evaluate(() => JSON.stringify([...window.woodrail.layout.pieceIds()].slice(-2).map((id) => window.woodrail.layout.getPiece(id)))));
    const slip = await p.evaluate(() => {
      const w = window.woodrail;
      const id = [...w.layout.pieceIds()].find((i) => w.layout.getPiece(i).type === "kit-ferry-slip");
      return id === undefined ? null : { piece: id, depot: w.economy.depotAtPiece(id)?.id, role: w.economy.depotAtPiece(id)?.role, pose: w.layout.getPiece(id).pose };
    });
    check("a ferry slip dragged from the Water shelf onto the shore, its end at the sea", !!slip && slip.role === "slip", JSON.stringify({ slip, toast: await toast() }));
    if (slip) {
      // Setup: the line to it (as Draw would lay it) and a train on it with planks (as the tray would put one down).
      const train = await p.evaluate(async (slip) => {
        const w = window.woodrail;
        const { connectorRef } = await import("/src/track/layout.ts");
        const { appendPiece } = await import("/src/track/index.ts");
        appendPiece(w.layout, "straight-216", false, connectorRef(slip.piece, 0));
        w.syncKits?.(true);
        const placed = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: slip.piece, pathIndex: 0, reversed: false, s: 150 });
        if (placed.kind !== "placed") return { error: placed.kind };
        const t = w.sim.getTrain(placed.trainId);
        w.economy.setCargo(t.cars[1].id, "planks", 3);
        w.economy.setCargo(t.cars[2].id, "planks", 3);
        w.invalidate();
        return { engine: t.cars[0].id, cars: t.cars.map((c) => c.id) };
      }, slip);
      check("a train with 6 planks on the slip's line", !train.error, JSON.stringify(train));
      if (!train.error) {
        // Its route by taps: the engine, Plan a route, the slip, Done.
        const engineAt = await p.evaluate((id) => {
          const f = window.woodrail.sim.findCar(id);
          const [a, c] = [f.train.world[0], f.train.world[1]];
          return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
        }, train.engine);
        await look(engineAt, 1000);
        await tapWorld(engineAt);
        await tryUntil(p, () => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 });
        if (process.env.WATER_DEBUG) await pic("debug-engine-tap");
        await tap(p, ".engine-extra .route-plan");
        // (Its coins before: it goes aboard as soon as its route has the slip, at the next second of play.)
        const coins1 = await p.evaluate(() => window.woodrail.progress().coins);
        // (Where the slip stands: the drop snapped it to the lattice.)
        const slipMid = { x: slip.pose.x + Math.cos(slip.pose.heading) * 60, y: 12, z: slip.pose.z + Math.sin(slip.pose.heading) * 60 };
        await look(slipMid, 1300);
        await tapWorld(slipMid);
        if (process.env.WATER_DEBUG) await pic("debug-slip-tap");
        await tap(p, ".line-sheet .route-plan.on");
        const routed = await p.evaluate((id) => window.woodrail.economy.routeOf(id)?.stops.map((s) => s.depotId) ?? null, train.engine);
        check("its route planned by taps: the ferry slip", !!routed && routed.includes(slip.depot), JSON.stringify(routed));
        await p.evaluate(() => window.woodrail.hud.hideCards());
        await look({ x: slipAt.mid.x + Math.cos(slipAt.heading) * 500, z: slipAt.mid.z + Math.sin(slipAt.heading) * 500 }, 2000);
        const aboard = await playUntil((id) => (window.woodrail.economy.held.has(id) ? { coins: window.woodrail.progress().coins, hidden: window.woodrail.trainView.carObject(id)?.visible === false } : null), train.engine, 20);
        await p.waitForTimeout(500);
        const aboard2 = await p.evaluate((id) => window.woodrail.trainView.carObject(id)?.visible === false, train.engine);
        const plankPrice = await p.evaluate(async () => (await import("/src/game/towns.ts")).PRICES.planks);
        check("aboard the ferry: its planks sold abroad at a town's full price, the train off the line", !!aboard && aboard.coins - coins1 === 6 * plankPrice && aboard2, JSON.stringify({ aboard, aboard2, coins1 }));
        await p.waitForTimeout(6000);
        await pic("11-ferry-out");
        const back = await playUntil(
          (cars) => {
            const w = window.woodrail;
            if (w.economy.held.has(cars[0]) || w.trainView.carObject(cars[0])?.visible !== true) return null;
            return { loads: cars.map((c) => w.economy.cargoOf(c)), visible: w.trainView.carObject(cars[0])?.visible };
          },
          train.cars,
          130,
        );
        check("back from abroad with its wagons full of goods from abroad, on the line again", !!aboard && !!back && back.loads[1].count > 0 && back.loads[1].kind !== "planks" && back.loads[2].count > 0 && back.visible === true, JSON.stringify(back));
        await look(slipAt.mid, 1200);
        await pic("12-ferry-back");
      }
    }
  }
}

await finish();
