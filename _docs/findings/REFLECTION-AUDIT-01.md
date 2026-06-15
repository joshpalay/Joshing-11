# REFLECTION-AUDIT-01 — Weekly Reflection: Read-Only Audit Findings

**Status:** READ-ONLY audit. No code written, no files edited. Findings only.
**Serves:** `D-REFLECTION-COPY-01.md` (the locked copy register / beat structure).
**Scope:** Confirm which surface is live, map code↔spec beats, and resolve the two
gating questions (Q1 surface, Q5 discovery-selection signal) before any build prompt.

> **Headline:** The live surface is the **season-ceremony codebase, lightly re-skinned
> as "Weekly Reflection" at the entry points only.** The internals — table, route,
> component, beat computation — are still named and structured as the old `ceremony`.
> Retired vocabulary ("ceremony," "season," "staked") is live in user-facing strings.
> The spec's Beat E ("What you discovered" = missed/expired questions) has **no faithful
> live counterpart** — the closest beat (Beat 6 "Something you learned") is a *redemption*
> beat (wrong→right), not a *discovery* beat (wrong-as-connection). The Beat E selection
> signal "most friends also missed it" is **absent as built but derivable for canonical
> questions only** (structurally impossible for pure bot daily slots).

---

## Q1 — Which surface is live?

**It is the weekly Reflection in name at the surface, the season-ending ceremony in code.**
The rename is partial: entry-point copy says "Reflection," everything underneath says
"ceremony."

### The live components & route

| Layer | File | Notes |
|---|---|---|
| Render (the slideshow) | `src/app/ceremony/[ceremonyId]/page.tsx` | Client component `CeremonyPage`. Story-style tap-through of "beats." This is the surface the spec is about. |
| Entry marker (home) | `src/components/home/CeremonyPin.tsx` | Renders "Your weekly reflection is ready" / "Weekly Reflection in N days". The **only** place the new "Reflection" vocabulary appears. |
| Status feed | `src/app/api/ceremony/status/route.ts` → consumed by `CeremonyPin` | Drives the pin. |
| Beat computation | `src/server/ceremony/compute-beats.ts` | `computeBeats(userId, cycleStart, cycleEnd)` → `BeatsPayload`. The data layer for every beat. |
| Fire / persist | `src/server/ceremony/fire-ceremony.ts` | `fireCeremony(userId)`: dedupes, gates on activity, runs domain merges, computes beats, inserts the row, writes an activity item, sends SMS. |
| Trigger (cron) | `src/app/api/cron/weekly-ceremony/route.ts` | Fires **Sundays 08:00 UTC** (daily cron, Sunday-gated). `MIN_ACCOUNT_AGE_DAYS=3`, 6-day dedupe window. **Cadence is now weekly** (the comment says so), but the table is still `biweeklyCeremonies`. |
| Persistence | table `biweeklyCeremonies` (`src/server/db/schema.ts`), query helpers `src/server/db/queries/ceremony.ts` | JSONB `beatsPayload`. **Table name still says "biweekly."** |
| Share | `src/components/ShareCard.tsx`, `src/lib/share-card.ts`, `src/app/share/ceremony/[token]/page.tsx`, `src/app/api/share/ceremony/[token]/route.ts` | Share-card path keyed off the same `biweeklyCeremonies` row. |
| Mode classifier | `src/lib/ceremony/mode.ts` | `solo | duo | group` from active-answering-friend count. |

**Render trigger chain:** `CeremonyPin` (home) links to `/ceremony/{id}` → `CeremonyPage`
fetches `GET /api/ceremony/{id}` → renders `beatViews(beatsPayload)` as a tappable
story; `POST /api/ceremony/{id}/viewed` marks it read. The ceremony row itself is created
out-of-band by the **`weekly-ceremony` cron** calling `fireCeremony`.

### Retired vocabulary still live (flag-only — do NOT change)

These are **retired terms per `D-REFLECTION-COPY-01.md` §1** still rendering or naming live code:

- **"ceremony"** — pervasive in code that backs the user surface: route `/ceremony/[ceremonyId]`,
  `CeremonyPage`, `ceremony_ready` activity type, the SMS deep-link path
  `…/ceremony/${ceremonyId}`, and the share route `/share/ceremony/[token]`. User-visible
  string: error/loading copy in `page.tsx` ("Could not load this ceremony.").
