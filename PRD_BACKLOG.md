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
