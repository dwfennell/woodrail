# Woodrail cloud saves

A Cloudflare Worker over an R2 bucket. It keeps one copy of each mode's railway per sync code, so a player can carry on
on another device. The game's side of it is `src/persist/cloud.ts`, and its card is `src/ui/cloud-card.ts`.

## What it stores

| Request | What it does |
| --- | --- |
| `PUT /v1/saves/:mode` | Stores a bundle (the game gzips it). The copy it replaces is kept as `:mode.prev`. |
| `GET /v1/saves/:mode` | Returns the bundle. With `?prev=1`, returns the one before it. |
| `HEAD /v1/saves/:mode` | Returns the headers only: what's there, without the bytes. |

- `:mode` is `sandbox` or `game`.
- **The sync code** goes in the `X-Woodrail-Code` header, never in the URL, so it stays out of logs. It's three words
  and four digits (`acorn-badge-otter-0420`, about 43 bits). R2 keys are `saves/<HMAC-SHA256(CODE_KEY, code)>/<mode>`,
  so the code itself is never stored, and the bucket's keys can't be checked against guessed codes without the
  Worker's secret.
- **Metadata** goes in the headers `X-Saved-At` (ms), `X-Save-Version` (the save format) and `X-Game-Version` (the
  build). The Worker keeps them beside the bundle and returns them on GET and HEAD, with `X-Stored-At`, when it
  stored the bundle by its own clock. Every response carries `X-Server-Now`, so a game compares edits by the Worker's
  clock rather than another device's.

### Limits

- **Size:** 2 MB per bundle, or the request gets a 413. A big railway gzips to well under 200 KB.
- **Rate:** one PUT per code and mode every 10 s, or the request gets a 429. The game sends at most every 30 s, and
  when its page hides.
- **CORS:** only the pages listed in `ALLOWED_ORIGINS` in `wrangler.toml`, plus `http://localhost` and
  `http://127.0.0.1` on any port. A page from any other origin gets a 403.
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

## Deploy (by hand, once there's a token)

Nothing deploys the Worker from CI. These are the steps to run once:

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
3. Check `ALLOWED_ORIGINS` in `wrangler.toml`. It must include the game's origin, which is
   `https://dwfennell.github.io` for GitHub Pages (an origin has no path).
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
   artifact build (`npm run build:artifact`) never has it.

### Before it goes wide

These limits aren't in v1:
- Rate limits on HEAD and GET per client, against guessing codes. Use the Workers rate-limiting binding, or a WAF
  rule on the route.
- A tighter limit on PUTs under codes with nothing saved yet. Today anyone can store 2 MB under a fresh code every
  10 s.

### Known limits (the game's side)

- **Two devices running at once earn twice.** In Game mode, two devices running the same railway with both in view
  both deliver, and their earnings are added together when they sync. A hidden or paused one earns nothing (the sim,
  the workshop and the harbour boats all run on game time). Running both at once is rare, so this is accepted for now.
- **Spending more than both had** (both sides spend the same coins before they sync) leaves coins at 0, not below.
- **Up to one autosave of earnings** (about 5 s) can be lost when a copy is merged or taken.
- **One game on two devices with no copy in common known** (the copy both last matched lost from both, say by
  clearing site data): merged from the least each has, so nothing counts twice, but a gain made on both sides may
  count once. Two different games (or a fresh code) need no copy in common: each game's gains count, the starting
  box once. Which is which is told by the game's `origin`, made when a game starts.

To undo, delete the variable, so the menu item goes with the next deploy. Then, if you want, run `npx wrangler delete`
and `npx wrangler r2 bucket delete woodrail-saves`.

## Credits

The sync code's words are from the EFF's short word list 1 (<https://www.eff.org/dice>), used under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/) and cut to 1024 words fit to give a child
(`src/persist/code-words.ts`). The game's Cloud save card credits it too.
