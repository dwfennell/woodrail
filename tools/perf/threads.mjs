// Which Chromium threads use the CPU while the game sits idle (`node tools/perf/threads.mjs [<seconds>] [<hash>]`,
// after a build): per process and thread name, % of a core, over a stretch after the game has settled. For finding
// what's busy when nothing should be (a worker, the GPU process, audio).
import { preview } from "vite";
import { chromium } from "playwright-core";
import { readFileSync, readdirSync } from "fs";
const seconds = Number(process.argv[2] ?? 10);
const hash = process.argv[3] ?? "";
const server = await preview({ preview: { port: 0 }, logLevel: "warn" });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await page.goto(server.resolvedUrls.local[0] + hash);
await page.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
if (!hash) {
  await page.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await page.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 240000 });
}
await page.keyboard.press("Escape");
await page.waitForTimeout(Number(process.env.WAIT ?? 15000));
const threads = () => { const m = new Map(); for (const p of readdirSync("/proc")) { if (!/^\d+$/.test(p)) continue; try { const cmd = readFileSync(`/proc/${p}/cmdline`, "utf8"); if (!/chrom/i.test(cmd)) continue; const type = (/--type=([a-z-]+)/.exec(cmd)?.[1] ?? "browser") + (/--utility-sub-type=([\w.]+)/.exec(cmd)?.[1] ? ":" + /--utility-sub-type=([\w.]+)/.exec(cmd)[1].split(".").pop() : ""); for (const t of readdirSync(`/proc/${p}/task`)) { const st = readFileSync(`/proc/${p}/task/${t}/stat`, "utf8"); const name = st.slice(st.indexOf("(") + 1, st.lastIndexOf(")")); const f = st.slice(st.lastIndexOf(")") + 2).split(" "); const k = `${type} ${name}`; m.set(k, (m.get(k) ?? 0) + (+f[11] + +f[12]) / 100); } } catch {} } return m; };
const f0 = await page.evaluate(() => window.woodrail.framesDrawn);
const a = threads(); await page.waitForTimeout(seconds * 1000); const z = threads();
const f1 = await page.evaluate(() => window.woodrail.framesDrawn);
const rows = [...z].map(([k, v]) => [k, ((v - (a.get(k) ?? 0)) / seconds) * 100]).filter(([, v]) => v > 0.5).sort((x, y) => y[1] - x[1]);
console.log(`frames drawn ${f1 - f0} in ${seconds} s`);
for (const [k, v] of rows) console.log(`${v.toFixed(1).padStart(6)}%  ${k}`);
await b.close(); await server.close();
