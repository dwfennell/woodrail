// Pictures of signals on a busy line (the user: signals "kind of overwhelm the ui", and a signal by a crossover stood on
// its other road): Sandbox on a 390×844 phone at 2×, a line out and back round a half circle with a crossover on it,
// a pair of signals on every joint. A close-up at a crossover (as the user's picture), the line at a phone's usual zoom, and
// zoomed out. Setup only: the pieces laid by the editor where `placement` allows, the signals by `addSignals` on every
// joint end with room (as the Signal tool would put them), the camera placed by the director, the game paused.
//
// Usage: node tools/shots/signals-quiet.mjs [<out dir>] [<prefix>]   (default out: docs/agents/shots, prefix signals-quiet;
// THETAS=a,b,… takes the close-up from each of those camera angles)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
const PREFIX = process.argv[3] ?? "signals-quiet";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("page error:", e.message));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const shot = async (name) => {
  await frames();
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${PREFIX}-${name}.jpg`, type: "jpeg", quality: 82, timeout: 120000 });
  console.log(`${OUT}/${PREFIX}-${name}.jpg`);
};
const look = async (at, dist, phi, theta) => {
  await p.evaluate(([at, dist, phi, theta]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(at.x, 0, at.z), dist, { phi, theta, duration: 0.2 }), [at, dist, phi, theta]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
};

try {
  // (A linked map, the same each run, so the before and after pictures frame the same place: flat, no water.)
  await p.goto(`${PAGE}#seed-4242-flat-water-none-nocoast`);
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && (window.woodrail.title?.shown || !!document.querySelector("#loading.done")), null, { timeout: 240000 });
  await p.evaluate(() => window.woodrail.title?.shown && [...document.querySelectorAll(".title-card.mode-sandbox button")].find((b) => !b.hidden && b.classList.contains("primary"))?.click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.keyboard.press("Escape");
  const built = await p.evaluate(async () => {
    const w = window.woodrail;
    for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
    const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    const S = "straight-216";
    // The line: 2 straights, a crossover, 3 straights, round a half circle of curves and 6 straights back. Its second
    // line: 2 straights behind the crossover, none on past it (as the user's: a lone pair at its far end, not a gantry).
    const C = "curve-large";
    const seq = [S, S, "crossover", S, S, S, C, C, C, C, S, S, S, S, S, S];
    let why = "";
    for (let ring = 1; ring < 20; ring++)
      for (let k = 0; k < 32; k++) {
        const a = ((k >> 1) * Math.PI) / 8;
        let t = { x: Math.round((Math.cos(a) * ring * 360) / 18) * 18, z: Math.round((Math.sin(a) * ring * 360) / 18) * 18, heading: (k & 1) * Math.PI, y: 0 };
        const ids = [];
        let ok = true;
        const lay = (type, pose, y) => {
          const r = w.interaction.placement(type, false, pose, y, -1);
          if (r.reason) {
            why = `${type}: ${r.reason}`;
            return -1;
          }
          const id = w.editor().place(type, pose, y, false, r.risers);
          ids.push(id);
          return id;
        };
        const xs = [];
        for (const type of seq) {
          const id = lay(type, { x: t.x, z: t.z, heading: t.heading }, t.y);
          if (id === -1) {
            ok = false;
            break;
          }
          if (type === "crossover") xs.push(id);
          t = c(id, 1);
        }
        if (ok) {
          let u = c(xs[0], 2);
          for (let i = 0; i < 2 && ok; i++) {
            const pose = { x: u.x + Math.cos(u.heading) * 216, z: u.z + Math.sin(u.heading) * 216, heading: u.heading + Math.PI };
            const id = lay(S, pose, u.y);
            if (id === -1) ok = false;
            else u = c(id, 0);
          }
        }
        if (ok) {
          // A pair on every joint end with room (as the Signal tool puts them).
          const ends = [];
          for (const id of ids) for (let k = 0; k < 4; k++) if (w.layout.getPiece(id) && w.layout.joinedConnector(id * 8 + k) !== -1) ends.push(id * 8 + k);
          const mod = await import("/src/game/signal-place.ts");
          const room = mod.hasRoom ? (e) => mod.hasRoom(w.layout, e) : () => true;
          w.editor().addSignals(ends.filter((e) => !w.layout.signalAt(e) && room(e)));
          // (Every third held red, to see both aspects.)
          [...w.layout.signals()].forEach((m, i) => i % 3 === 0 && w.sim.setMarkMode(m.id, "red"));
          w.paused = true;
          w.invalidate();
          const x0 = c(xs[0], 1);
          const mid = { x: 0, z: 0 };
          for (const id of ids) {
            mid.x += w.layout.getPiece(id).pose.x / ids.length;
            mid.z += w.layout.getPiece(id).pose.z / ids.length;
          }
          return { ids: ids.length, signals: [...w.layout.signals()].length, crossover: { x: x0.x, z: x0.z }, mid };
        }
        for (const id of ids.reverse()) w.editor().remove(id);
      }
    return { error: why };
  });
  console.log(JSON.stringify(built));
  if (built.error) throw new Error(built.error);
  // The close-up at the first crossover's far end (the user's picture), the line at a phone's zoom, zoomed out.
  for (const th of (process.env.THETAS ?? "-2.2").split(",").map(Number)) {
    await look(built.crossover, 560, 0.95, th);
    await shot(process.env.THETAS ? `1-crossover-${th}` : "1-crossover");
  }
  await look(built.mid, 1600, 0.7, 0.6);
  await shot("2-phone");
  await look(built.mid, 3400, 0.6, 0.6);
  await shot("3-zoomed-out");
  const draws = await p.evaluate(() => ({ marks: window.woodrail.marksView.drawCalls, calls: window.woodrail.renderer.info.render.calls }));
  console.log("draws", JSON.stringify(draws));
} catch (e) {
  console.log("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await b.close();
  await server.close();
}
