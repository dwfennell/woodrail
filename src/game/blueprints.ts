/**
 * Every blueprint in Game mode, built or planned: the one list the Research picker, the rules for researching
 * (`tech.ts`, `research.ts`) and the roadmap page (`npm run blueprints:page`) all read. Every built one is researched
 * at a school. A blueprint not built yet has a
 * `plan`: the board shows it as "coming soon" and nothing can learn it. To add one, add a row; to build one, take its
 * `plan` away (and give it its things in `THING_RULES`, or its feature in the game).
 *
 * Self-contained (no imports but types) so a plain Node script can read it.
 */

export type BranchId = "track" | "trains" | "logistics" | "industry" | "food" | "craft" | "learning" | "civic" | "leisure" | "water" | "passengers" | "roads" | "ending";

export interface Branch {
  readonly id: BranchId;
  readonly label: string;
  readonly sub: string;
  /** A paint colour for the branch's band and tags. */
  readonly color: string;
}

export const BRANCHES: readonly Branch[] = [
  { id: "track", label: "Track", sub: "pieces and the line", color: "#b98552" },
  { id: "trains", label: "Trains", sub: "engines and wagons", color: "#c8442f" },
  { id: "logistics", label: "Logistics", sub: "routes, cranes, stores", color: "#2f6db5" },
  { id: "industry", label: "Industry", sub: "raw goods and factories", color: "#d9a520" },
  { id: "food", label: "Food", sub: "farms to ice cream", color: "#3c8f4e" },
  { id: "craft", label: "Crafting", sub: "the workshop's benches", color: "#c9557f" },
  { id: "learning", label: "Learning", sub: "school to space", color: "#7b4fa0" },
  { id: "civic", label: "Town life", sub: "the town's own buildings", color: "#1f8a8a" },
  { id: "leisure", label: "Leisure and sports", sub: "days out by train", color: "#5c9e3c" },
  { id: "water", label: "Water and air", sub: "harbours, ships, planes", color: "#3d86b8" },
  { id: "passengers", label: "Passengers", sub: "by people carried", color: "#e0a526" },
  { id: "roads", label: "Roads", sub: "roads between towns", color: "#6f6a62" },
  { id: "ending", label: "The ending", sub: "", color: "#3a2a1c" },
];

/** When a planned blueprint is meant to be built: next, coming soon (Phases C and D), someday, or the ending. */
export type Plan = "next" | "soon" | "later" | "ending";

/** Things counted over a game, that a blueprint can ask you to have done. */
export type Stat = "riders" | "blueprints" | "loadsMoved" | "logsCut" | "planksSawn" | "stoneCut" | "grainGrown" | "flourGround" | "coalDug" | "ironCast";

export const STAT_LABELS: Record<Stat, string> = {
  riders: "carried",
  blueprints: "blueprints learned",
  loadsMoved: "loads moved",
  logsCut: "logs cut",
  planksSawn: "planks sawn",
  stoneCut: "stone cut",
  grainGrown: "grain grown",
  flourGround: "flour ground",
  coalDug: "coal dug",
  ironCast: "iron cast",
};

/** Something you must have achieved (not paid) before a blueprint can be learned. */
export type Need =
  | { readonly kind: "count"; readonly stat: Stat; readonly n: number }
  /** This many of a good delivered to towns, all game. */
  | { readonly kind: "delivered"; readonly good: string; readonly n: number }
  /** One of your towns at this level (1 a village, 2 a town, 3 a city, 4 a city ★), or `towns` of them. */
  | { readonly kind: "level"; readonly level: number; readonly towns?: number }
  /**
   * Something on your map: a town's landmark (a market) or, later, a city's major building; or your school's growth
   * (`CITY_SCHOOL`: a school beside a city, its library wing).
   */
  | { readonly kind: "landmark"; readonly id: string; readonly label: string }
  /** Something about the map ("a town by water"): shown, but not yet checked by the game. */
  | { readonly kind: "place"; readonly text: string };

/** Its price in planks, goods and coins: what researching it costs is worked out from it (`researchFrom`). */
export interface Price {
  readonly planks?: number;
  readonly coins?: number;
  readonly goods?: Readonly<Record<string, number>>;
}

export interface Blueprint {
  readonly id: string;
  readonly label: string;
  readonly branch: BranchId;
  /** One line for the board. */
  readonly blurb: string;
  /** What it brings, in words (the things it unlocks are listed from `THING_RULES` too). */
  readonly brings: string;
  /** Blueprints to learn first. */
  readonly needs: readonly string[];
  readonly price: Price;
  /** What you must have done first, beyond the blueprints it needs. */
  readonly requires: readonly Need[];
  /**
   * Its tier: how long its study takes (`STUDY_SECONDS`), coins from tier 2, and from tier 3 a school beside a city
   * (`CITY_SCHOOL`). None: tier 1.
   */
  readonly tier?: 1 | 2 | 3;
  /** Not built yet: shown as coming soon (see `Plan`). */
  readonly plan?: Plan;
  /**
   * Shown to a new player from the start (the rest are a "?" until something next to them is learned). Only on built
   * rows, and the ending's (the goal to aim for): a key tag a child can never learn is a promise the board can't keep.
   */
  readonly key?: boolean;
  /** How to start using it, said when it's learned ("Tap a train, then Plan a route"): where it isn't a thing to make. */
  readonly how?: string;
  /** What it lets you do that isn't a thing to make (train routes), with an icon for the board. */
  readonly feature?: { readonly label: string; readonly icon: string };
  /** What researching it at a school takes (see `ResearchCost`). */
  readonly research: ResearchCost;
  /**
   * The school it must be studied at (tech tree 3, the user's "certain tech done in a college or university"): a
   * College in a city (a school whose town is a city, once College is learned) or a University (such a College once
   * University is learned). Shown as a need ("a College in a city"), and only such a school takes its goods. Only on
   * tier-3 rows (it stands for their school beside a city). None: any school.
   */
  readonly school?: SchoolLevel;
}

/** A school's level, from a schoolhouse up: what a blueprint's `school` asks for. */
export type SchoolLevel = "college" | "university";
/** How a grade ranks (a University is a College too). */
export const SCHOOL_RANK: Record<SchoolLevel | "school", number> = { school: 0, college: 1, university: 2 };

/**
 * What a research costs: goods delivered to a school (by kind: "planks", "grain"…), and from tier 2 coins, paid when
 * it starts (src/game/research.ts). Coins never stand in for goods.
 */
export interface ResearchCost {
  readonly goods: Readonly<Record<string, number>>;
  readonly coins?: number;
}

/**
 * A blueprint's research cost from its price: its planks and goods; its coins only from tier 2 (tier 1 is goods
 * only). The rows that ask for a good of the chain before them (the spec's table) give their own.
 */
export function researchFrom(price: Price, tier: number): ResearchCost {
  const goods: Record<string, number> = { ...(price.planks ? { planks: price.planks } : {}), ...price.goods };
  return { goods, ...(tier >= 2 && price.coins ? { coins: price.coins } : {}) };
}

