import { Game } from "./game/game";
import { buildStarterWorld } from "./game/starter";
import "./style.css";

const canvas = document.querySelector<HTMLCanvasElement>("#scene")!;
const loading = document.querySelector<HTMLDivElement>("#loading");

// Let the loading screen paint before the heavy texture and geometry generation.
requestAnimationFrame(() =>
  setTimeout(() => {
    const game = new Game(canvas, buildStarterWorld());
    (window as unknown as { woodrail: Game }).woodrail = game;
    game.start();
    loading?.classList.add("done");
  }, 30),
);
