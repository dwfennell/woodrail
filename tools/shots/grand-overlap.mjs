// The grand exhibition on a placed workshop's yard (report 2026-11-22, src/play/bugmaps/reports/2026-11-22-grand-
// exhibition-overlap.txt) on a 1280×738 desktop page: "before", the site as the player's save has it; "after", the
// site taken away and found again by `siteSpot` (src/game/grand.ts, the page's own module) and put up there, as Start
// would now. Setup only: the map is the user's.
//
// Usage: node tools/shots/grand-overlap.mjs <out dir>
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const [OUT = "e2e-out/grand-overlap"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const text = readFileSync(`${ROOT}/src/play/bugmaps/reports/2026-11-22-grand-exhibition-overlap.txt`, "utf8").trim();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5414, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 738 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("page error:", e.message));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const shot = async (name) => { await frames(); await p.waitForTimeout(1500); await p.screenshot({ path: `${OUT}/grand-overlap-${name}.jpg`, type: "jpeg", quality: 85, timeout: 120000 }); console.log(`${OUT}/grand-overlap-${name}.jpg`); };
const look = async (x, z, dist) => {
  await p.evaluate(([x, z, dist]) => { const w = window.woodrail; w.director.glideTo(new w.controls.target.constructor(x, 0, z), dist, { phi: 0.75, duration: 0.2 }); }, [x, z, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
};
try {
  await p.goto(`${PAGE}#load=${encodeURIComponent(text)}`);
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  await p.keyboard.press("Escape");
  await p.evaluate(() => (window.woodrail.paused = true));
  const old = await p.evaluate(() => { const s = [...window.woodrail.props.all()].find((q) => q.asset.startsWith("grand-exhibition-")); return { id: s.id, x: s.x, z: s.z }; });
  await look(old.x - 40, old.z + 60, 900);
  await shot("before");
  const after = await p.evaluate(async (oldId) => {
    const w = window.woodrail;
    const grand = await import("/src/game/grand.ts");
    const g = grand.grandOf("exhibition");
    for (let i = 0; i <= g.stages.length; i++) await w.propLibrary.load(grand.siteAsset(g, i));
    const fp = grand.unionFootprint(Array.from({ length: g.stages.length + 1 }, (_, i) => w.propLibrary.footprint(grand.siteAsset(g, i))), g.scale);
    const s = w.props.get(oldId);
    w.props.remove(oldId);
    const town = w.landscape.towns.find((t) => t.name === "Rookhurst");
    const spot = grand.siteSpot(w.world, town, fp, w.propLibrary.footprint);
    w.props.add(s.asset, spot, oldId, { scale: s.scale });
    w.propsChanged();
    w.invalidate();
    return spot;
  }, old.id);
  console.log("old", old, "new", after);
  await look((old.x + after.x) / 2 - 40, (old.z + after.z) / 2 + 60, 1100);
  await shot("after");
} catch (e) { console.log("FAILED:", e.message); process.exitCode = 1; } finally { await b.close(); await server.close(); }
