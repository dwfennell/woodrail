// The Journal's News tab with long entries, at 1160x800 and 360x740: rows must size to their text. Not a test.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/design/news";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5402, strictPort: false }, logLevel: "error" });
await server.listen();
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let bad = 0;
for (const [w, h, touch] of [[1160, 800, false], [360, 740, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const p = await ctx.newPage();
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(server.resolvedUrls.local[0]);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.keyboard.press("Escape");
  const out = await p.evaluate(async () => {
    const j = window.woodrail.journal;
    const texts = [
      "Old farm by Foxley can be restored",
      "Learned farming! Make a hopper or a farm yard at the workshop",
      "New goal: Open a farm",
      "Buttercombe grew into a village! New school: trains bring it goods to research with · Present: 10 planks, a wagon · Pick a reward",
      "Welcome to Larkfield and Buttercombe!",
    ];
    for (let i = 0; i < 14; i++) j.add({ kind: i % 3 ? "milestone" : "event", text: texts[i % texts.length], place: i % 2 ? { x: 0, z: 0 } : undefined });
    if (document.querySelector(".goals")?.classList.contains("collapsed") ?? true) document.querySelector(".goals-head")?.click();
    await new Promise((r) => setTimeout(r, 300));
    [...document.querySelectorAll("button")].find((b) => b.textContent.startsWith("News"))?.click();
    await new Promise((r) => setTimeout(r, 300));
    const rows = [...document.querySelectorAll(".news-item")];
    const overflow = rows.filter((r) => r.scrollHeight > r.clientHeight + 1 || r.querySelector(".news-text").getBoundingClientRect().bottom > r.getBoundingClientRect().bottom + 1).length;
    return { rows: rows.length, overflow };
  });
  console.log(w, out);
  if (!out.rows || out.overflow) bad++;
  await p.screenshot({ path: `${OUT}/news-${w}.png` });
  await ctx.close();
}
await b.close();
await server.close();
process.exit(bad ? 1 : 0);
