// Where each shader program is first compiled (`node tools/perf/program-origins.mjs [<root>] [<map file>]`, after an
// unminified build): every linkProgram's stack, grouped by the game's functions on it (the thumbnail studio, the
// shadow pass, the main render), with when it happened. For cutting programs compiled twice.
import { preview } from "vite";
import { chromium } from "playwright-core";
import { readFileSync } from "fs";
const [root = process.cwd(), mapFile] = process.argv.slice(2);
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await page.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  window.__links = [];
  Error.stackTraceLimit = 60;
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const link = C.prototype.linkProgram;
    C.prototype.linkProgram = function (p) {
      const stack = new Error().stack.split("\n").slice(2).map((l) => l.trim().replace(/^at /, "").replace(/\(.*\/assets\//, "(").replace(/\)$/, ""));
      window.__links.push({ t: Math.round(performance.now()), canvas: this.canvas?.id || this.canvas?.className || "?", stack });
      return link.call(this, p);
    };
  }
});
await page.addInitScript({ path: process.env.INJECT ?? "/dev/null" });
await page.goto(server.resolvedUrls.local[0] + (mapFile ? "?dev#load=" + readFileSync(mapFile, "utf8").trim() : ""));
await page.waitForFunction(() => window.woodrail?.title?.shown !== undefined, null, { timeout: 300000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.woodrail.title.shown && [...document.querySelectorAll(".title-card button")].find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click());
await page.waitForFunction(() => !window.woodrail.title.shown && document.querySelector("#loading.done"), null, { timeout: 300000 });
await page.waitForTimeout(Number(process.env.WAIT ?? 8000));
// DRAG=1: then a straight dragged from the tray across the map (not dropped): what that first drag compiles.
if (process.env.DRAG) {
  await page.evaluate(() => {
    window.__links.length = 0;
    window.__keysBefore = new Set(window.woodrail.renderer.info.programs.map((p) => p.cacheKey));
  });
  for (const k of await page.evaluate(() => [...window.__keysBefore].filter((k) => /rim$/.test(k)))) console.log("before:", k.slice(0, 400));
  const tile = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".tray-item[data-key]")].find((b) => /straight/.test(b.dataset.key) && b.offsetParent);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(tile.x, tile.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(tile.x, tile.y - i * 30);
  await page.waitForTimeout(3000);
  await page.mouse.move(tile.x, tile.y);
  await page.mouse.up();
  const fresh = await page.evaluate(() => window.woodrail.renderer.info.programs.filter((p) => !window.__keysBefore.has(p.cacheKey)).map((p) => p.cacheKey));
  for (const k of fresh) console.log("new program:", k.slice(0, 400));
}
const links = await page.evaluate(() => window.__links);
if (process.env.INJECT) console.log(JSON.stringify(await page.evaluate(() => window.__newProgs)));
const SKIP = /^(WebGL|getProgram|setProgram|renderBufferDirect|renderObject|renderObjects|renderScene|render |onAnimationFrame|Object\.|linkProgram|new WebGLProgram|acquireProgram|WebGLRenderer|projectObject|compile)/;
const groups = new Map();
for (const l of links) {
  const game = l.stack.filter((s) => !SKIP.test(s) && !/three\.core/.test(s)).slice(0, 3).map((s) => s.split(" (")[0]);
  const shadow = l.stack.some((s) => /WebGLShadowMap|shadowMap\.render/.test(s)) ? "shadow pass: " : "";
  const k = `${l.canvas} ${shadow}${game.join(" < ")}`;
  const g = groups.get(k) ?? { n: 0, first: l.t, last: l.t };
  g.n++;
  g.last = l.t;
  groups.set(k, g);
}
console.log(`${links.length} programs linked`);
for (const [k, g] of [...groups].sort((a, b) => b[1].n - a[1].n)) console.log(`${String(g.n).padStart(4)}  @${g.first}-${g.last} ms  ${k}`);
await b.close();
await server.close();
