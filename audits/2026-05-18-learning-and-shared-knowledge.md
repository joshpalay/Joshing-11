# Game-Wide Audit — Reinforcing Learning and Shared Knowledge

Date: 2026-05-18
Scope: 50 surfaces across the player journey, audited under two lenses (learning reinforcement, shared knowledge reinforcement). No leaderboard / ranking proposals. Phase 1 = doable inside the current B1–B14 plan; Phase 2 = requires new data, endpoints, LLM workflows, or surfaces.

---

## Preface — three findings that thread through everything

1. **Mastery tier vocabulary is forked across three surfaces and none match the brief.** Internal enum: `establishing | familiar | solid | mastery`. `src/server/profile/knowledge-tier-copy.ts` exposes `Establishing / Familiar / Solid / Mastery` (knowledge page, profile, DomainRow). `src/server/db/queries/account.ts:26-31` and `src/app/knowledge/[domain]/page.tsx:53` use `Curious / Explorer / Scholar / Sage`. The in-session `MasteryMoment` (`src/components/review/MasteryMoment.tsx`) shows `Familiar / Solid / Mastery`. The brief specifies `Curious → Versed → Fluent → Master`. **This is the single most damaging inconsistency in the build.** A player crossing a tier in-session sees "Solid," then visits their profile and sees "Scholar," then opens the knowledge page and sees "Solid" again. Every audit proposal below assumes this gets resolved; the recommended canonical is the brief's `Curious → Versed → Fluent → Master` because it best reflects an inward learning journey rather than a credentialing ladder. Flagged as the first open question.

2. **The "common ground +" sub-labels referenced in the brief do not exist in code.** The actual rotation in `GameplayChat.tsx:86-91` is `shared signal / you both know this one / confirmed / same territory`. The brief's "now it's in yours too" wrong-answer line is also absent; the actual wrong rotation is `Not this time — here's the answer / You'll know this one next time / Nice try / Close, but not quite`. Several proposals below restore the brief's intended lines because they do more work on both lenses than what currently ships.

3. **Author identity is structurally underweight.** The author's display name surfaces in three places: a 0.6rem mono creator line above the in-session bubble; a `From {name}` label on summary cards; and the creator-note `A note from {name}:` prefix. Nowhere is the author treated as a *person who gave you something*. The "shared knowledge" lens is the entire identity of the product, and authorship is the load-bearing signal. This is the dominant cross-cutting opportunity.

---

# PRE-SESSION

### 1. Noon SMS notification

**Current state**
`src/server/sms.ts:245-259` and `src/server/sms.ts:70`. Three variants: `"{groupName} — up to 5 questions waiting. Your queue refills daily: {baseUrl}/play"`, `"{groupName} and {groupName} — questions waiting…"`, `"{groupName} and {N} other groups — questions waiting…"`. Cron line: `"Your five for today. {baseUrl}/daily"`. 160-char truncation.

**Learning reinforcement — opportunities**
- Surface one piece of *named* learning the day promises. Current → proposed (single group): `"{groupName} — 5 from your people, including {topDomainOfTheDay}. {url}"`. Phase 1 if `domains_present_today` is already computed by the daily picker; Phase 2 if not. **Impact: medium.**
- Avoid the word "questions" once in three; alternate with `"5 small things you don't know yet from {groupName}. {url}"` on a weekly cadence. Phase 1. **Impact: low.**

**Shared knowledge reinforcement — opportunities**
- Lead with the *people*, not the queue. Current → proposed: `"{authorFirstName} and {N} others wrote your five. {url}"`. Pulls authorship to the first beat and works under 160. Phase 1 — requires only "any author name from today's set" which the daily picker already has. **Impact: high.**
- For multi-group: `"From your people in {groupName} + {N} other groups. {url}"` — replaces "questions waiting" with the relational frame. Phase 1. **Impact: medium.**
- "Your queue refills daily" reads like a system message. Drop it; if anything, replace with `"Five today. Then nothing till tomorrow."` on a rotation. Phase 1. **Impact: low.**

**Risks**
SMS character budget is hard. Author-led copy fails gracefully if `creator.firstName` is missing — fall back to current `{groupName}` template.

**Surface priority: high.** First touchpoint of the day, currently fully utilitarian.

---

### 2. Home screen — game card layout and copy

**Current state**
`src/components/feed/FeedCard.tsx:106-205`. Stacked: author name (16px semibold) → italic category subtitle (12px Literata, 70% opacity) → question text (17px Georgia, line-clamp-4) → optional personal message (13px italic, 65% opacity) → "Answer →" button → metadata row. Friend-answered card (`FriendAnsweredCard.tsx:1-31`) uses copy from `FeedList.tsx:242-245`: `"{Friend} recognized this one. See if you share the same common ground."`

**Learning reinforcement — opportunities**
- The italic category subtitle is set at 12px / 70% opacity — visually weaker than the metadata row. Promote it: 13px, Playfair italic, INK at 85% opacity, positioned tight under the author line with a 4px gap; remove the "subtitle" feel and make it a *tag of what you're about to learn*. Phase 1. **Impact: medium.**
- Add a one-token difficulty whisper next to the category, mono uppercase 0.55rem, e.g. `LITERATURE · SPECIALIST` (using `difficultyCopyFromEstimate`). Already computed; just not surfaced here. Phase 1. **Impact: low.**

**Shared knowledge reinforcement — opportunities**
- The author name (16px semibold) is currently the strongest signal, which is correct. Reinforce it by appending a kerned mono micro-line under the avatar: `WROTE THIS FOR {groupName}` at 0.55rem, INK 60%. Phase 1 if `game.group.displayName` is on the card payload. **Impact: medium.**
- Replace `"{Friend} recognized this one. See if you share the same common ground."` with `"{Friend} just answered this. See if it's in your world too."` — keeps the relational frame, drops "common ground" repetition (which is overused across surfaces), and reinstates the brief's "in your world" cue. Phase 1. **Impact: medium.**
- For "still waiting for common ground" (`FeedList.tsx:190`): replace with `"No one's answered this yet. You'd be the first."` — turns a passive state into an invitation. Phase 1. **Impact: low.**

**Risks**
Don't let the difficulty whisper drift into ranking. "Specialist" is fine; "hard" is not.

**Surface priority: high.** Highest-traffic browse surface.

---

### 3. Anticipation signal during a game ("N rounds until the final reveal")

**Current state**
There is no anticipation signal. `GameplayChat.tsx:730-790` shows only a *post-round* "Round complete · Next round opens {nextRoundOpensAt}". `useCatchupFlow.ts:273` shows `"{items.length} of {total} remaining"` — but only inside catchup, not in the live game.

**Learning reinforcement — opportunities**
- Add a tiny in-thread chyron after every 3rd question: `3 OF 5 · 2 MORE TILL YOUR SUMMARY` mono 0.55rem, INK 55%, centered, no border. The point is to set up the explainer beat as *earned*, not surprise dessert. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The ceremony already has a final reveal; the daily session doesn't have a "shared moment" to anticipate. Add a one-line tease on the last question of the day: `LAST ONE TODAY · {N} answered before you` (no names, no rank, just count of friends who reached the same question). Phase 1 if `priorAnswerersCount` is computable from `answers` on this `gameQuestion`; Phase 2 if not. **Impact: high.**

**Risks**
"X answered before you" can slip into a competitive frame if it becomes "X already got it right." Keep it strictly counted-touched, never counted-correct, on this surface.

**Surface priority: medium.** Currently zero — anything is an upgrade — but not the highest-leverage place to invest.

---

# DURING THE SESSION

### 4. Question bubble

**Current state**
`GameplayChat.tsx:130-271`. Visual hierarchy from top: optional subhead (0.58rem mono) > creator name (0.6rem mono, muted) > question text (0.98rem serif, in a grey `surface-2` bubble) > difficulty badges (0.52rem mono, "Establishing / Solid / Master"). Author is whispered. Category is **not shown at all** in the bubble.

