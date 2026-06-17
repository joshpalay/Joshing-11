# D-DESIGN-DEBT-STRUCTURAL-AUDIT-01 — Findings

**Type:** Decision/audit — read-only. No code was changed by this pass.
**Date:** 2026-06-16
**Scope:** Phase 0 inventory of cards, chips, the `/questions` list, settings/dev-tools gating, skeletons, and buttons in live code — measured against `PRODUCT-CANON.md`, the shadow-register decision in `D-CONSISTENCY-AUDIT-DISPOSITION-01.md` (§"Register assignment"), and the color rules in `_docs/STYLE-GUIDE-COLOR.md`.
**Purpose:** Gate the structural build prompt (`B-VISUAL-*`). Confirms which work is genuinely color-agnostic (safe now) vs. color-bearing (DEFER to `B-VISUAL-PALETTE-PROMOTE-01`).

---

## 0. Canon baseline used (and one correction)

The prompt paraphrases the canon as "shadow tiers 4×4/2×2/none." **That literal phrasing is not in `PRODUCT-CANON.md`** — its §accessibility/§principles are conceptual (color never the sole signal; honest provenance; warmth), not a shadow spec. The operative, code-governing shadow canon is:

- **`src/app/globals.css`** (tokens): `--shadow-paper-rest` `0 1px 2px /0.05`; `--shadow-card` `0 4px 12px /0.04`; `--shadow-card-strong` `0 4px 12px /0.1`; `--shadow-overlay` `0 12px 28px /0.16` (globals.css:298–306).
- **`D-CONSISTENCY-AUDIT-DISPOSITION-01.md` §"Register assignment (canon)"** — the two-register decision (Option B): a **flat letterpress** register (literal `Npx Npx 0 <ink>`, e.g. `4px 4px 0`, `2px 2px 0`) + a **soft-elevation** register (the four tokens), plus a focus-ring idiom (`0 0 0 2px`) and **bespoke tinted glows that are exempt** (GameplayChat navy, ceremony gem).

The prompt's "4×4 / 2×2 / none" therefore maps to the **flat-letterpress family** (`4px 4px 0`, `2px 2px 0`, none). This findings doc audits against the actual register set above. **Color rules** (STYLE-GUIDE-COLOR): grading red/green is reserved and always paired with a label/mark (never color-alone, §1); blue is reserved for action CTAs (disposition doc §"Canon guardrails", #1); category hues are identity signals, not a palette to normalize (§15).

**Color-agnostic confirmation:** the structural drift below (which radius token, which shadow tier, whether a shared shell exists) is separable from hue. Fill/stroke *colors* are tagged DEFER throughout. `globals.css`, the (already-promoted) palette tokens, and `PaletteToggle` were **not touched**.

---

## 1. CARDS

### 1a. The canonical card already exists — for the feed only

`src/components/feed/FeedCardShell.tsx` is the consolidated feed primitive (radius/border/shadow unified, accent bar configurable). Its values are the de-facto card canon:

| Token | Value | Source |
|---|---|---|
| Radius | `rounded-[var(--radius-xs)]` = **4px** (globals.css:294) | FeedCardShell.tsx:16 |
| Border | `--brand-rule` (resting) / `--brand-border` (elevated) | FeedCardShell.tsx:112 |
| Shadow | `--shadow-card` (resting) / `--shadow-card-strong` (elevated) | FeedCardShell.tsx:17,37 |

`TodaysFiveCard.tsx:242` and `feed/DismissedFeedBar.tsx:37` match this shell (radius-xs + `--shadow-card`). **These are on-canon.**

### 1b. The rest of the app runs three *other* card chromes — radius/shadow divergence

