import { z } from "zod";
import { ALL_CAR_LOOKS, CAR_KINDS, type CarKind, type CarLook } from "../sim";
import { AIRPORT_LOUNGE, AIRSHIP_SEATS, CARGO_KINDS, CARGO_SLOTS, KIT_DEPOT_ROLES, MAX_SHEDS, MAX_WAGON_CAPACITY, STORE_MODES, type CargoKind, type StoreMode } from "../economy";
import { MAX_CONNECTORS, PIECE_TYPES, type PieceTypeId } from "../track";
import { MAX_VIAS } from "../game/lines";
import { BARGE_LOADS, MAX_BARGES, MAX_BOATS } from "../game/boats";
import { JOURNAL_CAP } from "../game/journal";
import { landscapeSchema } from "./landscape-schema";
import { MAX_PILE, MAX_RIDERS, MAX_SAVED_SPEED, SAVE_VERSION } from "./save-limits";

/**
 * The save format (see `save.ts`), validated with Zod. Its own module, loaded as the game starts, alongside the models
 * (`persist/schemas.ts`): Zod isn't in the first download.
 */

const pieceSchema = z.object({
  id: z.number().int().positive(),
  type: z.enum(PIECE_TYPES as unknown as [PieceTypeId, ...PieceTypeId[]]),
  x: z.number().finite(),
  z: z.number().finite(),
  heading: z.number().finite(),
  y: z.number().finite(),
  flipped: z.boolean(),
});

const trainSchema = z.object({
  cars: z
    .array(
      z.object({
        /** Its id (v14; optional: older saves, whose cars get fresh ids). */
        id: z.number().int().positive().optional(),
        kind: z.enum(CAR_KINDS as unknown as [CarKind, ...CarKind[]]),
        facing: z.union([z.literal(1), z.literal(-1)]),
        lever: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
        look: z.enum(ALL_CAR_LOOKS as unknown as [CarLook, ...CarLook[]]).optional(),
        /** An engine's name (its plate and card title; optional: older saves' engines are given one as they load). */
        name: z.string().min(1).max(64).optional(),
        /** An engine's paint from the paint shop (game/paint-shop.ts). Absent: as it came. */
        livery: z.string().min(1).max(24).optional(),
        cargo: z.object({ kind: z.enum(CARGO_KINDS as unknown as [CargoKind, ...CargoKind[]]), count: z.number().int().min(1).max(MAX_WAGON_CAPACITY) }).optional(),
        /** Goods a wagon is switched off for on its card (optional: absent, an older save's, it takes all it can carry). */
        off: z.array(z.enum(CARGO_KINDS as unknown as [CargoKind, ...CargoKind[]])).max(CARGO_KINDS.length).optional(),
        /** The harbour (economy depot id) its cargo was bought at: not unloaded back there. */
        landedFrom: z.number().int().min(0).optional(),
        /** People riding a coach: how many, and the station they got on at (its index in `depots`). */
        riders: z.object({ count: z.number().int().min(1).max(MAX_RIDERS), from: z.number().int().min(0) }).optional(),
        /** The line an engine runs (its id in `lines`), and the stop it heads for. */
        // (`joined`: when it came to its line, a count, the newest being the one held when there's no room; `held`: its
        // line had no room for it. Optional: older saves work them out afresh.)
        /** `via`: via points passed on the way to its next stop (routing spec §3.5). */
        line: z.object({ id: z.number().int().min(1), next: z.number().int().min(0), joined: z.number().int().min(0).optional(), held: z.literal(true).optional(), via: z.number().int().min(1).optional() }).optional(),
      }),
    )
    .min(1),
  lead: z.object({
    pieceId: z.number().int().positive(),
    pathIndex: z.number().int().min(0),
    reversed: z.boolean(),
    s: z.number().finite(),
  }),
  /** How fast it was going (mm/s; optional: older saves, and trains standing, load at rest). */
  speed: z.number().min(0).max(MAX_SAVED_SPEED).optional(),
});

