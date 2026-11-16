// Points dragged from the tray's Switch shelf onto a line by touch (2026-11-16: a split or a switch held over a line's
// straights takes their place, as a depot does): the shelf opened by a tap, the tile taken by a finger, carried over
// the map to where the points should go, turned (R) and flipped (F) as held till they lie as wanted, the finger
// steered till the held piece is spliced there, and let go. Shared by e2e:depot-tracks and e2e:touch (track-pieces).

/**
 * `p` the page, `cdp` a CDP session on it (touch events), `screen(x, y, z)` a world point's place on screen.
 * `want`: where the points should go when spliced: `{ type, pose: { x, z, heading }, flipped }` (the game's own pose
 * of them there). Returns `{ id, cost, why }`: the piece laid (−1 if none), the median cost of a pointer move while
 * held over the line (ms, `Interaction.updateDrag`), and what went wrong.
 */
export async function dragPointsOnto(p, cdp, screen, want) {
  const frames = () => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const touch = (type, x, y, t) => cdp.send("Input.dispatchTouchEvent", { type, timestamp: t, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const key = `piece:${want.type}`;
  // The Switch shelf, by a tap (back to the shelves first).
  if (await p.evaluate(() => document.querySelector(".tray")?.classList.contains("in-group"))) {
    const back = await p.evaluate(() => {
      const r = document.querySelector(".scroller .tray-back")?.getBoundingClientRect();
      return r ? [r.x + r.width / 2, r.y + r.height / 2] : null;
    });
    if (back) await p.touchscreen.tap(back[0], back[1]);
    await frames();
  }
  const shelf = await p.evaluate(() => {
    const g = [...document.querySelectorAll(".scroller .tray-group")].find((b) => b.querySelector(".label")?.textContent === "Switch");
    if (!g) return null;
    g.scrollIntoView({ inline: "center", block: "nearest" });
    const r = g.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });
  if (!shelf) return { id: -1, cost: NaN, why: "no Switch shelf" };
  await p.waitForTimeout(250);
  await p.touchscreen.tap(shelf[0], shelf[1]);
  await frames();
  await p.waitForTimeout(250);
  const tile = await p.evaluate((key) => {
    const e = document.querySelector(`.scroller .tray-item[data-key="${key}"]`);
    if (!e || e.classList.contains("locked")) return null;
    e.scrollIntoView({ inline: "center", block: "nearest" });
    const r = e.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  }, key);
  if (!tile) return { id: -1, cost: NaN, why: `no ${key} on the Switch shelf (or locked)` };
  await p.waitForTimeout(250);
  const before = await p.evaluate(() => [...window.woodrail.layout.pieceIds()]);
  // Its middle where it should go: along its straight-on leg, halfway.
  const len = want.type === "switch" ? 144 : 216;
  const mid = { x: want.pose.x + (Math.cos(want.pose.heading) * len) / 2, z: want.pose.z + (Math.sin(want.pose.heading) * len) / 2 };
  const [mx, my] = await screen(mid.x, 0, mid.z);
  // (On touch a held piece rides above the finger: the finger goes that far below.)
  let at = [mx, my + 56];
  let t = Date.now() / 1000;
  await touch("touchStart", tile[0], tile[1], t);
  await touch("touchMove", tile[0], tile[1] - 30, (t += 0.04));
  for (let k = 1; k <= 10; k++) await touch("touchMove", tile[0] + ((at[0] - tile[0]) * k) / 10, tile[1] - 30 + ((at[1] - tile[1] + 30) * k) / 10, (t += 0.02));
  await frames();
  const held = () =>
    p.evaluate(() => {
      const m = window.woodrail.interaction.mode;
      if (m?.kind !== "drag-piece") return null;
      const s = m.snap?.kind === "snapped" ? m.snap.pose : null;
      return { heading: m.heading, flipped: m.heldFlipped, covers: m.covers ? [...m.covers] : null, blocked: m.blocked ?? null, snap: s && { x: s.x, z: s.z, heading: s.heading }, loose: m.pose && { x: m.pose.x, z: m.pose.z } };
    });
  const turn = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  // Flipped and turned as wanted (within a quarter turn: the splice lies it along the line the nearer way round).
  let h = await held();
  if (!h) return { id: -1, cost: NaN, why: "not held" };
  if (h.flipped !== want.flipped) {
    await p.keyboard.press("f");
    await frames();
  }
  for (let k = 0; k < 8; k++) {
    h = await held();
    if (!h || turn(h.heading - want.pose.heading) < Math.PI / 2 - 0.2) break;
    await p.keyboard.press("r");
    await frames();
  }
  // Steered till it's spliced where wanted.
  const there = (s) => s && Math.hypot(s.x - want.pose.x, s.z - want.pose.z) < 2 && turn(s.heading - want.pose.heading) < 0.02;
  for (let k = 0; k < 12; k++) {
    await touch("touchMove", at[0], at[1], Math.max(Date.now() / 1000, (t += 0.02)));
    await frames();
    h = await held();
    if (!h) break;
    if (h.covers && !h.blocked && there(h.snap)) break;
    // (Where it's drawn now, against where it should be: the finger moved by the difference.)
    const now = h.snap ?? h.loose;
    if (!now) break;
    const [sx, sy] = await screen(now.x, 0, now.z);
    const [tx, ty] = await screen(want.pose.x, 0, want.pose.z);
    at = [at[0] + (tx - sx) * 0.8 + (k % 2 ? 3 : -3), at[1] + (ty - sy) * 0.8];
  }
  h = await held();
  const spliced = !!h && !!h.covers && !h.blocked && there(h.snap);
  // The pointer move's cost while held over the line (the game's own handler, a few moves about where it is).
  const cost = await p.evaluate(([x, y]) => {
    const i = window.woodrail.interaction;
    const times = [];
    for (let k = 0; k < 20; k++) {
      const t0 = performance.now();
      i.updateDrag(x + (k % 3) - 1, y + (k % 2));
      times.push(performance.now() - t0);
    }
    i.updateDrag(x, y);
    times.sort((a, b) => a - b);
    return times[10];
  }, at);
  await touch("touchEnd", at[0], at[1], Math.max(Date.now() / 1000, t + 0.05));
  await frames();
  await p.waitForTimeout(500);
  const id = await p.evaluate(([before, type]) => [...window.woodrail.layout.pieceIds()].find((i) => !before.includes(i) && window.woodrail.layout.getPiece(i).type === type) ?? -1, [before, want.type]);
  return { id, cost, why: spliced ? null : `not spliced where wanted: ${JSON.stringify(h)}` };
}
