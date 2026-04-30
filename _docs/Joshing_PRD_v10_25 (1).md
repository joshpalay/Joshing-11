# Product Requirements Document
# Joshing — Personal Trivia Social Game

**Document Version:** 10.25
**Platform:** Web (mobile-first, works on all devices)
**Stage:** MVP Definition
**Date:** April 2026
**Status:** Active Draft

---

## Source of Truth & Conflict Resolution

### Source of Truth Order (normative)

1. `Master_App_Instructions-v2.md`
2. Latest user instructions (active task prompt)
3. `Docs/Joshing_PRD_v10_25.md`
4. `Joshing_Implementation_Plan_v2.2.md`
5. Supporting artifacts

### What each doc is responsible for

- `Docs/Joshing_PRD_v10_25.md`: canonical product behavior, UX rules, copy intent,
  and acceptance-level product decisions.
- `Joshing_Implementation_Plan_v2.2.md`: delivery sequencing, implementation status,
  engineering decomposition, and execution constraints that realize the PRD.
- `Docs/CHANGELOG.md`: dated decision and alignment history.

### Conflict rule

If `Docs/Joshing_PRD_v10_25.md` and `Joshing_Implementation_Plan_v2.2.md` disagree
on behavior, `Docs/Joshing_PRD_v10_25.md` is authoritative for product behavior.

### Required hygiene checks (every update)

- Confirm authority order language in both canonical docs remains identical.
- Confirm cross-links are present and valid.
- Confirm no contradictory authority-order text remains in either canonical doc.
- Add a dated note in `Docs/CHANGELOG.md` whenever governance wording changes.

### Ownership + SLA

- Product owner resolves PRD conflicts the same day they are identified.
- Tech lead updates `Joshing_Implementation_Plan_v2.2.md` within 24 hours of PRD lock.
- PR author includes a doc-alignment note in the PR when behavior changes.

This policy aligns with repo priority guidance in `AGENTS.md` and
`Master_App_Instructions-v2.md` (`MASTER_APP_INST.md` is a stub pointer to that file).

---

## Implementation Updates — April 2026

The following decisions are **implemented** and supersede earlier placeholders.

1. **Navigation** — Current app nav order: Home → Questions → Knowledge → Account.
   Group Knowledge Map remains at `/leaderboard` via other entry points.

2. **Session timer** — Removed. No in-session timer exists. Play uses per-assignment
   `expires_at` only.

3. **Catch-up eligibility** — During an active round, all unanswered questions from
   any prior day in that round remain catchable. After a round ends, unanswered
   questions remain playable for 7 days. After those 7 days, submissions are rejected
   and questions are archive-only.

4. **Catch-Up Mastery Weight**

Catch-up answers count at 0.25x weight, rounded to the nearest integer, toward mastery scoring regardless of whether the round is active or in the 7-day post-game grace period. The weighting is:

| Difficulty | Catch-Up Correct |
|---|---|
| Specialist | 25 pts |
| Moderate | 13 pts |
| Accessible | 3 pts |

Catch-up answers are excluded from difficulty calibration. Catch-up answers do not
generate Social Progress Snapshot moments — only live session answers appear in
the per-round and full-game snapshots (§8.35).


5. **Catch-up session UX** — **Implementation (current app):** catch-up is signaled by
   copy and header subtitle, not a separate full-page hex wash. Sticky play header uses
   the same **theme surfaces** as live play (`var(--surface)` / `var(--border)`); during
   catch-up, subtitle reads **Catch-up · [human-readable date]** (`formatCatchUpHeaderSubtitle`
   in `catch-up-copy.ts`). **Untimed / not for standings** is conveyed in the **thread**
   system intro when catch-up begins (`formatCatchUpSessionThreadIntro`). Optional
   `CATCH_UP_UNTIMED_LABEL` exists for future UI parity; not a hard `#ede8dc` requirement.

6. **Catch-up routing** — `/play?group=&game=&mode=catchup` is the canonical deep
   link for catch-up intent.

7. **Author reveal (live play)** — The app **may** expose the per-question author’s
   display name during live play for **all** setups (`creator_name` on today/play
   payloads, question row, breadcrumbs, and wrong-answer copy that names the writer).
   **End of Session Review** remains the primary full reflection surface (explainer,
   notes, stars). **Setup 1** is still curator-forward socially; **Setup 2 & 3** do
   not require hiding the writer when the client chooses to show attribution.

8. **Max group size** — 10 players (`MAX_GROUP_SIZE` in `game-constants.ts`).

9. **Minimum questions to start** — Floor of 5.

10. **Question submission limit** — 100 questions per round (placeholder).

11. **Mastery tier names** — Canonical progression scale:
    **Establishing → Familiar → Solid → Mastery**.
    Old names (Curious/Versed/Fluent/Master) are retired throughout.

12. **Points system** — Canonical point values:
    - Specialist first correct (live): 100 pts
    - Moderate first correct (live): 50 pts
    - Accessible first correct (live): 10 pts
    - Catch-up / previously wrong: 25% of above (25 / 13 / 3 pts)
    - Repeat correct: 0 pts
    - Creator earnings: Easy 25 pts, Medium 50 pts, Hard 100 pts per correct answer
    - Raw **running** totals stay off primary surfaces; **exception:** at **daily
      session end** in the play thread, **`SessionCompleteRow`** shows a prominent
      **`+pointsToday`** (today’s earned points only — `GameplayChat.tsx`).

13. **Knowledge page display** — Spider graph shows top 8 domains. All other domains
    appear as a list below. Graph updates at end of round only. See §8.33.

14. **Domain merge/split** — Option B model, end of round only. See §8.34.

15. **Social Progress Snapshot** — Replaces traditional leaderboard. See §8.35.

16. **Share card** — Mastery momentum format. Personal only. Does not appear when no
    domain movement occurred. Emoji grid preserved as secondary. See §8.36.

17. **Ceremony structure** — Act 1 fires on personal completion. Act 2 fires on group
    completion or timeout. Last player flows directly from Act 1 into Act 2.
    See §8.29.

18. **Knowledge page actionability** — Players can express domain intent from the
    Knowledge page via domain card action (existing domains) or free text search
    (any topic). This triggers a personal round. See §8.37.

19. **Session close messaging** — Adaptive close message appears on session summary
    screen after completing daily questions. References mastery momentum and next
    round timing. See §8.38.

20. **Developer testing mode** — One-tap test game creation from Settings screen.
    Uses pre-seeded questions from 555-987-6543. See §8.39.

21. **Mastery display hard rules** — Other/uncategorized category labels are
    prohibited on all user-facing surfaces.

22. **Replay** — Consequence-free re-try of **only questions you missed** in real
   games (wrong or expired; same “missed” pool as the app’s replay API). Route
   `/replay`; no score change, no mastery. See §8.40. **Deferred (not current
   app):** AI-only solo *Practice Mode* — §8.41.

23. **Educational explainer vs LLM §9.4** — **Implementation (current app):** live
   play matches §8.9 (no explainer in the chat thread). The POST answer handler does
   **not** return explainer text. A single **`Question.factual_explanation`** string
   (2–3 factual sentences, `generateFactualReflectionExplanation` in `llm.ts`) is
   **backfilled asynchronously** the first time the field is empty when an answer is
   recorded — **one value per question**, not per player or per
   correct/wrong/expired variant. **End of Session Review** (and archive/details
   surfaces) show that text with truncate + expand. Legacy **`generateExplainer`**
   (JSON `brief` / `full`) exists in `llm.ts` for tests but is **not** wired into
   private assignment flow. See reconciled §9.4.

24. **Master instructions file** — Canonical: **`Master_App_Instructions-v2.md`** (repo
    root). **`MASTER_APP_INST.md`** is a stub pointer only (`AGENTS.md`, Cursor rules).

25. **Primary nav** — Exactly **four** items: Home → Questions → Knowledge → Account.
    **Personal Daily** (`/daily/setup`) is **not** a primary nav slot; entry from
    **Knowledge** (`/profile`) (and the route remains deep-linkable).

26. **Inter-game wait** — **None** in the app: after a game **completes**, any member
    may start the next game immediately (no `too_soon` / minimum-day cooldown).

27. **`allow_similarity_share`** — Spec + §8.4 copy remain; **DB column deferred**
    (Section 11 notes). Similarity-share flows must add migration + wiring when built.

28. **Author during private live play** — Per-question author **may** be shown for all
    setups (`creator_name` on play payloads). Full explainers and creator notes stay
    review-first per §8.9 / §8.10.

---

## Table of Contents

1. Executive Summary
2. Problem Statement and Opportunity
3. Product Vision
4. Target Audience
5. MVP Scope and Phasing
6. User Stories
7. Authentication and Onboarding
8. Core Features — Detailed Specifications
   - 8.1 The Three Game Setups
   - 8.2 Question Creation and LLM Answer Suggestion
   - 8.3 Question Bank and Audience Curation
   - 8.4 Groups and the Group Game Model
   - 8.5 The Game System
   - 8.6 Setup 3 — Joining Flow and Question Contribution
   - 8.6a Setup 2 — The Open Round
   - 8.7 Daily Session — The Wordle Model
   - 8.8 The Daily Question Page — Chat Thread
   - 8.8a Breadcrumb System
   - 8.9 Answering a Question
   - 8.10 End of Session Review and Voting
   - 8.11 Question Archive
   - 8.12 Daily Summary
   - 8.13 Shareable Result Card *(updated)*
   - 8.14 Intellectual Alignment
   - 8.15 The Full Web Interface
   - 8.16 Home Hub and Navigation
   - 8.17 Game Ownership and Archive
   - 8.18 Stats and Leaderboard
   - 8.19 Missed Questions and Catch-up Mode *(updated)*
   - 8.20 Add to Bank
   - 8.21 Invites
   - 8.22 Wrong Answers as Connection Events
   - 8.23 Post-Game Similarity Sharing *(updated)*
   - 8.24 *(reserved)*
   - 8.25 Public Game and Similarity Discovery
   - 8.26 Author Profiles
   - 8.27 The Knowledge Portrait — Two-Axis Model
   - 8.28 Expert Invitation Surface
   - 8.29 Game Ending Ceremony *(updated)*
   - 8.30 Game Details Page
   - 8.31 *(retired — see §8.32)*
   - 8.32 Points and Progression System *(canonical)*
   - 8.33 Knowledge Page Display Model
   - 8.34 Domain Merge and Split Rules
   - 8.35 Social Progress Snapshot
   - 8.36 Share Card System
   - 8.37 Knowledge Page Actionability and Personal Rounds *(new)*
   - 8.38 Session Close Messaging *(new)*
   - 8.39 Developer Testing Mode *(new)*
   - 8.40 Replay (missed questions) — current
   - 8.41 AI Practice Mode *(deferred)*
9. LLM Integration
10. Public Question Pool
11. Data Model
12. SMS and Notifications
13. Personal Performance
14. Monetization
15. Technical Architecture
16. Design Principles and UX Notes
17. Out of Scope for MVP
18. Success Metrics
19. Open Questions and Decisions Needed
20. Appendix — Sample Questions

---

## Section 1: Executive Summary

> The trivia you wish you were asked.

Joshing is a trivia game built on shared knowledge. Not general knowledge — the specific knowledge that connects a group of people. The books you have all read, the music you have argued about, the shows you watched together, the ideas that shaped how you all see the world. Questions drawn from the intellectual and cultural territory this specific group inhabits.

Joshing questions are factual. They have objectively correct answers. What makes them *Joshing* questions is not that they are about the players — it is that they are drawn from the intellectual and cultural world this specific group shares. "Who wrote Wozzeck?" is generic trivia to most people. To a group of opera lovers, it is the question they always wished they had been asked.

The name works on two levels: it is a game built by Josh, and it captures the spirit of the experience — playful, warm, a little cheeky. To josh someone is to tease them affectionately, to share an in-joke, to test whether they really get you.

Joshing has three game setups. In the first, one person curates all the questions and their friends answer them. In the second, one person starts but after two rounds the door opens for anyone to contribute. In the third, everyone contributes questions drawn from their shared world — everyone answers, the pool belongs to the whole group.

Joshing is invitation-only. There is no open sign-up page. The only way to join is to be invited by someone who already plays — a friend who wants you in their game, or a player in the public pool who thinks you share their world. Every player in Joshing was brought here by someone who wanted them there.

Joshing questions are human throughout. Every question in every game was written by a specific person who chose it, thought it was worth knowing, and put their name on it. AI-generated questions do not enter the pool at any stage — not to extend a game, not to solve pool exhaustion, not as suggestions that bypass human authorship. The questions are a portrait. A portrait painted by AI is not yours.

Joshing is a web-based product. There is nothing to download. The game creator sends an invitation directly from their own phone. The recipient taps a link and they are playing. Zero friction from invitation to first question. Works on any phone, any browser, any device.

The daily experience is directly inspired by Wordle. Every day at noon EST, each player in a group gets a link to that day's questions. 5 questions every day. The questions are available for 24 hours — answer them before the next noon reset. Answer them or lose them.

Getting a question wrong is not a failure. It is a discovery — something from the group's shared world the player hasn't yet explored. The game treats wrong answers as invitations, not judgments.

The answering interface is a chat thread. Questions appear as left-aligned message bubbles. The player types their answer and taps send. Results appear as system messages in the thread.

Joshing is a US product at launch. All infrastructure, compliance, and design decisions reflect a US-only user base for the MVP and Phase 2.

---

## Section 2: Problem Statement and Opportunity

Most trivia games test generic knowledge. They tell you nothing about the people you are playing with, and nothing about the world you share with them. Joshing inverts this: the questions are drawn from the specific intellectual and cultural territory this group inhabits together. Getting a question right creates a moment of genuine recognition — proof that this knowledge belongs to all of you, that your shared world is real and worth celebrating.

Getting a question wrong creates something equally valuable: a discovery. Something from your group's world you haven't yet explored. A question that stumped you is an opening — especially when the person who wrote it tells you why it mattered enough to ask.

There is no direct competitor in this space. The market for social trivia is large and well-tested — Trivia Crack reached 600 million downloads, QuizUp reached 80 million users averaging 40 minutes per day. But every existing product serves generic knowledge. None of them ask questions drawn from the specific intellectual world a particular group of friends shares. The quadrant Joshing occupies — factual questions, correct answers, group-specific cultural content — is genuinely empty.

Wordle, Connections, and similar games are impersonal puzzles — the same questions for everyone, no relationship to who you are playing with. QuizUp and Trivia Crack test generic knowledge domains. Jackbox gets closest with its friend-specific trivia modes, but buries them inside a party game requiring synchronous play, with no daily habit and no persistence. Joshing is the first product to make shared intellectual identity the centre of the game rather than a side feature.

The platform decision solves the single biggest problem in social gaming: getting your friends to show up. Every social game dies when it cannot cross the download barrier. Joshing does not have a download barrier. You send an invitation from your own phone. Your friend taps a link. They are playing.

The invitation-only model solves a different problem: quality. A game whose questions are written by people who know their audience, for a specific group of friends, produces fundamentally different questions than a game where anyone can write anything for strangers. Invitation-only keeps the social accountability that makes questions good.

The three-setup model solves different use cases cleanly. Setup 1 works when one engaged person wants to share their world with friends — low friction, one person does all the work. Setup 2 starts the same way but creates space for the group to grow into shared ownership after two rounds of investment. Setup 3 is the deeper game — higher investment from the start, higher reward, the whole group's world in the pool from day one.

---

## Section 3: Product Vision

**Short-term (MVP):** A tight, polished game for small, invitation-only groups of friends. One person can share their intellectual world with the people they love, or a group can build a game from their collective knowledge — all three setups delivered via personal invitation, answered within the daily 24-hour window, shared via a result card.

**Medium-term:** Private groups are finite seasons — a 100-question arc, an off-season, 
a fresh start.  The public game is the discovery layer that sits alongside them: always-on, always new, invitation-only but broader in reach. When a private group is between games, the public game keeps the daily habit alive and introduces players to others who share their intellectual world. The two surfaces are complementary, not competing. Private = depth, intimacy, and the specific questions written by specific people for specific friends. Public = tribe discovery, the pleasure of finding strangers who share your world.

**Long-term:** A platform for shared-world trivia that acts as a living record of what connects groups of people — and a discovery engine for finding the larger communities who inhabit the same intellectual territory. The best question writers develop followings. The archive of any group becomes a portrait of that group's intellectual life. The public pool becomes a map of how knowledge and culture cluster across communities of people who found each other through a game.

---

## Section 4: Target Audience

**Primary audience:** Adults aged 25 to 45 in the United States with strong shared intellectual and cultural histories — school friends, college friends, families, work groups, fan communities. They played Wordle every morning. They share things in group chats. They appreciate a game that requires no setup from their friends and asks questions that actually matter to them.

**Secondary audience:** Anyone who wants to celebrate what their group knows together. The web model makes the game accessible to people who would never download a trivia app — including older family members comfortable with SMS and a web browser.

**Initial launch cohort:** 5 to 20 personal contacts of the founding team, based in the United States, used to validate the core loop before any broader distribution.
---

## Section 5: MVP Scope and Phasing

### Phase 1 — MVP (Private Only, Web, US Only)

Features included in Phase 1 *(all items preserved; the following are updated)*:

- A round cannot begin until a minimum floor of **5** questions has been submitted
  and approved.
- Players can submit up to **100 questions per round** for consideration. This limit
  is a placeholder and may be revisited.
- Author reveal: per-question author **may** appear during live play for all setups;
  End of Session Review (and add-to-bank path) remains the full reflection surface —
  no gate, no vote required for review.
- Max group size: **10 players**.
- Knowledge page is an action surface — players can trigger personal rounds from it.
- Developer testing mode available from Settings screen.
- *(All other Phase 1 items unchanged)*

---

## Section 8: Core Features — Detailed Specifications

### 8.1 The Three Game Setups

Joshing has three distinct game setups. The setup is chosen at game creation but is not permanently locked — a Setup 1 game starter can upgrade to Setup 2 at any point during the game's life. Downgrading is not permitted. The setups have no player-facing names — players encounter them only through the creation flow question and the experience itself. Internally they are referred to as `know_me`, `know_me_plus`, and `open`.

**Setup 1 — One Curator**

One person writes all the questions. Their friends answer them. The creator decides the territory: the music you all know, the literature you have read, the history you studied, the shows and films and ideas that are part of your collective world. No contribution mechanic. No gates. The creator writes; everyone else plays. Simple, clean, and one-directional.

Free tier. The game starter can upgrade to Setup 2 at any point by tapping 'Open the door to contributions' in group settings. The change takes effect at the start of the next round.

**Setup 2 — One Curator, Then Open**

Starts identically to Setup 1 — one person writes all the questions, everyone else plays. After two rounds, an open door appears. Players who feel moved to contribute can add their own questions to the pool. No gate, no minimum, no requirement. The invitation is warm and entirely optional.

The emotional arc is deliberate. Josh builds the world. His friends inhabit it for two rounds — enough to understand the register, feel the group dynamic, and develop genuine investment. Then the door opens. Some players will walk through it. Others won't. The game continues either way. The pool gets richer if people contribute and stays as Josh's game if they don't.

Contributions go straight into the pool with no approval required. Josh can also keep adding questions in the open round. There is no curatorial hierarchy — the pool belongs to whoever chooses to contribute to it.

Plus tier.

**Setup 3 — Everyone Contributes**

Everyone contributes questions. Everyone answers. Questions are drawn from the shared intellectual and cultural world of the whole group — knowledge that connects these specific people. The pool belongs to everyone from the start.

Contribution is the price of admission. New players add questions as part of the joining flow, before their first session. The game starts with shared investment from every member.

Plus tier.

**The Nature of Questions in All Three Setups**

Joshing questions are factual. They have objectively correct answers that do not depend on knowing the question writer personally. What makes them *Joshing* questions is not that they are about the players — it is that they are drawn from the intellectual and cultural world this specific group shares.

"Who wrote Wozzeck?" is generic trivia to most people. To a group of opera lovers, it is the question they always wished they had been asked. "What is the Animaniacs theme song's opening line?" is obscure to most. To a group who grew up watching it together, it is their world. The question does not test whether you have been paying attention to the person who wrote it. It celebrates knowledge that belongs to all of you.

Good Joshing questions are drawn from: the books this group has read; the music they know; the films and shows they have watched; the historical events and ideas that shaped how they see the world; the cultural references that are simply part of the air this group breathes. They are specific enough to have one clean answer, and oblique enough to be genuinely interesting. They are the questions you always wanted to be asked in Trivial Pursuit.

Getting a question wrong is not a failure. It is a discovery — something from the group's shared world the player hasn't yet explored. The game treats wrong answers as invitations, not judgments.

Questions that can only be answered by knowing private biographical details about the question writer are the wrong kind of question for Joshing. "What is my dog's name?" is not a Joshing question — it is a personality quiz question. The LLM will flag questions of this type and redirect the writer toward factual, gradeable territory.

The LLM's job in question creation is helping writers turn a shared-world reference into a well-formed, gradeable question — not generating self-revelation prompts.

---

### 8.2 Question Creation and LLM Answer Suggestion

Question creation is available to: the game starter in all setups; all players in Setup 3 (everyone contributes); all players in Setup 2 after the open round begins — after two rounds of play.

**The Creation Interface**

Question text input — large, full-width text field, with a prompt that frames the act of writing as curation: *"What piece of your world belongs in this game?"* After 1 second of inactivity following the field losing focus, the LLM suggestion appears inline. Writer sees: suggested canonical answer, question type classification, and any writer-facing note.

Writer choices: Use this answer / Write my own / Edit the suggestion.

Category is auto-assigned by the LLM. Writer can override.

For list questions: a `minimum_required` field appears when the LLM detects a list-type question.

**Public Pool Opt-In**

Below the save confirmation, a quiet toggle — off by default:

> *"Share this question with other groups — your name will be credited as the author."*

This is explicit named consent. The writer knows before opting in that their name travels with the question when it is played by other groups. Writers who enable this toggle are making a deliberate choice to extend their creative reach beyond their own groups. See Section 8.26 for author profiles.

**Why I Added This — Optional Creator Note**

After saving a question, a quiet optional prompt appears below the saved confirmation: *"Why does this one matter to you? (optional — skip if you'd rather not say)"* One plain text field. No character limit. No requirement. Entirely skippable with no friction — skip means skip, not 'skip for now'. Most creators will skip most questions. The ones who add a note are making a deliberate choice to share something, and that choice should be treated with care.

If the creator adds a note, players see it in the End of Session Review. On questions the player answered correctly, it surfaces as a small italic link — *"why Josh added this →"* — that expands inline. On questions the player got wrong, the note is surfaced automatically as an expanded card, visible by default, without requiring a tap. This is intentional: a wrong answer is precisely the moment the creator note does its most important work. It transforms "I got this wrong" into "I got this wrong, and now I understand why it mattered enough to ask."

Creator notes are never shown during play. Never shown in the chat thread. Never surfaced before the End of Session Review.

If no creator note exists on a question a player got wrong, the system surfaces a gentle prompt to the creator in their notification feed, once per question per player: *"[Name] got your [Category] question wrong — want to tell them why you added it?"* Optional, private, non-repeating.

Data model: `creator_note` (text, nullable) on the QUESTIONS table. Never returned to clients before the End of Session Review.

**Answer Suggestion Behavior**

The LLM returns one of four response types:

- **Factual** — suggested answer provided, no note
- **Factual uncertain** — answer suggested with caveat: *"I'm not entirely sure — you may want to double-check."*
- **Ambiguous** — no answer suggested; note: *"This might be hard to grade objectively. Is there a specific answer in mind? If not, consider reframing toward something with a clearer correct answer."*
- **Personal** — no answer suggested; redirect note: *"This question may depend on private knowledge of you specifically, which makes it hard to grade fairly. Joshing questions work best when they're drawn from shared cultural territory rather than personal biography. Consider reframing — for example, instead of 'What is my favorite opera?' try 'What opera features the famous Drinking Song?'"*

The Personal response type does not endorse questions that cannot be graded without private biographical knowledge — it redirects writers toward factual, shared-world territory.

**Accepted Alternatives**

After a question has been played, creators can add accepted alternative answers from the question analytics view. Alternatives are treated as correct by the grading LLM going forward. They do not retroactively change past results. This allows creators to correct for common valid answers their canonical answer missed.

**Difficulty Estimate**

When the LLM categorizes a question, it also returns an estimated difficulty signal: 'accessible' (most people who know this topic will get it), 'moderate' (requires genuine knowledge), or 'specialist' (only enthusiasts will know). This is shown to the creator as a quiet label — not a grade, not a warning, just information. *'Specialist — only enthusiasts will know this.'* A creator can ignore it entirely. But it helps them calibrate before sending and avoid accidentally front-loading a game with questions nobody will get.

Difficulty estimate is also used by the assignment algorithm for adaptive first sessions. Stored as a field on the QUESTIONS table: `difficulty_estimate` (enum: accessible / moderate / specialist, nullable). Generated asynchronously alongside categorization.

**Category Balance Warning**

During the game creation seeding flow, as the creator selects questions, a quiet category distribution display shows the current balance **only for questions with a valid canonical `category`**, for example: *'Your pool: 12 Music · 3 Literature · 2 History.'* If any questions lack a valid canonical category, a separate line **MUST** say so **without** using the labels "Other", "Uncategorized", "Unknown", or generic substitutes — for example: *'1 question still needs a category before it counts here.'* If any single named category exceeds 50% of the **categorized** pool, a gentle nudge appears before the creator proceeds: *'Your pool is weighted toward [Category] — that might be intentional. Start anyway?'* This is never a block, always a nudge. The creator can proceed immediately.

**Opening Question Designation**

When finalizing the question pool before a game starts, the creator can designate one question as the opening question — the first question every player sees in their first session. No player sees a different opening question. The designated question sets the emotional tone for the entire game.

This is a single tap on any question in the pool: *'Set as opener.'* The designated question is marked visibly in the pool for **this game**. **Implementation (current schema):** opener status is stored on the **game–question link** (`GAME_QUESTIONS.is_opening_question`), not as a flag on the `QUESTIONS` row—so the same bank question can be an opener in one season and a normal card in another. If no question is designated, the algorithm selects a calibration-accessible question as the opener.

The opening question is the group's identity handshake — the first signal to every player of what kind of world they have just entered. It should feel like a welcome: *"yes, you're in the right place"* for the players who belong here. The best opening questions are easy enough that most players get them right, specific enough to immediately signal the register of the game, and warm enough to make getting it right feel like being welcomed in. The 'embiggens' question is a perfect example — almost everyone in the right group gets it immediately, it signals warmth and wit, and answering it correctly feels like arriving.

Game starters should be guided toward this framing when designating an opener — not "pick an easy question" but "pick a question that says something true about your group."

**Example Questions During Creation**

During the question creation flow, a small expandable section below the question input: *'Questions from games like yours →'* — shows 3 rotating examples from the founding question set, drawn from the same category as the question being written (if detected) or from random categories otherwise. This is not a template. It is inspiration. The blank page is the hardest part of writing questions; showing what the register looks like eliminates it.

The examples rotate on each tap of 'show more.' They are clearly labeled as examples from the founding set. They are never presented as the player's own questions or as suggestions for what to write. They are simply: here is what a good question in this style looks like.

---

### 8.3 Question Bank and Audience Curation

