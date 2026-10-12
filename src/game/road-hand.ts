import type { Group } from "three";
import type { Editor } from "../editor/editor";
import { CELL, FEAT_TREE, SURF_LANE, type LandscapeGrid } from "../landscape";
import { plotSlotOf } from "../landscape/edit";
import { propsInRect } from "../props/placement";
import { roadPieceGroup, roadMaterials } from "../render/dressing/roads";
import { FootprintOutline } from "../render/props/outline";
import { distinctTurns, encodeRoad, pieceOf, ROAD_MESSAGES, RoadPlacer, setRoadSquare, turnOf, type RoadBlock, type RoadPieceId } from "../roads";
import type { Hud } from "../ui/hud";
import type { Game } from "./game";

/** A road piece in the hand: new from the tray, or picked up off its square (`from`). */
export interface RoadDrag {
  piece: RoadPieceId;
  /** Quarter turns as held (snapping may turn it to join the roads beside it). */
  held: number;
  from: { cell: number; road: number } | null;
  /** The square it would go on (−1: none), and as what. */
  cell: number;
  road: number;
  blocked: RoadBlock | null;
  ghost: Group | null;
  ghostRoad: number;
  placer: RoadPlacer;
  overTray: boolean;
}

const OK = "#7ddc58";
const NO = "#ff4a3a";
/** How high a held piece floats above its square (mm). */
const LIFT = 6;

/**
 * Laying road pieces: a piece in the hand snaps to the square under the pointer and turns to join the roads beside
 * it; a placed piece can be selected, turned, picked up and moved, or put back in the tray. Every change is one undo
 * step (`Editor.editRoads`). Town streets are read-only: never picked, never replaced.
 */
export class RoadHand {
  readonly outline = new FootprintOutline();
  /** The selected road square, or −1. */
  selected = -1;

  constructor(
    private readonly game: Game,
    private readonly hud: Hud,
    private readonly editor: () => Editor,
    private readonly onRefused: () => void,
    private readonly onPlaced: () => void,
  ) {
    game.scene.add(this.outline.line);
  }

  private get grid(): LandscapeGrid {
    return this.game.landscape.grid;
  }

  /** Is there a road piece the player may pick up on square `i`? (Not a town street.) */
  pickable(i: number): boolean {
    return i !== -1 && this.grid.road[i] !== 0 && this.grid.surface[i] === SURF_LANE;
  }

  private placer(): RoadPlacer {
    const g = this.game;
    return new RoadPlacer(g.landscape, g.layout, { inRect: (x0, z0, x1, z1) => propsInRect(g.props, g.propLibrary.footprint, x0, z0, x1, z1) });
  }

  /** Take a new piece from the tray, held at quarter turn `held`. */
  begin(piece: RoadPieceId, held: number): RoadDrag {
    this.clear();
    return { piece, held: held & 3, from: null, cell: -1, road: 0, blocked: null, ghost: null, ghostRoad: 0, placer: this.placer(), overTray: true };
  }

  /** Pick up the piece on square `cell` (selected first): it leaves its square (for now) and goes in the hand. */
  pickUp(cell: number): RoadDrag | null {
    if (!this.pickable(cell)) return null;
    const road = this.grid.road[cell];
    const def = pieceOf(road)!;
    this.clear();
    this.hud.hideCards();
    this.lift(cell, 0);
    return { piece: def.id, held: turnOf(road), from: { cell, road }, cell: -1, road, blocked: null, ghost: null, ghostRoad: 0, placer: this.placer(), overTray: false };
  }

  /** Set a square's piece outside the undo history (a piece held in the hand), and redraw it. */
  private lift(cell: number, road: number): void {
    this.grid.setRoad(cell, road);
    this.game.roadsEdited([plotSlotOf(cell)], false);
  }

  /** A moved piece back on its square as it was, before the edit that moves it is recorded. */
  private putBack(d: RoadDrag): void {
    if (d.from) this.lift(d.from.cell, d.from.road);
  }

  /** The hand is over square `cell` (−1: off the land), or over the tray. Cheap: a few square lookups. */
  update(d: RoadDrag, cell: number, overTray: boolean): void {
    d.overTray = overTray;
    if (overTray || cell === -1) {
      d.cell = -1;
      this.showGhost(d);
      this.outline.hide();
      this.game.invalidate();
      return;
    }
    const moved = cell !== d.cell;
    d.cell = cell;
    d.road = d.placer.fit(d.piece, cell, d.held);
    const blocked = d.placer.check(cell, d.road);
    if (blocked && blocked !== d.blocked && moved) this.hud.toast(ROAD_MESSAGES[blocked]);
    d.blocked = blocked;
    this.showGhost(d);
    this.showSquare(cell, blocked ? NO : OK);
    this.game.invalidate();
  }

