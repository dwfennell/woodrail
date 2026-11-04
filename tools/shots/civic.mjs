// Mock pictures for the civic and leisure spec (docs/superpowers/specs/2026-11-04-civic-leisure-design.md), on a phone
// (390×844): Larkfield grown to a City, its card with the proposed Places and Treats rows, the paint shop sheet, and
// the town with a park, a fountain and a playground standing in it. Nothing here is built: the rows and the sheet are
// DOM put into the real card (a mock), and growth is written as deliveries (a harness shortcut, as in e2e:town-shape).
//
// Usage: node tools/shots/civic.mjs [<out dir>]   (default out: docs/agents/shots; the committed pictures are these PNGs saved as JPEG)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
p.on("pageerror", (e) => console.log("pageerror:", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (name) => p.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// Larkfield to a City, a level at a time (growth is the game's own, on the next frame drawn).
for (let level = 1; level <= 3; level++) {
  await p.evaluate(async (level) => {
    const { townLevel } = await import("/src/game/towns.ts");
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    const bag = {};
    for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n;
    w.economy.delivered.set(t.id, bag.planks ?? 0);
    w.economy.deliveredGoods.set(t.id, bag);
    w.invalidate();
  }, level);
  await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 30000 }).catch(() => console.log(`(level ${level} not seen)`));
  await p.waitForTimeout(1200);
  await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
}
await p.evaluate(() => {
  const pr = window.woodrail.progress();
  pr.coins = 640;
});

// ---- 1. the town with its places (catalogue props put down beside it: a mock of what the Build button does) ----
const placed = await p.evaluate(() => {
  const w = window.woodrail;
  const t = w.world.landscape.towns[0];
  const g = w.world.landscape.grid;
  const out = [];
  const used = new Set();
  // A free grass square near (dx, dz) from the centre, nothing on it or on its neighbours' track (a mock: the spec's
  // Build button would ask `nextLots` for a lot, as treats do).
  const tryAt = (asset, dx, dz) => {
    const c0 = g.cellAtWorld(t.centre.x + dx, t.centre.z + dz);
    const col0 = g.colOf(c0);
    const row0 = g.rowOf(c0);
    for (let r = 0; r <= 4; r++)
      for (let dc = -r; dc <= r; dc++)
        for (let dr = -r; dr <= r; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== r) continue;
          const c = g.cellAtWorld(g.centreX(col0 + dc), g.centreZ(row0 + dr));
          if (c < 0 || used.has(c) || g.surface[c] !== 0 || g.feature[c] !== 0) continue;
          const x = g.centreX(g.colOf(c));
          const z = g.centreZ(g.rowOf(c));
          if ([...w.world.props.all()].some((q) => Math.hypot(q.x - x, q.z - z) < 60)) continue;
          used.add(c);
          w.world.props.add(asset, { x, z, heading: 0, y: g.groundY(c) });
          return out.push({ asset, x, z });
        }
    out.push({ asset, failed: true });
  };
  // A little park in one corner of town: the bandstand, trees and a bench round it; the fountain and playground by.
  tryAt("scene-bandstand", 250, 250);
  for (const a of ["scene-lollipop-tree", "scene-autumn-tree", "scene-bench", "scene-flower-bed", "scene-fountain", "scene-playground", "scene-lollipop-tree", "scene-park-gate"]) tryAt(a, 250, 250);
  w.propsChanged();
  w.invalidate();
  return out;
});
console.log("placed:", JSON.stringify(placed));
await p.evaluate(async () => {
  const w = window.woodrail;
  const t = w.world.landscape.towns[0];
  const V = w.camera.position.constructor;
  w.lookAt(new V(t.centre.x, 0, t.centre.z), 1500, 0.8);
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
});
await p.waitForTimeout(1500);
await settle();

