// End-to-end Sandbox chain hints (`npm run e2e:sandbox-chains [-- <out dir>]`), on a 390×844 phone with touch, then a
// look at 1440×900. A new Sandbox: the Industries tab is there (its tip toast, the industries and none of Game mode's
// workshop or school); a Harvester and a Sawmill dragged out of the tray by touch, gold and green rings round their
// suppliers and customers while each is held; track laid forest → sawmill → town; the sawmill's card says it's waiting
// for logs, where logs come from (Show frames that place) and where planks go, and chevrons on the map join them; a
// train of coaches at the forest says it needs a flatbed for its logs; a flatbed train with stops forest → sawmill → town
// (planned by taps) carries logs in and planks out to the town; a bakery's card says what's missing and which industry
// makes it; ☰ Chain hints off takes it all away; and with nothing moving, no frames are drawn.
//
// Harness shortcuts (named, none of them the thing under test): the track is laid by the player's own pathfinder
// (`play`, as e2e:warehouse), the trains are put down with `sim.addTrain` (as the tray would), and the sim and economy
// are ticked ahead in the page (`__run`, as e2e:warehouse) because SwiftShader draws a few frames a second.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { testClockIn } from "../../scripts/e2e/lib/fast.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/sandbox-chains";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5398, strictPort: false }, logLevel: "error" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const PAGE = server.resolvedUrls.local[0];
// (A map of its own, the same every run: a new Sandbox's is random, and the pathfinder that lays the setup's track
// can be boxed in on some.)
const SEEDED = `${PAGE.replace(/\/$/, "")}/#seed-24`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (The game's test clock: trains, loads and animations keep up with real time under SwiftShader. lib/fast.mjs.)
testClockIn(b);
// (At a device scale of 1, not 2: no check looks at pixels, the layout is in CSS pixels either way, and a frame at 2
// costs SwiftShader half as much again. E2E_PHONE_DPR=2: as before.)
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.E2E_PHONE_DPR ?? 1), hasTouch: true, isMobile: true });
await ctx.addInitScript(() => {
  localStorage.setItem("woodrail.helpSeen", "1");
  window.__allClicks = 0;
  window.addEventListener("click", () => window.__allClicks++, { capture: true });
});
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
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
    return { x: q.x + Math.cos(q.heading) * 108, y: piece.y, z: q.z + Math.sin(q.heading) * 108 };
  }, what);
const onScreen = (v) =>
  p.evaluate((v) => {
    const w = window.woodrail;
    const c = new w.camera.position.constructor(v.x, v.y, v.z).project(w.camera);
    return [((c.x + 1) / 2) * innerWidth, ((1 - c.y) / 2) * innerHeight];
  }, v);
