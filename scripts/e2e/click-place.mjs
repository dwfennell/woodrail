// End-to-end click-to-place on a desktop (`npm run e2e:click`): a tray piece (a model, a train) clicked with the mouse is carried, its
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
/** A key held as a finger presses it (about a quarter of a second): long enough for a held key to act on the view. */
const press = async (p, key) => {
  await p.keyboard.down(key);
  await new Promise((r) => setTimeout(r, 250));
  await p.keyboard.up(key);
  await frames(p);
};
/** The view's tilt (radians from straight down). */
const tilt = (p) => p.evaluate(() => { const w = window.woodrail; const d = w.camera.position.clone().sub(w.controls.target); return Math.acos(d.y / d.length()); });
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
  const look = await p.evaluate((key) => ({ placing: document.querySelector(`.scroller .tray-item[data-key="${key}"]`)?.classList.contains("carried"), cursor: window.woodrail.canvas.style.cursor }), item.key);
  check("carried is marked apart from ready in the tray (“placing”), and the cursor over the map says so", look.placing && look.cursor === "copy", JSON.stringify(look));

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
  const goal = () => p.evaluate(() => { const m = window.woodrail.interaction.preview; return m ? [Math.round(m.goal.x), Math.round(m.goal.z)] : null; });
  const w0 = await goal();
  await p.mouse.wheel(0, 240);
  // (The zoom eases in: till the distance stops changing.)
  await p.evaluate(() => new Promise((r) => { const w = window.woodrail; let last = -1, same = 0; const t = () => { const d = Math.round(w.camera.position.distanceTo(w.controls.target)); same = d === last ? same + 1 : 0; last = d; if (same > 10) r(); else requestAnimationFrame(t); }; requestAnimationFrame(t); }));
  const v2 = await view(p);
  check("the wheel still zooms, still carried", v2.d !== v1.d && (await carried(p)), `distance ${v1.d} → ${v2.d}`);
  // (The wheel zooms toward the mouse, keeping the ground under it: the ghost rightly stays. A glide moves the view
  // under a still mouse: the ghost follows, under the mouse.)
  const w1 = await goal();
  await p.evaluate(() => { const w = window.woodrail; const t = w.controls.target; w.director.glideTo(t.clone().setX(t.x + 400), w.camera.position.distanceTo(t), { duration: 0.2 }); });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await frames(p);
  const w2 = await goal();
  check("the ghost stays under the mouse as the view moves: the wheel (toward the mouse) or a glide (QA)", !!w0 && !!w1 && !!w2 && Math.hypot(w1[0] - w0[0], w1[1] - w0[1]) < 40 && Math.hypot(w2[0] - w1[0], w2[1] - w1[1]) > 200 && (await ghost(p))?.visible, `ghost at ${w0} → wheel ${w1} → glide ${w2}`);
  // Undo keeps it carried (what was put down goes).
  const u0 = await pieces(p);
  await p.keyboard.press("Control+z");
  await frames(p);
  check("Ctrl+Z undoes the last one put down, and it's still carried", (await pieces(p)) === u0 - 1 && (await carried(p)), `medium straights ${u0} → ${await pieces(p)}`);

  // 6. R turns it (as the tray's Turn does).
  const spot = await openGround(p);
  await p.mouse.move(spot[0], spot[1], { steps: 3 });
  const h0 = await p.evaluate(() => window.woodrail.interaction.preview?.heading);
  const a0 = await tilt(p);
  await press(p, "r");
  const h1 = await p.evaluate(() => window.woodrail.interaction.preview?.heading);
  const a1 = await tilt(p);
  check("R (a quarter-second press) turns the carried piece an eighth, and doesn't tilt the view (QA)", typeof h0 === "number" && typeof h1 === "number" && Math.abs(Math.abs(h1 - h0) - Math.PI / 4) < 1e-6 && Math.abs(a1 - a0) < 1e-4 && (await ghost(p))?.visible, `heading ${h0?.toFixed?.(3)} → ${h1?.toFixed?.(3)}; tilt ${a0.toFixed(4)} → ${a1.toFixed(4)}`);
  // (F the other way: R tilts up, and the view may be at its top; a straight doesn't mirror, but F is the carried piece's.)
  await press(p, "f");
  const a2 = await tilt(p);
  check("F (a quarter-second press) doesn't tilt the view while carrying either", Math.abs(a2 - a1) < 1e-4 && (await carried(p)), `tilt ${a1.toFixed(4)} → ${a2.toFixed(4)}`);

  // 7. Put away: a right-click on the map; Esc; the tray item clicked again; Draw.
  await p.mouse.click(spot[0], spot[1], { button: "right" });
  await frames(p);
  check("a right-click puts it away (unmarked, no ghost, the cursor back)", !(await carried(p)) && !(await marked(p, item.key)) && !(await ghost(p))?.visible && (await p.evaluate(() => window.woodrail.canvas.style.cursor)) === "", `carried ${await carried(p)}; ghost ${JSON.stringify(await ghost(p))}`);
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

