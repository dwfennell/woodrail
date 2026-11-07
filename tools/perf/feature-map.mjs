// The features map (`node tools/perf/feature-map.mjs`): the perf harness's late Game map (maps/late-game.txt) with the
// newer features added, each in its own spot on the land so a camera can frame it alone, to measure their render costs.
// Writes maps/features.txt (a copied map, `woodrail-map:1:…`, as ☰ "Copy map for a bug report" makes it: open it with
// the dev-only `?dev#load=`) and maps/features.json (per feature: an id, a world-space centre, a camera distance that
// frames it, and the piece, depot and car ids to measure it by), then loads features.txt afresh from the build in
// dist/ (vite preview, as run.mjs opens maps) and checks every feature is still there.
//
// What it adds (harness shortcuts, named: it's a map for measuring, not a test of the player's path): research learned
// with `learn()`, coins added, land bought with the game's own `unlockPlot`, pieces put down by the editor (each checked
// first by the game's placement rules), depots registered as the game does (`depotAtPiece`, else `addDepot`), yards
// stocked by hand, trains put down by the sim, routes set on the economy, the sim run ahead with its own ticks.
// Where the game has a planner, it's used: `planTunnel` (the bore a straight dropped on a hill's side digs),
// `planUnderpass` (what a Bridge dropped over a line one level up digs), the player's pathfinder `play` between two
// stations; an industry's 2nd and 3rd track and the town's places by its card's own buttons; the paint by the paint
// shop's `paint`.
//
//   1. crane      A breakdown crane train (crane + engine) standing idle on a siding (points, a curve, a straight).
//   2. pumps      A water pump by the lake (its site rule) and an oil well, both working (room in their yards).
//   3. gantry     A sawmill on a line of straights given its 2nd and 3rd tracks from its card: the crane's gantry
//                 spans the three.
//   4. chains     The six goods-chain yards (beet, jam, chocolate, flowers, dye works, toy workshop), two rows of three
//                 on short lines, stocked so each works.
//   5. telegraph  A signal box by a line with points, and four telegraph poles from it along the line (the wires).
//   6. tunnel     A line through a hill (planTunnel: mouths, portals, dashes), a train running to and fro through it.
//   7. underpass  Off a hill's edge (a hill raised a level, as e2e:low-bridge does): a ramp, a Bridge on its top and
//                 the underpass planUnderpass digs, its block on a plinth; a train running to and fro under it.
//   8. post       Two plots bought (their towns and stations), a line between two of the new towns' stations laid by
//                 the pathfinder, a post office swapped in, a train of two mail vans routed town, office, town, and run
//                 ahead till both towns have had post (their post vans drive the streets).
//   9. civic      Larkfield's town hall and park built from its card (their planks landed at its station by the
//                 economy's own unloading), a fountain (a treat) bought there; the late map's engine painted red.
//  10. metro      A line two levels under Thimble Cross (mouths outside it, the digging paid), two metro stops swapped
//                 in, a power station with coal (metro trains are electric), a metro train routed between the stops.
//
// The building page is a vite dev server of the source (the steps import the game's modules, as the e2e scripts do);
// the check is on the built game (`npm run build` first). About 5 min in all on SwiftShader (3½ to build, 1½ to check).
//
//   node tools/perf/feature-map.mjs [--root <dir with dist/>] [--no-check]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer, preview } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : d);
const DIST_ROOT = opt("root", ROOT);
const CHECK = !args.includes("--no-check");
const OUT_TXT = `${HERE}maps/features.txt`;
const OUT_JSON = `${HERE}maps/features.json`;
mkdirSync(`${HERE}maps`, { recursive: true });
const t0 = Date.now();
const secs = () => `${((Date.now() - t0) / 1000).toFixed(0)} s`;
const say = (...a) => console.log(`[${secs()}]`, ...a);

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  headless: false,
  args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };

/** A page in a fresh context (clipboard allowed: the map is read from it), past the title's Continue. */
async function openMap(base, mapText) {
  const ctx = await browser.newContext(phone);
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    localStorage.setItem("woodrail.stats.asked", "1");
  });
  await page.goto(`${base}#load=${mapText}`);
  await enter(page);
  return { ctx, page, errors };
}
async function enter(page) {
  await page.waitForFunction(() => window.woodrail?.title, null, { timeout: 300000 });
  await page.evaluate(() => {
    if (!window.woodrail.title.shown) return;
    [...document.querySelectorAll(".title-card button")].find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click());
  });
  await page.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 300000 });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Build, on a dev server of the source.
const dev = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0 }, logLevel: "error" });
await dev.listen();
await dev.warmupRequest("/src/main.ts");
const DEV = dev.resolvedUrls.local[0];
const late = readFileSync(`${HERE}maps/late-game.txt`, "utf8").trim();
const { page: p, errors } = await openMap(DEV, late);
say("late map open");

// The modules the steps import, fetched once before building: a dependency vite meets for the first time reloads the
// page (its optimiser), which would lose the work. Reloaded during this, the map is still in storage: Continue again.
const MODS = ["/src/game/track-rules.ts", "/src/track/index.ts", "/src/economy/cargo.ts", "/src/economy/economy.ts", "/src/landscape/index.ts", "/src/landscape/edit.ts", "/src/game/underpass-dig.ts", "/src/track/pieces.ts", "/src/track/math.ts", "/src/game/tunnel-dig.ts", "/src/game/world.ts", "/src/game/industries.ts", "/src/game/places.ts", "/src/game/town-life.ts", "/src/game/paint-shop.ts", "/src/play/player.ts", "/src/play/rules.ts", "/src/sim/sim.ts"];
for (let k = 0; ; k++) {
  await p.evaluate((m) => ((window.__mark = 1), Promise.all(m.map((x) => import(x))).then(() => 0)), MODS).catch(() => {});
  await p.waitForTimeout(6000);
  if (await p.evaluate(() => window.__mark === 1).catch(() => false)) break;
  if (k === 3) throw new Error("the page keeps reloading");
  say("(reloaded by vite's optimiser: in again)");
  await enter(p);
}

// Helpers in the page (window.__fm): open-ground checks, a spiral search, the claimed spots.
await p.evaluate(async () => {
  const w = window.woodrail;
  const { trackBlock, trackPlacement } = await import("/src/game/track-rules.ts");
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { isWater } = await import("/src/landscape/index.ts");
  const g = w.world.landscape.grid;
  const rules = w.interaction.rules;
  const claimed = [];
  window.__fm = {
    w, g, rules, CARGO, appendPiece, connectorRef, trackBlock, trackPlacement, isWater,
    /** Is the rect (x0..x1, z0..z1) dry land at height `h` (null: any one height; "any": any) where track could go, and unclaimed? */
    open(x0, z0, x1, z1, h = 0) {
      if (claimed.some((r) => x0 < r[2] && x1 > r[0] && z0 < r[3] && z1 > r[1])) return !(this.why = "claimed");
      let first = null;
      for (let x = x0 + 18; x < x1; x += 36)
        for (let z = z0 + 18; z < z1; z += 36) {
          const i = g.cellAtWorld(x, z);
          if (i === -1 || isWater(g.surface[i])) return !(this.why = i === -1 ? "off" : "water");
          first ??= g.height[i];
          if (h !== "any" && g.height[i] !== (h ?? first)) return !(this.why = "height");
          const r = trackBlock(rules, "straight-54", false, { x: x - 18, z, heading: 0 }, g.height[i] * 48, -1);
          if (r !== null) return !(this.why = r);
        }
      return true;
    },
    claimed,
    claim(x0, z0, x1, z1) {
      claimed.push([x0, z0, x1, z1]);
    },
    /** Points on rings round (px, pz), `step` apart, nearest first (rounded to `snap`). */
    *spiral(px, pz, R, step = 72, snap = 18) {
      for (let r = 0; r <= R; r += step)
        for (let a = 0, n = Math.max(1, Math.ceil((2 * Math.PI * r) / step)); a < n; a++)
          yield [Math.round((px + r * Math.cos((2 * Math.PI * a) / n)) / snap) * snap, Math.round((pz + r * Math.sin((2 * Math.PI * a) / n)) / snap) * snap];
    },
  };
  w.paused = true;
  w.progress().coins += 30000;
  w.hud.setCoins(w.progress().coins);
});

