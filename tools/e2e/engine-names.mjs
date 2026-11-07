// End-to-end engines' names in Game mode (`npm run e2e:engine-names [-- <out dir>]`), on a phone at 390×844 with
// touch: an engine dragged from the Engines shelf onto a new game's first line is given a name from the list, painted on
// its plates; a tap on it opens its card, titled with that name (not "Engine"); a tap on the title gives a little text
// box (14 letters at most) and the name typed there is the engine's, on its card and its plates; and after a reload
// (the game continued from its save) the engine's card still shows the new name.
//
// Usage: npm run e2e:engine-names [-- <out dir>]   (default out: e2e-out/engine-names)
// Starts its own dev server (on 5397, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/engine-names";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
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
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });

/** The middle of the first visible element matching `selector` (whose label starts with `text`, if given). */
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
const tap = async (selector, text) => {
  const at = await centre(selector, text);
  if (!at) return false;
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(500);
  return true;
};
/** Drag with a finger from `from` to `to`, in steps. */
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

const enterGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
};
/** The engine on the track: its id, name, the name its plates show, and where its middle is. */
const engine = () =>
  p.evaluate(() => {
    const w = window.woodrail;
    for (const id of w.sim.trainIds()) {
      const t = w.sim.getTrain(id);
      const i = t.cars.findIndex((c) => c.kind === "engine");
      if (i < 0) continue;
      const a = t.world[2 * i];
      const b = t.world[2 * i + 1];
      return { id: t.cars[i].id, name: w.sim.nameOf(t.cars[i].id), plate: w.trainView.plateName(t.cars[i].id), at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 20, z: (a.z + b.z) / 2 } };
    }
    return null;
  });
const cardTitle = () => p.evaluate(() => {
  const card = document.querySelector(".engine-card");
  return card && !card.hidden ? card.querySelector(".engine-name")?.textContent ?? null : null;
});
/** Tap the engine (closing any card first), and wait for its card. */
const openCard = async () => {
  if (await p.evaluate(() => !document.querySelector(".engine-card").hidden)) await tap(".engine-card > .close");
  const e = await engine();
  if (!e) return false;
  const at = await onScreen(e.at);
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(800);
  return !(await p.evaluate(() => document.querySelector(".engine-card").hidden));
};

// 1. A new game, on a phone.
await p.goto(PAGE);
await enterGame();

// 2. The first two towns joined, as a new player does first; the camera on the middle of the line.
const line = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
  const before = new Set(w.layout.pieceIds());
  const r = play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
  const laid = [...w.layout.pieceIds()].filter((id) => !before.has(id) && w.layout.getPiece(id).type.startsWith("straight"));
  const mid = laid[Math.floor(laid.length / 2)];
  w.invalidate();
  return { ok: r.ok, pose: mid === undefined ? null : w.layout.getPiece(mid).pose };
});
check("the first two towns joined", line.ok && line.pose, JSON.stringify(line));
if (line.pose) {
  await p.evaluate((pose) => {
    const w = window.woodrail;
    w.director.glideTo(new w.camera.position.constructor(pose.x, 0, pose.z), 500, { duration: 0.1 });
  }, line.pose);
  await p.waitForTimeout(800);
  await settle();

  // 3. An engine from the Engines shelf, dragged onto the line: it's named, and its plates show the name.
  await tap(".tabs button", "Trains");
  await p.waitForTimeout(1500);
  await tap(".scroller .tray-item.tray-group", "Engines");
  const engineAt = await centre(".scroller .tray-item:not(.tray-group):not(.tray-back)", "Engine");
  if (engineAt) await drag(engineAt, await onScreen(line.pose));
  await settle();
  const placed = await engine();
  const NAMES = await p.evaluate(async () => (await import("/src/sim/engine-names.ts")).ENGINE_NAMES);
  check("the engine, dragged onto the line, is given a name from the list", !!placed && NAMES.includes(placed.name), JSON.stringify(placed));
  check("…painted on its plates", !!placed && placed.plate === placed.name, JSON.stringify(placed));

  // 4. A tap on it: its card's title is its name.
  check("a tap on the engine opens its card", await openCard());
  const title = await cardTitle();
  check("the engine card's title is the engine's name, not \"Engine\"", !!placed && title === placed.name, JSON.stringify(title));
  await shot("1-card-named");
  // (A look at its plate from the side, the card closed, then opened again.)
  await tap(".engine-card > .close");
  await p.evaluate((id) => {
    const w = window.woodrail;
    const plate = w.trainView.carObject(id).getObjectByName("name-plates").children[0];
    const at = plate.getWorldPosition(new w.camera.position.constructor());
    const out = plate.getWorldDirection(new w.camera.position.constructor());
    w.director.glideTo(at, 380, { phi: 1.15, theta: Math.atan2(out.x, out.z), duration: 0.1 });
  }, placed.id);
  await p.waitForTimeout(800);
  await settle();
  await shot("2-plate-close");
  check("a tap on the engine opens its card again", await openCard());

  // 5. Rename it: a tap on the title, a name typed (longer than 14 letters: the box stops at 14), Enter.
  await tap(".engine-card .engine-name");
  const boxShown = await p.evaluate(() => {
    const i = document.querySelector(".engine-card .engine-name-input");
    return !!i && !i.hidden && document.activeElement === i && i.maxLength === 14;
  });
  check("a tap on the title gives a text box (14 letters at most), focused", boxShown);
  await p.keyboard.press("Control+A");
  await p.keyboard.type("Sir Toppington Hat");
  await shot("3-renaming");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(600);
  const renamed = await engine();
  check("the name typed is the engine's (cut to 14 letters)", renamed?.name === "Sir Toppington", JSON.stringify(renamed));
  check("…on its card's title", (await cardTitle()) === "Sir Toppington", JSON.stringify(await cardTitle()));
  await settle();
  check("…and painted on its plates", (await engine())?.plate === "Sir Toppington", JSON.stringify(await engine()));
  await shot("4-renamed");

  // 6. Reloaded, the game continued from its save: the engine keeps its new name, on its card.
  await p.waitForTimeout(2500); // (saved)
  await p.reload();
  await enterGame();
  const back = await engine();
  check("after a reload the engine is still named Sir Toppington", back?.name === "Sir Toppington" && back.plate === "Sir Toppington", JSON.stringify(back));
  if (back) {
    await p.evaluate((at) => {
      const w = window.woodrail;
      w.director.glideTo(new w.camera.position.constructor(at.x, 0, at.z), 500, { duration: 0.1 });
    }, back.at);
    await p.waitForTimeout(800);
    await settle();
  }
  check("a tap on it opens its card", await openCard());
  check("…titled Sir Toppington", (await cardTitle()) === "Sir Toppington", JSON.stringify(await cardTitle()));
  await shot("5-after-reload");
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
