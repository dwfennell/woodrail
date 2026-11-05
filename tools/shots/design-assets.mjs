// Pictures of the design assets (spec 2026-11-05) on a real Game map, 390×844: each grand project at its three build
// stages side by side and a close-up of it finished; each secret site hidden and found (a train arriving on a line
// laid to it) and a close-up; each town path's landmark in a town; and a town card with the Leaning meter (HTML over
// the game). Props and track are put down by hand (a harness shortcut: `props.add`, `editor().placeRun`, the sim's
// `addTrain`), for looking only. Towns grown by writing their deliveries, as in starter-room.mjs.
//
// Usage: node tools/shots/design-assets.mjs [<out dir>]   (default out: docs/agents/shots). ONLY=grand,secret,path
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "docs/agents/shots";
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.ONLY?.split(",");
const want = (n) => !ONLY || ONLY.includes(n);
const PICK = process.env.PICK?.split(",");
const pick = (id) => !PICK || PICK.some((p) => id.includes(p));
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

await p.addStyleTag({
  content: `
#mock { position: fixed; inset: 0; z-index: 1000; pointer-events: none; font-family: "Woodrail Icons", "Nunito", system-ui, sans-serif; color: #2b2118; }
#mock .pin { position: absolute; transform: translate(-50%, -100%); background: rgba(250,243,230,0.97); border-radius: 12px; padding: 4px 9px; font-weight: 900; font-size: 13px; box-shadow: 0 4px 12px rgba(60,40,20,0.3); white-space: nowrap; }
#mock .pin::after { content: ""; position: absolute; left: 50%; bottom: -6px; transform: translateX(-50%); border: 6px solid transparent; border-bottom: 0; border-top-color: rgba(250,243,230,0.97); }
#mock .title { position: absolute; left: 12px; right: 12px; bottom: 14px; background: rgba(250,243,230,0.97); border-radius: 16px; box-shadow: 0 6px 22px rgba(60,40,20,0.3); padding: 10px 14px; }
#mock .title b { font-size: 18px; font-weight: 900; display: block; }
#mock .title span { font-size: 13px; color: #5e4128; line-height: 1.35; display: block; margin-top: 3px; }
#mock .sheet { position: absolute; left: 12px; right: 12px; bottom: 12px; background: rgba(250,243,230,0.98); border-radius: 18px; box-shadow: 0 10px 34px rgba(60,40,20,0.32); padding: 14px 16px 16px; }
#mock h2 { margin: 0; font-size: 21px; font-weight: 900; text-align: center; color: #3a2a1c; }
#mock .chip { display: inline-block; background: #dff0d8; color: #2f5a27; border-radius: 999px; padding: 3px 11px; font-weight: 800; font-size: 13px; }
#mock .chip.lean { background: #f6e1c4; color: #7a4310; }
#mock .row { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 800; margin-top: 8px; }
#mock .row .bar { flex: 1; height: 10px; background: #efe2cc; border-radius: 6px; overflow: hidden; }
#mock .row .bar i { display: block; height: 100%; background: #8fd08a; border-radius: 6px; }
#mock .row .n { min-width: 46px; text-align: right; }
#mock .lean { margin-top: 12px; background: #fffaf0; border-radius: 14px; padding: 9px 11px; box-shadow: inset 0 -3px 0 rgba(176,122,68,0.25); }
#mock .lean .h { font-weight: 900; font-size: 14px; display: flex; justify-content: space-between; }
#mock .meter { display: flex; height: 16px; border-radius: 8px; overflow: hidden; margin-top: 7px; }
#mock .meter i { display: block; height: 100%; }
#mock .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 7px; font-size: 12.5px; font-weight: 800; color: #5e4128; }
#mock .legend s { text-decoration: none; display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
#mock .line { font-size: 13px; line-height: 1.35; color: #5e4128; margin-top: 8px; }
#mock .line b { color: #2b2118; }
#mock .note { position: absolute; left: 0; right: 0; top: 4px; text-align: center; font-size: 11px; font-weight: 800; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.8); }
`,
});