- **"season" / "biweekly"** — table `biweeklyCeremonies`; column/payload type names
  `BiweeklyCeremony`; `src/lib/share-card.ts` and `ceremony.ts` query helpers. Migration
  `0043_rename_season_points_to_lifetime_baseline.sql` already renamed the old
  `season_points_start` column (see Q6), but the *table* keeps the biweekly/season lineage.
- **"staked"** — `compute-beats` Beat 2 renders the headline **"You staked new territory."**
  (`page.tsx` ~line 248). The copy spec (Beat C craft fix) explicitly retires "staked" as
  "cold and competition-adjacent" in favor of **"declared."**
- **Mismatched headlines vs. spec** (live strings, all in `page.tsx`):
  - Beat A → live **"You leveled up."** (spec matches)
  - Beat B → live **"You went somewhere new."** (spec wants **"Your friends took you somewhere new."** — friend attribution is in the body paragraph, not the headline)
  - Beat C → live **"You staked new territory."** (spec wants **"You declared new territory."**)
  - Beat D → live **"Your territory came to life."** (spec matches)
  - Beat E → **no matching beat** (see Q2/Q5); nearest is Beat 6 **"Something you learned this week."**

**Conclusion (gating answer):** The surface is the **old season ceremony, renamed
"Weekly Reflection" only at the home-screen pin.** A build prompt that targets "the
Reflection component" must target `src/app/ceremony/[ceremonyId]/page.tsx` +
`src/server/ceremony/compute-beats.ts` — there is no separate Reflection component.

---

## Q2 — Beat inventory: code vs. spec

The code computes **six** beats (`compute-beats.ts`) plus two friend-fallback variants;
the renderer (`page.tsx` `beatViews` / `Beat`) orders them **1 → 2 → 6 → 3 → 4 → 5**.
The spec defines **five** beats (A–E). Mapping:

| Spec beat | Live counterpart | File + component | Live copy (verbatim) | Hardcoded? |
|---|---|---|---|---|
| **A — Leveled up** (tier movement) | **Beat 1** (`computeBeat1`, render `beat.id === 1`) | `compute-beats.ts:184`, `page.tsx:179` | Headline **"You leveled up."** then per-row `{domain}` + `{fromTierLabel} -> {toTierLabel}` (uppercase tracked). | **Hardcoded** in JSX. Tier labels via `KNOWLEDGE_TIER_LABEL` (`src/server/profile/knowledge-tier-copy.ts`). No strings module. |
| **B — Somewhere new** (friend-mediated) | **Beat 2 / `friendMediated`** sub-block (`computeBeat2`, render `beat.id === 2`) | `compute-beats.ts:223`, `page.tsx:207` | Headline **"You went somewhere new."** Body: *"Through your friends, you picked up {n} {question(s)} in {A, B, and C}."* + per-domain circle with `{correctCount}/{questionCount}`. | **Hardcoded.** Note: this is the exact "comma-list paragraph" the spec's Beat B craft-fix says to kill. |
| **C — Declared** (you authored) | **Beat 2 / `authored`** sub-block (`computeBeat2`, render `beat.id === 2`) | `compute-beats.ts:251` (`authoredDeclared`), `page.tsx:245` | Headline **"You staked new territory."** Body: *"You wrote questions that opened {a new domain / N new domains}: {list}."* Per-domain label literal **"Declared"**. | **Hardcoded.** Uses retired verb "staked" in headline but canonical "Declared" on the chip. |
| **D — Demonstrated** (a friend proved you) | **Beat 2 / `promoted`** sub-block (`computeBeat2`, render `beat.id === 2`) | `compute-beats.ts:260` (`promotedRows`), `page.tsx:268` | Headline **"Your territory came to life."** Body: *"A friend answered your questions and proved your knowledge in {list}."* Per-domain label literal **"Demonstrated"**. | **Hardcoded.** Matches spec intent + canonical label. |
| **E — What you discovered** (missed questions, EMOTIONAL PEAK) | **No faithful counterpart.** Nearest = **Beat 6 "Learned"** (`computeBeat6`, render `beat.id === 6`) | `compute-beats.ts:571`, `page.tsx:294` | Headline **"Something you learned this week."** Body: *"You missed {this/these}, came back, and got {it/them} right."* + per-item `{questionText}` / `{correctAnswer}`. | **Hardcoded.** **Semantically different** — see below. |

