// Hardening pictures for the lines UI as built (SCENES=harden.mjs): long names, many stops, many trains, an open stop
// with the added note, at a phone, a narrow phone, a phone on its side and a desktop. State is written by the game's
// own line functions (a harness shortcut for pictures: what's looked at is the UI drawn for it).
import { tapSel, clearToasts, look } from "./scenes.mjs";

const ALL = ["phone", "narrow", "side", "desktop"];
async function reset(p) {
  await p.evaluate(() => {
    if (!document.querySelector(".line-sheet").hidden) document.querySelector(".ls-done")?.click();
  });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(400);
}
async function sheetFor(p, s) {
  await reset(p);
  await look(p, s);
  await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), s.engines[0]);
  await p.waitForTimeout(1800);
  await tapSel(p, ".engine-extra .route-plan");
  await p.waitForSelector(".line-sheet:not([hidden])", { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await clearToasts(p);
}
export default [
  {
    name: "h-1-long-names",
    size: ALL,
    async run(p, s) {
      await p.evaluate(async (s) => {
        const { renameLine } = await import("/src/game/lines.ts");
        renameLine(window.woodrail.economy, s.red, "Thimble Cross Timber Run");
        // (Five trains on the line: more put on the oval and joined to it.)
        const { joinLine } = await import("/src/game/lines.ts");
        const w = window.woodrail;
        const pieces = [...w.layout.pieceIds()].slice(-14);
        for (const k of [1, 6, 10]) {
          const r = w.sim.addTrain(["engine", "timber"], { pieceId: pieces[k], pathIndex: 0, s: 60, reversed: false });
          if (r.kind === "placed") joinLine(w.economy, w.sim.getTrain(r.trainId).cars[0].id, s.red);
        }
        w.invalidate();
      }, s);
      await sheetFor(p, s);
    },
  },
  {
    name: "h-2-open-stop",
    size: ALL,
    async run(p) {
      await tapSel(p, ".ls-stop[data-stop='2'] .ls-stop-main");
      await p.waitForTimeout(700);
    },
  },
  {
    name: "h-3-many-stops",
    size: ALL,
    async run(p, s) {
      await reset(p);
      await p.evaluate(async (s) => {
        const { editLineById } = await import("/src/game/lines.ts");
        const w = window.woodrail;
        const [A, B, D, C] = s.places;
        editLineById(w.economy, s.red, (l) => l.splice(0, l.length, ...[A, B, D, C, A, B, D, C].map((depotId) => ({ depotId, action: "auto" }))));
        w.invalidate();
      }, s);
      await look(p, s);
      await p.evaluate((e) => window.woodrail.interaction.openEngineCard(e), s.engines[0]);
      await p.waitForTimeout(1500);
      await clearToasts(p);
    },
  },
  {
    name: "h-4-many-stops-sheet",
    size: ALL,
    async run(p) {
      await tapSel(p, ".engine-extra .route-plan");
      await p.waitForTimeout(1500);
      await clearToasts(p);
    },
  },
];
