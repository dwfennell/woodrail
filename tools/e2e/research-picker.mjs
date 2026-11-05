// End-to-end Research picker on a phone (`npm run e2e:research [-- <out dir>]`), at 390×844 with touch: a new game's
// line laid and its school placed; the pill in the top bar says "Pick research"; a goal after a blueprint (Research
// switches) opens the picker on it from Show me and from the pill, nothing picked; Research, then a queue of two by taps (#14: Add to queue, Remove, Research now's swap; when
// Switches is learned Bridges starts by itself, Farming moves up, the school takes Bridges' goods, the queue is saved); deliveries move the pill; the pill opens on what it shows (the one up next, waiting for coins); every card state's ticket; the pill fits the bar beside the coins and buttons; the date
// and the pill both read at 360, 414 and 844×390 (a phone on its side); and no frames drawn in 30 s with the pill showing
// while nothing changes. Then a research learned with nothing in Next up: the pill amber with its pulsing dot (still with
// reduced motion), a toast once ("Larkfield school is idle: pick what to learn next", a tap opens the picker), the school's
// card saying Idle with a Research button, and no frames in 30 s with the dot pulsing (a few pulses, then it rests).
//
// Then chains: Mills (needs Farming) queued in one tap behind Farming, "Research Farming now" (never Research now while
// Farming isn't learned), Farming taken out takes Mills too with a toast, and the chain learned through. Then the next
// nodes: Juice works' ticket in words, and Creamery then Cold van researched by taps and deliveries. Then tech tree 3: the
// gates (a node locked at a schoolhouse, open at a College; one waiting for a University), the University (a third fewer
// goods for hard lessons, the whole board shown), the Car carrier, the Car factory and Fishing boats. Then Tank wagons and
// the Breakdown crane, and their wagons and wells on the tray. Then the goods chains: Sugar beet, Jam kitchen, Chocolate
// factory, Dye works and Toy workshop, and their six buildings unlocked.
//
// Usage: npm run e2e:research [-- <out dir>]   (default out: e2e-out/research)
// A tap on a card shows what it unlocks and its full cost in words, at 360 px (#11). A research needing three goods:
// the pill lists each, or the one most lacking and "+N", at 360, 390 and 1440 px.
// Starts its own dev server (on 5381, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/research";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5381, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks held still: this counts idle frames, and a clock in view draws one at each minute; e2e:station-clock tests that.)
pinClocksIn(b);
// (Industries' axes and saws held still: not what this tests, and in view they keep `settled()` and idle counts waiting.)
stillIndustriesIn(b);
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
/**
 * Tap the middle of the first visible element matching `selector` (whose text starts with `text`, if given), once
 * nothing lies over it, as a player waits: a tap on a toast only puts the toast away (QA: "Learned Switches! Next:
 * Bridges and ramps" over the board's ✕ took the close tap, and the pill's next tap toggled the board shut).
 */
const tap = async (selector, text) => {
  const find = ({ selector, text }) => {
    const el = [...document.querySelectorAll(selector)].find((e) => (text === undefined || e.textContent.trim().startsWith(text)) && e.getBoundingClientRect().width > 0);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    return el.contains(document.elementFromPoint(at.x, at.y)) ? at : null;
  };
  const box = await p
    .waitForFunction(find, { selector, text }, { timeout: 10000, polling: 200 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  if (!box) {
    console.log(`(tap: ${selector}${text ? ` "${text}"` : ""} not found, or covered for 10 s)`);
    return false;
  }
  await p.touchscreen.tap(box.x, box.y);
  await p.waitForTimeout(400);
  return true;
};
/**
 * Open the picker with the pill, or close it with its ✕, and wait till it is: a tap lost to a long task (seconds, under
 * SwiftShader) is tried again, so the next tap doesn't toggle the picker the wrong way. (The pill toggles it.)
 */
const board = async (open) => {
  const is = () => p.evaluate(() => !!document.querySelector(".board-open"));
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await is()) === open) return true;
    if (!(await tap(open ? ".research-pill" : ".board-head .close"))) return false;
    const done = await p
      .waitForFunction((o) => !!document.querySelector(".board-open") === o, open, { timeout: 5000, polling: 200 })
      .then(() => true)
      .catch(() => false);
    if (done) return true;
  }
  console.log(`(board: not ${open ? "open" : "closed"} after 3 taps)`);
  return false;
};
const pill = () => p.evaluate(() => {
  const el = document.querySelector(".research-pill");
  return el && !el.hidden ? `📘 ${el.querySelector(".rp-name").textContent} ${el.querySelector(".rp-count").textContent}` : null;
});
const ticket = () => p.evaluate(() => {
  const t = document.querySelector(".board-sheet .bp-ticket");
  return t ? { state: [...t.classList].find((c) => c !== "bp-ticket"), name: t.querySelector("b")?.textContent, foot: t.querySelector(".bp-ticket-foot")?.textContent.replace(/\s+/g, " ").trim(), buttons: [...t.querySelectorAll(".bp-ticket-foot button")].map((x) => ({ text: x.textContent, h: x.getBoundingClientRect().height, goal: x.classList.contains("bp-goal") })) } : null;
});
/**
 * Select a card in the picker by its name. The tap waits till nothing lies over the card (a toast, such as a goal's
 * tick as a research is learned, can cover a card at the top of the list), and is tried again if the ticket doesn't
 * show it.
 */
const select = async (name) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const box = await p
      .waitForFunction(
        (name) => {
          const el = [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === name);
          if (!el) return null;
          el.scrollIntoView({ block: "center" });
          const r = el.getBoundingClientRect();
          const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          return el.contains(document.elementFromPoint(at.x, at.y)) ? at : null;
        },
        name,
        { timeout: 10000, polling: 200 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    if (!box) return false;
    await p.touchscreen.tap(box.x, box.y);
    await p.waitForTimeout(400);
    if ((await ticket())?.name === name) return true;
  }
  return false;
};

// 1. A new game: the line between the first two towns laid, and the school placed where Show me points.
await p.goto(PAGE);
await enterGame();
check("a new game, no school: no pill", (await pill()) === null, String(await pill()));
const placed = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor, schoolOn } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
  const r = play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
  const school = schoolOn(w.world, w.editor(), new Set());
  w.invalidate();
  return { joined: r.ok, school };
});
check("the line laid and the school placed beside a town", placed.joined && typeof placed.school === "number", JSON.stringify(placed));
await p.waitForTimeout(600);
check("with a school and nothing picked, the pill says Pick research", (await pill()) === "📘 Pick research", String(await pill()));

// 2. Back with the goals done up to Research switches (a reload: Continue): right after placing the school (spec §4).
await p.evaluate(() => localStorage.setItem("woodrail.game.goals.v1", JSON.stringify(["join-two", "place-train", "get-moving", "station-stop", "timber-train", "load-logs", "deliver-planks", "grow-town", "place-school"])));
await p.reload();
await enterGame();
await p.waitForTimeout(600);
const goalNow = await p.evaluate(() => document.querySelector(".goals-now")?.textContent);
check("the goal now is Research switches", goalNow === "Research switches", String(goalNow));
// The bar, with the pill: nothing overlaps, everything a finger's size.
const bar = async () =>
  p.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), h: Math.round(b.height), w: Math.round(b.width) };
    };
    const coins = document.querySelector(".brand");
    const pill = document.querySelector(".research-pill");
    const buttons = [...document.querySelectorAll(".topbar .actions > .chip")].filter((x) => x.getBoundingClientRect().width > 0);
    // (Every button at least 44 x 44 drawn, Pause among them: QA had it at 40 x 40.)
    const small = buttons.filter((x) => x.getBoundingClientRect().width < 44 || x.getBoundingClientRect().height < 44).map((x) => x.title);
    return { coins: r(coins), pill: r(pill), first: r(buttons[0]), last: r(buttons.at(-1)), width: innerWidth, small, clipped: pill.querySelector(".rp-name").scrollWidth > pill.querySelector(".rp-name").clientWidth };
  });
