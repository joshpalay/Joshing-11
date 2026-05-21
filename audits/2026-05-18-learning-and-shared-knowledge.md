# Game-Wide Audit — Reinforcing Learning and Shared Knowledge

Date: 2026-05-18 (third pass)
Method: every surface below was audited by reading the source file directly. CSS-variable references are taken from `src/app/globals.css` and `src/app/layout.tsx`; copy is quoted verbatim with `file:line` citations. This third pass additionally resolved most of the prior audit's open questions by reading the answer-grading file, the daily-summary query, the daily-feedback route, and the questions schema. Phase 1/2 labels below are now evidence-backed wherever the proposal carries an `Evidence:` note. A new **Sequencing & Dependencies** section at the bottom orders the Top 10 work by dependency.

---

## Preface — four findings that thread through everything

### 1. Mastery-tier vocabulary is forked across FOUR surfaces and none match the brief

| Surface | File | Labels |
|---|---|---|
| Canonical knowledge layer | `src/server/profile/knowledge-tier-copy.ts:3-8` | Establishing → Familiar → Solid → Mastery |
| Account / domain detail | `src/server/db/queries/account.ts:26-31`, `src/app/knowledge/[domain]/page.tsx:53` | Curious → Explorer → Scholar → Sage |
| Daily-difficulty mode label (different concept but same word-pool) | `src/app/daily/summary/page.tsx:28-34` | Establishing / Solid / **Skilled** / Master / Adaptive |
| Mid-flow MasteryMoment overlay | `src/components/review/MasteryMoment.tsx:21-23` | Familiar / Solid / Mastery (capitalised from enum) |
| Ceremony Beat 1 tier transition | `src/app/ceremony/[ceremonyId]/page.tsx:47-52` | Establishing / Familiar / Solid / Mastery |
| Knowledge page tier-cross banner | `src/app/knowledge/page.tsx:423-425` | Whatever `tierCrossed` returns (string-passthrough) |

Brief says `Curious → Versed → Fluent → Master`. None of the six in-product surfaces matches that. A player who crosses a tier mid-game sees a 3rem display reading "Solid" (MasteryMoment), then opens the daily summary and sees "moved to solid" (interpretiveLine line 78), then opens their profile and sees "Scholar" (account.ts), then opens the knowledge map and sees "Solid" again (DomainRow). Half the proposals below assume this is unified; the canonical recommendation is the brief's `Curious → Versed → Fluent → Master` because mastery-as-ladder reads more credentialing than learning, and Joshing's premise is the latter.

### 2. The brief's copy fingerprints are mostly absent from code

The brief references a "common ground +" sub-label and a "now it's in yours too" wrong-reveal line. Neither exists in code. Actual rotations are at `GameplayChat.tsx:86-91` (correct: `shared signal / you both know this one / confirmed / same territory`) and `:93-102` (wrong: `Not this time — here's the answer. / You'll know this one next time. / Nice try. / Close, but not quite.`). The brief also references standout moments (`only you got this`), accepted-variant near-miss, share-card emoji grid, Group Story section on game summary, next-questions countdown, Challenge Worlds, and Friend Play — none of which exist. **Open question 1 below: are these intent-to-implement or stale references?** All proposals downstream treat them as intent.

### 3. The ceremony breaks the ink-on-cream register

`src/app/ceremony/[ceremonyId]/page.tsx:331` sets the entire ceremony to `bg-stone-950 text-stone-50` with a radial gradient — white-on-near-black, awards-show staging. Every other surface in the product is INK on CREAM (`--ink` ≈ `#1a1208` on `--cream` ≈ `#fdfbf6`, set in `globals.css:95-97`). The OverlapMap (`src/components/OverlapMap.tsx:29-36`) is the gold-standard example of the brief's "ink-on-cream with hard 2px borders and 6px offset shadows" — and it appears in the ceremony's adjacent surface (game summary). The ceremony's dark theme either signals a different design intent or is a regression. Worth a deliberate call. The audit's ceremony proposals assume the dark theme stays but flag where it weakens learning/shared-knowledge cues.

### 4. Author identity is structurally underweight

The author's display name surfaces in five places I found by direct read: (a) `creatorName` line above the in-session bubble at 0.6rem mono muted (`GameplayChat.tsx:180-191`); (b) breadcrumb `FROM [author]` at 0.5rem mono (`:303`); (c) `A note from {authorName}:` creator-note prefix (everywhere); (d) `From {view.creator.displayName}` at the top of game-summary cards in 0.62rem mono uppercase (`src/app/games/[id]/summary/page.tsx:267`); (e) `From the question bank` system fallback on the same card. **Caveat handwriting is loaded** as `--font-handwriting` (`layout.tsx:16-20`) but never used outside Personal Record annotations on the Portrait — there is no Caveat usage in the question/result/review/summary thread. The "shared knowledge" lens depends on the author feeling like a person; current treatments make them feel like a metadata field.

---

# PRE-SESSION

### 1. Noon SMS notification

**Current state**
`src/server/sms.ts:245-259`. Three variants:
- 1 group: `"{groupName} — up to 5 questions waiting. Your queue refills daily: {url}/play"`
- 2 groups: `"{name} and {name} — questions waiting. Your queue refills daily: {url}/today"`
- 3+ groups: `"{name} and {N} other groups — questions waiting. Your queue refills daily: {url}/today"`

A separate **season-end ceremony SMS** (`buildGameCompleteSmsBody`, `:82-134`) has variants including non-winner: `"The {groupName} season just ended. {winnerName} knew you best. See how it all mapped out: {url}"`. There is **also a creator-note-prompt SMS** (`sendCreatorNotePromptSms`, `:189-221`): `"Someone got your question wrong: \"{preview}\". Add a note to give context: {url}/questions"` — a major shared-knowledge surface I missed the first time.

**Learning reinforcement**
- Daily reminder names neither domain nor author. Add domain-of-the-day to single-group variant: `"{groupName} — five today, including {italic-not-possible-in-SMS, just} {topDomainOfTheDay}. {url}"`. Phase 1 if today's set already has a category — it does in the daily picker. **Impact: medium.**

**Shared knowledge reinforcement**
- Lead with people, not the queue. Phase 1: `"{firstAuthorFirstName} and {N} others wrote your five. {url}/play"`. Falls under 160 even with two long names; falls back to current copy if no author available. **Impact: high.**
- Season-end non-winner copy `"{winnerName} knew you best."` is a soft leaderboard tell — `knew you best` ranks the relationship. Replace with `"The {groupName} season just ended. {winnerName} stretched you the furthest. See the map: {url}"`. Phase 1 (string only). **Impact: medium.**
- Creator-note-prompt SMS is a perfect shared-knowledge moment that currently reads as a chore. Promote: `"{respondentFirstName} just missed your question \"{preview}\". Want to leave them a note? {url}/questions"` — names the *recipient* so the author feels addressed by a person. Phase 1 if the SMS pipeline can join the answerer name; Phase 2 if not. **Impact: high.**

**Risks**
160-char budget. Use short SMS-safe templates and skip italics. Author-led copy must fail gracefully when `creator.firstName` is missing.

**Surface priority: high** — first touchpoint of the day; creator-note-prompt SMS is also high-leverage and underweighted.

---

### 2. Home / Feed screen game card

**Current state**
`src/components/feed/FeedCard.tsx:106-205`. Two variants. Non-author: cream card, 2px left bar in `categoryColor`, initials avatar (9×9 colored circle), author name (16px Montserrat, underlined to author profile), category subtitle (12px `--font-literata` italic, INK at 70% opacity), question text (17px Georgia serif, line-clamp-4), optional personal message (13px italic literata), `"Answer →"` button with `boxShadow: 4px 4px 0 var(--ink)` + active translate. Viewer-as-author variant: `"You"` avatar, kicker `"New question"`, category, question.

**Learning reinforcement**
- Category subtitle is 12px / 70% opacity — only slightly louder than the 11px timestamp. Promote: 13px, `var(--font-display)` (Playfair italic), INK at 88% opacity. Phase 1. **Impact: medium** — the category line *is* the learning preview.

**Shared knowledge reinforcement**
- The 16px linked author name is already strong — leave the type, but add a Caveat 0.85rem `for you.` to the right when this card has a personal message (signals the question was hand-routed, not broadcast). Phase 1 — `--font-handwriting` is loaded and unused on this surface. **Impact: medium.**
- Viewer-as-author kicker `"New question"` is system language. Replace with `"You asked this."` — keeps you in the same authorial register as friends. Phase 1. **Impact: low.**

**Risks**
The `4px 4px 0 var(--ink)` shadow plus added marginalia can crowd narrow viewports. Verify on 360px.

**Surface priority: high.** Highest-traffic browse surface.

---

### 3. Anticipation signal during a game ("N rounds until the final reveal")

**Current state**
Does not exist on the daily play surface. The only round-position signal is post-round in `GameplayChat.tsx:719-790` (`SessionCompleteRow`): mono kicker `"Round complete"`, then `"+{points}"` in 2rem Playfair italic in success-green, then optional `"Next round opens {nextRoundOpensAt}"` and a `"Continue to ceremony"` / `"See results"` button. Catchup flow uses `"{N} of {N} remaining"` (`useCatchupFlow.ts:273`).

**Learning reinforcement**
- Add a single in-thread `SystemRow` after question 3 of 5: `3 OF 5 · 2 MORE TILL YOUR SUMMARY`. Use the existing `monoStyle` at `:104-109` for visual consistency. Phase 1 — the row component is already wired. **Impact: medium.** Sets up the explainer beat as anticipated.

**Shared knowledge reinforcement**
- On the final question of the day, a `SystemRow` tease: `LAST ONE TODAY · FROM {firstName}` (the actual author of the last question). Phase 1 — `creatorName` is already on every `QuestionRow` payload. **Impact: high.**

**Risks**
Two extra rows per session is the limit before the thread feels chatty. Don't add more.

**Surface priority: medium.** Currently zero; this is a small absolute improvement.

---

# DURING THE SESSION

### 4. Question bubble

**Current state**
`GameplayChat.tsx:130-271`. Visual stack top-to-bottom: optional `subhead` (mono 0.58rem muted, only used by catchup `"FROM YESTERDAY"`) > optional `creatorName` (mono 0.6rem muted, padded 2px) > question bubble (`surface-2` bg, 1px border, radius-md, 12×16px padding, 0.98rem `--text`, line-height 1.45, 88% maxWidth) > optional `badges` (mono 0.52rem, muted or amber `warning` tone) > optional `Skip - don't show again` button (mono 0.58rem underlined, 0.7 opacity).

**Critical gap:** **the canonical subcategory is not rendered anywhere in this row.** `canonicalSubcategory` only appears on `ResultRow` (`:551`, as data for the domain-exclusion affordance) — never on the question itself.

