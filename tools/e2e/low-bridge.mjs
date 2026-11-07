// End-to-end: a bridge one level up over a line, on a 390×844 phone, Sandbox. The player drags a Bridge (or a Curved
// bridge) from the tray onto the top of a ramp whose next piece crosses a line on the ground; the straights under it
// make way for an underpass (one undo step, a toast), the bridge is drawn as a girder span, and a train with the
// tallest cars runs along the line under it, down into the dip and out again. Cases: square on, at 45°, a curved
// bridge over the line under its middle; refused for a curved bridge crossing near its end, over a curve and over
// points, with a train or a signal on the straights, saying why. A Long straight laid on under a bridge already
// standing digs one too, and so does Draw, across a line from a ramp's top. On a hilltop (cut into the hill); refused
// across a road, and a road refused across one; Draw on the ground under a standing bridge. Off a hill's edge (the
// underpass's block on a plinth down to the felt), with a Bridge and a Curved bridge; refused into a hillside.
//
// Groups (`-- --list`, E2E_ONLY=hill-edge,…: scripts/e2e/lib/groups.mjs, docs/agents/e2e.md): one page, each group
// building its own place to work (road-over and costs put down an underpass first when run alone).
//
// Harness shortcuts (named, setup only): the ground line, the ramp (and in case 8 the standing bridge) are put down by
// the editor (laying them is not what's tested); trains are put down by the sim and run by `sim.setLever` and the
// sim's own ticks; the signal in case 7 is put down by the editor.
//
// Usage: node tools/e2e/low-bridge.mjs [<out dir>] [--list]   (default out: e2e-out/low-bridge; pictures there too)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { groups } from "../../scripts/e2e/lib/groups.mjs";
import { mouseMoves, steps, testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "e2e-out/low-bridge";
mkdirSync(OUT, { recursive: true });
const results = [];
const errors = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const suite = groups("low-bridge", { results, errors, check });
let server = null;
let PAGE = "";
let b = null;
/** The page: opened by `boot`, when the first group that runs needs it (`--list` and an all-cached run open nothing). */
let p = null;
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));

/** The dev server, the browser and a phone page in Sandbox (`openSandbox`). */
async function boot() {
  server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5381, strictPort: false }, logLevel: "error" });
  await server.listen();
  PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
  const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);

  b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  // (The game's test clock: a laid line's settling, a dig's flourish and the train's run under the bridge keep up with
  // real time under SwiftShader. lib/fast.mjs.)
  testClockIn(b);
  await openSandbox();
}

