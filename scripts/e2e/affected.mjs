// Which end-to-end suites (and groups) a change may affect: `npm run e2e:affected [-- <base-ref>] [--run] [--json]`.
// Diffs the working tree (committed, staged, unstaged and new files) against the merge base with <base-ref> (default
// origin/main), maps each changed path through RULES below, and prints the suites to run, as commands. --run runs them
// one after another (with E2E_ONLY for a suite narrowed to groups), and stops at none: it prints each one's last line.
//
// To extend: add a rule to RULES (a glob or a list of them, and what it affects: "suite" or "suite:group,group"), or a
// suite to SUITES. A path no rule matches gets SMOKE (and is listed as unmapped, so the map can be filled in), unless
// IGNORE matches it. Rules are additive: a path matching several gets all of them. A whole suite wins over its groups.
// See docs/agents/e2e.md.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { classify, refersToClasses, refersToWords } from "./lib/diff-kind.mjs";
import { ROOT } from "./lib/groups.mjs";

/** Each suite: its npm script, and whether it has groups (E2E_ONLY, --list, resume through scripts/e2e/lib/groups.mjs). */
export const SUITES = {
  touch: { script: "e2e:touch", groups: true, minutes: 40 },
  click: { script: "e2e:click", groups: true, minutes: 40 },
  draw: { script: "e2e:draw", groups: true, minutes: 90 },
  roads: { script: "e2e:roads", groups: true },
  names: { script: "e2e:names", minutes: 12 },
  cloud: { script: "e2e:cloud", groups: true, minutes: 20 },
  tutorial: { script: "e2e:tutorial" },
  joints: { script: "e2e:joints", groups: true },
  ramps: { script: "e2e:ramps", groups: true },
  tray: { script: "e2e:tray", groups: true },
  decks: { script: "e2e:decks" },
  kits: { script: "e2e:kits", minutes: 12 },
  "kits-game": { script: "e2e:kits-game" },
  "station-clock": { script: "e2e:station-clock" },
  "big-stations": { script: "e2e:big-stations" },
  landscaping: { script: "e2e:landscaping", minutes: 3 },
  "station-upgrade": { script: "e2e:station-upgrade", minutes: 5 },
  "station-touches": { script: "e2e:station-touches", minutes: 5 },
  lift: { script: "e2e:lift" },
  loop: { script: "e2e:loop" },
  research: { script: "e2e:research", minutes: 3 },
  growth: { script: "e2e:growth" },
  "copy-map": { script: "e2e:copy-map", minutes: 2 },
  "town-drag": { script: "e2e:town-drag", minutes: 4 },
  "town-shape": { script: "e2e:town-shape", minutes: 2 },
  school: { script: "e2e:school" },
  sites: { script: "e2e:sites", groups: true, minutes: 37 },
  "train-parts": { script: "e2e:train-parts" },
  "train-summary": { script: "e2e:train-summary", minutes: 8 },
  "not-loading": { script: "e2e:not-loading", minutes: 3 },
  "engine-names": { script: "e2e:engine-names", minutes: 2 },
  "new-game": { script: "e2e:new-game", minutes: 8 },
  civic: { script: "e2e:civic", minutes: 5 },
  "paint-picker": { script: "e2e:paint-picker", minutes: 4 },
  stickers: { script: "e2e:stickers" },
  stats: { script: "e2e:stats", minutes: 2 },
  workshop: { script: "e2e:workshop" },
  warehouse: { script: "e2e:warehouse", minutes: 6 },
  water: { script: "e2e:water", minutes: 8 },
  "focus-ring": { script: "e2e:focus-ring", minutes: 4 },
  "hopper-load": { script: "e2e:hopper-load", minutes: 1.5 },
  locked: { script: "e2e:locked", minutes: 6 },
  signals: { script: "e2e:signals", minutes: 7 },
  "learn-more": { script: "e2e:learn-more", minutes: 2 },
  life: { script: "e2e:life", minutes: 4 },
  "low-bridge": { script: "e2e:low-bridge", groups: true },
  "depot-tracks": { script: "e2e:depot-tracks", minutes: 6 },
  post: { script: "e2e:post", minutes: 5 },
  "gl-lost": { script: "e2e:gl-lost", minutes: 4 },
  "gl-lost-desktop": { script: "e2e:gl-lost-desktop", minutes: 2 },
  leftovers: { script: "e2e:leftovers", minutes: 12 },
  "sandbox-chains": { script: "e2e:sandbox-chains" },
  airport: { script: "e2e:airport", minutes: 8 },
  airship: { script: "e2e:airship", minutes: 8 },
  circus: { script: "e2e:circus", minutes: 6 },
  grand: { script: "e2e:grand", minutes: 6 },
  clockmaker: { script: "e2e:clockmaker", minutes: 4 },
  power: { script: "e2e:power", minutes: 6 },
  radio: { script: "e2e:radio", minutes: 6 },
  secrets: { script: "e2e:secrets", minutes: 6 },
  crane: { script: "e2e:crane", minutes: 4 },
  tunnels: { script: "e2e:tunnels", minutes: 6 },
  rack: { script: "e2e:rack", minutes: 3 },
  metro: { script: "e2e:metro", minutes: 3 },
  "feature-tips": { script: "e2e:feature-tips", minutes: 6 },
  "routes-ux": { script: "e2e:routes-ux", minutes: 6 },
  "tech-tree-5": { script: "e2e:tech-tree-5", minutes: 4 },
};

