import type { CarKind } from "../sim";

export type CargoKind = "log" | "planks" | "grain" | "flour" | "stone" | "coal" | "ore" | "iron" | "furniture" | "tools" | "milk" | "bread" | "fruit" | "juice" | "cheese" | "icecream" | "bricks" | "autos" | "fish" | "oil" | "water" | "sugar" | "jam" | "cocoa" | "chocolate" | "flowers" | "paint" | "toys" | "glass" | "mail" | "post";

/** Cargo kinds by snapshot index. */
export const CARGO_KINDS: readonly CargoKind[] = ["log", "planks", "grain", "flour", "stone", "coal", "ore", "iron", "furniture", "tools", "milk", "bread", "fruit", "juice", "cheese", "icecream", "bricks", "autos", "fish", "oil", "water", "sugar", "jam", "cocoa", "chocolate", "flowers", "paint", "toys", "glass", "mail", "post"];

export const CARGO: Record<CargoKind, { readonly index: number; readonly label: string }> = {
  log: { index: 0, label: "Logs" },
  planks: { index: 1, label: "Planks" },
  grain: { index: 2, label: "Grain" },
  flour: { index: 3, label: "Flour" },
  stone: { index: 4, label: "Stone" },
  // Mining and iron (Game mode's Phase C): coal and ore from a mine, iron from a foundry.
  coal: { index: 5, label: "Coal" },
  ore: { index: 6, label: "Ore" },
  iron: { index: 7, label: "Iron" },
  // Made goods: furniture from a carpenter's yard, tools from a smithy (towns pay well for them).
  furniture: { index: 8, label: "Furniture" },
  tools: { index: 9, label: "Tools" },
  // The dairy chain (tech-tree I3, I4): milk from a dairy farm; a bakery makes bread of flour and milk. Fruit from an
  // orchard (towns eat it as it comes; juice and jam come later).
  milk: { index: 10, label: "Milk" },
  bread: { index: 11, label: "Bread" },
  fruit: { index: 12, label: "Fruit" },
  // Juice from a juice works, pressed from an orchard's fruit (next nodes, 2026-11-02): bottles by the crate.
  juice: { index: 13, label: "Juice" },
  // Cheese from a creamery, made of a dairy's milk: round cheeses on a board.
  cheese: { index: 14, label: "Cheese" },
  // Ice cream from an ice cream factory, of milk and fruit: tubs, in cold vans only.
  icecream: { index: 15, label: "Ice cream" },
  // Bricks from a brickworks, fired of stone and coal: stacks on flatbeds.
  bricks: { index: 16, label: "Bricks" },
  // Cars from a car factory, of iron and planks (tech tree 3): little toy cars, on a car carrier only.
  autos: { index: 17, label: "Cars" },
  // Fish, the catch the boats bring to your harbours once Fishing boats is learned: crates of fish on ice.
  fish: { index: 18, label: "Fish" },
  // Tank wagons' goods (Tank wagons): oil from an oil well, water from a water pump by a river or lake.
  oil: { index: 19, label: "Oil" },
  water: { index: 20, label: "Water" },
  // The goods chains (2026-11-04): sugar in sacks from a sugar beet field, and jam of fruit and sugar in jars;
  sugar: { index: 21, label: "Sugar" },
  jam: { index: 22, label: "Jam" },
  // cocoa beans in sacks, landed by the boats at your harbours, and chocolate of cocoa and milk, in bars;
  cocoa: { index: 23, label: "Cocoa" },
  chocolate: { index: 24, label: "Chocolate" },
  // flowers in crates from a flower field, paint (tins) from a dye works, and toys of planks and paint.
  flowers: { index: 25, label: "Flowers" },
  paint: { index: 26, label: "Paint" },
  toys: { index: 27, label: "Toys" },
  // Glass from a glassworks, of coal and the sand dug beside it: panes in a crate (for the Cathedral's stained glass,
  // src/game/grand.ts, and towns' windows).
  glass: { index: 28, label: "Glass" },
  // The post (Post office): sacks of letters a town posts, and the post a post office sorts of them for towns. (From
  // 30, the coordinator's range for it: 28-29 are unused.)
  mail: { index: 30, label: "Mail" },
  post: { index: 31, label: "Post" },
};

/**
 * Slots for goods in arrays by snapshot index (piles, counts): one past the highest index. Not `CARGO_KINDS.length`:
 * indices can leave gaps (each branch adding goods takes its own range), and an index never moves (saves keep piles by
 * it). Masks of goods (`1 << index`) need every index under 32.
 */
