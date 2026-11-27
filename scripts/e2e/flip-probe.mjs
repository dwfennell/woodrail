// Probe (temporary): how often Flip fails to change a laid curve. Desktop mouse, Sandbox seed 24.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { batterySaverIn } from "./lib/fast.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const PHONE = process.argv.includes("--phone");
const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
batterySaverIn(b);
const ctx = await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  localStorage.setItem("woodrail.favourites", "[]");
});
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror", String(e)));
await p.goto(`${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-24`);
await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
for (let k = 0; ; k++) {
  try {
    await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 120000 });
    break;
  } catch (e) {
    if (k > 3) throw e;
    await p.waitForLoadState("load").catch(() => {});
  }
}
await p.evaluate(() => { document.querySelector(".coach:not([hidden]) .coach-skip")?.click(); });
await p.evaluate(() => window.woodrail.settled());
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const screen = (x, y, z) =>
  p.evaluate(([x, y, z]) => {
    const w = window.woodrail;
    const v = new w.camera.position.constructor(x, y, z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, [x, y, z]);
const press = async (xy) => { if (PHONE) await p.touchscreen.tap(xy[0], xy[1]); else await p.mouse.click(xy[0], xy[1]); await frames(); };
const trayItem = async (key) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return q.width ? [q.x + q.width / 2, q.y + q.height / 2] : null; }, key);
  const r0 = await find();
  if (r0) return r0;
  const shelf = await p.evaluate(async (key) => {
    const { trayTabs, trayKey } = await import("/src/ui/tray-catalogue.ts");
    for (const t of trayTabs(window.woodrail.mode())) for (const g of t.groups) if (g.items.some((i) => trayKey(i) === key)) return { tab: t.label, shelf: g.label };
    return null;
  }, key);
  if (!shelf) return null;
  const tabAt = await p.evaluate((label) => { const t = [...document.querySelectorAll(".tray .tabs .tab")].find((t) => t.textContent.trim() === label); if (!t) return null; const q = t.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, shelf.tab);
  if (tabAt) await press(tabAt);
  const back = await p.evaluate(() => { const e = document.querySelector(".scroller .tray-back"); if (!e) return null; const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
  if (back) await press(back);
  const g = await p.evaluate((label) => { const e = [...document.querySelectorAll(".scroller .tray-group")].find((e) => e.querySelector(".label")?.textContent === label); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, shelf.shelf);
  if (g) await press(g);
  return find();
};
const flipBtn = () => p.evaluate(() => { const e = document.querySelector(".tray-flip"); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
const held = () => p.evaluate(() => { const i = window.woodrail.interaction; const m = i.mode.kind === "drag-piece" ? i.mode : i.preview; return m ? { kind: i.mode.kind, heldFlipped: m.heldFlipped, flipped: m.flipped, snap: m.snap.kind, conn: m.snap.connector, tray: i.trayFlipped, fp: i.flipPressed } : { kind: i.mode.kind, tray: i.trayFlipped }; });

// Setup: a straight (and points) on open ground, by the editor.
const base = await p.evaluate(async () => {
  const w = window.woodrail;
  const { poseForCentre } = await import("/src/editor/editor.ts");
  const r = w.canvas.getBoundingClientRect();
  const h = w.interaction.cameraHeading();
  for (let fy = 0.35; fy <= 0.6; fy += 0.05) for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
    const g = w.interaction.groundAt(r.left + r.width * fx, r.top + r.height * fy);
    if (!g) continue;
    const pose = poseForCentre("straight-216", false, g.x, g.z, h);
    if (w.interaction.placeWhy("straight-216", pose, 0, -1) !== null) continue;
    const pose2 = poseForCentre("switch", false, g.x - 400 * Math.sin(h), g.z + 400 * Math.cos(h), h);
    if (w.interaction.placeWhy("switch", pose2, 0, -1) !== null) continue;
    const a = w.editor().place("straight-216", pose, 0, false);
    const s = w.editor().place("switch", pose2, 0, false);
    return { a, s };
  }
  return null;
});
console.log("setup", base);
const freeEnds = (id) =>
  p.evaluate(async (id) => {
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    const l = window.woodrail.layout;
    const q = l.getPiece(id);
    return getPieceDef(q.type, q.flipped).connectors.map((k, i) => {
      const at = transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 });
      return { i, free: l.joinedConnector(connectorRef(id, i)) === -1, x: at.x, z: at.z, heading: at.heading };
    }).filter((e) => e.free);
  }, id);
const shape = (id) =>
  p.evaluate(async (id) => {
    const { getPieceDef } = await import("/src/track/pieces.ts");
    const { transformPose } = await import("/src/track/math.ts");
    const q = window.woodrail.layout.getPiece(id);
    if (!q) return null;
    return getPieceDef(q.type, q.flipped).connectors.map((k) => { const a = transformPose(q.pose, k.pose, { x: 0, z: 0, heading: 0 }); return `${Math.round(a.x)},${Math.round(a.z)}`; }).sort().join(" ") + (q.flipped ? " F" : " N");
  }, id);
const ids = () => p.evaluate(() => [...window.woodrail.layout.pieceIds()]);

/** One trial: curve from the tray carried to `at` (screen), optional rotate, optional flip by key or button; laid. */
async function trial(at, { flip = "none", rotate = 0, wiggle = true }) {
  const key = "piece:curve-large";
  let r = await trayItem(key);
  if (!r) throw new Error("no tray item");
  if (PHONE) {
    // touch: drag from the tray, held 56 px above the finger.
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
    const to = [at[0], at[1] + 56];
    await touch("touchStart", [{ x: r[0], y: r[1], id: 1 }]);
    for (let k = 1; k <= 10; k++) await touch("touchMove", [{ x: r[0] + ((to[0] - r[0]) * k) / 10, y: r[1] + ((to[1] - r[1]) * k) / 10, id: 1 }]);
    await frames();
    for (let t = 0; t < rotate; t++) {
      const tb = await p.evaluate(() => { const e = [...document.querySelectorAll(".tray-orient button")][0]; const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
      await touch("touchStart", [{ x: to[0], y: to[1], id: 1 }, { x: tb[0], y: tb[1], id: 2 }]);
      await touch("touchEnd", [{ x: to[0], y: to[1], id: 1 }]);
    }
    const h0 = await held();
    if (flip !== "none") {
      const fb = await flipBtn();
      await touch("touchStart", [{ x: to[0], y: to[1], id: 1 }, { x: fb[0], y: fb[1], id: 2 }]);
      await touch("touchEnd", [{ x: to[0], y: to[1], id: 1 }]);
      await frames();
    }
    if (wiggle) { await touch("touchMove", [{ x: to[0] + 2, y: to[1], id: 1 }]); await touch("touchMove", [{ x: to[0], y: to[1], id: 1 }]); }
    await frames();
    const h1 = await held();
    const before = await ids();
    await touch("touchEnd", []);
    await frames();
    await p.evaluate(() => window.woodrail.settled());
    await cdp.detach();
    const after = await ids();
    const id = after.find((i) => !before.includes(i));
    return { id, h0, h1 };
  }
  await p.mouse.click(r[0], r[1]);
  await frames();
  for (let s = 1; s <= 4; s++) await p.mouse.move(r[0] + ((at[0] - r[0]) * s) / 4, r[1] + ((at[1] - r[1]) * s) / 4);
  await frames();
  for (let t = 0; t < rotate; t++) await p.keyboard.press("r");
  await frames();
  const h0 = await held();
  if (flip === "key") await p.keyboard.press("f");
  if (flip === "button") {
    const fb = await flipBtn();
    await p.mouse.move(fb[0], fb[1], { steps: 3 });
    await p.mouse.click(fb[0], fb[1]);
    await p.mouse.move(at[0], at[1], { steps: 3 });
  }
  await frames();
  if (wiggle) { await p.mouse.move(at[0] + 2, at[1]); await p.mouse.move(at[0], at[1]); }
  await frames();
  const h1 = await held();
  const before = await ids();
  await p.mouse.click(at[0], at[1]);
  await frames();
  await p.evaluate(() => window.woodrail.settled());
  const after = await ids();
  const id = after.find((i) => !before.includes(i));
  await p.keyboard.press("Escape");
  await frames();
  return { id, h0, h1 };
}
async function clean(id) {
  if (id !== undefined) await p.evaluate((id) => window.woodrail.editor().remove(id), id);
  // tray flip back off
  await p.evaluate(() => { const i = window.woodrail.interaction; i.trayFlipped = false; i.trayTurns = 0; i.trayFine = 0; i.arm(null); });
  await frames();
}

const sA = (await freeEnds(base.a))[1];
const sS = await freeEnds(base.s);
const loose = await p.evaluate(() => { const r = window.woodrail.canvas.getBoundingClientRect(); return null; });
const targets = {
  free: await screen(sA.x + 300 * Math.cos(sA.heading + 1.2), 0, sA.z + 300 * Math.sin(sA.heading + 1.2)),
  end: await screen(sA.x + 40 * Math.cos(sA.heading), 0, sA.z + 40 * Math.sin(sA.heading)),
};
sS.forEach((e, k) => (targets[`points${e.i}`] = null));
for (const e of sS) targets[`points${e.i}`] = await screen(e.x + 40 * Math.cos(e.heading), 0, e.z + 40 * Math.sin(e.heading));
let fails = 0, total = 0;
for (const [name, at] of Object.entries(targets)) {
  for (const rotate of [0, 1]) {
    for (const how of ["key", "button"]) {
      const a = await trial(at, { flip: "none", rotate });
      const sa = a.id !== undefined ? await shape(a.id) : null;
      await clean(a.id);
      const f = await trial(at, { flip: how, rotate });
      const sf = f.id !== undefined ? await shape(f.id) : null;
      await clean(f.id);
      total++;
      const same = sa !== null && sa === sf;
      if (same || sf === null) fails++;
      console.log(`${same ? "SAME" : sf === null ? "NONE" : "ok  "} ${name} rot=${rotate} ${how}: plain[${sa}] flipped[${sf}] h0=${JSON.stringify(f.h0)} h1=${JSON.stringify(f.h1)}`);
    }
  }
}
console.log(`flip did nothing: ${fails}/${total}`);
await b.close();
await server.close();