const overlay = (html, hideHud) =>
  p.evaluate(
    ({ html, hideHud }) => {
      document.getElementById("mock")?.remove();
      for (const el of document.querySelectorAll(".hud, .tray")) el.style.visibility = hideHud ? "hidden" : "";
      for (const el of document.querySelectorAll(".toast, .card, .reward-badge, .growth-sheet")) el.style.visibility = "hidden";
      if (!hideHud) for (const el of document.querySelectorAll(".tray")) el.style.visibility = "hidden";
      if (!html) return;
      const d = document.createElement("div");
      d.id = "mock";
      d.innerHTML = html;
      document.body.append(d);
    },
    { html, hideHud },
  );
const shot = async (name) => {
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: 80, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  console.log("shot", name);
};
const look = (x, z, dist, phi, theta) =>
  p.evaluate(
    async ({ x, z, dist, phi, theta }) => {
      const w = window.woodrail;
      w.lookAt(new w.camera.position.constructor(x, 0, z), dist, phi, theta);
      w.invalidate();
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    },
    { x, z, dist, phi, theta },
  );
const screenOf = (x, z, y = 0) =>
  p.evaluate(
    ({ x, z, y }) => {
      const w = window.woodrail;
      const v = new w.camera.position.constructor(x, y, z).project(w.camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    },
    { x, z, y },
  );
/** Put props down (asset, x, z, heading); returns their ids. Waits for their models. */
const put = (list) =>
  p.evaluate(async (list) => {
    const w = window.woodrail;
    const g = w.world.landscape.grid;
    const ids = list.map(([asset, x, z, heading = 0]) => w.props.add(asset, { x, z, heading, y: g.groundY(g.cellAtWorld(x, z)) }).id);
    w.propsChanged();
    w.invalidate();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      w.propsChanged();
      w.invalidate();
    }
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
    return ids;
  }, list);
const takeAway = (ids) =>
  p.evaluate((ids) => {
    const w = window.woodrail;
    for (const id of ids) w.props.remove(id);
    w.propsChanged();
    w.invalidate();
  }, ids);
/**
 * The centre of an open rectangle (`w` along x, `d` along z: flat grass, no trees, track, props or town) nearest
 * (nx, nz), not within `avoid` of any centre in `used`.
 */
