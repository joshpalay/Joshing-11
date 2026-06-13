# CATEGORY-HIERARCHY-FINDINGS-01

**Audit ID:** A-CATEGORY-HIERARCHY-AUDIT-01
**Type:** Read-only audit. No code was modified.
**Date:** 2026-06-13
**Scope:** What the *live code* does with interest categories — verified against source, not the PRD.

---

## Verdict on Q1 (lead)

**It's flat strings. There is no stored edge.** A question's place in the hierarchy is
three independent free-text/enum columns written side-by-side on the row —
`category` (a fixed enum), `broad_category` (text), `subcategory` (text), and
`canonical_subcategory` (text) — with **no foreign key, no `parent_id`, and no join
table** connecting a subcategory to its broad category
(`src/server/db/schema.ts:310-313`). The same flat pair (`canonical_subcategory` +
`broad_category`) is denormalized onto `PLAYER_MASTERY`
(`src/server/db/schema.ts:426-427`). "Literature → Shakespearean Tragedy → Hamlet" is
not a relationship the database can traverse; it is reconstructed at render time by
**string-grouping** `broad_category`, and `broad_category` itself is partly *derived*
from the subcategory string by regex (`normalizeBroadCategory`,
`src/lib/knowledge/broad-category.ts:86-104`). A grep for `parent`, `references.*ategor`,
`categoryId`, `broadCategoryId` over the schema returns **nothing**. The hierarchy is a
display convention layered over two/three flat strings, not a modeled structure.

---

## Q1 — Is the category→broad_category relationship STORED, or two independent strings?

**Independent strings. No stored edge.**

**Schema — `Question` table (`src/server/db/schema.ts:310-314`):**
```
category:             categoryEnum('category').notNull().default('general_knowledge'),  // pgEnum, line 28
broadCategory:        text('broad_category'),            // free text, nullable
subcategory:          text('subcategory'),               // free text, nullable
canonicalSubcategory: text('canonical_subcategory'),     // free text, nullable
categoryOverridden:   boolean('category_overridden')...
```
Indexes exist on `broad_category` and `canonical_subcategory`
(`src/server/db/schema.ts:372-373`) but they are plain single-column indexes, **not**
foreign keys. The only enum is `category` (`categoryEnum`, defined
`src/server/db/schema.ts:28`), which is a separate legacy/coarse field, not a parent of
`broad_category`.

- `PLAYER_MASTERY` (`schema.ts:421-440`): `canonicalSubcategory` text NOT NULL +
  `broadCategory` text nullable, unique on `(user_id, canonical_subcategory)` only
  (`schema.ts:436`). `broad_category` is denormalized alongside, not referenced.
- `GeneratedQuestion` (`schema.ts:586-619`): same pattern —
  `canonicalSubcategory` NOT NULL, `broadCategory` NOT NULL, plus a `domainKey` fold
  (`schema.ts:597`). Still no edge.
- `MASTERY_EVENTS` (`schema.ts:458-499`): `canonicalSubcategory` only — **no
  `broad_category` column at all** on the event ledger.

**Where the categorizer's output is written (no edge created):**
- User-submitted: `src/app/api/questions/route.ts:114-115, 155-158` —
  `broadCategory` and `canonicalSubcategory` are computed by two independent normalizers
  (`normalizeBroadQuestionCategoryOrDefault` / `normalizeCanonicalSubcategory`) and
  written as two strings. No linking row is created.
- Generated/daily: `src/server/daily/generate-questions.ts:1367-1371` —
  `canonicalSubcategory: canonicalDomain` and `broadCategory: question.broad_category`
  written side-by-side.

**Grep confirmation:** `grep -n "parent\|references.*ategor\|categoryId\|broadCategoryId"
src/server/db/schema.ts` → **no matches**. No `parent_id` column, no FK, no join table.

---

## Q2 — How many levels exist, and where does each come from?

**Three display levels; only two are stored, and the top one is partly derived.**

Query feeding the portrait: `src/app/api/knowledge/route.ts:13-40` →
`getKnowledgePageData()` / `getUserMasteryOverview()` in
`src/server/db/queries/knowledge.ts` (reads `PLAYER_MASTERY` + `MASTERY_EVENTS`,
columns `canonical_subcategory`, `broad_category`, `total_points`).