const features = {};
const step = async (id, fn, arg) => {
  const s0 = Date.now();
  const r = await p.evaluate(fn, arg);
  say(`${id}: ${r?.error ? `FAILED ${r.error}` : `built${r?.centre ? ` at ${Math.round(r.centre.x)}, ${Math.round(r.centre.z)}` : ""}`} (${((Date.now() - s0) / 1000).toFixed(1)} s)`);
  if (r?.error) throw new Error(`${id}: ${r.error}`);
  return r;
};

// Land: two plots east of the map bought (as the map's "Buy land" does): room, and two new towns with stations for the
// post. (Each brings a town; the second two.)
await step("land", () => {
  const w = window.woodrail;
  const a = w.unlockPlot(1, 0);
  const b = w.unlockPlot(1, -1);
  return a && b ? { a, b } : { error: "a plot couldn't be bought" };
});

// 6. Tunnel (first: it's on a fixed line through the new east plot's hill).
features.tunnel = await step("tunnel", async () => {
  const w = window.woodrail;
  const fm = window.__fm;
  const L = w.layout;
  w.learn("tunnels");
  const { planTunnel } = await import("/src/game/tunnel-dig.ts");
  const { createSnapshot } = await import("/src/sim/sim.ts");
  for (const z of [288, 252, 144, 180]) {
    // From a line's end on the felt west of the hill, heading into it: what a straight dropped there digs.
    const plan = planTunnel(fm.rules, { x: 2304, z, heading: 0, y: 0, kind: "peg" });
    if (plan.kind !== "bore") continue;
    const all = [1872, 2088].map((x) => ({ type: "straight-216", pose: { x, z, heading: 0 }, y: 0, flipped: false })).concat(plan.pieces);
    if (all.some((q) => fm.trackBlock(fm.rules, q.type, q.flipped, q.pose, q.y, -1) !== null)) continue;
    const ids = w.editor().placeRun(all);
    const ends = [];
    for (const id of ids) for (const k of [0, 1]) if (L.joinedConnector(fm.connectorRef(id, k)) === -1) ends.push(fm.appendPiece(L, "buffer-turnback", false, fm.connectorRef(id, k)));
    w.trackChanged();
    const xs = [...ids, ...ends].map((id) => L.getPiece(id).pose.x);
    fm.claim(Math.min(...xs) - 120, z - 90, Math.max(...xs) + 340, z + 90);
    let engine = -1;
    for (const s of [150, 60]) {
      const r = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: ids[1], pathIndex: 0, s, reversed: false });
      if (r.kind === "placed") {
        engine = w.sim.getTrain(r.trainId).cars[0].id;
        break;
      }
    }
    if (engine === -1) return { error: "no room for the train" };
    w.sim.setLever(engine, 1);
    // Run it through once (the sim's own ticks): under the hill, drawn as a ghost there.
    const snap = createSnapshot();
    let ghost = false;
    let lowest = 0;
    for (let k = 0; k < 120 * 40 && !ghost; k++) {
      w.sim.tick();
      if (k % 30) continue;
      const t = w.sim.findCar(engine).train;
      lowest = Math.min(lowest, t.world[0].y);
      if (t.world[0].y < -40) {
        w.sim.writeSnapshot(snap);
        w.trainView.update(snap, 0);
        ghost = w.trainView.inTunnel(engine);
      }
    }
    const f = w.tunnelsView.found;
    const mouths = ids.filter((id) => L.getPiece(id).type.startsWith("tunnel-mouth"));
    return { pieces: [...ids, ...ends], mouths, engine, cars: w.sim.findCar(engine).train.cars.map((c) => c.id), portals: f.portals.length, dashes: f.dashes.length, ghostSeen: ghost, lowest: Math.round(lowest), centre: { x: (plan.face + plan.exit) / 2 + 2304, z }, dist: 1100 };
  }
  return { error: "no tunnel line through the hill" };
});

// 8. The post.
features.post = await step("post", async () => {
  const w = window.woodrail;
  const fm = window.__fm;
  const L = w.layout;
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  w.learn("post-office");
  // The two new towns in the north-east plot (the last two on the map), their stations joined by the pathfinder.
  const towns = w.world.landscape.towns.slice(-2);
  const st = towns.map((t) => w.world.stations.get(t.id));
  let laid = null;
  for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
    const before = new Set(L.pieceIds());
    const r = play(w.world.layout, w.editor(), fm.connectorRef(st[0], i), fm.connectorRef(st[1], j), { blocked: rulesFor(w.world), maxPieces: 120, fiddle: 3 });
    if (r.ok) {
      laid = [...L.pieceIds()].filter((id) => !before.has(id));
      break;
    }
  }
  if (!laid) return { error: "no track between the new towns' stations" };
  const straights = laid.filter((id) => L.getPiece(id).type === "straight-216");
  if (straights.length === 0) return { error: "no straight to swap a post office in for" };
  // The post office in place of a straight on the way (as a drop onto a line splices one in).
  const office = w.editor().swap(straights[Math.floor(straights.length / 2)], "depot-postoffice");
  if (office === -1) return { error: "no post office swapped in" };
  const po = w.economy.depotAtPiece(office) ?? w.economy.addDepot("postoffice", office);
  const ends = [];
  for (const s of st) for (const k of [0, 1]) if (L.joinedConnector(fm.connectorRef(s, k)) === -1) ends.push(fm.appendPiece(L, "buffer-turnback", false, fm.connectorRef(s, k)));
  w.trackChanged();
  let engine = -1;
  for (const pieceId of [st[0], ...laid.filter((id) => L.getPiece(id))]) {
    for (const reversed of [false, true])
      for (const s of [10, 60, 120]) {
        if (engine !== -1) break;
        const r = w.sim.addTrain(["engine", "mailvan", "mailvan"], { pieceId, pathIndex: 0, reversed, s });
        if (r.kind === "placed") engine = w.sim.getTrain(r.trainId).cars[0].id;
      }
    if (engine !== -1) break;
  }
  if (engine === -1) return { error: "no room for the mail train" };
  const townDepots = st.map((id) => w.economy.depotAtPiece(id).id);
  // Town, office, town, office: the mail from each town goes to the office, the post from it on to the other.
  w.economy.setRoute(engine, { stops: [{ depotId: townDepots[0], action: "both" }, { depotId: po.id, action: "both" }, { depotId: townDepots[1], action: "both" }, { depotId: po.id, action: "both" }], next: 0 });
  w.sim.setLever(engine, 1);
  const pieces = [...st, ...laid.filter((id) => L.getPiece(id)), office, ...ends];
  const xs = pieces.map((id) => L.getPiece(id).pose.x);
  const zs = pieces.map((id) => L.getPiece(id).pose.z);
  fm.claim(Math.min(...xs) - 200, Math.min(...zs) - 250, Math.max(...xs) + 300, Math.max(...zs) + 250);
  return { towns: towns.map((t) => t.id), stations: st, townDepots, office, postOffice: po.id, pieces, engine, cars: w.sim.findCar(engine).train.cars.map((c) => c.id), centre: { x: (Math.min(...xs) + Math.max(...xs)) / 2 + 100, z: (Math.min(...zs) + Math.max(...zs)) / 2 }, dist: Math.max(900, 1.3 * (Math.max(...xs) - Math.min(...xs) + 300)) };
});

