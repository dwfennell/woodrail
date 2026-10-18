// End-to-end train lift in Sandbox (`npm run e2e:lift`), on a phone-sized view (390×844): a line built with the lift in
// it (felt, the lift, a level up, buffers at both ends), a train run up and back down (sim and economy stepped directly,
// as the kit harness does: headless frames are slow), its positions and heights checked and nothing derailed; then
// idle frames with a still lift on screen, still and paused (also paused mid-ride): none asked for by the lift.
//
// Usage: npm run e2e:lift [-- <out dir>]   (default out: e2e-out/lift; pictures mid-ride and at the top)
// Starts its own dev server. Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium if present.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/lift";
mkdirSync(OUT, { recursive: true });
const started = Date.now();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
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
const settle = (ticks = 3) => p.evaluate((t) => Promise.race([window.woodrail.settled(t), new Promise((r) => setTimeout(r, 30000))]), ticks);

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((b) => !b.hidden && b.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();

// The line: on clear ground found outwards from the middle, each piece on the last one's far end at its height, with
// the risers it needs (the straight a level up off the lift's high end has one under its far end).
const built = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
  const seq = ["buffer-turnback", "straight-216", "straight-216", "kit-train-lift", "straight-216", "straight-216", "buffer-turnback"];
  const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  let why = "";
  for (let ring = 1; ring < 20; ring++)
    for (let k = 0; k < 16; k++)
      for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const a = (k * Math.PI) / 8;
        let t = { x: Math.round((Math.cos(a) * ring * 360) / 18) * 18, z: Math.round((Math.sin(a) * ring * 360) / 18) * 18, heading, y: 0 };
        const ids = [];
        let ok = true;
        for (const [n, type] of seq.entries()) {
          const pose = { x: t.x, z: t.z, heading: t.heading };
          const r = w.interaction.placement(type, false, pose, t.y, -1);
          if (r.reason) {
            ok = false;
            why = `${type}: ${r.reason}`;
            break;
          }
          const id = w.editor().place(type, pose, t.y, false, r.risers);
          ids.push(id);
          // The first buffer is joined by its only end; the rest run on from their far ends.
          if (n < seq.length - 1) t = c(id, n === 0 ? 0 : 1);
        }
        if (ok) {
          await w.kitView.load("kit-train-lift");
          w.syncKits(true);
          return { ids, risers: w.layout.pieceIds().filter((id) => w.layout.getPiece(id).type === "riser").length };
        }
        for (const id of ids.reverse()) w.editor().remove(id);
      }
  return { error: why };
});
check("built a line through the lift (felt, lift, a level up)", !!built.ids, JSON.stringify(built));
if (!built.ids) {
  await b.close();
  await server.close();
  process.exit(1);
}
const [, , near, lift, high, far] = built.ids;

await p.evaluate(
  ({ lift }) => {
    const w = window.woodrail;
    // Step the world n ticks (the game's own loop paused), the kits' parts updated as the frame loop would.
    w.__step = (n, each) => {
      w.paused = true;
      for (let k = 0; k < n; k++) {
        w.sim.tick();
        w.economy.tick();
        for (const e of w.sim.drainEvents()) w.__events.push(e.kind);
        if (k % 2 === 1) w.kitView.update(w.kitTriggered, 2 / 120);
        if (each && each(k) === true) return k;
      }
      return n;
    };
    w.__events = [];
    // The view on the lift's middle, framing a circle `radius` round it (as camera-director's frameDistance).
    w.__lookLift = (radius = 230) => {
      const v = (w.camera.fov * Math.PI) / 360;
      const dist = radius / Math.sin(Math.min(v, Math.atan(Math.tan(v) * w.camera.aspect)));
      const piece = w.layout.getPiece(lift);
      const x = piece.pose.x + 144 * Math.cos(piece.pose.heading);
      const z = piece.pose.z + 144 * Math.sin(piece.pose.heading);
      w.director.glideTo(new w.camera.position.constructor(x, 30, z), dist, { duration: 0.1 });
    };
  },
  { lift },
);

