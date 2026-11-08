// End-to-end: "Help improve Woodrail" (docs/stats.md) on a 390×844 phone with touch, in Game mode. A new game sends
// nothing. The player joins two towns (the first goal); a moment after its toast, the one-time question. Still nothing
// sent. They tap "Yes, share"; on leaving the page the batch goes up holding the game's start and the goal, and the
// Worker's own reading of it (cloud/src/stats.ts `points`) makes a "goal" data point for join-two. No railway snapshot
// yet: then they drag an engine from the tray onto their line, "Put an engine on the track" ticks, and a snapshot goes
// up that the Worker's own check takes (cloud/src/snapshots.ts `parseSnapshot`) and that reads back as their railway,
// engine and all. The ☰ menu shows the choice, and "Stop sharing" turns it off; a reload doesn't ask again.
//
// Harness shortcuts (named; not what's tested): the stats and snapshot endpoints are answered by the page's route here,
// not a running Worker, and what's sent is read with the Worker's own parsers. The Worker's handling is
// cloud/test/stats.test.ts's and cloud/test/snapshots.test.ts's. The line between the towns is laid by the game's
// pathfinder through the editor (as e2e:stickers); the engine is dragged from the tray, the player's way.
//
// Usage: npm run e2e:stats [-- <out dir>]   (default out: e2e-out/stats)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/stats";
mkdirSync(OUT, { recursive: true });
const STATS = "http://stats.test";
process.env.VITE_STATS_URL = STATS;
const { points } = await import(`${ROOT}/cloud/src/stats.ts`);
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5396, strictPort: false }, logLevel: "error" });
await server.listen();
// (Through Vite: snapshots.ts imports its neighbours without extensions, as the Worker's bundler takes them.)
const { parseSnapshot } = await server.ssrLoadModule(`${ROOT}/cloud/src/snapshots.ts`);
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
/** Every batch the game sent, as the Worker reads it. */
const batches = [];
/** Every railway snapshot, as the Worker checks it. */
const snaps = [];
await ctx.route(`${STATS}/**`, async (route) => {
  const body = route.request().postData() ?? "";
  if (route.request().url().endsWith("/v1/snapshots")) {
    snaps.push(parseSnapshot(JSON.parse(body)));
    await route.fulfill({ status: 201, headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
    return;
  }
  batches.push({ raw: JSON.parse(body), points: points(JSON.parse(body)) });
  await route.fulfill({ status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const shown = (sel) => p.evaluate((s) => [...document.querySelectorAll(s)].some((e) => getComputedStyle(e).display !== "none" && !e.closest("[hidden]") && e.getBoundingClientRect().width > 0), sel);
const tap = async (selector, text) => {
  await settle();
  await p.waitForTimeout(400);
  const r = await p.evaluate(
    ({ s, text }) => {
      const el = [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden]") && (!text || e.textContent.includes(text)));
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    },
    { s: selector, text },
  );
  if (r) await p.touchscreen.tap(r.x, r.y);
  return !!r;
};
const start = async (fresh) => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate((fresh) => {
    const btns = [...document.querySelectorAll(".title-card.mode-game button")].filter((x) => !x.hidden);
    (fresh ? btns.find((x) => x.classList.contains("primary")) : btns.find((x) => /Continue/i.test(x.textContent)) ?? btns[0]).click();
    // (New game opens the new-game sheet: Hilly, the land this was written on, and Start.)
    (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click());
  }, fresh);
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
};
/**
 * The player's track from one town's station to another's: the game's pathfinder, through the editor (as
 * e2e:stickers). The pose of a straight in its middle, or null if it couldn't.
 */
const link = (from, to) =>
  p.evaluate(
    async ({ from, to }) => {
      const { play } = await import("/src/play/player.ts");
      const { rulesFor } = await import("/src/play/rules.ts");
      const { connectorRef } = await import("/src/track/layout.ts");
      const w = window.woodrail;
      const a = w.world.stations.get(from);
      const z = w.world.stations.get(to);
      for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
        if (a === undefined || z === undefined || w.layout.joinedConnector(connectorRef(a, i)) >= 0) continue;
        const before = new Set(w.layout.pieceIds());
        if (!play(w.world.layout, w.editor(), connectorRef(a, i), connectorRef(z, j), { blocked: rulesFor(w.world), maxPieces: 120, fiddle: 3 }).ok) continue;
        const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id) && w.layout.getPiece(id).type.startsWith("straight"));
        w.invalidate();
        return laid.length ? w.layout.getPiece(laid[Math.floor(laid.length / 2)]).pose : null;
      }
      return null;
    },
    { from, to },
  );
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
/** Drag with a finger from `from` to `to`, in steps (as e2e:engine-names). */
const drag = async (from, to) => {
  await touch("touchStart", from.x, from.y);
  for (let k = 1; k <= 20; k++) {
    await touch("touchMove", from.x + ((to.x - from.x) * k) / 20, from.y + ((to.y - from.y) * k) / 20);
    await p.waitForTimeout(30);
  }
  await p.waitForTimeout(300);
  await touch("touchEnd", 0, 0);
  await p.waitForTimeout(800);
};
/** Where a world point (on the ground) is on the screen. */
const onScreen = (pt) =>
  p.evaluate((pt) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(pt.x, pt.y ?? 0, pt.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }, pt);
/** The middle of the first visible element matching `selector` whose label starts with `text`. */
const centre = (selector, text) =>
  p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && (!text || (e.querySelector(".label")?.textContent ?? e.textContent).trim().startsWith(text)));
      if (!el) return null;
      el.scrollIntoView({ inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
/** The page left and come back to, as a browser says it (the game saves once a leaving, till the page is back). */
const leave = () => p.evaluate(() => (dispatchEvent(new PageTransitionEvent("pagehide")), dispatchEvent(new PageTransitionEvent("pageshow"))));

// 1. A new game: nothing asked, nothing sent.
await p.goto(PAGE);
await start(true);
check("a new game: no question yet", !(await shown(".stats-card")));
await leave();
await p.waitForTimeout(1500);
check("…and nothing sent, before an answer", batches.length === 0, `${batches.length} batches`);

// 2. The first goal, the player's way: two towns joined.
// (On the starter map, Larkfield to Elderwick: a link the pathfinder is known to manage, as e2e:stickers.)
const pair = await p.evaluate(() => {
  const ts = window.woodrail.world.landscape.towns;
  const by = (n) => ts.find((t) => t.name === n);
  const [a, z] = by("Larkfield") && by("Elderwick") ? [by("Larkfield"), by("Elderwick")] : [ts[0], ts[1]];
  return { a: a.id, z: z.id, names: `${a.name} → ${z.name}` };
});
const linePose = (await link(pair.a, pair.z)) ?? (await link(pair.z, pair.a));
check("the player joins two towns", !!linePose, pair.names);
await p.waitForFunction(() => window.woodrail.goals().isDone("join-two"), null, { timeout: 30000, polling: 500 }).catch(() => {});
check("…Join two towns is done", await p.evaluate(() => window.woodrail.goals().isDone("join-two")));
await p.waitForFunction(() => { const c = document.querySelector(".stats-card"); return c && !c.hidden; }, null, { timeout: 30000 }).catch(() => {});
check("a moment later: “Help improve Woodrail?”", await shown(".stats-card"), await p.evaluate(() => document.querySelector(".stats-card")?.textContent ?? ""));
await shot("1-asked");
check("…still nothing sent", batches.length === 0);

// 3. Yes: on leaving, what was held goes up.
check("tap “Yes, share”", await tap(".stats-card .stats-yes"));
await p.waitForTimeout(500);
check("…the card goes", !(await shown(".stats-card")));
check("…the answer kept", (await p.evaluate(() => localStorage.getItem("woodrail.stats"))) === "yes");
await leave();
for (let i = 0; i < 20 && batches.length === 0; i++) await p.waitForTimeout(250);
const sent = batches.flatMap((x) => x.points ?? []);
check("a batch sent, and the Worker reads it", batches.length >= 1 && batches.every((x) => x.points !== null), JSON.stringify(batches.map((x) => x.raw.events.map((e) => e.e))));
check("…with the game's start", sent.some((pt) => pt.blobs[0] === "start" && pt.blobs[1] === "game"));
check("…and the goal: a “goal” point for join-two", sent.some((pt) => pt.blobs[0] === "goal" && pt.blobs[2] === "join-two" && pt.doubles[0] >= 1), JSON.stringify(sent.map((pt) => pt.blobs.slice(0, 3))));
check("…from a phone, with an anonymous id", sent.every((pt) => pt.blobs[5] === "phone" && /^[0-9a-f]{16}$/.test(pt.indexes[0])));
const nothingPersonal = JSON.stringify(batches.map((x) => x.raw));
check("…holding no railway, town names or codes", !nothingPersonal.includes(pair.names.split(" → ")[0]) && nothingPersonal.length < 2000, `${nothingPersonal.length} bytes`);
check("…and no railway snapshot yet: no engine on the track", snaps.length === 0, `${snaps.length} snapshots`);

// 3b. An engine from the tray onto the line: "Put an engine on the track", and the first railway snapshot.
if (linePose) {
  await p.evaluate((pose) => {
    const w = window.woodrail;
    w.director.glideTo(new w.camera.position.constructor(pose.x, 0, pose.z), 500, { duration: 0.1 });
  }, linePose);
  await p.waitForTimeout(800);
  await settle();
  await tap(".tabs button", "Trains");
  await p.waitForTimeout(1500);
  await tap(".scroller .tray-item.tray-group", "Engines");
  await p.waitForTimeout(500);
  const engineAt = await centre(".scroller .tray-item:not(.tray-group):not(.tray-back)", "Engine");
  if (engineAt) await drag(engineAt, await onScreen(linePose));
  await settle();
}
await p.waitForFunction(() => window.woodrail.goals().isDone("place-train"), null, { timeout: 30000, polling: 500 }).catch(() => {});
check("the player drags an engine onto the line: “Put an engine on the track” done", await p.evaluate(() => window.woodrail.goals().isDone("place-train")));
for (let i = 0; i < 40 && snaps.length === 0; i++) await p.waitForTimeout(250);
const snap = snaps[0];
check("a railway snapshot sent, and the Worker's check takes it", snaps.length === 1 && typeof snap === "object", JSON.stringify(snaps).slice(0, 200));
if (typeof snap === "object") {
  check("…under the stats' device id, for that goal", snap.id === sent[0]?.indexes[0] && snap.why === "goal:place-train" && snap.goals === 2 && snap.device === "phone", JSON.stringify({ ...snap, map: undefined }));
  const back = await p.evaluate(async (map) => {
    const { readMapText } = await import("/src/persist/bug-map.ts");
    const copy = await readMapText(map);
    const all = Object.values(copy?.keys ?? {}).join("");
    return { mode: copy?.mode, keys: Object.keys(copy?.keys ?? {}).length, goals: all.includes('"place-train"'), hasEngine: all.includes('"engine"') };
  }, snap.map);
  check("…and its map reads back as this railway, engine and all", back.mode === "game" && back.keys > 0 && back.goals && back.hasEngine, JSON.stringify(back));
}

// 4. The ☰ menu: the choice, and Stop sharing.
await tap(".hud button[title='Menu'], button[aria-label='Menu']");
check("the menu has “Help improve Woodrail”", await tap(".menu-item", "Help improve Woodrail"));
await p.waitForTimeout(400);
check("…it says sharing is on", (await p.evaluate(() => document.querySelector(".stats-card .cloud-status")?.textContent)) === "Sharing: thank you!");
await shot("2-menu-card");
await tap(".stats-card .chip", "Stop sharing");
await p.waitForTimeout(300);
const off = await p.evaluate(() => ({ status: document.querySelector(".stats-card .cloud-status")?.textContent, consent: localStorage.getItem("woodrail.stats"), id: localStorage.getItem("woodrail.stats.id") }));
check("Stop sharing: off, and the id dropped", off.status === "Not sharing" && off.consent === "no" && off.id === null, JSON.stringify(off));
await tap(".stats-card .chip", "Done");
const before = batches.length;
await leave();
await p.waitForTimeout(1500);
check("…nothing more sent", batches.length === before);

// 5. A reload doesn't ask again.
await p.reload();
await start(false);
await p.waitForTimeout(6000);
check("a reload: not asked again", !(await shown(".stats-card")));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
