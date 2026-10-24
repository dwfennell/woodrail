// End-to-end map sites (step 1: old industries' ruins and more towns), on a phone (`npm run e2e:sites [-- <out dir>]`),
// at 390×844 with touch:
// - a new game: an old ruin is in view near the start (the starter map's old farm);
// - tapping it opens its locked card (Old farm, its fields, "Learn Farming at a school…", "Or build your own…");
// - Farming learned: a toast names the old farm ("Old farm by …"), tapped it frames it; Show me for "Open a farm" points
//   at it; its card offers Restore · 3🪵 45🪙 (no workshop: says so); Restore makes the stub a farm yard in place (its
//   depot, rate, crane and card), 3 planks from the workshop and 45 coins; Undo brings the ruin back and the price,
//   Redo restores it again; a reload keeps it restored;
// - Clear the ruin (one on the land bought) takes 10 coins, the ruin and its stub; Undo brings them back with the coins;
// - the land around shows its ruins before it's bought; a coastal plot's land card lists its towns by the sea and its
//   old sites; bought, it brings them (the ruins' stubs become track pieces, fixed);
// - idle: no frames drawn in 30 s (the ruins cost nothing while nothing changes).
// - a phone on its side (667×375): the ruin card's Restore and Clear fully in view above the tray, and tappable.
// - the map view (390×844, step 3): the old farm's marker (🌾, a lock), none over a town's or station's label; idle
//   there, no frames; Farming learned, the lock goes; tapped, the ruin's card opens; restored, its marker goes.
// - the map view on a phone on its side (667×375, 844×390): compact labels (name only), 4 of the starter map's 5 towns'
//   shown at 667×375 and all 5 at 844×390; no badge or label over another, a badge tapped (middle or edge) goes to its
//   ruin. Upright (390×844), the full labels.
// - a big map (22 plots bought, 390×844): a drag from a town's label pans the map view, and panning gets every ruin on
//   the land its badge on screen.
//
// Usage: npm run e2e:sites [-- <out dir>]   (default out: e2e-out/sites)
// Starts its own dev server (on 5384, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/sites";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5384, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
  if (m.type() === "info" && (m.text().includes("ruins built") || m.text().includes("ruin restored"))) console.log(`  (${m.text()})`);
});
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const settle = (ticks = 3) => p.evaluate((t) => Promise.race([window.woodrail.settled(t), new Promise((r) => setTimeout(r, 20000))]), ticks);
/** A tap on the page, stamped (see `stampedTap`): every tap here is one (QA: an unstamped toast tap was flaky). */
const tapAt = (x, y) => stampedTap(p, x, y);
/**
 * A tap stamped with its own time (CDP touches, 62 ms down, as deck-taps.mjs does it): on a loaded machine an unstamped
 * one can be taken as a long press or a drag by the time it's handled.
 */
const cdps = new WeakMap();
const stampedTap = async (page, x, y) => {
  if (!cdps.has(page)) cdps.set(page, await page.context().newCDPSession(page));
  const cdp = cdps.get(page);
  const t = Date.now() / 1000;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", timestamp: t, touchPoints: [{ x, y, id: 1 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", timestamp: t + 0.062, touchPoints: [] });
  await page.waitForTimeout(500);
};
/** Till the camera's glide is over (on a loaded machine "Add land"'s glide out took 34 s): taps aimed after it land. */
const glided = (page) => page.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 120000, polling: 250 }).catch(() => console.log("  (the camera was still gliding after 120 s)"));
const tap = async (selector, text) => {
  const box = await p.evaluate(
    ({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => (text === undefined || e.textContent.trim().startsWith(text)) && e.getBoundingClientRect().width > 0);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { selector, text },
  );
  if (!box) return false;
  await tapAt(box.x, box.y);
  return true;
};
/** Where a world point is on the screen (CSS px), and whether it's on it. */
const onScreen = (x, y, z) =>
  p.evaluate(
    ([x, y, z]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      const v = new V(x, y, z).project(w.camera);
      const r = w.canvas.getBoundingClientRect();
      const sx = r.left + ((v.x + 1) / 2) * r.width;
      const sy = r.top + ((1 - v.y) / 2) * r.height;
      return { x: sx, y: sy, in: v.z < 1 && sx > 0 && sx < r.width && sy > 0 && sy < r.height };
    },
    [x, y, z],
  );
/** The middle of a site's yard (depot frame t 108, l 72). */
const yardOf = (s) => {
  const c = Math.cos(s.piece.heading);
  const n = Math.sin(s.piece.heading);
  return { x: s.piece.x + c * 108 - n * 72, z: s.piece.z + n * 108 + c * 72 };
};
const look = (x, z, dist, phi = 0.8) =>
  p.evaluate(
    async ([x, z, dist, phi]) => {
      const w = window.woodrail;
      const V = w.camera.position.constructor;
      w.lookAt(new V(x, 0, z), dist, phi);
      w.invalidate();
      await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 15000))]);
    },
    [x, z, dist, phi],
  );

// 1. A new game: the starter map's ruins, the old farm in view from the start (or a short pull back).
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.waitForTimeout(1500);
const sites = await p.evaluate(() => window.woodrail.world.landscape.sites.map((s) => ({ ...s })));
check("the starter map has old sites (1 or 2), each with its stub on the layout, fixed", sites.length >= 1 && sites.length <= 2 && (await p.evaluate(() => [...window.woodrail.world.ruins.values()].every((id) => window.woodrail.layout.getPiece(id)?.type === "straight-216"))), JSON.stringify(sites.map((s) => [s.role, s.centre])));
const farm = sites.find((s) => s.role === "farm") ?? sites[0];
const yard = yardOf(farm);
const startView = await onScreen(yard.x, 20, yard.z);
check("the old farm is in view at the start", startView.in, JSON.stringify(startView));
// Whole (QA: at 390×844 it stood at the left edge, half off it): its yard, buildings and stub, the box a tap finds it in.
const farmBox = await Promise.all(
  [[-12, -30], [228, -30], [228, 130], [-12, 130]].map(([t, l]) => {
    const c = Math.cos(farm.piece.heading);
    const n = Math.sin(farm.piece.heading);
    return onScreen(farm.piece.x + c * t - n * l, 30, farm.piece.z + n * t + c * l);
  }),
);
const firstStations = await p.evaluate(() => window.woodrail.world.landscape.towns.slice(0, 2).map((t) => ({ x: t.station.x, z: t.station.z })));
const stationsAt = await Promise.all(firstStations.map((s) => onScreen(s.x, 20, s.z)));
check("…whole, with the first two towns' stations (the first goal's) in view too", farmBox.every((q) => q.in && q.x >= 4 && q.x <= 386) && stationsAt.every((q) => q.in), JSON.stringify({ farm: farmBox.map((q) => [Math.round(q.x), Math.round(q.y)]), stations: stationsAt.map((q) => [Math.round(q.x), Math.round(q.y)]) }));
const drawn = await p.evaluate(() => {
  let meshes = 0;
  window.woodrail.ruinsView.group.traverse((o) => {
    if (o.isMesh && o.visible) meshes++;
  });
  return meshes;
});
check("the ruins are drawn (merged meshes)", drawn > 0, `${drawn} meshes`);
await shot("01-start-view");
// What building the ruins costs: every tile of them built again (the industries' models in, as on an unlock).
await p.waitForTimeout(3000);
const build = await p.evaluate(() => {
  const w = window.woodrail;
  const t0 = performance.now();
  w.syncRuins(true);
  return { tiles: w.ruinsView.lastBuilt, ms: Math.round((performance.now() - t0) * 10) / 10, lastTileMs: Math.round(w.ruinsView.lastBuildMs * 10) / 10 };
});
console.log(`  (ruins rebuilt: ${JSON.stringify(build)})`);
await look(yard.x, yard.z, 1300);
await shot("02-ruin-near-start");

