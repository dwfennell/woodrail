// Pictures of the tech tree's track pieces (docs/superpowers/specs/2026-10-31-tech-tree.md T3, T4, T5) on a 390×844
// phone, each in a small layout with a train going through: the double slip and the single slip (a train on the turn
// onto the other line), the double three-way (two levers, a train on its right branch), and the turntable turned to a
// road by a tap on it (Turntable controls; an engine carried round on the deck). Sandbox, a new map. A harness
// shortcut throughout (laid by the editor, the train put down and ticked in code): it's for looking, not for testing
// (the e2e is e2e:touch's slips, double-three-way and turntable-taps groups).
//
// Usage: node tools/shots/track-pieces.mjs [<out dir>]   (default out: docs/agents/shots)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5373, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.favourites", "[]");
});
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 30000))]));
await p.goto(`${PAGE}#seed-7`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 120000 });
await p.evaluate(() => {
  const help = document.querySelector(".help");
  if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
  document.querySelector(".coach:not([hidden]) .coach-skip")?.click();
});
await settle();
await p.keyboard.press("Escape");

/**
 * Lay `type` at open ground (its legs: `leg` off each of `ends`), an engine and coaches on leg `from` heading in, the
 * piece set to `state`; run the train until its engine is `onPath` of the piece; frame and take the picture.
 */
async function shot(name, { type, ends, leg, from, state, onPath, cars = ["engine", "passenger", "passenger"], distance = 900, theta = -0.9, tilt = 0.9, lever = 0 }) {
  const r = await p.evaluate(
    async ({ type, ends, leg, from, state, onPath, cars, distance, theta, tilt, lever }) => {
      const w = window.woodrail;
      const T = await import("/src/track/index.ts");
      const { checkPlacement } = await import("/src/landscape/clearance.ts");
      // The layout on a copy, at (x, z): every piece where the game's own rule takes it, clear of other track.
      const plan = (x, z) => {
        const s = new T.Layout();
        const id = s.addPiece(type, { x, z, heading: 0 }, 0, false);
        const out = [{ type, pose: { x, z, heading: 0 }, flipped: false }];
        const legs = {};
        for (const c of ends) {
          let ref = T.connectorRef(id, c);
          legs[c] = [];
          for (const lt of leg) {
            const e = s.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
            const nid = s.addPiece(lt, { x: e.x, z: e.z, heading: e.heading }, 0, false);
            out.push({ type: lt, pose: { x: e.x, z: e.z, heading: e.heading }, flipped: false, leg: c });
            ref = T.connectorRef(nid, 1);
          }
        }
        return out;
      };
      const t = w.controls.target;
      let spot = null;
      for (let d = 0; d < 5000 && !spot; d += 72) {
        const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 72));
        for (let a = 0; a < n && !spot; a++) {
          const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
          const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
          const pieces = plan(x, z);
          if (![...w.layout.pieceIds()].every((i) => Math.hypot(w.layout.getPiece(i).pose.x - x, w.layout.getPiece(i).pose.z - z) > 900)) continue;
          if (pieces.every((q) => checkPlacement(w.landscape, q.type, false, q.pose, 0).kind === "clear")) spot = { x, z, pieces };
        }
      }
      if (!spot) return { error: "no room" };
      const ids = spot.pieces.map((q) => w.editor().placeRun([{ type: q.type, pose: q.pose, y: 0, flipped: q.flipped }])[0]);
      window.__laid = ids;
      const piece = ids[0];
      const legIds = {};
      spot.pieces.forEach((q, i) => {
        if (q.leg !== undefined) (legIds[q.leg] ??= []).push(ids[i]);
      });
      w.layout.setSwitchState(piece, state);
      // The train on the leg's second piece, heading in (toward the piece).
      // (Tried along the leg till the whole train fits on it.)
      let placed = { kind: "none" };
      for (const [k, sAt] of [[1, 200], [1, 150], [0, 200], [1, 100], [0, 120]]) {
        placed = w.sim.addTrain(cars, { pieceId: legIds[from][k], pathIndex: 0, s: sAt, reversed: true });
        if (placed.kind === "placed") break;
      }
      if (placed.kind !== "placed") return { error: "no room for the train" };
      window.__laid = ids;
      const tr = w.sim.getTrain(placed.trainId);
      const engine = tr.cars[0].id;
      w.sim.setLever(engine, 1);
      let there = false;
      for (let i = 0; i < 120 * 60 && !there; i++) {
        w.sim.tick();
        const tt = w.sim.findCar(engine).train;
        // (Its engine's front a little way onto the road wanted, with the train behind it.)
        there = tt.bogies.some((bg) => bg.pieceId === piece && bg.pathIndex === onPath && bg.s > 40);
        if (lever && i === 0) w.sim.toggleSwitch(piece, lever);
      }
      w.sim.setLever(engine, 0);
      for (let i = 0; i < 60; i++) w.sim.tick();
      const at = w.layout.getPiece(piece).pose;
      const mid = T.getPieceDef(type, false).connectors.reduce((s2, c) => ({ x: s2.x + c.pose.x / 4, z: s2.z + c.pose.z / 4 }), { x: 0, z: 0 });
      const V = w.camera.position.constructor;
      w.lookAt(new V(at.x + mid.x, 0, at.z + mid.z), distance, tilt, theta);
      w.invalidate();
      return { piece, there, state: w.layout.switchState(piece) };
    },
    { type, ends, leg, from, state, onPath, cars, distance, theta, tilt, lever },
  );
  if (r.error) {
    console.log(`${name}: ${r.error}`);
    await p.evaluate(() => { const w = window.woodrail; for (const id of [...(window.__laid ?? [])].reverse()) if (w.layout.getPiece(id)) w.editor().remove(id); });
    return null;
  }
  await settle();
  await p.waitForTimeout(500);
  await settle();
  const path = `${OUT}/${name}.jpg`;
  await p.screenshot({ path, type: "jpeg", quality: 82, timeout: 180000 });
  console.log(`${name}: ${path} ${JSON.stringify(r)}`);
  // (Taken up again, the train first, so the next layout finds room near the view.)
  await p.evaluate(() => {
    const w = window.woodrail;
    const ids = window.__laid ?? [];
    for (const id of w.sim.trainIds()) if (w.sim.getTrain(id).bogies.some((b) => ids.includes(b.pieceId))) w.sim.removeTrain(id);
    for (let pass = 0; pass < 3; pass++) for (const id of [...ids].reverse()) if (w.layout.getPiece(id)) w.editor().remove(id);
    w.invalidate();
  });
  return path;
}

