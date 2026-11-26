# Recorded sound and what's heard at a distance — design

Status: draft for approval. Playbook for today's system: `docs/agents/sound.md`.

## Intent and why

The player finds the game's sound unpleasant in two specific ways:

1. **The buzzing synthesised tones**, mainly the motor hum (`ToyAudio.setHum`: a 92 Hz sawtooth with vibrato, lowpassed),
   a constant drone while trains run. Nearly every other sound is the same noise-plus-sine "knock", so it all sounds thin
   and samey.
2. **Zoomed out, everything blends together.** `listen()` in `main.ts` lowers volume with distance but never silences
   anything, and distance counts the camera's height only 0.35×. Every joint clack of every train on the map still plays.

The aim is a toy railway that sounds like one: real wooden recordings and a soft engine sound, with the soundscape
following what the player can actually see.

## Goals

- Zoomed out far enough that a thing is too small to see well, its sound goes quiet and then silent. Close in, it's clear.
- The hum no longer buzzes: a soft recorded engine sound whose pace and level follow the trains' speed.
- Train and world sounds (clacks, couplings, crashes, crane clunks, switch throws, whistles, bells) become CC0 recordings.
- Each phase can be judged by ear on a phone by itself.

## Non-goals

- Music (none exists; not part of this).
- Every sound recorded: the small UI ticks (tap, pickup, putdown, snap, rotate, draw tick, lay, refuse) and the
  milestone chime stay synthesised for now.
- New sounds, ambience, or a new mixer. Per-cargo crane sounds, coin clinks, ranked tunes, a volume slider and a voice cap
  exist on unmerged branches (`sound-goods`, `sound-cues`, `sound-mixer`); they're a separate decision.

## Anti-goals (a failure even if it technically works)

- Anything that makes the idle game cost more: audio must stay at 0.00% CPU with a suspended context when nothing plays.
- A large download or heap cost on a phone (budgets below).
- A recording whose licence can't be shown. Every clip's source, author and CC0 status are recorded.
- Audio that fails silently when a clip hasn't loaded: the synthesised sound plays instead.

## Constraints

- Phone first. Memory is a budget (`docs/agents/perf.md`); `perf:check` includes a bundle size.
- The sleep/wake lifecycle (`wake()`, `IDLE_SUSPEND_MS`), `Gate` rate limits and mute stay as they are.
- iOS: the context starts in a gesture; clips are fetched and decoded only after that first gesture, so nothing is
  fetched for a player who never taps.
- Builds: the web build, the artifact build (media files are allowed; `docs/artifact-builds.md`) and the itch zip all
  have to carry the clips.
- Downloading each clip needs the user's OK (per the sourcing step below).

## Approaches considered

- **A. Fix only the two complaints, no recordings.** Cheap and fixes the blending for good, but the sounds stay
  synthesised and thin.
- **B. Recordings for trains and the world, in phases.** (Chosen.) The distance fix first, then the hum, then the
  one-shots, with synthesis kept for UI ticks and as a fallback.
- **C. Everything recorded at once.** Most consistent, but the largest change, and the UI ticks gain least from it.

Chosen: B, for an immediate fix to what's heard at a distance and the chance to judge each phase by ear.

## The design

### Phase 1 — what's heard follows what's seen

`listen(x, z)` becomes "how audible is a source here", from the same idea as `AmbientEye` (`src/render/ambient.ts`:
frustum and size in pixels):

- A source off screen is silent (a small margin so a sound doesn't cut as it crosses the edge).
- A source drawn too small to make out is silent; between that and a "clear" size, the volume ramps up. The source's
  size is the object's (a train car, a crane, a crossing).
- Pan follows screen x (as now); volume no longer depends on distance to the camera's focus.
- The size is one constant per kind of sound (a car, a crane, a crossing, a lift...), as `AMBIENT_MIN_PX` does per kind
  of motion, so callers pass a kind and the position (`listen(kind, x, z)`), not a measured size. The ramp is linear in
  pixels between "too small" and "clear", then applied to gain; tests pin the shape (0 off screen and when tiny, 1 when
  clear, rising between), not exact values.
- The thresholds are constants in one place, tuned by ear. Where they sit is for the builder to choose.
- Callers that loop (the hum's per-train sum, the clack per joint) cost one cheap test each, with no allocation.

The crossing bell's own "on screen and ≥ 0.3" test is replaced by this same rule.

### Phase 2 — the engine sound

A short recorded loop (a soft steam or electric idle, not a drone) replaces the sawtooth hum. It plays through one looping
`AudioBufferSourceNode` for all trains together (not one per train: a single voice follows the summed level, so no voice
cap is needed), whose `playbackRate` and gain follow the running trains' speed and audibility (the same sum
`setHum` takes today). It keeps the early-return when unchanged and counts as "held" for the sleep timer. One clip serves every kind of engine to start with; a second for electric engines can follow if the first sounds wrong on
them. Synthesis remains as the fallback until the clip has loaded.

### Phase 3 — one-shot recordings

Clips for: joint clack (a few variants, picked at random), coupling/magnet, buffer bump, crash, crane clunk, switch throw,
lift clunk, saw, engine whistle, guard whistle, departure bell and crossing bell. Each is decoded once to an
`AudioBuffer` and played through the existing pan/gain/gate path, with `vary()` pitch spread as now (`playbackRate`).
The sound methods keep their names; the ones heard at a distance take their sound kind through `listen` as in phase 1,
and that is the only change to `main.ts` call sites. A `Gate` is per sound, so a sound's clack variants share one limiter.

### Loading, format and credits

- The code is built and merged against the synthesised fallbacks first, so each phase works without any clip. The clips
  arrive when you've approved them (see Sourcing) and are then dropped in.
- A small manifest maps each sound to its clip files. The first user gesture starts the fetch and decode; each sound
  falls back to its synthesised version until its clip is ready, and for good if it fails to load.
- Mono, compressed, short; the whole set is 200–400 KB. Format (AAC `.m4a` or MP3) is the builder's call, chosen for
  `decodeAudioData` on iOS Safari.
- Clips live in `public/`. A credits file records for each clip its source URL, author, licence (CC0) and the date it
  was checked, in the repo. CC0 asks for nothing, so there is no in-game credits screen.

### Sourcing

I find candidates on CC0-filtered libraries (freesound.org, Kenney's packs and similar), and list them with source pages
for you to approve. Nothing is downloaded until you say yes to that list. Judging by ear is yours: you pick or reject
clips after hearing them in the game.

## Testing

- Phase 1: unit tests for the audibility function (off screen, tiny, ramp, clear); the crossing-bell test updated.
- Sound classes: the existing stubbed-`AudioContext` tests extended so a missing or failed clip falls back, and the
  context still sleeps when quiet.
- `node tools/perf/idle-cpu.mjs` before and after (audio threads at 0.00%, a `suspended@…` entry), the numbers in the
  commits. `npm run perf:check` for the bundle and memory budgets.
- By ear on a phone after each phase.

## Left to the builder

- Pixel thresholds and the ramp's shape (tune by ear).
- The audio format, the manifest's shape, how clips are named in `public/`.
- Whether the guard's whistle and the saw get clips in phase 3 or wait.
- Whether to bring across anything from `sound-mixer` (voice cap) if phase 3 makes it needed.

## Decisions that are mine, not yours

- UI ticks and the chime staying synthesised.
- Clips fetched after the first gesture rather than at load.
- One credits file in the repo, and no in-game credits screen.
- One global engine loop, one clip for all engines at first.
- The size of a source is a constant per sound kind, not measured per object.
- Code first against fallbacks; clips dropped in once approved.