/** What an unmapped path gets: the suites that touch the most of the game. */
/** touch and click whole: the nightly run (`npm run e2e:affected -- --nightly`), and what a change to them selects. */
export const CORE = ["touch", "click"];

/**
 * Seconds a group takes, for the estimate (a suite's groups not here: its minutes shared out evenly). touch: a full run
 * on 4 cores with SwiftShader, 2026-11-05 (claude/qa-speed).
 */
const GROUP_SECONDS = {
  touch: { "sandbox-shelves": 39, "map-taps": 20, "select-drag": 165, redrawn: 7, flick: 12, "lever-pins": 49, "under-car": 10, "toast-through": 2, trap: 36, "dead-end": 13, routes: 125, defaults: 43, restore: 125, wait: 58, wye: 59, stuck: 109, "stuck-lines": 103, forward: 28, "hand-wait": 33, "leave-now": 17, via: 47, follow: 12, "route-keep": 35, "tight-curves": 105, blocker: 50, "train-card": 33, "place-facing": 27, "front-join": 24, "tabs-reach": 46, feedback: 19, "route-ux": 100, "route-ux-more": 72, "route-reorder": 95, "route-share": 61, "route-ring": 75, slips: 116, "double-three-way": 62, "turntable-taps": 87, "game-shelves": 51 },
};
const GROUP_COUNT = { touch: 39, click: 8 };

/** Rough minutes for what `want` selects (a suite whole: its minutes, else 5; groups: theirs). */
export function estimate(want) {
  let total = 0;
  for (const [suite, g] of want) {
    const whole = SUITES[suite].minutes ?? 5;
    if (g === "all") total += whole;
    else for (const name of g) total += (GROUP_SECONDS[suite]?.[name] ?? (whole * 60) / (GROUP_COUNT[suite] ?? 1)) / 60;
  }
  return total;
}
/**
 * What a path no rule matches gets, and what the paths that reach everywhere get (src/main.ts, the build, the harness's
 * lib, game.ts): a few quick groups across the game, about 6 minutes, not touch and click whole (an hour and a half). A
 * full touch and click run is a nightly job (docs/agents/e2e.md, "What to run"), not one for every landing.
 */
export const SMOKE = ["touch:sandbox-shelves,map-taps,toast-through,trap,train-card,game-shelves", "click:desktop"];

/** Paths that can't change what an e2e sees. */
export const IGNORE = ["docs/**", "**/*.md", "src/**/*.test.ts", "src/**/fixtures/**", "tools/blender/**", "tools/shots/**", "tools/perf/**", "tools/design/**", "bench/**", ".claude/**", "catalogue/**/*.blend", ".gitignore", "scripts/e2e/lib/diff-kind.mjs", "scripts/**/*.test.mjs"];

// Touch's groups that plan, run or show routes and lines.
const TOUCH_ROUTES = "touch:trap,dead-end,routes,defaults,restore,wait,wye,stuck,stuck-lines,forward,hand-wait,via,follow,route-keep,blocker,route-ux,route-ux-more,route-reorder,route-share,route-ring,slips,double-three-way,split";
// Touch's groups for the tech tree's track pieces (scripts/e2e/track-pieces.mjs).
const TOUCH_PIECES = "touch:slips,double-three-way,split,turntable-taps";
// Touch's groups that press, hold, drag and drop pieces and trains: what a change to input or picking can break.
const TOUCH_INPUT = "touch:sandbox-shelves,game-shelves,map-taps,select-drag,redrawn,flick,lever-pins,under-car,toast-through,trap,place-facing,front-join,tight-curves";
// Touch's groups that lay track, throw points and run trains over it: what a change to the track or the editor can break.
const TOUCH_TRACK = "touch:map-taps,select-drag,flick,lever-pins,under-car,wye,place-facing,front-join,tight-curves,follow,stuck,slips,double-three-way,split,turntable-taps";
// Touch's groups that run trains (the sim's levers, points held, trains stopped, cards): with TOUCH_ROUTES, what a
// change to the sim can break.
const TOUCH_TRAINS = "touch:select-drag,lever-pins,under-car,wye,train-card,blocker,stuck,stuck-lines";
// Touch's groups that are mostly the HUD: the tray's shelves and tabs, cards, toasts.
const TOUCH_UI = "touch:sandbox-shelves,game-shelves,tabs-reach,train-card,toast-through,trap,feedback";
// Click's groups for a mouse and the tray's drags: what input, track and editor changes can break.
const CLICK_INPUT = "click:desktop,touch-tray,tight-curves";
const TOWNS = ["town-drag", "town-shape", "school", "growth", "station-upgrade", "sites"];

