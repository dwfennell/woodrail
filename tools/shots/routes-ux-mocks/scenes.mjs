const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
export async function openCard(p, engine) {
  await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), engine);
  await p.waitForTimeout(1200);
}
export async function look(p, engine, dist = 1500, dz = 0) {
  await p.evaluate(([e, dist, dz]) => {
    const w = window.woodrail;
    const t = w.sim.findCar(e).train.world[0];
    w.director.glideTo(new w.controls.target.constructor(t.x, t.y, t.z + dz), dist, { duration: 0.1 });
  }, [engine, dist, dz]);
  await p.waitForTimeout(400);
}
export async function tapEngine(p, engine) {
  const [x, y] = await p.evaluate((e) => {
    const w = window.woodrail;
    const t = w.sim.findCar(e).train;
    const [a, b] = [t.world[0], t.world[1]];
    const c = new w.camera.position.constructor((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2).project(w.camera);
    return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
  }, engine);
  await p.touchscreen.tap(x, y);
  await frames(p);
  await p.waitForTimeout(400);
}
export async function tapSel(p, sel) {
  await p.waitForSelector(sel, { state: "visible", timeout: 20000 });
  const [x, y] = await p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
  await p.touchscreen.tap(x, y);
  await frames(p);
  await p.waitForTimeout(300);
}
export async function clearToasts(p) {
  await p.evaluate(() => document.querySelectorAll(".toast, .hud-toast, [class*=toast]").forEach((t) => (t.style.display = "none")));
}
const base = [
  {
    name: "today",
    async run(p, s) {
      await clearToasts(p);
      await look(p, s.engines[0], 1500);
      await openCard(p, s.engines[0]);
      await tapSel(p, ".engine-extra .route-plan");
      await tapSel(p, ".route-chip[data-stop='1']");
      await clearToasts(p);
      require_html: {
        const html = await p.evaluate(() => document.querySelector(".engine-card")?.outerHTML?.length);
        console.log("card html", html);
      }
    },
  },
];
export const extra = [
  { name: "ref-journal", async run(p) { await p.keyboard.press("Escape"); await p.waitForTimeout(500); console.log(await p.evaluate(() => [...document.querySelectorAll(".hud button[aria-label], button[aria-label]")].map((b) => b.getAttribute("aria-label")).slice(0, 15).join("|"))); await p.evaluate(() => (document.querySelector('.goals-head'))?.click()); await p.waitForTimeout(800); } },
  { name: "ref-map", async run(p) { await p.keyboard.press("Escape"); await p.waitForTimeout(500); await p.evaluate(() => document.querySelector('button[aria-label^="Map"]')?.click()); await p.waitForTimeout(1500); } , async after(p) { await p.keyboard.press("Escape"); } },
];
export default [...base, ...extra];
