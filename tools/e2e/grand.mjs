// End-to-end grand projects as achievements in Game mode (`npm run e2e:grand [-- <out dir>]`), on a phone at 390×844
// with touch (spec 2026-11-05-character-and-goals.md, "Grand projects are achievements with a reward"):
//  1. Larkfield a City ★ and the other towns smaller (deliveries written as trains would bring them: a setup shortcut,
//     as e2e:civic). The Journal has an Achievements tab (🥇): the Great Exhibition, its reward said before it starts.
//  2. Larkfield's card has Grand projects: a tap on Build pays its coins, and its plot goes up on clear land by the
//     city (a prop of the map). The tab says stage 1 of 4, in Larkfield.
//  3. Each stage's goods by train to Larkfield's station (wagons standing at its crane): each stage moves the project
//     on, its site's model swapped (foundations, the iron hall, the stands, opening day), the goods not paid for or
//     counted toward growth. A picture of each stage.
//  4. The payoff: finished, it's earned (✓ in the tab, a sticker), and every town grows a step: the smaller towns a
//     level each, Larkfield a quarter of its next star.
//  5. 0 frames idle with the finished hall in view; then a reload: the hall, the achievement and the growth all kept.
//  6. The Royal Train in a second City ★, by taps and trains: finished, it's given into the toy box (its tray tile).
//  7. The Cathedral in a third, glass among its goods: finished, every town needs a tenth fewer goods to grow.
//  8. The World's Fair wheel in a fourth: finished, a month on its tickets pay 60 coins. Four achievements earned.
//  9. Grand Central from Larkfield's card: its kit in the toy box, dragged from the tray onto the map by Larkfield (one of
//     its stops), its stages by train (and riders through it), the kit on the map moving on each stage; earned.
//
// Usage: npm run e2e:grand [-- <out dir>]   (default out: e2e-out/grand)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/grand";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5402, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks held still: this counts idle frames, and a clock in view draws one at each minute.)
pinClocksIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
let checks = 0;
const check = (what, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.jpg`, type: "jpeg", quality: 82, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

/** Tap the middle of the first visible element matching `selector` (scrolled into view first). */
const tap = async (selector) => {
  const at = await p.evaluate((selector) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    return true;
  }, selector);
  if (!at) return false;
  await p.waitForTimeout(250);
  const again = await p.evaluate((selector) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  await p.touchscreen.tap(again.x, again.y);
  await p.waitForTimeout(600);
  return true;
};

const openGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
};

/** Close whatever a growth put up (its reward cards). */
const closeSheets = () => p.evaluate(() => document.querySelectorAll(".growth-sheet:not([hidden]) .close").forEach((x) => x.click()));

await p.goto(PAGE);
await openGame();

// ---- 1. Larkfield a City ★; the Journal's Achievements tab --------------------------------------------------------
const town = await p.evaluate(() => {
  const w = window.woodrail;
  const t = w.world.landscape.towns[0];
  return { id: t.id, name: t.name, station: w.world.stations.get(t.id), depot: w.world.economy.depotAtPiece(w.world.stations.get(t.id)).id };
});
for (let level = 1; level <= 4; level++) {
  await p.evaluate(
    async ({ level, id }) => {
      const { townLevel } = await import("/src/game/towns.ts");
      const w = window.woodrail;
      const bag = {};
      for (let k = 0; k < level; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n;
      w.economy.delivered.set(id, bag.planks ?? 0);
      w.economy.deliveredGoods.set(id, bag);
      w.invalidate();
    },
    { level, id: town.id },
  );
  await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 30000 }).catch(() => console.log(`(level ${level} not seen)`));
  await p.waitForTimeout(1000);
  await closeSheets();
}
await p.evaluate(() => {
  const w = window.woodrail;
  const pr = w.progress();
  pr.coins = 1000;
  w.hud.setCoins(pr.coins);
});
await p.waitForTimeout(1500);
await p.keyboard.press("Escape");
const levels = () =>
  p.evaluate(async () => {
    const { statusOf } = await import("/src/game/town-life.ts");
    const w = window.woodrail;
    return w.world.landscape.towns.map((t) => ({ id: t.id, level: statusOf(w.world, t.id).level, fill: statusOf(w.world, t.id).fill }));
  });
const levels0 = await levels();
check("1. Larkfield is a City ★", levels0.find((t) => t.id === town.id)?.level === 4, JSON.stringify(levels0));

// The Journal: open it, then its 🥇 tab.
const openJournal = async () => {
  if (await p.evaluate(() => document.querySelector(".goals")?.classList.contains("collapsed"))) await tap(".goals-top > button");
};
await openJournal();
const tabShown = await p.evaluate(() => [...document.querySelectorAll(".goals-tab")].some((t) => t.getAttribute("aria-label") === "Achievements" && !t.hidden));
check("1. the Journal has an Achievements tab", tabShown);
await tap('.goals-tab[aria-label="Achievements"]');
const row = () => p.evaluate(() => {
  const r = document.querySelector('.ach-row[data-id="exhibition"]');
  return r ? { text: r.textContent, got: r.closest(".ach-item").classList.contains("got"), pips: r.querySelector(".ach-pips")?.textContent } : null;
});
const r1 = await row();
check("1. it lists the Great Exhibition with its reward, to start from a City ★'s card", !!r1 && /Great Exhibition/.test(r1.text) && /Every town grows a step/.test(r1.text) && /City ★'s card/.test(r1.text), JSON.stringify(r1));
const tabsFit = await p.evaluate(() => {
  const tabs = document.querySelector(".goals-tabs").getBoundingClientRect();
  return [...document.querySelectorAll(".goals-tabs > *")].filter((e) => !e.hidden).every((e) => e.getBoundingClientRect().right <= tabs.right + 1 && e.getBoundingClientRect().height >= 40);
});
check("1. the Journal's tabs fit at 390 px, 44 px tall", tabsFit);
await tap('.ach-row[data-id="exhibition"]');
check("1. a tap on it shows its four stages and their goods", (await p.evaluate(() => document.querySelectorAll(".ach-item.open .ach-stages li").length)) === 4);
await shot("1-achievements");
await p.evaluate(() => document.querySelector(".goals-close")?.click());

// ---- 2. Build it from Larkfield's card ----------------------------------------------------------------------------
const openCard = () => p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), town.depot);
await openCard();
await p.waitForTimeout(900);
const tileState = () => p.evaluate(() => [...(document.querySelector('.grand-tile[data-grand="exhibition"]')?.classList ?? [])].find((c) => !["place-tile", "grand-tile"].includes(c)) ?? null);
check("2. Larkfield's card offers the Great Exhibition", (await tileState()) === "build", String(await tileState()));
await shot("2-card");
const coins0 = await p.evaluate(() => window.woodrail.progress().coins);
await tap('.grand-tile[data-grand="exhibition"] .place-btn');
await p.waitForFunction(() => window.woodrail.world.economy.grandPlans.has("exhibition"), null, { timeout: 30000 }).catch(() => {});
const started = await p.evaluate(() => {
  const w = window.woodrail;
  const plan = w.world.economy.grandPlans.get("exhibition");
  const prop = plan ? w.world.props.get(plan.prop) : null;
  return { plan: plan ? { ...plan } : null, prop: prop ? { asset: prop.asset, x: prop.x, z: prop.z, scale: prop.scale } : null, coins: w.progress().coins };
});
check("2. Build: it's under way in Larkfield, its 400 coins paid", started.plan?.townId === town.id && started.plan?.stage === 0 && started.coins === coins0 - 400, JSON.stringify(started));
check("2. its plot stands on the map by the city", started.prop?.asset === "grand-exhibition-0", JSON.stringify(started.prop));
let site = { x: started.prop?.x ?? 0, z: started.prop?.z ?? 0 };
await p.waitForTimeout(600);
await shot("2-after-build");
const card2 = await p.evaluate(() => ({ open: window.woodrail.hud.depotCardOpen, depot: window.woodrail.interaction.openDepotId, tile: document.querySelector('.grand-tile[data-grand="exhibition"]')?.textContent ?? null }));
check("2. the card says stage 1 of 4", /Stage 1 of 4/.test(card2.tile ?? ""), JSON.stringify(card2));

/** The camera on the site, from the south-east, a little above. */
const lookAtSite = async (dist = 1100) => {
  await p.evaluate(() => window.woodrail.hud.hideCards?.());
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, 0, v.z), dist, { duration: 0.2, phi: 0.95, theta: 0.7 }), [site, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await settle();
  await p.waitForTimeout(1200);
};
await lookAtSite();
await shot("3-stage-0");

// ---- 3. Each stage's goods by train ---------------------------------------------------------------------------------
/**
 * Bring `n` of `kind` to Larkfield's station by train: a train of the wagons that carry it driven in along a short line
 * laid behind the station (laid once: setup), halting there to be unloaded by the station's crane, then put back in the
 * box. The game's own sim and economy, ticked here with the game paused (as e2e:civic: SwiftShader draws too few
 * frames to run them in real time).
 */
const bring = async (kind, n, station = town.station) =>
  p.evaluate(
    async ({ station, kind, n }) => {
      const { CARRIES } = await import("/src/economy/cargo.ts");
      const { WAGON_CAPACITY } = await import("/src/economy/constants.ts");
      const w = window.woodrail;
      const at = w.layout.getPiece(station).pose;
      const c = Math.cos(at.heading);
      const s = Math.sin(at.heading);
      window.__approach ??= {};
      if (window.__approach[station] === undefined) {
        // (Laid on whichever side of the station is clear of track: behind it, or else ahead of it, turned round, so
        // the train still runs into the station. A town between two others has the starter line on one side.)
        const clear = (side) => {
          for (let k = 1; k <= 6; k++) {
            const x = at.x + side * c * 216 * k;
            const z = at.z + side * s * 216 * k;
            for (const id of w.layout.pieceIds()) {
              const q = w.layout.getPiece(id).pose;
              if (id !== station && Math.hypot(q.x - x, q.z - z) < 150) return false;
            }
          }
          return true;
        };
        // (Laid already, before a reload: the same line again, found where it was laid.)
        const laidAt = (side) => {
          const x = at.x + side * c * 216 * 4;
          const z = at.z + side * s * 216 * 4;
          return w.layout.pieceIds().find((id) => w.layout.getPiece(id).type === "straight-216" && Math.hypot(w.layout.getPiece(id).pose.x - x, w.layout.getPiece(id).pose.z - z) < 1);
        };
        const old = laidAt(-1) ?? laidAt(1);
        if (old !== undefined) window.__approach[station] = old;
        else {
          const side = clear(-1) ? -1 : 1;
          const along = (k) => ({ x: at.x + side * c * 216 * k, z: at.z + side * s * 216 * k, heading: side < 0 ? at.heading : at.heading + Math.PI });
          const before = [6, 5, 4, 3, 2, 1].map((k) => w.layout.addPiece("straight-216", along(k)));
          window.__approach[station] = before[before.length - 4];
          w.trackChanged();
        }
      }
      const wagon = Object.entries(CARRIES).find(([car, kinds]) => car !== "passenger" && kinds.includes(kind))?.[0] ?? "van";
      const cap = WAGON_CAPACITY;
      let brought = 0;
      for (let left = n; left > 0; ) {
        const take = Math.min(left, cap * 4);
        const placed = w.sim.addTrain(["engine", ...Array(Math.ceil(take / cap)).fill(wagon)], { pieceId: window.__approach[station], pathIndex: 0, reversed: false, s: 150 });
        if (placed.kind !== "placed") return { brought, why: placed.kind };
        const train = w.sim.getTrain(placed.trainId);
        const cars = train.cars.map((x) => x.id);
        let k = take;
        for (const car of train.cars.slice(1)) {
          const m = Math.min(cap, k);
          w.economy.setCargo(car.id, kind, m);
          k -= m;
        }
        w.sim.setLever(train.cars[0].id, 1);
        const onBoard = () => cars.reduce((m, id) => m + (w.economy.cargoOf(id).kind === kind ? w.economy.cargoOf(id).count : 0), 0);
        w.paused = true;
        for (let t = 0; t < 120 * 240 && onBoard() > 0; t++) {
          w.sim.tick();
          w.economy.tick();
        }
        w.paused = false;
        brought += take - onBoard();
        for (const id of new Set(cars.map((x) => w.sim.findCar(x)?.train.id))) if (id !== undefined) w.sim.removeTrain(id);
        left -= take;
      }
      return { brought };
    },
    { station, kind, n },
  );

const growthNow = () =>
  p.evaluate(async (id) => {
    const { receivedBy } = await import("/src/game/town-life.ts");
    return receivedBy(window.woodrail.world, id);
  }, town.id);
const stages = await p.evaluate(async () => {
  const { grandOf } = await import("/src/game/grand.ts");
  return grandOf("exhibition").stages.map((s) => ({ name: s.name, goods: s.goods }));
});
const levelsBefore = await levels();
for (const [i, stage] of stages.entries()) {
  const before = await growthNow();
  const results = [];
  for (const [kind, n] of Object.entries(stage.goods)) results.push({ kind, ...(await bring(kind, n)) });
  await p.waitForFunction((s) => (window.woodrail.world.economy.grandPlans.get("exhibition")?.stage ?? 0) > s, i, { timeout: 30000 }).catch(() => console.log(`(stage ${i + 1} not done within 30 s)`));
  await p.waitForTimeout(800);
  await closeSheets();
  const now = await p.evaluate(() => {
    const w = window.woodrail;
    const plan = w.world.economy.grandPlans.get("exhibition");
    return { stage: plan.stage, asset: w.world.props.get(plan.prop)?.asset };
  });
  check(`3. trains brought ${stage.name.toLowerCase()}'s goods`, results.every((r) => r.brought === stage.goods[r.kind]), JSON.stringify(results));
  check(`3. ${stage.name} done: stage ${i + 1} of 4, the site shows it`, now.stage === i + 1 && now.asset === `grand-exhibition-${i + 1}`, JSON.stringify(now));
  if (i < stages.length - 1) {
    const after = await growthNow();
    const counted = Object.keys(stage.goods).filter((k) => (after[k] ?? 0) !== (before[k] ?? 0));
    check(`3. ${stage.name}'s goods went into it, not toward Larkfield's growth`, counted.length === 0, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  }
  await lookAtSite();
  await shot(`3-stage-${i + 1}`);
}

// ---- 4. The payoff: earned, and every town grows a step ---------------------------------------------------------------
await p.waitForTimeout(2000);
await closeSheets();
const levels1 = await levels();
const grew = levels1.filter((t) => t.id !== town.id).map((t) => t.level - levelsBefore.find((x) => x.id === t.id).level);
check("4. every other town grew a level", grew.length > 0 && grew.every((d) => d === 1), JSON.stringify({ before: levelsBefore, after: levels1 }));
const lark0 = levelsBefore.find((t) => t.id === town.id);
const lark1 = levels1.find((t) => t.id === town.id);
check("4. Larkfield's next star is a quarter filled (or more)", lark1.level > lark0.level || lark1.fill >= lark0.fill + 0.2, `${JSON.stringify(lark0)} → ${JSON.stringify(lark1)}`);
const news = await p.evaluate(() => (window.woodrail.journal.toJSON().entries ?? []).map((e) => e.text).slice(0, 12));
check("4. the News says it opened", news.some((t) => /Great Exhibition opens/.test(t)), JSON.stringify(news.slice(0, 5)));
const sticker = await p.evaluate(() => window.woodrail.stickers().ids());
check("4. its sticker is earned", sticker.includes("grand-exhibition"), JSON.stringify(sticker));
await openJournal();
await tap('.goals-tab[aria-label="Achievements"]');
const r4 = await row();
check("4. the Achievements tab: ✓ Earned, all four stages", !!r4 && r4.got && /Earned/.test(r4.text) && r4.pips === "●●●●", JSON.stringify(r4));
await shot("4-earned");
await p.evaluate(() => document.querySelector(".goals-close")?.click());

// ---- 5. Idle frames, then a reload ----------------------------------------------------------------------------------
await lookAtSite(900);
await shot("5-finished");
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 3000));
  return w.framesDrawn - n0;
});
check("5. 0 frames drawn idle with the finished hall in view", idle === 0, `${idle} frames`);
await p.waitForTimeout(3000); // (saved)
await p.reload();
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
const back = await p.evaluate(async () => {
  const w = window.woodrail;
  const plan = w.world.economy.grandPlans.get("exhibition");
  return { stage: plan?.stage, asset: plan ? w.world.props.get(plan.prop)?.asset : null };
});
const levels2 = await levels();
check("5. after a reload: the finished hall, earned", back.stage === 4 && back.asset === "grand-exhibition-4", JSON.stringify(back));
check("5. after a reload: the towns as big as they grew", JSON.stringify(levels2.map((t) => t.level)) === JSON.stringify(levels1.map((t) => t.level)), `${JSON.stringify(levels1)} → ${JSON.stringify(levels2)}`);

