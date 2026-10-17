// End-to-end track props (kits and lineside furniture) in Sandbox (`npm run e2e:kits`): lines built programmatically
// with kits in them, trains stepped through (sim and economy ticked directly: headless frames are slow), kits' moving
// parts updated by hand as the game would. Each line is built on clear ground: what was built before it (its pieces,
// props and trains, already checked and photographed) is taken up first, so the build search, outwards from the middle
// of the mat in rings, always finds room whatever the Sandbox map's random scenery (it was running out after ~40
// lines). The idle and perf groups run with the last line (the roundhouse, a moving kit) still down.
//
// Usage: npm run e2e:kits [-- <out dir> [group,group,...]]   (default out: e2e-out/kits; groups: all)
// Groups: tray, halt, terminus, shed, service, goods, lineside, roundhouse, stations, idle, perf.
// Starts its own dev server (on 5351, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own (`npx playwright-core install chromium`).
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/kits";
const ONLY = new Set((process.argv[3] ?? "").split(",").filter(Boolean));
const want = (name) => ONLY.size === 0 || ONLY.has(name);
mkdirSync(OUT, { recursive: true });
const started = Date.now();
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5351, strictPort: false }, logLevel: "error" });
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

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((b) => !b.hidden && b.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));

const idleFrames = () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    w.invalidate();
    await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
    await new Promise((r) => setTimeout(r, 1000));
    const f0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 15000));
    return w.framesDrawn - f0;
  });

const idleBefore = await idleFrames();
console.log("idle frames over 15 s before any kit:", idleBefore);

// Helpers in the page: build a line of pieces from somewhere clear, each joined to the last one's `next` end.
await p.evaluate(() => {
  const w = window.woodrail;
  // Build, then wait for the kits' models (as the game would have by the time a train gets there).
  w.__build = async (seq, nextEnd = {}) => {
    const r = w.__buildNow(seq, nextEnd);
    for (const type of seq) if (type.startsWith("kit-")) await w.kitView.load(type);
    w.syncKits(true);
    return r;
  };
  w.__buildNow = (seq, nextEnd = {}) => {
    const i = w.interaction;
    const c = (id, k) => w.layout.worldConnector(id * 4 + k, { x: 0, z: 0, heading: 0, y: 0, kind: "peg" });
    for (let ring = 1; ring < 20; ring++)
      for (let k = 0; k < 16; k++)
        for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          const a = (k * Math.PI) / 8;
          let t = { x: Math.round((Math.cos(a) * ring * 360) / 18) * 18, z: Math.round((Math.sin(a) * ring * 360) / 18) * 18, heading };
          const ids = [];
          let ok = true;
          let why = "";
          for (const type of seq) {
            const pose = { x: t.x, z: t.z, heading: t.heading };
            const r = i.placement(type, false, pose, 0, -1);
            if (r.reason) {
              ok = false;
              why = `${type}: ${r.reason}`;
              break;
            }
            const id = w.editor().place(type, pose, 0, false);
            ids.push(id);
            const end = nextEnd[type] ?? 1;
            if (end >= 0) t = c(id, end);
          }
          if (ok) {
            w.__mine.pieces.push(...ids);
            return { ids };
          }
          w.__lastWhy = why;
          for (const id of ids.reverse()) w.editor().remove(id);
        }
    return null;
  };
  // Step the world n ticks (the game's own loop paused), updating kits' moving parts as the frame loop would.
  w.__step = (n, each) => {
    w.paused = true;
    for (let k = 0; k < n; k++) {
      w.sim.tick();
      w.economy.tick();
      if (k % 2 === 1) w.kitView.update(w.kitTriggered, 2 / 120);
      if (each && each(k) === true) return k;
    }
    return n;
  };
  w.__train = (cars, at) => {
    const placed = w.sim.addTrain(cars, at);
    if (placed.kind !== "placed") return null;
    const id = w.sim.trainIds().at(-1);
    const t = w.sim.getTrain(id);
    w.sim.setLever(t.cars.find((c) => c.kind === "engine").id, 1);
    return id;
  };
  w.__look = (pieceId, dist = 420) => {
    const pose = w.layout.getPiece(pieceId).pose;
    w.director.glideTo(new w.camera.position.constructor(pose.x, 0, pose.z), dist, { duration: 0.1 });
  };
  w.__clear = () => {
    for (const id of w.sim.trainIds()) w.sim.removeTrain?.(id);
  };
  // What this run has built (pieces, props), so a group can take up what the one before it left.
  w.__mine = { pieces: [], props: [] };
  w.__reset = () => {
    w.__clear();
    w.interaction.clearSelection?.();
    w.hud.hideCards?.();
    for (const id of w.__mine.props) if (w.props.get(id)) w.props.remove(id);
    if (w.__mine.props.length) w.propsChanged();
    const pieces = w.__mine.pieces.filter((id) => w.layout.getPiece(id));
    if (pieces.length) w.editor().removeGroup(pieces);
    w.__mine = { pieces: [], props: [] };
    w.syncKits(true);
    return { pieces: pieces.length, left: w.layout.pieceIds().filter((id) => pieces.includes(id)).length };
  };
});