const LEG = ["straight-216", "straight-216", "buffer-turnback"];
const shots = [];
// The double slip set to turn: a train from end 0 on the curve onto the other line (path 2).
shots.push(await shot("track-pieces-slip-double", { type: "slip-double", ends: [0, 1, 2, 3], leg: LEG, from: 0, state: 1, onPath: 2 }));
// The single slip set to turn: the same, its one curve.
shots.push(await shot("track-pieces-slip-single", { type: "slip-single", ends: [0, 1, 2, 3], leg: LEG, from: 0, state: 1, onPath: 2, theta: -2.2 }));
// The double three-way: its right lever thrown (state 2), a train from the trunk on the right branch (path 2).
shots.push(await shot("track-pieces-double-three-way", { type: "switch-3way-double", ends: [0, 1, 2, 3], leg: LEG, from: 0, state: 2, onPath: 2, theta: -0.6 }));

// The turntable, turned by Turntable controls: a tap on a road (as `Interaction.turnDeckToRoad` does it, the deck
// turned straight to the road by `Sim.turnDeckTo`), its engine carried round, caught part way.
const tt = await p.evaluate(async () => {
  const w = window.woodrail;
  const T = await import("/src/track/index.ts");
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
  const { deckRoadAt } = await import("/src/game/deck-roads.ts");
  const t = w.controls.target;
  const roads = [0, 2, 3, 5, 6];
  const plan = (x, z) => {
    const s = new T.Layout();
    const id = s.addPiece("kit-turntable", { x, z, heading: 0 }, 0, false);
    const out = [{ type: "kit-turntable", pose: { x, z, heading: 0 } }];
    for (const k of roads) {
      const e = s.worldConnector(T.connectorRef(id, k), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      out.push({ type: "straight-216", pose: { x: e.x, z: e.z, heading: e.heading }, road: k });
      const s1 = s.addPiece("straight-216", { x: e.x, z: e.z, heading: e.heading }, 0, false);
      const e2 = s.worldConnector(T.connectorRef(s1, 1), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      out.push({ type: "buffer", pose: { x: e2.x, z: e2.z, heading: e2.heading } });
    }
    return out;
  };
  let spot = null;
  for (let d = 0; d < 5000 && !spot; d += 72) {
    const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 72));
    for (let a = 0; a < n && !spot; a++) {
      const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
      const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
      const pieces = plan(x, z);
      if (![...w.layout.pieceIds()].every((i) => Math.hypot(w.layout.getPiece(i).pose.x - x, w.layout.getPiece(i).pose.z - z) > 900)) continue;
      if (pieces.every((q) => checkPlacement(w.landscape, q.type, false, q.pose, 0).kind === "clear")) spot = { x, z, pieces };
    }
  }
  if (!spot) return { error: "no room" };
  const ids = spot.pieces.map((q) => w.editor().placeRun([{ type: q.type, pose: q.pose, y: 0, flipped: false }])[0]);
  const deck = ids[0];
  const road3 = ids[spot.pieces.findIndex((q) => q.road === 3)];
  const placed = w.sim.addTrain(["engine"], { pieceId: deck, pathIndex: 0, reversed: false, s: 122 });
  if (placed.kind !== "placed") return { error: "no room on the deck" };
  // A tap on road 3's middle: the road it means, and the deck turned to it.
  const q = w.layout.getPiece(road3).pose;
  const tap = { x: q.x + Math.cos(q.heading) * 108, z: q.z + Math.sin(q.heading) * 108 };
  const r = deckRoadAt(w.layout, road3, tap.x, tap.z);
  const turned = r ? w.sim.turnDeckTo(r.deck, r.road) : false;
  const V = w.camera.position.constructor;
  const c = w.layout.getPiece(deck).pose;
  w.lookAt(new V(c.x + 92 * Math.cos(c.heading), 0, c.z + 92 * Math.sin(c.heading)), 950, 0.95, -0.5);
  w.invalidate();
  return { deck, road: r?.road, turned };
});
if (tt.error) console.log(`turntable: ${tt.error}`);
else {
  // (Once it's there, the engine turned with it: the deck's model glides by the clock, the sim by its ticks, so a
  // picture part way would show them apart.)
  await p.evaluate(() => {
    for (let i = 0; i < 60; i++) window.woodrail.sim.tick();
    window.woodrail.invalidate();
  });
  await settle();
  const after = `${OUT}/track-pieces-turntable-controls.jpg`;
  await p.screenshot({ path: after, type: "jpeg", quality: 82, timeout: 180000 });
  shots.push(after);
}

console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
console.log(JSON.stringify(shots.filter(Boolean)));
await b.close();
await server.close();
