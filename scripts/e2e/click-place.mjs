// End-to-end click-to-place on a desktop (`npm run e2e:click`): a tray piece (a model, a train) clicked with the mouse is carried, its
// ghost following the mouse over the map; each click puts one down there (joined to a track end it's shown at), ready
// for the next; a drag still pans, the wheel still zooms; R turns it; Esc, a right-click or the tray item again put it
// away. On touch a tap in the tray carries nothing (as before). The place card (#12): while an item is ready to place
// its card (name, what it does, a train's pulls and speed) sits above the tray taking no pointer, and goes once one is
// put down or it's put away; Game mode's Engine, and a locked engine's lock note in its place; on touch a tap shows it a moment, a road made ready
// keeps it, and a long press shows the details without a drag. Starts its own dev server on any free port. Chromium as
// for e2e:roads.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { FEEDBACK_URL, feedbackFlow } from "./feedback-flow.mjs";

// "Report a bug or give feedback" sends here (Playwright answers for it: see feedback-flow.mjs).
process.env.VITE_FEEDBACK_URL = FEEDBACK_URL;
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
/**
 * The place card (#12): shown, its name, all its lines, and where it sits: above the tray and its tools, taking no
 * pointer (the map under its middle is what a click there hits). Null if it isn't up.
 */
function readCard() {
    const c = document.querySelector(".place-card");
    if (!c || c.hidden || getComputedStyle(c).display === "none") return null;
    const r = c.getBoundingClientRect();
    const tray = Math.min(...[document.querySelector(".tray"), ...document.querySelectorAll(".tray-tools > *")].map((e) => e.getBoundingClientRect()).filter((b) => b.height > 0).map((b) => b.top));
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { name: c.querySelector(".pc-name")?.textContent ?? null, text: [...c.children].map((x) => x.textContent), pointer: getComputedStyle(c).pointerEvents, above: r.bottom <= tray + 1, onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0, hitsMap: hit?.tagName === "CANVAS" };
}
const placeCard = (p) => p.evaluate(readCard);
/**
 * Catch the next place card the moment it shows (a card shown for a moment can be gone before a poll under load):
 * `await catchCard(p)` before the tap, then `await caught(p)` after it.
 */
