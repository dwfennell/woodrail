// End-to-end: the rack and the lookout halt (docs/superpowers/specs/2026-11-04-rail-types.md), Game mode on a 390×844
// phone.
// Setup (named shortcuts, not what's tested): Bridges and Tank engine learned, then Mountain railway found researchable
// (needs a town too: checked against the rules) and learned; Passengers learned; a rack and a lookout halt put in the
// toy box (making them is the workshop's e2e; their price is checked from the rules); a hill two levels high raised on
// open felt near a town by the Raise tool's own land editor; a line on the felt with a country halt of the town's, up
// to the hill's foot, and one straight on the hilltop, laid by the editor; trains put on the track by the sim; riders
// set waiting at the halt (they turn up there over time in play). Then, as a player does it:
//   1. The tray: Rack and Short rack on the Ups & downs shelf, the Rack engine with the engines, the Lookout halt with
//      the halts.
//   2. The rack from the tray put down at the line's end at the hill's foot: it snaps there, its top on the hilltop's
//      straight, two levels up. One out of the toy box.
//   3. The lookout halt from the tray put down at the end of the hilltop's straight: it's a stop (a lookout). The rule
//      on the felt says why not.
//   4. A tank engine's train runs up to the rack and stops short of its foot; its card says it can't climb the rack.
//   5. A rack engine's train picks the riders up at the halt, climbs the rack (slower on it), and they get off at the
//      lookout and pay twice the fare.
//   6. Idle: no frames drawn with trains standing.
//
// Usage: npm run e2e:rack [-- <out dir>]   (default out: e2e-out/rack)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/rack";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5412, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
const results = [];
const check = (what, ok, detail = "") => {
  results.push({ what, ok });
  console.log(ok ? "PASS" : "FAIL", what, ok ? "" : detail);
};
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const snap = async (name) => {
  await settle();
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}`, type: "jpeg", quality: 80, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
};

await p.goto(`${PAGE}/#seed-24`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-game .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
// What the game says.
await p.evaluate(() => {
  const h = window.woodrail.hud;
  window.__said = [];
  for (const k of ["toast", "refuse", "setRefusal"]) {
    const f = h[k].bind(h);
    h[k] = (m, ...a) => (m && window.__said.push(m), f(m, ...a));
  }
});
const said = () => p.evaluate(() => window.__said.splice(0));
const pressAt = async (sel, k = 0) => {
  const r = await p.evaluate(([sel, k]) => { const e = document.querySelectorAll(sel)[k]; if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, [sel, k]);
  if (r) await p.mouse.click(r[0], r[1]);
  await frames();
  return !!r;
};
/** A tray tab by its label. */
const tab = async (label) => {
  const ok = await p.evaluate((label) => { const t = [...document.querySelectorAll(".tabs button")].find((e) => e.textContent.includes(label)); t?.click(); return !!t; }, label);
  await frames();
  return ok;
};
/** A tray item by its key, opening shelves for it as a player would. */
const item = async (key) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, key);
  for (let k = 0; k < 24; k++) {
    const r = await find();
    if (r) return r;
    if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) await pressAt(".scroller .tray-back");
    if (!(await pressAt(".scroller .tray-group", k))) return null;
  }
  return null;
};
const screen = (x, y, z) =>
  p.evaluate(([x, y, z]) => {
    const w = window.woodrail;
    const v = new w.camera.position.constructor(x, y, z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, [x, y, z]);
const look = (x, z, from, dist, atY = 20) =>
  p.evaluate(
    ([x, z, from, dist, atY]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const at = new V(x, atY, z);
      w.controls.target.copy(at);
      w.camera.position.copy(at.clone().add(new V(...from).normalize().multiplyScalar(dist)));
      w.camera.lookAt(at);
      w.controls.update?.();
      w.invalidate?.();
    },
    [x, z, from, dist, atY],
  );
const pieces = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()].map((i) => ({ id: i, ...window.woodrail.layout.getPiece(i) })));
/** Tap a tray item to hold it, then tap the map at a world point (a free end: the held piece seats there) to put it down. */
const putDown = async (key, x, y, z) => {
  const r = await item(key);
  if (!r) return false;
  const at = await screen(x, y, z);
  await p.mouse.click(r[0], r[1]);
  await frames();
  await p.mouse.move(at[0], at[1], { steps: 6 });
  await frames();
  await p.mouse.click(at[0], at[1]);
  await frames();
  await p.keyboard.press("Escape");
  await settle();
  return true;
};

