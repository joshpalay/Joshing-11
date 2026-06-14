# B-VISUAL-TOKEN-BUDGET-01 — Bucket B color comparison

> **STATUS — largely resolved (refreshed 2026-06-14).** This file was originally a
> *decision aid* listing every **bucket B** off-system color (the set where the
> token remap is **not** 1:1) for Phase-1 sign-off. Since then most of it has
> shipped, so the original "no code has been changed" framing was stale and
> misleading. This refresh records what was resolved and what genuinely remains.
> Verified against the live tree on 2026-06-14 (`grep` over `src/**/*.tsx`,
> excluding tests). Remaining work is small, optional, or blocked on inventing a
> token — **none of it is launch-blocking.**

The original side-by-side compared the resolved hex of each flagged Tailwind
utility against the nearest existing token in `src/app/globals.css`. The caveats
on the numbers (Tailwind v3 reference hex vs the project's v4 `oklch` rendering;
the qualitative Δ column) still hold and are kept at the bottom for reference.

---

## What shipped (resolved since the original pass)

- **The entire amber family (§3) is gone.** A real semantic warning token family
  was invented and applied: `--warning` (`#b45309`), `--warning-surface`
  (`#fdf6e6`), `--warning-border` (`#e6c15a`) at `globals.css:230–232`. The
  original doc called this token "out of scope / bucket C"; it now exists, so
  every `amber-*` row it listed (`AddToBankAction`, `CeremonyPin`,
  `InlineHandleField`, `PreviewBanner`, `NotificationsForm`,
  `QuestionRatingButtons`, `QuestionForm`) is resolved — **zero `amber-*`
  literals remain in `src/**/*.tsx`.**
- **The success/error *text* colors on bordered card surfaces** were tokenized to
  `--success` / `--destructive`: `QuestionForm`, `NotificationsForm`,
  `ReplaySummary` (§1/§2 green+red text), `AuthoredQuestionsFeed` (§2),
  `InlineEditableField` / `InlineHandleField` (§1). These components are now
  literal-clean.
- **The neutral/stone button row (§4)** — `QuestionRatingButtons` thumbs-down
  pressed state — was tokenized to `--warm-ink-400` / `--warm-border` (and the
  button itself has since been retired in favour of the content-report flow; see
  `audits/AUDIT-TRACKER.md` MISC-5). `CeremonyPin` is clean.
- **Several §5 `text-white`/`text-black` sites cleared** as their components were
  reworked: `TodaysFiveCard`, `FeedCard`, `SparkleEnvelope` no longer carry these.

Net effect: the color ratchet sits at **145** off-system occurrences (ceiling
180) and falling.

## What genuinely remains

| Bucket | Site(s) | Literal | Recommended token | Why not done |
|---|---|---|---|---|
| **B (safe map)** | `LoginPanel:811`, `OnboardingFlow:778` | `text-emerald-600` | `--success` | Just not done yet — low-risk text remap. |
| **B (safe map)** | `RoundReminderCard:125` (`text-rose-700`), `FirstSessionRecap:199` (`text-rose-300`) | rose error text | `--destructive` | Same — low-risk text remap. |
| **C (needs new token)** | `archive/page.tsx:93–94` | `border/bg/text-emerald` + `border/bg/text-rose` result badges | text → `--success`/`--destructive`; **tints have no token** | The pale `*-50`/`*-200` tint backgrounds & borders have **no** pale-success / pale-error token. Fixing correctly means inventing tints. |
| **Deferred (ambiguous)** | `AnswerFeedbackSheet:232`, `ContactMatchBlock:228`, `FindFriendsSearch:135` | `text-white` on colored fills | `--primary-foreground`? | White-on-accent; remap is a judgment call (keep pure white vs cream tint), low priority. |
| **C / deferred (canvas)** | `ReplaySummary:34,53`, `KnowledgeOverviewClient:262,302–303`, `SharePortraitCard:16`, `RoundReminderCard:19` | near-black `#111111` / `#0e0e0e` (inline style / canvas / OG) | `--warm-ink` (documented near-dup) | These are inline-style / canvas / OG-image components that **can't read CSS vars**, so they can't use tokens directly. |
| **N/A (false positive)** | `Switch.tsx:17` | `bg-emerald-500` | — | It's a **comment** describing what *not* to do, not a real utility. |

**Suggested next step:** the four "B (safe map)" text-color rows are the only
zero-risk remaining work; everything else is blocked on inventing pale-tint
tokens or is a canvas/var-less surface. Track the canvas near-blacks and the
ambiguous white-on-fill rows alongside CONS-7's deferred shadow surfaces — same
"can't read CSS vars" constraint.

---

## Caveats on the numbers (unchanged from the original pass)

- **Tailwind palette hex are the standard reference values** (v3 lineage). This
  project is on Tailwind v4, which renders the same palette via `oklch`, so the
  on-screen sRGB can differ by a sub-perceptual amount. The deltas to the tokens
  are far larger than that nuance, so the conclusions hold either way.
- **`--destructive` is stored as `oklch(0.577 0.245 27.325)`** — that is
  *exactly* Tailwind v4's `red-600`, so it reads as `≈ #dc2626`.
- **Δ** is a qualitative read of the visible gap, not a formal ΔE: `≈match`
  (imperceptible) · `small` · `moderate` · `large` · `none` (no token of that
  role exists).
- **Documented near-duplicate black:** `globals.css` states *"Near-duplicate
  blacks (#111111, #0e0e0e) collapse onto `--warm-ink`."* — which is why the
  near-black canvas rows above map to `--warm-ink` *in principle*, even though the
  canvas/OG surfaces can't consume the CSS var directly.