**Learning reinforcement**
- Add a category line above the question text. Use the design system's italic register: `font-family: var(--font-display)`, `font-size: 0.92rem`, `font-style: italic`, `color: color-mix(in srgb, var(--text) 75%, transparent)`, margin-bottom 4px. Phase 1 — requires `canonicalSubcategory` on the `question` ChatMessage; almost certainly available upstream. **Impact: high.** First time the player sees what they're about to learn.
- Rename the badge labels. `'Establishing' / 'Solid' / 'Master'` collide with mastery-tier vocabulary. Replace per-question difficulty labels with the brief's `ACCESSIBLE / MODERATE / SPECIALIST`. Phase 1 — flow through `difficultyCopyFromEstimate`. **Impact: medium** (resolves the confusable).

**Shared knowledge reinforcement**
- Promote `creatorName` from mono 0.6rem whisper to Caveat 0.85rem: `font-family: var(--font-handwriting)`, prefixed `from `. Use `--font-handwriting` (Caveat is loaded at `layout.tsx:16-20` and currently unused on this surface). Phase 1. **Impact: high.** Lands the brand's "named consent" thesis in the highest-frequency moment of the loop.
- For questions that have personalMessage payload (from a direct send), append a 0.78rem Caveat marginalia under the bubble: `"{personalMessage}"`. The data exists in FeedCard; verify it's also on the in-thread payload. Phase 1 if data flows through; Phase 2 if not. **Impact: medium.**

**Risks**
Italic Playfair display category above + Caveat handwriting author + serif bubble stack to ~110px on a 3-line question. Test on 360px viewport. The brief flags Inter as body — code ships Montserrat (`layout.tsx:8-9` documents this intentionally) — keep using `--font-sans-body` so the category line takes the loaded display variant.

**Surface priority: high.** Most-viewed surface in the game.

---

### 5. Skip mechanic surface

**Current state**
`GameplayChat.tsx:243-266`. Button copy: `"Skip - don't show again"` (default `dismissLabel`). After dismiss: `"Skipped"` line (line 240) — same mono 0.58rem 70% opacity.

There is **also a per-domain exclusion** built on the daily summary, where exclusion message is `"{domain} won't appear in your daily queue anymore."` with `Undo` button (`src/app/daily/summary/page.tsx:449-462`). The summary's overflow menu (`:546-560`) offers `"Hide questions like this"` and `"Mute {domain}"` (both wired to `handleExcludeDomain`).

**Learning reinforcement**
- After skip, before the bubble dismisses, show a single italic line in place of the question: `You skipped this — we'll show you the answer in your summary.` `--font-display`, 0.78rem, INK at 55%. Phase 1. **Impact: medium.** Skip stops being information loss.

**Shared knowledge reinforcement**
- The label `"Skip - don't show again"` reads as system rejection of the author. Soften to two options surfaced on confirm:
  - `"Not today"` — temporary skip, may reappear
  - `"Not my world"` — same as today's domain exclusion (`handleExcludeDomain`) — silently removes the domain from rotation
  Phase 1 — both actions already exist in code; this is a copy + IA change to surface them at skip time rather than only on summary. **Impact: medium.**
- "Not my world" exclusions must never surface to the author — verify the domain-exclusion writes don't notify. (`POST /api/users/domain-exclusions` — confirm.)

**Risks**
If skip starts looking like a multi-button decision, players will skip less. Keep the default tap a single button; the second option appears only on a long-press or via an overflow.

**Surface priority: medium.**

---

### 6. Answer submission moment

**Current state**
`src/app/daily/catchup/page.tsx:176-187` and analogous on play surface. `placeholder="Your answer..."`, `<button className="btn-primary">Send</button>` or `'...'` when submitting. After submit, `TypingRow` shows `"Grading..."` (`GameplayChat.tsx:500-525`) — italic serif 0.9rem in a `surface-2` bubble.

**Learning reinforcement**
- Placeholder is generic. Vary by difficulty (data is on the question): ACCESSIBLE → `"Type what you know"`, MODERATE → `"Best guess works"`, SPECIALIST → `"A fragment is fine"`. Phase 1. **Impact: low.**

**Shared knowledge reinforcement**
- `"Send"` is email register. Replace with `"Answer"` (system-neutral) or — bolder — `"Tell {firstName}"` when the author is in the player's group. Phase 1 — author name is on the question payload. **Impact: medium.** This is the single moment the player most feels like a respondent rather than a submitter.
- `"Grading..."` is judgment-system language. Replace with `"Checking..."` (mechanical) or `"Reading..."` (personifies the bot as a careful reader, matching `"Joshing will read the question and answer"` at `QuestionForm.tsx:476`). Phase 1. **Impact: low.**

**Risks**
`"Tell {firstName}"` implies the answer is going to a person. If per-answer signals aren't routed to the author, this is a lie. Audit the answer pipeline before shipping.

**Surface priority: medium.**

---

### 7. Result reveal — correct

**Current state**
`GameplayChat.tsx:612-622`. Layout: success-tinted bubble (`color-mix(in srgb, var(--success) 9%, var(--surface-2))`, 30% success border). Inside: green ✓ + headline (in `--font-literata`, which resolves to Playfair italic via `--font-display`), then sub-label in mono 0.55rem muted. Headline rotation (`:86-91`): `Nice pull. / Right on. / Locked in. / Exactly.` Sub-labels: `shared signal / you both know this one / confirmed / same territory`. Optional `RelationalFeedbackFade` line below (italic 0.78rem, fades after 2.5s, content from `relationalFeedbackLine` payload). Optional `BreadcrumbLine` if `breadcrumb` present (line 680 unconditional on result — applies to correct *too* if data present, which is more than I claimed in v1).

**Learning reinforcement**
- The breadcrumb's `FROM [author]` is mono 0.5rem — sub-legible. Reformat: `"From {firstName}."` in `--font-handwriting` 0.78rem (matches the proposed bubble-author treatment in surface 4 for consistency). Phase 1. **Impact: high.**
- Add a fifth headline variant that names the domain: `That's {italic category}.` Phase 1 — `canonicalSubcategory` is on `ResultRow` props (`:551`) but currently unused in copy. **Impact: medium.**

**Shared knowledge reinforcement**
- Sub-label rotation's `confirmed` is the weakest variant (system register). Replace with `in both your banks now` — restores the brief's intended "now it's in yours too" semantics. Phase 1. **Impact: medium.**
- Add a sixth sub-label, gated on questions where `creatorName` is non-null: `{firstName} knew you'd know this.` Phase 1. **Impact: high.** Same word-count as `"you both know this one"`.
- The `relationalFeedbackLine` data slot is already wired but the source of the strings is upstream — make sure server-side generators use author-named language when present.

**Risks**
Adding too many headline variants makes rotation visible as a system. Five upper limit.

**Surface priority: high.** Most-frequent positive moment.

---

### 8. Result reveal — wrong

**Current state**
`GameplayChat.tsx:634-679`. Red-tinted bubble. Stack: red ✕ + headline (Playfair italic), then `Answer: {correctAnswer}` bold-then-plain at 0.9rem, then optional italic consolation quip at 0.88rem muted, then optional `"Recheck my answer"` button (mono 0.58rem uppercase). Below the bubble, the unconditional `BreadcrumbLine` if present, and an optional `QuipLine` at 0.875rem italic muted with 8px left margin.

There's also a `gave_up` state (`:623-633`) — when the player explicitly gives up (e.g. via catchup's `"I give up"` button): `"Here's the answer."` in muted Playfair italic, then `Answer:` line. No headline rotation, no breadcrumb path. **I missed this state entirely in v1.**

**Learning reinforcement**
- The headline rotation is purely consolation. Add one variant that names the territory: `Now you know one more thing about {italic category}.` Phase 1 — `canonicalSubcategory` is on props. **Impact: high.** Wrong-answer reaction rate is the north-star metric and the current treatment does almost no learning work.
- The breadcrumb is the densest learning element on this surface but rendered at 0.78rem italic. Promote to 0.92rem, in `--font-display` (Playfair italic), pin directly under the `Answer:` line. Phase 1. **Impact: high.**
- The `gave_up` state currently shows no breadcrumb or quip — verify the data is still passed and just render it. If absent in payload, add server-side. Phase 1 if data is there. **Impact: medium.**

**Shared knowledge reinforcement**
- Update `BreadcrumbLine`'s author rendering: change `FROM [{author}]` (mono 0.5rem) to `From {firstName}.` (Caveat 0.78rem). Phase 1. **Impact: high.**
- Add a wrong-answer sub-label rotation between `Answer:` line and consolation: `{firstName} thought you might know this. / {firstName}'s world includes this. / {firstName} carries this one.` Phase 1; gate the first variant on ACCESSIBLE difficulty so it doesn't read patronising on SPECIALIST misses. **Impact: high.**

