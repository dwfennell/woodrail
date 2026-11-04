// Scenes for tools/shots/water-mock.mjs (SCENES=./water-assets.mjs): the water assets as built (catalogue models at
// their own size, on a real Game map), for the asset review. FELT=before|after names the felt pictures.
const RZ = 756;
const FELT = process.env.FELT ?? "after";
const dock = (p, x, side) =>
  p.evaluate(({ x, side, RZ }) => {
    const w = window.woodrail;
    const g = w.world.landscape.grid;
    const pz = RZ + side * (60 + 138);
    const y = g.groundY(g.cellAtWorld(x, pz));
    const id = w.editor().place("depot-harbour", { x, z: pz, heading: side > 0 ? Math.PI : 0 }, y, false);
    w.economy.depotAtPiece(id) ?? w.economy.addDepot("harbour", id);
    w.depotView.setWorld(w.economy, w.layout);
  }, { x, side, RZ });
const clean = (p) => p.addStyleTag({ content: ".hud .goal-bar, .hud [class*=goal] { visibility: hidden !important }" });
const caption = (p, text) =>
  p.evaluate((text) => {
    const d = document.createElement("div");
    d.className = "mock-ui";
    d.innerHTML = text;
    Object.assign(d.style, { position: "fixed", left: "16px", right: "16px", bottom: "170px", padding: "10px 14px", borderRadius: "16px", background: "rgba(255,250,240,.95)", color: "#3a2a1c", font: "700 15px/1.35 Nunito, system-ui, sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,.25)", zIndex: 5, textAlign: "center" });
    document.body.appendChild(d);
  }, text);
const settle = (p) => p.waitForTimeout(1200);

/** The tow: a tug at (x, z) heading `h`, then barges (asset ids) coupled behind, each `gap` apart. */
const tow = (p, tug, barges, x, z, h, gap = 72) =>
  p.evaluate(async ({ tug, barges, x, z, h, gap }) => {
    const c = Math.cos(h), s = Math.sin(h);
    await window.__add(tug, x, z, h, null);
    let d = gap - 4;
    for (const b of barges) {
      await window.__add(b, x - c * d, z - s * d, h, null);
      d += gap;
    }
  }, { tug, barges, x, z, h, gap });

