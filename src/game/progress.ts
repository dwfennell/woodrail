import { STARTING_BOARD, techOf } from "./tech";
import { isFree, ruleOf, STARTING_BOX, THING_RULES, type ThingId } from "./things";
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
  /** Choices waiting: two blueprints a town offered when it grew (one is learned free). */
  readonly offers: { from: string; ids: string[] }[] = [];
  /** The workshop's orders, in order (see `Crafting`). */
  readonly orders: ThingId[] = [];
  /** The first order's goods are taken and it's being made. */
  making = false;

  /** A new game: the starting box. */
  static fresh(): Progress {
    const p = new Progress();
    for (const [id, n] of Object.entries(STARTING_BOX) as [ThingId, number][]) p.owned.set(id, n);
    for (const t of STARTING_BOARD) p.board.add(t);
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

  /** Can all of these go on the map now? Returns the first thing short, or null. */
  short(world: World, needs: ReadonlyMap<ThingId, number>): ThingId | null {
    for (const [id, n] of needs) if (!isFree(id) && (!this.knows(id) || this.available(world, id) < n)) return id;
    return null;
  }

  add(id: ThingId, n = 1): void {
    this.owned.set(id, (this.owned.get(id) ?? 0) + n);
  }

  /** Never own less than is on the map (a save from before the toy box, or a hand-edited one). */
  coverMap(world: World): void {
    for (const id of Object.keys(THING_RULES) as ThingId[]) {
      const n = inUse(world, id);
      if (n > (this.owned.get(id) ?? 0)) this.owned.set(id, n);
    }
  }

  toJSON(): ProgressData {
    return { owned: [...this.owned], learned: [...this.learned], board: [...this.board], offers: this.offers.map((o) => ({ from: o.from, ids: [...o.ids] })), orders: [...this.orders], making: this.making };
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
    if (d && Array.isArray(d.learned)) for (const t of d.learned) if (typeof t === "string" && techOf(t)) p.learned.add(t);
    if (d && Array.isArray(d.board)) for (const t of d.board) if (typeof t === "string" && techOf(t)) p.board.add(t);
    if (d && Array.isArray(d.offers)) {
      for (const o of d.offers) {
        const ids = Array.isArray(o?.ids) ? o.ids.filter((t): t is string => typeof t === "string" && !!techOf(t)) : [];
        if (ids.length > 0) p.offers.push({ from: typeof o.from === "string" ? o.from : "", ids });
      }
    }
    if (d && Array.isArray(d.orders)) for (const o of d.orders) if (typeof o === "string" && o in THING_RULES) p.orders.push(o as ThingId);
    p.making = !!d?.making && p.orders.length > 0;
    return p;
  }
}

export interface ProgressData {
  owned: [string, number][];
  learned: string[];
  board?: string[];
  offers?: { from: string; ids: string[] }[];
  orders?: string[];
  making?: boolean;
}

/** How many of a thing are on the map. */
export function inUse(world: World, id: ThingId): number {
  const [kind, name] = id.split(":") as ["piece" | "car", string];
  let n = 0;
  if (kind === "piece") {
    for (const pid of world.layout.pieceIds()) if (world.layout.getPiece(pid)!.type === name) n++;
    // A generated depot isn't the player's: only count pieces they could have placed.
    if (name.startsWith("depot-")) for (const pid of world.depots.values()) if (world.layout.getPiece(pid)?.type === name) n--;
  } else {
    for (const tid of world.sim.trainIds()) for (const c of world.sim.getTrain(tid)!.cars) if (c.kind === name) n++;
  }
  return n;
}
