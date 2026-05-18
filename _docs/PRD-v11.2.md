# PRD-v11.2 — Diff from v11.1
**Date:** May 2026
**Status:** Active. Supersedes the specific sections of v11.1 enumerated below.
**Scope:** Codifies the PRD-side updates produced by the 2026-05-16 PRD-vs-code audit. Folds the Phase 1 update queue (`audits/2026-05-16-phase1-prd-update-queue.md`) and the entries in `PRD_BACKLOG.md` dated 2026-05-16 into a single revision. Code-side remediation items live in `audits/2026-05-16-remediation-prompt.md` and are out of scope for this document.

---

## Source of changes

Two artifacts drove this revision:

1. **Phase 1 PRD update queue (2026-05-16).** 15 items, every PRD-vs-code divergence found in triage. Items marked "PRD" or "PRD update" land here. Items marked "code" are tracked separately in the remediation prompt and do not change the spec.
2. **`PRD_BACKLOG.md` (2026-05-16 entries).** 12 main entries plus 4 open questions, each with a proposed PRD edit drafted to drop into the next revision.

Two items remain unresolved and are deliberately not locked here. They are carried forward in §16 Open Questions:

- **Author-credit model** (windowed vs. PRD-locked). v11.1 §8.32 specifies 0.5× calibrated difficulty, Moderate/Specialist only, one credit per question per answering player. Code implements an empirical-rate windowed scheme with no difficulty gate. Product decision pending; both models documented in §16.16.
- **Catch-up + recovery combination.** v11.1 is silent. Code compounds the two 0.25× multipliers (catch-up × recovery = 6.25% of live base). Product decision pending; see §16.17.

---

## Summary of changes

| # | Section | Change |
|---|---------|--------|
| 1 | §5 | Remove 100-question-per-round cap; defer Personal Rounds, Archive, Activities tab, and Joshing Game creation; revise Developer Testing Mode |
| 2 | §7.3 | Add compact cultural-anchor step on the "Keep all" invite fast path |
| 3 | §8.1.x | Rewrite ceremony sections to describe the biweekly personal cron — remove all Act 1 / Act 2 and per-game language |
| 4 | §8.1.14 | DAILY_WRONG quip bank trimmed from 5 to 4 entries; storage clarified |
| 5 | §8.2.6 | Feed cap changed from 25 to 50 items |
| 6 | §8.3.4 | Creator points for direct-sent questions removed — send is its own reward |
| 7 | §8.5.2 | Reinstate the "Share with all friends" broadcast destination; simplify save-to-bank confirmation copy |
| 8 | §8.7 | Archive deferred; split Catch-up out as a separate, active feature |
| 9 | §8.8a | Breadcrumb length is 1–2 sentences (LLM-generated); separated from §8.1.14 per-answer quips |
| 10 | §8.10 | Star voting replaced by thumbs up / thumbs down — no daily budget, no SMS to author |
| 11 | §8.10b | Reaction custom-message cap raised from 100 to 160 characters |
| 12 | §8.11 | Remove "Friend answered your question" and thumbs-up SMS triggers |
| 13 | §8.12 | Navigation is Home / Friends / Questions / Knowledge / Account (Feed and Activities are not primary nav) |
| 14 | §8.14 | Joshing Game deferred |
| 15 | §8.15 | Activities Tab deferred |
| 16 | §8.4.11 | "Grow your map" copy updated to surface all three growth paths |
| 17 | §10 | Schema clarifications: `source_result` enum, `territory_type` text-with-typecast, quip storage |
| 18 | §16 | Four new open questions carried forward (16.16–16.19) |

**Tier name confirmation.** v11.1 §8.4.8 named the tiers Establishing / Familiar / Solid / Mastery. Earlier audit briefs used Curious / Versed / Fluent / Master. Code matches v11.1. v11.2 reaffirms **Establishing / Familiar / Solid / Mastery as canonical.** The earlier names are retired.

**No new killed features** beyond what v11.1 already killed. The Activities Tab, Joshing Game, Personal Rounds, and Archive are *deferred*, not killed — implementations exist for the first two and can be re-enabled when their entry points return.