const findOpen = (w, d, nx, nz, used = []) =>
  p.evaluate(
    ({ w, d, nx, nz, used }) => {
      const g = window.woodrail.world.landscape.grid;
      const props = [...window.woodrail.props.all()];
      const why = {};
      const no = (k) => ((why[k] = (why[k] ?? 0) + 1), false);
      const ok = (cx, cz) => {
        if (used.some(([ux, uz, uw, ud]) => Math.abs(ux - cx) < (uw + w) / 2 && Math.abs(uz - cz) < (ud + d) / 2)) return false;
        let trees = 0;
        let cells = 0;
        for (let x = cx - w / 2; x <= cx + w / 2; x += 36)
          for (let z = cz - d / 2; z <= cz + d / 2; z += 36) {
            const i = g.cellAtWorld(x, z);
            if (i < 0) return no("out");
            if (g.surface[i] !== 0) return no("surface");
            if (g.height[i] > 1) return no("height");
            cells++;
            if (g.feature[i] > 1) return no("feature");
            if (g.feature[i] === 1) trees++;
          }
        if (trees > cells * 0.4) return no("trees");
        return !props.some((q) => Math.abs(q.x - cx) < w / 2 + 30 && Math.abs(q.z - cz) < d / 2 + 30) || no("props");
      };
      for (let r = 0; r < 6000; r += 72)
        for (let a = 0; a < Math.max(1, Math.round(r / 36)); a++) {
          const t = (a / Math.max(1, Math.round(r / 36))) * Math.PI * 2;
          const cx = Math.round((nx + Math.cos(t) * r) / 36) * 36;
          const cz = Math.round((nz + Math.sin(t) * r) / 36) * 36;
          if (ok(cx, cz)) {
            // Its trees cleared and low hills lowered, as a player can (Clear; Landscaping's Lower hills): a harness shortcut.
            const slots = new Set();
            for (let x = cx - w / 2; x <= cx + w / 2; x += 36)
              for (let z = cz - d / 2; z <= cz + d / 2; z += 36) {
                const i = g.cellAtWorld(x, z);
                if (g.feature[i] === 1 || g.height[i] !== 0) {
                  g.feature[i] = 0;
                  g.height[i] = 0;
                  slots.add(Math.floor(i / (31 * 23)));
                }
              }
            window.woodrail.editLand([...slots]);
            return [cx, cz];
          }
        }
      const st = { cells: 0, surf: {}, h: {}, f: {} };
      g.forEachCell((i) => {
        st.cells++;
        st.surf[g.surface[i]] = (st.surf[g.surface[i]] ?? 0) + 1;
        st.h[g.height[i]] = (st.h[g.height[i]] ?? 0) + 1;
        st.f[g.feature[i]] = (st.f[g.feature[i]] ?? 0) + 1;
      });
      window.__why = { why, none: st, props: props.length, near: props.filter((q) => Math.hypot(q.x - nx, q.z - nz) < 600).length };
      return null;
    },
    { w, d, nx, nz, used },
  );

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
await growAll(2);
const TOWNS = await p.evaluate(() => window.woodrail.world.landscape.towns.map((t) => ({ name: t.name, x: t.centre.x, z: t.centre.z })));
const MID = { x: TOWNS.reduce((a, t) => a + t.x, 0) / TOWNS.length, z: TOWNS.reduce((a, t) => a + t.z, 0) / TOWNS.length };
// The camera looks along x on a phone held upright (theta π/2): +x is up the screen.
const UP = Math.PI / 2;

// ---- Grand projects ------------------------------------------------------------------------------------------------
const GRAND = [
  ["grand-exhibition", "Grand Exhibition hall", "Stone and planks for the foundations, then iron and bricks for the hall, then one good from every kind of city for the stands.", "Opening day: the Royal Train tours every city, then the railway's report card."],
  ["grand-cathedral", "Cathedral", "Stone by the trainload, bricks for the towers, planks and tools for the roofs, bread for the masons.", "Bells, a wedding procession and bunting in every town; pilgrims ride your trains."],
  ["grand-royal-train", "Royal Train", "Built at an engine works: iron and tools for the frames, furniture for the saloons, paint for the gold.", "It runs through every city once; each it calls at puts out flags, and it's yours to keep."],
  ["grand-central", "Grand Central station", "Bricks and iron for the front and the shed, stone for the tower, and passengers carried across the map.", "Every line's trains meet under the clock at noon; the station's busier for good."],
  ["grand-ferris-wheel", "World's Fair wheel", "Iron and tools for the wheel, then ice cream, juice and fish for the fair, and riders from every town.", "Fair week: crowds by train from every town, and the wheel turns for good."],
];
if (want("grand")) {
  const spot = await findOpen(1300, 440, MID.x, MID.z);
  console.log("grand spot", JSON.stringify(spot));
  for (const [id, name, goods, day] of GRAND) {
    if (!pick(id)) continue;
    const [cx, cz] = spot;
    const xs = [cx - 430, cx, cx + 430];
    // (The wheel turns in its own plane: stood across the view so it's seen face on.)
    const heading = id === "grand-ferris-wheel" ? Math.PI / 2 : 0;
    const ids = await put(xs.map((x, i) => [`${id}-${i + 1}`, x, cz, heading]));
    await look(cx + 120, cz, 2500, 0.75, UP);
    const pins = [];
    for (const [i, x] of xs.entries()) {
      const s = await screenOf(x, cz + 120, 10);
      pins.push(`<div class="pin" style="left:${Math.min(330, Math.max(60, s.x))}px;top:${s.y}px">${i + 1} · ${["Foundations", "Half built", "Finished"][i]}</div>`);
    }
    await overlay(`${pins.join("")}<div class="title"><b>${name}</b><span>${goods}</span></div>`, false);
    await shot(`grand-${id.slice(6)}-stages`);
    await look(cx + 430 + (id === "grand-cathedral" ? 40 : 0), cz, id === "grand-royal-train" ? 950 : 1350, 0.95, id === "grand-ferris-wheel" ? Math.PI / 4 + Math.PI / 2 : Math.PI / 4);
    await overlay(`<div class="title"><b>${name}</b><span>${day}</span></div>`, true);
    await shot(`grand-${id.slice(6)}`);
    await overlay("", false);
    await takeAway(ids);
  }
}

