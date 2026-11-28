/** The recorded clips (CC0, in public/sounds/; sources in docs/sound-credits.md), by what they're for. */
export type ClipName =
  | "magnet"
  | "bump"
  | "crash"
  | "clunk"
  | "switch"
  | "liftClunk"
  | "whistle"
  | "guardWhistle"
  | "bell"
  | "crossingBell"
  | "engineSteam"
  | "engineDiesel"
  | "engineElectric";

/**
 * Each clip's file. One-shots are AAC (.m4a); the engine loops are WAV, since AAC's encoder delay leaves a gap at a
 * loop's seam.
 */
const FILES: Record<ClipName, string> = {
  magnet: "magnet.m4a",
  bump: "bump.m4a",
  crash: "crash.m4a",
  clunk: "clunk.m4a",
  switch: "switch.m4a",
  liftClunk: "lift-clunk.m4a",
  whistle: "whistle.m4a",
  guardWhistle: "guard-whistle.m4a",
  bell: "bell.m4a",
  crossingBell: "crossing-bell.m4a",
  engineSteam: "engine-steam.wav",
  engineDiesel: "engine-diesel.wav",
  engineElectric: "engine-electric.wav",
};

/** Where each clip is served from (the artifact and itch builds use relative bases). */
export const CLIP_FILES = Object.fromEntries(
  Object.entries(FILES).map(([name, file]) => [name, `${import.meta.env.BASE_URL}sounds/${file}`]),
) as Record<ClipName, string>;

/**
 * The clips whose files are in public/sounds/: only these are fetched (a name not here would just 404). The rest
 * (bump, crash, the guard's whistle) keep their synthesised sound: no recording was liked for them.
 */
export const AVAILABLE_CLIPS: readonly ClipName[] = [
  "magnet",
  "clunk",
  "switch",
  "liftClunk",
  "whistle",
  "bell",
  "crossingBell",
  "engineSteam",
  "engineDiesel",
  "engineElectric",
];

/**
 * The decoded clips. `load` fetches and decodes each once; one that can't be fetched or decoded stays null for good
 * (no retry, nothing logged), and the caller plays its synthesised sound instead.
 */
export class ClipBank {
  private readonly buffers = new Map<ClipName, AudioBuffer>();
  private started = false;

  constructor(
    private readonly fetchFn: typeof fetch = (...a) => fetch(...a),
    private readonly available: readonly ClipName[] = AVAILABLE_CLIPS,
  ) {}

  load(ctx: BaseAudioContext): void {
    if (this.started) return;
    this.started = true;
    for (const name of this.available) void this.loadOne(ctx, name);
  }

  get(name: ClipName): AudioBuffer | null {
    return this.buffers.get(name) ?? null;
  }

  /** A failed fetch or decode is the null state, not an error: both are caught here and nothing is logged. */
  private async loadOne(ctx: BaseAudioContext, name: ClipName): Promise<void> {
    try {
      const res = await this.fetchFn(CLIP_FILES[name]);
      if (!res.ok) return;
      this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
    } catch {
      // stays null
    }
  }
}