/** A fresh phone page in Sandbox (#seed-24), the game's toasts and refusals listened to; any page before it closed. */
async function openSandbox() {
  if (p) await p.close();
  p = await b.newPage({ viewport: { width: 390, height: 844 } });
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(`${PAGE}/#seed-24`);
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 240000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
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
}

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
const build = (lower, ramp, extra = [], clear = [], dig = []) =>
  p.evaluate(
    async ([lower, ramp, extra, clear, dig]) => {
      const w = window.woodrail;
      const { trackBlock } = await import("/src/game/track-rules.ts");
      const { planUnderpass } = await import("/src/game/underpass-dig.ts");
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
          if (clear.some((q) => trackBlock(rules, q.type, false, at(q, X, Z).pose, q.y ?? 0, -1) !== null)) continue;
          // (Room round it too: nothing within 300 mm of the line's middle a level up, so the bridge has the sky.)
          if (trackBlock(rules, "straight-216", false, { x: X - 108, z: Z + 300, heading: 0 }, 0, -1) !== null) continue;
          const lo = w.editor().placeRun(all.slice(0, -1));
          const r = w.editor().place(ramp.type, at(ramp, X, Z).pose, ramp.y ?? 0, ramp.flipped ?? false);
          const more = extra.map((q) => w.editor().place(q.type, at(q, X, Z).pose, q.y ?? 0, q.flipped ?? false));
          // (Where the case digs an underpass, the game's own plan for it there (flat open ground under the bridge, by
          // the line just laid): else taken up again and the next spot tried. Without it, the spot found depended on
          // where the groups before had left the camera, and on CI after diagonal's it was rough ground: refused.)
          const ok = dig.every((q) => {
            const b = at(q, X, Z);
            return planUnderpass(rules, b.type, b.flipped, b.pose, b.y, -1)?.kind === "dig";
          });
          if (!ok) {
            for (const id of [...more, r, ...lo].reverse()) if (typeof id === "number" && id >= 0) w.editor().remove(id);
            continue;
          }
          return { X, Z, lo, ramp: r, more };
        }
      }
      return null;
    },
    [lower, ramp, extra, clear, dig],
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
async function crossing(name, key, lower, ramp, before = async () => {}, clear = []) {
  const at = await build(lower, ramp, [], clear);
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
suite.add("square", async () => {
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
});

// 2. At 45°: the ramp and bridge go diagonally across the line.
suite.add("diagonal", async () => {
  const d = Math.SQRT1_2;
  const c = await crossing("45°", "piece:bridge", LINE, { type: "ramp", pose: { x: 540 - 252 * d, z: -252 * d, heading: Math.PI / 4 } });
  if (c) {
    check("45°: an underpass is dug under a bridge at 45°", c.r.id !== null && c.after.underpasses.length === c.before.underpasses.length + 1 && c.after.girder === true, JSON.stringify({ id: c.r.id, ghost: c.r.ghost, msgs: c.msgs, girder: c.after.girder }));
    await look(c.at.X + 540, c.at.Z, [0.55, 1.1, 1], 760, 10);
    await snap("low-bridge-phone-45.jpg");
  }
});

// 3. A curved bridge: its curve crosses the line.
suite.add("curved", async () => {
  // (The line under the middle of its curve: a curved bridge is short, and nearer an end its pier would stand in the
  // trench; that's case 3b.)
  // (Where the underpass will go clear too: the felt there open, not only the line's own squares.)
  const c = await crossing("curved bridge", "piece:bridge-curve", LINE, { type: "ramp", pose: { x: 500, z: -198, heading: Math.PI / 2 } }, undefined, [{ type: "underpass", pose: { x: 360, z: 0, heading: 0 } }, { type: "underpass", pose: { x: 432, z: 0, heading: 0 } }]);
  if (c) {
    check("curved bridge: an underpass is dug under a curved bridge, drawn as a girder span", c.r.id !== null && c.after.underpasses.length === c.before.underpasses.length + 1 && c.after.girder === true, JSON.stringify({ id: c.r.id, ghost: c.r.ghost, msgs: c.msgs, girder: c.after.girder }));
    await look(c.at.X + 540, c.at.Z, [0.5, 1.1, 1], 700, 10);
    await snap("low-bridge-phone-curved.jpg");
  }
});

// 3b. A curved bridge crossing the line near its end: refused, saying why.
suite.add("curved-end", async () => {
  const c = await crossing("curved bridge near its end", "piece:bridge-curve", LINE, { type: "ramp", pose: { x: 500, z: -162, heading: Math.PI / 2 } });
  if (c) {
    check("curved bridge near its end: no underpass dug", c.after.underpasses.length === c.before.underpasses.length, JSON.stringify({ id: c.r.id, y: c.after.bridgeY, ghost: c.r.ghost }));
    check("curved bridge near its end: it says to cross nearer the bridge's middle", c.msgs.some((m) => /nearer the bridge's middle/.test(m)), JSON.stringify(c.msgs));
  }
});

// 4. A curve in the line under the bridge: refused, saying why.
suite.add("curve-under", async () => {
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
});

// 5. Points under the bridge: refused, saying why.
suite.add("points", async () => {
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
});

// 6. A train standing on the straights the underpass would take up: refused, saying so; moved off, it digs.
suite.add("train", async () => {
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
});

// 7. A signal on a joint of the straights it would take up: refused, saying to move it.
suite.add("signal", async () => {
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
});

// 8. A bridge already standing one level up; a Long straight laid on from the line's end under it: straights on to
// an underpass under the bridge go down in its place.
suite.add("laid-under", async () => {
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
});

// 9. Draw: from a ramp's top end, a stroke on across a line on the ground: the line lays a bridge over it one level
// up and digs an underpass under it (no longer red, "go two levels up").
suite.add("draw-ramp", async () => {
  // (The drawn bridge's way across clear of other track: under it, only the line.)
  const across = [
    { type: "bridge", pose: { x: 540, z: -108, heading: Math.PI / 2 }, y: 48 },
    { type: "bridge", pose: { x: 540, z: 108, heading: Math.PI / 2 }, y: 48 },
  ];
  const at = await build(LINE, { type: "ramp", pose: { x: 540, z: -252, heading: Math.PI / 2 } }, [], across, [across[0]]);
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
      // (A few moves to a frame, as a mouse's come: lib/fast.mjs.)
      await mouseMoves(p, steps([ax, ay], [bx, by], Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 12))));
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
});

// 10. On a hilltop: a line along a level hill, a ramp up from it, a Bridge onto the ramp's top: the underpass is dug,
// its trench cut into the hill (the ground drops to its dip there).
suite.add("hilltop", async () => {
  const H = 48;
  const lower = [0, 216, 432, 648].map((x) => ({ type: "straight-216", pose: { x, z: 0, heading: 0 }, y: H }));
  // (Harness shortcut: the hill is raised a level by the Raise tool's own land editor, square by square, on open
  // felt found clear for the line; the line and ramp then put down on it by the editor. The bridge is what's tested.)
  const at = await p.evaluate(
    async ([lower, H]) => {
      const w = window.woodrail;
      const { trackBlock } = await import("/src/game/track-rules.ts");
      const { plotSlotOf } = await import("/src/landscape/edit.ts");
      const rules = w.interaction.rules;
      const g = w.landscape.grid;
      const t = w.controls.target;
      for (let d = 0; d < 9000; d += 72) {
        for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
          const X = Math.round((t.x + d * Math.cos(a)) / 72) * 72;
          const Z = Math.round((t.z + d * Math.sin(a)) / 72) * 72 + 36;
          // Open felt for a block a line's length and a ramp's reach: every square's centre clear for track.
          const cells = [];
          let ok = true;
          for (let x = X - 36; x <= X + 900 && ok; x += 72)
            for (let z = Z - 324; z <= Z + 108 && ok; z += 72) {
              const i = g.cellAtWorld(x, z);
              if (i === -1 || g.height[i] !== 0 || trackBlock(rules, "straight-54", false, { x: x - 27, z, heading: 0 }, 0, -1) !== null) ok = false;
              else cells.push(i);
            }
          if (!ok) continue;
          const editor = w.interaction.landEditor();
          if (cells.some((i) => editor.check(i, 1) !== null)) continue;
          for (const i of cells) editor.apply(i, 1);
          w.editLand([...new Set(cells.map(plotSlotOf))]);
          const lo = w.editor().placeRun(lower.map((q) => ({ ...q, pose: { ...q.pose, x: X + q.pose.x, z: Z + q.pose.z }, flipped: false })));
          const ramp = w.editor().place("ramp", { x: X + 432, z: Z - 252, heading: Math.PI / 2 }, H, false);
          return { X, Z, lo, ramp };
        }
      }
      return null;
    },
    [lower, H],
  );
  if (!at) check("hilltop: room for it (open felt to raise a hill on)", false, "none found");
  else {
    const top = await rampTop(at.ramp);
    await look(at.X + 432, at.Z, [0.15, 1, 0.55], 900);
    await settle();
    const was = await state(null);
    await said();
    const r = await lay("piece:bridge", await screen(top.x - 6 * Math.cos(top.heading), top.y, top.z - 6 * Math.sin(top.heading)));
    const msgs = await said();
    const after = await state(r.id);
    const ground = await p.evaluate(async ([x, z]) => {
      const { hillsOf } = await import("/src/landscape/index.ts");
      const h = hillsOf(window.woodrail.landscape.grid);
      return { mid: Math.round(h.groundAt(x, z)), beside: Math.round(h.groundAt(x, z + 44)) };
    }, [at.X + 432, at.Z]);
    check("hilltop: the bridge digs an underpass a level up, on the hill", r.id !== null && after.underpasses.length === was.underpasses.length + 1 && after.bridgeY === 2 * H && after.girder === true, JSON.stringify({ id: r.id, y: after.bridgeY, ghost: r.ghost, msgs }));
    check("hilltop: its trench is cut into the hill (ground at the dip 18, beside it 48)", ground.mid === H - 30 && ground.beside === H, JSON.stringify(ground));
    await look(at.X + 432, at.Z, [0.7, 0.9, 0.9], 620, H);
    await snap("low-bridge-2-hill.jpg");
  }
});