// ---- Secret sites --------------------------------------------------------------------------------------------------
const SECRETS = [
  ["secret-lost-mine", "Lost mine", "A cart full of gold: 300 coins, and the mine reopens for half price."],
  ["secret-castle", "Ruined castle", "A flag on the tower, and day-trippers: a halt near it fills with people."],
  ["secret-lake", "Hidden lake", "The boat's mended: a boating day out (riders), and fish for the towns."],
  ["secret-shipwreck", "Shipwreck", "The chest's full of gold: 300 coins; the figurehead goes to the museum."],
  ["secret-stones", "Standing stones", "They stand again: midsummer brings visitors from every town."],
  ["secret-footprint", "Giant's footprint", "Ducks move in, a sign tells the tale, and families come to picnic."],
];
if (want("secret")) {
  const used = [];
  for (const [i, [id, name, reward]] of SECRETS.entries()) {
    if (!pick(id)) continue;
    const spot = await findOpen(1250, 380, MID.x + 400, MID.z - 300, used);
    if (!spot) {
      console.log("no room for", id, JSON.stringify(await p.evaluate(() => window.__why)));
      continue;
    }
    // (Each site and its line are taken away after its pictures, so the next can use the same ground.)
    const cx = spot[0] + 250;
    const cz = spot[1] - 15;
    const hx = cx + 230; // hidden, up the screen
    const fx = cx - 230; // found, down the screen, with the line laid to it
    const ids = await put([[`${id}-hidden`, hx, cz - 40, 0], [id, fx, cz - 40, 0]]);
    // A line along x past the found site's side, a train arriving on it.
    const line = await p.evaluate(
      ({ fx, cz }) => {
        const w = window.woodrail;
        const z = cz + 150;
        const run = [0, 1, 2].map((n) => ({ type: "straight-216", pose: { x: fx - 600 + n * 216, z, heading: 0 }, y: 0, flipped: false }));
        run.push({ type: "buffer", pose: { x: fx + 48, z, heading: 0 }, y: 0, flipped: false });
        const pieces = w.editor().placeRun(run);
        const r = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: pieces[2], pathIndex: 0, s: 170, reversed: false });
        w.trainView?.sync?.();
        w.invalidate();
        return { pieces, train: r.kind === "placed" ? r.trainId : JSON.stringify(r) };
      },
      { fx, cz },
    );
    console.log(id, "line", JSON.stringify(line));
    await settle();
    await look(cx - 150, cz, 1700, 0.8, UP);
    const sh = await screenOf(hx, cz - 40, 70);
    const sf = await screenOf(fx, cz - 40, 70);
    await overlay(
      `<div class="pin" style="left:${sh.x}px;top:${sh.y}px">❓ Not found yet</div><div class="pin" style="left:${sf.x}px;top:${sf.y}px">⭐ Found!</div><div class="title"><b>${name}</b><span>Lay track to it to find it. ${reward}</span></div>`,
      false,
    );
    await shot(`secret-${id.slice(7)}`);
    await look(fx - 20, cz + 50, 1050, 0.9, Math.PI / 2 + 0.5);
    await overlay(`<div class="title"><b>${name}</b><span>${reward}</span></div>`, true);
    await shot(`secret-${id.slice(7)}-close`);
    await overlay("", false);
    await takeAway(ids);
    await p.evaluate((pieces) => {
      const w = window.woodrail;
      for (const t of w.sim.trainIds()) w.sim.removeTrain?.(t);
      w.editor().removeGroup(pieces);
      w.invalidate();
    }, line.pieces);
  }
}

