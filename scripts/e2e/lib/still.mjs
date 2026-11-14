// Wait till an element stands still before a tap measures it: its own and its ancestors' CSS animations finished, and
// its box the same on two reads running. Headless under SwiftShader a slow WebGL frame can hold an animation on its
// first frame for a second or more (CSS animations only move on frames drawn), so a box read at once is where the
// element starts, not where the finger will find it: the ☰ menu's pop-in once put new-game's tap on the item above.

/** Wait for the first visible element matching `selector` (its text including `text`, if given) to stand still.
 * Resolves true once it does, false if there's no such element or it's still moving after `timeout` ms. */
export function still(page, selector, text, timeout = 30000) {
  return page.evaluate(
    async ({ selector, text, timeout }) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && !e.closest("[hidden]") && (!text || e.textContent.includes(text)));
      if (!el) return false;
      const moving = () => {
        for (let e = el; e; e = e.parentElement) if (e.getAnimations().some((a) => a.pending || a.playState === "running")) return true;
        return false;
      };
      const box = () => {
        const r = el.getBoundingClientRect();
        return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
      };
      // (A frame, or 100 ms if frames are held up.)
      const next = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 100); });
      const end = performance.now() + timeout;
      let last = null;
      while (performance.now() < end) {
        if (!el.isConnected) return false;
        const b = moving() ? null : box();
        if (b !== null && b === last) return true;
        last = b;
        await next();
      }
      return false;
    },
    { selector, text, timeout },
  );
}
