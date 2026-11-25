// The idle prefetch of lazily loaded sheets (src/lib/prefetch.ts), on the built game (`npm run e2e:prefetch`: it builds
// into dist-e2e-prefetch/ first), on a 390×844 phone: a tab older than the deploy now served, whose hashed chunks are gone.
//
// - `prefetched`: a new game; once the game has gone quiet its likely sheets are fetched by themselves (Research's
//   board among them, the bytes printed); then the network refuses every /assets/ file (a newer deploy took them
//   off), and a tap on Research still opens the board, with no "Couldn't fetch" toast.
// - `refused`: the control: Research's chunk refused from the start (so the prefetch fails too): a tap on Research
//   says "Couldn't fetch that part of the game", the last resort, as before.
//
// Usage: npm run e2e:prefetch   (builds, then serves the build by vite preview; Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium)
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { build, preview } from "vite";
import { groups } from "../../scripts/e2e/lib/groups.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
// (Its own build of the tree as it is, so never a stale dist/: vite alone, about 10 s.)
const OUT_DIR = "dist-e2e-prefetch";
await build({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, build: { outDir: OUT_DIR, emptyOutDir: true }, logLevel: "warn" });
const server = await preview({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, build: { outDir: OUT_DIR }, preview: { port: 0 }, logLevel: "warn" });
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

const results = [];
const errors = [];
const check = (what, ok, detail = "") => {
  results.push({ ok });
  console.log(ok ? "PASS" : "FAIL", what, detail);
};
const FETCH_FAILED = "Couldn't fetch that part of the game";
const LAZY = ["blueprint-board", "explainer-sheet", "paint-sheet", "credits-sheet", "stats-card", "feedback-sheet"];
const lazyName = (url) => LAZY.find((n) => new RegExp(`/assets/${n}-[^/]+\\.js$`).test(url));

/** A fresh phone page, with `before(page)` run before the game loads (to set up the network). */
async function phone(before = async () => {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await before(p);
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.keyboard.press("Escape");
  return { p, ctx };
}

/** Tap Research on the bar, as a player does. */
async function tapResearch(p) {
  const btn = p.locator(".research-btn:visible").first();
  await btn.waitFor({ timeout: 30000 });
  await btn.tap();
}
const boardShown = (p) => p.waitForFunction(() => [...document.querySelectorAll(".board-panel")].some((e) => !e.hidden && e.getBoundingClientRect().width > 0), null, { timeout: 30000 }).then(() => true, () => false);
const toastSaid = (p, text, timeout = 15000) => p.waitForFunction((t) => [...document.querySelectorAll(".toast.show")].some((e) => e.textContent.includes(t)), text, { timeout }).then(() => true, () => false);

const suite = groups("prefetch", { results, errors, check });

suite.add("prefetched", async () => {
  const fetched = new Map();
  const { p, ctx } = await phone(async (p) => {
    p.on("response", async (r) => {
      const n = lazyName(r.url());
      if (n && r.ok()) fetched.set(n, (await r.body().catch(() => Buffer.alloc(0))).length);
    });
  });
  check("no lazy sheet fetched as the game loads", fetched.size === 0, [...fetched.keys()].join(", "));
  const t0 = Date.now();
  const done = await p.waitForFunction(() => window.woodrail.prefetched === true, null, { timeout: 90000 }).then(() => true, () => false);
  check("the likely sheets are fetched once the game is quiet", done && fetched.has("blueprint-board") && fetched.has("explainer-sheet"), `after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${[...fetched].map(([n, s]) => `${n} ${(s / 1024).toFixed(1)} kB`).join(", ")}; total ${([...fetched.values()].reduce((a, s) => a + s, 0) / 1024).toFixed(1)} kB`);
  // A newer deploy took this build's files off the site.
  let refused = 0;
  await p.route(/\/assets\//, (r) => (refused++, r.abort()));
  await tapResearch(p);
  check("Research opens with every /assets/ file refused", await boardShown(p), `${refused} refused`);
  check("no Couldn't fetch toast", !(await toastSaid(p, FETCH_FAILED, 3000)));
  await ctx.close();
});

suite.add("refused", async () => {
  const { p, ctx } = await phone(async (p) => {
    await p.route(/\/assets\/blueprint-board-[^/]+\.js$/, (r) => r.abort());
  });
  await p.waitForFunction(() => window.woodrail.prefetched === true, null, { timeout: 90000 }).catch(() => {});
  await tapResearch(p);
  check("Research's chunk refused from the start: the toast says so", await toastSaid(p, FETCH_FAILED));
  check("and no board", !(await p.evaluate(() => [...document.querySelectorAll(".board-panel")].some((e) => !e.hidden && e.getBoundingClientRect().width > 0))));
  await ctx.close();
});

await suite.run();
// (The refused group's failed fetch is reported as an error by the game on purpose: not counted here.)
await b.close();
await server.close();
suite.finish();
