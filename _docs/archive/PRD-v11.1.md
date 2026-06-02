# PRD-v11.1 — Combined Diff from v11.0
**Date:** May 2026  
**Status:** Active. Supersedes specific sections of v11.0.  
**Scope:** Two design sessions in May 2026 produced overlapping refinements to the in-progress v11.0 build. This document combines both into a single coherent v11.1 spec.

---

## Important: One Major Conflict Resolved

The two source documents conflicted on a foundational question — how do authored questions propagate to friends?

- **Earlier draft** proposed making "broadcast share to all friends" the default for question creation, with a new `authored_shared` Feed source type promoted to first-class status.
- **Later, more comprehensive Feed redesign** reorganized propagation entirely around the friendship-and-play mechanism: questions enter friends' Feeds when anyone in the graph answers them, not when an author writes or curates them. Under this model, the `authored_shared` source type is killed.

**Resolution: the later model wins.** It is cleaner, matches the "presence, not curation" principle, and makes the Feed easier to reason about. As a consequence:

- The "Share with friends" destination toggle proposed in the earlier draft is not added.
- The `authored_shared` Feed source type is removed from the application layer (the column may persist in the schema but is unused).
- The "broadcast default" copy and orientation panel proposed in the earlier draft are dropped.
- The friendship-propagation model from the later draft is adopted in full.

**Authored questions still reach friends** — through three preserved paths:
1. Direct-send to one or more specific friends (pinned in their Feed)
2. A friend in your bank who curates the question and plays it (it enters the Feed graph via the answer mechanism)
3. You answer it yourself in a Personal Round or include it in a Joshing Game — at which point it propagates by friendship just like any other answered question

---

## Summary of Changes

**Eight substantive shifts from v11.0:**

| # | Section | Change |
|---|---------|--------|
| 1 | §8.2 | Feed model redesigned — friendship-propagated, result-visible, living cards |
| 2 | §7.3 | Onboarding revised — birth year + geography as primary signal |
| 3 | §8.1.13, §8.1.14 | Joshing commentary revived — per-answer quips + interpretive line |
| 4 | §8.4.3 | Authorship-opens-territory — writing a question opens that domain in your KB as declared territory |
| 5 | §8.4.10 | Adjacent domain discovery — formally deferred, design constraint noted |
| 6 | §8.4.2 | Declared interests demoted from a Knowledge page concept to onboarding-only metadata |
| 7 | §8.4.8 | Knowledge page circle sizes are tier-anchored, not points-only |
| 8 | §8.4.11 | New section: "Grow your map" expansion CTA on the Knowledge page |

**Plus one clarity fix:** §8.2.10 thumbs-down adds inline confirmation copy.

**Schema changes:** Three small additions (`dismissed_domains` table, `territory_type` column on KB domains, `quip` column on answer tables, optional `birth_year` / `grew_up_country` / `grew_up_region` columns on users). One column killed at the application layer (`authored_shared` value of `FEED_ITEMS.source_type` — preserved in schema for migration safety, unused in code).

**No killed features** beyond what v11.0 already killed.

---

## §6 — User Stories (minor revisions needed)

Two existing user stories no longer match the v11.1 mechanics. Both need a small rewrite in a future pass:

- **§6.1 Maya's onboarding** — does not yet reflect the new birth year + geography step. Update to include the cultural anchor question between pre-seeded interests and warm-up questions.

- **§6.3 The Feed moment** — uses the old thumbs-up propagation model. Rewrite to reflect that thumbs-up is a quality signal only, and that propagation happens through friend-answered events.

**A revised §6.3 reads roughly:**

> Maya, later that evening, opens Joshing again and taps the Feed. There are 8 items. The top is pinned: "Greg sent this to you — about Sondheim." She answers it — gets it right. Below, "Robyn got this right — W.H. Auden." She skips. "Robyn couldn't get this — Weimar Cinema." She answers it and gets it wrong; the card updates in place with both their results side by side. She dismisses one more, leaves the rest for tomorrow. On the way out she taps thumbs-up on the Sondheim question — it was a great question, and her signal will push it higher in friends' Feeds. She does not need to do anything to share the questions she answered; those propagated to her friends' Feeds the moment she answered them.

---

## §7.3 — Onboarding (Full Replacement)

After authentication, a new player goes through a four-step interest declaration flow before reaching the home screen.

### Step 1 — Pre-seeded interests (if applicable)

If the inviter pre-seeded 1–3 interests, these are shown first:

> Greg invited you to Joshing. He thought you'd like questions about:
> - Late Tchaikovsky
> - Weimar Cinema
> - Sondheim Musicals
>
> [Accept all] [Pick which to keep] [Skip and start fresh]

