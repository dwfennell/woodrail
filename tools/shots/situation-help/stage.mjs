// Situation help (docs/superpowers/specs/2026-11-18-situation-help.md): mock-ups over the running game. Game mode on a
// 390×844 phone; an oval with a forest yard and a sawmill, one line with three trains and no signals, run till they
// wait for each other (sections' `followSpot`). Then each scene: the real HUD with mock HTML put in its place (the 💡
// row under the goals, the toast by the game's own `hud.toast`, Show me by the game's own `showSignalSpot`).
//
// Usage: node tools/shots/situation-help/stage.mjs [<out dir>] [<scene,…>]   (default out: docs/superpowers/specs/situation-help)
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const OUT = process.argv[2] ?? `${ROOT}/docs/superpowers/specs/situation-help`;
const ONLY = process.argv[3]?.split(",");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5437, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror", e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
// A flat map with no water (a map code in the seed box): room for the long line.
await p.waitForSelector(".new-game-sheet:not([hidden]) .new-game-seed", { timeout: 30000 }).catch(() => null);
await p.evaluate(() => {
  const box = document.querySelector(".new-game-sheet:not([hidden]) .new-game-seed");
  if (!box) return;
  box.value = "4242-flat-water-none-nocoast";
  box.dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector(".new-game-sheet:not([hidden]) .new-game-start").click();
});
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// Setup (a shortcut: the jam is the scene, not the thing tested): learn what the scene needs, lay the oval by the
// editor beside the first town, three trains on one line, run two game minutes.
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  for (const id of ["switches", "routes", "signals"]) w.learn(id);
  const { Layout } = await import("/src/track/index.ts");
  const S = await import("/src/routing/scenarios.ts");
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
  const { startLine, joinLine } = await import("/src/game/lines.ts");
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const { chain, loopOn } = await import("/src/economy/loop-fixtures.ts");
  // ⊐ A ══ ══ (loop) ══ × 8 ══ ══ B ⊏ (signal-slots.test.ts's longLine): the follow hint's own layout.
  const scratch = new Layout();
  const Sx = "straight-216";
  const [a, , w2] = chain(scratch, ["depot-forest", Sx, Sx]);
  appendPiece(scratch, "buffer-turnback", false, connectorRef(a, 0));
  const l1 = loopOn(scratch, connectorRef(w2, 1), [Sx, Sx], [Sx]);
  const mid = chain(scratch, Array(8).fill(Sx), connectorRef(l1.s2, 0));
  const [, , bb] = chain(scratch, [Sx, Sx, "depot-sawmill"], connectorRef(mid[mid.length - 1], 1));
  appendPiece(scratch, "buffer-turnback", false, connectorRef(bb, 1));
  const ids = [...scratch.pieceIds()];
  const t = w.world.landscape.towns[0].centre;
  const ok = (x, z) => {
    if (w.landscape.grid.cellAtWorld(x, z) === -1) return false;
    for (const i of w.layout.pieceIds()) { const q = w.layout.getPiece(i).pose; if (Math.hypot(q.x - x, q.z - z) <= 400) return false; }
    return [0, Math.PI / 2].some((h) => checkPlacement(w.landscape, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
  };
  // (Turned by `r` about the first piece: the ground east-west or north-south, whichever has room.)
  const rot = (r, x, z) => [x * Math.cos(r) - z * Math.sin(r), x * Math.sin(r) + z * Math.cos(r)];
  let g = null;
  for (let d = 0; d < 16000 && !g; d += 108) {
    const n = Math.max(8, Math.round((2 * Math.PI * d) / 108));
    for (let k = 0; k < n && !g; k++)
      for (const r of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
        const x = Math.round(t.x + d * Math.cos((k * 2 * Math.PI) / n)), z = Math.round(t.z + d * Math.sin((k * 2 * Math.PI) / n));
        if (ids.every((i) => { const q = scratch.getPiece(i).pose; const [dx, dz] = rot(r, q.x, q.z); return ok(x + dx, z + dz); })) { g = { x, z, r }; break; }
      }
  }
  if (!g) { const gr = w.landscape.grid; const pl = gr.plots ?? gr.plotList; throw new Error("no ground " + JSON.stringify(Object.keys(gr)) + " " + JSON.stringify((gr.plots||[]).slice(0,40))); }
  const placed = w.editor().placeRun(ids.map((i) => {
    const q = scratch.getPiece(i);
    const [dx, dz] = rot(g.r, q.pose.x, q.pose.z);
    return { type: q.type, pose: { x: dx + g.x, z: dz + g.z, heading: q.pose.heading + g.r }, y: 0, flipped: q.flipped };
  }));
  const at = (i) => placed[ids.indexOf(i)];
  const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
  const A = depot(at(a), "forest").id, B = depot(at(bb), "sawmill").id;
  const engines = [at(mid[1]), at(l1.main[0])].map((pieceId) => {
    const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed: false });
    if (r.kind !== "placed") throw new Error("no room for a train");
    const e = w.sim.getTrain(r.trainId).cars[0].id;
    w.sim.setLever(e, 1);
    return e;
  });
  const red = startLine(w.economy, engines[0], [{ depotId: A, action: "auto" }, { depotId: B, action: "auto" }]);
  w.economy.lines.get(red.id) && joinLine(w.economy, engines[1], red.id);
  // (Shortcut for the picture: the tutorial's goals marked done, so the panel reads as a game past them, where these
  // tips may show. Never the player's path; this only stages a mock.)
  const { GOALS } = await import("/src/game/goals.ts");
  const tracker = w.goals();
  for (const goal of GOALS.slice(0, 13)) tracker.done.add(goal.id);
  w.trackChanged?.();
  const { CARGO } = await import("/src/economy/cargo.ts");
  let follow = -1;
  let waitedAt = -1;
  const { trainState } = await import("/src/game/engine-status.ts");
  for (let i = 0; i < 300 * 60 && follow === -1; i++) {
    if (i % 120 === 0) w.economy.depot(A).piles[CARGO.log.index] = 20;
    w.sim.tick();
    w.economy.tick();
    w.economy.drainEvents();
    if (follow === -1 && i % 60 === 0) follow = w.economy.sections.followSpot();
    // (Stopped with the follower standing, waiting for the leader on the stretch: the moment the tip is about.)
    if (i > 40 * 60 && i % 30 === 0 && [...w.sim.trains()].some((t) => /wait/.test(trainState(w.sim, w.economy, t, 1).kind))) { waitedAt = i / 60; break; }
  }
  // (Not said yet in the time run: the joint mid-stretch, facing B, where the hint would point.)
  if (follow === -1) follow = connectorRef(at(mid[4]), 1);
  w.invalidate();
  w.paused = true;
  w.hud.setPaused(true);
  // (Framed on the train waiting, the follower in the loop.)
  const trainAt = [...w.sim.trains()].filter((t) => /wait/.test(trainState(w.sim, w.economy, t, 1).kind)).map((t) => w.layout.getPiece(t.bogies[0].pieceId).pose);
  const xs = trainAt.map((q) => q.x), zs = trainAt.map((q) => q.z);
  const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2 };
  const states = [...w.sim.trains()].map((t) => trainState(w.sim, w.economy, t, 1).kind);
  window.__follower = { x: centre.x, z: centre.z };
  const ap = w.layout.getPiece(at(a)).pose;
  window.__forest = { x: ap.x, z: ap.z };
  return { engines, A, B, follow, waitedAt, centre, line: red.id, states, pieces: placed.length };
});
console.log(JSON.stringify(setup));

