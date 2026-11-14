// End-to-end: a drawn line's joints hold through a reload (`npm run e2e:joints [-- <out dir>]`). QA's repro: seed 7, a
// fresh Game on a 360×740 touch screen, Draw on, the camera on (-1062, 18) at 1900 mm (tilt 0.95; moved 120 mm west so
// the stroke's start is clear of the tray (see `qaLine`); in the browser,
// theta −1.4 lays QA's line: the unit replay in joint-hold.test.ts reads the moves its own way and lays it at −2); one
// stroke from the sawmill's end to Larkfield station's west end. Every joint of the line must be within the joint
// tolerance, and after a reload and Continue the same joints must hold: the track unbroken from the sawmill to
// Larkfield (QA: 8.1° and 6.3° joints held while playing, then were refused on load, and the line split).
// Then an older build's save of that line (its live poses, no `joints` list) is loaded with Continue: it must come
// back joined, every joint within the tolerance.
// Group `slip-draw` (tech-tree T4): in a new Game, a 45° crossing with a line off each end; Draw on, a stroke along a
// turn from one line to the other is refused till Slips is learned (and says so), then makes the crossing a single
// slip, every joint kept and within the tolerance; undone, it's the crossing again; drawn again, a reload and Continue
// keep the slip, set to turn, joined at all four ends.
// Groups (`-- --list`, E2E_ONLY, resume: docs/agents/e2e.md): `qa-line`, `slip-draw`.
// Starts its own dev server (on 5391, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { groups } from "./lib/groups.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/joints";
mkdirSync(OUT, { recursive: true });
// (Started only when a group will run: `--list`, and a run whose groups all passed already, need no browser.)
let server = null;
let PAGE = "";
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
let b = null;
let ctx = null;
let p = null;
const errors = [];
async function boot() {
  if (b) return;
  server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "warn" });
  await server.listen();
  await server.warmupRequest("/src/main.ts");
  // (No #seed- link: that opens Sandbox. A new Game is on the starter map, seed 7.)
  PAGE = server.resolvedUrls.local[0];
  b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}
/** A fresh phone page (its own profile: a new Game). */
async function freshPage() {
  await boot();
  await ctx?.close().catch(() => {});
  ctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
}
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settled = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
/** The Game card's main button on the title: a new game, or Continue once there's a save. */
const enterGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await settled();
  await p.keyboard.press("Escape");
};
/** Every joint: its pieces, how far off seated it is, and whether it's over the tolerance (from the game's constants). */
const joints = () =>
  p.evaluate(async () => {
    const { JOINT_ANGLE_TOLERANCE, JOINT_POS_TOLERANCE } = await import("/src/track/constants.ts");
    const { pieceOfRef } = await import("/src/track/layout.ts");
    return [...window.woodrail.layout.joints()].map((j) => ({
      key: `${j.a}-${j.b}`,
      pieces: `${pieceOfRef(j.a)}-${pieceOfRef(j.b)}`,
      deg: (j.angleError * 180) / Math.PI,
      mm: j.posError,
      over: j.angleError > JOINT_ANGLE_TOLERANCE + 1e-9 || j.posError > JOINT_POS_TOLERANCE + 1e-9,
    }));
  });
const say = (js) => js.map((j) => `${j.pieces} ${j.deg.toFixed(3)}° ${j.mm.toFixed(2)}mm`).join(", ");

