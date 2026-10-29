import { COIN_ICON } from "../economy/cargo";
import { iconCounts, type Bag } from "../economy/goods";
import type { CarKind, CarLook } from "../sim";
import type { PieceTypeId } from "../track";

/**
 * Everything the player can put on the map in Game mode, by one id: a track piece (`piece:switch`), a car
 * (`car:engine`) or a catalogue model placed as a prop (`prop:bldg-station-clock`: lineside furniture). Industries and
 * kits are track pieces too (`piece:depot-workshop`, `piece:kit-water-tower`).
 */
export type ThingId = `piece:${PieceTypeId}` | `car:${CarKind}` | `prop:${string}`;

export const pieceThing = (type: PieceTypeId): ThingId => `piece:${type}`;
export const carThing = (kind: CarKind): ThingId => `car:${kind}`;
export const propThing = (asset: string): ThingId => `prop:${asset}`;

/** A school after the one your first village gives you: coins only. */
export const SCHOOL_COINS = 40;

/** What it takes to have one: made at the workshop from `cost`, once `tech` is learned. */
export interface ThingRule {
  readonly label: string;
  readonly cost: Bag;
  /** Coins it costs too, paid when the workshop starts making it (industry buildings). */
  readonly coins?: number;
  /** The blueprint that must be learned first (none: known from the start). */
  readonly tech?: string;
  /** Free and unlimited once its blueprint is learned (only a look: the crossing styles). Never made or counted. */
  readonly free?: true;
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
  "piece:signal": { label: "Signal", cost: { planks: 2 }, tech: "signals" },
  "piece:switch-3way": { label: "Three-way", cost: { planks: 5 }, tech: "junctions" },
  "piece:crossing": { label: "Crossing", cost: { planks: 3 }, tech: "junctions" },
  "piece:crossing-45": { label: "45° crossing", cost: { planks: 3 }, tech: "junctions" },
  "piece:crossover": { label: "Crossover", cost: { planks: 5 }, tech: "junctions" },
  "piece:wye": { label: "Wye", cost: { planks: 4 }, tech: "junctions" },
  "piece:double-straight": { label: "Double track", cost: { planks: 2 }, tech: "junctions" },
  "piece:double-curve": { label: "Double curve", cost: { planks: 2 }, tech: "junctions" },
  "piece:balloon-loop": { label: "Balloon loop", cost: { planks: 3 }, tech: "junctions" },
  "piece:balloon-loop-small": { label: "Small loop", cost: { planks: 3 }, tech: "junctions" },
  "piece:ramp": { label: "Ramp", cost: { planks: 2 }, tech: "bridges" },
  "piece:ramp-curve": { label: "Curved ramp", cost: { planks: 2 }, tech: "bridges" },
  "piece:ramp-curve-small": { label: "Tight curved ramp", cost: { planks: 2 }, tech: "bridges" },
  "piece:ramp-curve-wide": { label: "Wide curved ramp", cost: { planks: 2 }, tech: "bridges" },
  "piece:riser": { label: "Riser", cost: { planks: 1 }, tech: "bridges" },
  "piece:bridge": { label: "Bridge", cost: { planks: 4 }, tech: "bridges" },
  "piece:bridge-curve": { label: "Curved bridge", cost: { planks: 5 }, tech: "bridges" },
  "car:engine": { label: "Engine", cost: { planks: 6 } },
  "car:timber": { label: "Flatbed wagon", cost: { planks: 3 } },
  "car:hopper": { label: "Hopper", cost: { planks: 3 }, tech: "farming" },
  "car:passenger": { label: "Coach", cost: { planks: 4 }, tech: "passengers" },
  "car:caboose": { label: "Caboose", cost: { planks: 2 }, tech: "passengers" },
  "car:van": { label: "Van", cost: { planks: 3 }, tech: "mills" },
  "piece:depot-workshop": { label: "Workshop", cost: { planks: 12 } },
  // Industry buildings cost coins as well as goods: what towns pay you builds the economy.
  "piece:depot-sawmill": { label: "Sawmill", cost: { planks: 10 }, coins: 300, tech: "sawmills" },
  "piece:depot-forest": { label: "Harvester", cost: { planks: 5 }, coins: 150, tech: "harvesters" },
  "piece:depot-farm": { label: "Farm yard", cost: { planks: 6 }, coins: 90, tech: "farming" },
  "piece:depot-mill": { label: "Mill", cost: { planks: 8 }, coins: 400, tech: "mills" },
  "piece:depot-quarry": { label: "Quarry", cost: { planks: 7 }, coins: 180, tech: "quarries" },
  "piece:depot-mine": { label: "Mine", cost: { planks: 10 }, coins: 310, tech: "mines" },
  "piece:depot-foundry": { label: "Foundry", cost: { planks: 15 }, coins: 480, tech: "foundry" },
  "piece:depot-carpenter": { label: "Carpenter's yard", cost: { planks: 7 }, coins: 210, tech: "carpentry" },
  "piece:depot-smithy": { label: "Smithy", cost: { planks: 8, iron: 4 }, coins: 260, tech: "smithy" },
  "piece:depot-power": { label: "Power station", cost: { planks: 12, iron: 6 }, coins: 380, tech: "electricity" },
  "piece:depot-warehouse": { label: "Warehouse", cost: { planks: 9 }, coins: 280, tech: "warehouses" },
  "piece:depot-harbour": { label: "Harbour", cost: { planks: 15, stone: 10 }, coins: 480, tech: "harbours" },
  // The school, where blueprints are researched (src/game/research.ts): beside a town, one per town.
  "piece:depot-school": { label: "School", cost: {}, coins: SCHOOL_COINS },

