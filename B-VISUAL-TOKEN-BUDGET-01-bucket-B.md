# B-VISUAL-TOKEN-BUDGET-01 — Bucket B color comparison

Side-by-side of every **bucket B** off-system color flagged by the
`no-restricted-syntax` token-lint rule, with the resolved hex of the flagged
Tailwind utility next to the resolved hex of the **nearest existing token** in
`src/app/globals.css`.

This is a decision aid for Phase 1 sign-off only. **No code has been changed.**
Bucket B is, by definition, the set where the remap is *not* 1:1 — every row
below shifts the rendered color by some amount, so each needs your call on
(a) which token and (b) whether the shift is acceptable.

## Caveats on the numbers

- **Tailwind palette hex are the standard reference values** (v3 lineage). This
  project is on Tailwind v4, which renders the same palette via `oklch`, so the
  on-screen sRGB can differ by a sub-perceptual amount. The deltas to the tokens
  are far larger than that nuance, so the conclusions hold either way.
- **`--destructive` is stored as `oklch(0.577 0.245 27.325)`** — that is
  *exactly* Tailwind v4's `red-600`, so I list it as `≈ #dc2626`.
- **Δ column** is a qualitative read of the visible gap, not a formal ΔE:
  `≈match` (imperceptible) · `small` · `moderate` · `large` · `none` (no token
  of that role exists).

---

## 1. Success / green  → `--success` (#178245) or `--game-correct` (#366045)

| site(s) | utility | utility hex | nearest token | token hex | Δ |
|---|---|---|---|---|---|
| QuestionForm:617, NotificationsForm:242, ReplaySummary:89 | `text-emerald-700` | `#047857` | `--success` | `#178245` | small |
| InlineEditableField:257, InlineHandleField:224 | `text-emerald-600` | `#059669` | `--success` | `#178245` | moderate |
| ReplaySummary:89 | `bg-emerald-50` | `#ecfdf5` | *(no pale-green token)* | — | none |
| ReplaySummary:89 | `border-emerald-200` | `#a7f3d0` | *(no pale-green token)* | — | none |

Note: text greens map cleanly to `--success`; the **pale tint backgrounds/borders
have no token** (closest neutral is `--brand-cream-card` but that reads as warm,
not green).

## 2. Error / red · rose  → `--destructive` (≈#dc2626) / `--danger` / `--wrong`

| site(s) | utility | utility hex | nearest token | token hex | Δ |
|---|---|---|---|---|---|
| AuthoredQuestionsFeed:205 | `text-red-700` | `#b91c1c` | `--destructive` | `≈#dc2626` | small |
| NotificationsForm:245, ReplaySummary:90 | `text-rose-700` | `#be123c` | `--destructive` | `≈#dc2626` | moderate (rose is pinker) |
| AuthoredQuestionsFeed:205 | `bg-red-50` | `#fef2f2` | *(no pale-red token)* | — | none |
| AuthoredQuestionsFeed:205 | `border-red-200` | `#fecaca` | *(no pale-red token)* | — | none |
| ReplaySummary:90 | `bg-rose-50` | `#fff1f2` | *(no pale-red token)* | — | none |
| ReplaySummary:90 | `border-rose-200` | `#fecdd3` | *(no pale-red token)* | — | none |

Note: text reds map to `--destructive`; the **pale tint backgrounds/borders have
no token**.

## 3. Warning / amber  → **no semantic `--warning` token exists**

The nearest values are the *decorative* triangle/cream tokens, which are not a
semantic warning role. Listed for reference only — these are the rows most likely
to belong in bucket C.

