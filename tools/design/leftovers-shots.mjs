// Design screenshots (node tools/design/leftovers-shots.mjs <out> <before|after>), not a test: before/after pictures for the locked tiles, the tray tabs and the landscape town card.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2];
const TAG = process.argv[3];
mkdirSync(OUT, { recursive: true });
const VIEWS = { "360x640": [360, 640], "390x844": [390, 844], "844x390": [844, 390] };
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5411, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const [name, [w, h]] of Object.entries(VIEWS)) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  const shot = (n) => p.screenshot({ path: `${OUT}/${name}-${n}-${TAG}.png`, timeout: 120000 }).catch((e) => console.log(`(no ${n}: ${e.message.split("\n")[0]})`));
  const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape"); await p.waitForTimeout(300); await settle();
  await p.evaluate(() => [...document.querySelectorAll("button.tab")].find((b) => b.textContent.includes("Industr"))?.click());
  await p.waitForTimeout(800); await settle();
  console.log(name, await p.evaluate(() => { const t = document.querySelector(".tabs, .tray-tabs"); return t ? `tabs scrollWidth ${t.scrollWidth} clientWidth ${t.clientWidth}` : "no tabs"; }));
  await shot("tray-industries");
  // A locked tile tapped (the Track tab's first locked one).
  await p.evaluate(() => [...document.querySelectorAll("button.tab")].find((b) => b.textContent.includes("Track"))?.click());
  await p.waitForTimeout(800); await settle();
  const box = await p.evaluate(() => { const t = [...document.querySelectorAll(".tray-item.locked")].find((x) => x.getBoundingClientRect().right < innerWidth); t?.scrollIntoView({ inline: "center" }); const r = t?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  if (box) { await p.touchscreen.tap(box.x, box.y); await p.waitForTimeout(1200); await settle(); await shot("locked-tap"); }
  await p.mouse.click(5, h / 2).catch(() => {});
  await p.evaluate(() => { const d = window.woodrail.economy.allDepots().find((d) => d.role === "town"); if (d) window.woodrail.interaction.openDepotCard(d.id); });
  await p.waitForTimeout(1500); await settle();
  console.log(name, await p.evaluate(() => { const c = [...document.querySelectorAll(".card")].find((c) => getComputedStyle(c).display !== "none" && c.offsetHeight > 0 && !c.hidden); if (!c) return "no card"; const r = c.getBoundingClientRect(); const sc = [...c.querySelectorAll("*")].filter((e) => e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY)).map((e) => `${e.className}:${e.scrollHeight}/${e.clientHeight}`); return `card ${c.className} ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)} scrolls ${sc.join(" ")}`; }));
  await shot("town-card");
  // A town further on (screenshot-only stand-in: the card's own drawLedger, fed a full ledger, the game paused so it
  // isn't redrawn): four goods, what holds it back, its school, market and station, two lines, the station's upgrades.
  await p.evaluate(async () => {
    window.woodrail.hud.togglePause?.();
    const { drawLedger } = await import("/src/ui/town-ledger.ts");
    const box = document.querySelector(".depot-card .depot-extra");
    drawLedger(box, { name: "Larkfield", level: "Village", next: "Town", have: 23, need: 40, goods: [{ icon: "🪵", label: "Planks", have: 10, need: 10 }, { icon: "🌾", label: "Grain", have: 6, need: 12 }, { icon: "🪨", label: "Stone", have: 4, need: 10 }, { icon: "🍞", label: "Flour", have: 3, need: 8 }], holding: "No mill makes flour yet: research Mills, then put one by a farm.", school: { depotId: 1, name: "Larkfield school", note: "Researching Signals" }, market: 1.5, station: { waiting: 4, room: 12, carried: 86 }, lines: [{ id: 1, name: "Red line", colour: "#c8442f", trains: 2 }, { id: 2, name: "Blue line", colour: "#2f6fb5", trains: 1 }] }, { school() {}, lines() {} });
    const up = document.createElement("div");
    up.className = "station-upgrade";
    up.innerHTML = `<div class="station-waiting">Upgrade the station</div><button class="chip text station-upgrade-btn">⬆ Two-platform station · 10🪵 (moves 2 houses)</button><div class="station-waiting">Terminus: A terminus goes only at the end of a line</div>`;
    box.append(up);
    box.hidden = false;
  });
  await p.waitForTimeout(800);
  console.log(name, "full", await p.evaluate(() => { const c = document.querySelector(".depot-card"); const r = c.getBoundingClientRect(); return `card ${Math.round(r.width)}x${Math.round(r.height)} at ${Math.round(r.x)},${Math.round(r.y)} scroll ${c.scrollHeight}/${c.clientHeight}`; }));
  await shot("town-card-full");
  await ctx.close();
}
await b.close(); await server.close();