Every player has a master question bank. Questions live in the bank and can be added to games from there. The same question can appear in multiple groups — it counts as one entry in the bank regardless of how many groups use it.

**Free Tier Bank Cap**

Question bank caps: free users 20 questions, Plus monthly 100 questions, Plus yearly 1,000 questions. Natural upsell for prolific writers — a creator who hits the free cap is exactly the kind of person who will pay.

**Filtering and Sorting**

Filterable by: category, tag, status (in game / in bank / archived), question type, sharing status (shared / not shared). Sortable by: date created, correct answer rate, star count, alphabetical.

**Audience Tags**

Private labels for personal curation — identifying which questions are right for which group. Free users: 3 tags per question. Plus users: unlimited tags and named presets.

**Question Analytics**

Each question in the bank shows: correct percentage, total times answered, stars received, most common wrong answers (top 3, anonymized). Common wrong answers allow creators to identify canonical answer gaps and add accepted alternatives.

For questions opted into the shared library, analytics also show: total pools played in beyond the creator's own groups, aggregate star rate across all pools.

---

### 8.4 Groups and the Group Game Model

**Creating a Group**

Game starter creates a group via the full web interface. The creation flow asks a single question: *"Who writes the questions?"* Three choices are presented in plain language — one person writes everything; one person starts, anyone can add after two rounds; everyone writes from the start. The group is named. The game starter seeds questions before inviting (Setup 1 and 2) or sets group context before inviting (Setup 3).

At game creation, the game starter also sets the pool sharing preference: *"Allow this pool to be used in similarity sharing after the game ends."* Default: on for Setup 1, requires explicit opt-in for Setup 2 and Setup 3. **`Implementation note (April 2026):** this consent is **product-specified** but **not yet persisted** — the `allow_similarity_share` column in Section 11 is **deferred** until the similarity-share flow reads it; do not assume the field exists in `Group` today.*

**Joining a Group**

All players join before the first round begins. There is no mid-game joining in MVP. New players join via personal invitation from the game creator. Setup 1 and 2: joining requires only authentication and onboarding. Setup 3: joining requires authentication, onboarding, and question contribution (see Section 8.6).

**Group Membership**

Max group size: **10 players**. Enforced in join and invite flows.
(`MAX_GROUP_SIZE` in `game-constants.ts`). Game starter can remove members via the
full web interface. Members can leave by replying STOP to any group SMS or via the
full interface.

**New Game Confirmation**

When a game ends, any active member can confirm the start of a new game — 
not just the game starter. There is no mandatory waiting period between 
games. A new game can begin immediately after the previous one ends.

When any active member taps "Start a new season," they are shown a single 
confirmation screen before the new game is created. This screen serves two 
purposes:

1. Confirm intent — a simple "Start now" action, with the group name and 
   game number pre-populated and editable.
2. Surface the contribution prompt — for Setup 2 and Setup 3 groups, the 
   confirmation screen also shows a warm, optional invitation to add new 
   questions before the game begins:

   *"Before you start — want to add any questions to the pool?"*

   One tap links to the question bank and contribution flow. One tap on 
   "Start now" skips it entirely. No gate, no minimum, no requirement.

The contribution prompt on the confirmation screen is the primary mechanism 
for between-game question contribution in Setup 2 and Setup 3. It replaces 
the time-gated off-season window. Players who want to add questions can do 
so from the full web interface at any time — the confirmation screen simply 
surfaces this as a natural moment.


---

### 8.5 The Game System

**What a Game Is**

A game is one complete arc through a group's question pool. A game begins when the pool meets the minimum question threshold and a member confirms it is ready. A game ends when all questions have been either answered or expired for all players, or when the 100-question pool cap is reached and exhausted.

**Game Lifecycle**

- **Phase 1 — Seeding and invitation:** Setup 1 and 2 game starters contribute questions and send personal invitations. Setup 3 members contribute during the joining flow triggered by the invitation. The invitation is the game start — there is no separate confirmation step.
- **Phase 2 — Active play:** New players receive their first 5 questions immediately upon completing authentication via the invitation link. From day two onwards, a noon EST SMS arrives daily with 5 fresh questions. Players answer within the 24-hour window or questions expire at the next noon EST reset.
- **Phase 3 — Game completion:** When all questions have been assigned and either answered or expired for every active player, the game is complete. All players receive an SMS with a link to the game summary.
- **Phase 4 — Next game: Any active member confirms the new game immediately 
after the previous one ends — no waiting period required. A confirmation 
screen gives Setup 2 and Setup 3 members the option to add new questions 
before the game begins. The new game begins with a fresh pool.


**Question Pool Cap**

A game's question pool is capped at 100 questions. At 5 questions per day, this represents approximately 20 rounds of daily play per player — roughly 3 weeks of daily sessions, a satisfying arc. This prevents games lasting months in large or prolific groups.

**Pool Minimum**

Minimum: 5 questions. Configurable server-side. A round cannot begin until at least 5 questions have been submitted and approved. This value is a placeholder and should be monitored from launch and adjusted server-side as real user behaviour warrants — no code change required to update it.

**Player Exclusion From Own Questions**

A player never answers their own questions. The daily assignment algorithm excludes questions where `question.creator_id = user.id`. This is a hard rule with no exceptions. In Setup 2 and Setup 3, a prolific contributor will have thinner days — their own questions fill slots they cannot access. This is expected and correct.

### Game Summary (Post-Ceremony Landing Page)

The Game Summary is a single-page post-ceremony landing experience — not a 
multi-screen sequential flow. It fires immediately after the ceremony ends 
and before the player returns to their normal home screen. It is the emotional 
handoff between the cinematic ceremony (§8.29) and the permanent Game Details 
archive (§8.30).

It is not a scoreboard. It is not a report card. It is the moment where the 
player understands — at a comfortable pace — what they discovered this game.

Route: `/groups/:groupId/games/:gameId`

**Design Principles**
- Warm and editorial in tone — not clinical or data-heavy
- Wrong answers are framed as discovery, not failure
- Authorship is visible throughout — every question belongs to someone
- No raw scores on primary surfaces
- No ranked leaderboard

**Persistence**
The Game Summary page persists indefinitely. There is no expiry. The game 
is always browsable from the group card after completion.


**Relationship to Other Surfaces**
- The ceremony (§8.29) is the emotional event — cinematic, sequential, 
  happens to the player. Accessible at `/groups/:groupId/games/:gameId/ceremony`.
  Persists indefinitely.
- The Game Summary page is everything after the ceremony — the emotional 
  handoff and the permanent archive in one surface. Reflective, scrollable, 
  warm, and always accessible from the group card.


**Note on the sections below:** The following five sections define the 
*content inventory* of the Game Summary page — what is present on the page 
and in what order. They are not separate screens or sequential beats. The 
player scrolls through all of it on a single page. Sections that have no 
data for the viewing player are omitted silently — no placeholder, no empty 
state.

The first four sections are the reflective handoff — discovery-focused, 
warm, editorial. The fifth section is the permanent archive layer — 
functional, browsable, always accessible.


---

The summary is accessed via the game completion SMS link. The Game Details 
page (§8.30) is the permanent archive, accessible from the Game Summary and 
from the game card at any time.


---

### Structure of the Game Summary

The Game Summary is organized into four sections, in order:

1. The Group Story (collective highlights)
2. Your Game (personal performance and standout moments)
3. What You Discovered (missed questions and learning surface)
4. The Group Portrait (identity and next steps)

---

### 1. The Group Story

A high-level view of what happened in this game as a shared experience.

Includes:
- Duration in days
- Total questions in the pool
- Number of contributors
- Group-level callouts:
  - Hardest question — lowest correct rate
  - Everyone knew this — highest correct rate
  - Most loved — highest star count
  - Only one person knew this — surfaced as a celebration of individual depth

These are framed as shared discoveries, not competitive rankings.

---

### 2. Your Game

A personal summary of how the player moved through the game.

Includes:
- Questions answered vs expired
- Category-level strengths (where the player consistently answered correctly)
- Category-level discovery areas (where the player struggled)
- Standout moments:
  - "Only you got this"
  - "You and [Name] both knew this"
  - "This question was written for you" (when applicable based on authorship patterns)

Language emphasizes recognition and connection, not performance.

---

### 3. What You Discovered

This is the core learning surface of the Game Summary.

This section contains **all questions the player answered incorrectly or allowed to expire**, presented as a structured discovery set.

Each question is shown as a full card with:

- Question text
- Author name
- Category (hyper-specific)
- The correct answer
- Full educational explainer (expanded by default)
- Creator note (if present), surfaced prominently:
  - "[Creator Name] added this because →"
- Player’s submitted answer (if applicable)
- Optional reaction thread (if any occurred)

The section is introduced with framing copy:

> "These are the edges of your map — the parts of your shared world you hadn’t explored yet."

Design principles:
- This is not a list of failures — it is a collection of discoveries
- Cards are visually equal to correct answers — no diminished styling
- No aggregate "incorrect count" is emphasized
- No percentage framing is used here

Optional interactions:
- "Add to my bank" — save the question for future use
- "Try again" — open **Replay** (`/replay`) (no score, no pressure) — see §8.40

Questions are ordered by relevance, not chronology:
- Questions with creator notes first
- Then questions with high group significance (e.g. stumped many players)
- Then remaining questions

---

### 4. The Group Portrait

A synthesized view of the group's shared intellectual identity.

Includes:
- LLM-generated group identity description:
  - A short paragraph describing the group’s intellectual world
- Category distribution across the pool
- Overlap signals (where the group is strongest together)

Framed as:
> "This is the world you built together."


---

### 5. The Season Archive

The permanent record of the season. Always accessible from the group card 
after game completion. Never expires.

**Contents:**

- Full question and answer history — every question that passed between 
  this group, in chronological order, with results, correct answers, 
  educational explainers, creator notes, and reaction threads
- Category breakdown across the full season — all questions grouped by 
  domain, showing the full shape of the group's intellectual world
- Group Knowledge Map snapshot — the same data as ceremony Beat 3 (§8.29e), 
  rendered as a static, explorable map
- Group-level stats — team % correct, hardest question, most loved, only 
  one person knew this, group identity portrait (from §8.18)

**Post-Game Actions**

*Primary — forward-looking:*
- `Start a new season` — pre-populates same group, editable before sending
- `Add more questions` — opens question creation / bank selection

*Secondary — retrospective:*
- `Revisit the moment` — replays the closing ceremony (links to `/groups/:groupId/games/:gameId/ceremony`)
- `Revisit missed questions` — links to catch-up mode for any expired 
  questions from the season

**Label note:** "Revisit the moment" — not "Replay summary." The label 
should feel meaningful, not mechanical.

**Design principles:**
- The archive section sits below the reflective content — the player 
  arrives at discovery first, then has the full record available to explore
- Visually distinct from the four reflective sections above — cleaner, 
  more functional, less editorial
- The transition between section 4 and section 5 should feel like moving 
  from a curated experience into a library — not a jarring shift, but a 
  clear change of register


---

### Design Principles of the Game Summary

- The summary interprets — it does not just report
- Wrong answers are treated as expansion, not failure
- Authorship is visible — every question belongs to someone
- The player leaves with a clearer sense of:
  - what they know
  - what they didn’t know
  - who in the group carries which knowledge

---

### Relationship to Other Surfaces

- The End of Session Review introduces discovery at a micro level (per day)
- The Game Summary consolidates discovery at a macro level (entire game)
- The Question Archive persists all content, but without narrative framing
- The Game Summary is the only place where missed knowledge is intentionally curated and presented as a cohesive experience

---

### Anti-Goals

The Game Summary must NOT:
- Feel like a test review or report card
- Emphasize incorrect counts or failure rates
- Rank players by performance
- Collapse missed questions into a hidden or secondary surface

The purpose is reflection and recognition, not evaluation.

---

### 8.5a The Creator's Summary

**Philosophy**

The game creator in a Setup 1 ("One Curator") game has a unique role. They do not answer questions and therefore do not have a personal performance to review. However, they are the most valuable member of the group, responsible for curating the entire experience. Their end-of-game reward should be tailored to their role, acknowledging their contribution and providing insights into how their world was received.

The Creator's Summary is a dedicated, creator-only experience that is distinct from the player ceremony. In Phase 2, it will serve as their primary reward and a key retention mechanic.

**Phase 2 Feature**

The Creator's Summary is a Phase 2 feature and is not in scope for MVP. 
In MVP, the Setup 1 host/curator who answered no questions sees the Game 
Details page (§8.30) on game completion, which surfaces their question 
analytics — correct rates, star counts, and reaction threads. The dedicated 
Creator's Summary experience described below is the target Phase 2 design.

**Trigger (Phase 2)**

The Creator's Summary will be shown to the `game_starter_id` upon game 
completion if and only if they did not answer any questions in the game 
(i.e., they acted purely as a host/curator). It is accessed via the same 
game completion link.

**Structure of the Creator's Summary**

The summary is presented as a multi-screen, data-rich narrative, similar in spirit to the ceremony but focused on curation and connection.

**1. The Group's Journey Through Your World**
- A high-level overview: Total questions played, duration, number of players.
- **Your Most Resonant Questions:** A "top 3" list of the creator's questions that received the most stars.
- **Your Hardest Questions:** The creator's questions with the lowest correct-answer rates, framed as "the deepest cuts."
- **Your Most Common Ground:** The creator's questions with the highest correct-answer rates, framed as "the heart of your shared world."

**2. Who Knew You Best**
- A ranked list of players based on their intellectual alignment score with the creator.
- For the top-aligned player: *"You and [Player Name] share the most common ground. Your strongest overlap was in [Category]."*
- This provides a direct, meaningful answer to the implicit question, "Who gets me?"

**3. What They Discovered**
- A view of which questions generated the most discovery (i.e., were most frequently answered incorrectly).
- Highlights questions where a creator note was present and viewed, reinforcing the value of adding context.
- Surfaces reaction threads, showing the creator the conversations their questions started.

**4. The Next Chapter**
- A clear call to action to start the next game, pre-populating the same group.
- Prompts to add new questions, surfacing the creator's question bank.

**Anti-Goals**
- The Creator's Summary must NOT show the creator's own (non-existent) score or rank.
- It must NOT feel like a generic analytics dashboard. The tone is narrative and celebratory.

---



**Game Completion Credit**

A player's game completion only counts toward personal stats if they actively answered at least one question during that game. Players who let every question expire across an entire game do not receive game completion credit.

The game completion SMS links to the Game Summary page 
(`/groups/:groupId/games/:gameId`), which fires immediately after 
the ceremony and persists indefinitely as the permanent record of 
the season. The ceremony (`/groups/:groupId/games/:gameId/ceremony`) is the
emotional event; the Game Summary page is both the reflective
handoff and the permanent archive.




---

### 8.6 Setup 3 — Joining Flow and Question Contribution


**Philosophy**

In Setup 3, contribution is the price of admission. You bring something from your shared world when you arrive. The game starts with everyone invested. There is no gate, no free play period, no later ask — you contribute to join, and then you play.

**The Joining Flow**

After authentication and onboarding, Setup 3 players complete the question contribution flow before their first session. They are shown 3 example questions already in the pool — so they immediately understand the register and territory of this specific group.

They are then asked to add 5 questions from their shared world. The interface is stripped down:

- *"Add questions to [Group Name]"* header
- Context line showing what kind of questions are in this group (set by game starter)
- Question text input — large, full width, with prompt: *"What piece of your world belongs here?"*
- LLM answer suggestion appearing inline after 1 second
- "Use this answer" / "Write my own" choice
- Answer text input
- Add this question button
- Progress: "2 of 5 added"
- "Done — I'm ready to play" button, enabled after 5 questions added

**Example Questions in the Joining Flow**

Before the contribution prompts, the joining flow shows 3 real questions already in the pool (without revealing answers). This is the most important design element in the flow. The examples must feel warm, specific, and a little show-offy — they set the register for what great Joshing questions look like in this group. Generic examples kill conversion. Questions drawn from real shared cultural history create immediate excitement.

**Adding Questions in Subsequent Games**

For each new game, Setup 3 members are invited to add questions via the 
confirmation screen that appears when any member starts a new game. This 
is optional — existing pool questions can carry over. There is no minimum 
contribution per game after the initial joining contribution. Players who 
want to add questions can also do so from the full web interface at any 
time before the new game begins.


---

### 8.6a Setup 2 — The Open Round

**What the Open Round Is**

Setup 2 plays exactly like Setup 1 for the first two rounds. The game starter's questions, daily sessions, no contribution asked or expected. After round two — after every player has completed two daily sessions — the open round begins. The pool stays open. Anyone who wants to add questions can.

The open round is not a new phase with different mechanics. The daily session and
chat thread work the same as Setup 1. **Share card in the daily thread** is a
**target** (§8.12); the **current** close uses **session close messaging** + links
without an inlined share card. There is no session timer.
Today's 5 questions are always presented first in assigned order. At the end of
today's questions, if prior unanswered questions exist from the current round, the
player is immediately prompted to catch up within the same session flow.

**The Open Round Invitation**

After a player completes their second round, the daily summary includes a soft, optional invitation at the bottom — **below** the main close / summary block (when an in-thread share card ships, it would sit above that close; **current app:** no in-thread share card — see §8.12). Plain-language reference — *"tomorrow at noon"* style for invitations; **no** countdown or urgency. A **Round complete** line may still show a static *Next round opens …* from `expires_at` (§8.38). See §8.38.

One tap links to the contribution flow. Nothing else changes. The next day's SMS arrives at noon as normal. Players who don't tap the invitation never see it again — it is shown once, on the daily summary after round two, and does not reappear.

**Contribution Is Genuinely Optional**

No gate. No minimum. No access pause. No reminder SMS. The invitation is shown once. After that, players who want to contribute can do so from the full web interface at any time. Players who never contribute play indefinitely on the game starter's questions.

The copy is critical: this must read as an open door, not a prompt. "You can" not "it's time to." "If you'd like" not "before Round 3 begins." The tone is generous and unhurried.

**Surfacing the Question Bank**

When a player opens the contribution flow — either from the one-time invitation tap or from the full web interface — the first thing they see is their personal question bank, not a blank text field. If they have existing questions in their bank that are not already in this game, those questions are surfaced immediately:

> *"You have [N] questions in your bank. Want to add any to College Friends?"*

Questions from the bank are listed with their text and category. One tap adds a question to the game. Below the bank section, a prompt to write new questions appears. The bank comes first — it is the lowest-friction path for players who already have questions written for other groups.

**The Pool Floor Message**

In Setup 1, when a player exhausts their assigned questions, the daily SMS is suppressed and replaced with: *"You've answered all the questions in [Group Name]. Watch for the Game Summary soon."*

In Setup 2, during the open round, new contributions may still be arriving. If a player's assigned questions run out, the message instead reads:

> *"You've caught up in [Group Name]. Check back — more questions may be on the way."*

This message is sent for a maximum of 7 days. If no new questions have entered the pool after 7 days, the message reverts to the game-ending copy and the game summary is triggered.

**How Contributions Enter the Pool**

Contributions go straight into the pool with no approval required. Every question
has an author in data; **during play**, when that author is shown on the result
flash follows §8.9. The pool has no hierarchy. The game starter
can also keep adding questions throughout the open round. The 100-question game cap
applies to the combined pool.

**Tracking Open Round Contributions**

The GROUP_MEMBERS table tracks `open_round_contributed` (boolean, default false) — set to true when a player adds at least one question after round two. This is for analytics and personal performance display only. It has no gameplay effect.

---

### 8.7 Daily Session — The Wordle Model

**The Core Mechanic**

The daily session is directly and deliberately inspired by Wordle. Every day at noon
EST (17:00 UTC), all players across all groups simultaneously receive their daily SMS
with a link to that day's questions. 5 questions every day. There is no session timer.

Today's 5 questions are always presented first in assigned order. At the end of
today's questions, if prior unanswered questions exist from the current round, the
player is immediately prompted to catch up within the same session flow.

**Catch-Up Eligibility**

5 questions are released each day at 12 PM EST for as long as the round is active.
All unanswered questions from any prior day in the active round remain catchable —
there is no rolling per-question expiry window while the round is live. The round
being active is the only gate for catch-up eligibility.

**Post-Game Catch-Up Window**

After a round ends, all unanswered questions from that round remain playable for
**7 days**. After those 7 days, unanswered questions are closed and move to the
archive only.

**Catch-Up Mastery Weight**

Catch-up answers — whether answered during an active round or during the 7-day
post-game grace period — count at **0.25x weight** toward mastery scoring. This
applies in both windows without distinction.

**Always 5 Questions**

Every session is 5 questions — the first session and every subsequent session.
There is no special day-one question count.

**The Daily SMS**

Sent at noon EST from day two onwards:

> *"Your [Group Name] questions are ready. 5 questions, answer by noon tomorrow: [link]"*

The link is unique to this player for this day and contains an authentication token so returning players go directly to their questions.

**SMS Batching**

If a player has questions available in 2 or more groups on the same day, a single batched SMS is sent instead of multiple messages:

> *"You have questions waiting in College Friends and Family. Answer by noon tomorrow: [link]"*

The link takes them to a group selection screen. The threshold is 2 or more groups. This prevents the daily SMS rate limit being hit through normal two-group usage.

**The Daily Reset**

At noon EST (17:00 UTC) each day, any of the previous day's 5 questions that have not been answered "expire" from the live session. This transition is permanent and unconditional. Expired questions are no longer part of the live session but become immediately available in catch-up mode for the duration of the active round (see §8.19). The constant DAILY_RESET_HOUR_UTC = 17 governs all expiry calculations.

**When the Game Pool Runs Low**

When a player's portion of the pool is exhausted, their daily SMS for that group is suppressed and replaced with: *"You've answered all the questions in [Group Name]. Watch for the Game Summary soon."*

---
### 8.8 The Daily Question Page — Chat Thread

The daily question page is the most important screen in the product. It is a single scrolling chat thread. Questions arrive as left-aligned message bubbles. Answers go right. Results appear as system messages. The whole session is one conversation.

**Chat Thread Principles**

- The session has a history. The player can scroll up at any time to review earlier questions and results.
- The session flows naturally into the **daily summary** (§8.12–8.38) at the bottom
  of the same thread — no navigation, no transition. **Current app:** summary ends with
  session close + links (§8.38); **no** inlined share card (§8.12).

**Progress Track**

Five segment dots in the header spanning full width. Always 5 dots — every session. Dots stay in original question order regardless of skip reordering. States: green (correct), red (wrong), light grey (expired/time-out), hollow (skipped, question in deferred queue), dimmed (queued, not yet reached), dark and slightly taller (current).

**Keyboard Behavior**

The answer textarea is auto-focused when the first question appears. The keyboard opens immediately. No delay, no tap required to focus.

**Performance**

Load time under 2 seconds on 4G. Server-side rendered. Works on Safari iOS, Chrome Android, Samsung Internet, Chrome desktop, Firefox desktop. Every tap target at least 44x44 points.

---



### 8.8a Breadcrumb System

Breadcrumbs are short, lightweight system messages that appear after each answer.

- 2–6 words
- No explanations
- No facts
- Observational tone

Examples:
- "you both know this"
- "not your lane yet"

Breadcrumbs create emotional continuity during play. **Full educational explainers**
stay in the End of Session Review. Breadcrumb copy **may** name the question author
when the product surfaces author attribution during play (see §8.9); it must remain
short and observational — no explainer prose in the breadcrumb itself.

---

### 8.9 Answering a Question


**Text Input**

Clean text input field. Auto-focused so keyboard appears immediately. Player types answer and taps Submit or presses Enter. Submissions are final — there is no edit window after sending.

**The Skip Mechanic**

The skip button appears as small italic dotted-underline text inside the question bubble itself: "skip — come back later". It is visible only on the current (most recent) question bubble, and only when more than one question remains in the queue.

Skipping defers the question to the back of the queue without recording a result. The progress dot for a skipped question becomes hollow — an unfilled circle. There are always exactly 5 slots. A skipped question does not create a sixth slot; it occupies its original slot in hollow state until answered or expired.

A player cannot skip the same question twice. Skip disappears when only one
question remains. Skipping has no time cost — there is no session timer.
The deferred question returns at the back of the queue.

The share card shows the final result only: correct, wrong, or expired. A skipped
question that was not answered before the daily reset shows ⏱️. A skipped question
that was subsequently answered shows its actual result — ✅ or ❌.


**Grading**

LLM grading. Immediate result: correct or wrong. The grading rules are specified in Section 9.3. 

**Grading Dispute Mechanic**

On any result screen, a small "dispute this grade" link allows the player to flag a result they believe is incorrectly graded. Tapping it logs the submitted answer, canonical answer, and question ID for the question creator's review. The grade shown to the player does not change immediately — the creator reviews it and can add accepted alternatives, which affect future gradings but not the disputed one.

Disputed grades are surfaced in the creator's question analytics view, grouped with common wrong answers.


**The Author Reveal**

After each answer, the result appears immediately in the thread — correct or wrong,
with the canonical answer if wrong. No **educational explainer** in the thread (see
**Educational Explainer — End of Session Only** below in §8.9).

**During live play — by setup**

- **All setups:** The question author’s display name **may** appear on the question
  row, in breadcrumbs, and in result / wrong-answer copy that names the writer. The
  API **may** include `creator_name` (or equivalent) for play clients. Momentum is
  preserved by keeping **full educational explainers** and **creator notes** out of
  the live thread (see below).

**End of Session Review:** The author is shown for every question, all setups —
*"Asked by [Name]"* / equivalent — with explainers, notes, and stars. No vote, no
gate.

**Correct Answer Copy — Connection, Not Congratulation**

A correct answer in Joshing is not just a right answer — it is a moment of proof. Proof that you share a world with the person who wrote the question. The copy that appears after a correct answer must reflect this. Rotate between variants so it doesn't feel mechanical:

- "Well done." with sub-label "common ground +"
- "There it is." with sub-label "common ground +"
- "You both carry that." with sub-label "common ground +"
- "Knew it." with sub-label "that's your shared world"

These phrases acknowledge the relationship, not just the performance.

**Wrong Answer Copy — Discovery, Not Judgment**

A wrong answer is a discovery — something from the group's shared world the player hasn't yet explored. The copy that appears after a wrong answer must reflect this. Rotate between variants:

- *"Not this time — here's the answer."*
- *"You'll know this one next time."*
- *"This one belongs to [Creator Name]'s world — now it's in yours too."* — allowed
  in-thread whenever the writer’s display name is available (all setups).
- *"Close, but not quite. The answer was [X]."*

The third variant — *"now it's in yours too"* — is the most important. It frames the wrong answer as an expansion of the player's world. See Section 8.22 for the full wrong-answer treatment.

**Educational Explainer — End of Session Only**

Explainers are shown in the End of Session Review, not in the chat thread. Each question card in the review shows a truncated explainer (roughly **150** characters in the current app) with a **more** tap to expand the full text. The stored copy is a single neutral factual reflection per question (see §9.4), not separate “correct vs wrong” variants in production. Keeping explainers out of the thread preserves session momentum and means the player encounters them in a calmer state — after the pressure is off — when they can actually absorb them.

---

### 8.10 End of Session Review and Voting

Shown at the end of the chat thread after all questions are answered or the
session window closes.

**Correct Answer Feedback — In Thread**

When a player gets a question right, the response is warm and specific rather than generic. Correct answer copy and sub-label pairings are specified canonically in §8.9. The same rotation applies in the End of Session Review. These appear as the sub-label on the result bubble.

**Content — Each Question**

- Question text
- Author name (revealed here for all setups; may already have been visible during
  play — see §8.9)
- The player's submitted answer
- Correct / wrong / expired
- Full educational explainer
- Dispute link
- Star vote button
- For correct answers: creator note accessible as a quiet expandable link — *"why Josh added this →"*
- For wrong or expired: creator note surfaced automatically as an expanded card, visible by default — *"[Creator Name] added this because →"*; **Replay** link to `/replay?group=…&game=…` — implementation copy may read *"Practice missed in Replay"*; same intent: *"Want to try it again? No score — just for you."* (see §8.40)

**Standout Moments**

The review surfaces two specific question callouts: the highest shared moment (a question both player and creator are strong on, by category) and the 'only you got this one' moment — a question the creator wrote expecting this player to know it, which nobody else in the group got right.

The 'only you got this' moment receives distinct visual treatment — a subtle mark, a different colour, a small label. Not loud, but unmistakable. The player should feel it before they read it.

**Near-Miss Acknowledgment** *(not yet built)*

When the grader accepts an answer under the leniency rules — a spelling variant, a phonetic near-match, an abbreviated form — the result card shows a small secondary label: 'accepted variant.' This builds trust in the grader and acknowledges the moment.

**Voting and Author Reveal**

2 stars per player per day per group. Stars can be given to any question in the review — today's session and any archive question. Stars can be moved (unstar one, star another) within the daily budget. Stars cannot be added beyond the budget. Starring notifies the question author via SMS.

Intentional design: players can vote on questions they answered incorrectly or that expired. Stars measure question quality, not player performance.

**Author Reveal — All Setups**

The author's name is **always** shown in the End of Session Review for every
question, regardless of setup type. No vote or action is required. **During play**,
author visibility follows §8.9: names **may** already appear in the thread; momentum
is preserved by keeping **full explainers** and **creator notes** for the review
surface, not by forbidding author attribution in play.

In all setups, on the review card the author's name appears clearly, e.g.
*"Asked by [Name]."*

**Round Score and Mastery Category Breakdown**

After the End of Session Review, the round score display shows a per-category
breakdown with mastery progress. For each category that scored this round, a progress
bar reflects position within the current tier. The aggregate total is visible but
secondary. If a tier threshold was crossed during this round, a brief full-screen
mastery moment fires after the breakdown (see §8.32). Only categories that scored
this round are shown.


**Round Review Category-First Failure Contract (normative)**

To enforce the Mastery display hard rules and the prohibition on Other/uncategorized labels:

- Any round-review row intended for category-first rendering **MUST** include a valid `canonical_subcategory`.
- If `canonical_subcategory` is missing, null, empty, or fails canonical validation for that row, the client **MUST** suppress that row from rendering.
- The client **MUST NOT** render fallback labels or substitutes, including `"Other"`, `"Uncategorized"`, `"Unknown"`, or generic stand-ins.
- The server and/or client **MUST** emit telemetry for each suppressed row with enough identifiers to debug upstream tagging/data issues (minimum: `game_id`, `round_id`, `question_id` or row source id, `user_id` when available, rejected raw label/value, suppression reason, and timestamp).
- Suppression **MUST NOT** block or fail the rest of the End of Session Review; valid category-first rows continue rendering.

---

### 8.10b Question Reactions and Micro-Conversations

After each session, players can react to individual questions in the End of Session Review. This is the primary social response layer in the product — the mechanism through which a game about shared knowledge becomes an actual conversation between people.

**The Two-Tier Reaction Model**

Reactions work on two levels. The first is a canned response — one tap, no friction, covers the common case. The second is an optional short personal note, up to 100 characters, for the moments that need more than a canned phrase can hold.

**Canned Responses — Answerer to Creator**

Shown below each question card in the End of Session Review. Standard options:

- "I always knew that." — for confident correct answers
- "You got me with this one." — for wrong answers or close calls
- "Of course it was you." — the recognition moment
- "Never heard of this." — genuine discovery; I learned something
- "We need to talk about this." — for questions that open a bigger conversation

For wrong answers, discovery-oriented options are presented first:

- *"Didn't know this — tell me more."*
- *"Now I need to know the story behind this."*
- *"Adding this to my list."*
- *"You knew I wouldn't get this, didn't you."*

**The Personal Note**

Below any canned response option, a secondary prompt: "say more →" — a small optional text field, 100 characters maximum. The character limit is deliberate — it keeps it a moment, not an essay. If they have more to say, they should say it in person. That's the point.

**Creator Responses**

When a creator receives a reaction, they can respond with their own canned reply or a short note:

- "Knew you'd get it."
- "I'm surprised you knew that!"
- "This one was just for you."
- "There's a story here." — invites the other person to ask

**Where Reactions Live**

Reactions are NOT shown during the session. They appear in the End of Session Review and persist in the archive. Each question card in the archive shows the full reaction thread below it. Over time, the archive becomes a record not just of what was asked and answered but of the conversations the questions opened.

**Notifications**

When an answerer sends a reaction or note, the creator receives an SMS (if opted in): *'[Name] reacted to your [Category] question.'* When the creator responds, the answerer is notified: *'[Name] replied to your reaction.'* Notifications are grouped per session — one notification per session per person, not one per question.

**Data Model**

Table: QUESTION_REACTIONS. Fields: id, question_id, game_id, from_user_id, to_user_id, canned_type (nullable enum), note_text (nullable string, max 100 chars), parent_reaction_id (nullable, for creator responses), created_at. Indexed on (question_id, game_id) and (to_user_id).

Reactions are private to the pair — only the from_user and to_user see the note text. Other group members are not shown reaction content. The question's star count and correct rate remain group-visible; the conversation is one-to-one.

**Design Constraint**

This feature must feel optional at every step. Most questions will never have reactions. The ones that do will be memorable. The interface should never make a player feel obligated to react, or a creator feel that unreacted questions are failures.

The creator side of the emotional loop is as important as the answerer side.
**Target:** a creator stats strip on the home hub (questions in play, correct
answers received, stars). **Implementation:** not on `/groups` cards today — see §8.16.

When a player's question receives a star, they receive an SMS notification immediately: "[Name] starred your question in [Category]." This is the highest-value notification in the product.

---

### 8.11 Question Archive

Full browsable archive of every question assigned to the player in this group — answered, wrong, and expired. Multiple views:

**Chronological view** — default. Every question in order, with results, explainers, reaction threads.

**Category view** — all questions grouped by domain, so the group can see the full shape of their intellectual world in one view.

**"Questions that stumped us all"** — a filtered gallery of questions nobody got right, with answers and creator notes. The map of what the group collectively doesn't know yet. Framed as territory to explore, not a failure record.

**"Our best questions"** — sorted by combined star count and correct rate. A hall of fame for the questions that defined the game.

Filterable by author, category, game, result, most starred, chronological. Expired questions show: *"You didn't get to this one"* — followed by the correct answer and full explainer.

The archive is the record of the game — every question that has ever passed between this group, with answers, explainers, star counts, and reaction threads. It is not primarily a retention mechanic. It is a document. Over time it becomes a portrait of what this particular group of people knows and cares about.

**Replay**

Any question the player got wrong or that expired can be attempted again in **Replay** (`/replay`) — no score recorded, no impact on any stat. Questions are the **same human game cards** (not AI-generated). Surfaced from review with link copy such as *"Practice missed in Replay"*; wrong-answer cards may also use *"Want to try it again? No score — just for you."* See §8.40.

---

### 8.12 Daily Summary

Appears at the bottom of the daily chat thread after the End of Session Review is complete. It is the final element in the thread, requiring no navigation or screen transition.

**The Summary Interprets, Not Just Reports**

The daily summary should not merely list what happened — it should notice what happened and say something specific about it. The summary runs a small set of interpretive checks and surfaces the most relevant one as the opening line, before scores and stats.

Interpretive triggers and their copy:

- **5/5 correct:** *"Clean sweep. [Name] will be surprised."* Different visual treatment — the result card gets a distinctive mark.
- **0/5 correct:** *"Rough one. [Name]'s world is different from yours — that's interesting, not a failure."*
- **2 or more wrong answers:** *"A few new things in today's questions — that's the game working."*
- **All wrong in one category:** *"[Creator] goes deep in [Category] — good to know."*
- **Perfect score after a wrong start:** *"Strong comeback."*
- **3 or more correct in a row:** *"You hit a streak — 3 in a row."*
- **Every member scored the same:** *"Everyone in the group got [X]/5 today. Unusual."*
- **First time a category appears and player gets it right:** *"First time you've answered a [Category] question in this group. You knew it."*
- **Question that nobody got right:** *"Nobody got that one easily. You're in good company."*
- **Question that everyone got right:** *"Everyone knew this one. It's part of your common ground."*
- **Only you got it right:** *"You were the only one who knew this."* Surfaced prominently — this is the product's core promise made concrete.

Only one interpretive line per session — the most notable one, chosen by a simple priority hierarchy. The wrong-answer interpretive lines rank below exceptional performance moments but above generic summaries. The interpretive line is reserved for genuinely noteworthy moments; overuse destroys its value.

*"[Name]" in the above copy strings resolves dynamically to the game starter's `display_name` at render time.*

**Content**

- **Score today:** **Shipped:** **Round complete** block with large **`+N`** for
  points earned today (`pointsToday`). Warm interpretive lines above remain per
  triggers; this card is the numeric “today” beat in-thread.
- **Whose questions:** For each question, who wrote it and how the player did.
- **Compatibility shifts:** Any meaningful score movements.
- **Vote summary:** What the player voted on. Votes remaining.
- **Game progress:** Warm description of where the game stands.
- **Creator performance card** *(not yet built)*: how each of your questions performed today.
- **Share card:** **Target:** mastery-momentum card with Copy / Share at the very
  bottom of the daily summary (§8.13, §8.36). **Implementation (current app):** the
  daily thread **does not** embed the share card after review — terminal UI uses
  **`SessionCloseMessage`**: adaptive close copy (§8.38), primary **Review today’s
  answers** link, and **Knowledge** link (`SessionCloseMessage.tsx`). Copy/Share
  share-card UI is deferred for this surface; ceremony / other flows may still use
  §8.36.
- **Post-game similarity share:** Available on game completion screen — *"Find out if someone shares your world"* — distinct from the result card share.
- **Session close messaging:** See §8.38 for adaptive close message copy and placement rules.
- **Link to full interface:** Unobtrusive, at the very bottom.

---

### 8.13 Shareable Result Card

*(Unchanged except the following — share card format updated)* **Daily chat thread:**
the card is **not** inlined at summary end today — see §8.12 **Share card**
implementation note.

**The Primary Share Card — Mastery Momentum Format**

The primary share card surfaces the domain or domains where the player gained the
most ground this session. It is personal, domain-forward, and tells the player's
knowledge story — not their score. See §8.36 for the full share card system
specification.

**The Secondary Share Card — Emoji Grid**

The original emoji grid format is preserved as a secondary format, accessible via
a small "show result grid" toggle below the primary card. Same one-tap copy behavior.

**Shareable Link Expiry**

The public page expires 90 days after the session date. After expiry, the page shows: *"This result is no longer available. Joshing is invitation-only — ask someone to invite you."*

**Category Emoji Map**

| Category | Emoji |
|---|---|
| Music | 🎵 |
| Literature | 📚 |
| History | 🏛️ |
| Film and Television | 🎬 |
| Sport | ⚽ |
| Science | 🔬 |
| Philosophy | 💭 |
| Pop Culture | 🎭 |
| Language and Words | 💬 |
| Cross-topic | ❓ |

Note: ⭐ reserved exclusively for the star vote indicator. Rows with `category = other` **MUST** use this presentation; user-facing copy **MUST NOT** render the literal string "Other" as the category name (same prohibition as §8.10). Full set must be validated for consistent rendering before development begins. See Section 19, Open Question 4.*

---
### 8.14 Intellectual Alignment

For each ordered pair of players within a group, the system tracks how many of Player A's questions Player B has actively answered (not expired) and how many were correct. Directional and asymmetrical. This score is presented as intellectual alignment — a measure of shared reference points and common ground, not just trivia skill.

Display language: *"You and [Name] are a great match — 80% alignment."* Broken down by category where data permits: *"Your strongest overlap is in Music and Literature."* The framing celebrates shared intellectual world rather than scoring performance.

**Display in full web interface:**

- *"Who knows me best"* — people ranked by correct percentage on your questions
- *"Who I know best"* — people ranked by your correct percentage on their questions
- Category breakdown: alignment score per category for each pair

**Category Alignment as Living Display**

The group home card **target** is a simple category affinity map — updating after each session:

> *College Friends: Music ████████ 85% · Literature ██████ 65% · Philosophy ████ 40%*

This tells each player at a glance where the group is strongest and where there are gaps. It is not competitive — it is descriptive. The group looking at itself.

**Implementation (current app):** `/groups` hub cards **do not** show this map (or team % correct). Cards focus on session state, who has played today (when `today_progress` has data), catch-up remainder, last activity, and round progress — see §8.16.

**Individual Category Profile**

Each player's personal profile within a group shows their own category profile compared to the group's — where they over-index (the areas where they carry the group's knowledge) and where they under-index. Framed as: *"Philosophy is where you have the most to discover in this group."* Not a judgment — a portrait.

**Minimum Threshold**

At least 5 questions actively answered between a pair. Expired questions excluded from both numerator and denominator. Alignment scores are not weighted for question difficulty in MVP.

**Alignment Shifts**

Surfaced in the daily session review whenever a score moves meaningfully: *"You now know [Name] 80% of the time — up from 65%."*
---

### 8.15 The Full Web Interface

Accessible from the daily question page footer link and directly via the Joshing website. Mobile-first, fully functional on desktop.

**For All Players**

- Home / Today screen (`Your Games` inbox): game cards prioritised by playable state (`GET /api/groups` + `GroupsClient`). Each card includes group name, round/member meta, status lines (e.g. questions waiting, who has played today when counts exist, catch-up remainder + deadline, ceremony-anticipation copy when round totals are known), optional **last-activity** line in following states, primary CTA (**Play now** or **Check in** to game details), **Manage** for secondary actions, and triangular **round-progress** glyphs when applicable. **Not on cards today:** team % correct, category alignment snapshot, host-editable tagline as a dedicated strip, or a **creator stats** strip (questions in play / correct answers received / stars earned). There is no separate **See stats** link on the card — players reach recap/detail flows via **Check in** and related routes.
- The **Play now** path is omitted when the card state is not “questions waiting” (e.g. after today’s play, **Check in** replaces it).
- Stats page (`/stats`): dedicated per-group, per-game snapshot view. Opens to most recently used group and game context if no explicit query params provided.
- Group detail: Today's status, tabs for Archive, Group Map, Alignment, Members
- Question archive: Full browsable archive per group — chronological, category, stumped-us-all, and best-questions views
- Intellectual alignment: category alignment display, individual category profile, who knows me best / who I know best
- Group Knowledge Map (`/leaderboard`): Contributions view and Game History view — see Section 8.18
- Personal performance: Private stats across all groups — session history, category breakdown, streak, alignment trends, similarity history
- Settings: Display name, timezone, SMS preferences, sharing preferences, leave group options
- Question contribution: Simplified mobile flow for adding questions to games
- Author profile (`/authors/[slug]`): publicly accessible — see Section 8.26

**For Game Starters (additional sections)**

- Full question creation interface with LLM suggestion and public pool opt-in toggle
- Master question bank with filtering, curation, sharing status, and common wrong answer analytics
- Group creation flow with three-option setup selection and pool sharing preference
- Group management: member management, game confirmation
- Public question distribution controls and review interfaces *(Phase 2)*
- Results view: how each question is performing, disputed grades, wrong answer prompts

**Question Bank in Contribution Flows**

Wherever a player can add questions to a game — Setup 3 joining flow, Setup 2 open round, or between-game contribution windows — the contribution interface surfaces their existing question bank first. Questions already in the game are excluded. A player with questions in their bank sees them listed with one-tap add. A player with an empty bank sees only the new-question creation flow. The bank-first pattern reduces friction for experienced players significantly.

**Navigation**

Simple and flat. Mobile-first. Primary nav (exactly 4 items):
**Home → Questions → Knowledge → Account**. The Group Knowledge Map is accessible
at `/leaderboard` via other entry points. Additional routes: `/about`,
`/public-games` (coming soon), `/authors/[slug]`.

Post-login landing: `/groups`.

---

### 8.16 Home Hub and Navigation

Post-login, users land on `/groups` — the Home hub. The client buckets groups into sections (active/playable, waiting, archived) from `GET /api/groups`.

1. **Active / Playable** — Games with an actionable or “following” play path. **Cards (shipped):** group title; **round label** + **member count**; primary **status** copy from hub logic (e.g. “Questions waiting”, “N of M played today”, “Everyone has played this round”, catch-up remainder + days to play, “Opens soon”); optional **following** secondary line = **last activity** (`last_action_at` / actor — not points, not creator stats); **primary CTA** — **Play now** (`/play?group=&game=`) when pending > 0, otherwise **Check in** (`/groups/:groupId/games/:gameId/details`) or setup link during seeding; **Manage** menu (details intent, ceremony when completed, owner flows); **TriangleRow** round-progress indicator (▲ glyphs) when not in the compact “completed” card layout; optional ceremony-anticipation line when completed/total rounds are known. **`today_progress`** drives “who played today” when `has_data`; **`points_today` / `points_total`** are returned by the API but **not** shown on the hub card (the following meta helper currently surfaces only last-play time). **Not shipped on hub cards:** team % correct, category alignment snapshot, creator contribution strip (questions in play / correct received / stars), or a dedicated stats shortcut label.
2. **Waiting for refresh** — Games where today’s session is complete for you or the window has not opened yet (per client sectioning).
3. **Archived** — Hidden behind a "See Archived" link. Shows games whose 
   status is `archived`. Each archived game links to its Game Summary page 
   at `/groups/:groupId/games/:gameId`.

**Round / longevity:** Game count and round copy come from `current_game` and card helpers (e.g. “Round n” / ceremony distance), not a separate “Game 3” badge unless the UI copy includes it in the round label.

Primary navigation: **Home → Questions → Knowledge → Account** (exactly 4 items).
The Group Knowledge Map remains accessible at `/leaderboard` via other entry points.

---

### 8.17 Game Ownership and Archive

The player who starts a game (`game_starter_id` on Group) is the **owner**. Owners have full control over the game:
- **Archive** — moves game to archived status; still visible under "See Archived"
- **Edit** — edit game name/tagline
- **Delete** — permanently delete game (including active games)

Note: New game confirmation is intentionally open to all active group members — not restricted to the owner. This is a deliberate design decision to avoid bottlenecking group momentum on a single player. See §8.4 for full confirmation model details.

Non-owner members can only **leave** the game.

Max group size: **10 players** (enforced in join and invite flows;
`MAX_GROUP_SIZE` in `game-constants.ts`).

Archived games persist and are browsable; they do not affect the active game count.

---

### 8.18 Stats and Leaderboard


**The Organizing Principle**

Joshing surfaces two categories of data: things that celebrate what the group has built and discovered together, and things that reflect individual performance. These are not the same thing and should never be treated as such.

**Public** (visible to all group members) = group achievements, contribution, and shared knowledge.

**Private** (visible only to the individual) = personal correct rates, wrong answer history, session scores, and streak length.

This is not about hiding poor performance. It is about framing. A wrong answer shown privately is useful information. A wrong answer shown publicly is a ranking input. The same data in different contexts produces opposite emotional effects. Joshing is a connection game. Its metrics should teach connection behavior, not competition behavior.

**The Group Knowledge Map — `/leaderboard`** *(route renamed in nav to "Group")*

The `/leaderboard` route renders the **Group Knowledge Map** — a display of what the group collectively knows and who illuminates which parts of their shared world. Two views, toggled at the top:

**View 1: Contributions**

Shows each player's contribution to the pool. Displayed as cards, not a ranked list.

Each player card shows:
- Display name
- Questions contributed to this game
- Stars earned on their questions (aggregate across all players)
- Category signature — the domains they most represent in the pool: *"Music · Opera · Literature"*

The page answers: *"Who has brought what to this group's world?"* No correct-answer counts. No session scores. No ranking by performance.

**View 2: Game History**

Shows what the group has accomplished together:
- Games completed
- Group longest daily streak — the longest consecutive run of days where every active member completed their session
- Total questions played across all games
- Group star moments — top 3 most-starred questions across all games with their authors
- Games started vs. games completed

The page answers: *"What has this group built together?"*

**What the Group Knowledge Map Does Not Show**

Individual correct answer percentages, individual session scores, individual wrong answer rates, streak lengths, or any ranked list ordered by individual performance. These all belong in the personal performance view.

**Contribution Milestones**

When a player adds their 10th, 25th, or 50th question to the group pool, a quiet acknowledgment appears on the group home card:

> *"[Name] has contributed 25 questions to [Group Name]."*

Not a competition. A recognition of generosity.

**Per-Game Stats — `/stats`**

Accessible from each game card. Defaults to most recently used group and game context.

*Group-level stats (public to all members):*

- **Team % correct** — total correct answers ÷ total answered, expired excluded
- **Hardest question** — lowest correct rate: *"Only 1 in 5 got this one."*
- **Everyone knew this** — highest correct rate
- **Most loved** — highest star count
- **Only one person knew this** — questions with exactly one correct answer, surfaced as celebration of individual knowledge depth
- **Group identity portrait** — LLM-generated description of the group's intellectual world

*Individual stats (private — visible only to the player viewing their own):*

- Questions answered vs. expired
- Correct rate by category, framed as strength and discovery territory
- Questions contributed and their performance
- Session history as a private graph

*Creator stats (private — for question creators viewing their own questions):*

- Correct rate per question
- Star count per question
- Top 3 most common wrong answers (anonymized)
- Number of players who have answered it

**The Personal Performance View**

Route: `/profile` (own knowledge portrait / personal mastery). Entirely private — visible only to the signed-in player. **Friend view** of another player’s portrait: `/users/:userId` (authenticated; respects portrait visibility). **Navigation (April 2026):** Knowledge is the primary nav label for this destination.

Contents:
- Session history — personal score per session over time as a private graph
- Category breakdown — correct rate by category: *"You carry the Music knowledge in your groups"* and *"Philosophy is where you have the most to discover."*
- Question performance — private analytics on contributed question catalogue
- Streak history — current streak and longest streak
- Alignment trends — how intellectual alignment with each group member has moved over time
- Similarity history — all post-game similarity comparisons initiated, with scores

**The Navigation Label**

The primary nav item is **"Knowledge"**. "Leaderboard" is explicitly retired as a
nav label. The Group Knowledge Map at `/leaderboard` is reached via other entry
points, not a top-level nav label.

**Social Progress Snapshot — Replacing the Traditional Leaderboard**

Joshing does not use a traditional leaderboard. Instead, all players in a game and
round see a **Social Progress Snapshot** — a celebratory, domain-focused view of
everyone's progress framed around the canonical progression scale:
**Establishing → Familiar → Solid → Mastery**.

No raw scores, rank numbers, or comparative point totals are shown on this surface.
Raw stats are only accessible when a player actively navigates to their own
Knowledge page. See §8.35.


**Stats Endpoints**

Existing: `GET /api/groups/:groupId/games/:gameId/stats`

Returns two response shapes depending on requesting user:

`stats.group` — public data, returned for all authenticated group members:
```json
{
  "team_correct_rate": "float",
  "hardest_question": "{ question_id, correct_rate }",
  "easiest_question": "{ question_id, correct_rate }",
  "most_starred_question": "{ question_id, star_count }",
  "solo_correct_questions": "[ { question_id, player_display_name } ]",
  "group_identity_portrait": "string",
  "contributions": "[ { user_id, display_name, questions_contributed, stars_earned, category_signature } ]"
}
```

`stats.personal` — private data, returned only for the requesting user:
```json
{
  "sessions": "[ { date, correct, expired, score } ]",
  "category_breakdown": "{ category: { correct_rate, questions_answered } }",
  "questions_contributed": "[ { question_id, correct_rate, star_count, common_wrong_answers } ]"
}
```

New endpoint: `GET /api/groups/:groupId/history` — returns game-level milestones for the Game History view.

---

### 8.19 Missed Questions and Catch-up Mode

Questions that expire at the 24-hour noon EST reset without being answered can be answered later via **catch-up mode**. The daily session window is the primary playing experience — catch-up is available for players who missed a day, not a parallel route.

- Entry: play page with `?mode=catchup` query param; also linked from review and game details (*revisit missed questions*) as implemented
- **Untimed** — no session timer in catch-up mode
- Clearly labelled — catch-up must read differently from the live daily pass. **Shipped:**
  under-header subtitle **Catch-up · [date]** (assignment date); thread intro when
  catch-up starts explains **untimed** and **not for standings**. **Visual:** same
  editorial surfaces as live play (theme tokens), not a mandated `#ede8dc` canvas.

