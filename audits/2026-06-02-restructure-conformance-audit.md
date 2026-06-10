# Restructure Conformance Audit — D-1 / D-2 / D-3 (2026-06-02)

**Date:** 2026-06-02
**Method:** read-only. Every claim below was verified by reading the cited source file directly; no
code was changed. Companion to `PRD-D-0-PRODUCT-DIRECTION-AND-DECISIONS.md`.
**Scope:** does the shipped code conform to the restructure specs (D-1 follow/Feed split, D-2
niche-match, D-3 house author) and the post-build amended decisions?

## Legend
- ✅ CONFORMS — matches the spec / decision
- ⚠️ DIVERGES — implemented differently than the spec
- 🔴 UNBUILT — spec exists, no implementation
- 🟡 WON'T-FIX — divergence that is a deliberate, accepted decision

---

## 1. Summary

The provenance backbone the restructure depends on is **shipped and conforming**: questions carry an
honest `authored | daily_generated | curated_sent` source, forwarded LLM questions never accrue author
credit, and the aside line is provenance-labeled. **Two real divergences** remain: the **house /
editorial author is unbuilt** (D-3), and the **feed verb surfaces a "wrote vs sent" label** that can
overstate authorship on the broadcast path. Two further items are **deliberate won't-fix** decisions,
and there is one **latent guard requirement** (house-attribution) that should be locked with a test
before D-3 is built.

| # | Area | Status |
|---|------|--------|
| 2.1 | Authored-vs-curated provenance (send path) | ✅ CONFORMS |
| 2.2 | Aside provenance labeling | ✅ CONFORMS |
| 2.3 | Send difficulty travels with the question | ✅ CONFORMS (partial scope — see note) |
| 3.1 | House / editorial author | 🔴 UNBUILT |
| 3.2 | Feed verb "wrote vs sent" label | ⚠️ DIVERGES |
| 4.1 | Broadcast rolls off after unfollow | 🟡 WON'T-FIX |
| 4.2 | `editorial` aside copy ("Between us!") | 🟡 WON'T-FIX (placeholder, flagged) |
| 5 | House-attribution guard | ⚠️ LATENT REQUIREMENT (untested) |

---

## 2. What conforms

### 2.1 Authored-vs-curated provenance — ✅ CONFORMS
The send route materializes a forwarded LLM question with **no author** and a distinct source, so
credit never flows to the forwarder:

```
src/app/api/questions/send/route.ts:163-172
  // (creatorId stays null so author/curator credit never accrues to the
  // forwarder), and source is 'curated_sent' so it is queryably distinct from
  // both authored questions and daily-generated ones.
      creatorId: null,
      ...
      source: 'curated_sent',
```

The schema's `source` column carries the three honest values:

```
src/server/db/schema.ts:254
  source: text('source').$type<'authored' | 'daily_generated' | 'curated_sent'>()...
```

### 2.2 Aside provenance labeling — ✅ CONFORMS
The aside ("between us" line) is labeled by provenance and gated by relationship — a human author's
aside is relational and gated to friends; a machine-origin aside is editorial and ungated:

```
src/lib/questions-types.ts:47-50
  export type InsideJokeKind = 'relational' | 'editorial';
  export const INSIDE_JOKE_LABELS: Record<InsideJokeKind, string> = {
    relational: 'Between us friends',
    editorial: 'Between us!', // PLACEHOLDER copy — flagged for product sign-off
  };
```

Selector: `src/server/questions/inside-joke.ts` — null `creatorId` → `editorial`, no friend check;
human author → `relational`, shown to author + friends.

### 2.3 Send difficulty travels with the question — ✅ CONFORMS (partial scope)
The forwarded question keeps the source question's difficulty estimate rather than recomputing it:

```
src/app/api/questions/send/route.ts:179-181
  difficultyEstimate: generated.difficultyEstimate === 'accessible' || ... ? generated.difficultyEstimate : null,
```

> Scope note: only `difficultyEstimate` is carried; `llmDifficulty` / `calibratedDifficulty`
> (`schema.ts:272-274`) are not. See amended decision 4.1 in `PRD-D-0`.

---

## 3. Divergences

### 3.1 House / editorial author — 🔴 UNBUILT