const count = (stat: Stat, n: number): Need => ({ kind: "count", stat, n });
const delivered = (good: string, n: number): Need => ({ kind: "delivered", good, n });
const level = (l: number, towns?: number): Need => ({ kind: "level", level: l, ...(towns ? { towns } : {}) });
const landmark = (id: string, label: string): Need => ({ kind: "landmark", id, label });
const place = (text: string): Need => ({ kind: "place", text });
/** A school of yours beside a city (its library wing): every tier-3 research needs one. */
export const CITY_SCHOOL_ID = "city-school";
const CITY_SCHOOL = landmark(CITY_SCHOOL_ID, "a school beside a city");
/** Your schools' grades, as landmarks a blueprint can require (`landmarksAt` adds them; `school` on a row asks). */
export const COLLEGE_SCHOOL_ID = "college-school";
export const UNIVERSITY_SCHOOL_ID = "university-school";
export const SCHOOL_NEED: Record<SchoolLevel, Need> = { college: landmark(COLLEGE_SCHOOL_ID, "a College in a city"), university: landmark(UNIVERSITY_SCHOOL_ID, "a University") };
const TOWN = level(2);
const CITY = level(3);
const CITY_STAR = level(4);

type Row = Omit<Blueprint, "requires" | "price" | "research"> & { requires?: readonly Need[]; price?: Price; research?: ResearchCost };
/**
 * A row: its research from its price, and among what it requires from tier 3 a school beside a city, or the school it
 * must be studied at (a College in a city, a University: each a city's school already).
 */
const row = (r: Row): Blueprint => ({ price: {}, ...r, requires: [...(r.requires ?? []), ...(r.school ? [SCHOOL_NEED[r.school]] : r.tier === 3 ? [CITY_SCHOOL] : [])], research: r.research ?? researchFrom(r.price ?? {}, r.tier ?? 1) });
/** A research cost of goods (and coins), for the rows that ask for a good of the chain before them. */
const study = (goods: Record<string, number>, coins?: number): ResearchCost => ({ goods, ...(coins ? { coins } : {}) });

