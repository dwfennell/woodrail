// The lines UI as it is today (the "before" pictures): the train card's line box, the line sheet (stops, an open stop,
// trains), the Lines list. Each scene leaves the UI where the next expects it.
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
export async function tapSel(p, sel, text) {
  await p.waitForSelector(sel, { state: "visible", timeout: 20000 });
  const at = await p.evaluate(({ sel, text }) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.trim().startsWith(text)));
    if (!el) return null;
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, { sel, text });
  if (!at) throw new Error(`no ${sel} ${text ?? ""}`);
  const mobile = await p.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (mobile) await p.touchscreen.tap(at[0], at[1]);
  else await p.mouse.click(at[0], at[1]);
  await frames(p);
  await p.waitForTimeout(400);
}
export async function clearToasts(p) {
  await p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => (t.style.display = "none")));
}
export async function look(p, s) {
  await p.evaluate((g) => {
    const w = window.woodrail;
    w.director.glideTo(new w.controls.target.constructor(g.x, 0, g.z + 200), 2400, { duration: 0.1 });
  }, s.g);
  await p.waitForTimeout(800);
}
export default [
  {
    name: "today-1-card",
    async run(p, s) {
      await look(p, s);
      await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), s.engines[0]);
      await p.waitForTimeout(1500);
      await clearToasts(p);
    },
  },
  {
    name: "today-2-sheet",
    async run(p) {
      await tapSel(p, ".engine-extra .route-plan");
      await p.waitForTimeout(1200);
      await clearToasts(p);
    },
  },
  {
    name: "today-3-open-stop",
    async run(p) {
      await tapSel(p, ".ls-stop[data-stop='2'] .ls-stop-main");
      await p.waitForTimeout(600);
      await clearToasts(p);
    },
  },
  {
    name: "today-4-trains",
    async run(p) {
      await tapSel(p, ".ls-tab", "Trains");
      await p.waitForTimeout(600);
      await clearToasts(p);
    },
  },
  {
    name: "today-5-lines",
    async run(p) {
      if (await p.evaluate(() => !!document.querySelector(".line-sheet:not([hidden]) .ls-done"))) await tapSel(p, ".ls-done");
      await p.waitForTimeout(600);
      await p.keyboard.press("Escape");
      await p.waitForTimeout(400);
      if (await p.evaluate(() => !document.querySelector(".lines-view") || document.querySelector(".lines-view").hidden)) {
        // (☰ Lines, as a tap on it does.)
        await p.evaluate(() => window.woodrail.hud.linesItem.click());
      }
      await p.waitForTimeout(1200);
      await clearToasts(p);
    },
  },
];
