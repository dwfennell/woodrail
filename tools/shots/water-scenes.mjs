// Scenes for tools/shots/water-mock.mjs. River: the default seed's straight stretch along x at z = 756.
const RZ = 756;
const BLUE = "#2f7fc1";

/** A harbour depot (standing in for a Landing) on the river's bank at x (its yard from x to x + 216); side +1: the +z bank. */
const dock = (p, x, side) =>
  p.evaluate(({ x, side, RZ }) => {
    const w = window.woodrail;
    const g = w.world.landscape.grid;
    const pz = RZ + side * (60 + 138);
    const y = g.groundY(g.cellAtWorld(x, pz));
    const id = w.editor().place("depot-harbour", { x, z: pz, heading: side > 0 ? Math.PI : 0 }, y, false);
    const d = w.economy.depotAtPiece(id) ?? w.economy.addDepot("harbour", id);
    w.depotView.setWorld(w.economy, w.layout);
    return d.id;
  }, { x, side, RZ });

/** The HUD dressed for a mid-game railway: coins, the goal. */
const hud = (p, goal, n = "9 / 24") =>
  p.evaluate(({ goal, n }) => {
    const coins = document.querySelector(".coins");
    if (coins) coins.lastChild.textContent = "640";
    const date = document.querySelector(".game-date");
    if (date) date.textContent = "Jun 2003";
    for (const el of document.querySelectorAll(".hud *")) {
      if (el.children.length === 0 && el.textContent === "Join two towns") el.textContent = goal;
      if (el.children.length === 0 && el.textContent === "0 / 24") el.textContent = n;
    }
  }, { goal, n });

const settle = (p) => p.waitForTimeout(900);



