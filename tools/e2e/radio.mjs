// End-to-end: the radio mast (Game mode, a 390×844 phone with touch). The user's pick of 2026-11-05: a radio mast in a
// town, with a spark of power, brings that town more riders (1.5× as often).
//
//   1. Electricity and Radio mast learned, and a mast in the toy box (setup shortcuts: the study and the workshop
//      aren't what's tested); a power station with coal (put down by the editor: setup).
//   2. The mast dragged from the Industries tab by touch onto clear ground in the first town: it stands there, and
//      its card says the town hears about the trains.
//   3. The payoff: over the same stretch of game time, people come to that town's station about 1.5× as often as to
//      the second town's (the same size, no mast). (Setup: each platform emptied as they come, so neither fills.)
//   4. The power station's coal gone (setup): no spark, the card says the town doesn't hear it.
//
// Usage: npm run e2e:radio [-- <out dir>]   (default out: e2e-out/radio)
import { boot, frames, glideTo, openMode, reporter, screenOf, shot } from "../../scripts/e2e/lib/e2e.mjs";

// (Clocks held still: this counts idle frames.)
const { page: p, url, out: OUT, errors, close, cdp: cdpOf } = await boot({ name: "radio", port: 5402, pinClocks: true, stillIndustries: true });
const { check, finish } = reporter("radio", { errors, close });
const cdp = await cdpOf();
const pic = (n) => shot(p, `${OUT}/${n}.png`);
const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
/** Drag the turbine from the tray to a world point by touch (the finger under where it's held: the prop rides above it). */
const dragTurbine = async (at) => {
  await p.evaluate(() => document.querySelector(".tray-item[data-key='prop:mech-radio-mast']")?.scrollIntoView({ inline: "center" }));
  await frames(p);
  const from = await p.evaluate(() => {
    const e = document.querySelector(".tray-item[data-key='prop:mech-radio-mast']");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  if (!from) return false;
  // (On touch a held prop is carried by its middle as drawn, that high over the ground, a lift above the finger: aim
  // there, so the turbine's foot comes down at `at`.)
  const mid = await p.evaluate(() => {
    const m = window.woodrail.propLibrary.model("mech-radio-mast");
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
  const [tx, ty] = await screenOf(p, { x: at.x + mid.x, y: (at.y ?? 0) + 6 + mid.y, z: at.z + mid.z });
  let t = Date.now() / 1000;
  await touch("touchStart", from[0], from[1], t);
  for (let k = 1; k <= 16; k++) await touch("touchMove", from[0] + ((tx - from[0]) * k) / 16, from[1] + ((ty + 56 - from[1]) * k) / 16, (t += 0.04));
  await p.waitForTimeout(400);
  await frames(p);
  if (process.env.E2E_DEBUG) {
    await pic(`held-${Math.round(at.x)}`);
    console.log("held:", JSON.stringify(await p.evaluate(() => ({ drag: window.woodrail.interaction.dragKind ?? null, toast: [...document.querySelectorAll(".toast")].map((e) => e.textContent) }))));
  }
  await touch("touchEnd", 0, 0, (t += 0.05));
  await p.waitForTimeout(600);
  await frames(p);
  return true;
};
const turbines = () => p.evaluate(() => [...window.woodrail.world.props.all()].filter((x) => x.asset === "mech-radio-mast").map((x) => ({ x: x.x, z: x.z, y: x.y })));
const inBox = () => p.evaluate(() => document.querySelector(".tray-item[data-key='prop:mech-radio-mast'] .have")?.textContent ?? null);

await p.goto(url);
await openMode(p, "game");

// 1. Setup.
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const t of ["electricity", "radio", "passengers"]) w.learn(t);
  w.progress().add("prop:mech-radio-mast", 1);
  w.hud.refreshTrayBadges();
  w.hud.trayLearned();
  const i = w.interaction;
  const c = w.world.landscape.towns[0].centre;
  for (let ring = 6; ring < 30; ring++)
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      const pose = { x: Math.round((c.x + Math.cos(a) * ring * 150) / 18) * 18, z: Math.round((c.z + Math.sin(a) * ring * 150) / 18) * 18, heading: 0 };
      if (i.placement("depot-power", false, pose, 0, -1).reason) continue;
      const id = w.editor().place("depot-power", pose, 0, false);
      await new Promise((r) => setTimeout(r, 300));
      const d = w.economy.depotAtPiece(id);
      if (!d) return { error: "no depot for the power station" };
      d.piles[(await import("/src/economy/cargo.ts")).CARGO.coal.index] = 6;
      return { power: d.id };
    }
  return { error: "no room for a power station" };
});
check("1. setup: Radio mast learned, one in the toy box, a power station with coal", setup.power !== undefined, JSON.stringify(setup));
await p.evaluate(() => [...document.querySelectorAll(".tabs button")].find((e) => e.textContent.trim().startsWith("Industries"))?.click());
await p.waitForTimeout(600);

