/**
 * Hold every clock's hands still in an e2e that counts idle frames. ClockView draws a frame at the start of each
 * minute when a clock is in view (as it should), and a "no frames once it's settled" check could catch it. Pinned,
 * the hands are set once to the time the game started and never move: no timer, no visibilitychange
 * (`ClockView.start`'s test hook, `window.__woodrailPinClocks`). e2e:station-clock doesn't use this: it tests the real
 * tick.
 */
const SCRIPT = () => {
  window.__woodrailPinClocks = true;
};

/** Pin the clocks in a Playwright page or browser context, before its page is loaded. */
export function pinClocks(target) {
  return target.addInitScript(SCRIPT);
}

/** Pin the clocks in every page and context `browser` opens from now on (one line after launch covers them all). */
export function pinClocksIn(browser) {
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    await pinClocks(ctx);
    return ctx;
  };
  // (`browser.newPage` opens its own context; its page is pinned before anything loads in it.)
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => {
    const page = await newPage(...a);
    await pinClocks(page);
    return page;
  };
  return browser;
}

/**
 * Hold the industries' little movers still (the axe, the saw, sails, wheels, motes: as `prefers-reduced-motion` does,
 * `DepotView.calm`) in every page and context `browser` opens from now on. For an e2e that waits for `settled()` and
 * doesn't test them: Sandbox's own forest works from the start, and under software GL (a frame a second, 0.1 s of sim
 * each) its yard takes hours to fill, its axe drawing every frame while it's in view, so each `settled()` with the
 * forest in view ran out its 60 s (e2e:touch took 25 min for its first 31 checks instead of 6, depending on where the
 * view happened to be). Goods are still made and carried; only the decoration stands still. e2e:life tests the motion.
 */
export function stillIndustriesIn(browser) {
  const script = () => {
    window.__woodrailStillIndustries = true;
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...a) => {
    const ctx = await newContext(...a);
    await ctx.addInitScript(script);
    return ctx;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => {
    const page = await newPage(...a);
    await page.addInitScript(script);
    return page;
  };
  return browser;
}
