// End-to-end tutorial order and the school that grows with its town, on a phone (`npm run e2e:school [-- <out dir>]`),
// at 390×844 with touch:
// - the opening (spec §4): deliver planks, grow a village (its present is a school), place a school by a town (Show me
//   marks the spot and opens the Industries tab), research switches, then the workshop;
// - the school's model (spec §1): a schoolhouse by a village, a college once College is learned and its town is a town
//   (study 2×), a library wing by a city (tier 3 opens: Quarries ready); the yards are drawn again only when a school's
//   grade changes (not on deliveries);
// - idle after the model's change: no frames drawn in 30 s.
//
// Usage: npm run e2e:school [-- <out dir>]   (default out: e2e-out/school)
// Starts its own dev server (on 5383, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/school";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5383, strictPort: false }, logLevel: "error" });
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
const goalNow = () => p.evaluate(() => document.querySelector(".goals-now")?.textContent);
const waitGoal = (title) => p.waitForFunction((t) => document.querySelector(".goals-now")?.textContent === t, title, { timeout: 30000, polling: 200 }).then(() => true, () => false);
/** Close whatever sheet a growth opened (the reward sheet), leaving its offer waiting. */
const closeSheets = async () => {
  await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
  await p.waitForTimeout(300);
};
/** Larkfield's deliveries set to these, as trains would bring them (the towns are looked at on the next frame). */
const grow = async (planks, flour, level) => {
  await p.evaluate(
    ([planks, flour]) => {
      const w = window.woodrail;
      const t = w.world.landscape.towns[0];
      w.economy.delivered.set(t.id, planks);
      w.economy.deliveredGoods.set(t.id, { ...(w.economy.deliveredGoods.get(t.id) ?? {}), planks, flour });
      w.invalidate();
    },
    [planks, flour],
  );
  await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  await closeSheets();
};
/** The camera on the school, close up, for a picture. */
const lookAtSchool = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    const d = w.economy.allDepots().find((x) => x.role === "school");
    const pose = w.layout.getPiece(d.pieceId).pose;
    const V = w.camera.position.constructor;
    // The yard's middle (t 108, l 72 in the depot's frame).
    const c = Math.cos(pose.heading);
    const s = Math.sin(pose.heading);
    w.lookAt(new V(pose.x + c * 120 - s * 72, 0, pose.z + s * 120 + c * 72), 1100, 0.8);
    w.invalidate();
    await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 15000))]);
  });
const school = () =>
  p.evaluate(() => {
    const w = window.woodrail;
    const pr = w.progress();
    return { speed: pr.research.speed, cityschool: pr.landmarks.has("city-school"), redraws: window.__yards ?? 0, learned: [...pr.learned] };
  });

// 1. A new game, the line between the first two towns laid; back with the goals done up to the first plank delivery.
await p.goto(PAGE);
await enterGame();
const laid = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
  const r = play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
  w.invalidate();
  return r.ok;
});
check("the line laid between the first two towns", laid);
await p.waitForTimeout(2500); // (saved)
await p.evaluate(() => localStorage.setItem("woodrail.game.goals.v1", JSON.stringify(["join-two", "place-train", "get-moving", "station-stop", "timber-train", "load-logs", "deliver-planks"])));
await p.reload();
await enterGame();
await p.waitForTimeout(600);
check("the goal is Grow a town into a village", (await goalNow()) === "Grow a town into a village", String(await goalNow()));

// 2. A village: its present has the school, and the next goal is to place it.
await grow(4, 0, 1);
check("a village: the next goal is Place a school by a town", await waitGoal("Place a school by a town"), String(await goalNow()));
const box = await p.evaluate(() => window.woodrail.progress().owned.get("piece:depot-school") ?? 0);
check("…and the school is in the toy box (the village's present)", box === 1, String(box));
await shot("01-goal-place-school");

// 3. Show me: the Industries tab open, a marker where the school fits beside the village's station.
await tap(".goals-show-icon");
await p.waitForTimeout(1200);
const shown = await p.evaluate(() => {
  const tab = document.querySelector("button[data-tab].active")?.textContent?.trim();
  const item = [...document.querySelectorAll(".tray-item, .tray .item, [data-type]")].find((e) => /School/.test(e.textContent ?? "") || e.getAttribute("data-type") === "depot-school");
  return { tab, school: !!item };
});
check("Show me opens the Industries tab with the school in it", /Industries/i.test(shown.tab ?? "") && shown.school, JSON.stringify(shown));
await shot("02-show-me-school-spot");

// 4. Placed where Show me points: the goal is Research switches (before the workshop).
const placed = await p.evaluate(async () => {
  const { schoolOn } = await import("/src/play/rules.ts");
  const w = window.woodrail;
  const id = schoolOn(w.world, w.editor(), new Set());
  w.invalidate();
  return id;
});
check("the school placed beside the village", typeof placed === "number", JSON.stringify(placed));
check("…the next goal is Research switches", await waitGoal("Research switches"), String(await goalNow()));
await p.waitForTimeout(800);
await shot("03-goal-research-switches");

