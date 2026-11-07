// End-to-end: the touring circus (Game mode, a 390×844 phone with touch). Late-game spec K1
// (docs/superpowers/specs/2026-11-04-late-game-design.md).
//
//   1. Circus learned (a setup shortcut: the study isn't what's tested): two circus cages come as a gift, on the
//      Trains tab's Wagons shelf, two in the toy box; the workshop doesn't offer one.
//   2. Setup: track between the first two towns' stations (by the player's own pathfinder), a train of an engine, a
//      cage and a coach at the first, set going (as its card's lever would).
//   3. It comes to the second town: the big top goes up by its station, and the player is told.
//   4. The payoff: people from the first town ride to the circus's town and pay double the fare.
//   5. The show runs its three months (its time run down: a setup shortcut): the big top comes down and the town
//      offers a reward card.
//
// Harness shortcut (as e2e:warehouse's): the game's own sim and economy ticks run ahead of SwiftShader's frames (`__run`).
//
// Usage: npm run e2e:circus [-- <out dir>]   (default out: e2e-out/circus)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/circus";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5399, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const look = async (v, dist = 1000) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, 0, v.z), dist, { duration: 0.2, phi: 0.95 }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
};

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// What the player is told (every toast asked for).
await p.evaluate(() => {
  const hud = window.woodrail.hud;
  const toast = hud.toast.bind(hud);
  window.__toasts = [];
  hud.toast = (m, ...a) => {
    window.__toasts.push(m);
    return toast(m, ...a);
  };
});

// 1. Learned: the cages come as a gift.
const gift = await p.evaluate(() => {
  const w = window.woodrail;
  w.learn("passengers");
  w.learn("circus");
  w.hud.refreshTrayBadges();
  w.hud.trayLearned();
  return { owned: w.progress().owned.get("car:cage") ?? 0, toasts: window.__toasts.slice() };
});
check("1. Circus learned: two circus cages, a gift, in the toy box, and said so (not to make one)", gift.owned === 2 && gift.toasts.some((t) => /Present: .*[Cc]ircus cage/.test(t) && !/Make a circus cage/.test(t)), JSON.stringify(gift));
await p.evaluate(() => [...document.querySelectorAll(".tabs button")].find((e) => e.textContent.trim().startsWith("Trains"))?.click());
await p.waitForTimeout(500);
{
  const g = await p.evaluate(() => {
    const e = [...document.querySelectorAll(".tray-item.tray-group")].find((x) => /Wagons/.test(x.textContent));
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  if (g) await p.touchscreen.tap(g[0], g[1]);
  await p.waitForTimeout(800);
}
const tile = await p.evaluate(() => {
  const e = document.querySelector(".tray-item[data-key='train:Circus cage']");
  return e ? { have: e.querySelector(".have")?.textContent ?? null } : { keys: [...document.querySelectorAll(".tray-item")].map((x) => x.dataset.key ?? `[${x.textContent.trim().slice(0, 20)}]`) };
});
check("…on the Trains tab's Wagons shelf, two of them", tile?.have === "2", JSON.stringify(tile));
const workshop = await p.evaluate(async () => {
  const { Crafting } = await import("/src/game/crafting.ts");
  const w = window.woodrail;
  const before = w.progress().orders.length;
  new Crafting(w.progress()).order("car:cage");
  return w.progress().orders.length - before;
});
check("…and the workshop won't make one (never bought)", workshop === 0, String(workshop));

// 2. Setup: the two towns joined, a circus train at the first.
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const [ta, tb] = w.world.landscape.towns;
  const a = w.world.stations.get(ta.id);
  const bPiece = w.world.stations.get(tb.id);
  let ok = false;
  for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
    if (w.layout.joinedConnector(connectorRef(a, i)) !== -1 || w.layout.joinedConnector(connectorRef(bPiece, j)) !== -1) continue;
    if (play(w.world.layout, w.editor(), connectorRef(a, i), connectorRef(bPiece, j), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 }).ok) {
      ok = true;
      break;
    }
  }
  if (!ok) return { error: "no track between the towns" };
  // Turnbacks on the stations' far ends, as a player lays them.
  for (const s of [a, bPiece]) for (const k of [0, 1]) if (w.layout.joinedConnector(connectorRef(s, k)) === -1) {
    const { appendPiece } = await import("/src/track/index.ts");
    appendPiece(w.layout, "buffer-turnback", false, connectorRef(s, k));
  }
  w.trackChanged();
  // On the new line just past the first station (as the tray would put it down there).
  let train = null;
  const near = [...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id).type.startsWith("straight")).sort((x, y) => {
    const px = w.layout.getPiece(x).pose;
    const py = w.layout.getPiece(y).pose;
    const sa = w.layout.getPiece(a).pose;
    return Math.hypot(px.x - sa.x, px.z - sa.z) - Math.hypot(py.x - sa.x, py.z - sa.z);
  });
  for (const id of near.slice(0, 8)) {
    for (const s of [100, 150, 200]) {
      for (const reversed of [false, true]) {
        const r = w.sim.addTrain(["engine", "cage", "passenger"], { pieceId: id, pathIndex: 0, reversed, s });
        if (r.kind === "placed") {
          train = r.trainId;
          break;
        }
      }
      if (train !== null) break;
    }
    if (train !== null) break;
  }
  if (train === null) return { error: "no room for the train" };
  // (Followed by its engine: a train's id can change as it runs, its cars' don't.)
  const engine = w.sim.getTrain(train).cars[0].id;
  window.__trainOf = (e) => w.sim.findCar(e).train;
  const A = w.economy.depotAtPiece(a);
  const B = w.economy.depotAtPiece(bPiece);
  window.__run = (secs) => {
    for (let i = 0; i < secs * 120; i++) {
      w.sim.tick();
      w.economy.tick();
    }
    w.invalidate();
  };
  w.invalidate();
  return { train: engine, A: A.id, B: B.id, townA: ta.id, townB: tb.id, nameB: tb.name, at: tb.centre };
});
check("2. setup: the two towns joined, a circus train at the first", !setup.error, JSON.stringify(setup));