// ---- 6–8. The other grand projects, each in a City ★ of its own, by taps and trains --------------------------------
/** Town `i` a City ★ (setup shortcut, as section 1), and its station. */
const cityStar = async (i) => {
  const t = await p.evaluate(async (i) => {
    const { townLevel } = await import("/src/game/towns.ts");
    const w = window.woodrail;
    const t = w.world.landscape.towns[i];
    const bag = {};
    for (let k = 0; k < 4; k++) for (const [g, n] of Object.entries(townLevel(k).wants)) bag[g] = (bag[g] ?? 0) + n;
    const had = w.economy.deliveredGoods.get(t.id) ?? {};
    for (const [g, n] of Object.entries(had)) bag[g] = Math.max(bag[g] ?? 0, n);
    w.economy.delivered.set(t.id, bag.planks ?? 0);
    w.economy.deliveredGoods.set(t.id, bag);
    w.invalidate();
    return { id: t.id, name: t.name, station: w.world.stations.get(t.id), depot: w.world.economy.depotAtPiece(w.world.stations.get(t.id)).id };
  }, i);
  await p.waitForTimeout(2500);
  await closeSheets();
  return t;
};
/** Build project `id` from city `t`'s card by a tap, then every stage's goods by train: pictures of each stage. */
const buildByTrain = async (t, id, label) => {
  await p.evaluate(() => {
    const w = window.woodrail;
    w.progress().coins = Math.max(w.progress().coins, 1500);
    w.hud.setCoins(w.progress().coins);
  });
  await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), t.depot);
  await p.waitForTimeout(900);
  const state = await p.evaluate((id) => [...(document.querySelector(`.grand-tile[data-grand="${id}"]`)?.classList ?? [])].find((c) => !["place-tile", "grand-tile"].includes(c)) ?? null, id);
  check(`${label}: ${t.name}'s card offers it`, state === "build", String(state));
  // (A growth's reward sheet may come up late, over the card: shut first, the card opened again; tapped again if the
  // first tap met one.)
  for (let attempt = 0; attempt < 2; attempt++) {
    await closeSheets();
    await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), t.depot);
    await p.waitForTimeout(700);
    await tap(`.grand-tile[data-grand="${id}"] .place-btn`);
    // (Its models are fetched before its site is found: slow on a busy machine.)
    const ok = await p.waitForFunction((id) => window.woodrail.world.economy.grandPlans.has(id), id, { timeout: 90000 }).then(() => true, () => false);
    if (ok) break;
  }
  const plan0 = await p.evaluate((id) => {
    const w = window.woodrail;
    const plan = w.world.economy.grandPlans.get(id);
    const prop = plan && w.world.props.get(plan.prop);
    return plan ? { town: plan.townId, asset: prop?.asset, x: prop?.x, z: prop?.z } : null;
  }, id);
  if (!plan0) await shot(`${id}-not-built`);
  const said = await p.evaluate(() => [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | "));
  check(`${label}: Build puts its plot up by ${t.name}`, plan0?.town === t.id && plan0?.asset === `grand-${id}-0`, `${JSON.stringify(plan0)} ${said}`);
  if (!plan0) return;
  site = { x: plan0.x ?? 0, z: plan0.z ?? 0 };
  await lookAtSite(1300);
  await shot(`${id}-stage-0`);
  const stagesOf = await p.evaluate(async (id) => (await import("/src/game/grand.ts")).grandOf(id).stages.map((s) => s.goods), id);
  for (const [i, goods] of stagesOf.entries()) {
    const got = [];
    for (const [kind, n] of Object.entries(goods)) got.push({ kind, ...(await bring(kind, n, t.station)) });
    await p.waitForFunction(([id, s]) => (window.woodrail.world.economy.grandPlans.get(id)?.stage ?? 0) > s, [id, i], { timeout: 30000 }).catch(() => console.log(`(${id} stage ${i + 1} not done within 30 s)`));
    await p.waitForTimeout(600);
    await closeSheets();
    const asset = await p.evaluate((id) => {
      const w = window.woodrail;
      return w.world.props.get(w.world.economy.grandPlans.get(id).prop)?.asset;
    }, id);
    check(`${label}: stage ${i + 1} of ${stagesOf.length} done by train, the site shows it`, asset === `grand-${id}-${i + 1}`, `${asset} ${JSON.stringify(got)}`);
    await lookAtSite(1300);
    await shot(`${id}-stage-${i + 1}`);
  }
  await p.waitForTimeout(1500);
  await closeSheets();
};

// 6. The Royal Train in Elderwick: finished, it's in the toy box (a tray tile on the Trains tab), the only train in that
//    look.
const t1 = await cityStar(1);
await buildByTrain(t1, "royal-train", "6. Royal Train");
const royal = await p.evaluate(() => {
  const w = window.woodrail;
  const pr = w.progress();
  return { look: pr.owned.get("look:royal") ?? 0, tile: [...document.querySelectorAll(".tray-item, .tray button")].some((e) => /Royal Train/.test(e.getAttribute("aria-label") ?? e.textContent ?? "")) };
});
check("6. Royal Train: finished, it's given into the toy box", royal.look === 1, JSON.stringify(royal));
// (Its saloons are coaches: shown once coaches are known, as any coach is. A player has them long before a City ★:
// learned here as setup.)
await p.evaluate(() => window.woodrail.learn("passengers"));
const royalTile = await p.evaluate(async () => {
  const { TRAIN_ITEMS } = await import("/src/ui/tray-catalogue.ts");
  const item = TRAIN_ITEMS.find((x) => x.label === "Royal Train");
  return !!item && window.woodrail.hud.trayKnown(item);
});
check("6. Royal Train: its tray tile shows now", royalTile);

// 7. The Cathedral: glass among its goods (the Glassworks on the Industries shelf once learned); finished, every town
//    needs a tenth fewer goods to grow.
const t2 = await cityStar(2);
await p.evaluate(() => window.woodrail.learn("glassworks"));
const wantsBefore = await p.evaluate(async (id) => (await import("/src/game/town-life.ts")).statusOf(window.woodrail.world, id).wants, town.id);
await buildByTrain(t2, "cathedral", "7. Cathedral");
const wantsAfter = await p.evaluate(async (id) => (await import("/src/game/town-life.ts")).statusOf(window.woodrail.world, id).wants, town.id);
const cut = Object.keys(wantsBefore).every((k) => wantsAfter[k] === Math.max(1, Math.ceil(wantsBefore[k] * 0.9 - 1e-9)));
check("7. Cathedral: finished, Larkfield needs a tenth fewer of each good to grow", cut, `${JSON.stringify(wantsBefore)} → ${JSON.stringify(wantsAfter)}`);
const glassTile = await p.evaluate(async () => {
  const { trayTabs } = await import("/src/ui/tray-catalogue.ts");
  return trayTabs("game").flatMap((t) => t.groups.flatMap((g) => g.items)).some((i) => i.kind === "piece" && i.type === "depot-glassworks");
});
check("7. the Glassworks is on the tray", glassTile);

// 8. The World's Fair wheel: finished, its tickets pay 60 coins as a month passes.
const t3 = await cityStar(3);
await buildByTrain(t3, "ferris-wheel", "8. Ferris wheel");
// The wheel turns, slowly, while it's in view (ambient motion: frames at the ambient rate), and stands still paused.
await lookAtSite(900);
await shot("ferris-wheel-turning");
const turning = await p.evaluate(async () => {
  const w = window.woodrail;
  w.turbinesView.calm = false;
  const a0 = w.turbinesView.time ?? 0;
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 2500));
  const running = w.framesDrawn - n0;
  w.paused = true;
  await new Promise((r) => setTimeout(r, 600));
  const n1 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 2500));
  const paused = w.framesDrawn - n1;
  w.paused = false;
  return { running, paused, turned: (w.turbinesView.time ?? 0) - a0 };
});
check("8. Ferris wheel: it turns in view (frames drawn), and draws nothing paused", turning.running > 0 && turning.paused === 0 && turning.turned > 0, JSON.stringify(turning));
const coinsW0 = await p.evaluate(() => window.woodrail.progress().coins);
await p.waitForTimeout(2500);
await p.evaluate(async () => {
  const { MONTH_S } = await import("/src/game/calendar.ts");
  window.woodrail.simSeconds += MONTH_S;
});
await p.waitForTimeout(3000);
const coinsW1 = await p.evaluate(() => window.woodrail.progress().coins);
check("8. Ferris wheel: a month on, its tickets pay 60 coins", coinsW1 - coinsW0 >= 60, `${coinsW0} → ${coinsW1}`);
await openJournal();
await tap('.goals-tab[aria-label="Achievements"]');
const earnedAll = await p.evaluate(() => [...document.querySelectorAll(".ach-item.got .ach-row")].map((r) => r.dataset.id));
check("8. the Achievements tab: four earned", ["exhibition", "cathedral", "royal-train", "ferris-wheel"].every((id) => earnedAll.includes(id)), JSON.stringify(earnedAll));
await shot("8-achievements");
await p.evaluate(() => document.querySelector(".goals-close")?.click());

