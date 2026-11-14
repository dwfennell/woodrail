import { catalogueModel, loadModelSet, modelOf } from "../../render/blender-models";
import type { Asset } from "../types";

/**
 * Towns in rows (spec 2026-11-14-town-rows-design.md): the slices a town's houses and shops are drawn as, each on
 * its lot's tile. Made in Blender (tools/blender/bldg_rows.py); their colours are the building's own (see
 * `rowColours`, which the props library paints them with). Towns place them; they are on no tray.
 */
const MODELS = await loadModelSet("rows", true);

const row = (id: string, name: string, notes: string): Asset => ({
  id,
  name,
  category: "Stations & buildings",
  tags: ["town", "row", "house"],
  notes,
  build: (k) => catalogueModel(modelOf(MODELS, id), k),
});

/** A landmark or a civic place in the style, made for one lot (see `ROW_CIVIC`). */
const civic = (id: string, name: string, notes: string): Asset => ({
  id,
  name,
  category: "Stations & buildings",
  tags: ["town", "row", "civic"],
  notes,
  build: (k) => catalogueModel(modelOf(MODELS, id), k),
});

export const ASSETS: Asset[] = [
  row("row-pair-a", "Pair of narrow houses", "Two narrow houses side by side on one lot, each under its own roof: the bulk of a town's rows."),
  row("row-pair-b", "Pair of houses, one gabled", "Two narrow houses, the second with its gable to the street."),
  row("row-pair-c", "Pair of houses, stepped", "Two narrow houses, one a little deeper and taller in the roof."),
  row("row-wide-a", "Wide house", "One house the width of its lot, a ridge roof and two chimneys."),
  row("row-wide-b", "Wide house, hipped", "A wide house under a hipped roof, a cream band at each floor."),
  row("row-wide-c", "House with a gabled wing", "A house with a small wing whose gable faces the street."),
  row("row-low-a", "Cottage", "A low cottage under a steep hipped roof: it gains one storey at most."),
  row("row-low-b", "Bungalow", "A long low house: it gains one storey at most."),
  row("row-shop", "Shop", "A shop: one wide window, a striped awning, a fascia board in its door's colour."),
  row("row-toy-shop", "Toy shop", "A shop with a tall gable and a yellow and blue awning: a rare find in a town."),
  row("row-corner-shop", "Corner shop", "A shop on a street corner, a second window on the side street."),
  row("row-terrace", "Terrace", "Four narrow houses on two lots, in two colours, one gabled."),
  row("row-bakery", "Bakery", "A long shop with two chimneys, the baker's house beside it."),
  row("row-cafe", "Café", "A long shop front under a hipped roof, tables on the pavement."),
  row("row-post", "Post office", "A long building with a red door and a postbox by the kerb."),
  row("row-flats", "Flats", "A block of flats two lots wide, nine windows a floor."),
  row("row-court", "Houses round a court", "Two wide houses on a 2 x 2 block, one garden court behind them."),
  civic("row-church", "Church", "A stone church along the street, its tower and spire at one end: on two lots."),
  civic("row-church-4", "Church in its churchyard", "The church on a 2 x 2 block, its churchyard behind."),
  civic("row-market-hall", "Market hall", "A long timber hall with five open arches, a clock turret on its ridge, stalls by the kerb."),
  civic("row-market-hall-4", "Market hall and green", "The market hall on a 2 x 2 block, a green behind."),
  civic("row-library-1", "Library, small", "A sage library with a two-column porch, on one lot."),
  civic("row-library", "Library", "A sage library with a columned porch under a pediment, on two lots."),
  civic("row-town-hall", "Town hall", "A town hall in pale yellow, its middle bay under a pediment and a clock, a cupola on the roof."),
  civic("row-town-hall-4", "Town hall and gardens", "The town hall on a 2 x 2 block, its gardens behind."),
  civic("row-fire-station-1", "Fire station, small", "A red fire station with one engine door and a hose tower, on one lot."),
  civic("row-fire-station", "Fire station", "A red fire station with two engine doors and a hose tower."),
  civic("row-police-station-1", "Police station, small", "A blue-grey police station, a blue lamp either side of its door, on one lot."),
  civic("row-police-station", "Police station", "A blue-grey police station, a blue lamp either side of its door."),
  civic("row-hospital-1", "Hospital, small", "A white hospital of two floors, a red cross over its door, on one lot."),
  civic("row-hospital", "Hospital", "A white hospital of three floors, glass doors under a canopy, a red cross on top."),
  civic("row-hospital-4", "Hospital and grounds", "The hospital on a 2 x 2 block, its grounds behind."),
  civic("row-clock-tower", "Clock tower", "A stone clock tower on a small paved square."),
  civic("row-clock-tower-2", "Clock tower and square", "The clock tower in the middle of a paved square two lots wide."),
  civic("row-castle-gate-4", "Castle", "Two round towers, a gate between them and a keep behind, on a 2 x 2 block: a theatre's or a stadium's stand-in."),
  civic("row-lighthouse", "Lighthouse", "A red and white lighthouse on a paved lot."),
  civic("row-lighthouse-2", "Lighthouse and boats", "The lighthouse with two sailing boats drawn up beside it, on two lots."),
  civic("row-kiosk", "Ice-cream kiosk", "A round kiosk under a pink cloth roof, tables beside it."),
  civic("row-kiosk-2", "Ice-cream kiosk and tables", "The kiosk on two lots, tables either side."),
  civic("row-cinema", "Cinema", "A plum cinema, a lit canopy over its doors, posters along its front and a tall sign."),
];
