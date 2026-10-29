// End-to-end: curved ramps on the player's path (`npm run e2e:ramps`). On a desktop Sandbox (#seed-24), three lines, each
// piece taken from the tray and clicked on at the free end before it, so each joins:
// - the S: a straight, the tight curve, its curved ramp flipped the other way (Flip), and a tight curve on top (QA: once
//   "Another piece is in the way");
// - the spiral: a straight, the curve, its curved ramp, the curve on top, and another curved ramp: two levels up, each
//   ramp turning on as the curve before it does, with no Flip (QA: it came unflipped, an S-bend);
// - the wide: a straight, the wide curve flipped (Flip), and its curved ramp, which turns on that way too.
// A ramp from the ground stands on its own support (no riser put under it). On each, an engine from the Trains tab on
// the straight, started with its card's Go, climbs to the top and runs on to the line's end there, where it stops, on
// the rails. Starts its own dev server on any free port. Chromium as for e2e:roads.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
await server.warmupRequest("/src/main.ts");
// (Seed 24: room on open ground for a wide curve and its ramp, either way round.)
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-24`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(String(e)));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await p.goto(URL);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 120000 });

const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const tab = async (label) => {
  await p.evaluate((label) => [...document.querySelectorAll(".tray .tabs .tab")].find((t) => t.textContent.trim() === label).click(), label);
  await frames();
};
const pressAt = async (sel, k = 0) => {
  const r = await p.evaluate(([sel, k]) => { const e = document.querySelectorAll(sel)[k]; if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, [sel, k]);
  if (r) await p.mouse.click(r[0], r[1]);
  await frames();
  return !!r;
};
/** A tray item by its exact key, among the favourites or on a shelf (opened for it, as a player would). */
const item = async (key) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, key);
  for (let k = 0; k < 16; k++) {
    const r = await find();
    if (r) return r;
    if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) await pressAt(".scroller .tray-back");
    if (!(await pressAt(".scroller .tray-group", k))) return null;
  }
  return null;
};
/** Where on screen a world point is. */
const screen = (x, y, z) =>
  p.evaluate(([x, y, z]) => {
    const w = window.woodrail;
    const v = new w.camera.position.constructor(x, y, z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, [x, y, z]);
/** A piece's free end `c` in the world, a little back along the piece (so the click is on the end, not past it). */
const endOf = (id, c) =>
  p.evaluate(async ([id, c]) => {
    const w = window.woodrail;
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const q = w.layout.getPiece(id);
    const k = getPieceDef(q.type, q.flipped).connectors[c];
    const at = transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 });
    return { x: at.x - 12 * Math.cos(at.heading), z: at.z - 12 * Math.sin(at.heading), y: q.y + k.y };
  }, [id, c]);
const piecesJoined = (a, bb) =>
  p.evaluate(async ([a, bb]) => {
    const { pieceOfRef } = await import("/src/track/layout.ts");
    return [...window.woodrail.layout.joints()].some((j) => (pieceOfRef(j.a) === a && pieceOfRef(j.b) === bb) || (pieceOfRef(j.a) === bb && pieceOfRef(j.b) === a));
  }, [a, bb]);
const risers = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()].filter((id) => window.woodrail.layout.getPiece(id).type === "riser").length);
/** The flip button showing (the HUD's ⇋ Flip). */
const flipButton = () => p.evaluate(() => { const e = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && /Flip/.test(x.textContent)); if (!e) return null; const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
const ghostNow = () => p.evaluate(() => { const m = window.woodrail.interaction.preview; return m ? { visible: m.ghost.visible, snap: m.snap.kind, blocked: m.blocked ?? null, hint: m.hint ?? null, flipped: m.flipped } : null; });
/**
 * Carry the tray item, click at the point (the free end shown there), put it away. `flip`: the way it should go
 * (mirrored or not: Flip pressed while held if it isn't), "none" to leave it as the game turns it (never Flip), or
 * undefined to take it as it comes (Flip only if the game says to flip it to fit). Returns the new piece's id or null, and how it came over the end before any Flip.
 */
const lay = async (key, at, flip) => {
  const before = await p.evaluate(() => window.woodrail.layout.pieceCount);
  const r = await item(key);
  if (!r) {
    console.log(`(no ${key} in the tray)`);
    return { id: null, came: null };
  }
  await p.mouse.click(r[0], r[1]);
  await frames();
  await p.mouse.move(at[0], at[1], { steps: 4 });
  await frames();
  let seen = await ghostNow();
  const came = seen?.flipped ?? null;
  // Flipped as wanted, or as the game says it fits: its ⇋ Flip button, as a player would, then back over the end.
  if ((typeof flip === "boolean" && seen && seen.flipped !== flip) || (flip === undefined && /Flip it to fit/.test(seen?.hint ?? ""))) {
    const b = await flipButton();
    if (b) {
      await p.mouse.click(b[0], b[1]);
      await frames();
      await p.mouse.move(at[0] + 3, at[1] + 3, { steps: 3 });
      await p.mouse.move(at[0], at[1], { steps: 2 });
      await frames();
      seen = await ghostNow();
    }
  }
  await p.mouse.click(at[0], at[1]);
  await frames();
  await p.keyboard.press("Escape");
  const after = await p.evaluate(() => window.woodrail.layout.pieceCount);
  if (after <= before) console.log(`(${new Date().toISOString().slice(11, 19)} ${key} at ${at.map(Math.round)}: ghost ${JSON.stringify(seen)}; said ${await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "))})`);
  // (The newest track piece: risers put under it come with it.)
  const id = after > before ? await p.evaluate(() => Math.max(...[...window.woodrail.layout.pieceIds()].filter((i) => window.woodrail.layout.getPiece(i).type !== "riser"))) : null;
  return { id, came };
};

/**
 * The lines. Each step: a tray piece, and the way it goes: as the piece before it ("same") or the other way
 * ("other"), by Flip if need be; or "auto": not touched, the game turning it on as the curve it meets.
 */
const LANES = [
  // (The widest first, while the map has the most room.)
  { name: "the wide", steps: [["straight-216"], ["curve-wide", true], ["ramp-curve-wide", "auto"]] },
  { name: "the S", steps: [["straight-216"], ["curve-small", false], ["ramp-curve-small", "other"], ["curve-small"]] },
  // (Two straights first: with one, the line's start is under its top on screen, and a click there can take it.)
  { name: "the spiral", steps: [["straight-216"], ["straight-216"], ["curve-large", false], ["ramp-curve", "auto"], ["curve-large", "same"], ["ramp-curve", "auto"]] },
];

/**
 * Places to try a line: where the game's own placement check (`checkPlacement`) clears each of its pieces, the way
 * it's meant to go or all mirrored (the game may say to flip one), at `heading`, away from other track (a setup
 * shortcut: where to build, not the building, which goes through the tray). Each with the line's ends, to check they
 * show on screen once the view's there.
 */
const spotsFor = (steps, heading) =>
  p.evaluate(
    async ([steps, heading]) => {
      const w = window.woodrail;
      const { checkPlacement } = await import("/src/landscape/clearance.ts");
      const { getPieceDef } = await import("/src/track/pieces.ts");
      const { transformPose } = await import("/src/track/math.ts");
      const { Layout, findOverlap, findLowCrossing } = await import("/src/track/index.ts");
      const land = w.world.landscape;
      const track = [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id).pose);
      const chain = (start, mirror) => {
        let at = start;
        let y = 0;
        let prev = false;
        const ends = [start];
        // (The line so far, to check each piece clears it and the track already there, with headroom over it.)
        const line = new Layout();
        for (const [type, how] of steps) {
          const f = (how === "other" ? !prev : how === "same" || how === "auto" ? prev : how === true) !== mirror;
          if (checkPlacement(land, type, f, at, y).kind !== "clear") return null;
          const before = line.pieceCount > 0 ? Math.max(...line.pieceIds()) : -1;
          for (const lay of [line, w.layout]) if (findOverlap(lay, type, f, at, y, before) !== -1 || findLowCrossing(lay, type, f, at, y, before) !== -1) return null;
          line.addPiece(type, at, y, f);
          const k = getPieceDef(type, f).connectors[1];
          at = transformPose(at, k.pose, { x: 0, z: 0, heading: 0 });
          y += k.y;
          prev = f !== mirror;
          ends.push(at);
        }
        return ends;
      };
      const out = [];
      for (let x = -12000; x <= 12000; x += 240)
        for (let z = -12000; z <= 12000; z += 240) {
          const start = { x, z, heading };
          const ends = chain(start, false);
          if (!ends || !chain(start, true)) continue;
          // (With room to spare: a piece goes down on the fine grid, a few mm from where it's clicked.)
          if (![[24, 0], [-24, 0], [0, 24], [0, -24]].every(([dx, dz]) => chain({ x: x + dx, z: z + dz, heading }, false) && chain({ x: x + dx, z: z + dz, heading }, true))) continue;
          if (track.some((q) => ends.some((e) => Math.hypot(q.x - e.x, q.z - e.z) < 500))) continue;
          const mx = ends.reduce((n, e) => n + e.x, 0) / ends.length;
          const mz = ends.reduce((n, e) => n + e.z, 0) / ends.length;
          out.push({ x, z, mid: { x: mx, z: mz }, ends });
        }
      // Nearest the middle of all the places first (well in from the map's edges).
      const cx = out.reduce((n, q) => n + q.x, 0) / Math.max(1, out.length);
      const cz = out.reduce((n, q) => n + q.z, 0) / Math.max(1, out.length);
      return out.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
    },
    [steps, heading],
  );
