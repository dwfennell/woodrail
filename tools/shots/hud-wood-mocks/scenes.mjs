// The HUD wood proposals: the real game's HUD, re-skinned by one stylesheet per direction (themes/*.css), the same
// four screens for each: the main view with the tray open, the ☰ menu, a train card, a toast with the goals chip.
// THEMES=today,toybox,workshop,enamel picks which; nothing here changes the game, it only adds a <style> to the page.
import { readFileSync } from "node:fs";

const DIR = new URL(".", import.meta.url).pathname;
const THEMES = (process.env.THEMES ?? "today,toybox,workshop,enamel,picturebook").split(",");
const FONTS = {
  toybox: "https://fonts.googleapis.com/css2?family=Lilita+One&display=block",
  workshop: "https://fonts.googleapis.com/css2?family=Bitter:wght@600;700;800&family=Stardos+Stencil:wght@700&display=block",
  picturebook: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700;12..96,800&display=block",
  enamel: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@600;700&display=block",
};
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function theme(p, name) {
  await p.evaluate(() => document.querySelectorAll(".hw-theme").forEach((e) => e.remove()));
  if (name === "today") return;
  if (FONTS[name]) await p.addStyleTag({ url: FONTS[name] }).then((h) => h.evaluate((e) => e.classList.add("hw-theme")));
  // The grain is one 256 px tile (grain.webp, 2.5 kB, from grain.py), inlined so the injected sheet can reach it.
  const grain = `url(data:image/webp;base64,${readFileSync(`${DIR}grain.webp`).toString("base64")})`;
  const css = readFileSync(`${DIR}themes/${name}.css`, "utf8").replaceAll("url(grain.webp)", grain);
  await p.addStyleTag({ content: css }).then((h) => h.evaluate((e) => e.classList.add("hw-theme")));
  await p.evaluate(() => document.fonts.ready);
}
async function reset(p) {
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
  await p.keyboard.press("Escape");
  await p.evaluate(() => {
    const m = document.querySelector(".menu");
    if (m && !m.hidden && m.offsetParent) document.querySelector('button[aria-label="Menu"]')?.click();
    document.querySelectorAll(".toast").forEach((t) => t.classList.remove("show"));
  });
  await p.waitForTimeout(400);
}
async function lookOval(p, dist) {
  await p.evaluate((dist) => {
    const w = window.woodrail;
    const ps = window.__mock.places.map((d) => w.layout.getPiece(w.economy.depot(d).pieceId).pose);
    const x = ps.reduce((a, q) => a + q.x, 0) / ps.length, z = ps.reduce((a, q) => a + q.z, 0) / ps.length;
    w.director.glideTo(new w.controls.target.constructor(x, 0, z), dist, { duration: 0.1 });
  }, dist);
  await p.waitForTimeout(900);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
}
async function tab(p, label) {
  await p.evaluate((label) => [...document.querySelectorAll(".tray .tab")].find((t) => t.textContent.includes(label))?.click(), label);
  await p.waitForTimeout(300);
}

const SCREENS = {
  async tray(p) {
    await reset(p);
    await lookOval(p, 2600);
    await tab(p, "Track");
  },
  async menu(p) {
    await reset(p);
    await lookOval(p, 2600);
    await p.evaluate(() => document.querySelector('button[aria-label="Menu"]').click());
    await p.waitForTimeout(500);
  },
  async card(p, s) {
    await reset(p);
    await lookOval(p, 1500);
    await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), s.engines[0]);
    await p.waitForTimeout(1300);
    await p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.classList.remove("show")));
  },
  async toast(p) {
    await reset(p);
    await lookOval(p, 2600);
    // The game's own toast element, set as hud.toast(…, celebrate) leaves it (set directly: the queue keeps one
    // message at a time, and each direction needs the same one).
    await p.evaluate(() => {
      const t = document.querySelector(".toast");
      t.textContent = "Goal done: Carry 10 planks to the workshop";
      t.className = "toast celebrate show";
    });
    await p.waitForTimeout(900);
  },
};

const out = [];
for (const t of THEMES) {
  for (const [screen, fn] of Object.entries(SCREENS)) {
    out.push({
      name: `hud-wood-${t}-${screen}`,
      async run(p, s) {
        await theme(p, t);
        await fn(p, s);
        if (screen !== "toast") await p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.classList.remove("show")));
        await frames(p);
      },
    });
  }
}
out.push({ name: "zz-done", async run(p) { await theme(p, "today"); } });
export default out;
