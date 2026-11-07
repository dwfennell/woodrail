// Issue #32's ring of waits, labelled: the user's map (src/play/bugmaps/signal-added-still-stuck.txt) in the game on a
// 1280×738 page, nobody giving way (test-only: no turning round, no other road), ticked 30 s in the page, each of the
// four trains labelled with what it waits for (from sections and the sim, as their cards read them). Run at a commit
// before the fix (009dd4d) for the jam; after it, the same steps show them running.
//
// Usage: node tools/shots/issue-32-ring.mjs <copied map file> <out jpg>
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const [MAP, OUT] = process.argv.slice(2);
const text = readFileSync(MAP, "utf8").trim();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5415, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 738 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("page error:", e.message));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
try {
  await p.goto(`${PAGE}#load=${encodeURIComponent(text)}`);
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  await p.keyboard.press("Escape");
  await p.evaluate(() => {
    const w = window.woodrail;
    w.paused = true;
    w.sim.turnNow = () => null;
    w.economy.router.giveWayRoad = () => false;
    for (let i = 0; i < 30 * 120; i++) { w.sim.tick(); w.economy.tick(); }
    // (Framed over the four trains: the middle of their engines, from high up.)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const e of [30, 34, 44, 52]) for (const f of w.sim.findCar(e).train.world) { x0 = Math.min(x0, f.x); x1 = Math.max(x1, f.x); z0 = Math.min(z0, f.z); z1 = Math.max(z1, f.z); }
    const span = Math.max(x1 - x0, (z1 - z0) * 1.7);
    w.director.glideTo(new w.controls.target.constructor((x0 + x1) / 2, 0, (z0 + z1) / 2), span * 1.25 + 600, { phi: 0.25, duration: 0.2 });
    w.hud.hideCards?.();
    w.invalidate();
  });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
  await p.waitForTimeout(800);
  const labels = await p.evaluate(() => {
    const w = window.woodrail;
    const S = w.economy.sections;
    const line = { 30: "Red", 34: "Blue", 44: "Yellow", 52: "no route" };
    const name = (e) => `${w.sim.nameOf(e) || "engine " + e} (${line[e] ?? "?"})`;
    const said = {
      44: (st) => (st?.move ? `sent into the passing loop behind ${name(34)} (road ${st.move.dest}), the loop's other road empty: its signal stays red` : "?"),
      34: (st) => `in the loop, waits for the sawmill: ${name(st?.wait?.engine ?? -1)} is there`,
      52: (st) => `hand-run; waits for the line where ${name(st?.wait?.engine ?? -1)} stands`,
      30: (st) => `waits for the place past the forest: ${name(st?.wait?.engine ?? -1)}'s tail is in it`,
    };
    const out = [];
    for (const e of [44, 34, 52, 30]) {
      const t = w.sim.findCar(e).train;
      const f = t.world[0];
      const v = new w.controls.target.constructor(f.x, f.y + 40, f.z).project(w.camera);
      out.push({ x: (v.x + 1) * 640, y: (1 - v.y) * 369, text: `${name(e)}: ${said[e](S.states.get(e))}` });
    }
    return out;
  });
  await p.evaluate((labels) => {
    // (Only the map: the HUD hidden.)
    for (const el of document.body.children) if (el.id !== "scene" && !el.contains(document.getElementById("scene"))) el.style.visibility = "hidden";
    for (const l of labels) {
      const d = document.createElement("div");
      d.textContent = l.text;
      Object.assign(d.style, { position: "fixed", left: `${Math.min(Math.max(8, l.x - 150), 1280 - 320)}px`, top: `${Math.max(8, l.y - 70)}px`, width: "300px", font: "600 13px system-ui", background: "rgba(255,250,240,.95)", border: "2px solid #c0392b", borderRadius: "8px", padding: "6px 8px", zIndex: 99999, pointerEvents: "none" });
      document.body.appendChild(d);
      const dot = document.createElement("div");
      Object.assign(dot.style, { position: "fixed", left: `${l.x - 7}px`, top: `${l.y - 7}px`, width: "14px", height: "14px", borderRadius: "7px", background: "#c0392b", border: "2px solid white", zIndex: 99999 });
      document.body.appendChild(dot);
    }
  }, labels);
  for (const l of labels) console.log(l.text);
  await p.screenshot({ path: OUT, type: "jpeg", quality: 85, timeout: 120000 });
  console.log(OUT);
} catch (e) { console.log("FAILED:", e.message); process.exitCode = 1; } finally { await b.close(); await server.close(); }