1. **Broad header ("LITERATURE")** — *stored value, then normalized/derived at render.*
   - Stored: `PLAYER_MASTERY.broad_category` (`schema.ts:427`).
   - Grouping happens **at render time** by string-keying that column:
     `src/components/knowledge/PortraitCircles.tsx:115-140` (`buildSections`), line 122:
     `const broadCategory = normalizeBroadCategory(e.broadCategory) ?? 'General Knowledge'`
     then `domainMap.get(broadCategory)`. The header label is the grouping key.
   - **The header is not purely stored:** `normalizeBroadCategory`
     (`src/lib/knowledge/broad-category.ts:86-104`) folds the stored string through an
     alias table (`:1-14`), a fixed `STABLE_BROAD_CATEGORIES` list (`:18-32`), and —
     critically — a **regex pattern list** (`LITERATURE_BROAD_CATEGORY_PATTERNS`,
     `:34-45`) that *re-derives* "Literature" from any string matching
     `/shakespeare/i`, `/joyce/i`, `/\bnovels?\b/i`, etc. (`:99-101`). So "Shakespearean
     Tragedy" can be coerced under "LITERATURE" even if the stored `broad_category` said
     something else.
2. **Subcategory circle ("Shakespearean Tragedy" / "Hamlet")** — *stored value.*
   `PLAYER_MASTERY.canonical_subcategory`, surfaced as the circle's
   `canonicalSubcategory`/display label (`PortraitCircles.tsx:330`).
3. **Count badge ("3")** — *derived stat.* `authoredAnsweredCount` /
   `questionsAnswered`, computed in the query (`knowledge.ts:370,381`) and rendered at
   `PortraitCircles.tsx:260`.

There is **no stored "Shakespearean Tragedy is the parent of Hamlet" middle tier** — both
are just `canonical_subcategory` strings on different rows. The only grouping the system
performs is the single broad-header fold above.

---

## Q3 — What does the categorizer actually receive as input?

**Two different paths, and the player-authored path categorizes blind.**

- **Categorizer call:** `categorizeQuestion(questionText, answerText, alternateAnswers)`
  in `src/lib/llm.ts:697-701`. Model: **Sonnet** (`ANTHROPIC_MODEL = 'claude-sonnet-4-6'`,
  `src/lib/llm.ts:69, 752`). Output shape: `{ subcategory, broad_category, confidence }`
  (`CategoryResult`, `src/lib/llm.ts:48-52`).
- **Input is ONLY the question text + answer + alternates.** The player's existing
  category list is **not** passed in. For user-submitted questions the call site
  (`src/app/api/questions/route.ts:98-102`) passes only
  `(text, correctAnswer, alternateAnswers)`. **The LLM cannot see that a new "Hamlet"
  question should reuse an existing "Shakespearean Tragedy" — on this path it
  categorizes blind every time**, and there is no post-hoc reconcile on this path
  (the route goes straight to normalize → write; grep of `route.ts` shows no
  `reconcile`/`converge` call).
- **Generated/daily questions DO reconcile, but after the fact.** The generation LLM
  emits `canonical_subcategory` itself; then
  `src/server/daily/generate-questions.ts:1324-1331` calls **`reconcileProposedDomain`**
  (`src/lib/questions/categorization.ts:23-90`), a **Haiku** call
  (`RECONCILE_MODEL = 'claude-haiku-4-5-20251001'`, `:4`) that is given the player's
  existing domain list (`getKnowledgeBase` → `existingDomains`, `:30-46`) and asked
  whether the proposed label matches one — returning the existing label if so. So on the
  *generated* path the model can fold "Hamlet" onto an existing domain; on the
  *user-authored* path it cannot.
- **Generic re-prompt:** inside `categorizeQuestion`, `isTooGenericSubcategory`
  (`src/lib/llm.ts:319-325`, set at `:74-94`) triggers a second Sonnet refinement call
  (`src/lib/llm.ts:784-821`). A final write-boundary guard
  (`assertSpecificCanonicalSubcategory`,
  `src/server/questions/canonical-subcategory.ts:61-67`) rejects generic labels at DB
  write.

---

## Q4 — What does merge/split actually do to structure?

**It is real, it is wired, and it CAN create a parent — but only by collapsing children
into it, not by recording an edge.**

- **Definition:** `applyMergesForUser()`
  (`src/server/mastery/ceremony.ts:511-710`), orchestrated by `runDomainMergesForUser()`
  (`:712-761`).
- **What it writes:** it retargets the `canonical_subcategory` string across tables
  **and writes `broad_category`** on the way:
  - `PLAYER_MASTERY`: upsert merged row + delete sources (`ceremony.ts:567-583`, upsert
    sets `broadCategory` at `:129-150`).
  - `Question`: `UPDATE ... set { canonicalSubcategory: target, broadCategory }`
    (`ceremony.ts:591-594`).
  - `GeneratedQuestion`: `set { canonicalSubcategory: target, broadCategory ?? 'General
    Knowledge' }` (`ceremony.ts:596-599`).
  - Also `MASTERY_EVENTS`, `SkippedDailyQuestion`, and consolidation of
    `ProfileDomainVisibility`, `DailyPreference`, `UserDomainDifficulty`,
    `UserDomainExclusion`, `FeedDismissedDomain`, `DeclaredInterest`.
