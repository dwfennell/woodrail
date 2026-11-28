/**
 * The save's limits against what the game can reach (2026-11-23: a warehouse stacked by Lift and load held 72 planks
 * against a schema limit of 40, and the player's whole game was turned away, then saved over).
 *
 * Every upper bound in the save's schemas (`schemaBounds`) is listed here with the most the game can legitimately put
 * there, worked out from the game's own constants and rules. The guard fails when:
 * - a bound in the schema isn't listed (a new limit: say here what the game reaches there, and why);
 * - a listed bound is no longer in the schema (a stale row: take it out);
 * - what the game reaches is over the bound (raise the limit, or derive it from the game's constant);
 * - a count the game never caps (trains, cars, pieces, towns, coins, deliveries, the clock…) has a bound at all.
 * The round trip at those maxima, built through the game's own rules, is in save-maxima.test.ts.
 */
import { describe, expect, it } from "vitest";
import { capAt, CARGO_KINDS, CARGO_SLOTS, LIFT_STACK, loungeCap, MAX_SHEDS, MAX_WAGON_CAPACITY, RECIPES, WAGON_CAPACITY, type DepotRole, type DepotState } from "../economy";
import { ENGINE_SPEED } from "../sim/brakes";
import { MAX_ENGINE_NAME } from "../sim";
import { getPieceDef, MAX_CONNECTORS, PIECE_TYPES } from "../track";
import { ALTERNATES } from "../landscape/secrets";
import { TOWN_NAME_PREFIXES, TOWN_NAMES } from "../landscape/generate";
import { MOST_STOREYS } from "../props/storeys";
import { ROW_BODIES, ROW_ROOFS } from "../props/rows";
import { COLOR_VARIANTS } from "../render/props/library";
import { CATALOGUE } from "../catalogue/assets";
import { BOILERS_BONUS, CABOOSE_BONUS, ENGINES, STEAM } from "../game/engines";
import { SEATS, waitingCap } from "../game/passengers";
import { VISITORS_CAP } from "../game/airports";
import { VAN_YARD } from "../game/delivery-vans";
import { MAX_TRACKS } from "../game/depot-tracks";
import { PLACES } from "../game/places";
import { GRANDS } from "../game/grand";
import { LINE_COLOURS, LINE_NAME_MAX, MAX_VIAS } from "../game/lines";
import { BARGE_LOADS, BOAT_NAMES, MAX_BARGES, MAX_BOATS } from "../game/boats";
import { YARD_COSTS } from "../game/yards";
import { LIVERIES, ownLivery, PAINT_COLOURS } from "../game/paint-shop";
import { Journal, JOURNAL_CAP, JOURNAL_KEY_MAX, JOURNAL_POINTS_MAX, JOURNAL_TEXT_MAX } from "../game/journal";
import { DETECTORS } from "../game/situation-tips";
import { Progress } from "../game/progress";
import { TECHS } from "../game/tech";
import { buildStarterWorld } from "../game/world";
import { NAME_MAX, SlotStore, UNREADABLE_PREFIX } from "./slots";
import { LOG_LINES, LOG_VISITS, RIDERS } from "../economy/history";
import { GAME_SLOT_KEYS, serializeWorld } from "./save";
import { saveSchema, sessionSchema } from "./save-schema";
import { schemaBounds, type Bound } from "./schema-bounds";

const longest = (xs: Iterable<string>): number => Math.max(...[...xs].map((x) => x.length));
const most = (xs: Iterable<number>): number => Math.max(...xs);
const ROLES = Object.keys(RECIPES) as DepotRole[];

/** A progress with everything learned (the most any cap that grows with research can be). */
function learnedAll(): Progress {
  const p = new Progress();
  for (const t of TECHS) p.learned.add(t.id);
  return p;
}

/** The fullest a depot of `role` can be: capAt with every stack and shed the game gives any depot. */
const fullest = (role: DepotRole): number => capAt({ role, stack: LIFT_STACK, sheds: MAX_SHEDS } as DepotState);

