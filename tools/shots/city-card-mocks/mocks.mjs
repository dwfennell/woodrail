// The city card's three directions, and the Journal's fixed flow, as HTML over the game (stage.mjs shoots them).
import { readFileSync } from "node:fs";
import { closeAll, clearToasts, lookTown, openTownCard, openJournalAch } from "./helpers.mjs";

const CSS = readFileSync(new URL("./mock.css", import.meta.url), "utf8");
const PL = "";
const RED = "#e0533d";
const BLUE = "#2f6db5";

async function css(p) {
  await p.addStyleTag({ content: CSS });
}

/** Open the real card, hide it, and put the mock board where it stood (or at `at`). */
async function inject(p, s, html, at) {
  await closeAll(p);
  await css(p);
  await lookTown(p, s.town);
  await openTownCard(p, s.town);
  await clearToasts(p);
  await p.evaluate(
    ([html, at]) => {
      const card = document.querySelector(".depot-card");
      const r = card.getBoundingClientRect();
      card.classList.add("mk-hide");
      const box = document.createElement("div");
      box.className = `mk-inj ${at?.board ? "mk-board" : "mk-card"}`;
      const pos = at ?? { left: r.left, top: r.top, width: r.width, height: r.height };
      Object.assign(box.style, { left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width}px`, height: `${pos.height}px` });
      box.innerHTML = html;
      document.body.append(box);
    },
    [html, at ?? null],
  );
}

/** A label for the proposal's reader at (x, y). */
export const label = (p, x, y, text) => p.evaluate(([x, y, text]) => {
  const l = document.createElement("div");
  l.className = "mk-label mk-inj";
  Object.assign(l.style, { left: `${x}px`, top: `${y}px` });
  l.textContent = text;
  document.body.append(l);
}, [x, y, text]);

// ---- the parts ----------------------------------------------------------------------------------------------------

const title = `<div class="mk-title"><b>Larkfield</b><span class="mk-x">✕</span></div>`;
const level = `<div class="mk-level"><span class="mk-stamp green">City ★</span><span class="to">29 of 82 goods to grow</span><span class="stars">★ → ★★</span><div class="mk-bar bar"><i style="width:35%"></i></div></div>`;
const next = (t, sub, btn, cls = "go") => `<div class="mk-next"><div class="mk-next-k"><i class="mk-peg"></i>Next up</div><div class="mk-next-t">${t}<small>${sub}</small></div><span class="mk-btn ${cls} wide">${btn}</span></div>`;
const NEXT_GRAND = next("Larkfield can build a grand project", "Big builds for a City ★ that pay off for every town", "🏛️ Pick a grand project ›");
const good = (ic, name, n, of, cls = "") => `<div class="mk-good ${cls}"><span>${ic} ${name}</span><span></span><span class="n">${n}/${of}</span><div class="mk-bar thin"><i style="width:${Math.round((100 * n) / of)}%"></i></div></div>`;
const GOODS = `<div class="mk-goods">${good(PL, "Planks", 12, 33)}${good("🍞", "Flour", 6, 18, "warn")}${good("🪨", "Stone", 5, 15)}${good("🔩", "Iron", 4, 10)}${good("🪑", "Furniture", 2, 6)}</div>`;
const NEED = `<div class="mk-need"><p><b>🍞 Flour: no mill yet.</b> A mill makes it from grain.</p><span class="mk-btn small">Find a mill ›</span></div>`;
const pips = (n, done = 0, now = -1) => `<span class="mk-pips">${Array.from({ length: n }, (_, i) => `<i class="${i < done ? "on" : i === now ? "now" : ""}"></i>`).join("")}</span>`;
const proj = (ic, name, line, n, right, cls = "") => `<div class="mk-proj ${cls}"><span class="ic">${ic}</span><span class="nm"><b>${name}</b><span>${line}</span></span>${right}</div>`;
const PROJ_ROWS = [
  proj("⛪", "Cathedral", "Every town grows on a tenth fewer goods", 4, `<span class="mk-stamp gold">450 🪙</span>`),
  proj("👑", "Royal Train", "An engine and two saloons for your toy box", 3, `<span class="mk-stamp gold">300 🪙</span>`),
  proj("🏢", "Grand Central", "A hub station: riders through it pay more", 3, `<span class="mk-stamp gold">500 🪙</span>`),
  proj("🎡", "World's Fair wheel", "A fair each July, and tickets every month", 3, `<span class="mk-stamp gold">350 🪙</span>`),
].join("");
const EXHIBITION = (ring) => `<div class="mk-ticket">
  <div class="top"><span class="ic">🏛️</span><b>Great Exhibition</b>${pips(4)}</div>
  <div class="gift">🎁 <b>Every town grows a step</b>: a level, or a quarter of a city's next star</div>
  <ol class="mk-stages">
    <li><i class="mk-hole"></i>1. The foundations<span class="g">20 ${PL} 20 🪨</span></li>
    <li><i class="mk-hole"></i>2. The iron hall<span class="g">16 🔩 10 🧱</span></li>
    <li><i class="mk-hole"></i>3. The stands<span class="g">10 🪑 6 🧰</span></li>
    <li><i class="mk-hole"></i>4. Opening day<span class="g">10 🥖 8 🎨</span></li>
  </ol>
  <div class="mk-tfoot"><span class="sp">Trains bring each stage's goods to Larkfield's station</span><span class="mk-btn go ${ring ? "mk-ring" : ""}">Start · 400 🪙</span></div>
</div>`;
const SERVICES = `<div class="mk-row"><span class="k">🏪 Market</span><span class="v">Pays extra for goods</span></div>
  <div class="mk-row"><span class="k">📮 Post</span><span class="v">Mail once there's a post office</span><span class="mk-btn small">Find one ›</span></div>
  <div class="mk-row"><span class="k">🏫 School</span><span class="v">None yet: a study hall teaches faster</span></div>`;
const STATION = `<div class="mk-row"><span class="k">🚉 Station</span><span class="v">0 of 6 waiting · 0 carried</span></div>
  <div class="mk-lines"><span class="mk-line"><i style="background:${RED}"></i>Red line · 2 trains</span><span class="mk-line"><i style="background:${BLUE}"></i>Blue line · 1 train</span></div>
  <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="mk-btn small">＋ New route from here</span><span class="mk-toggle">Load automatically <i></i></span></div>`;
const PLACES = `<div class="mk-places">
  <div class="mk-place"><b>🏛️ Town hall</b>Plans this town's places<span class="mk-stamp gold">60 🪙 + 6 ${PL}</span></div>
  <div class="mk-place"><b>⛲ Fountain</b>A treat: looks loved<span class="mk-stamp gold">100 🪙</span></div>
</div>`;

// ---- A: one scroll, "Next up" on top, a jump strip ----------------------------------------------------------------

const A = (wide) => `${title}${level}${NEXT_GRAND}
  <div class="mk-jump"><span>📈 Grow</span><span><i class="mk-peg"></i>Projects</span><span>🏛️ Places</span><span>🚉 Station</span></div>
  <div class="mk-sec"><div class="mk-h">Grow<span class="sp"></span><small>full pay for these</small></div>${GOODS}${NEED}<div style="font-size:12.5px;color:var(--wood-ink-soft)">Always buys 🥖 bread, 🧱 bricks and 📮 post at full pay</div></div>
  <div class="mk-sec"><div class="mk-h">Grand projects<span class="sp"></span><small>0 of 5 · one per map</small></div>${proj("🏛️", "Great Exhibition", "Every town grows a step", 4, `<span class="mk-stamp gold">400 🪙</span>`)}${PROJ_ROWS}</div>
  ${wide ? `<div class="mk-sec"><div class="mk-h">Places<span class="sp"></span><small>◯◯◯◯ smiles</small></div>${PLACES}</div>` : ""}
  <div class="mk-fade"></div>`;

// ---- B: tabs (Grow · Build · Projects · Station) under a header with Next up ---------------------------------------

const tabs = (on) => `<div class="mk-tabs">${[["Grow", ""], ["Build", ""], ["Projects", `<i class="mk-peg"></i>`], ["Station", ""]].map(([t, x]) => `<span class="${t === on ? "on" : ""}">${t}${x}</span>`).join("")}</div>`;
const B_PROJECTS = (landed) => `${title}${level}${tabs("Projects")}
  <div style="font-size:13px;color:var(--wood-ink-soft)">Big builds for a City ★. Pick one: trains bring its goods in stages. <b style="color:var(--wood-ink)">0 of 5 built</b></div>
  ${EXHIBITION(landed)}${PROJ_ROWS}<div class="mk-fade"></div>`;
const B_GROW = `${title}${level}${tabs("Grow")}
  ${next("Bring flour: Larkfield has no mill", "6 of 18 flour. A mill makes it from grain", "Find a mill on the tray ›", "blue")}
  ${GOODS}<div style="font-size:12.5px;color:var(--wood-ink-soft)">Always buys 🥖 bread, 🧱 bricks and 📮 post at full pay. Others at half.</div><div class="mk-fade"></div>`;

// ---- C: a short card (three doors) and a town board -----------------------------------------------------------------

const door = (ic, t, s, peg = "") => `<div class="mk-door">${peg}<span class="ic">${ic}</span><b>${t}</b><span>${s}</span></div>`;
const C_CARD = `${title}${level}${NEXT_GRAND}
  <div class="mk-doors">${door("📈", "Grow", "1 good missing")}${door("🏛️", "Projects", "5 to start")}${door("🚉", "Station", "2 lines")}</div>
  <span class="mk-btn wide">Open Larkfield's board ›</span>`;
const C_BOARD = `<div class="mk-title"><b style="text-align:left;padding-left:0">Larkfield <span class="mk-stamp green" style="vertical-align:middle;margin-left:8px">City ★</span></b><span class="to" style="font-size:13px;color:var(--wood-ink-soft)">29 of 82 goods to ★★</span><div class="mk-bar" style="width:220px"><i style="width:35%"></i></div><span class="mk-x">✕</span></div>
  <div class="mk-cols">
    <div><div class="mk-h">📈 Grow</div><div class="mk-goods one">${good(PL, "Planks", 12, 33)}${good("🍞", "Flour", 6, 18, "warn")}${good("🪨", "Stone", 5, 15)}${good("🔩", "Iron", 4, 10)}${good("🪑", "Furniture", 2, 6)}</div>${NEED}<div class="mk-h" style="margin-top:6px">🏛️ Places<span class="sp"></span><small>◯◯◯◯</small></div>${PLACES}</div>
    <div><div class="mk-h">🥇 Grand projects<span class="sp"></span><small>0 of 5</small></div>${EXHIBITION(false)}${proj("⛪", "Cathedral", "Every town grows on a tenth fewer goods", 4, `<span class="mk-stamp gold">450 🪙</span>`)}${proj("👑", "Royal Train", "An engine and two saloons for your toy box", 3, `<span class="mk-stamp gold">300 🪙</span>`)}<div style="font-size:12.5px;color:var(--wood-ink-soft)">2 more: Grand Central, World's Fair wheel ›</div></div>
    <div><div class="mk-h">🚉 Station &amp; lines</div>${STATION}<div class="mk-h" style="margin-top:6px">🏪 Services</div>${SERVICES}</div>
  </div>`;

// ---- The Journal: what Show me does, said on it --------------------------------------------------------------------

const journalFix = (p) => p.evaluate(() => {
  const show = document.querySelector(".ach-item.open .ach-show");
  if (!show) return;
  const line = document.querySelector(".ach-item.open .ach-line");
  if (line) line.textContent = "Larkfield is a City ★: it can build this now";
  const box = document.createElement("div");
  box.className = "mk-inj";
  box.style.cssText = "display:flex;flex-direction:column;gap:10px;margin-top:8px";
  box.innerHTML = `<span class="mk-btn blue" style="align-self:flex-start">Start it in Larkfield · 400 🪙 ›</span>
    <div class="mk-callout"><span class="t">With no City ★ yet, it says</span><span>Grow a town into a City ★ first. <b>Larkfield</b> is a City: 29 of 82 goods to go.</span><span class="mk-btn small" style="align-self:flex-start">Show me Larkfield ›</span></div>`;
  show.classList.add("mk-hide");
  show.style.display = "none";
  show.after(box);
});

const shoot = (size) => [
  { name: `city-card-A-${size}`, size, async run(p, s) { await inject(p, s, A(size === "desktop")); } },
  { name: `city-card-B-${size}-projects`, size, async run(p, s) { await inject(p, s, B_PROJECTS(false)); } },
  { name: `city-card-B-${size}-grow`, size, async run(p, s) { await inject(p, s, B_GROW); } },
  size === "phone"
    ? { name: `city-card-C-${size}-card`, size, async run(p, s) { await inject(p, s, C_CARD, null); await p.evaluate(() => { const c = document.querySelector(".mk-card"); c.style.height = "auto"; c.style.top = `${Math.max(130, parseFloat(c.style.top) + parseFloat(c.style.height || 0))}px`; }); await p.evaluate(() => { const c = document.querySelector(".mk-card"); c.style.top = `${683 - c.getBoundingClientRect().height}px`; }); } }
    : { name: `city-card-C-${size}-board`, size, async run(p, s) { await inject(p, s, C_BOARD, { board: true, left: 345, top: 84, width: 1080, height: 640 }); } },
  ...(size === "phone" ? [{ name: `city-card-C-${size}-board`, size, async run(p, s) { await inject(p, s, `${title}${level}${tabs("Projects")}${EXHIBITION(false)}${PROJ_ROWS}<div class="mk-fade"></div>`, { left: 0, top: 0, width: 390, height: 844 }); await p.evaluate(() => { const c = document.querySelector(".mk-card"); c.style.borderRadius = "0"; c.style.paddingTop = "18px"; }); } }] : []),
  {
    name: `city-card-journal-${size}-1-button`,
    size,
    async run(p) {
      await closeAll(p);
      await css(p);
      await openJournalAch(p);
      await clearToasts(p);
      await journalFix(p);
    },
  },
  {
    name: `city-card-journal-${size}-2-landed`,
    size,
    async run(p, s) {
      await inject(p, s, B_PROJECTS(true));
    },
  },
];

export default [...shoot("phone"), ...shoot("desktop")];
