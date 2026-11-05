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
#mock .ribbon { position: absolute; left: 12px; right: 12px; top: 74px; background: rgba(250,243,230,0.96); border-radius: 16px; box-shadow: 0 4px 18px rgba(60,40,20,0.2); padding: 7px 12px; display: flex; align-items: center; gap: 8px; font-weight: 900; font-size: 14px; }
#mock .ribbon .bar { flex: 1; height: 10px; background: #efe2cc; border-radius: 6px; overflow: hidden; }
#mock .ribbon .bar i { display: block; height: 100%; background: linear-gradient(90deg, #e9b949, #d9902c); }
#mock .ribbon .show { width: 34px; height: 34px; border-radius: 50%; background: #efe2cc; display: grid; place-items: center; font-size: 17px; }
#mock .stage { display: flex; gap: 10px; align-items: flex-start; margin-top: 8px; font-size: 13.5px; }
#mock .stage .dot { width: 26px; height: 26px; flex: none; border-radius: 50%; display: grid; place-items: center; font-weight: 900; font-size: 13px; background: #efe2cc; color: #74522f; }
#mock .stage.done .dot { background: #8fd08a; color: #13310f; }
#mock .stage.now .dot { background: #e9b949; color: #3a2a1c; }
#mock .goods { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
#mock .goods span { background: #fffaf0; border-radius: 8px; padding: 2px 7px; font-weight: 800; font-size: 13px; box-shadow: inset 0 -2px 0 rgba(176,122,68,0.25); }
#mock .sub { text-align: center; font-size: 13px; color: #74522f; margin-top: 2px; font-weight: 700; }
#mock .tabs { display: flex; gap: 6px; justify-content: center; margin-top: 10px; }
#mock .tabs span { width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; font-weight: 900; font-size: 13px; background: #efe2cc; color: #74522f; }
#mock .tabs span.done { background: #8fd08a; color: #13310f; }
#mock .tabs span.now { background: #e9b949; color: #3a2a1c; box-shadow: 0 0 0 2px #3a2a1c inset; }
#mock .task { display: flex; gap: 10px; align-items: center; margin-top: 9px; font-size: 14.5px; font-weight: 800; }
#mock .task .box { width: 24px; height: 24px; border-radius: 7px; flex: none; display: grid; place-items: center; background: #efe2cc; font-size: 14px; }
#mock .task.done { color: #74522f; }
#mock .task.done .box { background: #8fd08a; color: #13310f; }
#mock .gift { margin-top: 12px; background: #fdf3cf; border-radius: 12px; padding: 8px 12px; font-size: 13.5px; font-weight: 800; }
#mock .stat { display: flex; justify-content: space-between; align-items: center; margin-top: 7px; font-size: 14.5px; font-weight: 800; }
#mock .stat em { font-style: normal; color: #5aa35a; font-size: 13px; }
#mock .stars { text-align: center; font-size: 30px; letter-spacing: 3px; color: #e3a43a; margin-top: 6px; }
#mock .stars s { text-decoration: none; color: #e4d6bd; }
#mock .toast { position: absolute; left: 24px; right: 24px; top: 128px; background: #fdf3cf; border-left: 6px solid #e9b949; border-radius: 10px; padding: 10px 14px; font-weight: 900; font-size: 15px; box-shadow: 0 4px 14px rgba(60,40,20,0.25); }
#mock .btns { display: flex; gap: 8px; justify-content: center; margin-top: 12px; }
#mock .btn { background: #5aa35a; color: #fff; font-weight: 900; border-radius: 12px; padding: 10px 16px; box-shadow: inset 0 -4px 0 rgba(0,0,0,0.18); font-size: 14px; }
#mock .btn.soft { background: #efe2cc; color: #3a2a1c; }
#mock .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; justify-content: center; }
#mock .chips span { background: #fffaf0; border-radius: 999px; padding: 4px 10px; font-weight: 800; font-size: 12.5px; box-shadow: inset 0 -2px 0 rgba(176,122,68,0.25); }
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
/** The camera at (dist, phi, theta), panned so world point (x, z) shows at screen (sx, sy). */
const frame = async (x, z, dist, phi, theta, sx, sy) => {
  await look(x, z, dist, phi, theta);
  const s0 = await screenOf(x, z);
  const a1 = await screenOf(x + 100, z);
  const b1 = await screenOf(x, z + 100);
  const a = (a1.x - s0.x) / 100, b = (b1.x - s0.x) / 100, c = (a1.y - s0.y) / 100, d = (b1.y - s0.y) / 100;
  const ex = s0.x - sx, ey = s0.y - sy;
  const det = a * d - b * c;
  await look(x + (d * ex - b * ey) / det, z + (-c * ex + a * ey) / det, dist, phi, theta);
};
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
            if (g.height[i] > 2) return no("height");
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
const LAST = { "grand-exhibition": [4, "Opening day"], "grand-cathedral": [4, "Stained glass"] };
const CONTEXT = {
  "grand-exhibition": "Beside the city: the hall on its opening day.",
  "grand-cathedral": "The biggest thing in the city: its spires over every roof.",
  "grand-royal-train": "On the line out of the city, the crowned saloon behind its engine.",
  "grand-central": "Grand Central at the city's heart.",
  "grand-ferris-wheel": "The wheel over the city's roofs in fair week.",
};
if (want("grand")) {
  await growAll(3);
  for (const [id, name, goods, day] of GRAND) {
    if (!pick(id)) continue;
    const [n, lastName] = LAST[id] ?? [3, "Finished"];
    const names = ["Foundations", "Half built", "Finished", lastName].slice(0, n);
    if (n === 3) names[2] = lastName;
    const gap = id === "grand-cathedral" ? 560 : id === "grand-exhibition" ? 470 : 430;
    // Three in a column up the screen; four in a 2 × 2 grid (stage 1 top left, reading order).
    const zgap = id === "grand-cathedral" ? 380 : 300;
    let spot = n === 4 ? null : await findOpen(gap * n + 120, 460, MID.x, MID.z);
    const grid = !spot;
    if (grid) spot = await findOpen(2 * gap + 60, 2 * zgap + 60, MID.x, MID.z);
    console.log(id, "spot", JSON.stringify(spot), grid ? "grid" : "column");
    const [cx, cz] = spot;
    // (Up the screen is −x; right is −z.)
    const xs = names.map((_, i) => (grid ? cx + (Math.floor(i / 2) - 0.5) * gap : cx + (i - (n - 1) / 2) * gap));
    const zs = names.map((_, i) => (grid ? cz + (0.5 - (i % 2)) * zgap : cz));
    // (The wheel turns in its own plane: stood across the view so it's seen face on.)
    const heading = id === "grand-ferris-wheel" ? Math.PI / 2 : 0;
    const ids = await put(xs.map((x, i) => [`${id}-${i + 1}`, x, zs[i], heading]));
    await look(cx + 120, cz, grid ? 2600 * (id === "grand-cathedral" ? 1.15 : 1) : 2500, 0.75, UP);
    const pins = [];
    for (const [i, x] of xs.entries()) {
      const s = await screenOf(x + (grid ? 150 : 0), zs[i] + (grid ? 0 : 150), 10);
      pins.push(`<div class="pin" style="left:${Math.min(330, Math.max(70, s.x))}px;top:${s.y}px">${i + 1} · ${names[i]}</div>`);
    }
    await overlay(`${pins.join("")}<div class="title"><b>${name}</b><span>${goods}</span></div>`, false);
    await shot(`grand-${id.slice(6)}-stages`);
    // The close-up: the last stage alone, the camera the game's own (from a corner).
    await takeAway(ids.slice(0, n - 1));
    const close = id === "grand-royal-train" ? 900 : id === "grand-cathedral" ? 2200 : id === "grand-exhibition" ? 1500 : 1350;
    await frame(xs[n - 1] + (id === "grand-exhibition" ? 50 : 0), zs[n - 1], close, 0.95, id === "grand-ferris-wheel" ? Math.PI / 4 + Math.PI / 2 : Math.PI / 4, 195, 420);
    await overlay(`<div class="title"><b>${name}</b><span>${day}</span></div>`, true);
    await shot(`grand-${id.slice(6)}`);
    await overlay("", false);
    await takeAway(ids.slice(n - 1));
    // In context: the finished one beside a city.
    const t = TOWNS[id === "grand-cathedral" ? 0 : id === "grand-exhibition" ? 2 : 1];
    const size = id === "grand-cathedral" ? [440, 380] : id === "grand-exhibition" ? [470, 300] : [360, 260];
    const near = await findOpen(size[0], size[1], t.x + 250, t.z + 250);
    const cid = await put([[`${id}-${n}`, near[0], near[1], heading]]);
    let rails = null;
    if (id === "grand-royal-train") {
      // On a line: real track on from either end of its display track.
      rails = await p.evaluate(({ x, z }) => {
        const w = window.woodrail;
        const run = [];
        for (let i = 0; i < 2; i++) run.push({ type: "straight-216", pose: { x: x + 156 + i * 216, z, heading: 0 }, y: 0, flipped: false });
        for (let i = 1; i <= 2; i++) run.push({ type: "straight-216", pose: { x: x - 156 - i * 216, z, heading: 0 }, y: 0, flipped: false });
        return w.editor().placeRun(run);
      }, { x: near[0], z: near[1] });
      await settle();
    }
    // The project low in the view, its city behind it.
    await frame(near[0], near[1], id === "grand-royal-train" ? 1500 : id === "grand-cathedral" ? 2600 : 2300, 0.85, Math.PI / 4, 195, 560);
    await overlay(`<div class="title"><b>${name} · ${t.name}</b><span>${CONTEXT[id]}</span></div>`, true);
    await shot(`grand-${id.slice(6)}-city`);
    if (id === "grand-royal-train") {
      await frame(near[0] + 60, near[1], 620, 1.05, Math.PI / 2 + 0.6, 195, 400);
      await overlay(`<div class="title"><b>The Royal Train</b><span>Claret lined in gold, polished brass, a crest on the cab, a crowned saloon and an observation balcony.</span></div>`, true);
      await shot("grand-royal-train-track");
      await p.evaluate((ids) => window.woodrail.editor().removeGroup(ids), rails);
    }
    await overlay("", false);
    await takeAway(cid);
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

// ---- The options, as mocks on clean game views (HTML over the game; the hall is the real asset) -------------------------
if (want("options")) {
  await growAll(3);
  const hide = () => p.evaluate(() => document.querySelectorAll(".goals, .tray, .toast, .card, .reward-badge, .growth-sheet").forEach((el) => (el.style.visibility = "hidden")));
  // 1. The grand project: the Great Exhibition half built beside a city, the ribbon in the goal bar's place, its card.
  const T = TOWNS[2] ?? TOWNS[0];
  const site = await findOpen(340, 200, T.x + 300, T.z + 300);
  const hall = await put([["grand-exhibition-2", site[0], site[1], 0]]);
  await frame(site[0], site[1], 1500, 0.95, Math.PI / 4, 195, 470);
  const pin = await screenOf(site[0], site[1], 110);
  await overlay(
    `<div class="ribbon"><span>🏛️ Great Exhibition</span><span style="color:#74522f;font-size:12.5px">2 of 4</span><span class="bar"><i style="width:46%"></i></span><span style="font-size:12.5px">46%</span><span class="show">⌖</span></div>
     <div class="pin" style="left:${pin.x}px;top:${pin.y}px">🏗️ The iron hall</div>
     <div class="sheet">
       <h2>The Great Exhibition</h2>
       <div class="sub">beside ${T.name} · the whole map builds it</div>
       <div class="stage done"><div class="dot">✓</div><div><b>Foundations</b><div class="goods"><span>🪨 40 stone</span><span> 30 planks</span></div></div></div>
       <div class="stage now"><div class="dot">2</div><div><b>The iron hall</b> · a train is bringing bricks<div class="goods"><span>⚙️ 22/40 iron</span><span>🧱 11/30 bricks</span></div></div></div>
       <div class="stage"><div class="dot">3</div><div><b>The stands</b> · an exhibit from 3 kinds of city</div></div>
       <div class="stage"><div class="dot">4</div><div><b>Opening day</b> · the Royal Train, then the report card</div></div>
     </div>`,
    false,
  );
  await hide();
  await shot("design-option-project");
  await takeAway(hall);

  // 2. Chapters: the railway's storybook.
  await look(MID.x, MID.z, 4200, 0.7, Math.PI / 4);
  await overlay(
    `<div class="ribbon"><span>📖 Chapter 4</span><span style="color:#74522f;font-size:12.5px">2 of 4</span><span class="bar"><i style="width:50%;background:#8fd08a"></i></span><span class="show">⌖</span></div>
     <div class="sheet">
       <h2>The line to the coast</h2>
       <div class="sub">Chapter 4 of 8 · the Railway Storybook</div>
       <div class="tabs"><span class="done">1</span><span class="done">2</span><span class="done">3</span><span class="now">4</span><span>5</span><span>6</span><span>7</span><span>8</span></div>
       <div class="task done"><span class="box">✓</span>Buy the plot by the sea</div>
       <div class="task done"><span class="box">✓</span>Bridge the river</div>
       <div class="task"><span class="box"></span>Run a train to the beach halt</div>
       <div class="task"><span class="box"></span>Bring 10 🐟 fish back to a town</div>
       <div class="gift">🎁 Chapter gift: a seaside station and a striped canopy for every station on the line</div>
       <div class="line">Next: <b>Chapter 5 · Fair weather</b>, the first fair by train.</div>
     </div>`,
    false,
  );
  await hide();
  await shot("design-option-chapters");

  // 3. The yearly Jubilee report.
  await look(TOWNS[0].x + 200, TOWNS[0].z, 2600, 0.8, Math.PI / 4);
  await overlay(
    `<div class="sheet" style="top:96px;bottom:auto">
       <h2>Your railway's year</h2>
       <div class="sub">Spring 2003 · year 3 of 10 to the Jubilee</div>
       <div class="stars">★★★<s>★★</s></div>
       <div class="stat"><span>🏙️ Towns grown</span><span>2 cities, 2 towns <em>+2</em></span></div>
       <div class="stat"><span>📦 Loads carried</span><span>412 <em>+180</em></span></div>
       <div class="stat"><span>🧺 Kinds of goods</span><span>7 <em>+2</em></span></div>
       <div class="stat"><span>🛤️ Longest line</span><span>38 pieces <em>+9</em></span></div>
       <div class="stat"><span>🧑 Riders</span><span>260 <em>+140</em></span></div>
       <div class="line" style="margin-top:12px"><b>For a 4th star:</b> join the fourth town, or carry a new kind of good.</div>
       <div class="gift">🎖️ A rosette for the station at Larkfield. At year 10, the Jubilee: every town's best, on one card, and a parade by train.</div>
       <div class="btns"><span class="btn">Lovely!</span></div>
     </div>`,
    false,
  );
  await hide();
  await shot("design-option-jubilee");

  // 4. Cozy events: the circus train comes to call.
  const t0 = TOWNS[1];
  const ev = await findOpen(900, 200, t0.x, t0.z + 400);
  const evLine = await p.evaluate(
    ({ ex, ez }) => {
      const w = window.woodrail;
      const run = [0, 1, 2, 3].map((n) => ({ type: "straight-216", pose: { x: ex - 432 + n * 216, z: ez, heading: 0 }, y: 0, flipped: false }));
      const pieces = w.editor().placeRun(run);
      const r = w.sim.addTrain(["engine", "passenger", "passenger", "passenger"], { pieceId: pieces[2], pathIndex: 0, s: 150, reversed: false });
      w.invalidate();
      return { pieces, r: r.kind };
    },
    { ex: ev[0], ez: ev[1] },
  );
  console.log("event line", JSON.stringify(evLine));
  const tents = await put([["scene-tent", ev[0] - 80, ev[1] - 90, 0.3], ["scene-bunting", ev[0] + 40, ev[1] - 70, 0], ["scene-tent", ev[0] + 60, ev[1] - 110, -0.4]]);
  await frame(ev[0], ev[1] - 30, 1250, 0.9, Math.PI / 4, 195, 400);
  await overlay(
    `<div class="toast">🎪 The circus train has come to call!</div>
     <div class="sheet">
       <h2>The circus train</h2>
       <div class="sub">a visiting train · it waits until you're ready</div>
       <div class="line" style="text-align:center"><b>Give it a route through 3 towns.</b> Wherever it stops, crowds come to see, and that town grows a little.</div>
       <div class="btns"><span class="btn">Plan its route</span><span class="btn soft">Later</span></div>
       <div class="chips"><span>🚢 A big ship wants 30 planks</span><span>🌾 Harvest: farms give double in Sep</span><span>👑 A royal visit</span><span>🎡 Fair week</span></div>
       <div class="line" style="text-align:center">Events never close a line or take anything away.</div>
     </div>`,
    false,
  );
  await hide();
  await shot("design-option-events");
  await takeAway(tents);
}

// ---- The City choice sheet, and the Journal's achievements (HTML over the game) -------------------------------------
if (want("choice")) {
  await growAll(3);
  const hide = () => p.evaluate(() => document.querySelectorAll(".goals, .tray, .toast, .card, .reward-badge, .growth-sheet").forEach((el) => (el.style.visibility = "hidden")));
  const t = TOWNS[1];
  await frame(t.x, t.z, 1500, 0.85, Math.PI / 4, 195, 190);
  const opt = (icon, name, what, state, extra = "") =>
    `<div class="choice ${state}"><div class="ic">${icon}</div><div style="flex:1"><div class="t">${name} ${extra}</div><div class="d">${what}</div></div></div>`;
  await overlay(
    `<div class="sheet" style="top:150px;padding-bottom:12px">
       <h2>${t.name} is a city!</h2>
       <div class="sub">Choose its speciality. It's for good; every kind stays open to your other cities.</div>
       ${opt("🧺", "Market town", "A guildhall and market. 2× riders; food pays more. Grows on bread and cheese.", "ok", '<span class="sugg">Suggested</span>')}
       ${opt("🏭", "Industrial city", "An engine works. Industries near it work 1.25× as fast. Grows on iron and bricks.", "ok")}
       ${opt("🏖️", "Resort", "A pier and pavilion. Summer crowds; riders who come count toward growth.", "ok")}
       ${opt("⚓", "Port city", "🔒 Needs a harbour within 12 squares. Build one by the river to choose this.", "locked")}
       ${opt("🎓", "University city", "🔒 Needs its school to be a College (learn College).", "locked")}
       <div class="line" style="text-align:center">Suggested from what it's been brought: 46 food, 24 iron and coal, 18 riders.</div>
       <div class="btns"><span class="btn soft">Choose later</span></div>
     </div>`,
    false,
  );
  await p.addStyleTag({ content: "#mock .choice{display:flex;gap:10px;align-items:center;background:#fffaf0;border-radius:14px;box-shadow:inset 0 -4px 0 rgba(176,122,68,.28),0 2px 8px rgba(60,40,20,.12);padding:8px 12px;margin-top:8px}#mock .choice .ic{font-size:28px;width:40px;text-align:center}#mock .choice .t{font-weight:900;font-size:15.5px}#mock .choice .d{font-size:12.5px;color:#5e4128;line-height:1.3;margin-top:2px}#mock .choice.locked{opacity:.55;background:#f1e8d8}#mock .sugg{display:inline-block;background:#e9b949;color:#3a2a1c;border-radius:999px;padding:1px 8px;font-size:11.5px;margin-left:4px;vertical-align:2px}" });
  await hide();
  await shot("design-character-city-choice");

  // The Journal's Achievements tab: each grand project, its stage, its reward.
  await look(MID.x, MID.z, 3600, 0.75, Math.PI / 4);
  const ach = (icon, name, stage, n, reward, state) =>
    `<div class="ach ${state}"><div class="ic">${icon}</div><div style="flex:1"><div class="t">${name}</div><div class="pips">${Array.from({ length: n }, (_, i) => `<i class="${i < stage ? "on" : ""}"></i>`).join("")}<span>${state === "done" ? "Built!" : state === "now" ? `stage ${stage + 1} of ${n}` : "not started"}</span></div><div class="d">🎁 ${reward}</div></div></div>`;
  await overlay(
    `<div class="sheet" style="top:96px">
       <h2>Journal</h2>
       <div class="tabs2"><span>News</span><span class="on">Achievements</span><span>Stickers</span></div>
       ${ach("🏛️", "The Great Exhibition", 4, 4, "Every town grew a step. (Earned)", "done")}
       ${ach("⛪", "The Cathedral", 2, 4, "Every town grows on a tenth fewer goods, for good.", "now")}
       ${ach("👑", "The Royal Train", 0, 3, "The Royal Train is yours to run; riders on it pay double.", "")}
       ${ach("🚉", "Grand Central", 0, 3, "Its station takes three trains at once; riders on lines through it pay a quarter more.", "")}
       ${ach("🎡", "The World's Fair wheel", 0, 3, "Fair week each summer: 3× riders to its city, and 60 coins a month.", "")}
     </div>`,
    false,
  );
  await p.addStyleTag({ content: "#mock .tabs2{display:flex;gap:6px;justify-content:center;margin:10px 0 4px}#mock .tabs2 span{padding:6px 12px;border-radius:10px;background:#efe2cc;font-weight:800;font-size:13px}#mock .tabs2 span.on{background:#3a2a1c;color:#fff}#mock .ach{display:flex;gap:10px;align-items:center;background:#fffaf0;border-radius:14px;box-shadow:inset 0 -4px 0 rgba(176,122,68,.28);padding:9px 12px;margin-top:9px}#mock .ach .ic{font-size:28px;width:40px;text-align:center}#mock .ach .t{font-weight:900;font-size:15px}#mock .ach .d{font-size:12.5px;color:#5e4128;margin-top:3px;line-height:1.3}#mock .ach.done{background:#eef7e8}#mock .ach.done .t::after{content:' ✓';color:#2f5a27}#mock .pips{display:flex;gap:4px;align-items:center;margin-top:4px}#mock .pips i{width:18px;height:7px;border-radius:4px;background:#e4d6bd;display:block}#mock .pips i.on{background:#e9b949}#mock .ach.done .pips i.on{background:#8fd08a}#mock .pips span{font-size:11.5px;font-weight:800;color:#74522f;margin-left:4px}" });
  await hide();
  await shot("design-character-achievements");
}

await b.close();
await server.close();
