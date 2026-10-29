// End-to-end: curved ramps on the player's path (`npm run e2e:ramps`). On a desktop Sandbox (#seed-24), for each curve
// (tight, the curve, wide): a straight, then that curve, then its curved ramp, each taken from the tray and clicked on
// at the free end before it, so each joins; the ramp stands on its own support (no riser put under it). An engine from
// the Trains tab on the straight, started with its card's Go, climbs the ramp to its top end a level up, where it stops
// (as at any open end), on the rails. Starts its own dev server on any free port. Chromium as for e2e:roads.
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
const newest = () => p.evaluate(() => Math.max(...window.woodrail.layout.pieceIds()));
const piecesJoined = (a, bb) =>
  p.evaluate(async ([a, bb]) => {
    const { pieceOfRef } = await import("/src/track/layout.ts");
    return [...window.woodrail.layout.joints()].some((j) => (pieceOfRef(j.a) === a && pieceOfRef(j.b) === bb) || (pieceOfRef(j.a) === bb && pieceOfRef(j.b) === a));
  }, [a, bb]);
const risers = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()].filter((id) => window.woodrail.layout.getPiece(id).type === "riser").length);
/** Carry the tray item, click at the point (the free end shown there), put it away. Returns the new piece's id or null. */
const lay = async (key, at) => {
  const before = await p.evaluate(() => window.woodrail.layout.pieceCount);
  const r = await item(key);
  if (!r) {
    console.log(`(no ${key} in the tray)`);
    return null;
  }
  await p.mouse.click(r[0], r[1]);
  await frames();
  await p.mouse.move(at[0], at[1], { steps: 4 });
  await frames();
  const ghostNow = () => p.evaluate(() => { const m = window.woodrail.interaction.preview; return m ? { visible: m.ghost.visible, snap: m.snap.kind, blocked: m.blocked ?? null, hint: m.hint ?? null } : null; });
  let seen = await ghostNow();
  // The game says to flip it to fit: as a player would, its ⇋ Flip button, then back over the end.
  if (/Flip it to fit/.test(seen?.hint ?? "")) {
    const flip = await p.evaluate(() => { const e = [...document.querySelectorAll("button")].find((x) => x.offsetParent !== null && /Flip/.test(x.textContent)); if (!e) return null; const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
    if (flip) {
      await p.mouse.click(flip[0], flip[1]);
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
  return after > before ? await newest() : null;
};

/**
 * Places to try each line: where the game's own placement check (`checkPlacement`) clears a straight at `heading`, the
 * curve and its ramp, away from other track (a setup shortcut: where to build, not the building, which goes through
 * the tray). Each with the line's ends, to check they show on screen once the view's there.
 */
const spotsFor = (flat, ramp, heading) =>
  p.evaluate(
    async ([flat, ramp, heading]) => {
      const w = window.woodrail;
      const { checkPlacement } = await import("/src/landscape/clearance.ts");
      const { getPieceDef } = await import("/src/track/pieces.ts");
      const { transformPose } = await import("/src/track/math.ts");
      const land = w.world.landscape;
      const track = [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id).pose);
      const end = (q, t, f = false) => transformPose(q, getPieceDef(t, f).connectors[1].pose, { x: 0, z: 0, heading: 0 });
      const out = [];
      for (let x = -12000; x <= 12000; x += 240)
        for (let z = -12000; z <= 12000; z += 240) {
          const s0 = { x, z, heading };
          const s1 = end(s0, "straight-216");
          const s2 = end(s1, flat);
          const s3 = end(s2, ramp);
          if (![["straight-216", s0], [flat, s1], [ramp, s2]].every(([t, q]) => checkPlacement(land, t, false, q, 0).kind === "clear")) continue;
          // (Turning the other way too: a piece from the tray may come flipped.)
          const m2 = end(s1, flat, true);
          if (![[flat, s1], [ramp, m2]].every(([t, q]) => checkPlacement(land, t, true, q, 0).kind === "clear")) continue;
          if (track.some((q) => [s0, s1, s2, s3].some((e) => Math.hypot(q.x - e.x, q.z - e.z) < 500))) continue;
          out.push({ x, z, mid: { x: (s0.x + s3.x) / 2, z: (s0.z + s3.z) / 2 }, ends: [s0, s1, s2, s3] });
        }
      // Nearest the middle of all the places first (well in from the map's edges).
      const cx = out.reduce((n, q) => n + q.x, 0) / Math.max(1, out.length);
      const cz = out.reduce((n, q) => n + q.z, 0) / Math.max(1, out.length);
      return out.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
    },
    [flat, ramp, heading],
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
const first = open ? await lay("piece:straight-216", open) : null;
const HEADING = first === null ? 0 : await p.evaluate((id) => window.woodrail.layout.getPiece(id).pose.heading, first);
if (first !== null) {
  await p.keyboard.press("Control+z");
  await frames();
}

const CURVES = [
  ["piece:curve-small", "piece:ramp-curve-small", "tight"],
  ["piece:curve-large", "piece:ramp-curve", "curve"],
  ["piece:curve-wide", "piece:ramp-curve-wide", "wide"],
];
for (const [flat, ramp, name] of CURVES) {
  if (process.env.ONLY && process.env.ONLY !== name) continue;
  const T0 = Date.now();
  const SPOTS = await spotsFor(flat.slice(6), ramp.slice(6), HEADING);
  let straight = null;
  let curve = null;
  let up = null;
  let r0 = 0;
  let tried = 0;
  let offView = 0;
  for (const spot of SPOTS) {
    if (up !== null || tried >= 8) break;
    const span = Math.max(...spot.ends.map((e) => Math.hypot(e.x - spot.mid.x, e.z - spot.mid.z))) * 2;
    await glide(spot.mid, Math.max(900, span * 1.8));
    // Only where the whole line shows in the clear (a view near the map's edge can't centre on it).
    const shown = [];
    for (const e of spot.ends) shown.push(await screen(e.x, 0, e.z));
    if (!shown.every(clearOnScreen)) {
      offView++;
      continue;
    }
    tried++;
    await tab("Track");
    r0 = await risers();
    // A straight, its curve, then the curved ramp, each clicked at the free end before it. (A click puts a piece's
    // middle where it's clicked: the straight's, 108 mm along it.)
    const s0 = spot.ends[0];
    straight = await lay("piece:straight-216", await screen(s0.x + 108 * Math.cos(HEADING), 0, s0.z + 108 * Math.sin(HEADING)));
    const sq = straight === null ? null : await p.evaluate((id) => window.woodrail.layout.getPiece(id), straight);
    if (!sq || sq.y !== 0) continue;
    const e1 = await endOf(straight, 1);
    curve = await lay(flat, await screen(e1.x, e1.y, e1.z));
    if (curve === null) continue;
    const e2 = await endOf(curve, 1);
    up = await lay(ramp, await screen(e2.x, e2.y, e2.z));
  }
  if (process.env.DEBUG) console.log(`(${name}: ${SPOTS.length} places, ${offView} not in view, ${tried} tried; ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  const q = up !== null ? await p.evaluate((id) => window.woodrail.layout.getPiece(id), up) : null;
  const top = up !== null ? await endOf(up, 1) : null;
  check(
    `${name}: the curved ramp from the tray joins its curve (on a straight), up a level, on its own support (no riser)`,
    !!q && q.type === ramp.slice(6) && (await piecesJoined(straight, curve)) && (await piecesJoined(curve, up)) && Math.abs(top.y - 48) < 0.5 && (await risers()) === r0,
    `straight ${straight}, curve ${curve}, ramp ${up} (${q?.type}); top at ${top?.y}; risers ${r0} → ${await risers()}`,
  );
  if (!q) continue;

  // An engine on the straight, started from its card.
  await tab("Trains");
  const eng = await item("train:Engine");
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
  // Its card: a click on it, then Go (if it isn't running already).
  await p.mouse.click(onLine[0], onLine[1]);
  await frames();
  // As a finger would: once Go has been drawn and has stood in place longer than the card tap guard's window
  // (`CARD_MOVED_MS`). Shown in the DOM isn't drawn: under SwiftShader the next frame may be seconds away, and a click
  // sent before it lands just after the frame that first lays Go out, which the guard rightly drops (#19).
  await frames();
  await p.waitForTimeout(250);
  // (The engine card's Go: `button.go`, showing.)
  const go = await p.evaluate(() => { const e = [...document.querySelectorAll("button.go")].find((x) => x.offsetParent !== null && x.textContent.trim() === "Go"); if (!e) return null; const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
  if (go) await p.mouse.click(go[0], go[1]);
  // Watch it: up the ramp to its top end, a level up, on the rails. (At the open end it stops, as on any line's end.)
  const ride = await p.evaluate(
    ({ train, up, ids }) =>
      new Promise((resolve) => {
        const w = window.woodrail;
        const poses = () => ids.map((id) => { const q = w.layout.getPiece(id); return q ? `${q.pose.x.toFixed(1)},${q.pose.z.toFixed(1)},${q.y}${w.layout.isLifted(id) ? " lifted" : ""}` : "gone"; }).join(" / ");
        const before = poses();
        let topS = 0;
        let topY = -Infinity;
        const t0 = performance.now();
        const sim0 = w.simSeconds;
        const step = () => {
          const t = w.sim.getTrain(train);
          if (!t || t.derailed) return resolve({ derailed: true, topS, topY, before, after: poses() });
          for (const bg of t.bogies) if (bg.pieceId === up) topS = Math.max(topS, bg.reversed ? 0 : bg.s);
          for (const c of t.world ?? []) if (typeof c?.y === "number") topY = Math.max(topY, c.y);
          // At the top: turned at the ramp's open end (the payoff). Else, out of time: by the game's own clock (a
          // slow machine runs it slowly), with a long wall-clock bound too.
          const atTop = t.lastTurn?.cause === "open-end" && t.lastTurn.pieceId === up;
          if (atTop || w.simSeconds - sim0 > 300 || performance.now() - t0 > 1200000) {
            // (Standing at the top a while: it stays on.)
            return setTimeout(() => resolve({ derailed: !!w.sim.getTrain(train)?.derailed, topS: Math.max(topS, ...t.bogies.filter((bg) => bg.pieceId === up && !bg.reversed).map((bg) => bg.s)), topY: Math.max(topY, ...t.world.map((c) => c.y)), speed: t.speed, lastTurn: t.lastTurn, simSeconds: Math.round(w.simSeconds - sim0), bogies: t.bogies.map((bg) => `${bg.pieceId}${bg.reversed ? "r" : ""}@${bg.s.toFixed(0)}`).join(","), before, after: poses() }), 30000);
          }
          requestAnimationFrame(step);
        };
        step();
      }),
    { train, up, ids: [straight, curve, up] },
  );
  const len = await p.evaluate(async (type) => { const { getPieceDef, pathLength } = await import("/src/track/index.ts"); return pathLength(getPieceDef(type, false).paths[0].geom); }, ramp.slice(6));
  check(
    `${name}: an engine started on the straight (its card's Go) climbs the curved ramp to its top end, a level up, on the rails`,
    !ride.derailed && ride.topS > len - 3 && ride.topY > 40 && ride.lastTurn?.cause === "open-end" && ride.lastTurn.pieceId === up,
    `${JSON.stringify(ride)}; ramp ${len.toFixed(0)} mm; Go ${go ? "pressed" : "not shown"}`,
  );
  // (It stands at the top of its own line, out of the next one's way.)
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
