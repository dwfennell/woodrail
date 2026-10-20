import { describe, expect, it } from "vitest";
import { Editor } from "../editor/editor";
import { guideSchool } from "../game/goals";
import { buildStarterWorld, schoolTown } from "../game/world";
import { connectorRef } from "../track";
import { play } from "./player";
import { rulesFor } from "./rules";

/**
 * Show me for placing a school (`guideSchool`) on the starter map with Larkfield and Elderwick joined: the spot it
 * points to, the town it names, and the town the school would take its name from (`schoolTown`) all agree, whichever
 * town has grown most (QA: with Thimble Cross grown most, off the line, the spot was beside Elderwick, unnamed).
 */
describe("Show me's school spot", () => {
  const w = buildStarterWorld();
  const fixed = new Set([...w.stations.values(), ...w.depots.values()]);
  const editor = new Editor(w.layout, w.sim, () => {}, (id) => fixed.has(id));
  const st = (i: number) => w.stations.get(w.landscape.towns[i].id)!;
  const joined = play(w.layout, editor, connectorRef(st(0), 1), connectorRef(st(1), 0), { blocked: rulesFor(w), maxPieces: 60, fiddle: 3 });
  const grown = (i: number) => {
    w.economy.delivered.clear();
    w.economy.delivered.set(w.landscape.towns[i].id, 5);
    const g = guideSchool(w);
    const h = g.held!.heading;
    const m = g.marks[0];
    const named = schoolTown(w.landscape, { x: m.x - 108 * Math.cos(h), z: m.z - 108 * Math.sin(h), heading: h })?.town;
    return { shown: g.towns.map((id) => w.landscape.towns.find((t) => t.id === id)!.name), named: named?.name };
  };

  it("is beside the town grown most, and names it", () => {
    expect(joined.ok).toBe(true);
    expect(grown(0)).toEqual({ shown: ["Larkfield"], named: "Larkfield" });
    expect(grown(1)).toEqual({ shown: ["Elderwick"], named: "Elderwick" });
  });

  it("with that town off the line, is beside another and names that one, the school's", () => {
    const g = grown(2);
    expect(w.landscape.towns[2].name).toBe("Thimble Cross");
    expect(g.shown).toHaveLength(1);
    expect(g.named).toBe(g.shown[0]);
  });
});