/** [glob or globs, what it affects]. Order doesn't matter: every rule a path matches counts. */
export const RULES = [
  // The rack and the lookout halt: the pieces, the sim's rule, the engine, the stop, the card, the tray.
  [
    ["src/sim/sim.ts", "src/sim/cars.ts", "src/track/pieces.ts", "src/track/kits.ts", "src/game/engines.ts", "src/game/engine-status.ts", "src/game/passengers.ts", "src/game/world.ts", "src/game/things.ts", "src/game/blueprints.ts", "src/economy/economy.ts", "src/render/track-geometry.ts", "src/render/train-models.ts", "src/ui/tray-catalogue.ts", "src/ui/piece-info.ts", "src/landscape/hill-shape.ts"],
    ["rack"],
  ],
  // The metro: its stops under towns, its train, its riders and costs, the town growing over the line.
  [
    ["src/game/metro.ts", "src/game/passengers.ts", "src/game/world.ts", "src/game/things.ts", "src/game/progress.ts", "src/game/interaction.ts", "src/economy/economy.ts", "src/landscape/clearance.ts", "src/landscape/trees-aside.ts", "src/track/kits.ts", "src/render/props/library.ts", "src/render/train-models.ts", "src/ui/tray-catalogue.ts"],
    ["metro"],
  ],
  // Tech tree 5: the viaduct, the lift bridge, Lift and load, the sleeper and observation car, the observatory.
  [
    ["src/sim/sim.ts", "src/track/pieces.ts", "src/track/kits.ts", "src/track/constants.ts", "src/track/overlap.ts", "src/landscape/support.ts", "src/landscape/clearance.ts", "src/game/passengers.ts", "src/game/world.ts", "src/game/things.ts", "src/game/blueprints.ts", "src/game/upgrades.ts", "src/game/lift-bridges.ts", "src/game/engine-status.ts", "src/economy/economy.ts", "src/render/track-geometry.ts", "src/render/kit-motions.ts", "src/render/depot-view.ts", "src/render/train-models.ts", "src/catalogue/assets/observatory.ts", "src/catalogue/assets/observation-car.ts", "src/catalogue/assets/mechanisms.ts", "src/ui/tray-catalogue.ts"],
    ["tech-tree-5"],
  ],
  // The suites themselves, and what they share.
  ["scripts/e2e/lib/**", SMOKE],
  ["scripts/e2e/feedback-flow.mjs", ["touch:feedback", "click:feedback"]],
  ["scripts/e2e/pin-clocks.mjs", [...SMOKE, "station-clock", "signals", "life", "gl-lost"]],
  ["scripts/e2e/affected.mjs", []],
  // CI's planner and runner (.github/workflows/e2e.yml): no suite of its own; the workflow's own run is its test.
  [["scripts/e2e/ci.mjs", "scripts/e2e/durations.json", ".github/**"], []],
  ["scripts/e2e/phone-audit.mjs", []],
  ["scripts/e2e/track-pieces.mjs", [TOUCH_PIECES]],
  ["tools/e2e/**", []], // (each file maps to its own suite: see suiteOfScript)

  // Build and page.
  [["package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "index.html", "public/**"], [...SMOKE, "tray"]],
  ["src/main.ts", SMOKE],
  ["src/style.css", [...SMOKE, TOUCH_UI, "names", "locked", "focus-ring"]],
  ["cloud/**", ["cloud", "stats", "touch:feedback", "click:feedback"]],
  // Crash reports: sent on a lost drawing and on errors, and the ☰ switch (e2e:gl-lost).
  [["src/feedback/crash.ts", "cloud/src/crash.ts"], ["gl-lost"]],

  // Simulation and routing.
  ["src/sim/**", [TOUCH_TRAINS, TOUCH_ROUTES, "click:model-train,routes", "signals", "train-summary", "train-parts", "lift", "loop", "kits", "decks"]],
  ["src/sim/engine-names.ts", ["engine-names"]],
  // Town places, treats and the paint shop (spec 2026-11-04-civic-leisure-design.md).
  [["src/game/places.ts", "src/game/place-row.ts", "src/game/paint-shop.ts", "src/ui/places-row.ts", "src/ui/paint-sheet.ts", "src/game/town-life.ts", "src/game/towns.ts", "src/render/train-models.ts", "src/render/train-view.ts"], ["civic", "paint-picker"]],
  ["src/routing/**", [TOUCH_ROUTES, "click:routes", "signals", "warehouse", "depot-tracks"]],
  ["src/track/**", [TOUCH_TRACK, CLICK_INPUT, "draw", "joints", "ramps", "kits", "decks", "lift", "loop", "low-bridge"]],
  ["src/track/underpass.ts", ["low-bridge"]],
  // Turntable controls: a tap on a road turns a deck to it.
  ["src/game/deck-roads.ts", ["touch:turntable-taps", "decks"]],
  ["src/editor/**", [TOUCH_TRACK, CLICK_INPUT, "draw", "joints", "ramps", "landscaping"]],
  ["src/landscape/**", ["click:desktop", "draw", "roads", "landscaping", "sites", "touch:select-drag,trap"]],
  [["src/landscape/clearance.ts", "src/landscape/support.ts"], ["low-bridge"]],
  ["src/roads/**", ["roads"]],
  ["src/roads/place.ts", ["low-bridge"]],
  ["src/economy/**", ["crane", "depot-tracks", "sandbox-chains", TOUCH_ROUTES, "click:routes", "warehouse", "train-summary", "not-loading", "workshop", "big-stations", "station-touches", "kits-game", "research", "school", "growth"]],
  ["src/props/**", [...TOWNS, "click:model-train"]],
  ["src/persist/**", ["cloud", "copy-map", "joints", "engine-names", "touch:defaults"]],
  ["src/persist/bug-map.ts", ["copy-map", "touch:feedback", "click:feedback"]],
  ["src/feedback/**", ["touch:feedback", "click:feedback"]],
  ["src/stats/**", ["stats"]],
  ["src/catalogue/**", ["tray", "names", "kits", "kits-game", "decks", "click:model-train", "hopper-load"]],
  ["src/audio/**", ["life", "station-touches"]],
  ["src/lib/**", SMOKE],
  ["src/debug/**", ["copy-map"]],
  ["src/icons/**", [...SMOKE, "locked"]],
  // The compiled icon font (scripts/icon-font.py, from src/icons): as the drawings.
  ["src/assets/woodrail-icons.woff2", [...SMOKE, "locked"]],
  // Bug maps replayed headless (src/play/bugmaps.test.ts): no page.
  ["src/play/bugmaps/**", []],

  // Rendering.
  // (What's drawn, and what a tap picks: the smoke set, and the groups that pick pieces and trains off the map.)
  ["src/render/**", [...SMOKE, "touch:select-drag,tight-curves", "life"]],
  // The drawing lost and back, the card to reload, and lean settings after (and what the post-processing makes).
  [["src/render/post.ts", "src/render/quality.ts", "src/render/stage.ts", "src/ui/context-lost.ts", "src/game/game.ts"], ["gl-lost", "gl-lost-desktop"]],
  // Drawn-only geometry freed on phones, kept on desktops (in-place restore): both of gl-lost's paths.
  [["src/render/gpu-only.ts", "tools/e2e/gl-lost.mjs", "tools/e2e/gl-lost-desktop.mjs"], ["gl-lost", "gl-lost-desktop"]],
  ["src/render/clock-*", ["station-clock"]],
  ["src/render/hopper-load.ts", ["hopper-load"]],
  ["src/render/station-touches.ts", ["station-touches"]],
  [["src/render/kit-*", "src/render/loop-show.ts"], ["kits", "loop", "lift", "decks"]],
  ["src/render/signal-marks-view.ts", ["signals"]],
  ["src/render/telegraph-wires.ts", ["kits-game", "research"]],
  ["src/render/route-view.ts", [TOUCH_ROUTES, "click:routes"]],
  [["src/render/depot-view.ts", "src/render/industry-*", "src/render/touches-view.ts", "src/render/flourishes.ts"], ["life", "kits-game", "station-upgrade"]],
  ["src/render/depot-view.ts", ["depot-tracks"]],
  ["src/game/depot-tracks.ts", ["depot-tracks"]],
  [["src/render/road-vehicles-view.ts", "src/render/crossings-view.ts"], ["roads"]],
  ["src/render/ambient.ts", ["life", "roads"]],
  ["src/render/turbines-view.ts", ["life"]],
  [["src/render/ruins-view.ts", "src/render/goal-marks.ts", "src/render/halt-reach-view.ts"], ["sites", "big-stations"]],
  ["src/render/thumbnails.ts", ["tray", "names"]],
  ["src/render/train-models.ts", ["train-parts", "train-summary", "hopper-load"]],
  [["src/render/track-geometry.ts", "src/render/piece-carve.ts"], ["low-bridge", "ramps", "tunnels"]],
  // The main thread's carver, loaded on its own (join pieces carved when first wanted): the tray's pictures, joints.
  ["src/render/carver.ts", ["tray", "joints"]],
  ["src/render/chain-hints-view.ts", ["sandbox-chains"]],
  // Static geometry welded, quantised, and drawn far in fewer triangles: towns, yards, ruins, props, kits, clocks.
  [["src/render/compact.ts", "src/render/far-*.ts", "src/render/dressing/batcher.ts"], ["kits", "station-clock", "sites", "growth", "locked"]],
  ["src/render/dressing/blocks.ts", ["low-bridge", "landscaping"]],

  // UI.
  ["src/ui/**", [...SMOKE, TOUCH_UI, "click:touch-tray"]],
  [["src/ui/hud.ts", "src/ui/tray-catalogue.ts"], ["names", "locked", "focus-ring", "research", "tray", "sandbox-chains", "touch:tabs-reach"]],
  ["src/ui/prefs.ts", ["sandbox-chains"]],
  [["src/ui/explainers.ts", "src/ui/explainer-sheet.ts", "src/ui/hud.ts", "src/style.css"], ["learn-more"]],
  [["src/ui/blueprint-board.ts", "src/ui/cost-tag.ts", "src/ui/wiki-link.ts"], ["research", "locked"]],
  ["src/ui/feedback-sheet.ts", ["touch:feedback", "click:feedback"]],
  [["src/ui/controls-tutorial.ts", "src/ui/title.ts"], ["tutorial"]],
  ["src/ui/focus-ring.ts", ["focus-ring"]],
  ["src/ui/stats-card.ts", ["stats"]],
  ["src/ui/growth-sheet.ts", ["growth", "school"]],
  ["src/ui/workshop-panel.ts", ["workshop"]],
  [["src/ui/cloud-card.ts", "src/ui/title.ts"], ["cloud"]],
  ["src/ui/map-view.ts", ["sites"]],
  ["src/ui/lines-view.ts", ["touch:route-ux-more,route-share,route-ring", "routes-ux"]],
  // The routes UX (option B, 2026-11-06): the line sheet, its words, health, the rings round places to tap.
  [["src/ui/line-sheet.ts", "src/game/line-sheet-text.ts", "src/game/line-health.ts", "src/render/place-rings.ts", "src/economy/line-tally.ts"], ["routes-ux", TOUCH_ROUTES]],
  [["src/game/lines.ts", "src/game/interaction.ts", "src/main.ts", "src/persist/save.ts", "src/render/depot-view.ts"], ["routes-ux"]],
  ["src/ui/route-drag.ts", ["touch:route-reorder"]],
  ["src/ui/goals-panel.ts", ["stickers", "research", "feature-tips"]],
  [["src/ui/fullscreen.ts", "src/ui/swipe-guard.ts"], ["click:fullscreen"]],
  ["src/ui/store-rows.ts", ["warehouse"]],
  ["src/ui/town-ledger.ts", [...TOWNS]],
  // The town name board (its good and count): drawn as towns grow, beside their cards.
  ["src/render/town-sign.ts", ["growth", "civic", "locked"]],
  ["src/ui/piece-info.ts", ["names", "feature-tips"]],

  // Game rules (src/game: by file; anything else there falls to SMOKE).
  [["src/game/game.ts", "src/game/interaction.ts", "src/game/world.ts", "src/game/modes.ts"], [...SMOKE, "locked", "life"]],
  // (interaction.ts: every press, hold, drag and drop; its wagon drop onto a train's ends is front-join. The route
  // groups' taps go through it too, and run when routing changes, and nightly.)
  ["src/game/interaction.ts", [TOUCH_INPUT, CLICK_INPUT]],
  [["src/game/touch-*", "src/game/drag-rule.ts", "src/game/drop.ts", "src/game/put-away.ts", "src/game/place-facing.ts"], [TOUCH_INPUT, CLICK_INPUT, "names"]],
  [["src/game/camera-director.ts"], [...SMOKE, "touch:select-drag,tight-curves,routes", "tutorial"]],
  [["src/game/draw-*", "src/game/erase.ts", "src/game/track-rules.ts", "src/game/lift-notice.ts"], ["draw", "joints", "ramps", "touch:select-drag,flick", "low-bridge"]],
  ["src/game/underpass-dig.ts", ["low-bridge"]],
  ["src/game/chains.ts", ["sandbox-chains"]],
  [["src/game/route-*", "src/game/lines.ts", "src/game/continue-on.ts", "src/game/switch-pin.ts"], [TOUCH_ROUTES, "click:routes", "signals"]],
  [["src/game/engine-status.ts", "src/game/engines.ts", "src/game/train-summary.ts", "src/game/decouple-words.ts", "src/game/empty-words.ts"], ["touch:train-card,blocker", "train-summary", "not-loading", "train-parts", "engine-names"]],
  ["src/game/signal-place.ts", ["signals"]],
  // The breakdown crane (claude/tank-crane): its system, words and model.
  [["src/economy/breakdown.ts", "src/game/crane-text.ts", "src/catalogue/assets/breakdown-crane.ts", "src/game/engine-status.ts"], ["crane"]],
  // Where a train in the way is "by" on its card (QA 2026-11-05 #2).
  ["src/game/place-near.ts", ["touch:train-card,blocker", "crane"]],
  // Tunnels (2026-11-04): the dig and Draw's words when it can't go under.
  ["src/game/tunnel-dig.ts", ["tunnels"]],
  // The game's icon font (src/icons, scripts/icon-font.py): drawn in every bar and card.
  ["src/assets/woodrail-icons.woff2", ["names", "locked", "research"]],
  // Hand-made bug maps (src/play/bugmaps): unit tests only.
  ["src/play/bugmaps/**", []],
  [["src/game/research*", "src/game/blueprints.ts", "src/game/tech.ts", "src/game/learn-text.ts"], ["research", "locked", "kits-game", "landscaping"]],
  [["src/game/goals.ts", "src/game/goal-ticks.ts", "src/game/rewards.ts", "src/game/progress.ts"], ["stickers", "stats", "research", "school", "sites"]],
  ["src/game/stickers.ts", ["stickers"]],
  // Feature tips: the 💡 row under the goals, its Show me, and the Learned toast that says it.
  ["src/game/feature-tips.ts", ["feature-tips"]],
  ["src/game/landscaping.ts", ["landscaping"]],
  ["src/game/station-upgrade.ts", ["station-upgrade", "station-touches"]],
  ["src/game/departures.ts", ["station-touches"]],
  [["src/game/town-*", "src/game/towns.ts", "src/game/street-moves.ts", "src/game/growth-cards.ts", "src/game/upgrades.ts"], [...TOWNS]],
  [["src/game/crafting.ts", "src/game/workshop-text.ts"], ["workshop", "growth"]],
  [["src/game/warehouse-text.ts", "src/game/cargo-drop.ts", "src/game/supply.ts"], ["warehouse", "train-summary"]],
  [["src/game/map-sites.ts", "src/game/restore.ts", "src/game/across-river.ts", "src/game/map-markers.ts", "src/game/landmarks.ts", "src/game/harbours.ts"], ["sites"]],
  [["src/game/road-*", "src/game/town-cars.ts", "src/game/buses.ts", "src/game/delivery-vans.ts", "src/game/vans.ts"], ["roads", "post"]],
  // The post: towns' mail, the post office, mail vans, post vans on the streets.
  [["src/game/post.ts", "src/catalogue/assets/mail-van.ts", "src/game/town-ledger.ts", "src/ui/town-ledger.ts"], ["post", "leftovers"]],
  // The leftovers: the sorting van, Sandbox's post, the Telegraph's trains and Call home, Lined and Rainbow, bunting.
  [["src/game/telegraph.ts", "src/game/lineside.ts", "src/game/paint-shop.ts", "src/ui/paint-sheet.ts", "src/game/landmarks.ts", "src/render/train-models.ts"], ["leftovers"]],
  [["src/game/industries.ts", "src/game/lineside.ts", "src/game/fields.ts", "src/game/depot-footprint.ts", "src/game/things.ts", "src/game/food-text.ts"], ["kits-game", "warehouse", "workshop", "hopper-load", "life", "sandbox-chains"]],
  [["src/game/passengers.ts"], ["big-stations", "station-touches", "station-upgrade"]],
  [["src/game/touches.ts", "src/game/calendar.ts"], ["life", "station-clock"]],
  [["src/game/journal.ts"], ["focus-ring", "stickers"]],
  ["src/game/piece-name.ts", ["names"]],
  ["src/game/dev-checks.ts", []],
  // The airship tour (late-game spec B1).
  [["src/game/airship.ts", "src/game/passengers.ts", "src/render/airship-view.ts", "src/economy/economy.ts", "src/render/depot-view.ts", "src/main.ts"], ["airship"]],
  // The airport (late-game spec A1).
  [["src/game/airports.ts", "src/game/passengers.ts", "src/render/planes-view.ts", "src/economy/economy.ts", "src/render/depot-view.ts", "src/main.ts"], ["airport"]],
  // Grand projects as achievements (spec 2026-11-05-character-and-goals.md): the projects, the city's card, the
  // Journal's Achievements tab, the stage models, rewards toward growth, and the site's prop.
  [["src/game/grand.ts", "src/ui/grand-row.ts", "src/ui/goals-panel.ts", "src/catalogue/assets/grand.ts", "src/catalogue/build-parts.ts", "src/game/town-life.ts", "src/game/towns.ts", "src/game/stickers.ts", "src/game/interaction.ts", "src/persist/save.ts", "src/persist/save-schema.ts", "src/economy/economy.ts", "src/main.ts"], ["grand"]],
  // The touring circus (late-game spec K1).
  [["src/game/circus.ts", "src/game/passengers.ts", "src/game/rewards.ts", "src/game/progress.ts", "src/catalogue/assets/circus-cage.ts", "src/main.ts"], ["circus"]],
  // Time control (late-game spec, Clockmaker CA).
  [["src/game/time-scale.ts", "src/game/game.ts", "src/ui/hud.ts", "src/main.ts"], ["clockmaker"]],
  // Secrets on the map: placed with the land, found by laying track to them, their halts, cards, trips and stickers.
  [["src/landscape/secrets.ts", "src/catalogue/secret-frame.ts", "src/catalogue/assets/secrets.ts", "src/catalogue/build-parts.ts", "src/game/secrets.ts", "src/ui/secret-card.ts", "src/ui/secret-controls.ts", "src/render/secrets-view.ts", "src/game/passengers.ts", "src/game/world.ts", "src/game/stickers.ts", "src/landscape/clearance.ts", "src/track/kits.ts", "src/persist/landscape-data.ts", "src/main.ts", "src/game/interaction.ts"], ["secrets"]],
  // The radio mast (the user's pick: a powered mast brings a town more riders).
  [["src/game/radio.ts", "src/game/power.ts", "src/game/passengers.ts", "src/main.ts", "src/game/interaction.ts"], ["radio"]],
  // Water transport: the landing, boats, cargo ships, the lighthouse, the ferry, the yards.
  [["src/game/boats.ts", "src/game/ferry.ts", "src/game/harbours.ts", "src/ui/boat-card.ts", "src/ui/water-controls.ts", "src/render/river-boats-view.ts", "src/render/ferries-view.ts", "src/render/boats-view.ts", "src/economy/boats.ts", "src/catalogue/assets/water.ts", "src/catalogue/assets/boat-parts.ts", "src/game/yards.ts", "src/render/yards-view.ts"], ["water"]],
  // Power as sparks and the wind farm (late-game spec W1).
  [["src/game/power.ts", "src/game/engines.ts", "src/game/industries.ts", "src/render/turbines-view.ts", "src/props/kinds.ts", "src/props/placement.ts", "src/render/props/library.ts", "src/ui/hud.ts", "src/main.ts", "src/catalogue/assets/mechanisms.ts"], ["power"]],
  // The new-game sheet and how hilly a map is (chosen before a new game, saved with the map).
  [["src/ui/new-game.ts", "src/landscape/hills.ts", "src/landscape/water.ts", "src/landscape/edges.ts", "src/landscape/generate.ts", "src/ui/title.ts", "src/ui/hud.ts", "src/persist/landscape-data.ts", "src/persist/landscape-schema.ts"], ["new-game", "tutorial"]],
  // The tests' setup (what the game loads on its own, loaded before each test file).
  ["src/test-setup.ts", []],
];

// A tiny glob: ** any depth, * within a path segment.
const globRe = (g) => new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*") + "$");
const matches = (globs, path) => (Array.isArray(globs) ? globs : [globs]).some((g) => globRe(g).test(path));

/** An e2e script's own suite: the suite whose npm script runs it. */
function suiteOfScript(path) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  for (const [name, s] of Object.entries(SUITES)) if ((pkg.scripts[s.script] ?? "").includes(path)) return name;
  return null;
}

/**
 * touch.mjs's own changes, narrowed to groups: the groups whose functions every changed line of it falls in (each
 * entry of its SANDBOX table, `"name": (f) => fn(…)`, names the function a group runs). A line anywhere else (a shared
 * helper, the boot, `openMode`, `step`, the table) is null: the whole suite. `hunks`: the new file's changed lines.
 */
export function touchGroupsOf(source, hunks) {
  const lines = source.split("\n");
  const groupsOf = new Map();
  for (const m of source.matchAll(/^\s+"?([a-z0-9-]+)"?: \(f\) => (\w+)\(/gm)) groupsOf.set(m[2], [...(groupsOf.get(m[2]) ?? []), m[1]]);
  const out = new Set();
  for (const line of hunks) {
    // The top-level function the line is in (from the line up to the last `function` at the start of a line, while
    // no top-level `}` closes it first).
    let fn = null;
    for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
      const m = /^(?:async )?function (\w+)/.exec(lines[i]);
      if (m) { fn = m[1]; break; }
      if (i < line - 1 && /^}/.test(lines[i])) break;
    }
    const gs = fn && groupsOf.get(fn);
    if (!gs) return null;
    gs.forEach((g) => out.add(g));
  }
  return out;
}

/** The new file's changed line numbers of `path` against `base` (git diff -U0). */
function changedLines(base, path) {
  const diff = execFileSync("git", ["diff", "-U0", base, "--", path], { cwd: ROOT, encoding: "utf8" });
  const out = [];
  for (const m of diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const [start, n] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2])];
    // (A pure deletion, n 0: the line it was taken from.)
    for (let k = 0; k < Math.max(1, n); k++) out.push(start + k);
  }
  return out;
}