// 10. Metro, under the biggest town where a line fits (e2e:metro's search).
features.metro = await step("metro", async () => {
  const w = window.woodrail;
  const fm = window.__fm;
  const L = w.layout;
  const { metroTown } = await import("/src/game/world.ts");
  for (const t of ["bridges", "tunnels", "passengers", "stations", "electricity", "metro"]) w.learn(t);
  const g = fm.g;
  const towns = w.landscape.towns.slice().sort((a, b) => b.cells.length - a.cells.length);
  for (const town of towns) {
    const rows = [...new Set(town.cells.map((i) => g.rowOf(i)))].sort((a, b) => Math.abs(g.centreZ(a) - town.centre.z) - Math.abs(g.centreZ(b) - town.centre.z));
    for (const row of rows) {
      const cols = town.cells.filter((i) => g.rowOf(i) === row).map((i) => g.colOf(i));
      const z = g.centreZ(row);
      const minX = g.centreX(Math.min(...cols)) - 36;
      const maxX = g.centreX(Math.max(...cols)) + 36;
      for (const margin of [36, 72, 108, 144, 180, 216, 252]) {
        const W = Math.round((minX - margin - 288) / 18) * 18;
        const n = Math.ceil((maxX + margin - (W + 288)) / 216);
        const E = W + 288 + n * 216;
        const deep = [];
        for (let k = 0; k < n; k++) deep.push({ type: "straight-216", pose: { x: W + 288 + k * 216, z, heading: 0 }, y: -96, flipped: false });
        // A mouth down outside the town, straights two levels under the felt across it, a mouth up on the far side.
        const run = [
          { type: "straight-216", pose: { x: W - 216, z, heading: 0 }, y: 0, flipped: false },
          { type: "tunnel-mouth", pose: { x: W, z, heading: 0 }, y: 0, flipped: false },
          ...deep,
          { type: "tunnel-mouth", pose: { x: E + 288, z, heading: Math.PI }, y: 0, flipped: true },
          { type: "straight-216", pose: { x: E + 288, z, heading: 0 }, y: 0, flipped: false },
        ];
        if (run.some((q) => fm.trackBlock(fm.rules, q.type, q.flipped, q.pose, q.y, -1) !== null)) continue;
        const spots = deep.map((q, k) => ({ k, ok: metroTown(w.landscape, q.pose)?.id === town.id })).filter((s) => s.ok);
        if (spots.length < 2 || spots[spots.length - 1].k - spots[0].k < 2) continue;
        const coins = w.progress().coins;
        const ids = w.editor().placeRun(run);
        await new Promise((r) => setTimeout(r, 300));
        const dug = coins - w.progress().coins;
        // Two metro stops in place of deep straights whose entrance lands on a free square of the town.
        const stops = [spots[0], spots[spots.length - 1]].map((s) => w.editor().swap(ids[2 + s.k], "kit-metro-stop"));
        await new Promise((r) => setTimeout(r, 300));
        const ends = [];
        for (const id of [ids[0], ids[ids.length - 1]]) for (const k of [0, 1]) if (L.joinedConnector(fm.connectorRef(id, k)) === -1) ends.push(fm.appendPiece(L, "buffer-turnback", false, fm.connectorRef(id, k)));
        w.trackChanged();
        const stopDepots = stops.map((id) => w.economy.depotAtPiece(id)?.id ?? -1);
        // Power: a metro train is electric, it runs while a power station has coal. One near the line, stocked.
        let power = null;
        for (const [x, zz] of fm.spiral(1950, -700, 2500, 72)) {
          for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const pose = { x, z: zz, heading };
            if (w.interaction.placeWhyIgnoring("depot-power", false, pose, 0, -1) !== null) continue;
            const [pid] = w.editor().placeRun([{ type: "depot-power", pose, y: 0, flipped: false }]);
            const d = w.economy.depotAtPiece(pid) ?? w.economy.addDepot("power", pid);
            // (30: the most a save keeps on a pile; a coal a minute, and one each 20 s while the metro runs.)
            d.piles[fm.CARGO.coal.index] = 30;
            power = { piece: pid, depot: d.id, pose };
            break;
          }
          if (power) break;
        }
        if (!power) return { error: "no room for a power station" };
        w.depotView.setWorld(w.economy, w.layout);
        const deepIds = [...L.pieceIds()].filter((id) => {
          const q = L.getPiece(id);
          return q.type === "straight-216" && q.y === -96 && Math.abs(q.pose.z - z) < 1;
        });
        let engine = -1;
        for (const id of deepIds) {
          for (const s of [100, 200]) {
            const r = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: id, pathIndex: 0, s, reversed: false });
            if (r.kind === "placed") {
              const t = w.sim.getTrain(r.trainId);
              for (const c of t.cars) w.sim.setLook(c.id, "metro");
              engine = t.cars[0].id;
              break;
            }
          }
          if (engine !== -1) break;
        }
        if (engine === -1) return { error: "no room for the metro train" };
        w.economy.setRoute(engine, { stops: stopDepots.map((depotId) => ({ depotId, action: "both" })), next: 0 });
        w.sim.setLever(engine, 1);
        return { town: town.id, townName: town.name, z, dug, pieces: [...ids.filter((id) => L.getPiece(id)), ...stops, ...ends], stops, stopDepots, power, engine, cars: w.sim.findCar(engine).train.cars.map((c) => c.id), centre: { x: (W + E + 288) / 2, z }, dist: Math.max(1000, 0.9 * (E + 576 - W)) };
      }
    }
  }
  return { error: "no row under any town for a metro line" };
});

