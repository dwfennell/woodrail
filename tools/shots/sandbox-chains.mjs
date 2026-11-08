// Pictures of Sandbox's chain hints on a 390×844 phone (#seed-24): an industry's card with where its goods come from
// and go and the chevrons on the map; a Sawmill held from the tray with gold and green rings; a harvester on bare
// ground ("Needs trees nearby"), a farm yard away from fields ("Needs a farm field nearby"); a bakery waiting for flour
// and milk. Harness shortcut: industries other than the one held are put down by the editor, not the tray: it's for
// looking, not testing (e2e:sandbox-chains tests the player's path). JPEGs, about 100–150 kB each.
//
// Usage: node tools/shots/sandbox-chains.mjs [<out dir>]   (default out: e2e-out/sandbox-chains-shots)
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/sandbox-chains-shots";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5372, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = `${server.resolvedUrls.local[0].replace(/\/$/, "")}/#seed-24`;
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
await ctx.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const QUALITY = Number(process.env.QUALITY ?? 55);
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const snap = async (name) => {
  await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
  await p.screenshot({ path: `${OUT}/${name}.jpg`, type: "jpeg", quality: QUALITY, timeout: 180000 }).catch((e) => console.log(`(no picture ${name}: ${e.message.split("\n")[0]})`));
  console.log("shot", name);
};
const glide = async (x, z, dist) => {
  await p.evaluate(([x, z, dist]) => window.woodrail.director.glideTo(new window.woodrail.controls.target.constructor(x, 0, z), dist, { duration: 0.2 }), [x, z, dist]);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
};
/** Open a depot's card, framed with the card in view (the game's own nudge clear of it), and wait for it to settle. */
const openCard = async (id, dist = 1500) => {
  const at = await p.evaluate((id) => {
    const w = window.woodrail;
    const q = w.layout.getPiece(w.economy.depot(id).pieceId).pose;
    return [q.x + Math.cos(q.heading) * 108, q.z + Math.sin(q.heading) * 108];
  }, id);
  await glide(at[0], at[1] + 250, dist);
  await p.evaluate((id) => window.woodrail.interaction.openDepot(id), id);
  await p.waitForTimeout(1500);
  await settle();
  // (Its "Drag to move" hint let go first: a picture of the card, not of the hint.)
  await p.waitForFunction(() => ![...document.querySelectorAll(".toast")].some((t) => t.classList.contains("show")), null, { timeout: 15000 }).catch(() => {});
  await frames();
  await settle();
};
/** Frame the card's chain (its place and the far ends of its chevrons) in the room above the card, as Show does. */
const frameChain = async (id) => {
  await p.evaluate(async (id) => {
    const w = window.woodrail;
    const { frameDistance } = await import("/src/game/camera-director.ts");
    const pts = [];
    const mid = (d) => {
      const q = w.layout.getPiece(d.pieceId).pose;
      return { x: q.x + Math.cos(q.heading) * 108, z: q.z + Math.sin(q.heading) * 108 };
    };
    pts.push(mid(w.economy.depot(id)));
    for (const ids of [...document.querySelectorAll(".depot-chain .chain-show")].map((b) => Number(b.dataset.depot))) pts.push(mid(w.economy.depot(ids)));
    const c = { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, z: pts.reduce((s, q) => s + q.z, 0) / pts.length };
    const r = Math.max(300, ...pts.map((q) => Math.hypot(q.x - c.x, q.z - c.z) + 200));
    w.director.glideTo(new w.controls.target.constructor(c.x, 0, c.z), frameDistance(r, w.camera.fov, w.camera.aspect), { duration: 0.3, inRoom: true });
  }, id);
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 30000 }).catch(() => {});
  await frames();
  await settle();
};