- **Sibling rename vs parent-child:** it does **both** as *string operations*. The LLM
  prompt (`ceremony.ts:454-490`) explicitly allows creating a parent label from a facet
  ("Ulysses – Structure & Symbolism" → "Ulysses"), validated by
  `src/server/mastery/__tests__/ceremony-domain-merge.test.ts:199-253`. But "creating a
  parent" means **rewriting the child rows' `canonical_subcategory` to the parent string
  and summing their points** — it does **not** establish a queryable parent→child edge.
  After a merge the children cease to exist as distinct rows; nothing records that they
  *were* children. So it consolidates labels; it cannot model a true two-level nest.
- **Does it run?** Yes. Cron `"/api/cron/weekly-ceremony"` at `"0 8 * * *"`
  (`vercel.json:3-6`); the route gates to Sundays (`CEREMONY_WEEKDAY_UTC = 0`,
  `src/app/api/cron/weekly-ceremony/route.ts:14`) and calls `fireCeremony(user.id)`
  (`:75`), which invokes `runDomainMergesForUser` (`src/server/ceremony/fire-ceremony.ts:73`).
  Also manually triggerable via `POST /api/knowledge/tidy`
  (`src/app/api/knowledge/tidy/route.ts:11-32`).

---

## Q5 — How does mastery credit flow across the hierarchy?

**No roll-up. Each `canonical_subcategory` is an isolated bucket. Answering "Hamlet"
credits only "Hamlet".**

- **Write path:** `writeMasteryEvent()`
  (`src/server/mastery/write-mastery-event.ts:138-238`). Join/dedup key on
  `PLAYER_MASTERY` is `(user_id, canonical_subcategory)` only
  (`schema.ts:436`; lookup at `write-mastery-event.ts:148-151`; upsert conflict target
  `[playerMastery.userId, playerMastery.canonicalSubcategory]` at `:225-226`).
- **Motivating case:** the event inserts with `canonical_subcategory: params.domain`
  (`write-mastery-event.ts:189, 217`), where `params.domain = question.canonicalSubcategory`
  (i.e. "Hamlet") — set at `src/app/api/daily/answer/route.ts:475-486`. The upsert touches
  exactly the one `(user, "Hamlet")` row. **There is no second write, join, or
  aggregation against "Shakespearean Tragedy" or "Literature."** No code path propagates
  upward.
- **`broad_category` on the mastery row:** it *is* written
  (`write-mastery-event.ts:157` via `normalizeBroadCategory`, used at `:218, 228`),
  sourced from `question.broadCategory` (`daily/answer/route.ts:482`). But it is carried
  as a **denormalized display tag only** — never used as a SUM/GROUP-BY aggregation key.
  Grouping by broad category is done client-side post-query
  (`groupCategoriesByBroadCategory`, `src/server/.../personal-mastery.ts:35-49`;
  render-time grouping in `PortraitCircles.tsx:115-140`). `MASTERY_EVENTS` doesn't even
  store `broad_category`.
- **Corroborating evidence:** the merge job (Q4) has to *manually* sum child points into
  the parent row (`ceremony.ts:545`) precisely because no automatic roll-up exists.

---

## What's possible without schema change

Given only the flat strings actually stored:

- **(a) Reliable nesting / roll-up — REQUIRES NEW SCHEMA.** There is no parent→child edge
  to traverse, and `MASTERY_EVENTS` carries no `broad_category`, so a query-time roll-up
  to "Literature" would have to re-derive the parent from the subcategory string (via
  the brittle `normalizeBroadCategory` regex). Reliable nesting needs a real edge (FK,
  `parent_id`, or a domain/broad-category table).
- **(b) Sibling de-duplication — REACHABLE BY PROMPT/LOGIC ALONE (largely already built).**
  `reconcileProposedDomain` (Haiku, `categorization.ts`), `convergeDomain` +
  `findFuzzyCanonicalMatches` (pg_trgm, `converge-domain.ts` / `knowledge.ts:902-928`),
  and the merge job already de-dup sibling labels by rewriting strings. Extending this
  (e.g. running reconcile on the user-authored path too) needs no schema change.
