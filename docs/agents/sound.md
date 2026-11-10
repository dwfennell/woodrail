# Sound — playbook

## 1. Scope
The game's sound effects: `src/audio/` (`audio.ts`: `ToyAudio` and `Gate`; `crossing-bell.ts`) and its call sites in
`src/main.ts`, plus the mute button (the `src/ui/hud.ts` menu and `src/ui/prefs.ts`). There is no volume control. That
covers:
- **trains:** clacks, couplings, buffers, crashes, the motor hum, whistles, the guard's whistle, the departure bell,
  the level crossing bell;
- **building:** pickup, putdown, snap, the draw tick, lay, rotate, refuse, tap;
- **the world:** crane clunks, the sawmill, lifts, switch throws;
- **milestones:** one chime.

Out of scope: music, and any per-frame audio work while idle.

## 2. How audio works
- **ToyAudio** (`src/audio/audio.ts`) is a single instance made in `main.ts`. Every sound is synthesised with WebAudio, with no audio files. Signal chain: master GainNode (0.8, 0 when muted) → DynamicsCompressor → destination. One shared 0.5 s noise buffer.
- **Primitives:**
  - `knock(volume, freq, decay, pan)`: bandpassed noise plus a falling sine "tock". Nearly every wooden sound is one or more knocks with different pitch and decay.
  - `vary()`: a ±6% pitch spread.
  - `chime`, `saw`, `bell`, `crossingBell`, `whistle`, `guardWhistle` and the lift winding build their own nodes.
  - `guardWhistle(volume, pan)`: a station guard's soft pea-whistle trill (a 2.4 kHz sine warbled at 26 Hz, 0.45 s, gain 0.045) as a train sets off from a big station (`Game.onGuardFlag`). One per `GUARD_WHISTLE_GAP_MS` 1500; silent below volume 0.05. Not yet judged by ear.
- **Placement:** `listen(x, z)` in `main.ts` returns `[volume, pan]`. Volume comes from distance to the camera's focus (`500/(d+150)`, capped at 1) and pan from screen x. UI sounds and the chime are centred.
- **Rate limits:**
  - `Gate(ms)` (in `audio.ts`) lets one sound through per window: routed trains' switch clunks (`softSwitchClunk`) at `SOFT_CLUNK_GAP_MS` 700, crossing bells at `CROSSING_BELL_GAP_MS` 2500.
  - `clack` has its own minimum gap (18 ms).
  - A whistle within 0.6 s plays only if it's ≥1.4× louder, and the earlier one fades out.
  - Crane work has no gate: `main.ts` plays a `clunk` for every economy event it drains (each unit loaded or unloaded).
  - There is no voice cap.
- **Level crossing bell:** `crossingBell(volume, pan)`, a soft two-strike "ding ding" (988 Hz, lower and quieter than the departure `bell`). `CrossingsView.closing` lists crossings whose barriers began to come down that update; `CrossingBells` (`src/audio/crossing-bell.ts`) rings only the loudest on screen with `listen` volume ≥ 0.3 (`CROSSING_BELL_MIN_VOLUME`), at most once per `CROSSING_BELL_GAP_MS` 2500. Not rung for a crossing laid under a standing train.
- **Milestones:** one sound, `chime()` (two triangle notes, 784 and 1175 Hz), called from 20 places in `main.ts` (towns connected, a town grown, a goal ticked, rewards and upgrades, things made, a field planted, a secret found, stages and achievements, places and depot tracks built, the circus leaving, power asked for, and any good unloaded at a town). There are no ranked tunes and no gap between chimes.
- **Coins:** no sound of their own.
- **Sleep and resume:**
  - Every sound calls `wake()`. One timer suspends the context `IDLE_SUSPEND_MS` (3 s) after the last sound.
  - Hum or lift winding holds the context awake.
  - Hiding the page or muting suspends it at once.
- **Hum:** `setHum(level)` is called every frame trains run. It builds one sawtooth (92 Hz, lowpass 380 Hz, 7 Hz vibrato) on first use, and returns early when the level is unchanged (Δ < 0.0005). `setWinding` works the same way for lifts.
- **Mute:** it sets the master gain to 0 and is saved in localStorage (`woodrail.muted`, `src/ui/prefs.ts`).

## 3. How to test
- **Unit tests:** `npx vitest run src/audio`.
  - `sleep.test.ts`: a Proxy-stub AudioContext with fake timers (sleep and wake, the guard whistle's gap).
  - `gate.test.ts`, `crossing-bell.test.ts`.
- **Wiring:** the call sites are in `main.ts` and have no unit tests of their own (the crane clunks, the chimes, the
  whistles).
- **Idle CPU:** `npm run build && node tools/perf/idle-cpu.mjs` should show 0.00% for the audio threads and a `suspended@…` entry. Known weaknesses of the script: start a real Game, settle longer before sampling, and report frames drawn as well as CPU, since headless SwiftShader dominates whole-browser CPU.
- **UI changes:** `npm run e2e:touch`.
- **By ear:** a person on a phone has to judge every new sound: pitch, loudness against the trains, and busyness on a full map.
- **Commits:** put idle-CPU numbers in commits that touch the audio lifecycle.

## 4. Branch state (held until the user decides)
None of the three below is on main: the goods sounds, the ranked tunes (`cues.ts`, `cue`/`CUES`, `CUE_GAP_MS`), the
volume slider (`woodrail.volume`), `MAX_VOICES`, `RESUME_LEAD_S` and their tests (`toy-audio.test.ts`, `cues.test.ts`)
live only on these branches.
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
- Delayed grains go through `knock`, so they respect mute and wake.
- New sounds in `main.ts` that can come in bursts must be gated (`Gate`).
- Tests stub `window` and `document` with `vi.stubGlobal`; `ensure()` returns null with no window.
