// End-to-end Research picker on a phone (`npm run e2e:research [-- <out dir>]`), at 390×844 with touch: a new game's
// line laid and its school placed; the pill in the top bar says "Pick research"; a goal after a blueprint (Learn
// switches) opens the picker on it from Show me and from the pill, nothing picked; Research, then Next up (and the
// swap); deliveries move the pill; every card state's ticket; the pill fits the bar beside the coins and buttons (also
// with the Research button's glow); the date and the pill both read at 360, 414 and 844×390 (a phone on its side); and
// no frames drawn in 30 s with the pill showing while nothing changes.
//
// Usage: npm run e2e:research [-- <out dir>]   (default out: e2e-out/research)
// Starts its own dev server (on 5381, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/research";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5381, strictPort: false }, logLevel: "error" });
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
/** Tap the middle of the first visible element matching `selector` (whose text starts with `text`, if given). */
const tap = async (selector, text) => {
  const box = await p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => (text === undefined || e.textContent.trim().startsWith(text)) && e.getBoundingClientRect().width > 0);
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
  if (!box) return false;
  await p.touchscreen.tap(box.x, box.y);
  await p.waitForTimeout(400);
  return true;
};
const pill = () => p.evaluate(() => {
  const el = document.querySelector(".research-pill");
  return el && !el.hidden ? `📘 ${el.querySelector(".rp-name").textContent} ${el.querySelector(".rp-count").textContent}` : null;
});
const ticket = () => p.evaluate(() => {
  const t = document.querySelector(".board-sheet .bp-ticket");
  return t ? { state: [...t.classList].find((c) => c !== "bp-ticket"), name: t.querySelector("b")?.textContent, foot: t.querySelector(".bp-ticket-foot")?.textContent.replace(/\s+/g, " ").trim(), buttons: [...t.querySelectorAll(".bp-ticket-foot button")].map((x) => ({ text: x.textContent, h: x.getBoundingClientRect().height, goal: x.classList.contains("bp-goal") })) } : null;
});
/** Select a card in the picker by its name. */
const select = async (name) => {
  const box = await p.evaluate((name) => {
    const el = [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === name);
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, name);
  if (!box) return false;
  await p.touchscreen.tap(box.x, box.y);
  await p.waitForTimeout(400);
  return true;
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

// 2. Back with the goals done up to Learn switches (a reload: Continue).
await p.evaluate(() => localStorage.setItem("woodrail.game.goals.v1", JSON.stringify(["join-two", "place-train", "get-moving", "station-stop", "timber-train", "load-logs", "deliver-planks", "grow-town", "place-workshop", "workshop-planks"])));
await p.reload();
await enterGame();
await p.waitForTimeout(600);
const goalNow = await p.evaluate(() => document.querySelector(".goals-now")?.textContent);
check("the goal now is Learn switches", goalNow === "Learn switches", String(goalNow));
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
    return { coins: r(coins), pill: r(pill), first: r(buttons[0]), last: r(buttons.at(-1)), width: innerWidth, clipped: pill.querySelector(".rp-name").scrollWidth > pill.querySelector(".rp-name").clientWidth };
  });
const fits = (m) => m.pill.l >= m.coins.r + 4 && m.pill.r <= m.first.l - 4 && m.pill.h >= 44 && m.last.r <= m.width;
let m = await bar();
check("the pill sits between the coins and the buttons, 44 px tall", fits(m), JSON.stringify(m));
await shot("01-pill-pick-research");

// 3. Show me for Learn switches: the picker, open on Switches, its Research ringed; nothing picked.
await tap(".goals-show-icon");
await p.waitForTimeout(500);
let t = await ticket();
check("Show me opens the picker on Switches, Research ringed for the goal", t?.name === "Switches" && t.buttons.length === 1 && t.buttons[0].text === "Research" && t.buttons[0].goal && t.buttons[0].h >= 44, JSON.stringify(t));
check("…and nothing is picked", (await p.evaluate(() => window.woodrail.progress().research.current)) === null);
await shot("02-show-me-opens-switches");
await tap(".board-head .close");
// The pill opens it on the goal's research too (the school is idle).
await tap(".research-pill");
t = await ticket();
check("the pill opens the picker on the goal's research while the school is idle", t?.name === "Switches", JSON.stringify(t));
await shot("03-ready-card");

// 4. Research Switches with one tap, then Bridges up next.
await tap(".board-sheet button[data-act=pick]", "Research");
t = await ticket();
check("one tap: Switches is researching, live progress, no button", t?.state === "researching" && t.buttons.length === 0 && /🪵 0\/4/.test(t.foot) && /bring 4🪵 to/.test(t.foot), JSON.stringify(t));
check("the pill shows it", (await pill()) === "📘 Switches 0/4🪵", String(await pill()));
await shot("04-picked-research");
await select("Bridges and ramps");
t = await ticket();
check("a ready card while one is under way: one button, Next up", t?.state === "ready" && t.buttons.length === 1 && t.buttons[0].text === "Next up" && /🪵 0\/10/.test(t.foot) && /20 s study/.test(t.foot), JSON.stringify(t));
await tap(".board-sheet button[data-act=pick]", "Next up");
t = await ticket();
check("Next up: Bridges waits after Switches, its button Research now", t?.state === "next" && /Next up, after Switches/.test(t.foot) && t.buttons[0]?.text === "Research now", JSON.stringify(t));
await shot("05-next-up");
// Tapping again swaps; and back.
await tap(".board-sheet button[data-act=pick]", "Research now");
const swapped = await p.evaluate(() => ({ ...window.woodrail.progress().research, held: undefined }));
check("tapping again swaps the two", swapped.current === "bridges" && swapped.next === "switches", JSON.stringify(swapped));
await select("Switches");
await tap(".board-sheet button[data-act=pick]", "Research now");
await tap(".board-head .close");

