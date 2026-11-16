// End-to-end: depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md), Game mode on a 390×844 phone with
// touch. Setup (shortcuts, not what's tested): Sidings and Routes learned; on open ground a line laid by the editor:
// five straights at an eighth's turn, a curve, a short straight (2 squares) and a mill, then three straights, a
// workshop and a straight: the curve 2 squares from the mill's end (where the ladder of crossovers needed 4½); the
// workshop stocked with the planks and stone the upgrades cost; the mill with flour.
// Then, by the player's taps:
//   1. A tap on the mill: its card says one track, and offers "Second track · 10 planks"; the stretch it takes lit on
//      the map (green).
//   2. A tap on it: a second track beside the mill, a short split at each end (the one at the curve's end right
//      against the curve), the crane's gantry over both, 10 planks taken. Undo (the top bar) takes it all back and
//      gives the planks back; a tap lays it again.
//   3. Two trains put down on the line beyond the curve (as the tray would), each with two hoppers of grain, given a
//      route by taps (Plan a route, the mill, the workshop, Done) and set going: they stand at the mill on its two
//      tracks at once, the one crane serving each in turn (never two loads at once), and both trains' grain lands on
//      the mill's pile (the payoff).
//   4. "Third track": greyed, the card saying what's in the way and where (2 squares before a curve at one end; it
//      needs 4), the curve lit red on the map. Then (setup: the trains taken off and the curve's end of the line laid
//      straight by the editor) a tap lays a third, 12 planks and 10 stone, the gantry over all three; no button after.
//   5. Reloaded, the game continued from its save: the mill still has three tracks, its gantry over them.
//   6. Idle: nothing moving draws no frames.
//
// Usage: npm run e2e:depot-tracks [-- <out dir>]   (default out: e2e-out/depot-tracks)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/depot-tracks";
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
    const along = what.along ?? 108;
    const across = what.across ?? 60;
    return { x: q.x + Math.cos(q.heading) * along - Math.sin(q.heading) * across, y: piece.y, z: q.z + Math.sin(q.heading) * along + Math.cos(q.heading) * across };
  }, what);
const onScreen = async (what) => {
  const v = await worldAt(what);
  return p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
  }, v);
};
const showing = async (what, dist = 1300, opts = {}) => {
  const v = await worldAt(what);
  await p.evaluate(([v, dist, opts]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2, ...opts }), [v, dist, opts]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapOn = async (what) => {
  await showing(what);
  const [x, y] = await onScreen(what);
  await tapped(() => p.touchscreen.tap(x, y));
};
const tapButton = async (sel) => {
  await p.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0), sel, { timeout: 30000 });
  await frames();
  await p.waitForTimeout(400);
  const [x, y] = await p.evaluate((sel) => {
    const r = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);
  await tapped(() => p.touchscreen.tap(x, y));
};
const planRoute = async (engine, places) => {
  await tapOn({ engine });
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  if (!(await p.evaluate(() => window.woodrail.hud.engineCardOpen))) await tapOn({ engine });
  await tapButton(".engine-extra .route-plan");
  for (const d of places) await tapOn({ depot: d });
  await tapButton(".line-sheet .route-plan.on");
  await p.keyboard.press("Escape");
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
const GREEN = "#4f8a3c";
const RED = "#c23b22";
const state = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    const { CARGO } = await import("/src/economy/cargo.ts");
    const mill = w.economy.depot(window.__mill);
    const shop = w.economy.depot(window.__shop);
    const crane = w.depotView.craneOf(mill.id);
    return {
      tracks: w.economy.trackCount(mill.id),
      planks: shop.piles[CARGO.planks.index],
      stone: shop.piles[CARGO.stone.index],
      crane: crane && { l: Math.round(crane.l) },
      row: document.querySelector(".depot-tracks")?.innerText ?? null,
      button: document.querySelector(".depot-tracks-btn")?.innerText ?? null,
      disabled: !!document.querySelector(".depot-tracks-btn")?.disabled,
      why: document.querySelector(".depot-tracks-why")?.innerText ?? null,
      // (The stretch lit on the map: its ribbons' colours.)
      lit: w.scene.getObjectByName("depot-tracks-stretch")?.userData.colours ?? [],
      splits: [...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id).type === "split-short").length,
      crossovers: [...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id).type === "crossover").length,
      // (What the curve's end toward the mill is joined to.)
      curveJoined: (() => {
        const ref = w.layout.joinedConnector(window.__curve * 8);
        return ref === -1 ? null : (w.layout.getPiece(Math.floor(ref / 8))?.type ?? null);
      })(),
    };
  });

