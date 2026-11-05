import { CARGO_KINDS } from "../economy/cargo";
import { RENAMED } from "./blueprints";
import { offerFromJSON, offerToJSON, type Offer } from "./growth-cards";
import { newResearch, repairQueue, researchFromJSON, researchToJSON, type Research, type ResearchData } from "./research";
import { techOf } from "./tech";
import { isFree, ruleOf, STARTING_BOX, THING_RULES, thingsFor, type ThingId } from "./things";
import type { World } from "./world";

/**
 * A Game-mode player's progress beside the railway: what they own (made at the workshop, or in the starting box) and
 * which blueprints they've learned. What's free to use is worked out, not kept: owned less what's on the map now, so
 * picking a piece up, or undoing, gives it back with no bookkeeping.
 */
export class Progress {
  readonly owned = new Map<ThingId, number>();
  readonly learned = new Set<string>();
  /** Choices waiting: the cards a town offered when it grew, one to take (see `growth-cards.ts`). Never a blueprint. */
  readonly offers: Offer[] = [];
  /** A v12 save's offers (two blueprints or a crate), by town: drawn again as cards once its map is in (`redrawOldOffers`). */
  readonly oldOffers: string[] = [];
  /** The workshop's orders, in order (see `Crafting`). */
  readonly orders: ThingId[] = [];
  /** The first order's goods are taken and it's being made. */
  making = false;
  /** Coins: towns pay them for deliveries; they buy land. */
  coins = 0;
  /** Things counted over the game that blueprints can require ("loadsMoved", "delivered:planks"…), beyond riders. */
  readonly counts = new Map<string, number>();
  /** The biggest any of your towns has grown (a level: 1 a village…), for the first-time gifts. */
  bestLevel = 0;
  /** The first flour a town received has paid its bonus (see `payDelivery`): once a game. */
  firstFlour = false;
  /** Fields planted with coins (each dearer than the last: see `fieldPrice`). */
  fieldsPlanted = 0;
  /**
   * Road squares you own (Game mode's roads: see road-box.ts): the lanes the map came with and every square bought.
   * Those not on the map are in the box, free to lay.
   */
  roads = 0;
  /** Squares of town dug under for track two levels down (the metro's tunnels: src/game/metro.ts), paid for. */
  dug = 0;
  /** People carried to another town by coach, all game (they unlock the passenger line of blueprints). */
  riders = 0;
  /** What your map has that a blueprint can require (a market; a school beside a city): not saved (see `landmarksAt`). */
  readonly landmarks = new Set<string>();
  /** What the schools are researching (see `research.ts`). */
  research: Research = newResearch();
  /**
   * The last few rewards taken, and what each gave (`takeCard`), so a cloud merge counts a reward taken on both
   * devices once (`mergeProgress`). Planks went into the world, so they aren't here.
   */
  readonly taken: Taken[] = [];

  /**
   * A new game: the starting box. (Any blueprint ready to learn can be picked for research.)
   */
  static fresh(): Progress {
    const p = new Progress();
    for (const [id, n] of Object.entries(STARTING_BOX) as [ThingId, number][]) p.owned.set(id, n);
    return p;
  }

  /** Is this known (its blueprint learned, or it needs none)? */
  knows(id: ThingId): boolean {
    const tech = ruleOf(id)?.tech;
    return !tech || this.learned.has(tech);
  }

  /** How many are free to put on the map now (Infinity for free things). */
  available(world: World, id: ThingId): number {
    if (isFree(id)) return Infinity;
    return Math.max(0, (this.owned.get(id) ?? 0) - inUse(world, id));
  }

  /**
   * Is there another of this tray piece or train in the toy box (all it takes, free things aside)? Not counting what
   * the workshop could make on the spot.
   */
  hasAnother(world: World, item: Parameters<typeof thingsFor>[0]): boolean {
    return this.short(world, thingsFor(item)) === null;
  }

  /** Can all of these go on the map now? Returns the first thing short, or null. */
  short(world: World, needs: ReadonlyMap<ThingId, number>): ThingId | null {
    for (const [id, n] of needs) if (!this.knows(id) || (!isFree(id) && this.available(world, id) < n)) return id;
    return null;
  }

