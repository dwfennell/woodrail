import type { Bag } from "../economy/goods";
import { kindsOf, minus, plus, total } from "../economy/goods";
import type { CargoKind } from "../economy/cargo";
import type { DepotState } from "../economy";
import { LandEditor } from "../landscape/edit";
import type { Town } from "../landscape";
import { propsInRect } from "../props/placement";
import { joinedByRoad } from "../roads/graph";
import { addTownProps, setTownStoreys } from "../props/towns";
import type { SignBadge } from "../render/landscape-view";
import type { Footprint } from "../props/placement";
import type { PropStore } from "../props/store";
import { buildOnLots, changedBuildings, lotPoint, nextLots } from "./town-growth";
import { dueLandmarks } from "./landmarks";
import { housesBy, LUXURIES, townStatus, type TownStatus } from "./towns";
import type { World } from "./world";

/** Everything a town has received, by kind. */
export function receivedBy(world: World, townId: number): Bag {
  // Planks from `delivered` (saves from before goods were counted by kind have only that).
  return { ...world.economy.deliveredGoods.get(townId), planks: world.economy.delivered.get(townId) ?? 0 };
}

/**
 * Linked towns (roads spec D2): of what a town receives while it's joined by road to another town (`Economy.roadGot`),
 * one in this many counts twice toward its growth, so it wants about a tenth less to grow. Credited as the goods
 * arrive and never taken back: a road taken up later doesn't shrink a town.
 */
export const ROAD_BONUS_EVERY = 9;

/** What a town's road has added toward its growth, by kind (see `ROAD_BONUS_EVERY`). */
export function roadBonus(world: World, townId: number): Bag {
  const got = world.economy.roadGot.get(townId);
  const out: Bag = {};
  if (got) for (const k of kindsOf(got)) if (got[k]! >= ROAD_BONUS_EVERY) out[k] = Math.floor(got[k]! / ROAD_BONUS_EVERY);
  return out;
}

/** What counts toward a town's growth: everything it received, and its road's bonus. Its level is `townStatus` of it. */
export function growthOf(world: World, townId: number): Bag {
  const received = receivedBy(world, townId);
  const bonus = roadBonus(world, townId);
  for (const k of kindsOf(bonus)) received[k] = (received[k] ?? 0) + bonus[k]!;
  return received;
}

/** The badge a town's sign shows in Game mode: the first thing it still wants, and how far along it is. */
export function needBadge(status: TownStatus): SignBadge | null {
  const kinds = kindsOf(status.wants);
  const kind = kinds.find((k) => (status.got[k] ?? 0) < status.wants[k]!) ?? kinds[0];
  if (!kind) return null;
  return { wants: kind, got: status.got[kind] ?? 0, of: status.wants[kind]! };
}

/**
 * What TownLife needs of the game: the world it changes, and how to redraw what it changed. The Game is one; a
 * headless playthrough (tests) is another.
 */
export interface TownLifeHost extends World {
  props: PropStore;
  /** Catalogue models' footprints, so growth keeps clear of placed models (none known: nothing in the way). */
  footprintOf(asset: string): Footprint | undefined;
  /** Squares changed in these plots: redraw them. */
  editLand(slots: readonly number[]): void;
  propsChanged(): void;
  setSignBadge(townId: number, badge: SignBadge | null): void;
}

export interface TownLifeEvents {
  /** A town grew a level: where its new buildings went (none if it had no room). */
  grew(town: Town, status: TownStatus, built: { x: number; z: number }[]): void;
  /** Goods reached a town in play (not on loading): `n` units of `kind`, with the town as it was before them. */
  received(town: Town, kind: CargoKind, n: number, before: TownStatus): void;
  /** Is this blueprint learned? (A landmark that comes with one waits for it.) */
  knows?(tech: string): boolean;
  /** Does a school take `kind` from trains now (the research still lacks some)? A lookup: the crane asks per unit. */
  school?(kind: CargoKind): boolean;
  /**
   * Does station `d`'s delivery van take `kind` now, for the town off the line it serves (roads spec D5:
   * `DeliveryVans.takes`)? The station takes it from trains though its own town doesn't want it, onto the van's yard.
   */
  vanTakes?(d: DepotState, kind: CargoKind): boolean;
  /** Goods went on station `d`'s van yard (its van loads up and goes). */
  vanYard?(d: DepotState): void;
  /**
   * A unit both station `d`'s own town and its van want: is it the van's turn? (Every other one: `DeliveryVans.share`.)
   * Asked once per unit as it lands.
   */
  vanShare?(d: DepotState): boolean;
}

