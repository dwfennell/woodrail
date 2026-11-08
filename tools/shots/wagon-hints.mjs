// Pictures of which wagon carries what (the player: "it would also be nice to be able to see what kind of wagon is
// needed to transport goods"), on a 390×844 phone in Game mode: a quarry's card ("🪨 Stone 3/12 🚃 Hopper"), a train
// of flatbeds standing at it (its engine card: "Needs a hopper for stone: add one to this train"; the quarry's card: "A
// train here needs a hopper for stone"), and a town's card (each good's wagon under its bar). The quarry put down by
// the editor and stocked by hand, the train put down in code (a harness shortcut: it's for looking, not for testing;
// wagons.test.ts, chains.test.ts and town-ledger.test.ts test the words, e2e:sandbox-chains a card by taps).
//
// Usage: node tools/shots/wagon-hints.mjs [<out dir>]   (default out: e2e-out/wagon-hints)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/wagon-hints";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5395, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const snap = (name) => p.screenshot({ path: `${OUT}/${name}.jpg`, quality: 82, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());

// A quarry on clear level grass off the first town, a long straight on past it, stone piled, and a train of an engine
// and two flatbeds standing on the quarry's track.
const set = await p.evaluate(async () => {
  const { CARGO } = await import("/src/economy/cargo.ts");
  const { appendPiece, connectorRef } = await import("/src/track/index.ts");
  const w = window.woodrail;
  w.learn("quarries");
  const t = w.world.landscape.towns[0];
  const g = w.world.landscape.grid;
  const clear = (x, z) => {
    let h = null;
    for (let dx = -40; dx <= 880; dx += 36)
      for (let dz = -60; dz <= 60; dz += 30) {
        const i = g.cellAtWorld(x + dx, z + dz);
        if (i === -1 || g.surface[i] !== 0 || g.feature[i] !== 0) return false;
        if (h === null) h = g.height[i];
        else if (g.height[i] !== h) return false;
      }
    return [...w.layout.pieceIds()].every((i) => Math.hypot(w.layout.getPiece(i).pose.x - x, w.layout.getPiece(i).pose.z - z) > 500);
  };
  let id = null;
  let at = null;
  search: for (let r = 0; r < 90; r++)
    for (let a = 0; a < Math.max(1, r * 6); a++) {
      const x = Math.round((t.centre.x + 1200 + r * 72 * Math.cos((a / Math.max(1, r * 6)) * Math.PI * 2)) / 72) * 72;
      const z = Math.round((t.centre.z + r * 72 * Math.sin((a / Math.max(1, r * 6)) * Math.PI * 2)) / 72) * 72;
      if (!clear(x, z)) continue;
      const y = g.groundY(g.cellAtWorld(x + 108, z));
      id = w.editor().place("depot-quarry", { x, z, heading: 0 }, y, false) ?? null;
      if (id !== null) {
        at = { x, z, y };
        break search;
      }
    }
  if (id === null) return { error: "no room for the quarry" };
  const quarry = w.economy.depotAtPiece(id) ?? w.economy.addDepot("quarry", id);
  quarry.piles[CARGO.stone.index] = 3;
  let end = id;
  for (let k = 0; k < 3; k++) end = appendPiece(w.layout, "straight-216", false, connectorRef(end, 1)) ?? end;
  w.trackChanged();
  const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: id, pathIndex: 0, reversed: true, s: 200 });
  if (r.kind !== "placed") return { error: `train: ${r.kind}` };
  const engine = w.sim.getTrain(r.trainId).cars[0].id;
  w.sim.setLever(engine, 0);
  w.depotView.setWorld(w.economy, w.layout);
  w.invalidate();
  return { quarry: quarry.id, engine, x: at.x + 216, y: at.y, z: at.z };
});
console.log("set:", JSON.stringify(set));
if (set.error) throw new Error(set.error);
await p.evaluate(({ x, y, z }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, y, z), 900, { duration: 0.1, phi: 0.9 }), set);
await p.waitForTimeout(2500);
await settle();

// 1. The quarry's card, the train of flatbeds standing at it: its stone and the wagon for it, and what the train needs.
await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), set.quarry);
await p.waitForFunction(() => /Needs|needs/.test(document.querySelector(".depot-card .depot-stock")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(600);
const quarryCard = await p.evaluate(() => document.querySelector(".depot-card .depot-stock")?.textContent ?? "");
console.log("quarry card:", JSON.stringify(quarryCard));
await snap("1-quarry-card");
await p.keyboard.press("Escape");

// 2. The train's engine card: why nothing happens.
await p.evaluate((id) => window.woodrail.interaction.openEngineCard(id), set.engine);
await p.waitForFunction(() => /Needs a hopper/.test(document.querySelector(".engine-card .engine-status")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
await p.waitForTimeout(600);
const status = await p.evaluate(() => document.querySelector(".engine-card .engine-status")?.textContent ?? "");
console.log("engine card:", JSON.stringify(status));
await snap("2-needs-a-hopper");
await p.keyboard.press("Escape");

// 3. A town's card: each good it needs, with the wagon that brings it under its bar.
const town = await p.evaluate(() => window.woodrail.economy.allDepots().find((d) => d.role === "town")?.id ?? -1);
await p.evaluate((id) => window.woodrail.interaction.openDepotCard(id), town);
await p.waitForTimeout(1200);
const ledger = await p.evaluate(() => [...document.querySelectorAll(".ledger-good")].map((g) => g.textContent));
console.log("town card:", JSON.stringify(ledger));
await snap("3-town-card");

console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
await b.close();
await server.close();
process.exit(0);