// 2. Tap it: its locked card.
const at = await onScreen(yard.x, 10, yard.z);
await tapAt(at.x, at.y);
const card = await p.evaluate(() => {
  const c = document.querySelector(".ruin-card");
  return c && !c.hidden ? { title: c.querySelector(".card-title").textContent, lines: [...c.querySelectorAll(".ruin-resource, .ruin-status, .ruin-own")].filter((e) => !e.hidden).map((e) => e.textContent), button: c.querySelector(".ruin-clear").textContent, restore: c.querySelector(".ruin-restore").hidden } : null;
});
check("tapping the ruin opens its card", !!card, JSON.stringify(card));
check("…titled Old farm, with its fields and what opens it", card?.title === "Old farm" && /Farm fields nearby: 8 of 8/.test(card.lines[0]) && card.lines.includes("🔒 Learn Farming at a school to open this farm") && card.lines.includes("Or build your own anywhere from the Industries tab."), JSON.stringify(card));
check("…and Clear the ruin for a few coins (no Restore while it's locked)", /^Clear the ruin · 10/.test(card?.button ?? "") && card.restore, card?.button);
await shot("03-locked-card");
/** What a straight held across the old farm's yard is told (as a drag over it shows). */
const ruinRefusal = () =>
  p.evaluate((s) => {
    const it = window.woodrail.interaction;
    const c = Math.cos(s.piece.heading);
    const n = Math.sin(s.piece.heading);
    const mid = { x: s.piece.x + c * 108 - n * 72, z: s.piece.z + n * 108 + c * 72 };
    const r = it.placement("straight-216", false, { x: mid.x - c * 108, z: mid.z - n * 108, heading: s.piece.heading }, 0, -1).reason;
    return r && it.blockMessage(r);
  }, farm);
const lockedSays = await ruinRefusal();
check("track over the locked old farm: it names it, and says tap it to clear it", lockedSays === "An old farm is in the way: tap it to clear it", lockedSays);

// 3. Farming learned (a shortcut: as a research finishing does it): a toast names the old farm, and tapped, frames it.
await p.evaluate(() => document.querySelector(".ruin-card button.close")?.click());
await look(yard.x + 1500, yard.z + 1500, 2600);
await p.evaluate(() => window.woodrail.learn("farming"));
const toastText = `${await p.evaluate((id) => {
  const w = window.woodrail;
  const land = w.world.landscape;
  const s = land.sites[id];
  const t = [...land.towns].sort((a, b) => Math.hypot(a.centre.x - s.centre.x, a.centre.z - s.centre.z) - Math.hypot(b.centre.x - s.centre.x, b.centre.z - s.centre.z))[0];
  return `Old farm by ${t.name}`;
}, farm.id)} can be restored`;
const seen = await p.evaluate(async (text) => {
  const out = [];
  for (let k = 0; k < 120; k++) {
    const t = document.querySelector(".toast");
    const now = `${t?.textContent}|${t?.className}`;
    if (out.at(-1) !== now) out.push(now);
    if (t?.textContent === text && t.classList.contains("show")) return { shown: true, out };
    await new Promise((r) => setTimeout(r, 250));
  }
  return { shown: false, out };
}, toastText);
check("learning Farming: a toast names the old farm to restore", seen.shown, `${toastText} / ${JSON.stringify(seen.out)}`);
await shot("r1-show-me-toast");
const far = await p.evaluate(() => window.woodrail.controls.target.toArray().map(Math.round));
await tap(".toast");
await p.waitForTimeout(2500);
await settle();
const framed = await onScreen(farm.centre.x, 10, farm.centre.z);
check("…tapped, it frames the old farm", framed.in && Math.abs(framed.x - 195) < 160, JSON.stringify({ far, framed }));
// Show me for "Open a farm" points at the old farm (and opens its card).
const guide = await p.evaluate(async () => {
  const { GOALS } = await import("/src/game/goals.ts");
  const g = GOALS.find((x) => x.id === "open-farm").guide(window.woodrail.world);
  return { ruin: g.ruin, marks: g.marks };
});
check("Show me for Open a farm: the old farm", guide.ruin === farm.id, JSON.stringify(guide));
const learnedSays = await ruinRefusal();
check("…and track over it now says tap it to restore or clear it", learnedSays === "An old farm is in the way: tap it to restore or clear it", learnedSays);

// 4. Its card now offers Restore at half a new farm yard's price; short of planks (no workshop yet), it says so.
const shopAt = await p.evaluate(async () => {
  const w = window.woodrail;
  w.progress().coins = 100;
  // A workshop on a straight of its own, out in the open (as the e2e of the growth menu puts one), its yard stocked.
  const s1 = w.world.landscape.towns[1].station;
  return { x: Math.round(s1.x / 18) * 18, z: Math.round((s1.z + 500) / 18) * 18 };
});
await look(yard.x, yard.z, 1300);
const at2 = await onScreen(yard.x, 10, yard.z);
await tapAt(at2.x, at2.y);
const card2 = await p.evaluate(() => {
  const c = document.querySelector(".ruin-card");
  return c && !c.hidden ? { status: c.querySelector(".ruin-status").textContent, own: c.querySelector(".ruin-own").textContent, buttons: [...c.querySelectorAll(".card-row button")].filter((b) => !b.hidden).map((b) => b.textContent) } : null;
});
check("the learned ruin's card: Restore · 3🪵 45🪙, and you may still build your own", card2?.status === "🔧 Half the price of a new farm yard" && card2.buttons[0] === "Restore · 3🪵 45🪙" && card2.own === "Or build your own anywhere from the Industries tab.", JSON.stringify(card2));
await tap(".ruin-card .ruin-restore");
const noShop = await p.evaluate(() => document.querySelector(".toast")?.textContent);
check("…with no workshop: it says where the planks come from", noShop === "Restoring takes planks from your workshop. Place it first", noShop);
await p.evaluate(async (at) => {
  const w = window.woodrail;
  const { CARGO } = await import("/src/economy/cargo.ts");
  w.editor().place("depot-workshop", { x: at.x, z: at.z, heading: 0 }, 0, false);
  const d = w.economy.allDepots().find((x) => x.role === "workshop");
  d.piles[CARGO.planks.index] = 10;
}, shopAt);
await p.waitForTimeout(1500);
await settle();
await look(yard.x, yard.z, 1300);
const at3 = await onScreen(yard.x, 10, yard.z);
await tapAt(at3.x, at3.y);
await p.waitForTimeout(800);
await shot("r2-restore-card");