const fits = (m) => m.pill.l >= m.coins.r + 4 && m.pill.r <= m.first.l - 4 && m.pill.h >= 44 && m.last.r <= m.width && m.small.length === 0;
let m = await bar();
check("the pill sits between the coins and the buttons, 44 px tall", fits(m), JSON.stringify(m));
await shot("01-pill-pick-research");

// 3. Show me for Research switches: the picker, open on Switches, its Research ringed; nothing picked.
await tap(".goals-show-icon");
await p.waitForTimeout(500);
let t = await ticket();
check("Show me opens the picker on Switches, Research ringed for the goal", t?.name === "Switches" && t.buttons.length === 1 && t.buttons[0].text === "Research" && t.buttons[0].goal && t.buttons[0].h >= 44, JSON.stringify(t));
check("…and nothing is picked", (await p.evaluate(() => window.woodrail.progress().research.current)) === null);
await shot("02-show-me-opens-switches");
await board(false);
// The pill opens it on the goal's research too (the school is idle).
await board(true);
t = await ticket();
check("the pill opens the picker on the goal's research while the school is idle", t?.name === "Switches", JSON.stringify(t));
await shot("03-ready-card");

// 4. Research Switches with one tap, then Bridges up next.
await tap(".board-sheet button[data-act=pick]", "Research");
t = await ticket();
check("one tap: Switches is researching, live progress, no button", t?.state === "researching" && t.buttons.length === 0 && /\uE000 0\/3/.test(t.foot) && /bring 3\uE000 to/.test(t.foot), JSON.stringify(t));
check("the pill shows it", (await pill()) === "📘 Switches \uE0000/3", String(await pill()));
await shot("04-picked-research");
await select("Bridges and ramps");
t = await ticket();
check("a ready card while one is under way: one button, Add to queue", t?.state === "ready" && t.buttons.length === 1 && t.buttons[0].text === "Add to queue" && /\uE000 0\/10/.test(t.foot) && /20 s study/.test(t.foot), JSON.stringify(t));
// The queue (#14), by taps: Bridges, then Farming, lined up behind Switches.
await tap(".board-sheet button[data-act=pick]", "Add to queue");
t = await ticket();
const queuedButtons = (t) => (t?.buttons ?? []).map((x) => x.text).join("|");
check("Add to queue: Bridges waits after Switches, with Remove and Research now, each 44 px", t?.state === "next" && /Next up, after Switches/.test(t.foot) && queuedButtons(t) === "✕ Remove|Research now" && t.buttons.every((x) => x.h >= 44), JSON.stringify(t));
await shot("05-next-up");
await select("Farming");
await tap(".board-sheet button[data-act=pick]", "Add to queue");
t = await ticket();
check("a second tap on another: Farming 2nd in line, after Bridges", t?.state === "next" && /2nd in line, after Bridges/.test(t.foot) && queuedButtons(t) === "✕ Remove|Research now", JSON.stringify(t));
const queued = () => p.evaluate(() => { const r = window.woodrail.progress().research; return [r.current, r.next, ...r.later].filter((x) => x !== null); });
check("…the queue is Switches, then Bridges, then Farming", JSON.stringify(await queued()) === JSON.stringify(["switches", "bridges", "farming"]), JSON.stringify(await queued()));
const webTag = (name) => p.evaluate((name) => [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === name)?.querySelector(".bp-tag")?.textContent ?? null, name);
check("…the web's tags say Next up and In line: 2", (await webTag("Bridges and ramps")) === "Next up" && (await webTag("Farming")) === "In line: 2", `${await webTag("Bridges and ramps")} / ${await webTag("Farming")}`);
const pillMore = () => p.evaluate(() => document.querySelector(".research-pill")?.getAttribute("data-more") ?? null);
check("…the pill shows +2 waiting", (await pillMore()) === "+2", String(await pillMore()));
await shot("05b-queue-two");
// Tap again: out of the queue, and back in.
await tap(".board-sheet button[data-act=pick]", "✕ Remove");
t = await ticket();
check("Remove: Farming is ready again, out of the queue", t?.state === "ready" && t.buttons[0]?.text === "Add to queue" && JSON.stringify(await queued()) === JSON.stringify(["switches", "bridges"]), JSON.stringify([t, await queued()]));
await tap(".board-sheet button[data-act=pick]", "Add to queue");
check("…and back in, 2nd in line", JSON.stringify(await queued()) === JSON.stringify(["switches", "bridges", "farming"]), JSON.stringify(await queued()));
// Research now swaps Bridges in; and back.
await select("Bridges and ramps");
await tap(".board-sheet button[data-act=now]", "Research now");
const swapped = await p.evaluate(() => ({ ...window.woodrail.progress().research, held: undefined }));
check("Research now swaps the two, the rest of the queue kept", swapped.current === "bridges" && swapped.next === "switches" && JSON.stringify(swapped.later) === `["farming"]`, JSON.stringify(swapped));
await select("Switches");
await tap(".board-sheet button[data-act=now]", "Research now");
await board(false);

// 5. Deliveries move the pill (planks into the school, as a train's crane brings them).
const deliver = (n) =>
  p.evaluate((n) => {
    const w = window.woodrail;
    const school = w.economy.allDepots().find((d) => d.role === "school");
    for (let i = 0; i < n; i++) w.economy.intoSink(school, "planks");
  }, n);
const before = await pill();
await shot("06-pill-before-delivery");
await deliver(2);
await p.waitForTimeout(300);
const after = await pill();
check("a delivery moves the pill", before === "📘 Switches \uE0000/3" && after === "📘 Switches \uE0002/3", `${before} → ${after}`);
await shot("07-pill-after-delivery");
await deliver(1);
await p.waitForTimeout(1300);
const study = await pill();
check("goods all in: the pill counts the study down", /^📘 Switches ⏱ \d+ s$/.test(study ?? ""), String(study));
await shot("08-pill-studying");
// Learned (20 s), and Bridges starts from the queue by itself; Farming moves up to Next up.
await p.waitForFunction(() => window.woodrail.progress().learned.has("switches"), null, { timeout: 60000 });
await p.waitForTimeout(600);
check("Switches learned, Bridges started by itself from the queue", (await pill()) === "📘 Bridges \uE0000/10", String(await pill()));
check("…Farming moved up to Next up, the pill +1", JSON.stringify(await queued()) === JSON.stringify(["bridges", "farming"]) && (await pillMore()) === "+1", JSON.stringify([await queued(), await pillMore()]));
// …and the school now takes Bridges' planks (the payoff: goods go to the one that started).
const taken = await p.evaluate(() => {
  const w = window.woodrail;
  const school = w.economy.allDepots().find((d) => d.role === "school");
  w.economy.intoSink(school, "planks");
  return w.progress().research.got.planks ?? 0;
});
check("…a plank into the school goes to Bridges", taken === 1, String(taken));
// Saved and loaded: the queue comes back in order.
// (A pick saves; the queue is checked in what's stored, as a reload reads it.)
const saved = await p
  .waitForFunction(() => {
    const r = JSON.parse(localStorage.getItem("woodrail.game.progress.v1") ?? "null")?.research;
    return r?.current === "bridges" && r.next === "farming" ? r : null;
  }, null, { timeout: 15000, polling: 250 })
  .then((h) => h.jsonValue())
  .catch(() => p.evaluate(() => JSON.parse(localStorage.getItem("woodrail.game.progress.v1") ?? "null")?.research ?? null));
check("…saved with its queue", saved?.current === "bridges" && saved?.next === "farming", JSON.stringify(saved));
// (Farming out again: the rest of the run checks one up next at a time.)
await board(true);
await select("Farming");
await tap(".board-sheet button[data-act=pick]", "✕ Remove");
check("…Farming removed with a tap", JSON.stringify(await queued()) === JSON.stringify(["bridges"]), JSON.stringify(await queued()));
await board(false);

