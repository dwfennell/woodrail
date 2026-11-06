import type { DepotState } from "../economy";
import { addTrackPoints, CELL, frameOf, SITE_BODY, SITE_STRIP, worldToFrame, type Landscape, type SecretSite } from "../landscape";
import { appendPiece, connectorRef, isSecretKit, SECRET_NAMES, secretKindOf, secretKitOf, type Layout, type PieceTypeId } from "../track";
import type { Progress } from "./progress";
import type { World } from "./world";

/**
 * Secrets on the map, in play (spec docs/superpowers/specs/2026-11-05-character-and-goals.md, "Secret sites"; where
 * they go: src/landscape/secrets.ts). A hidden site stands in the mist on the land; laying track to it (any of the
 * player's track within `FIND_REACH` of it) finds it: it's drawn restored, and its halt is laid as real track, a fixed
 * kit piece (`secretKitOf`, the found model beside its straight) and a buffer after it, which a line joins at the
 * straight's open end. Found, it's a tourist stop as the lookout is: no one lives there, riders from every town get off
 * there for a day out and pay twice the fare (`isSightStop`). Each rider off there is a tourist trip, counted on the
 * site (its card) and in all (the Exploring sticker's tiers, `TOURIST_TIERS`).
 */

/** Track this near a hidden site's body or its halt's bed (mm) finds it: the square beside it. */
export const FIND_REACH = CELL;

/** Tourist trips to found secrets, all together, for the Exploring sticker's tiers (Day tripper, Tour guide, Grand tourist). */
export const TOURIST_TIERS = [25, 100, 250] as const;

/** Progress's count of tourist trips (all secrets together). */
export const TOURIST_COUNT = "tourists";

/** A secret's name (found) and its halt's. */
export const secretName = (site: Pick<SecretSite, "kind">): string => SECRET_NAMES[site.kind].name;
export const haltName = (site: Pick<SecretSite, "kind">): string => `${secretName(site)} halt`;

/**
 * Is a world point within `reach` of a hidden site (its body and its halt's bed, as `inSecretFootprint` keeps them)? A
 * few multiplications: called for the track's sample points near a site only.
 */
function near(site: SecretSite, x: number, z: number, reach: number): boolean {
  const { fx, fz } = worldToFrame(frameOf(site.piece), x, z);
  const within = (r: { x0: number; x1: number; z0: number; z1: number }) => fx > r.x0 - reach && fx < r.x1 + reach && fz > r.z0 - reach && fz < r.z1 + reach;
  return within(SITE_BODY) || within(SITE_STRIP);
}

/** How far a site reaches from its halt's start (mm), and then some: a quick test before the exact one. */
const SITE_RADIUS = 520;

/**
 * The hidden sites on the land that the player's track now reaches (`FIND_REACH`): not yet found, on land the map has
 * (land for sale takes no track). Looks at the pieces near each site only, so it's cheap enough to run whenever the
 * track changes. Never the secrets' own halts.
 */
export function secretsReached(world: Pick<World, "layout" | "landscape">): SecretSite[] {
  const hidden = (world.landscape.secrets ?? []).filter((s) => !s.found);
  if (hidden.length === 0) return [];
  const out: SecretSite[] = [];
  const layout = world.layout;
  for (const site of hidden) {
    const buckets = new Map<number, number[]>();
    for (const id of layout.pieceIds()) {
      if (layout.isLifted(id)) continue;
      const p = layout.getPiece(id)!;
      if (isSecretKit(p.type) || Math.hypot(p.pose.x - site.piece.x, p.pose.z - site.piece.z) > SITE_RADIUS + 300) continue;
      addTrackPoints(buckets, p.type, p.flipped, p.pose);
    }
    let hit = false;
    for (const list of buckets.values()) {
      for (let k = 0; k < list.length && !hit; k += 2) hit = near(site, list[k], list[k + 1], FIND_REACH);
      if (hit) break;
    }
    if (hit) out.push(site);
  }
  return out;
}

/** The kit piece of a found site's halt on the layout (at its pose), or undefined. */
export function haltPieceOf(layout: Layout, site: SecretSite): number | undefined {
  const type = secretKitOf(site.kind);
  for (const id of layout.pieceIds()) {
    const p = layout.getPiece(id)!;
    if (p.type === type && Math.hypot(p.pose.x - site.piece.x, p.pose.z - site.piece.z) < 0.5) return id;
  }
  return undefined;
}

/**
 * Find a site: it's marked found and its halt laid (the kit piece at its pose, a buffer on its far end), joining any
 * track already at its open end. Not an undo step: a secret, once found, stays found. Returns the halt's piece id.
 */
