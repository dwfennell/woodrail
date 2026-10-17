import type { DepotRole } from "../economy";
import type { PieceDef, PieceTypeId } from "./pieces";
import { straight } from "./shapes";

/**
 * Kit pieces: track props that trains really use (see docs/superpowers/specs/2026-10-17-track-props-design.md). A kit
 * is a piece like any other (its track is in the layout, has joints, is saved with the pieces and undone by the
 * editor), with a catalogue model drawn on it (`KitView`), ground it needs clear beside it (`checkYard`), and, if it
 * says so, a stop for trains (`Economy`).
 *
 * Piece-local coordinates throughout: t along the track from its first end (connector 0), l across it (+l to the
 * left, looking along the track), as depots lay out their yards (`DEPOT_LAYOUT`).
 */

/** A rectangle in a piece's own frame: its centre (t along, l across) and its size (w along, d across), in mm. */
export interface KitRect {
  readonly t: number;
  readonly l: number;
  readonly w: number;
  readonly d: number;
}

/** Which trains stop at a kit: those with passenger cars, those with a steam engine, or any powered train. */
export type KitStopWho = "passengers" | "steam" | "any";

export interface KitDef {
  /** The catalogue model drawn for it (its own track slabs left out: real track is drawn under it). */
  readonly asset: string;
  /** What it's called in messages, lower case ("The platform needs open ground", "That's the platform"). */
  readonly name: string;
  /** Its track: connectors and paths, built with the same helpers as pieces (straight, curve, buffer ends). */
  readonly track: PieceDef;
  /** Who draws the rails: the ordinary track (most kits), or the model itself (bridges, tunnels, the turntable deck). */
  readonly rails: "track" | "model";
  /**
   * Where the asset stands in the piece's frame: its origin at (t, l), turned `turn` radians about the vertical (as
   * three.js turns, so π puts the model's +z on the piece's −l side). Default: the middle of the track, unturned (an
   * asset authored round its own slab of track).
   */
  readonly place?: { readonly t: number; readonly l: number; readonly turn?: number };
  /** Ground it needs clear, in piece-local t/l rectangles (stations' platforms, cranes' legs, a shed's walls). */
  readonly footprint: readonly KitRect[];
  /** Can be dropped onto a run of straights to take its place, like a depot (single path, length a multiple of 54). */
  readonly splices?: boolean;
  /**
   * Trains stop here: `at` mm along its path from the end the train comes in by (where the train's front halts), for
   * `seconds` (game time), and which trains. Put `at` past a train's braking distance (about 30 mm at full speed).
   */
  readonly stop?: { readonly at: number; readonly seconds: number; readonly who: KitStopWho };
  /** It's a cargo stop: registered as an economy depot of this role, so cranes load and unload as at a depot. (Phase 1.) */
  readonly depot?: DepotRole;
  /**
   * When its model moves: while a train is on it, while one is stopped at it, or when its state changes. (Phase 1:
   * see `KitView.moving`, the hook for it.)
   */
  readonly moves?: "occupied" | "stopped" | "state";
}

/** Kit piece types: `kit-` and the asset's name without its catalogue prefix. */
export type KitTypeId = `kit-${string}`;

/** The furnished platform's depth across, and how far off the track's edge it stands (mm). */
const PLATFORM_DEPTH = 26;
const PLATFORM_GAP = 1;
/** The track's half width (mm): its edge is this far from its centre line. */
const TRACK_HALF = 20;

/** Every kit, by piece type. */
export const KITS: Readonly<Record<KitTypeId, KitDef>> = {
  // A 216 straight with the furnished platform along its left (+l) side: passenger trains stop at it for 4 s.
  "kit-platform-furnished": {
    asset: "bldg-platform-furnished",
    name: "platform",
    track: straight("kit-platform-furnished", 216),
    rails: "track",
    // The model is a platform 216 long, centred on its origin, its edge line on its +z side: turned round, so that
    // edge faces the track, and set beside it.
    place: { t: 108, l: TRACK_HALF + PLATFORM_GAP + PLATFORM_DEPTH / 2, turn: Math.PI },
    footprint: [{ t: 108, l: TRACK_HALF + PLATFORM_GAP + PLATFORM_DEPTH / 2, w: 216, d: PLATFORM_DEPTH + 2 }],
    splices: true,
    stop: { at: 196, seconds: 4, who: "passengers" },
  },
};

const byType = new Map<string, KitDef>(Object.entries(KITS));

/** The kit a piece type is, or undefined (a map lookup: cheap enough for every piece on every move). */
export const kitOf = (type: PieceTypeId): KitDef | undefined => byType.get(type);

/** Is this piece type a kit? */
export const isKit = (type: PieceTypeId): type is KitTypeId => byType.has(type);

/** The kit piece types, in the order they're listed. */
export const KIT_TYPES = Object.keys(KITS) as readonly KitTypeId[];

/** The kit that draws this catalogue asset, if any (for the tray: its shelf offers the kit, not the prop). */
const byAsset = new Map<string, KitTypeId>(KIT_TYPES.map((t) => [KITS[t].asset, t]));
export const kitForAsset = (asset: string): KitTypeId | undefined => byAsset.get(asset);

/** Where a kit's model stands in its piece's frame (see `KitDef.place`). */
export function kitPlace(kit: KitDef): { t: number; l: number; turn: number } {
  if (kit.place) return { t: kit.place.t, l: kit.place.l, turn: kit.place.turn ?? 0 };
  const end = kit.track.connectors[1]?.pose;
  return { t: end ? end.x / 2 : 0, l: end ? end.z / 2 : 0, turn: 0 };
}
