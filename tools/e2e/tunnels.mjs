// End-to-end: tunnels (docs/superpowers/specs/2026-11-04-tunnels.md), Game mode on a 390×844 phone.
// Setup (named shortcuts, not what's tested): Bridges learned; Tunnels found researchable after it, then learned; coins
// and planks for the workshop; a hill a level high raised on open felt by the Raise tool's own land editor; a line on
// the felt laid by the editor up to near its side. Then, as a player does it:
//   1. The tunnel mouths are on the tray's Bridges shelf; two short ones made at the workshop, their coins paid.
//   2. A Long straight from the tray put down at the line's end, into the hill's side: a tunnel goes in its place (a
//      short mouth down, track a level under the felt under the hill, a mouth up out the far side), one undo step, the
//      toast; the two short mouths out of the toy box. Undo takes it all back (the mouths back in the box); again, it's dug.
//   3. Portals at both of the hill's sides, the dashes on the hilltop; while a piece is held, the track in the tunnel
//      shows through the hill.
//   4. A train run through it by the sim: under the hill a level below the felt, drawn as a ghost there, and out on the
//      far side on the felt.
//   5. Draw: a stroke across a second hill a level high (from the line's far end): under it, not over.
//   6. Costs: the rules for a straight held into the hill (a pointer move); the tunnels found on a large layout
//      (1,100 pieces); idle frames.
//
// Usage: npm run e2e:tunnels [-- <out dir>]   (default out: e2e-out/tunnels)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/tunnels";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5411, strictPort: false }, logLevel: "error" });
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
await p.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary").click());
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

// Setup: Bridges learned; Tunnels researchable after it (checked), then learned; coins; a hill and a line to it.
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  const { canResearch } = await import("/src/game/research.ts");
  const { tunnelsOn } = await import("/src/landscape/hill-shape.ts");
  const { plotSlotOf } = await import("/src/landscape/edit.ts");
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const progress = w.progress();
  const before = { off: !tunnelsOn(), researchable: canResearch(progress, "tunnels") };
  w.learn("bridges");
  const after = canResearch(progress, "tunnels");
  w.learn("tunnels");
  progress.coins += 400;
  const g = w.landscape.grid;
  const rules = w.interaction.rules;
  const t = w.controls.target;
  // A site: open felt 13 squares along x and 7 across, a hill a level high on squares 4 to 8 (5 across), and a short
  // straight on the felt from its start (its end 180 short of the hill's side).
  const site = () => {
    for (let d = 0; d < 9000; d += 72) {
      for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
        const X = Math.round((t.x + d * Math.cos(a) - 400) / 72) * 72;
        const Z = Math.round((t.z + d * Math.sin(a)) / 72) * 72 + 36;
        let ok = true;
        for (let c = 0; c < 13 && ok; c++)
          for (let r = -3; r <= 3 && ok; r++) {
            const i = g.cellAtWorld(X + c * 72 + 36, Z + r * 72);
            if (i === -1 || g.height[i] !== 0 || trackBlock(rules, "straight-54", false, { x: X + c * 72 + 9, z: Z + r * 72, heading: 0 }, 0, -1) !== null) ok = false;
          }
        if (!ok) continue;
        const editor = w.interaction.landEditor();
        const raise = [];
        for (let c = 4; c <= 8; c++) for (let r = -2; r <= 2; r++) raise.push(g.cellAtWorld(X + c * 72 + 36, Z + r * 72));
        if (raise.some((i) => editor.check(i, 1) !== null)) continue;
        for (const i of raise) editor.apply(i, 1);
        w.editLand([...new Set(raise.map(plotSlotOf))]);
        const ids = w.editor().placeRun([{ type: "straight-108", pose: { x: X, z: Z, heading: 0 }, y: 0, flipped: false }]);
        return { X, Z, face: X + 288, far: X + 648, end: X + 108, ids };
      }
    }
    return null;
  };
  const one = site();
  const two = one && site();
  if (one && two) return { ...before, after, one, two, coins: progress.coins };
  return { ...before, after, error: "no room" };
});
check("setup: Tunnels is researchable once Bridges is learned (not before), and its rules are off till then", setup.off && !setup.researchable && setup.after, JSON.stringify(setup));
if (setup.error) throw new Error(setup.error);
const { X, Z } = setup.one;
check("learned: tunnels' rules on", await p.evaluate(async () => (await import("/src/landscape/hill-shape.ts")).tunnelsOn()));

