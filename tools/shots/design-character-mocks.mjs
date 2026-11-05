// Mock-ups for docs/superpowers/specs/2026-11-05-character-and-goals.md, drawn over the real game on a 390×844 phone:
// HTML laid over the canvas, and a few catalogue props put down by hand (a harness shortcut: `props.add`, for looking
// only). Nothing here is a feature; the numbers on the mocks are illustrative.
//
// Usage: node tools/shots/design-character-mocks.mjs [<out dir>]   (default out: docs/agents/shots)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5392, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const ONLY = process.env.ONLY?.split(",");
const want = (name) => !ONLY || ONLY.includes(name);

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
await settle();

// ---- helpers -------------------------------------------------------------------------------------------------
const CSS = `
#mock { position: fixed; inset: 0; z-index: 1000; pointer-events: none; font-family: "Woodrail Icons", "Nunito", system-ui, sans-serif; color: #2b2118; }
#mock .sheet { position: absolute; left: 12px; right: 12px; background: rgba(250,243,230,0.98); border-radius: 18px; box-shadow: 0 10px 34px rgba(60,40,20,0.32); padding: 14px 16px 16px; }
#mock h2 { margin: 0; font-size: 21px; font-weight: 900; text-align: center; color: #3a2a1c; }
#mock .sub { text-align: center; font-size: 13px; color: #74522f; margin-top: 2px; font-weight: 700; }
#mock .chip { display: inline-block; background: #dff0d8; color: #2f5a27; border-radius: 999px; padding: 3px 11px; font-weight: 800; font-size: 13px; }
#mock .chip.trade { background: #d6e8f5; color: #1f4d73; }
#mock .chip.gold { background: #fbe7b0; color: #6a4a0c; }
#mock .row { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; margin-top: 9px; }
#mock .row .bar { flex: 1; height: 10px; background: #efe2cc; border-radius: 6px; overflow: hidden; }
#mock .row .bar i { display: block; height: 100%; background: #8fd08a; border-radius: 6px; }
#mock .row .n { min-width: 46px; text-align: right; font-weight: 800; }
#mock .line { font-size: 13.5px; line-height: 1.35; color: #5e4128; margin-top: 8px; }
#mock .line b { color: #2b2118; }
#mock hr { border: 0; border-top: 1px solid rgba(176,122,68,0.25); margin: 10px 0 4px; }
#mock .choice { display: flex; gap: 10px; align-items: center; background: #fffaf0; border-radius: 14px; box-shadow: inset 0 -4px 0 rgba(176,122,68,0.28), 0 2px 8px rgba(60,40,20,0.12); padding: 10px 12px; margin-top: 10px; }
#mock .choice .ic { font-size: 30px; width: 44px; text-align: center; }
#mock .choice .t { font-weight: 900; font-size: 16px; }
#mock .choice .d { font-size: 12.5px; color: #5e4128; line-height: 1.3; margin-top: 2px; }
#mock .pin { position: absolute; transform: translate(-50%, -100%); background: rgba(250,243,230,0.97); border-radius: 12px; padding: 4px 9px; font-weight: 900; font-size: 13px; box-shadow: 0 4px 12px rgba(60,40,20,0.3); white-space: nowrap; }
#mock .pin::after { content: ""; position: absolute; left: 50%; bottom: -6px; transform: translateX(-50%); border: 6px solid transparent; border-bottom: 0; border-top-color: rgba(250,243,230,0.97); }
#mock .region { position: absolute; border-radius: 16px; border: 3px dashed rgba(255,255,255,0.85); display: grid; place-items: start center; padding-top: 8px; }
#mock .region span { background: rgba(43,33,24,0.72); color: #fff; font-weight: 900; font-size: 13px; padding: 3px 10px; border-radius: 999px; }
#mock .ribbon { position: absolute; left: 12px; right: 12px; top: 74px; background: rgba(250,243,230,0.96); border-radius: 16px; box-shadow: 0 4px 18px rgba(60,40,20,0.2); padding: 7px 12px; display: flex; align-items: center; gap: 8px; font-weight: 900; font-size: 14px; }
#mock .ribbon .bar { flex: 1; height: 10px; background: #efe2cc; border-radius: 6px; overflow: hidden; }
#mock .ribbon .bar i { display: block; height: 100%; background: linear-gradient(90deg, #e9b949, #d9902c); }
#mock .stage { display: flex; gap: 10px; align-items: flex-start; margin-top: 9px; font-size: 13.5px; }
#mock .stage .dot { width: 26px; height: 26px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 900; font-size: 13px; background: #efe2cc; color: #74522f; }
#mock .stage.done .dot { background: #8fd08a; color: #13310f; }
#mock .stage.now .dot { background: #e9b949; color: #3a2a1c; }
#mock .goods { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
#mock .goods span { background: #fffaf0; border-radius: 8px; padding: 2px 7px; font-weight: 800; font-size: 13px; box-shadow: inset 0 -2px 0 rgba(176,122,68,0.25); }
#mock .note { position: absolute; left: 12px; right: 12px; bottom: 8px; text-align: center; font-size: 11px; font-weight: 800; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
#mock .btn { display: inline-block; background: #5aa35a; color: #fff; font-weight: 900; border-radius: 12px; padding: 9px 16px; box-shadow: inset 0 -4px 0 rgba(0,0,0,0.18); }
#mock .toast { position: absolute; left: 30px; right: 30px; background: #fdf3cf; border-left: 6px solid #e9b949; border-radius: 10px; padding: 10px 14px; font-weight: 900; font-size: 15px; box-shadow: 0 4px 14px rgba(60,40,20,0.25); }
`;
await p.addStyleTag({ content: CSS });