// A train of an engine and a coach on the felt, heading for the lift.
const run = await p.evaluate(
  ({ near, lift, high, far }) => {
    const w = window.woodrail;
    const placed = w.sim.addTrain(["engine", "passenger"], { pieceId: near, pathIndex: 0, reversed: false, s: 200 });
    if (placed.kind !== "placed") return { error: "no room for the train" };
    const id = placed.trainId;
    const t = () => w.sim.getTrain(id) ?? w.sim.getTrain(w.sim.trainIds()[0]);
    w.sim.setLever(t().cars[0].id, 1);
    const at = () => ({ piece: t().bogies[0].pieceId, path: t().bogies[0].pathIndex, s: Math.round(t().bogies[0].s), y: Math.round(t().world[0].y * 10) / 10, speed: Math.round(t().speed) });
    const out = {};
    // Halted on the platform (wholly on it), then carried: stop at the middle of the ride.
    w.__step(120 * 20, () => t().bogies.every((b) => b.pieceId === lift) && t().speed === 0);
    out.halted = { ...at(), wholly: t().bogies.every((b) => b.pieceId === lift) };
    w.__step(120 * 5, () => w.sim.liftPosition(lift) >= 0.5);
    out.mid = { ...at(), lift: Math.round(w.sim.liftPosition(lift) * 100) / 100, state: w.sim.liftState(t().id) };
    return { id, out };
  },
  { near, lift, high, far },
);
check("a train halts wholly on the platform", run.out?.halted?.wholly && run.out.halted.speed === 0, JSON.stringify(run.out?.halted));
check("mid-ride: the train is carried, drawn half way up", run.out?.mid?.state === "riding" && run.out.mid.y > 10 && run.out.mid.y < 40, JSON.stringify(run.out?.mid));
await p.evaluate(() => window.woodrail.__lookLift());
await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
await p.evaluate(() => window.woodrail.invalidate());
await settle();
await shot("lift-mid-ride");

const top = await p.evaluate(
  ({ lift }) => {
    const w = window.woodrail;
    const t = () => w.sim.getTrain(w.sim.trainIds()[0]);
    w.__step(120 * 4, () => w.sim.liftPosition(lift) === 1 && !w.layout.deckTurning(lift));
    return { lift: w.sim.liftPosition(lift), y: t().world[0].y, path: t().bogies[0].pathIndex, reversed: t().bogies[0].reversed, lever: t().cars[0].lever };
  },
  { lift },
);
check("at the top: the platform's up, the train on the upper road a level up, heading out, lever on", top.lift === 1 && Math.abs(top.y - 48) < 0.01 && top.path === 1 && top.reversed && top.lever !== 0, JSON.stringify(top));
await p.evaluate(() => window.woodrail.invalidate());
await settle();
await shot("lift-top");

// On: off the top to the buffer, back onto the platform there, down, and off the bottom.
const back = await p.evaluate(
  ({ near, lift, high, far }) => {
    const w = window.woodrail;
    const t = () => w.sim.getTrain(w.sim.trainIds()[0]);
    const seen = { far: false, maxY: 0, rodeDown: false, offBottom: false };
    let up = true;
    w.__step(120 * 60, () => {
      const tr = t();
      if (tr.bogies[0].pieceId === far) seen.far = true;
      seen.maxY = Math.max(seen.maxY, tr.world[0].y);
      if (seen.far && w.sim.liftState(tr.id) === "riding" && w.layout.switchState(lift) === 0) seen.rodeDown = true;
      if (up && seen.rodeDown && w.sim.liftPosition(lift) === 0) up = false;
      if (!up && tr.bogies.every((b) => b.pieceId !== lift) && tr.bogies[0].pieceId === near) {
        seen.offBottom = true;
        return true;
      }
    });
    const tr = t();
    w.paused = false;
    return { ...seen, y: tr.world[0].y, derailed: w.sim.trainIds().some((id) => w.sim.getTrain(id).derailed), events: [...new Set(w.__events)], trains: w.sim.trainCount, high };
  },
  { near, lift, high, far },
);
check("the train drives off the top to the high buffer, comes back and rides down", back.far && back.rodeDown && Math.abs(back.maxY - 48) < 0.01, JSON.stringify(back));
check("…and drives off the bottom on the felt", back.offBottom && Math.abs(back.y) < 0.01, JSON.stringify(back));
check("nothing derailed", !back.derailed && !back.events.includes("derailed") && back.trains === 1, JSON.stringify(back));

