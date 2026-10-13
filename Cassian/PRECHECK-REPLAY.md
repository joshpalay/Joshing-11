# Conservative source-review pre-check replay

**Decision, 2026-10-13:** Do not adopt this pre-check. On the saved fresh soft arm it stopped **0 of 24** initial and replacement outputs, avoiding **0 source-review calls and $0 gross provider spend**. The original pipeline and its cards are unchanged. A separate Codex AI review classified **17 of 23 original slots** as usable as written against the captured evidence and history. It is not independent human verification. Zero stopped cards means zero usable-as-written cards were wrongly stopped by this rule regardless of the audit's outcome.

## Frozen rubric and rule

Before reading audit outcomes, the five audit dispositions were frozen as **usable as written**, **needs revision**, **incorrect**, **duplicate/ineligible**, and **unverifiable**. A usable card needs an accurate premise, answer and explanation; valid answer variants; a determinate ask without giveaway; requested topic and difficulty fit; material novelty against bank, player history and other cohort slots; and supplied passage support for every material claim. Missing evidence stays unresolved. A replacement can satisfy only its original slot; the same material fact counts once across slots.

The [offline replay](../scripts/cassian-precheck-replay.mjs) stops only a candidate with a missing/malformed required card field, schema version or request-bound ID, or an exact question-and-answer repeat in the saved bank/player-history records. Exact matching applies Unicode NFC, trim, whitespace collapse and case-folding to **both** question and answer. It preserves all words and punctuation. Similar wording, shared entities, same answers with different questions, uncertain novelty and incomplete history pass to source review. The rule reads no source-review verdict, receipt price or audit outcome before deciding. It makes no semantic factual judgment and is not connected to production.

## Saved-cohort replay

The replay processes all 23 original requests in request order: one preparation shortage, 22 initial soft cards, and the two saved replacement outputs in their original slots. All 24 candidate outputs had source-review receipts. The actual receipts total **$0.488242**; the frozen pre-check stops none.

| Request breadth | Original requests | Candidate outputs including replacements | AI-reviewed usable slots | Stopped | Gross source-review spend avoided |
| --- | ---: | ---: | ---: | ---: | ---: |
| Broad | 7 | 7 | 5 | 0 | $0 |
| Niche | 8 | 7 | 6 | 0 | $0 |
| Very narrow | 8 | 10 | 6 | 0 | $0 |
| **Total** | **23** | **24** | **17** | **0** | **$0** |

The separate reviewer read all 24 exact saved outputs, their request packets and supplied passages, and raw bank/player-history question-and-answer candidate arrays without machine verdicts or author conclusions. Output labels were **17 usable as written, 6 needing revision, 0 incorrect, 1 duplicate/ineligible, 0 unverifiable**. At the original-slot level, 17 were usable, five needed revision, and one was the preparation shortage. One replacement supplied a usable distinct fact; the other repeated its slot's usable initial fact and was not counted twice. No material repeat across different slots was observed. The ignored private review notes contain all 24 raw keys, source IDs, 29 exact passage locators, tier assessments and novelty comparisons. They are separate AI judgments; subjective difficulty and novelty remain uncertain, and the captured history candidate arrays do not certify exhaustive prior-bank coverage. No independently human-verified usable yield is claimed.

The replay neither creates a replacement for a stopped card nor credits any such hypothetical savings as all-in production savings. With no stopped card here, the measured gross saving is exactly zero. The decision rule bars adoption at zero saving; any later claim of savings must also show no usable card was stopped and cannot depend on uncertain duplicate judgments.

## Accounting and preservation

The saved accounting allocates **$0.5410001** to the soft arm: writing $0.0136506, two repairs $0.0011395, 24 source reviews $0.488242, and quality $0.037968. All writer, quality, failed-attempt, replacement, preparation and control entries remain in their original categories. The strict arm is $0.0334814; controls are $0.389508; 101 actual receipts sum to $0.9639895. The historical six-decimal ledger settlement is $0.963987 due to per-call rounding. No new paid calls were made and the older uncertain 2¢ reservation was untouched.

The replay read the original checkpoint writer outputs, request bindings, raw saved bank/player-history question-and-answer records, source-review receipts and complete accounting. It did not write to any of them. Against `RESULTS-FREEZE.json`, all **229 archived private files** match their recorded SHA-256 values. Six later-edited public documentation paths differ from the old archive index; no original card, prompt, gold, score or receipt is among them. Card-level review notes, passages and histories remain in ignored `_scratch/Cassian/`. This public diff contains only the rule, synthetic tests and aggregate results.

Validation: four pure-rule tests and the 24-output private replay pass; sanitized aggregate sums reconcile; a private-string scan found no full card, passage or history text in the four public files. Repository lint passes at its existing 48-warning ceiling, TypeScript passes, and the font, color, spacing, radius, z-index, type-size and design checks pass.
