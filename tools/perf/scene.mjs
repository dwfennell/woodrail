// What the scene holds to draw (`node tools/perf/scene.mjs [<root with dist/>] [<map file>]`, after a build; an
// unminified build names things: `vite build --minify false`): its biggest meshes by triangles (instances counted),
// with their owners' class names, and the shadow casters' share. For finding what to batch or slim.
import { preview } from "vite";
import { chromium } from "playwright-core";
import { readFileSync } from "fs";
const [root = process.cwd(), mapFile] = process.argv.slice(2);
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await page.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await page.goto(server.resolvedUrls.local[0] + (mapFile ? "?dev#load=" + readFileSync(mapFile, "utf8").trim() : ""));
await page.waitForFunction(() => window.woodrail?.title?.shown !== undefined, null, { timeout: 300000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.woodrail.title.shown && [...document.querySelectorAll(".title-card button")].find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await page.waitForFunction(() => !window.woodrail.title.shown && document.querySelector("#loading.done"), null, { timeout: 300000 });
await page.waitForTimeout(8000);
const out = await page.evaluate(() => {
  const w = window.woodrail;
  const rows = [];
  const path = (o) => {
    const p = [];
    for (let x = o; x && x !== w.scene; x = x.parent) p.unshift(x.name || x.userData?.kind || x.constructor.name);
    return p.slice(0, 3).join("/");
  };
  let total = 0;
  let cast = 0;
  w.scene.traverseVisible((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const per = (g.index ? g.index.count : g.attributes.position.count) / 3;
    const n = o.isInstancedMesh ? o.count : 1;
    const t = Math.min(per, Number.isFinite(g.drawRange.count) ? g.drawRange.count / 3 : per) * n;
    total += t;
    if (o.castShadow) cast += t;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    rows.push({ k: Math.round(t / 1000), what: `${path(o)} ${o.isInstancedMesh ? `x${n} ` : ""}[${m?.name || m?.type}]${o.castShadow ? " casts" : ""}${o.layers.mask !== 1 ? ` layers ${o.layers.mask}` : ""}` });
  });
  return { totalK: Math.round(total / 1000), castK: Math.round(cast / 1000), rows: rows.sort((a, b) => b.k - a.k).slice(0, 30) };
});
console.log(`visible triangles ${out.totalK}k, of them casting shadows ${out.castK}k`);
for (const r of out.rows) console.log(`${String(r.k).padStart(6)}k  ${r.what}`);
await b.close();
await server.close();
