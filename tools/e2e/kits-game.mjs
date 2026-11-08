// End-to-end railway kits in Game mode (`npm run e2e:kits-game`): a new game's tray shows no kits; Engine shed learned,
// the water tower comes out of the Industries tab's Railway shelf, is dragged with the mouse onto a line of straights
// (it splices in), and a steam engine stops at it. Halts are refused far from towns. Then a kit that was Sandbox's
// only: Loading kits learned, the log loader comes off the Yard shelf onto the line, and the engine runs through it.
// Then the dairy chain: Dairy farm learned, the dairy farm and the milk tank wagon on the tray, and a tank wagon
// filled with milk at a dairy farm. Then the next nodes: the juice works, creamery, ice cream factory and brickworks
// and the cold van on the tray once learned, and a cold van filled with ice cream made of the milk and fruit a train
// brought.
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
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((b) => !b.hidden && b.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
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
check("a halt far from towns: \"Build halts within 23 squares of a town\"; near one, fine", halt.far === "Build halts within 23 squares of a town" && halt.near === null, JSON.stringify(halt));

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
        return { placed: "placed", at, speed: w.sim.getTrain(placed.trainId).speed, look: w.sim.lookOf(t.cars[0].id), trainId: placed.trainId };
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

    // 7. A kit that was Sandbox's only (tech-tree step 2): the log loader, behind Loading kits, looks only. Not on the
    // tray till learned; learned (the game's own `learned`, as when a study finishes: the study itself is a setup
    // shortcut, not what's under test), it's on the Industries tab's Yard shelf, is dragged onto the line, and the
    // engine runs through it: no depot (no endless heap of logs), no stop.
    await clickText(".tabs button", "Industries");
    check("Loading kits not learned: no Yard shelf", !(await shelves()).includes("Yard"), JSON.stringify(await shelves()));
    await p.evaluate(() => {
      const w = window.woodrail;
      w.learn("loading-kits");
      // (Setup shortcut: one in the toy box, as the workshop would make it for 5 planks.)
      w.progress().add("piece:kit-log-loader", 1);
      w.hud.refreshTrayBadges();
      w.hud.trayLearned();
    });
    await p.waitForTimeout(800);
    await clickText(".tabs button", "Industries");
    check("Loading kits learned: the Industries tab shows a Yard shelf", (await shelves()).includes("Yard"), JSON.stringify(await shelves()));
    await clickText(".tray-item.tray-group", "Yard");
    const yard = await trayKeys();
    check("…with the four loaders on it, not the big cranes", ["kit-log-loader", "kit-grain-elevator", "kit-drop-hopper", "kit-goods-shed"].every((k) => yard.includes(`piece:${k}`)) && !yard.includes("piece:kit-gantry-crane"), JSON.stringify(yard));
    await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      const pose = w.layout.getPiece(ids[4]).pose;
      w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 700, { duration: 0.1 });
    }, line);
    await p.waitForTimeout(800);
    await settle();
    const from2 = await p.evaluate(() => {
      const el = document.querySelector(".tray-item[data-key='piece:kit-log-loader']");
      el.scrollIntoView({ inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    const to2 = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      const piece = w.layout.getPiece(ids[4]);
      const c = new w.camera.position.constructor(piece.pose.x + Math.cos(piece.pose.heading) * 108, 0, piece.pose.z + Math.sin(piece.pose.heading) * 108).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return { x: r.left + ((c.x + 1) / 2) * r.width, y: r.top + ((1 - c.y) / 2) * r.height };
    }, line);
    await p.mouse.move(from2.x, from2.y);
    await p.mouse.down();
    for (let k = 1; k <= 24; k++) {
      await p.mouse.move(from2.x + ((to2.x - from2.x) * k) / 24, from2.y + ((to2.y - from2.y) * k) / 24);
      await p.waitForTimeout(40);
    }
    await p.waitForTimeout(500);
    await p.mouse.up();
    await p.waitForTimeout(800);
    const loader = await p.evaluate(() => {
      const w = window.woodrail;
      const id = w.layout.pieceIds().find((i) => w.layout.getPiece(i).type === "kit-log-loader");
      return id === undefined ? null : id;
    });
    check("the log loader, dragged from the tray, is on the line", loader !== null, `toast: ${await p.evaluate(() => document.querySelector(".toast")?.textContent ?? "")}`);
    if (loader !== null && r.trainId !== undefined) {
      await p.evaluate(() => window.woodrail.kitView.load("kit-log-loader").then(() => window.woodrail.syncKits(true)));
      const run = await p.evaluate(
        ({ loader, trainId }) => {
          const w = window.woodrail;
          w.paused = true;
          let on = 0;
          let stopped = 0;
          for (let k = 0; k < 120 * 40; k++) {
            w.sim.tick();
            w.economy.tick();
            const t = w.sim.getTrain(trainId);
            if (!t) break;
            if (t.bogies.some((b) => b.pieceId === loader)) {
              on++;
              if (Math.abs(t.speed) < 1 || w.economy.kitStops.dwellingAt(trainId) === loader) stopped++;
            } else if (on > 0) break;
          }
          return { on, stopped, depot: w.economy.depotAtPiece(loader)?.role ?? null };
        },
        { loader, trainId: r.trainId },
      );
      check("…looks only: no depot at it, and the engine runs through without stopping", run.depot === null && run.on > 0 && run.stopped === 0, JSON.stringify(run));
      await p.evaluate((id) => {
        const w = window.woodrail;
        w.paused = false;
        w.invalidate();
        const pose = w.layout.getPiece(id).pose;
        w.director.glideTo(new w.camera.position.constructor(pose.x, 0, pose.z), 360, { duration: 0.1 });
      }, loader);
      await p.waitForTimeout(1500);
      await settle();
      await shot("5-log-loader-on-the-line");
    }
  }
}


