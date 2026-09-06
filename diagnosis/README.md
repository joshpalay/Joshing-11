# diagnosis/

Living tracking documents for open technical decisions that need dated
follow-up — gate rollouts, flag flips, measurement experiments, anything
where "ship it and measure" spans more than one sitting. Each file is a
**standing question**, not a report: it gets edited in place and grows an
`## Updates` log until it reaches a `done` status.

## How this differs from `audits/`

`audits/` is point-in-time: one dated file per run, never edited again after
it's written (see `.claude/skills/prd-audit/SKILL.md`). A `diagnosis/` file
is the opposite — one file per *topic*, continuously updated, until the
open questions it tracks are resolved. If you're producing a one-shot
findings report, it belongs in `audits/`. If you're tracking something that
needs re-checking over days or weeks (an experiment, a flag rollout, a
"measure before deciding" gate), it belongs here.

## Conventions

- **One file per topic**, not per day: `diagnosis/<slug>.md`, kebab-case,
  named for the thing being decided (`answer-leak-domain-drift-plan.md`),
  not the date.
- **Frontmatter** on every file (see `_TEMPLATE.md`):
  ```yaml
  ---
  name: <slug>
  status: planning | active | needs-decision | blocked | done
  opened: YYYY-MM-DD
  last-reviewed: YYYY-MM-DD
  owner: Josh
  related-pr: "#1611"        # omit if none
  ---
  ```
- **Structure inside the doc:** what triggered it, the open decisions in
  plain language, the plan/phases, a recommendation section that gets
  updated as evidence comes in, and an `## Updates` log at the bottom —
  append-only, dated entries, oldest first. Never rewrite history above the
  Updates log; correct it by adding a new dated entry, the way a lab notebook
  works.
- **`status: needs-decision`** means there's a specific question only Josh
  can answer, stated explicitly near the top of the latest Update. Don't
  bury it in prose — a reviewer scanning just the index below should be able
  to tell something needs a decision without opening the file.
- **`status: done`** means the open decisions are resolved (flags flipped or
  deliberately left off, one way or the other) and nothing further is being
  measured. Leave the file in place as a record; don't delete it.

## Daily check

`.claude/skills/diagnosis-review/SKILL.md` — invoke with `/diagnosis-review`.
It re-checks every non-`done` file against whatever it depends on (env
flags, PR/merge state, DB counters, eval results), appends a dated Update
(even a "nothing changed" one), and prints a one-screen summary of anything
that needs your decision. See that skill for exactly what it checks and how.

**Cadence is currently manual** — run the skill yourself when you want a
check, or ask Claude Code to run it. It is deliberately not on an unattended
daily cron yet: these docs mostly live on feature branches until their PR
merges, and a scheduled job would need to know which branch to check.
Revisit once diagnosis docs settle on `main` as their normal home.

## Index

| File | Status | Opened | Last reviewed | Related PR |
|---|---|---|---|---|
| [answer-leak-domain-drift-plan.md](answer-leak-domain-drift-plan.md) | **needs-decision** | 2026-09-05 | 2026-09-06 | #1611 |
| [daily-build-latency-deferral-plan.md](daily-build-latency-deferral-plan.md) | active | 2026-09-04 | 2026-09-06 | #1601 |

Keep this table in sync by hand when you add/close a file, or let
`/diagnosis-review` do it — it rewrites this table from each file's
frontmatter on every run.
