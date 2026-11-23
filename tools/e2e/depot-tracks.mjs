// End-to-end: depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md), Game mode on a 390×844 phone with
// touch. Setup (shortcuts, not what's tested): Sidings and Routes learned; a straight line on open ground with a mill
// and a workshop in it, laid by the editor; the workshop stocked with the planks and stone the upgrades cost; the
// mill with flour; two trains put down on the line (as the tray would), each with two hoppers of grain.
// Then, by the player's taps:
//   1. A tap on the mill: its card says one track, and offers "Second track · 10 planks".
//   2. A tap on it: a second track beside the mill and only that, one straight the yard's length (no points, nothing
//      past the yard's ends: its ends open), the crane's gantry over both, 10 planks taken; the card says it needs joining to the line, the track lit on the map. Undo (the top
//      bar) takes it back and gives the planks back; a tap lays it again.
//   3. Joined to the line by the player: a Split dragged by touch from the Switch shelf onto the line at each end of
//      the yard (turned and flipped as held) splices in there, in place of the line's straight next to the yard, and
//      joins the new track's end; the pointer move's cost while held;
//      the card no longer asks, nothing lit.
//   3b. These trains are longer than the yard (an engine and two hoppers), so the player makes room, as the card says:
//      Undo twice (the top bar) takes the Splits back (the line's straights back, the Splits into the toy box); a straight dragged by
//      touch from the tray onto each open end of the second track joins it; a Split on the line beyond each, joined.
//   4. Each train given a route by taps (Plan a route, the mill, the workshop, Done) and set going: they stand at the
//      mill on two tracks at once, the one crane serving each in turn (never two loads at once), and both trains'
//      grain lands on the mill's pile (the payoff).
//   5. "Third track · 12 planks 10 stone": a third beside the second, the gantry over all three, the card asking for
//      it to be joined; no button after.
//   6. Reloaded, the game continued from its save: the mill still has three tracks, its gantry over them.
//   7. Idle: nothing moving draws no frames.
//
// Usage: npm run e2e:depot-tracks [-- <out dir>]   (default out: e2e-out/depot-tracks)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { pinClocksIn, stillIndustriesIn } from "../../scripts/e2e/pin-clocks.mjs";
import { dragPointsOnto } from "../../scripts/e2e/lib/points-onto-line.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/depot-tracks";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5397, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (Clocks and industries' motions held still: this counts idle frames.)
pinClocksIn(b);
stillIndustriesIn(b);
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  window.__allClicks = 0;
  window.addEventListener("click", () => window.__allClicks++, { capture: true });
});
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, timeout: 120000 }).catch((e) => console.log(`(no picture ${n}: ${e.message.split("\n")[0]})`));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const tapped = async (act) => {
  const before = await p.evaluate(() => window.__allClicks);
  await act();
  await p.waitForFunction((n) => window.__allClicks > n, before, { timeout: 60000 }).catch(() => {});
  await frames();
};
const worldAt = (what) =>
  p.evaluate((what) => {
    const w = window.woodrail;
    if (what.engine !== undefined) {
      const t = w.sim.findCar(what.engine).train;
      const [a, c] = [t.world[0], t.world[1]];
      return { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, z: (a.z + c.z) / 2 };
    }
    const piece = w.layout.getPiece(w.economy.depot(what.depot).pieceId);
    const q = piece.pose;
    // (A depot's yard, beside its track: what a player taps.)
    const along = what.along ?? 108;
    const across = what.across ?? 60;
    return { x: q.x + Math.cos(q.heading) * along - Math.sin(q.heading) * across, y: piece.y, z: q.z + Math.sin(q.heading) * along + Math.cos(q.heading) * across };
  }, what);