---

## §5 — MVP Scope and Phasing (revised)

### §5.1 100-question-per-round cap — removed

The v11.1 placeholder text ("Players can submit up to 100 questions per round for consideration. This limit is a placeholder and may be revisited.") is **removed.** The product no longer has a group-round model.

**Replacement text:**

> Players may submit an unlimited number of questions to their bank. The Daily Five serves 5 questions per day per player; the Feed surfaces questions from a player's bank to their friends organically. No per-round submission ceiling applies.

### §5.2 Personal Rounds — deferred

The line "Knowledge page is an action surface — players can trigger personal rounds from it" is removed from the Phase 1 feature list. **§8.37 Personal Rounds is marked deferred.**

**Replacement text in §5:**

> The Knowledge page displays a player's mastery portrait and demonstrated domains. Personal Rounds — on-demand practice sessions triggered from the Knowledge page — are deferred to a future phase. No `PERSONAL_ROUNDS` schema or API route ships in v11.2.

### §5.3 Developer testing mode (Create Test Game) — replaced

The §8.39 group-and-seed-account "Create Test Game" flow does not match the shipped product. The Daily Five is a solo experience; there is no second player to provision.

**Replacement of §8.39:**

> Developer testing mode: a "Reset today's questions" action is available in Settings, implemented via `POST /api/daily/reset`. This clears the current user's daily queue so a fresh set is generated on next page load, allowing retesting of the daily session, scoring, and session-close flow without waiting for the next noon reset.

### §5.4 Activities Tab, Joshing Game, Archive — deferred

Each has a dedicated section below (§8.7, §8.14, §8.15). Listed here so §5's Phase 1 feature list stays accurate: none of these surfaces ships as reachable in v11.2.

---

## §7.3 — Onboarding "Keep all" fast path (addition)

v11.1 §7.3 describes a four-step flow that always includes Step 2 (birth year + geography). The implementation's "Keep all" invite-suggestions path skips Step 2 entirely and redirects to home, so a pre-seeded cohort never has a cultural anchor recorded. Neither end is correct: the PRD flow is too long for a pre-seeded user; the code's hard-skip permanently strips a useful signal.

**v11.2 resolution.** When a user taps "Keep all" on the invite-suggestions step, accept the interests, then route them to a compact one-screen step collecting birth year and country only, before reaching home.

**Step 1 (updated):**

> If the user accepts all pre-seeded interests, proceed to a compact Step 2 screen (birth year + country only) before reaching home. Region is omitted on this fast path — the two-field minimum is enough for future re-personalization without lengthening the gate.

The full four-step flow remains the path for users who skip invite suggestions or have no pre-seeded interests. **The cultural anchor is collected when offered but not enforced at the API.** A user who reaches the route without an anchor payload is accepted; the LLM falls back to warm-up answers alone. The compact "Keep all" Step 2 above is the soft gate — it is the only place the fast-path user sees the anchor question, and there is no client path that surfaces the question and then submits without it. §16.19 is resolved by this paragraph.

The Knowledge-base candidates returned to the user remain LLM-generated from birth year + country + (region if collected) + warm-up answers, exactly as in v11.1.

---

## §8.1.x — Ceremony Model (full rewrite to biweekly-personal)

The v11.1 ceremony sections describing a two-act per-game ceremony are **superseded.** Code is correct; the spec was stale. Resolved on 2026-05-16 with a confirmed product decision: the ceremony model is biweekly-personal. There is no per-game ceremony and there never will be.

### §8.1.30 Trigger

A biweekly cron (`/api/cron/biweekly-ceremony`) fires once per cycle per user. A cycle is 14 days, anchored to the user's onboarding completion date. There is no game-completion trigger.

### §8.1.31 Eligibility

A user receives a ceremony at the end of a cycle if they have at least one mastery event in the cycle window. Users with zero activity do not receive a ceremony — silence is the right register.

### §8.1.32 Mode

The ceremony renders in one of two modes, computed at fire time:

