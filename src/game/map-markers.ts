import { CARGO, CARGO_KINDS, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { pilesOf } from "../economy/economy";
import type { TownStatus } from "./towns";
import { DEPOT_NAMES, type World } from "./world";

/** One thing the map view points out: where it is, what it's called, and a line about it. */
export interface MapMarker {
  /** Unique within a map: "town:3", "depot:1". */
  key: string;
  kind: "town" | "forest" | "sawmill";
  x: number;
  z: number;
  title: string;
  /** A short line under the title ("Village · wants planks 3/8", "Logs 5"). */
  detail: string;
  /** 0–1 toward a town's next level. */
  fill?: number;
}

const label = (k: CargoKind) => `${GOODS_ICON[k]} ${CARGO[k].label.toLowerCase()}`;

/**
 * Everything the map view shows: every town (its level and what it wants), and every depot with its stock. Built from
 * the world as it is, by kind, so a new kind of site is a row here, not a new view.
 */
export function mapMarkers(world: World, statusOf: (townId: number) => TownStatus): MapMarker[] {
  const out: MapMarker[] = [];
  for (const t of world.landscape.towns) {
    const s = statusOf(t.id);
    const wants = CARGO_KINDS.filter((k) => (s.wants[k] ?? 0) > 0)
      .map((k) => `${label(k)} ${s.got[k] ?? 0}/${s.wants[k]}`)
      .join(", ");
    out.push({ key: `town:${t.id}`, kind: "town", x: t.centre.x, z: t.centre.z, title: t.name, detail: `${s.name} · wants ${wants}`, fill: s.fill });
  }
  for (const d of world.landscape.depots) {
    const pieceId = world.depots.get(d.id);
    const state = pieceId === undefined ? undefined : world.economy.depotAtPiece(pieceId);
    const kinds = pilesOf(d.kind);
    const stock = state ? kinds.map((k) => `${GOODS_ICON[k]} ${CARGO[k].label} ${state.piles[CARGO[k].index]}`).join(" · ") : "";
    out.push({ key: `depot:${d.id}`, kind: d.kind, x: d.centre.x, z: d.centre.z, title: DEPOT_NAMES[d.kind], detail: stock });
  }
  return out;
}