/** Before a group that builds: take up what the group before built, and wait for the scene to settle. */
const fresh = async (group) => {
  const r = await p.evaluate(() => window.woodrail.__reset());
  if (r.left) check(`${group}: cleared the previous group's pieces`, false, JSON.stringify(r));
  await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
};

const results = {};

if (want("tray")) {
  // The Sandbox shelves offer the kits as pieces, with their pictures: Buildings → Railway, Machines → Railway & yard.
  const clickText = async (selector, text) => {
    const box = await p.evaluate(
      ({ selector, text }) => {
        const el = [...document.querySelectorAll(selector)].find((e) => e.textContent.trim().startsWith(text));
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
  for (const [tab, shelf, want, name] of [
    ["Buildings", "Railway", ["kit-country-halt", "kit-grand-terminus", "kit-engine-shed", "kit-castle-gate", "kit-water-tower", "kit-goods-shed"], "tray-buildings-railway"],
    ["Machines", "Railway & yard", ["kit-gantry-crane", "kit-log-loader", "kit-water-crane", "kit-fuel-station", "kit-weighbridge", "kit-magnet-crane"], "tray-machines-railway"],
  ]) {
    // (A tab with one shelf shows its items straight away.)
    const opened = (await clickText("button", tab)) && ((await clickText(".tray-item.tray-group", shelf)) || true);
    let keys = [];
    try {
      await p.waitForFunction(() => [...document.querySelectorAll(".tray-item[data-key^='piece:kit-']")].every((i) => i.querySelector("img")), null, { timeout: 180000, polling: 1000 });
    } catch {
      /* reported below */
    }
    keys = await p.evaluate(() => [...document.querySelectorAll(".tray-item[data-key]")].map((b) => [b.dataset.key, !!b.querySelector("img")]));
    const kits = keys.filter(([k]) => k.startsWith("piece:kit-"));
    check(`tray: ${tab} → ${shelf} offers the kits as pieces, with pictures`, opened && want.every((k) => kits.some(([key]) => key === `piece:${k}`)) && kits.every(([, img]) => img), JSON.stringify({ opened, kits }));
    await shot(name);
  }
  await clickText("button", "Track");
}

if (want("halt")) {
  await fresh("halt");
  // A halt and the castle gate on one line: a passenger train stops at the halt; the gate's portcullis rises for it.
  const built = await p.evaluate(() => window.woodrail.__build(["buffer-turnback", "straight-216", "kit-country-halt", "straight-216", "kit-castle-gate", "straight-216", "straight-216", "buffer-turnback"], { "buffer-turnback": 0 }));
  check("built a line with the halt and castle gate", !!built, built ? JSON.stringify(built) : await p.evaluate(() => window.woodrail.__lastWhy));
  if (built) {
    const r = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      const halt = ids[2];
      const gate = ids[4];
      const tid = w.__train(["engine", "passenger"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 150 });
      if (tid === null) return { error: "no train" };
      let halted = -1;
      let left = false;
      let gateMoved = false;
      let gateLive = 0;
      let portcullisMax = 0;
      let settled = false;
      const trace = [];
      const n = w.__step(120 * 30, (k) => {
        const t = w.sim.getTrain(w.sim.trainIds()[0]);
        if (halted < 0 && w.economy.kitStops.dwelling(t.id) && t.bogies[0].pieceId === halt) halted = k;
        if (halted >= 0 && !left && t.speed > 0) left = true;
        if (w.kitView.animating) gateMoved = true;
        const live = w.kitView.group.children.filter((c) => c.name === "movers");
        gateLive = Math.max(gateLive, live.length);
        for (const g of live) {
          const pc = g.getObjectByName("portcullis");
          if (pc) portcullisMax = Math.max(portcullisMax, pc.position.y);
        }
        if (gateMoved && live.length === 0 && t.bogies.every((b) => b.pieceId !== gate)) settled = true;
        if (k % 30 === 0 && trace.length < 50) trace.push([t.id, t.bogies[0].pieceId, Math.round(t.bogies[0].s), Math.round(t.speed), live.length, w.kitView.animating ? 1 : 0, w.sim.pieceOccupied(gate) ? 1 : 0]);
        return settled;
      });
      w.paused = false;
      return { halted, left, gateMoved, gateLive, portcullisMax: Math.round(portcullisMax), ticks: n, settled, trace: JSON.stringify(trace) };
    }, built);
    check("passenger train halts at the country halt", r.halted >= 0, JSON.stringify(r));
    check("and goes on after its dwell", r.left);
    check("the portcullis rose while the train passed (drawn live)", r.gateMoved && r.portcullisMax >= 60);
    check("and settled back once the train was through: no live parts left", r.settled);
    results.halt = built;
    await p.evaluate((id) => window.woodrail.__look(id, 380), built.ids[3]);
    await p.waitForTimeout(2500);
    await shot("halt-and-gate");
  }
}

if (want("terminus")) {
  await fresh("terminus");
  const built = await p.evaluate(() => window.woodrail.__build(["buffer-turnback", "straight-216", "straight-216", "kit-grand-terminus"], { "buffer-turnback": 0, "kit-grand-terminus": -1 }));
  check("built a line into the terminus", !!built, built ? JSON.stringify(built) : await p.evaluate(() => window.woodrail.__lastWhy));
  if (built) {
    const r = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      const term = ids[3];
      w.__clear();
      const tid = w.__train(["engine", "passenger", "passenger"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 200 });
      if (tid === null) return { error: "no train" };
      let halts = 0;
      const trace = [];
      let was = false;
      let turned = false;
      let out = false;
      w.__step(120 * 40, () => {
        const t = w.sim.getTrain(w.sim.trainIds()[0]);
        const d = w.economy.kitStops.dwelling(t.id);
        if (d && !was) halts++;
        was = d;
        if (t.id !== tid && t.lastTurn?.cause === "buffer") turned = true;
        if (turned && t.bogies.every((b) => b.pieceId !== term)) out = true;
        if (trace.length < 40 && w.sim.ticks % 60 === 0) trace.push([t.id, t.bogies[0].pieceId, t.bogies[0].pathIndex, Math.round(t.bogies[0].s), t.bogies[0].reversed ? 1 : 0, Math.round(t.speed), t.turnback]);
        return out;
      });
      w.paused = false;
      return { halts, turned, out, trace: JSON.stringify(trace) };
    }, built);
    check("terminus: stops once at the platform end, turns back at the buffer, leaves", r.halts === 1 && r.turned && r.out, JSON.stringify(r));
    await p.evaluate((id) => window.woodrail.__look(id, 520), built.ids[3]);
    await p.waitForTimeout(2500);
    await shot("terminus");
  }
}

