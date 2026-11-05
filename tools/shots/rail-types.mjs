// Mock pictures for the rail types design (docs/superpowers/specs/2026-11-04-rail-types.md), on a 390×844 phone.
// - Rack: a real prototype piece (`rack`, two levels up in one ramp's length) laid by the editor up the side of a
//   hill two levels high, beside the same climb by ordinary ramps; a train stood on the rack. The cog strip down its
//   middle is drawn here, not by the game (a mock).
// - Metro and monorail: mocks only. Plain meshes added to the scene over a real town (kiosks, the line painted over
//   it, a ghost train under; a beam on posts and a car on it), and their cards as HTML over the page.
// Built by the editor and the land editor (harness shortcuts, for looking, not testing).
//
// Usage: node tools/shots/rail-types.mjs [<out dir>]   (default out: docs/agents/shots)
import { existsSync, mkdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5375, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0].replace(/\/$/, "");
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = async (name) => {
  await p.screenshot({ path: `${OUT}/${name}`, type: "jpeg", quality: 72, timeout: 240000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  if (existsSync(`${OUT}/${name}`)) console.log(`${name}: ${Math.round(statSync(`${OUT}/${name}`).size / 1024)} KB`);
};
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 30000))]));
await p.goto(`${PAGE}/#seed-24`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

const look = (at, dir, dist) =>
  p
    .evaluate(
      ({ at, dir, dist }) => {
        const w = window.woodrail;
        const V = w.camera.position.constructor;
        const a = new V(at.x, at.y, at.z);
        const d = new V(dir[0], dir[1], dir[2]).normalize();
        w.controls.target.copy(a);
        w.camera.position.copy(a.clone().add(d.multiplyScalar(dist)));
        w.camera.lookAt(a);
        w.controls.update?.();
        w.invalidate?.();
      },
      { at, dir, dist },
    )
    .then(settle)
    .then(() => p.waitForTimeout(600));

// A mock card over the page, in the game's colours (not its components).
const card = (html) =>
  p.evaluate((html) => {
    document.querySelector("#mock-card")?.remove();
    const d = document.createElement("div");
    d.id = "mock-card";
    d.innerHTML = html;
    Object.assign(d.style, {
      position: "fixed", left: "10px", right: "10px", bottom: "14px", zIndex: 9999, background: "#fbf3e4", color: "#3a2a1c",
      border: "3px solid #b98552", borderRadius: "16px", padding: "12px 14px", font: "15px/1.35 system-ui, sans-serif",
      boxShadow: "0 6px 18px rgba(0,0,0,.25)",
    });
    document.body.appendChild(d);
  }, html);
const noCard = () => p.evaluate(() => document.querySelector("#mock-card")?.remove());
const btn = (label, primary = false) =>
  `<span style="display:inline-block;margin:6px 6px 0 0;padding:9px 13px;border-radius:12px;font-weight:600;${primary ? "background:#c8442f;color:#fff" : "background:#efe2c8;color:#3a2a1c"}">${label}</span>`;

// ---------------------------------------------------------------------------------------------------------------
// 1. Rack: a hill two levels high; a rack up its side (2 squares), and beside it the same climb by ramps (4 squares).
const rack = await p.evaluate(async () => {
  const w = window.woodrail;
  const { trackBlock } = await import("/src/game/track-rules.ts");
  const { plotSlotOf } = await import("/src/landscape/edit.ts");
  const rules = w.interaction.rules;
  const g = w.landscape.grid;
  const t = w.controls.target;
  for (let d = 0; d < 9000; d += 72) {
    for (let a = 0; a < Math.max(1, Math.round(d / 72) * 6); a++) {
      const X = Math.round((t.x + d * Math.cos(a) - 400) / 72) * 72;
      const Z = Math.round((t.z + d * Math.sin(a)) / 72) * 72 + 36;
      let ok = true;
      for (let x = X + 36; x <= X + 14 * 72 && ok; x += 72)
        for (let z = Z - 4 * 72; z <= Z + 5 * 72 && ok; z += 72) {
          const i = g.cellAtWorld(x, z);
          if (i === -1 || g.height[i] !== 0 || trackBlock(rules, "straight-54", false, { x: x - 27, z, heading: 0 }, 0, -1) !== null) ok = false;
        }
      if (!ok) continue;
      const editor = w.interaction.landEditor();
      // The hill: squares 7 to 12 along, rows -3 to +4 across, two levels.
      const cells = [];
      for (let c = 7; c <= 12; c++) for (let r = -3; r <= 4; r++) cells.push(g.cellAtWorld(X + c * 72 + 36, Z + r * 72));
      if (cells.some((i) => i === -1 || editor.check(i, 1) !== null)) continue;
      for (let level = 1; level <= 2; level++) for (const i of cells) editor.apply(i, 1);
      w.editLand([...new Set(cells.map((i) => plotSlotOf(i)))]);
      const H = X + 7 * 72; // the hill's side
      const Z2 = Z + 3 * 72; // the ramps' line
      const rackLine = [
        { type: "straight-216", pose: { x: H - 144 - 216 - 216, z: Z, heading: 0 }, y: 0, flipped: false },
        { type: "straight-216", pose: { x: H - 144 - 216, z: Z, heading: 0 }, y: 0, flipped: false },
        { type: "rack", pose: { x: H - 144, z: Z, heading: 0 }, y: 0, flipped: false },
        { type: "straight-216", pose: { x: H, z: Z, heading: 0 }, y: 96, flipped: false },
        { type: "straight-216", pose: { x: H + 216, z: Z, heading: 0 }, y: 96, flipped: false },
      ];
      const rampLine = [
        { type: "straight-216", pose: { x: H - 288 - 216, z: Z2, heading: 0 }, y: 0, flipped: false },
        { type: "ramp", pose: { x: H - 288, z: Z2, heading: 0 }, y: 0, flipped: false },
        { type: "ramp", pose: { x: H - 144, z: Z2, heading: 0 }, y: 48, flipped: false },
        { type: "straight-216", pose: { x: H, z: Z2, heading: 0 }, y: 96, flipped: false },
        { type: "straight-216", pose: { x: H + 216, z: Z2, heading: 0 }, y: 96, flipped: false },
      ];
      const why = [...rackLine, ...rampLine].map((q) => `${q.type}:${trackBlock(rules, q.type, q.flipped, q.pose, q.y, -1)}`);
      const ids = w.editor().placeRun(rackLine);
      const ids2 = w.editor().placeRun(rampLine);
      return { X, Z, H, Z2, ids, ids2, why };
    }
  }
  return null;
});
console.log(JSON.stringify(rack));
if (!rack?.ids) throw new Error("no ground for the rack");

// The cog strip down the rack's middle (mock), and a train on it: a tank engine pushing a coach up.
await p.evaluate(async ({ ids, H, Z }) => {
  const w = window.woodrail;
  const THREE = await import(performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/.vite/deps/three.js")));
  const g = new THREE.Group();
  g.name = "mock-rack";
  const bar = new THREE.MeshStandardMaterial({ color: 0x55565c, metalness: 0.4, roughness: 0.5 });
  const teeth = new THREE.MeshStandardMaterial({ color: 0x8a8c94, metalness: 0.5, roughness: 0.4 });
  // The rack piece's path: x from H-144 to H, y = 96 * smoothstep. (Its top face is 12 over the base.)
  const N = 24;
  for (let k = 0; k < N; k++) {
    const s0 = k / N;
    const s1 = (k + 1) / N;
    const y = (s) => 96 * s * s * (3 - 2 * s);
    const x0 = H - 144 + 144 * s0;
    const x1 = H - 144 + 144 * s1;
    const y0 = y(s0) + 12.4;
    const y1 = y(s1) + 12.4;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 2, 7), bar);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, Z);
    m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
    g.add(m);
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 7.4), teeth);
    tooth.position.set((x0 + x1) / 2, (y0 + y1) / 2 + 1.6, Z);
    tooth.rotation.z = m.rotation.z;
    g.add(tooth);
  }
  w.scene.add(g);
  const r = w.sim.addTrain(["engine", "passenger"], { pieceId: ids[2], pathIndex: 0, s: 110, reversed: true });
  if (r.kind === "placed") {
    const tr = w.sim.getTrain(r.trainId);
    w.sim.setLook(tr.cars[0].id, "tank");
  }
  w.trainView?.sync?.();
  w.invalidate?.();
}, rack);
await settle();
const rackAt = { x: rack.H - 60, y: 40, z: (rack.Z + rack.Z2) / 2 };
await look(rackAt, [-0.15, 0.85, 1], 900);
await snap("rail-types-rack.jpg");
await look({ x: rack.H - 72, y: 50, z: rack.Z }, [-0.2, 0.35, 1], 420);
await snap("rail-types-rack-close.jpg");
// The phone UI: the rack piece's card (mock) and the message a train without a rack engine gives.
await look(rackAt, [-0.15, 0.85, 1], 1000);
await card(
  `<div style="font-weight:700;font-size:17px">Rack ⛰️</div>
   <div style="margin-top:4px">Two levels up in one ramp's length. Only a train with a <b>rack engine</b> can climb it.</div>
   <div style="margin-top:8px;padding:8px 10px;background:#f6dccf;border-radius:10px">🚂 Puffer, at the foot: <b>can't climb the rack</b>. Add a rack engine, or go round by the ramps.</div>
   <div>${btn("Turn round")}${btn("Flip")}${btn("Put away")}</div>`,
);
await snap("rail-types-rack-card.jpg");
await noCard();