**Risks**
The recheck button means the wrong-reveal can become correct retrospectively. If we add author-named sub-labels, they need to clear on recheck-accepted (currently the bubble doesn't re-render its content on recheck; only `recheckMessage` is appended below the button — verify this works for added copy too).

**Surface priority: high.** The single highest-leverage surface in the entire product.

---

### 9. Mid-session transition between questions

**Current state**
`play-client.tsx:150-168` (per Explorer; corroborated by `QuestionRow`'s `isNew` fade at `GameplayChat.tsx:150-155`). 850ms silent pause then fade-in of next question. No bridge text or skeleton.

**Learning reinforcement**
- Hold. The terse-thread principle is correct; adding text here would break it.

**Shared knowledge reinforcement**
- Same.

**Surface priority: low.** Already correct.

---

### 10. Mastery tier-crossing mid-session

**Current state**
`MasteryMoment.tsx:14-104`. Does NOT fire mid-session — fires only on game-summary (`src/app/games/[id]/summary/page.tsx:247-252`) and daily-summary (`src/app/daily/summary/page.tsx:248-257`). Layout: full-screen cream overlay (`#f5f0e8`), centered stack: subcategory (Playfair italic 1.2-1.6rem, 72% INK opacity), then **TIER NAME as 2-3rem 700-weight headline** (90% INK opacity), then copy (`"…You're finding your ground." / "…You move through this naturally now." / "…This one's yours."`, 0.95rem 48% opacity). 30ms enter + 420ms fade-in + 2600ms auto-dismiss. Tap to dismiss.

The 2-3rem tier label is the visual centerpiece. This is the most prominent rendering of tier vocabulary anywhere in the product, which makes the four-way fork (Preface §1) most consequential here.

**Learning reinforcement**
- The copy is good. Leave it.
- The vocabulary needs unification (see Preface §1). Whatever the canonical set ends up, MasteryMoment is the loudest place it appears. Phase 1, cross-cutting.

**Shared knowledge reinforcement**
- Add a fourth copy variant for tiers crossed in domains where ≥1 friend is at solid/mastery: `"{subcategory}. You and {firstName} now both carry this."` Phase 1 — requires a small server-side enrichment to identify a "tier-buddy" at moment of cross. **Impact: high.** Lands the entire shared-knowledge thesis in one 2.6-second moment.

**Risks**
The overlay is full-screen — `<button>` covering 100dvh, dismiss-on-tap. Make sure the "tier-buddy" variant isn't shown when the buddy has private domain visibility (existing privacy logic at `compute-beats.ts:373` for Beat 4 — same gate applies).

**Surface priority: high** (because of vocabulary fork blast radius).

---

# END OF SESSION

### 11. End of Session Review — per-question card (daily summary)

**Current state**
`src/app/daily/summary/page.tsx:298-507`. Card is tinted by result: emerald-50 / rose-50 / stone-50. Top-left: status badge `CORRECT / WRONG / SKIPPED` (uppercase 0.65rem semibold). Top-right (same row): `JOSHING BOT · {DOMAIN.UPPER}` in mono 0.62rem muted — **author is not on this card at all** outside the creator-note. Below: question text (medium-weight foreground), `You: {answer}` / `Answer: {correct}` side-by-side, explanation (`bg-muted/35 text-muted-foreground`, no toggle), creator note (`bg-muted/40 text-foreground`, `"A note from {authorName}:"`, no toggle). Bottom action bar: Heart vote (filled rose when active) + `SendQuestionAction` (re-gift). Overflow menu via `MoreHorizontal`: `Hide questions like this` / `Mute {domain}` / `Hide from feed (disabled)` / `Save to question bank` / `Report content`.

**Learning reinforcement**
- Replace `JOSHING BOT · {DOMAIN.UPPER}` with a stacked editorial header: top line `{domain}` in `--font-display` italic 1.05rem INK; ditch the system kicker. Phase 1. **Impact: high.** The system attribution `JOSHING BOT ·` is the only place in the product that names the LLM as a co-author on the player's recap — confusing.
- Explanation is `text-muted-foreground` — visually subordinate to the answer comparison. Promote to `text-foreground` and add a Playfair italic kicker `Why.` (0.78rem INK 70%). Phase 1. **Impact: high.** This is the densest learning surface in the loop.
- Add a `More on {domain} →` link at the bottom of the explanation, routing to `/knowledge/{domain}`. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- Add author to the card header (above the question, below the status badge): `From {firstName}.` in `--font-handwriting` 0.95rem at INK 85%. **Evidence:** `QuestionRecap` (`src/server/db/queries/daily-summary.ts:30-43`) carries `creatorNote.authorName` but NOT the bare question creator's display name. So the proposal needs the recap query enriched with `creator.displayName` from `users`. Cheap one-join backend change — call it **Phase 1.5** (backend touch + frontend). **Impact: high.**

**Risks**
The tinted card background (emerald/rose/stone) already does heavy semantic lifting. The new header should sit *on* the tint, not break it. Use `var(--ink)` text on all variants — no white-on-color.

**Surface priority: high.** This is the entire end-of-session review experience and the author is missing.

---

### 12. Author reveal moment

**Current state**
Static text. On game summary (`src/app/games/[id]/summary/page.tsx:267-270`), each card's top-left mono row says `"From {view.creator.displayName}"` (or `"From the question bank"` fallback). On daily summary, no author at card-header level — only inside the creator note. No animation in either place.

**Learning reinforcement**
- Skip — not a learning surface.

**Shared knowledge reinforcement**
- Promote the daily-summary author line (proposed in surface 11). On reveal, fade the `From {firstName}.` line in over 300ms before the question becomes visible. Phase 1 — pure CSS, mirrors the existing 420ms MasteryMoment timing. **Impact: high.**
- `"From the question bank"` is the fallback and reads as a depersonalised broadcast. The bank entry has an original author — surface them: `"From {originalAuthorFirstName}, originally."` **Evidence:** schema preserves origin via `sourceQuestionId text('source_question_id')` (`src/server/db/schema.ts:210`) and an index at `:261`. **Phase 1.** Just needs the recap join to follow the chain to the original author. **Impact: high.** This is on the brief's "named consent" thesis directly.

**Risks**
Reduced-motion users need the 300ms fade short-circuited.

**Surface priority: high.**

---

### 13. Educational explainer (truncated + expand)

**Current state**
Two variants exist:
- Daily summary `:436-439`: full text rendered in `bg-muted/35 text-muted-foreground` rounded box. No expand UI.
- Archive `:380-385`: full text rendered in `<details>` with `<summary>Explanation</summary>` font-medium foreground. **Expand/collapse already exists here.** I claimed in v1 it didn't anywhere — wrong.
- Game summary `:301`: `<p className="...text-muted-foreground">{explanationFor(...)}</p>` — flat render, no toggle.

Backend has 5 explainer-text fields with a fallback chain (`explanationFor` at `:57-64`): `explainerFullWrong → explainerFull → explainerBriefWrong → explainerBrief → factualExplanation`. **Evidence:** the underlying schema actually has **eight** explainer fields (`src/server/db/schema.ts:230-237`): `explainerBrief / explainerFull / explainerBriefCorrect / explainerFullCorrect / explainerBriefWrong / explainerFullWrong / explainerBriefExpired / explainerFullExpired`. So the brief's correct/wrong asymmetry is over-supported by data — the model also has `_Correct` and `_Expired` variants the UI ignores. The render code only picks `_Wrong → default → _BriefWrong → _Brief → factualExplanation`; it never reaches for `_Correct` or `_Expired` at all.

**Learning reinforcement**
- Standardise: daily summary and game summary should both use `<details>` with `<summary>{italic kicker} Why →</summary>`; wrong-result cards default `open`, correct-result cards default closed. Phase 1 — wraps existing render. **Impact: high.** Implements the brief's intent exactly.
- Where the question has paired brief/full variants, use the brief as always-visible teaser and full as the expanded content, picked by result: `_BriefCorrect`/`_FullCorrect` for correct, `_BriefWrong`/`_FullWrong` for wrong, `_BriefExpired`/`_FullExpired` for expired, falling through to the unsuffixed pair. Currently `explanationFor` flattens to one field; should pick a result-keyed *pair*. Phase 1 — selector change. **Impact: high.** (Bumped from medium — the existence of `_Correct` and `_Expired` variants in schema means the brief's asymmetry is meant to be three-way, not just correct-vs-wrong.)
- Add `More on {italic domain} →` link inside the expanded content. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- When the explanation text came from the creator (vs LLM-generated), surface that: `in {firstName}'s words.` 0.7rem Caveat right-aligned. Phase 2 — provenance per explainer field is not currently tracked in the data I read. **Impact: high if tracking exists.**

**Risks**
Defaulting wrong cards open changes the silent line height of the wrong card on first paint. Make sure the open `<details>` doesn't cause CLS for above-the-fold cards.

**Surface priority: high.**

---

### 14. Creator note treatment (collapsed for correct, expanded by default for wrong)

**Current state**
Same `"A note from {authorName}:"` (font-medium prefix + plain body) on daily summary `:441-447`, game summary `:302-307`, archive `:387-392`. `bg-muted/40` + 1px border. **No collapse logic anywhere** — always expanded.

**Learning reinforcement**
- For wrong-answer cards the note IS the learning. Promote: drop the `bg-muted/40` border, set the body as 0.95rem Georgia italic (`font-family: var(--font-literata)`) indented 12px with a thin 2px left rule in `var(--ink)` at 25%. Phase 1. **Impact: high.**

**Shared knowledge reinforcement**
- Implement the brief's correct/wrong asymmetry. Correct cards: render only `"{firstName} added a note →"` as a Caveat 0.78rem link that expands inline on click. Wrong cards: render expanded by default with the promoted treatment above. Phase 1. **Impact: high.**
- Change the label across all three surfaces. Current: `"A note from {authorName}:"` (formal, third-party). Proposed: `"{firstName} added:"` (warmer, sentence-like, same field). Phase 1. **Impact: medium.**

**Risks**
Hiding the note from positive moments looks counter-intuitive. The product reasoning: when you knew it, the moment is yours; when you didn't, the author's hand on your shoulder lands harder. If this isn't a willingly-accepted design call, fall back to "always expand, just restyle."

**Surface priority: high.**

---

### 15. Star voting surface

**Current state**
There is no star vote — only a heart on daily summary cards (`:464-482`) and a `QuestionRatingButtons` component on game summary / archive cards. Aria-label is `"Love this question"`. Single binary tap. Thumbs-down is reachable only via overflow menu's `"Report content"` (`:576-588`) — i.e. negative feedback is funneled through a reporting channel.

**Learning reinforcement**
- The heart says nothing about *what* about the question worked. Replace the single heart with a two-step affordance: tap reveals three Caveat micro-labels for one-shot select: `"Loved this. / Brilliant question. / Stumped me right."` Phase 2 — requires a `flavor` enum on the vote. **Impact: medium.**

**Shared knowledge reinforcement**
- A vote is meaningful only when the author sees it. On submit, micro-confirmation toast: `"{firstName} will see this."` 0.7rem INK 60%, 2s. **Evidence (correction from v2):** `POST /api/daily/feedback` (`src/app/api/daily/feedback/route.ts:53,73`) just inserts to `questionFeedback`; **it does not aggregate to author or surface anywhere the author can see.** So this micro-confirmation would be a *lie* without first building author-side aggregation (a dashboard on `/account` or a per-creator notification). **Phase 2** — the routing has to be built before the confirmation can ship. **Impact: high once built; do not ship the toast without the routing.**
- Separate thumbs-down from "Report content" — they're different signals. Add a low-friction `"This wasn't for me"` option to the rating bar (no report, just a domain-fit signal). Phase 1 — uses existing `thumbs_down` plumbing. **Impact: medium.**

**Risks**
"Report content" exists for safety reasons; don't dilute it. The "wasn't for me" is a *fit* signal, not a *content* signal.

**Surface priority: medium.**

---

### 16. Standout moments — highest shared, "only you got this"

**Current state**
**Does not exist.** No "highest shared" / "only you got this" sections on daily summary, game summary, or archive.

**Learning reinforcement**
- Add a single editorial card at the top of the daily summary: italic kicker `The day's piece.` Playfair italic 0.78rem, then the player's highest-difficulty correct answer of the day with the full explainer. Phase 1 — uses existing question data. **Impact: medium.**

**Shared knowledge reinforcement**
- Add two named beats between the score box and the per-question list:
  - `"Everyone in {groupName} got this one."` (correct-count = group-size for that question)
  - `"Only you, today."` (correct-count = 1 and was you)
  Both as Playfair italic 1.2rem with 40px vertical breathing, no border. Phase 2 — requires per-question group-level aggregation that I don't see in `DailySummaryView`. **Impact: high.**
- Frame "Only you, today" as territory not rank — subtext: `"Your corner of {italic domain}."` Phase 2. **Impact: high.**

**Risks**
This is the closest a non-leaderboard product gets to ranking. If the language can't be reliably kept as "territory" not "superiority," drop the surface.

**Surface priority: high.** Largest under-built surface against the shared-knowledge lens.

---

### 17. Near-miss acknowledgment ("accepted variant")

**Current state**
The `Recheck my answer` button (`GameplayChat.tsx:651-670`) exists on wrong-answer reveals. On submit, it calls `recheckAction.onSubmit()` which returns `{ accepted: boolean; message: string }`. If accepted, the existing wrong-reveal bubble stays rendered with a new message appended below the button. **The bubble does not re-color or re-state to "correct."** That's the entirety of the near-miss treatment in the live thread. No "accepted variant" indicator on review cards.

**Learning reinforcement**
- On a successful recheck, re-tint the bubble to the correct treatment (`var(--success) 9%` bg, 30% border) and replace the headline with `"Counted. {italic category}."` Phase 1. **Impact: high.** Currently the player has to read a tiny message under the button to know what happened.
- On review cards (daily/game/archive), mark recheck-accepted answers with a thin Caveat marginalia: `"counted on recheck."` 0.72rem. Phase 2 — needs a flag on the response row indicating recheck-acceptance. **Impact: medium.**

**Shared knowledge reinforcement**
- When the variant was added by the *creator* (vs LLM-generated), label the recheck message: `"{firstName} accepts this."` **Evidence:** `grading.ts:24,50` — `exactMatch(submitted, canonicalAnswer, acceptedAlternatives)` accepts both canonical AND alternative matches via the same code path, and the `isCorrect: true` result the UI sees doesn't currently distinguish which kind matched. So this is **Phase 2** for two reasons: (a) the result type needs a `matchKind: 'canonical' | 'alternative'` flag, and (b) the alternates list itself doesn't track who added each one (creator vs LLM critique-loop suggestion). **Impact: high once both are tracked.**

**Risks**
Re-coloring the bubble must not flash green if the recheck is then disputed (currently `recheckState` does not have a "rejected" tone). Keep the transition one-way.

**Surface priority: medium.**

---

### 18. Daily Summary — interpretive opening line

**Current state**
`src/app/daily/summary/page.tsx:71-125, 282-296`. Function `interpretiveLine` returns one of: `"You moved to {tier} in {domain}." / "You found new ground in {domain}." / "Clean sweep." / "Every one of them. Tomorrow." / "Three in a row at one point." / "{domain} is worth a deeper look."` Rendered as `text-muted-foreground italic text-sm` with a fade-in (`:289-294`). Critically: **the line renders below the growth recap and tier-crossing moment, not above** (`:248-259`). It opens nothing; it sits in the middle. I had the order wrong in v1.

**Learning reinforcement**
- Promote the line to the top of the page — above the `"How You Did"` header. Set as 1.3rem Playfair italic (`--font-display`) at INK 90%. Phase 1 — moving an existing render. **Impact: high.** This is the editorial voice of the day and currently whispers.
- Add domain-named variants to the rotation: `"You met {italic domain} for the first time today." / "{italic domain} got a little wider today."` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- All current variants are individual. Add relational variants gated on data: `"You and {firstName} answered the same one differently today." / "{firstName} stumped two of you." / "{firstName1} and {firstName2} both wrote for you today."` Phase 2 — requires group-level joins in the summary build. **Impact: high.**

**Risks**
Relational variants must use only shared-state facts. Anything that names a winner between players is out.

**Surface priority: high.**

---

### 19. Daily Summary — score, compatibility shifts, vote summary, game progress

**Current state**
`:200-237`. Breadcrumb `HOME / DAILY FIVE / SUMMARY` mono. Header `"How You Did"` set in `var(--font-neutral)` (sans), 1.45rem, weight 700, uppercase, letter-spacing 0.05em, `#111111`. Date below. Difficulty mode + `{correct}/{total} correct · {skipped} skipped` in mono. Then `"Your Growth Recap"` (`titleStyle`, 1.05rem sans semibold uppercase) with `CategoryGainsDisplay`. **No compatibility shifts, no vote summary, no game progress block.**

**Learning reinforcement**
- Rename `"How You Did"` → `"Today's territory."` Switch to Playfair italic, 1.45rem, normal-case. Phase 1. **Impact: medium.** Reframes the page as a learning artifact, not a scorecard.
- The mono score line is currently the second-most-prominent type element after the header. Demote to a small right-aligned chip; promote the `Your Growth Recap` block to fill the visual primary slot. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- Add a missing compatibility shifts block: `"Closer with {firstName} in {italic domain}."` (single-friend statements only — no ranking). Phase 2 — needs a `compatibility_delta` per friend per day. **Impact: high.**
- Add a missing vote summary block: `"Two of your questions got hearted today."` Phase 1 if creator-stars aggregate is queryable today. **Impact: high.**
- Game progress: single mono line `Day 9 of 14 · {N} questions answered, {M} questions taught.` Phase 1. **Impact: medium.**

**Risks**
None unique.

**Surface priority: high.**

---

### 20. Share card — mastery momentum format (primary)

**Current state**
`src/components/ShareCard.tsx:84-271`. Card 360×560 (portrait) or 360×360 (square). `linear-gradient(180deg, #fffaf1, #f5f0e8)` paper-to-cream, 1.5px ink border, `4px 4px 0` ink shadow. Top: kicker `JOSHING · TWO WEEKS` Courier 11px 700-weight, then date range Courier 11px muted, right-aligned user name Courier 10px muted. Center: **108px Georgia serif 700-weight points number** + `points this cycle` label Courier 12px. Then up to 3 highlights, each a 28-column grid: serial index Courier 12px muted + highlight body Georgia italic 18px. Highlight templates (`:57-82`): `Crossed into {tier} in {domain} / Picked up {domain} / Closest to {displayName} / Earned {N} creator points / Learned from {displayName}`. Empty fallback: `"A quiet cycle still counts."` Footer: `joshing.app` mono.

The 108px points number is the entire visual centerpiece. The card uses the brand register beautifully (Courier mono + Georgia italic + ink offset shadow).

**Learning reinforcement**
- The 108px serif number is **points** — a score. Replace with the count of new domains entered this cycle (from `beat2.friendMediated.length + beat2.authored.length + beat2.promoted.length` if unique-by-domain). Label: `new corners`. Phase 1. **Impact: high.** Pivots the share card from "score" to "learning."
- Add a "what you learned" line under the highlights, italic Georgia 0.9rem: `"You met {italic domain} for the first time."` (most recent new territory from beat 2). Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- `"Closest to {displayName}"` (line 70) — `closest` is comparative. Replace with `"Met {firstName} in {italic strongestSharedDomain}"` (uses Beat 4's `sharedDomains[0]`). Phase 1. **Impact: high.**
- `"Learned from {displayName}"` (line 78) should name what: `"{firstName} taught you {italic topDomain}"` (using Beat 3 contribution domains; payload needs per-friend domain — check Beat 3 shape). Phase 1 if domain breakdown available; Phase 2 otherwise. **Impact: high.**
- Add a credit footer: small Courier 10px line `WRITTEN BY {firstName1}, {firstName2}, +{N}` above `joshing.app`. Phase 1 — author names available from Beat 3. **Impact: medium.** Turns the card into a thank-you, not a flex.

**Risks**
"Closest" was carrying real product weight in the ceremony's alignment beat — only change it *on the share card*; keep the ceremony copy unchanged so Beat 4 still reads with the relational verb.

**Surface priority: high.** Externally visible.

---

### 21. Share card — emoji grid (secondary)

**Current state**
Does not exist.

**Learning reinforcement**
- A learning-shaped emoji grid would encode domain mix, not correctness. Build a 1×5 row of colored cells keyed to each question's broad category, with `·` overlay for skipped and `✓` overlay only on cells that crossed a tier. Phase 2 — new render + cycle payload field. **Impact: medium.**

**Shared knowledge reinforcement**
- The relational version: 1×5 row where each cell is a 50/50 split between your color and the author's color. Phase 2. **Impact: medium.**

**Risks**
Don't ship until the primary share card (#20) is right.

**Surface priority: low.**

---

### 22. Session close messaging

**Current state**
`src/components/play/SessionCloseMessage.tsx:9-29`. `{closeCopy}` (1.22rem text, `--text`, leading-relaxed). Optional primary button `"Review today's answers"`. Optional muted link `"See your Knowledge page ->"`. `closeCopy` is provided by caller (per `useCatchupFlow`).

**Learning reinforcement**
- Define a `closeCopy` rotation that always names *something learned* today: `"You met {italic domain} today." / "{italic domain} got a little wider." / "Two new things stuck. Want to see them?"` Phase 1 — copy rotation in `useCatchupFlow` or its parent. **Impact: high.**

**Shared knowledge reinforcement**
- Add a rotation that names *who*: `"You answered three from {firstName} today." / "{firstName1} and {firstName2} both wrote for you today."` Phase 1. **Impact: high.**

**Risks**
None unique.

**Surface priority: medium.**

---

### 23. Next-questions countdown

**Current state**
`GameplayChat.tsx:766-770` shows `"Next round opens {nextRoundOpensAt}"` after a session-complete event. No countdown on the home/feed surface between sessions.

**Learning reinforcement**
- Replace plain timestamp with: `"Five new ones from your people at {time}."` 0.95rem `--font-literata`. Phase 1. **Impact: low.**

**Shared knowledge reinforcement**
- Add an ambient line: `"Tomorrow: {firstName} and {N} others."` Caveat 0.85rem. Phase 1 if next-day author preview is computable from the queue; Phase 2 if picks aren't yet finalised that early. **Impact: high.**

**Risks**
Pre-announcing tomorrow's authors removes some SMS surprise. Coordinate with SMS rewrite (#1).

**Surface priority: low.**

---

# BETWEEN SESSIONS

### 24. Question archive

**Current state**
`src/app/archive/page.tsx:206-441`. Header `"Your Archive"` in `font-serif text-4xl font-semibold` (solid editorial weight). Metadata `"{N} questions · {N} correct"`. Filter row sticky: Source select, Domain select, Result select, `Show only verified` checkbox, search input. Active filters render as removable chips. Per-card (`ArchiveCard`): source label top-left mono, result badge top-right (AUTHORED sky / CORRECT emerald / WRONG rose / SKIPPED stone — `resultLabel` and `resultClass`). Question text. `You: / Answer:` block. **Explanation is in `<details>` with `<summary>Explanation</summary>`** — collapsible already. Optional creator note. Bottom row: domain pill (`bg-secondary` link to `/knowledge/{domain}`) + optional `⚠ unverified` chip + `+N pts` mono + answered date. Per-card actions: rating + send + bank.

**Learning reinforcement**
- Default sort is by date — switch to optional "by domain" grouping with editorial Playfair italic headers (count of touched questions per domain). Phase 1 — sort+group, no new data. **Impact: medium.** Turns the archive into a learning atlas.
- Add "Stumped us all" and "Best questions" views as additional Source filter options. Phase 2 — both require group-level aggregation. **Impact: medium.**
- The `<details>` summary text `"Explanation"` is generic. Replace with the same kicker proposed in #13: `"Why →"` `var(--font-display)` italic. Phase 1. **Impact: low** (cross-cutting consistency).

**Shared knowledge reinforcement**
- Add an `Authors` filter dimension — view by who wrote it. Phase 1 if `creatorId` is on the row payload (it is, since `AUTHORED` is one of the result classes). **Impact: high.**
- Source labels `Sent to me / Mine` are utilitarian. Replace with `From friends / Yours`. Phase 1. **Impact: low.**

**Risks**
None unique.

**Surface priority: medium.**

---

### 25. Knowledge page — spider graph for top 8 domains

**Current state**
`src/app/knowledge/page.tsx:455-471`. `"Your Knowledge"` kicker (small-caps Montserrat) + `"See how your knowledge is building →"` sub-kicker. Renders `<PortraitCircles entries={portraitEntries}>` with `getPortraitDomainColor`. Below: `"Share portrait"` button in Courier white-on-black with 2px 2px 0 #3a3a3a offset shadow — uses the brutalist editorial register.

**Learning reinforcement**
- Overlay a Caveat handwriting arrow on the most-recently-grown circle: `growing` or `just entered`. Phase 1 if `last_grown_at` is on the entry; check `RecentlyExpanding` component (which exists at `:453`) for the data path. **Impact: high.**
- Resolve tier vocabulary (Preface §1) — PortraitCircles uses the canonical `KNOWLEDGE_TIER_LABEL` set, so fixing that file fixes this surface.

**Shared knowledge reinforcement**
- Currently visualizes your own mastery only. Phase 2: overlay a dashed Caveat circle showing the *group's* average mastery in each domain — a backdrop, never a benchmark. Requires group aggregation in portrait payload. **Impact: high.**
- For each circle, a 0.6rem mono caption `WITH {firstName} +{N}` listing other carriers. Phase 2. **Impact: high.**

**Risks**
Group-average overlay must never be sortable or rankable. It's a context, not a metric.

**Surface priority: medium.**

---

### 26. Knowledge page — list of remaining domains

**Current state**
`src/components/knowledge/DomainRow.tsx:25-89`. Row layout: title (1rem `--text`) + tier label (0.88rem warm gray) + `<DomainProgressBar>` + `"Your q's"` label and 5-dot contribution indicator (filled `#111111` / unfilled `#ddd6c7`). Right side: optional `Declared` badge (uppercase Inter 0.62rem 700-weight, ink border + ink text), optional points label, chevron `›`. Special states: `"New territory"` (when `masteryPoints === 0`); `"Add questions here to reach mastery."` (when `yourQuestionsCount === 0` and tier ≥ solid).

**Learning reinforcement**
- The tier label sits under the title in 0.88rem warm gray — already legible but uses the canonical `KNOWLEDGE_TIER_LABEL` (Establishing/Familiar/Solid/Mastery). Resolve to brief's set (Preface §1). Phase 1. **Impact: medium.**
- `"Your q's"` is too cute and abbreviated. Replace with `Authored` and the actual count, e.g. `Authored: 3`. Phase 1. **Impact: low.**

**Shared knowledge reinforcement**
- Add a fourth meta-row item: `Shared with {N}` (count of friends with ≥1 correct in this domain). Phase 2 — needs per-domain friend-overlap aggregation. **Impact: high.** Turns the list from a personal ledger into a meeting map.

**Risks**
None unique.

**Surface priority: medium.**

---

### 27. Mastery tier display on profile

**Current state**
`src/app/users/[id]/page.tsx`. Heading `"Knowledge portrait"`. Renders `KnowledgeCard` with `KNOWLEDGE_TIER_LABEL` set. On account/domain detail pages (`src/server/db/queries/account.ts:26-31`, `src/app/knowledge/[domain]/page.tsx:53`), uses **Curious / Explorer / Scholar / Sage** instead. So a player who taps from their profile into a domain detail sees a tier-name change.

**Learning reinforcement**
- Unify (Preface §1). Phase 1.

**Shared knowledge reinforcement**
- On a friend's profile, add a `"What you share"` block above the portrait: `"You and {firstName} share {N} territories."` with the top 3 in mono. Phase 1 — shared-domains is the same query used in `OverlapMap`. **Impact: high.**

**Risks**
None unique.

**Surface priority: high** (because of the tier-name fork).

---

### 28. Personal Round summary screen

**Current state**
`src/app/games/[id]/summary/page.tsx:197-355`. Breadcrumb `HOME / {title} / SUMMARY`. Header `"How You Did"` (sans uppercase 1.45rem, same style as daily). Success-tinted score box: `Total` kicker → `+{totalPoints}` in font-mono 5xl 700-weight → `{correct}/{count} correct · {N} skipped` mono. `"Your Growth Recap"` block. Optional `MasteryMoment` for first tier crossing. Then `"Round Recap"` with per-question cards — **each card top-left says `"From {creator.displayName}"`** in mono 0.62rem uppercase muted (different from daily which says `"JOSHING BOT · {DOMAIN}"`). Top-right: difficulty pill (`difficultyCopyFromEstimate` → rose/amber/sky) + result badge. Then `Your Impact Recap`: `"{N} of your questions were answered correctly this round."` Then OverlapMap (single-recipient only). Bottom: `"Back to Feed"` btn-ghost only.

**Learning reinforcement**
- Same renames as #19: `"How You Did"` → `"Your game."`, `"Your Growth Recap"` → `"What got wider."` Phase 1.
- The `font-mono text-5xl font-bold` `+{points}` is a scoreboard. Soften: same number in Playfair italic 5xl (`--font-display`). Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- `"Your Impact Recap"` is a great surface that currently uses a count, never names. Replace with named version: `"{firstName1} and {firstName2} got your questions right."` (with `+{N} others` overflow). Phase 1 if responses include answerer identity per question; the data IS already loaded (`authoredQuestionsAnsweredCorrectly` at `:172-180`). **Impact: high.**

**Risks**
Naming answerers requires their privacy posture — but answer participation in a single game is already implicitly public to other participants.

**Surface priority: medium.**

---

### 29. Catch-up / missed questions (half-credit treatment)

**Current state**
`src/app/daily/catchup/page.tsx`. Header: nav crumb `Home / Catch up`, then label `"Catch up"` (mono caps), then `"{N} missed {question(s)} from the past week"` in font-serif xl semibold. Right-side `{N} of {N} remaining`. Dismissable intro card: `introCopy` (from `useCatchupFlow`) + `CATCH_UP_POINTS_CAPTION = "These count for 0.25x points - the moment has passed, but the territory is still worth claiming."` (`src/server/play/catch-up-copy.ts:13-14`). On completion: success-tinted card `All handled` kicker + `CATCH_UP_COMPLETION_COPY = "Catch-up complete."` + `"{N} caught up - {N} correct - {N} dismissed"`. Empty: `"Nothing to catch up on. You're all clear."` Per-question subhead set as `"FROM YESTERDAY"` / `"FROM {N} DAYS AGO"` / `"FROM {weekday}"` in `QuestionRow.subhead`. Below the form: `"I give up"` button (instead of skip) + `"Not interested"` link → drop-from-catchup confirm dialog `"Drop this from catch-up?"`.

**Learning reinforcement**
- Intro copy is already very good. **Keep verbatim** (`"the territory is still worth claiming"` is the brief's exact register).
- Surface the catchable territory: when ≥2 catchup items are in the same domain, prepend a Playfair line: `"3 of these are in {italic domain} — somewhere you're already building."` Phase 1 if the catchup queue exposes domains. **Impact: medium.**

**Shared knowledge reinforcement**
- Subhead `"FROM YESTERDAY"` is time-only; promote to author-led: `"From {firstName}, {when}."` (`when` = "yesterday" / "3 days ago" / "Tuesday"). Replace `QuestionRow.subhead` content. Phase 1 — both `creatorName` and the day-offset are already available. **Impact: high.**
- Completion copy `"Catch-up complete."` is utilitarian. Replace with `"You met them all."` Phase 1. **Impact: medium.**

**Risks**
None unique.

**Surface priority: medium.** Already strong; small leverage.

---

### 30. Group Knowledge Map (`OverlapMap`)

**Current state**
`src/components/OverlapMap.tsx`. **This is the gold-standard editorial surface in the product.** Renders as a section card with `background: #faf8f2`, `border: 2px solid #1a1a1a`, `boxShadow: 6px 6px 0 #1a1a1a` (the exact brief register). Headline `"Where you've met / so far."` in Playfair italic 1.65rem (first line sans for contrast, second line italic). Legend with player colors. Grouped by broad category (Courier header 0.72rem uppercase). Per category cell: SVG with two overlapping circles (sized by mastery points, overlap by `sharedCorrect/max(aCorrect,bCorrect)`), italic Playfair domain name 0.95rem, mono `{N}% shared`. `"Your strongest overlap"` pull-quote box at the bottom (mono kicker + 1.35rem italic Playfair domain). Footer: `"Categories where neither of you has answered correctly together are hidden. They'll appear when you do."` (italic Playfair 0.78rem muted ink).

Rendered only on the game summary, for single-recipient games (`src/app/games/[id]/summary/page.tsx:185-194`). The CLAUDE.md mentions a `/leaderboard` route that "renders the Group Knowledge Map" — I did not confirm this route exists in code during this redo; the surface I verified is the in-summary embed.

**Learning reinforcement**
- Domain name sits *below* the venn. Move it *above* — so the diagram reads as evidence for a named thing. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- The headline `"Where you've met so far."` is among the best copy in the product. Keep verbatim.
- Per-venn add a reciprocity caption: `"{firstName} taught you 2; you taught {firstName} 1."` mono 0.6rem under the percentage. Phase 1 if both-direction counts are derivable from `aCorrect`/`bCorrect` deltas. **Impact: high.** Turns overlap into reciprocity.
- Multi-recipient extension (N>2 players): currently the component is hard-typed for `[player, player]`. Phase 2 — needs N×N matrix view, one venn per pair, organized by domain. **Impact: high.**

**Risks**
Don't introduce `%correct` or `points` here — both would slide toward ranking. `%shared` is symmetric and safe.

**Surface priority: high.**

---

### 31. Intellectual Alignment surface

**Current state**
`src/components/profile/SharedInterestsOverlap.tsx` (per Explorer; not directly read this round but corroborated by archive routes and friends hub). Kicker `"Common ground"` + `"You and {firstName} share {N} interest(s)."` Venn with `"You"` / `"{firstName}"` columns + shared center pills.

**Learning reinforcement**
- The overlap is *declared interests*. Add a parallel block: `"Where you've both shown your hand:"` listing domains where both have ≥1 correct answer (same data the OverlapMap uses). Phase 1. **Impact: high.** Connects declared territory to proven territory in one view.

**Shared knowledge reinforcement**
- `"Common ground"` is overused (also in `FeedList.tsx:190,242,560,561`). Replace the kicker here with `"Where you overlap."` Phase 1. **Impact: low.**

**Risks**
None unique.

**Surface priority: medium.**

---

### 32. Author profile

**Current state**
`src/app/users/[id]/page.tsx`. Avatar (initial in colored circle), display name (3xl serif bold). `"On Joshing since {month year}"` + optional `"Friends since {month year}"`. Knowledge Portrait with KnowledgeCard. Authored Questions Feed at the bottom.

**Learning reinforcement**
- `"On Joshing since"` is meta. Replace with a domain-anchored line: `"Building {italic domain} since {month}."` (uses their oldest or strongest domain). Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- Add a `"What we share"` block above Authored Questions: top 3 shared domains + mini-overlap venn. Phase 1 — shared-domain queries exist. **Impact: high.**
- On the Authored Questions list, add per-question marginalia: `"You answered this {when}."` or `"You haven't seen this yet."` Phase 1. **Impact: medium.**

**Risks**
None unique.

**Surface priority: medium.**

---

# QUESTION CREATION

### 33. Question creation interface

**Current state**
`src/components/QuestionForm.tsx`. Page title `"Write a question"` (`src/app/questions/page.tsx:416`). Field labels in mono 0.75rem uppercase: `Question`, `Correct answer`, `Alternate answers`, `Explanation`, `Creator note`. Placeholders: `"What is the name of Alexander the Great's horse?"`, `"Bucephalus"`, `"Accepted variations, separated by commas"`, `"A short note that helps someone learn if they miss it."`, `"Optional context for recipients"`. Character counters under each field.

**The form has a critique loop I missed in v1** (`:407-426`): when the player saves a question, an LLM critique step may flag it: `"⚠ This question might be unclear:"` + bullet issues + `"Try one of these instead:"` + clickable reformulations. Counter: `"5/5 question reviews used today. You can still save your question; AI review returns tomorrow."`

**Learning reinforcement**
- Add a single italic Playfair subhead under the page title: `"Something specific. Something a friend should know but might not."` Phase 1. **Impact: medium.**
- The critique loop's `"⚠ This question might be unclear:"` is good. Soften the verb so the LLM reads as a collaborator: `"Could be sharper:"` (no warning icon). Phase 1. **Impact: low.**

**Shared knowledge reinforcement**
- Replace page title `"Write a question"` with `"A piece of your world."` in Playfair italic 1.6rem. Caveat subhead: `"Pick something specific."` Phase 1. **Impact: high.**
- Currently the only audience signal is the Destinations card at the very end. Add Caveat marginalia next to the question field on first focus: `"For whomever you choose."` 0.85rem. Phase 1. **Impact: medium.**

**Risks**
Don't soften so much it discourages utility. Keep the example placeholders.

**Surface priority: high.** Supply-side of the entire game.

---

### 34. LLM answer suggestion moment

**Current state**
`QuestionForm.tsx`. Suggestion auto-runs on entry to ANSWERING stage (`:322-337`). While loading: `"Suggesting answer..."` 0.875rem muted. On review with mismatch (`:479-484`): `"LLM suggestion"` kicker + strikethrough on the LLM answer (amber decoration). Verification states (`:493-495`): `"✓ Verified — matches LLM suggestion"` (emerald) or `"⚠ Unverified — your answer differs from the LLM's suggestion. Recipients will see this."` (amber). AI classification call-out (`:474-477`): `"Joshing will read the question and answer when you save, then use the LLM to choose the broad category, precise domain, and difficulty."`

**Learning reinforcement**
- Replace `"Suggesting answer..."` with `"Reading..."` Phase 1. **Impact: low.**
- Replace `"LLM suggestion"` kicker with `"Joshing read it as:"` — consistent with the classification call-out's "Joshing" personification. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- Replace `"✓ Verified — matches LLM suggestion"` with `"Joshing agrees."` Phase 1. **Impact: medium.**
- Replace `"⚠ Unverified — your answer differs from the LLM's suggestion. Recipients will see this."` with `"You and Joshing disagree. Your friends will see your answer."` Phase 1. **Impact: medium.** Aligns the verification with authorial authority over your question.
- The AI classification call-out is fine. Keep verbatim.

**Risks**
Don't over-personify the bot. "Joshing agrees" is the upper limit — anything more is whimsy the register can't carry.

**Surface priority: medium.**

---

### 35. Public pool opt-in toggle

**Current state**
`QuestionForm.tsx:499-519`. Card titled `Destinations`. Always-on disabled checkbox `"Save to bank"`. Off-by-default `"Share with all friends"`. Off-by-default `"Send to specific friends only"`. **Default state of `shareToFeed` is `!initialSpecificMode`** (line 111) — so by default for ordinary creation, `shareToFeed` is TRUE. I had this wrong in v1.

Three-state footer copy: `"Sent directly to the friends you pick." / "Your friends will see this in their feed (except friends who've marked this domain as Not my focus)." / "Saved to your bank only."`

**Learning reinforcement**
- None unique.

**Shared knowledge reinforcement**
- Replace `Destinations` (UPS register) with `Who sees it.` Phase 1. **Impact: low.**
- The "share with all friends" supporting text leads with exclusions ("except friends who've muted..."). Lead with the positive: `"Your friends see this in their feed."` then on a second muted line: `"(unless they've muted {italic domain}.)"` Phase 1. **Impact: medium.**
- Add Caveat marginalia next to "Save to bank": `"yours, always"` 0.78rem INK 60%. Phase 1. **Impact: low.**

**Risks**
Default-on `shareToFeed` is already a generous default — don't change it without a separate consent review.

**Surface priority: medium.**

---

### 36. "Why I added this" optional creator note

**Current state**
`QuestionForm.tsx:488-492`. Label `Creator note` mono uppercase. Placeholder `"Optional context for recipients"`. 200-char limit. Renders in review stage only. The same note then appears on review cards with prefix `"A note from {authorName}:"`.

**Learning reinforcement**
- Add an example placeholder rotation: `"e.g. I think about this every time I hear the second movement." / "e.g. My dad taught me this on a long drive." / "e.g. I had to look it up — twice."` Phase 1. **Impact: medium.** Pulls the field from metadata toward memory.

**Shared knowledge reinforcement**
- Replace label `"Creator note"` with `"Why this one."` in Playfair italic 0.95rem (the only field that breaks the mono-uppercase label register, on purpose). Phase 1. **Impact: high.**
- Replace placeholder `"Optional context for recipients"` with `"What made you think to ask it?"` Phase 1. **Impact: high.**

**Risks**
None unique.

**Surface priority: high.** Where the question becomes a gift.

---

### 37. Question bank in contribution flows

**Current state**
`src/components/QuestionBankPicker.tsx` (per Explorer, not re-read). Picker entry: `"Pick up to {N} questions from your bank to contribute."` Per-question: `{category} · Written by you / From {authorName}`. Empty bank: `"Your question bank is empty."`

**Learning reinforcement**
- Add a domain-freshness default sort: questions in domains the *recipient* has been entering recently. Phase 2 — needs recipient context at picker time. **Impact: medium.**

**Shared knowledge reinforcement**
- Replace `"contribute"` (utilitarian) with `"send"`. Phase 1. **Impact: low.**
- `"Written by you / From {authorName}"` is good provenance. Phase 1 sufficient as is.

**Risks**
None unique.

**Surface priority: medium.**

---

# GAME-END (CEREMONY)

### 38. Ceremony Act 1 — Portrait beat (Beat 1)

**Current state**
`src/app/ceremony/[ceremonyId]/page.tsx:111-129`. On dark stone-950 bg, white text. Heading `"You leveled up."` in `font-serif text-5xl/7xl font-semibold`. Below: max-width-xl left-aligned grid. Per-crossing row: `CeremonyCircle` scaled by `TIER_SCALE[toTier]` (0.28/0.48/0.72/1) on the left, then a column with `{domain}` in font-serif xl semibold (stone-50) + tier transition `{TIER_LABEL[fromTier]} -> {TIER_LABEL[toTier]}` in mono xs uppercase (stone-400, letter-spacing 0.16em). Tap-to-advance interaction on the surrounding `<main>` (`:332`).

**Learning reinforcement**
- `"You leveled up."` is gaming register. Replace with `"You grew."` Phase 1. **Impact: medium.**
- Add a single Playfair-italic line under the heading: `"In {italic domain1}, {italic domain2}, and {italic domain3}."` 1.6rem stone-200. Phase 1. **Impact: high.** Names the actual learning at the most-receptive moment.

**Shared knowledge reinforcement**
- None for this beat — it's intentionally personal.

**Risks**
Don't crowd Act 1 with collective signal; that's Act 2's role.

**Surface priority: medium.**

---

### 39. Ceremony Act 1 — Personal Record beat (Beat 2's three sub-blocks)

**Current state**
`:132-193`. Beat 2 renders up to three sub-blocks stacked, each with its own 5xl/7xl heading:
- `"You went somewhere new."` + `"Through your friends, you picked up {N} {question(s)} in {domains}."` + per-domain circles (scaled by `0.45 + correctCount/questionCount * 0.45`) with `{correctCount}/{questionCount}` mono caption.
- `"You staked new territory."` + `"You wrote questions that opened {a new domain | {N} new domains}: {domains}."` + circles at scale 0.35 with `Declared` caption.
- `"Your territory came to life."` + `"A friend answered your questions and proved your knowledge in {domains}."` + circles at scale 0.7 with `Demonstrated` caption.

The brief mentioned "seven reveals" — I see three sub-blocks; the other four are not implemented as discrete sub-beats.

**Learning reinforcement**
- Promote the listed domains in each sub-block from inline run-on to dedicated italic Playfair lines, one per domain. Phase 1 — just a layout change. **Impact: medium.**
- Add four missing reveals (brief alignment):
  - `"You doubled back."` — questions missed early in cycle, got right in catchup. Phase 1 if catchup-correctness deltas are queryable.
  - `"You went deep."` — domain with most questions answered in cycle. Phase 1.
  - `"You held the line."` — questions right in a domain where group average <50%. Phase 2 (needs group agg).
  - `"You got close."` — near-miss accepted variants. Phase 2 (needs flag).
  Combined **Impact: medium-high.**

**Shared knowledge reinforcement**
- Sub-block 1 lists domains but not the friends. Add: `"Through {firstName1}, {firstName2}, and {firstName3}, you picked up..."` Phase 1 — Beat 2's `friendMediated` items currently only carry `domain / questionCount / correctCount`, so a small server-side enrichment is needed (add `topContributor: { displayName }` per friendMediated item). **Impact: high.**
- Sub-block 3 (Demonstrated): name the friend who proved your question: `"{firstName} answered your question about {italic domain}."` Phase 1 with same enrichment. **Impact: high.**

**Risks**
Don't pad with low-signal beats — define minimum thresholds so empty sub-beats don't fire.

**Surface priority: high.** Most-rendered narrative.

---

### 40. Ceremony Act 2 — Group Knowledge Map beat (Beat 3)

**Current state**
`:196-211`. Solo override: `"Questions that shaped your cycle."` Duo/group: `"These people taught you something."` Body per contributor: `"{displayName} contributed {N} {question(s)}."` Top 3 contributors only (suppressed in solo via `compute-beats.ts:454`). No domain breakdown per contributor.

**Learning reinforcement**
- `"contributed"` is utilitarian. Replace with domain evidence: `"{firstName} — {italic domain1}, {italic domain2}, and {N} more."` Phase 1 with per-contributor domain enrichment in Beat 3 payload; Phase 2 otherwise. **Impact: high.**

**Shared knowledge reinforcement**
- Heading is already excellent. Keep.
- Add a closing summary after the contributor list: `"In total, your friends carried {N} questions into your world this fortnight."` 1.4rem Playfair italic. Phase 1. **Impact: medium.**

**Risks**
Naming domains-per-friend creates a privacy surface — propagate `profileDomainVisibility` like Beat 4 already does (`compute-beats.ts:373`).

**Surface priority: high.**

---

### 41. Ceremony Act 2 — Authorship Impact beat (Beat 5)

**Current state**
`:227-239`. `"You taught people things."` + `"Your questions earned {N} points for others this fortnight."` + optional `"Your most-played: \"{question.text}\""` (Beat 5 data: `totalCreatorPoints` and `topQuestion`).

**Learning reinforcement**
- `"points for others"` is system register. Replace with `"answered correctly by your friends"`. Phase 1. **Impact: medium.**
- For the most-played question, name its domain: `"Your most-played, in {italic domain}: \"{question.text}\""` Phase 1 if `topQuestion` carries domain (likely needs server-side add — Phase 2 if not). **Impact: medium.**

**Shared knowledge reinforcement**
- Name *who* answered the most-played: `"{firstName1}, {firstName2}, and {N} others answered."` Phase 1 if Beat 5 includes answerer list (currently it has only `answeredCount`, so Phase 2). **Impact: high.**

**Risks**
None unique.

**Surface priority: high.**

---

### 42. Ceremony Act 2 — Relational Feedback beat (Beat 4)

**Current state**
`:214-224`. `"You and {displayName} see the world similarly."` + `"You both know {joinList(sharedDomains)}."` Picks the friend with most shared domains (`compute-beats.ts:379-380`), respects `profileDomainVisibility` private flag (`:373`).

**Learning reinforcement**
- The flat join of shared domains compresses into one run-on sentence. Stack: one Playfair italic 1.1rem line per shared domain. Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- Heading is among the best in the product. Keep verbatim.
- Add a closing marginalia: `"That's not nothing."` Caveat 1rem. Phase 1. **Impact: medium.**

**Risks**
None.

**Surface priority: medium.** Already strong.

---

### 43. Ceremony Act 2 — Climax beat (group / duo / solo modes)

**Current state**
`:336-361`. End-card after last beat: `"That's your two weeks."` + `"See you in another fourteen days."` + Share / Done buttons. **No explicit climax beat per mode** — solo just sees Beats 1, 2, 5 (Beats 3 and 4 suppressed); duo/group see all five. No mode-specific copy beyond the suppression.

**Learning reinforcement**
- Promote the cycle's single most-significant tier-cross to the closing line: `"And {italic domain} is yours now."` Playfair italic 1.8rem above `"That's your two weeks."` Phase 1 — first beat1 entry is the candidate. **Impact: high.**

**Shared knowledge reinforcement**
- Mode-specific closing lines:
  - **group:** `"You and {N} others answered each other for fourteen days."` 1.4rem. Phase 1.
  - **duo:** `"You and {firstName} — fourteen days of asking each other."` 1.4rem Playfair italic. Phase 1.
  - **solo:** `"Your two weeks. The map kept building."` Playfair italic 1.4rem — softens the bleakness of solo without referencing absent friends. Phase 1.
  Each **Impact: high.**

**Risks**
Solo copy must not patronise. Test with a real solo cycle.

**Surface priority: high.**

---

### 44. Ceremony Act 2 — Invitation beat

**Current state**
`:367-422`. Share modal — see #20 for ShareCard content. There is **no explicit invitation beat** — the modal IS the invitation, and the only invitation language is the ShareCard text itself.

**Learning reinforcement**
- Before the share modal opens, add a tertiary card after the end-card: `"Bring someone into your world."` Playfair italic 1.4rem + secondary button `"Invite a friend"` routing to `/friends`. Phase 1 — uses existing invite route. **Impact: medium.**

**Shared knowledge reinforcement**
- The invitation beat the brief described doesn't yet exist as a discrete moment. Add a one-domain prompt: `"You and {firstName} share {italic domain} now. Who else might?"` with `"Send {firstName}'s question to →"` action targeting a likely contact. Phase 2 — requires contact suggestion + targeted-share. **Impact: high.**

**Risks**
The line between "invite a friend" and "growth hack" is short. Keep prompts strictly relational.

**Surface priority: medium.**

---

### 45. Game Summary Page — Group Story section

**Current state**
Section does not exist. Closest analog: `"Your Impact Recap"` (see #28).

**Learning reinforcement**
- Build the section. Title `"The group's story."` Playfair italic 1.6rem. Three lines: `"Everyone got {N} right." / "Hardest one today: \"{question.text}\" — {italic domain}." / "Most asked from: {firstName} ({N} questions)."` Phase 2 — needs group-level summary build. **Impact: high.**

**Shared knowledge reinforcement**
- Same proposal — by definition this section is the group story.

**Risks**
"Hardest one" must mean *observed* lowest correctness, not *declared* highest difficulty.

**Surface priority: high.** Largest missing surface.

---

### 46. Game Summary Page — Your Game section

**Current state**
`src/app/games/[id]/summary/page.tsx:202-237`. Header `"How You Did"` (sans uppercase 1.45rem) + success-tinted score box.

**Learning reinforcement**
- `"How You Did"` → `"Your game."` Playfair italic 1.45rem. Phase 1.
- The `+{points}` is `font-mono text-5xl font-bold` — set in Playfair italic instead, matching the brief's editorial register. Phase 1. **Impact: low.**

**Shared knowledge reinforcement**
- Add a one-line summary above the score: `"You answered {N} of {firstName1}, {firstName2}, and {firstName3}'s questions."` Phase 1 — authorship is on each `view.questions[].question`. **Impact: high.**

**Risks**
None.

**Surface priority: medium.**

---

### 47. Game Summary Page — What You Discovered section

**Current state**
`:239-252`. `"Your Growth Recap"` header + `CategoryGainsDisplay`. Optional `MasteryMoment` overlay. Empty fallback `"No mastery movement was recorded for this game."`

**Learning reinforcement**
- Rename to `"What you discovered."` Playfair italic 1.6rem. Phase 1. **Impact: high** (brief alignment).
- Empty fallback `"No mastery movement was recorded for this game."` is dispiriting. Replace with `"No new corners today — you held what you had."` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- For each new-territory entry, add Caveat marginalia: `"from {firstName}."` 0.72rem. Phase 1 — author of the entry's first question in this cycle. **Impact: high.**

**Risks**
None.

**Surface priority: high.**

---

### 48. Game Summary Page — Group Portrait section

**Current state**
`:344-351`. `OverlapMap` only for single-recipient games. See #30.

**Learning reinforcement**
- For multi-recipient (Phase 2 extension of #30): add a kicker `"The territory you all built together."` Phase 2. **Impact: high.**

**Shared knowledge reinforcement**
- Already strong. Add a one-line domain call-out above the venns: `"You met hardest in {italic strongestOverlapDomain}."` 1.05rem Playfair italic. Phase 1 — `strongest` is already computed (`OverlapMap.tsx:149-156`). **Impact: medium.**

**Risks**
"Hardest" must reference observed difficulty × shared correctness. Confirm metric meaning.

**Surface priority: medium.**

---

# OFF-SEASON

### 49. Challenge Worlds entry surface

**Current state**
**Does not exist.** No "Challenge Worlds" feature.

**Learning reinforcement**
- Concept (Phase 2): off-season themed micro-collections from a single hyper-specific domain. Home-screen entry card between seasons: `"You crossed into {italic domain} this cycle. Want to go deeper before the next one?"` Whole feature is Phase 2. **Impact: high** (when built).

**Shared knowledge reinforcement**
- Default to co-play: `"Take this with {firstName}?"` (friend with strongest overlap in the domain). Phase 2. **Impact: high.**

**Risks**
Speculative — depends on whether off-season product direction includes this.

**Surface priority: low** today; high once built.

---

### 50. Friend Play

**Current state**
**Does not exist as a named surface.** Adjacent: Friends Hub (`src/components/FriendsHubPage.tsx`), Replay (`src/app/replay/page.tsx`: `"Contain more multitudes." / "Practice questions you previously missed. Nothing here changes your score."`), Quick-Add modal.

**Learning reinforcement**
- The Replay page is the closest analog. Strong copy. Add domain filter so practice can be focused: `"Practice in {italic domain}."` Phase 1. **Impact: medium.**

**Shared knowledge reinforcement**
- Build a one-tap action from a friend's profile: `"Ask {firstName} five questions"` — pulls 5 unanswered questions from their bank, runs in catchup mode (no record). Phase 2 — new ad-hoc game type. **Impact: high.**

**Risks**
Don't conflate Friend Play (read-only of their bank) with their daily queue.

**Surface priority: low** today; medium once built.

---

# TOP 10 HIGHEST-IMPACT CHANGES

1. **Unify mastery tier vocabulary across all six surfaces** (Preface §1). Recommend the brief's `Curious → Versed → Fluent → Master`. Most-damaging consistency issue; gates ~30% of downstream proposals.
2. **Add italic-Playfair canonical-subcategory above every in-session question bubble** (#4). Currently the player never sees what they're about to learn.
3. **Promote `creatorName` to Caveat handwriting above every in-session question bubble** (#4). Caveat is loaded as `--font-handwriting` and currently unused on this surface.
4. **Rebuild the wrong-answer reveal — promote the canonical breadcrumb to 0.92rem Playfair italic, add a "now it's in yours too" sub-label and a `{firstName} thought you might` rotation** (#8). North-star metric is wrong-answer reaction rate; current treatment is consolation, almost no learning.
5. **Promote the daily-summary explainer from `text-muted-foreground` to body weight with a `Why.` Playfair italic kicker, defaulting `<details open>` on wrong-result cards** (#13, #14). The densest learning surface in the loop is currently the visually quietest, and the brief's correct/wrong asymmetry is unimplemented despite the data model already supporting it (`_Wrong` explainer fields exist).
6. **Author-led noon SMS: `"{firstName} and {N} others wrote your five."`** (#1). First touchpoint of the day.
7. **Promote `From {firstName}.` to a 2-line editorial header on every end-of-session review card** (#11). Author currently appears only in the creator-note label on daily summary; system kicker `JOSHING BOT · {DOMAIN}` should be removed in the same change. Phase 1.5 — needs a one-join enrichment of `QuestionRecap` (verified in this pass; see #11 evidence note).
8. **Add domain-named line under ceremony Act 1 Portrait beat: `"In {italic domain1}, {italic domain2}, and {italic domain3}."`** (#38). Names the learning at the most-receptive moment.
9. **Restore brief's `"Why this one."` creator-note framing with placeholder rotation `"I think about this every time…"`** (#36). Currently labeled `Creator note` / `Optional context for recipients` — pure metadata.
10. **Build the missing Group Story section on the game summary page** (#45, Phase 2). Largest missing collective surface.

Three runners-up worth mentioning:
- **Soften season-end SMS "knew you best" winner language** (#1). Soft leaderboard tell that crosses the brief's no-ranking line.
- **Rewrite creator-note-prompt SMS to name the answerer** (#1). Currently `"Someone got your question wrong"`; should be `"{firstName} just missed your question"`.
- **Implement the brief's collapsed-when-correct, expanded-when-wrong creator-note treatment** (#14). Same field on every surface; cheap to fix.

---

# CROSS-CUTTING PATTERNS

1. **Every wrong-answer surface should name the domain in display size before showing the explainer.** Applies to in-session wrong reveal (#8), end-of-session review card (#11), archive card (#24), game-summary recap (#28). One consistent treatment: italic Playfair display, INK at 85%, above the explainer block.
2. **Every author reference outside the creator-note prefix should be Caveat handwriting (`--font-handwriting`), not mono.** Mono reads as system metadata; Caveat reads as a person. Applies to in-session bubble (#4), wrong-reveal breadcrumb (#8), end-of-session review (#11), catchup subhead (#29), ceremony beats 3/4/5 (#40/42/41), share card credits (#20). Caveat is already loaded and currently underused.
3. **Replace "common ground" anywhere it appears more than once.** Currently overused in `FeedList.tsx:190,242,560,561` and in `SharedInterestsOverlap`. Use sparingly; default to `"where you've overlapped"` or `"in both your banks now."`
4. **Replace `"How You Did"` / `"Your Growth Recap"` / `"Round Recap"` with domain-named editorial phrasing.** Applies to daily summary (#19), game summary (#28, #46, #47). Drop `text-transform: uppercase` and the `var(--font-neutral)` sans treatment in favor of `--font-display` italic in title slots.
5. **`MasteryMoment` should be the single canonical tier-cross visual moment** — appears in (a) game summary (already), (b) daily summary (already), (c) ceremony closing climax (#43 proposes adding the most-significant cross there as a one-line callout, not a full overlay). Three appearances, identical timing.
6. **Whenever a question appears in a list (archive, feed, knowledge), three pieces of metadata should accompany it in this order: author (Caveat), domain (italic Playfair), result/difficulty badge (mono small caps).** Currently those three are scattered, inconsistently weighted, sometimes absent.
7. **`From` is the canonical authorship preposition.** Use everywhere — never `"Written by"`, `"Asked by"`, `"Contributed by"`. Already mostly consistent; standardise the QuestionBankPicker.
8. **Solo-mode ceremony needs explicit copy, not just suppression of group beats.** Currently solo players see Beats 1, 2, 5 and the missing beats leave dead air. Add solo-specific replacement copy for Beats 3 and 4 in `compute-beats.ts`.
9. **Domain names should always be italic Playfair (`--font-display`), never mono uppercase.** Currently the same domain renders as `LITERATURE` (mono) on daily-summary card headers and `Literature` (Playfair italic) in OverlapMap — same data, two different registers, two different mental models (tag vs. content).
10. **Every "you taught" / "you learned" claim should name a domain and at least one person.** Numbers alone (`"{N} creator points"`, `"{N} questions"`) do almost no work on either lens.

---

# OPEN QUESTIONS / FORKS

**Resolved in this pass:**
- ~~Q4 (grading exact vs variant distinction):~~ **Resolved.** `grading.ts:50` uses one fast-path for both canonical and alternative matches; the result type does not carry which kind matched. To surface near-miss acknowledgment, the grader needs to return `matchKind` plus a flag on the alternates list for who added each one. See #17 evidence.
- ~~Q5 (per-question group aggregation in daily summary):~~ **Resolved.** `DailySummaryView.QuestionRecap` (`daily-summary.ts:30-43`) carries no group-level fields. Standout moments (#16) and compatibility shifts (#19) require new query joins — confirmed Phase 2.
- ~~Q6 (bank origin preservation):~~ **Resolved.** `sourceQuestionId` column exists on `questions` (`schema.ts:210`, indexed at `:261`). #12 `"From {originalAuthorFirstName}, originally."` is Phase 1, not Phase 2.
- ~~Q7 (explainer provenance tracking):~~ **Resolved.** Eight explainer text fields exist on the schema (`schema.ts:230-237`), but they're flat text — no `_source` companion. #13 `"in {firstName}'s words"` is Phase 2 (needs new column). However, the data over-supports the brief's correct/wrong asymmetry: `_Correct`, `_Wrong`, and `_Expired` variants all exist; the UI currently only reads `_Wrong` and the unsuffixed default.
- ~~Q8 (heart-vote routing to author):~~ **Resolved.** `/api/daily/feedback` (`route.ts:53,73`) just writes to `questionFeedback`. No author aggregation or surfacing. The proposed `"{firstName} will see this."` micro-confirmation is **Phase 2** — must first build author-side aggregation. Do not ship the confirmation before the routing exists.

**Still open — need a product call:**

1. **Mastery tier vocabulary canonical form.** Code has four sets across six surfaces; brief specifies a fifth. Recommended: brief's `Curious → Versed → Fluent → Master`. Gates ~30% of Phase 1 proposals.
2. **Are the brief's missing copy lines and surfaces intent or stale?** Specifically: `"now it's in yours too"`, `"common ground +"` sub-label, standout moments, accepted-variant near-miss, share-card emoji grid, Group Story, next-questions countdown, Challenge Worlds, Friend Play. Determines whether several proposals build vs. retire.
3. **Ceremony dark theme vs. cream register elsewhere.** Is the `stone-950` ceremony a deliberate award-show frame, or has it drifted from the ink-on-cream system? The OverlapMap demonstrates the cream register works for celebratory content.
4. **Mid-session tier-crossing — does the brief want it surfaced in-thread, or is the post-game `MasteryMoment` the only intended manifestation?** Determines #10.
5. **Friend-name visibility in wrong-answer `{firstName} thought you might` sub-label** — what's the privacy posture if the friend hasn't actively shared this signal? Determines #8.
6. **The `/leaderboard` route name** — per CLAUDE.md it renders the (correctly non-ranking) Group Knowledge Map. The route name is a hostage to its past. Rename to `/group-map` or `/we`?
7. **Default-on `shareToFeed`** (`QuestionForm.tsx:111`): the form ships questions to all friends by default unless the player explicitly toggles "specific friends only." Generous-but-opaque default. Worth a deliberate review separate from the audit.
8. **Caveat handwriting usage scope.** Currently underused (Personal Record annotations only). The audit recommends adding it on the question bubble, breadcrumb, review header, catchup subhead, MasteryMoment "tier-buddy" variant, and share-card credits. That's a meaningful expansion of the handwriting register — confirm it's an intentional move.

---

# SEQUENCING & DEPENDENCIES

Top 10 ordered by dependency: ship blockers first, then cheapest-high-impact, then bigger lifts. Each item lists what unblocks it and what it unblocks.

**Tier A — unblocks half the audit (do first):**
1. **Resolve mastery tier vocabulary** (Top-10 #1; open question 1). One-day cross-cutting copy edit. Unblocks: #10 (mid-session crossing buddy variant), #25–27 (knowledge surfaces), #38 (Portrait beat), MasteryMoment itself.
2. **Resolve the brief's intent fork** (open question 2). Product call, not engineering. Determines whether to build #7 sub-labels, #8 breadcrumb rewrite, #16 standout moments, #17 near-miss, #21 emoji grid, #45 Group Story, #49 Challenge Worlds, #50 Friend Play.

**Tier B — cheap, high-impact Phase 1 (ship in any order):**
3. **In-session bubble: add italic-Playfair canonical subcategory + Caveat author line** (Top-10 #2 and #3, surface #4). One frontend file change, no backend. Validates the visual treatment that the rest of the proposals reuse.
4. **Author-led noon SMS** (Top-10 #6). Pure copy change in `buildDailyReminderMessage`; falls back gracefully when no first-name available.
5. **Daily-summary editorial header + explainer promotion + `<details open>` on wrong cards** (Top-10 #5). One file (`daily/summary/page.tsx`). Picks up the over-rich schema for free.
6. **Restore creator-note framing** (Top-10 #9, surface #36). One form file. Frontend-only.

**Tier C — depends on Tier A or backend touch:**
7. **End-of-session review card author header** (Top-10 #7, surface #11). **Phase 1.5** — needs `creator.displayName` joined into `QuestionRecap` (`daily-summary.ts:30-43`). One-join change. Visually requires Tier B #3 to be canonical first.
8. **Wrong-reveal rebuild** (Top-10 #4, surface #8). Frontend-only re-layout of `GameplayChat.tsx` `ResultRow`. Two of its three sub-proposals depend on Tier A #2 (the brief's intent: are the named sub-labels in scope?). Ship the breadcrumb promotion and `BreadcrumbLine` author re-format regardless.
9. **Ceremony Portrait beat domain line** (Top-10 #8, surface #38). Pure frontend in `ceremony/[ceremonyId]/page.tsx`. Visually safer once Tier A #1 is resolved.

**Tier D — bigger lifts (Phase 2):**
10. **Group Story section** (Top-10 #10, surface #45). New backend query + new section. Highest ceiling but ship last.

**Anti-pattern: do NOT ship before its prerequisite**
- `"{firstName} will see this."` micro-confirmation on heart votes (#15) — depends on building author-side feedback aggregation. Don't ship the toast first.
- `From {originalAuthorFirstName}, originally.` on bank-origin questions (#12) — Phase 1 in copy, but the recap query must follow `sourceQuestionId` to the origin author. Verify the join performs.
- Any added Caveat usage — first confirm the brand expansion is intentional (open question 8).

---

End of audit (third pass, 2026-05-18).