/** Digits a count the game numbers names with can reach (a name's "2", "3"…): far beyond any railway. */
const NUMBERED = 6;

/**
 * Plots a Game save can hold: it's kept as plain JSON in localStorage, which no browser lets past about 10 million
 * characters a site; each plot's squares take `plotChars` of it. So no plot is further than that many from the start.
 */
function plotsAtMost(): number {
  const data = serializeWorld(buildStarterWorld(true));
  const plotChars = Math.min(...data.landscape.plots.map((p) => JSON.stringify(p).length));
  const reach = Math.max(...data.landscape.plots.flatMap((p) => [Math.abs(p.px), Math.abs(p.pz)]));
  return reach + Math.ceil(10_000_000 / plotChars);
}

/** The game's slot ids, as Your games makes them. */
function slotIdLength(): number {
  const m = new Map<string, string>([[GAME_SLOT_KEYS.save, "{}"]]);
  const store = new SlotStore({ getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }, GAME_SLOT_KEYS);
  store.startUp();
  return store.openId!.length;
}

/** What the game can reach at each bounded path, and why. */
const REACH: Record<string, { reach: () => number; why: string }> = {
  // The landscape.
  "save.landscape.coast.plot": { reach: plotsAtMost, why: "a plot's coordinate: bounded by the plots a save can hold" },
  "save.landscape.plots[].px": { reach: plotsAtMost, why: "as above" },
  "save.landscape.plots[].pz": { reach: plotsAtMost, why: "as above" },
  "save.landscape.sites[].plot.px": { reach: plotsAtMost, why: "as above" },
  "save.landscape.sites[].plot.pz": { reach: plotsAtMost, why: "as above" },
  "save.landscape.secretPlan[].px": { reach: plotsAtMost, why: "as above" },
  "save.landscape.secretPlan[].pz": { reach: plotsAtMost, why: "as above" },
  "save.landscape.secrets[].plot.px": { reach: plotsAtMost, why: "as above" },
  "save.landscape.secrets[].plot.pz": { reach: plotsAtMost, why: "as above" },
  "save.landscape.secretPlan[].alt": { reach: () => most(Object.values(ALTERNATES)), why: "a secret's alternates (`ALTERNATES`)" },
  "save.landscape.towns[].name": { reach: () => longest(TOWN_NAMES) + Math.max(longest(TOWN_NAME_PREFIXES) + 1, 1 + NUMBERED), why: "a town's name, prefixed or numbered when taken (`freeName`)" },
  "save.landscape.towns[].buildings[].roof": { reach: () => 3, why: "a building's roof colour: `Math.floor(random() * 4)` (generate.ts, surroundings.ts)" },
  // Track.
  "save.switches[][1]": { reach: () => most(PIECE_TYPES.flatMap((t) => [false, true].map((f) => getPieceDef(t, f).connectors.length))) - 1, why: "a connector's index" },
  "save.joints[][1]": { reach: () => MAX_CONNECTORS - 1, why: "a connector's index (checked against the pieces above)" },
  "save.joints[][3]": { reach: () => MAX_CONNECTORS - 1, why: "as above" },
  "save.signals[][1]": { reach: () => MAX_CONNECTORS - 1, why: "as above" },
  "save.switchDefaults[][1]": { reach: () => MAX_CONNECTORS - 1, why: "as above" },
  // Trains.
  // (A name is cut to MAX_ENGINE_NAME code points, `cleanEngineName`; the schema counts UTF-16 units, up to two each.)
  "save.trains[].cars[].name": { reach: () => 2 * MAX_ENGINE_NAME, why: "an engine's name" },
  "save.trains[].cars[].livery": { reach: () => Math.max(longest(LIVERIES.map((l) => l.id)), longest(PAINT_COLOURS.flatMap((b) => PAINT_COLOURS.map((t) => ownLivery(b, t))))), why: "a livery: the paint shop's, or your own colours" },
  "save.trains[].cars[].cargo.count": { reach: () => Math.max(WAGON_CAPACITY, MAX_WAGON_CAPACITY), why: "a wagon's load (`wagonCapacity`, more with the Smithy)" },
  "save.trains[].cars[].history": { reach: () => LOG_VISITS, why: "a train's history: its last visits (`LOG_VISITS`, a ring)" },
  "save.trains[].cars[].history[][2]": { reach: () => LOG_LINES, why: "a visit's lines (`LOG_LINES`)" },
  "save.trains[].cars[].history[][2][][0]": { reach: () => RIDERS, why: "a line's good: a cargo index, or `RIDERS`" },
  "save.trains[].cars[].since": { reach: () => most(Object.values(SEATS) as number[]), why: "where a coach's riders got on: one a stop, at most one a rider (a wagon's load: one)" },
  "save.trains[].cars[].off": { reach: () => CARGO_KINDS.length, why: "goods a wagon is switched off for" },
  "save.trains[].cars[].riders.count": { reach: () => most(Object.values(SEATS) as number[]), why: "a coach's seats (`SEATS`)" },
  "save.trains[].cars[].riders.to": { reach: () => most(Object.values(SEATS) as number[]), why: "one per rider" },
  "save.trains[].cars[].riders.froms": { reach: () => most(Object.values(SEATS) as number[]), why: "one per rider" },
  "save.trains[].speed": { reach: () => ENGINE_SPEED * most([STEAM, ...Object.values(ENGINES)].map((e) => e!.speed)) * CABOOSE_BONUS * BOILERS_BONUS, why: "the fastest engine with a caboose and boilers (`topSpeed`)" },
  // Depots.
  "save.depots[].piles": { reach: () => CARGO_SLOTS, why: "a pile per cargo slot" },
  "save.depots[].piles[]": { reach: () => most(ROLES.map(fullest)), why: "the fullest pile: `capAt`, stacked by Lift and load, with all of a harbour's sheds" },
  "save.depots[].keeps{}": { reach: () => most(ROLES.map(fullest)), why: "a workshop's keep, cut to its cap (`setKeep`)" },
  "save.depots[].landed": { reach: () => CARGO_SLOTS, why: "a pile per cargo slot" },
  "save.depots[].landed[]": { reach: () => most(ROLES.map(fullest)), why: "landed goods are on a pile (no more than it holds)" },
  "save.depots[].vanYard{}": { reach: () => VAN_YARD, why: "a station's van yard (`VAN_YARD` in all)" },
  "save.depots[].waiting": { reach: () => Math.max(waitingCap(learnedAll()), VISITORS_CAP), why: "people waiting at a station (`waitingCap`, Bigger stations learned) or an airport's visitors" },
  "save.depots[].sheds": { reach: () => MAX_SHEDS, why: "a harbour's dock sheds" },
  "save.depots[].flyers": { reach: () => most(ROLES.map((role) => loungeCap({ role }))), why: "riders in an airport's lounge or at an airship's mast (`loungeCap`)" },
  "save.depots[].tracks.roads": { reach: () => MAX_TRACKS - 1, why: "an industry's further tracks (`MAX_TRACKS` with its own)" },
  "save.depots[].tracks.ends": { reach: () => 0, why: "only an older save's (before 2026-11-16): the game lays none now" },
  "save.depots[].tracks.ladder": { reach: () => 0, why: "as above" },
  // Places, projects, lines, boats, yards.
  "save.placePlans[][1]": { reach: () => longest(PLACES.map((p) => p.id)), why: "a place's id" },
  "save.grandPlans[][0]": { reach: () => longest(GRANDS.map((g) => g.id)), why: "a grand project's id" },
  "save.grandPlans[][2]": { reach: () => most(GRANDS.map((g) => g.stages.length)), why: "a project's stages done" },
  "save.lines[].colour": { reach: () => longest(LINE_COLOURS.map((c) => c.colour)), why: "a line's colour" },
  "save.lines[].name": { reach: () => Math.max(LINE_NAME_MAX, longest(LINE_COLOURS.map((c) => `${c.name} line `)) + NUMBERED), why: "a name typed (`LINE_NAME_MAX`) or given (`freeName`: \"Red line 2\")" },
  "save.lines[].stops[]|1[3]": { reach: () => MAX_VIAS, why: "a stop's via points" },
  "save.boats": { reach: () => MAX_BOATS, why: "the boats" },
  "save.boats[].history": { reach: () => LOG_VISITS, why: "a boat's history: its last visits (`LOG_VISITS`, a ring)" },
  "save.boats[].history[][2]": { reach: () => LOG_LINES, why: "a visit's lines (`LOG_LINES`)" },
  "save.boats[].history[][2][][0]": { reach: () => RIDERS, why: "a line's good: a cargo index, or `RIDERS`" },
  "save.boats[].since": { reach: () => CARGO_SLOTS, why: "where each good aboard came on: one a good" },
  "save.boats[].since[][0]": { reach: () => CARGO_SLOTS - 1, why: "a cargo index" },
  "save.boats[].name": { reach: () => Math.max(longest(BOAT_NAMES), "Boat ".length + NUMBERED), why: "a boat's name" },
  "save.boats[].barges": { reach: () => MAX_BARGES, why: "a boat's barges" },
  "save.boats[].load{}": { reach: () => MAX_BARGES * BARGE_LOADS, why: "what its barges hold" },
  "save.yards[].got{}": { reach: () => most(Object.values(YARD_COSTS).flatMap((c) => Object.values(c) as number[])), why: "a yard's goods in (taken only while it needs them)" },
  // Props.
  "save.props[].asset": { reach: () => longest(CATALOGUE.map((a) => a.id)), why: "a catalogue model's id" },
  "save.props[].variant": { reach: () => Math.max(ROW_BODIES.length * ROW_ROOFS.length - 1, COLOR_VARIANTS), why: "a row's body and roof in one number, or a hue shift" },
  "save.props[].scale": { reach: () => 1, why: "a building fitted to its lot, never made bigger" },
  "save.props[].storeys": { reach: () => MOST_STOREYS, why: "a house's storeys (`MOST_STOREYS`)" },
  // The session.
  "session.journal.entries": { reach: () => JOURNAL_CAP, why: "the Journal's cap" },
  "session.journal.entries[].text": { reach: () => JOURNAL_TEXT_MAX, why: "cut to it as it's saved (`Journal.toJSON`)" },
  "session.journal.entries[].place.points": { reach: () => JOURNAL_POINTS_MAX, why: "as above" },
  "session.journal.entries[].key": { reach: () => JOURNAL_KEY_MAX, why: "as above" },
  "session.slot.id": { reach: slotIdLength, why: "Your games' ids" },
  "session.slot.name": { reach: () => UNREADABLE_PREFIX.length + NAME_MAX, why: "a game's name (`NAME_MAX`), \"Couldn't open: \" before it when parked unread" },
  "session.situations.done": { reach: () => DETECTORS.length, why: "a situation tip's kind" },
  "session.situations.done[]": { reach: () => longest(DETECTORS.map((d) => d.id)), why: "as above" },
  "session.situations.toasted": { reach: () => DETECTORS.length, why: "as above" },
  "session.situations.toasted[]": { reach: () => longest(DETECTORS.map((d) => d.id)), why: "as above" },
  "session.situations.snoozed{key}": { reach: () => longest(DETECTORS.map((d) => d.id)), why: "as above" },
  "session.situations.shows{key}": { reach: () => longest(DETECTORS.map((d) => d.id)), why: "as above" },
};

