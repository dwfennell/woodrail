// Which lever a fingertip's tap picks, on pieces with two levers a finger's width apart (a double three-way's), on a
// 390×844 phone at the default framing: the e2e's (640 mm across, the fresh page's tilt, no reframing). A double
// three-way laid at each of 8 headings; for each of its levers, the game's own touch pick (`interaction.pick(x, y,
// true)`) asked at its knob, at the top of its stick and halfway up it (as e2e:touch's tapLever taps it). Prints each
// miss and the count, and takes a picture of each heading (a ring round each knob: green, a tap there picks that lever; red, the other).
// A harness shortcut throughout (the piece laid by the editor, the view glided in code): it's for measuring.
//
// Usage: node tools/shots/lever-taps.mjs [<out dir>]   (default out: e2e-out/lever-taps)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/lever-taps";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5374, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.favourites", "[]");
});
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 30000))]));
await p.goto(`${PAGE}#seed-7`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 240000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 120000 });
await p.evaluate(() => {
  const help = document.querySelector(".help");
  if (help && !help.hidden) help.querySelector("button.primary, .help-card button:last-of-type")?.click();
  document.querySelector(".coach:not([hidden]) .coach-skip")?.click();
});
await settle();
await p.keyboard.press("Escape");

const TYPE = "switch-3way-double";
const results = [];
for (let h = 0; h < 8; h++) {
  const heading = (h * Math.PI) / 4;
  const r = await p.evaluate(
    async ({ TYPE, heading }) => {
      const w = window.woodrail;
      const { frameDistance } = await import("/src/game/camera-director.ts");
      const { checkPlacement } = await import("/src/landscape/clearance.ts");
      for (const id of [...w.layout.pieceIds()]) if (w.layout.getPiece(id).type === TYPE) w.editor().remove(id);
      // Open ground near the view's target, where the game's rule takes the piece, clear of other track.
      const t = w.controls.target;
      let at = null;
      for (let d = 0; d < 4000 && !at; d += 54) {
        const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 54));
        for (let a = 0; a < n && !at; a++) {
          const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
          const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
          if (![...w.layout.pieceIds()].every((i) => Math.hypot(w.layout.getPiece(i).pose.x - x, w.layout.getPiece(i).pose.z - z) > 600)) continue;
          if (checkPlacement(w.landscape, TYPE, false, { x, z, heading }, 0).kind === "clear") at = { x, z };
        }
      }
      if (!at) return null;
      const [id] = w.editor().placeRun([{ type: TYPE, pose: { x: at.x, z: at.z, heading }, y: 0, flipped: false }]);
      w.director.glideTo(w.controls.target.clone().set(at.x, 0, at.z), frameDistance(640, w.camera.fov, w.camera.aspect), { duration: 0.01 });
      return { id, at };
    },
    { TYPE, heading },
  );
  if (!r) {
    results.push({ heading: h * 45, error: "no room" });
    continue;
  }
  await p.waitForTimeout(400);
  await settle();
  const taps = await p.evaluate((id) => {
    const w = window.woodrail;
    w.camera.updateMatrixWorld();
    const rect = w.canvas.getBoundingClientRect();
    const levers = w.trackView.group.children.filter((c) => c.userData.kind === "switch-lever" && c.userData.pieceId === id);
    const out = [];
    for (const lever of levers) {
      lever.updateMatrixWorld(true);
      for (const [where, y] of [["knob", 31], ["stick top", 24], ["mid-stick", 14]]) {
        const v = new w.camera.position.constructor(0, y, 0).applyMatrix4(lever.matrixWorld).project(w.camera);
        const x = rect.left + ((v.x + 1) / 2) * rect.width;
        const yy = rect.top + ((1 - v.y) / 2) * rect.height;
        const pick = w.interaction.pick(x, yy, true);
        const want = lever.userData.corner ?? 0;
        const got = pick?.kind === "lever" && pick.pieceId === id ? (pick.corner ?? 0) : null;
        out.push({ lever: want, where, at: [Math.round(x), Math.round(yy)], got, ok: got === want });
      }
    }
    // A fingertip a little off: taps 4 and 8 px from each knob, 8 ways round (`off`: not the exact point).
    for (const t of out.filter((t) => t.where === "knob")) {
      for (const d of [4, 8])
        for (let a = 0; a < 8; a++) {
          const [x, yy] = [t.at[0] + d * Math.cos((a * Math.PI) / 4), t.at[1] + d * Math.sin((a * Math.PI) / 4)];
          const pick = w.interaction.pick(x, yy, true);
          const got = pick?.kind === "lever" && pick.pieceId === id ? (pick.corner ?? 0) : null;
          out.push({ lever: t.lever, where: `${d} px off the knob`, off: d, at: [Math.round(x), Math.round(yy)], got, ok: got === t.lever });
        }
    }
    const knobs = out.filter((t) => t.where === "knob").map((t) => t.at);
    return { taps: out, apart: knobs.length === 2 ? Math.round(Math.hypot(knobs[0][0] - knobs[1][0], knobs[0][1] - knobs[1][1])) : null };
  }, r.id);
  results.push({ heading: h * 45, ...taps });
  // The picture: knob marks over the canvas (green: the tap there picks that lever; red: the other).
  await p.evaluate((taps) => {
    document.querySelectorAll(".lever-tap-mark").forEach((e) => e.remove());
    for (const t of taps) {
      const m = document.createElement("div");
      m.className = "lever-tap-mark";
      Object.assign(m.style, { position: "fixed", left: `${t.at[0] - 5}px`, top: `${t.at[1] - 5}px`, width: "10px", height: "10px", boxSizing: "border-box", borderRadius: "5px", border: `1.5px solid ${t.ok ? "#1a9a3a" : "#d01818"}`, zIndex: 99, pointerEvents: "none" });
      document.body.append(m);
    }
  }, taps.taps.filter((t) => t.where === "knob"));
  await p.screenshot({ path: `${OUT}/heading-${h * 45}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture: ${e.message.split("\n")[0]})`));
  await p.evaluate(() => document.querySelectorAll(".lever-tap-mark").forEach((e) => e.remove()));
}
let misses = 0;
let total = 0;
const offTotal = { 4: 0, 8: 0 };
const offOk = { 4: 0, 8: 0 };
for (const r of results) {
  if (r.error) {
    console.log(`heading ${r.heading}°: ${r.error}`);
    continue;
  }
  const bad = r.taps.filter((t) => !t.ok && !t.off);
  const offs = [4, 8].map((d) => { const all = r.taps.filter((t) => t.off === d); return `${all.filter((t) => t.ok).length}/${all.length} at ${d} px off`; });
  for (const d of [4, 8]) {
    const all = r.taps.filter((t) => t.off === d);
    offTotal[d] += all.length;
    offOk[d] += all.filter((t) => t.ok).length;
  }
  misses += bad.length;
  total += r.taps.filter((t) => !t.off).length;
  console.log(`heading ${r.heading}°: knobs ${r.apart} px apart; ${bad.length ? bad.map((t) => `lever ${t.lever} ${t.where} at ${t.at} → ${t.got}`).join("; ") : "every tap on a lever picks it"}; ${offs.join(", ")}`);
}
console.log(`${total - misses}/${total} taps on a lever pick it; a fingertip off the knob: ${offOk[4]}/${offTotal[4]} at 4 px, ${offOk[8]}/${offTotal[8]} at 8 px${errors.length ? `; page errors: ${errors.join(" | ")}` : ""}`);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
await b.close();
await server.close();
process.exit(0);
