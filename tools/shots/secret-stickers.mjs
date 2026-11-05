// Mocks for the secret sites' tourists (design only, nothing wired): the tiered sticker "Day tripper / Tour guide /
// Grand tourist" (25 / 100 / 250 tourist trips to found secrets) in the Journal's Stickers tab, its drawings from
// docs/design/secret-stickers (in the icon font's style, not in the font yet); and a found secret's halt card with
// its trip count, over the castle with a train standing at its halt. The Journal is the game's own, its Stickers tab
// filled by hand with the game's sticker markup (a harness shortcut: the tab opens only after the core goals); the
// card is an HTML mock. Props, track and the train are put down by hand, as in secret-sites.mjs.
//
// Usage: node tools/shots/secret-stickers.mjs [<out dir>]   (default out: docs/agents/shots)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5395, strictPort: false }, logLevel: "error" });
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

const svg = (f) => readFileSync(`${ROOT}/docs/design/secret-stickers/${f}`, "utf8").replace("<svg ", '<svg width="34" height="34" style="vertical-align:top" ').replace(/<title>.*?<\/title>/, "");
const ART = { ticket: svg("u1F3AB-ticket.svg"), flag: svg("u1F6A9-guide-flag.svg"), case: svg("u1F9F3-suitcase.svg") };

// ---- The sticker, in the Journal's Stickers tab --------------------------------------------------------------------
await p.evaluate(async (ART) => {
  const { STICKERS } = await import("/src/game/stickers.ts");
  const root = document.querySelector(".goals");
  root.hidden = false;
  root.classList.remove("collapsed");
  const tabs = [...root.querySelectorAll(".goals-tab")];
  for (const t of tabs) t.hidden = false;
  tabs.forEach((t, i) => t.classList.toggle("on", i === 2));
  root.querySelector(".goals-pane").hidden = true;
  root.querySelector(".news-pane").hidden = true;
  const pane = root.querySelector(".stickers-pane");
  pane.hidden = false;
  const got = new Set(["track-layer", "towns-5", "all-towns", "busy-timetable"]);
  const tile = (s) => `<button class="sticker${got.has(s.id) ? " got" : ""}"><span class="sticker-icon">${s.hidden && !got.has(s.id) ? "❔" : s.icon}</span><span class="sticker-name">${s.hidden && !got.has(s.id) ? "???" : s.title}</span></button>`;
  const mine = (cls, art, name) => `<button class="sticker${cls}"><span class="sticker-icon">${art}</span><span class="sticker-name">${name}</span></button>`;
  const exploring = [
    mine(" got", ART.ticket, "Day tripper"),
    mine(" got new picked", ART.flag, "Tour guide"),
    mine("", ART.case, "Grand tourist"),
  ].join("");
  const THEMES = [["building", "Building"], ["trains", "Trains"]];
  const groups = THEMES.map(([theme, label]) => `<h4 class="stickers-theme">${label}</h4><div class="stickers-grid">${STICKERS.filter((s) => s.theme === theme).map(tile).join("")}</div>`).join("");
  pane.innerHTML =
    `<p class="stickers-count">🌟 ${got.size + 2} / ${STICKERS.length + 3} stickers</p>` +
    `<p class="sticker-ticket"><b>Tour guide</b> Earned! Take 100 tourist trips to secrets you've found. <b>142 / 250</b> to Grand tourist.</p>` +
    `<h4 class="stickers-theme">Exploring</h4><div class="stickers-grid">${exploring}</div>` +
    groups;
  const note = document.createElement("div");
  note.id = "mock";
  note.innerHTML = `<div class="note" style="top:auto;bottom:6px">MOCK · tourist trips sticker (25 / 100 / 250)</div>`;
  document.body.append(note);
}, ART);
await p.waitForTimeout(600);
await shot("secret2-sticker");
await p.evaluate(() => {
  document.getElementById("mock")?.remove();
  const root = document.querySelector(".goals");
  root.classList.add("collapsed");
  root.querySelector(".stickers-pane").hidden = true;
});