// ---------------------------------------------------------------------------------------------------------------
// 2. Metro (mock): two kiosks in a town, the line painted over it, a train under drawn as a ghost.
const town = await p.evaluate(() => {
  const w = window.woodrail;
  const g = w.landscape.grid;
  const towns = w.landscape.towns.slice().sort((a, b) => b.buildings.length - a.buildings.length);
  const t = towns[0];
  // The middle of its houses (not its station), and how far they spread along x.
  const pts = t.buildings.flatMap((b) => b.cells.map((i) => ({ x: g.centreX(g.colOf(i)), z: g.centreZ(g.rowOf(i)) })));
  const cx = pts.reduce((n, q) => n + q.x, 0) / pts.length;
  const cz = pts.reduce((n, q) => n + q.z, 0) / pts.length;
  const xs = pts.map((q) => q.x);
  // Two of its squares with no house on them (a green or a street), far apart: the metro's entrances.
  const built = new Set(t.buildings.flatMap((b) => b.cells));
  const free = t.cells.filter((i) => !built.has(i) && g.height[i] === 0).map((i) => ({ x: g.centreX(g.colOf(i)), z: g.centreZ(g.rowOf(i)) }));
  let best = null;
  for (const a of free) for (const b of free) {
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d > 200 && d < 500 && Math.abs(a.z - b.z) < 80 && (!best || d > best.d)) best = { a, b, d };
  }
  return { id: t.id, name: t.name, centre: { x: cx, z: cz }, span: [Math.min(...xs), Math.max(...xs)], n: t.buildings.length, entrances: best };
});
console.log(JSON.stringify(town));
await p.evaluate(async ({ centre: c0, entrances }) => {
  const w = window.woodrail;
  const THREE = await import(performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/.vite/deps/three.js")));
  const g = new THREE.Group();
  g.name = "mock-metro";
  const centre = entrances ? { x: (entrances.a.x + entrances.b.x) / 2, z: (entrances.a.z + entrances.b.z) / 2 } : c0;
  const wood = new THREE.MeshStandardMaterial({ color: 0xc8442f, roughness: 0.7 });
  const roof = new THREE.MeshStandardMaterial({ color: 0x2f6db5, roughness: 0.7 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x1b140e });
  const sign = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.beginPath();
    x.arc(64, 64, 60, 0, 7);
    x.fill();
    x.strokeStyle = "#c8442f";
    x.lineWidth = 16;
    x.stroke();
    x.fillStyle = "#2f6db5";
    x.font = "bold 76px sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("M", 64, 68);
    return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true });
  })();
  const kiosk = (x, z, h) => {
    const k = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(40, 22, 30), wood);
    body.position.y = 11;
    k.add(body);
    const top = new THREE.Mesh(new THREE.BoxGeometry(48, 5, 38), roof);
    top.position.y = 24.5;
    k.add(top);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(22, 16), dark);
    door.position.set(0, 8, 15.2);
    k.add(door);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 30), roof);
    pole.position.set(26, 15, 18);
    k.add(pole);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(9, 24), sign);
    disc.position.set(26, 34, 18.2);
    k.add(disc);
    const disc2 = disc.clone();
    disc2.rotation.y = Math.PI;
    disc2.position.z = 17.8;
    k.add(disc2);
    k.position.set(x, 2, z);
    k.rotation.y = h;
    k.scale.setScalar(1.5);
    g.add(k);
  };
  // The line: from well west of the centre to well east of it, a little south (on the felt over the tunnel).
  const z = centre.z;
  const x0 = centre.x - 700;
  const x1 = centre.x + 700;
  const dash = new THREE.MeshBasicMaterial({ color: 0x2f6db5, transparent: true, opacity: 0.8, depthWrite: false, depthTest: false });
  for (let x = x0; x < x1; x += 22) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), dash);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 3, z);
    m.renderOrder = 5;
    g.add(m);
  }
  if (entrances) {
    kiosk(entrances.a.x, entrances.a.z, 0);
    kiosk(entrances.b.x, entrances.b.z, 0);
  } else {
    kiosk(centre.x - 150, z, 0);
    kiosk(centre.x + 220, z, 0);
  }
  // A ghost train under (pale, seen through the town), as the tunnels branch draws cars in a tunnel.
  const ghost = new THREE.MeshBasicMaterial({ color: 0xfff4dc, transparent: true, opacity: 0.45, depthTest: false });
  for (let k = 0; k < 3; k++) {
    const car = new THREE.Mesh(new THREE.BoxGeometry(58, 30, 26), ghost);
    car.position.set(centre.x - 40 + k * 64, -60, z);
    car.renderOrder = 10;
    g.add(car);
  }
  w.scene.add(g);
  w.invalidate?.();
}, town);
await look({ x: town.centre.x - 60, y: 0, z: town.centre.z }, [0.05, 1.5, 1], 1350);
await snap("rail-types-metro.jpg");
await card(
  `<div style="font-weight:700;font-size:17px">Ⓜ ${town.name} Metro, Market stop</div>
   <div style="margin-top:4px">Under the town: the town grows over it. <b>5 waiting</b> · next train in 20 s</div>
   <div style="margin-top:6px">🚇 Metro train (3 cars, 24 seats). Runs while a power station has coal.</div>
   <div>${btn("Show the line", true)}${btn("Move entrance")}${btn("Put away")}</div>`,
);
await snap("rail-types-metro-card.jpg");
await noCard();
await p.evaluate(() => {
  const w = window.woodrail;
  w.scene.remove(w.scene.getObjectByName("mock-metro"));
  w.invalidate?.();
});

