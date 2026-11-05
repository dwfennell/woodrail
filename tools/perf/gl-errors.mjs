// Which draws the browser refuses (GL errors), by program: a page like a Pixel 10, the late map, a few frames checked
// draw by draw with getError. node tools/perf/gl-errors.mjs <root with dist/> [late|sandbox]
import { chromium } from "playwright-core";
import { preview } from "vite";
import { readFileSync } from "node:fs";
const [root, mapId = "late"] = process.argv.slice(2);
const maps = { late: "late-game.txt", sandbox: "big-sandbox.txt" };
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const early = [];
page.on("console", (m) => { if (/GL_INVALID|GL ERROR/.test(m.text()) && early.length < 5) early.push(m.text().slice(0, 200)); });
await page.addInitScript(() => { localStorage.setItem("woodrail.helpSeen", "1"); localStorage.setItem("woodrail.stats.asked", "1"); });
// Every draw checked from the start: the first refusal of each program, with the textures bound to its samplers.
await page.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype;
  const found = (window.__glErrors = new Map());
  let unit = 0;
  const bound = new Map();
  const ab = P.activeTexture, bt = P.bindTexture, tp = P.texParameteri;
  const compare = new WeakMap(), fmt = new WeakMap();
  P.activeTexture = function (u) { unit = u - this.TEXTURE0; return ab.call(this, u); };
  P.bindTexture = function (t, x) { bound.set(`${unit}:${t}`, x); return bt.call(this, t, x); };
  P.texParameteri = function (t, p, v) { if (p === this.TEXTURE_COMPARE_MODE) compare.set(bound.get(`${unit}:${t}`), v); return tp.call(this, t, p, v); };
  for (const n of ["texImage2D", "texStorage2D"]) { const f = P[n]; P[n] = function (...a) { const x = bound.get(`${unit}:${a[0]}`); if (x) fmt.set(x, a[2].toString(16)); return f.apply(this, a); }; }
  for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
    const f = P[name];
    P[name] = function (...a) {
      if (this.__checking === false) return f.apply(this, a);
      while (this.getError());
      const r = f.apply(this, a);
      const e = this.getError();
      if (e) {
        const prog = this.getParameter(this.CURRENT_PROGRAM);
        const info = (window.__programs?.() ?? []).find((p) => p.program === prog);
        const key = `${e.toString(16)} ${info?.name ?? "?"}`;
        if (!found.has(key)) {
          const n = this.getProgramParameter(prog, this.ACTIVE_UNIFORMS), samplers = [];
          for (let i = 0; i < n; i++) {
            const u = this.getActiveUniform(prog, i);
            if (![this.SAMPLER_2D, this.SAMPLER_2D_SHADOW, this.SAMPLER_CUBE, this.SAMPLER_2D_ARRAY, this.SAMPLER_3D, this.SAMPLER_CUBE_SHADOW].includes(u.type)) continue;
            const v = this.getUniform(prog, this.getUniformLocation(prog, u.name));
            const t = this.TEXTURE_2D;
            const tex = bound.get(`${v}:${u.type === this.SAMPLER_CUBE ? this.TEXTURE_CUBE_MAP : u.type === this.SAMPLER_2D_ARRAY ? this.TEXTURE_2D_ARRAY : t}`);
            samplers.push(`${u.name}:${u.type === this.SAMPLER_2D_SHADOW ? "shadow" : u.type.toString(16)}→unit${v} fmt=${fmt.get(tex)} cmp=${compare.get(tex) ?? "-"}`);
          }
          found.set(key, { count: 0, at: Math.round(performance.now()), fb: !!this.getParameter(this.FRAMEBUFFER_BINDING), samplers, frames: window.woodrail?.framesDrawn });
        }
        found.get(key).count++;
      }
      return r;
    };
  }
});
let url = BASE();
function BASE() { return server.resolvedUrls.local[0]; }
if (maps[mapId]) url = `${url}?dev#load=${readFileSync(`tools/perf/maps/${maps[mapId]}`, "utf8").trim()}`;
await page.goto(url);
await page.waitForFunction(() => window.woodrail?.renderer, null, { timeout: 600000 });
await page.evaluate(() => { const r = window.woodrail.renderer; window.__programs = () => r.info.programs.map((p) => ({ program: p.program, name: p.name })); });
await page.waitForFunction(() => window.woodrail.framesDrawn > 3 && document.querySelector("#loading.done") && !window.woodrail.title.shown, null, { timeout: 600000 });
const before = await page.evaluate(() => [...window.__glErrors.entries()].map(([k, v]) => ({ k, ...v })));
await page.evaluate(async () => { const w = window.woodrail; for (let i = 0; i < 6; i++) { w.renderer.shadowMap.needsUpdate = true; w.invalidate(); const f = w.framesDrawn; while (w.framesDrawn === f) await new Promise((r) => requestAnimationFrame(r)); } });
const after = await page.evaluate(() => [...window.__glErrors.entries()].map(([k, v]) => ({ k, ...v })));
console.log(JSON.stringify({ early, before, after }, null, 1));
await browser.close(); await server.close();
