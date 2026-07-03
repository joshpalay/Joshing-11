# D-KNOWLEDGE-MAP-USABILITY-01 — Traversal, Adding, and the Gap-Filling Moment

**Status:** OPEN — exploration + recommendation. Does **not** authorize a build; proposes a `B-KNOWLEDGE-MAP-USABILITY-*` slate for ratification.
**Author:** Claude (with Josh)
**Relates to / builds on:** `D-KNOWLEDGE-TAXONOMY-MODEL-01` (SETTLED — the graph model and §8 map direction this screen implements), `B-KNOWLEDGE-TAXONOMY-01 P5` (the as-built bubble map), `D-NEARNESS-LADDER-HYBRID-01` (expansion offers), `CATEGORY-HIERARCHY-FINDINGS-01`.
**Trigger:** live use of the bubble map on `joshing-11.vercel.app` (2026-07-03 screenshot): the root view is hard to read and traverse; adding a category is unclear and unconfirmed; there is no "fill out this category" moment.

---

## 1. The bar this doc is aimed at

Josh's acceptance narrative, verbatim in spirit:

> Somebody should look at this and say "oh my gosh, I am super good at classical composers — with the exception of Bruckner" — and the map should help them fill out that category.

That sentence contains three product requirements the current screen doesn't meet:

1. **Legibility of strength** — you can *see* at a glance that Classical Composers is a strong area (today: label soup at root; several large bubbles render gray).
2. **Legibility of the gap** — you can see *what's missing inside it* (today: ghosts exist but are unlabeled below a size threshold, and there is no "N of M covered / X pts to Mastery" framing on focus).
3. **A clear, confirmed act of filling it** — one obvious, deliberate, confirmed step from "Bruckner is missing" to "Bruckner questions are coming" (today: tapping the dashed circle *instantly* mutates your Daily Five preferences with no confirmation).

Everything below is organized against those three.

---

## 2. As-built inventory (verified against live code, 2026-07-03)

The screen is the flag-ON path of `/knowledge` (`KNOWLEDGE_MAP_PAGE`; `src/server/knowledge/map-page-flag.ts` defaults it off, so preview/prod env must set it — the screenshot confirms it is ON in production). The pieces:

| Piece | Where | Behavior |
|---|---|---|
| Circle pack | `src/components/knowledge/KnowledgeBubbleMap.tsx` (408 lines) | d3 `pack()`, focus-based zoom (`zoomTo`, :121-133), visible window = focus subtree to depth+2 (:99-107) |
| Tree assembly | `src/server/knowledge/knowledge-tree.ts` | owned leaves joined into the authored graph; ghosts = unheld roster siblings (footprint 40); grow rim capped at 3 |
| Points / mastery math | `src/server/knowledge/graph.ts` | `rollUpCredit` (full-value roll-up), `parentProgress` (threshold + ≥2 corners), `litCorners`, `rosterCoverage` |
| Ghost adopt | `KnowledgeBubbleMap.tsx:148-164` → POST `/api/daily/preferences/domain-frequency` (frequency `sometimes`) | **optimistic, instant, unconfirmed**; notice is an 11px italic footer line (:403-405) |
| Per-domain detail | `src/app/knowledge/[domain]/page.tsx` (321 lines) | tier, points, event history, visibility toggle, and **"Answer questions in {domain}"** → `/daily/setup?domainMode=custom&domain=…` (:224) |
| "+" FAB | `src/components/Nav.tsx:225-244` → `CreateChooser` | creates a **question**, not a category — on every tab including Knowledge |
| Add-interest flow | `KnowledgeFlatClient.tsx:392-438` (`proposeCustomInterest`) + `/api/knowledge/converge` (LLM-free dedup) | exists **only on the flag-OFF flat page** |
| List view | `KnowledgeBubbleMap.tsx:360-384` | flat, non-tappable rows, points-sorted; no hierarchy |

### 2.1 Why the root view reads as soup (the screenshot, explained by code)

1. **Two label layers at once, no collision handling.** `visible` includes depth ≤ focus+2, and *every* visible node with `r*k > 18` gets a `<text>` (:320-321). Parent labels sit at the circle's top edge (`d.y - d.r + 14/k`, :331) — exactly where they collide with neighboring circles and their labels. The screenshot shows "Star Trek Franchise" struck through "20th Century American History", "Broadway Musical Theater" through "20th Century British Modernist Literature", etc. There is no text halo, so serif strokes cross bubble edges.
2. **Gray means "hue unmapped," but reads as "disabled."** `hueForBroadCategory` (knowledge-tree.ts:67-88) returns null for any broad category outside its 12 known keys → `--brand-ink-400` gray. Several of the largest bubbles in the screenshot are gray. Canon says color never carries meaning alone — but here *absence* of color accidentally carries a (false) meaning.
3. **Three node kinds, one gesture, three different outcomes.** Parent tap = dive; leaf tap = silently recenter its container; ghost tap = **mutate preferences**. Nothing on the bubble says which kind it is (fill opacity 0.13 vs 0.8 vs dashed is not a legible affordance at 40px), and the only teaching is the footer hint.
4. **"Out" is undiscoverable.** Background-tap pops one level (:253) — invisible affordance, also easy to hit *accidentally* while aiming at a bubble. The breadcrumb (:188-209) is 12px. There is no explicit up control.
5. **The best screen in the feature is orphaned.** `/knowledge/[domain]` — the one place with history, tier, and the targeted-questions link — has **no inbound link from the map**. Leaf taps recenter instead of navigating; nothing surfaces "view details."

