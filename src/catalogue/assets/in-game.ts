import { Group, Mesh } from "three";
import { buildCarModel } from "../../render/train-models";
import { buildPieceGeometry } from "../../render/track-geometry";
import { CAR_KINDS, type CarKind } from "../../sim/cars";
import { getPieceDef, isBridge, PIECE_TYPES, type PieceTypeId } from "../../track";
import type { Asset } from "../types";

/** The game's own track pieces and cars, for reference beside the new ideas. */
const CAR_NAMES: Record<CarKind, string> = { engine: "Engine", hopper: "Hopper wagon", passenger: "Passenger coach", caboose: "Caboose", timber: "Timber wagon" };

const pieces: Asset[] = PIECE_TYPES.map((type: PieceTypeId) => ({
  id: `game-${type}`,
  name: type.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
  category: "Track" as const,
  tags: ["in game", "track", type],
  notes: "In the game today.",
  inGame: true,
  build: (k) => {
    const g = new Group();
    const mesh = new Mesh(buildPieceGeometry(getPieceDef(type, false), isBridge(type) ? 1 : 0), [k.mats.track, k.mats.trackCut, k.mats.bridgePaint]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Raised pieces stand on their arches: bring the lowest point to the ground.
    mesh.geometry.computeBoundingBox();
    mesh.position.y = -mesh.geometry.boundingBox!.min.y;
    g.add(mesh);
    return g;
  },
}));

const cars: Asset[] = CAR_KINDS.map((kind) => ({
  id: `game-${kind}`,
  name: CAR_NAMES[kind],
  category: kind === "engine" ? ("Trains" as const) : ("Wagons" as const),
  tags: ["in game", "car", kind],
  notes: "In the game today.",
  inGame: true,
  build: (k) => buildCarModel(kind, k.mats).root,
}));

export const ASSETS: Asset[] = [...pieces, ...cars];