await p.goto(PAGE);
await p.waitForFunction(() => !!window.woodrail && (document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null || window.woodrail.mode?.() === "sandbox"), null, { timeout: 240000 });
await p.evaluate(() => window.woodrail.title.shown && document.querySelector(".title-card.mode-sandbox .title-buttons .primary")?.click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
// (The tips are shown once a device: marked seen, so no toast sits over the pictures.)
await p.evaluate(() => localStorage.setItem("woodrail.hintsSeen", "chains-tab,chains-placed"));
await p.evaluate(() => window.woodrail.hud.openTrayTab("industries"));
await p.waitForTimeout(3000);

// Places, by the game's own placement check (and, where it says so, its site rule): put down by the editor.
const placed = await p.evaluate(async () => {
  const w = window.woodrail;
  const { siteWhy } = await import("/src/game/industries.ts");
  const mill = w.economy.allDepots().find((d) => d.role === "sawmill");
  const at = w.layout.getPiece(mill.pieceId).pose;
  const free = (type, want, near, skip = []) => {
    for (let r = 400; r < 4000; r += 72)
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        const q = { x: Math.round((near.x + Math.cos(a) * r) / 18) * 18, z: Math.round((near.z + Math.sin(a) * r) / 18) * 18, heading: 0 };
        if (skip.some((s) => Math.hypot(s.x - q.x, s.z - q.z) < 700)) continue;
        if (w.interaction.placement(type, false, q, 0, -1).reason) continue;
        if (want(siteWhy(w.landscape, type, q))) return q;
      }
    return null;
  };
  const put = (type, q) => {
    const id = w.editor().place(type, q, 0, false);
    w.changed?.();
    return w.economy.depotAtPiece(id)?.id ?? -1;
  };
  const bareQ = free("depot-forest", (why) => /^Needs trees nearby: 0 of/.test(why ?? ""), at);
  const bare = bareQ ? put("depot-forest", bareQ) : -1;
  const farmQ = free("depot-farm", (why) => why === "Needs a farm field nearby", at, [bareQ].filter(Boolean));
  const farm = farmQ ? put("depot-farm", farmQ) : -1;
  const bakeQ = free("depot-bakery", () => true, at, [bareQ, farmQ].filter(Boolean));
  const bakery = bakeQ ? put("depot-bakery", bakeQ) : -1;
  return { mill: mill.id, bare, farm, bakery };
});
console.log("placed", JSON.stringify(placed));

// 1. The map's own sawmill: its card (where logs come from, where planks go) and the chevrons on the map.
await openCard(placed.mill, 1800);
await frameChain(placed.mill);
await snap("sandbox-chains-1-sawmill-card");
await p.evaluate(() => window.woodrail.hud.hideCards());

// 2. A Sawmill held from the tray by touch: gold rings round forests, green round towns.
{
  const mid = await p.evaluate(() => {
    const w = window.woodrail;
    const t = w.landscape.towns.map((x) => x.centre);
    const f = w.economy.allDepots().filter((d) => d.role === "forest").map((d) => w.layout.getPiece(d.pieceId).pose);
    const all = [...t, ...f];
    return { x: all.reduce((s, q) => s + q.x, 0) / all.length, z: all.reduce((s, q) => s + q.z, 0) / all.length };
  });
  await glide(mid.x, mid.z + 300, 5200);
  await settle();
  const tile = await p.evaluate(() => {
    const e = document.querySelector('.scroller .tray-item[data-key="piece:depot-sawmill"]');
    e.scrollIntoView({ inline: "center", block: "nearest" });
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  let t = Date.now() / 1000;
  await touch("touchStart", tile[0], tile[1], t);
  await touch("touchMove", tile[0], tile[1] - 30, (t += 0.04));
  for (let k = 1; k <= 10; k++) await touch("touchMove", tile[0] + ((195 - tile[0]) * k) / 10, tile[1] - 30 + ((380 - tile[1] + 30) * k) / 10, (t += 0.02));
  await frames();
  // (Moved about till the held piece reads clear: no "… is in the way" in the picture.)
  for (let k = 0; k < 40; k++) {
    const clear = await p.evaluate(() => { const m = window.woodrail.interaction.mode; return m?.kind === "drag-piece" && !m.blocked && m.ghost.visible; });
    if (clear) break;
    const a = k * 2.4;
    const r = 16 * Math.sqrt(k + 1);
    await touch("touchMove", 195 + Math.cos(a) * r, 380 + Math.sin(a) * r, Math.max(Date.now() / 1000, (t += 0.02)));
    await frames();
    await frames();
  }
  await p.waitForTimeout(1500);
  await p.waitForFunction(() => ![...document.querySelectorAll(".toast")].some((t) => t.classList.contains("show")), null, { timeout: 15000 }).catch(() => {});
  await settle();
  console.log("held hints", await p.evaluate(() => window.woodrail.chainHints.shown.split(";").length));
  await snap("sandbox-chains-2-held-sawmill-rings");
  // (Let go over the tray: nothing put down.)
  await touch("touchMove", tile[0], tile[1], Math.max(Date.now() / 1000, (t += 0.02)));
  await touch("touchEnd", tile[0], tile[1], Math.max(Date.now() / 1000, t + 0.04));
  await frames();
}

// 3–5. A harvester on bare ground, a farm yard away from fields, a bakery with nothing to bake from.
if (placed.bare >= 0) {
  await openCard(placed.bare);
  await snap("sandbox-chains-3-harvester-needs-trees");
  await p.evaluate(() => window.woodrail.hud.hideCards());
}
if (placed.farm >= 0) {
  await openCard(placed.farm);
  await snap("sandbox-chains-4-farm-needs-field");
  await p.evaluate(() => window.woodrail.hud.hideCards());
}
if (placed.bakery >= 0) {
  await openCard(placed.bakery);
  await snap("sandbox-chains-5-bakery-waiting");
}
console.log(errors.length ? `page errors: ${errors.slice(0, 3).join(" | ")}` : "no page errors");
await b.close();
await server.close();
