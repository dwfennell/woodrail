import type { ExplainerId } from "./explainer-keys";

export type { ExplainerId };

/**
 * Explainers: a short, friendly "Learn more" sheet for things that take a little more than a line to explain (a
 * signal, a route). Data only, and plain strings, so the registry is tested without a page: the sheet
 * (explainer-sheet.ts) draws one when it's first opened. This module and the sheet are loaded only then; which items
 * have one is the small map in explainer-keys.ts, loaded with the HUD.
 *
 * To give another tray item an explainer: add its id to `EXPLAINER_IDS` and its tray key to `FOR_ITEM` (both in
 * explainer-keys.ts), and its entry here. The tray's place card then shows Learn more for it.
 */

/** One section of an explainer: a heading, a few plain sentences, and a small picture. */
export interface ExplainerSection {
  readonly heading: string;
  readonly text: string;
  /** A small diagram, as an inline SVG string (drawn with the game's wood and felt colours; no images to load). */
  readonly picture: string;
  /** What the picture shows, for a screen reader. */
  readonly alt: string;
}

/** A "Learn more" sheet. */
export interface Explainer {
  readonly id: ExplainerId;
  readonly title: string;
  /** A line under the title. */
  readonly intro: string;
  /** Two to four sections. */
  readonly sections: readonly ExplainerSection[];
  /** Other explainers it links to at the end ("More about routes"). */
  readonly seeAlso?: readonly ExplainerId[];
}

/** The most sections a sheet has, and the fewest (short: a casual player reads it at a glance). */
export const SECTIONS_MIN = 2;
export const SECTIONS_MAX = 4;
/** The longest a section's text may be (a few lines on a 390 px phone). */
export const TEXT_MAX = 240;

// ---- pictures --------------------------------------------------------------------------------------------------
// Small inline SVG drawings, 260 × 84, in the game's colours: felt, beech track with two grooves, red and blue toy
// trains, signals as a dark head with round lamps.

const W = 260;
const H = 84;
const FELT = "#cfe3b4";
const WOOD = "#e7c89a";
const GROOVE = "#b38a57";
const INK = "#5e4128";

const svg = (body: string): string =>
  `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><rect x="0" y="0" width="${W}" height="${H}" rx="12" fill="${FELT}"/>${body}</svg>`;

/** A straight run of track from x0 to x1 at height y. */
const track = (x0: number, x1: number, y: number): string =>
  `<rect x="${x0}" y="${y - 8}" width="${x1 - x0}" height="16" rx="3" fill="${WOOD}"/><path d="M${x0} ${y - 3}H${x1}M${x0} ${y + 3}H${x1}" stroke="${GROOVE}" stroke-width="1.6"/>`;

/** Track along an SVG path (a loop's curve). */
const trackPath = (d: string): string =>
  `<path d="${d}" fill="none" stroke="${WOOD}" stroke-width="16" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${GROOVE}" stroke-width="7.6" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${WOOD}" stroke-width="4.4" stroke-linecap="round"/>`;

/** A toy train, `cars` long, its front at x facing right (or left with `flip`), on track at y. */
const train = (x: number, y: number, colour: string, cars = 2, flip = false): string => {
  const parts: string[] = [];
  // The engine: a body with a cab and a chimney.
  const ex = flip ? x : x - 30;
  parts.push(`<rect x="${ex}" y="${y - 11}" width="30" height="14" rx="4" fill="${colour}"/>`);
  parts.push(`<rect x="${flip ? ex + 18 : ex}" y="${y - 19}" width="12" height="9" rx="2" fill="${colour}"/>`);
  parts.push(`<rect x="${flip ? ex + 5 : ex + 21}" y="${y - 17}" width="4" height="7" rx="1" fill="#3a2a1c"/>`);
  for (let k = 0; k < cars - 1; k++) {
    const cx = flip ? x + 33 + k * 25 : x - 30 - 25 - k * 25;
    parts.push(`<rect x="${cx}" y="${y - 10}" width="22" height="12" rx="3" fill="${colour}" opacity="0.82"/>`);
  }
  // Wheels.
  const n = cars;
  for (let k = 0; k < n; k++) {
    const c0 = flip ? x + (k === 0 ? 0 : 33 + (k - 1) * 25) : x - (k === 0 ? 30 : 55 + (k - 1) * 25);
    const w = k === 0 ? 30 : 22;
    parts.push(`<circle cx="${c0 + 6}" cy="${y + 4}" r="3" fill="#3a2a1c"/><circle cx="${c0 + w - 6}" cy="${y + 4}" r="3" fill="#3a2a1c"/>`);
  }
  return parts.join("");
};