// 8. The dairy chain (tech-tree I3): Dairy farm learned (a setup shortcut, as step 7's: the study isn't under test), the
// dairy farm is on the Industries tab and the milk tank wagon on the Trains tab's Wagons shelf; a dairy farm laid by
// the game's own placement rules, and a hand-run train with a tank wagon fills it with milk at the dairy.
{
  // (Industries not learned yet show on the tray, locked: a tap says what to learn.)
  const locked = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tray-item[data-key]")].map((b) => [b.dataset.key, b.classList.contains("locked")])));
  await clickText(".tabs button", "Industries");
  await clickText(".tray-item.tray-group", "Industries");
  const before = await locked();
  check("Dairy farm not learned: the dairy farm and the bakery are locked on the Industries shelf", before["piece:depot-dairy"] === true && before["piece:depot-bakery"] === true, JSON.stringify(before));
  await clickText(".tabs button", "Trains");
  await clickText(".tray-item.tray-group", "Wagons");
  check("…and no milk tank wagon on the Wagons shelf yet", !("train:Milk tank wagon" in (await locked())), JSON.stringify(await locked()));
  await p.evaluate(() => {
    const w = window.woodrail;
    w.learn("dairy");
    w.learn("mills");
    w.learn("bakery");
    w.hud.refreshTrayBadges();
    w.hud.trayLearned();
  });
  await p.waitForTimeout(800);
  await clickText(".tabs button", "Industries");
  await clickText(".tray-item.tray-group", "Industries");
  const after = await locked();
  check("learned: the dairy farm and the bakery are unlocked", after["piece:depot-dairy"] === false && after["piece:depot-bakery"] === false, JSON.stringify(after));
  await clickText(".tabs button", "Trains");
  await clickText(".tray-item.tray-group", "Wagons");
  const wagons = await locked();
  check("…and the milk tank wagon on the Wagons shelf, unlocked", wagons["train:Milk tank wagon"] === false, JSON.stringify(wagons));
  // A short line on clear ground, by the same placement rules a drop is checked with: turnback, dairy farm, straight,
  // turnback.
  const dairyLine = await p.evaluate(() => {
    const w = window.woodrail;
    const i = w.interaction;
    const seq = ["buffer-turnback", "depot-dairy", "straight-216", "straight-216", "buffer-turnback"];
    const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    for (let ring = 4; ring < 40; ring++)
      for (let k = 0; k < 16; k++)
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
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
          if (ok) return { ids };
          for (const id of ids.reverse()) w.editor().remove(id);
        }
    return null;
  });
  check("a dairy farm laid on a line by the placement rules", !!dairyLine, JSON.stringify(dairyLine));
  if (dairyLine) {
    await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      const pose = w.layout.getPiece(ids[1]).pose;
      w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 520, { duration: 0.1 });
    }, dairyLine);
    await p.waitForTimeout(2500);
    await settle();
    const r = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      w.paused = true;
      const dairy = w.economy.depotAtPiece(ids[1]);
      const placed = w.sim.addTrain(["engine", "tanker"], { pieceId: ids[3], pathIndex: 0, reversed: false, s: 100 });
      if (placed.kind !== "placed" || !dairy) return { placed: placed.kind, dairy: dairy?.role ?? null };
      const t = w.sim.getTrain(placed.trainId);
      const tanker = t.cars[1].id;
      // Toward the dairy farm (whichever way that is from where it stands), then run: the cows give milk, its crane
      // fills the tank wagon.
      w.sim.setLever(t.cars[0].id, 1);
      let milk = 0;
      for (let k = 0; k < 120 * 240 && milk === 0; k++) {
        w.sim.tick();
        w.economy.tick();
        const c = w.economy.cargoOf(tanker);
        if (c.kind === "milk") milk = c.count;
        if (k === 120 * 30 && w.sim.getTrain(placed.trainId).speed === 0) w.sim.setLever(t.cars[0].id, -1);
      }
      w.paused = false;
      w.invalidate();
      return { placed: "placed", dairy: dairy.role, milk };
    }, dairyLine);
    check("a hand-run train's tank wagon is filled with milk at the dairy farm", r.dairy === "dairy" && r.milk > 0, JSON.stringify(r));
    await p.waitForTimeout(1500);
    await settle();
    await shot("6-dairy-farm-and-tank-wagon");
  }
}

