# Woodrail — notes for agents

A Brio-style wooden railway game: TypeScript, Three.js, Vite, Rapier physics. It runs on phones, so keep CPU and GPU cost in mind.

## Commands

- `npm run dev`: dev server
- `npm test`: unit tests (Vitest)
- `npm run typecheck`
- `npm run build`
- `npm run build:artifact`: a build to publish as a claude.ai Artifact (see `docs/artifact-builds.md`)
- `npm run e2e:roads`: end-to-end road tests in a headless browser
- `npm run e2e:kits [-- <out> [groups]]`: end-to-end track props (kits, lineside furniture) in Sandbox, headless (about 12 min)
- `npm run e2e:research [-- <out>]`: end-to-end Research picker and pill on a 390×844 phone, headless (about 3 min)

Designs and plans are in `docs/superpowers/specs` and `docs/superpowers/plans`.

## Performance: don't recompute what hasn't changed

The game should cost close to nothing when nothing is happening, and only pay for what changed when something does.

- **Render on change.** Draw a frame only when something visible changed: the camera moved, a train or animation is running, or `invalidate()` was called. Don't add work that runs every frame unconditionally.
- **Shadows** redraw only when a shadow caster moves (`moveShadows()`), something changes (`invalidate()`), or the shadow frustum refits. A camera move alone doesn't redraw them.
- **Rebuild incrementally.** When one thing changes, rebuild only the meshes, colliders or data it affects, not the whole map. For example, `HillCutsView` rebuilds only blocks whose cuts changed; the map-wide core and shadow mesh are rebuilt only when the set of cut blocks changes.
- **Key caches by their inputs.** Skip work when the inputs are the same as last time, such as a key built from the pose, or a signature of what's cut. Cache derived data per map (as `hillsOf(grid)` does).
- **Pointer moves are hot paths.** Code called on every pointer move while dragging (placement checks, previews) should be cheap and bounded. Time it, with a target of a few milliseconds on a phone.
- **Measure before and after** a performance change: idle CPU, frame time, the time of the operation itself. Note the numbers in the commit.
