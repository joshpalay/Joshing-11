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

## Open Questions

## §7.3 — Cultural anchor skipped on "Keep all" invite path
- **Date:** 2026-05-16
- **Section affected:** §7.3 Onboarding — Step 2 (Cultural anchor)
- **Current PRD text:** Four-step flow always includes Step 2 (birth year + geography) before proceeding to home.
- **Code reality:** "Keep all" on the invite-suggestions step saves interests and redirects to `/` immediately, skipping birth year and geography collection entirely (`src/app/onboarding/OnboardingFlow.tsx:434–443`). Those fields are never saved for this cohort.
- **Proposed PRD update:** Neither the PRD flow (cultural anchor before invite acceptance) nor the current code (skip entirely) is right. The correct behavior: after "Keep all" is tapped and interests are accepted, show a brief "one more thing" screen collecting birth year and country (two fields) before redirecting to home. This preserves the low-friction fast path while ensuring the cultural anchor is always captured for future re-personalization. Update §7.3 Step 1 to read: "If the user accepts all pre-seeded interests, proceed to a compact Step 2 screen (birth year + country only) before reaching home."
- **Decision needed:** Implement the post-acceptance cultural anchor step as described above, updating both the OnboardingFlow component and §7.3.
