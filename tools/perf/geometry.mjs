// What the map's geometry costs (`node tools/perf/geometry.mjs [--root <dir with dist/>] [--map late] [--dpr 2] [--top 20]
// [--json <file>]`, after a build; an unminified build names things: `vite build --minify false`): the GPU's vertex and
// index buffers in all (every `bufferData`, counted as the driver gets it, so geometry off the scene counts too), and the
// scene's meshes grouped by what they draw (owner path, material, geometry): the top ones by triangles × instances and
// by buffer bytes, the index and attribute formats, and copies of the same geometry kept apart. For the triangle audit
// in docs/agents/perf.md.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { preview } from "vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? d : args[i + 1];
};
const ROOT = opt("root", process.cwd());
const MAP = opt("map", "late");
const DPR = Number(opt("dpr", 2));
const TOP = Number(opt("top", 20));
const JSON_OUT = opt("json", null);
const FILES = { late: "late-game.txt", sandbox: "big-sandbox.txt" };

const server = await preview({ root: ROOT, preview: { port: 0 }, logLevel: "warn" });
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  headless: false,
  args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: DPR, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.stats.asked", "1");
  // Every vertex and index buffer the driver is given: its size, by the buffer, and what's bound to each target.
  const sizes = new Map();
  const bound = new Map();
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = C.prototype;
    const bind = P.bindBuffer;
    P.bindBuffer = function (target, buf) {
      bound.set(target, buf);
      return bind.call(this, target, buf);
    };
    const data = P.bufferData;
    P.bufferData = function (target, src, usage, ...rest) {
      const buf = bound.get(target);
      if (buf && (target === 0x8892 || target === 0x8893)) {
        const bytes = typeof src === "number" ? src : rest.length >= 2 && rest[1] ? rest[1] * src.BYTES_PER_ELEMENT : (src?.byteLength ?? 0);
        sizes.set(buf, { bytes, index: target === 0x8893 });
      }
      return data.call(this, target, src, usage, ...rest);
    };
    const del = P.deleteBuffer;
    P.deleteBuffer = function (buf) {
      sizes.delete(buf);
      return del.call(this, buf);
    };
  }
  window.__gpuGeom = () => {
    let vertex = 0;
    let index = 0;
    for (const s of sizes.values()) s.index ? (index += s.bytes) : (vertex += s.bytes);
    return { buffers: sizes.size, vertexBytes: vertex, indexBytes: index };
  };
});
const url = server.resolvedUrls.local[0] + (FILES[MAP] ? `?dev#load=${readFileSync(`${HERE}/maps/${FILES[MAP]}`, "utf8").trim()}` : "");
await page.goto(url);
await page.waitForFunction(() => window.woodrail?.title?.shown !== undefined, null, { timeout: 300000 });
await page.evaluate(
  (fresh) => {
    if (!window.woodrail.title.shown) return;
    const sel = fresh ? ".title-card.mode-game button" : ".title-card button";
    [...document.querySelectorAll(sel)].find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click();
    // (New game opens the new-game sheet: Hilly, the land this was written on, and Start.)
    (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click());
  },
  !FILES[MAP],
);
await page.waitForFunction(() => !window.woodrail.title.shown && document.querySelector("#loading.done"), null, { timeout: 300000 });
await page.evaluate(() => Promise.race([window.woodrail.settled?.(5), new Promise((r) => setTimeout(r, 60000))]));
await page.keyboard.press("Escape");
await page.waitForTimeout(3000);

