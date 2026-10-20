import { CARGO_KINDS } from "../economy/cargo";
import { RENAMED } from "./blueprints";
import { offerFromJSON, offerToJSON, type Offer } from "./growth-cards";
import { newResearch, researchFromJSON, researchToJSON, type Research, type ResearchData } from "./research";
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
  /** Blueprints on the board, to be learned with goods (see `tech.ts`). */
  readonly board = new Set<string>();
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
  /** Fields planted with coins (each dearer than the last: see `fieldPrice`). */
  fieldsPlanted = 0;
  /** People carried to another town by coach, all game (they unlock the passenger line of blueprints). */
  riders = 0;
  /** The landmarks your towns have (a school, a market, a library): from the map, not saved (see `landmarksOf`). */
  readonly landmarks = new Set<string>();
  /** What the schools are researching (see `research.ts`). */
  research: Research = newResearch();

  /**
   * A new game: the starting box. (No starting board: any blueprint ready to learn can be picked for research.)
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

  toJSON(): ProgressData {
    return { owned: [...this.owned], learned: [...this.learned], board: [...this.board], offers: [...this.offers.map(offerToJSON), ...this.oldOffers.map((from) => ({ from, ids: [] }))], coins: this.coins, orders: [...this.orders], making: this.making, fieldsPlanted: this.fieldsPlanted, riders: this.riders, bestLevel: this.bestLevel, counts: [...this.counts], research: researchToJSON(this.research) };
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
    if (d && Array.isArray(d.board)) for (const t of d.board) if (known(t) && !p.learned.has(known(t)!)) p.board.add(known(t)!);
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
    p.riders = Number.isInteger(d?.riders) && d!.riders! > 0 ? d!.riders! : 0;
    p.bestLevel = Number.isInteger(d?.bestLevel) && d!.bestLevel! > 0 ? d!.bestLevel! : 0;
    if (d && Array.isArray(d.counts)) for (const e of d.counts) if (Array.isArray(e) && typeof e[0] === "string" && Number.isFinite(e[1]) && e[1] > 0) p.counts.set(e[0], e[1]);
    // Research: only blueprints still to learn.
    p.research = researchFromJSON(d?.research, (t) => (known(t) && !p.learned.has(known(t)!) ? known(t) : null), new Set(CARGO_KINDS));
    return p;
  }
}

export type { Offer } from "./growth-cards";

export interface ProgressData {
  owned: [string, number][];
  learned: string[];
  board?: string[];
  offers?: unknown[];
  coins?: number;
  fieldsPlanted?: number;
  riders?: number;
  bestLevel?: number;
  counts?: [string, number][];
  orders?: string[];
  making?: boolean;
  research?: ResearchData;
}

/** How many of a thing are on the map. */
export function inUse(world: World, id: ThingId): number {
  const kind = id.slice(0, id.indexOf(":")) as "piece" | "car" | "prop";
  const name = id.slice(id.indexOf(":") + 1);
  let n = 0;
  if (kind === "prop") {
    // The player's own: a town's buildings and dressing (`building` set) came with the map.
    for (const p of world.props.all()) if (p.asset === name && p.building === undefined) n++;
  } else if (kind === "piece") {
    for (const pid of world.layout.pieceIds()) if (world.layout.getPiece(pid)!.type === name) n++;
    // A generated depot isn't the player's: only count pieces they could have placed.
    if (name.startsWith("depot-")) for (const pid of world.depots.values()) if (world.layout.getPiece(pid)?.type === name) n--;
  } else {
    for (const tid of world.sim.trainIds()) for (const c of world.sim.getTrain(tid)!.cars) if (c.kind === name) n++;
  }
  return n;
}
