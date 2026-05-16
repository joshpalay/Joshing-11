# PRD Update Backlog

## §5 — 100-question-per-round submission cap
- **Date:** 2026-05-16
- **Section affected:** §5 MVP Scope and Phasing
- **Current PRD text:** "Players can submit up to 100 questions per round for consideration. This limit is a placeholder and may be revisited."
- **Code reality:** No per-round cap exists or is enforced. The product has moved away from the group-game-round model. In the Daily Five, only 5 questions are served per day by design. In the Feed, players may submit unlimited questions into their bank for circulation.
- **Proposed PRD update:** Remove the 100-question-per-round submission cap. Replace with: "Players may submit an unlimited number of questions to their bank. The Daily Five serves 5 questions per day per player; the Feed surfaces questions from a player's bank to their friends organically. No per-round submission ceiling applies."

## §5 — Personal rounds triggerable from knowledge page
- **Date:** 2026-05-16
- **Section affected:** §5 MVP Scope and Phasing; §8.37 Knowledge Page Actionability and Personal Rounds
- **Current PRD text:** "Knowledge page is an action surface — players can trigger personal rounds from it."
- **Code reality:** The knowledge page exists with domain mastery display, declared interests, and feed-dismissal actions, but no personal round trigger. No PERSONAL_ROUNDS table in the schema and no related API route.
- **Proposed PRD update:** Remove "Knowledge page is an action surface — players can trigger personal rounds from it" from the Phase 1 feature list in §5, and mark §8.37 Personal Rounds as deferred. Replace with: "The knowledge page displays a player's mastery portrait and declared interests. Personal rounds (on-demand practice sessions triggered from the knowledge page) are deferred to a future phase."

## §5 / §8.39 — Developer testing mode (Create Test Game)
- **Date:** 2026-05-16
- **Section affected:** §5 MVP Scope and Phasing; §8.39 Developer Testing Mode
- **Current PRD text:** "Developer testing mode available from Settings screen." §8.39 specifies a 'Create Test Game' entry that provisions a group, pulls 5 questions from seed account 555-987-6543, bypasses the noon EST cadence, and delivers a full session immediately.
- **Code reality:** The group/seed-account test-game flow does not exist. The only developer utility is `POST /api/daily/reset` (`src/app/api/daily/reset/route.ts`), which deletes the current user's daily queue so it regenerates on next load. The Daily Five is now a solo experience between the player and the LM — there is no group or second player to provision.
- **Proposed PRD update:** Remove §8.39 in its current form. Replace with: "Developer testing mode: a 'Reset today's questions' action is available in Settings, implemented via `POST /api/daily/reset`. This clears the current user's daily queue so a fresh set is generated on next page load, allowing retesting of the daily session, scoring, and session-close flow without waiting for the next noon reset."

## §8.1.14 — Missing DAILY_WRONG quip
- **Date:** 2026-05-16
- **Section affected:** §8.1.14 Per-Answer Commentary
- **Current PRD text:** DAILY_WRONG bank includes "Tomorrow's version of you will know." (use sparingly) as a fifth entry.
- **Code reality:** `DAILY_WRONG` in `src/server/grading/select-quip.ts:12–17` has 4 entries; the fifth quip is intentionally absent.
- **Proposed PRD update:** Remove "Tomorrow's version of you will know." from the DAILY_WRONG quip list in §8.1.14. The four-entry bank is the correct implementation.

## §8.3.4 — Creator points for send-forwarded questions not implemented
- **Date:** 2026-05-16
- **Section affected:** §8.3.4 Creator Points
- **Current PRD text:** Sender earns creator points when recipient answers correctly — 1.0x for own questions, 0.5x for forwarded questions originally authored by someone else.
- **Code reality:** No creator-points logic fires on direct-sent question answers. The feed answer route awards mastery to the answerer only; the originating sender receives no credit. (`src/app/api/questions/send/route.ts`, `src/app/api/feed/[feedItemId]/answer/route.ts`)
- **Proposed PRD update:** Remove §8.3.4 Creator Points. Replace with: "The sender does not earn creator points when a recipient answers a directly-sent question. The send gesture is its own reward — the social moment of sharing a question with a specific friend. Mastery credit flows only to the player who answers."

## §8.2.6 — Feed cap is 50, not 25
- **Date:** 2026-05-16
- **Section affected:** §8.2.6 Feed Mechanics
- **Current PRD text:** "Maximum 25 items. Older items roll off."
- **Code reality:** `MAX_FEED_LIMIT = 50` and `rollOffOldItems` uses `.offset(50)` — the live cap is 50. (`src/server/db/queries/feed.ts:254, 438`)
- **Proposed PRD update:** Change §8.2.6 to read: "Maximum 50 items. Older items roll off (remain in table, no longer surfaced)."

## §8.8a — Breadcrumb length is 1–2 sentences, not 2–6 words

