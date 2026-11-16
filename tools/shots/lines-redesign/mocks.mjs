// The three directions for the lines UI (docs/agents/lines-ui-proposals.md), as mocks over the running game:
// SCENES=mocks.mjs node tools/shots/lines-redesign/stage.mjs [<out>] [<scene,…>]. The staged Red line: Forest yard 2,
// Forest yard 3, Sawmill 2 (waits to fill), Workshop (drop only), two trains; Blue and Yellow lines beside it.
import { tapSel, clearToasts, look } from "./scenes.mjs";

const STOPS = [
  { name: "Forest yard", num: "2", up: "🪵 logs" },
  { name: "Forest yard", num: "3", up: "🪵 logs" },
  { name: "Sawmill", num: "2", down: "🪵 logs", up: "🗄 planks", wait: true },
  { name: "Workshop", down: "🗄 planks", only: "drop only" },
];

/** The game as it stands: the Red line's trains (names, where on the line), its stops' places on the screen. */
async function facts(p, s) {
  return p.evaluate(async (s) => {
    const w = window.woodrail;
    const { lineLegs, pointOnPath, runsLength } = await import("/src/game/route-path.ts");
    const line = w.economy.lines.get(s.red);
    const engines = [...w.economy.lineIdOf].filter(([, id]) => id === s.red).map(([e]) => e);
    const trains = engines.map((e) => ({ name: w.sim.nameOf(e), next: w.economy.routeOf(e)?.next ?? 0 }));
    const proj = (pt, up = 0) => {
      const c = new w.camera.position.constructor(pt.x, pt.y + up, pt.z).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
    };
    const pieces = line.stops.map((st) => w.economy.depot(st.depotId).pieceId);
    const len = (id) => { const q = w.layout.getPiece(id); return q ? 216 : 0; };
    const pins = pieces.map((id) => proj(pointOnPath(w.layout, id, 0, len(id) / 2), 70));
    const legs = lineLegs(w.layout, pieces);
    const mids = legs.map((leg) => {
      if (!leg) return null;
      let half = runsLength(leg) / 2;
      for (const r of leg) {
        const l = Math.abs(r.s1 - r.s0);
        if (half <= l) return proj(pointOnPath(w.layout, r.pieceId, r.pathIndex, r.s0 + Math.sign(r.s1 - r.s0) * half), 10);
        half -= l;
      }
      return null;
    });
    return { trains, pins, mids, colour: line.colour, vw: innerWidth };
  }, s);
}

async function planning(p, s) {
  await p.evaluate(() => { document.querySelectorAll(".mk-inj").forEach((e) => e.remove()); document.body.classList.remove("mk-hide", "mk-hide-tray"); });
  if (await p.evaluate(() => !!document.querySelector(".line-sheet:not([hidden]) .ls-done"))) await tapSel(p, ".ls-done");
  await p.keyboard.press("Escape");
  await look(p, s);
  await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), s.engines[0]);
  await p.waitForTimeout(1200);
  await tapSel(p, ".engine-extra .route-plan");
  await p.waitForTimeout(1800);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
  await clearToasts(p);
}

async function inject(p, ctx, html, body = ["mk-hide"]) {
  await p.evaluate(({ css, html, body, line }) => {
    document.querySelectorAll(".mk-inj").forEach((e) => e.remove());
    if (!document.getElementById("mk-css")) document.head.insertAdjacentHTML("beforeend", `<style id="mk-css">${css}</style>`);
    document.body.classList.remove("mk-hide", "mk-hide-tray");
    document.body.classList.add(...body);
    const box = document.createElement("div");
    box.className = "mk-inj";
    box.style.setProperty("--line", line);
    box.innerHTML = html;
    document.body.append(box);
  }, { css: ctx.css("mock.css"), html, body, line: "#e0533d" });
}

const goods = (st) => `<div class="mk-goods">${st.down ? `<span class="d">⬇ ${st.down}</span>` : ""}${st.up ? `<span class="u">⬆ ${st.up}</span>` : ""}</div>`;
const sname = (st) => `<div class="mk-sname">${st.name}${st.num ? ` <em>${st.num}</em>` : ""}${st.only ? `<span class="mk-tag">${st.only}</span>` : ""}${st.wait ? `<span class="mk-tag">⏳ fills up</span>` : ""}</div>`;
const head = (status = `<span class="mk-stamp go"><i></i>Moving</span>`) => `<div class="mk-head"><div class="mk-disc"></div><div class="mk-name">Red line</div>${status}<button class="mk-chip" aria-label="More">⋯</button><button class="mk-done">Done</button></div>`;
const pegs = (st) => `<div class="mk-pegs"><span class="mk-peg${st.down ? " on" : ""}"><i></i>Drop</span><span class="mk-peg${st.up ? " on" : ""}"><i></i>Pick up</span><span class="mk-peg${st.wait ? " on gold" : ""}"><i></i>Wait to fill</span></div>`;

