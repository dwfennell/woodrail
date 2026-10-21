// End-to-end click-to-place on a desktop (`npm run e2e:click`): a tray piece clicked with the mouse is carried, its
// ghost following the mouse over the map; each click puts one down there (joined to a track end it's shown at), ready
// for the next; a drag still pans, the wheel still zooms; R turns it; Esc, a right-click or the tray item again put it
// away. On touch a tap in the tray carries nothing (as before). Starts its own dev server on any free port. Chromium as
// for e2e:roads.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
// Have the dev server find and pre-bundle the game's dependencies now, so it doesn't reload the page mid-test.
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

/** A page on the title, into Sandbox (the Track tab's favourites showing). */
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

/** The centre of the medium straight among the favourites (and its key): one piece a click (Auto may lay several). */
const firstItem = (p) =>
  p.evaluate(() => {
    const e = document.querySelector(`.scroller .tray-item[data-key="piece:straight-144"]`);
    if (!e) throw new Error("no medium straight: " + [...document.querySelectorAll(".scroller .tray-item")].map((b) => b.dataset.key ?? b.textContent).join(", "));
    const r = e.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, key: e.dataset.key };
  });
const carried = (p) => p.evaluate(() => { const w = window.woodrail; return !!w.interaction.carried && !!w.interaction.armed; });
const marked = (p, key) => p.evaluate((key) => document.querySelector(`.scroller .tray-item[data-key="${key}"]`)?.classList.contains("armed") ?? false, key);
const ghost = (p) => p.evaluate(() => { const m = window.woodrail.interaction.preview; return m ? { visible: m.ghost.visible, snap: m.snap.kind, blocked: m.blocked ?? null, hint: m.hint ?? null } : null; });
/** Medium straights on the map (a piece put down on a hill brings its risers too: those aren't counted). */
const pieces = (p) => p.evaluate(() => { const w = window.woodrail; return [...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id).type === "straight-144").length; });
const view = (p) => p.evaluate(() => { const w = window.woodrail; const t = w.controls.target; return { x: Math.round(t.x), z: Math.round(t.z), d: Math.round(w.camera.position.distanceTo(t)) }; });
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** Points on open map: on the canvas, nothing there to pick, ground under it, in the middle of the view. */
const openPoints = (p, avoid = []) =>
  p.evaluate((avoid) => {
    const w = window.woodrail;
    const out = [];
    for (let fy = 0.35; fy <= 0.65; fy += 0.05)
      for (let fx = 0.25; fx <= 0.75; fx += 0.05) {
        const x = Math.round(innerWidth * fx);
        const y = Math.round(innerHeight * fy);
        if (avoid.some(([ax, ay]) => Math.hypot(ax - x, ay - y) < 200)) continue;
        if (document.elementFromPoint(x, y) !== w.canvas || w.interaction.pick(x, y) || !w.interaction.groundAt(x, y)) continue;
        out.push([x, y]);
      }
    return out;
  }, avoid);
const openGround = async (p, avoid = []) => (await openPoints(p, avoid))[0] ?? null;

