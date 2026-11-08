// End-to-end Landscaping in Game mode (`npm run e2e:landscaping [-- <out dir>]`), on a phone at 390×844 with touch: before
// it's learned the Add land card has no Lower hills; learned, the card's "⛰️ Lower hills" switches it over; a tap on a
// hill square asks "Lower this hill a step…? It costs 200 coins"; "Lower it" pays, the square is a step lower (and saved
// so), and a straight that the hill refused ("The hill is a level up here") now goes down flat there.
//
// Setup shortcuts (named, not what's under test): Landscaping learned through the game's own `learned` (the study
// skipped); coins given as towns would pay them. The straight is put down by the editor after the placement check the
// tray's drop makes (`interaction.placement`).
//
// Starts its own dev server (on 5395, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/landscaping";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5395, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
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
const settle = () => p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
const glided = () => p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 120000, polling: 250 }).catch(() => console.log("  (the camera was still gliding after 120 s)"));
/** Tap the middle of the first visible button with this title (or whose text starts with `text`). */
const tapButton = async ({ title, text }) => {
  const box = await p.evaluate(
    ({ title, text }) => {
      const el = [...document.querySelectorAll("button")].find((e) => (title ? e.title === title || e.getAttribute("aria-label") === title : e.textContent.trim().startsWith(text)) && e.getBoundingClientRect().width > 0 && !e.hidden);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { title, text },
  );
  if (!box) return false;
  await p.touchscreen.tap(box.x, box.y);
  await p.waitForTimeout(400);
  return true;
};
const card = () => p.evaluate(() => {
  const c = document.querySelector(".land-card");
  if (!c || c.hidden) return null;
  const buttons = [...c.querySelectorAll("button")].filter((x) => !x.hidden).map((x) => x.textContent.trim());
  return { title: c.querySelector(".card-title")?.textContent, text: c.querySelector(".land-text")?.textContent, buttons };
});
const openAddLand = async () => {
  // (A toast over the top bar takes the first tap: try again till the card is open.)
  for (let k = 0; k < 4 && !(await card()); k++) {
    if (!(await tapButton({ title: "Choose land to add to the map" }))) {
      await tapButton({ title: "Menu" });
      await tapButton({ title: "Choose land to add to the map" });
    }
    await p.waitForTimeout(800);
  }
  await glided();
  await settle();
};

await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");

// 1. Not learned: the Add land card has no Lower hills.
await openAddLand();
const before = await card();
check("not learned: the Add land card, no Lower hills", before?.title === "Add land" && !before.buttons.some((x) => x.includes("Lower hills")), JSON.stringify(before));
await tapButton({ text: "Done" });

// 2. A hill square that a straight can't go flat over now, and could once it's a step lower.
const target = await p.evaluate(async () => {
  const { LandEditor } = await import("/src/landscape/edit.ts");
  const w = window.woodrail;
  const land = w.world.landscape;
  const g = land.grid;
  const editor = new LandEditor(land, w.world.layout);
  for (let i = 0; i < g.height.length; i++) {
    if (g.height[i] !== 1 || editor.check(i, -1) !== null) continue;
    for (const heading of [0, Math.PI / 2]) {
      // A straight centred on the square.
      const pose = { x: g.centreX(g.colOf(i)) - 108 * Math.cos(heading), z: g.centreZ(g.rowOf(i)) - 108 * Math.sin(heading), heading };
      const now = w.interaction.placement("straight-216", false, pose, 0, -1).reason;
      if (now !== "hill") continue;
      g.height[i] = 0;
      const flat = w.interaction.placement("straight-216", false, pose, 0, -1).reason;
      g.height[i] = 1;
      if (!flat) return { i, pose, x: g.centreX(g.colOf(i)), z: g.centreZ(g.rowOf(i)) };
    }
  }
  return null;
});
check("found a hill square a straight is refused on, that would be flat a step lower", !!target, JSON.stringify(target));

if (target) {
  // 3. Learned, and coins: the card switches to lowering hills.
  await p.evaluate(() => {
    const w = window.woodrail;
    w.learn("landscaping");
    w.progress().coins = 1000;
    w.hud.setCoins(1000);
  });
  await p.waitForTimeout(1500);
  await shot("0-learned");
  await openAddLand();
  await shot("0b-open");
  const add = await card();
  check("learned: the Add land card has \"⛰️ Lower hills\"", add?.buttons.includes("⛰️ Lower hills"), JSON.stringify(add));
  await tapButton({ text: "⛰️ Lower hills" });
  const lowering = await card();
  check("…a tap switches it to Lower hills: \"Tap a hill square…\"", lowering?.title === "Lower hills" && /^Tap a hill square to lower it a step/.test(lowering.text ?? "") && lowering.buttons.includes("➕ Add land"), JSON.stringify(lowering));

  // The camera to the square, then a tap on its top.
  await p.evaluate(({ x, z }) => window.woodrail.director.glideTo(new window.woodrail.camera.position.constructor(x, 48, z), 700, { duration: 0.1 }), target);
  await glided();
  await settle();
  const at = await p.evaluate(({ x, z }) => {
    const w = window.woodrail;
    const v = new w.camera.position.constructor(x, 48, z).project(w.camera);
    const r = w.canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, target);
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(600);
  const asked = await card();
  check("a tap on the hill: \"Lower this hill a step, from level 1 to 0? It costs 200 coins (you have 1000).\"", asked?.text === "Lower this hill a step, from level 1 to 0? It costs 200 coins (you have 1000)." && asked.buttons.includes("Lower it · 200🪙"), JSON.stringify(asked));
  await shot("1-asked");

  // 4. "Lower it": paid, a step lower, saved so.
  await tapButton({ text: "Lower it" });
  await settle();
  const after = await p.evaluate(async ({ i, pose }) => {
    const { serializeWorld, deserializeWorld } = await import("/src/persist/save.ts");
    const w = window.woodrail;
    const back = deserializeWorld(JSON.parse(JSON.stringify(serializeWorld(w.world))));
    return {
      coins: w.progress().coins,
      height: w.world.landscape.grid.height[i],
      saved: back.ok ? back.value.landscape.grid.height[i] : "not ok",
      reason: w.interaction.placement("straight-216", false, pose, 0, -1).reason ?? null,
    };
  }, target);
  const done = await card();
  check("\"Lower it\": 200 coins paid, the square a step lower, and saved so", after.coins === 800 && after.height === 0 && after.saved === 0, JSON.stringify(after));
  check("…the card says so", /^Lowered: it's flat now/.test(done?.text ?? ""), JSON.stringify(done));
  await shot("2-lowered");

  // 5. Track now goes down flat there.
  check("a straight that the hill refused now fits flat", after.reason === null, JSON.stringify(after));
  const laid = await p.evaluate(({ pose }) => {
    const w = window.woodrail;
    if (w.interaction.placement("straight-216", false, pose, 0, -1).reason) return null;
    const id = w.editor().place("straight-216", pose, 0, false);
    w.invalidate();
    return id === undefined || id === null ? null : { id, y: w.world.layout.getPiece(id).y ?? 0 };
  }, target);
  check("…and goes down, on the ground", !!laid && laid.y === 0, JSON.stringify(laid));
  await tapButton({ text: "Done" });
  await settle();
  await shot("3-track-on-it");

  // 6. Flat ground and coins short both say why.
  await p.evaluate(() => {
    const w = window.woodrail;
    w.progress().coins = 50;
    w.hud.setCoins(50);
  });
  await openAddLand();
  await tapButton({ text: "⛰️ Lower hills" });
  await p.touchscreen.tap(at.x, at.y);
  await p.waitForTimeout(600);
  const flat = await card();
  check("tapping flat ground (or the new track): says why, no Lower it", !!flat?.text && !flat.buttons.some((x) => x.startsWith("Lower it")), JSON.stringify(flat));
}

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await b.close();
await server.close();
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
