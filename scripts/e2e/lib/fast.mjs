// Making an e2e suite cheaper to run without changing what it checks. See docs/agents/e2e.md, "Speed".
//
// testClockIn(browser): every page the browser opens from now on runs the game's test clock (`window.__e2eClock`,
//   src/game/game.ts `e2eMaxDt`): a frame's step may be up to `maxDt` s instead of 0.1 s. Under SwiftShader a frame
//   takes about a second, so the sim and every animation (a flourish, a laid line settling, a train's run) went at a
//   tenth of real time or less (the sim at most 8 ticks of 1/120 s a frame: 1/15). With it they keep up with real time:
//   the same fixed sim ticks, more of them a frame. Load-sensitive waits then wait on game time, not on frames.
//
// batterySaverIn(browser): a desktop page draws as the game's "Battery saver" (☰, the mobile tier: no ambient
//   occlusion or depth of field). The high tier's two effects cost a desktop page several seconds a frame on SwiftShader
//   (a mouse move waits for a frame). For suites whose checks don't look at pixels.

/** Apply `script` (with `arg`) to every context and page `browser` opens from now on, before anything loads. */
function everyPage(browser, script, arg) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    await ctx.addInitScript(script, arg);
    return ctx;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => {
    const page = await newPage(...a);
    await page.addInitScript(script, arg);
    return page;
  };
  return browser;
}

/** The game's test clock in every page `browser` opens (see above). `E2E_CLOCK=0` turns it off (as before). */
export function testClockIn(browser, { maxDt = 1 } = {}) {
  if (process.env.E2E_CLOCK === "0") return browser;
  return everyPage(browser, (maxDt) => {
    window.__e2eClock = { maxDt };
  }, maxDt);
}

/** "Battery saver" (the mobile tier) in every page `browser` opens, unless the page's storage already chose one. */
export function batterySaverIn(browser) {
  if (process.env.E2E_SAVER === "0") return browser;
  return everyPage(browser, () => {
    try {
      if (!localStorage.getItem("woodrail.quality")) localStorage.setItem("woodrail.quality", "mobile");
    } catch {
      /* no storage (about:blank) */
    }
  });
}

// Moves a few to a frame. A pointer move waits for a frame (the browser hands moves to the page once a frame), and under
// SwiftShader a frame is a second or two: a stroke of 60 moves took a minute or two. On a phone the screen samples a
// finger at 120 Hz and the game draws at 30 frames a second, so a frame's event carries about four moves, the rest in
// `getCoalescedEvents()`; the game takes every one of them in order (a drawn line, a drag: see `coalesced` in
// src/game/interaction.ts). So these send `MOVES_PER_FRAME` moves at once and wait for them together: the same points,
// in the same order, a quarter of the frames. E2E_MOVES_PER_FRAME=1: one move a frame, as before.
export const MOVES_PER_FRAME = Math.max(1, Number(process.env.E2E_MOVES_PER_FRAME ?? 4));

/** Send `send(point, i)` for every point, `MOVES_PER_FRAME` at a time (each batch's sends together, awaited together). */
async function inBatches(points, send) {
  for (let i = 0; i < points.length; i += MOVES_PER_FRAME) await Promise.all(points.slice(i, i + MOVES_PER_FRAME).map((pt, k) => send(pt, i + k)));
}

/**
 * Touch moves of finger `id` through `points` ([x, y]), `MOVES_PER_FRAME` to a frame, over a CDP session (`cdp`).
 * `timestamp(i)`: the i-th move's time (s), for a stroke that paces its moves; `touchPoints(x, y)`: the event's points
 * (default one finger, `id`, at x, y).
 */
export function touchMoves(cdp, points, { id = 1, timestamp, touchPoints = (x, y) => [{ x, y, id }] } = {}) {
  return inBatches(points, ([x, y], i) => cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPoints(x, y), ...(timestamp ? { timestamp: timestamp(i) } : {}) }));
}

const sessions = new WeakMap();
/** The page's own CDP session (one, kept). */
function cdpOf(page) {
  if (!sessions.has(page)) sessions.set(page, page.context().newCDPSession(page));
  return sessions.get(page);
}

/**
 * Mouse moves through `points` ([x, y]), `MOVES_PER_FRAME` to a frame, with the left button held if `held` (after
 * `page.mouse.down()`). The last point is Playwright's own move, so it knows where the mouse is (it releases there).
 */
export async function mouseMoves(page, points, { held = true } = {}) {
  if (!points.length) return;
  if (MOVES_PER_FRAME === 1) {
    for (const [x, y] of points) await page.mouse.move(x, y);
    return;
  }
  // (All but the last over CDP, a batch a frame; the last by Playwright's own mouse, which then knows where it is.)
  const cdp = await cdpOf(page);
  await inBatches(points.slice(0, -1), ([x, y]) => cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: held ? "left" : "none", buttons: held ? 1 : 0 }));
  const [x, y] = points.at(-1);
  await page.mouse.move(x, y);
}

/** The points of a straight run from a to b in `n` steps (a left out, b in). */
export const steps = ([ax, ay], [bx, by], n) => Array.from({ length: n }, (_, k) => [ax + ((bx - ax) * (k + 1)) / n, ay + ((by - ay) * (k + 1)) / n]);

/**
 * Run move-sending thunks `MOVES_PER_FRAME` at a time: each batch's started together (in order: a thunk that stamps its
 * event's time stamps it in order) and awaited together. For a suite's own `touch(type, x, y, t)` helpers:
 *   await inFrames(Array.from({ length: 12 }, (_, k) => () => touch("touchMove", x + k, y)));
 */
export async function inFrames(thunks) {
  for (let i = 0; i < thunks.length; i += MOVES_PER_FRAME) await Promise.all(thunks.slice(i, i + MOVES_PER_FRAME).map((f) => f()));
}