if (want("shed")) {
  await fresh("shed");
  const built = await p.evaluate(() => window.woodrail.__build(["buffer-turnback", "straight-216", "straight-216", "kit-engine-shed"], { "buffer-turnback": 0, "kit-engine-shed": -1 }));
  check("built a line into the engine shed", !!built, built ? JSON.stringify(built) : await p.evaluate(() => window.woodrail.__lastWhy));
  if (built) {
    const r = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      const shed = ids[3];
      w.__clear();
      const tid = w.__train(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
      if (tid === null) return { error: "no train" };
      let open = 0;
      let inside = false;
      w.__step(120 * 8, () => {
        const t = w.sim.getTrain(w.sim.trainIds()[0]);
        for (const g of w.kitView.group.children.filter((c) => c.name === "movers")) {
          const leaf = g.getObjectByName("leafL");
          if (leaf) open = Math.max(open, leaf.rotation.y);
        }
        if (t.bogies.every((b) => b.pieceId === shed)) inside = true;
        return inside && open > 1.4;
      });
      // Parked inside with its lever off: the doors stay open and nothing draws.
      const t = w.sim.getTrain(w.sim.trainIds()[0]);
      w.sim.setLever(t.cars[0].id, 0);
      w.__step(120 * 3);
      w.paused = false;
      return { open: Math.round(open * 100) / 100, inside, animating: w.kitView.animating };
    }, built);
    check("engine shed: doors open as the engine runs in", r.open > 1.4 && r.inside, JSON.stringify(r));
    check("engine parked inside: the open doors hold still (nothing animating)", r.animating === false);
    await p.evaluate((id) => window.woodrail.__look(id, 360), built.ids[3]);
    await p.waitForTimeout(2500);
    await shot("engine-shed");
  }
}

