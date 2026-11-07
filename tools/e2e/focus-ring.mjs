// End-to-end keyboard focus ring (`npm run e2e:focus-ring [-- <out dir>]`), in Game mode at 390×844 (a phone, taps)
// and 1440×900 (a mouse). The user's report: a clicked tray tab grew a blue ring that lapped onto its neighbours and
// was cut off at top and bottom by the tab strip, because Chrome's :focus-visible turns on for a clicked button as soon
// as any key is pressed (and the game takes keys: the camera, shortcuts). Checks, at each size:
//   - the tray's Trains tab, clicked (or tapped) and then a camera key pressed: no ring;
//   - Tab, then the same tab focused: the 3px blue ring, drawn inside the tab (offset -3px), so its strip can't clip it
//     and it doesn't reach a neighbour;
//   - the same two for the Journal's tabs, a research board node, the board ticket's chip buttons, the top bar chips:
//     no ring after a click and a key, and the same inset ring by keyboard (one rule for every control).
// Screenshots of the tray tabs, mouse-selected and keyboard-focused, go to the out dir (`<prefix>-<width>-click.png`,
// `<prefix>-<width>-keyboard.png`; prefix from $SHOT_PREFIX, default "after").
// Starts its own dev server (on 5391, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/focus-ring";
const PREFIX = process.env.SHOT_PREFIX ?? "after";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5391, strictPort: false }, logLevel: "error" });
await server.listen();
const PAGE = server.resolvedUrls.local[0];
const CHROMIUM = process.env.CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const b = await chromium.launch({ executablePath: CHROMIUM, headless: false, args: ["--headless=new", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
let failures = 0;
const check = (what, ok, detail = "") => {
  if (!ok) failures++;
  console.log(ok ? "PASS" : "FAIL", what, detail);
};

for (const size of [
  { width: 390, height: 844, touch: true },
  { width: 1440, height: 900, touch: false },
]) {
  const tag = `${size.width}`;
  const p = await b.newPage({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, hasTouch: size.touch, isMobile: size.touch });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.addInitScript(() => localStorage.setItem("woodrail.helpSeen", "1"));
  await p.goto(PAGE);
  await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
  await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click() || (document.querySelector('.new-game-sheet:not([hidden]) [data-hills="hilly"]')?.click(), document.querySelector(".new-game-sheet:not([hidden]) .new-game-start")?.click()));
  await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
  await p.evaluate(() => Promise.race([window.woodrail.settled(3), new Promise((r) => setTimeout(r, 20000))]));
  await p.keyboard.press("Escape");
  // Setup shortcut (not the thing under test): a line between the first two towns and a school, so the research pill
  // and board are there to check.
  await p.evaluate(async () => {
    const { play } = await import("/src/play/player.ts");
    const { rulesFor, schoolOn } = await import("/src/play/rules.ts");
    const { connectorRef } = await import("/src/track/layout.ts");
    const w = window.woodrail;
    const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
    play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
    schoolOn(w.world, w.editor(), new Set());
    w.invalidate();
  });
  await p.waitForTimeout(600);

  /** The focused element's ring: outline style, width and offset, and whether :focus-visible matches. */
  const ring = () =>
    p.evaluate(() => {
      const a = document.activeElement;
      const s = getComputedStyle(a);
      return { el: `${a.tagName.toLowerCase()}.${[...a.classList].join(".")} "${a.textContent.trim().slice(0, 20)}"`, style: s.outlineStyle, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset), color: s.outlineColor };
    });
  const noRing = (r) => r.style === "none" || r.width === 0;
  // Inside the control: the whole 3px line within its own box, so a scrolling strip can't clip it nor a neighbour be lapped.
  const insetRing = (r) => r.style === "solid" && r.width === 3 && r.offset <= -r.width && r.color === "rgb(47, 111, 181)";
  /** Click (or tap) the first visible `selector` (text starting `text`), then press a camera key. */
  const pointerThenKey = async (selector, text) => {
    const at = await p.evaluate(({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => (text === undefined || e.textContent.trim().startsWith(text)) && e.getBoundingClientRect().width > 0);
      if (!el) return null;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }, { selector, text });
    if (!at) return null;
    if (size.touch) await p.touchscreen.tap(at.x, at.y);
    else await p.mouse.click(at.x, at.y);
    await p.waitForTimeout(250);
    await p.keyboard.press("w");
    await p.waitForTimeout(150);
    return ring();
  };
  /** Tab (the player moving focus by keyboard), then focus the first visible `selector` as Tab would reach it. */
  const keyboardTo = async (selector, text) => {
    await p.keyboard.press("Tab");
    const ok = await p.evaluate(({ selector, text }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => (text === undefined || e.textContent.trim().startsWith(text)) && e.getBoundingClientRect().width > 0);
      if (!el) return false;
      el.focus();
      return document.activeElement === el;
    }, { selector, text });
    await p.waitForTimeout(150);
    return ok ? ring() : null;
  };
  const trayShot = async (name) => {
    // Headless, an idle page may not tick a CSS transition along (the tab's background stays part-way): finish them,
    // so the picture shows the tabs as a player sees them.
    await p.evaluate(() => document.getAnimations().forEach((a) => a.finish()));
    const r = await p.evaluate(() => {
      const t = document.querySelector(".tray").getBoundingClientRect();
      return { x: Math.max(0, t.x), y: Math.max(0, t.y - 70), width: Math.min(innerWidth, t.width), height: Math.min(innerHeight - Math.max(0, t.y - 70), t.height + 70) };
    });
    await p.screenshot({ path: `${OUT}/${PREFIX}-${tag}-${name}.png`, clip: r, timeout: 120000 }).catch((e) => console.log(`(no picture: ${e.message.split("\n")[0]})`));
  };

  // 1. The tray's tabs: the user's case.
  const clicked = await pointerThenKey(".tray .tab", "Trains");
  check(`${tag}: Trains tab ${size.touch ? "tapped" : "clicked"}, then a key: no ring`, !!clicked && noRing(clicked), JSON.stringify(clicked));
  const active = await p.evaluate(() => document.querySelector(".tray .tab.active")?.textContent);
  check(`${tag}: …and Trains is the selected tab`, active === "Trains", String(active));
  await trayShot("click");
  const kbd = await keyboardTo(".tray .tab", "Trains");
  check(`${tag}: Trains tab by keyboard: the blue ring, inside the tab`, !!kbd && insetRing(kbd), JSON.stringify(kbd));
  // The ring's outer edge is the tab's own box: within the strip's visible box (its scroller clips at its edges).
  const fit = await p.evaluate(() => {
    const t = document.activeElement.getBoundingClientRect();
    const s = document.activeElement.closest(".tabs").getBoundingClientRect();
    return { inStrip: t.top >= s.top - 0.5 && t.bottom <= s.bottom + 0.5, tab: [t.left, t.top, t.right, t.bottom].map(Math.round), strip: [s.left, s.top, s.right, s.bottom].map(Math.round) };
  });
  check(`${tag}: …the tab (and so its ring) within the strip's height, not cut off`, fit.inStrip, JSON.stringify(fit));
  await trayShot("keyboard");
  await p.mouse.click(2, 2).catch(() => {});

  // 2. The other controls with the ring: the Journal's tabs, the research board, its ticket's buttons, the bar's chips.
  const open = await p.evaluate(() => {
    const g = document.querySelector(".goals");
    if (g?.classList.contains("collapsed")) document.querySelector(".goals-head")?.click();
    return !document.querySelector(".goals")?.classList.contains("collapsed");
  });
  await p.waitForTimeout(300);
  if (open) {
    const gc = await pointerThenKey(".goals-tab", "News");
    check(`${tag}: Journal News tab clicked, then a key: no ring`, !!gc && noRing(gc), JSON.stringify(gc));
    const gk = await keyboardTo(".goals-tab", "Goals");
    check(`${tag}: Journal Goals tab by keyboard: the same inset ring`, !!gk && insetRing(gk), JSON.stringify(gk));
    const sk = await keyboardTo(".goals-show, .goals .chip");
    if (sk) check(`${tag}: Journal chip by keyboard: the same inset ring`, insetRing(sk), JSON.stringify(sk));
    await p.evaluate(() => document.querySelector(".goals-close")?.offsetParent ? document.querySelector(".goals-close").click() : document.querySelector(".goals-head")?.click());
    await p.waitForTimeout(300);
  } else check(`${tag}: the Journal opens`, false);
  await p.evaluate(() => document.querySelector(".research-pill")?.click());
  await p.waitForTimeout(800);
  const nodes = await p.evaluate(() => document.querySelectorAll(".board-body .bp-node").length);
  check(`${tag}: the research board is open`, nodes > 0, String(nodes));
  if (nodes > 0) {
    const nc = await pointerThenKey(".board-body .bp-node");
    // (A pick redraws the board, so focus may drop to the page: either way, no ring.)
    check(`${tag}: a research node clicked, then a key: no ring`, !!nc && noRing(nc), JSON.stringify(nc));
    const nk = await keyboardTo(".board-body .bp-node");
    check(`${tag}: a research node by keyboard: the same inset ring`, !!nk && insetRing(nk), JSON.stringify(nk));
    const tk = await keyboardTo(".board-sheet .bp-ticket .chip");
    check(`${tag}: the ticket's chip button by keyboard: the same inset ring`, !!tk && insetRing(tk), JSON.stringify(tk));
    await p.keyboard.press("Escape");
    await p.waitForTimeout(300);
  }
  const bk = await keyboardTo(".hud .chip");
  check(`${tag}: a top bar chip by keyboard: the same inset ring`, !!bk && insetRing(bk), JSON.stringify(bk));
  await p.mouse.click(2, 2).catch(() => {});
  check(`${tag}: no page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await p.close();
}

await b.close();
await server.close();
console.log(failures ? `${failures} FAILED` : "all passed");
process.exit(failures ? 1 : 0);