**Beats with NO spec counterpart (live extras, not in D-REFLECTION-COPY-01):**

- **Beat 3 "Shaped"** — *"These people gave you a chance to learn more."* / solo variant
  *"Questions that shaped your cycle."* (`computeBeat3`, `page.tsx:321`). Top-3 contributors
  by questions you answered correctly.
- **Beat 4 "Alignment"** — *"You and {name} see the world similarly."* / *"You both know {list}."*
  (`computeBeat4`, `page.tsx:341`). Best friend by shared-domain overlap.
- **Beat 5 "Gave"** — *"You taught people things."* / *"Your questions earned {n} points for
  others this week."* + most-played question (`computeBeat5`, `page.tsx:354`).
- **Beat-1 friend fallback** — *"{friend} leveled up this week."* (`page.tsx:150`).
- **Beat-5 friend fallback** — *"{friend} taught the room."* (`page.tsx:165`).
- **End card** — *"That's your week." / "See you next Sunday."* (`page.tsx:500`).

**Spec beat with NO faithful live counterpart (NET-NEW TO BUILD):**

- **Beat E ("What you discovered")** is net-new. The live Beat 6 is a **redemption** beat
  ("you missed it, *came back, and got it right*" — `answer_state = 'first_correct_after_wrong'`).
  The spec's Beat E is a **discovery / wrong-as-connection** beat ("a wrong answer in Joshing
  is a connection event," the most thesis-dense slide, curated top 2–3 of the week's
  *missed/expired* questions, with a "view all discoveries →" deep-link). These are different
  datasets and different emotional registers. **Beat E must be built; Beat 6 is not it.**