// Setup.
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  const { canResearch } = await import("/src/game/research.ts");
  const { plotSlotOf } = await import("/src/landscape/edit.ts");
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { HALT_REACH } = await import("/src/game/world.ts");
  const progress = w.progress();
  const before = canResearch(progress, "rack");
  w.learn("bridges");
  w.learn("tank");
  const afterNeeds = canResearch(progress, "rack");
  w.learn("rack");
  w.learn("passengers");
  progress.coins += 400;
  const g = w.landscape.grid;
  const rules = w.interaction.rules;
  // Open felt 20 squares along x and 7 across, near a town (its halt in reach), for a line, and a hill: a level high on
  // squares 11 to 18, five across, and two levels on 12 to 17, three across (hills step a level a square, as the maps'
  // do: a rack's two levels climb across the step, its foot on the felt and its top two squares on).
  for (const town of w.landscape.towns) {
    const t = town.centre;
    for (let d = 200; d < HALT_REACH + 1200; d += 36) {
      for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
        const X = Math.round((t.x + d * Math.cos(a) - 324) / 72) * 72;
        const Z = Math.round((t.z + d * Math.sin(a)) / 72) * 72 + 36;
        if (Math.hypot(X + 324 - t.x, Z - t.z) > HALT_REACH - 40) continue;
        let ok = true;
        for (let c = 0; c < 20 && ok; c++)
          for (let r = c < 11 ? -1 : -2; r <= (c < 11 ? 1 : 2) && ok; r++) {
            const i = g.cellAtWorld(X + c * 72 + 36, Z + r * 72);
            if (i === -1 || g.height[i] !== 0 || trackBlock(rules, "straight-54", false, { x: X + c * 72 + 9, z: Z + r * 72, heading: 0 }, 0, -1) !== null) ok = false;
          }
        if (!ok) continue;
        const editor = w.interaction.landEditor();
        const raise = [];
        for (let c = 11; c <= 18; c++) for (let r = -2; r <= 2; r++) raise.push(g.cellAtWorld(X + c * 72 + 36, Z + r * 72));
        const upper = [];
        for (let c = 12; c <= 17; c++) for (let r = -1; r <= 1; r++) upper.push(g.cellAtWorld(X + c * 72 + 36, Z + r * 72));
        if (raise.some((i) => editor.check(i, 1) !== null)) continue;
        for (const i of raise) editor.apply(i, 1);
        for (const i of upper) editor.apply(i, 1);
        w.editLand([...new Set(raise.map(plotSlotOf))]);
        if (upper.some((i) => g.height[i] !== 2)) return { error: "hill not two levels", before, afterNeeds, h: upper.map((i) => g.height[i]) };
        // (The hilltop two levels up starts here.)
        const face = X + 12 * 72;
        const ids = w.editor().placeRun([
          { type: "straight-216", pose: { x: X, z: Z, heading: 0 }, y: 0, flipped: false },
          { type: "kit-country-halt", pose: { x: X + 216, z: Z, heading: 0 }, y: 0, flipped: false },
          { type: "straight-288", pose: { x: X + 432, z: Z, heading: 0 }, y: 0, flipped: false },
        ]);
        const top = w.editor().placeRun([{ type: "straight-216", pose: { x: face, z: Z, heading: 0 }, y: 96, flipped: false }]);
        progress.add("piece:rack", 1);
        progress.add("piece:kit-lookout", 1);
        w.hud.refreshTrayBadges?.();
        return { before, afterNeeds, X, Z, face, ids, top, town: town.id };
      }
    }
  }
  return { error: "no room", before, afterNeeds };
});
check("setup: Mountain railway isn't researchable before Bridges and Tank engine, and is after (a town grown too)", !setup.before && setup.afterNeeds !== undefined, JSON.stringify(setup));
if (setup.error) throw new Error(setup.error);
const { X, Z, face } = setup;

// 1. The tray.
check("the Ups & downs shelf has the Rack", !!(await item("piece:rack")));
check("…and the Short rack", !!(await item("piece:rack-short")));
await tab("Industries");
check("the Lookout halt is with the halts (Industries tab)", !!(await item("piece:kit-lookout")));
await tab("Track");
const price = await p.evaluate(async () => {
  const { costOf } = await import("/src/game/crafting.ts");
  const c = costOf(new Map([["piece:rack", 1], ["piece:kit-lookout", 1]]));
  return { coins: c.coins, planks: c.goods.planks };
});
check("a rack and a lookout cost 60 coins and 9 planks at the workshop", price.coins === 60 && price.planks === 9, JSON.stringify(price));
await p.keyboard.press("Escape");
await tab("Trains");
await frames();
check("the Rack engine is with the engines", !!(await item("train:Rack engine")));
await p.keyboard.press("Escape");
await tab("Track");
await frames();

