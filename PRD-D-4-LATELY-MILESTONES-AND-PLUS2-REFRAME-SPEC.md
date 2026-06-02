# D-4 — Lately Milestones + the +2 Reframe (SPEC)

> **Spec-only deliverable.** No production code is written by this prompt. This document is the
> spec + confirmed decisions that unblock the eventual build. The implementation is a separate,
> future piece of work. It **amends `PRD-D-1`** (the +2 and presence decisions) and **changes a
> conformance-audited surface** (the +2, blessed in `audits/2026-06-02-restructure-conformance-audit.md`)
> — a re-audit is warranted after build.

---

## Context — why this change

Two coupled changes, sorted by one principle: **literal questions belong where the person is the
point (Lately); fresh questions belong where _you_ are the point (the Daily Five).**

1. **Lately milestone surface (new).** When a friend answers questions correctly in a domain, surface a
   single _aggregated_ milestone in Lately/`/activities` — e.g. "Robyn showed her skills in 90s
   musicals" (soft framing, **not** "mastery"). Clicking it lets the player play **the same questions
   the friend answered** (literal). This becomes the home for playing a friend's literal questions.

2. **The +2 reframe.** Today the Daily Five +2 serves friends' **literal** `friend_answered` questions.
   Change it so the +2 instead serves **fresh questions generated in the _domains_ friends are recently
   exploring** — drawn from the **presence signal**, not from the literal friend-answered items. Friends
   shape your _territory_; the ritual generates _your_ questions in it. Literal friend questions move
   entirely to Lately (change 1).

### Why (the rationale of record)

