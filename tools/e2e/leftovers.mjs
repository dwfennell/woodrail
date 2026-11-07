// End-to-end: four small leftovers, each on a fresh page on a 390×844 phone with touch.
//
//  sorting      Game mode. Sorting van learned (after Post office): the sorting van on the Wagons shelf, unlocked. Track
//               between the first two towns' stations, a post office far off the line (towns post mail only while one
//               stands), and a train of two sorting vans routed by taps (the first town, the second, no post office
//               stop). It runs: the towns' mail is loaded, sorted on the move, and delivered to the towns as post, paid;
//               nothing is unloaded at the post office.
//  sandbox-post Sandbox. A post office on the line between two towns, a train of two mail vans routed by taps (town,
//               post office, town): Sandbox's towns post mail, the post office sorts it, and the post reaches the towns.
//  telegraph    Game mode. Signal boxes and Telegraph learned, a signal box by the first town's station and telegraph
//               poles wired from it along the line to the second town. A train runs by the far town; a tap on the box:
//               its card lists the train ("Trains in reach"), a tap on Call home, the toast, and the train runs to the
//               station it comes to first and stops there, its lever off ("… is home").
//  paint        Game mode. A town grown to City ★★ (deliveries written into its totals: a shortcut to the state): its
//               bunting goes up by itself. The paint shop on an engine's card: Lined and Rainbow open, Rainbow painted
//               (600 coins), the engine built again with its rainbow band; Lined on a second engine.
//
// Usage: npm run e2e:leftovers [-- <out dir>]   (default out: e2e-out/leftovers; LEFTOVERS=<section,…> runs only those)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/leftovers";
mkdirSync(OUT, { recursive: true });
const ONLY = (process.env.LEFTOVERS ?? "").split(",").filter(Boolean);
const want = (s) => ONLY.length === 0 || ONLY.includes(s);
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5398, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (The game's test clock: trains, loads and animations keep up with real time under SwiftShader. lib/fast.mjs.)
testClockIn(b);

let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};

