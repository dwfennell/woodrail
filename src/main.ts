import { Group, Mesh, Spherical, Vector3, type Object3D } from "three";
import { ToyAudio } from "./audio/audio";
import { Editor, pieceCentre } from "./editor/editor";
import { frameAlong, frameDistance } from "./game/camera-director";
import { Game, type GameWorld } from "./game/game";
import { Interaction } from "./game/interaction";
import { buildStarterWorld, createWorld, freshGameWorld, landForSale, plotsForSale } from "./game/world";
import { CELL, connectedPairs, fixedHome, PLOT_DEPTH, PLOT_WIDTH, SURF_RIVER, SURF_SEA, type Landscape, type PlotCoord } from "./landscape";
import { loadLastBuilt, loadLastMode, saveLastBuilt, saveLastMode, type GameMode } from "./game/modes";
import { hasSave, loadFromStorage, loadGoals, loadProgress, saveGoals, saveProgress, saveToStorage, serializeWorld } from "./persist/save";
import { reporter, startLog, type Reporter } from "./debug/report";
import { GoalTracker } from "./game/goals";
import { GoalsPanel } from "./ui/goals-panel";
import { Journal, type JournalEntry, type JournalPlace, type NoteInput } from "./game/journal";
import { loadBlenderModels, loadGameModels, loadModelSet } from "./render/blender-models";
import { LoadingToys, type Shelf } from "./ui/loading-toys";
import { goalLabels, goalMarks, SQUARE_RING } from "./render/goal-marks";
import { TownLife } from "./game/town-life";
import { plotPrice } from "./game/towns";
import { describeThings, firstTimeGift, offerOnGrowth, payDelivery, refreshOffers, schoolIdeas, takeBlueprint, takeCrate } from "./game/rewards";
import { landmarkOf, landmarksOf } from "./game/landmarks";
import { mapMarkers, type MapMarker } from "./game/map-markers";
import { MapView } from "./ui/map-view";
import { Progress } from "./game/progress";
import { costOf, craftNow, craftShort, Crafting, lacking, uncraft, workshops, workshopStock } from "./game/crafting";
import { costText, isFree, LOOK_TECH, ruleOf, THING_RULES, thingsFor, type ThingId } from "./game/things";
import { DEPOT_NAMES, syncIndustries, INDUSTRY_ROLE } from "./game/world";
import { rateFor, resourceAt, SITE_RULES, siteWhy, updateRates, yardMiddle } from "./game/industries";
import { fieldPrice, fieldSpot, plantField } from "./game/fields";
import { WorkshopPanel, type MakeRow } from "./ui/workshop-panel";
import { nextStop, routeStops } from "./game/route-stops";
import { decoupleWords } from "./game/decouple-words";
import { engineStatus, trainsForReport, type CantMove } from "./game/engine-status";
import { MAX_SHEDS, SHED_CAP, type StopAction } from "./economy";
import { BlueprintBoard, type Station } from "./ui/blueprint-board";
import { pieceIcon, trainIcon } from "./ui/icons";
import { goodsOf, learnAuto, priceOf, needMet, seenOf, learnWithGoods, ready, TECHS, techOf, unlocksOf } from "./game/tech";
import { applyCranes, boostOf, Counters, machinesFor, upgradeKey } from "./game/upgrades";
import { attachEngines, cantMove, detachEngines, tooHeavy } from "./game/engines";
import { BOAT_SAIL, BUY_LOT, buyPrice, goodsForSale, HarbourTrade, SHED_PRICE } from "./game/harbours";
import { CRANE_TICKS, WAGON_CAPACITY } from "./economy/constants";
import { BRANCHES, describeNeed as describeNeedWords, type Need, type Plan, type Price } from "./game/blueprints";
import { attachPassengers, detachPassengers, peopleArrive, waitingCap } from "./game/passengers";
import { aOrAn, describe as describeGoods, kindsOf, minus, total, type Bag } from "./economy/goods";
import { costTag, trayCostTag } from "./ui/cost-tag";
import { GOODS_ICON, type CargoKind } from "./economy/cargo";
import { qualityFor, saveQualityOverride } from "./render/quality";
import { renderThumbnails, ThumbnailStudio, type ThumbnailSubject } from "./render/thumbnails";
import { loadCached, saveCached } from "./render/piece-cache";
import { onPiecesBuilt, TrackView } from "./render/track-view";
import { PIECE_TYPES, type Anchor, type PieceTypeId } from "./track";
import type { CarKind, CarLook } from "./sim";
import { Hud } from "./ui/hud";
import { INDUSTRY_GROUPS, TRACK_ITEMS, TRAIN_ITEMS, trayKey, type LandTool, type TrayItem } from "./ui/tray-catalogue";
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

/** How far a station or depot may turn when it gives (radians). */
const GIVE_TURN = (4 * Math.PI) / 180;

/** Tray pictures drawn together, a batch a frame, after the title's up. */
const THUMBNAIL_BATCH = 8;
/** How long (ms) a batch of tray pictures waits for the scene to be still before it's drawn anyway. */
const THUMBNAIL_STILL_WAIT_MS = 1500;

/** How long (ms) an engine's status must hold before its card shows it (so it doesn't flicker between steps). */
const STATUS_HOLD_MS = 600;

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const loading = document.querySelector<HTMLDivElement>("#loading");

