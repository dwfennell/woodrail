import { FEAT_BUILDING, FEAT_NONE, FEAT_STATION, FEAT_TREE, SURF_GRASS, SURF_TOWN, type Landscape, type Town } from "../landscape";
import { plotSlotOf } from "../landscape/edit";
import { buildingPose, findBuilding, looksOf } from "../props/towns";
import { createSample, getPieceDef, kitOf, pathLength, samplePath, TRACK_WIDTH, type PieceTypeId, type Pose } from "../track";
import { MAX_REACH } from "./town-growth";
import { lotFor, movableBuilding, moveBuilding, type LotChecker, type TownLot } from "./town-moves";
import type { World } from "./world";
import { YARD_INSET, YARD_STEP } from "./depot-footprint";

/**
 * Game mode, Big stations learned: a town's station upgraded in place to a big station's kit (the user: "upgrade
 * existing stations in place?"). The station piece is retyped (`Layout.retype`: same id, so its depot, the stops of
 * routes and lines, and trains standing on it are kept; its track becomes the kit's first road). Town houses in the
 * kit's way move to the nearest free lots of their town that face a street (the town-move rules, #18), keeping their
 * storeys; anything else in the way (track, a street, a depot, a site, a hill, another town's house) refuses it, as a
 * drop would say. The squares it covers become the station's. One undo step (see `Editor.retype`).
 */
export const STATION_UPGRADES = ["kit-two-platform-station", "kit-grand-terminus"] as const;
export type StationUpgrade = (typeof STATION_UPGRADES)[number];

export const UPGRADE_NAMES: Record<StationUpgrade, string> = { "kit-two-platform-station": "Two-platform station", "kit-grand-terminus": "Terminus" };

/** What undo says while track is joined to a road the plain station hasn't. */
export const UPGRADE_UNDO_REFUSED = "Take up the track joined to the station's new roads first";

/** An upgrade worked out (`planUpgrade`): the kit, and the houses that move out of its way, each to its lot. */
export interface UpgradePlan {
  readonly type: StationUpgrade;
  readonly townId: number;
  readonly stationId: number;
  readonly moves: readonly { readonly building: number; readonly lot: TownLot }[];
  /** The squares the kit stands on. */
  readonly covered: readonly number[];
}

const sample = createSample();