/** A fresh phone page and its helpers (as tools/e2e/post.mjs's). */
async function phone() {
  // (At a device scale of 1, not 2: no check looks at pixels, the layout is in CSS pixels either way, and a frame at 2
  // costs SwiftShader half as much again. E2E_PHONE_DPR=2: as before.)
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.E2E_PHONE_DPR ?? 1), hasTouch: true, isMobile: true });
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
  const h = { p, ctx, errors };
  h.shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
  h.frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  h.settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  h.tapped = async (act) => {
    const before = await p.evaluate(() => window.__allClicks);
    await act();
    await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 60000 }).catch(() => {});
    await h.frames();
  };
  h.worldAt = (what) =>
    p.evaluate((what) => {
      const w = window.woodrail;
      if (what.engine !== undefined) {
        const t = w.sim.findCar(what.engine).train;
        const [a, c] = [t.world[0], t.world[1]];
        return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
      }
      if (what.at) return what.at;
      if (what.prop !== undefined) {
        const q = w.props.get(what.prop);
        return { x: q.x, y: q.y + 20, z: q.z };
      }
      const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
      const q = piece.pose;
      const along = what.along ?? 108;
      return { x: q.x + Math.cos(q.heading) * along, y: piece.y, z: q.z + Math.sin(q.heading) * along };
    }, what);
  h.onScreen = async (what) => {
    const v = await h.worldAt(what);
    return p.evaluate((v) => {
      const w = window.woodrail;
      const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
      return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
    }, v);
  };
  h.showing = async (what, dist = 1300, angle = null) => {
    const v = await h.worldAt(what);
    await p.evaluate(([v, dist, angle]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2, ...(angle ?? {}) }), [v, dist, angle]);
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
    await h.frames();
  };
  h.tapOn = async (what, dist) => {
    await h.showing(what, dist);
    let at = what.depot !== undefined || what.engine !== undefined ? await h.aim(what) : null;
    // (Nowhere the game's own hit test finds it from this side (a house in front of the station, the track under a
    // car): the view turned a quarter round, as a player would, and looked again.)
    for (let k = 1; k < 4 && at === null && (what.depot !== undefined || what.engine !== undefined); k++) {
      const theta = await p.evaluate((k) => { const w = window.woodrail; const o = w.camera.position.clone().sub(w.controls.target); return Math.atan2(o.x, o.z) + (k * Math.PI) / 2; }, k);
      await h.showing(what, dist, { theta });
      at = await h.aim(what);
    }
    const [x, y] = at ?? (await h.onScreen(what));
    await h.tapped(() => p.touchscreen.tap(x, y));
  };
  /**
   * Where on screen to tap a depot or an engine so the tap is the game's (2026-11-06, the sandbox-post route by taps
   * flaked 1 run in 4: the depot's track middle sometimes had a town house or other model in front of it from the
   * view's side, so the tap added no stop; and an engine's tap at rail height sometimes took the track under it, so a
   * piece's card opened, not the engine's): points along the depot's piece, or along the engine car and up its body,
   * each projected and asked of the game's own hit test (`Interaction.pick`, as the tap will be), the first it finds
   * the thing at, with no page element over it. Null: none.
   */
  h.aim = (what) =>
    p.evaluate((what) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const screen = (q) => {
        const c = new V(q.x, q.y, q.z).project(w.camera);
        return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
      };
      const points = [];
      if (what.depot !== undefined) {
        const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
        const q = piece.pose;
        for (const along of [108, 72, 144, 40, 176]) points.push({ x: q.x + Math.cos(q.heading) * along, y: piece.y, z: q.z + Math.sin(q.heading) * along });
      } else {
        const t = w.sim.findCar(what.engine).train;
        const i = t.cars.findIndex((c) => c.id === what.engine);
        const [a, c] = [t.world[2 * i], t.world[2 * i + 1]];
        for (const up of [16, 28, 8, 0]) for (const f of [0.5, 0.3, 0.7]) points.push({ x: a.x + (c.x - a.x) * f, y: a.y + (c.y - a.y) * f + up, z: a.z + (c.z - a.z) * f });
      }
      const isIt = (pk) => {
        if (!pk) return false;
        if (what.engine !== undefined) return pk.kind === "car" && pk.carId === what.engine;
        if (pk.kind === "depot") return pk.depotId === what.depot;
        if (pk.kind === "piece") return w.economy.depotAtPiece(pk.pieceId)?.id === what.depot;
        if (pk.kind === "car") return (w.sim.findCar(pk.carId)?.train.bogies ?? []).some((b) => w.economy.depotAtPiece(b.pieceId)?.id === what.depot);
        return false;
      };
      for (const q of points) {
        const [x, y] = screen(q);
        if (x < 4 || y < 4 || x > innerWidth - 4 || y > innerHeight - 4) continue;
        if (document.elementFromPoint(x, y)?.tagName !== "CANVAS") continue;
        if (isIt(w.interaction.pick(x, y, true))) return [x, y];
      }
      return null;
    }, what);
  h.tapButton = async (sel) => {
    await p.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0), sel, { timeout: 30000 });
    await h.frames();
    await p.waitForTimeout(400);
    const [x, y] = await p.evaluate((sel) => {
      const r = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    }, sel);
    await h.tapped(() => p.touchscreen.tap(x, y));
  };
  h.tapText = async (selector, text) => {
    const box = await p.evaluate(
      ({ selector, text }) => {
        const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().startsWith(text) && e.getBoundingClientRect().width > 0);
        if (!el) return null;
        el.scrollIntoView({ inline: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      },
      { selector, text },
    );
    if (!box) return false;
    await h.tapped(() => p.touchscreen.tap(box.x, box.y));
    await p.waitForTimeout(400);
    return true;
  };
  h.tray = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tray-item[data-key]")].map((x) => [x.dataset.key, x.classList.contains("locked")])));
  h.open = async (mode) => {
    await p.goto(PAGE);
    await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
    await p.evaluate((mode) => [...document.querySelectorAll(`.title-card.mode-${mode} button`)].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()), mode);
    await p.waitForFunction((mode) => window.woodrail?.mode?.() === mode && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), mode, { timeout: 180000 });
    await h.settle();
    await p.keyboard.press("Escape");
    await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  };
  /**
   * Setup (not what's tested): track between two towns' stations, laid by the player's own pathfinder (the nearest
   * pair it can join, trying each pair nearest-first, then again allowed more pieces: on some random Sandbox maps the
   * first two towns can't be joined, a river or hills in the way); a
   * straight on the way swapped for a post office where `office` says "line" (as a drop splices one in), or a post
   * office put down far off the line where it says "far" (towns post only while one stands); a train of `cars` at the
   * first station, lever off. A run-ahead of the game's own sim and economy ticks (`__run`), counting the cranes'
   * events by depot and good: SwiftShader draws a few frames a second.
   */
  h.line = (cars, office) =>
    p.evaluate(
      async ({ cars, office }) => {
        const { play } = await import("/src/play/player.ts");
        const { rulesFor } = await import("/src/play/rules.ts");
        const { connectorRef } = await import("/src/track/layout.ts");
        const w = window.woodrail;
        const withStations = w.world.landscape.towns.filter((t) => w.world.stations.has(t.id));
        if (withStations.length < 2) return { error: "fewer than two towns with stations" };
        // Every pair of towns, nearest first (by their stations).
        const at = (t) => w.layout.getPiece(w.world.stations.get(t.id)).pose;
        const pairs = [];
        for (let a = 0; a < withStations.length; a++)
          for (let b = a + 1; b < withStations.length; b++) {
            const [p0, p1] = [at(withStations[a]), at(withStations[b])];
            pairs.push({ pair: [withStations[a], withStations[b]], d: Math.hypot(p0.x - p1.x, p0.z - p1.z) });
          }
        pairs.sort((x, y) => x.d - y.d);
        let towns = null;
        let laid = null;
        let tried = 0;
        search: for (const maxPieces of [120, 240]) {
          for (const { pair } of pairs) {
            const [s0, s1] = pair.map((t) => w.world.stations.get(t.id));
            for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
              tried++;
              const before = new Set(w.layout.pieceIds());
              const r = play(w.world.layout, w.editor(), connectorRef(s0, i), connectorRef(s1, j), { blocked: rulesFor(w.world), maxPieces, fiddle: 3 });
              const fresh = [...w.layout.pieceIds()].filter((id) => !before.has(id));
              // A line of its own, long enough for the trains and with a straight to swap for a post office (two
              // stations already joined by the map's own track give none: taken up again, and the next tried).
              if (r.ok && fresh.length >= 4 && fresh.some((id) => w.layout.getPiece(id).type === "straight-216")) {
                laid = fresh;
                towns = pair;
                break search;
              }
              for (const id of fresh.reverse()) w.editor().remove(id);
            }
          }
        }
        if (!laid) return { error: `no track between any two towns' stations (${tried} tries)` };
        const st = (k) => w.world.stations.get(towns[k].id);
        let depot = null;
        if (office === "line") {
          const straights = laid.filter((id) => w.layout.getPiece(id).type === "straight-216");
          if (straights.length < 1) return { error: "no straight to swap for a post office" };
          const id = w.editor().swap(straights[Math.floor(straights.length / 2)], "depot-postoffice");
          if (id === -1) return { error: "no post office swapped in" };
          depot = w.economy.depotAtPiece(id) ?? w.economy.addDepot("postoffice", id);
        } else if (office === "far") {
          const id = w.layout.addPiece("depot-postoffice", { x: 30000, z: 30000, heading: 0 });
          depot = w.economy.addDepot("postoffice", id);
        }
        const town = (k) => w.economy.depotAtPiece(st(k)).id;
        let engine = -1;
        for (const pieceId of [st(0), ...laid.filter((id) => id !== depot?.pieceId)]) {
          for (const s of [0, 30, 60, 90, 120, 150]) {
            const r = w.sim.addTrain(cars, { pieceId, pathIndex: 0, reversed: false, s });
            if (r.kind === "placed") {
              engine = w.sim.getTrain(r.trainId).cars[0].id;
              w.sim.setLever(engine, 0);
              break;
            }
          }
          if (engine !== -1) break;
        }
        window.__run = (secs) => {
          const n = { loaded: {}, unloaded: {} };
          for (let i = 0; i < secs * 120; i++) {
            w.sim.tick();
            w.economy.tick();
            for (const ev of w.economy.drainEvents()) {
              if (ev.kind !== "loaded" && ev.kind !== "unloaded") continue;
              const k = `${ev.depotId}:${ev.cargo}`;
              n[ev.kind][k] = (n[ev.kind][k] ?? 0) + 1;
            }
          }
          w.invalidate();
          return n;
        };
        w.invalidate();
        return { office: depot?.id ?? -1, towns: [town(0), town(1)], townIds: [towns[0].id, towns[1].id], stations: [st(0), st(1)], engine, laid };
      },
      { cars, office },
    );
  /** A low view of a train from its side (for a picture): the angles for `showing`. */
  h.sideOf = (engine) =>
    p.evaluate((e) => {
      const t = window.woodrail.sim.findCar(e).train;
      const [a, c] = [t.world[0], t.world[t.world.length - 1]];
      return { phi: 1.15, theta: Math.atan2(-(c.z - a.z), c.x - a.x) };
    }, engine);
  /** Route the engine by taps: its card, Plan, each stop, Done. */
  h.route = async (engine, stops) => {
    await h.tapOn({ engine });
    await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
    if (!(await p.evaluate(() => window.woodrail.hud.engineCardOpen))) await h.tapOn({ engine });
    await h.tapButton(".engine-extra .route-plan");
    for (const d of stops) await h.tapOn({ depot: d });
    await h.tapButton(".engine-extra .route-plan.on");
    const got = await p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, engine);
    await p.keyboard.press("Escape");
    return got;
  };
  /** Run ahead `minutes`, summing the cranes' events. */
  h.runFor = async (minutes) => {
    const sum = { loaded: {}, unloaded: {} };
    for (let k = 0; k < minutes; k++) {
      const n = await p.evaluate(() => window.__run(60));
      for (const kind of ["loaded", "unloaded"]) for (const [key, v] of Object.entries(n[kind])) sum[kind][key] = (sum[kind][key] ?? 0) + v;
    }
    return { sum, at: (kind, d, good) => sum[kind][`${d}:${good}`] ?? 0 };
  };
  h.done = async (what) => {
    check(`${what}: no page errors`, errors.length === 0, errors.slice(0, 5).join(" | "));
    await ctx.close();
  };
  return h;
}

