// End-to-end town drag (issue #18, `npm run e2e:town-drag [-- <out dir>]`), on a 390×844 phone with touch: a new
// game; one of Larkfield's houses is dragged by finger onto another lot of its town (it keeps its storeys and still
// faces a street), then one of Larkfield's street pieces is dragged by finger onto a town green beside another street;
// the town keeps its rules (every house faces a street), the square the street left takes track, and the town grows on
// afterwards (new houses, each facing a street; the moved house keeps its storeys). Undo puts the street back.
//
// Harness shortcut (named, not the thing under test): the town's growth is set going by its deliveries count, as
// `e2e:growth` does; the drags themselves are real touches, stamped (CDP `Input.dispatchTouchEvent`).
// Starts its own dev server (on 5384, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/town-drag";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5384, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const cdp = await p.context().newCDPSession(p);
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

/**
 * A finger put down at a, held still a moment, then drawn to b in small steps and lifted (each event stamped with
 * when it happens). Returns what the interaction was doing on the way.
 */
const fingerDrag = async ([x0, y0], [x1, y1], target) => {
  const at = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  // (On touch, a drag on something not selected pans: the finger rests on it first, past the hold, to take hold.)
  const t0 = Date.now() / 1000;
  await at("touchStart", x0, y0, t0);
  await p.waitForTimeout(700);
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const t1 = Date.now() / 1000;
  let mid = "";
  const steps = 16;
  for (let k = 1; k <= steps; k++) {
    await at("touchMove", x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps, t1 + k * 0.03);
    if (k === steps / 2) mid = await p.evaluate(() => window.woodrail.interaction.mode.kind);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
  // Aimed by eye, as a player does: the square under the hand read back and the finger nudged onto the target.
  let [fx, fy] = [x1, y1];
  for (let k = 0; k < 4 && target !== undefined; k++) {
    const under = await p.evaluate(() => {
      const m = window.woodrail.interaction.mode;
      return m.kind === "drag-prop" ? m.town?.cell ?? -1 : m.kind === "drag-road" ? m.drag.cell : -1;
    });
    if (under === target || under < 0) break;
    const [a, c] = [await onScreen(under), await onScreen(target)];
    fx += c[0] - a[0];
    fy += c[1] - a[1];
    await at("touchMove", fx, fy, Date.now() / 1000);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  }
  [x1, y1] = [fx, fy];
  const t2 = Math.max(Date.now() / 1000, t1 + steps * 0.03);
  await at("touchMove", x1, y1, t2 + 0.2);
  await at("touchEnd", 0, 0, t2 + 0.21);
  await settle();
  return mid;
};

/** The view framing square `i` (the director's glide, as the game frames things), settled. */
const frame = async (i, mm = 420) => {
  await p.evaluate(
    async ([i, mm]) => {
      const w = window.woodrail;
      const { frameDistance } = await import("/src/game/camera-director.ts");
      const g = w.world.landscape.grid;
      const t = w.controls.target.clone().set(g.centreX(g.colOf(i)), g.groundY(i), g.centreZ(g.rowOf(i)));
      w.director.glideTo(t, frameDistance(mm, w.camera.fov, w.camera.aspect), { duration: 0.3 });
    },
    [i, mm],
  );
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await settle();
};
/** Square `i`'s middle (at height `up` mm) on screen. */
const onScreen = (i, up = 4) =>
  p.evaluate(
    ([i, up]) => {
      const w = window.woodrail;
      const g = w.world.landscape.grid;
      const v = new w.camera.position.constructor(g.centreX(g.colOf(i)), g.groundY(i) + up, g.centreZ(g.rowOf(i))).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    },
    [i, up],
  );
/** The town as it stands: every house facing a street?, the house's squares and storeys, street squares. */
const town = (house) =>
  p.evaluate((house) => {
    const w = window.woodrail;
    const land = w.world.landscape;
    const g = land.grid;
    const t = land.towns[0];
    const E = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const nb = (i, e) => g.index(g.colOf(i) + E[e][0], g.rowOf(i) + E[e][1]);
    const facing = t.buildings.every((b) => b.front === undefined || b.cells.some((i) => g.surface[nb(i, b.front)] === 2));
    const b = t.buildings.find((x) => x.id === house);
    const prop = [...w.world.props.all()].find((q) => q.building === house);
    return { facing, buildings: t.buildings.length, cells: b ? [...b.cells] : null, storeys: prop?.storeys ?? 0, streets: t.cells.filter((i) => g.surface[i] === 2).length };
  }, house);

// 1. A new game, Larkfield grown to a town (its houses up a storey or two).
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
/** (Harness shortcut: Larkfield's deliveries, as a train's would count them; see the top.) */
const grow = async (planks, level) => {
  await p.evaluate((n) => {
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    w.economy.delivered.set(t.id, n);
    w.economy.deliveredGoods.set(t.id, { ...(w.economy.deliveredGoods.get(t.id) ?? {}), planks: n });
    w.invalidate();
  }, planks);
  await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  // The "grew! Pick one" sheet closed (✕): its offer waits with a badge, out of the way.
  await p.waitForTimeout(600);
  await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
  await p.waitForFunction(() => document.querySelector(".growth-sheet")?.hidden !== false, null, { timeout: 10000 }).catch(() => {});
  await settle();
};
await grow(12, 2);

// 2. A house to move: a stacked one, and a free lot of its town to take it to (no swap).
const plan = await p.evaluate(async () => {
  const w = window.woodrail;
  const { lotFor } = await import("/src/game/town-moves.ts");
  const { LandEditor } = await import("/src/landscape/edit.ts");
  const { propsInRect } = await import("/src/props/placement.ts");
  const land = w.world.landscape;
  const g = land.grid;
  const t = land.towns[0];
  const ed = new LandEditor(land, w.world.layout, { inRect: (a, b, c, d) => propsInRect(w.props, w.propLibrary.footprint, a, b, c, d) });
  const props = [...w.world.props.all()].filter((q) => q.town === t.id && q.building !== undefined);
  const tried = [];
  for (const q of props.sort((a, b) => (b.storeys ?? 0) - (a.storeys ?? 0))) {
    const b = t.buildings.find((x) => x.id === q.building);
    if (!b || b.landmark || b.cells.length !== 1) continue;
    for (let i = 0; i < g.cellCount; i++) {
      const d = Math.hypot(g.centreX(g.colOf(i)) - g.centreX(g.colOf(b.cells[0])), g.centreZ(g.rowOf(i)) - g.centreZ(g.rowOf(b.cells[0])));
      if (d < 100 || d > 260) continue;
      const lot = lotFor(land, b.id, i, ed);
      if (typeof lot === "object" && lot.swap === undefined) return { house: b.id, from: b.cells[0], to: i, storeys: q.storeys ?? 0, prop: { x: q.x, y: q.y, z: q.z } };
    }
    tried.push(b.id);
  }
  return { tried };
});
check("a stacked house and a free lot of its town to move it to", plan.house !== undefined && plan.storeys > 0, JSON.stringify(plan));
await frame(plan.from);
await shot("1-before");
const before = await town(plan.house);
// The finger on the house (its middle, a little up its walls), drawn to the lot. (A town's house is held half a
// finger-lift above the finger: the finger goes that much below the lot.)
const houseAt = await p.evaluate(({ x, y, z }) => {
  const w = window.woodrail;
  const v = new w.camera.position.constructor(x, y + 14, z).project(w.camera);
  const r = w.canvas.getBoundingClientRect();
  return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
}, plan.prop);
const lotAt = await onScreen(plan.to);
const houseMid = await fingerDrag(houseAt, [lotAt[0], lotAt[1] + 28], plan.to);
const moved = await town(plan.house);
check("a finger drags the house (drag-prop)", houseMid === "drag-prop", houseMid);
check("the house moved onto another lot of its town", moved.cells && moved.cells[0] !== plan.from, JSON.stringify({ was: plan.from, now: moved.cells, aimed: plan.to }));
check("…keeping its storeys", moved.storeys === plan.storeys, `${plan.storeys} → ${moved.storeys}`);
check("…and every house still faces a street", moved.facing);
await shot("2-house-moved");

// 3. A street to move: one of Larkfield's street pieces onto a town green beside another of its streets.
const street = await p.evaluate(async () => {
  const w = window.woodrail;
  const { streetFor } = await import("/src/game/street-moves.ts");
  const { LandEditor } = await import("/src/landscape/edit.ts");
  const { propsInRect } = await import("/src/props/placement.ts");
  const land = w.world.landscape;
  const g = land.grid;
  const t = land.towns[0];
  const ed = new LandEditor(land, w.world.layout, { inRect: (a, b, c, d) => propsInRect(w.props, w.propLibrary.footprint, a, b, c, d) });
  const streets = t.cells.filter((i) => g.surface[i] === 2);
  const greens = t.cells.filter((i) => g.surface[i] === 3 && g.feature[i] === 0);
  for (const to of greens)
    for (const from of streets) {
      const d = Math.hypot(g.centreX(g.colOf(to)) - g.centreX(g.colOf(from)), g.centreZ(g.rowOf(to)) - g.centreZ(g.rowOf(from)));
      if (d < 100 || d > 300) continue;
      const lot = streetFor(land, t, from, to, ed);
      if (typeof lot === "object") return { from, to, turns: lot.turns.length };
    }
  return { greens: greens.length, streets: streets.length };
});
check("a street piece and a green it can go to", street.from !== undefined, JSON.stringify(street));
if (street.from === undefined) {
  console.log(`${failures} FAILED`);
  await b.close();
  await server.close();
  process.exit(1);
}
await frame(street.from);
const s0 = await onScreen(street.from);
const s1 = await onScreen(street.to);
// (A road piece in the hand is held over the square a finger-lift above the finger: the finger goes that much below.)
const streetMid = await fingerDrag(s0, [s1[0], s1[1] + 56], street.to);
const after = await p.evaluate(({ from, to }) => {
  const g = window.woodrail.world.landscape.grid;
  return { to: [g.surface[to], g.road[to]], from: [g.surface[from], g.road[from]] };
}, street);
check("a finger drags the street (drag-road)", streetMid === "drag-road", streetMid);
check("the street is on the green now (a street square, with a road piece)", after.to[0] === 2 && after.to[1] !== 0, JSON.stringify(after));
check("…and its old square is a town green", after.from[0] === 3 && after.from[1] === 0, JSON.stringify(after));
const t2 = await town(plan.house);
check("every house still faces a street", t2.facing);
const track = await p.evaluate(async (from) => {
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
  const w = window.woodrail;
  const land = w.world.landscape;
  const g = land.grid;
  const c = checkPlacement(land, "straight-54", false, { x: g.centreX(g.colOf(from)) - 27, z: g.centreZ(g.rowOf(from)), heading: 0 }, g.groundY(from));
  return c.kind === "blocked" ? c.reason : "clear";
}, street.from);
check("the square the street left takes track (not refused as town)", track !== "town", track);
await shot("3-street-moved");

// 4. Undo puts the street back; redo moves it again.
await p.evaluate(() => window.woodrail.editor().undo());
await settle();
const surf = () => p.evaluate(({ from, to }) => {
  const g = window.woodrail.world.landscape.grid;
  return { to: g.surface[to], from: g.surface[from] };
}, street);
const undone = await surf();
check("undo puts the street back on its square", undone.from === 2 && undone.to !== 2, JSON.stringify(undone));
await p.evaluate(() => window.woodrail.editor().redo());
await settle();
const redone = await surf();
check("redo moves it again", redone.from === 3 && redone.to === 2, JSON.stringify(redone));

// 5. The town grows on: new houses, each facing a street; the moved house keeps its storeys. (Harness shortcut, as at
// the top: what Larkfield wants for its next size counted as delivered.)
await p.evaluate(async () => {
  const w = window.woodrail;
  const { townStatus } = await import("/src/game/towns.ts");
  const t = w.world.landscape.towns[0];
  const got = { ...(w.economy.deliveredGoods.get(t.id) ?? {}) };
  const st = townStatus(got);
  for (const [k, n] of Object.entries(st.wants)) got[k] = (got[k] ?? 0) + n;
  w.economy.deliveredGoods.set(t.id, got);
  w.economy.delivered.set(t.id, Object.values(got).reduce((a, b) => a + b, 0));
  w.invalidate();
});
await p.waitForFunction((n) => window.woodrail.world.landscape.towns[0].buildings.length > n, t2.buildings, { timeout: 30000 }).catch(() => {});
await p.waitForTimeout(800);
const t3 = await town(plan.house);
check("the town grew on after the moves (more houses)", t3.buildings > t2.buildings, `${t2.buildings} → ${t3.buildings}`);
check("…every house faces a street", t3.facing);
check("…the moved house has its storeys still (or more)", t3.storeys >= plan.storeys, `${plan.storeys} → ${t3.storeys}`);
await shot("4-grown");

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
