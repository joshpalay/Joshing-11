# Keeping an unknown charge reserved without retrying it

**Completed follow-up:** this accounting change merged in [#1774](https://github.com/joshpalay/Joshing-11/pull/1774). The owner then explicitly approved the eight-call trial and Anthropic data transfer. [All eight calls completed](TARGETED-RESULTS.md) for $0.133870; completed resume added zero calls. The old 2¢ reservation and uncertain-call state remained unchanged. The earlier approval rejection below is historical and was resolved by that explicit approval.

October 11, 2026. The targeted-review code merged in [#1773](https://github.com/joshpalay/Joshing-11/pull/1773). The failed structured-output request still has an uncertain **$0.02 reservation**. No provider billing evidence was retrieved: this session has no connected billing API/admin credential, and the browser automation runtime failed before inventory. The charge has not been labeled free, settled, released or retried.

The original runner's global stop blocks every new experiment when any reservation exists. The [experiment plan](PLAN.md) requires conservative unknown-cost reservations, single-runner locking, cap enforcement and prevention of duplicate spending. A separate run can preserve those requirements while carrying the old reserve inside the same $10 ceiling.

The new classification is deliberately narrow:

- Carry only reservations from **other halted runs** whose outstanding call states are all `uncertain` or completed, and whose uncertain call ceilings exactly sum to the held reservation.
- An active, unclassified or same-run reservation still stops the targeted runner. A halted failed run remains halted, and `reserveCall` still rejects resuming it.
- Keep the complete old reservation in the global total. The existing atomic `canReserve` check counts spent **plus all reservations plus the next request**, against both the $10 lifetime cap and the $0.75 trial cap.
- Recheck accounting after each settled call. A new timeout retains that call's ceiling and halts its own run; it cannot be reclassified away by that same run. Over-reservation responses still halt dispatch.

Only the targeted offline runner opts into this classification. Existing serving and other runner behavior is unchanged. The classifier reads ledger rows and never updates failed calls, prices or run status. It is not evidence that the old charge equals 2¢; it conservatively retains that ceiling until eventual reconciliation.

**39 focused tests** across four files passed, including cap boundaries with the retained 2¢, active/own/inconsistent reservation refusal, halted-run retry refusal and unchanged pipeline tests. TypeScript, affected-file lint and diff checks passed. A read-only live check classified exactly $0.02 as unrelated halted uncertainty, confirmed that the old call remains uncertain, found zero reserve for the new run, and verified a new $0.15 per-call reservation fits. It made no ledger write or model call. Private proof: `_scratch/Cassian/cassian-targeted-review-v1-2026-10-11/private/CARRY-PROOF.json`.

The unchanged eight-call trial remains estimated at **$0.211860**, capped at **$0.75**. Its questions, sources, labels, prompts, routing, request fingerprints and model limits were not tuned. The old reservation is included in the **$6.003683 available** after $3.976317 settled spend.

Automatic approval review rejected the first proposed paid dispatch before the command started. Its stated concern was sending saved private questions/source data to Anthropic without explicit reapproval after the earlier billing blocker. **Zero trial calls or transfers occurred.** No workaround or second paid attempt was made. The accounting change is ready for review; actual dispatch requires that explicit user approval. This is approval of the new bounded trial and data transfer, not approval to retry or release the old failed call.
