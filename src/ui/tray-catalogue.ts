import type { GameMode } from "../game/modes";
import type { CarKind, CarLook } from "../sim";
import { kitForAsset, type PieceTypeId } from "../track";
import { fileOf, loadFile } from "../catalogue/registry";
import type { RoadPieceId } from "../roads";
import { BRIDGE_PROP_SHELVES, PROP_TABS, type PropShelf } from "../catalogue/shelves";

/**
 * What the tray offers, as data: tabs, each holding shelves (groups), each holding items. Which tabs show depends on
 * the mode: Sandbox has everything, Game mode the railway itself.
 */
export type TrayItem =
  /** `unlearned: "hide"`: in Game mode, not shown until its blueprint is learned (a railway kit), not shown "Locked". */
  | { kind: "piece"; type: PieceTypeId; label: string; auto?: boolean; unlearned?: "hide" }
  | { kind: "train"; cars: CarKind[]; looks?: CarLook[]; label: string; unlearned?: "hide" }
  /** A catalogue model, placed as a decorative prop. */
  | { kind: "prop"; asset: string; label: string; unlearned?: "hide" }
  /** A road piece (the Roads tab): fills one square, snaps to the roads beside it. */
  | { kind: "road"; piece: RoadPieceId; label: string; auto?: boolean }
  /** A land-editing tool (the Land tab): chosen with a tap, then used by tapping the land. */
  | { kind: "tool"; tool: LandTool; label: string };

/** Land-editing tools: move the map's scenery (trees, fields, the shed), or raise or lower a square a block. */
export type LandTool = "move" | "raise" | "lower";

export const TRACK_ITEMS: TrayItem[] = [
  // Starts as a long straight and shrinks (in 18 mm steps) to meet a free end along its line.
  { kind: "piece", type: "straight-216", label: "Auto", auto: true },
  { kind: "piece", type: "straight-216", label: "Long" },
  { kind: "piece", type: "straight-144", label: "Medium" },
  { kind: "piece", type: "straight-108", label: "Short" },
  { kind: "piece", type: "straight-54", label: "Mini" },
  { kind: "piece", type: "straight-36", label: "Tiny" },
  { kind: "piece", type: "straight-288", label: "Extra long" },
  { kind: "piece", type: "curve-large", label: "Curve" },
  { kind: "piece", type: "curve-small", label: "Tight curve" },
  { kind: "piece", type: "curve-wide", label: "Wide curve" },
  { kind: "piece", type: "s-curve", label: "S-curve" },
  { kind: "piece", type: "s-curve-short", label: "Short S" },
  { kind: "piece", type: "switch", label: "Switch" },
  { kind: "piece", type: "switch-y", label: "Y switch" },
  { kind: "piece", type: "switch-3way", label: "Three-way" },
  { kind: "piece", type: "crossing", label: "Crossing" },
  { kind: "piece", type: "crossing-45", label: "45° crossing" },
  { kind: "piece", type: "signal", label: "Signal" },
  { kind: "piece", type: "crossover", label: "Crossover" },
  { kind: "piece", type: "double-straight", label: "Double track" },
  { kind: "piece", type: "double-curve", label: "Double curve" },
  { kind: "piece", type: "ramp-curve", label: "Curved ramp" },
  { kind: "piece", type: "ramp-curve-small", label: "Tight curved ramp" },
  { kind: "piece", type: "ramp-curve-wide", label: "Wide curved ramp" },
  { kind: "piece", type: "balloon-loop-small", label: "Small loop" },
  { kind: "piece", type: "wye", label: "Wye" },
  { kind: "piece", type: "ramp", label: "Ramp" },
  { kind: "piece", type: "bridge", label: "Bridge" },
  { kind: "piece", type: "bridge-curve", label: "Curved bridge" },
  { kind: "piece", type: "riser", label: "Riser" },
  { kind: "piece", type: "buffer", label: "Buffer" },
  { kind: "piece", type: "buffer-turnback", label: "Turnback" },
  { kind: "piece", type: "balloon-loop", label: "Balloon loop" },
];

