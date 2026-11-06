// End-to-end cloud saves (`npm run e2e:cloud`): two devices (browser contexts, each with its own storage) and the Worker
// in cloud/, run locally (`wrangler dev --local`, its R2 in a temporary folder). A turns Cloud save on and is given a
// code; B types it in and carries on with A's railway; B's next change, sent as its page hides, is what A finds when it
// starts again. Then a code that's wrong, and one with nothing saved, are said so. Needs cloud/'s packages
// (`npm --prefix cloud ci`). Chromium as for e2e:roads.
//
// Groups (scripts/e2e/lib/groups.mjs: `-- --list`, E2E_ONLY, resume, E2E_SHARD): `sandbox` (steps 1–6, devices A and B),
// `game-sync` (7–8) and `game-rewards` (9–10), each Game group on two devices of its own (C and D) with a code of its
// own. The whole suite as one ran 19 min idle and 27 min with a CPU hog (14 Game-mode reloads at 60–77 s each), so a
// gate's 1700 s timeout fell on its last step, every check before it passing, and the run was lost. Now a killed run
// keeps the groups that passed, and two shards can run at once (each has a Worker on free ports of its own: its
// own inspector port too, or the second wrangler can't start).
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { createServer as netServer } from "node:net";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { groups } from "./lib/groups.mjs";

const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const errors = [];
const suite = groups("cloud", { results, errors, check });

/** A port nothing listens on (CLOUD_PORT if set): two shards of the suite each run a Worker of their own. */
const freePort = () =>
  new Promise((done, fail) => {
    const s = netServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });

// The dev server, the Worker and the browser: started by the first group that runs (`--list`, or every group cached,
// starts nothing).
let WORKER, URL, server, persist, worker, b;
let workerLog = "";
const stopWorker = () => {
  try {
    if (worker) process.kill(-worker.pid, "SIGTERM");
  } catch {
    // gone
  }
};
// (Killed (a gate's timeout, ^C): the Worker goes too. It runs in a process group of its own, so it would outlive us.)
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    stopWorker();
    process.exit(130);
  });
