// End-to-end: a bridge one level up over a line, on a 390×844 phone, Sandbox. The player drags a Bridge (or a Curved
// bridge) from the tray onto the top of a ramp whose next piece crosses a line on the ground; the straights under it
// make way for an underpass (one undo step, a toast), the bridge is drawn as a girder span, and a train with the
// tallest cars runs along the line under it, down into the dip and out again. Cases: square on, at 45°, a curved
// bridge over the line under its middle; refused for a curved bridge crossing near its end, over a curve and over
// points, with a train or a signal on the straights, saying why. A Long straight laid on under a bridge already
// standing digs one too, and so does Draw, across a line from a ramp's top.
//
// Harness shortcuts (named, setup only): the ground line, the ramp (and in case 8 the standing bridge) are put down by
// the editor (laying them is not what's tested); trains are put down by the sim and run by `sim.setLever` and the
// sim's own ticks; the signal in case 7 is put down by the editor.
//
// Usage: node tools/e2e/low-bridge.mjs [<out dir>]   (default out: e2e-out/low-bridge; pictures there too)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/low-bridge";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5381, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await p.goto(`${PAGE}/#seed-24`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
// What the game says: toasts and refusals.
await p.evaluate(() => {
  const h = window.woodrail.hud;
  window.__said = [];
  for (const k of ["toast", "refuse", "setRefusal"]) {
    const f = h[k].bind(h);
    h[k] = (m, ...a) => (m && window.__said.push(m), f(m, ...a));
  }
});
const said = () => p.evaluate(() => window.__said.splice(0));