| site(s) | utility | utility hex | nearest token (decorative) | token hex | Δ |
|---|---|---|---|---|---|
| AddToBankAction:78, CeremonyPin:25, InlineHandleField:119/132, PreviewBanner:23/32, NotificationsForm:151, QuestionRatingButtons:78 | `border-amber-300` | `#fcd34d` | `--tri-darkyellow` | `#deae5c` | moderate |
| QuestionForm:528 | `border-amber-200` | `#fde68a` | `--tri-lighttan` | `#edd2a3` | moderate |
| AddToBankAction:78, CeremonyPin:25, InlineHandleField:119, PreviewBanner:23, NotificationsForm:151, QuestionForm:528/625 | `bg-amber-50` | `#fffbeb` | `--brand-cream-card` | `#fbf5e9` | small |
| QuestionRatingButtons:78, PreviewBanner:32 | `bg-amber-100` | `#fef3c7` | `--brand-cream` | `#f8e6c7` | small |
| AddToBankAction:78, QuestionForm:620/625, QuestionRatingButtons:78 | `text-amber-700` | `#b45309` | `--brand-orange` | `#d15e36` | large |
| NotificationsForm:151 | `text-amber-800` | `#92400e` | `--brand-orange` | `#d15e36` | large |
| InlineHandleField:119, PreviewBanner:23/32 | `text-amber-900` | `#78350f` | `--warm-ink` | `#1a1208` | large |
| QuestionForm:528 | `text-amber-950` | `#451a03` | `--warm-ink` | `#1a1208` | large |
| QuestionForm:611 | `decoration-amber-500` | `#f59e0b` | `--tri-amber` | `#d9a82e` | moderate |
| InlineHandleField:124 | `bg-amber-600` / `hover:bg-amber-700` | `#d97706` / `#b45309` | `--brand-orange` | `#d15e36` | moderate–large |

Note: there is **no warning-yellow token of any kind** — every amber row above
is approximated against decorative or unrelated tokens. My recommendation is to
treat the whole amber family as **bucket C** (needs a real `--warning*` token
invented) rather than force-fit it here.

## 4. Neutral / stone  → warm-ink ramp / warm borders

| site(s) | utility | utility hex | nearest token | token hex | Δ |
|---|---|---|---|---|---|
| CeremonyPin:25 | `text-stone-950` | `#0c0a09` | `--warm-ink` | `#1a1208` | small |
| QuestionRatingButtons:94 | `text-stone-800` | `#292524` | `--warm-ink` | `#1a1208` | small |
| CeremonyPin:33 | `text-stone-700` | `#44403c` | `--warm-ink-700` | `#696257` | moderate |
| QuestionRatingButtons:94 | `border-stone-400` | `#a8a29e` | `--warm-ink-400` | `#8a8070` | moderate |
| QuestionRatingButtons:94 | `bg-stone-200` | `#e7e5e4` | `--warm-border` | `#e8e2d6` | ≈match |

## 5. `white` / `black` on tokenized surfaces

| site(s) | utility | utility hex | candidate token | token hex | Δ |
|---|---|---|---|---|---|
| PreviewBanner:32 | `bg-white` | `#ffffff` | `--brand-card` | `#fdfcfb` | ≈match |
| TodaysFiveCard:334/374, AnswerFeedbackSheet:202, ContactMatchBlock:228, FindFriendsSearch:135, InlineHandleField:124 | `text-white` | `#ffffff` | `--primary-foreground` | `#fbf4e3` | small (cream tint) |
| FeedCard:30/117, SparkleEnvelope:49 | `text-black` | `#000000` | `--warm-ink` *(nearest)* | `#1a1208` | small |
| FeedCard:30/117, SparkleEnvelope:49 | `text-black` | `#000000` | `--brand-ink` *(rule's pick)* | `#0a1f3d` | moderate (black→navy) |

Note: `text-black` has **two** plausible targets — `--warm-ink` is the closest
hex (near-black), but the lint message itself prescribes `--brand-ink` (navy).
That ambiguity is exactly why these are bucket B.

## 6. Special case — documented near-duplicate black

| site | utility | utility hex | token | token hex | Δ |
|---|---|---|---|---|---|
| ReplaySummary:70 | `text-[#111111]` | `#111111` | `--warm-ink` | `#1a1208` | small |

`globals.css:164` explicitly states *"Near-duplicate blacks (#111111, #0e0e0e)
collapse onto `--warm-ink`."* So although `#111111 ≠ #1a1208` (not strictly 1:1),
the codebase has already **documented this exact remap as intended**. If you
accept that doc as authoritative, this one row could be promoted to bucket A.

---

## Suggested reading of the table

- **Map now (low risk):** the success/error **text** colors → `--success` /
  `--destructive`; `bg-white` → `--brand-card`; `text-[#111111]` → `--warm-ink`
  (documented). These are `≈match`/`small`.
- **Needs your token choice:** `text-black` (warm-ink vs brand-ink), `text-white`
  (keep vs `--primary-foreground`), the stone ramp.
- **Probably bucket C, not B:** every **amber** row (no warning token) and every
  **pale tint background/border** (no pale-success / pale-error token). Fixing
  these correctly means inventing tokens, which is out of scope for this pass.