// 3. Gantry: a sawmill on a line, 3 straights each side (the third track needs 7½ squares of line at each end).
features.gantry = await step("gantry", async () => {
  const w = window.woodrail;
  const fm = window.__fm;
  w.learn("sidings");
  const why = (q) => w.interaction.placeWhyIgnoring(q.type, q.flipped, q.pose, q.y, -1);
  const types = ["straight-216", "straight-216", "straight-216", "depot-sawmill", "straight-216", "straight-216", "straight-216"];
  let G = null;
  for (const [X, Z] of fm.spiral(288, 1008, 2500, 72)) {
    const pieces = types.map((type, i) => ({ type, pose: { x: X + 216 * i, z: Z, heading: 0 }, y: 0, flipped: false }));
    // (Room on its −l side, north, for the two more tracks.)
    const probes = [];
    for (let i = 0; i < 7; i++) for (const l of [-72, -144]) probes.push({ type: "straight-216", pose: { x: X + 216 * i, z: Z + l, heading: 0 }, y: 0, flipped: false });
    if ([...pieces, ...probes].some((q) => why(q) !== null)) continue;
    const ids = w.editor().placeRun(pieces);
    const d = w.economy.depotAtPiece(ids[3]) ?? w.economy.addDepot("sawmill", ids[3]);
    d.piles[fm.CARGO.log.index] = 6;
    w.depotView.setWorld(w.economy, w.layout);
    fm.claim(X - 40, Z - 220, X + 1552, Z + 200);
    G = { X, Z, ids, depot: d.id };
    break;
  }
  if (!G) return { error: "no room for the line" };
  // The workshop's planks and stone for the tracks (what the card's button takes), then the button, twice.
  const shop = w.economy.allDepots().find((d) => d.role === "workshop");
  shop.piles[fm.CARGO.planks.index] += 22;
  shop.piles[fm.CARGO.stone.index] += 10;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const n of [2, 3]) {
    w.interaction.openDepotCard(G.depot);
    let b = null;
    for (let k = 0; k < 150 && !(b = document.querySelector(`.depot-tracks-btn[data-tracks="${n}"]`)); k++) await sleep(100);
    if (!b || b.disabled) return { error: `no ${n === 2 ? "second" : "third"} track: ${document.querySelector(".depot-tracks-why")?.textContent ?? "no button"}` };
    b.click();
    await sleep(400);
  }
  w.hud.hideCards?.();
  const tracks = w.economy.trackCount(G.depot);
  const t = w.economy.tracksOf(G.depot);
  return { depot: G.depot, piece: w.economy.depot(G.depot).pieceId, tracks, gantryL: Math.round(w.depotView.craneOf(G.depot)?.l ?? NaN), roads: t?.roads.map((r) => r.pieceId) ?? [], centre: { x: G.X + 756, z: G.Z - 30 }, dist: 1300 };
});

// 1. Crane.
features.crane = await step("crane", () => {
  const w = window.woodrail;
  const fm = window.__fm;
  const L = w.layout;
  for (const id of ["goods-engine", "cranes1", "breakdown"]) w.learn(id);
  for (const [px, pz] of [[-1764, 1150], [-1764, 900], [-1500, 1150]])
    for (const [X, Z] of fm.spiral(px, pz, 700, 72))
      for (const h of [Math.PI / 2, 0, -Math.PI / 2, Math.PI]) {
        const c = Math.cos(h);
        const s = Math.sin(h);
        const xs = [X, X + c * 792];
        const zs = [Z, Z + s * 792];
        const box = [Math.min(...xs) - 220 * Math.abs(s) - 36, Math.min(...zs) - 220 * Math.abs(c) - 36, Math.max(...xs) + 220 * Math.abs(s) + 36, Math.max(...zs) + 220 * Math.abs(c) + 36];
        if (!fm.open(...box, null)) continue;
        const y = fm.g.height[fm.g.cellAtWorld(X, Z)] * 48;
        if (fm.trackBlock(fm.rules, "straight-216", false, { x: X, z: Z, heading: h }, y, -1) !== null) continue;
        // A straight, points, two straights on; the points' branch turned back alongside by a large curve, a straight on.
        const first = w.editor().place("straight-216", { x: X, z: Z, heading: h }, y, false);
        const sw = fm.appendPiece(L, "switch", false, fm.connectorRef(first, 1));
        const main = sw == null ? null : fm.appendPiece(L, "straight-216", false, fm.connectorRef(sw, 1));
        const main2 = main == null ? null : fm.appendPiece(L, "straight-216", false, fm.connectorRef(main, 1));
        const bend = sw == null ? null : fm.appendPiece(L, "curve-large", true, fm.connectorRef(sw, 2));
        const siding = bend == null ? null : fm.appendPiece(L, "straight-216", false, fm.connectorRef(bend, 1));
        const ids = [first, sw, main, main2, bend, siding];
        if (ids.some((x) => x == null)) return { error: "the siding didn't go down" };
        w.trackChanged();
        let train = null;
        for (const s0 of [180, 120, 60]) {
          const t = w.sim.addTrain(["crane", "engine"], { pieceId: siding, pathIndex: 0, reversed: false, s: s0 });
          if (t.kind === "placed") {
            train = w.sim.getTrain(t.trainId);
            break;
          }
        }
        if (!train) return { error: "no room for the crane train on the siding" };
        for (const car of train.cars) if (car.kind === "engine") w.sim.setLever(car.id, 0);
        fm.claim(...box);
        const pts = ids.map((id) => L.getPiece(id).pose);
        return { pieces: ids, points: sw, siding, crane: train.cars.find((q) => q.kind === "crane").id, engine: train.cars.find((q) => q.kind === "engine").id, centre: { x: pts.reduce((n, q) => n + q.x, 0) / pts.length, z: pts.reduce((n, q) => n + q.z, 0) / pts.length }, dist: 800 };
      }
  return { error: "no room for the siding" };
});

// 2. Pumps.
features.pumps = await step("pumps", async () => {
  const w = window.woodrail;
  const fm = window.__fm;
  const g = fm.g;
  const { siteWhy } = await import("/src/game/industries.ts");
  w.learn("dairy");
  w.learn("tankers");
  const why = (type, pose) => w.interaction.placeWhyIgnoring(type, false, pose, 0, -1) ?? siteWhy(w.world.landscape, type, pose);
  const find = (px, pz, R, type) => {
    for (const [x, z] of fm.spiral(px, pz, R, 36)) for (const heading of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) if (why(type, { x, z, heading }) === null) return { x, z, heading };
    return null;
  };
  const put = (type, role, pose) => {
    const y = g.groundY(g.cellAtWorld(pose.x + Math.cos(pose.heading) * 108, pose.z + Math.sin(pose.heading) * 108));
    const id = w.editor().place(type, pose, y, false);
    return { id, d: w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id) };
  };
  // The water pump on the lake's south shore (its site rule wants water beside it), the oil well a little way on.
  const pumpPose = find(1800, 560, 900, "depot-waterpump");
  if (!pumpPose) return { error: "no water pump site" };
  const pump = put("depot-waterpump", "waterpump", pumpPose);
  const wellPose = find(pumpPose.x + 400, pumpPose.z + 150, 1200, "depot-oilwell");
  if (!wellPose) return { error: "no oil well site" };
  const well = put("depot-oilwell", "oilwell", wellPose);
  // Working (`Economy.working`): a little in each yard and room for more; they fill over a few game minutes.
  pump.d.piles[fm.CARGO.water.index] = 1;
  well.d.piles[fm.CARGO.oil.index] = 1;
  w.depotView.setWorld(w.economy, w.layout);
  const mid = (q) => ({ x: q.x + Math.cos(q.heading) * 108, z: q.z + Math.sin(q.heading) * 108 });
  const a = mid(pumpPose);
  const b = mid(wellPose);
  for (const q of [a, b]) fm.claim(q.x - 220, q.z - 220, q.x + 220, q.z + 220);
  return { waterpump: { piece: pump.id, depot: pump.d.id, working: w.economy.working(pump.d), at: a }, oilwell: { piece: well.id, depot: well.d.id, working: w.economy.working(well.d), at: b }, centre: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, dist: Math.max(700, Math.hypot(a.x - b.x, a.z - b.z) * 1.6) };
});