// 1. A new game.
await p.goto(PAGE);
await enterGame();

// Setup (shortcuts, not what's tested): Sidings and Routes learned; the line, its pieces asked of the game's drop
// rule: five straights at an eighth's turn, a curve, a short straight, the mill, three straights, the workshop, a
// straight; the workshop's planks and stone; the mill's flour. And the harness's run-ahead (the game's own ticks).
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  w.learn("routes");
  w.learn("sidings");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { getPieceDef } = await import("/src/track/index.ts");
  const t = w.controls.target;
  const g = w.world.landscape.grid;
  /** The world pose of a piece's end `i`, the piece at `pose`. */
  const endOf = (type, flipped, pose, i) => {
    const c = getPieceDef(type, flipped).connectors[i].pose;
    const cs = Math.cos(pose.heading);
    const sn = Math.sin(pose.heading);
    return { x: pose.x + cs * c.x - sn * c.z, z: pose.z + sn * c.x + cs * c.z, heading: pose.heading + c.heading };
  };
  for (let d = 300; d < 9000; d += 72) {
    for (let a = 0; a < Math.max(1, Math.round(d / 72) * 4); a++) {
      for (const h of [0, Math.PI / 2]) {
        const c = Math.cos(h);
        const sn = Math.sin(h);
        const X0 = Math.round((t.x + d * Math.cos(a)) / 18) * 18;
        const Z0 = Math.round((t.z + d * Math.sin(a)) / 18) * 18;
        if (g.groundY(g.cellAtWorld(X0, Z0)) !== 0) continue;
        // (Along heading h, the mill at X0; the extra tracks on its −l side: −l is (sin h, −cos h).)
        const at = (i, l) => ({ x: X0 + i * c - l * sn, z: Z0 + i * sn + l * c, heading: h });
        const after = ["straight-216", "straight-216", "straight-216", "depot-workshop", "straight-216"];
        const pieces = [{ type: "depot-mill", pose: at(0, 0), y: 0, flipped: false }, ...after.map((type, k) => ({ type, pose: at(216 * (k + 1), 0), y: 0, flipped: false }))];
        // Back from the mill: the short straight, the curve (bending to the yard's side, away from the new tracks),
        // and five straights at its eighth's turn, each joined to the last.
        const back = [{ type: "straight-144", pose: at(-144, 0), y: 0, flipped: false }];
        let end = { x: back[0].pose.x, z: back[0].pose.z, heading: h + Math.PI };
        const curve = { type: "curve-large", pose: { ...end }, y: 0, flipped: true };
        back.push(curve);
        end = endOf("curve-large", true, curve.pose, 1);
        for (let k = 0; k < 5; k++) {
          const q = { type: "straight-216", pose: { ...end }, y: 0, flipped: false };
          back.push(q);
          end = endOf("straight-216", false, q.pose, 1);
        }
        const probes = [];
        for (let i = -1; i <= 4; i++) for (const l of [-72, -144]) probes.push({ type: "straight-216", pose: at(i * 216, l), y: 0, flipped: false });
        const all = [...back.slice().reverse(), ...pieces];
        if ([...all, ...probes].some((q) => w.interaction.placeWhyIgnoring(q.type, q.flipped, q.pose, q.y, -1) !== null)) continue;
        const ids = w.editor().placeRun(all);
        const [approach, millPiece, shopPiece] = [ids.slice(0, 5).reverse(), ids[7], ids[11]];
        const mill = w.economy.depotAtPiece(millPiece) ?? w.economy.addDepot("mill", millPiece);
        const shop = w.economy.depotAtPiece(shopPiece) ?? w.economy.addDepot("workshop", shopPiece);
        shop.piles[CARGO.planks.index] = 22;
        shop.piles[CARGO.stone.index] = 10;
        mill.piles[CARGO.flour.index] = 12;
        w.depotView.setWorld(w.economy, w.layout);
        w.editor().clearHistory();
        window.__mill = mill.id;
        window.__shop = shop.id;
        window.__ids = ids;
        window.__approach = approach;
        window.__curve = ids[5];
        window.__at = { X0, Z0, h };
        window.__run = (secs, watch) => {
          let both = 0;
          let twice = 0;
          const move = { kind: "log", toPile: false, carId: -1, phase: 0 };
          for (let i = 0; i < secs * 120; i++) {
            w.sim.tick();
            w.economy.tick();
            if (!watch) continue;
            const tracks = [w.economy.depot(window.__mill).pieceId, ...w.economy.roadsOf(window.__mill).map((r) => r.pieceId)];
            let moving = 0;
            for (const piece of tracks) if (w.economy.craneMove(window.__mill, move, piece)) moving++;
            if (moving > 1) twice++;
            const on = watch.map((e) => {
              const tr = w.sim.findCar(e)?.train;
              return tr ? tracks.findIndex((piece) => tr.bogies.some((b) => b.pieceId === piece)) : -1;
            });
            if (on.every((k) => k !== -1) && new Set(on).size === on.length) both++;
          }
          w.invalidate();
          return { both: both / 120, twice };
        };
        w.invalidate();
        return { ids, mill: mill.id, shop: shop.id };
      }
    }
  }
  return { error: "no open ground" };
});
check("setup: a mill with a curve 2 squares from its end, and a workshop", !setup.error, JSON.stringify(setup));
if (!setup.error) {
  const mill = setup.mill;

  // 1. The mill's card: one track, the button with its price, and the stretch it takes lit on the map.
  await tapOn({ depot: mill });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await p.waitForFunction(() => !!document.querySelector(".depot-tracks-btn"), null, { timeout: 20000 }).catch(() => {});
  let s = await state();
  check("a tap on the mill opens its card: one track", s.tracks === 1 && /One track/.test(s.row ?? ""), JSON.stringify(s));
  check("…and offers a second track for 10 planks, though a curve is 2 squares from its end", /Second track · 10/.test(s.button ?? "") && !s.disabled, JSON.stringify(s));
  check("…the stretch it takes lit on the map (green, nothing in the way)", s.lit.length === 1 && s.lit[0] === GREEN, JSON.stringify(s.lit));
  await showing({ depot: mill, across: -40, along: 0 }, 1250, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("1-one-track");

  // 2. A tap: a second track, a short split at each end; undo takes it back with its planks; a tap lays it again.
  await tapButton(".depot-tracks-btn");
  await p.waitForTimeout(600);
  s = await state();
  check("a tap lays a second track, 10 planks taken", s.tracks === 2 && s.planks === 12, JSON.stringify(s));
  check("…joined by a short split at each end, the near one right against the curve", s.splits === 2 && s.crossovers === 0 && s.curveJoined === "split-short", JSON.stringify(s));
  check("…the crane's gantry spans both tracks (its middle moved over the line)", s.crane?.l === 6, JSON.stringify(s.crane));
  check("…and the card says so, offering a third for 12 planks and 10 stone", /2 tracks/.test(s.row ?? "") && /Third track · 12/.test(s.button ?? "") && /10/.test(s.button ?? ""), JSON.stringify(s));
  const toastOk = await p.evaluate(() => [...document.querySelectorAll(".toast")].some((t) => /has 2 tracks now/.test(t.textContent)));
  check("…with a toast", toastOk);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1200);
  s = await state();
  check("the card closed: the map's stretch gone with it", s.lit.length === 0, JSON.stringify(s.lit));
  await tapButton('button[aria-label="Undo (Ctrl+Z)"]');
  await p.waitForTimeout(600);
  s = await state();
  check("Undo: one step takes the track back, and gives the planks back", s.tracks === 1 && s.planks === 22 && s.crane?.l === 45, JSON.stringify(s));
  check("…and its splits, the short straight back against the curve", s.splits === 0 && s.curveJoined === "straight-144", JSON.stringify(s));
  await tapOn({ depot: mill });
  await tapButton(".depot-tracks-btn");
  await p.waitForTimeout(600);
  s = await state();
  check("a tap again: two tracks", s.tracks === 2 && s.planks === 12, JSON.stringify(s));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1200);
  await showing({ depot: mill, across: -40, along: 0 }, 1250, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("2-two-tracks");

  // 3. Two trains, each routed by taps to the mill and on to the workshop: served at once, the crane in turn.
  const trains = await p.evaluate(async () => {
    const w = window.woodrail;
    const { CARGO } = await import("/src/economy/cargo.ts");
    // (On the straights beyond the curve, facing the mill: their ends 0 are toward it.)
    const put = (pieceId, kinds) => {
      const r = w.sim.addTrain(kinds, { pieceId, pathIndex: 0, reversed: true, s: 60 });
      if (r.kind !== "placed") return -1;
      const t = w.sim.getTrain(r.trainId);
      w.sim.setLever(t.cars[0].id, 0);
      return t.cars[0].id;
    };
    const a = put(window.__approach[0], ["engine", "hopper", "hopper"]);
    const b = put(window.__approach[3], ["engine", "hopper", "hopper"]);
    for (const e of [a, b]) if (e !== -1) for (const c of w.sim.findCar(e).train.cars) if (c.kind === "hopper") w.economy.setCargo(c.id, "grain", 3);
    w.economy.depot(window.__mill).piles[CARGO.grain.index] = 0;
    w.trainView?.sync?.();
    w.invalidate();
    return { a, b };
  });
  check("two trains put down on the line", trains.a !== -1 && trains.b !== -1, JSON.stringify(trains));
  for (const e of [trains.a, trains.b]) await planRoute(e, [mill, setup.shop]);
  const routes = await p.evaluate(([a, b]) => [a, b].map((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null), [trains.a, trains.b]);
  check("each routed by taps: the mill, then the workshop", routes.every((r) => JSON.stringify(r) === JSON.stringify([mill, setup.shop])), JSON.stringify(routes));
  await p.evaluate(([a, b]) => {
    window.woodrail.sim.setLever(a, 1);
    window.woodrail.sim.setLever(b, 1);
  }, [trains.a, trains.b]);
  // Run on, a quarter second at a time, till both stand at the mill, each on its own track, the crane mid-move.
  const run = { both: 0, twice: 0 };
  for (let k = 0; k < 240; k++) {
    const r = await p.evaluate(([a, b]) => ({ ...window.__run(0.25, [a, b]), phase: window.woodrail.economy.cranePhase(window.__mill) }), [trains.a, trains.b]);
    run.both += r.both;
    run.twice += r.twice;
    if (r.both > 0 && r.phase > 0.3) break;
  }
  check("both trains stand at the mill at once, each on its own track", run.both > 0, JSON.stringify(run));
  await p.evaluate(() => {
    window.woodrail.paused = true;
    window.woodrail.invalidate();
  });
  await showing({ depot: mill, across: -60 }, 760, { phi: 0.9, theta: Math.PI - 0.55 });
  await settle();
  await shot("3-two-trains-served");
  await showing({ depot: mill, across: -72, along: 0 }, 2000, { phi: 0.4, theta: Math.PI / 2 });
  await settle();
  await shot("4-overview");
  await p.evaluate(() => (window.woodrail.paused = false));
  const more = await p.evaluate(([a, b]) => window.__run(40, [a, b]), [trains.a, trains.b]);
  const payoff = await p.evaluate(
    async ([a, b]) => {
      const w = window.woodrail;
      const { CARGO } = await import("/src/economy/cargo.ts");
      const left = (e) => (w.sim.findCar(e)?.train.cars ?? []).filter((c) => c.kind === "hopper").reduce((n, c) => n + w.economy.cargoOf(c.id).count, 0);
      const mill = w.economy.depot(window.__mill);
      const derailed = [a, b].some((e) => w.sim.findCar(e)?.train.derailed);
      return { a: left(a), b: left(b), grain: mill.piles[CARGO.grain.index], flour: mill.piles[CARGO.flour.index], derailed };
    },
    [trains.a, trains.b],
  );
  check("the one crane never moved two loads at once", run.twice + more.twice === 0, `${run.twice + more.twice} ticks`);
  check("the payoff: both trains' grain is unloaded at the mill (each served), none derailed", payoff.a === 0 && payoff.b === 0 && !payoff.derailed, JSON.stringify(payoff));
  check("…onto its pile, to be milled", payoff.grain + (payoff.flour - 12) > 0, JSON.stringify(payoff));

  // 4. The third: greyed here, saying what's in the way and where, the curve lit red. Then (setup) room made: laid.
  await tapOn({ depot: mill });
  await p.waitForFunction(() => !!document.querySelector(".depot-tracks-btn"), null, { timeout: 20000 }).catch(() => {});
  s = await state();
  check(
    "the third track: greyed, the card says it needs 4 squares at each end and there are 2 before the curve",
    s.disabled && /The third track needs 11 squares of straight line beside it, at least 4 at each end: there's 2 before a curve at one end, room at the other/.test(s.why ?? ""),
    JSON.stringify(s.why),
  );
  check("…the stretch lit on the map, the curve in the way red", s.lit.includes(GREEN) && s.lit.includes(RED), JSON.stringify(s.lit));
  await showing({ depot: mill, across: -40, along: -144 }, 1250, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("5-third-refused");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1200);
  // Setup (a shortcut, not what's tested: the player would move the curve): the trains put away, and the line at the
  // curve's end laid straight back from the turnout by the editor.
  const straight = await p.evaluate(async () => {
    const w = window.woodrail;
    const { putAway } = await import("/src/game/put-away.ts");
    for (const id of [...w.sim.trainIds()]) {
      const e = w.sim.getTrain(id).cars.find((c) => c.kind === "engine");
      if (e) putAway(w.sim, w.economy, e.id);
    }
    const { X0, Z0, h } = window.__at;
    const c = Math.cos(h);
    const sn = Math.sin(h);
    const pieces = [1, 2, 3, 4].map((k) => ({ type: "straight-216", pose: { x: X0 - (144 + 216 * k) * c, z: Z0 - (144 + 216 * k) * sn, heading: h }, y: 0, flipped: false }));
    const ids = w.editor().replaceRun([window.__curve, ...window.__approach], pieces);
    w.editor().clearHistory();
    w.invalidate();
    return { laid: ids.length, trains: w.sim.trainIds().length };
  });
  check("setup: the trains put away, the line laid straight", straight.laid === 4 && straight.trains === 0, JSON.stringify(straight));
  await tapOn({ depot: mill });
  await p.waitForFunction(() => !!document.querySelector(".depot-tracks-btn:not([disabled])"), null, { timeout: 20000 }).catch(() => {});
  await tapButton(".depot-tracks-btn");
  await p.waitForTimeout(600);
  s = await state();
  check("a tap lays a third track, 12 planks and 10 stone taken", s.tracks === 3 && s.planks === 0 && s.stone === 0, JSON.stringify(s));
  check("…branching off the second by a short split at each end", s.splits === 4 && s.crossovers === 0, JSON.stringify(s));
  check("…the gantry spans all three", s.crane?.l === -30, JSON.stringify(s.crane));
  check("…and there's no fourth", s.button === null && /3 tracks/.test(s.row ?? ""), JSON.stringify(s));
  await showing({ depot: mill, across: -70, along: 0 }, 1300, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("6-three-tracks");
  await p.keyboard.press("Escape");

  // 5. Saved, reloaded, continued: three tracks still, the gantry over them.
  await p.waitForTimeout(3000); // (saved)
  await p.reload();
  await enterGame();
  const back = await p.evaluate(() => {
    const w = window.woodrail;
    const mill = w.economy.allDepots().find((d) => d.role === "mill" && w.economy.trackCount(d.id) > 1);
    return mill ? { tracks: w.economy.trackCount(mill.id), crane: Math.round(w.depotView.craneOf(mill.id)?.l ?? NaN) } : null;
  });
  check("after a reload the mill still has three tracks, its gantry over them", back?.tracks === 3 && back.crane === -30, JSON.stringify(back));

  // 6. Idle: nothing drawn while nothing moves.
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