// ---------------------------------------------------------------------------------------------------------------
// 3. Monorail (mock): a beam on posts across the same town, a car on it.
await p.evaluate(async ({ centre }) => {
  const w = window.woodrail;
  const THREE = await import(performance.getEntriesByType("resource").map((e) => e.name).find((n) => n.includes("/.vite/deps/three.js")));
  const g = new THREE.Group();
  g.name = "mock-monorail";
  const beamM = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.8 });
  const postM = new THREE.MeshStandardMaterial({ color: 0xb98552, roughness: 0.8 });
  const carM = new THREE.MeshStandardMaterial({ color: 0x3c8f4e, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.2 });
  const Y = 120; // the beam's top: two and a half levels, over houses
  const z = centre.z;
  const x0 = centre.x - 560;
  const x1 = centre.x + 560;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 14, 14), beamM);
  beam.position.set(centre.x, Y - 7, z);
  g.add(beam);
  for (let x = x0 + 36; x < x1; x += 144) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(4, 6, Y - 14), postM);
    post.position.set(x, (Y - 14) / 2, z);
    g.add(post);
    const head = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 22), postM);
    head.position.set(x, Y - 16, z);
    g.add(head);
  }
  for (let k = 0; k < 2; k++) {
    const car = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(13, 44, 6, 12), carM);
    body.rotation.z = Math.PI / 2;
    body.position.y = 10;
    car.add(body);
    const win = new THREE.Mesh(new THREE.BoxGeometry(46, 8, 27), glass);
    win.position.y = 15;
    car.add(win);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(56, 10, 20), carM);
    skirt.position.y = -4;
    car.add(skirt);
    car.position.set(centre.x - 30 + k * 76, Y + 4, z);
    g.add(car);
  }
  w.scene.add(g);
  w.invalidate?.();
}, town);
await look({ x: town.centre.x, y: 50, z: town.centre.z }, [0.3, 0.75, 1], 1500);
await snap("rail-types-monorail.jpg");

console.log(errors.length ? `errors:\n${errors.join("\n")}` : "no page errors");
await b.close();
await server.close();
