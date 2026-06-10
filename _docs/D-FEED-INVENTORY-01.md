# D-FEED-INVENTORY-01 — Home Activity Feed Content Inventory (READ-ONLY findings)

**Scope:** Everything that can render in the Home "What's Happening" scrolling feed
(`src/app/page.tsx` → `FromYourFriendsSection` → `src/components/FeedList.tsx` with `unifiedHome`).
**Method:** Live code only. Templates quoted verbatim. No code changed.

---

## 0. How the feed is assembled (orientation)

The Home feed is **three row families merged into one scroll**, then rendered in three layout zones.

**Row families (data sources):**
1. **Feed question cards** — paginated `FeedApiItem`s from `src/server/feed/get-feed-page.ts`, keyed by
   `card_type` ∈ `direct_sent | friend_added | friend_liked | answered_by_you`. Rendered by the
   `feed/*Card` components.
2. **Activity-stream one-liners** — `StreamItem[]` from `buildActivityStream()`
   (`src/server/activity/build-stream.ts`), built by the pure transforms in `src/lib/activity-stream.ts`.
   Three sub-sources: **activity rows** (`activityToStreamItem`), **Lately moments**
   (`momentToStreamItem`), **milestones** (`milestoneToStreamItem`), **convergences**
   (`convergenceToStreamItem`).
3. **Editorial promos** — three home-only `StreamItem`s carrying an `embed`: `common_ground`,
   `recently_expanding`, `add_friends`. Rendered full-bleed via `EditorialPromos.tsx`.

**Layout zones (FeedList render, `FeedList.tsx:1745-1779`):**
- **"For You"** (pinned top) — `kind:'feed'` question cards (sent/broadcast/liked/answered).
- **"From Friends"** (pinned, capped to most-recent few, reveal-in-batches) — milestone bundle cards
  (`expand.kind==='milestone'`).
- **Recency groups** (everything else) — bucketed by `groupItemsByRecency`
  (`src/components/feed/visual.ts`): *Past few hours / Today / Past few days / This week / Past two
  weeks / Past few weeks / Older*. This zone holds ambient activity one-liners, **per-person clusters**
  (`PersonActivityCard`), and the promos (spread evenly).

**Per-person clustering layer:** within a recency bucket, a friend's ≥2 *relationship* events collapse
into one `PersonActivityCard` (`src/components/feed/person-grouping.ts` + `PersonActivityCard.tsx`).
A lone event renders as its raw `ActivityStreamItem`. **This means the same event has TWO rendered
forms — clustered vs. lone — catalogued in §A5.**

---

## A. Event-type catalog

### A1 — Activity-stream rows (`activityToStreamItem`, `src/lib/activity-stream.ts:232-537`)

Line templates are assembled from parts; `{friend}` = actor display name (an actor link), `txt(...)` =
literal. Quoted verbatim from the `line:` arrays.

