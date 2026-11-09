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
// A direction built on another: its sheets in order.
const THEME_FILES = { "toybox-plus": ["toybox", "toybox-plus"] };
FONTS["toybox-plus"] = FONTS.toybox;
const SIZE = process.env.DESKTOP ? "desktop-" : "";
// A+ proposes a new drawing for Clear (the sponge read as a yellow block): a school eraser, pink and blue, in the
// icon font's style (24 px box, ink outline drawn under the shapes). Swapped into the button for the mock only.
const ERASER = `<svg class="hw-eraser" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(-30 12 12)"><rect x="2.4" y="7.4" width="19.2" height="9.2" rx="2.2" fill="#3a2a1c"/><rect x="3.6" y="8.6" width="9" height="6.8" rx="1.2" fill="#e8798a"/><rect x="12.6" y="8.6" width="7.8" height="6.8" rx="1.2" fill="#3f78c4"/><rect x="4.4" y="9.3" width="7.4" height="1.4" rx=".7" fill="#f6b3bd"/><rect x="13.3" y="9.3" width="6.4" height="1.4" rx=".7" fill="#8fb3e6"/></g><circle cx="5" cy="20.5" r="1.1" fill="#3a2a1c"/><circle cx="8.6" cy="21.4" r=".9" fill="#3a2a1c"/></svg>`;
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function theme(p, name) {
  await p.evaluate(() => {
    document.querySelectorAll(".hw-theme").forEach((e) => e.remove());
    document.querySelectorAll("[data-hw-was]").forEach((e) => { e.innerHTML = e.dataset.hwWas; delete e.dataset.hwWas; });
  });
  if (name === "today") return;
  if (name === "toybox-plus") await p.evaluate((svg) => document.querySelectorAll(".tray-erase").forEach((b) => { b.dataset.hwWas = b.innerHTML; b.innerHTML = b.innerHTML.replace("🧽", svg); }), ERASER);
  if (FONTS[name]) await p.addStyleTag({ url: FONTS[name] }).then((h) => h.evaluate((e) => e.classList.add("hw-theme")));
  // The grain is one 256 px tile (grain.webp, 2.5 kB, from grain.py), inlined so the injected sheet can reach it.
  const grain = `url(data:image/webp;base64,${readFileSync(`${DIR}grain.webp`).toString("base64")})`;
  const css = (THEME_FILES[name] ?? [name]).map((f) => readFileSync(`${DIR}themes/${f}.css`, "utf8")).join("\n").replaceAll("url(grain.webp)", grain);
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
      name: `hud-wood-${t}-${SIZE}${screen}`,
      async run(p, s) {
        await theme(p, t);
        await fn(p, s);
        // The game's own toasts (a research learned, a train arriving) can come at any moment; hidden on the other
        // screens so each shows only what it's for.
        if (screen !== "toast") await p.addStyleTag({ content: ".toast { visibility: hidden !important; }" }).then((h) => h.evaluate((e) => e.classList.add("hw-theme")));
        await frames(p);
      },
    });
  }
}
out.push({ name: "zz-done", async run(p) { await theme(p, "today"); } });
export default out;