const overlay = (html, hide = []) =>
  p.evaluate(
    ({ html, hide }) => {
      document.getElementById("mock")?.remove();
      document.querySelectorAll("[data-mock-hidden]").forEach((el) => {
        el.style.visibility = "";
        el.removeAttribute("data-mock-hidden");
      });
      for (const sel of hide)
        document.querySelectorAll(sel).forEach((el) => {
          el.style.visibility = "hidden";
          el.setAttribute("data-mock-hidden", "1");
        });
      const d = document.createElement("div");
      d.id = "mock";
      d.innerHTML = html;
      document.body.append(d);
    },
    { html, hide },
  );
const clear = () => overlay("", []);
const shot = async (name) => {
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/design-character-${name}.jpg`, type: "jpeg", quality: 80, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  console.log("shot", name);
};
const look = (x, z, dist, phi = 0.8, theta = null) =>
  p.evaluate(
    async ({ x, z, dist, phi, theta }) => {
      const w = window.woodrail;
      w.lookAt(new w.camera.position.constructor(x, 0, z), dist, phi, theta);
      w.invalidate();
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    },
    { x, z, dist, phi, theta },
  );
/** The camera at (dist, phi, theta), panned so world point (x, z) shows at screen (sx, sy). */
const frame = async (x, z, dist, phi, theta, sx, sy) => {
  await look(x, z, dist, phi, theta);
  const s0 = await screenOf(x, z);
  const sx1 = await screenOf(x + 100, z);
  const sz1 = await screenOf(x, z + 100);
  // Moving the target by d moves the point on screen by -J d.
  const a = (sx1.x - s0.x) / 100, b = (sz1.x - s0.x) / 100, c = (sx1.y - s0.y) / 100, d = (sz1.y - s0.y) / 100;
  const ex = s0.x - sx, ey = s0.y - sy;
  const det = a * d - b * c;
  const dx = (d * ex - b * ey) / det, dz = (-c * ex + a * ey) / det;
  await look(x + dx, z + dz, dist, phi, theta);
};
/** Screen position (CSS px) of a world point, for pins. */
const screenOf = (x, z, y = 0) =>
  p.evaluate(
    ({ x, z, y }) => {
      const w = window.woodrail;
      const v = new w.camera.position.constructor(x, y, z).project(w.camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    },
    { x, z, y },
  );
/** Catalogue props put down by hand (looks only). */
const props = (list) =>
  p.evaluate(async (list) => {
    const w = window.woodrail;
    const g = w.world.landscape.grid;
    for (const [asset, x, z, heading = 0, scale] of list) {
      const y = g.groundY(g.cellAtWorld(x, z));
      w.props.add(asset, { x, z, heading, y }, undefined, scale ? { scale } : {});
    }
    w.propsChanged();
    w.invalidate();
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  }, list);
/** Every town to `level` (deliveries written as trains would bring them; growth is TownLife's own). */
const growAll = async (level) => {
  await p.evaluate(async (level) => {
    const { townLevel } = await import("/src/game/towns.ts");
    const w = window.woodrail;
    const bag = {};
    for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n;
    for (const t of w.world.landscape.towns) {
      w.economy.delivered.set(t.id, bag.planks ?? 0);
      w.economy.deliveredGoods.set(t.id, { ...bag });
    }
    w.invalidate();
  }, level);
  await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 60000 }).catch(() => console.log(`(level ${level} not seen)`));
  await p.waitForTimeout(2500);
  await p.evaluate(() => document.querySelectorAll(".growth-sheet .close").forEach((x) => x.click()));
  await p.keyboard.press("Escape");
  await settle();
};

const TOWNS = await p.evaluate(() => window.woodrail.world.landscape.towns.map((t) => ({ name: t.name, x: t.centre.x, z: t.centre.z })));
const [LARK, ELDER] = TOWNS;
const HUD_LOW = [".tray", ".gift", ".growth-gift", ".rewards-button", ".toast"];

// ---- 1. A town's trade: Elderwick, a mill town by the river ----------------------------------------------------
if (want("town-card")) {
  await growAll(2);
  await props([
    ["bldg-windmill", ELDER.x + 300, ELDER.z - 40, Math.PI / 2],
    ["bldg-watermill", ELDER.x + 330, ELDER.z - 330, 0],
    ["scene-bandstand", ELDER.x - 180, ELDER.z - 300, 0],
  ]);
  await frame(ELDER.x + 120, ELDER.z - 120, 1700, 0.85, Math.PI / 5, 195, 300);
  const pin = await screenOf(ELDER.x + 300, ELDER.z - 40, 130);
  await overlay(
    `<div class="pin" style="left:${pin.x}px;top:${pin.y}px">🌾 The Windmill</div>
     <div class="sheet" style="bottom:12px">
       <h2>Elderwick</h2>
       <div class="sub">Mill town · by the river</div>
       <div style="display:flex;gap:6px;justify-content:center;margin-top:8px"><span class="chip">Town</span><span class="chip trade">🌾 Mill town</span><span class="chip gold">🎪 Harvest Fair in Sep</span></div>
       <div class="line" style="text-align:center">9 of 20 goods to become a city</div>
       <div class="row"> Planks <span class="bar"><i style="width:57%"></i></span><span class="n">8/14</span></div>
       <div class="row">🌾 Grain <span class="bar"><i style="width:17%"></i></span><span class="n">1/6</span></div>
       <div class="line">A mill town grows on <b>grain</b>, not flour: <b>its windmill grinds it</b>, and its station gives the flour to your trains.</div>
       <hr>
       <div class="line"><b>Fair wish:</b> 🥖 8 bread · 🍎 6 fruit before the fair. Brings bunting, a carousel for a year, and twice the riders that month.</div>
       <div class="line"><b>Next landmark:</b> the Corn Exchange, as a city (pays double for grain).</div>
     </div>
     <div class="note">MOCK · town trades</div>`,
    HUD_LOW.concat([".card"]),
  );
  await shot("town-card");
  await clear();
}

// ---- 2. Growth paths: a city chooses which way to grow -----------------------------------------------------------
if (want("paths")) {
  await growAll(3);
  await frame(LARK.x, LARK.z, 1700, 0.85, Math.PI / 4, 195, 190);
  await overlay(
    `<div class="toast" style="top:250px">Larkfield is a city! Which way will it grow?</div>
     <div class="sheet" style="bottom:12px">
       <h2>Larkfield is a city</h2>
       <div class="sub">Pick its path. Every path stays open in another city.</div>
       <div class="choice"><div class="ic">🏭</div><div><div class="t">Industrial city</div><div class="d">Builds an <b>Engine works</b>. Industries within reach work 1.25× as fast. Grows on iron and bricks; smoke stacks, brick terraces.</div></div></div>
       <div class="choice"><div class="ic">🚉</div><div><div class="t">Market city</div><div class="d">Builds a <b>Grand station</b> and a market square. Twice the riders; pays half again for food. Grows on bread and passengers.</div></div></div>
       <div class="choice" style="opacity:.55"><div class="ic">🏖️</div><div><div class="t">Seaside resort</div><div class="d">🔒 Needs the sea within 8 squares. A pier and bathing huts; summer brings crowds of day-trippers.</div></div></div>
     </div>
     <div class="note">MOCK · diverging growth paths</div>`,
    HUD_LOW.concat([".card", ".growth-sheet", ".toast"]),
  );
  await shot("paths");
  await clear();
}

// ---- 3. The grand project: the Great Exhibition, always on screen ---------------------------------------------------
if (want("project")) {
  if (!want("paths")) await growAll(3);
  const T = TOWNS[2] ?? LARK;
  await props([
    ["bldg-control-tower", T.x + 260, T.z + 300, 0],
    ["scene-statue", T.x + 160, T.z + 330, 0],
    ["scene-fountain", T.x + 360, T.z + 380, 0],
    ["scene-tent", T.x + 140, T.z + 430, 0.4],
    ["scene-tent", T.x + 230, T.z + 470, -0.3],
  ]);
  await frame(T.x + 220, T.z + 330, 1600, 0.85, Math.PI / 4, 195, 330);
  const pin = await screenOf(T.x + 260, T.z + 300, 150);
  await overlay(
    `<div class="ribbon"><span>🏛️ Great Exhibition</span><span style="color:#74522f;font-size:12.5px">2 of 4</span><span class="bar"><i style="width:46%"></i></span><span style="font-size:12.5px">46%</span><span style="width:34px;height:34px;border-radius:50%;background:#efe2cc;display:grid;place-items:center;font-size:17px">⌖</span></div>
     <div class="pin" style="left:${pin.x}px;top:${pin.y}px">🏗️ Exhibition ground</div>
     <div class="sheet" style="bottom:12px">
       <h2>The Great Exhibition</h2>
       <div class="sub">at ${T.name} · the whole map builds it</div>
       <div class="stage done"><div class="dot">✓</div><div><b>Foundations</b><div class="goods"><span>🪨 40 stone</span><span> 30 planks</span></div></div></div>
       <div class="stage now"><div class="dot">2</div><div><b>The iron hall</b> · a train is bringing bricks<div class="goods"><span>⚙️ 22/40 iron</span><span>🧱 11/30 bricks</span></div></div></div>
       <div class="stage"><div class="dot">3</div><div><b>The stands</b> · each town sends its trade's good<div class="goods"><span>🐟 Saltby</span><span>🌾 Elderwick</span><span>⛏️ Brambleton</span><span>🎓 Thimble Cross</span></div></div></div>
       <div class="stage"><div class="dot">4</div><div><b>Opening day</b> · the Royal Train calls at every city, then your railway's report card</div></div>
     </div>
     <div class="note">MOCK · grand project</div>`,
    HUD_LOW.concat([".card", ".goals"]),
  );
  await shot("project");
  await clear();
}

// ---- 4. The map: regions you buy into, and things to find ----------------------------------------------------------
if (want("map")) {
  // The game's own map view (🗺), then the neighbouring plots outlined as regions.
  const own = await p.evaluate(() => {
    const g = window.woodrail.world.landscape.grid;
    const px = g.plots.map((q) => q.px), pz = g.plots.map((q) => q.pz);
    const x0 = (a) => g.centreX(a * 31) - 36, z0 = (b) => g.centreZ(b * 23) - 36;
    return { minPx: Math.min(...px), maxPx: Math.max(...px), minPz: Math.min(...pz), maxPz: Math.max(...pz), ox: x0(0), oz: z0(0) };
  });
  console.log("plots", JSON.stringify(own));
  const PW = 31 * 72, PH = 23 * 72;
  const wx = (px) => own.ox + px * PW, wz = (pz) => own.oz + pz * PH;
  const cx0 = (wx(own.minPx) + wx(own.maxPx + 1)) / 2, cz0 = (wz(own.minPz) + wz(own.maxPz + 1)) / 2;
  await look(cx0 - 1500, cz0, Number(process.env.MAP_DIST ?? 15000), Number(process.env.MAP_PHI ?? 0.12), Math.PI / 2);
  await p.screenshot({ path: `${OUT}/../map-raw.jpg`, type: "jpeg", quality: 60 }).catch(() => {});
  const quad = async (px, pz) => {
    const pts = [];
    for (const [x, z] of [[wx(px), wz(pz)], [wx(px + 1), wz(pz)], [wx(px + 1), wz(pz + 1)], [wx(px), wz(pz + 1)]]) pts.push(await screenOf(x, z));
    const cx = pts.reduce((a, q) => a + q.x, 0) / 4, cy = pts.reduce((a, q) => a + q.y, 0) / 4;
    return { pts: pts.map((q) => `${q.x.toFixed(0)},${q.y.toFixed(0)}`).join(" "), cx, cy };
  };
  const W = own.minPx - 1, E = own.maxPx + 1, N = own.minPz - 1;
  const REG = [
    [W, own.minPz, "⛰️ Highlands", "rgba(150,120,200,0.32)"],
    [W, own.maxPz, "🦆 Fens", "rgba(80,160,175,0.36)"],
    [own.minPx, N, "🌲 Pinewood", "rgba(30,100,50,0.36)"],
  ];
  const regions = [];
  for (const [px, pz, label, fill] of REG) regions.push({ ...(await quad(px, pz)), label, fill });
  const poi = async (px, pz, fx, fz, text) => {
    const q = await screenOf(wx(px + fx), wz(pz + fz), 60);
    return `<div class="pin" style="left:${q.x}px;top:${q.y}px">${text}</div>`;
  };
  const pins = [await poi(W, own.minPz, 0.75, 0.5, "🏰 Ruined castle"), await poi(W, own.maxPz, 0.75, 0.5, "❓ In the reeds"), await poi(own.minPx, own.maxPz, 0.4, 0.8, "🗿 Stone circle"), await poi(own.minPx, N, 0.75, 0.5, "🪓 Logging camp")];
  await overlay(
    `<svg style="position:absolute;inset:0;width:100%;height:100%">${regions.map((r) => `<polygon points="${r.pts}" fill="${r.fill}" stroke="#fff" stroke-width="3" stroke-dasharray="9 6"/>`).join("")}</svg>
     ${regions.map((r) => `<div style="position:absolute;left:${r.cx}px;top:${r.cy - 40}px;transform:translateX(-50%);background:rgba(43,33,24,0.75);color:#fff;font-weight:900;font-size:13px;padding:3px 10px;border-radius:999px;white-space:nowrap">${r.label}</div>`).join("")}
     ${pins.join("")}
     <div class="sheet" style="bottom:12px">
       <h2>Buy this plot?</h2>
       <div class="sub">⛰️ Highlands · 90 🪙</div>
       <div class="line"><b>Steep hills, up to four levels.</b> Coal and ore; a miners' village. A <b>rack line</b> climbs what plain track can't (Mountain railway).</div>
       <div class="line"><b>Seen from here:</b> 🏰 a ruined castle on the top. Day-trippers ride out to it once a halt is near.</div>
       <div style="text-align:center;margin-top:12px"><span class="btn">Buy · 90 🪙</span></div>
     </div>
     <div class="note">MOCK · regions and finds</div>`,
    HUD_LOW.concat([".card", ".goals"]),
  );
  await shot("map");
  await clear();
}

// ---- 5. New game: map shapes --------------------------------------------------------------------------------------
if (want("new-game")) {
  await look(-200, -350, 6000, 0.6, Math.PI / 3);
  await overlay(
    `<div style="position:absolute;inset:0;background:rgba(43,33,24,0.35)"></div>
     <div class="sheet" style="top:90px">
       <h2>A new railway</h2>
       <div class="sub">Pick a country. Each has its own towns, finds and big day.</div>
       <div class="choice"><div class="ic">🏞️</div><div><div class="t">River valley</div><div class="d">Gentle hills, a winding river, mill towns. The easy one. Ends with the <b>Great Exhibition</b>.</div></div></div>
       <div class="choice"><div class="ic">🌊</div><div><div class="t">Coast and islands</div><div class="d">Fishing towns and a resort; bridges and ferries between islands. Ends with the <b>Regatta</b>.</div></div></div>
       <div class="choice"><div class="ic">⛰️</div><div><div class="t">Mountain pass</div><div class="d">Mines and steep valleys; rack lines, tunnels and viaducts. Ends with <b>the line over the pass</b>.</div></div></div>
       <div class="choice"><div class="ic">🦆</div><div><div class="t">Fens and forests</div><div class="d">Wet low land, timber towns, causeways. Ends with the <b>Cathedral</b>.</div></div></div>
       <div class="choice"><div class="ic">🎲</div><div><div class="t">Surprise me</div><div class="d">A mix of all four.</div></div></div>
     </div>
     <div class="note">MOCK · map shapes</div>`,
    HUD_LOW.concat([".card"]),
  );
  await shot("new-game");
  await clear();
}

await b.close();
await server.close();
