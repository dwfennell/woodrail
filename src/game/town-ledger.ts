import { capOf, CARGO, GOODS_ICON, RECIPES, type CargoKind, type DepotRole, type DepotState } from "../economy";
import { kindsOf } from "../economy/goods";
import { MARKET_BONUS, schoolGrade, townLandmarks } from "./landmarks";
import { techOf } from "./tech";
import { ruleOf, type ThingId } from "./things";
import { receivedBy } from "./town-life";
import { townLevel, townStatus } from "./towns";
import { DEPOT_NAMES, depotName, type World } from "./world";

/**
 * A town's card in Game mode (the town ledger): where it stands and what it's growing into, what it still needs, its
 * school, market and station, and the lines that call. Built from what the game already keeps; `ledgerKey` says when
 * any of it changed, so the card is built again only then (never per frame).
 */
export interface LedgerGood {
  kind: CargoKind;
  icon: string;
  label: string;
  have: number;
  need: number;
}

export interface TownLedger {
  name: string;
  /** Its level now ("Town") and the next ("City"). */
  level: string;
  next: string;
  /** Goods in toward the next level, of how many. */
  have: number;
  need: number;
  goods: LedgerGood[];
  /** A plain fact about what's holding it back (a good no industry on the map makes yet, and how to get one), or null. */
  holding: string | null;
  /** The goods whose pile at the station is full: trains can't unload more of them until the town uses some. */
  full: string[];
  /** Its school, with how it's grown (a college, a library wing), or null. */
  school: { depotId: number; name: string; note: string } | null;
  /** What a market pays for deliveries, against a town without one (1: no market). */
  market: number;
  /** People waiting at the station whose card is open, its room, and the riders carried all game (once Passengers is learned), or null. */
  station: { waiting: number; room: number; carried: number } | null;
  /** The lines that call at the town, with how many trains run on each (once Train routes is learned). */
  lines: { id: number; name: string; colour: string; trains: number }[];
}

/** What the ledger needs of the game beyond the world: what's learned, and the station's room for waiting people. */
export interface LedgerContext {
  learned: ReadonlySet<string>;
  /** Room at a station for waiting people, or null while passengers aren't learned. */
  room: number | null;
  /** People carried by coach, all game. */
  carried: number;
}

/** The industries that make each good (the first a player could build: no Sandbox loaders, warehouses or quays). */
const MAKERS: Exclude<DepotRole, "town">[] = ["sawmill", "mill", "quarry", "foundry", "carpenter", "smithy", "mine", "farm", "forest"];
const makerOf = (kind: CargoKind): Exclude<DepotRole, "town"> | undefined => MAKERS.find((r) => RECIPES[r].gives.includes(kind));

/**
 * How to get a good nothing on the map makes: build the industry that makes it, or first learn the blueprint for one
 * (at a school).
 */
function howToGet(kind: CargoKind, learned: ReadonlySet<string>): string {
  const maker = makerOf(kind);
  if (!maker) return "nothing makes it yet";
  const name = DEPOT_NAMES[maker].toLowerCase();
  const tech = ruleOf(`piece:depot-${maker}` as ThingId)?.tech;
  if (tech && !learned.has(tech)) return `there's no ${name} yet. Learn ${techOf(tech)?.label ?? tech} at a school`;
  return `there's no ${name} yet. Build one from the tray`;
}