// 6. Every card state's ticket: learned, researching, next (with its coins short), ready, locked, soon.
await board(true);
await select("Routes and signals");
await tap(".board-sheet button[data-act=pick]", "Add to queue");
const states = {};
for (const [state, name] of [["learned", "Switches"], ["researching", "Bridges and ramps"], ["next", "Routes and signals"], ["ready", "Junctions and loops"]]) {
  await select(name);
  states[state] = await ticket();
  await shot(`09-card-${state}`);
}
// (Locked by something besides blueprints, the bench's 50 planks delivered: one locked behind blueprints has a chain
// button now, checked in step 10.)
for (const state of ["locked", "soon"]) {
  const name = state === "locked" ? "Carpenter's bench" : await p.evaluate((s) => document.querySelector(`.board-body .bp-node.${s} .bp-name`)?.textContent, state);
  if (name) await select(name);
  states[state] = await ticket();
  await shot(`09-card-${state}`);
}
check("learned: Learned, no button", states.learned?.state === "learned" && states.learned.buttons.length === 0, JSON.stringify(states.learned));
check("researching: live progress, no button", states.researching?.state === "researching" && /\uE000 1\/10/.test(states.researching.foot) && states.researching.buttons.length === 0, JSON.stringify(states.researching));
check("next: after Bridges, its coins chip short, Remove and Research now", states.next?.state === "next" && /Next up, after Bridges · 40🪙 short/.test(states.next.foot) && /🪙 40/.test(states.next.foot) && states.next.buttons.map((x) => x.text).join("|") === "✕ Remove|Research now", JSON.stringify(states.next));
check("ready: chips, study time, one 44 px button", states.ready?.state === "ready" && /\uE000 0\/4/.test(states.ready.foot) && states.ready.buttons.length === 1 && states.ready.buttons[0].h >= 44, JSON.stringify(states.ready));
check("locked: what it waits for", states.locked?.state === "locked" && states.locked.buttons.length === 0, JSON.stringify(states.locked));
check("soon: coming soon", states.soon?.state === "soon" && states.soon.buttons.length === 0, JSON.stringify(states.soon));
// 6b. A tap on a card says what it unlocks and everything it costs, in words (#11), fitting a 360 px phone: the
// cost line names every good the chips count (same amounts) and the coins the chips show short; the tag's tooltip
// (a hover on desktop) says the same.
const words = async (name) => {
  await select(name);
  return p.evaluate(() => {
    const t = document.querySelector(".board-sheet .bp-ticket");
    const r = t?.getBoundingClientRect();
    const node = document.querySelector(".board-body .bp-node.selected");
    return t && {
      name: t.querySelector("b")?.textContent,
      unlocks: t.querySelector(".bp-makes") ? `${t.querySelector(".bp-makes-head")?.textContent} ${[...t.querySelectorAll(".bp-make")].map((m) => m.querySelector(":scope > span:last-child")?.textContent.trim()).join(", ")}` : undefined,
      cost: t.querySelector(".bp-full-cost")?.textContent.replace(/\s+/g, " ").trim(),
      chips: [...t.querySelectorAll(".bp-chip:not(.study)")].map((c) => ({ text: c.textContent, title: c.title })),
      title: node?.title,
      fits: r.left >= 0 && r.right <= window.innerWidth && t.scrollWidth <= t.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
};
await p.setViewportSize({ width: 360, height: 780 });
await p.waitForTimeout(400);
const routesWords = await words("Routes and signals");
const bridgesWords = await words("Bridges and ramps");
const learnedWords = await words("Switches");
await shot("09b-card-words-360");
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(400);
// QA 2026-11-03 #3: on a phone the ticket's facts are folded under one line, so the list keeps most of the board, the
// picked tag in view above the ticket; a tap on the line unfolds them (the ticket scrolls in itself), another folds.
const room = () => p.evaluate(() => {
  const body = document.querySelector(".board-body").getBoundingClientRect();
  const sel = document.querySelector(".board-body .bp-node.selected")?.getBoundingClientRect();
  const more = document.querySelector(".board-sheet .bp-more");
  return { list: Math.round(body.height), inView: !!sel && sel.top >= body.top - 1 && sel.bottom <= body.bottom + 1, folded: !!more && !more.open, facts: !!more?.querySelector(".bp-makes")?.checkVisibility(), summary: more?.querySelector("summary")?.textContent.trim() };
});
await select("Routes and signals");
const roomFolded = await room();
await shot("09c-ticket-folded-390");
await tap(".board-sheet .bp-more > summary");
const roomOpen = await room();
await shot("09c-ticket-unfolded-390");
await tap(".board-sheet .bp-more > summary");
const roomRefolded = await room();
check("a phone's ticket: facts folded under one line, the list keeps 400+ px, the picked tag in view above the ticket", roomFolded.folded && !roomFolded.facts && roomFolded.list >= 400 && roomFolded.inView && /^Unlocks/.test(roomFolded.summary ?? ""), JSON.stringify(roomFolded));
check("…a tap unfolds them (Unlocks shown), another folds them", !roomOpen.folded && roomOpen.facts && roomRefolded.folded, JSON.stringify([roomOpen, roomRefolded]));
// QA 2026-11-03 #7: the ⓘ's legend at 390 px: a strip under the head (the list pushed down, none of it covered), each
// key on one line with its word.
await tap(".bp-legend-box summary");
const legend = await p.evaluate(() => {
  const l = document.querySelector(".board-panel > .bp-legend");
  const r = l.getBoundingClientRect();
  const body = document.querySelector(".board-body").getBoundingClientRect();
  const items = [...l.querySelectorAll(".bp-legend-item")].map((i) => i.getBoundingClientRect());
  return { shown: !l.hidden && r.height > 0, items: items.length, oneLine: items.every((i) => i.height <= 22), above: r.bottom <= body.top + 1 };
});
await shot("09d-legend-390");
await tap(".bp-legend-box summary");
const legendGone = await p.evaluate(() => document.querySelector(".board-panel > .bp-legend").hidden);
check("the ⓘ at 390: a strip above the list (covering none of it), each key with its word on one line; a tap closes it", legend.shown && legend.items === 7 && legend.oneLine && legend.above && legendGone, JSON.stringify({ ...legend, legendGone }));
// QA 2026-11-03 #8: a phone on its side opens the web scrolled to the picked tag from a column's edge, no card cut.
await p.setViewportSize({ width: 844, height: 390 });
await p.waitForFunction(() => !!document.querySelector(".bp-web-scroll .bp-node.selected"), null, { timeout: 20000, polling: 200 }).catch(() => {});
await p.waitForTimeout(500);
const sideways = await p.evaluate(() => {
  const pane = document.querySelector(".bp-web-scroll");
  if (!pane) return null;
  const pr = pane.getBoundingClientRect();
  const sel = pane.querySelector(".bp-node.selected")?.getBoundingClientRect();
  const cut = [...pane.querySelectorAll(".bp-node:not(.hint)")].map((n) => n.getBoundingClientRect()).filter((r) => r.left < pr.left - 1 && r.right > pr.left + 1).length;
  return { scrollLeft: pane.scrollLeft, cut, selInView: !!sel && sel.left >= pr.left - 1 && sel.right <= pr.right + 1 };
});
await shot("09e-web-sideways");
check("on its side (844×390) the web opens on the picked tag, no card cut at its left edge", !!sideways && sideways.cut === 0 && sideways.selInView, JSON.stringify(sideways));
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(800);
// Every chip's amount appears in the cost line, its good named: "\uE000 0/5" → "5 \uE000 planks"; "🪙 40" → "40 🪙 coins".
const chipsInWords = (w) => !!w && w.chips.length > 0 && w.chips.every((c) => {
  const m = c.text.match(/^(\S+) (?:\d+\/)?(\d+)$/);
  return m && w.cost.includes(`${m[2]} ${m[1]} `) && c.title.length > 0;
});
check("tap Routes and signals: it says what it unlocks, and its full cost (goods and coins) in words", /^Unlocks: Signal, .*Routes on the engine card/.test(routesWords?.unlocks ?? "") && /^Costs: \d+ \uE000 planks, 40 🪙 coins$/.test(routesWords?.cost ?? "") && chipsInWords(routesWords), JSON.stringify(routesWords));
check("tap Bridges (under way): unlocks named, every good it needs in the cost line", /^Unlocks: \S/.test(bridgesWords?.unlocks ?? "") && /^Costs: 10 \uE000 planks/.test(bridgesWords?.cost ?? "") && chipsInWords(bridgesWords), JSON.stringify(bridgesWords));
check("a learned card names what it unlocked, and no cost", /^Unlocks: Switch, Y switch/.test(learnedWords?.unlocks ?? "") && learnedWords.cost === undefined, JSON.stringify(learnedWords));
check("the tag's tooltip says the same (hover on desktop)", routesWords?.title === `Routes and signals. Unlocks: ${routesWords?.unlocks?.replace(/^Unlocks: /, "")}. ${routesWords?.cost}`, String(routesWords?.title));
check("…and the ticket fits a 360 px phone, nothing sideways", routesWords?.fits && bridgesWords?.fits && learnedWords?.fits, JSON.stringify([routesWords?.fits, bridgesWords?.fits, learnedWords?.fits]));
const coinChip = await p.evaluate(() => {
  const node = [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === "Routes and signals");
  return node?.className;
});
check("the web's tag for the one up next", /\bnext\b/.test(coinChip ?? ""), String(coinChip));
// Open, with coins and counted loads coming in (what running trains do) short of anything it shows: the picker isn't
// rebuilt (QA: it was, every second).
const rebuilt = await p.evaluate(async () => {
  const w = window.woodrail;
  let web = 0;
  let sheet = 0;
  const a = new MutationObserver(() => web++);
  const b = new MutationObserver(() => sheet++);
  a.observe(document.querySelector(".board-body"), { childList: true });
  b.observe(document.querySelector(".board-sheet"), { childList: true });
  const p = w.progress();
  // (Above every price: what the one up next is short doesn't change either.)
  p.coins = 1000;
  w.hud.setCoins(1000);
  await new Promise((r) => setTimeout(r, 1200));
  web = sheet = 0;
  for (let i = 0; i < 8; i++) {
    p.coins += 1;
    w.hud.setCoins(p.coins);
    w.economy.loadsMoved++;
    await new Promise((r) => setTimeout(r, 500));
  }
  a.disconnect();
  b.disconnect();
  return { web, sheet };
});
check("open, coins and loads coming in: the picker isn't rebuilt", rebuilt.web === 0 && rebuilt.sheet === 0, JSON.stringify(rebuilt));
await shot("10-picker-web");
await board(false);

// 6b. Nothing under way, the one up next waiting for coins: the pill shows it, and a tap opens the picker on it, not on
// the goal's research nor the card shown last (QA P5: "…10/40🪙" opened on another research).
await p.evaluate(() => {
  const w = window.woodrail;
  const pr = w.progress();
  const r = pr.research;
  r.held.set(r.current, { got: r.got, study: r.study });
  r.current = null;
  r.got = {};
  r.study = 0;
  r.next = "routes";
  pr.coins = 10;
  r.version++;
  w.hud.setCoins(10);
});
await p.waitForTimeout(700);
check("nothing under way, Routes and signals waiting for coins: the pill shows them", (await pill()) === "📘 Routes and signals 🪙10/40", String(await pill()));
await board(true);
await select("Junctions and loops");
await board(false);
await board(true);
t = await ticket();
check("…and a tap on it opens the picker on Routes and signals", t?.name === "Routes and signals" && t.state === "next", JSON.stringify(t));
await shot("10a-pill-waiting-for-coins");
await board(false);
await p.evaluate(() => {
  const w = window.woodrail;
  const pr = w.progress();
  const r = pr.research;
  const held = r.held.get("bridges");
  r.held.delete("bridges");
  r.current = "bridges";
  r.got = held.got;
  r.study = held.study;
  pr.coins = 1000;
  r.version++;
  w.hud.setCoins(1000);
});
await p.waitForTimeout(700);

// 7. The bar with the pill under way (it stands in for the Research button on a phone), with a four-figure purse. (A
// town's reward no longer glows here: it waits in the growth sheet, with its own badge. See e2e:growth.)
m = await bar();
check("the pill under way fits the bar, its name whole", fits(m) && !m.clipped, JSON.stringify(m));
const button = await p.evaluate(() => getComputedStyle(document.querySelector(".research-btn")).display);
check("…standing in for the Research button", button === "none", button);
await shot("10b-pill-under-way");
await p.evaluate(() => {
  window.woodrail.progress().coins = 1250;
  window.woodrail.hud.setCoins(1250);
});
await p.waitForTimeout(300);
m = await bar();
check("…with 1250 coins showing", fits(m) && !m.clipped, JSON.stringify(m));

// 7b. The date beside the coins with the pill showing, on a small phone, a large one and a phone on its side: the date
// whole (not cut by the brand's edge), the pill clear of the brand and the buttons, its count whole, the name whole (at 360,
// if it's cut, 50 px of it).
for (const [width, height, whole] of [[360, 740, false], [414, 896, true], [844, 390, true]]) {
  await p.setViewportSize({ width, height });
  await p.waitForTimeout(1500);
  const d = await p.evaluate(() => {
    const brand = document.querySelector(".brand").getBoundingClientRect();
    const date = document.querySelector(".game-date");
    const r = date.getBoundingClientRect();
    const name = document.querySelector(".research-pill .rp-name");
    const count = document.querySelector(".research-pill .rp-count");
    const pill = document.querySelector(".research-pill").getBoundingClientRect();
    return { text: date.textContent, shown: !date.hidden && r.width > 0, cut: r.left < brand.left || r.right > brand.right + 0.5 || date.scrollWidth > date.clientWidth, name: name.clientWidth, nameClipped: name.scrollWidth > name.clientWidth, count: count.textContent, countCut: count.getBoundingClientRect().right > pill.right + 0.5 || count.scrollWidth > count.clientWidth + 0.5 };
  });
  m = await bar();
  const ok = d.shown && /^[A-Z][a-z]{2} \d{4}$/.test(d.text) && !d.cut && fits(m) && !d.countCut && (!d.nameClipped || (!whole && d.name >= 50));
  check(`at ${width}×${height} the date and the pill both read`, ok, JSON.stringify({ ...d, ...m }));
  await shot(`11b-date-pill-${width}x${height}`);
}
// 7c. A research needing three goods (none does yet: Bridges is given grain and iron too, in the page): the pill lists
// every good it lacks, or, short of room, the one most lacking and "+N" for the rest. Never a good cut off unsaid, at
// 360 and 390 (phones held upright) and 1440 (a desktop, where all three show); its tooltip names all three.
await p.evaluate(async () => {
  const { techOf } = await import("/src/game/tech.ts");
  const goods = techOf("bridges").research.goods;
  goods.grain = 6;
  goods.iron = 10;
  window.woodrail.progress().research.version++;
});
for (const [width, height, all] of [[360, 740, false], [390, 844, false], [1440, 900, true]]) {
  await p.setViewportSize({ width, height });
  await p.waitForTimeout(1800);
  const c = await p.evaluate(async () => {
    const { costOf } = await import("/src/game/research.ts");
    const { GOODS_ICON } = await import("/src/economy/cargo.ts");
    const r = window.woodrail.progress().research;
    const goods = costOf(r.current).goods;
    const lacking = Object.keys(goods).filter((k) => (r.got[k] ?? 0) < goods[k]).map((k) => GOODS_ICON[k]);
    const el = document.querySelector(".research-pill");
    const count = el.querySelector(".rp-count");
    const text = count.textContent;
    const shown = lacking.filter((i) => text.includes(i));
    const plus = Number(/\+(\d+)( more)?$/.exec(text)?.[1] ?? 0);
    const pr = el.getBoundingClientRect();
    return { text, title: el.title, lacking, shown, plus, cut: count.scrollWidth > count.clientWidth + 1 || count.scrollHeight > count.clientHeight + 1 || count.getBoundingClientRect().right > pr.right + 0.5 || count.getBoundingClientRect().bottom > pr.bottom + 0.5, nameGave: el.classList.contains("rp-goods") };
  });
  m = await bar();
  const ok = c.lacking.length === 3 && !c.cut && c.shown.length + c.plus === c.lacking.length && (!all || c.shown.length === 3) && ["planks", "grain", "iron"].every((g) => c.title.includes(g)) && fits(m);
  check(`at ${width}×${height} a research needing 3 goods: every one shown or counted (+N), none cut`, ok, JSON.stringify({ ...c, ...m }));
  await shot(`11c-pill-three-goods-${width}`);
}
await p.evaluate(async () => {
  const { techOf } = await import("/src/game/tech.ts");
  const goods = techOf("bridges").research.goods;
  delete goods.grain;
  delete goods.iron;
  window.woodrail.progress().research.version++;
});
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(800);

// 8. Idle with the pill showing (research waiting on goods, no trains): no frames in 30 s.
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
  w.invalidate();
  await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
  const pill = document.querySelector(".research-pill").textContent;
  const f0 = w.framesDrawn;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 30000));
  return { frames: w.framesDrawn - f0, seconds: Math.round((performance.now() - t0) / 100) / 10, pill };
});
check("idle with the pill showing: no frames drawn in 30 s", idle.frames === 0, JSON.stringify(idle));
await shot("12-idle-pill");

