// Pictures for the e2e suites: never a check, so never a hang or a failure.
//
//   import { shot, quiet } from "../../scripts/e2e/lib/shot.mjs";   // (from scripts/e2e: "./lib/shot.mjs")
//   await quiet(page);                              // the page's start-up work done (bounded), before a picture of it
//   await shot(page, `${OUT}/1-copied.png`);        // a picture, or a line saying why there's none
//
// Why: `page.screenshot` waits for a new frame from the page. A page that has only just loaded (a fresh browser
// context, nothing kept) is still drawing its tray pictures, a few a frame, each read back from the graphics card; with
// SwiftShader on a loaded machine a frame then takes seconds (a 6 s gap measured under a CPU hog), and the screenshot
// waited 23–30 s, past Playwright's 30 s default on a slower box, after every check had passed. Waited for first
// (`quiet`), the same screenshot took under a second. A picture that still can't be taken is said and skipped.

/**
 * The page's start-up work done: its tray pictures drawn and saved (`trayThumbnailsSaved`), then the scene still
 * (`settled`). Bounded (`ms`, default 2 min): a page that never settles (a train running in view) is pictured anyway.
 */
export async function quiet(p, ms = 120_000) {
  await p
    .evaluate(
      (ms) =>
        Promise.race([
          Promise.resolve(window.woodrail?.trayThumbnailsSaved?.())
            .catch(() => {})
            .then(() => window.woodrail?.settled?.()),
          new Promise((r) => setTimeout(r, ms)),
        ]),
      ms,
    )
    .catch(() => {});
}

/**
 * A screenshot to `path`, with a timeout (default 2 min) and no throw: one that fails says so in a line ("no picture
 * …") and the suite carries on. Other options go to `page.screenshot` (type, quality, fullPage, …).
 */
export async function shot(p, path, { timeout = 120_000, ...opts } = {}) {
  let timer;
  try {
    // (And a bound of our own past Playwright's: a capture the browser never answers can't hold the suite up.)
    const late = new Promise((_, no) => (timer = setTimeout(() => no(new Error(`no answer in ${timeout / 1000 + 10} s`)), timeout + 10_000)));
    await Promise.race([p.screenshot({ path, timeout, ...opts }), late]);
    return true;
  } catch (e) {
    console.log(`(no picture ${path}: ${String(e?.message ?? e).split("\n")[0]})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