export default {
  async felt(p, shot) {
    // The felt under boats, before or after: the catalogue's tug and paddle steamer on the river, close up.
    await clean(p);
    await p.evaluate(async ({ RZ }) => {
      await window.__add("veh-tugboat", -470, RZ + 10, Math.PI, null);
      await window.__add("veh-paddle-steamer", -330, RZ - 6, 0, null);
      window.__look(-400, RZ, 900, 0.85);
    }, { RZ });
    await settle(p);
    await caption(p, FELT === "before" ? "Before: a round felt pond under every boat" : "After: water felt only just round the hull");
    await shot(`water-felt-${FELT}.jpg`);
  },
  async sea(p, shot) {
    await clean(p);
    const spot = await p.evaluate(async () => {
      const w = window.woodrail;
      const { plotsForSale } = await import("/src/game/world.ts");
      const coast = w.world.landscape.coast;
      for (const q of plotsForSale(w.world.landscape)) if (coast.side === "s" && q.pz === coast.plot) w.unlockPlot(q.px, q.pz);
      await new Promise((r) => setTimeout(r, 3000));
      const g = w.world.landscape.grid;
      let best = null;
      for (let i = 0; i < g.cellCount; i++) {
        if (g.surface[i] !== 5) continue;
        const c = g.colOf(i), r = g.rowOf(i);
        const ok = [-2, -1, 0, 1, 2, 3].every((dc) => { const j = g.index(c + dc, r - 1), k = g.index(c + dc, r - 2), s = g.index(c + dc, r + 2); return j !== -1 && k !== -1 && s !== -1 && g.surface[j] !== 5 && g.surface[j] !== 1 && g.surface[k] !== 1 && g.surface[s] === 5; });
        if (!ok) continue;
        const x = g.centreX(c), z = g.centreZ(r);
        if (!best || Math.abs(x) < Math.abs(best.x)) best = { x, z };
      }
      window.__shore = best;
      return best;
    });
    if (!spot) return;
    await p.evaluate((f) => (window.__felt = f), FELT);
    await p.evaluate(async ({ x, z }) => {
      const w = window.woodrail;
      const g = w.world.landscape.grid;
      const pz = z - 36 - 138;
      const id = w.editor().place("depot-harbour", { x: x - 108, z: pz, heading: 0 }, g.groundY(g.cellAtWorld(x, pz)), false);
      w.economy.depotAtPiece(id) ?? w.economy.addDepot("harbour", id);
      w.depotView.setWorld(w.economy, w.layout);
      await window.__add(window.__felt === "before" ? "veh-cargo-ship" : "water-cargo-ship", x, z + (window.__felt === "before" ? 50 : 80), 0, null);
      await window.__add("bldg-lighthouse", x - 260, z - 70, 0, null, g.groundY(g.cellAtWorld(x - 260, z - 90)));
      window.__look(x - 60, z + 10, 1100, 0.85);
    }, spot);
    await settle(p);
    await caption(p, FELT === "before" ? "Before: the cargo ship on its round felt" : "After: the new cargo ship (24 loads, about a train long) on felt just round its hull, and the lighthouse");
    await shot(`water-sea-${FELT}.jpg`);
  },
  async tow(p, shot) {
    // The river tug and three barges (logs, stone, coal) on the river.
    if (FELT === "before") return;
    await clean(p);
    await tow(p, "water-river-tug", ["water-barge-logs", "water-barge-stone", "water-barge-coal"], -180, RZ + 4, 0, 92);
    await p.evaluate(({ RZ }) => window.__look(-300, RZ, 900, 0.8), { RZ });
    await settle(p);
    await caption(p, "River tug and barges: logs, stone, coal. Each barge is about a wagon long and holds 4 loads; magnets couple them, as wagons");
    await shot("water-asset-tow.jpg");
  },
  async landing(p, shot) {
    // The river landing on the bank, a real track joined to its siding, the tug and two barges at the jetty.
    if (FELT === "before") return;
    await clean(p);
    await p.evaluate(async ({ RZ }) => {
      const w = window.woodrail;
      const g = w.world.landscape.grid;
      const x = -200, z = RZ - 100;
      const y = g.groundY(g.cellAtWorld(x, z - 40));
      await window.__add("water-landing", x, z, 0, null, y);
      // Real track on into the siding from each end.
      w.editor().place("straight-144", { x: x - 84 - 144, z: z - 40, heading: 0 }, y, false);
      w.editor().place("straight-144", { x: x + 84, z: z - 40, heading: 0 }, y, false);
      await window.__add("water-river-tug", x - 120, RZ - 14, Math.PI, null);
      await window.__add("water-barge-grain", x - 28, RZ - 14, Math.PI, null);
      await window.__add("water-barge", x + 64, RZ - 14, Math.PI, null);
      window.__look(x - 10, RZ - 40, 1000, 0.8);
    }, { RZ });
    await settle(p);
    await caption(p, "River landing: a siding, a plank quay and a jetty on piles, a hand crane and a goods shed. A tug and barges tied up");
    await shot("water-asset-landing.jpg");
  },
  async ferry(p, shot) {
    // The ferry slip on the shore and the train ferry at its end, a train on deck (needs "sea" first).
    if (FELT === "before") return;
    await clean(p);
    const ok = await p.evaluate(async () => {
      if (!window.__shore) return false;
      const w = window.woodrail;
      const g = w.world.landscape.grid;
      const x = window.__shore.x + 700, zs = window.__shore.z - 40;
      await window.__add("water-ferry-slip", x, zs, Math.PI / 2, null, g.groundY(g.cellAtWorld(x, zs - 100)));
      w.editor().place("straight-144", { x, z: zs - 95 - 144, heading: Math.PI / 2 }, g.groundY(g.cellAtWorld(x, zs - 200)), false);
      const fz = zs + 55 + 60 + 162;
      await window.__add("water-train-ferry", x, fz, Math.PI / 2, null);
      await window.__train(["engine", "hopper", "caboose"], x, fz + 64, Math.PI / 2, 23);
      window.__look(x, fz - 40, 1250, 1.0, Math.PI / 2 + 0.55);
      window.__ferry = { x, fz };
      return true;
    });
    if (!ok) return;
    await settle(p);
    await caption(p, "Train ferry at its slip: track on deck for an engine and two wagons, a hinged ramp on chains, dolphins to tie up to");
    await shot("water-asset-ferry.jpg");
  },
};
