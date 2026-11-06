// End-to-end: signals the player places (docs/superpowers/specs/2026-10-31-signals.md §10.2), Game mode on a 390×844
// phone with touch. Setup learns Switches, Signals and Routes and lays a line from the first town's station to the
// forest with the game's own pathfinder (named shortcuts: not what's tested). Then, all by the player's touches:
//   1-2. The Signal dragged from the Switch shelf onto the line, along it the way trains go: the ghost snaps to a joint
//        facing that way, the blocks are tinted (an overlay mesh shown), each pointer move costs under 1 ms (median).
//   3. Let go: on that joint, the tint gone. A long press on its post: its card, the tint back; Turn round turns it
//      (its post crosses the track), and back. A tap opens its card too (as any piece's); Always red holds it, Auto
//      lets it go (signals audit U5: a tap used to hold it, and the card took a long press). The Signal tool: tapped in
//      the tray, a tap on the track puts another down; tapped again, it's put away. Undo takes the last one away.
//
// Usage: npm run e2e:signals [-- <out dir>]   (default out: e2e-out/signals)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/signals";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5396, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks held still: this counts idle frames, and a clock in view draws one at each minute; e2e:station-clock tests that.)
pinClocksIn(b);
// (Industries' axes and saws held still: not what this tests, and in view they keep `settled()` and idle counts waiting.)
stillIndustriesIn(b);
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
const tapChip = async (text, sel = ".lever-chip") => {
  await p.waitForFunction(([t, sel]) => [...document.querySelectorAll(`.piece-card ${sel}`)].some((e) => e.getBoundingClientRect().width > 0 && e.textContent === t), [text, sel], { timeout: 20000 });
  await frames();
  await p.waitForTimeout(400);
  const [x, y] = await p.evaluate(([t, sel]) => {
    const r = [...document.querySelectorAll(`.piece-card ${sel}`)].find((e) => e.getBoundingClientRect().width > 0 && e.textContent === t).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, [text, sel]);
  await tapped(() => p.touchscreen.tap(x, y));
};
const tapAt = (x, y) => tapped(() => p.touchscreen.tap(x, y));
const marks = () => p.evaluate(() => [...window.woodrail.layout.signals()].map((m) => ({ id: m.id, at: m.at, held: m.held, style: m.style })));
const tintShown = () => p.evaluate(() => window.woodrail.blockTint.mesh.visible && (window.woodrail.blockTint.mesh.geometry.getAttribute("position")?.count ?? 0) > 0);

/** Into Game mode from the title (a new game, or the saved one after a reload). */
const start = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
};
/**
 * The Signal dragged out of the Switch shelf (opened if it isn't) and along the track toward a joint, the way trains
 * go, then let go: the joint end it went on (−1: none).
 */
