import { Group, Mesh, Spherical, Vector3, type Object3D } from "three";
import { ToyAudio } from "./audio/audio";
import { Editor, pieceCentre, TRAIN_ON_TRACK } from "./editor/editor";
import { fitToRect, frameAlong, frameDistance, type ViewRoom } from "./game/camera-director";
import { viewRoom } from "./ui/view-room";
import { Game, type GameWorld } from "./game/game";
import { Interaction } from "./game/interaction";
import { buildStarterWorld, createWorld, freshGameWorld, landForSale, plotsForSale } from "./game/world";
import { connectedPairs, PLOT_DEPTH, PLOT_WIDTH, SURF_RIVER, SURF_SEA, type Landscape, type PlotCoord } from "./landscape";
import { loadLastBuilt, loadLastMode, saveLastBuilt, saveLastMode, type GameMode } from "./game/modes";
import { hasOlderSave, hasSave, loadFromStorage, loadGoals, loadProgress, loadSession, OLDER_SAVE, saveGoals, saveProgress, saveSession, saveToStorage, serializeWorld } from "./persist/save";
import { reporter, startLog, type Reporter } from "./debug/report";
import { GoalTracker, secondEngineTip, trayRing } from "./game/goals";
import { makesLine } from "./game/learn-text";
import { GoalTicks, goalsDoneText, GROWTH_JOIN_S, joins, TOAST_TITLES } from "./game/goal-ticks";
import { GoalsPanel } from "./ui/goals-panel";
import { dateText } from "./game/calendar";
import { Journal, type JournalEntry, type JournalPlace, type NoteInput } from "./game/journal";
import { loadBlenderModels, loadGameModels, loadModelSet } from "./render/blender-models";
import { LoadingToys, type Shelf } from "./ui/loading-toys";
import { goalLabels, goalMarks, SQUARE_RING } from "./render/goal-marks";
import { TownLife } from "./game/town-life";
import { plotPrice } from "./game/towns";
import { cardView, describeThings, firstTimeGift, learnGift, offerOnGrowth, payDelivery, redrawOldOffers, takeCard } from "./game/rewards";
import { landmarkOf, landmarksAt, placedSchools, researchSpeed, schoolGrade, schoolGradesKey } from "./game/landmarks";
import { GrowthSheet, sheetTitle } from "./ui/growth-sheet";
import { mapMarkers, type MapMarker } from "./game/map-markers";
import { MapView } from "./ui/map-view";
import { Progress } from "./game/progress";
import { costOf, craftNow, craftShort, Crafting, keepsForOrder, lacking, makeNote, uncraft, workshops, workshopStock } from "./game/crafting";
import { pieceStock as supplyOf, pieceUnlearned as unlearnedOf } from "./game/supply";
import { costText, isFree, LOOK_TECH, ruleOf, THING_RULES, thingsFor, type ThingId, type ThingItem } from "./game/things";
import { DEPOT_NAMES, depotName, HALT_KITS, HALT_REACH, haltWhy, syncIndustries, INDUSTRY_ROLE } from "./game/world";
import { HaltReachView } from "./render/halt-reach-view";
import { WhistleCalls, WhistlePosts } from "./game/lineside";
import { rateFor, resourceAt, schoolOf, SITE_RULES, siteWhy, updateRates, yardMiddle } from "./game/industries";
import { fieldPrice, fieldSpot, plantField } from "./game/fields";
import { WorkshopPanel, type MakeRow } from "./ui/workshop-panel";
import { routeStops } from "./game/route-stops";
import { editLine, joinLine, LINE_COLOURS, LINE_NAME_MAX, lineOf, moveStop, recolourLine, renameLine, stopLine, trainsOn } from "./game/lines";
import { aheadRuns, legFromCursor, lineLegs, nearestAhead, pinnedBlocking, pointOnPath, stopCursors } from "./game/route-path";
import { LinesView } from "./ui/lines-view";
import { RouteView, type DiscSpec, type GapSpec, type RibbonSpec } from "./render/route-view";
import { decoupleWords } from "./game/decouple-words";
import { engineStatus, headOnTip, trainsForReport, type CantMove } from "./game/engine-status";
import { LIFT_TIP, liftHeldMessage, liftTipSeen, markLiftTipSeen, TooLongNotice, TOO_LONG_MESSAGE } from "./game/lift-notice";
import { MAX_SHEDS, SHED_CAP, type DepotState, type RouteStopDef, type StopAction } from "./economy";
import { BlueprintBoard, type Station } from "./ui/blueprint-board";
import { pieceIcon, trainIcon } from "./ui/icons";
import { needMet, seenOf, TECHS, techOf, unlocksOf } from "./game/tech";
import { attachResearch, detachResearch, lacking as researchLacking, pick as pickResearch, setSpeed, simElapsed, type StudyClock, tick as researchTick } from "./game/research";
import { cardState, goalPick, pickerKey, pillKey, pillView, researchCard, schoolCard, schoolCardKey, showMePick } from "./game/research-text";
import { applyCranes, boostOf, Counters, machinesFor, upgradeKey } from "./game/upgrades";
import { attachEngines, cantMove, detachEngines, tooHeavy } from "./game/engines";
import { BOAT_SAIL, BUY_LOT, buyPrice, goodsForSale, HarbourTrade, SHED_PRICE } from "./game/harbours";
import { CRANE_TICKS, WAGON_CAPACITY } from "./economy/constants";
import { BRANCHES, describeNeed as describeNeedWords, type Need, type Plan } from "./game/blueprints";
import { attachPassengers, detachPassengers, peopleArrive, waitingCap } from "./game/passengers";
import { aOrAn, describe as describeGoods, minus, total, type Bag } from "./economy/goods";
import { costTag, refundText, trayCostTag } from "./ui/cost-tag";
import { GOODS_ICON, type CargoKind } from "./economy/cargo";
import { qualityFor, saveQualityOverride } from "./render/quality";
import type { PropModel } from "./render/props/library";
import { renderThumbnails, ThumbnailStudio, type ThumbnailSubject } from "./render/thumbnails";
import { loadCached, saveCached } from "./render/piece-cache";
import { onPiecesBuilt, TrackView } from "./render/track-view";
import { connectorRef, createWorldConnector, getPieceDef, ignores, isLift, kitOf, pathLength, PIECE_TYPES, type Layout, type PieceTypeId } from "./track";
import { flipCursor, type CarKind, type CarLook, type Cursor } from "./sim";
import { Hud } from "./ui/hud";
import { GAME_KIT_GROUPS, INDUSTRY_GROUPS, TRACK_ITEMS, TRAIN_ITEMS, trayKey, type LandTool, type TrayItem } from "./ui/tray-catalogue";
import { LAND_MESSAGES, LandEditor, plotSlotOf, setHeights } from "./landscape/edit";
import { propsInRect } from "./props/placement";
import { loadMuted, saveMuted } from "./ui/prefs";
import { TITLE_ART_PIECE, TITLE_ART_TRAIN, TitleScreen } from "./ui/title";
import { installClickShield } from "./ui/click-shield";
import { startUpdateCheck } from "./ui/update-check";
import "./style.css";

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