// 14. Off a hill's edge: a line along a hilltop runs on off its edge on risers; a Bridge (and a Curved bridge) a level
// above it near the edge digs an underpass running off the edge, its block standing on a plinth down to the felt there
// (the risers under it taken up), and a train with the tallest cars runs through under it. An Underpass snapped to a
// line on the felt and pointing into the hill is refused: it can't dig into a hillside.
/**
 * Raise a hill a level on open felt (harness shortcut: the Raise tool's own land editor, square by square), then lay
 * `lower` on it and on past its edge (pieces at the hill's height past the edge on the risers the track rules give
 * them), and a ramp up from the hilltop. Relative to (X, Z): the hill covers x < `edge`, z from −324 to 108.
 */
const hillEdge = async (edge, lower, ramp) => {
  // (LB_FRESH=1: as if there were no room, to try the fresh page alone.)
  const at = process.env.LB_FRESH === "1" ? { error: "none found (LB_FRESH)" } : await hillEdgeOnce(edge, lower, ramp);
  if (!at?.error?.startsWith("none found")) return at;
  // (A full run's earlier groups have built over the open felt of this small map: a fresh Sandbox for this one.)
  console.log(`(no room left on the map: ${at.error}; a fresh Sandbox)`);
  await openSandbox();
  return hillEdgeOnce(edge, lower, ramp);
};
const hillEdgeOnce = (edge, lower, ramp) =>
  p.evaluate(
    async ([edge, lower, ramp]) => {
      const w = window.woodrail;
      const { trackBlock, trackPlacement } = await import("/src/game/track-rules.ts");
      const { plotSlotOf } = await import("/src/landscape/edit.ts");
      const rules = w.interaction.rules;
      const g = w.landscape.grid;
      const t = w.controls.target;
      // Every square corner over the map, nearest the view first (earlier groups have built on the felt near it).
      const B0 = w.director.bounds;
      const B = Number.isFinite(B0.x0 + B0.x1 + B0.z0 + B0.z1) ? B0 : { x0: t.x - 6000, x1: t.x + 6000, z0: t.z - 6000, z1: t.z + 6000 };
      const spots = [];
      for (let X = Math.floor(B.x0 / 72) * 72; X <= B.x1; X += 72) for (let Z = Math.floor(B.z0 / 72) * 72 + 36; Z <= B.z1; Z += 72) spots.push([X, Z]);
      spots.sort((a, b) => Math.hypot(a[0] - t.x, a[1] - t.z) - Math.hypot(b[0] - t.x, b[1] - t.z));
      const fails = { off: 0, high: 0, track: 0 };
      for (const [X, Z] of spots) {
        // Open felt a line's length and a ramp's reach round it, and past the hill's edge.
        const cells = [];
        let ok = true;
        for (let x = X - 36; x <= X + 684 && ok; x += 72)
          for (let z = Z - 324; z <= Z + 108 && ok; z += 72) {
            const i = g.cellAtWorld(x, z);
            if (i === -1) (ok = false), fails.off++;
            else if (g.height[i] !== 0) (ok = false), fails.high++;
            else {
              const why = trackBlock(rules, "straight-54", false, { x: x - 27, z, heading: 0 }, 0, -1);
              if (why !== null) (ok = false), fails.track++, (fails[why] = (fails[why] ?? 0) + 1);
              else if (x < X + edge && z <= Z + 108) cells.push(i);
            }
          }
        if (!ok) continue;
        const editor = w.interaction.landEditor();
        const no = cells.map((i) => editor.check(i, 1)).find((r) => r !== null);
        if (no) {
          window.__hillWhy = (window.__hillWhy ?? 0) + 1;
          window.__hillLast = String(no);
          continue;
        }
        for (const i of cells) editor.apply(i, 1);
        w.editLand([...new Set(cells.map(plotSlotOf))]);
        const lo = [];
        for (const q of lower) {
          const pose = { ...q.pose, x: X + q.pose.x, z: Z + q.pose.z };
          const placed = trackPlacement(rules, q.type, false, pose, q.y, -1);
          if (placed.reason) return { error: `${q.type} at ${q.pose.x}: ${placed.reason}` };
          lo.push(w.editor().place(q.type, pose, q.y, false, placed.risers));
        }
        const r = w.editor().place("ramp", { x: X + ramp.pose.x, z: Z + ramp.pose.z, heading: ramp.pose.heading }, ramp.y, false);
        return { X, Z, lo, ramp: r };
      }
      return { error: `none found (${window.__hillWhy ?? 0} refused by the land editor, last: ${window.__hillLast ?? "-"}; ${spots.length} spots from ${JSON.stringify([t.x, t.z])} in ${JSON.stringify(B0)}; ${JSON.stringify(fails)})` };
    },
    [edge, lower, ramp],
  );