/**
 * Counts the game never caps: no bound may be put on them (a game played long enough reaches any number). Each is a
 * path in the schema, checked to be there.
 */
const UNBOUNDED = [
  "save.pieces",
  "save.trains",
  "save.trains[].cars",
  "save.depots",
  "save.towns",
  "save.landscape.plots",
  "save.landscape.towns",
  "save.landscape.towns[].cells",
  "save.landscape.towns[].buildings",
  "save.landscape.towns[].buildings[].born",
  "save.landscape.nextBuildingId",
  "save.landscape.secrets[].trips",
  "save.landscape.secrets[].fares",
  "save.delivered",
  "save.delivered[][1]",
  "save.deliveredGoods[][1]{}",
  "save.roadGot[][1]{}",
  "save.placePlans[][2]{}",
  "save.grandPlans[][3]{}",
  "save.grandGift[][1]{}",
  "save.lines",
  "save.lines[].stops",
  "save.props",
  "save.built.ships",
  "save.built.ferries",
  "save.ids.car",
  "save.ids.train",
  "save.depots[].timer",
  "save.depots[].power",
  "session.clock",
  "session.journal.seq",
  "session.journal.entries[].count",
  "session.journal.entries[].qty",
] as const;

function allBounds(): Bound[] {
  return [...schemaBounds(saveSchema, "save"), ...schemaBounds(sessionSchema, "session")];
}

