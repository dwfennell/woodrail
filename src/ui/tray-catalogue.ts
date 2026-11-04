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
  /** `gameDetail`: what it does in Game mode, shown with its name (a tooltip; a tap on a phone). */
  | { kind: "train"; cars: CarKind[]; looks?: CarLook[]; label: string; unlearned?: "hide"; gameDetail?: string }
  /** A catalogue model, placed as a decorative prop. */
  | { kind: "prop"; asset: string; label: string; unlearned?: "hide" }
  /** A road piece (the Roads tab): fills one square, snaps to the roads beside it. */
  | { kind: "road"; piece: RoadPieceId; label: string; auto?: boolean; unlearned?: "hide" }
  /** A land-editing tool (the Land tab): chosen with a tap, then used by tapping the land. */
  | { kind: "tool"; tool: LandTool; label: string }
  /**
   * A signal (signals spec §4): dragged onto laid track it goes on a joint, facing the way the finger moved; tapped,
   * it's ready (the Signal tool): each tap on the track then puts one on the nearest joint.
   */
  | { kind: "signal"; label: string };

/** The Signal (a mark on a joint, not a piece: the old signal pieces and their skins are no longer offered). */
export const SIGNAL_ITEM: TrayItem = { kind: "signal", label: "Signal" };

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
  { kind: "piece", type: "underpass", label: "Underpass" },
  { kind: "piece", type: "riser", label: "Riser" },
  { kind: "piece", type: "buffer", label: "Buffer" },
  { kind: "piece", type: "buffer-turnback", label: "Turnback" },
  { kind: "piece", type: "balloon-loop", label: "Balloon loop" },
];

/** A caboose's tray detail in Game mode: at a train's tail it makes the train a tenth faster (`CABOOSE_BONUS`). */
export const CABOOSE_DETAIL = "Makes its train a bit faster";

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
  // (Game mode's once Dairy farm is learned.)
  { kind: "train", cars: ["tanker"], label: "Milk tank wagon", unlearned: "hide" },
  // (Game mode's once Cold van is learned.)
  { kind: "train", cars: ["reefer"], label: "Cold van", unlearned: "hide" },
  // (Game mode's once Car carrier is learned.)
  { kind: "train", cars: ["carrier"], label: "Car carrier", unlearned: "hide" },
  // (Game mode's once Scenery kit is learned.)
  { kind: "train", cars: ["cleaner"], label: "Track cleaner", unlearned: "hide" },
  { kind: "train", cars: ["passenger"], label: "Coach" },
  { kind: "train", cars: ["passenger"], looks: ["dining"], label: "Dining car" },
  { kind: "train", cars: ["passenger"], looks: ["sleeper"], label: "Sleeper" },
  { kind: "train", cars: ["passenger"], looks: ["double-decker"], label: "Double-decker" },
  { kind: "train", cars: ["passenger"], looks: ["first-class"], label: "First class" },
  { kind: "train", cars: ["caboose"], label: "Caboose", gameDetail: CABOOSE_DETAIL },
  { kind: "train", cars: ["caboose"], looks: ["bay-window"], label: "Bay caboose", gameDetail: CABOOSE_DETAIL },
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
  { label: "Switch", items: [...pieces("switch", "switch-y", "switch-3way", "crossover", "wye", "crossing", "crossing-45"), SIGNAL_ITEM] },
  { label: "Ups & downs", items: pieces("ramp", "ramp-curve", "ramp-curve-small", "ramp-curve-wide", "riser") },
  { label: "Ends", items: pieces("buffer", "buffer-turnback", "balloon-loop", "balloon-loop-small") },
  // (No adapters or dog-bone joiner: any two ends join now. Old maps' adapters and joiners still load.)
];

export const TRAIN_GROUPS: TrayGroup[] = [
  // Made-up trains: Sandbox only. In Game mode a train is made up from its parts (an engine, then its wagons), so no
  // ready-made set picks the cars for the player.
  { label: "Trains", items: TRAIN_ITEMS.slice(0, 2), modes: ["sandbox"] },
  { label: "Engines", items: TRAIN_ITEMS.filter((i) => i.kind === "train" && i.cars.length === 1 && i.cars[0] === "engine") },
  { label: "Wagons", items: TRAIN_ITEMS.filter((i) => i.kind === "train" && i.cars.length === 1 && (i.cars[0] === "hopper" || i.cars[0] === "timber" || i.cars[0] === "van" || i.cars[0] === "tanker" || i.cars[0] === "reefer" || i.cars[0] === "carrier" || i.cars[0] === "cleaner")) },
  { label: "Coaches", items: TRAIN_ITEMS.filter((i) => i.kind === "train" && i.cars.length === 1 && (i.cars[0] === "passenger" || i.cars[0] === "caboose")) },
];

/**
 * Road pieces, on the Roads tab (in Game mode once Roads is learned; a piece whose own blueprint isn't learned yet, the
 * zebra's or the bridge's and ramps', stays off the tray: `unlearned`, by `ROAD_TECH`).
 */
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
      { kind: "road", piece: "zebra", label: "Zebra crossing", unlearned: "hide" },
      { kind: "road", piece: "bridge", label: "Road bridge", unlearned: "hide" },
      // Either half: the one that fits where it's dropped (see RoadPlacer.fit).
      { kind: "road", piece: "ramp-low", label: "Ramp", unlearned: "hide" },
    ],
  },
];

