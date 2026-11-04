// End-to-end tray-picture test (`npm run e2e:tray`): on the production build (dist/, served by vite preview), every
// Track-tray item ends up showing its real picture, not the drawn icon that stands in for it till it's drawn:
// on a fresh profile with a train running the whole time (the scene's never still), and, reloaded, straight from the
// cache on entering. Chromium as for e2e:roads.
// Group `track-pieces` (tech-tree T3, T4): Sandbox's Switch shelf has the single and double slip and the double
// three-way, each its real picture; in a new Game they're locked there till learned, a tap saying how to unlock them
// (Research Slips to unlock), and unlocked once learned.
// Groups (`-- --list`, E2E_ONLY, resume: docs/agents/e2e.md): `pictures`, `track-pieces`.
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { preview } from "vite";
import { groups } from "./lib/groups.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const errors = [];
// (Started only when a group will run: `--list`, and a run whose groups all passed already, need no browser.)
let server = null;
let URL = "";
let b = null;
let ctx = null;
let p = null;
/** A fresh phone page (its own profile). */
async function freshPage() {
  if (!b) {
    if (!existsSync("dist/index.html")) {
      console.error("No dist/: run `npm run build` first (or `npm run e2e:tray`, which does).");
      process.exit(2);
    }
    server = await preview({ preview: { port: 0, strictPort: false }, logLevel: "warn" });
    URL = server.resolvedUrls.local[0];
    b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  }
  await ctx?.close().catch(() => {});
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
}

/** The Track tray's items: how many, how many show a picture, how many still an icon. */
const counts = () =>
  p.evaluate(() => {
    const items = [...document.querySelectorAll(".tray-item")];
    return { items: items.length, pictures: items.filter((i) => i.querySelector("img")).length, icons: items.filter((i) => i.querySelector(".thumb-icon")).length };
  });
const allPictures = (c) => c.items > 0 && c.icons === 0 && c.pictures === c.items;

/** From the title, into Sandbox by the button labelled `label`. */
async function enter(label) {
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate((label) => [...document.querySelectorAll(".title-card.mode-sandbox button")].find((b) => b.textContent.includes(label)).click(), label);
  await p.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown, null, { timeout: 120000 });
}

/** Group `pictures`: every Track-tray item ends up its real picture, fresh with a train running, and from the cache. */
async function pictures() {
  await freshPage();
  await p.goto(URL);
  await enter("New map");
  // An engine going round from the first station, so the scene's never still.
  await p.evaluate(() => {
    const w = window.woodrail;
    const station = [...w.stations.values()][0];
    const r = w.sim.addTrain(["engine"], { pieceId: station, pathIndex: 0, reversed: false, s: 60 });
    if (r.kind !== "placed") throw new Error("no room on the station");
    w.sim.setLever(w.sim.getTrain(r.trainId).cars[0].id, 1);
    w.invalidate();
  });
  let fresh = await counts();
  check("fresh: the Track tray starts with icons standing in (pictures not drawn yet)", fresh.icons > 0 || allPictures(fresh), JSON.stringify(fresh));
  try {
    await p.waitForFunction(
      () => {
        const items = [...document.querySelectorAll(".tray-item")];
        return items.length > 0 && items.every((i) => i.querySelector("img") && !i.querySelector(".thumb-icon"));
      },
      null,
      { timeout: 240000, polling: 1000 },
    );
  } catch {
    /* reported below */
  }
  fresh = await counts();
  check("fresh, a train running: every Track-tray item ends up its real picture", allPictures(fresh), JSON.stringify(fresh));
  const moving = await p.evaluate(() => window.woodrail.sim.trainIds().some((id) => window.woodrail.sim.getTrain(id).speed > 0));
  check("…and the train was still running", moving);

  // Saved once they're all drawn (the trains' too, drawn after the Track tray's): reloaded, they're all there on entering.
  await p.evaluate(() => window.woodrail.trayThumbnailsSaved());
  await p.reload();
  await enter("Continue");
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const cached = await counts();
  check("reloaded: every Track-tray item shows its picture on entering, from the cache", allPictures(cached), JSON.stringify(cached));
}

const NEW = [
  ["piece:slip-single", "Single slip"],
  ["piece:slip-double", "Double slip"],
  ["piece:switch-3way-double", "Double three-way"],
];

