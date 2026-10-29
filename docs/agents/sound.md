# Sound — playbook

## 1. Scope
The game's sound effects: `src/audio/` (ToyAudio, Gate, cues.ts) and its call sites in `src/main.ts`, plus the volume and mute UI (the `src/ui/hud.ts` menu and `src/ui/prefs.ts`). That covers:
- **trains:** clacks, couplings, buffers, crashes, the motor hum, whistles, the departure bell;
- **building:** pickup, putdown, snap, the draw tick, lay, rotate, refuse, tap;
- **the world:** cranes and goods, the sawmill, lifts, switch throws;
- **milestones:** tunes and coins.

Out of scope: music, and any per-frame audio work while idle.

## 2. How audio works
- **ToyAudio** (`src/audio/audio.ts`) is a single instance made in `main.ts`. Every sound is synthesised with WebAudio, with no audio files. Signal chain: master GainNode (0.8 × volume, 0 when muted) → DynamicsCompressor → destination. One shared 0.5 s noise buffer.
- **Primitives:**
  - `knock(volume, freq, decay, pan)`: bandpassed noise plus a falling sine "tock". Nearly every wooden sound is one or more knocks with different pitch and decay.
  - `ping()`: a sine with an inharmonic partial, used for coins and metal goods.
  - `vary()`: a ±6% pitch spread.
  - `saw`, `bell` and `whistle` build their own nodes.
- **Placement:** `listen(x, z)` in `main.ts` returns `[volume, pan]`. Volume comes from distance to the camera's focus (`500/(d+150)`, capped at 1) and pan from screen x. UI sounds and tunes are centred.
- **Rate limits:**
  - `Gate(ms)` lets one sound through per window: switch clunks at `SOFT_CLUNK_GAP_MS` 700, coins at `COIN_GAP_MS` 1500.
  - `clack` has its own minimum gap.
  - A whistle within 0.6 s plays only if it's ≥1.4× louder, and the earlier one fades out.
  - `hearCranes()` allows at most one goods sound per depot per frame.
  - `MAX_VOICES` 24 (mixer branch). Tunes are exempt.
- **Tunes:** `cue(kind)` with the `CUES` table, all in C:
  - chime, rank 1: towns connected, rewards, things made, fields, dock sheds;
  - goal, rank 1;
  - grew, rank 2;
  - learned, rank 2;
  - land, rank 3: land bought or a ruin restored.

  Within `CUE_GAP_MS` 700, only a higher rank plays. A growth tune plays before the goal it ticks.
- **Sleep and resume:**
  - Every sound calls `wake()`. One timer suspends the context `IDLE_SUSPEND_MS` (3 s) after the last sound.
  - Hum or lift winding holds the context awake.
  - Hiding the page or muting suspends it at once.
  - Mixer branch: `RESUME_LEAD_S` (50 ms) is added while a resume() is pending, so the first sound isn't clipped.
- **Hum:** `setHum(level)` is called every frame trains run. It builds one sawtooth (92 Hz, lowpass 380 Hz, 7 Hz vibrato) on first use, and returns early when the level is unchanged (Δ < 0.0005). `setWinding` works the same way for lifts.
- **Mute and volume:** they set the master gain and are saved in localStorage (`woodrail.muted`, `woodrail.volume`).

## 3. How to test
- **Unit tests:** `npx vitest run src/audio`.
  - `toy-audio.test.ts`: a Proxy-stub AudioContext with fake timers.
  - `cues.test.ts`: real Sim + Economy; logs into a sawmill must hear off:log ×3, then on:planks ×3.
  - `gate.test.ts`.
- **Wiring:** extract it into `src/audio/cues.ts` and test it through the player's path (sim ticks, real depots), not by calling `audio.x()` directly. Known gap: the coin call in `main.ts`'s `TownLife.received` has no unit test.
- **Idle CPU:** `npm run build && node tools/perf/idle-cpu.mjs` should show 0.00% for the audio threads and a `suspended@…` entry. Known weaknesses of the script: start a real Game, settle longer before sampling, and report frames drawn as well as CPU, since headless SwiftShader dominates whole-browser CPU.
- **UI changes:** `npm run e2e:touch`.
- **By ear:** a person on a phone has to judge every new sound: pitch, loudness against the trains, whether tunes are told apart, and busyness on a full map.
- **Commits:** put idle-CPU numbers in commits that touch the audio lifecycle.

## 4. Branch state (held until the user decides)
- **sound-unlock-idle** a2b9020: landed (main ab42040). Idle audio CPU went from 3.95% to 0.00%.
- **sound-goods** c326397: per-cargo crane sounds, coin clinks, and no more per-unit chime. QA: LAND WITH NOTES.
- **sound-cues** ed9915b: ranked milestone tunes. QA: LAND WITH NOTES.
- **sound-mixer** 28873ef: contains goods and cues, plus the volume slider, `MAX_VOICES` 24, and QA's notes (resume lead, 1500 ms coin gap, every cargo covered). Merged with main 3ae20ac.

## 5. The open question for the user
The user says the sound "isn't good": both the sounds and how they work.

**Diagnosis:**
- nearly everything is the same noise-plus-sine knock: thin, beepy, samey;
- the clacks machine-gun;
- the hum is a buzzing sawtooth;
- placement follows the camera's focus, not what's on screen.

**Proposal:** about 15–20 recorded CC0 clips, compressed, 200–400 KB in total, lazy-loaded after the first tap (check `docs/artifact-builds.md`). Each would be decoded once into an AudioBuffer and played with `vary()`, keeping the gates, voice cap and sleep. Also:
- a per-train wheel rhythm for the clacks;
- a soft chuff tied to speed in place of the hum;
- synthesis as the fallback.

The alternative is reworking the synthesis: cheaper, but limited. Also ask the user which "obvious bugs" they heard, and fix those first either way.

## 6. Gotchas
- **iOS:** the context must be created or resumed in a gesture. Keep the pointerdown, pointerup and keydown listeners: they restart a context that isn't running, e.g. "interrupted" after a call or Siri.
- **Idle at zero:**
  - every new sound must call `wake()`;
  - continuous sounds must return early when unchanged, and count as held in `sleepWhenQuiet`;
  - never run audio work every frame unconditionally;
  - ambience, if ever added, stays off by default.
- Delayed grains go through `knock`, so they respect mute, the voice cap and wake.
- New tunes and sounds in `main.ts` must be gated or rank-checked.
- Tests stub `window` and `document` with `vi.stubGlobal`; `ensure()` returns null with no window.