const run = async (name, body) => {
  if (!want(name)) return;
  console.log(`--- ${name}`);
  try {
    await body();
  } catch (e) {
    check(`${name}: ran to the end`, false, e.stack?.split("\n").slice(0, 3).join(" | "));
  }
};

// ---- Sorting van ------------------------------------------------------------------------------------------------------
await run("sorting", async () => {
  const h = await phone();
  const { p } = h;
  await h.open("game");
  await h.tapText(".tabs button", "Trains");
  await h.tapText(".tray-item.tray-group", "Wagons");
  check("sorting: not learned, no sorting van on the Wagons shelf", !("train:Sorting van" in (await h.tray())));
  // Learned (a setup shortcut, as from the board: research itself is e2e:research's), with what comes before it.
  await p.evaluate(() => {
    const w = window.woodrail;
    for (const id of ["switches", "routes", "post-office", "mail"]) w.learn(id);
    w.hud.refreshTrayBadges();
    w.hud.trayLearned();
  });
  await p.waitForTimeout(800);
  await h.tapText(".tabs button", "Trains");
  await h.tapText(".tray-item.tray-group", "Wagons");
  const wagons = await h.tray();
  check("sorting: learned, the sorting van on the Wagons shelf, unlocked, beside the mail van", wagons["train:Sorting van"] === false && wagons["train:Mail van"] === false, JSON.stringify(wagons));
  await h.shot("sorting-1-on-the-tray");
  await p.keyboard.press("Escape");
  const setup = await h.line(["engine", "sortvan", "sortvan"], "far");
  check("sorting: setup, two towns' stations joined, a post office far off the line, a train of two sorting vans", !setup.error && setup.engine !== -1, JSON.stringify({ ...setup, laid: setup.laid?.length }));
  if (setup.error || setup.engine === -1) return h.done("sorting");
  const { office, towns, townIds, engine } = setup;
  const stops = await h.route(engine, towns);
  check("sorting: routed by taps, town to town (no post office stop)", JSON.stringify(stops) === JSON.stringify(towns), JSON.stringify(stops));
  const coins0 = await p.evaluate(() => window.woodrail.progress().coins);
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine);
  // Partway: a sorting van with mail on board, sorting (its share of the way).
  let midway = null;
  for (let k = 0; k < 40 && !midway; k++) {
    await p.evaluate(() => window.__run(5));
    midway = await p.evaluate((e) => {
      const w = window.woodrail;
      const t = w.sim.findCar(e).train;
      for (const c of t.cars) {
        if (c.kind !== "sortvan") continue;
        const load = w.economy.cargoOf(c.id);
        const share = w.economy.sortedShare(c.id);
        if (load.kind === "mail" && share > 0.2 && share < 0.9) return { car: c.id, load, share };
      }
      return null;
    }, engine);
  }
  check("sorting: on the way, a sorting van's mail is being sorted", !!midway, JSON.stringify(midway));
  if (midway) {
    await h.showing({ engine }, 420, await h.sideOf(engine));
    await p.waitForTimeout(1500);
    await h.settle();
    await h.shot("sorting-2-train-on-the-move");
  }
  const { at, sum } = await h.runFor(12);
  const result = await p.evaluate(
    async ({ townIds }) => {
      const { CARGO } = await import("/src/economy/cargo.ts");
      const w = window.woodrail;
      return { mail: w.economy.made[CARGO.mail.index], post: w.economy.made[CARGO.post.index], got: townIds.map((id) => w.economy.deliveredGoods.get(id)?.post ?? 0) };
    },
    { townIds },
  );
  check("sorting: the towns post mail, and the sorting vans load it", result.mail > 0 && at("loaded", towns[0], "mail") + at("loaded", towns[1], "mail") > 0, JSON.stringify({ result, sum }));
  check("sorting: sorted on the move, the post is unloaded at the towns", result.post > 0 && at("unloaded", towns[0], "post") + at("unloaded", towns[1], "post") > 0 && result.got[0] + result.got[1] > 0, JSON.stringify(result));
  check("sorting: nothing goes to the post office", at("unloaded", office, "mail") === 0 && at("loaded", office, "post") === 0);
  await p.waitForFunction((c) => window.woodrail.progress().coins > c, coins0, { timeout: 30000 }).catch(() => {});
  const coins1 = await p.evaluate(() => window.woodrail.progress().coins);
  check("sorting: and the towns pay for the post", coins1 > coins0, `${coins0} → ${coins1}`);
  // A sorting van's card.
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), engine);
  await p.evaluate(() => window.__run(3));
  await h.done("sorting");
});