/** The layout's underpasses with their plinths (levels down), risers standing in their blocks, and pieces left needing risers. */
const plinths = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    const { plinthLevels, checkSupport } = await import("/src/landscape/index.ts");
    const ps = [...w.layout.pieceIds()].map((i) => ({ id: i, ...w.layout.getPiece(i) }));
    const out = [];
    for (const u of ps.filter((q) => q.type === "underpass")) {
      const c = Math.cos(u.pose.heading);
      const s = Math.sin(u.pose.heading);
      const inBlock = ps.filter((q) => q.type === "riser" && q.y < u.y && (() => {
        const dx = q.pose.x - u.pose.x;
        const dz = q.pose.z - u.pose.z;
        const along = dx * c + dz * s;
        return along > 0 && along < 288 && Math.abs(-dx * s + dz * c) < 30;
      })()).length;
      out.push({ id: u.id, y: u.y, plinth: plinthLevels(w.landscape, u.type, u.flipped, u.pose, u.y), inBlock, end: { x: u.pose.x + 288 * c, z: u.pose.z + 288 * s }, mid: { x: u.pose.x + 144 * c, z: u.pose.z + 144 * s } });
    }
    const loose = ps.filter((q) => q.type !== "riser" && q.y > 0).filter((q) => {
      const r = checkSupport(w.landscape, w.layout, q.type, q.flipped, q.pose, q.y, q.id);
      return r.kind !== "held" || r.risers.length > 0;
    }).map((q) => `${q.type}@${Math.round(q.pose.x)},${Math.round(q.pose.z)}`);
    return { underpasses: out, loose };
  });