const glide = async (v, dist) => {
  await p.evaluate(([v, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(v.x, v.y ?? 0, v.z), dist, { duration: 0.2 }), [v, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
const tapOn = async (what, dist = 1300) => {
  const v = await worldAt(what);
  await glide(v, dist);
  const [x, y] = await onScreen(v);
  await tapped(() => p.touchscreen.tap(x, y));
};
/**
 * Tap a train's engine where the game's own pick finds it (as e2e:train-summary's `tapPointOn`), the view stopped on it,
 * till its card is open.
 */
const tapEngine = async (engine, dist = 700) => {
  for (let k = 0; k < 3; k++) {
    await p.waitForFunction((id) => (window.woodrail.invalidate(), !!window.woodrail.trainView.carObject(id)), engine, { timeout: 60000, polling: 500 }).catch(() => {});
    await glide(await worldAt({ engine }), dist);
    await settle();
    const at = await p.evaluate((id) => {
      const w = window.woodrail;
      const o = w.trainView.carObject(id);
      if (!o) return null;
      const v = o.getWorldPosition(new w.camera.position.constructor()).project(w.camera);
      const cx = ((v.x + 1) / 2) * innerWidth;
      const cy = ((1 - v.y) / 2) * innerHeight;
      const spots = [];
      for (let dx = -36; dx <= 36; dx += 6) for (let dy = -36; dy <= 36; dy += 6) spots.push([cx + dx, cy + dy]);
      spots.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      for (const [x, y] of spots) {
        if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1 || document.elementFromPoint(x, y) !== w.canvas) continue;
        const hit = w.interaction.pick(x, y, true);
        if (hit?.kind === "car" && hit.carId === id) return [x, y];
      }
      return null;
    }, engine);
    if (at) await tapped(() => p.touchscreen.tap(at[0], at[1]));
    await p.waitForFunction(() => window.woodrail.hud.engineCardOpen, null, { timeout: 15000 }).catch(() => {});
    if (await p.evaluate(() => window.woodrail.hud.engineCardOpen)) return true;
  }
  return false;
};
/** A card button, once it's drawn and has stood still past the card tap guard. */
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
const toasts = () => p.evaluate(() => [...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" | "));
const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
const held = () =>
  p.evaluate(() => {
    const m = window.woodrail.interaction.mode;
    return m?.kind === "drag-piece" ? { blocked: !!m.blocked, visible: m.ghost.visible, pose: m.pose ? { x: m.pose.x, z: m.pose.z, heading: m.pose.heading } : null } : null;
  });
/** The screen point of a piece pose's middle (on the ground). */
const middleOnScreen = (q) => onScreen({ x: q.x + Math.cos(q.heading) * 108, y: 0, z: q.z + Math.sin(q.heading) * 108 });
/**
 * Drag an industry out of the tray by touch onto open ground near `near` (a screen point): moved about until the held
 * piece reads clear twice in a row, then lifted. Returns the chain hints shown while it was held, and the depot added.
 */
const dragFromTray = async (key, near, want = null) => {
  const tile = await p.evaluate((key) => {
    const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
    if (!e) return null;
    e.scrollIntoView({ inline: "center", block: "nearest" });
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, key);
  if (!tile) return { error: `no tray item ${key}` };
  await p.waitForTimeout(300);
  const before = await p.evaluate(() => window.woodrail.economy.allDepots().length);
  let t = Date.now() / 1000;
  await touch("touchStart", tile[0], tile[1], t);
  await touch("touchMove", tile[0], tile[1] - 30, (t += 0.04));
  const steps = 10;
  for (let k = 1; k <= steps; k++) await touch("touchMove", tile[0] + ((near[0] - tile[0]) * k) / steps, tile[1] - 30 + ((near[1] - tile[1] + 30) * k) / steps, (t += 0.02));
  await frames();
  let at = near;
  // A spot chosen for the held piece's own heading (`want`, the game's placement check): the finger steered until the
  // held piece is there (it rides above the finger), a few rounds.
  const h0 = await held();
  const target = want && h0?.pose ? await want(h0.pose.heading) : null;
  if (target) {
    at = await middleOnScreen(target);
    for (let k = 0; k < 4; k++) {
      await touch("touchMove", at[0], at[1], Math.max(Date.now() / 1000, (t += 0.02)));
      await frames();
      await frames();
      const h = await held();
      if (!h?.pose) break;
      const [gx, gy] = await middleOnScreen(h.pose);
      const [tx, ty] = await middleOnScreen(target);
      if (Math.hypot(gx - tx, gy - ty) < 3) break;
      at = [at[0] + tx - gx, at[1] + ty - gy];
    }
    near = at;
  }
  let hints = "";
  let clear = 0;
  for (let k = 0; k < 40 && clear < 2; k++) {
    const a = k * 2.4;
    const r = 14 * Math.sqrt(k);
    at = [near[0] + Math.cos(a) * r, near[1] + Math.sin(a) * r];
    await touch("touchMove", at[0], at[1], Math.max(Date.now() / 1000, (t += 0.02)));
    await frames();
    for (clear = 0; clear < 2; ) {
      const h = await held();
      if (!h || h.blocked || !h.visible) break;
      clear++;
      await frames();
    }
    hints = await p.evaluate(() => window.woodrail.chainHints.shown);
  }
  await touch("touchEnd", at[0], at[1], Math.max(Date.now() / 1000, t + 0.02));
  await frames();
  await p.waitForTimeout(500);
  const added = await p.evaluate((n) => window.woodrail.economy.allDepots().slice(n).map((d) => ({ id: d.id, role: d.role })), before);
  return { hints, added, clear };
};
/** Open map points (canvas on top, nothing to pick, ground under it) near the middle. */
const openPoint = (fy = 0.4) =>
  p.evaluate((fy) => {
    const w = window.woodrail;
    for (let dy = 0; dy <= 0.2; dy += 0.03)
      for (const sy of [1, -1])
        for (let fx = 0.3; fx <= 0.7; fx += 0.05) {
          const x = Math.round(innerWidth * fx);
          const y = Math.round(innerHeight * (fy + sy * dy));
          if (document.elementFromPoint(x, y) === w.canvas && !w.interaction.pick(x, y) && w.interaction.groundAt(x, y)) return [x, y];
        }
    return null;
  }, fy);

try {
  // 1. A new Sandbox.
  await p.goto(SEEDED);
  // (As e2e:ramps: a linked map's title card offers Sandbox's button; it may already be playing.)
  await p.waitForFunction(() => !!window.woodrail && (document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null || window.woodrail.mode?.() === "sandbox"), null, { timeout: 240000 });
  await p.evaluate(() => window.woodrail.title.shown && document.querySelector(".title-card.mode-sandbox .title-buttons .primary")?.click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await settle();
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  await frames();

  // 2. The Industries tab, tapped: its tip, and the industries (not Game mode's workshop or school).
  const tabAt = await p.evaluate(() => {
    const t = document.querySelector('.tray .tabs .tab[data-tab="industries"]');
    if (!t) return null;
    t.scrollIntoView({ inline: "center", block: "nearest" });
    const r = t.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2, r.height];
  });
  check("Sandbox has an Industries tab", !!tabAt);
  await tapped(() => p.touchscreen.tap(tabAt[0], tabAt[1]));
  await p.waitForFunction(() => /Pick one up: gold rings/.test([...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" ")), null, { timeout: 20000 }).catch(() => {});
  check("…tapped, its tip says what industries do and what the rings mean (once)", /Industries make goods.*gold rings.*green rings/.test(await toasts()), await toasts());
  const items = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-item")].map((e) => e.dataset.key));
  check("…it holds the industries: a Harvester, Sawmill, Mill, Dairy farm and Bakery, and no workshop or school", ["forest", "sawmill", "mill", "dairy", "bakery"].every((r) => items.includes(`piece:depot-${r}`)) && !items.includes("piece:depot-workshop") && !items.includes("piece:depot-school"), items.join(" "));
  await shot("1-industries-tab");

  // 3. Somewhere open near a town, framed; a Harvester and a Sawmill dragged out there by touch.
  // (`trees`: a harvester works only by trees, as in Game mode: the spot must have them in its reach, by the game's own
  // `siteWhy`.)
  const findArea = (skip, trees = false) => p.evaluate(async ({ skip, trees }) => {
    const w = window.woodrail;
    const { siteWhy } = await import("/src/game/industries.ts");
    const wooded = (x, z) => [0, Math.PI / 2, Math.PI, -Math.PI / 2].some((h) => siteWhy(w.landscape, "depot-forest", { x, z, heading: h }) === null && !w.interaction.placement("depot-forest", false, { x, z, heading: h }, 0, -1).reason);
    for (const t of w.landscape.towns) {
      if (t.id === skip) continue;
      const st = w.layout.getPiece(w.stations.get(t.id)).pose;
      for (let ring = 3; ring < 14; ring++)
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const x = Math.round((st.x + Math.cos(a) * ring * 120) / 18) * 18;
          const z = Math.round((st.z + Math.sin(a) * ring * 120) / 18) * 18;
          // Room for two yards side by side, a few hundred mm apart.
          const ok = [-300, 0, 300].every((dx) => [-200, 0, 200].every((dz) => [0, Math.PI / 2, Math.PI, -Math.PI / 2].some((h) => !w.interaction.placement("depot-sawmill", false, { x: x + dx, z: z + dz, heading: h }, 0, -1).reason)));
          if (ok && (!trees || wooded(x, z))) return { x, z, town: t.id };
        }
    }
    return null;
  }, { skip, trees });
  const area = await findArea(-1, true);
  check("an open spot by trees near a town for two industries", !!area, JSON.stringify(area));
  await glide({ x: area.x, y: 0, z: area.z }, 1500);
  const [cx, cy] = await onScreen({ x: area.x, y: 0, z: area.z });
    // (One ahead of the other along the view's heading, as the tray turns them: track joins them end to end.)
  /** A clear pose for `type` at the held heading: the area itself, or (`ahead`) straight on from a depot's piece. */
  const spotFor = (type, ahead = -1) => (heading) =>
    p.evaluate(
      async ({ type, ahead, heading, area }) => {
        const w = window.woodrail;
        const { siteWhy } = await import("/src/game/industries.ts");
        // (Clear to put down, and where it works: a harvester by trees.)
        const ok = (q) => !w.interaction.placement(type, false, q, 0, -1).reason && siteWhy(w.landscape, type, q) === null;
        const snap = (v) => Math.round(v / 18) * 18;
        if (ahead >= 0) {
          const from = w.layout.getPiece(w.economy.depot(ahead).pieceId).pose;
          for (let d = 650; d <= 1100; d += 72)
            for (const sign of [1, -1]) {
              const q = { x: snap(from.x + Math.cos(from.heading) * d * sign), z: snap(from.z + Math.sin(from.heading) * d * sign), heading: from.heading };
              if (ok(q)) return q;
            }
          return null;
        }
        for (let r = 0; r < 600; r += 36)
          for (let k = 0; k < 8; k++) {
            const q = { x: snap(area.x + Math.cos(k) * r), z: snap(area.z + Math.sin(k) * r), heading };
            if (ok(q)) return q;
          }
        return null;
      },
      { type, ahead, heading, area },
    );
  const forest = await dragFromTray("piece:depot-forest", [cx, cy - 160], spotFor("depot-forest"));
  check("a Harvester dragged from the tray is put down (a forest yard)", forest.added?.some((d) => d.role === "forest"), JSON.stringify(forest));
  const forestRate = await p.evaluate((id) => window.woodrail.economy.depot(id)?.rate ?? -1, forest.added?.find((d) => d.role === "forest")?.id ?? -1);
  check("…by trees, it works", forestRate > 0, `rate ${forestRate}`);
  check("…held, nothing it needs (it makes logs from nothing): only green rings round where logs go", /oout/.test(forest.hints) && !/oin/.test(forest.hints), forest.hints);
  // (The next piece waits at its end: a tap on open ground puts it away.)
  const open1 = await openPoint(0.3);
  if (open1) await tapped(() => p.touchscreen.tap(open1[0], open1[1]));
  await p.waitForFunction(() => /Tap it to see what it needs/.test([...document.querySelectorAll(".toast")].map((t) => t.textContent).join(" ")), null, { timeout: 15000 }).catch(() => {});
  check("…put down, the first one: a tip says to tap it, join it by track and run a train with the right wagons", /Tap it to see what it needs.*right wagons/.test(await toasts()), await toasts());
  const forestDepot = forest.added?.find((d) => d.role === "forest")?.id ?? -1;
  // (Framed on the forest and the room straight on from it, where the sawmill will go.)
  if (forestDepot >= 0) {
    const fq = await p.evaluate((id) => window.woodrail.layout.getPiece(window.woodrail.economy.depot(id).pieceId).pose, forestDepot);
    await glide({ x: fq.x + Math.cos(fq.heading) * 600, y: 0, z: fq.z + Math.sin(fq.heading) * 600 }, 2300);
  }
  const mill = await dragFromTray("piece:depot-sawmill", [cx, cy + 260], forestDepot >= 0 ? spotFor("depot-sawmill", forestDepot) : null);
  check("a Sawmill dragged from the tray is put down", mill.added?.some((d) => d.role === "sawmill"), JSON.stringify(mill));
  check("…held: gold rings round forests (logs come from there), green round towns (planks go there)", /oin/.test(mill.hints) && /oout/.test(mill.hints), mill.hints);
  const open2 = await openPoint(0.3);
  if (open2) await tapped(() => p.touchscreen.tap(open2[0], open2[1]));
  const hiddenAfter = await p.evaluate(() => !window.woodrail.chainHints.showing);
  check("…put down: the rings are gone", hiddenAfter);
  await shot("2-placed");
  const forestId = forest.added.find((d) => d.role === "forest").id;
  const millId = mill.added.find((d) => d.role === "sawmill").id;

  // 4. Setup (not what's tested): track forest → sawmill → the town's station, by the player's own pathfinder.
  const setup = await p.evaluate(
    async ({ forestId, millId, town }) => {
      const { play } = await import("/src/play/player.ts");
      const { rulesFor } = await import("/src/play/rules.ts");
      const { connectorRef } = await import("/src/track/layout.ts");
      const w = window.woodrail;
      const pieceOf = (d) => w.economy.depot(d).pieceId;
      const sp = w.layout.getPiece(pieceOf(millId)).pose;
      // (The area's town first, then the others by how near they are.)
      const stations = [...w.stations.entries()].sort(([ta, a], [tb, b]) => (ta === town ? -1 : tb === town ? 1 : 0) || Math.hypot(w.layout.getPiece(a).pose.x - sp.x, w.layout.getPiece(a).pose.z - sp.z) - Math.hypot(w.layout.getPiece(b).pose.x - sp.x, w.layout.getPiece(b).pose.z - sp.z)).map(([, id]) => id);
      const lay = (a, b) => {
        const before = new Set(w.layout.pieceIds());
        for (const [i, j] of [[1, 0], [1, 1], [0, 0], [0, 1]]) {
          if (w.layout.joinedConnector(connectorRef(a, i)) !== -1 || w.layout.joinedConnector(connectorRef(b, j)) !== -1) continue;
          const r = play(w.world.layout, w.editor(), connectorRef(a, i), connectorRef(b, j), { blocked: rulesFor(w.world), maxPieces: 80, fiddle: 3 });
          if (r.ok) return [...w.layout.pieceIds()].filter((id) => !before.has(id));
        }
        return null;
      };
      const a = lay(pieceOf(forestId), pieceOf(millId));
      let c = null;
      let station = -1;
      for (const st of a ? stations.slice(0, 4) : []) {
        c = lay(pieceOf(millId), st);
        if (c) {
          station = st;
          break;
        }
      }
      w.changed?.();
      const { CARGO } = await import("/src/economy/cargo.ts");
      window.__CARGO = CARGO;
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
      return { toMill: a, toTown: c, town: w.economy.depotAtPiece(station)?.id };
    },
    { forestId, millId, town: area.town },
  );
  check("setup: track forest → sawmill → town", !!setup.toMill && !!setup.toTown && setup.town !== undefined, JSON.stringify({ toMill: setup.toMill?.length, toTown: setup.toTown?.length, town: setup.town }));

  // 5. The sawmill's card: waiting for logs, where logs come from (Show), where planks go; chevrons on the map.
  await tapOn({ depot: millId }, 1100);
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  if (!(await p.evaluate(() => window.woodrail.hud.depotCardOpen))) await tapOn({ depot: millId }, 900);
  await p.waitForTimeout(600);
  // (Measured once it has popped in: `card-in` scales it from 0.96.)
  await p.evaluate(() => Promise.all(document.querySelector(".depot-card").getAnimations({ subtree: true }).map((a) => a.finished)));
  const card = await p.evaluate(() => {
    const c = document.querySelector(".depot-card");
    return {
      title: c.querySelector(".card-title")?.textContent,
      status: c.querySelector(".chain-status")?.textContent ?? null,
      rows: [...c.querySelectorAll(".chain-row")].map((r) => ({ text: r.querySelector(".chain-text").textContent, show: Number(r.querySelector(".chain-show")?.dataset.depot ?? -1), h: r.querySelector(".chain-show")?.offsetHeight ?? 0 })),
    };
  });
  const logs = card.rows.find((r) => /Logs from the Forest yard/.test(r.text));
  const planks = card.rows.find((r) => /Planks go to /.test(r.text));
  const roleOf = (id) => p.evaluate((id) => window.woodrail.economy.depot(id)?.role, id);
  check("the sawmill's card: waiting for logs", card.status === "Waiting for logs", JSON.stringify(card));
  check("…says where logs come from: the forest yard, with Show", !!logs && (await roleOf(logs.show)) === "forest", JSON.stringify(card.rows));
  check("…and where planks go: a town, with Show", !!planks && (await roleOf(planks.show)) === "town", JSON.stringify(card.rows));
  check("…its Show buttons are a finger tall (44 px)", card.rows.every((r) => r.show < 0 || r.h >= 44), JSON.stringify(card.rows.map((r) => r.h)));
  const lines = await p.evaluate(() => window.woodrail.chainHints.shown);
  check("…on the map, chevrons from a forest to it (gold) and from it to a town (green)", /in-?\d+,-?\d+>-?\d+/.test(lines) && /out-?\d+,-?\d+>-?\d+/.test(lines), lines);
  await settle();
  await shot("3-sawmill-card");
  const before = await p.evaluate(() => ({ x: window.woodrail.controls.target.x, z: window.woodrail.controls.target.z }));
  await tapButton(`.depot-chain .chain-show[data-depot="${logs.show}"]`);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 20000 }).catch(() => {});
  const there = await worldAt({ depot: logs.show });
  const after = await p.evaluate(() => ({ x: window.woodrail.controls.target.x, z: window.woodrail.controls.target.z, open: window.woodrail.hud.depotCardOpen }));
  // (The view frames it in the room above the card: its target is near, not on, the place.)
  check("…Show frames the forest it names, and the card stays open", after.open && Math.hypot(after.x - there.x, after.z - there.z) < 700 && Math.hypot(after.x - before.x, after.z - before.z) > 1, JSON.stringify({ before, after, there }));
  await settle();
  await shot("4-show-forest");

  // 6. Idle: the game paused, the card and hints up: no frames drawn.
  await p.evaluate(() => (window.woodrail.paused = true));
  await settle();
  const f0 = await p.evaluate(() => window.woodrail.framesDrawn);
  await p.waitForTimeout(3000);
  const f1 = await p.evaluate(() => window.woodrail.framesDrawn);
  check("with nothing moving, the card and hints open: no frames drawn", f1 - f0 <= 1, `${f1 - f0} frames in 3 s`);
  await p.evaluate(() => (window.woodrail.paused = false));
  await p.evaluate(() => window.woodrail.hud.hideCards());
  check("the card put away: the chevrons go", await p.evaluate(() => !window.woodrail.chainHints.showing));

  // 7. A train of coaches at the forest: its card says it needs a flatbed for the logs.
  const coach = await p.evaluate(
    ({ forestId }) => {
      const w = window.woodrail;
      const piece = w.economy.depot(forestId).pieceId;
      w.economy.depot(forestId).piles[window.__CARGO.log.index] = 3;
      for (let s = 0; s <= 216; s += 12)
        for (const reversed of [false, true]) {
          const r = w.sim.addTrain(["engine", "passenger"], { pieceId: piece, pathIndex: 0, reversed, s });
          if (r.kind !== "placed") continue;
          const t = w.sim.getTrain(r.trainId);
          if (t.bogies.some((b) => b.pieceId === piece)) {
            w.sim.setLever(t.cars[0].id, 0);
            w.invalidate();
            return { train: r.trainId, engine: t.cars[0].id };
          }
          w.sim.removeTrain(r.trainId);
        }
      return null;
    },
    { forestId },
  );
  check("setup: a train of coaches standing at the forest", !!coach);
  await tapEngine(coach.engine);
  await p.waitForFunction(() => /flatbed/.test(document.querySelector(".engine-card .engine-status")?.textContent ?? ""), null, { timeout: 20000 }).catch(() => {});
  const status = await p.evaluate(() => document.querySelector(".engine-card .engine-status")?.textContent ?? "");
  check("…its card: it needs a flatbed for the forest yard's logs", /^Needs a flatbed for logs: add one to this train$/.test(status), JSON.stringify(status));
  await shot("5-coaches-at-forest");
  await p.evaluate((id) => {
    window.woodrail.hud.hideCards();
    window.woodrail.sim.removeTrain(id);
    window.woodrail.invalidate();
  }, coach.train);

  // 8. A flatbed train with stops forest → sawmill → town, planned by taps: logs in, planks out to the town.
  const engine = await p.evaluate(
    ({ ids }) => {
      const w = window.woodrail;
      for (const id of ids)
        for (const s of [0, 20, 60, 100]) {
          if (w.layout.getPiece(id)?.type !== "straight-216") continue;
          const r = w.sim.addTrain(["engine", "timber", "timber"], { pieceId: id, pathIndex: 0, reversed: false, s });
          if (r.kind !== "placed") continue;
          const e = w.sim.getTrain(r.trainId).cars[0].id;
          w.sim.setLever(e, 0);
          w.invalidate();
          return e;
        }
      return -1;
    },
    { ids: [...setup.toMill, ...setup.toTown] },
  );
  check("setup: a flatbed train on the track", engine !== -1);
  check("…tapped, its card opens", await tapEngine(engine));
  await tapButton(".engine-extra .route-plan");
  for (const d of [forestId, millId, setup.town]) await tapOn({ depot: d }, 1300);
  await tapButton(".line-sheet .route-plan.on");
  const stops = await p.evaluate((e) => window.woodrail.economy.routeOf(e)?.stops.map((s) => s.depotId) ?? null, engine);
  check("…its route planned by taps: forest, sawmill, town", JSON.stringify(stops) === JSON.stringify([forestId, millId, setup.town]), JSON.stringify(stops));
  await p.evaluate((e) => window.woodrail.sim.setLever(e, 1), engine);
  const got = { loaded: {}, unloaded: {} };
  const town0 = await p.evaluate((t) => window.woodrail.economy.delivered.get(window.woodrail.economy.depot(t).townId) ?? 0, setup.town);
  for (let k = 0; k < 20; k++) {
    const n = await p.evaluate(() => window.__run(30));
    for (const kind of ["loaded", "unloaded"]) for (const [key, v] of Object.entries(n[kind])) got[kind][key] = (got[kind][key] ?? 0) + v;
    if ((got.unloaded[`${setup.town}:planks`] ?? 0) > 0) break;
  }
  check("…it loads logs at the forest", (got.loaded[`${forestId}:log`] ?? 0) > 0, JSON.stringify(got));
  check("…drops them at the sawmill, and takes planks on", (got.unloaded[`${millId}:log`] ?? 0) > 0 && (got.loaded[`${millId}:planks`] ?? 0) > 0, JSON.stringify(got));
  const town1 = await p.evaluate((t) => window.woodrail.economy.delivered.get(window.woodrail.economy.depot(t).townId) ?? 0, setup.town);
  check("…and delivers planks to the town", (got.unloaded[`${setup.town}:planks`] ?? 0) > 0 && town1 > town0, `delivered ${town0} → ${town1}`);
  await p.evaluate(() => window.woodrail.hud.hideCards());
  await tapOn({ depot: millId }, 1100);
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  const working = await p.evaluate(() => document.querySelector(".depot-card .chain-status")?.textContent ?? "");
  check("…the sawmill's card now says how it's doing (working, or full of planks for a train)", /^(Working|Full of planks: a train can take them|Waiting for logs)$/.test(working), working);
  await settle();
  await shot("6-running");
  await p.evaluate(() => window.woodrail.hud.hideCards());

  // 9. A bakery: its card says what's missing and which industry makes it.
  await p.evaluate(() => window.woodrail.hud.openTrayTab("industries"));
  // (Near another town: the first spot is full of track by now.)
  const area2 = (await findArea(area.town)) ?? area;
  await glide({ x: area2.x, y: 0, z: area2.z }, 1500);
  const spot = await onScreen({ x: area2.x, y: 0, z: area2.z });
  const bakery = await dragFromTray("piece:depot-bakery", spot);
  const bakeryId = bakery.added?.find((d) => d.role === "bakery")?.id;
  check("a Bakery dragged from the tray is put down", bakeryId !== undefined, JSON.stringify(bakery));
  const open3 = await openPoint(0.3);
  if (open3) await tapped(() => p.touchscreen.tap(open3[0], open3[1]));
  if (bakeryId !== undefined) {
    await tapOn({ depot: bakeryId }, 1100);
    await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
    const rows = await p.evaluate(() => [...document.querySelectorAll(".depot-card .chain-text")].map((e) => e.textContent));
    check("…its card: flour and milk, none made yet; place a Mill and a Dairy farm", rows.some((r) => /Flour: none made on the map yet\. Place a Mill/.test(r)) && rows.some((r) => /Milk: none made on the map yet\. Place a Dairy farm/.test(r)), JSON.stringify(rows));
    await settle();
    await shot("7-bakery-card");
  }

  // 10. ☰ Chain hints off: no chain on the card, no hints on the map; on again.
  await tapButton(".top-bar button[aria-label='Menu'], button[aria-label='Menu']");
  await tapButton(".menu .chain-item");
  await tapOn({ depot: millId }, 1100);
  await p.waitForFunction(() => window.woodrail.hud.depotCardOpen, null, { timeout: 20000 }).catch(() => {});
  const off = await p.evaluate(() => ({ chain: !document.querySelector(".depot-card .depot-chain")?.hidden, hints: window.woodrail.chainHints.showing, item: document.querySelector(".menu .chain-item")?.textContent, saved: localStorage.getItem("woodrail.chainHints") }));
  check("☰ Chain hints off: the card has no chain block, the map no hints, and it's kept", !off.chain && !off.hints && off.item === "Chain hints: off" && off.saved === "0", JSON.stringify(off));
  await p.evaluate(() => window.woodrail.hud.hideCards());
  await tapButton("button[aria-label='Menu']");
  await tapButton(".menu .chain-item");
  check("…and on again", (await p.evaluate(() => document.querySelector(".menu .chain-item")?.textContent)) === "Chain hints: on");
} catch (e) {
  failures++;
  console.log("FAIL (threw)", e.message);
}

// 11. Desktop: the sawmill's card at 1440×900. (The phone's page closed first: its trains would keep SwiftShader busy.)
await ctx.close().catch(() => {});
try {
  const dctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await dctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  const d = await dctx.newPage();
  await d.goto(PAGE, { timeout: 180000 });
  await d.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await d.evaluate(() => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await d.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await d.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  const desk = await d.evaluate(async () => {
    const w = window.woodrail;
    const mill = w.economy.allDepots().find((x) => x.role === "sawmill");
    w.interaction.openDepot(mill.id);
    await new Promise((r) => setTimeout(r, 800));
    return { rows: [...document.querySelectorAll(".depot-card .chain-text")].map((e) => e.textContent), status: document.querySelector(".depot-card .chain-status")?.textContent, hints: w.chainHints.showing };
  });
  check("desktop: the map's own sawmill's card says where logs come from and planks go, with hints on the map", desk.rows.some((r) => /Logs from the Forest yard/.test(r)) && desk.rows.some((r) => /Planks go to/.test(r)) && desk.hints, JSON.stringify(desk));
  await d.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await d.screenshot({ path: `${OUT}/8-desktop-sawmill.png`, timeout: 120000 }).catch(() => {});
  await dctx.close();
} catch (e) {
  failures++;
  console.log("FAIL (desktop threw)", e.message);
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
