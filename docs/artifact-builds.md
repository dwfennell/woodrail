# Artifact builds

A playable build of any branch can be published as a private claude.ai Artifact, for trying it on a phone or sharing
a preview without touching GitHub Pages, which deploys only `main`.

## Steps

1. Check out the branch, and run `npm ci`.
2. Run `npm run build:artifact`. It builds into `dist-artifact/` (git-ignored) and writes `dist-artifact/files.json`.
3. Publish with the Artifact tool:
   - `file_path`: `dist-artifact/index.html`.
   - `files`: the map in `dist-artifact/files.json` (published path → file on disk).
   - `icon`: `train` (first publish only).
   - `label`: the branch and commit, e.g. `roads 0d611a9`.
4. To update the same artifact later, publish `dist-artifact/index.html` again from the same session. From another
   session, pass the artifact's URL as `url` (read it first).

The artifact is named by the page's `<title>`, "Woodrail". The `title` parameter doesn't override it, so tell builds
apart by their label and description.

## Why a separate build

- **Relative paths.** The page is served from the artifact's own path, so it's built with `--base=./`.
- **Models.** Artifacts serve only standard web file types: pages, scripts (`.js`, `.wasm`), styles, data, images,
  fonts and media. `.glb` isn't one of them, and a publish with a `.glb` file in it is refused. The game only ever
  fetches its models as raw bytes, so the script publishes them as `models/<set>.glb.wasm` and points the built
  loader at those names. The repo's source and the normal `npm run build` are unchanged.
- **No update check.** The normal build writes `version.json` and the game polls it for a newer deploy ("New version ·
  Update" chip). The artifact build sets `WOODRAIL_NO_UPDATE_CHECK`, so `__UPDATE_CHECK__` is false (the check is
  stripped from the bundle) and it deletes `version.json`.
- **Size.** A build is about 17 files and 11 MB, well within an artifact's limits (64 MB and 255 files a publish).

## Checking a build before publishing

`npx vite preview --outDir dist-artifact` serves it locally. The game should reach the title screen with its models
loaded.