/** Run a train with the tallest cars from `lo` along the line, and the lowest each car gets near (x, z). */
const runUnder = (lo, x, z) =>
  p.evaluate(
    async ([lo, x, z]) => {
      const w = window.woodrail;
      const { createSnapshot } = await import("/src/sim/sim.ts");
      // (Harness shortcut: the train put down and started by the sim, not from the tray: the crossing is the test.)
      const t = w.sim.addTrainAround(["engine", "passenger", "passenger", "caboose"], { pieceId: lo, pathIndex: 0, s: 108, reversed: false });
      if (t.kind !== "placed") return { placed: t.kind };
      const ids = w.sim.getTrain(t.trainId).cars.map((c) => c.id);
      w.sim.setLook(ids[0], "electric");
      w.sim.setLook(ids[1], "double-decker");
      w.sim.setLook(ids[2], "double-decker");
      w.sim.setLever(ids[0], 1);
      const snap = createSnapshot();
      const low = {};
      for (let k = 0; k < 5000; k++) {
        w.sim.tick();
        w.sim.writeSnapshot(snap);
        for (let c = 0; c < snap.count; c++) {
          const cx = snap.transforms[c * 6];
          const cy = snap.transforms[c * 6 + 1];
          const cz = snap.transforms[c * 6 + 2];
          if (Math.hypot(cx - x, cz - z) < 20) low[snap.ids[c]] = Math.min(low[snap.ids[c]] ?? Infinity, cy);
        }
        if (Object.keys(low).length === ids.length) break;
      }
      w.sim.setLever(ids[0], 0);
      w.sim.removeTrain(t.trainId);
      return { ids, low: Object.values(low).map((y) => Math.round(y * 10) / 10) };
    },
    [lo, x, z],
  );

