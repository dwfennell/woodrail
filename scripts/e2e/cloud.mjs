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
const worker = spawn("npx", ["wrangler", "dev", "--local", "--port", String(WORKER_PORT), "--ip", "127.0.0.1", "--persist-to", persist, "--var", `ALLOWED_ORIGINS:${ORIGIN}`, "--var", "CODE_KEY:e2e-only-key", "--show-interactive-dev-session=false"], {
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
  await inMode(p, "sandbox");
}
/** Into a mode: playing (the HUD up: a reload into play skips the title), or its title card pressed. */
async function inMode(p, mode) {
  // (The loading screen goes once a mode's entered: before that the HUD and the title can both be hidden.)
  const playing = (mode) => window.woodrail?.mode?.() === mode && !window.woodrail.title.shown && !window.woodrail.hud.root.hidden && !!document.querySelector("#loading.done");
  await p.waitForFunction(
    ([playing, mode]) => new Function(`return (${playing})`)()(mode) || (!!window.woodrail && window.woodrail.title.shown && !window.woodrail.title.root.classList.contains("placing") && document.querySelector(`.title-card.mode-${mode} .title-buttons .primary`) !== null),
    [String(playing), mode],
    { timeout: 180000 },
  );
  await p.evaluate((mode) => {
    if (window.woodrail.title.shown) document.querySelector(`.title-card.mode-${mode} .title-buttons .primary`).click();
  }, mode);
  await p.waitForFunction(playing, mode, { timeout: 120000 });
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

  // 3b. (QA B1) A, open and running (its clock going on, nothing edited) past its 30 s timer: it sends nothing, so
  // B's edit stays.
  await a.evaluate(() => (window.woodrail.paused = false));
  await new Promise((r) => setTimeout(r, 36_000));
  const r3 = await remote(code);
  check("a device only open, running, sends nothing over another's edit (QA B1)", r3.savedAt === r2.savedAt, `${r2.savedAt} → ${r3.savedAt}`);

  // 4. A starts again: B's newer railway is the one it opens (A hadn't changed its own: no backup, no toast).
  await a.reload();
  await inSandbox(a);
  check("A, started again, opens B's newer railway", (await seed(a)) === seedB2, `A ${await seed(a)}; B ${seedB2}`);
  await menu(a, "Cloud save");
  check("…with no backup offered (nothing of A's was lost)", !/Restore/.test(await card(a)), await card(a));
  await tap(a, "Done");
  console.log(`  bundle sizes (gzipped): ${r1.size} B, ${r2.size} B`);

  // (The cloud takes one upload per code and mode every 10 s.)
  const pastLimit = () => new Promise((r) => setTimeout(r, 11_000));
  /** Wait for the cloud's copy to be other than `was` (an upload landing). */
  const landed = async (was) => {
    let r = await remote(code);
    for (let i = 0; i < 60 && r.savedAt === was.savedAt; i++) {
      await new Promise((res) => setTimeout(res, 250));
      r = await remote(code);
    }
    return r;
  };

  // 5. (QA B3) Both paused. A edits (a new map) and its page hides: sent. B, which only sat there (its pages hid and
  // saved, nothing edited), starts again: it takes A's, and sends nothing over it.
  await a.evaluate(() => (window.woodrail.paused = true));
  await bp.evaluate(() => (window.woodrail.paused = true));
  // (B's backup now: its own first railway, kept when it took A's code. A sync now mustn't add another.)
  const keptB = () => bp.evaluate(() => localStorage.getItem("woodrail.cloud.backup.sandbox"));
  const keptB0 = await keptB();
  await bp.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  await pastLimit();
  await menu(a, "New map");
  await a.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  const seedA3 = await seed(a);
  await autosaved(a);
  await a.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  const r4 = await landed(r3);
  await bp.reload();
  await inSandbox(bp);
  await new Promise((r) => setTimeout(r, 2000));
  const r5 = await remote(code);
  await menu(bp, "Cloud save");
  check(
    "a device that only sat there takes the other's edit at its next start, and sends nothing over it (QA B3)",
    r4.savedAt > r3.savedAt && (await seed(bp)) === seedA3 && r5.savedAt === r4.savedAt && (await keptB()) === keptB0,
    `cloud ${r3.savedAt} → ${r4.savedAt} → ${r5.savedAt}; A ${seedA3}; B ${await seed(bp)}`,
  );
  await tap(bp, "Done");

  // 6. (QA B2) A goes offline and edits (a new map). B edits later (another), and sends it. A back online: B's edit
  // was the later, so A takes it (the game starts again on it, and says so), A's kept to restore; nothing sent over B's.
  await ctxA.setOffline(true);
  await menu(a, "New map");
  await a.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  const seedAOff = await seed(a);
  await autosaved(a);
  await pastLimit();
  await menu(bp, "New map");
  await bp.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 60000 });
  const seedB6 = await seed(bp);
  await autosaved(bp);
  await bp.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  const r6 = await landed(r5);
  const reloadedA = a.waitForEvent("load", { timeout: 60000 });
  await ctxA.setOffline(false);
  // (The page hears it's back online; told again, in case the browser didn't say.)
  await a.evaluate(() => dispatchEvent(new Event("online"))).catch(() => {});
  await reloadedA;
  await inSandbox(a);
  const told = await a.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
  const r7 = await remote(code);
  await menu(a, "Cloud save");
  check(
    "back online, an edit made offline before the other device's: A takes B's (and says so), keeps its own to restore, sends nothing over it (QA B2)",
    seedAOff !== seedB6 && (await seed(a)) === seedB6 && r7.savedAt === r6.savedAt && /Restore the railway from/.test(await card(a)) && /newer railway/.test(told),
    `A offline ${seedAOff}; B ${seedB6}; A now ${await seed(a)}; cloud ${r6.savedAt} → ${r7.savedAt}; said “${told}”; card ${await card(a)}`,
  );
  await ctxA.close();
  await ctxB.close();

  // 7. Game mode, two more devices on a code of their own: the game's progress (coins, with trains running) goes up
  // too, but a layout edit outranks it.
  const ctxC = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const c = await ctxC.newPage();
  c.on("pageerror", (e) => errors.push(String(e)));
  await c.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await c.goto(URL);
  await inMode(c, "game");
  await c.waitForFunction(() => localStorage.getItem("woodrail.game.v2") !== null, null, { timeout: 30000 });
  await menu(c, "Cloud save");
  await tap(c, "Turn on");
  await c.waitForFunction(() => /Saved online/.test(document.querySelector(".cloud-status")?.textContent ?? ""), null, { timeout: 30000 });
  const code2 = (await c.evaluate(() => document.querySelector(".cloud-code").textContent)).trim().replace(/ /g, "-");
  await tap(c, "Done");
  const ctxD = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await ctxD.newPage();
  d.on("pageerror", (e) => errors.push(String(e)));
  await d.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await d.goto(URL);
  await inMode(d, "game");
  await menu(d, "Cloud save");
  await tap(d, "I have a code");
  await d.fill(".cloud-input", code2);
  const dIn = d.waitForEvent("load", { timeout: 60000 });
  await tap(d, "Load");
  await dIn;
  await inMode(d, "game");
  const coins = (p) => p.evaluate(() => window.woodrail.progress().coins);
  const remote2 = async () => {
    const res = await fetch(`${WORKER}/v1/saves/game`, { method: "HEAD", headers: { "X-Woodrail-Code": code2 } });
    return { savedAt: Number(res.headers.get("X-Saved-At")), layoutAt: Number(res.headers.get("X-Layout-At")) };
  };
  const landed2 = async (was) => {
    let r = await remote2();
    for (let i = 0; i < 60 && r.savedAt === was.savedAt; i++) {
      await new Promise((res) => setTimeout(res, 250));
      r = await remote2();
    }
    return r;
  };

  // 7a. C only earns (a delivery's coins: no edit of the layout), and its page hides. D did nothing: started again,
  // it has C's coins.
  const g0 = await remote2();
  await pastLimit();
  const earned = await c.evaluate(() => (window.woodrail.progress().coins += 120));
  // (The 5 s save sees the progress changed: an edit, of the progress kind.)
  await c.waitForFunction((n) => JSON.parse(localStorage.getItem("woodrail.game.progress.v1")).coins === n, earned, { timeout: 15000 });
  await c.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  const g1 = await landed2(g0);
  await d.reload();
  await inMode(d, "game");
  check(
    "Game mode: coins earned on one device (trains running, no layout edit) go up, and the other takes them",
    g1.savedAt > g0.savedAt && g1.layoutAt === g0.layoutAt && (await coins(d)) === earned,
    `cloud ${g0.savedAt} → ${g1.savedAt} (layout at ${g0.layoutAt} → ${g1.layoutAt}); C ${earned}; D ${await coins(d)}`,
  );

  // 7b. C earns more (not sent yet); D lays a piece of track, sent as its page hides. C's next upload finds D's layout
  // edit: it outranks C's progress, though C's came later. C takes D's (starting again on it, and saying so), its
  // coins kept to restore; nothing goes over D's.
  await pastLimit();
  const piecesD = await d.evaluate(() => {
    const w = window.woodrail;
    const g = w.interaction.groundAt(innerWidth / 2, innerHeight / 2);
    w.editor().place("straight-216", { x: g.x, z: g.z, heading: 0 }, 0, false);
    return w.layout.pieceCount;
  });
  await d.waitForFunction((n) => {
    const s = localStorage.getItem("woodrail.game.v2") ?? "";
    return (s.match(/"type":/g) ?? []).length >= 0 && window.woodrail.layout.pieceCount === n;
  }, piecesD);
  await new Promise((r) => setTimeout(r, 1500));
  await d.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
  const g2 = await landed2(g1);
  const more = await c.evaluate(() => (window.woodrail.progress().coins += 55));
  await c.waitForFunction((n) => JSON.parse(localStorage.getItem("woodrail.game.progress.v1")).coins === n, more, { timeout: 15000 });
  const cIn = c.waitForEvent("load", { timeout: 60000 });
  // (C's next upload, now rather than in a minute.)
  await c.evaluate(() => dispatchEvent(new Event("online")));
  await cIn;
  await inMode(c, "game");
  const toldC = await c.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
  const g3 = await remote2();
  await menu(c, "Cloud save");
  check(
    "Game mode: a layout edit outranks progress made later: C takes D's track (and says so), its coins kept to restore",
    g2.layoutAt > g1.layoutAt && (await c.evaluate(() => window.woodrail.layout.pieceCount)) === piecesD && (await coins(c)) === earned && g3.savedAt === g2.savedAt && /newer railway/.test(toldC) && /Restore the railway from/.test(await card(c)),
    `D pieces ${piecesD}, C now ${await c.evaluate(() => window.woodrail.layout.pieceCount)}; C coins ${more} → ${await coins(c)}; cloud ${g2.savedAt} → ${g3.savedAt}; said “${toldC}”`,
  );
  await ctxC.close();
  await ctxD.close();
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
