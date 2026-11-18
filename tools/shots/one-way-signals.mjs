// Pictures of placing signals, for judging the one-way signal (before and after): Game mode, Switches and Routes
// learned and a line from the first town's station to the forest laid by the game's own pathfinder (a harness
// shortcut: it's for looking). On a 390×844 phone by touch and a 1440×900 page by mouse: the Signals shelf, a pair held
// over a joint, the One way held (when the tray has it) each way, placed, and a pair's card.
//
// Usage: node tools/shots/one-way-signals.mjs [<out dir>]   (default out: e2e-out/one-way-signals)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/one-way-signals";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5381, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

for (const dev of [
  { name: "phone", viewport: { width: 390, height: 844 }, touch: true },
  { name: "desktop", viewport: { width: 1440, height: 900 }, touch: false },
]) {
  const ctx = await b.newContext({ viewport: dev.viewport, deviceScaleFactor: 2, hasTouch: dev.touch, isMobile: dev.touch });
  await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  p.on("pageerror", (e) => console.log("page error:", e.message));
  const shot = (n) => p.screenshot({ path: `${OUT}/${dev.name}-${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
  const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  const screenOf = (v) =>
    p.evaluate((v) => {
      const w = window.woodrail;
      const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
    }, v);
  const glideTo = async (v, dist = 900) => {
    await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2 }), [v, dist]);
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
    await frames();
  };
  // A press, moves and a release, by finger (56 px below where it's held, as the game lifts a held thing) or mouse.
  const lift = dev.touch ? 56 : 0;
  let t = 0;
  const down = async (x, y) => {
    if (dev.touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp: (t = Date.now() / 1000), touchPoints: [{ x, y, id: 1 }] });
    else {
      await p.mouse.move(x, y);
      await p.mouse.down();
    }
  };
  const move = async (x, y) => {
    if (dev.touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", timestamp: (t += 0.03), touchPoints: [{ x, y, id: 1 }] });
    else await p.mouse.move(x, y);
  };
  const up = async () => {
    if (dev.touch) await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", timestamp: (t += 0.05), touchPoints: [] });
    else await p.mouse.up();
  };
  const tile = (key) =>
    p.evaluate((key) => {
      const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
      if (!e) return null;
      e.scrollIntoView({ inline: "center" });
      const r = e.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    }, key);

  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  const setup = await p.evaluate(async () => {
    const { play } = await import("/src/play/player.ts");
    const { rulesFor } = await import("/src/play/rules.ts");
    const { connectorRef, pieceOfRef } = await import("/src/track/layout.ts");
    const { jointPose } = await import("/src/game/signal-place.ts");
    const w = window.woodrail;
    for (const r of ["switches", "routes"]) w.learn(r);
    const station = w.world.stations.get(w.world.landscape.towns[0].id);
    const forest = [...w.world.depots.values()].find((id) => w.layout.getPiece(id)?.type === "depot-forest");
    const before = new Set(w.layout.pieceIds());
    let line = null;
    for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
      const r = play(w.world.layout, w.editor(), connectorRef(station, i), connectorRef(forest, j), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 });
      if (r.ok) {
        line = [...w.layout.pieceIds()].filter((id) => !before.has(id));
        break;
      }
    }
    if (!line) return null;
    const plain = (id) => /^(straight|curve)/.test(w.layout.getPiece(id).type);
    const pairs = [];
    for (const a of line)
      for (const c of [0, 1]) {
        const o = w.layout.joinedConnector(connectorRef(a, c));
        if (o !== -1 && plain(a) && line.includes(pieceOfRef(o)) && plain(pieceOfRef(o))) pairs.push(connectorRef(a, c));
      }
    const at = pairs[Math.floor(pairs.length / 2)];
    const at2 = pairs[Math.floor(pairs.length / 4)];
    return { at, joint: jointPose(w.layout, at), joint2: jointPose(w.layout, at2) };
  });
  if (!setup) {
    console.log(dev.name, "no line");
    continue;
  }
  const j = setup.joint;
  await glideTo(j, dev.touch ? 800 : 1000);
  await settle();
  // The Signals shelf opened.
  const shelf = await p.evaluate(() => {
    const g = [...document.querySelectorAll(".scroller .tray-group")].find((b) => b.querySelector(".label")?.textContent === "Signals");
    if (!g) return null;
    g.scrollIntoView({ inline: "center" });
    const r = g.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  });
  if (shelf) {
    if (dev.touch) await p.touchscreen.tap(...shelf);
    else await p.mouse.click(...shelf);
  }
  await p.waitForFunction(() => !!document.querySelector('.scroller .tray-item[data-key="signal"] img'), null, { timeout: 30000 }).catch(() => {});
  await frames();
  await shot("1-shelf");
  // Held over the joint, dragged along the line toward it (the way trains go), then back (the other way).
  const hold = async (key, name, back) => {
    const from = await tile(key);
    if (!from) return false;
    const along = (d) => ({ x: j.x - Math.cos(j.heading) * d, y: j.y, z: j.z - Math.sin(j.heading) * d });
    const [bx, by] = await screenOf(along(120));
    const [nx, ny] = await screenOf(along(30));
    await down(...from);
    for (let k = 1; k <= 12; k++) await move(from[0] + ((bx - from[0]) * k) / 12, from[1] + ((by + lift - from[1]) * k) / 12);
    for (let k = 1; k <= 10; k++) await move(bx + ((nx - bx) * k) / 10, by + lift + ((ny - by) * k) / 10);
    await frames();
    await settle();
    await shot(`2-held-${name}`);
    if (back) {
      const [cx, cy] = await screenOf(along(60));
      for (let k = 1; k <= 6; k++) await move(nx + ((cx - nx) * k) / 6, ny + lift + ((cy - ny) * k) / 6);
      await frames();
      await settle();
      await shot(`2-held-${name}-back`);
    }
    return true;
  };
  await hold("signal", "pair", false);
  await up();
  await settle();
  await shot("3-placed-pair");
  // The pair's card (a tap on its post).
  const top = await p.evaluate((at) => window.woodrail.marksView.topOf(window.woodrail.layout.signalAt(at)?.id ?? -1), setup.at);
  if (top) {
    const [px, py] = await screenOf({ x: top.x, y: top.y - 20, z: top.z });
    if (dev.touch) await p.touchscreen.tap(px, py);
    else await p.mouse.click(px, py);
    await p.waitForTimeout(800);
    await settle();
    await shot("4-pair-card");
    await p.keyboard.press("Escape");
    await p.evaluate(() => (window.woodrail.hud.hideCards?.(), window.woodrail.interaction.clearSelection()));
  }
  // The One way, on another joint.
  for (const m of [...(await p.evaluate(() => [...window.woodrail.layout.signals()].map((m) => m.id)))]) await p.evaluate((id) => window.woodrail.editor().removeSignal(id), m);
  if (await tile("signal:one-way")) {
    Object.assign(j, setup.joint);
    await hold("signal:one-way", "one-way", true);
    await up();
    await settle();
    await shot("5-placed-one-way");
    const id = await p.evaluate(() => [...window.woodrail.layout.signals()][0]?.id ?? -1);
    const top1 = await p.evaluate((id) => window.woodrail.marksView.topOf(id), id);
    if (top1) {
      const [px, py] = await screenOf({ x: top1.x, y: top1.y - 20, z: top1.z });
      if (dev.touch) await p.touchscreen.tap(px, py);
      else await p.mouse.click(px, py);
      await p.waitForTimeout(800);
      await settle();
      await shot("6-one-way-card");
    }
  }
  await ctx.close();
}
await b.close();
await server.close();
console.log("pictures in", OUT);