/**
 * What a words-only or paint-only change gets on top of the suites that refer to what changed: two quick touch groups
 * (about a minute and a half) that open Game mode's HUD and a train's card, to see the page still loads and draws.
 */
export const COPY_SMOKE = ["touch:game-shelves,train-card"];

/** A suite's e2e script and the local scripts it imports (not lib/), as [path, source]. */
function suiteSources(suite, read) {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const file = (pkg.scripts[SUITES[suite].script] ?? "").match(/(\S+\.mjs)\s*$/)?.[1];
  const out = [];
  const seen = new Set();
  const visit = (path) => {
    if (!path || seen.has(path) || /\/lib\//.test(path)) return;
    seen.add(path);
    const src = read(path);
    if (src == null) return;
    out.push([path, src]);
    for (const m of src.matchAll(/^import [^;]*? from "(\.\.?\/[^"]+\.mjs)"/gm)) visit(normalize(join(dirname(path), m[1])));
  };
  visit(file);
  return out;
}

/** The files' line numbers (1-based) whose text holds one of `needles`. */
const linesWith = (source, test) => source.split("\n").flatMap((l, k) => (test(l) ? [k + 1] : []));

/** The default readers: the merge base's copy of a path (null if it wasn't there), and the working tree's. */
export function gitReaders(base) {
  return {
    before: (path) => { try { return execFileSync("git", ["show", `${base}:${path}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 }); } catch { return null; } },
    after: (path) => (existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : null),
  };
}

/**
 * Paths → { want: Map<suite, Set<group> | "all">, unmapped: [], light: [{ path, kind, … }] }. `base`: the merge base,
 * to narrow touch.mjs's own changes and to read what each file was. `readers` ({ before, after }, path → text or null):
 * how to read a file before and after the change (default: the merge base and the working tree; tests pass commits).
 *
 * A file whose change is only comments maps to nothing; only words ("copy", see lib/diff-kind.mjs) or only paint
 * (CSS colours, shadows) maps to the suites that refer to those words or classes, and COPY_SMOKE, instead of its
 * rules. An e2e script's own words-only change still runs its own suite (its words are what it asserts). Anything
 * else is code, and gets the rules as before.
 */
export function affected(paths, base = null, readers = base ? gitReaders(base) : null) {
  const want = new Map();
  const add = (target) => {
    const [suite, groupList] = target.split(":");
    if (!SUITES[suite]) throw new Error(`affected.mjs: rule names no suite ${suite}`);
    if (!groupList) return want.set(suite, "all");
    if (want.get(suite) === "all") return;
    const set = want.get(suite) ?? new Set();
    for (const g of groupList.split(",")) set.add(g);
    want.set(suite, set);
  };
  const unmapped = [];
  const light = [];
  let sources = null;
  const allSources = () => (sources ??= Object.keys(SUITES).map((s) => [s, suiteSources(s, readers.after)]));
  for (const path of paths) {
    if (matches(IGNORE, path)) continue;
    const own = /^(scripts|tools)\/e2e\/[^/]+\.mjs$/.test(path) && suiteOfScript(path);
    const change = readers ? classify(path, readers.before(path), readers.after(path)) : { kind: "code" };
    if (change.kind === "same" || change.kind === "comment") { light.push({ path, kind: change.kind === "same" ? "comment" : change.kind }); continue; }
    if (change.kind === "copy" || change.kind === "paint") {
      const hits = [];
      for (const [suite, files] of allSources()) {
        for (const [file, src] of files) {
          const hit = change.kind === "copy" ? refersToWords(src, change.strings) : refersToClasses(src, change.classes);
          if (!hit) continue;
          // touch.mjs: the groups whose functions hold the matching lines (else the whole suite).
          const narrowed = suite === "touch" && file === "scripts/e2e/touch.mjs" && change.kind === "copy"
            ? touchGroupsOf(src, linesWith(src, (l) => refersToWords(l, change.strings)))
            : null;
          const target = narrowed?.size ? `touch:${[...narrowed].join(",")}` : suite;
          add(target);
          hits.push(target);
          break;
        }
      }
      if (own && !hits.some((h) => h.split(":")[0] === own)) (add(own), hits.push(own));
      COPY_SMOKE.forEach(add);
      light.push({ path, kind: change.kind, ...(change.strings ? { strings: change.strings } : { classes: change.classes }), suites: hits });
      continue;
    }
    let hit = false;
    const narrowed = own === "touch" && base ? touchGroupsOf(readFileSync(join(ROOT, path), "utf8"), changedLines(base, path)) : null;
    if (narrowed) (add(`touch:${[...narrowed].join(",")}`), (hit = true));
    else if (own) (add(own), (hit = true));
    for (const [globs, targets] of RULES) if (matches(globs, path)) (targets.forEach(add), (hit = true));
    if (!hit) (unmapped.push(path), SMOKE.forEach(add));
  }
  return { want, unmapped, light };
}

function mergeBase(base) {
  return execFileSync("git", ["merge-base", base, "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
}

function changedPaths(base) {
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const mb = mergeBase(base);
  return [...new Set([...git("diff", "--name-only", mb), ...git("ls-files", "-o", "--exclude-standard")])].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes("--check")) {
    // Every rule's suite exists and every group it names is one the suite lists (its `-- --list`).
    const bad = [];
    const lists = {};
    for (const [, targets] of RULES)
      for (const t of targets) {
        const [suite, gl] = t.split(":");
        if (!SUITES[suite]) { bad.push(`no suite ${suite}`); continue; }
        if (!gl) continue;
        if (!SUITES[suite].groups) { bad.push(`${suite} has no groups (${t})`); continue; }
        const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
        const file = pkg.scripts[SUITES[suite].script].match(/(\S+\.mjs)\s*$/)[1];
        lists[suite] ??= execFileSync("node", [file, "--list"], { cwd: ROOT, encoding: "utf8" }).split("\n").map((l) => l.split("\t")[0]);
        for (const g of gl.split(",")) if (!lists[suite].includes(g)) bad.push(`${suite} has no group ${g}`);
      }
    console.log(bad.length ? [...new Set(bad)].join("\n") : "affected.mjs: every rule names a real suite and group");
    process.exit(bad.length ? 1 : 0);
  }
  const base = args.find((a) => !a.startsWith("--")) ?? "origin/main";
  // (--nightly: touch and click whole, whatever changed: the periodic run that covers what the per-landing selection,
  // narrowed to groups and a smoke set, leaves out.)
  const nightly = args.includes("--nightly");
  const paths = nightly ? [] : changedPaths(base);
  const { want, unmapped, light } = nightly ? { want: new Map(CORE.map((s) => [s, "all"])), unmapped: [], light: [] } : affected(paths, mergeBase(base));
  const order = Object.keys(SUITES).filter((s) => want.has(s));
  const cmd = (s) => {
    const g = want.get(s);
    const only = g === "all" ? "" : SUITES[s].groups ? `E2E_ONLY=${[...g].join(",")} ` : "";
    return `${only}npm run ${SUITES[s].script}`;
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify({ base, paths, unmapped, light, suites: Object.fromEntries(order.map((s) => [s, want.get(s) === "all" ? "all" : [...want.get(s)]])) }, null, 1));
    process.exit(0);
  }
  console.log(`${paths.length} paths changed against ${base}.`);
  for (const l of light) {
    const what = l.kind === "comment" ? "comments only: no suite" : l.kind === "copy" ? `words only (${l.strings.length} strings): ${l.suites.join(", ") || "no suite refers to them"} + smoke` : `paint only (.${l.classes.join(" .")}): ${l.suites.join(", ") || "no suite refers to them"} + smoke`;
    console.log(`  ${l.path}: ${what}`);
  }
  if (unmapped.length) console.log(`Unmapped (given the smoke set; add a rule in scripts/e2e/affected.mjs): ${unmapped.join(" ")}`);
  if (!order.length) console.log("No e2e suite affected.");
  const mins = estimate(want);
  if (order.length) console.log(`Suites (${order.length}, roughly ${Math.round(mins)} min, one after another):`);
  for (const s of order) console.log(`  ${cmd(s)}`);
  if (args.includes("--run")) {
    let bad = 0;
    for (const s of order) {
      const g = want.get(s);
      const env = { ...process.env };
      if (g !== "all" && SUITES[s].groups) env.E2E_ONLY = [...g].join(",");
      console.log(`\n=== ${cmd(s)}`);
      const r = spawnSync("npm", ["run", SUITES[s].script], { cwd: ROOT, env, stdio: "inherit" });
      if (r.status !== 0) bad++;
    }
    console.log(`\n${order.length - bad}/${order.length} suites passed`);
    process.exit(bad ? 1 : 0);
  }
}