/** Every path in a schema (bounded or not), to check the unbounded list names real ones. */
function allPaths(schema: Parameters<typeof schemaBounds>[0], path: string, out: Set<string>): Set<string> {
  out.add(path);
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> & { type: string } } })._zod.def;
  const kids: [unknown, string][] = [];
  if (def.type === "object") for (const [k, v] of Object.entries(def.shape as object)) kids.push([v, `${path}.${k}`]);
  if (def.type === "array") kids.push([def.element, `${path}[]`]);
  if (["optional", "nullable", "default", "readonly"].includes(def.type)) kids.push([def.innerType, path]);
  if (def.type === "union") (def.options as unknown[]).forEach((o, i) => kids.push([o, `${path}|${i}`]));
  if (def.type === "tuple") (def.items as unknown[]).forEach((o, i) => kids.push([o, `${path}[${i}]`]));
  if (def.type === "record") kids.push([def.valueType, `${path}{}`]);
  for (const [s, p] of kids) allPaths(s as never, p, out);
  return out;
}

describe("the save's limits hold everything the game can reach", () => {
  const bounds = allBounds();

  it("every bound in the save's schemas is known here, with what the game reaches there", () => {
    expect(bounds.length).toBeGreaterThan(40);
    expect(bounds.map((b) => b.path).filter((p) => !(p in REACH))).toEqual([]);
    const found = new Set(bounds.map((b) => b.path));
    expect(Object.keys(REACH).filter((p) => !found.has(p)), "stale rows").toEqual([]);
  });

  for (const b of allBounds()) {
    const r = REACH[b.path];
    if (!r) continue;
    it(`${b.path} (${b.of} ≤ ${b.max}): ${r.why}`, () => {
      const reach = r.reach();
      expect(Number.isFinite(reach), "a reach worked out").toBe(true);
      expect(reach, `the game reaches ${reach} at ${b.path}, over the save's ${b.max}`).toBeLessThanOrEqual(b.max);
    });
  }

  it("counts the game never caps have no limit in the save", () => {
    const paths = new Set<string>();
    allPaths(saveSchema, "save", paths);
    allPaths(sessionSchema, "session", paths);
    expect(UNBOUNDED.filter((p) => !paths.has(p)), "paths not in the schema").toEqual([]);
    expect(bounds.filter((b) => (UNBOUNDED as readonly string[]).includes(b.path))).toEqual([]);
  });

  it("the Journal is held to its save limits as it's saved", () => {
    const j = new Journal(() => 0);
    const points = Array.from({ length: JOURNAL_POINTS_MAX + 10 }, (_, i) => ({ x: i, z: 0 }));
    j.add({ kind: "event", text: "x".repeat(JOURNAL_TEXT_MAX + 5), key: "k".repeat(JOURNAL_KEY_MAX + 5), place: { x: 0, z: 0, points } });
    const saved = sessionSchema.shape.journal.safeParse(j.toJSON());
    expect(saved.success).toBe(true);
    expect(j.entries[0].text.length).toBe(JOURNAL_TEXT_MAX + 5);
  });
});