// ---- Post in Sandbox --------------------------------------------------------------------------------------------------
await run("sandbox-post", async () => {
  const h = await phone();
  const { p } = h;
  await h.open("sandbox");
  // Sandbox has the post office and the mail van on its tray, free (no research there).
  await h.tapText(".tabs button", "Industries");
  await h.tapText(".tray-item.tray-group", "Industries");
  const shelf = await h.tray();
  check("sandbox-post: the Post office on Sandbox's Industries tab", shelf["piece:depot-postoffice"] === false, JSON.stringify(shelf["piece:depot-postoffice"]));
  await p.keyboard.press("Escape");
  const setup = await h.line(["engine", "mailvan", "mailvan"], "line");
  check("sandbox-post: setup, a post office on the line between two towns, a train of two mail vans", !setup.error && setup.engine !== -1, JSON.stringify({ ...setup, laid: setup.laid?.length }));
  if (setup.error || setup.engine === -1) return h.done("sandbox-post");
  const { office, towns, townIds, engine } = setup;
  const stops = await h.route(engine, [towns[0], office, towns[1]]);
  check("sandbox-post: routed by taps, town, post office, town", JSON.stringify(stops) === JSON.stringify([towns[0], office, towns[1]]), JSON.stringify(stops));
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine);
  const { at, sum } = await h.runFor(12);
  const result = await p.evaluate(
    async ({ townIds }) => {
      const { CARGO } = await import("/src/economy/cargo.ts");
      const w = window.woodrail;
      return { mail: w.economy.made[CARGO.mail.index], post: w.economy.made[CARGO.post.index], got: townIds.map((id) => w.economy.deliveredGoods.get(id)?.post ?? 0) };
    },
    { townIds },
  );
  check("sandbox-post: Sandbox's towns post mail, loaded into the mail vans", result.mail > 0 && at("loaded", towns[0], "mail") + at("loaded", towns[1], "mail") > 0, JSON.stringify({ result, sum }));
  check("sandbox-post: the post office sorts it", at("unloaded", office, "mail") > 0 && result.post > 0);
  check("sandbox-post: the post reaches the towns", at("loaded", office, "post") > 0 && result.got[0] + result.got[1] > 0, JSON.stringify(result.got));
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 0), engine);
  await h.showing({ depot: office, along: 60 }, 900);
  await p.waitForTimeout(1500);
  await h.settle();
  await h.shot("sandbox-post-1-post-office");
  await h.done("sandbox-post");
});