// 9. The next nodes (tech-tree spec "Next nodes"): Juice works, Creamery, Cold van, Ice cream factory and Brickworks
// learned (a setup shortcut, as step 8's), their buildings unlocked on the Industries shelf and the cold van on the
// Wagons shelf; then the payoff: an ice cream factory laid by the placement rules between a dairy farm and an orchard,
// and a hand-run train with a tank wagon, a flatbed and a cold van brings it milk and fruit and fills the cold van with
// ice cream.
{
  const locked = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tray-item[data-key]")].map((b) => [b.dataset.key, b.classList.contains("locked")])));
  const NEW = ["piece:depot-juicer", "piece:depot-creamery", "piece:depot-icecream", "piece:depot-brickworks"];
  await clickText(".tabs button", "Industries");
  await clickText(".tray-item.tray-group", "Industries");
  const before = await locked();
  check("next nodes not learned: the juice works, creamery, ice cream factory and brickworks are locked", NEW.every((k) => before[k] === true), JSON.stringify(NEW.map((k) => before[k])));
  await clickText(".tabs button", "Trains");
  await clickText(".tray-item.tray-group", "Wagons");
  check("…and no cold van on the Wagons shelf yet", !("train:Cold van" in (await locked())), JSON.stringify(await locked()));
  await p.evaluate(() => {
    const w = window.woodrail;
    for (const id of ["orchard", "juice", "creamery", "reefer", "ice-cream", "quarries", "tank", "goods-engine", "mines", "brickworks"]) w.learn(id);
    w.hud.refreshTrayBadges();
    w.hud.trayLearned();
  });
  await p.waitForTimeout(800);
  await clickText(".tabs button", "Industries");
  await clickText(".tray-item.tray-group", "Industries");
  const after = await locked();
  check("learned: all four are unlocked on the Industries shelf", NEW.every((k) => after[k] === false), JSON.stringify(NEW.map((k) => after[k])));
  await shot("7-next-nodes-on-the-industries-shelf");
  await clickText(".tabs button", "Trains");
  await clickText(".tray-item.tray-group", "Wagons");
  const wagons = await locked();
  check("…and the cold van on the Wagons shelf, unlocked", wagons["train:Cold van"] === false, JSON.stringify(wagons));
  const line = await p.evaluate(() => {
    const w = window.woodrail;
    const i = w.interaction;
    const seq = ["buffer-turnback", "depot-dairy", "depot-orchard", "depot-icecream", "straight-216", "straight-216", "buffer-turnback"];
    const c = (id, k) => w.layout.worldConnector(id * 8 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    for (let ring = 6; ring < 46; ring++)
      for (let k = 0; k < 16; k++)
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
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
          if (ok) return { ids };
          for (const id of ids.reverse()) w.editor().remove(id);
        }
    return null;
  });
  check("a dairy farm, an orchard and an ice cream factory laid on a line by the placement rules", !!line, JSON.stringify(line));
  if (line) {
    await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      const pose = w.layout.getPiece(ids[3]).pose;
      w.director.glideTo(new w.camera.position.constructor(pose.x + 108 * Math.cos(pose.heading), 0, pose.z + 108 * Math.sin(pose.heading)), 620, { duration: 0.1 });
    }, line);
    await p.waitForTimeout(2500);
    await settle();
    const r = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      w.paused = true;
      const factory = w.economy.depotAtPiece(ids[3]);
      const placed = w.sim.addTrain(["engine", "tanker", "timber", "reefer"], { pieceId: ids[5], pathIndex: 0, reversed: false, s: 100 });
      if (placed.kind !== "placed" || !factory) return { placed: placed.kind, factory: factory?.role ?? null };
      const t = w.sim.getTrain(placed.trainId);
      const coldVan = t.cars[3].id;
      w.sim.setLever(t.cars[0].id, 1);
      // Up and down the line (it turns back at either end): milk and fruit in, ice cream out into the cold van.
      let ice = 0;
      for (let k = 0; k < 120 * 600 && ice === 0; k++) {
        w.sim.tick();
        w.economy.tick();
        const c = w.economy.cargoOf(coldVan);
        if (c.kind === "icecream") ice = c.count;
        // (Found by its cold van: a train's id can change on the way.)
        const now = w.sim.trainIds().map((id) => w.sim.getTrain(id)).find((x) => x?.cars.some((c) => c.id === coldVan));
        if (!now) break;
        const engine = now.cars.find((c) => c.kind === "engine");
        if (k % (120 * 30) === 0 && k > 0 && now.speed === 0 && engine) w.sim.setLever(engine.id, engine.lever === 1 ? -1 : 1);
      }
      w.paused = false;
      w.invalidate();
      return { placed: "placed", factory: factory.role, made: w.economy.made[15], ice };
    }, line);
    check("a hand-run train brings the ice cream factory milk and fruit, and its cold van leaves with ice cream", r.factory === "icecream" && r.ice > 0, JSON.stringify(r));
    await p.waitForTimeout(1500);
    await settle();
    await shot("8-ice-cream-factory-and-cold-van");
  }
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
