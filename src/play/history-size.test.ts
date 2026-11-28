import { describe, expect, it } from "vitest";
import { readMapText } from "../persist/bug-map";
import { PROGRESS_KEYS, serializeWorld } from "../persist/save";
import { SIM_HZ, SIM_DT } from "../sim";
import { attachPassengers, peopleArrive } from "../game/passengers";
import { Progress } from "../game/progress";
import { payDelivery } from "../game/rewards";
import { TownLife, type TownLifeHost } from "../game/town-life";
import { HaulLog } from "../economy/history";
import { loadBugMap } from "./bugmap";

/**
 * The delivery history's cost in a save (spec docs/superpowers/specs/2026-11-28-delivery-history.md, "Saved"), on the
 * user's map: played on as saved for `HISTORY_MINUTES` (default 60) with Game mode's towns and fares wired as main wires
 * them (the town's coins shared to the drops they're for, as main does), then the save's size with and without it, and
 * the coins the logs hold against the coins earned.
 *
 *   HISTORY_SIZE=1 npx vitest run --silent=false src/play/history-size.test.ts
 */
const RUN = !!process.env.HISTORY_SIZE;
const MINUTES = Number(process.env.HISTORY_MINUTES ?? 60);
const MAP = import.meta.glob("./bugmaps/reports/2026-11-27-warehouse2-full-muffin.txt", { query: "?raw", import: "default", eager: true });

describe.skipIf(!RUN)("the delivery history in a save", () => {
  it(`the user's map, ${MINUTES} min`, async () => {
    const text = Object.values(MAP)[0] as string;
    const copy = (await readMapText(text))!;
    const p = Progress.fromJSON(JSON.parse(copy.keys[PROGRESS_KEYS.progress]!));
    const { world: w } = await loadBugMap(text);
    let ticks = 0;
    w.economy.history.clock = () => ticks * SIM_DT;
    let earned = 0;
    const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
    const life = new TownLife(host, {
      grew: () => {},
      received: (town, kind, k, before) => {
        const paid = payDelivery(p, kind, k, before, town);
        earned += paid;
        w.economy.history.paid(town.id, kind, k, paid);
      },
    });
    life.reset();
    attachPassengers(w, () => p, (fare) => (earned += fare));
    const people = new Map<number, number>();
    const before = JSON.stringify(serializeWorld(w)).length;
    for (let s = 0; s < MINUTES * 60; s++) {
      for (let t = 0; t < SIM_HZ; t++) {
        w.sim.tick();
        w.economy.tick();
        ticks++;
      }
      life.update();
      peopleArrive(w, p, 1, people);
    }
    const data = serializeWorld(w);
    const all = JSON.stringify(data).length;
    let logs = 0;
    for (const t of data.trains) for (const c of t.cars) logs += (c.history ? JSON.stringify(c.history).length + 12 : 0) + (c.since ? JSON.stringify(c.since).length + 9 : 0);
    let visits = 0;
    let logged = 0;
    for (const log of w.economy.history.trains.values()) {
      visits += log.ring.length;
      logged += HaulLog.summary(log, 0).coins;
    }
    const full = [...w.economy.history.trains.values()].filter((l) => l.ring.length >= 50).length;
    console.log(
      `HISTORY_SIZE trains ${w.sim.trainIds().length} logs ${w.economy.history.trains.size} (${full} full) visits ${visits} | save ${before} → ${all} chars, history ${logs} (${((100 * logs) / all).toFixed(1)}%) | coins earned ${earned}, in the logs ${logged}`,
    );
    expect(logs).toBeGreaterThan(0);
  }, 1_800_000);
});
