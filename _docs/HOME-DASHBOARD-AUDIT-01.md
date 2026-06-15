# D-HOME-DASHBOARD-AUDIT-01 — Homepage Dashboard Reconciliation Audit

**Status:** Read-only audit. No code changed. This document establishes ground truth on how the homepage assembles today, measured against the dashboard target in the audit brief. The build slate (§7) is sequenced but not written.

**Audited at:** 2026-06-15, branch `claude/homepage-dashboard-audit-i7ebx3`.

---

## 0. Headline finding — there are two competing models, and the live one is *not* the target

The audit brief presumes a "7-day rolling band" dashboard model. **The live homepage implements a different, already-ratified model: `D-HOME-PACING-01` ("the Home page is an edition, not a log").** This is not drift to be patched — it is a deliberate, settled decision (`DECISIONS.md:58`, "Home is a budgeted edition… [built, cut-1]"). The two models disagree on first principles:

| Axis | Brief's target (this audit) | Live model (`D-HOME-PACING-01`, built) |
|---|---|---|
| Time horizon | One rolling **7-day** window over Zone 2 | Three surfaces, three horizons: **Home = today/now**, ceremony = 14d, profile = cumulative. Temporal buckets *deliberately deleted* from Home (§4). |
| Bounding instrument | The 7-day window bounds the page | A **fixed news-hole budget** (served caps) bounds the page; the window does not. Texture has a soft 48h preference that **backfills older items to fill the cap**. |
| "View more" | Bounded to the 7-day window | **Serve-and-overflow** to subpages that render the *full* pending queue / data window (all-time-ish). |
| Empty sections | Per-section "honest empty state" | **Two-state switch**: hide empty sections; show ONE empty state only when *all three* zones are empty (§9 explicitly rejects per-section empties). |
| Exhausted multi-Q cards | Hide when exhausted, show "1 of 4" remaining | **Spent cards stay** as hollow-triangle bundles, drift down by recency, roll off at 30d (`D-FEED-FRIEND-ACTIVITY-01 §Q4`). |

**Consequence for the build:** adopting the brief's target is not a bug-fix pass — it **revises `D-HOME-PACING-01` and partially reverses `D-FEED-FRIEND-ACTIVITY-01 §Q4`**. That is a product decision to ratify *before* any `B-HOME-*` prompt is written. The build slate in §7 is written on the assumption the target wins; the rows marked **⚠ ratify** are where it overrides a settled decision.

