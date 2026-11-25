/**
 * The sheets and cards whose code is fetched the first time they open (`lazy`, src/lib/lazy.ts), each by one loader
 * here, so the open and the idle prefetch (src/lib/prefetch.ts) ask for the same module and the second finds it
 * already loaded.
 */
export const loadBlueprintBoard = () => import("./blueprint-board");
export const loadExplainerSheet = () => import("./explainer-sheet");
export const loadPaintSheet = () => import("./paint-sheet");
export const loadCreditsSheet = () => import("./credits-sheet");
export const loadStatsCard = () => import("./stats-card");
export const loadFeedbackSheet = () => import("./feedback-sheet");
