// Layout options for the engine card, tried on the live card (`OPT=a|b|c MOCK=tools/shots/engine-card-mocks.mjs node
// tools/shots/engine-card.mjs <out>`): the game's own card, its nodes moved and restyled in the page, then pictured.
// Only for choosing a layout (docs/agents/shots/engine-card-*); nothing here is the game's code.
const STATUS = "Stuck: the train parked by the farm yard is in the way. Move it";

const BASE = `
.mock .engine-card { gap: 8px; padding: 12px; }
.mock .engine-card .engine-name { margin: -10px auto -4px; }
.mock .m-status { display: flex; align-items: center; gap: 8px; align-self: stretch; min-height: 44px; padding: 0 4px; }
.mock .m-status .engine-status { flex: 1; text-align: left; max-width: none; margin: 0; font-size: 14px; line-height: 18px; min-height: 36px; display: flex; align-items: center; }
.mock .m-status .engine-blocker { display: flex !important; margin: 0; flex: none; }
.mock .m-status .engine-blocker .chip { min-width: 64px; }
.mock .engine-controls { grid-template-columns: 1fr 64px; align-self: stretch; gap: 8px; }
.mock .engine-controls .chip.go { height: 52px; }
.mock .engine-controls .chip.way { height: 52px; }
.mock .m-panel { align-self: stretch; background: rgba(120, 80, 40, 0.07); border-radius: 14px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.mock .m-load { display: flex; align-items: center; gap: 8px; align-self: stretch; padding: 0 4px; }
.mock .m-load .engine-summary { flex: 1; text-align: left; display: block !important; margin: 0; }
.mock .m-load .empty-all { flex: none; margin: 0 !important; font-size: 14px; }
.mock .engine-extra { margin-top: 0 !important; }
.mock .route-head { min-height: 44px; }
.mock .route-head .engine-extra-label { padding-left: 4px; }
.mock .route-head .chip { font-size: 14px; }
.mock .route-stops { scroll-snap-type: x mandatory; scroll-padding-inline: 0; mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent) !important; -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent) !important; }
.mock .route-stops .route-chip { scroll-snap-align: start; }
.mock .route-stops::after { content: ""; flex: 0 0 36px; }
.mock .route-hint { padding-left: 4px; }
.mock .m-tools { display: flex; gap: 6px; align-self: stretch; align-items: center; }
.mock .m-tools .chip { flex: 1 1 auto; min-width: 0; padding: 0 8px; font-size: 14px; white-space: nowrap; }
.mock .m-tools .m-gap { flex: 0 0 2px; height: 28px; background: rgba(120, 80, 40, 0.25); border-radius: 1px; margin: 0 2px; }
.mock .m-tools .remove { flex: 0 0 auto; }
/* Editing: the line alone, Done where Edit was, the hint in words a player reads once. */
.mock .planning .engine-summary, .mock .planning .m-load, .mock .planning .m-tools, .mock .planning .m-status, .mock .planning .m-tabs { display: none !important; }
.mock .planning .engine-card { padding: 10px 12px 12px; }
.mock .m-hint { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; font-weight: 700; line-height: 19px; color: #6a4a2c; padding: 2px 4px; }
.mock .m-hint b { font-weight: 900; }
`;

async function common(p) {
  await p.evaluate(({ STATUS }) => {
    const w = window.woodrail;
    document.body.classList.add("mock");
    const card = document.querySelector(".engine-card");
    const status = card.querySelector(".engine-status");
    const blocker = card.querySelector(".engine-blocker");
    status.textContent = STATUS;
    w.hud.setBlocker(true);
    blocker.hidden = false;
    const row = document.createElement("div");
    row.className = "m-status";
    status.replaceWith(row);
    row.append(status, blocker);
    const paint = card.querySelector(".paint-engine");
    paint.hidden = false;
    paint.textContent = "🎨 Paint";
    const summary = card.querySelector(".engine-summary");
    const empty = card.querySelector(".empty-all");
    empty.textContent = "Tip out";
    const load = document.createElement("div");
    load.className = "m-load";
    summary.replaceWith(load);
    load.append(summary, empty);
    const about = summary.querySelector(".summary-about");
    about.textContent = "3 cars · steady";
    const extra = card.querySelector(".engine-extra");
    extra.classList.add("m-panel");
    const leave = extra.querySelector(".route-leave");
    if (leave) leave.textContent = "Leave line";
    // Order: status, Go and the way, the line, the load.
    const controls = card.querySelector(".engine-controls");
    controls.after(extra);
    extra.after(load);
    // The stops strip at a whole chip (snapped), the one it's heading for in view.
    const strip = extra.querySelector(".route-stops");
    strip.scrollLeft = 0;
  }, { STATUS });
}

