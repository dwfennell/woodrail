# Recorded sound and what's heard at a distance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Woodrail's sound follow what's on screen, replace the buzzing hum with a recorded engine loop, and replace the train and world "knocks" with CC0 recordings, keeping synthesis as the fallback.

**Architecture:** A pure `hearing` module turns a source's position and kind into a volume from its on-screen size (the `AmbientEye` already in `Game`). `listen()` in `main.ts` uses it. A `ClipBank` fetches and decodes clips after the first gesture; `ToyAudio` methods play a clip when it's loaded and their current synthesis otherwise.

**Tech Stack:** TypeScript, WebAudio, Vitest (the stubbed-`AudioContext` style of `src/audio/sleep.test.ts`).

**Spec:** `docs/superpowers/specs/2026-11-25-recorded-sound-design.md`. Today's system: `docs/agents/sound.md`.

## Global Constraints

- Idle audio stays at 0.00% CPU with a suspended context: every new sound calls `wake()`; continuous sounds return early when unchanged and count as "held" in `sleepWhenQuiet`; no unconditional per-frame audio work.
- `Gate` limits, mute (`woodrail.muted`) and the sleep lifecycle (`IDLE_SUSPEND_MS` 3000) are unchanged.
- Clips are fetched and decoded only after the first user gesture; until a clip is ready (or if it fails), the synthesised sound plays.
- Clip set: mono, compressed, 200–400 KB in total; format chosen for `decodeAudioData` on iOS Safari (AAC `.m4a` or MP3). Stored in `public/`; the artifact build and itch zip must carry them.
- Every clip is CC0 and recorded in a credits file with source URL, author, licence and date checked. No clip is downloaded without the user's OK on the candidate list (Task 5).
- UI ticks (`tap`, `pickup`, `putdown`, `snap`, `rotate`, `drawTick`, `lay`, `refuse`) and `chime` stay synthesised.
- Per `AGENTS.md`: put idle-CPU numbers in commits that touch the audio lifecycle; remove temporary console logs.

## Review Focus

- First frame, before the eye is set: nothing is seen, so every sound is silent (no throw, no NaN pan).
- A clip that fails to fetch or decode: the synthesised version plays, once, with no retry loop.
- Muted or tab hidden while clips are still decoding: nothing plays, nothing wakes the context.
- Zooming across the audibility threshold while a train runs: the engine loop's level glides (no click) and drops to 0 so the context can sleep.
- A lift or crane working out of sight: no sound, and the lift's "heard riding" bookkeeping in `main.ts` doesn't leave a stale entry.

---

### Task 1: The hearing module

**Files:**
- Create: `src/audio/hearing.ts`
- Test: `src/audio/hearing.test.ts`

**Interfaces:**
- Produces:
  - `export type SoundKind = "car" | "crane" | "crossing" | "lift" | "sawmill" | "station"`
  - `export const SOUND_SIZE_MM: Record<SoundKind, number>` (the world size of each kind; start with `car` 60, `crane` 120, `crossing` 80, `lift` 150, `sawmill` 120, `station` 150: confirm against the models and adjust).
  - `export const HEAR_PX = { silent: 4, clear: 14 } as const` (starting values, tuned by ear: under `silent` px a source is inaudible, at `clear` px and over it is full volume).
  - `export function audibility(px: number): number`: 0 at or under `HEAR_PX.silent`, 1 at or over `HEAR_PX.clear`, linear between.
  - `export function hear(eye: Pick<AmbientEye, "sees" | "pixels">, kind: SoundKind, x: number, y: number, z: number): number`: 0 when the source is off screen (use `eye.sees(x, y, z, size, 0, size * 2)` as the on-screen test, so a source just past the edge still counts), else `audibility(eye.pixels(x, y, z, SOUND_SIZE_MM[kind]))`.

- [ ] **Step 1: Write the failing tests** in `hearing.test.ts`: `audibility(0) === 0`, `audibility(HEAR_PX.silent) === 0`, `audibility(HEAR_PX.clear) === 1`, `audibility(100) === 1`, the midpoint of the two thresholds gives 0.5; `hear` with a real `AmbientEye` (copy `eyeAt` from `src/render/ambient.test.ts`): a car at the origin seen from 400 mm is 1, from 8000 mm is 0, a car 3000 mm off to the side from 400 mm is 0, and an unset `new AmbientEye()` gives 0.
- [ ] **Step 2: Run** `npx vitest run src/audio/hearing.test.ts`; expect FAIL (module missing).
- [ ] **Step 3: Implement `hearing.ts`** as specified above.
- [ ] **Step 4: Run it again**; expect PASS. Run `npm run typecheck`.
- [ ] **Step 5: Commit** `Sound: how audible a source is, from its size on screen`.

### Task 2: `listen` follows what's seen

**Files:**
- Modify: `src/game/game.ts` (expose the eye: `get eye(): AmbientEye` returning `this.ambientEye`, near line 1827)
- Modify: `src/main.ts` (`listen` at ~6815 and its call sites at ~6826, 7164, 7177, 7182, 7193, 7203, 7212, 7222)
- Modify: `src/audio/crossing-bell.ts` and `crossing-bell.test.ts`