**Strings module?** No. Every beat's copy is **hardcoded inline in `page.tsx` JSX**. There
is no `lately.ts`-style register module for the ceremony surface. (`src/lib/lately.ts`
exists but serves the *Lately* feed's caption pools, not the ceremony.) A build prompt that
wants a copy register will be **creating** one, not editing one.

---

## Q3 — Declared / demonstrated data (Beats C & D)

**Live field names — confirmed:**

- Territory kind lives on `playerMastery.territoryType`, enum
  `territoryTypeEnum = ['declared','demonstrated']` (`schema.ts:190`, column at `schema.ts:432`,
  default `'demonstrated'`).
- **Declared** = you authored a question that opened the domain. Set in
  `openKBDomain({ via: 'authorship' })` → `territoryType: 'declared'`
  (`src/server/knowledge/open-domain.ts:15`). Self-healing backfill:
  `ensureAuthoredDomainsOpened` inserts `'declared'` rows for authored domains
  (`open-domain.ts:62`).
- **Demonstrated** = a friend answered your authored question correctly, proving you.

**Transition recorded (promote-on-correct-answer path) — confirmed:**

- `promoteDeclaredToDemonstrated(...)` (`open-domain.ts:102`) flips
  `playerMastery.territoryType` `declared → demonstrated` and **writes a
  `masteryEvents` row with `sourceType = 'declared_promoted'`** (enum value at
  `schema.ts:187`), `answerId = declared_promoted:{domain}:{questionId}:{friendId}`,
  zero points. It also writes an `activityItems` row of type `declared_promoted`.
- The trigger: `recordAnswerSideEffects` in `src/server/answers/answer-pipeline.ts:139`
  calls `promoteDeclaredToDemonstrated` when `isAuthorCreditEligible` (i.e. a friend
  answered the creator's canonical question correctly). This is the promote-on-correct-answer
  path. It is idempotent (`already_demonstrated` short-circuit + `onConflictDoNothing`).

**Can the Reflection query distinguish, per week, newly-declared vs. newly-demonstrated? YES.**
`computeBeat2` already does exactly this (`compute-beats.ts:251–268`):

- **Newly declared (this week)** = `playerMastery` rows where `territoryType = 'declared'`
  and `updatedAt` in the cycle window. → `beat2.authored`.
  - ⚠️ **Fragility note (not a fix):** this keys "newly declared" off `playerMastery.updatedAt`,
    not a dedicated `declaredAt`. Any later update to that row (e.g. a points bump) refreshes
    `updatedAt` and could re-surface an old declared domain as "new this week," or a
    promotion to demonstrated removes it from the `declared` filter. Honest proxy, but not
    a precise "declared-this-week" timestamp. Flag for the build prompt.
- **Newly demonstrated (this week)** = `masteryEvents` rows where
  `sourceType = 'declared_promoted'` and `createdAt` in the cycle window. → `beat2.promoted`.
  This one is precise (event-sourced; one row per promotion).

So the data **can** distinguish the two transitions for the week. Declared uses an
imprecise timestamp proxy; demonstrated is event-sourced and exact.

---

## Q4 — Tier movement (Beat A)

**Tier ladder — confirmed exactly as expected:**
`masteryTierEnum = ['establishing','familiar','solid','mastery']` (`schema.ts:174`),
ordered `TIER_ORDER` (`compute-beats.ts:162`). Thresholds (`src/server/mastery/tiers.ts`):
establishing 0 / familiar 100 / solid 1000 / mastery 2000 points; `mastery` additionally
gated on ≥20% author-credit share + ≥2 distinct authored questions (`effectiveTier`).
Display labels via `KNOWLEDGE_TIER_LABEL` (`src/server/profile/knowledge-tier-copy.ts`).

**Can the surface report, per domain, "moved from {tier} to {tier} this week"? YES.**
`computeBeat1` (`compute-beats.ts:184`):

- Reads `playerMastery` rows where `tierReachedAt` (`schema.ts:430`) is in the cycle window.
- `toTier` = `playerMastery.tier` (the current tier).
- `fromTier` = **derived** as `previousTier(toTier)` (one step down the ladder,
  `compute-beats.ts:179`) — **NOT** a stored "previous tier."

⚠️ **Fragility note (not a fix):** `fromTier` is *inferred as exactly one tier below*, not
recorded. A domain that crosses **two** tiers in one week (e.g. establishing → solid) will
mis-report as familiar → solid. `tierReachedAt` is stamped only on change in
`write-mastery-event.ts:221/231`, and there is no per-event tier-history table, so the true
prior tier for the cycle isn't recoverable from this query. Field names for a build:
`playerMastery.tier`, `playerMastery.tierReachedAt`, `playerMastery.canonicalSubcategory`.

---

## Q5 — Discovery selection (Beat E) — THE BLOCKER

> **Bottom line:** The preferred signal — **"how many of this user's friends also missed
> this question"** — **does NOT exist as a built query.** It is **derivable for canonical
> (house/friend-authored) questions only**, and is **structurally impossible for pure bot
> daily slots** (each user gets a per-user generated question — there is no shared question
> id to co-miss on). Today nothing selects discoveries by interestingness; the nearest beat
> (Beat 6) selects by **most-recent**. There is **no hash-based selection** of discoveries
> (the djb2 mechanism exists but is used only for *copy/caption* variety, not discovery
> ranking).

### How missed / expired questions are retrieved today

There is no single "discoveries" query. "Missed/expired" lives in two places, because
"expired" and "wrong" both collapse to one state:

- **`answerStateEnum` has no `expired`** (`schema.ts:160`): values are
  `first_correct | first_correct_after_wrong | repeat_correct | incorrect`. A wrong **or**
  expired answer is recorded as **`incorrect`**.
- **Canonical questions (house- + friend-authored):** every answer, right or wrong, writes
  a `masteryEvents` row. Confirmed: `write-mastery-event.ts:174–208` inserts the row with
  `answer_state = 'incorrect'`, `awarded_points = 0` for misses (the `playerMastery` credit
  is gated on `pointsAwarded > 0`, but **the event row is still written**). So a user-week's
  misses on canonical questions = `masteryEvents` where `userId = u`,
  `answerState = 'incorrect'`, `createdAt` in window, `questionId NOT NULL`.
- **Pure bot daily slots (LLM-generated, no canonical question):** these don't mint a
  canonical `questions` row, so they carry no canonical `masteryEvents.questionId`. Their
  misses live on the **daily-queue slots**. `getReplayWrongQuestions`
  (`src/server/db/queries/replay.ts:8`) reads `dailyQueues` slots where
  `slot.answer_state === 'incorrect'` (bot slots via `generated_question_id`, friend slots
  via `question_id`). This is the **Review / replay** surface — the natural target for Beat E's
  "view all discoveries →" deep-link.

`compute-beats.ts` itself even notes this gap (the Beat 6 docstring, `compute-beats.ts:566`):
*"Pure bot slots that never minted a canonical question row don't carry the corrected state,
so they're out of scope here."* The same limitation applies to any co-miss signal.

### Is selection hash-based or a real ranking signal?

- **Beat 6 (the only discovery-adjacent beat today)** selects by **most-recent**:
  `orderBy(desc(masteryEvents.createdAt))`, dedupe one card per question, cap
  `BEAT6_MAX_ITEMS = 5` (`compute-beats.ts:556,591–605`). No semantic ranking.
- **The djb2 hash mechanism exists** (`src/lib/lately.ts:59` `djb2`, also re-used in
  `src/lib/activity-stream.ts`) but is used **only to spread copy/caption-pool selection**
  (`assignCaption`, `convergenceCaptionTemplate`), **never to select or rank discoveries.**
  So "stable-but-random hash selection" is *available as a utility* but is **not currently
  applied** to any discovery list.
- **Conclusion:** there is **no real ranking signal** for discoveries today. The de facto
  rule is recency (Beat 6) / unsorted-by-queue-date (replay).

### The preferred signal: "how many friends also missed this question"

- **ABSENT as a built query.** Nothing computes per-question friend-miss counts.
- **DERIVABLE — but only for canonical questions.** The data exists: friends' incorrect
  answers on a *shared canonical question* are
  `masteryEvents` rows where `userId IN friendIds`, `questionId = X`,
  `answerState = 'incorrect'`. The **inverse already ships**:
  `getLatelyConvergences` (`src/server/db/queries/lately.ts:550`) computes co-**correct**
  overlap between the viewer and mutual friends from `masteryEvents` — the exact same shape,
  flipped to `incorrect`, would yield co-**miss**. So the pattern is proven and cheap.
- **CRITICAL CAVEAT for the build:** co-miss is only meaningful where multiple users
  answered the **same** canonical question id — i.e. **house- and friend-authored questions**.
  **Pure bot daily slots generate a per-user question**, so two users never share that
  question id and "friends also missed it" is undefined for them. A "most friends also
  missed it" rule therefore can only rank the *canonical* slice of a week's discoveries; bot
  misses would need a fallback proxy or exclusion.

### What IS available (honest proxies for the build prompt)

In the spec's stated preference order (`D-REFLECTION-COPY-01.md` §3 Flag 1):

1. **"most friends also missed it"** — *derivable for canonical questions only* (query
   above, mirrors `getLatelyConvergences`); *undefined for bot daily slots.*
2. **most recent** — fully available (`masteryEvents.createdAt`; Beat 6 already orders this way).
3. **stable hash (djb2)** — utility exists (`lib/lately.ts`), trivially applicable to a
   discovery id list; currently unused for selection.
4. **per-question miss counts (own)** — derivable (count `incorrect` `masteryEvents` per
   `questionId`), but this is self-miss frequency, not relational.

**Recommendation to the build prompt (not a decision — flag-only):** the relational signal
(#1) is feasible and best fits the thesis, but only for canonical questions; expect a
**hybrid** — rank canonical discoveries by friend-miss count, fall back to most-recent for
bot-slot discoveries (or scope Beat E to canonical questions). This must be resolved before
Beat E ships (it's a live open decision in `DECISIONS.md:77`).

---

## Q6 — Conformance / fragility

### Conformance audit status (🔁)

- The ceremony/Reflection surface is **not** marked conformance-audited (🔁) anywhere.
  `D-REFLECTION-COPY-01.md` is listed in `DECISIONS.md:37` with **"Copy register decided;
  pixels NOT briefed,"** and the Beat E selection rule is an **open decision** at
  `DECISIONS.md:77`. **Flag: re-audit this surface after any future merge** — the partial
  rename (Q1) and hardcoded copy (Q2) make it prone to drift.

### Hardcoded hex literals (drift risk — list only, do NOT fix)

- **`src/app/ceremony/[ceremonyId]/page.tsx`** — **9 lines with hex literals**:
  - `CEREMONY_CIRCLE_COLORS` (page.tsx:83–92): **8 color objects × 4 hex each (`core/mid/rim/glow`)**
    — a bespoke palette wholly outside the `--cat-*` / design-system tokens. Selected by a
    domain djb2 hash (`ceremonyCircleColor`, page.tsx:94) — **independent of and divergent
    from** the canonical `getPortraitDomainColor` (only used as a border-mix fallback).
    **Collision risk with `--cat-*`** per the known drift pattern.
  - Background gradient `rgba(...)` literals (page.tsx:486) and inset box-shadow `rgba(...)`
    in `CeremonyCircle` (page.tsx:127).
  - Stone Tailwind utilities (`bg-stone-950`, `text-stone-200`, etc.) throughout — off-palette
    relative to the Ink-on-Cream system but not hex literals; noting as register drift.
- **`src/components/ShareCard.tsx`** — **clean**: already tokenized
  (`INK = var(--warm-ink)`, `CREAM = var(--brand-cream-card)`, etc., ShareCard.tsx:122–129).
  The old `#1a1208` ink literal was migrated to `--warm-ink`. No OG-canvas hex hardcodes
  found in `src/lib/share-card.ts` (token-only / URL builder).

### `JoshingGame*` dormant-table reads

- **`compute-beats.ts` reads `joshingGameResponses`** in **Beat 2** (`computeBeat2`,
  line 232) and **Beat 3** (`computeBeat3`, line 308). Per `CLAUDE.md`'s dormant-table flag,
  **verify whether `joshingGameResponses` still receives writes** — if the joshing-game
  surface is dormant, these two beats silently under-count (they'd see only the legacy
  joshing-game subset, missing daily/feed/catchup answers, which flow through `feedItems` /
  `masteryEvents`). Beat 2/3 do also read `feedItems`, so they're not solely dependent, but
  the `joshingGameResponses` join is a latent dead-read risk. **Flag for verification.**

### `season_points_start` (misnamed lifetime baseline)

- **Already renamed.** Migration `0043_rename_season_points_to_lifetime_baseline.sql`
  renamed the column; live code uses `playerMastery.lifetimePointsBaseline` (set to `0` in
  `open-domain.ts` and `write-mastery-event.ts`). **The ceremony/Reflection surface does not
  read or write `season_points_start`** — `compute-beats` never touches the baseline column.
  No action; noting for completeness. (The *table* `biweeklyCeremonies` retains the old
  "biweekly/season" naming — see Q1 — but that's a name, not the misnamed baseline column.)

### `/activities` nav traps

- The ceremony/Reflection surface does **not** route through `/activities`. `CeremonyPin`
  links to `/ceremony/{id}`; the end card and "Done" route to `/`. No `/activities` nav trap
  in this surface. (`src/app/activities/filter-utility-activities.ts` exists for the activity
  stream but is unrelated to this surface.)

### Other fragility flags (for the build prompt)

- **Beat A `fromTier` is inferred, not stored** (Q4) — double-tier jumps mis-report.
- **Beat C "newly declared" keyed on `playerMastery.updatedAt`** (Q3) — imprecise vs. a true
  declared-this-week timestamp.
- **Partial rename** (Q1) — table `biweeklyCeremonies`, route `/ceremony`, `ceremony_ready`
  activity type, and retired headline "You staked new territory." are all live.
- **All beat copy is hardcoded in `page.tsx`** (Q2) — no strings module; a copy-register
  build creates one.
- **Beat E is net-new** (Q2/Q5) and its selection rule is an **unresolved open decision**.

---

## DONE-WHEN checklist

- [x] `_docs/findings/REFLECTION-AUDIT-01.md` exists, answers Q1–Q6 with concrete file paths.
- [x] **Q1 (live surface)** answered unambiguously: the **old season ceremony** at
      `src/app/ceremony/[ceremonyId]/page.tsx` + `src/server/ceremony/compute-beats.ts`,
      renamed "Weekly Reflection" only at the home pin (`CeremonyPin.tsx`).
- [x] **Q5 (discovery selection signal)** answered unambiguously: "most friends also missed
      it" is **absent as built, derivable for canonical questions only, structurally
      impossible for bot daily slots.** Current selection = most-recent (Beat 6); no
      hash-based discovery selection. Honest proxies enumerated.
- [x] Every net-new beat named: **Beat E ("What you discovered")** is net-new (Beat 6
      "Learned" is a redemption beat, not it).
- [x] Every missing data dependency named: Beat A `fromTier` (inferred), Beat C
      declared-this-week (proxied via `updatedAt`), Beat E co-miss signal (absent/derivable).
- [x] **No code written, no files edited** other than creating this findings file.
</content>
</invoke>