// ---- desktop ----
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await sandbox(ctx);
  // Close in, so a piece is a good size on screen.
  await p.evaluate(async () => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    w.director.glideTo(w.interaction.groundAt(innerWidth / 2, innerHeight / 2), frameDistance(900, w.camera.fov, w.camera.aspect), { duration: 0.2 });
  });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  const item = await firstItem(p);

  // 1. A click in the tray carries it: marked in the tray, the hint said.
  await p.mouse.click(item.x, item.y);
  await frames(p);
  const toast = await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
  check("a click on a tray piece carries it (marked in the tray)", (await carried(p)) && (await marked(p, item.key)), `carried ${await carried(p)}; marked ${await marked(p, item.key)}`);
  check("…and says how: “Click to place · Esc to stop”", /Click to place · Esc to stop/.test(toast), toast);

  // 2. Over the map its ghost follows the mouse; over the tray it's hidden.
  const at = await openGround(p);
  await p.mouse.move(at[0], at[1], { steps: 4 });
  const g1 = await ghost(p);
  await p.mouse.move(item.x, item.y - 4, { steps: 2 });
  const g2 = await ghost(p);
  check("its ghost follows the mouse over the map, and hides over the tray", !!g1?.visible && !g2?.visible, `map ${JSON.stringify(g1)}; tray ${JSON.stringify(g2)}`);

  // 3. A click on the map puts one down there, and it's still carried. (Where it may go: not in a town, say.)
  let g0 = null;
  for (const q of await openPoints(p)) {
    await p.mouse.move(q[0], q[1], { steps: 2 });
    g0 = await ghost(p);
    at[0] = q[0];
    at[1] = q[1];
    if (g0?.visible && !g0.blocked) break;
  }
  const n0 = await pieces(p);
  await p.mouse.click(at[0], at[1]);
  await frames(p);
  const n1 = await pieces(p);
  const placed = await p.evaluate(() => Math.max(...window.woodrail.layout.pieceIds()));
  check("a click on the map puts one down, and it's still carried for the next", n1 === n0 + 1 && (await carried(p)) && (await marked(p, item.key)), `pieces ${n0} → ${n1}; carried ${await carried(p)}; ghost ${JSON.stringify(g0)}; said ${await p.evaluate(() => [...document.querySelectorAll(".toast, .refusal")].map((t) => t.textContent).join(" | "))}`);

  // 4. At a free end, the ghost snaps to it, and a click there puts the next one down joined. (The piece just put
  // down's, or, if both of its run into something, a house or a hill, another's put down in the open.)
  const lastStraight = () => p.evaluate(() => { const w = window.woodrail; return Math.max(...[...w.layout.pieceIds()].filter((id) => w.layout.getPiece(id).type === "straight-144")); });
  const endsOf = (id) =>
    p.evaluate(async (id) => {
      const w = window.woodrail;
      const { connectorRef } = await import("/src/track/layout.ts");
      const c = { x: 0, y: 0, z: 0, heading: 0 };
      const r = w.canvas.getBoundingClientRect();
      const out = [];
      for (let i = 0; i < 2; i++) {
        if (w.layout.joinedConnector(connectorRef(id, i)) !== -1) continue;
        w.layout.worldConnector(connectorRef(id, i), c);
        const v = new w.camera.position.constructor(c.x + Math.cos(c.heading) * 80, c.y, c.z + Math.sin(c.heading) * 80).project(w.camera);
        const s = [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
        if (document.elementFromPoint(s[0], s[1]) === w.canvas) out.push(s);
      }
      return out;
    }, id);
  let end = null;
  let g3 = null;
  let from = placed;
  const spots = await openPoints(p, [at]);
  for (let k = 0; k <= 6 && !end; k++) {
    if (k > 0) {
      const q = spots[k - 1];
      if (!q) break;
      await p.mouse.move(q[0], q[1], { steps: 2 });
      const g = await ghost(p);
      if (!g?.visible || g.blocked) continue;
      await p.mouse.click(q[0], q[1]);
      await frames(p);
      from = await lastStraight();
    }
    for (const e of await endsOf(from)) {
      await p.mouse.move(e[0], e[1], { steps: 4 });
      g3 = await ghost(p);
      if (g3?.snap === "snapped" && !g3.blocked) {
        end = e;
        break;
      }
    }
  }
  const m1 = await pieces(p);
  if (end) await p.mouse.click(end[0], end[1]);
  await frames(p);
  const n2 = await pieces(p);
  const joined = await p.evaluate(async (id) => {
    const w = window.woodrail;
    const { connectorRef } = await import("/src/track/layout.ts");
    return [0, 1].some((i) => w.layout.joinedConnector(connectorRef(id, i)) !== -1);
  }, from);
  check("at a free end the ghost snaps, and a click puts the next one down joined to it", !!end && n2 === m1 + 1 && joined, `ghost ${JSON.stringify(g3)}; medium straights ${m1} → ${n2}; joined ${joined}`);

  // 5. A drag on the map pans (nothing put down); the wheel zooms; still carried.
  const free = await openGround(p, [end]);
  const v0 = await view(p);
  await p.mouse.move(free[0], free[1]);
  await p.mouse.down();
  await p.mouse.move(free[0] - 150, free[1] - 40, { steps: 10 });
  await p.mouse.up();
  await frames(p);
  const v1 = await view(p);
  const n3 = await pieces(p);
  check("a drag on the map still pans, putting nothing down", (v1.x !== v0.x || v1.z !== v0.z) && n3 === n2 && (await carried(p)), `view ${v0.x},${v0.z} → ${v1.x},${v1.z}; pieces ${n2} → ${n3}`);
  await p.mouse.wheel(0, 240);
  // (The zoom eases in: till the distance stops changing.)
  await p.evaluate(() => new Promise((r) => { const w = window.woodrail; let last = -1, same = 0; const t = () => { const d = Math.round(w.camera.position.distanceTo(w.controls.target)); same = d === last ? same + 1 : 0; last = d; if (same > 10) r(); else requestAnimationFrame(t); }; requestAnimationFrame(t); }));
  const v2 = await view(p);
  check("the wheel still zooms, still carried", v2.d !== v1.d && (await carried(p)), `distance ${v1.d} → ${v2.d}`);

  // 6. R turns it (as the tray's Turn does).
  const spot = await openGround(p);
  await p.mouse.move(spot[0], spot[1], { steps: 3 });
  const h0 = await p.evaluate(() => window.woodrail.interaction.preview?.heading);
  await p.keyboard.press("r");
  const h1 = await p.evaluate(() => window.woodrail.interaction.preview?.heading);
  check("R turns the carried piece an eighth", typeof h0 === "number" && typeof h1 === "number" && Math.abs(Math.abs(h1 - h0) - Math.PI / 4) < 1e-6 && (await ghost(p))?.visible, `heading ${h0?.toFixed?.(3)} → ${h1?.toFixed?.(3)}`);

  // 7. Put away: a right-click on the map; Esc; the tray item clicked again; Draw.
  await p.mouse.click(spot[0], spot[1], { button: "right" });
  await frames(p);
  check("a right-click puts it away (unmarked, no ghost)", !(await carried(p)) && !(await marked(p, item.key)) && !(await ghost(p))?.visible, `carried ${await carried(p)}; ghost ${JSON.stringify(await ghost(p))}`);
  await p.mouse.click(item.x, item.y);
  await p.keyboard.press("Escape");
  check("Esc puts it away", !(await carried(p)) && !(await marked(p, item.key)));
  await p.mouse.click(item.x, item.y);
  const again = await carried(p);
  await p.mouse.click(item.x, item.y);
  check("clicking it in the tray again puts it away", again && !(await carried(p)) && !(await marked(p, item.key)));
  await p.mouse.click(item.x, item.y);
  await p.evaluate(() => window.woodrail.interaction.setDrawing(true));
  check("Draw puts it away", !(await carried(p)));
  await p.evaluate(() => window.woodrail.interaction.setDrawing(false));

  // 8. A drag out of the tray still works as before.
  const d0 = await pieces(p);
  const drop = await openGround(p);
  await p.mouse.move(item.x, item.y);
  await p.mouse.down();
  await p.mouse.move(item.x, item.y - 60, { steps: 4 });
  await p.mouse.move(drop[0], drop[1], { steps: 12 });
  await p.mouse.up();
  await frames(p);
  await frames(p);
  check("a drag out of the tray still puts one down", (await pieces(p)) === d0 + 1, `medium straights ${d0} → ${await pieces(p)}`);
  await p.keyboard.press("Escape");

  // 9. Cost: a mouse move while carrying (the held piece's own path), timed in the page.
  await p.mouse.click(item.x, item.y);
  const ms = await p.evaluate(([x, y]) => {
    const i = window.woodrail.interaction;
    const t0 = performance.now();
    for (let k = 0; k < 60; k++) i.showPreview(x + (k % 12) * 9, y + Math.floor(k / 12) * 7);
    return (performance.now() - t0) / 60;
  }, spot);
  check("a mouse move while carrying costs a few ms at most", ms < 8, `${ms.toFixed(2)} ms a move (headless, software GL)`);
  await p.keyboard.press("Escape");
  await ctx.close();
}

// ---- touch: a tap in the tray carries nothing (as before) ----
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await sandbox(ctx);
  const item = await firstItem(p);
  await p.touchscreen.tap(item.x, item.y);
  await frames(p);
  check("on touch, a tap on a tray piece doesn't carry it", !(await carried(p)) && !(await marked(p, item.key)));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
