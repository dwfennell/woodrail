// End-to-end: the workshop's plank choice on a phone (`npm run e2e:workshop [-- <out dir>]`), at 390×844 with touch:
// - its card shows Shares with towns (on) / Takes all planks, with a line under them;
// - a tap on Takes all planks switches it (the line says so) and draws no frames of the map (only the card changes);
// - it's still Takes all planks after a reload; a tap on Shares with towns switches it back.
//
// Usage: npm run e2e:workshop [-- <out dir>]   (default out: e2e-out/workshop)
// Starts its own dev server (on 5384, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/workshop";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5384, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const enterGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
};
const tap = async (selector) => {
  const box = await p.evaluate((selector) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!box) return false;
  await p.touchscreen.tap(box.x, box.y);
  await p.waitForTimeout(400);
  return true;
};
let shop = null;
/** The card's choice now: which chip is on, the line under it, and the workshop's setting. */
const card = () =>
  p.evaluate(
    (id) => ({
      on: document.querySelector(".yard-mode .chip.active")?.textContent ?? null,
      chips: [...document.querySelectorAll(".yard-mode .chip")].map((c) => c.textContent),
      hint: document.querySelector(".yard-hint")?.textContent ?? null,
      takesAll: window.woodrail.economy.depot(id)?.takesAll,
    }),
    shop,
  );
const openCard = async () => {
  await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), shop);
  await p.waitForFunction(() => !!document.querySelector(".yard-mode"), null, { timeout: 15000 }).catch(() => {});
  await settle();
};
const SHARES_HINT = "Leaves planks for towns further on, keeping 7 for you";
const ALL_HINT = "Fills its yard first, up to 30";

await p.goto(PAGE);
await enterGame();
// A workshop by the second town's station.
shop = await p.evaluate(() => {
  const w = window.woodrail;
  const s1 = w.world.layout.getPiece(w.world.stations.get(w.world.landscape.towns[1].id)).pose;
  w.editor().place("depot-workshop", { x: Math.round(s1.x / 18) * 18, z: Math.round((s1.z + 500) / 18) * 18, heading: 0 }, 0, false);
  w.invalidate();
  return w.economy.allDepots().find((d) => d.role === "workshop")?.id ?? null;
});
check("a workshop placed", shop !== null, String(shop));
await openCard();
let c = await card();
check("its card: Shares with towns (on) / Takes all planks", c.on === "Shares with towns" && JSON.stringify(c.chips) === JSON.stringify(["Shares with towns", "Takes all planks"]) && c.takesAll === false, JSON.stringify(c));
check("…the line under it", c.hint === SHARES_HINT, String(c.hint));
await shot("01-shares-with-towns");

// Takes all planks: only the card changes. The map isn't drawn again for it (no `invalidate`); a touch anywhere wakes
// the loop for a frame or two all the same, as a tap on the line under the choice does (counted to compare).
const tapFrames = async (selector) => {
  const f0 = await p.evaluate(() => {
    const w = window.woodrail;
    window.__inval = 0;
    if (!w.__counting) {
      const inv = w.invalidate.bind(w);
      w.invalidate = () => {
        window.__inval++;
        inv();
      };
      w.__counting = true;
    }
    return w.framesDrawn;
  });
  await tap(selector);
  await p.waitForTimeout(1500);
  return p.evaluate((f0) => ({ frames: window.woodrail.framesDrawn - f0, invalidates: window.__inval }), f0);
};
const plain = await tapFrames(".yard-hint");
const toggled = await tapFrames('.yard-mode [data-yard="all"]');
c = await card();
check("a tap on Takes all planks switches it", c.on === "Takes all planks" && c.takesAll === true, JSON.stringify(c));
check("…the line under it", c.hint === ALL_HINT, String(c.hint));
check("…and the map isn't drawn again for it (no invalidate; frames no more than a plain tap's)", toggled.invalidates === 0 && toggled.frames <= Math.max(plain.frames, 2), JSON.stringify({ plain, toggled }));
await shot("02-takes-all-planks");

// Saved: still Takes all planks after a reload.
await p.waitForTimeout(2500);
await p.reload();
await enterGame();
shop = await p.evaluate(() => window.woodrail.economy.allDepots().find((d) => d.role === "workshop")?.id ?? null);
await openCard();
c = await card();
check("after a reload it still takes all planks", c.on === "Takes all planks" && c.takesAll === true && c.hint === ALL_HINT, JSON.stringify(c));
await tap('.yard-mode [data-yard="share"]');
c = await card();
check("a tap on Shares with towns switches it back", c.on === "Shares with towns" && c.takesAll === false && c.hint === SHARES_HINT, JSON.stringify(c));

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
