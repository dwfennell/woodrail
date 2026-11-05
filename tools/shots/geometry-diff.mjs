// Pictures of the late Game map from two builds at the same views, and how many pixels differ: for geometry changes
// that should look the same (welding, quantising, fewer segments, far versions). Both builds are served and drawn the
// same way (390×844 phone at DPR 2 held, the clock's time fixed, paused from the start, the HUD hidden; the trains, boats and road
// vehicles hidden, as they'd stand anywhere along their way after a load). Each view: the pixels that differ by more
// than 24 (of 255) in a channel, by more than 8, and the triangles of one full frame in each build.
//
//   node tools/shots/geometry-diff.mjs --before <dir with dist/> --after <dir with dist/> [--out <dir>] [--map late]
//
// PNGs in <out> (default e2e-out/geometry-diff), and geometry-diff.json. Run the same build twice for the noise floor.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { preview } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? d : args[i + 1];
};
const BEFORE = opt("before", ROOT);
const AFTER = opt("after", ROOT);
const OUT = opt("out", "e2e-out/geometry-diff");
const MAP_FILE = { late: "late-game.txt", sandbox: "big-sandbox.txt" }[opt("map", "late")];
mkdirSync(OUT, { recursive: true });
const MAP = readFileSync(`${ROOT}/tools/perf/maps/${MAP_FILE}`, "utf8").trim();

/** Views round a spot: `on` a town's middle, an industry, or the land's middle; `dist` from it (mm), as track-far's. */
const VIEWS = [
  { name: "town-close", on: "town", dist: 450, phi: 0.85, theta: 0.6 },
  { name: "town-normal", on: "town", dist: 1200, phi: 0.8, theta: 0.6 },
  { name: "town-low", on: "town", dist: 900, phi: 1.15, theta: 2.2 },
  { name: "industry-close", on: "industry", dist: 500, phi: 0.85, theta: 1.4 },
  { name: "industry-normal", on: "industry", dist: 1200, phi: 0.8, theta: 1.4 },
  { name: "wide", on: "middle", dist: 3500, phi: 0.7, theta: 0.6 },
  { name: "far", on: "middle", dist: 9000, phi: 0.5, theta: 0.6 },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  headless: false,
  args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

async function shoot(root, tag) {
  const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log(tag, "pageerror", e.message));
  await p.clock.setFixedTime(new Date("2026-11-05T10:10:00"));
  await p.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    localStorage.setItem("woodrail.stats.asked", "1");
    // Paused as soon as the game is there, so both builds show the map as saved (nothing grown or carried since).
    const pause = setInterval(() => {
      if (!window.woodrail) return;
      window.woodrail.paused = true;
      clearInterval(pause);
    }, 2);
  });
  await p.goto(`${server.resolvedUrls.local[0]}?dev#load=${MAP}`);
  await p.waitForFunction(() => window.woodrail?.title?.shown !== undefined, null, { timeout: 300000 });
  await p.evaluate(() => window.woodrail.title.shown && [...document.querySelectorAll(".title-card button")].find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click());
  await p.waitForFunction(() => !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 300000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(5), new Promise((r) => setTimeout(r, 60000))]));
  await p.keyboard.press("Escape");
  await p.addStyleTag({ content: "body > *:not(#scene) { visibility: hidden !important }" });
  const spots = await p.evaluate(() => {
    const w = window.woodrail;
    w.paused = true;
    // The full resolution throughout: the governor would draw slow frames (a busy machine) coarser, every edge apart.
    w.resolution.frameDrawn = () => null;
    w.resolution.ratio = 2;
    w.renderer.setPixelRatio(2);
    for (const g of [w.trainView.group, w.boats.group, w.roadVehiclesView.group]) if (g) g.visible = false;
    const land = w.landscapeView.land;
    const towns = [...land.towns].sort((a, b) => b.houses?.length - a.houses?.length || a.id - b.id);
    const town = towns[0].centre;
    const ps = [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id));
    const ind = ps.filter((q) => /sawmill|mill|mine|quarry|farm|forest|dairy|bakery/.test(q.type)).sort((a, b) => a.id - b.id)[0] ?? ps[0];
    const mx = ps.reduce((s, q) => s + q.pose.x, 0) / ps.length;
    const mz = ps.reduce((s, q) => s + q.pose.z, 0) / ps.length;
    return { town: { x: town.x, z: town.z }, industry: { x: ind.pose.x, z: ind.pose.z, type: ind.type }, middle: { x: mx, z: mz } };
  });
  const out = {};
  for (const v of VIEWS) {
    const c = spots[v.on];
    const info = await p.evaluate(
      async ({ v, c }) => {
        const w = window.woodrail;
        w.director.glideTo(new w.camera.position.constructor(c.x, 0, c.z), v.dist, { duration: 0.05, phi: v.phi, theta: v.theta });
        await new Promise((r) => setTimeout(r, 400));
        await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 30000))]);
        for (const g of [w.trainView.group, w.boats.group, w.roadVehiclesView.group]) if (g) g.visible = false;
        if (w.renderer.getPixelRatio() !== 2) throw new Error(`drawn at ${w.renderer.getPixelRatio()}, not 2`);
        // One full frame's triangles (shadows too), drawn again until they stop changing: far versions are made when the
        // page is idle after the first frame that wants them, and drawn on the next.
        const info = w.renderer.info;
        const frame = async () => {
          info.autoReset = false;
          info.reset();
          const f0 = w.framesDrawn;
          w.renderer.shadowMap.needsUpdate = true;
          w.invalidate();
          while (w.framesDrawn === f0) await new Promise((r) => requestAnimationFrame(r));
          const n = info.render.triangles;
          info.autoReset = true;
          return n;
        };
        let triangles = await frame();
        for (let k = 0; k < 8; k++) {
          await new Promise((r) => setTimeout(r, 1500));
          const n = await frame();
          if (n === triangles) break;
          triangles = n;
        }
        await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 30000))]);
        return { triangles };
      },
      { v, c },
    );
    const file = `${OUT}/${v.name}-${tag}.png`;
    const png = await p.screenshot({ path: file, timeout: 300000, animations: "allow", caret: "initial" });
    out[v.name] = { ...info, file, png: png.toString("base64") };
  }
  await ctx.close();
  await server.close();
  return { spots, shots: out };
}

const before = await shoot(BEFORE, "before");
const after = await shoot(AFTER, "after");
const page = await browser.newPage();
const results = { spots: before.spots, views: {} };
for (const v of VIEWS) {
  const a = before.shots[v.name];
  const b = after.shots[v.name];
  const diff = await page.evaluate(
    async ({ a, b }) => {
      const load = async (b64) => {
        const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext("2d");
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const [x, y] = await Promise.all([load(a), load(b)]);
      let over24 = 0;
      let over8 = 0;
      let max = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
        if (d > 24) over24++;
        if (d > 8) over8++;
        if (d > max) max = d;
      }
      const n = x.length / 4;
      return { over24Pct: Math.round((over24 / n) * 100000) / 1000, over8Pct: Math.round((over8 / n) * 100000) / 1000, max };
    },
    { a: a.png, b: b.png },
  );
  results.views[v.name] = { ...v, triangles: { before: a.triangles, after: b.triangles }, pixelsDiffering: diff, files: [a.file, b.file] };
  console.log(`${v.name.padEnd(16)} triangles ${a.triangles} -> ${b.triangles}; pixels differing >24: ${diff.over24Pct}%, >8: ${diff.over8Pct}%, max ${diff.max}`);
}
writeFileSync(`${OUT}/geometry-diff.json`, JSON.stringify(results, null, 1));
await browser.close();
