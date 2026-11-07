// Layout options for the engine card, tried on the live card (`OPT=a|b MOCK=tools/shots/engine-card-mocks.mjs node
// tools/shots/engine-card.mjs <out>`): the game's own card, its nodes moved and restyled in the page, then pictured in
// its states (stuck, at a stop, no line, the route's edit view). Only for choosing a layout
// (docs/agents/shots/engine-card-*); nothing here is the game's code.
const STUCK = "Stuck: the train parked by the farm yard is in the way. Move it";
const AT_STOP = "Unloading at the sawmill";

const BASE = `
.mock .engine-card { gap: 10px; padding: 14px; }
.mock .engine-card .engine-name { margin: -12px auto -4px; }
.mock .m-status { display: flex; align-items: center; gap: 8px; align-self: stretch; min-height: 44px; }
.mock .m-status .engine-status { flex: 1; text-align: left; max-width: none; margin: 0; font-size: 14px; line-height: 18px; min-height: 36px; display: flex; align-items: center; }
.mock .m-status .engine-blocker { margin: 0; flex: none; }
.mock.m-stuck .m-status .engine-blocker { display: flex !important; }
.mock:not(.m-stuck) .m-status .engine-blocker { display: none !important; }
.mock .m-status .engine-blocker .chip { min-width: 64px; }
/* Go (or Stop), Leave now beside it at a stop, the way at the end: one row a thumb tall. */
.mock .engine-controls { display: flex !important; align-self: stretch; gap: 8px; }
.mock .engine-controls .chip.go { flex: 1 1 0; height: 52px; width: auto; }
.mock .engine-controls .chip.leave-now { flex: 1 1 0; height: 52px; font-size: 17px; align-items: center; justify-content: center; line-height: 1; }
.mock .engine-controls .chip.way { flex: 0 0 64px; height: 52px; }
.mock:not(.m-atstop) .engine-controls .chip.leave-now { display: none !important; }
.mock.m-atstop .engine-controls .chip.leave-now { display: inline-flex !important; }
.mock .m-panel { align-self: stretch; background: rgba(120, 80, 40, 0.07); border-radius: 14px; padding: 6px 8px 8px; display: flex; flex-direction: column; gap: 6px; margin: 0 !important; }
.mock .route-head { min-height: 44px; }
.mock .route-head .engine-extra-label { padding-left: 4px; }
.mock .route-head .chip { font-size: 15px; }
.mock .route-head .route-leave { display: none; }
.mock .route-stops { scroll-snap-type: x mandatory; mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent) !important; -webkit-mask-image: linear-gradient(90deg, #000 calc(100% - 36px), transparent) !important; }
.mock .route-stops .route-chip { scroll-snap-align: start; }
.mock .route-stops::after { content: ""; flex: 0 0 36px; }
.mock .route-hint { padding-left: 4px; }
.mock .m-load { display: flex; align-items: center; gap: 8px; align-self: stretch; }
.mock .m-load .engine-summary { flex: 1; text-align: left; display: block !important; margin: 0; }
.mock .m-load .empty-all { flex: none; margin: 0 !important; font-size: 14px; color: #b0391f; }
.mock .m-tools { display: flex; gap: 6px; align-self: stretch; align-items: center; }
.mock .m-tools .chip { flex: 1 1 auto; min-width: 0; padding: 0 8px; font-size: 14px; white-space: nowrap; }
.mock .m-tools .m-gap { flex: 0 0 2px; height: 28px; background: rgba(120, 80, 40, 0.25); border-radius: 1px; margin: 0 2px; }
.mock .m-tools .remove { flex: 0 0 auto; }
/* Editing: the line alone, the hint in plain words, Take off line and Done at its foot. */
.mock .planning .engine-controls, .mock .planning .engine-summary, .mock .planning .m-load, .mock .planning .m-tools, .mock .planning .m-status { display: none !important; }
.mock .planning .engine-card { padding: 12px 14px 14px; }
.mock .planning .engine-card .m-panel { background: transparent; padding: 0; }
.mock .m-hint { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; font-weight: 700; line-height: 19px; color: #5e4128; padding: 2px 4px; }
.mock .m-foot { display: flex; gap: 8px; align-items: center; justify-content: space-between; margin-top: 2px; }
.mock .m-foot .route-plan.on { min-width: 112px; }
.mock .m-foot .m-off { background: transparent; box-shadow: inset 0 0 0 2px rgba(176, 57, 31, 0.45); color: #b0391f; font-size: 14px; }
.mock .m-edit-title { font-size: 12px; font-weight: 800; color: #74522f; padding-left: 4px; margin-bottom: -4px; }
`;

async function common(p) {
  await p.evaluate(({ STUCK }) => {
    document.body.classList.add("mock", "m-stuck");
    const card = document.querySelector(".engine-card");
    const status = card.querySelector(".engine-status");
    const blocker = card.querySelector(".engine-blocker");
    window.__say = (t) => (status.textContent = t);
    window.__say(STUCK);
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
    empty.textContent = "🗑 Delete cargo";
    const load = document.createElement("div");
    load.className = "m-load";
    summary.replaceWith(load);
    load.append(summary, empty);
    summary.querySelector(".summary-about").textContent = "3 cars · steady";
    const extra = card.querySelector(".engine-extra");
    extra.classList.add("m-panel");
    const controls = card.querySelector(".engine-controls");
    controls.after(extra);
    extra.after(load);
    // (The real card's Leave now, moved before the way.)
    const leave = controls.querySelector(".leave-now");
    leave.textContent = "Leave now ▸";
    controls.querySelector(".go").after(leave);
  }, { STUCK });
}