if (!setup.error) {
  // 3. Set going: it comes to the second town; the big top goes up there.
  await p.evaluate(({ train }) => window.woodrail.sim.setLever(train, 1), setup);
  let opened = null;
  for (let k = 0; k < 60 && !opened; k++) {
    await p.evaluate(() => window.__run(2));
    opened = await p.waitForFunction(() => window.woodrail.progress().circus, null, { timeout: 1500 }).then((h) => h.jsonValue(), () => null);
  }
  check("3. the circus train comes to a town: a show opens there", !!opened, JSON.stringify(opened));
  const top = await p.evaluate(() => [...window.woodrail.world.props.all()].find((x) => x.asset === "scene-big-top") ?? null);
  check("…the big top stands by its station", !!top && opened?.prop === top.id, JSON.stringify({ top, opened }));
  const told = await p.evaluate(() => window.__toasts.find((t) => /circus is in/.test(t)) ?? null);
  check("…and the player is told", !!told, String(told));
  const showTown = opened?.town;
  if (top) {
    await p.evaluate((train) => window.woodrail.sim.setLever(train, 0), setup.train);
    await look(top, 900);
    await settle();
    await shot("1-big-top");
  }

  // 4. The payoff: riders to the circus's town pay double.
  if (showTown !== undefined) {
    const res = await p.evaluate(async ({ train, A, B, townA }, ) => {
      const w = window.woodrail;
      const { fareFor } = await import("/src/game/passengers.ts");
      const circus = w.progress().circus;
      const from = circus.town === townA ? B : A;
      const to = circus.town === townA ? A : B;
      const coach = window.__trainOf(train).cars.find((c) => c.kind === "passenger").id;
      const fare = fareFor(w.world, w.economy.depot(from), w.economy.depot(to), coach);
      w.economy.depot(from).waiting = 4;
      w.sim.setLever(train, 1);
      // Each rider's fare as they get off (only those getting off in the circus's town counted).
      const paid = [];
      const alight = w.economy.onAlight;
      w.economy.onAlight = (f, t, car) => {
        const c = w.progress().coins;
        alight(f, t, car);
        if (t.id === to) paid.push(w.progress().coins - c);
      };
      w.economy.depot(to).waiting = 0;
      for (let k = 0; k < 40 && paid.length < 4; k++) {
        window.__run(5);
        w.economy.depot(to).waiting = 0;
      }
      w.economy.onAlight = alight;
      return { fare, paid: paid.reduce((a, b) => a + b, 0), riders: paid.length };
    }, setup);
    check("4. riders to the circus's town pay double the fare", res.riders >= 1 && res.paid === res.riders * res.fare * 2, JSON.stringify(res));

    // 5. The show runs out (setup: its time run down): the big top comes down, the town offers a reward.
    const offers0 = await p.evaluate(() => window.woodrail.progress().offers.length);
    await p.evaluate(() => (window.woodrail.progress().circus.left = 1.5));
    const closed = await p.waitForFunction(() => !window.woodrail.progress().circus, null, { timeout: 30000 }).then(() => true, () => false);
    const after = await p.evaluate(() => ({ top: [...window.woodrail.world.props.all()].some((x) => x.asset === "scene-big-top"), offers: window.woodrail.progress().offers.length, toast: window.__toasts.find((t) => /circus leaves/.test(t)) ?? null }));
    check("5. three months on the show closes: the big top comes down, and the town offers a reward", closed && !after.top && after.offers === offers0 + 1 && /pick a reward/.test(after.toast ?? ""), JSON.stringify({ closed, ...after }));
  }
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(`\n${failures === 0 ? "e2e:circus passed" : `e2e:circus: ${failures} failed`}`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