// 5. Restore: the stub becomes the farm yard in place, a working industry (its depot, crane and card), paid for.
const stubPose = await p.evaluate((id) => ({ ...window.woodrail.layout.getPiece(window.woodrail.world.ruins.get(id)).pose }), farm.id);
await tap(".ruin-card .ruin-restore");
await p.waitForTimeout(1200);
await settle();
const restored = await p.evaluate(async ([id, pose]) => {
  const w = window.woodrail;
  const { CARGO } = await import("/src/economy/cargo.ts");
  const piece = [...w.layout.pieceIds()].map((i) => w.layout.getPiece(i)).find((q) => q.type === "depot-farm");
  const depot = piece && w.economy.depotAtPiece(piece.id);
  const site = piece && w.depotView.sites.find((s) => s.depot.pieceId === piece.id);
  const g = w.world.landscape.grid;
  let left = 0;
  g.forEachCell((i) => (left += g.feature[i] === 7 && g.owner[i] === id ? 1 : 0));
  return {
    piece: piece ? { id: piece.id, at: Math.hypot(piece.pose.x - pose.x, piece.pose.z - pose.z) } : null,
    depot: depot?.role,
    rate: depot?.rate,
    crane: !!site?.crane,
    restored: !!w.world.landscape.sites[id].restored,
    ruin: w.world.ruins.has(id),
    left,
    coins: w.progress().coins,
    planks: w.economy.allDepots().find((x) => x.role === "workshop").piles[CARGO.planks.index],
    card: !document.querySelector(".ruin-card").hidden,
  };
}, [farm.id, stubPose]);
check("Restore: a farm yard where the stub was, the ruin gone", restored.piece?.at < 0.5 && restored.restored && !restored.ruin && restored.left === 0 && !restored.card, JSON.stringify(restored));
check("…a working farm: its depot, its rate from the fields, its crane", restored.depot === "farm" && restored.rate >= 1 && restored.crane, JSON.stringify(restored));
check("…paid as a new one is, at half the price: 3 planks from the workshop, 45 coins", restored.coins === 55 && restored.planks === 7, JSON.stringify(restored));
// Its card: tap the farm yard.
const farmAt = await onScreen(yard.x, 10, yard.z);
await tapAt(farmAt.x, farmAt.y);
await p.waitForTimeout(800);
const depotCard = await p.evaluate(() => {
  const c = document.querySelector(".depot-card");
  return c && !c.hidden ? c.querySelector(".card-title")?.textContent : null;
});
check("…its card opens on a tap: Farm yard", /Farm yard/.test(depotCard ?? ""), depotCard);
await shot("r3-restored-farm");
await p.evaluate(() => document.querySelector(".depot-card button.close")?.click());
await p.waitForTimeout(400);

// 6. Undo brings the ruin back (and the price); redo restores it again.
await tap("button[title='Undo (Ctrl+Z)']");
await p.waitForTimeout(1200);
const undone = await p.evaluate((id) => {
  const w = window.woodrail;
  const stub = w.world.ruins.get(id);
  return { stub: stub !== undefined && w.layout.getPiece(stub)?.type, farms: [...w.layout.pieceIds()].filter((i) => w.layout.getPiece(i).type === "depot-farm").length, restored: !!w.world.landscape.sites[id].restored, coins: w.progress().coins, tiles: w.ruinsView.group.children.length };
}, farm.id);
check("Undo: the ruin and its stub are back, the farm yard gone, the coins given back", undone.stub === "straight-216" && undone.farms === 0 && !undone.restored && undone.coins === 100 && undone.tiles > 0, JSON.stringify(undone));
await p.evaluate(() => window.woodrail.editor().redo());
await p.waitForTimeout(1200);
const redone = await p.evaluate((id) => ({ ruin: window.woodrail.world.ruins.has(id), restored: !!window.woodrail.world.landscape.sites[id].restored, coins: window.woodrail.progress().coins }), farm.id);
check("Redo: restored again, paid again", !redone.ruin && redone.restored && redone.coins === 55, JSON.stringify(redone));

// 8. The land around: its ruins shown before it's bought; a coastal plot with an extra town, its land card.
const coastal = await p.evaluate(async () => {
  const { plotsForSale, landForSale } = await import("/src/game/world.ts");
  const { generatePlot } = await import("/src/landscape/index.ts");
  const w = window.woodrail;
  const land = w.world.landscape;
  const out = [];
  for (const q of plotsForSale(land)) {
    const part = landForSale(land, q.px, q.pz);
    let sea = 0;
    part.grid.forEachCell((i) => (sea += part.grid.surface[i] === 5 ? 1 : 0));
    const own = generatePlot(land.seed, q.px, q.pz, land.coast ?? null).towns.length;
    out.push({ ...q, sea, towns: part.towns.length, extra: part.towns.length - own, sites: (part.sites ?? []).map((s) => ({ role: s.role, centre: s.centre, piece: s.piece })) });
  }
  return out;
});
const pick = coastal.filter((q) => q.sea > 0 && q.sites.length > 0).sort((a, b) => b.extra - a.extra)[0] ?? coastal.find((q) => q.sites.length > 0);
check("a coastal plot for sale has an extra town (by the sea)", pick.sea > 0 && pick.extra > 0, JSON.stringify(coastal.map((q) => [q.px, q.pz, q.sea > 0 ? "coast" : "-", q.towns, q.extra])));
check("every plot for sale has an old site", coastal.every((q) => q.sites.length > 0), JSON.stringify(coastal.map((q) => [q.px, q.pz, q.towns, q.sites.map((s) => s.role).join("+")])));
// (Wait for the land around to be shown with its ruins.)
await p.waitForFunction(() => {
  let n = 0;
  window.woodrail.ruinsView.group.traverse((o) => (n += o.isMesh ? 1 : 0));
  return n > 0 && window.woodrail.ruinsView.group.children.length > 1;
}, null, { timeout: 60000 }).catch(() => {});
const scenery = pick.sites[0];
const sy = yardOf(scenery);
await look(sy.x, sy.z, 1500);
const sceneryView = await onScreen(sy.x, 10, sy.z);
check("a ruin on the land around (not yet bought) is drawn", sceneryView.in && (await p.evaluate(() => window.woodrail.ruinsView.group.children.length)) >= 2, JSON.stringify(sceneryView));
await shot("05-ruin-on-land-around");

// The land card for that coastal plot (coins enough to buy it).
await p.evaluate(() => {
  window.woodrail.progress().coins = 5000;
});
// (Add land: from the ☰ menu on a phone.)
await p.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.title === "Choose land to add to the map" || b.title === "Add land")?.click());
await p.waitForTimeout(1500);
// (A tap on the plot itself, where it shows clear of the card: a point of it on the screen, once the view has come to
// rest from its glide out. QA: under load the glide took 34 s, and a tap made 4 s in found "That's your land already".)
await glided(p);
await settle();
await p.waitForTimeout(500);