The current +2 puts another person's _artifact_ — a question generated for the friend's profile — into
the player's personal ritual. It works, but it is slightly off-key: the daily ritual should be the
player's own. Sorting on "literal vs. fresh" fixes it. Lately is _about other people_ (a friend's
literal question belongs there; its being theirs is the feature); the Daily Five is _about you_ (it
should contain fresh questions in friend-widened territory, never someone else's artifact). This is a
truer expression of "shaped by the friends you let in" — friends shape your _domains_ (influence), not
your literal questions (inheritance). It also honors the player's stated instinct that friends'
questions felt wrong pushed prominently into the daily ritual, but good to _opt into_ via Lately.

---

## Verified facts (read directly from current code)

| # | Claim | Status | Evidence |
|---|-------|--------|----------|
| 1 | The +2 currently serves **literal** `friend_answered` items | TRUE | `pickBonusAnswererSlots` (`daily.ts:1316-1398`) queries `feedItems` where `recipientUserId=me`, `sourceType='friend_answered'` (`SOCIAL_FEED_SOURCE_TYPE`), `sourceResult='correct'`, `sourceUserId ∈ following`, joins the canonical question. Orchestrated at `queue-orchestrator.ts:276-296`, persisted via `createDailyQueueItemFromAnswerer` (`daily.ts:1404-1457`). |
| 2 | The +2 accessibility filter reads **calibrated/llm** difficulty | TRUE | `selectBonusAnswererPicks` (`daily.ts:1222-1294`): `isAccessible = calibratedDifficulty==='accessible' \|\| (calibratedDifficulty==null && llmDifficulty==='accessible')` (`1259-1262`). |
| 3 | The +2 ranks by my knowledge base (subcat → broadCat → any) | TRUE | tier function `daily.ts:1234-1247` over `getKnowledgeBase` (`daily.ts:211-258`); top `DAILY_BONUS_SLOT_MAX`. |
| 4 | Queue is 5 core + 0–2 bonus; bonus shortfall shrinks, never backfills | TRUE | `DAILY_QUEUE_SIZE=5`, `DAILY_BONUS_SLOT_MAX=2` (`types.ts:100,109`); orchestrator appends only what qualifies (`queue-orchestrator.ts:276-296`); distinct from the N<5 generation backstop (`queue-orchestrator.ts:211-237`). |
| 5 | `QueueSlot` already carries answerer attribution | TRUE | `answerer_id`/`answerer_name` (`types.ts:44-46`); `source` enum `['friend','bot','community','house']` (`types.ts:21`); a bonus slot keeps `source='friend'` and `author_*` describes the question's author (`types.ts:37-46`). |
| 6 | The presence signal exists, but is **per-single-friend** and subcategory-only | TRUE | `selectRecentlyExploring` (`recently-exploring.ts:33-61`) returns `RecentlyExploringDomain[] = {displayName, domain, lastActivityAt}` — the subcategory slug only, **no `broadCategory`**, default window 30d / limit 5. Only call site is `users/[id]/page.tsx:176` (one friend). **No cross-follow aggregate exists.** |
| 7 | Presence recency derives from `masteryEvents` | TRUE | `lastActivityAt` = max `masteryEvents.createdAt` per domain via `getKnowledgePageData` (`knowledge.ts:~435-460`), surfaced as `DomainMastery.lastActivityAt`. |
| 8 | Fresh generation can target specific domains, but only has `difficultyEstimate` | TRUE | `generateDailyQuestions(domains[], count, userId, …)` (`generate-questions.ts:798-810`); bank-first via `pickBankPicksForDomains` then Sonnet (`generate-questions.ts:1145-1238`, `pickBankSource` `daily.ts:1534-1579`). Generated rows persist `difficultyEstimate` only (`generate-questions.ts:1044`); **never `calibratedDifficulty`/`llmDifficulty`** (those are canonical-question fields). `difficultyPreference='normal'` → adaptive level <1.5 → `estimate='accessible'` (`adaptive-difficulty.ts:122-150`). Model `claude-sonnet-4-6` (`llm.ts:60`). |
| 9 | `friend_answered` feed items are still written | TRUE | `create-feed-items-for-answer.ts` writes on correct answers, fanned out to the answerer's followers; fields `recipientUserId`, `questionId`, `sourceType='friend_answered'`, `sourceUserId` (answerer), `sourceResult`, `sourceEventAt`, `sourceAnswerId`. These remain the source for the Lately milestone. |
| 10 | "A friend answered _your_ question (correct)" **does** surface in Lately | TRUE (nuance) | The `friend_answered_your_question` _activity_ is deduped when `result==='correct'` (`filter-utility-activities.ts:31-34`) **only because the same event is carried by the `they_got_you` _moment_** from `getLatelyMoments` (`lately.ts`) — see the comment at `filter-utility-activities.ts:4-7`. So it is **deduped, not lost**. `friend_answered_your_question` is in `HOME_TOP3_ELIGIBLE_TYPES` (`write-activity.ts:52-59`); niche-match types are deliberately excluded from top-3. |

---

## Decision ledger (all confirmed by product)

| Q | Decision | Notes |
|---|----------|-------|
| **1. Milestone threshold** | **Any single correct answer** ("let's try this and see if it's enough"). | Implement as a `MILESTONE_MIN_CORRECT = 1` constant so raising the floor later is a one-line change. **Aggregation is retained**: one milestone **per friend, per domain, per window** — five corrects in 90s musicals = one event, not five. **⚠️ Amended by A-1 below — milestones now come in two forms (deep + breadth); see the Amendments section.** |
| **2. Presence → +2 domain pick** | ~~Pure recency~~ → **Territory ∪ activity** (see A-2). | **⚠️ Amended by A-2 below.** The +2 pool now sources a domain if it is part of a followed friend's durable **territory** (declared + demonstrated knowledge base) **or** something they've been **recently active in** — not recency alone. Ranking confirmed in the Amendments section. |
| **2a. +2 source** | **Generation call, not a feed-item lookup.** | The +2 becomes a fresh-generation call in the chosen domains via the existing path (bank-first, then Sonnet). |
| **2b. "Accessible" handling** | **Generation _target_, not a post-hoc filter.** | Generate at `difficultyEstimate='accessible'` (`difficultyPreference='normal'`). The old calibrated/llm accessibility _filter_ (`daily.ts:1259-1262`) is retired with the literal path. |
| **3. De-dup / repetition** | **Rely on normal non-repetition.** | No special cross-Lately guard. Existing `factKey` dedup + recent-history avoidance cover it, and the +2 no longer serves literals (no literal collision possible). |
| **4. Lately ranking** | **Answered-you > niche-match > skill milestone > other** (my recommendation, confirmed). | The `they_got_you` "answered your question" moment stays most prominent and is **confirmed to surface** (deduped only because the moment represents it — `filter-utility-activities.ts:4-7`); lock with a regression test. New milestone slots **below** niche-match so the slow-burn discovery delight isn't buried. |

---

## Amendments (post-review, 2026-06-02) — dual-form milestones + dual-source +2

> Two decisions the user changed after reading the first draft. Each introduces **exactly one** new
> piece of logic the spec must resolve. Both new open questions are **resolved and confirmed by the
> user** (recorded below). These amendments are **authoritative** where they touch §A (milestones) and
> §B (the +2); read them together with those sections. Everything else in the original spec carries over
> unchanged (see "What carries over unchanged" at the end of this section).

### A-1 — Milestones come in BOTH forms (deep + breadth)

Lately surfaces **two kinds** of friend-skill milestone, both clicking through to the friend's
**literal** questions:

- **Per-domain "deep"** — a friend concentrated on one domain: *"Robyn went deep on 90s musicals."*
- **Per-friend "breadth" roll-up** — a friend ranged across several lighter domains: *"Robyn's killing
  it — 90s musicals, Sondheim, and 2 more."* The breadth card's click-through lets the player **pick
  which domain** to play.

**The one new piece of logic — the split rule (CONFIRMED).** The two forms must never double-count the
same answers. Resolved:

- **Constants (both tunable):** `MILESTONE_MIN_CORRECT = 1` (a domain counts at all), `MILESTONE_DEEP_MIN = 3`
  (a domain is "deep").
- A domain whose **correct-count in the window ≥ `MILESTONE_DEEP_MIN` (3)** gets its **own "deep" card**
  and is **excluded** from that friend's breadth roll-up — so its answers appear in exactly one place.
- Remaining **light** domains (correct-count ≥ `MILESTONE_MIN_CORRECT` and `< MILESTONE_DEEP_MIN`, i.e.
  1–2) aggregate into the **per-friend breadth card**, which renders **only when ≥ 2 light domains**
  qualify.
- **Edge cases (confirmed):**
  - Exactly **one** light domain, no deep → a single **plain per-domain card** (uses the soft "showed
    skills in X" copy, **not** "went deep"; "deep" copy is reserved for ≥3).
  - **One deep + one light** → **deep card only** (one leftover light domain isn't enough for a breadth
    card, which needs ≥2).
  - Several light, none deep → **breadth card only**.
  - Multiple deep domains for one friend → multiple deep cards (each its own), plus a breadth card if ≥2
    light domains also remain.
- **Aggregation key is unchanged** otherwise: per friend, per domain, per window, derived at read time
  from `friend_answered` items (no new write path, no migration).

> This split rule is the single piece of logic "both forms" requires. Everything else about the
> milestone (source, soft copy, literal click-through, people-I-follow scope) is exactly as in §A.

### A-2 — The +2 sources from BOTH territory and activity

The original §B sourced +2 domains from **recent activity only** (presence / `masteryEvents` recency).
**Change:** a followed friend surfaces a domain into the player's +2 pool if it is **either**:

- part of their durable **territory** — their knowledge map, i.e. **declared + demonstrated** domains
  (*what they know*), **or**
- something they've been **recently active in** (*what they're doing now*).

**Attribution stays gentle:** *"from {Name}'s world"* / *"from a domain {Name} knows"* — copy that
honestly covers a durable-territory domain *and* a recently-active one without overclaiming "exploring."
This is more thesis-aligned ("shaped by the friends you let in" = shaped by *who they are*, which the map
represents) while still catching current interest.

**The one new piece of logic — the ranking rule (CONFIRMED).** With both signals feeding the pool across
possibly many followed friends, and only **2 bonus slots**, rank thus:

1. **Both** — a domain that is **both** the friend's territory **and** recently active (most truly "this
   friend, right now"). Highest.
2. **Territory-only.**
3. **Activity-only.**
- **"Territory"** = the friend's **full knowledge base** (declared + demonstrated) — exactly what
  `getKnowledgeBase(friendId)` returns (`daily.ts:211-258`), which already carries each domain's
  `source`, mastery `tier`, and `totalPoints`.
- **Tie-breaking within a tier** (and across multiple followed friends): **most-recent activity first**,
  then **territory strength** (mastery `tier` / `totalPoints`). **Strength is a tie-breaker, not a
  gate** — a low-strength domain still qualifies; it just sorts later.
- Take the **top 2** across all followed friends.

> This ranking rule is the single piece of logic "both sources" requires. The rest of the +2 (fresh
> generation, accessible target, presence/territory attribution, graceful shrink, de-dup) is exactly as
> in §B.

### What carries over unchanged from the original D-4 spec

- Literal friend questions live **only** behind the Lately milestone click-through; the +2 serves
  **fresh generated** questions (bank-first → Sonnet, `difficultyEstimate='accessible'`).
- The +2's literal-answerer attribution is **retired** in favor of **presence/territory attribution**
  ("from {Name}'s world").
- **Graceful shrink:** 0–2 bonus by availability; **never pad with the player's own domains**;
  generation failure shrinks the slot, not the core; not routed through the N<5 backstop. (Note: with
  territory now in the pool, "no availability" is rarer — but a player who follows no one, or whose
  followees have empty maps and no activity, still cleanly yields 0 bonus.)
- **Lately ranking:** answered-your-question (`they_got_you`) > niche-match > skill milestones > other;
  lock the "answered your question surfaces" guarantee with a regression test. **Both** milestone forms
  (deep + breadth) sit in the "skill milestones" tier.
- **No new write path / migration** for milestones (read-derived from `friend_answered` items, like
  moments).
- **Reuse, don't duplicate:** the cross-follow aggregate now reads **both** the masteryEvents-recency
  computation **and** each followee's knowledge-base territory (`getKnowledgeBase`), merged per
  (friend, domain) with flags for territory / activity, a recency timestamp, and strength — rather than
  standing up a second signal.

### Re-audit warning (reaffirmed)

These amendments deepen the change to the **+2**, a **conformance-audited surface**
(`audits/2026-06-02-restructure-conformance-audit.md`, blessed against `PRD-D-1`). A re-audit against
those decisions is warranted **after build**.

---

## The spec

### A. Lately milestone — "Robyn showed her skills in X" (new, additive)

> **⚠️ Amended by A-1 (Amendments section).** Milestones now come in **two forms** — per-domain "deep"
> and per-friend "breadth" roll-up — split by `MILESTONE_DEEP_MIN = 3`. The source, soft copy, literal
> click-through, and people-I-follow scope below are unchanged; the threshold/aggregation now feeds the
> A-1 split rule. Read A-1 for the deep/breadth split and edge cases.

- **Source (reused, not re-written).** Derive the milestone at **read time** from the
  `friend_answered` `feedItems` already written by `create-feed-items-for-answer.ts` — the same way
  `getLatelyMoments` derives moments from `masteryEvents`. **No new write path, no `activityItems`
  row, no migration.**
- **Aggregation.** Group `feedItems` where `recipientUserId=me`, `sourceType='friend_answered'`,
  `sourceResult='correct'`, `sourceUserId ∈ {people I follow}`, joined to the canonical question for
  `canonicalSubcategory`. Group by **(sourceUserId, canonicalSubcategory)** within a rolling window
  (start at the Lately 30-day horizon; tune later). Each group → **one** milestone, carrying the set of
  `questionId`s in it.
- **Threshold.** Fire when a group has **≥ `MILESTONE_MIN_CORRECT` (=1)** correct items. Keep the
  constant explicit; raising it is the first lever if Lately feels noisy.
- **Soft copy.** "{First name} showed {their} skills in {domain displayName}." **Never** "mastered" or
  "mastery." Domain label uses the same display-name resolution as the presence section.
- **Click-through plays the friend's literal questions.** Tapping the milestone launches a play session
  **seeded with exactly the `questionId`s in that group** (the literal canonical questions the friend
  answered) — not a generated set. This is the _only_ home for playing a friend's literal questions.
  Reuse the existing play/queue rendering, seeded from an explicit question-id list rather than the
  daily generation path. (Build note: a seeded-list play session is the main new surface here; spec-level.)
- **Whose presence.** **People I follow** — consistent with the feed-item fan-out (items already land in
  my rows only for answerers I follow) and with +2 eligibility (`PRD-D-1` Q4a).

### B. The +2 reframe — fresh questions in friend-shaped domains

> **⚠️ Amended by A-2 (Amendments section).** The pool now sources from **territory ∪ activity**, not
> recency alone, and the **ranking is Both > territory-only > activity-only** (recency tie-break, then
> strength). The "Domain selection" bullet immediately below is **superseded by A-2** for the
> source/ranking; everything else in §B (fresh generation, accessible target, attribution, shrink,
> de-dup) stands.

- **Repoint, don't extend.** Replace the literal `friend_answered`→bonus-slot path
  (`pickBonusAnswererSlots`, `daily.ts:1316-1398`) with a **domain-driven generation** step.
- **Domain selection (superseded by A-2 — territory ∪ activity, ranked Both > territory > activity).**
  Build an **aggregate** across the people I follow: for each followee, collect (a) their **territory**
  domains from `getKnowledgeBase(friendId)` (`daily.ts:211-258`) carrying `source`/`tier`/`totalPoints`,
  and (b) their **recently-active** domains from the per-domain `masteryEvents` recency that backs
  `selectRecentlyExploring`. Merge per (friend, domain) with flags `isTerritory` / `isActive`, a recency
  timestamp, and strength. Rank by tier (**both** → territory-only → activity-only), tie-break by
  most-recent activity then strength, and take the top **`DAILY_BONUS_SLOT_MAX` (=2)** domains.
  - **Reuse the computations, add one aggregate.** Today `selectRecentlyExploring` runs on one friend's
    `allDomains` (`recently-exploring.ts:33-61`) and `getKnowledgeBase` runs per user. The +2 needs both
    **merged across the people I follow**. Add a query helper (e.g.
    `getFriendShapedDomainsAcrossFollows(me)`) that reuses the masteryEvents-recency derivation **and**
    the knowledge-base territory read rather than duplicating either. (`broadCategory` is still not
    required — the ranking is territory/activity/strength, not a tier against my own focus.)
- **Fresh generation (not a lookup).** For each selected domain, generate via the existing path —
  bank-first (`pickBankPicksForDomains`) then Sonnet (`generateDailyQuestions`, `generate-questions.ts:798`)
  — targeting **`difficultyEstimate='accessible'`** (`difficultyPreference='normal'`). One bonus
  question per domain, up to 2.
- **"Accessible" is a generation target, not a filter.** Generated questions carry only
  `difficultyEstimate` (`generate-questions.ts:1044`); they never have `calibratedDifficulty`/`llmDifficulty`.
  So the old accessibility _filter_ (`daily.ts:1259-1262`) is **retired** — accessibility is requested
  up front. (If a bank pick comes back at a non-accessible estimate, treat it as not-qualifying and let
  the slot shrink rather than forcing a downgrade.)
- **Attribution becomes territory/presence, not literal answerer.** The +2 no longer carries a literal
  answerer (there is no single person who "answered" a freshly generated question). Replace the slot's
  answerer attribution with **friend-shaped attribution**: the friend whose territory or activity
  surfaced the domain. Use the gentle copy **"from {Name}'s world"** / **"from a domain {Name} knows"**
  (per A-2) — honest for both a durable-territory and a recently-active domain, never "answered this."
  - **`QueueSlot` change.** `answerer_id`/`answerer_name` (`types.ts:44-46`) described a literal
    answerer; under the reframe they are **retired from the +2** and replaced by source fields
    (e.g. `presence_source_id`/`presence_source_name`, plus the existing `domain`). If a domain was
    surfaced by multiple followees, attribute to the highest-ranked source (the A-2 winner — "both"
    over territory-only over activity-only, recency then strength), or render "{Name} and others"; the
    slot still has a primary `domain`. Zod schema stays the source of truth.
- **Graceful shrink — what "shrink" means when the source is domains, not items.** Inherit `PRD-D-1`'s
  rule (0–2 bonus, core 5 never LLM-backfilled), reinterpreted for a generated bonus:
  - If I follow no one, or no followee has recent activity in the window, there are **0** friend-presence
    domains → **0 bonus** (a clean 5). The bonus is friend-shaped territory; with no friend signal there
    is no bonus.
  - If only 1 domain is available → at most **1** bonus.
  - **Never substitute my own domains** to pad a friend-presence slot to 2 (that would make the bonus
    no longer friend-shaped). Padding with my own focus is exactly what shrink forbids here.
  - If generation _fails_ for a chosen domain, that slot shrinks (don't swap domains, don't route
    through the orchestrator's N<5 core backstop, `queue-orchestrator.ts:211-237`).
- **De-dup rule (Decision 3).** The +2 serves **fresh** questions, so there is no literal collision with
  Lately. State the rule plainly: **the +2 never serves a friend's literal question**; literal friend
  questions live only behind the Lately milestone click-through (§A). Once played there, they are
  recorded as answered (`masteryEvents`) and **normal non-repetition prevents re-serving them anywhere**
  — including the +2, which wouldn't serve them regardless. No explicit cross-surface guard is added.

### C. Lately ranking / prominence

Define relative prominence (Decision 4), highest first:

1. **Someone answered _your_ authored question** — the `they_got_you` moment. **Most prominent.**
2. **Niche-match discovery** — `niche_match_*` (kept out of top-3 dedup; slow-burn).
3. **Friend skill milestones** — the new §A item. Slots **below** niche-match.
4. **Other activity.**

- **Confirm "answered your question" surfaces.** It does: the `friend_answered_your_question` activity
  is deduped when correct **only because** the `they_got_you` moment carries the same event
  (`filter-utility-activities.ts:4-7`, `31-34`). This is correct behavior, not a leak — but it is
  load-bearing and currently rests on a comment. **Lock it with a regression test**: a friend answering
  my authored question correctly must produce a visible `they_got_you` moment in Lately (and the
  activity-side suppression must not run when no covering moment exists). If a future change drops the
  moment, this test must fail.
- **Don't let milestones bury moments.** Because the new milestone is read-derived and could be
  higher-volume than moments, the LatelyFeed sort must apply the prominence tiers above **before** (or
  alongside) the chronological `sortAt` ordering — a flood of skill milestones must never push a
  `they_got_you` moment or a niche-match item out of view. (Build note: today everything interleaves by
  `sortAt`; adding a tier key is the change.)

---

## Reused vs. repointed vs. retired

- **Reused (unchanged in spirit):**
  - The presence recency computation (`masteryEvents` recency → per-domain `lastActivityAt`) **and**
    `getKnowledgeBase` territory (declared + demonstrated, with `tier`/`totalPoints`) — the +2 consumes
    **both** via a single new **aggregate-across-follows** helper (A-2), not new signals.
  - The `selectRecentlyExploring` profile section (`users/[id]`) — stays as-is.
  - The generation path (`generateDailyQuestions` / bank-first selection) — the +2 now calls it.
  - The `friend_answered` feed-item **writes** (`create-feed-items-for-answer.ts`) — now the source for
    the Lately milestone.
  - `getLatelyMoments` `they_got_you`/`you_got_them` moments and the `HOME_TOP3_ELIGIBLE_TYPES` ranking
    machinery.
- **Repointed:**
  - The `friend_answered`→+2 path. `pickBonusAnswererSlots` / `selectBonusAnswererPicks` /
    `createDailyQueueItemFromAnswerer` (`daily.ts:1222-1457`) are replaced by a presence-domain →
    fresh-generation builder.
  - `QueueSlot` answerer attribution → presence attribution.
- **Retired:**
  - Literal friend questions in the +2 (moved entirely to the Lately click-through).
  - The calibrated/llm accessibility _filter_ on the +2 (`daily.ts:1259-1262`) — superseded by an
    accessible generation _target_.
  - The `me`-knowledge-base relevance tiering on the +2 (`daily.ts:1234-1247`) — superseded by the A-2
    **friend** territory ∪ activity ranking (Both > territory > activity).

---

## Done-When checklist for the eventual build (staged)

**Stage 1 — Lately skill milestones, BOTH forms (new — A-1)**
- [ ] Read-time aggregate of `friend_answered` correct items by (sourceUserId, canonicalSubcategory),
      people-I-follow only, within the window; per-domain correct-counts + `questionId` sets.
- [ ] Constants `MILESTONE_MIN_CORRECT = 1` and `MILESTONE_DEEP_MIN = 3` (both tunable).
- [ ] **Split rule (A-1):** domains with count ≥ `MILESTONE_DEEP_MIN` → a per-domain **deep** card,
      **excluded** from breadth; remaining light domains (1–2) → a per-friend **breadth** card that
      renders only with **≥2** light domains. No answer appears in both. Edge cases handled (single
      light → plain per-domain card, not "deep"; deep+one-light → deep only; ≥2 light none deep →
      breadth only; multiple deep → multiple deep cards).
- [ ] Copy: deep = "went deep on {domain}"; plain/per-domain = "showed {their} skills in {domain}";
      breadth = "{Name}'s killing it — {a}, {b}, and N more". **No "mastery"/"mastered".**
- [ ] Click-through plays the friend's literal `questionId`s; breadth card lets the player pick a domain.
- [ ] No new write path / no migration (derived like moments).

**Stage 2 — +2 reframe, territory ∪ activity (repoint — A-2)**
- [ ] `getFriendShapedDomainsAcrossFollows(me)` helper reusing **both** the masteryEvents-recency
      derivation (activity) **and** `getKnowledgeBase(friendId)` (territory: declared + demonstrated,
      with `tier`/`totalPoints`); merged per (friend, domain) with `isTerritory`/`isActive` + recency +
      strength.
- [ ] **Ranking (A-2):** Both > territory-only > activity-only; tie-break most-recent activity, then
      strength (strength is a tie-breaker, not a gate); take top 2 across all followed friends.
- [ ] +2 builder generates fresh (bank-first → Sonnet) in those domains at `difficultyEstimate='accessible'`.
- [ ] `QueueSlot` answerer fields retired from the +2; territory/presence attribution added; Zod updated.
- [ ] UI renders gentle attribution "from {Name}'s world" / "from a domain {Name} knows" + accessible badge.
- [ ] Graceful shrink: 0/1/2 bonus by availability; never pad with my own domains; generation failure
      shrinks the slot, not the core; not routed through the N<5 backstop.
- [ ] De-dup rule documented and enforced by construction: +2 serves no literals; literals only via Lately.

**Stage 3 — Lately ranking + "answered-you" guarantee**
- [ ] Prominence tiers applied: answered-you (`they_got_you`) > niche-match > skill milestones (both
      deep + breadth share this tier) > other.
- [ ] Regression test: a friend answering my authored question correctly yields a visible `they_got_you`
      moment; the correct-result activity suppression is safe only because the moment covers it.
- [ ] A high volume of skill milestones cannot push a `they_got_you` or niche-match item out of view.

**Cross-cutting**
- [ ] Zod on every new/changed API input. DB access stays in `src/server/db/queries/`.
- [ ] LLM calls stay centralized; Sonnet for generation, Haiku for grading/categorization — unchanged.
- [ ] No `src/middleware.ts` (use `src/proxy.ts`); run `check-middleware`.
- [ ] **Re-audit the +2** against `PRD-D-1` and `audits/2026-06-02-restructure-conformance-audit.md`
      after build — this changes a conformance-audited surface.

---

## Verification (for the eventual build)

- **Typecheck:** `npx tsc -p tsconfig.typecheck.json`. **Lint/format:** `npm run lint`, `npm run format`.
- **Daily smoke:** `npm run smoke:daily-catchup`; manually verify a 5-, 6-, and 7-slot day where the
  bonus is **freshly generated accessible** questions in friend-shaped domains; confirm the A-2 ranking
  (a both-territory-and-active domain wins over territory-only over activity-only); attribution reads
  "from {Name}'s world"; and shrink yields a clean 5 when I follow no one with territory or activity.
- **Lately:** a friend answering my authored question correctly shows as a `they_got_you` moment;
  verify **both** milestone forms (a deep card for a ≥3-count domain, a breadth card for ≥2 light
  domains) with **no answer double-counted**; skill milestones appear below niche-match and never bury
  moments; the click-through plays the friend's literal questions (breadth lets you pick a domain).
- **De-dup:** confirm no literal friend question can appear in the +2; confirm a literal question played
  via Lately is not re-served (normal non-repetition).

---

## Explicitly out of scope (this prompt)

- No production code. This spec is the only artifact.
- No change to the presence profile section (`users/[id]`) itself — only a new aggregate helper consumes
  the same underlying recency.
- No knowledge-base relevance tiering on the +2 (pure recency, Decision 2).
- No explicit cross-Lately de-dup guard (Decision 3).