// ---- 2. the town card with Places (civic and leisure) and Treats -----------------------------------------------
const CSS = `
.mock-sec { margin: 12px 0 4px; padding-top: 10px; border-top: 1px dashed rgba(90,60,30,.25); }
.mock-sec h4 { margin: 0 0 2px; font-size: 15px; color: #5a3c1e; display: flex; justify-content: space-between; align-items: baseline; }
.mock-sec h4 small { font-weight: 500; font-size: 12.5px; color: #7a5a3a; }
.mock-sub { margin: 0 0 8px; font-size: 12.5px; color: #7a5a3a; }
.mock-smiles { font-size: 18px; letter-spacing: 2px; }
.mock-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.mock-tile { display: flex; flex-direction: column; gap: 3px; padding: 8px 9px; border-radius: 12px; background: #fffaf0; border: 2px solid #e2cfae; min-height: 44px; font-size: 12.5px; color: #5a3c1e; }
.mock-tile b { font-size: 14px; display: flex; gap: 6px; align-items: center; }
.mock-tile .ic { font-size: 22px; }
.mock-tile .what { color: #6b5038; line-height: 1.25; }
.mock-tile .buy { margin-top: 4px; align-self: stretch; text-align: center; padding: 7px 4px; border-radius: 10px; background: #3f7d3a; color: #fff; font-weight: 700; font-size: 13px; }
.mock-tile .buy.short { background: #c9b48f; color: #5a3c1e; }
.mock-tile.have { background: #eef6e6; border-color: #9cc48a; }
.mock-tile.have .buy { background: none; color: #3f7d3a; padding: 2px; }
.mock-tile.locked { opacity: .62; background: #f3ece0; border-style: dashed; }
.mock-tile.locked .buy { background: none; color: #7a5a3a; font-weight: 600; padding: 2px; }
.mock-sheet { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; background: #faf3e6; border-radius: 18px 18px 0 0; padding: 14px 16px 22px; box-shadow: 0 -8px 24px rgba(60,40,20,.25); font-family: inherit; color: #5a3c1e; }
.mock-sheet h3 { margin: 0 0 2px; text-align: center; font-size: 18px; }
.mock-sheet .mock-sub { text-align: center; }
.mock-sw { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0; }
.mock-sw div { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 12px; }
.mock-sw i { width: 56px; height: 56px; border-radius: 50%; border: 3px solid #fff; box-shadow: 0 0 0 2px #e2cfae; display: block; }
.mock-sw .on i { box-shadow: 0 0 0 3px #3f7d3a; }
.mock-sw .lk { opacity: .55; }
.mock-name { display: flex; gap: 8px; align-items: center; margin: 6px 0 10px; font-size: 14px; }
.mock-name span { flex: 1; padding: 10px 12px; border-radius: 10px; background: #fff; border: 2px solid #e2cfae; font-weight: 700; }
.mock-row { display: flex; gap: 8px; }
.mock-row div { flex: 1; text-align: center; padding: 12px; border-radius: 12px; font-weight: 700; background: #e9dcc4; }
.mock-row div.go { background: #3f7d3a; color: #fff; }
`;
await p.addStyleTag({ content: CSS });

const opened = await p.evaluate(() => {
  const w = window.woodrail;
  const t = w.world.landscape.towns[0];
  const d = w.world.economy.depotAtPiece(w.world.stations.get(t.id));
  w.interaction.openDepotCard(d.id);
  return { town: t.name, depot: d?.id };
});
console.log("card:", JSON.stringify(opened));
await p.waitForTimeout(800);

