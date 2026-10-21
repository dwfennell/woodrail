// Switch-style screenshots: the same map, switches and cameras for each style, 360x740 at DPR 2.
// Usage: node shots.mjs <worktree root> <out dir> <prefix:style,...>   e.g. 0-current:current,1-burned:burned
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const [root, out, list] = process.argv.slice(2);
const styles = list.split(",").map((s) => s.split(":"));
const require = createRequire(root + "/package.json");
const { chromium } = require("playwright-core");
const { createServer } = await import(require.resolve("vite"));
const server = await createServer({ root, server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [prefix, style] of styles) {
  const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((st) => { localStorage.setItem("woodrail.favourites", "[]"); localStorage.setItem("woodrail.swstyle", st); }, style);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.goto(URL);
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 300000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
  await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 120000 });
  await p.evaluate(() => { const h = document.querySelector(".help"); if (h && !h.hidden) h.querySelector("button.primary, .help-card button:last-of-type")?.click(); });
  const info = await p.evaluate(async () => {
    const w = window.woodrail;
    const { poseForCentre } = await import("/src/editor/editor.ts");
    const dist = w.camera.position.distanceTo(w.controls.target);
    const g = w.interaction.groundAt(225, 300);
    const placed = [];
    const put = (type, dx, dz, state, pin) => {
      const r = w.editor().place(type, poseForCentre(type, false, g.x + dx, g.z + dz, -Math.PI / 2), 0, false);
      const id = typeof r === "number" ? r : (r?.id ?? -1);
      if (id >= 0) {
        if (state) w.layout.setSwitchState(id, state);
        if (pin) w.layout.setPinned(id, true);
        placed.push({ type, id, state, pin: !!pin });
      } else placed.push({ type, failed: true });
    };
    put("switch", -185, 0, 0);
    put("switch", -75, 0, 1);
    put("switch", 35, 0, 1, true);
    put("crossover", 165, 0, 1);
    put("switch-3way", -110, 300, 2);
    put("switch-y", 90, 300, 0, true);
    w.switchesChanged();
    w.invalidate();
    return { dist, placed, target: [g.x, g.z], style: localStorage.getItem("woodrail.swstyle") };
  });
  console.log(prefix, "start distance", Math.round(info.dist), JSON.stringify(info.placed));
  const shot = async (distance, name, before) => {
    await p.evaluate(([d, t]) => {
      const w = window.woodrail;
      w.director.glideTo(new w.camera.position.constructor(t[0] - 10, 0, t[1] + (d < 2000 ? 0 : 150)), d, { duration: 0.2 });
    }, [distance, info.target]);
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 120000 });
    if (before) await p.evaluate(before);
    await p.evaluate(() => { window.woodrail.invalidate(); return Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]); });
    if (name) await p.screenshot({ path: `${out}/${name}.png` });
    if (name) console.log("shot", name, distance);
  };
  const DEFAULT = Math.round(info.dist);
  await shot(DEFAULT, null);
  await shot(1200, `${prefix}-close`);
  await shot(DEFAULT, `${prefix}-default`);
  if (style === "glow") {
    await shot(1200, `${prefix}-close-glow`, () => window.woodrail.trackView.holdGlow(0.7));
    await shot(DEFAULT, `${prefix}-default-glow`, () => window.woodrail.trackView.holdGlow(0.7));
  }
  await ctx.close();
}
await b.close();
await server.close();
