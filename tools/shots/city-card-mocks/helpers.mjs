// Helpers the scenes share: open and scroll the town card, the Journal's Achievements tab.
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

export async function closeAll(p) {
  await p.evaluate(() => {
    document.querySelectorAll(".mk-inj").forEach((e) => e.remove());
    document.querySelectorAll(".mk-hide").forEach((e) => e.classList.remove("mk-hide"));
    document.body.classList.remove("mk");
    // The Journal folded (a phone's sheet closed by its ✕; a wide screen's by its fold).
    const g = document.querySelector(".goals");
    if (g && !g.classList.contains("collapsed")) {
      const x = document.querySelector(".goals-close");
      if (x && x.offsetParent) x.click();
      else document.querySelector(".goals-top > button")?.click();
    }
  });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
}
export async function clearToasts(p) {
  await p.evaluate(() => document.querySelectorAll(".toast, .hud-toast, [class*=toast]").forEach((t) => (t.style.display = "none")));
  // (A growth's reward sheet that came late: put away, as the player would.)
  await p.evaluate(() => document.querySelectorAll(".growth-sheet:not([hidden])").forEach((x) => (x.style.display = "none")));
}
/** Fly to the town, card closed. */
export async function lookTown(p, town, dist = 1400) {
  await p.evaluate(([id, dist]) => {
    const w = window.woodrail;
    const t = w.world.landscape.towns.find((t) => t.id === id);
    const s = w.layout.getPiece(w.world.stations.get(id)).pose;
    w.director.glideTo(new w.controls.target.constructor((s.x + t.centre.x) / 2, 0, (s.z + t.centre.z) / 2 + 150), dist, { duration: 0.1 });
  }, [town.id, dist]);
  await p.waitForTimeout(900);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
}
export async function openTownCard(p, town) {
  await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), town.depot);
  await p.waitForTimeout(1300);
  await frames(p);
}
export async function scrollCard(p, where) {
  await p.evaluate((where) => {
    const c = document.querySelector(".depot-card");
    if (where === "bottom") c.scrollTop = c.scrollHeight;
    else if (typeof where === "string") document.querySelector(where)?.scrollIntoView({ block: "start" });
    else c.scrollTop = where;
  }, where);
  await p.waitForTimeout(300);
}
export async function openJournalAch(p, id = "exhibition") {
  await p.evaluate(() => {
    const g = document.querySelector(".goals");
    if (g?.classList.contains("collapsed")) document.querySelector(".goals-top > button")?.click();
  });
  await p.waitForTimeout(500);
  await p.evaluate(() => [...document.querySelectorAll(".goals-tabs button")].find((b) => b.textContent.includes("🥇"))?.click());
  await p.waitForTimeout(400);
  await p.evaluate((id) => document.querySelector(`.ach-row[data-id="${id}"]`)?.click(), id);
  await p.waitForTimeout(500);
}

