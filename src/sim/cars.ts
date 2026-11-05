export type CarKind = "engine" | "hopper" | "passenger" | "caboose" | "timber" | "van" | "cleaner" | "tanker" | "reefer" | "carrier" | "oiltank" | "crane" | "mailvan";
export type Pole = "N" | "S";

export interface CarSpec {
  readonly kind: CarKind;
  /** Index used in snapshots. */
  readonly index: number;
  /** Buffer face to buffer face, magnets included (mm). */
  readonly length: number;
  /** Distance from each end face to the nearest axle (mm). */
  readonly bogieInset: number;
  readonly width: number;
  readonly mass: number;
  readonly powered: boolean;
}

export const CAR_SPECS: Record<CarKind, CarSpec> = {
  engine: { kind: "engine", index: 0, length: 96, bogieInset: 20, width: 32, mass: 3, powered: true },
  hopper: { kind: "hopper", index: 1, length: 80, bogieInset: 18, width: 32, mass: 1, powered: false },
  passenger: { kind: "passenger", index: 2, length: 88, bogieInset: 18, width: 32, mass: 1, powered: false },
  caboose: { kind: "caboose", index: 3, length: 76, bogieInset: 18, width: 32, mass: 1, powered: false },
  timber: { kind: "timber", index: 4, length: 84, bogieInset: 18, width: 32, mass: 1, powered: false },
  // A closed goods van (flour): the timber wagon's length and running gear.
  van: { kind: "van", index: 5, length: 84, bogieInset: 18, width: 32, mass: 1, powered: false },
  // The track cleaning wagon (Sandbox): brushes underneath that turn as it runs. Carries nothing.
  cleaner: { kind: "cleaner", index: 6, length: 80, bogieInset: 18, width: 32, mass: 1, powered: false },
  // A milk tank wagon (Game mode's Dairy farm): the van's length and running gear, a white barrel on top.
  tanker: { kind: "tanker", index: 7, length: 84, bogieInset: 18, width: 32, mass: 1, powered: false },
  // A cold van (Game mode's Cold van): the van's length and running gear, white and insulated.
  reefer: { kind: "reefer", index: 8, length: 84, bogieInset: 18, width: 32, mass: 1, powered: false },
  // A car carrier (Game mode's Car carrier): the van's length and running gear, two open decks of new cars.
  carrier: { kind: "carrier", index: 9, length: 84, bogieInset: 18, width: 32, mass: 1, powered: false },
  // A tank wagon (Game mode's Tank wagons): the van's length and running gear, a black barrel for oil or water.
  oiltank: { kind: "oiltank", index: 10, length: 84, bogieInset: 18, width: 32, mass: 1, powered: false },
  // The breakdown crane (Game mode's Breakdown crane): a red crane on a heavy wagon that lifts derailed or stuck trains.
  crane: { kind: "crane", index: 11, length: 88, bogieInset: 18, width: 32, mass: 2, powered: false },
  // A mail van (Game mode's Post office): the van's length and running gear, red, with a letter slot.
  // (Index 15: 10-11 are tank wagons' and the crane; 12-14 are unused.)
  mailvan: { kind: "mailvan", index: 15, length: 84, bogieInset: 18, width: 32, mass: 1, powered: false },
};

/**
 * How a car looks: the same car underneath (length, speed, what it carries), in a different body. Each kind's first
 * look is its usual one.
 */
export type CarLook = "classic" | "tank" | "diesel" | "electric" | "dining" | "sleeper" | "double-decker" | "bay-window" | "express" | "first-class" | "goods";
export const CAR_LOOKS: Record<CarKind, readonly CarLook[]> = {
  engine: ["classic", "tank", "diesel", "electric", "express", "goods"],
  hopper: ["classic"],
  passenger: ["classic", "dining", "sleeper", "double-decker", "first-class"],
  caboose: ["classic", "bay-window"],
  timber: ["classic"],
  van: ["classic"],
  cleaner: ["classic"],
  tanker: ["classic"],
  reefer: ["classic"],
  carrier: ["classic"],
  oiltank: ["classic"],
  crane: ["classic"],
  mailvan: ["classic"],
};
export const ALL_CAR_LOOKS: readonly CarLook[] = ["classic", "tank", "diesel", "electric", "dining", "sleeper", "double-decker", "bay-window", "express", "first-class", "goods"];

/** In snapshot-index order. */
export const CAR_KINDS: readonly CarKind[] = ["engine", "hopper", "passenger", "caboose", "timber", "van", "cleaner", "tanker", "reefer", "carrier", "oiltank", "crane", "mailvan"];

/** Each car kind by its snapshot index (`CAR_SPECS[k].index`; indices can leave gaps, as other branches take ranges). */
export const CAR_BY_INDEX: readonly CarKind[] = (() => {
  const out: CarKind[] = [];
  for (const k of CAR_KINDS) out[CAR_SPECS[k].index] = k;
  return out;
})();

/** Gap between two coupled cars' end faces (mm). */
export const COUPLER_GAP = 2;

export const opposite = (p: Pole): Pole => (p === "N" ? "S" : "N");
