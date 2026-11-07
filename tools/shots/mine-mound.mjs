// Close pictures of a mine's rock mound (the shimmering-triangles report, 2026-11-07: three rock blocks' faces in one
// plane, z-fighting): a Game, a mine put down beside the first town (a harness shortcut: placed by the editor; it's for
// looking, not testing), the camera on the mound from each heading in THETAS at each distance in DISTS (mm), a crop
// round the middle of the view (CROP / distance px across, half). Before and after: docs/agents/shots/mine-mound-*.jpg.
//   MODE=high|mobile   VIEW=WxH (default 1280x800)   PHI (default 0.95)   TAG (file prefix)
//   TOGGLES=receive,shadows,bump   each frame again with that switched off (the suspects ruled out)
//   PROBE=1   triangles near the mound whose vertex normals stray from their face;  OVERLAP=1   meshes over the mound
//   ORBIT=t0,t1,n,dist   n frames turning from t0 to t1 (z-fighting shimmers from step to step)
//   MOUND=x,z   the mound's place, for a view where the desktop's spot on screen isn't it (a phone's)
// Usage: node tools/shots/mine-mound.mjs [<out dir>]   (default out: e2e-out/mine-mound)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/mine-mound";
mkdirSync(OUT, { recursive: true });
const [W, H] = (process.env.VIEW ?? "1280x800").split("x").map(Number);
const TIER = process.env.MODE ?? "high";
const TAG = process.env.TAG ?? `${TIER}-${W}`;
const server = await createServer({
  root: ROOT,
  configFile: `${ROOT}/vite.config.ts`,
  server: { port: 5381, strictPort: false },
  logLevel: "error",
});
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({
  executablePath: CHROMIUM,
  headless: false,
  args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const p = await b.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
});
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript((tier) => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.quality", tier);
}, TIER);
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, {
  timeout: 240000,
});
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, {
  timeout: 180000,
});
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
const at = await p.evaluate(() => {
  const w = window.woodrail;
  const t = w.world.landscape.towns[0];
  const x = t.centre.x - 900,
    z = t.centre.z + 900;
  const g = w.world.landscape.grid;
  const y = g.groundY(g.cellAtWorld(x + 108, z + 72));
  const id = w.editor().place("depot-mine", { x, z, heading: 0 }, y, false);
  w.economy.depotAtPiece(id) ?? w.economy.addDepot("mine", id);
  w.depotView.setWorld(w.economy, w.layout);
  return { x, z, y };
});
await p.addStyleTag({
  content: "body > *:not(#scene) { visibility: hidden !important }",
});
const look = (x, z, dist, duration) =>
  p.evaluate(
    ({ x, z, dist, duration, phi, theta }) => {
      const w = window.woodrail;
      w.director.glideTo(new w.camera.position.constructor(x, 0, z), dist, {
        duration,
        phi,
        theta,
      });
    },
    {
      x,
      z,
      dist,
      duration,
      phi: Number(process.env.PHI ?? 0.8),
      theta: process.env.THETA ? Number(process.env.THETA) : undefined,
    },
  );
const info = () =>
  p.evaluate(() => {
    const w = window.woodrail;
    return {
      shadow: { ...w.stage.shadowFit },
      mapSize: w.stage.sun.shadow.mapSize.x,
    };
  });
