// Open a tray shelf by its name, as a player does: Back out of whichever shelf is open (one a group before left open),
// then a tap on the named shelf's button (`data-shelf`, src/ui/hud.ts). By name, never by its place in the row: the row
// changes with favourites, research and the tab.

/** Open the shelf named `name` on the tray's current tab with `tap(selector)`; already open, nothing. Throws if it isn't there. */
export async function openShelf(p, tap, name) {
  const open = () => p.evaluate(() => document.querySelector(".tray")?.dataset.shelf ?? null);
  if ((await open()) === name) return;
  if (await p.evaluate(() => !!document.querySelector(".scroller .tray-back"))) {
    await tap(".scroller .tray-back");
    await p.waitForFunction(() => document.querySelector(".scroller .tray-group") !== null, null, { timeout: 10000 });
  }
  const sel = `.scroller .tray-group[data-shelf="${name}"]`;
  if (!(await p.$(sel))) {
    const shelves = await p.evaluate(() => [...document.querySelectorAll(".scroller .tray-group")].map((b) => b.dataset.shelf));
    throw new Error(`no ${name} shelf (shelves: ${shelves.join(", ") || "none"})`);
  }
  await tap(sel);
  await p.waitForFunction((n) => document.querySelector(".tray")?.dataset.shelf === n, name, { timeout: 10000 });
}
