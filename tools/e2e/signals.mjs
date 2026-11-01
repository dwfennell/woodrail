// End-to-end: signals the player places (docs/superpowers/specs/2026-10-31-signals.md §10.2), Game mode on a 390×844
// phone with touch. Setup learns Switches, Signals and Routes and lays a line from the first town's station to the
// forest with the game's own pathfinder (named shortcuts: not what's tested). Then, all by the player's touches:
//   1-2. The Signal dragged from the Switch shelf onto the line, along it the way trains go: the ghost snaps to a joint
//        facing that way, the blocks are tinted (an overlay mesh shown), each pointer move costs under 1 ms (median).
//   3. Let go: on that joint, the tint gone. A long press on its post: its card, the tint back; Turn round turns it
//      (its post crosses the track), and back. A tap holds it at red, another lets it go. The Signal tool: tapped in
//      the tray, a tap on the track puts another down; tapped again, it's put away. Undo takes the last one away.
//
// Usage: npm run e2e:signals [-- <out dir>]   (default out: e2e-out/signals)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/signals";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5396, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
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
/** A tap, then its click seen (the click shield counts it too) and a frame after. */
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 30000 }).catch(() => {});
  await frames();
};
/** Stamped touches (each with when it happens: a slow machine delivers them late). */
const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
/** A world point's place on screen (CSS px). */
const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
const glideTo = async (v, dist = 900) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2 }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
/** A card's chip by its text, once drawn and still past the card tap guard. */
const tapChip = async (text) => {
  await p.waitForFunction((t) => [...document.querySelectorAll(".piece-card .lever-chip")].some((e) => e.getBoundingClientRect().width > 0 && e.textContent === t), text, { timeout: 20000 });
  await frames();
  await p.waitForTimeout(400);
  const [x, y] = await p.evaluate((t) => {
    const r = [...document.querySelectorAll(".piece-card .lever-chip")].find((e) => e.getBoundingClientRect().width > 0 && e.textContent === t).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, text);
  await tapped(() => p.touchscreen.tap(x, y));
};
const tapAt = (x, y) => tapped(() => p.touchscreen.tap(x, y));
const marks = () => p.evaluate(() => [...window.woodrail.layout.signals()].map((m) => ({ id: m.id, at: m.at, held: m.held, style: m.style })));
const tintShown = () => p.evaluate(() => window.woodrail.blockTint.mesh.visible && (window.woodrail.blockTint.mesh.geometry.getAttribute("position")?.count ?? 0) > 0);

// A new game.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// Setup (not what's tested): Switches, Signals and Routes learned; the station's line to the forest laid by the game's
// own pathfinder. The joint to put the signal on: in the middle of the line, between two pieces of plain track.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef, pieceOfRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  for (const r of ["switches", "signals", "routes"]) w.learn(r);
  const town = w.world.landscape.towns[0].id;
  const station = w.world.stations.get(town);
  const forest = [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === "depot-forest");
  if (forest === undefined) return { error: "no forest" };
  const before = new Set(w.layout.pieceIds());
  let line = null;
  for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
    const r = play(w.world.layout, w.editor(), connectorRef(station, i), connectorRef(forest, j), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 });
    if (r.ok) {
      line = [...w.layout.pieceIds()].filter((id) => !before.has(id));
      break;
    }
  }
  if (!line) return { error: "no line to the forest" };
  // (Two pieces joined end to end, both with one path, in the middle of the line: the approach piece and the next.)
  const plain = (id) => w.layout.getPiece(id).type.startsWith("straight") || w.layout.getPiece(id).type.startsWith("curve");
  const pairs = [];
  for (const a of line) {
    if (!plain(a)) continue;
    for (const c of [0, 1]) {
      const o = w.layout.joinedConnector(connectorRef(a, c));
      if (o === -1) continue;
      const bId = pieceOfRef(o);
      if (line.includes(bId) && plain(bId)) pairs.push({ a, c, b: bId });
    }
  }
  if (pairs.length === 0) return { error: "no joint between plain pieces" };
  const pick = pairs[Math.floor(pairs.length / 2)];
  const at = connectorRef(pick.a, pick.c);
  const { jointPose } = await import("/src/game/signal-place.ts");
  const j = jointPose(w.layout, at);
  w.invalidate();
  return { at, a: pick.a, b: pick.b, joint: j, laid: line.length, second: pairs[Math.floor(pairs.length / 4)] };
});
check("setup: a line from the station to the forest, a joint mid-way", !setup.error, JSON.stringify(setup));
if (!setup.error) {
  const { at, joint } = setup;
  await glideTo(joint, 800);
  await settle();
  await shot("0-line");

  // 1-2. The Signal dragged from the Switch shelf along the line the way trains go (toward the joint), and held there.
  const opened = await p.evaluate(() => {
    const groups = [...document.querySelectorAll(".scroller .tray-group")];
    const g = groups.find((b) => b.querySelector(".label")?.textContent === "Switch");
    if (!g) return null;
    g.scrollIntoView({ inline: "center" });
    const r = g.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  check("the Switch shelf is on the tray", !!opened);
  if (opened) await tapAt(...opened);
  await p.evaluate(() => document.querySelector('.scroller .tray-item[data-key="signal"]')?.scrollIntoView({ inline: "center" }));
  await frames();
  const from = await p.evaluate(() => {
    const e = document.querySelector('.scroller .tray-item[data-key="signal"]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  check("the Signal is on the Switch shelf", !!from, from ? "" : JSON.stringify(await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item")].map((e) => e.dataset.key ?? e.querySelector(".label")?.textContent))));
  // (On touch a held thing rides 56 px above the finger: the finger goes that far below the track.)
  const back = { x: joint.x - Math.cos(joint.heading) * 120, y: joint.y, z: joint.z - Math.sin(joint.heading) * 120 };
  const near = { x: joint.x - Math.cos(joint.heading) * 30, y: joint.y, z: joint.z - Math.sin(joint.heading) * 30 };
  const [bx, by] = await screenOf(back);
  const [nx, ny] = await screenOf(near);
  let held = null;
  if (from) {
    await p.evaluate(() => (window.woodrail.interaction.signalMoveMs.length = 0));
    let t = Date.now() / 1000;
    await touch("touchStart", from[0], from[1], t);
    for (let k = 1; k <= 12; k++) await touch("touchMove", from[0] + ((bx - from[0]) * k) / 12, from[1] + ((by + 56 - from[1]) * k) / 12, (t += 0.03));
    // Along the line toward the joint, the way trains will go.
    for (let k = 1; k <= 10; k++) await touch("touchMove", bx + ((nx - bx) * k) / 10, by + 56 + ((ny - by) * k) / 10, (t += 0.03));
    await frames();
    held = await p.evaluate(() => {
      const w = window.woodrail;
      const m = w.interaction.mode;
      const ms = [...w.interaction.signalMoveMs].sort((a, b) => a - b);
      return { kind: m.kind, target: m.target, ghost: m.ghost?.visible, tint: w.blockTint.mesh.visible && (w.blockTint.mesh.geometry.getAttribute("position")?.count ?? 0) > 0, moves: ms.length, median: ms[Math.floor(ms.length / 2)], worst: ms[ms.length - 1] };
    });
    await shot("1-held");
    check("held over the line: the ghost snaps to the joint, facing the way the finger went", held.kind === "drag-signal" && held.ghost && held.target === at, JSON.stringify({ ...held, at }));
    check("the blocks are tinted while it's held (an overlay mesh shown)", held.tint === true);
    check("each pointer move placing it costs under 1 ms (median)", held.moves >= 10 && held.median < 1, JSON.stringify({ moves: held.moves, median: held.median, worst: held.worst }));
    await touch("touchEnd", 0, 0, (t += 0.05));
    await settle();
  }

  // 3. Let go: on that joint, the tint gone.
  const placed = await marks();
  check("let go: a signal on that joint", placed.length === 1 && placed[0].at === at, JSON.stringify(placed));
  check("…and the tint is gone", !(await tintShown()));
  await shot("2-placed");
  const id = placed[0]?.id;
  if (id !== undefined) {
    const post = async () => p.evaluate((id) => window.woodrail.marksView.topOf(id), id);
    const top0 = await post();
    // A long press on its post: its card, and its blocks tinted.
    const [px, py] = await screenOf({ x: top0.x, y: top0.y - 20, z: top0.z });
    let t = Date.now() / 1000;
    await touch("touchStart", px, py, t);
    await p.waitForTimeout(800);
    await frames();
    await touch("touchEnd", 0, 0, Date.now() / 1000);
    await frames();
    const card = await p.evaluate(() => document.querySelector(".piece-card:not([hidden]) .card-title")?.textContent ?? null);
    check("a long press on its post opens its card", card === "Signal: guards this way →", JSON.stringify(card));
    check("…with its blocks tinted", await tintShown());
    await shot("3-card");
    // Turn round: it guards the other way (its post on the other side of the track), then back.
    await tapChip("Turn round");
    const turned = await marks();
    const top1 = await post();
    check("Turn round: it faces the other way on the same joint", turned[0]?.at !== at && (await p.evaluate(([a, b]) => window.woodrail.layout.joinedConnector(a) === b, [at, turned[0]?.at])), JSON.stringify(turned));
    check("…its post crossed the track", top1 && Math.hypot(top1.x - top0.x, top1.z - top0.z) > 30, JSON.stringify({ top0, top1 }));
    await shot("4-turned");
    await tapChip("Turn round");
    check("Turn round again: back as it was", (await marks())[0]?.at === at);
    // Closed (Escape, as the card's close): the tint goes.
    await p.keyboard.press("Escape");
    await p.evaluate(() => window.woodrail.hud.hideCards?.());
    await p.evaluate(() => window.woodrail.interaction.clearSelection());
    await frames();
    check("its card closed: the tint is gone", !(await tintShown()));

    // A tap on its post holds it at red; another lets it go.
    const [qx, qy] = await screenOf({ x: top0.x, y: top0.y - 20, z: top0.z });
    await tapAt(qx, qy);
    await p.waitForTimeout(500);
    check("a tap on its post holds it at red", (await marks())[0]?.held === true && (await p.evaluate((id) => !window.woodrail.sim.markClear(id), id)));
    await shot("5-held");
    await p.waitForTimeout(500);
    await tapAt(qx, qy);
    await p.waitForTimeout(500);
    check("another tap lets it go", (await marks())[0]?.held === false);
  }

  // The Signal tool: tapped in the tray, a tap on the track puts one down; tapped again, it's put away.
  const item = await p.evaluate(() => {
    const e = document.querySelector('.scroller .tray-item[data-key="signal"]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  if (item) {
    await tapAt(...item);
    check("a tap on the Signal in the tray: the Signal tool is on", await p.evaluate(() => window.woodrail.interaction.signalToolOn));
    const second = await p.evaluate(async (s) => {
      const { jointPose } = await import("/src/game/signal-place.ts");
      const { connectorRef } = await import("/src/track/layout.ts");
      const j = jointPose(window.woodrail.layout, connectorRef(s.a, s.c));
      // (A little short of the joint, on the approach piece.)
      return { x: j.x - Math.cos(j.heading) * 40, y: j.y, z: j.z - Math.sin(j.heading) * 40 };
    }, setup.second);
    await glideTo(second, 800);
    await settle();
    const [sx, sy] = await screenOf(second);
    await tapAt(sx, sy);
    await p.waitForTimeout(300);
    check("…a tap on the track puts another signal down", (await marks()).length === 2, JSON.stringify(await marks()));
    await shot("6-tool");
    // A drag along the track with the tool on: a signal at joints a train's length or more apart, one undo step.
    const run = await p.evaluate(async (s) => {
      const { jointPose } = await import("/src/game/signal-place.ts");
      const { connectorRef, pieceOfRef, indexOfRef } = await import("/src/track/layout.ts");
      const w = window.woodrail;
      // (Along the line from the first signal's joint, ten pieces on: each piece's far joint.)
      const pts = [];
      let ref = w.layout.joinedConnector(connectorRef(s.a, s.c));
      for (let k = 0; k < 10 && ref !== -1; k++) {
        const id = pieceOfRef(ref);
        const def = w.layout.getPiece(id);
        if (!def) break;
        const out = connectorRef(id, 1 - indexOfRef(ref));
        const j = jointPose(w.layout, out);
        if (!j || w.layout.joinedConnector(out) === -1) break;
        pts.push({ x: j.x, y: j.y, z: j.z });
        ref = w.layout.joinedConnector(out);
      }
      return pts;
    }, { a: setup.a, c: await p.evaluate((at) => at % 8, at) });
    if (run.length >= 4) {
      const mid = run[Math.floor(run.length / 2)];
      await glideTo(mid, 1700);
      await settle();
      const scr = [];
      for (const v of run) scr.push(await screenOf(v));
      const before = (await marks()).length;
      let t = Date.now() / 1000;
      await touch("touchStart", scr[0][0], scr[0][1], t);
      for (let i = 1; i < scr.length; i++) for (let k = 1; k <= 6; k++) await touch("touchMove", scr[i - 1][0] + ((scr[i][0] - scr[i - 1][0]) * k) / 6, scr[i - 1][1] + ((scr[i][1] - scr[i - 1][1]) * k) / 6, (t += 0.03));
      await touch("touchEnd", 0, 0, (t += 0.05));
      await settle();
      const after = (await marks()).length;
      check("a drag along the track with the Signal tool: signals at joints along it", after - before >= 2, JSON.stringify({ before, after, joints: run.length }));
      await shot("7-run");
      // (Put away by a tap on it in the tray; Undo, as for a ready piece, would put it away too.)
      await tapAt(...item);
      check("…tapped again, the Signal tool is put away", !(await p.evaluate(() => window.woodrail.interaction.signalToolOn)));
      const undoAt = await p.evaluate(() => {
        const r = document.querySelector('button[aria-label="Undo (Ctrl+Z)"]').getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      });
      await tapAt(...undoAt);
      await p.waitForTimeout(300);
      check("…one Undo takes the whole run away", (await marks()).length === before, JSON.stringify(await marks()));
    } else check("a run of joints along the line to drag over", false, JSON.stringify(run));
    // Undo (the toolbar's): the last one taken away.
    const undo = await p.evaluate(() => {
      const e = document.querySelector('button[aria-label="Undo (Ctrl+Z)"]');
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    if (undo) await tapAt(...undo);
    await p.waitForTimeout(300);
    check("Undo takes the last signal away", (await marks()).length === 1, JSON.stringify(await marks()));
  }
}
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