### 2.2 Why "add" fails the user's bar

- The add affordance is a dashed circle whose *only* label may be suppressed (below `r*k > 18` it renders as an anonymous dashed ring — several are visible in the screenshot).
- The action is instant and optimistic. A mis-tap while navigating silently changes Daily Five supply. The user's ask — "I want a confirmation with the add" — is precisely the missing piece: **an act that changes what questions you'll be served must be deliberate and acknowledged.**
- There is no way to add something *not on screen*. Ghosts only surface authored roster siblings of parents you've entered plus a grow rim of ≤3 roots. If Bruckner isn't authored, or you haven't entered Classical Composers, there is no path — the real add-interest flow lives on the flat page the flag replaced.
- The "+" FAB on this screen creates a *question*. On a map screen, "+" reads as "add to the map" — a mismatch.

### 2.3 Why the Bruckner moment can't happen yet

Focusing Classical Composers today shows: the parent circle, owned-composer bubbles, dashed ghosts (unlabeled if small), and the hint line. It does **not** show:
- coverage ("6 of 9 composers"), though `litCorners`/roster data exists server-side;
- progress ("1,240 / 2,000 pts · 2 corners lit"), though `parentProgress` computes exactly this;
- any CTA to *act* on the gap — no "quiz me here," even though the deep link (`/daily/setup?domainMode=custom&domain=…`) already exists and is used by the orphaned detail page.

The data model is fully sufficient; this is entirely a presentation/affordance gap.

---

## 3. Proposal — three jobs: **see it, move through it, grow it**

### A. See it (readability) — no data changes

- **A1 · One label layer.** Label only the focus's direct children (depth+1); depth+2 renders as unlabeled texture inside its parent. Diving in is what reveals the next layer's names — this also *teaches* traversal. Add an SVG text halo (`paint-order: stroke` with the cream background color) so remaining labels survive crossing bubble edges. Parent-name-at-top-edge only when the parent is the focus.
- **A2 · Kill accidental gray.** Audit live `broad_category` values against `hueForBroadCategory`'s known set; extend the mapping (or add a deterministic fallback hue) so unmapped ≠ gray. Gray should be reserved deliberately or not used.
- **A3 · Make ghosts read as "add" buttons.** Prefix ghost labels with "+" ("+ Bruckner"), and inside the focused parent, *always* label direct-child ghosts (drop the `r*k > 18` threshold for them — the gap is the content).

### B. Move through it (traversal)

- **B1 · Tap = select, act from a card (the load-bearing change).** First tap on any bubble selects it and raises a bottom action card (reuse the `CreateChooser` sheet pattern): name, hue chip, points/tier, and *explicit* actions —
  - parent: **Dive in** · progress line ("6 of 9 · 1,240/2,000 pts") · **Fill this out** (→ C3)
  - leaf: **View details** (→ `/knowledge/[domain]` — finally linking the orphaned page) · **Quiz me here** (→ `/daily/setup?domainMode=custom&domain=…`) · **Dive in** when the node has children
  - ghost: **Add to my map** (→ C1 confirm) · what adding means, in a sentence
  Tapping the selected bubble again (or "Dive in") recenters as today. Every tap becomes reversible and self-describing; no gesture silently mutates anything. This one change fixes the mis-tap adopt, the orphaned detail page, and the "what does tapping do?" illegibility at once.
- **B2 · Explicit "up" control.** A persistent ↑ chevron beside the breadcrumb (background-tap stays as a bonus, not the only path). Bump breadcrumb tap targets to ≥44px.
- **B3 · Hierarchical list view.** Group list rows by home parent with indentation; make rows tappable → detail page. This becomes the fully accessible traversal path (screen readers get a real tree, not a points-sorted flat list).

### C. Grow it (adding + the Bruckner moment)

