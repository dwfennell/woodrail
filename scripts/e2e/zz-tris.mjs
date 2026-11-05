import { chromium } from "playwright-core";
import { createServer } from "vite";
const server = await createServer({ server: { port: 0 }, logLevel: "error" });
await server.listen(); await server.warmupRequest("/src/main.ts");
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const q = await ctx.newPage();
await q.goto(URL);
await q.waitForFunction(() => !!window.woodrail && [...document.querySelectorAll("button")].some((b) => /let.s play/i.test(b.textContent ?? "")), null, { timeout: 180000 });
await q.evaluate(() => [...document.querySelectorAll("button")].find((b) => /let.s play/i.test(b.textContent ?? ""))?.click());
await q.waitForFunction(() => document.querySelector(".tray-draw") !== null && window.woodrail.layout.pieceCount > 0 && !window.woodrail.director.busy, null, { timeout: 60000 });
for (const cam of [null, [-481, -1440.2, 3662.2]]) {
  const r = await q.evaluate(async (cam) => {
    const w = window.woodrail; const V = w.camera.position.constructor;
    if (cam) w.lookAt(new V(cam[0], 0, cam[1]), cam[2], 0.95, -1.1659);
    await w.settled();
    const info = w.renderer.info; info.autoReset = false; info.reset();
    const by = new Map(); let n = 0;
    const tot = [];
    w.scene.traverse((o) => { if (!o.isMesh && !o.isInstancedMesh) return; o.onBeforeRender = ((prev) => function (r, s, c, g) { let x = this; let path = []; while (x && x !== w.scene) { path.unshift(x.name || x.type); x = x.parent; } const k = path.slice(0, 4).join("/") + " :" + (this.material?.name || this.material?.type || ""); const idx = g.index ? g.index.count : g.attributes.position.count; const draw = Math.min(idx, g.drawRange.count) / 3 * (this.isInstancedMesh ? this.count : 1); const e = by.get(k) ?? [0, 0]; e[0] += draw; e[1]++; by.set(k, e); })(o.onBeforeRender); });
    w.invalidate(); await w.settled(); by.clear(); info.reset(); w.invalidate(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const res = [...by.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 25).map(([k, [t, c]]) => `${(t / 1e3).toFixed(0)}k tris ${c} draws  ${k}`);
    return { tris: info.render.triangles, calls: info.render.calls, frames: info.render.frame, res };
  }, cam);
  console.log(JSON.stringify(r, null, 1));
}
await b.close(); await server.close();