// Frame the oval.
await p.evaluate(({ centre }) => {
  const w = window.woodrail;
  // (Set straight, not glided: the game is paused and draws on change.)
  w.director.cancel();
  // (The train in the upper half: clear of the toast above and the Goals sheet below.)
  w.controls.target.set(centre.x, 0, centre.z + 260);
  w.camera.position.set(centre.x, 2100, centre.z + 260 + 900);
  w.controls.update();
  w.invalidate();
}, setup);
await settle();
// (The game's own toasts, from the setup's learning, gone first.)
await p.waitForFunction(() => !document.querySelector(".toast.show"), null, { timeout: 30000 }).catch(() => p.evaluate(() => document.querySelectorAll(".toast.show").forEach((t) => t.classList.remove("show"))));

const ROW = (o) => `<div class="goal feature-tip situation-tip" data-feature-tip="${o.id}"><span class="goal-box tip-box" aria-hidden="true">💡</span><div><b>${o.title}</b><p>${o.text}</p><span class="tip-buttons">${o.more ? `<button class="chip text tip-more">Learn more</button>` : ""}<button class="chip text tip-done">Got it</button><button class="chip text tip-show">Show me</button></span></div></div>`;
const CSS = `.tip-buttons .tip-more { order: 0; margin-right: auto; } .situation-tip b { display: block; }`;

