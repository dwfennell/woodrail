// End-to-end: a moved house's old square takes track (`npm run e2e:moved-house [-- <out dir>]`), on a 390×844 phone
// with touch, in Game mode. A new game; one of Larkfield's houses dragged by finger onto another lot of its town; the
// square it left is a town green, not a house: a Long straight from the tray, dragged by finger across it, is laid
// there (no "That's a house" refusal), and a train set going on it runs over the square. The other way round: another
// house dragged onto that square, with the track on it now, is refused and stays where it stood. Then the town grows
// onto the green the moved house left, and Undo of the move is refused (it would put two houses on one square), the
// squares still whole: every square marked a house is one house's, and each house's squares are marked its.
//
// Harness shortcuts (named, not the thing under test): the town's growth is set going by its deliveries count, as
// `e2e:town-drag` does; the train is put on the laid straight by `sim.addTrain` (setup: what's checked is that it runs
// across the square), then set going by a tap on it and Go. The drags are real touches, stamped (CDP
// `Input.dispatchTouchEvent`).
// Starts its own dev server (on 5386, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/moved-house";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5386, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
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
const done = async () => {
  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
  await b.close();
  await server.close();
  process.exit(failures === 0 ? 0 : 1);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });

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
/** A point of the world on screen. */
const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y ?? 0, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
/** The view over square `i`, from `mm` away at a slant (`lookAt`: the camera's turn kept), settled. */
const frame = async (i, mm = 420) => {
  await p.evaluate(
    ([i, mm]) => {
      const w = window.woodrail;
      const g = w.world.landscape.grid;
      w.lookAt(new w.camera.position.constructor(g.centreX(g.colOf(i)), g.groundY(i), g.centreZ(g.rowOf(i))), mm, 0.6);
    },
    [i, mm],
  );
  await settle();
};

/**
 * A finger put down on a house at a, held still a moment (past the hold, to take hold), then drawn to b in small
 * steps and lifted, nudged by eye onto square `target` first. Returns the interaction's mode on the way.
 */
