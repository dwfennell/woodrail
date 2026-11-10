// End-to-end: the post (Game mode, a 390×844 phone with touch). A new game: the Post office is locked on the
// Industries shelf and there's no mail van on the Wagons shelf. Post office learned: both on the tray, unlocked. Then
// the payoff: track between the first two towns' stations, a post office on the way, and a train of two mail vans
// routed by taps (the first town, the post office, the second town). It runs: the towns post mail, the mail vans take
// it to the post office, which sorts it, and the post goes on to the towns, paid in full. A town that's had post gets a
// red post van on its streets; its card says so ("Post" row, "Always buys 📮 post"). The post van asks for frames only
// while it's in view and near enough to see it drive; zoomed out, it moves on unseen and nothing is drawn.
//
// Usage: npm run e2e:post [-- <out dir>]   (default out: e2e-out/post)
import { boot, openMode, planRoute, reporter, settled, shot, showing, tap, tryUntil, worldOf } from "../../scripts/e2e/lib/e2e.mjs";

const { page: p, url, out: OUT, errors, close } = await boot({ name: "post", port: 5397 });
const { check, finish } = reporter("post", { errors, close });
const pic = (n) => shot(p, `${OUT}/${n}.png`);
/** Tap the first element matching `selector` whose text starts with `text`, and a moment for what it opens. */
const tapText = async (selector, text) => {
  await tap(p, { sel: selector, text, starts: true });
  await p.waitForTimeout(400);
};
/**
 * A tray tab by its word, then its shelf by its word. (A tab with only the one shelf shows that shelf's items straight
 * away, with no shelf to tap: then the shelf is skipped, and the tab's items must already be showing.)
 */
const openShelf = async (tab, shelf) => {
  await tapText(".tabs button", tab);
  const shelves = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item.tray-group .label")].map((l) => l.textContent));
  if (shelves.length === 0 && (await p.evaluate(() => document.querySelectorAll(".scroller .tray-item[data-key]").length)) > 0) return;
  await tapText(".tray-item.tray-group", shelf);
};
/** The tray's items shown now: key → locked. */
const tray = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tray-item[data-key]")].map((x) => [x.dataset.key, x.classList.contains("locked")])));

// 1. A new game.
await p.goto(url);
await openMode(p, "game");

// 2. Not learned: the post office is locked, and there's no mail van.
await openShelf("Industries", "Industries");
const before = await tray();
check("not learned: the Post office is on the Industries shelf, locked", before["piece:depot-postoffice"] === true, JSON.stringify(before["piece:depot-postoffice"]));
await openShelf("Trains", "Wagons");
check("…and no mail van on the Wagons shelf", !("train:Mail van" in (await tray())), JSON.stringify(Object.keys(await tray())));

// 3. Post office learned (a setup shortcut to the state, as from the board: research itself is e2e:research's), with
// Train routes before it: the post office and the mail van on the tray, unlocked.
await p.evaluate(() => {
  const w = window.woodrail;
  for (const id of ["switches", "routes", "post-office"]) w.learn(id);
  w.hud.refreshTrayBadges();
  w.hud.trayLearned();
});
await p.waitForTimeout(800);
await openShelf("Trains", "Wagons");
const wagons = await tray();
check("learned: the mail van on the Wagons shelf, unlocked", wagons["train:Mail van"] === false, JSON.stringify(wagons));
await pic("1-mail-van-on-the-tray");
await openShelf("Industries", "Industries");
const after = await tray();
check("…and the Post office unlocked on the Industries shelf", after["piece:depot-postoffice"] === false, JSON.stringify(after["piece:depot-postoffice"]));
await pic("2-post-office-on-the-tray");

