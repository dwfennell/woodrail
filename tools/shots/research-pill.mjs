// Pictures of the research pill in the top bar (`node tools/shots/research-pill.mjs <out dir> [tag]`): Mills under way
// (6 planks, 6 grain; its 40 coins paid) at 390×844 and 1440×900, then the same with a third good added in the page
// (iron, as no blueprint needs three yet) at 360 and 390. Crops the top bar. Starts its own dev server.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/pill-shots";
const TAG = process.argv[3] ?? "after";
const THREE = process.argv.includes("--three");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function at(width, height, three) {
  const phone = width < 700;
  const p = await b.newPage({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, hasTouch: phone, isMobile: phone });
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.keyboard.press("Escape");
  const pill = await p.evaluate(async (three) => {
    const { play } = await import("/src/play/player.ts");
    const { rulesFor, schoolOn } = await import("/src/play/rules.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    const { techOf } = await import("/src/game/tech.ts");
    const w = window.woodrail;
    const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
    play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
    schoolOn(w.world, w.editor(), new Set());
    // (Setup shortcut, not the thing pictured: what Mills needs learned, and the coins to start it.)
    for (const id of ["switches", "farming", "bridges", "signals"]) if (!w.progress().learned.has(id)) w.learn(id);
    if (three) techOf("mills").research.goods.iron = 10;
    const pr = w.progress();
    pr.coins += 100;
    const r = await import("/src/game/research.ts");
    (r.toggleQueue ?? r.pick)(pr, "mills");
    pr.research.version++;
    w.invalidate();
    return pr.research.current;
  }, three);
  await p.waitForTimeout(2500);
  await p.waitForFunction(() => !document.querySelector(".research-pill")?.hidden, null, { timeout: 10000 }).catch(() => {});
  const text = await p.evaluate(() => document.querySelector(".research-pill")?.textContent);
  const clip = { x: 0, y: 0, width: Math.min(width, phone ? width : 900), height: phone ? 64 : 64 };
  const name = `research-pill-${TAG}-${width}${three ? "-three" : ""}`;
  await p.screenshot({ path: `${OUT}/${name}.png`, clip });
  console.log(name, pill, JSON.stringify(text));
  await p.close();
}
await at(390, 844, THREE);
await at(THREE ? 360 : 1440, THREE ? 740 : 900, THREE);
await b.close();
await server.close();