const out = await page.evaluate((TOP) => {
  const w = window.woodrail;
  const info = w.renderer.info;
  info.autoReset = false;
  info.reset();
  // Who owns each group: the game's views (`landscapeView.group`, `depotView.group`, …) and their named groups.
  const owners = new Map();
  for (const k of Object.keys(w)) {
    try {
      const v = w[k];
      if (!v || typeof v !== "object") continue;
      if (v.isObject3D) owners.set(v, k);
      for (const kk of Object.keys(v)) if (v[kk]?.isObject3D && !owners.has(v[kk])) owners.set(v[kk], kk === "group" ? k : `${k}.${kk}`);
    } catch {}
  }
  const label = (x) => owners.get(x) ?? (x.name || (x.userData && Object.keys(x.userData).find((u) => !["cullBoxes", "maxDistance"].includes(u))) || "");
  /** The owning view, then the first named things below it, then the mesh's kind. */
  const path = (o) => {
    const p = [];
    for (let x = o.parent; x && x !== w.scene; x = x.parent) {
      const l = label(x);
      if (l && p[0] !== l) p.unshift(l);
    }
    return [...p.slice(0, 2), o.name || (o.isInstancedMesh ? "InstancedMesh" : o.isBatchedMesh ? "BatchedMesh" : "Mesh")].join("/");
  };
  const bytesOf = (a) => (a ? (a.isInterleavedBufferAttribute ? a.data.array.byteLength : a.array.byteLength) : 0);
  /** A geometry's own buffer bytes (its index and attributes; an interleaved buffer once). */
  const geomBytes = (g) => {
    let n = bytesOf(g.index);
    const seen = new Set();
    for (const a of Object.values(g.attributes)) {
      const key = a.isInterleavedBufferAttribute ? a.data : a;
      if (seen.has(key)) continue;
      seen.add(key);
      n += bytesOf(a);
    }
    return n;
  };
  /** A cheap fingerprint of a geometry's content: copies of the same shape kept apart share it. */
  const sig = (g) => {
    const p = g.attributes.position;
    if (!p || p.isInterleavedBufferAttribute) return null;
    const a = p.array;
    let h = a.length;
    const step = Math.max(1, Math.floor(a.length / 64));
    for (let i = 0; i < a.length; i += step) h = (h * 31 + Math.round(a[i] * 100)) | 0;
    return `${a.length}:${g.index ? g.index.count : 0}:${h}`;
  };
  const groups = new Map();
  const geoms = new Map();
  let total = { meshes: 0, triangles: 0, sceneBytes: 0 };
  w.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const pos = g.attributes.position;
    if (!pos) return;
    const per = (g.index ? g.index.count : pos.count) / 3;
    let n = o.isInstancedMesh ? o.count : 1;
    let t = Math.min(per, Number.isFinite(g.drawRange.count) ? g.drawRange.count / 3 : per) * n;
    // A batch: its instances' own geometries' triangles (its buffers have room to spare).
    if (o.isBatchedMesh) {
      t = 0;
      n = 0;
      for (const info of o._instanceInfo) {
        if (!info.active || !info.visible) continue;
        t += o.getGeometryRangeAt(info.geometryIndex).count / 3;
        n++;
      }
    }
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    const m = ms[0];
    const textured = ms.some((x) => x && (x.map || x.normalMap || x.roughnessMap || x.aoMap || x.bumpMap || x.alphaMap || x.emissiveMap));
    let gi = geoms.get(g);
    if (!gi) {
      gi = { bytes: geomBytes(g), sig: sig(g), users: 0, verts: pos.count };
      geoms.set(g, gi);
    }
    gi.users++;
    const inst = o.isInstancedMesh ? bytesOf(o.instanceMatrix) + bytesOf(o.instanceColor) : 0;
    const key = `${path(o)} [${m?.name || m?.type}]${o.isInstancedMesh ? " inst" : ""}`;
    let r = groups.get(key);
    if (!r) {
      r = {
        what: key,
        meshes: 0,
        instances: 0,
        triangles: 0,
        bytes: 0,
        geoms: new Set(),
        visible: 0,
        casts: o.castShadow,
        index: g.index ? g.index.array.constructor.name : "none",
        attrs: Object.entries(g.attributes)
          .map(([k, a]) => `${k}:${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name.replace("Array", "")}${a.normalized ? "n" : ""}`)
          .join(" "),
        textured,
        maxVerts: 0,
      };
      groups.set(key, r);
    }
    r.meshes++;
    r.instances += n;
    r.triangles += t;
    r.maxVerts = Math.max(r.maxVerts, pos.count);
    if (!r.geoms.has(g)) {
      r.geoms.add(g);
      r.bytes += gi.bytes;
    }
    r.bytes += inst;
    let vis = true;
    for (let x = o; x; x = x.parent) if (!x.visible) vis = false;
    if (vis) r.visible += t;
    total.meshes++;
    total.triangles += t;
  });
  for (const gi of geoms.values()) total.sceneBytes += gi.bytes;
  // Copies: distinct geometries with the same content.
  const bySig = new Map();
  for (const [g, gi] of geoms) {
    if (!gi.sig) continue;
    const e = bySig.get(gi.sig) ?? { n: 0, bytes: 0, verts: gi.verts, name: g.name };
    e.n++;
    e.bytes += gi.bytes;
    bySig.set(gi.sig, e);
  }
  const copies = [...bySig.values()].filter((e) => e.n > 1).sort((a, b) => b.bytes - a.bytes);
  const rows = [...groups.values()].map((r) => ({ ...r, geoms: r.geoms.size }));
  // Formats: bytes in 32-bit indices that could be 16-bit, and uvs on untextured meshes.
  let idx32Shrinkable = 0;
  let uvUnused = 0;
  for (const [g, gi] of geoms) {
    if (g.index && g.index.array instanceof Uint32Array && gi.verts <= 65535) idx32Shrinkable += g.index.array.byteLength / 2;
  }
  w.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.uv) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((x) => x && (x.map || x.normalMap || x.roughnessMap || x.aoMap || x.bumpMap || x.alphaMap || x.emissiveMap))) return;
    o.geometry.__uvUnused = true;
  });
  w.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.uv) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    if (ms.some((x) => x && (x.map || x.normalMap || x.roughnessMap || x.aoMap || x.bumpMap || x.alphaMap || x.emissiveMap))) o.geometry.__uvUnused = false;
  });
  for (const g of geoms.keys()) if (g.__uvUnused) uvUnused += g.attributes.uv.array.byteLength;
  info.autoReset = true;
  return {
    gpu: window.__gpuGeom(),
    memory: { ...info.memory },
    total,
    geometries: geoms.size,
    idx32Shrinkable,
    uvUnused,
    byTriangles: [...rows].sort((a, b) => b.triangles - a.triangles).slice(0, TOP),
    byBytes: [...rows].sort((a, b) => b.bytes - a.bytes).slice(0, TOP),
    copies: copies.slice(0, TOP),
    copiesBytes: copies.reduce((s, e) => s + e.bytes - e.bytes / e.n, 0),
  };
}, TOP);
const MB = (n) => (n / 1048576).toFixed(1);
console.log(`GPU geometry: ${MB(out.gpu.vertexBytes + out.gpu.indexBytes)} MB in ${out.gpu.buffers} buffers (vertex ${MB(out.gpu.vertexBytes)} MB, index ${MB(out.gpu.indexBytes)} MB)`);
console.log(`scene: ${out.total.meshes} meshes, ${out.geometries} geometries, ${MB(out.total.sceneBytes)} MB of them, ${Math.round(out.total.triangles / 1000)}k triangles (all, instances counted; visible or not)`);
console.log(`32-bit indices that could be 16: ${MB(out.idx32Shrinkable)} MB saved; uvs on untextured meshes: ${MB(out.uvUnused)} MB; copies of one geometry: ${MB(out.copiesBytes)} MB beyond the first`);
const row = (r) => `${String(Math.round(r.triangles / 1000)).padStart(6)}k ${MB(r.bytes).padStart(6)} MB  ${r.meshes}m/${r.instances}i/${r.geoms}g  ${r.what}${r.casts ? " casts" : ""}  {${r.index}; ${r.attrs}${r.textured ? "; textured" : ""}}`;
console.log(`\nTop ${TOP} by triangles x instances (triangles, buffer bytes, meshes/instances/geometries):`);
for (const r of out.byTriangles) console.log(row(r));
console.log(`\nTop ${TOP} by buffer bytes:`);
for (const r of out.byBytes) console.log(row(r));
console.log(`\nCopies of one geometry (n, bytes in all, vertices):`);
for (const c of out.copies) console.log(`  x${c.n} ${MB(c.bytes)} MB ${c.verts}v ${c.name}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
await b.close();
await server.close();
