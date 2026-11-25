// Every toast the page shows, kept as it shows (`toastLogIn(ctx)`), so a suite checks what was said, not what happens
// to be up when it looks. A toast is up for a few seconds of wall-clock time (`toastMs`, src/ui/hud.ts), while a page
// under SwiftShader takes a second or more a frame, and longer on a loaded box: a wait that saw it and the read after
// can straddle its going, and a slow poll can miss one altogether (2026-11-25: e2e:train-off-line's "is off Red line"
// read as the toast after it; e2e:situation-help's tip toast missed). The log is filled by a MutationObserver on the
// toast's class and text: each showing is one entry, in order, with `also` (`what` evaluated in the page) seen while it
// was up, as the goals chip beside it.

/**
 * In every page of `ctx`, from now on: `window.__toasts`, the toasts shown, oldest first: `{ text, at, also }`, `at`
 * the page's performance.now when it showed, `also` every distinct value of `alsoFn()` (a string) seen while it was up.
 */
export async function toastLogIn(ctx, alsoFn = () => "") {
  await ctx.addInitScript((alsoSrc) => {
    // (From the suite's own source: e2e code, not a page's.)
    const also = new Function(`return (${alsoSrc})();`);
    const log = (window.__toasts = []);
    let up = null;
    const look = () => {
      const t = document.querySelector(".toast");
      const text = t?.classList.contains("show") ? (t.textContent ?? "") : null;
      if (text === null) {
        up = null;
        return;
      }
      if (!up || up.text !== text) {
        up = { text, at: Math.round(performance.now()), also: [] };
        log.push(up);
      }
      let a = "";
      try {
        a = String(also() ?? "");
      } catch {
        /* the page isn't ready for it yet */
      }
      if (a && !up.also.includes(a)) up.also.push(a);
    };
    const watch = () => new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    if (document.documentElement) watch();
    else document.addEventListener("DOMContentLoaded", watch, { once: true });
  }, alsoFn.toString());
}

/**
 * Wait (up to `ms`) for a toast shown from entry `from` on whose text matches `re` (a RegExp, or a string it includes);
 * the entry, or null. `from`: `await toastMark(p)` taken before the action, so an older toast with the same words
 * doesn't count.
 */
export async function shownToast(p, re, { from = 0, ms = 20000 } = {}) {
  const src = re instanceof RegExp ? { source: re.source, flags: re.flags } : { text: re };
  const handle = await p
    .waitForFunction(
      ({ src, from }) => {
        const test = src.text !== undefined ? (s) => s.includes(src.text) : ((r) => (s) => r.test(s))(new RegExp(src.source, src.flags));
        return (window.__toasts ?? []).slice(from).find((t) => test(t.text)) ?? false;
      },
      { src, from },
      { timeout: ms, polling: 250 },
    )
    .catch(() => null);
  return handle ? handle.jsonValue() : null;
}

/** How many toasts have shown so far (for `shownToast`'s `from`). */
export const toastMark = (p) => p.evaluate(() => (window.__toasts ?? []).length);

/** The toasts shown from entry `from` on, joined (a failure's detail). */
export const toastsSince = (p, from = 0) => p.evaluate((from) => (window.__toasts ?? []).slice(from).map((t) => t.text).join(" | "), from);