| Event type | Verbatim line template | `secondLine` | Meaning | Playable? | Class | Fields | Volume |
|---|---|---|---|---|---|---|---|
| `friend_answered_your_question` | `{friend}` + `' got your question'` *(correct)* / `' answered your question'` *(wrong)* | `{domain}` | A friend answered YOUR authored question | No (chevron→"send onward" if `your_question` expand) | relationship (`got_you`) | friend, domain, questionText | **HIGH** (every friend correct-answer fan-out) |
| `niche_match_answered_your_question` | `{friend}` + `' answered your question — someone shares this corner'` | `{domain}` | A stranger answered a question you authored | No | relationship (untagged) | stranger, domain, questionText | Low (opt-in gated; /activities-only, not home-eligible) |
| `niche_match_you_answered` | `'You answered '` + `{friend}` + `"'s question — you found someone"` | `{domain}` | You answered a stranger's authored question | No | relationship (untagged) | stranger, domain, questionText | Low (opt-in gated; /activities-only) |
| `declared_promoted` | `{friend}` + `' opened ' + domain` / `' opened a new domain'` | `{domain}` | A friend opened a new knowledge domain | No (trailing link "See your map") | relationship (untagged) | friend, domain | Low |
| `friend_mastery` | `{friend}` + `` ` reached ${tier} ` `` (or `'a new tier'`) | `{domain}` | A friend reached a mastery tier | No | relationship (untagged) | friend, tier, domain | **DEAD — never written** (see §E) |
| `reaction_received` | `{friend}` + `' reacted to your question'` | `{emoji label}` | A friend reacted to your question | No (trailing "got it" button) | relationship (`reacted`) | friend, reactionEmoji, reactionLabel | Medium |
| `question_curated` | `{friend}` + `' saved your question'` | `{questionText}` | A friend saved/banked your question | No | relationship (`saved`) | friend, questionText | Low |
| `authored_question_shared` | `` `You shared a question with ${count} ${count===1?'friend':'friends'}` `` | `{domain}` | You broadcast a question | No | friend-less (`friendId:null`) | count, domain | **DEAD via writeActivity** (hydrated from feedItems) |
| `received_direct_question` | `{friend}` + `' sent you a question'` | `{questionText}` | A friend sent you a question directly | **Answerable inline** (`answer_direct` action) | relationship (untagged) | friend, questionText, feedItemId | Medium (5/day send cap). *Deduped against the `direct_sent` feed card.* |
| `received_joshing_game` | `{friend}` + `` ` sent you ${title}` `` | — | A friend sent you a Joshing game | No (link Play/See results) | (untagged) | friend, gameTitle | Medium. *Not home-eligible.* |
| `joshing_game_progress` | `{friend}` + `` ` played ${title}` `` | — | A friend played a shared game | No (link "See so far") | friend-less (`friendId:null`) | friend, gameTitle | Medium. *Not home-eligible.* |
| `joshing_game_result` | `` `Everyone played ${title}` `` | — | A shared game completed | No (link "See results") | friend-less (`friendId:null`) | gameTitle | Low. *Not home-eligible.* |
| `ceremony_ready` | `'Your weekly reflection is ready'` | `'A look at the questions, friends, and territories that defined your week.'` | Weekly reflection ready | No (link "See it now") | friend-less (`friendId:null`) | ceremonyId | Weekly (1/user/cycle). *Not home-eligible; also de-duped — see §C.* |
| `friend_request` / `follow_request` | `{friend}` + `' wants to follow you'` | — | Someone requested to follow you | No (Approve action if pending) | (untagged) | friend, friendshipId | `friend_request` **LEGACY-dead**; `follow_request` Medium |
| `follow` | `{friend}` + `' started following you'` | — | Someone followed you | No | (untagged) | friend | Medium |
| `follow_approved` | `{friend}` + `' accepted your follow'` | — | Your follow request was approved | No | (untagged) | friend | Medium |
| `invited_friend_played_first_five` | `{friend}` + `' played their first five questions'` | — | An invitee hit the 5-play milestone | No | (untagged) | friend | Low |
| `grade_dispute_filed` | `{friend}` + `' asked for a re-look at your question'` | `{questionText}` | An answerer disputed your grade | No | (untagged) | friend, questionText | Low. *Not home-eligible.* |
| `default` (unknown type) | `'Something happened on Joshing'` | — | Fallback for an unmapped type | No | friend-less | — | Should never fire |

> **Home-eligibility filter:** only `HOME_TOP3_ELIGIBLE_TYPES`
> (`friend_answered_your_question`, `friend_mastery`, `declared_promoted`, `reaction_received`,
> `question_curated`, `authored_question_shared`, `received_direct_question`) set `homeEligible:true`
> (`activity-types.ts:59-71`). The other activity rows surface only in the full `/activities` list, not
> the Home head — but the Home feed renders the **full** `buildActivityStream` result, so eligibility
> currently gates other surfaces (bell badge / RecentActivity), not this scroll. Verify intended.

### A2 — Lately-derived stream rows (verbatim)

| Source / fn | Verbatim line template | Meaning | Playable? | Class | Fields |
|---|---|---|---|---|---|
| **moment, `they_got_you`** (`momentToStreamItem`) | `{friend}` + `' got your question'`; `secondLine={category}` | A friend answered your authored question (correct) | No (chevron→send onward) | relationship (`got_you`) | friend, category, questionText |
| **moment, `you_got_them`** | `'You got '` + `{friend}` + `' on '` + `{category}` | You answered a friend's question (correct) | No | relationship (`you_got`) | friend, category, questionText |
| **milestone, deep** (`milestoneToStreamItem`) | `{friend}` + `' went deep on '` + `{domain}` | A friend got ≥3 right in one domain | **YES — triangle bundle** | playable | friend, domain, ≤5 questionIds |
| **milestone, breadth** (`breadthTail`, `activity-stream.ts:642-649`) | `{friend}` + `' has been on a streak — '` + …domains | A friend got right across ≥2 light domains | **YES — triangle bundle** | playable | friend, domains[], ≤5 questionIds |
| **milestone progress sub-label** (`ActivityStreamItem`) | `` `${answered} of ${total} questions` `` | Bundle progress; ticks as you answer | (label) | — | answered/total |
| **milestone answer button** (`InlineAnswerFlow`) | `'ANSWER →'` | Per-question answer affordance in the bundle | (control) | — | — |
| **convergence** (`convergenceToStreamItem`) | one of 6 caption templates (see §B) with `{Name}` → friend first name | You + a friend both got the same shared questions right | No (read-only) | relationship (`convergence`) | friend, 3 questionIds |

