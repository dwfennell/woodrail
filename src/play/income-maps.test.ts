import { describe, expect, it } from "vitest";
import { readMapText } from "../persist/bug-map";
import { PROGRESS_KEYS } from "../persist/save";
import { SIM_HZ } from "../sim";
import { HarbourTrade } from "../game/harbours";
import { attachPassengers, peopleArrive } from "../game/passengers";
import { Progress } from "../game/progress";
import { payDelivery } from "../game/rewards";
import { TownLife, type TownLifeHost } from "../game/town-life";
import { STAPLES } from "../game/towns";
import { loadBugMap } from "./bugmap";

/**
 * Where players' late-game coins come from (spec docs/superpowers/specs/2026-11-27-towns-buy-what-they-need.md,
 * "Balance"): every Game-mode map in the repo (the reference maps, the report maps) played on as saved for
 * `INCOME_MINUTES` (default 60) with Game mode's towns, fares and harbours wired as main wires them, its coins
 * earned counted by source: town sales of goods it needs to grow, of the staples (by kind), fares and boats. The balance
 * play-through never builds the staple chains, so this is the measure of what they make.
 *
 *   INCOME_MAPS=1 npx vitest run --silent=false src/play/income-maps.test.ts      (prints one INCOME_MAP line a map)
 *
 * What it leaves out, as the replay does: the player (no taps: lines run as saved, nothing new built, no research).
 */
const RUN = !!process.env.INCOME_MAPS;
const MINUTES = Number(process.env.INCOME_MINUTES ?? 60);

const MAPS: Record<string, string> = {
  ...import.meta.glob("./bugmaps/reference/*.txt", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("./bugmaps/reports/*.txt", { query: "?raw", import: "default", eager: true }),
};

describe.skipIf(!RUN)("players' maps: income by source", () => {
  it(`each Game map, ${MINUTES} min`, async () => {
    let n = 0;
    // (`INCOME_SHARD=i/n`: every n-th map from the i-th, so n runs share the maps over the cores.)
    const [shard, shards] = (process.env.INCOME_SHARD ?? "0/1").split("/").map(Number);
    for (const [k, [file, text]] of Object.entries(MAPS).entries()) {
      if (k % shards !== shard) continue;
      const copy = await readMapText(text);
      if (!copy || copy.mode !== "game") continue;
      const raw = copy.keys[PROGRESS_KEYS.progress];
      if (!raw) continue;
      const p = Progress.fromJSON(JSON.parse(raw));
      const { world: w } = await loadBugMap(text);
      const tally = { grow: 0, staples: 0, fares: 0, boats: 0, other: 0 };
      const byKind: Record<string, number> = {};
      const host: TownLifeHost = Object.assign(w, { footprintOf: () => undefined, editLand: () => {}, propsChanged: () => {}, setSignBadge: () => {} });
      const life = new TownLife(host, {
        grew: () => {},
        received: (town, kind, k, before) => {
          const paid = payDelivery(p, kind, k, before, town);
          const need = Math.max(0, Math.min(k, (before.wants[kind] ?? 0) - (before.got[kind] ?? 0)));
          const grow = Math.round((paid * need) / k);
          tally.grow += grow;
          if (STAPLES.has(kind)) tally.staples += paid - grow;
          else tally.other += paid - grow;
          if (paid > grow) byKind[kind] = (byKind[kind] ?? 0) + paid - grow;
        },
      });
      life.reset();
      attachPassengers(w, () => p, (fare) => (tally.fares += fare));
      const harbours = new HarbourTrade();
      const people = new Map<number, number>();
      const towns = w.landscape.towns.length;
      for (let s = 0; s < MINUTES * 60; s++) {
        for (let t = 0; t < SIM_HZ; t++) {
          w.sim.tick();
          w.economy.tick();
        }
        life.update();
        for (const e of harbours.update(w, p, 1)) if (e.kind === "sold") tally.boats += e.coins;
        peopleArrive(w, p, 1, people);
      }
      const all = tally.grow + tally.staples + tally.fares + tally.boats + tally.other;
      const perHour = (c: number) => Math.round((c * 60) / MINUTES);
      const share = all > 0 ? Math.round((100 * tally.staples) / all) : 0;
      const kinds = Object.entries(byKind).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${perHour(c)}`).join(", ");
      console.log(`INCOME_MAP ${file.split("/").pop()} best ${p.bestLevel} towns ${towns} trains ${w.sim.trainIds().length} coins ${p.coins} | per hour: all ${perHour(all)} grow ${perHour(tally.grow)} staples ${perHour(tally.staples)} (${share}%) fares ${perHour(tally.fares)} boats ${perHour(tally.boats)} other ${perHour(tally.other)} | staples by kind: ${kinds || "none"}`);
      n++;
    }
    expect(n).toBeGreaterThanOrEqual(0);
  }, 3_600_000);
});
