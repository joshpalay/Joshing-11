# Joshing — Design Review & Coherence Audit (2026-05-29)

Reviewer pass after applying the Figma "Playground" designs (Login, Home, Game, Knowledge)
and rolling the brand language across the app. Compares the build against the four Figma
reference screens (file `n3ZfXlV2RYxJNJQsX2XwTw`, `==PLAYGROUND==` page) and assesses
cross-screen coherence. Evidence: fresh logged-in captures + the gameplay playtest run
`audits/playtest-2026-05-29T22-08-46-965Z/screenshots/`.

## Verdict
The app now reads in one voice on the **designed** screens: warm cream surfaces, navy ink,
Cormorant-serif headlines/questions, slate action links, the triangle motif. The biggest
remaining coherence gaps are (1) a few **off-palette holdouts** that look like a different
design system, and (2) **three overlapping serif registers**. Fixing those two would take the
app from "mostly consistent" to genuinely coherent.

---

## Part 1 — Per-screen fidelity vs Figma

### Login — ✅ strong match
Triangle background, warm cream cards, navy "JOSHING" wordmark + divider, phone/chat icons,
navy CONTINUE, orange CHANGE NUMBER, nav hidden. No material gaps.
- Minor: login card radius is `rounded-2xl` (16px) vs the design system's 4px content radius —
  intentional (login cards are deliberately softer); see Part 3 radius note.

### Home — ✅ matches, except the direct-sent card
Triangle banner + Today's Five card, "Learn More" row, activity rows (slate names, serif
subjects), feed cards (no avatar/timestamp, name+verb header, Cormorant 24px question, slate
"Answer →"). All on-brand.
- **P0 — SparkleEnvelope (direct-sent card) is off-brand.** `src/components/feed/SparkleEnvelope.tsx`
  + `DirectSentCard.tsx` (from `main`) use a **black header bar** and a **bright-blue
  `#1d4ed8` "Answer this"** button. On a cream/navy page it reads as a different product.
  Evidence: fresh Home capture. Same blue is in `FriendAddedCard.tsx:151`.
- **P1 — feed top-accent color.** `FeedCard.tsx` draws the 2px top bar from the hashed
  `CATEGORY_COLORS` palette (`visual.ts`), not the Figma **domain colors** (science `#8aa68a`,
  language `#7a9eaa`). Colors don't line up with the design's category coding.
- **P2 — triangle flourishes.** Figma's "recommended" card has a triangle-pattern frame; the
  "knows" variant has faint triangle watermarks. Not implemented (deferred).

### Game (Daily Five + Joshing Game) — ✅ matches
Serif question cards, **navy answer bubble**, **green/red left-border result cards**
("✓ Right on." / wrong with serif reveal), reaction pills. Confirmed in the playtest
(`*-q1-after-result.png`). Header "Today's five" + dots + X.
- **P1 — question chip shows difficulty tier** ("MASTERY") where Figma shows the **category**
  ("Literature"). `daily/page.tsx` `questionBadges()` passes the tier; Figma uses the domain.
- **P2 — result eyebrow copy.** Code keeps rotating product copy ("Right on.", "Nice pull.")
  vs Figma's literal "NAILED IT" / "NOT QUITE". Product decision — flag, don't assume.
- Minor: a "DAILY FIVE" eyebrow sits above the title; Figma shows only "Today's five".

### Knowledge — ✅ matches (top)
Serif "Knowledge" title, warm cream portrait card, sans "Joshing" + uppercase eyebrow,
Cormorant statement, territory bubbles with "Familiar" labels.
- **P1 — text bug: "Wagner'S Ring Cycle".** `displayMind()` in `knowledge/page.tsx`
  capitalizes the letter after an apostrophe. Pure casing bug.
- **P2 — bubble treatment.** Code uses colored rings; Figma uses solid muted fills. Close.
- The page **below** the portrait card was not in Figma; it's coherent but leans on the
  *legacy* warm tokens (see Part 2) and Playfair, not Cormorant.

---

## Part 2 — Cross-cutting coherence issues (the real wins)

### A. Three overlapping serif registers — **P1**
The app currently mixes:
- **Cormorant Garamond** (`--font-cormorant` / `font-serif`) — the intended brand serif.
- **Playfair Display italic** (`--font-display` / `--font-literata`) — editorial labels.
- **Hardcoded `Georgia, "Times New Roman", serif`** in inline styles — e.g.
  `FeedCard` author branch, `AnsweredByYouCard.tsx`, `KnowledgeCard` share path,
  `GameplayChat` breadcrumb/explanation lines.

Result: serif text doesn't look like one typeface across screens. **Recommendation:** make
Cormorant the single serif for headings/questions/answers; reserve Playfair italic for a
deliberately-different editorial label use (or retire it); delete the Georgia hardcodes.

### B. Legacy warm-ink/cream tokens vs brand tokens — **P1**
`--ink`, `--cream`, `--cream-warm`, `--border-warm`, `--text-muted-warm` (warm oklch values,
≈ `#1a1208` warm-black / `#fdfbf6`) are still used in `AnsweredByYouCard.tsx`,
`FriendAddedCard.tsx`, `knowledge/page.tsx`, and the replay/catch-up bodies. These render a
**warm near-black**, whereas `--brand-ink` is **navy `#0a1f3d`**. So some cards read warm-black
and adjacent ones read navy — a subtle two-tone that undercuts coherence. **Recommendation:**
point the legacy aliases at the brand tokens (or migrate usages) so ink is consistently navy.