// 2. The rack put down at the line's end, at the hill's foot (the camera behind the line, so a new piece heads along it).
const foot = face - 144;
await look(foot + 40, Z, [-1, 0.9, 0.2], 700, 20);
await settle();
const before = await pieces();
await said();
const putRack = await putDown("piece:rack", foot, 0, Z);
const after = await pieces();
const rack = after.find((q) => q.type === "rack" && !before.some((o) => o.id === q.id));
const stockRack = await p.evaluate(() => window.woodrail.progress().available(window.woodrail.world, "piece:rack"));
check("the rack from the tray snaps onto the line's end at the hill's foot", putRack && !!rack && Math.abs(rack.pose.x - foot) < 1 && rack.y === 0, JSON.stringify({ rack, said: await said() }));
const meets = await p.evaluate(async ({ rack, top }) => {
  const { connectorRef } = await import("/src/track/layout.ts");
  const l = window.woodrail.layout;
  return rack ? { foot: l.joinedConnector(connectorRef(rack.id, 0)) !== -1, top: l.joinedConnector(connectorRef(rack.id, 1)) === connectorRef(top, 0) } : null;
}, { rack, top: setup.top[0] });
check("…its top meets the hilltop's straight, two levels up", !!meets?.foot && !!meets?.top, JSON.stringify(meets));
check("…one out of the toy box", stockRack === 0, `${stockRack}`);
await snap("rack-laid.jpg");

// 3. The lookout halt at the hilltop straight's end.
await look(face + 216, Z, [-1, 0.9, 0.2], 700, 90);
await settle();
const rule = await p.evaluate(({ X, Z }) => window.woodrail.interaction.siteRule?.("kit-lookout", { x: X, z: Z + 200, heading: 0 }, -1) ?? null, { X, Z });
check("on the felt, the lookout is refused, saying why", rule === "A lookout stands on a hilltop two levels up or more", `${rule}`);
const was = await pieces();
await tab("Industries");
const putLookout = await putDown("piece:kit-lookout", face + 216, 96, Z);
await tab("Track");
const lookout = (await pieces()).find((q) => q.type === "kit-lookout" && !was.some((o) => o.id === q.id));
const stop = await p.evaluate((id) => {
  const w = window.woodrail;
  const d = id === undefined ? null : w.economy.depotAtPiece(id);
  return d ? { role: d.role, lookout: w.economy.isLookout(d), townId: d.townId } : null;
}, lookout?.id);
const lookoutJoined = await p.evaluate(async ({ lookout, rack }) => {
  const { connectorRef } = await import("/src/track/layout.ts");
  const l = window.woodrail.layout;
  return !!lookout && !!rack && l.joinedConnector(connectorRef(rack.id, 1)) === connectorRef(lookout.id, 0);
}, { lookout, rack });
// (A halt takes a straight's place when it's put down on one: it went in where the hilltop's straight was.)
check("the lookout from the tray goes down on the hilltop, on the line from the rack's top", putLookout && !!lookout && lookout.y === 96 && lookoutJoined, JSON.stringify({ lookout, face, said: await said() }));
check("…and it's a stop: a lookout, of a town's", !!stop && stop.role === "town" && stop.lookout && stop.townId >= 0, JSON.stringify(stop));
await snap("rack-lookout.jpg");

// 4. A tank engine's train stops short of the rack; its card says why.
const held = await p.evaluate(({ ids }) => {
  const w = window.woodrail;
  const r = w.sim.addTrain(["engine", "passenger"], { pieceId: ids[2], pathIndex: 0, s: 200, reversed: false });
  if (r.kind !== "placed") return { error: r.kind };
  const t = w.sim.getTrain(r.trainId);
  w.sim.setLook(t.cars[0].id, "tank");
  w.sim.setLever(t.cars[0].id, 1);
  for (let k = 0; k < 30 * 30; k++) {
    w.sim.tick();
    w.economy.tick();
  }
  w.invalidate();
  const now = w.sim.getTrain(r.trainId);
  return { trainId: r.trainId, engine: t.cars[0].id, speed: now.speed, rack: w.sim.rackHeld(r.trainId), onRack: now.bogies.some((b) => w.layout.getPiece(b.pieceId)?.type === "rack") };
}, setup);
check("a tank engine's train stops short of the rack's foot and waits", held.speed === 0 && held.rack === rack?.id && !held.onRack, JSON.stringify(held));
await look(face - 200, Z, [-0.2, 0.9, 1], 650, 30);
await settle();
const enginePos = await p.evaluate((id) => {
  const w = window.woodrail;
  const f = w.sim.findCar(id);
  const t = f.train;
  const c = t.world[2 * f.index];
  const r = t.world[2 * f.index + 1];
  return [(c.x + r.x) / 2, (c.y + r.y) / 2 + 30, (c.z + r.z) / 2];
}, held.engine);
const tapAt = await screen(...enginePos);
await p.mouse.click(tapAt[0], tapAt[1]);
await frames();
await settle();
const status = await p.evaluate(() => document.querySelector(".engine-card:not([hidden]) .engine-status")?.textContent ?? null);
check("its card says it can't climb the rack, and what to do", status === "Can't climb the rack: add a rack engine, or go round by the ramps", `${status}`);
await snap("rack-card.jpg");
await p.keyboard.press("Escape");
await p.evaluate((id) => window.woodrail.sim.removeTrain(id), held.trainId);