// 5. Telegraph.
features.telegraph = await step("telegraph", () => {
  const w = window.woodrail;
  const fm = window.__fm;
  const g = fm.g;
  const L = w.layout;
  for (const id of ["signal-boxes", "telegraph", "junctions", "scenery"]) w.learn(id);
  // A line with points at its far end; a signal box by its near end, four poles from it along the line to beside the
  // points (spans under `WIRE_SPAN`, 700): the wires carry the box's reach to the far points.
  const len = 3 * 216 + 144 + 216;
  const tally = {};
  const no = (k) => (tally[k] = (tally[k] ?? 0) + 1);
  for (const [px, pz] of [[1800, -2100], [1800, -2300], [300, -2700], [-1300, -1480], [3900, -100], [1700, -1300]])
    for (const [X, Z] of fm.spiral(px, pz, 1200, 72))
      for (const h of [Math.PI / 2, -Math.PI / 2, 0, Math.PI]) {
        const c = Math.cos(h);
        const s = Math.sin(h);
        const xs = [X, X + c * len];
        const zs = [Z, Z + s * len];
        const box = [Math.min(...xs) - 240 * Math.abs(s) - 36, Math.min(...zs) - 240 * Math.abs(c) - 36, Math.max(...xs) + 240 * Math.abs(s) + 36, Math.max(...zs) + 240 * Math.abs(c) + 36];
        if (!fm.open(...box, "any")) {
          no(fm.why);
          continue;
        }
        const y = g.height[g.cellAtWorld(X, Z)] * 48;
        const pieces = [0, 1, 2].map((k) => ({ type: "straight-216", pose: { x: X + c * 216 * k, z: Z + s * 216 * k, heading: h }, y, flipped: false }));
        const bad = pieces.map((q) => fm.trackBlock(fm.rules, q.type, q.flipped, q.pose, q.y, -1)).find((r) => r !== null);
        if (bad) {
          no(bad);
          continue;
        }
        const ids = w.editor().placeRun(pieces);
        const sw = fm.appendPiece(L, "switch", false, fm.connectorRef(ids[2], 1));
        const on = sw == null ? null : fm.appendPiece(L, "straight-216", false, fm.connectorRef(sw, 1));
        const off = sw == null ? null : fm.appendPiece(L, "curve-large", true, fm.connectorRef(sw, 2));
        if (on == null || off == null) return { error: `the points didn't go down: ${JSON.stringify([sw, on, off])}` };
        w.trackChanged();
        // (The box and poles on the side away from the points' branch.)
        const at = (along, across) => {
          const x = X + c * along + s * across;
          const z = Z + s * along - c * across;
          return { x, z, heading: h, y: g.groundY(g.cellAtWorld(x, z)) };
        };
        const boxProp = w.props.add("bldg-signal-box", at(60, 110));
        const poles = [];
        for (let k = 1; k <= 4; k++) poles.push(w.props.add("mech-telegraph-pole", at(60 + k * 220, 110)).id);
        w.propsChanged();
        fm.claim(...box);
        return { line: [...ids, sw, on, off], points: sw, box: boxProp.id, poles, centre: { x: X + (c * len) / 2, z: Z + (s * len) / 2 }, dist: 950 };
      }
  return { error: `no room for the line: ${JSON.stringify(tally)}` };
});

// 4. Goods chains.
features.chains = await step("chains", () => {
  const w = window.woodrail;
  const fm = window.__fm;
  for (const id of ["farming", "orchard", "dairy", "juice", "sugar", "jam", "chocolate", "paint", "toys", "carpentry", "harbours"]) w.learn(id);
  const why = (q) => w.interaction.placeWhyIgnoring(q.type, q.flipped, q.pose, q.y, -1);
  // Each yard stocked with what it takes and a little of what it makes: working.
  const ROWS = [
    [["depot-beet", "beetfield", { sugar: 1 }], ["depot-jam", "jamworks", { fruit: 4, sugar: 4, jam: 1 }], ["depot-chocolate", "chocworks", { cocoa: 4, milk: 4, chocolate: 1 }]],
    [["depot-flowers", "flowerfield", { flowers: 1 }], ["depot-dyeworks", "dyeworks", { flowers: 4, paint: 1 }], ["depot-toyworks", "toyworks", { planks: 4, paint: 4, toys: 1 }]],
  ];
  const row = (yards, X, Z, h) => {
    const c = Math.cos(h);
    const s = Math.sin(h);
    const out = [];
    yards.forEach(([type], k) => {
      out.push({ type, pose: { x: X + c * 432 * k, z: Z + s * 432 * k, heading: h }, y: 0, flipped: false });
      if (k < yards.length - 1) out.push({ type: "straight-216", pose: { x: X + c * (432 * k + 216), z: Z + s * (432 * k + 216), heading: h }, y: 0, flipped: false });
    });
    return out;
  };
  const placed = [];
  const yards = [];
  for (const rowYards of ROWS) {
    let done = null;
    const [px, pz] = placed.length ? [placed[0].X - Math.sin(placed[0].h) * 330, placed[0].Z + Math.cos(placed[0].h) * 330] : [2380, -1150];
    search: for (const [X, Z] of fm.spiral(px, pz, 2000, 36))
      for (const h of placed.length ? [placed[0].h] : [-Math.PI / 2, Math.PI / 2, 0, Math.PI]) {
        const pieces = row(rowYards, X, Z, h);
        if (pieces.some((q) => why(q) !== null)) continue;
        done = { X, Z, h, ids: w.editor().placeRun(pieces) };
        break search;
      }
    if (!done) return { error: "no room for a row of yards" };
    placed.push(done);
    rowYards.forEach(([type, role, piles], k) => {
      const id = done.ids[2 * k];
      const d = w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
      for (const [kind, n] of Object.entries(piles)) d.piles[fm.CARGO[kind].index] = n;
      const q = w.layout.getPiece(id).pose;
      yards.push({ type, role, piece: id, depot: d.id, at: { x: Math.round(q.x + Math.cos(q.heading) * 108), z: Math.round(q.z + Math.sin(q.heading) * 108) } });
    });
  }
  w.depotView.setWorld(w.economy, w.layout);
  const xs = yards.map((y) => y.at.x);
  const zs = yards.map((y) => y.at.z);
  fm.claim(Math.min(...xs) - 300, Math.min(...zs) - 300, Math.max(...xs) + 300, Math.max(...zs) + 300);
  return { yards: yards.map((y) => ({ ...y, working: w.economy.working(w.economy.depot(y.depot)) })), lines: placed.map((r) => r.ids), centre: { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 }, dist: Math.max(800, 1.3 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))) };
});

