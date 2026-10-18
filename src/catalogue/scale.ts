/**
 * Buildings drawn bigger or smaller than they were modelled, by asset id: the town's civic buildings stand over its
 * houses, a farm's barn sits back among its fields. Applied to the model itself (`catalogue/assets/buildings.ts`), so
 * everything that measures it (footprints, picking, the tray's pictures) sees the size it's drawn at.
 */
export const BUILDING_SCALE: Readonly<Record<string, number>> = {
  "bldg-school": 1.3,
  "bldg-town-hall": 1.3,
  "bldg-hospital": 1.3,
  "bldg-library": 1.2,
  "bldg-market-hall": 1.2,
  "bldg-church": 1.2,
  "bldg-college": 1.2,
  "bldg-post-office": 1.15,
  "bldg-fire-station": 1.15,
  "bldg-police-station": 1.15,
  "bldg-red-barn": 0.75,
};

/** The scale an asset is drawn at (1 for most). */
export const scaleOf = (assetId: string): number => BUILDING_SCALE[assetId] ?? 1;
