# Friends module: what counts, and why it is fair

Gymme's friends module (v1.7) compares people only on **showing up**. This page is the exact rulebook behind every
number friends see, in challenges and on the Crew leaderboard. The code is `api/summary.js` and `api/challenges.js`;
the tests in `api/test/summary.test.js`, `challenges.test.js` and `privacy-boundaries.test.js` enforce it.

## What is a session?

A workout counts as **one session** when it has a valid date that is **not after today** and **at least one completed
set**. Nothing else matters:

| Does not matter | Why |
|---|---|
| Weight, reps, volume, estimated 1RM | Strength is not what is compared. |
| Exercise type: timed holds, cardio, bodyweight, one side only | Every way of training counts the same. |
| Effort ratings (RIR/RPE), session duration | Intensity is private. |
| Body weight, measurements, calories, nutrition | Never read. |
| Mobility profile, posture, limbs not trained | Never read; a seated session counts exactly like a standing one. |

Sessions dated in the future are ignored, so a hand-edited state cannot inflate a score.

## The numbers

| Number | Definition |
|---|---|
| `weekSessions`, `monthSessions` | Sessions this week (Monday to today) and this calendar month. |
| `weekPlanned` | Days of the whole week with a routine in the user's **own** plan: the weekly schedule, replaced by any per-day override ("rest", or another routine), minus days inside a planned break. |
| `weekConsistency` | `weekSessions / weekPlanned`, capped at 100 %. `null` when nothing was planned. Someone who plans 3 sessions and does 3 is level with someone who plans 5 and does 5. |
| `streakWeeks` | Consecutive weeks with a session. A week with none *yet* does not break it. |
| `weeklyTrend` | Average sessions per week over the last 4 **completed** weeks minus the 4 before, to one decimal. It is a comparison with oneself ("vs usual"): a beginner going from 1 to 3 sessions a week shows `+2.0`. It is never used to rank, and a negative figure is shown only to its owner. |

"Today" is computed in the owner's time zone (stamped on the state as `tz` while sharing is on, or `reminder.tz`), so weeks do not shift for people abroad. With no zone known yet, UTC is assumed and sessions dated one day ahead are still accepted; two days ahead is treated as forged.

**A week in progress.** `weekConsistency` compares sessions so far with the *whole* planned week, so it climbs through the week (someone who did 2 of 3 planned sessions by Wednesday shows 67 %). Everyone is measured the same way, and people with no session yet are never shown as last.

## Planned breaks

Ill, travelling or injured? A user can declare a break of up to **14 days**. Those days are removed from the plan, so
consistency is neither lowered nor credited for them, and no reason is asked for or shared. Sessions done during a break
still count. The server cuts any longer or malformed break (`MAX_BREAK_DAYS`), so a break can never silence the plan
for good. Breaks live in the user's own state (`breaks: [{from, to}]`).

## Challenge types

| Type | Counts |
|---|---|
| `consistency` (default) | Weeks that are **entirely inside** the challenge in which the user reached the number of sessions they had planned (and planned at least one). A week fully inside a break gives neither credit nor penalty. |
| `sessions` | Sessions in the window. |
| `activeDays` | Distinct days with a session. |
| `streak` | The longest run of consecutive weeks with a session. |

A late joiner is counted from the day they joined; days spent with sharing turned off never count once they return.

## Guarantees checked by tests

- The summary has a fixed set of keys (`SUMMARY_KEYS`); adding one fails the tests until it is reviewed.
- Changing weight, reps, effort, duration, body data, or the mobility profile never changes any number.
- No social module (`summary`, `sharing`, `challenges`, `challenge-service`, `friends`, `social`) mentions a private field of
  the state, nor reads weights, reps, volume or duration. `privacy-boundaries.test.js` scans the source.