/** The track bridges: a shelf of the Track tab (with the catalogue's decorative bridges after it, in Sandbox). */
export const BRIDGE_GROUPS: TrayGroup[] = [{ label: "Bridges", items: pieces("bridge", "bridge-curve", "underpass") }];

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
      { kind: "piece", type: "depot-dairy", label: "Dairy farm" },
      { kind: "piece", type: "depot-bakery", label: "Bakery" },
      { kind: "piece", type: "depot-orchard", label: "Orchard" },
      { kind: "piece", type: "depot-juicer", label: "Juice works" },
      { kind: "piece", type: "depot-creamery", label: "Creamery" },
      { kind: "piece", type: "depot-icecream", label: "Ice cream factory" },
      { kind: "piece", type: "depot-quarry", label: "Quarry" },
      { kind: "piece", type: "depot-mine", label: "Mine" },
      { kind: "piece", type: "depot-foundry", label: "Foundry" },
      { kind: "piece", type: "depot-brickworks", label: "Brickworks" },
      { kind: "piece", type: "depot-carworks", label: "Car factory" },
      { kind: "piece", type: "depot-carpenter", label: "Carpenter's yard" },
      { kind: "piece", type: "depot-smithy", label: "Smithy" },
      { kind: "piece", type: "depot-power", label: "Power station" },
      { kind: "piece", type: "depot-harbour", label: "Harbour" },
      { kind: "piece", type: "depot-warehouse", label: "Warehouse" },
    ],
  },
];

/**
 * Sandbox's industries (free, as everything there): the goods chains' makers and users, and a warehouse. Not the
 * workshop or school (Game mode's research and building), nor the harbour (Game mode's boats). Each works from what's
 * around it, as in Game mode (a harvester by trees, a farm yard by a field); its card says what it lacks.
 */
export const SANDBOX_INDUSTRY_GROUPS: TrayGroup[] = [
  {
    label: "Industries",
    items: INDUSTRY_GROUPS[0].items.filter((i) => i.kind === "piece" && !["depot-workshop", "depot-school", "depot-harbour"].includes(i.type)),
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
    // (The signal skins are a Signal's styles now, on its card: signals spec §4, §9.)
    kit("kit-turntable", "Turntable"),
    kit("kit-transfer-table", "Transfer table"),
    kit("kit-train-lift", "Train lift"),
    kit("kit-loop-the-loop", "Loop-the-loop"),
    kit("kit-buffer-stop-lamp", "Buffer stop"),
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
      kit("kit-fuel-station", "Fuel station"),
    ],
  },
  {
    label: "Stations",
    items: [kit("kit-two-platform-station", "Two-platform station"), kit("kit-grand-terminus", "Terminus")],
  },
  {
    label: "Yard",
    items: [
      kit("kit-log-loader", "Log loader"),
      kit("kit-grain-elevator", "Grain elevator"),
      kit("kit-drop-hopper", "Drop hopper"),
      kit("kit-goods-shed", "Goods shed"),
      kit("kit-gantry-crane", "Gantry crane"),
      kit("kit-magnet-crane", "Magnet crane"),
      kit("kit-harbour-crane", "Harbour crane"),
      kit("kit-cargo-conveyor", "Conveyor"),
      kit("kit-tipping-dump", "Wagon tipper"),
      kit("kit-coal-chute", "Coal chute"),
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
      furniture("mech-telegraph-pole", "Telegraph pole"),
      furniture("mech-level-crossing", "Level crossing"),
      furniture("mech-gated-crossing", "Gated crossing"),
      furniture("scene-bus-stop", "Bus stop"),
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
  /** In Game mode, shown only once this blueprint is learned (the Roads tab: Roads). */
  gameTech?: string;
  /** Game mode's tabs: its picture, shown in place of the word only when the tabs don't fit beside the tools (a 360 px phone). */
  icon?: string;
}

const BOTH: readonly GameMode[] = ["sandbox", "game"];
const SANDBOX: readonly GameMode[] = ["sandbox"];
const GAME: readonly GameMode[] = ["game"];

export const TRAY_TABS: TrayTab[] = [
  { id: "track", label: "Track", icon: "🛤️", modes: BOTH, groups: [...TRACK_GROUPS, ...BRIDGE_GROUPS, GAME_TRACK_KITS], props: BRIDGE_PROP_SHELVES, orient: "turn-flip", favourites: true },
  { id: "trains", label: "Trains", icon: "🚂", modes: BOTH, groups: TRAIN_GROUPS, favourites: true },
  { id: "industries", label: "Industries", icon: "🏭", modes: GAME, groups: [...INDUSTRY_GROUPS, ...GAME_KIT_GROUPS], orient: "turn-flip" },
  // Sandbox's: the industries alone (its kits are on the catalogue's shelves), free, to make goods chains with.
  { id: "industries", label: "Industries", icon: "🏭", modes: SANDBOX, groups: SANDBOX_INDUSTRY_GROUPS, orient: "turn-flip" },
  ...PROP_TABS.map((t): TrayTab => ({ id: t.id, label: t.label, modes: SANDBOX, groups: [], props: t.shelves, orient: "turn" })),
  // (Game mode's once Roads is learned: spec 2026-10-31-roads.md. Its zebra, bridge and ramps wait for their blueprints.)
  { id: "roads", label: "Roads", icon: "🛣️", modes: BOTH, groups: ROAD_GROUPS, orient: "turn", gameTech: "roads" },
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
  if (item.kind === "signal") return "signal";
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
