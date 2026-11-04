// Mock pictures for the water transport design (docs/superpowers/specs/2026-11-04-water-transport.md): a Game on a
// 390×844 phone with the catalogue's boat models put on the water by hand and the new cards drawn over the HUD. A
// harness for looking only: nothing here is the game's own rule (boats, docks and cards are mocked).
//
// Usage: node tools/shots/water-mock.mjs [<out dir>]   (default out: docs/agents/shots)
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
const ONLY = process.env.ONLY?.split(",");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
p.on("pageerror", (e) => console.log("pageerror", e.message));
p.on("console", (m) => /^(no model|orient)/.test(m.text()) && console.log(m.text()));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await p.goto(PAGE + (process.env.SEED ? `#seed-${process.env.SEED}` : ""));
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// Helpers in the page: put a catalogue model down at a size, find a stretch of river, aim the camera.
await p.evaluate(async () => {
  const THREE = await import("/node_modules/.vite/deps/three.js").catch(() => import("three"));
  const { modelKey } = await import("/src/render/props/library.ts");
  const w = window.woodrail;
  const mock = new THREE.Group();
  mock.name = "water-mock";
  w.scene.add(mock);
  window.__mockGroup = mock;
  window.__THREE = THREE;
  /** A catalogue model at (x, z), facing `heading` (radians, along +x at 0), scaled so its longest side is `len` mm. */
  window.__add = async (asset, x, z, heading, len, y = 0.6) => {
    const model = await w.propLibrary.load(modelKey(asset)).catch(() => null);
    if (!model) { console.log("no model", asset); return null; }
    const g = new THREE.Group();
    for (const part of model.parts) {
      const m = new THREE.Mesh(part.geometry, part.material);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    const box = new THREE.Box3().setFromObject(g);
    const size = box.getSize(new THREE.Vector3());
    const s = len ? len / Math.max(size.x, size.z) : 1;
    const inner = new THREE.Group();
    inner.add(g);
    g.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    // Long side along x.
    if (!len) g.position.set(0, 0, 0);
    else if (size.z > size.x) g.rotation.y = Math.PI / 2, g.position.set((box.min.z + box.max.z) / 2, -box.min.y, -(box.min.x + box.max.x) / 2);
    inner.scale.setScalar(s);
    inner.position.set(x, y, z);
    inner.rotation.y = -heading;
    mock.add(inner);
    w.invalidate?.();
    return { size: [size.x, size.y, size.z], s };
  };
  /** A plain toy box (a barge hull, a jetty plank, a heap of goods). */
  window.__box = (x, y, z, sx, sy, sz, color, heading = 0, round = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshStandardMaterial({ color, roughness: 0.75 }));
    m.position.set(x, y + sy / 2, z);
    m.rotation.y = -heading;
    m.castShadow = true;
    m.receiveShadow = true;
    mock.add(m);
    w.invalidate?.();
    return m;
  };
  window.__cyl = (x, y, z, r, h, color, axis = "y", heading = 0) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
    m.position.set(x, y, z);
    if (axis === "z") m.rotation.set(Math.PI / 2, -heading, 0, "YXZ");
    if (axis === "x") m.rotation.set(0, -heading, Math.PI / 2, "YXZ");
    m.castShadow = true;
    mock.add(m);
    w.invalidate?.();
    return m;
  };
  /** A tug at (x, z) heading `heading`, towing `loads` barges behind it (each a list: "log" | "stone" | "coal" | "grain" | null). */
  window.__tow = async (x, z, heading, loads) => {
    const c = Math.cos(heading), s = Math.sin(heading);
    await window.__add("veh-tugboat", x, z, heading, 100);
    loads.forEach((load, i) => {
      const d = 100 + i * 92;
      const bx = x - c * d, bz = z - s * d;
      window.__box(bx, 0.2, bz, 84, 16, 44, 0x9c6a3a, heading);
      window.__box(bx, 14, bz, 86, 4, 46, 0x7a4e28, heading);
      window.__box(bx, 14, bz, 78, 4, 38, 0x5c3a1e, heading);
      const at = (u, v) => [bx + c * u - s * v, bz + s * u + c * v];
      if (load === "log") for (const [v, y] of [[-12, 21], [0, 21], [12, 21], [-6, 29], [6, 29], [0, 37]]) { const [lx, lz] = at(0, v); const m = window.__cyl(lx, y, lz, 5, 68, 0xb07a45, "x", heading); }
      if (load === "stone") for (const [u, v, h] of [[-22, -8, 10], [0, 6, 13], [20, -4, 9], [6, -9, 8], [-12, 9, 8], [26, 9, 8]]) { const [lx, lz] = at(u, v); window.__box(lx, 16, lz, 13, h, 12, 0x9a958c, heading + u); }
      if (load === "coal") { const [lx, lz] = at(0, 0); window.__box(lx, 16, lz, 70, 10, 32, 0x2d2a28, heading); window.__box(lx, 24, lz, 46, 8, 22, 0x2d2a28, heading); }
      if (load === "grain") { const [lx, lz] = at(0, 0); window.__box(lx, 16, lz, 70, 10, 32, 0xe2c25a, heading); window.__box(lx, 24, lz, 46, 7, 20, 0xe9cd6d, heading); }
      // The tow line.
      const [tx, tz] = at(42 + 6, 0);
      window.__box(tx + c * 4, 14, tz + s * 4, 14, 2, 2, 0x3a2a1c, heading);
    });
  };
  /** A flat ribbon (a route's line) over water or ground, through `pts`, at height y. */
  window.__ribbon = (pts, color, width = 16, y = 3) => {
    const pos = [];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      const nx = (-dz / L) * width / 2, nz = (dx / L) * width / 2;
      pos.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, b.x + nx, y, b.z + nz, a.x - nx, y, a.z - nz, b.x - nx, y, b.z - nz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    mock.add(m);
    w.invalidate?.();
  };
  /** Screen (CSS px) of a world point. */
  window.__screen = (x, y, z) => {
    w.camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(w.camera);
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  };
  /** A mock card above the tray, styled as the game's depot card. */
  window.__card = (html, cls = "") => {
    const c = document.createElement("div");
    c.className = `card depot-card mock-ui ${cls}`;
    c.innerHTML = html + `<button class="close" aria-label="Close">✕</button>`;
    document.querySelector(".hud").appendChild(c);
    document.querySelector(".hud").classList.add("card-open");
    return c;
  };
  /** A numbered disc on the map at a world point (a route's stop). */
  window.__disc = (x, y, z, n, color) => {
    const s = window.__screen(x, y, z);
    const d = document.createElement("div");
    d.className = "mock-ui";
    d.textContent = n;
    Object.assign(d.style, { position: "fixed", left: `${s.x - 15}px`, top: `${s.y - 15}px`, width: "30px", height: "30px", borderRadius: "50%", background: color, color: "#fff", font: "800 16px/30px system-ui, sans-serif", textAlign: "center", boxShadow: "0 0 0 3px #fff, 0 2px 6px rgba(0,0,0,.35)", zIndex: 5, pointerEvents: "none" });
    document.body.appendChild(d);
  };
  /** A label pinned on the map (a callout for the mock). */
  window.__tag = (x, y, z, text, dx = 0, dy = -34) => {
    const s = window.__screen(x, y, z);
    const d = document.createElement("div");
    d.className = "mock-ui";
    d.innerHTML = text;
    Object.assign(d.style, { position: "fixed", left: `${s.x + dx}px`, top: `${s.y + dy}px`, transform: "translateX(-50%)", padding: "4px 10px", borderRadius: "999px", background: "rgba(255,250,240,.95)", color: "#3a2a1c", font: "700 13px/1.3 Nunito, system-ui, sans-serif", boxShadow: "0 2px 6px rgba(0,0,0,.25)", whiteSpace: "nowrap", zIndex: 5, pointerEvents: "none" });
    document.body.appendChild(d);
  };
  /** A train's cars (game models) in a row from (x, z) along `heading`, at height y: e.g. ["engine", "timber"]. */
  window.__train = async (kinds, x, z, heading, y) => {
    const { buildCarModel } = await import("/src/render/train-models.ts");
    const { CAR_SPECS } = await import("/src/sim/cars.ts");
    const c = Math.cos(heading), s = Math.sin(heading);
    let d = 0;
    kinds.forEach((k, i) => {
      const spec = CAR_SPECS[k];
      if (i > 0) d -= spec.length / 2 + 6;
      const m = buildCarModel(k, w.mats, i, "classic", k !== "engine").root;
      m.position.set(x + c * d, y, z + s * d);
      m.rotation.y = -heading;
      m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      mock.add(m);
      d -= spec.length / 2;
    });
    w.invalidate?.();
  };
  window.__look = (x, z, dist, phi = 0.8, turn = 0) => {
    w.director.cancel?.();
    const c = w.controls;
    const sph = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(w.camera.position, c.target));
    sph.radius = dist;
    sph.phi = phi;
    sph.theta += turn;
    c.target.set(x, 0, z);
    w.camera.position.setFromSpherical(sph).add(c.target);
    w.camera.lookAt(c.target);
    c.update?.();
    w.camera.updateMatrixWorld();
    w.invalidate?.();
  };

  /** Straight stretches of river along x or z: a river square with river either side along the way and land across it. */
  window.__rivers = () => {
    const g = w.world.landscape.grid;
    const out = [];
    for (let i = 0; i < g.cellCount; i++) {
      if (g.surface[i] !== 1) continue;
      const c = g.colOf(i), r = g.rowOf(i);
      const s = (dc, dr) => { const j = g.index(c + dc, r + dr); return j === -1 ? -1 : g.surface[j]; };
      let run = 0;
      for (let k = -3; k <= 3; k++) if (s(k, 0) === 1) run++;
      if (run === 7 && s(0, -1) !== 1 && s(0, 2) !== 1 && (s(0, 1) === 1 || s(0, 1) !== 1)) out.push({ x: g.centreX(c), z: g.centreZ(r), wide: s(0, 1) === 1, dir: "x", north: s(0, -1), south: s(0, 1) });
    }
    return out;
  };
});
await p.addStyleTag({ content: ".toast { display: none !important }" });
const shot = async (name) => {
  await p.evaluate(() => { window.woodrail.invalidate?.(); return new Promise((r) => setTimeout(r, 600)); });
  await p.evaluate(() => Promise.race([window.woodrail.settled(2), new Promise((r) => setTimeout(r, 15000))]));
  await p.screenshot({ path: `${OUT}/${name}`, timeout: 180000 });
  console.log("shot", name);
};
const SCENES = (await import(process.env.SCENES ?? "./water-scenes.mjs")).default;
for (const [name, fn] of Object.entries(SCENES)) {
  if (ONLY && !ONLY.includes(name)) continue;
  await p.evaluate(() => { window.__mockGroup.clear(); document.querySelectorAll(".mock-ui").forEach((e) => e.remove()); });
  await fn(p, shot);
}
await b.close();
await server.close();
