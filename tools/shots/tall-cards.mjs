// Tall cards at every size (`node tools/shots/tall-cards.mjs [<out>]`): a Game-mode workshop with everything learned
// (its making list at its longest), a town's card and a school's, opened at 1440×900, 1280×720, 1920×1080,
// 2000×1165, 390×844 and 844×390; a picture of each, and the card's box against the HUD's and the tray's: its head
// (title, ✕) in view, nothing under the top bar, the goals or the tray's tabs, the body scrolling inside; 44 px
// targets on phones; 0 frames drawn while it's open. Exits 1 on a failure.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/tall-cards";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5390, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const SIZES = (process.env.SIZES ?? "1440x900,1280x720,1920x1080,2000x1165,390x844,844x390").split(",");
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
for (const size of SIZES) {
  const [W, H] = size.split("x").map(Number);
  const phone = W < 700 || H < 520;
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.evaluate(() => Promise.race([window.woodrail.trayThumbnailsSaved(), new Promise((r) => setTimeout(r, 120000))]));
  await p.keyboard.press("Escape");
  // Setup shortcut (not what's tested): everything learned, so the workshop's making list is as long as it gets; a
  // workshop and a school placed by the second town as e2e:workshop does, with goods in the workshop's piles.
  const ids = await p.evaluate(async () => {
    const w = window.woodrail;
    const { TECHS } = await import("/src/game/tech.ts");
    for (const t of TECHS) {
      try { w.learn(t.id); } catch {}
    }
    const s1 = w.world.layout.getPiece(w.world.stations.get(w.world.landscape.towns[1].id)).pose;
    w.editor().place("depot-workshop", { x: Math.round(s1.x / 18) * 18, z: Math.round((s1.z + 500) / 18) * 18, heading: 0 }, 0, false);
    w.editor().place("depot-school", { x: Math.round((s1.x + 400) / 18) * 18, z: Math.round((s1.z - 500) / 18) * 18, heading: 0 }, 0, false);
    w.invalidate();
    const shop = w.economy.allDepots().find((d) => d.role === "workshop");
    if (shop?.piles) for (const k of Object.keys(shop.piles)) shop.piles[k] = 5;
    return { shop: shop?.id ?? null, school: w.economy.allDepots().find((d) => d.role === "school")?.id ?? null, town: w.world.economy.depotAtPiece(w.world.stations.get(w.world.landscape.towns[0].id))?.id ?? null };
  });
  const cards = [["workshop", ids.shop], ["school", ids.school], ["town", ids.town]];
  for (const [name, id] of cards) {
    if (!id) {
      check(`${size} ${name}: placed`, false);
      continue;
    }
    await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), id);
    await p.waitForTimeout(800);
    await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
    // (Measured once it has popped in: `card-in` scales it from 0.96, and a 44 px chip reads 42 mid-way.)
    await p.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
    const m = await p.evaluate(() => {
      const card = [...document.querySelectorAll(".card")].find((c) => !c.hidden && c.getBoundingClientRect().height > 0);
      if (!card) return null;
      const r = (el) => {
        if (!el || el.hidden) return null;
        const b = el.getBoundingClientRect();
        return b.width > 0 ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null;
      };
      const title = card.querySelector(":scope > .card-title");
      const close = card.querySelector(":scope > .close");
      const hudTop = [".brand", ".actions", ".goals"].map((s) => r(document.querySelector(s))).filter(Boolean);
      const tray = r(document.querySelector(".tray"));
      const small = [...card.querySelectorAll("button, .chip")].filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && !e.closest("[hidden]") && (b.height < 43.5 || b.width < 43.5);
      }).map((e) => `${(e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 18)} ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`);
      return { card: r(card), title: r(title), close: r(close), hudTop, tray, scrolls: card.scrollHeight > card.clientHeight + 1, small };
    });
    await p.screenshot({ path: `${OUT}/${size}-${name}.png` });
    if (!m) {
      check(`${size} ${name}: card open`, false);
      continue;
    }
    const overlaps = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    check(`${size} ${name}: inside the window`, m.card.top >= 0 && m.card.bottom <= H, JSON.stringify(m.card));
    check(`${size} ${name}: title and ✕ in view in the card`, m.title && m.close && m.title.top >= m.card.top - 1 && m.close.top >= m.card.top - 1, JSON.stringify({ t: m.title, c: m.close }));
    // (Over the tray is fine only on a phone on its side, where the card docks at the right and comes down over it.)
    if (!(H < 520)) check(`${size} ${name}: clear of the tray`, !m.tray || m.card.bottom <= m.tray.top + 1, `${Math.round(m.card.bottom)} vs ${m.tray && Math.round(m.tray.top)}`);
    // (On a phone on its side the card is over the goals bar by design, QA 667×375: the top bar's buttons only.)
    const hud = H < 520 ? m.hudTop.slice(0, 2) : m.hudTop;
    check(`${size} ${name}: clear of the HUD's top bar${H < 520 ? "" : " and goals"}`, !hud.some((h) => overlaps(h, m.card)), JSON.stringify(hud.map((h) => Math.round(h.bottom))) + ` card top ${Math.round(m.card.top)}`);
    if (phone) check(`${size} ${name}: 44 px targets`, m.small.length === 0, m.small.slice(0, 6).join(", "));
    const frames = await p.evaluate(async () => {
      // (Paused: a town's waiting count changing on the map draws a frame, as it should; the card alone draws none.)
      window.woodrail.paused = true;
      await new Promise((r) => setTimeout(r, 500));
      const f0 = window.woodrail.framesDrawn;
      await new Promise((r) => setTimeout(r, 2000));
      const f1 = window.woodrail.framesDrawn;
      await new Promise((r) => setTimeout(r, 2000));
      window.woodrail.paused = false;
      return `${f1 - f0},${window.woodrail.framesDrawn - f1}`;
    });
    check(`${size} ${name}: 0 idle frames while open (the 2 s after it settled, then 2 s more)`, frames === "0,0", frames);
    // Scrolled to its foot: the head still there.
    const head = await p.evaluate(() => {
      const card = [...document.querySelectorAll(".card")].find((c) => !c.hidden && c.getBoundingClientRect().height > 0);
      card.scrollTop = card.scrollHeight;
      const cr = card.getBoundingClientRect();
      const t = card.querySelector(":scope > .card-title").getBoundingClientRect();
      const x = card.querySelector(":scope > .close").getBoundingClientRect();
      return { ok: t.top >= cr.top - 1 && t.bottom <= cr.bottom && x.top >= cr.top - 1, t: t.top, c: cr.top, scrolled: card.scrollTop };
    });
    if (m.scrolls) {
      await p.screenshot({ path: `${OUT}/${size}-${name}-scrolled.png` });
      check(`${size} ${name}: head stays when the body scrolls`, head.ok, JSON.stringify(head));
    }
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
  }
  await p.close();
}
await b.close();
await server.close();
console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