**Learning reinforcement — opportunities**
- **The category is missing from the most-viewed surface in the game.** Add a single Playfair-italic line *above* the question text, 0.85rem, INK 70%, e.g. `Late Tchaikovsky.` Set with a period to read as editorial, not a tag. Phase 1 — `gameQuestion.canonicalSubcategory` is already on the payload. **Impact: high.**
- The "Establishing / Solid / Master" badge labels collide with the global mastery-tier vocabulary. Rename the per-question difficulty labels to `ACCESSIBLE / MODERATE / SPECIALIST` (matching the brief's weighting 1/2/3). Phase 1. **Impact: medium** — removes a confusable.

**Shared knowledge reinforcement — opportunities**
- Promote the creator name from 0.6rem mono whisper to 0.78rem Caveat handwriting, INK 80%, prefixed `from `. Reads as a signed gift. Phase 1. **Impact: high.**
- Optional secondary stamp under the author line (only when present): `WRITTEN {N} DAYS AGO` mono 0.5rem — makes the question feel like a piece of someone's recent thinking, not a database row. Phase 1 if `question.createdAt` is on the payload; almost certainly is. **Impact: low.**

**Risks**
Adding category + creator above the bubble inflates the question's vertical footprint. Test on a 360px viewport with a 3-line question — Caveat at 0.78rem + italic category at 0.85rem + 0.98rem serif bubble is still <130px of stack, which is fine.

**Surface priority: high.** This is the question. The single highest-leverage surface in the game.

---

### 5. Skip mechanic surface

**Current state**
`GameplayChat.tsx:137,229-268`. Button copy: `"Skip - don't show again"`. Mono 0.58rem muted, underlined. After dismiss: `"Skipped"` in same style.

**Learning reinforcement — opportunities**
- Skip should not erase the learning beat. After skip, before the next question loads, show a one-line ghost in the thread: `You skipped {italic category}. We'll surface a recap in your review.` 0.7rem mono, 50% opacity, 1.5s. Phase 1. **Impact: medium.**
- In end-of-session review, the skipped question's row should still show the explainer with the framing `"You skipped this — here's what it was about."` Phase 1; surfaces in #11. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Current copy: `"Skip - don't show again"`. Reads as if the *author* is being dismissed. Soften to: `"Not for me today"` (skip for now, may reappear) and a second link `"Not in my world"` (true permanent skip — domain-level signal). Two states; Phase 1 for copy split. **Impact: medium.**
- When the second option is used, log domain-level "not in my world" signals; do NOT message the author. Phase 2 (needs data model field). **Impact: medium.**

**Risks**
"Not in my world" as opt-out signal must never surface to the author — would chill question creation. Strictly internal.

**Surface priority: medium.**

---

### 6. Answer submission moment

**Current state**
`src/app/games/[id]/play-client.tsx:192-211`. Placeholder `"Your answer..."`. Submit button `"Send"`, becomes `"..."` when pending. Sticky footer, 95% bg opacity, backdrop blur.

**Learning reinforcement — opportunities**
- Placeholder should narrow possibility space slightly. Current `"Your answer..."` is generic. Rotate placeholder by difficulty: ACCESSIBLE → `"Type what you know"`, MODERATE → `"Best guess works"`, SPECIALIST → `"Even a fragment counts"`. Phase 1. **Impact: low.**

**Shared knowledge reinforcement — opportunities**
- "Send" reads like email. Replace with `"Answer"` (more natural to the moment) or alternate `"Tell {firstName}"` on questions where the author is in the group (i.e. they'll see your result). Phase 1 — author name is already in scope. **Impact: medium.** This is the single tightest place to make the player feel they're *responding to a person*, not submitting to a system.

**Risks**
"Tell {firstName}" creates an expectation that the author sees the answer. If the relational feedback surface is not yet routing per-answer signals, this could read as a promise the product doesn't keep. Verify route before shipping.

**Surface priority: medium.**

---

### 7. Result reveal — correct

**Current state**
`GameplayChat.tsx:86-91, 612-622`. Headline rotation (4 variants): `Nice pull. / Right on. / Locked in. / Exactly.` Sub-label rotation: `shared signal / you both know this one / confirmed / same territory`. Green ✓, serif headline, mono sub-label 0.55rem. Optional `RelationalFeedbackFade` line, italic 0.78rem, fades after 2.5s.

**Learning reinforcement — opportunities**
- Add a fifth headline variant that names the *domain* not the performance: `That's {italic category}.` (Playfair italic for the category). Phase 1. **Impact: medium** — first time a correct answer names what was learned in-bubble.
- Mirror the breadcrumb treatment already present on wrong (the `FROM {author}` + canonical breadcrumb). Currently correct reveals get no breadcrumb. Add it as an opt-in tertiary line: italic serif 0.78rem with the canonical phrasing. Phase 1; data already exists. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Sub-label rotation should foreground the author at least 1 in 4. Add: `{firstName} knew you'd know this.` 0.55rem mono small caps with the name in italic Caveat. Phase 1. **Impact: high** — makes correctness feel like a *meeting*, not a score.
- "confirmed" is the weakest variant — system language. Replace with `in both your banks now`. Phase 1. **Impact: medium.** Restores the brief's intended "now it's in yours too" register.
- The brief's expected sub-label "common ground +" is not in code. If kept as a system, set it as a one-off treatment: small `+` icon next to the sub-label, 0.6rem Caveat, accent color — *only* when the player has answered ≥3 from this author in the cycle. Phase 1 for visual; Phase 2 if counting logic isn't already in scope. **Impact: medium.**

**Risks**
Five variants is the upper limit before rotation becomes legible as a system. Hold there.

**Surface priority: high.** Highest-frequency positive moment in the loop.

---

### 8. Result reveal — wrong

**Current state**
`GameplayChat.tsx:93-102, 634-679`. Headline rotation: `Not this time — here's the answer. / You'll know this one next time. / Nice try. / Close, but not quite.` Bold `Answer:` label, italic consolation quip (0.88rem muted), optional `FROM {author}` breadcrumb in italic serif 0.78rem. `"Recheck my answer"` button.

**Learning reinforcement — opportunities**
- The headline rotation does *no* learning work — it consoles. At minimum one variant should name the territory: `Now you know one more thing about {italic category}.` Phase 1. **Impact: high.**
- Promote the canonical breadcrumb from 0.78rem to 0.92rem and pin it directly under the `Answer:` line, before the consolation quip. The breadcrumb is the highest-density learning surface in the entire in-session experience and is currently buried. Phase 1. **Impact: high.**
- The brief specified the rotation should include "now it's in yours too." Add it as a sub-label, mono 0.55rem, INK 65%, under the breadcrumb. Phase 1. **Impact: high.**

**Shared knowledge reinforcement — opportunities**
- The `FROM {author}` line is small-caps mono 0.5rem — basically illegible weight. Promote to 0.7rem Caveat italic with a real preposition: `From {firstName}.` Phase 1. **Impact: high.**
- Add a sub-label rotation that names the relational stake: `{firstName} thought you might. / {firstName}'s world includes this. / {firstName} answered correctly when they wrote this.` 0.6rem mono. Phase 1. **Impact: high.** Turns a miss into evidence that the *author* sees you as someone who might.

**Risks**
"{firstName} thought you might" can read as patronizing if the question was specialist. Guard it: only on ACCESSIBLE / MODERATE difficulty. SPECIALIST wrong answers get `{firstName}'s world includes this.` instead.

**Surface priority: high.** This is the single highest-leverage surface in the entire product — wrong-answer reaction rate is the north star and current treatment is mostly consolation, almost no learning, light authorship.

---

### 9. Mid-session transition between questions

**Current state**
`play-client.tsx:150-168`. 850ms silent pause, then next question fades in. No bridge text, no skeleton.

**Learning reinforcement — opportunities**
- Honor the chat-thread principle (terse, explainers belong end-of-session). Don't push learning here. Add one tiny micro-moment only: a single-frame italic line "·" → next question's italic category appears for 200ms before the question text — pure typographic foreshadow. Phase 1. **Impact: low.**

**Shared knowledge reinforcement — opportunities**
- Avoid this surface entirely. Author reveal lives in review, per existing principle.

**Risks**
Adding visible bridge text breaks the terse-thread principle. The 850ms silence is correct.

**Surface priority: low.** Already correct in spirit.

---

### 10. Mastery tier-crossing mid-session

**Current state**
`MasteryMoment.tsx:14-19`. Does NOT fire mid-session — fires on `/games/[id]/summary` only. Full-screen beige (#f5f0e8) overlay, centered serif, 30ms + 420ms fade, auto-dismiss at 2600ms. Copy: `"{subcategory}. You're finding your ground." / "…You move through this naturally now." / "…This one's yours."`

**Learning reinforcement — opportunities**
- Don't move it into the session. The principle of post-game beat is correct. Instead: name a *micro-moment* in the thread that *foreshadows* a possible crossing, only after the answer that completes a tier. One italic line in the thread: `Something tipped over in {italic category}.` 0.78rem, INK 70%, no overlay. Phase 1 if cross-detection runs per-answer; otherwise Phase 2. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The `MasteryMoment` copy is entirely individual. Add a fourth variant for tiers crossed in domains where the *author* is also at solid/mastery: `"{subcategory}. You and {firstName} now both carry this."` Phase 1. **Impact: high.** Lands the entire shared-knowledge thesis in one screen.
- Vocabulary: "Familiar / Solid / Mastery" here, but other surfaces use different names — see preface. Resolve before shipping new copy.

**Risks**
Tier-crossing copy in the wild today already conflicts with the knowledge-page and account-page vocabulary. Adding shared-knowledge variants compounds the inconsistency until tier names are unified.

**Surface priority: high** (because of the inconsistency, not the current copy quality).

---

# END OF SESSION

### 11. End of Session Review — per-question card

**Current state**
`src/app/daily/summary/page.tsx:298-507`. Per row: status badge top-left (CORRECT / WRONG / SKIPPED), domain top-right muted: `JOSHING BOT · {DOMAIN.UPPER}`, large question text, your-answer / correct-answer side-by-side, explanation in muted box, optional creator note in slightly-more-prominent box.

**Learning reinforcement — opportunities**
- The domain string `JOSHING BOT · {DOMAIN}` reads as system metadata. Replace with **two stacked lines**: top line `{italic category}` Playfair italic 1.1rem (left-aligned, above the question); bottom line removed. The domain becomes editorial content, not header chrome. Phase 1. **Impact: high.**
- Explanation is rendered in `bg-muted/35 text-muted-foreground` — visually subordinate to the answer comparison. Promote: same INK color as body, no muted background; lead with a Playfair italic kicker `Why.` 0.7rem above the explanation. Phase 1. **Impact: high.** This is the densest learning surface in the entire game.
- Group the day's cards by domain into 2–3 clusters with editorial headers (`Late Tchaikovsky.`, etc.). Phase 1 grouping; Phase 2 if it requires re-ordering of source data. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The author appears *only* inside the creator-note label (`"A note from {authorName}:"`). Add a primary author line at the top of every card, beneath the italic category: `From {firstName}.` Caveat handwriting 0.95rem, INK 80%. Phase 1. **Impact: high.**
- For correct answers, append a one-line shared-state ribbon: `In {N} banks now.` mono 0.55rem. Phase 1 if "answered_correctly_total" is per-question on the payload; Phase 2 otherwise. **Impact: medium.**

**Risks**
Promoting the explainer is *not* a violation of "explainers live in end-of-session" — it's exactly where the principle says it should be. The risk is overwhelming the card; manage by stacking author + category as a 2-line editorial header, not as side metadata.

**Surface priority: high.** Densest learning surface in the loop; currently most underdelivered.

---

### 12. Author reveal moment

**Current state**
`src/app/games/[id]/summary/page.tsx:267-269`. Static label in header: `From {view.creator.displayName}` or `From the question bank`. No animation.

**Learning reinforcement — opportunities**
- Skip — this isn't a learning surface.

**Shared knowledge reinforcement — opportunities**
- Promote to a beat-level moment on the *daily* summary page (not just game summary). At the top of the per-question card, before the question is shown, render: blank → italic `From {firstName}.` (350ms fade-in, 600ms hold) → question fades in. Phase 1; pure CSS. **Impact: high.**
- `"From the question bank"` is system language and breaks the "named consent" thesis when it shows. If a question is from the bank, the bank entry has an original author — use that. Replace with `From {originalAuthorFirstName}, originally.` Phase 1 if origin is preserved; Phase 2 if origin is lost on bank intake. **Impact: high.**

**Risks**
The 350ms animation must be skippable on reduced-motion preference.

**Surface priority: high.**

---

### 13. Educational explainer (truncated + expand)

**Current state**
`src/app/daily/summary/page.tsx:436-439`. Full text rendered if present. No truncation, no expand UI. Styled `bg-muted/35`, `text-muted-foreground`.

**Learning reinforcement — opportunities**
- Truncation isn't the problem — visual weight is. Replace `text-muted-foreground` with `text-foreground` at 90%. Phase 1. **Impact: high.**
- Add Playfair italic kicker `Why.` above the prose, 0.78rem, INK 70%. Phase 1. **Impact: medium.**
- Optional `Read more →` expand only if explanation > 280 chars. Don't add it pre-emptively. Phase 1. **Impact: low.**
- Tag explanation with one further-reading affordance: `More on {italic category} →` linking to `/knowledge/{domain}`. Phase 1. **Impact: medium** — closes the loop between question and domain.

**Shared knowledge reinforcement — opportunities**
- When the author wrote the explainer themselves (vs LLM-generated), surface that: small Caveat marginalia `in {firstName}'s words` at 0.7rem, right-aligned next to the kicker. Phase 1 if explanation source is tracked; Phase 2 otherwise. **Impact: high.**

**Risks**
Tagging `in {firstName}'s words` requires reliable provenance; if mis-tagged, it lies about authorship — that's worse than not tagging.

**Surface priority: high.**

---

### 14. Creator note treatment (collapsed for correct, expanded by default for wrong)

**Current state**
`src/app/daily/summary/page.tsx:441-447`. Copy: `"A note from {authorName}:"`. `bg-muted/40`, border, `text-foreground`. **No collapse behavior — same visibility correct or wrong.** Brief expects collapsed-when-correct, expanded-when-wrong.

**Learning reinforcement — opportunities**
- For wrong answers, the note IS the learning. Promote: drop the `bg-muted/40` to none, set the note text as 0.95rem Georgia italic, indented 12px with a thin left rule INK 25%. Phase 1. **Impact: high.**

**Shared knowledge reinforcement — opportunities**
- Implement the brief's collapsed-when-correct treatment. When correct: render the note as a 1-line teaser ending `…` in Caveat 0.7rem, INK 60%, with a `Read {firstName}'s note →` link. When wrong: expand by default. Phase 1. **Impact: high.**
- Replace `"A note from {authorName}:"` with `"{firstName} added:"` — shorter, warmer, more sentence-like. Phase 1. **Impact: medium.**

**Risks**
Collapsing the note on correct can read as hiding the most relational element from the most positive moment. Counter-intuitively this is correct: when you knew it, the player owns the moment; when you didn't, the author's hand on your shoulder lands harder.

**Surface priority: high.**

---

### 15. Star voting surface

**Current state**
`src/app/daily/summary/page.tsx:464-482`. Heart icon, aria-label `"Love this question"`. No visible label. Filled = `bg-rose-50 text-rose-600`.

**Learning reinforcement — opportunities**
- A heart says nothing about *what* was loved. Replace single heart with two affordances: a Caveat micro-label appears on hover/focus offering `Loved this. Brilliant question. Stumped me right.` (single-select). Phase 1 if the existing schema supports a flavor on the vote; Phase 2 if it doesn't. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- A vote is meaningful only when the *author* sees it. On submit, micro-confirmation: `{firstName} will see this.` 0.7rem, INK 60%, 2s. Phase 1 if a per-author vote-aggregate already exists; Phase 2 if visibility-to-author is itself the new feature. **Impact: high.**
- Replace heart with a Caveat `★` star sketch — matches the brief's "star voting" register and feels more editorial. Pure visual; Phase 1. **Impact: low.**

**Risks**
If "star" votes are not already routed to the author's Authorship Impact beat, promising visibility is a lie. Verify route.

**Surface priority: medium.**

---

### 16. Standout moments — highest shared, "only you got this"

**Current state**
**Surface does not exist.** Codebase contains no "highest shared" or "only you got this" surface in the daily summary.

**Learning reinforcement — opportunities**
- Add a single editorial card at the top of the daily summary: a Playfair italic kicker `The day's piece.` + the single most-difficult question the player got right today, with its explainer in full. Phase 1 if "difficulty" + "correct" are joinable in the summary query (they are). **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Add two named beats *between* the score box and the per-question list:
  - `Everyone in your group got this one.` (where `correct_count == group_size`)
  - `Only you, today.` (where `correct_count == 1 && was you`)
  Both 1.2rem Playfair italic, no border, large vertical breathing room (40px). Phase 2 — requires per-question group-level aggregation that may not be in the daily summary payload. **Impact: high.**
- "Only you, today" must read as *territory*, not rank. Subtext: `Your corner of {italic category}.` Phase 2. **Impact: high.**

**Risks**
"Only you got this" is the closest a non-leaderboard product gets to ranking. Frame as territory (singular world) not as superiority. Drop the surface entirely if it can't be reliably framed that way.

**Surface priority: high.** Highest under-built surface in the entire product against the shared-knowledge lens.

---

### 17. Near-miss acknowledgment ("accepted variant")

**Current state**
**Surface does not exist.** Schema tracks `alternateAnswers` but the review UI does not surface variant acceptance.

**Learning reinforcement — opportunities**
- When a near-miss is accepted, treat the row as CORRECT in status but add a single Caveat marginalia in the right gutter: `{firstName} accepts this.` 0.7rem. Phase 2 — requires the answer-grading pipeline to flag "accepted via variant" distinctly from "exact match". **Impact: high.**

**Shared knowledge reinforcement — opportunities**
- The author is the source of "what counts." Lean into it: `"{firstName} would count this."` mono 0.6rem under the correct-answer line. Phase 2. **Impact: high.** Reframes correctness as a relational agreement, not a system verdict.

**Risks**
Some answers are accepted by the LLM grader without explicit author intent — using "{firstName} accepts" implies authorial agency that doesn't exist. Either rebuild grading to allow author-level variant marking (Phase 2) or use neutral phrasing: `Close enough — counted.`

**Surface priority: medium.**

---

### 18. Daily Summary — interpretive opening line

**Current state**
`src/app/daily/summary/page.tsx:71-125` (`interpretiveLine`). Examples: `"You moved to {tier} in {domain}." / "You found new ground in {newDomain.displayName}." / "Clean sweep." / "Every one of them. Tomorrow." / "Three in a row at one point." / "{domain} is worth a deeper look."` Rendered `text-muted-foreground`, italic, fade-in 0.4s.

**Learning reinforcement — opportunities**
- Promote the line. Currently muted + small (`text-sm`); make it 1.3rem Playfair italic, INK 90%, above the "How You Did" header. Phase 1. **Impact: high.** This is the editorial voice of the product and it's whispered.
- Add domain-named variants to the rotation: `"You met {italic domain} for the first time today." / "{italic domain} got a little wider today."` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- All current variants are personal. Add collective variants when conditions hold: `"You and {firstName} answered the same one differently today." / "{firstName} stumped two of you." / "Three of you crossed into {italic domain} this week."` Phase 2 — requires group-level joins in the summary build. **Impact: high.**

**Risks**
"Stumped two of you" is fine. Anything that names a *winner* between two players is not. Keep collective variants strictly to *shared state* facts.

**Surface priority: high.**

---

### 19. Daily Summary — score, compatibility shifts, vote summary, game progress

**Current state**
`src/app/daily/summary/page.tsx:200-237`. Header `"How You Did"` (1.45rem, weight 700, uppercase) + date + score line `"{correct}/{total} correct · {N} skipped"` (small mono). Below: `"Your Growth Recap"` with category circles. **No compatibility shifts shown. No vote summary shown.**

**Learning reinforcement — opportunities**
- Demote the score. Right now `"How You Did"` is the largest single piece of type on the daily summary, and it's a *score header*. Rename to `"Today's territory."` Playfair italic 1.45rem. Phase 1. **Impact: medium.** Reframes the entire page as a learning artifact, not a scorecard.
- Move the raw score box from full-width hero to a 33%-width sidebar element on desktop, a compressed row on mobile. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Add a missing "compatibility shifts" block: one line per friend whose overlap with you moved today. `Closer with {firstName} in {italic domain}.` 0.95rem serif. Phase 2 — needs `compatibility_delta` per friend per day, which the schema may or may not have. **Impact: high.**
- Add a missing "vote summary" block: `Two of your questions got starred today.` 0.95rem serif. Phase 1 if creator-stars aggregate is queryable. **Impact: high.**
- Game progress: where in the season am I? Add a single mono line: `Day 9 of 14 · {N} questions earned, {M} questions taught.` Phase 1. **Impact: medium.**

**Risks**
"Closer with {firstName}" is fine. "Closer with {firstName} than with {firstName2}" is ranking. Single-friend statements only.

**Surface priority: high.**

---

### 20. Share card — mastery momentum format (primary)

**Current state**
`src/components/ShareCard.tsx:57-122`. Kicker `JOSHING · TWO WEEKS` + date range. Centered: large serif points number (108px) + label `"points this cycle"`. Three highlight rows. Highlight templates: `"Crossed into {tier} in {domain}" / "Picked up {domain}" / "Closest to {displayName}" / "Earned {N} creator points" / "Learned from {displayName}"`. Fallback `"A quiet cycle still counts."`

**Learning reinforcement — opportunities**
- The 108px serif number is *points*. That's a score, not learning. Replace with the number of *new domains entered this cycle* (count of `new_territory == true` from `growthCircleItems`). Label: `new corners`. Phase 1 if growth data is available at share-build time. **Impact: high.**
- Add a "what you learned" line under the highlights, italic 0.9rem: `"You met {italic domain} for the first time."` (most-recent new territory). Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- "Closest to {displayName}" is the right impulse but uses "closest" — a comparative. Replace with `"Met {firstName} in {italic domain}."` (uses the strongest shared domain instead of the friend-most-aligned). Phase 1. **Impact: high.**
- "Learned from {displayName}" should name *what*: `"{firstName} taught you {italic domain}."` Phase 1. **Impact: high.**
- Add author credits to the bottom: small mono line `WRITTEN BY {firstName1}, {firstName2}, +{N}`. Phase 1. **Impact: medium** — turns the card into a thank-you, not a flex.

**Risks**
"Closest to" was carrying real product weight (intellectual alignment beat). Replacing it with a domain-named variant on the *share* card is fine, but the alignment beat itself still needs a friend name — keep the original copy in the ceremony, change it only here.

**Surface priority: high.** Externally visible.

---

### 21. Share card — emoji grid (secondary)

**Current state**
**Surface does not exist.** No emoji grid in `ShareCard.tsx`.

**Learning reinforcement — opportunities**
- The point of an emoji grid in the trivia-share genre (Wordle, Connections) is to make the *shape* of your day legible without spoiling the content. Joshing's equivalent should encode *domain mix*, not correctness. Build: a 1×5 grid where each cell is a colored square keyed to that question's broad category, with a `·` overlaid for SKIPPED and a `✓` overlaid only on cell 5 if the player crossed a tier. Phase 2 — requires share-card rendering changes and a tier-cross flag on the cycle payload. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The grid version of "shared knowledge" is a 1×5 grid where adjacent halves color from your color to the author's color — visualizing that each question is a meeting. Phase 2. **Impact: medium.**

**Risks**
Don't ship until the primary card is tight; an emoji grid alongside an unfocused primary card multiplies share-surface noise.

**Surface priority: low.** Secondary.

---

### 22. Session close messaging

**Current state**
`src/components/play/SessionCloseMessage.tsx:9-29`. `{closeCopy}` (1.22rem text) + primary button `"Review today's answers"` + optional muted link `"See your Knowledge page ->"`.

**Learning reinforcement — opportunities**
- `closeCopy` is a single field — no current visibility into rotations. Define a rotation that always names *something learned*: `"You met {italic domain} today." / "Two new things stuck. Review them?" / "{italic domain} got a little wider."` Phase 1. **Impact: high.**

**Shared knowledge reinforcement — opportunities**
- Add a rotation that names *who you met*: `"You answered three from {firstName} today." / "{firstName1} and {firstName2} both wrote for you today."` Phase 1. **Impact: high.**

**Risks**
None unique.

**Surface priority: medium.**

---

### 23. Next-questions countdown

**Current state**
`GameplayChat.tsx:730-790` shows `"Next round opens {nextRoundOpensAt}"` after a round; there is no countdown on the home/feed surface between sessions.

**Learning reinforcement — opportunities**
- Replace plain timestamp with a one-line tease: `Five new ones from your people at {time}.` 0.95rem serif. Phase 1. **Impact: low.**

**Shared knowledge reinforcement — opportunities**
- The wait should feel like waiting for a *gift*. Add an ambient single-line `Tomorrow: {firstName} and {N} others.` Caveat 0.85rem. Phase 1 if next-day authors are predictable from the queue; Phase 2 if next-day picks are not yet computed. **Impact: high.**

**Risks**
Pre-announcing tomorrow's authors removes some of the noon SMS surprise. Keep the SMS author-led too (#1) — they reinforce, not cannibalize.

**Surface priority: low.**

---

# BETWEEN SESSIONS

### 24. Question archive

**Current state**
`src/app/archive/page.tsx:206-346`. Header `"Your Archive"`, metadata `"{total} questions · {N} correct"`. Source filters: `All / Daily Five / Feed / Joshing Games / Sent to me / Mine`. Result filters: `All / Correct / Incorrect / Skipped`. Per-card: source label, result badge (`AUTHORED / CORRECT / WRONG / SKIPPED`), domain pill linking to `/knowledge/{domain}`, optional creator note `"A note from {name}:"`.

**Learning reinforcement — opportunities**
- Default sort is unspecified — switch to a curated "by domain" grouping, with each group headed by an italic Playfair `{domain}` and the count of questions you've touched in it. Phase 1. **Impact: medium.** Turns the archive into a learning atlas.
- The result badges `WRONG / SKIPPED` foreground the failure. Replace `WRONG` with `LEARNED` (only for wrong answers where the explainer was viewed; otherwise `WRONG`). Phase 2 — needs a `viewed_explainer` flag. **Impact: medium.**
- Add a "stumped us all" view (referenced in brief but not implemented): filter where `correct_count == 0 across the group`. Phase 2 — requires aggregation. **Impact: medium.**
- Add a "best questions" view: top-starred. Phase 2. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Add an `Authors` filter — view by who wrote it. `"Questions from {firstName}"` becomes a real cross-cutting lens. Phase 1 if `creatorId` is already on the row payload (it is). **Impact: high.**
- "Sent to me" / "Mine" are utilitarian. Rename to `From friends` / `Yours`. Phase 1. **Impact: low.**

**Risks**
Renaming `WRONG → LEARNED` is a value statement. Verify with the team before shipping; a player who didn't open the explainer hasn't actually learned anything.

**Surface priority: medium.**

---

### 25. Knowledge page — spider graph for top 8 domains

**Current state**
`src/components/knowledge/PortraitCircles.tsx`. Circles organized by tier and broad category, sized by `totalMasteryPoints`. Tier display set: `Establishing / Familiar / Solid / Mastery`. Hard-coded color palette per broad category.

**Learning reinforcement — opportunities**
- The portrait visualizes *territory size* but not *direction*. Overlay a small Caveat handwriting arrow on the most-recently-grown circle: `growing` or `just entered`. Phase 1 if `last_grown_at` is computable; Phase 2 otherwise. **Impact: high.**
- Tier vocabulary: resolve to one set (see Preface). If using the brief's `Curious → Versed → Fluent → Master`, that lands harder here than the current "Mastery" terminus, which reads slightly grandiose for ~50 questions in a domain. Phase 1. **Impact: high** (cross-surface).

**Shared knowledge reinforcement — opportunities**
- Circles currently show your own mastery only. Overlay a thin Caveat outline of the *group's average* in that domain — a second circle, dashed, 1px. Phase 2 — requires group aggregation in the portrait payload. **Impact: high.** Lets a player see at a glance "we know X together; I'm farther in Y."
- For each circle, a 0.6rem mono caption: `WITH {firstName} + {N}` listing who else has answered in this domain. Phase 2. **Impact: high.**

**Risks**
Group-average overlay must never be sortable, rankable, or comparable across players. It's a backdrop to the player's own circle, not a benchmark.

**Surface priority: medium.**

---

### 26. Knowledge page — list of remaining domains

**Current state**
`src/components/knowledge/DomainRow.tsx:25-89`. Row: domain name 1rem, progress bar, `"Your q's"` dot grid (5 dots), tier label (`KNOWLEDGE_TIER_LABEL[tier]` or `"New territory"`), points count, chevron, optional `Declared` badge.

**Learning reinforcement — opportunities**
- The tier label is currently below the progress bar — buried. Promote to the right-hand side, top-aligned, mono uppercase 0.65rem, INK 70%. Phase 1. **Impact: medium.**
- `"Your q's"` is too cute to read at a glance. Replace with `Authored` and a count, e.g., `3 authored`. Phase 1. **Impact: low.**

**Shared knowledge reinforcement — opportunities**
- Add a 4th column: `Shared with {N}` (count of friends who have ≥1 correct answer in this domain). Phase 2 — requires per-domain group overlap, may already exist for the overlap map. **Impact: high.** Turns the list from a personal ledger into a meeting map.

**Risks**
None unique.

**Surface priority: medium.**

---

### 27. Mastery tier display on profile

**Current state**
`src/app/users/[id]/page.tsx:139-180`. Heading `"Knowledge portrait"`. Renders `<KnowledgeCard>` for non-self viewers with `Establishing / Familiar / Solid / Mastery` labels under each domain circle. Self viewer with no domains: `"Your Knowledge Portrait"` + mind statement + tier signature. **Tier labels conflict with `src/server/db/queries/account.ts` and `src/app/knowledge/[domain]/page.tsx` which use `Curious / Explorer / Scholar / Sage`.**

**Learning reinforcement — opportunities**
- Unify tier vocabulary across all six surfaces that show it (see Preface). Phase 1, cross-cutting. **Impact: high.**
- Add a "carries" line under the portrait: `"{firstName} carries {N} territories at solid or above."` 0.95rem Georgia italic. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- On a *friend's* profile, add a "we share" header above the portrait: `"You and {firstName} share {N} territories."` 1.05rem Playfair italic, listing the top 3 in mono. Phase 1 if shared-domains is queryable per-pair (it is in OverlapMap). **Impact: high.**

**Risks**
Tier vocabulary unification breaks every existing screenshot in marketing/docs. Worth it.

**Surface priority: high.**

---

### 28. Personal Round summary screen

**Current state**
`src/app/games/[id]/summary/page.tsx`. Header `"How You Did"`, score box (TOTAL + `+points`), `"Your Growth Recap"` with category circles, optional MasteryMoment, `OverlapMap` for single-recipient games, `"Round Recap"` with per-question cards.

**Learning reinforcement — opportunities**
- Same as #19: demote "How You Did" → `"Today's territory."` Phase 1. **Impact: medium.**
- "Your Growth Recap" → `"What got wider."` Phase 1. **Impact: low.**

**Shared knowledge reinforcement — opportunities**
- `"Your Impact Recap"` (line 336) is a great surface — currently reads `"{N} of your questions were answered correctly this round."` Promote: `"{firstName1} and {firstName2} got your questions right."` (name names, not just count). Phase 1 if responses include who-answered-which. **Impact: high.**

**Risks**
Naming answerers requires their consent posture — verify privacy defaults.

**Surface priority: medium.**

---

### 29. Catch-up / missed questions surface (half-credit treatment)

**Current state**
`src/app/daily/catchup/page.tsx` + `useCatchupFlow.ts`. Header `"Catch up"` + `"{N} missed {question(s)} from the past week"`. Intro copy: `"Take your time - untimed; for your record, not standings."` + `"These count for 0.25x points - the moment has passed, but the territory is still worth claiming."` Completion: `"Catch-up complete."` Empty: `"Nothing to catch up on. You're all clear."`

**Learning reinforcement — opportunities**
- The intro copy is already strong on learning ("the territory is still worth claiming"). Keep it. **No change needed.**
- Surface count of *new territories you could still enter* in the catchup queue: `"3 of these are in {italic domain} — somewhere you're already building."` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The "FROM YESTERDAY / FROM N DAYS AGO" subhead is set in small mono. Replace with author-led: `"From {firstName}, {N} days ago."` 0.78rem Caveat. Phase 1. **Impact: high.**
- Completion copy `"Catch-up complete."` is utilitarian. Replace with `"You met them all."` Phase 1. **Impact: medium.**

**Risks**
None unique.

**Surface priority: medium.** Surface is already strong; small leverage.

---

### 30. Group Knowledge Map (`/leaderboard` route)

**Current state**
`src/components/OverlapMap.tsx`. Headline `"Where you've met"` / `"so far."` (italic serif, 1.65rem). Two colored circles per domain, sized by mastery points, overlapping by shared correctness. `"{sharedPct}% shared"` mono small caps under each. Strongest-overlap call-out. Empty: `"You haven't answered the same question correctly yet. Keep playing."` Footer: `"Categories where neither of you has answered correctly together are hidden. They'll appear when you do."`

**Learning reinforcement — opportunities**
- Domain name is currently 0.95rem italic serif under the venn. Promote to *above* the venn at 1.1rem Playfair italic so the visualization reads as evidence of a domain, not the other way around. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The headline `"Where you've met"` is among the best copy in the product. **Keep verbatim.**
- Add a per-domain ambient line under each venn: `"{firstName} taught you 2; you taught {firstName} 1."` mono 0.6rem. Phase 1 if both-directions tracked (likely is). **Impact: high.** Turns overlap into reciprocity.
- For multi-person games (3+ players), the surface currently only renders for single-recipient. Extend to N×N matrix view — same venn pattern, one venn per pair, organized by domain. Phase 2 — needs new layout + payload. **Impact: high.**

**Risks**
This is the surface most at risk of drifting toward ranking. The `% shared` metric is fine because it's symmetric (no winner). Never add `% correct` or `points` here. Verify no proposal slips into per-player ranking.

**Surface priority: high.**

---

### 31. Intellectual Alignment surface

**Current state**
`src/components/profile/SharedInterestsOverlap.tsx`. Kicker `"Common ground"` + dynamic headline (`"No interest overlap with {firstName} yet."` or `"You and {firstName} share {N} interest(s)."`). Venn diagram with `"You"` and `"{firstName}"` columns + shared center.

**Learning reinforcement — opportunities**
- The overlap is *declared interests*, not *proven knowledge*. Add a parallel block below: `"Where you've both shown your hand:"` with a list of domains where both have ≥1 correct answer. Phase 1 — data is already used in OverlapMap. **Impact: high.** Connects declared territory to proven territory in one view.

**Shared knowledge reinforcement — opportunities**
- "Common ground" is overused (also appears in FeedList copy). Replace this surface's kicker with `"Where you overlap."` Phase 1. **Impact: low.**
- For shared interests, add a Caveat marginalia per row when one of you wrote a question in that domain: `you asked about this` / `{firstName} asked about this`. Phase 1 if origin per declared interest is tracked. **Impact: medium.**

**Risks**
None unique.

**Surface priority: medium.**

---

### 32. Author profile

**Current state**
`src/app/users/[id]/page.tsx:52-189`. Avatar (initial in colored circle), display name (3xl serif bold), `"On Joshing since {month year}"` + optional `"Friends since {month year}"`. Knowledge Portrait with KnowledgeCard. Authored Questions Feed.

**Learning reinforcement — opportunities**
- The "On Joshing since" line is meta. Replace with a domain-anchored line: `"Building {italic domain} since {month}."` (uses their oldest/strongest domain). Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Add a `"What we share"` block above Authored Questions, with the top 3 shared domains + mini-overlap venn. Phase 1. **Impact: high.**
- Authored Questions section currently lists their recent questions. Add a per-question marginalia: `"You answered this {timeAgo}."` or `"You haven't seen this yet."` Phase 1. **Impact: medium.** Makes the feed feel like *your relationship with their thinking*, not just their library.

**Risks**
None unique.

**Surface priority: medium.**

---

# QUESTION CREATION

### 33. Question creation interface

**Current state**
`src/components/QuestionForm.tsx`. Page title `"Write a question"`. Field label `"Question"`. Placeholder `"What is the name of Alexander the Great's horse?"`. Utilitarian, technical. No tagline matching the brief's `"What piece of your world belongs in this game?"`

**Learning reinforcement — opportunities**
- Add a single italic Playfair line under the title: `"Something specific. Something a friend should know but might not."` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Restore the brief's intended frame. Replace page title `"Write a question"` with `"A piece of your world."` Playfair italic 1.6rem. Subhead Caveat 0.95rem: `"Pick something specific."` Phase 1. **Impact: high.**
- Currently the only audience signal is a checkbox at the very end (`"Share with all friends"`). Add an ambient `"For whomever you choose."` Caveat marginalia next to the question field. Phase 1. **Impact: medium.**

**Risks**
Don't soften the form so much it discourages utility. The example placeholder is good; keep it.

**Surface priority: high.** Question-creation is the supply side of the entire game.

---

### 34. LLM answer suggestion moment

**Current state**
`QuestionForm.tsx`. While suggesting: `"Suggesting answer..."` (small muted). On review, if mismatched: `"LLM suggestion"` label + the LLM answer struck through with amber decoration. In QuickAddQuestionModal: `"Joshing will read the question and answer when you save, then choose the category, specific area, and difficulty automatically."`

**Learning reinforcement — opportunities**
- The LLM acts like a fact-checker. Reframe as a *second pair of eyes*. Replace `"Suggesting answer..."` with `"Reading…"`. Phase 1. **Impact: low.**
- On the review screen, the strikethrough on the LLM suggestion is correct visually but the label is wrong. Replace `"LLM suggestion"` with `"Joshing read it as:"` (the bot has been personified throughout — extend that here). Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- After confidence is established, the LLM is now a third party. Soften the verification copy: `"✓ Verified — matches LLM suggestion"` → `"Joshing agrees."` Phase 1. **Impact: medium.**
- `"⚠ Unverified — your answer differs from the LLM's suggestion. Recipients will see this."` → `"You and Joshing disagree. Your friends will see your answer."` Phase 1. **Impact: medium.** Aligns the verification step with the author's authority over their question.

**Risks**
Personifying the bot too heavily slides toward whimsy that the editorial register can't carry. Caveat: keep "Joshing" branded but don't add personality beyond what already exists.

**Surface priority: medium.**

---

### 35. Public pool opt-in toggle

**Current state**
`QuestionForm.tsx:499-519`. Card titled `"Destinations"`. Always-on disabled checkbox `"Save to bank"`. Off-by-default checkbox `"Share with all friends"` with supporting text `"Your friends will see this in their feed (except friends who've marked this domain as Not my focus)."` Off-by-default `"Send to specific friends only"`. Default: bank-only.

**Learning reinforcement — opportunities**
- None unique.

**Shared knowledge reinforcement — opportunities**
- `"Destinations"` is a UPS word. Replace with `"Who sees it."` Phase 1. **Impact: low.**
- `"Save to bank"` is good. Add Caveat marginalia: `"yours, always"` next to it. Phase 1. **Impact: low.**
- `"Share with all friends"` supporting text is half a sentence about exclusions. Lead with the positive: `"Your friends see this in their feed."` then on a second muted line: `"(unless they've muted {italic domain}.)"`. Phase 1. **Impact: medium.**
- Default for friend-relevant questions: when the question category matches ≥1 friend's declared interest, recommend (don't force) opt-in by pre-checking and showing `"Recommended — three friends have {italic domain} in their world."` Phase 2 — needs interest-cross-reference at creation time. **Impact: high.**

**Risks**
Auto-checking "Share with all friends" by default is a consent shift. Strong recommendation copy + clear unchecked-checkbox state is safer.

**Surface priority: medium.**

---

### 36. "Why I added this" optional creator note

**Current state**
`QuestionForm.tsx:488-492`. Label `"Creator note"`. Placeholder `"Optional context for recipients"`. 200-char limit. Review stage only.

**Learning reinforcement — opportunities**
- Provide an example as a placeholder rotation: `"e.g. I think about this every time I hear the second movement."` / `"e.g. My dad taught me this on a long drive."` Phase 1. **Impact: medium.** Pulls the field from "metadata" toward "memory."

**Shared knowledge reinforcement — opportunities**
- Replace label `"Creator note"` with `"Why this one."` Playfair italic 0.95rem. Phase 1. **Impact: high.** Matches the brief's framing.
- Replace placeholder `"Optional context for recipients"` with `"What made you think to ask it?"` Phase 1. **Impact: high.**

**Risks**
None unique.

**Surface priority: high.** This is where the question becomes a gift; current treatment is metadata.

---

### 37. Question bank in contribution flows

**Current state**
`QuestionBankPicker.tsx`. `"Pick up to {N} questions from your bank to contribute."` Per-question metadata: `{category} · Written by you / From {authorName}`.

**Learning reinforcement — opportunities**
- Add a default sort by domain freshness — questions in domains the *recipient* has been entering recently. Phase 2 — requires recipient context at picker time. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- `"contribute"` is utilitarian. Replace with `"send"`. Phase 1. **Impact: low.**
- `"From {authorName}"` is good provenance. Add marginalia: `"originally for {firstName}"` when the question's prior recipients are visible. Phase 2. **Impact: medium.**

**Risks**
Exposing prior-recipient history could feel surveillant. Keep it strictly first-degree (your own use of a bank question), never others'.

**Surface priority: medium.**

---

# GAME-END (CEREMONY)

### 38. Ceremony Act 1 — Portrait beat

**Current state**
`src/app/ceremony/[ceremonyId]/page.tsx:111-129`. Heading `"You leveled up."` Serif 5xl/7xl. CeremonyCircle visuals by tier scale. Tier transition in small muted caps below.

**Learning reinforcement — opportunities**
- `"You leveled up."` is gaming language. Replace with `"You grew."` Playfair italic 5xl. Phase 1. **Impact: medium.**
- Under the heading, add one domain-named line: `"In {italic domain1}, {italic domain2}, and {italic domain3}."` 1.6rem Georgia italic, INK 80%. Phase 1. **Impact: high.** Names the actual learning at the beat where the player is most receptive.

**Shared knowledge reinforcement — opportunities**
- None for this beat — it's intentionally personal (Act 1).

**Risks**
Don't crowd Act 1 with collective signal; that's Act 2's job.

**Surface priority: medium.**

---

### 39. Ceremony Act 1 — Personal Record beat (all seven reveals)

**Current state**
`page.tsx:132-193`. Three sub-beats:
- `"You went somewhere new."` (friend-mediated correctness) → `"Through your friends, you picked up {N} {question(s)} in {domains}."`
- `"You staked new territory."` (authored, new domain) → `"You wrote questions that opened a new domain: {domains}."`
- `"Your territory came to life."` (authored, friend answered) → `"A friend answered your questions and proved your knowledge in {domains}."`

Brief expects seven reveals; code has three (with conditional rendering, so up to three appear).

**Learning reinforcement — opportunities**
- Add four missing reveals to reach seven (brief alignment). Candidates the data likely supports:
  - `"You got close."` — near-miss accepted-variant moments. Phase 2.
  - `"You doubled back."` — questions you missed early in the cycle and got right in catchup. Phase 1 if catchup-correctness deltas are computable. **Impact: medium.**
  - `"You went deep."` — most questions answered in a single domain. Phase 1. **Impact: medium.**
  - `"You held the line."` — questions you got right in a domain where the group's average was below 50%. Phase 2 — requires group aggregation. **Impact: high.**
- Promote the listed domain names in each beat from inline mono to dedicated italic Playfair lines, one per beat. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The friend-mediated beat is already strong. Add the *names* of the friends whose questions you answered: `"Through {firstName1}, {firstName2}, and {firstName3}, you picked up…"` Phase 1. **Impact: high.**
- For the "promoted" beat (`"Your territory came to life."`), name the friend: `"{firstName} answered your question about {italic domain}."` Phase 1. **Impact: high.**

**Risks**
Seven beats is a lot of ceremony real estate. Define minimum-data thresholds so beats only fire if there's signal; otherwise the ceremony pads.

**Surface priority: high.** Ceremony is the brand's most-rendered narrative surface.

---

### 40. Ceremony Act 2 — Group Knowledge Map beat

**Current state**
`page.tsx:196-211` (Beat 3). `"These people taught you something."` Top 3 friends by `contributionCount`. Per friend: `"{displayName} contributed {N} {question(s)}."` Suppressed in solo mode.

**Learning reinforcement — opportunities**
- "contributed" is utilitarian — strip it. `"{firstName} — {italic domain}, {italic domain}, and {N} more."` (replaces count with domain-named evidence). Phase 1 if per-friend per-domain breakdown exists in beat3 payload; Phase 2 otherwise. **Impact: high.**

**Shared knowledge reinforcement — opportunities**
- The heading `"These people taught you something."` is already excellent — keep.
- Add a closing single-line summary: `"In total, your friends carried {N} questions into your world this fortnight."` Playfair italic 1.4rem. Phase 1. **Impact: medium.**

**Risks**
Naming domains-per-friend creates a privacy surface — make sure domain privacy flags propagate.

**Surface priority: high.**

---

### 41. Ceremony Act 2 — Authorship Impact beat

**Current state**
`page.tsx:227-239` (Beat 5). `"You taught people things."` + `"Your questions earned {N} points for others this fortnight."` Optional `"Your most-played: \"{question.text}\""`.

**Learning reinforcement — opportunities**
- `"points for others"` is system language. Replace with `"answered correctly by your friends"`. Phase 1. **Impact: medium.**
- For the most-played question, add the *domain*: `"Your most-played, in {italic domain}: \"{question.text}\""` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Add the *names* of who answered the most-played question: `"{firstName1}, {firstName2}, and {N} others answered."` 0.95rem. Phase 1. **Impact: high.** Makes "you taught people" land as actual people, not a number.

**Risks**
None unique.

**Surface priority: high.**

---

### 42. Ceremony Act 2 — Relational Feedback beat

**Current state**
`page.tsx:214-224` (Beat 4). `"You and {displayName} see the world similarly."` + `"You both know {joinList(sharedDomains)}."`

**Learning reinforcement — opportunities**
- Currently a flat list of domains. Promote: one Playfair italic line per shared domain, stacked, 1.1rem. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The heading `"You and {firstName} see the world similarly."` is among the best copy in the product. **Keep.**
- Add a single intimate marginalia at the bottom: `"That's not nothing."` Caveat 1rem. Phase 1. **Impact: medium.**

**Risks**
None.

**Surface priority: medium.** Already strong; small leverage.

---

### 43. Ceremony Act 2 — Climax beat (group / duo / solo modes)

**Current state**
`page.tsx:336-361`. End card: `"That's your two weeks."` + `"See you in another fourteen days."` Buttons `"Share"` / `"Done"`. No explicit climax beat — end card is functional. Beats 3 & 4 are suppressed in solo mode but no specific climax replaces them.

**Learning reinforcement — opportunities**
- Promote the final tier-cross (the single most-significant of the cycle) to the closing line: `"And {italic domain} is yours now."` Playfair italic 1.8rem, set above `"That's your two weeks."` Phase 1 — most-significant tier-cross is already in the beat data. **Impact: high.**

**Shared knowledge reinforcement — opportunities**
- For **group** mode: closing line `"You and {N} others wrote and answered {M} questions together."` 1.4rem. Phase 1. **Impact: high.**
- For **duo** mode: closing line `"You and {firstName} — fourteen days of asking each other."` 1.4rem Playfair italic. Phase 1. **Impact: high.**
- For **solo** mode (no active friends this cycle): `"Your two weeks, alone but not nothing."` Playfair italic 1.4rem. Phase 1. **Impact: medium.** Solo mode is currently the bleakest surface; this softens.

**Risks**
"Alone but not nothing" must not read patronizing. Test with a real solo-cycle player.

**Surface priority: high.**

---

### 44. Ceremony Act 2 — Invitation beat

**Current state**
`page.tsx:367-422` + `ShareCard.tsx`. Share modal. See #20 for share-card content. No explicit "invitation" copy beyond the share modal title (which is essentially the share card itself).

**Learning reinforcement — opportunities**
- Add an explicit invitation line before the share modal opens, as a tertiary card after the climax: `"Bring someone else into your world."` Playfair italic 1.4rem + secondary button `"Invite a friend"` linking to `/friends` invite flow. Phase 1 — uses existing invite route. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- The brief's invitation beat is structurally missing — currently it's just a share modal. Add a one-domain prompt: `"You and {firstName} share {italic domain} now. Who else might?"` with a one-tap `Send {firstName}'s questions to →` flow targeting a likely-match contact. Phase 2 — requires contact suggestions + targeted-share endpoint. **Impact: high.**

**Risks**
The line between "invite a friend" and "growth hacking" is short. Keep prompts strictly relational (someone who'd share *this domain* with this friend), never broadcast.

**Surface priority: medium.**

---

### 45. Game Summary Page — Group Story section

**Current state**
**Section does not exist** with that name. Closest analog: `"Your Impact Recap"` at `page.tsx:336-342`.

**Learning reinforcement — opportunities**
- Build the section. Title: `"The group's story."` Playfair italic 1.6rem. Contents: 3 lines of group-level facts: `"Everyone got {N} right." / "Hardest one today: \"{question.text}\" — {italic domain}." / "Most asked from: {firstName} ({N} questions)."` Phase 2 — requires group-level summary build per game. **Impact: high.**

**Shared knowledge reinforcement — opportunities**
- Same proposal as above — by definition this section is the group story.

**Risks**
"Hardest one" must mean *lowest correctness*, not "hardest difficulty." Keep it observed, not declared.

**Surface priority: high.** Largest missing surface.

---

### 46. Game Summary Page — Your Game section

**Current state**
`page.tsx:224-244`. Header `"How You Did"` + score box + `"Your Growth Recap"`.

**Learning reinforcement — opportunities**
- Replicate #19's rename: `"How You Did"` → `"Your game."` Phase 1. **Impact: medium.**
- Set the `+points` typography in Playfair italic instead of `font-mono` so it reads as editorial accomplishment, not numerical score. Phase 1. **Impact: low.**

**Shared knowledge reinforcement — opportunities**
- Add a single 1-line summary above the score: `"You answered {N} of {firstName1}, {firstName2}, and {firstName3}'s questions."` Phase 1. **Impact: high.**

**Risks**
None.

**Surface priority: medium.**

---

### 47. Game Summary Page — What You Discovered section

**Current state**
`page.tsx:239-252`. `"Your Growth Recap"` with `CategoryGainsDisplay`. Optional `MasteryMoment`. Empty fallback `"No mastery movement was recorded for this game."`

**Learning reinforcement — opportunities**
- Rename to `"What you discovered."` Playfair italic 1.6rem. Phase 1. **Impact: high** (brief alignment).
- The empty fallback is dispiriting. Replace `"No mastery movement was recorded for this game."` with `"No new corners today — you held what you had."` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- For each new-territory entry, add `"From {firstName}."` marginalia. Phase 1. **Impact: high.**

**Risks**
None.

**Surface priority: high.**

---

### 48. Game Summary Page — Group Portrait section

**Current state**
`page.tsx:344-351` renders `OverlapMap` only for single-recipient games. See #30 for OverlapMap content. Title from OverlapMap: `"Where you've met so far."`

**Learning reinforcement — opportunities**
- For multi-recipient games this section is absent (see #30 — Phase 2 N×N extension). When extended, add a learning kicker: `"The territory you all built together."` Phase 2. **Impact: high.**

**Shared knowledge reinforcement — opportunities**
- Already strong. The OverlapMap copy `"Where you've met so far."` is the right tone.
- Add a one-line domain call-out: `"You met hardest in {italic strongestOverlapDomain}."` 1.05rem Playfair italic, above the venns. Phase 1. **Impact: medium.**

**Risks**
"Hardest" must mean highest-shared-correctness in a high-difficulty domain — not subjective. Verify metric.

**Surface priority: medium.**

---

# OFF-SEASON

### 49. Challenge Worlds entry surface

**Current state**
**Does not exist.**

**Learning reinforcement — opportunities**
- Off-season learning needs a surface; current product has Replay (#50) only. Concept: `Challenge Worlds` as off-season themed micro-collections (e.g. `"Late Tchaikovsky — a small world"`), curated from existing questions in a single hyper-specific domain. Entry surface: a one-card prompt on the home screen between seasons: `"You crossed into {italic domain} this cycle. Want to go deeper before the next one?"` Phase 2 — entire feature is new. **Impact: high** (when built).

**Shared knowledge reinforcement — opportunities**
- Default the Challenge World invitation to be co-played: `"Take this with {firstName}?"` (where `firstName` is the friend who shares the strongest overlap in that domain). Phase 2. **Impact: high.**

**Risks**
Speculative — depends on whether the off-season product direction includes this at all. Phase 2.

**Surface priority: low** today (not built); high once built.

---

### 50. Friend Play

**Current state**
**Does not exist as a named surface.** Adjacent surfaces: Friends Hub (`FriendsHubPage.tsx`), invite flow (`AddFriendInvite.tsx`), `Replay` (`src/app/replay/page.tsx` — `"Contain more multitudes."` / `"Practice questions you previously missed. Nothing here changes your score."`).

**Learning reinforcement — opportunities**
- Replay is the closest analog. Strong copy. Surface a domain filter on top so replay can be focused: `"Practice in {italic domain}."` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement — opportunities**
- Build `Friend Play` as a one-tap surface from a friend's profile: `"Ask {firstName} five questions"` — pulls 5 unanswered questions from their bank, runs the session in catchup mode (not for record). Phase 2 — requires new ad-hoc game type. **Impact: high.** Lets a player initiate a relational session off-cycle.

**Risks**
Don't conflate Friend Play (read-only of their bank) with their daily queue — these are different.

**Surface priority: low** today (not built); medium once built.

---

# TOP 10 HIGHEST-IMPACT CHANGES

Ranked by combined surface priority × proposal impact. All Phase 1 unless noted.

1. **Unify mastery tier vocabulary across all six surfaces that show it** (#10, #25, #26, #27 + account.ts + domain detail page). Recommend brief's `Curious → Versed → Fluent → Master`. The current 3-way fork is the single most-damaging consistency issue in the product.
2. **Add italic-Playfair category label above every question bubble in-session** (#4). Domain becomes a named piece of content, not a hidden tag.
3. **Promote author to Caveat handwriting 0.78rem above every question bubble in-session** (#4). Every question becomes a signed gift.
4. **Rebuild the wrong-answer reveal to lead with the canonical breadcrumb at 0.92rem and a "now it's in yours too" sub-label** (#8). North-star metric is wrong-answer reaction rate; current treatment is consolation, not learning.
5. **Promote the daily-summary explainer from muted secondary to body-weight prose with an italic `Why.` kicker** (#13). The densest learning surface in the loop is currently visually subordinate to the answer comparison.
6. **Add author-led opening to noon SMS: `"{firstName} and {N} others wrote your five."`** (#1). First touchpoint of the day, currently fully utilitarian.
7. **Promote author to a 2-line editorial header on every end-of-session review card** (#11). Author currently appears only in the creator-note label.
8. **Add domain-named line under every ceremony Act 1 Portrait beat: `"In {italic domain}, {italic domain}, and {italic domain}."`** (#38). Names the actual learning at the most-receptive moment.
9. **Restore the brief's `"Why this one."` creator-note framing with example placeholders like `"I think about this every time…"`** (#36). Turns metadata into memory.
10. **Build the missing "Group Story" section on the game summary page** (#45, Phase 2). The largest missing collective surface in the product. Lower-priority on speed (Phase 2) but high-impact when shipped.

---

# CROSS-CUTTING PATTERNS

Standardize across multiple surfaces — copy moves and visual treatments worth a single design-pass.

1. **Every wrong-answer surface should name the domain in display size before showing the explainer.** Applies to in-session wrong reveal (#8), end-of-session review card (#11), archive card (#24).
2. **Every author reference outside the creator-note prefix should be Caveat handwriting, not mono.** Mono reads as system metadata; Caveat reads as a person. Applies to in-session bubble (#4), end-of-session review (#11), catchup subhead (#29), share card (#20).
3. **Replace "common ground" anywhere it appears more than once.** Currently overused in FeedList (`#190, #242, #560, #561`) and SharedInterestsOverlap (#31). Use it sparingly; default to `"where you've overlapped"` or `"in both your banks now."`
4. **Replace any header that says "How You Did" / "Your Growth Recap" / "Round Recap" with domain-named editorial phrasing.** Applies to daily summary (#19), game summary (#28, #46, #47).
5. **Tier crossings should be one canonical visual moment** — `MasteryMoment` component — and surface in (a) game summary (already does), (b) daily summary (newly), (c) the closing ceremony climax (#43). Three appearances, identical typography and animation, different timing.
6. **Whenever a question is shown in a list (archive, feed, knowledge), include three pieces of metadata in this order: author (Caveat), italic domain (Playfair), result badge (mono small caps).** Currently those three signals are scattered and inconsistently weighted.
7. **`"From"` is the canonical preposition for authorship.** Use it everywhere — never "Written by", "Asked by", "Contributed by". Single token, consistent register.
8. **Solo-mode ceremony beats need explicit copy, not just suppression of group beats.** Currently solo-mode players see Beats 1, 2, 5 only; the missing beats leave dead air. Write solo-specific copy for Beats 3 and 4 (e.g., introspective alternatives that don't require friends to have played).
9. **Domain names should always be italic Playfair, never mono uppercase.** Currently the same domain appears as `LITERATURE` (mono) on archive cards and `Literature` (Playfair italic) in OverlapMap — confuses domain-as-tag with domain-as-content.
10. **Every "you taught" / "you learned" claim should name a domain and at least one person.** Numbers alone (`"{N} creator points"`) do no work on either lens.

---

# OPEN QUESTIONS / FORKS

Decisions that block specific proposals; Josh to resolve.

1. **Mastery tier vocabulary canonical form.** Brief: `Curious → Versed → Fluent → Master`. Code: three different sets. Which set ships? (Recommended: brief's set; it best supports an interior-learning frame.)
2. **Does the answer-grading pipeline distinguish "exact match" from "accepted variant"?** Determines whether the near-miss acknowledgment (#17) is Phase 1 or Phase 2.
3. **Is per-question group-level aggregation (`correct_count`, `answered_count` across the group) available in the daily summary payload?** Determines Phase for #16 (standout moments) and #19 (compatibility shifts).
4. **Is question-bank origin (the *original* author of a question that's been re-asked) preserved through bank intake?** Determines #12 author-reveal-on-bank-questions Phase.
5. **Are creator-note explanations distinguishable from LLM-generated explainers?** Determines #13 `"in {firstName}'s words"` Phase.
6. **Does the star vote already route to a per-author feedback aggregate?** Determines #15 `"{firstName} will see this"` Phase.
7. **Is "Friend Play" desired as a real off-season feature, or is Replay the canonical answer?** Determines whether to invest design cycles on #50.
8. **Are Challenge Worlds a real Phase 2 roadmap item?** If not, #49 should be dropped from the audit's followup queue rather than carried forward as a low-priority Phase 2.
9. **The brief's "common ground +" sub-label and "now it's in yours too" wrong-answer line — these are written into the brief but absent from code. Are they descriptions of intent (to be implemented) or stale references (to be retired)?** Determines whether several proposals in #7, #8 restore the brief's copy or supersede it.
10. **Mid-session mastery-tier crossing — does the brief want it surfaced in-thread, or is the post-game `MasteryMoment` the only intended manifestation?** Determines #10.
11. **Friend-name visibility in the wrong-answer "{firstName} thought you might" line — what's the privacy posture if the friend hasn't actively shared this signal?** Determines #8.
12. **`/leaderboard` route name** — the route is literally called `leaderboard` but renders the (correctly non-ranking) Group Knowledge Map. The route name is a hostage to its own past. Rename to `/group-map` or `/we`? Trivial code change, but breaks any external links.

---

End of audit.