// 9. A research learned with nothing in Next up: the school is idle. The pill turns amber with a pulsing dot, a toast
// says so once (a tap opens the picker), the school's card says Idle with a button for the picker, and 30 s idle with
// the dot pulsing draws no frames (it's CSS over the canvas).
const boardOpen = () => p.evaluate(() => !!document.querySelector(".board-open"));
await p.evaluate(() => {
  const w = window.woodrail;
  const r = w.progress().research;
  // Nothing up next (Routes and signals was waiting there).
  r.next = null;
  r.version++;
  window.__toasts = [];
  const t = document.querySelector(".toast");
  new MutationObserver(() => {
    if (t.classList.contains("show") && window.__toasts.at(-1) !== t.textContent) window.__toasts.push(t.textContent);
    if (!t.classList.contains("show")) window.__toasts.push("");
  }).observe(t, { attributes: true, attributeFilter: ["class"] });
});
const pillIdle = () => p.evaluate(() => {
  const el = document.querySelector(".research-pill");
  return { cls: el.className, text: `📘 ${el.querySelector(".rp-name").textContent} ${el.querySelector(".rp-count").textContent}`, dot: getComputedStyle(el, "::after").animationName, bg: getComputedStyle(el).backgroundColor };
});
check("…before it's learned: not idle", !(await pillIdle()).cls.includes("idle"), JSON.stringify(await pillIdle()));
await deliver(10);
await p.waitForFunction(() => window.woodrail.progress().learned.has("bridges"), null, { timeout: 180000 });
await p.waitForTimeout(800);
const idlePill = await pillIdle();
check("Bridges learned with nothing up next: the pill says Pick research, amber, its dot pulsing", idlePill.text === "📘 Pick research" && /\bidle\b/.test(idlePill.cls) && idlePill.dot === "idle-pulse" && idlePill.bg === "rgb(255, 241, 194)", JSON.stringify(idlePill));
// The toast, after the Learned one: "<school> is idle: pick what to learn next".
const idleToast = await p
  .waitForFunction(() => {
    const t = document.querySelector(".toast");
    return t.classList.contains("show") && / is idle: pick what to learn next$/.test(t.textContent) ? t.textContent : null;
  }, null, { timeout: 30000, polling: 100 })
  .then((h) => h.jsonValue())
  .catch(() => null);
