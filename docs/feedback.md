# Report a bug or give feedback

A player's report from inside the game, with their map, sent to the cloud Worker, which keeps it and opens a GitHub
issue for it.

## What the player sees

☰ → **Report a bug or give feedback** (above **Copy map for a bug report**, which stays). A sheet:

- **🐞 Bug / 💡 Idea** chips.
- A note (Send is off until there's one).
- **Include a picture of the game**, on by default. One frame is drawn as the sheet opens (the sheet isn't in it),
  with a small preview. It's sent as a JPEG of at most 1280 px on its long side and about 300 KB.
- **Include my map**. Always on for a bug ("A bug always sends your map, so we can play it and see what went wrong");
  optional for an idea.
- One line on what's sent: "Sends only your note, map, picture, game version, browser and screen size, as a public
  GitHub issue."
- **Send**. Then **✓ Sent. Thank you!**, or, if it fails, why ("Couldn't reach the server. Are you online?", "Too
  many reports just now…") and **Copy instead**: the note, the device line and the map on the clipboard (the same
  `woodrail-map:1:…` text as Copy map), to paste to us by hand.

The item shows only in a build with a Worker to send to: `VITE_FEEDBACK_URL`, else `VITE_STATS_URL`, else
`VITE_CLOUD_URL`. So the GitHub Pages build has it once `WOODRAIL_CLOUD_URL` is set, and itch releases have it
through their `VITE_STATS_URL`. The artifact build has it only if `VITE_FEEDBACK_URL` is set when it's built (and the
claude.ai page may not be allowed to reach the Worker; it has "Send to Claude" instead).

## What's sent

`POST /feedback` (JSON; the game's side is `src/feedback/feedback.ts`, the sheet `src/ui/feedback-sheet.ts`):

| Field | Holds |
| --- | --- |
| `kind` | `bug` or `idea` |
| `text` | the note (4000 characters at most) |
| `map` | the Copy map text, `woodrail-map:1:…` (the mode's saved keys, save v15+), or null for an idea without it |
| `shot` | the picture, base64 JPEG, or null |
| `mode` | `sandbox` or `game` |
| `build` | the build id (`dev` in a dev server) |
| `userAgent` | the browser's user agent |
| `viewport` | `{ width, height, dpr }` |
| `badges` | the last few dev invariant breaks (dev builds only) and errors the game logged, cut short |

Nothing else: no sync code, no stats id, no IP address kept (the IP is used only by the per-minute rate limiter). A
whole report is capped at 2 MB; if the picture would push it over, it's left out (and the sheet says so).

## Where it goes

The Worker (`cloud/src/feedback.ts`):

- Stores it in the R2 bucket it already has (`SAVES`, `woodrail-saves`) under an id like
  `20261102T101010-<32 hex>` (a time and 128 random bits, so unguessable):
  `feedback/<id>/report.json`, `feedback/<id>/map.txt`, `feedback/<id>/shot.jpg`, and an index entry for the admin
  list.
- If the secret `GITHUB_TOKEN` and the var `GITHUB_REPO` (`dwfennell/woodrail` in `wrangler.toml`) are set, opens an
  issue there: title `[bug] <first line>` or `[idea] <first line>`, label `feedback`, and a body with the note (in a
  code fence, so it can't @mention anyone), the device, a link to the map (`GET /feedback/<id>/map`) and the picture
  (`GET /feedback/<id>/shot.jpg`, shown inline). At most 40 issues a day; past that, reports are only stored. If
  GitHub fails, the report is still stored, with why.
- With no token, it only stores. **`GET /feedback`** lists the latest 50, newest first, with
  `Authorization: Bearer <ADMIN_KEY>`.
- Limits: 2 MB a body (413); 5 reports a minute per IP (the `FEEDBACK_LIMIT` rate-limit binding; 429).
- CORS: the saves' `ALLOWED_ORIGINS` (GitHub Pages), localhost, and the game's other homes: itch.io's hosts
  (`*.itch.zone`, `*.hwcdn.net`, `*.itch.io`) and claude.ai's (`*.claudeusercontent.com`, `*.claude.ai`). Other pages
  get a 403. Saves keep their narrower list.

The repo is public, so issues, and the map and picture links in them, are public. The sheet says so.

## Reading a report

```sh
npm run feedback -- https://woodrail-cloud.<subdomain>.workers.dev/feedback/<id>/map   # the link from the issue
npm run replay -- feedback-<id>.txt
```

`npm run feedback` (`scripts/fetch-feedback.mjs`) writes the map to `feedback-<id>.txt` and the report beside it
(`.json`), and prints the note and device. With just an id it needs `--url <worker>` or `WOODRAIL_CLOUD_URL`. With no
token set (no issues), list them: `ADMIN_KEY=… npm run feedback -- --list --url <worker>`.

## Setting it up (the user does this; never put a token in the repo or in chat)

The Worker is deployed by hand (`cloud/README.md`), never from CI. Once it's deployed:

1. **The GitHub token.** github.com → Settings → Developer settings → Personal access tokens → **Fine-grained
   tokens** → Generate new token:
   - Resource owner: `dwfennell`; Repository access: **Only select repositories** → `dwfennell/woodrail`.
   - Repository permissions: **Issues: Read and write** (Metadata: Read-only comes with it). Nothing else.
   - An expiry you're happy with (renew it the same way).
2. **Give it to the Worker** (it's typed in, not stored anywhere else):
   ```sh
   cd cloud && npm ci
   export CLOUDFLARE_API_TOKEN=…        # as for the deploy (cloud/README.md)
   npx wrangler secret put GITHUB_TOKEN  # paste the token when asked
   openssl rand -hex 32                  # keep this somewhere safe: it's your admin key
   npx wrangler secret put ADMIN_KEY     # paste that key when asked
   ```
3. **Deploy** the Worker with the feedback endpoint (and its rate limiter):
   ```sh
   npx wrangler deploy
   ```
4. **Check it.** This should print `401` (no admin key) and then the (empty) list:
   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://woodrail-cloud.<subdomain>.workers.dev/feedback
   curl -s -H "Authorization: Bearer <your admin key>" https://woodrail-cloud.<subdomain>.workers.dev/feedback
   ```
5. **The game** needs no change if `WOODRAIL_CLOUD_URL` is already set (Settings → Secrets and variables → Actions →
   Variables): the next Pages deploy shows the menu item. Send one from the game: an issue labelled `feedback` should
   appear.

To stop issues, delete the secret (`npx wrangler secret delete GITHUB_TOKEN`): reports are then only stored. To drop the
whole thing, unset `WOODRAIL_CLOUD_URL` (that also turns off cloud saves and stats).

## Tests

- `npm test` (`src/feedback/feedback.test.ts`): the payload (the map always with a bug), the size cap (the picture
  dropped first), Copy instead's text, the picture's size, sending and its errors.
- `npm --prefix cloud test` (`cloud/test/feedback.test.ts`): the checks, storing and reading back, the issue with a
  mocked GitHub API (title, label, links, no token, GitHub failing, the day's cap), the size cap, the per-IP limit,
  CORS, and the admin list.
- `E2E_ONLY=feedback npm run e2e:touch` (390×844, touch) and `npm run e2e:click` (desktop, mouse): ☰ → the sheet,
  its 44 px targets, Idea and Bug, a send that fails and Copy instead, a send that's taken by a mocked Worker; the
  posted map loads (src/play/bugmap.ts) as the same railway, and the picture is a JPEG within 1280 px.