const dragSignal = async (joint) => {
  const shelf = await p.evaluate(() => {
    // (The shelf open already: the Signal's on the tray.)
    if (document.querySelector('.scroller .tray-item[data-key="signal"]')) return null;
    const g = [...document.querySelectorAll(".scroller .tray-group")].find((b) => b.querySelector(".label")?.textContent === "Signals");
    if (!g) return null;
    g.scrollIntoView({ inline: "center" });
    const r = g.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  if (shelf) await tapAt(...shelf);
  await p.evaluate(() => document.querySelector('.scroller .tray-item[data-key="signal"]')?.scrollIntoView({ inline: "center" }));
  await frames();
  const from = await p.evaluate(() => {
    const e = document.querySelector('.scroller .tray-item[data-key="signal"]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  if (!from) return -1;
  const before = new Set((await marks()).map((m) => m.id));
  const [bx, by] = await screenOf({ x: joint.x - Math.cos(joint.heading) * 120, y: joint.y, z: joint.z - Math.sin(joint.heading) * 120 });
  const [nx, ny] = await screenOf({ x: joint.x - Math.cos(joint.heading) * 30, y: joint.y, z: joint.z - Math.sin(joint.heading) * 30 });
  let t = Date.now() / 1000;
  await touch("touchStart", from[0], from[1], t);
  for (let k = 1; k <= 12; k++) await touch("touchMove", from[0] + ((bx - from[0]) * k) / 12, from[1] + ((by + 56 - from[1]) * k) / 12, (t += 0.03));
  for (let k = 1; k <= 10; k++) await touch("touchMove", bx + ((nx - bx) * k) / 10, by + 56 + ((ny - by) * k) / 10, (t += 0.03));
  await frames();
  await touch("touchEnd", 0, 0, (t += 0.05));
  await settle();
  return (await marks()).find((m) => !before.has(m.id))?.at ?? -1;
};

// A new game.
await p.goto(PAGE);
await start();
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// Setup (not what's tested): Switches, Signals and Routes learned; the station's line to the forest laid by the game's
// own pathfinder. The joint to put the signal on: in the middle of the line, between two pieces of plain track.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef, pieceOfRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  for (const r of ["switches", "routes"]) w.learn(r);
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

  // 1-2. The Signal dragged from its own Signals shelf along the line the way trains go (toward the joint), and held there.
  const opened = await p.evaluate(() => {
    const groups = [...document.querySelectorAll(".scroller .tray-group")];
    const g = groups.find((b) => b.querySelector(".label")?.textContent === "Signals");
    if (!g) return null;
    g.scrollIntoView({ inline: "center" });
    const r = g.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  check("the Signals shelf is on the tray", !!opened);
  if (opened) await tapAt(...opened);
  await p.evaluate(() => document.querySelector('.scroller .tray-item[data-key="signal"]')?.scrollIntoView({ inline: "center" }));
  await frames();
  const from = await p.evaluate(() => {
    const e = document.querySelector('.scroller .tray-item[data-key="signal"]');
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  // (Its picture is the signal (a post with red and green lamps), drawn as the pieces' are: not a track piece.)
  const tile = await p.waitForFunction(() => {
    const items = [...document.querySelectorAll(".scroller .tray-item:not(.tray-back)")];
    const e = document.querySelector('.scroller .tray-item[data-key="signal"]');
    return e && e.querySelector("img") ? { first: items[0] === e, src: e.querySelector("img").src.length } : null;
  }, null, { timeout: 30000 }).then((h) => h.jsonValue()).catch(() => null);
  check("the Signal is first on its own shelf, its picture drawn", !!tile?.first && tile.src > 100, JSON.stringify(tile));
  await shot("0b-tray-signals");
  check("the Signal is on the Signals shelf", !!from, from ? "" : JSON.stringify(await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item")].map((e) => e.dataset.key ?? e.querySelector(".label")?.textContent))));
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
      const post = (n) => m.ghost?.getObjectByName(n);
      const p0 = post("post0")?.position;
      const p1 = post("post1")?.position;
      return { kind: m.kind, target: m.target, ghost: m.ghost?.visible, both: !!post("post1")?.visible, across: p0 && p1 ? Math.hypot(p0.x - p1.x, p0.z - p1.z) : 0, tint: w.blockTint.mesh.visible && (w.blockTint.mesh.geometry.getAttribute("position")?.count ?? 0) > 0, moves: ms.length, median: ms[Math.floor(ms.length / 2)], worst: ms[ms.length - 1] };
    });
    await shot("1-held");
    check("held over the line: the ghost snaps to the joint, facing the way the finger went", held.kind === "drag-signal" && held.ghost && held.target === at, JSON.stringify({ ...held, at }));
    // (The user: "the preview when moving and placing should always include both".)
    check("…the preview shows both posts of the pair, one each side of the track", held.both && held.across > 30, JSON.stringify({ both: held.both, across: held.across }));
    check("the blocks are tinted while it's held (an overlay mesh shown)", held.tint === true);
    check("each pointer move placing it costs under 1 ms (median)", held.moves >= 10 && held.median < 1, JSON.stringify({ moves: held.moves, median: held.median, worst: held.worst }));
    await touch("touchEnd", 0, 0, (t += 0.05));
    await settle();
  }

  // 3. Let go: a pair on that joint, one each way (the user: lights "on both sides of the track"), the tint gone.
  const placed = await marks();
  const other = await p.evaluate((at) => window.woodrail.layout.joinedConnector(at), at);
  check("let go: a pair on that joint, one each way", placed.length === 2 && placed.some((m) => m.at === at) && placed.some((m) => m.at === other), JSON.stringify({ placed, at, other }));
  const posts = await p.evaluate((ids) => ids.map((id) => window.woodrail.marksView.topOf(id)), placed.map((m) => m.id));
  check("…their posts on both sides of the track", posts.every(Boolean) && Math.hypot(posts[0].x - posts[1].x, posts[0].z - posts[1].z) > 30, JSON.stringify(posts));
  const lit = await p.evaluate((ids) => ids.map((id) => window.woodrail.marksView.shownOf(id)), placed.map((m) => m.id));
  check("…drawn as lamps, lit green with the line clear", lit.every((l) => l?.look === "plain" && l.clear), JSON.stringify(lit));
  check("…and the tint is gone", !(await tintShown()));
  await shot("2-placed");
  const id = placed.find((m) => m.at === at)?.id;
  const partner = placed.find((m) => m.at !== at)?.id;
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
    // (Its title says what it shows now, and why: signals audit U6.)
    check("a long press on its post opens its card", card?.startsWith("Signal · ") === true, JSON.stringify(card));
    check("…with its blocks tinted", await tintShown());
    // Its modes (the user: "auto or forced on or off"): Auto pressed; Always red holds it, Always green lets trains by.
    const modes = async () => p.evaluate((id) => ({ pressed: [...document.querySelectorAll(".piece-card:not([hidden]) .signal-mode")].map((b) => [b.querySelector(".signal-mode-name").textContent, b.getAttribute("aria-pressed")]), mode: window.woodrail.layout.getSignal(id)?.mode, clear: window.woodrail.sim.markClear(id) }), id);
    const m0 = await modes();
    check("its card: Auto, Always red and Always green, Auto pressed", JSON.stringify(m0.pressed) === JSON.stringify([["Auto", "true"], ["Always red", "false"], ["Always green", "false"]]) && m0.mode === "auto", JSON.stringify(m0));
    await shot("3-card");
    await tapChip("Always red", ".signal-mode");
    const m1 = await modes();
    check("Always red: held, shown red, pressed", m1.mode === "red" && !m1.clear && m1.pressed[1][1] === "true" && (await p.evaluate((id) => window.woodrail.marksView.shownOf(id)?.clear === false, id)), JSON.stringify(m1));
    await shot("3b-card-red");
    await tapChip("Always green", ".signal-mode");
    const m2 = await modes();
    check("Always green: shown green, pressed", m2.mode === "green" && m2.clear && m2.pressed[2][1] === "true", JSON.stringify(m2));
    await tapChip("Auto", ".signal-mode");
    check("…and back to Auto", (await modes()).mode === "auto");
    // The set moved by a drag on its post (the user: "signal sets should move together"): both picked up, the preview
    // showing both, and both put down on another joint, one each side; one Undo puts both back. (On touch a drag moves a
    // signal while its card is open, as it is here from the long press; else it pans.)
    check("its card is open (a drag on its post then moves it)", await p.evaluate((id) => window.woodrail.interaction.selectedMark === id, id));
    const dest = await p.evaluate(async (at) => {
      const { jointPose } = await import("/src/game/signal-place.ts");
      const { connectorRef, pieceOfRef, indexOfRef } = await import("/src/track/layout.ts");
      const L = window.woodrail.layout;
      // (Two pieces on along the line, the way it guards: that piece's far end.)
      let ref = at;
      for (let k = 0; k < 2; k++) {
        const next = L.joinedConnector(ref);
        if (next === -1) return null;
        ref = connectorRef(pieceOfRef(next), 1 - indexOfRef(next));
      }
      if (L.joinedConnector(ref) === -1 || L.signalAt(ref) || L.signalAt(L.joinedConnector(ref))) return null;
      const j = jointPose(L, ref);
      return { at: ref, x: j.x, y: j.y, z: j.z, heading: j.heading };
    }, at);
    if (dest) {
      // (Framed on both joints, so the picture shows the set's ghost where it's going.)
      const from0 = await post();
      await glideTo({ x: (from0.x + dest.x) / 2, y: 0, z: (from0.z + dest.z) / 2 }, 1100);
      await settle();
      const top = await post();
      const [sx, sy] = await screenOf({ x: top.x, y: top.y - 20, z: top.z });
      const [ex, ey] = await screenOf({ x: dest.x - Math.cos(dest.heading) * 30, y: dest.y, z: dest.z - Math.sin(dest.heading) * 30 });
      let t = Date.now() / 1000;
      await touch("touchStart", sx, sy, t);
      for (let k = 1; k <= 16; k++) await touch("touchMove", sx + ((ex - sx) * k) / 16, sy + ((ey + 56 - sy) * k) / 16, (t += 0.03));
      await frames();
      const moving = await p.evaluate((ids) => {
        const w = window.woodrail;
        const m = w.interaction.mode;
        const post = (n) => m.ghost?.getObjectByName(n);
        return { kind: m.kind, moving: m.moving, target: m.target, ghost: !!m.ghost?.visible, both: !!post("post1")?.visible, hidden: [...w.marksView.hidden].sort(), want: [...ids].sort(), drawn: ids.map((i) => !!w.marksView.topOf(i)) };
      }, [id, partner]);
      await shot("2c-moving-pair");
      check("picked up by a drag on its post: both signals in the hand, neither drawn where they were", moving.kind === "drag-signal" && JSON.stringify(moving.hidden) === JSON.stringify(moving.want) && moving.drawn.every((d) => !d), JSON.stringify(moving));
      check("…the moving preview shows both posts", moving.ghost && moving.both && moving.target === dest.at, JSON.stringify({ ...moving, dest: dest.at }));
      await touch("touchEnd", 0, 0, (t += 0.05));
      await settle();
      const after = await p.evaluate(([id, partner, at]) => {
        const L = window.woodrail.layout;
        return { a: L.getSignal(id)?.at, b: L.getSignal(partner)?.at, joined: L.joinedConnector(L.getSignal(id)?.at ?? -1), oldA: !!L.signalAt(at), oldB: !!L.signalAt(L.joinedConnector(at)), count: L.signalCount };
      }, [id, partner, at]);
      check("let go: both moved to the new joint, one each side, none left where they were", after.a === dest.at && after.b === after.joined && !after.oldA && !after.oldB && after.count === 2, JSON.stringify({ ...after, dest: dest.at }));
      await shot("2d-moved-pair");
      const undoAt = await p.evaluate(() => {
        const r = document.querySelector('button[aria-label="Undo (Ctrl+Z)"]').getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      });
      await tapAt(...undoAt);
      await p.waitForTimeout(300);
      const back = await p.evaluate(([id, partner, at]) => {
        const L = window.woodrail.layout;
        return { a: L.getSignal(id)?.at, b: L.getSignal(partner)?.at, other: L.joinedConnector(at) };
      }, [id, partner, at]);
      check("…one Undo puts both back", back.a === at && back.b === back.other, JSON.stringify({ ...back, at }));
    } else check("a joint two pieces on to move the pair to", false);
    // The pair from the side this one faces (its lamps toward its trains): it held red, its partner beside it green.
    // (Setup for the picture: the mode set as its card sets it, the card closed, the view turned round the joint.)
    await p.evaluate((id) => {
      const w = window.woodrail;
      w.sim.setMarkMode(id, "red");
      w.hud.hideCards?.();
      w.interaction.clearSelection();
      const t = w.controls.target;
      w.__camWas = w.camera.position.clone();
      w.camera.position.set(2 * t.x - w.camera.position.x, w.camera.position.y, 2 * t.z - w.camera.position.z);
      w.camera.lookAt(t);
      w.controls.update();
      w.invalidate();
    }, id);
    await settle();
    const pair = await p.evaluate((ids) => ids.map((i) => window.woodrail.marksView.shownOf(i)?.clear), [id, partner]);
    check("the pair: one held red, the other green", pair[0] === false && pair[1] === true, JSON.stringify(pair));
    await shot("3c-pair-red-green");
    await p.evaluate((id) => {
      const w = window.woodrail;
      w.sim.setMarkMode(id, "auto");
      w.camera.position.copy(w.__camWas);
      w.camera.lookAt(w.controls.target);
      w.controls.update();
      w.interaction.selectMark(id);
      w.invalidate();
    }, id);
    await settle();
    // (Setup for Turn round, not what's tested: its partner taken away, so the other way is free.)
    if (partner !== undefined) await p.evaluate((id) => window.woodrail.editor().removeSignal(id), partner);
    await frames();
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

    // A tap on its post opens its card (signals audit U5); Always red holds it at red, Auto lets it go.
    const [qx, qy] = await screenOf({ x: top0.x, y: top0.y - 20, z: top0.z });
    await tapAt(qx, qy);
    await p.waitForTimeout(500);
    const tapCard = await p.evaluate(() => document.querySelector(".piece-card:not([hidden]) .card-title")?.textContent ?? null);
    check("a tap on its post opens its card (and holds nothing)", tapCard?.startsWith("Signal · ") === true && (await marks())[0]?.held === false, JSON.stringify(tapCard));
    await tapChip("Always red", ".signal-mode");
    await p.waitForTimeout(300);
    const heldTitle = await p.evaluate(() => document.querySelector(".piece-card:not([hidden]) .card-title")?.textContent ?? null);
    check("Always red on it holds it at red, and its title says so", (await marks())[0]?.held === true && (await p.evaluate((id) => !window.woodrail.sim.markClear(id), id)) && heldTitle === "Signal · red: held here", JSON.stringify(heldTitle));
    await shot("5-held");
    await tapChip("Auto", ".signal-mode");
    await p.waitForTimeout(300);
    check("Auto lets it go", (await marks())[0]?.held === false);
    await p.evaluate(() => window.woodrail.hud.hideCards?.());
    await p.evaluate(() => window.woodrail.interaction.clearSelection());
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
    check("…a tap on the track puts another pair down", (await marks()).length === 3, JSON.stringify(await marks()));
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
    check("Undo takes the last pair away", (await marks()).length === 1, JSON.stringify(await marks()));
  }
}
// 6. Idle with signals placed and the game paused: no frames drawn; and a few draws however many (signals spec §5).
if (!setup.error) {
  const more = await p.evaluate(async () => {
    const w = window.woodrail;
    const { connectorRef } = await import("/src/track/layout.ts");
    // (Harness shortcuts: more marks on the line's joints, by the editor as a drop would, in each style; the game paused
    // as the toolbar's pause would.)
    const styles = ["plain", "semaphore", "colour-light"];
    let n = 0;
    for (const id of [...w.layout.pieceIds()]) {
      if (n >= 12) break;
      for (const c of [0, 1]) {
        const at = connectorRef(id, c);
        if (w.layout.joinedConnector(at) === -1 || w.layout.signalAt(at) || w.layout.signalAt(w.layout.joinedConnector(at))) continue;
        const m = w.editor().addSignal(at, styles[n % 3]);
        if (m !== -1) n++;
        break;
      }
    }
    w.paused = true;
    w.invalidate();
    return { n, count: w.layout.signalCount };
  });
  // (The kits' models load, the arms glide to their aspects: then nothing.)
  await p.waitForTimeout(3000);
  await settle();
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(4000);
  const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
  check("paused, with signals placed: no frames drawn while idle", f1 === f0, JSON.stringify({ ...more, f0, f1 }));
  const draws = await p.evaluate(() => window.woodrail.marksView.drawCalls);
  check("signals drawn instanced: a few draws for them all", draws > 0 && draws <= 24, JSON.stringify({ draws, marks: more.count }));
  await shot("8-styles");
}
// 4-5. The payoff, on a line of two trains between two loops (setup, harness shortcuts: laid on the flat table past
// the land's edge, depots, trains and their line made by the economy's own functions, as a player's taps would; the
// game's own sim and economy ticked ahead of SwiftShader's few frames a second, the forest kept stocked).
if (!setup.error) {
  const line = await p.evaluate(async () => {
    const w = window.woodrail;
    const { chain, loopOn } = await import("/src/economy/loop-fixtures.ts");
    const { appendPiece, connectorRef } = await import("/src/track/index.ts");
    const { editLine, joinLine } = await import("/src/game/lines.ts");
    const { CARGO } = await import("/src/economy/cargo.ts");
    const { PILE_CAP } = await import("/src/economy/constants.ts");
    // (Clear what parts 1-3 and 6 left: their marks, so the payoff's run is about this line's signal only.)
    for (const m of [...w.layout.signals()]) w.layout.removeSignal(m.id);
    const b = w.director.bounds;
    const S = "straight-216";
    const x0 = b.x0 + 260;
    const z = b.z1 - 260;
    const [a] = [w.layout.addPiece("depot-forest", { x: x0, z, heading: 0 })];
    appendPiece(w.layout, "buffer-turnback", false, connectorRef(a, 0));
    const [w1] = chain(w.layout, [S], connectorRef(a, 1));
    const l1 = loopOn(w.layout, connectorRef(w1, 1), [S, S], [S]);
    const mid = chain(w.layout, Array(10).fill(S), connectorRef(l1.s2, 0));
    const l2 = loopOn(w.layout, connectorRef(mid[9], 1), [S, S], [S]);
    const [e1, bb] = chain(w.layout, [S, "depot-sawmill"], connectorRef(l2.s2, 0));
    appendPiece(w.layout, "buffer-turnback", false, connectorRef(bb, 1));
    const forest = w.economy.addDepot("forest", a).id;
    const mill = w.economy.addDepot("sawmill", bb).id;
    const put = (pieceId) => {
      const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, reversed: false, s: 60 });
      if (r.kind !== "placed") return -1;
      const e = w.sim.getTrain(r.trainId).cars[0].id;
      w.sim.setLever(e, 1);
      return e;
    };
    const starts = [mid[1], l1.main[0]];
    window.__lineTrains = () => {
      for (const e of window.__engines ?? []) {
        const t = w.sim.findCar(e)?.train;
        if (t) w.sim.removeTrain(t.id);
      }
      w.economy.prune();
      const engines = starts.map(put);
      const red = editLine(w.economy, engines[0], (s) => s.push({ depotId: forest, action: "auto" }, { depotId: mill, action: "auto" }));
      joinLine(w.economy, engines[1], red.id);
      for (const e of engines) w.economy.routeOf(e).next = 1;
      window.__engines = engines;
      w.invalidate();
      return engines;
    };
    // Ticks run ahead: goods unloaded at the mill by each engine's train, and ticks both trains ran in the long stretch.
    window.__lineRun = (secs) => {
      const out = { unloaded: 0, together: 0, arrived: {}, firstAtMill: {} };
      const engines = window.__engines;
      const onMid = (e) => {
        const t = w.sim.findCar(e)?.train;
        return !!t && t.speed > 1 && t.bogies.some((x) => mid.includes(x.pieceId));
      };
      for (let i = 0; i < secs * 120; i++) {
        // (The forest kept stocked and the mill's yard cleared, so neither run is held up by the other's goods.)
        if (i % 120 === 0) {
          w.economy.depot(forest).piles[CARGO.log.index] = PILE_CAP;
          w.economy.depot(mill).piles[CARGO.log.index] = 0;
        }
        const before = engines.map((e) => w.economy.routeOf(e)?.at ?? false);
        w.sim.tick();
        w.economy.tick();
        for (const ev of w.economy.drainEvents()) if (ev.kind === "unloaded" && ev.depotId === mill) out.unloaded++;
        engines.forEach((e, k) => {
          if (!before[k] && w.economy.routeOf(e)?.at) {
            out.arrived[k] = (out.arrived[k] ?? 0) + 1;
            const r = w.economy.routeOf(e);
            if (r.stops[r.next]?.depotId === mill && out.firstAtMill[k] === undefined) out.firstAtMill[k] = i / 120;
          }
        });
        if (onMid(engines[0]) && onMid(engines[1])) out.together++;
      }
      w.invalidate();
      return out;
    };
    window.__lineTrains();
    return { mid, joint: (await import("/src/game/signal-place.ts")).jointPose(w.layout, connectorRef(mid[4], 1)), at: connectorRef(mid[4], 1), engines: window.__engines };
  });
  check("setup: a line of two trains between two loops, on the table", line.engines.every((e) => e !== -1), JSON.stringify(line.engines));
  await glideTo(line.joint, 900);
  await settle();
  await shot("9-line");
  // The Signal dragged from the tray onto the middle of the long stretch, along it the way the trains go.
  const placedAt = await dragSignal(line.joint);
  check("4. the Signal dragged onto the middle of the long stretch", placedAt === line.at, JSON.stringify({ placedAt, want: line.at }));
  const withSignal = await p.evaluate(() => window.__lineRun(240));
  check("4. the follower leaves its loop while the leader is still in the stretch", withSignal.together > 120 * 5, JSON.stringify(withSignal));
  check("4. both trains deliver", (withSignal.arrived[0] ?? 0) > 0 && (withSignal.arrived[1] ?? 0) > 0, JSON.stringify(withSignal));
  await shot("10-following");

  // 5. Held at red from its card (a tap on its post, Always red). The next train stops at it, its card says so (with
  // Signal, the line it waits for tinted), and after 5 s that it's held.
  const markId = await p.evaluate((at) => window.woodrail.layout.signalAt(at)?.id ?? -1, line.at);
  const postScreen = async () => {
    const top = await p.evaluate((id) => window.woodrail.marksView.topOf(id), markId);
    await glideTo(top, 900);
    return screenOf({ x: top.x, y: top.y - 20, z: top.z });
  };
  await tapAt(...(await postScreen()));
  await tapChip("Always red", ".signal-mode");
  check("5. a tap on its post and Always red hold it at red", await p.evaluate((id) => window.woodrail.layout.getSignal(id)?.held === true, markId));
  await p.evaluate(() => window.woodrail.hud.hideCards?.());
  await p.evaluate(() => window.woodrail.interaction.clearSelection());
  const stopped = await p.evaluate(() => {
    const w = window.woodrail;
    for (let s = 0; s < 120; s++) {
      window.__lineRun(1);
      for (const e of window.__engines) {
        const t = w.sim.findCar(e)?.train;
        if (t && w.sim.atRedSignal(t.id)) return e;
      }
    }
    return -1;
  });
  check("5. the next train stops at it", stopped !== -1);
  if (stopped !== -1) {
    // (Its engine's card, opened by a tap on the engine, as a player would: its words.)
    const cardText = async () => {
      if (!(await p.evaluate(() => window.woodrail.hud.engineCardOpen))) {
        const mid = await p.evaluate((e) => {
          const t = window.woodrail.sim.findCar(e).train;
          const [a, c] = [t.world[0], t.world[1]];
          return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
        }, stopped);
        await glideTo(mid, 900);
        await tapAt(...(await screenOf(mid)));
        await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
      }
      // (The card's words follow the game: a frame drawn after the ticks.)
      await p.evaluate(() => window.woodrail.invalidate());
      await frames();
      await frames();
      return p.evaluate(() => document.querySelector(".engine-card .engine-status")?.textContent ?? null);
    };
    check("5. its card: waiting at a red signal", (await cardText()) === "Waiting at a red signal", await cardText());
    // (Signal beside the status: the line that signal guards is tinted while the card is open; a tap glides there.)
    const chip = await p.evaluate(() => {
      const b = document.querySelector(".engine-card .show-signal");
      return !!b && !b.hidden && b.getBoundingClientRect().width > 0;
    });
    check("5. its card offers Signal, and the line the signal guards is tinted", chip && (await tintShown()), JSON.stringify({ chip, tint: await tintShown() }));
    await p.evaluate(() => window.__lineRun(6));
    const held = await cardText();
    check("5. after 5 s: waiting at a signal you're holding", held === "Waiting at a signal you're holding at red. Tap it, then Auto", held);
    await p.keyboard.press("Escape");
    await p.evaluate(() => window.woodrail.hud.hideCards?.());
    await tapAt(...(await postScreen()));
    await tapChip("Auto", ".signal-mode");
    await p.evaluate(() => window.woodrail.hud.hideCards?.());
    await p.evaluate(() => window.woodrail.interaction.clearSelection());
    const went = await p.evaluate((e) => {
      const w = window.woodrail;
      const t0 = w.sim.findCar(e).train.bogies[0].pieceId;
      window.__lineRun(10);
      return w.sim.findCar(e).train.bogies[0].pieceId !== t0;
    }, stopped);
    check("5. its card's Auto lets it go: the train goes on", went);
  }

  // 4 (on). The same layout with no signal: removed by taps (the user: "there doesn't seem to be a way to remove signals
  // once they are placed"): a long press on its post, its card's Remove signals, both of the set gone; one Undo brings
  // both back; Remove again. Then the trains put back where they began; fewer goods delivered in the same 4 minutes.
  const openCard = async () => {
    const [lx, ly] = await postScreen();
    const t = Date.now() / 1000;
    await touch("touchStart", lx, ly, t);
    await p.waitForTimeout(800);
    await touch("touchEnd", 0, 0, Date.now() / 1000);
    // (Measured once the card has popped in, not mid-way through its grow.)
    await p.waitForTimeout(600);
    await frames();
    return p.evaluate(() => {
      const e = [...document.querySelectorAll(".piece-card:not([hidden]) button")].find((b) => b.textContent === "Remove signals" && b.getBoundingClientRect().width > 0);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2, r.height];
    });
  };
  const gone = () => p.evaluate((at) => ({ here: !!window.woodrail.layout.signalAt(at), other: !!window.woodrail.layout.signalAt(window.woodrail.layout.joinedConnector(at)), count: window.woodrail.layout.signalCount }), line.at);
  let del = await openCard();
  check("4. its card has Remove signals, a finger's height", !!del && del[2] >= 44, JSON.stringify(del));
  await shot("11-card-remove");
  if (del) {
    await p.waitForTimeout(400);
    await tapAt(del[0], del[1]);
  }
  await p.waitForTimeout(600);
  const g1 = await gone();
  check("4. Remove signals on its card takes the set away, both", !g1.here && !g1.other && g1.count === 0, JSON.stringify(g1));
  const undoBtn = await p.evaluate(() => {
    const r = document.querySelector('button[aria-label="Undo (Ctrl+Z)"]').getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  await tapAt(...undoBtn);
  await p.waitForTimeout(400);
  const g2 = await gone();
  check("4. …one Undo brings both back", g2.here && g2.other && g2.count === 2, JSON.stringify(g2));
  // Clear (the tray's eraser) swept over a post takes the set too, one Undo brings it back.
  const clearBtn = await p.evaluate(() => {
    const e = document.querySelector(".tray-erase");
    if (!e || !e.getBoundingClientRect().width) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  if (clearBtn) {
    await tapAt(...clearBtn);
    const [cx, cy] = await postScreen();
    // (A tap with Clear on, on the post: as a sweep's first point.)
    await tapAt(cx, cy);
    await p.waitForTimeout(400);
    const g3 = await gone();
    const track = await p.evaluate((at) => !!window.woodrail.layout.getPiece(Math.floor(at / 8)), line.at);
    check("4. Clear tapped on a post takes the set away, its track stays", !g3.here && !g3.other && track, JSON.stringify({ ...g3, track }));
    // (Clear put away, then Undo: a player's pause between taps.)
    await p.waitForTimeout(600);
    // (Clear put away by a tap on it, again if the first didn't take, as a player would see it still lit.)
    // (Each measured afresh: the tray and bar can move while Clear is on.)
    const at = (sel) => p.evaluate((sel) => {
      const e = document.querySelector(sel);
      if (!e || !e.getBoundingClientRect().width) return null;
      const r = e.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    }, sel);
    for (let k = 0; k < 2 && (await p.evaluate(() => window.woodrail.interaction.isErasing)); k++) {
      const c = await at(".tray-erase");
      if (c) await tapAt(...c);
      await p.waitForTimeout(600);
    }
    const before = await p.evaluate(() => ({ erasing: window.woodrail.interaction.isErasing, mode: window.woodrail.interaction.mode.kind }));
    check("4. Clear put away", !before.erasing, JSON.stringify(before));
    const u = await at('button[aria-label="Undo (Ctrl+Z)"]');
    if (u) await tapAt(...u);
    await p.waitForTimeout(600);
    const g4 = await gone();
    if (!g4.here) console.log("(after Clear's Undo:", JSON.stringify({ before, mode: await p.evaluate(() => window.woodrail.interaction.mode.kind), history: await p.evaluate(() => document.querySelector('button[aria-label="Undo (Ctrl+Z)"]')?.disabled) }), ")");
    check("4. …one Undo brings both back", g4.here && g4.other, JSON.stringify(g4));
  } else check("4. the tray's Clear", false);
  del = await openCard();
  if (del) {
    await p.waitForTimeout(400);
    await tapAt(del[0], del[1]);
  }
  check("4. removed again: the line has no signal", await p.evaluate((at) => !window.woodrail.layout.signalAt(window.woodrail.layout.joinedConnector(at)) && window.woodrail.layout.signalCount === 0, line.at));
  await p.evaluate(() => window.__lineTrains());
  const without = await p.evaluate(() => window.__lineRun(240));
  const stops = (r) => (r.arrived[0] ?? 0) + (r.arrived[1] ?? 0);
  // (The trains follow each other only while they go the same way: from the start, here. After that they meet and pass
  // at the loops, as without the signal; so the payoff is the follower's delivery coming sooner, and no fewer stops or
  // goods in the 4 minutes. The harness's lineFollowers counts the gain over 30 minutes: 78 stops against 73.)
  check("4. payoff: the follower delivers sooner with the signal", (withSignal.firstAtMill[1] ?? Infinity) < (without.firstAtMill[1] ?? Infinity), JSON.stringify({ with: withSignal.firstAtMill, without: without.firstAtMill }));
  check("4. …and no fewer stops or goods delivered in 4 game minutes", stops(withSignal) >= stops(without) && withSignal.unloaded >= without.unloaded, JSON.stringify({ with: withSignal, without }));
  check("4. without it, never both in the stretch at once", without.together === 0, JSON.stringify(without));
}

// 7. An old save with a semaphore signal piece (a kit skin, no longer on the tray) loads, and its signal still holds a
// train (setup: the piece laid and held, and a train put down before it, as the old tray and a tap would; saved by the
// reload itself, as a player leaving would).
if (!setup.error) {
  const old = await p.evaluate(async () => {
    const w = window.woodrail;
    const { chain } = await import("/src/economy/loop-fixtures.ts");
    const { appendPiece, connectorRef } = await import("/src/track/index.ts");
    const b = w.director.bounds;
    // (Along the other edge of the view's bounds, clear of the payoff's line.)
    const first = w.layout.addPiece("straight-216", { x: b.x0 + 260, z: b.z0 + 260, heading: 0 });
    appendPiece(w.layout, "buffer-turnback", false, connectorRef(first, 0));
    const ids = [first, ...chain(w.layout, ["straight-216", "kit-semaphore-signal", "straight-216", "straight-216"], connectorRef(first, 1))];
    appendPiece(w.layout, "buffer-turnback", false, connectorRef(ids[ids.length - 1], 1));
    const sig = ids[2];
    w.sim.toggleSignal(sig);
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 120 });
    if (r.kind !== "placed") return { error: `no room for the train: ${r.kind}` };
    w.sim.setLever(w.sim.getTrain(r.trainId).cars[0].id, 0);
    return { sig, held: w.sim.signalHeld(sig) };
  });
  check("7. setup: a semaphore signal piece laid and held, a train before it", old.held === true, JSON.stringify(old));
  await p.reload();
  await start();
  const after = await p.evaluate(() => {
    const w = window.woodrail;
    const sig = [...w.layout.pieceIds()].find((id) => w.layout.getPiece(id).type === "kit-semaphore-signal");
    if (sig === undefined) return { error: "no signal piece after the reload" };
    const t = [...w.sim.trainIds()].map((i) => w.sim.getTrain(i)).find((x) => x.cars.length === 2 && x.cars[0].kind === "engine");
    if (!t) return { error: "no train" };
    w.sim.setLever(t.cars[0].id, 1);
    for (let i = 0; i < 120 * 20; i++) w.sim.tick();
    return { held: w.sim.signalHeld(sig), stood: t.speed < 1 && w.sim.atRedSignal(t.id), front: t.bogies[0].pieceId, sig };
  });
  check("7. an old save's semaphore signal piece loads, held, and holds a train at it", !after.error && after.held && after.stood, JSON.stringify(after));
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