export const TRAIN_ITEMS: TrayItem[] = [
  { kind: "train", cars: ["engine", "hopper", "passenger", "caboose"], label: "Full train" },
  { kind: "train", cars: ["engine", "timber", "timber", "timber"], label: "Flatbed train" },
  { kind: "train", cars: ["engine"], label: "Engine" },
  { kind: "train", cars: ["engine"], looks: ["tank"], label: "Tank engine" },
  { kind: "train", cars: ["engine"], looks: ["diesel"], label: "Diesel" },
  { kind: "train", cars: ["engine"], looks: ["electric"], label: "Electric" },
  { kind: "train", cars: ["engine"], looks: ["express"], label: "Express" },
  { kind: "train", cars: ["engine"], looks: ["goods"], label: "Goods engine" },
  { kind: "train", cars: ["hopper"], label: "Hopper" },
  { kind: "train", cars: ["timber"], label: "Flatbed wagon" },
  { kind: "train", cars: ["van"], label: "Goods van" },
  // (Game mode's once Scenery kit is learned.)
  { kind: "train", cars: ["cleaner"], label: "Track cleaner", unlearned: "hide" },
  { kind: "train", cars: ["passenger"], label: "Coach" },
  { kind: "train", cars: ["passenger"], looks: ["dining"], label: "Dining car" },
  { kind: "train", cars: ["passenger"], looks: ["sleeper"], label: "Sleeper" },
  { kind: "train", cars: ["passenger"], looks: ["double-decker"], label: "Double-decker" },
  { kind: "train", cars: ["passenger"], looks: ["first-class"], label: "First class" },
  { kind: "train", cars: ["caboose"], label: "Caboose" },
  { kind: "train", cars: ["caboose"], looks: ["bay-window"], label: "Bay caboose" },
];

/** A shelf of the tray: a few related items behind one button. */
export interface TrayGroup {
  label: string;
  items: TrayItem[];
  /** Shown in these modes only (default: wherever its tab is). */
  modes?: readonly GameMode[];
}

const pieces = (...types: PieceTypeId[]) => types.map((t) => TRACK_ITEMS.find((i) => i.kind === "piece" && i.type === t && !i.auto)!);

export const TRACK_GROUPS: TrayGroup[] = [
  { label: "Straight", items: [TRACK_ITEMS[0], ...pieces("straight-288", "straight-216", "straight-144", "straight-108", "straight-54", "straight-36", "double-straight")] },
  { label: "Curve", items: pieces("curve-large", "curve-small", "curve-wide", "s-curve", "s-curve-short", "double-curve") },
  { label: "Switch", items: pieces("switch", "switch-y", "switch-3way", "crossover", "wye", "crossing", "crossing-45", "signal") },
  { label: "Ups & downs", items: pieces("ramp", "ramp-curve", "ramp-curve-small", "ramp-curve-wide", "riser") },
  { label: "Ends", items: pieces("buffer", "buffer-turnback", "balloon-loop", "balloon-loop-small") },
  // (No adapters or dog-bone joiner: any two ends join now. Old maps' adapters and joiners still load.)
];

export const TRAIN_GROUPS: TrayGroup[] = [
  // Made-up trains: Sandbox only. In Game mode a train is made up from its parts (an engine, then its wagons), so no
  // ready-made set picks the cars for the player.
  { label: "Trains", items: TRAIN_ITEMS.slice(0, 2), modes: ["sandbox"] },
  { label: "Engines", items: TRAIN_ITEMS.filter((i) => i.kind === "train" && i.cars.length === 1 && i.cars[0] === "engine") },
  { label: "Wagons", items: TRAIN_ITEMS.filter((i) => i.kind === "train" && i.cars.length === 1 && (i.cars[0] === "hopper" || i.cars[0] === "timber" || i.cars[0] === "van" || i.cars[0] === "cleaner")) },
  { label: "Coaches", items: TRAIN_ITEMS.filter((i) => i.kind === "train" && i.cars.length === 1 && (i.cars[0] === "passenger" || i.cars[0] === "caboose")) },
];

/** Road pieces, on the Roads tab (Sandbox only: in Game mode towns lay their own streets). */
export const ROAD_GROUPS: TrayGroup[] = [
  {
    label: "Roads",
    items: [
      // Takes its shape from the roads around it, and reshapes them to meet it.
      { kind: "road", piece: "straight", label: "Road", auto: true },
      { kind: "road", piece: "straight", label: "Straight" },
      { kind: "road", piece: "curve", label: "Bend" },
      { kind: "road", piece: "tee", label: "T-junction" },
      { kind: "road", piece: "cross", label: "Crossroads" },
      { kind: "road", piece: "end", label: "Dead end" },
      { kind: "road", piece: "zebra", label: "Zebra crossing" },
      { kind: "road", piece: "bridge", label: "Road bridge" },
      // Either half: the one that fits where it's dropped (see RoadPlacer.fit).
      { kind: "road", piece: "ramp-low", label: "Ramp" },
    ],
  },
];

/** The track bridges: a shelf of the Track tab (with the catalogue's decorative bridges after it, in Sandbox). */
export const BRIDGE_GROUPS: TrayGroup[] = [{ label: "Bridges", items: pieces("bridge", "bridge-curve") }];

