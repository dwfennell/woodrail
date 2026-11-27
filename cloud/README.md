# Woodrail cloud saves

A Cloudflare Worker over an R2 bucket. It keeps one copy of each mode's railway per sync code, so a player can carry on
on another device. The game's side of it is `src/persist/cloud.ts`, and its card is `src/ui/cloud-card.ts`.

## What it stores

| Request | What it does |
| --- | --- |
| `PUT /v1/saves/:mode` | Stores a bundle (the game gzips it). The copy it replaces may be kept as `:mode.prev` (below). |
| `GET /v1/saves/:mode` | Returns the bundle. With `?prev=1`, returns the earlier copy (`:mode.prev`). |
| `HEAD /v1/saves/:mode` | Returns the headers only: what's there, without the bytes. |
| `POST /v1/stats` | Anonymous play stats from players who said yes, into Analytics Engine (see `docs/stats.md`). Any origin. |
| `POST /feedback` | "Report a bug or give feedback": stored under `feedback/<id>/`, and a GitHub issue opened if `GITHUB_TOKEN` is set (see `docs/feedback.md`). |
| `GET /feedback/:id`, `/map`, `/shot.jpg` | A report, its map, its picture (the id is unguessable). |
| `GET /feedback` | The latest reports, with `Authorization: Bearer <ADMIN_KEY>`. |
| `POST /v1/snapshots` | A railway snapshot from a player who shares stats and their railway (see `docs/stats.md`). |
| `GET /v1/snapshots`, `/:id`, `/:id/:at` | The latest snapshots, one device's, one's map: with the admin key (`npm run snapshots`). |

- `:mode` is `sandbox` or `game`.
- **The sync code** goes in the `X-Woodrail-Code` header, never in the URL, so it stays out of logs. It's three words
  and four digits (`acorn-badge-otter-0420`, about 43 bits). R2 keys are `saves/<HMAC-SHA256(CODE_KEY, code)>/<mode>`,
  so the code itself is never stored, and the bucket's keys can't be checked against guessed codes without the
  Worker's secret.
- **Metadata** goes in the headers `X-Saved-At` (ms), `X-Save-Version` (the save format) and `X-Game-Version` (the
  build). The Worker keeps them beside the bundle and returns them on GET and HEAD, with `X-Stored-At`, when it
  stored the bundle by its own clock. Every response carries `X-Server-Now`, so a game compares edits by the Worker's
  clock rather than another device's.

