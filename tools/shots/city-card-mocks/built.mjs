// The town card as built (direction B): the pictures in docs/agents/shots/city-card-built-*.jpg. SCENES=built.mjs.
import { closeAll, clearToasts, lookTown, openTownCard, openJournalAch } from "./helpers.mjs";

const tab = (p, t) => p.evaluate((t) => document.querySelector(`.town-tab[data-tab="${t}"]`)?.click(), t);
const scenes = (size) => [
  { name: `city-card-built-${size}-1-opens`, size, async run(p, s) { await closeAll(p); await lookTown(p, s.town); await openTownCard(p, s.town); await clearToasts(p); } },
  { name: `city-card-built-${size}-2-grow`, size, async run(p) { await tab(p, "grow"); } },
  { name: `city-card-built-${size}-3-build`, size, async run(p) { await tab(p, "build"); } },
  { name: `city-card-built-${size}-4-station`, size, async run(p) { await tab(p, "station"); } },
  { name: `city-card-built-${size}-5-journal`, size, async run(p) { await closeAll(p); await openJournalAch(p); await clearToasts(p); } },
  {
    name: `city-card-built-${size}-6-landed`,
    size,
    async run(p) {
      await p.evaluate(() => document.querySelector(".ach-item.open .ach-city")?.click());
      await p.waitForTimeout(2500);
      await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
      await clearToasts(p);
    },
  },
];
export default [...scenes("phone"), ...scenes("side").slice(0, 4), ...scenes("desktop")];
