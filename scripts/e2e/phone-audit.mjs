// Phone audit: screenshots and tap-target measurements at phone sizes, with touch emulation. Not a test: a report.
// node scripts/e2e/phone-audit.mjs <outdir>
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const OUT = process.argv[2] ?? "audit";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const report = [];
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = (p) => p.evaluate(() => Promise.race([window.woodrail.settled?.() ?? null, new Promise((r) => setTimeout(r, 4000))]));

/** Every visible, tappable thing: its size, and neighbours closer than 8 px. */
function measure() {
  const sel = "button, a, [role=button], input, select, summary, .tray-item, .goals-head";
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.pointerEvents === "none") return null;
    for (let a = e; a; a = a.parentElement) if (a.hidden || getComputedStyle(a).display === "none" || Number(getComputedStyle(a).opacity) === 0) return null;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
    return r;
  };
  const name = (e) => {
    const cls = typeof e.className === "string" ? e.className.split(" ").filter(Boolean).slice(0, 2).join(".") : "";
    const label = (e.getAttribute("aria-label") || e.title || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 28);
    const host = e.closest("[class]:not(button)")?.className?.toString().split(" ")[0] ?? "";
    return `${host}>${e.tagName.toLowerCase()}${cls ? "." + cls : ""} "${label}"`;
  };
  const items = [...document.querySelectorAll(sel)].map((e) => ({ e, r: vis(e) })).filter((x) => x.r && !x.e.parentElement.closest(sel));
  const small = items.filter(({ r }) => r.width < 44 || r.height < 44).map(({ e, r }) => `${name(e)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  const tight = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i].r, c = items[j].r;
      const gx = Math.max(c.left - a.right, a.left - c.right), gy = Math.max(c.top - a.bottom, a.top - c.bottom);
      const gap = Math.max(gx, gy);
      if (gap < 4) tight.push(`${name(items[i].e)} ↔ ${name(items[j].e)} gap ${Math.round(gap)}`);
    }
  // Text smaller than 12 px that's showing.
  const tiny = new Set();
  for (const e of document.querySelectorAll(".hud *, .title-screen *")) {
    if (!e.childNodes.length || ![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if (fs < 12 && vis(e)) tiny.add(`${fs}px "${e.textContent.trim().slice(0, 24)}"`);
  }
  return { count: items.length, small, tight: tight.slice(0, 40), tiny: [...tiny].slice(0, 30), hscroll: document.documentElement.scrollWidth > innerWidth ? document.documentElement.scrollWidth : 0 };
}

async function shot(p, tag, note = "") {
  await frames(p);
  const path = `${OUT}/${tag}.png`;
  await p.screenshot({ path });
  const m = await p.evaluate(measure);
  report.push({ tag, path, note, ...m });
  console.log(`\n## ${tag} ${note}\n  ${m.count} targets; small: ${m.small.length}; tight: ${m.tight.length}; tiny text: ${m.tiny.length}; hscroll: ${m.hscroll}`);
  for (const s of m.small) console.log("  small  " + s);
  for (const s of m.tight) console.log("  tight  " + s);
  for (const s of m.tiny) console.log("  tiny   " + s);
}

async function tapSel(p, sel) {
  const el = await p.$(sel);
  if (!el) return false;
  const box = await el.boundingBox();
  if (!box) return false;
  await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await new Promise((r) => setTimeout(r, 500));
  await frames(p);
  return true;
}

