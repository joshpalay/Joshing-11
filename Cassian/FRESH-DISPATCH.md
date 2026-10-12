# Cassian: bounded fresh comparison runner

October 12, 2026, after [#1782](https://github.com/joshpalay/Joshing-11/pull/1782) merged at `f62e2fd2`. The [23-request frame and evidence/control gold](FRESH-EVIDENCE.md) are unchanged. **The resumable runtime and concrete private design are prepared; token preflight and execution are pending.** No new model calls/spending at this snapshot.

Both Haiku 5.5 writing arms receive identical sources, screened relationships, topic/tier and exclusions. Soft writing omits a claim inventory; strict writing adds atomic claim/card/source spans and permits grammatical scaffolding. Alternating order, opaque reviewer IDs and hash-ranked repairs are fixed before outputs. Source review reconstructs the whole card/variants without writer inventory. Quality review receives no explanation and requires exact question evidence for holds.

The ambiguous-scope request retains both outcomes as a preparation shortage with no writing charge or replacement topic. The other 22 requests allow 44 initial writers. Eight sound/eight challenge controls and three saved regressions are separate from fresh yield. Gold is same-author development evidence; no independent adjudicator is assigned.

At most two initially nonpassing requests per arm get one repair/replacement each after initial machine reviews. Repairs use unchanged packets/tiers/modes and only their own feedback. Prompts, facts and gold cannot change after outputs. Later semantic novelty/adjudication failures do not acquire undeclared replacement calls. Original attempts/costs and unresolved requests remain in the results.

| Request | Input reservation tokens | Maximum output tokens |
| --- | ---: | ---: |
| Writer, including repair | 6,500 | 2,300 |
| Generated-card source review | 6,500 | 3,600 |
| Control source review | 10,000; 12,500 for the two bodies over 15,000 bytes | 3,600 |
| Quality batch or repair check | 6,500 | 1,600 |

Effective requests are capped at 40,000 UTF-8 bytes. Token counts must fit with 1,000 input tokens of reserve headroom. All 67 known initial/control requests are counted before the first paid call; output-dependent requests are constructed, hashed, journaled and counted before their own calls. Oversized dynamic requests stay unresolved, with no paid call and a retained reason.

Maximum: **48 writers including four repairs, 48 generated-card source checks, 19 control source checks, 16 quality calls: 131 paid calls**. At current verified [Haiku](https://www.anthropic.com/claude/haiku) and [Sonnet](https://www.anthropic.com/claude/sonnet) list rates, reservations total **$3.9764** under a **$4 software run cap** and the existing $10 lifetime cap. Fresh read-only accounting still shows $4.237201 spent, $0.02 uncertainty, $5.742799 available. These are reservations/receipts, not invoices or a monthly-cost promise.

[Token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting) is free and returns an estimate, not a billing guarantee; it transfers the same private payload. Headroom covers small differences. Unexpected usage stops dispatch after recording what is known. No server tools/web-search fee or cache write is requested. Counting and generation have 30-second timeouts and zero SDK retries.

The [runner](../scripts/cassian-fresh-calls.ts) checks frozen runtime/input hashes before credentials/network. Default/score-only/zero-limit planning makes no provider/database call. Budget mode is read-only; preflight sends only token counts. An advisory lock serializes paid runners. Calls are reserved before dispatch and journaled before checkpoint/settlement. Exact repriced journals recover interrupted settlement without another model call. Settled calls are reused; uncertain charges, missing responses and conflicting hashes block replay. Known prices remain known if local saving fails. The old halted 2¢ call is never retried/released. Completed resumes return before provider-client construction/counting.

Final private design: `_scratch/Cassian/cassian-fresh-v3-2026-10-12/private/design-final.json`, SHA `91e33d198eb96d059d6aa24c2bbca50c9e1dcd9b20e809f7d67c0fd5ac4744e5`. The unexecuted draft has a different ledger id. Dynamic hashes bind parent receipts and frozen constructors. Payloads contain selected topic labels, permitted/excluded relationships, public-source excerpts and experimental card/reviewer text. Raw player identities, full histories, credentials, reviewer arm labels and gold are excluded. Gold stays private.

**59 tests across six files, TypeScript and affected lint pass.** Tests cover ceilings, blinding, deterministic staging/own-card repairs, stale/unknown receipts, crash settlement versus replay blocking, malformed/oversized writers, completed resumption, and poisoned-credential free/zero-call execution. Earlier scores/source/gold freezes and archived status snapshots remain intact.

This is a **curated cached replay**, not automatic retrieval or production readiness. Preparation/control/adjudication labor remains unknown, not free. Machine passes do not prove semantic novelty or independent usable yield. After execution, audit every claim, variant, reason, inventory relation, scope/difficulty and bank/history novelty; report paired/cell outcomes, controls, failures/repairs and unresolved/censored requests. Independently usable and author-provisional results stay separate. This runner has no serving-release function or production switch.