let spot = null;
for (let attempt = 0; attempt < 4 && !(spot && !spot.none); attempt++) {
  // (Not on screen once the view's glide out is over: looked at, its near edge beside the land, above the card.)
  if (attempt > 0) {
    await look((pick.px + 0.5) * 2232, (pick.pz + 0.5) * 1656 + (pick.pz > 0 ? -828 : pick.pz < 0 ? 828 : 0) + 500, 3200, 0.75);
    await glided(p);
    await p.waitForTimeout(500);
  }
  spot = await p.evaluate(([px, pz]) => {
  const w = window.woodrail;
  const V = w.camera.position.constructor;
  const r = w.canvas.getBoundingClientRect();
  const card = document.querySelector(".land-card").getBoundingClientRect();
  for (let k = 1; k < 20; k++) {
    for (let j = 1; j < 10; j++) {
      const v = new V((px + j / 10) * 2232, 0, (pz + k / 20) * 1656).project(w.camera);
      const x = r.left + ((v.x + 1) / 2) * r.width;
      const y = r.top + ((1 - v.y) / 2) * r.height;
      if (!(v.z < 1 && x > 20 && x < r.width - 20 && y > 240 && y < card.top - 20)) continue;
      // (The ground under that point, as a tap finds it, in the plot: not the land in front of it.)
      const g = w.interaction.groundAt(x, y);
      if (g && Math.floor(g.x / 2232) === px && Math.floor(g.z / 1656) === pz) return { x, y };
    }
  }
  return { none: true, card: card.top, cam: w.camera.position.toArray().map(Math.round) };
}, [pick.px, pick.pz]);
}
if (spot?.none) console.log("  (no spot of the plot on screen)", JSON.stringify(spot), JSON.stringify(pick));
if (spot && !spot.none) await stampedTap(p, spot.x, spot.y);
await p.waitForTimeout(600);
const landText = await p.evaluate(() => document.querySelector(".land-text")?.textContent ?? "");
check("the land card lists the plot's old sites and towns", /old (farm|quarry|mine|harbour)/.test(landText) && (pick.towns === 0 || /town/.test(landText)), landText);
check("…a coastal plot with an extra town: its towns by the sea", pick.towns === 0 || /by the sea|coast/.test(landText), `${landText} (${pick.towns} towns)`);
await shot("06-land-card-coast");

// 9. Bought: its towns and its ruins join the land (each ruin's stub a fixed track piece).
await tap(".land-card button", "Add this land");
await p.waitForTimeout(1500);
const bought = await p.evaluate(([px, pz]) => {
  const w = window.woodrail;
  const land = w.world.landscape;
  return { owned: land.grid.hasPlot(px, pz), sites: land.sites.filter((s) => s.plot.px === px && s.plot.pz === pz).length, stubs: [...w.world.ruins.values()].length };
}, [pick.px, pick.pz]);
check("bought: the coastal plot's ruins are the land's now", bought.owned && bought.sites === pick.sites.length, JSON.stringify(bought));
await tap(".land-card button", "Done");
await look((pick.px + 0.5) * 2232, (pick.pz + 0.5) * 1656, 2600, 0.75);
await shot("07-bought-coast");

// 10. Clear one of its ruins: 10 coins, the ruin and its stub gone.
const ruinBought = await p.evaluate(([px, pz]) => window.woodrail.world.landscape.sites.filter((s) => s.plot.px === px && s.plot.pz === pz && !s.cleared).map((s) => ({ ...s }))[0], [pick.px, pick.pz]);
// (Not bought, so no ruin of its own to clear: said, and the steps after go on.)
check("the plot bought has a ruin to clear", !!ruinBought, JSON.stringify(bought));
if (ruinBought) {
  const ry = yardOf(ruinBought);
  await look(ry.x, ry.z, 1300);
  await glided(p);
  const rAt = await onScreen(ry.x, 10, ry.z);
  await tapAt(rAt.x, rAt.y);
  const before = await p.evaluate(() => ({ pieces: window.woodrail.layout.pieceCount, ruins: window.woodrail.world.ruins.size, coins: window.woodrail.progress().coins, card: !document.querySelector(".ruin-card").hidden }));
  check("a ruin on the land bought: its card opens on a tap", before.card, JSON.stringify(before));
  await tap(".ruin-card .ruin-clear");
  await p.waitForTimeout(800);
  const after = await p.evaluate((id) => {
    const w = window.woodrail;
    const g = w.world.landscape.grid;
    let left = 0;
    g.forEachCell((i) => {
      if (g.feature[i] === 7 && g.owner[i] === id) left++;
    });
    return { pieces: w.layout.pieceCount, ruins: w.world.ruins.size, cleared: !!w.world.landscape.sites[id].cleared, coins: w.progress().coins, left, card: !document.querySelector(".ruin-card").hidden };
  }, ruinBought.id);
  check("Clear the ruin: it's gone, its stub too, for 10 coins", after.cleared && after.ruins === before.ruins - 1 && after.pieces === before.pieces - 1 && after.coins === before.coins - 10 && after.left === 0 && !after.card, JSON.stringify({ before, after }));
  await shot("10-cleared");
  // Clearing is one undo step (QA: Restore, Undo, Clear, Redo rebuilt the farm on the cleared site): Undo brings the
  // ruin and its stub back and the 10 coins, Redo clears it again.
  const ruinState = (id) =>
    p.evaluate((id) => {
      const w = window.woodrail;
      return { pieces: w.layout.pieceCount, ruin: w.world.ruins.has(id), cleared: !!w.world.landscape.sites[id].cleared, coins: w.progress().coins };
    }, id);
  // (Its title is its tooltip's now, `data-tip`, since the first tap on it.)
  await tap("button[title='Undo (Ctrl+Z)'], button[data-tip='Undo (Ctrl+Z)']");
  await p.waitForTimeout(1200);
  const unclear = await ruinState(ruinBought.id);
  check("Undo the Clear: the ruin and its stub are back, the 10 coins given back", unclear.ruin && !unclear.cleared && unclear.pieces === before.pieces && unclear.coins === before.coins, JSON.stringify(unclear));
  await p.evaluate(() => window.woodrail.editor().redo());
  await p.waitForTimeout(1200);
  const reclear = await ruinState(ruinBought.id);
  check("…Redo: cleared again, for 10 coins", !reclear.ruin && reclear.cleared && reclear.coins === before.coins - 10, JSON.stringify(reclear));
}

// 11. Idle: nothing drawn for 30 s (the ruins cost nothing while nothing changes).
const cdp = await p.context().newCDPSession(p);
await cdp.send("Performance.enable");
const busy = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;
await p.evaluate(async () => {
  const w = window.woodrail;
  for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
  w.invalidate();
  await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
});
await p.waitForTimeout(3000);
const busy0 = await busy();
const idle = await p.evaluate(async () => {
  const w = window.woodrail;
  const f0 = w.framesDrawn;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 30000));
  return { frames: w.framesDrawn - f0, seconds: Math.round((performance.now() - t0) / 100) / 10 };
});
idle.busyMs = Math.round(((await busy()) - busy0) * 1000);
idle.cpu = `${((idle.busyMs / (idle.seconds * 1000)) * 100).toFixed(2)}%`;
idle.ruinTiles = await p.evaluate(() => window.woodrail.ruinsView.group.children.length);
check("idle with ruins in view: no frames drawn in 30 s", idle.frames === 0, JSON.stringify(idle));

