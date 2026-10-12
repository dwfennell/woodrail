export type QualityTier = "high" | "mobile";

export interface QualitySettings {
  readonly tier: QualityTier;
  readonly shadowMapSize: number;
  readonly maxPixelRatio: number;
  readonly ambientOcclusion: boolean;
  readonly depthOfField: boolean;
}

const TIERS: Record<QualityTier, QualitySettings> = {
  high: { tier: "high", shadowMapSize: 4096, maxPixelRatio: 1.5, ambientOcclusion: true, depthOfField: true },
  mobile: { tier: "mobile", shadowMapSize: 2048, maxPixelRatio: 1.5, ambientOcclusion: false, depthOfField: false },
};

const STORAGE_KEY = "woodrail.quality";

function readOverride(): QualityTier | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "high" || v === "mobile" ? v : null;
  } catch {
    return null;
  }
}

export function saveQualityOverride(tier: QualityTier): void {
  try {
    localStorage.setItem(STORAGE_KEY, tier);
  } catch {
    // storage unavailable (private mode): the choice lasts for this session only
  }
}

/** Pick a tier: explicit override, else coarse pointer / small screen → mobile. */
export function detectQuality(): QualitySettings {
  const override = readOverride();
  if (override) return TIERS[override];
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 700;
  return TIERS[coarse || small ? "mobile" : "high"];
}

export function qualityFor(tier: QualityTier): QualitySettings {
  return TIERS[tier];
}