| Chrome family | Radius | Shadow | Render sites (file:line) | Divergence |
|---|---|---|---|---|
| **Feed shell (canon)** | `--radius-xs` (4px) | `--shadow-card`/`-strong` | FeedCardShell, TodaysFiveCard:242, DismissedFeedBar:37 | — (reference) |
| **`.card` utility (shadcn default)** | `rounded-lg` (10px) | `shadow-sm` (Tailwind default — **not in the register set**) | globals.css:363; used at QuestionBankPicker:91, review/RefineYourGame:39, replay/ReplaySummary:81, games/FirstGamePanel:67, games/interpretive-sections:142/201/218/255, games/game-details-mode-sections:33/112 | Radius ≠ token; shadow off-register |
| **"Section" cards** | `rounded-2xl` (16px) | `shadow-sm` | FriendsList:154/229/290/651/655, friends/ContactMatchBlock:73/87/177, friends/FindFriendsSearch:107, friends/InviteSomeoneNew:55, AddFriendInvite:660, PeopleYouInvited:208, app/friends/find:95/143, app/invite/[token]:18, app/u/[handle]/[token]:31 | Radius `rounded-2xl`/`3xl`; shadow off-register |
| **"Section" cards (larger radii)** | `rounded-3xl` (24px) / `rounded-[2rem]` / `rounded-xl` | `shadow-sm` | users/[id]:496 (`rounded-3xl`), FriendsHubPage:21 (`rounded-[2rem]`), profile/SettingsRow:72 (`rounded-xl`) | Bespoke literal radii |

**Finding C-1 (structural — safe now):** at least **four** distinct card chromes coexist (feed-shell 4px, `.card` 10px, section 16px, section 24px/`2rem`). Radius is set with Tailwind named scales (`rounded-lg/2xl/3xl/xl`) and literals (`rounded-[2rem]`), **not** the radius tokens (`--radius-xs…4xl`, globals.css:294–297). The feed consolidation (C7) was never propagated to friends/profile/settings/games surfaces. Radius unification is **color-agnostic**.

**Finding C-2 (structural — safe now):** `shadow-sm` (Tailwind default) is the de-facto card shadow on every non-feed card, but it is **not one of the four sanctioned registers**. Per the Option-B decision, card surfaces should sit on `--shadow-card`. This is the unfinished tail of disposition-doc #7 ("partially implemented").

### 1c. Modal / overlay shadows — mixed token vs. raw

On-canon (route through `--shadow-overlay`): `QuickAddQuestionModal.tsx:131`, `friends/AddFriendRequestModal.tsx:150`, `daily/setup/TerritorySetupClient.tsx:722`.
Off-canon raw values (same visual job, hardcoded rgba):
- `app/knowledge/page.tsx` modals `shadow-[0_18px_48px_rgba(0,0,0,0.18)]` (:700, :794, :826, :870) and toasts `shadow-[0_8px_24px_rgba(0,0,0,0.16)]` (:814, :818).
- Action sheets on `shadow-2xl`/`shadow-xl` (Tailwind default): `daily/summary/page.tsx:763`, `feed/FeedActions.tsx:150`, `questions/AnsweredRowActions.tsx:61`, `feed/AnswerSheet.tsx:63`, `feed/AnswerFeedbackSheet.tsx:170`, `report/ReportReasonSheet.tsx:113`, `CreateChooser.tsx:65`, `knowledge/AskFriendForDomain.tsx:215`, `SendQuestionDrawer.tsx:162`, `questions/page.tsx:500`.

**Finding C-3 (structural — safe now):** overlay elevation is split between the `--shadow-overlay` token and raw `0 18px 48px …` / Tailwind `shadow-2xl`. Tokenizing the rgba (color-bearing nuance is just the warm-ink tint) is **mostly color-agnostic**; the rgba *alpha/tint* is the only color atom (tag DEFER for the exact tint, structural for the snap-to-token).

### 1d. Flat-letterpress register — compliant, with one color nit

`OverlapMap.tsx:34,298` (`6px/4px 4px 0 INK`), `ShareCard.tsx:134` (`4px 4px 0 INK`), `knowledge/SharePortraitCard.tsx:245` (`3px 3px 0 INK2`), `CreatorNote.tsx:63` (`4px 4px 0 var(--warm-ink)`) — all correctly in the **flat-letterpress register** (bespoke/OG surfaces, exempt). **On-canon.**
Exception: `knowledge/KnowledgeOverviewClient.tsx:310` `2px 2px 0 #3a3a3a` — correct register, but a **raw hex** `#3a3a3a` instead of an ink token → **color-bearing, DEFER** (token-budget item, already in `B-VISUAL-TOKEN-BUDGET-01`).

### 1e. Deferred "raised" register (already documented)

