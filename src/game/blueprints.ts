/**
 * Every blueprint in Game mode, built or planned: the one list the blueprint board, the towns' offers, the rules for
 * learning (`tech.ts`) and the roadmap page (`npm run blueprints:page`) all read. A blueprint not built yet has a
 * `plan`: the board shows it as "coming soon" and nothing can learn it. To add one, add a row; to build one, take its
 * `plan` away (and give it its things in `THING_RULES`, or its feature in the game).
 *
 * Self-contained (no imports but types) so a plain Node script can read it.
 */

export type BranchId = "track" | "trains" | "logistics" | "industry" | "food" | "craft" | "learning" | "civic" | "leisure" | "water" | "passengers" | "ending";

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
  { id: "ending", label: "The ending", sub: "", color: "#3a2a1c" },
];

/** When a planned blueprint is meant to be built: next, coming soon (Phases C and D), someday, or the ending. */
export type Plan = "next" | "soon" | "later" | "ending";

/** Things counted over a game, that a blueprint can ask you to have done. */
export type Stat = "riders" | "blueprints" | "loadsMoved" | "logsCut" | "planksSawn" | "stoneCut" | "grainGrown" | "flourGround";

export const STAT_LABELS: Record<Stat, string> = {
  riders: "carried",
  blueprints: "blueprints learned",
  loadsMoved: "loads moved",
  logsCut: "logs cut",
  planksSawn: "planks sawn",
  stoneCut: "stone cut",
  grainGrown: "grain grown",
  flourGround: "flour ground",
};

/** Something you must have achieved (not paid) before a blueprint can be learned. */
export type Need =
  | { readonly kind: "count"; readonly stat: Stat; readonly n: number }
  /** This many of a good delivered to towns, all game. */
  | { readonly kind: "delivered"; readonly good: string; readonly n: number }
  /** One of your towns at this level (1 a village, 2 a town, 3 a city, 4 a city ★), or `towns` of them. */
  | { readonly kind: "level"; readonly level: number; readonly towns?: number }
  /** A building in one of your towns: a landmark (school, market, library) or, later, a city's major building. */
  | { readonly kind: "landmark"; readonly id: string; readonly label: string }
  /** Something about the map ("a town by water"): shown, but not yet checked by the game. */
  | { readonly kind: "place"; readonly text: string };

/** What learning it costs: planks and goods from the workshop's yard, and coins. */
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
   * board: offered by towns and schools, and learned on the board at its price. auto: learned by itself once what it
   * requires is done (the passenger line, by people carried; the school and library, when a town builds one).
   */
  readonly learn: "board" | "auto";
  /**
   * Which size of town offers it when it grows (1 a village, 2 a town, 3 a city): a growing town offers its own tier
   * first.
   */
  readonly tier?: 1 | 2 | 3;
  /** Not built yet: shown as coming soon (see `Plan`). */
  readonly plan?: Plan;
  /** Shown to a new player from the start (the rest are a "?" until something next to them is learned). */
  readonly key?: boolean;
  /** What it lets you do that isn't a thing to make (train routes), with an icon for the board. */
  readonly feature?: { readonly label: string; readonly icon: string };
}

const count = (stat: Stat, n: number): Need => ({ kind: "count", stat, n });
const delivered = (good: string, n: number): Need => ({ kind: "delivered", good, n });
const level = (l: number, towns?: number): Need => ({ kind: "level", level: l, ...(towns ? { towns } : {}) });
const landmark = (id: string, label: string): Need => ({ kind: "landmark", id, label });
const place = (text: string): Need => ({ kind: "place", text });
const TOWN = level(2);
const CITY = level(3);
const CITY_STAR = level(4);

type Row = Omit<Blueprint, "learn" | "requires" | "price"> & { learn?: "board" | "auto"; requires?: readonly Need[]; price?: Price };
const row = (r: Row): Blueprint => ({ learn: "board", requires: [], price: {}, ...r });