/** Industries the player builds (Game mode): depot pieces placed like track. */
export const INDUSTRY_GROUPS: TrayGroup[] = [
  {
    label: "Industries",
    items: [
      { kind: "piece", type: "depot-workshop", label: "Workshop" },
      { kind: "piece", type: "depot-school", label: "School" },
      { kind: "piece", type: "depot-sawmill", label: "Sawmill" },
      { kind: "piece", type: "depot-forest", label: "Harvester" },
      { kind: "piece", type: "depot-farm", label: "Farm yard" },
      { kind: "piece", type: "depot-mill", label: "Mill" },
      { kind: "piece", type: "depot-quarry", label: "Quarry" },
      { kind: "piece", type: "depot-mine", label: "Mine" },
      { kind: "piece", type: "depot-foundry", label: "Foundry" },
      { kind: "piece", type: "depot-carpenter", label: "Carpenter's yard" },
      { kind: "piece", type: "depot-smithy", label: "Smithy" },
      { kind: "piece", type: "depot-power", label: "Power station" },
      { kind: "piece", type: "depot-harbour", label: "Harbour" },
      { kind: "piece", type: "depot-warehouse", label: "Warehouse" },
    ],
  },
];

/** A kit piece on Game mode's tray: hidden till its blueprint is learned (see `THING_RULES` for which). */
const kit = (type: PieceTypeId, label: string): TrayItem => ({ kind: "piece", type, label, unlearned: "hide" });
const furniture = (asset: string, label: string): TrayItem => ({ kind: "prop", asset, label, unlearned: "hide" });

/**
 * Game mode's railway kits (src/track/kits.ts) and lineside furniture: the track kits on the Track tab, buildings and
 * services beside the industries. Each shows once its blueprint is learned (Sandbox has them all on its catalogue
 * shelves instead).
 */
export const GAME_TRACK_KITS: TrayGroup = {
  label: "Railway kit",
  modes: ["game"],
  items: [
    kit("kit-semaphore-signal", "Semaphore"),
    kit("kit-colour-light-signal", "Colour light"),
    kit("kit-signal-gantry", "Signal gantry"),
    kit("kit-turntable", "Turntable"),
    kit("kit-transfer-table", "Transfer table"),
  ],
};
export const GAME_KIT_GROUPS: TrayGroup[] = [
  {
    label: "Railway",
    items: [
      kit("kit-engine-shed", "Engine shed"),
      kit("kit-water-tower", "Water tower"),
      kit("kit-coal-stage", "Coal stage"),
      kit("kit-water-crane", "Water crane"),
      kit("kit-coaling-crane", "Coaling crane"),
      kit("kit-roundhouse-segment", "Roundhouse"),
    ],
  },
  {
    label: "Halts",
    items: [kit("kit-country-halt", "Country halt"), kit("kit-mountain-station", "Mountain station"), kit("kit-harbour-station", "Harbour station"), kit("kit-platform-furnished", "Platform")],
  },
  {
    label: "Lineside",
    items: [
      kit("kit-castle-gate", "Castle gate"),
      kit("kit-train-wash", "Train wash"),
      kit("kit-weighbridge", "Weighbridge"),
      furniture("bldg-station-clock", "Station clock"),
      furniture("mech-whistle-post", "Whistle post"),
      furniture("bldg-signal-box", "Signal box"),
      furniture("mech-lever-frame", "Lever frame"),
      furniture("mech-level-crossing", "Level crossing"),
      furniture("mech-gated-crossing", "Gated crossing"),
    ],
  },
];

/**
 * What a shelf shows now: its items but those hidden till learned (`unlearned: "hide"`, by `known`), and none of the
 * shelves left empty. Game mode's first hour sees only what it can use, or will soon (locked pieces show "Locked").
 */
export function shownGroups(groups: readonly TrayGroup[], known: (item: TrayItem) => boolean): TrayGroup[] {
  return groups.map((g) => (g.items.some((i) => "unlearned" in i && i.unlearned === "hide") ? { ...g, items: g.items.filter((i) => !("unlearned" in i && i.unlearned === "hide") || known(i)) } : g)).filter((g) => g.items.length > 0);
}

/** A tab of the tray: its shelves, and the modes that show it. */
export interface TrayTab {
  id: string;
  label: string;
  modes: readonly GameMode[];
  groups: TrayGroup[];
  /** Shelves of catalogue models (Sandbox only), after `groups`: their code loads when the tab is first opened. */
  props?: readonly PropShelf[];
  /**
   * Things come out turned as set in the tray: show Turn (and, for track, Flip) while one of its shelves is open.
   * "turn" for props, which don't mirror.
   */
  orient?: "turn" | "turn-flip";
  /** Land editing is on while this tab is open. */
  land?: boolean;
  /** The player's favourites (★) come first, ahead of the shelves, on this tab. */
  favourites?: boolean;
}