- **Solo** — no friend activity touched the user's mastery in the cycle.
- **Group** — at least one friend's answers, sends, or reactions touched the user's mastery in the cycle.

Mode is stored on the ceremony row (`BiweeklyCeremony.payload.mode`) and drives copy register on the ceremony page. Beat 3 (Shaped — who contributed to your learning) and Beat 4 (Alignment — best-aligned friend) are suppressed in solo mode regardless of all-time alignment scores. Beat 4 in particular must be cycle-scoped: a lifetime-overlap Beat 4 reaching the screen with a friend who hasn't played in months is wrong and will be removed.

### §8.1.33 Beats

The biweekly ceremony renders up to four beats in order:

1. **Crossed** — tier crossings during the cycle.
2. **Discovered** — new demonstrated domains during the cycle, with source copy distinguishing friend-mediated, authored declared, and authored-promoted-to-demonstrated paths (per §8.4.3).
3. **Shaped** — which friends contributed to the user's learning this cycle (suppressed in solo mode).
4. **Aligned** — best-aligned friend this cycle (suppressed in solo mode).

Each beat returns `null` if it has nothing to say. A ceremony with all four nulls is not shown.

### §8.1.34 Storage and idempotency

`BiweeklyCeremony` has a unique index on `(userId, cycleStart, cycleEnd)`. Re-running the cron is a no-op for users who already have a row for the cycle. Payload schema is validated with `beatsPayloadSchema.parse(...)` before insert.

### §8.1.x — Sections to delete from v11.1

All v11.1 ceremony copy referencing Act 1, Act 2, per-game triggers, all-players ceremony rows, or game-completion fires is **removed.** Editors of the v11.2 master PRD: when consolidating, strip these sections entirely rather than annotating them.

---

## §8.1.11 — Thumbs-up as quality signal (clarified; PRD unchanged)

v11.1 §8.1.11 specifies that thumbs-up "Contributes to its surface priority in friends' Feeds — heavily thumbed questions surface earlier in friends' Feeds, all else equal." Code records the signal but does not currently update `surface_priority_score` and the Feed query does not order by it. The signal is a no-op today.

**v11.2 leaves the spec unchanged.** The PRD describes the intended behavior correctly. The implementation gap is a code-side TODO, tracked in the remediation prompt and as open question §16.18 (which surfaces the still-undecided weighting formula).

---

## §8.1.14 — Per-Answer Commentary (revisions)

### DAILY_WRONG quip bank — trimmed to 4

v11.1 §8.1.14 listed 5 quips in the DAILY_WRONG bank, with "Tomorrow's version of you will know." marked "(use sparingly)." Implementation deliberately omits the fifth entry as too long and too self-referential.

**v11.2 lock:** the DAILY_WRONG bank is 4 entries — "Now you know." / "Close. It'll come." / "Good question." / "That one's yours now." The fifth entry is removed from the spec.

### Quip storage — clarified by surface

v11.1 says quips are "stored on the answer record." The code stores quips three ways depending on surface:

- **Daily Five:** quip is written into the JSONB queue slot that serves as the de-facto answer record.
- **Feed answers:** typed `quip` column on the feed-answer row.
- **Joshing Game answers:** typed `quip` column on `JoshingGameResponse`.

**v11.2 clarification:** the JSONB slot is acceptable as the Daily Five storage mechanism. The §8.1.14 storage rule reads:

> Quips are selected server-side at grade time and persisted on the answer record (typed column for Feed and Joshing Game answers; JSONB queue slot for Daily Five answers). Selection must not be re-randomized client-side; a refreshed session shows the same quip the player saw the first time.

Quip-level analytics across surfaces will require a small ETL or a future migration to a typed column for Daily; this is noted but not scheduled.

---

## §8.2.6 — Feed Mechanics (cap changed)

v11.1 says: "Maximum 25 items. Older items roll off." The implementation enforces a cap of 50 (`MAX_FEED_LIMIT = 50`, `rollOffOldItems` uses `.offset(50)`).

**v11.2 update:**

> Maximum 50 items. Older items roll off (remain in table, no longer surfaced).

