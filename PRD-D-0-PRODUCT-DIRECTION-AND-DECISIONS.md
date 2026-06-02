# D-0 — Product Direction & Amended Decisions

> **Canonical "what the product is and why" doc for the restructure (D-1 / D-2 / D-3) work.**
> This sits *above* the three spec files (`PRD-D-1-…`, `PRD-D-2-…`, `PRD-D-3-…`) and records the
> target product model, what is deliberately deferred, the open hypotheses, and — most importantly —
> the decisions that were **amended after the build** so the next reader knows what is settled and what
> is still open.
>
> **Provenance of this document.** The numbered capability list below was **reconstructed** from the
> cited PRD/audit/spec sources and the shipped code; the repo did not previously contain a single
> canonical enumeration. Lines marked `[reconstructed]` are derived, not quoted — correct them against
> the authoritative list if one exists. Everything in **Amended decisions** and **Open threads** is a
> product decision recorded as stated, grounded in code where possible.
>
> Date filed: 2026-06-02.

---

## 1. The target product model — capabilities

Joshing is a daily knowledge game: five questions a day drawn from your declared interests, shared
with friends. The restructure work reorganizes the social surface around a **directional follow**
primitive and an honest **authored-vs-curated** provenance model. The capabilities below describe the
product the restructure is steering toward.

> `[reconstructed]` — assembled from the master alignment audit's enumerated systems
> (`PRD-11.1-MASTER-ALIGNMENT-AUDIT-2.md` §1) and the D-1/D-2/D-3 specs. Capabilities **21–22**
> (authoring / niche discovery) and **23** (house author) are the ones the specs name explicitly and
> are grounded below; the rest are reconstructed groupings.

### Daily play & knowledge
1. **Daily Five** — five LLM-generated questions a day, calibrated to the player's Knowledge base. `PRD-AUDIT.md` §2.1.
2. **Difficulty configuration** — five difficulty options (`normal`, `moderate`, `challenging`, `ridiculous`, `adaptive`). `PRD-AUDIT.md` §2.1.
3. **Chat-first play** — narrow chat thread, one active question, quiet sequential reveal, no visible countdown. `PRD-11.1-MASTER-ALIGNMENT-AUDIT-2.md` §1.
4. **Catch-up** — a dedicated play session for missed Daily Five questions, surfaced when eligible. `PRD_BACKLOG.md` §8.7.
5. **Knowledge portrait / map** — domain tiers, portrait/circle visualization, dismissed-domain re-open, "Grow your map" explainer. `PRD-11.1-MASTER-ALIGNMENT-AUDIT-2.md` §1.
6. **Knowledge base calibration** — declared + demonstrated domains feed daily generation. `PRD-AUDIT.md` §2.1.
7. **Mastery progression** — domain tiers advanced from `masteryEvents`. `[reconstructed]`

### Social surface (the restructure core)
8. **Directional follow** — symmetric friendship replaced by a directional follow edge; "friend" = mutual follow. `PRD-D-1-…` Decision 1 (keystone).
9. **Feed** — broadcasts + questions sent to me, split from the Daily. `PRD-D-1-…` Context.
10. **"Sent to you" tab** — direct sends promoted from in-list filter to a first-class Feed tab. `PRD-D-1-…` Decision 3.
11. **Friend-answer propagation** — a friend's answered question propagates to my Daily +2 bonus slots; thumbs-down does not propagate; dismissed domains respected. `PRD-11.1-MASTER-ALIGNMENT-AUDIT-2.md` §1.
12. **Daily +2 bonus slots** — 5 base + 0/1/2 friend slots (total 5–7); friend slots are never LLM-backfilled. `PRD-D-1-…` Decision 7.
13. **Broadcast (followers-only)** — "share with all friends" writes a followers-only broadcast. `PRD-D-1-…` Decision 2.
14. **Direct send** — send a specific question to a specific person. `PRD-D-1-…` Type 2 (`direct_sent`).
15. **Presence / "recently exploring"** — activity-based recent domains shown on a friend's profile (`/users/[id]`), distinct from demonstrated-territory overlap. `PRD-D-1-…` Decisions 8–9.
16. **Creator note ("author's why")** — a note an author attaches at creation, revealed to anyone who answers (correct or incorrect). `src/components/feed/AnswerFeedbackSheet.tsx` ("Why they asked").
17. **Aside / "between us"** — a short provenance-labeled commentary line; `relational` ("Between us friends") for human authors, `editorial` ("Between us!", placeholder copy) for machine-origin. `src/lib/questions-types.ts:47-50`.

### Ceremony & reflection
18. **Biweekly Ceremony** — the major reflective artifact (banner, viewed, share token/page, compute/fire services). `PRD-11.1-MASTER-ALIGNMENT-AUDIT-2.md` §1, §22.

### Onboarding
19. **Onboarding with cultural anchor** — `birth_year`, `grew_up_country`, `grew_up_region` captured; proposal/canonicalization/save routes. `PRD-11.1-MASTER-ALIGNMENT-AUDIT-2.md` §1.

### Authoring & discovery (specs name these explicitly)
20. **Authoring** — players author questions into their bank for circulation; no per-round submission cap. `PRD_BACKLOG.md` §5.
21. **Authoring payoff (Capability 21)** — authoring is worthwhile even when no friend shares the niche. `PRD-D-2-…` Context ("Capabilities 21–22").
22. **Niche-match discovery (Capability 22)** — when a stranger answers a question I authored I can go see and follow them, and symmetrically; the "atonal-stranger" story. Privacy-gated by `discoverable_by_niche_match`. `PRD-D-2-…` Context + Decision ledger.