export const CARGO_SLOTS = Math.max(...Object.values(CARGO).map((c) => c.index)) + 1;

/**
 * One icon per kind of goods, used wherever goods are counted (tray costs, cards, needs, the journal): "30🪵 10🪨" (logs and stone).
 * Each is one glyph (a single code point, at most with a variation selector; no joined sequences that older phones
 * draw as two), and no two kinds share one. Logs are 🪵 (it's a log: raw wood). On screen each is the game's own
 * drawing, not the emoji (src/icons/*.svg, compiled into the "Woodrail Icons" font: see style.css). Planks have no
 * emoji, so they're U+E000 (private use), three sawn boards with a strap. Where that font isn't used (a screen
 * reader, a copied text) it's silent or a box, so a line meant to be read without the picture says "planks" too.
 */
export const GOODS_ICON: Record<CargoKind, string> = {
  log: "🪵",
  planks: "\uE000",
  grain: "🌾",
  flour: "🍞",
  stone: "🪨",
  coal: "⚫",
  ore: "⛏️",
  iron: "🔩",
  furniture: "🪑",
  tools: "🧰",
  // The dairy chain's goods: drawn in the icon font (src/icons/u1F95B-milk, u1F956-bread, u1F34E-fruit).
  milk: "🥛",
  bread: "🥖",
  fruit: "🍎",
  // The next nodes' goods (src/icons/u1F9C3-juice).
  juice: "🧃",
  cheese: "🧀",
  icecream: "🍦",
  bricks: "🧱",
  // Tech tree 3's goods (src/icons/u1F697-car, u1F41F-fish).
  autos: "🚗",
  fish: "🐟",
  // Tank wagons' goods (src/icons/u1F6E2-oil, u1F4A7-water).
  oil: "🛢️",
  water: "💧",
  // The goods chains' (src/icons/u1F36C-sugar, u1FAD9-jam, u1FAD8-cocoa, u1F36B-chocolate, u1F337-flowers,
  // u1F3A8-paint, u1F9F8-toys).
  sugar: "🍬",
  jam: "🫙",
  cocoa: "🫘",
  chocolate: "🍫",
  flowers: "🌷",
  paint: "🎨",
  toys: "🧸",
  // (src/icons/u1FA9F-window.)
  glass: "🪟",
  // The post's goods (src/icons/u2709-letter, u1F4EE-post).
  mail: "✉️",
  post: "📮",
};

/** Coins, beside goods in a cost. */
export const COIN_ICON = "🪙";

/** What each kind of wagon carries: a kind of wagon per kind of goods (timber wagons take logs and planks). */
export const CARRIES: Partial<Record<CarKind, readonly CargoKind[]>> = {
  // Timber wagons are flatbeds: logs, planks, iron bars, crates of fruit and stacks of bricks.
  // (And crates of flowers.)
  timber: ["log", "planks", "iron", "fruit", "bricks", "flowers"],
  hopper: ["grain", "stone", "coal", "ore"],
  // Vans: sacks and crates (flour, made goods, bread, crates of juice bottles, cheeses). Milk goes in a tank wagon.
  // Fish, in crates on ice, ride in vans or cold vans.
  // The goods chains': sacks of sugar and cocoa, jars of jam, boxes of chocolate, tins of paint, boxes of toys.
  van: ["flour", "furniture", "tools", "bread", "juice", "cheese", "fish", "sugar", "jam", "cocoa", "chocolate", "paint", "toys", "glass"],
  tanker: ["milk"],
  // The cold van: cheese (which a van carries too) and, the only wagon it rides in, ice cream.
  // (Chocolate keeps best cold too.)
  reefer: ["cheese", "icecream", "fish", "chocolate"],
  // The car carrier: two decks of new cars, the only wagon they ride in.
  carrier: ["autos"],
  // The tank wagon: oil or water, the only wagon either rides in.
  oiltank: ["oil", "water"],
  // The mail van: a town's mail to the post office, and the sorted post on to towns. They ride in nothing else.
  mailvan: ["mail", "post"],
  // The sorting van (Sorting van): mail and post too, and it sorts its mail into post as the train runs (`SORT_SECONDS`).
  sortvan: ["mail", "post"],
};

/** The post's goods (Post office): a town's mail and the sorted post. Only a mail van or a sorting van carries them. */
export const POSTAL: ReadonlySet<CargoKind> = new Set(["mail", "post"]);

/** Can this kind of car carry cargo (any, or this kind)? */
export function canCarry(kind: CarKind, cargo?: CargoKind): boolean {
  const list = CARRIES[kind];
  return !!list && (cargo === undefined || list.includes(cargo));
}
