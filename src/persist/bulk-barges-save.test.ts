/**
 * Barges carry any goods now (water-transport spec §5, choice D2, 2026-11-26). A Game save from before, when they
 * carried only bulk (fixtures/2026-11-26-bulk-barges-game.json, written by main's save writer then): a two-barge tow
 * sailing with logs and coal, its landing holding paint it wouldn't take, and a boat tied up with both stops Only drop
 * (the player's screenshot). It loads as it was: the same loads, stops and actions, and is written back the same.
 */
import fixture from "./fixtures/2026-11-26-bulk-barges-game.json?raw";
import { describe, expect, it } from "vitest";
import { CARGO } from "../economy";
import { deserializeWorld, serializeWorld } from "./save";

describe("a save from when barges carried only bulk", () => {
  const data = JSON.parse(fixture) as { boats: unknown[]; depots: { role: string; piles: number[] }[] };

  it("loads unchanged: its boats' loads, stops, actions and how far they'd sailed", () => {
    const r = deserializeWorld(JSON.parse(fixture), { sandbox: false });
    expect(r.ok ? "ok" : r.error).toBe("ok");
    const w = r.ok ? r.value : null!;
    const boats = [...w.economy.boats.values()].map((b) => ({ name: b.name, barges: b.barges, load: b.load, actions: b.stops.map((s) => s.action), from: b.from, docked: b.docked, t: b.t, going: b.going }));
    expect(boats).toEqual([
      { name: "Puffin", barges: 2, load: { log: 4, coal: 3 }, actions: ["pick", "drop"], from: 0, docked: false, t: 4, going: true },
      { name: "Kingfisher", barges: 1, load: {}, actions: ["drop", "drop"], from: 0, docked: true, t: 0, going: true },
    ]);
    // (The paint the tow left on the jetty is still there.)
    expect(data.depots.filter((d) => d.role === "landing").map((d) => d.piles[CARGO.paint.index])).toEqual([2, 0]);
    const landings = w.economy.allDepots().filter((d) => d.role === "landing");
    expect(landings.map((d) => d.piles[CARGO.paint.index])).toEqual([2, 0]);
  });

  it("is written back with its boats as they were", () => {
    const r = deserializeWorld(JSON.parse(fixture), { sandbox: false });
    const again = JSON.parse(JSON.stringify(serializeWorld(r.ok ? r.value : null!))) as { boats: unknown[] };
    expect(again.boats).toEqual(data.boats);
  });
});
