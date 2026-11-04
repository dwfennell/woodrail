# itch.io builds

The game is on itch.io as well as GitHub Pages. GitHub Pages deploys every push to `main`. itch gets only releases
(pushes to the `itch` branch, or GitHub releases), so it's the steadier version.

## Releasing

1. Pick a commit on `main` that's been played on GitHub Pages for a while. Run `npm run fuzz:long` on it (the release
   check in `AGENTS.md`).
2. Move the `itch` branch to it:
   ```sh
   git push origin main:itch        # or <commit>:itch
   ```
   (or merge a PR from `main` into `itch` on GitHub). `itch` only ever moves forward along `main`: what's pushed there
   ships.
3. The **Release to itch.io** workflow (`.github/workflows/release-itch.yml`) runs the tests, builds with
   `npm run build:itch` and pushes `dist-itch/` with butler to the `html5` channel. The version is the latest `vX.Y.Z`
   tag with the patch bumped (v1.1.0 → v1.1.1); once it's on itch, the workflow tags the commit and publishes a GitHub
   release with generated notes. A commit that already has a version tag keeps it. A failed run tags nothing.

For a bigger step (v1.2.0, v2.0.0): **Releases → Draft a new release** on GitHub, tag it at the commit, write what
changed and publish. That runs the same workflow, and the next push to `itch` counts on from that tag.

To push a tag or commit again without a new release: **Actions → Release to itch.io → Run workflow**, and give it the
ref.

## One-time setup

1. On itch.io, create the project: kind **HTML**, upload `woodrail-itch.zip` from `npm run build:itch` once, and tick
   "This file will be played in the browser". Embed options: **Click to launch in fullscreen**, **Mobile friendly**,
   **Fullscreen button**. Leave **SharedArrayBuffer support** off.
2. Make an itch.io API key: **Settings → API keys → Generate new API key**.
3. In the GitHub repo, **Settings → Secrets and variables → Actions**:
   - a secret `BUTLER_API_KEY`: the API key;
   - a variable `ITCH_GAME`: `user/game` from the project's URL (`https://user.itch.io/game`).
4. Release (above). The first butler push makes an `html5` channel. On the project's edit page, mark that
   upload as played in the browser and delete the hand-uploaded zip.

The page's cover, screenshots, banner and embed background are in `itch-assets/` (screenshots under itch's 3 MB limit).

## How the build differs

- **Relative paths** (`--base=./`): itch serves the game from a hashed path in an iframe on `html-classic.itch.zone`.
- **No update check**: no `version.json`, and the "New version" chip is stripped. A player gets the new build on reload.
- **No cloud saves**: the Worker's CORS list would have to include `html-classic.itch.zone`, which every HTML game on
  itch shares. Saves are local to the browser, and separate from saves on GitHub Pages.
- **Play stats** go to the cloud Worker, if `WOODRAIL_CLOUD_URL` is set (`VITE_STATS_URL`; see `docs/stats.md`).
- **Models stay `.glb`**: itch serves any file type, so nothing is renamed as in the artifact build.

To check a build locally: `npx vite preview --outDir dist-itch`.