/**
 * Game mode's towns, in play: each grows when it has received what it wants, putting up new buildings, and its sign
 * shows what it wants now. Levels are worked out from what was received (nothing else is saved); a town grows only
 * on a delivery seen in play, never on loading.
 */
export class TownLife {
  /** Each town's level when last looked at. */
  private levels = new Map<number, number>();
  /** What each town had received when last looked at. */
  private had = new Map<number, Bag>();
  /** What each sign shows now (a key), so an unchanged frame repaints nothing. */
  private shown = new Map<number, string>();

  constructor(
    private readonly game: TownLifeHost,
    private readonly events: TownLifeEvents,
  ) {}

  /** A world was loaded or a mode entered: take the towns as they are, and show their needs. */
  reset(): void {
    this.levels.clear();
    this.shown.clear();
    this.statuses.clear();
    // A town takes from trains only what it still wants for its next level: the rest rides on to the next town.
    // (Made goods, furniture and tools, are always welcome: towns pay for them, wanted or not.)
    // A school takes only what its research still lacks (`TownLifeEvents.school`; none: nothing).
    this.game.economy.accepts = (d, kind) => (d.role === "school" ? !!this.events.school?.(kind) : d.role !== "town" || this.wants(d.townId, kind) || LUXURIES.has(kind) || !!this.events.vanTakes?.(d, kind));
    // A good its delivery van takes goes on the van's yard (roads spec D5): all of it if its own town doesn't want it,
    // else every other unit (the station shares with the town off the line, as a school shares a load).
    this.game.economy.toVan = this.events.vanTakes
      ? (d, kind) => !!this.events.vanTakes?.(d, kind) && (!(this.wants(d.townId, kind) || LUXURIES.has(kind)) || !!this.events.vanShare?.(d))
      : null;
    this.game.economy.onVanYard = this.events.vanYard ? (d) => this.events.vanYard?.(d) : null;
    // A town joined by road to another counts some of what it receives twice toward growing (roads spec D2).
    this.game.economy.joinedByRoad = (townId) => joinedByRoad(this.game.landscape, townId);
    for (const t of this.game.landscape.towns) {
      this.levels.set(t.id, townStatus(growthOf(this.game, t.id)).level);
      this.had.set(t.id, receivedBy(this.game, t.id));
    }
    // Its houses as tall as its size (a save from before towns grew upward: they rise now; else nothing changes).
    let taller = 0;
    for (const t of this.game.landscape.towns) taller += setTownStoreys(this.game.landscape, t, this.game.props, this.levels.get(t.id) ?? 0);
    if (taller > 0) this.game.propsChanged();
    this.update();
  }

  /** Signs off: back to Sandbox's plain names and counts. */
  clear(): void {
    for (const t of this.game.landscape.towns) this.game.setSignBadge(t.id, null);
    this.shown.clear();
    this.game.economy.accepts = null;
    this.game.economy.toVan = null;
    this.game.economy.onVanYard = null;
    this.game.economy.joinedByRoad = null;
  }

  /** Does a town still want some of `kind` for its next level? (Cached per town until something more arrives.) */
  wants(townId: number, kind: CargoKind): boolean {
    const goods = this.game.economy.deliveredGoods.get(townId);
    const road = this.game.economy.roadGot.get(townId);
    const key = (this.game.economy.delivered.get(townId) ?? 0) + (goods ? total(goods) : 0) + (road ? total(road) : 0);
    let s = this.statuses.get(townId);
    if (!s || s.key !== key) this.statuses.set(townId, (s = { key, status: townStatus(growthOf(this.game, townId)) }));
    return (s.status.got[kind] ?? 0) < (s.status.wants[kind] ?? 0);
  }
  private readonly statuses = new Map<number, { key: number; status: TownStatus }>();

