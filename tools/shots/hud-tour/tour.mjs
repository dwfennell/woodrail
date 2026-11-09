// The HUD tour's screens: each opens one surface the way the game does (its own buttons and calls), on the staged
// railway from stage.mjs. A screen is { name, run(p, setup) }; stage.mjs shoots it after run. Toasts the game raises
// by itself are hidden, except on the toast screen.
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function reset(p) {
  for (let i = 0; i < 3; i++) { await p.keyboard.press("Escape"); await p.waitForTimeout(150); }
  await p.evaluate(() => {
    const visible = (sel) => [...document.querySelectorAll(sel)].find((e) => e.offsetParent);
    if (visible(".menu")) document.querySelector('button[aria-label="Menu"]')?.click();
    const g = document.querySelector(".goals");
    if (g && !g.classList.contains("collapsed")) (visible(".goals-close") ?? g.querySelector(".goals-head"))?.click();
    visible(".line-sheet .ls-done")?.click();
    [...document.querySelectorAll(".lines-view button")].find((b) => b.offsetParent && /^(Done|✕)$/.test(b.textContent.trim()))?.click();
    visible(".explainer-sheet .close, .sheet .close")?.click();
    document.querySelectorAll(".hw-quiet").forEach((e) => e.remove());
  });
  await p.waitForTimeout(350);
}
async function quiet(p) {
  await p.addStyleTag({ content: ".toast { visibility: hidden !important; }" }).then((h) => h.evaluate((e) => e.classList.add("hw-quiet")));
}
async function look(p, dist = 2600) {
  await p.evaluate((dist) => {
    const w = window.woodrail;
    const ps = window.__mock.places.map((d) => w.layout.getPiece(w.economy.depot(d).pieceId).pose);
    const x = ps.reduce((a, q) => a + q.x, 0) / ps.length, z = ps.reduce((a, q) => a + q.z, 0) / ps.length;
    w.director.glideTo(new w.controls.target.constructor(x, 0, z), dist, { duration: 0.1 });
  }, dist);
  await p.waitForTimeout(700);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
}
const click = (p, sel, text) => p.evaluate(([sel, text]) => {
  const b = [...document.querySelectorAll(sel)].find((e) => e.offsetParent && (!text || e.textContent.trim().startsWith(text)));
  b?.click();
  return !!b;
}, [sel, text ?? null]);
const tab = (p, label) => click(p, ".tray .tab", label);
const menuItem = async (p, label) => { await click(p, 'button[aria-label="Menu"]'); await p.waitForTimeout(300); return click(p, ".menu button", label); };
const openJournal = async (p, which) => {
  await p.evaluate(() => { const g = document.querySelector(".goals"); if (g.classList.contains("collapsed")) g.querySelector(".goals-head").click(); });
  await p.waitForTimeout(300);
  await click(p, ".goals-tab", which);
};

const S = {
  async tray(p) { await look(p); await tab(p, "Track"); },
  async trains(p) { await look(p); await tab(p, "Trains"); },
  async industries(p) { await look(p); await tab(p, "Industries"); },
  async locked(p) {
    await look(p);
    // A locked tile answers a real tap (pointer down and up), not a scripted click.
    for (const t of ["Industries", "Trains", "Track"]) {
      await tab(p, t);
      await p.waitForTimeout(200);
      const at = await p.evaluate(() => { const b = [...document.querySelectorAll(".tray-item.locked")].find((e) => e.offsetParent); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
      if (at) { await (process.env.DESKTOP ? p.mouse.click(at[0], at[1]) : p.touchscreen.tap(at[0], at[1])); break; }
    }
    await p.waitForTimeout(600);
  },
  async menu(p) { await look(p); await click(p, 'button[aria-label="Menu"]'); },
  async card(p, s) { await look(p, 1500); await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), s.engines[0]); },
  async toast(p) {
    await look(p);
    await p.evaluate(() => { const t = document.querySelector(".toast"); t.textContent = "Goal done: Carry 10 planks to the workshop"; t.className = "toast celebrate show"; });
  },
  async journal(p) { await look(p); await openJournal(p, "Goals"); },
  async news(p) { await look(p); await openJournal(p, "News"); },
  async research(p) {
    await click(p, '.actions .chip[aria-label^="Research"]');
    await p.waitForTimeout(1000);
    await p.evaluate(() => [...document.querySelectorAll(".bp-node")].find((x) => x.classList.contains("ready"))?.click());
    await p.waitForTimeout(600);
    // For the alignment check: each "?" card's box (its glyph should sit on the box's centre).
    console.log("hints", JSON.stringify(await p.evaluate(() => [...document.querySelectorAll(".bp-node.hint, .bp-hints .bp-dot")].filter((e) => e.offsetParent).slice(0, 6).map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); }))));
  },
  async lines(p) { await look(p); await menuItem(p, "Lines"); },
  async linesheet(p) {
    await look(p);
    await menuItem(p, "Lines");
    await p.waitForTimeout(1000);
    await click(p, ".lines-row");
    await p.waitForTimeout(900);
    await click(p, ".ls-stop[data-stop='1'] .ls-stop-main");
  },
  async sawmill(p, s) { await look(p, 1500); await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), s.places[1]); },
  async workshop(p, s) { await look(p, 1500); await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), s.places[2]); },
  async town(p) {
    await p.evaluate(() => {
      const w = window.woodrail;
      const d = [...w.economy.depots.values()].find((x) => x.role === "town");
      if (d) { const q = w.layout.getPiece(d.pieceId).pose; w.director.glideTo(new w.controls.target.constructor(q.x, 0, q.z), 1500, { duration: 0.1 }); w.interaction.openDepotCard(d.id); }
    });
  },
  async piece(p, s) {
    await look(p, 1500);
    await p.evaluate(() => {
      const w = window.woodrail;
      const id = [...w.layout.pieceIds()].find((i) => w.layout.getPiece(i).type.startsWith("curve") || w.layout.getPiece(i).type.startsWith("straight"));
      w.interaction.selectPiece(id);
    });
  },
  async map(p) { await click(p, '.actions .chip[aria-label^="Map"]'); await p.waitForTimeout(1500); },
  async explainer(p) { await look(p); await p.evaluate(() => window.woodrail.hud.showExplainer("signals")); await p.waitForTimeout(1200); },
  async credits(p) { await look(p); await menuItem(p, "Credits"); await p.waitForTimeout(800); },
  async help(p) { await look(p); await menuItem(p, "How to play"); await p.waitForTimeout(800); },
  async newgame(p) { await look(p); await menuItem(p, "New game"); await p.waitForTimeout(900); },
};

export default Object.entries(S).map(([name, fn]) => ({
  name,
  async run(p, setup) {
    await reset(p);
    if (name !== "toast") await quiet(p);
    await fn(p, setup);
    await p.waitForTimeout(700);
    await frames(p);
  },
  async after(p) {
    if (name === "map") await click(p, '.actions .chip[aria-label^="Map"]');
    if (name === "newgame") await click(p, ".new-game-sheet:not([hidden]) .new-game-back, .new-game-sheet:not([hidden]) button", "Back");
  },
}));