check("…a toast says the school is idle", /^[A-Z].* is idle: pick what to learn next$/.test(idleToast ?? ""), String(idleToast));
await p.waitForTimeout(500);
await shot("13-idle-toast");
await shot("13-idle-pill");
await tap(".toast");
await p.waitForTimeout(600);
check("…tapping the toast opens the picker", await boardOpen(), "");
await tap(".board-head .close");
await p.waitForTimeout(600);
check("…closed again", !(await boardOpen()), "");
// The school's card: Idle, and a button for the picker.
await p.evaluate(() => {
  const w = window.woodrail;
  w.interaction.openDepot(w.economy.allDepots().find((x) => x.role === "school").id);
});
await p.waitForTimeout(800);
const card = await p.evaluate(() => {
  const c = document.querySelector(".depot-card");
  const btn = c.querySelector(".depot-pick");
  return { shown: !c.hidden, stock: c.querySelector(".depot-stock").textContent, idle: c.querySelector(".depot-stock").classList.contains("idle"), button: btn && !btn.hidden ? btn.textContent : null, h: btn?.offsetHeight };
});
check("…the school's card says Idle: pick research, with a Research button", card.shown && card.stock === "Idle: pick research" && card.idle && card.button === "📘 Research" && card.h >= 44, JSON.stringify(card));
await shot("14-idle-school-card");
await tap(".depot-card .depot-pick");
await p.waitForTimeout(600);
check("…its button opens the picker", await boardOpen(), "");
await tap(".board-head .close");
await p.waitForTimeout(600);
// Once per finish: a while later (the workshop's clock asks every second), the toast hasn't come again.
await p.waitForTimeout(8000);
const toasts = await p.evaluate(() => window.__toasts.filter((t) => / is idle: /.test(t)));
check("…the idle toast showed once", toasts.length === 1, JSON.stringify(toasts));
// Tapping the pill opens the picker too; closed with nothing picked, the dot pulses again (a few times, then rests).
await tap(".research-pill");
await p.waitForTimeout(600);
check("…and so does the pill", await boardOpen(), "");
await tap(".board-head .close");
// Idle 30 s from there, the dot pulsing: no frames drawn.
const idle2 = await p.evaluate(async () => {
  const w = window.woodrail;
  const el = document.querySelector(".research-pill");
  const pulse = () => document.getAnimations().find((a) => a.animationName === "idle-pulse")?.playState ?? "none";
  // (The picker closing draws once: from when that's done.)
  await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 5000))]);
  const f0 = w.framesDrawn;
  const t0 = performance.now();
  const at0 = pulse();
  await new Promise((r) => setTimeout(r, 30000));
  return { frames: w.framesDrawn - f0, seconds: Math.round((performance.now() - t0) / 100) / 10, pulseAtStart: at0, pulseAtEnd: pulse(), idle: el.classList.contains("idle") };
});
check("idle 30 s with the pill's dot pulsing: no frames drawn", idle2.frames === 0 && idle2.pulseAtStart === "running" && idle2.idle, JSON.stringify(idle2));
check("…and the dot rests after a few pulses (nothing runs on)", idle2.pulseAtEnd !== "running", idle2.pulseAtEnd);
// Reduced motion: the dot stays still.
await p.emulateMedia({ reducedMotion: "reduce" });
const still = await p.evaluate(() => getComputedStyle(document.querySelector(".research-pill"), "::after").animationName);
check("…with reduced motion the dot doesn't pulse", still === "none", still);
await p.emulateMedia({ reducedMotion: "no-preference" });