### House / editorial (spec only — not built)
23. **House / editorial author (Capability 23)** — a clearly-labeled, non-human curator that seeds questions into niches to ease content scarcity at small scale. **Never** a simulated friend, never followable, never a niche-match target. `PRD-D-3-…` Context + Decision 6. **Status: spec only, unbuilt** — see the conformance audit.

> The product target is **22 built-or-building capabilities plus Capability 23 (house) held as spec**.
> If the canonical numbered list differs, replace this section and keep the citations.

---

## 2. Deferred items

Recorded in `PRD_BACKLOG.md`; deferred deliberately, not dropped.

- **Personal Rounds** — on-demand practice from the Knowledge page. *Deferred to a future phase.* `PRD_BACKLOG.md` §8.37.
- **Archive** — searchable history of all interactions. *Deferred to a future phase* (Catch-up split out as its own shipped surface). `PRD_BACKLOG.md` §8.7.
- **Activities Tab** — fully implemented but not linked from nav/Account; not a reachable surface. *Deferred until re-enabled.* `PRD_BACKLOG.md` §8.15.
- **Joshing Games** — fully implemented (schema, API, play, summary, feed, SMS) but creation gated off by `GAME_CREATION_DISABLED_IN_V11_1 = true` (`src/app/api/joshing-games/route.ts:12`). *Deferred until re-enabled.* `PRD_BACKLOG.md` §8.14.
- **House / editorial author (Capability 23)** — spec complete (`PRD-D-3-…`), implementation deferred. Depends on D-1's follow model and D-2's niche-match rules.

---

## 3. Open hypotheses

Unsettled questions to validate, not yet decided.

- **Niche-match default visibility.** `discoverable_by_niche_match` ships **DEFAULT false**; for the **test phase only** it is flipped to **DEFAULT true**. The **production default is an OPEN DECISION** to revisit after observing the test. `PRD-D-2-…` ("OPEN DECISION (test-phase amendment)").
- **Thumbs-up → surface priority.** The thumbs-up signal currently has no effect on feed ordering. Open: eager update to `surface_priority_score` vs. dynamic weighted sort joining `question_feedback`, and what the weighting formula is. `PRD_BACKLOG.md` §8.1.11.
- **Onboarding cultural-anchor step.** Post-acceptance cultural-anchor step described but not yet wired into `OnboardingFlow` / §7.3. `PRD_BACKLOG.md`.

---

## 4. Decisions Amended After Build

These changed *after* the restructure shipped. They are **settled** unless marked otherwise.

### 4.1 Send difficulty travels with the question — **settled**
When a question is sent to someone, the question's **own difficulty estimate travels with it** rather
than being recomputed for the recipient. The send route materializes the forwarded question with the
source question's `difficultyEstimate` (`src/app/api/questions/send/route.ts:179-181`).

> Implementation note (flagged for confirmation): only `difficultyEstimate` is carried. The schema
> also has `llmDifficulty` and `calibratedDifficulty` (`src/server/db/schema.ts:272-274`), which are
> **not** copied on forward. If "difficulty travels" is meant to include the calibrated values, that is
> a follow-up; as decided and as built, the carried value is `difficultyEstimate`.

### 4.2 Broadcast rolls off after unfollow — **won't fix**
When you unfollow someone, a broadcast of theirs that has already surfaced in your Feed is **not**
retroactively purged — it **rolls off** naturally rather than disappearing on unfollow. This is an
accepted **won't-fix**: the cost of retroactive removal is not worth it, and a broadcast already seen
is not a privacy leak. Future broadcasts stop, because broadcast fan-out is followers-only
(`PRD-D-1-…` Decision 2; fan-out targets "my followers").

---

## 5. Open threads (not settled)

### Option B — should the aside amplify a human's `creatorNote` when one exists?
Today the **aside** ("between us" / inside-joke line) and the **creator note** ("Why they asked") are
**independent surfaces** that render separately:
- The aside is provenance-labeled and gated by relationship: `relational` for human authors (shown to
  author + friends), `editorial` for machine-origin (shown to everyone, no relationship gate).
  `src/server/questions/inside-joke.ts`, `src/lib/questions-types.ts:47-50`.
- The creator note is the author's optional "why," revealed on any answer.
  `src/components/feed/AnswerFeedbackSheet.tsx`.

**Open question (Option B):** when a human author *has* attached a `creatorNote`, should the aside
**amplify that human voice** (use/extend the note) instead of presenting a separately-generated line?
No code currently merges them. **This is the live open thread the next reader should pick up.**

---

## 6. Related documents

- `PRD-D-1-FEED-DAILY-RESTRUCTURE-SPEC.md` — follow model + Feed/Daily split (spec).
- `PRD-D-2-NICHE-MATCH-DISCOVERY-SPEC.md` — niche-match discovery engine (spec).
- `PRD-D-3-HOUSE-EDITORIAL-AUTHOR-SPEC.md` — house / editorial author (spec, unbuilt).
- `audits/2026-06-02-restructure-conformance-audit.md` — read-only conformance audit (this doc's companion).
- `DECISIONS.md` — index of settled vs. open decisions.