`daily/setup/TerritorySetupClient.tsx` (`0 12px 28px /0.28` :652, `0 24px 60px /0.28` :680, `0 10px 24px` :980/998, `drop-shadow-lg` :717) and `knowledge/PortraitCircles.tsx:309` (`0 1px 3px /0.18`) form a mid "raised" register. **Already logged as deferred** in `D-CONSISTENCY-AUDIT-DISPOSITION-01.md` §"Deferred." No new action; noted for completeness.

---

## 2. CHIPS / TAGS

**There is no shared Chip primitive.** Only two dedicated chip components exist (`EditorialBadge.tsx` — house-author editorial pill; `AvatarChip.tsx` — avatar+name). Everything else is an ad-hoc inline `rounded-full` pill. Render sites:

| Site (file:line) | Radius | Padding | Type/casing | Fill |
|---|---|---|---|---|
| EditorialBadge.tsx:14 | (component) | — | editorial pill | dedicated |
| AvatarChip.tsx | (component) | — | avatar chip | dedicated |
| SendQuestionDrawer.tsx:172 (domain) | `rounded-full` | `px-2.5 py-1` | `text-xs`, sentence | `bg-secondary` |
| MyQuestionCard.tsx:59 (difficulty) | `rounded-full` | `px-2 py-0.5` | `text-[10px]` uppercase `tracking-wide` | `bg-[rgba(0,0,0,0.06)]` |
| PeopleYouInvited.tsx:241 | `rounded-full` | `px-3 py-1` | `text-xs` font-medium | `bg-muted` |
| PeopleYouInvited.tsx:268 | `rounded-full` | `px-3 py-1` | `text-sm` | `bg-primary/5 border-primary/10` |
| AddFriendInvite.tsx:504/591 | `rounded-full` | `px-3 py-1` | `text-sm` | `bg-primary/5 border-primary/10` + `shadow-sm` |
| ReplaySummary.tsx:87 | **`rounded-sm`** | `px-2 py-1` | `text-[0.65rem]` uppercase `tracking-[0.08em]` | `border` |
| AnswerFeedbackSheet.tsx:238 | `rounded-full` | `px-3 py-1` | `text-sm` font-semibold | colored, `text-white` |
| AnswerFeedbackSheet.tsx:259 | `rounded-full` | `px-2 py-0.5` | `text-[0.62rem]` uppercase `tracking-[0.14em]` | colored |
| NewTerritoryUndo.tsx:120 | `rounded-full` | `px-3.5` `min-h-9` | `text-[13px]` | `border` |
| TodaysFiveCard.tsx:49 (customize pill) | `rounded-full` | (gap-1.5) | — | cream utility |
| Nav.tsx:180 (count badge) | `rounded-full` | `px-1.5` | `font-mono text-[9px]` | accent |
| FeedList.tsx:676 (count badge) | `rounded-full` | `px-1.5 py-0.5` | `text-xs` | `bg-primary` |
| knowledge/RecentlyExpanding.tsx:98/264 (territory) | (badgeStyle) | — | — | `accent.fill`/`accent.border` (category) |
| GameplayChat.tsx:67/490 (badges) | (variant) | — | tone `'muted'`/`'warning'` | tone-colored |

**Finding CH-1 (structural — safe now):** chips diverge on **radius** (`rounded-full` vs `rounded-sm` at ReplaySummary:87), **padding** (`px-2`/`px-2.5`/`px-3`/`px-3.5`, `py-0.5`/`py-1`), **font size** (`text-[9px]` → `text-sm`), and **casing** (some uppercase+tracking, some sentence). A shared `<Chip>` primitive with size/variant props would absorb all of these. The *geometry* is **color-agnostic**.

**Finding CH-2 (color-bearing — DEFER):** chip *fills* are all over the map (`bg-secondary`, `bg-muted`, `bg-primary/5`, `bg-[rgba(0,0,0,0.06)]`, category `accent.fill`, tone colors). Fill normalization waits on the palette.

### Color-alone check (canon: color must never be the sole signal)

