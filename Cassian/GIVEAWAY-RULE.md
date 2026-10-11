# Cassian giveaway-rule revision

Completed October 11, 2026. The second quality-prompt revision improved the tested decisions and reasons, but **keep the production checker unchanged**. A fresh case still received a false eponym hold, and another correct hold included an incorrect multipart explanation. This is useful development evidence, not rollout validation or a reason to switch writers.

The revision distinguishes the fact being asked for from context that merely identifies its subject. It checks false premises separately, requires question-text evidence for holds, permits legitimate quotation completion, and retains the existing tier and domain policies verbatim. It replaces the conflicting unique-identification definition rule rather than appending another exception. The candidate is an offline builder in `scripts/cassian-gate-prompts.ts`; production does not import it.

## Frozen comparison

Both manifests, labels and the candidate prompt were frozen before the first response. Ten previously approved quality cases were replayed, followed by twelve fresh author-designed controls balanced six pass/six hold. The same reviewer designed the prompt, authored the controls and audited the replies. Fresh controls are new inputs, **not an independently sampled or blind holdout**. No tuning occurred between sets.

Each case received current and revised prompts twice, alternating arm order. Both arms used the current `claude-haiku-4-5-20251001`, temperature zero, 500 output tokens and single-item requests. There were 88 completed calls, no retries, retrieval, factual-checker calls or new writer questions. The development run cost **$0.152024** under $0.35; fresh controls cost **$0.179830** under $0.40. Total **$0.331854**, below the combined $0.75 ceiling.

| Measure | Current prompt | Revised prompt |
| --- | ---: | ---: |
| Known-set matches, original labels | 16/20 | 18/20 |
| Known-set matches, excluding old-policy control | 14/18 | 18/18 |
| Fresh-control matches | 18/24 | 22/24 |
| Combined matches, excluding old-policy control | 32/42 | 40/42 |
| Combined correct verdict and wholly sound rationale, excluding policy | 30/42 | 38/42 |
| False holds, excluding policy | 10 | 2 |
| Unsafe passes, excluding policy | 0 | 0 |
| Parsed verdicts, all calls | 44/44 | 44/44 |
| Direct response cost, all calls | $0.226254 | $0.105600 |

These denominators include two identical repetitions per case: 42 replies represent **21 distinct cases**, not 42 independent observations. Fresh controls cover accessible tier, not all-tier behavior. The old-policy control explicitly expects a hold under the original unique-identification rule. The revision passed it twice as intended. Its frozen label is unchanged, so original-label scoring counts those two passes as mismatches; the sensitivity excludes them rather than relabeling a policy change as factual accuracy.

## Human audit and remaining failures

All raw replies were reviewed; identical repetitions were confirmed by response hashes. The revision fixed the known quotation and contextual-recall false holds, correctly identified the real false-role premise without inventing a printed answer, and retained the explicit answer-leak and distinct-asks holds. On fresh controls it caught all six intended hold cases in both repeats, including printed and semantic disclosures, a false premise and the narrow accessible roster rule. It also passed the specific-object, medium and same-kind-multiple recall controls. Policy compliance does not establish entertainment value.

Two fresh failure modes remain:

- **Eponym false hold:** both prompts treated a printed surname as supplying an unstated given name. The revised reason quoted genuine question text, then falsely claimed that context supplied the requested fact. Exact quotation alone cannot validate a giveaway reason.
- **Mixed multipart rationale:** the revision correctly held a question combining instrument types with a musician count, but counted the two same-kind instruments as separate asks. The primary defect is valid; the full rationale conflicts with the retained `name_multiple` rule.

Automatic reason scoring needs human interpretation. In the known set, two revised multipart reasons used an em dash instead of the required colon; their substance was sound, increasing human sound-verdict/reason scoring from 16 to 18. In fresh controls, two current reasons added punctuation inside a genuine semantic-evidence quote; human review increased 16 to 18. Two revised mixed multipart reasons were downgraded from automatic 22 to human 20. Labels, automatic scores and raw replies remain intact; the overrides are separate.

Output/evidence adherence also remains incomplete. Only 4/8 known-set and 12/14 fresh revised holds included an exact question substring under the strict quote heuristic; added punctuation and absent quotes are separate from substantive correctness. One false eponym hold passed that heuristic. Every response used fences despite the revised JSON-only instruction. After fence removal, 42/44 revised and 32/44 current replies contained only JSON; production extraction recovered all 88. All replies ended normally, with no truncation or cache tokens. Neither raw replies nor binary decisions changed between repetitions. The earlier unfenced-prose extraction defect was not exercised or fixed here.

The shorter revision used about 2,040 input tokens per call versus 4,626 for the current prompt and cost about 53% less directly. Replacement costs, production batches, full topic-to-ready latency, retrieval and invoice reconciliation were not measured. This does not establish a monthly saving or repair the factual checker.

## Decision and handoff

Preserve this revision as an offline candidate. Next address the eponym component error, same-kind rationale error and output/evidence contract, then evaluate on independently selected, source-reviewed cases and production-shaped batches before a reviewable rollout with rollback. Giveaways need evidence that supplies the **requested fact**, not merely a matching substring. Do not repeat these calls or request new ratings on completed writer cards. The separate parser regression and factual-checker work remain open.

Private manifests are under `_scratch/Cassian/cassian-giveaway-v2-dev-2026-10-11/private/` and `_scratch/Cassian/cassian-giveaway-v2-fresh-2026-10-11/private/`, with SHA-256 `baacfd101ed7794bba98921fa8eaf6b4909ff995f4ac1b29db3176025d51abc9` and `644856a3eec48f2be3525d2792a098d7ae147883c0160374660b5a621607d5f9`. Both use candidate prompt SHA-256 `ecf8dc4656e4e94cc943f63b52a77b530a735aaa51536012495fa6bda8174287`. Exact questions, source mappings, raw replies, hashes and per-call human audits remain ignored. Read-only provenance checks resolved initial automatic approval review for the unchanged, previously approved saved-case transfer; fresh controls contain no player data.

Eighteen focused scoring/scheduling/budget tests, TypeScript and affected-file lint passed. Completed resume of both manifests made no new API calls and left spending unchanged. The durable ledger records **$3.786119 spent, $0 reserved, $6.213881 remaining** of the authorized $10. Costs are response-token list-price estimates, not invoices. No production prompt/model/parser, candidate exposure, bank or gameplay change occurred.
