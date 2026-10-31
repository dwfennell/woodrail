# How the agents work on Woodrail

A Chief of Staff session (the CoS) runs the work. Teams don't have long-lived sessions: each task gets a fresh session, briefed from the team's playbook in this folder, and ends when the task is done.

## Playbooks
| Team | Playbook | Owns |
|---|---|---|
| Rail and road | [rail-road.md](rail-road.md) | Draw, switches, sections and slots, train commands, the sim |
| Game Mode | [game-mode.md](game-mode.md) | Economy, workshop, goals, research, industries, balance |
| Sandbox | [sandbox.md](sandbox.md) | Pieces and kits, the tray, carving, cloud saves |
| Mobile UX | [mobile-ux.md](mobile-ux.md) | The HUD, toasts and cards, the camera, gestures, the tutorial |
| Sound | [sound.md](sound.md) | Sound effects |
| QA | [qa.md](qa.md) | Checking one change and giving a verdict |

## Process
- **A few things at once.** Up to about 4 task sessions run at a time, on areas that don't touch the same files (for example a rail feature, a card or UI change, and a Game Mode change). The CoS lands them one at a time through the gate. A blocked task is parked with a note.
- **Work is tracked in GitHub issues.** The user's play-test notes come in through Slack (#woodrail). Each becomes an issue, and questions for the user go in the Slack thread.
- **Task sessions:**
  - The CoS writes a brief: the goal, the issue, the files, the playbook, the checks, and where to report.
  - The session pushes a `claude/<name>` branch and reports the head SHA, the checks run, and what to test.
  - The CoS archives the session when the task is done.
  - Sessions never push to main.
- **QA:** full QA happens at release points, not per task. At a release point, one fresh session per check runs balance, goals, sections QA, the fuzz and a play-test pass. Between release points, a task tests what it built (unit tests, and an e2e on the player's path) and the CoS's gate does the rest. A QA session gets the branch, the SHA, a test list and qa.md, sends one verdict, and is archived.
- **Landing:** the CoS merges onto the latest main and runs the gate before pushing to main: typecheck, vitest, build, and the e2e suites for the area changed. Balance bands, `GOALS_LONG=1`, sections-qa diffs and trajectory proofs wait for release points (or for a change whose whole point is behaviour, like a refactor that must match main). Then it rebuilds the artifact.
- **Context:** keep sessions lean (tail and grep logs, few subagents). A one-off task that really needs a lot of context may use it. Long-running sessions that carry history from task to task are what we avoid.
- **Updating a playbook:** when a task learns something the next session needs (a new rule, a gotcha, a closed item), update the team's playbook in the same branch.
- Read AGENTS.md first, always, especially "Testing: check the player's path, end to end".
