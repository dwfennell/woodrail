// End-to-end piece names and details (`npm run e2e:names`, issues #10 and #12), on the player's path:
// - on a phone (390×844 and 360×740): a long press on a tray item shows its name and what it does, and doesn't pick it
//   up (nor does moving the finger after), or tap it; a quick drag still takes it out; the piece put down, tapped,
//   opens its card named ("Wide curve", not "Track piece") with its detail in two lines at most, buttons 44 px or more;
// - on a desktop: hovering a tray item shows its name and detail.
// Starts its own dev server on any free port. Chromium as for e2e:roads. About 12 min under SwiftShader.
// DEBUG=1 logs the events and the ghost while held; ONLY390=1 skips the 360×740 pass.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const URL = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settled = (p) => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));

async function sandbox(ctx) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(URL);
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null, null, { timeout: 180000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && document.querySelector(".tray .scroller .tray-group") !== null, null, { timeout: 120000 });
  return p;
}

const centreOf = (p, sel) => p.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
const tipShown = (p) => p.evaluate(() => { const t = document.querySelector(".tooltip"); return t && !t.hidden && getComputedStyle(t).visibility !== "hidden" ? { name: t.querySelector(".tip-name")?.textContent ?? null, detail: t.querySelector(".tip-detail")?.textContent ?? null, use: t.querySelector(".tip-use")?.textContent ?? null, text: t.textContent } : null; });
const state = (p) => p.evaluate(() => { const w = window.woodrail; return { mode: w.interaction.mode.kind, pieces: w.layout.pieceCount, armed: !!w.interaction.armed, ghost: !!w.interaction.preview?.ghost.visible }; });