export const BLUEPRINTS: readonly Blueprint[] = [
  // Track
  row({ id: "switches", label: "Switches", branch: "track", tier: 1, key: true, needs: [], price: { planks: 3 }, blurb: "Branch a line in two.", brings: "Switch, Y switch" }),
  row({ id: "bridges", label: "Bridges and ramps", branch: "track", tier: 1, key: true, needs: [], price: { planks: 10 }, blurb: "Ramp up and over rivers and other lines, and raise track higher.", brings: "Ramps, bridges, risers" }),
  row({ id: "junctions", label: "Junctions and loops", branch: "track", tier: 1, key: true, needs: ["switches"], price: { planks: 6 }, blurb: "Three-ways, crossings, double track, and loops to turn a train round.", brings: "Crossings, wye, three-way, double track, balloon loops, signal gantry" }),
  row({ id: "signals", label: "Signals", branch: "track", tier: 1, key: true, needs: ["switches"], price: { planks: 4 }, blurb: "Place signals on any track to split it into blocks: trains follow each other closer. Tap one to hold trains there.", brings: "Signal" }),
  // Signal boxes (tech tree 4, S1): the signal box and lever frame move here from the Scenery kit, so Signals leads on.
  row({ id: "signal-boxes", label: "Signal boxes", branch: "track", tier: 2, needs: ["signals", "routes"], price: { planks: 4, coins: 80 }, blurb: "A signal box works the points and signals near it: tap it and throw them from one place.", brings: "Signal box, lever frame", how: "Put a signal box beside your points and signals, then tap it" }),
  row({ id: "tunnels", label: "Tunnels", branch: "track", tier: 2, needs: ["bridges"], price: { planks: 12, coins: 120 }, blurb: "Under a hill instead of over it, or under another line. Lay a straight up to a hill's side, or draw across it, and the line goes under.", brings: "Tunnel mouth, short tunnel mouth" }),
  row({ id: "engine-shed", label: "Engine shed", branch: "track", tier: 2, needs: ["junctions"], price: { planks: 10, coins: 100 }, blurb: "A shed to park engines in, and water and coal by the line: steam engines stop at them for a moment as they pass.", brings: "Engine shed, water tower, coal stage, water crane, coaling crane" }),
  row({ id: "turntable", label: "Turntable and roundhouse", branch: "track", tier: 2, needs: ["engine-shed"], price: { planks: 12, coins: 160 }, requires: [TOWN], blurb: "Turn an engine round on the spot, stable it in a roundhouse, or slide it across to another road.", brings: "Turntable, roundhouse, transfer table" }),
  row({ id: "double-three-way", label: "Double three-way", branch: "track", tier: 2, needs: ["junctions"], price: { planks: 6, coins: 60 }, blurb: "A three-way switch you can set with two levers.", brings: "Double three-way" }),
  row({ id: "slips", label: "Slips", branch: "track", tier: 2, needs: ["junctions", "signals"], price: { planks: 8, coins: 120 }, blurb: "A crossing that can also turn.", brings: "Single slip, double slip" }),
  row({ id: "turntable-controls", label: "Turntable controls", branch: "track", tier: 2, needs: ["turntable"], price: { planks: 4, coins: 80 }, blurb: "Tap a road and the turntable turns to it.", brings: "Tap a road to turn the deck to it", feature: { label: "Tap a road to turn a turntable to it", icon: "🎯" } }),
  row({ id: "landscaping", label: "Landscaping", branch: "track", tier: 2, needs: ["bridges"], price: { planks: 6, coins: 200 }, requires: [CITY], blurb: "Lower a hill a step at a time, from the Add land card. Dear: more for a higher hill.", brings: "Lower hills", feature: { label: "Lower hills (Add land card)", icon: "⛰️" } }),
  // Kits that were Sandbox's only, in Game mode as looks (tech-tree spec T1, T2): no new pieces, nothing in the sim.
  row({ id: "big-stations", label: "Big stations", branch: "track", tier: 2, needs: ["stations"], price: { planks: 6, coins: 120 }, requires: [TOWN], blurb: "Big stations with room for more trains.", brings: "Two-platform station, grand terminus" }),
  row({ id: "fun-track", label: "Fun track", branch: "track", tier: 1, needs: ["bridges", "scenery"], price: { planks: 5 }, blurb: "A lift for trains, and a loop the loop!", brings: "Train lift, loop-the-loop, buffer stop with a lamp" }),
  row({ id: "viaduct", label: "Stone viaduct", branch: "track", tier: 3, plan: "later", needs: ["bridges", "quarries"], price: { planks: 20, coins: 100, goods: { stone: 40 } }, blurb: "A long stone bridge across a valley or a whole town.", brings: "Viaduct arches" }),
  row({ id: "lift-bridge", label: "Lift bridge", branch: "track", tier: 3, plan: "later", needs: ["bridges", "harbours"], price: { planks: 20, coins: 80, goods: { iron: 10 } }, blurb: "A bridge that lifts to let boats through.", brings: "Lift bridge" }),
  // The rack (spec 2026-11-04-rail-types.md): mid game, coins rather than planks (the tech tree's rule before City).
  row({ id: "rack", label: "Mountain railway", branch: "track", tier: 2, needs: ["bridges", "tank"], price: { planks: 8, coins: 120 }, requires: [TOWN], blurb: "A rack up the side of a hill: two levels in one ramp's length. Only a rack engine climbs it. A lookout halt on a hilltop: riders pay twice the fare for the view.", brings: "Rack, short rack, rack engine, lookout halt" }),
  row({ id: "monorail", label: "Monorail", branch: "track", tier: 3, plan: "later", needs: ["electricity", "viaduct"], price: { planks: 30, coins: 200, goods: { iron: 30 } }, blurb: "A rail in the sky over a city.", brings: "Monorail track and car" }),
  // The metro (spec 2026-11-04-rail-types.md §2): late, and the dearest way to carry people on purpose (the user: "It
  // should be expensive to move folks by metro"). Stops, the train and digging under a town each cost more (things.ts,
  // metro.ts).
  row({ id: "metro", label: "Metro", branch: "track", tier: 3, needs: ["tunnels", "electricity"], price: { planks: 10, coins: 400, goods: { iron: 40 } }, requires: [CITY_STAR], blurb: "Trains under a city. A metro stop under a town, its entrance on a green: riders of its own, and the town grows over the line. Dear: stops, trains, digging under the town and the power they draw.", brings: "Metro stop, metro train" }),

  // Trains
  row({ id: "tank", label: "Tank engine", branch: "trains", tier: 1, key: true, needs: [], price: { planks: 4 }, blurb: "Pulls 3 cars (a classic engine pulls 4), but gets going and stops in half the time.", brings: "Tank engine", feature: { label: "Tank engine (Trains tab)", icon: "🚂" } }),
  row({ id: "goods-engine", label: "Goods engine", branch: "trains", tier: 2, needs: ["tank"], price: { planks: 16, coins: 40 }, research: study({ planks: 6, flour: 6 }, 80), requires: [count("loadsMoved", 200)], blurb: "Pulls 8 cars at 0.8× speed, for long freight trains.", brings: "Goods engine", feature: { label: "Goods engine (Trains tab)", icon: "🚂" } }),
  row({ id: "diesel", label: "Diesel", branch: "trains", tier: 2, needs: ["tank"], price: { planks: 18, coins: 60 }, research: study({ planks: 7, flour: 8 }, 120), requires: [TOWN], blurb: "Pulls 6 at 1.2×, and drives as well backwards.", brings: "Diesel engine", feature: { label: "Diesel (Trains tab)", icon: "🚂" } }),
  row({ id: "breakdown", label: "Breakdown crane", branch: "trains", tier: 2, needs: ["goods-engine", "cranes1"], price: { planks: 8, coins: 120 }, blurb: "A crane wagon that drives out to a derailed train and lifts it back on by itself, or lifts a stuck train off the line.", brings: "Breakdown crane" }),
  row({ id: "tankers", label: "Tank wagons", branch: "trains", tier: 2, needs: ["dairy"], price: { planks: 6, coins: 120 }, blurb: "Oil from an oil well and water from a water pump, carried in tank wagons. Towns buy both at full pay.", brings: "Tank wagon, oil well, water pump" }),
  row({ id: "reefer", label: "Cold van", branch: "trains", tier: 2, needs: ["creamery"], price: { planks: 4, coins: 100 }, blurb: "A white van that keeps cheese and ice cream cold on the way. Ice cream rides in nothing else.", brings: "Cold van" }),
  row({ id: "mail", label: "Sorting van", branch: "trains", tier: 2, plan: "soon", needs: ["post-office"], price: { planks: 6 }, blurb: "A travelling post office: mail sorted on the way, without a stop at the post office.", brings: "Sorting van" }),
  row({ id: "electric", label: "Electric engine", branch: "trains", tier: 3, school: "university", needs: ["diesel", "electricity"], price: { planks: 20, coins: 100, goods: { iron: 10 } }, blurb: "Pulls 6 cars at 1.4×, quietly, while a power station has coal.", brings: "Electric engine", feature: { label: "Electric engine (Trains tab)", icon: "⚡" } }),
  row({ id: "brake-vans", label: "Brake vans", branch: "trains", tier: 1, needs: ["tank"], price: { planks: 4 }, blurb: "A caboose at the end makes a train a bit faster.", brings: "Caboose" }),
  row({ id: "fuel-stop", label: "Fuel stop", branch: "trains", tier: 2, needs: ["diesel"], price: { planks: 5, coins: 60 }, blurb: "A diesel fuel stop for the line: diesels stop there a moment, as steam engines do at water.", brings: "Fuel station" }),
  row({ id: "boilers", label: "Better boilers", branch: "trains", tier: 2, needs: ["goods-engine"], price: { planks: 6, coins: 150 }, requires: [count("loadsMoved", 400)], blurb: "All your engines go a bit faster.", brings: "Faster engines", feature: { label: "Every engine 1.1× as fast", icon: "🔥" } }),
  // Tech tree 3 (2026-11-03): iron's chain gets an end, as ice cream's did, the wagon first (cars ride in nothing else).
  row({ id: "car-carrier", label: "Car carrier", branch: "trains", tier: 3, school: "college", needs: ["foundry"], price: { planks: 6, coins: 160 }, blurb: "A yellow wagon with two decks, for new cars. They ride in nothing else.", brings: "Car carrier" }),
  row({ id: "circus-train", label: "Circus train", branch: "trains", tier: 3, plan: "later", needs: ["circus"], price: { planks: 20, coins: 80 }, blurb: "The circus tours your towns: crowds wherever it stops.", brings: "Circus train" }),

  // Logistics
  row({ id: "routes", label: "Train routes", branch: "logistics", tier: 2, key: true, needs: ["switches"], price: { planks: 5, coins: 40 }, blurb: "Give a train its stops: it sets the switches on its way.", brings: "Routes on the engine card", how: "Tap a train, then Plan a route", feature: { label: "Routes on the engine card", icon: "🗺️" } }),
  row({ id: "warehouses", label: "Warehouses", branch: "logistics", tier: 2, key: true, needs: ["routes"], price: { planks: 8, coins: 80 }, blurb: "Keep goods for later: routed trains drop them off and pick them up.", brings: "Warehouse" }),
  // Depot tracks (docs/superpowers/specs/2026-11-04-depot-tracks.md): the Goods yard planned here (a warehouse of three
  // sidings) is any crane industry's upgrade from its card: a warehouse with three tracks is that goods yard.
  row({ id: "sidings", label: "Sidings", branch: "logistics", tier: 2, needs: ["warehouses", "junctions"], price: { planks: 6, coins: 120 }, blurb: "Give an industry a second and a third track: its crane reaches over them all, so the next train waits beside it, not out on the line.", brings: "More tracks at industries", how: "Tap an industry, then Second track", feature: { label: "More tracks at industries", icon: "🛤️" } }),
  row({ id: "cranes1", label: "Quicker cranes", branch: "logistics", tier: 1, key: true, needs: [], price: { planks: 4 }, blurb: "Every crane moves a load in 0.45 s instead of 0.6 s.", brings: "Faster cranes", feature: { label: "Cranes load in 0.45 s", icon: "🏗️" } }),
  row({ id: "cranes2", label: "Two-arm cranes", branch: "logistics", tier: 2, needs: ["cranes1"], price: { planks: 7, coins: 80 }, requires: [count("loadsMoved", 200)], blurb: "Cranes move a load in 0.3 s.", brings: "A second arm on every crane", feature: { label: "Cranes load in 0.3 s", icon: "🏗️" } }),
  row({ id: "cranes3", label: "Grab cranes", branch: "logistics", tier: 3, school: "university", needs: ["cranes2", "smithy"], price: { planks: 12, coins: 200 }, requires: [CITY_STAR], blurb: "Cranes lift two loads at a time.", brings: "Grab cranes", feature: { label: "Cranes lift two at once", icon: "🏗️" } }),
  // Sandbox's loaders, cranes and unloaders, in Game mode as looks only (no heaps, nothing taken: spec I1, I2).
  row({ id: "loading-kits", label: "Loading kits", branch: "logistics", tier: 1, needs: ["cranes1"], price: { planks: 5 }, blurb: "Loaders to dress your yards.", brings: "Log loader, grain elevator, drop hopper, goods shed" }),
  row({ id: "big-cranes", label: "Big cranes", branch: "logistics", tier: 3, school: "college", needs: ["cranes2", "mines"], price: { planks: 10, coins: 200 }, blurb: "Giant cranes and chutes for big yards.", brings: "Gantry, magnet and harbour cranes, conveyor, wagon tipper, coal chute" }),
  row({ id: "lift-load", label: "Lift and load", branch: "logistics", tier: 3, plan: "later", needs: ["warehouses", "cranes2"], price: { planks: 20, coins: 80 }, blurb: "A tall warehouse with a lift: stacks goods three high and loads two wagons at once.", brings: "Lift-and-load warehouse" }),

  // Industry
  row({ id: "harvesters", label: "Harvesters", branch: "industry", tier: 1, key: true, needs: [], price: { planks: 5 }, blurb: "A forest yard of your own, beside the trees.", brings: "Forest yard" }),
  row({ id: "harvesters2", label: "Harvesters II", branch: "industry", tier: 2, needs: ["harvesters"], price: { planks: 6, coins: 80 }, requires: [count("logsCut", 100)], blurb: "Forest yards work 1.5× as fast.", brings: "A log loader in each yard", feature: { label: "Forest yards 1.5× as fast", icon: "🪓" } }),
  row({ id: "harvesters3", label: "Harvesters III", branch: "industry", tier: 3, school: "college", needs: ["harvesters2"], price: { planks: 10, coins: 200 }, requires: [count("logsCut", 400)], blurb: "Forest yards work twice as fast.", brings: "A steam log crane", feature: { label: "Forest yards twice as fast", icon: "🪓" } }),
  row({ id: "sawmills", label: "Sawmills", branch: "industry", tier: 2, key: true, needs: [], price: { planks: 8, coins: 40 }, blurb: "Build your own sawmill, wherever you like.", brings: "Sawmill" }),
  row({ id: "sawmills2", label: "Sawmills II", branch: "industry", tier: 2, needs: ["sawmills"], price: { planks: 7, coins: 80 }, requires: [count("planksSawn", 100)], blurb: "Sawmills work 1.5× as fast.", brings: "A second saw", feature: { label: "Sawmills 1.5× as fast", icon: "🪚" } }),
  row({ id: "sawmills3", label: "Sawmills III", branch: "industry", tier: 3, school: "college", needs: ["sawmills2"], price: { planks: 12, coins: 200 }, requires: [count("planksSawn", 400)], blurb: "Sawmills work twice as fast.", brings: "A steam saw house", feature: { label: "Sawmills twice as fast", icon: "🪚" } }),
  row({ id: "quarries", label: "Quarries", branch: "industry", tier: 3, key: true, needs: ["mills"], price: { planks: 24, coins: 40 }, research: study({ planks: 8, flour: 6 }, 80), blurb: "Cut stone from the hills, for growing cities.", brings: "Quarry" }),
  row({ id: "quarries2", label: "Quarries II", branch: "industry", tier: 3, school: "college", needs: ["quarries"], price: { planks: 12, coins: 200 }, requires: [count("stoneCut", 60)], blurb: "Quarries work 1.5× as fast.", brings: "A stone crusher", feature: { label: "Quarries 1.5× as fast", icon: "⛏️" } }),
  row({ id: "brickworks", label: "Brickworks", branch: "industry", tier: 3, school: "college", needs: ["quarries", "mines"], price: { planks: 12, coins: 180 }, blurb: "Stone and coal fired into bricks: a second use for a mine's coal. Towns buy them at full pay.", brings: "Brickworks" }),
  row({ id: "mines", label: "Mines", branch: "industry", tier: 3, needs: ["quarries", "goods-engine"], price: { planks: 20, coins: 80 }, research: study({ planks: 6, stone: 10 }, 160), requires: [delivered("stone", 20)], blurb: "A pithead in the hills brings up coal and iron ore, for a foundry.", brings: "Mine" }),
  row({ id: "foundry", label: "Foundry", branch: "industry", tier: 3, needs: ["mines"], price: { planks: 30, coins: 120 }, research: study({ stone: 10, coal: 10 }, 240), requires: [CITY_STAR], blurb: "Coal and ore make iron, which the biggest cities want and the workshop works with.", brings: "Foundry" }),
  row({ id: "mines2", label: "Mines II", branch: "industry", tier: 3, school: "college", needs: ["mines"], price: { planks: 12, coins: 220 }, requires: [count("coalDug", 60)], blurb: "Mines bring up coal and ore 1.5× as fast.", brings: "A winding engine at each pithead", feature: { label: "Mines 1.5× as fast", icon: "⛏️" } }),
  row({ id: "foundry2", label: "Foundry II", branch: "industry", tier: 3, school: "college", needs: ["foundry"], price: { planks: 12, coins: 260 }, requires: [count("ironCast", 40)], blurb: "Foundries cast iron 1.5× as fast.", brings: "A second furnace in each foundry", feature: { label: "Foundries 1.5× as fast", icon: "🔥" } }),
  row({ id: "car-factory", label: "Car factory", branch: "industry", tier: 3, school: "university", needs: ["car-carrier"], price: { planks: 12, coins: 220 }, requires: [delivered("iron", 20)], blurb: "Iron and planks make new cars. Towns pay more for them than for anything else.", brings: "Car factory" }),

  // Food
  row({ id: "farming", label: "Farming", branch: "food", tier: 1, key: true, needs: [], price: { planks: 6 }, blurb: "A farm yard by the fields, hoppers for its grain, and fields to plant.", brings: "Farm yard, hopper, fields" }),
  row({ id: "farming2", label: "Farming II", branch: "food", tier: 2, needs: ["farming"], price: { planks: 6, coins: 80 }, requires: [count("grainGrown", 60)], blurb: "Farm yards work 1.5× as fast.", brings: "A tractor in each yard", feature: { label: "Farm yards 1.5× as fast", icon: "🚜" } }),
  row({ id: "mills", label: "Mills", branch: "food", tier: 2, key: true, needs: ["farming"], price: { planks: 16, coins: 20 }, research: study({ planks: 6, grain: 6 }, 40), blurb: "Grind grain into flour, for the towns.", brings: "Mill, van" }),
  row({ id: "mills2", label: "Mills II", branch: "food", tier: 2, needs: ["mills"], price: { planks: 8, coins: 100 }, requires: [count("flourGround", 60)], blurb: "Mills work 1.5× as fast.", brings: "More millstones", feature: { label: "Mills 1.5× as fast", icon: "⚙️" } }),
  // The dairy chain (tech-tree I3, I4) and the orchard: after the first City, mostly coins (spec §3: nothing new takes
  // planks before the first City). The bakery is the first recipe of two goods from two chains: flour + milk → bread.
  row({ id: "dairy", label: "Dairy farm", branch: "food", tier: 2, needs: ["farming"], price: { planks: 10, coins: 80 }, requires: [CITY], blurb: "Cows give milk, carried in tank wagons. Towns buy it.", brings: "Dairy farm, milk tank wagon" }),
  row({ id: "orchard", label: "Orchards", branch: "food", tier: 2, needs: ["farming"], price: { planks: 8, coins: 60 }, requires: [CITY], blurb: "Apple trees give fruit by the crate, on flatbeds. Towns buy it.", brings: "Orchard" }),
  row({ id: "bakery", label: "Bakery", branch: "food", tier: 2, needs: ["mills", "dairy"], price: { planks: 12, coins: 120 }, blurb: "Flour and milk make bread, which every town buys.", brings: "Bakery" }),
  // The next nodes (spec "Next nodes", 2026-11-02): chains off the orchard and the dairy, after the first City, mostly
  // coins. Their goods towns always buy at full pay (`FULL_PAY`); no study asks for them.
  row({ id: "creamery", label: "Creamery", branch: "food", tier: 2, needs: ["dairy"], price: { planks: 10, coins: 140 }, blurb: "A dairy's milk made into cheese. Towns buy it at full pay.", brings: "Creamery" }),
  row({ id: "juice", label: "Juice works", branch: "food", tier: 2, needs: ["orchard"], price: { planks: 8, coins: 120 }, blurb: "An orchard's fruit pressed into juice, in bottles by the crate. Towns buy it at full pay.", brings: "Juice works" }),
  // The goods chains (2026-11-04), each ending (A + B) -> C as the bakery does, after the first City and mostly coins
  // (spec §3). Sugar from a field of beet; fruit and sugar make jam (the juice works' neighbour, the user's own example).
  row({ id: "sugar", label: "Sugar beet", branch: "food", tier: 2, needs: ["farming"], price: { planks: 6, coins: 80 }, requires: [CITY], blurb: "A field of sugar beet, boiled down into sacks of sugar. Towns buy it.", brings: "Sugar beet field" }),
  row({ id: "jam", label: "Jam kitchen", branch: "food", tier: 2, needs: ["juice", "sugar"], price: { planks: 10, coins: 160 }, blurb: "An orchard's fruit and a field's sugar make jam, in jars by the crate. Towns buy it at full pay.", brings: "Jam kitchen" }),
  row({ id: "ice-cream", label: "Ice cream factory", branch: "food", tier: 3, school: "college", needs: ["reefer", "orchard"], price: { planks: 10, coins: 200 }, blurb: "Milk and fruit make ice cream, carried in cold vans. Towns pay the most for it.", brings: "Ice cream factory" }),
  row({ id: "fishing", label: "Fishing boats", branch: "food", tier: 3, school: "college", needs: ["harbours"], price: { planks: 8, coins: 160 }, blurb: "Every boat that calls at your harbours brings a catch of fish. Towns buy fish at full pay.", brings: "Fish at every harbour", feature: { label: "A catch of fish with every boat", icon: "🐟" } }),
  // Cocoa comes by boat (no trade needed: every boat that calls lands some, as Fishing boats' catch), and with a
  // dairy's milk makes chocolate: studied at a College in a city, as the other late chains.
  row({ id: "chocolate", label: "Chocolate factory", branch: "food", tier: 3, school: "college", needs: ["harbours", "dairy"], price: { planks: 10, coins: 220 }, blurb: "Every boat that calls at your harbours brings cocoa beans; cocoa and milk make chocolate. Towns buy it at full pay.", brings: "Chocolate factory, cocoa at every harbour", feature: { label: "Cocoa with every boat", icon: "🫘" } }),

  // Crafting
  row({ id: "carpentry", label: "Carpenter's bench", branch: "craft", tier: 2, key: true, needs: [], price: { planks: 7, coins: 60 }, requires: [delivered("planks", 50)], blurb: "A carpenter's yard makes furniture from planks: towns pay well for it, and the biggest cities want it.", brings: "Carpenter's yard, furniture" }),
  row({ id: "joinery", label: "Joinery", branch: "craft", tier: 2, needs: ["carpentry"], price: { planks: 6, coins: 140 }, requires: [delivered("furniture", 30)], blurb: "A turning lathe in every carpenter's yard: furniture made 1.5× as fast.", brings: "A lathe in each carpenter's yard", feature: { label: "Carpenters 1.5× as fast", icon: "🪑" } }),
  // The toy chain (2026-11-04): a flower field (a new kind of field) -> flowers -> dye works -> paint; then planks +
  // paint -> toys, the very top of the made goods, studied at a University.
  row({ id: "paint", label: "Dye works", branch: "craft", tier: 2, needs: ["farming"], price: { planks: 8, coins: 120 }, requires: [CITY], blurb: "Flower fields grow flowers, and a dye works boils them into bright paint. Towns buy both.", brings: "Flower field, dye works" }),
  row({ id: "toys", label: "Toy workshop", branch: "craft", tier: 3, school: "university", needs: ["carpentry", "paint"], price: { planks: 12, coins: 260 }, requires: [delivered("furniture", 20)], blurb: "Planks and paint make toys. Towns pay more for them than for any made good but cars.", brings: "Toy workshop" }),
  row({ id: "scenery", label: "Scenery kit", branch: "craft", tier: 1, needs: ["carpentry"], price: { planks: 5 }, blurb: "Sights for the line (a castle gate, a train wash, a weighbridge, a track cleaner) and furniture beside it (clocks, whistle posts).", brings: "Castle gate, train wash, weighbridge, track cleaner, lineside furniture" }),
  // Your own colours (the user's ask, 2026-11-05): after the Dye works, a pot of paint a coat.
  row({ id: "paint-trains", label: "Paint your trains", branch: "craft", tier: 2, needs: ["paint"], price: { planks: 6, coins: 120 }, blurb: "Your own colours at the paint shop, for an engine and its wagons: a pot of paint from the workshop a coat.", brings: "Your own colours (the paint shop)", feature: { label: "Your own colours (an engine's paint shop)", icon: "✨" } }),
  row({ id: "smithy", label: "Smithy", branch: "craft", tier: 3, school: "college", needs: ["foundry", "carpentry"], price: { coins: 60, goods: { iron: 10 } }, blurb: "A smithy makes tools from iron, and your wagons hold 5 instead of 3.", brings: "Smithy, tools, heavy wagons", feature: { label: "Wagons hold 5", icon: "🧰" } }),
  row({ id: "toolworks", label: "Tool works", branch: "craft", tier: 3, school: "university", needs: ["smithy"], price: { planks: 10, coins: 300 }, requires: [delivered("tools", 30)], blurb: "A steam hammer in every smithy: tools made 1.5× as fast.", brings: "A steam hammer in each smithy", feature: { label: "Smithies 1.5× as fast", icon: "🔧" } }),
  row({ id: "clockmaker", label: "Clockmaker", branch: "craft", tier: 3, plan: "later", needs: ["smithy", "college"], price: { planks: 20, coins: 100, goods: { iron: 10 } }, blurb: "Clocks for every station: trains keep a timetable.", brings: "Station clocks, timetables" }),

  // Learning
  // (The school is the building you place, not a blueprint; beside a city it grows a library wing, for tier 3.)
  row({ id: "study-hall", label: "Study hall", branch: "learning", tier: 1, needs: ["farming"], price: { planks: 4 }, blurb: "Easy lessons go twice as fast.", brings: "Quicker easy lessons", feature: { label: "Tier-1 study 2× at any school", icon: "📚" } }),
  row({ id: "college", label: "College", branch: "learning", tier: 2, needs: ["routes"], price: { planks: 10, coins: 120 }, requires: [count("blueprints", 10)], blurb: "Schools by towns become colleges: research 2× as fast.", brings: "Colleges", feature: { label: "Research 2× at a town's school", icon: "🎓" } }),
  row({ id: "reading-room", label: "Reading room", branch: "learning", tier: 2, needs: ["college"], price: { planks: 6, coins: 120 }, blurb: "Your schools get ready for the next lesson: once this one's goods are in, they collect the next one's.", brings: "Reading rooms", how: "Queue two researches: schools collect for the second once the first one's goods are in", feature: { label: "Schools collect for the next research too", icon: "📘" } }),
  row({ id: "telegraph", label: "Telegraph", branch: "learning", tier: 2, needs: ["signal-boxes"], price: { planks: 6, coins: 120 }, blurb: "Wires along the line: a signal box works the points and signals by every telegraph pole wired to it.", brings: "Telegraph poles", how: "Put telegraph poles in a chain from a signal box to far points, then tap the box", feature: { label: "Signal boxes reach along the wires", icon: "🔔" } }),
  row({ id: "electricity", label: "Electricity", branch: "learning", tier: 3, school: "college", needs: ["mines", "college"], price: { planks: 24, coins: 120, goods: { iron: 10 } }, research: study({ iron: 10, coal: 10 }, 240), blurb: "A power station burns coal: electric engines run while it has some.", brings: "Power station, colour-light signal" }),
  row({ id: "university", label: "University", branch: "learning", tier: 3, school: "college", needs: ["college"], price: { planks: 14, coins: 300 }, requires: [count("blueprints", 20)], blurb: "A College in a city becomes a University: the hardest lessons are taught there, and every hard lesson needs a third fewer goods. The Research picker shows every blueprint left to find.", brings: "Universities, hard lessons for fewer goods", feature: { label: "Tier-3 research: a third fewer goods", icon: "🏛️" } }),
  row({ id: "wind", label: "Wind farm", branch: "learning", tier: 3, plan: "later", needs: ["electricity"], price: { planks: 20, coins: 100, goods: { iron: 10 } }, blurb: "Windmills on the hills make power without coal.", brings: "Wind turbines" }),
  row({ id: "radio", label: "Radio mast", branch: "learning", tier: 3, plan: "later", needs: ["electricity", "telegraph"], price: { planks: 16, coins: 80, goods: { iron: 6 } }, blurb: "Stations announce the trains: more people travel.", brings: "Radio mast" }),
  row({ id: "observatory", label: "Observatory", branch: "learning", tier: 3, plan: "soon", needs: ["university", "foundry"], price: { planks: 30, coins: 150, goods: { iron: 20 } }, blurb: "A telescope on the hill: the first step toward the rocket.", brings: "Observatory" }),

  // Town life
  row({ id: "town-hall", label: "Town hall", branch: "civic", tier: 2, needs: [], price: { planks: 4, coins: 80 }, requires: [CITY], blurb: "Build a town hall in a town (from its card) to plan its places: a park, a fire station and more.", feature: { label: "Town hall (built from a town's card)", icon: "🏛️" }, brings: "Town hall, Places on a town's card" }),
  row({ id: "post-office", label: "Post office", branch: "civic", tier: 2, needs: ["routes"], price: { planks: 10, coins: 120 }, requires: [TOWN], blurb: "Towns post mail. A red mail van takes it to a post office, and the sorted post on to towns: they pay well, and post vans drive their streets.", brings: "Post office, mail van" }),
  row({ id: "fire-station", label: "Fire station", branch: "civic", tier: 2, needs: ["town-hall"], price: { planks: 4, coins: 100 }, blurb: "A fire station keeps a town safe: +1 😊, so it needs fewer goods to grow.", feature: { label: "Fire station (on a town's card)", icon: "🔥" }, brings: "Fire station (+1 😊)" }),
  row({ id: "police", label: "Police station", branch: "civic", tier: 2, needs: ["town-hall"], price: { planks: 4, coins: 100 }, blurb: "Friendly faces on the corner: +1 😊, so the town needs fewer goods to grow.", feature: { label: "Police station (on a town's card)", icon: "🌟" }, brings: "Police station (+1 😊)" }),
  row({ id: "hospital", label: "Hospital", branch: "civic", tier: 3, needs: ["college", "town-hall"], price: { planks: 6, coins: 150 }, blurb: "Doctors for a whole city: +1 😊.", feature: { label: "Hospital (on a town's card)", icon: "🏥" }, brings: "Hospital (+1 😊)" }),
  row({ id: "bank", label: "Bank", branch: "civic", tier: 3, needs: ["warehouses", "town-hall"], price: { planks: 6, coins: 200 }, blurb: "One bank on the map: land and lowering hills cost a quarter less.", feature: { label: "Bank (on a town's card)", icon: "🪙" }, brings: "Bank (one per map)" }),
  row({ id: "museum", label: "Museum", branch: "civic", tier: 3, needs: ["university", "town-hall"], price: { planks: 6, coins: 200 }, blurb: "One museum on the map: visitors all year, who pay half again for their ride there.", feature: { label: "Museum (on a town's card)", icon: "🖼️" }, brings: "Museum (one per map)" }),
  row({ id: "clock-tower", label: "Clock tower", branch: "civic", tier: 3, needs: ["foundry", "town-hall"], price: { planks: 6, coins: 150, goods: { iron: 10 } }, blurb: "The whole town keeps time: +1 😊.", feature: { label: "Clock tower (on a town's card)", icon: "⏱️" }, brings: "Clock tower (+1 😊)" }),

  // Leisure and sports
  row({ id: "park", label: "Park and bandstand", branch: "leisure", tier: 2, needs: ["town-hall"], price: { planks: 4, coins: 60 }, blurb: "Towns with a park grow a little faster: +1 😊.", feature: { label: "Park (on a town's card)", icon: "🌳" }, brings: "Park, bandstand (+1 😊)" }),
  row({ id: "beach", label: "Beach and pier", branch: "leisure", tier: 2, needs: ["stations", "park"], price: { planks: 4, coins: 120 }, blurb: "Day trippers in summer: riders who get off there pay twice the fare.", feature: { label: "Beach (on a town's card)", icon: "🏖️" }, brings: "Pier, beach huts (summer visitors)" }),
  row({ id: "sports-field", label: "Sports field", branch: "leisure", tier: 2, needs: ["park"], price: { planks: 4, coins: 100 }, blurb: "Weekend matches: +1 😊, and visitors in spring and autumn.", feature: { label: "Sports field (on a town's card)", icon: "⚽" }, brings: "Sports field (+1 😊)" }),
  row({ id: "swimming", label: "Swimming baths", branch: "leisure", tier: 3, needs: ["park", "electricity"], price: { planks: 6, coins: 150 }, blurb: "Visitors all year round, and +1 😊.", feature: { label: "Swimming baths (on a town's card)", icon: "🌊" }, brings: "Swimming baths (+1 😊, visitors)" }),
  row({ id: "stadium", label: "Football stadium", branch: "leisure", tier: 3, needs: ["sports-field", "stations"], price: { planks: 10, coins: 300, goods: { stone: 20 } }, blurb: "One stadium on the map: crowds ride trains to it from every town, and pay more.", feature: { label: "Stadium (on a town's card)", icon: "🏟️" }, brings: "Stadium (one per map)" }),
  row({ id: "racecourse", label: "Racecourse", branch: "leisure", tier: 3, plan: "later", needs: ["sports-field", "farming2"], price: { planks: 30, coins: 150 }, blurb: "Race days, and horse boxes on the trains.", brings: "Racecourse, horse box wagon" }),
  row({ id: "golf", label: "Golf course", branch: "leisure", tier: 3, needs: ["park", "bank"], price: { planks: 6, coins: 200 }, blurb: "Quiet visitors who pay first-class fares.", feature: { label: "Golf course (on a town's card)", icon: "⛳" }, brings: "Golf course (visitors)" }),
  row({ id: "cinema", label: "Cinema", branch: "leisure", tier: 3, needs: ["electricity", "park"], price: { planks: 6, coins: 150 }, blurb: "Visitors to the pictures, the most in winter.", feature: { label: "Cinema (on a town's card)", icon: "🎬" }, brings: "Cinema (visitors)" }),
  row({ id: "theatre", label: "Theatre", branch: "leisure", tier: 3, needs: ["college", "stations", "park"], price: { planks: 6, coins: 180 }, blurb: "A city's theatre draws visitors from far away: they pay twice the fare.", feature: { label: "Theatre (on a town's card)", icon: "🎭" }, brings: "Theatre (visitors)" }),
  row({ id: "circus", label: "Circus", branch: "leisure", tier: 3, plan: "later", needs: ["toys", "goods-engine"], price: { planks: 20, coins: 80 }, blurb: "A big top that moves from town to town.", brings: "Big top" }),
  row({ id: "funfair", label: "Funfair", branch: "leisure", tier: 3, needs: ["park", "bakery"], price: { planks: 6, coins: 180 }, blurb: "A carousel and stalls: visitors all year, and food sells for a quarter more there.", feature: { label: "Funfair (on a town's card)", icon: "🎠" }, brings: "Carousel, stalls (visitors)" }),
  row({ id: "zoo", label: "Zoo and safari park", branch: "leisure", tier: 3, plan: "later", needs: ["trade", "farming2"], price: { planks: 30, coins: 150 }, blurb: "Animals arrive by ship and train; visitors follow.", brings: "Zoo, animal wagons" }),
  row({ id: "ski", label: "Ski resort and cable car", branch: "leisure", tier: 3, plan: "later", needs: ["rack", "stations"], price: { planks: 30, coins: 150, goods: { iron: 20 } }, blurb: "On the tallest hill: skiers by mountain railway.", brings: "Ski lodge, cable car" }),
  row({ id: "sailing", label: "Sailing club", branch: "leisure", tier: 3, needs: ["harbours", "park"], price: { planks: 6, coins: 150 }, blurb: "Regattas in summer: riders who get off there pay twice the fare.", feature: { label: "Sailing club (on a town's card)", icon: "⛵" }, brings: "Sailing club (summer visitors)" }),

  // Water and air
  row({ id: "harbours", label: "Harbours", branch: "water", tier: 3, needs: ["warehouses", "bridges"], price: { planks: 30, coins: 150, goods: { stone: 20 } }, blurb: "A quay by the river. Boats call by themselves and take what you leave there, 6 loads a visit, paid at half a town's price.", brings: "Harbour, rowing boats" }),
  row({ id: "dock-sheds", label: "Dock sheds", branch: "water", tier: 3, school: "college", needs: ["harbours"], price: { planks: 6, coins: 80 }, blurb: "Build sheds beside a harbour's quay (from its card, 30 coins each, up to three): each holds 12 more of every good for the boats.", feature: { label: "Dock sheds (on a harbour's card)", icon: "🏚️" }, brings: "Dock shed" }),
  row({ id: "barges", label: "River barges", branch: "water", tier: 3, plan: "later", needs: ["harbours", "cranes2"], price: { planks: 20, coins: 80 }, blurb: "A tugboat with barges: boats take 12 loads a visit instead of 6.", brings: "Tugboat and barges" }),
  row({ id: "trade", label: "Imports and exports", branch: "water", tier: 3, plan: "soon", needs: ["harbours"], price: { coins: 100 }, requires: [landmark("trading-house", "a trading house")], blurb: "Order goods on the next boat: what you've made, then goods from abroad.", brings: "Buying at harbours and the map's edge" }),
  row({ id: "ferry", label: "Train ferry", branch: "water", tier: 3, plan: "later", needs: ["harbours", "junctions"], price: { planks: 24, coins: 120, goods: { iron: 10 } }, blurb: "Trains ride a ferry across wide water.", brings: "Train ferry" }),
  row({ id: "lighthouse", label: "Lighthouse", branch: "water", tier: 3, plan: "later", needs: ["harbours"], price: { planks: 16, coins: 60, goods: { stone: 10 } }, blurb: "Boats call twice as often, at night too.", brings: "Lighthouse" }),
  row({ id: "cargo-ships", label: "Cargo ships", branch: "water", tier: 3, plan: "later", needs: ["barges", "trade", "cranes3"], price: { planks: 30, coins: 200, goods: { iron: 20 } }, blurb: "Big ships take 24 loads a visit; a container crane loads them.", brings: "Cargo ship, container crane" }),
  row({ id: "airport", label: "Airport", branch: "water", tier: 3, plan: "later", needs: ["electricity", "trade"], price: { planks: 40, coins: 300, goods: { iron: 30 } }, blurb: "Planes carry passengers between far cities; trains bring them to the terminal.", brings: "Airport, plane" }),
  row({ id: "airship", label: "Airship", branch: "water", tier: 3, plan: "later", needs: ["airport"], price: { planks: 20, coins: 150 }, blurb: "A slow, grand airship over your railway.", brings: "Airship mast" }),

  // Passengers: researched, each once you've carried enough people. Light on planks (the towns need them), and from
  // tier 2 paid mostly in coins, which the passenger line earns (P5).
  row({ id: "passengers", label: "Passengers", branch: "passengers", tier: 1, key: true, needs: [], price: { planks: 6 }, blurb: "Coaches carry people between towns: they pay a fare by how far they ride.", brings: "Coach" }),
  row({ id: "halts", label: "Halts", branch: "passengers", tier: 1, needs: ["passengers"], price: { planks: 6 }, blurb: "Halts and small stations on your lines near a town: more places for its people to get on and off.", brings: "Country halt, mountain station, harbour station, platform" }),
  row({ id: "dining", label: "Dining car", branch: "passengers", tier: 1, key: true, needs: ["passengers"], price: { planks: 4 }, requires: [count("riders", 20)], blurb: "Everyone on a train with a dining car pays half as much again.", brings: "Dining car", feature: { label: "Dining car (Trains tab)", icon: "🍽️" } }),
  row({ id: "first-class", label: "First class", branch: "passengers", tier: 2, needs: ["dining"], price: { planks: 6, coins: 120 }, requires: [count("riders", 60)], blurb: "A first-class coach: three seats, each paying double.", brings: "First-class coach", feature: { label: "First-class coach (Trains tab)", icon: "🥇" } }),
  row({ id: "stations", label: "Busy stations", branch: "passengers", tier: 2, needs: ["first-class"], price: { planks: 8, coins: 160 }, requires: [count("riders", 100)], blurb: "Twice as many people come to each station, and more can wait.", brings: "More people at stations", feature: { label: "More people at stations", icon: "🚉" } }),
  row({ id: "double-decker", label: "Double-decker", branch: "passengers", tier: 2, needs: ["stations"], price: { planks: 8, coins: 200 }, requires: [count("riders", 160)], blurb: "A coach with eight seats.", brings: "Double-decker coach", feature: { label: "Double-decker coach (Trains tab)", icon: "🚃" } }),
  row({ id: "express", label: "Express engine", branch: "passengers", tier: 2, needs: ["double-decker"], price: { planks: 10, coins: 240 }, requires: [count("riders", 250)], blurb: "An engine that runs half as fast again.", brings: "Express engine", feature: { label: "Express engine (Trains tab)", icon: "⚡" } }),
  row({ id: "sleeper", label: "Night sleepers", branch: "passengers", tier: 3, plan: "later", needs: ["first-class", "telegraph"], requires: [count("riders", 400)], blurb: "Sleeper trains between far cities: big fares.", brings: "Sleeper coach" }),
  row({ id: "observation", label: "Observation car", branch: "passengers", tier: 3, plan: "later", needs: ["first-class", "beach"], requires: [count("riders", 300)], blurb: "Glass-roofed sightseeing: resort visitors pay double.", brings: "Observation car" }),

  // Roads (spec 2026-10-31-roads.md): the Roads tab in Game mode, each square bought with coins (`ROAD_COINS`). Its
  // pieces are road squares, not things of `THING_RULES`, so the rows name what they open as a feature.
  row({ id: "roads", label: "Roads", branch: "roads", tier: 2, needs: ["passengers"], price: { planks: 2, coins: 60 }, requires: [level(1)], blurb: "Lay roads between your towns. Each square of road costs 2 coins.", brings: "Road, bend, T-junction, crossroads, dead end", feature: { label: "Roads tab: 2🪙 a square", icon: "🛣️" } }),
  row({ id: "road-crossings", label: "Crossing gates", branch: "roads", tier: 2, needs: ["roads"], price: { planks: 2, coins: 40 }, blurb: "Gates that close the road when a train comes, and a zebra crossing.", brings: "Level crossing, gated crossing, zebra crossing" }),
  row({ id: "road-bridges", label: "Road bridges", branch: "roads", tier: 2, needs: ["roads", "bridges"], price: { planks: 3, coins: 80 }, blurb: "Roads over rivers and up hills.", brings: "Road bridge, road ramps", feature: { label: "Road bridge and ramps (Roads tab)", icon: "🌉" } }),
  row({ id: "vans", label: "Delivery vans", branch: "roads", tier: 2, needs: ["roads", "warehouses"], price: { planks: 4, coins: 150 }, blurb: "Vans take goods from the station to towns off the line.", brings: "Delivery van", feature: { label: "A van at a station joined by road to a town off the line", icon: "🚐" } }),
  row({ id: "buses", label: "Buses", branch: "roads", tier: 2, needs: ["vans", "halts"], price: { planks: 3, coins: 120 }, blurb: "A bus brings people to your trains.", brings: "Bus stop, bus", feature: { label: "Bus stop (Industries tab, Lineside): beside a station, a bus brings people from a town off the line", icon: "🚌" } }),

  // The ending
  row({ id: "rocket", label: "Rocket works", branch: "ending", key: true, plan: "ending", needs: ["observatory", "trade", "express", "cranes3", "electricity"], requires: [level(4, 3)], blurb: "Build the rocket from parts brought by train. Not designed yet.", brings: "Rocket works" }),
  row({ id: "launch", label: "Launch pad", branch: "ending", key: true, plan: "ending", needs: ["rocket"], requires: [place("all the rocket's parts")], blurb: "Launch day: every town comes to watch. The railway carries on after.", brings: "The launch" }),
];

