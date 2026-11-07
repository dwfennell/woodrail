// itch.io's embed background (itch-assets/embed-bg.jpg, docs/itch-builds.md): the starter map's first line, Elderwick to
// Larkfield, with a train on it, and things put in the grass below it, at 1280×720. itch shows about the middle
// 700×400 of it behind "Run game", so what matters sits there.
//
// Harness shortcuts, for looking only: the line laid by the game's pathfinder, the train put on by the sim and the game
// paused; buildings placed by the editor, props (`prop:<asset>`, the grand projects' models) added to the map; with
// JOIN=1, the last track piece placed joined to a station's free end by the pathfinder.
//
// Usage: node tools/shots/embed-bg.mjs "<thing>[,<thing>…]" [dz] [dx]   one picture per thing, each removed after
//   a thing: "<type or prop:asset>@<dx>:<dz>[:heading]+…" (offsets in mm from the view's middle, plus dz/dx)
//   env: OUT (default e2e-out/embed), NAMES (a file name per thing), DIST, PHI, THETA (the camera), JOIN
// The current picture:
//   JOIN=1 NAMES=embed-bg node tools/shots/embed-bg.mjs "prop:grand-ferris-wheel-3@-170:20+depot-mast@140:-20" -235
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.env.OUT ?? `${ROOT}/e2e-out/embed`;
mkdirSync(OUT, { recursive: true });
const TYPES = (process.argv[2] ?? "none").split(",");
const DZ = Number(process.argv[3] ?? 520);
const DX = Number(process.argv[4] ?? 0);
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5440, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(server.resolvedUrls.local[0], { timeout: 240000 });
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
await p.waitForTimeout(1000);
const DIST = Number(process.env.DIST ?? 1450), PHI = Number(process.env.PHI ?? 0.62), THETA = Number(process.env.THETA ?? Math.PI);
const mid = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const ts = w.world.landscape.towns;
  const a = ts.find((t) => t.name === "Elderwick"), z = ts.find((t) => t.name === "Larkfield");
  const sa = w.world.stations.get(a.id), sz = w.world.stations.get(z.id);
  let laid = [];
  const pt = (ref) => { const c = w.layout.worldConnector(ref, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" }); return { x: c.x, z: c.z }; };
  const pairs = [[1, 0], [1, 1], [0, 0], [0, 1]].sort(([i, j], [k, l]) => { const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z); return d(pt(connectorRef(sa, i)), pt(connectorRef(sz, j))) - d(pt(connectorRef(sa, k)), pt(connectorRef(sz, l))); });
  for (const [i, j] of pairs) {
    const before = new Set(w.layout.pieceIds());
    if (!play(w.world.layout, w.editor(), connectorRef(sa, i), connectorRef(sz, j), { blocked: rulesFor(w.world), maxPieces: 120, fiddle: 3 }).ok) continue;
    laid = [...w.layout.pieceIds()].filter((id) => !before.has(id) && w.layout.getPiece(id).type.startsWith("straight"));
    break;
  }
  w.trackChanged?.();
  const m = laid[Math.floor(laid.length / 2)];
  const r = w.sim.addTrain(["engine", "passenger", "passenger", "caboose"], { pieceId: laid[Math.floor(laid.length / 2) - 1], pathIndex: 0, reversed: false, s: 100 });
  w.paused = true;
  const pa = w.layout.getPiece(sa).pose, pz = w.layout.getPiece(sz).pose;
  w.invalidate();
  return { x: (pa.x + pz.x) / 2, z: (pa.z + pz.z) / 2, laid: laid.length, train: r.kind };
});
console.log("line", JSON.stringify(mid));
await p.evaluate(({ mid, DIST, PHI, THETA }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(mid.x, 0, mid.z + Number(0)), DIST, { duration: 0.1, phi: PHI, theta: THETA }), { mid, DIST, PHI, THETA });
await p.waitForTimeout(1500);
const info = await p.evaluate(() => {
  const w = window.woodrail;
  const ts = w.world.landscape.towns.map((t) => ({ name: t.name, x: Math.round(t.centre.x), z: Math.round(t.centre.z) }));
  const c = w.camera.position, t = w.controls.target;
  return { mode: w.mode(), ts, cam: [c.x, c.y, c.z].map(Math.round), target: [t.x, t.y, t.z].map(Math.round) };
});
console.log(JSON.stringify(info));
for (const type of TYPES) {
  if (process.env.JOIN) await p.evaluate(async () => {
    const { play } = await import("/src/play/player.ts");
    const { rulesFor } = await import("/src/play/rules.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    window.__join = { play, rulesFor, connectorRef };
  });
  // Props first loaded ("prop:<asset>").
  await p.evaluate(async (type) => { for (const part of type.split("+")) if (part.startsWith("prop:")) await window.woodrail.propLibrary.load(part.slice(5).split("@")[0]); }, type);
  const r = await p.evaluate(({ type, DZ, DX }) => {
    const w = window.woodrail;
    const t = w.controls.target;
    window.__last = [];
    if (type === "none") return { ok: true };
    const g = w.world.landscape.grid;
    const out = [];
    // "type@dx:dz:heading+type@…": a group, each at the target plus its offset.
    for (const part of type.split("+")) {
      const [ty, off = "0:0:0"] = part.split("@");
      const [ox, oz, h = 0] = off.split(":").map(Number);
      const x = t.x + DX + ox, z = t.z + DZ + oz;
      const y = g.groundY(g.cellAtWorld(x, z));
      if (ty.startsWith("prop:")) {
        const pr = w.props.add(ty.slice(5), { x, z, heading: h, y }, undefined, { scale: 0.85 });
        w.propsChanged();
        (window.__props ??= []).push(pr.id);
        out.push(`prop ${pr.id}`);
        continue;
      }
      try {
        const id = w.editor().place(ty, { x, z, heading: h }, y, false);
        const role = ty.startsWith("depot-") ? ty.slice(6) : null;
        if (role && !w.economy.depotAtPiece(id)) w.economy.addDepot(role, id);
        window.__last.push(id);
        out.push(id);
      } catch (e) {
        out.push(String(e).slice(0, 80));
      }
    }
    // JOIN: the last track piece placed joined by the game's pathfinder to a station's free end (the fewest pieces).
    let joined = null;
    if (window.__join) {
      const piece = out.filter((x) => typeof x === "number").at(-1);
      const { play, rulesFor, connectorRef } = window.__join;
      const towns = w.world.landscape.towns.filter((t) => t.name === "Elderwick" || t.name === "Larkfield");
      let best = null;
      for (const t of towns) for (const i of [0, 1]) for (const j of [0, 1]) {
        const st = w.world.stations.get(t.id);
        if (w.layout.joinedConnector(connectorRef(piece, i)) >= 0 || w.layout.joinedConnector(connectorRef(st, j)) >= 0) continue;
        const before = new Set(w.layout.pieceIds());
        const r = play(w.world.layout, w.editor(), connectorRef(st, j), connectorRef(piece, i), { blocked: rulesFor(w.world), maxPieces: 40, fiddle: 3 });
        const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id));
        for (const id of laid) w.editor().remove(id);
        if (r.ok && laid.length > 0 && (!best || laid.length < best.n)) best = { i, st, j, n: laid.length };
      }
      if (best) {
        const before = new Set(w.layout.pieceIds());
        play(w.world.layout, w.editor(), connectorRef(best.st, best.j), connectorRef(piece, best.i), { blocked: rulesFor(w.world), maxPieces: 40, fiddle: 3 });
        const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id));
        window.__last.push(...laid);
        joined = laid.length;
      }
      w.trackChanged?.();
    }
    w.depotView?.setWorld?.(w.economy, w.layout);
    w.invalidate();
    return { ok: true, out, joined };
  }, { type, DZ, DX });
  await p.waitForTimeout(1500);
  await settle();
  await p.evaluate(() => { for (const el of document.querySelectorAll(".hud, .toast, .card, .tray, .goals")) el.style.visibility = "hidden"; });
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/${process.env.NAMES?.split(",")[TYPES.indexOf(type)] ?? type}.jpg`, type: "jpeg", quality: 88 });
  console.log(type, JSON.stringify(r));
  await p.evaluate(() => { const w = window.woodrail; for (const id of window.__last) w.editor().remove?.(id); for (const id of window.__props ?? []) w.props.remove(id); window.__props = []; w.propsChanged(); w.invalidate(); });
  await p.evaluate(() => { for (const el of document.querySelectorAll(".hud, .toast, .card, .tray, .goals")) el.style.visibility = ""; });
}
await b.close();
await server.close();