/** Into the route's edit view: Edit tapped; the hint and Done restyled. `doneAt`: "head" (where Edit was) or "foot". */
async function editView(p, doneAt) {
  await p.evaluate(() => document.querySelector(".engine-extra .route-plan").click());
  await p.waitForTimeout(500);
  await p.evaluate((doneAt) => {
    const box = document.querySelector(".engine-extra");
    box.querySelector(".route-line-text").textContent = "Editing Red line";
    const strip = box.querySelector(".route-stops");
    strip.scrollLeft = 0;
    const hint = box.querySelector(".route-plan-hint");
    if (hint) {
      hint.className = "m-hint";
      hint.innerHTML = "<span>👆</span><span>Tap a place on the map to add it as a stop. Tap track to make the train <b>go that way</b>.</span>";
    }
    const done = box.querySelector(".route-plan.on");
    if (doneAt === "foot") {
      const foot = document.createElement("div");
      foot.style.cssText = "display:flex;justify-content:flex-end;gap:8px;align-items:center";
      done.style.minWidth = "110px";
      foot.append(done);
      box.append(foot);
    }
  }, doneAt);
}

const style = (p, css) => p.addStyleTag({ content: BASE + css });

/** The train's tools in a row of their own, Remove apart at the end after a rule. */
const toolsRow = (p, after) =>
  p.evaluate((after) => {
    const card = document.querySelector(".engine-card");
    const actions = card.querySelector(".engine-actions");
    const tools = document.createElement("div");
    tools.className = "m-tools";
    const gap = document.createElement("i");
    gap.className = "m-gap";
    const swap = actions.querySelector(".swap-ends");
    tools.append(swap, actions.querySelector(".decouple"), actions.querySelector(".paint-engine"), gap, actions.querySelector(".remove"));
    actions.remove();
    card.querySelector(after).after(tools);
  }, after);

/** The stops strip at a whole chip: the one before the stop it's heading for at its start (as snapping will). */
const fixStrip = (p) =>
  p.evaluate(() => {
    const strip = document.querySelector(".route-stops");
    const next = strip?.querySelector(".route-chip.next");
    if (!strip) return;
    strip.scrollLeft = next?.previousElementSibling && !document.querySelector(".route-plan.on") ? next.previousElementSibling.offsetLeft : 0;
  });