// 5. A rack engine's train: riders from the halt to the lookout, twice the fare.
const ride = await p.evaluate(async ({ ids, lookout }) => {
  const w = window.woodrail;
  const { fareFor } = await import("/src/game/passengers.ts");
  const progress = w.progress();
  const halt = w.economy.depotAtPiece(ids[1]);
  const look = w.economy.depotAtPiece(lookout);
  if (!halt || !look) return { error: "no stops", halt: !!halt, look: !!look };
  const r = w.sim.addTrain(["engine", "passenger"], { pieceId: ids[0], pathIndex: 0, s: 205, reversed: false });
  if (r.kind !== "placed") return { error: r.kind };
  const t = w.sim.getTrain(r.trainId);
  const engine = t.cars.find((c) => c.kind === "engine").id;
  const coach = t.cars.find((c) => c.kind === "passenger").id;
  w.sim.setLook(engine, "rack");
  halt.waiting = 4;
  const fare = fareFor(w.world, halt, look, coach);
  const coins = progress.coins;
  const riders = progress.riders;
  w.sim.setLever(engine, 1);
  let boarded = 0;
  let onRackTop = 0;
  let flatTop = 0;
  let climbed = false;
  for (let k = 0; k < 90 * 30; k++) {
    w.sim.tick();
    w.economy.tick();
    const now = w.sim.findCar(engine).train;
    boarded = Math.max(boarded, w.economy.ridersOf(coach).count ?? 0);
    const front = w.layout.getPiece(now.bogies[0].pieceId);
    // (Its speed on the rack's top half, once eased down to its rack speed; and its best on the flat.)
    if (front?.type === "rack" && now.bogies[0].s > 80) onRackTop = now.speed;
    else if (front?.y === 0) flatTop = Math.max(flatTop, now.speed);
    if (now.bogies.some((b) => b.pieceId === lookout)) climbed = true;
    if (progress.riders - riders >= 4) break;
  }
  w.sim.setLever(engine, 0);
  for (let k = 0; k < 120; k++) w.sim.tick();
  w.invalidate();
  return { boarded, climbed, onRackTop: Math.round(onRackTop), flatTop: Math.round(flatTop), fare, paid: progress.coins - coins, riders: progress.riders - riders, engine };
}, { ids: setup.ids, lookout: lookout?.id });
check("a rack engine's train picks the riders up at the halt", ride.boarded === 4, JSON.stringify(ride));
check("…climbs the rack to the lookout, slower on the rack", ride.climbed && ride.onRackTop > 0 && ride.onRackTop < ride.flatTop, JSON.stringify(ride));
check("…and they get off at the lookout and pay twice the fare", ride.riders === 4 && ride.paid === 4 * ride.fare && ride.fare >= 2, JSON.stringify(ride));
// (Looking at the train where it stopped, at the lookout, the rack behind it.)
const stood = await p.evaluate((id) => {
  const f = window.woodrail.sim.findCar(id);
  const c = f.train.world[2 * f.index];
  return [c.x, c.z];
}, ride.engine);
await look(stood[0] - 60, stood[1], [-0.6, 0.8, 1], 620, 90);
await snap("rack-climbed.jpg");

// 6. Idle.
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await w.settled(3);
  // (Riders turning up at the halt draw a frame as each comes: the quietest of three 2 s spells.)
  let least = Infinity;
  for (let k = 0; k < 3; k++) {
    const before = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    least = Math.min(least, w.framesDrawn - before);
  }
  return least;
});
check("idle: no frames drawn in 2 s with the rack, the lookout and a train standing", idle === 0, `${idle} frames`);

console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close();
await server.close();
process.exit(failed.length ? 1 : 0);
