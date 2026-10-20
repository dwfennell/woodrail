// End-to-end growth menu on a phone (`npm run e2e:growth [-- <out dir>]`), at 390×844 with touch: a new game's line
// laid, its school placed and a workshop beside the line; Larkfield grows to a village and then a town; each time the
// bottom sheet "Larkfield grew! Pick one" comes up with three large cards (icon, amount, one line); one tap takes a card
// (no confirm); every kind of card is taken in turn (planks, coins, a crate, a wagon, a research boost, rare cargo) and
// checked to have done what it says; an offer closed (✕, or a tap on the shade) keeps waiting with a badge, and comes
// back from the badge and from the growth toast; no blueprint is learned by growth; no frames drawn while the sheet or
// the badge sits there.
//
// Usage: npm run e2e:growth [-- <out dir>]   (default out: e2e-out/growth)
// Starts its own dev server (on 5382, or the next free port). Chromium: $CHROMIUM_PATH, else /opt/pw-browsers/chromium
// if present, else Playwright's own.
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT = process.argv[2] ?? "e2e-out/growth";
mkdirSync(OUT, { recursive: true });
const server = await createServer({ root: ROOT, configFile: `${ROOT}/vite.config.ts`, server: { port: 5382, strictPort: false }, logLevel: "error" });
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

/** The sheet as it shows: open?, its title, its cards (kind, text, size, held), the badge. */
const sheet = () =>
  p.evaluate(() => {
    const root = document.querySelector(".growth-sheet");
    // (Its slide-up finished: the sheet as it settles. Headless, CSS animations only move on frames drawn.)
    for (const a of document.querySelector(".gs-panel")?.getAnimations() ?? []) a.finish();
    const badge = document.querySelector(".reward-badge");
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
    };
    return {
      open: !!root && !root.hidden,
      title: root?.querySelector("h2")?.textContent ?? null,
      cards: [...(root?.querySelectorAll(".gs-card") ?? [])].map((c) => ({
        kind: [...c.classList].find((k) => k.startsWith("gs-") && k !== "gs-card").slice(3),
        icon: c.querySelector(".gs-icon").textContent,
        amount: c.querySelector(".gs-amount").textContent,
        line: c.querySelector(".gs-line").textContent,
        held: c.getAttribute("aria-disabled") === "true",
        box: r(c),
      })),
      badge: badge && !badge.hidden ? { text: badge.textContent, box: r(badge) } : null,
      width: innerWidth,
      height: innerHeight,
    };
  });