**Eligibility Window**

During an active round, all unanswered questions from any prior day in that round
remain catchable — there is no rolling per-question expiry window while the round is
live. The round being active is the only gate.

After a round ends, all unanswered questions from that round remain playable for
**7 days**. After those 7 days, the submit API enforces a hard post-game cutoff.
Questions are then archive-only.

**Catch-Up Mastery Weight**

Catch-up answers count at 0.25x weight, rounded to the nearest integer, toward mastery scoring regardless of whether the round is active or in the 7-day post-game grace period. The weighting is:

| Difficulty | Catch-Up Correct |
|---|---|
| Specialist | 25 pts |
| Moderate | 13 pts |
| Accessible | 3 pts |

 Catch-up answers are excluded from difficulty calibration and do not generate
Social Progress Snapshot moments. Only live session answers appear in the
per-round and full-game snapshots (§8.35).

 
**Display**

The portrait shows one combined proven bar (live at full weight and catch-up at 0.25x
summed). On own view only, a single global footnote states that proven territory
includes catch-up answers at reduced weight.

---

### 8.20 Add to Bank

After reviewing an answer in the End of Session Review, players see an **"Add to bank"** action on any question. Tapping it:

1. Copies the question into the player's personal question bank
2. Preserves original attribution (`source_question_id`, `source_creator_id`)
3. The copy is independent — editing it does not affect the original
4. Author reveal (for Setup 2 and Setup 3 games) happens at add-to-bank time

Added questions appear in the player's question bank and can be used in future games they create. If the original question was authored by someone in the shared question library, the `source_creator_id` is preserved and the original author retains attribution if the question is ever used in a context where author profiles are visible.

---

### 8.21 Invites

**The Invitation Model**

Joshing is invitation-only. The game creator sends invitations personally — not through Joshing's servers. Joshing generates the invitation copy, pre-formatted with a unique link. The creator copies the text and sends it from their own phone or messaging app. This keeps the invitation personal — it arrives as a message from a friend, not from a product.

**Invitation Methods**

When creating a game, the owner invites players via:

- **SMS** — Joshing generates copy with a unique link per recipient. Creator sends from their own phone via the SMS URI scheme (`sms:+12125551234?body=...`) or by copying and pasting.
- **Email** — `mailto:` prefill flow (subject + body + invite link); opens native email client; no server-side email sending required.

Max 10 invitees per group (enforces group size cap). The invite link registers the recipient as a group member on tap.

**Invitation Copy — Private Game**

Setup 1 and 2 (game starter writes questions):
> *"[Your name] has invited you to play Joshing — [Group Name]. 5 questions are waiting: [link]"*