**Breadth pluralization (verbatim, `breadthTail`):**
- 1 domain → `' has been on a streak — ' {d1}`
- 2 domains → `' has been on a streak — ' {d1} ' and ' {d2}`
- 3+ → `' has been on a streak — ' {d1} ', ' {d2} ' and ${rest} other(s)'` (`'1 other'` vs `'N others'`)

### A3 — Feed question cards ("For You" zone; verbatim)

| `card_type` | Verbatim template | Meaning | Playable? | Plural | Fallback name |
|---|---|---|---|---|---|
| `direct_sent` (`DirectSentCard`+`SparkleEnvelope`) | `{senderName}` + `" thought you'd like this"` + ` about {category}` *(if category)* + `.` ; optional italic `"{personalMessage}"` | A friend sent you this question | **YES** ("Answer →") | — | `'A friend'` |
| `friend_added` (`FriendAddedCard`) | `{friendName}` + `' added a question'` + ` about {category}` *(if category)*; optional ` · Hide questions about {category}` | A friend authored/broadcast a question | **YES** ("Answer →") | — | `'A friend'` |
| `friend_liked` (`FriendLikedCard`+`FeedCard`) | `{authorName}` + `' thought you would like this'` | A friend endorsed this question | **YES** ("Answer →") | endorsement collapse fields carried but **NOT rendered** (see §E) | `'Someone'` |
| `answered_by_you` (`AnsweredByYouCard`) | eyebrow `'You answered'` + one of 6 comparison lines (§B) | Result of a question you already answered | No (Try again → / Recheck →) | single paired friend only | `'They'` |

### A4 — Editorial promos (verbatim, `EditorialPromos.tsx`)

| `embed.kind` | Eyebrow | Headline | Supporting / CTA | Plural |
|---|---|---|---|---|
| `common_ground` | `'Shared Ground'` | `'You and {friendFirstName} keep finding one another here.'` | supporting `` `${count} shared interest${count===1?'':'s'}` ``; CTA `'Explore your overlap →'` | `1 shared interest` / `N shared interests` |
| `add_friends` (`suggestions` & `invite`) | `'Grow Your Circle'` | `'Know someone who belongs here?'` | CTA `'Find friends →'` | none |
| `recently_expanding` | `'Your World Is Expanding'` | `"The places you've been exploring lately."` | CTA `'See your knowledge →'` | none |

### A5 — Per-person CLUSTER rollup (`PersonActivityCard.tsx`) — the alternate rendered form

When a friend has **≥2** relationship events in a bucket, their raw lines are replaced by:

```
◆ You & {Name}                                  {one cluster timestamp}
    got {Name} — {topic, topic, …}              ← all `you_got` events, topics deduped
    {Name} got yours — {topic, topic, …}        ← all `got_you` events
    {Name} saved your question                  ← `saved` (or "saved N of your questions")
    {Name} reacted to your question             ← `reacted`
    {convergence predicate}                      ← e.g. "keep landing in the same place"
    {raw line}                                   ← any untagged event (mastery/opened/follow…) as fallback
```

So e.g. a `you_got_them` moment renders **"You got Robyn on Star Trek"** when lone, but folds into
**"got Robyn — Star Trek, …"** when clustered. **Both forms must be considered for any copy redesign.**

---

## B. Edge cases & variants

**Convergence — all 6 phrasings (verbatim, `src/lib/lately.ts:81-92`):** selected deterministically by
`djb2(momentId) % 6` — stable per convergence, no semantic selection.
1. `'You and {Name} keep landing in the same place.'`
2. `'Turns out you and {Name} think alike.'`
3. `'You and {Name} are on the same wavelength lately.'`
4. `'You and {Name} both knew these.'`
5. `'You and {Name} just get each other.'`
6. `'You and {Name} are clearly on the same page.'`
In a cluster the leading "You and {Name}" is stripped and only the predicate shows
(`PersonActivityCard.convergencePredicate`), e.g. "keep landing in the same place"; fallback predicate
`'both knew these'`.