  // Railway kits (src/track/kits.ts) and lineside furniture in Game mode: each row names the blueprint that unlocks it
  // (docs/superpowers/specs/2026-10-17-track-props-design.md, "Game mode availability"). Priced against the pieces
  // like them: a signal skin a plank over the signal, an engine service like a switch, a shed or roundhouse like the
  // workshop; planks only (kits make the railway, not the economy). Not in Game mode: Sandbox's cargo loaders and
  // unloaders (the goods shed among them), the two-platform station, the terminus, the fuel station, the buffer-stop
  // lamp.
  // Signals: the semaphore is the signal in a look of its own; the colour light needs electricity.
  "piece:kit-semaphore-signal": { label: "Semaphore signal", cost: { planks: 3 }, tech: "signals" },
  "piece:kit-colour-light-signal": { label: "Colour-light signal", cost: { planks: 2, iron: 1 }, tech: "electricity" },
  // Junctions and loops: the gantry, a signal over each of two roads.
  "piece:kit-signal-gantry": { label: "Signal gantry", cost: { planks: 6 }, tech: "junctions" },
  // Engine shed: the shed, and engine services (steam engines stop at them for water or coal).
  "piece:kit-engine-shed": { label: "Engine shed", cost: { planks: 12 }, tech: "engine-shed" },
  "piece:kit-water-tower": { label: "Water tower", cost: { planks: 4 }, tech: "engine-shed" },
  "piece:kit-coal-stage": { label: "Coal stage", cost: { planks: 5 }, tech: "engine-shed" },
  "piece:kit-water-crane": { label: "Water crane", cost: { planks: 3 }, tech: "engine-shed" },
  "piece:kit-coaling-crane": { label: "Coaling crane", cost: { planks: 5 }, tech: "engine-shed" },
  // Turntable and roundhouse.
  "piece:kit-turntable": { label: "Turntable", cost: { planks: 10 }, tech: "turntable" },
  "piece:kit-roundhouse-segment": { label: "Roundhouse", cost: { planks: 12 }, tech: "turntable" },
  "piece:kit-transfer-table": { label: "Transfer table", cost: { planks: 8 }, tech: "turntable" },
  // Halts: more passenger stops for the town nearest them (`HALT_KITS`, src/game/world.ts).
  "piece:kit-country-halt": { label: "Country halt", cost: { planks: 6 }, tech: "halts" },
  "piece:kit-mountain-station": { label: "Mountain station", cost: { planks: 8 }, tech: "halts" },
  "piece:kit-harbour-station": { label: "Harbour station", cost: { planks: 8 }, tech: "halts" },
  "piece:kit-platform-furnished": { label: "Platform", cost: { planks: 4 }, tech: "halts" },
  // Scenery kit: sights on the line with small behaviours, and the furniture beside it.
  "piece:kit-castle-gate": { label: "Castle gate", cost: { planks: 8 }, tech: "scenery" },
  "piece:kit-train-wash": { label: "Train wash", cost: { planks: 5 }, tech: "scenery" },
  "piece:kit-weighbridge": { label: "Weighbridge", cost: { planks: 4 }, tech: "scenery" },
  "car:cleaner": { label: "Track cleaner", cost: { planks: 3 }, tech: "scenery" },
  "prop:bldg-station-clock": { label: "Station clock", cost: { planks: 2 }, tech: "scenery" },
  "prop:mech-whistle-post": { label: "Whistle post", cost: { planks: 1 }, tech: "scenery" },
  "prop:bldg-signal-box": { label: "Signal box", cost: { planks: 4 }, tech: "scenery" },
  "prop:mech-lever-frame": { label: "Lever frame", cost: { planks: 2 }, tech: "scenery" },
  // Crossing styles: only a look, so free once learned.
  "prop:mech-level-crossing": { label: "Level crossing", cost: {}, tech: "scenery", free: true },
  "prop:mech-gated-crossing": { label: "Gated crossing", cost: {}, tech: "scenery", free: true },
};