/** A signal at x, its post beside the track at y (above it with `side` -1, below with 1), its lamps lit as given. */
const signal = (x: number, y: number, lamps: readonly ("red" | "green" | "off")[], side: -1 | 1 = -1): string => {
  const colour = { red: "#ff3a24", green: "#2fd85e", off: "#5b534c" };
  const postTop = side < 0 ? y - 38 : y + 14;
  const head = side < 0 ? postTop - 2 : postTop + 14;
  const h = lamps.length * 11 + 4;
  const lit = lamps.map((c, i) => `<circle cx="${x}" cy="${head + 7 + i * 11}" r="4" fill="${colour[c]}"/>`).join("");
  return `<rect x="${x - 1.5}" y="${side < 0 ? postTop : y + 10}" width="3" height="28" fill="#6a5a4c"/><rect x="${x - 7}" y="${head}" width="14" height="${h}" rx="5" fill="#2e2a27"/>${lit}`;
};

/** A little arrow at (x, y) pointing right (dx 1) or left (dx -1), in ink. */
const arrow = (x: number, y: number, dx: 1 | -1, colour = INK): string =>
  `<path d="M${x - 9 * dx} ${y}H${x + 6 * dx}M${x + 1 * dx} ${y - 5}L${x + 7 * dx} ${y}L${x + 1 * dx} ${y + 5}" fill="none" stroke="${colour}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;

/** A label in the picture. */
const label = (x: number, y: number, text: string, anchor = "middle"): string =>
  `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Nunito, system-ui, sans-serif" font-size="11" font-weight="800" fill="${INK}">${text}</text>`;

/** A block tinted, as the game tints the one a signal guards. */
const block = (x0: number, x1: number, y: number, colour: string): string =>
  `<rect x="${x0}" y="${y - 12}" width="${x1 - x0}" height="24" rx="6" fill="${colour}" opacity="0.35"/>`;

const RED = "#d4483a";
const BLUE = "#3f74c9";

const SIGNAL_BLOCKS = svg(
  [block(130, 252, 56, "#e8a13a"), track(8, 252, 56), train(222, 56, RED), train(112, 56, BLUE), signal(124, 56, ["red", "off"]), label(190, 22, "the line ahead"), label(62, 22, "waits")].join(""),
);

const SIGNAL_PAIRS = svg(
  [
    // A passing loop: the line splits in two and joins again, a train on each road; a signal at each end of the loop,
    // each guarding the way into it (its arrow).
    trackPath("M8 58 H52 C80 58 82 36 110 36 H150 C178 36 180 58 208 58 H252"),
    trackPath("M52 58 C80 58 82 78 110 78 H150 C178 78 180 58 208 58"),
    train(150, 36, RED, 2),
    train(112, 78, BLUE, 2, true),
    signal(30, 58, ["green", "off"]),
    arrow(50, 26, 1),
    signal(230, 58, ["green", "off"]),
    arrow(210, 26, -1),
  ].join(""),
);

const SIGNAL_MODES = svg(
  [
    track(8, 252, 64),
    // Three signals, one in each mode, with their names over them.
    signal(48, 64, ["red", "green"]),
    label(48, 14, "Auto"),
    signal(130, 64, ["red", "off"]),
    label(130, 14, "Always red"),
    signal(212, 64, ["off", "green"]),
    label(212, 14, "Always green"),
  ].join(""),
);

const SIGNAL_ROUTES = svg(
  [
    // A junction: the train waits at the signal before the points; its route's way through is shown dashed.
    track(8, 252, 58),
    trackPath("M150 58 C190 58 196 26 236 26 H252"),
    `<path d="M128 58 H150 C190 58 196 26 236 26 H252" fill="none" stroke="#3f74c9" stroke-width="3" stroke-dasharray="6 5" stroke-linecap="round"/>`,
    train(110, 58, BLUE),
    signal(122, 58, ["red", "off"]),
    label(250, 80, "its way through, set and clear", "end"),
  ].join(""),
);