export const BLUEPRINTS: readonly Blueprint[] = [
  // Track
  row({ id: "switches", label: "Switches", branch: "track", tier: 1, key: true, needs: [], price: { planks: 6 }, blurb: "Branch a line in two.", brings: "Switch, Y switch" }),
  row({ id: "bridges", label: "Bridges and ramps", branch: "track", tier: 1, key: true, needs: [], price: { planks: 10 }, blurb: "Ramp up and over rivers and other lines, and raise track higher.", brings: "Ramps, bridges, risers" }),
  row({ id: "junctions", label: "Junctions and loops", branch: "track", tier: 1, key: true, needs: ["switches"], price: { planks: 12 }, blurb: "Three-ways, crossings, double track, and loops to turn a train round.", brings: "Crossings, wye, three-way, double track, balloon loops" }),
  row({ id: "signals", label: "Signals", branch: "track", tier: 1, key: true, needs: ["switches"], price: { planks: 8 }, blurb: "Two trains share a line: a train waits at a red signal until the track ahead is clear. Tap one to hold trains there.", brings: "Signal" }),
  row({ id: "tunnels", label: "Tunnels", branch: "track", tier: 2, plan: "soon", needs: ["bridges"], price: { planks: 16, coins: 40 }, blurb: "Through a hill instead of over it.", brings: "Tunnel portals in wood or stone" }),
  row({ id: "engine-shed", label: "Engine shed", branch: "track", tier: 2, plan: "soon", needs: ["junctions"], price: { planks: 20, coins: 50 }, blurb: "Park spare trains off the line; they come out polished.", brings: "Engine shed with four roads" }),
  row({ id: "turntable", label: "Turntable and roundhouse", branch: "track", tier: 2, plan: "later", needs: ["engine-shed"], price: { planks: 24, coins: 80 }, requires: [TOWN], blurb: "Turn an engine round on the spot; a roundhouse for six.", brings: "Turntable, roundhouse" }),
  row({ id: "viaduct", label: "Stone viaduct", branch: "track", tier: 3, plan: "later", needs: ["bridges", "quarries"], price: { planks: 20, coins: 100, goods: { stone: 40 } }, blurb: "A long stone bridge across a valley or a whole town.", brings: "Viaduct arches" }),
  row({ id: "lift-bridge", label: "Lift bridge", branch: "track", tier: 3, plan: "later", needs: ["bridges", "harbours"], price: { planks: 20, coins: 80, goods: { iron: 10 } }, blurb: "A bridge that lifts to let boats through.", brings: "Lift bridge" }),
  row({ id: "rack", label: "Mountain railway", branch: "track", tier: 3, plan: "later", needs: ["tunnels", "diesel"], price: { planks: 30, coins: 120, goods: { iron: 20 } }, blurb: "A rack line straight up the steepest hill.", brings: "Rack track, mountain engine" }),
  row({ id: "monorail", label: "Monorail", branch: "track", tier: 3, plan: "later", needs: ["electricity", "viaduct"], price: { planks: 30, coins: 200, goods: { iron: 30 } }, blurb: "A rail in the sky over a city.", brings: "Monorail track and car" }),
  row({ id: "metro", label: "Metro", branch: "track", tier: 3, plan: "later", needs: ["tunnels", "electricity"], price: { planks: 30, coins: 200, goods: { iron: 30 } }, requires: [CITY_STAR], blurb: "Trains under a city: a station in every quarter.", brings: "Metro stations, metro train" }),

  // Trains
  row({ id: "tank", label: "Tank engine", branch: "trains", tier: 1, key: true, needs: [], price: { planks: 8 }, blurb: "Pulls 3 cars (a classic engine pulls 4), but gets going and stops in half the time.", brings: "Tank engine", feature: { label: "Tank engine (Trains tab)", icon: "🚂" } }),
  row({ id: "goods-engine", label: "Goods engine", branch: "trains", tier: 2, needs: ["tank"], price: { planks: 16, coins: 40 }, requires: [count("loadsMoved", 200)], blurb: "Pulls 8 cars at 0.8× speed, for long freight trains.", brings: "Goods engine", feature: { label: "Goods engine (Trains tab)", icon: "🚂" } }),
  row({ id: "diesel", label: "Diesel", branch: "trains", tier: 2, needs: ["tank"], price: { planks: 18, coins: 60 }, requires: [TOWN], blurb: "Pulls 6 at 1.2×, and drives as well backwards.", brings: "Diesel engine", feature: { label: "Diesel (Trains tab)", icon: "🚂" } }),
  row({ id: "breakdown", label: "Breakdown crane", branch: "trains", tier: 2, plan: "soon", needs: ["goods-engine", "cranes1"], price: { planks: 14, coins: 40 }, blurb: "A crane wagon that puts derailed trains back on the line by itself.", brings: "Breakdown crane wagon" }),
  row({ id: "tankers", label: "Tank wagons", branch: "trains", tier: 2, plan: "soon", needs: ["dairy"], price: { planks: 6, coins: 20 }, blurb: "Milk, and later oil and water, in tanks.", brings: "Tank wagon" }),
  row({ id: "reefer", label: "Cold van", branch: "trains", tier: 2, plan: "later", needs: ["creamery"], price: { planks: 8, coins: 30 }, blurb: "Keeps ice cream, butter and fish cold on the way.", brings: "Refrigerated van" }),
  row({ id: "mail", label: "Mail vans", branch: "trains", tier: 2, plan: "soon", needs: ["post-office"], price: { planks: 6 }, blurb: "Letters and parcels between every pair of towns.", brings: "Mail van" }),
  row({ id: "electric", label: "Electric engine", branch: "trains", tier: 3, needs: ["diesel", "electricity"], price: { planks: 20, coins: 100, goods: { iron: 10 } }, blurb: "Pulls 6 cars at 1.4×, quietly, while a power station has coal.", brings: "Electric engine", feature: { label: "Electric engine (Trains tab)", icon: "⚡" } }),
  row({ id: "car-carrier", label: "Car carrier", branch: "trains", tier: 3, plan: "later", needs: ["car-factory"], price: { planks: 10, goods: { iron: 4 } }, blurb: "Brings new cars from the factory to the towns' roads.", brings: "Car carrier wagon" }),
  row({ id: "circus-train", label: "Circus train", branch: "trains", tier: 3, plan: "later", needs: ["circus"], price: { planks: 20, coins: 80 }, blurb: "The circus tours your towns: crowds wherever it stops.", brings: "Circus train" }),

  // Logistics
  row({ id: "routes", label: "Train routes", branch: "logistics", tier: 2, key: true, needs: ["switches"], price: { planks: 10, coins: 20 }, blurb: "Give a train its stops: it sets the switches on its way.", brings: "Routes on the engine card", feature: { label: "Routes on the engine card", icon: "🗺️" } }),
  row({ id: "warehouses", label: "Warehouses", branch: "logistics", tier: 2, key: true, needs: ["routes"], price: { planks: 16, coins: 40 }, blurb: "Keep goods for later: routed trains drop them off and pick them up.", brings: "Warehouse" }),
  row({ id: "cranes1", label: "Quicker cranes", branch: "logistics", tier: 1, key: true, needs: [], price: { planks: 8 }, blurb: "Every crane moves a load in 0.45 s instead of 0.6 s.", brings: "Faster cranes", feature: { label: "Cranes load in 0.45 s", icon: "🏗️" } }),
  row({ id: "cranes2", label: "Two-arm cranes", branch: "logistics", tier: 2, needs: ["cranes1"], price: { planks: 14, coins: 40 }, requires: [count("loadsMoved", 200)], blurb: "Cranes move a load in 0.3 s.", brings: "A second arm on every crane", feature: { label: "Cranes load in 0.3 s", icon: "🏗️" } }),
  row({ id: "cranes3", label: "Grab cranes", branch: "logistics", tier: 3, needs: ["cranes2", "smithy"], price: { planks: 24, coins: 100 }, requires: [CITY_STAR], blurb: "Cranes lift two loads at a time.", brings: "Grab cranes", feature: { label: "Cranes lift two at once", icon: "🏗️" } }),
  row({ id: "lift-load", label: "Lift and load", branch: "logistics", tier: 3, plan: "later", needs: ["warehouses", "cranes2"], price: { planks: 20, coins: 80 }, blurb: "A tall warehouse with a lift: stacks goods three high and loads two wagons at once.", brings: "Lift-and-load warehouse" }),

  // Industry
  row({ id: "harvesters", label: "Harvesters", branch: "industry", tier: 1, key: true, needs: [], price: { planks: 10 }, blurb: "A forest yard of your own, beside the trees.", brings: "Forest yard" }),
  row({ id: "harvesters2", label: "Harvesters II", branch: "industry", tier: 2, needs: ["harvesters"], price: { planks: 12, coins: 40 }, requires: [count("logsCut", 100)], blurb: "Forest yards work 1.5× as fast.", brings: "A log loader in each yard", feature: { label: "Forest yards 1.5× as fast", icon: "🪓" } }),
  row({ id: "harvesters3", label: "Harvesters III", branch: "industry", tier: 3, needs: ["harvesters2"], price: { planks: 20, coins: 100 }, requires: [count("logsCut", 400)], blurb: "Forest yards work twice as fast.", brings: "A steam log crane", feature: { label: "Forest yards twice as fast", icon: "🪓" } }),
  row({ id: "sawmills", label: "Sawmills", branch: "industry", tier: 2, key: true, needs: [], price: { planks: 15, coins: 20 }, blurb: "Build your own sawmill, wherever you like.", brings: "Sawmill" }),
  row({ id: "sawmills2", label: "Sawmills II", branch: "industry", tier: 2, needs: ["sawmills"], price: { planks: 14, coins: 40 }, requires: [count("planksSawn", 100)], blurb: "Sawmills work 1.5× as fast.", brings: "A second saw", feature: { label: "Sawmills 1.5× as fast", icon: "🪚" } }),
  row({ id: "sawmills3", label: "Sawmills III", branch: "industry", tier: 3, needs: ["sawmills2"], price: { planks: 24, coins: 100 }, requires: [count("planksSawn", 400)], blurb: "Sawmills work twice as fast.", brings: "A steam saw house", feature: { label: "Sawmills twice as fast", icon: "🪚" } }),
  row({ id: "quarries", label: "Quarries", branch: "industry", tier: 3, key: true, needs: ["mills", "library"], price: { planks: 24, coins: 40 }, blurb: "Cut stone from the hills, for growing cities.", brings: "Quarry" }),
  row({ id: "quarries2", label: "Quarries II", branch: "industry", tier: 3, needs: ["quarries"], price: { planks: 24, coins: 100 }, requires: [count("stoneCut", 60)], blurb: "Quarries work 1.5× as fast.", brings: "A stone crusher", feature: { label: "Quarries 1.5× as fast", icon: "⛏️" } }),
  row({ id: "brickworks", label: "Brickworks", branch: "industry", tier: 3, plan: "later", needs: ["quarries"], price: { planks: 20, coins: 60 }, blurb: "Clay from the riverbank makes bricks; brick towns grow taller.", brings: "Brickworks, brick houses" }),
  row({ id: "mines", label: "Mines", branch: "industry", tier: 3, needs: ["quarries", "goods-engine"], price: { planks: 20, coins: 80 }, requires: [delivered("stone", 20)], blurb: "A pithead in the hills brings up coal and iron ore, for a foundry.", brings: "Mine" }),
  row({ id: "foundry", label: "Foundry", branch: "industry", tier: 3, needs: ["mines"], price: { planks: 30, coins: 120 }, requires: [CITY_STAR], blurb: "Coal and ore make iron, which the biggest cities want and the workshop works with.", brings: "Foundry" }),
  row({ id: "car-factory", label: "Car factory", branch: "industry", tier: 3, plan: "later", needs: ["foundry", "paint"], price: { planks: 30, coins: 150, goods: { iron: 20 } }, blurb: "Iron and paint make toy cars for the roads.", brings: "Car factory" }),

  // Food
  row({ id: "farming", label: "Farming", branch: "food", tier: 1, key: true, needs: [], price: { planks: 12 }, blurb: "A farm yard by the fields, hoppers for its grain, and fields to plant.", brings: "Farm yard, hopper, fields" }),
  row({ id: "farming2", label: "Farming II", branch: "food", tier: 2, needs: ["farming"], price: { planks: 12, coins: 40 }, requires: [count("grainGrown", 60)], blurb: "Farm yards work 1.5× as fast.", brings: "A tractor in each yard", feature: { label: "Farm yards 1.5× as fast", icon: "🚜" } }),
  row({ id: "mills", label: "Mills", branch: "food", tier: 2, key: true, needs: ["farming"], price: { planks: 16, coins: 20 }, blurb: "Grind grain into flour, for the towns.", brings: "Mill, van" }),
  row({ id: "mills2", label: "Mills II", branch: "food", tier: 2, needs: ["mills"], price: { planks: 16, coins: 50 }, requires: [count("flourGround", 60)], blurb: "Mills work 1.5× as fast.", brings: "More millstones", feature: { label: "Mills 1.5× as fast", icon: "⚙️" } }),
  row({ id: "dairy", label: "Dairy farm", branch: "food", tier: 2, plan: "soon", needs: ["farming"], price: { planks: 14, coins: 40 }, blurb: "Cows and a milking shed: milk in tank wagons.", brings: "Dairy farm, cows" }),
  row({ id: "orchard", label: "Orchards", branch: "food", tier: 2, plan: "soon", needs: ["farming"], price: { planks: 12, coins: 30 }, blurb: "Apple trees planted like fields; apples by the crate.", brings: "Orchard" }),
  row({ id: "bakery", label: "Bakery", branch: "food", tier: 2, plan: "soon", needs: ["mills", "dairy"], price: { planks: 16, coins: 50 }, blurb: "Flour and milk make bread and cakes, which every town wants.", brings: "Bakery" }),
  row({ id: "creamery", label: "Creamery", branch: "food", tier: 2, plan: "soon", needs: ["dairy"], price: { planks: 16, coins: 50 }, blurb: "Milk makes butter and cheese.", brings: "Creamery" }),
  row({ id: "juice", label: "Juice works", branch: "food", tier: 2, plan: "later", needs: ["orchard"], price: { planks: 14, coins: 40 }, blurb: "Apples make juice, in bottles by the crate.", brings: "Juice works" }),
  row({ id: "ice-cream", label: "Ice cream factory", branch: "food", tier: 3, plan: "later", needs: ["creamery", "orchard"], price: { planks: 20, coins: 80 }, blurb: "Milk and fruit make ice cream. Seaside towns want lots.", brings: "Ice cream factory" }),
  row({ id: "fishing", label: "Fishing boats", branch: "food", tier: 3, plan: "soon", needs: ["harbours"], price: { planks: 16, coins: 40 }, blurb: "Fishing boats go out from your harbours and bring back fish. Towns take fish as well as flour, so a town by the water can grow without a farm.", brings: "Fishing boats, fish" }),
  row({ id: "chocolate", label: "Chocolate factory", branch: "food", tier: 3, plan: "later", needs: ["trade", "dairy"], price: { planks: 24, coins: 120 }, blurb: "Cocoa from abroad and milk make chocolate.", brings: "Chocolate factory" }),

  // Crafting
  row({ id: "carpentry", label: "Carpenter's bench", branch: "craft", tier: 2, key: true, needs: [], price: { planks: 14, coins: 30 }, requires: [delivered("planks", 50)], blurb: "A carpenter's yard makes furniture from planks: towns pay well for it, and the biggest cities want it.", brings: "Carpenter's yard, furniture" }),
  row({ id: "paint", label: "Dye works", branch: "craft", tier: 2, plan: "next", needs: ["farming"], price: { planks: 12, coins: 40 }, requires: [landmark("market", "a market")], blurb: "Flower fields make dye, and dye makes paint.", brings: "Dye works, flower fields, paint" }),
  row({ id: "toys", label: "Toy workshop", branch: "craft", tier: 2, plan: "next", needs: ["carpentry", "paint"], price: { planks: 16, coins: 60 }, requires: [delivered("furniture", 20)], blurb: "Planks and paint make toys, the goods towns pay best for.", brings: "Toys, toy van" }),
  row({ id: "scenery", label: "Scenery kit", branch: "craft", tier: 1, plan: "later", needs: ["carpentry"], price: { planks: 10 }, blurb: "Lamps, fences, flower beds and benches for your layout.", brings: "Scenery pieces" }),
  row({ id: "paint-trains", label: "Paint your trains", branch: "craft", tier: 2, plan: "later", needs: ["paint"], price: { planks: 6, coins: 20 }, blurb: "Paint engines, wagons and stations in your own colours.", brings: "A paint pot on every card" }),
  row({ id: "smithy", label: "Smithy", branch: "craft", tier: 3, needs: ["foundry", "carpentry"], price: { coins: 60, goods: { iron: 10 } }, blurb: "A smithy makes tools from iron, and your wagons hold 5 instead of 3.", brings: "Smithy, tools, heavy wagons", feature: { label: "Wagons hold 5", icon: "🧰" } }),
  row({ id: "clockmaker", label: "Clockmaker", branch: "craft", tier: 3, plan: "later", needs: ["smithy", "college"], price: { planks: 20, coins: 100, goods: { iron: 10 } }, blurb: "Clocks for every station: trains keep a timetable.", brings: "Station clocks, timetables" }),

  // Learning
  row({ id: "school", label: "School", branch: "learning", key: true, learn: "auto", needs: [], requires: [landmark("school", "a school")], blurb: "Goes up in a town that becomes a village. Has an idea (two blueprints) every few minutes.", brings: "School ideas", feature: { label: "School ideas", icon: "🏫" } }),
  row({ id: "library", label: "Library", branch: "learning", key: true, learn: "auto", needs: ["school"], requires: [landmark("library", "a library")], blurb: "Goes up in a town that becomes a city. Opens the advanced blueprints.", brings: "Advanced blueprints", feature: { label: "Advanced blueprints", icon: "📚" } }),
  row({ id: "college", label: "College", branch: "learning", tier: 2, needs: ["school", "routes"], price: { planks: 20, coins: 60 }, requires: [count("blueprints", 10)], blurb: "A college goes up in your next town to grow: ideas come twice as often, and blueprints cost a fifth fewer planks.", brings: "A college", feature: { label: "College in a town", icon: "🎓" } }),
  row({ id: "telegraph", label: "Telegraph", branch: "learning", tier: 2, plan: "soon", needs: ["signals", "school"], price: { planks: 14, coins: 50 }, blurb: "Wires along the line: see every train on the map, and call one home.", brings: "Telegraph poles" }),
  row({ id: "electricity", label: "Electricity", branch: "learning", tier: 3, needs: ["mines", "college"], price: { planks: 24, coins: 120, goods: { iron: 10 } }, blurb: "A power station burns coal: electric engines run while it has some.", brings: "Power station" }),
  row({ id: "university", label: "University", branch: "learning", tier: 3, plan: "soon", needs: ["college", "library"], price: { planks: 30, coins: 120 }, requires: [count("blueprints", 20)], blurb: "Shows every blueprint left to find; learn two at once.", brings: "A university" }),
  row({ id: "wind", label: "Wind farm", branch: "learning", tier: 3, plan: "later", needs: ["electricity"], price: { planks: 20, coins: 100, goods: { iron: 10 } }, blurb: "Windmills on the hills make power without coal.", brings: "Wind turbines" }),
  row({ id: "radio", label: "Radio mast", branch: "learning", tier: 3, plan: "later", needs: ["electricity", "telegraph"], price: { planks: 16, coins: 80, goods: { iron: 6 } }, blurb: "Stations announce the trains: more people travel.", brings: "Radio mast" }),
  row({ id: "observatory", label: "Observatory", branch: "learning", tier: 3, plan: "soon", needs: ["university", "foundry"], price: { planks: 30, coins: 150, goods: { iron: 20 } }, blurb: "A telescope on the hill: the first step toward the rocket.", brings: "Observatory" }),

  // Town life
  row({ id: "town-hall", label: "Town hall", branch: "civic", tier: 2, key: true, plan: "soon", needs: ["school"], price: { planks: 20, coins: 60 }, requires: [TOWN], blurb: "Name your towns, and nudge what each one grows toward.", brings: "Town hall" }),
  row({ id: "post-office", label: "Post office", branch: "civic", tier: 2, plan: "soon", needs: ["routes", "town-hall"], price: { planks: 16, coins: 40 }, blurb: "Mail between every pair of towns.", brings: "Post office" }),
  row({ id: "fire-station", label: "Fire station", branch: "civic", tier: 2, plan: "later", needs: ["town-hall"], price: { planks: 16, coins: 60 }, blurb: "A fire engine on the roads; towns with one grow a level bigger.", brings: "Fire station, fire engine" }),
  row({ id: "police", label: "Police station", branch: "civic", tier: 2, plan: "later", needs: ["town-hall"], price: { planks: 16, coins: 60 }, blurb: "A police car on the roads, and a lost-property office for stray wagons.", brings: "Police station, police car" }),
  row({ id: "hospital", label: "Hospital", branch: "civic", tier: 3, plan: "later", needs: ["college", "town-hall"], price: { planks: 24, coins: 100 }, blurb: "An ambulance on the roads; doctors ride the trains.", brings: "Hospital, ambulance" }),
  row({ id: "bank", label: "Bank", branch: "civic", tier: 3, plan: "later", needs: ["warehouses", "town-hall"], price: { planks: 20, coins: 150 }, blurb: "Coins earn a little while they wait; land costs less.", brings: "Bank" }),
  row({ id: "museum", label: "Museum", branch: "civic", tier: 3, plan: "later", needs: ["university"], price: { planks: 24, coins: 120 }, blurb: "Every building and train you've found, on show.", brings: "Museum" }),
  row({ id: "clock-tower", label: "Clock tower", branch: "civic", tier: 3, plan: "later", needs: ["clockmaker", "town-hall"], price: { planks: 30, coins: 120, goods: { iron: 10 } }, blurb: "The town keeps time: every train leaves on the dot.", brings: "Clock tower" }),

  // Leisure and sports
  row({ id: "park", label: "Park and bandstand", branch: "leisure", tier: 2, key: true, plan: "soon", needs: ["carpentry"], price: { planks: 12, coins: 30 }, blurb: "Towns with a park grow a little faster.", brings: "Park, bandstand" }),
  row({ id: "beach", label: "Beach and pier", branch: "leisure", tier: 2, plan: "later", needs: ["stations"], price: { planks: 16, coins: 60 }, requires: [place("a town by water")], blurb: "Day trippers by the trainload in summer.", brings: "Pier, beach huts" }),
  row({ id: "sports-field", label: "Sports field", branch: "leisure", tier: 2, plan: "later", needs: ["park"], price: { planks: 16, coins: 50 }, blurb: "Weekend matches: visitors from nearby towns.", brings: "Sports field" }),
  row({ id: "swimming", label: "Swimming baths", branch: "leisure", tier: 3, plan: "later", needs: ["park", "electricity"], price: { planks: 20, coins: 80 }, blurb: "Visitors all year round.", brings: "Swimming baths" }),
  row({ id: "stadium", label: "Football stadium", branch: "leisure", tier: 3, plan: "later", needs: ["sports-field", "stations"], price: { planks: 40, coins: 200, goods: { stone: 20 } }, requires: [CITY], blurb: "Match days: crowds ride trains from every town.", brings: "Stadium, floodlights" }),
  row({ id: "racecourse", label: "Racecourse", branch: "leisure", tier: 3, plan: "later", needs: ["sports-field", "farming2"], price: { planks: 30, coins: 150 }, blurb: "Race days, and horse boxes on the trains.", brings: "Racecourse, horse box wagon" }),
  row({ id: "golf", label: "Golf course", branch: "leisure", tier: 3, plan: "later", needs: ["park", "bank"], price: { planks: 20, coins: 120 }, blurb: "Quiet visitors who pay first-class fares.", brings: "Golf course" }),
  row({ id: "cinema", label: "Cinema", branch: "leisure", tier: 3, plan: "later", needs: ["electricity"], price: { planks: 20, coins: 80 }, blurb: "Evening crowds to the city.", brings: "Cinema" }),
  row({ id: "theatre", label: "Theatre", branch: "leisure", tier: 3, plan: "later", needs: ["college", "stations"], price: { planks: 24, coins: 100 }, blurb: "A city's theatre draws visitors from far away.", brings: "Theatre" }),
  row({ id: "circus", label: "Circus", branch: "leisure", tier: 3, plan: "later", needs: ["toys", "goods-engine"], price: { planks: 20, coins: 80 }, blurb: "A big top that moves from town to town.", brings: "Big top" }),
  row({ id: "funfair", label: "Funfair", branch: "leisure", tier: 3, plan: "later", needs: ["toys", "bakery"], price: { planks: 24, coins: 100 }, blurb: "A carousel and stalls: visitors from every town.", brings: "Carousel, stalls" }),
  row({ id: "zoo", label: "Zoo and safari park", branch: "leisure", tier: 3, plan: "later", needs: ["trade", "farming2"], price: { planks: 30, coins: 150 }, blurb: "Animals arrive by ship and train; visitors follow.", brings: "Zoo, animal wagons" }),
  row({ id: "ski", label: "Ski resort and cable car", branch: "leisure", tier: 3, plan: "later", needs: ["rack", "stations"], price: { planks: 30, coins: 150, goods: { iron: 20 } }, blurb: "On the tallest hill: skiers by mountain railway.", brings: "Ski lodge, cable car" }),
  row({ id: "sailing", label: "Sailing club", branch: "leisure", tier: 3, plan: "later", needs: ["harbours", "park"], price: { planks: 16, coins: 60 }, blurb: "Regattas bring visitors to the coast.", brings: "Sailing boats" }),

  // Water and air
  row({ id: "harbours", label: "Harbours", branch: "water", tier: 3, needs: ["warehouses", "bridges"], price: { planks: 30, coins: 150, goods: { stone: 20 } }, blurb: "A quay by the river. Boats call by themselves and take what you leave there, 6 loads a visit, paid at half a town's price.", brings: "Harbour, rowing boats" }),
  row({ id: "dock-sheds", label: "Dock sheds", branch: "water", tier: 3, plan: "soon", needs: ["harbours"], price: { planks: 12, coins: 40 }, blurb: "Sheds beside a quay: goods wait there for the next boat (up to three sheds, 12 loads each).", brings: "Dock shed" }),
  row({ id: "barges", label: "River barges", branch: "water", tier: 3, plan: "later", needs: ["harbours", "cranes2"], price: { planks: 20, coins: 80 }, blurb: "A tugboat with barges: boats take 12 loads a visit instead of 6.", brings: "Tugboat and barges" }),
  row({ id: "trade", label: "Imports and exports", branch: "water", tier: 3, plan: "soon", needs: ["harbours"], price: { coins: 100 }, requires: [landmark("trading-house", "a trading house")], blurb: "Order goods on the next boat: what you've made, then goods from abroad.", brings: "Buying at harbours and the map's edge" }),
  row({ id: "ferry", label: "Train ferry", branch: "water", tier: 3, plan: "later", needs: ["harbours", "junctions"], price: { planks: 24, coins: 120, goods: { iron: 10 } }, blurb: "Trains ride a ferry across wide water.", brings: "Train ferry" }),
  row({ id: "lighthouse", label: "Lighthouse", branch: "water", tier: 3, plan: "later", needs: ["harbours"], price: { planks: 16, coins: 60, goods: { stone: 10 } }, blurb: "Boats call twice as often, at night too.", brings: "Lighthouse" }),
  row({ id: "cargo-ships", label: "Cargo ships", branch: "water", tier: 3, plan: "later", needs: ["barges", "trade", "cranes3"], price: { planks: 30, coins: 200, goods: { iron: 20 } }, blurb: "Big ships take 24 loads a visit; a container crane loads them.", brings: "Cargo ship, container crane" }),
  row({ id: "airport", label: "Airport", branch: "water", tier: 3, plan: "later", needs: ["electricity", "trade"], price: { planks: 40, coins: 300, goods: { iron: 30 } }, blurb: "Planes carry passengers between far cities; trains bring them to the terminal.", brings: "Airport, plane" }),
  row({ id: "airship", label: "Airship", branch: "water", tier: 3, plan: "later", needs: ["airport"], price: { planks: 20, coins: 150 }, blurb: "A slow, grand airship over your railway.", brings: "Airship mast" }),

  // Passengers: learned by themselves as you carry people (after Passengers itself).
  row({ id: "passengers", label: "Passengers", branch: "passengers", tier: 1, key: true, needs: [], price: { planks: 10 }, blurb: "Coaches carry people between towns: they pay a fare by how far they ride.", brings: "Coach, caboose" }),
  row({ id: "dining", label: "Dining car", branch: "passengers", key: true, learn: "auto", needs: ["passengers"], requires: [count("riders", 20)], blurb: "Everyone on a train with a dining car pays half as much again.", brings: "Dining car", feature: { label: "Dining car (Trains tab)", icon: "🍽️" } }),
  row({ id: "first-class", label: "First class", branch: "passengers", learn: "auto", needs: ["dining"], requires: [count("riders", 60)], blurb: "A first-class coach: three seats, each paying double.", brings: "First-class coach", feature: { label: "First-class coach (Trains tab)", icon: "🥇" } }),
  row({ id: "stations", label: "Busy stations", branch: "passengers", learn: "auto", needs: ["first-class"], requires: [count("riders", 100)], blurb: "Twice as many people come to each station, and more can wait.", brings: "More people at stations", feature: { label: "More people at stations", icon: "🚉" } }),
  row({ id: "double-decker", label: "Double-decker", branch: "passengers", learn: "auto", needs: ["stations"], requires: [count("riders", 160)], blurb: "A coach with eight seats.", brings: "Double-decker coach", feature: { label: "Double-decker coach (Trains tab)", icon: "🚃" } }),
  row({ id: "express", label: "Express engine", branch: "passengers", learn: "auto", needs: ["double-decker"], requires: [count("riders", 250)], blurb: "An engine that runs half as fast again.", brings: "Express engine", feature: { label: "Express engine (Trains tab)", icon: "⚡" } }),
  row({ id: "sleeper", label: "Night sleepers", branch: "passengers", learn: "auto", plan: "later", needs: ["first-class", "telegraph"], requires: [count("riders", 400)], blurb: "Sleeper trains between far cities: big fares.", brings: "Sleeper coach" }),
  row({ id: "observation", label: "Observation car", branch: "passengers", learn: "auto", plan: "later", needs: ["first-class", "beach"], requires: [count("riders", 300)], blurb: "Glass-roofed sightseeing: resort visitors pay double.", brings: "Observation car" }),

  // The ending
  row({ id: "rocket", label: "Rocket works", branch: "ending", key: true, plan: "ending", needs: ["observatory", "trade", "express", "cranes3", "electricity"], requires: [level(4, 3)], blurb: "Build the rocket from parts brought by train. Not designed yet.", brings: "Rocket works" }),
  row({ id: "launch", label: "Launch pad", branch: "ending", key: true, plan: "ending", needs: ["rocket"], requires: [place("all the rocket's parts")], blurb: "Launch day: every town comes to watch. The railway carries on after.", brings: "The launch" }),
];

/** Blueprint ids from older saves, and what they became (risers joined bridges; turning loops joined junctions). */
export const RENAMED: Readonly<Record<string, string>> = { heights: "bridges", loops: "junctions" };

const LEVEL_NAMES = ["", "a village", "a town", "a city", "a city ★"];

/** A requirement in words, for cards and the roadmap: "200 loads moved", "a library", "3 cities ★". */
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