const onScreen = async (what) => {
  const v = await worldAt(what);
  return p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
  }, v);
};
const showing = async (what, dist = 1300, opts = {}) => {
  const v = await worldAt(what);
  await p.evaluate(([v, dist, opts]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y, v.z), dist, { duration: 0.2, ...opts }), [v, dist, opts]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapOn = async (what) => {
  await showing(what);
  const [x, y] = await onScreen(what);
  await tapped(() => p.touchscreen.tap(x, y));
};
const tapButton = async (sel) => {
  await p.waitForFunction((sel) => [...document.querySelectorAll(sel)].some((e) => e.getBoundingClientRect().width > 0), sel, { timeout: 30000 });
  await frames();
  await p.waitForTimeout(400);
  const [x, y] = await p.evaluate((sel) => {
    const r = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2];
  }, sel);
  await tapped(() => p.touchscreen.tap(x, y));
};
const planRoute = async (engine, places) => {
  await tapOn({ engine });
  await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 20000 }).catch(() => {});
  if (!(await p.evaluate(() => window.woodrail.hud.engineCardOpen))) await tapOn({ engine });
  await tapButton(".engine-extra .route-plan");
  for (const d of places) await tapOn({ depot: d });
  await tapButton(".line-sheet .route-plan.on");
  await p.keyboard.press("Escape");
};
const enterGame = async () => {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  // (The primary button: a new game, or, with a save, Continue.)
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.keyboard.press("Escape");
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
};
const state = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    const { CARGO } = await import("/src/economy/cargo.ts");
    const mill = w.economy.depot(window.__mill);
    const shop = w.economy.depot(window.__shop);
    const crane = w.depotView.craneOf(mill.id);
    return {
      tracks: w.economy.trackCount(mill.id),
      planks: shop.piles[CARGO.planks.index],
      stone: shop.piles[CARGO.stone.index],
      crane: crane && { l: Math.round(crane.l) },
      row: document.querySelector(".depot-tracks")?.innerText ?? null,
      button: document.querySelector(".depot-tracks-btn")?.innerText ?? null,
      join: document.querySelector(".depot-tracks-join")?.innerText ?? null,
      // (A track not joined yet, lit on the map: its ribbon's colours.)
      lit: w.scene.getObjectByName("depot-tracks-unjoined")?.userData.colours ?? [],
      roads: w.economy.roadsOf(mill.id).map((r) => {
        const piece = w.layout.getPiece(r.pieceId);
        return { open: [0, 1].every((i) => w.layout.joinedConnector(r.pieceId * 8 + i) === -1), type: piece?.type };
      }),
      ends: w.economy.tracksOf(mill.id)?.ends.length ?? 0,
      pieces: [...w.layout.pieceIds()].length,
    };
  });

// 1. A new game.
await p.goto(PAGE);
await enterGame();