if (want("service")) {
  await fresh("service");
  // Engine services: a steam engine stops at the water tower (its spout swings out over it), then runs through the
  // fuel station just after (it took a service under a minute ago).
  const built = await p.evaluate(() => window.woodrail.__build(["buffer-turnback", "straight-216", "kit-water-tower", "straight-216", "kit-fuel-station", "straight-216", "buffer-turnback"], { "buffer-turnback": 0 }));
  check("built a line with the water tower and fuel station", !!built, built ? JSON.stringify(built) : await p.evaluate(() => window.woodrail.__lastWhy));
  if (built) {
    const r = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      w.__clear();
      const tower = ids[2];
      const fuel = ids[4];
      const tid = w.__train(["engine", "hopper"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 100 });
      if (tid === null) return { error: "no train" };
      const halts = [];
      let spout = 0;
      let passedFuel = false;
      w.__step(120 * 20, () => {
        const t = w.sim.getTrain(w.sim.trainIds()[0]);
        const at = w.economy.kitStops.dwellingAt(t.id);
        if (at !== -1 && !halts.includes(at)) halts.push(at);
        for (const g of w.kitView.group.children.filter((c) => c.name === "movers")) {
          const s = g.getObjectByName("spout");
          if (s) spout = Math.max(spout, s.rotation.y);
        }
        if (t.bogies.every((b) => b.pieceId === ids[5])) passedFuel = true;
        return passedFuel && !w.kitView.animating;
      });
      w.paused = false;
      return { halts: halts.map((h) => (h === tower ? "water tower" : h === fuel ? "fuel station" : h)), spout: Math.round(spout * 100) / 100, passedFuel, live: w.kitView.group.children.filter((c) => c.name === "movers").length };
    }, built);
    check("service: the steam engine stops at the water tower, its spout swung out over it", r.halts.length >= 1 && r.halts[0] === "water tower" && r.spout > 1.5, JSON.stringify(r));
    check("service: and runs through the fuel station just after (cool-down)", r.passedFuel && !r.halts.includes("fuel station"));
    check("service: the spout went back, no live parts left", r.live === 0);
    await p.evaluate((id) => window.woodrail.__look(id, 300), built.ids[2]);
    await p.waitForTimeout(2500);
    await shot("water-tower");
    await p.evaluate((id) => window.woodrail.__look(id, 300), built.ids[4]);
    await p.waitForTimeout(2500);
    await shot("fuel-station");
  }
}