- **C1 · Confirmed add.** Ghost "Add to my map" opens a confirm step in the action card: *"Add Bruckner? Questions will start appearing in your Daily Five."* **[Add it] [Not now]**. On success, the card flips to a confirmation state with **[Quiz me now]** (deep link above) and **[Done]** — the add is now both deliberate and *acknowledged*, and the path from "added" to "answering Bruckner questions" is one tap. Keep the optimistic bubble-flip after confirm; on failure revert as today.
- **C2 · "Add an area" on the map screen.** Add a proper entry point (either the FAB context-switches on `/knowledge` to include "Add a knowledge area", or a `+ ADD` button joins TIDY/SHARE in `BubblePageChrome`). Flow: type a name → `/api/knowledge/converge` dedup (exists, LLM-free) → pick the match or "create new" → same C1 confirm. Extract `proposeCustomInterest` from `KnowledgeFlatClient` into a shared module so both pages use one flow. Per canon §4, a name the graph doesn't know still becomes a player leaf immediately (owned leaves without authored nodes already render under root — knowledge-tree.ts:217-227); the *taxonomy edge* goes to the human suggestion queue.
- **C3 · The gap view ("fill out this category").** When focus is a substantive parent, render a focus header from data the server already computes: **"Classical Composers — 6 of 9 · 1,240 / 2,000 pts · 2 corners lit"**, plus a **Fill this out** CTA that lists the unheld roster children (Bruckner, …) with per-item add (C1 confirm applies; multi-add respects the Daily-Five cap — see §5). Requires extending the tree payload: `KnowledgeTreeNode.progress?: { points, threshold, corners, rosterCovered, rosterSize }` populated in `buildKnowledgeTree` from `parentProgress`/`litCorners` — all pure functions already imported there.
- **C4 · The social half of the moment.** The friend variant (`variant='friend'`) gets the same read-only gap framing — a friend looking at Josh's map *sees* "strong across Classical Composers, Bruckner unlit." That's the "somebody should look at this and say oh my gosh" half; pairs with the existing `AskFriendForDomain` affordance later, out of scope here.

### The Bruckner walkthrough (acceptance narrative)

1. Root view: one legible label layer; Classical Composers is a large, correctly-hued cluster (A1/A2).
2. Tap it → action card: "Classical Composers · 6 of 9 · 1,240/2,000 pts" → **Dive in** (B1/C3).
3. Inside: owned composers labeled; one dashed **"+ Bruckner"** clearly reads as the gap (A3).
4. Tap it → card: "Add Bruckner? Questions will start appearing in your Daily Five." → **Add it** (C1).
5. Confirmation state → **Quiz me now** → `/daily/setup?domainMode=custom&domain=Bruckner` (C1).
6. Answering feeds `writeMasteryEvent` → the bubble grows; the parent header ticks to 7 of 9 — visible progress toward the corner gate and threshold that already govern parent mastery.

Every arrow in that walkthrough is either pure presentation or an existing endpoint. **No schema change, no new mastery math.**

---

## 4. Proposed build slate — `B-KNOWLEDGE-MAP-USABILITY-01`

| P | Scope | Files | Risk |
|---|---|---|---|
| P1 | Label declutter + halo + ghost "+" labels (A1, A3) | `KnowledgeBubbleMap.tsx` only | Low — render-only |
| P2 | Hue audit + fallback (A2) | `knowledge-tree.ts` (`hueForBroadCategory`), token check vs `_docs/STYLE-GUIDE-COLOR.md` | Low |
| P3 | Selection action card; link detail page; explicit up control (B1, B2) | new `KnowledgeNodeCard.tsx`, `KnowledgeBubbleMap.tsx` | Medium — interaction rewrite |
| P4 | Confirmed ghost add + post-add "Quiz me now" (C1) | card component + existing adopt endpoint | Low once P3 lands |
| P5 | Parent progress in payload + gap view + Fill-this-out (C3) | `knowledge-tree.ts`, card/header | Medium |
| P6 | Add-an-area on the map screen (C2) | `BubblePageChrome.tsx` / `Nav.tsx`, extract from `KnowledgeFlatClient.tsx`, `/api/knowledge/converge` | Medium |
| P7 | Hierarchical, tappable list view (B3) + a11y pass | `KnowledgeBubbleMap.tsx` list branch | Low |

Ordering: P1/P2 are shippable immediately and fix the screenshot's worst reading problems; P3 is the keystone the C-track hangs off; P4 delivers the explicitly-requested confirmation and should ship in the same cut as P3 (P3 without P4 still leaves an unconfirmed mutation behind a nicer button).

---

## 5. Open questions for ratification

1. **Confirm-sheet vs. undo-snackbar for ghost add.** Recommendation: **confirm** (C1) — Josh asked for confirmation explicitly, the action re-routes future supply, and canon prefers deliberate acts over silent mutation. Undo-only is the weaker fit here.
2. **First-tap-select vs. long-press-for-card.** Recommendation: first-tap-select (B1). Long-press is undiscoverable on mobile and invisible on desktop; select-then-act is one extra tap that buys legibility everywhere.
3. **"Fill this out" multi-add vs. one-at-a-time.** The Daily Five add affordance is canonically capped at 5 (`D-KNOWLEDGE-TAXONOMY-MODEL-01` §8: "add until full, then swap/rest"). Recommendation: per-item add with the cap surfaced in the card ("Daily Five is full — swap something out?") rather than bulk-adopt; verify how `/api/daily/preferences/domain-frequency` enforces the cap before building.
4. **Does the grow rim survive?** With C2 (search-add) in place, the rim's ≤3 ghost roots may earn their keep as invitations or may just be root-level clutter. Decide after P3 ships and taps are legible.
5. **Flag posture.** `KNOWLEDGE_MAP_PAGE` is set in production but absent from `.env.example`; the flat page still owns the only add-interest flow. Once P6 lands, decide whether the flat page retires (canon §8 says "the flat list is retired") or remains the flag-off fallback — and add the flag to `.env.example` either way.