/** The town ledger for the town of depot `d` (its station or a halt). */
export function townLedger(world: World, d: DepotState, ctx: LedgerContext): TownLedger | null {
  const town = world.landscape.towns.find((t) => t.id === d.townId);
  if (!town) return null;
  const status = townStatus(receivedBy(world, town.id));
  const goods = kindsOf(status.wants).map((kind) => ({ kind, icon: GOODS_ICON[kind], label: CARGO[kind].label, have: status.got[kind] ?? 0, need: status.wants[kind]! }));
  const have = goods.reduce((t, g) => t + g.have, 0);
  const need = goods.reduce((t, g) => t + g.need, 0);
  // What's holding it back, plainly: a good it still needs that nothing on the map makes yet.
  const depots = world.economy.allDepots().filter((x) => world.layout.getPiece(x.pieceId));
  const missing = goods.find((g) => g.have < g.need && !depots.some((x) => RECIPES[x.role].gives.includes(g.kind) && x.role !== "warehouse" && x.role !== "harbour"));
  const holding = missing ? `Needs ${missing.icon} ${missing.label.toLowerCase()}: ${howToGet(missing.kind, ctx.learned)}` : null;
  const cap = capOf("town");
  const full = RECIPES.town.takes
    .filter((k) => d.piles[CARGO[k].index] >= cap)
    .map((k) => `${GOODS_ICON[k]} ${CARGO[k].label.toLowerCase()}`);
  const s = depots.find((x) => x.role === "school" && x.townId === town.id);
  let school: TownLedger["school"] = null;
  if (s) {
    const grade = schoolGrade(world, s, ctx.learned);
    // (Named as its own card is titled; a college says so in its note.)
    const note = [grade.college ? "a college: learns 2× as fast" : "", grade.wing ? "library wing" : ""].filter(Boolean).join(" · ") || "a schoolhouse";
    school = { depotId: s.id, name: depotName(world, s), note };
  }
  const calls = (lineStops: readonly { depotId: number }[]) => lineStops.some((st) => world.economy.depot(st.depotId)?.role === "town" && world.economy.depot(st.depotId)?.townId === town.id);
  const lines = [...world.economy.lines.values()]
    .filter((l) => ctx.learned.has("routes") && calls(l.stops))
    .map((l) => ({ id: l.id, name: l.name, colour: l.colour, trains: [...world.economy.lineIdOf.values()].filter((id) => id === l.id).length }));
  return {
    name: town.name,
    level: status.name,
    next: townLevel(status.level + 1).name,
    have,
    need,
    goods,
    holding,
    full,
    school,
    market: townLandmarks(town).has("market") ? MARKET_BONUS : 1,
    station: ctx.room === null ? null : { waiting: d.waiting, room: ctx.room, carried: ctx.carried },
    lines,
  };
}

/** Mix `v` into hash `h`. */
const mix = (h: number, v: number): number => Math.imul(h ^ (v | 0), 0x01000193);

/** A string's characters, mixed in (names: a line renamed changes its chip). */
function mixText(h: number, s: string): number {
  for (let i = 0; i < s.length; i++) h = mix(h, s.charCodeAt(i));
  return mix(h, s.length);
}

/**
 * Changes whenever what the ledger of depot `d` shows does: the town's goods in, its buildings (a market, the town
 * growing), the schools and what's learned (a school's grade), the waiting people, the lines and their trains. A few
 * numbers mixed, no allocation: called every frame while the card is open.
 */
export function ledgerKey(world: World, d: DepotState, ctx: LedgerContext): number {
  let h = mix(0x811c9dc5, d.id);
  h = mix(h, world.economy.delivered.get(d.townId) ?? 0);
  const bag = world.economy.deliveredGoods.get(d.townId);
  if (bag) for (const k in bag) h = mix(h, (bag as Record<string, number>)[k] ?? 0);
  const town = world.landscape.towns.find((t) => t.id === d.townId);
  h = mix(h, town?.buildings.length ?? -1);
  h = mix(h, world.economy.allDepots().length);
  h = mix(h, world.layout.piecesVersion);
  h = mix(h, ctx.learned.size);
  h = mix(h, ctx.room ?? -1);
  h = mix(h, ctx.carried);
  h = mix(h, d.waiting);
  for (let i = 0; i < d.piles.length; i++) h = mix(h, d.piles[i]);
  for (const l of world.economy.lines.values()) {
    h = mix(h, l.id);
    h = mixText(h, l.name);
    h = mixText(h, l.colour);
    for (const st of l.stops) h = mix(h, st.depotId);
  }
  for (const [engine, line] of world.economy.lineIdOf) h = mix(mix(h, engine), line);
  return h;
}
