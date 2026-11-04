// Ambient motion's cost (`node tools/perf/ambient.mjs [<root with a dist/>]`, after a build): a Game with every
// industry put down beside the first town and working (a harness shortcut: placed by the editor and stocked by hand,
// as tools/shots/industry-life.mjs does: it's for measuring, not testing), the camera close, middling and far, at a
// phone's size and a desktop's. For each: frames drawn a second, CPU of the Chromium tree (% of a core), and the
// depots' update alone (µs, best of 5×600, with the game's ambient view where it has one). Then the same views with
// the industries idle (yards full, nothing to work on). Headless SwiftShader: a frame costs most of a second, so
// compare frames and CPU between builds on one machine, not with a phone.
import { preview } from "vite";
import { chromium } from "playwright-core";
import { readFileSync, readdirSync } from "fs";

const root = process.argv[2] ?? process.cwd();
const SECONDS = Number(process.env.SECONDS ?? 8);
const server = await preview({ root, preview: { port: 0 }, logLevel: "warn" });
const tick = 100;
const cpu = () => {
  let s = 0;
  for (const p of readdirSync("/proc")) {
    if (!/^\d+$/.test(p)) continue;
    try {
      const st = readFileSync(`/proc/${p}/stat`, "utf8");
      if (!/chrom/i.test(st.slice(0, 60))) continue;
      const f = st.slice(st.lastIndexOf(")") + 2).split(" ");
      s += +f[11] + +f[12];
    } catch {
      // gone
    }
  }
  return s / tick;
};
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// (ROLES=forest,sawmill,… for some only, e.g. without the big sails and wheels; PHONE_ONLY=1 for the phone's size only.)
const ROLES = process.env.ROLES ? process.env.ROLES.split(",") : ["forest", "sawmill", "farm", "mill", "quarry", "mine", "foundry", "carpenter", "smithy", "power"];
for (const [label, viewport] of [
  ["phone 390×844", { width: 390, height: 844 }],
  ["desktop 1280×800", { width: 1280, height: 800 }],
].slice(0, process.env.PHONE_ONLY ? 1 : 2)) {
  const page = await b.newPage({ viewport });
  await page.addInitScript(() => {
    localStorage.setItem("woodrail.helpSeen", "1");
    window.__woodrailPinClocks = true;
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await page.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
  await page.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  const centre = await page.evaluate((roles) => {
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    roles.forEach((role, i) => {
      const x = t.centre.x - 1400 + (i % 5) * 300;
      const z = t.centre.z + 900 + Math.floor(i / 5) * 350;
      const g = w.world.landscape.grid;
      const y = g.groundY(g.cellAtWorld(x + 108, z + 72));
      const id = w.editor().place(`depot-${role}`, { x, z, heading: 0 }, y, false);
      if (!w.economy.depotAtPiece(id)) w.economy.addDepot(role, id);
    });
    w.depotView.setWorld(w.economy, w.layout);
    return { x: t.centre.x - 800, z: t.centre.z + 1075 };
  }, ROLES);
  // Working: 6 of every good in each yard (what it uses is there, and room for what it makes). Idle: its yard filled
  // until it isn't working (`Economy.working`).
  const stock = (on) =>
    page.evaluate(
      ([roles, on]) => {
        const w = window.woodrail;
        for (const d of w.economy.allDepots()) {
          if (!roles.includes(d.role)) continue;
          d.piles.fill(on ? 6 : 0);
          if (!on) for (let k = 0; k < d.piles.length && w.economy.working(d); k++) d.piles[k] = 99;
        }
        w.invalidate();
        return w.economy.allDepots().filter((d) => roles.includes(d.role) && w.economy.working(d)).length;
      },
      [ROLES, on],
    );
  const look = (dist) =>
    page.evaluate(
      ({ x, z, dist }) => {
        const w = window.woodrail;
        w.director.glideTo(new w.camera.position.constructor(x, 0, z), Math.min(dist, w.controls.maxDistance), { duration: 0.1, phi: 0.75 });
      },
      { ...centre, dist },
    );
  for (const on of [true, false]) {
    const working = await stock(on);
    for (const [view, dist] of [
      ["close (500 mm)", 500],
      ["middling (1500 mm)", 1500],
      ["out (3000 mm)", 3000],
      ["far (5000 mm)", 5000],
      ["map (max)", 1e9],
    ]) {
      await look(dist);
      await page.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
      await page.waitForTimeout(3000);
      const f0 = await page.evaluate(() => window.woodrail.framesDrawn);
      const c0 = cpu();
      await page.waitForTimeout(SECONDS * 1000);
      const c1 = cpu();
      const f1 = await page.evaluate(() => window.woodrail.framesDrawn);
      const us = await page.evaluate(() => {
        const w = window.woodrail;
        let sim = w.simSeconds;
        let best = Infinity;
        for (let round = 0; round < 5; round++) {
          const t0 = performance.now();
          for (let k = 0; k < 600; k++) {
            w.ambientEye?.set(w.camera, w.canvas.clientHeight);
            w.depotView.update(w.economy, w.snapshot.ids, w.snapshot.count, (id) => w.trainView.carObject(id), (sim += 1 / 60), false, w.ambientEye ?? null);
          }
          best = Math.min(best, ((performance.now() - t0) / 600) * 1000);
        }
        return best;
      });
      const dist0 = await page.evaluate(() => Math.round(window.woodrail.camera.position.distanceTo(window.woodrail.controls.target)));
      console.log(
        `${label}, ${on ? `${working} working` : "idle"}, ${view} [${dist0} mm]: ${((f1 - f0) / SECONDS).toFixed(2)} frames/s, CPU ${(((c1 - c0) / SECONDS) * 100).toFixed(0)}% of a core, depots' update ${us.toFixed(1)} µs`,
      );
    }
  }
  await page.close();
}
await b.close();
await server.close();
