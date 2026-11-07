// The shader programs a map ends up with (`node tools/perf/programs.mjs [<root>] [<map file>]`, after a build): each
// program's material type, and for the shadow pass's depth programs what tells them apart (their cache keys' parts
// that differ). For cutting the number of programs compiled at load.
import { preview } from "vite";
import { chromium } from "playwright-core";
import { readFileSync } from "fs";
const [root = process.cwd(), mapFile] = process.argv.slice(2);
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await page.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await page.goto(server.resolvedUrls.local[0] + (mapFile ? "?dev#load=" + readFileSync(mapFile, "utf8").trim() : ""));
await page.waitForFunction(() => window.woodrail?.title?.shown !== undefined, null, { timeout: 300000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.woodrail.title.shown && [...document.querySelectorAll(".title-card button")].find((x) => !x.hidden && x.offsetParent && x.classList.contains("primary"))?.click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await page.waitForFunction(() => !window.woodrail.title.shown && document.querySelector("#loading.done"), null, { timeout: 300000 });
await page.waitForTimeout(8000);
const out = await page.evaluate(() => window.woodrail.renderer.info.programs.map((p) => ({ name: p.name, key: p.cacheKey })));
const by = {};
for (const p of out) by[p.name] = (by[p.name] ?? 0) + 1;
console.log(JSON.stringify(by));
const groups = {};
for (const p of out) (groups[p.key.split(",")[0] || p.name] ??= []).push(p.key.split(","));
for (const [name, keys] of Object.entries(groups)) {
  if (keys.length < 2) continue;
  const n = Math.max(...keys.map((k) => k.length));
  const differ = [];
  for (let i = 0; i < n; i++) if (new Set(keys.map((k) => k[i])).size > 1) differ.push(i);
  console.log(`\n${name} x${keys.length}: differing key parts at ${differ.join(" ")}`);
  for (const k of keys) console.log("  " + differ.map((i) => k[i]).join(" | ").slice(0, 300));
}
await b.close();
await server.close();
