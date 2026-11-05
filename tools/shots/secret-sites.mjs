// Pictures of the secret sites (src/catalogue/assets/secrets.ts) on a real Game map, 390×844: each one not found yet
// (grown over, fogged, its old platform in the brambles), then found with its halt laid as real track (`SECRET_HALT`:
// a line run in to the halt's straight and buffer) and a train standing at the platform, then a close-up. Props, track
// and the train are put down by hand (a harness shortcut: `props.add`, `editor().placeRun`, the sim's `addTrain`, the
// game paused so the train stands), for looking only.
//
// Usage: node tools/shots/secret-sites.mjs [<out dir>]   (default out: docs/agents/shots). PICK=mine,castle
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
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5394, strictPort: false }, logLevel: "error" });
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

const TOWNS = await p.evaluate(() => window.woodrail.world.landscape.towns.map((t) => ({ name: t.name, x: t.centre.x, z: t.centre.z })));
const MID = { x: TOWNS.reduce((a, t) => a + t.x, 0) / TOWNS.length, z: TOWNS.reduce((a, t) => a + t.z, 0) / TOWNS.length };
const UP = Number(process.env.THETA ?? 0);
const { SECRET_HALT } = await server.ssrLoadModule("/src/catalogue/assets/secrets.ts").catch(() => ({ SECRET_HALT: null }));
const HALT = SECRET_HALT ?? { pieces: [{ type: "straight-216", x: -108, z: 170, heading: 0 }, { type: "buffer", x: 108, z: 170, heading: 0 }] };

const SITES = [
  ["secret-lost-mine", "lost-mine", "Lost mine", "A rock face seamed with gold, the headframe over the shaft.", "The wheel turns again and a cart's full of gold: 300 coins. Tourists ride out to its halt."],
  ["secret-castle", "castle", "Ruined castle", "Broken walls on a mound, lost in the mist.", "Restored: red roofs, banners, the drawbridge down to its own halt. Day-trippers ride out."],
  ["secret-lake", "lake", "Hidden lake", "Something under the mist, ringed by dark woods.", "The mist lifts: a waterfall, a temple on its island, boats and swans. A boating day out."],
  ["secret-shipwreck", "shipwreck", "Shipwreck", "A hull in the sand, sea mist rolling in.", "Her mast stands again and the chest spills gold: 300 coins. Tourists come to see her."],
  ["secret-stones", "stones", "Standing stones", "Grey shapes in the fog, half of them fallen.", "They stand again: midsummer brings visitors from every town to their halt."],
  ["secret-footprint", "footprint", "Giant's footprint", "A hollow in the field, toes showing through the mist.", "Ducks, a look-out tower and the tale on a board: families ride out to picnic."],
];
const W = 460;
const spot = await findOpen(W, W, MID.x + 300, MID.z - 300);
console.log("spot", JSON.stringify(spot));
for (const [id, slug, name, hiddenLine, foundLine] of SITES) {
  if (!pick(id)) continue;
  const [cx, cz] = [spot[0] + 20, spot[1] - 20];
  // The shipwreck stands on a beach at the sea's edge (its placement rule): a stretch of shore behind it, sand to its
  // seaward edge (z −144 in its frame) and sea past that, written into the squares (a harness shortcut: the starter
  // map has no coast). Put back after.
  const shore =
    id === "secret-shipwreck"
      ? await p.evaluate(
          ({ cx, cz }) => {
            const w = window.woodrail;
            const g = w.world.landscape.grid;
            const was = [];
            const slots = new Set();
            for (let x = cx - 360; x <= cx + 360; x += 36)
              for (let z = cz - 144 - 324; z < cz - 144 + 108; z += 36) {
                const i = g.cellAtWorld(x, z + 18);
                if (i < 0) continue;
                was.push([i, g.surface[i], g.height[i], g.feature[i]]);
                g.surface[i] = z + 18 < cz - 144 ? 5 : 6;
                g.height[i] = 0;
                g.feature[i] = 0;
                slots.add(Math.floor(i / (31 * 23)));
              }
            w.editLand([...slots]);
            return { was, slots: [...slots] };
          },
          { cx, cz },
        )
      : null;
  // Not found yet.
  let ids = await put([[`${id}-hidden`, cx, cz, 0]]);
  await look(cx - 10, cz + 55, 1080, 0.82, UP);
  await overlay(`<div class="title"><b>❓ ${name}?</b><span>${hiddenLine} Lay track to it to find it.</span></div>`, false);
  await shot(`secret2-${slug}-hidden`);
  await takeAway(ids);
  // Found: the site, its halt laid as track with a line run in to it, a train standing at the platform.
  ids = await put([[id, cx, cz, 0]]);
  const line = await p.evaluate(
    ({ cx, cz, HALT }) => {
      const w = window.woodrail;
      const [st, buf] = HALT.pieces;
      const z = cz + st.z;
      const run = [3, 2, 1].map((n) => ({ type: "straight-216", pose: { x: cx + st.x - n * 216, z, heading: 0 }, y: 0, flipped: false }));
      run.push({ type: st.type, pose: { x: cx + st.x, z, heading: st.heading }, y: 0, flipped: false });
      run.push({ type: buf.type, pose: { x: cx + buf.x, z: cz + buf.z, heading: buf.heading }, y: 0, flipped: false });
      const pieces = w.editor().placeRun(run);
      const r = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: pieces[3], pathIndex: 0, s: 200, reversed: false });
      w.paused = true;
      w.trainView?.sync?.();
      w.invalidate();
      return { pieces, train: r.kind === "placed" ? r.trainId : JSON.stringify(r) };
    },
    { cx, cz, HALT },
  );
  console.log(id, "line", JSON.stringify(line));
  await settle();
  await look(cx - 10, cz + 55, 1080, 0.82, UP);
  const s = await screenOf(cx + 30, cz + 135, 60);
  await overlay(`<div class="pin" style="left:${Math.min(330, Math.max(70, s.x))}px;top:${s.y}px">🚉 ${name} halt</div><div class="title"><b>⭐ ${name} found!</b><span>${foundLine}</span></div>`, false);
  await shot(`secret2-${slug}-found`);
  await look(cx + 10, cz - 20, 760, 0.9, UP + 0.55);
  await overlay(`<div class="title"><b>${name}</b><span>${foundLine}</span></div>`, true);
  await shot(`secret2-${slug}-close`);
  await overlay("", false);
  await takeAway(ids);
  await p.evaluate((pieces) => {
    const w = window.woodrail;
    for (const t of w.sim.trainIds()) w.sim.removeTrain?.(t);
    w.editor().removeGroup(pieces);
    w.paused = false;
    w.invalidate();
  }, line.pieces);
  if (shore)
    await p.evaluate((shore) => {
      const w = window.woodrail;
      const g = w.world.landscape.grid;
      for (const [i, s, h, f] of shore.was) [g.surface[i], g.height[i], g.feature[i]] = [s, h, f];
      w.editLand(shore.slots);
    }, shore);
}

await b.close();
await server.close();
