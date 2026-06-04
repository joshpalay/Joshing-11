# D-3 — House / Editorial Author (SPEC)

> **Spec-only deliverable.** No production code is written by this prompt. This document is the
> spec + confirmed decisions that unblock the eventual build. The implementation is a separate,
> future piece of work. Inherits the **D-1** follow/Daily model and the **D-2** niche-match
> discovery rules; slots into the **B-2** send-provenance model (shipped — see Verified facts).

---

## Context — why this change

Capability 23: a clearly-labeled **house / editorial author** seeds questions into niches to ease
content scarcity at small scale — an honest curator voice, never a simulated friend.

The settled principle (the same line the synthetic-player idea was rejected on):

> A **labeled non-human author that fills content is fine**. A **non-human pretending to be a peer
> who connects with you is forbidden** — it would make players unable to trust that any connection
> is real.

So the house author is content infrastructure, not a social actor. It refills the well when a niche
is too small for friend- or LLM-sourced content to carry the ritual, and it is visibly marked as
non-human everywhere it appears. It must never be followable, never a niche-match discovery target,
never accrue mastery, and never render with the peer ("A friend") treatment.

This spec resolves the six open questions against the **current, post-D-1 / post-D-2, B-2-shipped**
codebase and drafts a sequenced build "Done When." No production code.

---

## Verified facts (corrections to the gap analysis in **bold**)

| # | Claim (from the task / earlier audit) | Status | Evidence |
|---|----------------------------------------|--------|----------|
| 1 | B-2 (send-provenance) must ship first; house is a third origin | **ALREADY SHIPPED** | `src/app/api/questions/send/route.ts:163-172` materializes a forwarded `GeneratedQuestion` with `creatorId: null` + `source: 'curated_sent'` so credit never accrues to the forwarder. The provenance model is **live**, not pending — this spec's provenance section is **not** provisional. |
| 2 | `creatorId` null → renders as the literal string `"the author"` (`get-feed-page.ts:249`) | **FALSE — it renders as `"A friend"`** | The fallback is `displayName(user, fallback = 'A friend')` at `src/server/feed/get-feed-page.ts:83`. The `:249` reference is an unrelated comment in `src/server/db/queries/feed.ts:248-250` about "the author's followers." **This is load-bearing: the current null-author fallback is peer impersonation — exactly what the house principle forbids — so any house model MUST override it.** `'A friend'` is the fallback in at least 6 render paths (`get-feed-page.ts:83`, `lately.ts:110`, `bank.ts:23/28`, `feed.ts:83/92/96`, `activity.ts:119`, `archive.ts:95`, `daily-summary.ts:336`). |
| 3 | `Question.source` is an enum that must grow a new value | TRUE — **but it is `text()`, not a pgEnum** | `source: text('source').$type<'authored' \| 'daily_generated' \| 'curated_sent'>().notNull().default('authored')` (`schema.ts:254`). Adding `'house_authored'` is a **TypeScript-type widening + guard change — no DB enum migration** (same property D-2 used for `ActivityItem.type`). |
| 4 | `creatorId` is nullable and references `users.id` | TRUE | `creatorId: text('creator_id').references(() => users.id)` (`schema.ts:252`), nullable. Indices at `:302-304`. `source_question_id` / `source_creator_id` provenance columns at `:255-256`. |
| 5 | The User table can flag an author type | **FALSE today — no such flag exists** | `users` (`schema.ts:165-218`) has no `isBot` / `isSystem` / `type` / `role`. Adding a flagged-User identity would require a new column **and** explicit exclusion guards at every peer surface. (We chose the first-class type instead — see Decision 1.) |
| 6 | Null-`creatorId` (LLM-origin) questions are always feed-eligible on correct answer | TRUE | `isLlmOriginQuestion(source)` returns true for `daily_generated` / `curated_sent` (`src/server/feed/visibility.ts:50-52`); `isCorrectAnswerFeedEligible` short-circuits true for them (`visibility.ts:60`). House (`source='house_authored'`) must be added to this predicate **deliberately** (it is not LLM-origin, but it is non-human-authored). |
| 7 | The authored Daily picker would surface house questions | **FALSE — it filters them out** | `pickEligibleAuthoredQuestions` requires `isNotNull(canonicalQuestions.creatorId)` (`src/server/db/queries/daily.ts:819`). House questions (null `creatorId`) are **never** selected by the friend/authored picker — house needs its own placement path (see spec §C). |
| 8 | The Daily queue slot has no room for a non-friend, non-bot author | **PARTIALLY — a `'community'` source already exists** | `queueSlotSourceSchema = z.enum(['friend', 'bot', 'community'])` (`src/server/daily/types.ts:16`). `author_*` fields are only populated for `source='friend'` (`types.ts:22-31`). The unused-in-practice `'community'` value is the natural carrier for house slots (or add `'house'`); either way `author_*` rendering must be wired for it. `DAILY_QUEUE_SIZE = 5` (`types.ts:93`), `DAILY_BONUS_SLOT_MAX = 2` (`types.ts:102`). |
| 9 | D-2 niche-match could fire for house questions | **FALSE — excluded by construction** | `notifyNicheMatch(userId, questionId, question.creatorId, …)` is called with `question.creatorId` (`src/server/feed/create-feed-items-for-answer.ts:95`); the function (`:222`) requires a real, non-self `creatorId` and a stranger relationship before writing `niche_match_answered_your_question` / `niche_match_you_answered` (`:258`, `:271`). House questions carry `creatorId=null`, so the loop **cannot fire** for them. The spec records this as an invariant to preserve, not new work. |
| 10 | Author credit (mastery) is gated on a non-null creator | TRUE | `awardAuthorCredit` requires `creatorUserId` non-null (`src/server/mastery/author-credit.ts`); notification skipped when `creatorId` is null (`create-feed-items-for-answer.ts:225-242`). House (null `creatorId`) is **already** mastery-ineligible by construction — no new suppression code needed. |

