import type { DepotRole } from "../economy";
import { CELL, FEAT_FIELD, FEAT_TREE, type Landscape } from "../landscape";
import type { PieceTypeId, Pose } from "../track";
import { INDUSTRY_ROLE, type World } from "./world";

/**
 * What an industry must stand near, as data: which squares count, how far from its yard they may be, and how many it
 * needs to work at its recipe's speed. A new resource-bound industry is a row here.
 */
export interface SiteRule {
  /** What counts, for messages ("trees", "farm fields"). */
  readonly what: string;
  /** Does square `i` count? */
  readonly counts: (land: Landscape, i: number) => boolean;
  /** Squares whose centre is within this distance (mm) of the yard's middle count. */
  readonly reach: number;
  /** This many works at the recipe's speed; half as many is the least it can be placed with. */
  readonly need: number;
}

export const SITE_RULES: Partial<Record<DepotRole, SiteRule>> = {
  forest: { what: "trees", counts: (land, i) => land.grid.feature[i] === FEAT_TREE, reach: 250, need: 10 },
  farm: { what: "farm fields", counts: (land, i) => land.grid.feature[i] === FEAT_FIELD, reach: 250, need: 8 },
  // Stone is cut from the hills: raised squares nearby.
  quarry: { what: "hillside", counts: (land, i) => land.grid.height[i] > 0, reach: 250, need: 12 },
};

/** The fastest an industry works, however much is around it (against its recipe). */
const MAX_RATE = 1.5;

/** The middle of a depot's yard (depot coordinates t 108, l 72: see `DEPOT_LAYOUT`) for a piece at `pose`. */
function yardMiddle(pose: Pose): { x: number; z: number } {
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  return { x: pose.x + c * 108 - s * 72, z: pose.z + s * 108 + c * 72 };
}

/** How many of its resource an industry of `role` at `pose` has around it, and how many it needs; null if it needs none. */
export function resourceAt(land: Landscape, role: DepotRole, pose: Pose): { count: number; need: number; rule: SiteRule } | null {
  const rule = SITE_RULES[role];
  if (!rule) return null;
  const g = land.grid;
  const m = yardMiddle(pose);
  const r = Math.ceil(rule.reach / CELL);
  const col = g.colAt(m.x);
  const row = g.rowAt(m.z);
  let count = 0;
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      const i = g.index(col + dc, row + dr);
      if (i === -1 || Math.hypot(g.centreX(col + dc) - m.x, g.centreZ(row + dr) - m.z) > rule.reach) continue;
      if (rule.counts(land, i)) count++;
    }
  }
  return { count, need: rule.need, rule };
}

/** How fast it works with `count` of the `need` it wants (0 to 1.5 times its recipe). */
export function rateFor(count: number, need: number): number {
  return Math.min(MAX_RATE, count / need);
}

/** Why a piece can't stand here for want of its resource ("Needs trees nearby: 3 of 5"), or null. */
export function siteWhy(land: Landscape, type: PieceTypeId, pose: Pose): string | null {
  const role = INDUSTRY_ROLE[type];
  const r = role && resourceAt(land, role, pose);
  if (!r) return null;
  const least = Math.ceil(r.need / 2);
  return r.count >= least ? null : `Needs ${r.rule.what} nearby: ${r.count} of ${least}`;
}

/**
 * Set every placed industry's rate from what is around it now (the map's own depots keep their recipe's speed). Cheap:
 * a few hundred squares per industry; call when industries or the land change. Returns true if any rate changed.
 */
export function updateRates(world: World): boolean {
  const own = new Set(world.depots.values());
  let changed = false;
  for (const d of world.economy.allDepots()) {
    const piece = world.layout.getPiece(d.pieceId);
    if (!piece || own.has(d.pieceId)) continue;
    const r = resourceAt(world.landscape, d.role, piece.pose);
    const rate = r ? rateFor(r.count, r.need) : 1;
    if (rate !== d.rate) {
      d.rate = rate;
      changed = true;
    }
  }
  return changed;
}