// ---- a model and a train, carried as a piece is ----
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await sandbox(ctx);
  const thing = () => p.evaluate(() => { const c = window.woodrail.interaction.carriedThing; return c ? { kind: c.m.kind, visible: c.m.ghost.visible, blocked: c.m.blocked ?? null, target: c.m.target === undefined ? undefined : !!c.m.target, heading: c.m.heading } : null; });
  /** Click a tray tab by its label (a real click: tabs and shelves open on a pointer press). */
  const tab = async (label) => {
    await p.evaluate((label) => [...document.querySelectorAll(".tray .tabs .tab")].find((b) => b.textContent.trim() === label).click(), label);
    await frames(p);
  };
  /** The first tray item whose key starts so, opening a shelf for it if need be. */
  const itemOf = async (prefix) => {
    const find = () => p.evaluate((prefix) => { const e = document.querySelector(`.scroller .tray-item[data-key^="${prefix}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, key: e.dataset.key }; }, prefix);
    const press = async (sel, k = 0) => {
      const r = await p.evaluate(([sel, k]) => { const e = document.querySelectorAll(sel)[k]; if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, [sel, k]);
      if (r) await p.mouse.click(r[0], r[1]);
      await frames(p);
      return !!r;
    };
    // Among the favourites, else on each shelf in turn (Back between them).
    for (let k = 0; k < 12; k++) {
      const r = await find();
      if (r) return r;
      if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) await press(".scroller .tray-back");
      if (!(await press(".scroller .tray-group", k))) return null;
    }
    return null;
  };

  // A model: from the first models tab.
  const propTab = await p.evaluate(() => [...document.querySelectorAll(".tray .tabs button, .tray .tabs .tab")].map((t) => t.textContent.trim()).find((l) => !["Track", "Trains", "Roads", "Land", "Industries"].includes(l)));
  await tab(propTab);
  const model = await itemOf("prop:");
  await p.mouse.click(model.x, model.y);
  check("a click on a model in the tray carries it (marked)", (await thing())?.kind === "drag-prop" && (await marked(p, model.key)), `${propTab}: ${model.key}`);
  const props = () => p.evaluate(() => [...window.woodrail.props.all()].length);
  let spot = null;
  for (const q of await openPoints(p)) {
    await p.mouse.move(q[0], q[1], { steps: 2 });
    const t = await thing();
    if (t?.visible && !t.blocked) {
      spot = q;
      break;
    }
  }
  const p0 = await props();
  await p.mouse.click(spot[0], spot[1]);
  await frames(p);
  check("its ghost follows the mouse, and a click puts one down, still carried (no card opened)", (await props()) === p0 + 1 && (await thing())?.kind === "drag-prop" && (await p.evaluate(() => [...document.querySelectorAll(".card")].every((c) => c.hidden))), `models ${p0} → ${await props()}`);
  const t0 = (await thing())?.heading;
  const b0 = await tilt(p);
  await press(p, "r");
  const t1 = (await thing())?.heading;
  const b1 = await tilt(p);
  check("R (a quarter-second press) turns the carried model, and doesn't tilt the view", typeof t0 === "number" && Math.abs(Math.abs(t1 - t0) - Math.PI / 4) < 1e-6 && Math.abs(b1 - b0) < 1e-4, `${t0?.toFixed?.(3)} → ${t1?.toFixed?.(3)}; tilt ${b0.toFixed(4)} → ${b1.toFixed(4)}`);
  await p.keyboard.press("Escape");
  check("Esc puts it away (its ghost gone)", !(await thing()) && !(await marked(p, model.key)) && (await p.evaluate(() => !window.woodrail.interaction.propOutline.line.visible)));

  // A train (an engine: a whole train may not fit a station's track): from the Trains tab, onto a station's track.
  await tab("Trains");
  const train = await itemOf("train:Engine");
  await p.mouse.click(train.x, train.y);
  check("a click on a train in the tray carries it", (await thing())?.kind === "drag-train" && (await marked(p, train.key)), train.key);
  const onTrack = await p.evaluate(() => {
    const w = window.woodrail;
    const id = [...w.stations.values()][0];
    const q = w.layout.getPiece(id);
    const v = new w.camera.position.constructor(q.pose.x, q.y + 10, q.pose.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  });
  await p.mouse.move(onTrack[0], onTrack[1], { steps: 4 });
  const g = await thing();
  const trains = () => p.evaluate(() => [...window.woodrail.sim.trainIds()].length);
  const n0 = await trains();
  await p.mouse.click(onTrack[0], onTrack[1]);
  await frames(p);
  const n1 = await trains();
  check("over track its ghost sits on it, and a click puts the train down there, still carried", g?.visible && g.target === true && n1 === n0 + 1 && (await thing())?.kind === "drag-train", `ghost ${JSON.stringify(g)}; trains ${n0} → ${n1}; said ${await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "))}`);
  await p.mouse.click(onTrack[0], onTrack[1], { button: "right" });
  check("a right-click puts it away", !(await thing()) && !(await marked(p, train.key)));
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

// ---- desktop: a route planned by clicks; Ctrl+Z undoes a stop while planning; a stop's mode; Leave asks; Ctrl+Z ----
// (The route card's UX fixes, docs/design/2026-11-02-route-ux F1–F3, with a mouse. Setup only, not what's tested: an
// oval of track with a forest and a sawmill on it, and a train, put down in code past the land's edge on the flat
// table, where the view can go.)
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await sandbox(ctx);
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    const { Layout } = await import("/src/track/index.ts");
    const S = await import("/src/routing/scenarios.ts");
    const scratch = new Layout();
    const o = S.oval(scratch);
    const xs = o.ids.map((i) => scratch.getPiece(i).pose.x);
    const zs = o.ids.map((i) => scratch.getPiece(i).pose.z);
    const b = w.director.bounds;
    // (The first spot, from the bounds' edge inward, with no piece within 1.6 m and no model within 1 m.)
    let g = null;
    for (let x = b.x1 - 1600; !g && x > b.x0 + 1600; x -= 200)
      for (let z = b.z0 + 1600; !g && z < b.z1 - 1600; z += 200) {
        const free = [...w.layout.pieceIds()].every((i) => { const q = w.layout.getPiece(i).pose; return Math.hypot(q.x - x, q.z - z) > 1600; }) && [...w.props.all()].every((q) => Math.hypot(q.x - x, q.z - z) > 1000);
        if (free) g = { x: x - (Math.min(...xs) + Math.max(...xs)) / 2, z: z - (Math.min(...zs) + Math.max(...zs)) / 2 };
      }
    if (!g) throw new Error("no room for the oval");
    const types = { 0: "depot-forest", 7: "depot-sawmill" };
    const placed = w.editor().placeRun(o.ids.map((i, k) => {
      const q = scratch.getPiece(i);
      return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
    }));
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const places = [depot(placed[0], "forest").id, depot(placed[7], "sawmill").id];
    const r = w.sim.addTrain(["engine", "timber"], { pieceId: placed[2], pathIndex: 0, s: 150, reversed: false });
    if (r.kind !== "placed") throw new Error("no room for a train");
    const engine = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(engine, 0);
    w.director.glideTo(new w.controls.target.constructor(g.x + (Math.min(...xs) + Math.max(...xs)) / 2, 0, g.z + (Math.min(...zs) + Math.max(...zs)) / 2), 2600, { duration: 0.2 });
    w.invalidate();
    return { engine, places, pieces: [placed[0], placed[7]] };
  });
  const still = async () => {
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
    await frames(p);
  };
  await still();
  const at = (what) => p.evaluate((what) => {
    const w = window.woodrail;
    const V = w.camera.position.constructor;
    let v;
    if (what.engine !== undefined) {
      const t = w.sim.findCar(what.engine).train;
      v = new V((t.world[0].x + t.world[1].x) / 2, t.world[0].y, (t.world[0].z + t.world[1].z) / 2);
    } else {
      const q = w.layout.getPiece(what.piece);
      v = new V(q.pose.x + Math.cos(q.pose.heading) * 108, q.y, q.pose.z + Math.sin(q.pose.heading) * 108);
    }
    const c = v.project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, what);
  const clickOn = async (what) => {
    const [x, y] = await at(what);
    await p.mouse.click(x, y);
    await frames(p);
  };
  const clickButton = async (sel) => {
    await p.waitForFunction((sel) => { const e = document.querySelector(sel); return !!e && e.offsetParent !== null; }, sel, { timeout: 30000 });
    await frames(p);
    await p.waitForTimeout(250);
    const [x, y] = await p.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel);
    await p.mouse.click(x, y);
    await frames(p);
  };
  const route = () => p.evaluate((e) => {
    const w = window.woodrail;
    const r = w.economy.routeOf(e);
    return { stops: r?.stops.map((s) => ({ d: s.depotId, a: s.action, via: s.via ?? [] })) ?? [], next: r?.next ?? -1, lines: w.economy.lines.size };
  }, setup.engine);
  await clickOn({ engine: setup.engine });
  await clickButton(".engine-extra .route-plan");
  await clickOn({ piece: setup.pieces[0] });
  const one = await route();
  await still();
  await clickOn({ piece: setup.pieces[1] });
  const two = await route();
  check("desktop: a route planned by clicks (the engine, Plan a route, the forest, the sawmill)", one.stops.length === 1 && two.stops.length === 2 && two.stops[1].d === setup.places[1], JSON.stringify({ one, two }));
  await p.keyboard.press("Control+z");
  await frames(p);
  const undone = await route();
  check("desktop (F1): Ctrl+Z while planning takes the stop just added off, the train heading where it did", JSON.stringify(undone) === JSON.stringify(one) && (await p.evaluate(() => document.querySelector(".engine-extra .route-plan.on") !== null)), JSON.stringify({ undone, one }));
  await still();
  await clickOn({ piece: setup.pieces[1] });
  await clickButton(".engine-extra .route-plan.on");
  await clickButton('.engine-extra .route-chip[data-stop="1"]');
  const opts = await p.evaluate(() => ({ modes: [...document.querySelectorAll(".engine-extra .route-mode")].map((b) => b.textContent), pass: !!document.querySelector(".engine-extra .route-pass") }));
  await clickButton('.engine-extra .route-mode[data-mode="drop"]');
  const dropped = await route();
  check("desktop (F2): the stop's three modes, Only drop clicked; no Pass by with two stops", opts.modes.length === 3 && !opts.pass && dropped.stops.length === 2 && dropped.stops[1].a === "drop", JSON.stringify({ opts, dropped }));
  await clickButton(".engine-extra .route-leave");
  const asked = await route();
  const text = await p.evaluate(() => document.querySelector(".engine-extra .route-leave")?.textContent);
  await clickButton(".engine-extra .route-leave.asking");
  const gone = await route();
  check("desktop (F3): Leave asks first (\"Forget …?\"), the second click forgets the line", asked.lines === 1 && /^Forget/.test(text ?? "") && gone.lines === 0 && gone.stops.length === 0, JSON.stringify({ asked, text, gone }));
  await p.keyboard.press("Control+z");
  await frames(p);
  const back = await route();
  check("desktop (F1): Ctrl+Z brings the line back, Only drop and all", back.lines === 1 && back.stops.length === 2 && back.stops[1].a === "drop", JSON.stringify(back));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