---

## Decision ledger (all confirmed by product)

| Q | Decision | Notes |
|---|----------|-------|
| **1. Identity model** | **First-class non-human house author type.** `creatorId` stays **NULL**; add `source='house_authored'`; resolve a single fixed house identity (name + label + optional avatar) **at render**, from a constant — not a `users` row. | Chosen over the flagged-User-row option **because the dangerous failure mode is loud and centralized**: with no `users.id`, house is unfollowable / unmatchable / mastery-ineligible **by construction** (Verified facts #9, #10), and the *only* thing that can leak is the render fallback (`'A friend'`), which would be visibly wrong on **every** house question and caught immediately. A flagged User row spreads the same risk across follow, niche-match, mastery, and contact-discovery, where missing one guard *silently* lets house impersonate a peer. |
| **2. Labeling** | **Display name `Joshing` (house voice) + a persistent non-human `Editorial` badge/pill** at every author-attribution surface. Never the person / `'A friend'` treatment. | Renders at: feed author line, Daily slot attribution, commentary/creator-note prefix, the B-2 "wrote you this" marker, and any profile/peek surface. The badge is **mandatory wherever the name appears** — the name alone is not sufficient distinction. |
| **3. Reach & niche-matching** | **The bank + the Daily Five core only.** House questions seed the bank and flow into the Daily core via the existing **domain/difficulty** matching. **NOT** the Feed (D-1: the Feed is deliberate human intent only). **NOT** the Daily +2 bonus (that is an answerer-attributed friend portal; house has no answerer). | Niche-matching **reuses the bank/generation domain+difficulty path** (`pickBankSource`, `pickBankPicksForDomains`), **not** the D-1 +2 relevance ranking (which ranks *friend-answered* items). Surfaced via a dedicated house placement path, since the authored picker filters house out (Verified facts #7). |
| **4. Provenance + mastery** | **`source='house_authored'` is the third non-human origin** alongside `daily_generated` / `curated_sent`, distinguished from them because it is **curated/editorial, not LLM-batch**. **House authorship accrues NO mastery** — no author-credit, no leaderboard, no "written by me." | The `source` column is free `text()` (Verified facts #3) → no enum migration. Mastery is already gated on non-null `creatorId` (Verified facts #10) → no new suppression needed, but the spec states it as an invariant. |
| **5. Commentary** | **Allowed, in house voice.** House may attach a creator-note/aside, rendered with the `Joshing` label + `Editorial` badge in an **editorial/curator tone**. **Relational framing is forbidden** ("between us friends", "I picked this just for you") — relational copy on non-relational content is the known concern from the cheeky-aside investigation. | Keeps house questions from feeling sterile while preserving the "not a peer" line. Copy guidance is part of the build (lint/review checklist item, not a runtime gate). |
| **6. Discovery exclusion** | **Excluded entirely.** House can never be a niche-match discovery target (D-2) nor a followable peer. | Holds by construction under Decision 1 (no `users.id` to follow or match — Verified facts #9). The spec records it as an **invariant** with a regression test, so a future refactor toward a User row can't silently break it. |

---

## The spec

### A. Identity model — first-class `house_authored` origin (no User row)

- Widen `Question.source` to `'authored' | 'daily_generated' | 'curated_sent' | 'house_authored'`
  (`schema.ts:254`). **No DB migration** — `source` is `text()`. Update the `$type<>` union and every
  exhaustive switch / guard over it.
- House questions are persisted with **`creatorId = null`** and **`source = 'house_authored'`**
  (mirroring the `persist-generated-question.ts:130-132` shape for `daily_generated`, but with the
  house source).
- Define a single **house identity constant** in one module (e.g. `src/server/authors/house.ts`):
  `{ id: 'house', displayName: 'Joshing', label: 'Editorial', kind: 'house' }`. The `id` is a
  sentinel string, **not** a `users.id`, and is never used as a foreign key.
- A render-layer resolver maps a question/slot/feed-item to a display author. Today the resolver is
  implicit in the `'A friend'` fallback. The new rule:
  - `creatorId` set → hydrate the `users` row (human author, unchanged).
  - `creatorId` null **AND** `source='house_authored'` → resolve the **house identity constant**
    (`Joshing` + `Editorial` badge).
  - `creatorId` null **AND** LLM-origin (`daily_generated`/`curated_sent`) → existing behavior
    (these are not human and not house — they are not attributed to a named author; keep current
    treatment, which must **not** be the house badge).

> **Invariant H-1:** No code path may resolve a house question to the `'A friend'` fallback or to a
> `users` row. House identity is resolved only from the constant.

### B. Labeling — `Joshing` + `Editorial` badge, everywhere

The house author is rendered with the fixed name **`Joshing`** and a **persistent non-human
`Editorial` badge/pill** at **every** surface where authorship is shown:

- Feed author line (`get-feed-page.ts` author hydration / `feedCardType` author fields).
- Daily Five slot attribution (`QueueSlot.author_name` / the card that renders it).
- Commentary / creator-note prefix (the note components in `src/components/feed/*`,
  `AnsweredByYouCard.tsx`, `AnswerFeedbackSheet.tsx`).
- The B-2 "wrote you this" / sent marker, where applicable.
- Any profile-peek surface the question links to (see §F — it does **not** link to a follow/profile
  affordance).

> **Invariant H-2:** Wherever the `Joshing` name renders, the `Editorial` badge renders with it. The
> name alone is never shown as if it were a person's display name.

### C. Reach & niche-matching — bank + Daily core, domain-matched

- **Bank:** house questions seed the same pool the Daily generator draws from. Implementation choice
  to settle in the build: either (a) house questions are canonical `Question` rows with
  `source='house_authored'` selected by a **new house picker** alongside the bank pick, or (b) they
  are seeded as bank/`GeneratedQuestion`-equivalent rows tagged house. Either way they are
  **domain/difficulty matched** via the existing `pickBankSource` (`daily.ts:1287`) /
  `pickBankPicksForDomains` (`generate-questions.ts:1246`) selection — **not** the +2 relevance
  ranking.
- **Daily Five core:** house questions are eligible for the **5 core slots**. They are carried by the
  Daily queue's existing **`'community'`** source (`daily/types.ts:16`) — or a new `'house'` value —
  with `author_name='Joshing'` and the `Editorial` badge surfaced through the slot's `author_*`
  fields (currently only populated for `source='friend'`; the build wires them for the house source).
- **Explicitly NOT:**
  - **The Feed** — D-1 reserves the Feed for deliberate human intent (broadcasts + sent-to-me).
    House content does not enter it.
  - **The Daily +2 bonus** — those slots are the answerer-attributed friend portal
    (`DAILY_BONUS_SLOT_MAX`, `pickBonusAnswererSlots`); house has no answerer and must never occupy
    them.
- **Feed-eligibility predicate:** decide and document house's status in
  `isLlmOriginQuestion` / `isCorrectAnswerFeedEligible` (`visibility.ts:50-60`). House is **not**
  LLM-origin; since house content does not enter the Feed (above), the default is to **not** add
  `house_authored` to `isLlmOriginQuestion`, and to confirm no correct-answer feed event is emitted
  for house questions. State the chosen branch explicitly in the build.

### D. B-2 provenance interaction + mastery

- `house_authored` is the **third non-human origin**, queryably distinct from `daily_generated`
  (LLM batch) and `curated_sent` (forwarded LLM). It slots into B-2's existing model with no parallel
  mechanism: the `(source, creatorId)` pair remains the single provenance discriminator.
- **No mastery accrual.** House authorship produces no `author_credit`, no `authored`, no
  `curator_credit` mastery events; it never appears in "written by me" (`archive.ts:340-389`) or the
  knowledge "recently expanding" domain signal (`knowledge.ts:291-296`). This holds by construction
  (mastery is gated on non-null `creatorId` — Verified facts #10); the build adds a **regression
  test** asserting a correctly-answered house question awards zero author/curator credit.

### E. Commentary — allowed, house voice, non-relational

- House may attach a creator-note/aside, stored the same way human creator-notes are and rendered
  with the `Joshing` + `Editorial` treatment from §B (so the note is unmistakably editorial).
- **Copy constraint (forbidden):** relational framing — "between us friends", "just for you", "our
  little secret", or any phrasing that implies a peer relationship. Allowed: editorial/curator asides
  ("A favorite from the archives", "One the whole table usually trips on").
- This is a **content/review guideline** enforced in authoring + the build's review checklist, not a
  runtime validation gate.

### F. Discovery exclusion — never a peer

- House is **never** a niche-match discovery target: `notifyNicheMatch` cannot fire for house
  questions because they carry `creatorId=null` (Verified facts #9). The build adds a **regression
  test** asserting a correct answer to a house question writes **no** `niche_match_*` activity.
- House is **never followable**: there is no `users.id` for the house identity, so no
  `AddFriendButton` / follow affordance can target it. Any surface that links a house author's name
  must **not** render a follow CTA or route to a peer profile that exposes one.

> **Invariant H-3:** A house question can never produce a niche-match activity row, a follow edge, or
> a peer-profile follow affordance. (Held by construction; guarded by tests so a future move to a
> User row cannot silently break it.)

---

## Build order — staged, B-2 already satisfied

B-2 is shipped, so no prerequisite blocks this. Suggested safe sequencing for the eventual build:

1. **Origin + identity primitive.** Widen the `source` union to add `house_authored`; add the house
   identity constant + render resolver; update all exhaustive `source` switches/guards. (No DB
   migration.)
2. **Labeling everywhere.** Wire the resolver into every author-attribution surface (feed, Daily
   slot, commentary, sent marker); enforce Invariants H-1 / H-2. Add render tests proving house never
   falls back to `'A friend'` and always carries the `Editorial` badge.
3. **Reach — bank + Daily core.** Add the house placement path (bank seed + house Daily source via
   `'community'`/`'house'`), domain/difficulty matched; populate `author_*` for the house slot.
   Confirm house never enters the Feed or the +2 bonus.
4. **Provenance + mastery invariants.** Confirm `(source, creatorId)` provenance is coherent; add the
   zero-mastery regression test.
5. **Commentary.** Allow house creator-notes; render in house voice; add the copy-guidance checklist
   item.
6. **Discovery-exclusion guardrails.** Add the regression tests for Invariants H-3 (no niche-match,
   no follow affordance) before shipping.

---

## Done-When checklist for the eventual build (staged)

**Stage 1 — Origin + identity**
- [ ] `Question.source` union includes `'house_authored'`; every exhaustive switch/guard over
      `source` handles it; no enum migration introduced.
- [ ] A single house identity constant exists (`{ id:'house', displayName:'Joshing',
      label:'Editorial', kind:'house' }`) and is the **only** source of house identity.
- [ ] Render resolver maps `(creatorId=null, source='house_authored')` → house constant; **never**
      to a `users` row or the `'A friend'` fallback (Invariant H-1).

**Stage 2 — Labeling**
- [ ] `Joshing` + `Editorial` badge renders on the feed author line, Daily slot, commentary prefix,
      and sent/"wrote you this" marker.
- [ ] Test: no house question renders `'A friend'` at any surface.
- [ ] Test: the `Editorial` badge is present wherever the `Joshing` name renders (Invariant H-2).

**Stage 3 — Reach**
- [ ] House questions can occupy Daily Five **core** slots via the house Daily source, with
      `author_name='Joshing'` + badge.
- [ ] House questions are matched to niches by the existing **domain/difficulty** bank path, not the
      +2 relevance ranking.
- [ ] Test: house questions never enter the **Feed** and never occupy a **+2 bonus** slot.
- [ ] Documented decision on `house_authored` in `isLlmOriginQuestion`/`isCorrectAnswerFeedEligible`,
      with a test for the chosen branch.

**Stage 4 — Provenance + mastery**
- [ ] `(source='house_authored', creatorId=null)` is coherent across all provenance reads.
- [ ] Test: a correctly-answered house question awards **zero** author/curator mastery and writes no
      "written by me" / knowledge-domain signal.

**Stage 5 — Commentary**
- [ ] House creator-notes render in house voice with the `Editorial` treatment.
- [ ] Review checklist forbids relational framing on house commentary.

**Stage 6 — Discovery exclusion**
- [ ] Test: a correct answer to a house question writes **no** `niche_match_*` activity (Invariant
      H-3).
- [ ] No follow CTA / peer-profile affordance is reachable from a house author's name.

---

## Verification (for the eventual build)

- Unit/integration tests per the Done-When invariants (H-1 render, H-2 badge, H-3 no-niche-match,
  zero-mastery).
- A manual pass: seed a house question into a sparse niche, confirm it appears in the Daily core
  labeled `Joshing` + `Editorial`, confirm it is absent from the Feed and the +2 bonus, confirm the
  author name has no follow affordance, and confirm answering it correctly produces no mastery and no
  discovery notification.
- `npm run lint`, `npx tsc -p tsconfig.typecheck.json`, and `/check-middleware` before commit.

---

## Explicitly out of scope (this prompt)

- Any production code — this is spec-only. `git status` should show only this new file.
- Authoring **tooling/UI** for house editors to write questions (the back-office surface) — separate
  work; this spec covers how house content behaves once it exists.
- House content **strategy** (which niches, how many, cadence) — a content decision, not a system
  decision.
- Migrating the LLM-origin (`daily_generated`/`curated_sent`) `'A friend'` fallback for non-house
  cases — out of scope except to confirm house does not share it.
- Revisiting the rejected synthetic-player idea — the house author is deliberately the labeled,
  non-relational alternative to it.

---

## Critical files referenced (not edited)

| File | Why it matters |
|------|----------------|
| `src/server/db/schema.ts:252,254-256` | `creatorId` (nullable, → `users.id`), `source` `text()` union, `sourceQuestionId`/`sourceCreatorId` provenance columns. |
| `src/app/api/questions/send/route.ts:163-172` | B-2 provenance pattern (`creatorId:null`, `source:'curated_sent'`) the house origin mirrors. |
| `src/server/feed/get-feed-page.ts:83` | The `'A friend'` author fallback house must override (Invariant H-1). |
| `src/server/feed/visibility.ts:50-60` | `isLlmOriginQuestion` / `isCorrectAnswerFeedEligible` — where house's feed-eligibility branch is decided. |
| `src/server/feed/create-feed-items-for-answer.ts:95,222-281,225-242` | `notifyNicheMatch` call/impl (D-2) and the null-creator notification skip — house exclusion holds here by construction. |
| `src/server/mastery/author-credit.ts` | Author-credit gate on non-null `creatorId` — house mastery-ineligibility holds here. |
| `src/server/db/queries/daily.ts:736,819,1287` | `pickEligibleAuthoredQuestions` (filters out null `creatorId`), `pickBankSource` (bank/niche matching). |
| `src/server/daily/generate-questions.ts:1246,1266` | `pickBankPicksForDomains` / `pickBankSource` — the domain/difficulty matching house reuses. |
| `src/server/daily/types.ts:16,21-31,93,102` | `QueueSlot` source enum (incl. `'community'`), `author_*` fields, `DAILY_QUEUE_SIZE`, `DAILY_BONUS_SLOT_MAX`. |
| `src/server/questions/persist-generated-question.ts:130-132` | The `creatorId:null` + `source` persist shape house mirrors. |
| `src/server/db/queries/archive.ts:340-389`, `knowledge.ts:291-296` | "Written by me" / knowledge-domain signals house must stay out of. |
| `PRD-D-1-FEED-DAILY-RESTRUCTURE-SPEC.md` | Follow model, Feed = human-intent-only, Daily +2 mechanics inherited here. |
| `PRD-D-2-NICHE-MATCH-DISCOVERY-SPEC.md` | Niche-match discovery rules house is excluded from. |