/** The view onto `at`, framing `span` mm. */
const glide = async (at, span) => {
  await p.evaluate(async ([at, span]) => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    w.director.glideTo(new w.camera.position.constructor(at.x, 0, at.z), frameDistance(span, w.camera.fov, w.camera.aspect), { duration: 0.2 });
  }, [at, span]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
};
/** Is this screen point in the clear part of the view (not under the top bar, the tray, or off the edge)? */
const clearOnScreen = ([x, y]) => x > 60 && x < 1220 && y > 110 && y < 580;
const pieceOf = (id) => p.evaluate((id) => window.woodrail.layout.getPiece(id), id);

// The heading a straight from the tray goes down at (the view's): one put down on open ground, then undone (Ctrl+Z).
await tab("Track");
const open = await p.evaluate(() => {
  const w = window.woodrail;
  for (let fy = 0.3; fy <= 0.5; fy += 0.05) for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
    const x = Math.round(innerWidth * fx);
    const y = Math.round(innerHeight * fy);
    if (document.elementFromPoint(x, y) === w.canvas && !w.interaction.pick(x, y) && w.interaction.groundAt(x, y)) return [x, y];
  }
  return null;
});
const first = open ? (await lay("piece:straight-216", open)).id : null;
const HEADING = first === null ? 0 : await p.evaluate((id) => window.woodrail.layout.getPiece(id).pose.heading, first);
if (first !== null) {
  await p.keyboard.press("Control+z");
  await frames();
}