> **STALE (2026-06-10):** the house author has since shipped — `source='house_authored'`
> questions exist, `pickHouseQuestions` serves them into the Daily Five
> (`src/server/db/queries/daily.ts:1194`), and a `house-authorship` smoke script exists.
> The finding below is preserved as the historical record; re-verify Invariant H-1 (§5)
> against the shipped implementation rather than treating this section as current.
D-3 specifies a first-class, labeled house author. None of it is implemented:
- No house identity constant (D-3 expects a single `{ id, displayName: 'Joshing', label: 'Editorial' }` source of truth) — absent from `src/`.
- `source` enum is **not** widened to include `'house_authored'` (`schema.ts:254` lists only the three).
- No `Joshing` + `Editorial` badge rendering.
- Null-author questions still resolve through the generic person fallback (see 3.2 / §5).

This is expected: D-3 is a **spec-only deliverable** that depends on D-1 (follow model) and D-2
(niche-match), and is correctly held until those land.

### 3.2 Feed verb "wrote vs sent" label — ⚠️ DIVERGES
The surfaced feed verb collapses provenance into a **wrote-vs-sent** framing:

```
src/components/FeedList.tsx:242-251
  export function feedSourceVerb(sourceType, questionSource): string {
    if (sourceType === 'direct_sent') {
      return questionSource === 'authored' ? 'wrote you this' : 'sent you this'
    }
    if (sourceType === 'authored_shared') return 'wrote this'
    if (sourceType === 'thumbs_upped') return 'liked this'
    return 'answered this'
  }
```

The **direct-send** path conforms (it consults `questionSource`: `'wrote you this'` only for `authored`,
`'sent you this'` otherwise). The **broadcast** path (`authored_shared`) returns **`'wrote this'`
unconditionally**, without consulting `questionSource` — so a broadcast of a non-authored (curated /
LLM-origin) question would still read **"wrote this,"** an authorship claim the provenance model would
not support.

> **Flagged as my interpretation of the "wrote-vs-sent label" divergence** (the prompt named it
> tersely). The concrete, code-grounded finding is the unconditional `'wrote this'` on the
> `authored_shared` branch. Confirm this is the intended reading before treating it as the canonical
> divergence statement.

---

## 4. Deliberate won't-fix decisions

### 4.1 Broadcast rolls off after unfollow — 🟡 WON'T-FIX
Unfollowing does not retroactively purge an already-surfaced broadcast from the Feed; it rolls off
naturally. Accepted: retroactive removal isn't worth the cost, and an already-seen broadcast is not a
leak. Future broadcasts stop because fan-out is followers-only (`PRD-D-1-…` Decision 2). Recorded in
`PRD-D-0` §4.2.

### 4.2 `editorial` aside copy ("Between us!") — 🟡 WON'T-FIX (placeholder, flagged)
The editorial-aside copy is a self-flagged placeholder (`questions-types.ts:50` —
`// PLACEHOLDER copy — flagged for product sign-off`). Functionally correct; copy pending product
sign-off. Not a conformance failure.

---

## 5. Latent requirement — house-attribution guard

D-3 carries **Invariant H-1**: no code path may resolve a house question to a real `users` row or to
the generic person fallback. The fallback that the invariant must defend against is live today:

```
src/server/feed/get-feed-page.ts:84
  function displayName(user, fallback = 'A friend') { ... return fallback; }
```

Null-author questions currently resolve to **`'A friend'`** — exactly the peer-impersonation outcome
H-1 forbids for house questions. Existing tests cover the *aside* label
(`src/server/questions/__tests__/inside-joke.test.ts`) and feed *eligibility*
(`src/server/feed/__tests__/visibility.test.ts`) for null authors, but **no test asserts that a
null/house author never renders as `'A friend'` or a `users` row.**

**Recommendation (latent, do at D-3 build time):** when the house author lands, replace the `'A friend'`
fallback for house-origin questions with the house constant and lock H-1 with a regression test. Until
D-3 is built this is a documented latent requirement, not a live bug (no house questions exist yet).

---

## 6. Verdict

The restructure's provenance foundation conforms. Nothing here blocks shipping the built capabilities.
Before **D-3 (house author)** is built: (a) resolve the broadcast `'wrote this'` divergence (3.2), and
(b) implement Invariant H-1 with a regression test (§5). The open **Option B** thread (aside amplifying
a human `creatorNote`) is tracked in `PRD-D-0` §5 and `DECISIONS.md`.
