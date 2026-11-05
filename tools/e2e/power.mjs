// End-to-end: power as sparks and the wind farm (Game mode, a 390×844 phone with touch). Late-game spec W1
// (docs/superpowers/specs/2026-11-04-late-game-design.md).
//
//   1. Electricity and Wind farm learned and two turbines in the toy box (setup shortcuts: the study and the workshop
//      aren't what's tested). The wind turbine is on the Industries tab, two in the toy box.
//   2. Dragged by touch onto flat ground: refused, a toast says it goes on a hilltop. Dragged onto a hilltop: it stands
//      there, one fewer in the toy box. Its rotor turns while it's in view (frames drawn); paused, it stands still and
//      nothing is drawn.
//   3. A power station with coal (put down by the editor, coal on its pile: setup). Its card, by a tap: 5 sparks, 4
//      from coal and 1 from the wind, 5 spare.
//   4. The payoff: the map's sawmill, logs kept on its pile, makes planks at its own pace; its card's "⚡ Power this
//      yard" tapped: it says it's powered, and makes planks 1.5× as fast (counted per second of game time).
//   5. Electric engines take sparks first: one on a line runs at 1.4×; six of them take all five sparks, the last at
//      steam speed (never stopped), and the sawmill waits for a spark (its card says so). The power station's card
//      says one engine is at steam speed.
//   6. Reloaded: the turbine still stands, the sawmill is still asked for.
//
// Usage: npm run e2e:power [-- <out dir>]   (default out: e2e-out/power)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/power";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks held still: this counts idle frames. The turbine's rotor is what's tested, so industries aren't held still.)
pinClocksIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  window.__allClicks = 0;
  window.addEventListener("click", () => window.__allClicks++, { capture: true });
});
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
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
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
  await frames();
};
const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
const glideTo = async (v, dist = 900) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y ?? 0, v.z), dist, { duration: 0.2 }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
/** A button by selector, once it's drawn and has stood still past the card tap guard. */
const tapButton = async (sel) => {
  const ok = await p.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0), sel, { timeout: 20000 }).then(() => true, () => false);
  if (!ok) return false;
  await frames();
  await p.waitForTimeout(400);
  const [x, y] = await p.evaluate((sel) => {
    const r = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);
  await tapped(() => p.touchscreen.tap(x, y));
  return true;
};
/** A depot's middle (its yard's track), in the world. */
const depotAt = (depotId) =>
  p.evaluate((id) => {
    const w = window.woodrail;
    const piece = w.layout.getPiece(w.economy.depot(id).pieceId);
    return { x: piece.pose.x + Math.cos(piece.pose.heading) * 108, y: piece.y, z: piece.pose.z + Math.sin(piece.pose.heading) * 108 };
  }, depotId);