const houseDrag = async ([x0, y0], [x1, y1], target) => {
  const t0 = Date.now() / 1000;
  await touch("touchStart", x0, y0, t0);
  await p.waitForTimeout(700);
  await frames();
  const t1 = Date.now() / 1000;
  let mid = "";
  const steps = 16;
  for (let k = 1; k <= steps; k++) {
    await touch("touchMove", x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps, t1 + k * 0.03);
    if (k === steps / 2) mid = await p.evaluate(() => window.woodrail.interaction.mode.kind);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
  let [fx, fy] = [x1, y1];
  for (let k = 0; k < 4; k++) {
    const under = await p.evaluate(() => {
      const m = window.woodrail.interaction.mode;
      return m.kind === "drag-prop" ? (m.town?.cell ?? -1) : -1;
    });
    if (under === target || under < 0) break;
    const [a, c] = [await onScreen(under), await onScreen(target)];
    fx += c[0] - a[0];
    fy += c[1] - a[1];
    await touch("touchMove", fx, fy, Date.now() / 1000);
    await frames();
  }
  const t2 = Math.max(Date.now() / 1000, t1 + steps * 0.03);
  await touch("touchMove", fx, fy, t2 + 0.2);
  await touch("touchEnd", 0, 0, t2 + 0.21);
  await settle();
  return mid;
};
/** A house's prop (its middle, a little up its walls) on screen. */
const houseOnScreen = (house) =>
  p.evaluate((house) => {
    const w = window.woodrail;
    const q = [...w.world.props.all()].find((x) => x.building === house);
    const v = new w.camera.position.constructor(q.x, q.y + 14, q.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, house);
/** The town's squares whole: every square marked a house one house's, each house's squares marked its. */
const whole = () =>
  p.evaluate(() => {
    const land = window.woodrail.world.landscape;
    const g = land.grid;
    const out = [];
    const owner = new Map();
    for (const t of land.towns)
      for (const b of t.buildings)
        for (const i of b.cells) {
          if (owner.has(i)) out.push(`square ${i}: houses ${owner.get(i)} and ${b.id}`);
          owner.set(i, b.id);
          if (g.feature[i] !== 2 || g.owner[i] !== b.id) out.push(`house ${b.id}'s square ${i} unmarked`);
        }
    for (let i = 0; i < g.cellCount; i++) if (g.feature[i] === 2 && !owner.has(i)) out.push(`square ${i} marked a house with none`);
    return out;
  });
/** A tray item by its key, opening shelves for it as a player would: its middle on screen. */
const trayItem = async (key) => {
  const find = () =>
    p.evaluate((key) => {
      const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
      if (!e) return null;
      e.scrollIntoView({ inline: "center" });
      const q = e.getBoundingClientRect();
      return [q.x + q.width / 2, q.y + q.height / 2];
    }, key);
  const pressAt = async (sel, k = 0) => {
    const r = await p.evaluate(
      ([sel, k]) => {
        const e = document.querySelectorAll(sel)[k];
        if (!e) return null;
        e.scrollIntoView({ inline: "center" });
        const q = e.getBoundingClientRect();
        return [q.x + q.width / 2, q.y + q.height / 2];
      },
      [sel, k],
    );
    if (r) await p.touchscreen.tap(r[0], r[1]);
    await frames();
    return !!r;
  };
  for (let k = 0; k < 24; k++) {
    const r = await find();
    if (r) return r;
    if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) await pressAt(".scroller .tray-back");
    if (!(await pressAt(".scroller .tray-group", k))) return null;
  }
  return null;
};
/** A button by selector, once drawn and still past the card tap guard: tapped by touch. */
const tap = async (sel) => {
  const ok = await p.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0), sel, { timeout: 20000 }).then(() => true, () => false);
  if (!ok) return false;
  await frames();
  await p.waitForTimeout(400);
  const [x, y] = await p.evaluate((sel) => {
    const r = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);
  await p.touchscreen.tap(x, y);
  await frames();
  return true;
};

// 1. A new game, Larkfield grown to a town.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
await p.evaluate(() => {
  const h = window.woodrail.hud;
  window.__said = [];
  const f = h.toast.bind(h);
  h.toast = (m, ...a) => (m && window.__said.push(m), f(m, ...a));
  const r = h.refuse.bind(h);
  h.refuse = (m, ...a) => (m && window.__said.push(m), r(m, ...a));
});
const said = () => p.evaluate(() => window.__said.splice(0));
/** (Harness shortcut: Larkfield's deliveries, as a train's would count them; see the top.) */
const grow = async (goods) => {
  const n = await p.evaluate((goods) => {
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    const got = { ...(w.economy.deliveredGoods.get(t.id) ?? {}) };
    for (const [k, v] of Object.entries(goods)) got[k] = (got[k] ?? 0) + v;
    w.economy.deliveredGoods.set(t.id, got);
    w.economy.delivered.set(t.id, Object.values(got).reduce((a, b) => a + b, 0));
    w.invalidate();
    return t.buildings.length;
  }, goods);
  await p.waitForFunction((n) => window.woodrail.world.landscape.towns[0].buildings.length > n, n, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
  await settle();
};
await grow({ planks: 12 });

// 2. A house to move, a free lot of its town to take it to, and the square it leaves: one a Long straight lies across
// once it's a green, at the heading the tray gives it (the camera's: the view framed on the town), and refused as a
// house now. (Found by trying, put back at once.)
await frame(await p.evaluate(() => {
  const land = window.woodrail.world.landscape;
  return land.grid.cellAtWorld(land.towns[0].centre.x, land.towns[0].centre.z);
}), 520);
const plan = await p.evaluate(async () => {
  const w = window.woodrail;
  const { lotFor, moveBuilding } = await import("/src/game/town-moves.ts");
  const { LandEditor } = await import("/src/landscape/edit.ts");
  const { checkPlacement } = await import("/src/landscape/clearance.ts");
  const { propsInRect } = await import("/src/props/placement.ts");
  const land = w.world.landscape;
  const g = land.grid;
  const t = land.towns[0];
  const ed = new LandEditor(land, w.world.layout, { inRect: (a, b, c, d) => propsInRect(w.props, w.propLibrary.footprint, a, b, c, d) });
  const heading = w.interaction.trayHeading();
  const across = (i) => {
    const c = checkPlacement(land, "straight-216", false, { x: g.centreX(g.colOf(i)), z: g.centreZ(g.rowOf(i)), heading }, g.groundY(i));
    return c.kind === "blocked" ? c.reason : "clear";
  };
  for (const b of t.buildings) {
    if (b.landmark || b.cells.length !== 1) continue;
    const from = b.cells[0];
    if (across(from) !== "building") continue;
    for (let i = 0; i < g.cellCount; i++) {
      const d = Math.hypot(g.centreX(g.colOf(i)) - g.centreX(g.colOf(from)), g.centreZ(g.rowOf(i)) - g.centreZ(g.rowOf(from)));
      if (d < 140 || d > 300) continue;
      const lot = lotFor(land, b.id, i, ed);
      if (typeof lot !== "object" || lot.swap !== undefined) continue;
      const back = moveBuilding(land, b.id, lot);
      const after = across(from);
      back();
      if (after === "clear") return { house: b.id, from, to: i, heading };
    }
  }
  return { none: true };
});
check("setup: a house, a free lot for it, and its square a Long straight crosses once it's left (refused as a house now)", plan.house !== undefined, JSON.stringify(plan));
if (plan.house === undefined) await done();

await frame(plan.from, 700);
await shot("1-before");
const lotAt = await onScreen(plan.to);
const mid = await houseDrag(await houseOnScreen(plan.house), [lotAt[0], lotAt[1] + 28], plan.to);
const moved = await p.evaluate(({ house, from }) => {
  const land = window.woodrail.world.landscape;
  const g = land.grid;
  const b = land.towns[0].buildings.find((x) => x.id === house);
  return { cells: b.cells, from: [g.feature[from], g.surface[from]] };
}, plan);
check("a finger drags the house (drag-prop)", mid === "drag-prop", mid);
check("the house moved onto its new lot", moved.cells[0] === plan.to, JSON.stringify(moved));
check("…and the square it left is a town green (no house, town ground)", moved.from[0] === 0 && moved.from[1] === 3, JSON.stringify(moved));
check("…the town's squares whole", (await whole()).length === 0, JSON.stringify(await whole()));
await shot("2-house-moved");

// 3. A Long straight from the tray, dragged by finger across the square the house left: laid, nothing said against it.
await said();
const pieces0 = await p.evaluate(() => [...window.woodrail.world.layout.pieceIds()]);
await frame(plan.from, 520);
const item = await trayItem("piece:straight-216");
check("a Long straight on the tray", !!item);
const target = await p.evaluate((i) => {
  const g = window.woodrail.world.landscape.grid;
  return { x: g.centreX(g.colOf(i)), y: g.groundY(i), z: g.centreZ(g.rowOf(i)) };
}, plan.from);
const tray = await p.evaluate(() => window.woodrail.interaction.trayHeading());
if (item) {
  const [tx, ty] = await screenOf(target);
  let t = Date.now() / 1000;
  await touch("touchStart", item[0], item[1], t);
  for (let k = 1; k <= 16; k++) await touch("touchMove", item[0] + ((tx - item[0]) * k) / 16, item[1] + ((ty + 56 - item[1]) * k) / 16, (t += 0.04));
  // Nudged by eye: the piece in hand's middle onto the square's.
  let [fx, fy] = [tx, ty + 56];
  for (let k = 0; k < 6; k++) {
    const held = await p.evaluate(() => {
      const m = window.woodrail.interaction.mode;
      return m.kind === "drag-piece" && m.pose ? { x: m.pose.x, z: m.pose.z } : null;
    });
    if (!held || Math.hypot(held.x - target.x, held.z - target.z) < 6) break;
    const [a, c] = [await screenOf(held), await screenOf(target)];
    fx += c[0] - a[0];
    fy += c[1] - a[1];
    await touch("touchMove", fx, fy, (t += 0.05));
    await frames();
  }
  await p.waitForTimeout(400);
  await frames();
  await shot("3-held");
  // (Said as the piece crossed the town's houses on its way over: what counts is what's said once it's let go.)
  await said();
  const heldNow = await p.evaluate(async () => {
    const w = window.woodrail;
    const m = w.interaction.mode;
    if (m.kind !== "drag-piece") return { mode: m.kind };
    const { checkPlacement } = await import("/src/landscape/clearance.ts");
    const g = w.world.landscape.grid;
    const at = m.pose ? checkPlacement(w.world.landscape, m.type, !!m.flipped, m.pose, m.looseY ?? 0) : null;
    return { pose: m.pose, looseY: m.looseY, snap: m.snap?.kind, blocked: m.blocked, at, type: m.type, auto: m.auto, cell: m.pose ? g.cellAtWorld(m.pose.x, m.pose.z) : -1 };
  });
  check("held over the square the house left, the piece is clear to go down there", heldNow.blocked === null && heldNow.cell === plan.from, JSON.stringify(heldNow));
  await touch("touchEnd", 0, 0, (t += 0.05));
  await frames();
  await p.waitForTimeout(800);
  await settle();
}
const laid = await p.evaluate(
  ([before, from]) => {
    const w = window.woodrail;
    const g = w.world.landscape.grid;
    const fresh = [...w.world.layout.pieceIds()].filter((x) => !before.includes(x)).map((x) => [x, w.world.layout.getPiece(x).type]);
    const id = fresh.find(([, t]) => t === "straight-216")?.[0];
    const piece = id === undefined ? null : w.world.layout.getPiece(id);
    // Over the square: its line within a few mm of the square's middle.
    const cx = g.centreX(g.colOf(from));
    const cz = g.centreZ(g.rowOf(from));
    const off = piece ? Math.abs(-(cx - piece.pose.x) * Math.sin(piece.pose.heading) + (cz - piece.pose.z) * Math.cos(piece.pose.heading)) : null;
    const along = piece ? Math.abs((cx - piece.pose.x) * Math.cos(piece.pose.heading) + (cz - piece.pose.z) * Math.sin(piece.pose.heading)) : null;
    return { id: id ?? null, off, along, pose: piece?.pose };
  },
  [pieces0, plan.from],
);
const words = await said();
check("the Long straight is laid across the square the house left", laid.id !== null && laid.off < 36 && laid.along < 108, JSON.stringify({ laid, tray }));
check("…not refused as a house", !words.some((m) => m.includes("house")), JSON.stringify(words));
await shot("3-laid");

// 4. A train on it, set going by a tap and Go: it runs across the square.
if (laid.id === null) await done();
const train = await p.evaluate((id) => {
  const w = window.woodrail;
  const before = new Set(w.sim.trainIds());
  let placed = { kind: "none" };
  for (const s of [40, 60, 30, 80]) {
    placed = w.sim.addTrain(["engine"], { pieceId: id, pathIndex: 0, reversed: false, s });
    if (placed.kind === "placed") break;
  }
  if (placed.kind !== "placed") return { error: placed.kind };
  const tid = w.sim.trainIds().find((x) => !before.has(x));
  w.invalidate();
  return { engine: w.sim.getTrain(tid).cars.find((c) => c.kind === "engine").id };
}, laid.id);
check("setup: an engine on the laid straight's end", !train.error, JSON.stringify(train));
if (!train.error) {
  const carAt = () =>
    p.evaluate((id) => {
      const w = window.woodrail;
      const o = w.trainView.carObject(id);
      if (!o) return null;
      const v = o.getWorldPosition(new w.camera.position.constructor());
      return { x: v.x, y: v.y, z: v.z, cell: w.world.landscape.grid.cellAtWorld(v.x, v.z) };
    }, train.engine);
  await p.waitForFunction((id) => (window.woodrail.invalidate(), !!window.woodrail.trainView.carObject(id)), train.engine, { timeout: 30000, polling: 300 }).catch(() => {});
  const at = await carAt();
  const on = at && (await screenOf({ ...at, y: at.y + 10 }));
  if (on) await p.touchscreen.tap(on[0], on[1]);
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  await tap(".engine-card .chip.go");
  const crossed = await p
    .waitForFunction(
      ([id, from]) => {
        const w = window.woodrail;
        const o = w.trainView.carObject(id);
        if (!o) return false;
        const v = o.getWorldPosition(new w.camera.position.constructor());
        return w.world.landscape.grid.cellAtWorld(v.x, v.z) === from;
      },
      [train.engine, plan.from],
      { timeout: 60000, polling: 100 },
    )
    .then(() => true, () => false);
  check("the engine, tapped and set going, runs over the square the house left", crossed, JSON.stringify(await carAt()));
  await shot("4-train");
  await p.keyboard.press("Escape");
}

// 5. The other way round: another house of the town dragged onto that square (track on it now) is refused, and stays.
const other = await p.evaluate((plan) => {
  const g = window.woodrail.world.landscape.grid;
  const t = window.woodrail.world.landscape.towns[0];
  const d = (i) => Math.hypot(g.colOf(i) - g.colOf(plan.from), g.rowOf(i) - g.rowOf(plan.from));
  const b = t.buildings.filter((x) => x.id !== plan.house && !x.landmark && x.cells.length === 1).sort((a, b) => d(a.cells[0]) - d(b.cells[0]))[0];
  return b ? { house: b.id, cells: [...b.cells] } : null;
}, plan);
check("setup: another house of the town", !!other);
if (other) {
  // (The engine card and the "piece waiting at the end" offer put away first: a tap on the map ends that.)
  await p.keyboard.press("Escape");
  await frame(other.cells[0], 900);
  await p.touchscreen.tap(195, 300);
  await settle();
  await said();
  const to = await onScreen(plan.from);
  const held = await houseDrag(await houseOnScreen(other.house), [to[0], to[1] + 28], plan.from);
  check("a finger takes the other house (drag-prop)", held === "drag-prop", held);
  const stayed = await p.evaluate((o) => window.woodrail.world.landscape.towns[0].buildings.find((x) => x.id === o.house).cells, other);
  const told = await said();
  check("a house can't be put down on the track: it stays on its own lot", JSON.stringify(stayed) === JSON.stringify(other.cells), JSON.stringify({ stayed, was: other.cells }));
  check("…the player told why", told.some((m) => /track/i.test(m)), JSON.stringify(told));
  check("…the square still a green with the track on it", await p.evaluate(([from, id]) => window.woodrail.world.landscape.grid.feature[from] === 0 && !!window.woodrail.world.layout.getPiece(id), [plan.from, laid.id]));
  await shot("5-refused");
}

// 6. The town grows onto the greens its moves left; Undo of the house move is refused then (else two houses on one
// square), and the squares stay whole. (The track taken up first by Undo, so the green is free to build on.)
// (The engine taken off by the harness: a train on the straight would hold its undo.)
await p.evaluate(() => {
  const w = window.woodrail;
  for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
  w.invalidate();
});
await p.evaluate(() => window.woodrail.editor().undo());
await settle();
const free = await p.evaluate(({ from, id }) => window.woodrail.world.landscape.grid.feature[from] === 0 && !window.woodrail.world.layout.getPiece(id), { from: plan.from, id: laid.id });
check("setup: Undo takes the straight up again, the green free", free);
await p.evaluate(async () => {
  const w = window.woodrail;
  const { townStatus } = await import("/src/game/towns.ts");
  const t = w.world.landscape.towns[0];
  const got = { ...(w.economy.deliveredGoods.get(t.id) ?? {}) };
  for (const [k, n] of Object.entries(townStatus(got).wants)) got[k] = (got[k] ?? 0) + n;
  w.economy.deliveredGoods.set(t.id, got);
  w.economy.delivered.set(t.id, Object.values(got).reduce((a, b) => a + b, 0));
  w.invalidate();
});
const built = await p
  .waitForFunction((from) => window.woodrail.world.landscape.grid.feature[from] === 2, plan.from, { timeout: 30000 })
  .then(() => true, () => false);
await p.evaluate(() => document.querySelector(".growth-sheet .close")?.click());
await settle();
check("setup: the town grew onto the green the house left", built);
if (built) {
  await said();
  const undone = await p.evaluate(() => window.woodrail.editor().undo());
  const told = await said();
  const now = await p.evaluate((house) => window.woodrail.world.landscape.towns[0].buildings.find((x) => x.id === house).cells, plan.house);
  check("Undo of the house's move is refused, said why", undone === false && told.some((m) => m.includes("built there since")), JSON.stringify({ undone, told }));
  check("…the house stays where it was moved", now[0] === plan.to, JSON.stringify(now));
  check("…and the town's squares are whole", (await whole()).length === 0, JSON.stringify(await whole()));
  await shot("6-grown");
}
await done();
