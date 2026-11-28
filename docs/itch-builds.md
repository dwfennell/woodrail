# itch.io builds

The game is on itch.io as well as GitHub Pages. GitHub Pages deploys every push to `main`. itch gets only releases
(pushes to the `itch` branch, or GitHub releases), so it's the steadier version.

## Releasing

Agents: use the `/publish-to-itch` skill (`.claude/skills/publish-to-itch/SKILL.md`). It runs the checks below, writes the
release's devlog post (`docs/devlogs/vX.Y.Z.md`) and hands it to the user to post on itch.

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

The page's cover, screenshots, banner and embed background are in `itch-assets/` (screenshots under itch's 3 MB limit). The embed background (`embed-bg.jpg`, the starter line with the World's Fair wheel and the airship) is made by `tools/shots/embed-bg.mjs`; its header has the command.

## How the build differs

- **Relative paths** (`--base=./`): itch serves the game from a hashed path in an iframe on `html-classic.itch.zone`.
- **No update check**: no `version.json`, and the "New version" chip is stripped. A player gets the new build on reload.
- **Cloud saves, with the code to the fore** (see "Cloud saves" below).
- **Play stats** go to the cloud Worker, if `WOODRAIL_CLOUD_URL` is set (`VITE_STATS_URL`; see `docs/stats.md`).
- **No home-screen app**: the manifest, icons and iPhone tags (`scripts/home-screen.mjs`) are for the GitHub Pages
  copy only. On itch the game is in a frame on another site, so Add to Home Screen would save itch's page. (An iPhone
  has no fullscreen for a page, in or out of the frame; itch's "Click to launch in fullscreen" only fills the page.)
- **Models stay `.glb`**: itch serves any file type, so nothing is renamed as in the artifact build.

To check a build locally: `npx vite preview --outDir dist-itch`.

## Cloud saves

The itch build has cloud saves when the release workflow's `WOODRAIL_CLOUD_URL` is set (`VITE_CLOUD_URL`; the same
Worker as GitHub Pages, `cloud/README.md`), and knows it's on itch (`VITE_ITCH=1`, set by `scripts/itch-build.mjs`).
The Worker takes saves from `https://html-classic.itch.zone`, the origin itch serves every HTML game from (the game's
page puts it in a frame: `https://html-classic.itch.zone/html/<upload id>/index.html`).

**Why it matters more here.** On an iPhone or iPad every browser is WebKit, and WebKit gives a page in another site's
frame storage of its own that doesn't last: the owner's games on itch were gone at every reload (2026-11-26). The
local save goes, and the sync code with it. So on itch:

- When cloud saves come on by themselves (the first piece laid), a toast says so with the code, as on every build.
- The Cloud save card leads with the code (Copy, and Share on a phone) and says to keep it. Where the browser may
  forget it (`src/persist/storage-life.ts`: in another site's frame, on iOS or Safari), it says so in red: "Write this
  code down!".
- There, the title screen says plainly that itch.io forgets the railway, and makes **☁ Load with a code** its main
  button: a returning player taps it, types the code, and taps Load (`npm run e2e:cloud`, group `itch`).

**Shared storage.** Every itch game is served from `html-classic.itch.zone`, and on a desktop browser they all share one
storage partition (the top-level site, itch.io), so another itch game could read the code from localStorage. The itch
build makes its own code and never suggests reusing the GitHub Pages one; the code entry says, on itch, that other
games can read what the page keeps, and to use a code just for there. Guessing codes is limited at the Worker
(`CODE_LIMIT`, per IP).

**The earlier copy.** The device keeps the other railway after a conflict ("Bring back the other railway"), but on an
iPhone in itch's frame that goes with the rest. The cloud keeps its own earlier copy, the railway as it was before the
player last sat down to play, offered on the card as "Earlier copy online" (`cloud/README.md`).

**Order of a release.** The Worker must take itch's origin before an itch build with cloud saves goes out: merge the
`cloud/` change to main (which deploys the Worker) first. Until then an itch build's uploads get a 403 and stay "Saving
online…", and the railway is kept on the device as before.
