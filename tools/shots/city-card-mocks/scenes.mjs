// The scenes stage.mjs shoots: today's card and Journal flow, then the mocks (mocks.mjs).
import { closeAll, clearToasts, lookTown, openTownCard, scrollCard, openJournalAch } from "./helpers.mjs";
import mocks from "./mocks.mjs";

const today = (size) => [
  { name: `today-${size}-1-top`, size, async run(p, s) { await closeAll(p); await lookTown(p, s.town); await openTownCard(p, s.town); await clearToasts(p); await scrollCard(p, 0); } },
  { name: `today-${size}-2-middle`, size, async run(p) { await scrollCard(p, ".places-sec"); } },
  { name: `today-${size}-3-grand`, size, async run(p) { await scrollCard(p, ".grand-sec"); } },
  { name: `today-${size}-4-journal`, size, async run(p) { await closeAll(p); await openJournalAch(p); await clearToasts(p); } },
  {
    name: `today-${size}-5-after-show-me`,
    size,
    async run(p) {
      await p.evaluate(() => document.querySelector(".ach-show")?.click());
      await p.waitForTimeout(2500);
      await p.waitForFunction(() => !window.woodrail.director.busy, null, { timeout: 15000 }).catch(() => {});
      await clearToasts(p);
    },
  },
];

export default [...today("phone"), ...today("desktop"), ...mocks];
