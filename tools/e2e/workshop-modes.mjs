// End-to-end: the workshop's plank choice on a phone (`npm run e2e:workshop [-- <out dir>]`), at 390×844 with touch:
// - its card shows Shares with towns (on) / Takes all planks, with a line under them;
// - a tap on Takes all planks switches it (the line says so) and draws no frames of the map (only the card changes);
// - it's still Takes all planks after a reload; a tap on Shares with towns switches it back;
// - with a school placed, Takes all's line is the same (nothing is held back for the school); both fit at 360 and 390 px;
// - the school's card has a choice too, Shares with towns (on) / Research first: a tap switches it, kept on reload, and the
//   workshop's Takes all line then says the school comes first;
// - the card says how planks get there (a train on a route drops them only if the workshop is one of its stops).
//
// Usage: npm run e2e:workshop [-- <out dir>]   (default out: e2e-out/workshop)
// Starts its own dev server (on 5384, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/workshop";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5384, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks held still: this counts idle frames, and a clock in view draws one at each minute; e2e:station-clock tests that.)
pinClocksIn(b);
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
  const box = await p.evaluate(async (selector) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    // (Aimed once its card has popped in: `card-in` scales the card from 0.96, so a box read mid-way, as under
    // SwiftShader at 360 px it was, puts the tap off the chip's middle: the flaky "Takes all planks" tap. mobile-ux.md.)
    const card = el.closest(".card, .depot-card") ?? el;
    await Promise.race([Promise.all(card.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 3000))]);
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
      help: ((h) => (h && !h.hidden && h.getBoundingClientRect().height > 0 ? h.textContent : null))(document.querySelector(".depot-card .depot-help")),
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
const SHOP_HELP = "Trains drop planks here as they pass. On a route, add the workshop as a stop";

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
check("…and how planks get there", c.help === SHOP_HELP, String(c.help));
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

// A school on the map: Takes all's line is unchanged (no hidden priority for the school). Both fit, at 390 and 360 px.
let school = await p.evaluate(() => {
  const w = window.woodrail;
  const s1 = w.world.layout.getPiece(w.world.stations.get(w.world.landscape.towns[1].id)).pose;
  w.editor().place("depot-school", { x: Math.round(s1.x / 18) * 18, z: Math.round((s1.z + 1000) / 18) * 18, heading: 0 }, 0, false);
  w.invalidate();
  return w.economy.allDepots().find((d) => d.role === "school")?.id ?? null;
});
check("a school placed", school !== null);
const fits = () =>
  p.evaluate(() => {
    const card = document.querySelector(".depot-card").getBoundingClientRect();
    const chips = [...document.querySelectorAll(".yard-mode .chip")];
    const auto = document.querySelector(".depot-card .card-row").getBoundingClientRect();
    const mode = document.querySelector(".yard-mode").getBoundingClientRect();
    return {
      inView: card.left >= 0 && card.right <= innerWidth,
      chipsFit: chips.every((c) => c.scrollWidth <= c.clientWidth + 1),
      gap: Math.round(mode.top - auto.bottom),
      hintLines: Math.round(document.querySelector(".yard-hint").getBoundingClientRect().height / 15),
    };
  });
for (const width of [390, 360]) {
  await p.setViewportSize({ width, height: 844 });
  for (const mode of ["share", "all"]) {
    await openCard();
    await tap(`.yard-mode [data-yard="${mode}"]`);
    c = await card();
    const f = await fits();
    const want = mode === "all" ? ALL_HINT : SHARES_HINT;
    check(`${width} px, ${c.on}: its line`, c.hint === want, String(c.hint));
    check(`${width} px, ${c.on}: how planks get there`, c.help === SHOP_HELP, String(c.help));
    check(`${width} px, ${c.on}: the card in view, chips unclipped, clear of the Automatic row`, f.inView && f.chipsFit && f.gap >= 14, JSON.stringify(f));
    await shot(`${width}-${mode === "all" ? "takes-all" : "shares"}`);
  }
}

// The school's card: the same two-way choice, by taps; its setting is the school's depot's, and kept on reload.
const schoolCard = () =>
  p.evaluate(
    (id) => ({
      on: document.querySelector(".depot-card .yard-mode .chip.active")?.textContent ?? null,
      chips: [...document.querySelectorAll(".depot-card .yard-mode .chip")].map((c) => c.textContent),
      hint: document.querySelector(".depot-card .yard-hint")?.textContent ?? null,
      takesAll: window.woodrail.economy.depot(id)?.takesAll,
    }),
    school,
  );
const openSchool = async () => {
  await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), school);
  await p.waitForFunction(() => !!document.querySelector(".depot-card [data-school]"), null, { timeout: 15000 }).catch(() => {});
  await settle();
};
await p.setViewportSize({ width: 390, height: 844 });
await openSchool();
let sc = await schoolCard();
check("the school's card: Shares with towns (on) / Research first", sc.on === "Shares with towns" && JSON.stringify(sc.chips) === JSON.stringify(["Shares with towns", "Research first"]) && sc.takesAll === false, JSON.stringify(sc));
check("…its line", sc.hint === "Trains drop goods at each stop in turn; here, a share when a town further on wants them too", String(sc.hint));
await tap('.depot-card [data-school="first"]');
sc = await schoolCard();
check("a tap on Research first switches it", sc.on === "Research first" && sc.takesAll === true && sc.hint === "Trains keep what its research needs for it, past towns and the workshop. On a route, up to one wagon", JSON.stringify(sc));
await shot("school-research-first");
await openCard();
await tap('.yard-mode [data-yard="all"]');
c = await card();
check("…and the workshop's Takes all line says so", c.on === "Takes all planks" && c.hint === `${ALL_HINT}, after your school's research (it's set to Research first)`, JSON.stringify(c));
await p.waitForTimeout(2500);
await p.reload();
await enterGame();
school = await p.evaluate(() => window.woodrail.economy.allDepots().find((d) => d.role === "school")?.id ?? null);
await openSchool();
sc = await schoolCard();
check("after a reload the school is still Research first", sc.on === "Research first" && sc.takesAll === true, JSON.stringify(sc));
await tap('.depot-card [data-school="share"]');
sc = await schoolCard();
check("a tap on Shares with towns switches it back", sc.on === "Shares with towns" && sc.takesAll === false, JSON.stringify(sc));

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