/** Put a mock tip row under the goals, the chip saying it, and fold or open the panel. */
const tipRow = (o, open) =>
  p.evaluate(({ html, css, open, chip }) => {
    if (!document.getElementById("mock-css")) document.head.insertAdjacentHTML("beforeend", `<style id="mock-css">${css}</style>`);
    const g = document.querySelector(".goals");
    g.hidden = false;
    const pane = g.querySelector(".goals-pane");
    pane.querySelector(".situation-tip")?.remove();
    pane.querySelector(".feature-tip")?.remove();
    pane.insertAdjacentHTML("beforeend", html);
    if (chip) g.querySelector(".goals-now").textContent = chip;
    const collapsed = g.classList.contains("collapsed");
    if (open === collapsed) g.querySelector(".goals-head").click();
  }, { html: ROW(o), css: CSS, open, chip: o.chip });

const scenes = [
  {
    // 1. The jam, first seen: a toast, once (tap: Show me), the chip folded with 💡.
    name: "1-jam-toast",
    run: async () => {
      await tipRow(JAM, false);
      await p.evaluate((t) => window.woodrail.hud.toast(t, false, 60000, () => {}), "💡 Red line trains are queuing nose to tail. A signal lets them follow · Show me");
    },
  },
  {
    // 2. The Goals tab open: the 💡 row, Learn more (the Signals sheet), Got it, Show me.
    name: "2-jam-row",
    run: async () => {
      await p.evaluate(() => document.querySelector(".toast.show")?.classList.remove("show"));
      await tipRow(JAM, true);
    },
  },
  {
    // 3. Show me: the camera on the spot, the signal ghost and block tint (the game's own showSignalSpot), row folded.
    name: "3-jam-show-me",
    run: async () => {
      await tipRow(JAM, false);
      await p.evaluate((at) => { if (at !== -1) window.woodrail.interaction.showSignalSpot(at); }, setup.follow);
      // (The game's own Show me for a signal spot, as it frames it today: the ghost signal and the block's tint.)
      await p.waitForTimeout(1500);
      await settle();
      await settle();
    },
  },
  {
    // 4. Another kind: goods piling at an industry no line serves.
    name: "4-pile-row",
    run: async () => {
      await p.evaluate(() => {
        const w = window.woodrail;
        const f = window.__forest;
        w.controls.target.set(f.x + 150, 0, f.z + 200);
        w.camera.position.set(f.x + 150, 1300, f.z + 200 + 600);
        w.controls.update();
        w.invalidate();
      });
      await tipRow(PILE, true);
      await p.waitForTimeout(1200);
    },
  },
];
const JAM = {
  id: "jam-follow",
  chip: "💡 Trains queuing",
  title: "Trains queuing on the Red line",
  text: "Its two trains wait for the whole stretch to the sawmill. A signal halfway lets them follow each other.",
  more: true,
};
const PILE = {
  id: "pile-unserved",
  chip: "💡 Logs piling up",
  title: "Logs piling up at the forest",
  text: "Its yard is full and no line stops there. Give a train a line that picks up there.",
  more: true,
};

for (const s of scenes.filter((s) => !ONLY || ONLY.includes(s.name))) {
  await s.run();
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/${s.name}.jpg`, type: "jpeg", quality: 85, timeout: 240000 });
  console.log("shot", s.name);
}
await b.close();
await server.close();
