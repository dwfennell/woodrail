// The lines UI redesign (docs/agents/lines-ui-proposals.md): Game mode on an oval with two forest yards, a sawmill and
// a workshop, three lines (Red with two trains, Blue with one, Green with none), run a while so goods move. Then each
// scene in scenes.mjs (or SCENES=<file>): the UI as it is today, or a mock (HTML/CSS over the game), at each size.
//
// Usage: node tools/shots/lines-redesign/stage.mjs [<out dir>] [<scene,…>]   (default out: tools/shots/lines-redesign/out)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");
const DIR = new URL(".", import.meta.url).pathname;
const OUT = process.argv[2] ?? `${DIR}out`;
const ONLY = process.argv[3]?.split(",");
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5433, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const SIZES = { phone: { width: 390, height: 844, touch: true }, desktop: { width: 1440, height: 900, touch: false } };
const scenes = (await import(`${DIR}${process.env.SCENES ?? "scenes.mjs"}?${Date.now()}`)).default;

for (const [size, vp] of Object.entries(SIZES).filter(([k]) => !process.env.SIZE || process.env.SIZE === k)) {
  const todo = scenes.filter((s) => (!s.size || s.size === size) && (!ONLY || ONLY.includes(s.name)));
  if (todo.length === 0) continue;
  const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, hasTouch: vp.touch, isMobile: vp.touch });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  const setup = await p.evaluate(async () => {
    const w = window.woodrail;
    for (const id of ["switches", "routes", "warehouses"]) w.learn(id);
    const { Layout } = await import("/src/track/index.ts");
    const S = await import("/src/routing/scenarios.ts");
    const { checkPlacement } = await import("/src/landscape/clearance.ts");
    const { startLine, joinLine, createLine } = await import("/src/game/lines.ts");
    const scratch = new Layout();
    const ids = S.oval(scratch).ids;
    const pts = ids.map((i) => [scratch.getPiece(i).pose.x, scratch.getPiece(i).pose.z]);
    const t = w.world.landscape.towns[0].centre;
    const ok = (x, z) => {
      if (w.landscape.grid.cellAtWorld(x, z) === -1) return false;
      for (const i of w.layout.pieceIds()) { const q = w.layout.getPiece(i).pose; if (Math.hypot(q.x - x, q.z - z) <= 500) return false; }
      return [0, Math.PI / 2].some((h) => checkPlacement(w.landscape, "straight-216", false, { x: x - 108 * Math.cos(h), z: z - 108 * Math.sin(h), heading: h }, 0).kind === "clear");
    };
    let g = null;
    for (let d = 600; d < 8000 && !g; d += 54) {
      const n = Math.max(8, Math.round((2 * Math.PI * d) / 54));
      for (let a = 0; a < n && !g; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n)), z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        if (pts.every(([dx, dz]) => ok(x + dx, z + dz))) g = { x, z };
      }
    }
    if (!g) throw new Error("no ground");
    const types = { 0: "depot-forest", 2: "depot-forest", 7: "depot-sawmill", 9: "depot-workshop" };
    const placed = w.editor().placeRun(ids.map((i, k) => {
      const q = scratch.getPiece(i);
      return { type: types[k] ?? q.type, pose: { x: q.pose.x + g.x, z: q.pose.z + g.z, heading: q.pose.heading }, y: 0, flipped: q.flipped };
    }));
    const depot = (id, role) => w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    const places = [depot(placed[0], "forest").id, depot(placed[2], "forest").id, depot(placed[7], "sawmill").id, depot(placed[9], "workshop").id];
    const engines = [placed[4], placed[11], placed[13]].map((pieceId, k) => {
      const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId, pathIndex: 0, s: 100, reversed: false });
      if (r.kind !== "placed") throw new Error("no room for a train");
      const e = w.sim.getTrain(r.trainId).cars[0].id;
      w.sim.setLever(e, 1);
      return e;
    });
    const [A, B, D, C] = places;
    const red = startLine(w.economy, engines[0], [{ depotId: A, action: "auto" }, { depotId: B, action: "auto" }, { depotId: D, action: "auto", waitFill: true }, { depotId: C, action: "drop" }]);
    joinLine(w.economy, engines[2], red.id);
    startLine(w.economy, engines[1], [{ depotId: D, action: "pick" }, { depotId: C, action: "auto" }]);
    createLine(w.economy, [{ depotId: B, action: "auto" }, { depotId: C, action: "auto" }]);
    w.trackChanged?.();
    w.invalidate();
    const { CARGO } = await import("/src/economy/cargo.ts");
    for (let i = 0; i < 120 * 60; i++) {
      if (i % 120 === 0) for (const f of [A, B]) w.economy.depot(f).piles[CARGO.log.index] = 20;
      w.sim.tick();
      w.economy.tick();
      w.economy.drainEvents();
    }
    w.invalidate();
    w.paused = true;
    return { engines, places, g, red: red.id };
  });
  console.log(size, JSON.stringify(setup));
  const ctxObj = { size, settle, css: (f) => readFileSync(`${DIR}${f}`, "utf8"), html: (f) => readFileSync(`${DIR}${f}`, "utf8") };
  for (const s of todo) {
    await s.run(p, setup, ctxObj);
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/${s.name}-${size}.jpg`, type: "jpeg", quality: 85, timeout: 240000 });
    console.log("shot", `${s.name}-${size}`);
    if (s.after) await s.after(p, setup, ctxObj);
  }
  await ctx.close();
}
await b.close();
await server.close();