// 4. Setup (not what's tested): track from the first town's station to the second's, laid by the player's own
// pathfinder, and a straight on the way swapped for a post office (as a drop splices one into a line: e2e:kits-game
// tests drops). An engine and two mail vans put down at the first station (as the tray would), lever off. The towns
// are a village and a town (deliveries written into the totals, a shortcut to the state: they post mail as their size
// says).
const setup = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const towns = w.world.landscape.towns.filter((t) => w.world.stations.has(t.id));
  if (towns.length < 2) return { error: "fewer than two towns with stations" };
  const st = (k) => w.world.stations.get(towns[k].id);
  let laid = null;
  for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
    const before = new Set(w.layout.pieceIds());
    const r = play(w.world.layout, w.editor(), connectorRef(st(0), i), connectorRef(st(1), j), { blocked: rulesFor(w.world), maxPieces: 120, fiddle: 3 });
    if (r.ok) {
      laid = [...w.layout.pieceIds()].filter((id) => !before.has(id));
      break;
    }
  }
  if (!laid) return { error: "no track between the stations" };
  const straights = laid.filter((id) => w.layout.getPiece(id).type === "straight-216");
  if (straights.length < 3) return { error: `too few straights: ${straights.length}` };
  const office = w.editor().swap(straights[Math.floor(straights.length / 2)], "depot-postoffice");
  if (office === -1) return { error: "no post office swapped in" };
  const depot = w.economy.depotAtPiece(office) ?? w.economy.addDepot("postoffice", office);
  const town = (k) => w.economy.depotAtPiece(st(k)).id;
  let engine = -1;
  for (const pieceId of [st(0), ...laid.filter((id) => id !== office)]) {
    for (const s of [0, 30, 60, 90, 120, 150]) {
      const r = w.sim.addTrain(["engine", "mailvan", "mailvan"], { pieceId, pathIndex: 0, reversed: false, s });
      if (r.kind === "placed") {
        engine = w.sim.getTrain(r.trainId).cars[0].id;
        w.sim.setLever(engine, 0);
        break;
      }
    }
    if (engine !== -1) break;
  }
  // Harness shortcut: the game's own sim and economy ticks (as `Game.frame` runs them), run ahead of SwiftShader's few
  // frames a second. The crane's events counted by depot and good.
  window.__run = (secs) => {
    const n = { loaded: {}, unloaded: {} };
    for (let i = 0; i < secs * 120; i++) {
      w.sim.tick();
      w.economy.tick();
      for (const ev of w.economy.drainEvents()) {
        if (ev.kind !== "loaded" && ev.kind !== "unloaded") continue;
        const k = `${ev.depotId}:${ev.cargo}`;
        n[ev.kind][k] = (n[ev.kind][k] ?? 0) + 1;
      }
    }
    w.invalidate();
    return n;
  };
  w.invalidate();
  return { office: depot.id, towns: [town(0), town(1)], townIds: [towns[0].id, towns[1].id], engine, laid: laid.length };
});
check("setup: a post office on the line between two towns' stations, a train of two mail vans", !setup.error && setup.engine !== -1, JSON.stringify(setup));

