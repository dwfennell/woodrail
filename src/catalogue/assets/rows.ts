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
];
