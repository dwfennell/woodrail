# Woodrail Activity (the dashboard)

A private claude.ai dashboard of how Woodrail is doing: https://claude.ai/artifact/PRR4xFMmvHJ4WpFTuMZM8y

- itch.io: page views, browser plays, click-through, where visitors come from.
- Play stats from players who share them (docs/stats.md): players and minutes a day, the goals they reach.
- Bug reports and ideas, railway snapshots, open issues, and releases marked on the charts.

It holds only totals: no device ids, no maps. Its numbers are files attached to it, refreshed by hand, ask Claude to
"refresh the activity dashboard". The steps:

1. **itch.io** (it has no API for these): open https://itch.io/game/summary/5284263 signed in. The page's
   `R.GameEdit.Analytics({...})` script holds `views` and `plays` by day (the last 30 days); the totals and the
   referrer table are on the page. Write them to `activity-out/itch-daily.json` (`[{day, views, plays}]`),
   `itch-totals.json` (`[{as_of, window, views, browser_plays, collections, ratings, comments, impressions_7d,
   ctr_7d}]`) and `itch-referrers.json` (`[{referrer, source, visits}]`, `source` one of Facebook, itch search, itch
   browse & tags, itch front page, or the site's name).
2. **The rest**: `npm run activity`. It runs `scripts/activity.mjs` under `op run`, which takes the Cloudflare token
   and `ADMIN_KEY` from the Woodrail note in 1Password (`scripts/activity.env` holds only references) and never
   shows them. It reads Analytics Engine (90 days, our own `local` and `pages` play left out), the Worker's feedback and
   snapshot and crash lists, and GitHub, and writes `activity-out/daily.json`, `summary.json`, `goals.json`,
   `feedback.json`, `crashes.json` and `releases.json`.
3. **Upload**: each file to the dashboard as an asset, then point its dataset's `source.url` at the new upload and
   stamp `updated` (the dashboard type's instructions).

`activity-out/` is git-ignored.