- **PASS** — difficulty badge (MyQuestionCard.tsx:59): neutral `bg-[rgba(0,0,0,0.06)]`, the value is rendered as **text** (`{difficultyLabel}`, :64) + `aria-label` (:62). Not color-coded.
- **PASS** — category label (MyQuestionCard.tsx:46): mono **text** of the category word; hue is decorative, text carries meaning.
- **PASS** — answered correctness in the questions list (see §3): color **paired** with strikethrough/italic (already WCAG-paired).
- **PASS** — GameplayChat badge `tone` (muted/warning): always carries a `label`.
- **⚠ CANON-WATCH (reported, not fixed) — the card category accent bar.** `FeedCardShell.tsx:70–78` renders a 2px edge bar whose **only** encoded variable is `accentColor` = category hue. On a card where the category name is **not** also in text, this is a **color-alone category signal** — a canon issue (color never the sole signal). It is reinforced by text on most cards, so severity is low. **Color-bearing → DEFER** to the palette work, but flagged here so the build prompt pairs the bar with a non-color cue (label/icon) rather than treating it as purely decorative.

---

## 3. `/questions` LIST

**Route:** `src/app/questions/page.tsx` (two tabs: "Your Questions" / "Answered"). The "spreadsheet feeling" is **two different components**, not one:

1. **Authored tab → `MyQuestionCard.tsx`**, mapped inside a `divide-y divide-border border-t border-border` list (page.tsx:451–464). Each row is an `<article className="flex items-start gap-3 py-4 …">` (MyQuestionCard.tsx:40) — **no card chrome**; rows are separated only by the parent `divide-y` rule.
2. **Answered tab → `AnsweredQuestionsList.tsx`**, a true grid table: a `sm:grid` header `grid-cols-[2fr_2fr_1fr_1fr_5rem]` (:68) over `<li className="grid grid-cols-1 … sm:grid-cols-[2fr_2fr_1fr_1fr_5rem] …">` rows (:83) in a `divide-y` list (:75). **This is the literal spreadsheet layout.**

(Related but off-route: `profile/AuthoredQuestionsFeed.tsx` reuses feed cards on the profile surface — different surface, not part of `/questions`.)

**Finding Q-1 (structural — safe now):** the two tabs render the same data through **two unrelated layouts** (flat `divide-y` article-rows vs. a 5-column grid table). The grid table (AnsweredQuestionsList) is the source of the "spreadsheet" read flagged by the review. Consolidating both onto a shared row/card primitive is **color-agnostic**.

**Finding Q-2 (color usage — PASS):** correctness in the answered grid is `var(--game-correct)` **plus** `line-through`/`italic` styling (AnsweredQuestionsList.tsx:89–103) — color is paired, not sole. No color-alone violation on this surface. (The grading hues themselves are color-bearing → any retint is DEFER, but the structural pairing is already correct.)

---

## 4. SETTINGS / DEV-TOOLS EXPOSURE

**Settings surface:** `/users/me` → redirects to `/users/[id]`; the owner self-view of `src/app/users/[id]/page.tsx` is the consolidated settings page (Privacy/Notifications/Account sections + `<AccountActions />` at :281).

**Dev-tools gating question — answered: NO, dev tools are NOT admin-gated; a normal authenticated (non-admin) user can see them.**

| Surface | Gating | Evidence |
|---|---|---|
| **"Developer tools" section** (7 links: reset session, noon reset, staging flags, points diagnostic, first-time-player, invite-login, create test game) | **None beyond "is this my own profile."** Rendered unconditionally inside the `ownerSelfView` block. No `ADMIN_USER_IDS`, no `NODE_ENV`, no flag. | `AccountActions.tsx:122–168`; mounted at `users/[id]/page.tsx:281`; no env gate (grep for `NODE_ENV`/`VERCEL_ENV` in those files = none) |
| **`/dev/*` routes** | **Session-only** (auth via `src/proxy.ts:56`). No admin check; `/dev/points-diagnostic` adds only a `getSession()` redirect. | proxy.ts:56; dev/points-diagnostic/page.tsx |
| **`PaletteToggle`** (design audit bar: card-bg cycler + flat toggle) | **None.** Mounted unconditionally for every visitor. Source comment: "Remove this component … before merging to a shipping branch." | `app/layout.tsx:86`; `components/dev/PaletteToggle.tsx:5–27` |
| **`/admin/reports` + `/api/admin/content-reports`** (the *only* truly admin-gated surface) | **`ADMIN_USER_IDS` allowlist.** `isAdminUser(session.userId)` → 404 if not admin. | `server/auth/admin.ts:1–19`; `admin/reports/page.tsx:18–20`; `api/admin/content-reports/route.ts:25–29` |