Setup 3 (everyone contributes):
> *"[Your name] has invited you to play Joshing — [Group Name]. Add 5 questions to join, then start playing: [link]"*

**Invitation Copy — Post-Game Similarity Share**

> *"[Your name] finished a game of Joshing and thinks you might share the same world. Take the same questions and find out: [link]"*

**Invitation Copy — Public Game**

Generated by the LLM from the inviter's knowledge profile — see Section 8.25.

**Invitation Link Expiry**

Invitation links expire 7 days after sending. If a recipient taps an expired link, they see: *"This invitation has expired. Ask [Name] to send you a new one."*

**Phase D (planned)**

Contact-picker flow using `navigator.contacts` Web API (Chrome Android, Safari iOS 14.5+) to select contacts from the device address book and open pre-filled SMS drafts. Graceful fallback to manual phone entry for unsupported browsers.

---
### 8.22 Wrong Answers as Connection Events

**The Philosophy**

Getting a question wrong in Joshing is not a failure. It is a discovery — something from the group's shared intellectual world the player hasn't yet explored. The game treats wrong answers as invitations, not judgments.

This is not a consolation framing. It is the correct framing. When a player misses a question about Berg's Wozzeck, they have not failed a test — they have found the edge of their map. The territory exists. The group lives there. The wrong answer is the moment they discover it. And the person who wrote the question — who chose it specifically because it is part of their world — has just been handed the perfect opening to share why it matters.

Every mechanical and language decision about wrong answers flows from this principle.

**Answer Result Copy**

Wrong answer copy is curious, not punitive. The default "Incorrect" is replaced with a rotating set of warm, specific phrases:

- *"Not this time — here's the answer."*
- *"You'll know this one next time."*
- *"This one belongs to [Creator Name]'s world — now it's in yours too."*
- *"Close, but not quite. The answer was [X]."*

The third variant — *"now it's in yours too"* — is the most important. It frames the wrong answer as an expansion of the player's world, not a subtraction from their score. It resolves dynamically to the creator's display name and **may** be used in live play whenever that name is shown (§8.9).

Near-miss acknowledgment ("accepted variant" label) already exists for leniency cases. The same spirit of charitable interpretation applies to wrong answers that were in the right territory — a question about a Puccini opera where the player named the wrong opera should be treated differently in copy than a question about opera where the player named a pop star.

**Creator Note Treatment on Wrong Answers**

The creator note ("Why I added this") is the most powerful mechanism in the wrong-answer experience. On questions the player answered correctly, it surfaces as a quiet expandable link in the End of Session Review — *"why Josh added this →"* — consistent with the existing specification.

On questions the player got wrong, the creator note is surfaced automatically as an expanded card, visible by default, without requiring a tap. The framing:

> *"[Creator Name] added this because →"*
> [note text]

This is intentional. A correct answer is its own reward — the note is a bonus. A wrong answer is the moment the creator note does its most important work. It transforms "I got this wrong" into "I got this wrong, and now I understand why it mattered enough to ask."

If no creator note exists on a question a player got wrong, the system surfaces a gentle prompt to the creator in their notification feed, once per question per player:

> *"[Name] got your [Category] question wrong — want to tell them why you added it?"*

This is optional, private, and non-repeating.

**Wrong Answer Reactions**

The reaction mechanic is available on all questions. For wrong answers, the canned response set includes discovery-oriented options presented first:

- *"Didn't know this — tell me more."*
- *"Now I need to know the story behind this."*
- *"Adding this to my list."*
- *"You knew I wouldn't get this, didn't you."*

These invite the creator to continue the conversation in a specific direction rather than simply rating the question.

**Replay on wrong answers**

**Replay** is surfaced in the End of Session Review on wrong answer cards (e.g. *"Practice missed in Replay"* → `/replay?group=…&game=…`):

> *"Want to try it again? No score — just for you."* (product intent; app may use the shorter Replay CTA)

Replay is not remediation. It is engagement with the discovery. Also accessible from other entry points that list missed items (see §8.40). **This is not** the deferred AI-only **Practice Mode** in §8.41.

**Daily Summary Treatment**

The daily summary interpretive copy for wrong-answer sessions:

| Trigger | Copy |
|---|---|
| 2 or more wrong answers | *"A few new things in today's questions — that's the game working."* |
| All wrong in one category | *"[Creator] goes deep in [Category] — good to know."* |
| Wrong on the hardest question (lowest group correct rate) | *"Nobody got that one easily. You're in good company."* |
| Wrong on a question the player previously got right | *"This one caught you today. It happens."* |

Only one interpretive line per session. These wrong-answer lines rank below exceptional performance moments but above generic summaries.

**What Wrong Answers Are Never Used For**

- Never shown to other group members in a way that identifies a specific player's miss
- Never surfaced as an input on the Group Knowledge Map or any public-facing display
- Never trigger any notification to the creator identifying which specific player missed their question — creators see aggregate correct rates only
- Never generate "streak broken" language, penalty copy, or any framing that treats the miss as a loss
- Individual wrong answer rates are private to the player — personal performance view only

**Data Model Notes**

No new tables required. One addition: `creator_wrong_answer_prompt_sent` (boolean, default false) on a lightweight notifications log — tracks whether the creator has already been prompted to add a note for a specific player's wrong answer, so the prompt is never sent twice.

---



### 8.23 Post-Game Similarity Sharing

**The Concept**

After completing a game, a player can share their result profile with someone outside their current group. That person receives the same question pool — 5 questions per day — and when they finish, both players receive a similarity score and category breakdown showing how much their knowledge worlds overlap.

The emotional promise is distinct from the private game. Inside a private group, the promise is *"celebrate what we know together."* The similarity share says: *"I think you might share my world — let's find out."*

**Triggering the Share**

Available on the game completion screen alongside the existing shareable result card. A distinct action — not the same as sharing a score card:

- Existing share card: *"Share your results"* — spoiler-free emoji grid, public-facing
- Similarity share: *"Find out if someone shares your world"* — sends a private invitation to one specific person

Available after game completion only. A player needs a full game's worth of answers to build a meaningful profile.

**The Invitation**

The sharer enters a phone number. Joshing generates personalised invitation copy the sharer sends from their own phone:

> *"[Name] finished a game of Joshing and thinks you might share the same world. Take the same questions and find out: [link]"*

The sharer can edit this copy before sending. The link contains the sharer's player ID so the similarity calculation runs automatically when the recipient finishes.

**The Recipient Experience**

- 5 questions per day, same pool as the original game
- Same chat thread interface, same 24-hour expiry
- No group leaderboard, no group stats — playing solo against the pool
- No information about how the original group performed until both players have finished
- Daily SMS opt-in works identically to the private game model
- Invitation link is the game start — tapping it and authenticating takes them
  directly to their first 5 questions


**The Similarity Calculation**

When the recipient completes the pool, the system compares answer profiles:

- Questions the sharer got right that the recipient also got right — shared knowledge
- Questions the sharer got wrong that the recipient also got wrong — shared gaps
- Questions the sharer got right that the recipient got wrong — the sharer's territory
- Questions the recipient got right that the sharer got wrong — the recipient's territory
- Questions created by the sharer — assumed correct for the sharer
- Expired questions on either side — excluded entirely

This produces two outputs:

**Overall similarity score** — a percentage. *"You and [Name] are 74% aligned."* Framed as knowledge world overlap, not personality compatibility.

**Category breakdown** — overlap percentage by category. Music: 90% aligned. Literature: 60% aligned. Philosophy: 40% aligned.

**Reveal Timing**

Neither player sees the similarity result until both have completed the pool. When both have finished, both receive an SMS:

> *"[Name] finished your questions. See how aligned you are: [link]"*

**The Reveal Screen**

Opens with the overall similarity score prominently displayed, then expands into the category breakdown. Below the breakdown, two callouts:

**"What you both knew"** — top 3 questions both players answered correctly. *"These live in both your worlds."*

**"Where your worlds diverge"** — questions where answers differed most sharply. One column per player. Framed as:
> *"[Sharer] knows this territory that you're still discovering."*
> *"You know this territory that [Sharer] is still discovering."*

This three-part structure — common ground, sharer's territory, recipient's territory — produces something specific and worth talking about. Every comparison generates at least one conversation starter.

**Privacy Model**

Before any question from a private pool can be shared with an outsider, the game starter must have consented to pool sharing. Toggle at game creation — on by default for Setup 1, requires explicit opt-in for Setup 2 and Setup 3:

> *"Allow this pool to be used in similarity sharing after the game ends."*

If pool sharing is disabled, the similarity share option does not appear on the game completion screen. See Section 19, Open Question 6.

**Multiple Similarity Shares**

A player can send the similarity share to more than one person. Each recipient plays independently. The sharer can view a private similarity history — all comparisons they have initiated, with scores. This is private to the sharer and never surfaced on any group or public display.

**What Similarity Sharing Is Not**

Not a group invitation. The recipient is never added to the group, never sees group chat, never appears on the Group Knowledge Map. If both players later want to play together, the game starter invites the recipient through the normal group invitation flow.

**Data Model**

New table: `SIMILARITY_SHARES`

| Field | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| sharer_id | uuid | foreign key → USERS |
| recipient_id | uuid | nullable until recipient authenticates |
| game_id | uuid | foreign key → GAMES |
| recipient_phone | string | stored until recipient authenticates, then cleared |
| share_sent_at | timestamp | |
| recipient_started_at | timestamp | nullable |
| recipient_completed_at | timestamp | nullable |
| similarity_score | float | nullable until both complete |
| category_scores | jsonb | nullable until both complete |
| pool_sharing_consented | boolean | copied from GAMES at share time |

**Implementation note:** There is no `GAME_PLAYERS` table in the shipped schema. Excluding similarity-share participants from group stats / notifications is **deferred** until `SIMILARITY_SHARES` (or equivalent) is implemented; do not assume a `similarity_mode` column on `GroupMember` without a migration.

---

### 8.24 Reserved

This section is intentionally reserved. AI-generated or AI-suggested question features are not part of scope.

---

### 8.25 Public Game and Similarity Discovery

**Phase 2 feature. Data architecture partially built into MVP from the start — see Section 11.**

**The Two Public Modes**

The public layer has two distinct surfaces serving different emotional needs. Both draw from the same question pool. Both require an invitation to access.

**The Public Daily Game** — the default public experience. Five questions per day, 24-hour expiry, Wordle-style daily session model. Connection-oriented. Tribe discovery. The daily ritual for players without an active private group, or between private games. This is Section 8.25. Phase 2.

**The Public Infinite Run** — an opt-in competitive mode. Continuous stream of questions, two-strike mechanic, score to beat. Performance-oriented. For players who want trivia as a sport rather than a social ritual. See Section 10. Phase 3.

**The Emotional Promise**

Inside a private group, the promise is: *"Celebrate what we know together."* The public daily game says: *"Find out how many people share your world."*

The public game is not Joshing with strangers. It is Joshing with the larger community of people who inhabit the same intellectual and cultural territory you do.

**Invitation-Only**

The public game is invitation-only. No open sign-up path, no app store discovery, no public landing page allowing a player to join without being invited.

Any active Joshing player can invite someone to the public game by generating invitation copy they send from their own phone:

> *"I've been playing Joshing — a trivia game that asks about the things you actually know. I think you'd match up with me. Take the same questions and find out: [link]"*

The inviting player can edit this copy before sending.

**Interest Profiling at Onboarding**

When a new player joins the public game, they complete a brief interest profile — a fast grid selection:

> *"What does your world include? Pick everything that fits."*

Categories: Music · Classical Music · Opera · Literature · Philosophy · History · Film · Television · Science · Mathematics · Food & Wine · Sport · Theatre · Architecture · Language · Pop Culture · and others.

Under 60 seconds. The profile updates automatically based on play patterns over time.

**The Daily Public Session**

Follows the same mechanics as the private daily session: 5 questions per day,
24-hour expiry, same chat thread interface, same skip mechanic, same shareable
result card. There is no session timer.


Differences from the private game:

- No group — playing solo against the pool
- No creator attribution during play — author names appear in the End of Session
  Review only (unlike **private** play, where §8.9 allows author names in the thread).
- No reactions during play — the micro-conversation mechanic requires a specific relationship; in the public pool, players engage with authors through author profiles instead
- Discovery framing in the daily summary: *"X other players answered these same questions today."*

**The Similarity Discovery Feature**

After each public session, the player sees a tribe-size signal in their daily summary:

> *"3,847 other players share your knowledge territory."*

Calculated weekly. Counts only players who have completed at least 10 sessions in the past 90 days. Two players are "in the same tribe" if they share strong overlap in at least two knowledge domains.

**Tribe size display tiers:**

| Tribe size | Display format |
|---|---|
| Fewer than 50 | *"Your knowledge profile is rare — fewer than 50 players match your combination. The people who do are worth finding."* |
| 50–1,000 | Exact: *"847 players share your world"* |
| 1,000–10,000 | Rounded: *"About 4,000 players share your world"* |
| Above 10,000 | *"You're in good company — tens of thousands of players share your knowledge territory"* |

Small tribe sizes are celebrated, not apologized for. Rarity is distinction.

**The Category Breakdown**

Horizontal bars per category showing what percentage of public players share strong knowledge in each domain:

```
Music          ████████████░░░░  74% of players
Literature     ██████████░░░░░░  61% of players
Opera          ████░░░░░░░░░░░░  23% of players
Philosophy     ███░░░░░░░░░░░░░  18% of players
Frankish Hist  █░░░░░░░░░░░░░░░   4% of players
```

Rarity labels:

| Range | Label |
|---|---|
| Above 50% | *"Common ground — most players know this territory"* |
| 20–50% | *"Solid niche — plenty of company here"* |
| 5–20% | *"Your territory — you're in a smaller group"* |
| Below 5% | *"Rare knowledge — very few players share this"* |

**Deepening the Signal Over Time**

- After 2 weeks: *"You share knowledge with a specific cluster of players — strong in Music and Literature, lighter in History."*
- After 1 month: *"Your knowledge profile is rarer than 92% of public players. The people who match you most closely tend to also know their Philosophy."*

**Specific Player Comparison**

From the similarity panel, a player can trigger a specific comparison with any other Joshing player by entering their phone number. Same mechanics as Section 8.23 — same engine, different context.

**The "Find Your People" Action**

From the similarity panel: *"Invite someone who might share your world."* Generates personalised invitation copy via a lightweight LLM call reading the player's category profile. Listed as Endpoint 6 in Section 9.

**Author Attribution in the Public Game**

Questions in the public daily game are attributed to their authors in the End of Session Review. Author names are tap targets opening the author's public profile (Section 8.26).

**The Relationship Between Public and Private**

- Players with active private games can access the public daily game alongside — sessions are independent
- The public game is the on-ramp; private games are the depth layer
- Between private games, the public daily game keeps the daily habit alive
- Exceptionally starred public pool questions receive additional distribution weight in public surfaces.

**What the Public Game Is Not**

Not a social network. Not a competition. Not a replacement for private games. Not open to anyone.

**Phase 2 Scaffolding Required in MVP**

The following must be in the MVP data model even though the public game UI launches in Phase 2:

- `QUESTIONS.shared_for_public_pool` boolean
- `QUESTIONS.distribution_weight` float
- `QUESTIONS.public_source` enum
- `USERS.author_profile_public` boolean (Section 8.26)
- `USERS.author_slug` string (Section 8.26)
- `AUTHOR_QUESTION_STATS` table (Section 8.26)
- `SIMILARITY_SHARES` table (Section 8.23)

New table: `USER_INTEREST_PROFILES`

| Field | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | foreign key → USERS |
| declared_categories | text array | set at onboarding |
| demonstrated_categories | jsonb | category → score float, updated after each session |
| combined_profile | jsonb | weighted blend |
| tribe_size | integer | updated weekly |
| tribe_percentile | float | updated weekly |
| category_percentiles | jsonb | category → percentile float |
| last_tribe_calculated | timestamp | |
| updated_at | timestamp | |

---

### 8.26 Author Profiles

**The Concept**

Every Joshing player who has opted at least one question into the shared question library has a public author profile. The profile is the face of their creative identity within Joshing — a record of the intellectual world they have chosen to share beyond their own private groups.

Author profiles are the foundation of the long-term vision from Section 3: the best question writers develop followings.

**What a Profile Contains**

**1. Display name** — the player's chosen display name. The same name that appears on their questions throughout the product.

**2. Category signature** — a visual representation of the intellectual domains the author writes in:

> *Music ████████ · Literature ██████ · Philosophy ████ · History ███*

The author's intellectual fingerprint. Tells a visitor immediately what kind of questions this person asks.

**3. Publicly shared questions** — a browsable list of every question this author has opted into sharing. Each shows:
- Question text
- Category and difficulty estimate
- Aggregate star count across all pools where the question has been played
- Number of groups the question has been played in

Listed in reverse chronological order by default. Filterable by category. No answers shown — answers are only revealed during play.

**4. Aggregate star count** — total stars the author's shared questions have earned across all pools. The author's single reputation signal. Measures resonance across the broader Joshing ecosystem.

**What a Profile Does Not Contain**

Group affiliations, game history, correct-answer rates or any performance data, contact information, real identity signals beyond display name. The profile is a creative identity, not a social network profile.

**How Profiles Are Accessed**

**1. Question attribution in player review** — when a player encounters a question attributed to an author outside their group, the author's name is a tap target. This is the discovery moment: a player finds a question that perfectly matches their world, taps the author's name, and discovers an entire catalogue of questions in the same register.

**2. Public game discovery surfaces** — in public game contexts where shared questions are shown, author names remain tap targets to their profiles.

**3. Direct URL** — `joshing.com/authors/[display-name-slug]`. Permanent, shareable. Viewing a profile does not require a Joshing account. Joining a game from a profile view requires an invitation.

**Following an Author (Phase 2)**

In Phase 2, players can follow an author. Following means:
- Their newly shared questions are surfaced preferentially in public discovery feeds
- The game starter receives a quiet notification when a followed author shares a new question
- The author's profile shows a follower count

Following is the mechanic through which question writers develop the followings described in Section 3. The profile and attribution infrastructure built in Phase 1 is the foundation.

**The Author's Own View**

When a player views their own profile, they see everything a visitor sees plus analytics on their shared questions:

- Total groups the question has been played in
- Aggregate correct rate across all plays
- Aggregate star rate across all plays
- Times added to active pools and total play-throughs

**Privacy Controls**

Single toggle in settings: *"Make my author profile public"* — default on for any player who has opted at least one question into sharing. Turning it off hides the profile and removes questions from the shared library going forward. Questions already playing in other groups' pools are not retroactively removed — they complete their current game but are not distributed to additional groups.

Authors can remove individual questions from sharing at any time.

**Route**

`/authors/[display-name-slug]` — publicly accessible without authentication. Server-side rendered and cached.

**Data Model Additions**

Updates to `USERS` table:
- `author_profile_public` boolean, default true for players with at least one shared question
- `author_slug` string, unique — generated from display name at first question share

New table: `AUTHOR_QUESTION_STATS`

| Field | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| question_id | uuid | foreign key → QUESTIONS |
| creator_id | uuid | foreign key → USERS |
| total_pools_played | integer | incremented each time question enters a new pool |
| total_plays | integer | |
| total_correct | integer | |
| total_stars | integer | |
| last_updated | timestamp | |

Updated asynchronously after each session. Powers both the author's analytics view and the `distribution_weight` field on QUESTIONS.

---
### 8.27 The Knowledge Portrait — Two-Axis Model

Every player has a knowledge portrait. It is not a self-reported profile. It is not a checklist of interests. It is built entirely from what they have written and what they have proven — and the two are explicitly different claims.

**The Two Axes**

*Declared territory* — questions written by the player in a given category. Writing a question about late Tchaikovsky proves you know the territory well enough to ask about it. It is a declaration: this is part of my world.

*Proven territory* — questions answered correctly by the player in a given category, written by others. Answering a question about late Tchaikovsky correctly proves you carry that knowledge. It is evidence: this is something I know.

The portrait shows both axes per category. Where they overlap — where a player has both written and answered correctly at meaningful depth — is where genuine mastery lives. Where a player has only written and not been tested, that is declared but unproven territory. Where a player has only answered and not written, that is fluency without authorship.

Neither axis alone is sufficient to claim mastery. A player who has written 20 questions about late Tchaikovsky but answered none has declared a territory. A player who has answered 20 questions correctly but written none has proven fluency. The player who has done both has demonstrated mastery in the fullest sense.

**Difficulty Weighting**

Both axes are weighted by question difficulty. Difficulty is assigned at creation by the LLM (Accessible / Moderate / Specialist) and calibrated over time by actual correct rate data.

Weighting for proven territory:
- Accessible correct answer: 1 point
- Moderate correct answer: 2 points
- Specialist correct answer: 3 points

Weighting for declared territory:
- Accessible question authored: 1 point
- Moderate question authored: 2 points
- Specialist question authored: 3 points

"Who was the first president of the United States?" answered correctly does not demonstrate mastery of American history. A question about the constitutional compromises of 1787 answered correctly at specialist difficulty does. The portrait weights accordingly.

**Difficulty Calibration Over Time**

LLM difficulty estimates at creation are initial signals, not permanent labels. The system tracks actual correct rate for every question across all plays:

- If a question tagged Accessible is answered correctly by fewer than 40% of players, it is reclassified to Moderate
- If a question tagged Moderate is answered correctly by fewer than 25% of players, it is reclassified to Specialist
- If a question tagged Specialist is answered correctly by more than 70% of players, it is reclassified to Moderate

Reclassification updates the question's weight in all players' portraits retroactively. A question that looked easy but proved hard makes the people who answered it correctly look smarter, in retrospect. This is correct behaviour.

**The Portrait in the Product**

The knowledge portrait appears in two contexts:

*Personal mastery page* — the player's own view, showing all categories where they have declared or proven territory, with both axes visible. Hyper-specific categories (see Section 8.2 and Section 9.1). Progressive — fills in naturally through play, never forced. **Implemented copy (D2):** friend-view per-category overlap lines use the canonical strings in `Docs/discussion-d2-personal-mastery.md` Element 5 (*you know this territory too* / *still finding your footing here* / no line if the visitor has not played there). **Catch-up (D3):** own view includes a single global footnote that proven territory includes catch-up answers at quarter weight, plus an optional “How mastery works” inline disclosure for weights.

*Friend's profile* — a visitor sees the friend's portrait with overlap **by category** (visitor’s relationship to each territory — not a percentage score). Where the visitor has played the friend's questions, the proven scores are real. Where they haven't, the overlap is predicted and labelled as such.

**The Group Knowledge Map**

At the end of a season, the ceremony includes a group knowledge map — a collective portrait showing where all players' worlds overlapped and where each person led. This is the receipt for the season: what this specific collection of humans knew together that no other group would. See the ceremony design (to be specified in a dedicated section).

**What the Portrait Is Not**

The portrait is not a gamification layer. There are no levels, no badges for reaching thresholds, no progress bars counting down to a next rank. The portrait is a description, not a score. It grows more revealing over time not because the player has advanced through a system but because they have played more, written more, and been known more deeply by the people around them.

---
### 8.28 Expert Invitation Surface

**Concept**

A player with deep mastery in a specific territory — 18th century counterpoint, late Tchaikovsky, Sondheim musicals — can create a named challenge from their question bank and invite others to play it. Not a full season with a group. Not Friend Play. Something more specific: I know this world deeply, here are my questions, come see how you do against it.

This is the earliest expression of the Phase 4 territories concept — a recognized expert as a named curator whose depth in a territory is the product. The challenge is attributed: *"A challenge by Josh — 18th Century Counterpoint. 15 questions."*

**How It Differs From Friend Play**

Friend Play is exploratory and bilateral — you browse a friend's whole bank, choose a category, and discover parts of them you didn't know. It requires an existing relationship and shared season history.

Expert invitation is a curated, directed challenge that can be extended to anyone — existing players or new players receiving their first Joshing experience. The expert selects a specific territory from their portrait, curates the questions they want to represent that territory, and shares a link. The recipient plays without needing a full account or group.

**The Challenge as Entry Point**

Expert invitation is a natural recruitment mechanic. A new player who answers 15 questions about 18th century counterpoint and gets 9 right has just had their first Joshing experience. The end of the challenge is the invitation to start a proper season.

**What This Is Not**

Expert invitation is not a competitive ranking or a certification system. Getting 9 out of 15 does not make you a league member or grant any formal status. The challenge is a window into someone's world — the same emotional register as Friend Play, just more curated and more shareable.

**Design Status**

Full design pending Discussion Prompt D4 in the Implementation Action Plan. The following are confirmed principles:

- Questions come from the expert's existing bank — no new question creation required for a challenge
- Attribution travels with the challenge — the expert's name and territory are always shown
- The challenge can be played by anyone with the link, including players without a Joshing account
- The expert sees aggregate play data — how many played, correct rate per question
- The end-of-challenge CTA invites the recipient to start a season with the expert
- This is a Phase 2 feature — not in scope for MVP

---

### 8.29 Game Ending Ceremony

**Philosophy**

The ceremony is not a summary screen. It is a cinematic sequence — a designed
emotional event that happens to the player. Reference model: Spotify Wrapped.

**Two-Act Structure**

The ceremony is divided into two acts. They may fire sequentially without interruption
(for the last player to finish) or separated in time (for players who finish early).

Act 1 — Personal (fires on personal completion)
Act 2 — Group (fires on group completion or timeout)

**Act 1 — Personal Completion**

Fires the moment the current player submits their final answer or their final
assignment expires. Contains all beats that belong to the individual player's story:

BLACK OPEN → PORTRAIT → PERSONAL RECORD → CATEGORY GAINS (full mode) → SHARE CARD

The share card is the final screen of Act 1. See §8.36 for share card specification.

If Act 2 is already available when Act 1 completes (i.e. this player is last to
finish), the ceremony flows directly from Act 1 into Act 2 with no interruption.
The share card in this case appears at the end of Act 2 instead.

If Act 2 is not yet available, Act 1 ends after the share card. The system stores
`ceremony_state = 'act1_complete'`. When Act 2 later becomes available, an SMS is
sent: *"The full results are in — [link]."* The player can re-enter the ceremony
from their home screen.

**Act 2 — Group Completion**

Fires when all active answering players have completed their final answer, or when
the group timeout is reached. Contains all beats that belong to the collective story:

GROUP KNOWLEDGE MAP → AUTHORSHIP IMPACT → RELATIONAL FEEDBACK → CLIMAX →
INVITATION → SHARE CARD

The share card appears at the end of Act 2. Content is always Act 1 personal data
(mastery momentum) — never group scores or others' results.

**Act 2 Availability Check**

`GET /api/games/:gameId/ceremony-status`
Returns: `{ act2_available: boolean, players_remaining: number, timeout_at: timestamp }`
Polling at 30-second intervals is acceptable.

**Solo Mode**

Act 1 only. Act 2 never fires in solo mode. Share card appears at end of Act 1.

**Tier name updates throughout §8.29:**

All references to Curious/Versed/Fluent/Master replaced with
Establishing/Familiar/Solid/Mastery:

- Reveal 6 (Mastery Movement): *"This season you moved / Late Bach  Establishing → Familiar"*
- Mastery moment copy variants:
  - → Familiar: *"[Category]. You're finding your ground."*
  - → Solid: *"[Category]. You move through this naturally now."*
  - → Mastery: *"[Category]. This one's yours."*