/** The card's line box, read only (all three directions). */
function card(f) {
  const t = f.trains[0];
  return `<div class="mk mk-board mk-card">
    <div class="mk-card-title">${t.name} ✎</div>
    <div class="mk-card-row"><span class="grow">2 cars · steady · 🪵 6</span><span class="mk-chip">⋯</span></div>
    <div class="mk-card-row"><div class="mk-stopbtn">■ Stop</div><span class="mk-chip" style="width:64px;height:56px">←</span></div>
    <div class="mk-linebox">
      <div class="ln"><i></i>Red line <span class="mk-stamp wait"><i></i>Waiting</span></div>
      <span class="mk-chip">Edit line</span>
      <div class="mk-mini"><b>1</b><b>2</b><b class="next">3</b><b>4</b><span class="eng" style="left:47%">🚂</span></div>
      <div class="where">Going to <b>Sawmill 2</b> · the Blue line's train is in the way <u>Show</u></div>
    </div>
  </div>`;
}

export default [
  {
    name: "all-card",
    async run(p, s, ctx) {
      await look(p, s);
      await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), s.engines[0]);
      await p.waitForTimeout(1200);
      await clearToasts(p);
      await inject(p, ctx, card(await facts(p, s)));
    },
  },
  // ---- A. A tidier board: the list, one editor, stops open small, + grows into a slot ----------------------------
  {
    name: "A-1-open-stop",
    async run(p, s, ctx) {
      await planning(p, s);
      const rows = STOPS.map((st, k) => k === 2
        ? `<li class="mk-stop open next"><span class="mk-num">${k + 1}</span><div>${sname(st)}${goods(st)}</div><span class="mk-grip">⠿</span>
            <div class="mk-open"><div class="mk-says">Drops 🪵 logs from Forest yard 3<br>Picks up 🗄 planks for Workshop</div>${pegs(st)}
            <div class="mk-acts"><span class="mk-note">Untick Drop and Pick up: it passes by</span><span class="mk-remove">Remove stop</span></div></div></li>`
        : `<li class="mk-stop"><span class="mk-num">${k + 1}</span><div>${sname(st)}${goods(st)}</div><span class="mk-grip">⠿</span></li>${k < 3 ? `<li class="mk-plus"><b>+</b></li>` : ""}`).join("");
      await inject(p, ctx, `<div class="mk mk-board mk-sheet dock">${head()}
        <div class="mk-tabs"><div class="mk-tab on">Stops · 4</div><div class="mk-tab">Trains · 2 <span class="dot"></span></div></div>
        <div class="mk-body"><ol class="mk-spine">${rows}</ol></div>
        <div class="mk-foot"><span>Tap a place to add it where it fits, or + to choose</span><span class="mk-chip">Pass by…</span></div></div>`);
    },
  },
  {
    name: "A-2-slot",
    async run(p, s, ctx) {
      const rows = STOPS.map((st, k) => `<li class="mk-stop${k === 2 ? " next" : ""}"><span class="mk-num">${k + 1}</span><div>${sname(st)}${goods(st)}</div><span class="mk-grip">⠿</span></li>${k === 1 ? `<li class="mk-slot"><b>+</b><span>Tap a place on the map: it goes here</span></li>` : k < 3 ? `<li class="mk-plus"><b>+</b></li>` : ""}`).join("");
      await inject(p, ctx, `<div class="mk mk-board mk-sheet dock">${head()}
        <div class="mk-tabs"><div class="mk-tab on">Stops · 4</div><div class="mk-tab">Trains · 2 <span class="dot"></span></div></div>
        <div class="mk-body"><ol class="mk-spine">${rows}</ol></div>
        <div class="mk-foot"><span>Between Forest yard 3 and Sawmill 2</span><span class="mk-chip">Cancel</span></div></div>`);
    },
  },
  // ---- B. The map is the editor: a slim bar, + on the ribbon, a stop's tile by its pin ---------------------------
  {
    name: "B-1-map",
    async run(p, s, ctx) {
      await planning(p, s);
      const strip = (picked, armed) => `<div class="mk-strip">${STOPS.map((st, k) => `<div class="st${k === 2 ? " next" : ""}${k === picked ? " picked" : ""}"><b>${k + 1}</b>${st.name}${st.num ? ` ${st.num}` : ""}</div>${k < 3 ? `<span class="pl${k === armed ? " on" : ""}">+</span>` : ""}`).join("")}</div>`;
      // (The bar first, so the map's pins are measured with it in place.)
      await inject(p, ctx, `<div class="mk mk-board mk-bar">${head(`<span class="mk-chip">🚂 2 ›</span>`)}${strip(2, -1)}</div>`, ["mk-hide", "mk-hide-tray"]);
      await p.waitForTimeout(1500);
      const f = await facts(p, s);
      const plus = f.mids.map((m) => (m ? `<div class="mk-mapplus" style="left:${m.x}px;top:${m.y}px">+</div>` : "")).join("");
      const pin = f.pins[2];
      const st = STOPS[2];
      const left = Math.max(8, Math.min(pin.x - 136, f.vw - 280));
      // (Below its pin when the pin is high on the screen, else above it.)
      const below = pin.y < 520;
      const pop = `<div class="mk-pop${below ? " below" : ""}" style="left:${left}px;top:${below ? pin.y + 38 : pin.y - 262}px;--tail:${pin.x - left}px">${sname(st)}${goods(st)}${pegs(st)}<div class="mk-acts"><span class="mk-chip">⠿ Move</span><span class="mk-remove">Remove stop</span></div></div>`;
      await inject(p, ctx, `${plus}${pop}<div class="mk mk-board mk-bar">${head(`<span class="mk-chip">🚂 2 ›</span>`)}${strip(2, -1)}</div>`, ["mk-hide", "mk-hide-tray"]);
    },
  },
  {
    name: "B-2-armed",
    async run(p, s, ctx) {
      const f = await facts(p, s);
      const strip = `<div class="mk-strip">${STOPS.map((st, k) => `<div class="st${k === 2 ? " next" : ""}"><b>${k + 1}</b>${st.name}${st.num ? ` ${st.num}` : ""}</div>${k < 3 ? `<span class="pl${k === 1 ? " on" : ""}">+</span>` : ""}`).join("")}</div>`;
      const plus = f.mids.map((m, k) => (m ? `<div class="mk-mapplus${k === 1 ? " on" : ""}" style="left:${m.x}px;top:${m.y}px">+</div>` : "")).join("");
      const m = f.mids[1];
      const tag = m ? `<div class="mk-hinttag" style="left:${Math.min(Math.max(m.x, 170), f.vw - 170)}px;top:${m.y + 30}px">Now tap a place: it goes here</div>` : "";
      await inject(p, ctx, `${plus}${tag}<div class="mk mk-board mk-bar">${head(`<span class="mk-chip">🚂 2 ›</span>`)}${strip}<div class="mk-foot"><span>Between Forest yard 3 and Sawmill 2</span><span class="mk-chip">Cancel</span></div></div>`, ["mk-hide", "mk-hide-tray"]);
    },
  },
  // ---- C. One diagram with its trains on it: no tabs; engines ride the spine; problems where they are ------------
  {
    name: "C-1-diagram",
    async run(p, s, ctx) {
      await planning(p, s);
      const f = await facts(p, s);
      // (Each train drawn before the stop it's heading for.)
      const before = (k) => f.trains.map((t, i) => (t.next % 4 === k ? i : -1)).filter((i) => i !== -1);
      const train = (i) => i === 0
        ? `<li class="mk-train stuck"><span class="tk">🚂</span><div class="tx"><b>${f.trains[i].name}</b><span class="why">Waiting: the Blue line's train is in the way</span><span class="mk-chip">Show</span></div></li>`
        : `<li class="mk-train"><span class="tk">🚂</span><div class="tx"><b>${f.trains[i].name}</b><span class="mk-stamp go"><i></i>Moving</span><span class="why">🪵 4</span></div></li>`;
      const rows = STOPS.map((st, k) => `${before(k).map(train).join("") || (k > 0 ? `<li class="mk-plus"><b>+</b></li>` : "")}<li class="mk-stop${k === 2 ? " next" : ""}"><span class="mk-num">${k + 1}</span><div>${sname(st)}${goods(st)}</div><span class="mk-grip">⠿</span></li>`).join("");
      await inject(p, ctx, `<div class="mk mk-board mk-sheet dock">${head(`<span class="mk-stamp wait"><i></i>1 waiting</span>`)}
        <div class="mk-body" style="max-height:470px"><ol class="mk-spine">${rows}<li class="mk-plus"><b>+</b></li></ol>
        <div class="mk-addtrain"><span class="mk-chip">+ Add a train</span><span class="mk-note">2 free trains can reach it</span></div></div>
        <div class="mk-foot"><span>Carries 🪵 logs and 🗄 planks · 6 loads a month</span><span class="mk-chip">Pass by…</span></div></div>`);
    },
  },
];
