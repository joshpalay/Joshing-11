# D-HOME-DASHBOARD-MODEL-01 — Home becomes a bounded 7-day dashboard

**Type:** Decision / ratification entry. Supersedes a prior settled decision. No code in this document — it authorizes the `B-HOME-*` build slate that follows.

**Status:** Settled, 2026-06-15.

**Supersedes:** `D-HOME-PACING-01` ("Home is a budgeted edition, not a log") — the edition model is retired for Home.
**Overrides:** `D-FEED-FRIEND-ACTIVITY-01 §Q4` ("spent cards stay") — partially reversed (see §3 below).
**Grounded in:** `D-HOME-DASHBOARD-AUDIT-01` (the as-built audit this reverses).

---

## Why this reverses a settled decision (read before building)

`D-HOME-PACING-01` made Home a *budgeted edition*: a fixed news-hole bounded by served caps, temporal buckets deliberately deleted, older content backfilled to fill the budget, spent cards retained for 30 days, and a single empty state only when the whole page is empty. That model is internally coherent — but in practice it surfaces up to a quarter of history on a surface meant to answer "what's worth my attention now," which reads as stale.

The decision is to replace the model, not patch it. **Home is now a bounded dashboard with a stated 7-day horizon.** This is a deliberate product reversal, recorded here so the decision log has one authoritative model rather than two competing "settled" ones. Build prompts `B-HOME-WINDOW-02` through `B-HOME-COLDSTART-06` execute this decision; without this entry they would silently contradict canon.

---

## The model (what is now settled)

**1. Bounding instrument is a rolling 7-day window, not a budget.**
Zone 2 (the ambient band: From Friends, Recent Activity, Shared Ground/convergence) is bounded to **now − 7 days**. Nothing older than 7 days appears in Zone 2. The window is the bound; the served caps remain but are no longer the primary bounding instrument.

**2. Boundedness is a stated promise.**
The ambient band carries a single band-level label ("Past 7 days" or equivalent) stated once. Per-section headings are dropped or demoted beneath it. The label's job is to make the 7-day promise visible; it must be true whenever shown (see cold-start exception, §below).

**3. Spent cards disappear when exhausted (overrides §Q4).**
A From Friends milestone bundle is **hidden once all its questions are played**. While answerable, it shows a remaining count ("1 of 4 questions"). This reverses `§Q4`'s "spent cards stay as hollow-triangle bundles for 30 days" — but only for the *fully exhausted* case. A partially-played bundle still appears (with its remaining count), so no answerable content is thrown away. The 30-day roll-off for spent cards is moot under this model because exhausted cards are removed on exhaustion, not on a timer.

**4. Per-section honest empty states replace the all-or-nothing switch.** *(Treatment reverted 2026-06-15 — see note below.)*
When a Zone 2 section has nothing in the 7-day window, it shows an honest empty state rather than being silently hidden or backfilled from history. This overrides `D-HOME-PACING-01 §9`'s "hide empty sections; one empty state only when all three are empty." Recent-or-nothing: no section reaches past 7 days to fill a quota.

> **Update (2026-06-15):** the *honest per-section empty-state treatment* of point 4 was reverted. In practice the speech-bubble + "Nothing else this week." block read as orphaned clutter under the "Past 7 days" band. Empty Zone-2 sections (From Friends, Recent activity) are now **hidden outright** again, and the single "Past 7 days" band label is suppressed when the whole band resolves to nothing. The rest of the model is unchanged: recent-or-nothing windowing stands (no back-fill to a quota), and the whole-page empty state still wins only when everything is empty. The server still emits `emptySections` (`selectHomeEdition`); the renderer simply no longer draws a per-section empty, so re-enabling is a renderer-only change.

**5. "View more" portals are bounded to the same 7-day window.**
The `/from-friends` and `/activities` overflow pages render only the 7-day window, not the 35/90-day data window. They are no longer deep-history portals.

---

## What is explicitly NOT changed

- **Served caps stay as-is:** `DIRECT_SERVE_CAP = 3`, `PLAYABLE_SERVE_CAP = 4`, `TEXTURE_SOFT_CAP = 8`. The original audit slate proposed 5/5/6; that is withdrawn. Caps are not the complaint and changing them is unnecessary. Keeping texture at 8 also preserves the editorial-panel rhythm ("3 rows → panel → up to 5"), removing the re-tune risk the cap change would have introduced (audit row 6.4).
- **Zone 1 (directed/sent "For You") stays unwindowed.** A sent question is a gift; it persists until played or dismissed, ignores the 7-day window, pins above the band, and its `/for-you` overflow stays all-time. Live behavior already matches this (audit rows 1.3–1.7); no change.
- **Directed-card chrome.** `D-FEED-DIRECTED-CARD-RECONCILE-01` is closed (Option A, 2026-06-13) and untouched by this decision — this entry is about placement/lifecycle/windowing, not card chrome.
- **Editorial interstitial panel** (`CommonGroundFeature` / `RecentlyExpandingFeature` / `GrowYourCircleFeature`) and the quiet-week + invite empty promo are **reused as-built**, not re-specified.

---

## Cold-start exception (ratified as part of the model)

The 7-day window presumes a stream exists to bound. A brand-new user whose **only friend is the inviter (friend count ≤ 1)** has no stream; bounding produces a dead page on the most important first impression.

- **Trigger:** state-based — friend count ≤ 1. NOT time-based (no "first session" / "day one" — a time trigger would expire and create a content cliff).
- **Effect:** Zone 2 relaxes its window to pull the inviter's available content regardless of age, so the page is not empty.
- **Label:** the "Past 7 days" band label is **suppressed** while the exception is active (Option A), because the page is deliberately not bounded and the label must not assert a false promise.
- **Turn-off:** automatic — the moment a second friend is added, real stream exists and the window re-engages, with no cliff (there is now content to bound).
- **Not relaxed:** Zone 1 (unwindowed anyway) and the exhaustion filter (inert — a new user has played nothing).

---

## Authorized build slate

This decision authorizes, in sequence:
- `B-HOME-WINDOW-02` — install the rolling 7-day window over Zone 2; delete the `boundTexture` older-item backfill (recent-or-nothing). *(query-side; does not strictly need this entry but is part of the model.)*
- `B-HOME-OVERFLOW-WINDOW-03` — bound `/from-friends` and `/activities` to 7 days; leave `/for-you` all-time.
- `B-HOME-BAND-LABEL-04` — single "Past 7 days" band label; drop/demote per-section headings. *(authorized override of `D-HOME-PACING-01 §4`.)*
- `B-HOME-EXHAUST-05` — hide exhausted bundles; show remaining count while answerable. *(authorized override of `§Q4`.)*
- `B-HOME-COLDSTART-06` — friend-count ≤ 1 window relaxation + label suppression.

`B-HOME-CAPS-01` from the audit slate is **withdrawn** — caps unchanged.

The per-section honest-empty behavior (§4 / model point 4) is folded into `B-HOME-WINDOW-02` and `B-HOME-BAND-LABEL-04` rather than a standalone prompt, since it is the natural consequence of windowing + the band restructure.