// 7. Underpass off a hill's edge.
features.underpass = await step("underpass", async () => {
  const w = window.woodrail;
  const fm = window.__fm;
  const g = fm.g;
  const rules = fm.rules;
  const L = w.layout;
  const { plotSlotOf } = await import("/src/landscape/edit.ts");
  const { planUnderpass } = await import("/src/game/underpass-dig.ts");
  const { getPieceDef } = await import("/src/track/pieces.ts");
  const { transformPose } = await import("/src/track/math.ts");
  const { plinthLevels } = await import("/src/landscape/index.ts");
  w.learn("bridges");
  // As e2e:low-bridge's "off a hill's edge": a hill raised a level on open felt (the Raise tool's land editor, square
  // by square) for x < X + 504, a line of three straights along it and off its edge (on the risers the track rules
  // give), a ramp up from the hilltop across its path, and a Bridge on the ramp's top over the line.
  const edge = 504;
  const H = 48;
  const ramp = { x: 468, z: -252, heading: Math.PI / 2 };
  for (const [px, pz] of [[3500, -60], [3600, 0], [1300, 1250]])
    for (const [cx, cz] of fm.spiral(px, pz, 1500, 72, 1)) {
      const X = Math.round((cx - 340) / 72) * 72;
      const Z = Math.round((cz + 100) / 72) * 72 + 36;
      if (!fm.open(X - 36, Z - 324, X + 720, Z + 144, 0)) continue;
      const cells = [];
      for (let x = X - 36; x <= X + 684; x += 72) for (let z = Z - 324; z <= Z + 108; z += 72) if (x < X + edge) cells.push(g.cellAtWorld(x, z));
      const editor = w.interaction.landEditor();
      if (cells.some((i) => editor.check(i, 1) !== null)) continue;
      for (const i of cells) editor.apply(i, 1);
      w.editLand([...new Set(cells.map(plotSlotOf))]);
      for (const x of [0, 216, 432]) {
        const pose = { x: X + x, z: Z, heading: 0 };
        const pl = fm.trackPlacement(rules, "straight-216", false, pose, H, -1);
        if (pl.reason) return { error: `straight at ${x}: ${pl.reason}` };
        w.editor().place("straight-216", pose, H, false, pl.risers);
      }
      const rampId = w.editor().place("ramp", { x: X + ramp.x, z: Z + ramp.z, heading: ramp.heading }, H, false);
      const q = L.getPiece(rampId);
      const k = getPieceDef(q.type, q.flipped).connectors[1];
      const e = transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 });
      const top = { x: e.x, z: e.z, heading: e.heading };
      const ty = q.y + k.y;
      const plan = planUnderpass(rules, "bridge", false, top, ty, -1);
      if (plan?.kind !== "dig") return { error: `no underpass: ${JSON.stringify(plan)}` };
      // What a Bridge dropped there does, as one undo step (`Interaction`'s drop).
      const ed = w.editor();
      let bridge = -1;
      ed.group(() => {
        const ids = ed.replaceRun(plan.covers, plan.pieces);
        if (ids.length > 0) bridge = ed.place("bridge", top, ty, false);
      });
      if (bridge === -1) return { error: "the bridge didn't go down" };
      const line = [...L.pieceIds()].filter((id) => {
        const r = L.getPiece(id);
        return Math.abs(r.pose.z - Z) < 1 && r.pose.x >= X - 1 && r.pose.x < X + 700 && r.type !== "riser";
      });
      const under = line.filter((id) => L.getPiece(id).type === "underpass");
      // A train to and fro along the line under the bridge (turnbacks on its ends).
      const ends = [];
      for (const id of line)
        for (const c of [0, 1])
          if (L.joinedConnector(fm.connectorRef(id, c)) === -1) {
            const t = fm.appendPiece(L, "buffer-turnback", false, fm.connectorRef(id, c));
            if (t != null) ends.push(t);
          }
      w.trackChanged();
      let engine = -1;
      for (const id of line) {
        for (const s of [20, 60, 100]) {
          const r = w.sim.addTrain(["engine", "passenger"], { pieceId: id, pathIndex: 0, s, reversed: false });
          if (r.kind === "placed") {
            engine = w.sim.getTrain(r.trainId).cars[0].id;
            break;
          }
        }
        if (engine !== -1) break;
      }
      if (engine !== -1) w.sim.setLever(engine, 1);
      fm.claim(X - 72, Z - 360, X + 756, Z + 180);
      return { hill: { X, Z, edge: X + edge, squares: cells.length }, ramp: rampId, bridge, underpass: under, plinth: under.map((id) => plinthLevels(w.landscape, "underpass", L.getPiece(id).flipped, L.getPiece(id).pose, L.getPiece(id).y)), line: [...line, ...ends], engine, cars: engine === -1 ? [] : w.sim.findCar(engine).train.cars.map((c) => c.id), centre: { x: X + 420, z: Z - 80 }, dist: 850 };
    }
  return { error: "no open felt to raise the hill on" };
});

// 9. Civic: places on Larkfield from its card (Town hall, then Park), a fountain, and the paint.
await p.evaluate(() => (window.woodrail.paused = false));
features.civic = await step("civic", async () => {
  const w = window.woodrail;
  const { townPlaces } = await import("/src/game/places.ts");
  const { paint } = await import("/src/game/paint-shop.ts");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  w.learn("town-hall");
  w.learn("park");
  const t = w.world.landscape.towns[0];
  const st = w.economy.depotAtPiece(w.world.stations.get(t.id));
  const card = async (sel) => {
    w.interaction.openDepotCard(st.id);
    let b = null;
    for (let k = 0; k < 150 && !(b = document.querySelector(sel)); k++) await sleep(100);
    return b;
  };
  for (const [id, planks] of [["town-hall", 12], ["park", 8]]) {
    const b = await card(`.places-sec:not(.treats) .place-btn[data-place="${id}"]`);
    if (!b || b.disabled) return { error: `no Build for ${id} on the card` };
    b.click();
    await sleep(300);
    if (!w.economy.placePlans.has(t.id)) return { error: `${id} not under way` };
    // Its planks landed at the station: the economy's own unloading (`put` onto a pile: into the place under way), as
    // a crane lands them from a train's wagons. (Setup shortcut: the train that would bring them.)
    for (let k = 0; k < planks; k++) w.economy.put({ kind: "pile", depotId: st.id, cargo: "planks" }, "planks");
    for (let k = 0; k < 150 && w.economy.placePlans.has(t.id); k++) await sleep(200);
    if (!townPlaces(t).has(id)) return { error: `${id} didn't go up` };
  }
  const f = await card('.places-sec.treats .place-btn[data-place="fountain"]');
  if (!f || f.disabled) return { error: "no fountain to buy" };
  f.click();
  await sleep(400);
  w.hud.hideCards?.();
  // The late map's engine painted red at the paint shop (its rules and price).
  const big = w.sim.trainIds().map((id) => w.sim.getTrain(id)).sort((a, b) => b.cars.length - a.cars.length)[0];
  const engine = big.cars.find((c) => c.kind === "engine").id;
  if (!paint(w.progress(), w.sim, engine, "red")) return { error: "the paint shop refused" };
  const lots = t.buildings.filter((b) => b.landmark).map((b) => ({ landmark: b.landmark, id: b.id }));
  const props = [...w.world.props.all()].filter((q) => q.town === t.id && ["scene-fountain", "scene-bandstand", "bldg-town-hall"].includes(q.asset)).map((q) => ({ id: q.id, asset: q.asset, x: Math.round(q.x), z: Math.round(q.z) }));
  const xs = props.map((q) => q.x);
  const zs = props.map((q) => q.z);
  return { town: t.id, townName: t.name, station: st.id, stationPiece: st.pieceId, places: [...townPlaces(t)].sort(), buildings: lots, props, livery: { engine, livery: w.sim.liveryOf(engine) }, centre: xs.length ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 } : { x: t.centre.x, z: t.centre.z }, dist: 1000 };
});

