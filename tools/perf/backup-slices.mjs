// What a save-safety backup (src/persist/backups.ts, spec docs/superpowers/specs/2026-11-26-save-safety.md) holds the
// main thread for at once, on a map's keys, in Chromium on a quiet page (not the game's, whose own frames would hide
// it): `BackupStore.take`'s wall time and its longest hold (the biggest gap in a chain of 0 ms timers), each of
// `--runs` copies, beside the same keys packed all at once as a parked game's are (`packKeys`, the way a backup was
// taken before it was done in idle slices). `--cpu 4`: the CPU slowed 4× (about a mid phone's). No frame is to be
// held over about 16 ms.
//
// Usage: node tools/perf/backup-slices.mjs [--map <a "Copy map for a bug report" file>] [--cpu 4] [--runs 6]
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? d : process.argv[i + 1];
};
const CPU = Number(arg("cpu", 1));
const RUNS = Number(arg("runs", 6));
const TEXT = readFileSync(arg("map", `${ROOT}/src/persist/fixtures/2026-11-23-lift-warehouse-game.txt`), "utf8").trim();
const COPY = JSON.parse(gunzipSync(Buffer.from(TEXT.slice("woodrail-map:1:".length).replace(/-/g, "+").replace(/_/g, "/"), "base64")).toString());

const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5454, strictPort: false }, logLevel: "error" });
await server.listen();
const b = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium" });
const p = await b.newPage();
await p.goto(`${server.resolvedUrls.local[0]}package.json`);
// (Vite's first run may reload the page as it bundles a module's dependencies: try again until it's settled.)
for (let i = 0; i < 5; i++) {
  try {
    await p.evaluate(() => import("/src/persist/backups.ts"));
    await p.waitForTimeout(2000);
    await p.evaluate(() => 1);
    break;
  } catch {
    await p.waitForTimeout(2000);
  }
}
if (CPU > 1) await (await p.context().newCDPSession(p)).send("Emulation.setCPUThrottlingRate", { rate: CPU });
const out = await p.evaluate(
  async ({ keys, runs }) => {
    const { BackupStore, keysHash } = await import("/src/persist/backups.ts");
    // (The game's keys, as GAME_SLOT_KEYS has them: save.ts itself isn't imported here, only what a backup uses.)
    const live = ["woodrail.game.v2", "woodrail.game.v2.session", "woodrail.game.goals.v1", "woodrail.game.stickers.v1", "woodrail.game.progress.v1"];
    const SLOT = { live, save: live[0], session: live[1], goals: live[2], progress: live[4] };
    const store = { getItem: (k) => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v), removeItem: (k) => localStorage.removeItem(k) };
    // The all-at-once way (packKeys and unpackKeys in slots.ts, cloud.ts's gzip): one stream each, the keys in one go.
    const gzip = async (t) => new Uint8Array(await new Response(new Blob([t]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer());
    const gunzip = async (u) => await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    const toB64 = (bytes) => {
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const atOnce = async (k) => {
      const hash = keysHash(k);
      const packed = toB64(await gzip(JSON.stringify(k)));
      localStorage.setItem("x", packed);
      const back = JSON.parse(await gunzip(fromB64(localStorage.getItem("x"))));
      return keysHash(back) === hash;
    };
    const timed = async (f) => {
      let longest = 0;
      let probing = true;
      let last = performance.now();
      const tick = () => {
        const t = performance.now();
        longest = Math.max(longest, t - last);
        last = t;
        if (probing) setTimeout(tick, 0);
      };
      setTimeout(tick, 0);
      await new Promise((r) => setTimeout(r, 50));
      const t0 = performance.now();
      await f();
      const wall = performance.now() - t0;
      await new Promise((r) => setTimeout(r, 20));
      probing = false;
      return { wall: +wall.toFixed(1), longest: +longest.toFixed(1) };
    };
    const own = Object.fromEntries(live.filter((k) => typeof keys[k] === "string").map((k) => [k, keys[k]]));
    const res = { atOnce: [], sliced: [] };
    for (let i = 0; i < runs; i++) {
      localStorage.clear();
      res.atOnce.push(await timed(() => atOnce(own)));
      localStorage.clear();
      // (A different session each time, so each is a copy taken, not the last one given back.)
      const k = { ...own, [SLOT.session]: JSON.stringify({ ...JSON.parse(own[SLOT.session] ?? "{}"), run: i }) };
      res.sliced.push(await timed(() => new BackupStore(store, SLOT).take("g", k, "kept")));
    }
    return { res, chars: Object.values(own).reduce((a, v) => a + v.length, 0) };
  },
  { keys: COPY.keys, runs: RUNS },
);
const show = (l) => l.map((r) => `${r.longest}`).join(", ");
const med = (l, f) => [...l].map(f).sort((x, y) => x - y)[l.length >> 1];
console.log(`CPU ×${CPU}, ${RUNS} runs, ${out.chars.toLocaleString()} chars of keys`);
console.log(`  all at once (as before): longest hold ${show(out.res.atOnce)} ms; wall ${med(out.res.atOnce, (r) => r.wall)} ms (median)`);
console.log(`  in idle slices (take):   longest hold ${show(out.res.sliced)} ms; wall ${med(out.res.sliced, (r) => r.wall)} ms (median)`);
await b.close();
await server.close();