// 2. Dragged into the first town.
const spot = await p.evaluate(async () => {
  const w = window.woodrail;
  const { checkProp, TrackIndex } = await import("/src/props/placement.ts");
  await w.propLibrary.load("mech-radio-mast");
  const fp = w.propLibrary.footprint("mech-radio-mast");
  const g = w.world.landscape.grid;
  const ctx = { land: w.world.landscape, track: new TrackIndex(w.layout), props: w.world.props, footprint: (a) => w.propLibrary.footprint(a) };
  const c = w.world.landscape.towns[0].centre;
  let best = null;
  let bestD = Infinity;
  g.forEachCell((i, col, row) => {
    const at = { x: g.centreX(col), z: g.centreZ(row) };
    const d = Math.hypot(at.x - c.x, at.z - c.z);
    if (d > 500 || d >= bestD) return;
    const r = checkProp(ctx, fp, { ...at, heading: 0 }, "land");
    if (r.kind === "clear") {
      bestD = d;
      best = { ...at, y: r.y };
    }
  });
  return best;
});
check("found clear ground in the first town", !!spot, JSON.stringify(spot));
if (spot && setup.power !== undefined) {
  await glideTo(p, spot, 900);
  await dragTurbine(spot);
  const masts = await p.evaluate(() => [...window.woodrail.world.props.all()].filter((x) => x.asset === "mech-radio-mast").length);
  check("2. the mast, dragged from the tray, stands in the town", masts === 1, String(masts));
  // (The sparks are counted once a second.)
  await p.waitForTimeout(1500);
  const card = async () => {
    await p.evaluate(() => {
      const w = window.woodrail;
      const m = [...w.world.props.all()].find((x) => x.asset === "mech-radio-mast");
      w.interaction.selectProp?.(m.id);
    });
    await p.waitForTimeout(400);
    return p.evaluate(() => [...document.querySelectorAll(".piece-card")].filter((e) => !e.hidden).map((e) => e.textContent).join(" "));
  };
  const said = await card();
  check("…its card: the town hears about the trains, 1.5× the riders", /hears about the trains: 1.5× the riders/.test(said), said);
  await pic("1-radio-mast");

  // 3. The payoff: people come 1.5× as often as to a town of the same size without one.
  const counts = await p.evaluate(async () => {
    const w = window.woodrail;
    const [a, b] = w.world.landscape.towns;
    const sa = w.economy.depotAtPiece(w.world.stations.get(a.id));
    const sb = w.economy.depotAtPiece(w.world.stations.get(b.id));
    const n = { a: 0, b: 0 };
    sa.waiting = 0;
    sb.waiting = 0;
    const t0 = w.simSeconds;
    await new Promise((resolve) => {
      const timer = setInterval(() => {
        n.a += sa.waiting;
        n.b += sb.waiting;
        sa.waiting = 0;
        sb.waiting = 0;
        if (n.b >= 6 || performance.now() > start + 240000) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
      const start = performance.now();
    });
    return { ...n, seconds: w.simSeconds - t0 };
  });
  check("3. the payoff: people come to its town's station about 1.5× as often as to the next town's", counts.b >= 4 && counts.a / counts.b >= 1.25, JSON.stringify(counts));

  // 4. No spark (setup: the coal gone): the town doesn't hear it.
  await p.evaluate((id) => {
    const w = window.woodrail;
    w.economy.depot(id).piles.fill(0);
  }, setup.power);
  await p.waitForTimeout(2000);
  const quiet = await card();
  check("4. no spark of power: its card says the town doesn't hear it", /No spark of power/.test(quiet), quiet);
}

await finish();