// ---- Telegraph --------------------------------------------------------------------------------------------------------
await run("telegraph", async () => {
  const h = await phone();
  const { p } = h;
  await h.open("game");
  await p.evaluate(() => {
    const w = window.woodrail;
    for (const id of ["switches", "routes", "signal-boxes", "telegraph"]) w.learn(id);
  });
  const setup = await h.line(["engine", "van"], null);
  check("telegraph: setup, two towns' stations joined", !setup.error, JSON.stringify({ ...setup, laid: setup.laid?.length }));
  if (setup.error) return h.done("telegraph");
  // Setup (as a player drops them from the Lineside shelf: e2e:research has them there): a signal box by the first
  // station, and telegraph poles from it along the line, each within a span of the one before.
  const wired = await p.evaluate(async ({ laid, stations }) => {
    const { WIRE_SPAN } = await import("/src/game/lineside.ts");
    const w = window.woodrail;
    const side = (id, across) => {
      const q = w.layout.getPiece(id).pose;
      return { x: q.x + Math.cos(q.heading) * 108 - Math.sin(q.heading) * across, z: q.z + Math.sin(q.heading) * 108 + Math.cos(q.heading) * across, heading: q.heading, y: w.layout.getPiece(id).y ?? 0 };
    };
    const box = w.props.add("bldg-signal-box", side(stations[0], 90));
    let last = { x: box.x, z: box.z };
    const poles = [];
    for (const id of [...laid, stations[1]]) {
      const at = side(id, 70);
      if (Math.hypot(at.x - last.x, at.z - last.z) < WIRE_SPAN * 0.8) continue;
      poles.push(w.props.add("mech-telegraph-pole", at).id);
      last = at;
    }
    w.propsChanged();
    w.invalidate();
    return { box: box.id, poles: poles.length };
  }, setup);
  check("telegraph: a signal box and telegraph poles wired along the line", wired.poles > 0, JSON.stringify(wired));
  // A train out on the line toward the far town, on no line, standing (the toasts kept to read).
  const far = await p.evaluate(({ laid }) => {
    const w = window.woodrail;
    window.__toasts = [];
    const toast = w.hud.toast.bind(w.hud);
    w.hud.toast = (m, ...rest) => (window.__toasts.push(m), toast(m, ...rest));
    for (const s of [40, 80, 120]) {
      const r = w.sim.addTrain(["engine", "van"], { pieceId: laid[laid.length - 1], pathIndex: 0, reversed: false, s });
      if (r.kind === "placed") {
        const engine = w.sim.getTrain(r.trainId).cars[0].id;
        return { engine, name: w.sim.nameOf(engine) };
      }
    }
    return null;
  }, setup);
  check("telegraph: a train by the far town", !!far, JSON.stringify(far));
  if (!far) return h.done("telegraph");
  // (The setup's own train is taken off: one train to call.)
  await p.evaluate((e) => {
    const w = window.woodrail;
    w.sim.removeTrain(w.sim.findCar(e).train.id);
  }, setup.engine);
  // The box's card, by a tap on it.
  await h.tapOn({ prop: wired.box }, 600);
  await p.waitForFunction(() => !!document.querySelector(".piece-card .reach-list:not([hidden])"), null, { timeout: 20000 }).catch(() => {});
  if (!(await p.evaluate(() => !!document.querySelector(".piece-card .reach-list:not([hidden])")))) await h.tapOn({ prop: wired.box }, 600);
  const listed = await p.evaluate(() => [...document.querySelectorAll(".piece-card .reach-row .reach-name")].map((e) => e.textContent));
  check("telegraph: the box's card lists the far train, in reach by the wires", listed.some((t) => t.includes(far.name)), JSON.stringify(listed));
  await h.shot("telegraph-1-trains-in-reach");
  // Call home.
  await h.tapButton(".piece-card .reach-call");
  await p.waitForTimeout(500);
  const called = await p.evaluate((e) => {
    const w = window.woodrail;
    const r = w.economy.routeOf(e);
    return { homeCalls: [...w.economy.homeCalls.entries()], lever: w.sim.findCar(e).train.cars[0].lever, route: r?.stops.map((s) => s.depotId), toast: window.__toasts.join(" | "), button: document.querySelector(".piece-card .reach-call")?.textContent };
  }, far.engine);
  check("telegraph: Call home sends it to the station it comes to first, on a line of its own, and it sets off", called.route?.length === 1 && called.lever !== 0, JSON.stringify(called));
  check("telegraph: the toast says so, and the button says it's coming", called.toast.includes("called home") && called.button === "Coming home", JSON.stringify(called));
  await h.shot("telegraph-2-called-home");
  await p.keyboard.press("Escape");
  // The payoff: it runs there and stops, its lever off.
  let home = null;
  for (let k = 0; k < 36 && !home; k++) {
    await p.evaluate(() => window.__run(5));
    home = await p.evaluate((e) => {
      const w = window.woodrail;
      const t = w.sim.findCar(e).train;
      return w.economy.homeCalls.size === 0 && t.cars[0].lever === 0 ? { speed: t.speed, under: [...w.sim.piecesUnder(t.id)] } : null;
    }, far.engine);
  }
  await p.evaluate(() => window.__run(4));
  const after = await p.evaluate(
    ({ e, home }) => {
      const w = window.woodrail;
      const t = w.sim.findCar(e).train;
      const d = w.economy.depot(home);
      return { speed: t.speed, at: [...w.sim.piecesUnder(t.id)].includes(d.pieceId), toast: window.__toasts.join(" | ") };
    },
    { e: far.engine, home: called.route?.[0] },
  );
  check("telegraph: it comes home and stops at the station", !!home && after.speed === 0 && after.at, JSON.stringify({ home, after }));
  await h.showing({ engine: far.engine }, 600, await h.sideOf(far.engine));
  await p.waitForTimeout(1500);
  await h.settle();
  const toast = await p.evaluate(() => window.__toasts.join(" | "));
  check("telegraph: \"… is home\"", toast.includes(`${far.name} is home`), toast);
  await h.shot("telegraph-3-home");
  await h.done("telegraph");
});

