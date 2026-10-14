import type { Bag } from "../economy/goods";
import type { CarKind } from "../sim";
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
  "piece:depot-workshop": { label: "Workshop", cost: { planks: 12 } },
  "piece:depot-sawmill": { label: "Sawmill", cost: { planks: 20 }, tech: "sawmills" },
  "piece:depot-forest": { label: "Harvester", cost: { planks: 10 }, tech: "harvesters" },
  "piece:depot-farm": { label: "Farm yard", cost: { planks: 12 }, tech: "farming" },
  "piece:depot-mill": { label: "Mill", cost: { planks: 16 }, tech: "mills" },
};

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
