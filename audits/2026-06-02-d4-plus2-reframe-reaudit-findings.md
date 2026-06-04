# D-4 +2 Reframe Re-audit — Daily Five +2 (territory ∪ activity) (2026-06-02)

**Date:** 2026-06-02
**Method:** read-only. Every claim below was verified by reading the cited source file directly; no
code was changed. Companion re-audit to `audits/2026-06-02-restructure-conformance-audit.md`,
triggered because D-4 Stage 2 changed a conformance-audited surface (the Daily Five +2).
**Scope:** does the D-4 §B reframe — fresh, generated, accessible questions in domains drawn from the
territory ∪ activity of people the viewer follows — preserve the invariants `PRD-D-1` §D locked around
the +2? Specifically: core-5 integrity, the graceful-shrink invariants, the distinctness from the N<5
generation backstop, and the no-machine-as-person / no-mastery-to-non-human guarantees adjacent to the
queue.

> **Spec note.** `PRD-D-1` §D (lines 119–138) describes the *literal* +2: a friend-answered canonical
> question with **answerer** attribution, a `calibratedDifficulty`/`llmDifficulty` accessibility
> *filter*, and `getKnowledgeBase` relevance tiering. The amended `PRD-D-4` §B **deliberately repoints**
> that path (fresh generation, presence attribution, accessibility as a generation *target*). So the
> three §D mechanics being *gone* is intended, not a regression — this audit confirms the **invariants**
> §D shared with the surrounding queue survived the repoint.

## Legend
- ✅ CONFORMS — preserves the locked invariant
- ⚠️ DIVERGES / OPEN — implemented differently than the privacy posture, or an unresolved question
- 🔴 BROKEN — invariant violated
- 🟡 WON'T-FIX — divergence that is a deliberate, accepted decision

---

## 1. Summary

The reframe **preserves every load-bearing invariant** `PRD-D-1` §D locked around the +2: it stays
purely additive (never counted toward the core 5 or the achieved/shortfall math), never routes a bonus
shortfall through the N<5 generation backstop, shrinks gracefully without padding from the viewer's own
domains, and never claims a machine question was authored or answered by a person. The literal path,
the old accessibility filter, and the KB relevance tiering are cleanly retired per the amendment.

**One real open question** remains: the bonus domain pool is gated only by the **owner-set, per-domain**
`isHidden` flag (which hides only `private` domains), **not** by the viewer-relationship gate or the
profile's section-level `knowledge_base` visibility that the friend's profile applies. A `friends`-only
domain can therefore seed a one-directional follower's +2 — a presence-level over-share the profile
would not make.

| # | Invariant / surface | Status |
|---|---------------------|--------|
| 2.1 | Core-5 integrity (+2 not counted toward DAILY_QUEUE_SIZE) | ✅ CONFORMS |
| 2.2 | +2 never routes through the N<5 generation backstop | ✅ CONFORMS |
| 2.3 | Graceful shrink (clean 5 / ≤1 / never pad with my own domains) | ✅ CONFORMS |
| 2.4 | Fresh accessible generation; literal path + filter + KB tiering retired | ✅ CONFORMS |
| 2.5 | Presence attribution replaces answerer fields | ✅ CONFORMS |
| 2.6 | No-machine-as-person (no authored/answered claim on a generated bonus) | ✅ CONFORMS |
| 2.7 | No-mastery-to-non-human | ✅ CONFORMS (inference — see note) |
| 3.1 | Bonus pool ignores section-level / relationship visibility | ⚠️ OPEN QUESTION |

---

## 2. What conforms

### 2.1 Core-5 integrity — ✅ CONFORMS
The bonus block runs **after** the core slots are placed and **after** the achieved/backstop math, and
the core loops cap themselves at `DAILY_QUEUE_SIZE`:

```
src/server/daily/queue-orchestrator.ts:271,275
  for (const pick of housePicks.slice(0, DAILY_QUEUE_SIZE - position)) { ... }
  for (const question of generatedForQueue.slice(0, DAILY_QUEUE_SIZE - position)) { ... }
```

The achieved/shortfall counters that drive the core size sum only authored + house + generated — the
bonus is absent from both:

```
src/server/daily/queue-orchestrator.ts:193,216
  const shortfall = DAILY_QUEUE_SIZE - (authored.length + housePicks.length + dedupedGenerated.length);
  const achieved = authored.length + housePicks.length + generatedForQueue.length;
```

