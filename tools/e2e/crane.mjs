// End-to-end breakdown crane in Game mode on a 390×844 phone (`npm run e2e:crane [-- <out dir>]`), headless:
//
// 1. A goods train comes off the rails (the track under it moved, as a careless edit does). A crane train standing idle
//    on the same line sets out by itself: a toast says so, and the derailed train's card (opened by a tap on it) says
//    the crane is on its way. The crane drives up, lifts the train and sets it down: the payoff is the goods train back
//    on the track (not derailed, its cars and their order kept), a toast, and the crane train standing within reach.
// 2. A train runs nose to nose with the goods train, left standing (lever off) on the single track: stuck. (Two with
//    their levers on would no longer stand there: one gives way, stalls.ts.) The stuck engine's card says so and offers
//    "Send the crane"; a tap sends it: it drives out and lifts the train in the way off the line (back into the box).
//    The payoff: that train is gone, and the stuck train runs again.
//
// Setup shortcuts (not under test): the blueprints learned, the track put down by the editor, the trains put on the
// track by the sim (as the tray's drop does), the sim stepped by hand while paused (so a slow software-GL page keeps
// up). The crane's own behaviour, the cards and the button are the player's path.
//
// Usage: npm run e2e:crane [-- <out dir>]   (default out: e2e-out/crane)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/crane";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  window.__toasts = [];
});
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
// Toasts seen (each one's words), however briefly shown.
await p.evaluate(() => {
  const seen = new Set();
  new MutationObserver(() => {
    for (const t of document.querySelectorAll(".toast")) {
      const s = t.textContent.trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        window.__toasts.push(s);
      }
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true });
});

const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
const glideTo = async (v, dist = 700) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2 }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
/** The middle of a car's train's first car (by any car id). */
const carMid = (car) =>
  p.evaluate((car) => {
    const f = window.woodrail.sim.findCar(car);
    if (!f) return null;
    const t = f.train;
    const [a, c] = [t.world[2 * f.index], t.world[2 * f.index + 1]];
    return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 + 10, z: (a.z + c.z) / 2 };
  }, car);
/** Open a car's card by a tap on it, as a player would. */
const openCard = async (car) => {
  await p.evaluate(() => window.woodrail.hud.hideCards?.());
  const mid = await carMid(car);
  if (!mid) return false;
  await glideTo(mid, 600);
  await p.touchscreen.tap(...(await screenOf(mid)));
  await p.waitForTimeout(500);
  await frames();
  return p.evaluate(() => window.woodrail.hud.engineCardOpen);
};
/** Has a toast with these words shown (waited for: toasts queue behind one another, a few seconds each)? */
const toastSeen = async (words) => {
  for (let k = 0; k < 60; k++) {
    if (await p.evaluate((w) => window.__toasts.some((t) => t.includes(w)), words)) return true;
    await p.evaluate(() => window.woodrail.invalidate());
    await p.waitForTimeout(500);
  }
  return false;
};
const status = async () => {
  await p.evaluate(() => window.woodrail.invalidate());
  await frames();
  await frames();
  return p.evaluate(() => document.querySelector(".engine-card .engine-status")?.textContent ?? null);
};
/** Step the sim (paused) up to `secs`, until `until` (a function's source, run in the page) says so. */
const run = (secs, until = "() => false") =>
  p.evaluate(
    ([secs, until]) => {
      const w = window.woodrail;
      const done = eval(until);
      for (let i = 0; i < secs * 120; i++) {
        w.sim.tick();
        w.economy.tick();
        if (i % 30 === 0 && done()) return true;
      }
      w.invalidate();
      return done();
    },
    [secs, until],
  );

