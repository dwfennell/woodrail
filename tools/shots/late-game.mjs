// Mock pictures for the late-game design (docs/superpowers/specs/2026-11-04-late-game-design.md) on a phone (390×844):
// air, power and radio, and the special trains. A real Game on the starter map, with catalogue models (and a few quick
// code models where the catalogue has none: a wind turbine, a radio mast, a big top) set down beside a town, and the
// proposed cards drawn over it in the HUD's own colours. Nothing here is the game's code: it's for looking at a design.
//
// Usage: node tools/shots/late-game.mjs [<out dir>]   (default out: docs/agents/shots)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
const ONLY = process.env.ONLY?.split(",");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// The stage: models set down around a town, in a group cleared between pictures.
await p.evaluate(async () => {
  const { Kit, TOY } = await import("/src/catalogue/kit.ts");
  const { loadAsset } = await import("/src/catalogue/registry.ts");
  const { shiftHue } = await import("/src/render/props/library.ts");
  const w = window.woodrail;
  const g = w.world.landscape.grid;
  const ground = (x, z) => g.groundY(g.cellAtWorld(x, z));
  const kit = new Kit(w.mats, 1);
  const k = kit;
  let stage = k.group();
  w.scene.add(stage);
  const P = (c) => k.paint(c);
  // Quick code models (toy proportions, mm), for what the catalogue doesn't have yet.
  const made = {
    turbine() {
      const o = k.group(k.cyl(k.wood, 20, 8), k.cyl(P(TOY.white), 7, 220, 0, 0, 0, 4, 12), k.cylZ(P(TOY.white), 9, 24, 0, 222, 6), k.ball(P(TOY.red), 7, 0, 222, 19));
      for (let i = 0; i < 3; i++) {
        const blade = k.group(k.box(P(TOY.white), 10, 80, 3, 1.2, 0, 4, 0), k.box(P(TOY.red), 10.5, 16, 3.5, 1.2, 0, 84, 0));
        blade.position.set(0, 222, 17);
        blade.rotation.z = (i * 2 * Math.PI) / 3 + 0.4;
        o.add(blade);
      }
      return o;
    },
    mast() {
      const o = k.group(k.cyl(k.wood, 34, 8, 0, 0, 0, 30));
      for (let i = 0; i < 6; i++) o.add(k.cyl(P(i % 2 ? TOY.white : TOY.red), 6 - i * 0.5, 40, 0, 8 + i * 40, 0, 5 - i * 0.5, 12));
      o.add(k.ball(P(TOY.yellow), 7, 0, 252, 0));
      for (const r of [22, 34]) o.add(k.ring(P(TOY.yellow), r, 1.6, 0, 252, 0));
      o.add(k.box(P(TOY.cream), 46, 30, 36, 3, 44, 0, 0), k.box(P(TOY.blue), 52, 6, 42, 2, 44, 30, 0));
      return o;
    },
    guest() {
      return k.group(k.peg(TOY.purple, TOY.black, 0, 0, 0), k.cyl(P(TOY.yellow), 14, 3), k.ball(P(TOY.yellow), 4, 0, 46, 0));
    },
    crate() {
      return k.group(k.box(k.wood, 34, 26, 26, 2), k.box(P(TOY.red), 35, 4, 27, 1, 0, 11, 0), k.ring(P(TOY.yellow), 60, 2.5, 0, 1, 0), k.ring(P(TOY.yellow), 80, 2, 0, 1, 0));
    },
    antenna() {
      return k.group(k.cyl(P(TOY.black), 1.2, 40), k.ball(P(TOY.red), 3, 0, 41, 0));
    },
    bigtop() {
      const o = k.group();
      for (let i = 0; i < 6; i++) o.add(k.cyl(P(i % 2 ? TOY.red : TOY.cream), 80, 10, 0, i * 10, 0, 80, 32));
      o.add(k.cone(P(TOY.red), 92, 60, 0, 60, 0, 32), k.cone(P(TOY.cream), 46, 30, 0, 90, 0, 32), k.cone(P(TOY.red), 20, 14, 0, 106, 0, 24));
      o.add(k.cyl(P(TOY.brown), 2.5, 50, 0, 110, 0), k.box(P(TOY.yellow), 22, 12, 1.5, 0.5, 12, 146, 0), k.box(P(TOY.blue), 34, 44, 10, 3, 0, 0, 78));
      return o;
    },
  };
  window.mock = {
    clear() {
      w.scene.remove(stage);
      stage = k.group();
      w.scene.add(stage);
      w.invalidate();
    },
    town: (i = 0) => w.world.landscape.towns[i].centre,
    ground,
    /** Put a catalogue model (or a code model, "made:<name>") at x, z (y above the ground), turned `ry`, scaled `s`. */
    async put(id, x, z, { y = 0, ry = 0, s = 1, hue = 0 } = {}) {
      let o;
      if (id.startsWith("made:")) o = made[id.slice(5)]();
      else {
        const a = id.startsWith("train-") ? (await import("/src/catalogue/assets/trains.ts")).ASSETS.find((x) => x.id === id) : await loadAsset(id);
        if (!a) throw new Error(`no asset ${id}`);
        o = a.build(hue ? new Kit(w.mats, 1, (c) => shiftHue(c, hue)) : kit);
        if (a.animate) a.animate(o, 2.3);
      }
      o.traverse((m) => {
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      o.position.set(x, ground(x, z) + y, z);
      o.rotation.y = ry;
      o.scale.setScalar(s);
      stage.add(o);
      w.invalidate();
      return { x, z };
    },
  };
});

const look = (x, z, dist, phi, theta) =>
  p.evaluate(({ x, z, dist, phi, theta }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, 0, z), dist, { duration: 0.1, phi, theta }), { x, z, dist, phi, theta });
await p.addStyleTag({
  content: `
  body > *:not(#scene):not(.mock) { visibility: hidden !important }
  .mock { text-align: left; position: fixed; left: 0; right: 0; z-index: 99; font-family: Nunito, system-ui, sans-serif; color: #2b2118; pointer-events: none }
  .mock.mk-bottom { bottom: 0; padding: 0 10px 14px }
  .mock.mk-top { top: 0; padding: 40px 10px 0 }
  .mock .mk-bar { display: flex; gap: 6px; justify-content: space-between; align-items: center }
  .mock .mk-pill { background: linear-gradient(180deg, #f3dcb6, #dcb682); border: 1.5px solid #b07a44; border-radius: 999px; padding: 6px 12px; font: 800 14px Nunito, system-ui; box-shadow: 0 2px 0 #b07a44 }
  .mock .mk-card { background: rgba(250,243,230,.97); border-radius: 18px; padding: 12px 14px 14px; box-shadow: 0 6px 18px rgba(43,33,24,.28), 0 0 0 1.5px #dcb682 inset }
  .mock .mk-title { font: 900 18px Nunito, system-ui; display: flex; align-items: center; gap: 8px }
  .mock .mk-sub { font: 700 12.5px/1.3 Nunito, system-ui; color: #74522f; margin: 2px 0 8px }
  .mock .mk-row { justify-content: flex-start; display: flex; align-items: center; gap: 8px; font: 700 13.5px/1.3 Nunito, system-ui; padding: 7px 0; border-top: 1px solid #ecdcc0 }
  .mock .mk-row b { font-weight: 900 }
  .mock .mk-row .mk-r { margin-left: auto; font-weight: 800; color: #5e4128; white-space: nowrap }
  .mock .mk-chips { display: flex; gap: 8px; margin-top: 10px }
  .mock .mk-chip { flex: 1; height: 44px; border-radius: 13px; display: flex; align-items: center; justify-content: center; font: 800 15px Nunito, system-ui; background: linear-gradient(180deg, #f3dcb6, #dcb682); color: #3a2a1c; box-shadow: 0 2px 0 #b07a44 }
  .mock .mk-chip.mk-go { background: linear-gradient(180deg, #8fd08a, #5aa35a); color: #13310f; box-shadow: 0 2px 0 #3f7f3f }
  .mock .mk-meter { flex: 1; height: 14px; border-radius: 7px; background: #ecdcc0; overflow: hidden; display: flex }
  .mock .mk-meter i { display: block; height: 100% }
  .mock .mk-sw { width: 40px; height: 40px; border-radius: 12px; box-shadow: 0 2px 0 rgba(0,0,0,.25), inset 0 0 0 3px rgba(255,255,255,.35) }
  .mock .mk-sw.mk-on { outline: 3px solid #2f6fb5; outline-offset: 2px }
  .mock .mk-tag { font: 800 10.5px Nunito, system-ui; background: #2b2118; color: #f6efe3; border-radius: 8px; padding: 2px 7px; position: fixed; top: 10px; right: 10px }
  .mock .mk-toast { background: rgba(250,243,230,.97); border-radius: 16px; padding: 10px 14px; font: 800 14px/1.3 Nunito, system-ui; box-shadow: 0 6px 18px rgba(43,33,24,.28); display: flex; gap: 10px; align-items: center }
  .mock .mk-big { font-size: 26px }
  `,
});
const overlay = (html) =>
  p.evaluate((html) => {
    for (const m of document.querySelectorAll(".mock")) m.remove();
    document.body.insertAdjacentHTML("beforeend", `${html}<div class="mock"><span class="mk-tag">MOCK · design only</span></div>`);
  }, html);
const shot = async (name, setup, cam, html) => {
  if (ONLY && !ONLY.includes(name)) return;
  await p.evaluate(() => window.mock.clear());
  const at = await p.evaluate(setup);
  await look(at.x, at.z + (cam.up ?? cam.dist * 0.3), cam.dist, cam.phi, cam.theta ?? 0);
  await overlay(html);
  await p.waitForTimeout(1200);
  await settle();
  await p.screenshot({ path: `${OUT}/late-${name}.jpg`, type: "jpeg", quality: 85, timeout: 180000 });
  console.log("shot", name, JSON.stringify(at));
};

if (process.env.PROBE) {
  for (const [i, t] of [[0, 0], [1, 1], [2, 2]]) {
    const c = await p.evaluate((i) => window.woodrail.world.landscape.towns[i]?.centre, i);
    if (!c) continue;
    await look(c.x, c.z, 3200, 0.05, 0);
    await p.waitForTimeout(800);
    await settle();
    await p.screenshot({ path: `${OUT}/probe-${i}.png` });
    console.log("probe", i, JSON.stringify(c));
  }
  process.exit(0);
}
// 1. Air: an airport beside a town; a plane in, people off it for your towns, people waiting to fly.
await shot(
  "airport",
  async () => {
    const m = window.mock;
    const x = -420;
    const z = -170;
    await m.put("bldg-control-tower", x, z, { ry: 0.3 });
    await m.put("veh-propeller-plane", x + 190, z + 30, { ry: -0.6 });
    await m.put("veh-propeller-plane", x - 180, z - 260, { y: 230, ry: 2.4, s: 0.9 });
    return { x: x + 40, z: z + 60 };
  },
  { dist: 1300, phi: 0.95 },
  `<div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">✈️ Larkfield Airport</div>
     <div class="mk-sub">Planes call by themselves. Bring people here by train.</div>
     <div class="mk-row">🛬 Off the plane<span class="mk-r"><b>8</b> visitors for your towns</span></div>
     <div class="mk-row">👤 Visitors waiting for a train<span class="mk-r">pay 1.5× fares</span></div>
     <div class="mk-row">🛫 Waiting to fly away<span class="mk-r"><b>5</b> × 9🪙</span></div>
     <div class="mk-row">⏱ Next plane<span class="mk-r">in 1:40</span></div>
   </div></div>`,
);

// 2. Air: the airship's sightseeing tour from a mast at a station.
await shot(
  "airship",
  async () => {
    const m = window.mock;
    const x = 380;
    const z = 560;
    await m.put("veh-airship", x, z, { ry: -0.5 });
    return { x: x + 40, z: z - 120 };
  },
  { dist: 1100, phi: 0.9 },
  `<div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">🎈 Airship tour</div>
     <div class="mk-sub">Riders brought to the mast fly round your railway. The more there is to see, the more they pay.</div>
     <div class="mk-row">🌉 2 bridges · 🏛 1 viaduct · 🚂 3 trains<span class="mk-r">+6🪙</span></div>
     <div class="mk-row">🏘 4 towns · ⛲ 2 treats<span class="mk-r">+4🪙</span></div>
     <div class="mk-row">Fare a rider<span class="mk-r"><b>12🪙</b></span></div>
     <div class="mk-row">👤 On board<span class="mk-r"><b>6</b> of 8 · leaves when full</span></div>
   </div></div>`,
);

// 3. Power: wind turbines on a hill, and the power card.
await shot(
  "power",
  async () => {
    const m = window.mock;
    const x = -1000;
    const z = -230;
    await m.put("made:turbine", x, z);
    await m.put("made:turbine", x + 110, z + 60, { ry: 0.2 });
    await m.put("made:turbine", x - 30, z + 170, { ry: -0.1 });
    return { x: x + 160, z: z + 80 };
  },
  { dist: 1500, phi: 1.0, up: 250 },
  `<div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">⚡ Power</div>
     <div class="mk-sub">Each spark runs one electric engine, or speeds up one yard.</div>
     <div class="mk-row" style="border:0">Made<div class="mk-meter"><i style="width:44%;background:#e2a12b"></i><i style="width:33%;background:#7fb7e0"></i></div><span class="mk-r"><b>9</b> ⚡</span></div>
     <div class="mk-row">🏭 Power station (coal)<span class="mk-r">4 ⚡</span></div>
     <div class="mk-row">🌬 Wind farm, 3 turbines<span class="mk-r">3 ⚡ · windy</span></div>
     <div class="mk-row">🚆 5 electric engines<span class="mk-r">5 ⚡</span></div>
     <div class="mk-row">🪚 Sawmill 1.5× · 📻 radio<span class="mk-r">2 ⚡</span></div>
     <div class="mk-row"><b>2 sparks spare</b><span class="mk-r">tap a yard to power it</span></div>
   </div></div>`,
);

// 4. Radio: a mast beside a town, and a town's request heard on it.
await shot(
  "radio",
  async () => {
    const m = window.mock;
    const x = -330;
    const z = 560;
    await m.put("made:mast", x, z, { ry: 0.5 });
    return { x: x - 60, z: z - 160 };
  },
  { dist: 1150, phi: 0.95 },
  `<div class="mock mk-top"><div class="mk-toast"><span class="mk-big">📻</span><div>Thimble Cross asks on the radio:<br><b>8 🧀 cheese by June</b> · pays 2×</div></div></div>
   <div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">📻 Radio mast</div>
     <div class="mk-sub">Towns in reach tell you what they'd love. Bring it in time and they pay double. Miss it and nothing is lost.</div>
     <div class="mk-row">🧀 Thimble Cross: 3 of 8<div class="mk-meter" style="max-width:90px"><i style="width:37%;background:#5aa35a"></i></div><span class="mk-r">by Jun</span></div>
     <div class="mk-row">🪑 Elderwick: 6 of 6<span class="mk-r">✔ paid 144🪙</span></div>
     <div class="mk-row">📢 Stations in reach call their trains<span class="mk-r">riders 1.5×</span></div>
   </div></div>`,
);

// 5. Paint: three engines in their own colours, and the paint pot on an engine's card.
await shot(
  "paint",
  async () => {
    const m = window.mock;
    const x = -760;
    const z = -200;
    await m.put("train-tender-engine", x, z, { ry: 0 });
    await m.put("train-tender-engine", x + 30, z + 95, { ry: 0, hue: 2 });
    await m.put("train-tender-engine", x + 60, z + 190, { ry: 0, hue: 4 });
    return { x: x + 20, z: z + 70 };
  },
  { dist: 700, phi: 0.95 },
  `<div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">🚂 Bluebell <span style="font:700 12px Nunito;color:#74522f">· tap to rename</span></div>
     <div class="mk-sub">Paint her any colour: a pot of paint from the workshop.</div>
     <div class="mk-chips" style="justify-content:space-between">
       <div class="mk-sw mk-on" style="background:#c8442f"></div><div class="mk-sw" style="background:#3f8f4a"></div><div class="mk-sw" style="background:#2f6fb5"></div>
       <div class="mk-sw" style="background:#e2a12b"></div><div class="mk-sw" style="background:#6b4a8f"></div><div class="mk-sw" style="background:#2a2b2e"></div>
       <div class="mk-sw" style="background:linear-gradient(135deg,#f5d36a,#c9932c)"></div></div>
     <div class="mk-row" style="margin-top:8px">🎨 One coat<span class="mk-r">1 🪣 paint · workshop has 5</span></div>
     <div class="mk-row">✨ Gold: a city ★★★ gives it<span class="mk-r">locked</span></div>
     <div class="mk-chips"><div class="mk-chip">As she came</div><div class="mk-chip mk-go">Paint her red</div></div>
   </div></div>`,
);

// 6. The circus train in a town, the big top up.
await shot(
  "circus",
  async () => {
    const m = window.mock;
    const x = 640;
    const z = -150;
    await m.put("made:bigtop", x, z);
    await m.put("train-circus-engine", 790, 112, { ry: 0 });
    await m.put("train-circus-cage", 900, 112, { ry: 0 });
    await m.put("train-circus-cage", 1010, 112, { ry: 0 });
    return { x: x + 120, z: z + 80 };
  },
  { dist: 1150, phi: 0.95 },
  `<div class="mock mk-top"><div class="mk-toast"><span class="mk-big">🎪</span><div>The circus is in <b>Elderwick</b>!<br>Riders to Elderwick pay 2× till May.</div></div></div>
   <div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">🎪 Circus train</div>
     <div class="mk-sub">Stop it at a town's station and the big top goes up there.</div>
     <div class="mk-row">🎟 Visitors carried to the show<span class="mk-r"><b>34</b></span></div>
     <div class="mk-row">🎁 When it moves on<span class="mk-r">Elderwick gives a reward card</span></div>
     <div class="mk-row">⏳ It moves on in<span class="mk-r">2 months</span></div>
     <div class="mk-chips"><div class="mk-chip">Next: Thimble Cross</div><div class="mk-chip mk-go">Show route</div></div>
   </div></div>`,
);

// 7. The clockmaker: a station clock, and rush hour on a town's card.
await shot(
  "clock",
  async () => {
    const m = window.mock;
    const x = -620;
    const z = 20;
    await m.put("bldg-station-clock", x, z, { ry: 0.3 });
    return { x: x + 60, z: z + 40 };
  },
  { dist: 750, phi: 0.95, up: 20 },
  `<div class="mock mk-top"><div class="mk-toast"><span class="mk-big">🕗</span><div>Rush hour in <b>Larkfield</b>!<br>Crowds at the station for the 8 o'clock.</div></div></div>
   <div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">🕰 Larkfield station clock</div>
     <div class="mk-sub">Bring a town 6 clocks and its station gets one. Then twice a month a crowd comes to catch a train.</div>
     <div class="mk-row">👥 Next rush<span class="mk-r">8 o'clock, in 0:40</span></div>
     <div class="mk-row">👥 A rush brings<span class="mk-r">6 riders at once</span></div>
     <div class="mk-row">🕰 12 clocks more: a clock tower<span class="mk-r">rushes ×2</span></div>
   </div></div>`,
);

// Radio, take 2 (the user's ask, 2026-11-05): three fresh ideas.
// R-A. Special guests: the radio tells you of someone waiting somewhere.
await shot(
  "radio-guests",
  async () => {
    const m = window.mock;
    await m.put("made:mast", -330, 560, { ry: 0.5 });
    await m.put("made:guest", -440, 190, { s: 1.6 });
    await m.put("made:guest", -400, 210, { s: 1.0 });
    return { x: -440, z: 190 };
  },
  { dist: 650, phi: 0.95, up: 90 },
  `<div class="mock mk-top"><div class="mk-toast"><span class="mk-big">📻</span><div>On the radio: <b>the Mayor of Elderwick</b> is at Larkfield station and wants to go home.</div></div></div>
   <div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">🎩 The Mayor of Elderwick</div>
     <div class="mk-sub">Waiting at Larkfield. Any coach will do, but first class makes her day.</div>
     <div class="mk-row">🎁 Bring her home<span class="mk-r">a thank-you gift + 🏷 sticker</span></div>
     <div class="mk-row">⭐ In first class<span class="mk-r">a statue of her train in Elderwick</span></div>
     <div class="mk-row">📒 Guests met<span class="mk-r">3 of 12: the band, a bride, the vet…</span></div>
   </div></div>`,
);
// R-B. A radio-controlled engine you drive yourself.
await shot(
  "radio-rc",
  async () => {
    const m = window.mock;
    await m.put("train-battery-engine", -760, -200, { ry: 0 });
    await m.put("made:antenna", -748, -200, { y: 40 });
    await m.put("train-flatbed-crates", -660, -200, { ry: 0 });
    return { x: -720, z: -200 };
  },
  { dist: 600, phi: 0.95, up: 40 },
  `<div class="mock mk-top"><div class="mk-toast"><span class="mk-big">🎮</span><div>You're driving <b>Sparky</b>, the radio engine. Anywhere in the mast's reach.</div></div></div>
   <div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">📻 Radio engine</div>
     <div class="mk-sub">Push it, pull it, couple and drop wagons by hand. It fetches strays and shunts yards for you.</div>
     <div class="mk-chips"><div class="mk-chip">◀ Back</div><div class="mk-chip">⏸</div><div class="mk-chip mk-go">Ahead ▶</div></div>
     <div class="mk-chips"><div class="mk-chip">⤴ Flip next points</div><div class="mk-chip">🔗 Drop wagon</div></div>
   </div></div>`,
);
// R-C. Lost and found: something lost out in the country, heard on the radio.
await shot(
  "radio-lost",
  async () => {
    const m = window.mock;
    await m.put("made:crate", 330, 580, { s: 1.5 });
    return { x: 330, z: 580 };
  },
  { dist: 1000, phi: 0.95, up: 150 },
  `<div class="mock mk-top"><div class="mk-toast"><span class="mk-big">📻</span><div>Lost and found: <b>a crate of toys</b> fell off a cart down by the river!</div></div></div>
   <div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">📦 A lost crate</div>
     <div class="mk-sub">Lay track to it. The first train to stop beside it brings it home.</div>
     <div class="mk-row">🎁 Inside<span class="mk-r">a surprise: a rare piece, goods or a car</span></div>
     <div class="mk-row">🗺 Each one is somewhere new<span class="mk-r">corners you haven't built in</span></div>
     <div class="mk-row">📒 Found<span class="mk-r">5 crates · 1 teddy · 1 lost dog</span></div>
   </div></div>`,
);

// Clockmaker, take 2: what clocks are for.
// C-A. The clockmaker's clock runs time faster.
await shot(
  "clock-speed",
  async () => {
    const m = window.mock;
    await m.put("bldg-station-clock", -620, 20, { ry: 0.3 });
    return { x: -540, z: 60 };
  },
  { dist: 1400, phi: 0.95 },
  `<div class="mock mk-top"><div class="mk-toast" style="justify-content:space-between"><span class="mk-big">🕰</span><div style="flex:1">Time<br><span style="font-weight:700;color:#74522f">Apr 2004</span></div>
     <div class="mk-chip" style="flex:0 0 52px">1×</div><div class="mk-chip mk-go" style="flex:0 0 52px">2×</div><div class="mk-chip" style="flex:0 0 52px">3×</div></div></div>
   <div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">🕰 The Clockmaker</div>
     <div class="mk-sub">Bring it iron and planks and it makes the town clock. Then time is yours: run the railway 2× or 3× as fast.</div>
     <div class="mk-row">⏩ 2× · fast<span class="mk-r">from the first clock</span></div>
     <div class="mk-row">⏩ 3× · faster<span class="mk-r">clock tower in a city</span></div>
     <div class="mk-row">⏸ Pausing stays free<span class="mk-r">as now</span></div>
   </div></div>`,
);
// C-B. Alarm clocks: set one on anything, and it rings and shows you.
await shot(
  "clock-alarm",
  async () => {
    const m = window.mock;
    await m.put("bldg-station-clock", -620, 20, { ry: 0.3 });
    return { x: -540, z: 60 };
  },
  { dist: 1100, phi: 0.95 },
  `<div class="mock mk-top"><div class="mk-toast"><span class="mk-big">⏰</span><div><b>Ring ring!</b> Larkfield sawmill is full of planks.<br><span style="color:#2f6fb5">Tap to go there</span></div></div></div>
   <div class="mock mk-bottom"><div class="mk-card">
     <div class="mk-title">⏰ Alarm clocks</div>
     <div class="mk-sub">Put one on a yard, a station or a train. It rings, and the camera takes you there.</div>
     <div class="mk-row">🪚 Larkfield sawmill<span class="mk-r">when full</span></div>
     <div class="mk-row">🚂 Bluebell<span class="mk-r">when she's home</span></div>
     <div class="mk-row">👥 Elderwick station<span class="mk-r">when 6 are waiting</span></div>
     <div class="mk-row">⏰ Alarms<span class="mk-r">3 of 5 · more with each clock</span></div>
   </div></div>`,
);

if (errors.length) console.log("page errors:", errors.slice(0, 5));
await b.close();
await server.close();