// The map live: run the sim ahead (its own ticks) till both new towns have had post, then a few seconds of the game's
// own loop (vans synced, places drawn).
const ran = await p.evaluate(async ({ post }) => {
  const w = window.woodrail;
  w.paused = true;
  let s = 0;
  const had = () => post.towns.every((id) => (w.economy.deliveredGoods.get(id)?.post ?? 0) > 0);
  for (; s < 1500 && !had(); s += 10) for (let i = 0; i < 1200; i++) {
    w.sim.tick();
    w.economy.tick();
  }
  w.economy.drainEvents();
  w.paused = false;
  w.invalidate();
  return { seconds: s, post: post.towns.map((id) => w.economy.deliveredGoods.get(id)?.post ?? 0) };
}, { post: features.post });
say(`ran ahead ${ran.seconds} s of sim: post delivered ${JSON.stringify(ran.post)}`);
// Stocked again after the run ahead (it filled the producers' yards and used up the makers' goods): each yard with all
// it takes and nothing of what it makes, so it works the longest after a load (a few game minutes, then its yard is
// full: nothing carries its goods away).
await p.evaluate(async (pieces) => {
  const w = window.woodrail;
  const { RECIPES, capAt } = await import("/src/economy/economy.ts");
  const { CARGO } = await import("/src/economy/cargo.ts");
  for (const piece of pieces) {
    const d = w.economy.depotAtPiece(piece);
    if (!d) continue;
    const r = RECIPES[d.role];
    for (const k of r.gives ?? []) d.piles[CARGO[k].index] = 0;
    for (const k of r.takes ?? []) d.piles[CARGO[k].index] = d.role === "power" ? 30 : Math.min(capAt(d), 12);
  }
  w.invalidate();
}, [features.pumps.waterpump.piece, features.pumps.oilwell.piece, features.gantry.piece, ...features.chains.yards.map((y) => y.piece), features.metro.power.piece]);
await p.waitForFunction((towns) => towns.every((id) => window.woodrail.vans.vehicles.list.some((v) => v.kind === "post" && v.data?.townId === id)), features.post.towns, { timeout: 60000 }).catch(() => say("(post vans not seen in both towns within 60 s)"));
features.post.postVans = await p.evaluate(() => window.woodrail.vans.vehicles.list.filter((v) => v.kind === "post").map((v) => ({ id: v.id, town: v.data?.townId })));
await p.waitForTimeout(6000); // (an autosave or two)

// What should be there after a reload: counted the same way the check counts them.
const COUNT = () => {
  const w = window.woodrail;
  const by = (xs) => xs.reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {});
  const L = w.layout;
  const towns = w.world.landscape.towns;
  return {
    depots: by(w.economy.allDepots().filter((d) => L.getPiece(d.pieceId)).map((d) => (w.economy.isMetro?.(d) ? "metro-stop" : d.role))),
    pieces: by([...L.pieceIds()].map((id) => L.getPiece(id).type)),
    cars: by(w.sim.trainIds().flatMap((id) => w.sim.getTrain(id).cars.map((c) => c.kind))),
    trains: w.sim.trainIds().length,
    props: by([...w.world.props.all()].map((q) => q.asset).filter((a) => /signal-box|telegraph-pole|fountain|bandstand|town-hall/.test(a))),
    places: Object.fromEntries(towns.filter((t) => t.buildings.some((b) => b.landmark && b.landmark !== "market")).map((t) => [t.name, t.buildings.filter((b) => b.landmark).map((b) => b.landmark).sort()])),
    towns: towns.length,
  };
};
const expected = await p.evaluate(COUNT);

// Saved as ☰ "Copy map for a bug report" saves it (src/persist/bug-map.ts): the menu item, the clipboard.
await p.evaluate(() => window.woodrail.hud.hideCards?.());
await p.evaluate(() => document.querySelector('button[aria-label="Menu"]').click());
await p.waitForTimeout(400);
const clicked = await p.evaluate(() => {
  const it = [...document.querySelectorAll(".menu .menu-item")].find((x) => x.textContent === "Copy map for a bug report");
  it?.click();
  return !!it;
});
if (!clicked) throw new Error("no Copy map item in the menu");
await p.waitForFunction(() => document.querySelector(".toast")?.textContent?.includes("Copied"), null, { timeout: 20000 }).catch(() => {});
const text = (await p.evaluate(() => navigator.clipboard.readText())).trim();
if (!text.startsWith("woodrail-map:1:")) throw new Error("the clipboard has no map");
writeFileSync(OUT_TXT, `${text}\n`);
say(`wrote ${OUT_TXT} (${text.length} chars)`);
if (errors.length) say(`page errors while building: ${errors.slice(0, 5).join(" | ")}`);
await p.context().close();
await dev.close();

const round = (v) => (v && typeof v === "object" && "x" in v && "z" in v ? { x: Math.round(v.x), z: Math.round(v.z) } : v);
const json = {
  about: "tools/perf/feature-map.mjs: the late Game map with the newer features added. Each feature: a centre (world mm) and a camera distance (mm) that frames it, and ids to measure it by. Car ids stay the same after a reload; train ids don't.",
  base: "late-game.txt",
  map: "features.txt",
  expected,
  features: Object.entries(features).map(([id, f]) => ({ id, centre: round(f.centre), dist: Math.round(f.dist), ...Object.fromEntries(Object.entries(f).filter(([k]) => k !== "centre" && k !== "dist")) })),
};
writeFileSync(OUT_JSON, `${JSON.stringify(json, null, 1)}\n`);
say(`wrote ${OUT_JSON}`);

