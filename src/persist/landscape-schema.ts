import { z } from "zod";
import { FIELD_STOCK, HILLINESS, SITE_ROLES } from "../landscape";
import { SECRET_KINDS } from "../track/kits";

/**
 * The landscape's save format, validated with Zod (see `landscape-data.ts`). Its own module, loaded with the save's
 * (`persist/schemas.ts`): Zod isn't in the first download.
 */

const point = z.object({ x: z.number().finite(), z: z.number().finite() });
const pose = z.object({ x: z.number().finite(), z: z.number().finite(), heading: z.number().finite() });
const cells = z.array(z.number().int().min(0));
const id = z.number().int().min(0);

export const landscapeSchema = z.object({
  seed: z.number().int(),
  starter: z.boolean(),
  /** How hilly the map is (`Landscape.hills`); missing in saves from before the choice (their hills as made then). */
  hills: z.enum(HILLINESS).optional(),
  nextBuildingId: id,
  /** Where the sea is; missing in saves from before the coast (no sea). */
  coast: z.object({ side: z.enum(["n", "e", "s", "w"]), plot: z.number().int().min(-30000).max(30000) }).optional(),
  plots: z.array(
    z.object({
      px: z.number().int().min(-30000).max(30000),
      pz: z.number().int().min(-30000).max(30000),
      /** Base64 of the plot's squares, row-major: one byte each. */
      height: z.string(),
      surface: z.string(),
      feature: z.string(),
      /** Base64 of the owner ids (little-endian int32 per square). */
      owner: z.string(),
      /** Base64 of the road piece on each square (`grid.road`); missing in saves from before road pieces. */
      road: z.string().optional(),
    }),
  ).min(1),
  towns: z.array(
    z.object({
      id,
      name: z.string().max(80),
      centre: point,
      station: pose,
      cells,
      buildings: z.array(
        z.object({
          id,
          cells,
          floors: z.union([z.literal(1), z.literal(2)]),
          kind: z.enum(["house", "shop"]),
          roof: z.number().int().min(0).max(15),
          front: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
          corner: z.boolean().optional(),
          landmark: z.string().optional(),
          born: z.number().int().min(0).max(99).optional(),
        }),
      ),
      claimed: cells.optional(),
      upgraded: z.enum(["kit-two-platform-station", "kit-grand-terminus", "kit-grand-central-1", "kit-grand-central-2", "kit-grand-central-3"]).optional(),
    }),
  ),
  depots: z.array(z.object({ id, kind: z.enum(["forest", "sawmill"]), centre: point, piece: pose })),
  fields: z.array(z.object({ id, cells, animal: z.enum(FIELD_STOCK) })),
  shed: z.object({ cells, x: z.number().finite(), z: z.number().finite(), heading: z.number().finite() }).nullable(),
  corridors: cells,
  /**
   * Old industries' sites (see `MapSite`). Missing in saves from before them: such a save gains them as it loads, for
   * the plots it owns (`addSitesToOldSave`), where nothing of the player's is in the way.
   */
  sites: z
    .array(
      z.object({
        id,
        role: z.enum(SITE_ROLES),
        centre: point,
        piece: pose,
        plot: z.object({ px: z.number().int().min(-30000).max(30000), pz: z.number().int().min(-30000).max(30000) }),
        fields: z.array(id),
        cleared: z.boolean().optional(),
        restored: z.boolean().optional(),
      }),
    )
    .optional(),
  /** A Sandbox map: no sites, ever (`Landscape.siteless`). */
  siteless: z.boolean().optional(),
  /** Where the map's secrets go (`Landscape.secretPlan`); missing on a map from before them, or with none. */
  secretPlan: z.array(z.object({ kind: z.enum(SECRET_KINDS), px: z.number().int().min(-30000).max(30000), pz: z.number().int().min(-30000).max(30000), alt: z.number().int().min(1).max(9).optional() })).optional(),
  /** The secret sites placed so far (`Landscape.secrets`). */
  secrets: z
    .array(
      z.object({
        id,
        kind: z.enum(SECRET_KINDS),
        piece: pose,
        plot: z.object({ px: z.number().int().min(-30000).max(30000), pz: z.number().int().min(-30000).max(30000) }),
        found: z.boolean().optional(),
        trips: z.number().int().min(0).optional(),
        fares: z.number().min(0).finite().optional(),
        from: z.record(z.string(), z.number().int().min(0)).optional(),
        year: z.tuple([z.number().int(), z.number().int().min(0)]).optional(),
      }),
    )
    .optional(),
  /** The first train's marker (`Landscape.firstTrain`); null: none ever; missing: none yet. */
  firstTrain: z.object({ x: z.number().finite(), z: z.number().finite(), heading: z.number().finite() }).nullable().optional(),
});

export type LandscapeData = z.infer<typeof landscapeSchema>;