for (const { name, steps } of LANES) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) continue;
  const T0 = Date.now();
  const SPOTS = await spotsFor(steps, HEADING);
  let ids = [];
  let came = [];
  let r0 = 0;
  let rRamp = null;
  let tried = 0;
  for (const spot of SPOTS) {
    if (ids.length === steps.length || tried >= 8) break;
    const span = Math.max(...spot.ends.map((e) => Math.hypot(e.x - spot.mid.x, e.z - spot.mid.z))) * 2;
    await glide(spot.mid, Math.max(900, span * 1.8));
    // Only where the whole line shows in the clear (a view near the map's edge can't centre on it).
    const shown = [];
    for (const e of spot.ends) shown.push(await screen(e.x, 0, e.z));
    if (!shown.every(clearOnScreen)) continue;
    tried++;
    await tab("Track");
    r0 = await risers();
    ids = [];
    came = [];
    // (A click puts a piece's middle where it's clicked: the straight's, 108 mm along it. Then each at the free end.)
    const s0 = spot.ends[0];
    let at = await screen(s0.x + 108 * Math.cos(HEADING), 0, s0.z + 108 * Math.sin(HEADING));
    rRamp = null;
    for (const [type, how] of steps) {
      const prev = ids.length > 0 ? (await pieceOf(ids.at(-1))).flipped : false;
      const want = how === "other" ? !prev : how === "same" ? prev : typeof how === "boolean" ? how : how === "auto" ? "none" : undefined;
      const r = await lay(`piece:${type}`, at, want);
      if (r.id === null) break;
      ids.push(r.id);
      came.push(r.came);
      if (rRamp === null && type.startsWith("ramp")) rRamp = await risers();
      if (process.env.DEBUG) console.log(`(${type}: wanted ${want}, came ${r.came}, went ${(await pieceOf(r.id)).flipped})`);
      const e = await endOf(r.id, 1);
      at = await screen(e.x, e.y, e.z);
    }
    if (ids.length === 1 && (await pieceOf(ids[0])).y !== 0) ids = [];
  }
  if (process.env.DEBUG) console.log(`(${name}: ${SPOTS.length} places, ${tried} tried; ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  const pieces = [];
  for (const id of ids) pieces.push(await pieceOf(id));
  let joined = ids.length === steps.length;
  for (let i = 1; i < ids.length && joined; i++) joined = await piecesJoined(ids[i - 1], ids[i]);
  const top = joined ? await endOf(ids.at(-1), 1) : null;
  const levels = steps.filter(([t]) => t.startsWith("ramp")).length;
  const say = `${pieces.map((q) => `${q.type}${q.flipped ? "'" : ""}@${q.y}`).join(" → ")}; top at ${top?.y}; risers ${r0} → ${await risers()}`;
  check(`${name}: laid from the tray, each piece joined to the one before, up ${levels} level${levels > 1 ? "s" : ""}`, joined && Math.abs(top.y - 48 * levels) < 0.5, say);
  if (!joined) continue;
  // The first ramp, from the ground: on its own support.
  const firstRamp = steps.findIndex(([t]) => t.startsWith("ramp"));
  if (name === "the wide" || name === "the S") check(`${name}: the curved ramp stands on its own support (no riser put under it)`, rRamp === r0, `${say}; risers by the ramp ${r0} → ${rRamp}`);
  // Each curved ramp left to itself came turning on as the curve before it (a spiral, not an S-bend).
  const autos = steps.map(([, how], i) => (how === "auto" ? i : -1)).filter((i) => i >= 0);
  if (autos.length > 0) check(`${name}: each curved ramp after a curve came turning on the same way, with no Flip (QA: an S-bend)`, autos.every((i) => came[i] === pieces[i - 1].flipped && pieces[i].flipped === pieces[i - 1].flipped), `${say}; came ${JSON.stringify(came)}`);
  if (name === "the S") check("the S: the ramp flipped the other way (an S-bend), and a tight curve goes on its top (QA: “Another piece is in the way”)", pieces[firstRamp].flipped !== pieces[firstRamp - 1].flipped && pieces.at(-1).y === 48, say);

  // An engine on the straight, started from its card.
  await tab("Trains");
  const eng = await item("train:Engine");
  const straight = ids[0];
  const last = ids.at(-1);
  const mid = await p.evaluate((id) => { const q = window.woodrail.layout.getPiece(id); return { x: q.pose.x + 108 * Math.cos(q.pose.heading), z: q.pose.z + 108 * Math.sin(q.pose.heading), y: q.y }; }, straight);
  const onLine = await screen(mid.x, mid.y + 10, mid.z);
  const n0 = await p.evaluate(() => window.woodrail.sim.trainIds().length);
  if (eng) {
    await p.mouse.click(eng[0], eng[1]);
    await p.mouse.move(onLine[0], onLine[1], { steps: 4 });
    await p.mouse.click(onLine[0], onLine[1]);
    await frames();
    await p.keyboard.press("Escape");
  }
  const train = await p.evaluate((n0) => (window.woodrail.sim.trainIds().length > n0 ? window.woodrail.sim.trainIds().at(-1) : null), n0);
  if (train === null) {
    check(`${name}: an engine goes on the line`, false, `trains ${n0}; at ${onLine}`);
    continue;
  }
  // Its card: a click on it, then Go. (The engine card's Go: `button.go`, showing.)
  await p.mouse.click(onLine[0], onLine[1]);
  await frames();
  const go = await p.evaluate(() => { const e = [...document.querySelectorAll("button.go")].find((x) => x.offsetParent !== null && x.textContent.trim() === "Go"); if (!e) return null; const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
  if (go) await p.mouse.click(go[0], go[1]);
  // Watch it up to the top and on to the line's end there, where it stops (as at any open end), on the rails.
  const ride = await p.evaluate(
    ({ train, last }) =>
      new Promise((resolve) => {
        const w = window.woodrail;
        let topY = -Infinity;
        const t0 = performance.now();
        let still = t0;
        const step = () => {
          const t = w.sim.getTrain(train);
          if (!t || t.derailed) return resolve({ derailed: true, topY });
          for (const c of t.world ?? []) if (typeof c?.y === "number") topY = Math.max(topY, c.y);
          // Stopped on the last piece (for 3 s: not a moment's pause on the way).
          const stopped = t.speed === 0 && t.bogies.some((bg) => bg.pieceId === last);
          if (!stopped) still = performance.now();
          if ((stopped && performance.now() - still > 3000) || performance.now() - t0 > 900000) {
            // (Standing at the top a while: it stays on.)
            return setTimeout(() => resolve({ derailed: !!w.sim.getTrain(train)?.derailed, topY: Math.max(topY, ...t.world.map((c) => c.y)), speed: t.speed, lastTurn: t.lastTurn, bogies: t.bogies.map((bg) => `${bg.pieceId}${bg.reversed ? "r" : ""}@${bg.s.toFixed(0)}`).join(",") }), 30000);
          }
          requestAnimationFrame(step);
        };
        step();
      }),
    { train, last },
  );
  check(
    `${name}: an engine started on the straight (its card's Go) climbs to the top, ${48 * levels} mm up, and runs on to the line's end there, on the rails`,
    !ride.derailed && ride.topY > 48 * levels - 2 && ride.lastTurn?.cause === "open-end" && ride.lastTurn.pieceId === last,
    `${JSON.stringify(ride)}; last piece ${last}; Go ${go ? "pressed" : "not shown"}`,
  );
  // (It stands at the end of its own line, out of the next one's way.)
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
