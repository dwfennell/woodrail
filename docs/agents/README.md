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
- **One thing at a time.** One task session runs, plus its QA check when it needs one. The next task starts after the current one lands. If a task is blocked, it's parked with a note before anything else starts.
- **Work is tracked in GitHub issues.** The user's play-test notes come in through Slack (#woodrail). Each becomes an issue, and questions for the user go in the Slack thread.
- **Task sessions:**
  - The CoS writes a brief: the goal, the issue, the files, the playbook, the checks, and where to report.
  - The session pushes a `claude/<name>` branch and reports the head SHA, the checks run, and what to test.
  - The CoS archives the session when the task is done.
  - Sessions never push to main.
- **QA:** one fresh session per check, for features only. Small fixes land through the CoS's gate alone. A QA session gets the branch, the SHA, a test list and qa.md, sends one verdict, and is archived.
- **Landing:** the CoS merges onto the latest main and runs the gate before pushing to main: typecheck, vitest, build, the relevant e2e, and `GOALS_LONG=1` for economy, goals or industry changes. Then it rebuilds the artifact.
- **Context:** keep sessions lean (tail and grep logs, few subagents). A one-off task that really needs a lot of context may use it. Long-running sessions that carry history from task to task are what we avoid.
- **Updating a playbook:** when a task learns something the next session needs (a new rule, a gotcha, a closed item), update the team's playbook in the same branch.
- Read AGENTS.md first, always, especially "Testing: check the player's path, end to end".