const BOTH: readonly GameMode[] = ["sandbox", "game"];
const SANDBOX: readonly GameMode[] = ["sandbox"];
const GAME: readonly GameMode[] = ["game"];

export const TRAY_TABS: TrayTab[] = [
  { id: "track", label: "Track", modes: BOTH, groups: [...TRACK_GROUPS, ...BRIDGE_GROUPS, GAME_TRACK_KITS], props: BRIDGE_PROP_SHELVES, orient: "turn-flip", favourites: true },
  { id: "trains", label: "Trains", modes: BOTH, groups: TRAIN_GROUPS, favourites: true },
  { id: "industries", label: "Industries", modes: GAME, groups: [...INDUSTRY_GROUPS, ...GAME_KIT_GROUPS], orient: "turn-flip" },
  ...PROP_TABS.map((t): TrayTab => ({ id: t.id, label: t.label, modes: SANDBOX, groups: [], props: t.shelves, orient: "turn" })),
  { id: "roads", label: "Roads", modes: SANDBOX, groups: ROAD_GROUPS, orient: "turn" },
  // Opening the Land tab switches land editing on; the tools act on the land itself.
  {
    id: "land",
    label: "Land",
    modes: SANDBOX,
    land: true,
    groups: [
      {
        label: "Shape",
        items: [
          { kind: "tool", tool: "move", label: "Move" },
          { kind: "tool", tool: "raise", label: "Raise" },
          { kind: "tool", tool: "lower", label: "Lower" },
        ],
      },
    ],
  },
];

/** The tabs a mode shows, in order (outside Sandbox, without catalogue models). */
export function trayTabs(mode: GameMode): TrayTab[] {
  const tabs = TRAY_TABS.filter((t) => t.modes.includes(mode)).map((t) => ({ ...t, groups: t.groups.filter((g) => !g.modes || g.modes.includes(mode)) }));
  if (mode === "sandbox") return tabs;
  // Outside Sandbox: no catalogue shelves (Game mode's kits and furniture are on its own shelves: `GAME_KIT_GROUPS`).
  return tabs.map((t) => ({ ...t, props: undefined }));
}

/** Shelves of catalogue models as tray groups, named from the catalogue (loads the files they're in). */
export async function propGroups(shelves: readonly PropShelf[]): Promise<TrayGroup[]> {
  const names = new Map<string, string>();
  await Promise.all(
    [...new Set(shelves.flatMap((s) => s.assets.map(fileOf)))].map(async (file) => {
      if (!file) return;
      for (const [id, asset] of await loadFile(file)) names.set(id, asset.trayLabel ?? asset.name);
    }),
  );
  return shelves.map((s) => ({ label: s.label, items: s.assets.filter((id) => names.has(id)).map((asset) => shelfItem(asset, names.get(asset)!)) }));
}

/**
 * What a shelf offers for a catalogue model: the kit piece that draws it, where there is one (taking it out holds a
 * piece, which trains use: see src/track/kits.ts), else the model as a prop. (Shelves are Sandbox's only.)
 */
export function shelfItem(asset: string, label: string): TrayItem {
  const kit = kitForAsset(asset);
  return kit ? { kind: "piece", type: kit, label } : { kind: "prop", asset, label };
}

/** Tray thumbnail key for an item. */
export function trayKey(item: TrayItem): string {
  if (item.kind === "piece") return `piece:${item.type}${item.auto ? ":auto" : ""}`;
  if (item.kind === "tool") return `tool:${item.tool}`;
  if (item.kind === "road") return `road:${item.auto ? "auto" : item.piece}`;
  return item.kind === "prop" ? `prop:${item.asset}` : `train:${item.label}`;
}

/** Favourites before the player picks any: the pieces most lines are made of. */
export const DEFAULT_FAVOURITES: readonly string[] = ["piece:straight-216:auto", "piece:straight-144", "piece:curve-large", "piece:switch", "piece:buffer"];

/** Can this item be a favourite (a piece or a train, which come out of the tray)? */
export const canFavourite = (item: TrayItem): boolean => item.kind === "piece" || item.kind === "train";

/** The favourite items found among `groups`, in the order they were picked (keys from other tabs are left out). */
export function favouriteItems(keys: readonly string[], groups: readonly TrayGroup[]): TrayItem[] {
  const byKey = new Map<string, TrayItem>();
  for (const g of groups) for (const item of g.items) if (canFavourite(item)) byKey.set(trayKey(item), item);
  return keys.map((k) => byKey.get(k)).filter((i): i is TrayItem => i !== undefined);
}

/** Favourites with `key` added at the end, or taken out if it's there. */
export function toggleFavourite(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key];
}
