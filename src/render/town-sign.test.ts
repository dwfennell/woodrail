import { describe, expect, it } from "vitest";
import { GOODS_ICON } from "../economy/cargo";
import { plus, type Bag } from "../economy/goods";
import { needBadge } from "../game/town-life";
import { townLevel, townStatus } from "../game/towns";
import { sameBadge, signBadgeParts } from "./town-sign";

/** What a town received to stand at level `level` with `extra` on top (toward its next). */
function receivedAt(level: number, extra: Bag): Bag {
  let bag: Bag = {};
  for (let n = 0; n < level; n++) bag = plus(bag, townLevel(n).wants);
  return plus(bag, extra);
}

describe("a town sign's good", () => {
  it("is the town's next unmet need, with that good's icon and count (a City ★ with its first goods in, like Foxley)", () => {
    const status = townStatus(receivedAt(4, { planks: 33, flour: 18, stone: 15 }));
    expect(status).toMatchObject({ name: "City ★", wants: { planks: 33, flour: 18, stone: 15, iron: 10, furniture: 6 } });
    const badge = needBadge(status)!;
    expect(badge).toEqual({ wants: "iron", got: 0, of: 10 });
    // The picture and the number are the same good's: iron's, not the planks that are already full.
    expect(signBadgeParts(badge)).toEqual({ kind: "iron", icon: GOODS_ICON.iron, text: "0/10" });
  });

  it("moves on to the next good once one is complete, and leads with the first while it's short", () => {
    expect(needBadge(townStatus(receivedAt(4, { planks: 33, flour: 18, stone: 15, iron: 10 })))).toEqual({ wants: "furniture", got: 0, of: 6 });
    expect(needBadge(townStatus(receivedAt(4, { planks: 5, iron: 3 })))).toEqual({ wants: "planks", got: 5, of: 33 });
  });

  it("pictures every good with its own icon", () => {
    for (const kind of Object.keys(GOODS_ICON) as (keyof typeof GOODS_ICON)[]) expect(signBadgeParts({ wants: kind, got: 1, of: 2 }).icon).toBe(GOODS_ICON[kind]);
    expect(signBadgeParts({ count: 7 })).toEqual({ kind: "planks", icon: GOODS_ICON.planks, text: "7" });
  });

  it("is painted again only when what it shows changes", () => {
    expect(sameBadge({ wants: "iron", got: 0, of: 10 }, { wants: "iron", got: 0, of: 10 })).toBe(true);
    expect(sameBadge({ wants: "iron", got: 0, of: 10 }, { wants: "iron", got: 1, of: 10 })).toBe(false);
    expect(sameBadge({ wants: "iron", got: 0, of: 10 }, { wants: "planks", got: 0, of: 10 })).toBe(false);
    expect(sameBadge({ count: 3 }, { count: 3 })).toBe(true);
    expect(sameBadge({ count: 3 }, null)).toBe(false);
    expect(sameBadge(null, null)).toBe(true);
  });
});
