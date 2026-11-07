// Issue #31's ring, said on the cards: the user's map (src/play/bugmaps/signal-green-held.txt) in the game on a
// 1280×738 page, ticked 30 s in the page. Teasel (Blue) stands at the signal the player put inside the passing loop's
// road, its tail over the loop's points; pictured: the loop, Muffin's engine card, and that signal's card.
//
// Usage: node tools/shots/issue-31-loop.mjs <copied map file> <out dir> [<prefix>]   (docs/agents/shots/issue-31-loop-*)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const [MAP, OUT, PREFIX = "issue-31-loop"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const text = readFileSync(MAP, "utf8").trim();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5416, strictPort: false }, logLevel: "error" });
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
const shot = async (name) => { await frames(); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${PREFIX}-${name}.jpg`, type: "jpeg", quality: 85, timeout: 120000 }); console.log(`${OUT}/${PREFIX}-${name}.jpg`); };
const look = async (pieces, dist, phi = 0.9, theta) => {
  await p.evaluate(([pieces, dist, phi, theta]) => {
    const w = window.woodrail; let x = 0; let z = 0;
    for (const id of pieces) { const q = w.layout.getPiece(id).pose; x += q.x / pieces.length; z += q.z / pieces.length; }
    w.director.glideTo(new w.controls.target.constructor(x, 0, z), dist, { phi, theta, duration: 0.2 });
  }, [pieces, dist, phi, theta]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
};
const report = async () => console.log(await p.evaluate(() => {
  const w = window.woodrail;
  const lines = [`t=${w.simSeconds.toFixed(1)}`];
  for (const id of w.sim.trainIds()) {
    const t = w.sim.getTrain(id); const e = t.cars.find((c) => c.kind === "engine");
    lines.push(`train ${id} engine ${e.id} piece ${t.bogies[0].pieceId} s ${t.bogies[0].s.toFixed(2)} v ${Math.round(t.speed)} redAhead ${w.sim.redSignalKeyAhead(id)}`);
  }
  lines.push("marks " + w.sim.signalList().map((s) => `${s.key}@${s.pieceId}:${s.clear ? "G" : "R"}`).join(" "));
  return lines.join("\n");
}));
/** Tick the sim and economy `s` seconds in the page (paused: the frame loop doesn't), then draw. */
const tickFor = async (s) => {
  await p.evaluate((s) => { const w = window.woodrail; for (let i = 0; i < s * 120; i++) { w.sim.tick(); w.economy.tick(); } w.invalidate(); }, s);
  await frames();
};
try {
  await p.goto(`${PAGE}#load=${encodeURIComponent(text)}`);
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
  await p.keyboard.press("Escape");
  await p.evaluate(() => (window.woodrail.paused = true));
  await tickFor(30);
  await look([19, 173, 9], 900, 0.7);
  await shot("loop");
  await p.evaluate(() => window.woodrail.interaction.openEngineCard(44));
  await p.waitForTimeout(800);
  await shot("muffin-card");
  await p.evaluate(() => {
    const w = window.woodrail;
    w.hud.hideCards?.();
    w.interaction.selectMark(w.layout.signalAt(19 * 8 + 0).id);
  });
  await p.waitForTimeout(800);
  await shot("signal-card");
} catch (e) { console.log("FAILED:", e.message); process.exitCode = 1; } finally { await b.close(); await server.close(); }