// 10. Chains (a research that needs one not learned yet): Mills needs Farming. Queued in one tap, Farming first; never
// "Research now" while Farming isn't learned, "Research Farming now" instead; taking Farming out takes Mills too, with
// a toast; and the chain runs through: Farming learned, then Mills researched and learned (the payoff).
await tap(".research-pill");
await select("Mills");
t = await ticket();
check("chain, idle: Mills (needs Farming) offers Research Farming now, then Mills", t?.state === "locked" && queuedButtons(t) === "Research Farming now" && /Then Mills/.test(t.foot) && t.buttons.every((x) => x.h >= 44), JSON.stringify(t));
await shot("15-chain-idle");
await select("Junctions and loops");
await tap(".board-sheet button[data-act=pick]", "Research");
await select("Mills");
t = await ticket();
check("chain, one under way: Queue Farming, then Mills", t?.state === "locked" && queuedButtons(t) === "Queue Farming, then Mills" && !t.foot.includes("Research now"), JSON.stringify(t));
await tap(".board-sheet button[data-act=pick]", "Queue Farming, then Mills");
check("…one tap queues Farming, then Mills, behind Junctions", JSON.stringify(await queued()) === JSON.stringify(["junctions", "farming", "mills"]), JSON.stringify(await queued()));
check("…the web's tags: Farming Next up, Mills In line: 2", (await webTag("Farming")) === "Next up" && (await webTag("Mills")) === "In line: 2", `${await webTag("Farming")} / ${await webTag("Mills")}`);
t = await ticket();
check("…Mills queued: Remove and Research Farming now, never Research now", t?.state === "next" && queuedButtons(t) === "✕ Remove|Research Farming now" && /2nd in line, after Farming/.test(t.foot), JSON.stringify(t));
await shot("16-chain-queued");
const savedChain = await p
  .waitForFunction(() => {
    const r = JSON.parse(localStorage.getItem("woodrail.game.progress.v1") ?? "null")?.research;
    return r?.next === "farming" && r.later?.[0] === "mills" ? r : null;
  }, null, { timeout: 15000, polling: 250 })
  .then((h) => h.jsonValue())
  .catch(() => null);
check("…saved in order, Farming before Mills", savedChain !== null, JSON.stringify(savedChain));
// Farming out: Mills goes too, and a toast says so.
await select("Farming");
await tap(".board-sheet button[data-act=pick]", "✕ Remove");
const removedToast = await p
  .waitForFunction(() => {
    const t = document.querySelector(".toast");
    return t.classList.contains("show") && /^Removed /.test(t.textContent) ? t.textContent : null;
  }, null, { timeout: 10000, polling: 100 })
  .then((h) => h.jsonValue())
  .catch(() => null);
check("removing Farming takes Mills out too, with a toast", JSON.stringify(await queued()) === JSON.stringify(["junctions"]) && removedToast === "Removed Mills too", JSON.stringify([await queued(), removedToast]));
await shot("17-chain-removed-toast");
// Back in, then Research Farming now: Farming swaps in, Junctions waits up next, Mills behind.
await select("Mills");
await tap(".board-sheet button[data-act=pick]", "Queue Farming, then Mills");
await tap(".board-sheet button[data-act=now]", "Research Farming now");
check("Research Farming now: Farming under way, Junctions up next, Mills after", JSON.stringify(await queued()) === JSON.stringify(["farming", "junctions", "mills"]), JSON.stringify(await queued()));
t = await ticket();
check("…Mills, Farming under way: only Remove (it waits for Farming)", t?.name === "Mills" && t.state === "next" && queuedButtons(t) === "✕ Remove", JSON.stringify(t));
await shot("18-chain-waits");
await tap(".board-head .close");
// The payoff: Farming's goods in and studied, learned; Mills' plain Research now; Mills researched and learned.
const deliverGoods = (bag) =>
  p.evaluate((bag) => {
    const w = window.woodrail;
    const school = w.economy.allDepots().find((d) => d.role === "school");
    for (const [k, n] of Object.entries(bag)) for (let i = 0; i < n; i++) w.economy.intoSink(school, k);
  }, bag);
await deliverGoods({ planks: 6 });
await p.waitForFunction(() => window.woodrail.progress().learned.has("farming"), null, { timeout: 90000 }).catch(() => null);
await p.waitForTimeout(600);
check("Farming learned; Junctions started from the queue, Mills next", JSON.stringify(await queued()) === JSON.stringify(["junctions", "mills"]), JSON.stringify(await queued()));
await tap(".research-pill");
await select("Mills");
t = await ticket();
check("…now Mills says Research now", queuedButtons(t) === "✕ Remove|Research now", JSON.stringify(t));
await tap(".board-sheet button[data-act=now]", "Research now");
check("…a tap starts Mills", (await queued())[0] === "mills", JSON.stringify(await queued()));
await tap(".board-head .close");
await deliverGoods({ planks: 6, grain: 6 });
await p.waitForFunction(() => window.woodrail.progress().learned.has("mills"), null, { timeout: 150000 }).catch(() => null);
check("…and Mills is learned (the mill is unlocked)", await p.evaluate(() => window.woodrail.progress().learned.has("mills")), JSON.stringify(await queued()));

// 11. The next nodes (tech-tree spec "Next nodes"): Orchards and Dairy farm learned (a setup shortcut: they need a city,
// which isn't under test), then Juice works' ticket says what it unlocks and its cost in words; Creamery, then the
// Cold van (needs Creamery), researched by taps and deliveries to the school: both learned (the payoff).
await p.evaluate(() => {
  const w = window.woodrail;
  for (const id of ["orchard", "dairy"]) w.learn(id);
  const pr = w.progress();
  pr.coins = 1000;
  w.hud.setCoins(pr.coins);
});
// (Opened by the pill and waited for, as `board` does: a tap that lands while a toast goes may not open it.)
await board(true);
await p.setViewportSize({ width: 360, height: 780 });
await p.waitForTimeout(400);
const juiceWords = await words("Juice works");
check("Juice works: unlocks the juice works, costs 8 planks and 120 coins, in words, fitting 360 px", /^Unlocks: Juice works/.test(juiceWords?.unlocks ?? "") && /^Costs: 8 \uE000 planks, 120 🪙 coins$/.test(juiceWords?.cost ?? "") && chipsInWords(juiceWords) && juiceWords.fits, JSON.stringify(juiceWords));
await shot("19-juice-works-360");
await p.setViewportSize({ width: 390, height: 844 });
await p.waitForTimeout(400);
await tap(".board-head .close");
// Creamery (shown: Dairy farm is learned) by taps, Research now, its goods brought: learned. Only then is the Cold van
// shown by name (a "?" while what it needs isn't learned), and it's researched the same way.
const researchByTaps = async (name, id, planks = 12) => {
  await tap(".research-pill");
  await select(name);
  const first = await ticket();
  await tap(".board-sheet button[data-act=pick]", first?.buttons[0]?.text);
  if ((await queued())[0] !== id) await tap(".board-sheet button[data-act=now]", "Research now");
  const under = (await queued())[0];
  await tap(".board-head .close");
  await deliverGoods({ planks });
  await p.waitForFunction((id) => window.woodrail.progress().learned.has(id), id, { timeout: 150000 }).catch(() => null);
  return { first, under };
};
const cream = await researchByTaps("Creamery", "creamery");
check("Creamery: a tap and Research now start it", cream.first?.name === "Creamery" && cream.under === "creamery", JSON.stringify(cream));
await shot("20-creamery-learned");
const cold = await researchByTaps("Cold van", "reefer");
check("…then the Cold van is shown, and taps start it", cold.first?.name === "Cold van" && cold.under === "reefer", JSON.stringify(cold));
const payoff = await p.evaluate(() => {
  const w = window.woodrail;
  const learned = w.progress().learned;
  return { creamery: learned.has("creamery"), reefer: learned.has("reefer") };
});
check("…Creamery and then Cold van researched and learned (the creamery and the cold van unlocked)", payoff.creamery && payoff.reefer, JSON.stringify([payoff, await queued()]));

