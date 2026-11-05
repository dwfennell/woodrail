// Pictures of the goods chains (2026-11-04) on a phone (390×844): each new industry's yard (sugar beet field, jam
// kitchen, chocolate factory, flower field, dye works, toy workshop) and its card, a train of their loads, and the
// research board on the Toy workshop. A Game, the yards put down by the editor and stocked by hand (a harness shortcut:
// it's for looking, not for testing; goods-chains.test.ts and e2e:research test the player's path).
//
// Usage: node tools/shots/goods-chains.mjs [<out dir>]   (default out: e2e-out/goods-chains)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/goods-chains";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5393, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (name) => p.screenshot({ path: `${OUT}/${name}.jpg`, quality: 82, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// The six yards in a row, away from the first town, each stocked with what it takes and makes.
const YARDS = [
  ["depot-beet", "beetfield", { sugar: 5 }],
  ["depot-jam", "jamworks", { fruit: 3, sugar: 3, jam: 3 }],
  ["depot-chocolate", "chocworks", { cocoa: 3, milk: 3, chocolate: 3 }],
  ["depot-flowers", "flowerfield", { flowers: 5 }],
  ["depot-dyeworks", "dyeworks", { flowers: 3, paint: 3 }],
  ["depot-toyworks", "toyworks", { planks: 2, paint: 3, toys: 3 }],
];
const yards = await p.evaluate(async (YARDS) => {
  const { CARGO } = await import("/src/economy/cargo.ts");
  const w = window.woodrail;
  // (What the new rows need, and two of them: the board then shows the rest waiting.)
  for (const id of ["farming", "orchard", "dairy", "juice", "sugar", "harbours", "paint", "carpentry"]) w.learn(id);
  const t = w.world.landscape.towns[0];
  const g = w.world.landscape.grid;
  const out = [];
  const taken = [];
  for (const [, [type, role, piles]] of YARDS.entries()) {
    // (A clear spot for the picture: level grass with nothing on it, round the yard and a margin, apart from the
    // yards already put down. Searched outward from a point off the first town, on the 72 mm grid.)
    let id = null;
    let at = null;
    let y = 0;
    const clear = (x, z) => {
      let h = null;
      for (let dx = -80; dx <= 300; dx += 36) {
        for (let dz = -60; dz <= 220; dz += 36) {
          const i = g.cellAtWorld(x + dx, z + dz);
          if (i === -1 || g.surface[i] !== 0 || g.feature[i] !== 0) return false;
          if (h === null) h = g.height[i];
          else if (g.height[i] !== h) return false;
        }
      }
      return !taken.some((q) => Math.abs(q.x - x) < 420 && Math.abs(q.z - z) < 320);
    };
    search: for (let r = 0; r < 40; r++) {
      for (let a = 0; a < Math.max(1, r * 6); a++) {
        const x = Math.round((t.centre.x - 1500 + r * 72 * Math.cos((a / Math.max(1, r * 6)) * Math.PI * 2)) / 72) * 72;
        const z = Math.round((t.centre.z + 900 + r * 72 * Math.sin((a / Math.max(1, r * 6)) * Math.PI * 2)) / 72) * 72;
        if (!clear(x, z)) continue;
        const cell = g.cellAtWorld(x + 108, z + 72);
        y = g.groundY(cell);
        id = w.editor().place(type, { x, z, heading: 0 }, y, false) ?? null;
        if (id !== null) {
          at = { x, z };
          taken.push(at);
          break search;
        }
      }
    }
    if (id === null) {
      out.push({ type, error: "not placed" });
      continue;
    }
    const d = w.economy.depotAtPiece(id) ?? w.economy.addDepot(role, id);
    for (const [kind, n] of Object.entries(piles)) d.piles[CARGO[kind].index] = n;
    out.push({ type, role, id: d.id, x: at.x + 108, y, z: at.z + 72 });
  }
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  return out;
}, YARDS);
console.log("yards:", JSON.stringify(yards));
const look = (x, z, dist, phi = 0.8, theta = undefined, y = 0) =>
  p.evaluate(({ x, y, z, dist, phi, theta }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, y, z), dist, { duration: 0.1, phi, theta }), { x, y, z, dist, phi, theta });