### Doc-reference corrections (the brief's "Read first" list is partly stale)
- **`PRD11.md` does not exist at the repo root.** It is archived at `_docs/archive/PRD11.md`. The canonical product direction is now the `PRD-D-*` series + `D-HOME-PACING-01.md`.
- The brief's section numbers are off against the archived PRD: empty-state copy lives in **§8.2.12** (not §8.2.8 — that's Reactions); the feed cap / "You're caught up" is **§8.2.6** (not §8.2.3 — that's Feed Item Sources); directed-pin is **§8.3.3** (correct).
- **`PRD-AUDIT.md`** is archived at `_docs/archive/PRD-AUDIT.md`. Its 90-day-cutoff observation is confirmed live — see RECENT ACTIVITY row.
- **`D-FEED-DIRECTED-CARD-RECONCILE-01` is CLOSED, not open** (resolved Option A, 2026-06-13 — `DECISIONS.md:61`). The brief lists it as an open A/B/C fork; it isn't. See §6.

---

## 1. Homepage assembly (as-built)

**Route:** `src/app/page.tsx`. Logged-in render order, top to bottom:

1. `TodaysFiveSection` → `TodaysFiveCard` (`src/components/TodaysFiveCard.tsx`) — the always-on hero. `page.tsx:43-44,69-101`.
2. `CeremonyPinSection` → `CeremonyPin` (`src/components/home/CeremonyPin.tsx`) — weekly-reflection marker. `page.tsx:50-54,104-116`.
3. `<section id="feed">` → `FromYourFriendsSection` → `buildHomeEdition(userId)` then `<FeedList unifiedHome budget={…}>`. `page.tsx:56-64,118-162`.

The hero and ceremony pin are **above** the feed; they are *not* feed items, so the directed-questions zone is still "pinned above all feed items" per §8.3.3.

**Selection layer:** `src/server/home/build-edition.ts` (server wrapper) → `src/server/home/select-edition.ts` (pure budget function). Caps live at `select-edition.ts:29-34`:
```
DIRECT_SERVE_CAP = 3
PLAYABLE_SERVE_CAP = 4
TEXTURE_SOFT_CAP  = 8   // rendered 3 rows → panel → up to 5 more
HOME_FEED_FETCH_LIMIT = 30   // build-edition.ts:31 (deep fetch so overflow counts are accurate)
```

**FeedList orchestration** (`src/components/FeedList.tsx`): merges the direct feed + activity items, splices the one panel, then renders three home zones in order — `forYouRows` (1943-1959), `fromFriendsRows` (1967-1993), `restRows`/texture (2002-2053).

---

## 2. Delta table — per section

Tags: `[matches]` · `[conflicts]` · `[absent]` · `[exists-reusable]`.

### Zone 1 — Directed-to-you ("For You" direct zone)

| # | Item | Target | As-built (file:line) | Tag |
|---|---|---|---|---|
| 1.1 | Component | Directed cards pinned top | `FeedList.tsx:1943-1959` `forYouRows`; cards `DirectSentCard`/`FriendAddedCard`/`AnsweredByYouCard` via `SparkleEnvelope`; page eyebrow "For you" `page.tsx:144-146` | — |
| 1.2 | Query | — | `getFeedPagePayload` → `getFeedForUser` (`src/server/db/queries/feed.ts`), `filter:'all'` | — |
| 1.3 | Windowing | Unwindowed, no time expiry | **No time cutoff** — all-time pending. States `['active','skipped']` only (`feed.ts:347`); answered → row flips `'answered'` → leaves feed. No `expiresAt` column. | **[matches]** |
| 1.4 | Persistence | Persist until played/dismissed | Exactly this: stays until answered (anywhere) or dismissed; no timer. | **[matches]** |
| 1.5 | Dismiss path | Dismiss is the only non-play removal | `FeedDismissButton` (`src/components/feed/FeedDismissButton.tsx`); handler `requestDismiss` persists `'dismissed'` (`FeedList.tsx:1379-1405`). `DirectSentCard` wires `onDismiss` for non-authors. | **[matches]** |
| 1.6 | Absent when empty | Section absent, no empty state | `forYouRows.length > 0 ?` guard (`FeedList.tsx:1943`) — renders nothing when none. | **[matches]** |
| 1.7 | Pin above band | Pinned above windowed band | First zone inside the feed, above From Friends/texture. (Hero + ceremony sit above the feed but are not feed items.) | **[matches]** |
| 1.8 | Cap | **5** served | **Cap 3** (`DIRECT_SERVE_CAP`). | **[conflicts]** cap 3 vs 5 |
| 1.9 | "View more" target | Bounded — but Zone 1 is unwindowed anyway | "N more from friends →" → `/for-you` (`FeedList.tsx:1951-1957`) → `buildPendingDirectQueue` fetches up to 50, **all-time pending** (`build-edition.ts:87-97`). | **[matches]** — all-time overflow is *correct* for an unwindowed gift zone |

### Zone 2 — "Past 7 days" band (the band itself)

| # | Item | Target | As-built | Tag |
|---|---|---|---|---|
| 2.1 | Band wrapper | A single labeled band around From Friends + Recent Activity + Shared Ground | **No band exists.** Three independent zones with their own headings; `D-HOME-PACING-01 §4` *deleted* temporal buckets. | **[absent]** |
| 2.2 | Band label | "Past 7 days" stated once | **No band label.** Per-section headings only: "questions your friends created or sent directly to you" (1945), "From Friends" (≈1969), "Recent activity" (`FeedList.tsx:2015`). | **[absent]** |
| 2.3 | Rolling 7-day window | Now − 7 days over the whole band | **No 7-day window anywhere.** Live windows are 30/35/60/90-day + a 48h texture preference. None is 7d. | **[conflicts]** |

### FROM FRIENDS (playable milestone bundles)

| # | Item | Target | As-built (file:line) | Tag |
|---|---|---|---|---|
| 3.1 | Component | — | `fromFriendsRows` → `ActivityStreamItem` (milestone kind) `FeedList.tsx:1967-1993,1662-1673` | — |
| 3.2 | Query | — | `buildActivityStream` (`src/server/activity/build-stream.ts`) → `getFriendActivity` (`src/server/db/queries/lately.ts`) + `getLatelyMilestones` | — |
| 3.3 | Windowing | 7 days | **35-day** scan (`FRIEND_ACTIVITY_WINDOW_DAYS=35`, `lately.ts:253`); milestones 30d (`MILESTONE_WINDOW_DAYS=30`, `lately.ts:153`); completed bundles roll off at **30d** (`DECISIONS.md:59`). | **[conflicts]** 35/30d vs 7d |
| 3.4 | Cap | **5** | **Cap 4** (`PLAYABLE_SERVE_CAP`). | **[conflicts]** cap 4 vs 5 |
| 3.5 | "View more" target | Bounded to 7-day window | "N more →" → `/from-friends` (`FeedList.tsx:1971-1978`) → `buildFriendActivityQueue` renders **all bundles in the 35-day window, no cap** (`build-edition.ts:106-109`). | **[conflicts]** 35-day portal, not 7d |
| 3.6 | Backfill | No backfill-from-history | Serve is just top-4 of available (no quota backfill), **but the 35-day data scan itself reaches deep into history**; answered bundles are retained. | **[conflicts]** window is the backfill |
| 3.7 | Exhausted handling | Hide when all played; show "1 of 4 remaining" | **Opposite:** answered bundles **stay** as spent (hollow-triangle) cards, drift down by recency, never show a remaining count (`build-stream.ts:85-87`; `D-FEED-FRIEND-ACTIVITY-01 §Q4`). Per-bundle question cap 5 (`MILESTONE_CARD_QUESTION_CAP`, `src/lib/lately-milestones.ts:39`). | **[conflicts]** ⚠ reverses §Q4 |

### RECENT ACTIVITY (texture)

| # | Item | Target | As-built (file:line) | Tag |
|---|---|---|---|---|
| 4.1 | Component | — | `restRows`/texture → `ActivityStreamItem` (non-milestone), `PersonActivityCard` (imported but **inert** on budgeted home — `DECISIONS.md:58` drift note). `FeedList.tsx:2002-2053` | — |
| 4.2 | Query | — | `buildActivityStream` → `getActivitiesForUser` (`src/server/db/queries/activity.ts`) + `getLatelyMoments` + non-milestone `getFriendActivity` | — |
| 4.3 | Windowing | 7 days | `boundTexture` (`select-edition.ts:177-187`) prefers a **48h** window, then **backfills older items to fill cap 8**. Upstream pools: activity items **90-day** cutoff (`activity.ts:131-135`, `.limit(100)`), moments **30-day** (`lately.ts:92-126`). | **[conflicts]** 48h+backfill / 30-90d vs 7d |
| 4.4 | Cap | **6** | **Soft cap 8** (`TEXTURE_SOFT_CAP`), rendered 3 rows → panel → up to 5 more. | **[conflicts]** cap 8 vs 6 |
| 4.5 | "See all activity →" target | Bounded to 7-day window | → `/activities` (`FeedList.tsx:2031-2037`) → full `buildActivityStream` (**90-day**, up to 100 items). | **[conflicts]** 90-day portal |
| 4.6 | Backfill | Recent-or-nothing | **Confirmed backfill:** `boundTexture` — when the 48h window underfills cap 8, it appends older items newest-first (`select-edition.ts:185-186`). This is the literal "reach into history to hit a quota". | **[conflicts]** root cause (see §4) |

### SHARED GROUND / convergence / "same wavelength"

| # | Item | Target | As-built (file:line) | Tag |
|---|---|---|---|---|
| 5.1 | Placement | Inside the windowed band | **Not a band section** — it is one option in the single rotating **panel** (`CommonGroundFeature`, `src/components/feed/EditorialPromos.tsx`). | **[conflicts]** structural — promo, not band member |
| 5.2 | Query | — | `getCommonGroundPromo` (`src/server/activity/common-ground-promo.ts`) → `getFriends` + `getCommonGround`; convergence data `getLatelyConvergences` (`lately.ts`) | — |
| 5.3 | Windowing | 7 days | Convergence scan **60-day** (`CONVERGENCE_LOOKBACK_DAYS=60`, `lately.ts:541`). | **[conflicts]** 60d vs 7d |

### Editorial interstitial / the rotating panel

| # | Item | Target | As-built (file:line) | Tag |
|---|---|---|---|---|
| 6.1 | Components | Preserve, don't re-spec | `CommonGroundFeature` / `RecentlyExpandingFeature` / `GrowYourCircleFeature` (`EditorialPromos.tsx`) | **[exists-reusable]** |
| 6.2 | Queries | — | `getCommonGroundPromo`, `getRecentlyExpandingPromo`, `getAddFriendsPromo` (each null when data-absent) | — |
| 6.3 | Cadence / placement rule | Preserve | **Exactly one panel per load** (`selectPanel`, `select-edition.ts:196-207`): quiet page → Grow Your Circle; else Shared Ground > Expanding > Grow Your Circle. Placed **after the 3rd texture row**, falls to feed foot when texture empty (`FeedList.tsx:2019-2024,2053`). Suppressed entirely on the all-empty page (`select-edition.ts:309`). | **[exists-reusable]** |
| 6.4 | Interaction w/ window+cap changes | Flag risk | Placement assumes ~8 texture items (3 + panel + 5). Cutting texture cap to 6 and adding a hard 7-day window makes the "3 then panel then 5" rhythm degrade; the foot-fallback already handles empty texture, so it won't break, but the mid-zone interlude largely disappears on quiet weeks. **Flagged**, not a blocker. | **[conflicts]** soft — re-tune placement against cap 6 |

### Quiet-week / empty state

| # | Item | Target | As-built (file:line) | Tag |
|---|---|---|---|---|
| 7.1 | Promo exists? | Quiet-week + invite | **Yes.** `isAllEmpty` branch in `FeedList.tsx:1877-1903`: `SpeechBubbleIllustration` + serif headline (`emptyCopy`, 1143-1165) + **"add friends →" → `/friends`** (`showInviteFriendCta`, 1169-1173). Copy is the revived §8.2.12 set ("Quiet today…", "When your friends play…", "You've answered every question your friends sent."). Rendered **inline** between hero and composer (not full-screen). | **[exists-reusable]** |
| 7.2 | Invite link | §8.2.12 invite present | Present → `/friends`, "add friends →". | **[matches]** |
| 7.3 | Trigger | Per-section "empty this week" | **Two-state switch, not per-section:** fires only when **all three** content zones are empty (`select-edition.ts:303-304`). Partial-empty sections are *hidden*, never given a per-section "quiet" placeholder (§9, by design). | **[conflicts]** ⚠ target wants per-section honest empties; §9 forbids them |

### Cold-start exception (friend count ≤ 1)

| # | Item | Target | As-built | Tag |
|---|---|---|---|---|
| 8.1 | State trigger | friendCount ≤ 1 relaxes Zone 2 window | `has_friends = friendCount > 0` exists (`src/server/feed/get-feed-page.ts:189-209`) **but only drives empty-state copy** — no window relaxation keyed on friend count. | **[absent]** |
| 8.2 | Window relax in cold-start | Pull inviter content regardless of age | No friend-count-gated window logic anywhere. | **[absent]** |
| 8.3 | Label suppression (Option A) | Suppress "Past 7 days" label when active | Moot — there is no band label to suppress (2.2). | **[absent]** |

---

## 3. Inventory of every live time window (reference)

| Source | Function (file:line) | Window | Row cap |
|---|---|---|---|
| Direct feed (For You) | `getFeedForUser` (`feed.ts`) | **none** (all-time pending) | 50 (`MAX_FEED_LIMIT`) |
| Activity items (texture/Lately) | `getActivitiesForUser` (`activity.ts:131-135`) | **90 days** | 100 |
| Lately moments | `getLatelyMoments` (`lately.ts:92-126`) | **30 days** | 200 |
| Lately milestones | `getLatelyMilestones` (`lately.ts:153`) | **30 days** | 500 |
| From Friends activity | `getFriendActivity` (`lately.ts:253`) | **35 days** | 500 |
| Convergences | `getLatelyConvergences` (`lately.ts:541`) | **60 days** | derived |
| Texture render bound | `boundTexture` (`select-edition.ts:177-187`) | 48h preferred, **backfills older** | cap 8 |

**Nothing in the homepage path uses a 7-day window.** The target's core primitive does not exist anywhere.

---

## 4. Root-cause confirmation — staleness is a *combination* of all three

Grounded in the queries above, not inferred:

- **(a) Absent windowing — primary.** No 7-day bound exists; the bounds that do exist are 30/35/60/90 days. A homepage built to surface "now" instead surfaces up to a quarter of history. **Confirmed.**
- **(b) Unbounded "N more" / "See all" links — confirmed.** "N more →" → `/from-friends` renders the full 35-day bundle list (`build-edition.ts:106-109`); "See all activity →" → `/activities` renders the 90-day stream; the direct "N more from friends →" → `/for-you` renders all-time pending (50). The screenshot's "32 more →" and "See all activity →" both open these deep, non-7-day portals. **Confirmed.** *(Note: the all-time direct portal is correct for an unwindowed gift zone; only the From Friends / activity portals are the staleness defect.)*
- **(c) Backfill-from-history — confirmed, and isolated to texture.** `boundTexture` explicitly appends older items past the 48h floor to fill cap 8 (`select-edition.ts:185-186`). This is the only true quota-backfill in the codebase; the From Friends / convergence zones don't quota-backfill, but their *data windows* (30/35/60d) achieve the same staleness by a different mechanism.

**Verdict: all three are present.** (a) is the dominant cause — installing a real 7-day window largely subsumes (b) and (c). A fourth, zone-specific contributor: From Friends **retains answered bundles as spent cards for 30 days** (`D-FEED-FRIEND-ACTIVITY-01 §Q4`), so even already-played content lingers.

---

## 5. Directed-card reconcile note

**This audit's directed-card target (pin top, persist until played/dismissed, absent when empty) does NOT collide with, and does NOT reopen, `D-FEED-DIRECTED-CARD-RECONCILE-01`.** They are on orthogonal axes:

- **The RECONCILE fork was about card *chrome*** — amber `HILITE` left edge-bar + Courier "SENT TO YOU" eyebrow (provisional) vs. a plain bordered tile with a gold-sans eyebrow. **It is CLOSED — Option A, resolved 2026-06-13** (`DECISIONS.md:61`): `DirectSentCard` uses `variant="bordered"`, eyebrow **"Sent directly to you"** in `--accent-gold` semibold (`DirectSentCard.tsx:42-58`), **no edge-bar** (`SparkleEnvelope` never threads `accentColor`, so `FeedCardShell.accentBar` stays null). The Friend-Play edge-bar sub-question and the `creatorNote`/aside idea are **struck/moot** per the same entry.
- **This audit's target is about *placement and lifecycle*** (where the zone sits, when it disappears). Live behavior already **matches** it (rows 1.3–1.7). The target says nothing about chrome and so leaves the closed fork untouched.

**Statement:** the target **closes nothing new and collides with nothing** — the fork is already resolved, and the placement/persistence target is already satisfied. The brief's framing of it as an open A/B/C decision is stale.

---

## 6. Build slate — `B-HOME-*` (quick-wins first; each independently shippable)

> **⚠ Ratify first (§0):** items 4, 6, and the exhaustion behavior in item 5 override settled decisions (`D-HOME-PACING-01 §4/§9`, `D-FEED-FRIEND-ACTIVITY-01 §Q4`). Confirm the 7-day-band model supersedes the edition model before writing these prompts. Items 1–3 are safe regardless of that ratification.

| Seq | Prompt | Scope | Change type | Independently shippable? |
|---|---|---|---|---|
| 1 | **B-HOME-CAPS-01** — set caps to target: `DIRECT_SERVE_CAP 3→5`, `PLAYABLE_SERVE_CAP 4→5`, `TEXTURE_SOFT_CAP 8→6`. Re-tune panel placement against 6 texture rows (row 6.4). Update `FeedListBudget.test.tsx` expectations. | `select-edition.ts:29-34`, `FeedList.tsx` panel splice | **config + minor component** | Yes — pure cap bump, page stays working |
| 2 | **B-HOME-WINDOW-02** — introduce a single rolling **7-day** window over Zone 2. Parameterize `getFriendActivity` / `getActivitiesForUser` (texture path) / `getLatelyMoments` / `getLatelyConvergences` to a 7-day home window; change `boundTexture` floor to 7d **and delete the older-item backfill branch** (recent-or-nothing). Leave Zone 1 (direct) unwindowed. | `lately.ts`, `activity.ts`, `select-edition.ts:177-187` | **query-only (+1 pure fn)** | Yes — narrows existing windows; safe on a working page |
| 3 | **B-HOME-OVERFLOW-WINDOW-03** — bound the "view more" subpages to the same 7-day window: `/from-friends` (`buildFriendActivityQueue`) and `/activities`. Leave `/for-you` all-time (Zone 1 is a gift zone, row 1.9). | `build-edition.ts:106-109`, `/activities` route | **query-only** | Yes |
| 4 | **B-HOME-BAND-LABEL-04** ⚠ — add the single band-level **"Past 7 days"** label above the windowed zones; drop the per-section headings (or demote to sub-labels). *Overrides `D-HOME-PACING-01 §4`.* | `FeedList.tsx` zone headings, `page.tsx` eyebrow | **component** | Yes |
| 5 | **B-HOME-EXHAUST-05** ⚠ — From Friends: **hide a milestone bundle when fully exhausted**, and show a remaining count ("1 of 4 questions") while answerable. *Reverses `D-FEED-FRIEND-ACTIVITY-01 §Q4`'s "spent cards stay".* | `build-stream.ts`/`orderFriendActivity`, `ActivityStreamItem.tsx` | **query + component** | Yes (gated on ratification) |
| 6 | **B-HOME-COLDSTART-06** ⚠ — friend-count ≤ 1 cold-start exception: thread `friendCount` into `buildHomeEdition`; when ≤ 1, relax Zone 2 to pull inviter content regardless of age and **suppress the band label** (Option A). State-triggered, auto-off at friend #2. | `build-edition.ts`, `select-edition.ts`, `FeedList.tsx` label | **query + component** | Yes — additive branch on top of items 2 & 4 |

**Sequencing rationale:** 1 is a one-line-per-constant quick win. 2–3 install the window (the root-cause fix) query-side, leaving the page working at each step. 4 makes the new boundedness visible. 5–6 are the behavior-revising items gated on the §0 ratification.

---

## 7. Done-when checklist (self-audit)

- [x] Every live homepage section has a row with real component, real query, real window value, real cap (§2).
- [x] Staleness root cause named and tied to specific queries (§4) — all three contributors present; (a) dominant.
- [x] Directed-card reconcile interaction stated explicitly (§5) — closes nothing, collides with nothing; fork already resolved.
- [x] Sequenced `B-HOME-*` slate, each independently shippable, config/query vs component tagged (§6).
- [x] Surfaced that the live model (`D-HOME-PACING-01`) and the brief's target are competing models; flagged the ratification the build depends on (§0).
