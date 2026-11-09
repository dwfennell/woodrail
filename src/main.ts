import { lazy } from "./lib/lazy";
import { CRANE_TEXT } from "./game/crane-text";
import { placeNear, type Place as NearPlace } from "./game/place-near";
import { Group, Mesh, Spherical, Vector3, type Object3D } from "three";
import { ToyAudio } from "./audio/audio";
import { CrossingBells } from "./audio/crossing-bell";
import { Editor, pieceCentre, poseCentre, TRAIN_ON_TRACK } from "./editor/editor";
import { fitToRect, frameAlong, frameDistance, type ViewRoom } from "./game/camera-director";
import { viewRoom } from "./ui/view-room";
import { stopDrag } from "./ui/route-drag";
import { Game, MIN_PITCH, type GameWorld } from "./game/game";
import { Interaction } from "./game/interaction";
import { buildStarterWorld, createWorld, freshGameWorld, landForSale, newMapSeed, plotsForSale } from "./game/world";
import { describeLand, harbourStranded, ruinCard, ruinInWay, ruinNear, siteBlueprint } from "./game/map-sites";
import { clearPayment, clearRuinEdit, gamePayment, nearestRuin, knowsRole, restoredText, restoreRuin, RUIN_NO_WAY, ruinName, trackCanReach, type RestoreOptions } from "./game/restore";
import { connectedPairs, mapSettingsOf, PLOT_DEPTH, PLOT_WIDTH, type PlotCoord } from "./landscape";
import { mapCode, parseMapCode, type MapSettings } from "./landscape/water";
import { loadLastBuilt, loadLastMode, saveLastBuilt, saveLastMode, type GameMode } from "./game/modes";
import { loadLinkedMap, mapText } from "./persist/bug-map";
import { loadSaveSchemas } from "./persist/schemas";
import { hasOlderSave, hasSave, loadFromStorage, loadGoals, loadProgress, loadSession, loadStickers, loadStickersSeen, loadTips, modeKeys, OLDER_SAVE, PROGRESS_KEYS, SAVE_VERSION, saveGoals, saveProgress, saveSession, saveStickers, saveStickersSeen, saveTips, saveToStorage, serializeWorld } from "./persist/save";
import { cloudSupported, CloudSync, WorkerBackend, type EditKind, type SyncNote } from "./persist/cloud";
import { gameMerger } from "./persist/progress-merge";
import { recentErrors, reporter, startLog, type Reporter } from "./debug/report";
import { GoalTracker, goalTickTitle, payGoal, secondEngineTip, trayRing, type GoalGuide } from "./game/goals";
import { StickerTracker } from "./game/stickers";
import { makesLine } from "./game/learn-text";
import { GoalTicks, goalsDoneText, GROWTH_JOIN_S, joins, TOAST_TITLES } from "./game/goal-ticks";
import { GoalsPanel } from "./ui/goals-panel";
import { dateOf, dateText, MONTH_S } from "./game/calendar";
import { Journal, type JournalEntry, type JournalPlace, type NoteInput } from "./game/journal";
import { loadBlenderModels, loadGameModels, loadModelSet } from "./render/blender-models";
import { LoadingToys, type Shelf } from "./ui/loading-toys";
import { goalLabels, goalMarks, SQUARE_RING } from "./render/goal-marks";
import { statusOf, TownLife } from "./game/town-life";
import { DeliveryVans } from "./game/delivery-vans";
import { Buses } from "./game/buses";
import { TownCars } from "./game/town-cars";
import { plotPrice } from "./game/towns";
import { hasBank, PLACES, type Place } from "./game/places";
import type { Town } from "./landscape";
import { firstFoodNews } from "./game/food-text";
import { cardView, describeThings, FIRST_FLOUR_BONUS, firstTimeGift, flourBefore, learnGift, offerOnGrowth, payDelivery, redrawOldOffers, takeCard } from "./game/rewards";
import { atSchool, landmarkOf, schoolTakesFor, schoolHowTo, landmarksAt, placedSchools, researchSpeed, schoolGrade, schoolGradesKey } from "./game/landmarks";
import { GrowthSheet, sheetTitle } from "./ui/growth-sheet";
import { mapFramePoints, mapMarkers, ruinMarkers, ruinMarkersKey, type MapMarker } from "./game/map-markers";
import { MapView } from "./ui/map-view";
import { Progress } from "./game/progress";
import { costOf, craftNow, craftShort, Crafting, keepsForOrder, lacking, madeText, makeNote, orderPlanks, owedText, shopOwes, shopOwing, shopSpare, takeFromWorkshops, uncraft, workshops, workshopStock, yardKeeps } from "./game/crafting";
import { pieceStock as supplyOf, pieceUnlearned as unlearnedOf } from "./game/supply";
import { costText, isFree, isGift, LOOK_TECH, pieceThing, ruleOf, THING_RULES, thingsFor, type ThingId, type ThingItem } from "./game/things";
import { DEPOT_NAMES, depotName, HALT_KITS, HALT_REACH, haltTown, haltWhy, isSightStop, METRO_KIT, syncIndustries, INDUSTRY_ROLE } from "./game/world";
import { digWhy, metroDraw, settleDigging, squaresDugUnder } from "./game/metro";
import { HaltReachView } from "./render/halt-reach-view";
import { WhistleCalls, WhistlePosts } from "./game/lineside";
import { amountText, plantedCells, rateFor, resourceAt, schoolOf, SITE_RULES, siteWhy, updateRates, yardMiddle } from "./game/industries";
import { fieldPrice, fieldSpot, plantField } from "./game/fields";
import { schoolYardHtml, WorkshopPanel, type KeepRow, type MakeRow } from "./ui/workshop-panel";
import { lostStopName, lostStopWords, routeStops } from "./game/route-stops";
import { TipTracker, tipFor, type TipContext, type TipGuide } from "./game/feature-tips";
import { createLine, deleteLine, editLine, editLineById, isRingLine, joinLine, LINE_COLOURS, LINE_NAME_MAX, lineOf, MAX_VIAS, moveStop, nextColour, recolourLine, renameLine, restoreLines, reverseLine, reverseStops, sameLines, snapshotLines, stopLine, trainsOn, turnTrains, type NotTurned } from "./game/lines";
import { PlaceRings } from "./render/place-rings";
import { LineSheet, type SheetFree, type SheetStop, type SheetTrain } from "./ui/line-sheet";
import { actionOf, goodWords, inkOn, loadsWords, stopSentences, ticksOf } from "./game/line-sheet-text";
import { HEALTH_WORDS, lineHealth, type LineHealth } from "./game/line-health";
import { wouldRepeat } from "./ui/route-drag";
import { aheadRuns, legFromCursor, nearestAhead, pinnedBlocking, pointOnPath, runsLength, stopCursors, viaLegs } from "./game/route-path";
import { viaDone } from "./routing/via";
import { LinesView } from "./ui/lines-view";
import { ribbonScale, RouteView, type DiscSpec, type GapSpec, type RibbonSpec } from "./render/route-view";
import { decoupleWords } from "./game/decouple-words";
import { addTipped, emptyWords, type Tipped } from "./game/empty-words";
import { canContinue, continueOn } from "./game/continue-on";
import { blockerOf, engineView, FOLLOW_TIP, fullLineToast, headOnTip, trainsForReport, trainState, type Blocker, type CantMove } from "./game/engine-status";
import { givesBlockText, STORE_NO_ROUTE, WAGON_SAME_DONE, storeBlockText, storeStopText } from "./game/warehouse-text";
import { keptText } from "./game/workshop-text";
import { planIcons } from "./game/route-plan-text";
import { LIFT_TIP, liftHeldMessage, liftTipSeen, markLiftTipSeen, TooLongNotice, TOO_LONG_MESSAGE } from "./game/lift-notice";
import { capAt, isStore as isStoreRole, MAX_SHEDS, RECIPES, SHED_CAP, storeModeOf, type DepotState, type RouteStopDef } from "./economy";
import type { Stuck } from "./economy/stalls";
import type { BlueprintBoard, BlueprintBoardHandlers, Station } from "./ui/blueprint-board";
import { pieceIcon, trainIcon } from "./ui/icons";
import { needMet, seenOf, TECHS, techOf, unlocksOf } from "./game/tech";
import { attachResearch, costOf as costOfResearch, dequeue, detachResearch, wants as researchWants, queuePlace, setSpeed, startNow, toggleQueue, simElapsed, type StudyClock, tick as researchTick } from "./game/research";
import { cardState, costWords, goalPick, IdleNotice, learnedText, pickerKey, pillKey, pillResearch, pillView, removedText, researchCard, schoolCard, schoolCardKey, showMePick, unlockHow, unlocksWords } from "./game/research-text";
import { TelegraphWires } from "./render/telegraph-wires";
import { applyCranes, boostOf, Counters, machinesFor, upgradeKey } from "./game/upgrades";
import { BIG_TOP, bigTopSpot, CIRCUS_FARE, circusTick } from "./game/circus";
import { nextSpeed, slower, speedsOpen } from "./game/time-scale";
import { attachEngines, cantMove, detachEngines, load as engineLoad, tooHeavy } from "./game/engines";
import { airportLines, Airports, airportsOf, planePose } from "./game/airports";
import { Airships, mastLines, mastsOf, TOUR_HEIGHT, TOUR_RADIUS, tourSights } from "./game/airship";
import type { MastAt } from "./render/airship-view";
import { MAST } from "./render/depot-view";
import { depotPoint as yardPoint } from "./game/harbours";
import type { AirportAt } from "./render/planes-view";
import { canPower, POWERED_RATE, powerOf } from "./game/power";
import { radioRiders, radioTowns } from "./game/radio";
import { carLoadWords, trainSummary, type SummaryCar } from "./game/train-summary";
import { CARGO, CARGO_KINDS, CARRIES, COIN_ICON } from "./economy/cargo";
import { BOAT_SAIL, BUY_LOT, buyPrice, goodsForSale, HarbourTrade, lighthouseNear, SHED_PRICE } from "./game/harbours";
import { CRANE_TICKS, WAGON_CAPACITY } from "./economy/constants";
import { BRANCHES, COLLEGE_SCHOOL_ID, describeNeed as describeNeedWords, needTag, RENAMED, SCHOOL_NEED, UNIVERSITY_SCHOOL_ID, type Need, type Plan } from "./game/blueprints";
import { attachPassengers, detachPassengers, peopleArrive, waitingCap } from "./game/passengers";
import { ledgerKey, townLedger, type LedgerContext } from "./game/town-ledger";
import { drawLedger } from "./ui/town-ledger";
import { attachWater, type WaterControls } from "./ui/water-controls";
import { attachSecrets, type SecretControls } from "./ui/secret-controls";
import { secretOfStop } from "./game/secrets";
import { isSecretKit } from "./track";
import { drawPlaceRows } from "./ui/places-row";
import { paintable } from "./render/train-models";
import { ownColoursOpen, paint, paintOpen, paintOwn, paintPots } from "./game/paint-shop";
import { buyTreat, placeRow, placeRowKey, startPlace, stopPlace } from "./game/place-row";
import { achievements, advanceGrands, centralPiece, centralWhy, countRider, fairTown, moveCentralKit, giveExhibition, GRAND_LEVEL, grandOf, grandRiders, ROYAL_GIFT, wheelTickets, grandRow, grandRowKey, siteAsset, siteSpot, startGrand, unionFootprint, type GrandId } from "./game/grand";
import { drawGrandRow } from "./ui/grand-row";
import { retireStyles } from "./props/storeys";
import { aOrAn, describe as describeGoods, minus, total, type Bag } from "./economy/goods";
import { costTag, refundText, trayCostTag } from "./ui/cost-tag";
import { GOODS_ICON, type CargoKind } from "./economy/cargo";
import { noteContextLost, qualityFor, saveQualityOverride } from "./render/quality";
import { ContextLostCard } from "./ui/context-lost";
import { CrashReporter, crashReportsOff, setCrashReportsOff } from "./feedback/crash";
import { drawnKey, modelKey, type PropModel } from "./render/props/library";
import { CLOCK_ASSETS } from "./render/clock-hands";
import { renderThumbnails, renderThumbnailsAsync, ThumbnailStudio, type ThumbnailSubject } from "./render/thumbnails";
import { loadCached, saveCached } from "./render/piece-cache";
import { forgetTextureCache, texturesMade, useTextureCache } from "./render/textures";
import { onPiecesBuilt, TrackView } from "./render/track-view";
import { connectorRef, createWorldConnector, getPieceDef, ignores, isLift, kitOf, pathLength, PIECE_TYPES, type Ignore, type Layout, type PieceTypeId, type Pose } from "./track";
import { flipCursor, type CarKind, type CarLook, type Cursor } from "./sim";
import { Hud } from "./ui/hud";
import { installSwipeGuard } from "./ui/swipe-guard";
import { viewOf } from "./ui/controls-tutorial";
import { GAME_KIT_GROUPS, INDUSTRY_GROUPS, SIGNAL_ITEM, TRACK_ITEMS, TRAIN_ITEMS, trayKey, type LandTool, type TrayItem } from "./ui/tray-catalogue";
import { ROAD_COINS, ROAD_TECH, roadShortText, roadsOnMap, roadsPrice, roadsSpare } from "./game/road-box";
import { LAND_MESSAGES, LandEditor, plotSlotOf, setHeights } from "./landscape/edit";
import { LANDSCAPING, lowerPrice, lowerQuestion, lowerRefusal } from "./game/landscaping";
import { MAX_TRACKS, planTracks, TRACK_PRICES, TRACK_ROLES, TRACKS_TECH, tracksAfter, type TracksPlan } from "./game/depot-tracks";
import { TURNTABLE_CONTROLS } from "./game/deck-roads";
import { planUpgrade, STATION_UPGRADES, UPGRADE_NAMES, UPGRADE_UNDO_REFUSED, upgradeLand, type StationUpgrade } from "./game/station-upgrade";
import { propsInRect } from "./props/placement";
import { hintSeen, loadChainHints, loadMuted, markHintSeen, saveChainHints, saveMuted } from "./ui/prefs";
import { chainOf, chainRows, partnersOf, stateWords, type PlaceOf } from "./game/chains";
import { ChainHintsView, type HintLine, type HintRing } from "./render/chain-hints-view";
import { TITLE_ART_PIECE, TITLE_ART_TRAIN, TitleScreen } from "./ui/title";
import { DEFAULT_CHOICES, NEW_GAME_WARNING, NewGameSheet, type NewGameChoices } from "./ui/new-game";
import { installClickShield } from "./ui/click-shield";
import { startUpdateCheck } from "./ui/update-check";
import { installFocusRing } from "./ui/focus-ring";
import { CloudCard } from "./ui/cloud-card";
import { titleOffers, type TitleOffer } from "./persist/cloud-known";
import { Snapshots } from "./stats/snapshots";
import { pageStats } from "./stats/stats";
import { gpuOnlyEnabled } from "./render/gpu-only";
import "./style.css";
// The icon font (style.css) loads with the game, not on the first card that shows an icon.
void document.fonts?.load('16px "Woodrail Icons"', GOODS_ICON.planks).catch(() => undefined);

installFocusRing(window, document.documentElement);

/** A blueprint's requirement in words, a count of goods with its icon: "20🪨 stone delivered". */
function describeNeed(n: Need): string {
  return n.kind === "delivered" ? `${n.n}${GOODS_ICON[n.good as CargoKind] ?? ""} ${n.good} delivered` : describeNeedWords(n);
}

/** How far (mm) the opening view stands from where track was last built: the middle of the zoom range. */
const OPENING_DISTANCE = 1000;
/** Room round the places a view frames for a goal (mm): a station and its town around it. */
const GOAL_MARGIN = 260;
/** Room round a news place made of several spots (new houses, a connection). */
const PLACE_MARGIN = 140;

/** Tray pictures drawn together, a batch a frame, after the title's up. */
const THUMBNAIL_BATCH = 8;
/** How long (ms) a batch of tray pictures waits for the scene to be still before it's drawn anyway. */
const THUMBNAIL_STILL_WAIT_MS = 1500;
/**
 * How long (ms) a frame may spend drawing pictures asked for on demand (a shelf's, a blueprint ticket's) before the rest
 * wait for the next frame: a few a frame on a phone, so a ticket's fill in at once without a frame dropped for it.
 */
const PICTURE_BUDGET_MS = 7;
/** At most this many on-demand pictures drawn a frame (each read back later, without waiting). */
const PICTURES_A_FRAME = 4;

/** How long (ms) an engine's status must hold before its card shows it (so it doesn't flicker between steps). */
const STATUS_HOLD_MS = 600;

/** A car's tray picture's key: its tray card's on its own, in its own look (undefined if the tray has none). */
function carPictureKey(kind: CarKind): string | undefined {
  const item = TRAIN_ITEMS.find((t) => t.kind === "train" && t.cars.length === 1 && t.cars[0] === kind && !t.looks?.length);
  return item && trayKey(item);
}

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const loading = document.querySelector<HTMLDivElement>("#loading");

/** A one-off flag kept in the browser (a hint seen); false where storage isn't there. */
function loadFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function saveFlag(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // No storage: shown again next time.
  }
}

/**
 * A map asked for in the link (`#seed-` and a map code: `#seed-12345`), to share or replay a particular map: its land
 * as such a link has always made it (Hilly, Some water, the sea), or as the code says (`#seed-12345-gentle-water-lots`,
 * `-nocoast`: `mapCode`, the code the game shows for a map).
 */
function linkedSeed(): MapSettings | null {
  const m = /^#seed-(.+)$/.exec(location.hash);
  return m ? parseMapCode(m[1]) : null;
}

/**
 * The world to open with. A linked map opens in Sandbox (fresh, unless the sandbox autosave is already that map, so
 * reloading keeps your track); otherwise the last mode's autosave, or the starter map.
 */
/** The autosave was from an older version of the game (turned away: a fresh map instead). The game says so. */
let olderSave = false;

function initialWorld(): { world: GameWorld; mode: GameMode; linked: boolean; fromSave: boolean } {
  const link = linkedSeed();
  const mode = link !== null ? "sandbox" : loadLastMode();
  // Reloaded from play (graphics switched, an update taken): straight back into the game, past the title.
  const resumed = takeResume() === mode;
  const saved = loadFromStorage(mode);
  if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${mode} autosave (${saved.error})`);
  if (saved && !saved.ok && saved.error === OLDER_SAVE) olderSave = true;
  if (link !== null) {
    const was = saved?.ok ? saved.value.landscape : null;
    const same = !!was && !was.starter && mapCode(mapSettingsOf(was)) === mapCode(link);
    return { world: same && saved?.ok ? saved.value : createWorld(link.seed, false, true, false, link), mode, linked: true, fromSave: same };
  }
  return { world: saved?.ok ? saved.value : buildStarterWorld(mode === "game"), mode, linked: resumed, fromSave: !!saved?.ok };
}

const RESUME_KEY = "woodrail.resume";

/** Reload the page, then go straight back into this mode (saved first) rather than to the title. */
function reloadInto(mode: GameMode, url?: string): void {
  try {
    sessionStorage.setItem(RESUME_KEY, mode);
  } catch {
    // No session storage: the title, as before.
  }
  if (url) location.replace(url);
  else location.reload();
}

/** The mode a reload from play asked to go straight back into (once), or null. */
function takeResume(): string | null {
  try {
    const m = sessionStorage.getItem(RESUME_KEY);
    sessionStorage.removeItem(RESUME_KEY);
    return m;
  } catch {
    return null;
  }
}

/**
 * Cloud saves (see persist/cloud.ts), in a build with a cloud to save to (`VITE_CLOUD_URL`; not the artifact build):
 * else null, and nothing of them shows.
 */
const cloud = ((): CloudSync | null => {
  const url = import.meta.env.VITE_CLOUD_URL as string | undefined;
  if (!url || !cloudSupported()) return null;
  try {
    return new CloudSync({ backend: new WorkerBackend(url, __BUILD_ID__ || "dev"), storage: localStorage, keys: { sandbox: modeKeys("sandbox"), game: modeKeys("game") }, saveVersion: SAVE_VERSION, merge: gameMerger(PROGRESS_KEYS), auto: true });
  } catch {
    // No storage.
    return null;
  }
})();
/**
 * "Help improve Woodrail": anonymous play stats, opt-in (see stats/stats.ts and docs/stats.md). They go to the cloud
 * Worker: `VITE_STATS_URL`, else `VITE_CLOUD_URL` (the itch build has stats without cloud saves). Neither: no stats.
 */
const stats = pageStats(((import.meta.env.VITE_STATS_URL ?? import.meta.env.VITE_CLOUD_URL ?? "") as string).trim(), __BUILD_ID__ || "dev");
addEventListener("error", (e) => stats.record({ e: "error", msg: String(e.message || e.error || "error").slice(0, 200) }));
addEventListener("unhandledrejection", (e) => stats.record({ e: "error", msg: String((e.reason as Error | undefined)?.message ?? e.reason).slice(0, 200) }));
/**
 * Crash reports (feedback/crash.ts): an uncaught error or a lost drawing, one a session, to the Worker feedback goes to
 * (none in a build without one). Listening from here, before the game is made, so a failure while loading is sent too.
 */
const crashUrl = ((import.meta.env.VITE_FEEDBACK_URL || import.meta.env.VITE_STATS_URL || import.meta.env.VITE_CLOUD_URL || "") as string).trim();
/** What the crash report says of the drawing, once the game is made. */
let crashDrawing = (): { pixelRatio: number; quality: string } => ({ pixelRatio: 0, quality: "" });
const crashes = crashUrl
  ? new CrashReporter(crashUrl, () => ({
      build: __BUILD_ID__ || "dev",
      userAgent: navigator.userAgent,
      screen: { width: screen.width, height: screen.height, dpr: devicePixelRatio },
      ...crashDrawing(),
    }))
  : null;
crashes?.listen();
/** The cloud's copies checked against this device's while the game loads, so a newer one is the one loaded. */
const cloudStarted = cloud ? cloud.start().catch(() => ({})) : Promise.resolve({});
/** How long the game waits on that check, past its own loading (ms): a slow cloud never holds it up. */
const CLOUD_WAIT_MS = 3000;
type CloudNotes = Partial<Record<GameMode, SyncNote>>;

/** A cloud note to say after a reload (`CloudSync.onTaken`), in session storage. */
const CLOUD_NOTE_KEY = "woodrail.cloud.note";

/** The note a reload left to say, if any (taken once). */
function takeCloudNote(): CloudNotes {
  try {
    const raw = sessionStorage.getItem(CLOUD_NOTE_KEY);
    sessionStorage.removeItem(CLOUD_NOTE_KEY);
    const n = raw ? (JSON.parse(raw) as { mode?: unknown; note?: unknown }) : null;
    if (n && (n.mode === "sandbox" || n.mode === "game") && typeof n.note === "string" && n.note in CLOUD_NOTES) return { [n.mode]: n.note as SyncNote };
  } catch {
    // none
  }
  return {};
}

/** What a cloud check did to a mode's railway, as a toast. */
const CLOUD_NOTES: Record<Exclude<SyncNote, null>, string> = {
  "took-cloud": "Loaded your newer railway from the cloud. The other one is kept (Cloud save → Restore).",
  "kept-here": "This railway is newer than the one in the cloud, so it's kept. The other one is kept too (Cloud save → Restore).",
  "both-changed": "Your railway was changed on another device too. That one is kept (Cloud save → Restore).",
  newer: "Your railway online was saved by a newer version of the game: update to carry on with it.",
};

startLog();
/** Where "Send to Claude" reports go (the dev server, or the claude.ai page), or null: no menu item. */
let reports: Reporter | null = null;

function boot(savedThumbnails: Map<string, string> | null, opening: ReturnType<typeof initialWorld>, cloudNotes: CloudNotes): void {
  const game = new Game(canvas, opening.world);
  // With drawn-only geometry freed after upload (gpu-only.ts), a lost context can't be rebuilt in place: reload instead.
  game.restoreInPlace = !gpuOnlyEnabled();
  // Dev builds (the dev server, or `?dev`): the train invariants checked as the game runs, a red badge when one breaks
  // (src/game/dev-checks.ts). In a production build without `?dev` they never run (8.9 KB of the bundle).
  // (Loaded only then, on its own: not in the bundle every start fetches.)
  let devChecks: { frame(): void } | null = null;
  let recentBreaks = (): string[] => [];
  if (import.meta.env.DEV || new URLSearchParams(location.search).has("dev"))
    void import("./game/dev-checks").then((d) => {
      devChecks = d.installDevChecks(game);
      recentBreaks = d.recentBreaks;
    });
  let mode = opening.mode;
  /** The research pill as last drawn: its key (`pillKey`) and the progress it was for (a new game starts a new one). */
  let pillKeyShown = "";
  let pillFor: unknown = null;
  /** What the open Research picker was last drawn from (`boardKey`). */
  let boardKeyShown = "";
  // Stations and depots never move (to take up joint play, or to close a near miss).
  // (And a found secret's halt: the game laid it, where the secret is. src/game/secrets.ts.)
  const isFixedPiece = (id: number): boolean => [...game.stations.values(), ...game.depots.values(), ...game.ruins.values()].includes(id) || isSecretKit(game.layout.getPiece(id)?.type ?? "straight-216");
  /** Has the train lift's first-time tip been shown (on this device)? */
  let liftTipShown = liftTipSeen();
  /** An editor for the world's track and props (props-only edits skip the track's work). */
  const makeEditor = () => {
    const ed = new Editor(game.layout, game.sim, () => onChange(), isFixedPiece);
    ed.onTrackEdit = (ids) => {
      const id = ids.find((i) => game.layout.getPiece(i));
      if (id !== undefined) saveLastBuilt(mode, pieceCentre(game.layout, id));
      // A train lift put down for the first time on this device: how to work it.
      const lift = (i: number) => {
        const p = game.layout.getPiece(i);
        return !!p && isLift(p.type);
      };
      if (!liftTipShown && ids.some(lift)) {
        liftTipShown = true;
        markLiftTipSeen();
        hud.toast(LIFT_TIP, false, 4000);
      }
    };
    // An edit, undo or redo refused: it would take up or move a train lift that's carrying a train or has one on it.
    ed.onHeld = (liftId) => {
      hud.toast(liftHeldMessage(game.sim.pieceOccupied(liftId)));
      audio.refuse();
    };
    // An undo or redo refused by the edit itself (a restore's redo, short of planks or coins now).
    ed.onRefused = (why) => {
      hud.toast(why);
      audio.refuse();
    };
    // An undo or redo refused: it would take up or move track a train is on (and derail it).
    ed.onTrainOn = () => {
      hud.toast(TRAIN_ON_TRACK);
      audio.refuse();
    };
    ed.onLandChange = (slots) => {
      game.editLand(slots);
      scheduleSave();
    };
    ed.onRoadsChange = (slots, trees) => {
      game.roadsEdited(slots, trees);
      // Game mode: road squares beyond the box are bought now they're down; the tray's road counts follow.
      if (mode === "game") settleRoads();
      hud.setHistory(ed.canUndo, ed.canRedo);
      scheduleSave();
    };
    // Every props edit, done, undone or redone (and a land edit recorded): the one place a prop coming or going is
    // heard, so Game mode's toy box counts on the tray follow it here (a made prop, once placed, isn't one left).
    // Every signal-mark edit, done, undone or redone (signals spec §4): saved; an open signal card follows it.
    ed.onSignalsChange = () => {
      hud.setHistory(ed.canUndo, ed.canRedo);
      interaction?.signalsChanged();
      game.invalidate();
      scheduleSave();
    };
    // A route edit undone or redone (audit F1): the open card, its ribbon and the Lines view follow; a stop or via
    // picked, or a Leave asking, is let go (its index may name another now).
    ed.onRoutesChange = () => {
      stopPicked = -1;
      viaPicked = null;
      linesChanged();
      showRoute();
      hud.setHistory(ed.canUndo, ed.canRedo);
      game.invalidate();
    };
    ed.onPropsChange = () => {
      game.propsChanged();
      // (A tree planted or taken up beside a harvester: its rate, and its card's count.)
      industriesChanged();
      interaction.redrawDepotCard();
      hud.setHistory(ed.canUndo, ed.canRedo);
      if (mode === "game") hud.refreshTrayBadges();
      scheduleSave();
    };
    return ed;
  };
  let editor = makeEditor();
  let saveTimer = 0;
  let interaction: Interaction;
  /** River barges on screen (made once the HUD and interaction are: `attachWater`). */
  let water: WaterControls | null = null;
  let secrets: SecretControls | null = null;
  const audio = new ToyAudio();
  let muted = loadMuted();
  audio.setMuted(muted);
  // Tray pictures: saved from an earlier visit to this build, or drawn now (and saved for next time). The industries'
  // wait for Game mode's models (`ensureGameModels`), so they're never drawn from stand-ins.
  const industryItems = INDUSTRY_GROUPS.flatMap((g) => g.items);
  const thumbnails = new Map(savedThumbnails ?? []);
  /** Draw the tray pictures not drawn yet among `items`; returns the keys drawn. */
  const subjectsOf = (items: readonly TrayItem[]): ThumbnailSubject[] =>
    items
      .filter((item) => !thumbnails.has(trayKey(item)))
      .flatMap((item): ThumbnailSubject[] =>
        item.kind === "piece"
          ? [{ key: trayKey(item), kind: "piece" as const, type: item.type }]
          : item.kind === "train"
            ? [{ key: trayKey(item), kind: "train" as const, cars: item.cars, looks: item.looks }]
            : item.kind === "signal"
              ? [{ key: trayKey(item), kind: "signal" as const }]
              : [],
      );
  const withPiece = (type: PieceTypeId) => (type === "signal" ? game.trackView.signalModel() : INDUSTRY_ROLE[type] ? game.depotView.model(INDUSTRY_ROLE[type]) : kitOf(type) ? game.kitView.model(type) : null);
  const drawThumbnails = (items: readonly TrayItem[], save = true, studio?: ThumbnailStudio): string[] => {
    const subjects = subjectsOf(items);
    if (subjects.length === 0) return [];
    const drawn = renderThumbnails(game.renderer, game.mats, subjects, withPiece, studio);
    for (const [k, v] of drawn) thumbnails.set(k, v);
    if (save) void saveCached("thumbnails", __BUILD_ID__, thumbnails);
    return [...drawn.keys()];
  };
  /** As `drawThumbnails` (unsaved), read back without holding the main thread: the keys drawn, once they're in. */
  const drawThumbnailsAsync = async (items: readonly TrayItem[], studio: ThumbnailStudio): Promise<string[]> => {
    const subjects = subjectsOf(items);
    if (subjects.length === 0) return [];
    const drawn = await renderThumbnailsAsync(studio, game.mats, subjects, withPiece);
    for (const [k, v] of drawn) thumbnails.set(k, v);
    return [...drawn.keys()];
  };
  // Only the title's pictures now; the tray's are drawn after the title's up (see drawTrayThumbnails), the tray
  // showing each piece's drawn icon till then.
  const isTitleArt = (item: TrayItem) => (item.kind === "piece" && item.type === TITLE_ART_PIECE) || (item.kind === "train" && trayKey(item) === `train:${TITLE_ART_TRAIN}`);
  drawThumbnails([...TRACK_ITEMS, ...TRAIN_ITEMS].filter(isTitleArt));

  // A tap that opens a card (or a tray shelf) under the finger mustn't also press what opened there.
  installClickShield(canvas);
  // A sideways swipe or wheel never goes Back a page.
  installSwipeGuard();
  const hud = new Hud(
    document.body,
    {
      cameraView: () => viewOf(game.camera.position, game.controls.target),
      cameraGliding: () => game.director.busy,
      tutorialDone: () => {
        // Into the goals: Show me lights up a moment (Game mode).
        const show = document.querySelector<HTMLElement>(".goals:not([hidden]) .goals-show-icon");
        if (!show) return;
        show.classList.add("nudge");
        window.setTimeout(() => show.classList.remove("nudge"), 4000);
      },
      trayPointerDown: (item, e) => {
        if (trayAllowed(item)) interaction.startTrayDrag(item, e);
      },
      trayTap: (item, pointerType) => {
        // A click (a mouse or pen) on a piece, a model or a train carries it, for clicks on the map to put down (or puts
        // it away, if it was carried). Saying why if it can't come out: the toy box is asked again as each goes down.
        if ((item.kind === "piece" || item.kind === "prop" || item.kind === "train") && pointerType !== "touch") {
          if (interaction.isCarried(item) || trayAllowed(item, false)) interaction.carryTrayItem(item);
          return;
        }
        // A tap on a piece only puts the ready one away (or says why it can't come out); on a train, only says why. It
        // never makes anything: that's for a drag out of the tray.
        if (item.kind === "piece") {
          if (!interaction.isArmed(item)) trayAllowed(item, false);
          interaction.tapTrayPiece(item);
        } else if (trayAllowed(item, item.kind !== "train")) interaction.tapTrayPiece(item);
      },
      showResearch: (id) => setBoardOpen(true, id),
      trayTabChanged: () => interaction.arm(null),
      trayDraw: (on) => interaction.setDrawing(on),
      trayErase: (on) => interaction.setErasing(on),
      trackTab: (open) => game.showAllEnds(open),
      undo: () => {
        interaction.undo();
      },
      redo: () => {
        interaction.redo();
      },
      rerailAll: () => {
        let n = 0;
        // (The ids, a copy: a train re-railed is put back under a new id, at the end of the trains.)
        for (const id of game.sim.trainIds()) if (game.sim.getTrain(id)?.derailed && game.rerail(id) !== -1) n++;
        hud.toast(n ? `Re-railed ${n} train${n > 1 ? "s" : ""}` : "Nothing to re-rail");
        scheduleSave();
      },
      togglePause: () => {
        game.paused = !game.paused;
        hud.setPaused(game.paused);
      },
      toggleSpeed: () => {
        game.timeScale = nextSpeed(game.timeScale, speedsOpen(progress, game.landscape.towns));
        syncSpeed();
      },
      lever: (v) => interaction.setLever(v),
      follow: () => interaction.toggleFollow(),
      removeTrain: () => interaction.removeSelectedTrain(),
      renameEngine: (name) => interaction.renameSelectedEngine(name),
      paint: () => {
        if (interaction.openEngineCarId !== -1) {
          const id = interaction.openEngineCarId;
          paintSheet.use((s) => s.show(id));
        }
      },
      showBlocker: () => showBlocker(),
      showWaitSignal: () => {
        if (viewWaitAt !== -1) interaction.showWaitSignal(viewWaitAt);
      },
      sendCrane: () => sendCrane(),
      showPlace: (id) => showPlace(id),
      toggleChainHints: () => setChainHints(!chainHintsOn),
      tabOpened: (id) => {
        // Sandbox's Industries tab: the industries' models (Game mode's set) come in the first time it opens.
        if (id !== "industries" || mode !== "sandbox") return;
        ensureGameModels();
        chainTip("chains-tab", "Industries make goods, some from other goods. Pick one up: gold rings show where its goods come from, green rings where they go");
      },
      turnCar: () => interaction.turnSelectedCar(),
      swapEnds: () => swapEnds(),
      continueOn: () => continueTrain(),
      leaveNow: () => leaveNow(),
      decouple: () => decouple(),
      emptyCar: () => emptyCars(false),
      emptyTrain: () => emptyCars(true),
      rotate: () => interaction.rotateSelected(),
      flip: () => interaction.flipSelected(),
      deletePiece: () => interaction.deleteSelected(),
      selectMore: () => interaction.selectMore(),
      selectJoined: () => interaction.selectJoined(),
      doneSelecting: () => interaction.doneSelecting(),
      newLayout: () =>
        askNewMap(mode, "This map is put away for a new one.", (c, seed) => {
          saveLastBuilt(mode, null);
          setWorld(createWorld(seed, false, true, mode === "game", c));
          cloud?.edited(mode);
          game.frameLayout();
        }),
      resetStarter: () => {
        saveLastBuilt(mode, null);
        setWorld(buildStarterWorld(mode === "game"));
        cloud?.edited(mode);
        game.frameLayout();
        openingView();
      },
      toggleExpand: () => setExpanding(!expanding),
      toggleMap: () => (mapView.open ? closeMap(true, true) : openMap()),
      // The pill opens the picker on the research it shows (QA P5: "Routes 10/40🪙", up next, opened on another).
      toggleBoard: (pill) => setBoardOpen(!board.open, (pill && pillResearch(progress)) || undefined),
      buyLand: () => buyLand(),
      lowerHills: () => setLowering(!lowering),
      clearRuin: () => clearShownRuin(),
      restoreRuin: () => restoreShownRuin(),
      // (What `newGame` really resets, `resetGoals` and a fresh map: the map, its track and trains, and the progress
      // (coins, research, things owned), goals, stickers, tips and the Journal. Nothing of the game is kept.)
      newGame: () => askNewMap("game", NEW_GAME_WARNING, (c, seed) => newGame(c, seed)),
      openLines: () => openLines(),
      titleScreen: () => showTitle(),
      copyMap: () => void copyMap(),
      mapCode: () => mapCode(mapSettingsOf(game.landscape)),
      copyMapCode: () => {
        const code = mapCode(mapSettingsOf(game.landscape));
        void navigator.clipboard.writeText(code).then(
          () => hud.toast(`Copied the map seed ${code}: type it into a new game's seed to play this map`),
          () => hud.toast(`The map seed is ${code}`),
        );
      },
      home: () => backToRailway(),
      toggleQuality: () => {
        saveQualityOverride(game.quality.tier === "high" ? "mobile" : "high");
        // Back into the game after the reload, not the title (saved on the way out).
        if (playing) {
          saveOnLeaving();
          reloadInto(mode);
        } else location.reload();
      },
      closeCards: () => {
        hud.hideCards();
        interaction.clearSelection();
      },
      toggleSound: () => {
        muted = !muted;
        audio.setMuted(muted);
        saveMuted(muted);
        hud.setMuted(muted);
      },
      buttonTap: () => audio.tap(),
      depotAuto: () => interaction.toggleDepotAuto(),
      trayTurn: () => {
        interaction.turnTrayPiece(hud.propsTab);
        hud.setTrayOrientation(interaction.trayFlipped);
      },
      trayFlip: () => {
        interaction.flipTrayPiece();
        hud.setTrayOrientation(interaction.trayFlipped);
      },
      depotWaitFull: () => interaction.toggleDepotWaitFull(),
      storeMode: (kind, mode) => interaction.setStoreMode(kind, mode),
      storeUnlist: (kind) => interaction.unlistStore(kind),
      carGoods: (kind, on) => {
        game.economy.setCarTakes(interaction.openCarCardId, kind, on);
        showSummary();
        scheduleSave();
      },
      carGoodsSame: () => {
        // Every wagon of this kind on its train set as this one (one tap).
        const found = game.sim.findCar(interaction.openCarCardId);
        if (!found) return;
        const me = found.train.cars[found.index];
        for (const c of found.train.cars) if (c.kind === me.kind && c.id !== me.id) for (const k of CARRIES[me.kind] ?? []) game.economy.setCarTakes(c.id, k, game.economy.carTakes(me.id, k));
        hud.toast(WAGON_SAME_DONE);
        showSummary();
        scheduleSave();
      },
      needThumbnails: (items) => wantPictures(items, "tray"),
      kitsShown: (items) => interaction.warmKits(items),
      landTool: (tool) => setLandTool(tool),
      sendReport: async (text) => {
        if (!reports) throw new Error("reports aren't available here");
        const picture = await game.capture();
        const c = game.camera.position;
        const t = game.controls.target;
        const state = {
          mode,
          seed: game.landscape.seed,
          view: { camera: [c.x, c.y, c.z].map(Math.round), target: [t.x, t.y, t.z].map(Math.round) },
          screen: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, pixelRatio: game.renderer.getPixelRatio(), touch: matchMedia("(pointer: coarse)").matches },
          quality: game.quality.tier,
          counts: { pieces: game.layout.pieceCount, trains: game.sim.trainCount, props: game.props.size },
          hand: interaction.debugState(),
          trains: trainsForReport(game.sim, game.economy, game.layout, whyCantMove()),
          userAgent: navigator.userAgent,
        };
        await reports.send(text, state, serializeWorld(game.world), picture);
      },
    },
    () => (game.quality.tier === "high" ? "High" : "Battery saver"),
    { thumbnails, muted },
  );
  // "Send to Claude", where reports can go (resolved after start-up: on claude.ai the page's capabilities answer later).
  void reporter().then((r) => {
    reports = r;
    if (r) hud.enableReports();
  });

  /**
   * The track and train trays' pictures not saved from an earlier visit: drawn once the title's up, one a frame (each
   * piece once it's carved), and saved together at the end.
   */
  async function drawTrayThumbnails(): Promise<void> {
    const items = [...TRACK_ITEMS, SIGNAL_ITEM, ...TRAIN_ITEMS].filter((item) => !thumbnails.has(trayKey(item)));
    if (items.length === 0) return;
    // A few at a time in one studio, each batch once its pieces are carved: each picture is read back from the
    // graphics card, which waits for what it's drawing, so pictures go in batches (one wait each). Preferably while
    // nothing's moving on screen, but not waiting long for that (a train going round would hold them up for good).
    // (Read back at once, not with shootAsync: here, between frames, that only made the batches finish later.)
    const studio = new ThumbnailStudio(game.renderer);
    for (let i = 0; i < items.length; i += THUMBNAIL_BATCH) {
      const batch = items.slice(i, i + THUMBNAIL_BATCH);
      await Promise.all(batch.map((item) => (item.kind === "piece" ? TrackView.whenBuilt(item.type) : null)));
      await Promise.race([game.settled(10), sleep(THUMBNAIL_STILL_WAIT_MS)]);
      for (const key of drawThumbnails(batch, false, studio)) pictureDrawn(key);
      // Kept as they come (a visit cut short keeps what it drew).
      saveThumbnailsSoon();
    }
    studio.dispose();
    // All drawn: saved now rather than once the pause is up.
    clearTimeout(thumbSaveTimer);
    thumbSaveTimer = 0;
    await saveCached("thumbnails", __BUILD_ID__, thumbnails);
  }
  /** Start-up's tray pictures, all drawn and saved (the e2e tests wait on it before reloading). */
  let trayThumbnailsSaved: Promise<void> = Promise.resolve();

  // Pictures drawn on demand: catalogue models' (a kit's, a prop's) when their shelf is first shown, and those the
  // blueprint board's open ticket shows; then kept with the start-up pictures for the next visit. Every one's model is
  // fetched as soon as it's asked for (all at once), and those ready are drawn a few a frame (PICTURES_A_FRAME, within
  // PICTURE_BUDGET_MS), the open ticket's first, each read back without waiting for the graphics card and shown when
  // its pixels are in. Nothing runs once none are waiting.
  /** A picture asked for: by the tray, the board, or both; `ready` once its model's fetched and built. */
  type PictureJob = { item: TrayItem; tray: boolean; board: boolean; ready: boolean; model?: PropModel | null };
  const pictureJobs = new Map<string, PictureJob>();
  let pictureFrame = 0;
  let studio: ThumbnailStudio | null = null;
  let thumbSaveTimer = 0;
  /**
   * Save the tray pictures drawn so far, 2 s after the first not yet saved (not put off by more coming: a batch every
   * second or so would put it off till the last, and a visit cut short would keep none).
   */
  function saveThumbnailsSoon(): void {
    if (thumbSaveTimer) return;
    thumbSaveTimer = window.setTimeout(() => {
      thumbSaveTimer = 0;
      void saveCached("thumbnails", __BUILD_ID__, thumbnails);
    }, 2000);
  }
  /** A tray picture was drawn (and kept in `thumbnails`): the tray swaps it in, and the blueprint board if it waits for it. */
  function pictureDrawn(key: string): void {
    hud.setThumbnail(key, thumbnails.get(key)!);
    board.pictureCame(key);
  }
  /**
   * Pictures wanted by the tray (`from` "tray": added to what it asked for before) or by the board's open ticket
   * ("board": replaces what it asked for before, so a ticket closed or left stops waiting for its own).
   */
  function wantPictures(items: readonly TrayItem[], from: "tray" | "board"): void {
    if (from === "board") {
      const keep = new Set(items.map(trayKey));
      for (const [key, job] of pictureJobs) {
        if (!job.board || keep.has(key)) continue;
        job.board = false;
        if (!job.tray) pictureJobs.delete(key);
      }
    }
    for (const item of items) {
      // A prop, a kit piece (its track and model) or a train; other pieces are drawn at start-up.
      if (!(item.kind === "prop" || item.kind === "train" || (item.kind === "piece" && kitOf(item.type)))) continue;
      const key = trayKey(item);
      const url = thumbnails.get(key);
      if (url) {
        if (from === "tray") hud.setThumbnail(key, url);
        continue;
      }
      const had = pictureJobs.get(key);
      if (had) {
        had[from] = true;
        continue;
      }
      const job: PictureJob = { item, tray: from === "tray", board: from === "board", ready: false };
      pictureJobs.set(key, job);
      // Its model fetched and built now, alongside the others'.
      const loaded: Promise<unknown> =
        item.kind === "prop" ? game.propLibrary.load(item.asset).then((m) => (job.model = m)) : item.kind === "piece" ? Promise.all([game.kitView.load(item.type), TrackView.whenBuilt(item.type)]) : Promise.resolve();
      loaded.then(
        () => {
          job.ready = true;
          if (pictureJobs.get(key) === job) schedulePictures();
        },
        // Not fetched: forgotten, so asking again (the shelf or ticket shown again) retries.
        () => {
          if (pictureJobs.get(key) === job) pictureJobs.delete(key);
        },
      );
    }
  }
  function schedulePictures(): void {
    if (!pictureFrame) pictureFrame = requestAnimationFrame(drawWantedPictures);
  }
  /** Draw the pictures ready, the board's first, as many as fit in this frame's budget (one at least). */
  function drawWantedPictures(): void {
    pictureFrame = 0;
    const start = performance.now();
    const ready = [...pictureJobs].filter(([, j]) => j.ready).sort(([, a], [, b]) => Number(b.board) - Number(a.board));
    let drawn = 0;
    for (const [key, job] of ready) {
      // (Read back without waiting for the graphics card: a picture's main-thread cost is drawing it. A few a frame,
      // so the card isn't handed a pile at once.)
      if (drawn > 0 && (drawn >= PICTURES_A_FRAME || performance.now() - start > PICTURE_BUDGET_MS)) break;
      pictureJobs.delete(key);
      drawn++;
      const shots = (studio ??= new ThumbnailStudio(game.renderer));
      const { item } = job;
      const came = (keys: string[]) => {
        for (const k of keys) pictureDrawn(k);
        if (keys.length > 0) saveThumbnailsSoon();
      };
      if (item.kind !== "prop") {
        void drawThumbnailsAsync([item], shots).then(came);
        continue;
      }
      // (A prop whose asset doesn't exist has no picture: its blank stays.)
      if (!job.model) continue;
      const subject = new Group();
      for (const part of job.model.parts) subject.add(new Mesh(part.geometry, part.material));
      subject.rotation.y = -0.6;
      void shots.shootAsync(subject).then((url) => {
        thumbnails.set(key, url);
        came([key]);
      });
    }
    // More ready than fitted: the rest next frame. (Those still loading schedule a frame when they're in.)
    if (drawn < ready.length) schedulePictures();
  }

  interaction = new Interaction(game, hud, () => editor, () => onChange());
  // (An open signal card says what the signal shows now, as its aspect changes.)
  game.onMarksChanged = () => interaction?.marksChanged();
  game.keysTaken = () => interaction.piecesTakeKeys;
  interaction.onArmed = (item, carried) => hud.setArmed(item ? trayKey(item) : null, carried);
  interaction.onPlaced = (snapped) => {
    hud.trayPlaced();
    audio.putdown(snapped);
    if (snapped) hud.haptic("snap");
  };
  interaction.onPickup = () => audio.pickup();
  interaction.onDrawGrow = () => audio.drawTick();
  interaction.onDrawLaid = (i) => {
    audio.lay(i);
    if (i === 0) hud.haptic("snap");
  };
  interaction.onDrawing = (on) => hud.setDrawing(on);
  interaction.onErasing = (on) => hud.setErasing(on);
  interaction.onRefused = () => {
    audio.refuse();
    hud.haptic("refuse");
  };
  interaction.onTurned = () => audio.rotate();
  interaction.onDepart = () => audio.bell();
  interaction.onSwitched = () => scheduleSave();
  interaction.onCalledHome = () => scheduleSave();
  interaction.onLeverThrown = () => audio.switchClunk(0.7, 0);
  // Telegraph poles carry a signal box's reach (the Telegraph; Sandbox has every toy).
  interaction.telegraph = () => mode !== "game" || progress.learned.has("telegraph");
  // A routed train's throw in view: a soft clunk (rate-limited), and, once, how to pin a switch.
  game.onThrownInView = (pieceId) => {
    const p = game.layout.getPiece(pieceId);
    const at = p ? new Vector3(p.pose.x, p.y, p.pose.z).project(game.camera) : null;
    audio.softSwitchClunk(at ? Math.max(-1, Math.min(1, at.x)) * 0.6 : 0);
    interaction.hintPinHow();
  };
  // A halt held (Game mode): each town's reach shows as a ring on the ground, built once, shown and hidden after.
  const haltReach = new HaltReachView(game.scene, HALT_REACH);
  interaction.onHeld = (type) => {
    heldChains(type);
    const show = mode === "game" && type !== null && HALT_KITS.has(type) && !isSightStop(type) && type !== METRO_KIT;
    if (show === haltReach.showing) return;
    if (show) haltReach.show(game.landscape);
    else haltReach.hide();
    game.invalidate();
  };

  // ---- Sandbox's chain hints -------------------------------------------------------------------------------
  // What an industry makes and from what, where its goods come from and go (its card, with Show buttons, and chevrons
  // on the map while the card is open), rings round its suppliers (gold) and customers (green) while one is held, and a
  // train's card saying why it won't load somewhere. Sandbox only, switched off in ☰. Worked out when a card opens or
  // its piles change, or a piece is picked up or put down: never per frame or per pointer move.
  let chainHintsOn = loadChainHints();
  const chainHints = new ChainHintsView(game.scene);
  const chainsShown = () => mode === "sandbox" && chainHintsOn;
  const placeOfDepot: PlaceOf = (d) => {
    const p = game.layout.getPiece(d.pieceId);
    if (!p) return null;
    // (The middle of its track: a yard's 216 mm straight, a station's.)
    return { x: p.pose.x + Math.cos(p.pose.heading) * 108, z: p.pose.z + Math.sin(p.pose.heading) * 108 };
  };
  const groundAt = (x: number, z: number): number => {
    const g = game.landscape.grid;
    const i = g.cellAtWorld(x, z);
    return i === -1 ? 0 : g.groundY(i);
  };
  const showChainHints = (lines: HintLine[], rings: HintRing[]) => {
    if (chainHints.show(lines, rings, groundAt)) game.invalidate();
  };
  const hideChainHints = () => {
    if (chainHints.hide()) game.invalidate();
  };
  /** The open card's chain (its block, and chevrons from its suppliers and to its customers on the map). */
  function showDepotChain(d: DepotState): void {
    const view = chainOf(d, game.economy.allDepots(), placeOfDepot);
    // (One placed short of what it works from, trees for a harvester or a farm field for a farm yard, works slowly or
    // not at all, as in Game mode, which won't let it be placed so: the card says so in Game mode's words.)
    const piece = game.layout.getPiece(d.pieceId);
    const site = piece && view.state !== null && ![...game.world.depots.values()].includes(d.pieceId) ? siteWhy(game.landscape, piece.type, piece.pose, undefined, plantedCells(game.landscape, game.world.props)) : null;
    hud.setDepotChain({ status: site ?? stateWords(view), tone: site ? "waiting" : view.state, rows: chainRows(view, (o) => depotName(game.world, o), (k) => GOODS_ICON[k]) });
    const at = placeOfDepot(d);
    const lines: HintLine[] = [];
    const rings: HintRing[] = [];
    if (at) {
      for (const [list, tone] of [[view.inputs, "in"], [view.outputs, "out"]] as const)
        for (const l of list) {
          const p = l.place && placeOfDepot(l.place);
          if (!p) continue;
          lines.push(tone === "in" ? { from: p, to: at, tone } : { from: at, to: p, tone });
          rings.push({ ...p, tone });
        }
    }
    showChainHints(lines, rings);
  }
  hud.onDepotCardClosed = () => hideChainHints();
  /** An industry picked up (from the tray, or moved): rings round where its goods would come from and go. */
  let heldIndustry: { depots: number } | null = null;
  function heldChains(type: PieceTypeId | null): void {
    const role = type ? INDUSTRY_ROLE[type] : undefined;
    if (!chainsShown() || !role) {
      if (!type && heldIndustry && chainsShown()) {
        // Put down: once, the first time one is placed, say what to do next.
        const before = heldIndustry.depots;
        window.setTimeout(() => {
          if (game.economy.allDepots().length > before) chainTip("chains-placed", "Tap it to see what it needs and where that comes from. Join them by track, then run a train with the right wagons");
        }, 300);
      }
      heldIndustry = null;
      if (!hud.depotCardOpen) hideChainHints();
      return;
    }
    heldIndustry = { depots: game.economy.allDepots().length };
    const moving = interaction.openDepotId;
    const { from, to } = partnersOf(role, game.economy.allDepots(), (d) => game.economy.onMap(d), moving);
    const ring = (d: DepotState, tone: "in" | "out"): HintRing[] => {
      const p = placeOfDepot(d);
      return p ? [{ ...p, tone }] : [];
    };
    showChainHints([], [...from.flatMap((d) => ring(d, "in")), ...to.flatMap((d) => ring(d, "out"))]);
  }
  /** A first-time Sandbox tip (at most a few, each once on this device, none with the hints off). */
  function chainTip(id: string, text: string): void {
    if (!chainsShown() || hintSeen(id)) return;
    markHintSeen(id);
    hud.toast(text, false, 6500);
  }
  /** Frame a place named on the open card (its Show button); the card stays open. */
  function showPlace(depotId: number): void {
    const d = game.economy.depot(depotId);
    const p = d && placeOfDepot(d);
    const piece = d && game.layout.getPiece(d.pieceId);
    if (!p || !piece) return;
    if (game.following !== -1) interaction.toggleFollow();
    const distance = Math.min(frameDistance(260, game.camera.fov, game.camera.aspect), game.controls.maxDistance);
    game.director.glideTo(new Vector3(p.x, piece.y, p.z), distance, { duration: 0.7, inRoom: true });
  }
  function setChainHints(on: boolean): void {
    chainHintsOn = on;
    saveChainHints(on);
    hud.setChainHints(on);
    interaction.depotChain = chainsShown() ? showDepotChain : null;
    if (!chainsShown()) {
      hud.setDepotChain(null);
      hideChainHints();
    }
    interaction.redrawDepotCard();
    hud.toast(on ? "Chain hints on: cards and the map show where goods come from and go" : "Chain hints off");
  }

  // ---- adding land -----------------------------------------------------------------------------------------

  /** Choosing a plot to add, and the one chosen. */
  let expanding = false;
  let chosen: PlotCoord | null = null;

  function setExpanding(on: boolean): void {
    expanding = on;
    if (lowering) {
      lowering = false;
      lowerAt = -1;
      interaction.landCursor = null;
      interaction.showSquare(-1);
    }
    if (on) hud.chooseLandTool(null);
    chosen = null;
    if (!on) {
      game.landscapeView.showForSale([]);
      hud.setLandCard(null);
      game.invalidate();
      return;
    }
    hud.hideCards();
    interaction.clearSelection();
    game.landscapeView.showForSale(plotsForSale(game.landscape));
    addLandCard();
    // Pull back to see the land and the plots round it, the land a little above the middle of the screen (clear of the
    // card and the tray).
    const e = game.landscape.grid.extent();
    const radius = Math.hypot(e.x1 - e.x0 + 2 * PLOT_WIDTH, e.z1 - e.z0 + 2 * PLOT_DEPTH) / 2;
    const toCamera = game.camera.position.clone().sub(game.controls.target).setY(0);
    if (toCamera.lengthSq() < 1) toCamera.set(0, 0, 1);
    toCamera.normalize().multiplyScalar(radius * 0.3);
    const centre = new Vector3((e.x0 + e.x1) / 2 + toCamera.x, 0, (e.z0 + e.z1) / 2 + toCamera.z);
    const distance = Math.min(frameDistance(radius, game.camera.fov, game.camera.aspect) * 0.8, game.controls.maxDistance);
    if (game.camera.position.distanceTo(game.controls.target) < distance) game.director.glideTo(centre, distance, { phi: 0.75, duration: 0.8 });
    game.invalidate();
  }

  // ---- lowering hills (Landscaping, Game mode): on the land card, in place of adding land ------------------------

  let lowering = false;
  /** The square chosen to lower (−1: none yet). */
  let lowerAt = -1;
  const canLandscape = () => mode === "game" && progress.learned.has(LANDSCAPING);
  const ADD_LAND_TEXT = "Tap a plot marked + to see what it brings.";
  const LOWER_TEXT = "Tap a hill square to lower it a step. It costs coins: more for a higher hill.";
  /** The land card for adding land, with the switch to lowering hills once Landscaping is learned. */
  function addLandCard(text = ADD_LAND_TEXT, canBuy = false): void {
    hud.setLandCard(text, canBuy, canLandscape() ? { swap: "⛰️ Lower hills" } : {});
  }
  function lowerCard(text: string, price = 0): void {
    hud.setLandCard(text, price > 0, { title: "Lower hills", buy: `Lower it · ${price}${COIN_ICON}`, swap: "➕ Add land" });
  }
  function setLowering(on: boolean): void {
    if (on && !canLandscape()) return;
    lowering = on;
    lowerAt = -1;
    chosen = null;
    interaction.landCursor = on ? "#ffd27a" : null;
    interaction.showSquare(-1);
    game.landscapeView.showForSale(on ? [] : plotsForSale(game.landscape));
    if (on) lowerCard(LOWER_TEXT);
    else addLandCard();
    game.invalidate();
  }

  /** A tap while lowering hills: choose the square, and ask (its price), or say why not. */
  function chooseLower(x: number, y: number): void {
    const i = interaction.squareAt(x, y);
    lowerAt = -1;
    if (i === -1) {
      interaction.showSquare(-1);
      lowerCard("That's not your land. Tap a hill square on it.");
      return;
    }
    interaction.showSquare(i);
    const g = game.landscape.grid;
    const why = lowerRefusal(game.landscape, interaction.landEditor(), i, progress.coins, hasBank(game.landscape));
    if (why) {
      lowerCard(why);
      audio.refuse();
      hud.haptic("refuse");
    } else {
      lowerAt = i;
      lowerCard(lowerQuestion(g.height[i], progress.coins, hasBank(game.landscape)), lowerPrice(g.height[i], hasBank(game.landscape)));
      audio.tap();
    }
    game.invalidate();
  }

  /** "Lower it": pay, lower the square a step, and redraw its plot (not undoable: the coins are spent). */
  function lowerChosen(): void {
    const i = lowerAt;
    if (i === -1) return;
    const editor = interaction.landEditor();
    const why = lowerRefusal(game.landscape, editor, i, progress.coins, hasBank(game.landscape));
    if (why) {
      lowerAt = -1;
      lowerCard(why);
      return;
    }
    const price = lowerPrice(game.landscape.grid.height[i], hasBank(game.landscape));
    if (editor.apply(i, -1)) return;
    progress.coins -= price;
    hud.setCoins(progress.coins);
    const t0 = performance.now();
    game.editLand([plotSlotOf(i)]);
    console.info(`Woodrail: hill lowered, redrawn in ${Math.round(performance.now() - t0)} ms`);
    audio.putdown(true);
    lowerAt = -1;
    const h = game.landscape.grid.height[i];
    const bank = hasBank(game.landscape);
    lowerCard(h > 0 ? `Lowered a step. ${lowerQuestion(h, progress.coins, bank)}` : "Lowered: it's flat now. Tap another hill square.", h > 0 && progress.coins >= lowerPrice(h, bank) ? lowerPrice(h, bank) : 0);
    if (h > 0 && progress.coins >= lowerPrice(h, bank)) lowerAt = i;
    interaction.showSquare(i);
    scheduleSave();
  }

  /** The plot whose + badge is drawn at this screen point (they float above the ground), if any. */
  function badgeAt(x: number, y: number, plots: readonly PlotCoord[]): PlotCoord | null {
    const r = game.canvas.getBoundingClientRect();
    const v = new Vector3();
    let best: PlotCoord | null = null;
    let bestD = 36;
    for (const p of plots) {
      v.set((p.px + 0.5) * PLOT_WIDTH, 320, (p.pz + 0.5) * PLOT_DEPTH).project(game.camera);
      if (v.z > 1) continue;
      const d = Math.hypot(r.left + ((v.x + 1) / 2) * r.width - x, r.top + ((1 - v.y) / 2) * r.height - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  // Land editing (the Land tab): a tool chosen, and taps on the land use it.
  let landTool: LandTool | null = null;
  function setLandTool(tool: LandTool | null): void {
    landTool = tool;
    if (tool && expanding) setExpanding(false);
    interaction.landCursor = tool === "raise" ? "#7ddc58" : tool === "lower" ? "#ffd27a" : null;
    interaction.landMove = tool === "move";
    if (tool !== "raise" && tool !== "lower") interaction.showSquare(-1);
    if (tool !== "move") {
      interaction.clearSelection();
      hud.hideCards();
    }
  }

  /** Raise or lower the square at a screen point a block (one undo step), or say why not. */
  function editSquare(x: number, y: number): void {
    const i = interaction.squareAt(x, y);
    if (i === -1 || (landTool !== "raise" && landTool !== "lower")) return;
    const step = landTool === "raise" ? 1 : -1;
    const g = game.landscape.grid;
    const before = g.height[i];
    const why = interaction.landEditor().apply(i, step);
    if (why) {
      hud.toast(LAND_MESSAGES[why]);
      audio.refuse();
      hud.haptic("refuse");
      return;
    }
    const slots = [plotSlotOf(i)];
    const t0 = performance.now();
    game.editLand(slots);
    console.info(`Woodrail: land edit redrawn in ${Math.round(performance.now() - t0)} ms`);
    editor.recordLand({ do: () => setHeights(game.landscape, new Map([[i, before + step]])), undo: () => setHeights(game.landscape, new Map([[i, before]])), slots: () => slots });
    audio.putdown(true);
    interaction.showSquare(i);
  }

  interaction.onFloorTap = (ground, x, y) => {
    if (landTool === "move") {
      interaction.selectSceneryAt(x, y);
      return true;
    }
    if (landTool) {
      editSquare(x, y);
      return true;
    }
    if (expanding && lowering) {
      chooseLower(x, y);
      return true;
    }
    if (!expanding) {
      // An old industry's ruin (seen from too far to take hold of its stub): its card.
      const ruin = interaction.ruinAtScreen(x, y);
      if (ruin === -1) return false;
      openRuin(ruin);
      return true;
    }
    const forSale = plotsForSale(game.landscape);
    const p = badgeAt(x, y, forSale) ?? { px: Math.floor(ground.x / PLOT_WIDTH), pz: Math.floor(ground.z / PLOT_DEPTH) };
    if (!forSale.some((q) => q.px === p.px && q.pz === p.pz)) {
      chosen = null;
      game.landscapeView.showForSale(forSale);
      addLandCard(game.landscape.grid.hasPlot(p.px, p.pz) ? "That's your land already. Tap a plot marked +." : "Only plots beside your land can be added.");
      game.invalidate();
      return true;
    }
    chosen = p;
    game.landscapeView.showForSale(forSale, chosen);
    const price = plotPrice(game.landscape.grid.plots.length, hasBank(game.landscape));
    const priced = mode === "game" ? ` · ${price} coins (you have ${progress.coins})` : "";
    addLandCard(describeLand(landForSale(game.landscape, p.px, p.pz)) + priced, mode !== "game" || progress.coins >= price);
    game.invalidate();
    return true;
  };

  // ---- old industries' ruins (map sites) -------------------------------------------------------------------------

  /** The ruin whose card is open (site id), or −1. */
  let ruinShown = -1;

  /** Open an old industry's card: what's around it, what opens it, and Clear the ruin. */
  function openRuin(siteId: number): void {
    const site = game.landscape.sites?.[siteId];
    // (Sandbox has no ruins: none is ever made there.)
    if (!site || site.cleared || mode !== "game") return;
    interaction.clearSelection();
    ruinShown = siteId;
    hud.showRuinCard({ ...ruinCard(game.landscape, site, mode, (id) => progress.learned.has(id), workshopStock(game.world)), reach: canReach(siteId) ? null : RUIN_NO_WAY });
    audio.tap();
  }
  interaction.onRuinTap = openRuin;

  /**
   * Can track be laid to this ruin from the line (`trackCanReach`: a flood fill of the land)? Worked out as its card
   * opens, and again only when the land or the pieces have changed since.
   */
  let reachShown = { key: "", yes: true };
  function canReach(siteId: number): boolean {
    const key = `${siteId}:${game.landscape.grid.revision}:${game.layout.piecesVersion}`;
    if (key !== reachShown.key) reachShown = { key, yes: trackCanReach(game.world, siteId) };
    return reachShown.yes;
  }

  /** Can this ruin (a site of the map shown) be restored now (its card offers Restore)? Kept till a blueprint is learned. */
  const restorable = new WeakMap<object, { learned: number; yes: boolean }>();
  // Track held over a ruin: which, and what a tap on it offers ("An old farm is in the way: tap it to restore or
  // clear it"). Only while a piece is refused for a ruin; a few dozen squares looked at.
  interaction.ruinMessage = (type, flipped, pose) => {
    const c = poseCentre(type, flipped, pose);
    const site = game.landscape.sites?.[ruinNear(game.landscape, c.x, c.z)];
    if (!site || site.cleared) return null;
    let r = restorable.get(site);
    if (r?.learned !== progress.learned.size) {
      r = { learned: progress.learned.size, yes: mode === "game" && ruinCard(game.landscape, site, mode, (id) => progress.learned.has(id)).restore !== null };
      restorable.set(site, r);
    }
    return ruinInWay(site, r.yes);
  };

  /** "Clear the ruin": a few coins (Game mode) take it and its stub away, for track or an industry of your own. */
  function clearShownRuin(): void {
    if (ruinShown === -1) return;
    const t0 = performance.now();
    // (One undo step, as Restore is: undone, the ruin and its stub come back and the coins are given back.)
    const done = clearRuinEdit(game.world, editor, ruinShown, {
      pay: mode === "game" ? clearPayment(progress) : undefined,
      changed: () => {
        game.syncRuins();
        if (mode === "game") hud.setCoins(progress.coins);
      },
    });
    if ("why" in done) {
      hud.toast(done.why);
      audio.refuse();
      return;
    }
    ruinShown = -1;
    hud.hideCards();
    console.info(`Woodrail: ruin cleared in ${Math.round(performance.now() - t0)} ms`);
    hud.toast("Cleared");
    audio.putdown(true);
  }

  /**
   * How a restore is paid for and redrawn: Game mode's price (planks from the workshop's yard, coins from hand, as a new
   * industry's are), nothing in Sandbox; the ruins redrawn, and the coins, as it's done, undone or redone.
   */
  function restoreOptions(role: Parameters<typeof gamePayment>[2]): RestoreOptions {
    return {
      pay: mode === "game" ? gamePayment(game.world, progress, role) : undefined,
      footprint: game.propLibrary.footprint,
      changed: () => {
        game.syncRuins();
        if (mode !== "game") return;
        hud.setCoins(progress.coins);
        showWorkshop(true);
      },
    };
  }

  /** "Restore": the ruin's stub becomes its industry, in place (one undoable edit), for about half a new one's price. */
  function restoreShownRuin(): void {
    const site = ruinShown === -1 ? undefined : game.landscape.sites?.[ruinShown];
    if (!site) return;
    const t0 = performance.now();
    const done = restoreRuin(game.world, editor, site.id, restoreOptions(site.role));
    if ("why" in done) {
      hud.toast(done.why, false, 3200);
      audio.refuse();
      return;
    }
    const ms = performance.now() - t0;
    ruinShown = -1;
    hud.hideCards();
    console.info(`Woodrail: ruin restored in ${ms.toFixed(1)} ms (ruins tile rebuilt in ${game.ruinsView.lastBuildMs.toFixed(1)} ms)`);
    // What it makes, what to do next and where its goods go (from the recipes), once; a tap frames it.
    const at = game.layout.getPiece(done.pieceId)?.pose;
    // (Naming only the industries the player knows: learned, or one on the map.)
    const said = restoredText(site.role, (r) => knowsRole(r, progress.learned, (role) => game.economy.allDepots().some((d) => d.role === role)));
    hud.toast(said, true, 6000, at ? () => showSpot(yardMiddle(at)) : undefined);
    audio.putdown(true);
    if (mode === "game") {
      hud.refreshTrayBadges();
      scheduleSave();
    }
  }

  /**
   * A blueprint just learned opens old industries' ruins (Farming, an old farm): the one nearest the player's line is
   * named, in a toast that frames it when tapped ("Old farm by Larkfield can be restored").
   */
  function ruinOpened(tech: string): void {
    const sites = (game.landscape.sites ?? []).filter((s) => !s.cleared && siteBlueprint(s.role)?.id === tech);
    if (sites.length === 0) return;
    const fixed = new Set([...game.stations.values(), ...game.depots.values(), ...game.ruins.values()]);
    const line = [...game.layout.pieceIds()].filter((id) => !fixed.has(id)).map((id) => game.layout.getPiece(id)!.pose);
    const site = nearestRuin(game.landscape, sites[0].role, line.length > 0 ? line : game.landscape.towns.map((t) => t.station));
    if (!site) return;
    const place = { x: site.centre.x, z: site.centre.z };
    const text = `${ruinName(game.landscape, site)} can be restored`;
    journal.add({ kind: "event", text, place });
    goalsPanel.newsChanged();
    hud.toast(text, true, 4200, () => showRuin(site.id));
  }

  /** Frame a spot and ring it (a tapped toast: an old industry just restored). */
  function showSpot(at: { x: number; z: number }): void {
    flyTo({ x: at.x, z: at.z });
    const i = game.landscape.grid.cellAtWorld(at.x, at.z);
    const marks = goalMarks(game.scene, [{ x: at.x, y: i < 0 ? 0 : game.landscape.grid.groundY(i), z: at.z }]);
    if (marks) game.flourishes.add(marks);
    game.invalidate();
  }

  /** Frame a ruin and ring it (a tapped toast: "Old farm by Larkfield can be restored"). */
  function showRuin(siteId: number): void {
    const site = game.landscape.sites?.[siteId];
    if (!site || site.cleared) return;
    flyTo({ x: site.centre.x, z: site.centre.z });
    const i = game.landscape.grid.cellAtWorld(site.centre.x, site.centre.z);
    const marks = goalMarks(game.scene, [{ x: site.centre.x, y: i < 0 ? 0 : game.landscape.grid.groundY(i), z: site.centre.z }]);
    if (marks) game.flourishes.add(marks);
    game.invalidate();
  }

  function buyLand(): void {
    if (lowering) {
      lowerChosen();
      return;
    }
    if (!chosen) return;
    // Game mode: land costs coins.
    const price = plotPrice(game.landscape.grid.plots.length, hasBank(game.landscape));
    if (mode === "game") {
      if (progress.coins < price) {
        hud.toast(`That land costs ${price} coins: you have ${progress.coins}. Towns pay for deliveries`, false, 3600);
        return;
      }
      progress.coins -= price;
      hud.setCoins(progress.coins);
    }
    const bought = game.unlockPlot(chosen.px, chosen.pz);
    if (!bought) return;
    const names = bought.towns.map((id) => game.landscape.towns[id].name);
    if (names.length > 0) {
      const stations = bought.towns.map((id) => game.landscape.towns[id].station);
      milestone({ kind: "milestone", text: `Welcome to ${names.join(" and ")}!`, place: placeOf(stations) });
    } else hud.toast("New land added");
    audio.chime();
    chosen = null;
    game.landscapeView.showForSale(plotsForSale(game.landscape));
    addLandCard();
    updateConnections(false);
    scheduleSave();
  }

  function setWorld(world: GameWorld): void {
    // (A drawn line lifted just before, waiting a frame to go down: down on the map it was drawn on.)
    interaction?.flushDraw();
    setExpanding(false);
    game.setWorld(world);
    water?.reset();
    shownDelivered = new Map();
    announced = new Set();
    updateConnections(false);
    game.follow(-1);
    editor = makeEditor();
    interaction.clearSelection();
    interaction.guideHeld(null);
    hud.hideCards();
    onChange();
  }

  /** Pairs already celebrated on this map: lifting and replacing a piece mustn't re-announce them. */
  let announced = new Set<string>();
  let timberHinted = false;
  function updateConnections(announce: boolean): void {
    const pairs = connectedPairs(game.layout, game.stations);
    game.landscapeView.setConnected(new Set<number>(pairs.flat()));
    const name = (id: number) => game.landscape.towns.find((t) => t.id === id)?.name ?? "?";
    const fresh = pairs.filter(([a, b]) => !announced.has(`${a}-${b}`));
    for (const [a, b] of fresh) announced.add(`${a}-${b}`);
    if (!announce || fresh.length === 0) return;
    const station = (id: number) => game.landscape.towns.find((t) => t.id === id)?.station;
    const ends = fresh[0].map(station).filter((p) => !!p);
    milestone({ kind: "milestone", text: fresh.map(([a, b]) => `${name(a)} ↔ ${name(b)}`).join(", ") + " connected!", place: ends.length > 0 ? placeOf(ends) : undefined });
    audio.chime();
    // After the first connection, point at the next thing to try (once, and only if there's no timber train yet). Game
    // mode's goals do this there.
    if (!timberHinted && mode === "sandbox" && game.landscape.depots.length > 0) {
      timberHinted = true;
      window.setTimeout(() => {
        let hasTimber = false;
        for (const t of game.sim.trains()) if (t.cars.some((c) => c.kind === "timber")) hasTimber = true;
        if (!hasTimber) hud.toast("Try a flatbed train: forest logs → sawmill → planks for the towns", false, 6000);
      }, 3500);
    }
    game.flourishes.add(game.landscapeView.flash(fresh.flat()));
  }

  function onChange(): void {
    // Track laid to a secret finds it: its halt is laid, a stop from now on (src/game/secrets.ts).
    secrets?.trackChanged();
    game.trackChanged();
    industriesChanged();
    // Game mode: squares of town newly dug under (a metro's tunnels) are paid for now they're down (checked first:
    // `digWhy`, in the site rule).
    if (mode === "game") {
      const paid = settleDigging(progress, squaresDugUnder(game.world));
      if (paid > 0) {
        hud.setCoins(progress.coins);
        hud.toast(`Dug under the town: ${paid}🪙`, false, 2200);
      }
    }
    updateConnections(true);
    checkGoals(true);
    hud.setHistory(editor.canUndo, editor.canRedo);
    scheduleSave();
  }

  /** Railway snapshots for a player who shares them (stats/snapshots.ts): Game mode, once they're two goals in. */
  const snapshots = new Snapshots({
    stats,
    storage: (() => {
      try {
        return localStorage;
      } catch {
        return null;
      }
    })(),
    mapText: async () => {
      if (mode !== "game" || !playing) return null;
      save();
      return mapText("game");
    },
    // (Not keepalive: a map can be past its 64 KB. text/plain keeps it a simple request, no preflight.)
    send: (to, body) => void fetch(to, { method: "POST", body, headers: { "Content-Type": "text/plain" } }).catch(() => {}),
    now: () => Date.now(),
    later: (fn, ms) => setTimeout(fn, ms),
  });
  const goalDone = (id: string) => goals.isDone(id);
  /** Game mode's progress as last saved (null: not yet, in this mode's railway), to tell when it's changed. */
  let progressSig: string | null = null;

  /**
   * Save soon after a change. `kind`: the player's edit (`layout`), or the game's progress (deliveries, research,
   * boats, growth): what the cloud sends, and which wins a conflict (`CloudSync`). The 5 s save of the clock and the
   * trains rolling on isn't an edit.
   */
  function scheduleSave(kind: EditKind = "layout"): void {
    // (The first time the player builds, cloud saves come on by themselves, unless they turned them off: an edit of
    // theirs, one they could undo. A new map, the game's own deliveries and growth, aren't.)
    if (kind === "layout" && editor.canUndo) cloud?.autoOn();
    cloud?.edited(mode, kind);
    if (kind === "layout" && mode === "game") snapshots.edited(goalDone, () => goals.doneCount);
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, 600);
  }

  /** The menu's "Copy map for a bug report": saved first, then the mode's save as text on the clipboard. */
  async function copyMap(): Promise<void> {
    save();
    try {
      await navigator.clipboard.writeText(await mapText(mode));
      hud.toast("Copied — paste it to us");
    } catch {
      hud.toast("Couldn't copy the map here");
    }
  }

  /** Save the railway under its mode (not while the title screen shows it turning behind: nothing is being played). */
  function save(): void {
    if (!playing) return;
    // (A drawn line lifted just before, waiting a frame to go down: down first, and saved with the rest.)
    interaction.flushDraw();
    saveToStorage(game.world, mode);
    saveSession(mode, { clock: game.simSeconds, paused: game.paused, journal: journal.toJSON() });
    if (mode === "game") {
      const data = progress.toJSON();
      saveProgress(data);
      // Progress the game made on its own (a delivery's coins, research studied, the first flour): an edit, of the
      // progress kind, though nothing called for a save (QA: delivery coins never went up).
      const sig = JSON.stringify(data);
      if (progressSig !== null && sig !== progressSig) cloud?.edited("game", "progress");
      progressSig = sig;
    }
  }

  /** The railway's date in the top bar (Game mode), from the game's clock: shown as it turns (asked about once a second). */
  function showDate(): void {
    hud.setDate(mode === "game" ? dateText(game.simSeconds) : null);
  }

  /**
   * The world just loaded is the mode's saved one (`fromSave`): its clock, pause and Journal back as they were saved
   * with it; else (a fresh map) they start afresh, the pause as it was.
   */
  function restoreSession(m: GameMode, fromSave: boolean): void {
    const s = fromSave ? loadSession(m) : null;
    game.simSeconds = s?.clock ?? 0;
    // A loaded clock is another session's time, not study done here (nor making, nor sailing).
    studyClock.at = null;
    craftClock.at = null;
    harbourClock.at = null;
    showDate();
    if (s) journal.restore(s.journal);
    else journal.clear();
    // A v12 Game save's offers: drawn again as cards on its own map.
    if (m === "game" && fromSave && redrawOldOffers(progress, game.world, Math.random)) saveProgress(progress.toJSON());
    if (s) {
      game.paused = s.paused;
      pausedBeforeTitle = s.paused;
      hud.setPaused(s.paused);
    }
    goalsPanel.newsChanged();
  }
  /** False while the title is up. */
  let playing = false;
  /** When this stretch of play began (in view, a mode open), for the stats' "end" (ms), or null: not playing. */
  let stretchFrom: number | null = null;
  /** A stretch of play over (left for the title, or the page hidden): how long it was, in the stats. */
  function endStretch(): void {
    if (stretchFrom === null) return;
    const minutes = Math.round((performance.now() - stretchFrom) / 6000) / 10;
    stretchFrom = null;
    if (minutes > 0) stats.record({ e: "end", mode, minutes });
  }
  /** Asked once (see `askStats`); in Sandbox, which has no goals, after a while of play. */
  let statsAskTimer = 0;
  const SANDBOX_ASK_MS = 10 * 60_000;

  // Save train positions periodically and when the page is hidden.
  setInterval(save, 5000);
  // Hidden, or leaving the page (closed, reloaded: some browsers report only one of the two, Chrome both): saved
  // once on the way out, and again only after the page has been back in view.
  let savedOnLeaving = false;
  const saveOnLeaving = () => {
    if (savedOnLeaving) return;
    savedOnLeaving = true;
    save();
    void cloud?.flush(true);
    endStretch();
    stats.flush(true);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveOnLeaving();
    else {
      savedOnLeaving = false;
      if (playing) stretchFrom = performance.now();
    }
  });
  addEventListener("pagehide", saveOnLeaving);
  addEventListener("pageshow", () => (savedOnLeaving = false));
  // Back online: what's waiting goes up.
  addEventListener("online", () => void cloud?.flush());

  // The drawing lost (WebGL context: on a phone, most often short of memory): saved at once, lean from the next load
  // (render/quality.ts), and if it isn't back in a moment, a card to reload (the railway kept).
  const lostCard = new ContextLostCard(() => {
    if (playing) {
      saveOnLeaving();
      reloadInto(mode);
    } else location.reload();
  });
  crashDrawing = () => ({ pixelRatio: game.renderer.getPixelRatio(), quality: `${game.quality.tier}${game.quality.lean ? "-lean" : ""}` });
  game.onContextLost = () => {
    crashes?.report("context-lost", { message: "WebGL context lost" });
    noteContextLost();
    save();
    lostCard.lost(game.restoreInPlace);
  };
  // (A scene that can't be uploaded again keeps the card: only a reload brings it back.)
  game.onContextRestored = () => {
    if (game.restoreInPlace) lostCard.restored();
  };

  /**
   * The title's "Load a cloud save" (a build with a cloud): the cloud card's code entry over the title, Cancel back to
   * it. Loaded, the game starts on that railway (Game's, else Sandbox's).
   */
  let titleCloud: CloudCard | null = null;
  const loadCloud = cloud
    ? () => {
        titleCloud ??= new CloudCard(title.root, cloud, {
          mode: () => "game",
          reload: () => reloadInto(hasSave("game") ? "game" : "sandbox"),
          toast: (m) => hud.toast(m),
        });
        title.root.classList.add("cloud-open");
        titleCloud.showEntry(() => title.root.classList.remove("cloud-open"));
      }
    : undefined;
  const newGameSheet = new NewGameSheet(document.body);
  /**
   * The new-game screen for a new map in `next` mode: its seed (`newMapSeed`: the starter map's for a first game), the
   * dice's fresh ones, and what Start does with the choices and the seed.
   */
  function askNewMap(next: GameMode, warn: string | undefined, start: (c: NewGameChoices, seed: number) => void): void {
    newGameSheet.open({ mode: next, seed: newMapSeed(next === "game"), roll: () => newMapSeed(false), warn, start });
  }
  // The title's New game and New map ask what the map's to be like first (the new-game screen), then make it.
  const title = new TitleScreen(document.body, { play: (next, fresh) => (fresh ? askNewMap(next, undefined, (c, seed) => play(next, true, c, seed)) : play(next, false)), loadCloud, continueCloud: cloud ? continueCloud : undefined }, { thumbnails });

  /** The cloud railways the title offers (cloud-known.ts), from what's remembered: no waiting on the cloud. */
  function showCloudOffers(): void {
    if (cloud) title.setCloudOffers(titleOffers(cloud.known.list(), cloud.currentCode(), SAVE_VERSION));
  }
  /** The remembered codes asked of the cloud again, once a page, in the background: the offers redrawn if they changed. */
  let knownRefreshed = false;
  function refreshCloudOffers(): void {
    showCloudOffers();
    if (!cloud || knownRefreshed) return;
    knownRefreshed = true;
    void cloud.refreshKnown().then((changed) => changed && title.shown && showCloudOffers(), () => {});
  }

  /**
   * The title's "Continue from cloud": under the code in use, the mode's copy checked again with the start-up check's
   * rules (newer wins, the other kept as the backup); under a code used before, that code taken up again (this device's
   * railways kept as backups), as the cloud card's Load does. Either way the game starts again on what storage holds.
   */
  async function continueCloud(offer: TitleOffer): Promise<string | void> {
    if (!cloud) return;
    const offline = "Can't reach the cloud right now. Try again soon.";
    if (offer.current) {
      const res = await cloud.takeNewer(offer.mode);
      if (!res.ok) return res.error === "offline" ? offline : res.error === "newer" ? "Saved by a newer version of the game: update this one first" : "Still saving: try again in a moment";
      if (res.changed) {
        try {
          if (res.note) sessionStorage.setItem(CLOUD_NOTE_KEY, JSON.stringify({ mode: offer.mode, note: res.note }));
        } catch {
          // (Not said.)
        }
        reloadInto(offer.mode);
        return;
      }
      // (This device's own was the later: nothing taken, nothing lost.)
      if (res.note) cloudNotes[offer.mode] = res.note;
      play(offer.mode, false);
      return;
    }
    const res = await cloud.useCode(offer.code);
    if (res.ok) {
      reloadInto(res.took.includes(offer.mode) ? offer.mode : (res.took[0] ?? offer.mode));
      return;
    }
    if (res.error === "nothing") {
      cloud.known.forget(offer.code);
      // (Redrawn a moment later: the message is read first.)
      setTimeout(showCloudOffers, 4000);
      return "That railway isn't saved online any more";
    }
    return res.error === "newer" ? "Saved by a newer version of the game: update this one first" : offline;
  }

  /** Paused or not when the title came up (the game pauses behind the title, so the still backdrop costs nothing). */
  let pausedBeforeTitle = false;

  /** The title is up over the opening screen (at start-up), not over the map: the map shows once a mode is chosen. */
  let overOpening = false;
  /** A mode was chosen on the opening screen, and the map is about to be built. */
  let leaving = false;

  /** At start-up: the title over the opening screen (its toys behind the cards), the map built and waiting unseen. */
  function showTitleOverOpening(): void {
    overOpening = true;
    playing = false;
    hud.setVisible(false);
    pausedBeforeTitle = game.paused;
    game.paused = true;
    loading?.classList.add("behind-title");
    title.root.classList.add("over-opening");
    // (Its cards wait unseen, and can't be pressed, till they're placed: moved under a finger, a tap on Continue
    // ended on the card round it and did nothing (QA).)
    title.root.classList.add("placing");
    title.show({ sandbox: hasSave("sandbox"), game: hasSave("game") }, { sandbox: hasOlderSave("sandbox"), game: hasOlderSave("game") });
    refreshCloudOffers();
    // Of the loading screen's toys, just the train stays, right where it is, under the name: the cards come in below it.
    toys?.showTrainOnly();
    settleHop();
    placeCards();
    addEventListener("resize", refreshToys);
  }
  /** Loaded: the name's letters stop hopping (each finishes the hop it's in), so the title screen sits still. */
  function settleHop(): void {
    for (const block of loading?.querySelectorAll<HTMLElement>(".wb") ?? []) {
      for (const a of block.getAnimations()) {
        const done = a.effect?.getComputedTiming().currentIteration;
        if (typeof done === "number") a.effect?.updateTiming({ iterations: done + 1 });
      }
    }
  }
  /**
   * The title over the opening screen, laid out once the train's drawn (the next frame): the name, the train and the
   * cards as one group in the middle of the screen. The name and the train glide there (moved whole: the train is
   * never drawn afresh); the cards fade in below.
   */
  const glide: { name: number; train: number } = { name: 0, train: 0 };
  function placeCards(): void {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!overOpening) return;
        const name = loading?.querySelector<HTMLElement>("h1");
        const canvas = loading?.querySelector<HTMLElement>(".loading-toys");
        const span = toys?.trainSpan;
        const cards = title.root.querySelector<HTMLElement>(".title-cards");
        if (!name || !canvas || !span || !cards) {
          title.root.style.paddingTop = `${Math.round(innerHeight * 0.4)}px`;
          title.root.classList.remove("placing");
          return;
        }
        // Where they'd be unmoved.
        const n = name.getBoundingClientRect();
        const nameTop = n.top - glide.name;
        const trainTop = span.top - glide.train;
        const trainH = span.bottom - span.top;
        const gap = Math.min(28, innerHeight * 0.03);
        // On a short screen (a phone on its side) the train gives up its place, so the cards' buttons stay on screen.
        const withTrain = n.height + gap + trainH + gap + cards.offsetHeight <= innerHeight - 12;
        const trainSlot = withTrain ? trainH + gap : 0;
        const total = n.height + gap + trainSlot + cards.offsetHeight;
        const top = Math.max(12, (innerHeight - total) / 2);
        glide.name = top - nameTop;
        glide.train = top + n.height + gap - trainTop;
        for (const [el, dy] of [
          [name, glide.name],
          [canvas, glide.train],
        ] as const) {
          el.style.transition = "transform 0.7s cubic-bezier(0.3, 0.7, 0.2, 1), opacity 0.4s";
          el.style.transform = `translateY(${Math.round(dy)}px)`;
        }
        canvas.style.opacity = withTrain ? "" : "0";
        title.root.style.paddingTop = `${Math.round(top + n.height + gap + trainSlot)}px`;
        title.root.classList.remove("placing");
      }),
    );
  }
  const refreshToys = () => {
    toys?.refresh();
    placeCards();
  };

  /**
   * The loading screen fades out (0.6 s) and is then taken out of the page, its toys and its letters' hop with it
   * (left in, merely transparent, the hop would keep the page restyling every frame).
   */
  function dismissLoading(): void {
    loading?.classList.add("done");
    setTimeout(() => {
      toys?.stop();
      if (loading) loading.style.display = "none";
    }, 700);
  }

  /** The opening screen goes (fading over the map) once a mode is chosen. */
  function leaveOpening(): void {
    if (!overOpening) return;
    overOpening = false;
    title.root.classList.remove("over-opening", "placing");
    title.root.style.paddingTop = "";
    dismissLoading();
    removeEventListener("resize", refreshToys);
  }

  /** Save, then show the title over a still, wide view of the map. */
  function showTitle(): void {
    endStretch();
    clearTimeout(statsAskTimer);
    closeMap(false);
    setBoardOpen(false);
    sheet.show(null);
    sheet.setWaiting(0);
    save();
    playing = false;
    clearTimeout(saveTimer);
    interaction.clearSelection();
    hud.hideCards();
    hud.setVisible(false);
    game.follow(-1);
    // The land as it is now (it may have grown), within the camera's reach.
    const e = game.landscape.grid.extent();
    const radius = Math.hypot(e.x1 - e.x0, e.z1 - e.z0) / 2;
    const distance = Math.min(frameDistance(radius * 0.8, game.camera.fov, game.camera.aspect), game.controls.maxDistance);
    game.director.glideTo(new Vector3((e.x0 + e.x1) / 2, 0, (e.z0 + e.z1) / 2), distance, { phi: 0.9, duration: 1.4 });
    pausedBeforeTitle = game.paused;
    game.paused = true;
    title.show({ sandbox: hasSave("sandbox"), game: hasSave("game") }, { sandbox: hasOlderSave("sandbox"), game: hasOlderSave("game") });
    refreshCloudOffers();
  }

  // Game mode's goals: checked about once a second and after every change to the track.
  let goals = new GoalTracker(loadGoals());
  // Stickers: earned with the goals' check, from the start (quietly till the core goals are done).
  let stickers = new StickerTracker(loadStickers());
  /** The stickers seen in their tab (the chip's dot is for the rest), and whether the tab is out yet (core goals done). */
  let stickersSeen = new Set(loadStickersSeen());
  let stickersOpen = false;
  /** Feature tips (src/game/feature-tips.ts): a 💡 row under the goals for a system just learned, till it's used. */
  let tips = ((t) => new TipTracker(t.done, t.shown))(loadTips());
  // The Journal: what happened (events: quiet, with an unread bell) and what was achieved (milestones: also toasted).
  // Refusals aren't logged: they stay plain `hud.toast`s.
  // On game time: "2 min ago" means two minutes of play (it stands still while paused).
  const journal = new Journal(() => game.simSeconds * 1000);
  const goalsPanel = new GoalsPanel(
    hud.root,
    {
      showMe: () => showGoal(),
      fly: (place) => flyTo(place),
      stickersSeen: () => {
        stickersSeen = new Set(stickers.ids());
        saveStickersSeen([...stickersSeen]);
        showStickers();
      },
      showTip: () => showTip(),
      showGrand: (id) => showGrandSite(id),
      tipDone: (id) => {
        tips.finish(id);
        saveTips(tips.toJSON());
        checkGoals(false);
      },
    },
    journal,
  );
  /** Glide to a place (a News entry's, a toast's). Several spots (new houses, two stations) are framed together, closer than a lone spot. */
  function flyTo(place: JournalPlace): void {
    const spots = place.points ?? [place];
    const f = frameAlong(spots, game.camera.fov, game.camera.aspect, place.points ? PLACE_MARGIN : GOAL_MARGIN);
    const pts = spots.map((q) => new Vector3(q.x, 0, q.z));
    frameInRoom(pts, Math.min(f.distance, game.controls.maxDistance), game.controls.maxDistance, pts.length);
  }
  /** Report something in Game mode: logged in the Journal (not in Sandbox); a milestone is also toasted. */
  function note(n: NoteInput, ms?: number, hold = false): JournalEntry | null {
    if (mode !== "game") return null;
    const r = journal.add(n);
    goalsPanel.newsChanged();
    // (`hold`: the caller toasts it itself, after folding something else into it.)
    if (r.toast && !hold) hud.toast(n.text, true, ms);
    return r.entry;
  }
  /** A milestone that is toasted in both modes (land, connections) and logged in Game mode. */
  function milestone(n: NoteInput, ms?: number): void {
    if (mode === "game") note(n, ms);
    else hud.toast(n.text, true, ms);
  }
  /** A place made of these spots: their centre, to be framed together. */
  function placeOf(points: readonly { x: number; z: number }[]): JournalPlace {
    const xs = points.map((p) => p.x);
    const zs = points.map((p) => p.z);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, z: (Math.min(...zs) + Math.max(...zs)) / 2, points: points.map((p) => ({ x: p.x, z: p.z })) };
  }
  /** The latest growth milestone (game s, clock ms): a goal ticked within a moment of it joins its entry. */
  let growth: { entry: JournalEntry; at: number; wallAt: number } | null = null;
  const depotPlace = (depotId: number) => {
    const d = game.economy.depot(depotId);
    const p = d && game.layout.getPiece(d.pieceId)?.pose;
    return p ? { x: p.x, z: p.z } : undefined;
  };

  // Delivery vans (roads spec D5): a station on the line serves a town off it by road (src/game/delivery-vans.ts).
  const deliveryVans = new DeliveryVans({ world: game, vans: game.vans, knows: () => mode === "game" && progress.learned.has("vans"), lacks: (t, k) => townLife.lacks(t, k) });
  // Buses (roads spec D6): a bus stop beside a station brings people from a town off the line (src/game/buses.ts).
  const buses = new Buses({ world: game, vans: game.vans, knows: () => mode === "game" && progress.learned.has("buses"), room: () => waitingCap(progress) });
  // A town's own cars (tech tree 3): the cars brought to it by car carrier drive about its streets (src/game/town-cars.ts).
  const townCars = new TownCars({ world: game, vans: game.vans, knows: () => mode === "game" });
  // Game mode's towns: they want things, and grow when they get them.
  const townLife = new TownLife(game, {
    knows: (tech) => progress.learned.has(tech),
    // A school takes only what the research still lacks (a lookup: the crane asks for every unit).
    // (A research that must be studied at a College or a University: only such a school takes its goods.)
    // (With Reading room, the research up next's goods too: `wants`.)
    school: (kind, d) => researchWants(progress, kind, (id) => schoolTakesFor(game.world, d, progress.learned, id)) > 0,
    // A station's delivery van takes what the town off the line it serves wants (roads spec D5).
    vanTakes: (d, kind) => deliveryVans.takes(d, kind),
    vanYard: (d) => deliveryVans.yardFilled(d),
    vanShare: (d) => deliveryVans.share(d),
    // A place's last goods are in (or a treat bought): it stands in the town now (game/places.ts).
    placeBuilt: (town, place, at) => placeUp(town, place, at),
    placeStuck: (town, place) => hud.toast(`${place.name}: no room in ${town.name} yet. It goes up as soon as there is.`, false, 4200),
    // A city's grand project had goods: a stage may be done (src/game/grand.ts).
    grandGoods: () => advanceGrand(),
    received: (town, kind, n, before) => {
      const firstFlour = !progress.firstFlour;
      payDelivery(progress, kind, n, before, town);
      hud.setCoins(progress.coins);
      if (firstFlour && progress.firstFlour) note({ kind: "milestone", text: `First flour! ${town.name} pays a ${FIRST_FLOUR_BONUS}🪙 bonus`, place: { x: town.station.x, z: town.station.z } }, 3600);
      // The first milk, bread or fruit any town has had (the dairy chain, the orchard): a milestone, once a game.
      let total = 0;
      for (const bag of game.economy.deliveredGoods.values()) total += bag[kind] ?? 0;
      const food = firstFoodNews(kind, n, total, town.name);
      if (food) note({ kind: "milestone", text: food, place: { x: town.station.x, z: town.station.z } }, 3600);
      // (A routine delivery isn't news: the coins and the town's card show it. The News keeps what changes things.)
    },
    grew: (town, status, built) => {
      const here = { x: town.station.x, z: town.station.z };
      // More touches of life in it.
      game.touchLevelsVersion++;
      // Its new houses may have felled trees a harvester counted.
      industriesChanged();
      // A landmark may have gone up (a school, a market, a library): what it opens comes with it.
      const before = new Set(progress.landmarks);
      syncLandmarks();
      // Folded into the growth's own line, after it: one new landmark with what it does, several by name.
      const raised = [...progress.landmarks].filter((id) => !before.has(id)).flatMap((id) => landmarkOf(id) ?? []);
      const landmarks =
        raised.length === 1 ? `New ${raised[0].name.toLowerCase()}: ${raised[0].blurb}` : raised.length > 1 ? `New ${raised.map((m) => m.name.toLowerCase()).join(", ")}` : "";
      // Its school grows with it: a college (twice as fast), a library wing (tier-3 research).
      const school = placedSchools(game.world).find((d) => d.townId === town.id);
      const grade = school && schoolGrade(game.world, school, progress.learned);
      const schoolNews = !grade ? "" : grade.wing && status.level === 3 ? "Its school has a library wing: advanced research opens" : grade.college && status.level === 2 ? "Its school is now a college: research 2× as fast" : "";
      const level = aOrAn(status.name.toLowerCase());
      // The first village, town and city each bring a present; a town that grows offers three cards to pick one from
      // (planks, coins, a crate, a wagon, a research boost, rare cargo: never a blueprint).
      const gift = firstTimeGift(progress, status.level);
      if (gift.length > 0) hud.refreshTrayBadges();
      const offer = offerOnGrowth(progress, game.world, town.name, status.level, Math.random);
      const extras = [landmarks, schoolNews, gift.length > 0 ? `Present: ${describeThings(gift)}` : "", offer ? "Pick a reward" : ""].filter(Boolean);
      const grew = built.length > 0 ? `${town.name} grew into ${level}!` : `${town.name} is now ${level}, but has no room to build`;
      const where = built.length > 0 ? placeOf(built) : here;
      if (extras.length > 0) {
        // A first, a present or a landmark: a moment. A one-line toast; the News entry has the rest, and the goal it
        // ticks joins that entry.
        const entry = note({ kind: "milestone", text: `${grew} ${extras.join(" · ")}`, place: where }, 5200, true);
        growth = entry ? { entry, at: game.simSeconds, wallAt: performance.now() } : null;
        // ("Larkfield is a town! Pick a reward": a tap on it opens the sheet.)
        if (entry) hud.toast(`${built.length > 0 ? `${town.name} is ${level}!` : grew}${offer ? " Pick a reward" : ""}`, true, 3200, offer ? () => openRewards() : undefined);
        checkGoals(true);
        growth = entry ? { entry, at: game.simSeconds, wallAt: performance.now() } : null;
      } else {
        note({ kind: "event", text: grew, place: where });
        checkGoals(true); // (its tick is logged after the growth)
      }
      audio.chime();
      // (A town grown is the game's progress, gift or not.)
      cloud?.edited(mode, "progress");
      if (gift.length > 0 || offer) {
        refreshBoard();
        scheduleSave("progress");
      }
      // The sheet comes up for it, unless a finger's on the map (a drag isn't cut short) or a panel's open: then the
      // toast and the badge wait for a tap.
      if (offer && !interaction.busy && !board.open && !mapView.open && !sheet.open) openRewards();
      else refreshRewards();
      game.flourishes.add(game.landscapeView.flash([town.id]));
      const grid = game.landscape.grid;
      const marks = goalMarks(
        game.scene,
        built.map((p) => {
          const i = grid.cellAtWorld(p.x, p.z);
          return { ...p, y: i < 0 ? 0 : grid.groundY(i) };
        }),
        SQUARE_RING,
      );
      if (marks) game.flourishes.add(marks);
      game.invalidate();
    },
  });
  /** When goals were last checked (wall-clock ms: frame times are capped, so slow frames would stretch a dt sum). */
  let goalsCheckedAt = 0;
  /** The latest goals ticked, a moment apart at most: their News entry and toast take the next one in (see `GoalTicks`). */
  let ticks = new GoalTicks();
  let ticksToasted = false;
  /** Stickers earned now (in `checkGoals`, so about once a second; each is checked only when what it reads changed). */
  function checkStickers(announce: boolean, ticked: boolean): void {
    // Shown once the core goals are all done: till then earned quietly (a dot on the chip), then one toast a check.
    const open = goals.current() === null && goals.lockedCount === 0;
    const loud = announce && open && stickersOpen;
    const fresh = stickers.update(game.world, { coins: progress.coins, counts: progress.counts, learned: progress.learned, goalsDone: (id) => goals.isDone(id) }, goals.doneCount, loud ? 1 : Infinity);
    if (fresh.length > 0) {
      saveStickers(stickers.ids());
      cloud?.edited(mode, "progress");
    }
    if (open && !stickersOpen) {
      stickersOpen = true;
      // Said only as the last goal is ticked (after its own toast: the toasts queue), not on a load of a finished game.
      if (announce && ticked) {
        const n = stickers.count;
        const text = n > 0 ? `🌟 Stickers! You've earned ${n} already. Tap to see them` : "🌟 Stickers! Collect them as you play. Tap to see them";
        if (note({ kind: "milestone", text: n > 0 ? `Stickers open: you've earned ${n}` : "Stickers open" }, 5200, true)) hud.toast(text, true, 5200, () => goalsPanel.openStickers());
      }
    } else if (loud) {
      for (const s of fresh) if (note({ kind: "milestone", text: `🌟 Sticker: ${s.title}` }, 3600, true)) hud.toast(`🌟 Sticker: ${s.title}!`, true, 3600, () => goalsPanel.openStickers(s.id));
    }
    showStickers();
  }
  function showStickers(): void {
    const earned = stickers.ids();
    goalsPanel.setStickers({ earned, unseen: earned.filter((id) => !stickersSeen.has(id)), open: stickersOpen });
  }
  function checkGoals(announce: boolean): void {
    if (mode !== "game" || !playing) return;
    const ctx = { learned: progress.learned, owned: progress.owned, orders: progress.orders };
    const fresh = goals.update(game.world, ctx);
    if (fresh.length > 0) {
      // (A goal that pays coins pays them as it's ticked: "Buy some land".)
      if (fresh.reduce((n, g) => n + payGoal(progress, g), 0) > 0) {
        hud.setCoins(progress.coins);
        scheduleSave("progress");
      }
      // (A goal done: its guide's markers no longer hold a piece, and the tray rings what the next one asks for.)
      interaction.guideSpots = [];
      hud.refreshTrayBadges();
      saveGoals(goals.ids());
      cloud?.edited(mode, "progress");
      if (announce) {
        for (const g of fresh) {
          stats.record({ e: "goal", id: g.id, n: goals.doneCount });
          snapshots.goal(g.id, goalDone, goals.doneCount);
        }
        // The first goal ticked: a moment later (after its toast), the one-time "Help improve" question.
        if (stats.shouldAsk) statsAskTimer = window.setTimeout(askStats, 3600);
        const titles = fresh.map(goalTickTitle);
        const tick = goalsDoneText(titles, TOAST_TITLES);
        if (growth && joins(growth, game.simSeconds, performance.now(), GROWTH_JOIN_S)) {
          // Right after a growth milestone: a toast of its own after the growth's. (Goals done aren't News: the Goals
          // tab ticks them.)
          hud.toast(tick, true, 3200);
        } else {
          // Goals ticked together (one a check, a moment apart): one line in the News and one toast.
          const say = ticks.tick(titles, game.simSeconds, performance.now(), (t) => hud.hasToast(t));
          // (Only toasted: the Goals tab ticks them, so the News doesn't say them again.)
          if (say.kind === "merge" && ticksToasted) hud.retoast(say.oldToast, say.toast, true, 3200);
          else if (mode === "game") {
            ticksToasted = true;
            hud.toast(say.toast, true, 3200);
          } else ticks.drop();
        }
        audio.chime();
        goalsPanel.celebrate();
      }
    }
    checkStickers(announce, fresh.length > 0);
    checkTips(announce);
    showAchievements();
    const current = goals.current();
    goalsPanel.show(goals.doneCount, current, current ? current.check(game.world, ctx) : null, goals.next(), goals.total, goals.lockedHint(), goals.lockedCount);
  }

  /** A ring line with a train on it (for its tip), by the lines' stops and the track: kept while they're the same. */
  let ringSeen: { key: string; id: number | null } = { key: "", id: null };
  function ringLineNow(): number | null {
    const e = game.economy;
    let key = `${game.layout.piecesVersion}`;
    for (const [id, line] of e.lines) key += `|${id}:${line.stops.map((st) => st.depotId).join(",")}`;
    if (key !== ringSeen.key) {
      let id: number | null = null;
      for (const [lineId, line] of e.lines) if (trainsOn(e, lineId).length > 0 && isRingLine(e, line.stops)) id = lineId;
      ringSeen = { key, id };
    }
    // (A line's trains come and go without its stops changing: asked each time, cheap.)
    return ringSeen.id !== null && trainsOn(e, ringSeen.id).length > 0 ? ringSeen.id : null;
  }
  /** A train waiting under a crane for a full load (its engine's car id), or null: Leave now's tip. */
  function waitingEngineNow(): number | null {
    for (const t of game.sim.trains()) {
      const engine = t.cars.find((c) => c.kind === "engine");
      if (engine && game.economy.waitingToFill(t.id)) return engine.id;
    }
    return null;
  }
  function tipContext(): TipContext {
    return {
      learned: progress.learned,
      goalDone: (id) => goals.isDone(id),
      queued: progress.research.next === null ? 0 : 1 + progress.research.later.length,
      // (Only looked for while their tips may show.)
      waitingEngine: tips.isDone("leave-now") ? null : waitingEngineNow(),
      ringLine: tips.isDone("ring-reverse") ? null : ringLineNow(),
    };
  }
  /**
   * The tips, with the goals (never per frame): one used goes; the first left that's useful shows under the goals. A
   * tip with no blueprint (Leave now, a ring line's Reverse) is toasted the first time it shows.
   */
  function checkTips(announce: boolean): void {
    const { first, changed } = tips.update(game.world, tipContext());
    if (changed) saveTips(tips.toJSON());
    if (first && announce) hud.toast(`💡 ${first.text}`, false, 6000, () => showTip());
    const t = tips.current();
    goalsPanel.setTip(t ? { id: t.id, title: t.title, text: t.text } : null);
  }

  // Game mode's toy box and workshop: what you own (worked out against what's on the map), and what's being made.
  // (A Game-mode map from an older version is turned away: its progress goes with it.)
  let progress = loadProgress() === undefined || hasOlderSave("game") ? Progress.fresh() : Progress.fromJSON(loadProgress());
  const crafting = new Crafting(progress);
  crafting.setProgress(progress);
  const thingLabel = (id: ThingId) => ruleOf(id)?.label ?? id;
  /** The kits and furniture on the Industries tab's railway shelves: the workshop's card lists them as "Railway". */
  const RAILWAY_THINGS = new Set(GAME_KIT_GROUPS.flatMap((g) => g.items.flatMap((i) => (i.kind === "piece" || i.kind === "prop" ? [...thingsFor(i).keys()] : []))));

  /**
   * Game mode: can this tray item come out (known, and enough of it in the toy box)? Says why not if not. What's
   * missing is made on the spot, unless `make` is false (only asking).
   */
  interaction.trayAllowed = (item) => trayAllowed(item);
  interaction.trayCanCarry = (item) => trayAllowed(item, false);
  // After the last of something in the toy box goes down, no next one waits at its end.
  interaction.trayHas = (item) => mode !== "game" || item.kind !== "piece" || progress.hasAnother(game.world, item);
  function trayAllowed(item: ThingItem | { kind: string }, make = true): boolean {
    // Not learned yet: how to unlock it, in plain words ("Switch: Research Switches to unlock"); a tap on the toast
    // opens Research there. (A tap on a locked tile shows its note instead: Hud.lockedTap. This is a drag out of it.)
    // A signal mark too, till Signals is learned (then it's free: no piece from the toy box, signals spec §4).
    const lock = lockOf(item);
    if (lock) {
      const how = unlockHow(progress, lock.tech);
      const jump = how.jump;
      hud.toast(`${lock.label}: ${how.text}`, false, 3600, jump ? () => setBoardOpen(true, jump) : undefined);
      return false;
    }
    if (mode !== "game" || (item.kind !== "piece" && item.kind !== "train" && item.kind !== "prop")) return true;
    // (A new take: whatever an earlier one made is settled, or never was.)
    if (make) trainMade = pieceMade = null;
    const needs = thingsFor(item as ThingItem);
    // None left of something it takes: all of what's missing is made on the spot from the workshop's yard, or none.
    const lack = lacking(game.world, progress, needs);
    if (lack.size === 0) return true;
    // One thing short: by its own name; more (a train's wagons): by the tray item's.
    const one = lack.size === 1 ? [...lack.values()][0] : 0;
    const label = one === 1 ? ruleOf([...lack.keys()][0])!.label : "label" in item && typeof item.label === "string" ? item.label : "That";
    // (A second engine before Signals: what it can't do yet, said as it's made. Asked before it's owned.)
    const engineNote = lack.has("car:engine") ? makeNote(progress, "car:engine") : null;
    const why = make ? craftNow(game.world, progress, lack) : craftShort(game.world, progress, lack);
    if (why === "no-workshop") {
      hud.toast(`No ${label.toLowerCase()} left. Place your workshop (Industries tab) to make more`, false, 3600);
      return false;
    }
    if (why) {
      const short = [total(why.goods) > 0 ? `${costTag(why.goods)} more at the workshop` : "", why.coins > 0 ? `${costTag({}, why.coins)} more` : ""].filter(Boolean).join(" and ");
      hud.toast(`${label}: needs ${short}`, false, 3600);
      return false;
    }
    if (!make) return true;
    // A train's cars are made as it's taken out: kept to be given back if it's dropped off the track.
    trainMade = item.kind === "train" ? lack : null;
    // A piece's is given back if it isn't put down (a first switch dragged out and let go where it can't go).
    pieceMade = item.kind === "piece" ? lack : null;
    const cost = costOf(lack);
    pieceRefund = pieceMade ? refundText(one === 1 ? label : describeThings([...lack]), cost.goods, cost.coins) : "";
    // "a switch", "3 flatbed wagons", or a whole train by its name.
    const made = one === 1 ? aOrAn(label.toLowerCase()) : one > 1 ? describeThings([...lack]).toLowerCase() : label.toLowerCase();
    const said = `Made ${made}: ${[total(cost.goods) > 0 ? `${costTag(cost.goods)} from the workshop` : "", cost.coins > 0 ? costTag({}, cost.coins) : ""].filter(Boolean).join(" and ")}${engineNote ? `. ${engineNote}` : ""}`;
    // A train's is said once it's on the track (dropped off it, nothing's made after all).
    if (trainMade) trainSaid = said;
    else if (pieceMade) pieceSaid = said;
    else hud.toast(said, false, 2600);
    afterCraft();
    return true;
  }

  /** What was made for the piece in hand (taken from the tray), until it's put down. */
  let pieceMade: Map<ThingId, number> | null = null;
  let pieceSaid = "";
  /** ...and what's said if it's given back ("Switch back in the box, 3\uE000 returned"). */
  let pieceRefund = "";
  interaction.onTrayPieceDropped = (placed) => {
    const made = pieceMade;
    const said = pieceSaid;
    const refund = pieceRefund;
    pieceMade = null;
    pieceSaid = pieceRefund = "";
    if (!made || mode !== "game") return;
    if (placed) {
      hud.toast(said, false, 2600);
      return;
    }
    uncraft(game.world, progress, made);
    afterCraft();
    hud.toast(refund, false, 2600);
  };
  /** The cars made for the train in hand (taken from the tray), until it's put down. */
  let trainMade: Map<ThingId, number> | null = null;
  let trainSaid = "";
  interaction.onTrayTrainDropped = (placed) => {
    if (placed) hud.trayPlaced();
    const made = trainMade;
    const said = trainSaid;
    trainMade = null;
    trainSaid = "";
    if (!made || mode !== "game") return;
    if (placed) {
      hud.toast(said, false, 2600);
      return;
    }
    // Missed the track (or back over the tray): nothing was used, so nothing's spent.
    uncraft(game.world, progress, made);
    afterCraft();
  };

  /** Something was made from the tray: the toy box's counts and the coins change. */
  function afterCraft(): void {
    hud.setCoins(progress.coins);
    hud.refreshTrayBadges();
    showWorkshop(true);
    scheduleSave();
  }

  /**
   * What keeps a tray item locked (Game mode): the blueprint to learn, and the name to say it by (the train's look, or
   * the thing not known yet: "Switch"), or null if it isn't locked.
   */
  function lockOf(item: ThingItem | TrayItem | { kind: string }): { tech: string; label: string } | null {
    // (A signal mark: locked till Signals is learned, as its tray badge says; its note and toast open Research there.)
    if (mode === "game" && item.kind === "signal") return progress.knows("piece:signal") ? null : { tech: ruleOf("piece:signal")!.tech!, label: ruleOf("piece:signal")!.label };
    if (mode !== "game" || (item.kind !== "piece" && item.kind !== "train" && item.kind !== "prop")) return null;
    const look = lockedLook(item);
    if (look) return { tech: look, label: "label" in item && typeof item.label === "string" ? item.label : techOf(look)!.label };
    for (const id of thingsFor(item as ThingItem).keys()) {
      const tech = ruleOf(id)?.tech;
      if (tech && !progress.knows(id)) return { tech, label: ruleOf(id)!.label };
    }
    return null;
  }

  /** A train item in a look whose blueprint isn't learned yet (a dining car, an express engine): that blueprint. */
  function lockedLook(item: { kind: string; looks?: readonly CarLook[] }): string | null {
    if (item.kind !== "train") return null;
    for (const look of item.looks ?? []) {
      const tech = LOOK_TECH[look];
      if (tech && !progress.learned.has(tech)) return tech;
    }
    return null;
  }

  /** Game mode: how many of a track piece the player could put down now (0 if not learned); see `pieceStock`. */
  const pieceStock = (type: PieceTypeId): number => supplyOf(progress, game.world, type);
  /** Game mode: a track piece not learned yet, as the tray says it, or null. */
  const pieceUnlearned = (type: PieceTypeId): string | null => unlearnedOf(progress, type);

  /** Why `added` more road squares can't go down now (coins short for those beyond the box), or null. */
  function roadRefusal(added: number): string | null {
    const price = roadsPrice(progress.roads, roadsOnMap(game.landscape.grid), added);
    return price > progress.coins ? roadShortText(price, progress.coins) : null;
  }

  /**
   * Road squares on the map beyond those owned are bought (`ROAD_COINS` each), after a road edit, its undo or redo
   * (each checked first: `roadRefusal`). Taken up, they go back in the box, free to lay again, as track does.
   */
  function settleRoads(): void {
    const buy = roadsOnMap(game.landscape.grid) - progress.roads;
    if (buy > 0) {
      progress.roads += buy;
      progress.coins = Math.max(0, progress.coins - buy * ROAD_COINS);
      hud.setCoins(progress.coins);
      hud.toast(`Laid ${buy === 1 ? "a square of road" : `${buy} squares of road`}: ${buy * ROAD_COINS}🪙`, false, 2200);
    }
    hud.refreshTrayBadges();
  }

  /** The toy box on the tray (Game mode): how many of each are left. */
  function trayBadge(item: ThingItem | TrayItem | { kind: string }): { text: string; empty: boolean; attention?: boolean; craft?: boolean; locked?: boolean } | null {
    // A road piece: the squares in the box, or (none left) what the next one costs.
    if (item.kind === "road") {
      const spare = roadsSpare(progress.roads, roadsOnMap(game.landscape.grid));
      return spare > 0 ? { text: String(spare), empty: false } : { text: `${ROAD_COINS}🪙`, empty: false, craft: true };
    }
    // (A signal mark: free once Signals is learned, signals spec §4.)
    if (item.kind === "signal") return progress.knows("piece:signal") ? null : { text: "Locked", empty: true, locked: true };
    if (item.kind !== "piece" && item.kind !== "train" && item.kind !== "prop") return null;
    const needs = thingsFor(item as ThingItem);
    if ([...needs.keys()].some((id) => !progress.knows(id)) || lockedLook(item)) return { text: "Locked", empty: true, locked: true };
    // (Free things, a crossing style among them once it's learned: no count.)
    if ([...needs.keys()].every(isFree)) return null;
    let n = Infinity;
    for (const [id, k] of needs) n = Math.min(n, Math.floor(progress.available(game.world, id) / k));
    // What the current goal asks to place, while none is on the map (the school for "Place a school by a town").
    const attention = n > 0 && "type" in item && item.type === trayRing(goals.current(), game.world);
    // None left, but a workshop to make more: what one costs (taken from its yard on the spot).
    if (n === 0 && workshops(game.world).length > 0) {
      const lack = lacking(game.world, progress, needs);
      if (lack.size > 0) {
        const cost = costOf(lack);
        return { text: trayCostTag(cost.goods, cost.coins), empty: false, craft: true };
      }
    }
    return { text: String(n), empty: n === 0, ...(attention ? { attention } : {}) };
  }

  /**
   * A school's yard wears what it has grown into with its town (spec §1): a schoolhouse; a college once College is
   * learned and its town is a town; a library (its wing) beside a city. Each the catalogue's model, built on first ask
   * and drawn at a size that fits the yard (the yards are drawn again once it's in, a stand-in till then). The yards are
   * drawn again when a school's grade changes (`schoolGradesKey`), never per frame.
   */
  const SCHOOL_MODELS = { house: { asset: "bldg-school", scale: 1 }, college: { asset: "bldg-college", scale: 0.84 }, wing: { asset: "bldg-library", scale: 0.8 } };
  function schoolHouse(role: string, depot?: DepotState): { parts: PropModel["parts"]; scale: number } | null | undefined {
    if (role !== "school") return null;
    const grade = depot && mode === "game" ? schoolGrade(game.world, depot, progress.learned) : null;
    const { asset, scale } = grade?.wing ? SCHOOL_MODELS.wing : grade?.college ? SCHOOL_MODELS.college : SCHOOL_MODELS.house;
    // (A clock's model bare of its hands: they're drawn apart, at the real time, by `ClockView`.)
    const key = drawnKey(asset);
    const m = game.propLibrary.model(key);
    if (m === undefined)
      void game.propLibrary.load(key).then(
        () => {
          game.depotView.setWorld(game.economy, game.layout);
          game.invalidate();
        },
        () => {},
      );
    return m && { parts: m.parts, scale, ...(CLOCK_ASSETS.has(asset) ? { clock: modelKey(asset) } : {}) };
  }

  /**
   * A catalogue model for an industry's yard (the dairy's, the bakery's, the orchard's trees): loaded on first use, then
   * the yards are drawn again once (never per frame).
   */
  function yardModel(asset: string): { parts: PropModel["parts"] } | null | undefined {
    const m = game.propLibrary.model(asset);
    // (Each asset waited for once, however many yards ask for it while it loads; the yards drawn again once when the
    // last of those loading is in, not once an asset and a yard: each `setWorld` builds every yard on the map.)
    if (m === undefined && !yardsLoading.has(asset)) {
      yardsLoading.add(asset);
      const done = () => {
        yardsLoading.delete(asset);
        if (yardsLoading.size > 0) return;
        game.depotView.setWorld(game.economy, game.layout);
        game.invalidate();
      };
      void game.propLibrary.load(asset).then(done, done);
    }
    return m;
  }
  /** Catalogue models yards are waiting for (`yardModel`). */
  const yardsLoading = new Set<string>();

  /** Industries placed or moved: give new ones their depots, and redraw the yards where they stand. */
  let industryKey = "";
  /** How the yards look (`industriesChanged`), as last drawn: null, never drawn by it. */
  let industryLook: string | null = null;
  /** Each metro train's seconds since it last drew a coal (metro.ts). */
  const metroClock = new Map<number, number>();
  function industriesChanged(): void {
    const added = syncIndustries(game.world, mode === "game");
    let key = "";
    for (const id of game.layout.pieceIds()) {
      const p = game.layout.getPiece(id)!;
      if (INDUSTRY_ROLE[p.type]) key += `${id}:${p.pose.x},${p.pose.z},${p.pose.heading};`;
    }
    // Upgrades put a machine in their yards (Game mode): the yards are drawn again when one is learned.
    // Schools wear what they've grown into (a college, a library wing): drawn again only when that changes.
    // (How every yard looks: all drawn again when it changes; a placement alone redraws only its own.)
    const look = `#${mode === "game" ? upgradeKey(progress) : ""}#${mode === "game" ? schoolGradesKey(game.world, progress.learned) : ""}`;
    key += look;
    game.depotView.extras = mode === "game" ? (role) => machinesFor(progress, role) : null;
    // A town's touches of life grow in number with its level (Game mode's; Sandbox's towns go by their size).
    if ((game.touchLevel !== null) !== (mode === "game")) {
      game.touchLevel = mode === "game" ? (town) => statusOf(game.world, town.id).level : null;
      game.touchLevelsVersion++;
    }
    game.depotView.building = schoolHouse;
    game.depotView.catalogueModel = yardModel;
    if (added || key !== industryKey) {
      if (look === industryLook) game.depotView.syncSites(game.economy, game.layout);
      else game.depotView.setWorld(game.economy, game.layout);
      industryLook = look;
      // (An open card's chain names the nearest places: one placed or taken up may change them.)
      if (key !== industryKey) interaction.redrawDepotCard();
    }
    // A town's station upgraded in place (or back, by undo): only its goods corner drawn again.
    else if (game.depotView.syncStations(game.economy, game.layout)) game.invalidate();
    // A depot given another track (or back, by undo): only its crane drawn again, spanning them all.
    if (game.depotView.syncTracks(game.economy, game.layout)) game.invalidate();
    industryKey = key;
    // Industries work as fast as what's around them allows: recounted when they move or the land changes.
    // (Props too: trees planted from Nature count for a harvester.)
    // (And powered yards, Game mode's sparks: a yard with one works `POWERED_RATE` times as fast.)
    const grid = mode === "game" ? powerOf(game.world) : null;
    const rateKey = `${key}#${game.landscape.grid.revision}#${game.world.props.version}#${mode === "game" ? upgradeKey(progress) : ""}#${grid ? [...grid.current.yardsOn].join(",") : ""}`;
    if (rateKey !== rateKeyShown) {
      rateKeyShown = rateKey;
      if (updateRates(game.world, grid ? (role, d) => boostOf(progress, role) * (grid.yardOn(d.id) ? POWERED_RATE : 1) : undefined)) game.invalidate();
    }
    hud.refreshTrayBadges();
    // A school placed (or taken up), or grown with its town: tier 3 may open, study may go faster, and the pill shows
    // (or says to pick research), or goes.
    if (mode === "game") syncLandmarks();
    refreshPill();
  }
  let rateKeyShown = "";

  const workshopPanel = new WorkshopPanel(hud.depotExtra, {
    // (The goals hear of it at once: "Make a switch" says its planks are on their way, with nothing else to redraw.)
    order: (id) => {
      crafting.order(id);
      showWorkshop(true);
      checkGoals(true);
      scheduleSave();
    },
    cancel: (id) => {
      crafting.cancel(id);
      showWorkshop(true);
      checkGoals(true);
      scheduleSave();
    },
    // Shares with towns / Takes all planks: only the card is drawn again (nothing on the map changes till a train comes).
    takesAll: (on) => {
      const id = interaction.openDepotId;
      if (game.economy.depot(id)?.role !== "workshop") return;
      game.economy.setTakesAll(id, on);
      showWorkshop();
      scheduleSave();
    },
    // Its keep steppers: a step from the number shown, or back to the game's own (Auto). Only the card is drawn again.
    keep: (kind, step) => {
      const d = game.economy.depot(interaction.openDepotId);
      if (d?.role !== "workshop") return;
      const row = keepRowsOf(d).find((r) => r.kind === kind);
      if (!row) return;
      game.economy.setKeep(d.id, kind, step === "auto" ? null : row.n + step);
      showWorkshop();
      scheduleSave();
    },
  }, hud.depotYard);
  /**
   * The workshop's keep steppers: planks (the game's own: its spare, `yardSpare`), and iron once a foundry's known or
   * the yard holds some (the game's own: all of it).
   */
  function keepRowsOf(d: DepotState): KeepRow[] {
    const cap = capAt(d);
    const rows: KeepRow[] = [];
    const planks = d.keeps[CARGO.planks.index];
    rows.push({ kind: "planks", label: "planks", n: Math.min(cap, planks ?? yardSpare.planks), set: planks !== null, max: cap, auto: "Auto" });
    if (progress.knows("piece:depot-foundry") || d.piles[CARGO.iron.index] > 0) {
      const iron = d.keeps[CARGO.iron.index];
      rows.push({ kind: "iron", label: "iron", n: iron ?? cap, set: iron !== null, max: cap, auto: "All" });
    }
    return rows;
  }
  // The Research picker: the whole tree, each blueprint researched at a school. Its code is loaded the first time it's
  // opened (`setBoardOpen`); till then `board` stands in, shut.
  let boardImpl: BlueprintBoard | null = null;
  let boardLoading = false;
  const board = {
    get open(): boolean {
      return boardImpl?.open ?? false;
    },
    pictureCame: (key: string) => boardImpl?.pictureCame(key),
  };
  const boardHandlers: BlueprintBoardHandlers = {
    pick: (id) => picked(id, toggleQueue),
    now: (id) => picked(id, startNow),
    close: () => setBoardOpen(false),
    // (Over the board: Back or ✕ shuts the help, and the board is as it was.)
    help: (ref) => hud.showExplainer(ref),
    picture: (key) => thumbnails.get(key),
    // A kit's, a prop's or a car's picture is drawn on demand if it isn't yet, as for the tray (the cars' and the other
    // pieces' are drawn at start-up, or with Game mode's models), before the tray's; none once the board's shut ([]).
    needPictures: (keys) =>
      wantPictures(
        keys.flatMap((k): TrayItem[] => {
          if (k.startsWith("prop:")) return [{ kind: "prop", asset: k.slice(5), label: "" }];
          if (k.startsWith("train:")) return TRAIN_ITEMS.filter((t) => trayKey(t) === k);
          const type = k.slice(6) as PieceTypeId;
          return k.startsWith("piece:") && kitOf(type) ? [{ kind: "piece", type, label: "" }] : [];
        }),
        "board",
      ),
  };

  /**
   * The growth menu: a bottom sheet with the first town's offer waiting ("Larkfield grew! Pick one", three cards), one
   * tap to take a card. Closed, the offer keeps (the badge and the growth toast open it again).
   */
  const sheet = new GrowthSheet(document.body, {
    take: (i) => {
      const o = progress.offers[0];
      const card = o?.cards[i];
      if (!card) return;
      const took = takeCard(progress, game.world, 0, i);
      if (!took) return;
      if (card.kind === "boost" || card.kind === "rare") {
        // Goods into the research: schools take less now (routed trains plan again), and the pill moves.
        game.economy.acceptsChanged();
        refreshPill();
      }
      if (card.kind === "planks") game.invalidate(); // (the yard's pile grows)
      if (card.kind === "crate" || card.kind === "wagon") hud.refreshTrayBadges();
      hud.setCoins(progress.coins);
      note({ kind: "milestone", text: `${o.from}'s reward: ${took.taken ?? took.amount}${card.kind === "crate" ? ` (${took.line})` : ""}` }, 3200);
      audio.chime();
      if (board.open) refreshBoard();
      save();
      cloud?.edited(mode);
      // The next offer waiting, if any; else the sheet closes.
      if (progress.offers.length > 0) refreshRewards();
      else closeRewards();
    },
    close: () => closeRewards(),
    reopen: () => openRewards(),
  });
  /** Open the growth sheet on the first offer waiting (none: nothing). */
  function openRewards(): void {
    if (mode !== "game" || progress.offers.length === 0) return;
    if (board.open) setBoardOpen(false);
    if (mapView.open) closeMap(false);
    interaction.clearSelection();
    hud.hideCards();
    sheetView();
  }
  function closeRewards(): void {
    sheet.show(null);
    sheet.setWaiting(mode === "game" ? progress.offers.length : 0);
  }
  /** The sheet (if open) and the badge, as the offers stand now. */
  function refreshRewards(): void {
    if (sheet.open) sheetView();
    else sheet.setWaiting(mode === "game" ? progress.offers.length : 0);
  }
  function sheetView(): void {
    if (progress.offers.length === 0) return closeRewards();
    const o = progress.offers[0];
    sheet.show({ title: sheetTitle(progress.offers), cards: o.cards.map((c) => cardView(progress, game.world, c)), more: progress.offers.length - 1 });
    sheet.setWaiting(progress.offers.length);
  }

  /** A blueprint learned. `next`: the research the queue moved on to (`researched`), named in the same toast. */
  function learned(id: string, next?: string): void {
    // Delivery vans: each station serving a town off the line by road gets its van now.
    if (id === "vans") deliveryVans.sync();
    if (id === "buses") buses.sync();
    if (id === "tunnels") game.setTunnels(true);
    const makes = unlocksOf(id).filter((t) => !isGift(t)).map((t) => ruleOf(t)!.label);
    const t = techOf(id)!;
    // Signals bring a second engine (into the toy box): a passing loop with signals lets two trains share the line.
    const gift = learnGift(progress, id);
    // A College or a University (tech tree 3): a school may have just become one (`schoolLandmarks`).
    if (mode === "game" && (id === "college" || id === "university")) syncLandmarks();
    const present = gift.length > 0 ? ` · Present: ${describeThings(gift)}` : "";
    // A goal it opens is named ("Run two trains at once" opened unseen behind the current goal), with where the
    // second engine is, or that one's to be made.
    const opened = goals.openedBy(id, progress.learned);
    const tip = opened.some((g) => g.id === "two-trains") ? secondEngineTip(progress.available(game.world, "car:engine"), progress.owned.get("car:engine") ?? 0) : "";
    // (A feature says how to start using it: audit F4, "Tap a train, then Plan a route".)
    const goalLine = opened.length > 0 ? `New goal: ${opened.map((g) => g.title).join(", ")}${tip ? `. ${tip}` : ""}` : "";
    // A system with a tip (feature-tips.ts) says how to start using it, once, on its toast (the tip then waits under the goals).
    const tipText = tipFor(id)?.text;
    const said = learnedText({ label: t.label, makes: makes.length > 0 ? makesLine(makes) : "", how: t.how, blurb: t.blurb, present, goal: goalLine, tip: tipText, next: next && techOf(next)?.label });
    // Two News lines (what was learned, then the goal it opens), one toast saying both (and what's studied next).
    note({ kind: "milestone", text: said.line }, 3800, true);
    if (goalLine) note({ kind: "milestone", text: goalLine }, 0, true);
    if (mode === "game") hud.toast(said.toast, true, goalLine || next || said.tipped ? 5200 : 3800);
    // A place's blueprint: plain buildings already standing in its model become it, free (game/places.ts).
    if (mode === "game") openPlaces(id);
    // An upgrade takes effect at once: industries' rates and the cranes.
    applyCranes(game.economy, progress);
    industriesChanged();
    audio.chime();
    hud.refreshTrayBadges();
    hud.trayLearned();
    game.invalidate();
    refreshBoard();
    // The goals card at once: a goal it opened counts (and "Research Signals to unlock a goal" goes).
    if (opened.length > 0) checkGoals(true);
    // Old industries' ruins it opens: the nearest is named, to restore.
    ruinOpened(id);
    save();
    cloud?.edited(mode, "progress");
  }

  /** The school research goods go to: one beside a town, by name ("Larkfield school"), or null if none is placed. */
  function schoolName(): string | null {
    // (The research under way must be studied at a College or a University: the school that is one.)
    const schools = game.economy.allDepots().filter((x) => x.role === "school");
    const d = schools.find((x) => atSchool(game.world, x, progress)) ?? schools[0];
    return d ? depotName(game.world, d) : null;
  }
  /** Is a school placed (a lookup over the depots, which are kept in a list till the track changes)? */
  function hasSchool(): boolean {
    return game.economy.allDepots().some((x) => x.role === "school");
  }

  /**
   * A research's button in the picker (#14): `toggleQueue` (it starts, joins the queue, or is taken out of it) or
   * `startNow` (one in the queue swaps in for the one under way). The card and the pill show it; a toast only when
   * taking one out took others that need it too ("Removed Mills and Bakery too").
   */
  function picked(id: string, how: (p: Progress, id: string) => unknown): void {
    if (!hasSchool()) return;
    if (how === toggleQueue && queuePlace(progress.research, id) > 0) {
      // Taken out of the queue, with every queued one that needs it: say which went too.
      const also = dequeue(progress, id);
      if (also.length > 0) hud.toast(removedText(also), false, 3500);
    } else if (!how(progress, id)) return;
    // What schools take has changed: routed trains plan again.
    game.economy.acceptsChanged();
    hud.setCoins(progress.coins);
    refreshBoard();
    refreshPill();
    scheduleSave();
  }

  /**
   * The HUD's research pill, redrawn only when what it shows may have changed (a pick, a delivery, a second of study,
   * a school placed, coins while one waits for them): asked on the workshop's clock and on those events, never per frame.
   */
  function refreshPill(): void {
    if (mode !== "game") {
      pillKeyShown = "";
      pillFor = null;
      hud.setResearchPill(null);
      return;
    }
    const school = hasSchool();
    const key = pillKey(progress, school);
    if (key === pillKeyShown && pillFor === progress) return;
    pillKeyShown = key;
    pillFor = progress;
    hud.setResearchPill(pillView(progress, school));
  }

  /** A research finished: learned, with what it brings, and the next one started if it could be. */
  function researched(id: string): void {
    game.economy.acceptsChanged();
    hud.setCoins(progress.coins);
    // (What's studied next is said in the learned one's toast: one toast, not two.)
    learned(id, progress.research.current ?? undefined);
    // Nothing under way or up next: the school's idle, said once (a tap opens the picker). The pill and the school's
    // card show it from then on.
    const idle = idleNotice.finished(progress, id, schoolName());
    if (idle) hud.toast(idle, false, 6000, () => board.open || setBoardOpen(true));
  }
  const idleNotice = new IdleNotice();

  /** The school's card: the research's goods (got of needed), and what it's at. Its key changes with the research. */
  interaction.schoolCard = { key: () => schoolCardKey(progress), show: () => schoolCard(progress) };

  /** Open or close the Research picker; `on`: open on that card ("Show me" for a goal's research). */
  function setBoardOpen(open: boolean, on?: string): void {
    if (open && !boardImpl) {
      // (Its code fetched the first time, then opened as asked: a second ask while it loads waits on the first.)
      if (boardLoading) return;
      boardLoading = true;
      void import("./ui/blueprint-board").then(({ BlueprintBoard }) => {
        boardImpl = new BlueprintBoard(document.body, boardHandlers);
        setBoardOpen(true, on);
      });
      return;
    }
    if (!boardImpl) return refreshBoard();
    if (open && mapView.open) closeMap(false);
    boardImpl.setOpen(open);
    if (open && on) boardImpl.focus(on);
    hud.root.classList.toggle("board-open", open);
    if (open) {
      interaction.clearSelection();
      hud.hideCards();
    }
    refreshBoard();
  }

  /**
   * What a blueprint makes, as the picker's ticket shows it: worked out once per blueprint (it never changes, and its
   * drawings are the bulk of the picker's view). Pieces (kits and industries among them) and props as their tray
   * pictures, as the tray shows them (a thing's id is its tray key); their drawings stand in till those are drawn. A car
   * as its tray card's picture (the car on its own, in its own look), its drawing standing in.
   */
  const makesCache = new Map<string, Station["makes"]>();
  function makesOf(t: (typeof TECHS)[number]): Station["makes"] {
    let makes = makesCache.get(t.id);
    if (makes) return makes;
    makes = unlocksOf(t.id).map((x) =>
      x.startsWith("piece:")
        ? { label: ruleOf(x)!.label, icon: pieceIcon(x.slice(6) as PieceTypeId), picture: x }
        : x.startsWith("prop:")
          ? { label: ruleOf(x)!.label, icon: `<span class="bp-pending"></span>`, picture: x }
          : { label: ruleOf(x)!.label, icon: trainIcon([x.slice(4) as CarKind]), picture: carPictureKey(x.slice(4) as CarKind) },
    );
    if (t.feature) makes.push({ label: t.feature.label, icon: `<span class="bp-feature">${t.feature.icon}</span>` });
    if (makes.length === 0) makes.push({ label: t.brings, icon: `<span class="bp-feature">✨</span>` });
    makesCache.set(t.id, makes);
    return makes;
  }

  /**
   * A station's `makes`, worked out when the board first reads it (only the selected ticket shows them, and the
   * pictures for every blueprint were 40 ms of the first tap at 4× CPU): a getter, left out of the board's keys and of
   * spreads (not enumerable).
   */
  function withMakes(station: Station, t: (typeof TECHS)[number]): Station {
    Object.defineProperty(station, "makes", { get: () => makesOf(t), enumerable: false, configurable: true });
    return station;
  }

  const PLAN_WORDS: Record<Plan, string> = { next: "Coming soon: next on the list", soon: "Coming soon", later: "Coming one day", ending: "The ending: coming one day" };

  function refreshBoard(): void {
    hud.setBoardButton(board.open);
    if (!board.open) return;
    boardKeyShown = boardKey();
    const school = schoolName();
    // The goal's research: the picker opens on it while nothing is under way, its button ringed (never picked for you).
    const goalTech = goals.current()?.blueprint;
    const seen = seenOf(progress);
    /** A need, and for a College or a University what to do for one: "a College: grow Larkfield into a town". */
    const needHow = (n: Need): string => {
      const level = n.kind === "landmark" ? (n.id === COLLEGE_SCHOOL_ID ? "college" : n.id === UNIVERSITY_SCHOOL_ID ? "university" : null) : null;
      return level ? `${describeNeed(n)}: ${schoolHowTo(game.world, progress.learned, level)}` : describeNeed(n);
    };
    const stations: Station[] = TECHS.map((t) => withMakes(stationOf(t), t));
    function stationOf(t: (typeof TECHS)[number]): Station {
      // (Its `makes` put on after, when it's asked for: see `withMakes`.)
      const makes: Station["makes"] = [];
      const requires = t.requires.map((n) => ({ text: describeNeed(n) + (n.kind === "count" && n.stat === "riders" ? ` (${progress.riders} so far)` : ""), met: needMet(progress, n) }));
      // Its price is its research: every good brought to a school, and from tier 2 coins (left out once paid: one
      // started and set aside keeps them).
      const cost = costOfResearch(t.id, progress.learned);
      const price = costTag(cost.goods as Bag, progress.research.held.has(t.id) ? 0 : cost.coins) || "free";
      const base = { id: t.id, label: t.label, blurb: t.blurb, branch: t.branch, makes, needs: [...t.needs], seen: seen.get(t.id)!, price, cost: costWords(progress, t.id), unlocks: unlocksWords(t.id), requires };
      const state = cardState(progress, t.id);
      if (state === "learned") return { ...base, state };
      if (state === "soon") return { ...base, state, waits: PLAN_WORDS[t.plan!] };
      const research = researchCard(progress, t.id, school);
      if (research) return { ...base, state, research, ...(state === "next" ? { queued: queuePlace(progress.research, t.id) } : {}), ...(t.id === goalTech && state !== "researching" ? { goal: true } : {}) };
      const missing = t.needs.filter((n) => !progress.learned.has(n));
      const unmet = t.requires.filter((n) => !needMet(progress, n));
      const waits =
        missing.length > 0
          ? `Research ${missing.map((n) => techOf(n)!.label.toLowerCase()).join(" and ")} first`
          : unmet.length > 0
            ? `Needs ${unmet.map(needHow).join(" and ")}`
            : "Later";
      // Locked till you have the school it's studied at (tech tree 3): its tag says which.
      const gate = t.school && unmet.includes(SCHOOL_NEED[t.school]) ? (t.school === "university" ? "University" : "College") : undefined;
      // Else, with what it needs learned, the first thing it waits for (a city, goods delivered), not a price it can't
      // be bought for yet (QA 2026-11-05 #5).
      const other = !gate && missing.length === 0 ? unmet[0] : undefined;
      return { ...base, state: "locked" as const, waits, ...(gate ? { school: gate } : other ? { gate: other.kind === "delivered" && GOODS_ICON[other.good as CargoKind] ? `${GOODS_ICON[other.good as CargoKind]} ${other.n} ${other.good}` : needTag(other) } : {}) };
    }
    const focus = goalPick(progress, goalTech, school !== null);
    boardImpl?.show({
      stations,
      branches: BRANCHES.map((b) => ({ id: b.id, label: b.label, color: b.color })),
      ...(focus ? { focus } : {}),
    });
  }
  /**
   * What the open picker shows depends on (beyond a tray picture coming): see `pickerKey`. The workshop's clock rebuilds
   * it only when this changes.
   */
  function boardKey(): string {
    return pickerKey(progress, schoolName(), goals.current()?.id ?? "");
  }

  /** People coming to stations, on game time (see `simElapsed`). */
  const peopleSeconds: StudyClock = { at: null };
  /**
   * The time control (src/game/time-scale.ts): the speeds open (Clockmaker, Clock tower), the HUD's clock showing the
   * speed. Outside Game mode, or a speed no longer open, back to 1×. Cheap: called once a second and on a tap.
   */
  function syncSpeed(): void {
    const open = mode === "game" ? speedsOpen(progress, game.landscape.towns) : [1 as const];
    if (!open.includes(game.timeScale as 1)) game.timeScale = 1;
    hud.setSpeed(game.timeScale, open.length > 1, nextSpeed(game.timeScale, open));
  }
  // A phone too slow for the speed: a speed slower, said.
  game.onTooSlow = () => {
    game.timeScale = slower(game.timeScale);
    hud.toast(`Your phone is working hard: back to ${game.timeScale}×`, false, 3600);
    syncSpeed();
  };

  // The workshop's clock: a few times a second, not every frame (it runs while nothing on screen moves).
  const CRAFT_STEP = 0.25;
  /** The research's study clock, on the world's game time (see `simElapsed`). */
  const studyClock: StudyClock = { at: null };
  /**
   * The workshop's and the harbour boats' clocks, on game time too: a hidden tab (no frames, so no game time) or a
   * paused game makes nothing and trades nothing, as its trains deliver nothing (cloud saves: two devices both earning
   * only when both are in view).
   */
  const craftClock: StudyClock = { at: null };
  const harbourClock: StudyClock = { at: null };
  /**
   * What the map gives research, from the map: the towns' landmarks, a school beside a city (tier 3), and how fast the
   * schools study (a college: twice as fast). Asked when industries, towns or what's learned change, not per frame.
   */
  function syncLandmarks(): void {
    progress.landmarks.clear();
    for (const id of landmarksAt(game.world, progress.learned)) progress.landmarks.add(id);
    setSpeed(progress, researchSpeed(game.world, progress.learned));
  }
  setInterval(() => {
    syncSpeed();
    if (mode === "game" && board.open && boardKey() !== boardKeyShown) refreshBoard();
    if (mode === "game") refreshPill();
    showDate();
    // The growth sheet, while it's open: its cards say what they'd give now (the yards fill, the research moves on);
    // closed, the badge's count. (Written only when what they show changes.)
    if (mode === "game") refreshRewards();
    // Research: the study clock, and Next up starting once its coins are in (a few lookups when nothing happens). Study
    // runs on game time (the trains' clock), not this timer's; read on every step so time off the game isn't counted.
    const studied = simElapsed(studyClock, game.simSeconds);
    if (mode === "game" && playing && !game.paused) {
      const coins = progress.coins;
      const was = progress.research.current;
      const done = researchTick(progress, studied);
      if (progress.coins !== coins) hud.setCoins(progress.coins);
      if (done) researched(done);
      else if (progress.research.current !== was) {
        // Next up started (its coins came in): schools take its goods now.
        game.economy.acceptsChanged();
        scheduleSave("progress");
      }
    }
    // (Read on every step, as the study clock is, so time off the game isn't counted.)
    const crafted = simElapsed(craftClock, game.simSeconds);
    if (mode !== "game" || !playing || game.paused || progress.orders.length === 0 || crafted <= 0) return;
    const wasMaking = progress.making;
    const coinsBefore = progress.coins;
    const made = crafting.tick(game.world, crafted);
    if (progress.coins !== coinsBefore) hud.setCoins(progress.coins);
    showWorkshop();
    // Planks leave the yard when an order starts: draw the pile going down (only then, not on every step).
    if (made || progress.making !== wasMaking) game.invalidate();
    if (!made) return;
    // (A second engine before Signals: what it can't do yet, as when it's made from the tray.)
    const said = madeText(progress, made, thingLabel(made));
    hud.toast(said, true, said.length > 40 ? 3600 : 2400);
    audio.chime();
    hud.refreshTrayBadges();
    scheduleSave("progress");
  }, CRAFT_STEP * 1000);
  // A farm yard's card (Game mode): its fields, how fast that makes it work, and a field to plant with coins.
  let farmShown = "";
  function showFarm(): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.depot(id);
    const piece = d && d.role === "farm" ? game.layout.getPiece(d.pieceId) : undefined;
    if (!d || !piece) {
      farmShown = "";
      return;
    }
    const r = resourceAt(game.landscape, "farm", piece.pose)!;
    const price = fieldPrice(progress.fieldsPlanted);
    const key = `${id}:${r.count}:${price}:${progress.coins >= price}`;
    if (key === farmShown) return;
    farmShown = key;
    const box = hud.depotExtra;
    box.hidden = false;
    box.innerHTML = "";
    const line = document.createElement("div");
    line.className = "farm-fields";
    const speed = Math.round(rateFor(r.count, r.need) * 100);
    // (In whole fields, as the player sees them: `amountText`. Short of full speed, how to get there.)
    line.textContent = `Farm fields nearby: ${amountText(r.rule, r.count)} of ${amountText(r.rule, r.need)} (works at ${speed}% speed)${r.count < r.need ? ". Plant a field to work faster" : ""}`;
    const plant = document.createElement("button");
    plant.className = "chip text farm-plant";
    plant.textContent = `Plant a field · ${costTag({}, price)}`;
    plant.title = "A field of crops on open grass near this yard (trees there are felled)";
    plant.disabled = progress.coins < price;
    plant.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = game.layout.getPiece(d.pieceId);
      if (!p || progress.coins < fieldPrice(progress.fieldsPlanted)) return;
      const editor = new LandEditor(game.landscape, game.layout, { inRect: (x0, z0, x1, z1) => propsInRect(game.props, (a) => game.footprintOf(a), x0, z0, x1, z1) });
      const cells = fieldSpot(game.landscape, editor, yardMiddle(p.pose), SITE_RULES.farm!.reach);
      if (!cells) {
        hud.toast("No open grass near this farm yard for a field");
        return;
      }
      progress.coins -= fieldPrice(progress.fieldsPlanted);
      progress.fieldsPlanted++;
      game.editLand(plantField(game.landscape, cells));
      industriesChanged();
      hud.setCoins(progress.coins);
      hud.toast("A field planted: more grain for the farm yard", true);
      audio.chime();
      showFarm();
      scheduleSave();
    });
    box.append(line, plant);
  }

  // Passengers (Game mode): people turn up at stations, coaches carry them, fares are paid, and the passenger line of
  // blueprints is learned as you carry more.
  const peopleClock = new Map<number, number>();
  const counters = new Counters();
  const warnedHeavy = new Set<number>();
  // Harbours (Game mode): boats call by themselves and buy what's on the quay.
  const harbourTrade = new HarbourTrade();
  // Airports' planes (late-game spec A1): their clocks are game time, moved on once a second; the view poses the
  // planes from them on frames drawn anyway.
  const airports = new Airports();
  /** The airports the view draws planes for, kept till the map's pieces change. */
  let airportsAt: { key: string; list: AirportAt[] } = { key: "", list: [] };
  game.planeSource = {
    airports: () => {
      if (mode !== "game") return [];
      const key = `${game.layout.revision}|${game.economy.allDepots().length}`;
      if (key !== airportsAt.key) {
        const list: AirportAt[] = [];
        for (const d of airportsOf(game.world)) {
          const piece = game.layout.getPiece(d.pieceId)!;
          list.push({ id: d.id, pose: piece.pose, y: piece.y });
        }
        airportsAt = { key, list };
      }
      return airportsAt.list;
    },
    phase: (id) => airports.phase(id, airports.lastUpdate < 0 ? 0 : game.simSeconds - airports.lastUpdate),
    place: planePose,
  };
  // Airships at masts (late-game spec B1): their tours by the game's clock, moved on once a second.
  const airships = new Airships();
  let mastsAt: { key: string; list: MastAt[] } = { key: "", list: [] };
  /** A mast's sights (counted as its tour takes off, and for its card while it's open). */
  const sightsOf = (d: DepotState) => {
    const piece = game.layout.getPiece(d.pieceId)!;
    return tourSights(game.world, yardPoint(piece.pose, MAST.t, MAST.l));
  };
  game.shipSource = {
    masts: () => {
      if (mode !== "game") return [];
      const key = `${game.layout.revision}|${game.economy.allDepots().length}`;
      if (key !== mastsAt.key) {
        const list: MastAt[] = [];
        for (const d of mastsOf(game.world)) {
          const piece = game.layout.getPiece(d.pieceId)!;
          list.push({ id: d.id, pose: piece.pose, y: piece.y });
        }
        mastsAt = { key, list };
      }
      return mastsAt.list;
    },
    phase: (id) => airships.phase(id, airships.lastUpdate < 0 ? 0 : game.simSeconds - airships.lastUpdate),
    radius: TOUR_RADIUS,
    height: TOUR_HEIGHT,
  };
  // River barges (Game mode): the player's boats, their cards and planning (src/ui/water-controls.ts).
  water = attachWater({
    game,
    hud,
    interaction,
    progress: () => progress,
    isGame: () => mode === "game",
    saved: () => scheduleSave(),
    paid: () => scheduleSave("progress"),
  });
  // Secrets on the map (Game mode): found by laying track to them, their cards, midsummer (src/ui/secret-controls.ts).
  secrets = attachSecrets({
    game,
    hud,
    interaction,
    progress: () => progress,
    found: () => {
      audio.chime();
      scheduleSave();
    },
  });
  function passengersOn(): void {
    peopleClock.clear();
    harbourTrade.reset();
    counters.reset(game.economy);
    applyCranes(game.economy, progress);
    attachEngines(game.world, () => progress.learned.has("boilers"));
    // Goods brought to a school go into the research (saved soon after: a train brings them in a burst).
    attachResearch(
      game.economy,
      () => progress,
      () => {
        refreshPill();
        scheduleSave("progress");
      },
      (d, id) => schoolTakesFor(game.world, d, progress.learned, id),
    );
    attachPassengers(
      game.world,
      () => progress,
      (_fare, from, to) => {
        hud.setCoins(progress.coins);
        scheduleSave("progress");
        // (A rider through a city building Grand Central counts toward its last stage: src/game/grand.ts.)
        if (game.economy.grandPlans.size > 0 && countRider(game.world, from.townId, to.townId)) advanceGrand();
        // (A tourist trip to a secret is counted on its site, in the land: saved with the world.)
        if (secretOfStop(game.world, to)) scheduleSave();
      },
      // (Visitors' seasons go by the railway's calendar.)
      () => dateOf(game.simSeconds).month,
      () => dateOf(game.simSeconds).year,
    );
  }
  /** Planks kept for the workshop: it holds fewer than its waiting tray order needs (`orderPlanks`; worked out once a second). */
  let planksKept = false;
  const keepPlanks = (kind: string) => kind === "planks" && planksKept;
  /** Planks the yard keeps with no order: enough for the next industry (`shopSpare`; worked out once a second). */
  let yardSpare = shopSpare(progress);
  /** What the workshop's yard takes while a town on the line wants planks: its order's, or the spare (`yardKeeps`). */
  /**
   * The yard's own keep amount (its card's stepper, `DepotState.keeps`) or, not set, the game's: planks, the spare; other
   * goods, none (it takes them all). A waiting order's planks still come first (`yardKeeps`).
   */
  const shopKeeps = (kind: CargoKind, d: DepotState) => {
    const set = d.keeps[CARGO[kind].index];
    return kind === "planks" ? yardKeeps(progress, set ?? yardSpare.planks) : set;
  };
  /** Stone the workshop takes from trains: only as much as a harbour's price still needs there (`shopOwes`). */
  const owes = (kind: CargoKind) => shopOwes(game.world, progress, kind);
  /** Was some owed at the last look (routed lines plan again when that changes: a blueprint learned, a price paid, a harbour built or restored). */
  let owing = false;
  function updatePlanksKept(): void {
    game.economy.reserved = mode === "game" ? keepPlanks : null;
    game.economy.shopKeeps = mode === "game" ? shopKeeps : null;
    game.economy.owes = mode === "game" ? owes : null;
    const owingNow = mode === "game" && shopOwing(game.world, progress);
    if (owingNow !== owing) {
      owing = owingNow;
      game.economy.acceptsChanged();
    }
    if (mode !== "game" || workshops(game.world).length === 0) {
      planksKept = false;
      return;
    }
    planksKept = keepsForOrder(progress, workshopStock(game.world).planks ?? 0);
    // (Cached by its inputs: blueprints learned, the map's pieces, the goal, the research.)
    yardSpare = shopSpare(progress, game.world, goals.current()?.id ?? null);
  }

  setInterval(() => {
    updatePlanksKept();
    if (playing && !game.paused) storeToasts();
    // Delivery vans' runs: worked out again only after the land, the track or what's learned changed.
    deliveryVans.sync();
    const sailed = simElapsed(harbourClock, game.simSeconds);
    if (mode !== "game" || !playing || game.paused || sailed <= 0) return;
    for (const e of harbourTrade.update(game.world, progress, sailed)) {
      if (e.kind === "arrive") game.boats.arrive(e.depotId, e.way, BOAT_SAIL, e.ship);
      else if (e.kind === "leave") game.boats.leave(e.depotId, e.way, BOAT_SAIL);
      else if (e.kind === "gone") game.boats.remove(e.depotId);
      else if (e.kind === "bought") {
        hud.setCoins(progress.coins);
        const why = e.short === "room" ? "the quay was full" : "too few coins";
        const got = `A boat brought ${describeGoods(e.goods)}: −${e.coins} coins`;
        // An order that all went back is a refusal (a plain toast); a delivery is logged quietly.
        if (total(e.goods) === 0) hud.toast(`Your order went back: ${why}`, false, 3200);
        // (A full order is routine, not news: only one cut short is, as a problem to see to.)
        else if (e.short) note({ kind: "event", key: `bought:${e.depotId}`, qty: e.coins, text: "", place: depotPlace(e.depotId), format: () => `${got} (the rest went back: ${why})` });
        scheduleSave("progress");
      } else if (e.kind === "caught") {
        // (A catch is routine, as a delivery is: the fish on the quay show it.)
        scheduleSave("progress");
      } else if (e.kind === "sold") {
        hud.setCoins(progress.coins);
        // (Goods sold to a boat are routine, as deliveries are: the coins show it, the News doesn't.)
        scheduleSave("progress");
      }
    }
    // Airships take off with their riders, and land: each rider pays the tour's fare.
    for (const t of airships.update(game.world, progress, game.simSeconds, sightsOf)) {
      hud.setCoins(progress.coins);
      note({ kind: "event", key: `tour:${t.depotId}`, qty: t.paid, text: "", place: depotPlace(t.depotId), format: () => `An airship tour landed: ${t.riders} rider${t.riders === 1 ? "" : "s"}, +${t.paid} coins` });
      scheduleSave("progress");
    }
    // Planes land at airports: the lounge flies off (paying), visitors get off for the trains.
    for (const v of airports.update(game.world, progress, game.simSeconds)) {
      if (v.paid > 0) {
        hud.setCoins(progress.coins);
        note({ kind: "event", key: `flew:${v.depotId}`, qty: v.paid, text: "", place: depotPlace(v.depotId), format: () => `A plane took ${v.flew} rider${v.flew === 1 ? "" : "s"}: +${v.paid} coins` });
      }
      if (v.paid > 0 || v.visitors > 0) scheduleSave("progress");
    }
    // The player's boats move on, drop and pick up.
    water?.tick(sailed);
    // What's been done (logs cut, loads moved, goods delivered) toward the blueprints that ask for it.
    // (The picker shows the counts only as requirements met, or riders: the workshop's clock sees those in its key.)
    counters.collect(game.economy, progress);
    // A train set going that's too heavy for its engines says so, once.
    for (const t of game.sim.trains()) {
      const id = t.id;
      const why = t.cars.some((c) => c.kind === "engine" && c.lever !== 0) ? tooHeavy(game.world, t) : null;
      if (why && !warnedHeavy.has(id)) hud.toast(why, false, 4200);
      if (why) warnedHeavy.add(id);
      else warnedHeavy.delete(id);
    }
    // (On game time: at 2× people come twice as fast, as everything else does.)
    const gameSeconds = simElapsed(peopleSeconds, game.simSeconds);
    // (A town with a powered radio mast sends more: src/game/radio.ts. The towns counted again only when the power or
    // the props change.)
    peopleArrive(game.world, progress, gameSeconds, peopleClock, radioBoost());
    // Secrets: midsummer at the stones, an open card's trips.
    secrets?.tick();
    // The circus (late-game spec K1): a show opens where its train stands at a town, and closes after three months.
    if (mode === "game" && progress.learned.has("circus")) tickCircus();
    // The World's Fair wheel's tickets, each month, and its fair week (src/game/grand.ts).
    if (mode === "game" && game.economy.grandPlans.size > 0) tickGrand();
    // Sparks: a power station's coal may have run out (or come), a train put on or away (src/game/power.ts).
    syncPower();
    // Metro trains draw power: a coal from a power station now and then, as they run (not while paused: they stand,
    // though they keep their speed for after). On game time too.
    if (!game.paused) metroDraw(game.world, gameSeconds, metroClock);
    // (A town grown out over a line two levels down: those squares weren't dug for it, so nothing's paid.)
    if (mode === "game") settleDigging(progress, squaresDugUnder(game.world), false);
    // A bus at a station's stop goes for the people waiting in its town off the line.
    if (mode === "game" && !game.paused) buses.update();
    // (Placed again only when what the towns have had or the land changed: a key compared, else nothing.)
    townCars.sync();
    // (Nothing else may be drawing: new arrivals redraw their platform themselves.)
    showWaiting();
  }, 1000);

  /** Warehouses a hand-run train has been told about (this session): each says why it trades nothing, once. */
  const storesTold = new Set<number>();
  /** Workshops a routed train passing with planks (no stop there) has been told about (this session), once each. */
  const shopsTold = new Set<number>();
  /**
   * A hand-run train with wagons beside a warehouse: it trades nothing there (only routed trains do), so a toast says
   * why and what to do, once per warehouse; and a routed train passing a workshop that isn't one of its stops, with
   * planks the workshop would take, once per workshop. Once a second: a lookup per bogie of each train.
   */
  function storeToasts(): void {
    for (const t of game.sim.trains()) {
      const d = game.economy.storeItSkips(t.id);
      if (!d || storesTold.has(d.id) || game.economy.routeOfTrain(t)) continue;
      storesTold.add(d.id);
      hud.toast(STORE_NO_ROUTE, false, 4200);
    }
    // A routed train passing the workshop with planks, no stop there: it keeps them (once per workshop).
    for (const { id } of game.sim.trains()) {
      const kept = game.economy.keptAt(id);
      if (!kept || kept.why !== "not-stop" || kept.depot.role !== "workshop" || shopsTold.has(kept.depot.id)) continue;
      shopsTold.add(kept.depot.id);
      hud.toast(keptText(kept.why, kept.kind, "workshop", "the workshop"), false, 4200);
    }
  }

  /** The peg dolls on each platform are the people waiting (Game mode, once coaches are known; else the usual few). */
  function showWaiting(): void {
    const live = mode === "game" && progress.learned.has("passengers");
    // (At its station: a halt's people aren't drawn.)
    for (const d of game.economy.allDepots()) if (d.role === "town" && game.world.stations.get(d.townId) === d.pieceId) game.setWaiting(d.townId, live ? d.waiting : null);
  }

  // A town's card (Game mode): its ledger (src/game/town-ledger.ts), drawn again only when its key changes. Its station
  // row says who is waiting for a coach.
  const ledgerContext: LedgerContext = { learned: progress.learned, room: null, carried: 0, van: { line: (d) => deliveryVans.cardLine(d), key: (d) => deliveryVans.cardKey(d) }, bus: { line: (d) => buses.cardLine(d), key: (d) => buses.cardKey(d) } };
  const ledgerOf = (): LedgerContext => {
    ledgerContext.learned = progress.learned;
    ledgerContext.carried = progress.riders;
    ledgerContext.room = progress.learned.has("passengers") ? waitingCap(progress) : null;
    return ledgerContext;
  };
  const townCard = {
    // (Its station's upgrade row follows the track, the land and what's learned: drawn again when they change.)
    key: (d: DepotState) => {
      const town = townOfDepot(d);
      const places = town ? Math.imul(placeRowKey(game.world, progress, town), 31) + grandRowKey(game.world, progress, town.id) : 0;
      return (Math.imul(Math.imul(ledgerKey(game.world, d, ledgerOf()), 31) + (canUpgrade(d) ? game.layout.revision * 7919 + game.landscape.grid.revision : 0), 31) + places) | 0;
    },
    show: (d: DepotState) => {
      const v = townLedger(game.world, d, ledgerOf());
      if (!v) return;
      hud.depotExtra.hidden = false;
      drawLedger(hud.depotExtra, v, { school: (id) => interaction.openDepotCard(id), lines: () => openLines() });
      if (canUpgrade(d)) drawUpgrades(d);
      drawPlaces(d);
      drawGrand(d);
    },
  };

  // ---- a town's places and treats (spec 2026-11-04-civic-leisure-design.md): src/game/places.ts -----------------

  /** The town of a town card's depot. */
  const townOfDepot = (d: DepotState) => game.landscape.towns.find((t) => t.id === d.townId);

  /** The Places and Treats rows on a town's card (Game mode). */
  function drawPlaces(d: DepotState): void {
    const town = townOfDepot(d);
    if (!town || mode !== "game") return;
    const level = statusOf(game.world, town.id).level;
    drawPlaceRows(hud.depotExtra, placeRow(game.world, progress, town, level), {
      build: (id) => {
        const r = startPlace(game.world, townLife, progress, town, level, id);
        const place = PLACES.find((p) => p.id === id)!;
        if (r === "no-room") {
          hud.toast(`No room in ${town.name} for a ${place.name.toLowerCase()} just now`, false, 3600);
          audio.refuse();
          return;
        }
        if (r === "not-now") return audio.refuse();
        hud.setCoins(progress.coins);
        if (r === "started") hud.toast(`${place.icon} ${place.name} for ${town.name}: trains bring its goods to the station`, false, 4200);
        audio.tap();
        scheduleSave();
        scheduleSave("progress");
      },
      stop: () => {
        const place = stopPlace(game.world, progress, town);
        if (!place) return;
        hud.setCoins(progress.coins);
        hud.toast(`Stopped the ${place.name.toLowerCase()}: ${place.coins} 🪙 back`, false, 3200);
        scheduleSave();
        scheduleSave("progress");
      },
      treat: (id) => {
        const r = buyTreat(game.world, townLife, progress, town, level, id);
        const treat = PLACES.find((p) => p.id === id)!;
        if (r === "no-room") {
          hud.toast(`No room in ${town.name} for a ${treat.name.toLowerCase()} just now`, false, 3600);
          audio.refuse();
          return;
        }
        if (r === "not-now") return audio.refuse();
        hud.setCoins(progress.coins);
        scheduleSave("progress");
      },
    });
  }

  // ---- grand projects (spec 2026-11-05-character-and-goals.md): src/game/grand.ts ----------------------------------

  /** A city's Grand projects row on its card (Game mode, a city or bigger: a City ★ starts them). */
  function drawGrand(d: DepotState): void {
    const town = townOfDepot(d);
    if (!town || mode !== "game") return;
    const level = statusOf(game.world, town.id).level;
    if (level < GRAND_LEVEL - 1 && ![...game.economy.grandPlans.values()].some((p) => p.townId === town.id)) return;
    drawGrandRow(hud.depotExtra, grandRow(game.world, progress, town, level), {
      build: (id) => void buildGrand(town, id as GrandId),
      show: (id) => showGrandSite(id),
    });
  }

  /** Every stage's model of a project, loaded (their footprints find its site). */
  const grandModels = (id: GrandId): Promise<unknown> => {
    const g = grandOf(id)!;
    return Promise.all(Array.from({ length: g.stages.length + 1 }, (_, i) => game.propLibrary.load(siteAsset(g, i))));
  };

  /** Build on a project's tile: its site found by the city, its coins paid, its plot put up. */
  async function buildGrand(town: Town, id: GrandId): Promise<void> {
    const g = grandOf(id)!;
    // Grand Central: a station of its own, its kit given into the toy box for the player to put on a line by the city.
    // (No site models to load: its stages are its kits. Loading its props' four stages first built models nothing
    // shows, and on a slow phone held the tap up for seconds; CI's e2e:grand ran out waiting.)
    if (g.kits) {
      const kit = g.kits[0];
      const r = startGrand(game.world, progress, town, statusOf(game.world, town.id).level, id, () => ({ ...town.station, y: 0 }), () => {
        progress.add(`piece:${kit}`, 1);
        hud.refreshTrayBadges();
        return -1;
      });
      if (r !== "started") return audio.refuse();
      grandStarted(town, id);
      hud.toast(`🚉 Grand Central is in your toy box (Industries tab, Stations): put it on a line by ${town.name}, and lay track to its three roads`, true, 6000);
      return;
    }
    try {
      await grandModels(id);
    } catch {
      hud.toast("Couldn't load the plans just now. Try again in a moment", false, 3200);
      return;
    }
    const level = statusOf(game.world, town.id).level;
    const fps = Array.from({ length: g.stages.length + 1 }, (_, i) => game.propLibrary.footprint(siteAsset(g, i)));
    const fp = unionFootprint(fps, g.scale);
    const r = startGrand(
      game.world,
      progress,
      town,
      level,
      id,
      () => (fp ? siteSpot(game.world, town, fp, game.propLibrary.footprint) : null),
      (asset, pose, scale) => {
        const prop = game.props.add(asset, pose, undefined, { scale }).id;
        game.propsChanged();
        return prop;
      },
    );
    if (r === "no-room") {
      hud.toast(`No room by ${town.name} for the ${g.name}: it needs a big clear, level space near the station`, false, 4200);
      audio.refuse();
      return;
    }
    if (r === "not-now") return audio.refuse();
    grandStarted(town, id);
  }

  /** A grand project started in `town`: coins shown, the toast and News, saved. */
  function grandStarted(town: Town, id: GrandId): void {
    const g = grandOf(id)!;
    hud.setCoins(progress.coins);
    hud.toast(`${g.icon} The ${g.name} is planned for ${town.name}! Trains bring each stage's goods to its station`, true, 4200, () => showGrandSite(id));
    note({ kind: "milestone", text: `${g.icon} ${town.name} starts the ${g.name}`, place: grandPlace(id) ?? undefined }, 4200, true);
    audio.tap();
    checkGoals(false);
    scheduleSave();
    scheduleSave("progress");
    game.invalidate();
  }

  /** Where a project's site stands (null: not started, or its prop's gone). */
  function grandPlace(id: string): { x: number; z: number } | null {
    const plan = game.economy.grandPlans.get(id);
    const p = plan ? game.props.get(plan.prop) : undefined;
    if (p) return { x: p.x, z: p.z };
    // (Grand Central: its kit, once it's on a line; till then, its city.)
    const station = plan && grandOf(id)?.kits ? game.layout.getPiece(centralPiece(game.world)) : undefined;
    if (station) return { x: station.pose.x, z: station.pose.z };
    const t = plan && game.landscape.towns.find((x) => x.id === plan.townId);
    return t ? { x: t.centre.x, z: t.centre.z } : null;
  }

  /** Fly to a project's site; not started, to the biggest town, whose card starts it. */
  function showGrandSite(id: string): void {
    const at = grandPlace(id);
    if (at) {
      hud.hideCards();
      flyTo(at);
      return;
    }
    let best: Town | null = null;
    let bestLevel = -1;
    for (const t of game.landscape.towns) {
      const l = statusOf(game.world, t.id).level;
      if (l > bestLevel) [best, bestLevel] = [t, l];
    }
    if (!best) return;
    flyTo({ x: best.centre.x, z: best.centre.z });
    if (bestLevel < GRAND_LEVEL) hud.toast(`${best.name} is a ${statusOf(game.world, best.id).name}: grow a town into a City ★ to start a grand project`, false, 4200);
    else {
      const station = game.economy.depotAtPiece(game.stations.get(best.id) ?? -1);
      if (station) interaction.openDepotCard(station.id);
    }
  }

  /** Goods went into a grand project: its stages done move it on (its site's model swapped), and one finished pays out. */
  function advanceGrand(): void {
    const events = advanceGrands(game.world, (prop, asset) => {
      const p = game.props.get(prop);
      if (!p) return;
      game.props.remove(prop);
      game.props.add(asset, { x: p.x, z: p.z, heading: p.heading, y: p.y }, prop, { scale: p.scale });
      game.propsChanged();
    });
    for (const e of events) {
      const g = grandOf(e.id)!;
      const plan = game.economy.grandPlans.get(e.id)!;
      // Grand Central's stage: its kit moves on (the placed one retyped: the same roads, its trains and routes kept).
      const kit = g.kits?.[plan.stage];
      if (kit) {
        moveCentralKit(game.world, progress, kit);
        hud.refreshTrayBadges();
        if (centralPiece(game.world) >= 0) {
          void game.kitView.load(kit).then(() => game.syncKits(true));
          industriesChanged();
          game.trackChanged();
        }
      }
      const town = game.landscape.towns.find((t) => t.id === plan.townId);
      const at = grandPlace(e.id) ?? undefined;
      if (e.kind === "stage") {
        const next = g.stages[e.stage];
        note({ kind: "milestone", text: `${g.icon} ${g.name}: ${g.stages[e.stage - 1].name.replace(/^The /, "the ")} done! Next, ${next.name.replace(/^The /, "the ")}`, place: at }, 4200);
        game.flourishes.add(game.landscapeView.flash(town ? [town.id] : []));
        audio.chime();
      } else grandEarned(e.id, at);
    }
    if (events.length > 0) {
      checkGoals(true);
      scheduleSave();
      scheduleSave("progress");
      cloud?.edited(mode, "progress");
      game.invalidate();
    }
  }

  /** A grand project finished: its reward, its day (every town flashes, the camera goes to it), and the News. */
  function grandEarned(id: GrandId, at: { x: number; z: number } | undefined): void {
    const g = grandOf(id)!;
    if (id === "exhibition") {
      // Every town grows a step: what each lacks, given toward its growth; they grow on the next update.
      giveExhibition(game.world, game.landscape, (townId) => statusOf(game.world, townId));
      townLife.rewardsChanged();
    }
    // A tenth fewer goods for every town from now on (`growthCut`): wants are looked at again.
    if (id === "cathedral") townLife.rewardsChanged();
    // The Royal Train into the toy box: its look, its engine and two saloons (a gift, never made).
    if (id === "royal-train") {
      for (const [thing, n] of ROYAL_GIFT) progress.add(thing, n);
      hud.refreshTrayBadges();
    }
    note({ kind: "milestone", text: `🥇 ${g.day}`, place: at }, 6000, true);
    hud.toast(`🥇 ${g.day}! (Achievements)`, true, 6000, () => goalsPanel.openAchievements(id));
    game.flourishes.add(game.landscapeView.flash(game.landscape.towns.map((t) => t.id)));
    if (at) flyTo(at);
    audio.chime();
  }

  // A grand project's site is its city's: a tap opens the city's card, and it's never lifted (Game mode).
  interaction.siteTown = (propId) => {
    if (mode !== "game") return -1;
    for (const plan of game.economy.grandPlans.values()) if (plan.prop === propId) return plan.townId;
    return -1;
  };

  /** The last game month the wheel's tickets were paid for (−1: none yet this session: the calendar is the session's). */
  let wheelPaidTo = -1;
  /** The fair week told for this month (−1: none). */
  let fairTold = -1;
  /** A second of play with grand projects on the map: the wheel's tickets as a month passes, fair week in July. */
  function tickGrand(): void {
    const months = Math.floor(game.simSeconds / MONTH_S);
    const t = wheelTickets(game.world, wheelPaidTo, months);
    wheelPaidTo = t.paidTo;
    if (t.coins > 0) {
      progress.coins += t.coins;
      hud.setCoins(progress.coins);
      note({ kind: "event", key: "wheel", qty: t.coins, text: "", place: grandPlace("ferris-wheel") ?? undefined, format: (n) => `🎡 The wheel's tickets: +${n} coins` });
      scheduleSave("progress");
    }
    const fair = fairTown(game.world, dateOf(game.simSeconds).month);
    if (fair >= 0 && fairTold !== months) {
      fairTold = months;
      const t = game.landscape.towns.find((x) => x.id === fair);
      if (t) note({ kind: "milestone", text: `🎡 Fair week in ${t.name}! Crowds come by train all July`, place: { x: t.centre.x, z: t.centre.z } }, 4200);
    }
  }

  /** The Journal's Achievements tab: shown once any town is a City (or a project's begun). */
  function showAchievements(): void {
    let top = 0;
    for (const t of game.landscape.towns) top = Math.max(top, statusOf(game.world, t.id).level);
    const open = mode === "game" && (top >= GRAND_LEVEL - 1 || game.economy.grandPlans.size > 0);
    goalsPanel.setAchievements(open ? achievements(game.world, top >= GRAND_LEVEL) : null);
  }

  /** A place stands in a town now: the News, a chime, the goals, and saved. */
  function placeUp(town: Town, place: Place, at: { x: number; z: number }): void {
    const what = place.kind === "treat" ? "" : place.smile ? " +1 😊: it needs fewer goods to grow" : place.visitors ? ": visitors come by coach" : `: ${place.blurb}`;
    note({ kind: "milestone", text: `${place.icon} ${town.name} has a new ${place.name.toLowerCase()}!${what}`, place: at }, 4200);
    game.flourishes.add(game.landscapeView.flash([town.id]));
    game.touchLevelsVersion++;
    audio.chime();
    checkGoals(true);
    scheduleSave();
    scheduleSave("progress");
    cloud?.edited(mode, "progress");
    game.invalidate();
  }

  /** Blueprint `id` learned: plain look-alikes of its places open, free; and growth stops building plain ones. */
  function openPlaces(id: string): void {
    for (const place of PLACES) {
      if (place.tech !== id) continue;
      const towns = townLife.openFree(place);
      if (towns.length > 0) note({ kind: "milestone", text: `${place.icon} ${towns.map((t) => t.name).join(" and ")}: the ${place.name.toLowerCase()} opens!${place.smile ? " +1 😊" : ""}` }, 4200);
    }
    syncPlaceStyles();
    if (game.landscape.towns.length > 0) scheduleSave();
  }

  /** Models that are places once their blueprint is learned aren't built as plain houses any more. */
  function syncPlaceStyles(): void {
    retireStyles(mode === "game" ? PLACES.flatMap((p) => (p.opensFree && p.tech && progress.learned.has(p.tech) ? [p.opensFree] : [])) : []);
  }

  // ---- a town's station upgraded in place (Big stations learned): src/game/station-upgrade.ts ------------------

  /** Does this town card's station offer upgrades: Game mode, Big stations learned, its station still the plain one? */
  function canUpgrade(d: DepotState): boolean {
    return mode === "game" && progress.learned.has("big-stations") && game.economy.stationPieces.has(d.pieceId) && game.layout.getPiece(d.pieceId)?.type === "station";
  }

  /** A town station's upgrade row on its card: a button per big station that fits (its price, the houses it moves), or why not. */
  function drawUpgrades(d: DepotState): void {
    const box = document.createElement("div");
    box.className = "station-upgrade";
    const title = document.createElement("div");
    title.className = "station-waiting";
    title.textContent = "Upgrade the station";
    box.append(title);
    for (const type of STATION_UPGRADES) {
      const plan = planUpgrade(game.world, d.townId, type, interaction.landEditor(), (t, pose, y, ignore) => interaction.placeWhy(t, pose, y, ignore));
      const name = UPGRADE_NAMES[type];
      if (typeof plan === "string") {
        const why = document.createElement("div");
        why.className = "station-waiting";
        why.textContent = `${name}: ${plan}`;
        box.append(why);
        continue;
      }
      const rule = ruleOf(pieceThing(type))!;
      const moves = plan.moves.length;
      const b = document.createElement("button");
      b.className = "chip text station-upgrade-btn";
      b.dataset.upgrade = type;
      b.textContent = `⬆ ${name} · ${costText(rule)}${moves ? ` (moves ${moves} house${moves === 1 ? "" : "s"})` : ""}`;
      b.title = `Upgrade to a ${name.toLowerCase()} on the same spot: its trains, routes and lines stay`;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        upgradeStation(d, type);
      });
      box.append(b);
    }
    hud.depotExtra.append(box);
  }

  /** Upgrade town depot `d`'s station to `type`: the kit from the toy box (or made at the workshop), houses moved, one undo step. */
  function upgradeStation(d: DepotState, type: StationUpgrade): void {
    const plan = planUpgrade(game.world, d.townId, type, interaction.landEditor(), (t, pose, y, ignore) => interaction.placeWhy(t, pose, y, ignore));
    const name = UPGRADE_NAMES[type];
    if (typeof plan === "string") {
      hud.toast(plan, false, 3600);
      audio.refuse();
      return;
    }
    // The kit, as any piece put down: one from the toy box, or made now from the workshop's planks.
    const lack = lacking(game.world, progress, new Map([[pieceThing(type), 1]]));
    if (lack.size > 0) {
      const why = craftNow(game.world, progress, lack);
      if (why === "no-workshop") {
        hud.toast(`${name}: place your workshop (Industries tab) to make one`, false, 3600);
        audio.refuse();
        return;
      }
      if (why) {
        hud.toast(`${name}: needs ${costTag(why.goods, why.coins)} more at the workshop`, false, 3600);
        audio.refuse();
        return;
      }
      afterCraft();
    }
    const land = upgradeLand(game.world, plan);
    land.do();
    if (!editor.retype(plan.stationId, type, land, UPGRADE_UNDO_REFUSED)) {
      land.undo();
      hud.toast("The station can't be upgraded just now", false, 3600);
      audio.refuse();
      return;
    }
    game.editLand(land.slots());
    void game.kitView.load(type).then(() => game.syncKits(true));
    industriesChanged();
    const town = game.landscape.towns.find((t) => t.id === d.townId)?.name ?? "The town";
    hud.toast(`${town} has a ${name.toLowerCase()} now${plan.moves.length ? `: ${plan.moves.length} house${plan.moves.length === 1 ? "" : "s"} moved along` : ""}`, false, 3600);
    audio.chime();
    interaction.openDepotCard(d.id);
    scheduleSave();
  }

  // A sawmill's card (Game mode): a hint at the faster-sawmills blueprint until it's learned.
  let sawmillShown = "";
  function showSawmill(): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.depot(id);
    const tech = techOf("sawmills2");
    if (!d || d.role !== "sawmill" || !tech || progress.learned.has(tech.id)) {
      if (sawmillShown !== "") hud.depotExtra.hidden = true;
      sawmillShown = "";
      return;
    }
    const unmet = tech.requires.filter((n) => !needMet(progress, n));
    const text = unmet.length > 0 ? `Faster sawmills: ${tech.label}, after ${unmet.map(describeNeed).join(" and ")}` : `Faster: ${tech.label} (blueprint)`;
    if (text === sawmillShown) return;
    sawmillShown = text;
    const box = hud.depotExtra;
    box.hidden = false;
    box.innerHTML = "";
    const line = document.createElement("div");
    line.className = "station-waiting";
    line.textContent = text;
    box.append(line);
  }

  /** The open mast card's lines, as drawn ("" for none). */
  let mastShown = "";
  /** A mast's card (Game mode): who's aboard, what there is to see, and the fare; or the tour in the air. */
  function showMast(): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.depot(id);
    if (!d || d.role !== "mast") {
      mastShown = "";
      return;
    }
    // (The sights counted again only when the map or the trains change: a key, not a frame.)
    const sk = `${d.id}|${game.layout.revision}|${game.sim.trainCount}`;
    if (sk !== mastSightsKey) {
      mastSightsKey = sk;
      mastSights = sightsOf(d);
    }
    const lines = mastLines(d, airships.state(d.id), mastSights!);
    const key = lines.join("\n");
    if (key === mastShown && hud.depotExtra.childElementCount > 0) return;
    mastShown = key;
    const box = hud.depotExtra;
    box.hidden = false;
    box.innerHTML = "";
    for (const text of lines) {
      const line = document.createElement("div");
      line.className = "station-waiting";
      line.textContent = text;
      box.append(line);
    }
  }
  let mastSightsKey = "";
  let mastSights: ReturnType<typeof tourSights> | null = null;

  /** The open airport card's lines, as drawn ("" for none): its countdown ticks in place. */
  let airportShown = "";
  /** An airport's card (Game mode): its next plane, its lounge, its visitors. Drawn again only when its text changes. */
  function showAirport(): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.depot(id);
    if (!d || d.role !== "airport") {
      airportShown = "";
      return;
    }
    const lines = airportLines(d, airports.nextIn(d.id));
    const key = lines.join("\n");
    if (key === airportShown && hud.depotExtra.childElementCount > 0) return;
    airportShown = key;
    const box = hud.depotExtra;
    box.hidden = false;
    box.innerHTML = "";
    for (const text of lines) {
      const line = document.createElement("div");
      line.className = "station-waiting";
      line.textContent = text;
      box.append(line);
    }
  }

  /** The circus's second of play: its big top put up or taken down, and what's said (src/game/circus.ts). */
  function tickCircus(): void {
    // (The big top's model, fetched ahead of its first show: its footprint finds it room.)
    if (!game.propLibrary.footprint(BIG_TOP)) void game.propLibrary.load(BIG_TOP).catch(() => {});
    const town = (id: number) => game.landscape.towns.find((t) => t.id === id);
    const events = circusTick(
      game.world,
      progress,
      1,
      (townId) => {
        const piece = game.layout.getPiece(game.stations.get(townId) ?? -1);
        if (!piece) return -1;
        // (Before its model is in, a big top's own size: about 160 mm across.)
        const fp = game.propLibrary.footprint(BIG_TOP) ?? { cx: 0, cz: 0, hw: 80, hd: 80 };
        const spot = bigTopSpot(game.world, piece.pose, fp, game.propLibrary.footprint);
        if (!spot) return -1;
        const id = game.props.add(BIG_TOP, spot).id;
        game.propsChanged();
        return id;
      },
      (prop) => {
        if (!game.props.get(prop)) return;
        game.props.remove(prop);
        game.propsChanged();
      },
    );
    for (const e of events) {
      const t = town(e.town);
      const name = t?.name ?? "The town";
      if (e.kind === "opened") {
        note({ kind: "milestone", text: `The circus is in ${name}! Riders to ${name} pay ${CIRCUS_FARE}× for 3 months`, place: t ? { x: t.centre.x, z: t.centre.z } : undefined }, 4200, true);
        hud.toast(`✨ The circus is in ${name}! Riders there pay ${CIRCUS_FARE}×`, true, 3600);
      } else {
        const level = Math.max(1, statusOf(game.world, e.town).level);
        const offer = offerOnGrowth(progress, game.world, name, level, Math.random);
        hud.toast(`The circus leaves ${name}.${offer ? ` ${name} thanks you: pick a reward` : ""}`, true, 3600, offer ? () => openRewards() : undefined);
        if (offer) refreshBoard();
      }
      audio.chime();
      scheduleSave();
      scheduleSave("progress");
    }
  }

  // ---- depot tracks: an industry upgraded to 2, then 3 tracks, from its card (Sidings learned) ---------------------
  // docs/superpowers/specs/2026-11-04-depot-tracks.md. Its row is its own element, put back if another row cleared it.
  let tracksShown = "";
  let tracksRow: HTMLElement | null = null;
  const tracksCheck = (t: PieceTypeId, f: boolean, pose: Pose, y: number, ignore: Ignore) => interaction.placeWhyIgnoring(t, f, pose, y, ignore);
  function showTracks(): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.liveDepot(id);
    if (!d || !TRACK_ROLES.has(d.role) || !progress.learned.has(TRACKS_TECH)) {
      tracksShown = "";
      tracksRow = null;
      return;
    }
    const n = game.economy.trackCount(d.id);
    const stock = workshopStock(game.world);
    const key = `${id}|${n}|${game.layout.revision}|${game.landscape.grid.revision}|${stock.planks ?? 0}|${stock.stone ?? 0}`;
    if (key === tracksShown && tracksRow?.isConnected) return;
    tracksShown = key;
    tracksRow?.remove();
    const box = (tracksRow = document.createElement("div"));
    box.className = "depot-tracks";
    const title = document.createElement("div");
    title.className = "station-waiting";
    title.textContent = n === 1 ? "One track: a train waits on the line while another is loaded" : `${n} tracks: ${n} trains stand here, the crane serving each in turn`;
    box.append(title);
    if (n < MAX_TRACKS) {
      const price = TRACK_PRICES[(n + 1) as 2 | 3];
      const plan = planTracks(game.world, d, tracksCheck);
      const b = document.createElement("button");
      b.className = "chip text depot-tracks-btn";
      b.dataset.tracks = String(n + 1);
      b.innerHTML = `⬆ ${n === 1 ? "Second" : "Third"} track · ${costTag(price, 0)}`;
      b.title = "Lay another track beside it, joined at both ends: its crane reaches over to load a train there too";
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        addTrack(d);
      });
      box.append(b);
      if (typeof plan === "string") {
        b.disabled = true;
        const why = document.createElement("div");
        why.className = "station-waiting depot-tracks-why";
        why.textContent = plan;
        box.append(why);
      }
    }
    hud.depotExtra.hidden = false;
    hud.depotExtra.append(box);
  }

  /** Put goods back on the first workshop's piles (an upgrade undone). */
  function giveToWorkshops(bag: Partial<Record<CargoKind, number>>): void {
    const shop = workshops(game.world)[0];
    if (!shop) return;
    for (const k of CARGO_KINDS) if (bag[k]) shop.piles[CARGO[k].index] += bag[k]!;
  }

  /**
   * Give depot `d` one more track: the ladder laid in place of the straights at its ends, its record and its price,
   * all one undo step (undone, the goods go back to the workshop; redone, they're taken again if they're there).
   */
  function addTrack(d: DepotState): void {
    const plan: TracksPlan | string = planTracks(game.world, d, tracksCheck);
    if (typeof plan === "string") {
      hud.toast(plan, false, 3600);
      audio.refuse();
      return;
    }
    const price = TRACK_PRICES[plan.tracks];
    if (workshops(game.world).length === 0) {
      hud.toast("Place your workshop (Industries tab): another track's planks come from there", false, 3600);
      audio.refuse();
      return;
    }
    if (!takeFromWorkshops(game.world, price)) {
      hud.toast(`Another track needs ${costTag(price, 0)} at the workshop`, false, 3600);
      audio.refuse();
      return;
    }
    const before = game.economy.tracksOf(d.id);
    const prev = { roads: before?.roads.map((r) => r.pieceId) ?? [], ends: [...(before?.ends ?? [])], ladder: [...(before?.ladder ?? [])] };
    let paid = true;
    const laid = editor.group(() => {
      const ids = editor.replaceRun(plan.covers, plan.pieces);
      if (ids.length !== plan.pieces.length) return;
      const after = tracksAfter(plan, ids);
      game.economy.setTracks(d, after.roads, after.ends, after.ladder);
      editor.recordRoutes({
        redo: () => {
          game.economy.setTracks(d, after.roads, after.ends, after.ladder);
          paid = takeFromWorkshops(game.world, price);
        },
        undo: () => {
          game.economy.setTracks(d, prev.roads, prev.ends, prev.ladder);
          if (paid) giveToWorkshops(price);
          paid = false;
        },
      });
    });
    if (!laid || game.economy.trackCount(d.id) !== plan.tracks) {
      giveToWorkshops(price);
      hud.toast("Another track can't go there just now", false, 3600);
      audio.refuse();
      return;
    }
    industriesChanged();
    if (game.depotView.syncTracks(game.economy, game.layout)) game.invalidate();
    // (The group's step goes on the undo stack only once it's whole: the Undo button is told after.)
    hud.setHistory(editor.canUndo, editor.canRedo);
    hud.toast(`${depotName(game.world, d)} has ${plan.tracks} tracks now: its crane reaches over them all`, false, 3600);
    audio.chime();
    tracksShown = "";
    scheduleSave();
  }

  let harbourShown = "";
  /** The open harbour card's line about its boats: kept and its text updated, so the countdown ticks without the card's button being made again (a tap mid-way would be lost). */
  let harbourLine: HTMLElement | null = null;
  /** A harbour's card (Game mode): when the next boat calls, and dock sheds to build. */
  function showHarbour(): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    if (id === -1 || game.economy.depot(id)?.role !== "harbour") {
      harbourShown = "";
      harbourLine = null;
      return;
    }
    const d = game.economy.depot(id)!;
    const canShed = progress.learned.has("dock-sheds") && d.sheds < MAX_SHEDS;
    const piece = game.layout.getPiece(d.pieceId);
    const lit = !!piece && progress.learned.has("lighthouse") && lighthouseNear(game.world, piece.pose);
    const text = harbourTrade.describe(id, progress.learned.has("fishing"), progress.learned.has("chocolate"), progress.learned.has("cargo-ships") && game.economy.shipsBuilt > 0, lit);
    const line = d.sheds > 0 ? `${text} Dock sheds: ${d.sheds} of ${MAX_SHEDS} (each holds ${SHED_CAP} more of every good).` : text;
    // Goods the boats sell you (what you already make), and what's on order for the next one.
    const forSale = goodsForSale(game.world);
    const ordered = harbourTrade.ordered(id);
    const key = `${id}|${d.sheds}|${canShed}|${forSale.join()}|${JSON.stringify(ordered)}`;
    if (key === harbourShown && harbourLine?.isConnected) {
      if (harbourLine.textContent !== line) harbourLine.textContent = line;
      return;
    }
    harbourShown = key;
    const box = hud.depotExtra;
    box.hidden = false;
    box.innerHTML = "";
    harbourLine = document.createElement("div");
    harbourLine.className = "station-waiting";
    harbourLine.textContent = line;
    box.append(harbourLine);
    if (forSale.length > 0) {
      const buy = document.createElement("div");
      buy.className = "harbour-buy";
      const on = total(ordered) > 0 ? `On order: ${describeGoods(ordered)} (paid when it comes)` : "Buy from the next boat (2× town price):";
      buy.innerHTML = `<div class="harbour-buy-line">${on}</div>`;
      for (const k of forSale) {
        const b = document.createElement("button");
        b.className = "chip text";
        b.innerHTML = `+${describeGoods({ [k]: BUY_LOT })} · ${BUY_LOT * buyPrice(k)}<i class="coin-dot" aria-label="coins"></i>`;
        b.disabled = harbourTrade.full(id);
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!harbourTrade.order(id, k)) hud.toast("A boat brings 6 loads at most", false);
          showHarbour();
        });
        buy.append(b);
      }
      if (total(ordered) > 0) {
        const cancel = document.createElement("button");
        cancel.className = "chip text";
        cancel.textContent = "Cancel order";
        cancel.addEventListener("click", (e) => {
          e.stopPropagation();
          harbourTrade.cancel(id);
          showHarbour();
        });
        buy.append(cancel);
      }
      box.append(buy);
    }
    if (!canShed) return;
    const build = document.createElement("button");
    build.className = "chip text";
    // (No title: on a desktop its tooltip can linger over the tray after the click.)
    build.textContent = `Build a dock shed: room for ${SHED_CAP} more of each good (${SHED_PRICE} coins)`;
    build.addEventListener("click", () => {
      if (progress.coins < SHED_PRICE) {
        hud.toast(`A dock shed costs ${SHED_PRICE} coins: you have ${progress.coins}`, false, 3200);
        return;
      }
      progress.coins -= SHED_PRICE;
      d.sheds++;
      hud.setCoins(progress.coins);
      game.depotView.setWorld(game.economy, game.layout);
      game.invalidate();
      audio.chime();
      harbourShown = "";
      interaction.refreshDepotCard();
      scheduleSave();
    });
    box.append(build);
  }

  /** The towns with a powered radio mast, kept till the power plan or the props change. */
  let radioShown: { key: string; towns: Map<number, number> } = { key: "", towns: new Map() };
  function radioBoost(): (townId: number) => number {
    if (mode !== "game") return () => 1;
    const grid = powerOf(game.world);
    const key = `${grid.version}|${game.world.props.version}`;
    if (key !== radioShown.key) radioShown = { key, towns: radioTowns(game.world, grid.current) };
    const towns = radioShown.towns;
    // (And a grand project's: the Cathedral's pilgrims, the wheel's fair week in July. Each adds to the base.)
    const month = dateOf(game.simSeconds).month;
    return (townId) => radioRiders(towns, townId) + grandRiders(game.world, townId, month);
  }

  /** The open depot card's power, as drawn (a key of its inputs), or "" for none. */
  let powerShown = "";
  /** The power grid's version last acted on (the yards' rates follow it). */
  let powerVersion = -1;
  /**
   * Game mode's sparks (src/game/power.ts), once a second and after a tap: counted again, and the yards' rates set again
   * if who has a spark changed.
   */
  function syncPower(): void {
    if (mode !== "game") return;
    const grid = powerOf(game.world);
    grid.refresh(game.world);
    if (grid.version === powerVersion) return;
    powerVersion = grid.version;
    industriesChanged();
  }
  /**
   * A depot card's power (Game mode, once Electricity is learned): a power station's sparks, made and used; a yard's
   * Power it, and whether it has a spark. Drawn again only when its key changes (cheap: a key a frame).
   */
  function showPower(): void {
    const id = mode === "game" && hud.depotCardOpen ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.depot(id);
    const learned = progress.learned.has("electricity");
    const show = !!d && learned && (d.role === "power" || canPower(d));
    const grid = show ? powerOf(game.world) : null;
    const key = show && grid ? `${id}|${grid.version}|${d!.powerAsk}|${progress.learned.has("wind")}` : "";
    const box = hud.depotPower;
    if (key === powerShown && (key === "" || box.childElementCount > 0)) return;
    powerShown = key;
    box.innerHTML = "";
    box.hidden = !show;
    if (!show || !grid || !d) return;
    const p = grid.current;
    const line = (html: string) => {
      const e = document.createElement("div");
      e.className = "power-line";
      e.innerHTML = html;
      box.append(e);
    };
    if (d.role === "power") {
      const wind = progress.learned.has("wind");
      if (p.made === 0) line(wind ? "⚡ No sparks: bring coal, or put wind turbines on the hilltops" : "⚡ No sparks: bring coal");
      else {
        const meter = document.createElement("div");
        meter.className = "power-meter";
        meter.innerHTML = `<i class="coal" style="width:${(100 * p.fromCoal) / p.made}%"></i><i class="wind" style="width:${(100 * p.fromWind) / p.made}%"></i>`;
        box.append(meter);
        line(`⚡ <b>${p.made}</b> spark${p.made === 1 ? "" : "s"}: ${p.fromCoal} from coal${wind || p.fromWind > 0 ? `, ${p.fromWind} from the wind` : ""}`);
      }
      if (p.engines.length > 0) {
        const slow = p.engines.length - p.enginesOn.size;
        line(`🚂 Electric engines: <b>${p.engines.length}</b>${slow > 0 ? `, ${slow} at steam speed` : ", all powered"}`);
      }
      if (p.yards.length > 0) {
        const waiting = p.yards.length - p.yardsOn.size;
        line(`🏭 Powered yards: <b>${p.yardsOn.size}</b>${waiting > 0 ? `, ${waiting} waiting for a spark` : ""}`);
      }
      if (p.masts.length > 0) line(`⚡ Radio masts: <b>${p.masts.length}</b>${p.masts.length > p.mastsOn.size ? `, ${p.masts.length - p.mastsOn.size} without a spark` : ""}`);
      line(p.spare > 0 ? `<b>${p.spare}</b> spare: Power a yard on its card to speed it up` : p.made > 0 ? "No sparks spare" : "");
      return;
    }
    // A yard: ask for a spark, or stop asking.
    const on = grid.yardOn(d.id);
    const asked = d.powerAsk > 0;
    line(on ? `⚡ Powered: works ${POWERED_RATE}× as fast` : asked ? "⚡ Waiting for a spare spark of power" : `⚡ ${p.spare > 0 ? `${p.spare} spark${p.spare === 1 ? "" : "s"} spare` : "No sparks spare"}: a powered yard works ${POWERED_RATE}× as fast`);
    const b = document.createElement("button");
    b.className = asked ? "chip text" : "chip text primary";
    b.dataset.power = asked ? "off" : "on";
    b.textContent = asked ? "Stop powering it" : "⚡ Power this yard";
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      grid.ask(game.world, d, !asked);
      syncPower();
      if (!asked && !grid.yardOn(d.id)) hud.toast("No spark spare: it'll be powered when one is", false, 3200);
      audio.chime();
      scheduleSave();
      showPower();
    });
    box.append(b);
  }

  /** The school's card's choice as drawn (its depot and setting), or "" for none: drawn again only when it changes. */
  let schoolYardShown = "";
  /** The school's Shares with towns / Research first (Game mode), on its card while it's open. Cheap: a key per frame. */
  function showSchoolYard(): void {
    const d = mode === "game" && hud.depotCardOpen ? game.economy.depot(interaction.openDepotId) : undefined;
    const key = d?.role === "school" ? `${d.id}:${d.takesAll}` : "";
    // (The yard box is the workshop's too, and emptied when a card opens: drawn again if it's been emptied.)
    if (key === schoolYardShown && (key === "" || hud.depotYard.querySelector("[data-school]"))) return;
    schoolYardShown = key;
    if (!d || key === "") return;
    hud.depotYard.innerHTML = schoolYardHtml(d.takesAll);
    hud.depotYard.hidden = false;
  }
  hud.depotYard.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-school]");
    const d = game.economy.depot(interaction.openDepotId);
    if (!b || d?.role !== "school") return;
    e.stopPropagation();
    if (b.classList.contains("active")) return;
    game.economy.setTakesAll(d.id, b.dataset.school === "first");
    showSchoolYard();
    scheduleSave();
  });

  let workshopShown = -1;
  /** Keep the workshop's card current while it's open (Game mode). */
  function showWorkshop(force = false): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const open = id !== -1 && game.economy.depot(id)?.role === "workshop";
    if (!open) {
      // (Its card was closed, or another opened in its place, which cleared the shared box and may have drawn there.)
      if (workshopShown !== -1) workshopPanel.forget();
      workshopShown = -1;
      return;
    }
    if (workshopShown !== id || force) workshopPanel.hide();
    workshopShown = id;
    const rows: MakeRow[] = [];
    // (What the workshops hold: a price's stone already there isn't said to be needed.)
    const stock = workshopStock(game.world);
    const SHELVES = ["Track", "Trains", "Industries", "Railway"];
    for (const tid of Object.keys(THING_RULES) as ThingId[]) {
      if (!progress.knows(tid) || isFree(tid) || isGift(tid)) continue;
      const rule = ruleOf(tid)!;
      rows.push({
        id: tid,
        label: rule.label,
        cost: costText(rule),
        have: progress.available(game.world, tid),
        queued: progress.orders.filter((o) => o === tid).length,
        shelf: tid.startsWith("car:") ? "Trains" : tid.includes("depot-") ? "Industries" : RAILWAY_THINGS.has(tid) ? "Railway" : "Track",
        // A second engine before Signals: said, not barred (on a line of its own it runs fine).
        // (A harbour's stone: where it goes, "Needs 10🪨 at the workshop".)
        note: makeNote(progress, tid) ?? owedText(rule.cost, stock),
      });
    }
    rows.sort((a, b) => SHELVES.indexOf(a.shelf) - SHELVES.indexOf(b.shelf));
    const now = crafting.now;
    // What it's waiting for: goods in the workshop's yard, and coins.
    const nowRule = now ? ruleOf(now.id)! : null;
    const shortGoods = nowRule ? minus(nowRule.cost, workshopStock(game.world)) : {};
    const shortCoins = nowRule ? Math.max(0, (nowRule.coins ?? 0) - progress.coins) : 0;
    const need = now?.waiting ? [total(shortGoods) > 0 ? costTag(shortGoods) : "", shortCoins > 0 ? costTag({}, shortCoins) : ""].filter(Boolean).join(" ") || null : null;
    const yard = game.economy.depot(id)!;
    // What the planks it keeps are for: its waiting order, or the next industry (`shopSpare`); none if the yard
    // holds fewer, or it's only the spare.
    // (Or the number set on its stepper: then what they're for is said only for a waiting order needing more.)
    const set = yard.keeps[CARGO.planks.index];
    const spare = set ?? yardSpare.planks;
    const keeps = yardKeeps(progress, spare);
    const keptFor = keeps > capAt(yard) ? null : orderPlanks(progress) >= spare ? progress.orders[0] : set === null ? yardSpare.for : null;
    workshopPanel.show(now ? { label: thingLabel(now.id), fill: now.fill, waiting: need } : null, rows, {
      takesAll: yard.takesAll,
      keeps: Math.min(keeps, capAt(yard)),
      keptFor: keptFor ? thingLabel(keptFor) : undefined,
      cap: capAt(yard),
      school: game.economy.allDepots().some((d) => d.role === "school" && d.takesAll),
      keepRows: keepRowsOf(yard),
    });
  }

  // The open engine's line (both modes; Game mode once Train routes is learned): a colour and a name, its stops in
  // order (the one it's heading for marked), and, a stop tapped, what to do with it. Planning, a tap on a station or
  // depot on the map adds it (see `interaction.onPickPlace`). The economy works out what's loaded and dropped where
  // ("auto"); Drop and Pick up are kept as overrides.
  let routeShown = "";
  /** Planning the open engine's line: taps on places add them as stops. */
  let planning = false;
  /** How many lines the card offers a train on no line to run (those it can reach, nearest first). */
  const JOIN_SHOWN = 3;
  /** The engine whose card's "Run a line…" is open (its lines listed), or −1. */
  let joinOpen = -1;
  /** How long (ms) Delete in the line sheet waits for its second tap. */
  const LEAVE_ASK_MS = 4000;
  /** The stop whose chip was tapped (its actions shown), or −1. */
  let stopPicked = -1;
  /** The via point whose tools are showing (stop `k`'s via `i`), or none. */
  let viaPicked: { k: number; i: number } | null = null;
  /** Planning, "+ via" was tapped: the hint says to tap the track now (till a via point is added, or it's tapped again). */
  let viaAsked = false;
  /**
   * "Pass by" (routing spec §3.5): stop `k` becomes a via point on the way from the stop before (its own via points after
   * it), so trains go by its station without stopping.
   */
  const passBy = (l: RouteStopDef[], k: number) => {
    const piece = game.economy.depot(l[k].depotId)?.pieceId;
    const prev = l[(k - 1 + l.length) % l.length];
    prev.via = [...(prev.via ?? []), ...(piece !== undefined ? [piece] : []), ...(l[k].via ?? [])].slice(0, MAX_VIAS);
    l.splice(k, 1);
  };
  /**
   * Make a route edit (stops, a train joining or leaving a line) one undo step (audit F1): what `change` does to the
   * lines, from a snapshot before and after (`snapshotLines`); undone, the lines go back and a train that hasn't run on
   * since heads where it did before (`restoreLines`). Nothing recorded if nothing changed.
   */
  function routeEdit(change: () => void, then?: () => void): void {
    const before = snapshotLines(game.economy);
    change();
    const after = snapshotLines(game.economy);
    if (sameLines(before, after)) return;
    const economy = game.economy;
    // (`then`: what goes with the edit undone or redone that isn't the lines': trains on a ring turned round again.)
    editor.recordRoutes({
      undo: () => (restoreLines(economy, before, after), then?.()),
      redo: () => (restoreLines(economy, after, before), then?.()),
    });
    hud.setHistory(editor.canUndo, editor.canRedo);
  }
  // The line sheet (routes UX option B, src/ui/line-sheet.ts): one line edited at the bottom of the screen, run by
  // trains or none. Opened by a train card's Edit (its line, or its first route), a stop's chip, or a line in the Lines
  // list; "+ New line" opens it with no line, made at the first place tapped. While it's open the map is planning: a
  // place tapped is a stop on the sheet's line (`sheetEdit`), and the engine card gives way to it.
  /** The sheet's line, or −1: none yet (made at its first stop). */
  let sheetLine = -1;
  /** The train whose route the sheet plans (its card's Edit: its line is made with it on), or −1: a line on its own. */
  let sheetEngine = -1;
  /** Set just before `setPlanning(true)` by `openLineSheet`: the sheet's line and train are already chosen. */
  let sheetChosen = false;
  /** Opened from the Lines list: Done goes back there. */
  let sheetFromLines = false;
  let sheetTab: "stops" | "trains" = "stops";
  let sheetMenu = false;
  let sheetPalette = false;
  let sheetRenaming = false;
  let sheetDeleteAsked = false;
  const lineSheet = new LineSheet(hud.root, {
    done: () => donePlanning(),
    tab: (t) => ((sheetTab = t), (stopPicked = -1), (viaPicked = null), showSheet()),
    open: (k) => {
      stopPicked = stopPicked === k ? -1 : k;
      viaPicked = null;
      viaAsked = false;
      const line = game.economy.lines.get(sheetLine);
      if (!storeHintSeen && line && isStoreAt(line.stops[k]?.depotId ?? -1)) {
        storeHintSeen = true;
        saveFlag(STORE_HINT_KEY);
      }
      if (!stopHintSeen) {
        stopHintSeen = true;
        saveFlag(STOP_HINT_KEY);
      }
      showSheet();
    },
    openVia: (k, i) => {
      viaPicked = viaPicked?.k === k && viaPicked.i === i ? null : { k, i };
      stopPicked = -1;
      showSheet();
      const piece = game.economy.lines.get(sheetLine)?.stops[k]?.via?.[i];
      if (viaPicked && piece !== undefined) showVia(sheetEngine, piece);
    },
    ticks: (k, drop, pick) => {
      const line = game.economy.lines.get(sheetLine);
      const st = line?.stops[k];
      if (!line || !st) return;
      const action = actionOf(drop, pick);
      if (action) return sheetEdit((l) => (l[k].action = action, action === "drop" && delete l[k].waitFill));
      // Neither: the train passes by (a via point on the way from the stop before), where it can.
      const piece = game.economy.depot(st.depotId)?.pieceId;
      if (line.stops.length <= 2 || piece === undefined || !game.layout.getPiece(piece)) return hud.toast("A stop must drop or pick up: pass by needs 3 stops or more", false, 2500);
      sheetEdit((l) => passBy(l, k));
      stopPicked = -1;
      hud.toast(`Passes by ${placeName(st.depotId)} now, without stopping`, false, 2500);
    },
    wait: (k) => sheetEdit((l) => (l[k].waitFill = !l[k].waitFill)),
    move: (k, to) => {
      const line = game.economy.lines.get(sheetLine);
      if (!line || to < 0 || to >= line.stops.length || to === k) return;
      if (wouldRepeat(line.stops.map((st) => st.depotId), k, to)) return hud.toast("Not there: the same place twice in a row is one stop", false, 2500);
      if (!dragHintSeen) {
        dragHintSeen = true;
        saveFlag(DRAG_HINT_KEY);
      }
      sheetEdit((l) => moveStop(l, k, to));
      stopPicked = stopPicked === k ? to : stopPicked;
      showSheet();
    },
    remove: (k) => {
      sheetEdit((l) => {
        // (Its via points stay on the way, now from the stop before.)
        const via = l[k].via;
        if (via && l.length > 1) {
          const prev = l[(k - 1 + l.length) % l.length];
          prev.via = [...(prev.via ?? []), ...via];
        }
        l.splice(k, 1);
      });
      stopPicked = -1;
      showSheet();
    },
    viaStop: (k, i) => {
      const piece = game.economy.lines.get(sheetLine)?.stops[k]?.via?.[i];
      const depot = piece === undefined ? undefined : game.economy.depotAtPiece(piece);
      if (!depot) return;
      sheetEdit((l) => {
        const after = l[k].via!.splice(i);
        after.shift();
        if (l[k].via!.length === 0) delete l[k].via;
        l.splice(k + 1, 0, { depotId: depot.id, action: "auto", ...(after.length > 0 ? { via: after } : {}) });
      });
      viaPicked = null;
      stopPicked = k + 1;
      showSheet();
    },
    viaRemove: (k, i) => {
      sheetEdit((l) => {
        l[k].via!.splice(i, 1);
        if (l[k].via!.length === 0) delete l[k].via;
      });
      viaPicked = null;
      showSheet();
    },
    askVia: () => {
      viaAsked = !viaAsked;
      viaPicked = null;
      stopPicked = -1;
      showSheet();
    },
    startRename: () => ((sheetRenaming = true), (sheetPalette = false), (sheetMenu = false), showSheet()),
    rename: (name) => {
      sheetRenaming = false;
      if (sheetLine !== -1 && name.trim()) {
        renameLine(game.economy, sheetLine, name);
        linesChanged();
      }
      showSheet();
    },
    togglePalette: () => ((sheetPalette = !sheetPalette), (sheetMenu = false), showSheet()),
    recolour: (colour) => {
      sheetPalette = false;
      if (sheetLine !== -1) {
        recolourLine(game.economy, sheetLine, colour);
        linesChanged();
      }
      showSheet();
    },
    toggleMenu: () => ((sheetMenu = !sheetMenu), (sheetPalette = false), (sheetDeleteAsked = false), showSheet()),
    copy: () => {
      const from = game.economy.lines.get(sheetLine);
      if (!from) return;
      let made: { id: number; name: string } | null = null;
      routeEdit(() => (made = createLine(game.economy, from.stops)));
      const copy = made as { id: number; name: string } | null;
      if (!copy) return;
      hud.toast(`${copy.name}: a copy of ${from.name}, no train on it yet`, false, 2500);
      linesChanged();
      openLineSheet(copy.id, { tab: "trains", fromLines: sheetFromLines });
    },
    reverse: () => {
      sheetMenu = false;
      reverseWithTrains(sheetLine);
      showSheet();
    },
    remove_line: () => {
      const line = game.economy.lines.get(sheetLine);
      if (!line) return;
      if (!sheetDeleteAsked) {
        sheetDeleteAsked = true;
        showSheet();
        window.setTimeout(() => {
          if (!sheetDeleteAsked) return;
          sheetDeleteAsked = false;
          if (planning) showSheet();
        }, LEAVE_ASK_MS);
        return;
      }
      sheetDeleteAsked = false;
      const name = line.name;
      routeEdit(() => deleteLine(game.economy, line.id));
      hud.toast(`${name} deleted: its trains go anywhere now (Undo brings it back)`, false, 3000);
      linesChanged();
      sheetLine = -1;
      donePlanning();
    },
    showTrain: (engine) => {
      const at = trainSpot(engine);
      if (at) frameInRoom([at, at.clone().add(new Vector3(200, 0, 200))], 600);
    },
    takeOff: (engine) => {
      const line = game.economy.lines.get(sheetLine);
      routeEdit(() => stopLine(game.economy, engine));
      if (line) hud.toast(`${game.sim.nameOf(engine)} is off ${line.name}: it goes anywhere now`, false, 2500);
      // (The sheet stays its card's, if it came from one: Done goes back to that card.)
      linesChanged();
      showSheet();
    },
    addTrain: (engine) => {
      const line = game.economy.lines.get(sheetLine);
      if (!line) return;
      routeEdit(() => joinLine(game.economy, engine, line.id));
      hud.toast(`${game.sim.nameOf(engine)} runs ${line.name} now`, false, 2500);
      linesChanged();
      showSheet();
    },
    show: () => {
      sheetMenu = false;
      frameSheet(true);
      showSheet();
    },
  });

  /** A place's name, as the route's stops name them (a stop taken up by its kind). */
  const placeName = (depotId: number): string => routeStops(game.world).find((st) => st.depotId === depotId)?.name ?? lostStopName(game.world, depotId);

  /**
   * Open the sheet on line `id` (−1: a new line, made at its first stop) with no train's card: from the Lines list, a
   * copy, or + New line.
   */
  function openLineSheet(id: number, opts: { tab?: "stops" | "trains"; fromLines?: boolean; open?: number; menu?: boolean } = {}): void {
    if (planning) setPlanning(false);
    closeLines();
    interaction.clearSelection();
    hud.hideCards();
    sheetLine = id;
    sheetEngine = -1;
    sheetFromLines = opts.fromLines ?? false;
    sheetTab = opts.tab ?? "stops";
    sheetChosen = true;
    setPlanning(true);
    if (opts.open !== undefined) stopPicked = opts.open;
    // (A tip's Show me for Reverse: the ⋯ menu open, Reverse in it.)
    if (opts.menu) sheetMenu = true;
    showSheet();
  }

  /**
   * An edit to the sheet's line, one undo step (`routeEdit`): its stops through `change`. No line yet, it's made: with
   * the sheet's train on it (`editLine`, its first route), or on its own (`createLine`). Its last stop taken off, it's gone.
   */
  function sheetEdit(change: (l: RouteStopDef[]) => void): void {
    routeEdit(() => {
      if (sheetLine !== -1 && game.economy.lines.has(sheetLine)) {
        if (!editLineById(game.economy, sheetLine, change)) sheetLine = -1;
      } else if (sheetEngine !== -1 && game.sim.findCar(sheetEngine)) {
        sheetLine = editLine(game.economy, sheetEngine, change)?.id ?? -1;
      } else {
        const stops: RouteStopDef[] = [];
        change(stops);
        sheetLine = stops.length > 0 ? createLine(game.economy, stops).id : -1;
      }
    });
    showSheet();
    showRoute();
    linesChanged();
  }

  /** A line's stops the other way round; on a ring its trains turned round too (see `reverseLine`), said in a toast. */
  function reverseWithTrains(id: number): void {
    const line = game.economy.lines.get(id);
    if (!line || line.stops.length < 2) return;
    if (trainsOn(game.economy, id).length === 0) {
      routeEdit(() => editLineById(game.economy, id, reverseStops));
      hud.toast(`${line.name} runs the other way round now`, false, 2500);
      linesChanged();
      return;
    }
    // (On a line with ends its trains each keep heading for their stop, turning back at the ends as before. On a ring
    // they'd keep their way and go the long way round to each stop: each is lifted and turned round where it is
    // (reverseLine). Undone or redone, those turned are turned round again, so they run the line's way.)
    let out: ReturnType<typeof reverseLine> = null;
    routeEdit(
      () => (out = reverseLine(game.economy, id)),
      () => {
        const turned = out?.turned ?? [];
        if (turned.length > 0) turnTrains(game.economy, id, turned);
        lineNotes.delete(id);
      },
    );
    const r = out as ReturnType<typeof reverseLine>;
    if (!r) return;
    lineNotes.delete(id);
    if (r.ring && !tips.isDone("ring-reverse")) {
      tips.finish("ring-reverse");
      saveTips(tips.toJSON());
    }
    if (r.stuck.length > 0) {
      lineNotes.set(id, { order: stopOrder(id), engines: r.stuck.map((s) => s.engine), text: notTurnedText(r.stuck) });
      hud.toast(`${line.name} runs the other way round now, but ${r.stuck.length === 1 ? "one train" : `${r.stuck.length} trains`} couldn't be turned round: see why under it in Lines`, false, 4000);
    } else if (r.turned.length > 0) hud.toast(`${line.name} runs the other way round now: ${r.turned.length === 1 ? "its train turned round" : `its ${r.turned.length} trains turned round`}`, false, 2500);
    else hud.toast(`${line.name} runs the other way round now`, false, 2500);
    linesChanged();
  }

  /** A warehouse's or industry's own setting stopping what the line would drop or pick up there, said in words. */
  function blockedTexts(stops: readonly RouteStopDef[], plan: ReturnType<typeof game.economy.routePlan>): Set<string> {
    const blocked = new Set<string>();
    stops.forEach((st, k) => {
      const d = plan[k] && (plan[k].notDrops.length || plan[k].notPicks.length) ? game.economy.depot(st.depotId) : undefined;
      if (!d) return;
      // (An industry set not to give a good: in its own words; set to give none, one line for it.)
      if (!isStoreRole(d.role)) {
        const name = DEPOT_NAMES[d.role as keyof typeof DEPOT_NAMES] ?? "industry";
        if (RECIPES[d.role].gives.every((g) => storeModeOf(d, g) === "off")) blocked.add(givesBlockText(name, null));
        else for (const g of plan[k].notPicks) blocked.add(givesBlockText(name, g));
        return;
      }
      for (const g of plan[k].notDrops) blocked.add(storeBlockText(true, g, storeModeOf(d, g)));
      for (const g of plan[k].notPicks) blocked.add(storeBlockText(false, g, storeModeOf(d, g)));
    });
    return blocked;
  }

  /** A line's health and its words, from what its trains are doing. */
  function healthOf(id: number): LineHealth {
    const states = trainsOn(game.economy, id).flatMap((e) => {
      const found = game.sim.findCar(e);
      return found ? [trainState(game.sim, game.economy, found.train, found.train.cars[found.index].lever, whyCantMove())] : [];
    });
    return lineHealth(states);
  }

  /** What a line carries and how much lately: "Carries 🪵 logs and planks · 18 loads a month". */
  function carriesWords(id: number): string {
    const line = game.economy.lines.get(id);
    if (!line) return "";
    const goods = [...new Set(game.economy.routePlan(line.stops).flatMap((p) => p.picks))];
    const loads = loadsWords(game.economy.lineLoadsLately(id));
    const what = goods.length === 0 ? "" : `Carries ${goods.slice(0, 3).map(goodWords).join(", ")}${goods.length > 3 ? ` +${goods.length - 3} more` : ""}`;
    return [what, loads].filter(Boolean).join(" · ");
  }

  /** Free trains that can reach line `id` (track leads from them to one of its stops), nearest first, a few. */
  function freeFor(id: number, most = 3): number[] {
    const line = game.economy.lines.get(id);
    if (!line) return [];
    const pieces = line.stops.map((st) => game.economy.depot(st.depotId)?.pieceId ?? -1).filter((p) => p !== -1);
    return freeTrains((e) => {
      const front = trainFront(e);
      return !!front && pieces.some((p) => legFromCursor(game.layout, front, p) !== null);
    }, linePlaces(id)).slice(0, most);
  }
  /** The free trains list, cached: worked out (paths searched) only when what it depends on changes, or a second on. */
  let freeCache = { key: "", at: 0, free: [] as number[] };
  function freeCached(id: number): number[] {
    const key = `${id}|${game.trackVersion}|${game.layout.switchesVersion}|${game.sim.trainCount}|${game.economy.lineIdOf.size}|${game.economy.lines.get(id)?.stops.map((s) => s.depotId).join(",")}`;
    const now = performance.now();
    if (key !== freeCache.key || now - freeCache.at > 1000) freeCache = { key, at: now, free: freeFor(id) };
    return freeCache.free;
  }


  /** The sheet as it stands, built only when what it shows may have changed (a key); a train's status at most 4 a second. */
  let sheetKey = "";
  let sheetAt = 0;
  function showSheet(): void {
    if (!planning) {
      if (lineSheet.open) lineSheet.close();
      sheetKey = "";
      return;
    }
    const line = sheetLine === -1 ? undefined : game.economy.lines.get(sheetLine);
    if (sheetLine !== -1 && !line) sheetLine = -1;
    const engines = line ? trainsOn(game.economy, line.id) : [];
    const now = performance.now();
    const key = `${sheetLine}|${sheetEngine}|${line ? `${line.name}|${line.colour}|${line.stops.map((st) => `${st.depotId}${st.action}${st.waitFill ? "w" : ""}${st.via ? `.${st.via.join(".")}` : ""}`).join(",")}` : ""}|${game.economy.plansVersion}|${game.trackVersion}|${sheetTab}|${stopPicked}|${viaPicked ? `${viaPicked.k}.${viaPicked.i}` : ""}|${viaAsked}|${sheetMenu}|${sheetPalette}|${sheetRenaming}|${sheetDeleteAsked}|${engines.join(",")}|${game.economy.lineIdOf.size}|${engines.length > 0 ? game.economy.routeOf(engines[0])?.next : ""}`;
    // (Built again on a change, and, on the Trains tab while the game runs, 4 times a second: the trains' doings.)
    if (key === sheetKey && (sheetTab !== "trains" || game.paused || now - sheetAt < 250)) return;
    sheetKey = key;
    sheetAt = now;
    const names = routeStops(game.world);
    const nameOf = (id: number) => names.find((st) => st.depotId === id)?.name ?? lostStopName(game.world, id);
    const stops = line?.stops ?? [];
    const plan = game.economy.routePlan(stops);
    const stopNames = stops.map((st) => nameOf(st.depotId));
    const r = engines.length > 0 ? game.economy.routeOf(engines[0]) : undefined;
    const sheetStops: SheetStop[] = stops.map((st, k) => {
      const named = /^(.*\S) (\d+)$/.exec(stopNames[k]);
      const { drop, pick } = ticksOf(st.action);
      const said = stopPicked === k ? stopSentences(k, plan, stopNames) : { drops: [], picks: [] };
      const piece = game.economy.depot(st.depotId)?.pieceId;
      return {
        name: named ? named[1] : stopNames[k],
        ...(named ? { placeNum: named[2] } : {}),
        drop,
        pick,
        waitFill: !!st.waitFill,
        drops: (plan[k]?.drops ?? []).map(goodWords),
        picks: (plan[k]?.picks ?? []).map(goodWords),
        sentences: [...said.drops, ...said.picks],
        next: r?.next === k,
        lost: !names.some((x) => x.depotId === st.depotId),
        canPass: stops.length > 2 && piece !== undefined && !!game.layout.getPiece(piece),
        ...(isStoreAt(st.depotId) ? { note: storeStopText(st.action) } : {}),
        vias: (st.via ?? []).filter((v) => game.layout.getPiece(v)).map((v) => {
          const d = game.economy.depotAtPiece(v);
          return { name: d ? nameOf(d.id) : "", stop: !!d };
        }),
      };
    });
    const insertAfter = stopPicked >= 0 && stopPicked < stops.length - 1 ? stopNames[stopPicked] : "";
    const hint = viaAsked
      ? "Now tap the track or place to pass by"
      : stops.length === 0
        ? "Tap places on the map (a station, a town or an industry), in the order to visit them"
        : insertAfter
          ? `Places you tap now go after ${insertAfter}`
          : "Tap places on the map to add stops, or a stop above for its options";
    const warnings = [...(line ? blockedTexts(stops, plan) : [])];
    const lostNames = [...new Set(stops.filter((st) => !names.some((x) => x.depotId === st.depotId)).map((st) => lostStopName(game.world, st.depotId)))];
    for (const n of lostNames) warnings.push(lostStopWords(n));
    if (line && engines.length > 1) warnings.unshift(`Changes the line for all ${engines.length} of its trains`);
    const trains: SheetTrain[] =
      sheetTab === "trains"
        ? engines.flatMap((e) => (game.sim.findCar(e) ? [{ engine: e, name: game.sim.nameOf(e), status: engineView(game.sim, game.economy, e, (id) => nameOf(id), whyCantMove(), trainPlace).status }] : []))
        : engines.map((e) => ({ engine: e, name: game.sim.nameOf(e), status: "" }));
    const free: SheetFree[] =
      line && sheetTab === "trains"
        ? freeCached(line.id).map((e) => {
            const at = trainPlace(e);
            return { engine: e, name: game.sim.nameOf(e), where: at ? `near ${at}` : "free" };
          })
        : [];
    const health = line ? healthOf(line.id) : "none";
    const colour = line?.colour ?? nextColour(game.economy).colour;
    lineSheet.show({
      id: line?.id ?? -1,
      name: line?.name ?? "",
      colour,
      ink: inkOn(colour),
      tab: sheetTab,
      stops: sheetStops,
      open: stopPicked,
      openVia: viaPicked,
      trains,
      free,
      health,
      healthWords: HEALTH_WORDS[health],
      carries: line && sheetTab === "trains" ? carriesWords(line.id) : "",
      hint,
      warnings,
      viaAsked,
      menu: sheetMenu,
      palette: sheetPalette,
      renaming: sheetRenaming,
      deleteAsked: sheetDeleteAsked,
      palettes: LINE_COLOURS,
      nameMax: LINE_NAME_MAX,
      forTrain: sheetEngine !== -1 && !line ? game.sim.nameOf(sheetEngine) : "",
    });
  }

  /** Where the sheet's line is: its stops (their discs' tops too), via points, and its train (planning one's route). */
  function sheetPoints(): Vector3[] {
    const points: Vector3[] = [];
    if (sheetEngine !== -1) {
      const t = trainSpot(sheetEngine);
      if (t) points.push(t);
    }
    const middle = (pieceId: number): Vector3 | null => {
      const p = game.layout.getPiece(pieceId) ? pointOnPath(game.layout, pieceId, 0, pathLengthOf(pieceId) / 2) : null;
      return p ? new Vector3(p.x, p.y, p.z) : null;
    };
    for (const st of game.economy.lines.get(sheetLine)?.stops ?? []) {
      const spot = middle(game.economy.depot(st.depotId)?.pieceId ?? -1);
      if (spot) points.push(spot, spot.clone().setY(spot.y + 70));
      for (const v of st.via ?? []) {
        const at = middle(v);
        if (at) points.push(at);
      }
    }
    return points;
  }

  /** The sheet's whole line in the map's room above the sheet (only if it isn't already; `always`: Show). */
  function frameSheet(always = false): void {
    const points = sheetPoints();
    if (points.length === 1) points.push(points[0].clone().add(new Vector3(250, 0, 250)));
    if (points.length < 2 || (!always && inRoom(points))) return;
    frameInRoom(points, Math.min(game.camera.position.distanceTo(game.controls.target), 900), game.controls.maxDistance, points.length);
  }

  /**
   * The sheet's line drawn on the track when no train of the sheet's runs it (a line on its own): its ribbon round all
   * its stops, numbered discs. Built only when it changes (`ribbonKey`).
   */
  function showLineAlone(): boolean {
    const line = game.economy.lines.get(sheetLine);
    const scale = ribbonScale(game.camera.position.distanceTo(game.controls.target), game.canvas.clientHeight || 1, game.camera.fov);
    const key = `alone|${scale}|${sheetLine}|${game.trackVersion}|${game.layout.switchesVersion}|${line ? `${line.colour}|${line.stops.map((st) => `${st.depotId}${st.via ? `.${st.via.join(".")}` : ""}`).join(",")}` : "-"}`;
    if (key === ribbonKey) return true;
    ribbonKey = key;
    if (!routeView || routeLayout !== game.layout) {
      if (routeView) {
        game.scene.remove(routeView.group);
        routeView.dispose();
      }
      routeView = new RouteView(game.layout, game.mats);
      routeLayout = game.layout;
      game.scene.add(routeView.group);
      interaction.routeGroup = routeView.group;
    }
    cantReachText = null;
    if (!line) {
      routeView.clear();
      game.invalidate();
      return true;
    }
    const pieces = line.stops.map((st) => game.economy.depot(st.depotId)?.pieceId ?? -1);
    const legs = viaLegs(game.layout, line.stops.flatMap((st, k) => (pieces[k] === -1 ? [] : [{ piece: pieces[k], via: st.via }])), undefined, game.economy.router.ways.of(line.id));
    const ribbons: RibbonSpec[] = legs.flatMap((leg) => (leg ? [{ runs: leg, colour: line.colour }] : []));
    const discs = new Map<number, DiscSpec>();
    line.stops.forEach((st, k) => {
      if (pieces[k] === -1 || !game.layout.getPiece(pieces[k])) return;
      const d = discs.get(pieces[k]);
      if (!d) discs.set(pieces[k], { pieceId: pieces[k], label: `${k + 1}`, colour: line.colour, state: "stop", stop: k });
      else d.label += `·${k + 1}`;
      for (const v of st.via ?? []) if (!discs.has(v) && game.layout.getPiece(v)) discs.set(v, { pieceId: v, label: "", colour: line.colour, state: "stop", stop: k, via: true });
    });
    routeView.show(ribbons, [...discs.values()], [], scale);
    game.invalidate();
    return true;
  }

  /** "Tap a stop for options" is shown until a stop's chip is first tapped (remembered). */
  const STOP_HINT_KEY = "woodrail.hint.stopOptions";
  let stopHintSeen = loadFlag(STOP_HINT_KEY);
  /** "Tap the warehouse stop…" is shown on a line with a warehouse until a warehouse stop's chip is first tapped (remembered). */
  const STORE_HINT_KEY = "woodrail.hint.storeStop";
  let storeHintSeen = loadFlag(STORE_HINT_KEY);
  /** Is this depot a warehouse (it trades only with trains on a route: see warehouse-text.ts)? */
  const isStoreAt = (depotId: number) => { const role = game.economy.depot(depotId)?.role; return !!role && isStoreRole(role); };
  /**
   * The open engine card's live parts: what the train's doing, and which way its engine's front points on screen (the
   * way arrow follows the camera and the track). Cheap: a few lookups a frame, and the card redraws only on change.
   */
  const _a = new Vector3();
  const _b = new Vector3();
  /** Swap ends (the engine card): the engine runs round to the other end of its train, or turns if it can't. */
  function swapEnds(): void {
    const carId = interaction.openEngineCarId;
    if (carId === -1) return;
    const r = game.sim.runAround(carId);
    if (r === "moving") return hud.toast("Stop the train to swap ends", false, 2500);
    if (r === "no-room") return hud.toast("No room for the engine at the other end", false, 2500);
    if (r === "none") return;
    audio.rotate();
    const found = game.sim.findCar(carId);
    if (found) hud.updateEngineCard(found.train.cars[found.index].lever, game.following === carId);
    // It faces the open way now: Go sends it off engine first.
    hud.setEngineWay(1);
    if (game.following !== carId) keepEngineInView(carId);
    game.invalidate();
    onChange();
  }

  /** Continue (the engine card, at the end of the track): it turns round now and runs on to its next stop. */
  function continueTrain(): void {
    const carId = interaction.openEngineCarId;
    if (carId === -1) return;
    const r = continueOn(game.sim, game.economy, carId);
    if (r === "no-room") return hud.toast("No room to turn the train round here", false, 2500);
    if (r !== "continued") return;
    hud.setContinue(false);
    const found = game.sim.findCar(carId);
    if (found) hud.updateEngineCard(found.train.cars[found.index].lever, game.following === carId);
    game.invalidate();
    onChange();
  }

  /**
   * Leave now (the engine card, waiting for a full load): it goes on with what it has. This stop only, and nothing to
   * undo or save (`Economy.leaveNow`).
   */
  function leaveNow(): void {
    const carId = interaction.openEngineCarId;
    const found = carId === -1 ? null : game.sim.findCar(carId);
    if (!found || !game.economy.leaveNow(found.train.id)) return;
    hud.setLeaveNow(false);
    // (Its tip has done its job.)
    if (!tips.isDone("leave-now")) {
      tips.finish("leave-now");
      saveTips(tips.toJSON());
    }
    game.invalidate();
  }

  /** Why a train can't move at all, where engines have their limits (Game mode); in Sandbox any train can go. */
  const whyCantMove = (): CantMove | null => (game.sim.topSpeed ? (t) => cantMove(game.world, t) : null);

  /** Decouple (a card): split the train there, the part that goes standing a little apart. */
  function decouple(): void {
    const carId = interaction.selectedCarId;
    if (carId === -1) return;
    const before = game.sim.findCar(carId)?.train.id ?? -1;
    const r = game.sim.decouple(carId);
    if (r.kind === "moving") return hud.toast("Stop the train to decouple", false, 2500);
    if (r.kind === "alone") return hud.toast("Nothing coupled to uncouple there", false, 2500);
    if (r.kind !== "decoupled") return;
    audio.magnet(0.6, 0);
    // The gap is only a few mm: say which part keeps the engine.
    const mine = game.sim.findCar(carId)?.train.cars ?? [];
    const away = game.sim.getTrain(r.trainId === (game.sim.findCar(carId)?.train.id ?? -1) ? before : r.trainId)?.cars ?? [];
    hud.toast(decoupleWords(mine.map((c) => c.kind), away.map((c) => c.kind)), false, 2500);
    const found = game.sim.findCar(carId);
    if (found?.train.cars[found.index].kind === "engine") hud.updateEngineCard(found.train.cars[found.index].lever, game.following === carId);
    game.invalidate();
    onChange();
  }

  /**
   * Empty (the wagon card) or Delete cargo (the engine card, `all`): tip the goods out where the train stands, thrown away
   * (`Economy.dump`). Not undoable: undo is the track's and the land's, and no train action (Decouple, Swap ends) or
   * crane work is in it. A coach's riders stay on. The toast says what went, and a place on the map that takes it.
   */
  function emptyCars(all: boolean): void {
    const carId = all ? interaction.openEngineCarId : interaction.openCarCardId;
    const found = carId === -1 ? null : game.sim.findCar(carId);
    if (!found) return;
    const tipped: Tipped[] = [];
    let moving = false;
    for (const car of all ? found.train.cars : [found.train.cars[found.index]]) {
      const why = game.economy.dumpRefusal(car.id);
      if (why === "moving") moving = true;
      if (why !== null) continue;
      const t = game.economy.dump(car.id);
      if (t) addTipped(tipped, t);
    }
    if (tipped.length === 0) {
      if (moving) hud.toast("Stop the train first", false, 2500);
      return;
    }
    audio.clunk(0.5, 0);
    hud.toast(
      emptyWords(tipped, (kind) => {
        const d = game.economy.takerOf(kind);
        return d ? { name: depotName(game.world, d), town: d.role === "town" } : null;
      }),
      false,
      3000,
    );
    showSummary();
    showEmpty();
    game.invalidate();
    onChange();
  }

  /**
   * Empty and Delete cargo on the open card: shown while there are goods to tip out, greyed while the train moves. Keyed
   * by the car, the loads' stamp and whether it stands: the buttons are touched only when one changes.
   */
  let emptyKey = "";
  function showEmpty(): void {
    const engineId = interaction.openEngineCarId;
    const carId = engineId !== -1 ? engineId : interaction.openCarCardId;
    const found = carId === -1 ? null : game.sim.findCar(carId);
    if (!found) {
      emptyKey = "";
      return;
    }
    const standing = game.sim.standing(found.train);
    const key = `${engineId}:${carId}:${game.economy.loadsVersion}:${standing}:${found.train.cars.length}`;
    if (key === emptyKey) return;
    emptyKey = key;
    const why = standing ? "" : "Stop the train first";
    const loaded = (id: number): boolean => game.economy.cargoOf(id).count > 0;
    const anyLoaded = engineId !== -1 && found.train.cars.some((c) => loaded(c.id));
    hud.setEmpty({ shown: engineId === -1 && loaded(carId), why }, { shown: anyLoaded, why });
  }

  /**
   * The engine has run round to the other end of its train: if that's off screen or under the card, glide just far
   * enough to show it.
   */
  function keepEngineInView(carId: number): void {
    const found = game.sim.findCar(carId);
    if (!found) return;
    const w = found.train.world;
    const f = w[2 * found.index];
    const r = w[2 * found.index + 1];
    _a.set((f.x + r.x) / 2, (f.y + r.y) / 2, (f.z + r.z) / 2);
    const rect = game.canvas.getBoundingClientRect();
    const card = document.querySelector<HTMLElement>(".engine-card");
    const bottom = card && card.offsetParent ? Math.min(rect.bottom, card.getBoundingClientRect().top) : rect.bottom;
    // The visible area in NDC, with a margin so the engine isn't left on the very edge.
    const m = 56;
    const x0 = ((m / rect.width) * 2) - 1;
    const x1 = 1 - (m / rect.width) * 2;
    const y1 = 1 - (m / rect.height) * 2;
    const y0 = 1 - (2 * (bottom - rect.top - m)) / rect.height;
    if (y0 >= y1) return;
    _b.copy(_a).project(game.camera);
    const nx = Math.min(x1, Math.max(x0, _b.x));
    const ny = Math.min(y1, Math.max(y0, _b.y));
    if (nx === _b.x && ny === _b.y) return;
    // Where the screen point it should sit at falls on the engine's own level, and the shift between the two.
    const cam = game.camera.position;
    _b.set(nx, ny, 0.5).unproject(game.camera).sub(cam);
    if (_b.y >= 0) return;
    _b.multiplyScalar((_a.y - cam.y) / _b.y).add(cam);
    const t = game.controls.target;
    _b.set(t.x + _a.x - _b.x, t.y, t.z + _a.z - _b.z);
    game.director.glideTo(_b, cam.distanceTo(t), { duration: 0.6 });
  }

  /** The engine whose card the view was last shown for, and its status line as shown, and as it's been lately. */
  let viewCar = -1;
  let viewStanding = false;
  const viewStatus = { shown: "", next: "", since: 0 };
  /** Since when the open engine has stood at a stop (−1: it isn't): Leave now shows after LEAVE_SHOW_MS. */
  let stopSince = -1;
  const LEAVE_SHOW_MS = 1200;
  /** Who's in the open engine's way, with the status shown (and the latest, not shown yet): Show's and the fix's. */
  const viewBlocker: { shown: Blocker | null; next: Blocker | null } = { shown: null, next: null };
  /** A place the status shown says isn't on the train's line (it keeps goods that place takes): "Add …" offers it. */
  let viewAddStop = -1;
  /** The red signal the open engine stands at (its joint end), shown by Signal and tinted; −1: none. */
  let viewWaitAt = -1;
  function showEngineView(): void {
    const carId = interaction.openEngineCarId;
    if (carId === -1) {
      viewCar = -1;
      if (viewWaitAt !== -1) {
        viewWaitAt = -1;
        interaction.setWaitTint(-1);
      }
      return;
    }
    const found = game.sim.findCar(carId);
    if (!found) return;
    const lever = found.train.cars[found.index].lever;
    // The train changed its lever by itself (sent back from the end of the line): the card follows.
    if (lever !== hud.engineLeverShown) hud.updateEngineCard(lever, game.following === carId);
    // Held at its stop for spacing: one tap ("Go now") sends it on.
    hud.setGoNow(lever !== 0 && game.economy.spacingWait(carId) !== null);
    // Waiting to turn back where the track ends: Continue sends it on now.
    hud.setContinue(canContinue(game.sim, game.economy, carId));
    // Standing at a stop (worked by the crane, or waiting to fill): Leave now sends it on with what it has. Shown once
    // it has stood there LEAVE_SHOW_MS (a crane's quick unit doesn't flash it in and out), at once while it waits to
    // fill (the feature tip points at it).
    const atStop = game.economy.atStop(found.train.id) !== null;
    const clock = performance.now();
    if (!atStop || carId !== viewCar) stopSince = atStop ? clock : -1;
    else if (stopSince === -1) stopSince = clock;
    hud.setLeaveNow(atStop && (clock - stopSince >= LEAVE_SHOW_MS || game.economy.waitingToFill(found.train.id) !== null));
    const opened = carId !== viewCar;
    viewCar = carId;
    // Stopped (just opened on it, or come to a stand with the card open) with its front up against a buffer: Go
    // offers the open way.
    const standing = lever === 0 && found.train.speed === 0;
    if (standing && (opened || !viewStanding) && game.sim.engineBlocked(carId, 1) && !game.sim.engineBlocked(carId, -1)) hud.setEngineWay(-1);
    viewStanding = standing;
    // A town by its name; anything else as "the sawmill" ("the workshop 2" where there are more).
    const nameOf = (id: number) => {
      const d = game.economy.depot(id);
      const stop = routeStops(game.world).find((st) => st.depotId === id);
      if (d?.role === "town") return stop?.name ?? "the station";
      return `the ${(stop?.name ?? (d ? DEPOT_NAMES[d.role] : "depot")).toLowerCase()}`;
    };
    // A status shows once it's held a moment (a train being worked at the end of the line passes through several).
    const now = performance.now();
    const view = engineView(game.sim, game.economy, carId, nameOf, whyCantMove(), trainPlace, chainsShown());
    const latest = view.status;
    viewBlocker.next = view.blocker;
    if (latest !== viewStatus.next) {
      viewStatus.next = latest;
      viewStatus.since = now;
    }
    // ("Starting" shows at once: it answers the Go just pressed.)
    if (opened || latest === "Starting" || now - viewStatus.since >= STATUS_HOLD_MS) viewStatus.shown = latest;
    const status = viewStatus.shown;
    // (Show and the fix go with the status they belong to: the blocker of the status shown.)
    if (status === latest) {
      viewBlocker.shown = view.blocker;
      viewAddStop = view.addStop ?? -1;
    }
    const b = viewBlocker.shown;
    hud.setBlocker(!!b, b && b.car < 0 ? "points" : "train");
    // Standing at a red signal (a mark's): Signal beside it, and the line that signal guards tinted (signals audit U3).
    const redKey = game.layout.signalCount > 0 && game.sim.atRedSignal(found.train.id) ? game.sim.redSignalKeyAhead(found.train.id) : -1;
    const waitAt = redKey < 0 && redKey !== -1 ? (game.layout.getSignal(-1 - redKey)?.at ?? -1) : -1;
    if (waitAt !== viewWaitAt) {
      viewWaitAt = waitAt;
      interaction.setWaitTint(waitAt);
    }
    hud.setWaitSignal(waitAt !== -1);
    // A line with a train too many: Remove beside the status (with the status it belongs to).
    if (status === latest) hud.setCrowded(!!view.crowded);
    // (A train in the way, and a crane train on the map to lift it off: Send the crane.)
    hud.setSendCrane(!!b && b.car >= 0 && status.startsWith("Stuck") && game.economy.breakdown.canLift(b.car, carId) && !game.economy.breakdown.jobFor(b.car));
    // The engine's own front, as a screen direction (degrees clockwise from right).
    const snap = game.snapshot;
    let angle = 0;
    for (let i = 0; i < snap.count; i++) {
      if (snap.ids[i] !== carId) continue;
      const o = i * 6;
      const h = snap.transforms[o + 3];
      _a.set(snap.transforms[o], snap.transforms[o + 1], snap.transforms[o + 2]);
      _b.set(_a.x + Math.cos(h) * 60, _a.y, _a.z + Math.sin(h) * 60);
      _a.project(game.camera);
      _b.project(game.camera);
      // Screen x and y in the same units: the camera's aspect (kept on resize), no reading the page's layout.
      angle = (Math.atan2(-(_b.y - _a.y), (_b.x - _a.x) * game.camera.aspect) * 180) / Math.PI;
      break;
    }
    hud.setEngineView(status, angle);
  }

  /** Where a car is on the table, from the last snapshot (null: not on it). */
  function carAt(carId: number, out: Vector3): Vector3 | null {
    const snap = game.snapshot;
    for (let i = 0; i < snap.count; i++) {
      if (snap.ids[i] !== carId) continue;
      const o = i * 6;
      return out.set(snap.transforms[o], snap.transforms[o + 1], snap.transforms[o + 2]);
    }
    return null;
  }

  /** How near (mm) a stop or a town must be for a train to be named by it ("the train by Elder"). */
  const PLACE_NEAR = 900;
  /** The longest place name a card names a train by (two lines at 360 px, with the rest of the text). */
  const PLACE_NAME = 14;
  /**
   * Where a train (a car of it) is, as the player can find it: by the nearest stop's or town's name within
   * `PLACE_NEAR` ("Elder", "the sawmill"); "" when nowhere's that near. Asked only for a train in another's way.
   */
  function trainPlace(carId: number): string {
    const snap = game.snapshot;
    let i = 0;
    while (i < snap.count && snap.ids[i] !== carId) i++;
    if (i === snap.count) return "";
    const o = i * 6;
    // (Each place by its stretch of track, its piece's two ends: a town by its station's.)
    const places: NearPlace[] = [];
    const add = (pieceId: number | undefined, name: string) => {
      const p = pieceId === undefined ? undefined : game.layout.getPiece(pieceId);
      if (!p) return;
      const a = game.layout.worldConnector(connectorRef(p.id, 0), createWorldConnector());
      const b = game.layout.worldConnector(connectorRef(p.id, 1), createWorldConnector());
      places.push({ name, a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z } });
    };
    for (const t of game.world.landscape.towns) add(game.world.stations.get(t.id), t.name);
    for (const st of routeStops(game.world)) {
      const d = game.economy.depot(st.depotId);
      if (!d || d.role === "town") continue;
      add(d.pieceId, `the ${st.name.toLowerCase()}`);
    }
    return placeNear({ x: snap.transforms[o], z: snap.transforms[o + 2] }, snap.transforms[o + 3], places, PLACE_NEAR, PLACE_NAME);
  }

  /** What the breakdown cranes did (src/economy/breakdown.ts): a toast each, and a save once a train is put right. */
  function showCraneNews(): void {
    // (And trains called home by the Telegraph, come home: game/telegraph.ts.)
    for (const engine of game.economy.drainCameHome()) hud.toast(`${game.sim.nameOf(engine)} is home`);
    for (const e of game.economy.breakdown.drainEvents()) {
      if (e.kind === "sent") {
        if (e.auto) hud.toast(CRANE_TEXT.auto);
      } else if (e.kind === "rerailed" || e.kind === "removed") {
        const engine = e.kind === "rerailed" && e.goes ? game.sim.findCar(e.target)?.train.cars.find((c) => c.kind === "engine") : undefined;
        hud.toast(engine ? CRANE_TEXT.carriesOn(game.sim.nameOf(engine.id)) : CRANE_TEXT[e.kind]);
        scheduleSave();
      } else hud.toast(CRANE_TEXT[e.why]);
    }
  }

  /** "Send the crane" (the card of a stuck train): the nearest free crane train drives out to lift the train in its way off the line. */
  function sendCrane(): void {
    const engine = interaction.openEngineCarId;
    const found = engine === -1 ? null : game.sim.findCar(engine);
    const b = found ? blockerOf(game.sim, game.economy, trainState(game.sim, game.economy, found.train, found.train.cars[found.index].lever, whyCantMove())) : null;
    if (!b || b.car < 0) return;
    const r = game.economy.breakdown.send(b.car, "remove");
    hud.toast(r.ok ? CRANE_TEXT.sent : CRANE_TEXT[r.why]);
  }

  /**
   * Show (the card of a train waiting or stuck): the camera glides to the train in its way (and the points it waits
   * at, framing both), which flashes a moment (`flashBlocker`); the card stays open.
   */
  function showBlocker(): void {
    const engine = interaction.openEngineCarId;
    const found = engine === -1 ? null : game.sim.findCar(engine);
    // (Afresh: whatever's in the way now, not when the card last changed.)
    const b = found ? blockerOf(game.sim, game.economy, trainState(game.sim, game.economy, found.train, found.train.cars[found.index].lever, whyCantMove())) : null;
    if (!b) return;
    const pts: Vector3[] = [];
    if (b.car >= 0) for (const c of game.sim.findCar(b.car)?.train.cars ?? []) {
      const p = carAt(c.id, new Vector3());
      if (p) pts.push(p);
    }
    const piece = b.points >= 0 ? game.layout.getPiece(b.points) : undefined;
    if (piece) pts.push(new Vector3(piece.pose.x, piece.y, piece.pose.z));
    if (pts.length === 0) return;
    const centre = new Vector3();
    for (const p of pts) centre.add(p);
    centre.divideScalar(pts.length);
    let radius = 120;
    for (const p of pts) radius = Math.max(radius, p.distanceTo(centre) + 90);
    // (Following its own train: let go, or the camera rides straight back.)
    if (game.following !== -1) interaction.toggleFollow();
    const distance = Math.min(frameDistance(radius, game.camera.fov, game.camera.aspect), game.controls.maxDistance);
    game.director.glideTo(centre, distance, { duration: 0.7, inRoom: true });
    game.flashBlocker(b.car, b.points);
  }

  // The paint shop's sheet (game/paint-shop.ts): an engine painted from its card.
  // (Its code is loaded the first time it opens.)
  const paintSheet = lazy(async () => new (await import("./ui/paint-sheet")).PaintSheet({
    progress: () => progress,
    liveryOf: (id) => game.sim.liveryOf(id),
    nameOf: (id) => game.sim.nameOf(id),
    ownOpen: () => ownColoursOpen(progress),
    wagonsOf: (carId) => {
      const t = game.sim.findCar(carId)?.train;
      return t ? t.cars.filter((c) => c.id !== carId && c.kind !== "engine" && paintable(c.kind, game.sim.lookOf(c.id))).map((c) => c.id) : [];
    },
    pots: () => paintPots(game.world),
    paintOwn: (cars, body, trim) => {
      if (!paintOwn(progress, game.world, game.sim, cars, body, trim)) {
        audio.refuse();
        return false;
      }
      audio.chime();
      scheduleSave();
      return true;
    },
    paint: (carId, id) => {
      if (!paint(progress, game.sim, carId, id)) {
        audio.refuse();
        return false;
      }
      hud.setCoins(progress.coins);
      audio.chime();
      scheduleSave();
      scheduleSave("progress");
      return true;
    },
  }));

  hud.onEngineCardShown = () => {
    // The paint shop (Game mode, once a town is a Town): 🎨 on the engine's card.
    hud.paintBtn.hidden = !(mode === "game" && paintOpen(progress));
    showRoute();
    showEngineView();
    showSummary();
    showRefusals();
    showEmpty();
  };

  /**
   * Swap ends and Decouple greyed on the open card where they'd only be refused (moving, or nothing to uncouple), with
   * why. Its key changes only as the train starts or stops, or its make-up changes: the buttons are touched only then.
   */
  let refusalsKey = "";
  const REFUSED_WHY = { moving: "Stop the train first", alone: "Nothing coupled to uncouple", none: "" } as const;
  function showRefusals(): void {
    const engineId = interaction.openEngineCarId;
    const carId = engineId !== -1 ? engineId : interaction.openCarCardId;
    if (carId === -1) {
      refusalsKey = "";
      return;
    }
    const swap = engineId !== -1 ? game.sim.runAroundRefusal(engineId) : null;
    const dec = game.sim.decoupleRefusal(carId);
    const key = `${carId}:${swap}:${dec}`;
    if (key === refusalsKey) return;
    refusalsKey = key;
    hud.setCardRefusals(swap ? REFUSED_WHY[swap] : "", dec ? REFUSED_WHY[dec] : "");
  }

  /**
   * The engine card's train summary and the wagon card's load (#9): redrawn only when what they say could have changed
   * (the car, the loads' stamp, the train's make-up, its line), not per frame.
   */
  let summaryKey = "";
  const summaryCar = (c: { id: number; kind: string }): SummaryCar => {
    if (c.kind === "engine") return { kind: "engine" };
    if (c.kind === "passenger") return { kind: "coach", count: game.economy.ridersOf(c.id).count };
    const cargo = game.economy.cargoOf(c.id);
    return { kind: "wagon", cargo: cargo.kind, count: cargo.count };
  };
  function showSummary(): void {
    const engineId = interaction.openEngineCarId;
    const carId = engineId !== -1 ? engineId : interaction.openCarCardId;
    const found = carId === -1 ? null : game.sim.findCar(carId);
    if (!found) {
      summaryKey = "";
      return;
    }
    const cars = found.train.cars;
    const line = engineId !== -1 ? lineOf(game.economy, engineId) : undefined;
    const key = `${mode}:${engineId}:${carId}:${game.economy.loadsVersion}:${game.economy.carGoodsVersion}:${cars.length}:${cars[0].id}:${cars[cars.length - 1].id}:${line?.name ?? ""}`;
    if (key === summaryKey) return;
    summaryKey = key;
    if (engineId !== -1) {
      // Its top speed by its engines, against the classic's (Sandbox's are all the classic's); too heavy to move, none said.
      const l = engineLoad(game.world, found.train);
      const speed = mode !== "game" ? 1 : l.cars > l.pulls || l.engines.length === 0 ? 0 : Math.min(...l.engines.map((e) => e.speed));
      // (Its line's name isn't said again where the card's route section says it.)
      const s = trainSummary(cars.map(summaryCar), speed, mode === "sandbox" || progress.learned.has("routes") ? "" : (line?.name ?? ""));
      hud.setEngineSummary(s.about, s.load);
      hud.setCarGoods(null);
    } else {
      const car = cars[found.index];
      const room = car.kind === "passenger" ? (game.economy.seatsOf?.(car.id) ?? 0) : game.economy.wagonCapacity;
      // (What it carries, as switched on on its card; all switched off, all it could, beside "Carries nothing".)
      const all = CARRIES[car.kind];
      const on = all?.filter((k) => game.economy.carTakes(car.id, k));
      const carries = on && on.length > 0 ? on : all;
      hud.setCarLoad(car.kind === "passenger" && room === 0 ? "" : carries || car.kind === "passenger" ? carLoadWords(summaryCar(car), room, carries) : "");
      // A wagon carrying more than one kind of goods: which of them it takes, on or off each.
      hud.setCarGoods(
        all && all.length > 1
          ? { rows: all.map((k) => ({ kind: k, on: game.economy.carTakes(car.id, k) })), same: cars.some((c) => c.kind === car.kind && c.id !== car.id) }
          : null,
      );
    }
  }
  /** The stop whose tools were last scrolled into view on the card ("engine:stop"; see `showRoute`). */
  /** The stop the open card's next mark was last drawn on (its engine): a mark that moves pops, so the player sees it go. */
  let nextDrawn = { carId: -1, next: -1 };
  /** A stop's chip lifted to drag (`stopDrag`): the card holds still till it's let go. */
  let stopDragging = false;
  /** The stop just dropped by a drag: its chip pops once, where it went (−1: none). */
  let stopDropped = -1;
  const DRAG_HINT_KEY = "woodrail.hint.stopDrag";
  let dragHintSeen = loadFlag(DRAG_HINT_KEY);
  function showRoute(): void {
    const carId = interaction.openEngineCarId;
    const allowed = mode === "sandbox" || progress.learned.has("routes");
    // The line sheet open on a line of its own (no train's card): it's all there is to show.
    if (planning && sheetEngine === -1 && allowed) {
      if (routeShown !== "") hud.engineExtra.hidden = true;
      routeShown = "";
      showSheet();
      return;
    }
    if (carId === -1 || !allowed) {
      if (routeShown !== "") hud.engineExtra.hidden = true;
      routeShown = "";
      nextDrawn = { carId: -1, next: -1 };
      setPlanning(false);
      // (The card closed: a stop or via picked is let go; it opens again on the route as a whole.)
      stopPicked = -1;
      viaPicked = null;
      stopDragging = false;
      return;
    }
    // (A chip held up: rebuilt when it's let go, not under the finger.)
    if (stopDragging) return;
    // Planning, the sheet stands in for the card (hidden: `.planning .engine-card`).
    if (planning) {
      routeShown = "";
      showSheet();
      return;
    }
    const stops = routeStops(game.world);
    const line = lineOf(game.economy, carId);
    const r = game.economy.routeOf(carId);
    const riders = line ? trainsOn(game.economy, line.id).length : 0;
    const others = line ? "" : [...game.economy.lines.values()].map((l) => `${l.id}${l.colour}${l.name}`).join(",");
    const key = `${carId}:${joinOpen === carId}:${game.trackVersion}:${game.layout.switchesVersion}:${stops.length}:${planning}:${stopPicked}:${stopHintSeen}:${storeHintSeen}:${game.economy.plansVersion}:${cantReachText}:${riders}:${others}:${line ? `${line.id}|${line.colour}|${line.name}|${r?.next}|${line.stops.map((st) => `${st.depotId}${st.action}${st.waitFill ? "w" : ""}${st.via ? `.${st.via.join(".")}` : ""}`).join(",")}` : "-"}:${viaPicked ? `${viaPicked.k}.${viaPicked.i}` : ""}:${viaAsked}:${wayNote.carId === carId && performance.now() < wayNote.until}:${viewAddStop}`;
    if (key === routeShown) return;
    routeShown = key;
    const box = hud.engineExtra;
    box.innerHTML = "";
    box.hidden = stops.length === 0;
    box.classList.add("route");
    // (A stop taken up isn't among the places: named by its kind, and said below.)
    const nameOf = (id: number) => stops.find((st) => st.depotId === id)?.name ?? lostStopName(game.world, id);
    const edit = (change: (l: RouteStopDef[]) => void) => {
      routeEdit(() => editLine(game.economy, carId, change));
      showRoute();
      routeChanged();
      scheduleSave();
    };
    const button = (text: string, cls: string, tip: string, onClick: () => void) => {
      const el = document.createElement("button");
      el.className = `chip text ${cls}`;
      el.textContent = text;
      el.title = tip;
      el.addEventListener("click", onClick);
      return el;
    };
    const head = document.createElement("div");
    head.className = "route-head";
    const label = document.createElement("span");
    label.className = "engine-extra-label";
    if (line) {
      const swatch = document.createElement("i");
      swatch.className = "route-swatch";
      swatch.style.background = line.colour;
      label.append(swatch, Object.assign(document.createElement("span"), { className: "route-line-text", textContent: planning ? `Editing ${line.name}` : line.name }));
      // Its trains, where it has more than this one; the name opens the Lines list (a row there opens its sheet: rename,
      // recolour, Reverse, Copy).
      if (riders > 1) label.append(Object.assign(document.createElement("span"), { className: "route-riders", textContent: `· ${riders} trains` }));
      label.classList.add("route-line-name");
      // (A pencil: the name can be tapped, to rename or recolour the line. Audit F17: it read as a label.)
      label.append(Object.assign(document.createElement("span"), { className: "route-line-edit", textContent: "✎" }));
      label.setAttribute("role", "button");
      label.title = "Lines: every line; tap this one to rename it, recolour it or reverse it";
      label.addEventListener("click", () => openLines());
    } else label.textContent = "Route";
    head.append(label);
    // Lines this train could run (track leads to one of their stops from it), nearest first: offered behind one chip
    // (lines stand alone now, so there may be many: a row of them made the card taller than a small phone).
    const reach =
      !line && !planning && game.economy.lines.size > 0
        ? (() => {
            const front = trainFront(carId);
            const out = [...game.economy.lines.values()].flatMap((l) => {
              let best = Infinity;
              for (const st of l.stops) {
                const piece = game.economy.depot(st.depotId)?.pieceId;
                const leg = front && piece !== undefined ? legFromCursor(game.layout, front, piece) : null;
                if (leg) best = Math.min(best, runsLength(leg));
              }
              return best < Infinity || !front ? [{ l, best }] : [];
            });
            return out.sort((a, b) => a.best - b.best);
          })()
        : [];
    if (!line && !planning && reach.length > 0) {
      const run = button("Run a line…", "route-join-open", "Put this train on a line that already runs near it", () => {
        joinOpen = joinOpen === carId ? -1 : carId;
        showRoute();
      });
      run.setAttribute("aria-expanded", String(joinOpen === carId));
      head.append(run);
    } else if (!line && !planning) {
      const any = document.createElement("span");
      any.className = "route-none";
      any.textContent = "Goes anywhere, works at every stop";
      head.append(any);
    }
    // Edit (or Plan a route): the line sheet, where its stops and trains are changed (and a train taken off it).
    head.append(button(line ? "Edit" : "Plan a route", "route-plan", "Tap stations and depots to add them as stops, in order (and track, to go that way)", () => setPlanning(true)));
    box.append(head);
    // "Run a line…" tapped: the lines it can reach, at most `JOIN_SHOWN`, nearest first; the rest in the Lines list.
    if (!line && !planning && joinOpen === carId && reach.length > 0) {
      const join = document.createElement("div");
      join.className = "route-join";
      for (const { l } of reach.slice(0, JOIN_SHOWN)) {
        const b = button(l.name, "route-join-line", `Run this train on ${l.name}`, () => {
          joinOpen = -1;
          routeEdit(() => joinLine(game.economy, carId, l.id));
          showRoute();
          routeChanged();
          scheduleSave();
        });
        b.style.setProperty("--line", l.colour);
        join.append(b);
      }
      if (reach.length > JOIN_SHOWN) join.append(button("All lines…", "route-join-all", "Every line, in the Lines list", () => openLines()));
      box.append(join);
    }
    // Editing a line its other trains run too: it says so.
    if (planning && riders > 1) {
      const shared = document.createElement("div");
      shared.className = "route-hint";
      shared.textContent = `Changes the line for all ${riders} of its trains`;
      box.append(shared);
    }
    // (Only before the first stop: then the stops say it, and the card stays a slim bar over the map.)
    if (planning && !line) {
      const hint = document.createElement("div");
      hint.className = "route-hint";
      hint.textContent = "Tap stations and depots on the map, in the order the train should visit them";
      box.append(hint);
    }
    if (line) {
      // What a train on the line picks up and drops at each stop (the economy's own rules), under each chip as icons.
      const plan = game.economy.routePlan(line.stops);
      const strip = document.createElement("div");
      strip.className = "route-stops";
      const viaCount = line.stops.reduce((n, st) => n + (st.via ?? []).filter((v) => game.layout.getPiece(v)).length, 0);
      let viaNumber = 0;
      line.stops.forEach((st, k) => {
        const chip = button("", "route-chip", "Tap for this stop's options", () => {
          // (Its options are in the line sheet: it opens with this stop open.)
          setPlanning(true);
          stopPicked = k;
          viaPicked = null;
          if (!stopHintSeen) {
            stopHintSeen = true;
            saveFlag(STOP_HINT_KEY);
          }
          if (!storeHintSeen && isStoreAt(st.depotId)) {
            storeHintSeen = true;
            saveFlag(STORE_HINT_KEY);
          }
          showRoute();
        });
        // Its number always (the order), filled in the line's colour on the stop the train's heading for: the ▶ that
        // marked it took the number's place, and ▶ also meant "visit later" in the tools under it (audit F7).
        // (A place's own number, "Forest yard 2", in a lighter weight: it's not the stop's. Audit F17.)
        const named = /^(.*\S) (\d+)$/.exec(nameOf(st.depotId));
        chip.append(Object.assign(document.createElement("span"), { className: "route-num", textContent: `${k + 1}` }), named ? named[1] : nameOf(st.depotId));
        if (named) chip.append(Object.assign(document.createElement("span"), { className: "route-place-num", textContent: ` ${named[2]}` }));
        chip.dataset.stop = String(k);
        chip.classList.toggle("next", r?.next === k);
        if (r?.next === k) {
          chip.setAttribute("aria-current", "step");
          chip.title = "The train's heading here next. Tap for this stop's options";
        }
        // (The next mark moved on this card: to the stop the train comes to first, once the line has two, or on as it runs.)
        chip.classList.toggle("moved", r?.next === k && nextDrawn.carId === carId && nextDrawn.next !== -1 && nextDrawn.next !== k);
        chip.classList.toggle("lost", !stops.some((x) => x.depotId === st.depotId));
        chip.classList.toggle("picked", stopPicked === k);
        chip.classList.toggle("dropped", stopDropped === k);
        // (Only drop or Only pick up: said on the chip itself, beside its name, so it shows without tapping it.)
        if (st.action === "drop" || st.action === "pick") {
          chip.dataset.intent = st.action;
          chip.append(Object.assign(document.createElement("span"), { className: "route-intent", textContent: st.action === "drop" ? "only ⬇" : "only ⬆" }));
        }
        if (st.waitFill) chip.dataset.wait = "1";
        const icons = plan[k] ? planIcons(plan[k]) : "";
        if (icons) {
          chip.classList.add("has-goods");
          chip.append(Object.assign(document.createElement("span"), { className: "route-goods", textContent: icons }));
        }
        chip.style.setProperty("--line", line.colour);
        strip.append(chip);
        // Its via points: "via ●" chips after it (passed on the way to the next stop, in order), numbered along the line
        // where it has more than one. A tap picks one, and shows it on the map (audit F6: they couldn't be told apart).
        (st.via ?? []).forEach((v, i) => {
          if (!game.layout.getPiece(v)) return;
          viaNumber++;
          const via = button(viaCount > 1 ? `via ${viaNumber} ` : "via ", "route-chip route-via", "Goes this way (no stop): tap for options", () => {
            setPlanning(true);
            viaPicked = { k, i };
            stopPicked = -1;
            showRoute();
            showVia(carId, v);
          });
          const dot = document.createElement("i");
          dot.className = "route-via-dot";
          via.append(dot);
          via.classList.toggle("picked", viaPicked?.k === k && viaPicked.i === i);
          via.style.setProperty("--line", line.colour);
          strip.append(via);
        });
      });
      box.append(strip);
      stopDropped = -1;
      // Held, a stop's chip lifts and drags along the strip to another place in the order (the card's own edit: Undo
      // takes it back, and each train keeps heading for the stop it was).
      stopDrag(strip, {
        places: line.stops.map((st) => st.depotId),
        start: () => (stopDragging = true),
        move: (from, to) => {
          if (!dragHintSeen) {
            dragHintSeen = true;
            saveFlag(DRAG_HINT_KEY);
          }
          stopDropped = to;
          edit((l) => {
            moveStop(l, from, to);
            stopPicked = to;
          });
        },
        refused: () => hud.toast("Not there: the same place twice in a row is one stop", false, 2500),
        // (Rebuilt only if something changed: a slow tap, let go where it was, is a tap, and its click picks the stop.)
        end: () => {
          stopDragging = false;
          showRoute();
        },
      });
      nextDrawn = { carId, next: r?.next ?? -1 };
      // Stops beyond the edge (scrolled sideways): the edge fades, as the tray's does.
      const edges = () => {
        strip.classList.toggle("more-right", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
        strip.classList.toggle("more-left", strip.scrollLeft > 2);
      };
      strip.addEventListener("scroll", edges, { passive: true });
      requestAnimationFrame(() => {
        // The picked stop (else, planning, the last, just added; else the one it's heading for) scrolled into view,
        // whole, with a whole chip at the strip's start (the strip snaps to chips' starts: one cut at the start read as
        // a stop missing, critique 2026-11-05). Heading for a stop, the one before it shows too, where it fits.
        const chips = [...strip.querySelectorAll<HTMLElement>(".route-chip")];
        const target = strip.querySelector<HTMLElement>(".route-chip.picked") ?? (planning ? chips.at(-1) : strip.querySelector<HTMLElement>(".route-chip.next")) ?? null;
        if (target) {
          const fade = 36;
          // The furthest left it may start and still show the target whole, short of the right edge's fade.
          const least = target.offsetLeft + target.offsetWidth - strip.clientWidth + fade;
          const before = target.previousElementSibling as HTMLElement | null;
          let left = !planning && before && before.offsetLeft >= least ? before.offsetLeft : Math.min(target.offsetLeft, Math.max(0, least));
          // On a chip's start: the first at or after it (or the target's own).
          left = chips[0] === target ? 0 : (chips.find((c) => c.offsetLeft >= left)?.offsetLeft ?? target.offsetLeft);
          // (Room at the end for it, where the chips after it are too few to fill the strip: the end's blank grows.)
          const short = left - (strip.scrollWidth - strip.clientWidth);
          strip.style.setProperty("--end", `${36 + Math.max(0, Math.ceil(short))}px`);
          strip.scrollLeft = left;
        }
        edges();
      });
      // The first time, a word on what a chip does (till one is tapped); on a line with a warehouse, till its chip is.
      const storeHint = !storeHintSeen && line.stops.some((st) => isStoreAt(st.depotId));
      if ((!stopHintSeen || storeHint) && stopPicked === -1 && !viaPicked && !planning) {
        const hint = document.createElement("div");
        hint.className = "route-hint";
        hint.textContent = storeHint ? "Tap the warehouse stop to set whether it drops or picks up there" : "Tap a stop for options";
        box.append(hint);
      }
      // A warehouse stop where the route would drop or pick up a good but the warehouse's own setting says no (the
      // stricter wins): said, so the plan's missing ⬆ or ⬇ isn't a mystery.
      for (const text of blockedTexts(line.stops, plan)) box.append(Object.assign(document.createElement("div"), { className: "route-warn route-store-block", textContent: text }));
      // A stop whose place was taken up: said, by name (the train runs on past it; undo brings it back).
      const lost = [...new Set(line.stops.filter((st) => !stops.some((x) => x.depotId === st.depotId)).map((st) => lostStopName(game.world, st.depotId)))];
      for (const name of lost) {
        const warn = document.createElement("div");
        warn.className = "route-warn route-lost";
        warn.textContent = lostStopWords(name);
        box.append(warn);
      }
      // The status says a place it passes isn't on its line: one tap adds it, before the stop it's heading for (it's
      // on the way there now). Audit F15: the text said to Edit, then tap the place: three taps.
      const addId = viewAddStop;
      if (!planning && addId !== -1 && !line.stops.some((st) => st.depotId === addId) && game.economy.depot(addId)) {
        const row = document.createElement("div");
        row.className = "route-fix";
        const add = button(`Add ${nameOf(addId)}`, "route-add-stop", `Make ${nameOf(addId)} a stop on this line`, () => {
          edit((l) => {
            const at = Math.min(r?.next ?? l.length, l.length);
            // (Not the same place twice in a row: that's one visit.)
            if (l[at - 1]?.depotId !== addId && l[at % l.length]?.depotId !== addId) l.splice(at, 0, { depotId: addId, action: "auto" });
          });
          viewAddStop = -1;
        });
        row.append(add);
        box.append(row);
      }
      if (wayNote.carId === carId && performance.now() < wayNote.until) {
        box.append(Object.assign(document.createElement("div"), { className: "route-hint route-way-changed", textContent: "Goes another way now: the track changed" }));
      }
      const why = cantReach();
      if (why) {
        const warn = document.createElement("div");
        warn.className = "route-warn";
        warn.textContent = why;
        box.append(warn);
      }
    }
  }

  /**
   * A via chip picked: its piece shown on the map (with the stops either side of it, if the view must move), and its
   * disc pops, so the player sees which it is. One glide and a 0.35 s pop; nothing after.
   */
  function showVia(carId: number, pieceId: number): void {
    const at = pieceSpot(pieceId);
    if (!at) return;
    requestAnimationFrame(() => {
      const points = [at, at.clone().setY(at.y + 50)];
      if (!inRoom(points)) frameInRoom(points.concat(routePoints(carId)), Math.min(game.camera.position.distanceTo(game.controls.target), 900), FRAME_MAX, 2);
      routeView?.popViaAt(pieceId, performance.now() / 1000);
      discsMoving = true;
      game.invalidate();
    });
  }

  /**
   * Done: planning ends, and once the card has its full height again the view glides (once) to show the whole route
   * above it (audit F5: the card came back over what the player had just made).
   */
  function donePlanning(): void {
    const carId = interaction.openEngineCarId;
    const back = sheetFromLines || sheetEngine === -1;
    setPlanning(false);
    // (A line on its own, from the Lines list or + New line: back to the list.)
    if (back) {
      routeChanged();
      showRibbon();
      if (game.economy.lines.size > 0) openLines();
      return;
    }
    // (Two frames: the card's new height laid out, and the director's room measured from it.)
    requestAnimationFrame(() => requestAnimationFrame(() => frameRoute(carId)));
    // (And a look every 300 ms for 3 s, each when no glide is running: whenever the card has its full height by then,
    // the route is framed above it. Each look does nothing while the route is in view. QA: on a busy page the first
    // look still saw the slim bar, and timers and frames came in any order.)
    for (let t = 300; t <= 3000; t += 300)
      window.setTimeout(() => {
        if (!game.director.busy && !planning) frameRoute(carId);
      }, t);
  }

  /** Where the open engine's route is on the map: the train, each stop (its disc's top too) and each via point. */
  function routePoints(carId: number): Vector3[] {
    const points: Vector3[] = [];
    const train = trainSpot(carId);
    if (train) points.push(train);
    // (Each piece by its middle, where its disc stands: a piece's pose is its start, 108 mm or more off. QA: the route
    // was framed by the starts, and its discs were left under the card.)
    const middle = (pieceId: number): Vector3 | null => {
      const p = game.layout.getPiece(pieceId) ? pointOnPath(game.layout, pieceId, 0, pathLengthOf(pieceId) / 2) : null;
      return p ? new Vector3(p.x, p.y, p.z) : null;
    };
    for (const st of lineOf(game.economy, carId)?.stops ?? []) {
      const spot = middle(game.economy.depot(st.depotId)?.pieceId ?? -1);
      if (spot) points.push(spot, spot.clone().setY(spot.y + 70));
      for (const v of st.via ?? []) {
        const at = middle(v);
        if (at) points.push(at);
      }
    }
    return points;
  }

  /**
   * Show the open engine's whole route in the map's room (above the card or the planning bar): nothing moves if it's all
   * there already; else the view glides (out, if it must) to frame it all, never closer in than now or 900 mm. Not while
   * the camera follows the train (it keeps the train in the room itself).
   */
  function frameRoute(carId: number): void {
    if (carId === -1 || carId !== interaction.openEngineCarId || game.following === carId) return;
    const points = routePoints(carId);
    if (points.length < 2 || inRoom(points)) return;
    frameInRoom(points, Math.min(game.camera.position.distanceTo(game.controls.target), 900), game.controls.maxDistance, points.length);
  }

  /**
   * Planning (the line sheet open, on): a place tapped on the map is a stop on the sheet's line. Opened from a train's
   * card, the sheet plans that train's line (made with it on at the first stop); `openLineSheet` chooses a line first.
   */
  function setPlanning(on: boolean, frame = true): void {
    if (planning === on) {
      sheetChosen = false;
      return;
    }
    planning = on;
    if (on && !sheetChosen) {
      sheetEngine = interaction.openEngineCarId;
      sheetLine = lineOf(game.economy, sheetEngine)?.id ?? -1;
      sheetFromLines = false;
      sheetTab = "stops";
    }
    sheetChosen = false;
    sheetMenu = sheetPalette = sheetRenaming = sheetDeleteAsked = false;
    hud.setMapTaps("planning", on);
    stopPicked = -1;
    // (A piece carried, or waiting at an end, is put away: a click on the map picks a stop now.)
    if (on) interaction.arm(null);
    // Planning, the map wants the room: the sheet stands in for the card, the tray goes, and the view frames the
    // train and its line's places above the sheet (not when it goes on after the map: see `openMap`).
    hud.setPlanning(on);
    viaPicked = null;
    viaAsked = false;
    // (A press picks a stop while planning: the eraser's put down.)
    if (on) interaction.setErasing(false);
    if (on && frame) requestAnimationFrame(() => (sheetEngine !== -1 ? framePlanning() : frameSheet()));
    const sheetStops = () => game.economy.lines.get(sheetLine)?.stops ?? [];
    // A stop's disc tapped: that place again (A → B → A); its own stop open where it's the last.
    interaction.onTapStopDisc = on
      ? (index) => {
          const stops = sheetStops();
          const depotId = stops[index]?.depotId;
          if (depotId === undefined) return;
          if (stops.at(-1)?.depotId === depotId) {
            stopPicked = stops.length - 1;
            sheetTab = "stops";
            showSheet();
          } else interaction.onPickPlace?.(depotId);
        }
      : null;
    interaction.onLeavePlanning = on ? () => setPlanning(false) : null;
    // A town with no station, an old industry's ruin: said, short.
    interaction.onNoStation = on ? (text) => hud.toast(text, false, 2500) : null;
    // Plain track tapped: a via point on the way from the last stop to the next (one already on that way tapped again:
    // picked; one on another leg is added again for this one, so a line can go by the same track both ways).
    const addVia = (pieceId: number): boolean => {
      const stops = sheetStops();
      if (stops.length === 0) {
        hud.toast("Tap a place first, then the track to go by");
        return true;
      }
      const last = stops.length - 1;
      if (stops[last].via?.includes(pieceId)) {
        const i = stops[last].via!.indexOf(pieceId);
        viaPicked = viaPicked?.k === last && viaPicked.i === i ? null : { k: last, i };
        stopPicked = -1;
        sheetTab = "stops";
        showSheet();
        return true;
      }
      if ((stops[last].via?.length ?? 0) >= MAX_VIAS) {
        hud.toast("That's plenty of via points for one stop");
        return true;
      }
      sheetEdit((l) => (l[last].via = [...(l[last].via ?? []), pieceId]));
      hud.toast("Passes by here: the train goes this way, without stopping");
      viaPicked = null;
      viaAsked = false;
      stopPicked = -1;
      showSheet();
      requestAnimationFrame(() => frameSheet());
      return true;
    };
    interaction.onPickVia = on ? addVia : null;
    interaction.onPickPlace = on
      ? (depotId) => {
          // "+ Pass by…" asked: the place is passed by, not stopped at.
          const piece = game.economy.depot(depotId)?.pieceId;
          if (viaAsked && piece !== undefined) return addVia(piece);
          // A stop open: places tapped go in after it, in order (audit F13). Else at the end.
          const after = stopPicked;
          let at = -1;
          sheetEdit((l) => {
            at = after >= 0 && after < l.length ? after + 1 : l.length;
            // The same place twice in a row is one visit: not added again.
            if (l[at - 1]?.depotId === depotId || (at < l.length && l[at].depotId === depotId)) {
              at = -1;
              return;
            }
            l.splice(at, 0, { depotId, action: "auto" });
          });
          if (at !== -1 && after >= 0 && at < sheetStops().length - 1) stopPicked = at;
          sheetTab = "stops";
          showSheet();
          // The whole line stays in view, not just the place tapped (audit F5). Measured once the sheet has grown.
          requestAnimationFrame(() => frameSheet());
          return true;
        }
      : null;
    if (!on) {
      lineSheet.close();
      sheetKey = "";
      routeChanged();
    }
    showRoute();
    showSheet();
  }

  /**
   * The room the map has on screen (canvas pixels): below the top bar (and the goals), above the tray, a card or the
   * camera coach (QA 2026-11-03: Show me framed a station under it), or
   * beside a card docked at the right (see `viewRoom`); the whole view where too little is left. One measure for every
   * framing (the director's too: `roomOf`).
   */
  function measureRoom(): (ViewRoom & { width: number; height: number }) | null {
    const r = game.canvas.getBoundingClientRect();
    const rel = (e: Element) => {
      const b = e.getBoundingClientRect();
      return { left: b.left - r.left, top: b.top - r.top, right: b.right - r.left, bottom: b.bottom - r.top };
    };
    const room = viewRoom(r.width, r.height, [...document.querySelectorAll(".hud .brand, .hud .actions, .hud .goals")].map(rel), [...document.querySelectorAll(".hud .tray, .hud .tray-draw, .hud .tray-orient, .hud .card, .hud .coach")].map(rel));
    return room && { ...room, width: r.width, height: r.height };
  }
  function mapRoom(): ViewRoom & { width: number; height: number } {
    const room = measureRoom();
    if (room) return room;
    const r = game.canvas.getBoundingClientRect();
    return { left: 0, top: 0, right: r.width, bottom: r.height, width: r.width, height: r.height };
  }

  /** A piece's middle, on the ground. */
  const pieceSpot = (pieceId: number): Vector3 | null => {
    const p = game.layout.getPiece(pieceId);
    return p ? new Vector3(p.pose.x, p.y, p.pose.z) : null;
  };

  /**
   * Glide the view to show `points` in the map's room (above the card), at the camera's angle, `minDistance` to
   * `maxDistance` mm away (the furthest of `points`, last, are left out where they'd need it further).
   */
  function frameInRoom(points: Vector3[], minDistance: number, maxDistance = game.controls.maxDistance, mustShow = 0, theta?: number): void {
    const room = mapRoom();
    const now = new Spherical().setFromVector3(game.camera.position.clone().sub(game.controls.target));
    // (Facing as asked: along a goal's places, as Show me does.)
    if (theta !== undefined) now.theta = theta;
    const fitOf = (ps: Vector3[], min = minDistance, max = game.controls.maxDistance) => fitToRect(ps, game.camera, now.phi, now.theta, room, room.width, room.height, 32, min, max);
    // Too far out to show them all: the last (furthest) points go, down to the first two, so what's shown is near. The
    // first `mustShow` never go: they're shown however far out that takes (a line's stops: QA, planning zoomed in on
    // the train and left them off screen).
    let shown = points;
    let fit = fitOf(shown);
    while (fit.distance > maxDistance && shown.length > Math.max(2, mustShow)) fit = fitOf((shown = shown.slice(0, -1)));
    const cap = mustShow > 0 && shown.length <= mustShow ? Math.max(maxDistance, fit.distance) : maxDistance;
    const distance = Math.min(Math.max(fit.distance, minDistance), cap, game.controls.maxDistance);
    // (Held back from the fit's distance: where to look worked out again at the distance it's glided to.)
    if (Math.abs(distance - fit.distance) > 1) fit = fitOf(shown, distance, distance);
    game.follow(-1);
    game.director.glideTo(fit.target, distance, { theta: now.theta, duration: 0.7 });
  }

  /** Are these points on screen in the map's room (with a margin), as the camera is now? */
  function inRoom(points: readonly Vector3[], margin = 24): boolean {
    const room = mapRoom();
    const v = new Vector3();
    return points.every((p) => {
      v.copy(p).project(game.camera);
      const x = ((v.x + 1) / 2) * room.width;
      const y = ((1 - v.y) / 2) * room.height;
      return v.z < 1 && x >= room.left + margin && x <= room.right - margin && y >= room.top + margin && y <= room.bottom - margin;
    });
  }

  /** The open engine's card shows something on the map: the engine (both ends, and its top) and those points framed in the
   * map's room (between the bar at the top and the card), if they aren't all there now. Not zoomed in. */
  function showWithEngine(carId: number, points: Vector3[]): void {
    const found = carId !== -1 ? game.sim.findCar(carId) : undefined;
    const ends = found ? [found.train.world[2 * found.index], found.train.world[2 * found.index + 1]].filter((w) => w) : [];
    const engine = ends.flatMap((w) => [new Vector3(w.x, 0, w.z), new Vector3(w.x, ENGINE_TOP, w.z)]);
    const all = [...engine, ...points];
    // (Followed, the camera keeps it in the room and goes on following: the way ahead isn't worth stopping that for.
    // QA: opening its card in landscape stopped following it, the Follow button still lit.)
    if (game.following === carId) return;
    if (all.length === 0 || inRoom(all)) return;
    frameInRoom(all, Math.min(game.camera.position.distanceTo(game.controls.target), 900));
  }
  /** About how tall an engine stands (mm), to keep its top in view as well as its wheels. */
  const ENGINE_TOP = 70;

  /** The front of an engine's train, the way it's going (or, standing, the way its front faces), as a cursor. */
  function trainFront(carId: number): Cursor | null {
    const found = carId !== -1 ? game.sim.findCar(carId) : undefined;
    if (!found) return null;
    const t = found.train;
    const engine = t.cars[found.index];
    const way = (engine.lever || 1) * engine.facing;
    const front: Cursor = { ...(way > 0 ? t.bogies[0] : t.bogies[t.bogies.length - 1]) };
    if (way < 0) flipCursor(game.layout, front);
    return front;
  }

  /** The open engine's train's middle, on the ground. */
  function trainSpot(carId: number): Vector3 | null {
    const found = carId !== -1 ? game.sim.findCar(carId) : undefined;
    const w = found?.train.world[2 * found.index];
    return w ? new Vector3(w.x, 0, w.z) : null;
  }

  /**
   * Planning starts framing the train with its nearest places: those within `NEAR_PLACES` mm (up to `NEAR_COUNT`), and
   * at least the nearest `NEAR_MIN` however far, the view no further out than `FRAME_MAX` mm.
   */
  const NEAR_PLACES = 1100;
  const NEAR_COUNT = 3;
  const NEAR_MIN = 2;
  const FRAME_MAX = 4200;

  /** Planning starts: frame the train, its line's places, and the places nearest it (the likely first stops). */
  function framePlanning(): void {
    const carId = interaction.openEngineCarId;
    const train = trainSpot(carId);
    if (!train) return;
    const points: Vector3[] = [train];
    for (const st of lineOf(game.economy, carId)?.stops ?? []) {
      const d = game.economy.depot(st.depotId);
      const p = d && pieceSpot(d.pieceId);
      if (p) points.push(p);
    }
    const near = game.economy
      .allDepots()
      .map((d) => pieceSpot(d.pieceId))
      .filter((p): p is Vector3 => !!p && p.distanceTo(train) > 1)
      .sort((a, b) => a.distanceTo(train) - b.distanceTo(train))
      .filter((p, k) => k < NEAR_MIN || (k < NEAR_COUNT && p.distanceTo(train) <= NEAR_PLACES));
    // The train and its line's stops are always shown; starting a line, the nearest two places too (somewhere to tap).
    const must = points.length + (points.length === 1 ? Math.min(NEAR_MIN, near.length) : 0);
    points.push(...near);
    // Nothing near: a little room round the train.
    if (points.length === 1) points.push(train.clone().add(new Vector3(250, 0, 250)), train.clone().add(new Vector3(-250, 0, -250)));
    frameInRoom(points, 600, FRAME_MAX, must);
  }

  /** Why the open engine's line can't be run as it stands (a stop no track leads to), or null: see `showRibbon`. */
  let cantReachText: string | null = null;
  const cantReach = (): string | null => cantReachText;
  /** The open engine's line changed (its ribbon is redrawn). */
  const routeChanged = (): void => {
    ribbonKey = "";
  };

  // The open engine's route on the track (see src/render/route-view.ts): its line's ribbon round all its stops, the
  // way on from the train to the stop it's heading for, and numbered discs over the stops (one no track leads to
  // crossed out); a train on no line shows where the switches send it, dotted. Built only when something it shows
  // changes (the train, its line, the track, a switch, the piece the train's on): a key compared each frame.
  let routeView: RouteView | null = null;
  let routeLayout: Layout | null = null;
  let ribbonKey = "";
  /** How far ahead "where the switches send it" is drawn (mm). */
  const AHEAD = 700;
  /** While planning, a ring round each place a tap can add (not those already its stops: they have their discs). */
  const placeRings = new PlaceRings();
  game.scene.add(placeRings.group);
  let ringsKey = "";
  function showRings(): void {
    const stops = planning ? (game.economy.lines.get(sheetLine)?.stops ?? []) : [];
    const key = planning ? `${game.trackVersion}|${game.economy.allDepots().length}|${stops.map((st) => st.depotId).join(",")}` : "";
    if (key === ringsKey) return;
    ringsKey = key;
    const on = new Set(stops.map((st) => st.depotId));
    if (placeRings.show(planning ? game.depotView.placeSpots().filter((p) => !on.has(p.depotId)) : [])) game.invalidate();
  }

  function showRibbon(): void {
    showRings();
    // The sheet open on a line no train of its own runs (or its card's train taken off it): the line alone.
    if (planning && (sheetEngine === -1 || (sheetLine !== -1 && game.economy.lineIdOf.get(sheetEngine) !== sheetLine))) {
      showLineAlone();
      return;
    }
    const carId = interaction.openEngineCarId;
    const found = carId !== -1 ? game.sim.findCar(carId) : undefined;
    if (!found || found.train.derailed) {
      if (ribbonKey !== "") {
        routeView?.clear();
        ribbonKey = "";
        cantReachText = null;
        game.invalidate();
      }
      ribbonFor = { carId: -1, stops: "", next: -1 };
      nudgedFor = -1;
      return;
    }
    // The way the engine's train is going (or, standing, the way its front faces).
    const t = found.train;
    const engine = t.cars[found.index];
    const way = (engine.lever || 1) * engine.facing;
    const tail = t.bogies[t.bogies.length - 1];
    const lead = way > 0 ? t.bogies[0] : tail;
    const line = lineOf(game.economy, carId);
    const r = game.economy.routeOf(carId);
    // (Wide enough to see from far out, as planning frames a long line: as the Lines view's.)
    const scale = ribbonScale(game.camera.position.distanceTo(game.controls.target), game.canvas.clientHeight || 1, game.camera.fov);
    const key = `${scale}|${carId}|${game.trackVersion}|${game.layout.switchesVersion}|${lead.pieceId}|${lead.reversed}|${way}|${line ? `${line.colour}|${r?.next}|${r?.at}|${r?.viaFor}:${r?.viaDone}|${line.stops.map((st) => `${st.depotId}${st.via ? `.${st.via.join(".")}` : ""}`).join(",")}` : "-"}`;
    if (key === ribbonKey) return;
    ribbonKey = key;
    if (!routeView || routeLayout !== game.layout) {
      if (routeView) {
        game.scene.remove(routeView.group);
        routeView.dispose();
      }
      routeView = new RouteView(game.layout, game.mats);
      routeLayout = game.layout;
      game.scene.add(routeView.group);
      interaction.routeGroup = routeView.group;
    }
    const front: Cursor = { ...lead };
    if (way < 0) flipCursor(game.layout, front);
    cantReachText = null;
    if (!line || !r) {
      const ahead = aheadRuns(game.layout, front, AHEAD);
      // (A warm walnut, a shade darker than the groove: it reads on light wood without shouting.)
      routeView.show([{ runs: ahead, colour: "#7a4a22", dotted: true }], []);
      // With the card open, the way ahead is shown, once: not left under the card (a train heading toward it).
      // (Its whole length, a point a run, not only its end: it may curve toward the card and back.)
      const path = ahead.flatMap((run) => {
        const p = pointOnPath(game.layout, run.pieceId, run.pathIndex, run.s1);
        return p ? [new Vector3(p.x, p.y, p.z)] : [];
      });
      if (!planning && nudgedFor !== carId && path.length > 0) {
        nudgedFor = carId;
        requestAnimationFrame(() => showWithEngine(carId, path));
      }
    } else {
      const names = routeStops(game.world);
      const pieces = line.stops.map((st) => game.economy.depot(st.depotId)?.pieceId ?? -1);
      const next = r.next % line.stops.length;
      // (Its line's kept ways (stickiness), and where it's aimed now: the next stop, or a via point on the way: as the
      // router chooses, so the map and the train agree.)
      const keep = game.economy.router.ways.of(game.economy.ownerOf(carId));
      const aim = game.economy.aimOf(carId);
      const toNext = aim === -1 ? null : legFromCursor(game.layout, front, aim, undefined, keep);
      // (The legs on from the next stop follow the way the train comes into it: it runs on round a loop past it.)
      const legs = viaLegs(game.layout, line.stops.map((st, k) => ({ piece: pieces[k], via: st.via })), { k: next, done: r.at ? Infinity : viaDone(r, next), leg: toNext }, keep);
      // The way changed under a track edit (the stops and the stop it's heading for as they were, the legs not, and
      // every leg still has a way: one with none says "Can't reach" instead): the ribbon flashes once and the card says
      // so a few seconds (audit F14: a train went somewhere new, no one said why).
      const stopsSig = line.stops.map((st) => `${st.depotId}${st.via ? `.${st.via.join(".")}` : ""}`).join(",");
      const runsSig = legs.map((leg) => (leg ? leg.map((x) => `${x.pieceId}/${x.pathIndex}`).join(".") : "-")).join("|");
      const wayChanged = wayFor.carId === carId && wayFor.line === line.id && wayFor.stops === stopsSig && wayFor.next === next && wayFor.track !== game.trackVersion && wayFor.runs !== runsSig && !legs.includes(null);
      wayFor = { carId, line: line.id, stops: stopsSig, next, track: game.trackVersion, runs: runsSig };
      const ribbons: RibbonSpec[] = legs.flatMap((leg) => (leg ? [{ runs: leg, colour: line.colour }] : []));
      if (toNext) ribbons.push({ runs: toNext, colour: line.colour });
      const n = line.stops.length;
      // A stop is out of reach when no way leads into it (from the train, for the next; else from the stop before).
      const unreachable = (k: number) => (k === next ? toNext === null : n > 1 && legs[(k - 1 + n) % n] === null);
      // Where its way runs out, a red dashed gap across to it.
      // (Or, where a pinned switch is what keeps it away, from that switch: set the other way, it would lead there.)
      const gaps: GapSpec[] = [];
      const pinnedFor = new Map<number, number>();
      line.stops.forEach((_, k) => {
        if (!unreachable(k) || pieces[k] === -1) return;
        const to = pointOnPath(game.layout, pieces[k], 0, pathLengthOf(pieces[k]) / 2);
        const starts = k === next ? [front] : stopCursors(game.layout, pieces[(k - 1 + n) % n]);
        const pin = pinnedBlocking(game.layout, starts, pieces[k]);
        if (pin !== -1) pinnedFor.set(k, pin);
        const from = to && (pin !== -1 ? pointOnPath(game.layout, pin, 0, pathLengthOf(pin) / 2) : nearestAhead(game.layout, starts, GAP_SEARCH, to.x, to.z));
        if (to && from && Math.hypot(from.x - to.x, from.z - to.z) > 20) gaps.push({ from, to });
      });
      // One disc a place: a place visited twice (A → B → A) shows both its numbers ("1·3").
      const discs = new Map<number, DiscSpec>();
      line.stops.forEach((_, k) => {
        if (pieces[k] === -1) return;
        const state = unreachable(k) ? "unreachable" : k === next ? "next" : "stop";
        const d = discs.get(pieces[k]);
        if (!d) discs.set(pieces[k], { pieceId: pieces[k], label: `${k + 1}`, colour: line.colour, state, stop: k });
        else {
          d.label += `·${k + 1}`;
          if (state === "unreachable" || (state === "next" && d.state === "stop")) d.state = state;
        }
      });
      // Via points: a small disc with a white dot each (not numbered: the train passes, it doesn't stop).
      line.stops.forEach((st, k) => {
        for (const v of st.via ?? []) if (!discs.has(v) && game.layout.getPiece(v)) discs.set(v, { pieceId: v, label: "", colour: line.colour, state: "stop", stop: k, via: true });
      });
      routeView.show(ribbons, [...discs.values()], gaps, scale);
      // A stop just added pops in; the next stop pulses when it becomes the next (or the card opens).
      const now = performance.now() / 1000;
      // (A track edit changed its way round: the new stretch lit up a moment, and, shorter, a toast once an edit;
      // the card says it goes another way now. The whole ribbon flashes only where no new stretch was lit.)
      let lit = false;
      const lap = new Set<number>();
      let lapMm = 0;
      for (const leg of legs) for (const run of leg ?? []) {
        lap.add(run.pieceId);
        lapMm += Math.abs(run.s1 - run.s0);
      }
      const stopsNow = line.stops.map((st) => `${st.depotId}${st.via ? `.${st.via.join(".")}` : ""}`).join(",");
      const was = lapFor;
      lapFor = { carId, track: game.trackVersion, stops: stopsNow, pieces: lap, mm: lapMm };
      if (was.carId === carId && was.track !== game.trackVersion && was.stops === stopsNow && was.pieces.size > 0 && !legs.includes(null)) {
        const changed = legs.flatMap((leg) => (leg ?? []).filter((run) => !was.pieces.has(run.pieceId)));
        if (changed.length > 0) {
          routeView.highlight(changed, now, !matchMedia("(prefers-reduced-motion: reduce)").matches);
          lit = true;
          if (lapMm < was.mm - 1 && toldShortcut !== game.trackVersion) {
            toldShortcut = game.trackVersion;
            hud.toast(`${line.name} line found a shortcut`);
          }
        }
      }
      if (wayChanged) {
        if (!lit) routeView.flash(now);
        wayNote = { carId, until: performance.now() + WAY_NOTE_MS };
      }
      const stopsKey = line.stops.map((st) => st.depotId).join(",");
      if (ribbonFor.carId === carId && stopsKey.startsWith(ribbonFor.stops) && line.stops.length === ribbonFor.stops.split(",").filter(Boolean).length + 1) routeView.pop(line.stops.length - 1, now);
      if (ribbonFor.carId !== carId || ribbonFor.next !== next) routeView.pulse(now);
      ribbonFor = { carId, stops: stopsKey, next };
      const out = line.stops.findIndex((_, k) => unreachable(k));
      if (out !== -1) {
        const name = names.find((st) => st.depotId === line.stops[out].depotId)?.name ?? "a stop";
        // (Track may lead there from the stop before, just not on from the way the train comes into it: it turns round
        // only at the end of the track, so a way that needs it to reverse mid-line isn't one.)
        const before = out === next ? [front] : stopCursors(game.layout, pieces[(out - 1 + n) % n]);
        const turnOnly = !pinnedFor.has(out) && before.some((c) => legFromCursor(game.layout, c, pieces[out]) !== null);
        cantReachText = pinnedFor.has(out)
          ? `Can't reach ${name}: a pinned switch sends trains the other way. Hold its lever to unpin it`
          : turnOnly
            ? `Can't reach ${name} on the way the train comes: it only turns round at the end of the track`
            : `Can't reach ${name}: no track leads there`;
        // With the card open (not planning), the stop that can't be reached is shown, once: not left off screen or
        // under the card.
        const spot = pieceSpot(pieces[out]);
        if (!planning && nudgedFor !== carId && spot) {
          nudgedFor = carId;
          requestAnimationFrame(() => showWithEngine(carId, [spot, spot.clone().setY(spot.y + 70)]));
        }
      }
    }
    if (!line || !r) ribbonFor = { carId, stops: "", next: -1 };
    game.invalidate();
  }

  /**
   * The open engine's line's way round as last drawn (its pieces and length, for the track and stops then): a track edit
   * that changes it lights the new stretch, and one that shortens it says so, once an edit (`toldShortcut`).
   */
  let lapFor: { carId: number; track: number; stops: string; pieces: ReadonlySet<number>; mm: number } = { carId: -1, track: -1, stops: "", pieces: new Set(), mm: 0 };
  let toldShortcut = -1;
  /** The open engine's line's way as last drawn: its legs' pieces, and what they were drawn for (see `showRibbon`). */
  let wayFor = { carId: -1, line: -1, stops: "", next: -1, track: -1, runs: "" };
  /** "Goes another way now" on this engine's card until then (ms). */
  let wayNote = { carId: -1, until: 0 };
  const WAY_NOTE_MS = 6000;
  /** What the ribbon last showed (to tell a stop just added, and a new next stop). */
  let ribbonFor = { carId: -1, stops: "", next: -1 };
  /** The engine whose card last nudged the view to show a stop it can't reach, or its way ahead (once per opening). */
  let nudgedFor = -1;
  /** How far on (mm) a way is followed to find where it runs out, for a stop it can't reach. */
  const GAP_SEARCH = 3000;
  const pathLengthOf = (pieceId: number): number => {
    const p = game.layout.getPiece(pieceId);
    return p ? pathLength(getPieceDef(p.type, p.flipped).paths[0].geom) : 0;
  };
  /** Discs: fanned out where they'd overlap, and the pulse and pop, each frame the card shows a route (cheap). */
  let discsMoving = false;
  function animateDiscs(): void {
    if (!routeView || ribbonKey === "") return;
    if (routeView.fan(game.camera, game.canvas.clientHeight)) game.invalidate();
    const moving = routeView.animate(performance.now() / 1000);
    if (moving || discsMoving) game.invalidate();
    discsMoving = moving;
  }

  // The Lines view (see src/ui/lines-view.ts): every line listed (a row opens its sheet: rename, recolour, Reverse), and every line's
  // ribbon on the map while it's open. Built only on change: a key per frame, nothing more while nothing changes.
  const linesView = new LinesView(hud.root, {
    open: (id) => openLineSheet(id, { fromLines: true, tab: trainsOn(game.economy, id).length === 0 ? "trains" : "stops" }),
    turnRound: (id) => {
      const note = lineNotes.get(id);
      if (!note) return;
      const r = turnTrains(game.economy, id, note.engines);
      if (r.stuck.length === 0) {
        lineNotes.delete(id);
        hud.toast(r.turned.length === 1 ? "Turned round: it runs the line's way now" : "Turned round: they run the line's way now", false, 2500);
      } else {
        lineNotes.set(id, { ...note, engines: r.stuck.map((s) => s.engine), text: notTurnedText(r.stuck) });
        hud.toast("Still no way to turn it round: see why under the line", false, 2500);
      }
      linesChanged();
    },
    // (A line needs no train: it's made at its first place tapped, and trains are put on it from its Trains tab.)
    newLine: () => openLineSheet(-1, { fromLines: true }),
    close: () => closeLines(),
  });

  // What the map shows (between the top bar and the tray, beside or above an open card or sheet): the game's glides
  // and a followed train centre their target there, not behind a card (QA: an engine glided to sat under the card
  // that was open). Measured when any of these changes size, never per frame.
  game.director.roomOf = () => measureRoom();
  {
    const changed = new ResizeObserver(() => game.director.roomChanged());
    for (const e of document.querySelectorAll(".hud .tray, .hud .card, .hud .goals, .topbar")) changed.observe(e);
  }
  let allLines: RouteView | null = null;
  let allLinesLayout: Layout | null = null;
  let allLinesKey = "";
  const linesChanged = (): void => {
    routeChanged();
    routeShown = "";
    allLinesKey = "";
    scheduleSave();
  };
  /** A line's places (its stops' pieces), on the ground. */
  const linePlaces = (id: number): Vector3[] =>
    (game.economy.lines.get(id)?.stops ?? []).flatMap((st) => {
      const p = pieceSpot(game.economy.depot(st.depotId)?.pieceId ?? -1);
      return p ? [p] : [];
    });

  /**
   * The engines on the track that run no line (one a train), nearest `near` first (each its nearest point), those
   * `ok` allows.
   */
  function freeTrains(ok: (engine: number) => boolean, near: readonly Vector3[]): number[] {
    const out: { e: number; d: number }[] = [];
    for (const t of game.sim.trains()) {
      const engine = t.cars.find((c) => c.kind === "engine");
      if (t.derailed || !engine || game.economy.lineIdOf.has(engine.id) || !ok(engine.id)) continue;
      const at = trainSpot(engine.id);
      out.push({ e: engine.id, d: at && near.length > 0 ? Math.min(...near.map((p) => p.distanceTo(at))) : 0 });
    }
    return out.sort((a, b) => a.d - b.d).map((x) => x.e);
  }

  /** This engine's card, planning its line (with `first` as its first stop, if given): from a place or Lines. */
  function planFor(engine: number, first = -1): void {
    closeLines();
    interaction.openEngineCard(engine);
    requestAnimationFrame(() => {
      if (interaction.openEngineCarId !== engine) return;
      setPlanning(true);
      if (first !== -1) interaction.onPickPlace?.(first);
    });
  }

  /**
   * The open place's card (a station's or depot's): the lines calling there, a tap opening one's train, and "New route
   * from here", the nearest free train track leads from planning a route with this place first (audit F12: a route
   * could only be started from a train). Drawn when what it shows changes; a key a frame.
   */
  let placeRoutesKey = "";
  function showPlaceRoutes(): void {
    const id = interaction.openDepotId;
    const box = hud.depotRoutes;
    const allowed = mode === "sandbox" || progress.learned.has("routes");
    const d = id === -1 ? undefined : game.economy.depot(id);
    if (!d || !allowed) {
      if (placeRoutesKey !== "") box.hidden = true;
      placeRoutesKey = "";
      return;
    }
    const calling = [...game.economy.lines.values()].filter((l) => l.stops.some((st) => st.depotId === id));
    const key = `${id}:${calling.map((l) => `${l.id}${l.colour}${l.name}`).join(",")}`;
    if (key === placeRoutesKey && !box.hidden) return;
    placeRoutesKey = key;
    box.innerHTML = "";
    box.hidden = false;
    // (A town's ledger lists its lines already: there, only New route.)
    if (calling.length > 0 && !(d.role === "town" && interaction.townCard)) {
      box.append(Object.assign(document.createElement("span"), { className: "route-hint", textContent: "Lines here:" }));
      for (const l of calling) {
        const b = document.createElement("button");
        b.className = "chip text route-join-line";
        b.textContent = l.name;
        b.title = `Open a ${l.name} train's card`;
        b.style.setProperty("--line", l.colour);
        b.addEventListener("click", () => {
          const engine = trainsOn(game.economy, l.id).find((e) => game.sim.findCar(e));
          if (engine !== undefined) interaction.openEngineCard(engine);
        });
        box.append(b);
      }
    }
    const add = document.createElement("button");
    add.className = "chip text route-new-here";
    add.textContent = "New route from here";
    add.title = "The nearest train with no line plans a route, starting here";
    add.addEventListener("click", () => {
      const piece = d.pieceId;
      const spot = pieceSpot(piece);
      const engine = freeTrains((e) => {
        const front = trainFront(e);
        return !!front && legFromCursor(game.layout, front, piece) !== null;
      }, spot ? [spot] : [])[0];
      // (No free train can reach it: a line of its own, starting here, to put a train on later.)
      if (engine === undefined) {
        openLineSheet(-1);
        interaction.onPickPlace?.(id);
        return;
      }
      planFor(engine, id);
    });
    box.append(add);
  }

  function openLines(): void {
    if (mapView.open) closeMap(false);
    setPlanning(false);
    interaction.clearSelection();
    hud.hideCards();
    linesView.setOpen(true);
    hud.setLinesOpen(true);
    showLines();
    // Every line's places in view.
    const places = [...game.economy.lines.keys()].flatMap(linePlaces);
    if (places.length > 1) requestAnimationFrame(() => frameInRoom(places, 600));
    game.invalidate();
  }

  function closeLines(): void {
    if (!linesView.open) return;
    linesView.setOpen(false);
    hud.setLinesOpen(false);
    allLines?.clear();
    allLinesKey = "";
    game.invalidate();
  }

  /**
   * Lines reversed on a ring whose trains couldn't all be turned round (they keep their way, the long way round to each
   * stop): which, and why, said under the line in the Lines view until they're turned or its stops change.
   */
  const lineNotes = new Map<number, { order: string; engines: number[]; text: string }>();
  /** A line's stops, as a key (a note stands while it's the same). */
  function stopOrder(id: number): string {
    return game.economy.lines.get(id)?.stops.map((s) => s.depotId).join(",") ?? "";
  }
  /** Why trains on a ring weren't turned round, in a sentence (`turnTrains`). */
  function notTurnedText(stuck: readonly { engine: number; why: NotTurned; by: number | null }[]): string {
    const who = (e: number) => game.sim.nameOf(e);
    const one = stuck[0];
    const why = (s: (typeof stuck)[number]): string => {
      if (s.why === "derailed") return "is off the track";
      if (s.why === "riding") return "is on a lift or turntable";
      const by = s.by === null ? undefined : game.sim.getTrain(s.by)?.cars.find((c) => c.kind === "engine");
      return by ? `has ${who(by.id)} too close behind to turn round` : "has no room to turn round";
    };
    if (stuck.length === 1) return `${who(one.engine)} ${why(one)}: on this ring it goes the long way round to each stop until it's turned.`;
    return `${stuck.map((s) => who(s.engine)).join(" and ")} couldn't be turned round (${who(one.engine)} ${why(one)}): on this ring they go the long way round to each stop until they're turned.`;
  }

  let linesAt = 0;
  let linesKey = "";
  /** Each frame: the menu's Lines item, and the open view's list and ribbons (redrawn only when they change). */
  function showLines(): void {
    const allowed = mode === "sandbox" || progress.learned.has("routes");
    // (With no lines yet too: + New line is there, and a line needs no train.)
    hud.setLinesAvailable(allowed);
    if (!linesView.open) return;
    // A train's card opened (a tap on the map): the view gives way to it.
    if (interaction.openEngineCarId !== -1 || !allowed) {
      closeLines();
      return;
    }
    const lines = [...game.economy.lines.values()];
    // (A note stands while the line's stops are as Reverse left them and a train it names is still on it.)
    if (lineNotes.size > 0)
      for (const [id, n] of lineNotes) if (n.order !== stopOrder(id) || !n.engines.some((e) => game.economy.lineIdOf.get(e) === id)) lineNotes.delete(id);
    // (Health and goods at most twice a second: a train's state changes as it runs, the list needn't keep up per frame.)
    const now = performance.now();
    if (now - linesAt > 500 || linesKey !== `${lines.length}|${game.economy.plansVersion}|${game.economy.lineIdOf.size}`) {
      linesAt = now;
      linesKey = `${lines.length}|${game.economy.plansVersion}|${game.economy.lineIdOf.size}`;
      const names = routeStops(game.world);
      const nameOf = (id: number) => names.find((st) => st.depotId === id)?.name ?? lostStopName(game.world, id);
      linesView.show(
        lines.map((l) => {
          const health = healthOf(l.id);
          const goods = [...new Set(game.economy.routePlan(l.stops).flatMap((p) => p.picks))];
          return {
            id: l.id,
            name: l.name,
            colour: l.colour,
            stops: l.stops.map((st) => nameOf(st.depotId)),
            trains: trainsOn(game.economy, l.id).length,
            carries: goods.slice(0, 4).map((k) => GOODS_ICON[k]).join(""),
            health,
            healthWords: HEALTH_WORDS[health],
            loads: loadsWords(game.economy.lineLoadsLately(l.id)),
            ...(lineNotes.has(l.id) ? { note: lineNotes.get(l.id)!.text } : {}),
          };
        }),
      );
    }
    // (Ribbons at least 4 px wide however far out the view is: audit F9, at the Lines view's framing a 14 mm ribbon was
    // under a pixel. In steps, so a zoom rebuilds them only when it crosses one.)
    const scale = ribbonScale(game.camera.position.distanceTo(game.controls.target), game.canvas.clientHeight || 1, game.camera.fov);
    // (Discs that would overlap fan out as the view moves: cheap, and only when it has.)
    if (allLines && allLinesKey !== "" && allLines.fan(game.camera, game.canvas.clientHeight)) game.invalidate();
    const key = `${scale}|${game.trackVersion}|${game.layout.switchesVersion}|${lines.map((l) => `${l.id}${l.colour}:${l.stops.map((st) => `${st.depotId}${st.via ? `.${st.via.join(".")}` : ""}`).join(",")}`).join("|")}`;
    if (key === allLinesKey) return;
    allLinesKey = key;
    if (!allLines || allLinesLayout !== game.layout) {
      if (allLines) {
        game.scene.remove(allLines.group);
        allLines.dispose();
      }
      allLines = new RouteView(game.layout, game.mats);
      allLinesLayout = game.layout;
      allLines.group.name = "all-lines";
      game.scene.add(allLines.group);
    }
    const ribbons: RibbonSpec[] = [];
    // Each line's stops, numbered in its colour (one disc a place: a place two lines call at shows both, fanned out).
    const discs: DiscSpec[] = [];
    for (const l of lines)
      l.stops.forEach((st, k) => {
        const piece = game.economy.depot(st.depotId)?.pieceId ?? -1;
        if (piece !== -1 && game.layout.getPiece(piece) && !discs.some((d) => d.pieceId === piece && d.colour === l.colour)) discs.push({ pieceId: piece, label: `${k + 1}`, colour: l.colour, state: "stop" });
      });
    for (const l of lines) {
      // (By its via points, and the ways its trains keep.)
      const stops = l.stops.flatMap((st) => {
        const piece = game.economy.depot(st.depotId)?.pieceId ?? -1;
        return piece === -1 ? [] : [{ piece, via: st.via }];
      });
      for (const leg of viaLegs(game.layout, stops, undefined, game.economy.router.ways.of(l.id))) if (leg) ribbons.push({ runs: leg, colour: l.colour });
    }
    allLines.show(ribbons, discs, [], scale);
    game.invalidate();
  }

  // The map view (Game mode): the whole land from above, with what each town wants and each depot holds.
  const mapView = new MapView(hud.root, { go: (m) => goToMarker(m), close: () => closeMap(true, true), handoff: (down) => game.canvas.dispatchEvent(down) });
  /** Where the camera was before the map opened, to go back to. */
  let mapReturn: { target: Vector3; distance: number; phi: number; theta: number } | null = null;
  let mapRefreshedAt = 0;
  /** The map's view as last seen (camera, target), and whether it has moved since a toast was last fitted to it. */
  const mapViewSeen = [NaN, NaN, NaN, NaN, NaN];
  let mapMoving = false;
  let mapMovedAt = 0;
  /** How long the map's view stays still before a toast refits to it (QA: not mid-gesture, a finger resting a moment). */
  const MAP_STILL_MS = 100;
  /**
   * And for this many ticks: on a slow device a frame alone can outlast `MAP_STILL_MS`, so one tick between a gesture's
   * moves read as still (QA, SwiftShader: 3-10 refits a gesture).
   */
  const MAP_STILL_TICKS = 3;
  let mapStillTicks = 0;

  /** The map view's tilt: near straight down. */
  const MAP_PHI = 0.22;
  /** Planning a route when the map opened: the engine, so planning goes on when it closes (−1 if not). */
  let planAfterMap: { engine: number; line: number; fromLines: boolean } | null = null;
  function openMap(): void {
    // The map is how to find a far place while planning (the hint says to tap places on the map): planning waits.
    planAfterMap = planning ? { engine: sheetEngine, line: sheetLine, fromLines: sheetFromLines } : null;
    if (planning) setPlanning(false);
    // (Planning, a place picked here is gone to; it's added with a tap there, as any stop.)
    mapView.setHint(planAfterMap ? "Tap a place to go there, then tap it to add it" : null);
    closeLines();
    if (expanding) setExpanding(false);
    if (board.open) setBoardOpen(false);
    interaction.clearSelection();
    hud.hideCards();
    game.follow(-1);
    const c = game.controls;
    const sph = new Spherical().setFromVector3(game.camera.position.clone().sub(c.target));
    mapReturn = { target: c.target.clone(), distance: sph.radius, phi: sph.phi, theta: sph.theta };
    mapView.setOpen(true);
    hud.setMapOpen(true);
    // (Moving till the glide lands and the view stays still a moment: `mapSettled` false from the start.)
    mapMoving = true;
    game.steepAllowed = true;
    // Every place marked on the player's land (its ruins too), fitted between the map's bars (where the labels and badges
    // go), as far out as the camera may go: on a big map they can't all be, and a drag pans to the rest (QA: on 22 plots
    // the view sat on the land's middle, the bars not allowed for, and no harbour on the coast was in view).
    const r = game.canvas.getBoundingClientRect();
    const band = mapView.band();
    const room = { left: 0, right: r.width, top: band.top - r.top, bottom: band.bottom - r.top };
    const pts = mapFramePoints(currentMapMarkers(), game.landscape.grid.extent()).map((q) => new Vector3(q.x, 0, q.z));
    const fit = fitToRect(pts, game.camera, MAP_PHI, sph.theta, room, r.width, r.height, 24, 0, c.maxDistance);
    game.director.glideTo(fit.target, fit.distance, { phi: MAP_PHI, duration: 0.9 });
    refreshMap();
    game.invalidate();
  }

  /** Close the map; `back` glides to where the camera was. */
  function closeMap(back: boolean, resume = false): void {
    if (!mapView.open) return;
    mapView.setOpen(false);
    hud.setMapOpen(false);
    game.steepAllowed = false;
    if (back && mapReturn) {
      const r = mapReturn;
      game.director.glideTo(r.target, r.distance, { phi: r.phi, theta: r.theta, duration: 0.9 });
    } else if (!game.director.busy) {
      // Left where the map looked (nearly straight down): eased up to the pitch cap, not snapped there by the controls.
      const sph = new Spherical().setFromVector3(game.camera.position.clone().sub(game.controls.target));
      if (sph.phi < MIN_PITCH) game.director.glideTo(game.controls.target.clone(), sph.radius, { phi: MIN_PITCH, duration: 0.5 });
    }
    mapReturn = null;
    game.invalidate();
    // Back to planning, the engine's card (its bar) as it was; the view where the map left it (a town picked there).
    // (Only when it's the player closing it, or picking a place on it: not the title, the board or the lines opening.)
    const was = planAfterMap;
    planAfterMap = null;
    if (was && resume) {
      if (was.engine === -1) {
        openLineSheet(was.line, { fromLines: was.fromLines });
        return;
      }
      interaction.openEngineCard(was.engine);
      if (interaction.openEngineCarId === was.engine) {
        showRoute();
        setPlanning(true, false);
      }
    }
  }

  function goToMarker(m: MapMarker): void {
    closeMap(false, true);
    game.director.glideTo(new Vector3(m.x, 0, m.z), 1000, { phi: 0.95, duration: 1, inRoom: true });
    if (m.kind === "town") game.flourishes.add(game.landscapeView.flash([Number(m.key.split(":")[1])]));
    else {
      const i = game.landscape.grid.cellAtWorld(m.x, m.z);
      const marks = goalMarks(game.scene, [{ x: m.x, y: i < 0 ? 0 : game.landscape.grid.groundY(i), z: m.z }]);
      if (marks) game.flourishes.add(marks);
    }
    // An old industry's ruin on the player's land: its card, as a tap on the ruin opens it (on the land around, a ruin
    // isn't tappable: it's only gone to).
    if (m.ruin !== undefined) openRuin(m.ruin);
  }

  /**
   * The ruins' markers, made again only when the ruins shown, the land's squares (a stranded harbour's water) or which
   * of their blueprints are learned change.
   */
  let ruinMarks: { key: string; markers: MapMarker[] } = { key: "", markers: [] };
  function mapRuinMarkers(): MapMarker[] {
    const learned = (id: string) => progress.learned.has(id);
    const land = game.landscape;
    const key = ruinMarkersKey(game.ruinsVersion, learned, land.grid.revision);
    if (key !== ruinMarks.key) ruinMarks = { key, markers: ruinMarkers(game.ruinsShown, learned, (s) => harbourStranded(land, s)) };
    return ruinMarks.markers;
  }

  function refreshMap(): void {
    mapRefreshedAt = performance.now();
    mapView.show(currentMapMarkers());
    placeMap();
  }

  /** What the map view marks, as the world is now. */
  function currentMapMarkers(): MapMarker[] {
    return [...mapMarkers(game.world, (id) => townLife.status(id)), ...mapRuinMarkers()];
  }

  const mapPoint = new Vector3();
  function placeMap(): void {
    const rect = game.canvas.getBoundingClientRect();
    mapView.place((x, z) => {
      mapPoint.set(x, 0, z).project(game.camera);
      if (mapPoint.z > 1 || Math.abs(mapPoint.x) > 1.1 || Math.abs(mapPoint.y) > 1.1) return null;
      return { x: rect.left + ((mapPoint.x + 1) / 2) * rect.width, y: rect.top + ((1 - mapPoint.y) / 2) * rect.height };
    });
  }

  /** "Show me": glide to where the current goal is done, flash the towns and mark the places, open the tray tab. */
  function showGoal(): void {
    const goal = goals.current();
    if (!goal) return;
    // A goal after a blueprint, with a school placed: the picker, open on it (where to place the school, or the school
    // its goods go to, otherwise).
    const pick = showMePick(progress, goal.blueprint, hasSchool());
    if (pick) {
      setBoardOpen(true, pick);
      return;
    }
    showGuide(goal.guide(game.world));
  }

  /** The tip's Show me: where to use it (an industry's card, a hill by the line, the tray's shelf, the research board). */
  function showTip(): void {
    const tip = tips.current();
    if (!tip) return;
    const guide: TipGuide = tip.guide(game.world, tipContext());
    if (guide.board !== undefined) {
      setBoardOpen(true, guide.board === true ? undefined : guide.board);
      return;
    }
    if (guide.line !== undefined) {
      if (game.economy.lines.has(guide.line)) openLineSheet(guide.line, { menu: true });
      else openLines();
      return;
    }
    if (guide.engine !== undefined) interaction.openEngineCard(guide.engine);
    showGuide(guide);
  }

  /** Glide to where a guide points, flash its towns, mark its places, open its tray tab and card. */
  function showGuide(guide: GoalGuide): void {
    interaction.guideSpots = guide.marks.map((p) => ({ x: p.x, z: p.z }));
    if (guide.tab) hud.openTray(guide.tab, guide.shelf);
    if (guide.draw) hud.nudgeDraw();
    // The card to choose from ("Make a switch": the workshop's, its Switch row there to tap).
    if (guide.card !== undefined) interaction.openDepotCard(guide.card);
    // An old industry's ruin to restore ("Open a farm"): its card, with Restore on it.
    if (guide.ruin !== undefined) openRuin(guide.ruin);
    // The piece it asks for comes out of the tray the way it fits at the spot shown.
    interaction.guideHeld(guide.held ?? null);
    if (guide.points.length > 0) {
      // The places along the screen's long side, with room round them for their surroundings (and for the goals card
      // and the tray, which cover the top and the bottom of the screen).
      // Fitted in the room the map has (QA: in landscape a marker sat behind the card, and a bridge's line under the
      // goals); facing along the places, and no closer than their surroundings want (a lone spot).
      const f = frameAlong(guide.points, game.camera.fov, game.camera.aspect, GOAL_MARGIN);
      const pts = guide.points.map((q) => new Vector3(q.x, 0, q.z));
      frameInRoom(pts, Math.min(f.distance, game.controls.maxDistance), game.controls.maxDistance, pts.length, f.theta ?? undefined);
    }
    if (guide.towns.length > 0) game.flourishes.add(game.landscapeView.flash(guide.towns));
    const grid = game.landscape.grid;
    const ground = (x: number, z: number) => {
      const i = grid.cellAtWorld(x, z);
      return i < 0 ? 0 : grid.groundY(i);
    };
    // The goal's towns get rings at their stations, and their names over them (they're small from far off).
    const towns = guide.towns.map((id) => game.landscape.towns.find((t) => t.id === id)).filter((t) => !!t);
    const marks = goalMarks(game.scene, [...guide.marks, ...towns.map((t) => t.station)].map((p) => ({ x: p.x, y: ground(p.x, p.z), z: p.z })));
    if (marks) game.flourishes.add(marks);
    const labels = goalLabels(game.camera, game.canvas, towns.map((t) => ({ x: t.station.x, y: ground(t.station.x, t.station.z) + 90, z: t.station.z, text: t.name })));
    if (labels) game.flourishes.add(labels);
    game.invalidate();
  }

  function resetGoals(): void {
    interaction.guideSpots = [];
    progress = Progress.fresh();
    hud.setCoins(progress.coins);
    crafting.setProgress(progress);
    saveProgress(progress.toJSON());
    refreshBoard();
    refreshPill();
    closeRewards();
    goals = new GoalTracker();
    saveGoals([]);
    stickers = new StickerTracker();
    saveStickers([]);
    stickersSeen = new Set();
    saveStickersSeen([]);
    stickersOpen = false;
    tips = new TipTracker();
    saveTips(tips.toJSON());
    journal.clear();
    growth = null;
    ticks = new GoalTicks();
    ticksToasted = false;
    goalsPanel.reset();
  }

  /** Game mode, in play: start again on the starter map with no goals done, with these hills (the new-game sheet's). */
  function newGame(choices: NewGameChoices, seed: number): void {
    resetGoals();
    saveLastBuilt("game", null);
    setWorld(freshGameWorld(Math.random, choices, seed));
    syncPlaceStyles();
    townLife.reset();
    passengersOn();
    save();
    cloud?.edited("game");
    openingView();
  }

  /** Leave the title for a mode: carry on with its railway, or start it afresh. */
  function play(next: GameMode, fresh: boolean, choices: NewGameChoices = DEFAULT_CHOICES, seed?: number): void {
    // From the opening screen: its toys go first, and the screen paints without them before a map is built (building
    // holds the page for a moment, and a toy canvas left showing through it can flash white).
    if (overOpening) {
      if (leaving) return;
      leaving = true;
      toys?.stop();
      requestAnimationFrame(() => setTimeout(() => begin(next, fresh, choices, seed), 0));
      return;
    }
    begin(next, fresh, choices, seed);
  }

  /** Load or make the mode's world, and play. */
  function begin(next: GameMode, fresh: boolean, choices: NewGameChoices = DEFAULT_CHOICES, seed?: number): void {
    interaction.guideSpots = [];
    leaving = false;
    if (fresh && next === "game") resetGoals();
    if (fresh) saveLastBuilt(next, null);
    if (fresh) {
      // An older save (the title offers only a fresh start for it): loading it keeps it aside before the new map's autosave.
      if (hasOlderSave(next)) loadFromStorage(next);
      setWorld(next === "game" ? freshGameWorld(Math.random, choices, seed ?? newMapSeed(true)) : createWorld(seed ?? newMapSeed(false), false, true, false, choices));
      restoreSession(next, false);
      cloud?.edited(next);
    } else if (next !== mode) {
      const saved = loadFromStorage(next);
      if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${next} autosave (${saved.error})`);
      if (saved && !saved.ok && saved.error === OLDER_SAVE) hud.toast("That map was saved by an older version of the game (it's kept aside): here's a fresh one", false, 6000);
      setWorld(saved?.ok ? saved.value : buildStarterWorld(next === "game"));
      restoreSession(next, !!saved?.ok);
    }
    enter(next, fresh);
    openingView();
  }

  /**
   * Game mode's models (its industries, upgrade machines and cargo loads: industry.glb), fetched the first time Game
   * mode starts and never in Sandbox. Once in, the depots' goods and yards are rebuilt with them and the industries'
   * tray pictures drawn; until then the depots show their stand-ins. A failed fetch is tried again on the next entry.
   */
  let gameModels: Promise<void> | null = null;
  function ensureGameModels(): void {
    gameModels ??= loadGameModels().then(
      () => {
        game.depotView.rebuildUnits();
        game.depotView.setWorld(game.economy, game.layout);
        // (The ruins are the industries' models too.)
        game.syncRuins(true);
        for (const key of drawThumbnails(industryItems)) pictureDrawn(key);
        game.invalidate();
      },
      (e: unknown) => {
        console.warn("Woodrail: couldn't load Game mode's models", e);
        gameModels = null;
      },
    );
  }

  /** Start playing a mode on the world now loaded. */
  let heldWarmed = false;
  function enter(next: GameMode, fresh = false): void {
    closeLines();
    mode = next;
    progressSig = null;
    saveLastMode(mode);
    title.hide();
    // What the start-up cloud check did to this mode's railway.
    const note = cloudNotes[next];
    if (note) {
      delete cloudNotes[next];
      hud.toast(CLOUD_NOTES[note], false, 7000);
    }
    if (olderSave) {
      olderSave = false;
      hud.toast("Your last map was saved by an older version of the game (it's kept aside): here's a fresh one", false, 6000);
    }
    leaveOpening();
    // The first frames after the map appears (or changes) are slow while it settles: not a reason to draw coarser.
    game.settleResolution();
    game.director.cancel();
    game.paused = pausedBeforeTitle;
    hud.setPaused(game.paused);
    hud.setMode(mode);
    showDate();
    refreshPill();
    // Town houses and placed models can be moved in Sandbox only.
    interaction.propsEditable = mode === "sandbox";
    // Sandbox's chain hints (see `showDepotChain`); its own industries' models, if the map has any of Game mode's kinds.
    interaction.depotChain = chainsShown() ? showDepotChain : null;
    hud.setChainHints(chainHintsOn);
    hideChainHints();
    if (mode === "sandbox" && game.economy.allDepots().some((d) => INDUSTRY_ROLE[game.layout.getPiece(d.pieceId)?.type ?? "straight-216"] && d.role !== "forest" && d.role !== "sawmill")) ensureGameModels();
    // (A town's card: its ledger in Game mode, its goods in Sandbox.)
    interaction.townCard = mode === "game" ? townCard : null;
    hud.setVisible(true);
    playing = true;
    // The tray's held piece's shaders, compiled ahead of the first drag (once, a moment after play starts).
    if (!heldWarmed) {
      heldWarmed = true;
      setTimeout(() => void interaction.warmHeld(), 1500);
    }
    stats.record({ e: "start", mode, fresh });
    stretchFrom = performance.now();
    clearTimeout(statsAskTimer);
    if (mode === "sandbox" && stats.shouldAsk) statsAskTimer = window.setTimeout(askStats, SANDBOX_ASK_MS);
    save();
    goalsPanel.setVisible(mode === "game");
    // An industry you place must stand near what it works with (trees, fields): Game mode's rule.
    // (A school stands beside a town, one a town: the one being moved doesn't count against itself.)
    interaction.siteRule =
      mode === "game"
        ? (type, pose, ignoreId, y) =>
            siteWhy(game.landscape, type, pose, (town) => schoolOf(game.world, town, (id) => ignores(ignoreId, id)), plantedCells(game.landscape, game.world.props)) ??
            haltWhy(game.landscape, type, pose) ??
            // (Grand Central stands by the city that's building it: src/game/grand.ts.)
            centralWhy(game.world, type, haltTown(game.landscape, pose)) ??
            // (Two levels under a town: the digging's paid for as it goes down, and refused if the coins are short.)
            (y !== undefined ? digWhy(game.world, progress, type, pose, y) : null)
        : null;
    // Tunnels: learned in Game mode, always in Sandbox.
    game.setTunnels(mode === "sandbox" || progress.learned.has("tunnels"));
    // A drawn line uses only the pieces in the toy box (Game mode).
    interaction.draw.stock = mode === "game" ? pieceStock : null;
    interaction.tunnelStock = mode === "game" ? () => pieceStock("tunnel-mouth-short") : null;
    interaction.draw.unlearned = mode === "game" ? pieceUnlearned : null;
    // A tap on a road turns a turntable to it (Game mode's Turntable controls blueprint; Sandbox, always).
    interaction.deckRoads = () => mode !== "game" || progress.learned.has(TURNTABLE_CONTROLS);
    // Road squares cost coins (Game mode's Roads blueprint): a square beyond those in the box is bought as it goes down.
    interaction.roadTill = mode === "game" ? { refuse: (added) => roadRefusal(added) } : null;
    if (mode === "game") {
      ensureGameModels();
      syncPlaceStyles();
      townLife.reset();
      passengersOn();
      progress.coverMap(game.world);
      // (The lanes the map came with are yours: a new game's, or a save's from before roads were bought.)
      progress.coverRoads(roadsOnMap(game.landscape.grid));
      // (Squares dug under towns before digging was paid for (an older save's tunnels): counted as paid.)
      progress.dug = Math.max(progress.dug, squaresDugUnder(game.world));
      // (A save from before first-time gifts: its towns' levels were reached already.)
      for (const t of game.landscape.towns) progress.bestLevel = Math.max(progress.bestLevel, townLife.status(t.id).level);
      // (A save from before the first-flour bonus whose towns have had flour: it's had its first.)
      flourBefore(progress, game.world);
      syncLandmarks();
      hud.trayBadge = trayBadge;
      hud.trayLock = (item) => {
        const lock = lockOf(item);
        return lock && unlockHow(progress, lock.tech);
      };
      hud.trayKnown = (item) => (item.kind === "road" ? progress.learned.has(ROAD_TECH[item.piece]) : item.kind !== "piece" && item.kind !== "train" && item.kind !== "prop" ? true : [...thingsFor(item).keys()].every((id) => progress.knows(id) && (!isGift(id) || (progress.owned.get(id) ?? 0) > 0)));
      // A tab that needs a blueprint (Roads) shows once it's learned.
      hud.tabKnown = (tech) => progress.learned.has(tech);
      hud.refreshTabs();
      hud.setCoins(progress.coins);
      refreshBoard();
    } else {
      townLife.clear();
      retireStyles([]);
      detachResearch(game.economy);
      detachPassengers(game.world);
      detachEngines(game.world);
      game.economy.craneTicks = CRANE_TICKS;
      game.economy.craneLoads = 1;
      game.economy.wagonCapacity = WAGON_CAPACITY;
      showWaiting();
      shownDelivered = new Map();
      hud.trayBadge = null;
      hud.trayLock = null;
      hud.hideLockNote();
      hud.trayKnown = null;
      hud.tabKnown = null;
      hud.refreshTabs();
      hud.setCoins(null);
    }
    industriesChanged();
    // Rewards waiting from before (Game mode): the badge, the sheet shut.
    closeRewards();
    checkGoals(false);
    hud.firstVisitHelp();
  }

  const listen = (x: number, z: number): [number, number] => {
    // Volume falls off with distance from the camera's focus; pan follows screen position.
    const t = game.controls.target;
    const cam = game.camera.position;
    const d = Math.hypot(x - t.x, z - t.z) + cam.distanceTo(t) * 0.35;
    const volume = Math.min(1, 500 / (d + 150));
    const right = { x: Math.cos(game.camera.rotation.y), z: -Math.sin(game.camera.rotation.y) };
    const pan = ((x - t.x) * right.x + (z - t.z) * right.z) / 900;
    return [volume, pan];
  };
  // A big station's guard raises his flag as a train sets off: a soft whistle, heard from the camera as its trains are.
  game.onGuardFlag = (x, z) => audio.guardWhistle(...listen(x, z));

  const carPoint = (trainId: number, bogie = 0) => game.sim.getTrain(trainId)?.world[bogie];
  const whistles = new WhistlePosts();
  // The Telegraph's wires from each signal box along its poles (built again only when the props change).
  const telegraphWires = new TelegraphWires(game.mats.lacquer("#3a3a3a"));
  game.scene.add(telegraphWires.mesh);
  const crossingBells = new CrossingBells();
  const bellScratch = new Vector3();
  /**
   * Which engine by a whistle post whistles in a frame, and how loud: heard from the camera as `listen` hears its
   * clacks (louder and more central the nearer it is), the nearest train's whistle winning over a far one's.
   */
  const whistleCalls = new WhistleCalls();
  const playWhistle = (v: number, pan: number) => audio.whistle(v, pan);
  const trainAlive = (id: number) => !!game.sim.getTrain(id);
  const whistleFor = (trainId: number, v: number, pan: number) => {
    const t = game.sim.getTrain(trainId);
    if (!t || !whistles.has(t.bogies[0].pieceId) || !t.cars.some((c) => c.kind === "engine")) return;
    whistleCalls.offer(trainId, v, pan, performance.now());
  };
  /** Where a depot's crane works (world plan point). */
  const depotPoint = (depotId: number) => {
    const d = game.economy.depot(depotId);
    const p = d && game.layout.getPiece(d.pieceId);
    if (!d || !p) return null;
    return { x: p.pose.x + Math.cos(p.pose.heading) * d.craneAt, z: p.pose.z + Math.sin(p.pose.heading) * d.craneAt };
  };
  let sawClock = 0;
  let shownDelivered = new Map<number, number>();
  /** Update a town's sign when its delivery count changes (made once: called every frame). */
  const showDelivered = (n: number, townId: number) => {
    if (shownDelivered.get(townId) === n) return;
    shownDelivered.set(townId, n);
    game.landscapeView.setDelivered(townId, n);
  };

  // Performance overlay (backtick).
  let fps = 60;
  window.addEventListener("keydown", (e) => {
    // Typing (a debug report's note): the keys are the text's.
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    if (e.key === "`") hud.perf.hidden = !hud.perf.hidden;
    // Esc puts away the topmost thing: the ☰ menu first (it sits over the map and the board), then the map or board.
    if (e.key === "Escape" && hud.menuOpen) {
      hud.closeMenu();
      return;
    }
    if (e.key === "Escape" && mapView.open) closeMap(true, true);
    if (e.key === "Escape" && board.open) setBoardOpen(false);
    // (A line sheet with no train's card under it: Esc closes it, as it closes a card. A train's planning ends as its
    // card closes.)
    if (e.key === "Escape" && planning && sheetEngine === -1) setPlanning(false);
    if (e.key === "Escape" && linesView.open) closeLines();
    if (e.key === " " && !title.shown && tag !== "BUTTON") {
      e.preventDefault();
      game.paused = !game.paused;
      hud.setPaused(game.paused);
    }
  });
  /**
   * The opening view: a medium view of where track was last put down (else of the track built so far) or, on a bare
   * map, the first two towns (in Game mode, with a hint to join them: Sandbox has no goals).
   */
  /**
   * Back to the player's railway (the brand tapped): all the track they've laid, framed (or, before any, the first two
   * towns), keeping the way the view faces.
   */
  function backToRailway(): void {
    // The track, end to end (its pieces' ends and middles), or the first towns' stations if there's none yet.
    const points: Vector3[] = [];
    const end = createWorldConnector();
    for (const id of game.layout.pieceIds()) {
      const piece = game.layout.getPiece(id)!;
      if (isFixedPiece(id) || piece.type === "riser") continue;
      const c = pieceCentre(game.layout, id);
      points.push(new Vector3(c.x, piece.y, c.z));
      const n = getPieceDef(piece.type, piece.flipped).connectors.length;
      for (let i = 0; i < n; i++) {
        game.layout.worldConnector(connectorRef(id, i), end);
        points.push(new Vector3(end.x, end.y, end.z));
      }
    }
    if (points.length === 0) for (const t of game.landscape.towns.slice(0, 2)) points.push(new Vector3(t.station.x, 0, t.station.z));
    if (points.length === 0) return;
    // Facing along it (up a phone held upright), turned the shorter way round from where the view faces now.
    const f = frameAlong(points, game.camera.fov, game.camera.aspect, GOAL_MARGIN);
    const now = new Spherical().setFromVector3(game.camera.position.clone().sub(game.controls.target));
    let theta = f.theta ?? now.theta;
    if (Math.abs(Math.atan2(Math.sin(theta - now.theta), Math.cos(theta - now.theta))) > Math.PI / 2) theta += Math.PI;
    // In the room the HUD leaves: below the top bar (and the goals), above the tray.
    const r = game.canvas.getBoundingClientRect();
    let top = 0;
    for (const e of document.querySelectorAll(".hud .brand, .hud .actions, .hud .goals")) {
      const b = e.getBoundingClientRect();
      if (b.height > 0 && b.top < r.height / 3) top = Math.max(top, b.bottom - r.top);
    }
    // (Above the tools floating over the tray too, Draw and Turn, where they float: not on a phone, where they're in its row.)
    let bottom = r.height;
    for (const e of [hud.tray, ...document.querySelectorAll(".tray-draw, .tray-orient")]) {
      const b = e.getBoundingClientRect();
      if (b.height > 0) bottom = Math.min(bottom, b.top - r.top);
    }
    const fit = fitToRect(points, game.camera, now.phi, theta, { left: 0, top, right: r.width, bottom }, r.width, r.height, 24);
    game.follow(-1);
    game.director.glideTo(fit.target, Math.min(fit.distance, game.controls.maxDistance), { theta, duration: 0.9 });
  }

  function openingView(): void {
    let at = loadLastBuilt(mode);
    if (!at) {
      // No note of it (an older save): the middle of the track built so far.
      let n = 0;
      let x = 0;
      let z = 0;
      for (const id of game.layout.pieceIds()) {
        if (isFixedPiece(id) || game.layout.getPiece(id)!.type === "riser") continue;
        const c = pieceCentre(game.layout, id);
        x += c.x;
        z += c.z;
        n++;
      }
      if (n > 0) at = { x: x / n, z: z / n };
    }
    if (at) {
      game.lookAt(new Vector3(at.x, 0, at.z), OPENING_DISTANCE, 1.0);
      return;
    }
    const [a, b] = game.landscape.towns;
    if (!a || !b) return;
    // The two stations to join, along the screen's long side (up a phone held upright), close enough to see them.
    const f = frameAlong([a.station, b.station], game.camera.fov, game.camera.aspect, GOAL_MARGIN);
    game.lookAt(new Vector3(f.x, 0, f.z), f.distance, 0.95, f.theta);
    // The hint toast shows across the top of the screen: the view leans toward the upper town (and stands back a
    // little), so neither town is under it.
    const up = [a.station, b.station].map((s) => new Vector3(s.x, 0, s.z).project(game.camera).y);
    const top = up[0] > up[1] ? a.station : b.station;
    const lean = 0.15;
    game.lookAt(new Vector3(f.x + (top.x - f.x) * lean * 2, 0, f.z + (top.z - f.z) * lean * 2), f.distance * 1.3, 0.95, f.theta);
    if (mode !== "game") return;
    keepStartRuinsInView([a.station, b.station]);
    // Their names over them for a while (as "Show me" does): the chip only says "Join two towns".
    if (game.layout.pieceCount === game.stations.size + game.depots.size) {
      const grid = game.landscape.grid;
      const y = (p: { x: number; z: number }) => grid.groundY(Math.max(0, grid.cellAtWorld(p.x, p.z))) + 90;
      const labels = goalLabels(game.camera, game.canvas, [a, b].map((t) => ({ x: t.station.x, y: y(t.station), z: t.station.z, text: t.name })), 9);
      if (labels) game.flourishes.add(labels);
    }
    // A bare map: suggest the first job.
    if (game.layout.pieceCount === game.stations.size + game.depots.size) {
      window.setTimeout(() => {
        if (game.layout.pieceCount === game.stations.size + game.depots.size) hud.toast(`Join ${a.name} and ${b.name} with track`, false, 6000);
      }, 1200);
    }
  }
  /**
   * The opening view slid sideways (not drawn back) just enough that the old industries' ruins by the first towns are
   * on the screen whole, their yards and buildings, if the towns' stations (`keep`) stay on it too. QA, 390 × 844: the
   * starter's old farm stood at the screen's left edge, half off it. A few points projected, once, at the start.
   */
  function keepStartRuinsInView(keep: readonly { x: number; z: number }[]): void {
    const mid = { x: keep.reduce((s, p) => s + p.x, 0) / keep.length, z: keep.reduce((s, p) => s + p.z, 0) / keep.length };
    const span = Math.max(...keep.map((p) => Math.hypot(p.x - mid.x, p.z - mid.z)));
    const ruins = (game.landscape.sites ?? []).filter((s) => !s.cleared && Math.hypot(s.centre.x - mid.x, s.centre.z - mid.z) < span * 1.5);
    if (ruins.length === 0) return;
    const margin = 12;
    const width = game.canvas.getBoundingClientRect().width;
    const sx = (x: number, y: number, z: number) => {
      game.camera.updateMatrixWorld();
      return ((new Vector3(x, y, z).project(game.camera).x + 1) / 2) * width;
    };
    // (A ruin's yard, buildings and stub: the box a tap on it finds it in, `ruinAt`'s.)
    const corners = ruins.flatMap((s) => {
      const c = Math.cos(s.piece.heading);
      const n = Math.sin(s.piece.heading);
      return [[-12, -30], [228, -30], [228, 130], [-12, 130]].map(([t, l]) => ({ x: s.piece.x + c * t - n * l, z: s.piece.z + n * t + c * l }));
    });
    for (let k = 0; k < 2; k++) {
      const xs = corners.map((p) => sx(p.x, 30, p.z));
      const lo = Math.min(...xs);
      const hi = Math.max(...xs);
      const dx = lo < margin ? margin - lo : hi > width - margin ? width - margin - hi : 0;
      if (Math.abs(dx) < 1 || hi - lo > width - 2 * margin) return;
      // The view's right, along the ground, and how many pixels a step of it moves the ground at the view's middle.
      const target = game.controls.target.clone();
      const right = new Vector3().setFromMatrixColumn(game.camera.matrixWorld, 0).setY(0).normalize();
      const perMm = (sx(target.x + right.x * 100, 0, target.z + right.z * 100) - sx(target.x, 0, target.z)) / 100;
      if (!(perMm > 0)) return;
      const back = { target, distance: game.camera.position.distanceTo(target) };
      const spherical = new Spherical().setFromVector3(game.camera.position.clone().sub(target));
      game.lookAt(target.clone().addScaledVector(right, -dx / perMm), back.distance, spherical.phi, spherical.theta);
      // (The first towns stay in view, or the view stays as it was.)
      if (keep.some((p) => sx(p.x, 20, p.z) < margin || sx(p.x, 20, p.z) > width - margin)) {
        game.lookAt(back.target, back.distance, spherical.phi, spherical.theta);
        return;
      }
    }
  }

  // Keys for the route card on a desktop (audit F19): Enter for Done while planning; with a stop picked, Delete (or
  // Backspace) takes it off and ← → move it. They press the card's own buttons (the same edits, one undo step each),
  // and are the card's alone then (not the editor's Delete, nor the view's arrows).
  window.addEventListener(
    "keydown",
    (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey || interaction.openEngineCarId === -1 || hud.engineExtra.hidden) return;
      const box = hud.engineExtra;
      const press = (b: HTMLButtonElement | null | undefined) => {
        if (!b || b.disabled) return false;
        b.click();
        e.preventDefault();
        e.stopImmediatePropagation();
        return true;
      };
      if (e.key === "Enter" && planning && tag !== "BUTTON") press(box.querySelector<HTMLButtonElement>(".route-plan.on"));
      else if ((e.key === "Delete" || e.key === "Backspace") && (stopPicked >= 0 || viaPicked)) press(box.querySelector<HTMLButtonElement>(".route-tools .route-remove"));
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && stopPicked >= 0)
        press([...box.querySelectorAll<HTMLButtonElement>(".route-tools .route-move")].find((b) => b.textContent === (e.key === "ArrowLeft" ? "←" : "→")));
    },
    { capture: true },
  );

  const skipGlide = () => {
    if (game.director.busy) game.director.cancel();
  };
  window.addEventListener("pointerdown", skipGlide, { capture: true });
  window.addEventListener("keydown", skipGlide, { capture: true });

  /** Trains first stuck in each other's way (nose to nose on a single line, say): once, say how they could pass. */
  let loopTipShown = (() => {
    try {
      return localStorage.getItem("woodrail.loopTip") === "1";
    } catch {
      return false;
    }
  })();
  /**
   * A line's trains waiting for each other on a long stretch (signals spec §7): once ever, after Signals is learned,
   * say a signal would let them follow, and show where. Looked for once a game second till said.
   */
  let followTold = (() => {
    try {
      return localStorage.getItem("woodrail.followTip") === "1";
    } catch {
      return false;
    }
  })();
  let followLooked = 0;
  function lookForFollowers(): void {
    if (followTold || Math.abs(game.simSeconds - followLooked) < 1) return;
    followLooked = game.simSeconds;
    if (mode === "game" && !progress.learned.has("routes")) return;
    const at = game.economy.sections.followSpot();
    if (at === -1) return;
    followTold = true;
    try {
      localStorage.setItem("woodrail.followTip", "1");
    } catch {
      // storage unavailable: it may show again next visit
    }
    hud.toast(FOLLOW_TIP, false, 8000, () => interaction.showSignalSpot(at));
  }

  /** A train too long for a lift is told so once (for a few minutes), not on every approach. */
  const tooLong = new TooLongNotice();
  /** The lifts heard riding (for the clunk as each gets there), and where. */
  const liftsHeard = new Map<number, { x: number; z: number }>();
  const fullToast = (_lineId: number, room: number, trains: number, more: number) => hud.toast(fullLineToast(room, trains, more), false, 6000);
  const stuckTip = (_engines: readonly number[], why: Stuck) => {
    if (why.kind === "in-way" && !loopTipShown) showLoopTip();
  };
  function showLoopTip(): void {
    loopTipShown = true;
    try {
      localStorage.setItem("woodrail.loopTip", "1");
    } catch {
      // storage unavailable: it may show again next visit
    }
    hud.toast(headOnTip(mode !== "game" ? null : progress.learned), false, 6000);
  }

  // (The camera tutorial counts the player's own camera moves: told only on frames the camera moved.)
  game.onCameraMoved = () => hud.coach.cameraMoved();
  game.onFrame = (dt) => {
    devChecks?.frame();
    interaction.refreshDepotCard();
    showSchoolYard();
    // The Turn arrow shows the next piece's or model's way as seen now, so it turns with the camera.
    hud.setTrayArrow(interaction.trayArrow(hud.propsTab && !interaction.holdingKit));
    hud.setHoldingKit(interaction.holdingKit);
    interaction.tick(dt);
    const now = performance.now();
    if (mapView.open) {
      if (now - mapRefreshedAt > 1000) refreshMap();
      else placeMap();
      // The view has stopped moving, and stayed still a moment (the glide to the whole map landed, however long it
      // took; a pan, pinch or fling done): the labels are where they'll stay, laid out afresh, and a toast up keeps clear of them there. (Five
      // numbers compared a tick, only while the map's open.)
      const cam = game.camera.position;
      const tgt = game.controls.target;
      const v = mapViewSeen;
      if (v[0] !== cam.x || v[1] !== cam.y || v[2] !== cam.z || v[3] !== tgt.x || v[4] !== tgt.z) {
        v[0] = cam.x;
        v[1] = cam.y;
        v[2] = cam.z;
        v[3] = tgt.x;
        v[4] = tgt.z;
        mapMoving = true;
        mapMovedAt = now;
        mapStillTicks = 0;
      } else if (mapMoving && !game.director.busy && ++mapStillTicks >= MAP_STILL_TICKS && now - mapMovedAt >= MAP_STILL_MS) {
        mapMoving = false;
        refreshMap();
        hud.mapSettled();
      }
    } else {
      // (Forgotten while it's shut: opened again, the view counts as moved, and settles once.)
      mapMoving = false;
      mapViewSeen[0] = NaN;
    }
    let hum = 0;
    // Whistle posts' near track: worked out again only when the props or the track change.
    whistles.sync(game.layout, game.props, game.trackVersion);
    if (telegraphWires.sync(game.props, interaction.telegraph?.() ?? false)) game.invalidate();
    for (const e of game.events) {
      // A train too long for a lift's platform: it turns back at the end, and the player is told why (once).
      // (Once a train, not on each approach: by its cars, as it comes back from turning round a new train.)
      if (e.kind === "lift-refused") {
        if (tooLong.shouldTell(e.carIds, now, e.trainId)) hud.toast(TOO_LONG_MESSAGE);
      }
      const p = carPoint(e.kind === "turned" ? e.newTrainId : e.trainId, e.kind === "joint" ? e.bogie : 0);
      if (!p) continue;
      if (e.kind === "turned") {
        audio.rotate();
        continue;
      }
      const [v, pan] = listen(p.x, p.z);
      if (e.kind === "joint") {
        audio.clack(v, pan);
        // An engine coming onto track near a whistle post whistles (once as it passes).
        if (e.bogie === 0 && whistles.size > 0) whistleFor(e.trainId, v, pan);
      } else if (e.kind === "coupled") audio.magnet(v, pan);
      else if (e.kind === "derailed") audio.crash(v, pan);
      else if (e.kind === "buffer") audio.magnet(v * 0.6, pan);
    }
    whistleCalls.flush(now, playWhistle, trainAlive);
    // Level crossings: a soft "ding ding" as barriers come down, for one on the screen and near the camera's focus.
    const rung = crossingBells.ring(game.crossingsView.closing, now, (x, z) => {
      const c = bellScratch.set(x, 0, z).project(game.camera);
      return Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1 && c.z < 1 ? listen(x, z) : null;
    });
    if (rung) audio.crossingBell(rung[0], rung[1]);
    for (const t of game.sim.trains()) {
      if (t.derailed || t.speed < 5 || !t.cars.some((c) => c.kind === "engine" && c.lever !== 0)) continue;
      hum += listen(t.world[0].x, t.world[0].z)[0];
    }
    audio.setHum(game.paused ? 0 : hum);
    // Train lifts: a clunk as one sets off and as it gets there, and its gear winding while it rides (paused, its ride
    // holds, quiet). Nothing riding and none heard riding: one comparison.
    const riding = game.sim.ridingLifts();
    if (riding.length > 0 || liftsHeard.size > 0) {
      let wind = 0;
      for (const id of riding) {
        const at = game.layout.getPiece(id) ? pieceCentre(game.layout, id) : null;
        if (!at) continue;
        const [v, pan] = listen(at.x, at.z);
        if (!liftsHeard.has(id)) {
          liftsHeard.set(id, at);
          audio.liftClunk(v, pan);
        }
        wind = Math.max(wind, v);
      }
      for (const [id, at] of liftsHeard) {
        if (riding.includes(id)) continue;
        liftsHeard.delete(id);
        audio.liftClunk(...listen(at.x, at.z));
      }
      audio.setWinding(game.paused ? 0 : wind);
    }

    // Cranes: a clunk per unit, and a chime when planks reach a town. Saws buzz while they cut.
    for (const e of game.economy.drainEvents()) {
      const at = depotPoint(e.depotId);
      if (!at) continue;
      const [v, pan] = listen(at.x, at.z);
      audio.clunk(v, pan);
      if (e.kind === "unloaded" && game.economy.depot(e.depotId)?.role === "town") audio.chime();
    }
    sawClock += dt;
    if (sawClock > 0.5 && !game.paused) {
      sawClock = 0;
      for (const d of game.economy.allDepots()) {
        if (d.role !== "sawmill" || !game.economy.working(d)) continue;
        const at = depotPoint(d.id);
        if (at) audio.saw(...listen(at.x, at.z));
      }
    }
    // Town signs: in Game mode what each town wants (and it grows when it gets it); in Sandbox, delivery counts.
    if (mode === "game") {
      if (playing) townLife.update();
      showWorkshop();
      showFarm();
      showSawmill();
      showHarbour();
      showAirport();
      showMast();
      water?.frame();
      showPower();
      showTracks();
      showWaiting();
    } else game.economy.delivered.forEach(showDelivered);
    // Goals after the towns: a delivery that grows a town is announced (with its tick folded in) before the poll could
    // see the new size and tick it on its own.
    if (now - goalsCheckedAt > 1000) {
      goalsCheckedAt = now;
      checkGoals(true);
    }
    showRibbon();
    animateDiscs();
    showRoute();
    showLines();
    showPlaceRoutes();
    // (A train put on a line with no room for it: said once a line. Set on whichever economy the world has now.)
    if (game.economy.sections.onFull !== fullToast) game.economy.sections.onFull = fullToast;
    if (game.economy.stalls.onStuck !== stuckTip) game.economy.stalls.onStuck = stuckTip;
    lookForFollowers();
    showEngineView();
    showSummary();
    showRefusals();
    showEmpty();
    let derailed = false;
    for (const t of game.sim.trains()) if (t.derailed) derailed = true;
    hud.setRerailVisible(derailed);
    showCraneNews();
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    if (!hud.perf.hidden) {
      const info = game.renderer.info.render;
      hud.perf.textContent = `${fps.toFixed(0)} fps · sim ${game.simMs.toFixed(2)} ms · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${game.layout.pieceCount} pieces · ${qualityFor(game.quality.tier).tier}`;
    }
  };

  // A bridge held still while its taller arches were being made: they come in without waiting for the finger to move.
  onPiecesBuilt(() => interaction.refreshHeld());
  hud.setHistory(false, false);
  updateConnections(false);

  (window as unknown as { woodrail: unknown }).woodrail = Object.assign(game, { airports, airships, editor: () => editor, hud, interaction, title, mode: () => mode, progress: () => progress, journal, note, audio, learn: (id: string) => ((id = RENAMED[id] ?? id), progress.learned.add(id), learned(id)), showMe: () => showGoal(), goals: () => goals, stickers: () => stickers, tips: () => tips, trayThumbnailsSaved: () => trayThumbnailsSaved, routeShown: () => routeView?.shown ?? [], routeLanes: () => routeView?.laneLength ?? 0, linesShared: () => allLines?.sharedLength ?? 0, lines: { sheetLine: () => sheetLine, sheetEngine: () => sheetEngine }, chainHints, mapSettled: () => mapView.open && !mapMoving });
  // (Its code is loaded the first time it's shown.)
  const statsCard = stats.available ? lazy(async () => new (await import("./ui/stats-card")).StatsCard(hud.root, stats, (m) => hud.toast(m))) : null;
  if (statsCard) hud.addStatsItem(() => statsCard.use((c) => c.show()));
  // "Report a bug or give feedback" (src/ui/feedback-sheet.ts), in a build with the cloud Worker to send it to.
  const feedbackUrl = ((import.meta.env.VITE_FEEDBACK_URL || import.meta.env.VITE_STATS_URL || import.meta.env.VITE_CLOUD_URL || "") as string).trim();
  if (crashes) hud.addCrashItem(() => !crashReportsOff(), () => setCrashReportsOff(!crashReportsOff()));
  if (feedbackUrl) {
    // (Its code is loaded the first time it opens.)
    const url = feedbackUrl;
    const sheet = lazy(async () => new (await import("./ui/feedback-sheet")).FeedbackSheet(hud.root, url, {
      map: async () => {
        save();
        return { map: await mapText(mode), mode };
      },
      capture: () => game.capture(),
      info: () => ({ build: __BUILD_ID__ || "dev", badges: [...recentBreaks(), ...recentErrors()] }),
      toast: (m) => hud.toast(m),
    }));
    hud.addFeedbackItem(() => {
      hud.hideCards();
      sheet.use((f) => f.show());
    });
  }
  /** The one-time "Help improve Woodrail?" question: put off while something else is being done. */
  function askStats(): void {
    if (!statsCard || !stats.shouldAsk || !playing) return;
    if (interaction.busy || document.querySelector(".card:not([hidden])")) {
      statsAskTimer = window.setTimeout(askStats, 5000);
      return;
    }
    statsCard.use((c) => c.ask());
  }
  if (cloud) {
    const card = new CloudCard(hud.root, cloud, {
      mode: () => mode,
      // Other railways are in storage now: the game starts again on them, without saving this one over them.
      reload: () => {
        playing = false;
        clearTimeout(saveTimer);
        reloadInto(mode);
      },
      toast: (m) => hud.toast(m),
    });
    hud.addCloudItem(() => card.show());
    cloud.onNote = (_m, note) => note && hud.toast(CLOUD_NOTES[note], false, 7000);
    // A newer copy from another device, taken while playing: the game starts again on it (without saving this one over
    // it), and says so then.
    cloud.mayTake = () => !interaction.busy;
    // Game progress merged with another device's (the railway as it is here): taken up now, before the next save.
    cloud.onMerged = (m) => {
      if (m !== "game" || mode !== "game") return;
      progress = Progress.fromJSON(loadProgress());
      progress.coverMap(game.world);
      progressSig = JSON.stringify(progress.toJSON());
      crafting.setProgress(progress);
      goals = new GoalTracker(loadGoals());
      stickers = new StickerTracker(loadStickers());
      stickersOpen = false;
      syncLandmarks();
      hud.setCoins(progress.coins);
      hud.refreshTrayBadges();
      refreshBoard();
      refreshPill();
      checkGoals(false);
    };
    cloud.onTaken = (m, note) => {
      try {
        if (note) sessionStorage.setItem(CLOUD_NOTE_KEY, JSON.stringify({ mode: m, note }));
      } catch {
        // (Not said.)
      }
      playing = false;
      clearTimeout(saveTimer);
      reloadInto(mode);
    };
  }
  game.start();
  // Opening in Game mode: start fetching its models now, ahead of play.
  if (mode === "game") ensureGameModels();
  loadBar.finish();
  // A newer deploy: offer a chip. Tapping it saves, then reloads past any cached page (the hash, a map link, stays).
  if (__UPDATE_CHECK__) {
    startUpdateCheck({
      currentBuild: __BUILD_ID__,
      onNewVersion: (build) =>
        hud.showUpdate(() => {
          saveOnLeaving();
          const url = `${location.pathname}?v=${encodeURIComponent(build)}${location.hash}`;
          if (playing) reloadInto(mode, url);
          else location.replace(url);
        }),
    });
  }
  restoreSession(mode, opening.fromSave);
  // The loading screen's toys play their entry in full before it moves on (it's short, and capped).
  void entryPlayed().then(() => {
    trayThumbnailsSaved = drawTrayThumbnails();
    if (opening.linked) {
      enter(mode);
      openingView();
    } else showTitleOverOpening();
    if (!overOpening) dismissLoading();
  });
}

/** The loading screen's people and street furniture laid out (held back till the map's built). */
let toysEntry: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The next frame drawn, or 100 ms (no frames come while the tab is hidden: never wait on them alone). */
const nextFrame = () => Promise.race([new Promise<void>((r) => requestAnimationFrame(() => r())), sleep(100)]);

/**
 * The map's built: the toys' entry plays to its end before the loading screen moves on. The people and the street's
 * furniture hop in only now, once the map's first frames are drawn (the building would stall them mid-hop), and the
 * wait is short and capped, so a quick load never hangs here.
 */
async function entryPlayed(): Promise<void> {
  await nextFrame();
  await nextFrame();
  // Laid out by now, unless their models are slow (then they're skipped).
  await Promise.race([toysEntry, sleep(800)]);
  toys?.release(120);
  await sleep(Math.min(3000, Math.max(0, (toys?.doneAt ?? 0) - performance.now())));
}

/** Say on the loading screen that the toys couldn't be fetched, with a button to try again. */
function offerRetry(again: () => void): void {
  const box = loading?.querySelector("div");
  if (!box) return;
  const note = document.createElement("p");
  note.textContent = "Couldn't fetch the toys. Check the connection, then try again.";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "load-retry";
  button.textContent = "Try again";
  button.addEventListener("click", () => {
    note.remove();
    button.remove();
    again();
  });
  box.append(note, button);
}

/**
 * The loading bar: each part of the loading has a share of it (the track pieces by how many are carved). It stops just
 * short of the end until the game is built.
 */
const loadBar = (() => {
  const bar = loading?.querySelector<HTMLElement>(".load-bar");
  const shares = { trains: 0.15, dressing: 0.15, thumbnails: 0.05, pieces: 0.55 };
  const done: Record<keyof typeof shares, number> = { trains: 0, dressing: 0, thumbnails: 0, pieces: 0 };
  const show = (p: number) => {
    bar?.style.setProperty("--p", p.toFixed(3));
    bar?.setAttribute("aria-valuenow", String(Math.round(p * 100)));
  };
  return {
    /** How far along a part is (0 to 1). */
    set(part: keyof typeof shares, fraction: number): void {
      done[part] = Math.max(done[part], fraction);
      show((Object.keys(shares) as (keyof typeof shares)[]).reduce((p, k) => p + shares[k] * done[k], 0));
    },
    finish: () => show(1),
  };
})();

/** Toys hopping onto the loading screen as their models arrive (none if WebGL won't start for it). */
// The wood's and felt's generated textures, as an earlier visit to this build made them: read first thing, so the
// loading screen's toys and the map use them (what's made afresh is kept after the map's built).
const texturesKept = loadCached<Map<string, Uint8ClampedArray[]>>("textures", __BUILD_ID__).then((t) => useTextureCache(t));
const toys = ((): LoadingToys | null => {
  const canvas = loading?.querySelector<HTMLCanvasElement>(".loading-toys");
  if (!canvas) return null;
  try {
    return new LoadingToys(canvas);
  } catch {
    canvas.remove();
    return null;
  }
})();
if (toys) {
  // One after another: the train, then the platform's folk, then the street's furniture.
  const pop = async (models: Map<string, Object3D>, shelf: Shelf, list: [string, Record<string, string>?][]) => {
    // (After the kept textures are read: the first toy makes the materials.)
    await texturesKept;
    for (const [id, slots] of list) {
      const model = models.get(id);
      if (model) toys.add(model, shelf, slots);
      await new Promise((r) => setTimeout(r, 180));
    }
  };
  toysEntry = (async () => {
    try {
      const trains = loadModelSet("trains");
      const dressing = loadModelSet("dressing", true);
      await pop(await trains, "train", [["engine-classic"], ["passenger-classic"], ["passenger-dining"], ["hopper-classic"], ["timber-classic"], ["caboose-classic"]]);
      // The people and the street's furniture, each shelf laid out whole, to hop in one by one in place once the map's
      // built (see `entryPlayed`).
      const dressed = await dressing;
      const row = (list: [string, Record<string, string>?][]) =>
        list.flatMap(([id, slots]) => {
          const model = dressed.get(id);
          return model ? [{ model, slots }] : [];
        });
      toys.addRow(
        "folk",
        row([
          ["porter"],
          ["peg-doll-hat", { coat: "#2f6db5", hat: "#2a2b2e" }],
          ["traveller"],
          ["peg-doll", { coat: "#3f8f4e" }],
          ["conductor"],
          ["peg-doll-hat", { coat: "#e6b52c", hat: "#c8442f" }],
          ["peg-doll", { coat: "#c8442f" }],
        ]),
      );
      toys.addRow(
        "street",
        row([
          ["lamp"],
          ["bench"],
          ["postbox"],
          ["planter", { flower0: "#d9443a", flower1: "#e6b52c", flower2: "#e98aa8", flower3: "#f3ead8" }],
          ["fountain"],
          ["phone"],
          ["busstop"],
          ["lamp"],
        ]),
      );
    } catch {
      // The loading screen says so itself (see offerRetry).
    }
  })();
}

// Let the loading screen paint, carve the track pieces in background workers (several at once), then build the rest.
requestAnimationFrame(() =>
  setTimeout(() => {
    const t0 = performance.now();
    // The trains and the map's building parts are needed before anything is built: the loading screen stays until
    // they're in (each fetch retries), and offers to try again if they can't be had.
    const models = (): Promise<void> =>
      loadBlenderModels().catch((e: unknown) => {
        console.error("Woodrail: couldn't load the models", e);
        return new Promise<void>((resolve) => offerRetry(() => resolve(models())));
      });
    void loadModelSet("trains").then(() => loadBar.set("trains", 1), () => {});
    void loadModelSet("dressing", true).then(() => loadBar.set("dressing", 1), () => {});
    void Promise.all([
      TrackView.carveInBackground(PIECE_TYPES),
      loadCached<Map<string, string>>("thumbnails", __BUILD_ID__).then((t) => (loadBar.set("thumbnails", 1), t)),
      models(),
      texturesKept,
      // (Zod and the save's schemas, not in the first download: wanted before the save is read, below.)
      loadSaveSchemas(),
    ]).then(async ([, thumbs]) => {
      // The cloud check, under way all this while: waited for only a little longer than the rest took.
      const cloudNotes = { ...takeCloudNote(), ...((await Promise.race([cloudStarted, sleep(CLOUD_WAIT_MS).then(() => ({}))])) as CloudNotes) };
      cloud?.cutoff();
      // Only the pieces the opening railway has (and the title's picture) are waited for: the rest carry on carving
      // in the background, and any wanted before its turn shows as a stand-in for a moment.
      // (A map pasted into the link for a bug report, dev only: put in storage, then opened as the autosave is.)
      const linkedMap = await loadLinkedMap();
      if (linkedMap) {
        saveLastMode(linkedMap);
        try {
          sessionStorage.setItem(RESUME_KEY, linkedMap);
        } catch {
          // No session storage: the title, with the map behind it.
        }
      }
      const opening = initialWorld();
      const wanted = [...new Set([TITLE_ART_PIECE, ...[...opening.world.layout.pieceIds()].map((id) => opening.world.layout.getPiece(id)!.type)])];
      let ready = 0;
      await Promise.all(wanted.map((t) => TrackView.whenBuilt(t).then(() => loadBar.set("pieces", ++ready / wanted.length))));
      console.info(`Woodrail: track pieces ready in ${Math.round(performance.now() - t0)} ms (${wanted.length} kinds; the rest in the background)`);
      boot(thumbs, opening, cloudNotes);
      const madeTextures = texturesMade();
      if (madeTextures) void saveCached("textures", __BUILD_ID__, madeTextures);
      // (The game's materials are made: the pixels kept for them can go.)
      forgetTextureCache();
    });
  }, 30),
);
