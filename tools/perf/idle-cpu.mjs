// Idle CPU (the whole Chromium tree, and its audio threads) in Game on a phone-sized page: after a tap (audio started),
// wait, then sample 20 s of CPU, and log the AudioContext's state changes. Run after `npm run build`:
//   node tools/perf/idle-cpu.mjs
import { preview } from "vite";
import { chromium } from "playwright-core";
import { readFileSync, readdirSync } from "fs";
const server = await preview({ preview: { port: 0 }, logLevel: "warn" });
const url = server.resolvedUrls.local[0] + "#seed-7";
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=user-gesture-required"] });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
// Every AudioContext's state changes, with when (ms since load).
await page.addInitScript(() => {
  window.__audioStates = [];
  const Ctor = window.AudioContext;
  window.AudioContext = class extends Ctor {
    constructor(...a) {
      super(...a);
      this.addEventListener("statechange", () => window.__audioStates.push(`${this.state}@${Math.round(performance.now())}`));
    }
  };
});
await page.goto(url);
await page.waitForTimeout(8000);
await page.mouse.click(5, 400); // a gesture: unlocks audio
await page.keyboard.press("Escape");
await page.waitForTimeout(8000);
const tick = Number(process.env.CLK ?? 100);
const threads = () => { const m = new Map(); for (const p of readdirSync("/proc")) { if (!/^\d+$/.test(p)) continue; try { if (!/chrom/i.test(readFileSync(`/proc/${p}/comm`, "utf8"))) continue; for (const t of readdirSync(`/proc/${p}/task`)) { const st = readFileSync(`/proc/${p}/task/${t}/stat`, "utf8"); const name = st.slice(st.indexOf("(") + 1, st.lastIndexOf(")")); const f = st.slice(st.lastIndexOf(")") + 2).split(" "); m.set(`${p}/${t} ${name}`, (+f[11] + +f[12]) / tick); } } catch {} } return m; };
const cpu = () => { let s = 0; for (const p of readdirSync("/proc")) { if (!/^\d+$/.test(p)) continue; try { const st = readFileSync(`/proc/${p}/stat`, "utf8"); if (!/chrom/i.test(st.slice(0, 60))) continue; const f = st.slice(st.lastIndexOf(")") + 2).split(" "); s += +f[11] + +f[12]; } catch {} } return s / tick; };
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
const states = await page.evaluate(() => window.__audioStates);
const t0 = threads(); const c0 = cpu(); await page.waitForTimeout(20000); const c1 = cpu(); const t1 = threads();
const audio = [...t1].filter(([k]) => /audio/i.test(k)).reduce((s, [k, v]) => s + v - (t0.get(k) ?? 0), 0);
console.log(`audio threads: ${((audio / 20) * 100).toFixed(2)}% of a core`, [...t1].filter(([k]) => /audio/i.test(k)).map(([k]) => k.split(" ").slice(1).join(" ")));
console.log(`idle CPU: ${(((c1 - c0) / 20) * 100).toFixed(1)}% of a core (20 s)`, states);
// A later tap wakes it again (and it sleeps again after).
await page.mouse.click(5, 400);
await page.waitForTimeout(500);
console.log("after a tap:", await page.evaluate(() => window.__audioStates.slice(-1)));
await b.close(); await server.close();