// ---- Town paths' landmarks, and the Leaning meter ----------------------------------------------------------------------
const PATHS = [
  ["path-engine-works", "Engine works", "Industrial city", "Industries within reach work 1.25× as fast; it builds the Royal Train."],
  ["path-guildhall", "Guildhall and market", "Market town", "Pays half again for food; twice the riders at its station."],
  ["path-pier", "Pier and pavilion", "Resort", "Riders who arrive count toward growth; summer crowds."],
  ["path-observatory", "Observatory", "University city", "Every school on the map studies 1.25× as fast."],
  ["path-customs-house", "Customs house", "Port city", "Boats pay a quarter more and sell for a quarter less; goods from abroad."],
];
if (want("path")) {
  await growAll(3);
  const used = [];
  for (const [i, [id, name, path, does]] of PATHS.entries()) {
    if (!pick(id)) continue;
    const t = TOWNS[i % TOWNS.length];
    const spot = await findOpen(220, 220, t.x + 150, t.z + 150, used);
    used.push([...spot, 400, 400]);
    const ids = await put([[id, spot[0], spot[1], 0]]);
    await look(spot[0], spot[1], 900, 0.9, Math.PI / 4);
    await overlay(`<div class="title"><b>${name} · ${path}</b><span>${t.name} settled on this path. ${does}</span></div>`, true);
    await shot(`path-${id.slice(5)}`);
    if (id === "path-guildhall") globalThis.leanAt = { t, spot, ids };
    else await takeAway(ids);
  }
  // The town card with the Leaning meter: a town, a level before it settles, its landmark-to-be beside it.
  const L = globalThis.leanAt ?? { t: TOWNS[1], spot: [TOWNS[1].x + 200, TOWNS[1].z] };
  await look(L.spot[0] + 120, L.spot[1] + 80, 1400, 0.85, Math.PI / 4);
  const s = await screenOf(L.spot[0], L.spot[1], 90);
  await overlay(
    `<div class="pin" style="left:${s.x}px;top:${Math.max(260, s.y - 140)}px">🧺 Becomes this as a market city</div>
     <div class="sheet">
       <h2>${L.t.name}</h2>
       <div style="display:flex;gap:6px;justify-content:center;align-items:center;margin-top:8px"><span class="chip">Town</span><span class="chip lean">🧺 Leaning: Market</span></div>
       <div class="row"> Planks <span class="bar"><i style="width:64%"></i></span><span class="n">9/14</span></div>
       <div class="row">🌾 Flour <span class="bar"><i style="width:33%"></i></span><span class="n">2/6</span></div>
       <div class="lean">
         <div class="h"><span>Leaning</span><span style="color:#7a4310">settles as a city</span></div>
         <div class="meter"><i style="width:46%;background:#e3a43a"></i><i style="width:24%;background:#8d5a3c"></i><i style="width:18%;background:#2f6db5"></i><i style="width:12%;background:#6b4a8f"></i></div>
         <div class="legend"><span><s style="background:#e3a43a"></s>🧺 Market 46</span><span><s style="background:#8d5a3c"></s>🏭 Industrial 24</span><span><s style="background:#2f6db5"></s>🏖️ Resort 18</span><span><s style="background:#6b4a8f"></s>🎓 University 12</span></div>
       </div>
       <div class="line"><b>Food and riders push it to Market.</b> Bring coal, iron or bricks to lean it Industrial instead. It settles on its strongest lean when it becomes a city.</div>
     </div>
     <div class="note">MOCK · town card with the Leaning meter</div>`,
    false,
  );
  await p.evaluate(() => document.querySelectorAll(".tray").forEach((el) => (el.style.visibility = "hidden")));
  await shot("design-character-leaning");
}

await b.close();
await server.close();
