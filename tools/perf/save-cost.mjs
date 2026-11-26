// What a Game-mode autosave costs, with and without save safety's write guard (spec
// docs/superpowers/specs/2026-11-26-save-safety.md), and what a backup costs and takes up, on the user's map
// (src/persist/fixtures/2026-11-23-lift-warehouse-game.txt), in Chromium on a 390×844 page (a dev server: compare the
// two, not the numbers with a build's). Each is timed `RUNS` times, alternating, and the median printed; `--cpu 4` runs
// with the CPU slowed 4× (about a mid phone's).
//
// Usage: node tools/perf/save-cost.mjs [--cpu 4] [--runs 40]
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? d : Number(process.argv[i + 1]);
};
const CPU = arg("cpu", 1);
const RUNS = arg("runs", 40);
const TEXT = readFileSync(`${ROOT}/src/persist/fixtures/2026-11-23-lift-warehouse-game.txt`, "utf8").trim();
const COPY = JSON.parse(gunzipSync(Buffer.from(TEXT.slice("woodrail-map:1:".length).replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString());

const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5451, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await ctx.addInitScript((keys) => {
  if (sessionStorage.getItem("save-cost.seeded")) return;
  sessionStorage.setItem("save-cost.seeded", "1");
  localStorage.clear();
  localStorage.setItem("woodrail.helpSeen", "1");
  for (const [k, v] of Object.entries(keys)) localStorage.setItem(k, v);
  localStorage.setItem("woodrail.lastMode", "game");
  sessionStorage.setItem("woodrail.resume", "game");
}, COPY.keys);
const p = await ctx.newPage();
await p.goto(server.resolvedUrls.local[0]);
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
await p.evaluate(() => (window.woodrail.paused = true));
if (CPU > 1) await (await ctx.newCDPSession(p)).send("Emulation.setCPUThrottlingRate", { rate: CPU });

const out = await p.evaluate(async (runs) => {
  const w = window.woodrail;
  const { autosaveGame } = await import("/src/persist/startup.ts");
  const { WriteGuard } = await import("/src/persist/write-guard.ts");
  const { BackupStore } = await import("/src/persist/backups.ts");
  const { GAME_SLOT_KEYS } = await import("/src/persist/save.ts");
  const store = { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v), removeItem: (k) => localStorage.removeItem(k) };
  const safety = { guard: new WriteGuard(), backups: new BackupStore(store, GAME_SLOT_KEYS), say: () => {} };
  const session = { clock: w.simSeconds, paused: true, journal: { entries: [], seq: 0, readSeq: 0 } };
  const progress = w.progress().toJSON();
  const time = (f) => {
    const t0 = performance.now();
    f();
    return performance.now() - t0;
  };
  // (Warm: the first of each compiles; the guard's first check parses what's stored once a page.)
  autosaveGame(w.world, w.slots, session, progress);
  const first = time(() => autosaveGame(w.world, w.slots, session, progress, safety));
  const before = [];
  const after = [];
  for (let i = 0; i < runs; i++) {
    before.push(time(() => autosaveGame(w.world, w.slots, session, progress)));
    // (The stored text the same as the guard's last write, in content: a string compare, as in play.)
    after.push(time(() => autosaveGame(w.world, w.slots, session, progress, safety)));
  }
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const t0 = performance.now();
  const copy = await safety.backups.take(w.slots.openId, w.slots.liveKeys(), "kept");
  const backupMs = performance.now() - t0;
  const live = Object.values(w.slots.liveKeys()).reduce((a, v) => a + v.length, 0);
  return { before: med(before), after: med(after), firstGuarded: first, backupMs, copyChars: copy?.chars ?? null, liveChars: live, saveChars: localStorage.getItem("woodrail.game.v2").length };
}, RUNS);
console.log(`CPU ×${CPU}, ${RUNS} runs, the user's map (${out.saveChars.toLocaleString()} chars of railway, ${out.liveChars.toLocaleString()} in all its keys)`);
console.log(`  autosave, as before:         ${out.before.toFixed(2)} ms (median)`);
console.log(`  autosave, with the guard:    ${out.after.toFixed(2)} ms (median); its first a page (parses what's stored): ${out.firstGuarded.toFixed(2)} ms`);
console.log(`  a backup (gzip, write, read back, unpack, check): ${out.backupMs.toFixed(1)} ms, off the start-up path`);
console.log(`  a backup's size: ${out.copyChars?.toLocaleString()} chars`);
await b.close();
await server.close();
