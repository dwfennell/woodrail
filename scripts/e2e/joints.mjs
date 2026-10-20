// End-to-end: a drawn line's joints hold through a reload (`npm run e2e:joints [-- <out dir>]`). QA's repro: seed 7, a
// fresh Game on a 360×740 touch screen, Draw on, the camera on (-1062, 18) at 1900 mm (tilt 0.95, theta −2: QA's line); one stroke from the sawmill's
// end to Larkfield station's west end. Every joint of the line must be within the joint tolerance, and after a reload
// and Continue the same joints must hold: the track unbroken from the sawmill to Larkfield (QA: 8.1° and 6.3° joints
// held while playing, then were refused on load, and the line split).
// Starts its own dev server. Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/joints";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 0, strictPort: false }, logLevel: "warn" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-7`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
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
// QA's stroke, every 15 mm along its world line, seen on the ground with QA's camera; touch moves every 10 px.
const screen = await p.evaluate(() => {
  const w = window.woodrail;
  const V = w.camera.position.constructor;
  w.lookAt(new V(-1062, 0, 18), 1900, 0.95, -2);
  const way = [[-1476, -72], [-1476, 60], [-1300, 108], [-648, 108]];
  const pts = [way[0]];
  for (let i = 1; i < way.length; i++) {
    const [ax, az] = way[i - 1];
    const [bx, bz] = way[i];
    const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 15);
    for (let k = 1; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const r = w.canvas.getBoundingClientRect();
  return pts.map(([x, z]) => {
    const v = new V(x, 0, z).project(w.camera);
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  });
});
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
await touch("touchStart", screen[0][0], screen[0][1]);
for (let i = 1; i < screen.length; i++) {
  const [ax, ay] = screen[i - 1];
  const [bx, by] = screen[i];
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
  for (let k = 1; k <= n; k++) await touch("touchMove", ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n);
}
await touch("touchEnd", 0, 0);
await settled();
await shot("joints-1-drawn");

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
const line = await laid();
const before = await joints();
const lineIds = new Set(line.map((x) => x.id));
const touching = (js) => js.filter((j) => j.pieces.split("-").some((id) => lineIds.has(Number(id))));
check("the stroke lays a line from the sawmill to Larkfield, joined at every end", line.length >= 4 && line.every((x) => x.joined), line.map((x) => `${x.id} ${x.type}${x.joined ? "" : " (open)"}`).join(", "));
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

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await server.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