if (want("goods")) {
  await fresh("goods");
  // A goods line: empty timber wagons fill with logs at the log loader (its boom working), and empty at the wagon
  // tipper (the logs vanish).
  const built = await p.evaluate(() => window.woodrail.__build(["buffer-turnback", "straight-216", "kit-log-loader", "straight-216", "kit-tipping-dump", "straight-216", "buffer-turnback"], { "buffer-turnback": 0 }));
  check("built a goods line: log loader, then wagon tipper", !!built, built ? JSON.stringify(built) : await p.evaluate(() => window.woodrail.__lastWhy));
  if (built) {
    const r = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      w.__clear();
      const loader = w.economy.depotAtPiece(ids[2]);
      const dump = w.economy.depotAtPiece(ids[4]);
      if (!loader || !dump) return { error: "no depots", loader: !!loader, dump: !!dump };
      const tid = w.__train(["engine", "timber", "timber"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 200 });
      if (tid === null) return { error: "no train" };
      const wagons = () => w.sim.getTrain(w.sim.trainIds()[0]).cars.filter((c) => c.kind === "timber").map((c) => w.economy.cargoOf(c.id));
      let full = false;
      let empty = false;
      let boom = 0;
      let shotAt = -1;
      let standing = 0;
      let anim = 0;
      const movers = [...w.kitView.movers.keys()];
      w.__step(120 * 60, (k) => {
        for (const g of w.kitView.group.children.filter((c) => c.name === "movers")) {
          const b = g.getObjectByName("boom");
          if (b) boom = Math.max(boom, Math.abs(b.rotation.y - 0.9));
        }
        if (!full && wagons().every((c) => c.kind === "log" && c.count >= 3)) full = true;
        if (full && wagons().every((c) => c.count === 0)) empty = true;
        if (shotAt < 0 && boom > 0.3) shotAt = k;
        if (w.economy.standingAt(ids[2])) standing++;
        if (w.kitView.animating) anim++;
        return empty;
      });
      w.paused = false;
      return { roles: [loader.role, dump.role], full, empty, boom: Math.round(boom * 100) / 100, heap: loader.piles.reduce((a, b) => a + b, 0), dumped: dump.piles.reduce((a, b) => a + b, 0), standing, anim, movers, liveModel: !!w.propLibrary.moversOf("kit-log-loader") };
    }, built);
    check("goods: the loader and tipper are depots of their roles", JSON.stringify(r.roles) === JSON.stringify(["loader-log", "unloader"]), JSON.stringify(r));
    check("goods: empty timber wagons fill with logs at the log loader, its boom working", r.full && r.boom > 0.3);
    check("goods: and empty at the wagon tipper, the logs gone", r.empty && r.dumped === 0);
    await p.evaluate((id) => window.woodrail.__look(id, 360), built.ids[2]);
    await p.waitForTimeout(2500);
    await shot("log-loader");
    await p.evaluate((id) => window.woodrail.__look(id, 360), built.ids[4]);
    await p.waitForTimeout(2500);
    await shot("tipping-dump");
  }
  // The other cargo machines, to look at.
  for (const seq of [
    ["buffer-turnback", "straight-216", "kit-gantry-crane", "kit-goods-shed", "kit-coal-chute", "straight-216", "buffer-turnback"],
    ["buffer-turnback", "straight-216", "kit-grain-elevator", "kit-cargo-conveyor", "straight-216", "buffer-turnback"],
    ["buffer-turnback", "straight-216", "kit-harbour-crane", "kit-drop-hopper", "kit-weighbridge", "kit-magnet-crane", "straight-216", "buffer-turnback"],
  ]) {
    // Each on clear ground: the line before it (looked at already) taken up.
    await fresh("goods");
    const b2 = await p.evaluate((seq) => window.woodrail.__build(seq, { "buffer-turnback": 0 }), seq);
    check(`built ${seq.filter((s) => s.startsWith("kit")).join(", ")}`, !!b2, b2 ? "" : await p.evaluate(() => window.woodrail.__lastWhy));
    if (b2)
      for (let i = 2; i < seq.length - 2; i++) {
        await p.evaluate((id) => window.woodrail.__look(id, 380), b2.ids[i]);
        await p.waitForTimeout(2000);
        await shot(seq[i]);
      }
  }
}