export const saveSchema = z.object({
  version: z.literal(SAVE_VERSION),
  landscape: landscapeSchema,
  towns: z.array(z.object({ id: z.number().int().min(0), stationPieceId: z.number().int().positive() })),
  pieces: z.array(pieceSchema),
  switches: z.array(z.tuple([z.number().int(), z.number().int().min(0).max(MAX_CONNECTORS - 1)])),
  /**
   * The joints, each as two ends (piece id, connector index): loaded joined as they were, even one joint play took a
   * little past the joint tolerance (optional: older saves are seated afresh, by the tolerance alone).
   */
  joints: z.array(z.tuple([z.number().int().positive(), z.number().int().min(0).max(MAX_CONNECTORS - 1), z.number().int().positive(), z.number().int().min(0).max(MAX_CONNECTORS - 1)])).optional(),
  /** Pinned switches, by piece id: routed engines don't throw them (optional: older saves load with none). */
  pinned: z.array(z.number().int().positive()).optional(),
  /**
   * Signal marks on joints (signals spec §9), each as the joint end it guards from (piece id, connector index), its
   * style and whether it's held at red (optional: older saves have none).
   */
  signals: z.array(z.tuple([z.number().int().positive(), z.number().int().min(0).max(MAX_CONNECTORS - 1), z.enum(["plain", "semaphore", "colour-light"]), z.boolean()])).optional(),
  /**
   * Points' defaults (the way the player last set them by hand, which routes put them back to), only where one differs
   * from how the switch is set (optional: older saves, and points not named, default to how they're set).
   */
  switchDefaults: z.array(z.tuple([z.number().int(), z.number().int().min(0).max(MAX_CONNECTORS - 1)])).optional(),
  /**
   * 3: a wye's switch state is its three levers, a bit for each corner (#15). Missing: a save from before, its wyes'
   * one lever setting every corner alike (`cornersFromOneLever`).
   */
  wyeLevers: z.literal(3).optional(),
  trains: z.array(trainSchema),
  /** The sim's next car and train ids (v14; optional: older saves start afresh). */
  ids: z.object({ car: z.number().int().positive(), train: z.number().int().positive() }).optional(),
  /** Economy depots, in id order: the piece each works on and what it does. */
  depots: z.array(
    z.object({
      id: z.number().int().min(0),
      pieceId: z.number().int().positive(),
      role: z.enum(["forest", "sawmill", "town", "workshop", "farm", "mill", "quarry", "warehouse", "mine", "foundry", "carpenter", "smithy", "power", "harbour", "school", "dairy", "bakery", "orchard", "juicer", "creamery", "icecream", "brickworks", "carworks", "oilwell", "waterpump", "beetfield", "jamworks", "chocworks", "flowerfield", "dyeworks", "toyworks", "postoffice", "landing", "slip", "boatyard", "shipyard", "airport", "mast", ...KIT_DEPOT_ROLES]),
      townId: z.number().int().min(-1),
      auto: z.boolean(),
      waitFull: z.boolean(),
      /** A workshop that takes all the planks trains bring, or a school set to Research first (optional: absent, it shares with towns further on). */
      takesAll: z.literal(true).optional(),
      /** Units on each pile, in cargo order (saves from before grain and flour have just logs and planks). */
      piles: z.array(z.number().int().min(0).max(MAX_PILE)).min(2).max(CARGO_SLOTS),
      timer: z.number().int().min(0),
      /** People waiting at a town's station. */
      waiting: z.number().int().min(0).max(MAX_RIDERS).optional(),
      /** A harbour's dock sheds. */
      sheds: z.number().int().min(0).max(MAX_SHEDS).optional(),
      /** Asked to be powered (Game mode's sparks): the nth ask. */
      power: z.number().int().min(1).optional(),
      /** Riders in an airport's lounge, waiting for a plane. */
      flyers: z.number().int().min(0).max(Math.max(AIRPORT_LOUNGE, AIRSHIP_SEATS)).optional(),
      /**
       * A warehouse's listed goods and what it lets trains do with each (`StoreMode`), and with goods not listed
       * (`others`). Optional: absent (saves from before them, and a warehouse never set), it takes and gives everything.
       */
      modes: z.partialRecord(z.enum(CARGO_KINDS as [CargoKind, ...CargoKind[]]), z.enum(STORE_MODES as [StoreMode, ...StoreMode[]])).optional(),
      others: z.enum(STORE_MODES as [StoreMode, ...StoreMode[]]).optional(),
      /**
       * A workshop's keep amounts set on its card, by kind (`DepotState.keeps`). Optional: absent (older saves, and a
       * workshop never set), the game's own amounts. No new save version: it's simply missing from an older save.
       */
      keeps: z.partialRecord(z.enum(CARGO_KINDS as [CargoKind, ...CargoKind[]]), z.number().int().min(0).max(MAX_PILE)).optional(),
      /** Of its piles, what's landed there for trains to take away (a harbour's bought goods), in cargo order. */
      landed: z.array(z.number().int().min(0).max(MAX_PILE)).max(CARGO_SLOTS).optional(),
      /** A station's van yard (roads spec D5): goods waiting for its delivery van (or riding it), by kind. */
      vanYard: z.record(z.string(), z.number().int().min(0).max(MAX_PILE)).optional(),
      /**
       * An industry's further tracks (depot tracks): the pieces under its crane on each (`roads`), the rest of those
       * tracks (`ends`), and the ladder joining them to the line. Optional: absent (older saves too), it has one track.
       */
      tracks: z.object({ roads: z.array(z.number().int().positive()).max(2), ends: z.array(z.number().int().positive()).max(8), ladder: z.array(z.number().int().positive()).max(64) }).optional(),
    }),
  ),
  /** Plank bundles delivered, by town id. */
  delivered: z.array(z.tuple([z.number().int().min(0), z.number().int().min(0)])),
  /** Everything delivered to each town, by kind (Game mode's town baskets). Older saves: planks only, in `delivered`. */
  deliveredGoods: z.array(z.tuple([z.number().int().min(0), z.record(z.string(), z.number().int().min(0))])).optional(),
  /** What each town received while joined by road to another (roads spec D2), by kind. Absent: none. */
  roadGot: z.array(z.tuple([z.number().int().min(0), z.record(z.string(), z.number().int().min(0))])).optional(),
  /** Each town's place under way (game/places.ts): town id, the place's id, and the goods it has had. Absent: none. */
  placePlans: z.array(z.tuple([z.number().int().min(0), z.string().max(40), z.record(z.string(), z.number().int().min(0))])).optional(),
  /** Lines: a colour, a name, and stops (depot indices in `depots`, what's done there, wait there to fill). */
  lines: z
    .array(
      z.object({
        id: z.number().int().min(1),
        colour: z.string().max(16),
        name: z.string().max(40),
        /** A stop's 4th item, its via points (piece ids passed on the way to the next stop): left out where it has none. */
        stops: z
          .array(
            z.union([
              z.tuple([z.number().int().min(0), z.enum(["auto", "both", "drop", "pick"]), z.boolean()]),
              z.tuple([z.number().int().min(0), z.enum(["auto", "both", "drop", "pick"]), z.boolean(), z.array(z.number().int().min(0)).max(MAX_VIAS)]),
            ]),
          )
          .min(1),
        /** Its player has been told it has no room for a train put on it (said once a line). */
        toldFull: z.literal(true).optional(),
      }),
    )
    .optional(),
  /**
   * The player's boats (Game mode's River barges): stops are depot indices in `depots`. No new save version: older
   * saves simply have none.
   */
  boats: z
    .array(
      z.object({
        name: z.string().max(40),
        barges: z.number().int().min(1).max(MAX_BARGES),
        load: z.record(z.string(), z.number().int().min(0).max(MAX_BARGES * BARGE_LOADS)),
        stops: z.array(z.tuple([z.number().int().min(0), z.enum(["both", "pick", "drop"])])).min(1),
        from: z.number().int().min(0),
        docked: z.boolean(),
        t: z.number().finite().min(0),
        going: z.boolean(),
        home: z.number().int().min(0),
      }),
    )
    .max(MAX_BOATS)
    .optional(),
  /** What each yard is building (its depot index in `depots`) and the goods gone in; absent: none. */
  yards: z
    .array(z.object({ depot: z.number().int().min(0), build: z.enum(["tug", "barge", "ship", "ferry"]), got: z.record(z.string(), z.number().int().min(0).max(100)) }))
    .optional(),
  /** Cargo ships and train ferries built at shipyards; absent: none. */
  built: z.object({ ships: z.number().int().min(0).max(999), ferries: z.number().int().min(0).max(999) }).optional(),
  /** Placed catalogue models (optional: saves from before props load with none). */
  props: z
    .array(
      z.object({
        id: z.number().int().positive(),
        asset: z.string().max(64),
        x: z.number().finite(),
        z: z.number().finite(),
        heading: z.number().finite(),
        y: z.number().finite(),
        building: z.number().int().min(0).optional(),
        town: z.number().int().min(0).optional(),
        variant: z.number().int().min(0).max(8).optional(),
        scale: z.number().min(0.5).max(1).optional(),
        /** A town house's storeys more than its model (its town grew: `props/storeys.ts`). */
        storeys: z.number().int().min(0).max(8).optional(),
      }),
    )
    .optional(),
});

