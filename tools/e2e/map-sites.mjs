// End-to-end map sites (step 1: old industries' ruins and more towns), on a phone (`npm run e2e:sites [-- <out dir>]`),
// at 390×844 with touch:
// - a new game: an old ruin is in view near the start (the starter map's old farm);
// - tapping it opens its locked card (Old farm, its fields, "Learn Farming at a school…", "Or build your own…");
// - Farming learned: a toast names the old farm ("Old farm by …"), tapped it frames it; Show me for "Open a farm" points
//   at it; its card offers Restore · 3🪵 45🪙 (no workshop: says so); Restore makes the stub a farm yard in place (its
//   depot, rate, crane and card), 3 planks from the workshop and 45 coins; Undo brings the ruin back and the price,
//   Redo restores it again; a reload keeps it restored;
// - Clear the ruin (one on the land bought) takes 10 coins, the ruin and its stub;
// - the land around shows its ruins before it's bought; a coastal plot's land card lists its towns by the sea and its
//   old sites; bought, it brings them (the ruins' stubs become track pieces, fixed);
// - idle: no frames drawn in 30 s (the ruins cost nothing while nothing changes).
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
const tapAt = async (x, y) => {
  await p.touchscreen.tap(x, y);
  await p.waitForTimeout(500);
};
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
await settle();
// (A tap on the plot itself, where it shows clear of the card: a point of it on the screen, once the view has come to
// rest from its glide out.)
await p.waitForTimeout(2500);

let spot = null;
for (let attempt = 0; attempt < 4 && !(spot && !spot.none); attempt++) {
  if (attempt > 0) await p.waitForTimeout(1500);
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
if (spot && !spot.none) await tapAt(spot.x, spot.y);
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
const ry = yardOf(ruinBought);
await look(ry.x, ry.z, 1300);
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

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