if (want("lineside")) {
  await fresh("lineside");
  // Lineside furniture: a whistle post (an engine passing whistles), a lever frame by a switch and a signal (its card
  // throws them), a station clock (its hands show the game's time).
  const built = await p.evaluate(() => window.woodrail.__build(["buffer-turnback", "straight-216", "straight-216", "straight-216", "switch", "straight-216", "signal", "straight-216", "buffer-turnback"], { "buffer-turnback": 0 }));
  check("built a line with a switch and a signal", !!built, built ? JSON.stringify(built) : await p.evaluate(() => window.woodrail.__lastWhy));
  if (built) {
    const placed = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      w.__clear();
      const at = (id, along, across) => {
        const pose = w.layout.getPiece(id).pose;
        return { x: pose.x + Math.cos(pose.heading) * along - Math.sin(pose.heading) * across, z: pose.z + Math.sin(pose.heading) * along + Math.cos(pose.heading) * across, heading: pose.heading, y: 0 };
      };
      const post = w.props.add("mech-whistle-post", at(ids[3], 108, 60));
      const frame = w.props.add("mech-lever-frame", at(ids[5], 108, -90));
      const clock = w.props.add("bldg-station-clock", at(ids[2], 108, 70));
      w.propsChanged();
      w.__mine.props.push(post.id, frame.id, clock.id);
      return { post: post.id, frame: frame.id, clock: clock.id };
    }, built);
    // Whistle: let the game run (not stepped by hand: the whistle comes from the frame loop's events).
    const whistle = await p.evaluate(async ({ ids }) => {
      const w = window.woodrail;
      let whistled = 0;
      const real = w.audio.whistle.bind(w.audio);
      w.audio.whistle = (v, pan) => {
        whistled++;
        return real(v, pan);
      };
      w.paused = false;
      w.__train(["engine", "hopper"], { pieceId: ids[1], pathIndex: 0, reversed: false, s: 100 });
      const t0 = performance.now();
      while (whistled === 0 && performance.now() - t0 < 90000) await new Promise((r) => setTimeout(r, 200));
      const t = w.sim.getTrain(w.sim.trainIds()[0]);
      return { whistled, onPiece: t.bogies[0].pieceId, ms: Math.round(performance.now() - t0) };
    }, built);
    check("whistle post: an engine passing it whistles", whistle.whistled >= 1, JSON.stringify(whistle));
    await p.evaluate(() => window.woodrail.__clear());
    // The lever frame's card: the switch and the signal near it, each thrown by a tap.
    const levers = await p.evaluate(async ({ ids, frame }) => {
      const w = window.woodrail;
      w.interaction.selectProp(frame);
      await new Promise((r) => setTimeout(r, 300));
      const chips = () => [...document.querySelectorAll(".piece-card .lever-list button")];
      const before = chips().map((b) => b.textContent);
      const sw0 = w.layout.switchState(ids[4]);
      const sig0 = w.layout.switchState(ids[6]);
      for (const b of chips()) b.click();
      await new Promise((r) => setTimeout(r, 300));
      const after = chips().map((b) => b.textContent);
      return { before, after, switched: w.layout.switchState(ids[4]) !== sw0, held: w.layout.switchState(ids[6]) !== sig0 };
    }, { ids: built.ids, frame: placed.frame });
    check("lever frame: its card lists the switch and the signal near it", levers.before.length === 2 && levers.before.some((t) => t.startsWith("Points")) && levers.before.some((t) => t.startsWith("Signal")), JSON.stringify(levers));
    check("lever frame: a tap on each throws the points and holds the signal", levers.switched && levers.held && levers.after.join() !== levers.before.join());
    await p.evaluate((id) => window.woodrail.__look(id, 420), built.ids[5]);
    await p.waitForTimeout(2500);
    await shot("lever-frame-card");
    await p.evaluate(() => window.woodrail.interaction.clearSelection?.());
    const clock = await p.evaluate(() => ({ clocks: window.woodrail.clockView.count }));
    check("station clock: drawn with hands of its own", clock.clocks >= 1, JSON.stringify(clock));
    await p.evaluate((id) => { const w = window.woodrail; w.interaction.clearSelection(); w.hud.hideCards(); const c = w.props.get(id); w.director.glideTo(new w.camera.position.constructor(c.x, 40, c.z), 160, { duration: 0.1 }); }, placed.clock);
    await p.waitForTimeout(2500);
    await shot("station-clock");
  }
}