// 1. The mouths on the Bridges shelf; two short ones made at the workshop, their coins paid.
check("the tray's Bridges shelf has the short tunnel mouth", !!(await item("piece:tunnel-mouth-short")));
check("…and the tunnel mouth", !!(await item("piece:tunnel-mouth")));
await p.keyboard.press("Escape");
const made = await p.evaluate(async () => {
  const w = window.woodrail;
  const { costOf } = await import("/src/game/crafting.ts");
  const progress = w.progress();
  // The price, as the workshop charges it (`costOf`, from the things' rules).
  const price = costOf(new Map([["piece:tunnel-mouth-short", 2]]));
  // (Setup shortcut: the two made. A new game has no workshop yet; making things there is the workshop's own e2e.)
  progress.add("piece:tunnel-mouth-short", 2);
  w.hud.refreshTrayBadges?.();
  return { price, stock: progress.available(w.world, "piece:tunnel-mouth-short") };
});
check("two short tunnel mouths cost 40 coins and 2 planks at the workshop; two in the toy box", made.price.coins === 40 && made.price.goods.planks === 2 && made.stock === 2, JSON.stringify(made));

// 2. A Long straight put down at the line's end, into the hill's side.
await look(setup.one.end + 80, Z, [-0.9, 1.1, 0.25], 900);
await settle();
const lineEnd = { x: setup.one.end, z: Z };
const before = await pieces();
await said();
const r = await item("piece:straight-216");
check("a Long straight on the tray", !!r);
const at = await screen(lineEnd.x + 60, 0, lineEnd.z);
await p.mouse.click(r[0], r[1]);
await frames();
await p.mouse.move(at[0], at[1], { steps: 6 });
await frames();
await snap("tunnels-held.jpg");
const held = await p.evaluate(({ end }) => {
  const w = window.woodrail;
  const m = w.interaction.preview;
  return { kind: w.interaction.mode.kind, armed: w.interaction.armed?.type ?? null, preview: m ? { goal: m.goal, snap: m.snap?.kind, blocked: m.blocked ?? null, type: m.type } : null, end, cam: w.camera.position.toArray().map(Math.round) };
}, { end: lineEnd });
console.log("held:", JSON.stringify(held), "at", at);
await p.mouse.click(at[0], at[1]);
await frames();
await p.keyboard.press("Escape");
await settle();
const dug = await pieces();
const fresh = dug.filter((q) => !before.some((o) => o.id === q.id));
const msgs = await said();
const stockAfter = await p.evaluate(() => window.woodrail.progress().available(window.woodrail.world, "piece:tunnel-mouth-short"));
check(
  "dropped into the hill's side: a tunnel under it (two short mouths, track a level under the felt)",
  fresh.filter((q) => q.type === "tunnel-mouth-short").length === 2 && fresh.some((q) => Math.abs(q.y + 48) < 1),
  JSON.stringify({ fresh: fresh.map((q) => `${q.type}@${Math.round(q.pose.x - X)},${q.y}`), msgs }),
);
check("…the toast says so", msgs.includes("Dug a tunnel under the hill"), JSON.stringify(msgs));
check("…the two short mouths out of the toy box", stockAfter === 0, `${stockAfter}`);
check("…and out the far side onto the felt", fresh.some((q) => q.y === 0 && q.pose.x > setup.one.far), JSON.stringify(fresh.map((q) => Math.round(q.pose.x - X))));
const wasDug = fresh.length > 0;
if (wasDug) await p.evaluate(() => window.woodrail.editor().undo());
await settle();
const undone = await pieces();
const stockBack = await p.evaluate(() => window.woodrail.progress().available(window.woodrail.world, "piece:tunnel-mouth-short"));
check("one undo takes the whole tunnel back, the mouths back in the box", wasDug && undone.length === before.length && stockBack === 2, JSON.stringify({ n: undone.length, was: before.length, stockBack }));
if (wasDug) await p.evaluate(() => window.woodrail.editor().redo());
await settle();
const redone = await pieces();
check("redo: dug again", wasDug && redone.length === dug.length, `${redone.length} vs ${dug.length}`);
if (!wasDug) throw new Error("no tunnel dug");