async function phone(viewport) {
  const tag = `${viewport.width}×${viewport.height}`;
  const ctx = await b.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await sandbox(ctx);
  const cdp = await ctx.newCDPSession(p);
  const now = () => Date.now() / 1000;
  const touch = (type, x, y, t = now()) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const tap = async (x, y) => {
    const t = now();
    await touch("touchStart", x, y, t);
    await touch("touchEnd", x, y, t + 0.08);
  };
  // Close in on open, flat ground near the view's middle (setup: where to build, by the game's own placement check,
  // 700 mm or more from track; the building itself goes through the tray).
  // (On the mat, where a player may build: each point of a disc 330 mm across clear by `checkPlacement` either way,
  // 400 mm from models, as e2e:touch's `clearAt`.)
  const spot = await p.evaluate(async () => {
    const w = window.woodrail;
    const { checkPlacement } = await import("/src/landscape/clearance.ts");
    const land = w.landscape;
    const b = w.director.bounds;
    const pieces = [...w.layout.pieceIds()].map((id) => w.layout.getPiece(id).pose);
    const props = [...w.props.all()];
    const clear = (x, z) =>
      x > b.x0 + 300 && x < b.x1 - 300 && z > b.z0 + 300 && z < b.z1 - 300 &&
      !pieces.some((q) => Math.hypot(q.x - x, q.z - z) < 700) && !props.some((q) => Math.hypot(q.x - x, q.z - z) < 400) &&
      [0, Math.PI / 2].every((h) => checkPlacement(land, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
    const disc = [[0, 0], ...Array.from({ length: 8 }, (_, k) => [165 * Math.cos((k * Math.PI) / 4), 165 * Math.sin((k * Math.PI) / 4)])];
    const t = w.controls.target;
    for (let d = 0; d <= 8000; d += 54) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 54));
      for (let a = 0; a < n; a++) {
        const x = t.x + d * Math.cos((a * 2 * Math.PI) / n);
        const z = t.z + d * Math.sin((a * 2 * Math.PI) / n);
        if (disc.every(([dx, dz]) => clear(x + dx, z + dz))) return { x, z };
      }
    }
    return null;
  });
  if (!spot) throw new Error("no open ground near the view");
  // (Again if something else moved the view meanwhile, as the game's opening glide may: until it's there.)
  for (let k = 0; k < 4; k++) {
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
    const there = await p.evaluate(async (spot) => {
      const w = window.woodrail;
      const { frameDistance } = await import("/src/game/camera-director.ts");
      const d = frameDistance(300, w.camera.fov, w.camera.aspect);
      const t = w.controls.target;
      if (Math.hypot(t.x - spot.x, t.z - spot.z) < 30 && Math.abs(w.camera.position.distanceTo(t) - d) < 0.1 * d) return true;
      w.director.glideTo(t.clone().set(spot.x, 0, spot.z), d, { duration: 0.2 });
      return false;
    }, spot);
    if (there) break;
    await frames(p);
  }
  await frames(p);
  if (process.env.DEBUG) console.log("view distance", await p.evaluate(() => Math.round(window.woodrail.camera.position.distanceTo(window.woodrail.controls.target))));

  // Open the Curve shelf (a tap), and wait for its buttons to be drawn.
  // (Setup: the shelf scrolled into view in code. Scrolling the tray isn't what's tested.)
  const shelf = await p.evaluate(() => { const e = [...document.querySelectorAll(".scroller .tray-group")].find((b) => b.querySelector(".label")?.textContent === "Curve"); e.scrollIntoView({ inline: "center", block: "nearest" }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await frames(p);
  await sleep(250);
  await tap(...shelf);
  await p.waitForFunction(() => document.querySelector('.scroller .tray-item[data-key="piece:curve-wide"]') !== null, null, { timeout: 30000 });
  await p.evaluate(() => document.querySelector('.scroller .tray-item[data-key="piece:curve-wide"]').scrollIntoView({ inline: "center", block: "nearest" }));
  await frames(p);
  await sleep(250);
  const item = await centreOf(p, '.scroller .tray-item[data-key="piece:curve-wide"]');

  if (process.env.DEBUG)
    await p.evaluate(() => {
      window.__ev = [];
      const t0 = performance.now();
      for (const ty of ["pointerdown", "pointermove", "pointerup", "pointercancel", "click", "contextmenu", "keydown", "wheel"]) window.addEventListener(ty, (e) => window.__ev.push(`${ty}@${Math.round(e.timeStamp - t0)} now ${Math.round(performance.now() - t0)} ${e.pointerType ?? ""} ${Math.round(e.clientX ?? 0)},${Math.round(e.clientY ?? 0)}`), true);
      new MutationObserver(() => window.__ev.push(`tip hidden=${document.querySelector(".tooltip").hidden} now ${Math.round(performance.now() - t0)}`)).observe(document.querySelector(".tooltip"), { attributes: true });
    });
  const dump = async (what) => process.env.DEBUG && console.log(what, JSON.stringify(await p.evaluate(() => window.__ev.splice(0)), null, 0));
  // 1. A long press shows its details, and starts no drag.
  const before = await state(p);
  await touch("touchStart", item[0], item[1]);
  await sleep(800);
  await p.waitForFunction(() => window.woodrail.hud.lastTrayDetails > 0, null, { timeout: 10000 }).catch(() => {});
  const tip = await tipShown(p);
  check(`${tag}: a long press on a tray item shows its name and what it does`, tip?.name === "Wide curve" && !!tip.detail && tip.use === null, JSON.stringify(tip));
  const held = await state(p);
  check(`${tag}: …and doesn't start a drag`, held.mode === before.mode && !held.ghost && held.pieces === before.pieces, JSON.stringify(held));
  // The finger moves up out of the tray after the details: still nothing picked up.
  for (let k = 1; k <= 8; k++) await touch("touchMove", item[0], item[1] - 30 * k);
  await frames(p);
  const moved = await state(p);
  await touch("touchEnd", 0, 0);
  const stays = await tipShown(p);
  await dump("long press");
  const tipBox = await p.evaluate(() => { const r = document.querySelector(".tooltip").getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: innerWidth }; });
  await settled(p);
  await frames(p);
  const after = await state(p);
  check(`${tag}: …nor does moving after it, and lifting puts nothing down or makes nothing ready`, !moved.ghost && after.pieces === before.pieces && !after.armed && after.mode === before.mode, `moved ${JSON.stringify(moved)}; after ${JSON.stringify(after)}`);
  check(`${tag}: …and the details stay up a moment to read`, stays?.name === "Wide curve", JSON.stringify(stays));
  // The card's two lines at 360 px: the tip fits on the screen.
  check(`${tag}: the details fit on the screen`, tipBox.l >= 0 && tipBox.r <= tipBox.w, JSON.stringify(tipBox));
  await p.waitForFunction(() => document.querySelector(".tooltip").hidden, null, { timeout: 15000 }).catch(() => {});
  check(`${tag}: …then go`, (await tipShown(p)) === null);

  // 2. A quick drag still takes it out: onto open ground in the middle of the view.
  // (Below the middle: on touch the held piece rides above the finger, so it's seen.)
  const drop = await p.evaluate(() => [Math.round(innerWidth / 2), Math.round(innerHeight / 2 + 60)]);
  const ids0 = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
  await p.evaluate(() => {
    const h = window.woodrail.hud;
    window.__said = [];
    const toast = h.toast.bind(h);
    h.toast = (m, ...a) => (window.__said.push(m), toast(m, ...a));
    const refuse = h.setRefusal.bind(h);
    h.setRefusal = (m, ...a) => (m && window.__said.push(m), refuse(m, ...a));
  });
  let t = now();
  await touch("touchStart", item[0], item[1], t);
  const steps = 12;
  for (let k = 1; k <= steps; k++) await touch("touchMove", item[0] + ((drop[0] - item[0]) * k) / steps, item[1] + ((drop[1] - item[1]) * k) / steps, t + 0.02 * k);
  // Held: where the ghost says it may go (not on a house, a hill…), the finger lifts; else it moves on a little, as a
  // player's would.
  const holding = () => p.evaluate(() => { const m = window.woodrail.interaction.mode; return m.kind === "drag-piece" ? { visible: m.ghost.visible, blocked: !!m.blocked, hint: m.hint ?? null } : { kind: m.kind }; });
  let last = drop;
  let tk = t + 0.02 * steps;
  let clearReads = 0;
  for (let k = 0; k < 32; k++) {
    await frames(p);
    const g = await holding();
    if (process.env.DEBUG) console.log("held", JSON.stringify(g), last);
    clearReads = g.visible && !g.blocked && !g.hint ? clearReads + 1 : 0;
    if (clearReads >= 2) break;
    if (clearReads === 1) continue;
    const a = (k * Math.PI) / 4;
    const r = 40 + 20 * Math.floor(k / 8);
    last = [drop[0] + r * Math.cos(a), drop[1] + r * Math.sin(a)];
    tk += 0.03;
    await touch("touchMove", last[0], last[1], Math.max(tk, now()));
  }
  await touch("touchEnd", 0, 0, now());
  await settled(p);
  await frames(p);
  await dump("drag");
  if (process.env.DEBUG) console.log("after drop", JSON.stringify(await p.evaluate(() => ({ said: window.__said, toasts: [...document.querySelectorAll(".toast")].map((t) => t.textContent), mode: window.woodrail.interaction.mode.kind }))));
  const placed = await p.evaluate((ids0) => [...window.woodrail.layout.pieceIds()].filter((id) => !ids0.includes(id) && window.woodrail.layout.getPiece(id).type === "curve-wide"), ids0);
  check(`${tag}: a quick drag still takes the piece out and puts it down`, placed.length === 1, `new wide curves ${JSON.stringify(placed)}`);

  // 3. The piece tapped: its card says its name and what it does.
  if (placed.length === 1) {
    // It stays ready for the next one: a tap on it in the tray puts it away, as a player would.
    if (await p.evaluate(() => !!window.woodrail.interaction.armed)) {
      const again = await centreOf(p, '.scroller .tray-item[data-key="piece:curve-wide"]');
      await sleep(300);
      await tap(...again);
      await settled(p);
      await frames(p);
    }
    // The next piece waits at its end: "tap anywhere else to stop". A tap on open ground, as the toast says.
    const open = await p.evaluate(() => {
      const w = window.woodrail;
      for (let y = 160; y < innerHeight - 260; y += 20)
        for (let x = 20; x < innerWidth - 20; x += 20) if (document.elementFromPoint(x, y) === w.canvas && !w.interaction.pick(x, y, true)) return [x, y];
      return null;
    });
    if (open) {
      await p.touchscreen.tap(...open);
      await settled(p);
      await frames(p);
    }
    if (process.env.DEBUG) console.log("before tap", open, JSON.stringify(await state(p)));
    const at = await p.evaluate((id) => {
      const w = window.woodrail;
      for (let r = 0; r <= 160; r += 8)
        for (let a = 0; a < 16; a++) {
          const x = Math.round(innerWidth / 2 + r * Math.cos((a * Math.PI) / 8));
          const y = Math.round(innerHeight / 2 + r * Math.sin((a * Math.PI) / 8));
          if (document.elementFromPoint(x, y) !== w.canvas) continue;
          const hit = w.interaction.pick(x, y, true);
          if (hit?.kind === "piece" && hit.pieceId === id) return [x, y];
        }
      // Nearer the drop: anywhere on screen.
      for (let y = 100; y < innerHeight - 200; y += 10)
        for (let x = 10; x < innerWidth - 10; x += 10) {
          if (document.elementFromPoint(x, y) !== w.canvas) continue;
          const hit = w.interaction.pick(x, y, true);
          if (hit?.kind === "piece" && hit.pieceId === id) return [x, y];
        }
      return null;
    }, placed[0]);
    if (!at) check(`${tag}: the placed piece is on screen to tap`, false);
    else {
      // (Past a double tap's time since the tap on open ground, and with the view still.)
      await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
      await frames(p);
      await sleep(800);
      await p.evaluate(() => {
          const h = window.woodrail.hud;
          window.__cards = [];
          for (const k of ["showPieceCard", "hideCards", "showCarCard", "showGroupCard"]) {
            const f = h[k].bind(h);
            h[k] = (...a) => (window.__cards.push(`${k} ${JSON.stringify(a).slice(0, 120)} ${new Error().stack.split("\n").slice(2, 4).join(" < ").replace(/https?:\/\/[^/]+/g, "")}`), f(...a));
          }
          window.__down = [];
          window.woodrail.canvas.addEventListener("pointerdown", (e) => window.__down.push(`down ${e.pointerType} ${e.clientX},${e.clientY}`));
          window.woodrail.canvas.addEventListener("pointerup", (e) => window.__down.push(`up ${e.pointerType} ${e.clientX},${e.clientY}`));
        });
      await p.touchscreen.tap(...at);
      if (process.env.DEBUG) console.log("tapped", at, JSON.stringify(await state(p)));
      await p.waitForFunction(() => { const c = document.querySelector(".piece-card"); return c && !c.hidden; }, null, { timeout: 60000 }).catch(() => {});
      await frames(p);
      if (process.env.DEBUG) console.log("cards", JSON.stringify(await p.evaluate(([id, at]) => { const i = window.woodrail.interaction; return [window.__cards, window.__down, i.selectedPiece, i.withinReach(id), i.pick(at[0], at[1], true), i.drawing, i.erasing, i.picking, window.woodrail.camera.position.distanceTo(window.woodrail.controls.target)]; }, [placed[0], at])));
      const card = await p.evaluate(() => {
        const c = document.querySelector(".piece-card");
        const d = c.querySelector(".piece-detail");
        const lh = parseFloat(getComputedStyle(d).lineHeight) || 1.3 * parseFloat(getComputedStyle(d).fontSize);
        const btns = [...c.querySelectorAll("button")].filter((x) => !x.hidden && x.getBoundingClientRect().width > 0 && !x.classList.contains("select-more")).map((x) => ({ t: x.textContent.trim(), h: Math.round(x.getBoundingClientRect().height), w: Math.round(x.getBoundingClientRect().width) }));
        return { open: !c.hidden, title: c.querySelector(".card-title").textContent, detail: d.hidden ? null : d.textContent, lines: Math.round(d.getBoundingClientRect().height / lh), btns };
      });
      const why = card.open ? "" : " " + JSON.stringify(await p.evaluate(([id, at]) => { const i = window.woodrail.interaction; return { cards: window.__cards, events: window.__down, selected: i.selectedPiece, reach: i.withinReach(id), pick: i.pick(at[0], at[1], true), mode: i.mode.kind }; }, [placed[0], at]));
      check(`${tag}: tapping the placed piece opens its card named “Wide curve”`, card.open && card.title === "Wide curve", JSON.stringify(card) + why);
      check(`${tag}: …with what it does, in two lines at most`, !!card.detail && card.lines >= 1 && card.lines <= 2, `${card.lines} lines: ${card.detail}`);
      // Layout (not the player's path): every piece's detail in this open card, in two lines at most.
      const worst = await p.evaluate(async () => {
        const { pieceInfo } = await import("/src/ui/piece-info.ts");
        const { PIECE_TYPES } = await import("/src/track/index.ts");
        const d = document.querySelector(".piece-card .piece-detail");
        const keep = d.textContent;
        const lh = parseFloat(getComputedStyle(d).lineHeight) || 1.3 * parseFloat(getComputedStyle(d).fontSize);
        let most = { lines: 0, detail: "" };
        for (const detail of new Set(PIECE_TYPES.map((t) => pieceInfo(t).detail))) {
          d.textContent = detail;
          const lines = Math.round(d.getBoundingClientRect().height / lh);
          if (lines > most.lines) most = { lines, detail };
        }
        d.textContent = keep;
        return most;
      });
      check(`${tag}: every piece's detail fits the card in two lines`, worst.lines <= 2, JSON.stringify(worst));
      check(`${tag}: …and its buttons 44 px or more`, card.btns.length >= 3 && card.btns.every((x) => x.h >= 44 && x.w >= 44), JSON.stringify(card.btns));
    }
  }
  await ctx.close();
}

async function desktop() {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await sandbox(ctx);
  const item = await centreOf(p, '.scroller .tray-item[data-key="piece:straight-144"]');
  await p.mouse.move(item[0], item[1] - 200);
  await p.mouse.move(item[0], item[1], { steps: 3 });
  await p.waitForFunction(() => { const t = document.querySelector(".tooltip"); return t && !t.hidden; }, null, { timeout: 10000 }).catch(() => {});
  const tip = await tipShown(p);
  check("desktop: hovering a tray item shows its name, what it does and how to use it", tip?.name === "Medium straight" && !!tip.detail && /Drag onto the map/.test(tip.use ?? ""), JSON.stringify(tip));
  await ctx.close();
}

try {
  await phone({ width: 390, height: 844 });
  if (!process.env.ONLY390) await phone({ width: 360, height: 740 });
  await desktop();
} catch (e) {
  check("ran without throwing", false, String(e?.stack ?? e));
}
check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