// 5. Research switches (Show me opens the picker on it), 4 planks into the school, studied: the workshop is next.
await tap(".goals-show-icon");
await p.waitForTimeout(600);
await tap(".board-sheet button[data-act=pick]", "Research");
await tap(".board-head .close");
await p.evaluate(() => {
  const w = window.woodrail;
  const d = w.economy.allDepots().find((x) => x.role === "school");
  for (let i = 0; i < 4; i++) w.economy.intoSink(d, "planks");
});
await p.waitForFunction(() => window.woodrail.progress().learned.has("switches"), null, { timeout: 60000 }).catch(() => {});
check("switches researched, the next goal is Place your workshop", await waitGoal("Place your workshop"), String(await goalNow()));
await shot("04-goal-workshop");

// 6. The school grows with its town. Count the yards' redraws from here (its models loaded first: a model's first load
// draws the yards once more, when it's in).
await p.evaluate(async () => {
  const w = window.woodrail;
  await Promise.all(["bldg-college", "bldg-library"].map((id) => w.propLibrary.load(id)));
  await new Promise((r) => setTimeout(r, 500));
  const set = w.depotView.setWorld.bind(w.depotView);
  window.__yards = 0;
  window.__yardMs = [];
  w.depotView.setWorld = (...a) => {
    window.__yards++;
    const t0 = performance.now();
    const out = set(...a);
    window.__yardMs.push(Math.round((performance.now() - t0) * 10) / 10);
    return out;
  };
});
await lookAtSchool();
await shot("05-schoolhouse-village");
let s = await school();
check("a village's school: a schoolhouse, study 1×, no tier 3", s.speed === 1 && !s.cityschool, JSON.stringify(s));
// A town, without College: still a schoolhouse.
await grow(12, 0, 2);
s = await school();
const atTown = s.redraws;
check("a town, College not learned: still 1×", s.speed === 1, JSON.stringify(s));
// More deliveries at the same level: the yards aren't drawn again.
await grow(14, 0, 2);
await grow(16, 0, 2);
s = await school();
check("deliveries that don't change its grade don't redraw the yards", s.redraws === atTown, JSON.stringify({ atTown, now: s.redraws }));
// College learned (its research done): the school becomes a college, studying twice as fast.
await p.evaluate(() => {
  const pr = window.woodrail.progress();
  pr.research.current = "college";
  pr.research.next = null;
  pr.research.got = { planks: 20 };
  pr.research.study = 0;
  pr.research.version++;
});
await p.waitForFunction(() => window.woodrail.progress().learned.has("college"), null, { timeout: 90000 }).catch(() => {});
await p.waitForTimeout(800);
s = await school();
check("College learned: the town's school is a college, study 2×", s.learned.includes("college") && s.speed === 2 && s.redraws === atTown + 1, JSON.stringify(s));
await lookAtSchool();
await shot("06-college-town");
// A city: the library wing, and tier 3 opens (Quarries ready once Mills are known).
await p.evaluate(() => {
  for (const id of ["farming", "mills"]) window.woodrail.progress().learned.add(id);
});
await grow(26, 6, 3);
s = await school();
check("a city: the library wing (tier 3 opens), drawn again once", s.cityschool && s.redraws === atTown + 2, JSON.stringify(s));
await lookAtSchool();
await shot("07-library-wing-city");
await tap(".research-pill");
await p.waitForTimeout(600);
const quarries = await p.evaluate(() => [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === "Quarries")?.className ?? "");
check("…Quarries can be picked", /\bready\b/.test(quarries), quarries);
await shot("08-quarries-ready");
await tap(".board-head .close");

console.log("(the yards drawn again on a grade change, ms:", JSON.stringify(await p.evaluate(() => window.__yardMs)), ")");

// 7. Idle after the model's change: no frames in 30 s, and the yards not drawn again. (The main thread's busy time
// over the 30 s, from the browser's own count, is printed: idle CPU.)
const cdp = await p.context().newCDPSession(p);
await cdp.send("Performance.enable");
const busy = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;
const idleRun = p.evaluate(async () => {
  const w = window.woodrail;
  for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
  w.invalidate();
  await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
});
await idleRun;
const busy0 = await busy();
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  const f0 = w.framesDrawn;
  const y0 = window.__yards;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 30000));
  return { frames: w.framesDrawn - f0, yards: window.__yards - y0, seconds: Math.round((performance.now() - t0) / 100) / 10 };
});
idle.busyMs = Math.round(((await busy()) - busy0) * 1000);
idle.cpu = `${((idle.busyMs / (idle.seconds * 1000)) * 100).toFixed(2)}%`;
check("idle with the grown school: no frames drawn and no yards redrawn in 30 s", idle.frames === 0 && idle.yards === 0, JSON.stringify(idle));

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
