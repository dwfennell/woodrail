export type QualityTier = "high" | "mobile";

export interface QualitySettings {
  readonly tier: QualityTier;
  readonly shadowMapSize: number;
  /** Drawing resolution: the screen's own density up to `maxPixelRatio`, stepping down to `minPixelRatio` when frames are slow (see `resolution.ts`). */
  readonly maxPixelRatio: number;
  readonly minPixelRatio: number;
  readonly ambientOcclusion: boolean;
  readonly depthOfField: boolean;
  /** Multisampling of the scene's own target (its antialiasing). */
  readonly sceneSamples: number;
  /**
   * Lean: a phone short of memory, or one whose drawing was lost (`noteContextLost`): a lower resolution, a smaller
   * shadow map and less multisampling (see `leanOf`), against the browser killing the tab.
   */
  readonly lean: boolean;
}

const TIERS: Record<QualityTier, QualitySettings> = {
  high: { tier: "high", shadowMapSize: 4096, maxPixelRatio: 2, minPixelRatio: 1.5, ambientOcclusion: true, depthOfField: true, sceneSamples: 4, lean: false },
  mobile: { tier: "mobile", shadowMapSize: 2048, maxPixelRatio: 2, minPixelRatio: 1.5, ambientOcclusion: false, depthOfField: false, sceneSamples: 4, lean: false },
};

/**
 * A tier's lean settings. On a 1080×2424 phone the drawing at a pixel ratio of 2 holds a 4× multisampled half-float
 * target (46 MB) and its depth (23 MB), and the shadow map 32 MB: at 1.5, 2× and 1024 they're 13, 6.5 and 8 MB.
 */
export function leanOf(q: QualitySettings): QualitySettings {
  return { ...q, shadowMapSize: Math.min(q.shadowMapSize, 1024), maxPixelRatio: Math.min(q.maxPixelRatio, 1.5), minPixelRatio: Math.min(q.minPixelRatio, 1.5), sceneSamples: Math.min(q.sceneSamples, 2), lean: true };
}

/** A phone with this much memory or less (GB, `navigator.deviceMemory`: Chrome's, rounded and capped at 8) is lean. */
export const LEAN_MEMORY_GB = 4;
/** After the drawing was lost, the game stays lean on this device for this long (ms). */
export const LEAN_AFTER_LOSS_MS = 3 * 24 * 3600_000;
const LOST_KEY = "woodrail.gpuLost";

/** The browser took the drawing away (WebGL context lost: often memory): lean from the next load for a while. */
export function noteContextLost(now = Date.now()): void {
  try {
    localStorage.setItem(LOST_KEY, String(now));
  } catch {
    // no storage
  }
}

function lostRecently(now: number): boolean {
  try {
    const at = Number(localStorage.getItem(LOST_KEY));
    return at > 0 && now - at < LEAN_AFTER_LOSS_MS;
  } catch {
    return false;
  }
}

/** Should a phone (the mobile tier) be lean: little memory, or its drawing lost lately? */
export function shouldBeLean(memoryGB: number | undefined, lostAgo: boolean): boolean {
  return lostAgo || (memoryGB !== undefined && memoryGB <= LEAN_MEMORY_GB);
}

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
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 700;
  const q = TIERS[override ?? (coarse || small ? "mobile" : "high")];
  // (Only the mobile tier, "Battery saver", goes lean: a desktop's look stays as it is.)
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return q.tier === "mobile" && shouldBeLean(memory, lostRecently(Date.now())) ? leanOf(q) : q;
}

export function qualityFor(tier: QualityTier): QualitySettings {
  return TIERS[tier];
}