const ROUTE_PLAN = svg(
  [
    track(8, 252, 52),
    // Two stops, numbered, and the train between them.
    `<rect x="18" y="26" width="44" height="14" rx="3" fill="#c98f58"/><rect x="198" y="26" width="44" height="14" rx="3" fill="#c98f58"/>`,
    `<circle cx="40" cy="16" r="9" fill="${BLUE}"/><circle cx="220" cy="16" r="9" fill="${BLUE}"/>`,
    `<text x="40" y="20" text-anchor="middle" font-family="Nunito, system-ui, sans-serif" font-size="11" font-weight="900" fill="#fff">1</text><text x="220" y="20" text-anchor="middle" font-family="Nunito, system-ui, sans-serif" font-size="11" font-weight="900" fill="#fff">2</text>`,
    train(150, 52, RED),
    arrow(130, 76, 1),
    arrow(130, 76, -1),
  ].join(""),
);

const ROUTE_POINTS = svg(
  [
    track(8, 252, 58),
    trackPath("M120 58 C160 58 166 26 206 26 H252"),
    `<path d="M120 58 C160 58 166 26 206 26 H252" fill="none" stroke="${RED}" stroke-width="3" stroke-dasharray="6 5" stroke-linecap="round"/>`,
    // The lever thrown by itself.
    `<circle cx="132" cy="58" r="6" fill="#ffd88a" stroke="${INK}" stroke-width="1.5"/>`,
    train(100, 58, RED),
    label(250, 80, "sets the points itself", "end"),
  ].join(""),
);

const ROUTE_STOP = svg(
  [
    track(8, 252, 60),
    `<rect x="70" y="34" width="120" height="14" rx="3" fill="#c98f58"/>`,
    train(170, 60, RED, 3),
    // Crates on and off.
    `<rect x="96" y="14" width="14" height="12" rx="2" fill="#b07a3c"/><rect x="150" y="14" width="14" height="12" rx="2" fill="#b07a3c"/>`,
    label(58, 22, "drop", "end"),
    label(206, 22, "pick up", "start"),
  ].join(""),
);

// ---- the explainers --------------------------------------------------------------------------------------------

export const EXPLAINERS: Readonly<Record<ExplainerId, Explainer>> = {
  signals: {
    id: "signals",
    title: "Signals",
    intro: "Drag one onto a joint between two pieces of track.",
    sections: [
      {
        heading: "Trains wait for the line ahead",
        text: "A signal splits the track into blocks. One train at a time goes into a block: the next waits at the red signal till the track ahead is clear.",
        picture: SIGNAL_BLOCKS,
        alt: "A blue train waits at a red signal while a red train is on the line ahead.",
      },
      {
        heading: "Two at a passing place",
        text: "A signal looks one way only, so put them in pairs, one for each way. Put them at the ends of a loop or passing place, and two trains can share one line, passing there.",
        picture: SIGNAL_PAIRS,
        alt: "A passing loop with a train on each side, and a signal at each end.",
      },
      {
        heading: "Auto, Always red, Always green",
        text: "Tap a signal for its card. Auto: red while a train is ahead, green when clear. Always red stops every train (a tap on the signal does too). Always green lets them by, but trains still never crash.",
        picture: SIGNAL_MODES,
        alt: "Three signals: Auto with red and green lamps, Always red, and Always green.",
      },
      {
        heading: "Signals and routes",
        text: "A train on a route sets the points for itself. A signal before points is where it waits till its way through is set and clear. A signal held at red stops routed trains too.",
        picture: SIGNAL_ROUTES,
        alt: "A train waits at a signal before points; its route's way through is marked.",
      },
    ],
    seeAlso: ["routes"],
  },
  routes: {
    id: "routes",
    title: "Routes",
    intro: "A route tells a train where to go, so it runs by itself.",
    sections: [
      {
        heading: "Plan a route",
        text: "Tap a train, then Plan a route. Tap the stations and yards it should call at, in order, then Done. It goes round them again and again.",
        picture: ROUTE_PLAN,
        alt: "A train running between stop 1 and stop 2.",
      },
      {
        heading: "It sets the points",
        text: "A train on a route turns the points for itself as it goes, and waits if another train has the way. No need to set them by hand.",
        picture: ROUTE_POINTS,
        alt: "A train turning off at points it set itself.",
      },
      {
        heading: "What it does at a stop",
        text: "Tap a stop on the route: tick Drop, Pick up or both. Wait to fill holds the train till its wagons are full; untick both and it passes by.",
        picture: ROUTE_STOP,
        alt: "A train at a stop, dropping goods off and picking goods up.",
      },
    ],
    seeAlso: ["signals"],
  },
};

/** An explainer by its id. */
export const explainer = (id: ExplainerId): Explainer => EXPLAINERS[id];