// 3. Portals and dashes.
const found = await p.evaluate(() => {
  const f = window.woodrail.tunnelsView.found;
  return { portals: f.portals.map((q) => ({ x: Math.round(q.x), kind: q.kind })), dashes: f.dashes.length, pieces: f.pieces.size };
});
check("portals at both of the hill's sides, dashes over the tunnel", found.portals.length === 2 && found.portals.every((q) => q.kind === "hill") && found.dashes > 5, JSON.stringify(found));

// 4. A train run through it: under the hill, a ghost there, out on the far side.
// (On the mouth down, near its foot: the cars behind it on the straights before.)
const first = redone.filter((q) => !before.some((o) => o.id === q.id) && q.type === "tunnel-mouth-short").sort((a, b) => a.pose.x - b.pose.x)[0];
const run = await p.evaluate(async ({ first, far }) => {
  const w = window.woodrail;
  // (Setup: the line laid on past the tunnel, two long straights from its far end, as a player would lay it on.)
  const { connectorRef } = await import("/src/track/layout.ts");
  let tip = null;
  for (const id of w.layout.pieceIds()) {
    const q = w.layout.getPiece(id);
    if (q.y !== 0 || Math.abs(q.pose.z - first.pose.z) > 1) continue;
    for (const k of [0, 1]) {
      if (w.layout.joinedConnector(connectorRef(id, k)) !== -1) continue;
      const c = w.layout.worldConnector(connectorRef(id, k), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
      if (c.x > far && (!tip || c.x > tip.x)) tip = { x: c.x, z: c.z };
    }
  }
  if (tip) w.editor().placeRun([0, 216].map((d) => ({ type: "straight-216", pose: { x: tip.x + d, z: tip.z, heading: 0 }, y: 0, flipped: false })));
  const { createSnapshot } = await import("/src/sim/sim.ts");
  const r = w.sim.addTrain(["engine", "passenger"], { pieceId: first.id, pathIndex: 0, s: 60, reversed: false });
  if (r.kind !== "placed") return { error: r.kind };
  const ids = w.sim.getTrain(r.trainId).cars.map((c) => c.id);
  w.sim.setLever(ids[0], 1);
  const snap = createSnapshot();
  let lowest = Infinity;
  let ghost = false;
  let out = null;
  for (let k = 0; k < 3000; k++) {
    w.sim.tick();
    w.sim.writeSnapshot(snap);
    const i = [...snap.ids.slice(0, snap.count)].indexOf(ids[0]);
    const x = snap.transforms[i * 6];
    const y = snap.transforms[i * 6 + 1];
    lowest = Math.min(lowest, y);
    if (k % 20 === 0 && y < -40) {
      w.trainView.update(snap, 0);
      ghost ||= w.trainView.inTunnel(ids[0]);
    }
    if (x > far + 20 && lowest < -40 && y > -0.5) {
      out = { x: Math.round(x), y: Math.round(y) };
      break;
    }
  }
  w.sim.setLever(ids[0], 0);
  for (let k = 0; k < 300; k++) w.sim.tick();
  w.invalidate();
  return { lowest: Math.round(lowest), ghost, out, ids };
}, { first, far: setup.one.far });
check("a train runs through: a level under the felt under the hill", run.lowest === -48, JSON.stringify(run));
check("…drawn as a ghost through the hill while it's in", run.ghost === true, JSON.stringify(run));
check("…and out the far side on the felt", !!run.out && run.out.y === 0, JSON.stringify(run));
await look(setup.one.face + 40, Z, [-1, 0.85, 0.6], 700);
await snap("tunnels-phone-portal.jpg");

// 5. Draw across the second hill, from its line's end.
const two = setup.two;
const end2 = { x: two.end, z: two.Z };
const hill2 = { face: two.face, far: two.far };
// (Two more short mouths in the toy box, as before.)
await p.evaluate(() => window.woodrail.progress().add("piece:tunnel-mouth-short", 2));
// (The camera back till the whole stroke is on screen, above the tray.)
let pts = [];
for (const dist of [1300, 1600, 2000, 2500, 3000]) {
  await look((end2.x + hill2.far + 260) / 2, two.Z, [-0.9, 1.3, 0.2], dist);
  await settle();
  pts = [];
  for (let x = end2.x + 4; x <= hill2.far + 260; x += 30) pts.push(await screen(x, x > hill2.face && x < hill2.far ? 48 : 0, two.Z));
  if (pts.every(([x, y]) => x > 10 && x < 380 && y > 150 && y < 660)) break;
}
const was2 = await pieces();
await p.evaluate(() => document.querySelector(".tray-draw")?.click());
await frames();
await p.mouse.move(pts[0][0], pts[0][1]);
await p.mouse.down();
for (let i = 1; i < pts.length; i++) {
  const [ax, ay] = pts[i - 1];
  const [bx, by] = pts[i];
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
  for (let k = 1; k <= n; k++) await p.mouse.move(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
}
const drawn = await p.evaluate(() => (window.woodrail.interaction.draw.line?.pieces ?? []).map((q) => `${q.type}@${q.y}${q.blocked ? "(red)" : ""}`));
await snap("tunnels-phone-draw.jpg");
await p.mouse.up();
await settle();
await p.evaluate(() => document.querySelector(".tray-draw")?.click());
await p.keyboard.press("Escape");
const drew = (await pieces()).filter((q) => !was2.some((o) => o.id === q.id));
check(
  "draw across a hill a level high: under it (two short mouths, track a level under), not over",
  drew.filter((q) => q.type === "tunnel-mouth-short").length === 2 && !drew.some((q) => q.type === "ramp") && drew.some((q) => q.y === -48),
  JSON.stringify({ drawn, laid: drew.map((q) => `${q.type}@${q.y}`) }),
);

// 6. Costs, and idle.
const costs = await p.evaluate(async ({ face, Z }) => {
  const w = window.woodrail;
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { findTunnels } = await import("/src/render/tunnels-view.ts");
  const { buildStressLayout } = await import("/src/track/stress-layout.ts");
  const rules = w.interaction.rules;
  const time = (f, n) => {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) f(i);
    return Math.round(((performance.now() - t0) / n) * 1000) / 1000;
  };
  const held = time((i) => trackBlock(rules, "straight-216", false, { x: face - 100 + (i % 9), z: Z + 300, heading: 0 }, -48, -1), 200);
  const onFelt = time((i) => trackBlock(rules, "straight-216", false, { x: face - 600 + (i % 9), z: Z, heading: 0 }, 0, -1), 200);
  const { layout } = buildStressLayout(100);
  // (Laid over the map, so some of it is near hills.)
  const big = time(() => findTunnels(layout, w.landscape), 5);
  const mine = time(() => findTunnels(w.layout, w.landscape), 20);
  return { held, onFelt, big, bigPieces: [...layout.pieceIds()].length, mine, minePieces: [...w.layout.pieceIds()].length };
}, { face: setup.one.face, Z });
console.log(`costs (ms): ${JSON.stringify(costs)}`);
check("the rules for a piece held near a tunnel take well under a few ms (a pointer move)", costs.held < 2 && costs.onFelt < 2, JSON.stringify(costs));
check("the tunnels found again on a large layout (1,100 pieces) take a few ms at most", costs.big < 15, JSON.stringify(costs));
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await w.settled(3);
  const before = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 2000));
  return w.framesDrawn - before;
});
check("idle: no frames drawn in 2 s with tunnels, portals and a train standing", idle === 0, `${idle} frames`);

console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await b.close();
await server.close();
process.exit(failed.length ? 1 : 0);
