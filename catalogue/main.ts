import { loadBlenderModels } from "../src/render/blender-models";

// The game's cars are modelled in Blender: load them first, so the catalogue shows them as the game does.
await loadBlenderModels();
await import("../src/catalogue/viewer");