// 12. Tech tree 3, and research studied only at a College or a University. Setup shortcut (not under test): what the
// nodes need learned (the foundry's chain, the College blueprint, harbours), 20 iron delivered (the car factory's), coins
// to start them, and the school's town grown by its deliveries set as trains would bring them (as e2e:school-growth
// does). Beside a village the school is a schoolhouse: the Car carrier is locked, saying it needs a College and what to
// do. Grown to a city it's a College in a city: the Car carrier opens, and is researched there; the Car factory then
// waits for a University. The University researched by taps: the College is a University, the Car factory opens, every
// hard lesson needs a third fewer goods (Fishing boats' 8 planks: 6), and the board shows every blueprint. Then the Car
// factory and Fishing boats researched by taps and deliveries; the car carrier on the Wagons shelf and the car factory
// unlocked on the Industries shelf.
const growSchoolTown = (planks, flour) =>
  p.evaluate(
    ([planks, flour]) => {
      const w = window.woodrail;
      const school = w.economy.allDepots().find((d) => d.role === "school");
      w.economy.delivered.set(school.townId, planks);
      w.economy.deliveredGoods.set(school.townId, { ...(w.economy.deliveredGoods.get(school.townId) ?? {}), planks, flour });
      w.invalidate();
    },
    [planks, flour],
  );
await p.evaluate(() => {
  const w = window.woodrail;
  for (const id of ["tank", "goods-engine", "quarries", "mines", "foundry", "routes", "warehouses", "college", "harbours", "passengers", "halts"]) w.learn(id);
  const pr = w.progress();
  pr.counts.set("delivered:iron", 20);
  pr.coins = 3000;
  w.hud.setCoins(pr.coins);
});
await growSchoolTown(4, 0);
await p.waitForFunction(() => !window.woodrail.progress().landmarks.has("college-school"), null, { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(1200);
// (The setup's learns raise toasts, and growth a sheet: let them go before tapping, as a player would.)
const quiet = async () => {
  await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
  await p.waitForFunction(() => !document.querySelector(".toast.show"), null, { timeout: 20000, polling: 250 }).catch(() => {});
};
/** Open the picker on a card by its name: tried again (closed and opened) if the first go doesn't show it. */
const openOn = async (name) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await quiet();
    await board(true);
    if (await select(name)) return true;
    await board(false);
  }
  return false;
};
await openOn("Car carrier");
t = await ticket();
check("beside a village, the Car carrier is locked: it needs a College in a city, and says to grow the town", t?.state === "locked" && /a College in a city: grow \w+ into a city/.test(t.foot) && t.buttons.length === 0, JSON.stringify(t));
// …and in the web its tag says so in place of its price, inside its node.
const nodeTagOf = (name) =>
  p.evaluate((name) => {
    const n = [...document.querySelectorAll(".board-body .bp-node")].find((x) => x.querySelector(".bp-name")?.textContent === name);
    const tag = n?.querySelector(".bp-tag");
    if (!n || !tag) return null;
    const a = n.getBoundingClientRect();
    const b = tag.getBoundingClientRect();
    return { text: tag.textContent, school: tag.classList.contains("school"), inside: b.left >= a.left - 0.5 && b.right <= a.right + 0.5 };
  }, name);
const carTag = await nodeTagOf("Car carrier");
check("…its node's tag says 🎓 College in place of its price, inside the node", carTag?.school && carTag.text === "🎓 College" && carTag.inside, JSON.stringify(carTag));
await shot("21-gated-needs-a-college");
await board(false);
await growSchoolTown(26, 6);
const college = await p
  .waitForFunction(() => ["college-school", "city-school"].every((id) => window.woodrail.progress().landmarks.has(id)), null, { timeout: 30000 })
  .then(() => true, () => false);
await p.waitForTimeout(1200);
await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
check("grown to a city, the school is a College (and has its library wing)", college);
await openOn("Car carrier");
t = await ticket();
check("…and the Car carrier opens there", t?.state === "ready" && t.buttons.length === 1, JSON.stringify(t));
const planksOf = (t) => Number(/\uE000\s*0\/(\d+)/.exec(t?.foot ?? "")?.[1] ?? NaN);
await select("Fishing boats");
const fishPlanksBefore = planksOf(await ticket());
await board(false);
const carrier = await researchByTaps("Car carrier", "car-carrier");
check("Car carrier: researched at the College by taps and learned", carrier.first?.name === "Car carrier" && (await p.evaluate(() => window.woodrail.progress().learned.has("car-carrier"))), JSON.stringify(carrier));
await board(true);
await select("Car factory");
t = await ticket();
check("…the Car factory waits for a University", t?.state === "locked" && /a University: learn University/.test(t.foot) && t.buttons.length === 0, JSON.stringify(t));
const factoryTag = await nodeTagOf("Car factory");
check("…its node's tag says 🏛️ University, inside the node", factoryTag?.school && factoryTag.text === "🏛️ University" && factoryTag.inside, JSON.stringify(factoryTag));
await shot("21b-gated-needs-a-university");
// (Unseen blueprints aren't drawn at all; a "?" is drawn as a hint.)
const hints = () => p.evaluate(() => ({ nodes: document.querySelectorAll(".board-body .bp-node").length, hints: document.querySelectorAll(".board-body .bp-node.hint").length }));
const hintsBefore = await hints();
await board(false);
const learnedCount = await p.evaluate(() => window.woodrail.progress().learned.size);
check("setup: 20 or more blueprints learned (the University asks for 20)", learnedCount >= 20, String(learnedCount));
const uni = await researchByTaps("University", "university", 14);
check("University: a tap and Research now start it, and it's learned", uni.first?.name === "University" && uni.under === "university" && (await p.evaluate(() => window.woodrail.progress().learned.has("university"))), JSON.stringify(uni));
await p.waitForFunction(() => window.woodrail.progress().landmarks.has("university-school"), null, { timeout: 30000 }).catch(() => {});
await board(true);
await select("Fishing boats");
const fishPlanksAfter = planksOf(await ticket());
check("…every hard lesson needs a third fewer goods (Fishing boats' planks)", fishPlanksBefore === 8 && fishPlanksAfter === 6, `${fishPlanksBefore} → ${fishPlanksAfter}`);
await select("Car factory");
t = await ticket();
check("…the College is a University now: the Car factory opens", t?.state === "ready" && t.buttons.length === 1, JSON.stringify(t));
const openTag = await nodeTagOf("Car factory");
check("…and its tag is its price again", openTag && !openTag.school && /220/.test(openTag.text), JSON.stringify(openTag));
const hintsAfter = await hints();
check("…and the board shows every blueprint: more on it, no \"?\" left", hintsAfter.nodes > hintsBefore.nodes && hintsAfter.hints === 0, `${JSON.stringify(hintsBefore)} → ${JSON.stringify(hintsAfter)}`);
await shot("21c-tech-tree-3-board");
await board(false);
const factory = await researchByTaps("Car factory", "car-factory");
check("Car factory: researched by taps and learned (at the University)", factory.first?.name === "Car factory" && (await p.evaluate(() => window.woodrail.progress().learned.has("car-factory"))), JSON.stringify(factory));
const fish = await researchByTaps("Fishing boats", "fishing");
check("Fishing boats: researched by taps and learned", fish.first?.name === "Fishing boats" && (await p.evaluate(() => window.woodrail.progress().learned.has("fishing"))), JSON.stringify(fish));
// The payoff on the tray: the car carrier on the Trains tab's Wagons shelf, the car factory not locked.
const trayLocked = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tray-item[data-key]")].map((b) => [b.dataset.key, b.classList.contains("locked")])));
await tap(".tabs button", "Trains");
await tap(".tray-item.tray-group", "Wagons");
const wagons = await trayLocked();
check("the car carrier is on the Wagons shelf", wagons["train:Car carrier"] === false, JSON.stringify(wagons));
await shot("22-car-carrier-wagons-shelf");
await tap(".tabs button", "Industries");
await tap(".tray-item.tray-group", "Industries");
const industries = await trayLocked();
check("the car factory is on the Industries shelf, unlocked", industries["piece:depot-carworks"] === false, JSON.stringify(industries));