Accepted pre-seeded interests count toward the 5-interest cap. If no pre-seeded interests, proceed directly to Step 2.

### Step 2 — Cultural anchor: birth year + where you grew up

Two fields, presented plainly:

```
When were you born?        [Year picker]
Where did you grow up?     [Country selector; if US, state/region selector appears]
```

These two facts are passed to the LLM, which generates a first pass of hyper-specific culturally-anchored candidate interests. **Examples:**
- Born 1979, suburban Michigan → candidates: Saturday Morning Cartoons of the 1980s, He-Man and the Masters of the Universe, Animaniacs, Early MTV (1981–1987), Top 40 Radio of the Late 1980s
- Born 1968, London → candidates: British New Wave Cinema, Post-Punk UK Music, Thatcher-Era British Television, 1970s BBC Drama
- Born 1985, São Paulo → candidates reflect Brazilian rather than American cultural touchstones

**Geography determines cultural context.** Someone who grew up in Iran in the 1980s shares neither the American TV landscape nor the British one. The LLM must use both year and country/region to generate meaningful candidates. If geography produces insufficient signal, the LLM falls back to the warm-up answers alone.

**Why this replaces a warm-up question:** Birth year + geography are lower-effort, less performative, and produce candidates the warm-up questions miss — the cultural air you breathed growing up, not just the books you chose as an adult.

### Step 3 — Warm-up questions (trimmed from 4–6 to 2–3)

Free-text questions to capture intellectual territory the cultural anchor misses:

1. "A book, composer, or filmmaker you've gone deep on?" (required)
2. "A topic you could talk about for an hour without preparation?" (required)
3. "Anything else — a period of history, a sport, a field you studied?" (optional)

The LLM combines both signals (cultural anchor + warm-up answers) to produce 10–14 candidate interests at hyper-specific granularity.

### Step 4 — Pick five