// ---- The halt card: the castle found, a train at its halt, the card with its trip count -------------------------------
const TOWNS = await p.evaluate(() => window.woodrail.world.landscape.towns.map((t) => ({ name: t.name, x: t.centre.x, z: t.centre.z })));
const MID = { x: TOWNS.reduce((a, t) => a + t.x, 0) / TOWNS.length, z: TOWNS.reduce((a, t) => a + t.z, 0) / TOWNS.length };
const spot = await findOpen(460, 460, MID.x + 300, MID.z - 300);
const [cx, cz] = [spot[0] + 20, spot[1] - 20];
await put([["secret-castle", cx, cz, 0]]);
await p.evaluate(
  ({ cx, cz }) => {
    const w = window.woodrail;
    const z = cz + 170;
    const run = [3, 2, 1, 0].map((n) => ({ type: "straight-216", pose: { x: cx - 108 - n * 216, z, heading: 0 }, y: 0, flipped: false }));
    run.push({ type: "buffer", pose: { x: cx + 108, z, heading: 0 }, y: 0, flipped: false });
    const pieces = w.editor().placeRun(run);
    w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: pieces[3], pathIndex: 0, s: 200, reversed: false });
    w.paused = true;
    w.invalidate();
  },
  { cx, cz },
);
await settle();
await look(cx - 20, cz + 280, 1500, 0.8, 0);
const towns = TOWNS.slice(0, 4).map((t) => t.name);
await overlay(
  `<div class="sheet">
     <h2>Ruined castle halt</h2>
     <div style="display:flex;gap:6px;justify-content:center;align-items:center;margin-top:8px;flex-wrap:wrap"><span style="background:#dff0d8;color:#2f5a27;border-radius:999px;padding:3px 11px;font-weight:800;font-size:13px">🌟 Secret found</span><span style="background:#f6e1c4;color:#7a4310;border-radius:999px;padding:3px 11px;font-weight:800;font-size:13px">🧑 Tourists ×2 fare</span></div>
     <div style="display:flex;align-items:baseline;justify-content:center;gap:8px;margin-top:12px"><span style="font-size:40px;font-weight:900;color:#3a2a1c;line-height:1">142</span><span style="font-size:16px;font-weight:900;color:#5e4128">tourist trips here</span></div>
     <div class="line" style="text-align:center;margin-top:4px">38 this year · 🪙 1,240 in fares</div>
     <div class="lean">
       <div class="h"><span>${ART.flag.replace('width="34" height="34"', 'width="20" height="20"')} Tour guide</span><span style="color:#7a4310">all secrets: 142 / 250</span></div>
       <div class="row" style="margin-top:6px"><span class="bar"><i style="width:57%;background:#e3a43a"></i></span></div>
       <div class="legend"><span>${ART.case.replace('width="34" height="34"', 'width="16" height="16"')} Grand tourist at 250</span></div>
     </div>
     <div class="row">🧑 ${towns[0] ?? "Elderwick"} <span class="bar"><i style="width:62%"></i></span><span class="n">51</span></div>
     <div class="row">🧑 ${towns[1] ?? "Ashby"} <span class="bar"><i style="width:44%"></i></span><span class="n">36</span></div>
     <div class="row">🧑 ${towns[2] ?? "Brookfield"} <span class="bar"><i style="width:36%"></i></span><span class="n">30</span></div>
     <div class="row">🧑 Other towns <span class="bar"><i style="width:30%"></i></span><span class="n">25</span></div>
     <div class="line"><b>No one lives here:</b> riders from every town get off for a day out, and pay twice the fare.</div>
   </div>
   <div class="note">MOCK · a found secret's halt card</div>`,
  false,
);
await p.evaluate(() => document.querySelectorAll(".tray").forEach((el) => (el.style.visibility = "hidden")));
await shot("secret2-halt-card");

await b.close();
await server.close();
