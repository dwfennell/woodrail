// Pictures of tech tree 4 on a phone (390×844): the research picker on Signals, College, Mines and the Carpenter's
// bench; the school's card reading ahead (Reading room); a signal box working far points by telegraph poles; and the
// mine, foundry, carpenter's yard and smithy with their second-tier machines. Run on main too, for the "before" (what
// isn't on main is left out: no poles, no machines, no Reading room). Setup by shortcuts (blueprints learned, yards put
// down by the editor, goods into the school as a crane brings them): it's for looking, not testing (tech-tree-4.test.ts
// and e2e:research test the player's path).
//
// Usage: node tools/shots/tech-tree-4.mjs [<out dir>] [<prefix>]   (default out: e2e-out/tech-tree-4)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/tech-tree-4";
const PREFIX = process.argv[3] ?? "";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (name) => p.screenshot({ path: `${OUT}/${PREFIX}${name}.png`, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const quiet = async () => {
  await p.evaluate(() => {
    document.querySelector(".growth-sheet .close")?.click();
    for (const t of document.querySelectorAll(".toast.show")) t.classList.remove("show");
  });
  await p.waitForTimeout(300);
};
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// The line between the first two towns and a school (as e2e:research), then the mid game's blueprints learned.
const has = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor, schoolOn } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const { techOf } = await import("/src/game/tech.ts");
  const w = window.woodrail;
  w.paused = true;
  const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
  play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
  schoolOn(w.world, w.editor(), new Set());
  for (const id of ["switches", "bridges", "junctions", "routes", "passengers", "farming", "mills", "tank", "goods-engine", "quarries", "mines", "foundry", "carpentry", "scenery", "college", "warehouses"]) w.learn(id);
  const pr = w.progress();
  pr.coins = 5000;
  pr.counts.set("coalDug", 80);
  pr.counts.set("ironCast", 50);
  pr.counts.set("delivered:furniture", 40);
  w.hud.setCoins(pr.coins);
  w.invalidate();
  const built = (id) => !!techOf(id) && techOf(id).plan === undefined;
  return { telegraph: built("telegraph"), room: built("reading-room"), mines2: built("mines2") };
});
console.log("this tree has:", JSON.stringify(has));
await p.waitForTimeout(1500);
await quiet();

// The picker on four nodes: the web around each (Signals' and the industries' dead ends, or what follows them now).
const board = async (open) => {
  for (let i = 0; i < 3; i++) {
    if (!!(await p.evaluate(() => document.querySelector(".board-open"))) === open) return;
    await p.evaluate((open) => (open ? document.querySelector(".research-pill") : document.querySelector(".board-head .close"))?.click(), open);
    await p.waitForTimeout(600);
  }
};
const select = (name) =>
  p.evaluate((name) => {
    const el = [...document.querySelectorAll(".board-body .bp-node")].find((n) => n.querySelector(".bp-name")?.textContent === name);
    if (!el) return false;
    el.click();
    el.scrollIntoView({ block: "center" });
    return true;
  }, name);
await board(true);
for (const [name, file] of [
  ["Routes and signals", "board-routes-signals"],
  ["College", "board-college"],
  ["Mines", "board-mines"],
  ["Carpenter's bench", "board-carpentry"],
]) {
  console.log(name, await select(name));
  await p.waitForTimeout(700);
  await quiet();
  await snap(file);
}
await board(false);

// The Reading room: two researches queued, 10 planks into the school: the first takes its 4, the next 6 read ahead.
if (has.room) {
  const card = await p.evaluate(async () => {
    const w = window.woodrail;
    const { toggleQueue } = await import("/src/game/research.ts");
    w.learn("reading-room");
    const pr = w.progress();
    toggleQueue(pr, "telegraph");
    const school = w.economy.allDepots().find((d) => d.role === "school");
    for (let i = 0; i < 10; i++) w.economy.intoSink(school, "planks");
    w.interaction.openDepotCard(school.id);
    const piece = w.layout.getPiece(school.pieceId);
    w.director.glideTo(new w.camera.position.constructor(piece.pose.x, 0, piece.pose.z), 700, { duration: 0.1 });
    return { current: pr.research.current, next: pr.research.next };
  });
  console.log("reading room:", JSON.stringify(card));
  await p.waitForTimeout(1500);
  await settle();
  await quiet();
  await snap("school-reading-ahead");
  await p.evaluate(() => window.woodrail.interaction.clearSelection?.());
}

