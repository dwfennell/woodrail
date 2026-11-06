// End-to-end: secrets on the map (spec 2026-11-05, "Secret sites"; src/game/secrets.ts), Game mode on a 390×844 phone
// with touch, on the starter map (its start has one secret: the castle).
//   1. The secret stands hidden in its mist on the land; a tap on it opens its ❔ card: a guess at what it is, and
//      "Lay track to it". The planned secrets: six, the rest on land for sale, the Add land card saying one's hidden.
//   2. Idle with it in view: 0 frames drawn.
//   3. Setup (a named shortcut, not what's tested): a line from a town's station to three squares short of its halt's
//      open end, laid by the balance player (`play`, the game's own rules), and Passengers learned.
//   4. The player's step: a Long straight from the tray, tapped down at the line's end. The secret is found: its toast,
//      the site restored (drawn as its halt's kit, no longer in the mist), its halt laid as real track and joined to the
//      line, a stop from now on, fixed (it can't be taken up).
//   5. Setup: a coach train put on the line by the town's station (the sim), riders waiting there. The player taps the
//      engine and Go: riders ride out to the secret's halt, get off and pay twice the fare: tourist trips, counted on
//      the site and in all.
//   6. A tap on the site opens its halt's card: its trips, this year and the fares, the Exploring sticker's progress,
//      the towns its tourists came from.
//   7. The 25th trip earns Day tripper (setup: the count before it set to 24; the counting is the unit tests').
//   8. A reload: still found, its halt there, its trips kept. No errors on the page.
//
// Usage: npm run e2e:secrets [-- <out dir>]   (default out: e2e-out/secrets)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/secrets";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5431, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
pinClocksIn(b);
stillIndustriesIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  window.__allClicks = 0;
  window.addEventListener("click", () => window.__allClicks++, { capture: true });
});
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
let failures = 0;
let checks = 0;
const check = (what, ok, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const screenOf = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y ?? 0, v.z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return [r.left + ((c.x + 1) / 2) * r.width, r.top + ((1 - c.y) / 2) * r.height];
  }, v);
