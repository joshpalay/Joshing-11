# Screen References

Design mockups for the Joshing app. Use these as the source of truth when building or refining pages — match layout, copy, and color from the linked PNG.

## Naming convention

`<route>-<breakpoint>[-<variant>].png`

- `<route>` — matches the slug under `src/app/` (`home` for the root `/`)
- `<breakpoint>` — `mobile` | `tablet` | `desktop`
- `<variant>` — optional suffix for alternates (`-alt`, `-v2`, …)

Drop new PNGs in this folder and add a row to the table below.

## Index

| Screen | File | Route | Implementing files |
|---|---|---|---|
| Home (mobile) | [`home-mobile.png`](./home-mobile.png) | `/` | `src/app/page.tsx`, `src/components/TodaysFiveCard.tsx`, `src/components/FeedList.tsx`, `src/components/feed/*` |
| Home (mobile, alt) | [`home-mobile-alt.png`](./home-mobile-alt.png) | `/` | same as Home — see [Open questions](#open-questions) |
| Friends (mobile) | [`friends-mobile.png`](./friends-mobile.png) | `/friends` | `src/app/friends/page.tsx` |
| Knowledge map (mobile) | [`knowledge-mobile.png`](./knowledge-mobile.png) | `/knowledge` | `src/app/knowledge/page.tsx`, `src/app/knowledge/[domain]/page.tsx` |
| Knowledge map (desktop) | [`knowledge-desktop.png`](./knowledge-desktop.png) | `/knowledge` | same — wider breakpoint |

## Per-screen notes

### Home (mobile) — `home-mobile.png`

![Home mobile](./home-mobile.png)

- **Heading**: "Today's five is ready when you are."
- **Subhead**: "Play five questions, build your knowledge map, and keep the day moving."
- **Sections**:
  - Decorative triangle banner under the JOSHING wordmark
  - **Today's Five** card with pagination dots and a primary "Play now" CTA (full-width blue button)
  - **"7 questions you missed"** catch-up card (subdued, "Catch up · 0.25x points", right-aligned "Catch up →")
  - **"From your friends"** section header with "See all" link, followed by feed cards:
    - Sarah — answered wrong, Late Tchaikovsky (2h ago) — opera Polonaise question
    - Ethan — answered right, Weimar Cinema (3h ago) — "I want to believe" quote
    - Maya — answered wrong, 18th Century Counterpoint (4h ago)
    - James — answered right, Bowie-era Glam Rock (5h ago) — Ziggy Stardust
  - Each card has a colored left/top border matching its category, an avatar with initial, a "Hide this category" link, and an outlined "Answer this" button
  - **New question** card (highlighted/cream background): Clara · Detroit Techno (1h ago), filled primary "Answer this" button
- **Bottom nav**: 4 tabs — Home (active), Questions, Knowledge, Account

### Home (mobile, alt) — `home-mobile-alt.png`

![Home mobile alt](./home-mobile-alt.png)

Same content as `home-mobile.png`, with these differences:
- Feed cards have a right-side chevron (`→`) next to each "Answer this" button
- Slightly different proportions on the Play button and card spacing
- Triangle banner reads slightly larger / different aspect

Treat as an alternative layout — pick one before building.

### Friends (mobile) — `friends-mobile.png`

![Friends mobile](./friends-mobile.png)

- **Heading**: "Your friends."
- **Subhead**: "People who explore, question, and learn alongside you."
- **Controls row**: Search input ("Search friends") + "Find friends" button (outlined, with people icon)
- **Tabs**: OVERVIEW (active, underlined in orange) · ACTIVE NOW · SHARED INTERESTS · INVITATIONS
- **"People in your world"** list with "See all →":
  - Maya Williams — Exploring **Literature**, Film & Poetry · Active now · 12 shared domains · overlap: "We both answered about **T.S. Eliot** today."
  - Ethan Park — Exploring **Science** & History · Active 15m ago · 9 shared domains · "You're both exploring **Weimar Cinema**."
  - Clara Bennett — Exploring **Philosophy** · Active yesterday · 7 shared domains · "You both enjoyed a question about **Simone Weil**."
  - James O'Connor — Exploring **Sports** & Culture · Active 3d ago · 5 shared domains · "You diverge most in **Philosophy** and **Art**."
  - Each row has a circular avatar (with active-status dot), category-tinted text, and an overlapping-circles motif on the right showing shared-domain overlap
- **"Knowledge landscapes"** carousel: "Where your worlds overlap." — three cards (You & Maya, You & Ethan, You & Clara) each showing paired-avatar Venn-style circles and shared-domain count. Pagination dots below.
- **Bottom nav**: 5 tabs — Home, Questions, Knowledge, **Friends** (active), Account

### Knowledge map (mobile) — `knowledge-mobile.png`

![Knowledge mobile](./knowledge-mobile.png)

- **Kicker**: "Your knowledge map"
- **Heading**: "Explore what you know."
- **Subhead**: "Choose your interests. We'll tailor your questions to what matters to you."
- **Layout**: Stacked category sections, each with:
  - Colored category label (e.g. `LITERATURE` in coral)
  - Short italic tagline ("Stories, form, and the written word.")
  - Horizontal divider with a small triangle accent at the right end
  - A grid of circular topic bubbles (varying size/opacity to suggest depth of engagement)
- **Categories shown** (top to bottom): Literature, Philosophy, Science, Sports, Language, The Simpsons References, Video Games
- **Topics visible** include: T.S. Eliot Poetry (largest, with checkmark), Virginia Woolf Novels, James Joyce's Ulysses, Shakespeare's Richard III, Paradise Lost & Pop Culture Crossovers, Rawlsian Political Philosophy, Philosophy of Mind, Walter Benjamin's Philosophy, Martin Buber's Existential Philosophy, Chemical Element Symbols, Plant Taxonomy & Classification, Pharmacology & Medicinal Substances, Vitamin C Megadosing Controversy, Sailing & Nautical Terminology, Latin-Derived English Plurals, Simpsons Guest Appearances & Self-Reference, Simpsons Couch Gags & Meta-Humor
- **Sticky bottom CTA**: "Begin Today's Five →" (full-width blue button with question-mark icon)
- **Bottom nav**: not visible (CTA covers it)

### Knowledge map (desktop) — `knowledge-desktop.png`

![Knowledge desktop](./knowledge-desktop.png)

Same content and ordering as the mobile knowledge map, reflowed for a wider viewport:
- Topic bubbles per row increase (e.g. Philosophy shows 4 across instead of 3, Science 4 across instead of 3)
- Triangle decorations move to the upper-right corner
- No iOS status bar; "Begin Today's Five" CTA sits at the bottom of the visible area
- Bottom nav not shown in this crop

Use this to validate desktop breakpoint behavior of `src/app/knowledge/page.tsx`.

## Open questions

1. **Two Home mockups.** `home-mobile.png` and `home-mobile-alt.png` show subtle differences (right-side chevrons on feed cards, Play button proportions). Pick one as canonical or decide whether the chevron variant supersedes.
2. **Bottom-nav tab count differs.** Home + Knowledge mocks show **4 tabs** (Home, Questions, Knowledge, Account). The Friends mock shows **5 tabs** (Home, Questions, Knowledge, **Friends**, Account). Decide whether Friends is a permanent nav entry (newer design) or contextual, then update the stale mocks.
3. **"Hide this category" affordance.** Appears on every friend-feed card on Home. Confirm scope: per-card hide vs. category-level mute.
