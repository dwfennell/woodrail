import type { Bag } from "../economy/goods";
import { kindsOf, minus, total } from "../economy/goods";
import type { CargoKind } from "../economy/cargo";
import { LandEditor } from "../landscape/edit";
import type { Town } from "../landscape";
import { propsInRect } from "../props/placement";
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
    this.game.economy.accepts = (d, kind) => (d.role === "school" ? !!this.events.school?.(kind) : d.role !== "town" || this.wants(d.townId, kind) || LUXURIES.has(kind));
    for (const t of this.game.landscape.towns) {
      const received = receivedBy(this.game, t.id);
      this.levels.set(t.id, townStatus(received).level);
      this.had.set(t.id, received);
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
  }

  /** Does a town still want some of `kind` for its next level? (Cached per town until something more arrives.) */
  wants(townId: number, kind: CargoKind): boolean {
    const goods = this.game.economy.deliveredGoods.get(townId);
    const key = (this.game.economy.delivered.get(townId) ?? 0) + (goods ? total(goods) : 0);
    let s = this.statuses.get(townId);
    if (!s || s.key !== key) this.statuses.set(townId, (s = { key, status: townStatus(receivedBy(this.game, townId)) }));
    return (s.status.got[kind] ?? 0) < (s.status.wants[kind] ?? 0);
  }
  private readonly statuses = new Map<number, { key: number; status: TownStatus }>();

  /** Call each frame: cheap unless something was delivered. */
  update(): void {
    for (const town of this.game.landscape.towns) {
      const received = receivedBy(this.game, town.id);
      // Deliveries only add up: their total changes whenever anything arrives (any good, not just planks).
      const key = `${total(received)}`;
      if (this.shown.get(town.id) === key) continue;
      this.shown.set(town.id, key);
      const status = townStatus(received);
      const had = this.had.get(town.id);
      if (had) {
        const before = townStatus(had);
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
    return townStatus(receivedBy(this.game, townId));
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
      const slots = buildOnLots(g.landscape, town, lots);
      // A building that changed (a house that's now a shop, or has a second floor) is dressed again.
      const changed = new Set(changedBuildings(lots));
      for (const p of [...g.props.all()]) if (p.building !== undefined && changed.has(p.building)) g.props.remove(p.id);
      // New buildings in the styles of the town's size now (`extraStyles`).
      addTownProps(g.landscape, g.props, (id) => this.levels.get(id) ?? 0);
      g.editLand(slots);
    }
    // Its houses grow upward, the centre most (issue #17): only this town's props whose storeys change are redrawn.
    const taller = setTownStoreys(g.landscape, town, g.props, status.level);
    if (lots.length > 0 || taller > 0) g.propsChanged();
    this.events.grew(
      town,
      status,
      lots.map((l) => lotPoint(g.landscape, l)),
    );
  }
}