if (want("roundhouse")) {
  await fresh("roundhouse");
  const built = await p.evaluate(() => window.woodrail.__build(["buffer-turnback", "straight-216", "straight-216", "kit-roundhouse-segment"], { "buffer-turnback": 0, "kit-roundhouse-segment": -1 }));
  check("built a line into the roundhouse", !!built, built ? JSON.stringify(built) : await p.evaluate(() => window.woodrail.__lastWhy));
  if (built) {
    const r = await p.evaluate(({ ids }) => {
      const w = window.woodrail;
      const rh = ids[3];
      w.__clear();
      const tid = w.__train(["engine"], { pieceId: ids[2], pathIndex: 0, reversed: false, s: 150 });
      if (tid === null) return { error: "no train" };
      let open = 0;
      let on = false;
      w.__step(120 * 8, () => {
        const t = w.sim.getTrain(w.sim.trainIds()[0]);
        for (const g of w.kitView.group.children.filter((c) => c.name === "movers")) {
          g.traverse((o) => { if (o.name === "stallR") open = Math.max(open, o.rotation.y); });
        }
        if (t.bogies.some((b) => b.pieceId === rh)) on = true;
        return on && open > 1.4;
      });
      w.paused = false;
      return { open: Math.round(open * 100) / 100, on };
    }, built);
    check("roundhouse: stall doors open as an engine runs in", r.open > 1.4 && r.on, JSON.stringify(r));
    await p.evaluate((id) => window.woodrail.__look(id, 420), built.ids[3]);
    await p.waitForTimeout(2500);
    await shot("roundhouse-doors");
  }
}

if (want("stations")) {
  // Everything else on the map, to look at: the two-platform station, mountain and harbour stations, roundhouse.
  for (const seq of [
    ["buffer-turnback", "straight-216", "kit-two-platform-station", "straight-216", "buffer-turnback"],
    ["buffer-turnback", "straight-216", "kit-mountain-station", "kit-harbour-station", "straight-216", "buffer-turnback"],
    ["buffer-turnback", "straight-216", "kit-roundhouse-segment"],
  ]) {
    await fresh("stations");
    const built = await p.evaluate((seq) => window.woodrail.__build(seq, { "buffer-turnback": 0, "kit-roundhouse-segment": -1 }), seq);
    check(`built ${seq.filter((s) => s.startsWith("kit")).join(", ")}`, !!built, built ? "" : await p.evaluate(() => window.woodrail.__lastWhy));
    if (built) {
      await p.evaluate((id) => window.woodrail.__look(id, 460), built.ids[2]);
      await p.waitForTimeout(2500);
      await shot(seq[2]);
    }
  }
}

