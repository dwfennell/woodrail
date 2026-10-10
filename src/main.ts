import { ToyAudio } from "./audio/audio";
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
  const audio = new ToyAudio();

  const hud = new Hud(
    document.body,
    {
      trayPointerDown: (item, e) => interaction.startTrayDrag(item, e),
      undo: () => editor.undo(),
      redo: () => editor.redo(),
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
      rotate: () => interaction.rotateSelected(),
      flip: () => interaction.flipSelected(),
      deletePiece: () => interaction.deleteSelected(),
      newLayout: () => {
        const layout = new Layout();
        setWorld({ layout, sim: new Sim(layout) });
      },
      resetStarter: () => {
        setWorld(buildStarterWorld());
        game.frameLayout();
      },
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
  interaction.onPlaced = (snapped) => {
    if (snapped) audio.snap();
  };

  function setWorld(world: GameWorld): void {
    game.setWorld(world);
    game.follow(-1);
    editor = new Editor(game.layout, game.sim, () => onChange());
    interaction.clearSelection();
    hud.hideCards();
    onChange();
  }

  function onChange(): void {
    game.trackChanged();
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
    let hum = 0;
    for (const e of game.events) {
      const p = carPoint(e.trainId, e.kind === "joint" ? e.bogie : 0);
      if (!p) continue;
      const [v, pan] = listen(p.x, p.z);
      if (e.kind === "joint") audio.clack(v, pan);
      else if (e.kind === "coupled") audio.magnet(v, pan);
      else if (e.kind === "repelled") audio.bump(v, pan);
      else if (e.kind === "derailed") audio.crash(v, pan);
      else if (e.kind === "buffer") audio.magnet(v * 0.6, pan);
    }
    for (const id of game.sim.trainIds()) {
      const t = game.sim.getTrain(id)!;
      if (t.derailed || t.speed < 5 || !t.cars.some((c) => c.kind === "engine" && c.lever !== 0)) continue;
      hum += listen(t.world[0].x, t.world[0].z)[0];
    }
    audio.setHum(game.paused ? 0 : hum);
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