**8.29a Ceremony Modes**

The ceremony renders in one of three modes based on the number of active answering players:

```
ceremony_mode = 'group' | 'duo' | 'solo'
```

| Mode | Condition | Framing |
|---|---|---|
| `group` | 3+ players | Collective + social |
| `duo` | 2 players | Relational overlap |
| `solo` | 1 player | Personal reflection |

The host is never counted as an active answering player. Solo mode fires when one player has answered questions, regardless of whether a host authored the questions. Mode is determined once at ceremony generation and does not change.

**In solo mode, the ceremony is not a results screen for a competition. It is a portrait of the player's encounter with the host's world.** This single sentence governs every design choice in solo mode.

---

**8.29b Ceremony Beat Structure**

**Act 1 — Personal (fires on personal completion):**

```
BLACK OPEN → PORTRAIT → PERSONAL RECORD → CATEGORY GAINS → SHARE CARD
```
See §8.29c (Portrait), §8.29d (Personal Record), §8.29c-ii (Category Gains),
§8.36 (Share Card).


**Act 2 — Group (fires on group completion or timeout):**

```
GROUP KNOWLEDGE MAP → AUTHORSHIP IMPACT → RELATIONAL FEEDBACK → CLIMAX →
INVITATION → SHARE CARD
```
See §8.29e (Group Knowledge Map), §8.29f (Climax), §8.29g (Invitation),
§8.36 (Share Card).


The Climax beat (winner reveal in group/duo; Revelation in solo) arrives last in
Act 2, after the collective picture has been seen. Personal Record and Category
Gains come before the Map so each player arrives at the collective view already
knowing their own story and where they moved.

**Full ceremony state machine (implementation reference):**

```
IDLE → PORTRAIT → PERSONAL_RECORD → CATEGORY_GAINS → [ACT_1_COMPLETE]
     → MAP → CLIMAX → INVITATION → SHARE_CARD
```


Mode-branch happens at ceremony initialization. The state machine does not change —
the components that render for each beat change based on `ceremony_mode`.



**Anticipation Signal (in-game, pre-ceremony)**

During gameplay, the game card shows: *"N rounds until the final reveal."* Calculated from questions remaining ÷ 5. Shown only when at least one round has been played.

---

**8.29c Beat 1: Portrait — "Here's what this season was."**

Three full-screen moments in sequence. Each holds ~3 seconds before the continue affordance appears. Does not auto-advance — the player taps to move between screens.

**Group / Duo mode:**

- *Everyone got this one.* — question text, author attribution.
- *Nobody got this one.* — question text, author attribution. Answer not shown — the question stands unresolved.
- *[N] players saved this question.* — question text, author. *"It's in [N] banks now."*

Duo copy adjustments:
- "Everyone got it" → *"[Player name] got this one."*
- "Nobody got it" → *"Neither of you got this."*
- "Most saved" — unchanged

**Solo mode — "Your Way Into This World"**

Replaces the group Portrait beat entirely. Three sections revealed sequentially:

| Section | Label | Definition |
|---|---|---|
| Common ground | *"You stepped easily into these"* | Questions answered correctly |
| Discovery | *"These were new territory"* | Questions answered incorrectly, framed as expansion |
| Kept | *"You kept these with you"* | Questions saved, starred, or banked |

Conditional microcopy (use one per beat, not all):
- High common ground: *"More of this world was already yours than you might have guessed."*
- High discovery: *"Some of the best parts were the ones you didn't know yet."*
- High kept: *"A few of these were worth carrying forward."*

Empty-state rules:

| Condition | Handling |
|---|---|
| No kept questions | Omit that section entirely |
| No discovery questions | Replace with: *"Very little here felt unfamiliar."* |
| No common-ground questions | Replace with: *"This world asked something new of you."* |

Do not use "everyone got this," "nobody got this," or any language implying a group. There is one player.

---

**8.29d Beat 2: Personal Record — "Here's what you did."**

Private — fetched per authenticated player via `GET /api/ceremony/:gameId/personal-record`. Never included in the shared group-scoped ceremony response (`GET /api/groups/:groupId/games/:gameId/ceremony`). Other players see their own version simultaneously or when they open the ceremony from their SMS link.

The Personal Record beat contains **up to seven reveals**, staggered ~1.5s apart. Several are conditional and omitted silently when data is absent or thresholds are not met.

| # | Reveal | Shared or Private | Conditional? |
|---|---|---|---|
| 1 | Strongest territories | Private | No |
| 2 | Questions that landed | Private | Solo: always omit |
| 3 | Hardest thing you carried | Private | Omit if player answered nothing |
| 4 | The one you knew instantly | **Shared** | Yes — timing threshold required |
| 5 | The one you sat with longest | Private | Yes — timing threshold required |
| 6 | Mastery movement this season | Private | Yes — omit if no tier crossed |
| 7 | What you gave the group | Private | Yes — omit if `author_points_given = 0` |

**Reveal 1 — Strongest Territories**

Large, clean list. Each entry is hyper-specific:

```
You led in

Late Tchaikovsky
Weimar Cinema
Structural Engineering
```

If tied: *"You and [Name] both led in [Category]."*
If no categories led: *"You didn't lead any category this season."* — no softening, honest.

Solo label: "Strongest territories" — no competitive framing. Render as the player's own deepest ground.

**Reveal 2 — Questions That Landed**

```
[N] of your questions
others got right.
```

A single example question surfaces beneath, small: *"Including: [question text]"*

If N = 0: *"Nobody got your questions right this season. That's either very hard or very interesting."*

Solo: omit silently. N will always be 0 in solo mode.

**Reveal 3 — Hardest Thing You Carried**

```
Your hardest right answer:
```

Question text, large. Then: *"Only you got this."* or *"You and [Name] were the only ones."*

If the player answered no questions correctly: *"You didn't get any right this season."* — no softening.

Duo variant: after Reveal 3, one additional line: *"[Other player] got [N] questions right that you didn't."*

Solo copy: *"Your hardest right answer:"* unchanged. Use *"This was the answer you got cleanest."* instead of *"Only you got this."*

**Reveal 4 — The One You Knew Instantly** *(Fastest Correct)*

This reveal is **shared** — visible in the group ceremony payload, not private.

```
The one you knew instantly.

"[question_text]"

You answered in N seconds.
```

Threshold rules — show only when:
- The answer was correct
- `response_time_ms` < player's session median × 0.6
- `response_time_ms` is between 3,000ms and 15,000ms (exclude sub-3s taps/accidents; cap at 15s)

If threshold not met: omit silently.

Copy:
- Primary: *"The one you knew instantly."*
- Sub-label: *"You answered in N seconds."* — display as whole seconds, rounded.
- Optional interpretive line (use sparingly): *"No hesitation there."*

API field: `fastest_correct`

```json
{
  "fastest_correct": {
    "question_text": "Which composer developed the tintinnabuli technique?",
    "response_time_ms": 6200,
    "canonical_subcategory": "20th Century Minimalism"
  }
}
```

Solo: functions identically. The player's tempo is still meaningful without a group.

**Reveal 5 — The One You Sat With Longest** *(Longest Held)*

This reveal is **private** — authenticated endpoint only, never in shared payload.

```
The one you sat with longest.

"[question_text]"

You stayed with it for N seconds.
```

Threshold rules — show only when:
- The question was answered (not expired — do not surface expired questions)
- `response_time_ms` > player's session median × 1.8
- `response_time_ms` > 20,000ms (minimum floor)
- Season has at least 3 answered questions

If threshold not met: omit silently.

Copy:
- Primary: *"The one you sat with longest."*
- Sub-label: *"You stayed with it for N seconds."* — display as whole seconds, rounded.
- Optional interpretive line: *"You took your time here."*

This reveal can surface wrong answers. A long struggle is interesting regardless of outcome. Do not say: "Least confident," "You doubted yourself," "You were unsure."

API field: `longest_held`

```json
{
  "longest_held": {
    "question_text": "Which architect designed the Barcelona Pavilion?",
    "response_time_ms": 28400,
    "canonical_subcategory": "Modernist Architecture",
    "was_correct": false
  }
}
```

Solo: functions identically.

**Reveal 6 — Mastery Movement This Season**

```
This season you moved

Late Bach  Establishing → Familiar
Medieval French Dynasty  Familiar → Solid
```

If no tier crossed this season: omit silently.

If Master reached: displayed last, with distinct typographic weight:

```
And you reached Mastery
in Late Bach.
```

API field: `mastery_movement` — array of `{ subcategory, from_tier, to_tier }`.

Solo: identical. Mastery is personal and cumulative.

**Reveal 7 — What You Gave the Group**

This reveal is **private** — authenticated endpoint only, never in shared payload.

Condition: render only if `author_points_given > 0`. If zero: omit silently. No empty state. No "you gave nothing" message.

```
Your questions earned N points
across the group this season.

"[question_text]"

was your most answered — N player[s] got it right.
```

Display logic:

If `top_author_question` is not null:
- Line 1 (display size, stagger 0): *"Your questions earned N points across the group this season."* — N rounded to nearest integer
- Line 2 (body size, muted, stagger 1): *"[question_text]"*
- Line 3 (smaller, muted, stagger 2): *"was your most answered — N player[s] got it right."*

If `top_author_question` is null but `author_points_given > 0`: show Line 1 only.

Pluralization: "1 player got it right." / "3 players got it right."

Tone: warm and quiet — not a trophy moment. Do not add glow, pulse, or emphasis beyond existing typographic weight.

API fields: `author_points_given`, `top_author_question`

```json
{
  "author_points_given": 34.5,
  "top_author_question": {
    "question_text": "Which composer developed the tintinnabuli technique?",
    "canonical_subcategory": "20th Century Minimalism",
    "points_generated": 9.0,
    "correct_count": 3
  }
}
```

Solo: `author_points_given` will always be 0 in solo mode (no other answering players). Reveal 7 omits by the zero-data rule. No special solo handling required.

Edge cases:

| Scenario | Handling |
|---|---|
| `author_points_given = 0` | Skip reveal entirely |
| Player wrote no questions | `author_points_given = 0` → skip |
| Player wrote questions, none answered correctly by others | `author_points_given = 0` → skip |
| `top_author_question` null, points > 0 | Show Line 1 only |
| `correct_count = 1` | "1 player got it right." (singular) |
| Two questions tied for most points | `ORDER BY points_generated DESC, created_at DESC LIMIT 1` |

**Fetch Strategy**

- Reveals 1–4: shared ceremony payload `GET /api/groups/:groupId/games/:gameId/ceremony`
- Reveals 5–7: authenticated endpoint `GET /api/ceremony/:gameId/personal-record`
- Category Gains: authenticated endpoint `GET /api/ceremony/:gameId/category-gains`

Never include Reveals 5, 6, or 7 data in any unauthenticated or group-shared
ceremony response. Never include Category Gains data in the shared ceremony payload.

---

**8.29e Beat 3: Group Knowledge Map — "Here's where your worlds met."**

The one genuinely visual and interactive beat. The map assembles on screen — shared nodes appear first, solo territory fans out last. This emphasizes connection before individual distinction.

**Group mode — Force-Directed Web (3+ players)**

- Each node is a hyper-specific category
- Node size = total group weighted activity (questions written + answers correct; Accessible=1pt, Moderate=2pt, Specialist=3pt)
- Edges connect categories the same player contributed to — each player has a distinct color/line style
- Overlap zones emerge naturally where multiple players share a category node
- One-line summary appears beneath the assembled web: *"[N] categories. [N] overlaps."*

Animation sequence:
1. Most-shared node appears first, centered
2. Other overlap nodes radiate outward
3. Solo-territory nodes fan out last, attached to their player's edges

Per-category tap to expand — one row per player:

```
Late Tchaikovsky

● Josh
q  [████████░░░░░░░]   declared
a  [█████░░░░░░░░░░]   proven

● Maya
q  [███░░░░░░░░░░░░]
a  [████████░░░░░░░]
```

- q bar = questions written, difficulty weighted
- a bar = questions answered correctly, difficulty weighted
- a < q: amber tint, *"More declared than proven"* — CSS class `territory-overclaimed`
- a > q: green tint, *"Others expanded your territory here"* — CSS class `territory-grown`
- a = q: no tint

Dominant player (>60% of total weighted activity): full territory shown, no compression. Note beneath: *"[Name]'s world carried this season."*

Single category edge case: one large node. *"Everything happened in one place."*

**Duo mode — Venn Diagram**

Conditionally rendered when `players.length === 2`.

- Two overlapping circles, one color per player
- Left = Player A only, center = shared, right = Player B only
- Center overlap categories listed explicitly
- Visual register: intimate, not broadcast

**Solo mode — Overlap Map**

Do not render a force-directed web or Venn diagram in solo mode.

Beat title: *"Where your world met [Host Name]'s"*
Fallback: *"Where your worlds met"*

Per-category fields:

```json
{
  "category": "20th Century Minimalism",
  "authored_score": 9.0,
  "proven_score": 6.0,
  "overlap_score": 6.0,
  "state": "shared_ground"
}
```

`overlap_score = Math.min(authored_score, proven_score)`

State assignment:

| State | Condition | Display label |
|---|---|---|
| `shared_ground` | High overlap relative to authored | *"Shared ground"* |
| `their_world_not_yet_yours` | High authored, low proven | *"Their world, not yet yours"* |
| `you_surprised_the_map` | Proven meaningfully exceeds authored expectation | *"You carried more here than expected"* |

Summary lines by dominant state:
- Mostly shared ground: *"Your strongest overlap lived in [Category]."*
- Mostly discovery: *"[Category] was where this world stretched furthest beyond your own."*
- Mostly surprise: *"In [Category], you knew more than the map predicted."*

V1 implementation: render as a vertical category list with state labels.

---

### 8.29e.1 Beat 3a: Authorship Impact — "Here's who built this world."

**Philosophy**

This beat explicitly celebrates the act of creation. It answers the question, "Who contributed to our shared world this season?" It surfaces the human element behind the questions, reinforcing that the game is a curated experience. This beat is shown in `group` and `duo` modes only and is omitted in `solo` mode.

**Structure & Content**

A sequence of up to three full-screen moments.

**1. Contributor Spotlight:**
- A visual array of all player display names who contributed at least one question to the game's pool.
- Header: *"[N] players built this season's world."*
- The top contributor (by question count) is highlighted with a subtle glow or larger font size, with the sub-label: *"[Player Name] was the lead curator."*

**2. The Most Resonant Question:**
- Displays the question from this season that received the most stars from the group.
- Header: *"The question you loved most."*
- Content: Full question text, with author attribution below: *"Asked by [Author Name]."*

**3. The Deepest Cut:**
- Displays the question from this season that had the lowest correct answer rate (the "hardest" question).
- Header: *"The one that stumped you all."*
- Content: Full question text and author attribution. The correct answer is deliberately *not* shown, preserving the mystery.

---

### 8.29e.2 Beat 3b: Relational Feedback — "Here's how you connected."

**Philosophy**

This beat moves from the collective to the relational, showing how players' knowledge overlapped and diverged. It focuses on pairs and interesting dynamics that emerged during play. This beat is shown in `group` and `duo` modes only and is omitted in `solo` mode.

**Structure & Content**

A sequence of up to two full-screen moments, selected based on the most interesting data from the season.

**1. The Strongest Pair:**
- Surfaces the two players with the highest intellectual alignment score.
- Header: *"The Strongest Connection."*
- Content: *"[Player A] and [Player B] knew each other best this season, with [X]% alignment."*
- A visual, such as two overlapping circles with their display names, is shown.

**2. The Unison Moment:**
- Surfaces a question that *everyone* in the group answered correctly.
- Header: *"The moment you all shared."*
- Content: Full question text with author attribution.
- Sub-label: *"Everyone knew this one."*
- If no such question exists, this moment is skipped.

**3. The Knowledge-Share Moment:**
- Surfaces a question where only one person got it right, and it was *not* the author.
- Header: *"[Author Name] brought this world, and only [Player Name] knew it."*
- Content: Full question text with both author and sole correct player named.
- If no such instance exists, this moment is skipped.

---



**8.29f Beat 4: Climax**

Behavior differs by ceremony mode.

**Group mode — "Here's who won."**

Screen dims briefly from the map. Black for ~1 second. Winner's name appears alone, large, centered. Their strongest category beneath: *"Dominated Late Tchaikovsky."* Then: *"[Name] knew this group best."* Full standings fade in — ranked, with one-line descriptors per player.

Tie: *"[Name] and [Name] finished even."*

Score display: always relative — never raw in isolation.

**Duo mode — "Here's how you compared."**

Shows overlap and divergence. No winner declared. Framing emphasizes what was shared and what was distinct.

Two-player copy: *"[Name] knew the other better."*
Two-player tie: *"You finished even."*

**Solo mode — Revelation Beat**

No winner. No standings. Replaces the competitive result entirely.

Beat title: *"What became clear"*

Primary reveal line — choose one based on data:

| Condition | Copy |
|---|---|
| High overlap | *"You shared more of this world than you may have expected."* |
| Mixed overlap + growth | *"Part of this world was already yours. Part of it became yours here."* |
| High discovery | *"This season gave you more new ground than familiar ground."* |
| Strong category | *"Your clearest overlap was in [Category]. Your biggest stretch was [Category]."* |

Required fields and display labels:

| Field | Display label |
|---|---|
| `overall_overlap_score` | *"Shared ground"* — never "overlap score" or "score" |
| `strongest_overlap_category` | Shown with summary line |
| `deepest_discovery_category` | Shown with summary line |
| `portrait_growth_summary` | Default: *"You left with a larger map than you arrived with."* |
| `mastery_crossed` | Shown with tier names if present |

Display of `overall_overlap_score`:

```
Shared ground

68%
```

The solo Revelation Beat must never:
- Display rankings, winner, top player, standings, or leaderboard
- Use "everyone" or "nobody" language
- Show a leaderboard of one
- Use score as a primary label

---

**8.29g Beat 5: Invitation — "What comes next."**

Unhurried. No urgency.

**Group / Duo mode**

Primary CTA (filled, warm): `Start a new season →` — pre-populates same group, editable before sending.

Secondary CTA (text-link weight): `Explore your multitudes` — takes player to cumulative profile.

Fallback for thin banks (fewer than 5 questions authored lifetime): `See what you've written so far`

Archival note — small type below both CTAs: *[Season name] · [Start date] – [End date]*

**Solo mode**

Beat title: *"What you could do with this"*

Primary CTA: *"Start another season"*

Secondary CTAs (text-link weight):
- *"Add more questions"*
- *"Share this world"*
- *"Compare with someone else"*

Supporting line (default): *"There is more here if you want it."*

Archival note: same as group.

---

**8.29h Solo Ceremony Copy System**

**Governing Principle**

This was not a competition. It was an encounter with someone else's world.

**Must do:**
- Speak in second person
- Speak concretely
- Frame wrong answers as discovery
- Frame correct answers as shared ground
- Let the host's authored world remain present
- Let the player feel changed by the season

**Must not do:**
- "Winner" / "top player" / "you beat" / "you came in first"
- "Everyone" / "nobody"
- "Rank" / "standings"
- Therapy language (*"it's okay that you..."*)
- Inflated epic language (*"you conquered..."*)
- Gamified achievement language (*"achievement unlocked"*)

**Banned phrases (solo mode)** — must never render in solo ceremony copy:

winner · top player · rank · ranked · standings · you beat · everyone got · nobody got · you came in first · leaderboard · score (as primary label) · achievement unlocked

---

**8.29i SMS Notifications — Season End**

Sent to all players when `pool_exhausted` is set. Replaces the existing "game complete" SMS for completed seasons.

| Recipient | Copy |
|---|---|
| Non-winner | *"The [Group name] season just ended. [Winner name] knew you best. See how it all mapped out: [link]"* |
| Winner | *"You won the [Group name] season. See the final map: [link]"* |
| Two-player non-winner | *"Your Joshing season with [Other player name] just ended. See how your worlds overlapped: [link]"*|
| Two-player winner | *"Your Joshing season with [Other player name] just ended. See how your worlds overlapped: [link]"* |
| Tie | *"The [Group name] season ended even. [Name] and [Name] finished together. See the map: [link]"* |
| Solo (host name available) | *"Your season in [Host Name]'s world is complete. See how your worlds overlapped: [link]"* |
| Solo (fallback) | *"Your [Season name] season is complete. See what you discovered: [link]"* |

All season-end SMS links resolve to `/groups/:groupId/games/:gameId` — 
the Game Summary page.

---

**8.29j Ceremony States and Edge Cases**

| Scenario | Handling |
|---|---|
| Only 1 category played all season | Group: map = single node, *"Everything happened in one place."* Solo: single category row in Overlap Map |
| Player wrote questions, answered none | q bar shows, a bar empty — honest |
| Player answered questions, wrote none | a bar shows, q bar empty; Personal Record: *"Pure player"* label; Reveal 7 omits by zero-data rule |
| Season ends by expiry (not completion) | Ceremony triggers; Climax beat adds: *"Season ended — not all questions were answered."* |
| Two players, tied score | Venn with equal circles; no winner; *"You finished even."* |
| Solo player | Solo ceremony — full spec above |
| Dominant player >60% activity | Group: full territory shown with attribution note |
| Reveal 4 threshold not met | Reveal 4 omitted silently |
| Reveal 5 threshold not met | Reveal 5 omitted silently |
| `author_points_given = 0` | Reveal 7 omitted silently |
| All timing reveals absent | Ceremony proceeds with 4–5 reveals; no gap, no notice |
| `response_time_ms` not yet stored | Reveals 4 and 5 omit silently; ceremony does not fail |

---

**8.29k Implementation Notes**

**State machine:**
```
IDLE → PORTRAIT → PERSONAL_RECORD → CATEGORY_GAINS → [ACT_1_COMPLETE] → MAP → CLIMAX → INVITATION → SHARE_CARD

```

Mode-branch happens at ceremony initialization. The state machine does not change — the components that render for each beat change based on `ceremony_mode`.

**Component architecture:**
- `<CeremonyShell>` — full-screen container, manages beat state, reads `mode`, branches rendering
- `<PortraitBeat>` — renders `<GroupPortraitBeat>` or `<SoloPortraitBeat>` based on mode
- `<PersonalRecordBeat>` — shared across all modes; all seven reveals; visibility controlled by data presence and thresholds
- `<CategoryGainsBeat>` — Act 1 only; authenticated endpoint;
    - `<MasteryMomentSequence>` — full-screen tier-crossed moments; suppressed
      if `mastery_moment_already_shown: true`
        - `<MasteryMoment>` — one per tier crossed; reuses §8.32 component
    - `<DomainGainsStack>` — vertical domain row list
        - `<DomainGainsRow>` — one per domain; suppresses silently if
          `canonical_subcategory` invalid; logs telemetry
        - `<GainsEmptyState>` — renders when domains array is empty or
          `empty_state` is non-null
- `<KnowledgeMapBeat>` — renders `<ForceWeb>` (group), `<VennDiagram>` (duo), or `<SoloOverlapMap>` (solo)
- `<ClimaxBeat>` — renders `<ResultBeat>` (group/duo) or `<RevelationBeat>` (solo)
- `<InvitationBeat>` — renders group CTAs or solo CTAs based on mode

**Fetch strategy:**
- Reveals 1–4: shared ceremony payload `GET /api/groups/:groupId/games/:gameId/ceremony`
- Reveals 5–7: authenticated endpoint `GET /api/ceremony/:gameId/personal-record`
- Category Gains: authenticated endpoint `GET /api/ceremony/:gameId/category-gains`
- Never include Reveals 5, 6, or 7 in any unauthenticated or group-shared response
- Never include Category Gains data in the shared ceremony payload


**Category-first rendering contract (normative):**

- Any Personal Record reveal payload used in category-first UI (including `fastest_correct`, `longest_held`, and `top_author_question`) **MUST** provide a valid `canonical_subcategory` for rows that claim category context.
- If a row intended for category-first rendering has missing/null/invalid `canonical_subcategory`, that row **MUST** be suppressed at render time.
- Clients **MUST NOT** fall back to `"Other"`, `"Uncategorized"`, `"Unknown"`, or any generic substitute label in ceremony surfaces.
- Suppression events **MUST** be logged/telemetered with diagnostic identifiers sufficient to trace upstream canonicalization failures (minimum: `game_id`, `user_id`, reveal key, source row/question id when available, rejected category value, suppression reason, timestamp).
- A suppressed row **SHOULD NOT** fail the beat; remaining valid reveals continue without placeholder copy.

**Map implementation:**
- Force-directed web: D3 force simulation — do not hand-roll physics
- Venn: custom SVG component, two circles with computed overlap region
- q/a bars: same component as player profile pages — reuse directly
- Node tap/expand: spring animation (`react-spring` or equivalent)
- Amber/green tint: CSS class applied at render based on `(aScore - qScore)` sign

**Answer timing data requirements:**

The following fields must be added to the ANSWERS table to support Reveals 4 and 5. If not yet present, add before B4a:

```sql
ALTER TABLE ANSWERS
ADD COLUMN question_presented_at TIMESTAMPTZ NULL,
ADD COLUMN response_time_ms INTEGER NULL;
```

`response_time_ms` is calculated at answer submission: `answered_at - question_presented_at`. Store as integer milliseconds. If these fields are absent, Reveals 4 and 5 return null and omit silently — the ceremony does not fail.

Threshold logic (computed at ceremony generation, not stored):

```
player_median_ms = median(response_time_ms) for all answered questions in the season

Reveal 4 (fastest_correct):
  result = 'correct'
  AND response_time_ms < player_median_ms × 0.6
  AND response_time_ms > 3000
  AND response_time_ms < 15000

Reveal 5 (longest_held):
  status = answered (not expired)
  AND response_time_ms > player_median_ms × 1.8
  AND response_time_ms > 20000
  AND season has at least 3 answered questions
```

**Solo mode:**
- API returns `mode = 'solo'` in ceremony payload root
- Solo payload contains no competitive fields — `winner`, `standings`, `is_tie`, `tying_players`, `max_score` are not returned (remove, do not return as null)
- Banned phrase check enforced on solo ceremony copy constants at render time

**Typography and palette:**
- Display beats: 72–96px
- Body/context lines: 18–22px
- Author attribution: 14px, muted
- Ink-on-cream: `#1a1208` on `#f5f0e8`

**Animation:**
- Beat transitions: fade through black (300ms out / 300ms in)
- Within-beat reveals: staggered `animation-delay`, 1–1.5s between items
- Map assembly: D3 force simulation runs on entry; edges draw after nodes settle (~800ms)
- Count-up numbers: 600ms ease-out
- Solo Overlap Map: category rows stagger in at 0.2s intervals

---

### 8.30 Game Details Page *(Retired)*

The Game Details page has been absorbed into the Game Summary page (§8.5).

All content previously specified here — full question and answer history, 
group-level stats, Knowledge Map snapshot, category breakdown, and post-game 
actions — now lives in Section 5 (The Season Archive) of the Game Summary 
page at `/groups/:groupId/games/:gameId`.

The Game Summary page persists indefinitely. There is no separate Game 
Details route.



---

### 8.31 *(Retired)*

Section 8.31 (Mastery System — Curious/Versed/Fluent/Master) is retired.
The canonical mastery system is specified in §8.32.

---

### 8.32 Points and Progression System *(canonical)*

**Philosophy**

