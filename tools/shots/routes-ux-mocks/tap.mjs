import { readFileSync } from "node:fs";
import { openCard, tapSel, clearToasts } from "./scenes.mjs";
const CSS = readFileSync(new URL("./mock.css", import.meta.url), "utf8") + `
.mk-ring { position: absolute; z-index: 5; pointer-events: none; border-radius: 50%; transform: translate(-50%, -50%);
  box-shadow: 0 0 0 3px rgba(255,250,240,.95), 0 0 0 6px rgba(58,42,28,.35), 0 0 18px 8px rgba(255,236,190,.55); background: rgba(255,248,225,.18); }
.mk-ring.no { box-shadow: 0 0 0 3px rgba(255,250,240,.9), 0 0 0 5px rgba(176,57,31,.55); background: rgba(255,240,230,.12); border: 2px dashed rgba(176,57,31,.8); }
.mk-tag { position: absolute; z-index: 6; transform: translate(-50%, 0); padding: 3px 9px; border-radius: 999px; background: #fffaf0; color: #3a2a1c; font-weight: 800; font-size: 13px; box-shadow: 0 2px 6px rgba(60,40,20,.3); white-space: nowrap; }
.mk-toast { position: absolute; left: 50%; transform: translateX(-50%); top: 250px; z-index: 60; padding: 10px 16px; border-radius: 14px; background: #fffaf0; color: #3a2a1c; font-weight: 800; font-size: 15px; box-shadow: 0 6px 18px rgba(60,40,20,.3); border-left: 5px solid #b0391f; white-space: nowrap; }`;
async function rings(p, extra) {
  await p.evaluate((extra) => {
    const w = window.woodrail;
    const proj = (x, y, z) => { const c = new w.camera.position.constructor(x, y, z).project(w.camera); return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight]; };
    const add = (x, z, r, cls, tag) => {
      const [sx, sy] = proj(x, 20, z);
      const el = document.createElement("div"); el.className = `mk-ring mk-inj ${cls}`; Object.assign(el.style, { left: sx + "px", top: sy + "px", width: r + "px", height: r + "px" }); document.body.append(el);
      if (tag) { const t = document.createElement("div"); t.className = "mk-tag mk-inj"; t.textContent = tag; Object.assign(t.style, { left: sx + "px", top: sy + r / 2 + 4 + "px" }); document.body.append(t); }
    };
    // Every place a route can stop at: its building, not only its track (here the industries' yards).
    const stops = new Set([...w.economy.lines.values()].filter((l) => l.colour === "#2f6db5").flatMap((l) => l.stops.map((st) => st.depotId)));
    for (const d of w.economy.allDepots()) {
      const piece = w.layout.getPiece(d.pieceId); if (!piece) continue;
      const q = piece.pose;
      const x = q.x + Math.cos(q.heading) * 108 - Math.sin(q.heading) * 150, z = q.z + Math.sin(q.heading) * 108 + Math.cos(q.heading) * 150;
      if (!stops.has(d.id)) add(x, z, 64, "", null);
    }
    for (const e of extra) add(e.x, e.z, e.r, e.cls, e.tag);
  }, extra);
}
export default [
  {
    name: "C1-tap-places",
    async run(p, s) {
      await p.addStyleTag({ content: CSS });
      await openCard(p, s.engines[1]);
      await p.waitForTimeout(800);
      await tapSel(p, ".engine-extra .route-plan");
      await clearToasts(p);
      await p.evaluate(() => { const w = window.woodrail; w.director.glideTo(new w.controls.target.constructor(-100, 0, -200), 2600, { duration: 0.1 }); });
      await p.waitForTimeout(1500);
      await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
      const t = await p.evaluate(() => window.woodrail.world.landscape.towns[0].centre);
      await rings(p, [{ x: t.x, z: t.z, r: 110, cls: "", tag: "Larkfield" }]);
      await p.evaluate(() => { const h = document.querySelector(".route-plan-hint"); if (h) h.textContent = "Tap a place (its building or its track) to add it, or a stop to pick it"; });
    },
  },
  {
    name: "C2-needs-station",
    async run(p, s) {
      await p.evaluate(() => document.querySelectorAll(".mk-inj").forEach((e) => e.remove()));
      const t = await p.evaluate(() => window.woodrail.world.landscape.towns[0].centre);
      await rings(p, [{ x: t.x, z: t.z, r: 110, cls: "no", tag: "Larkfield" }]);
      await p.evaluate(() => document.body.insertAdjacentHTML("beforeend", `<div class="mk-toast mk-inj">Larkfield needs a station first</div>`));
    },
  },
];