- **The earlier copy** (`:mode.prev`) is the railway as it was before the player last sat down to play. A PUT moves
  the copy it replaces there only if that copy had rested 10 minutes (`PREV_REST_MS`), or there's no earlier copy yet,
  or the PUT asks with `X-Keep-Prev: 1` (the game does after a restore, so going back can be undone). Moved on every
  PUT, it would be the copy from 30 s before, nearly the same. The game offers it on the Cloud save card ("Earlier
  copy online").

### Limits

- **Size:** 2 MB per bundle, or the request gets a 413. A big railway gzips to well under 200 KB.
- **Rate:** one PUT per code and mode every 10 s, or the request gets a 429. The game sends at most every 30 s, and
  when its page hides.
- **Guessing codes:** every lookup under a code (GET, HEAD, PUT) is counted per IP by the `CODE_LIMIT` rate-limit
  binding (`wrangler.toml`: 120 a minute). One that finds nothing (a wrong code, or a new code's first copy) costs 5
  more (`MISS_COST`), so a page guessing codes gets about 20 tries a minute, while a player's game, which nearly always
  finds its own, never comes near it. Past the limit a lookup gets a 429 before anything is looked up, so it says
  nothing about the code. The binding is free on Workers (as `FEEDBACK_LIMIT`), counted per Cloudflare location, and
  not exact. `127.0.0.1` and `::1` (`wrangler dev`, the e2e) aren't counted.
- **CORS:** only the pages listed in `ALLOWED_ORIGINS` in `wrangler.toml` (the game on GitHub Pages, and on itch.io:
  `https://html-classic.itch.zone`, where itch serves every HTML game), plus `http://localhost` and
  `http://127.0.0.1` on any port. A page from any other origin gets a 403. CORS guards pages only: the code is the key.
- **No overwriting unseen:** a PUT names the copy it was made from (`X-Base-Saved-At`), and R2 stores it only if that
  copy is still there (`onlyIf` its etag), and the first PUT under a code only if there's still nothing (`onlyIf`
  `etagDoesNotMatch: "*"`). If another device's copy got in first, the PUT gets a 409.

## Develop and test

```sh
cd cloud
npm ci
npm test          # the Worker's tests, in the Workers runtime (Miniflare)
npm run typecheck
npm run dev       # wrangler dev --local on :8787, R2 kept in .wrangler/, with a local-only CODE_KEY
```

From the repo root, `npm run e2e:cloud` runs two browser devices against a local Worker. It needs `npm --prefix cloud
ci` first. To play against the local Worker, start the dev server with `VITE_CLOUD_URL=http://localhost:8787 npm run
dev`.

## Deploy

Once it's set up, a push to `main` that changes `cloud/` deploys the Worker: **Deploy cloud Worker**
(`.github/workflows/deploy-worker.yml`) runs the typecheck and tests, `wrangler deploy`, and checks it answers. To deploy
without a change: **Actions → Deploy cloud Worker → Run workflow**. A deploy leaves the secrets alone; setting
or changing one is still by hand (`npx wrangler secret put …`).

For CI, once: make a second API token, from the "Create Custom Token" button, with only **Account → Workers Scripts:
Edit** on the account. In the GitHub repo, **Settings → Secrets and variables → Actions**, add it as the secret
`CLOUDFLARE_API_TOKEN`, and the account ID (dash.cloudflare.com → Workers & Pages, on the right) as the variable
`CLOUDFLARE_ACCOUNT_ID`. CI never needs R2 or Analytics rights: the bucket and dataset already exist.

### First setup (by hand)

These are the steps to run once:

1. Make an API token at dash.cloudflare.com → My Profile → API Tokens, from the "Edit Cloudflare Workers" template,
   with R2 edit rights added. Then:
   ```sh
   cd cloud && npm ci
   export CLOUDFLARE_API_TOKEN=…   # and CLOUDFLARE_ACCOUNT_ID=… if the token can see several accounts
   ```
2. Create the bucket and the code key (any long random string; keep it, since changing it orphans every save):
   ```sh
   npx wrangler r2 bucket create woodrail-saves
   openssl rand -hex 32 | npx wrangler secret put CODE_KEY
   ```
3. Check `ALLOWED_ORIGINS` in `wrangler.toml`. It must include the game's origins: `https://dwfennell.github.io` for
   GitHub Pages and `https://html-classic.itch.zone` for itch.io (an origin has no path).
4. Deploy the Worker, and note the URL it prints (`https://woodrail-cloud.<subdomain>.workers.dev`):
   ```sh
   npx wrangler deploy
   ```
5. Check it answers. This should print `400`, because no code was sent:
   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://woodrail-cloud.<subdomain>.workers.dev/v1/saves/sandbox
   ```
6. Give the game the URL. In the GitHub repo, go to Settings → Secrets and variables → Actions → Variables, and add
   `WOODRAIL_CLOUD_URL` set to that URL. The Pages workflow builds with it as `VITE_CLOUD_URL`, and the next deploy of
   the game shows Cloud save in the menu. While the variable is unset, the game has no Cloud save. The claude.ai
   artifact build (`npm run build:artifact`) never has it. The same variable turns on cloud saves in itch releases
   (`docs/itch-builds.md`), and play stats ("Help improve Woodrail", `docs/stats.md`) in both.
7. Feedback (optional; see `docs/feedback.md` for the token): `npx wrangler secret put GITHUB_TOKEN` (a fine-grained
   token, Issues: Read and write on `dwfennell/woodrail` only) and `npx wrangler secret put ADMIN_KEY`, then deploy
   again. Without them, reports are stored and nothing more.
8. Check the stats endpoint. This should print `204`, and a minute or so later `npm run stats` (with an API token
   that has Account Analytics: Read) shows one `start` from a `local` host. If the deploy said Analytics Engine isn't
   enabled, turn it on at dash.cloudflare.com → Workers & Pages → Analytics Engine, and deploy again.
   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' -X POST https://woodrail-cloud.<subdomain>.workers.dev/v1/stats \
     -d '{"id":"0000000000000000","build":"check","host":"local","device":"desktop","events":[{"e":"start","mode":"sandbox","fresh":false,"t":0}]}'
   ```

### Before it goes wide

These limits aren't in v1:
- A rate limit on `POST /v1/stats`. Anyone can send made-up stats today (each batch is capped at 16 KB and 50
  events); it costs only noise in the numbers.
- A tighter limit on PUTs under codes with nothing saved yet. A fresh code's first PUT now counts as a miss
  (`CODE_LIMIT`), so about 20 new codes a minute per IP, of 2 MB each at most.

### Known limits (the game's side)

- **Two devices running at once earn twice.** In Game mode, two devices running the same railway with both in view
  both deliver, and their earnings are added together when they sync. A hidden or paused one earns nothing (the sim,
  the workshop and the harbour boats all run on game time). Running both at once is rare, so this is accepted for now.
- **Spending more than both had** (both sides spend the same coins before they sync) leaves coins at 0, not below.
- **Up to one autosave of earnings** (about 5 s) can be lost when a copy is merged or taken.

To undo, delete the variable, so the menu item goes with the next deploy. Then, if you want, run `npx wrangler delete`
and `npx wrangler r2 bucket delete woodrail-saves`.

## Credits

The sync code's words are from the EFF's short word list 1 (<https://www.eff.org/dice>), used under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/) and cut to 1024 words fit to give a child
(`src/persist/code-words.ts`). The game's Cloud save card credits it too.
