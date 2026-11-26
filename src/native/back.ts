// Android's Back (the button or the edge swipe) in the app: it puts away the topmost thing, as Esc does on a keyboard
// (the ☰ menu, a card, a sheet, the map). With nothing to put away it sends the app to the background, like Home; the
// game saves as it goes (visibilitychange). Never a page back, which would leave the game.
import { App } from "@capacitor/app";

/**
 * Where a keyboard's Esc would land: the focused element, else the open dialog the sheets listen on (the new-game
 * screen, Your games, an explainer: each takes its keys on its own root, and with nothing focused a key goes to the
 * body, past them). The last open one in the page is taken as the topmost.
 */
function escTarget(doc: Document): Element {
  const focused = doc.activeElement;
  if (focused && focused !== doc.body && focused !== doc.documentElement) return focused;
  const open = [...doc.querySelectorAll('[role="dialog"], [aria-modal="true"]')].filter((d) => d.getClientRects().length > 0);
  return open.at(-1) ?? doc.body;
}

/** Press Esc; did anything on the page change? (Every Esc handler hides or removes something, at once.) */
export function escapeChangedSomething(doc: Document = document): boolean {
  const seen = new MutationObserver(() => {});
  seen.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true });
  const target = escTarget(doc);
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  target.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  const changed = changedFor(seen.takeRecords());
  seen.disconnect();
  return changed;
}

/**
 * Did these mutations leave the page different? An Esc with nothing to put away still sets things as they were (a
 * card already hidden hidden again, a class added and taken off): an attribute counts only if it ends unlike it began.
 */
export function changedFor(records: readonly MutationRecord[]): boolean {
  const before = new Map<Node, Map<string, string | null>>();
  for (const r of records) {
    if (r.type === "childList" && (r.addedNodes.length > 0 || r.removedNodes.length > 0)) return true;
    if (r.type !== "attributes" || !r.attributeName) continue;
    const attrs = before.get(r.target) ?? new Map<string, string | null>();
    before.set(r.target, attrs);
    if (!attrs.has(r.attributeName)) attrs.set(r.attributeName, r.oldValue);
  }
  for (const [node, attrs] of before) for (const [name, old] of attrs) if ((node as Element).getAttribute(name) !== old) return true;
  return false;
}

export function installBackButton(): void {
  void App.addListener("backButton", () => {
    if (!escapeChangedSomething()) void App.minimizeApp();
  });
}