// Idle with the still lift on screen (trains taken off): no frames in 30 s running, none in 30 s paused; and paused
// mid-ride (the platform sent up empty) none either.
const idle = await p.evaluate(
  async ({ lift }) => {
    const w = window.woodrail;
    for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
    w.paused = false;
    w.__lookLift(300);
    await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
    const count = async (ms) => {
      const f0 = w.framesDrawn;
      await new Promise((r) => setTimeout(r, ms));
      return w.framesDrawn - f0;
    };
    // What asks for frames meanwhile: the kits (any answer but "still"), or something else on the map.
    const kitAsks = [];
    const update = w.kitView.update.bind(w.kitView);
    w.kitView.update = (...a) => {
      const r = update(...a);
      if (r !== "still") kitAsks.push(r);
      return r;
    };
    const clockTicks = [];
    const tick = w.clockView.tick.bind(w.clockView);
    w.clockView.tick = (...a) => {
      const r = tick(...a);
      if (r) clockTicks.push(1);
      return r;
    };
    // (The Sandbox map's own depots work on: a pile changing in view draws a frame. Counted, not the lift's.)
    const others = [];
    const depots = w.depotView.update.bind(w.depotView);
    w.depotView.update = (...a) => {
      const r = depots(...a);
      if (r !== "still") others.push("depots " + r);
      return r;
    };
    const boats = w.boats.update.bind(w.boats);
    w.boats.update = (...a) => {
      const r = boats(...a);
      if (r) others.push("boats");
      return r;
    };
    const still = await count(30000);
    w.depotView.update = depots;
    w.boats.update = boats;
    w.__others = others.length;
    w.kitView.update = update;
    w.clockView.tick = tick;
    w.paused = true;
    w.invalidate();
    await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
    const paused = await count(30000);
    // Mid-ride, paused: sent while running, paused a moment in.
    w.paused = false;
    const sent = w.sim.toggleSwitch(lift);
    const t0 = performance.now();
    while (w.sim.liftPosition(lift) < 0.05 && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 50));
    w.paused = true;
    const pos = w.sim.liftPosition(lift);
    await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
    const pausedMidRide = await count(30000);
    const held = w.sim.liftPosition(lift) === pos;
    w.paused = false;
    // Running again it carries on (headless frames are slow: a few seconds of them, then the rest stepped).
    await new Promise((r) => setTimeout(r, 5000));
    const resumed = w.sim.liftPosition(lift);
    w.__step(120 * 4, () => w.sim.liftPosition(lift) === 1);
    w.paused = false;
    return { others: w.__others, still, kitAsks: kitAsks.length, clockTicks: clockTicks.length, paused, sent, pos: Math.round(pos * 100) / 100, pausedMidRide, held, resumed: Math.round(resumed * 100) / 100, after: w.sim.liftPosition(lift) };
  },
  { lift },
);
console.log("idle frames with a still lift on screen (30 s each):", JSON.stringify(idle));
check("idle: a still lift on screen draws no frames, running (beyond the map's depots' own) or paused", idle.kitAsks === 0 && idle.still <= idle.others && idle.paused === 0, JSON.stringify(idle));
check("paused mid-ride: the platform holds and draws nothing; it carries on after", idle.sent && idle.pausedMidRide === 0 && idle.held && idle.pos > 0 && idle.pos < 1 && idle.resumed > idle.pos && idle.after === 1, JSON.stringify(idle));

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(failures ? `${failures} FAILED` : "ALL PASS", `(${Math.round((Date.now() - started) / 1000)} s)`);
await b.close();
await server.close();
process.exit(failures ? 1 : 0);