  add(id: ThingId, n = 1): void {
    this.owned.set(id, (this.owned.get(id) ?? 0) + n);
  }

  /** Never own less than is on the map (a save from before the toy box, or a hand-edited one). */
  coverMap(world: World): void {
    for (const id of Object.keys(THING_RULES) as ThingId[]) {
      if (isFree(id)) continue;
      const n = inUse(world, id);
      if (n > (this.owned.get(id) ?? 0)) this.owned.set(id, n);
    }
  }

  /** Never own fewer road squares than are on the map (a new game's lanes; a save from before roads were bought). */
  coverRoads(onMap: number): void {
    if (onMap > this.roads) this.roads = onMap;
  }

  toJSON(): ProgressData {
    return { owned: [...this.owned], learned: [...this.learned], offers: [...this.offers.map(offerToJSON), ...this.oldOffers.map((from) => ({ from, ids: [] }))], coins: this.coins, orders: [...this.orders], making: this.making, fieldsPlanted: this.fieldsPlanted, ...(this.roads > 0 ? { roads: this.roads } : {}), ...(this.dug > 0 ? { dug: this.dug } : {}), riders: this.riders, bestLevel: this.bestLevel, firstFlour: this.firstFlour, counts: [...this.counts], research: researchToJSON(this.research), regates: REGATES, ...(this.taken.length > 0 ? { taken: this.taken.map((t) => ({ ...t })) } : {}) };
  }

  /** From saved data; anything unknown or malformed is dropped. */
  static fromJSON(data: unknown): Progress {
    const p = new Progress();
    const d = data as Partial<ProgressData> | null;
    if (d && Array.isArray(d.owned)) {
      for (const e of d.owned) {
        if (!Array.isArray(e) || typeof e[0] !== "string" || !(e[0] in THING_RULES)) continue;
        const n = Number(e[1]);
        if (Number.isInteger(n) && n > 0) p.owned.set(e[0] as ThingId, n);
      }
    }
    // Blueprints renamed since (risers joined bridges, turning loops joined junctions) come back as what they became.
    const known = (t: unknown): string | null => (typeof t === "string" ? (techOf(RENAMED[t] ?? t) ? (RENAMED[t] ?? t) : null) : null);
    if (d && Array.isArray(d.learned)) for (const t of d.learned) if (known(t)) p.learned.add(known(t)!);
    // Things moved to a new blueprint since the save was written: it keeps them, its new blueprint learned with them.
    for (const t of regated(d)) p.learned.add(t);
    if (d && Array.isArray(d.offers)) {
      for (const o of d.offers) {
        const offer = offerFromJSON(o);
        if (offer) p.offers.push(offer);
        // (v12: blueprints and a crate, no cards. Its town's kept, to draw again.)
        else if (o && typeof o === "object" && !("cards" in o) && (Array.isArray((o as { ids?: unknown }).ids) || Array.isArray((o as { crate?: unknown }).crate))) {
          const from = (o as { from?: unknown }).from;
          p.oldOffers.push(typeof from === "string" ? from : "");
        }
      }
    }
    if (d && Array.isArray(d.orders)) for (const o of d.orders) if (typeof o === "string" && o in THING_RULES) p.orders.push(o as ThingId);
    p.making = !!d?.making && p.orders.length > 0;
    p.coins = Number.isInteger(d?.coins) && d!.coins! > 0 ? d!.coins! : 0;
    p.fieldsPlanted = Number.isInteger(d?.fieldsPlanted) && d!.fieldsPlanted! > 0 ? d!.fieldsPlanted! : 0;
    p.roads = Number.isInteger(d?.roads) && d!.roads! > 0 ? d!.roads! : 0;
    p.dug = Number.isInteger(d?.dug) && d!.dug! > 0 ? d!.dug! : 0;
    p.riders = Number.isInteger(d?.riders) && d!.riders! > 0 ? d!.riders! : 0;
    p.bestLevel = Number.isInteger(d?.bestLevel) && d!.bestLevel! > 0 ? d!.bestLevel! : 0;
    if (d && Array.isArray(d.counts)) for (const e of d.counts) if (Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1]) && e[1] > 0) p.counts.set(e[0], e[1]);
    // (A save from before the first-flour bonus: due only if no flour was delivered yet.)
    p.firstFlour = typeof d?.firstFlour === "boolean" ? d.firstFlour : (p.counts.get("delivered:flour") ?? 0) > 0;
    // Research: only blueprints still to learn.
    p.research = researchFromJSON(d?.research, (t) => (known(t) && !p.learned.has(known(t)!) ? known(t) : null), new Set(CARGO_KINDS));
    // (The queue in order, prerequisites first: one out of order moves back behind them, one without them is dropped.)
    repairQueue(p);
    if (d && Array.isArray(d.taken)) for (const t of d.taken) if (isTaken(t)) p.taken.push(t);
    return p;
  }
}