- **Date:** 2026-05-16
- **Section affected:** §8.8a Breadcrumb System
- **Current PRD text:** "2–6 words. No explanations. No facts. Observational tone." Examples: "you both know this", "not your lane yet"
- **Code reality:** `src/server/daily/generate-breadcrumb.ts` prompts Claude Haiku for "1–2 sentence breadcrumbs" with min 12 chars and max 420 chars. The 2–6 word examples from §8.8a describe what are now the per-answer quips (§8.1.14), not LLM-generated breadcrumbs.
- **Proposed PRD update:** Update §8.8a: "Breadcrumbs are short LLM-generated contextual notes (1–2 sentences) appearing after each answer. They are observational and conversational — no educational explainers. Separate from the per-answer quip (§8.1.14), which is a fixed 3–5 word phrase selected from a curated bank."

## §8.7 — Archive page is not a current product feature; catch-up is a separate feature

- **Date:** 2026-05-16
- **Section affected:** §8.7 Archive
- **Current PRD text:** Full archive of every question a player has interacted with, organized by source (Daily Five, Feed, Sent to me, Sent by me, Written by me, Catch-up), searchable by domain and free-text.
- **Code reality:** The Archive page (`src/app/archive/page.tsx`) exists in code but is not surfaced in primary navigation. Catch-up ("play the ones you missed") is a fully implemented separate feature with its own page (`/daily/catchup`), API routes (`/api/daily/catchup/*`), eligibility logic (`src/server/play/catch-up-eligibility.ts`), and turn sequencing — not a filter within an archive UI.
- **Proposed PRD update:** Mark §8.7 Archive as deferred. Replace with two separate entries: (1) Catch-up — a dedicated play session for missed Daily Five questions, accessible from the home screen when eligible; (2) Archive — a searchable history of all interactions, deferred to a future phase.

## §8.5 — Bank-only helper text omits domain/territory info

- **Date:** 2026-05-16
- **Section affected:** §8.5.2 Question Creation — bank-only confirmation copy
- **Current PRD text:** "Saved to your bank. It opens [Domain] as declared territory on your map."
- **Code reality:** `src/components/QuestionForm.tsx` displays `"Saved to your bank only."` — no mention of which domain opens or that authorship creates declared territory.
- **Proposed PRD update:** Simplify §8.5.2 confirmation copy to: "Saved to your bank only." The domain/territory-opening detail is surfaced elsewhere (knowledge page, mastery events) and is not needed in the inline save confirmation.

## §8.5 — "Share with all friends" broadcast destination retained

- **Date:** 2026-05-16
- **Section affected:** §8.5 Question Creation
- **Current PRD text (v11.1):** The broadcast-to-all-friends destination was explicitly removed from §8.5; only "Saved to your bank only" and the direct-send flow remain.
- **Code reality:** `src/components/QuestionForm.tsx` retains a "Share with all friends" checkbox (`shareToFeed` state, line ~503) that defaults to `true` and submits to the feed broadcast path.
- **Proposed PRD update:** Reinstate the broadcast destination in §8.5. After authoring a question, players may choose: (a) save to bank only, or (b) share with all friends (broadcast to the feed). The checkbox defaults to ON. Direct send to a specific friend remains a separate gesture from the bank/feed authoring flow.

## Open Questions

## §8.1.11 — Thumbs-up signal has no effect on feed surface ordering
- **Date:** 2026-05-16
- **Section affected:** §8.1.11 Reactions on Daily Five Questions
- **Current PRD text:** "Heavily thumbed questions surface earlier in friends' Feeds, all else equal."
- **Code reality:** `thumbs_up` signals are recorded in `question_feedback` but `surface_priority_score` on the `questions` table is never updated, and the feed query doesn't use it in ordering. The signal is a no-op. (`src/app/api/daily/feedback/route.ts`, `src/server/db/queries/feed.ts`)
- **Proposed PRD update:** No PRD change needed — the feature is specified correctly. The code needs to be updated.
- **Decision needed:** How should surface priority be computed — eager update to `surface_priority_score` when feedback is recorded, or dynamic weighted sort in the feed query joining `question_feedback`? And what is the weighting formula (e.g. each thumbs-up adds X to priority score)?

## §7.3 — Cultural anchor skipped on "Keep all" invite path
- **Date:** 2026-05-16
- **Section affected:** §7.3 Onboarding — Step 2 (Cultural anchor)
- **Current PRD text:** Four-step flow always includes Step 2 (birth year + geography) before proceeding to home.
- **Code reality:** "Keep all" on the invite-suggestions step saves interests and redirects to `/` immediately, skipping birth year and geography collection entirely (`src/app/onboarding/OnboardingFlow.tsx:434–443`). Those fields are never saved for this cohort.
- **Proposed PRD update:** Neither the PRD flow (cultural anchor before invite acceptance) nor the current code (skip entirely) is right. The correct behavior: after "Keep all" is tapped and interests are accepted, show a brief "one more thing" screen collecting birth year and country (two fields) before redirecting to home. This preserves the low-friction fast path while ensuring the cultural anchor is always captured for future re-personalization. Update §7.3 Step 1 to read: "If the user accepts all pre-seeded interests, proceed to a compact Step 2 screen (birth year + country only) before reaching home."
- **Decision needed:** Implement the post-acceptance cultural anchor step as described above, updating both the OnboardingFlow component and §7.3.
