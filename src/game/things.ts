import { COIN_ICON } from "../economy/cargo";
import { iconCounts, type Bag } from "../economy/goods";
import type { CarKind, CarLook } from "../sim";
import type { PieceTypeId } from "../track";

/**
 * Everything the player can put on the map in Game mode, by one id: a track piece (`piece:switch`), a car
 * (`car:engine`) or a catalogue model placed as a prop (`prop:bldg-station-clock`: lineside furniture). Industries and
 * kits are track pieces too (`piece:depot-workshop`, `piece:kit-water-tower`).
 */
export type ThingId = `piece:${PieceTypeId}` | `car:${CarKind}` | `prop:${string}` | `look:${CarLook}`;

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
  // Tech-tree T3 and T4: a three-way with a lever for each side; crossings that can also turn.
  "piece:switch-3way-double": { label: "Double three-way", cost: { planks: 6 }, tech: "double-three-way" },
  "piece:slip-single": { label: "Single slip", cost: { planks: 5 }, tech: "slips" },
  "piece:slip-double": { label: "Double slip", cost: { planks: 6 }, tech: "slips" },
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
  // Tech tree 5: a bridge twice as long on four stone arches, for valleys and rivers. Stone from the quarries, and coins.
  "piece:viaduct": { label: "Stone viaduct", cost: { planks: 4, stone: 4 }, coins: 30, tech: "viaduct" },
  // Dug, not made: a bridge one level up over a line digs one by itself (`planUnderpass`). Free once bridges are known.
  "piece:underpass": { label: "Underpass", cost: {}, tech: "bridges", free: true },
  // Dug as much as made: coins for the digging (a tunnel takes two). A short one goes a level down, under a hill; a
  // long one two, under the felt (and anything on it).
  "piece:tunnel-mouth-short": { label: "Short tunnel mouth", cost: { planks: 1 }, coins: 20, tech: "tunnels" },
  // The rack (Mountain railway): a steep ramp only a rack engine climbs, and the lookout halt on a hilltop.
  "piece:rack": { label: "Rack", cost: { planks: 3 }, coins: 20, tech: "rack" },
  "piece:rack-short": { label: "Short rack", cost: { planks: 2 }, coins: 10, tech: "rack" },
  "piece:kit-lookout": { label: "Lookout halt", cost: { planks: 6 }, coins: 40, tech: "rack" },
  // Tech tree 5: the observatory, a lookout's kind of stop for stargazers. Iron for its dome and telescope.
  "piece:kit-observatory": { label: "Observatory", cost: { planks: 10, iron: 4 }, coins: 120, tech: "observatory" },
  // The metro (spec 2026-11-04-rail-types.md §2): dear on purpose. A stop (its platform dug two levels under a town,
  // its entrance on the town's ground) and the metro train (its motor car and two cars, besides the cars themselves).
  "piece:kit-metro-stop": { label: "Metro stop", cost: { planks: 10, iron: 25 }, coins: 600, tech: "metro" },
  "look:metro": { label: "Metro train", cost: { planks: 6, iron: 15 }, coins: 400, tech: "metro" },
  "piece:tunnel-mouth": { label: "Tunnel mouth", cost: { planks: 2 }, coins: 30, tech: "tunnels" },
  "car:engine": { label: "Engine", cost: { planks: 6 } },
  "car:timber": { label: "Flatbed wagon", cost: { planks: 3 } },
  "car:hopper": { label: "Hopper", cost: { planks: 3 }, tech: "farming" },
  "car:passenger": { label: "Coach", cost: { planks: 4 }, tech: "passengers" },
  "car:caboose": { label: "Caboose", cost: { planks: 2 }, tech: "brake-vans" },
  "car:van": { label: "Van", cost: { planks: 3 }, tech: "mills" },
  "car:tanker": { label: "Milk tank wagon", cost: { planks: 3 }, tech: "dairy" },
  "car:reefer": { label: "Cold van", cost: { planks: 4 }, tech: "reefer" },
  "car:carrier": { label: "Car carrier", cost: { planks: 3, iron: 2 }, tech: "car-carrier" },
  "car:oiltank": { label: "Tank wagon", cost: { planks: 3 }, tech: "tankers" },
  "car:crane": { label: "Breakdown crane", cost: { planks: 8 }, tech: "breakdown" },
  "car:mailvan": { label: "Mail van", cost: { planks: 3 }, tech: "post-office" },
  // (Dearer than a mail van: it sorts on the move, so it needs no post office stop.)
  "car:sortvan": { label: "Sorting van", cost: { planks: 5 }, tech: "mail" },
  "piece:depot-workshop": { label: "Workshop", cost: { planks: 12 } },
  // Industry buildings cost coins as well as goods: what towns pay you builds the economy.
  "piece:depot-sawmill": { label: "Sawmill", cost: { planks: 10 }, coins: 300, tech: "sawmills" },
  "piece:depot-forest": { label: "Harvester", cost: { planks: 5 }, coins: 150, tech: "harvesters" },
  "piece:depot-farm": { label: "Farm yard", cost: { planks: 6 }, coins: 90, tech: "farming" },
  "piece:depot-mill": { label: "Mill", cost: { planks: 8 }, coins: 400, tech: "mills" },
  // The dairy chain and the orchard (tech-tree I3, I4): mostly coins, as the spec asks of new nodes.
  "piece:depot-dairy": { label: "Dairy farm", cost: { planks: 8 }, coins: 180, tech: "dairy" },
  "piece:depot-bakery": { label: "Bakery", cost: { planks: 10 }, coins: 260, tech: "bakery" },
  "piece:depot-orchard": { label: "Orchard", cost: { planks: 6 }, coins: 150, tech: "orchard" },
  // The next nodes (tech-tree spec, 2026-11-02): chains past the farm and the mine, mostly coins.
  "piece:depot-juicer": { label: "Juice works", cost: { planks: 8 }, coins: 200, tech: "juice" },
  "piece:depot-creamery": { label: "Creamery", cost: { planks: 10 }, coins: 240, tech: "creamery" },
  "piece:depot-icecream": { label: "Ice cream factory", cost: { planks: 12 }, coins: 360, tech: "ice-cream" },
  "piece:depot-brickworks": { label: "Brickworks", cost: { planks: 10 }, coins: 320, tech: "brickworks" },
  "piece:depot-postoffice": { label: "Post office", cost: { planks: 8 }, coins: 180, tech: "post-office" },
  "piece:depot-carworks": { label: "Car factory", cost: { planks: 12, iron: 4 }, coins: 420, tech: "car-factory" },
  // Tank wagons' wells (Tank wagons): oil anywhere, water by a river or lake.
  "piece:depot-oilwell": { label: "Oil well", cost: { planks: 8 }, coins: 220, tech: "tankers" },
  "piece:depot-waterpump": { label: "Water pump", cost: { planks: 6 }, coins: 160, tech: "tankers" },
  // The goods chains (2026-11-04): mostly coins, as the spec asks of new nodes.
  "piece:depot-beet": { label: "Sugar beet field", cost: { planks: 6 }, coins: 150, tech: "sugar" },
  "piece:depot-jam": { label: "Jam kitchen", cost: { planks: 10 }, coins: 260, tech: "jam" },
  "piece:depot-chocolate": { label: "Chocolate factory", cost: { planks: 12 }, coins: 380, tech: "chocolate" },
  "piece:depot-flowers": { label: "Flower field", cost: { planks: 6 }, coins: 150, tech: "paint" },
  "piece:depot-dyeworks": { label: "Dye works", cost: { planks: 10 }, coins: 240, tech: "paint" },
  "piece:depot-toyworks": { label: "Toy workshop", cost: { planks: 14 }, coins: 440, tech: "toys" },
  "piece:depot-quarry": { label: "Quarry", cost: { planks: 7 }, coins: 180, tech: "quarries" },
  "piece:depot-mine": { label: "Mine", cost: { planks: 10 }, coins: 310, tech: "mines" },
  "piece:depot-foundry": { label: "Foundry", cost: { planks: 15 }, coins: 480, tech: "foundry" },
  "piece:depot-carpenter": { label: "Carpenter's yard", cost: { planks: 7 }, coins: 210, tech: "carpentry" },
  "piece:depot-smithy": { label: "Smithy", cost: { planks: 8, iron: 4 }, coins: 260, tech: "smithy" },
  "piece:depot-power": { label: "Power station", cost: { planks: 12, iron: 6 }, coins: 380, tech: "electricity" },
  "piece:depot-warehouse": { label: "Warehouse", cost: { planks: 9 }, coins: 280, tech: "warehouses" },
  "piece:depot-harbour": { label: "Harbour", cost: { planks: 15, stone: 10 }, coins: 480, tech: "harbours" },
  // Water transport (docs/superpowers/specs/2026-11-04-water-transport.md): a river landing for the barges, a ferry
  // slip for the train ferry, and a lighthouse by a harbour (ships call twice as often).
  "piece:kit-landing": { label: "River landing", cost: { planks: 6 }, coins: 160, tech: "barges" },
  "piece:kit-boatyard": { label: "Boatyard", cost: { planks: 8 }, coins: 180, tech: "barges" },
  "piece:kit-shipyard": { label: "Shipyard", cost: { planks: 12, stone: 8 }, coins: 360, tech: "shipyards" },
  "piece:kit-ferry-slip": { label: "Ferry slip", cost: { planks: 10, stone: 6 }, coins: 300, tech: "ferry" },
  "prop:bldg-lighthouse": { label: "Lighthouse", cost: { planks: 6, stone: 6 }, tech: "lighthouse" },
  // The school, where blueprints are researched (src/game/research.ts): beside a town, one per town.
  "piece:depot-school": { label: "School", cost: {}, coins: SCHOOL_COINS },

  // Railway kits (src/track/kits.ts) and lineside furniture in Game mode: each row names the blueprint that unlocks it
  // (docs/superpowers/specs/2026-10-17-track-props-design.md, "Game mode availability"). Priced against the pieces
  // like them: a signal skin a plank over the signal, an engine service like a switch, a shed or roundhouse like the
  // workshop; planks only (kits make the railway, not the economy). Sandbox's cargo loaders and unloaders are here
  // as looks only: in Game mode they're no depot (`syncIndustries`), so no endless heap and nothing vanishes.
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
  // Signal boxes (tech tree 4): the box and lever frame (from the Scenery kit before), and the Telegraph's poles.
  "prop:bldg-signal-box": { label: "Signal box", cost: { planks: 4 }, tech: "signal-boxes" },
  "prop:mech-lever-frame": { label: "Lever frame", cost: { planks: 2 }, tech: "signal-boxes" },
  "prop:mech-telegraph-pole": { label: "Telegraph pole", cost: { planks: 1 }, tech: "telegraph" },
  // A spark of power with no coal (src/game/power.ts): only on a hilltop.
  "prop:mech-wind-turbine": { label: "Wind turbine", cost: { planks: 4, iron: 2 }, coins: 60, tech: "wind" },
  // Big stations: passenger stops of their own (looks only for now: not a town's halt).
  "piece:kit-two-platform-station": { label: "Two-platform station", cost: { planks: 10 }, tech: "big-stations" },
  "piece:kit-grand-terminus": { label: "Grand terminus", cost: { planks: 14 }, tech: "big-stations" },
  // Fun track.
  "piece:kit-train-lift": { label: "Train lift", cost: { planks: 10 }, tech: "fun-track" },
  // Tech tree 5: the line over a river at the ground, its span lifting for boats. Iron for the towers, and coins.
  "piece:kit-lift-bridge": { label: "Lift bridge", cost: { planks: 6, iron: 2 }, coins: 60, tech: "lift-bridge" },
  "piece:kit-loop-the-loop": { label: "Loop-the-loop", cost: { planks: 8 }, tech: "fun-track" },
  "piece:kit-buffer-stop-lamp": { label: "Buffer stop with a lamp", cost: { planks: 2 }, tech: "fun-track" },
  // Fuel stop.
  "piece:kit-fuel-station": { label: "Fuel station", cost: { planks: 5 }, tech: "fuel-stop" },
  // Loading kits and big cranes: looks only (see above).
  "piece:kit-log-loader": { label: "Log loader", cost: { planks: 5 }, tech: "loading-kits" },
  "piece:kit-grain-elevator": { label: "Grain elevator", cost: { planks: 5 }, tech: "loading-kits" },
  "piece:kit-drop-hopper": { label: "Drop hopper", cost: { planks: 4 }, tech: "loading-kits" },
  "piece:kit-goods-shed": { label: "Goods shed", cost: { planks: 6 }, tech: "loading-kits" },
  "piece:kit-gantry-crane": { label: "Gantry crane", cost: { planks: 8 }, tech: "big-cranes" },
  "piece:kit-magnet-crane": { label: "Magnet crane", cost: { planks: 8 }, tech: "big-cranes" },
  "piece:kit-harbour-crane": { label: "Harbour crane", cost: { planks: 8 }, tech: "big-cranes" },
  "piece:kit-cargo-conveyor": { label: "Conveyor", cost: { planks: 6 }, tech: "big-cranes" },
  "piece:kit-tipping-dump": { label: "Wagon tipper", cost: { planks: 6 }, tech: "big-cranes" },
  "piece:kit-coal-chute": { label: "Coal chute", cost: { planks: 5 }, tech: "big-cranes" },
  // Crossing styles: only a look, so free once learned (Crossing gates, the Roads branch; Scenery kit's before).
  "prop:mech-level-crossing": { label: "Level crossing", cost: {}, tech: "road-crossings", free: true },
  "prop:mech-gated-crossing": { label: "Gated crossing", cost: {}, tech: "road-crossings", free: true },
  // Buses (roads spec D6): a bus stop beside a station brings a bus.
  "prop:scene-bus-stop": { label: "Bus stop", cost: {}, tech: "buses", free: true },
};