The bonus slots are appended only afterward (`queue-orchestrator.ts:290-304`), so the queue is core
(≤5) + 0–2 bonus = 5–7. Stated as the invariant in the block comment (`:280-289`).

### 2.2 +2 never routes through the N<5 generation backstop — ✅ CONFORMS
The N<5 top-up and the `generation_failed` / short-queue handling operate only on the core generation,
all **before** the bonus block:

```
src/server/daily/queue-orchestrator.ts:194,229,245
  if (shortfall > 0 && Date.now() - startedAt < TOP_UP_TIME_BUDGET_MS) { ... }   // core top-up
  if (achieved === 0) { ... throw DailyQueueFillError('generation_failed', …) }  // core-only
  if (achieved < DAILY_QUEUE_SIZE) { ...persisted short queue log... }           // core-only
```

Bonus generation is a wholly separate function whose miss-path returns *fewer* entries rather than
escalating; the orchestrator simply appends what it gets:

```
src/server/daily/generate-questions.ts:1252-1255 (doc) ; 1305-1313 (shrink-on-miss)
  // A generation miss for a domain simply yields fewer entries (graceful shrink) — domains are
  // never swapped and this never routes through the orchestrator's N<5 core backstop.
```

### 2.3 Graceful shrink — ✅ CONFORMS
- **Clean 5 when no eligible friend domains:** the pool is empty when the viewer follows no one, and is
  friend-sourced only (never the viewer's own domains):

```
src/server/db/queries/friend-presence-domains.ts:187-198
  // The pool is friend-sourced only — it never includes the viewer's own domains, so a
  // viewer who follows no one (or no one with eligible domains) gets an empty pool (clean 5).
  const following = await getFollowing(viewerUserId);
  if (following.length === 0) return [];
```

- **≤1 with one domain / never backfill:** `rankFriendDomainsForBonus` caps at `limit`
  (`friend-presence-domains.ts:158` slice), and `generateBonusQuestionsForDomains` returns at most one
  entry per requested domain, never substituting another domain or LLM/authored core content
  (`generate-questions.ts:1305-1313`). The orchestrator appends exactly `generatedBonus.length` slots
  (`queue-orchestrator.ts:299-303`).
- **Non-accessible bank pick shrinks, never downgrades** (`generate-questions.ts:1283-1286`).

### 2.4 Fresh accessible generation; literal path + filter + KB tiering retired — ✅ CONFORMS
Each bonus is freshly generated bank-first → Sonnet, targeting accessible via `'normal'`:

```
src/server/daily/generate-questions.ts:1273-1302
  const bankPicks = await pickBankPicksForDomains(userId, [domain], 'normal', undefined, null, previousFactKeys)…
  } else if (!row) { const generated = await generateDailyQuestions([domain], 1, userId, …, 'normal', …); … }
```

The literal-path symbols `PRD-D-1` §D introduced — `selectBonusAnswererPicks`, `pickBonusAnswererSlots`,
`createDailyQueueItemFromAnswerer`, `AnswererPick`, `BonusAnswererRow`, and the
`calibratedDifficulty`/`llmDifficulty` accessibility filter and the `getKnowledgeBase` relevance tiering
— are **absent** from `src/server/db/queries/daily.ts` (verified by grep: no matches). The +2 now serves
only fresh questions, never a friend's literal answered question (which moved behind the Lately
milestone click-through, D-4 §A). This is the intended D-4 repoint, not drift.

### 2.5 Presence attribution replaces answerer fields — ✅ CONFORMS
`QueueSlot` retired `answerer_id` / `answerer_name` and added presence fields (Zod schema is the source
of truth):

```
src/server/daily/types.ts:47-55
  presence_source_id: z.string().optional(),
  presence_source_name: z.string().nullish(),
  presence_source_extra_count: z.number().int().optional(),
```

The bonus-slot creator stamps them (`src/server/db/queries/daily.ts:752,782-784`), and the player UI
renders the gentle "from {Name}'s world" / "{Name} and others":

```
src/components/play/GameplayChat.tsx:261-282
  {presenceSourceName ? ( … FROM {firstNameFrom(presenceSourceName)}{extra>0 ? '' : '’s'} {extra>0 ? 'and others' : 'world'} … ) : null}
```

`src/app/daily/page.tsx:300-301,351-352` passes `presence_source_name` through and the badge detector
keys on it (`:27`).