// 12. Reload: it stays restored (the farm yard an industry of the player's, no ruin).
await p.waitForTimeout(6500);
await p.reload();
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
await p.waitForTimeout(1500);
const reloaded = await p.evaluate(([id, pose]) => {
  const w = window.woodrail;
  const piece = [...w.layout.pieceIds()].map((i) => w.layout.getPiece(i)).find((q) => q.type === "depot-farm");
  return { restored: !!w.world.landscape.sites[id].restored, ruin: w.world.ruins.has(id), farm: piece ? Math.hypot(piece.pose.x - pose.x, piece.pose.z - pose.z) : null, depot: piece ? w.economy.depotAtPiece(piece.id)?.role : null, coins: w.progress().coins };
}, [farm.id, stubPose]);
check("reloaded: still restored, the farm yard where it was", reloaded.restored && !reloaded.ruin && reloaded.farm !== null && reloaded.farm < 0.5 && reloaded.depot === "farm", JSON.stringify(reloaded));
await look(yard.x, yard.z, 1300);
await shot("r4-reloaded-farm");

// 13. Sandbox (a fresh browser, its starter map): no sites, no ruins, none in the opening view or on the land for sale.
const q = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
q.on("pageerror", (e) => errors.push(e.message));
await q.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await q.goto(PAGE);
await q.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await q.evaluate(() => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await q.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await q.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await q.waitForTimeout(8000);
const sandbox = await q.evaluate(async () => {
  const w = window.woodrail;
  const { plotsForSale, landForSale } = await import("/src/game/world.ts");
  let meshes = 0;
  w.ruinsView.group.traverse((o) => (meshes += o.isMesh ? 1 : 0));
  const land = w.world.landscape;
  return { sites: land.sites?.length ?? 0, siteless: !!land.siteless, ruins: w.world.ruins.size, meshes, forSale: plotsForSale(land).reduce((n, q) => n + (landForSale(land, q.px, q.pz).sites?.length ?? 0), 0) };
});
check("Sandbox: no sites or ruins (none drawn in the opening view, none on the land for sale)", sandbox.siteless && sandbox.sites === 0 && sandbox.ruins === 0 && sandbox.meshes === 0 && sandbox.forSale === 0, JSON.stringify(sandbox));
await q.screenshot({ path: `${OUT}/08-sandbox-start.png` }).catch(() => {});

// 14. A phone on its side (667×375, a fresh game): the ruin card's Restore and Clear stay in view, pinned at its foot
// above the tray, and a tap on them lands (QA: they sat under the tray).
const L = await b.newPage({ viewport: { width: 667, height: 375 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
L.on("pageerror", (e) => errors.push(e.message));
await L.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await L.goto(PAGE);
await L.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await L.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await L.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await L.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await L.keyboard.press("Escape");
await L.waitForTimeout(1500);
// (Farming learned, so the card has both buttons; its yard framed in the middle of the view, and tapped for real.)
// The tap goes to the first spot on the ruin (its yard's middle, else its buildings or stub) with the canvas on top
// and the ruin under it: the HUD is checked, not assumed. (A test artefact: aimed with the view's target 300 mm past
// the yard, the yard was at y 318 of 375, under the tray; and Farming's "Old farm … can be restored" toast, up 4.2 s,
// lies over the view's middle in landscape. Every spot on the ruin with the canvas on top opens its card, both ways up.)
await L.evaluate(() => window.woodrail.learn("farming"));
await L.waitForFunction(() => !document.querySelector(".toast.show"), null, { timeout: 30000, polling: 250 }).catch(() => console.log("  (the toast was still up after 30 s)"));
const lAt = await L.evaluate(async () => {
  const w = window.woodrail;
  const s = w.world.landscape.sites.find((x) => x.role === "farm");
  const c = Math.cos(s.piece.heading);
  const n = Math.sin(s.piece.heading);
  const V = w.camera.position.constructor;
  w.lookAt(new V(s.piece.x + c * 108 - n * 72, 0, s.piece.z + n * 108 + c * 72), 1300, 0.8);
  w.invalidate();
  await Promise.race([w.settled(3), new Promise((r) => setTimeout(r, 15000))]);
  const r = w.canvas.getBoundingClientRect();
  const stub = w.world.ruins.get(s.id);
  // (Depot frame: t along the stub, l across; h mm up.)
  for (const [t, l, h] of [[108, 72, 10], [60, 72, 10], [160, 72, 10], [108, 30, 30], [108, 110, 30], [60, -10, 2], [160, -10, 2]]) {
    const v = new V(s.piece.x + c * t - n * l, h, s.piece.z + n * t + c * l).project(w.camera);
    const x = r.left + ((v.x + 1) / 2) * r.width;
    const y = r.top + ((1 - v.y) / 2) * r.height;
    if (document.elementFromPoint(x, y) !== w.canvas) continue;
    const pick = w.interaction.pick(x, y, true);
    if (w.interaction.ruinAtScreen(x, y) === s.id || (pick?.kind === "piece" && pick.pieceId === stub)) return { x: Math.round(x), y: Math.round(y), at: [t, l, h] };
  }
  return null;
});
if (lAt) await stampedTap(L, lAt.x, lAt.y);
await L.waitForTimeout(300);
const lTapped = await L.evaluate(() => !document.querySelector(".ruin-card").hidden);
await L.waitForTimeout(800);
const lCard = await L.evaluate(async () => {
  const card = document.querySelector(".ruin-card");
  // (Measured once its opening is over: on a loaded machine its `card-in`, scaled, was still running at 1.1 s.)
  await Promise.race([Promise.all(card.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 5000))]);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const cr = card.getBoundingClientRect();
  const tray = document.querySelector(".tray").getBoundingClientRect();
  return {
    open: !card.hidden,
    buttons: [...card.querySelectorAll(".card-row button")].filter((x) => !x.hidden).map((x) => {
      const r = x.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const ok = r.top >= cr.top && r.bottom <= cr.bottom && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && r.bottom <= tray.top && r.height >= 40;
      return { text: x.textContent, ok, hit: hit === x || x.contains(hit), at: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)], rect: [r.left, r.top, r.right, r.bottom].map(Math.round) };
    }),
    card: [cr.top, cr.bottom].map(Math.round),
    tray: Math.round(tray.top),
  };
});
check("667×375: the ruin card opens (a stamped tap on the old farm, no fallback)", !!lAt && lTapped && lCard.open, JSON.stringify({ at: lAt, tapped: lTapped }));
check("667×375: Restore and Clear fully in view, above the tray, nothing over them", lCard.buttons.length === 2 && lCard.buttons.every((x) => x.ok && x.hit), JSON.stringify(lCard));
await L.screenshot({ path: `${OUT}/14-ruin-card-667x375.png` }).catch(() => {});
// A tap on Restore lands: no workshop yet, so it says where the planks come from.
const restoreBtn = lCard.buttons.find((x) => x.text.startsWith("Restore"));
if (restoreBtn) await stampedTap(L, restoreBtn.at[0], restoreBtn.at[1]);
const lToast = await L.evaluate(async () => {
  // (Behind the research toast, if that's still up.)
  for (let k = 0; k < 40; k++) {
    const t = document.querySelector(".toast")?.textContent;
    if (t?.startsWith("Restoring")) return t;
    await new Promise((r) => setTimeout(r, 200));
  }
  return document.querySelector(".toast")?.textContent;
});
check("667×375: a tap on Restore lands", lToast === "Restoring takes planks from your workshop. Place it first", lToast);

// 15. The map view (390×844, a fresh game): the old farm's marker, locked; idle there costs nothing; Farming learned,
// the lock goes; tapped, the ruin's card opens; restored, the marker goes.
const M = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
M.on("pageerror", (e) => errors.push(e.message));
M.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
await M.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
await M.goto(PAGE);
await M.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await M.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await M.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await M.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
await M.keyboard.press("Escape");
// (The land around made ready, its ruins with it.)
await M.waitForFunction(() => window.woodrail.ruinsShown.some((r) => r.around), null, { timeout: 120000, polling: 500 }).catch(() => {});
await M.waitForTimeout(2000);
const openMapView = () => openMapOn(M);
async function openMapOn(M) {
  const r = await M.evaluate(() => {
    // (Its title is its tooltip's, `data-tip`, after the first tap on it.)
    const b = document.querySelector("button[title^='Map'], button[data-tip^='Map']");
    const q = b?.getBoundingClientRect();
    return q && { x: q.x + q.width / 2, y: q.y + q.height / 2 };
  });
  if (r) {
    await stampedTap(M, r.x, r.y);
    await M.waitForTimeout(100);
  }
  await glided(M);
  // (Till the glide up has ended: no frame drawn for a second, so the labels are where they'll stay.)
  await M.evaluate(async () => {
    const w = window.woodrail;
    for (let k = 0; k < 30; k++) {
      const f0 = w.framesDrawn;
      await new Promise((r) => setTimeout(r, 1000));
      if (w.framesDrawn === f0) return;
    }
  });
}
const mFarm = await M.evaluate(() => window.woodrail.world.landscape.sites.find((s) => s.role === "farm").id);
/** The map's markers as shown: each ruin's badge (shown or not, locked or not) and the labels, with their boxes. */
const mapState = () => mapStateOn(M);
const mapStateOn = (M) =>
  M.evaluate(() => {
    const box = (e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const shown = (e) => !e.classList.contains("off");
    const all = [...document.querySelectorAll(".map-marker")];
    // (A badge's box takes in its lock, which reaches past its corner.)
    const badge = (e) => {
      const a = box(e);
      const k = e.querySelector(".map-ruin-lock");
      if (!k) return a;
      const c = box(k);
      return { l: Math.min(a.l, c.l), t: Math.min(a.t, c.t), r: Math.max(a.r, c.r), b: Math.max(a.b, c.b) };
    };
    const lockOf = (e) => {
      const k = e.querySelector(".map-ruin-lock");
      if (!k) return null;
      const cs = getComputedStyle(k);
      return { font: parseFloat(cs.fontSize), disc: Math.round(k.getBoundingClientRect().width), bg: cs.backgroundColor };
    };
    return {
      open: !document.querySelector(".map-view").hidden,
      ruins: all.filter((e) => e.classList.contains("kind-ruin")).map((e) => ({ key: e.dataset.key, shown: shown(e), locked: !!e.querySelector(".map-ruin-lock"), lock: lockOf(e), icon: e.querySelector(".map-ruin-icon")?.textContent, box: badge(e) })),
      labels: all.filter((e) => !e.classList.contains("kind-ruin") && shown(e)).map((e) => ({ key: e.dataset.key, box: box(e) })),
    };
  });
const overlaps = (a, c) => a.l < c.r && c.l < a.r && a.t < c.b && c.t < a.b;
await openMapView();
const map1 = await mapState();
// Upright, the band is tall: the full labels (name, the line under it, a town's bar), not the compact ones.
const fullLabels = await M.evaluate(() => ({ compact: document.querySelector(".map-view").classList.contains("compact"), towns: [...document.querySelectorAll(".map-marker.kind-town:not(.off)")].map((e) => [e.offsetHeight, !!e.querySelector(".map-fill")?.getBoundingClientRect().height]) }));
check("map view upright (390×844): full labels, as before (a town's line and bar shown)", !fullLabels.compact && fullLabels.towns.length > 0 && fullLabels.towns.every(([h, bar]) => h > 40 && bar), JSON.stringify(fullLabels));
const farmMark = map1.ruins.find((r) => r.key === `ruin:${mFarm}`);
check("map view: the old farm's marker, 🌾 with a lock", map1.open && farmMark?.shown && farmMark.icon === "🌾" && farmMark.locked, JSON.stringify(farmMark));
check("…its lock readable: 16 px or more, on a pale disc", !!farmMark?.lock && farmMark.lock.font >= 16 && farmMark.lock.disc >= 20 && farmMark.lock.bg !== "rgba(0, 0, 0, 0)", JSON.stringify(farmMark?.lock));
check("…the land around's ruins marked too (by role)", map1.ruins.filter((r) => r.key.startsWith("ruin-around:")).length > 0, JSON.stringify(map1.ruins.map((r) => [r.key, r.icon, r.shown, r.shown ? [Math.round(r.box.l), Math.round(r.box.t)] : null])));
const clashes = map1.ruins.filter((r) => r.shown).flatMap((r) => map1.labels.filter((l) => overlaps(r.box, l.box)).map((l) => `${r.key}×${l.key}`));
check("…no ruin marker over a town's or a station's label", clashes.length === 0, clashes.join(", "));
await M.screenshot({ path: `${OUT}/15-map-markers.png` }).catch(() => {});
// Idle in the map view, markers shown: no frames.
const mcdp = await M.context().newCDPSession(M);
await mcdp.send("Performance.enable");
const mbusy = async () => (await mcdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "TaskDuration").value;
// (The map view draws a frame every 3 s or so for its first 15-25 s, the camera creeping to rest after the glide up, as
// it does without ruin markers: measured once still for 8 s.)
const mStill = await M.evaluate(async () => {
  const w = window.woodrail;
  const t0 = performance.now();
  let f = w.framesDrawn;
  let since = performance.now();
  while (performance.now() - t0 < 90000 && performance.now() - since < 8000) {
    await new Promise((r) => setTimeout(r, 250));
    if (w.framesDrawn !== f) [f, since] = [w.framesDrawn, performance.now()];
  }
  return Math.round(performance.now() - t0);
});
console.log(`  (map view still after ${mStill} ms)`);
const mb0 = await mbusy();
// (The map frames the land's places, close enough that a depot's piles changing in view (the forest yard's logs, every
// 15 s or so) are seen and draw one frame, as they do out of the map: those are counted apart.)
const mapIdle = await M.evaluate(async () => {
  const w = window.woodrail;
  const update = w.depotView.update;
  let piles = 0;
  w.depotView.update = function (...a) {
    const r = update.apply(this, a);
    if (r === "changed") piles++;
    return r;
  };
  const f0 = w.framesDrawn;
  const t0 = performance.now();
  await new Promise((r) => setTimeout(r, 30000));
  w.depotView.update = update;
  return { frames: w.framesDrawn - f0 - piles, piles, seconds: Math.round((performance.now() - t0) / 100) / 10 };
});
mapIdle.busyMs = Math.round(((await mbusy()) - mb0) * 1000);
mapIdle.cpu = `${((mapIdle.busyMs / (mapIdle.seconds * 1000)) * 100).toFixed(2)}%`;
check("idle in the map view with ruin markers: no frames drawn in 30 s (but one for each depot's piles changing in view)", mapIdle.frames === 0, JSON.stringify(mapIdle));
// Farming learned (as a research finishing does it): the farm's lock goes, at once.
await M.evaluate(() => window.woodrail.learn("farming"));
// (The map's markers are looked at again each second; learning is a busy moment in swiftshader.)
await M.waitForFunction((key) => !document.querySelector(`.map-marker[data-key='${key}'] .map-ruin-lock`), `ruin:${mFarm}`, { timeout: 20000, polling: 250 }).catch(() => {});
await M.screenshot({ path: `${OUT}/15-map-learned.png` }).catch(() => {});
const map2 = await mapState();
const farmMark2 = map2.ruins.find((r) => r.key === `ruin:${mFarm}`);
check("…Farming learned: the farm's lock goes (the others' stay)", farmMark2?.shown && !farmMark2.locked && map2.ruins.filter((r) => r.icon !== "🌾").every((r) => r.locked), JSON.stringify(map2.ruins.map((r) => [r.key, r.icon, r.locked])));
// Tap it: the map closes, and the ruin's card opens (Restore on it).
await M.evaluate(async () => {
  const w = window.woodrail;
  const { CARGO } = await import("/src/economy/cargo.ts");
  w.progress().coins = 100;
  const s1 = w.world.landscape.towns[1].station;
  w.editor().place("depot-workshop", { x: Math.round(s1.x / 18) * 18, z: Math.round((s1.z + 500) / 18) * 18, heading: 0 }, 0, false);
  w.economy.allDepots().find((x) => x.role === "workshop").piles[CARGO.planks.index] = 10;
});
await M.waitForTimeout(1500);
await glided(M);
const map3 = await mapState();
const farmMark3 = map3.ruins.find((r) => r.key === `ruin:${mFarm}`);
if (farmMark3?.shown) await stampedTap(M, (farmMark3.box.l + farmMark3.box.r) / 2, (farmMark3.box.t + farmMark3.box.b) / 2);
await M.waitForTimeout(1500);
const mCard = await M.evaluate(() => {
  const c = document.querySelector(".ruin-card");
  return { map: !document.querySelector(".map-view").hidden, card: c && !c.hidden ? { title: c.querySelector(".card-title").textContent, buttons: [...c.querySelectorAll(".card-row button")].filter((b) => !b.hidden).map((b) => b.textContent) } : null };
});
check("…tapped: the map closes and the old farm's card opens, Restore on it", !mCard.map && mCard.card?.title === "Old farm" && mCard.card.buttons[0] === "Restore · 3🪵 45🪙", JSON.stringify(mCard));
await M.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 15000))]));
await M.screenshot({ path: `${OUT}/15-marker-card.png` }).catch(() => {});
// Restore it: back on the map, its marker is gone.
await M.evaluate(() => document.querySelector(".ruin-card .ruin-restore")?.click());
await M.waitForTimeout(1500);
const mRestored = await M.evaluate((id) => !!window.woodrail.world.landscape.sites[id].restored, mFarm);
await openMapView();
const map4 = await mapState();
check("…restored: its marker is gone from the map (the others stay)", mRestored && map4.open && map4.ruins.length > 0 && !map4.ruins.some((r) => r.key === `ruin:${mFarm}`), JSON.stringify({ mRestored, open: map4.open, ruins: map4.ruins.map((r) => r.key) }));
await M.screenshot({ path: `${OUT}/15-map-restored.png` }).catch(() => {});