const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const pressAt = async (sel, k = 0) => {
  const r = await p.evaluate(([sel, k]) => { const e = document.querySelectorAll(sel)[k]; if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, [sel, k]);
  if (r) await p.mouse.click(r[0], r[1]);
  await frames();
  return !!r;
};
/** A tray item by its key, opening shelves for it as a player would. */
const item = async (key) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, key);
  for (let k = 0; k < 20; k++) {
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
/** The camera looking at (x, z) from a direction, `dist` away. */
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
const snap = async (name) => {
  await settle();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/${name}`, type: "jpeg", quality: 82, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
};

/**
 * A place for a case: where the game's own track rules clear the ground line and the ramp (a setup shortcut: where
 * to build). `lower`: the ground line's pieces relative to (X, Z); `ramp`: the ramp's pose relative to (X, Z).
 */
const build = (lower, ramp, extra = [], clear = []) =>
  p.evaluate(
    async ([lower, ramp, extra, clear]) => {
      const w = window.woodrail;
      const { trackBlock } = await import("/src/game/track-rules.ts");
      const rules = w.interaction.rules;
      const at = (q, X, Z) => ({ ...q, pose: { x: X + q.pose.x, z: Z + q.pose.z, heading: q.pose.heading }, y: q.y ?? 0, flipped: q.flipped ?? false });
      const t = w.controls.target;
      for (let d = 0; d < 8000; d += 72) {
        for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
          const X = Math.round((t.x + d * Math.cos(a)) / 18) * 18;
          const Z = Math.round((t.z + d * Math.sin(a)) / 18) * 18;
          const all = [...lower.map((q) => at(q, X, Z)), at(ramp, X, Z)];
          if (all.some((q) => trackBlock(rules, q.type, q.flipped, q.pose, q.y, -1) !== null)) continue;
          // (And where pieces the case expects to go down will go: clear too, for now.)
          if (clear.some((q) => trackBlock(rules, q.type, false, at(q, X, Z).pose, 0, -1) !== null)) continue;
          // (Room round it too: nothing within 300 mm of the line's middle a level up, so the bridge has the sky.)
          if (trackBlock(rules, "straight-216", false, { x: X - 108, z: Z + 300, heading: 0 }, 0, -1) !== null) continue;
          const lo = w.editor().placeRun(all.slice(0, -1));
          const r = w.editor().place(ramp.type, at(ramp, X, Z).pose, 0, ramp.flipped ?? false);
          const more = extra.map((q) => w.editor().place(q.type, at(q, X, Z).pose, q.y ?? 0, q.flipped ?? false));
          return { X, Z, lo, ramp: r, more };
        }
      }
      return null;
    },
    [lower, ramp, extra, clear],
  );

/** The ramp's top end, in the world. */
const rampTop = (id) =>
  p.evaluate(async (id) => {
    const w = window.woodrail;
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const q = w.layout.getPiece(id);
    const k = getPieceDef(q.type, q.flipped).connectors[1];
    const e = transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 });
    return { x: e.x, z: e.z, y: q.y + k.y, heading: e.heading };
  }, id);

/** Carry a tray piece, put it down at a screen point (the ramp's top end), as a player taps. The new piece's id, or null. */
const lay = async (key, at) => {
  const before = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
  const r = await item(key);
  if (!r) return { id: null, why: `no ${key} in the tray` };
  await p.mouse.click(r[0], r[1]);
  await frames();
  await p.mouse.move(at[0], at[1], { steps: 5 });
  await frames();
  const ghost = await p.evaluate(() => { const m = window.woodrail.interaction.preview; return m ? { snap: m.snap.kind, y: m.snap.y, blocked: m.blocked ?? null, hint: m.hint ?? null } : null; });
  await p.mouse.click(at[0], at[1]);
  await frames();
  await p.keyboard.press("Escape");
  await frames();
  const id = await p.evaluate(([key, before]) => {
    const w = window.woodrail;
    const type = key.replace(/^piece:/, "");
    return [...w.layout.pieceIds()].find((i) => !before.includes(i) && w.layout.getPiece(i).type === type) ?? null;
  }, [key, before]);
  return { id, ghost };
};

/** The layout's underpasses, the bridge's look (its arch floors: [-1] is a girder span), and the line's pieces. */
const state = (bridge) =>
  p.evaluate((bridge) => {
    const w = window.woodrail;
    const pieces = [...w.layout.pieceIds()].map((i) => ({ id: i, ...w.layout.getPiece(i) }));
    const piece = bridge !== null ? w.layout.getPiece(bridge) : null;
    return {
      underpasses: pieces.filter((q) => q.type === "underpass").map((q) => q.id),
      girder: piece ? JSON.stringify(w.archFloorsOf(piece)) === "[-1]" : null,
      bridgeY: piece?.y ?? null,
      count: pieces.length,
      types: pieces.map((q) => q.type).sort().join(","),
    };
  }, bridge);

/** The line along x from (X, Z): pieces relative to it. */
const LINE = [0, 216, 432, 648, 864].map((x) => ({ type: "straight-216", pose: { x, z: 0, heading: 0 } }));

/**
 * One case: the line, a ramp up to where the bridge goes, the bridge from the tray onto the ramp's top. `ramp` is the
 * ramp's pose relative to the line's start; the crossing is near (X + 540, Z).
 */
async function crossing(name, key, lower, ramp, before = async () => {}) {
  const at = await build(lower, ramp);
  if (!at) {
    check(`${name}: room for it`, false, "no open ground");
    return null;
  }
  const top = await rampTop(at.ramp);
  await look(at.X + 540, at.Z, [0.15, 1, 0.55], 900);
  await settle();
  await before(at);
  const was = await state(null);
  await said();
  const where = await screen(top.x - 6 * Math.cos(top.heading), top.y, top.z - 6 * Math.sin(top.heading));
  const t0 = Date.now();
  const r = await lay(key, where);
  const msgs = await said();
  const after = await state(r.id);
  return { at, top, before: was, after, r, msgs, ms: Date.now() - t0 };
}

// 1. Square on: a Bridge onto a ramp up across the line.
{
  const c = await crossing("square on", "piece:bridge", LINE, { type: "ramp", pose: { x: 540, z: -252, heading: Math.PI / 2 } });
  if (c) {
    check("square on: the bridge goes down one level up", c.r.id !== null && c.after.bridgeY === 48, JSON.stringify({ id: c.r.id, ghost: c.r.ghost, msgs: c.msgs }));
    check("square on: an underpass is dug under it", c.after.underpasses.length === c.before.underpasses.length + 1, JSON.stringify(c.after.underpasses));
    check("square on: the toast says so", c.msgs.includes("Dug an underpass so trains fit under"), JSON.stringify(c.msgs));
    check("square on: the bridge is drawn as a girder span", c.after.girder === true);
    // The line is whole: the train runs from its start to past the bridge (the payoff), down into the dip.
    const run = await p.evaluate(
      async ([lo0, cx]) => {
        const w = window.woodrail;
        const { createSnapshot } = await import("/src/sim/sim.ts");
        // (Harness shortcut: the train put down and started by the sim, not from the tray: the crossing is the test.)
        const t = w.sim.addTrainAround(["engine", "passenger", "passenger", "caboose"], { pieceId: lo0, pathIndex: 0, s: 108, reversed: false });
        if (t.kind !== "placed") return { placed: t.kind };
        const ids = w.sim.getTrain(t.trainId).cars.map((c) => c.id);
        w.sim.setLook(ids[0], "electric");
        w.sim.setLook(ids[1], "double-decker");
        w.sim.setLook(ids[2], "double-decker");
        w.sim.setLever(ids[0], 1);
        const snap = createSnapshot();
        const low = {};
        let front = -Infinity;
        for (let k = 0; k < 4000; k++) {
          w.sim.tick();
          w.sim.writeSnapshot(snap);
          for (let c = 0; c < snap.count; c++) {
            const x = snap.transforms[c * 6];
            const y = snap.transforms[c * 6 + 1];
            if (Math.abs(x - cx) < 20) low[snap.ids[c]] = Math.min(low[snap.ids[c]] ?? Infinity, y);
            if (snap.ids[c] === ids[0]) front = Math.max(front, x);
          }
          if (Object.keys(low).length === ids.length && front > cx + 400) break;
        }
        w.sim.setLever(ids[0], 0);
        return { trainId: t.trainId, ids, low, front: Math.round(front - cx) };
      },
      [c.at.lo[0], c.at.X + 540],
    );
    const lows = Object.values(run.low ?? {});
    check(
      "square on: a train with the tallest cars runs under the bridge, every car down in the dip (−30) as it passes",
      lows.length === 4 && lows.every((y) => Math.abs(y + 30) < 0.5) && run.front > 300,
      JSON.stringify(run),
    );
    // A picture with the train under it (put back under the bridge: the run took it on past).
    await p.evaluate(([tid, lo]) => {
      const w = window.woodrail;
      w.sim.removeTrain(tid);
      const t = w.sim.addTrainAround(["engine", "passenger", "passenger", "caboose"], { pieceId: lo, pathIndex: 0, s: 144, reversed: false });
      const ids = w.sim.getTrain(t.trainId).cars.map((c) => c.id);
      w.sim.setLook(ids[0], "electric");
      w.sim.setLook(ids[1], "double-decker");
      w.sim.setLook(ids[2], "double-decker");
      w.invalidate?.();
      window.__photoTrain = t.trainId;
    }, [run.trainId, c.after.underpasses.at(-1)]);
    await look(c.at.X + 540, c.at.Z, [1, 0.55, 0.45], 420, 10);
    await snap("low-bridge-phone-square.jpg");
    await p.evaluate(() => window.woodrail.sim.removeTrain(window.__photoTrain));
    // One undo takes back the bridge and the underpass together; redo puts both back.
    await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.title || x.getAttribute("aria-label") || "").startsWith("Undo"))?.click());
    await frames();
    const undone = await state(null);
    check("square on: one undo takes back the bridge and the underpass (the straights back)", undone.underpasses.length === c.before.underpasses.length && undone.types === c.before.types, `${undone.types} vs ${c.before.types}`);
    await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.title || x.getAttribute("aria-label") || "").startsWith("Redo"))?.click());
    await frames();
    const redone = await state(null);
    check("square on: redo digs it again", redone.underpasses.length === c.after.underpasses.length && redone.count === c.after.count);
    check("square on: the drop took a moment, not a stall", c.ms < 60000, `${c.ms} ms (headless, software GL)`);
  }
}

// 2. At 45°: the ramp and bridge go diagonally across the line.
{
  const d = Math.SQRT1_2;
  const c = await crossing("45°", "piece:bridge", LINE, { type: "ramp", pose: { x: 540 - 252 * d, z: -252 * d, heading: Math.PI / 4 } });
  if (c) {
    check("45°: an underpass is dug under a bridge at 45°", c.r.id !== null && c.after.underpasses.length === c.before.underpasses.length + 1 && c.after.girder === true, JSON.stringify({ id: c.r.id, ghost: c.r.ghost, msgs: c.msgs, girder: c.after.girder }));
    await look(c.at.X + 540, c.at.Z, [0.55, 1.1, 1], 760, 10);
    await snap("low-bridge-phone-45.jpg");
  }
}

// 3. A curved bridge: its curve crosses the line.
{
  // (The line under the middle of its curve: a curved bridge is short, and nearer an end its pier would stand in the
  // trench; that's case 3b.)
  const c = await crossing("curved bridge", "piece:bridge-curve", LINE, { type: "ramp", pose: { x: 500, z: -198, heading: Math.PI / 2 } });
  if (c) {
    check("curved bridge: an underpass is dug under a curved bridge, drawn as a girder span", c.r.id !== null && c.after.underpasses.length === c.before.underpasses.length + 1 && c.after.girder === true, JSON.stringify({ id: c.r.id, ghost: c.r.ghost, msgs: c.msgs, girder: c.after.girder }));
    await look(c.at.X + 540, c.at.Z, [0.5, 1.1, 1], 700, 10);
    await snap("low-bridge-phone-curved.jpg");
  }
}

// 3b. A curved bridge crossing the line near its end: refused, saying why.
{
  const c = await crossing("curved bridge near its end", "piece:bridge-curve", LINE, { type: "ramp", pose: { x: 500, z: -162, heading: Math.PI / 2 } });
  if (c) {
    check("curved bridge near its end: no underpass dug", c.after.underpasses.length === c.before.underpasses.length, JSON.stringify({ id: c.r.id, y: c.after.bridgeY, ghost: c.r.ghost }));
    check("curved bridge near its end: it says to cross nearer the bridge's middle", c.msgs.some((m) => /nearer the bridge's middle/.test(m)), JSON.stringify(c.msgs));
  }
}

// 4. A curve in the line under the bridge: refused, saying why.
{
  const lower = [
    { type: "straight-216", pose: { x: 0, z: 0, heading: 0 } },
    { type: "straight-216", pose: { x: 216, z: 0, heading: 0 } },
    { type: "curve-large", pose: { x: 432, z: 0, heading: 0 } },
  ];
  const c = await crossing("curve under", "piece:bridge", lower, { type: "ramp", pose: { x: 504, z: -252, heading: Math.PI / 2 } });
  if (c) {
    check("curve under: the bridge isn't put down one level up over a curve", c.r.id === null || c.after.bridgeY !== 48, JSON.stringify({ id: c.r.id, y: c.after.bridgeY }));
    check("curve under: no underpass dug", c.after.underpasses.length === c.before.underpasses.length);
    check("curve under: it says the underpass needs straight track", c.msgs.some((m) => /underpass needs straight track/.test(m)), JSON.stringify(c.msgs));
  }
}

// 5. Points under the bridge: refused, saying why.
{
  const lower = [
    { type: "straight-216", pose: { x: 0, z: 0, heading: 0 } },
    { type: "straight-216", pose: { x: 216, z: 0, heading: 0 } },
    { type: "switch", pose: { x: 432, z: 0, heading: 0 } },
    { type: "straight-216", pose: { x: 576, z: 0, heading: 0 } },
  ];
  const c = await crossing("points under", "piece:bridge", lower, { type: "ramp", pose: { x: 504, z: -252, heading: Math.PI / 2 } });
  if (c) {
    check("points under: no underpass dug", c.after.underpasses.length === c.before.underpasses.length);
    check("points under: it says points can't go in an underpass", c.msgs.some((m) => /Points can't go in an underpass/.test(m)), JSON.stringify(c.msgs));
    await look(c.at.X + 500, c.at.Z, [0.2, 1, 0.7], 620, 10);
  }
}

// 6. A train standing on the straights the underpass would take up: refused, saying so; moved off, it digs.
{
  const c = await crossing("train on it", "piece:bridge", LINE, { type: "ramp", pose: { x: 540, z: -252, heading: Math.PI / 2 } }, async (at) => {
    // (Harness shortcut: the train put down by the sim, standing on the middle straight.)
    await p.evaluate((lo) => {
      const w = window.woodrail;
      const t = w.sim.addTrainAround(["engine", "hopper"], { pieceId: lo, pathIndex: 0, s: 108, reversed: false });
      window.__standing = t.kind === "placed" ? t.trainId : null;
    }, at.lo[2]);
  });
  if (c) {
    check("train on it: no underpass dug, no bridge put down over the line", c.after.underpasses.length === c.before.underpasses.length && c.r.id === null, JSON.stringify({ id: c.r.id, ghost: c.r.ghost }));
    check("train on it: it says a train's on the track under the bridge", c.msgs.some((m) => /A train's on the track under the bridge/.test(m)), JSON.stringify(c.msgs));
    await p.evaluate(() => window.woodrail.sim.removeTrain(window.__standing));
    const top = await rampTop(c.at.ramp);
    const r = await lay("piece:bridge", await screen(top.x - 6 * Math.cos(top.heading), top.y, top.z - 6 * Math.sin(top.heading)));
    const after = await state(r.id);
    check("train on it: moved off, the same bridge digs its underpass", r.id !== null && after.underpasses.length === c.before.underpasses.length + 1 && after.girder === true);
  }
}

// 7. A signal on a joint of the straights it would take up: refused, saying to move it.
{
  const c = await crossing("signal on it", "piece:bridge", LINE, { type: "ramp", pose: { x: 540, z: -252, heading: Math.PI / 2 } }, async (at) => {
    // (Harness shortcut: the signal put down by the editor, on the joint between the 2nd and 3rd straights.)
    await p.evaluate(async (lo) => {
      const { connectorRef } = await import("/src/track/layout.ts");
      window.woodrail.editor().addSignal(connectorRef(lo, 0));
    }, at.lo[2]);
  });
  if (c) {
    check("signal on it: no underpass dug", c.after.underpasses.length === c.before.underpasses.length && c.r.id === null, JSON.stringify({ id: c.r.id }));
    check("signal on it: it says to move the signal off", c.msgs.some((m) => /A signal is on the track under the bridge/.test(m)), JSON.stringify(c.msgs));
  }
}

// 8. A bridge already standing one level up; a Long straight laid on from the line's end under it: straights on to
// an underpass under the bridge go down in its place.
{
  const lower = LINE.slice(0, 2);
  const at = await build(lower, { type: "ramp", pose: { x: 576, z: -252, heading: Math.PI / 2 } }, [{ type: "bridge", pose: { x: 576, z: -108, heading: Math.PI / 2 }, y: 48 }], [
    { type: "underpass", pose: { x: 432, z: 0, heading: 0 } },
  ]);
  if (!at) check("straight under a bridge: room for it", false);
  else {
    await look(at.X + 520, at.Z, [0.15, 1, 0.55], 900);
    await settle();
    const was = await state(null);
    await said();
    const r = await lay("piece:straight-216", await screen(at.X + 432 - 4, 0, at.Z));
    const msgs = await said();
    const after = await state(at.more[0]);
    const joined = await p.evaluate(async () => {
      const w = window.woodrail;
      const { connectorRef } = await import("/src/track/layout.ts");
      const u = [...w.layout.pieceIds()].filter((i) => w.layout.getPiece(i).type === "underpass").pop();
      return [0, 1].map((k) => w.layout.joinedConnector(connectorRef(u, k)) !== -1);
    });
    check("straight under a bridge: an underpass goes down under it, on from the line's end", after.underpasses.length === was.underpasses.length + 1 && joined[0], JSON.stringify({ msgs, joined, ghost: r.ghost }));
    check("straight under a bridge: the bridge is now a girder span", after.girder === true);
    check("straight under a bridge: the toast says so", msgs.includes("Dug an underpass under the bridge"), JSON.stringify(msgs));
    await look(at.X + 560, at.Z, [0.7, 0.9, 0.9], 620, 10);
    await snap("low-bridge-phone-laid-under.jpg");
  }
}

// 9. Draw: from a ramp's top end, a stroke on across a line on the ground: the line lays a bridge over it one level
// up and digs an underpass under it (no longer red, "go two levels up").
{
  const at = await build(LINE, { type: "ramp", pose: { x: 540, z: -252, heading: Math.PI / 2 } });
  if (!at) check("draw: room for it", false);
  else {
    const top = await rampTop(at.ramp);
    await look(at.X + 540, at.Z + 60, [0.1, 1, 0.45], 1100);
    await settle();
    const was = await state(null);
    await said();
    await p.evaluate(() => document.querySelector(".tray-draw")?.click());
    await frames();
    const pts = [
      [top.x, top.z - 4, 48],
      [top.x, top.z + 120, 48],
      [top.x, top.z + 300, 48],
      [top.x, top.z + 520, 0],
      [top.x, top.z + 640, 0],
    ];
    const sc = [];
    for (const [x, z, y] of pts) sc.push(await screen(x, y, z));
    await p.mouse.move(sc[0][0], sc[0][1]);
    await p.mouse.down();
    for (let i = 1; i < sc.length; i++) {
      const [ax, ay] = sc[i - 1];
      const [bx, by] = sc[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 12));
      for (let k = 1; k <= n; k++) await p.mouse.move(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    }
    const drawn = await p.evaluate(() => (window.woodrail.interaction.draw.line?.pieces ?? []).map((q) => `${q.type}${q.blocked ? "(red)" : ""}`));
    await p.mouse.up();
    await settle();
    await p.keyboard.press("Escape");
    const msgs = await said();
    const after = await p.evaluate(() => {
      const w = window.woodrail;
      const ps = [...w.layout.pieceIds()].map((i) => ({ id: i, ...w.layout.getPiece(i) }));
      const bridges = ps.filter((q) => q.type === "bridge" && Math.abs(q.y - 48) < 1);
      return { underpasses: ps.filter((q) => q.type === "underpass").length, girders: bridges.filter((q) => JSON.stringify(w.archFloorsOf(q)) === "[-1]").length };
    });
    check("draw: across a line from a ramp's top, a bridge one level up digs an underpass under it", after.underpasses === was.underpasses.length + 1 && after.girders >= 1, JSON.stringify({ drawn, msgs, after }));
    check("draw: the toast says so", msgs.includes("Dug an underpass so trains fit under"), JSON.stringify(msgs));
    await look(at.X + 540, at.Z, [0.6, 0.9, 0.8], 700, 10);
    await snap("low-bridge-phone-drawn.jpg");
  }
}

// Costs: the plan worked out on a pointer move over a line (fresh each spot), and the felt sheet cut again for the
// underpasses (only when they change).
{
  const costs = await p.evaluate(() => {
    const w = window.woodrail;
    const under = [...w.layout.pieceIds()].map((i) => w.layout.getPiece(i)).find((q) => q.type === "underpass");
    const h = under.pose.heading;
    const mid = { x: under.pose.x + 144 * Math.cos(h), z: under.pose.z + 144 * Math.sin(h) };
    // A bridge held square across a line elsewhere: a plan per spot, 12 mm apart.
    const lines = [...w.layout.pieceIds()].map((i) => w.layout.getPiece(i)).filter((q) => q.type === "straight-216");
    const q = lines[0];
    const n = 60;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) {
      const s = 30 + (k % 15) * 12;
      const x = q.pose.x + s * Math.cos(q.pose.heading);
      const z = q.pose.z + s * Math.sin(q.pose.heading);
      const bh = q.pose.heading + Math.PI / 2;
      w.interaction.digPlan("bridge", false, { x: x - 108 * Math.cos(bh), z: z - 108 * Math.sin(bh), heading: bh }, 48, -1 - k);
    }
    const plan = (performance.now() - t0) / n;
    // The felt sheet with every underpass's hole, cut again (its key forced to change).
    const lv = w.landscapeView;
    const holes = lv.feltHoles;
    const t1 = performance.now();
    for (let k = 0; k < 5; k++) {
      lv.feltHolesKey = "";
      lv.setFeltHoles(holes);
    }
    const felt = (performance.now() - t1) / 5;
    return { plan: Math.round(plan * 100) / 100, felt: Math.round(felt * 100) / 100, holes: holes.length, mid };
  });
  console.log(`costs: a plan per pointer move ${costs.plan} ms; the felt sheet cut for ${costs.holes} underpasses ${costs.felt} ms`);
  check("a plan per pointer move costs a few ms at most", costs.plan < 8, `${costs.plan} ms`);
  // Idle: nothing runs per frame for an underpass or a girder span (render on change).
  const idle = await p.evaluate(async () => {
    const w = window.woodrail;
    await w.settled(3);
    const before = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 2000));
    return w.framesDrawn - before;
  });
  check("idle: no frames drawn in 2 s with the underpasses and girder spans standing", idle === 0, `${idle} frames`);
}

console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close();
await server.close();
process.exit(failed.length ? 1 : 0);
