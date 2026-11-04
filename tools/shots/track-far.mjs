// Pictures of track carved and in its far version (`buildPieceFar`, `TrackView.setDetail`): the big Sandbox perf map on
// a 390×844 phone (DPR 2), at a few zooms, each view drawn three ways: every piece carved, as the game draws it (far
// where a millimetre is under `FAR_TRACK_PX_PER_MM` pixels), and every piece far. For each, how many pixels differ from
// the carved picture (by more than a little), and the triangles drawn. Run after a build (it serves dist/).
//
//   node tools/shots/track-far.mjs [<out dir>] [--root <dir with dist/>]   (default out: e2e-out/track-far)
//
// PNGs; the committed JPEGs in docs/agents/shots are these, compressed.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { preview } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const rootAt = args.indexOf("--root");
const OUT = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root") ?? "e2e-out/track-far";
mkdirSync(OUT, { recursive: true });
const MAP = readFileSync(`${ROOT}/tools/perf/maps/big-sandbox.txt`, "utf8").trim();
const server = await preview({ root: rootAt >= 0 ? args[rootAt + 1] : ROOT, preview: { port: 0 }, logLevel: "warn" });
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  headless: false,
  args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.stats.asked", "1");
});
await p.goto(`${server.resolvedUrls.local[0]}?dev#load=${MAP}`);
await p.waitForFunction(() => window.woodrail?.mode?.() && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 300000 });
await p.evaluate(() => Promise.race([window.woodrail.settled(5), new Promise((r) => setTimeout(r, 60000))]));
await p.keyboard.press("Escape");
// The world alone: the HUD hidden, paused (the trains stand still), and the track's detail overridable.
await p.addStyleTag({ content: "body > *:not(#scene) { visibility: hidden !important }" });
const centre = await p.evaluate(() => {
  const w = window.woodrail;
  w.paused = true;
  const tv = w.trackView;
  const own = tv.setDetail.bind(tv);
  window.__detail = "auto";
  tv.setDetail = (eye, scale) => own(eye, window.__detail === "near" ? 1e12 : window.__detail === "far" ? 1e-9 : scale);
  // A curve near the middle of the track.
  const ps = [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id));
  const mx = ps.reduce((s, q) => s + q.pose.x, 0) / ps.length;
  const mz = ps.reduce((s, q) => s + q.pose.z, 0) / ps.length;
  const c = ps.filter((q) => q.type.startsWith("curve")).sort((a, b) => Math.hypot(a.pose.x - mx, a.pose.z - mz) - Math.hypot(b.pose.x - mx, b.pose.z - mz))[0];
  return { x: c.pose.x, z: c.pose.z };
});

const VIEWS = {
  close: { dist: 450, phi: 0.85, theta: 0.6 },
  normal: { dist: 1200, phi: 0.8, theta: 0.6 },
  wide: { dist: 3500, phi: 0.7, theta: 0.6 },
  far: { dist: 9000, phi: 0.5, theta: 0.6 },
};
const results = {};
for (const [name, v] of Object.entries(VIEWS)) {
  await p.evaluate(
    async ({ v, c }) => {
      const w = window.woodrail;
      w.director.glideTo(new w.camera.position.constructor(c.x, 0, c.z), v.dist, { duration: 0.05, phi: v.phi, theta: v.theta });
      await new Promise((r) => setTimeout(r, 400));
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 30000))]);
    },
    { v, c: centre },
  );
  const shots = {};
  for (const mode of ["near", "auto", "far"]) {
    const info = await p.evaluate(async (mode) => {
      const w = window.woodrail;
      window.__detail = mode;
      // One frame's triangles (every render call of it: shadows, the scene, the post passes), as tools/perf counts them.
      const info = w.renderer.info;
      info.autoReset = false;
      info.reset();
      const f0 = w.framesDrawn;
      w.renderer.shadowMap.needsUpdate = true;
      w.invalidate();
      while (w.framesDrawn === f0) await new Promise((r) => requestAnimationFrame(r));
      const triangles = info.render.triangles;
      info.autoReset = true;
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 30000))]);
      return { triangles };
    }, mode);
    const file = `${OUT}/track-far-${name}-${mode}.png`;
    const png = await p.locator("#scene").screenshot({ path: file });
    shots[mode] = { ...info, file, png: png.toString("base64") };
  }
  // Pixels differing from the carved picture by more than 24 (of 255) in any channel, and the largest difference.
  const diff = await p.evaluate(async (s) => {
    const load = async (b64) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height).data;
    };
    const [near, auto, far] = await Promise.all([load(s.near), load(s.auto), load(s.far)]);
    const cmp = (a) => {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.max(Math.abs(a[i] - near[i]), Math.abs(a[i + 1] - near[i + 1]), Math.abs(a[i + 2] - near[i + 2])) > 24) n++;
      return Math.round((n / (a.length / 4)) * 100000) / 1000;
    };
    return { autoPct: cmp(auto), farPct: cmp(far) };
  }, { near: shots.near.png, auto: shots.auto.png, far: shots.far.png });
  results[name] = {
    ...v,
    triangles: { carved: shots.near.triangles, game: shots.auto.triangles, allFar: shots.far.triangles },
    pixelsDifferingPct: { game: diff.autoPct, allFar: diff.farPct },
    files: Object.fromEntries(Object.entries(shots).map(([k, s]) => [k, s.file])),
  };
  console.log(name, JSON.stringify(results[name]));
}
writeFileSync(`${OUT}/track-far.json`, JSON.stringify(results, null, 1));
await b.close();
await server.close();