// Setup (shortcuts, not what's tested): Sidings and Routes learned; a straight line on open ground, its pieces asked
// of the game's drop rule: eight straights, the mill, three straights, the workshop, a straight; the workshop's
// planks and stone; the mill's flour. And the harness's run-ahead (the game's own sim and economy ticks).
const setup = await p.evaluate(async () => {
  const w = window.woodrail;
  w.learn("routes");
  w.learn("sidings");
  // (Splits: the Switch shelf's, learned with Junctions and loops, which Sidings needs.)
  w.learn("junctions");
  const { CARGO } = await import("/src/economy/cargo.ts");
  const types = [...Array(8).fill("straight-216"), "depot-mill", ...Array(3).fill("straight-216"), "depot-workshop", "straight-216"];
  const t = w.controls.target;
  const g = w.world.landscape.grid;
  for (let d = 300; d < 9000; d += 72) {
    for (let a = 0; a < Math.max(1, Math.round(d / 72) * 4); a++) {
      for (const h of [0, Math.PI / 2]) {
      const c = Math.cos(h);
      const sn = Math.sin(h);
      const X0 = Math.round((t.x + d * Math.cos(a)) / 18) * 18;
      const Z0 = Math.round((t.z + d * Math.sin(a)) / 18) * 18;
      if (g.groundY(g.cellAtWorld(X0, Z0)) !== 0) continue;
      // (Along heading h, the mill in the middle; the extra tracks on its −l side: −l is (sin h, −cos h).)
      const X = X0 - 8 * 216 * c;
      const Z = Z0 - 8 * 216 * sn;
      const at = (i, l) => ({ x: X + i * 216 * c - l * sn, z: Z + i * 216 * sn + l * c, heading: h });
      const pieces = types.map((type, i) => ({ type, pose: at(i, 0), y: 0, flipped: false }));
      const probes = [];
      for (let i = 5; i <= 11; i++) for (const l of [-72, -144]) probes.push({ type: "straight-216", pose: at(i, l), y: 0, flipped: false });
      if ([...pieces, ...probes].some((q) => w.interaction.placeWhyIgnoring(q.type, q.flipped, q.pose, q.y, -1) !== null)) continue;
      const ids = w.editor().placeRun(pieces);
      const mill = w.economy.depotAtPiece(ids[8]) ?? w.economy.addDepot("mill", ids[8]);
      const shop = w.economy.depotAtPiece(ids[12]) ?? w.economy.addDepot("workshop", ids[12]);
      shop.piles[CARGO.planks.index] = 32; // (10 for the second track, 2 × 5 for the Splits, 12 for the third)
      shop.piles[CARGO.stone.index] = 10;
      mill.piles[CARGO.flour.index] = 12;
      w.depotView.setWorld(w.economy, w.layout);
      w.editor().clearHistory();
      window.__mill = mill.id;
      window.__shop = shop.id;
      window.__ids = ids;
      window.__run = (secs, watch) => {
        let both = 0;
        let twice = 0;
        let now = false;
        const move = { kind: "log", toPile: false, carId: -1, phase: 0 };
        for (let i = 0; i < secs * 120; i++) {
          w.sim.tick();
          w.economy.tick();
          if (!watch) continue;
          const tracks = [w.economy.depot(window.__mill).pieceId, ...w.economy.roadsOf(window.__mill).map((r) => r.pieceId)];
          let moving = 0;
          for (const piece of tracks) if (w.economy.craneMove(window.__mill, move, piece)) moving++;
          if (moving > 1) twice++;
          const on = watch.map((e) => {
            const tr = w.sim.findCar(e)?.train;
            return tr ? tracks.findIndex((piece) => tr.bogies.some((b) => b.pieceId === piece)) : -1;
          });
          now = on.every((k) => k !== -1) && new Set(on).size === on.length;
          if (now) both++;
        }
        w.invalidate();
        return { both: both / 120, twice, now };
      };
      w.invalidate();
      return { X, Z, h, ids, mill: mill.id, shop: shop.id };
      }
    }
  }
  return { error: "no open ground" };
});
check("setup: a mill and a workshop on a straight line", !setup.error, JSON.stringify(setup));
if (!setup.error) {
  const mill = setup.mill;

  // 1. The mill's card: one track, and the button with its price.
  await tapOn({ depot: mill });
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  await p.waitForFunction(() => !!document.querySelector(".depot-tracks-btn"), null, { timeout: 20000 }).catch(() => {});
  let s = await state();
  check("a tap on the mill opens its card: one track", s.tracks === 1 && /One track/.test(s.row ?? ""), JSON.stringify(s));
  check("…and offers a second track for 10 planks", /Second track · 10/.test(s.button ?? ""), JSON.stringify(s.button));
  await showing({ depot: mill, across: -40 }, 1250, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("1-one-track");

  // 2. A tap: a second track beside it, only that; undo takes it back with its planks; a tap lays it again.
  const before = s.pieces;
  await tapButton(".depot-tracks-btn");
  await p.waitForTimeout(600);
  s = await state();
  check("a tap lays a second track, 10 planks taken", s.tracks === 2 && s.planks === 22, JSON.stringify(s));
  check("…only the track beside it, one straight the yard's length (nothing past its ends), nothing taken up, its ends open", s.pieces === before + 1 && s.roads.length === 1 && s.roads[0].type === "straight-216" && s.roads[0].open && s.ends === 0, JSON.stringify(s));
  check("…the crane's gantry spans both tracks (its middle moved over the line)", s.crane?.l === 6, JSON.stringify(s.crane));
  check("…the card says to join it with a Split at each end, the track lit on the map", /Join the second track to the line: drag a Split from the Switch shelf/.test(s.join ?? "") && s.lit.length === 1, JSON.stringify(s));
  check("…and offers a third for 12 planks and 10 stone", /2 tracks/.test(s.row ?? "") && /Third track · 12/.test(s.button ?? "") && /10/.test(s.button ?? ""), JSON.stringify(s));
  const toastOk = await p.evaluate(() => [...document.querySelectorAll(".toast")].some((t) => /has 2 tracks now/.test(t.textContent)));
  check("…with a toast", toastOk);
  await showing({ depot: mill, across: -40 }, 1250, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("2-two-tracks-unjoined");
  await p.keyboard.press("Escape");
  // (Past the card's closing, and the click shield after it.)
  await p.waitForTimeout(1200);
  s = await state();
  check("the card closed: nothing lit", s.lit.length === 0, JSON.stringify(s.lit));
  await tapButton('button[aria-label="Undo (Ctrl+Z)"]');
  await p.waitForTimeout(600);
  s = await state();
  check("Undo: one step takes the track back, and gives the planks back", s.tracks === 1 && s.planks === 32 && s.crane?.l === 45 && s.pieces === before, JSON.stringify(s));
  await tapOn({ depot: mill });
  await tapButton(".depot-tracks-btn");
  await p.waitForTimeout(600);
  s = await state();
  check("a tap again: two tracks", s.tracks === 2 && s.planks === 22, JSON.stringify(s));
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1200);

  // 3. Joined by the player: a Split dragged from the Switch shelf onto the line at each end of the yard, by touch,
  // turned and flipped as held (R, F) so its link goes over to it: each splices in place of the line's straight next
  // to the yard (as a depot does) and joins the track's end.
  const want = await p.evaluate(() => {
    const w = window.woodrail;
    const m = w.layout.getPiece(w.economy.depot(window.__mill).pieceId).pose;
    const c = Math.cos(m.heading);
    const sn = Math.sin(m.heading);
    const at = (t, turn) => ({ x: m.x + t * c, z: m.z + t * sn, heading: m.heading + turn });
    return [
      { type: "split", pose: at(-216, 0), flipped: true },
      { type: "split", pose: at(432, Math.PI), flipped: false },
    ];
  });
  const cdp = await ctx.newCDPSession(p);
  const screen = (x, y, z) =>
    p.evaluate(([x, y, z]) => {
      const w = window.woodrail;
      const c = new w.camera.position.constructor(x, y, z).project(w.camera);
      return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
    }, [x, y, z]);
  const laid = [];
  for (const [k, wnt] of want.entries()) {
    await showing({ depot: mill, along: k === 0 ? -108 : 324, across: 0 }, 700, { phi: 0.9 });
    await settle();
    const r = await dragPointsOnto(p, cdp, screen, wnt);
    laid.push(r);
    console.log(`(a Split held over the line: a pointer move ${r.cost.toFixed(2)} ms median)`);
    check(`a Split dragged from the Switch shelf onto the line at the ${k === 0 ? "near" : "far"} end splices in there`, r.id !== -1 && r.why === null, JSON.stringify(r));
    if (k === 0) {
      await settle();
      await shot("3-split-spliced");
    }
  }
  check("…a pointer move while it's held over the line costs a few ms", laid.every((r) => r.cost < 8), laid.map((r) => r.cost.toFixed(2)).join(", "));
  const joined = await p.evaluate((ids) => {
    const w = window.woodrail;
    return ids.map((id) => (w.layout.getPiece(id) ? [0, 1, 2].map((i) => w.layout.joinedConnector(id * 8 + i) !== -1) : null));
  }, laid.map((r) => r.id));
  check("…each joined at all three ends: the line through it, and the new track's end", joined.every((j) => j && j.every(Boolean)), JSON.stringify(joined));
  s = await state();
  check("…paid for as from the tray: 5 planks each", s.planks === 12, JSON.stringify(s.planks));
  await tapOn({ depot: mill });
  await p.waitForFunction(() => !!document.querySelector(".depot-tracks-btn"), null, { timeout: 20000 }).catch(() => {});
  s = await state();
  check("joined: the card no longer asks for it, nothing lit", s.join === null && s.lit.length === 0, JSON.stringify(s));
  await showing({ depot: mill, across: -40 }, 1250, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("3-two-tracks-joined");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1200);

  // 3b. Room for these trains (longer than the yard, so standing on one straight they'd foul the Splits): Undo twice,
  // a straight from the tray on each end of the second track, and the Splits on the line beyond them.
  for (let k = 0; k < 2; k++) {
    await tapButton('button[aria-label="Undo (Ctrl+Z)"]');
    await p.waitForTimeout(600);
  }
  s = await state();
  const splitsLeft = await p.evaluate((ids) => ids.filter((id) => !!window.woodrail.layout.getPiece(id)).length, laid.map((r) => r.id));
  // (Undone, points go back in the toy box, not back to planks: laid again from there, they cost nothing more.)
  check("3b. Undo twice: the Splits taken back into the box, the track not joined", splitsLeft === 0 && s.planks === 12 && s.tracks === 2 && s.roads[0].open, JSON.stringify({ splitsLeft, s }));
  // (The Long straight: on the Track tab's Straight shelf, opened by taps as a player does: the Track tab, then the
  // Straight shelf.)
  const trayItem = async (key) => {
    // (Scrolled into view, then measured once the scroll has settled.)
    const find = async () => {
      const there = await p.evaluate((key) => {
        const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
        if (!e || !e.getBoundingClientRect().width) return false;
        e.scrollIntoView({ inline: "center", block: "nearest" });
        return true;
      }, key);
      if (!there) return null;
      await p.waitForTimeout(500);
      return p.evaluate((key) => {
        const q = document.querySelector(`.scroller .tray-item[data-key="${key}"]`).getBoundingClientRect();
        return [q.x + q.width / 2, q.y + q.height / 2];
      }, key);
    };
    await p.keyboard.press("Escape");
    // (Past a card's closing, and the click shield after it.)
    await p.waitForTimeout(1200);
    // (An Undo's toast can lie over the tray's foot: gone first, as a player would wait.)
    await p.waitForFunction(() => !document.querySelector(".toast.show"), null, { timeout: 20000 }).catch(() => {});
    // The Track tab tapped (even open, a tab tapped goes back to its shelves), then the Straight shelf.
    await tapButton('.tray .tab[data-tab="track"]');
    await p.waitForTimeout(250);
    const shelf = await p.evaluate(() => {
      const g = [...document.querySelectorAll(".scroller .tray-group")].find((b) => b.querySelector(".label")?.textContent === "Straight");
      if (!g) return null;
      g.scrollIntoView({ inline: "center", block: "nearest" });
      const r = g.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    if (!shelf) return null;
    await p.waitForTimeout(250);
    await p.touchscreen.tap(shelf[0], shelf[1]);
    await frames();
    await p.waitForTimeout(250);
    return find();
  };
  const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const lengthened = [];
  // (Each straight's middle: 108 on past each end of the second track, at l −72.)
  for (const along of [-108, 324]) {
    await showing({ depot: mill, along, across: -72 }, 700, { phi: 0.9 });
    await settle();
    const item = await trayItem("piece:straight-216");
    if (!item) {
      const tray = await p.evaluate(() => ({ inGroup: document.querySelector(".tray")?.classList.contains("in-group"), groups: [...document.querySelectorAll(".scroller .tray-group")].map((g) => g.querySelector(".label")?.textContent), items: [...document.querySelectorAll(".scroller .tray-item")].map((e) => e.dataset.key), atBack: (() => { const r = document.querySelector(".scroller .tray-back")?.getBoundingClientRect(); const e = r && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? `${e.tagName}.${e.className}` : null; })() }));
      check("3b. a Long straight on the tray", false, JSON.stringify(tray));
      break;
    }
    const mid = await worldAt({ depot: mill, along, across: -72 });
    const [tx, ty] = await screen(mid.x, mid.y, mid.z);
    const before = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
    let t = Date.now() / 1000;
    // (Dragged by touch from the tray; a held piece rides a little above the finger: aimed below it.)
    await touch("touchStart", item[0], item[1], t);
    for (let k = 1; k <= 16; k++) await touch("touchMove", item[0] + ((tx - item[0]) * k) / 16, item[1] + ((ty + 56 - item[1]) * k) / 16, (t += 0.04));
    await p.waitForTimeout(400);
    await frames();
    // Steered till it snaps on the track's end (as a player nudges it): the held piece's middle on screen brought to
    // the spot, a few moves (a held piece rides above the finger by a distance that depends on the view).
    const heldState = () =>
      p.evaluate(() => {
        const m = window.woodrail.interaction.mode;
        if (m?.kind !== "drag-piece") return { mode: m?.kind ?? null };
        const s = m.snap?.kind === "snapped" ? m.snap.pose : null;
        const q = s ?? m.pose;
        return { type: m.type, blocked: m.blocked ?? null, snapped: !!s, mid: q && { x: q.x + Math.cos(q.heading) * 108, z: q.z + Math.sin(q.heading) * 108 } };
      });
    let finger = [tx, ty + 56];
    let heldNow = await heldState();
    for (let k = 0; k < 8 && heldNow.mid && !(heldNow.snapped && !heldNow.blocked && Math.hypot(heldNow.mid.x - mid.x, heldNow.mid.z - mid.z) < 30); k++) {
      const [hx, hy] = await screen(heldNow.mid.x, mid.y, heldNow.mid.z);
      finger = [finger[0] + (tx - hx), finger[1] + (ty - hy)];
      await touch("touchMove", finger[0], finger[1], (t += 0.04));
      await frames();
      await p.waitForTimeout(150);
      heldNow = await heldState();
    }
    await touch("touchEnd", 0, 0, (t += 0.05));
    await frames();
    await p.waitForTimeout(800);
    await settle();
    const toast = await p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
    console.log(`(a straight held at ${along}: ${JSON.stringify(heldNow)}, aimed at ${Math.round(mid.x)},${Math.round(mid.z)}; toasts: ${toast})`);
    lengthened.push(await p.evaluate((before) => [...window.woodrail.layout.pieceIds()].find((i) => !before.includes(i) && window.woodrail.layout.getPiece(i).type === "straight-216") ?? -1, before));
  }
  const ends = await p.evaluate(() => {
    const w = window.woodrail;
    const road = w.economy.roadsOf(window.__mill)[0].pieceId;
    return [0, 1].map((i) => w.layout.joinedConnector(road * 8 + i) >> 3);
  });
  check("3b. a straight dragged from the tray onto each end of the second track joins it there", lengthened.length === 2 && lengthened.every((id) => id !== -1) && [...ends].sort().join() === [...lengthened].sort().join(), JSON.stringify({ lengthened, ends }));
  // (Done laying straights: the piece waiting at the end let go, as the toast says, by a tap away from it.)
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
  console.log(`(after the straights: interaction ${await p.evaluate(() => window.woodrail.interaction.mode?.kind ?? null)})`);
  // (Back to the Track tab's shelves, so the Switch shelf is there to open.)
  await tapButton('.tray .tab[data-tab="track"]');
  await p.waitForTimeout(400);
  const beyond = await p.evaluate(() => {
    const w = window.woodrail;
    const m = w.layout.getPiece(w.economy.depot(window.__mill).pieceId).pose;
    const c = Math.cos(m.heading);
    const sn = Math.sin(m.heading);
    const at = (t, turn) => ({ x: m.x + t * c, z: m.z + t * sn, heading: m.heading + turn });
    return [
      { type: "split", pose: at(-432, 0), flipped: true },
      { type: "split", pose: at(648, Math.PI), flipped: false },
    ];
  });
  const laid2 = [];
  for (const [k, wnt] of beyond.entries()) {
    await showing({ depot: mill, along: k === 0 ? -324 : 540, across: 0 }, 700, { phi: 0.9 });
    await settle();
    const r = await dragPointsOnto(p, cdp, screen, wnt);
    laid2.push(r);
    check(`3b. a Split on the line beyond the ${k === 0 ? "near" : "far"} straight splices in there`, r.id !== -1 && r.why === null, JSON.stringify(r));
  }
  const joined2 = await p.evaluate((ids) => {
    const w = window.woodrail;
    return ids.map((id) => (w.layout.getPiece(id) ? [0, 1, 2].map((i) => w.layout.joinedConnector(id * 8 + i) !== -1) : null));
  }, laid2.map((r) => r.id));
  s = await state();
  check("3b. …each joined at all three ends; the track the industry's again, 648 clear of the points; the Splits from the box (no more planks)", joined2.every((j) => j && j.every(Boolean)) && !s.roads[0].open && s.planks === 12, JSON.stringify({ joined2, planks: s.planks }));
  await showing({ depot: mill, across: -40 }, 1250, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("3b-two-tracks-lengthened");

  // 4. Two trains, each routed by taps to the mill and on to the workshop: served at once, the crane in turn.
  const trains = await p.evaluate(async () => {
    const w = window.woodrail;
    const { CARGO } = await import("/src/economy/cargo.ts");
    const put = (pieceId, kinds) => {
      const r = w.sim.addTrain(kinds, { pieceId, pathIndex: 0, reversed: false, s: 200 });
      if (r.kind !== "placed") return -1;
      const t = w.sim.getTrain(r.trainId);
      w.sim.setLever(t.cars[0].id, 0);
      return t.cars[0].id;
    };
    const a = put(window.__ids[4], ["engine", "hopper", "hopper"]);
    const b = put(window.__ids[1], ["engine", "hopper", "hopper"]);
    for (const e of [a, b]) if (e !== -1) for (const c of w.sim.findCar(e).train.cars) if (c.kind === "hopper") w.economy.setCargo(c.id, "grain", 3);
    w.economy.depot(window.__mill).piles[CARGO.grain.index] = 0;
    w.trainView?.sync?.();
    w.invalidate();
    return { a, b };
  });
  check("two trains put down on the line", trains.a !== -1 && trains.b !== -1, JSON.stringify(trains));
  for (const e of [trains.a, trains.b]) await planRoute(e, [mill, setup.shop]);
  const routes = await p.evaluate(([a, b]) => [a, b].map((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null), [trains.a, trains.b]);
  check("each routed by taps: the mill, then the workshop", routes.every((r) => JSON.stringify(r) === JSON.stringify([mill, setup.shop])), JSON.stringify(routes));
  await p.evaluate(([a, b]) => {
    window.woodrail.sim.setLever(a, 1);
    window.woodrail.sim.setLever(b, 1);
  }, [trains.a, trains.b]);
  // Run on, a quarter second at a time, till both stand at the mill, each on its own track, the crane mid-move.
  const run = { both: 0, twice: 0 };
  for (let k = 0; k < 240; k++) {
    const r = await p.evaluate(([a, b]) => ({ ...window.__run(0.25, [a, b]), phase: window.woodrail.economy.cranePhase(window.__mill) }), [trains.a, trains.b]);
    run.both += r.both;
    run.twice += r.twice;
    // (For the picture: both there now, the crane mid-move if it comes to that within a second or so.)
    if (r.now && (r.phase > 0.3 || run.both > 1)) break;
  }
  check("both trains stand at the mill at once, each on its own track", run.both > 0, JSON.stringify(run));
  // The picture: both at the mill, the crane mid-move.
  await p.evaluate(() => {
    window.woodrail.paused = true;
    window.woodrail.invalidate();
  });
  await showing({ depot: mill, across: -60 }, 760, { phi: 0.9, theta: Math.PI - 0.55 });
  await settle();
  console.log(`(the picture: interaction ${await p.evaluate(() => window.woodrail.interaction.mode?.kind ?? null)}, trains at ${await p.evaluate(() => JSON.stringify([...window.woodrail.sim.trainIds()].map((id) => { const c = window.woodrail.sim.getTrain(id).world?.[0]; return c && [Math.round(c.x), Math.round(c.z)]; })))}, mill at ${await p.evaluate(() => { const q = window.woodrail.layout.getPiece(window.woodrail.economy.depot(window.__mill).pieceId).pose; return [Math.round(q.x), Math.round(q.z)]; })})`);
  await shot("4-two-trains-served");
  await showing({ depot: mill, across: -72 }, 2000, { phi: 0.4, theta: Math.PI / 2 });
  await settle();
  await shot("5-overview");
  await p.evaluate(() => (window.woodrail.paused = false));
  const more = await p.evaluate(([a, b]) => window.__run(40, [a, b]), [trains.a, trains.b]);
  const payoff = await p.evaluate(
    async ([a, b]) => {
      const w = window.woodrail;
      const { CARGO } = await import("/src/economy/cargo.ts");
      const left = (e) => (w.sim.findCar(e)?.train.cars ?? []).filter((c) => c.kind === "hopper").reduce((n, c) => n + w.economy.cargoOf(c.id).count, 0);
      const mill = w.economy.depot(window.__mill);
      return { a: left(a), b: left(b), grain: mill.piles[CARGO.grain.index], flour: mill.piles[CARGO.flour.index] };
    },
    [trains.a, trains.b],
  );
  check("the one crane never moved two loads at once", run.twice + more.twice === 0, `${run.twice + more.twice} ticks`);
  check("the payoff: both trains' grain is unloaded at the mill (each served)", payoff.a === 0 && payoff.b === 0, JSON.stringify(payoff));
  check("…onto its pile, to be milled", payoff.grain + (payoff.flour - 12) > 0, JSON.stringify(payoff));

  // 5. The third: beside the second, asking to be joined.
  const piecesBefore3 = (await state()).pieces;
  await tapOn({ depot: mill });
  await tapButton(".depot-tracks-btn");
  await p.waitForTimeout(600);
  s = await state();
  check("a tap lays a third track, 12 planks and 10 stone taken", s.tracks === 3 && s.planks === 0 && s.stone === 0, JSON.stringify(s));
  check("…beside the second, one straight, its ends open, the card saying how to join it", s.pieces === piecesBefore3 + 1 && s.roads.length === 2 && s.roads[1].open && /Join the third track \(lit on the map\): a Split at each end/.test(s.join ?? "") && s.lit.length === 1, JSON.stringify(s));
  check("…the gantry spans all three", s.crane?.l === -30, JSON.stringify(s.crane));
  check("…and there's no fourth", s.button === null && /3 tracks/.test(s.row ?? ""), JSON.stringify(s));
  await showing({ depot: mill, across: -70 }, 1300, { phi: 0.8, theta: Math.PI / 2 + 0.45, inRoom: true });
  await settle();
  await shot("6-three-tracks");
  await p.keyboard.press("Escape");
  await p.waitForTimeout(1200);

  // 6. Saved, reloaded, continued: three tracks still, the gantry over them.
  await p.waitForTimeout(3000); // (saved)
  await p.reload();
  await enterGame();
  const back = await p.evaluate(() => {
    const w = window.woodrail;
    const mill = w.economy.allDepots().find((d) => d.role === "mill" && w.economy.trackCount(d.id) > 1);
    return mill ? { tracks: w.economy.trackCount(mill.id), crane: Math.round(w.depotView.craneOf(mill.id)?.l ?? NaN) } : null;
  });
  check("after a reload the mill still has three tracks, its gantry over them", back?.tracks === 3 && back.crane === -30, JSON.stringify(back));

  // 7. Idle: nothing drawn while nothing moves.
  await p.evaluate(() => {
    const w = window.woodrail;
    for (const id of w.sim.trainIds()) for (const c of w.sim.getTrain(id).cars) if (c.kind === "engine") w.sim.setLever(c.id, 0);
  });
  await settle();
  await p.waitForTimeout(1500);
  await settle();
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(2000);
  const idle = (await p.evaluate(() => window.woodrail.framesDrawn)) - f0;
  check("idle: no frames drawn over 2 s", idle === 0, `${idle} frames`);
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