const hideUi = await p.addStyleTag({ content: "body.shots-clean > *:not(#scene) { visibility: hidden !important }" });
void hideUi;
// (The catalogue's models load on first use: one pass over the yards so they're in before the pictures.)
await p.waitForTimeout(4000);
for (const y of yards) {
  // (LOADS_ONLY=1: just the train's picture and the board, for framing it.)
  if (y.error || process.env.LOADS_ONLY) continue;
  await p.evaluate(() => document.body.classList.add("shots-clean"));
  await look(y.x, y.z, Number(process.env.DIST ?? 620), Number(process.env.PHI ?? 1.0), process.env.THETA ? Number(process.env.THETA) : undefined, y.y);
  await p.waitForTimeout(1500);
  await settle();
  await snap(`goods-chains-${y.role}`);
  // Its card (the yard behind it), as a tap on it opens it.
  await p.evaluate(() => document.body.classList.remove("shots-clean"));
  await p.evaluate((id) => window.woodrail.interaction.openDepot(id), y.id);
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => console.log(`(no card for ${y.role})`));
  await p.waitForTimeout(800);
  await snap(`goods-chains-${y.role}-card`);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
}

// A train of their loads: flowers on a flatbed, jam and toys in vans, chocolate in a cold van.
const train = await p.evaluate(async (yards) => {
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const w = window.woodrail;
  w.learn("reefer");
  const last = yards.filter((y) => !y.error).at(-1);
  let end = w.economy.depot(last.id).pieceId;
  const straights = [];
  for (let k = 0; k < 4; k++) straights.push((end = appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ?? end));
  w.trackChanged();
  const r = w.sim.addTrain(["engine", "timber", "van", "van", "reefer"], { pieceId: straights[2], pathIndex: 0, reversed: true, s: 200 });
  if (r.kind !== "placed") return { error: r.kind };
  const cars = w.sim.getTrain(r.trainId).cars;
  w.economy.setCargo(cars[1].id, "flowers", 3);
  w.economy.setCargo(cars[2].id, "jam", 3);
  w.economy.setCargo(cars[3].id, "toys", 3);
  w.economy.setCargo(cars[4].id, "chocolate", 3);
  w.invalidate();
  // (The flatbed of flowers in the middle of the picture: vans are closed, their loads seen in the yards.)
  return { car: cars[1].id };
}, yards);
if (!train.error) {
  // (The train's models are built on the next frames.)
  await p.waitForFunction((id) => !!window.woodrail.trainView.carObject(id), train.car, { timeout: 60000 }).catch(() => console.log("(no car model)"));
  Object.assign(
    train,
    await p.evaluate((id) => {
      const w = window.woodrail;
      const v = new w.camera.position.constructor();
      w.trainView.carObject(id)?.getWorldPosition(v);
      return { x: v.x, y: v.y, z: v.z };
    }, train.car),
  );
}
console.log("train:", JSON.stringify(train));
if (!train.error) {
  await p.evaluate(() => document.body.classList.add("shots-clean"));
  // (From the side, across the track: the flowers on the flatbed, the vans' and the cold van's sides.)
  for (const [name, theta] of [["goods-chains-loads", Number(process.env.CTHETA ?? Math.PI)]]) {
    await look(train.x, train.z, Number(process.env.CLOSE ?? 360), Number(process.env.CPHI ?? 1.05), theta, train.y);
    await p.waitForTimeout(1500);
    await settle();
    await snap(name);
  }
  await p.evaluate(() => document.body.classList.remove("shots-clean"));
}

// The research board on the Toy workshop (its ticket: what it needs, where it's taught).
await p.evaluate(() => document.querySelector(".research-pill")?.click());
await p.waitForFunction(() => !!document.querySelector(".board-open"), null, { timeout: 15000 }).catch(() => console.log("(no board)"));
await p.evaluate(() => {
  const n = [...document.querySelectorAll(".board-body .bp-node")].find((x) => x.querySelector(".bp-name")?.textContent === "Toy workshop");
  n?.scrollIntoView({ block: "center", inline: "center" });
  n?.click();
});
await p.waitForTimeout(1200);
await snap("goods-chains-board");
console.log(errors.length ? errors.join("\n") : "no errors");
await b.close();
await server.close();