// 13. Tank wagons and the Breakdown crane (claude/tank-crane). Setup shortcut (not under test): what the crane needs
// learned (Goods engine, Quicker cranes; Dairy farm is already). Both researched by taps and deliveries; the payoff on the
// tray: the tank wagon and the breakdown crane on the Wagons shelf, the oil well and the water pump unlocked.
await p.evaluate(() => {
  const w = window.woodrail;
  for (const id of ["goods-engine", "cranes1"]) if (!w.progress().learned.has(id)) w.learn(id);
  const pr = w.progress();
  pr.coins = Math.max(pr.coins, 1000);
  w.hud.setCoins(pr.coins);
});
const tanks = await researchByTaps("Tank wagons", "tankers");
check("Tank wagons: researched by taps and learned", tanks.first?.name === "Tank wagons" && (await p.evaluate(() => window.woodrail.progress().learned.has("tankers"))), JSON.stringify(tanks));
const crane = await researchByTaps("Breakdown crane", "breakdown");
check("Breakdown crane: researched by taps and learned", crane.first?.name === "Breakdown crane" && (await p.evaluate(() => window.woodrail.progress().learned.has("breakdown"))), JSON.stringify(crane));
await tap(".tabs button", "Trains");
await tap(".tray-item.tray-group", "Wagons");
const wagons2 = await trayLocked();
check("the tank wagon and the breakdown crane are on the Wagons shelf", wagons2["train:Tank wagon"] === false && wagons2["train:Breakdown crane"] === false, JSON.stringify(wagons2));
await shot("23-tank-crane-wagons-shelf");
await tap(".tabs button", "Industries");
await tap(".tray-item.tray-group", "Industries");
const industries2 = await trayLocked();
check("the oil well and the water pump are on the Industries shelf, unlocked", industries2["piece:depot-oilwell"] === false && industries2["piece:depot-waterpump"] === false, JSON.stringify(industries2));
// 14. The goods chains (2026-11-04): Sugar beet, Jam kitchen, Chocolate factory, Dye works and Toy workshop researched
// by taps and deliveries to the school (now a University in a city). Setup shortcut (not under test): what they need
// first that isn't theirs (Juice works, Carpenter's bench) learned, and the 20 furniture the Toy workshop asks for
// counted as delivered. Before Dye works the Toy workshop is a "?"/locked; after, it opens at the University. The payoff:
// all six buildings unlocked on the Industries shelf.
await p.evaluate(() => {
  const w = window.woodrail;
  for (const id of ["juice", "carpentry"]) w.learn(id);
  const pr = w.progress();
  pr.counts.set("delivered:furniture", 20);
  pr.coins = 3000;
  w.hud.setCoins(pr.coins);
});
await tap(".tabs button", "Trains");
for (const [name, id] of [["Sugar beet", "sugar"], ["Jam kitchen", "jam"], ["Chocolate factory", "chocolate"], ["Dye works", "paint"], ["Toy workshop", "toys"]]) {
  const r = await researchByTaps(name, id);
  check(`${name}: researched by taps and learned`, r.first?.name === name && (await p.evaluate((id) => window.woodrail.progress().learned.has(id), id)), JSON.stringify(r));
}
await board(true);
await select("Toy workshop");
await shot("25-goods-chains-board");
await board(false);
await tap(".tabs button", "Industries");
await tap(".tray-item.tray-group", "Industries");
const chainShelf = await trayLocked();
const chainPieces = ["depot-beet", "depot-jam", "depot-chocolate", "depot-flowers", "depot-dyeworks", "depot-toyworks"];
check("the goods chains' six buildings are on the Industries shelf, unlocked", chainPieces.every((t) => chainShelf[`piece:${t}`] === false), JSON.stringify(chainPieces.map((t) => [t, chainShelf[`piece:${t}`]])));
await shot("26-goods-chains-industries-shelf");

// 15. Tech tree 4. The Reading room researched by taps (College is learned). Then Telegraph tapped: one tap queues
// Signal boxes, then Telegraph (Routes and signals is learned). One delivery of 10 planks: Signal boxes takes its 4 and
// the school reads ahead for Telegraph with the other 6 (its card says so); Signal boxes learned, Telegraph starts with
// its goods all in and is learned with nothing more brought (the payoff: no gap between the two). The signal box and
// the telegraph pole on the tray's Lineside shelf, unlocked. Then Mines II, Foundry II and Joinery by taps at the
// College (setup shortcut, not under test: the coal dug, iron cast and furniture delivered they ask for).
await p.evaluate(() => {
  const w = window.woodrail;
  const pr = w.progress();
  pr.coins = 3000;
  pr.counts.set("coalDug", 60);
  pr.counts.set("ironCast", 40);
  pr.counts.set("delivered:furniture", 30);
  w.learn("carpentry");
  // (What earlier steps left under way or queued: learned, so this step starts with the school idle.)
  const r = pr.research;
  for (const id of [r.current, r.next, ...r.later]) if (id) w.learn(id);
  w.hud.setCoins(pr.coins);
});
await p.waitForFunction(() => window.woodrail.progress().research.current === null, null, { timeout: 30000 }).catch(() => {});
const readingRoom = await researchByTaps("Reading room", "reading-room", 6);
check("Reading room: researched by taps and learned", readingRoom.first?.name === "Reading room" && (await p.evaluate(() => window.woodrail.progress().learned.has("reading-room"))), JSON.stringify(readingRoom));
await quiet();
await board(true);
await select("Telegraph");
t = await ticket();
check("Telegraph: one tap queues Signal boxes, then Telegraph", /Signal boxes/.test(t?.buttons[0]?.text ?? ""), JSON.stringify(t));
await tap(".board-sheet button[data-act=pick]", t?.buttons[0]?.text);
check("…Signal boxes under way, Telegraph up next", JSON.stringify(await queued()) === JSON.stringify(["signal-boxes", "telegraph"]), JSON.stringify(await queued()));
await shot("23-signal-boxes-then-telegraph");
await board(false);
await p.evaluate(() => (window.woodrail.paused = true));
await deliverGoods({ planks: 10 });
const ahead = await p.evaluate(() => {
  const r = window.woodrail.progress().research;
  return { got: r.got.planks ?? 0, early: r.early.get("telegraph")?.planks ?? 0 };
});
check("…10 planks: 4 into Signal boxes, 6 read ahead for Telegraph", ahead.got === 4 && ahead.early === 6, JSON.stringify(ahead));
// The school's card says what it's reading ahead.
const schoolNote = await p.evaluate(async () => (await import("/src/game/research-text.ts")).schoolCard(window.woodrail.progress()).note);
check("…the school's card says it's reading ahead for Telegraph", /Reading ahead for Telegraph: \uE0006\/6/.test(schoolNote ?? ""), String(schoolNote));
await p.evaluate(() => (window.woodrail.paused = false));
await p.waitForFunction(() => window.woodrail.progress().learned.has("telegraph"), null, { timeout: 200000 }).catch(() => null);
const both = await p.evaluate(() => ({ boxes: window.woodrail.progress().learned.has("signal-boxes"), telegraph: window.woodrail.progress().learned.has("telegraph") }));
check("…Signal boxes and then Telegraph learned, Telegraph with nothing more brought", both.boxes && both.telegraph, JSON.stringify(both));
await quiet();
await tap(".tabs button", "Industries");
await tap(".tray-item.tray-group", "Lineside");
const lineside = await trayLocked();
check("the signal box and the telegraph pole are on the Lineside shelf, unlocked", lineside["prop:bldg-signal-box"] === false && lineside["prop:mech-telegraph-pole"] === false, JSON.stringify(lineside));
await shot("24-lineside-telegraph");
for (const [name, id] of [
  ["Mines II", "mines2"],
  ["Foundry II", "foundry2"],
  ["Joinery", "joinery"],
]) {
  await quiet();
  const r = await researchByTaps(name, id, 14);
  const learned = await p.evaluate((id) => window.woodrail.progress().learned.has(id), id);
  check(`${name}: researched by taps and learned`, r.first?.name === name && learned, JSON.stringify(r));
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