Rationale: the live cap is what users have been using; lowering it now would silently drop items from active Feeds. The PRD adopts code.

---

## §8.3.4 — Creator Points (removed)

v11.1 §8.3.4 promised the sender of a direct-sent question creator points (1.0× for own questions, 0.5× for forwarded). No such mastery event fires in code; the answer route credits the answerer only.

**v11.2 replacement for §8.3.4:**

> The sender does not earn creator points when a recipient answers a directly-sent question. The send gesture is its own reward — the social moment of sharing a question with a specific friend. Mastery credit flows only to the player who answers. The author of an authored question continues to earn author credit via the standard mastery rule (§8.32) when their question is answered correctly, regardless of which surface delivered it.

---

## §8.5 — Question Creation (revised destinations)

### §8.5.2 Destinations — broadcast reinstated

v11.1 explicitly killed the "Share with all friends" broadcast destination. The implementation kept it: `QuestionForm` ships a `shareToFeed` checkbox defaulted ON.

**v11.2 reinstates broadcast.** The destinations panel offers three modes:

| Destination | Default | Effect |
|---|---|---|
| Save to bank | ON (locked, can't be turned off) | Question saved to player's bank; opens declared territory in player's KB if domain is new (per §8.4.3 Path 2) |
| Share with all friends | ON (toggleable) | Question is shared to the player's friends' Feeds via the standard friend-answered propagation path once the player or any friend answers it; also surfaces directly via the feed broadcast path |
| Send to specific friends | OFF (toggleable; opens picker) | Question is sent directly to selected friends, pinned in their Feed, with SMS notification per §8.3 |

**Rationale.** v11.1's argument for killing broadcast — that friendship-via-play is the cleaner propagation model — remains correct in principle, but the implementation has run with broadcast on by default for long enough that authorship engagement depends on it. The §8.4.3 "authorship opens declared territory" path still applies; broadcast just adds a second way for the question to reach friends without waiting on the play graph.

The play-graph propagation path (§8.2.3) remains the primary mechanism. Broadcast is a secondary lever, not a replacement.

### §8.5.2 Confirmation copy — simplified

v11.1 specified `"Saved to your bank. It opens [Domain] as declared territory on your map."` Implementation displays `"Saved to your bank only."` — and the domain/territory event is surfaced separately on the Knowledge page.

**v11.2 update:** inline save-confirmation copy is simply `"Saved to your bank only."` (bank-only) or `"Sent to [N] friend[s]."` (specific-friend send) or `"Shared with your friends."` (broadcast). The "opens [Domain] as declared territory" framing is surfaced on the Knowledge page and via mastery-event toasts, not crammed into the save confirmation.

### §8.5.x — `authored_shared` schema cleanup

v11.1 §8.2 said the `authored_shared` value of `feed_items.source_type` is preserved for migration safety but no longer written. In code, `AUTHORED_SHARED_FEED_SOURCE_TYPE` is exported as a live constant and included in active feed visibility filters as legacy support.

**v11.2 stance:** the export and legacy read path are acceptable while broadcast is back on. With broadcast reinstated above, `authored_shared` rows may once again be written (depending on how broadcast is implemented internally). Reconsider when broadcast's data path is finalized. No PRD-side migration required.

---

## §8.7 — Archive (deferred; Catch-up split out)

v11.1 §8.7 described a full archive of every question a player has interacted with, organized by source (Daily Five / Feed / Sent to me / Sent by me / Written by me / Catch-up), searchable by domain and free-text. The Archive page exists in code but is not in primary navigation. Catch-up is a fully implemented separate feature, not a filter inside an archive UI.

**v11.2 replacement for §8.7:** split into two entries.

### §8.7a — Catch-up (active feature)

A dedicated play session for missed Daily Five questions.

- Surfaced on the Home screen when the user has eligible missed questions.
- Lives at `/daily/catchup`; eligibility and turn sequencing handled by `src/server/play/catch-up-eligibility.ts`.
- Mastery credit applies at a reduced weight (`CATCHUP_WEIGHT`, currently 0.25); the catch-up + recovery interaction is an open question (§16.17).
- "Not interested" and "I give up" actions live on the question card.

### §8.7b — Archive (deferred)

A searchable history of all interactions is deferred to a future phase. The code surface at `src/app/archive/page.tsx` is not entered from primary navigation; no new work is scoped against it in v11.2.

---

## §8.8a — Breadcrumb System (clarified vs. §8.1.14)

v11.1 §8.8a said breadcrumbs are "2–6 words. No explanations. No facts. Observational tone." with examples like "you both know this" / "not your lane yet." Code at `src/server/daily/generate-breadcrumb.ts` prompts Claude Haiku for 1–2-sentence breadcrumbs with min 12 chars and max 420 chars. The 2–6-word examples actually describe the **per-answer quips** introduced in v11.1 §8.1.14 — a separate mechanism.

**v11.2 rewrite of §8.8a:**

> Breadcrumbs are short LLM-generated contextual notes (1–2 sentences) appearing after each answer. They are observational and conversational — never educational explainers, never restating the answer's correctness. Breadcrumbs are generated server-side at grade time using Claude Haiku (`claude-haiku-4-5-20251001`) and persisted with the answer.
>
> Breadcrumbs are distinct from the per-answer quip (§8.1.14), which is a fixed short phrase (3–5 words) selected from a curated bank by context. Both can appear; the quip is the closing aside, the breadcrumb is the contextual sentence.

The 2–6-word examples from the prior §8.8a now belong exclusively to §8.1.14.

---

## §8.10 — End of Session Voting (star → thumbs)

v11.1 §8.10 described a star-voting mechanic: 2 stars per player per day per group, movable within the daily budget, with SMS notification to the question's author. The shipped product uses thumbs up / thumbs down on each question (`src/components/games/QuestionRatingButtons.tsx`), with no daily budget and no author notification.

**v11.2 replacement for §8.10:**

> Players may give thumbs-up or thumbs-down on any question in the End of Session Review. Thumbs-up increments the question's surface priority score (subject to the formula resolution in §16.18); thumbs-down decrements it and removes the question from the player's own Feed and from propagation to their friends (§8.2.10). No daily budget applies. The star mechanic is removed entirely; the "star_notification" SMS trigger is removed (see §8.11).

---

## §8.10b — Reaction custom message cap (160 chars)

v11.1 §8.10b said reactions allow "Optional personal note up to 100 characters." Code (`src/app/api/reactions/route.ts`) enforces 160.

**v11.2 update:** "Optional personal note up to 160 characters."

---

## §8.11 — SMS Notifications (revised)

Two opt-in triggers from v11.1 are **removed** because the code does not fire them and the product has decided neither is SMS-worthy:

- "Friend answered your question" — `'friend_answered_question'` enum value exists but is never triggered.
- "Friend thought your question was excellent (thumbs-up)" — `'star_notification'` is explicitly excluded from `SmsMessageType`.

**v11.2 SMS trigger table:**

| Trigger | Copy | Default |
|---|---|---|
| OTP for auth | Your Joshing code: NNNNNN | Always |
| Daily Five ready | Your five for today. [link] | ON, opt-out |
| Friend sent you a question | Greg sent you a question. [link] | ON, opt-out |
| Friend reaction to your question | Greg reacted to your question. | OFF, opt-in |
| Friend invitation accepted | Maya joined Joshing — you're now friends. | ON, opt-out |
| Friend request received | Greg wants to be friends on Joshing. [link] | ON, opt-out |
| Biweekly ceremony ready | Two weeks of Joshing. Here's what you've been up to. [link] | ON, opt-out |

Author-side notifications about who answered or thumbed their questions are intentionally absent. The Knowledge page and (eventually) Activities tab will surface those events without SMS noise.

---

## §8.12 — Navigation (revised)

v11.1 §8.12 named five primary nav items: Home / Feed / Knowledge / Activities / Account. Code (`src/components/Nav.tsx:15–21`) implements: Home / Friends / Questions / Knowledge / Account. Feed and Activities are not primary destinations; Friends and Questions are.

**v11.2 nav (5 items):**

| Position | Label | Route | Purpose |
|---|---|---|---|
| 1 | Home | `/` | Daily Five entry, Feed indicator, catch-up entry, ceremony banner |
| 2 | Friends | `/friends` | Friend list, friend requests, invite flow |
| 3 | Questions | `/questions` | Authored bank, write flow |
| 4 | Knowledge | `/knowledge` | Mastery portrait, Grow your map card, dismissed domains |
| 5 | Account | `/account` | Settings, manage interests, dev tools |

**Feed is surfaced from Home**, not from primary nav. The "3 new in your Feed" indicator on Home (per v11.1 §8.2.2) is the entry point. The Feed page itself remains accessible at `/feed` (deep-linkable, surfaced from Home), but it does not have a tab.

**Activities is deferred** as a primary nav item (see §8.15). Notification events surface in Home, on Knowledge, or via SMS per §8.11 until Activities is re-enabled.

---

## §8.14 — Joshing Game (deferred)

The Joshing Game feature is fully implemented end-to-end — schema, API, play interface, summary page, feed integration, SMS — but **creation is explicitly disabled** in code: `GAME_CREATION_DISABLED_IN_V11_1 = true` in `src/app/api/joshing-games/route.ts:12`. UI entry points are also disabled.

**v11.2 stance:** §8.14 is marked **deferred.** The spec is preserved as-is in the master PRD for when the feature is re-enabled. Re-enabling requires:

1. Removing `GAME_CREATION_DISABLED_IN_V11_1` and the route guard.
2. Restoring UI entry points (currently commented out / gated).
3. Re-confirming the SMS triggers and ceremony-beat interactions still match the active spec.

No engineering work is scoped against §8.14 in v11.2.

---

## §8.15 — Activities Tab (deferred)

The `/activities` page is fully implemented — item types, unread count, batch read-marking, ceremony banner integration — but is not linked from primary nav or from the Account tab. It is not a reachable surface for users.

**v11.2 stance:** §8.15 is marked **deferred** alongside Joshing Game. Re-enabling requires:

1. Adding the nav entry (would expand nav from 5 to 6 items — needs a product call on whether to drop one of the current five).
2. Wiring the unread badge.
3. Confirming the 90-day retention and batch-read semantics still hold.

No engineering work is scoped against §8.15 in v11.2.

---

## §8.4.11 — Grow Your Map (copy update)

v11.1 §8.4.11 specified copy that surfaced three growth paths: (1) Feed correct answers, (2) direct sends, (3) authorship opening declared territory. The rendered copy at `src/app/knowledge/page.tsx:503–513` describes only direct-send in both directions and omits Feed answers and authorship.

**v11.2 copy lock** (matches v11.1 §8.4.11 with light editing):

> **Grow your map**
>
> Your map grows whenever you correctly answer a question that came through a friend — from your Feed, from a direct send, or from a Joshing Game.
>
> It also grows when you write a question yourself. The domain you wrote in opens as declared territory on your map. When a friend answers it correctly, it becomes proven.
>
> One way to start: ask a friend about something you'd love to learn from them. The ask itself plants the seed.

Action buttons remain `[Send a friend a question]` and `[Write a question]`. Visual register unchanged.

---

## §10 — Data Model (clarifications, no migrations)

### §10.1 `feed_items.source_result` enum

v11.1 §10 specifies `source_result` as `enum(correct, incorrect), nullable`. Code stores it as unconstrained `text` (`src/server/db/schema.ts:683`).

**v11.2 stance:** the PRD-specified enum is the correct target. Converting the column to a true Postgres enum (or to a CHECK constraint) is a code-side TODO. Until then, application code must validate the value against `{correct, incorrect, null}` at every write site. PRD text is unchanged.

### §10.2 `knowledge_base_domains.territory_type`

v11.1 §10 specifies `territory_type enum(declared | demonstrated)`. Code uses `text.$type<'declared' | 'demonstrated'>().default('demonstrated')` — a text column with a TypeScript type assertion, not a true DB enum.

**v11.2 stance:** acceptable. The TypeScript-only constraint catches the common case; converting to a true DB enum is a low-priority code-side TODO. The PRD continues to specify the logical enum; the schema is allowed to implement it as text-with-typecast until a future migration consolidates this.

### §10.3 Quip storage

See §8.1.14 above. Daily Five quips are stored in the JSONB queue slot; Feed and Joshing Game quips are stored in typed `quip` columns. Both are acceptable.

### §10.4 Schema changes net of v11.2

**No new tables. No new columns.** v11.2 is a spec-and-copy revision; the schema additions from v11.1 (cultural anchor fields on users, `territory_type` on KB domains, `quip` columns, `FeedDismissedDomain`, `surface_priority_score`) are all already shipped per the Phase 1 triage.

The only schema-shaped TODOs are:

1. Tighten `feed_items.source_result` from text to a real enum or CHECK constraint (§10.1) — code-side.
2. (Optional) tighten `knowledge_base_domains.territory_type` from text to a real enum (§10.2) — code-side, low priority.

Neither blocks the v11.2 spec.

---

## §16 — Open Questions (additions)

### §16.16 Author credit model — UNRESOLVED

**Status:** unresolved. v11.1 §8.32 specifies "Author credit = 0.5× of the question's calibrated difficulty, awarded only on Moderate/Specialist questions, one credit per question per answering player ever." Code in `src/server/mastery/scoring.ts:70–94` implements an empirical-rate windowed scheme: 25/50/100 points base, full credit for the first 2–5 correct answers globally, half for the next 2–5, zero after, no difficulty filter.

**Two models to choose between:**

- **PRD-locked model.** Simple. 0.5× calibrated difficulty per unique answerer. Skip Accessible. The DB unique constraint on `(source_type, question_id, answered_by_user_id)` already enforces the one-per-answerer rule. Engineering: add `difficulty` parameter to `creatorMasteryAwardForNthCorrect`, add the Accessible skip, reference `AUTHOR_CREDIT_WEIGHT = 0.5`.
- **Windowed model (currently shipping).** Complex. Rewards effort-to-create via difficulty-rate correlation but caps total author credit per question at ~10 unique answerers regardless of how widely the question circulates. Engineering: rewrite the PRD §8.32 author-credit text to match.

**Cross-cutting:** under either model, F1.1 from Phase 2 also needs fixing — author credit currently only fires from Joshing Game answers, not from Feed or Daily Five answers. The right fix is to factor the author-credit write into a shared helper and call it from all three surfaces.

**v11.2 does not lock either model.** No spec text changes in §8.32. Decision deferred to product.

### §16.17 Catch-up + recovery combination — UNRESOLVED

**Status:** unresolved. v11.1 specifies catch-up = 25% of live base and recovery (`first_correct_after_wrong`) = 25% but is silent on the compound case. Code compounds them: `CATCHUP_WEIGHT × RECOVERY_WEIGHT = 6.25%` of live base (`src/app/api/daily/catchup/answer/route.ts:122–128`).

**Three options:**

- **Adopt the compound (current code).** 6.25% feels right as "the lowest-credit path" — you missed it the first day *and* you originally got it wrong. PRD adds one sentence to §8.32 to lock the compound.
- **Adopt MAX of the two.** Player earns 25% (the higher of the two reductions), not 6.25%. Simpler to reason about. Code changes one multiplication to a Math.max.
- **Adopt only one reduction at a time.** Catch-up takes precedence (because the recovery state was set on the wrong-day answer, not the catch-up answer). Player earns 25%.

**v11.2 does not lock a choice.** No spec text changes in §8.32. Decision deferred.

### §16.18 Thumbs-up surface ordering — formula unresolved

**Status:** code gap, not spec drift. v11.1 §8.1.11 specifies that thumbs-up contributes to surface priority. The signal is recorded in `question_feedback`, but `questions.surface_priority_score` is never updated and the feed query does not order by it. The signal is a no-op.

**Decision needed before the code fix can land:**

- Eager update to `surface_priority_score` when feedback is recorded, or dynamic computation in the feed query joining `question_feedback`?
- Weighting formula: each thumbs-up adds X to the priority score? Subject to decay over time? Capped per question?

**v11.2 leaves the spec unchanged.** This is tracked as a code-side TODO blocked on a small product call about the formula.

### §16.19 Cultural anchor — required or skippable at the route? — RESOLVED

**Resolved (v11.2): skippable.** The route at `src/app/api/onboarding/propose-interests/route.ts` accepts requests without a `culturalAnchor` payload and falls back to warm-up answers alone. The compact Step 2 on the "Keep all" fast path (§7.3) is the only place the anchor question is surfaced; users who reach it answer both fields, but the API does not reject anchor-less requests from other callers (e.g. post-onboarding interest canonicalization in `src/app/knowledge/page.tsx`).

**Rationale.** Making the anchor a hard server-side requirement would either (a) force a re-prompt flow for legacy users with `birth_year = NULL`, or (b) lock pre-1920 users and users unwilling to share geography out of the canonicalization path. v11.2 declines both costs and treats the anchor as a useful signal rather than a gate.

---

## Phase 2 confirmations — no PRD change required

The following items from `audits/2026-05-16-phase2-findings.md` either confirm code is correct or are tracked as code-side TODOs. Listed here so the audit trail is complete; no spec edit is needed.

| Phase 2 finding | Status |
|---|---|
| F1.4 — DB-level idempotency on author credit | Correct. Unique constraint on `(source_type, question_id, answered_by_user_id)` is sufficient under either §16.16 model. |
| F2.1 — Middleware infrastructure built, `middleware.ts` missing | Code-side TODO in remediation prompt. Remember `src/proxy.ts` is the routing surface per CLAUDE.md — read it before adding any middleware. |
| F2.2 — Re-login grants `invitationAccepted: true` regardless of history | Product call deferred (grandfather pre-fix accounts vs. recheck on every re-login). Not a PRD change. |
| F2.3 — Onboarding page has no invitation check | Code-side TODO in remediation prompt. |
| F2.4 — `createSession` type signature prevents regression | Confirmed healthy. |
| F3.2 — Beat 4 in solo mode | Addressed in §8.1.32 above (suppress in solo). Code change to follow. |
| F3.3 — `domainFor` `'General'` fallback | Code-side fix. PRD already requires hyper-specific categorization. |
| F3.4 — Ceremony payload validation | Confirmed fixed. |
| F4.1 — Caveat and Playfair loaded | Confirmed fixed. |
| F4.2 — `--font-sans` / `--font-neutral` Montserrat alignment | Code-side TODO. |
| F4.3 — INK / CREAM / HILITE tokens | Code-side TODO. |
| F4.4 — Circle sizing | Confirmed correct. |
| F4.5 — "Grow your map" copy | Addressed in §8.4.11 above. |
| F5.1 — Cultural anchor LLM prompt | Confirmed correct. |
| F5.2 — Cultural anchor optional at route | Resolved in §16.19 (skippable). |
| F5.3 — Fallback interests weakly specific | Code-side, low priority. |
| F5.4 — `claude-haiku-4-5` informal alias | Code-side TODO: pin to `claude-haiku-4-5-20251001` per CLAUDE.md. |

---

## Document status

**Version:** 11.2
**Date:** May 2026
**Replaces:** the v11.1 sections enumerated above. All other v11.1 content stands as written.

**Source of changes:** the 2026-05-16 PRD-vs-code audit (Phase 1 update queue + `PRD_BACKLOG.md` 2026-05-16 entries + Phase 2 findings).

**Next planned revision:** v11.3, when one or both of §16.16 (author credit model) and §16.17 (catch-up + recovery) are resolved, or when Activities / Joshing Game / Personal Rounds / Archive are re-enabled.

**Code-side companion:** `audits/2026-05-16-remediation-prompt.md` lists every code-side fix that does not require a PRD change. It is the working document for engineering; v11.2 is the working document for product.