/** Open the Track tab's Switch shelf by a tap, as a player does. Open? */
async function switchShelf() {
  const i = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-group")].findIndex((g) => g.querySelector(".label")?.textContent === "Switch"));
  if (i < 0) return false;
  await p.evaluate((i) => document.querySelectorAll(".scroller .tray-group")[i].scrollIntoView({ inline: "center" }), i);
  const box = await (await p.$$(".scroller .tray-group"))[i].boundingBox();
  await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForFunction(() => document.querySelector(".tray").classList.contains("in-group"), null, { timeout: 10000 }).catch(() => {});
  return p.evaluate(() => document.querySelector(".tray").classList.contains("in-group"));
}
const tile = (key) =>
  p.evaluate((key) => {
    const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
    return e ? { label: e.querySelector(".label")?.textContent ?? "", picture: !!e.querySelector("img") && !e.querySelector(".thumb-icon"), locked: e.classList.contains("locked") } : null;
  }, key);

/** Group `track-pieces`: the new pieces' tiles on the Switch shelf (see the header). */
async function trackPieces() {
  await freshPage();
  await p.goto(URL);
  await enter("New map");
  check("track-pieces: Sandbox's Switch shelf opens", await switchShelf());
  await p
    .waitForFunction((keys) => keys.every((k) => { const e = document.querySelector(`.scroller .tray-item[data-key="${k}"]`); return e && e.querySelector("img") && !e.querySelector(".thumb-icon"); }), NEW.map((n) => n[0]), { timeout: 240000, polling: 1000 })
    .catch(() => {});
  for (const [key, label] of NEW) {
    const t = await tile(key);
    check(`track-pieces: Sandbox's Switch shelf has the ${label}, its real picture, not locked`, !!t && t.label === label && t.picture && !t.locked, JSON.stringify(t));
  }
  mkdirSync("e2e-out", { recursive: true });
  await p.screenshot({ path: "e2e-out/tray-switch-shelf.png" }).catch(() => {});
  // A new Game: locked till learned.
  await freshPage();
  await p.goto(URL);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => document.querySelector(".title-card.mode-game .title-buttons .primary").click());
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  await p.evaluate(() => document.querySelector(".coach:not([hidden]) .coach-skip")?.click());
  check("track-pieces: Game's Switch shelf opens", await switchShelf());
  for (const [key, label] of NEW) {
    const t = await tile(key);
    check(`track-pieces: a new Game's ${label} is locked`, !!t && t.locked, JSON.stringify(t));
  }
  // A tap on the locked Single slip says how to unlock it.
  const el = await p.$('.scroller .tray-item[data-key="piece:slip-single"]');
  const box = await el?.boundingBox();
  if (box) await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  const note = await p
    .waitForFunction(() => [...document.querySelectorAll("body *")].map((e) => (e.children.length === 0 ? e.textContent : "")).find((t) => /Research Slips to unlock/.test(t ?? "")) ?? null, null, { timeout: 10000 })
    .then((h) => h.jsonValue())
    .catch(() => null);
  check("track-pieces: tapped, the locked Single slip says to research Slips to unlock it", !!note, String(note));
  // Learned (setup: researching them is e2e:research's): unlocked.
  await p.evaluate(() => {
    for (const id of ["switches", "junctions", "signals", "slips", "double-three-way"]) window.woodrail.learn(id);
  });
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => ["piece:slip-single", "piece:slip-double", "piece:switch-3way-double"].every((k) => { const e = document.querySelector(`.scroller .tray-item[data-key="${k}"]`); return !e || !e.classList.contains("locked"); }), null, { timeout: 10000 }).catch(() => {});
  if (!(await p.evaluate(() => document.querySelector(".tray").classList.contains("in-group")))) await switchShelf();
  for (const [key, label] of NEW) {
    const t = await tile(key);
    check(`track-pieces: learned, the ${label} is unlocked`, !!t && !t.locked, JSON.stringify(t));
  }
}

const suite = groups("tray", { results, errors, check });
suite.add("pictures", pictures, { about: "every Track-tray item ends up its real picture, fresh and from the cache" });
suite.add("track-pieces", trackPieces, { about: "slips and the double three-way on the Switch shelf: pictures, locked in Game till learned" });
await suite.run();
check("no page errors", errors.length === 0, errors.join(" | "));
await b?.close();
if (server) await new Promise((r) => server.httpServer.close(r));
suite.finish();
