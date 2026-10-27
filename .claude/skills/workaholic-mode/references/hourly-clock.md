# The hourly clock

A long loop stalls when the manager session goes idle: a usage limit, a closed laptop, a turn
that ended while workers were still running, or a reply the user has not sent yet. The hourly
clock notices this and wakes the manager. It is a heartbeat and never a worker.

## The rules

- **It runs once an hour, on the cheapest model.** Do not schedule it on the hour (minute 0):
  most schedules run then, so it can be delayed. Use another minute, for example `20 * * * *`.
- **It checks, then stops.**
  - If the manager is working or blocked, the clock does nothing.
  - If the manager is idle, finished or failed, the clock sends one fixed message, then stops.
- **It never does the work.** It never spawns agents, changes the repository, or creates,
  changes or fires schedules.
- **There is one clock per loop.** List the existing schedules before you create one. Update
  the one you find rather than adding a second.
- **Read it back after you create it** (its id, schedule, model and enabled state). Write its id
  and schedule in the state file's `CLOCK` line. Never tell the user a clock is on unless you
  have read it back.
- **Never slow the clock down because of an error's wording.** A failed resume is a quiet no-op,
  and the next tick is the retry. Escalate to the user only after several identical failures,
  quoting the error verbatim.
- **Disable it when the loop ends,** and tell the user.
- **A cloud clock sees only what is pushed.** Push before you arm it, and push at least every
  90 minutes while it runs.

## The clock's prompt (template)

Fill in the angle brackets. Keep it short. The durable instructions live in the repository's
state file, not in the schedule.

```
You are the hourly resume clock for <project>'s <loop name> (branch <branch>). Do only these
steps, then stop.

1. Look up the manager session <session id> and read its status.
2. If it is working or blocked, do nothing more and stop.
3. Otherwise, send the manager session this exact message:
   "Resume clock (hourly): the manager session is not working. Read <state file>'s resume
   section and the newest ledger rows, check which background workers are still running,
   refill the frontier (workaholic mode: every item that can start, starts now, in parallel),
   and continue the round (stop line <target> per theme, two consecutive rounds). If work is
   already running, or the next step waits on the user, do nothing."
4. Stop.

Do not clone, read or change any repository. Do not spawn agents. Do not create, change or fire
any schedule. Do not message any other session.
```

Where the clock cannot message a session (some platforms start a fresh chat on every run), use
the **fresh-run** form. That run reads the state file and does the next turn itself:

```
Check out <branch> of <repository> and pull. Read <state file>: its resume section, the newest
ledger rows and every ruling. Do whichever turn it says is next, directly (do not spawn agents
from a scheduled run). If nothing is pending, or the next step waits on the user, change nothing
and stop. Commit and push before you stop. Never push to the default branch.
```

## Recipes by platform

| platform | how to arm it | how to read it back |
|---|---|---|
| **Claude Code in the cloud** (claude.ai/code) | `create_trigger`, model haiku, cron `20 * * * *`, with the session-checking prompt (it calls `get_session` and `send_message`). Leave email off unless the user asks for it. | `get_trigger` / `list_triggers`; disable with `update_trigger enabled=false` |
| **Claude Code, CLI or desktop, while the session is open** | `/loop 60m <resume message>`, or CronCreate in the session | CronList |
| **Claude Code while the machine is off** | a scheduled task in Claude Desktop, or an OS scheduler (cron, launchd, Task Scheduler) running `claude -p "<fresh-run prompt>"` in the repository | the scheduler's own list |
| **ChatGPT** | a scheduled Task with the fresh-run prompt (each run is a new chat) | the Tasks list |
| **Codex, or any agent with a CLI or API** | an external scheduler (cron, a GitHub Actions `schedule:` workflow) that starts a task with the fresh-run prompt | the scheduler's log |
| **nothing available** | tell the user: the loop then resumes only when they write | — |

## What a tick should find

Most ticks find the manager working, and a quiet no-op is the correct outcome. A tick that
wakes an idle manager should lead, within that wake, to one of two things:

- workers running again; or
- a single message to the user naming exactly what the next step waits on.