/** QA's line from the sawmill to Larkfield: its joints hold through a reload; an older build's save comes back joined. */
async function qaLine() {
  await freshPage();
  await p.goto(PAGE);
  await enterGame();
  const ids0 = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
  await p.tap(".tray-draw");
  await p.waitForFunction(() => window.woodrail.interaction.draw.ready, null, { timeout: 60000 }).catch(() => {});
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  /** The pieces the stroke laid (in id order), and whether each is joined at both ends. */
  const laid = () =>
    p.evaluate(async (ids0) => {
      const { connectorRef } = await import("/src/track/layout.ts");
      const w = window.woodrail;
      const was = new Set(ids0);
      return [...w.layout.pieceIds()]
        .filter((id) => !was.has(id))
        .sort((a, b) => a - b)
        .map((id) => ({ id, type: w.layout.getPiece(id).type, joined: [0, 1].every((i) => w.layout.joinedConnector(connectorRef(id, i)) !== -1) }));
    }, ids0);
  /**
   * QA's stroke: its world points seen on the ground with QA's camera (on (-1062, 18) at 1900 mm, tilted 0.95, from
   * `theta`), touch moves every `step` px between them. What it laid.
   */
  const stroke = async (theta, step, dx) => {
    const screen = await p.evaluate(([theta, dx]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      w.lookAt(new V(-1062 + dx, 0, 18), 1900, 0.95, theta);
      // (Projected before a frame is drawn: the camera's matrices brought up to date here.)
      w.camera.updateMatrixWorld();
      const r = w.canvas.getBoundingClientRect();
      return [[-1476, -72], [-1476, 60], [-1300, 108], [-648, 108]].map(([x, z]) => {
        const v = new V(x, 0, z).project(w.camera);
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      });
    }, [theta, dx]);
    // Every point clear of the HUD by a fingertip (24 px each way): a finger that close to a button is the button's
    // (the browser's touch adjustment), as on a phone. (On QA's own view, the stroke's start is 8 px above the tray.)
    const under = await p.evaluate((pts) => pts.flatMap(([x, y]) => [[0, 0], [24, 0], [-24, 0], [0, 24], [0, -24]].map(([ox, oy]) => document.elementFromPoint(x + ox, y + oy)).filter((e) => e !== window.woodrail.canvas).map((e) => `${Math.round(x)},${Math.round(y)} ${e?.className || e?.tagName}`)), screen);
    if (under.length > 0) return { under };
    await touch("touchStart", screen[0][0], screen[0][1]);
    for (let i = 1; i < screen.length; i++) {
      const [ax, ay] = screen[i - 1];
      const [bx, by] = screen[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 1; k <= n; k++) await touch("touchMove", ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
    }
    await touch("touchEnd", 0, 0);
    await settled();
    return laid();
  };
  // QA's line closes on Larkfield by the joints' play alone (no joiner piece): the view QA had isn't known to the last
  // hundredth of a turn, so a few close to it are tried (each stroke undone) until one lays such a line.
  let line = [];
  let tried = [];
  // (θ −1.4 lays it: on de7fd9c at 10 px, QA's joints exactly, 8.149° at the sawmill and 6.338°; since the draw
  // junction changes, at 7 px.) The view is QA's moved 120 mm west (`dx`): on QA's own, the stroke starts 8 px above
  // the tray (taller since the toy box HUD), and the finger lands on its Track tab. 120 mm west, the start is 77 px
  // above it; there θ −1.4 lays the line at 7 and 10 px, and 90 mm west θ −2 at 7 px.
  for (const [theta, step, dx] of [[-1.4, 7, -120], [-1.4, 10, -120], [-2, 7, -90]]) {
    const got = await stroke(theta, step, dx);
    if (got.under) {
      line = [];
      tried.push(`θ ${theta}, ${step} px, ${dx} mm: under the HUD (${got.under.slice(0, 3).join("; ")})`);
      continue;
    }
    line = got;
    tried.push(`θ ${theta}, ${step} px, ${dx} mm: ${line.map((x) => x.type).join(" ")}`);
    if (line.length >= 4 && line.every((x) => x.joined) && !line.some((x) => /^(join|fit)-/.test(x.type))) break;
    await p.evaluate(() => window.woodrail.interaction.undo());
    await settled();
  }
  console.log(`(strokes: ${tried.join(" | ")})`);
  await shot("joints-1-drawn");

  const before = await joints();
  const lineIds = new Set(line.map((x) => x.id));
  const touching = (js) => js.filter((j) => j.pieces.split("-").some((id) => lineIds.has(Number(id))));
  check("the stroke lays QA's line from the sawmill to Larkfield, joined at every end by the joints' play (no joiner)", line.length >= 4 && line.every((x) => x.joined) && !line.some((x) => /^(join|fit)-/.test(x.type)), line.map((x) => `${x.id} ${x.type}${x.joined ? "" : " (open)"}`).join(", ") || tried.join(" | "));
  check("every joint is within the joint tolerance", before.every((j) => !j.over), say(touching(before)));

  // Leave (the autosave on pagehide), come back, Continue.
  await p.reload();
  await enterGame();
  const after = await joints();
  const keys = (js) => js.map((j) => j.key).sort().join(" ");
  check("after a reload and Continue, the same joints hold", keys(after) === keys(before), `lost: ${before.filter((j) => !after.some((k) => k.key === j.key)).map((j) => j.pieces).join(", ") || "none"}; ${say(touching(after))}`);
  const reloaded = await laid();
  check("…and the track is unbroken from the sawmill to Larkfield", reloaded.length === line.length && reloaded.every((x) => x.joined), reloaded.map((x) => `${x.id}${x.joined ? "" : " (open)"}`).join(", "));
  await shot("joints-2-reloaded");

  // An older build's save: QA's line as main laid it (its live poses), saved without `joints`, so seating it afresh
  // parted the sawmill joint (8.149°) and 10-11 (6.338°). Continue must bring them back.
  const { createWorld } = await server.ssrLoadModule("/src/game/world.ts");
  const { serializeWorld } = await server.ssrLoadModule("/src/persist/save.ts");
  const QA_LINE = [
    ["straight-54", false, -1474.82136001023, -71.81197803187507, 1.4285617612548278],
    ["curve-small", true, -1465.9882092722885, -18.16943831057526, 1.3893997557748223],
    ["curve-wide", true, -1427.4013016877939, 39.85794598990954, 0.6667587358107459],
    ["straight-216", false, -1227.2856270410823, 95.9700965295593, -0.00802620568061186],
    ["straight-144", false, -1010.1134451490739, 94.41579872082777, 0.03263674638071597],
    ["straight-216", false, -865.0107362523145, 99.29026086462507, 0.03952016712254344],
  ];
  const old = createWorld(7, true);
  // (At the next free ids, as that build numbered them after the map's own pieces: a fresh world's own pieces now go up
  // to 8, so the old fixed ids 8–13 lost the first piece, and the joints' names moved.)
  const base = Math.max(...old.layout.pieceIds()) + 1;
  const placed = QA_LINE.map(([type, flipped, x, z, heading], i) => old.layout.restorePiece(base + i, type, { x, z, heading }, 0, flipped));
  if (!placed.every(Boolean)) throw new Error(`the old line's pieces weren't all restored: ${placed}`);
  const sawmill = (() => {
    for (const id of old.layout.pieceIds()) if (old.layout.getPiece(id).type === "depot-sawmill") return id;
    return -1;
  })();
  const oldSave = serializeWorld(old);
  delete oldSave.joints;
  const ctx2 = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const q = await ctx2.newPage();
  q.on("pageerror", (e) => errors.push(e.message));
  await q.addInitScript((raw) => {
    localStorage.setItem("woodrail.helpSeen", "1");
    // (Once: the page's own autosave on leaving isn't overwritten.)
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("woodrail.game.v2", raw);
      sessionStorage.setItem("seeded", "1");
    }
  }, JSON.stringify(oldSave));
  p = q;
  await q.goto(PAGE);
  await enterGame();
  const back = await joints();
  const oldLine = await laid();
  check(
    "an older build's save of QA's line comes back joined from the sawmill to Larkfield",
    oldLine.length === 6 && oldLine.every((x) => x.joined) && back.some((j) => j.pieces === `${sawmill}-${base}`) && back.some((j) => j.pieces === `${base + 2}-${base + 3}`),
    `${oldLine.map((x) => `${x.id} ${x.type}${x.joined ? "" : " (open)"}`).join(", ")}; ${say(back)}`,
  );
  check("…every joint within the joint tolerance", back.every((j) => !j.over), say(back));
  await shot("joints-3-old-save");
  await ctx2.close();
}

