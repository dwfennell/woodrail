import { describe, expect, it } from "vitest";
import { FEAT_FIELD, reachable } from "../landscape";
import { LandEditor } from "../landscape/edit";
import { fieldPrice, fieldSpot, plantField } from "./fields";
import { resourceAt, SITE_RULES, yardMiddle } from "./industries";
import { buildStarterWorld } from "./world";

describe("planted fields", () => {
  it("go on open grass near a farm yard, count toward its fields, and cost more each time", () => {
    const w = buildStarterWorld();
    const land = w.landscape;
    // A farm yard's pose by the first town (any place on the map will do for the field search).
    const pose = { x: land.towns[0].centre.x + 300, z: land.towns[0].centre.z + 400, heading: 0 };
    const before = resourceAt(land, "farm", pose)!.count;
    const fields = land.fields.length;
    const editor = new LandEditor(land, w.layout);
    const cells = fieldSpot(land, editor, yardMiddle(pose), SITE_RULES.farm!.reach)!;
    expect(cells).toHaveLength(4);
    const slots = plantField(land, cells);
    expect(slots.length).toBeGreaterThan(0);
    expect(land.fields).toHaveLength(fields + 1);
    for (const i of cells) expect(land.grid.feature[i]).toBe(FEAT_FIELD);
    expect(resourceAt(land, "farm", pose)!.count).toBe(before + 4);
    expect(reachable(land)).toBe(true);
    expect(fieldPrice(1)).toBeGreaterThan(fieldPrice(0));
  });
});
