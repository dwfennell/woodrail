// Idle cost (`node tools/perf/idle-frames.mjs [<root with a dist/>]`, after a build): CPU of the Chromium tree and frames drawn over 20 s, in Game (a fresh game) and Sandbox (#seed-7), 390×844.
import { preview } from "vite";
import { chromium } from "playwright-core";
import { readFileSync, readdirSync } from "fs";
const root = process.argv[2] ?? process.cwd();
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const tick = 100;
const cpu = () => { let s = 0; for (const p of readdirSync("/proc")) { if (!/^\d+$/.test(p)) continue; try { const st = readFileSync(`/proc/${p}/stat`, "utf8"); if (!/chrom/i.test(st.slice(0, 60))) continue; const f = st.slice(st.lastIndexOf(")") + 2).split(" "); s += +f[11] + +f[12]; } catch {} } return s / tick; };
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const mode of ["sandbox", "game"]) {
  const page = await b.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await page.goto(server.resolvedUrls.local[0] + (mode === "sandbox" ? "#seed-7" : ""));
  await page.waitForFunction(() => window.woodrail?.title?.shown !== undefined, null, { timeout: 240000 });
  if (mode === "game") {
    await page.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
    await page.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
    await page.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  }
  await page.waitForTimeout(10000);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(6000);
  const f0 = await page.evaluate(() => window.woodrail.framesDrawn); const c0 = cpu();
  await page.waitForTimeout(20000);
  const c1 = cpu(); const f1 = await page.evaluate(() => window.woodrail.framesDrawn);
  console.log(`${mode}: idle CPU ${(((c1 - c0) / 20) * 100).toFixed(1)}% of a core, frames drawn ${f1 - f0} in 20 s`);
  await page.close();
}
await b.close(); await server.close();