// The line: seven straights on level ground east of the start, the crane train at one end.
const at = await p.evaluate(async () => {
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const w = window.woodrail;
  for (const id of ["goods-engine", "cranes1", "breakdown"]) w.learn(id);
  const g = w.world.landscape.grid;
  const x = 160;
  const z = 1008;
  let end = w.editor().place("straight-216", { x, z, heading: 0 }, g.groundY(g.cellAtWorld(x, z)), false);
  const ids = [end];
  for (let k = 0; k < 6; k++) ids.push((end = appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ?? end));
  w.trackChanged();
  w.paused = true;
  const crane = w.sim.addTrain(["crane", "engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
  const goods = w.sim.addTrain(["engine", "van", "van"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 120 });
  if (crane.kind !== "placed" || goods.kind !== "placed") return { error: "no room" };
  window.__ids = ids;
  return { ids, crane: w.sim.getTrain(crane.trainId).cars[0].id, goods: w.sim.getTrain(goods.trainId).cars[0].id };
});
check("setup: the line and the two trains", !at.error, JSON.stringify(at));

// 1. Derailed: the crane sets out by itself, the card says so, and the train is put back on.
await p.evaluate((goods) => {
  const w = window.woodrail;
  w.sim.trackChanged([w.sim.findCar(goods).train.bogies[0].pieceId]);
}, at.goods);
const sent = await run(2, `() => !!window.woodrail.economy.breakdown.jobFor(${at.goods})`);
check("1. the idle crane train sets out by itself for the derailed train", sent && (await p.evaluate((c) => window.woodrail.economy.breakdown.jobOf(c)?.kind, at.crane)) === "rerail");
check("1. a toast says the crane is on its way", await toastSeen("breakdown crane is on its way"), JSON.stringify(await p.evaluate(() => window.__toasts)));
// (The crane train's card: a tap on a derailed car puts it back at once, the quick way, as before.)
await openCard(at.crane);
const craneSays = await status();
check("1. the crane train's card: on its way to a derailed train", craneSays === "Breakdown crane: on its way to a derailed train", craneSays);
await shot("1-crane-card");
await p.evaluate(() => window.woodrail.hud.hideCards?.());
const lifting = await run(60, `() => window.woodrail.economy.breakdown.jobFor(${at.goods})?.phase === "lift"`);
check("1. the crane drives up and lifts the train", lifting);
const near = await p.evaluate(([c, g]) => {
  const w = window.woodrail;
  const a = w.sim.findCar(c);
  const t = w.sim.findCar(g).train;
  const m = { x: (a.train.world[0].x + a.train.world[1].x) / 2, z: (a.train.world[0].z + a.train.world[1].z) / 2 };
  return Math.min(...t.world.map((q) => Math.hypot(q.x - m.x, q.z - m.z)));
}, [at.crane, at.goods]);
check("1. …standing beside it (within the crane's reach)", near < 260, near.toFixed(0));
await glideTo(await carMid(at.crane), 450);
await run(0.2);
await settle();
await shot("2-lifting");
const back = await run(20, `() => !window.woodrail.economy.breakdown.jobFor(${at.goods}) && !window.woodrail.sim.findCar(${at.goods}).train.derailed`);
const train = await p.evaluate((g) => {
  const t = window.woodrail.sim.findCar(g).train;
  return { derailed: t.derailed, kinds: t.cars.map((c) => c.kind) };
}, at.goods);
check("1. the payoff: the goods train is back on the track, its cars as they were", back && !train.derailed && JSON.stringify(train.kinds) === JSON.stringify(["engine", "van", "van"]), JSON.stringify(train));
await frames();
check("1. a toast says so", await toastSeen("put the train back on the track"));
check("1. the Re-rail chip is gone (nothing off the rails)", await p.evaluate(() => [...document.querySelectorAll("button")].every((x) => x.textContent !== "Re-rail" || x.hidden)));
await settle();
await shot("3-back-on");

// 2. Stuck: the goods train left standing on the single line, lever off, and a third train coming the other way, nose
// to nose with it. The third train's card says it's stuck and offers Send the crane; a tap sends the crane (behind the
// goods train), which lifts the goods train, the one in the way, off the line. (Both with their levers on, the goods
// train gave way since 2026-11-05: turned round and ran back to the crane train standing behind it.)
const stuck = await p.evaluate((goods) => {
  const w = window.woodrail;
  const ids = window.__ids;
  // (Left standing, lever off; the other train, its lever on, comes up the line to it.)
  const g = w.sim.findCar(goods).train;
  // (As far down the line as it goes, facing back up it.)
  let other = { kind: "none" };
  for (let s = 10; s < 216 && other.kind !== "placed"; s += 10) other = w.sim.addTrain(["engine", "hopper"], { pieceId: ids[6], pathIndex: 0, reversed: true, s });
  if (other.kind !== "placed") return { error: "no room", at: g.world.map((q) => Math.round(q.x)) };
  const oe = w.sim.getTrain(other.trainId).cars[0];
  w.sim.setLever(oe.id, oe.facing);
  return { other: oe.id };
}, at.goods);
check("2. setup: a train nose to nose with the goods train", !stuck.error, JSON.stringify(stuck));
const isStuck = await run(30, `() => !!window.woodrail.economy.stalls.stuckOf(${stuck.other})`);
check("2. both stand stuck", isStuck);
await openCard(stuck.other);
const stuckSays = await status();
check("2. the stuck train's card says it's stuck", /^Stuck/.test(stuckSays ?? ""), stuckSays);
await p.waitForFunction(() => {
  const b = document.querySelector(".engine-card .send-crane");
  return b && !b.hidden && b.getBoundingClientRect().width > 0;
}, null, { timeout: 20000 }).catch(() => {});
const btn = await p.evaluate(() => {
  const b = document.querySelector(".engine-card .send-crane");
  if (!b || b.hidden) return null;
  const r = b.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: b.textContent, inView: r.bottom <= innerHeight && r.right <= innerWidth };
});
check("2. …and offers Send the crane, on screen", btn?.text === "Send the crane" && btn.inView, JSON.stringify(btn));
await shot("4-stuck-card");
if (btn) await p.touchscreen.tap(btn.x, btn.y);
await p.waitForTimeout(500);
check("2. a tap sends the crane for the train in the way", (await p.evaluate((g) => window.woodrail.economy.breakdown.jobFor(g)?.kind, at.goods)) === "remove");
const gone = await run(90, `() => !window.woodrail.sim.findCar(${at.goods})`);
check("2. the payoff: the crane lifts the train in the way off the line", gone);
await p.evaluate(() => window.woodrail.hud.hideCards?.());
const runs = await run(20, `() => window.woodrail.sim.findCar(${stuck.other}).train.speed > 20`);
check("2. …and the stuck train runs again", runs);
await frames();
check("2. a toast says the train was lifted off", await toastSeen("lifted the train off the line"), JSON.stringify(await p.evaluate(() => window.__toasts)));

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