/** A map asked for in the link (`#seed-12345`), to share or replay a particular map. */
function linkedSeed(): number | null {
  const m = /^#seed-(\d{1,9})$/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

/**
 * The world to open with. A linked map opens in Sandbox (fresh, unless the sandbox autosave is already that map, so
 * reloading keeps your track); otherwise the last mode's autosave, or the starter map.
 */
/** The autosave was from an older version of the game (turned away: a fresh map instead). The game says so. */
let olderSave = false;

function initialWorld(): { world: GameWorld; mode: GameMode; linked: boolean; fromSave: boolean } {
  const seed = linkedSeed();
  const mode = seed !== null ? "sandbox" : loadLastMode();
  // Reloaded from play (graphics switched, an update taken): straight back into the game, past the title.
  const resumed = takeResume() === mode;
  const saved = loadFromStorage(mode);
  if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${mode} autosave (${saved.error})`);
  if (saved && !saved.ok && saved.error === OLDER_SAVE) olderSave = true;
  if (seed !== null) {
    const same = saved?.ok && saved.value.landscape.seed === seed && !saved.value.landscape.starter;
    return { world: same ? saved.value : createWorld(seed), mode, linked: true, fromSave: !!same };
  }
  return { world: saved?.ok ? saved.value : buildStarterWorld(), mode, linked: resumed, fromSave: !!saved?.ok };
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

startLog();
/** Where "Send to Claude" reports go (the dev server, or the claude.ai page), or null: no menu item. */
let reports: Reporter | null = null;

function boot(savedThumbnails: Map<string, string> | null, opening: ReturnType<typeof initialWorld>): void {
  const game = new Game(canvas, opening.world);
  let mode = opening.mode;
  /** The research pill as last drawn: its key (`pillKey`) and the progress it was for (a new game starts a new one). */
  let pillKeyShown = "";
  let pillFor: unknown = null;
  /** What the open Research picker was last drawn from (`boardKey`). */
  let boardKeyShown = "";
  // Stations and depots never move (to take up joint play, or to close a near miss).
  const isFixedPiece = (id: number): boolean => [...game.stations.values(), ...game.depots.values()].includes(id);
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
      hud.setHistory(ed.canUndo, ed.canRedo);
      scheduleSave();
    };
    // Every props edit, done, undone or redone (and a land edit recorded): the one place a prop coming or going is
    // heard, so Game mode's toy box counts on the tray follow it here (a made prop, once placed, isn't one left).
    ed.onPropsChange = () => {
      game.propsChanged();
      hud.setHistory(ed.canUndo, ed.canRedo);
      if (mode === "game") hud.refreshTrayBadges();
      scheduleSave();
    };
    return ed;
  };
  let editor = makeEditor();
  let saveTimer = 0;
  let interaction: Interaction;
  const audio = new ToyAudio();
  let muted = loadMuted();
  audio.setMuted(muted);
  // Tray pictures: saved from an earlier visit to this build, or drawn now (and saved for next time). The industries'
  // wait for Game mode's models (`ensureGameModels`), so they're never drawn from stand-ins.
  const industryItems = INDUSTRY_GROUPS.flatMap((g) => g.items);
  const thumbnails = new Map(savedThumbnails ?? []);
  /** Draw the tray pictures not drawn yet among `items`; returns the keys drawn. */
  const drawThumbnails = (items: readonly TrayItem[], save = true, studio?: ThumbnailStudio): string[] => {
    const unseen = items.filter((item) => !thumbnails.has(trayKey(item)));
    if (unseen.length === 0) return [];
    const drawn = renderThumbnails(
      game.renderer,
      game.mats,
      unseen.flatMap((item): ThumbnailSubject[] =>
        item.kind === "piece"
          ? [{ key: trayKey(item), kind: "piece" as const, type: item.type }]
          : item.kind === "train"
            ? [{ key: trayKey(item), kind: "train" as const, cars: item.cars, looks: item.looks }]
            : [],
      ),
      (type) => (type === "signal" ? game.trackView.signalModel() : INDUSTRY_ROLE[type] ? game.depotView.model(INDUSTRY_ROLE[type]) : kitOf(type) ? game.kitView.model(type) : null),
      studio,
    );
    for (const [k, v] of drawn) thumbnails.set(k, v);
    if (save) void saveCached("thumbnails", __BUILD_ID__, thumbnails);
    return [...drawn.keys()];
  };
  // Only the title's pictures now; the tray's are drawn after the title's up (see drawTrayThumbnails), the tray
  // showing each piece's drawn icon till then.
  const isTitleArt = (item: TrayItem) => (item.kind === "piece" && item.type === TITLE_ART_PIECE) || (item.kind === "train" && trayKey(item) === `train:${TITLE_ART_TRAIN}`);
  drawThumbnails([...TRACK_ITEMS, ...TRAIN_ITEMS].filter(isTitleArt));

  // A tap that opens a card (or a tray shelf) under the finger mustn't also press what opened there.
  installClickShield(canvas);
  const hud = new Hud(
    document.body,
    {
      trayPointerDown: (item, e) => {
        if (trayAllowed(item)) interaction.startTrayDrag(item, e);
      },
      trayTap: (item, pointerType) => {
        // A click (a mouse or pen) on a piece carries it, for clicks on the map to put down (or puts it away, if it was
        // carried). Saying why if it can't come out: the toy box is asked again as each goes down.
        if (item.kind === "piece" && pointerType !== "touch") {
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
      trayTabChanged: () => interaction.arm(null),
      trayDraw: (on) => interaction.setDrawing(on),
      trackTab: (open) => game.showAllEnds(open),
      undo: () => {
        interaction.undo();
      },
      redo: () => {
        interaction.redo();
      },
      rerailAll: () => {
        let n = 0;
        for (const id of game.sim.trainIds()) if (game.sim.getTrain(id)?.derailed && game.rerail(id) !== -1) n++;
        hud.toast(n ? `Re-railed ${n} train${n > 1 ? "s" : ""}` : "Nothing to re-rail");
        scheduleSave();
      },
      togglePause: () => {
        game.paused = !game.paused;
        hud.setPaused(game.paused);
      },
      lever: (v) => interaction.setLever(v),
      follow: () => interaction.toggleFollow(),
      removeTrain: () => interaction.removeSelectedTrain(),
      turnCar: () => interaction.turnSelectedCar(),
      swapEnds: () => swapEnds(),
      decouple: () => decouple(),
      rotate: () => interaction.rotateSelected(),
      flip: () => interaction.flipSelected(),
      deletePiece: () => interaction.deleteSelected(),
      selectMore: () => interaction.selectMore(),
      selectJoined: () => interaction.selectJoined(),
      doneSelecting: () => interaction.doneSelecting(),
      newLayout: () => {
        saveLastBuilt(mode, null);
        setWorld(createWorld(Math.floor(Math.random() * 1_000_000)));
        game.frameLayout();
      },
      resetStarter: () => {
        saveLastBuilt(mode, null);
        setWorld(buildStarterWorld());
        game.frameLayout();
        openingView();
      },
      toggleExpand: () => setExpanding(!expanding),
      toggleMap: () => (mapView.open ? closeMap(true, true) : openMap()),
      toggleBoard: () => setBoardOpen(!board.open),
      buyLand: () => buyLand(),
      newGame: () => newGame(),
      openLines: () => openLines(),
      titleScreen: () => showTitle(),
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
          counts: { pieces: game.layout.pieceCount, trains: game.sim.trainIds().length, props: game.props.size },
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
    const items = [...TRACK_ITEMS, ...TRAIN_ITEMS].filter((item) => !thumbnails.has(trayKey(item)));
    if (items.length === 0) return;
    // A few at a time in one studio, each batch once its pieces are carved: each picture is read back from the
    // graphics card, which waits for what it's drawing, so pictures go in batches (one wait each). Preferably while
    // nothing's moving on screen, but not waiting long for that (a train going round would hold them up for good).
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
  // fetched as soon as it's asked for (all at once), and those ready are drawn as many a frame as fit in
  // PICTURE_BUDGET_MS, the open ticket's first: the first picture of a frame waits for the graphics card (it's read
  // back), the rest in that frame hardly at all. Nothing runs once none are waiting.
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
      if (drawn > 0 && performance.now() - start > PICTURE_BUDGET_MS) break;
      pictureJobs.delete(key);
      drawn++;
      studio ??= new ThumbnailStudio(game.renderer);
      const { item } = job;
      if (item.kind !== "prop") {
        for (const k of drawThumbnails([item], false, studio)) pictureDrawn(k);
        continue;
      }
      // (A prop whose asset doesn't exist has no picture: its blank stays.)
      if (!job.model) continue;
      const subject = new Group();
      for (const part of job.model.parts) subject.add(new Mesh(part.geometry, part.material));
      subject.rotation.y = -0.6;
      thumbnails.set(key, studio.shoot(subject));
      pictureDrawn(key);
    }
    if (drawn > 0) saveThumbnailsSoon();
    // More ready than fitted: the rest next frame. (Those still loading schedule a frame when they're in.)
    if (drawn < ready.length) schedulePictures();
  }

  interaction = new Interaction(game, hud, () => editor, () => onChange());
  game.keysTaken = () => interaction.piecesTakeKeys;
  interaction.onArmed = (item) => hud.setArmed(item ? trayKey(item) : null);
  interaction.onPlaced = (snapped) => {
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
  interaction.onRefused = () => {
    audio.refuse();
    hud.haptic("refuse");
  };
  interaction.onTurned = () => audio.rotate();
  interaction.onDepart = () => audio.bell();
  interaction.onSwitched = () => scheduleSave();
  interaction.onLeverThrown = () => audio.switchClunk(0.7, 0);
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
    const show = mode === "game" && type !== null && HALT_KITS.has(type);
    if (show === haltReach.showing) return;
    if (show) haltReach.show(game.landscape);
    else haltReach.hide();
    game.invalidate();
  };

  // ---- adding land -----------------------------------------------------------------------------------------

  /** Choosing a plot to add, and the one chosen. */
  let expanding = false;
  let chosen: PlotCoord | null = null;

  function setExpanding(on: boolean): void {
    expanding = on;
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
    hud.setLandCard("Tap a plot marked + to see what it brings.");
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

  /** What a plot would bring, in a few words. */
  function describeLand(land: Landscape): string {
    const parts: string[] = [];
    if (land.towns.length > 0) parts.push(land.towns.length > 1 ? `${land.towns.length} towns` : "a town");
    const forests = land.depots.filter((d) => d.kind === "forest").length;
    const mills = land.depots.filter((d) => d.kind === "sawmill").length;
    if (forests) parts.push(forests > 1 ? `${forests} forest yards` : "a forest yard");
    if (mills) parts.push("a sawmill");
    const g = land.grid;
    let river = false;
    let sea = false;
    let hills = 0;
    for (let i = 0; i < g.cellCount; i++) {
      if (g.surface[i] === SURF_RIVER) river = true;
      if (g.surface[i] === SURF_SEA) sea = true;
      if (g.height[i] > 0) hills++;
    }
    if (sea) parts.push("the coast");
    if (river) parts.push("a river");
    if (hills > g.cellCount * 0.25) parts.push("hills");
    if (parts.length === 0) return "Open countryside.";
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
    return list.charAt(0).toUpperCase() + list.slice(1) + ".";
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
    if (!expanding) return false;
    const forSale = plotsForSale(game.landscape);
    const p = badgeAt(x, y, forSale) ?? { px: Math.floor(ground.x / PLOT_WIDTH), pz: Math.floor(ground.z / PLOT_DEPTH) };
    if (!forSale.some((q) => q.px === p.px && q.pz === p.pz)) {
      chosen = null;
      game.landscapeView.showForSale(forSale);
      hud.setLandCard(game.landscape.grid.hasPlot(p.px, p.pz) ? "That's your land already. Tap a plot marked +." : "Only plots beside your land can be added.");
      game.invalidate();
      return true;
    }
    chosen = p;
    game.landscapeView.showForSale(forSale, chosen);
    const price = plotPrice(game.landscape.grid.plots.length);
    const priced = mode === "game" ? ` · ${price} coins (you have ${progress.coins})` : "";
    hud.setLandCard(describeLand(landForSale(game.landscape, p.px, p.pz)) + priced, mode !== "game" || progress.coins >= price);
    game.invalidate();
    return true;
  };

  function buyLand(): void {
    if (!chosen) return;
    // Game mode: land costs coins.
    const price = plotPrice(game.landscape.grid.plots.length);
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
    hud.setLandCard("Tap a plot marked + to see what it brings.");
    updateConnections(false);
    scheduleSave();
  }

  function setWorld(world: GameWorld): void {
    setExpanding(false);
    game.setWorld(world);
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
        const hasTimber = game.sim.trainIds().some((id) => game.sim.getTrain(id)?.cars.some((c) => c.kind === "timber"));
        if (!hasTimber) hud.toast("Try a flatbed train: forest logs → sawmill → planks for the towns", false, 6000);
      }, 3500);
    }
    game.flourishes.add(game.landscapeView.flash(fresh.flat()));
  }

  function onChange(): void {
    game.trackChanged();
    industriesChanged();
    updateConnections(true);
    checkGoals(true);
    hud.setHistory(editor.canUndo, editor.canRedo);
    scheduleSave();
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(save, 600);
  }

  /** Save the railway under its mode (not while the title screen shows it turning behind: nothing is being played). */
  function save(): void {
    if (!playing) return;
    saveToStorage(game.world, mode);
    saveSession(mode, { clock: game.simSeconds, paused: game.paused, journal: journal.toJSON() });
    if (mode === "game") saveProgress(progress.toJSON());
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
    // A loaded clock is another session's time, not study done here.
    studyClock.at = null;
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

  // Save train positions periodically and when the page is hidden.
  setInterval(save, 5000);
  // Hidden, or leaving the page (closed, reloaded: some browsers report only one of the two, Chrome both): saved
  // once on the way out, and again only after the page has been back in view.
  let savedOnLeaving = false;
  const saveOnLeaving = () => {
    if (savedOnLeaving) return;
    savedOnLeaving = true;
    save();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveOnLeaving();
    else savedOnLeaving = false;
  });
  addEventListener("pagehide", saveOnLeaving);
  addEventListener("pageshow", () => (savedOnLeaving = false));

  const title = new TitleScreen(document.body, { play }, { thumbnails });

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
  }

  // Game mode's goals: checked about once a second and after every change to the track.
  let goals = new GoalTracker(loadGoals());
  // The Journal: what happened (events: quiet, with an unread bell) and what was achieved (milestones: also toasted).
  // Refusals aren't logged: they stay plain `hud.toast`s.
  // On game time: "2 min ago" means two minutes of play (it stands still while paused).
  const journal = new Journal(() => game.simSeconds * 1000);
  const goalsPanel = new GoalsPanel(
    hud.root,
    {
      newGame: () => newGame(),
      showMe: () => showGoal(),
      fly: (place) => {
        // Several spots (new houses, two stations) are framed together, closer than a lone spot.
        const spots = place.points ?? [place];
        const f = frameAlong(spots, game.camera.fov, game.camera.aspect, place.points ? PLACE_MARGIN : GOAL_MARGIN);
        const pts = spots.map((q) => new Vector3(q.x, 0, q.z));
        frameInRoom(pts, Math.min(f.distance, game.controls.maxDistance), game.controls.maxDistance, pts.length);
      },
    },
    journal,
  );
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

  // Game mode's towns: they want things, and grow when they get them.
  const townLife = new TownLife(game, {
    knows: (tech) => progress.learned.has(tech),
    // A school takes only what the research still lacks (a lookup: the crane asks for every unit).
    school: (kind) => researchLacking(progress, kind) > 0,
    received: (town, kind, n, before) => {
      payDelivery(progress, kind, n, before, town);
      hud.setCoins(progress.coins);
      // Logged quietly, one entry per town and kind for a burst of deliveries.
      note({ kind: "event", key: `deliver:${town.id}:${kind}`, qty: n, text: "", format: (q) => `Delivered ${describeGoods({ [kind]: q })} to ${town.name}`, place: { x: town.station.x, z: town.station.z } });
    },
    grew: (town, status, built) => {
      const here = { x: town.station.x, z: town.station.z };
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
      if (gift.length > 0 || offer) {
        refreshBoard();
        scheduleSave();
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
  let ticksEntry: JournalEntry | null = null;
  function checkGoals(announce: boolean): void {
    if (mode !== "game" || !playing) return;
    const ctx = { learned: progress.learned, owned: progress.owned, orders: progress.orders };
    const fresh = goals.update(game.world, ctx);
    if (fresh.length > 0) {
      // (A goal done: its guide's markers no longer hold a piece, and the tray rings what the next one asks for.)
      interaction.guideSpots = [];
      hud.refreshTrayBadges();
      saveGoals(goals.ids());
      if (announce) {
        const titles = fresh.map((g) => g.title);
        const tick = goalsDoneText(titles, TOAST_TITLES);
        if (growth && joins(growth, game.simSeconds, performance.now(), GROWTH_JOIN_S)) {
          // Right after a growth milestone: part of the same entry, and a toast of its own after the growth's.
          journal.amend(growth.entry, `${growth.entry.text} · ${tick}`);
          goalsPanel.newsChanged();
          hud.toast(tick, true, 3200);
        } else {
          // Goals ticked together (one a check, a moment apart): one line in the News and one toast.
          const say = ticks.tick(titles, game.simSeconds, performance.now(), (t) => hud.hasToast(t));
          if (say.kind === "merge" && ticksEntry) {
            journal.amend(ticksEntry, say.news);
            goalsPanel.newsChanged();
            hud.retoast(say.oldToast, say.toast, true, 3200);
          } else {
            const where = fresh[0].guide(game.world).points[0];
            ticksEntry = note({ kind: "milestone", text: say.news, place: where && { x: where.x, z: where.z } }, 3200, true);
            if (ticksEntry) hud.toast(say.toast, true, 3200);
            else ticks.drop();
          }
        }
        audio.chime();
        goalsPanel.celebrate();
      }
    }
    const current = goals.current();
    goalsPanel.show(goals.doneCount, current, current ? current.check(game.world, ctx) : null, goals.next(), goals.total, goals.lockedHint(), goals.lockedCount);
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
  // After the last of something in the toy box goes down, no next one waits at its end.
  interaction.trayHas = (item) => mode !== "game" || item.kind !== "piece" || progress.hasAnother(game.world, item);
  function trayAllowed(item: ThingItem | { kind: string }, make = true): boolean {
    if (mode !== "game" || (item.kind !== "piece" && item.kind !== "train" && item.kind !== "prop")) return true;
    // (A new take: whatever an earlier one made is settled, or never was.)
    if (make) trainMade = pieceMade = null;
    const look = lockedLook(item);
    if (look) {
      const t = techOf(look)!;
      hud.toast(t.plan ? `${t.label}: coming soon` : `${t.label}: learn its blueprint first${t.requires.length ? ` (${t.requires.map(describeNeed).join(", ")})` : ""}`, false, 3600);
      return false;
    }
    const needs = thingsFor(item as ThingItem);
    for (const id of needs.keys()) {
      if (progress.knows(id)) continue;
      hud.toast(`${ruleOf(id)!.label}: not learned yet`);
      return false;
    }
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
  /** ...and what's said if it's given back ("Switch back in the box, 3🪵 returned"). */
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

  /** The toy box on the tray (Game mode): how many of each are left. */
  function trayBadge(item: ThingItem | { kind: string }): { text: string; empty: boolean; attention?: boolean; craft?: boolean; locked?: boolean } | null {
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
    const m = game.propLibrary.model(asset);
    if (m === undefined)
      void game.propLibrary.load(asset).then(
        () => {
          game.depotView.setWorld(game.economy, game.layout);
          game.invalidate();
        },
        () => {},
      );
    return m && { parts: m.parts, scale };
  }

  /** Industries placed or moved: give new ones their depots, and redraw the yards where they stand. */
  let industryKey = "";
  function industriesChanged(): void {
    const added = syncIndustries(game.world, mode === "game");
    let key = "";
    for (const id of game.layout.pieceIds()) {
      const p = game.layout.getPiece(id)!;
      if (INDUSTRY_ROLE[p.type]) key += `${id}:${p.pose.x},${p.pose.z},${p.pose.heading};`;
    }
    // Upgrades put a machine in their yards (Game mode): the yards are drawn again when one is learned.
    key += `#${mode === "game" ? upgradeKey(progress) : ""}`;
    // Schools wear what they've grown into (a college, a library wing): drawn again only when that changes.
    key += `#${mode === "game" ? schoolGradesKey(game.world, progress.learned) : ""}`;
    game.depotView.extras = mode === "game" ? (role) => machinesFor(progress, role) : null;
    game.depotView.building = schoolHouse;
    if (added || key !== industryKey) game.depotView.setWorld(game.economy, game.layout);
    industryKey = key;
    // Industries work as fast as what's around them allows: recounted when they move or the land changes.
    const rateKey = `${key}#${game.landscape.grid.revision}#${mode === "game" ? upgradeKey(progress) : ""}`;
    if (rateKey !== rateKeyShown) {
      rateKeyShown = rateKey;
      if (updateRates(game.world, mode === "game" ? (role) => boostOf(progress, role) : undefined)) game.invalidate();
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
  });
  // The Research picker: the whole tree, each blueprint researched at a school.
  const board = new BlueprintBoard(document.body, {
    pick: (id) => picked(id),
    close: () => setBoardOpen(false),
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
  });

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

  function learned(id: string): void {
    const makes = unlocksOf(id).map((t) => ruleOf(t)!.label);
    const t = techOf(id)!;
    // Signals bring a second engine (into the toy box): a passing loop with signals lets two trains share the line.
    const gift = learnGift(progress, id);
    const present = gift.length > 0 ? ` · Present: ${describeThings(gift)}` : "";
    // A goal it opens is named ("Run two trains at once" opened unseen behind the current goal), with where the
    // second engine is, or that one's to be made.
    const opened = goals.openedBy(id, progress.learned);
    const tip = opened.some((g) => g.id === "two-trains") ? secondEngineTip(progress.available(game.world, "car:engine"), progress.owned.get("car:engine") ?? 0) : "";
    const goalLine = opened.length > 0 ? ` · New goal: ${opened.map((g) => g.title).join(", ")}${tip ? `. ${tip}` : ""}` : "";
    note({ kind: "milestone", text: (makes.length > 0 ? `Learned ${t.label.toLowerCase()}! ${makesLine(makes)}` : `Learned ${t.label}! ${t.blurb}`) + present + goalLine }, opened.length > 0 ? 5200 : 3800);
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
    save();
  }

  /** The school research goods go to: one beside a town, by name ("Larkfield school"), or null if none is placed. */
  function schoolName(): string | null {
    const d = game.economy.allDepots().find((x) => x.role === "school");
    return d ? depotName(game.world, d) : null;
  }
  /** Is a school placed (a lookup over the depots, which are kept in a list till the track changes)? */
  function hasSchool(): boolean {
    return game.economy.allDepots().some((x) => x.role === "school");
  }

  /**
   * A research picked in the picker (its one button): it starts, or waits in Next up, or (the one up next) swaps with
   * the one under way. The card and the pill show it; no toast.
   */
  function picked(id: string): void {
    if (!hasSchool() || !pickResearch(progress, id)) return;
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
    learned(id);
    const next = progress.research.current;
    if (next) hud.toast(`Learned ${techOf(id)!.label}! Next: ${techOf(next)!.label}`, true, 3800);
  }

  /** The school's card: the research's goods (got of needed), and what it's at. Its key changes with the research. */
  interaction.schoolCard = { key: () => schoolCardKey(progress), show: () => schoolCard(progress) };

  /** Open or close the Research picker; `on`: open on that card ("Show me" for a goal's research). */
  function setBoardOpen(open: boolean, on?: string): void {
    if (open && mapView.open) closeMap(false);
    board.setOpen(open);
    if (open && on) board.focus(on);
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

  const PLAN_WORDS: Record<Plan, string> = { next: "Coming soon: next on the list", soon: "Coming soon", later: "Coming one day", ending: "The ending: coming one day" };

  function refreshBoard(): void {
    hud.setBoardButton(board.open);
    if (!board.open) return;
    boardKeyShown = boardKey();
    const school = schoolName();
    // The goal's research: the picker opens on it while nothing is under way, its button ringed (never picked for you).
    const goalTech = goals.current()?.blueprint;
    const seen = seenOf(progress);
    const stations: Station[] = TECHS.map((t) => {
      const makes = makesOf(t);
      const requires = t.requires.map((n) => ({ text: describeNeed(n) + (n.kind === "count" && n.stat === "riders" ? ` (${progress.riders} so far)` : ""), met: needMet(progress, n) }));
      // Its price is its research: goods brought to a school, and from tier 2 coins.
      const cost = t.research;
      const base = { id: t.id, label: t.label, blurb: t.blurb, branch: t.branch, makes, needs: [...t.needs], seen: seen.get(t.id)!, price: costTag(cost.goods as Bag, cost.coins) || "free", requires };
      const state = cardState(progress, t.id);
      if (state === "learned") return { ...base, state };
      if (state === "soon") return { ...base, state, waits: PLAN_WORDS[t.plan!] };
      const research = researchCard(progress, t.id, school);
      if (research) return { ...base, state, research, ...(t.id === goalTech && state !== "researching" ? { goal: true } : {}) };
      const missing = t.needs.filter((n) => !progress.learned.has(n));
      const unmet = t.requires.filter((n) => !needMet(progress, n));
      const waits =
        missing.length > 0
          ? `Research ${missing.map((n) => techOf(n)!.label.toLowerCase()).join(" and ")} first`
          : unmet.length > 0
            ? `Needs ${unmet.map(describeNeed).join(" and ")}`
            : "Later";
      return { ...base, state: "locked" as const, waits };
    });
    const focus = goalPick(progress, goalTech, school !== null);
    board.show({
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

  // The workshop's clock: a few times a second, not every frame (it runs while nothing on screen moves).
  const CRAFT_STEP = 0.25;
  /** The research's study clock, on the world's game time (see `simElapsed`). */
  const studyClock: StudyClock = { at: null };
  /**
   * What the map gives research, from the map: the towns' landmarks, a school beside a city (tier 3), and how fast the
   * schools study (a college: twice as fast). Asked when industries, towns or what's learned change, not per frame.
   */
  function syncLandmarks(): void {
    progress.landmarks.clear();
    for (const id of landmarksAt(game.world)) progress.landmarks.add(id);
    setSpeed(progress, researchSpeed(game.world, progress.learned));
  }
  setInterval(() => {
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
        scheduleSave();
      }
    }
    if (mode !== "game" || !playing || game.paused || progress.orders.length === 0) return;
    const wasMaking = progress.making;
    const coinsBefore = progress.coins;
    const made = crafting.tick(game.world, CRAFT_STEP);
    if (progress.coins !== coinsBefore) hud.setCoins(progress.coins);
    showWorkshop();
    // Planks leave the yard when an order starts: draw the pile going down (only then, not on every step).
    if (made || progress.making !== wasMaking) game.invalidate();
    if (!made) return;
    hud.toast(`+1 ${thingLabel(made)} in your toy box`, true, 2400);
    audio.chime();
    hud.refreshTrayBadges();
    scheduleSave();
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
    line.textContent = `Field squares nearby: ${r.count} (works at ${speed}% speed; full speed at ${r.need})`;
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
  function passengersOn(): void {
    peopleClock.clear();
    harbourTrade.reset();
    counters.reset(game.economy);
    applyCranes(game.economy, progress);
    attachEngines(game.world);
    // Goods brought to a school go into the research (saved soon after: a train brings them in a burst).
    attachResearch(game.economy, () => progress, () => {
      refreshPill();
      scheduleSave();
    });
    attachPassengers(game.world, () => progress, () => {
      hud.setCoins(progress.coins);
      scheduleSave();
    });
  }
  /** Planks kept for the workshop: it holds fewer than its waiting tray order needs (`orderPlanks`; worked out once a second). */
  let planksKept = false;
  const keepPlanks = (kind: string) => kind === "planks" && planksKept;
  function updatePlanksKept(): void {
    game.economy.reserved = mode === "game" ? keepPlanks : null;
    if (mode !== "game" || workshops(game.world).length === 0) {
      planksKept = false;
      return;
    }
    planksKept = keepsForOrder(progress, workshopStock(game.world).planks ?? 0);
  }

  setInterval(() => {
    updatePlanksKept();
    if (mode !== "game" || !playing || game.paused) return;
    for (const e of harbourTrade.update(game.world, progress)) {
      if (e.kind === "arrive") game.boats.arrive(e.depotId, e.way, BOAT_SAIL);
      else if (e.kind === "leave") game.boats.leave(e.depotId, e.way, BOAT_SAIL);
      else if (e.kind === "gone") game.boats.remove(e.depotId);
      else if (e.kind === "bought") {
        hud.setCoins(progress.coins);
        const why = e.short === "room" ? "the quay was full" : "too few coins";
        const got = `A boat brought ${describeGoods(e.goods)}: −${e.coins} coins`;
        // An order that all went back is a refusal (a plain toast); a delivery is logged quietly.
        if (total(e.goods) === 0) hud.toast(`Your order went back: ${why}`, false, 3200);
        else note({ kind: "event", key: `bought:${e.depotId}`, qty: e.coins, text: "", place: depotPlace(e.depotId), format: (c, n) => (n > 1 ? `Boats brought goods: −${c} coins` : e.short ? `${got} (the rest went back: ${why})` : got) });
        scheduleSave();
      } else if (e.kind === "sold") {
        hud.setCoins(progress.coins);
        note({ kind: "event", key: `sold:${e.depotId}`, qty: e.coins, text: "", place: depotPlace(e.depotId), format: (c, n) => (n > 1 ? `Boats took goods: +${c} coins` : `A boat took ${describeGoods(e.goods)}: +${c} coins`) });
        scheduleSave();
      }
    }
    // What's been done (logs cut, loads moved, goods delivered) toward the blueprints that ask for it.
    // (The picker shows the counts only as requirements met, or riders: the workshop's clock sees those in its key.)
    counters.collect(game.economy, progress);
    // A train set going that's too heavy for its engines says so, once.
    for (const id of game.sim.trainIds()) {
      const t = game.sim.getTrain(id)!;
      const why = t.cars.some((c) => c.kind === "engine" && c.lever !== 0) ? tooHeavy(game.world, t) : null;
      if (why && !warnedHeavy.has(id)) hud.toast(why, false, 4200);
      if (why) warnedHeavy.add(id);
      else warnedHeavy.delete(id);
    }
    peopleArrive(game.world, progress, 1, peopleClock);
    // (Nothing else may be drawing: new arrivals redraw their platform themselves.)
    showWaiting();
  }, 1000);

  /** The peg dolls on each platform are the people waiting (Game mode, once coaches are known; else the usual few). */
  function showWaiting(): void {
    const live = mode === "game" && progress.learned.has("passengers");
    // (At its station: a halt's people aren't drawn.)
    for (const d of game.economy.allDepots()) if (d.role === "town" && game.world.stations.get(d.townId) === d.pieceId) game.setWaiting(d.townId, live ? d.waiting : null);
  }

  // A town station's card (Game mode): who is waiting for a coach.
  let stationShown = "";
  function showStation(): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const d = id === -1 ? undefined : game.economy.depot(id);
    if (!d || d.role !== "town" || !progress.learned.has("passengers")) {
      stationShown = "";
      return;
    }
    const key = `${id}:${d.waiting}:${progress.riders}`;
    if (key === stationShown) return;
    stationShown = key;
    const box = hud.depotExtra;
    box.hidden = false;
    box.innerHTML = "";
    const line = document.createElement("div");
    line.className = "station-waiting";
    line.textContent = `Waiting for a coach: ${d.waiting} ${d.waiting === 1 ? "person" : "people"} (room for ${waitingCap(progress)}). Carried so far: ${progress.riders}`;
    box.append(line);
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
    const text = harbourTrade.describe(id);
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

  let workshopShown = -1;
  /** Keep the workshop's card current while it's open (Game mode). */
  function showWorkshop(force = false): void {
    const id = mode === "game" ? interaction.openDepotId : -1;
    const open = id !== -1 && game.economy.depot(id)?.role === "workshop";
    if (!open) {
      if (workshopShown !== -1) workshopPanel.hide();
      workshopShown = -1;
      return;
    }
    if (workshopShown !== id || force) workshopPanel.hide();
    workshopShown = id;
    const rows: MakeRow[] = [];
    const SHELVES = ["Track", "Trains", "Industries", "Railway"];
    for (const tid of Object.keys(THING_RULES) as ThingId[]) {
      if (!progress.knows(tid) || isFree(tid)) continue;
      const rule = ruleOf(tid)!;
      rows.push({
        id: tid,
        label: rule.label,
        cost: costText(rule),
        have: progress.available(game.world, tid),
        queued: progress.orders.filter((o) => o === tid).length,
        shelf: tid.startsWith("car:") ? "Trains" : tid.includes("depot-") ? "Industries" : RAILWAY_THINGS.has(tid) ? "Railway" : "Track",
        // A second engine before Signals: said, not barred (on a line of its own it runs fine).
        note: makeNote(progress, tid),
      });
    }
    rows.sort((a, b) => SHELVES.indexOf(a.shelf) - SHELVES.indexOf(b.shelf));
    const now = crafting.now;
    // What it's waiting for: goods in the workshop's yard, and coins.
    const nowRule = now ? ruleOf(now.id)! : null;
    const shortGoods = nowRule ? minus(nowRule.cost, workshopStock(game.world)) : {};
    const shortCoins = nowRule ? Math.max(0, (nowRule.coins ?? 0) - progress.coins) : 0;
    const need = now?.waiting ? [total(shortGoods) > 0 ? costTag(shortGoods) : "", shortCoins > 0 ? costTag({}, shortCoins) : ""].filter(Boolean).join(" ") || null : null;
    workshopPanel.show(now ? { label: thingLabel(now.id), fill: now.fill, waiting: need } : null, rows);
  }

  // The open engine's line (both modes; Game mode once Train routes is learned): a colour and a name, its stops in
  // order (the one it's heading for marked), and, a stop tapped, what to do with it. Planning, a tap on a station or
  // depot on the map adds it (see `interaction.onPickPlace`). The economy works out what's loaded and dropped where
  // ("auto"); Drop and Pick up are kept as overrides.
  let routeShown = "";
  /** Planning the open engine's line: taps on places add them as stops. */
  let planning = false;
  /** The engine whose card's Leave was tapped once (asking before the line it's the last on goes), or −1. */
  let leaveAsked = -1;
  /** How long (ms) "Forget …?" waits for its second tap. */
  const LEAVE_ASK_MS = 4000;
  /** The stop whose chip was tapped (its actions shown), or −1. */
  let stopPicked = -1;
  /** "Tap a stop for options" is shown until a stop's chip is first tapped (remembered). */
  const STOP_HINT_KEY = "woodrail.hint.stopOptions";
  let stopHintSeen = loadFlag(STOP_HINT_KEY);
  const INTENTS: Record<StopAction, { label: string; tip: string }> = {
    auto: { label: "Automatic", tip: "Drops what this stop takes, and picks up what a later stop wants" },
    both: { label: "Automatic", tip: "Drops what this stop takes, and picks up what a later stop wants" },
    drop: { label: "Only drop", tip: "Only drops goods off here" },
    pick: { label: "Only pick up", tip: "Only picks goods up here" },
  };
  const NEXT_INTENT: Record<StopAction, StopAction> = { auto: "drop", both: "drop", drop: "pick", pick: "auto" };
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
  function showEngineView(): void {
    const carId = interaction.openEngineCarId;
    if (carId === -1) {
      viewCar = -1;
      return;
    }
    const found = game.sim.findCar(carId);
    if (!found) return;
    const lever = found.train.cars[found.index].lever;
    // The train changed its lever by itself (sent back from the end of the line): the card follows.
    if (lever !== hud.engineLeverShown) hud.updateEngineCard(lever, game.following === carId);
    // Held at its stop for spacing: one tap ("Go now") sends it on.
    hud.setGoNow(lever !== 0 && game.economy.spacingWait(carId) !== null);
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
    const latest = engineStatus(game.sim, game.economy, carId, nameOf, whyCantMove());
    if (latest !== viewStatus.next) {
      viewStatus.next = latest;
      viewStatus.since = now;
    }
    // ("Starting" shows at once: it answers the Go just pressed.)
    if (opened || latest === "Starting" || now - viewStatus.since >= STATUS_HOLD_MS) viewStatus.shown = latest;
    const status = viewStatus.shown;
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

  function showRoute(): void {
    const carId = interaction.openEngineCarId;
    const allowed = mode === "sandbox" || progress.learned.has("routes");
    if (carId === -1 || !allowed) {
      if (routeShown !== "") hud.engineExtra.hidden = true;
      routeShown = "";
      setPlanning(false);
      return;
    }
    const stops = routeStops(game.world);
    const line = lineOf(game.economy, carId);
    const r = game.economy.routeOf(carId);
    const riders = line ? trainsOn(game.economy, line.id).length : 0;
    const others = line ? "" : [...game.economy.lines.values()].map((l) => `${l.id}${l.colour}${l.name}`).join(",");
    const key = `${carId}:${leaveAsked}:${game.trackVersion}:${game.layout.switchesVersion}:${stops.length}:${planning}:${stopPicked}:${stopHintSeen}:${cantReachText}:${riders}:${others}:${line ? `${line.id}|${line.colour}|${line.name}|${r?.next}|${line.stops.map((st) => `${st.depotId}${st.action}${st.waitFill ? "w" : ""}`).join(",")}` : "-"}`;
    if (key === routeShown) return;
    routeShown = key;
    const box = hud.engineExtra;
    box.innerHTML = "";
    box.hidden = stops.length === 0;
    box.classList.add("route");
    const nameOf = (id: number) => stops.find((st) => st.depotId === id)?.name ?? "?";
    const edit = (change: (l: RouteStopDef[]) => void) => {
      editLine(game.economy, carId, change);
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
      label.append(swatch, Object.assign(document.createElement("span"), { className: "route-line-text", textContent: line.name }));
      // Its trains, where it has more than this one; the name opens the Lines view (to rename it, recolour it).
      if (riders > 1) label.append(Object.assign(document.createElement("span"), { className: "route-riders", textContent: `· ${riders} trains` }));
      label.classList.add("route-line-name");
      label.title = "Lines: rename it, change its colour";
      label.addEventListener("click", () => openLines());
    } else label.textContent = "Route";
    head.append(label);
    if (!line && !planning) {
      const any = document.createElement("span");
      any.className = "route-none";
      any.textContent = "Goes anywhere, works at every stop";
      head.append(any);
    }
    head.append(
      planning
        ? button("Done", "route-plan on", "Finish planning the route", () => setPlanning(false))
        : button(line ? "Edit" : "Plan a route", "route-plan", "Tap stations and depots to add them as stops, in order", () => setPlanning(true)),
    );
    // On a line, this train can leave it (it goes anywhere again; the line stays for its other trains). The last train
    // leaving a line the player has named asks first (the line goes with it): a second tap.
    if (line && !planning) {
      const named = !LINE_COLOURS.some((c) => `${c.name} line` === line.name);
      const asks = riders === 1 && named;
      const leave = button(leaveAsked === carId ? `Forget “${line.name}”?` : "Leave", "route-leave", riders > 1 ? "Take this train off its line (its other trains keep running it)" : "Take this train off its line: it goes anywhere again", () => {
        if (asks && leaveAsked !== carId) {
          leaveAsked = carId;
          routeShown = "";
          showRoute();
          window.setTimeout(() => {
            if (leaveAsked !== carId) return;
            leaveAsked = -1;
            routeShown = "";
          }, LEAVE_ASK_MS);
          return;
        }
        leaveAsked = -1;
        stopLine(game.economy, carId);
        showRoute();
        routeChanged();
        scheduleSave();
      });
      leave.classList.toggle("asking", leaveAsked === carId);
      head.append(leave);
    }
    box.append(head);
    // On no line, with lines on the map: run one of them (a tap), as well as planning its own.
    if (!line && !planning && game.economy.lines.size > 0) {
      const join = document.createElement("div");
      join.className = "route-join";
      join.append(Object.assign(document.createElement("span"), { className: "route-hint", textContent: "Or run a line:" }));
      // (A line no track leads to from this train, to any of its stops, is greyed: it couldn't run it.)
      const front = trainFront(carId);
      let greyed = false;
      for (const l of game.economy.lines.values()) {
        const b = button(l.name, "route-join-line", `Run this train on ${l.name}`, () => {
          joinLine(game.economy, carId, l.id);
          showRoute();
          routeChanged();
          scheduleSave();
        });
        b.style.setProperty("--line", l.colour);
        const reaches = !front || l.stops.some((st) => {
          const piece = game.economy.depot(st.depotId)?.pieceId;
          return piece !== undefined && legFromCursor(game.layout, front, piece) !== null;
        });
        if (!reaches) {
          b.disabled = true;
          b.title = `No track leads from this train to ${l.name}`;
          greyed = true;
        }
        join.append(b);
      }
      box.append(join);
      if (greyed) {
        const hint = document.createElement("div");
        hint.className = "route-hint";
        hint.textContent = "Greyed: no track leads from this train to that line";
        box.append(hint);
      }
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
      hint.textContent = "Tap stations and depots, in order";
      box.append(hint);
    }
    if (line) {
      const strip = document.createElement("div");
      strip.className = "route-stops";
      line.stops.forEach((st, k) => {
        const chip = button(`${r?.next === k ? "▶" : k + 1} ${nameOf(st.depotId)}`, "route-chip", "Tap for this stop's options", () => {
          stopPicked = stopPicked === k ? -1 : k;
          if (!stopHintSeen) {
            stopHintSeen = true;
            saveFlag(STOP_HINT_KEY);
          }
          showRoute();
        });
        chip.classList.toggle("next", r?.next === k);
        chip.classList.toggle("picked", stopPicked === k);
        if (st.action === "drop" || st.action === "pick") chip.dataset.intent = st.action;
        if (st.waitFill) chip.dataset.wait = "1";
        chip.style.setProperty("--line", line.colour);
        strip.append(chip);
      });
      box.append(strip);
      // Stops beyond the edge (scrolled sideways): the edge fades, as the tray's does.
      const edges = () => {
        strip.classList.toggle("more-right", strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 2);
        strip.classList.toggle("more-left", strip.scrollLeft > 2);
      };
      strip.addEventListener("scroll", edges, { passive: true });
      requestAnimationFrame(() => {
        // The picked stop (else, planning, the last, just added; else the one it's heading for) scrolled into view.
        const chip = (strip.querySelector<HTMLElement>(".route-chip.picked") ?? (planning ? strip.lastElementChild : strip.querySelector(".route-chip.next"))) as HTMLElement | null;
        // Wholly in view, clear of the edges' fades (the strip's last chip scrolls fully to its end).
        if (chip) {
          const fade = 44;
          const right = chip.offsetLeft + chip.offsetWidth;
          if (right > strip.scrollLeft + strip.clientWidth - fade) strip.scrollLeft = Math.min(strip.scrollWidth - strip.clientWidth, right - strip.clientWidth + fade);
          else if (chip.offsetLeft < strip.scrollLeft + fade) strip.scrollLeft = Math.max(0, chip.offsetLeft - fade);
        }
        edges();
      });
      // The first time, a word on what a chip does (till one is tapped).
      if (!stopHintSeen && stopPicked === -1) {
        const hint = document.createElement("div");
        hint.className = "route-hint";
        hint.textContent = "Tap a stop for options";
        box.append(hint);
      }
      const k = stopPicked;
      if (k >= 0 && k < line.stops.length) {
        const st = line.stops[k];
        const tools = document.createElement("div");
        tools.className = "route-tools";
        tools.append(
          // (A lone stop can't move; the first can't go earlier, nor the last later.)
          ...(line.stops.length > 1
            ? [
                button("◀", "route-move", "Visit this stop earlier", () => edit((l) => (moveStop(l, k, k - 1), (stopPicked = Math.max(0, k - 1))))),
                button("▶", "route-move", "Visit this stop later", () => edit((l) => (moveStop(l, k, k + 1), (stopPicked = Math.min(l.length - 1, k + 1))))),
              ]
            : []),
          button(INTENTS[st.action].label, "route-action", INTENTS[st.action].tip, () => edit((l) => (l[k].action = NEXT_INTENT[l[k].action]))),
          // (Waiting to fill means nothing where it only drops.)
          ...(st.action === "drop"
            ? []
            : [
                button(st.waitFill ? "Wait: on" : "Wait: off", `route-wait${st.waitFill ? " on" : ""}`, "Wait here till the wagons are full (of goods a later stop wants)", () =>
                  edit((l) => (l[k].waitFill = !l[k].waitFill)),
                ),
              ]),
          button("✕", "route-remove", "Take this stop off the route", () => edit((l) => (l.splice(k, 1), (stopPicked = -1)))),
        );
        // (Nor where it would put the same place twice in a row: that's one visit.)
        const twiceAfter = (to: number) => {
          const ids = line.stops.map((x) => x.depotId);
          ids.splice(to, 0, ids.splice(k, 1)[0]);
          return ids.some((id, i) => i > 0 && ids[i - 1] === id);
        };
        const moves = tools.querySelectorAll<HTMLButtonElement>(".route-move");
        if (moves.length === 2) {
          moves[0].disabled = k === 0 || twiceAfter(k - 1);
          moves[1].disabled = k === line.stops.length - 1 || twiceAfter(k + 1);
          // Neither way: no arrows at all.
          if (moves[0].disabled && moves[1].disabled) for (const m of moves) m.remove();
        }
        box.append(tools);
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

  /** Plan the open engine's line by tapping places (on), or stop (off). */
  function setPlanning(on: boolean, frame = true): void {
    if (planning === on) return;
    planning = on;
    stopPicked = -1;
    // (A piece carried, or waiting at an end, is put away: a click on the map picks a stop now.)
    if (on) interaction.arm(null);
    // Planning, the map wants the room: the card slims to its route (Done and the stops), the tray goes, and the view
    // frames the train and its line's places above the card (not when it goes on after the map: see `openMap`).
    hud.setPlanning(on);
    if (on && frame) requestAnimationFrame(framePlanning);
    // A stop's disc tapped: that place again (A → B → A); a stop is taken off with its ✕ in the card.
    interaction.onTapStopDisc = on
      ? (index) => {
          const carId = interaction.openEngineCarId;
          const stops = lineOf(game.economy, carId)?.stops;
          const depotId = stops?.[index]?.depotId;
          if (depotId === undefined) return;
          // (The last stop's own place again would be the same visit: its chip is picked instead.)
          if (stops!.at(-1)?.depotId === depotId) {
            stopPicked = stops!.length - 1;
            showRoute();
          } else interaction.onPickPlace?.(depotId);
        }
      : null;
    interaction.onLeavePlanning = on ? () => setPlanning(false) : null;
    interaction.onPickPlace = on
      ? (depotId) => {
          const carId = interaction.openEngineCarId;
          if (carId === -1) return false;
          editLine(game.economy, carId, (l) => {
            // The same place twice in a row is one visit: not added again.
            if (l.at(-1)?.depotId !== depotId) l.push({ depotId, action: "auto" });
          });
          showRoute();
          routeChanged();
          scheduleSave();
          // Its disc stays in view (the bar may have grown under it).
          const spot = pieceSpot(game.economy.depot(depotId)?.pieceId ?? -1);
          if (spot) requestAnimationFrame(() => keepInView([spot.clone().setY(spot.y + 70)]));
          return true;
        }
      : null;
    showRoute();
  }

  /**
   * The room the map has on screen (canvas pixels): below the top bar (and the goals), above the tray or a card, or
   * beside a card docked at the right (see `viewRoom`); the whole view where too little is left. One measure for every
   * framing (the director's too: `roomOf`).
   */
  function measureRoom(): (ViewRoom & { width: number; height: number }) | null {
    const r = game.canvas.getBoundingClientRect();
    const rel = (e: Element) => {
      const b = e.getBoundingClientRect();
      return { left: b.left - r.left, top: b.top - r.top, right: b.right - r.left, bottom: b.bottom - r.top };
    };
    const room = viewRoom(r.width, r.height, [...document.querySelectorAll(".hud .brand, .hud .actions, .hud .goals")].map(rel), [...document.querySelectorAll(".hud .tray, .hud .tray-draw, .hud .tray-orient, .hud .card")].map(rel));
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

  /** Keep these points in view: if any is off screen or under the card, glide just enough to show them all. */
  function keepInView(points: Vector3[]): void {
    if (points.length === 0 || inRoom(points)) return;
    const d = game.camera.position.distanceTo(game.controls.target);
    frameInRoom([...points, game.controls.target.clone()], Math.min(d, 900));
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
  function showRibbon(): void {
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
    const key = `${carId}|${game.trackVersion}|${game.layout.switchesVersion}|${lead.pieceId}|${lead.reversed}|${way}|${line ? `${line.colour}|${r?.next}|${line.stops.map((st) => st.depotId).join(",")}` : "-"}`;
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
      const legs = lineLegs(game.layout, pieces);
      const next = r.next % line.stops.length;
      const toNext = pieces[next] === -1 ? null : legFromCursor(game.layout, front, pieces[next]);
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
      routeView.show(ribbons, [...discs.values()], gaps);
      // A stop just added pops in; the next stop pulses when it becomes the next (or the card opens).
      const now = performance.now() / 1000;
      const stopsKey = line.stops.map((st) => st.depotId).join(",");
      if (ribbonFor.carId === carId && stopsKey.startsWith(ribbonFor.stops) && line.stops.length === ribbonFor.stops.split(",").filter(Boolean).length + 1) routeView.pop(line.stops.length - 1, now);
      if (ribbonFor.carId !== carId || ribbonFor.next !== next) routeView.pulse(now);
      ribbonFor = { carId, stops: stopsKey, next };
      const out = line.stops.findIndex((_, k) => unreachable(k));
      if (out !== -1) {
        const name = names.find((st) => st.depotId === line.stops[out].depotId)?.name ?? "a stop";
        cantReachText = pinnedFor.has(out) ? `Can't reach ${name}: a pinned switch sends trains the other way. Hold its lever to unpin it` : `Can't reach ${name}: no track leads there`;
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

  // The Lines view (see src/ui/lines-view.ts): every line listed (rename it, recolour it, show it), and every line's
  // ribbon on the map while it's open. Built only on change: a key per frame, nothing more while nothing changes.
  const linesView = new LinesView(hud.root, LINE_COLOURS, LINE_NAME_MAX, {
    rename: (id, name) => {
      renameLine(game.economy, id, name);
      linesChanged();
    },
    recolour: (id, colour) => {
      recolourLine(game.economy, id, colour);
      linesChanged();
    },
    show: (id) => {
      const places = linePlaces(id);
      if (places.length > 0) frameInRoom(places.length === 1 ? [places[0], places[0].clone().add(new Vector3(250, 0, 250))] : places, 600);
    },
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

  /** Each frame: the menu's Lines item, and the open view's list and ribbons (redrawn only when they change). */
  function showLines(): void {
    const allowed = mode === "sandbox" || progress.learned.has("routes");
    hud.setLinesAvailable(allowed && game.economy.lines.size > 0);
    if (!linesView.open) return;
    // A train's card opened (a tap on the map): the view gives way to it.
    if (interaction.openEngineCarId !== -1 || !allowed) {
      closeLines();
      return;
    }
    const lines = [...game.economy.lines.values()];
    linesView.show(lines.map((l) => ({ id: l.id, name: l.name, colour: l.colour, trains: trainsOn(game.economy, l.id).length, stops: l.stops.length })));
    const key = `${game.trackVersion}|${game.layout.switchesVersion}|${lines.map((l) => `${l.id}${l.colour}:${l.stops.map((st) => st.depotId).join(",")}`).join("|")}`;
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
    for (const l of lines) {
      const pieces = l.stops.map((st) => game.economy.depot(st.depotId)?.pieceId ?? -1).filter((p) => p !== -1);
      for (const leg of lineLegs(game.layout, pieces)) if (leg) ribbons.push({ runs: leg, colour: l.colour });
    }
    allLines.show(ribbons, []);
    game.invalidate();
  }

  // The map view (Game mode): the whole land from above, with what each town wants and each depot holds.
  const mapView = new MapView(hud.root, { go: (m) => goToMarker(m), close: () => closeMap(true, true) });
  /** Where the camera was before the map opened, to go back to. */
  let mapReturn: { target: Vector3; distance: number; phi: number; theta: number } | null = null;
  let mapRefreshedAt = 0;

  /** Planning a route when the map opened: the engine, so planning goes on when it closes (−1 if not). */
  let planAfterMap = -1;
  function openMap(): void {
    // The map is how to find a far place while planning (the hint says to tap places on the map): planning waits.
    planAfterMap = planning ? interaction.openEngineCarId : -1;
    // (Planning, a place picked here is gone to; it's added with a tap there, as any stop.)
    mapView.setHint(planAfterMap !== -1 ? "Tap a place to go there, then tap it to add it" : null);
    closeLines();
    if (expanding) setExpanding(false);
    if (board.open) setBoardOpen(false);
    interaction.clearSelection();
    hud.hideCards();
    game.follow(-1);
    const c = game.controls;
    const sph = new Spherical().setFromVector3(game.camera.position.clone().sub(c.target));
    mapReturn = { target: c.target.clone(), distance: sph.radius, phi: sph.phi, theta: sph.theta };
    const e = game.landscape.grid.extent();
    const radius = Math.hypot(e.x1 - e.x0, e.z1 - e.z0) / 2;
    const distance = Math.min(frameDistance(radius * 0.72, game.camera.fov, game.camera.aspect), c.maxDistance);
    game.director.glideTo(new Vector3((e.x0 + e.x1) / 2, 0, (e.z0 + e.z1) / 2), distance, { phi: 0.22, duration: 0.9 });
    mapView.setOpen(true);
    hud.setMapOpen(true);
    refreshMap();
    game.invalidate();
  }

  /** Close the map; `back` glides to where the camera was. */
  function closeMap(back: boolean, resume = false): void {
    if (!mapView.open) return;
    mapView.setOpen(false);
    hud.setMapOpen(false);
    if (back && mapReturn) {
      const r = mapReturn;
      game.director.glideTo(r.target, r.distance, { phi: r.phi, theta: r.theta, duration: 0.9 });
    }
    mapReturn = null;
    game.invalidate();
    // Back to planning, the engine's card (its bar) as it was; the view where the map left it (a town picked there).
    // (Only when it's the player closing it, or picking a place on it: not the title, the board or the lines opening.)
    const carId = planAfterMap;
    planAfterMap = -1;
    if (carId !== -1 && resume) {
      interaction.openEngineCard(carId);
      if (interaction.openEngineCarId === carId) {
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
  }

  function refreshMap(): void {
    mapRefreshedAt = performance.now();
    mapView.show(mapMarkers(game.world, (id) => townLife.status(id)));
    placeMap();
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
    const guide = goal.guide(game.world);
    interaction.guideSpots = guide.marks.map((p) => ({ x: p.x, z: p.z }));
    if (guide.tab) hud.openTray(guide.tab, guide.shelf);
    // The card to choose from ("Make a switch": the workshop's, its Switch row there to tap).
    if (guide.card !== undefined) interaction.openDepotCard(guide.card);
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
    journal.clear();
    growth = null;
    ticks = new GoalTicks();
    ticksEntry = null;
    goalsPanel.reset();
  }

  /** Game mode, in play: start again on the starter map with no goals done. */
  function newGame(): void {
    resetGoals();
    saveLastBuilt("game", null);
    setWorld(freshGameWorld());
    townLife.reset();
    passengersOn();
    save();
    openingView();
  }

  /** Leave the title for a mode: carry on with its railway, or start it afresh. */
  function play(next: GameMode, fresh: boolean): void {
    // From the opening screen: its toys go first, and the screen paints without them before a map is built (building
    // holds the page for a moment, and a toy canvas left showing through it can flash white).
    if (overOpening) {
      if (leaving) return;
      leaving = true;
      toys?.stop();
      requestAnimationFrame(() => setTimeout(() => begin(next, fresh), 0));
      return;
    }
    begin(next, fresh);
  }

  /** Load or make the mode's world, and play. */
  function begin(next: GameMode, fresh: boolean): void {
    interaction.guideSpots = [];
    leaving = false;
    if (fresh && next === "game") resetGoals();
    if (fresh) saveLastBuilt(next, null);
    if (fresh) {
      // An older save (the title offers only a fresh start for it): loading it keeps it aside before the new map's autosave.
      if (hasOlderSave(next)) loadFromStorage(next);
      setWorld(next === "game" ? freshGameWorld() : createWorld(Math.floor(Math.random() * 1_000_000)));
      restoreSession(next, false);
    } else if (next !== mode) {
      const saved = loadFromStorage(next);
      if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${next} autosave (${saved.error})`);
      if (saved && !saved.ok && saved.error === OLDER_SAVE) hud.toast("That map was saved by an older version of the game (it's kept aside): here's a fresh one", false, 6000);
      setWorld(saved?.ok ? saved.value : buildStarterWorld());
      restoreSession(next, !!saved?.ok);
    }
    enter(next);
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
  function enter(next: GameMode): void {
    closeLines();
    mode = next;
    saveLastMode(mode);
    title.hide();
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
    hud.setVisible(true);
    playing = true;
    save();
    goalsPanel.setVisible(mode === "game");
    // An industry you place must stand near what it works with (trees, fields): Game mode's rule.
    // (A school stands beside a town, one a town: the one being moved doesn't count against itself.)
    interaction.siteRule =
      mode === "game" ? (type, pose, ignoreId) => siteWhy(game.landscape, type, pose, (town) => schoolOf(game.world, town, (id) => ignores(ignoreId, id))) ?? haltWhy(game.landscape, type, pose) : null;
    // A drawn line uses only the pieces in the toy box (Game mode).
    interaction.draw.stock = mode === "game" ? pieceStock : null;
    interaction.draw.unlearned = mode === "game" ? pieceUnlearned : null;
    if (mode === "game") {
      ensureGameModels();
      townLife.reset();
      passengersOn();
      progress.coverMap(game.world);
      // (A save from before first-time gifts: its towns' levels were reached already.)
      for (const t of game.landscape.towns) progress.bestLevel = Math.max(progress.bestLevel, townLife.status(t.id).level);
      syncLandmarks();
      hud.trayBadge = trayBadge;
      hud.trayKnown = (item) => item.kind !== "piece" && item.kind !== "train" && item.kind !== "prop" ? true : [...thingsFor(item).keys()].every((id) => progress.knows(id));
      hud.setCoins(progress.coins);
      refreshBoard();
    } else {
      townLife.clear();
      detachResearch(game.economy);
      detachPassengers(game.world);
      detachEngines(game.world);
      game.economy.craneTicks = CRANE_TICKS;
      game.economy.craneLoads = 1;
      game.economy.wagonCapacity = WAGON_CAPACITY;
      showWaiting();
      shownDelivered = new Map();
      hud.trayBadge = null;
      hud.trayKnown = null;
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
  const carPoint = (trainId: number, bogie = 0) => game.sim.getTrain(trainId)?.world[bogie];
  const whistles = new WhistlePosts();
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
    if (e.key === "Escape" && mapView.open) closeMap(true, true);
    if (e.key === "Escape" && board.open) setBoardOpen(false);
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
  const skipGlide = () => {
    if (game.director.busy) game.director.cancel();
  };
  window.addEventListener("pointerdown", skipGlide, { capture: true });
  window.addEventListener("keydown", skipGlide, { capture: true });

  /** Two trains met head on (a single line, both ways): once, say how they could pass. */
  let loopTipShown = (() => {
    try {
      return localStorage.getItem("woodrail.loopTip") === "1";
    } catch {
      return false;
    }
  })();
  /** A train too long for a lift is told so once (for a few minutes), not on every approach. */
  const tooLong = new TooLongNotice();
  /** The lifts heard riding (for the clunk as each gets there), and where. */
  const liftsHeard = new Map<number, { x: number; z: number }>();
  function showLoopTip(): void {
    loopTipShown = true;
    try {
      localStorage.setItem("woodrail.loopTip", "1");
    } catch {
      // storage unavailable: it may show again next visit
    }
    hud.toast(headOnTip(mode !== "game" ? null : progress.learned), false, 6000);
  }

  game.onFrame = (dt) => {
    interaction.refreshDepotCard();
    // The Turn arrow shows the next piece's or model's way as seen now, so it turns with the camera.
    hud.setTrayArrow(interaction.trayArrow(hud.propsTab && !interaction.holdingKit));
    hud.setHoldingKit(interaction.holdingKit);
    interaction.tick(dt);
    const now = performance.now();
    if (mapView.open) {
      if (now - mapRefreshedAt > 1000) refreshMap();
      else placeMap();
    }
    let hum = 0;
    // Whistle posts' near track: worked out again only when the props or the track change.
    whistles.sync(game.layout, game.props, game.trackVersion);
    for (const e of game.events) {
      // A train too long for a lift's platform: it turns back at the end, and the player is told why (once).
      // (Once a train, not on each approach: by its cars, as it comes back from turning round a new train.)
      if (e.kind === "lift-refused") {
        if (tooLong.shouldTell(e.carIds, now, e.trainId)) hud.toast(TOO_LONG_MESSAGE);
      }
      if (e.kind === "buffer" && !loopTipShown && game.sim.getTrain(e.trainId)?.lastTurn?.cause === "train") showLoopTip();
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
    for (const id of game.sim.trainIds()) {
      const t = game.sim.getTrain(id)!;
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
      showStation();
      showSawmill();
      showHarbour();
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
    showEngineView();
    let derailed = false;
    for (const id of game.sim.trainIds()) if (game.sim.getTrain(id)?.derailed) derailed = true;
    hud.setRerailVisible(derailed);
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
  (window as unknown as { woodrail: unknown }).woodrail = Object.assign(game, { editor: () => editor, hud, interaction, title, mode: () => mode, progress: () => progress, journal, note, audio, trayThumbnailsSaved: () => trayThumbnailsSaved });
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
    ]).then(async ([, thumbs]) => {
      // Only the pieces the opening railway has (and the title's picture) are waited for: the rest carry on carving
      // in the background, and any wanted before its turn shows as a stand-in for a moment.
      const opening = initialWorld();
      const wanted = [...new Set([TITLE_ART_PIECE, ...[...opening.world.layout.pieceIds()].map((id) => opening.world.layout.getPiece(id)!.type)])];
      let ready = 0;
      await Promise.all(wanted.map((t) => TrackView.whenBuilt(t).then(() => loadBar.set("pieces", ++ready / wanted.length))));
      console.info(`Woodrail: track pieces ready in ${Math.round(performance.now() - t0)} ms (${wanted.length} kinds; the rest in the background)`);
      boot(thumbs, opening);
    });
  }, 30),
);
