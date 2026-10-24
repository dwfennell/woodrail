// End-to-end cloud saves (`npm run e2e:cloud`): two devices (browser contexts, each with its own storage) and the Worker
// in cloud/, run locally (`wrangler dev --local`, its R2 in a temporary folder). A turns Cloud save on and is given a
// code; B types it in and carries on with A's railway; B's next change, sent as its page hides, is what A finds when it
// starts again. Then a code that's wrong, and one with nothing saved, are said so. Needs cloud/'s packages
// (`npm --prefix cloud ci`). Chromium as for e2e:roads.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const WORKER_PORT = Number(process.env.CLOUD_PORT ?? 8787);
const WORKER = `http://127.0.0.1:${WORKER_PORT}`;
process.env.VITE_CLOUD_URL = WORKER;
const server = await createServer({ server: { port: 0, strictPort: false, host: "127.0.0.1" }, logLevel: "warn" });
await server.listen();
await server.warmupRequest("/src/main.ts");
const URL = server.resolvedUrls.local[0].replace(/\/$/, "");
const ORIGIN = new globalThis.URL(URL).origin;

const persist = mkdtempSync(join(tmpdir(), "woodrail-cloud-"));
const worker = spawn("npx", ["wrangler", "dev", "--local", "--port", String(WORKER_PORT), "--ip", "127.0.0.1", "--persist-to", persist, "--var", `ALLOWED_ORIGINS:${ORIGIN}`, "--show-interactive-dev-session=false"], {
  cwd: new globalThis.URL("../../cloud/", import.meta.url),
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
let workerLog = "";
worker.stdout.on("data", (d) => (workerLog += d));
worker.stderr.on("data", (d) => (workerLog += d));
const stopWorker = () => {
  try {
    process.kill(-worker.pid, "SIGTERM");
  } catch {
    // gone
  }
};
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${WORKER}/v1/saves/sandbox`)).status === 400) break;
  } catch {
    // not up yet
  }
  if (i > 120) {
    console.log(workerLog);
    stopWorker();
    throw new Error("the Worker didn't start");
  }
  await new Promise((r) => setTimeout(r, 500));
}

const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const errors = [];

/** A device's page, played into Sandbox. */
async function device(ctx) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(String(e)));
  p.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(URL);
  await inSandbox(p);
  return p;
}
async function inSandbox(p) {
  // Playing (the HUD up: a reload into play skips the title), or the title up with its cards placed, to press Sandbox's.
  // (The loading screen goes once a mode's entered: before that the HUD and the title can both be hidden.)
  const playing = () => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !window.woodrail.hud.root.hidden && !!document.querySelector("#loading.done");
  await p.waitForFunction(`(${playing})() || (!!window.woodrail && window.woodrail.title.shown && !window.woodrail.title.root.classList.contains("placing") && document.querySelector(".title-card.mode-sandbox .title-buttons .primary") !== null)`, null, { timeout: 180000 });
  await p.evaluate(() => {
    if (window.woodrail.title.shown) document.querySelector(".title-card.mode-sandbox .title-buttons .primary").click();
  });
  await p.waitForFunction(playing, null, { timeout: 120000 });
}
const menu = (p, label) =>
  p.evaluate((label) => {
    const item = [...document.querySelectorAll(".menu .menu-item")].find((b) => b.textContent.includes(label));
    if (!item) throw new Error(`no menu item ${label}: ${[...document.querySelectorAll(".menu .menu-item")].map((b) => b.textContent).join(", ")}`);
    item.click();
  }, label);
const tap = (p, label) =>
  p.evaluate((label) => {
    const c = [...document.querySelectorAll(".cloud-card button")].find((b) => b.textContent.trim() === label);
    if (!c) throw new Error(`no ${label} on the card: ${document.querySelector(".cloud-card")?.textContent}`);
    c.click();
  }, label);
const seed = (p) => p.evaluate(() => window.woodrail.landscape.seed);
/** The railway on screen is in the device's autosave (it's saved every 5 s while played). */
const autosaved = (p) => p.waitForFunction(() => (localStorage.getItem("woodrail.autosave.v3") ?? "").includes(`"seed":${window.woodrail.landscape.seed},`), null, { timeout: 20000 }).catch(async (e) => {
    console.log("autosave:", await p.evaluate(() => ({ seed: window.woodrail.landscape.seed, title: window.woodrail.title.shown, mode: window.woodrail.mode(), head: (localStorage.getItem("woodrail.autosave.v3") ?? "").slice(0, 80) })));
    throw e;
  });
const card = (p) => p.evaluate(() => document.querySelector(".cloud-card")?.textContent ?? "");
const remote = async (code, mode = "sandbox") => {
  const res = await fetch(`${WORKER}/v1/saves/${mode}`, { method: "HEAD", headers: { "X-Woodrail-Code": code } });
  return { status: res.status, savedAt: Number(res.headers.get("X-Saved-At")), size: Number(res.headers.get("Content-Length")) };
};

try {
  // 1. A: a new map, then Cloud save on: a code, and the railway in the cloud.
  const ctxA = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const a = await device(ctxA);
  check("Cloud save is in the menu (VITE_CLOUD_URL set)", await a.evaluate(() => [...document.querySelectorAll(".menu .menu-item")].some((b) => b.textContent.includes("Cloud save"))));
  // (Paused, so A's railway stays as it is while B plays: its clock would run on, and that's a change too.)
  await a.evaluate(() => (window.woodrail.paused = true));
  await menu(a, "New map");
  await a.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  const seedA = await seed(a);
  await autosaved(a);
  await menu(a, "Cloud save");
  check("the card says what it's for, off", /Keep your railway safe online/.test(await card(a)), await card(a));
  await tap(a, "Turn on");
  await a.waitForFunction(() => /Saved online/.test(document.querySelector(".cloud-status")?.textContent ?? ""), null, { timeout: 30000 }).catch(async (e) => {
    console.log("card:", await card(a), "\nworker:", workerLog.slice(-2000));
    throw e;
  });
  const shown = await a.evaluate(() => document.querySelector(".cloud-code").textContent);
  const code = shown.trim().replace(/ /g, "-");
  check("on: a code of three words and four digits, and “Saved online”", /^[a-z]{3,5}-[a-z]{3,5}-[a-z]{3,5}-\d{4}$/.test(code), `${shown} · ${await a.evaluate(() => document.querySelector(".cloud-status").textContent)}`);
  check("…with the kind warning", /Only share it with people you'd let play your railway/.test(await card(a)));
  check("the code is never in a URL", !(await a.evaluate(() => location.href)).includes(code.split("-")[0]));
  const r1 = await remote(code);
  check("A's railway is in the cloud", r1.status === 200 && r1.size > 0, JSON.stringify(r1));
  await tap(a, "Done");

  // 2. B: a new device. Types the code (in capitals, with spaces): carries on with A's railway.
  const ctxB = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const bp = await device(ctxB);
  const seedB0 = await seed(bp);
  await menu(bp, "Cloud save");
  await tap(bp, "I have a code");
  await bp.fill(".cloud-input", "not a code");
  await tap(bp, "Load");
  await bp.waitForFunction(() => !document.querySelector(".cloud-error")?.hidden, null, { timeout: 10000 });
  check("a malformed code is said so", /three words and four numbers/.test(await bp.evaluate(() => document.querySelector(".cloud-error").textContent)));
  await bp.fill(".cloud-input", "zebra zebra zebra 0000");
  await tap(bp, "Load");
  await bp.waitForFunction(() => /No railway/.test(document.querySelector(".cloud-error")?.textContent ?? ""), null, { timeout: 15000 });
  check("a code with nothing saved is said so", true);
  await bp.fill(".cloud-input", shown.toUpperCase());
  const reloaded = bp.waitForEvent("load", { timeout: 60000 });
  await tap(bp, "Load");
  await reloaded;
  await inSandbox(bp);
  const seedB = await seed(bp);
  check("B carries on with A's railway (after a reload, straight into Sandbox)", seedB === seedA && seedB0 !== seedA, `A ${seedA}; B ${seedB0} → ${seedB}`);
  check("B keeps the code", (await bp.evaluate(() => JSON.parse(localStorage.getItem("woodrail.cloud.v1")).code)) === code);

  // 3. B changes the railway (another new map), and its page hides: sent on the way out.
  await menu(bp, "New map");
  await bp.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  const seedB2 = await seed(bp);
  await autosaved(bp);
  // (Past the Worker's 10 s between uploads.)
  await new Promise((r) => setTimeout(r, 10_000));
  await bp.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  let r2 = r1;
  for (let i = 0; i < 40 && r2.savedAt === r1.savedAt; i++) {
    await new Promise((r) => setTimeout(r, 250));
    r2 = await remote(code);
  }
  check("B's change is sent as its page hides", r2.savedAt > r1.savedAt, `${r1.savedAt} → ${r2.savedAt}`);

  // 4. A starts again: B's newer railway is the one it opens (A hadn't changed its own: no backup, no toast).
  await a.reload();
  await inSandbox(a);
  check("A, started again, opens B's newer railway", (await seed(a)) === seedB2, `A ${await seed(a)}; B ${seedB2}`);
  await menu(a, "Cloud save");
  check("…with no backup offered (nothing of A's was lost)", !/Restore/.test(await card(a)), await card(a));
  console.log(`  bundle sizes (gzipped): ${r1.size} B, ${r2.size} B`);
  await ctxA.close();
  await ctxB.close();
} catch (e) {
  check("ran to the end", false, String(e?.stack ?? e));
}

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await b.close();
await server.close();
stopWorker();
rmSync(persist, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