// 5. Deliveries move the pill (planks into the school, as a train's crane brings them).
const deliver = (n) =>
  p.evaluate((n) => {
    const w = window.woodrail;
    const school = w.economy.allDepots().find((d) => d.role === "school");
    for (let i = 0; i < n; i++) w.economy.intoSink(school, "planks");
  }, n);
const before = await pill();
await shot("06-pill-before-delivery");
await deliver(3);
await p.waitForTimeout(300);
const after = await pill();
check("a delivery moves the pill", before === "📘 Switches 0/4🪵" && after === "📘 Switches 3/4🪵", `${before} → ${after}`);
await shot("07-pill-after-delivery");
await deliver(1);
await p.waitForTimeout(1300);
const study = await pill();
check("goods all in: the pill counts the study down", /^📘 Switches \d+ s$/.test(study ?? ""), String(study));
await shot("08-pill-studying");
// Learned (20 s), and Bridges starts from Next up.
await p.waitForFunction(() => window.woodrail.progress().learned.has("switches"), null, { timeout: 60000 });
await p.waitForTimeout(600);
check("Switches learned, Bridges started from Next up", (await pill()) === "📘 Bridges 0/10🪵", String(await pill()));

// 6. Every card state's ticket: learned, researching, next (with its coins short), ready, locked, soon.
await tap(".research-pill");
await select("Train routes");
await tap(".board-sheet button[data-act=pick]", "Next up");
const states = {};
for (const [state, name] of [["learned", "Switches"], ["researching", "Bridges and ramps"], ["next", "Train routes"], ["ready", "Signals"]]) {
  await select(name);
  states[state] = await ticket();
  await shot(`09-card-${state}`);
}
for (const state of ["locked", "soon"]) {
  const name = await p.evaluate((s) => document.querySelector(`.board-body .bp-node.${s} .bp-name`)?.textContent, state);
  if (name) await select(name);
  states[state] = await ticket();
  await shot(`09-card-${state}`);
}
check("learned: Learned, no button", states.learned?.state === "learned" && states.learned.buttons.length === 0, JSON.stringify(states.learned));
check("researching: live progress, no button", states.researching?.state === "researching" && /🪵 0\/10/.test(states.researching.foot) && states.researching.buttons.length === 0, JSON.stringify(states.researching));
check("next: after Bridges, its coins chip short, Research now", states.next?.state === "next" && /After Bridges · 20🪙 short/.test(states.next.foot) && /🪙 20/.test(states.next.foot) && states.next.buttons[0]?.text === "Research now", JSON.stringify(states.next));
check("ready: chips, study time, one 44 px button", states.ready?.state === "ready" && /🪵 0\/8/.test(states.ready.foot) && states.ready.buttons.length === 1 && states.ready.buttons[0].h >= 44, JSON.stringify(states.ready));
check("locked: what it waits for", states.locked?.state === "locked" && states.locked.buttons.length === 0, JSON.stringify(states.locked));
check("soon: coming soon", states.soon?.state === "soon" && states.soon.buttons.length === 0, JSON.stringify(states.soon));
const coinChip = await p.evaluate(() => {
  const node = [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === "Train routes");
  return node?.className;
});
check("the web's tag for the one up next", /\bnext\b/.test(coinChip ?? ""), String(coinChip));
await shot("10-picker-web");
await tap(".board-head .close");

// 7. The bar with the pill under way (it stands in for the Research button on a phone), with a four-figure purse, and
// with the glow of a town's reward waiting (on the pill, as the button's hidden).
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
await p.evaluate(() => window.woodrail.hud.setBoardButton(false, 1));
await p.waitForTimeout(300);
m = await bar();
const glow = await p.evaluate(() => document.querySelector(".research-pill").classList.contains("board-new"));
check("…and glowing for a town's reward", fits(m) && glow, JSON.stringify({ ...m, glow }));
await shot("11-pill-with-glow");
await p.evaluate(() => window.woodrail.hud.setBoardButton(true, 1));
await p.evaluate(() => window.woodrail.hud.setBoardButton(false, 0));

// 7b. The date beside the coins with the pill showing, on a small phone, a large one and a phone on its side: the date
// whole (not cut by the brand's edge), the pill clear of the brand and the buttons, the name whole (at 360, if it's cut, 50 px of it).
for (const [width, height, whole] of [[360, 740, false], [414, 896, true], [844, 390, true]]) {
  await p.setViewportSize({ width, height });
  await p.waitForTimeout(1500);
  const d = await p.evaluate(() => {
    const brand = document.querySelector(".brand").getBoundingClientRect();
    const date = document.querySelector(".game-date");
    const r = date.getBoundingClientRect();
    const name = document.querySelector(".research-pill .rp-name");
    return { text: date.textContent, shown: !date.hidden && r.width > 0, cut: r.left < brand.left || r.right > brand.right + 0.5 || date.scrollWidth > date.clientWidth, name: name.clientWidth, nameClipped: name.scrollWidth > name.clientWidth };
  });
  m = await bar();
  const ok = d.shown && /^[A-Z][a-z]{2} \d{4}$/.test(d.text) && !d.cut && fits(m) && (!d.nameClipped || (!whole && d.name >= 50));
  check(`at ${width}×${height} the date and the pill both read`, ok, JSON.stringify({ ...d, ...m }));
  await shot(`11b-date-pill-${width}x${height}`);
}
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

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