/**
 * Group `slip-draw`: a 45° crossing made a slip by a Draw stroke along its turn, in Game mode (see the header). Setup
 * (not what's tested): Switches and Junctions learned and a 45° crossing in the box; the crossing and a straight off
 * each end laid through the editor, on open land near the view.
 */
async function slipDraw() {
  await freshPage();
  await p.goto(PAGE);
  await enterGame();
  const cdp = await ctx.newCDPSession(p);
  const stamped = (type, x, y, timestamp) => cdp.send("Input.dispatchTouchEvent", { type, timestamp, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const laid = await p.evaluate(async () => {
    const w = window.woodrail;
    const T = await import("/src/track/index.ts");
    const { checkPlacement } = await import("/src/landscape/clearance.ts");
    for (const r of ["switches", "junctions"]) w.learn(r);
    w.progress().add("piece:crossing-45");
    // (Open land: the crossing and its four legs where the game's own rule takes each piece, clear of other track.)
    const plan = (x, z) => {
      const scratch = new T.Layout();
      const id = scratch.addPiece("crossing-45", { x, z, heading: 0 }, 0, false);
      const out = [{ type: "crossing-45", pose: { x, z, heading: 0 } }];
      for (let c = 0; c < 4; c++) {
        const end = scratch.worldConnector(T.connectorRef(id, c), { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
        out.push({ type: "straight-144", pose: { x: end.x, z: end.z, heading: end.heading } });
      }
      return out;
    };
    const t = w.controls.target;
    for (let d = 0; d < 4000; d += 72) {
      const n = d === 0 ? 1 : Math.max(8, Math.round((2 * Math.PI * d) / 72));
      for (let a = 0; a < n; a++) {
        const x = Math.round(t.x + d * Math.cos((a * 2 * Math.PI) / n));
        const z = Math.round(t.z + d * Math.sin((a * 2 * Math.PI) / n));
        const pieces = plan(x, z);
        if (![...w.layout.pieceIds()].every((i) => Math.hypot(w.layout.getPiece(i).pose.x - x, w.layout.getPiece(i).pose.z - z) > 600)) continue;
        if (!pieces.every((q) => checkPlacement(w.landscape, q.type, false, q.pose, 0).kind === "clear")) continue;
        const [crossing] = w.editor().placeRun([{ ...pieces[0], y: 0, flipped: false }]);
        for (const q of pieces.slice(1)) w.editor().placeRun([{ ...q, y: 0, flipped: false }]);
        w.invalidate();
        const joined = [0, 1, 2, 3].every((c) => w.layout.joinedConnector(T.connectorRef(crossing, c)) !== -1);
        return { crossing, x, z, joined };
      }
    }
    return null;
  });
  check("slip-draw: (setup) a 45° crossing with a line off each end, on open land", !!laid?.joined, JSON.stringify(laid));
  if (!laid?.joined) return;
  // What's said (toasts), for the refusal.
  await p.evaluate(() => {
    const h = window.woodrail.hud;
    window.__said = [];
    const toast = h.toast.bind(h);
    h.toast = (m, ...a) => (window.__said.push(m), toast(m, ...a));
  });
  /** The world points of the turn from end 0 onto the other line (on the crossing as it lies), as screen points. */
  const turn = () =>
    p.evaluate(async (x0) => {
      const w = window.woodrail;
      const T = await import("/src/track/index.ts");
      const V = w.camera.position.constructor;
      w.lookAt(new V(x0.x + 72, 0, x0.z), 700, 0.95, -1.2);
      w.camera.updateMatrixWorld();
      const r = w.canvas.getBoundingClientRect();
      const g = T.getPieceDef("slip-single", false).paths[2].geom;
      const s = T.createSample();
      const out = [];
      // (From 30 mm in: nearer its end, the press is on the leg joined there.)
      for (let d = 30; d <= 132; d += 6) {
        T.samplePath(g, d, s);
        const v = new V(x0.x + s.x, 0, x0.z + s.z).project(w.camera);
        out.push([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
      }
      return out;
    }, laid);
  const stroke = async () => {
    const pts = await turn();
    await p.evaluate(() => window.woodrail.settled());
    stroke.picked = await p.evaluate(([x, y]) => { const k = window.woodrail.interaction.pick(x, y, true); return k ? JSON.parse(JSON.stringify(k)) : null; }, pts[0]);
    // (Stamped 30 ms apart, as a quick stroke is: a finger resting first would pick the crossing up.)
    let t = Date.now() / 1000;
    await stamped("touchStart", pts[0][0], pts[0][1], t);
    for (const [x, y] of pts.slice(1)) await stamped("touchMove", x, y, (t += 0.03));
    await stamped("touchEnd", 0, 0, (t += 0.03));
    await p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
  };
  const typeAt = () => p.evaluate(({ x, z }) => {
    const w = window.woodrail;
    // (The crossing, or the slip in its place: its middle is the crossing's, 72 mm along it; a leg starts at its end 0.)
    const id = [...w.layout.pieceIds()].find((i) => {
      const q = w.layout.getPiece(i);
      const mx = q.pose.x + 72 * Math.cos(q.pose.heading);
      const mz = q.pose.z + 72 * Math.sin(q.pose.heading);
      return /^(crossing-45|slip-)/.test(q.type) && Math.hypot(mx - (x + 72), mz - z) < 2;
    });
    return id === undefined ? null : { id, type: w.layout.getPiece(id).type, state: w.layout.switchState(id) };
  }, laid);
  await p.tap(".tray-draw");
  await p.waitForFunction(() => window.woodrail.interaction.draw.ready, null, { timeout: 60000 }).catch(() => {});
  // 1. Slips not learned: refused, and why.
  await stroke();
  const refused = await typeAt();
  const said = await p.evaluate(() => window.__said);
  check("slip-draw: before Slips is learned, a stroke along the crossing's turn leaves it a crossing, and says why", refused?.type === "crossing-45" && said.some((m) => /slip/i.test(m) && /not learned/.test(m)), JSON.stringify({ refused, said, picked: stroke.picked, crossing: laid.crossing }));
  // 2. Learned (setup: the blueprint's research is e2e:research's), and a single slip in the box: the stroke makes it a slip.
  await p.evaluate(() => {
    window.woodrail.learn("routes");
    window.woodrail.learn("slips");
    window.woodrail.progress().add("piece:slip-single");
  });
  await stroke();
  const slip = await typeAt();
  const js = await joints();
  const at = (id) => js.filter((j) => j.pieces.split("-").includes(String(id)));
  check("slip-draw: learned, the stroke makes the crossing a single slip, set to turn", slip?.type === "slip-single" && slip.state === 1, JSON.stringify(slip));
  check("slip-draw: …joined at all four ends, every joint within the tolerance", !!slip && at(slip.id).length === 4 && at(slip.id).every((j) => !j.over), say(slip ? at(slip.id) : []));
  await shot("slip-draw-1-slip");
  // 3. One undo step: the crossing again.
  await p.evaluate(() => window.woodrail.interaction.undo());
  await p.evaluate(() => window.woodrail.settled());
  const undone = await typeAt();
  check("slip-draw: undone, it's the 45° crossing again (one step)", undone?.type === "crossing-45", JSON.stringify(undone));
  // 4. Drawn again, then a reload and Continue: still a slip, set to turn, joined.
  await stroke();
  const again = await typeAt();
  await p.reload();
  await enterGame();
  const back = await typeAt();
  const js2 = await joints();
  check(
    "slip-draw: after a reload and Continue, the slip is there, set to turn, joined at all four ends",
    again?.type === "slip-single" && back?.type === "slip-single" && back.state === 1 && js2.filter((j) => j.pieces.split("-").includes(String(back.id))).length === 4,
    JSON.stringify({ again, back }),
  );
  await shot("slip-draw-2-reloaded");
}

const suite = groups("joints", { results, errors, check });
suite.add("qa-line", qaLine, { about: "QA's drawn line holds its joints through a reload; an older build's save comes back joined" });
suite.add("slip-draw", slipDraw, { about: "a Draw stroke along a 45° crossing's turn makes it a slip (Game mode, once learned)" });
await suite.run();
check("no page errors", errors.length === 0, errors.join(" | "));
await b?.close();
await server?.close();
suite.finish();