export default {
  async landing(p, shot) {
    // Shot 1: a Landing on the river, a tug and two barges of logs tied up, the Landing's card.
    await dock(p, -528, 1);
    await p.evaluate(async ({ RZ }) => {
      await window.__tow(-560, RZ + 14, Math.PI, ["log", "log"]);
    }, { RZ });
    await p.evaluate(({ RZ }) => window.__look(-420, RZ + 40, 1500), { RZ });
    await settle(p);
    await hud(p, "Float logs down the river");
    await p.evaluate(() => {
      window.__card(`
        <div class="card-title">Mill Landing</div>
        <div class="depot-stock">On the jetty: 🪵 8 logs · 🪨 2 stone</div>
        <div class="card-row"><button class="chip text toggle active" role="switch" aria-checked="true"><span class="toggle-label">Automatic</span><span class="toggle-pill"></span></button></div>
        <div class="card-hint" style="margin:6px 0 2px">Boats here</div>
        <div class="card-row" style="flex-wrap:wrap;gap:6px">
          <button class="chip text" style="--line:${"#2f7fc1"}"><span class="route-swatch" style="background:#2f7fc1;margin-right:6px"></span>Puffin · loading</button>
          <button class="chip text primary">⛴ New barge · 80 <i class="coin-i">🪙</i></button>
        </div>`);
    });
    await shot("water-1-landing.jpg");
  },

  async route(p, shot) {
    // Shot 2: planning a boat's route: tap landings on the same water; the way is drawn on the river.
    await dock(p, -756, 1);
    await dock(p, 0, -1);
    await p.evaluate(async ({ RZ, BLUE }) => {
      await window.__tow(-470, RZ + 12, 0, ["log", "log"]);
      const pts = [];
      for (let x = -640; x <= 110; x += 36) pts.push({ x, z: RZ + (x < -500 ? 16 : x > 40 ? -16 : 0) });
      window.__ribbon(pts, BLUE, 14, 2.4);
    }, { RZ, BLUE });
    await p.evaluate(({ RZ }) => window.__look(10, RZ, 3700), { RZ });
    await settle(p);
    await hud(p, "Float logs down the river");
    await p.evaluate(({ RZ, BLUE }) => {
      window.__disc(-640, 20, RZ + 60, "1", BLUE);
      window.__disc(110, 20, RZ - 60, "2", BLUE);
      window.__tag(-640, 20, RZ + 60, "Mill Landing", 0, 20);
      window.__tag(110, 20, RZ - 60, "Foxley Quay", 0, 20);
      window.__card(`
        <div class="route-head"><span class="route-swatch" style="background:${BLUE}"></span><b>Puffin</b>&nbsp;· plan a route<button class="chip text route-plan on" style="margin-left:auto">Done</button></div>
        <div class="route-hint" style="margin:6px 0">Tap landings on this river, in order.</div>
        <div class="route-stops">
          <button class="chip text route-chip has-goods" style="--line:${BLUE}"><span class="route-num">1</span> Mill Landing<span class="route-goods">Pick up 🪵 logs</span></button>
          <button class="chip text route-chip has-goods next" style="--line:${BLUE}"><span class="route-num">2</span> Foxley Quay<span class="route-goods">Only drop</span></button>
        </div>`);
    }, { RZ, BLUE });
    await shot("water-2-plan-route.jpg");
  },

  async sailing(p, shot) {
    // Shot 3: the boat's card while it sails: tug + 3 barges, 12 loads, slow and big.
    await dock(p, 0, -1);
    await p.evaluate(async ({ RZ }) => {
      await window.__tow(-200, RZ + 4, 0, ["log", "stone", "log"]);
    }, { RZ });
    await p.evaluate(({ RZ }) => window.__look(-122, RZ, 1300), { RZ });
    await settle(p);
    await hud(p, "Float logs down the river");
    await p.evaluate(({ BLUE }) => {
      window.__card(`
        <div class="route-head"><span class="route-swatch" style="background:${BLUE}"></span><b style="font-size:1.1em">Puffin</b>&nbsp;<span class="route-none">tug and 3 barges</span></div>
        <div class="depot-stock" style="margin:6px 0">Carrying 12 of 12: 🪵 8 logs · 🪨 4 stone</div>
        <div class="route-hint">Going to Foxley Quay · slow, but carries as much as four wagons</div>
        <div class="route-stops" style="margin-top:6px">
          <button class="chip text route-chip" style="--line:${BLUE}"><span class="route-num">1</span> Mill Landing</button>
          <button class="chip text route-chip next" style="--line:${BLUE}"><span class="route-num">2</span> Foxley Quay</button>
          <button class="chip text">✎ Route</button>
        </div>
        <div class="card-row" style="margin-top:6px"><button class="chip text">+ Barge · 40 🪙</button><button class="chip text primary"><span class="go-icon">■</span> Stop</button></div>`);
    }, { BLUE });
    await shot("water-3-barges.jpg");
  },

  async sea(p, shot) {
    // Shot 4: the sea: a harbour, a cargo ship at its quay and a lighthouse on the shore.
    const info = await p.evaluate(async () => {
      const w = window.woodrail;
      const { plotsForSale } = await import("/src/game/world.ts");
      const sale = plotsForSale(w.world.landscape);
      const coast = w.world.landscape.coast;
      return { sale: sale.map((s) => [s.px, s.pz]), coast, plots: w.world.landscape.grid.plots.map((q) => [q.px, q.pz]) };
    });
    console.log(JSON.stringify(info));
    const spot = await p.evaluate(async (info) => {
      const w = window.woodrail;
      for (const [px, pz] of info.sale) if ((info.coast.side === "s" && pz === info.coast.plot) || (info.coast.side === "n" && pz === -info.coast.plot) || (info.coast.side === "e" && px === info.coast.plot) || (info.coast.side === "w" && px === -info.coast.plot)) try { w.unlockPlot(px, pz); } catch (e) { console.log(e.message); }
      await new Promise((r) => setTimeout(r, 3000));
      const g = w.world.landscape.grid;
      // A shore square: land with sea just beyond, near the middle.
      let best = null;
      for (let i = 0; i < g.cellCount; i++) {
        if (g.surface[i] !== 5) continue;
        const c = g.colOf(i), r = g.rowOf(i);
        const up = g.index(c, r - 1);
        if (up === -1 || g.surface[up] === 5) continue;
        const ok = [-2, -1, 0, 1, 2, 3].every((dc) => { const j = g.index(c + dc, r - 1); const k = g.index(c + dc, r - 2); const s = g.index(c + dc, r + 2); return j !== -1 && k !== -1 && s !== -1 && g.surface[j] !== 5 && g.surface[j] !== 1 && g.surface[k] !== 1 && g.surface[s] === 5; });
        if (!ok) continue;
        const x = g.centreX(c), z = g.centreZ(r);
        if (!best || Math.abs(x) < Math.abs(best.x)) best = { x, z };
      }
      return best;
    }, info);
    console.log("shore", JSON.stringify(spot));
    if (!spot) return;
    await p.evaluate(async ({ x, z }) => {
      const w = window.woodrail;
      const g = w.world.landscape.grid;
      const pz = z - 36 - 138;
      const y = g.groundY(g.cellAtWorld(x, pz));
      const id = w.editor().place("depot-harbour", { x: x - 108, z: pz, heading: 0 }, y, false);
      w.economy.depotAtPiece(id) ?? w.economy.addDepot("harbour", id);
      w.depotView.setWorld(w.economy, w.layout);
      await window.__add("veh-cargo-ship", x + 20, z + 60, 0, 300);
      const ly = g.groundY(g.cellAtWorld(x - 330, z - 90));
      await window.__add("bldg-lighthouse", x - 330, z - 70, 0, 80, ly);
      await window.__add("veh-sailing-boat", x - 200, z + 300, 0.6, 70);
      window.__look(x + 150, z - 20, 2000);
      window.__shore = { x, z };
    }, spot);
    await settle(p);
    await hud(p, "Send a ship abroad");
    await p.evaluate(() => {
      const { x, z } = window.__shore;
      window.__tag(x - 330, 0, z - 70, "Lighthouse: ships call twice as often", 40, 24);
      window.__card(`
        <div class="card-title">Bay Harbour</div>
        <div class="depot-stock">On the quay: 🪵 14 planks · ⛓️ 6 iron · 🧱 4 bricks</div>
        <div class="card-row"><button class="chip text toggle active" role="switch" aria-checked="true"><span class="toggle-label">Automatic</span><span class="toggle-pill"></span></button></div>
        <div class="card-hint" style="margin:6px 0">🚢 Cargo ship in, loading: takes 24 loads, and pays a town's full price for them. Next ship in 1:15.</div>
        <div class="card-row"><button class="chip text">Order from abroad…</button></div>`);
    });
    await shot("water-4-sea.jpg");
  },

  async ferry(p, shot) {
    // Shot 5: the train ferry (after "sea": the coast is bought): a slip out on a pier, the ferry steaming off to sea
    // with a train on its deck, to come back with goods from abroad.
    const ok = await p.evaluate(async () => {
      if (!window.__shore) return false;
      const w = window.woodrail;
      const g = w.world.landscape.grid;
      const x = window.__shore.x + 760, z = window.__shore.z;
      // The slip: track from the land out along a pier to a buffer over the sea.
      const y0 = g.groundY(g.cellAtWorld(x, z - 300));
      w.editor().place("straight-216", { x, z: z - 330, heading: Math.PI / 2 }, y0, false);
      w.editor().place("straight-216", { x, z: z - 114, heading: Math.PI / 2 }, 14, false);
      window.__box(x, 0, z - 6, 70, 14, 230, 0xc9a26b);
      for (const k of [-90, -30, 30, 90]) for (const s of [-30, 30]) window.__cyl(x + s, 5, z - 6 + k, 5, 14, 0x7a5a38);
      // The ferry, out at sea, a train on its deck.
      const fx = x + 30, fz = z + 340;
      window.__box(fx, 0.2, fz, 84, 16, 250, 0xd8442f);
      window.__box(fx, 16, fz, 84, 3, 250, 0xf3ede0);
      window.__box(fx + 36, 19, fz + 40, 14, 34, 60, 0xf3ede0);
      window.__box(fx + 36, 53, fz + 40, 16, 4, 64, 0x2c5d8a);
      window.__cyl(fx + 36, 62, fz + 70, 6, 18, 0x2c2c2c);
      w.editor().place("straight-216", { x: fx - 8, z: fz - 108, heading: Math.PI / 2 }, 19, false);
      await window.__train(["engine", "timber", "hopper"], fx - 8, fz + 85, Math.PI / 2, 19 + 8);
      window.__look(x + 20, z + 60, 1900, 0.8, Math.PI / 2);
      window.__ferry = { x, z, fx, fz };
      return true;
    });
    if (!ok) return;
    await settle(p);
    await p.waitForTimeout(1500);
    await hud(p, "Send a train abroad");
    await p.evaluate(() => {
      const { x, z, fx, fz } = window.__ferry;
      window.__tag(x, 20, z - 60, "Ferry slip", 70, -10);
      window.__card(`
        <div class="route-head"><span class="route-swatch" style="background:#c8442f"></span><b style="font-size:1.1em">Bluebell</b>&nbsp;<span class="route-none">on the ferry</span></div>
        <div class="depot-stock" style="margin:6px 0">Gone abroad with 🪵 6 planks · 🧱 3 bricks: back in 2:40 with goods from abroad</div>
        <div class="route-stops" style="margin-top:6px">
          <button class="chip text route-chip" style="--line:#c8442f"><span class="route-num">1</span> Foxley</button>
          <button class="chip text route-chip next" style="--line:#c8442f"><span class="route-num">2</span> ⛴ Abroad</button>
        </div>`);
    });
    await shot("water-5-ferry.jpg");
  },
};