export function findSecret(world: Pick<World, "layout" | "landscape">, site: SecretSite): number {
  site.found = true;
  const have = haltPieceOf(world.layout, site);
  if (have !== undefined) return have;
  const id = world.layout.addPiece(secretKitOf(site.kind), site.piece, 0);
  appendPiece(world.layout, "buffer", false, connectorRef(id, 1));
  return id;
}

/** The secret site a stop is the halt of (a found secret's kit piece), or undefined. */
export function secretOfStop(world: Pick<World, "layout" | "landscape">, d: Pick<DepotState, "pieceId">): SecretSite | undefined {
  const p = world.layout.getPiece(d.pieceId);
  const kind = p && secretKindOf(p.type);
  if (!kind) return undefined;
  return (world.landscape.secrets ?? []).find((s) => s.kind === kind && Math.hypot(s.piece.x - p.pose.x, s.piece.z - p.pose.z) < 0.5);
}

/** The secret site a halt piece is (by its id), or undefined. */
export function secretOfPiece(world: Pick<World, "layout" | "landscape">, pieceId: number): SecretSite | undefined {
  return secretOfStop(world, { pieceId });
}

/**
 * A rider got off at a stop: if it's a secret's halt, that's a tourist trip, counted on the site (all told, this year,
 * by the town they came from, and the fare) and in all (`TOURIST_COUNT`). Returns the site, or undefined.
 */
export function noteTrip(world: Pick<World, "layout" | "landscape">, p: Progress, from: DepotState, to: DepotState, fare: number, year: number): SecretSite | undefined {
  const site = secretOfStop(world, to);
  if (!site) return undefined;
  site.trips = (site.trips ?? 0) + 1;
  site.fares = (site.fares ?? 0) + fare;
  const from_ = (site.from ??= {});
  from_[from.townId] = (from_[from.townId] ?? 0) + 1;
  site.year = site.year && site.year[0] === year ? [year, site.year[1] + 1] : [year, 1];
  p.counts.set(TOURIST_COUNT, (p.counts.get(TOURIST_COUNT) ?? 0) + 1);
  return site;
}

/** Is this piece a found secret's halt (fixed: the game laid it, and it can't be moved or taken up)? */
export const isSecretHalt = (type: PieceTypeId): boolean => isSecretKit(type);

/** The secret site standing on a square (a hidden one or found), or undefined. */
export function secretAt(land: Landscape, x: number, z: number): SecretSite | undefined {
  for (const s of land.secrets ?? []) if (near(s, x, z, 0)) return s;
  return undefined;
}

// ---- what the player is told -----------------------------------------------------------------------------------

/** What a hidden site's card says it might be (the mist hides it). */
const HINTS: Record<SecretSite["kind"], string> = {
  "lost-mine": "An old headframe in the brambles, a glint in the rock. Lay track to it to find it.",
  castle: "Broken walls on a mound, lost in the mist. Lay track to it to find it.",
  lake: "Mist in a hollow, and the sound of falling water. Lay track to it to find it.",
  shipwreck: "A dark hull on the sand, half buried. Lay track to it to find it.",
  stones: "Great grey stones, fallen in a ring. Lay track to it to find it.",
  footprint: "A pond in a very odd shape. Lay track to it to find it.",
};

/** What's said when a site is found (its toast's second line). */
const FOUND: Record<SecretSite["kind"], string> = {
  "lost-mine": "The wheel turns again, and there's gold in the carts. Tourists ride out to its halt.",
  castle: "Red roofs, banners, the drawbridge down to its own halt. Day-trippers ride out.",
  lake: "The mist lifts: a waterfall, a temple on the island, swans. Its halt takes boating parties.",
  shipwreck: "A whole galleon on the beach, and a chest of gold. Tourists ride out to see her.",
  stones: "The stones stand again. Visitors come from every town, most at midsummer.",
  footprint: "Ducks on the pond, the giant's staff, a look-out tower. Families come to picnic.",
};

/** A hidden site's card: a guess at what it is, and how to find it. */
export function hiddenCard(site: SecretSite): { title: string; text: string } {
  return { title: `❔ ${SECRET_NAMES[site.kind].hidden}?`, text: HINTS[site.kind] };
}

/** What's said as a site is found: its toast. */
export function foundText(site: SecretSite): string {
  return `🌟 ${secretName(site)} found! ${FOUND[site.kind]} Join your line to its halt.`;
}

/** The tourist-trip tier next to reach (`TOURIST_TIERS`), or null once all are. */
export function nextTier(trips: number): number | null {
  return TOURIST_TIERS.find((t) => t > trips) ?? null;
}
