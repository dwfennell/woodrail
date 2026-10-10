import { Editor } from "./editor/editor";
import { Game, type GameWorld } from "./game/game";
import { Interaction } from "./game/interaction";
import { buildStarterWorld } from "./game/starter";
import { loadFromStorage, saveToStorage } from "./persist/save";
import { qualityFor, saveQualityOverride } from "./render/quality";
import { Sim } from "./sim";
import { Layout } from "./track";
import { Hud } from "./ui/hud";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const loading = document.querySelector<HTMLDivElement>("#loading");

function initialWorld(): GameWorld {
  const saved = loadFromStorage();
  if (saved?.ok) return saved.value;
  if (saved && !saved.ok) console.warn(`Woodrail: ignoring autosave (${saved.error})`);
  return buildStarterWorld();
}

function boot(): void {
  const game = new Game(canvas, initialWorld());
  let editor = new Editor(game.layout, game.sim, () => onChange());
  let saveTimer = 0;
  let interaction: Interaction;

  const hud = new Hud(
    document.body,
    {
      trayPointerDown: (item, e) => interaction.startTrayDrag(item, e),
      undo: () => editor.undo(),
      redo: () => editor.redo(),
      rerailAll: () => {
        let n = 0;
        for (const id of game.sim.trainIds()) if (game.sim.getTrain(id)?.derailed && game.sim.rerail(id) !== -1) n++;
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
      rotate: () => interaction.rotateSelected(),
      flip: () => interaction.flipSelected(),
      deletePiece: () => interaction.deleteSelected(),
      newLayout: () => {
        const layout = new Layout();
        setWorld({ layout, sim: new Sim(layout) });
      },
      resetStarter: () => setWorld(buildStarterWorld()),
      toggleQuality: () => {
        saveQualityOverride(game.quality.tier === "high" ? "mobile" : "high");
        location.reload();
      },
      closeCards: () => {
        hud.hideCards();
        interaction.clearSelection();
      },
    },
    () => (game.quality.tier === "high" ? "High" : "Battery saver"),
  );

  interaction = new Interaction(game, hud, () => editor, () => onChange());

  function setWorld(world: GameWorld): void {
    game.setWorld(world);
    game.follow(-1);
    editor = new Editor(game.layout, game.sim, () => onChange());
    interaction.clearSelection();
    hud.hideCards();
    onChange();
  }

  function onChange(): void {
    game.trackView.sync();
    hud.setHistory(editor.canUndo, editor.canRedo);
    scheduleSave();
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => saveToStorage(game.layout, game.sim), 600);
  }

  // Save train positions periodically and when the page is hidden.
  setInterval(() => saveToStorage(game.layout, game.sim), 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveToStorage(game.layout, game.sim);
  });

  // Performance overlay (backtick).
  let fps = 60;
  window.addEventListener("keydown", (e) => {
    if (e.key === "`") hud.perf.hidden = !hud.perf.hidden;
    if (e.key === " " && (e.target as HTMLElement).tagName !== "BUTTON") {
      e.preventDefault();
      game.paused = !game.paused;
      hud.setPaused(game.paused);
    }
  });
  game.onFrame = (dt) => {
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    if (!hud.perf.hidden) {
      const info = game.renderer.info.render;
      hud.perf.textContent = `${fps.toFixed(0)} fps · sim ${game.simMs.toFixed(2)} ms · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${game.layout.pieceCount} pieces · ${qualityFor(game.quality.tier).tier}`;
    }
  };

  hud.setHistory(false, false);
  (window as unknown as { woodrail: unknown }).woodrail = Object.assign(game, { editor: () => editor, hud, interaction });
  game.start();
  loading?.classList.add("done");
}

// Let the loading screen paint before the heavy texture and geometry generation.
requestAnimationFrame(() => setTimeout(boot, 30));