/** Tap a depot to open its card. */
const openDepot = async (depotId) => {
  for (let tries = 0; tries < 3; tries++) {
    const at = await depotAt(depotId);
    await glideTo(at, 900);
    const [x, y] = await screenOf(at);
    await tapped(() => p.touchscreen.tap(x, y));
    await p.waitForTimeout(300);
    if (await p.evaluate((id) => window.woodrail.hud.depotCardOpen && window.woodrail.interaction.openDepotId === id, depotId)) return true;
  }
  return false;
};
const powerLines = () => p.evaluate(() => [...document.querySelectorAll(".depot-power .power-line")].map((e) => e.textContent));
const closeCards = () => p.evaluate(() => window.woodrail.hud.hideCards?.());
const enterGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
};
/** Drag the turbine from the tray to a world point by touch (the finger under where it's held: the prop rides above it). */
const dragTurbine = async (at) => {
  await p.evaluate(() => document.querySelector(".tray-item[data-key='prop:mech-wind-turbine']")?.scrollIntoView({ inline: "center" }));
  await frames();
  const from = await p.evaluate(() => {
    const e = document.querySelector(".tray-item[data-key='prop:mech-wind-turbine']");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  if (!from) return false;
  // (On touch a held prop is carried by its middle as drawn, that high over the ground, a lift above the finger: aim
  // there, so the turbine's foot comes down at `at`.)
  const mid = await p.evaluate(() => {
    const m = window.woodrail.propLibrary.model("mech-wind-turbine");
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const part of m.parts) {
      part.geometry.computeBoundingBox();
      const bb = part.geometry.boundingBox;
      ["x", "y", "z"].forEach((k, i) => {
        lo[i] = Math.min(lo[i], bb.min[k]);
        hi[i] = Math.max(hi[i], bb.max[k]);
      });
    }
    return { x: (lo[0] + hi[0]) / 2, y: (lo[1] + hi[1]) / 2, z: (lo[2] + hi[2]) / 2 };
  });
  const [tx, ty] = await screenOf({ x: at.x + mid.x, y: (at.y ?? 0) + 6 + mid.y, z: at.z + mid.z });
  let t = Date.now() / 1000;
  await touch("touchStart", from[0], from[1], t);
  for (let k = 1; k <= 16; k++) await touch("touchMove", from[0] + ((tx - from[0]) * k) / 16, from[1] + ((ty + 56 - from[1]) * k) / 16, (t += 0.04));
  await p.waitForTimeout(400);
  await frames();
  if (process.env.E2E_DEBUG) {
    await shot(`held-${Math.round(at.x)}`);
    console.log("held:", JSON.stringify(await p.evaluate(() => ({ drag: window.woodrail.interaction.dragKind ?? null, toast: [...document.querySelectorAll(".toast")].map((e) => e.textContent) }))));
  }
  await touch("touchEnd", 0, 0, (t += 0.05));
  await p.waitForTimeout(600);
  await frames();
  return true;
};
const turbines = () => p.evaluate(() => [...window.woodrail.world.props.all()].filter((x) => x.asset === "mech-wind-turbine").map((x) => ({ x: x.x, z: x.z, y: x.y })));
const inBox = () => p.evaluate(() => document.querySelector(".tray-item[data-key='prop:mech-wind-turbine'] .have")?.textContent ?? null);

await p.goto(PAGE);
await enterGame();

// 1. Setup (not what's tested): Electricity and Wind farm learned, two turbines made (in the toy box).
await p.evaluate(() => {
  const w = window.woodrail;
  const pr = w.progress();
  for (const t of ["electricity", "wind"]) w.learn(t);
  pr.add("prop:mech-wind-turbine", 2);
  w.hud.refreshTrayBadges();
  w.hud.trayLearned();
});
await p.evaluate(() => [...document.querySelectorAll(".tabs button")].find((e) => e.textContent.trim().startsWith("Industries"))?.click());
await p.waitForTimeout(500);
const keys = await p.evaluate(() => [...document.querySelectorAll(".tray-item[data-key]")].map((e) => e.dataset.key));
check("1. Wind farm learned: the wind turbine is on the Industries tab", keys.includes("prop:mech-wind-turbine"), JSON.stringify(keys.filter((k) => k.includes("power") || k.includes("wind"))));
check("…two in the toy box", (await inBox()) === "2", String(await inBox()));

// Where to try it: a flat square near the first town, and a hilltop, each clear for the turbine.
const spots = await p.evaluate(async () => {
  const w = window.woodrail;
  const { checkProp, TrackIndex } = await import("/src/props/placement.ts");
  await w.propLibrary.load("mech-wind-turbine");
  const fp = w.propLibrary.footprint("mech-wind-turbine");
  const g = w.world.landscape.grid;
  const ctx = { land: w.world.landscape, track: new TrackIndex(w.layout), props: w.world.props, footprint: (a) => w.propLibrary.footprint(a) };
  const c = w.world.landscape.towns[0].centre;
  let flat = null;
  let hill = null;
  let bestFlat = Infinity;
  let bestHill = Infinity;
  g.forEachCell((i, col, row) => {
    const at = { x: g.centreX(col), z: g.centreZ(row) };
    const d = Math.hypot(at.x - c.x, at.z - c.z);
    if (d > 2500) return;
    if (g.height[i] === 0 && d < bestFlat && d > 500 && checkProp(ctx, fp, { ...at, heading: 0 }, "land").kind === "clear") {
      bestFlat = d;
      flat = { ...at, y: 0 };
    }
    if (g.height[i] > 0 && d < bestHill) {
      const r = checkProp(ctx, fp, { ...at, heading: 0 }, "hill");
      if (r.kind === "clear") {
        bestHill = d;
        hill = { ...at, y: r.y };
      }
    }
  });
  return { flat, hill };
});
check("found a flat square and a hilltop to try", !!spots.flat && !!spots.hill, JSON.stringify(spots));

// 2. On flat ground: refused, and told why.
if (spots.flat) {
  await glideTo(spots.flat, 900);
  // (What the player is told: every toast asked for, whether or not one was showing then.)
  await p.evaluate(() => {
    const hud = window.woodrail.hud;
    const toast = hud.toast.bind(hud);
    window.__toasts = [];
    hud.toast = (m, ...a) => {
      window.__toasts.push(m);
      return toast(m, ...a);
    };
  });
  await dragTurbine(spots.flat);
  await p.waitForFunction(() => window.__toasts.some((m) => /hilltop/.test(m)), null, { timeout: 8000 }).catch(() => {});
  const toast = await p.evaluate(() => window.__toasts.join(" | "));
  check("2. dragged onto flat ground: refused, with why", (await turbines()).length === 0 && /hilltop/.test(toast), JSON.stringify({ turbines: await turbines(), toast }));
  await shot("1-refused-flat");
}
if (spots.hill) {
  await glideTo(spots.hill, 900);
  await dragTurbine(spots.hill);
  const now = await turbines();
  check("…dragged onto a hilltop: it stands there, on the hill", now.length === 1 && now[0].y > 0, JSON.stringify(now));
  check("…one fewer in the toy box", (await inBox()) === "1", String(await inBox()));
  const card = await p.evaluate(() => [...document.querySelectorAll(".piece-card")].filter((e) => !e.hidden).map((e) => e.textContent).join(" "));
  check("…its card says it makes a spark of power, counted as it stands (1 in all)", /A spark of power\. 1 in all/.test(card), card);
  // Its rotor turns while in view, near enough to see.
  await glideTo(now[0] ?? spots.hill, 700);
  const r0 = await p.evaluate(() => ({ a: window.woodrail.turbinesView.turned, f: window.woodrail.framesDrawn, n: window.woodrail.turbinesView.count }));
  // (Under software GL a frame of a turbine close up can take a second or more: wait for a few.)
  await p.waitForFunction((f) => window.woodrail.framesDrawn >= f + 3, r0.f, { timeout: 30000 }).catch(() => {});
  const r1 = await p.evaluate(() => ({ a: window.woodrail.turbinesView.turned, f: window.woodrail.framesDrawn }));
  check("…its rotor turns in view, frames drawn while it does", r0.n === 1 && r1.a !== r0.a && r1.f > r0.f, JSON.stringify({ r0, r1 }));
  await glideTo(now[0] ?? spots.hill, 1300);
  await p.waitForTimeout(1500);
  await shot("2-turbine-on-hill");
  // Paused: still, nothing drawn.
  await p.evaluate(() => [...document.querySelectorAll("button")].find((e) => /^Pause/.test(e.title))?.click());
  await p.waitForFunction(() => window.woodrail.paused, null, { timeout: 10000 }).catch(() => {});
  await settle();
  const s0 = await p.evaluate(() => ({ a: window.woodrail.turbinesView.turned, f: window.woodrail.framesDrawn }));
  await p.waitForTimeout(6000);
  const s1 = await p.evaluate(() => ({ a: window.woodrail.turbinesView.turned, f: window.woodrail.framesDrawn }));
  check("…paused: the rotor stands still and no frames are drawn", s1.a === s0.a && s1.f === s0.f, JSON.stringify({ s0, s1 }));
  await p.evaluate(() => [...document.querySelectorAll("button")].find((e) => /^(Play|Resume|Pause)/.test(e.title) && window.woodrail.paused)?.click());
  await p.waitForFunction(() => !window.woodrail.paused, null, { timeout: 10000 }).catch(() => {});
}

// 3. A power station with coal (setup: put down by the editor on clear ground, coal on its pile).
const station = await p.evaluate(async () => {
  const w = window.woodrail;
  const i = w.interaction;
  const c = w.world.landscape.towns[0].centre;
  for (let ring = 2; ring < 30; ring++)
    for (let k = 0; k < 16; k++)
      for (const heading of [0, Math.PI / 2]) {
        const a = (k * Math.PI) / 8;
        const pose = { x: Math.round((c.x + Math.cos(a) * ring * 150) / 18) * 18, z: Math.round((c.z + Math.sin(a) * ring * 150) / 18) * 18, heading };
        if (i.placement("depot-power", false, pose, 0, -1).reason) continue;
        const id = w.editor().place("depot-power", pose, 0, false);
        await new Promise((r) => setTimeout(r, 300));
        const d = w.economy.depotAtPiece(id);
        if (!d) return { error: "no depot for the power station" };
        d.piles[(await import("/src/economy/cargo.ts")).CARGO.coal.index] = 6;
        return { depot: d.id };
      }
  return { error: "no room for a power station" };
});
check("3. a power station with coal is down (setup)", station.depot !== undefined, JSON.stringify(station));
// (The sparks are counted once a second.)
await p.waitForTimeout(1500);
if (station.depot !== undefined) {
  const open = await openDepot(station.depot);
  await p.waitForTimeout(500);
  const lines = await powerLines();
  check("…its card, by a tap: 5 sparks, 4 from coal and 1 from the wind, 5 spare", open && lines.some((l) => /5 sparks: 4 from coal, 1 from the wind/.test(l)) && lines.some((l) => /^5 spare/.test(l)), JSON.stringify({ open, lines }));
  await shot("3-power-card");
  await closeCards();
}

// 4. The payoff: the map's sawmill makes planks 1.5× as fast once powered.
const sawmill = await p.evaluate(() => window.woodrail.economy.allDepots().find((d) => d.role === "sawmill")?.id ?? null);
check("4. the map has a sawmill", sawmill !== null);
/** Planks made per second of game time over `ms` (logs kept on its pile, planks taken off: setup, so it never stops). */
const plankRate = (ms) =>
  p.evaluate(
    async ({ id, ms }) => {
      const w = window.woodrail;
      const { CARGO } = await import("/src/economy/cargo.ts");
      const d = w.economy.depot(id);
      const keep = () => {
        d.piles[CARGO.log.index] = 10;
        d.piles[CARGO.planks.index] = 0;
      };
      keep();
      const timer = setInterval(keep, 200);
      const m0 = w.economy.made[CARGO.planks.index];
      const t0 = w.simSeconds;
      await new Promise((r) => setTimeout(r, ms));
      clearInterval(timer);
      return { made: w.economy.made[CARGO.planks.index] - m0, seconds: w.simSeconds - t0, rate: d.rate };
    },
    { id: sawmill, ms },
  );
if (sawmill !== null) {
  // (The view away from the sawmill's saw: the game's own clock runs at its pace with nothing to draw.)
  await glideTo({ x: 0, z: -4000 }, 3000);
  const before = await plankRate(30000);
  const opened = await openDepot(sawmill);
  const asked = opened && (await tapButton(".depot-power button[data-power='on']"));
  await p.waitForTimeout(1500);
  const lines = await powerLines();
  check("…its card's ⚡ Power this yard, tapped: it says it's powered, 1.5× as fast", asked && lines.some((l) => /Powered: works 1.5× as fast/.test(l)), JSON.stringify({ opened, asked, lines }));
  await shot("4-sawmill-powered");
  await closeCards();
  await glideTo({ x: 0, z: -4000 }, 3000);
  const after = await plankRate(30000);
  const per = (r) => r.made / Math.max(1, r.seconds);
  check("…and it makes planks 1.5× as fast (per second of game time)", after.rate / before.rate > 1.45 && per(after) > per(before) * 1.25, JSON.stringify({ before, after }));
}

// 5. Electric engines take the sparks first: six on a line, five sparks.
const engines = await p.evaluate(async () => {
  const w = window.woodrail;
  const { ENGINE_SPEED } = await import("/src/sim/index.ts");
  const i = w.interaction;
  const seq = ["buffer-turnback", "straight-216", "straight-216", "straight-216", "straight-216", "straight-216", "straight-216", "buffer-turnback"];
  const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  const town = w.world.landscape.towns[0].centre;
  let ids = null;
  for (let ring = 3; ring < 30 && !ids; ring++)
    for (let k = 0; k < 16 && !ids; k++) {
      const a = (k * Math.PI) / 8;
      let t = { x: Math.round((town.x + Math.cos(a) * ring * 200) / 18) * 18, z: Math.round((town.z + Math.sin(a) * ring * 200) / 18) * 18, heading: 0 };
      const laid = [];
      let ok = true;
      for (const type of seq) {
        const pose = { x: t.x, z: t.z, heading: t.heading };
        if (i.placement(type, false, pose, 0, -1).reason) {
          ok = false;
          break;
        }
        const id = w.editor().place(type, pose, 0, false);
        laid.push(id);
        t = c(id, type === "buffer-turnback" ? 0 : 1);
      }
      if (ok) ids = laid;
      else for (const id of laid.reverse()) w.editor().remove(id);
    }
  if (!ids) return { error: "no room for a line" };
  const put = (piece, s) => {
    const r = w.sim.addTrain(["engine"], { pieceId: piece, pathIndex: 0, reversed: false, s });
    if (r.kind !== "placed") return null;
    const t = w.sim.getTrain(r.trainId);
    w.sim.setLook(t.cars[0].id, "electric");
    return r.trainId;
  };
  const first = put(ids[1], 100);
  const one = first === null ? null : w.sim.topSpeed(w.sim.getTrain(first)) / ENGINE_SPEED;
  const more = [];
  for (const [n, s] of [[2, 60], [2, 160], [3, 60], [3, 160], [4, 100]]) more.push(put(ids[n], s));
  if (more.some((x) => x === null)) return { error: "no room for six engines", more };
  // (Counted once a second in the game: the next count is waited for below.)
  return { one, trains: [first, ...more] };
});
check("5. one electric engine on a line, with a spark, runs at 1.4×", Math.abs((engines.one ?? 0) - 1.4) < 1e-6, JSON.stringify(engines));
await p.waitForTimeout(1500);
if (engines.trains) {
  const speeds = await p.evaluate(async (trains) => {
    const { ENGINE_SPEED } = await import("/src/sim/index.ts");
    const w = window.woodrail;
    return trains.map((id) => +(w.sim.topSpeed(w.sim.getTrain(id)) / ENGINE_SPEED).toFixed(3));
  }, engines.trains);
  check("…six of them, five sparks: five at 1.4×, the last at steam speed (never stopped)", speeds.filter((s) => s === 1.4).length === 5 && speeds[5] === 1, JSON.stringify(speeds));
  if (sawmill !== null) {
    await openDepot(sawmill);
    await p.waitForTimeout(500);
    const lines = await powerLines();
    const rate = await p.evaluate((id) => window.woodrail.economy.depot(id).rate, sawmill);
    check("…the sawmill now waits for a spark (its card says so), at its own pace", lines.some((l) => /Waiting for a spare spark/.test(l)) && rate < 1.2, JSON.stringify({ lines, rate }));
    await closeCards();
  }
  if (station.depot !== undefined) {
    await openDepot(station.depot);
    await p.waitForTimeout(500);
    const lines = await powerLines();
    check("…the power station's card: 6 electric engines, 1 at steam speed", lines.some((l) => /Electric engines: 6, 1 at steam speed/.test(l)), JSON.stringify(lines));
    await shot("5-power-short");
    await closeCards();
  }
}

// 6. Reloaded: the turbine and the ask are kept.
await p.waitForTimeout(3000);
await p.reload();
await enterGame();
const back = await p.evaluate((id) => {
  const w = window.woodrail;
  return { turbines: [...w.world.props.all()].filter((x) => x.asset === "mech-wind-turbine").length, asked: id === null ? null : w.economy.depot(id).powerAsk };
}, sawmill);
check("6. reloaded: the turbine still stands, the sawmill is still asked for", back.turbines === 1 && back.asked > 0, JSON.stringify(back));

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(`\n${failures === 0 ? "e2e:power passed" : `e2e:power: ${failures} failed`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