**Gating mechanism named:** `ADMIN_USER_IDS` (parsed by `isAdminUser()` in `src/server/auth/admin.ts`) is the repo's admin gate, but it is wired **only** to the content-report review queue. The **dev tools** (`AccountActions` section, `/dev/*` routes) and **`PaletteToggle`** have **no admin gate** — only session auth. So in any environment where a normal user is logged in (incl. production), they can open the Developer tools list and the design audit bar. **This is the headline exposure finding.** (It is structural/access-control, not color — safe to address now; the build prompt should gate or strip these.)

---

## 5. SKELETONS / LOADING

**No shared Skeleton primitive.** Each route hand-rolls one; `LoadingScreen.tsx` is the bespoke full-screen triangle loader (intentional brand primitive, not a skeleton). Inline spinners use lucide `Loader2` (`animate-spin`) at archive, onboarding, AccountActions:197/241, InlineHandleField:218, InlineEditableField:254.

| Skeleton | Radius | Fill | Extra | File:line |
|---|---|---|---|---|
| Home `CardSkeleton` / `FeedSkeleton` | (bespoke fns) | — | — | app/page.tsx:215, :225 |
| For You loading | `rounded-[12px]` | `bg-black/[0.04]` | `ring-1 ring-black/5` | app/for-you/loading.tsx:15 |
| From Friends loading | `rounded-[12px]` | `bg-black/[0.04]` | `ring-1 ring-black/5` | app/from-friends/loading.tsx:15 |
| Activities loading | — | — | `animate-pulse` | app/activities/loading.tsx:49 |
| Questions `LoadingSkeleton` | `rounded-lg` | `bg-muted` / `bg-card` | border on cards | app/questions/page.tsx:111–115, :480 |
| Knowledge `LoadingSkeleton` / domain | `rounded-lg` | `bg-muted` | border | app/knowledge/page.tsx:133; knowledge/[domain]:90–93 |

**Finding S-1 (structural — safe now):** skeletons diverge on **radius** (`rounded-[12px]` vs `rounded-lg`) and **structure** (only for-you/from-friends carry the `ring-1 ring-black/5` treatment; they're the one matched pair). A shared `<Skeleton>` primitive (and matching its radius to the real card radius once §1 lands) is **color-agnostic** for geometry.

**Finding S-2 (color-bearing — DEFER):** skeleton **fills** are inconsistent (`bg-black/[0.04]` vs `bg-muted` vs `bg-card`). Fill choice waits on the palette.

---

## 6. BUTTONS

**Canonical system exists and is widely adopted:** `.btn-primary` / `.btn-ghost` / `.btn-danger` / `.btn-icon` (globals.css:375–389), all `rounded-[4px]` with a `focus-visible` ring. Adopted across dozens of sites (questions, daily, onboarding, friends, feed, knowledge, report, etc. — see the `btn-*` grep). `.btn-primary` is `min-h-12` navy-fill; ghost/danger/icon are `min-h-11`.

**One-off button styles (divergent — not using the `btn-*` family):**

| Site | Style | Divergence |
|---|---|---|
| app/invite/[token]/page.tsx:71 | `bg-primary text-primary-foreground h-11 rounded-md px-4 text-sm font-medium` | One-off primary: `rounded-md` (not 4px), `h-11` (not `min-h-12`) |
| app/onboarding/OnboardingFlow.tsx:797 | `bg-foreground text-background rounded-full px-3 py-1.5 text-sm font-medium` | One-off pill "button" |
| app/login/LoginPanel.tsx:26 | `h-11 w-full rounded-[var(--radius-xs)] bg-[var(--btn-primary-bg)] … font-bold` | Parallel primary definition (login chrome). Equivalent fill/weight; separate from `.btn-primary`. Likely intentional but is a second source of truth |
| components/Nav.tsx:203 | FAB `rounded-full bg-primary size-14` | Intentional FAB (not a CTA button) — noted, not a defect |

**Finding B-1 (structural — safe now):** the `btn-*` system is healthy; the cleanup is small — fold invite:71 and onboarding:797 into `.btn-primary`/a pill variant, and decide whether LoginPanel:26 should reference `.btn-primary` instead of redefining it. **Color-agnostic.**

### Blue confinement (canon: blue = action CTAs only)

`bg-primary` resolves to `--brand-navy`. **Mostly confined to CTAs/affordances:** every `.btn-primary` (correct), the Nav FAB (action), and interactive **selection/toggle states** — `ui/Switch.tsx:33` (on-state), `SendQuestionDrawer.tsx:204` (checkbox), `AddFriendInvite.tsx:522/533` and `dev/invite-login:116` (selected chip) — which are borderline-acceptable (they mark an active control, not decoration).

**Finding B-2 (⚠ minor canon flag — color-bearing, DEFER):** two **non-CTA** blue usages fall outside "action CTA":
- `FeedList.tsx:676` — unread **count badge** `bg-primary text-primary-foreground` (a count, not an action).
- `users/[id]/page.tsx:498` — **avatar tint** `bg-primary/10 text-primary` (decorative initial).

These don't break interaction but technically widen blue past CTAs. Re-home them on a neutral/category token during the palette pass. (Nav's active tab correctly uses `bg-foreground`, not blue.)