> Here are some areas that might fit. Pick up to 5.
>
> [Saturday Morning Cartoons, 1980s] [He-Man and the Masters of the Universe] [19th-Century English Novels] [Italian Renaissance Painting] [Sondheim's Late Period] [Werner Herzog Documentaries] [The Wire] [The Federalist Papers]

Player can: tap to select, edit any candidate in free text, reject all and write their own, mix freely.

**Lock and confirm:** "Tomorrow at noon, your first Daily Five arrives. You'll receive an SMS."

### Schema additions for §7.3

Add to `users` table:
- `birth_year` integer nullable
- `grew_up_country` varchar nullable (ISO code)
- `grew_up_region` varchar nullable

Not displayed in UI — used only for LLM prompt construction at onboarding and for any future re-personalization.

---

## §8.1 — Daily Five (additions)

### §8.1.8 — Chat-Thread Interface (additive)

Add this line to the chat-thread interface description:

> After grading, a per-answer quip appears below the result bubble (§8.1.14).

### §8.1.11 — Reactions on Daily Five Questions (revised)

Replace the v11.0 statement that thumbs-up "Makes the question eligible to appear in the Feeds of this player's friends." Thumbs-up no longer creates Feed items.

**Revised text:**

After answering a Daily Five question, the player can apply a single thumbs-up gesture. Thumbs-up on a Daily Five question:

1. Marks the question as excellent
2. Contributes to its surface priority in friends' Feeds — heavily thumbed questions surface earlier in friends' Feeds, all else equal

The question enters friends' Feeds automatically when answered (unless the player thumbs it down). Thumbs-up does not control propagation — **it is a quality signal only.**

### §8.1.13 — Session Close Messaging (revised)

**Two layers at session close.**

**Layer 1 — Score line (unchanged):**

| Score | Copy |
|-------|------|
| 5/5 | Untouched. |
| 4/5 | Strong. |
| 3/5 | Solid. |
| 2/5 | Working ground. |
| 1/5 | Tomorrow's another five. |
| 0/5 | Tomorrow's another five. |

**Layer 2 — Interpretive line** (one line, highest-priority match only; omitted if nothing qualifies):

1. Tier crossing → "You moved to Familiar in Late Tchaikovsky."
2. First correct in a new demonstrated domain → "New ground: [Domain] is yours now."
3. 5/5 → "Clean sweep."
4. 0/5 → "Every one of them. Tomorrow."
5. 3+ correct in a row → "Three in a row at one point."
6. All wrong in a single domain → "[Domain] is worth a deeper look."
7. Otherwise → omit

The interpretive line appears below the score line with a 300ms delay — **after, not simultaneously.**

### §8.1.14 — Per-Answer Commentary (NEW)

After each answer is graded, a single quip appears below the result bubble in small, muted text. It feels like an aside, not a headline.

**Design constraint:** 8 words maximum per quip. No exceptions.

Quips are contextual — they vary by correctness, surface, and whether a friend's result is known.

**Daily Five — correct (solo):**
- "That's your ground." / "Knew it." / "Of course you did." / "Solid." / "There it is."

**Daily Five — wrong (solo):**
- "Now you know." / "Close. It'll come." / "Good question." / "That one's yours now." / "Tomorrow's version of you will know." (use sparingly)

**Feed — both correct:**
- "Same wavelength." / "You both had it." / "Common ground."

**Feed — you correct, friend wrong:**
- "You had it. [Name] didn't." / "You carried that one."

**Feed — you wrong, friend correct:**
- "[Name] had it. You'll get there." / "[Name]'s ground. Now it's yours too."

**Feed — both wrong:**
- "Neither of you. Good question." / "That one got you both." / "Tough one."

**Implementation:** Quips are selected server-side at grade time and stored on the answer record. This ensures consistency if the player refreshes or returns to a session mid-way. Do not randomize purely client-side.

### Schema addition for §8.1.14

Add `quip` varchar(100) nullable to `daily_answers` and equivalent answer tables (Feed answers, Joshing Game answers).

---

## §8.2 — The Feed (Full Replacement)

### 8.2.1 Concept

The Feed is a bounded, living stream of questions your friends have answered. It is where the social life of Joshing lives. The Feed is not a game and is not required — players who never open it can still get full value from the Daily Five. But for players who engage, the Feed is the mechanism by which their Knowledge base expands and their relationships with friends become legible.

**The Feed is organized around friendship, not endorsement.** A question enters your Feed because a friend played it — not because they curated it for you. **The signal is presence, not curation.** You see what they answered. You see how they did.

### 8.2.2 Where It Lives

The Feed is a top-level nav destination: **Home → Feed → Knowledge → Activities → Account.**

The Home screen surfaces a small Feed indicator: "3 new in your Feed." No badges, no red dots, no urgency. Just a quiet count.

### 8.2.3 Feed Item Sources

A question enters a player's Feed when a friend answers it — correct or wrong — in any context (Daily Five, Personal Round, or from their own Feed).

| Source | Trigger | Priority |
|--------|---------|----------|
| Direct send | A friend uses Send-to-Friend (§8.3) targeting this player | Pinned above all others |
| Friend answered | A friend answered this question, correct or wrong, in any session | Reverse-chronological |

**Two filters block a question from entering the Feed:**

1. **Thumbs-down by the friend** — if the friend who answered the question thumbed it down, the question does not propagate to anyone's Feed. Thumbs-down is a quality gate, not a personal preference signal.

2. **"Not my focus" by the recipient** — if the recipient has marked the question's domain as "not my focus," questions in that domain are filtered out regardless of which friend answered them. Permanent, domain-level, reversible from the Knowledge page.

**What does NOT filter the Feed:** whether the friend got the question right or wrong. Both flow. The result is visible on the Feed item.

### 8.2.4 Feed Item Display

Each Feed item shows:
- Question text (truncated if long, with "more" expansion)
- Result attribution: "Robyn got this right — Late Romantic Piano" / "Robyn couldn't get this — Mrs. Dalloway"
- Domain pill
- Action buttons (see §8.2.5)

Tap on the friend's name → friend's profile (§8.6).

**When multiple friends have answered the same question,** items collapse: "Robyn got this right · Greg couldn't get it — Mrs. Dalloway."

### 8.2.5 Feed Item Lifecycle

Each Feed item is a **living card** — it updates in place as the social moment develops. **Three states:**

**State 1 — Unanswered**

Actions available:
- **Answer** — opens the inline chat-thread interface; question grades and stores like any other answer; correct answer adds domain to Knowledge base (§8.4)
- **Skip** — moves item to back of Feed; resurfaces if more friends answer the same question
- **Dismiss** — removes this question from Feed permanently; domain stays open
- **Not my focus** — removes all questions in this domain permanently; reversible from Knowledge page (§8.4)

**State 2 — Answered**

After answering, the item updates in place:
- Your result: "You got it right" / "You couldn't get it"
- Friend's result for comparison: "Robyn couldn't get it either" / "Robyn had it"

Actions available post-answer:
- **Thumbs-up** — personal quality signal; feeds into question surface priority; does not propagate the question to other players' Feeds
- **Thumbs-down** — quality signal; removes from your Feed and prevents the question from entering your friends' Feeds
- **React** — private reaction to the friend who answered it (emoji + optional short text)

**State 3 — Reacted**

If the friend reacts back, the item receives a quiet indicator: "Robyn reacted." Tapping reveals the reaction. After reactions are exchanged, the item settles.

### 8.2.6 Feed Mechanics

- **Bounded.** Maximum 25 items. Older items roll off (remain in table, no longer surfaced).
- **Reverse-chronological** by triggering answer event; direct-sent items pinned above the rest.
- **Once correctly answered** → gone. A correctly-answered question does not reappear, even if more friends answer it later.
- **Wrong-answered, skipped items** can resurface as new friends answer the same question.
- **No infinite scroll.** Cap is the cap. Empty state: "You're caught up."

### 8.2.7 Mastery Credit

Feed answers count at full weight (1.0x) toward mastery. Correctly answering a Feed question in a domain not currently in the player's Knowledge base silently adds that domain (§8.4.5). This is the primary mechanism by which the Knowledge base grows beyond the player's declared 5.

### 8.2.8 Reactions

After answering a Feed question, the player can send a private reaction to the friend who answered it (emoji + optional short text). The friend can react back. Both directions supported. Reactions are private to the pair.

### 8.2.9 Activity Tab

The Activity tab is the reverse-chronological record of social moments around the player's questions:
- "Josh answered your Mrs. Dalloway question — got it right."
- "Josh answered your Upledger Institute question — couldn't get it."
- "Greg reacted to your answer."

This is where friends see the downstream effect of their sessions — who picked up their questions, how they did — without anyone having to send anything deliberately.

### 8.2.10 Thumbs-Up and Thumbs-Down as Quality Signals (revised + clarity copy added)

**Thumbs-up (post-answer only):**
- Personal signal that a question was excellent
- Feeds into surface priority: heavily thumbed questions appear earlier in friends' Feeds, all else equal
- Does not propagate the question to new Feeds — propagation is handled by friendship alone

**Thumbs-down (post-answer only):**
- Quality signal that a question was unfair, incorrect, or poorly formed
- Removes the question from the player's own Feed immediately
- Prevents the question from entering the player's own friends' Feeds going forward
- Aggregate thumbs-down signals visible to the question's author in Archive → Written by me

**v11.1 clarity addition:** thumbs-down now renders inline confirmation copy on tap, to make the propagation effect legible.

**On tap thumbs-down:**

> Removed from your feed. Won't pass to your friends.

Single line, muted italic, displayed for ~4 seconds, dismissible by tap.

**On tap to undo (toggle thumbs-down back off):**

> Restored. This may pass to your friends.

Same display rules.

**Thumbs-up does not require confirmation copy.** The mechanic (quality signal, contributes to surface priority) is less consequential and the tap itself is a complete gesture.

### 8.2.11 "Not My Focus" — Domain Dismissal

"Not my focus" signals: I don't want questions in this domain, from any friend, ever.

- Available on any unanswered Feed item, pre-answer
- Applies to the question's hyper-specific domain (e.g., "Upledger Institute," not "Alternative Medicine")
- All future questions in that domain are filtered from the Feed regardless of source
- **Reversible:** Knowledge page → Dismissed Domains → re-open any domain
- Does not affect the Daily Five

### 8.2.12 Empty Feed States

- **No friends yet:** When your friends play, their questions will show up here. [Invite a friend]
- **Friends but no activity:** Quiet today. Check back when your friends have played.
- **Caught up:** You're caught up. Check back later.
- **All domains dismissed:** You've focused your Feed. You can re-open domains from your Knowledge page.

### Schema additions for §8.2

1. **feed_items:** Add `source_result` enum column (correct | incorrect), nullable (null for direct-sends). Add `source_user_id` FK if not present.
2. **dismissed_domains (NEW):**
   - `id` uuid PK
   - `user_id` uuid FK → users
   - `domain` text
   - `dismissed_at` timestamp
   - `reinstated_at` timestamp nullable
   - Unique on (user_id, domain) where reinstated_at is null
3. **questions:** Add `surface_priority_score` float (or compute dynamically from thumbs-up count).
4. **feed_items.source_type enum:** the value `authored_shared` is no longer written by application code. Existing rows are migrated to `friend_answered` if they reference questions answered by their `source_user_id`, or soft-deleted otherwise. Enum value persists for safety; no schema migration required.

---

## §8.4 — Knowledge Base (multiple revisions)

### 8.4.1 Definition (unchanged)

The Knowledge base is the union of:
1. **Declared interests** (player chooses, max 5 at onboarding, eligible for Daily Five immediately)
2. **Demonstrated domains** (accrued via friend-mediated correct answers OR via authorship — see §8.4.3)

### 8.4.2 Declared Interests — REVISED

Hard cap: 5. Enforced at onboarding (§7.3) and during the swap flow.

**v11.1 change:** Declared interests are no longer treated as a first-class surfaced concept on the Knowledge page. After onboarding, "declared" status is metadata on a domain — used for analytics and for ensuring the LLM has eligible material on day one — not a UI category the player manages from the map view.

The swap flow (replacing one declared interest with another) moves to the Account page:

> Account → Manage interests

The system already treats declared and demonstrated domains identically once they exist — both feed Daily Five generation, both accumulate mastery, both render as circles on the Knowledge page. Surfacing the 5 as a permanent special category created a hierarchy that didn't match the underlying behavior.

**The 5-cap mechanic stays.** The "Your Declared Interests" section on the Knowledge page is removed.

### 8.4.3 Demonstrated Domains — Expansion Paths (REVISED)

A domain is added to the Knowledge base via two paths:

**Path 1 — Friend-mediated correct answer.**

A domain is added as demonstrated territory when the player correctly answers a question in that domain from:
- The Feed (friend answered, propagated automatically per §8.2.3)
- A direct send-to-friend message
- A Joshing Game

LLM-generated Daily Five questions cannot add new domains via this path. They can only deepen mastery in existing Knowledge base domains.

**Path 2 — Authorship.**

A domain is added as declared territory when the player writes and saves a question in that domain. A friend correctly answering that question promotes it to demonstrated territory. These are tracked separately.

| Territory type | How earned | Daily Five weight | Mastery points |
|---|---|---|---|
| Declared (from authorship) | First question written in domain | Lower (start at 0.5x) | None from writing |
| Demonstrated | Friend-mediated correct answer; OR authored declared promoted via friend correct | Full (1.0x) | Via play only |

**Rationale:** if you can write a factual question about a domain, you know that territory. Waiting for a friend to introduce you to your own knowledge is the wrong mechanic. But social validation — someone answering your question correctly — still means something, and is reflected in the promotion from declared to demonstrated.

**Hard rules:**

1. **One door per domain.** Writing the first question in a domain opens it as declared. Writing additional questions in the same domain does nothing additional to the KB. The check is: does this domain already exist in this user's KB (declared or demonstrated)? If yes, skip.

2. **Writing never generates mastery points.** The existing 0.75x authorship weight applies only when others answer your questions correctly — not to the act of writing itself.

3. **Thumbs-up does not open territory.** Thumbs-up is a question quality signal only.

4. **Authorship does not bypass hyper-specific categorization.** The LLM-assigned domain must meet the same specificity standard as any other domain (§8.4.6).

Friends are the primary mechanism of intellectual expansion through play; authorship is the self-directed alternative.

**Ceremony impact:** Beat 2 ("What You Discovered") uses distinct copy by source:
- Friend-mediated demonstrated: "You found new ground in [Domain]. From a question [Friend] sent you."
- Authored declared: "You opened [Domain]. You wrote the first question there."
- Authored → promoted to demonstrated: "[Domain] is now proven territory. [Friend] answered your question."

### 8.4.4 The 1-Question Floor — minor update

A demonstrated domain becomes eligible for Daily Five generation after 1 correct answer in that domain (or 1 authored question saved to bank — see §8.4.3 Path 2). The floor applies equally to both paths.

### 8.4.5 — 8.4.7 (unchanged)

Quiet accrual, hyper-specific categorization, and domain merge/split rules are all unchanged from v11.0.

### 8.4.8 Knowledge Page Display — REVISED

The Knowledge page uses the circles-by-category display. Domains are organized as labeled category clusters (Classical Music, World History, Literature, Film & Television, etc.). Each domain renders as a circle.

**v11.1 change:** Circle sizing is tier-anchored, not points-only.

**Previous v11.0 behavior:** circle diameter scaled linearly with accumulated points within the current tier. An Establishing-tier domain with substantial early-stage points could visually rival a Solid-tier domain — failing to communicate where actual depth lived.

**New sizing rule:**

| Tier | Diameter range | Notes |
|------|---|---|
| Establishing | 18px → 28px | Small dots |
| Familiar | 32px → 48px | Modest |
| Solid | 52px → 72px | Prominent |
| Mastery | 76px → 96px | Dominant |

Within each tier, intra-tier variance scales linearly by points-toward-next-tier. So an Establishing domain with 5 points renders at 18px; an Establishing domain near tier crossing renders at 28px.

**The visual rule:** tier matters first, points within tier matter second. A glance at the page should immediately reveal where the depth is.

*(Diameter ranges are guidance for implementation — final values may be tuned in the build to fit available canvas space across screen sizes. The principle is the discrete tier-based jumps, not the exact pixel values.)*

**Visual treatment for declared territory** (per §8.4.3 Path 2): authored declared domains render with a muted or outlined fill to distinguish them from full-color demonstrated domains. Promotion to demonstrated turns the fill to full color.

### 8.4.9 Personal Rounds (unchanged)

### 8.4.10 Adjacent Domain Discovery — NEW SECTION (deferred)

Adjacent domain discovery is the ability for Joshing to surface a related domain after a player engages deeply with an existing one — e.g., a player deep in Andrew Lloyd Webber 1980s Musicals might be offered "Stephen Sondheim" or "French Musical Theatre of the 1980s" as a suggested expansion.

**This feature is explicitly deferred to post-launch.** It is noted here to avoid designing the KB schema in a way that forecloses it, and to establish the design constraint when it is built: one suggestion, dismissible, opt-in only. Never automatic KB expansion.

**The risk to avoid:** algorithmic reach that feels like the product deciding your intellectual world. Adjacent suggestions must feel like a quiet offer, not a recommendation engine.

**Design questions to resolve before building:** trigger condition (N correct answers? tier crossing?), suggestion surface (inline after session? standalone?), whether dismissed suggestions can resurface, whether accepted suggestions open the KB automatically or require a correct answer first.

### 8.4.11 Grow Your Map — NEW SECTION

A quiet card at the bottom of the Knowledge page, titled **"Grow your map."**

The map's growth mechanic — Knowledge base expansion through friend-mediated correct answers and authorship — is the central social hook of Joshing. But in the v11.0 build it was invisible. A new player saw their five declared interests and had no signal that the map was supposed to grow, let alone how.

This section makes the mechanic legible.

**Copy:**

> **Grow your map**
>
> Your map grows whenever you correctly answer a question that came through a friend — from your Feed, from a direct send, or from a Joshing Game.
>
> It also grows when you write a question yourself. The domain you wrote in opens as declared territory. When a friend answers it correctly, it becomes proven.
>
> One way to start: ask a friend about something you'd love to learn from them — Disney World, 1970s BBC Drama, the 1956 Hungarian Uprising. The ask itself plants the seed.

**Two action buttons:**
- **[Send a friend a question]** → opens the write-and-send composer (QuestionForm with friend picker, Send-to-specific-friend mode)
- **[Write a question]** → opens the standard write flow (saves to bank, opens declared territory in your KB per §8.4.3 Path 2)

**Visual register:** muted card, no exclamation marks, no animations. The copy is the substance.

**This section replaces the dedicated declared-interests section on the Knowledge page** (§8.4.2).

### Schema additions for §8.4

Add `territory_type` enum (declared | demonstrated) to `knowledge_base_domains` table (or equivalent). Existing domains added via correct friend-mediated answers are demonstrated. Domains added via authorship are declared until a friend answers the question correctly, at which point they upgrade to demonstrated.

---

## §8.5 — Question Creation (revised)

### 8.5.1 The Write Flow (unchanged structure, see §8.5.2 for destinations)

### 8.5.2 Destinations — REVISED

**v11.1 destinations:**

| Destination | Default | Effect |
|---|---|---|
| Save to bank | ON (locked, can't be turned off) | Question saved to player's bank; opens declared territory in player's KB if domain is new (per §8.4.3 Path 2) |
| Send to specific friends | OFF (toggleable; opens picker) | When toggled ON: question is sent directly to selected friends, pinned in their Feed, with SMS notification per §8.3 |

**Behavior:**
- **Save to bank is mandatory.** Every authored question lives in the player's bank. There is no "send-only-don't-keep" mode.
- **The "Share with friends" / broadcast destination from earlier v11.1 drafts is not included.** Authored questions reach friends through the play graph (§8.2) or through explicit direct-send.
- **Specific-friend sends create direct_sent FeedItems** (pinned, SMS-triggering, per §8.3).

**Helper text below the destinations panel:**
- **Default state (bank only, no sends):** "Saved to your bank. It opens [Domain] as declared territory on your map."
- **Specific-friend toggled on:** "Sent directly to the friends you pick."

**Toast on save:**
- **Bank only:** "Saved to your bank."
- **Specific-friend send:** "Sent to [N] friend[s]."

### 8.5.3 — 8.5.5 (unchanged)

The bank, add-to-bank import flow, and LLM answer suggestion are unchanged.

---

## §8.9 — Intellectual Alignment (minor update)

### 8.9.2 Calculation — clarification

Remove "Questions A thumbed up that B also thumbed up" from the alignment input list. Thumbs-up is a private quality signal (§8.2.10) and does not contribute to per-pair alignment.

**Alignment inputs are now:**
- Questions A wrote that B answered correctly (and vice versa)
- Questions both A and B answered correctly in the same domain
- Domains both A and B have demonstrated activity in (per Knowledge base)
- Weighted by depth of demonstrated activity (Solid > Familiar > Establishing)

---

## §8.11 — SMS Notifications (revised)

| Trigger | Copy | Default |
|---|---|---|
| OTP for auth | Your Joshing code: NNNNNN | Always |
| Daily Five ready | Your five for today. [link] | ON, opt-out |
| Friend sent you a question | Greg sent you a question. [link] | ON, opt-out |
| Friend thought your question was excellent (thumbs-up) | Maya thought your Sondheim question was excellent. | OFF, opt-in |
| Friend answered your question (NEW) | Robyn answered your Mrs. Dalloway question. | OFF, opt-in |
| Friend reaction to your question | Greg reacted to your question. | OFF, opt-in |
| Friend invitation accepted | Maya joined Joshing — you're now friends. | ON, opt-out |
| Friend request received | Greg wants to be friends on Joshing. [link] | ON, opt-out |
| Biweekly ceremony ready | Two weeks of Joshing. Here's what you've been up to. [link] | ON, opt-out |

The "Friend answered your question" trigger fires when a friend correctly OR incorrectly answers a question this user wrote. Default OFF to avoid noise; opt-in for users who want to be notified of every play of their authored questions.

---

## §8.12 — Home & Navigation (unchanged structure, one addition)

The 5-item nav (Home / Feed / Knowledge / Activities / Account) is unchanged. The **Manage interests** entry point added in v11.1 lives inside the Account tab — it is not a top-level nav change.

---

## §10 — Data Model (clarifications + small additions)

### Schema changes summary

| Table | Change |
|---|---|
| users | + birth_year (int, nullable), + grew_up_country (varchar, nullable), + grew_up_region (varchar, nullable) |
| feed_items | + source_result (enum correct \| incorrect, nullable). Existing source_type enum value authored_shared retained for migration safety, no longer written by application code. |
| dismissed_domains (NEW) | id, user_id, domain, dismissed_at, reinstated_at; unique (user_id, domain) where reinstated_at is null |
| questions | + surface_priority_score (float, optional — may be computed dynamically) |
| knowledge_base_domains | + territory_type (enum declared \| demonstrated) |
| daily_answers and equivalent answer tables | + quip (varchar(100), nullable) |

### 10.2 QUESTIONS.is_shared_to_friends — clarification

This boolean is set to TRUE when the question is sent to one or more specific friends (direct_sent). It is a persistent flag indicating the question entered the social graph; it does not affect Feed propagation logic directly (FeedItem rows handle that) but is used in archive filters and analytics.

The earlier v11.1 draft proposed that this flag also be set on broadcast share. Since broadcast share is killed, that path is moot — only direct-send sets the flag.

---

## §11 — Plus Tier (unchanged)

The v11.0 recommendation against breaking the 5-interest cap as a Plus feature is reaffirmed. Now that declared interests are de-emphasized as a surfaced concept (§8.4.2), selling more interest slots makes even less sense — the player's experienced map is the demonstrated map, which is already uncapped.

---

## §15 — Success Metrics (additions)

### 15.2 New supporting metrics

**Authorship engagement**
- % of users who authored at least one question in their first 30 days
- % of authored questions that are direct-sent vs. bank-only
- Authored declared territory promotion rate: % of declared domains that get promoted to demonstrated within 30 days of opening
- Target: promotion rate > 40%. If lower, the social graph isn't picking up authored questions, and we may need to reconsider how authored questions reach friends.

**Feed engagement (revised under new propagation model)**
- Feed item engagement distribution: Answer / Skip / Dismiss / Not my focus rates
- Re-engagement after "Not my focus": % of dismissed domains ever re-opened (signal that filtering was over-aggressive)
- Target: Answer rate > 25% of impressions.

**Map growth velocity (clarified)**
- Demonstrated domains added per active user per month — from friend-mediated correct answers
- Declared domains added per active user per month — from authorship
- Useful signal: if declared >> demonstrated, the social loop is weak; if demonstrated >> declared, authorship isn't being used.

### 15.3 Anti-metrics (unchanged)

---

## §16 — Open Questions (additions)

### 16.11 Authorship Daily Five weight ratio — NEW

**Status:** unresolved. v11.1 §8.4.3 specifies declared territory at 0.5x Daily Five weight relative to demonstrated at 1.0x. The exact ratio is a server-side configurable. Adjust after first 50 season completions based on whether Daily Fives feel "stuck" on declared domains or too quickly drift to lightly-demonstrated ones.

### 16.12 First-question orientation copy — NEW

**Status:** copy needed. The first time a player writes a question, a one-time orientation panel should appear:

> Heads up: writing a question opens that domain as declared territory on your map. When a friend answers it correctly, it becomes proven territory. You can also send the question directly to specific friends — toggle that on the destinations panel below.

Dismissible, shown once per account, never repeats. Copy needs a final pass.

### 16.13 Circle sizing across screen widths — NEW

**Status:** the v11.1 tier-anchored sizing ranges (18-28px Establishing through 76-96px Mastery) assume a desktop / tablet canvas. On narrow mobile screens with many domains, even the small Establishing dots may collide.

**Resolution:** implementation should scale all four ranges proportionally to the available canvas width, preserving the ratio between tiers (Mastery circles always ~3-4× Establishing diameter) rather than the absolute pixel values.

### 16.14 Whether authored questions need a propagation path beyond direct-send — NEW

**Status:** v11.1 explicitly killed broadcast share. Authored questions reach friends through (a) direct-send or (b) someone in the play graph eventually answering them. If the play-graph path turns out to be too slow or sparse, we may need to reintroduce a lighter-weight broadcast mechanism. Watch the §15 "authorship engagement" metrics — particularly the declared-to-demonstrated promotion rate.

### 16.15 Quip bank size and refresh cadence — NEW

**Status:** the per-answer quip lists in §8.1.14 are starter sets of 3-5 quips per context. Repetition will become noticeable within ~2 weeks of daily play. Decision needed: ship with the starter set and tolerate repetition; expand the set to 15-20 per context before launch; or build an LLM-generated quip mode where each quip is novel.

**Recommendation:** ship with starter set; expand to 10-15 per context based on user complaints in the first 30 days. LLM-generated quips are deferred — quality and tone consistency are too risky.

---

## Glossary additions

| Term | Definition |
|---|---|
| Specific-friend send | A question sent to one or more specific friends, pinned in their feeds, with SMS notification |
| Friend-answered Feed item | A Feed item created when a friend answers any question (correct or wrong) — the primary v11.1 propagation mechanism |
| Quality signal | Thumbs-up or thumbs-down post-answer; affects surface priority but does NOT propagate questions |
| Declared territory | A KB domain opened by writing the first question in that domain; lower Daily Five weight; not yet socially validated |
| Demonstrated territory | A KB domain accumulated via friend-mediated correct answers, OR a declared territory that was promoted by a friend correctly answering the authored question |
| Not my focus | Permanent, domain-level Feed filter; reversible from Knowledge page |
| Cultural anchor | The birth year + region collected at onboarding to seed culturally-specific candidate interests |

---

## Document Status

**Version:** 11.1 (combined)  
**Date:** May 2026  
**Replaces:** Sections of v11.0 as enumerated above. Supersedes both individual v11.1 source documents (the earlier "five refinements" diff and the later "feed redesign + onboarding + commentary" update).

**Source of changes:** Two design sessions in May 2026, combined here. Major architectural shift: Feed propagation is now friendship-based, not endorsement-based. All other changes are surface-level refinements that align cleanly with that shift.

**Next planned revision:** v11.2, post-launch, incorporating empirical findings on:
- Authorship engagement rates and declared→demonstrated promotion (§15)
- Whether the play-graph propagation path is fast enough or whether broadcast needs to return (§16.14)
- Circle sizing on mobile (§16.13)
- Quip repetition tolerance (§16.15)

---

## Implementation status as of v11.1 publication

Several prompts have been drafted for the build:

- **Prompt 8.6 (earlier draft)** — partially superseded. Its thumbs-down clarity copy survives. Its "broadcast share" toggle does NOT survive — Prompt 8.6 should be reissued without the broadcast share destination, and with a new task to remove any broadcast-share UI that the earlier prompt may have already created.

- **Prompt 8.7** — survives intact. Implements §8.4.2 (declared interests demotion), §8.4.8 (circle sizing), and §8.4.11 (Grow your map section).

- **A new prompt is needed** to implement the §8.2 Feed redesign, §7.3 onboarding revision, §8.1.14 commentary system, and §8.4.3 authorship-opens-territory. These are substantial changes that should each be a discrete prompt.