**Interfaces:**
- Consumes: `hear`, `SoundKind` from Task 1.
- Produces: `listen(kind: SoundKind, x: number, z: number): [number, number]` in `main.ts` (volume from `hear(game.eye, kind, x, groundY, z)`, with `groundY` 0; pan unchanged: screen-x from the camera's right vector over 900, clamped by `knock`).

- [ ] **Step 1: Update the crossing-bell test first.** `CROSSING_BELL_MIN_VOLUME` becomes 0.3 of `hear`'s volume (unchanged value, new meaning); the test's `near`/`hear` stubs stay valid, so it should still pass. Add a case: a crossing whose `hear` returns `[0, 0]` doesn't ring and doesn't use the gap.
- [ ] **Step 2: Change `listen`** to the signature above. Call sites pass: `"car"` for joint, coupled, derailed and buffer events and the hum sum; `"crossing"` for the bell (and drop its separate on-screen projection test, since `hear` already returns 0 off screen); `"lift"` for the lift clunks and winding; `"crane"` for the economy clunk; `"sawmill"` for `saw`; `"station"` for `onGuardFlag`.
- [ ] **Step 3: Skip silent work.** In the event loop, `continue` when `v === 0` before calling `audio.clack` etc. (clack's `knock` already ignores volume ≤ 0.001, but `whistleFor` and the others shouldn't run for an unseen train). The hum sum adds only audible trains.
- [ ] **Step 4: Lift bookkeeping.** Keep `liftsHeard` set as today whether or not the lift is audible; a silent `liftClunk(0, pan)` is a no-op in `knock`, so no stale entry arises. Add a short comment saying so.
- [ ] **Step 5: Run** `npm run typecheck && npx vitest run src/audio` and `npm test`; expect PASS.
- [ ] **Step 6: By ear and numbers.** `npm run dev`, play on a phone-sized window: zoomed in, trains clack as before; zoomed out, they go quiet then silent; pan still follows the screen. Tune `HEAR_PX` and `SOUND_SIZE_MM` with the user. Then `npm run build && node tools/perf/idle-cpu.mjs` (0.00% audio threads, a `suspended@…` entry).
- [ ] **Step 7: Commit** `Sound: what's heard follows what's on screen` with the idle-CPU numbers.

### Task 3: The clip bank

**Files:**
- Create: `src/audio/clips.ts`
- Test: `src/audio/clips.test.ts`
- Modify: `src/audio/audio.ts` (own one `ClipBank`; start loading in the first-gesture handler of the constructor)

**Interfaces:**
- Produces:
  - `export type ClipName`: a string-literal union of the clip names (Task 5 fixes the list: `"clack1"`, `"clack2"`, `"clack3"`, `"magnet"`, `"bump"`, `"crash"`, `"clunk"`, `"switch"`, `"liftClunk"`, `"saw"`, `"whistle"`, `"guardWhistle"`, `"bell"`, `"crossingBell"`, `"engineLoop"`).
  - `export const CLIP_FILES: Record<ClipName, string>`: file name in `public/sounds/` (use `import.meta.env.BASE_URL` for the base so the artifact and itch builds, which use relative bases, resolve them).
  - `export class ClipBank { constructor(fetchFn?: typeof fetch); load(ctx: BaseAudioContext): void; get(name: ClipName): AudioBuffer | null }`: `load` starts fetching and decoding every clip once (a second call does nothing); a clip that fails to fetch or decode stays `null` for good (no retry); `get` is a map lookup.

- [ ] **Step 1: Write failing tests** with a fake `fetch` returning `ArrayBuffer`s and a fake context whose `decodeAudioData` resolves a marker buffer: `get` is null before load; becomes the buffer after load resolves; a 404 or a rejecting decode leaves null and does not throw or retry (fetch called once per clip); calling `load` twice fetches once.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement `ClipBank`.** `load` is fire-and-forget (`void`), each clip independent, errors swallowed into the null state (no thrown errors for control flow).
- [ ] **Step 4: Wire into `ToyAudio`**: `private clips = new ClipBank()`; in the `gesture` handler, once the context exists and the page isn't hidden or muted, call `clips.load(ctx)`. Add `private playClip(name: ClipName, volume: number, pan: number, rate = 1): boolean` returning false when the clip is null, muted, or `volume <= 0.001`; otherwise `wake(buffer.duration * 1000)`, plays through a pan node to the master, and returns true.
- [ ] **Step 5: Extend `sleep.test.ts`'s fake** so the existing tests still pass (`decodeAudioData` stub); add a test that muted or hidden at gesture time starts no fetch. Run `npx vitest run src/audio`; expect PASS.
- [ ] **Step 6: Commit** `Sound: a bank of clips loaded after the first tap`.

### Task 4: The engine loop replaces the hum

**Files:**
- Modify: `src/audio/audio.ts` (`setHum`)
- Test: `src/audio/engine-loop.test.ts`

**Interfaces:**
- Consumes: `ClipBank.get("engineLoop")`, `playClip`'s node graph from Task 3.
- Produces: `setHum(level: number)` unchanged in signature; with the clip loaded it drives one looping `AudioBufferSourceNode` (`loop = true`) through a gain, `playbackRate` = `0.8 + 0.5 * min(1, level)` and gain = `min(1, level) * 0.12` (starting values, tuned by ear), glided with `setTargetAtTime` (time constant 0.15 s as now). Without the clip it builds the current sawtooth.

- [ ] **Step 1: Write failing tests** (stubbed context with a loaded fake buffer): `setHum(0)` first builds nothing; `setHum(0.5)` then `setHum(0.5)` creates exactly one source; `setHum(0)` after running sets the target gain to 0 and lets the context sleep (`IDLE_SUSPEND_MS` later `suspend` called); muted: nothing built; with no clip loaded, the sawtooth path is taken.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement.** Keep the early-return conditions (unchanged level, `!hum && target === 0`). The loop source keeps running at gain 0 only while `humLevel > 0`; when level returns to 0, ramp the gain to 0 and stop the source after the ramp, so nothing holds the context awake. The sleep timer's "held" test stays `humLevel > 0`.
- [ ] **Step 4: Run** `npx vitest run src/audio`; expect PASS.
- [ ] **Step 5: Idle check** (`node tools/perf/idle-cpu.mjs`) and by ear on a phone once Task 5's engine clip is in; commit `Sound: a recorded engine loop instead of the buzzing hum` with numbers.

### Task 5: Source the clips (needs the user)

**Files:**
- Create: `docs/sound-credits.md`, `public/sounds/*` (after approval)

- [ ] **Step 1: Find candidates** for each `ClipName` on CC0-filtered libraries (freesound.org with the CC0 licence filter, Kenney's audio packs): short, mono-friendly, dry. For each, note the source page URL, author, licence as shown, duration and size. Aim at 200–400 KB in total once compressed.
- [ ] **Step 2: Show the user the list** (name, source link, what it sounds like) and wait for their yes per clip or for the whole list. Download nothing before that.
- [ ] **Step 3: After approval,** download into a scratch directory, trim and convert to mono AAC `.m4a` (or MP3) with `ffmpeg`, normalise levels so clips sit together, write them to `public/sounds/` under the `CLIP_FILES` names, and fill `docs/sound-credits.md` (clip, source URL, author, licence, date checked).
- [ ] **Step 4: Check the builds carry them:** `npm run build` and `npm run build:artifact` list the files in `dist` and `dist-artifact/files.json`; `npm run build:itch` zip includes `sounds/`.
- [ ] **Step 5: Commit** `Sound: the recorded clips and their credits`.

### Task 6: One-shots play clips

**Files:**
- Modify: `src/audio/audio.ts`
- Test: `src/audio/clips-play.test.ts`

**Interfaces:**
- Consumes: `playClip(name, volume, pan, rate)` from Task 3.
- Produces: no new public methods. Each of these now tries a clip first and falls back to its present synthesis when `playClip` returns false: `clack` (random of `clack1`–`clack3`; keeps its 18 ms limit), `magnet`, `bump` (keeps its 450 ms limit), `crash` (one clip, in place of its five staggered knocks), `clunk`, `switchClunk` (`switch`), `liftClunk`, `saw`, `whistle` (keeps its 0.6 s / 1.4× rule; the fade-out acts on the clip's gain), `guardWhistle` (keeps its gap), `bell`, `crossingBell`. Pitch spread: `rate = vary(1)` for one-shots.

- [ ] **Step 1: Write failing tests** with a loaded fake bank: each method calls `createBufferSource` once and not `createOscillator`; with the bank empty, it takes the old path (an oscillator or knock is created); `clack` called twice within 18 ms plays one; `guardWhistle` twice within `GUARD_WHISTLE_GAP_MS` plays one; `whistle`'s louder-replaces rule still holds with a clip.
- [ ] **Step 2: Run**; expect FAIL.
- [ ] **Step 3: Implement** the clip-first branch in each method, leaving every limiter, gate and `wake()` call where it is.
- [ ] **Step 4: Run** `npx vitest run src/audio` and `npm test`; expect PASS.
- [ ] **Step 5: Final checks.** `npm run build`, `node tools/perf/idle-cpu.mjs`, `npm run perf:check` (bundle, memory); by ear on a phone: loudness against the engine loop, busyness on a full map. Update `docs/agents/sound.md` (sections 1, 2, 4, 5: recorded clips, the hearing rule, branch state) in the same commit.
- [ ] **Step 6: Commit** `Sound: recordings for the trains and the world` with the numbers.

---

## Self-review

- **Spec coverage:** phase 1 → Tasks 1–2; phase 2 → Task 4 (with the bank from Task 3); phase 3 and sourcing, loading, format, credits → Tasks 3, 5, 6; testing and idle numbers are in each task; "left to the builder" items (thresholds, format, manifest shape) are starting values here, named as tunable.
- **Type consistency:** `SoundKind`, `hear`, `listen(kind, x, z)`, `ClipName`, `ClipBank`, `playClip` are used with the same names throughout.
- **Open for the user:** Task 5 stops for their approval of the clip list; Tasks 2 and 4 need their ear for thresholds and the loop's level.