async function offTheEdge(name, key, edge, ramp, shotName) {
  const H = 48;
  const lower = [0, 216, 432].map((x) => ({ type: "straight-216", pose: { x, z: 0, heading: 0 }, y: H }));
  const at = await hillEdge(edge, lower, { ...ramp, y: H });
  if (!at || at.error) {
    check(`${name}: room for it (open felt to raise a hill on)`, false, at?.error ?? "none found");
    return;
  }
  const top = await rampTop(at.ramp);
  await look(at.X + edge, at.Z, [0.15, 1, 0.55], 900);
  await settle();
  const was = await state(null);
  await said();
  const r = await lay(key, await screen(top.x - 6 * Math.cos(top.heading), top.y, top.z - 6 * Math.sin(top.heading)));
  const msgs = await said();
  const after = await state(r.id);
  const pl = await plinths();
  const u = pl.underpasses.find((q) => !was.underpasses.includes(q.id));
  check(`${name}: the bridge digs an underpass a level up on the hill`, r.id !== null && after.underpasses.length === was.underpasses.length + 1 && after.bridgeY === 2 * H && after.girder === true, JSON.stringify({ id: r.id, y: after.bridgeY, ghost: r.ghost, msgs }));
  check(`${name}: the toast says so`, msgs.includes("Dug an underpass so trains fit under"), JSON.stringify(msgs));
  check(`${name}: the underpass runs off the hill's edge, its block on a plinth a level down to the felt`, !!u && u.y === H && u.plinth === 1 && u.end.x > at.X + edge + 20, JSON.stringify({ u, edge: at.X + edge }));
  check(`${name}: no riser left standing in its block, and nothing left in the air`, !!u && u.inBlock === 0 && pl.loose.length === 0, JSON.stringify({ inBlock: u?.inBlock, loose: pl.loose }));
  if (u) {
    const run = await runUnder(at.lo[0], u.mid.x, u.mid.z);
    check(`${name}: a train with the tallest cars runs through under the bridge, every car down in the dip (18) as it passes`, run.low?.length === 4 && run.low.every((y) => Math.abs(y - (H - 30)) < 0.5), JSON.stringify(run));
  }
  await look(at.X + edge, at.Z - 20, [0.75, 0.6, 1], 560, H / 2);
  await snap(shotName);
  // One undo puts the line (and its risers) back as it was. (A train left on it by the run is taken off first: the
  // editor refuses to undo track a train is on.)
  const cleared = await p.evaluate((u) => {
    const w = window.woodrail;
    const on = w.sim.trainIds().filter((t) => [...w.sim.piecesUnder(t)].includes(u));
    for (const t of on) w.sim.removeTrain(t);
    return on.length;
  }, u?.id ?? -1);
  if (cleared) console.log(`(${cleared} train left on the line taken off before the undo)`);
  const undo = await p.evaluate(() => {
    const u = [...document.querySelectorAll("button")].find((x) => (x.title || x.getAttribute("aria-label") || "").startsWith("Undo"));
    u?.click();
    const w = window.woodrail;
    return u ? { label: u.title || u.getAttribute("aria-label"), disabled: u.disabled, stack: w.editor().undoStack?.length, trains: w.sim.trainIds().length, lifted: [...w.layout.pieceIds()].filter((i) => w.layout.isLifted(i)).length } : null;
  });
  await frames();
  let undone = await state(null);
  for (let k = 0; k < 30 && undone.types !== was.types; k++) {
    await p.waitForTimeout(500);
    undone = await state(null);
  }
  check(`${name}: one undo takes back the bridge and the underpass (the straights and risers back)`, undone.types === was.types, `${undone.types} vs ${was.types}; undo ${JSON.stringify(undo)}`);
  await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => (x.title || x.getAttribute("aria-label") || "").startsWith("Redo"))?.click());
  await frames();
}