const look = async (v, dist, phi) => {
  await p.evaluate(
    ([v, dist, phi]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      if (phi !== undefined && w.lookAt) w.lookAt(new V(v.x, 0, v.z), dist, phi);
      else w.director.glideTo(new V(v.x, 0, v.z), dist, { duration: 0.1 });
      w.invalidate();
    },
    [v, dist, phi],
  );
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await settle();
};
/** A button by selector, once it's drawn and has stood still past the card tap guard: tapped by touch. */
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
/** A tray item by its key, opening shelves for it as a player would; its middle on screen. */
const trayItem = async (key) => {
  const find = () => p.evaluate((key) => { const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`); if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, key);
  const pressAt = async (sel, k = 0) => {
    const r = await p.evaluate(([sel, k]) => { const e = document.querySelectorAll(sel)[k]; if (!e) return null; e.scrollIntoView({ inline: "center" }); const q = e.getBoundingClientRect(); return [q.x + q.width / 2, q.y + q.height / 2]; }, [sel, k]);
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
const enterGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
};
/** A point of the secret's frame in the world (its halt's start `piece`, its frame from `frameOf`). */
const sitePoint = (fx, fz) =>
  p.evaluate(async ([fx, fz]) => {
    const { frameOf, frameToWorld } = await import("/src/landscape/secrets.ts");
    const s = window.woodrail.landscape.secrets[0];
    return frameToWorld(frameOf(s.piece), fx, fz);
  }, [fx, fz]);

await p.goto(PAGE);
await enterGame();
// What the game says.
await p.evaluate(() => {
  const h = window.woodrail.hud;
  window.__said = [];
  const f = h.toast.bind(h);
  h.toast = (m, ...a) => (m && window.__said.push(m), f(m, ...a));
});
const said = () => p.evaluate(() => window.__said.splice(0));

// ---- 1. Hidden, in its mist; its card -------------------------------------------------------------------------------
const start = await p.evaluate(async () => {
  const w = window.woodrail;
  const land = w.landscape;
  const s = land.secrets?.[0];
  const plan = (land.secretPlan ?? []).filter((q) => !q.alt);
  const { describeLand } = await import("/src/game/map-sites.ts");
  const { landForSale } = await import("/src/game/world.ts");
  const elsewhere = plan.find((q) => !land.grid.hasPlot(q.px, q.pz));
  return { site: s ? { kind: s.kind, found: !!s.found } : null, planned: plan.map((q) => q.kind).sort(), inStart: (land.secrets ?? []).length, landCard: elsewhere ? describeLand(landForSale(land, elsewhere.px, elsewhere.pz)) : "" };
});
check("1. the starter map plans six secrets, one in its start (hidden)", start.planned.length === 6 && start.inStart === 1 && start.site && !start.site.found, JSON.stringify(start));
check("1. …the land for sale with one says something lies hidden there", start.landCard.includes("Something lies hidden here"), start.landCard);
const middle = await sitePoint(0, -10);
await look(middle, 900, 0.95);
await p.waitForFunction((k) => (window.woodrail.invalidate(), !!window.woodrail.propLibrary.model(`secret-${k}-hidden`)), start.site?.kind, { timeout: 60000, polling: 500 }).catch(() => {});
await settle();
const drawnHidden = await p.evaluate(() => {
  let n = 0;
  window.woodrail.secretsView.group.traverse((o) => o.isMesh && n++);
  return n;
});
check("1. the hidden site is drawn (its model in the mist)", drawnHidden > 0, `${drawnHidden} meshes`);
await shot("1-hidden");
{
  const [x, y] = await screenOf({ ...middle, y: 20 });
  await p.touchscreen.tap(x, y);
  await p.waitForFunction(() => !!document.querySelector(".secret-card:not([hidden])"), null, { timeout: 15000 }).catch(() => {});
  const card = await p.evaluate(() => ({ title: document.querySelector(".secret-card .card-title")?.textContent ?? "", text: document.querySelector(".secret-card .secret-hint")?.textContent ?? "" }));
  check("1. a tap on it opens its ❔ card: a guess, and lay track to find it", card.title.startsWith("❔") && card.title.endsWith("?") && card.text.includes("Lay track to it"), JSON.stringify(card));
  await shot("1-hidden-card");
  await tap(".secret-card .close");
}

// ---- 2. Idle with it in view ----------------------------------------------------------------------------------------
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 20000))]);
  const n0 = w.framesDrawn;
  await new Promise((r) => setTimeout(r, 3000));
  return w.framesDrawn - n0;
});
check("2. 0 frames drawn idle with the hidden site in view", idle === 0, `${idle} frames`);

// ---- 3. Setup: a line to three squares short of its halt ------------------------------------------------------------
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const { frameOf, frameToWorld } = await import("/src/landscape/secrets.ts");
  const w = window.woodrail;
  w.learn("passengers");
  w.progress().coins += 500;
  const s = w.landscape.secrets[0];
  const f = frameOf(s.piece);
  // A straight of the line's own, put down by the editor out along the halt's line (from 540 to 324 short of the
  // site's frame origin, so its end is three squares short of the halt's start): the balance player lays track to it.
  const a = frameToWorld(f, -540, 170);
  const end = w.editor().place("straight-216", { x: a.x, z: a.z, heading: f.heading }, 0, false);
  if (end === -1) return { error: "no room for the line's last straight" };
  // (Towns tried in an order whose lines keep clear of the site on this map: the first town's wanders past it.)
  let r = null;
  for (const id of [1, 3, 0, 2]) {
    const station = w.world.stations.get(id);
    for (const k of [0, 1]) {
      r = play(w.world.layout, w.editor(), connectorRef(station, k), connectorRef(end, 0), { blocked: rulesFor(w.world), maxPieces: 90, fiddle: 3 });
      if (s.found) return { error: "the setup's line found it" };
      if (r.ok && w.layout.joinedConnector(connectorRef(end, 0)) !== -1) return { town: id, station, end, found: !!s.found };
    }
  }
  return { error: `no line to it: ${r?.why ?? ""}` };
});
check("3. setup: a line from a town's station to three squares short of the halt, not yet finding it", !setup.error && !setup.found, JSON.stringify(setup));

// ---- 4. The player lays the last straight: found ---------------------------------------------------------------------
const lineEnd = await sitePoint(-324, 170);
await look(lineEnd, 700, 0.9);
await said();
const item = await trayItem("piece:straight-216");
check("4. a Long straight on the tray", !!item);
if (item) {
  // Dragged by touch from the tray to the line's end (a held piece rides a little above the finger: aimed below it).
  const at = await sitePoint(-216, 170);
  const [tx, ty] = await screenOf(at);
  let t = Date.now() / 1000;
  await touch("touchStart", item[0], item[1], t);
  for (let k = 1; k <= 16; k++) await touch("touchMove", item[0] + ((tx - item[0]) * k) / 16, item[1] + ((ty + 56 - item[1]) * k) / 16, (t += 0.04));
  await p.waitForTimeout(400);
  await frames();
  await shot("4-held");
  await touch("touchEnd", 0, 0, (t += 0.05));
  await frames();
  await p.waitForTimeout(800);
  await settle();
}
const found = await p.evaluate(async () => {
  const w = window.woodrail;
  const { haltPieceOf } = await import("/src/game/secrets.ts");
  const { connectorRef, pieceOfRef } = await import("/src/track/layout.ts");
  const s = w.landscape.secrets[0];
  const halt = haltPieceOf(w.layout, s);
  const joined = halt === undefined ? -1 : w.layout.joinedConnector(connectorRef(halt, 0));
  const before = halt === undefined ? null : w.layout.getPiece(pieceOfRef(joined))?.type ?? null;
  const d = halt === undefined ? null : w.economy.depotAtPiece(halt);
  let hidden = 0;
  w.secretsView.group.traverse((o) => o.isMesh && o.count > 0 && hidden++);
  return { found: !!s.found, halt: halt ?? null, type: halt === undefined ? null : w.layout.getPiece(halt).type, before, stop: d ? { role: d.role, lookout: w.economy.isLookout(d) } : null };
});
const msgs = await said();
check("4. a Long straight laid at the line's end finds it: the toast", msgs.some((m) => m.includes("found!")), JSON.stringify(msgs));
check("4. …its halt laid as a kit piece, joined to the player's straight, a stop where riders get off", found.found && found.type === `kit-secret-${start.site?.kind}` && found.before === "straight-216" && found.stop?.role === "town" && found.stop.lookout, JSON.stringify(found));
await p.waitForFunction((k) => (window.woodrail.invalidate(), !!window.woodrail.propLibrary.model(`kit:kit-secret-${k}`)), start.site?.kind, { timeout: 60000, polling: 500 }).catch(() => {});
await look(middle, 900, 0.95);
const drawn = await p.evaluate(() => {
  const w = window.woodrail;
  let kits = 0;
  w.kitView.group.traverse((o) => o.isMesh && kits++);
  return { kits, model: !!w.propLibrary.model(`kit:kit-secret-${w.landscape.secrets[0].kind}`) };
});
check("4. …drawn restored (its found model with the kits)", drawn.model && drawn.kits > 0, JSON.stringify(drawn));
await shot("4-found");
// Fixed, as a station is: the game names it, so it can't be picked up, moved or taken up.
const fixed = await p.evaluate((halt) => window.woodrail.interaction.fixedLabel(halt), found.halt);
check("4. …and fixed, as a station is", typeof fixed === "string" && fixed.endsWith("halt"), JSON.stringify(fixed));

// ---- 5. A coach train, Go: tourists ride out ------------------------------------------------------------------------
const train = await p.evaluate(async ({ station }) => {
  const w = window.woodrail;
  const before = new Set(w.sim.trainIds());
  let placed = { kind: "none" };
  for (const s of [40, 120]) {
    placed = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: station, pathIndex: 0, reversed: false, s });
    if (placed.kind === "placed") break;
    placed = w.sim.addTrain(["engine", "passenger", "passenger"], { pieceId: station, pathIndex: 0, reversed: true, s });
    if (placed.kind === "placed") break;
  }
  if (placed.kind !== "placed") return { error: placed.kind };
  const id = w.sim.trainIds().find((t) => !before.has(t));
  const d = w.economy.depotAtPiece(station);
  d.waiting = 6;
  w.invalidate();
  return { engine: w.sim.getTrain(id).cars.find((c) => c.kind === "engine").id, coins: w.progress().coins };
}, setup);
check("5. setup: a coach train at the town's station, riders waiting", !train.error, JSON.stringify(train));
if (!train.error) {
  const carAt = () =>
    p.evaluate((id) => {
      const w = window.woodrail;
      const o = w.trainView.carObject(id);
      if (!o) return null;
      const v = o.getWorldPosition(new w.camera.position.constructor());
      return { x: v.x, z: v.z };
    }, train.engine);
  await p.waitForFunction((id) => (window.woodrail.invalidate(), !!window.woodrail.trainView.carObject(id)), train.engine, { timeout: 30000, polling: 300 }).catch(() => {});
  const at = await carAt();
  if (at) await look(at, 520);
  const on = at && (await screenOf({ ...(await carAt()), y: 20 }));
  if (on) await p.touchscreen.tap(on[0], on[1]);
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  await tap(".engine-card .chip.go");
  const going = await p.waitForFunction((id) => window.woodrail.sim.findCar(id)?.train.speed > 0, train.engine, { timeout: 30000 }).then(() => true, () => false);
  check("5. the engine tapped, Go: it sets off", going);
  await p.keyboard.press("Escape");
  const trips = await p
    .waitForFunction(() => (window.woodrail.landscape.secrets[0].trips ?? 0) >= 2, null, { timeout: 300000, polling: 1000 })
    .then(() => true, () => false);
  const t = await p.evaluate(() => {
    const w = window.woodrail;
    const s = w.landscape.secrets[0];
    return { trips: s.trips ?? 0, fares: s.fares ?? 0, from: s.from ?? {}, all: w.progress().counts.get("tourists") ?? 0, coins: w.progress().coins };
  });
  check("5. riders get off at the secret's halt: tourist trips, counted on it and in all, paid", trips && t.all === t.trips && t.fares > 0 && t.coins > train.coins && Object.keys(t.from).length > 0, JSON.stringify(t));
  // A train at the halt: in the picture.
  await p.waitForFunction(async () => {
    const w = window.woodrail;
    const halt = [...w.layout.pieceIds()].find((id) => w.layout.getPiece(id).type.startsWith("kit-secret-"));
    return w.sim.pieceOccupied(halt);
  }, null, { timeout: 120000, polling: 500 }).catch(() => {});
  const haltMid = await sitePoint(0, 170);
  await look({ x: haltMid.x, z: haltMid.z }, 700, 0.85);
  await shot("5-train-at-halt");
}

// ---- 6. Its halt's card --------------------------------------------------------------------------------------------
{
  await look(middle, 900, 0.95);
  const [x, y] = await screenOf({ ...middle, y: 30 });
  await p.touchscreen.tap(x, y);
  await p.waitForFunction(() => !!document.querySelector(".secret-card.found:not([hidden])"), null, { timeout: 15000 }).catch(() => {});
  const card = await p.evaluate(() => {
    const q = (s) => document.querySelector(`.secret-card ${s}`)?.textContent ?? "";
    return { title: q(".card-title"), trips: q(".secret-trips"), year: q(".secret-year"), tier: q(".secret-tier"), towns: [...document.querySelectorAll(".secret-card .secret-town")].length };
  });
  const trips = await p.evaluate(() => window.woodrail.landscape.secrets[0].trips ?? 0);
  check("6. a tap on the found site opens its halt's card: its trips, this year and fares, the sticker's progress, the towns", card.title.endsWith("halt") && Number(card.trips.replace(/,/g, "")) === trips && card.year.includes("this year") && card.tier.includes("Day tripper") && card.towns >= 1, JSON.stringify(card));
  await shot("6-halt-card");
  await tap(".secret-card .close");
}

// ---- 7. The 25th trip: Day tripper ---------------------------------------------------------------------------------
await p.evaluate(() => {
  const w = window.woodrail;
  w.progress().counts.set("tourists", 24);
});
const earned = await p.waitForFunction(() => window.woodrail.stickers().has("day-tripper"), null, { timeout: 300000, polling: 1000 }).then(() => true, () => false);
check("7. the 25th tourist trip earns Day tripper", earned, JSON.stringify(await p.evaluate(() => window.woodrail.progress().counts.get("tourists"))));

// ---- 8. A reload ---------------------------------------------------------------------------------------------------
const kept = await p.evaluate(() => window.woodrail.landscape.secrets[0].trips ?? 0);
await p.evaluate(() => window.woodrail.sim.trainIds().forEach((id) => window.woodrail.sim.setLever(window.woodrail.sim.getTrain(id).cars.find((c) => c.kind === "engine")?.id ?? -1, 0)));
await p.waitForTimeout(3000); // (saved)
await p.reload();
await enterGame();
const back = await p.evaluate(async () => {
  const w = window.woodrail;
  const { haltPieceOf } = await import("/src/game/secrets.ts");
  const s = w.landscape.secrets[0];
  return { found: !!s.found, trips: s.trips ?? 0, halt: haltPieceOf(w.layout, s) !== undefined };
});
check("8. after a reload: still found, its halt there, its trips kept", back.found && back.halt && back.trips >= kept, JSON.stringify({ back, kept }));
check("no errors on the page", errors.length === 0, errors.slice(0, 3).join(" | "));

console.log(`${checks - failures}/${checks} passed`);
await b.close();
await server.close();
process.exit(failures > 0 ? 1 : 0);