### 2.6 No-machine-as-person — ✅ CONFORMS
The bonus question is LLM-generated (`source:'bot'`, `generated_question_id`;
`src/server/db/queries/daily.ts:775,752`). The slot's question message sets **`creatorName: null`**
(`src/app/daily/page.tsx:300,351`), so GameplayChat's author block ("{name} gave you this",
`GameplayChat.tsx:234-254`) never fires for it. The only attribution shown is the **presence** line,
which names the domain's source — a real followed friend resolved from `getFollowing`
(`friend-presence-domains.ts:197`, surfaced via `toBonusPresence`, `queue-orchestrator.ts:310-317`) —
and frames it as the friend's *world* ("from {Name}'s world"), never as authorship or as having
answered this generated question. No machine is presented as a person, and no person is presented as
the author of a machine question.

### 2.7 No-mastery-to-non-human — ✅ CONFORMS (inference)
A bonus slot is an ordinary `source:'bot'` generated-question slot
(`src/server/db/queries/daily.ts:775`), scored through the same answer path as every other bot slot;
mastery accrues to the viewer (a human) who answers it. The generated question carries no human author,
so no author-credit accrues, and the presence friend is not credited for the viewer's answer.

> Inference note: verified by the slot shape (bot/generated, no `creatorId`), not by re-reading the
> answer route in this pass. The standard bot-slot scoring path is unchanged by D-4, so the guarantee
> holds by construction; a confirming read of `src/app/api/daily/answer/route.ts` at smoke time would
> close it fully.

---

## 3. Open question

### 3.1 Bonus pool ignores section-level / relationship visibility — ⚠️ OPEN QUESTION
The +2 domain pool is built from `getKnowledgePageData(friend.id)` filtered only by the friend's
**owner-set, per-domain** `isHidden` flag, and `isHidden` hides only `private` (or explicitly
de-visible) domains:

```
src/server/db/queries/knowledge.ts:810
  const isHidden = row.visibility === 'private' || row.isVisible === false;
```

```
src/server/db/queries/friend-presence-domains.ts (isTerritoryDomain / activity filter)
  if (domain.isHidden) return false;   // only excludes private; 'friends'-visibility passes
```

`getKnowledgePageData(friend.id)` is **viewer-agnostic** — it takes only the friend's id, so the bonus
pool does not apply (a) the profile's viewer-relationship gating, nor (b) the profile's section-level
`knowledge_base` visibility toggle that the profile page consults
(`src/app/users/[id]/page.tsx` `portrait.sectionSettings.knowledge_base`). Consequence: a domain the
friend set to **`friends`-only** still seeds the +2 of anyone who follows them — including a
**one-directional follower who is not a mutual friend**, and even when the friend has restricted who
sees their knowledge section on the profile.

**Why it's substantive but bounded:** the +2 does not reveal a specific *fact* the friend knows — it
generates a fresh question in the domain and frames it as "from {Name}'s world." But that still reveals
**domain presence** ("Robyn is into jazz"), which is exactly the class of signal the profile's
"Recently exploring" / knowledge surfaces *do* gate. So this is a presence-level over-share relative to
the profile's posture, not a fact leak.

**Recommendation (Open Question — needs product/privacy decision):**
- If the product position is "following someone entitles you to their presence signal," then this is
  intentional and should be recorded as 🟡 WON'T-FIX with a one-line rationale (and the spec amended to
  say so).
- If not, gate `getFriendDomainsForBonus` by the **same** visibility the profile applies — i.e. exclude
  `friends`-only domains for non-mutual followers, and/or honor the section-level `knowledge_base`
  setting — so the +2 never surfaces a domain the friend's own profile would hide from that viewer.

This is the item flagged at the end of D-4 Stage 2; it is the only finding that warrants a decision
before this surface is considered fully conformant.

---

## 4. Verdict

The D-4 §B reframe **conforms** on every queue-adjacent invariant `PRD-D-1` locked: the +2 stays
additive and outside the core-5 math, never escalates through the N<5 backstop, shrinks without padding
from the viewer's own domains, and keeps the no-machine-as-person / no-mastery-to-non-human guarantees
intact. The retirement of the literal path, accessibility filter, and KB tiering is the intended
amendment, not drift. **Nothing here blocks the build.** The single open item (§3.1) is a
presence-visibility decision: confirm that following entitles a viewer to a friend's `friends`-only
domain presence, or gate the bonus pool by the profile's visibility rules before treating the +2 as
fully conformant.