**Legacy moment caption pools (verbatim, `lately.ts:39-53`) — NOT used by the Home stream** (see §E):
`THEY_GOT_YOU_CAPTIONS = ['THEY KNEW YOU','{NAME} GOT IT','THEY SAW IT','A MATCH','ON YOUR FREQUENCY']`,
`YOU_GOT_THEM_CAPTIONS = ['YOU KNEW THEM','YOU SAW IT','YOU NAILED IT','A MATCH','ON THEIR FREQUENCY']`.

**`answered_by_you` — 6 comparison lines (`FeedList.comparisonCopy`):**
1. both correct → `'You and {friend} share this knowledge.'`
2. you right, friend wrong → `'You found a connection {friend} missed.'`
3. you wrong, friend right → `'{friend} has knowledge to share. You might next time.'`
4. both wrong → `'This one is still waiting for common ground.'`
5. no prior result → `'You have already answered this question.'`
6. authored source (direct/broadcast) → correct `'You and {friend} have that in common.'` / wrong
   `'{friend} knows this one. You might next time.'`

**Singular/plural & self/friend:**
- moment direction: `they_got_you` ("{Friend} got your question") vs `you_got_them` ("You got {Friend} on {topic}").
- friend_answered correct vs wrong: " got your question" vs " answered your question".
- breadth domains: 1 / 2 / 3+ forms (§A2).
- saved cluster line: "your question" vs "N of your questions".
- shared count: "1 friend" vs "N friends".
- common_ground supporting: "1 shared interest" vs "N shared interests".

**Fallbacks (missing data):** actor name → `'Someone'` (activity rows), `'A friend'` (direct/added cards),
`'Someone'` (friend_liked), `'They'` (answered/cluster); tier → `'a new tier'`; domain on `declared_promoted`
→ `'opened a new domain'`; game title → `'a Joshing Game'`. Missing category/topic ⇒ the ` about {category}`
/ ` — {topics}` fragment is omitted (no empty dangling " on ").

**Machine/LLM honesty risk:**
- `direct_sent` attribution is source-aware: `feedSourceVerb` distinguishes `'wrote you this'` (authored)
  vs `'sent you this'` (forwarded/curated), so an LLM/curated question is never copy-attributed as the
  sender's own writing. **Good.**
