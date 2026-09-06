---
name: diagnosis-review
description: Re-check every open diagnosis/*.md doc against reality (env flags, PR/merge state, DB counters, eval results), append a dated Update to each, and print a one-screen summary of anything needing Josh's decision. Run daily, or any time before/after touching something a diagnosis doc is tracking.
argument-hint: (optional) a specific diagnosis/*.md filename to check just that one
---

# Diagnosis review: $ARGUMENTS

Re-verify the standing questions in `diagnosis/` against current reality and
log what changed. This is reconnaissance and note-taking — **never take the
action a doc is deciding about** (don't flip an env flag, don't merge/close
a PR, don't run a costly live eval) without asking first, even if the
evidence clearly points that way. This skill's job is to make the decision
easy to make, not to make it.

## Steps

1. Read `diagnosis/README.md` for the current conventions and index.
2. List the target files: every `diagnosis/*.md` except `README.md` and
   `_TEMPLATE.md`, or just the one named in `$ARGUMENTS` if given. Skip any
   file whose frontmatter says `status: done` unless `$ARGUMENTS` names it
   explicitly.
3. For **each** target file:
   a. Read it in full, including its whole `## Updates` log — the most
      recent entries say what was still outstanding last time, which is
      your checklist for this run.
   b. Re-verify whatever is independently checkable, using read-only
      lookups only:
      - **Env flags** — any `` `ALL_CAPS_NAME` `` token that reads like a
        flag: `grep` for it in `.env` and report its current value.
      - **PR / merge state** — any `#NNNN` reference: `gh pr view NNNN
        --json state,mergedAt,title,baseRefName`. If it merged since the
        last Update, that's a significant change — the doc's file may now
        also exist on `main`; check with `git log main -1 -- diagnosis/<file>`.
      - **DB counters or row states** — if the doc references specific
        rows, tables, or counters (e.g. `gate-drop-stats`, specific row
        ids), re-run the same read-only query the doc describes via the
        project's read-only Supabase MCP tool. Never write. If the doc's
        own SQL was meant for Josh to run by hand (a demote, a migration),
        just re-check whether it appears to have been applied — don't
        apply it yourself.
      - **Eval files** (`*.eval.test.ts`) marked "unrun" — check whether
        `ANTHROPIC_API_KEY` is now present in `.env`. If it is and the doc
        says the eval is still unrun, **ask Josh** before running it (it
        costs tokens); don't run it silently.
      - **Code/test state** — if the doc references specific functions or
        rules, a quick `git log --oneline -5 -- <path>` shows whether
        anything touched them since the last review, which matters even
        before re-running any numbers.
   c. Compare what you find to what the doc's last Update said. Three
      outcomes:
      - **Nothing changed** — append a short dated Update saying exactly
        that (which flags/PRs/counters you checked and that they're
        unchanged). Don't skip the entry; a missing entry looks like the
        doc wasn't reviewed at all.
      - **Something changed but doesn't resolve an open decision** — log
        it with numbers, same as day one's Phase 1 entries.
      - **Something now answers an open decision** — say so plainly, but
        still don't act on it. Set `status: needs-decision` in the
        frontmatter and state the exact question at the top of the new
        Update entry, e.g. `**NEEDS DECISION:** eval passed both bars —
        flip DOMAIN_DRIFT_DROP_ENABLED?`
   d. Update the file's frontmatter: `last-reviewed: <today>`, and `status`
      if it changed.
4. Rewrite `diagnosis/README.md`'s index table from every file's current
   frontmatter (status, opened, last-reviewed, related-pr).
5. Print a summary directly to Josh, not just into the files — this is the
   part he actually reads:
   - One line per file: status, and the single most important thing that
     changed (or "no change").
   - A distinct, unmissable **NEEDS YOUR DECISION** section listing every
     file now at `status: needs-decision`, with the exact question from
     step 3c.
6. Stage and commit exactly the changed `diagnosis/*.md` files (plus
   `README.md` if its index changed) with a message like `diagnosis:
   daily review YYYY-MM-DD`. Push to whatever branch is currently checked
   out. **If the working tree has other, unrelated uncommitted changes,
   stop and ask** rather than bundling them into this commit or stashing
   them — this skill's commit should only ever contain `diagnosis/` files.
7. If a target file's `related-pr` shows as merged in step 3b and the file
   no longer exists on the current branch (because the branch was deleted
   post-merge), note that in the summary and ask Josh whether to keep
   reviewing it from `main` going forward, rather than silently switching
   branches.

## What this skill deliberately does NOT do

- Flip any flag, run any migration, or apply any SQL a doc describes.
- Run a costly live eval without asking first.
- Delete or rewrite history in a doc's `## Updates` log — corrections are
  new dated entries, never edits to old ones.
- Start a new diagnosis doc — that happens when a new incident/experiment
  starts, using `diagnosis/_TEMPLATE.md`, not as part of a routine review.