export type { Offer } from "./growth-cards";

export interface ProgressData {
  owned: [string, number][];
  learned: string[];
  offers?: unknown[];
  coins?: number;
  fieldsPlanted?: number;
  /** Road squares owned (absent: none beyond the map's lanes, covered on load). */
  roads?: number;
  dug?: number;
  riders?: number;
  bestLevel?: number;
  firstFlour?: boolean;
  counts?: [string, number][];
  orders?: string[];
  making?: boolean;
  research?: ResearchData;
  taken?: Taken[];
  /** How many of `REGATE_LIST`'s moves the save was written after (absent: none, an older save). */
  regates?: number;
}

/**
 * Things moved from one blueprint to a new one, in the order they were moved: a save written before a move, that had
 * learned a blueprint it moved from, gets the new one learned too, so nothing it could make goes away.
 */
export const REGATE_LIST: readonly { readonly from: readonly string[]; readonly to: string }[] = [
  // Tech tree 4: the signal box and lever frame, from the Scenery kit to Signal boxes.
  { from: ["scenery"], to: "signal-boxes" },
];
export const REGATES = REGATE_LIST.length;

/** The blueprints a save gets for the moves made since it was written (`REGATE_LIST`): none for a save written since. */
export function regated(d: Partial<ProgressData> | null | undefined): string[] {
  const seen = Number.isInteger(d?.regates) ? d!.regates! : 0;
  const learned = new Set(Array.isArray(d?.learned) ? d.learned : []);
  return REGATE_LIST.slice(seen).filter((g) => g.from.some((t) => learned.has(t))).map((g) => g.to);
}

/** A reward taken: its offer (town and level) and what it gave (coins, things, goods to research `to`). */
export interface Taken {
  from: string;
  level: number;
  coins?: number;
  owned?: [string, number][];
  goods?: [string, number][];
  to?: string;
}

/** How many rewards taken are kept (more than a session's worth between two syncs). */
export const TAKEN_KEPT = 12;

const isBag = (b: unknown) => b === undefined || (Array.isArray(b) && b.every((e) => Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1])));
export function isTaken(t: unknown): t is Taken {
  const x = t as Partial<Taken> | null;
  return !!x && typeof x.from === "string" && Number.isFinite(x.level) && (x.coins === undefined || Number.isFinite(x.coins)) && isBag(x.owned) && isBag(x.goods) && (x.to === undefined || typeof x.to === "string");
}

/** How many of a thing are on the map. */
export function inUse(world: World, id: ThingId): number {
  const kind = id.slice(0, id.indexOf(":")) as "piece" | "car" | "prop" | "look";
  const name = id.slice(id.indexOf(":") + 1);
  let n = 0;
  if (kind === "prop") {
    // The player's own: a town's buildings and dressing (`building` set) came with the map.
    for (const p of world.props.all()) if (p.asset === name && p.building === undefined) n++;
  } else if (kind === "piece") {
    for (const pid of world.layout.pieceIds()) if (world.layout.getPiece(pid)!.type === name) n++;
    // A generated depot isn't the player's: only count pieces they could have placed.
    if (name.startsWith("depot-")) for (const pid of world.depots.values()) if (world.layout.getPiece(pid)?.type === name) n--;
  } else if (kind === "look") {
    // (A train in that look: its engines in it, one each.)
    for (const tid of world.sim.trainIds()) for (const c of world.sim.getTrain(tid)!.cars) if (c.kind === "engine" && world.sim.lookOf(c.id) === name) n++;
  } else {
    for (const tid of world.sim.trainIds()) for (const c of world.sim.getTrain(tid)!.cars) if (c.kind === name) n++;
  }
  return n;
}