- `'A friend' / 'Someone' / 'They'` fallbacks can attribute a real social event to an unnamed actor — low
  risk but worth noting for honesty (an event implies a real person who couldn't be named).
- `question_curated` shows the **question text** as `secondLine`; if that question is house/LLM-authored,
  it renders without authorship marker (the card frames it as "{friend} saved your question").

---

## C. Grouping & ordering

- **Server sort:** `buildActivityStream` ends with `sortByProminence` (`lately.ts:25-32`) — tier ascending
  (`ANSWERED_YOU 0 < NICHE_MATCH 1 < MILESTONE 2 < OTHER 3`) then recency.
- **Client re-sort:** `FeedList.unifiedRows` re-sorts the merged feed+activity union **strictly by
  `sortMs` (recency)**, discarding the prominence tier on Home. (Prominence still governs `/activities`.)
- **Zones:** pinned **"For You"** (question cards) and **"From Friends"** (milestone cards, capped + batch
  reveal) render first; the remainder is bucketed by `groupItemsByRecency`
  (RECENCY_BUCKETS: past-few-hours → older, `MIN_GROUP_SIZE=5`).
- **Per-person clustering** runs **within each recency bucket** (`groupActivityByFriend`) so a cluster never
  spans a day label; cluster takes its newest member's slot.
- **Promo distribution:** the 3 promos splice at even fractions through the feed
  (`round((i+1)*len/(k+1))`), never first.
- **Server-side dedup/grouping already happening:** (a) milestones are derived & rolled up server-side
  (deep vs breadth, ≤5-question cap, multi-line split — `lately-milestones.ts`); (b) moments aggregate
  from `masteryEvents`; (c) `filter-utility-activities` drops the *correct* `friend_answered_your_question`
  activity row in favor of the `they_got_you` moment, and drops already-answered `received_direct_question`;
  (d) `ceremony_ready` is dropped from this scroll in `page.tsx` (it lives in the `CeremonyPin` marker
  above the feed). Everything else is flat per-event until the client cluster pass.

---

## D. Data availability for redesign (the two feasibility questions)

**Q1 — Can events be grouped by person at render time?** **YES.** Every relationship `StreamItem` carries
`friendId` (`activity-stream.ts` StreamItem field), set at construction: activity rows = `actorUserId`
(nulled for the friend-less `authored_question_shared` / `joshing_game_*` / `ceremony_ready`), moments =
`moment.friendId`, milestones = `milestone.friendId`, convergence = `convergence.friendId`. It is stable
and already used by `person-grouping.ts`.

**Q2 — Can relationship vs. playable be determined from a data flag (not copy)?** **YES, two flags:**
- **Playable (the triangle + chevron answerable bundle)** = `item.expand?.kind === 'milestone'`
  (equivalently `item.icon === 'bundle'`). The chevron itself is `questionBacked(item.expand)` in
  `ActivityStreamItem`, but only the milestone carries the **triangle bundle** mark. *(The "For You" feed
  question cards are also answerable, but via the `card_type` + "Answer →" link, a separate mechanism.)*
- **Relationship/texture class** = the `item.relationship` discriminator
  (`'you_got' | 'got_you' | 'convergence' | 'saved' | 'reacted'`). NOTE: it is **only set on the five
  rolled-up kinds today**; other relationship events (mastery, declared_promoted, follows, niche-match)
  are currently `relationship: undefined` and fall through as the cluster's "untagged fallback". For a
  redesign that wants a clean playable-vs-relationship split with **no copy parsing**, either (a) treat
  "not a promo and not `expand.kind==='milestone'`" as relationship, or (b) extend `relationship` to cover
  the untagged kinds. Both are field-based, not copy-based.

---

## E. Open questions / drift

**Dead / legacy event types (never written — render only for historical or other-path rows):**
- `friend_request`, `friend_request_accepted` — explicitly legacy (`activity-types.ts:16-20`), superseded
  by the follow model; no `writeActivity` call sites.
- `friend_mastery` — **deferred**: `write-mastery-event.ts` carries a `TODO Phase 8: write friend_mastery`.
  The `' reached {tier}'` template renders nothing because nothing writes it.
- `authored_question_shared` — defined + rendered, but **not written via `writeActivity`**; only hydrated
  from a `feedItems` join. Write-path debt.
- `declared_promoted` — written as a `masteryEvents` row (`sourceType='declared_promoted'`), not via
  `writeActivity`; hydrated back into an activity view. Second writer path outside the canonical writer.

**Duplicate / dead COPY (two implementations, only one renders — verify before any copy edit):**
- **Milestones:** Home renders `milestoneToStreamItem` → `breadthTail` → **"… has been on a streak — …"**
  and **"… went deep on …"**. But `lately-milestones.ts` also defines `deepMilestoneCopy`
  (`"{first} went deep on {domain}"`) and `breadthMilestoneCopy` (`"{first}'s been killing it — {a}, {b},
  and {N} more"`). The "killing it" phrasing appears **unused by Home** — confirm it's dead before treating
  it as live copy.
- **Moments:** Home renders `momentToStreamItem` ("{Friend} got your question" / "You got {Friend} on
  {topic}"). The all-caps caption pools `THEY_GOT_YOU_CAPTIONS` / `YOU_GOT_THEM_CAPTIONS` + `assignCaption`
  (`lately.ts:39-72`) are a **separate, older** caption system — confirm whether any surface still renders
  them (they are NOT in the Home stream path).

**Recently-changed milestone surfacing (history note):** commit `84a776e` had dropped already-answered
questions from the milestone bundle ("triangle = new questions only"); current code (PR #777) restores
keeping them as spent/hollow triangles. Any redesign should assume **answered questions stay in the bundle
with `priorResult`**, the title is stable, and `{answered} of {total}` ticks.

**Retired-vocabulary scan:** No retired-vocabulary leakage in the feed copy. "Ceremony" survives **only**
as `ceremony_ready` → user-facing **"Your weekly reflection is ready"** (the word "ceremony" is in the
route `/ceremony/{id}` and SMS copy, not the feed line). No "season/off-season/daily five/off-season"
strings in the feed render path.

**PRD drift:** event types broadly track the D-series (D-1 follow model, D-2 niche-match, D-4 Lately
milestones/moments, B-Convergence-1). The notable code-vs-doc gaps are the **two write-path exceptions**
(`authored_question_shared`, `declared_promoted`) and the **deferred `friend_mastery`** — all present in
the type union but not produced by the canonical writer.

---

## Done-when checklist
- [x] Every feed event type catalogued with verbatim templates (§A1–A5).
- [x] All 6 convergence phrasings + selection logic enumerated (§B); legacy caption pools flagged (§B/§E).
- [x] Playable-detection field named: `expand.kind === 'milestone'` / `icon === 'bundle'` (§A2/§D).
- [x] Person-grouping feasibility answered: `friendId`, stable, already used (§D).
- [x] No code changed (this is the only file written; it is documentation, under `_docs/`).
