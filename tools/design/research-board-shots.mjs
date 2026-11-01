// Pictures of the Research board in a mid-game state, for design work (`node tools/design/research-board-shots.mjs <out dir>`).
// A new game's line laid and school placed (as e2e:research does), then a mid-game set of blueprints learned and a
// research under way with one queued (a setup shortcut: what's drawn is under review, not how it was reached). Shots at
// 390×844 and 844×390 (touch) and 1440×900: the board as it opens, scrolled through, and a ticket of each state.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/tree";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const LEARNED = ["switches", "bridges", "signals", "tank", "brake-vans", "harvesters", "farming", "cranes1", "routes", "study-hall", "loading-kits", "junctions"];

async function run(name, viewport, mobile) {
  const p = await b.newPage({ viewport, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  // (Toasts hidden for the pictures: "Learned X!" from the setup would sit over the board's head.)
  await p.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.head.insertAdjacentHTML("beforeend", "<style>.toast, .toasts { display: none !important; }</style>")));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.keyboard.press("Escape");
  await p.evaluate(async (LEARNED) => {
    const { play } = await import("/src/play/player.ts");
    const { rulesFor, schoolOn } = await import("/src/play/rules.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    const { toggleQueue } = await import("/src/game/research.ts");
    const w = window.woodrail;
    const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
    play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
    schoolOn(w.world, w.editor(), new Set());
    for (const id of LEARNED) w.learn(id);
    const pr = w.progress();
    pr.coins = Math.max(pr.coins, 300);
    toggleQueue(pr, "mills");
    toggleQueue(pr, "passengers");
    pr.research.got = { planks: 4, grain: 2 };
    w.invalidate();
  }, LEARNED);
  await p.waitForTimeout(800);
  // Open the board from the top bar (the pill when it shows, else the Research chip).
  await p.evaluate(() => {
    const pill = document.querySelector(".research-pill");
    (pill && !pill.hidden ? pill : document.querySelector(".research-btn")).click();
  });
  await p.waitForSelector(".board-panel:not([hidden]) .bp-node", { timeout: 20000 });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/${name}-open.png` });
  // Scroll the web (or the lists) to the end, a picture each way.
  await p.evaluate(() => {
    const s = document.querySelector(".bp-web-scroll") ?? document.querySelector(".board-body");
    s.scrollTop = s.scrollHeight;
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}-scrolled.png` });
  for (const [label, state] of [["Dairy farm", "soon"], ["Passengers", "next"], ["Sawmills", "ready"], ["Harvesters II", "locked"]]) {
    const ok = await p.evaluate((label) => {
      const el = [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === label);
      if (!el) return false;
      el.scrollIntoView({ block: "center", inline: "center" });
      el.click();
      return true;
    }, label);
    if (!ok) continue;
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${OUT}/${name}-${state}.png` });
  }
  // A research finishing with the board open: Mills learned (as the school's study ending calls it), mid-stamp and after.
  await p.evaluate(() => {
    const el = document.querySelector('.board-body .bp-node[data-id="mills"]');
    el?.scrollIntoView({ block: "center", inline: "center" });
    window.woodrail.learn("mills");
  });
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${name}-learned-mid.png` });
  await p.waitForTimeout(1300);
  await p.screenshot({ path: `${OUT}/${name}-learned.png` });
  // Tag heights on the web (the arrows meet them at 24 px), the "?"s' offsets in their slots, and each band name's room.
  const fit = await p.evaluate(() => ({
    heights: Object.entries(Object.groupBy([...document.querySelectorAll(".bp-web .bp-node:not(.hint)")], (n) => n.offsetHeight)).map(([h, ns]) => `${h}: ${ns.slice(0, 3).map((n) => n.className.split(" ")[1] + " " + n.querySelector(".bp-name").textContent).join(", ")}`),
    hints: [...new Set([...document.querySelectorAll(".bp-web .bp-node.hint")].map((n) => `${n.offsetLeft % 176}/${n.offsetTop}`))].length,
    bandRoom: [...document.querySelectorAll(".bp-band, .bp-list-band")].slice(0, 4).map((b) => {
      const l = b.querySelector(".bp-band-label").getBoundingClientRect();
      const first = [...b.parentElement.querySelectorAll(".bp-node")].map((n) => n.getBoundingClientRect()).filter((r) => r.top >= l.bottom - 1).sort((u, v) => u.top - v.top)[0];
      return first ? [Math.round(l.top - b.getBoundingClientRect().top), Math.round(first.top - l.bottom)] : null;
    }),
  }));
  console.log(name, "fit:", JSON.stringify(fit));
  const sizes = await p.evaluate(() => {
    const small = [...document.querySelectorAll(".board-panel button, .board-panel summary")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => [e.textContent.trim().slice(0, 20), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)]).filter(([, w, h]) => w < 44 || h < 44);
    return small;
  });
  console.log(name, "small targets:", JSON.stringify(sizes), errors.length ? `errors: ${errors.join(" | ")}` : "");
  await p.close();
}

await Promise.all([run("phone", { width: 390, height: 844 }, true), run("side", { width: 844, height: 390 }, true), run("desktop", { width: 1440, height: 900 }, false)]);
await b.close();
await server.close();