/**
 * Cars in a look of their own that needs a blueprint (the passenger line's coaches, the express engine). Other looks
 * come with the car.
 */
export const LOOK_TECH: Partial<Record<CarLook, string>> = { dining: "dining", "first-class": "first-class", "double-decker": "double-decker", express: "express", tank: "tank", diesel: "diesel", electric: "electric", goods: "goods-engine" };

/** A thing's whole price, for cards, by icon as tickets show it: "12🪵 30🪙" ("free" if nothing). */
export function costText(rule: ThingRule): string {
  return [iconCounts(rule.cost), rule.coins ? `${rule.coins}${COIN_ICON}` : ""].filter(Boolean).join(" ") || "free";
}

/** What a new game's toy box holds: enough for a first timber train, its turnbacks and a workshop. */
export const STARTING_BOX: Partial<Record<ThingId, number>> = {
  "car:engine": 1,
  "car:timber": 3,
  "piece:buffer-turnback": 2,
  "piece:depot-workshop": 1,
};

export const ruleOf = (id: ThingId): ThingRule | undefined => THING_RULES[id];

/**
 * Free and unlimited (not counted in the toy box)? Anything without a rule, and what's free once learned (a crossing
 * style). Whether it's known yet is `Progress.knows`.
 */
export const isFree = (id: ThingId): boolean => THING_RULES[id]?.free !== undefined || !THING_RULES[id];

/** A tray item that puts things on the map: a piece, a train, or a catalogue model (a prop). */
export type ThingItem = { kind: "piece"; type: PieceTypeId } | { kind: "train"; cars: readonly CarKind[] } | { kind: "prop"; asset: string };

/** The things a tray item puts on the map, with how many of each (a train: its cars). */
export function thingsFor(item: ThingItem): Map<ThingId, number> {
  const out = new Map<ThingId, number>();
  if (item.kind === "piece") out.set(pieceThing(item.type), 1);
  else if (item.kind === "prop") out.set(propThing(item.asset), 1);
  else for (const c of item.cars) out.set(carThing(c), (out.get(carThing(c)) ?? 0) + 1);
  return out;
}
