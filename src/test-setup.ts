// Loaded before each test file (vite.config.ts): what the game loads on its own as it starts (not in the first
// download), before anything uses it. (Only what doesn't load the game's own modules a test may mock.)
import { loadSaveSchemas } from "./persist/schemas";
import { loadCarver } from "./render/carver";

await Promise.all([loadSaveSchemas(), loadCarver()]);