### C. Off-brand bright blue `#1d4ed8` — **P0/P1**
`SparkleEnvelope` and `FriendAddedCard` "Answer this" buttons. Should be `--brand-navy`.
There is no other royal-blue in the palette; this is the single most off-key color.

### D. Inconsistent correct/wrong colors — **P1**
- Daily/Game result cards: green `var(--success)` (#178245) + red `#b42318`.
- Summary recap cards (`daily/summary`, `games/[id]/summary`): Tailwind `emerald`/`rose`/`stone`.
Two different greens/reds for the same semantic. **Recommendation:** standardize on
`--success` / `--destructive` everywhere.

### E. Card radius + cream tones — **P2**
Radii in play: login `rounded-2xl`, content `rounded-md`, some `rounded-lg`/`rounded-3xl`,
SparkleEnvelope `rounded-[1.5rem]`. Cream tones: `--brand-card` near-white `#fdfcfb`,
`--brand-cream-card` warm `#f6edd6`, legacy `--cream`. Both are *mostly* intentional (login
softer/warmer than content) but undocumented. **Recommendation:** define a small radius scale
+ document "warm cream = entry/branded surfaces, near-white = content cards."

---

## Part 3 — Coherence across non-designed screens
Largely good — friends, questions, archive, users, daily-setup, new-game, invite landings all
use serif titles + uppercase eyebrows + navy buttons and inherit the brand cleanly. Activities
("Lately") re-pointed to the brand palette. Intentionally-distinct dark surfaces
(`/ceremony`, `/share/ceremony`) left as-is by design.
- Minor: verify the stray nav logo on the invite landing (`accept-invitation--landing.png`).

---

## Prioritized action list

**P0 — fix first (jarring):**
1. Brand-align `SparkleEnvelope` + `DirectSentCard`: black header → navy or cream eyebrow;
   blue "Answer this" → `--brand-navy`. Also `FriendAddedCard` blue button → navy.

**P1 — coherence:**
2. Consolidate serif to Cormorant; remove Georgia hardcodes; scope Playfair to one editorial use.
3. Migrate legacy `--ink/--cream/--border-warm/--font-literata` holdouts to `--brand-*`
   (`AnsweredByYouCard`, `FriendAddedCard`, `knowledge/page.tsx`).
4. Feed top-accent + Game chip → Figma domain colors / show category instead of tier.
5. Fix `displayMind` "Wagner'S" casing bug.
6. Standardize correct/wrong to `--success` / `--destructive` (summary recap cards).

**P2 — polish:**
7. Feed triangle corner-accents / watermarks (Figma flourish).
8. Define radius scale + document the two cream tones.
9. Decide result-eyebrow copy (rotating vs Figma "NAILED IT"/"NOT QUITE").
10. Territory-bubble solid fills vs rings.

## Resolution log (2026-05-29, same day)
- **P0 #1 — done.** `SparkleEnvelope`/`FriendAddedCard`: navy frame, navy "Answer this", Cormorant question, slate inline link.
- **P1 #2 — done.** `--font-literata` repointed to Cormorant; hardcoded Georgia-primary serif swapped (PortraitCircles, AnsweredByYouCard, DirectSentCard).
- **P1 #3 — done.** Legacy `--ink/--cream/--border-warm/--text-muted-warm` aliases repointed to brand tokens (navy ink, near-white cream); DomainCircle warm-black/grey → brand ink.
- **P1 #4 — done.** `visual.ts` CATEGORY/AVATAR palette → brand muted triangle/domain colors; Daily game chip shows category (not tier).
- **P1 #5 — clarified, no code.** "Wagner'S" is **test-account data** (stored displayName), not a code bug; `titleCase` is correct and no CSS `capitalize` is applied to the statement/bubbles.
- **P1 #6 — done.** Summary recap cards use `--success`/`--destructive` + left accent (matches game).
- **P2 #8 — done.** Radius/cream/result conventions documented in `globals.css`.
- **P2 #10 — done.** Bubble fill already uses domain-color gradient; labels migrated to brand ink.
- **P2 #7 — decided, no code.** Base feed cards stay clean (matches Figma "knows" card, which has no triangles); the special *sharing* cards already carry a flourish via the SparkleEnvelope sparkles. Adding triangle watermarks to all cards would diverge from the Figma base card, so deliberately not applied.
- **P2 #9 — decided, no code.** Keep the rotating result copy ("Right on." / "Nice pull.") — good product writing — since the *visual* treatment (green/red + check/✕) already matches Figma's "NAILED IT/NOT QUITE" intent.

## How to verify
- Dev server on :3000 (logged in: phone `7342776819` / OTP `000000`).
- Re-run `npm run smoke:gameplay` for Game/result/summary states (writes `audits/playtest-*`).
- `npx tsc -p tsconfig.typecheck.json` + `npx eslint` + `npx vitest run src/components/feed/__tests__/FeedCards.test.tsx` after feed changes.