/** A map asked for in the link (`#seed-12345`), to share or replay a particular map. */
function linkedSeed(): number | null {
  const m = /^#seed-(\d{1,9})$/.exec(location.hash);
  return m ? Number(m[1]) : null;
}

/**
 * The world to open with. A linked map opens in Sandbox (fresh, unless the sandbox autosave is already that map, so
 * reloading keeps your track); otherwise the last mode's autosave, or the starter map.
 */
function initialWorld(): { world: GameWorld; mode: GameMode; linked: boolean } {
  const seed = linkedSeed();
  const mode = seed !== null ? "sandbox" : loadLastMode();
  // Reloaded from play (graphics switched, an update taken): straight back into the game, past the title.
  const resumed = takeResume() === mode;
  const saved = loadFromStorage(mode);
  if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${mode} autosave (${saved.error})`);
  if (seed !== null) {
    const same = saved?.ok && saved.value.landscape.seed === seed && !saved.value.landscape.starter;
    return { world: same ? saved.value : createWorld(seed), mode, linked: true };
  }
  return { world: saved?.ok ? saved.value : buildStarterWorld(), mode, linked: resumed };
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
  // Stations and depots never shift to take up joint play.
  const isFixedPiece = (id: number): boolean => [...game.stations.values(), ...game.depots.values()].includes(id);
  /** An editor for the world's track and props (props-only edits skip the track's work). */
  /**
   * Stations and depots give a little (half a square, a few degrees) from where the map put them, as wooden track
   * does when pushed, so track closing on one needn't meet it exactly.
   */
  const stationGive = (id: number): Anchor | null => {
    const land = game.landscape;
    for (const t of land.towns) if (game.stations.get(t.id) === id) return { home: fixedHome(t.centre, t.station.heading), reach: CELL / 2, turn: GIVE_TURN };
    for (const d of land.depots) if (game.depots.get(d.id) === id) return { home: fixedHome(d.centre, d.piece.heading), reach: CELL / 2, turn: GIVE_TURN };
    return null;
  };
  /** A station or depot was nudged: the map's record of it follows, and its buildings and yard are redrawn. */
  const stationsNudged = (ids: number[]) => {
    const land = game.landscape;
    const slots = new Set<number>();
    for (const id of ids) {
      const pose = game.layout.getPiece(id)?.pose;
      if (!pose) continue;
      const town = land.towns.find((t) => game.stations.get(t.id) === id);
      const depot = land.depots.find((d) => game.depots.get(d.id) === id);
      if (town) town.station = { ...pose };
      if (depot) depot.piece = { ...pose };
      const i = land.grid.cellAtWorld(pose.x, pose.z);
      if (i !== -1) slots.add(plotSlotOf(i));
    }
    game.editLand([...slots]);
    game.depotView.setWorld(game.economy, game.layout);
  };
  const makeEditor = () => {
    const ed = new Editor(game.layout, game.sim, () => onChange(), isFixedPiece, stationGive);
    ed.onNudge = stationsNudged;
    ed.onTrackEdit = (ids) => {
      const id = ids.find((i) => game.layout.getPiece(i));
      if (id !== undefined) saveLastBuilt(mode, pieceCentre(game.layout, id));
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
    ed.onPropsChange = () => {
      game.propsChanged();
      hud.setHistory(ed.canUndo, ed.canRedo);
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
      (type) => (type === "signal" ? game.trackView.signalModel() : INDUSTRY_ROLE[type] ? game.depotView.model(INDUSTRY_ROLE[type]) : null),
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
      trayTap: (item) => {
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
      toggleMap: () => (mapView.open ? closeMap(true) : openMap()),
      toggleBoard: () => setBoardOpen(!board.open),
      buyLand: () => buyLand(),
      newGame: () => newGame(),
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
      needThumbnails: (items) => drawPropThumbnails(items),
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
      for (const key of drawThumbnails(batch, false, studio)) hud.setThumbnail(key, thumbnails.get(key)!);
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

  // Catalogue models' tray pictures: drawn when their shelf is first shown, one a frame (each builds the model, if it
  // isn't yet), then kept with the start-up pictures for the next visit.
  const thumbQueue: string[] = [];
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
  function drawPropThumbnails(items: TrayItem[]): void {
    const idle = thumbQueue.length === 0;
    for (const item of items) if (item.kind === "prop" && !thumbQueue.includes(item.asset)) thumbQueue.push(item.asset);
    if (idle && thumbQueue.length > 0) requestAnimationFrame(nextThumbnail);
  }
  function nextThumbnail(): void {
    const asset = thumbQueue[0];
    if (asset === undefined) return;
    void game.propLibrary.load(asset).then((model) => {
      thumbQueue.shift();
      if (model) {
        studio ??= new ThumbnailStudio(game.renderer);
        const subject = new Group();
        for (const part of model.parts) subject.add(new Mesh(part.geometry, part.material));
        subject.rotation.y = -0.6;
        const url = studio.shoot(subject);
        const key = `prop:${asset}`;
        hud.setThumbnail(key, url);
        thumbnails.set(key, url);
        saveThumbnailsSoon();
      }
      if (thumbQueue.length > 0) requestAnimationFrame(nextThumbnail);
    });
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
    if (mode === "game") saveProgress(progress.toJSON());
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
    title.show({ sandbox: hasSave("sandbox"), game: hasSave("game") });
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
    title.root.classList.remove("over-opening");
    title.root.style.paddingTop = "";
    dismissLoading();
    removeEventListener("resize", refreshToys);
  }

  /** Save, then show the title over a still, wide view of the map. */
  function showTitle(): void {
    closeMap(false);
    setBoardOpen(false);
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
    title.show({ sandbox: hasSave("sandbox"), game: hasSave("game") });
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
        const f = frameAlong(place.points ?? [place], game.camera.fov, game.camera.aspect, place.points ? PLACE_MARGIN : GOAL_MARGIN);
        game.follow(-1);
        game.director.glideTo(new Vector3(f.x, 0, f.z), Math.min(f.distance, game.controls.maxDistance), { duration: 1 });
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
  /** The latest growth milestone: a goal ticked within a moment of it joins its toast and entry. */
  let growth: { entry: JournalEntry; at: number } | null = null;
  const GROWTH_JOIN_MS = 1500;
  const depotPlace = (depotId: number) => {
    const d = game.economy.depot(depotId);
    const p = d && game.layout.getPiece(d.pieceId)?.pose;
    return p ? { x: p.x, z: p.z } : undefined;
  };

  /** When each town last had a delivery (performance.now): its school thinks only while it's supplied. */
  const lastDelivered = new Map<number, number>();
  const SCHOOL_SUPPLIED_MS = 180_000;
  // Game mode's towns: they want things, and grow when they get them.
  const townLife = new TownLife(game, {
    knows: (tech) => progress.learned.has(tech),
    received: (town, kind, n, before) => {
      lastDelivered.set(town.id, performance.now());
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
      const raised = [...progress.landmarks].filter((id) => !before.has(id)).map((id) => landmarkOf(id)!);
      const landmarks =
        raised.length === 1 ? `New ${raised[0].name.toLowerCase()}: ${raised[0].blurb}` : raised.length > 1 ? `New ${raised.map((m) => m.name.toLowerCase()).join(", ")}` : "";
      const level = aOrAn(status.name.toLowerCase());
      // The first village, town and city each bring a present; a town that grows offers two blueprints suited to its
      // new size (one learned free), or a crate of things.
      const gift = firstTimeGift(progress, status.level);
      if (gift.length > 0) hud.refreshTrayBadges();
      const offered = progress.offers.length;
      offerOnGrowth(progress, town.name, Math.random, status.level);
      const extras = [landmarks, gift.length > 0 ? `Present: ${describeThings(gift)}` : "", progress.offers.length > offered ? "Claim your reward in Blueprints" : ""].filter(Boolean);
      const grew = built.length > 0 ? `${town.name} grew into ${level}!` : `${town.name} is now ${level}, but has no room to build`;
      const where = built.length > 0 ? placeOf(built) : here;
      if (extras.length > 0) {
        // A first, a present or a landmark: a moment. One toast and one entry, and the goal it ticks joins them.
        const entry = note({ kind: "milestone", text: `${grew} ${extras.join(" · ")}`, place: where }, 5200, true);
        growth = entry ? { entry, at: performance.now() } : null;
        checkGoals(true);
        if (entry) hud.toast(entry.text, true, 5200);
        growth = entry ? { entry, at: performance.now() } : null;
      } else {
        note({ kind: "event", text: grew, place: where });
        checkGoals(true); // (its tick is logged after the growth)
      }
      audio.chime();
      if (gift.length > 0 || progress.offers.length > offered) {
        refreshBoard();
        scheduleSave();
      }
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
  function checkGoals(announce: boolean): void {
    if (mode !== "game" || !playing) return;
    const ctx = { learned: progress.learned };
    const fresh = goals.update(game.world, ctx);
    if (fresh.length > 0) {
      saveGoals(goals.ids());
      if (announce) {
        const tick = `✓ ${fresh.map((g) => g.title).join(" · ")}`;
        if (growth && (performance.now() - growth.at < GROWTH_JOIN_MS)) {
          // Right after a growth milestone: part of the same toast and entry.
          journal.amend(growth.entry, `${growth.entry.text} · ${tick}`);
          goalsPanel.newsChanged();
        } else {
          const where = fresh[0].guide(game.world).points[0];
          note({ kind: "milestone", text: tick, place: where && { x: where.x, z: where.z } }, 3200);
        }
        audio.chime();
        goalsPanel.celebrate();
      }
    }
    const current = goals.current();
    goalsPanel.show(goals.doneCount, current, current ? current.check(game.world, ctx) : null, goals.next());
  }

  // Game mode's toy box and workshop: what you own (worked out against what's on the map), and what's being made.
  let progress = loadProgress() === undefined ? Progress.fresh() : Progress.fromJSON(loadProgress());
  const crafting = new Crafting(progress);
  crafting.setProgress(progress);
  const thingLabel = (id: ThingId) => ruleOf(id)?.label ?? id;

  /**
   * Game mode: can this tray item come out (known, and enough of it in the toy box)? Says why not if not. What's
   * missing is made on the spot, unless `make` is false (only asking).
   */
  interaction.trayAllowed = (item) => trayAllowed(item);
  // After the last of something in the toy box goes down, no next one waits at its end.
  interaction.trayHas = (item) => mode !== "game" || item.kind !== "piece" || progress.hasAnother(game.world, item);
  function trayAllowed(item: Parameters<typeof thingsFor>[0] | { kind: string }, make = true): boolean {
    if (mode !== "game" || (item.kind !== "piece" && item.kind !== "train")) return true;
    // (A new take: whatever an earlier one made is settled, or never was.)
    if (make) trainMade = null;
    const look = lockedLook(item);
    if (look) {
      const t = techOf(look)!;
      hud.toast(t.plan ? `${t.label}: coming soon` : `${t.label}: learn its blueprint first${t.requires.length ? ` (${t.requires.map(describeNeed).join(", ")})` : ""}`, false, 3600);
      return false;
    }
    const needs = thingsFor(item as Parameters<typeof thingsFor>[0]);
    for (const id of needs.keys()) {
      if (isFree(id) || progress.knows(id)) continue;
      hud.toast(`${ruleOf(id)!.label}: not learned yet`);
      return false;
    }
    // None left of something it takes: all of what's missing is made on the spot from the workshop's yard, or none.
    const lack = lacking(game.world, progress, needs);
    if (lack.size === 0) return true;
    // One thing short: by its own name; more (a train's wagons): by the tray item's.
    const one = lack.size === 1 ? [...lack.values()][0] : 0;
    const label = one === 1 ? ruleOf([...lack.keys()][0])!.label : "label" in item && typeof item.label === "string" ? item.label : "That";
    const why = make ? craftNow(game.world, progress, lack) : craftShort(game.world, progress, lack);
    if (why === "no-workshop") {
      hud.toast(`No ${label.toLowerCase()} left. Place your workshop (Industries tab) to make more`, false, 3600);
      return false;
    }
    if (why) {
      const short = [total(why.goods) > 0 ? `${describeGoods(why.goods)} more at the workshop` : "", why.coins > 0 ? `${why.coins} more coins` : ""].filter(Boolean).join(" and ");
      hud.toast(`${label}: needs ${short}`, false, 3600);
      return false;
    }
    if (!make) return true;
    // A train's cars are made as it's taken out: kept to be given back if it's dropped off the track.
    trainMade = item.kind === "train" ? lack : null;
    const cost = costOf(lack);
    // "a switch", "3 flatbed wagons", or a whole train by its name.
    const made = one === 1 ? aOrAn(label.toLowerCase()) : one > 1 ? describeThings([...lack]).toLowerCase() : label.toLowerCase();
    const said = `Made ${made}: ${[total(cost.goods) > 0 ? `${describeGoods(cost.goods)} from the workshop` : "", cost.coins > 0 ? `${cost.coins} coins` : ""].filter(Boolean).join(" and ")}`;
    // A train's is said once it's on the track (dropped off it, nothing's made after all).
    if (trainMade) trainSaid = said;
    else hud.toast(said, false, 2600);
    afterCraft();
    return true;
  }

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

  /** Game mode: how many of a track piece the player could put down now (0 if not learned). */
  function pieceStock(type: PieceTypeId): number {
    const needs = thingsFor({ kind: "piece", type });
    let n = Infinity;
    for (const [id, k] of needs) {
      if (isFree(id)) continue;
      if (!progress.knows(id)) return 0;
      n = Math.min(n, Math.floor(progress.available(game.world, id) / k));
    }
    return n;
  }

  /** The toy box on the tray (Game mode): how many of each are left. */
  function trayBadge(item: Parameters<typeof thingsFor>[0] | { kind: string }): { text: string; empty: boolean; attention?: boolean; craft?: boolean; locked?: boolean } | null {
    if (item.kind !== "piece" && item.kind !== "train") return null;
    const needs = thingsFor(item as Parameters<typeof thingsFor>[0]);
    if ([...needs.keys()].every(isFree)) return null;
    if ([...needs.keys()].some((id) => !progress.knows(id)) || lockedLook(item)) return { text: "Locked", empty: true, locked: true };
    let n = Infinity;
    for (const [id, k] of needs) n = Math.min(n, Math.floor(progress.available(game.world, id) / k));
    // The workshop, while there's none on the map: it's where planks go to learn blueprints.
    const attention = n > 0 && "type" in item && item.type === "depot-workshop" && workshops(game.world).length === 0;
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

  /** Industries placed or moved: give new ones their depots, and redraw the yards where they stand. */
  let industryKey = "";
  function industriesChanged(): void {
    const added = syncIndustries(game.world);
    let key = "";
    for (const id of game.layout.pieceIds()) {
      const p = game.layout.getPiece(id)!;
      if (INDUSTRY_ROLE[p.type]) key += `${id}:${p.pose.x},${p.pose.z},${p.pose.heading};`;
    }
    // Upgrades put a machine in their yards (Game mode): the yards are drawn again when one is learned.
    key += `#${mode === "game" ? upgradeKey(progress) : ""}`;
    game.depotView.extras = mode === "game" ? (role) => machinesFor(progress, role) : null;
    if (added || key !== industryKey) game.depotView.setWorld(game.economy, game.layout);
    industryKey = key;
    // Industries work as fast as what's around them allows: recounted when they move or the land changes.
    const rateKey = `${key}#${game.landscape.grid.revision}#${mode === "game" ? upgradeKey(progress) : ""}`;
    if (rateKey !== rateKeyShown) {
      rateKeyShown = rateKey;
      if (updateRates(game.world, mode === "game" ? (role) => boostOf(progress, role) : undefined)) game.invalidate();
    }
    hud.refreshTrayBadges();
  }
  let rateKeyShown = "";

  const workshopPanel = new WorkshopPanel(hud.depotExtra, {
    order: (id) => {
      crafting.order(id);
      showWorkshop(true);
      scheduleSave();
    },
    cancel: (id) => {
      crafting.cancel(id);
      showWorkshop(true);
      scheduleSave();
    },
  });
  // The blueprint board: choices from towns that grew, blueprints to learn with planks, and the rest of the tree.
  const board = new BlueprintBoard(document.body, {
    choose: (k, id) => {
      if (takeBlueprint(progress, k, id)) learned(id);
      else {
        // Learned meanwhile: the card was stale. Say so, and show the refreshed offers.
        hud.toast(`${techOf(id)?.label ?? "That"} is already learned`);
        refreshBoard();
        scheduleSave();
      }
    },
    crate: (k) => {
      const crate = progress.offers[k]?.crate;
      if (!crate || !takeCrate(progress, k)) return;
      note({ kind: "milestone", text: `Into your toy box: ${describeThings(crate)}` }, 3800);
      audio.chime();
      hud.refreshTrayBadges();
      refreshBoard();
      save();
    },
    learn: (id) => {
      // (Not yet: the card's reason line beside the button already says why.)
      if (learnWithGoods(game.world, progress, id)) learned(id);
    },
    close: () => setBoardOpen(false),
  });

  function learned(id: string): void {
    const makes = unlocksOf(id).map((t) => ruleOf(t)!.label.toLowerCase());
    const t = techOf(id)!;
    note({ kind: "milestone", text: makes.length > 0 ? `Learned ${t.label.toLowerCase()}! Make ${makes.slice(0, 2).join(" and ")}${makes.length > 2 ? " and more" : ""} at the workshop` : `Learned ${t.label}! ${t.blurb}` }, 3800);
    // An upgrade takes effect at once: industries' rates and the cranes.
    applyCranes(game.economy, progress);
    industriesChanged();
    audio.chime();
    hud.refreshTrayBadges();
    game.invalidate();
    refreshBoard();
    save();
  }

  function setBoardOpen(open: boolean): void {
    if (open && mapView.open) closeMap(false);
    board.setOpen(open);
    hud.root.classList.toggle("board-open", open);
    if (open) {
      interaction.clearSelection();
      hud.hideCards();
    }
    refreshBoard();
  }

  /** A blueprint's price as the tray shows costs: "16🪵 40🪙" ("free" for nothing). */
  function priceTag(p: Price): string {
    return costTag({ planks: p.planks, ...(p.goods as Bag | undefined) }, p.coins) || "free";
  }

  const PLAN_WORDS: Record<Plan, string> = { next: "Coming soon: next on the list", soon: "Coming soon", later: "Coming one day", ending: "The ending: coming one day" };

  /**
   * Why a blueprint can't be learned now, in one short line (null if it can): the goods it takes must be in the
   * workshop's yard (planks at the sawmill, on a train or delivered to a town don't count), and the coins in hand.
   */
  function learnWhy(goods: Bag, coins: number, stock: Bag): string | null {
    const kinds = kindsOf(goods);
    if (kinds.length > 0 && workshops(game.world).length === 0) return "Place your workshop (Industries tab)";
    for (const k of kinds) {
      const have = stock[k] ?? 0;
      if (have >= goods[k]!) continue;
      if (have === 0 && k === "planks") return "Bring planks from the sawmill by train";
      return `${describeGoods({ [k]: goods[k] })} needed at workshop (${have} there)`;
    }
    if (progress.coins < coins) return `${coins} coins needed (${progress.coins} now)`;
    return null;
  }

  function refreshBoard(): void {
    // A blueprint another card taught may still sit on a pending offer: swap it out before anything is shown.
    if (refreshOffers(progress, Math.random)) scheduleSave();
    hud.setBoardButton(board.open, progress.offers.length > 0);
    if (!board.open) return;
    const stock = workshopStock(game.world);
    const offerOf = (id: string) => progress.offers.findIndex((o) => o.ids.includes(id));
    const seen = seenOf(progress, new Set(progress.offers.flatMap((o) => o.ids)));
    const stations: Station[] = TECHS.map((t) => {
      const makes = unlocksOf(t.id).map((x) => ({ label: ruleOf(x)!.label, icon: x.startsWith("piece:") ? pieceIcon(x.slice(6) as PieceTypeId) : trainIcon([x.slice(4) as CarKind]) }));
      if (t.feature) makes.push({ label: t.feature.label, icon: `<span class="bp-feature">${t.feature.icon}</span>` });
      if (makes.length === 0) makes.push({ label: t.brings, icon: `<span class="bp-feature">✨</span>` });
      const requires = t.requires.map((n) => ({ text: describeNeed(n) + (n.kind === "count" && n.stat === "riders" ? ` (${progress.riders} so far)` : ""), met: needMet(progress, n) }));
      const price = priceOf(progress, t);
      const base = { id: t.id, label: t.label, blurb: t.blurb, branch: t.branch, makes, needs: [...t.needs], seen: seen.get(t.id)!, price: priceTag(price), planks: price.planks ?? 0, requires };
      if (progress.learned.has(t.id)) return { ...base, state: "learned" as const };
      if (t.plan) return { ...base, state: "soon" as const, waits: PLAN_WORDS[t.plan] };
      const offer = offerOf(t.id);
      if (offer !== -1) return { ...base, state: "offered" as const, offer };
      if (progress.board.has(t.id) && ready(progress, t.id)) {
        const why = learnWhy(goodsOf(t, price), price.coins ?? 0, stock);
        return { ...base, state: "ready" as const, affordable: why === null, ...(why ? { why } : {}) };
      }
      const missing = t.needs.filter((n) => !progress.learned.has(n));
      const unmet = t.requires.filter((n) => !needMet(progress, n));
      const waits =
        missing.length > 0
          ? `Learn ${missing.map((n) => techOf(n)!.label.toLowerCase()).join(" and ")} first`
          : unmet.length > 0
            ? `Needs ${unmet.map(describeNeed).join(" and ")}`
            : t.learn === "auto"
              ? "Comes by itself"
              : "A town will offer it as it grows";
      return { ...base, state: "locked" as const, waits };
    });
    const hasWorkshop = workshops(game.world).length > 0;
    board.show({
      stations,
      branches: BRANCHES.map((b) => ({ id: b.id, label: b.label, color: b.color })),
      offers: progress.offers.map((o) => ({ from: o.from, ids: [...o.ids], ...(o.crate ? { crate: describeThings(o.crate) } : {}) })),
      planks: hasWorkshop ? stock.planks ?? 0 : null,
      stock: hasWorkshop ? `The workshop's yard has ${describeGoods(stock)}` : "Place your workshop (Industries tab)",
    });
  }

  // The workshop's clock: a few times a second, not every frame (it runs while nothing on screen moves).
  const CRAFT_STEP = 0.25;
  const schoolClock = { seconds: 0 };
  /** The landmarks your towns have, from the map (a blueprint may need a library). */
  function syncLandmarks(): void {
    progress.landmarks.clear();
    for (const id of landmarksOf(game.landscape)) progress.landmarks.add(id);
    // The school and library blueprints come with the buildings.
    learnAuto(progress);
  }
  setInterval(() => {
    if (mode === "game" && board.open) refreshBoard();
    // Schools have ideas while the game runs.
    if (mode === "game" && playing && !game.paused) {
      // A college: ideas twice as often.
      // A school thinks only while its town has had a delivery lately.
      const supplied = (town: number) => performance.now() - (lastDelivered.get(town) ?? -Infinity) < SCHOOL_SUPPLIED_MS;
      const idea = schoolIdeas(progress, game.landscape, schoolClock, CRAFT_STEP * (progress.learned.has("college") ? 2 : 1), Math.random, supplied);
      if (idea) {
        const school = game.landscape.towns.find((t) => t.name === idea.from);
        note({ kind: "event", text: `${idea.from}: ${techOf(idea.id)!.label} is on the board`, place: school && { x: school.station.x, z: school.station.z } });
        refreshBoard();
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
    plant.textContent = `Plant a field · ${price} coins`;
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
    attachPassengers(game.world, () => progress, () => {
      hud.setCoins(progress.coins);
      for (const id of learnAuto(progress)) {
        note({ kind: "milestone", text: `${progress.riders} passengers carried: you've learned ${techOf(id)!.label}!` }, 4200);
        audio.chime();
        hud.refreshTrayBadges();
        refreshBoard();
      }
      scheduleSave();
    });
  }
  /** Planks kept for the workshop: it's short of what the cheapest blueprint on the board needs (worked out once a second). */
  let planksKept = false;
  const keepPlanks = (kind: string) => kind === "planks" && planksKept;
  function updatePlanksKept(): void {
    game.economy.reserved = mode === "game" ? keepPlanks : null;
    if (mode !== "game" || workshops(game.world).length === 0) {
      planksKept = false;
      return;
    }
    let cheapest = Infinity;
    for (const t of TECHS) {
      if (!progress.board.has(t.id) || progress.learned.has(t.id) || !ready(progress, t.id)) continue;
      const planks = priceOf(progress, t).planks ?? 0;
      if (planks > 0) cheapest = Math.min(cheapest, planks);
    }
    planksKept = (workshopStock(game.world).planks ?? 0) < cheapest && cheapest < Infinity;
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
    if (counters.collect(game.economy, progress) && board.open) refreshBoard();
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
    for (const d of game.economy.allDepots()) if (d.role === "town") game.setWaiting(d.townId, live ? d.waiting : null);
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
    for (const tid of Object.keys(THING_RULES) as ThingId[]) {
      if (!progress.knows(tid)) continue;
      const rule = ruleOf(tid)!;
      rows.push({
        id: tid,
        label: rule.label,
        cost: costText(rule),
        have: progress.available(game.world, tid),
        queued: progress.orders.filter((o) => o === tid).length,
        shelf: tid.startsWith("car:") ? "Trains" : tid.includes("depot-") ? "Industries" : "Track",
      });
    }
    rows.sort((a, b) => ["Track", "Trains", "Industries"].indexOf(a.shelf) - ["Track", "Trains", "Industries"].indexOf(b.shelf));
    const now = crafting.now;
    // What it's waiting for: goods in the workshop's yard, and coins.
    const nowRule = now ? ruleOf(now.id)! : null;
    const shortGoods = nowRule ? minus(nowRule.cost, workshopStock(game.world)) : {};
    const shortCoins = nowRule ? Math.max(0, (nowRule.coins ?? 0) - progress.coins) : 0;
    const need = now?.waiting ? [total(shortGoods) > 0 ? describeGoods(shortGoods) : "", shortCoins > 0 ? `${shortCoins} coins` : ""].filter(Boolean).join(" + ") || null : null;
    workshopPanel.show(now ? { label: thingLabel(now.id), fill: now.fill, waiting: need } : null, rows);
  }

  // The open engine's route (both modes; Game mode once Train routes is learned): its stops in order, what it does
  // at each (drop goods, pick them up, both), and the one it's heading for. It sets the switches itself.
  let routeShown = "";
  const ACTIONS: Record<StopAction, { label: string; next: StopAction; tip: string }> = {
    both: { label: "Both", next: "drop", tip: "Drops goods this stop takes, and picks up what it gives" },
    drop: { label: "Drop", next: "pick", tip: "Only drops goods off here" },
    pick: { label: "Pick up", next: "both", tip: "Only picks goods up here" },
  };
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
      return;
    }
    const stops = routeStops(game.world);
    const r = game.economy.routeOf(carId);
    const key = `${carId}:${stops.length}:${r ? `${r.next}|${r.stops.map((st) => `${st.depotId}${st.action}`).join(",")}` : "-"}`;
    if (key === routeShown) return;
    routeShown = key;
    const box = hud.engineExtra;
    box.innerHTML = "";
    box.hidden = stops.length === 0;
    box.classList.add("route");
    const nameOf = (id: number) => stops.find((st) => st.depotId === id)?.name ?? "?";
    // A warehouse takes and gives the same goods: a stop there either drops off or picks up (Both reads as Drop).
    const atWarehouse = (st: { depotId: number }) => game.economy.depot(st.depotId)?.role === "warehouse";
    const shown = (st: { depotId: number; action: StopAction }): StopAction => (atWarehouse(st) && st.action === "both" ? "drop" : st.action);
    const stored = (st: { depotId: number; action: StopAction }): StopAction => (atWarehouse(st) ? (shown(st) === "drop" ? "pick" : "drop") : ACTIONS[st.action].next);
    const set = (edit: (stops: { depotId: number; action: StopAction }[]) => void) => {
      const cur = game.economy.routeOf(carId);
      const list = cur ? cur.stops.map((st) => ({ ...st })) : [];
      edit(list);
      game.economy.setRoute(carId, list.length > 0 ? { stops: list, next: Math.min(cur?.next ?? 0, list.length - 1) } : null);
      showRoute();
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
    label.textContent = "Route";
    head.append(label);
    if (!r) {
      const any = document.createElement("span");
      any.className = "route-none";
      any.textContent = "Goes anywhere, works at every stop";
      head.append(any);
    }
    box.append(head);
    (r?.stops ?? []).forEach((st, k) => {
      const row = document.createElement("div");
      row.className = "route-stop";
      row.classList.toggle("next", r!.next === k);
      const mark = document.createElement("span");
      mark.className = "route-mark";
      mark.textContent = r!.next === k ? "▶" : `${k + 1}`;
      row.append(
        mark,
        button(nameOf(st.depotId), "route-name", "Tap to choose another stop", () => set((l) => (l[k].depotId = nextStop(routeStops(game.world), l[k].depotId)))),
        button(ACTIONS[shown(st)].label, "route-action", ACTIONS[shown(st)].tip, () => set((l) => (l[k].action = stored(l[k])))),
        button("✕", "route-remove", "Take this stop off the route", () => set((l) => l.splice(k, 1))),
      );
      box.append(row);
    });
    box.append(
      button("+ Stop", "route-add", "Add a stop: the train stops only at its stops, and sets the switches on its way", () =>
        set((l) => {
          const used = new Set(l.map((st) => st.depotId));
          const pick = stops.find((st) => !used.has(st.depotId)) ?? stops[0];
          l.push({ depotId: pick.depotId, action: "both" });
        }),
      ),
    );
  }

  // The map view (Game mode): the whole land from above, with what each town wants and each depot holds.
  const mapView = new MapView(hud.root, { go: (m) => goToMarker(m), close: () => closeMap(true) });
  /** Where the camera was before the map opened, to go back to. */
  let mapReturn: { target: Vector3; distance: number; phi: number; theta: number } | null = null;
  let mapRefreshedAt = 0;

  function openMap(): void {
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
  function closeMap(back: boolean): void {
    if (!mapView.open) return;
    mapView.setOpen(false);
    hud.setMapOpen(false);
    if (back && mapReturn) {
      const r = mapReturn;
      game.director.glideTo(r.target, r.distance, { phi: r.phi, theta: r.theta, duration: 0.9 });
    }
    mapReturn = null;
    game.invalidate();
  }

  function goToMarker(m: MapMarker): void {
    closeMap(false);
    game.director.glideTo(new Vector3(m.x, 0, m.z), 1000, { phi: 0.95, duration: 1 });
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
    const guide = goal.guide(game.world);
    if (guide.tab) hud.openTray(guide.tab, guide.shelf);
    if (guide.points.length > 0) {
      // The places along the screen's long side, with room round them for their surroundings (and for the goals card
      // and the tray, which cover the top and the bottom of the screen).
      const f = frameAlong(guide.points, game.camera.fov, game.camera.aspect, GOAL_MARGIN);
      game.follow(-1);
      game.director.glideTo(new Vector3(f.x, 0, f.z), Math.min(f.distance, game.controls.maxDistance), { duration: 1, ...(f.theta === null ? {} : { theta: f.theta }) });
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
    progress = Progress.fresh();
    hud.setCoins(progress.coins);
    crafting.setProgress(progress);
    saveProgress(progress.toJSON());
    refreshBoard();
    goals = new GoalTracker();
    saveGoals([]);
    journal.clear();
    growth = null;
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
    leaving = false;
    if (fresh && next === "game") resetGoals();
    if (fresh) saveLastBuilt(next, null);
    if (fresh) setWorld(next === "game" ? freshGameWorld() : createWorld(Math.floor(Math.random() * 1_000_000)));
    else if (next !== mode) {
      const saved = loadFromStorage(next);
      if (saved && !saved.ok) console.warn(`Woodrail: ignoring ${next} autosave (${saved.error})`);
      setWorld(saved?.ok ? saved.value : buildStarterWorld());
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
        for (const key of drawThumbnails(industryItems)) hud.setThumbnail(key, thumbnails.get(key)!);
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
    mode = next;
    saveLastMode(mode);
    title.hide();
    leaveOpening();
    // The first frames after the map appears (or changes) are slow while it settles: not a reason to draw coarser.
    game.settleResolution();
    game.director.cancel();
    game.paused = pausedBeforeTitle;
    hud.setPaused(game.paused);
    hud.setMode(mode);
    // Town houses and placed models can be moved in Sandbox only.
    interaction.propsEditable = mode === "sandbox";
    hud.setVisible(true);
    playing = true;
    save();
    goalsPanel.setVisible(mode === "game");
    // An industry you place must stand near what it works with (trees, fields): Game mode's rule.
    interaction.siteRule = mode === "game" ? (type, pose) => siteWhy(game.landscape, type, pose) : null;
    // A drawn line uses only the pieces in the toy box (Game mode).
    interaction.draw.stock = mode === "game" ? pieceStock : null;
    if (mode === "game") {
      ensureGameModels();
      townLife.reset();
      passengersOn();
      progress.coverMap(game.world);
      // (A save from before first-time gifts: its towns' levels were reached already.)
      for (const t of game.landscape.towns) progress.bestLevel = Math.max(progress.bestLevel, townLife.status(t.id).level);
      syncLandmarks();
      hud.trayBadge = trayBadge;
      hud.setCoins(progress.coins);
      refreshBoard();
    } else {
      townLife.clear();
      detachPassengers(game.world);
      detachEngines(game.world);
      game.economy.craneTicks = CRANE_TICKS;
      game.economy.craneLoads = 1;
      game.economy.wagonCapacity = WAGON_CAPACITY;
      showWaiting();
      shownDelivered = new Map();
      hud.trayBadge = null;
      hud.setCoins(null);
    }
    industriesChanged();
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
    if (e.key === "Escape" && mapView.open) closeMap(true);
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
    const points: { x: number; z: number }[] = [];
    for (const id of game.layout.pieceIds()) {
      if (isFixedPiece(id) || game.layout.getPiece(id)!.type === "riser") continue;
      points.push(pieceCentre(game.layout, id));
    }
    if (points.length === 0) for (const t of game.landscape.towns.slice(0, 2)) points.push(t.station);
    if (points.length === 0) return;
    const f = frameAlong(points, game.camera.fov, game.camera.aspect, GOAL_MARGIN);
    game.follow(-1);
    game.director.glideTo(new Vector3(f.x, 0, f.z), Math.min(f.distance, game.controls.maxDistance), { duration: 0.9 });
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
  function showLoopTip(): void {
    loopTipShown = true;
    try {
      localStorage.setItem("woodrail.loopTip", "1");
    } catch {
      // storage unavailable: it may show again next visit
    }
    const canSwitch = mode !== "game" || progress.learned.has("switches");
    hud.toast(canSwitch ? "Trains met head on. Add a passing loop (two switches) so they can pass" : "Trains met head on. Learn Switches to build a passing loop", false, 6000);
  }

  game.onFrame = (dt) => {
    interaction.refreshDepotCard();
    // The Turn arrow shows the next piece's or model's way as seen now, so it turns with the camera.
    hud.setTrayArrow(interaction.trayArrow(hud.propsTab));
    interaction.tick(dt);
    const now = performance.now();
    if (mapView.open) {
      if (now - mapRefreshedAt > 1000) refreshMap();
      else placeMap();
    }
    let hum = 0;
    for (const e of game.events) {
      if (e.kind === "buffer" && !loopTipShown && game.sim.getTrain(e.trainId)?.lastTurn?.cause === "train") showLoopTip();
      const p = carPoint(e.kind === "turned" ? e.newTrainId : e.trainId, e.kind === "joint" ? e.bogie : 0);
      if (!p) continue;
      if (e.kind === "turned") {
        audio.rotate();
        continue;
      }
      const [v, pan] = listen(p.x, p.z);
      if (e.kind === "joint") audio.clack(v, pan);
      else if (e.kind === "coupled") audio.magnet(v, pan);
      else if (e.kind === "derailed") audio.crash(v, pan);
      else if (e.kind === "buffer") audio.magnet(v * 0.6, pan);
    }
    for (const id of game.sim.trainIds()) {
      const t = game.sim.getTrain(id)!;
      if (t.derailed || t.speed < 5 || !t.cars.some((c) => c.kind === "engine" && c.lever !== 0)) continue;
      hum += listen(t.world[0].x, t.world[0].z)[0];
    }
    audio.setHum(game.paused ? 0 : hum);

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
    showRoute();
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
  (window as unknown as { woodrail: unknown }).woodrail = Object.assign(game, { editor: () => editor, hud, interaction, title, mode: () => mode, progress: () => progress, journal, note, trayThumbnailsSaved: () => trayThumbnailsSaved });
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
