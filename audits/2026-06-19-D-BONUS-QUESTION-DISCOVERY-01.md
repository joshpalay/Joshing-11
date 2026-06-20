# D-BONUS-QUESTION-DISCOVERY-01 — Findings

**Date:** 2026-06-19
**Type:** Discovery / audit (D-prompt). **Read-only — no code changed.**
**Goal:** Ground truth on the **+2 bonus question** mechanic (D-4 §B "+2 reframe"), so a follow-up B-prompt can standardize how bonus questions are generated, counted, labeled, attributed, and rendered. Live code is the source of truth; every claim below cites a file path + line.

**Headline:** The D-4 §B "+2 reframe" **is built and live** — the literal `friend_answered`→bonus path the PRD describes as the *current* state has already been retired. Live bonus = a freshly-generated accessible question in a `territory ∪ activity` domain, presence-attributed ("FROM {NAME}'S KNOWLEDGE"). The PRD-D-4 spec's "Verified facts" table (lines 40-53) is **stale** — it describes a pre-reframe codebase that no longer exists.

The user's concern (5-vs-7 divergence, undifferentiated dots) is **real and precisely locatable**: bonus-ness has **no single source of truth**; "is this slot a bonus?" is re-derived from `presence_source_id` in ~5 places, and the three surfaces disagree by construction — the home card is hard-pinned to 5, the live session and recap derive 5–7 from `slots.length`.