Points are the engine running underneath the progression language. **Cumulative** raw
totals and leaderboard-style point dumps stay off primary surfaces. The progression
scale — **Establishing → Familiar → Solid → Mastery** — is the main ongoing feedback
mechanism, and deeper numbers belong on the **Knowledge** page.

**Implementation (current app):** when the player finishes the day’s live assignments,
the chat thread shows a **Round complete** card with a large **`+{pointsToday}`** —
today’s points only, as a single celebratory beat (`SessionCompleteRow` in
`GameplayChat.tsx`). This does **not** replace mastery/progression language elsewhere;
it coexists with §8.38 close messaging and review links in the same flow.

**Earning Points — Answering**

Points earned for correct answers are determined by two factors: the difficulty of
the question and the answer state.

| Difficulty | First Correct (Live) | Catch-Up / Previously Wrong | Repeat Correct |
|---|---|---|---|
| Specialist | 100 pts | 25 pts | 0 pts |
| Moderate | 50 pts | 13 pts | 0 pts |
| Accessible | 10 pts | 3 pts | 0 pts |

**Difficulty Definitions**

LLM difficulty estimate is assigned at question creation. Calibrated over time by
empirical correct rate:

| Label | Correct Rate |
|---|---|
| Accessible | >70% of players answer correctly |
| Moderate | 40–70% of players answer correctly |
| Specialist | <40% of players answer correctly |

All new questions start at Moderate until enough answer data accumulates to
recalibrate. Reclassification is applied forward — historical mastery points are
frozen at the values they were earned.

**Earning Points — Creating**

Creator earnings accrue each time another player answers the creator's question
correctly in a live session. Earnings are determined by the question's empirical
difficulty rating:

| Empirical Difficulty | Creator Earns Per Correct Answer |
|---|---|
| Easy (>70% correct) | 25 pts |
| Medium (40–70% correct) | 50 pts |
| Hard (<40% correct) | 100 pts |

Creator points are domain-specific — they accumulate in the same domain as the
question they were earned from.

**Answer State Model**

The `answer_state` field on every ANSWERS row drives mastery credit:

| answer_state | Definition | Mastery Credit |
|---|---|---|
| `first_correct` | Never answered correctly before | Full points per table above |
| `first_correct_after_wrong` | Previously answered incorrectly, never correctly | 25% of full points, rounded to the nearest integer |
| `repeat_correct` | Already answered correctly in a prior session | 0 pts |
| `incorrect` | Wrong answer | 0 pts |

`answer_state` is computed at answer submission time and never updated after insert.

**Level Thresholds**

| Level | Points Required | Notes |
|---|---|---|
| Establishing | 0 – 499 | Entry state for any domain |
| Familiar | 500 – 1,499 | Requires consistent engagement |
| Solid | 1,500 – 3,499 | Achievable through answering alone |
| Mastery | 3,500+ | Requires creator contribution — see below |

**Mastery Unlock Requirement**

Mastery is not achievable through answering alone. To cross from Solid into Mastery,
a minimum of **20% of total domain points** must come from question creation earnings
in that domain.

- Solid is fully achievable through answering alone.
- Mastery requires both knowledge depth and intellectual contribution.
- A player who never creates questions has a meaningful ceiling at Solid.

*Example: To reach Mastery at 3,500 points, at least 700 points must have come from
creator earnings in that domain.*

**Personal Round Scoring**

Answers earned in a personal round (§8.37) count at full weight (1.0x) toward mastery
scoring, using the same `answer_state` rules as the group game. The 20% creator point
requirement for Mastery still applies — personal rounds build through Solid, but
Mastery still requires contribution.

**Mastery Moment**

When a tier threshold is crossed during a round, a brief full-screen beat fires after
the category breakdown — same cinematic register as the ceremony.

Copy variants:
- → Familiar: *"[Category]. You're finding your ground."*
- → Solid: *"[Category]. You move through this naturally now."*
- → Mastery: *"[Category]. This one's yours."*

Holds 3 seconds (5 seconds for Mastery). Tap to dismiss early. Multiple thresholds
in one round shown sequentially.

**Profile Display**

Each category on the player's profile displays tier between the category name and
the progress indicator. Establishing is the default entry state — not shown as a
label on cards until the player has begun accumulating points. Mastery receives
distinct typographic treatment — heavier weight — not a badge or star.

**Data Model**

New table: `PLAYER_MASTERY`

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key (`cuid()` in Prisma) |
| user_id | string | Foreign key → USERS |
| canonical_subcategory | string | |
| broad_category | string | nullable |
| total_points | float | Running total across all time (`PlayerMastery.total_points`) |
| tier | enum | `MasteryTier`: establishing \| familiar \| solid \| mastery |
| tier_reached_at | timestamp | Most recent tier upgrade |
| season_points_start | float | Points at season start, for ceremony delta |
| updated_at | timestamp | Auto-updated row timestamp |

**Implementation:** Prisma model `PlayerMastery` → table `PLAYER_MASTERY` (`@@map`).

### MASTERY_EVENTS TABLE

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → USERS |
| canonical_subcategory | string | |
| source_type | enum | `live_correct` \| `catchup_correct` \| `author_credit` \| `personal_round_correct` |
| question_id | uuid | Foreign key → QUESTIONS |
| answered_by_user_id | uuid | Nullable — for `author_credit` source type |
| answer_state | enum | Mirrors ANSWERS.answer_state |
| base_points | float | Calibrated difficulty value at time of event |
| weight | float | 1.0 \| 0.25 |
| awarded_points | float | base_points × weight |
| created_at | timestamp | |


---

### 8.33 Knowledge Page Display Model

**The Spider Graph**

The Knowledge page displays the player's top **8 domains** on a spider graph. Each
axis represents one domain. A dot sits on each axis at the position matching the
player's current level:

- Close to center = Establishing
- Midway out = Familiar
- Further out = Solid
- Outer ring = Mastery

Each dot also contains a subtle inner fill showing progress within the current level —
so a player can see they are 70% of the way to Solid without ever seeing a raw number.

**The List**

Every domain beyond the top 8 appears as a clean list below the spider graph. The
same progression language applies. There is no visual axis for list domains until they
earn their way onto the graph.

**Earning a Graph Slot**

When a list domain earns enough progress to enter the top 8, it bumps the weakest
current axis down to the list. This transition happens at the **end of a round** —
not in real time.

**Domain Assignment**

The LLM assigns exactly one domain to each question. The player never manually tags
anything. Over time, the LLM periodically examines the full picture of what a player
has answered and may adaptively merge domains. See §8.34.

**Maximum Graph Axes**

The graph never shows more than 8 axes. Domains beyond the top 8 always appear in
the list below.

**No Overlapping Categories**

Each question belongs to exactly one domain. No multi-tagging.

**Actionability**

The Knowledge page is both a display surface and an action surface. See §8.37 for
the full actionability specification.

---

### 8.34 Domain Merge and Split Rules

**Philosophy**

Domains are not permanent. As a player accumulates answers in related areas, the LLM
may merge adjacent domains into a richer, more specific combined category. If those
areas diverge, the combined domain may split.

**Merge Rules — Option B**

When two domains are merged:

- The merged domain starts at the level of the **higher-ranked** domain. Progress
  never goes backward.
- The lower domain contributes **50%** of its points toward progress within the
  new merged domain.
- Maximum advancement at merge time is **one level above the higher domain**
  regardless of the math.
- Formula: `Merged Points = Higher Domain Points + (Lower Domain Points × 0.50)`
- Merge happens at **end of round** only.
- Player receives a notification: *"Your knowledge of Bach and Buxtehude has grown
  into Early German Composers — and you are now Familiar."*

**Split Rules**

When a merged domain splits back into components:

- Each resulting domain receives points proportional to its original contribution
  percentage of the merged pool.
- Neither resulting domain can land lower than **one level below** the merged domain
  at split time.
- Split happens at **end of round** only.
- Player receives a notification that the split occurred.

---

### 8.35 Social Progress Snapshot

**What It Is**

The Social Progress Snapshot is the canonical replacement for a traditional
leaderboard. It is a snapshot — not a feed, not a ranked list — that shows the
progress of everyone in the current game and round. It is celebratory and
domain-focused, not competitive and score-ranked.

**What It Shows**

Progress moments framed around mastery domains and the canonical progression scale:

- *"Alex moved from Establishing to Familiar in Early Bach."*
- *"Jordan reached Mastery in Modern Art."*
- *"Sam is Solid in World History."*

No raw scores. No rank numbers. No comparative point totals.

**Two Versions**

**Per-round snapshot** — Shows progress moments scoped to the current round. Triggers
automatically for all players simultaneously when the round ends. Appears within the
round summary page. Referenced in §12.1.

**Full game snapshot** — Shows progress moments scoped to the entire game journey.
Triggers automatically for all players simultaneously when the full game ends. Appears
as part of Act 2 of the ceremony.

**Your Own Stats**

Treated identically to other players on the snapshot surface — progress moments only.
Raw numbers and detailed stats only surface when a player actively navigates to their
own Knowledge page.

**Future Consideration**

Broader friend group visibility beyond current game and round participants is not in
current scope.

---

### 8.36 Share Card System

**Philosophy**

Sharing in Joshing is not about broadcasting a score. It is about sharing a moment
in an ongoing intellectual journey. The share card surfaces where the player is
gaining momentum — not what they got right or wrong. A viewer who sees the card
should feel curious about the territory, not impressed by a number.

**The Primary Card — Mastery Momentum Format**

The primary share card shows the domain or domains where the player gained the most
ground this session. Copy adapts based on what happened:

| Trigger | Share Card Appears? | Format |
|---|---|---|
| Threshold crossed | Yes | *"Just reached Familiar in / Early Bach"* |
| Strong momentum, no threshold | Yes | *"Moving toward Solid in / Early Bach · Modern Art"* |
| Smaller movement | Yes | *"Building in / Early Bach · Modern Art"* |
| No domain movement | No | Card does not appear |

**What the Share Card Always Is**

- Personal — your knowledge story only
- Domain-forward — the territory is the signal, not the score
- Curious to a viewer — "what is Early Bach mastery?" is a better question than "what does 4/5 mean?"

**What the Share Card Never Shows**

- Right/wrong counts
- Point totals or numeric scores
- Solo-correct signals
- Group snapshot or others' progress
- Comparison to other players

**The Secondary Card — Emoji Grid**

The original emoji grid format is preserved as a secondary option. Accessible via
a small "show result grid" toggle below the primary card. Same one-tap copy behavior.

**Placement**

- **Daily (Act 1 end):** Final screen of Act 1, shown after Category Gains. If the
  player is last to finish and flows directly into Act 2, the share card moves to
  the end of Act 2 instead. **Note:** this is the **ceremony / act** flow — not the
  same as the **plain play thread** end state, which today ends on **§8.38**
  messaging without an inlined share card (§8.12).
- **Round end:** Personal share card shown within the round summary page, after the
  Social Progress Snapshot. Personal only — never a group share.
- **Full game (Act 2 end):** After the Invitation beat. Personal only.

**Appearance — Primary Card**
Joshing 🎯 College Friends · Round 3 Just reached Familiar in Early Bach joshing.com



Or:

Joshing 🎯 College Friends · Round 3 Moving toward Solid in Early Bach · Modern Art joshing.com



**The Viewer Landing Page**

When a non-player taps a shared card link, they see:

[Domain card — large, centered] College Friends · Round 3 · March 11 "The trivia you wish you were asked." Joshing is invitation-only. To play, ask [Name] to invite you. [ Request an Invitation ]



No answers are shown. No scores are shown. The invitation request button notifies
the game starter via SMS.

**Technical**

- Text format (copy/paste): plain text, one domain per line
- Visual card: ink-on-cream, wordmark, save / share / copy options
- Share card link — the viewer landing page — expires 90 days after 
  session date. The Game Summary page itself does not expire.

---

### 8.37 Knowledge Page Actionability and Personal Rounds *(new)*

**Philosophy**

The Knowledge page is both a display surface and an action surface. Players can
express intent — "I want more of this" — for any domain, existing or new. That intent
triggers a personal round: a self-directed, solo play mode that exists completely
outside the group game and is the most direct path to mastery.

**Entry Points**

| Trigger | Use Case |
|---|---|
| Domain card action button | Domain already exists on the player's chart or list |
| Free text search bar (top of Knowledge page) | Any topic — including domains with no history in the game |

The free text search handles the case where a player wants to go deep in territory
that has never appeared in their game — for example, Agatha Christie novels, if no
one has written those questions yet.

**How the Personal Round Works**

- System searches the public question pool for questions matching the chosen domain
- If matching questions are found, a personal round is created automatically — no
  game starter approval required, no group involvement
- 5 questions per session, delivered on the same daily rhythm as the group game
  (noon EST)
- Completely private — invisible to the group game, the game starter, and all other
  players
- Exists entirely outside the group game — it does not affect the group round, group
  pool, or any shared game state

**Scoring**

- Answers in a personal round count at full weight (1.0x) toward mastery scoring
- This makes the personal round the most direct mastery-building path available —
  more focused than the group game, which spreads questions broadly across domains
- The 20% creator point requirement for the Mastery tier still applies — personal
  rounds can build a player through Solid, but crossing into Mastery still requires
  question creation contribution
- Personal round answers follow the same `answer_state` rules as group game answers

**Friend Request**

From the same intent flow, a player can send a friend request asking a specific
group member to write questions on the chosen domain.

- Delivered via SMS (in-app notification TBD)
- Tone: playful, supportive, complimentary — never transactional
- Example copy: *"Josh is going deep on Agatha Christie — and thinks you might be
  the one to stump them. Feel like writing a few questions?"*
- The recipient is a group member chosen by the requesting player
- Writing and submitting questions in response follows the standard question creation
  flow

**Session End — Summary Screen**

When a player completes their personal round, a summary screen appears:

- Domain played
- Progression language only — no raw scores
- Mastery movement if applicable (e.g. *"You're moving closer to Familiar in Agatha Christie."*)
- Closing prompt: *"Want more? Your next 5 questions arrive tomorrow at noon."*

The summary screen is personal and clean — not ceremonial. It does not trigger Act 1
or Act 2 of the game ending ceremony.

**What Happens If No Matching Questions Exist**

If the public pool contains no questions matching the requested domain, the player sees:

*"We don't have [Domain] questions yet. Want to ask someone who might?"*

The friend request flow is surfaced as the primary action. A secondary action links
to the question creation flow so the player can write their own.

**Data Model**

New table: `PERSONAL_ROUNDS`

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → USERS |
| domain | string | Requested domain |
| status | enum | active \| complete \| expired |
| created_at | timestamp | |
| expires_at | timestamp | Next noon EST after creation |

---

### 8.38 Session Close Messaging *(new)*

**Philosophy**

When a player finishes their daily 5 questions, the product should close the session
with two pieces of information: confirmation that they are done for today, and a clear
signal of when to come back. This message also reinforces the mastery momentum
framing that runs through the rest of the product — every touchpoint should remind
the player that something is growing.

**Placement**

The session close message appears at the very end of the daily chat thread, as the final component of the Daily Summary. It is not a separate screen. **Shipped (`SessionCloseMessage`):**
adaptive **close copy** (table below), then **Review today’s answers**, then **See your
Knowledge page** — no share-card Copy/Share block in this component.

**Copy — Adaptive Format**

| Condition | Copy |
|---|---|
| Domain movement occurred (one domain) | *"Done for today. You're building in [Top Domain]. Your next 5 questions arrive tomorrow at noon."* |
| Domain movement occurred (two or more domains) | *"Done for today. You're building in [Domain 1] and [Domain 2]. Your next 5 questions arrive tomorrow at noon."* |
| No domain movement this session | *"Done for today. Your next 5 questions arrive tomorrow at noon."* |

**Implementation — two surfaces**

- **`SessionCloseMessage` / `GET /api/sessions/:id/close-message`:** **Shipped** copy
  matches the table above via `session-close-copy.ts` — always ends with *"Your next
  5 questions arrive tomorrow at noon."* (soft reference, no clock).
- **`SessionCompleteRow` (Round complete card in `GameplayChat`):** **Additional**
  line *"Next round opens [locale date + time]"* built from **`todayData.expires_at`**
  (`PlayClient.tsx` → `toLocaleDateString` with month, day, hour, minute). This is a
  **single static string** when the card appears — **not** a live countdown, not
  urgency copy. It answers “when does the daily window roll” using the same boundary
  the server already exposes.

**Rules**

- Domain reference pulls from the same calculation as the share card — the domain
  or domains with the most mastery movement this session
- If no domain movement occurred, the domain reference line is dropped entirely —
  no placeholder or generic text
- **Session close paragraph:** keep *"tomorrow at noon"* phrasing — no countdown
  widget, no “opens in 3:42” ticker, no pressure language
- **Round complete card:** may show one **expires_at-derived** timestamp line as
  above; still **no** countdown
- Maximum two domains named — if more than two domains moved, surface the top two
  by points earned this session

---

### 8.39 Developer Testing Mode *(new)*

**Purpose**

A testing utility that allows the product owner to instantly spin up a fresh
playable game without manually creating a group, adding questions, or waiting for
the daily rhythm. Available in all environments including production.

**Entry Point**

Settings screen. Clearly labeled — not hidden. Label: **"Create Test Game"**
with descriptor: *"Instantly create a fresh game with 5 questions from the test
account."*

**What One Tap Does**

In sequence:

1. Creates a new group with the requesting user as game starter
2. Creates a new game within that group
3. Pulls 5 questions from the pre-seeded question library belonging to 555-987-6543
4. Marks all 5 questions as unseen and unanswered for the requesting user —
   regardless of whether they have encountered those questions before in any
   prior game
5. Delivers the session immediately — does not wait for the noon EST daily cadence
6. Lands the user directly in the play flow for that session

**The Seed Account — 555-987-6543**

- A dedicated test account with a pre-loaded library of questions
- Questions cover a range of domains and difficulty levels to allow testing of
  mastery, scoring, category gain behavior, and ceremony flow
- Questions are always treated as `first_correct` eligible for the requesting user —
  prior answer history is ignored for test game sessions
- The seed library should be maintained and expanded as the product grows

**Behavior Rules**

- Test games are real games in the data model — they create actual `GROUPS`,
  `GAMES`, `ASSIGNMENTS`, and `ANSWERS` rows
- Mastery points earned in test games count toward the requesting user's mastery —
  this allows realistic testing of the progression system
- Test games appear in the user's game history
- Available in all environments including production
- No approval gate, no group size minimum, no question floor check — the seed
  library guarantees readiness

**What It Does Not Do**

- It does not reset or wipe any existing game state
- It does not affect other players' data
- It does not bypass the actual play flow — the user experiences the full daily
  session UI, scoring, ceremony, and share card as a real player would

**API Flow**

POST /api/dev/create-test-game

POST /api/groups/create — auto-named "Test Game [timestamp]"
POST /api/games/create — game_starter = requesting user
GET /api/questions?source=seed_account&limit=5
POST /api/assignments — force answer_state eligibility reset for requesting user regardless of prior history
POST /api/sessions/create — bypass noon EST cadence, deliver immediately
Redirect to /play

**Implementation gap:** answer submission still computes `answer_state` using **all**
prior answers for `(user, question)` across games unless fixed — see **Problem #10** in
`PRD_CODEBASE_FIXES.md`.


---

### 8.40 Replay (missed questions) — *current app*

**Purpose**

**Replay** is only for **questions you missed** — aligned with the app: the missed
pool is **not** “any past question,” it is assignments where you **answered
wrong** or the card **expired with no answer** (the same filter as
`GET /api/replay/missed`). Correctly answered in-session questions are **not** in
Replay. It is **not** AI-generated: every card is a **human** question from your
games. Outside the live daily session, Replay does **not** change canonical
game scores or mastery for the group round.

**Route and APIs (shipped)**

| Surface | Notes |
|---|---|
| **Route** | `/replay` — optional query `?group=&game=` to focus context (e.g. from review) |
| **Missed list** | `GET /api/replay/missed` — **only** assignments that are **wrong** (answered) or **expired with no answer**; sole source of Replay cards |
| **Grading** | `POST /api/replay/grade` — right/wrong feedback for practice; does not apply live-session scoring or mastery like normal play |

**Session shape**

- Up to **5** questions per “session” slice, selected in the **client** from the
  **missed** pool only (same pool as the missed list)
- Right/wrong feedback with answer reveal on a miss, similar feel to the main game
- **No** point display, **no** delta, **no** ceremony; UI may still use the word *“practice”* informally in body copy

**Mastery and scoring**

- **No mastery credit** and no leaderboard impact
- Excluded from difficulty calibration of real group questions
- **Distinct from catch-up (§8.19):** catch-up is `/play?…&mode=catchup` in the main game
  flow, with **reduced** mastery weight. Replay is a **separate** side loop with
  **zero** mastery weight.

**What Replay is not**

- Not the **personal round (§8.37)** — that uses the human public pool and full
  mastery rules
- Not **AI Practice Mode (§8.41)** — that specification is **deferred**; the app
  does not yet generate AI-only question sessions
- Not a group-visible activity — other players are not notified

**Entry points (current)**

- End of Session Review: link to `/replay?group=…&game=…` (e.g. *“Practice missed in Replay”*)
- Other surfaces that summarize missed items may link to `/replay`

**Data model (current)**

No dedicated `REPLAY` or `PRACTICE_SESSIONS` table. Replay reads existing assignment
and question data via the replay API layer; implementation details belong in
engineering docs.

---

### 8.41 AI Practice Mode *(deferred — not in current app)*

**Status — read first:** The product below is a **target** design, **not** what
ships today. The live app implements **Replay** (§8.40) for missed real questions
instead. The schema table is **aspirational** until this feature is built; there
is no matching Prisma model in the repository yet.

**Purpose (target)**

AI Practice Mode would be a consequence-free, **AI-powered** solo play mode
giving access to trivia **generated** from the player’s **proven territory** at
any time — between seasons, after a daily session, or on demand. It would sit
entirely outside the group game and carry **no** mastery credit.

**Target — problem solved**

It would address content scarcity in early network conditions without breaking the
rule that **live** group questions stay human-written. In the **target** design,
AI-generated questions would appear **only** here — not in a live group game, not
in catch-up, not in the personal round.

**Target — entry points**

| Trigger | Context |
|---|---|
| "More like this" CTA on game completion (if shipped) | Pre-loaded with inferred territory from the just-finished game |
| Home / off-season | Available when the player is between seasons |
| Always-on entry | Available any time, any season, if the feature ships |

**Target — content & labeling**

Questions would be AI-generated, with no human author. The surface would make the
source explicit, e.g. *"AI-generated questions — not part of your game."*

**Target — territory inference**

Would infer from **proven territory** (correct answers across games,
difficulty-weighted). No manual topic picker.

**Target — session structure**

- 5 questions per session
- Feedback and reveals like the main game; no time-pressure countdown
- Cadence would align with noon EST daily reset in product terms when implemented

**Target — what it is not**

- Not **Replay (§8.40)** — Replay uses real missed game questions, not LLM
  generated cards
- Not the **personal round (§8.37)**
- Not a path to mastery in the **target** design
- Not a group experience

**Target — data model (not implemented)**

A future implementation would store sessions **outside** main-game `ASSIGNMENTS`.

| Field | Type | Notes |
|---|---|---|
| id | uuid | primary key |
| user_id | uuid | foreign key → USERS |
| generated_at | timestamp | |
| territory_snapshot | jsonb | proven territory vector used for generation |
| questions | jsonb | AI-generated question text, answer, category |
| answers | jsonb | player responses and correct/incorrect outcome |
| session_date | date | noon EST reset anchor |

**Target — analytics**

Exclusion from all mastery, calibration, and group analytics, same spirit as
§8.40 for consequence-free play.

---

## Section 9: LLM Integration

### 9.1 Auto-Categorization

Input: Question text and answer text. Output: `{ "category": "Late Tchaikovsky", "broad_category": "Classical Music" }`. Latency: Asynchronous, up to 5 seconds acceptable.

**Hyper-specific category tagging is a named product principle.** Categories must be as specific as the question demands. The LLM tagger is explicitly instructed to resist normalizing upward into broad buckets. "Late Tchaikovsky" is correct. "Romantic Music" is not specific enough. "Bowie-era Glam Rock" is correct. "Rock Music" is not. "Weimar Modernism" is correct. "Literature" is not.

The value of the knowledge portrait collapses if categories are too broad. A player's portrait should show "Late Tchaikovsky," "Post-Berlin Bowie," and "Sondheim Musicals" — not "Classical Music," "Rock," and "Musical Theatre." The specificity is the point.

The tagger returns two values: a hyper-specific subcategory (used for the portrait and Friend Play category selection) and a broad category (used only for session variety constraints and game-level filtering). The broad category is a grouping utility. The hyper-specific subcategory is the identity signal.

A canonicalization step follows tagging. Near-synonym labels are clustered: "Sondheim," "Stephen Sondheim Musicals," and "Sondheim-era Broadway" resolve to the canonical form "Sondheim Musicals." Canonical labels are stable but can evolve — if enough questions accumulate under a broad tag, the system may split it into two more specific nodes. Individual questions do not create orphaned subcategories with insufficient volume to produce meaningful data (minimum 3 questions before a subcategory appears on a portrait).

### 9.2 Answer Suggestion

Input: Question text only. Output: JSON with suggested answer, question type, and optional writer-facing note. Latency: Under 3 seconds. Triggered after 1 second of inactivity when the question field loses focus.

```json
{ "type": "factual", "suggested_answer": "Bucephalus", "note": null }
{ "type": "factual_uncertain", "suggested_answer": "Possible answer", "note": "I'm not entirely sure — you may want to double-check." }
{ "type": "ambiguous", "suggested_answer": null, "note": "This might be hard to grade objectively. Is there a specific answer in mind? If not, consider reframing toward something with a clearer correct answer." }
{ "type": "personal", "suggested_answer": null, "note": "This question may depend on private knowledge of you specifically, which makes it hard to grade fairly. Joshing questions work best when drawn from shared cultural territory rather than personal biography. Consider reframing — for example, instead of 'What is my favorite opera?' try 'What opera features the famous Drinking Song?'" }
```

The `personal` type now explicitly redirects writers toward factual, shared-world territory rather than endorsing questions that cannot be graded without private biographical knowledge. **Implementation:** the classified `question_type` (including `personal`) is **stored** on the `Question` row when the writer saves—there is no silent drop of `personal` before persistence (see Section 11).

### 9.3 Answer Grading

Input: Canonical answer, accepted_alternatives array, submitted answer, minimum_required integer for list questions. Output: `{ "result": "CORRECT" }` or `{ "result": "WRONG" }`. Latency: Under 2 seconds. Critical path. No chain-of-thought prompting.

**Rules the LLM Must Apply**

- **Case insensitivity:** beethoven and BEETHOVEN both correct
- **Spelling variants:** Beethovan accepted. Intent over orthography
- **Acceptable abbreviations:** Eroica for The Eroica Symphony correct
- **List questions:** Submitted answer must contain at least the minimum required number of valid entries
- **Reasonable paraphrasing:** She had an extra finger correct for supernumerary digit
- **Cross-language equivalence:** Accurate translation in any language accepted
- **Accepted alternatives:** Any entry in the accepted_alternatives array is treated as correct

**What the LLM Must Not Accept**