if (want("idle")) {
  await p.evaluate(() => window.woodrail.__clear());
  const movers = await p.evaluate(() => window.woodrail.kitView.hasMovers);
  const withHook = await idleFrames();
  // The same with the hook off (as if no kit moved).
  await p.evaluate(() => Object.defineProperty(window.woodrail.kitView, "hasMovers", { get: () => false, configurable: true }));
  const withoutHook = await idleFrames();
  await p.evaluate(() => delete window.woodrail.kitView.hasMovers);
  console.log("idle frames over 15 s with kits on the map:", { movers, withHook, withoutHook, idleBefore });
  check("idle with moving kits on the map draws no more than before, with or without the hook", withHook <= Math.max(idleBefore, withoutHook) && withoutHook <= idleBefore + 1, JSON.stringify({ withHook, withoutHook, idleBefore }));
}

if (want("perf")) {
  // The moves hook's cost on a frame where trains move: KitView.update over every moving kit on the map, its triggers
  // asked of the sim and economy, with a train running. And the frame loop's own per-frame check when idle.
  // Lines of moving kits with room for trains, beside whatever the groups before left down.
  for (const seq of [
    ["buffer-turnback", "straight-216", "straight-216", "kit-water-tower", "straight-216", "kit-castle-gate", "straight-216", "buffer-turnback"],
    ["buffer-turnback", "straight-216", "straight-216", "kit-log-loader", "straight-216", "straight-216", "buffer-turnback"],
  ]) {
    const line = await p.evaluate((seq) => window.woodrail.__build(seq, { "buffer-turnback": 0 }), seq);
    check(`perf: built ${seq.filter((s) => s.startsWith("kit")).join(", ")}`, !!line, line ? "" : await p.evaluate(() => window.woodrail.__lastWhy));
  }
  const perf = await p.evaluate(() => {
    const w = window.woodrail;
    const movers = w.kitView.movers.size;
    // Three trains of four cars on the map (wherever there's room on a straight).
    let added = 0;
    for (const id of w.layout.pieceIds()) {
      if (added >= 3 || w.layout.getPiece(id).type !== "straight-216") continue;
      if (w.sim.addTrain(["engine", "hopper", "hopper", "hopper"], { pieceId: id, pathIndex: 0, reversed: false, s: 200 }).kind === "placed") added++;
    }
    const ids = w.sim.trainIds();
    const time = (n, f) => {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) f();
      return ((performance.now() - t0) / n) * 1000;
    };
    // Settle everything first (no live parts): then each call is the trigger look-ups only.
    for (let i = 0; i < 400; i++) w.kitView.update(w.kitTriggered, 1 / 60);
    const update = time(2000, () => w.kitView.update(w.kitTriggered, 1 / 60));
    const idleCheck = time(100000, () => w.kitView.hasMovers && (false || w.kitView.animating || w.economy.halts !== w.haltsSeen));
    const bogies = ids.reduce((n, id) => n + w.sim.getTrain(id).bogies.length, 0);
    return { movers, trains: ids.length, bogies, updateMicros: Math.round(update * 100) / 100, idleCheckMicros: Math.round(idleCheck * 1000) / 1000 };
  });
  console.log("moves hook cost:", JSON.stringify(perf));
  check("moves hook: with trains running, an update over every moving kit (3 or more) costs well under a millisecond", perf.trains >= 1 && perf.movers >= 3 && perf.updateMicros < 200, JSON.stringify(perf));
}

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(failures ? `${failures} FAILED` : "ALL PASS", `(${Math.round((Date.now() - started) / 1000)} s)`);
await b.close();
await server.close();
process.exit(failures ? 1 : 0);