/** The squares a big station's kit at `pose` stands on: its platforms and buildings, and its roads. */
export function coveredCells(land: Landscape, type: PieceTypeId, pose: Pose): number[] {
  const g = land.grid;
  const kit = kitOf(type);
  const c = Math.cos(pose.heading);
  const s = Math.sin(pose.heading);
  const out = new Set<number>();
  const add = (t: number, l: number) => {
    const i = g.cellAtWorld(pose.x + t * c - l * s, pose.z + t * s + l * c);
    if (i !== -1) out.add(i);
  };
  for (const r of kit?.footprint ?? []) {
    if (r.overhead) continue;
    const w = Math.max(0, r.w - 2 * YARD_INSET);
    const d = Math.max(0, r.d - 2 * YARD_INSET);
    const nt = Math.max(1, Math.ceil(w / YARD_STEP));
    const nl = Math.max(1, Math.ceil(d / YARD_STEP));
    for (let i = 0; i <= nt; i++) for (let k = 0; k <= nl; k++) add(r.t - w / 2 + (w * i) / nt, r.l - d / 2 + (d * k) / nl);
  }
  const half = TRACK_WIDTH / 2 - YARD_INSET;
  for (const path of getPieceDef(type, false).paths) {
    const len = pathLength(path.geom);
    const n = Math.max(1, Math.ceil(len / YARD_STEP));
    for (let i = 0; i <= n; i++) {
      samplePath(path.geom, YARD_INSET + ((len - 2 * YARD_INSET) * i) / n, sample);
      const ac = -Math.sin(sample.heading);
      const as = Math.cos(sample.heading);
      for (const l of [-half, 0, half]) add(sample.x + ac * l, sample.z + as * l);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/** The nearest free lot of its town facing a street for house `building`, clear of `covered` (null if none). */
function freeLot(land: Landscape, building: number, covered: ReadonlySet<number>, checker: LotChecker): TownLot | null {
  const found = findBuilding(land, building);
  if (!found) return null;
  const g = land.grid;
  const { town } = found;
  const from = found.building.cells[0];
  const fx = g.centreX(g.colOf(from));
  const fz = g.centreZ(g.rowOf(from));
  const reach = Math.ceil(MAX_REACH / 72) + 1;
  const centre = g.cellAtWorld(town.centre.x, town.centre.z);
  if (centre === -1) return null;
  const candidates: { i: number; d: number }[] = [];
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) {
      const i = g.index(g.colOf(centre) + dc, g.rowOf(centre) + dr);
      if (i === -1 || covered.has(i) || g.feature[i] !== FEAT_NONE) continue;
      if (g.surface[i] !== SURF_TOWN && g.surface[i] !== SURF_GRASS) continue;
      candidates.push({ i, d: Math.hypot(g.centreX(g.colOf(i)) - fx, g.centreZ(g.rowOf(i)) - fz) });
    }
  }
  candidates.sort((a, b) => a.d - b.d || a.i - b.i);
  for (const { i } of candidates) {
    const lot = lotFor(land, building, i, checker);
    if (typeof lot === "string" || lot.swap !== undefined || lot.cells.some((c) => covered.has(c))) continue;
    return lot;
  }
  return null;
}

/** The squares the plan changes (the kit's, and the moved houses' old and new), as land plot slots. */
function slotsOf(land: Landscape, town: Town, covered: readonly number[], moved: readonly number[]): number[] {
  const g = land.grid;
  const centre = g.cellAtWorld(town.centre.x, town.centre.z);
  return [...new Set([...covered, ...moved, ...(centre === -1 ? [] : [centre])].map(plotSlotOf))];
}

/**
 * Can town `townId`'s station become a `type`, and how: the plan, or why not in words. Tries it out on the land (the
 * houses moved, the kit's squares cleared) and asks the game's own drop rule (`placeWhy`: track, streets, depots,
 * sites, hills), then puts everything back. A terminus only at the end of a line: its roads end in buffers, so no
 * track may be joined past the platform's far end. Cheap enough for a card (not run per frame).
 */
export function planUpgrade(w: World, townId: number, type: StationUpgrade, checker: LotChecker, placeWhy: (type: PieceTypeId, pose: Pose, y: number, ignoreId: number) => string | null): UpgradePlan | string {
  const land = w.landscape;
  const g = land.grid;
  const town = land.towns.find((t) => t.id === townId);
  const stationId = w.stations.get(townId);
  const piece = stationId === undefined ? undefined : w.layout.getPiece(stationId);
  if (!town || stationId === undefined || !piece) return "There's no station here";
  if (piece.type !== "station") return "This station is upgraded already";
  if (!w.layout.canRetype(stationId, type)) return type === "kit-grand-terminus" ? "A terminus goes only at the end of a line: no track past the platform's far end" : "Take up the track joined to the station first";
  const covered = coveredCells(land, type, piece.pose);
  const coveredSet = new Set(covered);
  const toMove: number[] = [];
  for (const i of covered) {
    if (g.feature[i] !== FEAT_BUILDING || toMove.includes(g.owner[i])) continue;
    const found = findBuilding(land, g.owner[i]);
    if (!found || found.town.id !== townId) return "Another town's house is in the way";
    if (!movableBuilding(land, found.building.id)) return "The town's landmark is in the way";
    toMove.push(found.building.id);
  }
  const back: (() => void)[] = [];
  const moves: { building: number; lot: TownLot }[] = [];
  try {
    for (const b of toMove) {
      const lot = freeLot(land, b, coveredSet, checker);
      if (!lot) return `No free lot in ${town.name} for a house in the way`;
      back.push(moveBuilding(land, b, lot));
      moves.push({ building: b, lot });
    }
    // The kit's squares as it would have them (its own station's squares, greens and trees cleared), for the drop rule.
    const before = covered.map((i) => [i, g.feature[i], g.owner[i], g.surface[i]] as const);
    back.push(() => {
      for (const [i, f, o, s] of before) {
        g.feature[i] = f;
        g.owner[i] = o;
        g.surface[i] = s;
      }
    });
    for (const i of covered) {
      const own = g.feature[i] === FEAT_STATION && g.owner[i] === townId;
      if (!own && g.feature[i] !== FEAT_NONE && g.feature[i] !== FEAT_TREE) continue;
      g.feature[i] = FEAT_NONE;
      g.owner[i] = -1;
      if (g.surface[i] === SURF_TOWN) g.surface[i] = SURF_GRASS;
    }
    const why = placeWhy(type, piece.pose, piece.y, stationId);
    if (why) return why;
  } finally {
    for (let k = back.length - 1; k >= 0; k--) back[k]();
  }
  return { type, townId, stationId, moves, covered };
}

/**
 * The land side of an upgrade (`plan` from `planUpgrade`, on the land as it was planned on), as an undo step's part:
 * the houses moved (records, squares and props: their storeys stay), the kit's squares made the station's (trees and
 * greens there gone), and the town marked upgraded (its station house and sign not drawn). The caller does `do` once,
 * then retypes the station (`Editor.retype`). `slots`: the land plots to redraw.
 */
export function upgradeLand(w: World, plan: UpgradePlan): { do(): void; undo(): void; slots: () => number[] } {
  const land = w.landscape;
  const g = land.grid;
  const town = land.towns.find((t) => t.id === plan.townId)!;
  const props = plan.moves.map(({ building, lot }) => {
    const found = findBuilding(land, building)!;
    const prop = [...w.props.all()].find((p) => p.building === building);
    const look = looksOf(land, found.town).get(building) ?? "house";
    const to = prop ? { ...buildingPose(land, found.town, { ...found.building, cells: lot.cells, front: lot.front }, look, prop.asset, prop.scale ?? 1), y: g.groundY(lot.cells[0]) } : null;
    const from = prop ? { x: prop.x, z: prop.z, heading: prop.heading, y: prop.y } : null;
    return { prop, to, from, oldCells: [...found.building.cells] };
  });
  const moved = [...props.flatMap((p) => p.oldCells), ...plan.moves.flatMap((m) => m.lot.cells)];
  const slots = slotsOf(land, town, plan.covered, moved);
  let back: (() => void)[] = [];
  return {
    do: () => {
      back = [];
      plan.moves.forEach(({ building, lot }, k) => {
        back.push(moveBuilding(land, building, lot));
        const p = props[k];
        if (p.prop && p.to) w.props.move(p.prop.id, p.to);
      });
      const before = plan.covered.map((i) => [i, g.feature[i], g.owner[i], g.surface[i]] as const);
      back.push(() => {
        for (const [i, f, o, s] of before) {
          g.feature[i] = f;
          g.owner[i] = o;
          g.surface[i] = s;
        }
      });
      for (const i of plan.covered) {
        g.feature[i] = FEAT_STATION;
        g.owner[i] = plan.townId;
      }
      town.upgraded = plan.type;
      for (const s of slots) g.touch(s);
    },
    undo: () => {
      delete town.upgraded;
      for (let k = back.length - 1; k >= 0; k--) back[k]();
      back = [];
      props.forEach((p) => {
        if (p.prop && p.from) w.props.move(p.prop.id, p.from);
      });
      for (const s of slots) g.touch(s);
    },
    slots: () => slots,
  };
}