- Answers in the right domain but factually wrong
- Wild guesses containing a keyword from the correct answer
- Partial list answers below the minimum threshold
Players can submit up to **100 questions per round** for consideration. This limit
is a placeholder and may be revisited.

*(All grading rules unchanged)*

### 9.4 Educational Explanations

**Private game (shipped):** Educational reflection copy is **not** shown on the
immediate answer / result row in the play thread — that surface follows §8.9
(result, canonical answer if wrong, relational and breadcrumb copy only).

**LLM contract (implemented):** `generateFactualReflectionExplanation(questionText,
canonicalAnswer)` in `app/src/lib/llm.ts`. Output: **plain text**, **2–3 sentences**,
informational tone, no reader address, no relationship framing. This populates
**`Question.factual_explanation`**.

**When it runs:** After an answer is recorded, if `factual_explanation` is still
empty, the server **schedules** generation and a DB update **asynchronously** (POST
answer returns without waiting). **One string per question** — not regenerated per
player or per submission; not split by correct/wrong/expired in this path.

**Where it appears:** **End of Session Review** (`ReviewClient` — truncate ~150
characters with expand), game **archive** / **details** (may prefer
`explainer_full` when present — see `details-transformers.ts`), and similar
reflection surfaces — **not** inlined in the live chat thread.

**Schema note:** `Question` also carries legacy **`explainer_brief*` /
`explainer_full*`** columns (per result type) used in some non–private-game paths;
private assignment flow does **not** populate them via `generateExplainer`.

**`generateExplainer` (brief + full JSON):** Retained in `llm.ts` for unit tests;
not wired to production private play. If product later adopts split brief/full
again, §8.9 and this section must be updated together.

### 9.5 Public Pool Eligibility Scoring

Phase 2 feature. At end of each game, score every question for public eligibility. Input: Question text and canonical answer. Output: public_eligible boolean, confidence score 0 to 1, reason string. Eligible questions queued with 14-day opt-out window.

Eligibility criteria: self-contained, factually grounded, no inside references that only a specific group would understand, not so obscure as to be unanswerable by an interested stranger.

### 9.6 "Find Your People" Invitation Copy

Phase 2 feature. Input: inviting player's category profile (category names and percentile scores). Output: personalised invitation copy string, 1-2 sentences, warm and specific to the player's intellectual territory.

This is a lightweight call — the output is a short string, not structured data. Latency: under 3 seconds.

---

## Section 10: Public Question Pool

*Phase 2 feature (Public Daily Game). Phase 3 feature (Public Infinite Run). Data architecture built into the MVP data model from the start.*

**The Two Public Modes**

The public layer has two distinct surfaces. See Section 8.25 for the full specification of the Public Daily Game (Phase 2). This section covers the question pool architecture shared by both modes, and the Public Infinite Run mechanics (Phase 3).

**How Questions Enter the Public Pool**

Questions enter the public pool through two paths:

**Path 1 — Per-question opt-in (Phase 1 scaffolding, Phase 2 activation):** The creator opts individual questions into sharing at creation time via the toggle in Section 8.2. These questions are staged for public distribution and become available to the full public pool when Phase 2 launches.

**Path 2 — LLM eligibility scoring (Phase 2):** At the end of each game, the LLM scores all questions for public eligibility. Eligible questions are queued for migration. Players have 14 days to opt out. After 14 days, eligible questions not opted out are migrated.

Eligibility criteria: self-contained, factually grounded, no inside references, not so obscure as to be unanswerable by an interested stranger. Questions with high private star counts carry that quality signal into the public pool.

Author names travel with questions in both paths. Questions are never anonymized in the public pool.

**The Public Daily Game**

See Section 8.25 for full specification. Five questions per day, Wordle-style, tribe discovery, invitation-only. Phase 2.

**The Public Infinite Run**

Phase 3 feature. A continuous infinite stream of questions — not a daily session, not a fixed question count. The player opens the feed when they want to play. They play until they strike out or stop. No noon SMS. No daily reset. Always available.

*The Two-Strike Mechanic:* Two wrong answers end the run. Your score is how many questions you answered correctly before striking out. The run ends, your score is shown, you can start a new run immediately. This mechanic is entirely absent from the private game, which is intentionally low-stakes and warm. The public infinite run can have teeth.

*The Skip:* Unlimited and costless. A skipped question disappears — it does not return. Skip is risk management: attempt this and risk a strike, or skip and stay alive. The combination of unlimited skips and two-strike endings creates genuine skill expression.

*The Run Summary:* Score (questions correct), run length (questions attempted), questions skipped, best category, the two questions that ended the run with full explainers, option to start a new run immediately. The run summary is shareable.

*Category Filtering:* Named presets controlling what categories appear in the feed: "Just my people" (100% from followed creators) / "Mostly mine" / "Mix it up" / "Surprise me" (100% random). Default: "Mostly mine."

*Question Throttle (Free Tier):* Free users: up to 10 questions per run, maximum 2 runs per day. Plus subscribers: unlimited.

**Content Moderation**

Flag a public question. Flagged questions reviewed and removed if upheld. Full moderation UI in Phase 2.

**Voice Input (Phase 2)**

Voice input via Web Speech API. Players tap a microphone button, speak their answer, tap Submit. The grading endpoint receives a voice flag and applies appropriate leniency for phonetic near-matches and transcription errors. Requires specific design work before Phase 2 build begins. See Section 19, Open Question 3.

**Architecture Note for MVP**

The following must be in the MVP data model: visibility field on QUESTIONS (private / public), public_status field, public_eligibility_score field, public_eligibility_reason field, PLAYER_SUBSCRIPTIONS table, FLAG_REPORTS table, USER_INTEREST_PROFILES table (Section 8.25), AUTHOR_QUESTION_STATS table (Section 8.26), SIMILARITY_SHARES table (Section 8.23), and public distribution fields on QUESTIONS.

PUBLIC_RUNS table (Phase 3): id, user_id, started_at, ended_at, questions_attempted, questions_correct, questions_skipped, strikes, share_card_token.

---

## Section 11: Data Model

ll IDs are UUIDs. All timestamps stored in UTC. Field names use snake_case.

### USERS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| display_name | string | Required; unique for players with author profiles |
| phone_number | string | Required, unique — E.164 format, US only |
| phone_verified | boolean | |
| timezone | string | IANA — one of six US timezones |
| is_subscriber | boolean | Default false |
| subscription_plan | enum | free / plus_monthly / plus_yearly |
| author_profile_public | boolean | Default true for players with at least one shared question |
| author_slug | string | Unique, generated from display name at first question share |
| created_at | timestamp | |
| updated_at | timestamp | |

### QUESTIONS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| creator_id | UUID | Foreign key to Users |
| question_text | text | Required |
| answer_text | text | Required |
| accepted_alternatives | text array | Default empty |
| answer_source | enum | llm_suggested / creator_written / llm_edited |
| question_type | enum | `factual` \| `factual_uncertain` \| `ambiguous` \| `personal` — aligned with LLM output types (§8.2 / §9.2). **Shipped schema:** all four values may be **persisted**; `personal` still means “steer the writer to reframe,” not that the value is dropped before save. |
| minimum_required | integer | Nullable — for list questions |
| category | enum | music / literature / history / film_tv / sport / science / philosophy / pop_culture / language / other — `other` is storage-only; clients **MUST NOT** display the label "Other" on scoring, mastery, ceremony, review, share, or seeding balance surfaces (see §8.10 failure contract) |
| category_override | boolean | |
| difficulty_estimate | enum | accessible / moderate / specialist (nullable) |
| creator_note | text | Nullable — never returned before End of Session Review |
| explainer_brief | text | Nullable — cached after first answer |
| explainer_full | text | Nullable — cached after first answer |
| visibility | enum | private / public — private in MVP |
| public_status | enum | not_scored / eligible_pending / opted_out / migrated / rejected |
| public_eligibility_score | float | Nullable |
| public_eligibility_reason | text | Nullable |
| shared_for_public_pool | boolean | Default false — per-question opt-in toggle |
| distribution_weight | float | Default 1.0 — updated based on star performance |
| public_source | enum | private_game / imported_public — default private_game |
| source_question_id | UUID | Nullable — for imported public questions |
| created_at | timestamp | |
| updated_at | timestamp | |

### GROUPS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | string | Required |
| game_starter_id | UUID | Foreign key to Users |
| game_mode | enum | know_me / know_me_plus / open |
| minimum_questions_required | integer | Default 5, configurable server-side |
| status | enum | active / between_games / dormant / archived |
| games_completed | integer | Default 0 |
| allow_similarity_share | boolean | **Target / deferred** — not in shipped `Group` schema yet. When implemented: default **true** for `know_me`, explicit opt-in for `know_me_plus` / `open` (see §8.4). |
| created_at | timestamp | |
| updated_at | timestamp | |

### ANSWERS TABLE

*(Unchanged except the following — answer_state column)*

| Field | Type | Notes |
|---|---|---|
| ... | ... | *(all existing fields unchanged)* |
| answer_state | enum | `first_correct` \| `first_correct_after_wrong` \| `repeat_correct` \| `incorrect` — computed at insert time, never updated after insert |

### PLAYER_MASTERY TABLE *(from §8.32)*

| Field | Type | Notes |
|---|---|---|
| id | string | Primary key (`cuid()`) |
| user_id | string | Foreign key → USERS |
| canonical_subcategory | string | |
| broad_category | string | nullable |
| total_points | float | Running total |
| tier | enum | `MasteryTier`: establishing \| familiar \| solid \| mastery |
| tier_reached_at | timestamp | Most recent tier upgrade |
| season_points_start | float | Points at season start |
| updated_at | timestamp | Auto-updated |

### PERSONAL_ROUNDS TABLE *(from §8.37)*

| Field | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Foreign key → USERS |
| domain | string | Requested domain |
| status | enum | active \| complete \| expired |
| created_at | timestamp | |
| expires_at | timestamp | Next noon EST after creation |


### GROUP_MEMBERS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| group_id | UUID | Foreign key to Groups |
| user_id | UUID | Foreign key to Users |
| joined_at | timestamp | |
| invited_by | UUID | Foreign key to Users, nullable |
| status | enum | active / removed / left |
| games_completed | integer | Default 0 |
| questions_contributed_total | integer | Default 0 |
| joining_contribution_complete | boolean | Default false for Setup 3 |
| open_round_contributed | boolean | Default false — Setup 2 only |

**Implementation (current schema):** `GroupMember` does **not** persist `votes_remaining_today`, `votes_last_reset`, or `similarity_mode`. The daily star budget in §8.10 is enforced in application logic (e.g. `StarVote` and review/star APIs), not as denormalized counters on membership. Similarity-share join tracking is not stored on `GroupMember` until that feature’s data model lands (see `SIMILARITY_SHARES` and related work).

### GAMES TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| group_id | UUID | Foreign key to Groups |
| game_number | integer | |
| status | enum | seeding / active / completed |
| started_at | timestamp | |
| completed_at | timestamp | Nullable |
| total_questions | integer | |
| created_at | timestamp | |

### GAME_QUESTIONS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| game_id | UUID | Foreign key to Games |
| group_id | UUID | Foreign key to Groups |
| question_id | UUID | Foreign key to Questions |
| added_at | timestamp | |
| added_by | UUID | Foreign key to Users |
| is_opening_question | boolean | Default false — at most one `true` per game; first question every player sees in their first session |
| position | integer | Nullable — optional ordering within the game pool |

### DAILY_ASSIGNMENTS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | Foreign key to Users |
| group_id | UUID | Foreign key to Groups |
| game_id | UUID | Foreign key to Games |
| question_id | UUID | Foreign key to Questions |
| assignment_date | date | The UTC date of the 24-hour window |
| expires_at | timestamp | Next noon EST (17:00 UTC) |
| status | enum | pending / answered / expired |
| position | integer | Ordering within the day's questions |
| daily_link_token | string | Unique |

Note: Assignment algorithm excludes questions where `question.creator_id = user.id`. Author interleaving applied where pool permits.

### ANSWERS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | Foreign key to Users |
| question_id | UUID | Foreign key to Questions |
| group_id | UUID | Foreign key to Groups |
| game_id | UUID | Foreign key to Games |
| daily_assignment_id | UUID | Foreign key to Daily_Assignments |
| submitted_answer | text | Nullable — null if expired |
| result | enum | correct / wrong / expired |
| answered_at | timestamp | Nullable |
| disputed | boolean | Default false |
| catch_up | boolean | Default false — `true` when the answer is submitted in catch-up mode (shipped schema; not a `session_type` enum) |
| question_presented_at | timestamptz | Nullable — records when the question was first displayed to the player in the session |
| response_time_ms | integer | Nullable — calculated at answer submission: `answered_at - question_presented_at`, stored as integer milliseconds |

These fields power the Temporal Highlights reveals (Reveal 4 and Reveal 5) in the Personal Record beat of the ceremony. If absent, those reveals omit silently — the ceremony does not fail.

### DAILY_SESSIONS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| user_id, group_id, game_id | UUIDs | Foreign keys |
| session_date | date | |
| session_start_time | timestamp | Server-authoritative — records when session began |
| questions_assigned | integer | Always 5 |
| questions_answered | integer | |
| questions_correct | integer | |
| questions_expired | integer | |
| share_card_text_copied | boolean | |
| share_card_link_shared | boolean | |
| share_card_link_token | string | Unique |
| share_card_link_expires_at | timestamp | 90 days after session_date |
| created_at | timestamp | |

### REACTIONS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| user_id, question_id, group_id, game_id | UUIDs | |
| type | enum | star |
| created_at | timestamp | |

### QUESTION_REACTIONS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| question_id | UUID | Foreign key to Questions |
| game_id | UUID | Foreign key to Games |
| from_user_id | UUID | Foreign key to Users |
| to_user_id | UUID | Foreign key to Users |
| canned_type | enum | Nullable — answerer: `always_knew` / `got_me` / `of_course_you` / `never_heard` / `need_to_talk` / `didnt_know_tell_me` / `need_story` / `adding_to_list` / `knew_i_wouldnt` — creator: `knew_youd_get_it` / `surprised_you_knew` / `just_for_you` / `story_here` |
| note_text | text | Nullable — max 100 chars, private to the pair |
| parent_reaction_id | UUID | Nullable — for creator responses |
| created_at | timestamp | |

Indexed on (question_id, game_id) and (to_user_id). Reaction note text never exposed to any user other than from_user_id and to_user_id.

### GRADE_DISPUTES TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| answer_id | UUID | Foreign key to Answers |
| question_id | UUID | Foreign key to Questions |
| creator_id | UUID | Foreign key to Users |
| submitted_answer | text | |
| canonical_answer | text | |
| status | enum | pending / reviewed / alternative_added / dismissed |
| created_at | timestamp | |
| reviewed_at | timestamp | Nullable |

### COMPATIBILITY_SCORES TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| knower_id, subject_id, group_id | UUIDs | |
| questions_actively_answered | integer | Excludes expired |
| questions_correct | integer | |
| score_percent | float | Derived |
| last_updated | timestamp | |

Displayed only when `questions_actively_answered` is at least 5.

### SMS_LOG TABLE

Message types (`message_type` enum): otp / daily_questions / daily_questions_batched / star_notification / correct_answer_notification / question_reaction / creator_reaction_response / game_complete / game_summary_ready / expiry_reminder /  anniversary_milestone / similarity_share_complete / wrong_answer_creator_prompt / ai_suggestion_available

Note: SMS_LOG never contains answer text, question content, or reaction note text — privacy by design.



### SIMILARITY_SHARES TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| sharer_id | UUID | Foreign key to Users |
| recipient_id | UUID | Nullable until recipient authenticates |
| game_id | UUID | Foreign key to Games |
| recipient_phone | string | Cleared after recipient authenticates |
| share_sent_at | timestamp | |
| recipient_started_at | timestamp | Nullable |
| recipient_completed_at | timestamp | Nullable |
| similarity_score | float | Nullable until both complete |
| category_scores | jsonb | Nullable until both complete |
| pool_sharing_consented | boolean | Copied from GROUPS at share time |

### SUGGESTION_BATCHES TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| game_id | UUID | Foreign key to Games |
| triggered_at | timestamp | |
| batch_number | integer | |
| questions_suggested | integer | |
| questions_added | integer | |
| questions_edited | integer | |
| questions_saved | integer | |
| questions_discarded | integer | |

### AUTHOR_QUESTION_STATS TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| question_id | UUID | Foreign key to Questions |
| creator_id | UUID | Foreign key to Users |
| total_pools_played | integer | |
| total_plays | integer | |
| total_correct | integer | |
| total_stars | integer | |
| last_updated | timestamp | |

Updated asynchronously after each session.

### USER_INTEREST_PROFILES TABLE

| Field | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| user_id | UUID | Foreign key to Users |
| declared_categories | text array | Set at public game onboarding |
| demonstrated_categories | jsonb | category → score float |
| combined_profile | jsonb | Weighted blend |
| tribe_size | integer | Updated weekly |
| tribe_percentile | float | Updated weekly |
| category_percentiles | jsonb | category → percentile float |
| last_tribe_calculated | timestamp | |
| updated_at | timestamp | |



**Deduplication rule for `author_credit`:** Before writing any `author_credit` event, check:

```sql
SELECT COUNT(*) FROM MASTERY_EVENTS
WHERE source_type = 'author_credit'
  AND question_id = :questionId
  AND answered_by_user_id = :answeringPlayerId
```

If COUNT > 0: skip entirely. One `author_credit` per question per answering player, across all time.

**`author_credit` is not triggered when:**
- The answering player is the question author
- The answer is submitted via catch-up mode (`catch_up = true` on the `Answer` row)

`author_credit` **is** triggered on correct answers at all difficulty levels
(Accessible, Moderate, and Specialist), subject to the deduplication rule above.

`author_credit` **is** triggered on Friend Play correct answers at all difficulty
levels, subject to the same deduplication rule.


Historical mastery points are frozen when `calibrated_difficulty` is reclassified. Future answers use the new weight; past MASTERY_EVENTS records are not retroactively adjusted. Enables: per-question mastery contribution display, audit trail for difficulty reclassification events.

### CEREMONY SHARED PAYLOAD API

`GET /api/groups/:groupId/games/:gameId/ceremony` — authenticated; validates group membership. Returns shared ceremony beats; includes `fastest_correct` (see below), the only Personal Record field present on this response.

### CEREMONY PERSONAL RECORD API

`GET /api/ceremony/:gameId/personal-record` — authenticated, private to the requesting player.

Full response shape:

```json
{
  "categories_led": ["Late Tchaikovsky", "Weimar Cinema"],
  "categories_tied": [{ "category": "Structural Engineering", "tied_with": "Maya" }],

  "questions_landed": {
    "count": 4,
    "example_question": "Which composer developed the tintinnabuli technique?"
  },

  "hardest_correct": {
    "question_text": "Which architect designed the Barcelona Pavilion?",
    "group_correct_rate": 0.12,
    "you_and_who_else": []
  },

  "longest_held": {
    "question_text": "Which architect designed the Barcelona Pavilion?",
    "response_time_ms": 28400,
    "canonical_subcategory": "Modernist Architecture",
    "was_correct": false
  },

  "mastery_movement": [
    { "subcategory": "Late Bach", "from_tier": "establishing", "to_tier": "familiar" }
  ],

  "author_points_given": 34.5,
  "top_author_question": {
    "question_text": "Which composer developed the tintinnabuli technique?",
    "canonical_subcategory": "20th Century Minimalism",
    "points_generated": 9.0,
    "correct_count": 3
  }
}
```

The same `fastest_correct` object is also the only Personal Record field duplicated on the shared group-scoped ceremony response; it appears as:

```json
{
  "fastest_correct": {
    "question_text": "Which composer developed the tintinnabuli technique?",
    "response_time_ms": 6200,
    "canonical_subcategory": "20th Century Minimalism"
  }
}
```

`fastest_correct` is the only Personal Record field that travels in the shared payload. All other Personal Record fields are private to the authenticated endpoint.

**Data-contract enforcement (normative):**

- For any returned object that includes `canonical_subcategory` and is rendered category-first, `canonical_subcategory` **MUST** be canonical and valid.
- Producers **SHOULD** suppress invalid rows before response serialization; clients **MUST** still enforce suppression defensively if invalid rows arrive.
- API and client layers **MUST NOT** inject fallback category labels (`"Other"`, `"Uncategorized"`, or generic replacements) for invalid/missing canonical values.
- When suppression occurs (server-side or client-side), telemetry/logging **MUST** capture enough context to diagnose the tagging defect.

`author_points_given` query:

```sql
SELECT COALESCE(SUM(awarded_points), 0) as author_points_given
FROM MASTERY_EVENTS
WHERE user_id = :currentUserId
  AND source_type = 'author_credit'
  AND created_at BETWEEN :gameStartDate AND :gameEndDate
```

`top_author_question` query:

```sql
SELECT
  q.question_text,
  q.canonical_subcategory,
  SUM(me.awarded_points) as points_generated,
  COUNT(DISTINCT me.answered_by_user_id) as correct_count
FROM MASTERY_EVENTS me
JOIN QUESTIONS q ON q.id = me.question_id
WHERE me.user_id = :currentUserId
  AND me.source_type = 'author_credit'
  AND me.created_at BETWEEN :gameStartDate AND :gameEndDate
GROUP BY q.id, q.question_text, q.canonical_subcategory
ORDER BY points_generated DESC, me.created_at DESC
LIMIT 1
```

If `author_points_given = 0`: return `top_author_question: null`. Round `author_points_given` to one decimal place before returning.

### QUESTIONS TABLE additions

Two new fields on the existing QUESTIONS table:

| Field | Type | Notes |
|---|---|---|
| asked_count | integer | Default 0 — incremented each time the question is served to a player |
| correct_count | integer | Default 0 — incremented each time a player answers correctly |

Display: author's own profile only, question detail view. Format: `Asked: N · Correct: N (X%)`. Never surfaced publicly. Backfill from existing game event logs on migration. Phase 3: `difficulty_drift` computed field when empirical correct rate diverges >30% from declared difficulty.

---


## Section 12: SMS and Notifications

SMS is the primary and only notification channel in the MVP. No push notifications. No email.

**SMS Provider**

**Twilio** — market-leading US reliability, delivery status webhooks. **Implementation
(current app):** server-side **`fetch`** to Twilio’s **REST API**
(`…/Accounts/{AccountSid}/Messages.json`) with **HTTP Basic** auth (`TWILIO_ACCOUNT_SID`
+ `TWILIO_AUTH_TOKEN`) and **`MessagingServiceSid`** in the form body — see
`app/src/lib/sms.ts`. The official **Node.js SDK** is **not** required; it remains an
acceptable alternative if the implementation ever changes.

### All SMS Messages

**Daily questions (single group, from day two onwards):**
> *"Your [Group Name] questions are ready. 5 questions, answer by noon tomorrow: [link]"*

**Daily questions (batched — 2 or more groups):**
> *"You have questions waiting in [Group 1] and [Group 2]. Answer by noon tomorrow: [link]"*

**OTP:**
> *"Your Joshing code is [######]. Valid for 10 minutes."*

**Group invitation copy (Setup 1 and 2 — for creator to send from their own phone):**
> *"[Your name] has invited you to play Joshing — College Friends. 5 questions are waiting: [link]"*

**Group invitation copy (Setup 3 — for creator to send from their own phone):**
> *"[Your name] has invited you to play Joshing — Book Club. Add 5 questions to join, then start playing: [link]"*

**Star notification:**
> *"[Name] starred your question in [Category]."*

**Correct answer notification (opt-in, off by default):**
> *"[Name] got your [Category] question right."*

**Question reaction notification:**
> *"[Name] reacted to your question in [Group Name]."*

**Creator response notification:**
> *"[Name] replied to your reaction in [Group Name]."*

**Wrong answer creator prompt (once per question per player, opt-in):**
> *"[Name] got your [Category] question wrong — want to tell them why you added it? [link]"*

**Game complete — season end (non-winner):**
> *"The [Group name] season just ended. [Winner name] knew you best. See how it all mapped out: [link]"*

**Game complete — season end (winner):**
> *"You won the [Group name] season. See the final map: [link]"*

**Game complete — two-player, non-winner:**
> *"Your Joshing season with [Other player name] just ended. See how your worlds overlapped: [link]"*

**Game complete — two-player, winner:**
> *"Your Joshing season with [Other player name] just ended. See how your worlds overlapped: [link]"*

**Game complete — tie:**
> *"The [Group name] season ended even. [Name] and [Name] finished together. See the map: [link]"*

**Game pool exhausted:**
> *"You've answered all the questions in [Group Name]. Watch for the Game Summary soon."*

**Game pool waiting — open round, Setup 2:**
> *"You've caught up in [Group Name]. Check back — more questions may be on the way."*

**Similarity share complete:**
> *"[Name] finished your questions. See how aligned you are: [link]"*

**Expiry reminder (opt-in only):**
> *"Your [Group Name] questions expire at noon today. [N] still waiting: [link]"*

**SMS Rate Limiting**

Maximum 5 messages per phone number per 24 hours across all message types. OTP limited to 3 per phone number per hour. Daily question SMS for 2+ groups uses a single batched message.

**SMS Compliance**

All messages comply with TCPA regulations. Explicit consent captured at sign-up. Every message includes an opt-out path. STOP replies handled by Twilio natively.

### 12.1 End of Round Highlights

At the end of each round, the Social Progress Snapshot (see §8.35) highlights the
most significant progress moments from that round. These are not ranked by points.
Instead, moments are surfaced when a player crosses a milestone on the canonical
progression scale: Establishing → Familiar → Solid → Mastery. All milestone moments
are celebrated equally. No player is ranked above another. The goal is to celebrate
movement and growth, not to declare a winner.

---

## Section 13: Personal Performance

**Philosophy — Private by Default**

Joshing does not rank players against each other publicly. Individual performance
data is private to the player. Getting something wrong is a discovery. There is
**no** session countdown; pacing is the daily assignment window (`expires_at`,
Section 15). The social element comes from shared knowledge, not individual standings.

**Catch-Up Weight in Personal Performance**

Catch-up answers count at **0.25x weight** toward mastery scoring regardless of
whether the round is active or in the 7-day post-game grace period. This is reflected
in the player's Knowledge page with a single global footnote.

**Personal Performance in the Full Web Interface**

Route: `/profile`. Visible only to the signed-in player.

*Within a group:*
- Total questions answered this game and all games combined
- Correct answer percentage overall and by category — framed as strength (*"You carry the Music knowledge in this group"*) and discovery territory (*"Philosophy is where you have the most to explore"*)
- Stars given and received
- Who knows me best / who I know best
- Personal trend: accuracy by game over time
- Wrong answer history — private record of questions missed, with creator notes and **Replay** links (`/replay`)
- Similarity history — all post-game similarity comparisons initiated, with scores and category breakdowns

*Across all groups:*
- Total questions answered all time
- Overall correct percentage
- Strongest and weakest category
- Total stars given and received
- Streak history — current streak and longest streak

**Group Longevity and Game Count**

Every group card shows how many games the group has completed — a simple count that compounds in meaning over time. A group on Game 7 has history. That number is earned.

Milestone copy surfaced quietly in the game summary:

- Game 2: *'Two games in. You're a group now.'*
- Game 5: *'Five games. That's a real streak.'*
- Game 10: *'Ten games. This group has some history.'*
- Game 25: *'Twenty-five games. Most groups never get here.'*

**Alignment as the Primary Social Metric**