async function boot() {
  if (b) return;
  const WORKER_PORT = Number(process.env.CLOUD_PORT ?? (await freePort()));
  WORKER = `http://127.0.0.1:${WORKER_PORT}`;
  process.env.VITE_CLOUD_URL = WORKER;
  server = await createServer({ server: { port: 0, strictPort: false, host: "127.0.0.1" }, logLevel: "warn" });
  await server.listen();
  await server.warmupRequest("/src/main.ts");
  URL = server.resolvedUrls.local[0].replace(/\/$/, "");
  const ORIGIN = new globalThis.URL(URL).origin;

  persist = mkdtempSync(join(tmpdir(), "woodrail-cloud-"));
  worker = spawn("npx", ["wrangler", "dev", "--local", "--port", String(WORKER_PORT), "--inspector-port", String(await freePort()), "--ip", "127.0.0.1", "--persist-to", persist, "--var", `ALLOWED_ORIGINS:${ORIGIN}`, "--var", "CODE_KEY:e2e-only-key", "--show-interactive-dev-session=false"], {
    cwd: new globalThis.URL("../../cloud/", import.meta.url),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  worker.stdout.on("data", (d) => (workerLog += d));
  worker.stderr.on("data", (d) => (workerLog += d));
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${WORKER}/v1/saves/sandbox`)).status === 400) break;
    } catch {
      // not up yet
    }
    if (i > 120) {
      console.log(workerLog);
      stopWorker();
      // (Nothing left behind: the next group boots afresh.)
      await server.close();
      rmSync(persist, { recursive: true, force: true });
      throw new Error("the Worker didn't start");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
}

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
    const c = [...document.querySelectorAll(".cloud-card:not(.stats-card) button")].find((b) => b.textContent.trim() === label);
    if (!c) throw new Error(`no ${label} on the card: ${document.querySelector(".cloud-card:not(.stats-card)")?.textContent}`);
    c.click();
  }, label);
const seed = (p) => p.evaluate(() => window.woodrail.landscape.seed);
/** The railway on screen is in the device's autosave (it's saved every 5 s while played). */
const autosaved = (p) => p.waitForFunction(() => (localStorage.getItem("woodrail.autosave.v3") ?? "").includes(`"seed":${window.woodrail.landscape.seed},`), null, { timeout: 20000 }).catch(async (e) => {
    console.log("autosave:", await p.evaluate(() => ({ seed: window.woodrail.landscape.seed, title: window.woodrail.title.shown, mode: window.woodrail.mode(), head: (localStorage.getItem("woodrail.autosave.v3") ?? "").slice(0, 80) })));
    throw e;
  });
// (The cloud card, not the play-stats card, which wears its look: `card cloud-card stats-card`.)
const card = (p) => p.evaluate(() => document.querySelector(".cloud-card:not(.stats-card)")?.textContent ?? "");
const remote = async (code, mode = "sandbox") => {
  const res = await fetch(`${WORKER}/v1/saves/${mode}`, { method: "HEAD", headers: { "X-Woodrail-Code": code } });
  return { status: res.status, savedAt: Number(res.headers.get("X-Saved-At")), size: Number(res.headers.get("Content-Length")) };
};

/**
 * The game, told its connection is back (an upload round: the cloud's copy checked first), starts again on a newer copy:
 * told again every few seconds till it does, as its own timer would (a newer copy waits while a gesture is under way,
 * and a busy machine can be slow to get there), up to two minutes. On none, says what the game was doing.
 */
async function untilTaken(p) {
  let done = false;
  const loaded = p.waitForEvent("load", { timeout: 120_000 }).then(() => (done = true));
  for (let i = 0; i < 24 && !done; i++) {
    await p.evaluate(() => dispatchEvent(new Event("online"))).catch(() => {});
    await Promise.race([loaded.catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  }
  if (!done) {
    const state = await p.evaluate(() => ({ mode: window.woodrail?.interaction?.mode?.kind, status: document.querySelector(".cloud-status")?.textContent ?? null, online: navigator.onLine })).catch((e) => String(e));
    throw new Error(`no reload onto the newer copy in 2 min: ${JSON.stringify(state)}`);
  }
}

// (The cloud takes one upload per code and mode every 10 s.)
const pastLimit = () => new Promise((r) => setTimeout(r, 11_000));

/** Browser contexts a group opened: closed after it, whatever it left (`around` below). */
const contexts = [];
const newContext = async (opts) => {
  const ctx = await b.newContext(opts);
  contexts.push(ctx);
  return ctx;
};

suite.add(
  "sandbox",
  async () => {
    // 1. A: a new map, then Cloud save on: a code, and the railway in the cloud.
    const ctxA = await newContext({ viewport: { width: 1280, height: 800 } });
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
    const ctxB = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const bp = await device(ctxB);
    const seedB0 = await seed(bp);
    await menu(bp, "Cloud save");
    await tap(bp, "Load a save from another device");
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

    // 2b. E: a new device, from the title screen's "Load a cloud save" (by taps): Cancel goes back to the title; the code
    // and Load start the game on A's railway.
    const ctxE = await newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const ep = await ctxE.newPage();
    ep.on("pageerror", (e) => errors.push(String(e)));
    await ep.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
    await ep.goto(URL);
    await ep.waitForFunction(() => !!window.woodrail && window.woodrail.title.shown && !window.woodrail.title.root.classList.contains("placing") && !!document.querySelector(".title-cloud"), null, { timeout: 180000 });
    const tapEl = async (sel) => {
      const r = await ep.evaluate((sel) => {
        const e = [...document.querySelectorAll(sel)].find((x) => x.offsetParent && getComputedStyle(x).visibility !== "hidden");
        if (!e) return null;
        e.scrollIntoView({ block: "center" });
        const q = e.getBoundingClientRect();
        return [q.x + q.width / 2, q.y + q.height / 2];
      }, sel);
      if (!r) throw new Error(`nothing to tap: ${sel}`);
      await ep.touchscreen.tap(r[0], r[1]);
      await ep.waitForTimeout(250);
    };
    const link = await ep.evaluate(() => {
      const q = document.querySelector(".title-cloud").getBoundingClientRect();
      return { text: document.querySelector(".title-cloud").textContent, h: q.height, inside: q.left >= 0 && q.right <= innerWidth };
    });
    check("title: a quiet “Load a cloud save”, a finger's height", /Load a cloud save/.test(link.text) && link.h >= 44 && link.inside, JSON.stringify(link));
    await tapEl(".title-cloud");
    const entry = await ep.evaluate(() => {
      const c = document.querySelector(".title-screen .cloud-card");
      const q = c?.getBoundingClientRect();
      return { open: !!c && !c.hidden, input: !!c?.querySelector(".cloud-input"), says: c?.textContent ?? "", inside: !!q && q.top >= 0 && q.bottom <= innerHeight, cards: getComputedStyle(document.querySelector(".title-cards")).visibility };
    });
    check("…opens the code entry over the title, saying what Load does", entry.open && entry.input && /kept aside and can be restored/.test(entry.says) && entry.inside && entry.cards === "hidden", JSON.stringify(entry));
    await tapEl(".title-screen .cloud-card button:not(.primary)");
    const back = await ep.evaluate(() => ({ closed: document.querySelector(".title-screen .cloud-card").hidden, title: window.woodrail.title.shown, cards: getComputedStyle(document.querySelector(".title-cards")).visibility }));
    check("…Cancel: back to the title", back.closed && back.title && back.cards === "visible", JSON.stringify(back));
    await tapEl(".title-cloud");
    await ep.fill(".title-screen .cloud-input", shown);
    const eLoaded = ep.waitForEvent("load", { timeout: 60000 });
    await tapEl(".title-screen .cloud-card button.primary");
    await eLoaded;
    await ep.waitForFunction(() => window.woodrail?.mode?.() === "sandbox" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
    const seedE = await seed(ep);
    check("…Load: the game starts on A's railway", seedE === seedA, `A ${seedA}; E ${seedE}`);
    await ctxE.close();

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
    await ctxA.setOffline(false);
    await untilTaken(a);
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
  },
  { about: "steps 1–6: A turns Cloud save on, B takes the code; a page hidden sends; QA B1, B2, B3" },
);

/**
 * 7. Game mode, two more devices on a code of their own (C and D, each group its own pair): C turns Cloud save on, D
 * takes the code. With what the Game groups' steps use to send, wait and look.
 */
async function gameDevices() {
  const ctxC = await newContext({ viewport: { width: 1280, height: 800 } });
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
  const ctxD = await newContext({ viewport: { width: 1280, height: 800 } });
  const d = await ctxD.newPage();
  d.on("pageerror", (e) => errors.push(String(e)));
  await d.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await d.goto(URL);
  await inMode(d, "game");
  await menu(d, "Cloud save");
  await tap(d, "Load a save from another device");
  await d.fill(".cloud-input", code2);
  const dIn = d.waitForEvent("load", { timeout: 60000 });
  await tap(d, "Load");
  await dIn;
  await inMode(d, "game");
  const coins = (p) => p.evaluate(() => window.woodrail.progress().coins);
  const remote2 = async () => {
    const res = await fetch(`${WORKER}/v1/saves/game`, { method: "HEAD", headers: { "X-Woodrail-Code": code2 } });
    return { savedAt: Number(res.headers.get("X-Saved-At")), layoutAt: Number(res.headers.get("X-Layout-At")), layoutStoredAt: Number(res.headers.get("X-Layout-Stored-At")) };
  };
  /**
   * Till neither page has anything waiting to go up: each one's upload round, now (as its minute timer would), and
   * whatever it then plays on (a merge may start it again on the other's later copy, with its own to send again).
   */
  const waitingToSend = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("woodrail.cloud.v1")).modes.game.dirty).catch(() => true);
  const quiesce = async () => {
    for (let i = 0; i < 6; i++) {
      const waiting = [];
      for (const p of [c, d]) {
        await inMode(p, "game");
        if (await waitingToSend(p)) waiting.push(p);
      }
      if (waiting.length === 0) return;
      for (const p of waiting) {
        await pastLimit();
        const was = await remote2();
        await p.evaluate(() => dispatchEvent(new Event("online"))).catch(() => {});
        await landed2(was, p);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    throw new Error("the pages never stopped having something to send");
  };
  /** The coins in the cloud's copy of the game (its bundle: gzipped JSON of the mode's storage keys). */
  const cloudCoins2 = async () => {
    const res = await fetch(`${WORKER}/v1/saves/game`, { headers: { "X-Woodrail-Code": code2 } });
    if (!res.ok) return null;
    const bundle = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString());
    return JSON.parse(bundle.keys["woodrail.game.progress.v1"] ?? "{}").coins ?? null;
  };
  /**
   * Started again, on the cloud's copy. The game waits on its start-up check of the cloud for 3 s past loading, then
   * cuts it off and leaves the cloud's copy for its next upload round, which a page with nothing of its own to send
   * hasn't got (QA 2026-11-01: C, reloaded, kept 375 coins where the cloud had 405). Headless, where a frame takes
   * seconds, the check is cut off now and then: the page is started again, as a player opening it again would.
   */
  const restart = async (p) => {
    for (let i = 0; i < 4; i++) {
      await p.reload();
      await inMode(p, "game");
      const m = await p.evaluate(() => JSON.parse(localStorage.getItem("woodrail.cloud.v1")).modes.game);
      if (m.dirty || m.remoteSavedAt === (await remote2()).savedAt) return;
      console.log(`  (${p === c ? "C" : "D"}'s start-up check was cut off: started again)`);
    }
  };
  /**
   * The cloud's copy once it's other than `was` (an upload landing), or after 15 s. Given the page `p` that was told to
   * send: also done when it starts again instead (its new page committed) (a merge that took the other's later copy reloads it, and it sends
   * nothing that round), with one more look at the cloud. (Before, each such round waited out the 15 s for an upload
   * that couldn't come: three times a group, under load.)
   */
  const landed2 = async (was, p = null) => {
    let started = false;
    // (As the new page commits, not at its load: under load that's a minute later.)
    const onLoad = (f) => f === p.mainFrame() && (started = true);
    p?.on("framenavigated", onLoad);
    try {
      let r = await remote2();
      for (let i = 0; i < 60 && r.savedAt === was.savedAt && !started; i++) {
        await new Promise((res) => setTimeout(res, 250));
        r = await remote2();
      }
      return started ? remote2() : r;
    } finally {
      p?.off("framenavigated", onLoad);
    }
  };
  const earnOn = async (p, n) => {
    const want = await p.evaluate((n) => (window.woodrail.progress().coins += n), n);
    await p.waitForFunction((w) => JSON.parse(localStorage.getItem("woodrail.game.progress.v1")).coins === w, want, { timeout: 15000 });
    return want;
  };
  /**
   * A page's next upload round, now (as its timer would, in a minute: the cloud's copy checked first, and merged), and
   * whatever it then plays on (a merge may reload it onto the later railway) is in play. A merge that took the other's
   * later copy starts the page again on it, with the merged copy still to go up, and sends nothing that round: that
   * copy goes in a second round, now too (its timer would send it in a minute).
   */
  const hideAndSettle = async (p, was) => {
    let r = was;
    for (let i = 0; i < 3; i++) {
      await inMode(p, "game");
      await p.evaluate(() => dispatchEvent(new Event("online")));
      r = await landed2(was, p);
      await new Promise((res) => setTimeout(res, 3000));
      await inMode(p, "game");
      if (r.savedAt !== was.savedAt || !(await waitingToSend(p))) break;
      await pastLimit();
    }
    return r;
  };
  // From here both games are paused (a setup shortcut, not what's tested: the steps below make the earnings and send
  // each upload themselves). Running, a new game's forest cuts logs (its `counts`: a progress edit every 15 s or so),
  // so each page also sends its progress on its own minute timer, and one that then finds the other's later copy
  // starts again on it (by design). At a moment of its own, that cut a step off (QA 2026-11-01: `progress` of
  // undefined, D reloading in the middle of step 8). Then what either still has to send goes now.
  const pauseBoth = async () => {
    for (const p of [c, d]) {
      await inMode(p, "game");
      await p.evaluate(() => (window.woodrail.paused = true));
    }
    // (Kept by the 5 s save, so a copy one takes from the other is paused too.)
    await new Promise((r) => setTimeout(r, 6000));
    await quiesce();
  };
  return { c, d, code2, coins, remote2, waitingToSend, quiesce, cloudCoins2, restart, landed2, earnOn, hideAndSettle, pauseBoth };
}

suite.add(
  "game-sync",
  async () => {
    // The game's progress (coins, with trains running) goes up too, but a layout edit outranks it.
    const { c, d, coins, remote2, cloudCoins2, restart, landed2, earnOn, hideAndSettle, pauseBoth } = await gameDevices();
    // 7a. C only earns (a delivery's coins: no edit of the layout), and its page hides. D did nothing: started again,
    // it has C's coins.
    const g0 = await remote2();
    await pastLimit();
    const earned = await c.evaluate(() => (window.woodrail.progress().coins += 120));
    // (The 5 s save sees the progress changed: an edit, of the progress kind.)
    await c.waitForFunction((n) => JSON.parse(localStorage.getItem("woodrail.game.progress.v1")).coins === n, earned, { timeout: 15000 });
    await c.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide")));
    // (Landed: the cloud's copy has C's coins, not just any new copy. C's own minute timer may have sent a copy of its
    // progress just before (the forest's logs cut), and then the Worker turns the one sent as the page hid away as too soon
    // (429, 10 s between uploads): C keeps it and sends it on its next round, prompted here as being back online does.
    // QA 2026-11-01: it failed every run, D reloading onto C's earlier copy, without the coins.)
    let g1 = await landed2(g0);
    for (let i = 0; i < 6 && (await cloudCoins2()) !== earned; i++) {
      await pastLimit();
      await c.evaluate(() => dispatchEvent(new Event("online")));
      g1 = await landed2(g1);
    }
    await restart(d);
    check(
      "Game mode: coins earned on one device (trains running, no layout edit) go up, and the other takes them",
      g1.savedAt > g0.savedAt && g1.layoutAt === g0.layoutAt && (await coins(d)) === earned,
      `cloud ${g0.savedAt} → ${g1.savedAt} (layout at ${g0.layoutAt} → ${g1.layoutAt}); C ${earned}; D ${await coins(d)}`,
    );


    await pauseBoth();

    // 7b. C earns more (not sent yet); D lays a piece of track, sent as its page hides. C's next upload finds D's layout
    // edit: it outranks C's progress, though C's came later. C takes D's railway (starting again on it, and saying so,
    // its own copy kept to restore), but its earnings are merged in (CoS: not rolled back by one piece of track), and
    // go up on D's railway.
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
    // (D's layout copy in: by when the cloud stored a layout edit, not by a fixed wait. Sent as the page hid, it can meet
    // a 409 if C's progress went up just then: D, still with it to send, is prompted again till it's in. QA's race.)
    let g2 = await remote2();
    for (let i = 0; i < 24 && !(g2.layoutStoredAt > g1.layoutStoredAt); i++) {
      await new Promise((r) => setTimeout(r, 5000));
      g2 = await remote2();
      if (!(g2.layoutStoredAt > g1.layoutStoredAt)) await d.evaluate(() => dispatchEvent(new Event("online"))).catch(() => {});
    }
    const dCoins = await coins(d);
    const more = await c.evaluate(() => (window.woodrail.progress().coins += 55));
    await c.waitForFunction((n) => JSON.parse(localStorage.getItem("woodrail.game.progress.v1")).coins === n, more, { timeout: 15000 });
    // (C's next upload, now rather than in a minute.)
    await untilTaken(c);
    await inMode(c, "game");
    const toldC = await c.evaluate(() => document.querySelector(".toast")?.textContent ?? "");
    const g3 = await remote2();
    await menu(c, "Cloud save");
    check(
      "Game mode: a layout edit outranks progress made later: C takes D's track (and says so, its own kept to restore), its earnings merged in",
      g2.layoutAt > g1.layoutAt && (await c.evaluate(() => window.woodrail.layout.pieceCount)) === piecesD && (await coins(c)) === dCoins + 55 && g3.layoutAt === g2.layoutAt && /newer railway/.test(toldC) && /Restore the railway from/.test(await card(c)),
      `D pieces ${piecesD}, C now ${await c.evaluate(() => window.woodrail.layout.pieceCount)}; D coins ${dCoins}, C earned +55 → ${await coins(c)}; cloud layout ${g2.layoutAt} → ${g3.layoutAt}; said “${toldC}”`,
    );

    // 8. Both earn (progress only, on both): merged, nothing lost, nothing said. Then one learns a blueprint while the
    // other earns: both keep both.
    await tap(c, "Done");
    // (The toast keeps its words when it goes: cleared on D, so "no toast" below reads only what's said from here, not a
    // note from 7b, where D's layout copy can meet C's progress going up just then and say so.)
    await d.evaluate(() => (document.querySelector(".toast").textContent = ""));
    const syncedCoins = await coins(c);
    const g4 = await remote2();
    await pastLimit();
    await earnOn(c, 200);
    await earnOn(d, 30);
    const g5 = await hideAndSettle(c, g4);
    await pastLimit();
    const g6 = await hideAndSettle(d, g5);
    await restart(c);
    const both = { c: await coins(c), d: await coins(d), toasts: await d.evaluate(() => document.querySelector(".toast")?.textContent ?? "") };
    check(
      "Game mode: both earn; after each syncs and reloads, both have the sum (and no toast)",
      g6.savedAt > g5.savedAt && both.c === syncedCoins + 230 && both.d === syncedCoins + 230 && !/kept/.test(both.toasts),
      `synced ${syncedCoins}; C +200, D +30 → C ${both.c}, D ${both.d}; said “${both.toasts}”`,
    );
    await pastLimit();
    const learnt = await c.evaluate(() => {
      const w = window.woodrail;
      const id = ["switches", "bridges", "routes", "junctions"].find((t) => !w.progress().learned.has(t));
      w.learn(id);
      return id;
    });
    await c.waitForFunction((id) => JSON.parse(localStorage.getItem("woodrail.game.progress.v1")).learned.includes(id), learnt, { timeout: 15000 });
    const earned2 = (await earnOn(d, 45)) - both.d;
    const g7 = await hideAndSettle(c, g6);
    await pastLimit();
    await hideAndSettle(d, g7);
    await restart(c);
    const kept = await Promise.all([c, d].map((p) => p.evaluate((id) => ({ learned: window.woodrail.progress().learned.has(id), coins: window.woodrail.progress().coins }), learnt)));
    check(
      "Game mode: one learns a blueprint while the other earns: both keep both",
      kept.every((k) => k.learned && k.coins === both.d + earned2),
      `learned ${learnt}; ${JSON.stringify(kept)} (want coins ${both.d + earned2})`,
    );
  },
  { about: "steps 7–8: Game mode on C and D: coins go up; a layout edit outranks later progress; both earn; a blueprint and coins" },
);

suite.add(
  "game-rewards",
  async () => {
    const { c, d, coins, remote2, restart, hideAndSettle, pauseBoth } = await gameDevices();
    await pauseBoth();

    // 9. One town grows on both devices (each draws its own cards): after both sync, one offer for it, not two.
    await pastLimit();
    const grow = (p) =>
      p.evaluate(async () => {
        const w = window.woodrail;
        const { offerOnGrowth } = await import("/src/game/rewards.ts");
        offerOnGrowth(w.progress(), w.world, "Testbury", 2, Math.random);
      });
    const offersFor = (p) => p.evaluate(() => window.woodrail.progress().offers.filter((o) => o.from === "Testbury" && o.level === 2).length);
    await grow(c);
    await grow(d);
    for (const p of [c, d]) await p.waitForFunction(() => (localStorage.getItem("woodrail.game.progress.v1") ?? "").includes("Testbury"), null, { timeout: 15000 });
    const g8 = await remote2();
    const g9 = await hideAndSettle(c, g8);
    await pastLimit();
    await hideAndSettle(d, g9);
    await restart(c);
    const offers = { c: await offersFor(c), d: await offersFor(d) };
    check("Game mode: one town's growth seen on both devices is one reward offer, not two (QA)", offers.c === 1 && offers.d === 1, JSON.stringify(offers));

    // 10. A city's offer synced to both, and its 200 coins taken on both before they sync again: paid once (QA: 400).
    await pastLimit();
    const city = (p) => p.evaluate(() => window.woodrail.progress().offers.some((o) => o.from === "Testbury" && o.level === 3));
    await c.evaluate(() => window.woodrail.progress().offers.push({ from: "Testbury", level: 3, cards: [{ kind: "coins", n: 200 }, { kind: "coins", n: 1 }] }));
    await c.waitForFunction(() => JSON.parse(localStorage.getItem("woodrail.game.progress.v1")).offers.some((o) => o.from === "Testbury" && o.level === 3), null, { timeout: 15000 });
    const g11 = await hideAndSettle(c, await remote2());
    // (D, with nothing of its own to send, picks the cloud's copy up when it starts.)
    await restart(d);
    const before = { c: await coins(c), d: await coins(d), offer: (await city(c)) && (await city(d)) };
    const take = (p) =>
      p.evaluate(async () => {
        const w = window.woodrail;
        const { takeCard } = await import("/src/game/rewards.ts");
        const k = w.progress().offers.findIndex((o) => o.from === "Testbury" && o.level === 3);
        return takeCard(w.progress(), w.world, k, 0) !== null;
      });
    const took = [await take(c), await take(d)];
    for (const [p, n] of [[c, before.c], [d, before.d]]) await p.waitForFunction((n) => JSON.parse(localStorage.getItem("woodrail.game.progress.v1")).coins === n, n + 200, { timeout: 15000 }).catch(() => {});
    await pastLimit();
    const g12 = await hideAndSettle(c, g11);
    await pastLimit();
    await hideAndSettle(d, g12);
    await restart(c);
    const after = { c: await coins(c), d: await coins(d), offer: (await city(c)) || (await city(d)) };
    check(
      "Game mode: a reward taken on both devices pays once (QA: 0 → 400)",
      before.offer && before.c === before.d && took.every(Boolean) && after.c === before.c + 200 && after.d === before.c + 200 && !after.offer,
      `before ${JSON.stringify(before)}; took ${took}; after ${JSON.stringify(after)} (want ${before.c + 200})`,
    );
  },
  { about: "steps 9–10: Game mode on C and D: one town's growth is one offer; a reward taken on both pays once" },
);

await suite.run(async (_g, go) => {
  await boot();
  try {
    await go();
  } finally {
    for (const ctx of contexts.splice(0)) await ctx.close().catch(() => {});
  }
});

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
if (b) {
  await b.close();
  await server.close();
  stopWorker();
  rmSync(persist, { recursive: true, force: true });
}
suite.finish();