- **(c) Up-propagation of mastery credit — PARTIALLY reachable, but lossy without schema.**
  You could derive a broad-category total at read time by summing `PLAYER_MASTERY` rows
  grouped on the (normalized) `broad_category` string. That works for a *display* roll-up
  without schema change, but it inherits the regex-derivation fragility of (a) and can't
  represent a genuine intermediate tier ("Shakespearean Tragedy" between "Hamlet" and
  "Literature"). A trustworthy, persisted up-propagation wants schema.
- **(d) Player-chosen display resolution — REACHABLE BY LOGIC ALONE.** The convergence
  surface already returns ranked candidates and lets the player pick / "create new"
  (`convergeDomain` candidates incl. an always-present `kind: 'new'`,
  `converge-domain.ts:159-167`; UI in `AddTopicField.tsx` + onboarding). A
  player-facing "is this the same as X?" resolution is buildable on the existing strings.

---

## Incidental findings (spotted, untouched)

1. **Top-tier header is regex-derived, not stored faithfully**
   (`src/lib/knowledge/broad-category.ts:99-101`). `normalizeBroadCategory` forces any
   label matching the literature regex list to "Literature" at render. A domain whose
   stored `broad_category` is, say, "Pop Culture" but whose subcategory string contains
   "Shakespeare" could be re-bucketed under Literature at display time, diverging from the
   stored value. This is the same *re-literalization / derive-instead-of-read*
   anti-pattern the audit flags (see below) — the broad header shown can disagree with the
   `broad_category` actually stored on the row.
2. **Two independent canonicalization mechanisms with different reach.** The
   generated-question path uses an **LLM** reconcile (`reconcileProposedDomain`, Haiku,
   per-user existing domains); the declared-interest/onboarding path uses **pg_trgm
   string-similarity** (`convergeDomain` → `findFuzzyCanonicalMatches`). The
   **user-authored question path (`POST /api/questions`) uses neither** — it categorizes
   blind, so author-submitted questions are the most likely source of duplicate sibling
   domains. (Not a bug per se, but an asymmetry worth noting before tuning.)
3. **`resolveCanonicalSubcategoryWithLLM` (`src/lib/llm.ts:1231-1277`) appears
   dead/unused** — no caller found by grep. The live reconcile is
   `reconcileProposedDomain` in `categorization.ts`. (Reported by the categorizer
   sub-search; flagged, not removed.)
4. **`broad_category` denormalized in three places** (`Question`, `GeneratedQuestion`,
   `PLAYER_MASTERY`) and re-normalized independently at each write boundary
   (`normalizeBroadQuestionCategoryOrDefault`, `normalizeBroadCategory`,
   `broadCategoryDisplayName`). Drift risk across these copies if the normalizers ever
   diverge.

### Re-literalization anti-pattern (the hex-literal parallel)

Hardcoded broad-category string lists exist in the render layer and are matched against
data rather than read from a single canonical source:
- `DOMAIN_COLORS` and `SECTION_LABEL_OVERRIDES` literal maps keyed by broad-category
  strings (`src/components/knowledge/PortraitCircles.tsx:48-75`).
- `STABLE_BROAD_CATEGORIES`, `BROAD_CATEGORY_ALIASES`, and the literature regex list
  (`src/lib/knowledge/broad-category.ts:1-45`).
These are the literal-string analog of the known hex-literal drift: the set of valid
broad categories is re-declared in code rather than sourced from one place, so adding a
broad category means editing multiple literal lists.

---

## Not found

- **A stored category→broad_category edge** (FK, `parent_id`, or join table): **not found**
  — confirmed absent (grep over `src/server/db/schema.ts`).
- **A `broad_category` column on `MASTERY_EVENTS`:** not found (the event ledger keys on
  `canonical_subcategory` only, `schema.ts:458-499`).
- **An enforced 3-question minimum before a subcategory surfaces on the portrait:**
  **not found as a surfacing threshold.** Searched query (`knowledge.ts`) and render
  (`PortraitCircles.tsx`, `page.tsx`); the only gates are `answered > 0` to populate
  per-domain stats (`knowledge.ts:467`) and a *count-badge* visibility guard
  (`authoredAnsweredCount > 0 && tier !== 'establishing'`, `PortraitCircles.tsx:192-195`).
  The circle itself surfaces with any points; declared interests surface at 0
  (`page.tsx` count floor). The PRD §9.1 "3-question minimum" is **not enforced** in live
  code. (The `3` references in `src/lib/convergence.ts` and `MIN_INTERESTS` in
  onboarding are unrelated.)
- **PRD §9.1 "canonicalization step" as a single named step:** not found as one step;
  what exists is the three separate mechanisms described above (reconcile LLM, pg_trgm
  converge, write-boundary generic guard).
