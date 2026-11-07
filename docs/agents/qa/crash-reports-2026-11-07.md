# Crash reports, 2026-11-07

What players' games sent to the Worker's `/crash` (docs/feedback.md, "Crash reports"), read with the admin key on
2026-11-07 at about 20:15 UTC.

## Headline

**No crash reports at all.** `GET /crash` answered 200 with an empty list: no uncaught errors, no unhandled
rejections, no lost WebGL contexts.

| | Count |
| --- | --- |
| Reports | 0 |
| By kind (error / rejection / context-lost) | 0 / 0 / 0 |
| By build | none |
| By device or browser | none |
| First seen / last seen | none |

Nothing points at memory on phones: no `context-lost` reports and no out-of-memory errors.

## Is the pipeline working? (so 0 means 0)

- **The Worker's route is live.** It accepts a post from itch's game host. An invalid probe from
  `Origin: https://html-classic.itch.zone` got 400 (checked, not stored), not 403 or 404, and its preflight got 204.
- **The game sends to it.** Crash reports landed on 2026-11-05 (079fbe35, fdf5eda0). They are in every itch release
  since v1.1.1 (2026-11-05 05:01 UTC), whose build sets `VITE_STATS_URL`, the URL `src/main.ts` falls back to for
  crashes. The GitHub Pages build sets `VITE_CLOUD_URL`, another fallback.
- **The path is tested.** `npm run e2e:gl-lost` checks that a lost context sends one report the Worker's own parser
  accepts.

## How much play this covers

There are no paging concerns: the list holds the latest 100, and there are none. The window is short and small:

- **About 2.5 days** of itch play (since v1.1.1). In that time itch counted 26 browser plays (Nov 5 to 7,
  activity dashboard).
- Reports are opt-out, at most one a session, and sent with `keepalive`, so a tab that closes right away still sends.
- A crash that kills the tab before the reporter is listening isn't caught. Neither is a phone tab that the OS kills
  for memory without first firing `webglcontextlost`. If players say "it closed itself" and there's no report, that is
  the likely cause.

## Next

Read them again after the next promotion push, when there are more players, especially phone players.
`npm run activity` now counts them for the Woodrail Activity dashboard (docs/activity.md).