/**
 * Cars in a look of their own that needs a blueprint (the passenger line's coaches, the express engine). Other looks
 * come with the car.
 */
export const LOOK_TECH: Partial<Record<CarLook, string>> = { dining: "dining", "first-class": "first-class", "double-decker": "double-decker", express: "express", tank: "tank", diesel: "diesel", electric: "electric", goods: "goods-engine", rack: "rack", metro: "metro", sleeper: "sleeper", observation: "observation" };

/** A thing's whole price, for cards, by icon as tickets show it: "12\uE000 30🪙" ("free" if nothing). */
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
export type ThingItem = { kind: "piece"; type: PieceTypeId } | { kind: "train"; cars: readonly CarKind[]; looks?: readonly CarLook[] } | { kind: "prop"; asset: string };

/** The things a tray item puts on the map, with how many of each (a train: its cars). */
export function thingsFor(item: ThingItem): Map<ThingId, number> {
  const out = new Map<ThingId, number>();
  if (item.kind === "piece") out.set(pieceThing(item.type), 1);
  else if (item.kind === "prop") out.set(propThing(item.asset), 1);
  else {
    for (const c of item.cars) out.set(carThing(c), (out.get(carThing(c)) ?? 0) + 1);
    // (A look with a price of its own, the metro train: one for the train.)
    for (const look of new Set(item.looks ?? [])) {
      const id: ThingId = `look:${look}`;
      if (THING_RULES[id]) out.set(id, 1);
    }
  }
  return out;
}
