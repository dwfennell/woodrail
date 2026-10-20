// End-to-end: a drawn line's joints hold through a reload (`npm run e2e:joints [-- <out dir>]`). QA's repro: seed 7, a
// fresh Game on a 360×740 touch screen, Draw on, the camera on (-1062, 18) at 1900 mm (tilt 0.95; in the browser,
// theta −1.4 lays QA's line: the unit replay in joint-hold.test.ts reads the moves its own way and lays it at −2); one
// stroke from the sawmill's end to Larkfield station's west end. Every joint of the line must be within the joint
// tolerance, and after a reload and Continue the same joints must hold: the track unbroken from the sawmill to
// Larkfield (QA: 8.1° and 6.3° joints held while playing, then were refused on load, and the line split).
// Then an older build's save of that line (its live poses, no `joints` list) is loaded with Continue: it must come
// back joined, every joint within the tolerance.
// Starts its own dev server (on 5391, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/joints";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "warn" });
await server.listen();
await server.warmupRequest("/src/main.ts");
// (No #seed- link: that opens Sandbox. A new Game is on the starter map, seed 7.)
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
let p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? "  — " + detail : ""}`);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settled = () => p.evaluate(() => Promise.race([window.woodrail.settled(), new Promise((r) => setTimeout(r, 60000))]));
/** The Game card's main button on the title: a new game, or Continue once there's a save. */
const enterGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
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
const stroke = async (theta, step) => {
  const screen = await p.evaluate((theta) => {
    const w = window.woodrail;
    const V = w.camera.position.constructor;
    w.lookAt(new V(-1062, 0, 18), 1900, 0.95, theta);
    // (Projected before a frame is drawn: the camera's matrices brought up to date here.)
    w.camera.updateMatrixWorld();
    const r = w.canvas.getBoundingClientRect();
    return [[-1476, -72], [-1476, 60], [-1300, 108], [-648, 108]].map(([x, z]) => {
      const v = new V(x, 0, z).project(w.camera);
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    });
  }, theta);
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
// junction changes, at 7 px.)
for (const [theta, step] of [[-1.4, 7], [-1.4, 10], [-2, 10]]) {
  line = await stroke(theta, step);
  tried.push(`θ ${theta}, ${step} px: ${line.map((x) => x.type).join(" ")}`);
  if (line.length >= 4 && line.every((x) => x.joined) && !line.some((x) => /^(join|fit)-/.test(x.type))) break;
  await p.evaluate(() => window.woodrail.interaction.undo());
  await settled();
}
console.log(`(strokes: ${tried.join(" | ")})`);
await shot("joints-1-drawn");

const before = await joints();
const lineIds = new Set(line.map((x) => x.id));
const touching = (js) => js.filter((j) => j.pieces.split("-").some((id) => lineIds.has(Number(id))));
check("the stroke lays QA's line from the sawmill to Larkfield, joined at every end by the joints' play (no joiner)", line.length >= 4 && line.every((x) => x.joined) && !line.some((x) => /^(join|fit)-/.test(x.type)), line.map((x) => `${x.id} ${x.type}${x.joined ? "" : " (open)"}`).join(", "));
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
QA_LINE.forEach(([type, flipped, x, z, heading], i) => old.layout.restorePiece(8 + i, type, { x, z, heading }, 0, flipped));
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
  oldLine.length === 6 && oldLine.every((x) => x.joined) && back.some((j) => j.pieces === "6-8") && back.some((j) => j.pieces === "10-11"),
  `${oldLine.map((x) => `${x.id} ${x.type}${x.joined ? "" : " (open)"}`).join(", ")}; ${say(back)}`,
);
check("…every joint within the joint tolerance", back.every((j) => !j.over), say(back));
await shot("joints-3-old-save");

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
