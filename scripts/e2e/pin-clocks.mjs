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