export default async function (p, shot0) {
  const shot = async (n) => {
    await fixStrip(p);
    await shot0(n);
  };
  const opt = process.env.OPT ?? "a";
  if (opt === "a") {
    // A: everything shown, in bands by purpose: status and its fix; Go and the way; the line; the load; the train's
    // tools with Remove apart.
    await style(p, "");
    await common(p);
    await toolsRow(p, ".m-load");
    await shot("engine-card-a-bands");
    await editView(p, "head");
    await shot("engine-card-a-bands-edit");
  } else if (opt === "b") {
    // B: the shortest card. Go, the way and ⋯ in one row; ⋯ opens the train's tools as a small sheet over the card.
    await style(p, `
.mock .engine-controls { grid-template-columns: 1fr 64px 64px; }
.mock .m-more { height: 52px; font-size: 22px; }
.mock .m-sheet { position: absolute; right: 12px; bottom: 12px; left: 12px; background: #fffaf0; border-radius: 16px; box-shadow: 0 8px 28px rgba(60, 40, 20, 0.35); padding: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; z-index: 3; }
.mock .m-sheet .chip { width: 100%; font-size: 15px; }
.mock .m-sheet .remove { grid-column: 1 / -1; }
.mock .m-sheet .m-sheet-title { grid-column: 1 / -1; font-size: 13px; font-weight: 800; color: #9a7a58; text-align: left; padding: 2px 4px; }
`);
    await common(p);
    await p.evaluate(() => {
      const card = document.querySelector(".engine-card");
      const controls = card.querySelector(".engine-controls");
      const more = document.createElement("button");
      more.className = "chip m-more";
      more.textContent = "⋯";
      controls.querySelector(".way").after(more);
      const actions = card.querySelector(".engine-actions");
      actions.hidden = true;
      window.__sheet = () => {
        const sheet = document.createElement("div");
        sheet.className = "m-sheet";
        const t = document.createElement("div");
        t.className = "m-sheet-title";
        t.textContent = "This train";
        sheet.append(t, actions.querySelector(".swap-ends"), actions.querySelector(".decouple"), actions.querySelector(".paint-engine"), actions.querySelector(".remove"));
        card.append(sheet);
        more.classList.add("active");
      };
    });
    await shot("engine-card-b-more");
    await p.evaluate(() => window.__sheet());
    await shot("engine-card-b-more-open");
    await p.evaluate(() => document.querySelector(".m-sheet").remove());
    await editView(p, "foot");
    await shot("engine-card-b-more-edit");
  } else {
    // C: tabs under Go. Line · Load · Train, the card a fixed height whichever is open (no jumps).
    await style(p, `
.mock .m-tabs { display: flex; align-self: stretch; background: rgba(120, 80, 40, 0.1); border-radius: 12px; padding: 3px; gap: 3px; }
.mock .m-tabs button { flex: 1; height: 44px; border: none; border-radius: 10px; background: transparent; font: inherit; font-weight: 800; font-size: 15px; color: #7a5a3a; }
.mock .m-tabs button.on { background: #fffaf0; color: #3a2a1c; box-shadow: 0 1px 3px rgba(60, 40, 20, 0.2); }
.mock .m-pane { align-self: stretch; height: 150px; display: flex; flex-direction: column; gap: 8px; }
.mock .m-pane .m-load { padding: 4px; }
.mock .m-pane .m-tools { flex-wrap: wrap; }
.mock .m-pane .m-tools .chip { flex: 1 1 40%; }
.mock .m-pane .m-tools .m-gap { display: none; }
.mock .m-pane .m-tools .remove { flex: 1 1 100%; }
.mock .planning .m-pane { height: auto; }
`);
    await common(p);
    await toolsRow(p, ".m-load");
    await p.evaluate(() => {
      const card = document.querySelector(".engine-card");
      const tabs = document.createElement("div");
      tabs.className = "m-tabs";
      const pane = document.createElement("div");
      pane.className = "m-pane";
      const parts = { Line: card.querySelector(".engine-extra"), Load: card.querySelector(".m-load"), Train: card.querySelector(".m-tools") };
      card.querySelector(".engine-controls").after(tabs, pane);
      pane.append(...Object.values(parts));
      window.__tab = (name) => {
        for (const [k, el] of Object.entries(parts)) el.style.display = k === name ? "" : "none";
        for (const b of tabs.children) b.classList.toggle("on", b.textContent.startsWith(name));
      };
      for (const name of Object.keys(parts)) {
        const b = document.createElement("button");
        b.textContent = name === "Load" ? "Load · 9" : name;
        tabs.append(b);
      }
      window.__tab("Line");
    });
    await shot("engine-card-c-tabs");
    await p.evaluate(() => window.__tab("Train"));
    await shot("engine-card-c-tabs-train");
    await p.evaluate(() => window.__tab("Line"));
    await editView(p, "head");
    await shot("engine-card-c-tabs-edit");
  }
}