// ---------------------------------------------------------------------------------------------------------------------
// 2. Check: features.txt loaded afresh in the built game, every feature still there.
if (CHECK) {
  const server = await preview({ root: DIST_ROOT, preview: { port: 0 }, logLevel: "warn" });
  const BASE = server.resolvedUrls.local[0];
  const { page: q, errors: qErrors } = await openMap(`${BASE}?dev`, readFileSync(OUT_TXT, "utf8").trim());
  await q.waitForTimeout(8000);
  const got = await q.evaluate(COUNT);
  const f = Object.fromEntries(json.features.map((x) => [x.id, x]));
  const live = await q.evaluate((f) => {
    const w = window.woodrail;
    const L = w.layout;
    const car = (id) => w.sim.findCar(id);
    const lever = (id) => car(id)?.train.cars.find((c) => c.kind === "engine")?.lever ?? null;
    // (Depot ids are given afresh on loading, in the order they're saved: a depot is found by its piece.)
    const dep = (piece) => w.economy.depotAtPiece(piece);
    const working = (piece) => !!dep(piece) && w.economy.working(dep(piece));
    const props = [...w.world.props.all()];
    return {
      depotIds: Object.fromEntries(w.economy.allDepots().map((d) => [d.pieceId, d.id])),
      crane: { crane: car(f.crane.crane)?.train.cars.map((c) => c.kind) ?? null, onSiding: !!car(f.crane.crane) && car(f.crane.crane).train.bogies.some((b) => b.pieceId === f.crane.siding), lever: lever(f.crane.engine) },
      pumps: { waterpump: [dep(f.pumps.waterpump.piece)?.role, working(f.pumps.waterpump.piece)], oilwell: [dep(f.pumps.oilwell.piece)?.role, working(f.pumps.oilwell.piece)] },
      gantry: { role: dep(f.gantry.piece)?.role, tracks: dep(f.gantry.piece) ? w.economy.trackCount(dep(f.gantry.piece).id) : 0, gantryL: dep(f.gantry.piece) ? Math.round(w.depotView.craneOf(dep(f.gantry.piece).id)?.l ?? NaN) : null },
      chains: f.chains.yards.map((y) => `${dep(y.piece)?.role}${working(y.piece) ? "" : " (idle)"}`),
      telegraph: { box: props.some((p) => p.id === f.telegraph.box && p.asset === "bldg-signal-box"), poles: f.telegraph.poles.filter((id) => props.some((p) => p.id === id && p.asset === "mech-telegraph-pole")).length, points: L.getPiece(f.telegraph.points)?.type, wires: (w.scene.getObjectByName("telegraph-wires")?.geometry?.attributes?.position?.count ?? 0) > 0 },
      tunnel: { mouths: f.tunnel.mouths.map((id) => L.getPiece(id)?.type), portals: w.tunnelsView.found.portals.length, dashes: w.tunnelsView.found.dashes.length, lever: lever(f.tunnel.engine) },
      underpass: { bridge: L.getPiece(f.underpass.bridge)?.type, underpass: f.underpass.underpass.map((id) => `${L.getPiece(id)?.type}@${L.getPiece(id)?.y}`), lever: lever(f.underpass.engine) },
      post: { office: dep(f.post.office)?.role, mailvans: car(f.post.engine)?.train.cars.filter((c) => c.kind === "mailvan").length ?? 0, route: w.economy.routeOf(f.post.engine)?.stops.length ?? 0, lever: lever(f.post.engine), postHad: f.post.towns.map((id) => w.economy.deliveredGoods.get(id)?.post ?? 0), postVans: w.vans.vehicles.list.filter((v) => v.kind === "post").map((v) => v.data?.townId) },
      civic: { places: [...w.world.landscape.towns.find((t) => t.id === f.civic.town).buildings].filter((b) => b.landmark).map((b) => b.landmark).sort(), livery: w.sim.liveryOf(f.civic.livery.engine) },
      metro: { stops: f.metro.stops.map((id) => (dep(id) && w.economy.isMetro(dep(id)) ? `metro stop of town ${dep(id).townId}` : null)), look: w.sim.lookOf(f.metro.engine), route: w.economy.routeOf(f.metro.engine)?.stops.length ?? 0, lever: lever(f.metro.engine), power: working(f.metro.power.piece) },
    };
  }, f);
  let fails = 0;
  const ok = (what, cond, detail) => {
    if (!cond) fails++;
    console.log(`${cond ? "ok  " : "FAIL"} ${what}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  console.log(`\nCheck: ${OUT_TXT} loaded afresh in ${DIST_ROOT}/dist`);
  ok("the map loaded (its towns)", got.towns === expected.towns, `${got.towns} towns`);
  ok("depots by role, as built", same(got.depots, expected.depots), got.depots);
  ok("pieces by type, as built", same(got.pieces, expected.pieces), Object.fromEntries(Object.entries(got.pieces).filter(([k]) => /depot|tunnel|underpass|bridge|ramp|kit|switch|turnback|station|curve-large/.test(k))));
  ok("cars by kind, as built", same(got.cars, expected.cars), got.cars);
  ok("props (box, poles, places)", same(got.props, expected.props), got.props);
  ok("places", same(got.places, expected.places), got.places);
  ok("1 crane: crane train on the siding, standing", same(live.crane.crane, ["crane", "engine"]) && live.crane.onSiding && live.crane.lever === 0, live.crane);
  ok("2 pumps: water pump and oil well, working", live.pumps.waterpump[0] === "waterpump" && live.pumps.waterpump[1] && live.pumps.oilwell[0] === "oilwell" && live.pumps.oilwell[1], live.pumps);
  ok("3 gantry: sawmill with 3 tracks, gantry over them", live.gantry.role === "sawmill" && live.gantry.tracks === 3 && live.gantry.gantryL === -30, live.gantry);
  ok("4 chains: six yards, working", live.chains.length === 6 && live.chains.every((x) => !x.includes("idle") && !x.startsWith("undefined")), live.chains);
  ok("5 telegraph: box, 4 poles, points, wires", live.telegraph.box && live.telegraph.poles === 4 && live.telegraph.points === "switch" && live.telegraph.wires, live.telegraph);
  ok("6 tunnel: mouths, portals, a train running", live.tunnel.mouths.every((t) => t?.startsWith("tunnel-mouth")) && live.tunnel.portals >= 2 && live.tunnel.lever === 1, live.tunnel);
  ok("7 underpass: bridge over an underpass, a train running", live.underpass.bridge === "bridge" && live.underpass.underpass.length === 1 && live.underpass.underpass[0].startsWith("underpass") && live.underpass.lever === 1, live.underpass);
  ok("8 post: post office, mail vans routed and running, post had, post vans", live.post.office === "postoffice" && live.post.mailvans === 2 && live.post.route === 4 && live.post.lever === 1 && live.post.postHad.every((n) => n > 0) && live.post.postVans.length > 0, live.post);
  ok("9 civic: town hall, park, fountain; engine painted", ["fountain", "market", "park", "town-hall"].every((x) => live.civic.places.includes(x)) && live.civic.livery === "red", live.civic);
  ok("10 metro: two metro stops, metro train routed and running, power", live.metro.stops.every((s) => s) && live.metro.look === "metro" && live.metro.route === 2 && live.metro.lever === 1 && live.metro.power, live.metro);
  ok("no page errors", qErrors.length === 0, qErrors.slice(0, 3).join(" | ") || "none");
  console.log(fails === 0 ? "ALL THERE" : `${fails} MISSING`);
  // The depot ids in features.json as the loaded map has them (depots are numbered afresh on loading).
  const at = live.depotIds;
  const fx = (o) => {
    if (Array.isArray(o)) return o.forEach(fx);
    if (!o || typeof o !== "object") return;
    if ("piece" in o && "depot" in o) o.depot = at[o.piece] ?? o.depot;
    for (const v of Object.values(o)) fx(v);
  };
  fx(json.features);
  f.post.postOffice = at[f.post.office];
  f.post.townDepots = f.post.stations.map((id) => at[id]);
  f.metro.stopDepots = f.metro.stops.map((id) => at[id]);
  f.civic.station = at[json.features.find((x) => x.id === "civic").stationPiece] ?? f.civic.station;
  json.depotIdsAsLoaded = true;
  writeFileSync(OUT_JSON, `${JSON.stringify(json, null, 1)}\n`);
  await q.context().close();
  await server.close();
  process.exitCode = fails === 0 ? 0 : 1;
}
await browser.close();
say("done");
