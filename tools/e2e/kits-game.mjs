// End-to-end railway kits in Game mode (`npm run e2e:kits-game`): a new game's tray shows no kits; Engine shed learned,
// the water tower comes out of the Industries tab's Railway shelf, is dragged with the mouse onto a line of straights
// (it splices in), and a steam engine stops at it. Halts are refused far from towns.
//
// Usage: npm run e2e:kits-game [-- <out dir>]   (default out: e2e-out/kits-game)
// Starts its own dev server (on 5361, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/kits-game";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5361, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((b) => !b.hidden && b.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
// Any card the game opens for a new player (goals, news) out of the way.
await p.keyboard.press("Escape");

/** Click the first element matching `selector` whose text starts with `text`. */
const clickText = async (selector, text) => {
  const box = await p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().startsWith(text) && e.getBoundingClientRect().width > 0);
      if (!el) return null;
      el.scrollIntoView({ inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
  if (!box) return false;
  await p.mouse.click(box.x, box.y);
  await p.waitForTimeout(400);
  return true;
};
const trayKeys = () => p.evaluate(() => [...document.querySelectorAll(".tray-item[data-key]")].map((b) => b.dataset.key));
const shelves = () => p.evaluate(() => [...document.querySelectorAll(".tray-item.tray-group .label")].map((l) => l.textContent));

// 1. A new game: no kits on the tray, and the Industries tab opens straight onto its industries.
await clickText(".tabs button", "Industries");
const fresh = await trayKeys();
check("a new game's Industries tab: industries only, no kits", fresh.includes("piece:depot-workshop") && !fresh.some((k) => k.startsWith("piece:kit-") || k.startsWith("prop:")), JSON.stringify(fresh));
await clickText(".tabs button", "Track");
check("a new game's Track tab: no Railway kit shelf", !(await shelves()).includes("Railway kit"), JSON.stringify(await shelves()));
await shot("1-new-game-track");

// 2. Halts far from any town are refused (Game mode's site rule), near one allowed.
const halt = await p.evaluate(() => {
  const w = window.woodrail;
  const t = w.landscape.towns[0];
  return { far: w.interaction.siteRule("kit-country-halt", { x: t.centre.x + 20000, z: t.centre.z + 20000, heading: 0 }), near: w.interaction.siteRule("kit-country-halt", { x: t.centre.x + 400, z: t.centre.z, heading: 0 }) };
});
check("a halt far from towns: \"Build halts near a town\"; near one, fine", halt.far === "Build halts near a town" && halt.near === null, JSON.stringify(halt));

// 3. Engine shed learned (as from the board), and a water tower in the toy box.
await p.evaluate(() => {
  const w = window.woodrail;
  const pr = w.progress();
  for (const t of ["switches", "junctions", "engine-shed"]) pr.learned.add(t);
  pr.add("piece:kit-water-tower", 1);
  w.hud.refreshTrayBadges();
  w.hud.trayLearned();
});

// A line of straights on clear ground near the middle, turnbacks at the ends.
const line = await p.evaluate(() => {
  const w = window.woodrail;
  const i = w.interaction;
  const seq = ["buffer-turnback", "straight-216", "straight-216", "straight-216", "straight-216", "buffer-turnback"];
  // (A connector ref: piece id × MAX_CONNECTORS (8) + its index.)
  const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
  for (let ring = 1; ring < 30; ring++)
    for (let k = 0; k < 16; k++)
      for (const heading of [0, Math.PI / 2]) {
        const a = (k * Math.PI) / 8;
        let t = { x: Math.round((Math.cos(a) * ring * 300) / 18) * 18, z: Math.round((Math.sin(a) * ring * 300) / 18) * 18, heading };
        const ids = [];
        let ok = true;
        for (const type of seq) {
          const pose = { x: t.x, z: t.z, heading: t.heading };
          if (i.placement(type, false, pose, 0, -1).reason) {
            ok = false;
            break;
          }
          const id = w.editor().place(type, pose, 0, false);
          ids.push(id);
          t = c(id, type === "buffer-turnback" ? 0 : 1);
        }
        // (Room beside it for the tower's tank too: the second straight's left side.)
        if (ok) return { ids };
        for (const id of ids.reverse()) w.editor().remove(id);
      }
  return null;
});
check("built a line of straights", !!line, JSON.stringify(line));
if (line) {
  await p.evaluate(({ ids }) => {
    const w = window.woodrail;
    const pose = w.layout.getPiece(ids[2]).pose;
    w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 700, { duration: 0.1 });
  }, line);
  await p.waitForTimeout(800);
  await settle();

  // 4. The Industries tab now has a Railway shelf with the water tower, in the toy box.
  await clickText(".tabs button", "Industries");
  const shelvesNow = await shelves();
  check("Engine shed learned: the Industries tab shows a Railway shelf", shelvesNow.includes("Railway") && !shelvesNow.includes("Halts"), JSON.stringify(shelvesNow));
  await clickText(".tray-item.tray-group", "Railway");
  const keys = await trayKeys();
  check("…with the shed and the services on it", ["kit-engine-shed", "kit-water-tower", "kit-coal-stage", "kit-water-crane", "kit-coaling-crane"].every((k) => keys.includes(`piece:${k}`)) && !keys.includes("piece:kit-roundhouse-segment"), JSON.stringify(keys));
  const badge = await p.evaluate(() => document.querySelector(".tray-item[data-key='piece:kit-water-tower'] .have")?.textContent ?? null);
  check("…the water tower: one in the toy box", badge === "1", String(badge));
  await p.waitForTimeout(3000);
  await shot("2-railway-shelf");

  // 5. Drag it from the tray onto the line's second straight: it splices in.
  const from = await p.evaluate(() => {
    const el = document.querySelector(".tray-item[data-key='piece:kit-water-tower']");
    el.scrollIntoView({ inline: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const to = await p.evaluate(({ ids }) => {
    const w = window.woodrail;
    const piece = w.layout.getPiece(ids[2]);
    const c = new w.camera.position.constructor(piece.pose.x + Math.cos(piece.pose.heading) * 108, 0, piece.pose.z + Math.sin(piece.pose.heading) * 108).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
  }, line);
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  for (let k = 1; k <= 24; k++) {
    await p.mouse.move(from.x + ((to.x - from.x) * k) / 24, from.y + ((to.y - from.y) * k) / 24);
    await p.waitForTimeout(40);
  }
  await p.waitForTimeout(500);
  await shot("3-dragging");
  await p.mouse.up();
  await p.waitForTimeout(800);
  const tower = await p.evaluate(() => {
    const w = window.woodrail;
    const id = w.layout.pieceIds().find((i) => w.layout.getPiece(i).type === "kit-water-tower");
    return id === undefined ? null : id;
  });
  const refusal = await p.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
  check("the water tower, dragged from the tray, is on the line", tower !== null, `toast: ${refusal}`);
  const left = await p.evaluate(() => document.querySelector(".tray-item[data-key='piece:kit-water-tower'] .have")?.textContent ?? null);
  check("…and the toy box has none left (or what it costs to make)", left !== "1", String(left));

  if (tower !== null) {
    await p.evaluate((id) => window.woodrail.kitView.load("kit-water-tower").then(() => window.woodrail.syncKits(true)), tower);
    // 6. A steam engine on the line stops at the tower.
    const r = await p.evaluate(
      ({ ids, tower }) => {
        const w = window.woodrail;
        w.paused = true;
        const placed = w.sim.addTrain(["engine"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 60 });
        if (placed.kind !== "placed") return { placed: placed.kind };
        const t = w.sim.getTrain(placed.trainId);
        w.sim.setLever(t.cars[0].id, 1);
        let at = -1;
        for (let k = 0; k < 120 * 20; k++) {
          w.sim.tick();
          w.economy.tick();
          if (k % 2 === 1) w.kitView.update(w.kitTriggered, 2 / 120);
          if (w.economy.kitStops.dwellingAt(placed.trainId) === tower) {
            at = k;
            break;
          }
        }
        return { placed: "placed", at, speed: w.sim.getTrain(placed.trainId).speed, look: w.sim.lookOf(t.cars[0].id) };
      },
      { ids: line.ids, tower },
    );
    check("a steam engine stops at the water tower", r.placed === "placed" && r.at >= 0 && r.speed === 0, JSON.stringify(r));
    await p.evaluate((id) => {
      const w = window.woodrail;
      w.invalidate();
      const pose = w.layout.getPiece(id).pose;
      w.director.glideTo(new w.camera.position.constructor(pose.x, 0, pose.z), 360, { duration: 0.1 });
    }, tower);
    await p.waitForTimeout(1500);
    await settle();
    await shot("4-engine-at-water-tower");
  }
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