*'You now know Josh 80% of the time'* is more meaningful than any ranked position. Alignment shifts are surfaced prominently in the session review and personal performance view.

**Group Anniversary Milestones**

When a group crosses a time-based milestone — 3 months, 6 months, 1 year of active play — the next game summary surfaces a brief reflection. Not a badge. Not a pop-up. A paragraph of quiet, specific data.

Three-month example: *'Three months with Sadiearidos. In that time you've answered 87 questions, starred 4, and your alignment with Josh has gone from 58% to 74%. Your strongest shared ground is Music.'*

Six-month example: *'Six months. That's 174 questions between you. The category you've learned the most about from this group: History.'*

One-year example: *'A year of Joshing with this group. Here are the five questions everyone got right — the things you all carry together.'* Followed by the five 100%-correct questions from the year's archive.

Anniversary milestones are specific to this group's actual data. Never generic congratulatory text.

**Confidence Before Answering — Optional Signal**

Below the answer input, an optional toggle: *'I'm sure about this.'* Off by default, never required. Adds a calibration view to the post-session experience (*'You were sure on 4 questions and got all 4 right — well-calibrated'*) and texture to the session narrative. Entirely optional, entirely private, never shown to other players.

---
## Section 14: Monetization

**Implementation Status**

Question bank caps are **actively enforced** server-side via `User.subscription_plan` (enum: `free` / `plus_monthly` / `plus_yearly`). All other Plus features listed below remain a scaffold — architecture ready, not yet enforced.

**Philosophy**

Joshing should never feel like it is nickel-and-diming users. The free tier must be genuinely good. No advertising. No payments in the MVP — architecture designed but not activated.

### Primary Model — Freemium Subscription: Joshing Plus

Recommended price: $4.99 per month or $39.99 per year.

**Question bank caps by tier:**

| Tier | Cap |
|---|---|
| Free | 20 questions |
| Plus monthly | 100 questions |
| Plus yearly | 1,000 questions |

The cap is on the personal bank, not on any individual game. A free user with 20 questions can run a complete game (which draws from a pool of up to 100 questions contributed by the whole group). The cap limits how much a single creator can build up over time, not whether they can play.

**Joshing Plus unlocks:**

- Setup 2 (one curator, then open) and Setup 3 (everyone contributes) — the free tier includes Setup 1 only
- Larger question bank
- Advanced audience tagging — unlimited tags and named presets
- Priority distribution in public game discovery feeds (Phase 2)
- Unlimited public game play (Phase 2)
- Deeper question analytics — richer stats including answer rate over time
- Richer educational explainers
- Enhanced daily summary — trend data, alignment score history
- Custom group themes — cosmetic personalisation

**Core Experience Stays Free Forever**

All Setup 1 game features are free. Daily questions, archive, intellectual alignment scores, educational explainers, 2 daily votes per group, result card, post-game similarity sharing. The share card is never paywalled — it is the primary growth mechanic. Author profiles are free for all players who opt into sharing.

---

## Section 15: Technical Architecture


**Overview**

Joshing is a web application with two surfaces: the thin daily question page (fast, focused, server-side rendered) and the full web interface (rich React application). Both served from the same Next.js codebase. US-only deployment in MVP.

**Frontend**

- Framework: Next.js (React)
- Styling: Tailwind CSS
- Rendering: SSR for the daily question page and author profiles; client-side React for the full web interface

**Session Expiry Implementation**

There is no in-session timer. Players have access to their 5 daily questions for as
long as the round is active — questions are gated by `expires_at` on each assignment.
During an active round, the list and submit APIs permit all unanswered questions from
prior days in that round. After a round ends, the submit API enforces a hard 7-day
post-game cutoff. After that cutoff, submissions are rejected and questions are
archive-only.

**Design Principles and UX Notes — Updated**

Section 16 principle replacing the retired session timer principle:

*"Pacing Is the Daily Window, Not a Timer — There is no session timer. Players have
the full 24-hour daily window to answer their 5 questions, governed by `expires_at`
on each assignment. Urgency comes from the daily reset, not from a countdown clock."*

**Explainer Caching**

Educational explainers are cached per question per result-type (correct / wrong / expired). Cache key: `question_id + result_type`. Generated on first request, served from cache thereafter. At group sizes of 5 or more players, this eliminates redundant LLM calls for nearly identical inputs.

**Shareable Link Expiry**

Share card public pages check `share_card_link_expires_at` before rendering. Expired pages return HTTP 410 Gone with a tombstone message. Tokens remain in DAILY_SESSIONS for data integrity.

**Author Profile Caching**

Author profile pages (`/authors/[slug]`) are server-side rendered and cached. Profile content updates asynchronously after each session via the AUTHOR_QUESTION_STATS update job. Cache TTL: 1 hour. Profiles are publicly accessible without authentication — no session data is included in the cached response.

**Daily Assignment Algorithm**

Run before invitation link generation (for new players) and before noon SMS send (for returning players). For each player in each active group:

1. Exclude questions already assigned to this player in this game.
2. Exclude questions authored by this player (`question.creator_id = user.id`).
3. Apply category variety constraint — no more than 2 questions from the same category in a single session. If the eligible pool cannot satisfy this constraint, relax to 3 and log the exception.
4. Apply author interleaving — no two consecutive questions from the same author where pool permits.
5. For a player's first-ever session: weight selection toward questions predicted to be easier (based on `difficulty_estimate`). The first session should be generous and welcoming, not punishing.
6. Assign positions 1–5. Set `expires_at` to the next noon EST (17:00 UTC) cutoff, computed from `getDailyAssignmentBounds()` in `src/lib/games/timezone.ts`.

Category variety is a quality-of-experience constraint, not a hard rule. The assignment should never fail to assign a session because variety cannot be achieved.

**Similarity Score Calculation**

Run asynchronously when both players in a similarity share have completed the pool. Compares ANSWERS records for the two players across the shared question pool. Excludes expired answers from both sides. Produces `similarity_score` (float) and `category_scores` (jsonb) which are written to the SIMILARITY_SHARES record. Triggers mutual SMS notification.

**Tribe Size Calculation**

Run weekly as a background job for all active public game players. For each player: query USER_INTEREST_PROFILES to find all active public players (10+ sessions in past 90 days) within the similarity threshold. Count and store in `tribe_size`. Calculate percentile rank and store in `tribe_percentile`. Calculate per-category percentiles and store in `category_percentiles`.


---

## Section 16: Design Principles and UX Notes

**The Tagline**

> The trivia you wish you were asked.

Six words that do the full job. They imply that generic trivia is a disappointment. They promise something from the specific intellectual world of this group. They work across all three setups and both public and private game surfaces. The line appears on the public result page, the invitation landing page, and any marketing surface.

**Questions Are Factual and Drawn From Shared Worlds**

Joshing questions are factual — they have objectively correct answers that do not depend on knowing the question writer personally. What makes them Joshing questions is that they are drawn from the intellectual and cultural world this specific group shares. "Who wrote Wozzeck?" is generic trivia to most people. To a group of opera lovers, it is the question they always wished they had been asked.

Getting a question right proves you share a world. Getting a question wrong is a discovery — something from that world you haven't yet explored. Both are valuable. The game reflects this at every point.

Write from memory. If you had to look it up to write the question, you cannot reasonably expect others to know the answer. Questions written from memory reflect what actually lives in a person's head, which is exactly what the game is designed to surface.

**The Question Is a Gift, Not a Test**

Good Joshing questions are things you genuinely think the people playing should know — shared references, things that come up when you're together, the texture of your common world. The goal is not to stump people. The goal is to find out how much of the same world you carry around in your heads.

**Wrong Answers Are Invitations**

Getting something wrong is not a failure — it is an invitation to understand the person who asked and the world they come from. The explainer tells you what you didn't know. The creator note, where it exists, tells you why it mattered enough to ask. The archive holds every missed question — that is a library, not a graveyard.

**The Creator Is a Cultural Curator**

The act of selecting questions for a group is an act of cultural curation — closer to making a playlist than writing a quiz. Good question writers share their world deliberately and generously. They are showing something real about themselves and what they value. The interface should reflect this: the question creation prompt is *"What piece of your world belongs in this game?"* — not "Add a question."

**Language Audit — Performance to Connection**

The product's copy should consistently frame Joshing as a connection game, not a performance game. Key substitutions throughout the interface:

| Avoid | Use instead |
|---|---|
| "Correct" | "Got it" / "Yes" |
| "Wrong" / "Incorrect" | "Not this time" / "Here's the answer" |
| "Your score" | "How you did" |
| "You got X of 5" | "X of 5 today" |
| "Leaderboard" | "Group" (nav label) |
| "Test your knowledge" | "Explore your shared world" |

**The Public Game Is a Different Experience**

The private game is warm, ritual, intimate. The public daily game is discovery-oriented — the pleasure of finding strangers who share your world. The public infinite run (Phase 3) has teeth — two strikes end your run. Each surface uses the same questions and the same grading mechanic. Everything else is calibrated to its emotional purpose.

**The Setups Have No Player-Facing Names**

The three game setups are never labelled by name in the player experience. Players encounter them once, at game creation, through a plain-language question: "Who writes the questions?" Internal code uses `know_me`, `know_me_plus`, and `open`.

**The Invitation Is Personal**

Joshing is invitation-only. The game creator sends invitations from their own phone. The invitation arrives as a message from a friend, not from a product. Every design decision that adds friction between receiving the invitation and seeing the first question is wrong.

**The Wordle Principle**

Every daily interaction mechanic is designed around the Wordle principle: small, finite, time-bounded, satisfying. The constraint is the product. Scarcity creates ritual. Ritual creates habit.


**The Skip Is Agency, Not Escape**

The skip mechanic is a pacing tool, not a safety valve. The question returns. Designing the skip as small italic text inside the question bubble — not a prominent button — ensures it is used thoughtfully rather than reflexively.

**The Reveal Is a Moment — Mostly in the Review**

Seeing who wrote each question — after results are in — is a key emotional beat.
**Setup 2 & 3:** the author’s name stays out of the live thread and lands in the
**End of Session Review** (and add-to-bank where applicable). **Setup 1:** the
curator may appear earlier because the game is explicitly their world. Explainers
and creator notes remain review-time so the thread stays light.

**The Next-Questions Countdown Is the Hook**

Ending the session with a clear, warm signal of when to return is the single most important retention mechanic in the product. The **session close** line uses *"tomorrow at noon"* — specific enough to be anticipated, unhurried enough to avoid urgency. Where domain movement occurred, it also names the territory the player is building in. **Round complete** may add a **one-shot** *Next round opens …* time from **`expires_at`** (§8.38) — still **no** countdown and **no** urgency language. See §8.38.

**The Aesthetic Is Editorial**

The visual language is warm editorial off-white. Near-black ink on warm off-white surfaces — clean, high-contrast, and quietly confident. Reference points: well-designed literary magazines, Alvin Lustig 1960s book design, quiet atelier aesthetics. Nothing retro. Nothing ironic. It should feel like a place where smart questions belong.

Three theme variants exist in the system (`quiet_atelier`, `sunday_margins`, `parlor_index`) — selectable in user settings (Phase C).

Typography: Caveat (script accent) for display headings and brand moments only; Instrument Sans for body text; Literata for question prose; Monospace for UI chrome, labels, timestamps, scores, and system copy. Script accents are never used for body copy or interactive elements.

Cards are white on the off-white background, with a single-pixel rule border and minimal box shadow. The forest green accent appears on active states, correct results, and intellectual alignment scores. Wrong answers use a warm red (`#b83232`). The interface is quiet. The content is loud.

**Accessibility**

WCAG 2.1 AA minimum. Color contrast: 4.5:1 ratio. Color alone must never convey meaning — correct/wrong must be indicated by label, not just green/red. Touch targets: minimum 44x44 points. The answer submit button is the most time-critical tap target — it must be the largest interactive element on the answering screen. Error messages must be specific and actionable — never "Something went wrong."

**Sound Design**

Optional and off by default. Correct answer: brief warm two-note ascending tone.
Wrong answer: single neutral tone, lower register — "not quite" not "wrong."
Daily reset approaching (optional, opt-in only): subtle ambient tone at the
player's chosen reminder time. Star given: small bell-like chime. All sounds
under 500ms, under 20KB, respect iOS silent mode.


**Offline and Poor Connectivity**

If connectivity is lost mid-session: a quiet inline indicator appears, the player
can continue reading questions already loaded, and answers submit automatically
on reconnection. Submitted answers queued client-side, retried up to 3 times
over 30 seconds. The 24-hour expiry window (`expires_at`) continues server-side
regardless of connectivity — players are not penalized for brief disconnections,
but questions expire at noon EST regardless.


**Error State Copy**

- *Grading timeout:* 'Taking a moment to grade this one — hang tight.'
- *Session fails to load:* 'Something went wrong loading your questions. Tap to try again.'
- *OTP not received:* 'Didn't get the code? Codes can take a minute. If it still hasn't arrived, tap to resend.'
- *OTP expired:* 'That code has expired — they're only valid for 10 minutes. Tap to get a new one.'
- *Answer submission failed:* 'We couldn't submit that answer.'
- *Group no longer active:* 'This group has been archived. Your archive is still accessible below.'
- *Invitation link expired:* 'This invitation has expired. Ask [Name] to send you a new one.'

The tone throughout is warm and specific. Never 'An error occurred.' Always: here is what happened, here is what to do next.

---

## Section 17: Out of Scope for MVP

- Public question pool and public daily game (Phase 2)
- Public infinite run (Phase 3)
- Voice input (Phase 2)
- Creator's Summary for Setup 1 hosts (Phase 2) — see §8.5a
- Avatars (Phase 2)
- Email notifications (Phase 2)
- Author following / creator subscriptions (Phase 2)
- International phone numbers
- Native mobile apps (Phase 3)
- Full monetization activation (architecture ready, not activated)
- Analytics dashboard (Phase 3)
- Question scheduling
- Mid-game joining — all players join before the first round
- Open sign-up / public discovery — explicitly out of scope at all phases; invitation-only is a permanent product principle

---

## Section 18: Success Metrics

**Philosophy**

Joshing has two kinds of metrics: business metrics that measure whether the product is growing and retaining users, and product metrics that measure whether the game is actually creating intellectual connection through shared knowledge. Both matter. Neither substitutes for the other.

The most dangerous failure mode is a product that retains users without creating connection — players who show up daily out of habit or competition anxiety but never feel the experience the game promises. The internal north star metric is designed specifically to detect this failure.

**North Star — Business**

- Day 7 retention: above 50%
- Day 30 retention: above 35%
- Game 2 start rate: above 50% of groups completing Game 1 and starting Game 2 within 60 days

**Internal North Star — Product**

**Reaction rate on wrong answers: above 25%**

Of all questions a player got wrong in a session, what percentage generated at least one of: a creator note view, a player reaction, or a **Replay** attempt within 24 hours?

This single metric captures whether wrong answers are functioning as connection events. A high rate means the game is working as designed. A low rate is an early warning that the discovery framing is not landing. Review weekly from the first day of launch.

**Onboarding**

- First session completion rate: above 70% of new players who tap their invitation link complete all 5 first questions within their first 24-hour window
- Time from invitation link tap to first question: under 60 seconds for new players, under 15 seconds for returning
- Setup 3 joining flow completion rate: above 80%
- Invitation acceptance rate: above 60% of invitations sent result in a player completing their first session

**Daily Engagement**

- SMS link open rate: above 70%
- Daily session completion rate: above 60%
- Question expiry rate: below 30%
- Group synchrony rate: above 50% of sessions where at least 3 of 5 group members complete their session within the same 24-hour window

**Session Mechanics**

- Skip usage rate: between 10% and 30% of sessions
- Skip return rate: above 70% of skipped questions subsequently answered

**Connection Metrics**

These measure whether the game is creating genuine connection. Internal metrics — never shown to players as competitive rankings.

- **Reaction rate on wrong answers:** above 25% — internal north star
- **Creator note add rate:** above 20% of questions that receive at least one star have a creator note attached
- **Creator note expand rate on wrong answers:** above 40% of End of Session Review screens where a creator note is auto-surfaced on a wrong answer result in the note being read
- **Creator note expand rate on correct answers:** above 25% of sessions where a creator note link is available result in at least one tap
- **Reaction thread depth:** above 30% of reactions sent receive a creator response within 48 hours
- **Wrong answer Replay rate:** above 15% of wrong answers result in a **Replay** attempt within 7 days
- **"Only you knew this" engagement:** above 50% of sessions where a standout solo-correct moment is surfaced result in the player tapping through to the question detail

**Content and Contribution**

- Game starter seed completion rate: above 80%
- Setup 3 joining contribution completion rate: above 80%
- Setup 2 open round contribution rate: above 30%
- LLM answer suggestion acceptance rate: above 70%
- Public pool opt-in rate: above 20% of questions created have the sharing toggle enabled

**Social and Viral**

- Share card copy or share rate: above 40% within 2 weeks
- Shareable link click-through rate: above 30%
- New player conversion from share link: above 20%
- Invitation send rate: above 40% of active players send at least one invitation per month
- Invitation acceptance rate: above 60%
- Invitation quality rate: Day 30 retention of invitation-acquired players tracked separately — target above 45%
- Invitation chain depth: average hops from founding cohort above 2 by end of Phase 1
- Similarity share send rate: above 15% of game completion screens result in a similarity share being sent

**Game Health**

- Game completion rate: above 50% of groups completing Game 1 and starting Game 2 within 60 days
- Game 3 completion rate: above 30% of groups that completed Game 2 completing Game 3 — the novelty cliff metric
- Archive engagement rate: above 40% of players browsing archive at least once per week
- Alignment score engagement: above 60% of players viewing intellectual alignment at least once per week
- Group identity portrait engagement: above 50% of players who see the game completion screen tap through to read the group identity portrait
- Contribution milestone notification tap rate: above 35%

**Tension Flag**

If alignment score engagement is high but reaction rate on wrong answers is low, players may be using Joshing as a performance game rather than a connection game. This pattern warrants a design review.

**Author and Public Pool Metrics (Phase 2)**

- Author profile tap-through rate: above 25% of question attribution credits in End of Session Review result in a profile tap
- Tribe size engagement rate: above 40% of public daily game players tap through to see their full tribe size and category breakdown
- Public-to-private conversion rate: above 15% of public game players start a private game within 60 days
- "Find your people" invitation send rate: above 20% of public game players send at least one similarity invitation per month

**Technical**

- LLM grading response time (95th percentile): under 2 seconds
- LLM suggestion response time (95th percentile): under 3 seconds
- SMS delivery rate: above 98%
- Educational explainer engagement: above 40% of wrong or expired answers followed by explainer tap
- Page load time (daily session, 4G): under 2 seconds

---

## Section 19: Open Questions and Decisions Needed

**1. Seed Minimum Validation**

The question minimums (5 for game start across all setups, 5 for Setup 3 joining contribution per player) are the right starting values but should be monitored from day one and adjusted server-side if real user behaviour suggests they are too low. All are configurable server-side parameters — no code change needed to adjust them.


**2. Game Starter Transfer Mechanism (Phase 2)**

Any active member can confirm a new game. But formal game starter status — who can add members, who manages group settings — still requires a transfer mechanism for Phase 2 when the original game starter leaves or becomes inactive. Two options: (a) game starter nominates a replacement; (b) majority vote by active members. The Phase 2 design should choose before build.

**3. Voice Input Implementation (Phase 2)**

Voice input arrives in Phase 2 via Web Speech API. Decisions needed: (a) which browsers and platforms to support at launch; (b) whether auto-submit silence threshold is fixed or user-configurable; (c) the chat-thread voice UI pattern — live transcription display within the answer bubble before submission is a novel interaction that needs specific design work before Phase 2 build begins.

**4. Emoji Cross-Platform Validation**

The category emoji set must be validated for consistent rendering on iOS Safari, Android Chrome, WhatsApp, iMessage, and Windows before development begins. Pre-build task, not a PRD decision.

**5. Pool Sharing Consent for Setup 2 and Setup 3 Games**

Section 8.23 specifies that similarity sharing of a community pool requires explicit opt-in from the game starter. Two decisions needed: (a) is the game starter's consent sufficient to share the whole pool, or does each contributor need to consent individually? (b) if individual contributor consent is required, what is the mechanism? Recommendation: game starter consent is sufficient for Setup 2; Setup 3 may warrant individual contributor consent given equal ownership. Decision needed before Section 8.23 is built.

**6. Author Profile Display Name Uniqueness**

Section 8.26 specifies that each author profile has a URL at `joshing.com/authors/[display-name-slug]`. Display names are not currently required to be unique across the platform. Two decisions needed: (a) should display names be made unique for players who opt into the shared question library? (b) if a player changes their display name after their author profile is established, does the old URL redirect? Recommendation: require uniqueness for players who enable author profiles; implement permanent redirects on display name changes. Decision needed before Section 8.26 is built.

**7. Tribe Size Calculation Threshold**

Section 8.25 specifies that tribe size counts only players who have completed at least 10 sessions in the past 90 days. Two calibration decisions needed before build: (a) is 10 sessions the right activity floor, or should it be 5 to produce more meaningful sizes in the early period? (b) should the 90-day window be shortened to 60 days? These are configurable server-side parameters and can be adjusted post-launch. Starting values should be set intentionally. Monitor in the first month of Phase 2.

**8. Academic Advisory Relationship**

Dr. Amie Gordon (Associate Professor, UM Psychology, READ Lab) is the recommended first contact for an academic advisory conversation. Her research on felt understanding, appreciation, and partner similarity in close relationships maps directly onto Joshing's core mechanics — the wrong-answers-as-connection-events design, the similarity discovery feature, and the creator recognition mechanics.

Recommended approach: read her 2023 paper "Feeling understood and appreciated in relationships" before reaching out. Contact through the UM Psychology department page. Frame the outreach as a research conversation about whether the game's design holds up against the empirical literature. Bring a demo.

Secondary contacts: Dr. Shinobu Kitayama (Culture & Cognition Program, UM) for the cultural identity dimension; Dr. David Dunning (UM Psychology) for the metacognitive dimension of wrong answers and knowledge gaps.

Timing: before public beta.

**9. (Resolved) Navigation Label for /leaderboard Route

This item is resolved. As stated in the 'Implementation Updates' and Section 8.16, the canonical primary navigation is finalized as Home → Questions → Knowledge → Account. The route /leaderboard is not a primary navigation item and is accessed via other entry points.

---

**10. *(Resolved or retired — see CHANGELOG)***

This item was removed. If it was resolved, the decision is recorded in
`Docs/CHANGELOG.md`. If it was retired without resolution, the rationale
should be noted there. Do not renumber items 11–15.


**Pending Design Decisions — Phase 2**

The following decisions are required before the relevant Phase 2 features can be built. Each has a corresponding Discussion Prompt in the Implementation Action Plan (April 2026).

**11. Game Ending Ceremony — ✓ Resolved (Section 8.29)**

Full ceremony design is specified in Section 8.29. Build prompt B4a (cinematic rebuild) and B4b (Game Details page) are ready to run.

**12. Personal Mastery Page — Full Design (Discussion Prompt D2)**

The two-axis portrait model is specified in Section 8.27 but the page design is not. Decisions needed: how the two axes render visually without feeling like a dashboard, how hyper-specific categories are displayed and grouped on mobile, what sparse/developing/rich states look like, own view vs friend visitor differences, and how the overlap score appears. Required before build prompt B5.

**13. Catch-up Half-Credit — Display and Eligibility (Discussion Prompt D3)**

The 0.25x weight principle and zero leaderboard credit are confirmed (Section 8.19). Decisions pending: how catch-up vs live is displayed on the portrait, whether there is a catch-up eligibility window beyond the next daily reset. **Catch-up vs live (shipped):** copy + header subtitle + thread intro; shared theme surfaces — see Implementation update #5 and §8.19.

**14. Expert Invitation Surface — Full Design (Discussion Prompt D4)**

The concept is documented in Section 8.28. Decisions needed: whether recipients need a Joshing account, the challenge creation flow, expert analytics surface, end-of-challenge CTA, and how expert invitation relates to the territories concept in Phase 4. Required before build prompt B7. Phase 2 feature — not blocking MVP or early Phase 2 launch.

**15. Multi-Player Seeding Dynamics Setup 3 — Full Design (Discussion Prompt D5)**

The basic seeding flow is specified but multi-contributor dynamics are not. Decisions needed: simultaneous contribution interface, near-duplicate detection, category balance display at hyper-specific level, minimum contribution enforcement, late-joiner handling, and gifted questions in the seeding pool. Required before Setup 3 multi-contributor build.


---
## Section 20: Appendix — Sample Questions

The following 34 questions were created by the founding team. They demonstrate the tone, register, and intellectual range the game is designed for — curious, playful, and a little show-offy. They span music, literature, history, philosophy, language, and pop culture. They will be shown to new game starters during the seeding flow as examples of what great Joshing questions look like, clearly labelled as such.

These questions are the model. They are factual — every one has a single objectively correct answer. They are drawn from specific intellectual and cultural territory — opera, Modernist literature, classical music, philosophy, history — not from generic trivia categories. They are the questions you always wished you had been asked in Trivial Pursuit.

1. Who was the character of Buck Mulligan based on?
2. What was the name of Alexander the Great's horse?
3. Who were Arnold Schoenberg's two most famous pupils?
4. Fill in the blank in this line from Don Giovanni: Don Giovanni a …… teco
5. What fruit does the narrator of The Love Song of J. Alfred Prufrock dare to eat?
6. In what Bach cantata does Jesu Joy of Man's Desiring first appear?
7. Which late 20th-century composer developed the tintinnabuli technique?
8. Which philosopher used the example of a bat's echolocation to argue that subjective experience can never be fully captured by science?
9. According to T.S. Eliot, which is the cruelest month?
10. Where was the first self-sustained nuclear reaction?
11. What is the title of Beethoven's Third Symphony?
12. What is the name of the most famous opera house in Venice?
13. Scarpia is the villain in what Puccini opera?
14. What is the plural of "focus"?
15. Which apostle was chosen to replace Judas Iscariot?
16. What physical anomaly is Anne Boleyn rumored to have had?
17. What is it called when Venice floods?
18. Name the four operas that make up Wagner's Ring Cycle.
19. Which German Jewish philosopher described the "angel of history" being blown backward into the future by the storm of progress?
20. Septimus Warren Smith is a major character in which novel?
21. How many balls appear on the most common version of the Medici coat of arms?
22. Which band has a song featuring the lyric "how did I get to this beautiful house?"
23. What embiggens us all?
24. Clovis, Clotaire, and Chilperic were all kings of which Frankish dynasty?
25. Complete the Shakespeare quote: "A horse, a horse, ……"
26. Which philosopher developed the "veil of ignorance" concept?
27. To which cartoon theme tune can the opening verses of Paradise Lost be sung?
28. Which Gershwin melody is said to be based on the Jewish Aleinu prayer?
29. Name at least two musicians who played on Miles Davis's Kind of Blue.
30. What voice type, combining power and stamina, is required for Wagner's Siegfried?
31. Who has "information, vegetable, animal and mineral"?
32. Which famous piano work by Debussy quotes and mocks a theme from Wagner's Tristan und Isolde?
33. Kitty O'Shea had an affair with what famous Irish statesman?
34. What is the name of the rope that raises or lowers a sail on a sailboat?

---

*End of Document — Joshing PRD Version 10.24 — April 13 2026*