suite.add("hill-edge", () => offTheEdge("off a hill's edge", "piece:bridge", 504, { pose: { x: 468, z: -252, heading: Math.PI / 2 } }, "underpass-3-after-hill-edge.jpg"));
suite.add("hill-edge-curved", () => offTheEdge("off a hill's edge, curved bridge", "piece:bridge-curve", 504, { pose: { x: 428, z: -198, heading: Math.PI / 2 } }, "underpass-3-after-hill-edge-curved.jpg"));
suite.add("hillside", async () => {
  // A line on the felt ending short of a hill; an Underpass from the tray onto its end, pointing into the hill.
  const at = await hillEdge(360, [{ type: "straight-216", pose: { x: 396, z: 0, heading: 0 }, y: 0 }], { pose: { x: 216, z: -252, heading: Math.PI / 2 }, y: 48 });
  if (!at || at.error) {
    check("hillside: room for it", false, at?.error ?? "none found");
    return;
  }
  await look(at.X + 396, at.Z, [0.15, 1, 0.6], 800);
  await settle();
  const was = await state(null);
  await said();
  const r = await lay("piece:underpass", await screen(at.X + 396 + 4, 0, at.Z));
  const msgs = await said();
  const after = await state(null);
  check("hillside: an underpass pointing into a hillside is refused", after.underpasses.length === was.underpasses.length && r.id === null, JSON.stringify({ id: r.id, ghost: r.ghost }));
  check("hillside: it says it can't dig into a hillside", msgs.some((m) => /can't dig into a hillside/.test(m)), JSON.stringify(msgs));
});

// 11. A road across where an underpass would go: the Underpass from the tray is refused, saying why. (Harness
// shortcut: the road square put down by the editor's road step, not the road tray: the underpass is what's tested.)
suite.add("road", async () => {
  const at = await build(LINE.slice(0, 1), { type: "ramp", pose: { x: 900, z: -400, heading: 0 } }, [], [{ type: "underpass", pose: { x: 216, z: 0, heading: 0 } }]);
  if (!at) check("road: room for it", false);
  else {
    const cell = await p.evaluate(async ([x, z]) => {
      const w = window.woodrail;
      const { setRoadSquare, groundUnder } = await import("/src/roads/place.ts");
      const { encodeRoad } = await import("/src/roads/pieces.ts");
      const { plotSlotOf } = await import("/src/landscape/edit.ts");
      const g = w.landscape.grid;
      const i = g.cellAtWorld(x, z);
      let undo = () => {};
      w.editor().editRoads({ do: () => (undo = setRoadSquare(g, i, encodeRoad("straight", 1), groundUnder(w.landscape, i))), undo: () => undo(), slots: [plotSlotOf(i)], trees: false });
      return i;
    }, [at.X + 360, at.Z]);
    await look(at.X + 300, at.Z, [0.15, 1, 0.6], 800);
    await settle();
    const was = await state(null);
    await said();
    const r = await lay("piece:underpass", await screen(at.X + 216 - 4, 0, at.Z));
    const msgs = await said();
    const after = await state(null);
    check("road: an underpass across a road is refused", after.underpasses.length === was.underpasses.length && r.id === null, JSON.stringify({ id: r.id, ghost: r.ghost, cell }));
    check("road: it says cars would drive into its trench", msgs.some((m) => /An underpass can't cross a road/.test(m)), JSON.stringify(msgs));
    // The picture: held there again, its red ghost and the reason showing.
    const ti = await item("piece:underpass");
    if (ti) {
      await p.mouse.click(ti[0], ti[1]);
      await frames();
      const pt = await screen(at.X + 216 - 4, 0, at.Z);
      await p.mouse.move(pt[0], pt[1], { steps: 5 });
      await frames();
      await p.waitForTimeout(300);
      await p.screenshot({ path: `${OUT}/low-bridge-2-road-refused.jpg`, type: "jpeg", quality: 82, timeout: 180000 }).catch(() => {});
      await p.keyboard.press("Escape");
      await frames();
    }
  }
});

// 12. A road laid from the road tray across an underpass: refused, saying why.
suite.add("road-over", async () => {
  const findU = () =>
    p.evaluate(() => {
      const w = window.woodrail;
      const id = [...w.layout.pieceIds()].find((i) => w.layout.getPiece(i).type === "underpass" && w.layout.getPiece(i).y === 0);
      const q = id === undefined ? null : w.layout.getPiece(id);
      return q && { x: q.pose.x + 144 * Math.cos(q.pose.heading), z: q.pose.z + 144 * Math.sin(q.pose.heading) };
    });
  // (Run alone, no group before it has dug one: harness shortcut, an underpass put down by the editor.)
  if (!(await findU())) await build([{ type: "underpass", pose: { x: 0, z: 0, heading: 0 } }], { type: "ramp", pose: { x: 900, z: -400, heading: 0 } });
  const u = await findU();
  await look(u.x, u.z, [0.15, 1, 0.6], 800);
  await settle();
  const before = await p.evaluate(() => [...window.woodrail.landscape.grid.road].filter((r) => r !== 0).length);
  await said();
  await p.evaluate(() => document.querySelector(".tray .tabs [data-tab=roads]")?.click());
  await frames();
  const r = await item("road:straight");
  if (!r) check("road over an underpass: the road tray has a straight road", false);
  else {
    await p.mouse.click(r[0], r[1]);
    await frames();
    const at = await screen(u.x, 0, u.z);
    await p.mouse.move(at[0], at[1], { steps: 5 });
    await frames();
    await p.mouse.click(at[0], at[1]);
    await frames();
    await p.keyboard.press("Escape");
    const msgs = await said();
    const after = await p.evaluate(() => [...window.woodrail.landscape.grid.road].filter((r) => r !== 0).length);
    check("road over an underpass: no road goes down over it", after === before, `${before} → ${after}`);
    check("road over an underpass: it says a road can't cross an underpass", msgs.some((m) => /A road can't cross an underpass/.test(m)), JSON.stringify(msgs));
  }
  await p.evaluate(() => document.querySelector(".tray .tabs [data-tab=track]")?.click());
  await frames();
});

// 13. Draw on the ground, on from a line's end, under a bridge already standing one level up: straights on to an
// underpass under the bridge (no longer red under it).
suite.add("draw-under", async () => {
  const lower = LINE.slice(0, 2);
  const at = await build(lower, { type: "ramp", pose: { x: 756, z: -252, heading: Math.PI / 2 } }, [{ type: "bridge", pose: { x: 756, z: -108, heading: Math.PI / 2 }, y: 48 }], [
    { type: "straight-216", pose: { x: 432, z: 0, heading: 0 } },
    { type: "underpass", pose: { x: 612, z: 0, heading: 0 } },
    { type: "straight-216", pose: { x: 900, z: 0, heading: 0 } },
  ]);
  if (!at) check("draw under a bridge: room for it", false);
  else {
    // (A phone's narrow view: centred on the line's end and the bridge, far enough out to show both.)
    await look(at.X + 590, at.Z, [0.1, 1, 0.45], 1500);
    await settle();
    const was = await state(null);
    await said();
    if (!(await p.evaluate(() => window.woodrail.interaction.drawing))) await p.evaluate(() => document.querySelector(".tray-draw")?.click());
    await frames();
    const pts = [
      [at.X + 432 - 4, at.Z],
      [at.X + 700, at.Z],
      [at.X + 1000, at.Z],
      [at.X + 1150, at.Z],
    ];
    const sc = [];
    for (const [x, z] of pts) sc.push(await screen(x, 0, z));
    await p.mouse.move(sc[0][0], sc[0][1]);
    await p.mouse.down();
    for (let i = 1; i < sc.length; i++) {
      const [ax, ay] = sc[i - 1];
      const [bx, by] = sc[i];
      // (A few moves to a frame, as a mouse's come: lib/fast.mjs.)
      await mouseMoves(p, steps([ax, ay], [bx, by], Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 12))));
    }
    const drawn = await p.evaluate(() => (window.woodrail.interaction.draw.line?.pieces ?? []).map((q) => `${q.type}${q.blocked ? "(red)" : ""}`));
    await p.mouse.up();
    await settle();
    await p.keyboard.press("Escape");
    const msgs = await said();
    const after = await state(at.more[0]);
    check("draw under a bridge: the line goes on under it through an underpass, the bridge a girder span", after.underpasses.length === was.underpasses.length + 1 && after.girder === true, JSON.stringify({ drawn, msgs }));
    await look(at.X + 756, at.Z, [0.7, 0.9, 0.9], 640, 10);
    await snap("low-bridge-2-drawn-under.jpg");
  }
});

// Costs: the plan worked out on a pointer move over a line (fresh each spot), and the felt sheet cut again for the
// underpasses (only when they change).
suite.add("costs", async () => {
  // (Run alone: a line and an underpass to measure on, put down by the editor.)
  const has = await p.evaluate(() => {
    const w = window.woodrail;
    const types = [...w.layout.pieceIds()].map((i) => w.layout.getPiece(i).type);
    return types.includes("underpass") && types.includes("straight-216");
  });
  if (!has) await build([...LINE.slice(0, 1), { type: "underpass", pose: { x: 216, z: 0, heading: 0 } }], { type: "ramp", pose: { x: 900, z: -400, heading: 0 } });
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
});

await suite.run(async (g, go) => {
  if (!p) await boot();
  await go();
});
if (p) {
  console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await b.close();
  await server.close();
}
suite.finish();
