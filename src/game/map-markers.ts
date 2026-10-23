import { CARGO, CARGO_KINDS, GOODS_ICON, type CargoKind } from "../economy/cargo";
import { pilesOf } from "../economy/economy";
import type { TownStatus } from "./towns";
import type { DepotRole } from "../economy";
import { DEPOT_NAMES, depotName, type World } from "./world";
import { SITE_ROLES, type MapSite, type SiteRole } from "../landscape";
import { SITE_NAMES, siteBlueprint } from "./map-sites";

/** One thing the map view points out: where it is, what it's called, and a line about it. */
export interface MapMarker {
  /** Unique within a map: "town:3", "depot:1", "site:7" (an industry the player put down), "ruin:2" / "ruin-around:…". */
  key: string;
  kind: "town" | "ruin" | Exclude<DepotRole, "town">;
  /** A ruin's: its icon by role, shown alone in a small round badge (no label). */
  icon?: string;
  /** A ruin's: its blueprint isn't learned yet (a lock on its badge). */
  locked?: boolean;
  /** A ruin on the player's land (a site id): tapped, its card opens. Unset on the land around (not tappable there). */
  ruin?: number;
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
  // The industries the player has put down (a workshop): not the map's own, nor a town's station.
  const own = new Set(world.depots.values());
  for (const d of world.economy.allDepots()) {
    if (d.role === "town" || own.has(d.pieceId)) continue;
    const piece = world.layout.getPiece(d.pieceId);
    const title = depotName(world, d);
    if (!piece || !title) continue;
    // (A school's goods go into its research: it has no piles to list.)
    const stock = (d.role === "school" ? [] : pilesOf(d.role)).map((k) => `${GOODS_ICON[k]} ${CARGO[k].label} ${d.piles[CARGO[k].index]}`).join(" · ");
    out.push({ key: `site:${d.id}`, kind: d.role, x: piece.pose.x, z: piece.pose.z, title, detail: stock });
  }
  return out;
}

/** A ruin's icon on the map, by what it was: its goods (stone, ore), or what it stands by. */
export const RUIN_ICON: Record<SiteRole, string> = { farm: "🌾", quarry: "🪨", mine: "⛏️", harbour: "⚓" };

/** A standing ruin the world shows: on the player's land (`around` false) or on the land around (`around` true). */
export interface RuinOnMap {
  site: MapSite;
  around: boolean;
}

/**
 * What the ruins' markers are made from: the ruins shown (by version), the land's squares (by its grid's revision: a
 * harbour's water can only change with them, by a land tool), and which of their blueprints are learned.
 */
export function ruinMarkersKey(version: number, learned: (id: string) => boolean, landRevision = 0): string {
  return `${version}|${landRevision}|` + SITE_ROLES.map((r) => (ruinLocked(r, learned) ? "1" : "0")).join("");
}

const ruinLocked = (role: SiteRole, learned: (id: string) => boolean) => {
  const bp = siteBlueprint(role);
  return !!bp && !learned(bp.id);
};

/**
 * The map view's ruin markers: one per standing ruin (on the player's land and on the land around shown), its icon by
 * role and a lock while its blueprint isn't learned. Restored and cleared ruins aren't shown (they aren't standing).
 * Tapped, one on the player's land opens its card (`ruin`). A harbour on the player's land its boats can't reach
 * (`stranded`: `harbourStranded`) isn't marked either: it can never be opened, and its card still says why when the
 * ruin itself is tapped. (The land around's harbours all reach the open sea: they're made only where they do.)
 */
export function ruinMarkers(ruins: readonly RuinOnMap[], learned: (id: string) => boolean, stranded: (site: MapSite) => boolean = () => false): MapMarker[] {
  const out: MapMarker[] = [];
  for (const { site, around } of ruins) {
    if (site.cleared || (!around && stranded(site))) continue;
    const locked = ruinLocked(site.role, learned);
    // (A site on the land around is numbered in its own plot's land: keyed by its plot too.)
    out.push({
      key: around ? `ruin-around:${site.plot.px},${site.plot.pz}:${site.id}` : `ruin:${site.id}`,
      kind: "ruin",
      x: site.centre.x,
      z: site.centre.z,
      title: `Old ${SITE_NAMES[site.role]}`,
      detail: "",
      icon: RUIN_ICON[site.role],
      locked,
      ...(around ? {} : { ruin: site.id }),
    });
  }
  return out;
}