// 16. The map view on a phone on its side (667×375 and 844×390, a fresh game): no ruin's badge under a label and no
// label over another (QA: a slide back between the bars after the declutter put them back over each other), and a tap
// on a badge, at its middle or its edge, goes to its ruin (its card, on the player's land), not to a town.
for (const [W, H] of [
  [667, 375],
  [844, 390],
]) {
  const S = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  S.on("pageerror", (e) => errors.push(e.message));
  await S.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await S.goto(PAGE);
  await S.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await S.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await S.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await S.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await S.keyboard.press("Escape");
  await S.waitForFunction(() => window.woodrail.ruinsShown.some((r) => r.around), null, { timeout: 120000, polling: 500 }).catch(() => {});
  await S.waitForTimeout(2000);
  await openMapOn(S);
  const st = await mapStateOn(S);
  const shownBoxes = [...st.ruins.filter((r) => r.shown), ...st.labels];
  const clash = [];
  for (let i = 0; i < shownBoxes.length; i++) for (let j = i + 1; j < shownBoxes.length; j++) if (overlaps(shownBoxes[i].box, shownBoxes[j].box)) clash.push(`${shownBoxes[i].key}×${shownBoxes[j].key}`);
  // Compact labels (the band between the bars is short): most of the towns' fit (QA: 2 of 5 at 667×375, 4 at 844×390).
  const towns = await S.evaluate(() => ({
    compact: document.querySelector(".map-view").classList.contains("compact"),
    shown: document.querySelectorAll(".map-marker.kind-town:not(.off)").length,
    all: document.querySelectorAll(".map-marker.kind-town").length,
    detail: [...document.querySelectorAll(".map-marker:not(.kind-ruin):not(.off) .map-text > span")].some((e) => e.getBoundingClientRect().height > 0),
    tall: Math.max(0, ...[...document.querySelectorAll(".map-marker:not(.kind-ruin):not(.off)")].map((e) => e.offsetHeight)),
  }));
  const want = W === 667 ? Math.min(4, towns.all) : towns.all;
  check(`${W}×${H} map view: compact labels (name only, one line), ${want} or more of the ${towns.all} towns' shown`, towns.compact && !towns.detail && towns.tall <= 30 && towns.shown >= want, JSON.stringify(towns));
  const locks = st.ruins.filter((r) => r.shown && r.lock);
  check(`${W}×${H} map view: the locks readable (16 px or more, on a pale disc)`, locks.length > 0 && locks.every((r) => r.lock.font >= 16 && r.lock.disc >= 20), JSON.stringify(locks.map((r) => [r.key, r.lock])));
  check(`${W}×${H} map view: no badge or label over another`, st.open && shownBoxes.length > 0 && clash.length === 0, clash.join(", ") || `${st.labels.length} labels, ${st.ruins.filter((r) => r.shown).length} badges shown`);
  // Each badge shown is what's under its middle and just inside its edges (nothing over it).
  const hits = await S.evaluate(() =>
    [...document.querySelectorAll(".map-marker.kind-ruin:not(.off)")].map((e) => {
      const r = e.getBoundingClientRect();
      const [cx, cy] = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
      const at = [[cx, cy], [r.left + 3, cy], [r.right - 3, cy], [cx, r.top + 3], [cx, r.bottom - 3]];
      return { key: e.dataset.key, ok: at.every(([x, y]) => document.elementFromPoint(x, y)?.closest(".map-marker") === e) };
    }),
  );
  check(`${W}×${H} map view: a tap on any badge, middle or edge, lands on the badge`, hits.length > 0 && hits.every((h) => h.ok), JSON.stringify(hits));
  await S.screenshot({ path: `${OUT}/16-map-${W}x${H}.png` }).catch(() => {});
  // Tap one (one on the player's land if one's shown: its card opens; else one on the land around: the view goes there).
  const pick = st.ruins.find((r) => r.shown && r.key.startsWith("ruin:")) ?? st.ruins.find((r) => r.shown);
  if (pick) await stampedTap(S, (pick.box.l + pick.box.r) / 2, (pick.box.t + pick.box.b) / 2);
  await S.waitForTimeout(1200);
  await glided(S);
  const went = await S.evaluate((key) => {
    const w = window.woodrail;
    const c = document.querySelector(".ruin-card");
    const ruin = w.ruinsShown.find((r) => (r.around ? `ruin-around:${r.site.plot.px},${r.site.plot.pz}:${r.site.id}` : `ruin:${r.site.id}`) === key);
    const t = w.controls.target;
    return { map: !document.querySelector(".map-view").hidden, card: c && !c.hidden ? c.querySelector(".card-title").textContent : null, off: ruin ? Math.round(Math.hypot(t.x - ruin.site.centre.x, t.z - ruin.site.centre.z)) : null };
  }, pick?.key);
  const own = !!pick?.key.startsWith("ruin:");
  check(`${W}×${H} map view: a badge tapped goes to its ruin${own ? " (its card opens)" : ""}`, !!pick && !went.map && went.off !== null && went.off < 600 && (!own || !!went.card?.startsWith("Old ")), JSON.stringify({ pick: pick?.key, ...went }));
  await S.close();
}