const catchCard = (p) =>
  p.evaluate((src) => {
    const read = new Function(`return (${src})()`);
    window.__caught = null;
    const obs = new MutationObserver(() => {
      const c = document.querySelector(".place-card");
      if (c && !c.hidden && !window.__caught) {
        window.__caught = read();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
  }, readCard.toString());
const caught = async (p) => {
  await p.waitForFunction(() => window.__caught !== null, null, { timeout: 10000 }).catch(() => {});
  return p.evaluate(() => window.__caught);
};
/** Wait (a few seconds at most) for the place card to be up. */
/** The card's place and lines are right for a ready item named `name`. */
const cardOk = (c, name) => !!c && c.name === name && c.text.length >= 2 && c.pointer === "none" && c.above && c.onScreen && c.hitsMap;
const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/**
 * Wait (60 s at most) for the page to go quiet: the game settled and no long task on the main thread for 1.5 s. Just
 * after Sandbox opens, the tray's pictures are made in stalls of up to a few seconds (software GL): a touch's down and
 * up handled either side of one is a long press by the clock, not a tap. A player's tap then is the same; the check is
 * of the tap, so it waits for the page to be still first.
 */
const quiet = (p) =>
  p.evaluate(async () => {
    await Promise.race([window.woodrail.settled?.(), new Promise((r) => setTimeout(r, 30000))]);
    await new Promise((res) => {
      let last = performance.now();
      const obs = new PerformanceObserver((l) => {
        if (l.getEntries().length) last = performance.now();
      });
      obs.observe({ type: "longtask" });
      const t0 = performance.now();
      const look = () => {
        if (performance.now() - last >= 1500 || performance.now() - t0 > 30000) {
          obs.disconnect();
          res();
        } else setTimeout(look, 250);
      };
      setTimeout(look, 250);
    });
  });

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
  const card1 = await placeCard(p);
  check("…and its card shows above the tray: its name and what it's for, never taking a click (#12)", cardOk(card1, "Medium straight"), JSON.stringify(card1));
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
  check("…and its card has gone (it's said its piece)", n1 === n0 + 1 && (await placeCard(p)) === null, JSON.stringify(await placeCard(p)));

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
  // Which way it faces: the way the mouse came along the track. The station's track's way on screen (unit, px), and
  // the newest train's engine: the way it faces on screen, and as world headings the ghost's and the train's.
  const along = await p.evaluate(() => {
    const w = window.woodrail;
    const q = w.layout.getPiece([...w.stations.values()][0]);
    const V = w.camera.position.constructor;
    const a = new V(q.pose.x, q.y, q.pose.z).project(w.camera);
    const b = new V(q.pose.x + 30 * Math.cos(q.pose.heading), q.y, q.pose.z + 30 * Math.sin(q.pose.heading)).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    const dx = ((b.x - a.x) * r.width) / 2;
    const dy = (-(b.y - a.y) * r.height) / 2;
    const l = Math.hypot(dx, dy);
    return [dx / l, dy / l];
  });
  const engineWay = () =>
    p.evaluate(async () => {
      const w = window.woodrail;
      const { cursorWorld, createWorldSample } = await import("/src/sim/index.ts");
      const t = w.sim.getTrain(Math.max(...w.sim.trainIds()));
      const e = t.cars.find((c) => c.kind === "engine");
      const a = cursorWorld(w.layout, t.bogies[0], createWorldSample());
      const b = cursorWorld(w.layout, t.bogies[t.bogies.length - 1], createWorldSample());
      const V = w.camera.position.constructor;
      const pa = new V(a.x, a.y, a.z).project(w.camera);
      const pb = new V(b.x, b.y, b.z).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      const dx = ((pa.x - pb.x) * r.width) / 2;
      const dy = (-(pa.y - pb.y) * r.height) / 2;
      const l = Math.hypot(dx, dy);
      return { id: t.id, carId: e.id, facing: e.facing, x: (dx / l) * e.facing, y: (dy / l) * e.facing, lead: a.heading };
    });
  const ghostWay = () => p.evaluate(() => { const c = window.woodrail.interaction.carriedThing; return c ? { lead: -c.m.ghost.rotation.y, target: !!c.m.target, said: c.m.facing !== null } : null; });
  const turn = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  // (Taken off between the drags: harness shortcut, setup only. A train put down has no undo of its own.)
  const takeOff = () => p.evaluate(() => { const w = window.woodrail; w.sim.removeTrain(Math.max(...w.sim.trainIds())); w.economy.prune(); w.invalidate(); });
  await takeOff();
  for (const [name, dir] of [["right", 1], ["left", -1]]) {
    // (Along the track's way on screen, `dir`: "right" is whichever way the station's track runs, drawn first.)
    const from = [onTrack[0] - dir * 110 * along[0], onTrack[1] - dir * 110 * along[1]];
    await p.mouse.move(from[0], from[1], { steps: 3 });
    await p.mouse.move(onTrack[0], onTrack[1], { steps: 10 });
    const gw = await ghostWay();
    await p.mouse.click(onTrack[0], onTrack[1]);
    await frames(p);
    const e = await engineWay();
    const dot = e.x * dir * along[0] + e.y * dir * along[1];
    check(`moved ${name} along the track, the train put down faces that way, as its ghost did`, gw?.target && gw.said && dot > 0.9 && turn(gw.lead, e.lead) < 0.1, JSON.stringify({ along, gw, e, dot }));
    // (The first taken up again; the second, facing left, stays for the pickup below.)
    if (dir === 1) await takeOff();
  }
  // The one put down facing left, picked up and dragged right along the track: re-placed facing right.
  const e0 = await engineWay();
  const dot0 = e0.x * along[0] + e0.y * along[1];
  await p.mouse.click(onTrack[0], onTrack[1], { button: "right" });
  check("a right-click puts it away", !(await thing()) && !(await marked(p, train.key)));
  // (The train put down last: where it is on screen.)
  const engineAt = () =>
    p.evaluate(async (id) => {
      const w = window.woodrail;
      const { cursorWorld, createWorldSample } = await import("/src/sim/index.ts");
      const t = w.sim.findCar(id).train;
      const a = cursorWorld(w.layout, t.bogies[0], createWorldSample());
      const b = cursorWorld(w.layout, t.bogies[t.bogies.length - 1], createWorldSample());
      const v = new w.camera.position.constructor((a.x + b.x) / 2, (a.y + b.y) / 2 + 20, (a.z + b.z) / 2).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    }, e0.carId);
  /** Pick the train up (selected by a click first) and drag it `dir` along the track by `px`, letting go there. */
  const pickUpAndDrag = async (dir, px) => {
    const at = await engineAt();
    await p.mouse.click(at[0], at[1]);
    await frames(p);
    await p.mouse.move(at[0], at[1]);
    await p.mouse.down();
    await new Promise((r) => setTimeout(r, 450));
    const steps = 14;
    let lifted = null;
    for (let k = 1; k <= steps; k++) {
      await p.mouse.move(at[0] + (dir * px * along[0] * k) / steps, at[1] + (dir * px * along[1] * k) / steps);
      if (k === 4) lifted = await p.evaluate(() => window.woodrail.interaction.mode.kind);
    }
    await p.mouse.up();
    await frames(p);
    await p.keyboard.press("Escape");
    return lifted;
  };
  const back = -Math.sign(dot0) || -1;
  const lifted = await pickUpAndDrag(back, 60);
  const e1 = await engineWay();
  const dot1 = e1.x * back * along[0] + e1.y * back * along[1];
  check("a train picked up and dragged along the track the other way is put down facing that way", lifted === "drag-train" && dot1 > 0.9, JSON.stringify({ lifted, dot0, back, e1, dot1 }));
  // Swap ends (the engine card) still turns it; picked up again and dragged the way it now faces, it keeps facing it.
  const at1 = await engineAt();
  await p.mouse.click(at1[0], at1[1]);
  await p.waitForFunction(() => !document.querySelector(".engine-card").hidden, null, { timeout: 30000 });
  await p.evaluate(() => [...document.querySelectorAll(".engine-card button")].find((b) => b.textContent.trim() === "Swap ends").click());
  await frames(p);
  await p.keyboard.press("Escape");
  const e2 = await engineWay();
  const dot2 = e2.x * back * along[0] + e2.y * back * along[1];
  check("Swap ends turns the engine put down by the drag", e2.facing === -1 && dot2 < -0.9, JSON.stringify({ e2, dot2 }));
  const lifted2 = await pickUpAndDrag(-back, 60);
  const e3 = await engineWay();
  const dot3 = e3.x * -back * along[0] + e3.y * -back * along[1];
  check("…and picked up again (turned) and dragged the way it faces, it's put down still facing the way it was dragged", lifted2 === "drag-train" && dot3 > 0.9, JSON.stringify({ lifted2, e3, dot3 }));
  // Put away: picked up and let go over the tray, it's back in the box.
  const n2 = await trains();
  const at3 = await engineAt();
  await p.mouse.click(at3[0], at3[1]);
  await frames(p);
  await p.keyboard.press("Escape");
  const trayAt = await p.evaluate(() => { const r = document.querySelector(".tray").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await p.mouse.move(at3[0], at3[1]);
  await p.mouse.down();
  await new Promise((r) => setTimeout(r, 450));
  for (let k = 1; k <= 14; k++) await p.mouse.move(at3[0] + ((trayAt[0] - at3[0]) * k) / 14, at3[1] + ((trayAt[1] - at3[1]) * k) / 14);
  await p.mouse.up();
  await frames(p);
  check("…and put away over the tray, it's back in the box", (await trains()) === n2 - 1, `trains ${n2} → ${await trains()}`);
  await ctx.close();
}

// ---- tight curves with the mouse (the user: the next tight curve waited loose, unjoined, by a station's track) ----
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await sandbox(ctx);
  await p.evaluate(async () => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    w.director.glideTo(w.interaction.groundAt(innerWidth / 2, innerHeight / 2), frameDistance(700, w.camera.fov, w.camera.aspect), { duration: 0.2 });
  });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  // The tight curve: among the favourites, else on the Curve shelf.
  const tight = async () => {
    const find = () => p.evaluate(() => { const e = document.querySelector('.scroller .tray-item[data-key="piece:curve-small"]'); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
    let at = await find();
    if (!at) {
      const shelf = await p.evaluate(() => { const g = [...document.querySelectorAll(".scroller .tray-group")].find((b) => b.querySelector(".label")?.textContent === "Curve"); if (!g) return null; g.scrollIntoView({ inline: "center" }); const q = g.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; });
      if (shelf) await p.mouse.click(shelf[0], shelf[1]);
      await frames(p);
      at = await find();
    }
    if (!at) throw new Error("no tight curve in the tray");
    return at;
  };
  const curves = (before) => p.evaluate((before) => {
    const w = window.woodrail;
    const ids = [...w.layout.pieceIds()].filter((i) => !before.includes(i) && w.layout.getPiece(i).type === "curve-small");
    return { ids, open: ids.flatMap((id) => [0, 1].filter((c) => w.layout.joinedConnector(id * 8 + c) === -1).map((c) => `${id}.${c}`)) };
  }, before);
  const screenOf = (v) => p.evaluate((v) => { const w = window.woodrail; const c = new w.camera.position.constructor(v.x, v.y ?? 0, v.z).project(w.camera); return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight]; }, v);
  /**
   * Open ground for a ring of tight curves (within 260 mm of its first), on screen: no track or model near, and a straight
   * clear there either way round (the game's own placement check). Glided to, and its spot on screen returned.
   */
  const ringSpot = async () => {
    const spot = await p.evaluate(async () => {
      const w = window.woodrail;
      const { checkPlacement } = await import("/src/landscape/clearance.ts");
      const t = w.controls.target;
      const clear = (x, z) => w.landscape.grid.cellAtWorld(x, z) !== -1 && [0, Math.PI / 2].every((h) => checkPlacement(w.landscape, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
      for (let d = 0; d < 6000; d += 72)
        for (let a = 0, n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 72)); a < n; a++) {
          const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
          const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
          if ([...w.layout.pieceIds()].some((i) => { const q = w.layout.getPiece(i).pose; return Math.hypot(q.x - x, q.z - z) < 500; })) continue;
          if (w.props.all().some((q) => Math.hypot(q.x - x, q.z - z) < 450)) continue;
          const pts = [[0, 0]];
          for (const r of [100, 200, 260]) for (let k = 0; k < 16; k++) pts.push([r * Math.cos((k * Math.PI) / 8), r * Math.sin((k * Math.PI) / 8)]);
          if (pts.every(([dx, dz]) => clear(x + dx, z + dz))) return { x, z };
        }
      return null;
    });
    if (!spot) throw new Error("no open ground for a ring of tight curves");
    await p.evaluate((s) => { const w = window.woodrail; w.director.glideTo(w.controls.target.clone().set(s.x, 0, s.z), w.camera.position.distanceTo(w.controls.target), { duration: 0.1 }); }, spot);
    await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
    await frames(p);
    return screenOf(spot);
  };
  const takeUp = (ids) => p.evaluate((ids) => { const w = window.woodrail; for (const id of ids) if (w.layout.getPiece(id)) w.editor().remove(id); w.invalidate(); }, ids);

  // 1. Dragged out with the mouse onto open ground; then the next waits at its free end, seated: seven clicks on it
  // close a ring of eight, every joint joined.
  {
    const item = await tight();
    const before = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
    const drop = await ringSpot();
    await p.mouse.move(item[0], item[1]);
    await p.mouse.down();
    await p.mouse.move(item[0], item[1] - 60, { steps: 4 });
    await p.mouse.move(drop[0], drop[1], { steps: 12 });
    await p.mouse.up();
    await frames(p);
    const waits = [];
    for (let k = 0; k < 7; k++) {
      // (The view on where it waits, as a player pans to it: the ring runs out of view.)
      await p.evaluate(() => { const w = window.woodrail; const a = w.interaction.previewAt; if (a) w.director.glideTo(w.controls.target.clone().set(a.x, 0, a.z), w.camera.position.distanceTo(w.controls.target), { duration: 0.1 }); });
      await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
      await frames(p);
      const g = await p.evaluate(() => {
        const w = window.woodrail;
        const m = w.interaction.preview;
        if (!m || !w.interaction.previewAt) return null;
        const v = w.interaction.previewAt.clone().project(w.camera);
        return { visible: m.ghost.visible, snap: m.snap.kind, blocked: m.blocked ?? null, at: [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight] };
      });
      waits.push(g && { snap: g.snap, blocked: g.blocked });
      if (!g?.visible) break;
      await p.mouse.click(g.at[0], g.at[1]);
      await frames(p);
    }
    const ring = await curves(before);
    check("tight curves: the next waits at the free end seated there (not loose), each time", waits.length === 7 && waits.every((g) => g?.snap === "snapped" && !g.blocked), JSON.stringify(waits));
    check("tight curves: seven clicks on it close a ring of eight, every joint joined", ring.ids.length === 8 && ring.open.length === 0, JSON.stringify(ring));
    await p.keyboard.press("Escape");
    await takeUp(ring.ids);
  }

  // 2. Carried (clicked in the tray), each hand: one clicked down on open ground, then one clicked with the mouse where
  // it would go on that one's free end (its middle there): it joins, turning on round.
  for (const hand of [false, true]) {
    if (hand !== (await p.evaluate(() => window.woodrail.interaction.trayFlipped))) await p.evaluate(() => document.querySelector(".tray-flip").click());
    const item = await tight();
    const before = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
    const drop = await ringSpot();
    await p.mouse.click(item[0], item[1]);
    await p.mouse.move(drop[0], drop[1], { steps: 4 });
    await p.mouse.click(drop[0], drop[1]);
    await frames(p);
    const one = await curves(before);
    const aim = one.ids.length === 1 && (await p.evaluate((id) => {
      const w = window.woodrail;
      const c = { x: 0, z: 0, y: 0, heading: 0 };
      w.layout.worldConnector(id * 8 + 1, c);
      return { x: c.x + 34 * Math.cos(c.heading), z: c.z + 34 * Math.sin(c.heading) };
    }, one.ids[0]));
    let two = one;
    if (aim) {
      const at = await screenOf(aim);
      await p.mouse.move(at[0], at[1], { steps: 4 });
      await p.mouse.click(at[0], at[1]);
      await frames(p);
      two = await curves(before);
    }
    check(`tight curves (${hand ? "right" : "left"}, carried): clicked where it goes on a free end, the next joins there`, two.ids.length === 2 && two.open.length === 2, JSON.stringify({ one, two }));
    await p.keyboard.press("Escape");
    await takeUp(two.ids);
  }
  await ctx.close();
}

// ---- desktop: ☰ Report a bug or give feedback, with the mouse ----
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await sandbox(ctx);
  const press = async (sel) => {
    const e = await p.$(sel);
    if (!e) throw new Error(`no ${sel}`);
    await e.click();
    await frames(p);
  };
  try {
    await feedbackFlow(p, { press, check, label: "feedback (mouse)" });
  } catch (e) {
    check("feedback (mouse): ran to the end", false, String(e?.message ?? e).split("\n")[0]);
  }
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

// ---- Game mode: the Engine clicked (the user's screenshot, #12), and a locked engine ----
{
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(URL);
  await p.waitForFunction(() => !!window.woodrail && document.querySelector(".title-card.mode-game button.primary") !== null, null, { timeout: 180000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  // (The Trains tab's Engines shelf, opened as a tap on them would: the tray's tabs aren't what's tested here.)
  await p.evaluate(() => window.woodrail.hud.openTray("trains", "Engines"));
  await p.waitForFunction(() => !!document.querySelector('.scroller .tray-item[data-key="train:Engine"]'), null, { timeout: 30000 });
  const at = (sel) => p.evaluate((sel) => { const e = document.querySelector(sel); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, e.dataset.key]; }, sel);
  const engine = await at('.scroller .tray-item[data-key="train:Engine"]');
  await p.mouse.click(engine[0], engine[1]);
  await frames(p);
  const c1 = await placeCard(p);
  check("Game mode: a click on the Engine carries it, and its card says what it is, pulls and how fast", (await thing())?.kind === "drag-train" && cardOk(c1, "Engine") && c1.text.includes("Pulls 4 cars · steady"), JSON.stringify(c1));
  await p.keyboard.press("Escape");
  await frames(p);
  check("…Esc puts it away, and the card goes with it", !(await thing()) && (await placeCard(p)) === null, JSON.stringify(await placeCard(p)));
  const locked = await at(".scroller .tray-item.locked");
  await p.mouse.click(locked[0], locked[1]);
  await p.waitForFunction(() => document.querySelector(".lock-note")?.hidden === false, null, { timeout: 5000 }).catch(() => {});
  const note = await p.evaluate(() => { const n = document.querySelector(".lock-note"); return n && !n.hidden ? n.textContent : null; });
  check("…a click on a locked engine carries nothing; its lock note (claude/locked-tiles) says how to unlock it, in place of a card", !(await thing()) && (await placeCard(p)) === null && !!note && /unlock|soon/i.test(note), `${locked[2]}: ${note}`);
  await ctx.close();

  async function thing() {
    return p.evaluate(() => { const c = window.woodrail.interaction.carriedThing; return c ? { kind: c.m.kind } : null; });
  }
}

// ---- touch: a tap in the tray carries nothing (as before); its card shows a moment; a long press shows details ----
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const p = await sandbox(ctx);
  // (The tray's pictures made first: see `quiet`.)
  await quiet(p);
  const item = await firstItem(p);
  await catchCard(p);
  await p.touchscreen.tap(item.x, item.y);
  const c1 = await caught(p);
  check("on touch, a tap on a tray piece doesn't carry it", !(await carried(p)) && !(await marked(p, item.key)));
  check("…but its card shows a moment, above the tray, taking no touch", cardOk(c1, "Medium straight"), JSON.stringify(c1));
  await p.waitForFunction(() => document.querySelector(".place-card")?.hidden === true, null, { timeout: 10000 }).catch(() => {});
  check("…and goes by itself", (await placeCard(p)) === null);

  // A long press (held 450 ms or more, by event time): its details, and no drag.
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await quiet(p);
  const t0 = Date.now() / 1000;
  const before = await p.evaluate(() => ({ pieces: window.woodrail.layout.pieceCount, mode: window.woodrail.interaction.mode.kind }));
  await touch("touchStart", item.x, item.y, t0);
  await p.waitForFunction(() => window.woodrail.hud.lastTrayDetails > 0, null, { timeout: 10000 }).catch(() => {});
  await touch("touchMove", item.x + 2, item.y - 2, t0 + 0.6);
  const held = await p.evaluate(() => { const t = document.querySelector(".tooltip"); return { tip: t && !t.hidden ? t.querySelector(".tip-name")?.textContent : null, mode: window.woodrail.interaction.mode.kind, ghost: !!window.woodrail.interaction.preview?.ghost.visible }; });
  await touch("touchEnd", item.x + 2, item.y - 2, t0 + 0.7);
  await frames(p);
  const after = await p.evaluate(() => ({ pieces: window.woodrail.layout.pieceCount, mode: window.woodrail.interaction.mode.kind }));
  check("a long press on a tray piece shows its details, and starts no drag", held.tip === "Medium straight" && held.mode === before.mode && !held.ghost && after.pieces === before.pieces && after.mode === before.mode && !(await carried(p)), JSON.stringify({ held, before, after }));

  // A road tapped is made ready (touch's tap-to-select): its card shows while it's ready, and goes when put away.
  await p.evaluate(() => window.woodrail.hud.openTray("roads"));
  await p.waitForFunction(() => !!document.querySelector('.scroller .tray-item[data-key^="road"]'), null, { timeout: 30000 }).catch(() => {});
  const road = await p.evaluate(() => { const e = document.querySelector('.scroller .tray-item[data-key^="road"]'); if (!e) return null; e.scrollIntoView(); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, key: e.dataset.key, name: e.dataset.tipName }; });
  if (!road) check("a road on the Roads tab", false);
  else {
    await p.touchscreen.tap(road.x, road.y);
    await frames(p);
    const c2 = await placeCard(p);
    check("on touch, a tap on a road makes it ready, and its card shows while it is", (await marked(p, road.key)) && cardOk(c2, road.name), JSON.stringify(c2));
    await new Promise((r) => setTimeout(r, 4000));
    check("…(still up after the moment a plain tap's card stays)", (await placeCard(p))?.name === road.name);
    await p.touchscreen.tap(road.x, road.y);
    await frames(p);
    check("…tapped again it's put away, and the card goes", !(await marked(p, road.key)) && (await placeCard(p)) === null, JSON.stringify(await placeCard(p)));
  }
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

// ---- desktop: a route planned by clicks; Ctrl+Z undoes a stop while planning; a stop's mode; Leave asks; Ctrl+Z ----
// (The route card's UX fixes, docs/design/2026-11-02-route-ux F1–F3, with a mouse. Setup only, not what's tested: an
// oval of track with a forest and a sawmill on it, and a train, put down in code past the land's edge on the flat
// table, where the view can go.)
try {
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
    // (The first shift, outward from the view's middle, where each of the oval's pieces is inside the view's bounds,
    // 500 mm from every piece and 300 mm from every model: on the land or the flat table past it.)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const pieces = [...w.layout.pieceIds()].map((i) => w.layout.getPiece(i).pose);
    const models = [...w.props.all()];
    const fits = (dx, dz) => xs.every((x, k) => {
      const px = x + dx;
      const pz = zs[k] + dz;
      return px > b.x0 + 200 && px < b.x1 - 200 && pz > b.z0 + 200 && pz < b.z1 - 200 && pieces.every((q) => Math.hypot(q.x - px, q.z - pz) > 500) && models.every((q) => Math.hypot(q.x - px, q.z - pz) > 300);
    });
    const t = w.controls.target;
    let g = null;
    for (let d = 0; !g && d < 40000; d += 150) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 150));
      for (let a = 0; !g && a < n; a++) {
        const dx = t.x + d * Math.cos((a * 2 * Math.PI) / n) - cx;
        const dz = t.z + d * Math.sin((a * 2 * Math.PI) / n) - cz;
        if (fits(dx, dz)) g = { x: dx, z: dz };
      }
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
    w.director.glideTo(new w.controls.target.constructor(g.x + cx, 0, g.z + cz), 2600, { duration: 0.2 });
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
      // (Its body, 40 mm over the rails: at rail height a click takes the track under it.)
      v = new V((t.world[0].x + t.world[1].x) / 2, t.world[0].y + 40, (t.world[0].z + t.world[1].z) / 2);
    } else {
      const q = w.layout.getPiece(what.piece);
      v = new V(q.pose.x + Math.cos(q.pose.heading) * 108, q.y, q.pose.z + Math.sin(q.pose.heading) * 108);
    }
    const c = v.project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, what);
  // A click as a player makes it: the view panned to the thing first (where it isn't well on screen), then a click
  // where it's seen.
  const clickOn = async (what) => {
    let [x, y] = await at(what);
    if (!(x > 80 && x < 1200 && y > 80 && y < 600)) {
      await p.evaluate((what) => {
        const w = window.woodrail;
        const t = what.engine !== undefined ? w.sim.findCar(what.engine).train.world[0] : w.layout.getPiece(what.piece).pose;
        w.director.glideTo(new w.controls.target.constructor(t.x, 0, t.z), 2000, { duration: 0.2 });
      }, what);
      await still();
      [x, y] = await at(what);
    }
    await p.mouse.click(x, y);
    await frames(p);
  };
  // (The card is rebuilt as it changes: the button found, a moment's settle, then found again where it is now.)
  const clickButton = async (sel) => {
    const where = () => p.waitForFunction((sel) => { const e = document.querySelector(sel); if (!e || e.offsetParent === null) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, sel, { timeout: 30000 }).then((h) => h.jsonValue());
    // (Clicked once it holds still: the card's tap guard drops a click on a button that moved within 150 ms, and a
    // change before, such as Only drop, resizes the card.)
    let [x, y] = await where();
    for (let k = 0; k < 20; k++) {
      await frames(p);
      await p.waitForTimeout(250);
      const [x2, y2] = await where();
      const held = Math.abs(x2 - x) < 1 && Math.abs(y2 - y) < 1;
      [x, y] = [x2, y2];
      if (held) break;
    }
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
  // (Clicked again, up to 3 times, until it asks: the card's tap guard rightly drops a click on a button that just
  // moved, and the card's status line above can change its height at any moment.)
  for (let k = 0; k < 3 && !(await p.evaluate(() => !!document.querySelector(".engine-extra .route-leave.asking"))); k++) await clickButton(".engine-extra .route-leave:not(.asking)");
  // (The second click at once, where it is: "Forget …?" waits 4 s, and on a busy page waiting for it to hold still
  // takes longer. It doesn't move.)
  const ask = await p.waitForFunction(() => { const e = document.querySelector(".engine-extra .route-leave.asking"); if (!e) return null; const r = e.getBoundingClientRect(); return { text: e.textContent, lines: window.woodrail.economy.lines.size, x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, null, { timeout: 30000 }).then((h) => h.jsonValue());
  // (Not before 300 ms: the guard drops a click on a button that came into place within 150 ms, and Forget has just
  // replaced Leave. Again, while it still asks, if a click didn't take.)
  for (let k = 0; k < 3; k++) {
    await p.waitForTimeout(300);
    const at = await p.evaluate(() => { const e = document.querySelector(".engine-extra .route-leave.asking"); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    if (!at || (await p.evaluate(() => window.woodrail.economy.lines.size)) === 0) break;
    await p.mouse.click(at[0], at[1]);
    await frames(p);
  }
  const text = ask.text;
  const asked = { lines: ask.lines };
  const gone = await route();
  check("desktop (F3): Leave asks first (\"Forget …?\"), the second click forgets the line", asked.lines === 1 && /^Forget/.test(text ?? "") && gone.lines === 0 && gone.stops.length === 0, JSON.stringify({ asked, text, gone }));
  await p.keyboard.press("Control+z");
  await frames(p);
  const back = await route();
  check("desktop (F1): Ctrl+Z brings the line back, Only drop and all", back.lines === 1 && back.stops.length === 2 && back.stops[1].a === "drop", JSON.stringify(back));
  await ctx.close();
} catch (e) {
  check("desktop routes: ran to the end", false, String(e?.message ?? e).split("\n")[0]);
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