/** Blueprint ids from older saves, and what they became (risers joined bridges; turning loops joined junctions). */
export const RENAMED: Readonly<Record<string, string>> = { heights: "bridges", loops: "junctions" };

const LEVEL_NAMES = ["", "a village", "a town", "a city", "a city ★"];

/** A requirement in words, for cards and the roadmap: "200 loads moved", "a school beside a city", "3 cities ★". */
export function describeNeed(n: Need): string {
  switch (n.kind) {
    case "count":
      return `${n.n} ${STAT_LABELS[n.stat]}`;
    case "delivered":
      return `${n.n} ${n.good} delivered`;
    case "level":
      return n.towns && n.towns > 1 ? `${n.towns} ${["", "villages", "towns", "cities", "cities ★"][n.level]}` : LEVEL_NAMES[n.level];
    case "landmark":
      return n.label;
    case "place":
      return n.text;
  }
}

/** A price in words: "16 planks + 40 coins", "10 iron + 60 coins". */
export function describePrice(p: Price): string {
  const parts: string[] = [];
  if (p.planks) parts.push(`${p.planks} planks`);
  for (const [good, n] of Object.entries(p.goods ?? {})) parts.push(`${n} ${good}`);
  if (p.coins) parts.push(`${p.coins} coins`);
  return parts.join(" + ") || "free";
}
