import { CARGO, CARRIES } from "../economy/cargo";
import { ENGINES } from "../game/engines";
import { LIFT_NAME } from "../game/lift-notice";
import type { CarKind, CarLook } from "../sim";
import { isFit, isJoin, isKit, KITS, type KitTypeId, type PieceTypeId } from "../track";
import type { TrayItem } from "./tray-catalogue";

/**
 * What a thing is called, and a line on what it does: the piece card's title and hint (a placed piece tapped), and the
 * tray's details (a long press on a phone, hover with a mouse). Short and plain: a child reads it, and a card at
 * 360 px fits the detail in two lines (`DETAIL_MAX` characters).
 */
export interface ItemInfo {
  readonly name: string;
  readonly detail: string;
}

/** The longest a detail may be (two lines of the card's hint at 360 px). */
export const DETAIL_MAX = 64;

const p = (name: string, detail: string): ItemInfo => ({ name, detail });

/** Every piece the tray offers, and the old ones that still load. Kits and the Auto piece's fits are named below. */
const PIECES: Partial<Record<PieceTypeId, ItemInfo>> = {
  "straight-288": p("Extra long straight", "The longest straight piece."),
  "straight-216": p("Long straight", "A long straight piece."),
  "straight-144": p("Medium straight", "A straight piece, middle length."),
  "straight-108": p("Short straight", "A short straight piece."),
  "straight-54": p("Mini straight", "A very short straight, for small gaps."),
  "straight-36": p("Tiny straight", "The shortest straight, for tiny gaps."),
  "straight-72": p("Straight", "A short straight piece."),
  "straight-90": p("Straight", "A short straight piece."),
  "straight-126": p("Straight", "A straight piece."),
  "straight-162": p("Straight", "A straight piece."),
  "straight-180": p("Straight", "A straight piece."),
  "straight-198": p("Straight", "A long straight piece."),
  "curve-large": p("Curve", "A bend. Eight make a circle."),
  "curve-small": p("Tight curve", "A small, sharp bend. Eight make a small circle."),
  "curve-wide": p("Wide curve", "A big, gentle bend. Eight make a big circle."),
  "s-curve": p("S-curve", "Moves the line over to one side."),
  "s-curve-short": p("Short S", "Moves the line over a little."),
  switch: p("Switch", "One line splits in two. Tap it to change the way."),
  "switch-y": p("Y switch", "Splits into two curves, left and right. Tap to change."),
  "switch-3way": p("Three-way switch", "Splits three ways: left, ahead or right. Tap to change."),
  crossing: p("Crossing", "Two lines cross straight over each other."),
  "crossing-45": p("45° crossing", "Two lines cross at a slant."),
  signal: p("Signal", "Tap it for red or green. Trains stop at red."),
  crossover: p("Crossover", "Double track with a link: trains can change lines."),
  "double-straight": p("Double track", "Two straight lines side by side."),
  "double-curve": p("Double curve", "Two lines bending side by side."),
  "ramp-curve": p("Curved ramp", "Turns a corner and goes up one level."),
  "ramp-curve-small": p("Tight curved ramp", "A sharp turn up one level."),
  "ramp-curve-wide": p("Wide curved ramp", "A gentle turn up one level."),
  "balloon-loop-small": p("Small loop", "Trains go round and come back the way they came."),
  wye: p("Wye", "A track triangle: run in, back out, and come out turned round."),
  ramp: p("Ramp", "Goes up one level, or down."),
  bridge: p("Bridge", "Carries the line over a road or track."),
  "bridge-curve": p("Curved bridge", "A bend up high, over a road or track."),
  riser: p("Riser", "A block to hold track up a level."),
  buffer: p("Buffer", "The end of the line. Trains turn back here."),
  "buffer-turnback": p("Turnback buffer", "The end of the line, with a flag. Trains turn back."),
  "balloon-loop": p("Balloon loop", "Trains go round and come back the way they came."),
  "adapter-peg": p("Adapter", "An old joining piece."),
  "adapter-socket": p("Adapter", "An old joining piece."),
  joiner: p("Joiner", "An old joining piece."),
  station: p("Station", "Trains stop here for passengers."),
  "depot-workshop": p("Workshop", "Bring planks and iron here to build new things."),
  "depot-school": p("School", "Children learn here: it helps your research."),
  "depot-sawmill": p("Sawmill", "Turns logs into planks."),
  "depot-forest": p("Harvester", "Cuts logs in the forest."),
  "depot-farm": p("Farm yard", "Grows grain for the mill."),
  "depot-mill": p("Mill", "Grinds grain into flour."),
  "depot-quarry": p("Quarry", "Cuts stone from the hill."),
  "depot-mine": p("Mine", "Digs up coal and ore."),
  "depot-foundry": p("Foundry", "Makes iron from coal and ore."),
  "depot-carpenter": p("Carpenter's yard", "Makes furniture from planks."),
  "depot-smithy": p("Smithy", "Makes tools from iron."),
  "depot-power": p("Power station", "Burns coal so electric engines can run."),
  "depot-harbour": p("Harbour", "Ships bring and take goods here."),
  "depot-warehouse": p("Warehouse", "Keeps goods until a train takes them."),
};