  /** How many more of `kind` a town wants for its next level (0: none). Cached as `wants` is. */
  lacks(townId: number, kind: CargoKind): number {
    if (!this.wants(townId, kind)) return 0;
    const s = this.statuses.get(townId)!.status;
    return (s.wants[kind] ?? 0) - (s.got[kind] ?? 0);
  }

  /** Call each frame: cheap unless something was delivered. */
  update(): void {
    for (const town of this.game.landscape.towns) {
      const received = receivedBy(this.game, town.id);
      // Deliveries only add up: their total changes whenever anything arrives (any good, not just planks).
      const key = `${total(received)}`;
      if (this.shown.get(town.id) === key) continue;
      this.shown.set(town.id, key);
      // (Its level from what it received and its road's bonus; what's said to have arrived is only what did.)
      const bonus = roadBonus(this.game, town.id);
      const status = townStatus(growthOf(this.game, town.id));
      const had = this.had.get(town.id);
      if (had) {
        const before = townStatus(plus(had, bonus));
        for (const k of kindsOf(minus(received, had))) this.events.received(town, k, received[k]! - (had[k] ?? 0), before);
      }
      this.had.set(town.id, received);
      const was = this.levels.get(town.id) ?? status.level;
      this.levels.set(town.id, status.level);
      if (status.level > was) this.grow(town, was, status);
      this.game.setSignBadge(town.id, needBadge(status));
    }
  }

  /** What a town is now (for the map view and cards). */
  status(townId: number): TownStatus {
    return townStatus(growthOf(this.game, townId));
  }

  private grow(town: Town, from: number, status: TownStatus): void {
    const g = this.game;
    const houses = housesBy(status.level) - housesBy(from);
    const editor = new LandEditor(g.landscape, g.layout, { inRect: (x0, z0, x1, z1) => propsInRect(g.props, (a) => g.footprintOf(a), x0, z0, x1, z1) });
    // Its landmarks go up as it reaches their levels (every one it hasn't got, if it grew by more than one): each on a
    // lot of its own, a two-square one if there is one (they're big buildings), so ask for that many.
    // The biggest (with 2×2 models) take a 2×2 block where there's room, first.
    const due = dueLandmarks(g.landscape, town, status.level, (t) => this.events.knows?.(t) ?? false);
    const big = due.filter((m) => m.models.four?.length);
    const lots = nextLots(g.landscape, town, editor, houses, { wide: due.length, big: big.length });
    for (const mark of [...big, ...due.filter((m) => !big.includes(m))]) {
      const free = lots.filter((l) => !l.landmark);
      const of = (n: number) => free.find((l) => l.cells.length === n);
      // One that comes with a blueprint has a big building of its own: it waits for two squares or more
      // (here when it next grows, or in the next town to grow).
      const lot = (big.includes(mark) ? of(4) : undefined) ?? of(2) ?? (mark.tech ? of(4) : free.find((l) => l.cells.length < 4) ?? free[0]);
      if (lot) lot.landmark = mark.id;
    }
    if (lots.length > 0) {
      const slots = buildOnLots(g.landscape, town, lots, status.level);
      // A building that changed (a house that's now a shop, or has a second floor) is dressed again.
      const changed = new Set(changedBuildings(lots));
      for (const p of [...g.props.all()]) if (p.building !== undefined && changed.has(p.building)) g.props.remove(p.id);
      // New buildings in the styles of the town's size now (`extraStyles`).
      addTownProps(g.landscape, g.props, (id) => this.levels.get(id) ?? 0);
      g.editLand(slots);
    }
    // Some of its houses grow upward, the middle most, the edge and the new ones staying single-storey (issue #17):
    // only this town's props whose storeys change are redrawn.
    const taller = setTownStoreys(g.landscape, town, g.props, status.level);
    if (lots.length > 0 || taller > 0) g.propsChanged();
    this.events.grew(
      town,
      status,
      lots.map((l) => lotPoint(g.landscape, l)),
    );
  }
}