// ---- Paint and bunting ------------------------------------------------------------------------------------------------
await run("paint", async () => {
  const h = await phone();
  const { p } = h;
  await h.open("game");
  // Larkfield to City ★★, a level at a time (deliveries written into its totals: a shortcut to the state).
  for (let level = 1; level <= 5; level++) {
    await p.evaluate(async (level) => {
      const { townLevel } = await import("/src/game/towns.ts");
      const w = window.woodrail;
      const t = w.world.landscape.towns[0];
      const bag = {};
      for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n;
      w.economy.delivered.set(t.id, bag.planks ?? 0);
      w.economy.deliveredGoods.set(t.id, bag);
      w.invalidate();
    }, level);
    await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 30000 }).catch(() => console.log(`(level ${level} not seen)`));
    await p.waitForTimeout(1000);
    await p.evaluate(() => document.querySelector(".growth-sheet:not([hidden]) .close")?.click());
  }
  const bunting = await p.evaluate(() => {
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    const b = t.buildings.find((x) => x.landmark === "bunting");
    const prop = b ? [...w.props.all()].find((q) => q.building === b.id) : null;
    return { level: w.progress().bestLevel, building: !!b, asset: prop?.asset ?? null, at: prop ? { x: prop.x, y: prop.y, z: prop.z } : null };
  });
  check("paint: a City ★★'s bunting goes up by itself, the catalogue's bunting on a lot", bunting.level >= 5 && bunting.building && ["scene-bunting", "scene-flagpole"].includes(bunting.asset), JSON.stringify(bunting));
  if (bunting.at) {
    await p.keyboard.press("Escape");
    await h.showing({ at: bunting.at }, 320);
    await p.waitForTimeout(2000);
    await h.settle();
    await h.shot("paint-1-bunting");
  }
  await p.evaluate(() => {
    const pr = window.woodrail.progress();
    pr.coins = 900;
    window.woodrail.hud.setCoins(pr.coins);
  });
  // Setup: a line out of town (the player's own pathfinder), and two engines on it, a little apart, in the open.
  const laid = await h.line(["engine"], null);
  const engines = await p.evaluate(({ laid }) => {
    const w = window.woodrail;
    const out = [];
    for (const pieceId of laid.slice(1)) {
      if (out.length === 2) break;
      const placed = w.sim.addTrain(["engine"], { pieceId, pathIndex: 0, reversed: false, s: 60 });
      if (placed.kind === "placed") out.push(w.sim.getTrain(placed.trainId).cars[0].id);
    }
    return out;
  }, { laid: laid.laid ?? [] });
  check("paint: two engines on the line out of town", engines.length === 2, JSON.stringify(engines));
  const paintAs = async (engine, id, picture) => {
    await p.evaluate((id) => window.woodrail.interaction.openEngineCard(id), engine);
    await p.waitForTimeout(800);
    for (let k = 0; k < 3 && (await p.evaluate(() => document.querySelector(".paint-sheet")?.hidden !== false)); k++) {
      await p.waitForTimeout(600);
      await h.tapButton(".paint-engine");
    }
    const swatches = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".paint-swatch")].map((s) => [s.dataset.livery, s.classList.contains("locked")])));
    await h.tapButton(`.paint-swatch[data-livery="${id}"]`);
    if (picture) await h.shot(picture);
    const coins = await p.evaluate(() => window.woodrail.progress().coins);
    await h.tapButton(".paint-go");
    await p.waitForTimeout(800);
    const painted = await p.evaluate((e) => ({ livery: window.woodrail.sim.liveryOf(e), coins: window.woodrail.progress().coins }), engine);
    await p.evaluate(() => document.querySelector(".paint-sheet .close")?.click());
    await p.evaluate(() => document.querySelector(".engine-card > .close")?.click());
    return { swatches, coins, painted };
  };
  const rainbow = await paintAs(engines[0], "rainbow", "paint-2-paint-shop");
  check("paint: Lined and Rainbow open at City ★★", rainbow.swatches.lining === false && rainbow.swatches.rainbow === false, JSON.stringify(rainbow.swatches));
  check("paint: painted Rainbow, 600 coins paid", rainbow.painted.livery === "rainbow" && rainbow.painted.coins === rainbow.coins - 600, JSON.stringify(rainbow));
  const stripes = (engine) =>
    p.evaluate(async (id) => {
      const w = window.woodrail;
      await Promise.race([w.settled(2), new Promise((r) => setTimeout(r, 8000))]);
      const colours = [];
      w.scene.traverse((o) => {
        if (o.name !== "livery-stripe") return;
        let q = o;
        while (q && q.userData?.carId === undefined) q = q.parent;
        if (q?.userData?.carId === id || o.userData?.carId === id) colours.push(`#${o.material.color.getHexString()}`);
      });
      return colours;
    }, engine);
  const band = await stripes(engines[0]);
  check("paint: the engine is built again with a rainbow band of six colours", band.length === 6, JSON.stringify(band));
  if (engines[1] !== undefined) {
    const lined = await paintAs(engines[1], "lining");
    check("paint: Lined painted on the second engine, 80 coins", lined.painted.livery === "lining" && lined.painted.coins === lined.coins - 80, JSON.stringify(lined.painted));
    const gold = await stripes(engines[1]);
    check("paint: …with its gold lining", gold.length === 1 && gold[0] === "#e6b52c", JSON.stringify(gold));
  }
  await p.keyboard.press("Escape");
  await h.showing({ engine: engines[0] }, 300, await h.sideOf(engines[0]));
  await p.waitForTimeout(2000);
  await h.settle();
  await h.shot("paint-3-rainbow-and-lined");
  // Nothing moves: no frames drawn while idle.
  await p.waitForTimeout(1500);
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(3000);
  const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
  check("paint: idle, nothing drawn", f1 - f0 <= 1, `${f1 - f0} frames`);
  await h.done("paint");
});

await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