// 17. A big map (seed 7's, 22 plots bought), upright (390×844): the map view frames the places on the player's land
// between its bars, as far out as the camera goes; too big to show whole, a one-finger drag pans to the rest, and every
// ruin on the land gets its badge on screen (QA: none of the harbours on the coast could be seen).
{
  const G = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  G.on("pageerror", (e) => errors.push(e.message));
  await G.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await G.goto(PAGE);
  await G.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await G.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await G.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await G.keyboard.press("Escape");
  const bought = await G.evaluate(async () => {
    const w = window.woodrail;
    const { plotsForSale } = await import("/src/game/world.ts");
    let n = 0;
    for (let k = 0; k < 60 && n < 22; k++) {
      const fs = plotsForSale(w.world.landscape).sort((a, c) => Math.hypot(a.px, a.pz) - Math.hypot(c.px, c.pz));
      if (fs.length === 0) break;
      if (w.unlockPlot(fs[0].px, fs[0].pz)) n++;
      await new Promise((r) => setTimeout(r, 50));
    }
    return { n, seed: w.world.landscape.seed };
  });
  await G.waitForTimeout(3000);
  await openMapOn(G);
  /** The player's land's ruins (as the map marks them), and which have their badge shown now. */
  const ownRuins = () =>
    G.evaluate(() => {
      const els = [...document.querySelectorAll(".map-marker.kind-ruin")].filter((e) => e.dataset.key.startsWith("ruin:"));
      return els.map((e) => ({ key: e.dataset.key, harbour: e.querySelector(".map-ruin-icon")?.textContent === "⚓", shown: !e.classList.contains("off") }));
    });
  const first = await ownRuins();
  const seen = new Set(first.filter((r) => r.shown).map((r) => r.key));
  const harbours = first.filter((r) => r.harbour);
  console.log(`  (seed ${bought.seed}, ${bought.n} plots bought: ${first.length} ruins on the land, ${seen.size} shown as the map opens, ${harbours.filter((r) => r.shown).length} of ${harbours.length} harbours)`);
  await G.screenshot({ path: `${OUT}/17-map-big-390x844.png` }).catch(() => {});
  /** A slow one-finger drag (no fling): the ground under the finger stays under it. */
  const cdp = await G.context().newCDPSession(G);
  const drag = async (x0, y0, x1, y1) => {
    const steps = 12;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0, id: 1 }] });
    for (let k = 1; k <= steps; k++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * k) / steps, y: y0 + ((y1 - y0) * k) / steps, id: 1 }] });
      await G.waitForTimeout(25);
    }
    await G.waitForTimeout(200);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await G.waitForTimeout(1300);
  };
  // A drag that starts on a town's label pans the map (QA: the labels cover much of the screen here, and a drag from
  // one did nothing), and isn't a tap on it (the map stays open).
  const label = await G.evaluate(() => {
    const e = [...document.querySelectorAll(".map-marker.kind-town:not(.off)")].find((x) => {
      const r = x.getBoundingClientRect();
      return r.top > 150 && r.bottom < 650;
    });
    const r = e?.getBoundingClientRect();
    return r && { key: e.dataset.key, x: r.left + r.width / 2, y: r.top + r.height / 2, t: window.woodrail.controls.target.toArray() };
  });
  if (label) await drag(label.x, label.y, label.x, label.y + 150);
  const afterLabel = await G.evaluate(() => ({ t: window.woodrail.controls.target.toArray(), map: !document.querySelector(".map-view").hidden }));
  const moved = label ? Math.round(Math.hypot(afterLabel.t[0] - label.t[0], afterLabel.t[2] - label.t[2])) : 0;
  check("big map: a drag from a town's label pans the map (not a tap: the map stays open)", !!label && afterLabel.map && moved > 300, JSON.stringify({ label: label?.key, moved, map: afterLabel.map }));
  // To each ruin not seen yet: drag it toward the middle of the band, a screen at a time, till its badge shows.
  const [cx, cy] = [195, 420];
  for (const r of first) {
    for (let k = 0; k < 4 && !seen.has(r.key); k++) {
      const at = await G.evaluate((key) => {
        const w = window.woodrail;
        const site = w.world.landscape.sites.find((s) => s.id === Number(key.split(":")[1]));
        const V = w.camera.position.constructor;
        const v = new V(site.centre.x, 0, site.centre.z).project(w.camera);
        const c = w.canvas.getBoundingClientRect();
        return { x: c.left + ((v.x + 1) / 2) * c.width, y: c.top + ((1 - v.y) / 2) * c.height };
      }, r.key);
      const dx = Math.max(-150, Math.min(150, cx - at.x));
      const dy = Math.max(-300, Math.min(300, cy - at.y));
      // (From wherever the finger lands, on a label or not: a drag from a label pans too.)
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) await drag(cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2);
      for (const q of await ownRuins()) if (q.shown) seen.add(q.key);
    }
  }
  const still = await G.evaluate(() => !document.querySelector(".map-view").hidden);
  const missed = first.filter((r) => !seen.has(r.key)).map((r) => r.key);
  check("big map (22 plots, 390×844): every ruin on the land gets its badge on screen in the map view, panning to it", still && first.length > 0 && missed.length === 0, JSON.stringify({ ruins: first.length, shownAtOpen: first.filter((r) => r.shown).length, seen: seen.size, missed }));
  await G.screenshot({ path: `${OUT}/17-map-big-panned-390x844.png` }).catch(() => {});
  await G.close();
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
