import { describe as describeGoods, type Bag } from "../economy/goods";
import type { CarKind, CarLook } from "../sim";
import type { PieceTypeId } from "../track";

/**
 * Everything the player can put on the map in Game mode, by one id: a track piece (`piece:switch`) or a car
 * (`car:engine`). Industries are track pieces too (`piece:depot-workshop`).
 */
export type ThingId = `piece:${PieceTypeId}` | `car:${CarKind}`;

export const pieceThing = (type: PieceTypeId): ThingId => `piece:${type}`;
export const carThing = (kind: CarKind): ThingId => `car:${kind}`;

/** What it takes to have one: made at the workshop from `cost`, once `tech` is learned. */
export interface ThingRule {
  readonly label: string;
  readonly cost: Bag;
  /** Coins it costs too, paid when the workshop starts making it (industry buildings). */
  readonly coins?: number;
  /** The blueprint that must be learned first (none: known from the start). */
  readonly tech?: string;
}

/**
 * Things that cost goods, and the blueprint each needs. Anything not listed is free and unlimited, as in Sandbox
 * (plain straights, curves, buffers, adapters). One table read by the tray, the toy box, the workshop and the
 * blueprint board, so a new piece, wagon or industry is one row.
 */
export const THING_RULES: Partial<Record<ThingId, ThingRule>> = {
  "piece:buffer-turnback": { label: "Turnback", cost: { planks: 1 } },
  "piece:switch": { label: "Switch", cost: { planks: 3 }, tech: "switches" },
  "piece:switch-y": { label: "Y switch", cost: { planks: 3 }, tech: "switches" },
  "piece:switch-3way": { label: "Three-way", cost: { planks: 5 }, tech: "junctions" },
  "piece:crossing": { label: "Crossing", cost: { planks: 3 }, tech: "junctions" },
  "piece:crossing-45": { label: "45° crossing", cost: { planks: 3 }, tech: "junctions" },
  "piece:crossover": { label: "Crossover", cost: { planks: 5 }, tech: "junctions" },
  "piece:wye": { label: "Wye", cost: { planks: 4 }, tech: "junctions" },
  "piece:double-straight": { label: "Double track", cost: { planks: 2 }, tech: "junctions" },
  "piece:double-curve": { label: "Double curve", cost: { planks: 2 }, tech: "junctions" },
  "piece:balloon-loop": { label: "Balloon loop", cost: { planks: 3 }, tech: "loops" },
  "piece:balloon-loop-small": { label: "Small loop", cost: { planks: 3 }, tech: "loops" },
  "piece:ramp": { label: "Ramp", cost: { planks: 2 }, tech: "bridges" },
  "piece:ramp-curve": { label: "Curved ramp", cost: { planks: 2 }, tech: "bridges" },
  "piece:riser": { label: "Riser", cost: { planks: 1 }, tech: "heights" },
  "piece:bridge": { label: "Bridge", cost: { planks: 4 }, tech: "bridges" },
  "piece:bridge-curve": { label: "Curved bridge", cost: { planks: 5 }, tech: "bridges" },
  "car:engine": { label: "Engine", cost: { planks: 6 } },
  "car:timber": { label: "Timber wagon", cost: { planks: 3 } },
  "car:hopper": { label: "Hopper", cost: { planks: 3 }, tech: "farming" },
  "car:passenger": { label: "Coach", cost: { planks: 4 }, tech: "passengers" },
  "car:caboose": { label: "Caboose", cost: { planks: 2 }, tech: "passengers" },
  "car:van": { label: "Van", cost: { planks: 3 }, tech: "mills" },
  "piece:depot-workshop": { label: "Workshop", cost: { planks: 12 } },
  // Industry buildings cost coins as well as goods: what towns pay you builds the economy.
  "piece:depot-sawmill": { label: "Sawmill", cost: { planks: 20 }, coins: 50, tech: "sawmills" },
  "piece:depot-forest": { label: "Harvester", cost: { planks: 10 }, coins: 20, tech: "harvesters" },
  "piece:depot-farm": { label: "Farm yard", cost: { planks: 12 }, coins: 30, tech: "farming" },
  "piece:depot-mill": { label: "Mill", cost: { planks: 16 }, coins: 40, tech: "mills" },
  "piece:depot-quarry": { label: "Quarry", cost: { planks: 14 }, coins: 60, tech: "quarries" },
  "piece:depot-warehouse": { label: "Warehouse", cost: { planks: 18 }, coins: 50, tech: "warehouses" },
};

/**
 * Cars in a look of their own that needs a blueprint (the passenger line's coaches, the express engine). Other looks
 * come with the car.
 */
export const LOOK_TECH: Partial<Record<CarLook, string>> = { dining: "dining", sleeper: "first-class", "double-decker": "double-decker", electric: "express" };

/** A thing's whole price, for cards: "12 planks + 30 coins". */
export function costText(rule: ThingRule): string {
  const goods = describeGoods(rule.cost);
  return rule.coins ? `${goods === "nothing" ? "" : `${goods} + `}${rule.coins} coins` : goods;
}

/** What a new game's toy box holds: enough for a first timber train, its turnbacks and a workshop. */
export const STARTING_BOX: Partial<Record<ThingId, number>> = {
  "car:engine": 1,
  "car:timber": 3,
  "piece:buffer-turnback": 2,
  "piece:depot-workshop": 1,
};

export const ruleOf = (id: ThingId): ThingRule | undefined => THING_RULES[id];

/** Free and unlimited (not counted in the toy box)? */
export const isFree = (id: ThingId): boolean => !THING_RULES[id];

/** The things a tray item puts on the map, with how many of each (a train: its cars). */
export function thingsFor(item: { kind: "piece"; type: PieceTypeId } | { kind: "train"; cars: readonly CarKind[] }): Map<ThingId, number> {
  const out = new Map<ThingId, number>();
  if (item.kind === "piece") out.set(pieceThing(item.type), 1);
  else for (const c of item.cars) out.set(carThing(c), (out.get(carThing(c)) ?? 0) + 1);
  return out;
}
