# Cassian: what to do next

The pilot is ready for code review, but owner ratings have not begun. The current implementation and exact state are in [TRACKER.md](TRACKER.md); [RESULTS.md](runs/cassian-pilot-2026-10-03/RESULTS.md) has the measured comparison. The public [manifest](manifest.json) uses placeholders; the real one is ignored under `_scratch/Cassian/cassian-pilot-2026-10-03/private/manifest.json`.

1. Finish the remaining access, repetition, save/retry and budget tests, then run a full build and preview QA. The admin Cassian panel should appear after the Daily Five bonus questions; ordinary users must not see it. Do not show owner questions until those checks pass.
2. Commit and push the sanitized worktree to draft PR #1745. Update the PR description with the real pilot results, privacy treatment, implemented UI and open limitations. Avoid committing raw questions or real interest names.
3. Deploy the admin-only feature through the established process and confirm the deployed SHA, non-admin 404, answer/reveal, rating save/reload, no mastery/activity writes, and a no-bonus Daily Five case.
4. As an admin, play and rate the eligible experimental cards. Give Good/Fix/Reject/Unsure plus notes, flag inaccurate keys or same-fact repeats, and add missing-topic/variety/UI feedback in the panel. The model and gate verdict appear only after your first rating so they do not bias it.
5. After the ratings, analyze accepted unique questions by broad/niche/very narrow group. Do not pick a winner from the 6-versus-4 machine-gate counts alone. Source retrieval was about 69% of the actual pilot spend, so the next bounded test should examine retrieval reuse and cold topic-to-first-ready latency while preserving topic coverage.
6. If you find the original approximately 80-question document, provide its title or repository path to the implementation session. It is not required to rate this pilot and must not be misidentified as the 54 active reference examples.

The $10 paid authorization remains a lifetime cap for this experiment. The database ledger currently records $1.900008 spent and no reservation. Any answer-grading or follow-up cost draws from the remaining balance. The $5/month operating target remains unproven because other recurring costs exceed it even if writing were free.

For another coding session, paste [HANDOFF-PROMPT.md](HANDOFF-PROMPT.md) and ask it to continue from the tracker. It should not restart the paid 12-topic run.