/** Railway kits (src/track/kits.ts): their track with a building or machine beside it. */
const KIT_INFO: Record<string, ItemInfo> = {
  "kit-platform-furnished": p("Platform", "Passenger trains stop here."),
  "kit-country-halt": p("Country halt", "A little stop where passenger trains wait."),
  "kit-mountain-station": p("Mountain station", "A station up in the hills."),
  "kit-harbour-station": p("Harbour station", "A station by the water."),
  "kit-two-platform-station": p("Two-platform station", "A station on two lines."),
  "kit-grand-terminus": p("Grand terminus", "A big station at the end of the line."),
  "kit-engine-shed": p("Engine shed", "A home for engines to rest in."),
  "kit-roundhouse-segment": p("Roundhouse", "A shed bay for engines, round a turntable."),
  "kit-water-tower": p("Water tower", "Steam engines stop here for water."),
  "kit-coal-stage": p("Coal stage", "Steam engines stop here for coal."),
  "kit-water-crane": p("Water crane", "Steam engines stop here for water."),
  "kit-coaling-crane": p("Coaling crane", "Steam engines stop here for coal."),
  "kit-fuel-station": p("Fuel station", "Diesel engines stop here to fill up."),
  "kit-log-loader": p("Log loader", "Loads logs onto trains."),
  "kit-grain-elevator": p("Grain elevator", "Loads grain into hoppers."),
  "kit-cargo-conveyor": p("Conveyor", "A belt that loads goods onto trains."),
  "kit-coal-chute": p("Coal chute", "Pours coal into hoppers."),
  "kit-gantry-crane": p("Gantry crane", "A big crane that lifts goods on and off."),
  "kit-harbour-crane": p("Harbour crane", "Lifts goods between ships and trains."),
  "kit-magnet-crane": p("Magnet crane", "A crane with a magnet for iron."),
  "kit-tipping-dump": p("Wagon tipper", "Tips wagons over to empty them."),
  "kit-drop-hopper": p("Drop hopper", "Wagons drop their load through the floor."),
  "kit-goods-shed": p("Goods shed", "Trains load and unload goods inside."),
  "kit-weighbridge": p("Weighbridge", "Weighs the wagons as they roll over."),
  "kit-loop-the-loop": p("Loop-the-loop", "Trains go right round, upside down!"),
  "kit-turntable": p("Turntable", "Spins an engine round to face the other way."),
  "kit-transfer-table": p("Transfer table", "Slides an engine across to another line."),
  "kit-train-lift": p(LIFT_NAME, "Lifts a train up or down a level."),
  "kit-train-wash": p("Train wash", "Trains roll through and come out clean."),
  "kit-semaphore-signal": p("Semaphore signal", "An arm signal. Tap it: trains stop at red."),
  "kit-colour-light-signal": p("Colour light signal", "A light signal. Tap it: trains stop at red."),
  "kit-signal-gantry": p("Signal gantry", "Signals over the line. Tap: trains stop at red."),
  "kit-buffer-stop-lamp": p("Buffer stop", "The end of the line, with a lamp."),
  "kit-castle-gate": p("Castle gate", "Trains go in and out through the castle gate."),
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A placed piece's name and what it does. Every piece type has one (pieces.test / piece-info.test). */
export function pieceInfo(type: PieceTypeId): ItemInfo {
  const named = PIECES[type] ?? KIT_INFO[type];
  if (named) return named;
  // The Auto piece's shapes: a straight cut to fit, or an S-bend to meet a free end a little to one side.
  if (isFit(type) || isJoin(type)) return /^fit-\d+-0-/.test(type) ? p("Straight", "Cut to fit the gap.") : p("S-bend", "Moves the line over a little to meet the track.");
  // A kit added without its own line here: its name, from kits.ts.
  if (isKit(type)) return p(capital(KITS[type as KitTypeId].name), "Track with something beside it.");
  return p("Track piece", "A piece of track.");
}

/** Has this piece type a name of its own (not the fallbacks)? For the test that every catalogue piece is named. */
export const hasOwnName = (type: PieceTypeId): boolean => !!(PIECES[type] ?? KIT_INFO[type]) || isFit(type) || isJoin(type);

const listed = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** What a wagon or coach is for. */
const CAR_DETAIL: Record<CarKind, string> = {
  engine: "",
  hopper: "",
  timber: "",
  van: "",
  passenger: "Carries passengers between stations.",
  caboose: "Goes at the back of the train.",
  cleaner: "Brushes the track clean as it runs.",
};

const LOOK_DETAIL: Partial<Record<CarLook, string>> = {
  dining: "Passengers eat on the way.",
  sleeper: "Passengers sleep on long trips.",
  "double-decker": "Two floors of passengers.",
  "first-class": "Comfy seats for passengers.",
  "bay-window": "Goes at the back. Its windows look out to the sides.",
};

/** An engine's numbers, kid-clear: how many cars it pulls, how fast, and what it needs. */
function engineDetail(look: CarLook): string {
  const e = ENGINES[look] ?? ENGINES.classic!;
  const speed = e.speed === 1 ? "usual speed" : e.speed > 1 ? `${e.speed}× as fast` : `${e.speed}× speed`;
  return `Pulls ${e.pulls} cars, ${speed}${e.quick >= 2 ? ", quick to start" : ""}.${e.electric ? " Needs power on." : ""}`;
}

/** A tray item's name and what it does (the details a long press or hover shows). */
export function trayInfo(item: TrayItem): ItemInfo {
  switch (item.kind) {
    case "piece":
      if (item.auto) return p("Auto straight", "Grows or shrinks to fit the gap it meets.");
      return pieceInfo(item.type);
    case "train": {
      if (item.cars.length > 1) return p(item.label, `An engine and ${item.cars.length - 1} cars, ready to go.`);
      const kind = item.cars[0];
      const look = item.looks?.[0] ?? "classic";
      if (kind === "engine") return p(item.label, engineDetail(look));
      const carries = CARRIES[kind];
      if (carries) return p(item.label, `Carries ${listed(carries.map((c) => CARGO[c].label.toLowerCase()))}.`);
      return p(item.label, LOOK_DETAIL[look] ?? CAR_DETAIL[kind]);
    }
    case "road":
      return p(item.auto ? "Auto road" : item.label, item.auto ? "Takes its shape from the roads beside it." : "A road piece. Cars drive on it.");
    case "tool":
      return p(item.label, item.tool === "move" ? "Drag trees, fields and the shed to move them." : item.tool === "raise" ? "Tap the land to raise it a block." : "Tap the land to lower it a block.");
    case "prop":
      return p(item.label, "A model to put by your railway.");
  }
}