/** The train's tools in a row of their own, Remove apart at the end after a rule. */
const toolsRow = (p, after, cls = "") =>
  p.evaluate(({ after, cls }) => {
    const card = document.querySelector(".engine-card");
    const actions = card.querySelector(".engine-actions");
    const tools = document.createElement("div");
    tools.className = `m-tools ${cls}`;
    const gap = document.createElement("i");
    gap.className = "m-gap";
    tools.append(actions.querySelector(".swap-ends"), actions.querySelector(".decouple"), actions.querySelector(".paint-engine"), gap, actions.querySelector(".remove"));
    actions.remove();
    card.querySelector(after).after(tools);
  }, { after, cls });

/** At a stop: the crane at work, Stop red and Leave now beside it. */
const atStop = (p) =>
  p.evaluate((AT_STOP) => {
    document.body.classList.remove("m-stuck");
    document.body.classList.add("m-atstop");
    window.__say(AT_STOP);
    const go = document.querySelector(".engine-card .chip.go");
    go.classList.add("stop");
    go.innerHTML = '<span class="go-icon">■</span>Stop';
  }, AT_STOP);

/** The stops strip at a whole chip: the one before the stop it's heading for at its start (as snapping will). */
const fixStrip = (p) =>
  p.evaluate(() => {
    const strip = document.querySelector(".route-stops");
    const next = strip?.querySelector(".route-chip.next");
    if (!strip) return;
    strip.scrollLeft = next?.previousElementSibling && !document.querySelector(".route-plan.on") ? next.previousElementSibling.offsetLeft : 0;
  });

/** Into the route's edit view: Edit tapped; the hint, Take off line and Done restyled. */
async function editView(p) {
  await p.evaluate(() => document.querySelector(".engine-extra .route-plan").click());
  await p.waitForTimeout(500);
  await p.evaluate(() => {
    const box = document.querySelector(".engine-extra");
    box.querySelector(".route-line-text").textContent = "Editing Red line";
    const hint = box.querySelector(".route-plan-hint");
    if (hint) {
      hint.className = "m-hint";
      hint.innerHTML = "<span>👆</span><span>Tap a place on the map to add it as a stop. Tap track to make the train go that way.</span>";
    }
    const done = box.querySelector(".route-plan.on");
    const off = document.createElement("button");
    off.className = "chip text m-off";
    off.textContent = "Take off line";
    const foot = document.createElement("div");
    foot.className = "m-foot";
    foot.append(off, done);
    box.append(foot);
  });
}

/** Its line left (by the game's own stopLine): Plan a route. */
const noLine = (p, engine) =>
  p.evaluate(async (engine) => {
    const w = window.woodrail;
    const L = await import("/src/game/lines.ts");
    L.stopLine(w.economy, engine);
    document.body.classList.remove("m-stuck", "m-atstop");
    window.__say("Stopped");
    const go = document.querySelector(".engine-card .chip.go");
    go.classList.remove("stop");
    go.textContent = "Go";
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector(".engine-extra").classList.add("m-panel");
  }, engine);

const style = (p, css) => p.addStyleTag({ content: BASE + css });

export default async function (p, shot0, setup) {
  const shot = async (n) => {
    await fixStrip(p);
    await shot0(n);
  };
  const opt = process.env.OPT ?? "a";
  if (opt === "a") {
    // A: one column, every option shown, in bands by purpose: status and its fix; Go/Stop, Leave now and the way; the
    // line; the load and Delete cargo; the train's tools with Remove apart.
    await style(p, "");
    await common(p);
    await toolsRow(p, ".m-load");
    await shot("engine-card-a-1-stuck");
    await atStop(p);
    await shot("engine-card-a-2-at-stop");
    await editView(p);
    await shot("engine-card-a-3-edit");
    await p.evaluate(() => document.querySelector(".m-foot .route-plan.on").click());
    await p.waitForTimeout(400);
    await noLine(p, setup.engine);
    await shot("engine-card-a-4-no-line");
  } else {
    // B: shorter. The load a line under the name, Delete cargo at its end; the train's tools a quieter row of flat chips,
    // Remove last.
    await style(p, `
.mock .m-load { margin-top: -6px; }
.mock .m-load .engine-summary { font-size: 13px; }
.mock .m-load .engine-summary > div { display: inline; }
.mock .m-load .engine-summary .summary-about::after { content: " · "; }
.mock .m-load .empty-all { height: 40px; min-height: 40px; padding: 0 10px; background: transparent; box-shadow: inset 0 0 0 2px rgba(176, 57, 31, 0.4); font-size: 13.5px; }
.mock .m-tools.flat .chip { height: 44px; background: transparent; box-shadow: inset 0 0 0 2px rgba(150, 100, 50, 0.3); font-size: 14px; padding: 0 8px; }
.mock .m-tools.flat .chip.remove { box-shadow: inset 0 0 0 2px rgba(176, 57, 31, 0.5); color: #b0391f; }
`);
    await common(p);
    await p.evaluate(() => {
      const card = document.querySelector(".engine-card");
      card.querySelector(".engine-name").after(card.querySelector(".m-load"));
    });
    await toolsRow(p, ".engine-extra", "flat");
    await shot("engine-card-b-1-stuck");
    await atStop(p);
    await shot("engine-card-b-2-at-stop");
    await editView(p);
    await shot("engine-card-b-3-edit");
  }
}