  /** Turn the piece in the hand a quarter (to the next turn that looks different). */
  turnHeld(d: RoadDrag): void {
    const turns = distinctTurns(d.piece);
    const k = turns.indexOf(turnOf(d.road || encodeRoad(d.piece, d.held)));
    d.held = turns[(k + 1) % turns.length];
    // Held as turned, not re-fitted: the player chose it.
    if (d.cell !== -1) {
      d.road = encodeRoad(d.piece, d.held);
      d.blocked = d.placer.check(d.cell, d.road);
      this.showSquare(d.cell, d.blocked ? NO : OK);
      this.showGhost(d);
      this.game.invalidate();
    }
  }

  /** Let go: put the piece down, or back in the tray, or refuse. */
  drop(d: RoadDrag): void {
    this.removeGhost(d);
    this.outline.hide();
    this.putBack(d);
    if (d.overTray || d.cell === -1) {
      // Back in the box: a moved piece is taken away (undoably), a new one never was.
      if (d.from) this.edit([[d.from.cell, 0]]);
      this.game.invalidate();
      return;
    }
    if (d.blocked) {
      this.onRefused();
      if (d.from) this.select(d.from.cell);
      this.game.invalidate();
      return;
    }
    const changes: [number, number][] = [];
    if (d.from && d.from.cell !== d.cell) changes.push([d.from.cell, 0]);
    changes.push([d.cell, d.road]);
    this.edit(changes);
    this.onPlaced();
    // It stays selected, to turn again straight away.
    this.select(d.cell);
  }

  cancel(d: RoadDrag): void {
    this.putBack(d);
    this.removeGhost(d);
    this.outline.hide();
    this.game.invalidate();
  }

  select(cell: number): void {
    if (!this.pickable(cell)) return;
    this.selected = cell;
    this.showSquare(cell, "#fff2d8");
    this.hud.showPieceCard(false, pieceOf(this.grid.road[cell])!.name, false);
    this.game.invalidate();
  }

  clear(): void {
    if (this.selected === -1) return;
    this.selected = -1;
    this.outline.hide();
    this.game.invalidate();
  }

  /** Turn the selected piece a quarter (to its next distinct turn). */
  turnSelected(): void {
    const i = this.selected;
    if (!this.pickable(i)) return;
    const road = this.grid.road[i];
    const def = pieceOf(road)!;
    const turns = distinctTurns(def.id);
    const next = encodeRoad(def.id, turns[(turns.indexOf(turnOf(road)) + 1) % turns.length]);
    // Turned, it must still let any track over it cross straight over.
    const why = this.placer().check(i, next);
    if (why) {
      this.hud.toast(ROAD_MESSAGES[why]);
      this.onRefused();
      return;
    }
    this.edit([[i, next]]);
    this.select(i);
  }

  removeSelected(): void {
    const i = this.selected;
    if (!this.pickable(i)) return;
    this.clear();
    this.hud.hideCards();
    this.edit([[i, 0]]);
  }

  /** Set squares' road pieces as one undo step. */
  private edit(changes: readonly [number, number][]): void {
    const g = this.grid;
    const slots = [...new Set(changes.map(([i]) => plotSlotOf(i)))];
    const trees = changes.some(([i]) => g.feature[i] === FEAT_TREE);
    let restore: (() => void)[] = [];
    this.editor().editRoads({
      do: () => {
        restore = changes.map(([i, road]) => setRoadSquare(g, i, road));
      },
      undo: () => {
        for (let k = restore.length - 1; k >= 0; k--) restore[k]();
      },
      slots,
      trees,
    });
  }

  private showSquare(cell: number, color: string): void {
    const g = this.grid;
    const x = g.centreX(g.colOf(cell));
    const z = g.centreZ(g.rowOf(cell));
    this.outline.show({ cx: 0, cz: 0, hw: CELL / 2 - 2, hd: CELL / 2 - 2 }, x, g.groundY(cell) + 5, z, 0, color);
  }

  private showGhost(d: RoadDrag): void {
    if (d.cell === -1) {
      if (d.ghost) d.ghost.visible = false;
      return;
    }
    if (!d.ghost || d.ghostRoad !== d.road) {
      this.removeGhost(d);
      d.ghost = roadPieceGroup(d.road, roadMaterials(this.game.mats));
      d.ghostRoad = d.road;
      this.game.scene.add(d.ghost);
    }
    const g = this.grid;
    d.ghost.visible = true;
    d.ghost.position.set(g.centreX(g.colOf(d.cell)), g.groundY(d.cell) + LIFT, g.centreZ(g.rowOf(d.cell)));
    this.game.moveShadows();
  }

  private removeGhost(d: RoadDrag): void {
    if (!d.ghost) return;
    this.game.scene.remove(d.ghost);
    d.ghost.traverse((o) => (o as { geometry?: { dispose(): void } }).geometry?.dispose());
    d.ghost = null;
  }
}
