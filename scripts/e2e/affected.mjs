// Which end-to-end suites (and groups) a change may affect: `npm run e2e:affected [-- <base-ref>] [--run] [--json]`.
// Diffs the working tree (committed, staged, unstaged and new files) against the merge base with <base-ref> (default
// origin/main), maps each changed path through RULES below, and prints the suites to run, as commands. --run runs them
// one after another (with E2E_ONLY for a suite narrowed to groups), and stops at none: it prints each one's last line.
//
// To extend: add a rule to RULES (a glob or a list of them, and what it affects: "suite" or "suite:group,group"), or a
// suite to SUITES. A path no rule matches gets CORE (and is listed as unmapped, so the map can be filled in), unless
// IGNORE matches it. Rules are additive: a path matching several gets all of them. A whole suite wins over its groups.
// See docs/agents/e2e.md.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/groups.mjs";

/** Each suite: its npm script, and whether it has groups (E2E_ONLY, --list, resume through scripts/e2e/lib/groups.mjs). */
export const SUITES = {
  touch: { script: "e2e:touch", groups: true, minutes: 50 },
  click: { script: "e2e:click", groups: true, minutes: 40 },
  draw: { script: "e2e:draw", groups: true, minutes: 90 },
  roads: { script: "e2e:roads", groups: true },
  names: { script: "e2e:names", minutes: 12 },
  cloud: { script: "e2e:cloud" },
  tutorial: { script: "e2e:tutorial" },
  joints: { script: "e2e:joints" },
  ramps: { script: "e2e:ramps" },
  tray: { script: "e2e:tray" },
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
  "engine-names": { script: "e2e:engine-names", minutes: 2 },
  stickers: { script: "e2e:stickers" },
  stats: { script: "e2e:stats", minutes: 2 },
  workshop: { script: "e2e:workshop" },
  warehouse: { script: "e2e:warehouse", minutes: 6 },
  "focus-ring": { script: "e2e:focus-ring", minutes: 4 },
  "hopper-load": { script: "e2e:hopper-load", minutes: 1.5 },
  locked: { script: "e2e:locked", minutes: 6 },
  signals: { script: "e2e:signals", minutes: 7 },
  life: { script: "e2e:life", minutes: 4 },
  "low-bridge": { script: "e2e:low-bridge" },
  "sandbox-chains": { script: "e2e:sandbox-chains" },
  rack: { script: "e2e:rack", minutes: 3 },
  metro: { script: "e2e:metro", minutes: 3 },
};

/** What an unmapped path gets: the suites that touch the most of the game. */
export const CORE = ["touch", "click"];

/** Paths that can't change what an e2e sees. */
export const IGNORE = ["docs/**", "**/*.md", "src/**/*.test.ts", "src/**/fixtures/**", "tools/blender/**", "tools/shots/**", "tools/perf/**", "tools/design/**", "bench/**", ".claude/**", "catalogue/**/*.blend", ".gitignore"];

