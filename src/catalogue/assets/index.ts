import type { Asset } from "../types";
import { ASSETS as buildings } from "./buildings";
import { ASSETS as grand } from "./grand";
import { ASSETS as inGame } from "./in-game";
import { ASSETS as life } from "./life";
import { ASSETS as mechanisms } from "./mechanisms";
import { ASSETS as paths } from "./paths";
import { ASSETS as scenery } from "./scenery";
import { ASSETS as secrets } from "./secrets";
import { ASSETS as track } from "./track";
import { ASSETS as trains } from "./trains";
import { ASSETS as vehicles } from "./vehicles";

/** Every asset in the catalogue. */
export const CATALOGUE: Asset[] = [...trains, ...track, ...buildings, ...mechanisms, ...vehicles, ...life, ...scenery, ...inGame, ...grand, ...secrets, ...paths];