---

## 7. Disposition summary

### Structural — SAFE NOW (color-agnostic; the build prompt can act without the palette)
- **C-1** Unify card radius: 4 chromes (feed 4px / `.card` 10px / section 16px / 24px·`2rem`) → one radius-token scale. *(§1b)*
- **C-2** Snap non-feed card shadows from Tailwind `shadow-sm` to `--shadow-card`. *(§1b)*
- **C-3** Snap overlay shadows (`shadow-2xl`, raw `0 18px 48px…`) to `--shadow-overlay`. *(§1c)*
- **CH-1** Introduce a shared `<Chip>` primitive; normalize radius/padding/size/casing. *(§2)*
- **Q-1** Consolidate the two `/questions` layouts (article-rows vs. 5-col grid) onto one row primitive; kill the spreadsheet grid. *(§3)*
- **S-1** Introduce a shared `<Skeleton>` primitive; unify radius + the `ring-1` treatment. *(§5)*
- **B-1** Fold one-off buttons (invite:71, onboarding:797, LoginPanel:26) into `btn-*`. *(§6)*
- **DEV-TOOLS** Gate or strip the "Developer tools" section, `/dev/*`, and `PaletteToggle` (access control, not color). *(§4)*

### Color-bearing — DEFER to `B-VISUAL-PALETTE-PROMOTE-01`
- **CH-2** Chip fill normalization (`bg-secondary`/`bg-muted`/`bg-primary/5`/category accents). *(§2)*
- **S-2** Skeleton fill normalization (`bg-black/[0.04]` vs `bg-muted` vs `bg-card`). *(§5)*
- **B-2** Re-home non-CTA blue (FeedList:676 count badge, users/[id]:498 avatar tint). *(§6)*
- **§1d** `KnowledgeOverviewClient.tsx:310` raw `#3a3a3a` letterpress ink → token (also `B-VISUAL-TOKEN-BUDGET-01`). *(§1d)*
- **C-3 tint** the exact warm-ink alpha of overlay shadows (structural snap is safe; the tint atom is DEFER). *(§1c)*
- **§1e** TerritorySetup / PortraitCircles "raised" register — already deferred by the disposition doc.

### Canon issues (reported, NOT fixed here)
- **§2 — card category accent bar** (`FeedCardShell.tsx:70–78`): a 2px hue bar can be a **color-alone** category signal where no category text accompanies it. Pair with a non-color cue. *(color-bearing → DEFER, but the requirement is structural)*
- **§4 — dev-tools exposure**: `ADMIN_USER_IDS`/`isAdminUser` gates only `/admin/reports`; dev tools + `PaletteToggle` are session-only / ungated and reach normal users.
- **§6 — blue past CTAs**: B-2 above.

### Confirmed compliant (no action)
- Feed-shell card (radius-xs + `--shadow-card`), flat-letterpress register on OG/share surfaces, `btn-*` adoption, grading color always paired with label/mark (questions answered tab; difficulty/category badges carry text), and the triangle solid/hollow played/unplayed signal (shape-encoded, not color).

---

*Read-only audit. No files were edited. `globals.css`, the promoted palette tokens, and `PaletteToggle` were not touched. All claims carry `file:line` evidence for grep verification.*