// Touch's groups that plan, run or show routes and lines.
const TOUCH_ROUTES = "touch:trap,dead-end,routes,defaults,restore,wait,wye,stuck,stuck-lines,forward,hand-wait,via,follow,route-keep,blocker,route-ux,route-ux-more,route-reorder,route-share";
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
  // The suites themselves, and what they share.
  ["scripts/e2e/lib/**", CORE],
  ["scripts/e2e/feedback-flow.mjs", ["touch:feedback", "click:feedback"]],
  ["scripts/e2e/pin-clocks.mjs", ["touch", "click", "station-clock", "signals", "life"]],
  ["scripts/e2e/affected.mjs", []],
  ["scripts/e2e/phone-audit.mjs", []],
  ["tools/e2e/**", []], // (each file maps to its own suite: see suiteOfScript)

  // Build and page.
  [["package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "index.html", "public/**"], [...CORE, "tray"]],
  ["src/main.ts", CORE],
  ["src/style.css", [...CORE, "names", "locked", "focus-ring"]],
  ["cloud/**", ["cloud", "stats", "touch:feedback", "click:feedback"]],

  // Simulation and routing.
  ["src/sim/**", ["touch", "click:model-train,routes", "signals", "train-summary", "train-parts", "lift", "loop", "kits", "decks"]],
  ["src/sim/engine-names.ts", ["engine-names"]],
  ["src/routing/**", [TOUCH_ROUTES, "click:routes", "signals", "warehouse"]],
  ["src/track/**", ["touch", "click", "draw", "joints", "ramps", "kits", "decks", "lift", "loop", "low-bridge"]],
  ["src/track/underpass.ts", ["low-bridge"]],
  ["src/editor/**", ["touch", "click", "draw", "joints", "ramps", "landscaping"]],
  ["src/landscape/**", ["click", "draw", "roads", "landscaping", "sites", "touch:select-drag,trap"]],
  [["src/landscape/clearance.ts", "src/landscape/support.ts"], ["low-bridge"]],
  ["src/roads/**", ["roads"]],
  ["src/roads/place.ts", ["low-bridge"]],
  ["src/economy/**", ["sandbox-chains", TOUCH_ROUTES, "click:routes", "warehouse", "train-summary", "workshop", "big-stations", "station-touches", "kits-game", "research", "school", "growth"]],
  ["src/props/**", [...TOWNS, "click:model-train"]],
  ["src/persist/**", ["cloud", "copy-map", "joints", "engine-names", "touch:defaults"]],
  ["src/persist/bug-map.ts", ["copy-map", "touch:feedback", "click:feedback"]],
  ["src/feedback/**", ["touch:feedback", "click:feedback"]],
  ["src/stats/**", ["stats"]],
  ["src/catalogue/**", ["tray", "names", "kits", "kits-game", "decks", "click:model-train", "hopper-load"]],
  ["src/audio/**", ["life", "station-touches"]],
  ["src/lib/**", CORE],
  ["src/debug/**", ["copy-map"]],
  ["src/icons/**", [...CORE, "locked"]],

  // Rendering.
  ["src/render/**", ["touch", "click", "life"]],
  ["src/render/clock-*", ["station-clock"]],
  ["src/render/hopper-load.ts", ["hopper-load"]],
  ["src/render/station-touches.ts", ["station-touches"]],
  [["src/render/kit-*", "src/render/loop-show.ts"], ["kits", "loop", "lift", "decks"]],
  ["src/render/signal-marks-view.ts", ["signals"]],
  ["src/render/route-view.ts", [TOUCH_ROUTES, "click:routes"]],
  [["src/render/depot-view.ts", "src/render/industry-*", "src/render/touches-view.ts", "src/render/flourishes.ts"], ["life", "kits-game", "station-upgrade"]],
  [["src/render/road-vehicles-view.ts", "src/render/crossings-view.ts"], ["roads"]],
  ["src/render/ambient.ts", ["life", "roads"]],
  [["src/render/ruins-view.ts", "src/render/goal-marks.ts", "src/render/halt-reach-view.ts"], ["sites", "big-stations"]],
  ["src/render/thumbnails.ts", ["tray", "names"]],
  ["src/render/train-models.ts", ["train-parts", "train-summary", "hopper-load"]],
  ["src/render/track-geometry.ts", ["low-bridge", "ramps"]],
  ["src/render/chain-hints-view.ts", ["sandbox-chains"]],

  // UI.
  ["src/ui/**", ["touch", "click"]],
  [["src/ui/hud.ts", "src/ui/tray-catalogue.ts"], ["names", "locked", "focus-ring", "research", "tray", "sandbox-chains", "touch:tabs-reach"]],
  ["src/ui/prefs.ts", ["sandbox-chains"]],
  [["src/ui/blueprint-board.ts", "src/ui/cost-tag.ts"], ["research", "locked"]],
  ["src/ui/feedback-sheet.ts", ["touch:feedback", "click:feedback"]],
  [["src/ui/controls-tutorial.ts", "src/ui/title.ts"], ["tutorial"]],
  ["src/ui/focus-ring.ts", ["focus-ring"]],
  ["src/ui/stats-card.ts", ["stats"]],
  ["src/ui/growth-sheet.ts", ["growth", "school"]],
  ["src/ui/workshop-panel.ts", ["workshop"]],
  ["src/ui/cloud-card.ts", ["cloud"]],
  ["src/ui/map-view.ts", ["sites"]],
  ["src/ui/lines-view.ts", ["touch:route-ux-more,route-share"]],
  ["src/ui/route-drag.ts", ["touch:route-reorder"]],
  ["src/ui/goals-panel.ts", ["stickers", "research"]],
  [["src/ui/fullscreen.ts", "src/ui/swipe-guard.ts"], ["click:fullscreen"]],
  ["src/ui/store-rows.ts", ["warehouse"]],
  ["src/ui/town-ledger.ts", [...TOWNS]],
  ["src/ui/piece-info.ts", ["names"]],

  // Game rules (src/game: by file; anything else there falls to CORE).
  [["src/game/game.ts", "src/game/interaction.ts", "src/game/world.ts", "src/game/modes.ts"], [...CORE, "locked", "life"]],
  // (interaction.ts: CORE runs touch whole; its wagon drop onto a train's ends is front-join.)
  ["src/game/interaction.ts", ["touch:front-join"]],
  [["src/game/touch-*", "src/game/drag-rule.ts", "src/game/drop.ts", "src/game/put-away.ts", "src/game/place-facing.ts"], ["touch", "click", "names"]],
  [["src/game/camera-director.ts"], ["touch", "click", "tutorial"]],
  [["src/game/draw-*", "src/game/erase.ts", "src/game/track-rules.ts", "src/game/lift-notice.ts"], ["draw", "joints", "ramps", "touch:select-drag,flick", "low-bridge"]],
  ["src/game/underpass-dig.ts", ["low-bridge"]],
  ["src/game/chains.ts", ["sandbox-chains"]],
  [["src/game/route-*", "src/game/lines.ts", "src/game/continue-on.ts", "src/game/switch-pin.ts"], [TOUCH_ROUTES, "click:routes", "signals"]],
  [["src/game/engine-status.ts", "src/game/engines.ts", "src/game/train-summary.ts", "src/game/decouple-words.ts", "src/game/empty-words.ts"], ["touch:train-card,blocker", "train-summary", "train-parts", "engine-names"]],
  ["src/game/signal-place.ts", ["signals"]],
  [["src/game/research*", "src/game/blueprints.ts", "src/game/tech.ts", "src/game/learn-text.ts"], ["research", "locked", "kits-game", "landscaping"]],
  [["src/game/goals.ts", "src/game/goal-ticks.ts", "src/game/rewards.ts", "src/game/progress.ts"], ["stickers", "stats", "research", "school", "sites"]],
  ["src/game/stickers.ts", ["stickers"]],
  ["src/game/landscaping.ts", ["landscaping"]],
  ["src/game/station-upgrade.ts", ["station-upgrade", "station-touches"]],
  ["src/game/departures.ts", ["station-touches"]],
  [["src/game/town-*", "src/game/towns.ts", "src/game/street-moves.ts", "src/game/growth-cards.ts", "src/game/upgrades.ts"], [...TOWNS]],
  [["src/game/crafting.ts", "src/game/workshop-text.ts"], ["workshop", "growth"]],
  [["src/game/warehouse-text.ts", "src/game/cargo-drop.ts", "src/game/supply.ts"], ["warehouse", "train-summary"]],
  [["src/game/map-sites.ts", "src/game/restore.ts", "src/game/across-river.ts", "src/game/map-markers.ts", "src/game/landmarks.ts", "src/game/harbours.ts"], ["sites"]],
  [["src/game/road-*", "src/game/town-cars.ts", "src/game/buses.ts", "src/game/delivery-vans.ts", "src/game/vans.ts"], ["roads"]],
  [["src/game/industries.ts", "src/game/lineside.ts", "src/game/fields.ts", "src/game/depot-footprint.ts", "src/game/things.ts", "src/game/food-text.ts"], ["kits-game", "warehouse", "workshop", "hopper-load", "life", "sandbox-chains"]],
  [["src/game/passengers.ts"], ["big-stations", "station-touches", "station-upgrade"]],
  [["src/game/touches.ts", "src/game/calendar.ts"], ["life", "station-clock"]],
  [["src/game/journal.ts"], ["focus-ring", "stickers"]],
  ["src/game/piece-name.ts", ["names"]],
  ["src/game/dev-checks.ts", []],
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

/** Paths → { suites: Map<suite, Set<group> | "all">, unmapped: [] }. */
export function affected(paths) {
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
  for (const path of paths) {
    if (matches(IGNORE, path)) continue;
    let hit = false;
    const own = /^(scripts|tools)\/e2e\/[^/]+\.mjs$/.test(path) && suiteOfScript(path);
    if (own) (add(own), (hit = true));
    for (const [globs, targets] of RULES) if (matches(globs, path)) (targets.forEach(add), (hit = true));
    if (!hit) (unmapped.push(path), CORE.forEach(add));
  }
  return { want, unmapped };
}

function changedPaths(base) {
  const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const mb = git("merge-base", base, "HEAD")[0];
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
  const paths = changedPaths(base);
  const { want, unmapped } = affected(paths);
  const order = Object.keys(SUITES).filter((s) => want.has(s));
  const cmd = (s) => {
    const g = want.get(s);
    const only = g === "all" ? "" : SUITES[s].groups ? `E2E_ONLY=${[...g].join(",")} ` : "";
    return `${only}npm run ${SUITES[s].script}`;
  };
  if (args.includes("--json")) {
    console.log(JSON.stringify({ base, paths, unmapped, suites: Object.fromEntries(order.map((s) => [s, want.get(s) === "all" ? "all" : [...want.get(s)]])) }, null, 1));
    process.exit(0);
  }
  console.log(`${paths.length} paths changed against ${base}.`);
  if (unmapped.length) console.log(`Unmapped (given ${CORE.join(", ")}; add a rule in scripts/e2e/affected.mjs): ${unmapped.join(" ")}`);
  if (!order.length) console.log("No e2e suite affected.");
  const mins = order.reduce((t, s) => t + (SUITES[s].minutes ?? 5), 0);
  if (order.length) console.log(`Suites (${order.length}, roughly ${Math.round(mins)} min if run whole):`);
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