> Side note (not part of this audit's scope, flagged for records): **CLAUDE.md's migration head is stale** — it cites `0061`, live head is `drizzle/0082_question_bank_added_at_idx.sql`.

---

## Phase 0 — Inventory (files touching the +2, by layer)

**1. Generation / selection**
- `src/server/db/queries/friend-presence-domains.ts` — the territory ∪ activity aggregate + pure ranker (`getFriendDomainsForBonus`, `rankFriendDomainsForBonus`).
- `src/server/daily/queue-orchestrator.ts:578-621` — appends bonus slots after the core 5; `toBonusPresence` (`:640-647`).
- `src/server/daily/generate-questions.ts:1749-1826` — `generateBonusQuestionsForDomains` (bank-first → Sonnet, accessible).
- `src/server/profile/recently-exploring.ts` — `selectRecentlyExploring` (activity signal, reused).
- `src/server/db/queries/knowledge.ts` — `getKnowledgePageData` (territory signal, reused).

**2. Schema / data layer**
- `src/server/daily/types.ts:24-95` — `queueSlotSchema` (Zod, source of truth); `presence_source_id/_name/_extra_count` (`:47-55`); `DAILY_BONUS_SLOT_MAX = 2` (`:153`), `DAILY_QUEUE_SIZE = 5` (`:109`).
- `src/server/db/schema.ts:776-794` — `dailyQueues.slots` is **JSONB** (`:782`). **No dedicated bonus column.** Drizzle, not Prisma (confirmed: `pgTable`).
- `src/server/db/schema.ts:885-905` — `dailyRefineDecisions.friendId` "Set only for friend_expansion (the bonus source friend)" (`:894`) — a downstream denormalization.

**3. Server queries / endpoints**
- `src/server/db/queries/daily.ts:927-968` — `BonusPresence` type + `buildPresenceSlot` (the only place presence fields are written onto a slot).
- `src/app/api/daily/status/route.ts` — feeds the **home card**.
- `src/app/api/daily/summary/route.ts` → `src/server/db/queries/daily-summary.ts` — feeds the **recap**.
- `src/app/api/daily/queue/route.ts` (serialize) → feeds the **live session**.
- `src/server/db/queries/refine.ts:216`, `src/server/refine/derive.ts:18-41` — re-derive bonus-ness for the Refine section.

**4. Client / render**
- `src/app/daily/page.tsx` — live session container; computes `queueLength` (`:374`), passes dots (`:830-834`), routes presence to thread (`:495-496,560-561`).
- `src/components/play/GeometricProgress.tsx` — the **live progress dots**.
- `src/components/play/GameplayChat.tsx:384-465,212-215` — in-thread **bonus card** (gold "✦ Bonus item" / "FROM {NAME}'S KNOWLEDGE").
- `src/app/daily/summary/page.tsx:191-201,367-389` — **recap** count + `ResultDots`.
- `src/components/TodaysFiveCard.tsx` — the **home card** ("Today's Five").

---

## Phase 1 — Answers

### A. Generation & selection

**Q1 — Where generated; is it `territory ∪ activity` with the ranking?** Yes. `getFriendDomainsForBonus` (`friend-presence-domains.ts:208-265`) loops followees, reads territory (`isTerritoryDomain` = declared/declaredInterest/demonstrated, `:181-184`) and activity (`selectRecentlyExploring`, `:239-241`), then ranks. The ranking is exactly Both > territory-only > activity-only, recency, then strength:

```ts
// friend-presence-domains.ts:65-69, 156-165
const SIGNAL_RANK = { both: 0, territory: 1, activity: 2 };
...
const sig = SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal];
if (sig !== 0) return sig;
const rec = recencyDesc(a.lastActivityAt, b.lastActivityAt);
if (rec !== 0) return rec;
if (a.strength !== b.strength) return b.strength - a.strength; // tie-break, not a gate
return a.domain.toLowerCase().localeCompare(b.domain.toLowerCase());
```

**Q2 — Graceful shrink (0/1/2), never pads own domains, never N<5 backstop?** Confirmed on all three counts:
- 0 when no follows: `if (following.length === 0) return [];` (`friend-presence-domains.ts:221`); pool is friend-sourced only (docstring `:194-197`).
- The orchestrator appends only what generated, in a `try/catch` that degrades to core-only, and is **not** counted toward `achieved`/the floor: `queue-orchestrator.ts:595-621`. Comment `:578-590`: *"Purely additive: NOT counted toward DAILY_QUEUE_SIZE / the achieved backstop, never triggers the N<5 generation top-up, and never pads with the viewer's own domains."*
- Non-accessible bank pick → `row = null` (slot shrinks, no downgrade): `generate-questions.ts:1792-1795`.

**Q3 — Fresh-generated, no literal leak?** Fresh only. `generateBonusQuestionsForDomains` (`generate-questions.ts:1781-1812`) pulls from the generated bank (`pickBankPicksForDomains`) or Sonnet (`generateDailyQuestions`) — never the canonical `questions` table. It explicitly guards against serving the **viewer's own** authored question (`avoidAuthoredTexts`, `:1773,1788`) and recently-answered canonical texts (`:1764,1775`). The slot is `source: 'bot'` with `generated_question_id` (`buildPresenceSlot`, `daily.ts:955-956`). **No path serves a friend's literal question as a bonus.**

### B. Data model & attribution integrity

**Q4 — Exact fields marking bonus + storing the friend.** No dedicated column; it's JSONB inside `dailyQueues.slots`. Within a slot:
- **Marks bonus:** the *presence* of `presence_source_id` (`types.ts:47`; docstring `:42-43`: *"The presence of these fields is what marks a slot as a bonus slot."*). Every consumer keys off it (`refine/derive.ts:24`, `refine.ts:216`, `daily/page.tsx:44`).
- **Stores the friend:** `presence_source_id` (an **ID**) + `presence_source_name` (**denormalized name** captured at build time) + `presence_source_extra_count` (`types.ts:47-55`). So it's **both** — ID *and* a name snapshot. Name is frozen at generation; a later display-name change won't propagate to an already-built queue.

**Q5 — Honest attribution (machine content never renders as a person)?** Honest. Copy is presence-framed, never authorship: `bonusSourceLabel` → `FROM {NAME}'S KNOWLEDGE` / `FROM {NAME} + OTHERS' KNOWLEDGE` (`GameplayChat.tsx:212-215`); banner reads "✦ Bonus item" (`:446-453`); mute affordance "This is {first name}'s bag but not mine" (`daily/page.tsx:548,624`). The result-reveal `creatorName` is set **only** for `source==='friend'||'house'` (`daily/page.tsx:525`), so a bonus reveal carries **no** author name and no relational "{name} carries this one" sublabel (`WRONG_NAMED_SUBLABEL`, `GameplayChat.tsx:184-188`, gated on `creatorName`). **No "answered/wrote this" leakage found.**
- *Minor copy divergence (not a violation):* spec calls for "from {Name}'s **world**" / "from a domain {Name} knows"; code says "**knowledge**." Both honest. One wrong-answer friend sublabel does use "world" (`:185`) but applies to friend-authored, not bonus.

**Q6 — Does friend identity survive every boundary?** Generation → queue → **live session**: yes (`daily/page.tsx:495-496,560-561` → `GameplayChat`). Generation → **recap**: **NO — dropped.** `QuestionRecap` (`daily-summary.ts:49-83`) has `authorName/authorId/authorNote/authorIsHouse` but **no presence field**, and the mapper sets `authorName` only for friend/house (`:247`). So in the recap a bonus question is an anonymous "a few were new" card — the "from {Name}'s knowledge" presence is lost at the recap boundary. This is exactly the repo's recurring "correct on server, dropped at render" failure mode.

### C. Progress dots

**Q7 — Live dot count: hardcoded or derived?** **Derived.** `GeometricProgress` renders `Array.from({ length: total })` (`GeometricProgress.tsx:16`), and the caller passes `total={queueLength}` where `queueLength = queue.slots.length > 0 ? queue.slots.length : DAILY_QUEUE_SIZE` (`daily/page.tsx:374,831`). Comment `:371-373`: *"Use the ACTUAL queue length, not DAILY_QUEUE_SIZE."* So the live track shows **5–7 dots** (core + bonus).

**Q8 — Do bonus dots have any visual distinction?** **None.** `GeometricProgress` knows only `results: Record<number,'correct'|'wrong'|'expired'>` and `current`. It has no concept of bonus; every dot is the same `●`/`○` glyph (`:40`), same color ramp (`:22-28`). The `results` map (`daily/page.tsx:603-612`) is built purely from `answer_state`, with no `presence_source_id` branch. The bonus **card** in the thread is distinct (gold/navy "Bonus item"), but the **dot** representing it is not. (Same is true of the recap `ResultDots` — Q11.)

**Q9 — Full dot state machine + bonus orthogonality.**
- `GeometricProgress` (live): `current` (larger, full opacity), `done`+correct (green `--game-correct`), `done`+wrong (`--game-wrong-strong`), `done`+expired (muted), queued (hollow `○`, dim). **Note:** `'expired'` is in the type but the live `results` map only ever emits `'correct'|'wrong'` (`daily/page.tsx:608`) — expired is effectively dead here.
- `ResultDots` (recap): correct / wrong / skipped (`summary/page.tsx:375-379`).
- `TodaysFiveCard` (home): correct / incorrect / skipped / unanswered (`TodaysFiveCard.tsx:250-265`).
- **Bonus-ness is orthogonal to — and absent from — all three.** It is not a state any dot renderer can express; nothing collides, because bonus simply isn't represented in the dot layer.

### D. Surface parity

**Q10 — Home card: does it know about the +2?** **No.** `TodaysFiveCard` is hard-pinned to 5 in every place: `Array.from({ length: 5 })` (`:247`), `answered = min(questionsAnswered, 5)` (`:172`), `aria-label/of 5 answered` (`:190,245`), fallback `questionsRemaining: 5` and a 5-length `slotOutcomes` (`:50-57,67`). Forward copy: `Five new ${resetDayTime}` / `'Five new tomorrow'` (`:187-189`). It shows **5 regardless of bonus.** Its feed (`/api/daily/status`) reinforces this — see Q11/Q15.

**Q11 — Recap `X / Y` denominator.** `Y = summary.questions.length` (`summary/page.tsx:195`), and `getDailySummary` maps `recaps` over **all** slots incl. bonus (`daily-summary.ts:231`), with `totalCorrect = slots.filter(answer_state==='correct').length` (`:278`). So the recap denominator is `slots.length` = **5–7** — this is the "7/7" surface. `ResultDots` renders one dot per question, **no bonus distinction** (`:370-387`). `ShareResultsButton` shares "X/total" with the same 5–7 total (`:200,396`).

**Q12 — For the SAME daily set, what does each surface show, and why they diverge.**

| Surface | Count shown | Source in code |
|---|---|---|
| **Home card** | **5** (always) | `status/route.ts` hardcodes `total = DAILY_QUEUE_SIZE` (`:63,79`), caps `questionsAnswered` at 5 (`:64`), and `buildSlotOutcomes` builds a length-5 array that **skips `idx >= DAILY_QUEUE_SIZE`** (`:18,21`). `TodaysFiveCard` then hard-pins 5 again. |
| **Live session** | **5–7** | `queueLength = slots.length` → `GeometricProgress total` (`daily/page.tsx:374,831`). |
| **Recap** | **5–7** | `summary.questions.length` over all slots (`daily-summary.ts:231`, `summary/page.tsx:195`). |

**The divergence, in code terms:** the status route is the *only* read path that deliberately truncates bonus to 5 (`buildSlotOutcomes`'s `idx >= DAILY_QUEUE_SIZE → continue`, plus `Math.min(answered, DAILY_QUEUE_SIZE)`), while the queue and summary read paths use the raw `slots.length`. Bonus is never modeled as a count anywhere — each surface independently decides whether to include slots ≥ index 5.

### E. Canon & consistency

**Q13 — Color-alone meaning?** The in-thread bonus card does **not** rely on color alone — it carries a text label ("✦ Bonus item", "FROM {NAME}'S KNOWLEDGE", `GameplayChat.tsx:452,465`) and a glyph. **However**, every dot renderer conveys state (correct/wrong/skipped) **by color/fill alone** with no shape/label differentiation (`GeometricProgress.tsx:22-40`, `ResultDots` `summary:375-379`, `TodaysFiveCard:250-281`). Bonus is not color-coded because it's not coded at all in the dots. If a future bonus-dot distinction is added, it must not be color-only.

**Q14 — Triangle motif as a functional signal?** **No violation.** Dots are `●`/`○` circles (`GeometricProgress.tsx:40`) and `rounded-full` spans (recap/home). Triangles appear only as a **decorative brand background** ("Brand triangle pattern… tiled behind the game", `daily/page.tsx:808-810`) — not a progress/bonus signal. (`GeometricProgress` is a misnomer — it renders circles, not geometry.)

**Q15 — Single source of truth for bonus count/identity?** **No — computed independently in ≥5 places**, each re-deriving from `presence_source_id` (or ignoring it):
1. `queue-orchestrator.ts:595-614` — *creation* (the only true source; appends ≤2 bonus slots).
2. `daily/page.tsx:374` — `queueLength = slots.length` (live total, implicitly bonus-inclusive).
3. `status/route.ts:18-28,62-64` — bonus **excluded** (forces 5).
4. `daily-summary.ts:231,276-278` — bonus **included** (5–7).
5. `refine.ts:216` (`slots.filter(s => s.presence_source_id).length`) and `refine/derive.ts:18-41` (re-derives bonus + friend for `friend_expansion`).

There is **no `bonusCount` field, helper, or shared selector.** That absence is the root cause of the 5-vs-7 divergence.

---

## Phase 2 — Synthesis

### 1. System map
On queue build, `getFriendDomainsForBonus(userId, 2, restingDomains)` (`friend-presence-domains.ts`) aggregates, across everyone the viewer follows, each followee's territory (declared+demonstrated, visibility-gated) and recent activity, merges per domain into Both/territory/activity, ranks Both > territory > activity (recency → strength), and returns ≤2 domains. The orchestrator (`queue-orchestrator.ts:595-621`) generates one fresh accessible question per domain (`generateBonusQuestionsForDomains` → bank-first/Sonnet), and `buildPresenceSlot` (`daily.ts:942-968`) appends them as `source:'bot'` slots carrying `presence_source_id/_name/_extra_count` — the *only* mark of bonus-ness, persisted into the JSONB `slots` of one `DailyQueue` row. From there it fans out to three independent readers: the **live session** (`/api/daily/queue` → `daily/page.tsx`) shows all 5–7 with a distinct gold bonus *card* but undifferentiated *dots*; the **recap** (`/api/daily/summary` → `daily-summary.ts`) counts all 5–7 but **drops the friend attribution** (no presence field on `QuestionRecap`); the **home card** (`/api/daily/status` → `TodaysFiveCard`) deliberately truncates to a fixed 5 and shows no bonus at all.

### 2. Divergence table

| Surface | Count shown | Dots distinct? | Friend attributed? | Source field used |
|---|---|---|---|---|
| **Home card** (`TodaysFiveCard`) | **5** (fixed) | n — hard 5 dots, color-only state | **n** — bonus invisible | `status` `total=DAILY_QUEUE_SIZE`; `buildSlotOutcomes` skips `idx≥5` |
| **Live session** (`GeometricProgress`) | **5–7** (`slots.length`) | **n** — dots identical (card *is* gold/labeled) | **y** (in card: "FROM {NAME}'S KNOWLEDGE"); dots n | `presence_source_name/_extra_count`; dots from `answer_state` only |
| **Recap** (`ResultDots` + `X/Y`) | **5–7** (`questions.length`) | **n** — dots identical | **n** — `QuestionRecap` has no presence field | `slots.length`; attribution dropped at boundary |

### 3. Source-of-truth finding
Computed **N = 5+ times** (sites listed in Q15). Truth = `queue-orchestrator.ts:595-614`. Every other site re-derives "bonus?" from `slot.presence_source_id` and reaches a different total because each independently chooses to include or exclude slots beyond index 5. No shared `bonusCount`/selector exists.

### 4. Canon / attribution risks
- **R1 (attribution drop — highest):** bonus friend attribution is lost in the recap (`daily-summary.ts` `QuestionRecap` has no presence field; `:247`). A "from {Name}'s knowledge" question becomes an anonymous card.
- **R2 (copy drift):** code says "knowledge"; spec says "world"/"a domain {Name} knows" (`GameplayChat.tsx:214-215`). Honest, but inconsistent with PRD-D-4 §123, §302.
- **R3 (dots state is color-only):** all three dot renderers encode state by fill alone — a latent color-alone-conveys-meaning issue that any future bonus-dot work must not extend.
- **No triangle violation; no honest-attribution violation** (bonus never renders as authored/answered).

### 5. Open forks (surfaced, not decided)
- **F1 — Bonus distinction in the dot track.** Today dots are undifferentiated on all three surfaces. If separated (separator, sub-group, distinct fill), it must not be color-only (R3) — a shape/label/gap must carry it. *Open.*
- **F2 — Should the home card reflect bonus?** Today: hard 5 (`status/route.ts` truncates; `TodaysFiveCard` re-pins). Options: show 7 / "5 + 2 from friends" / keep 5 with bonus revealed only in-session. *Open.*
- **F3 — Canonical denominator.** Is the set "5 + additive bonus" (home's model) or "5–7 as one set" (session/recap's model)? This drives every count and the "Five new tomorrow" copy. The two models are both in the codebase simultaneously — that *is* the bug. *Open.*
- **F4 — Attribution on a bonus dot/recap.** Where "from {Name}'s knowledge" appears beyond the live card — specifically whether to plumb a presence field into `QuestionRecap` (R1) — without implying authorship. *Open.*
- **F5 — Single source of truth.** Where `bonusCount`/attribution should be computed once and consumed everywhere (candidate: a shared selector over `slots` keyed on `presence_source_id`, replacing the 5 ad-hoc derivations). *Open.*

---

**Done-when check:** Phase 0 inventory ✓ · all 15 questions answered with file:line ✓ · divergence table filled and 5-vs-7 root cause named (status route truncates bonus; no shared count) ✓ · F1–F5 left open ✓ · every claim cites code, and the stale PRD "Verified facts" table is flagged rather than trusted ✓.