/** Tap the middle of the first visible element matching `selector`. */
const tap = async (selector) => {
  const box = await p.evaluate((selector) => {
    const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!box) return false;
  await p.touchscreen.tap(box.x, box.y);
  await p.waitForTimeout(400);
  return true;
};
/** Tap the sheet's card of this kind. */
const take = (kind) => tap(`.growth-sheet .gs-card.gs-${kind}`);
const state = () =>
  p.evaluate(() => {
    const w = window.woodrail;
    const pr = w.progress();
    const yard = w.economy.allDepots().find((d) => d.role === "workshop");
    return {
      offers: pr.offers.length,
      coins: pr.coins,
      learned: [...pr.learned].sort().join(","),
      yard: yard ? yard.piles[1] : null,
      got: { ...pr.research.got },
      current: pr.research.current,
      owned: Object.fromEntries(pr.owned),
    };
  });
/** Grow Larkfield to `planks` delivered (4: a village, 12: a town), as a train's deliveries would. */
const grow = async (planks, level) => {
  await p.evaluate((n) => {
    const w = window.woodrail;
    const t = w.world.landscape.towns[0];
    w.economy.delivered.set(t.id, n);
    w.economy.deliveredGoods.set(t.id, { ...(w.economy.deliveredGoods.get(t.id) ?? {}), planks: n });
    w.invalidate();
  }, planks);
  // (The towns are looked at on the next frame drawn.)
  await p.waitForFunction((l) => window.woodrail.progress().bestLevel >= l, level, { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(800);
};
/** Put an offer of these cards on the waiting list (as a town's growth does), and open the sheet from the badge. */
const offer = async (cards) => {
  await p.evaluate((cards) => window.woodrail.progress().offers.push({ from: "Elderwick", level: 2, cards }), cards);
  await p.evaluate(() => window.woodrail.invalidate());
  await p.waitForTimeout(500);
};

// 1. A new game: the line between the first two towns, the school where Show me points, a workshop beside the line.
await p.goto(PAGE);
await p.waitForFunction(() => window.woodrail?.title?.shown, null, { timeout: 240000 });
await p.evaluate(() => [...document.querySelectorAll(".title-card.mode-game button")].find((x) => !x.hidden && x.classList.contains("primary")).click());
await p.waitForFunction(() => window.woodrail?.mode?.() === "game" && !window.woodrail.title.shown && !!document.querySelector("#loading.done"), null, { timeout: 180000 });
await settle();
await p.keyboard.press("Escape");
const placed = await p.evaluate(async () => {
  const { play } = await import("/src/play/player.ts");
  const { schoolOn } = await import("/src/play/rules.ts");
  const { rulesFor } = await import("/src/play/rules.ts");
  const { connectorRef } = await import("/src/track/layout.ts");
  const w = window.woodrail;
  const st = (i) => w.world.stations.get(w.world.landscape.towns[i].id);
  const r = play(w.world.layout, w.editor(), connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w.world), maxPieces: 60, fiddle: 3 });
  const school = schoolOn(w.world, w.editor(), new Set());
  // A workshop by itself near Elderwick's station (its yard takes planks: the planks card fills it).
  const s1 = w.world.layout.getPiece(st(1)).pose;
  w.editor().place("depot-workshop", { x: Math.round(s1.x / 18) * 18, z: Math.round((s1.z + 500) / 18) * 18, heading: 0 }, 0, false);
  w.invalidate();
  return { joined: r.ok, school, workshop: w.economy.allDepots().some((d) => d.role === "workshop") };
});
check("the line laid, the school placed beside a town, a workshop placed", placed.joined && typeof placed.school === "number" && placed.workshop, JSON.stringify(placed));
const learned0 = (await state()).learned;
let s = await sheet();
check("no offer yet: no sheet, no badge", !s.open && !s.badge, JSON.stringify(s));

// 2. Larkfield grows to a village: the present (the school was in it), and the sheet comes up on its own.
const toasts = [];
await p.exposeFunction("sawToast", (t) => toasts.push(t));
await p.evaluate(() => {
  const el = document.querySelector(".toast");
  new MutationObserver(() => window.sawToast(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
});
await grow(4, 1);
await p.waitForTimeout(400); // (the sheet's slide-up)
s = await sheet();
check("a village: the sheet comes up, titled Larkfield grew! Pick one", s.open && s.title === "Larkfield grew! Pick one", JSON.stringify(s.title));
check("…three cards of three kinds", s.cards.length === 3 && new Set(s.cards.map((c) => c.kind)).size === 3, JSON.stringify(s.cards.map((c) => c.kind)));
check(
  "…each large (at least 100×120 px), inside the screen, an icon, an amount and one line",
  s.cards.every((c) => c.box.w >= 100 && c.box.h >= 120 && c.box.l >= 16 && c.box.r <= s.width - 16 && c.box.b <= s.height && c.icon && c.amount && c.line),
  JSON.stringify(s.cards.map((c) => ({ ...c.box, a: c.amount, l: c.line }))),
);
check("…village amounts (8 planks, 30 coins, a crate of 2 things)", s.cards.every((c) => (c.kind === "planks" ? c.amount === "+8 planks" : c.kind === "coins" ? c.amount === "+30 coins" : c.kind === "crate" ? c.amount === "A crate: 2 things" : true)), JSON.stringify(s.cards.map((c) => c.amount)));
check("…and no rare cargo for a village", !s.cards.some((c) => c.kind === "rare"));
const toastSaid = (re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector(".toast").textContent), re.source, { timeout: 25000, polling: 100 }).then(() => true, () => false);
check("the growth toast says to pick a reward", (await toastSaid(/^Larkfield is a village! Pick a reward/)) || toasts.some((t) => /^Larkfield is a village! Pick a reward/.test(t)), JSON.stringify(toasts));
await shot("01-village-sheet");
// Close it (✕): it keeps waiting, with the badge.
await tap(".growth-sheet .close");
s = await sheet();
let st = await state();
check("closed (✕): the offer keeps waiting, a badge says so", !s.open && st.offers === 1 && !!s.badge, JSON.stringify({ badge: s.badge, offers: st.offers }));
const bar = await p.evaluate(() => {
  const r = (el) => {
    const b = el?.getBoundingClientRect();
    return b && b.width > 0 ? { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) } : null;
  };
  return { goals: r(document.querySelector(".goals")), tray: r(document.querySelector(".tray")), badge: r(document.querySelector(".reward-badge")), width: innerWidth };
});
const apart = (a, b) => !a || !b || a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t;
check("…the badge is a finger's size, on screen, clear of the goals and the tray", bar.badge.w >= 44 && bar.badge.r <= bar.width && apart(bar.badge, bar.goals) && apart(bar.badge, bar.tray), JSON.stringify(bar));
await shot("02-closed-badge");
// Reopen from the badge.
await tap(".reward-badge");
s = await sheet();
check("the badge reopens it, as it was", s.open && s.title === "Larkfield grew! Pick one" && s.cards.length === 3 && !s.badge, JSON.stringify(s.title));
// A tap on the shade closes it too; still waiting.
await p.touchscreen.tap(195, 400);
await p.waitForTimeout(400);
s = await sheet();
st = await state();
check("a tap on the shade closes it too, still waiting", !s.open && st.offers === 1 && !!s.badge);
await tap(".reward-badge");

// 3. Take the coins card: one tap, no confirm.
st = await state();
s = await sheet();
const first = s.cards.find((c) => c.kind === "coins") ? "coins" : s.cards.find((c) => !c.held).kind;
await take(first);
let after = await state();
s = await sheet();
check(`one tap takes the ${first} card: the offer's done, the sheet goes`, after.offers === 0 && !s.open && !s.badge, JSON.stringify({ offers: after.offers, open: s.open }));
if (first === "coins") check("…30 coins more", after.coins === st.coins + 30, `${st.coins} → ${after.coins}`);
await shot("03-took-first");

// 4. Research picked (Bridges, at the school): the boost card can come; and every other kind, in turn.
await p.evaluate(async () => {
  const { pick } = await import("/src/game/research.ts");
  pick(window.woodrail.progress(), "bridges");
  window.woodrail.economy.acceptsChanged();
});
const kinds = [
  [{ kind: "planks", n: 16 }, { kind: "coins", n: 80 }, { kind: "crate", things: [["piece:buffer-turnback", 2], ["car:timber", 1]] }],
  [{ kind: "coins", n: 80 }, { kind: "wagon", id: "car:timber" }, { kind: "boost", share: 0.4 }],
];
const taken = {};
for (const [k, cards] of kinds.entries()) {
  for (const card of cards) {
    if (taken[card.kind]) continue;
    await offer(cards);
    await tap(".reward-badge");
    st = await state();
    s = await sheet();
    const c = s.cards.find((x) => x.kind === card.kind);
    await shot(`04-${k}-${card.kind}-offered`);
    await take(card.kind);
    after = await state();
    taken[card.kind] = { before: st, after, card: c };
  }
}
check("planks: 16 into the workshop's yard", taken.planks && taken.planks.after.yard === taken.planks.before.yard + 16 && taken.planks.card.amount === "+16 planks", JSON.stringify(taken.planks && { y0: taken.planks.before.yard, y1: taken.planks.after.yard }));
check("coins: 80 more", taken.coins && taken.coins.after.coins === taken.coins.before.coins + 80);
check(
  "crate: its things into the toy box",
  taken.crate && taken.crate.after.owned["piece:buffer-turnback"] === (taken.crate.before.owned["piece:buffer-turnback"] ?? 0) + 2 && taken.crate.after.owned["car:timber"] === (taken.crate.before.owned["car:timber"] ?? 0) + 1,
);
check("wagon: a flatbed into the toy box", taken.wagon && taken.wagon.after.owned["car:timber"] === (taken.wagon.before.owned["car:timber"] ?? 0) + 1);
check("boost: 40% of Bridges' 10 planks into the research", taken.boost && taken.boost.card.amount === "+4🪵" && taken.boost.after.got.planks === 4 && taken.boost.after.current === "bridges", JSON.stringify(taken.boost && { card: taken.boost.card, got: taken.boost.after.got }));
// Rare cargo: Mills (12 planks, 6 grain; no farm yard to make grain), swapped in for Bridges.
await p.evaluate(async () => {
  const { pick } = await import("/src/game/research.ts");
  const pr = window.woodrail.progress();
  pr.learned.add("farming");
  pr.coins += 100;
  pick(pr, "mills");
  pick(pr, "mills");
  window.woodrail.economy.acceptsChanged();
});
await offer([{ kind: "rare", good: "grain", n: 6 }, { kind: "coins", n: 80 }, { kind: "planks", n: 4 }]);
await tap(".reward-badge");
s = await sheet();
st = await state();
const rare = s.cards.find((c) => c.kind === "rare");
await shot("05-rare-offered");
await take("rare");
after = await state();
check("rare cargo: 6 grain into Mills (it can't be made yet)", st.current === "mills" && rare?.amount === "+6 grain" && after.got.grain === 6, JSON.stringify({ current: st.current, rare, got: after.got }));
check("no blueprint learned by any card (farming set by hand for Mills)", after.learned === [...new Set([...learned0.split(","), "farming"].filter(Boolean))].sort().join(","), `${learned0} → ${after.learned}`);

// 5. Larkfield grows to a town: the sheet again, town amounts; closed, then reopened from the growth toast.
// (First 10 planks, short of a town: the goal "Deliver 10 bundles of planks" ticks now, not with the growth, whose toast
// it would follow and replace before the tap.)
await p.evaluate(() => {
  const w = window.woodrail;
  w.economy.delivered.set(w.world.landscape.towns[0].id, 10);
  w.invalidate();
});
await toastSaid(/Deliver 10 bundles/);
await p.waitForFunction(() => !document.querySelector(".toast").classList.contains("show"), null, { timeout: 30000, polling: 200 }).catch(() => {});
// (The growth toast held up for a minute, not its 4 s: headless, each frame drawn takes long enough that checking the
// sheet and closing it outlasts the toast. What's tested is that a tap on it opens the offer.)
await p.evaluate(() => {
  const hud = window.woodrail.hud;
  const toast = hud.toast.bind(hud);
  hud.toast = (message, celebrate, ms, tap) => toast(message, celebrate, /Pick a reward/.test(message) ? 60000 : ms, tap);
});
toasts.length = 0;
await grow(12, 2);
s = await sheet();
check("a town: the sheet comes up again", s.open && s.title === "Larkfield grew! Pick one" && s.cards.length === 3, JSON.stringify(s.title));
check("…town amounts (16 planks, 80 coins, a crate of 3 things)", s.cards.every((c) => (c.kind === "planks" ? /^\+\d+ planks$/.test(c.amount) : c.kind === "coins" ? c.amount === "+80 coins" : c.kind === "crate" ? c.amount === "A crate: 3 things" : true)), JSON.stringify(s.cards.map((c) => c.amount)));
await shot("06-town-sheet");
await tap(".growth-sheet .close");
const sawTownToast = (await toastSaid(/^Larkfield is a town! Pick a reward/)) || toasts.some((t) => /^Larkfield is a town! Pick a reward/.test(t));
check("the toast: Larkfield is a town! Pick a reward", sawTownToast, JSON.stringify(toasts));
const toastUp = await p.evaluate(() => document.querySelector(".toast").classList.contains("show") && /Pick a reward/.test(document.querySelector(".toast").textContent));
if (toastUp) {
  await tap(".toast");
  s = await sheet();
  check("a tap on the growth toast reopens the offer", s.open && s.title === "Larkfield grew! Pick one", JSON.stringify({ title: s.title, open: s.open }));
} else check("the growth toast up to tap", false, JSON.stringify({ toasts, now: await p.evaluate(() => document.querySelector(".toast").textContent) }));
await shot("07-town-sheet-reopened-from-toast");

// 6. Idle: no frames drawn while the sheet's open, nor while the badge waits.
const idle = async () =>
  p.evaluate(async () => {
    const w = window.woodrail;
    for (const id of w.sim.trainIds()) w.sim.removeTrain(id);
    w.invalidate();
    await Promise.race([w.settled(10), new Promise((r) => setTimeout(r, 60000))]);
    const f0 = w.framesDrawn;
    await new Promise((r) => setTimeout(r, 20000));
    return w.framesDrawn - f0;
  });
check("idle with the sheet open: no frames in 20 s", (await idle()) === 0);
await tap(".growth-sheet .close");
await p.waitForTimeout(6000); // (the badge's few bobs are over)
check("idle with the badge waiting: no frames in 20 s", (await idle()) === 0);
await shot("08-idle-badge");

check("no page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
await b.close();
await server.close();
process.exit(failures === 0 ? 0 : 1);