const tile = (ic, name, what, buy, cls = "") => `<div class="mock-tile ${cls}"><b><span class="ic">${ic}</span>${name}</b><span class="what">${what}</span><span class="buy ${buy.cls ?? ""}">${buy.text}</span></div>`;
const PLACES = `
<div class="mock-sec" id="mock-places">
  <h4>Places <small class="mock-smiles">😊😊◯◯</small></h4>
  <p class="mock-sub">2 smiles: Larkfield needs 10% fewer goods to grow.</p>
  <div class="mock-grid">
    ${tile("🏛️", "Town hall", "Name this town. Opens Places.", { text: "✓ Built" }, "have")}
    ${tile("🌳", "Park", "A bandstand and trees. +1 😊", { text: "✓ Built" }, "have")}
    ${tile("🚒", "Fire station", "A fire engine on the roads. +1 😊", { text: "Build · 120 🪙" })}
    ${tile("🎬", "Cinema", "Visitors in winter: riders pay ×1.5", { text: "Build · 200 🪙" })}
    ${tile("🏊", "Swimming baths", "Visitors all year. +1 😊", { text: "Needs 360 🪙", cls: "short" })}
    ${tile("⚽", "Sports field", "Research it at the school", { text: "🔒 Blueprint" }, "locked")}
  </div>
</div>`;
const TREATS = `
<div class="mock-sec" id="mock-treats">
  <h4>Treats <small>just for fun</small></h4>
  <p class="mock-sub">Treats don't pay. They make Larkfield look loved.</p>
  <div class="mock-grid">
    ${tile("🛝", "Playground", "Village treat", { text: "✓ Bought" }, "have")}
    ${tile("⛲", "Fountain", "Town treat", { text: "✓ Bought" }, "have")}
    ${tile("🌼", "Flower clock", "City treat", { text: "Buy · 200 🪙" })}
    ${tile("🗽", "Engine statue", "At City ★", { text: "🔒 City ★" }, "locked")}
  </div>
</div>`;
await p.evaluate(
  ({ PLACES, TREATS }) => {
    const box = document.querySelector(".depot-extra.ledger") ?? document.querySelector(".depot-extra");
    const side = box.querySelector(".ledger-side") ?? box;
    side.insertAdjacentHTML("beforeend", PLACES + TREATS);
  },
  { PLACES, TREATS },
);
await p.waitForTimeout(300);
// Scroll the card so Places is in view.
await p.evaluate(() => document.querySelector("#mock-places")?.scrollIntoView({ block: "start" }));
await p.waitForTimeout(400);
await snap("civic-places-card");
await p.evaluate(() => document.querySelector("#mock-treats")?.scrollIntoView({ block: "start" }));
await p.waitForTimeout(400);
await snap("civic-treats-card");
await p.evaluate(() => document.querySelector(".depot-card .close")?.click());
await p.waitForTimeout(500);

// ---- 3. the town itself, card shut: close on the park ------------------------------------------------------------
await p.evaluate(async (at) => {
  const w = window.woodrail;
  const V = w.camera.position.constructor;
  w.lookAt(new V(at.x + 40, 0, at.z + 60), 1050, 0.95);
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
}, placed.find((q) => q.asset === "scene-bandstand"));
await p.waitForTimeout(2500);
await settle();
await snap("civic-town-view");

// ---- 4. the paint shop sheet (a mock over the map) --------------------------------------------------------------
const SHEET = `
<div class="mock-sheet">
  <h3>🎨 Paint shop</h3>
  <p class="mock-sub">Paint Puffin in your own colours. 60 🪙 a coat.</p>
  <div class="mock-name"><span>🏷️ Puffin</span><div class="mock-row"><div>Rename</div></div></div>
  <div class="mock-sw">
    <div class="on"><i style="background:#2d6b3f"></i>As it came</div>
    <div><i style="background:#c8442f"></i>Red</div>
    <div><i style="background:#1f5aa6"></i>Royal</div>
    <div><i style="background:#e6b52c"></i>Yellow</div>
    <div><i style="background:#6b3b7a"></i>Plum<br><small>City</small></div>
    <div><i style="background:#2a2a2a"></i>Black<br><small>City</small></div>
    <div class="lk"><i style="background:linear-gradient(135deg,#f6d36b,#b8862b)"></i>🔒 Gold<br><small>City ★</small></div>
    <div class="lk"><i style="background:conic-gradient(#e44,#f90,#fd3,#4c4,#39f,#a4f,#e44)"></i>🔒 Rainbow<br><small>City ★★</small></div>
  </div>
  <div class="mock-row"><div>Close</div><div class="go">Paint red · 60 🪙</div></div>
</div>`;
await p.evaluate((SHEET) => document.body.insertAdjacentHTML("beforeend", SHEET), SHEET);
await p.waitForTimeout(300);
await snap("civic-paint-shop");

await b.close();
await server.close();
