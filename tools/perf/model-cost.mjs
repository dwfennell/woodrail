// What each model costs, for choosing between a Blender model and a Kit one (docs/agents/2026-11-07-blender-or-kit.md):
// triangles, vertices, meshes, materials and vertex bytes (as loaded: floats, before `compact`) of every catalogue
// asset, Kit-built at full detail and at the props' detail (0.5, `PROP_DETAIL` in src/render/props/library.ts), and of
// every model in the GLB sets; whether an asset is a Blender model, and whether its file is one the game loads
// (src/catalogue/registry.ts) or only the dev catalogue viewer (catalogue/index.html). Run from the repo root, no build.
//
// Usage: node tools/perf/model-cost.mjs   (writes e2e-out/model-cost.json)
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";
const ROOT = process.cwd();
const server = await createServer({
  root: ROOT,
  configFile: `${ROOT}/vite.config.ts`,
  server: { port: 5446, strictPort: false },
  logLevel: "error",
});
await server.listen();
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  headless: false,
  args: [
    "--headless=new",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const p = await b.newPage();
await p.goto(server.resolvedUrls.local[0]);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, {
  timeout: 240000,
});
const r = await p.evaluate(async () => {
  const bm = await import("/src/render/blender-models.ts");
  const reg = await import("/src/catalogue/registry.ts");
  const { CATALOGUE } = await import("/src/catalogue/assets/index.ts");
  const { Kit } = await import("/src/catalogue/kit.ts");
  const { createMaterials } = await import("/src/render/materials.ts");
  await bm.loadBlenderModels();
  await bm.loadGameModels();
  for (const f of [
    "bldg",
    "mech",
    "veh",
    "water",
    "life",
    "scene",
    "grand",
    "secret",
  ])
    await reg.loadFile(f);
  const geos = new Set();
  const sets = {};
  const cost = (root) => {
    let tris = 0,
      verts = 0,
      meshes = 0,
      bytes = 0;
    const mats = new Set();
    root.updateMatrixWorld(true);
    root.traverse((x) => {
      if (!x.isMesh) return;
      meshes++;
      const g = x.geometry;
      const n = g.index ? g.index.count : g.attributes.position.count;
      tris += n / 3;
      verts += g.attributes.position.count;
      for (const a of Object.values(g.attributes)) bytes += a.array.byteLength;
      if (g.index) bytes += g.index.array.byteLength;
      for (const m of [x.material].flat()) mats.add(m);
    });
    return {
      tris: Math.round(tris),
      verts,
      meshes,
      materials: mats.size,
      kb: Math.round(bytes / 1024),
    };
  };
  for (const s of [
    "trains",
    "life",
    "buildings",
    "dressing",
    "industry",
    "floors",
    "grand",
  ]) {
    const m = await bm.loadModelSet(s, s !== "trains");
    sets[s] = {};
    for (const [id, o] of m) {
      o.traverse((x) => x.geometry && geos.add(x.geometry));
      sets[s][id] = cost(o);
    }
  }
  const kit = new Kit(createMaterials(1));
  const PROP_DETAIL = 0.5; // src/render/props/library.ts
  const gameKit = new Kit(createMaterials(1), PROP_DETAIL);
  const shipped = new Set([
    "bldg",
    "mech",
    "veh",
    "water",
    "life",
    "scene",
    "grand",
    "secret",
  ]);
  const assets = [];
  for (const a of CATALOGUE) {
    let obj;
    try {
      obj = a.build(kit);
    } catch (e) {
      assets.push({ id: a.id, error: String(e).slice(0, 80) });
      continue;
    }
    let bl = false;
    obj.traverse((x) => {
      if (x.isMesh && (x.userData.sharedGeometry || geos.has(x.geometry)))
        bl = true;
    });
    const prefix = a.id.slice(0, a.id.indexOf("-"));
    const inGame = bl ? null : cost(a.build(gameKit));
    assets.push({
      id: a.id,
      category: a.category,
      blender: bl,
      gameTris: inGame?.tris,
      gameKb: inGame?.kb,
      shipped: shipped.has(prefix),
      inGame: !!a.inGame,
      ...cost(obj),
    });
  }
  return { sets, assets };
});
mkdirSync("e2e-out", { recursive: true });
writeFileSync("e2e-out/model-cost.json", JSON.stringify(r, null, 1));
const by = {};
for (const a of r.assets) {
  const k = `${a.shipped ? "loaded by game" : "viewer only"} / ${a.blender ? "Blender" : "Kit"}`;
  by[k] = (by[k] ?? 0) + 1;
}
console.log(by);
for (const [s, m] of Object.entries(r.sets)) {
  const v = Object.values(m);
  console.log(
    s,
    v.length,
    "models",
    v.reduce((t, x) => t + x.tris, 0),
    "tris",
    v.reduce((t, x) => t + x.kb, 0),
    "KB",
  );
}
await b.close();
await server.close();
