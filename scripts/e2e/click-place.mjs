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

// ---- fullscreen, and a sideways wheel never goes Back a page ----
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await sandbox(ctx);
  await p.waitForFunction(() => window.woodrail.settled?.() ?? true, null, { timeout: 60000 }).catch(() => {});
  const fs = () => p.evaluate(() => {
    const btn = document.querySelector(".actions .fullscreen-btn");
    const r = btn?.getBoundingClientRect();
    return { on: document.fullscreenElement === document.documentElement, shown: !!btn && !btn.hidden && getComputedStyle(btn).display !== "none", title: btn?.getAttribute("aria-label") ?? "", w: r?.width ?? 0, h: r?.height ?? 0 };
  });
  const before = await fs();
  check("the Fullscreen button shows in the top bar (Chromium allows fullscreen), 44 px or more", before.shown && !before.on && before.w >= 44 && before.h >= 44, JSON.stringify(before));
  await p.click(".actions .fullscreen-btn");
  await p.waitForFunction(() => document.fullscreenElement === document.documentElement, null, { timeout: 10000 }).catch(() => {});
  await frames(p);
  const inFs = await fs();
  check("tapped, it puts the page fullscreen and its icon becomes Leave fullscreen", inFs.on && inFs.title === "Leave fullscreen", JSON.stringify(inFs));
  // The canvas follows its box (the ResizeObserver), and the game goes still again: no frame drawn on and on.
  const sized = await p.evaluate(() => { const c = window.woodrail.canvas; return Math.abs(c.width / devicePixelRatio - c.clientWidth) <= 2 && Math.abs(c.height / devicePixelRatio - c.clientHeight) <= 2; });
  check("in fullscreen the canvas is drawn at its box's size", sized);
  await p.click(".actions .fullscreen-btn");
  await p.waitForFunction(() => !document.fullscreenElement, null, { timeout: 10000 }).catch(() => {});
  await frames(p);
  const out = await fs();
  check("tapped again, it leaves fullscreen and its icon is Fullscreen again", !out.on && out.title === "Fullscreen", JSON.stringify(out));
  await new Promise((r) => setTimeout(r, 1500));
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await new Promise((r) => setTimeout(r, 3000));
  const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
  check("after fullscreen and back, a still game draws no more frames", f1 - f0 <= 1, `${f1 - f0} frames in 3 s`);

  // A sideways wheel (a trackpad swipe) on the canvas is cancelled: the browser takes no Back from it.
  const wheel = (sel, dx, dy) => p.evaluate(([sel, dx, dy]) => {
    const t = sel === "canvas" ? window.woodrail.canvas : document.querySelector(sel);
    const r = t.getBoundingClientRect();
    const e = new WheelEvent("wheel", { deltaX: dx, deltaY: dy, bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 });
    t.dispatchEvent(e);
    return e.defaultPrevented;
  }, [sel, dx, dy]);
  check("a horizontal wheel on the canvas has defaultPrevented", await wheel("canvas", 120, 0));
  check("a horizontal wheel on the top bar has defaultPrevented", await wheel(".topbar", -120, 4));
  // A real one, sent as the mouse does: the view doesn't move and the page stays.
  const url = p.url();
  const v0 = await view(p);
  const box = await p.evaluate(() => ({ x: innerWidth / 2, y: innerHeight / 2 }));
  await p.mouse.move(box.x, box.y);
  for (let i = 0; i < 5; i++) await p.mouse.wheel(-200, 0);
  await frames(p);
  const v1 = await view(p);
  check("a real sideways wheel on the map neither zooms the view nor leaves the page", p.url() === url && v0.d === v1.d, `${JSON.stringify(v0)} → ${JSON.stringify(v1)}`);
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
  // A sideways wheel on the tray is cancelled (no Back a page) and scrolls the tray by hand instead.
  const tray = await p.evaluate(() => {
    const s = document.querySelector(".tray .scroller");
    s.scrollLeft = 0;
    const t = s.querySelector(".tray-item");
    const e = new WheelEvent("wheel", { deltaX: 120, deltaY: 0, bubbles: true, cancelable: true });
    t.dispatchEvent(e);
    return { prevented: e.defaultPrevented, left: s.scrollLeft, room: s.scrollWidth - s.clientWidth, overscroll: getComputedStyle(s).overscrollBehaviorX, page: getComputedStyle(document.documentElement).overscrollBehaviorX };
  });
  check("a horizontal wheel on the tray has defaultPrevented and scrolls the tray sideways", tray.prevented && (tray.room <= 0 || tray.left > 0), JSON.stringify(tray));
  // On a phone the bar is full: Fullscreen is in the menu (Chromium on Android allows it), and does its job there.
  await p.tap(".actions .chip[aria-label='Menu']");
  await frames(p);
  const menuFs = await p.evaluate(() => {
    const it = [...document.querySelectorAll(".menu .menu-item")].find((b) => b.textContent === "Fullscreen");
    const bar = document.querySelector(".actions .fullscreen-btn");
    return { item: !!it && getComputedStyle(it).display !== "none" && it.offsetHeight >= 44, bar: !!bar && getComputedStyle(bar).display !== "none" };
  });
  check("on a phone, Fullscreen is a menu item (44 px tall), not in the full top bar", menuFs.item && !menuFs.bar, JSON.stringify(menuFs));
  await p.locator(".menu .menu-item", { hasText: /^Fullscreen$/ }).tap();
  // (fullscreenchange comes with the next rendering update, a moment after fullscreenElement is set.)
  await p.waitForFunction(() => !!document.fullscreenElement && [...document.querySelectorAll(".menu .menu-item")].some((b) => b.textContent === "Leave fullscreen"), null, { timeout: 10000 }).catch(() => {});
  const phoneFs = await p.evaluate(() => ({ on: !!document.fullscreenElement, menuHidden: document.querySelector(".menu").hidden, label: [...document.querySelectorAll(".menu .menu-item")].some((b) => b.textContent === "Leave fullscreen") }));
  check("…tapped, it puts the page fullscreen, closes the menu, and then reads Leave fullscreen", phoneFs.on && phoneFs.menuHidden && phoneFs.label, JSON.stringify(phoneFs));
  check("the page and the tray never overscroll into a Back", tray.overscroll === "none" && tray.page === "none", JSON.stringify(tray));
  await ctx.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
