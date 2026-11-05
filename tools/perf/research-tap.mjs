// The research board's tap, on its own: opens the late Game map on a 390×844 phone (CPU throttled), then taps the
// Research button (and closes it) a few times, timing the tap handler and, with a trace, the style and layout work
// it forces. For the research board's refresh (docs/agents/perf.md). Run after a build.
//
//   node tools/perf/research-tap.mjs [--root <dir with dist/>] [--throttle 4] [--taps 4] [--map late-game.txt] [--trace out.json]
//       [--profile out.cpuprofile]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";
import { chromium } from "playwright-core";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? d : args[i + 1];
};
const THROTTLE = Number(opt("throttle", 4));
const TAPS = Number(opt("taps", 4));
const TRACE = opt("trace", null);
/** A CPU profile of the taps (all of them), written here. */
const PROFILE = opt("profile", null);
const server = await preview({ root: opt("root", process.cwd()), preview: { port: 0 }, logLevel: "warn" });
const BASE = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
  headless: false,
  args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.stats.asked", "1");
});
await page.addInitScript(readFileSync(`${HERE}/instrument.js`, "utf8"));
const map = readFileSync(`${HERE}/maps/${opt("map", "late-game.txt")}`, "utf8").trim();
await page.goto(`${BASE}?dev#load=${map}`);
await page.waitForFunction(() => window.__perf?.readyAt !== null && window.woodrail, null, { timeout: 300000 });
await page.evaluate((ms) => Promise.race([window.woodrail.trayThumbnailsSaved(), new Promise((r) => setTimeout(r, ms))]), 120000);
await page.evaluate(() => Promise.race([window.woodrail.settled(5), new Promise((r) => setTimeout(r, 15000))]));
const cdp = await ctx.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
const taps = [];
if (PROFILE) {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
  await cdp.send("Profiler.start");
}
for (let i = 0; i < TAPS; i++) {
  const traced = TRACE && i === TAPS - 1;
  const events = [];
  if (traced) {
    cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
    await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack", transferMode: "ReportEvents" });
  }
  const r = await page.evaluate(async () => {
    const el = document.querySelector("button.research-btn");
    const t0 = performance.now();
    el.click();
    const sync = performance.now() - t0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { syncMs: Math.round(sync * 10) / 10, toFrameMs: Math.round((performance.now() - t0) * 10) / 10 };
  });
  if (traced) {
    const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
    await cdp.send("Tracing.end");
    await done;
    writeFileSync(TRACE, JSON.stringify(events));
    const sum = {};
    for (const e of events) if (e.ph === "X" && e.dur) sum[e.name] = (sum[e.name] ?? 0) + e.dur / 1000;
    r.trace = Object.fromEntries(Object.entries(sum).filter(([k]) => /Layout|Style|Paint|FunctionCall|EventDispatch|ParseHTML|Composite|Script/.test(k)).map(([k, v]) => [k, Math.round(v)]));
  }
  taps.push(r);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
}
if (PROFILE) writeFileSync(PROFILE, JSON.stringify((await cdp.send("Profiler.stop")).profile));
console.log(JSON.stringify(taps, null, 1));
const sync = taps.map((t) => t.syncMs).sort((a, b) => a - b);
console.log(`tap handler ms: median ${sync[Math.floor(sync.length / 2)]}, all ${sync.join(", ")}`);
await browser.close();
await server.close();
