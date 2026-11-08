import { readFileSync } from "node:fs";
import { openCard, tapSel, look, clearToasts } from "./scenes.mjs";
const CSS = readFileSync(new URL("./mock.css", import.meta.url), "utf8");
const PL = "", LOG = "🪵";
const RED = "#e0533d", BLUE = "#2f6db5", GREEN = "#3c9a5f", YEL = "#e6b52c";
async function css(p) { await p.addStyleTag({ content: CSS }); }
async function reset(p) {
  await p.evaluate(() => { const g = document.querySelector(".goals-panel, .goals"); const x = [...document.querySelectorAll(".goals-tabs button")].find((b) => !b.classList.contains("goals-tab")); if (x && x.offsetParent) x.click(); });
  await p.evaluate(() => { document.querySelectorAll(".mk-inj").forEach((e) => e.remove()); document.querySelectorAll(".mk-hide").forEach((e) => e.classList.remove("mk-hide")); });
  await p.evaluate(() => [...document.querySelectorAll(".lines-view .chip")].find((b) => b.textContent === "Done" && b.offsetParent)?.click());
  await p.keyboard.press("Escape"); await p.waitForTimeout(300); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
}
async function lookOval(p, dist, dz) {
  for (let k = 0; k < 2; k++) {
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
  await p.evaluate(([dist, dz]) => {
    const w = window.woodrail;
    const ps = window.__mock.places.map((d) => w.layout.getPiece(w.economy.depot(d).pieceId).pose);
    const x = ps.reduce((a, q) => a + q.x, 0) / ps.length, z = ps.reduce((a, q) => a + q.z, 0) / ps.length;
    w.director.glideTo(new w.controls.target.constructor(x + dz, 0, z), dist, { duration: 0.1 });
  }, [dist, dz]);
  await p.waitForTimeout(800);
  }
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
}
async function editStop(p, s, k) {
  await openCard(p, s.engines[0]);
  await p.waitForTimeout(800);
  await tapSel(p, ".engine-extra .route-plan");
  await p.waitForFunction(() => document.querySelector(".engine-extra .route-plan.on"), null, { timeout: 10000 }).catch(() => console.log("no planning"));
  await tapSel(p, `.route-chip[data-stop='${k}']`);
  await clearToasts(p);
}
async function openLinesView(p) {
  await p.evaluate(() => document.querySelector('button[aria-label="Menu"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => [...document.querySelectorAll(".menu button")].find((b) => b.textContent === "Lines")?.click());
  await p.waitForTimeout(1500);
}
const goals = `<span class="mk-good">${LOG} logs</span>`;
const lineRow = (c, name, stops, trains, carries, pill, extra) => `
  <div class="mk-line" style="--line:${c}"><i class="bar"></i>
    <div class="name">${name}</div><span class="chev">›</span>
    <div class="stops">${stops}</div>
    <div class="meta"><span>🚂 ${trains}</span><span>${carries}</span>${pill}${extra ? `<span class="mk-muted">${extra}</span>` : ""}</div>
  </div>`;
const LINES_A = `
  <div class="mk-lines mk-inj">
    <div class="mk-lines-top"><span class="mk-muted">4 lines · 4 trains</span><button class="chip text">+ New line</button></div>
    ${lineRow(RED, "Red line", "Forest yard 2 → Sawmill 2 → Workshop", 2, `${LOG}${PL}`, `<span class="mk-pill go"><i></i>Moving</span>`, "18 loads/mo")}
    ${lineRow(BLUE, "Blue line", "Sawmill 2 → Workshop", 1, `${PL}`, `<span class="mk-pill wait"><i></i>Waiting to fill</span>`, "6 loads/mo")}
    ${lineRow(YEL, "Town shuttle", "Larkfield ⇄ Elderwick", 1, `🧑`, `<span class="mk-pill stuck"><i></i>Stuck at points</span>`, "")}
    ${lineRow(GREEN, "Green line", "Workshop → Larkfield", 0, `${PL}`, `<span class="mk-pill none"><i></i>No trains</span>`, "")}
  </div>`;
const strip = (c, stops, picked = -1) => `<div class="mk-strip">${stops.map(([n, g], i) => `<button class="chip text route-chip ${i === picked ? "picked" : ""}" style="--line:${c}"><span class="route-num">${i + 1}</span>${n}<small>${g}</small></button>`).join("")}</div>`;
const RED_STOPS = [["Forest yard 2", `⬆${LOG}`], ["Sawmill 2", `⬆${PL} ⬇${LOG}`], ["Workshop", `⬇${PL}`]];

export default [
  {
    name: "A1-stop",
    async run(p, s) {
      await css(p);
      await editStop(p, s, 1);
      await p.evaluate(({ PL, LOG }) => {
        const box = document.querySelector(".engine-extra");
        box.querySelectorAll(".route-modes, .route-tools, .route-hint").forEach((e) => e.classList.add("mk-hide"));
        const chip = box.querySelector(".route-chip.picked").getBoundingClientRect();
        const b = box.getBoundingClientRect();
        const el = document.createElement("div");
        el.className = "mk-a-stop mk-inj";
        el.style.setProperty("--line", "#e0533d");
        el.style.setProperty("--tip", `${chip.left + chip.width / 2 - b.left - 8}px`);
        el.innerHTML = `
          <div class="mk-a-head"><span class="mk-num">2</span><b>Sawmill 2</b><span class="mk-sp"></span>
            <button class="chip mk-ico" aria-label="Earlier">←</button><button class="chip mk-ico" aria-label="Later">→</button><button class="chip mk-ico" aria-label="Take off the line">✕</button></div>
          <div class="mk-a-goods">
            <div class="down"><span class="arr">⬇</span>Drops <span class="mk-good">${LOG} logs</span><span class="to">from Forest yard 2</span></div>
            <div class="up"><span class="arr">⬆</span>Picks up <span class="mk-good">${PL} planks</span><span class="to">for Workshop</span></div>
          </div>
          <div class="mk-seg" role="radiogroup" aria-label="What the train does here"><button class="on">Drop &amp; pick up</button><button>Drop only</button><button>Pick up only</button></div>
          <div class="mk-a-row"><button class="chip text toggle active">⏳ Wait for a full load<span class="toggle-pill"></span></button><button class="chip text mk-quiet">Pass by</button></div>`;
        box.append(el);
      }, { PL, LOG });
    },
  },
  {
    name: "A2-journal-lines",
    async run(p) {
      await reset(p);
      await css(p);
      await p.evaluate(() => document.querySelector(".goals-head").click());
      await p.waitForTimeout(800);
      await clearToasts(p);
      await p.evaluate((html) => {
        const tabs = document.querySelector(".goals-tabs");
        const t = [...tabs.querySelectorAll(".goals-tab")];
        t.forEach((b) => b.classList.remove("on"));
        const lines = t[0].cloneNode(false);
        lines.classList.add("on", "mk-inj");
        lines.textContent = "Lines";
        t.at(-1).after(lines);
        document.querySelectorAll(".goals-body > :not(.goals-tabs)").forEach((e) => e.classList.add("mk-hide"));
        document.querySelector(".goals-body").insertAdjacentHTML("beforeend", html);
      }, LINES_A);
    },
  },
  {
    name: "A3-line-card",
    async run(p, s) {
      await reset(p);
      await css(p);
      await openLinesView(p);
      await lookOval(p, 2400, 330);
      await clearToasts(p);
      await p.evaluate((html) => { document.querySelector(".lines-view").classList.add("mk-hide"); document.body.insertAdjacentHTML("beforeend", html); }, `
        <div class="mk-card mk-inj" style="--line:${RED}">
          <div class="mk-card-head"><i class="sw"></i><b>Red line</b><span class="ed">✎</span><span class="mk-sp"></span><span class="mk-pill go"><i></i>Moving</span><button class="chip text">Done</button></div>
          ${strip(RED, RED_STOPS)}
          <div class="mk-row"><button class="chip text">Edit stops</button><button class="chip text">Show on map</button></div>
          <div class="mk-h">Trains on this line · 2</div>
          <div class="mk-trains">
            <div class="mk-train">🚂 Willow<span class="st">Loading at Forest yard 2</span><button class="chip" aria-label="Take off the line">✕</button></div>
            <div class="mk-train">🚂 Bramble<span class="st">On its way to Workshop</span><button class="chip" aria-label="Take off the line">✕</button></div>
          </div>
          <button class="chip text">+ Add a train</button>
          <div class="mk-a-foot">Carries ${LOG} logs and ${PL} planks · 18 loads a month</div>
        </div>`);
    },
  },
  {
    name: "A4-new-line",
    async run(p, s) {
      await reset(p);
      await css(p);
      await lookOval(p, 2400, 280);
      await clearToasts(p);
      await p.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), `
        <div class="mk-card mk-inj" style="--line:${GREEN}">
          <div class="mk-card-head"><i class="sw"></i><b>Green line</b><span class="ed">✎</span><span class="mk-sp"></span><button class="chip text primary">Done</button></div>
          ${strip(GREEN, [["Sawmill 2", `⬆${PL}`], ["Workshop", `⬇${PL}`]])}
          <div class="mk-a-foot" style="text-align:left">Tap more places to add stops</div>
          <div class="mk-empty">No train runs this line yet</div>
          <button class="chip text">+ Add a train</button>
        </div>`);
    },
  },
  {
    name: "B1-line-sheet-stop",
    async run(p, s) {
      await reset(p);
      await css(p);
      await editStop(p, s, 1);
      await lookOval(p, 2600, 480);
      await p.evaluate(() => document.querySelector(".engine-card").classList.add("mk-hide"));
      await p.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), `
        <div class="mk-sheet mk-inj" style="--line:${RED}">
          <i class="mk-grab"></i>
          <div class="mk-sheet-head"><i class="sw"></i><b>Red line</b><span class="ed mk-muted">✎</span><span class="mk-sp"></span><button class="chip text primary">Done</button></div>
          <div class="mk-tabs2"><button class="on">Stops · 3</button><button>Trains · 2</button></div>
          <div class="mk-tl">
            <div class="mk-stoprow"><span class="drag">⠿</span><span class="mk-num">1</span><div><div class="nm">Forest yard 2</div><div class="gd"><span class="u">⬆ ${LOG} logs</span></div></div><span></span></div>
            <div class="mk-stoprow open"><span class="drag">⠿</span><span class="mk-num">2</span><div><div class="nm">Sawmill 2</div><div class="gd"><span class="d">⬇ ${LOG} logs</span><span class="u">⬆ ${PL} planks</span></div></div><button class="chip mk-ico" aria-label="Take off the line">✕</button>
              <div class="opts">
                <button class="chip text mk-on"><span class="ck">✓</span>Drop</button><button class="chip text mk-on"><span class="ck">✓</span>Pick up</button><button class="chip text mk-on"><span class="ck">✓</span>Wait to fill</button>
                <div class="why">Untick both and the train goes by without stopping</div>
              </div></div>
            <div class="mk-stoprow"><span class="drag">⠿</span><span class="mk-num">3</span><div><div class="nm">Workshop<span class="tag">drop only</span></div><div class="gd"><span class="d">⬇ ${PL} planks</span></div></div><span></span></div>
          </div>
          <div class="mk-addrow"><button class="chip text">+ Stop</button><button class="chip text">+ Go by…</button></div>
        </div>`);
    },
  },
  {
    name: "B2-map-lines",
    async run(p, s) {
      await reset(p);
      await css(p);
      await openLinesView(p);
      await lookOval(p, 4200, 1400);
      await clearToasts(p);
      const ml = (c, name, stops, trains, carries, pill, extra) => `<div class="mk-mapline" style="--line:${c}"><div class="t"><i></i>${name}</div><span class="chev mk-muted" style="font-size:22px;font-weight:900">›</span>
        <div class="mk-diag">${stops.map((n) => `<span>${n}</span>`).join("")}</div>
        <div class="meta"><span>🚂 ${trains}</span><span>${carries}</span>${pill}${extra ? `<span class="mk-muted">${extra}</span>` : ""}</div></div>`;
      await p.evaluate((html) => { document.querySelector(".lines-view").classList.add("mk-hide"); document.body.insertAdjacentHTML("beforeend", html); }, `
        <div class="mk-sheet mk-inj">
          <i class="mk-grab"></i>
          <div class="mk-sheet-head"><b>Lines</b><span class="mk-muted" style="font-size:13.5px">4 lines · 4 trains</span><span class="mk-sp"></span><button class="chip text">+ New</button><button class="chip text">Back</button></div>
          ${ml(RED, "Red line", ["Forest yard 2", "Sawmill 2", "Workshop"], 2, `${LOG}${PL}`, `<span class="mk-pill go"><i></i>Moving</span>`, "18 loads/mo")}
          ${ml(BLUE, "Blue line", ["Sawmill 2", "Workshop"], 1, PL, `<span class="mk-pill wait"><i></i>Waiting to fill</span>`, "6 loads/mo")}
          ${ml(YEL, "Town shuttle", ["Larkfield", "Elderwick"], 1, "🧑", `<span class="mk-pill stuck"><i></i>Stuck at points</span>`, "")}
          ${ml(GREEN, "Green line", ["Workshop", "Larkfield"], 0, PL, `<span class="mk-pill none"><i></i>No trains</span>`, "")}
        </div>`);
    },
  },
  {
    name: "B3-line-sheet-trains",
    async run(p, s) {
      await reset(p);
      await css(p);
      await openLinesView(p);
      await lookOval(p, 2900, 850);
      await clearToasts(p);
      await p.evaluate((html) => { document.querySelector(".lines-view").classList.add("mk-hide"); document.body.insertAdjacentHTML("beforeend", html); }, `
        <div class="mk-sheet mk-inj" style="--line:${RED}">
          <i class="mk-grab"></i>
          <div class="mk-sheet-head"><i class="sw"></i><b>Red line</b><span class="ed mk-muted">✎</span><span class="mk-sp"></span><span class="mk-pill go"><i></i>Moving</span><button class="chip text">Done</button></div>
          <div class="mk-tabs2"><button>Stops · 3</button><button class="on">Trains · 2</button></div>
          <div class="mk-trains">
            <div class="mk-train">🚂 Willow<span class="st">Loading at Forest yard 2</span><button class="chip" aria-label="Show">◎</button><button class="chip" aria-label="Take off the line">✕</button></div>
            <div class="mk-train">🚂 Bramble<span class="st">On its way to Workshop</span><button class="chip" aria-label="Show">◎</button><button class="chip" aria-label="Take off the line">✕</button></div>
          </div>
          <div class="mk-h">Add a train</div>
          <div class="mk-trainchips"><button class="chip text">🚂 Hazel · free, near Sawmill</button><button class="chip text">＋ A new train</button></div>
          <div class="mk-a-foot">Carries ${LOG} logs and ${PL} planks · 18 loads a month · 210 🪙</div>
          <div class="mk-row"><button class="chip text">Show on map</button><button class="chip text">Copy</button><button class="chip text">Reverse</button></div>
        </div>`);
    },
  },
  {
    name: "B4-new-line",
    async run(p, s) {
      await reset(p);
      await css(p);
      await lookOval(p, 2600, 380);
      await clearToasts(p);
      await p.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), `
        <div class="mk-sheet mk-inj" style="--line:${GREEN}">
          <i class="mk-grab"></i>
          <div class="mk-sheet-head"><i class="sw"></i><b>New line</b><span class="ed mk-muted">✎</span><span class="mk-sp"></span><button class="chip text primary">Done</button></div>
          <div class="mk-tabs2"><button class="on">Stops · 2</button><button>Trains · 0</button></div>
          <div class="mk-tl">
            <div class="mk-stoprow"><span class="drag">⠿</span><span class="mk-num">1</span><div><div class="nm">Sawmill 2</div><div class="gd"><span class="u">⬆ ${PL} planks</span></div></div><span></span></div>
            <div class="mk-stoprow"><span class="drag">⠿</span><span class="mk-num hollow">2</span><div><div class="nm">Workshop</div><div class="gd"><span class="d">⬇ ${PL} planks</span></div></div><span></span></div>
          </div>
          <div class="mk-empty">Tap places on the map to add stops, in order</div>
          <button class="chip text">Next: add a train ›</button>
        </div>`);
    },
  },
];
