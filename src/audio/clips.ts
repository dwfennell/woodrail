/** The recorded clips (CC0, in public/sounds/), by what they're for. */
export type ClipName =
  | "clack1"
  | "clack2"
  | "clack3"
  | "magnet"
  | "bump"
  | "crash"
  | "clunk"
  | "switch"
  | "liftClunk"
  | "saw"
  | "whistle"
  | "guardWhistle"
  | "bell"
  | "crossingBell"
  | "engineLoop";

const FILES: Record<ClipName, string> = {
  clack1: "clack1",
  clack2: "clack2",
  clack3: "clack3",
  magnet: "magnet",
  bump: "bump",
  crash: "crash",
  clunk: "clunk",
  switch: "switch",
  liftClunk: "lift-clunk",
  saw: "saw",
  whistle: "whistle",
  guardWhistle: "guard-whistle",
  bell: "bell",
  crossingBell: "crossing-bell",
  engineLoop: "engine-loop",
};

/** Where each clip is served from (the artifact and itch builds use relative bases). */
export const CLIP_FILES = Object.fromEntries(
  Object.entries(FILES).map(([name, file]) => [name, `${import.meta.env.BASE_URL}sounds/${file}.m4a`]),
) as Record<ClipName, string>;

/**
 * The decoded clips. `load` fetches and decodes each once; one that can't be fetched or decoded stays null for good
 * (no retry, nothing logged), and the caller plays its synthesised sound instead.
 */
export class ClipBank {
  private readonly buffers = new Map<ClipName, AudioBuffer>();
  private started = false;

  constructor(private readonly fetchFn: typeof fetch = (...a) => fetch(...a)) {}

  load(ctx: BaseAudioContext): void {
    if (this.started) return;
    this.started = true;
    for (const name of Object.keys(CLIP_FILES) as ClipName[]) void this.loadOne(ctx, name);
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
