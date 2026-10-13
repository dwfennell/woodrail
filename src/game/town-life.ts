import type { Bag } from "../economy/goods";
import { kindsOf } from "../economy/goods";
import { LandEditor } from "../landscape/edit";
import type { Town } from "../landscape";
import { propsInRect } from "../props/placement";
import { addTownProps } from "../props/towns";
import type { SignBadge } from "../render/landscape-view";
import type { Game } from "./game";
import { buildOnLots, lotPoint, nextLots } from "./town-growth";
import { housesBy, townStatus, type TownStatus } from "./towns";
import type { World } from "./world";

/** Everything a town has received, by kind. */
export function receivedBy(world: World, townId: number): Bag {
  return { planks: world.economy.delivered.get(townId) ?? 0 };
}

/** The badge a town's sign shows in Game mode: the first thing it wants, and how far along it is. */
export function needBadge(status: TownStatus): SignBadge | null {
  const [kind] = kindsOf(status.wants);
  if (!kind) return null;
  return { wants: kind, got: status.got[kind] ?? 0, of: status.wants[kind]! };
}

export interface TownLifeEvents {
  /** A town grew a level: where its new buildings went (none if it had no room). */
  grew(town: Town, status: TownStatus, built: { x: number; z: number }[]): void;
}

/**
 * Game mode's towns, in play: each grows when it has received what it wants, putting up new buildings, and its sign
 * shows what it wants now. Levels are worked out from what was received (nothing else is saved); a town grows only
 * on a delivery seen in play, never on loading.
 */
export class TownLife {
  /** Each town's level when last looked at. */
  private levels = new Map<number, number>();
  /** What each sign shows now (a key), so an unchanged frame repaints nothing. */
  private shown = new Map<number, string>();

  constructor(
    private readonly game: Game,
    private readonly events: TownLifeEvents,
  ) {}

  /** A world was loaded or a mode entered: take the towns as they are, and show their needs. */
  reset(): void {
    this.levels.clear();
    this.shown.clear();
    for (const t of this.game.landscape.towns) this.levels.set(t.id, townStatus(receivedBy(this.game, t.id)).level);
    this.update();
  }

  /** Signs off: back to Sandbox's plain names and counts. */
  clear(): void {
    for (const t of this.game.landscape.towns) this.game.landscapeView.setSignBadge(t.id, null);
    this.shown.clear();
  }

  /** Call each frame: cheap unless something was delivered. */
  update(): void {
    for (const town of this.game.landscape.towns) {
      const received = receivedBy(this.game, town.id);
      const key = `${received.planks}`;
      if (this.shown.get(town.id) === key) continue;
      this.shown.set(town.id, key);
      const status = townStatus(received);
      const was = this.levels.get(town.id) ?? status.level;
      this.levels.set(town.id, status.level);
      if (status.level > was) this.grow(town, was, status);
      this.game.landscapeView.setSignBadge(town.id, needBadge(status));
    }
  }

  /** What a town is now (for the map view and cards). */
  status(townId: number): TownStatus {
    return townStatus(receivedBy(this.game, townId));
  }

  private grow(town: Town, from: number, status: TownStatus): void {
    const g = this.game;
    const houses = housesBy(status.level) - housesBy(from);
    const editor = new LandEditor(g.landscape, g.layout, { inRect: (x0, z0, x1, z1) => propsInRect(g.props, g.propLibrary.footprint, x0, z0, x1, z1) });
    const lots = nextLots(g.landscape, town, editor, houses);
    if (lots.length > 0) {
      const slots = buildOnLots(g.landscape, town, lots);
      addTownProps(g.landscape, g.props);
      g.editLand(slots);
      g.propsChanged();
    }
    this.events.grew(
      town,
      status,
      lots.map((l) => lotPoint(g.landscape, l)),
    );
  }
}