async function run(vw, vh, mode, landscape = false) {
  const [w, h] = landscape ? [vh, vw] : [vw, vh];
  const tag = `${w}x${h}-${mode}`;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.goto(URL);
  await p.waitForFunction((m) => !!window.woodrail && !document.querySelector(".title-screen").hidden && document.querySelector(`.title-card.mode-${m} .title-buttons .primary:not([hidden])`) !== null, mode, { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 1500));
  await shot(p, `${tag}-01-title`);
  await tapSel(p, `.title-card.mode-${mode} .title-buttons .primary:not([hidden])`);
  await p.waitForFunction(() => document.querySelector(".tray .scroller .tray-group, .tray .scroller .tray-item") !== null, null, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await shot(p, `${tag}-02-start`, "first screen (help?)");
  // Close help as a player would.
  const helpOpen = await p.evaluate(() => { const h = document.querySelector(".help"); return !!h && !h.hidden && getComputedStyle(h).display !== "none"; });
  if (helpOpen) await tapSel(p, ".help-card .chip");
  // (A first visit now shows the camera tutorial instead: skip it, as a player may.)
  const coachOpen = await p.evaluate(() => { const c = document.querySelector(".coach"); return !!c && !c.hidden; });
  if (coachOpen) await tapSel(p, ".coach .coach-skip");
  await new Promise((r) => setTimeout(r, 2000));
  await shot(p, `${tag}-03-hud`);
  if (landscape && mode === "game") {
    if (await tapSel(p, ".goals-head")) await shot(p, `${tag}-07-goals`);
    await ctx.close();
    return;
  }
  // Menu
  if (await tapSel(p, ".actions > button:last-child")) await shot(p, `${tag}-04-menu`);
  await tapSel(p, ".actions > button:last-child");
  // Tray: open the first shelf.
  if (await tapSel(p, ".scroller .tray-group")) await shot(p, `${tag}-05-shelf`);
  if (await tapSel(p, ".scroller .tray-back")) await frames(p);
  // Tabs of the tray
  const tabs = await p.$$eval(".tabs .tab", (ts) => ts.map((t) => t.textContent));
  console.log("tabs:", tabs);
  if (tabs.length > 1) { await tapSel(p, ".tabs .tab:nth-child(2)"); await shot(p, `${tag}-06-tab2`); await tapSel(p, ".tabs .tab:nth-child(1)"); }
  if (mode === "game") {
    // Goals panel: expand.
    await shot(p, `${tag}-07a-goals-chip`);
    if (await tapSel(p, ".goals-head")) await shot(p, `${tag}-07-goals`);
    if (await tapSel(p, ".goals-tab:nth-child(2)")) await shot(p, `${tag}-07c-news`);
    await tapSel(p, ".goals-close");
    if (await tapSel(p, ".goals-show-icon")) await shot(p, `${tag}-07b-goals-show`);
    await p.keyboard.press("Escape");
    // Blueprints board
    const boardBtn = await p.evaluate(() => { const bs = [...document.querySelectorAll(".actions > button")].filter((b) => !b.hidden && getComputedStyle(b).display !== "none"); return bs.map((b) => b.title); });
    console.log("topbar:", boardBtn);
    if (await p.evaluate(() => !window.woodrail.hud.boardBtn?.hidden)) {
      await p.evaluate(() => window.woodrail.hud.boardBtn.scrollIntoView());
      const t = await p.evaluate(() => window.woodrail.hud.boardBtn.title);
      await tapSel(p, `.actions > button[title="${t}"]`);
      await shot(p, `${tag}-08-board`);
      await p.keyboard.press("Escape");
      await tapSel(p, ".board-panel .close");
    }
    // A town: glide to the first one and tap its station.
    const pt = await p.evaluate(async () => {
      const w = window.woodrail;
      const t = w.landscape.towns[0];
      const { frameDistance } = await import("/src/game/camera-director.ts");
      w.director.glideTo(new w.camera.position.constructor(t.station.x, 0, t.station.z), frameDistance(500, w.camera.fov, w.camera.aspect), { duration: 0.3 });
      await new Promise((r) => setTimeout(r, 1200));
      const v = new w.camera.position.constructor(t.station.x, 0, t.station.z).project(w.camera);
      return [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight, t.name];
    });
    await shot(p, `${tag}-09-town-view`, `town ${pt[2]} at ${pt.map((x) => (typeof x === "number" ? Math.round(x) : x))}`);
    await p.touchscreen.tap(pt[0], pt[1]);
    await new Promise((r) => setTimeout(r, 800));
    await shot(p, `${tag}-10-town-tap`, "after tapping the station");
  } else {
    // Sandbox: place a straight and an engine, tap each.
    await p.evaluate(async () => {
      const w = window.woodrail;
      const { frameDistance } = await import("/src/game/camera-director.ts");
      const g = w.interaction.groundAt(innerWidth / 2, innerHeight * 0.45);
      w.director.glideTo(g, frameDistance(320, w.camera.fov, w.camera.aspect), { duration: 0.3 });
    });
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
    const ok = await p.evaluate(async () => {
      const w = window.woodrail;
      const { poseForCentre } = await import("/src/editor/editor.ts");
      const { nearestCursor } = await import("/src/sim/nearest.ts");
      const g = w.interaction.groundAt(innerWidth / 2, innerHeight * 0.4);
      w.editor().place("straight-216", poseForCentre("straight-216", false, g.x, g.z, Math.PI / 2), 0, false);
      const near = nearestCursor(w.layout, g.x, g.z, 60, Math.PI / 2);
      const r = near && w.sim.addTrainAround(["engine"], near.cursor);
      w.invalidate();
      return r?.kind;
    });
    console.log("engine:", ok);
    await new Promise((r) => setTimeout(r, 1500));
    await p.touchscreen.tap(Math.round((await p.evaluate(() => innerWidth)) / 2), Math.round((await p.evaluate(() => innerHeight)) * 0.4));
    await new Promise((r) => setTimeout(r, 800));
    await shot(p, `${tag}-07-engine-card`);
    if (await tapSel(p, ".engine-card .corner.more")) await shot(p, `${tag}-08-engine-more`);
    await p.keyboard.press("Escape");
  }
  await ctx.close();
}

// ONLY=landscape: just the landscape pass.
if (process.env.ONLY !== "landscape") for (const [w, h] of [[390, 844], [360, 740]]) for (const mode of ["game", "sandbox"]) {
  try { await run(w, h, mode); } catch (e) { console.log("ERR", w, h, mode, e.message.split("\n")[0]); }
}
for (const mode of ["game", "sandbox"]) try { await run(390, 844, mode, true); } catch (e) { console.log("ERR landscape", mode, e.message.split("\n")[0]); }
writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));
await b.close();
await server.close();