// The mound's middle: its spot on screen in a first close look (found by eye), back to the world at its mid height.
await look(at.x + 150, at.z + 140, 700, 0.1);
await settle();
const M = await p.evaluate(({ y }) => {
  const w = window.woodrail;
  const V = w.camera.position.constructor;
  const a = new V((575 / innerWidth) * 2 - 1, -(440 / innerHeight) * 2 + 1, -1).unproject(w.camera);
  const d = new V((575 / innerWidth) * 2 - 1, -(440 / innerHeight) * 2 + 1, 1).unproject(w.camera).sub(a);
  const t = (y + 40 - a.y) / d.y;
  return {
    x: a.x + d.x * t,
    z: a.z + d.z * t,
    theta: Math.atan2(w.camera.position.x - w.controls.target.x, w.camera.position.z - w.controls.target.z),
  };
}, at);
// (Or given, as "x,z": the same map's mound from a desktop run, for a phone's view, where that spot isn't the mound.)
if (process.env.MOUND) [M.x, M.z] = process.env.MOUND.split(",").map(Number);
console.log("mound", JSON.stringify(M));
if (process.env.PROBE) {
  const r = await p.evaluate(
    ({ M }) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const out = [];
      w.depotView.group.traverse((m) => {
        if (!m.isMesh || !m.geometry.index) return;
        const g = m.geometry,
          pos = g.attributes.position,
          nor = g.attributes.normal,
          idx = g.index;
        m.updateWorldMatrix(true, false);
        const a = new V(),
          b = new V(),
          c = new V(),
          n = new V(),
          vn = new V();
        let near = 0,
          bad = 0,
          badArea = 0,
          area = 0;
        const samples = [];
        for (let t = 0; t < idx.count / 3; t++) {
          const i = [idx.getX(t * 3), idx.getX(t * 3 + 1), idx.getX(t * 3 + 2)];
          a.fromBufferAttribute(pos, i[0]).applyMatrix4(m.matrixWorld);
          if (Math.hypot(a.x - M.x, a.z - M.z) > 70) continue;
          b.fromBufferAttribute(pos, i[1]).applyMatrix4(m.matrixWorld);
          c.fromBufferAttribute(pos, i[2]).applyMatrix4(m.matrixWorld);
          n.subVectors(b, a).cross(c.clone().sub(a));
          const ar = n.length() / 2;
          if (ar < 1e-6) continue;
          n.normalize();
          near++;
          area += ar;
          let minDot = 1;
          for (const k of i) {
            vn.fromBufferAttribute(nor, k).normalize();
            minDot = Math.min(minDot, vn.dot(n));
          }
          const ang = (Math.acos(Math.min(1, minDot)) * 180) / Math.PI;
          if (ang > 15 && ar > 20) {
            bad++;
            badArea += ar;
            if (samples.length < 6)
              samples.push({
                ang: +ang.toFixed(1),
                area: +ar.toFixed(0),
                at: [a.x, a.y, a.z].map((x) => +x.toFixed(0)),
                n: [n.x, n.y, n.z].map((x) => +x.toFixed(2)),
              });
          }
        }
        if (near)
          out.push({
            mat: m.material.type,
            colors: !!g.attributes.color,
            normType: nor.array.constructor.name,
            tris: idx.count / 3,
            near,
            bad,
            badArea: +badArea.toFixed(0),
            area: +area.toFixed(0),
            samples,
          });
      });
      return out;
    },
    { M },
  );
  console.log(JSON.stringify(r, null, 1));
}
if (process.env.OVERLAP) {
  const r = await p.evaluate(
    ({ M }) => {
      const w = window.woodrail;
      const out = [];
      const Box = new w.camera.position.constructor().constructor;
      w.scene.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh && !o.isBatchedMesh) return;
        if (!o.geometry?.attributes?.position) return;
        o.updateWorldMatrix(true, false);
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
        if (o.isInstancedMesh || o.isBatchedMesh) {
          out.push({
            name: o.name,
            type: o.type,
            count: o.count,
            parent: o.parent?.name,
            visible: o.visible,
          });
          return;
        }
        if (bb.max.x < M.x - 40 || bb.min.x > M.x + 40 || bb.max.z < M.z - 40 || bb.min.z > M.z + 40) return;
        let path = [];
        for (let q = o; q; q = q.parent) path.push(q.name || q.type);
        out.push({
          path: path.slice(0, 4).join("<"),
          mat: o.material?.type,
          tris: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
          box: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map((x) => Math.round(x)),
          visible: o.visible,
          layers: o.layers.mask,
          receive: o.receiveShadow,
          cast: o.castShadow,
        });
      });
      return out;
    },
    { M },
  );
  console.log(JSON.stringify(r));
}
const shot = async (name, dist) => {
  const half = Math.min(Math.floor(Math.min(W, H) / 2) - 1, Math.max(48, Math.round(Number(process.env.CROP ?? 60000) / dist)));
  await p.screenshot({
    path: `${OUT}/${TAG}-${name}.png`,
    clip: {
      x: W / 2 - half,
      y: H / 2 - half,
      width: half * 2,
      height: half * 2,
    },
  });
};
const DISTS = (process.env.DISTS ?? "900,1600,2400").split(",").map(Number);
const THETAS = (process.env.THETAS ?? `${M.theta.toFixed(2)},0.98,2.2,-0.6`).split(",").map(Number);
for (const theta of THETAS) {
  for (const dist of DISTS) {
    await p.evaluate(
      ({ x, z, dist, theta, phi }) => {
        const w = window.woodrail;
        w.director.glideTo(new w.camera.position.constructor(x, 0, z), dist, {
          duration: 0.1,
          phi,
          theta,
        });
      },
      { x: M.x, z: M.z, dist, theta, phi: Number(process.env.PHI ?? 0.95) },
    );
    await settle();
    await shot(`th${theta}-d${dist}`, dist);
    // Each suspect switched off alone, the same frame drawn again.
    for (const off of (process.env.TOGGLES ?? "").split(",").filter(Boolean)) {
      await p.evaluate((off) => {
        const w = window.woodrail;
        const set = (on) => {
          if (off === "receive")
            w.depotView.group.traverse((o) => {
              if (o.isMesh) {
                o.receiveShadow = on;
                o.material.needsUpdate = true;
              }
            });
          if (off === "shadows") w.stage.sun.castShadow = on;
          if (off === "bump") {
            w.mats.paint.bumpMap = on ? (window.__bump ??= w.mats.paint.bumpMap) : null;
            window.__bump ??= w.mats.paint.bumpMap;
            w.mats.paint.needsUpdate = true;
          }
        };
        if (off === "bump") window.__bump = w.mats.paint.bumpMap;
        window.__restore = () => set(true);
        set(false);
        w.invalidate();
      }, off);
      await settle();
      await shot(`th${theta}-d${dist}-no${off}`, dist);
      await p.evaluate(() => {
        window.__restore();
        window.woodrail.invalidate();
      });
      await settle();
    }
    if (process.env.FULL)
      await p.screenshot({
        path: `${OUT}/${TAG}-th${theta}-d${dist}-full.png`,
      });
    console.log(theta, dist, JSON.stringify(await info()));
  }
}
// The camera turning a little at a time (as a drag does): z-fighting shimmers from frame to frame, the same face drawn
// in a different patchwork of greys at each step.
if (process.env.ORBIT) {
  const [t0, t1, n, dist] = process.env.ORBIT.split(",").map(Number);
  for (let i = 0; i < n; i++) {
    const theta = t0 + ((t1 - t0) * i) / Math.max(1, n - 1);
    await p.evaluate(
      ({ x, z, dist, theta, phi }) => {
        const w = window.woodrail;
        w.director.glideTo(new w.camera.position.constructor(x, 0, z), dist, {
          duration: 0.05,
          phi,
          theta,
        });
      },
      { x: M.x, z: M.z, dist, theta, phi: Number(process.env.PHI ?? 0.95) },
    );
    await settle();
    await shot(`orbit${i}`, dist);
  }
}
await b.close();
await server.close();