if (!setup.error && setup.engine !== -1) {
  const { office, towns, townIds, engine } = setup;

  // 5. Its route by taps: the first town, the post office, the second town, Done.
  await planRoute(p, engine, [towns[0], office, towns[1]]);
  const stops = await p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, engine);
  check("route planned by taps: town, post office, town", JSON.stringify(stops) === JSON.stringify([towns[0], office, towns[1]]), JSON.stringify(stops));
  await p.keyboard.press("Escape");

  // 6. It runs (Go): mail from the towns into the mail vans, to the post office; the post on to the towns, paid.
  const coins0 = await p.evaluate(() => window.woodrail.progress().coins);
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine);
  const sum = { loaded: {}, unloaded: {} };
  for (let k = 0; k < 15; k++) {
    const n = await p.evaluate(() => window.__run(60));
    for (const kind of ["loaded", "unloaded"]) for (const [key, v] of Object.entries(n[kind])) sum[kind][key] = (sum[kind][key] ?? 0) + v;
  }
  const at = (kind, d, good) => sum[kind][`${d}:${good}`] ?? 0;
  const result = await p.evaluate(
    async ({ townIds }) => {
      const { CARGO } = await import("/src/economy/cargo.ts");
      const w = window.woodrail;
      return { made: w.economy.made[CARGO.mail.index], sorted: w.economy.made[CARGO.post.index], post: townIds.map((id) => w.economy.deliveredGoods.get(id)?.post ?? 0) };
    },
    { townIds },
  );
  check("the towns post mail, and the mail vans load it there", result.made > 0 && at("loaded", towns[0], "mail") + at("loaded", towns[1], "mail") > 0, JSON.stringify({ made: result.made, sum }));
  check("…the mail is unloaded at the post office, and sorted into post", at("unloaded", office, "mail") > 0 && result.sorted > 0, JSON.stringify({ sorted: result.sorted }));
  check("…the post is loaded there and delivered to the towns", at("loaded", office, "post") > 0 && result.post[0] + result.post[1] > 0, JSON.stringify(result.post));
  // (The towns pay as the game's loop sees what they've received: `TownLife.update`, a frame or two on.)
  await tryUntil(p, (c) => window.woodrail.progress().coins > c, coins0, { timeout: 30000 });
  const coins1 = await p.evaluate(() => window.woodrail.progress().coins);
  check("…and the towns pay for it", coins1 > coins0, `${coins0} → ${coins1}`);

  // 7. The payoff in town: a red post van on the streets of a town that's had post, driving (TownCars, synced once a
  // second by the game's loop).
  const got = result.post[0] >= result.post[1] ? 0 : 1;
  await tryUntil(p, (id) => window.woodrail.vans.vehicles.list.some((v) => v.kind === "post" && v.data?.townId === id), townIds[got], { timeout: 30000 });
  const van = await p.evaluate((id) => {
    const v = window.woodrail.vans.vehicles.list.find((x) => x.kind === "post" && x.data?.townId === id);
    return v ? { id: v.id, leg: v.leg, x: v.x, y: v.y, z: v.z } : null;
  }, townIds[got]);
  check("a post van on the streets of the town that's had post", !!van, JSON.stringify(van));
  // Stop the train (the camera then draws only for the post van).
  await p.evaluate((e) => {
    const w = window.woodrail;
    const t = w.sim.findCar(e)?.train;
    for (const c of t?.cars ?? []) if (c.kind === "engine") w.sim.setLever(c.id, 0);
  }, engine);
  await p.evaluate(() => window.__run(4));
  if (van) {
    // Find it driving (it rests a few seconds at each end), then follow it near.
    await tryUntil(p, (id) => ["out", "back"].includes(window.woodrail.vans.vehicles.list.find((v) => v.id === id)?.leg), van.id, { timeout: 60000 });
    const now = await p.evaluate((id) => {
      const v = window.woodrail.vans.vehicles.list.find((x) => x.id === id);
      return { x: v.x, y: v.y, z: v.z, leg: v.leg };
    }, van.id);
    await showing(p, { at: now }, 420);
    // (Software GL on a busy machine: a frame can take seconds, and the van rests 8 s at each end. Waited for while it drives.)
    const drives = (id) => p.waitForFunction((id) => ["out", "back"].includes(window.woodrail.vans.vehicles.list.find((v) => v.id === id)?.leg), id, { timeout: 60000 }).catch(() => {});
    await drives(van.id);
    const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
    await tryUntil(p, (f) => window.woodrail.framesDrawn > f, f0, { timeout: 30000 });
    const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
    check("near, in view and driving, the post van draws frames", f1 > f0, JSON.stringify({ leg: now.leg, frames: f1 - f0 }));
    await pic("3-post-van-in-town");
    // Zoomed right out: too small to see drive, it moves on unseen and nothing is drawn.
    await showing(p, { at: now }, 14000);
    await p.waitForTimeout(1500);
    await drives(van.id);
    const g0 = await p.evaluate(() => window.woodrail.framesDrawn);
    await p.waitForTimeout(4000);
    const g1 = await p.evaluate(() => window.woodrail.framesDrawn);
    const driving = await p.evaluate((id) => window.woodrail.vans.vehicles.list.find((v) => v.id === id)?.leg, van.id);
    check("zoomed out: the post van moves on unseen, no frames drawn", g1 - g0 <= 1, JSON.stringify({ frames: g1 - g0, leg: driving }));
  }

  // 8. That town's card: a Post row with its post van, and "Always buys 📮 post at full pay". The train has stopped at
  // its station, so the tap goes where the game's own pick says this town is (its station or its streets and houses),
  // not a car: the spot nearest the station that `interaction.pick` gives as this town's depot.
  // (Straight after the view came back from far out a tap can land before the map has settled: tapped again if no card.)
  // (Its Post row is on the card's Station tab: a tap on the tab once the card's open.)
  const tabTap = (tab) =>
    p.evaluate((tab) => {
      const t = document.querySelector(`.town-tab[data-tab="${tab}"]`);
      const r = t?.getBoundingClientRect();
      return r && r.width > 0 ? [r.x + r.width / 2, r.y + r.height / 2] : null;
    }, tab).then((at) => (at ? p.touchscreen.tap(at[0], at[1]).then(() => p.waitForTimeout(400)) : null));
  const postRow = async () => {
    await tryUntil(p, () => !!document.querySelector(".town-tab"), null);
    await tabTap("station");
    return p.waitForFunction(() => [...document.querySelectorAll(".ledger-row-name")].some((e) => e.textContent === "Post" && e.getBoundingClientRect().width > 0), null, { timeout: 30000 }).then(() => true, () => false);
  };
  const tapTown = async (depotId) => {
    await showing(p, { depot: depotId });
    await settled(p);
    const at = await p.evaluate(([depotId, v]) => {
      const w = window.woodrail;
      const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
      const cx = ((c.x + 1) / 2) * innerWidth;
      const cy = ((1 - c.y) / 2) * innerHeight;
      const spots = [];
      for (let dx = -160; dx <= 160; dx += 8) for (let dy = -160; dy <= 160; dy += 8) spots.push([cx + dx, cy + dy]);
      spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      for (const [x, y] of spots) {
        if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1 || document.elementFromPoint(x, y) !== w.canvas) continue;
        const hit = w.interaction.pick(x, y, true);
        if (hit?.kind === "depot" && hit.depotId === depotId) return [x, y];
      }
      return null;
    }, [depotId, await worldOf(p, { depot: depotId })]);
    if (at) await tap(p, at);
    return at;
  };
  await settled(p);
  let townAt = await tapTown(towns[got]);
  if (!(await postRow())) {
    townAt = await tapTown(towns[got]);
    await postRow();
  }
  check("a spot that is the town, not the train, found by the game's own pick", !!townAt, JSON.stringify(townAt));
  const postNote = await p.evaluate(() => [...document.querySelectorAll(".ledger-row")].find((r) => r.querySelector(".ledger-row-name")?.textContent === "Post" && r.getBoundingClientRect().width > 0)?.querySelector(".ledger-row-note")?.textContent ?? null);
  await pic("4-town-card-post");
  // (What it always buys: on its Grow tab.)
  await tabTap("grow");
  const card = { post: postNote, buys: await p.evaluate(() => [...document.querySelectorAll(".ledger-buys")].find((e) => e.getBoundingClientRect().width > 0)?.textContent ?? null) };
  check("the town's card: a Post row with its post van", !!card.post && card.post.includes("post van"), JSON.stringify(card));
  check("…and it always buys post at full pay", !!card.buys && card.buys.includes("📮 post"), JSON.stringify(card));
  await p.keyboard.press("Escape");

  // 9. The post office's yard, the train at it.
  await showing(p, { depot: office, along: 60 }, 1000);
  await p.waitForTimeout(1500);
  await settled(p);
  await pic("5-post-office-yard");
}

await finish();