// ---- 9. Grand Central: its kit given into the toy box, put on the map by Larkfield, built and earned ------------------
await p.evaluate(() => {
  const w = window.woodrail;
  w.progress().coins = Math.max(w.progress().coins, 1500);
  w.hud.setCoins(w.progress().coins);
});
await p.evaluate((d) => window.woodrail.interaction.openDepotCard(d), town.depot);
await p.waitForTimeout(900);
check("9. Grand Central: Larkfield's card offers it", (await p.evaluate(() => !!document.querySelector('.grand-tile.build[data-grand="central"]'))) === true);
await tap('.grand-tile[data-grand="central"] .place-btn');
await p.waitForFunction(() => window.woodrail.world.economy.grandPlans.has("central"), null, { timeout: 30000 }).catch(() => {});
const kitOwned = await p.evaluate(() => window.woodrail.progress().owned.get("piece:kit-grand-central-1") ?? 0);
check("9. Grand Central: Build gives its kit into the toy box", kitOwned === 1, String(kitOwned));
await p.evaluate(() => window.woodrail.hud.hideCards?.());
// The Industries tab's Stations shelf: the kit there.
const clickText = async (selector, text) => {
  const at = await p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().startsWith(text) && e.getBoundingClientRect().width > 0);
      if (!el) return null;
      el.scrollIntoView({ inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
  if (at) await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(600);
  return !!at;
};
await clickText(".tabs button", "Industries");
await clickText(".tray-item.tray-group", "Stations");
const kitTile = await p.evaluate(() => !!document.querySelector(".tray-item[data-key='piece:kit-grand-central-1']"));
check("9. Grand Central: its tile on the Industries tab's Stations shelf", kitTile);
await shot("central-tray");
// A clear spot by Larkfield for it, by the game's own drop rule (`placeWhy`): its middle, for the drag.
const spot = await p.evaluate((townId) => {
  const w = window.woodrail;
  const t = w.world.landscape.towns.find((x) => x.id === townId);
  const st = w.layout.getPiece(w.world.stations.get(townId)).pose;
  for (let r = 300; r <= 1500; r += 72)
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const x = Math.round((st.x + Math.cos(a) * r) / 6) * 6;
      const z = Math.round((st.z + Math.sin(a) * r) / 6) * 6;
      const pose = { x: x - 108, z: z - 72, heading: 0 };
      if (Math.hypot(x - t.centre.x, z - t.centre.z) > 1200) continue;
      if (w.interaction.placeWhy("kit-grand-central-1", pose, 0, -1) === null) return { x, z };
    }
  return null;
}, town.id);
check("9. Grand Central: there's a clear spot for it by Larkfield", !!spot, JSON.stringify(spot));
if (spot) {
  await p.evaluate((v) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, 0, v.z), 1500, { duration: 0.1, phi: 0.9 }), spot);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await settle();
  await clickText(".tabs button", "Industries");
  await clickText(".tray-item.tray-group", "Stations");
  const from = await p.evaluate(() => {
    const el = document.querySelector(".tray-item[data-key='piece:kit-grand-central-1']");
    el.scrollIntoView({ inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const to = await p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, 0, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }, spot);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  for (let k = 1; k <= 24; k++) {
    await p.mouse.move(from.x + ((to.x - from.x) * k) / 24, from.y + ((to.y - from.y) * k) / 24);
    await p.waitForTimeout(40);
  }
  await p.waitForTimeout(500);
  await p.mouse.up();
  await p.waitForTimeout(1200);
}
const placed = await p.evaluate(() => {
  const w = window.woodrail;
  const id = w.layout.pieceIds().find((i) => w.layout.getPiece(i).type.startsWith("kit-grand-central-"));
  const d = id === undefined ? null : w.world.economy.depotAtPiece(id);
  return id === undefined ? null : { id, type: w.layout.getPiece(id).type, pose: w.layout.getPiece(id).pose, town: d?.townId ?? null, toast: document.querySelector(".toast")?.textContent ?? "" };
});
check("9. Grand Central: dragged from the tray, it stands by Larkfield, one of its stops", placed?.type === "kit-grand-central-1" && placed?.town === town.id, JSON.stringify(placed) + (await p.evaluate(() => document.querySelector(".toast")?.textContent ?? "")));
// (Its middle, the building side's: t 108 along, l 110 across, by its heading.)
if (placed) site = { x: placed.pose.x + 108 * Math.cos(placed.pose.heading) - 110 * Math.sin(placed.pose.heading), z: placed.pose.z + 108 * Math.sin(placed.pose.heading) + 110 * Math.cos(placed.pose.heading) };
await lookAtSite(1200);
await shot("central-stage-0");
const centralStages = await p.evaluate(async () => (await import("/src/game/grand.ts")).grandOf("central").stages.map((s) => ({ goods: s.goods, riders: s.riders ?? 0 })));
for (const [i, st] of centralStages.entries()) {
  for (const [kind, n] of Object.entries(st.goods)) await bring(kind, n);
  if (st.riders > 0) {
    // Riders carried through Larkfield: each one's getting off told as the economy tells it (`onAlight`), from another
    // town's station to Larkfield's (a named shortcut: carrying 60 by train is the passenger line's, its fares in
    // grand.test.ts; what's tested here is the stage counting them).
    await p.evaluate(({ n, townId }) => {
      const w = window.woodrail;
      const e = w.world.economy;
      const other = w.world.landscape.towns.find((t) => t.id !== townId);
      const from = e.depotAtPiece(w.world.stations.get(other.id));
      const to = e.depotAtPiece(w.world.stations.get(townId));
      for (let k = 0; k < n; k++) e.onAlight(from, to, -1);
    }, { n: st.riders, townId: town.id });
  }
  await p.waitForFunction((s) => (window.woodrail.world.economy.grandPlans.get("central")?.stage ?? 0) > s, i, { timeout: 30000 }).catch(() => console.log(`(central stage ${i + 1} not done within 30 s)`));
  await p.waitForTimeout(1200);
  await closeSheets();
  const now = await p.evaluate(() => {
    const w = window.woodrail;
    const id = w.layout.pieceIds().find((x) => w.layout.getPiece(x).type.startsWith("kit-grand-central-"));
    return { stage: w.world.economy.grandPlans.get("central")?.stage, type: id === undefined ? null : w.layout.getPiece(id).type };
  });
  const want = ["kit-grand-central-2", "kit-grand-central-3", "kit-grand-central-3"][i];
  check(`9. Grand Central: stage ${i + 1} of 3 done, its kit on the map now ${want}`, now.stage === i + 1 && now.type === want, JSON.stringify(now));
  // (The last stage's toast gone first: its day's is a long one.)
  if (i === centralStages.length - 1) await p.waitForTimeout(6500);
  await lookAtSite(1200);
  await shot(`central-stage-${i + 1}`);
}
check("9. Grand Central: earned", (await p.evaluate(async () => (await import("/src/game/grand.ts")).earned(window.woodrail.world, "central"))) === true);
check("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(`${checks - failures}/${checks} passed`);
await b.close();
await server.close();
process.exit(failures > 0 ? 1 : 0);