// A signal box by the line, with points far along it: on main it works only what's near it; with the Telegraph, two
// poles carry its reach to the far points.
const box = await p.evaluate(async ({ poles }) => {
  const w = window.woodrail;
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  // (On main the Scenery kit, learned above, brings the box.)
  if (poles) for (const id of ["signal-boxes", "telegraph"]) w.learn(id);
  const st = w.world.stations.get(w.world.landscape.towns[1].id);
  // Points on the second station's far end, a straight off each way.
  const sw = appendPiece(w.layout, "switch", false, connectorRef(st, 1));
  if (sw === null || sw === undefined) return { error: "no room for points" };
  appendPiece(w.layout, "straight-216", false, connectorRef(sw, 1));
  w.trackChanged();
  const pose = w.layout.getPiece(st).pose;
  const back = (along, across) => ({ x: pose.x - Math.cos(pose.heading) * along - Math.sin(pose.heading) * across, z: pose.z - Math.sin(pose.heading) * along + Math.cos(pose.heading) * across, heading: pose.heading, y: 0 });
  const spot = back(500, -130);
  const g = w.world.landscape.grid;
  const y = (q) => ({ ...q, y: g.groundY(g.cellAtWorld(q.x, q.z)) });
  const boxProp = w.props.add("bldg-signal-box", y(spot));
  // Poles evenly from the box to beside the points, each span under the wire's reach.
  const swPose = w.layout.getPiece(sw).pose;
  const end = { x: swPose.x - Math.sin(pose.heading) * -110, z: swPose.z + Math.cos(pose.heading) * -110 };
  const n = Math.ceil(Math.hypot(end.x - spot.x, end.z - spot.z) / 550);
  if (poles) for (let k = 1; k <= n; k++) w.props.add("mech-telegraph-pole", y({ x: spot.x + ((end.x - spot.x) * k) / n, z: spot.z + ((end.z - spot.z) * k) / n, heading: pose.heading }));
  w.propsChanged();
  w.interaction.selectProp(boxProp.id);
  const mid = { x: (spot.x + end.x) / 2, z: (spot.z + end.z) / 2 };
  w.director.glideTo(new w.camera.position.constructor(mid.x, 0, mid.z), 1500, { duration: 0.1, phi: 0.6 });
  await new Promise((r) => setTimeout(r, 400));
  return { levers: [...document.querySelectorAll(".piece-card .lever-list button")].map((x) => x.textContent) };
}, { poles: has.telegraph });
console.log("signal box:", JSON.stringify(box));
await p.waitForTimeout(1500);
await settle();
await p.waitForTimeout(3000);
await quiet();
await snap("signal-box-card");
// The same view, the map alone: the box, the poles and the far points.
await p.addStyleTag({ content: "body > *:not(#scene) { visibility: hidden !important }" });
await p.waitForTimeout(500);
await snap("signal-box-map");

// The four yards, each with its second-tier machine where the tree has one.
const yards = await p.evaluate(async ({ tiers }) => {
  const w = window.woodrail;
  if (tiers) for (const id of ["mines2", "foundry2", "joinery", "smithy", "toolworks"]) w.learn(id);
  else w.learn("smithy");
  const t = w.world.landscape.towns[0];
  const g = w.world.landscape.grid;
  const out = [];
  ["mine", "foundry", "carpenter", "smithy"].forEach((role, i) => {
    const x = t.centre.x - 1400;
    const z = t.centre.z + 600 + i * 260;
    const y = g.groundY(g.cellAtWorld(x + 108, z + 72));
    const id = w.editor().place(`depot-${role}`, { x, z, heading: 0 }, y, false);
    if (!w.economy.depotAtPiece(id)) w.economy.addDepot(role, id);
    out.push({ role, x: x + 108, z: z + 72 });
  });
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  return out;
}, { tiers: has.mines2 });
for (const y of yards) {
  await p.evaluate(({ x, z }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, 0, z), 520, { duration: 0.1, phi: 0.8 }), y);
  await p.waitForTimeout(1200);
  await settle();
  await snap(`yard-${y.role}`);
}
console.log(errors.length ? `page errors: ${errors.slice(0, 3).join(" | ")}` : "no page errors");
await b.close();
await server.close();
process.exit(0);