export type SaveData = z.infer<typeof saveSchema>;

/**
 * What goes on beside a mode's railway, saved with it (not in the save format: nothing in the world depends on it): the
 * game's clock (seconds played, the Journal's times are on it), whether it was paused, and the Journal.
 */
export const sessionEntry = z.object({
  kind: z.enum(["event", "milestone"]),
  text: z.string().max(2000),
  place: z.object({ x: z.number().finite(), z: z.number().finite(), points: z.array(z.object({ x: z.number().finite(), z: z.number().finite() })).max(64).optional() }).optional(),
  time: z.number().finite(),
  key: z.string().max(500).optional(),
  count: z.number().int().min(1),
  qty: z.number().finite(),
  seq: z.number().int().min(0),
});
const sessionJournal = z.object({
  entries: z.array(sessionEntry).max(JOURNAL_CAP),
  seq: z.number().int().min(0),
  readSeq: z.number().int().min(0),
});
export const sessionSchema = z.object({
  clock: z.number().min(0).finite(),
  paused: z.boolean(),
  journal: sessionJournal,
});

export type SessionData = z.infer<typeof sessionSchema>;

/** A session's clock and pause, on their own (kept when its Journal doesn't read). */
export const sessionHead = z.object({ clock: sessionSchema.shape.clock, paused: sessionSchema.shape.paused });
/** A session Journal's counters, on their own. */
export const sessionCounts = z.object({ seq: sessionJournal.shape.seq, readSeq: sessionJournal.shape.readSeq });
