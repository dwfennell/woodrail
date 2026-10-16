// End-to-end tray-picture test (`npm run e2e:tray`): on the production build (dist/, served by vite preview), every
// Track-tray item ends up showing its real picture, not the drawn icon that stands in for it till it's drawn:
// on a fresh profile with a train running the whole time (the scene's never still), and, reloaded, straight from the
// cache on entering. Chromium as for e2e:roads.
import { existsSync } from "node:fs";
import { chromium } from "playwright-core";
import { preview } from "vite";

if (!existsSync("dist/index.html")) {
  console.error("No dist/: run `npm run build` first (or `npm run e2e:tray`, which does).");
  process.exit(2);
}
const server = await preview({ preview: { port: 0, strictPort: false }, logLevel: "warn" });
const URL = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));

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

// Saved as they're drawn (debounced 2 s): reloaded, they're all there on entering.
await p.waitForTimeout(3000);
await p.reload();
await enter("Continue");
await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const cached = await counts();
check("reloaded: every Track-tray item shows its picture on entering, from the cache", allPictures(cached), JSON.stringify(cached));

check("no page errors", errors.length === 0, errors.join(" | "));
await b.close();
await new Promise((r) => server.httpServer.close(r));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
