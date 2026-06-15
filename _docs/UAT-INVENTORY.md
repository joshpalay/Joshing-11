# UAT-INVENTORY.md — Manual Verification Catalogue

**Generated:** 2026-06-05
**Purpose:** Enumerate every reachable user-facing surface a human tester must verify by hand before this build is trusted. This is a read-and-catalogue pass only — no code was changed, nothing was run, no tests were written.

---

## 0. Document basis & caveats (READ FIRST)

The task named four reference docs by path. Their actual status on disk:

| Asked-for path | Reality |
|---|---|
| `Master_App_Instructions-v2.md` | **Does not exist anywhere in the repo.** No file matching `*master*app*` exists. Catalogue proceeds without it. |
| `_docs/PRD-v11.2.md` | Lives at **`_docs/archive/PRD-v11.2.md`** (archived). Read in full. It folds in revisions through **v11.5**. |
| `PRD-AUDIT.md` | Lives at **`_docs/archive/PRD-AUDIT.md`** (the 2026-05-02 v11.0 audit against `PRD11.md`). Its §10 journeys are traced below, but it is **stale** in many places. |
| `audits/2026-05-16-remediation-prompt.md` | Exists. Read. Note: its Track 1.1 ("write `src/middleware.ts`") is **wrong for this repo** — `CLAUDE.md` and commit `635abc6` make `src/proxy.ts` the routing surface; a `middleware.ts` breaks Next 16. Do not act on that track. |

**Version tension you must account for while testing.** `CLAUDE.md` states the canonical product direction is the **PRD-D-* series (the v12 line)**, which *supersedes* the v11.x PRDs. The shipped code has clearly moved onto that line:

- The Feed is now **Broadcasts + Sent** tabs with four card types (PRD-D-1), not the v11.x single stream.
- **Lately** (unified activity stream) + **skill milestones** + the **"+2" / paired-friend reframe** are shipped (PRD-D-4).
- **Daily +2 bonus slots**, **niche-match discovery** (PRD-D-2), and **house-editorial authorship** (PRD-D-3) exist.

PRD v11.2 is **silent** on all of the above. Therefore:
- Where v11.2 speaks, the "Expected per PRD §x" column cites **v11.2 §x**.
- Where v11.2 is silent but PRD-D governs, the column cites **PRD-D-n** and the row is marked `[v12]`.
- A code≠v11.2 difference is **only flagged as a divergence** when it also conflicts with the current PRD-D line; pure "v11.2 didn't mention this" cases are noted, not flagged.

**Things this build does on purpose that look like bugs but are spec-compliant (do not file these):**
- OTP is hardcoded to `000000` in all environments (`src/server/auth/otp-store.ts:37-39`) — **locked by v11.2 §7.1 / §8.11 (v11.4)** for Phase 1.
- No daily-reminder / send / reaction / ceremony SMS is *intended* to fire — **v11.2 §8.11 (v11.4) defers SMS entirely.** (But see XCUT-2: the code still sends. That one IS a divergence.)
- Joshing Game, Activities tab, Archive, Personal Rounds are **deferred, not killed** — see the "Deferred" section. They should be unreachable.

**Not run / not verified (out of scope per instructions):** `npm run build`, `npm test`, `tsc`, `db:migrate`, any live LLM/Twilio call. The old PRD-AUDIT's `spawn EPERM` build failure is environment-specific and was not reproduced here — treat "production build is clean" as an open manual gate.

---

## Priority scale
- **P0** — core ritual or login; failure blocks all use.
- **P1** — primary nav surface or data integrity (mastery points, author credit, overlap/alignment, visibility).
- **P2** — secondary surface, edge case, cosmetic.

Format per row: **ID | Area | Surface (route/file) | What to verify (one human-checkable step) | Expected per PRD §x | Priority | Notes / known divergence.**

---

## 1. Authentication & Login

| ID | Area | Surface (route/file) | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| AUTH-1 | Auth | `/login` → `src/app/login/LoginPanel.tsx` | Enter a US phone with an accepted invitation, request code, enter `000000`, land authenticated. | v11.2 §7.1: phone + hardcoded `000000`, invite-gated | **P0** | `000000` is intended (`otp-store.ts:37-39`). |
| AUTH-2 | Auth | `POST /api/auth/request-otp` (`route.ts:55-66`) | Request a code for a phone with **no** invitation and **no** existing account → must be rejected `403 invite_required`. | v11.2 §7.1 invite-required gate | **P0** | Gate is the real Phase-1 access control; verify it can't be bypassed. |
| AUTH-3 | Auth | `POST /api/auth/verify-otp` (`route.ts:141-142`) | Submit `{"invitationToken":""}` (empty) for a new phone → must NOT provision an account. | v11.2 §7.1 | **P0** | Empty-token bypass guard; data-integrity. |
| AUTH-4 | Auth | `verify-otp` re-login path (`route.ts:154-199`) | Existing pre-gate account logs in without an invitation → succeeds (grandfathered). | v11.2 §7.1; Phase-2 finding F2.2 (deferred) | P1 | Intended grandfathering; confirm it's still scoped to *existing* accounts only. |
| AUTH-5 | Auth | `src/proxy.ts:47-60` | Hit any gated page logged-out → redirect to `/login?next=…`. | v11.2 §8.12 (auth gate) | **P0** | Routing is `proxy.ts`, NOT `middleware.ts`. |
| AUTH-6 | Auth | `src/proxy.ts:64-81` | Legacy session missing `inv` claim → routed through `/api/auth/refresh-session`. | remediation 1.1 behavior | P1 | Verify no redirect loop. |
| AUTH-7 | Auth | `/api/account/logout` & `/api/auth/logout` | Log out → session cookie cleared, gated pages redirect to `/login`. | v11.2 §8.12 | **P0** | ✅ **DONE** — fixed in B-LOGOUT-CONFIRM-FIX-01: confirm dialog now hard-navigates after `destroySession` clears `joshing_session`. Guarded by automated tests (`AccountActions.logout` + `account/logout` route); no longer needs manual UAT. (`/api/auth/logout` has no callers — flagged redundant.) |
| AUTH-8 | Auth | `request-otp` non-prod response (`route.ts:74`) | In production, response must NOT include `debugCode`. | v11.2 §7.1 step 3 | P1 | Leak check — prod must omit the code. |

---

## 2. Onboarding

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| ONB-1 | Onboarding | `/onboarding` guard (`onboarding/page.tsx:14-40`) | Visiting with `onboardingComplete=true` redirects to `/`; with no accepted invitation redirects to `/login`. | v11.2 §7.3 | **P0** | Belt-and-suspenders invitation check is present. |
| ONB-2 | Onboarding | `OnboardingFlow.tsx` "These look good" fast path | Accept seeded interests untouched → straight to home, **no** cultural-anchor step. | v11.2 §7.3 (v11.3 binary contract) | **P0** | Fast path must not collect birth-year/geo. |
| ONB-3 | Onboarding | `OnboardingFlow.tsx` "Let me adjust them" / "Start fresh" | Choosing adjust/fresh routes through background → warmup → review. | v11.2 §7.3 | P1 | Any deviation = full flow. |
| ONB-4 | Onboarding | Warmup gate (`OnboardingFlow.tsx:274-276`) | "Generate" enabled only when **2 of 3** warmup fields filled (3rd optional). | v11.2 §6.1 (warmup) | P1 | v11.0 audit's "needs 5" claim is **stale**; v11.x has 2 required + 1 optional. |
| ONB-5 | Onboarding | Pre-seeded interests (`getPreSeededInterestsForUser`) | Invitee sees inviter's seeded interests pre-filled with a "From [Inviter]" badge. | v11.2 §6.1; §7.3 | P1 | The old `TODO Phase 11` for pre-seeding is **done** — verify it actually loads. |
| ONB-6 | Onboarding | `POST /api/onboarding/propose-interests` (`route.ts:82-89`) | Submit with no `culturalAnchor` → succeeds (uses warmup only). | v11.2 §16.19 (optional at route) | P2 | Resolved as optional; confirm 200 not 400. |
| ONB-7 | Onboarding | `POST /api/onboarding/save-interests` | Lock in 1–5 interests → `onboardingComplete` set, session refreshed, redirect to `/`. | v11.2 §7.3 | **P0** | Cap of 5 enforced; ≥1 required. |
| ONB-8 | Onboarding | `POST /api/onboarding/canonicalize` | Type a freeform interest → returns a cleaned suggestion; LLM failure falls back to original text (no error). | v11.2 §7.3 | P2 | Fail-soft path. |

---

## 3. Home `/` (`src/app/page.tsx`)

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| HOME-1 | Home | `TodaysFiveCard` / `TodaysFiveSection` (`page.tsx:45-110`) | Home shows today's five status (remaining/complete) and a "Start" entry to `/daily/setup`. | v11.2 §8.12 (Home = Daily entry) | **P0** | Core ritual entry. |
| HOME-2 | Home | `CeremonyPin` (`page.tsx:113-124`, `home/CeremonyPin.tsx:24`) | When an unviewed ceremony exists, a pin/banner links to `/ceremony/[id]`. | v11.2 §8.12; §8.1.x | P1 | Only entry point to ceremony. |
| HOME-3 | Home | `MissedQuestionsCard` (`page.tsx:106-108`) | When missed questions exist and round incomplete, a standalone "Catch up" card links to `/daily/catchup`. | v11.2 §8.7a | P1 | Catch-up entry. |
| HOME-4 | Home | `RecentActivitySection` (Lately head, `page.tsx:130-143`) | Home shows top **3** activity-stream items ("What's happening"), newest first. | PRD-D-4 `[v12]` | P1 | `HOME_HEAD_LIMIT=3`; v11.2 silent. |
| HOME-5 | Home | inline `FeedList` (`page.tsx:146-162`) | Feed is rendered **inline at the bottom of Home**, not as a nav tab. | v11.2 §8.12 ("Feed surfaced from Home") | P1 | Confirms feed-on-home model. |
| HOME-6 | Home | `getNextDailyResetBoundary` / next-round countdown | The "next five at noon" timing displays and matches the user's timezone reset. | v11.2 §6.2 | P2 | Verify timezone correctness. |

---

## 4. Daily Five

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| DAILY-1 | Daily | `/daily/setup` (`daily/setup/page.tsx`) | Pick domains (random/custom) + difficulty, "Start" creates a queue and routes to `/daily`. | v11.2 §8.1 (setup) | **P0** | If a queue already exists & incomplete, setup redirects to `/daily` (`page.tsx:35`). |
| DAILY-2 | Daily | `/daily` play (`daily/page.tsx`, `GameplayChatThread`) | Answer 5 questions in the chat thread; each shows result, correct answer, breadcrumb. | v11.2 §6.2, §8.8a | **P0** | Core ritual. |
| DAILY-3 | Daily | `POST /api/daily/answer` (`route.ts:228-254`) | On LLM grader outage the answer returns **503 and is NOT scored** (no wrong verdict written). | v11.2 §8.8a (grade integrity) | **P0** | **Fail-SAFE confirmed** — see XCUT-1. Old "grading-fails-to-wrong" fear is not present. |
| DAILY-4 | Daily | "Show me the answer" / Skip (`daily/page.tsx:556`) | Give-up reveals answer without awarding points; skip advances without scoring. | v11.2 §8.1 | P2 | |
| DAILY-5 | Daily | `/daily/summary` (`daily/summary/page.tsx`) | After round, summary shows score, per-question recap, mastery/tier deltas, "Refine your game". | v11.2 §8.1 (summary) | P1 | Tier labels must read Establishing/Familiar/Solid/Mastery (see KNOW-7). |
| DAILY-6 | Daily | **+2 bonus slots** (`daily/types.ts:109,137`; `daily/page.tsx:17-32,303-304`) | When friends have qualifying domains, up to 2 extra **freshly-generated** "Accessible" questions appear, attributed "from [Name]'s world". | PRD-D-4 §B `[v12]` | P1 | Bonus slots are generated, not literal friend answers. v11.2 silent. Verify they never *pad* (0–2, graceful shrink). |
| DAILY-7 | Daily | `/daily/catchup` (`daily/catchup/page.tsx`) | Missed questions from the past week are answerable at reduced credit. | v11.2 §8.7a (`CATCHUP_WEIGHT 0.25`) | P1 | |
| DAILY-8 | Daily | catch-up recovery scoring (`api/daily/catchup/answer/route.ts:134`) | First-correct-after-wrong on catch-up awards **25%** of live base (recovery only), not 6.25%. | v11.2 §16.17 (MAX rule) | **P1** | Data integrity — must NOT compound the two 0.25× weights. |
| DAILY-9 | Daily | `POST /api/daily/reset` (Settings dev tool) | "Reset today's questions" clears the queue; a fresh set generates on next load. | v11.2 §5.3 | P2 | This replaced "Create Test Game". |
| DAILY-10 | Daily | Daily-Five expansion guard | Correctly answering a Daily Five question does **not** add a new demonstrated domain (no friend-mediated question id). | v11.2 §8.4.3 / §8.4.11 | **P1** | Data integrity — Daily Five cannot grow the map. Verify `eventQuestionId` is null on daily mastery writes. |

---

## 5. Feed (Broadcasts / Sent) `[v12]`

PRD v11.2 §8.2 is superseded by **PRD-D-1**. Verify against PRD-D-1.

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| FEED-1 | Feed | `FeedList.tsx` tabs (`:97`) | Two tabs: **Broadcasts** (`from-friends`, default) and **Sent** (`sent-to-me`), each with counts. | PRD-D-1 Stage 5 | P1 | `'all'` filter is legacy fallback only. |
| FEED-2 | Feed | `direct_sent` card (`feed/DirectSentCard.tsx`) | A directly-sent question is pinned in **Sent**, shows "[Name] sent you this", answerable + retryable. | PRD-D-1; v11.2 §8.3 | P1 | |
| FEED-3 | Feed | `friend_added` card (`feed/FriendAddedCard.tsx`) | A friend's broadcast/authored question appears in **Broadcasts** as "[Name] wrote this". | PRD-D-1; v11.2 §8.5.2 (broadcast) | P1 | Source `authored_shared` is an active write path again (v11.2 §8.5.2 reinstated broadcast). |
| FEED-4 | Feed | `friend_liked` card (`feed/FriendLikedCard.tsx`) | Legacy `thumbs_upped` items render "[Name] liked this" with endorsement collapse ("+N others"). | PRD-D-1 | P2 | Read-only legacy; no new thumbs_upped rows written. |
| FEED-5 | Feed | `answered_by_you` card (`feed/AnsweredByYouCard.tsx`) | After answering, card persists showing your answer vs. correct, points, tier delta, and **paired-friend** ("+2"/"you both") treatment when present. | PRD-D-4 (+2 reframe) `[v12]` | P1 | Paired-friend avatars = the "+2" reframe; verify the overlap pairing is the right friend. |
| FEED-6 | Feed | card actions (all four card files) | Each card supports: Answer, Skip/Dismiss, Add-to-bank, Send onward, Hide person, Hide category, Report (thumbs-down). | PRD-D-1; v11.2 §8.2 | P1 | |
| FEED-7 | Feed | dismiss → `DismissedFeedBar` | Dismissing collapses the card to an undoable bar; dismissed items never resurface after undo window. | v11.2 §8.2 (dismissed never resurface) | P1 | |
| FEED-8 | Feed | `POST /api/feed/[feedItemId]/answer` (`route.ts:107-115`) | Grader outage returns **503, no score persisted** (fail-safe). | v11.2 §8.8a | **P1** | See XCUT-1. |
| FEED-9 | Feed | thumbs-down (`/api/feed/[feedItemId]/thumbsdown`) | Thumbs-down removes the question from your feed and suppresses propagation to friends. | v11.2 §8.10 | P1 | Active. |
| FEED-10 | Feed | thumbs-**up** (`/api/feed/[feedItemId]/thumbsup`) | This endpoint exists but **no UI calls it** and the feed read path ignores `surface_priority_score`. | v11.2 §8.1.11 / §16.18 (deferred) | P2 | **Dormant by design** — verify it has no user-visible effect. Built-but-unreachable endpoint. |
| FEED-11 | Feed | feed cap (`MAX_FEED_LIMIT=50`, `rollOffOldItems`) | No more than 50 non-pinned items surface; older ones roll off. | v11.2 §8.2.6 (50) | P2 | v11.0 audit's "25" is stale. |
| FEED-12 | Feed | `friend_answered` (type-3) write vs render | A friend answering propagates a `friend_answered` row that is **written but NOT rendered** in the feed (feeds +2 / presence only). | PRD-D-1 Stage 5 | P1 | Verify these never appear as feed cards. |
| FEED-13 | Feed | empty / error states (`FeedList.tsx`) | Empty feed shows the intended copy; fetch error shows error copy, not a blank. | PRD-D-1 | P2 | |

---

## 6. Lately / Activity stream / Milestones `[v12]`

Governed by **PRD-D-4**. (v11.2 §8.15 *defers* the old Activities tab; the unified stream is the v12 replacement and IS reachable on Home + `/activities`.)

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| LATE-1 | Lately | `/activities` (`activities/page.tsx:18-20`) | Full activity stream renders, day-bucketed, from `buildActivityStream`. | PRD-D-4 | P1 | Reachable via the header bell (`Nav.tsx:130`), not a bottom tab. |
| LATE-2 | Lately | prominence sort (`activities/__tests__/lately-prominence.test.ts`) | Order is `they_got_you` > niche-match > skill-milestone > other. | PRD-D-4 | P1 | Data/ordering integrity. |
| LATE-3 | Lately | skill milestone "deep" form | A friend with ≥3 correct in a domain shows "[Name] went deep on [domain]". | PRD-D-4 §A (A-1) | P2 | |
| LATE-4 | Lately | skill milestone "breadth" form | 1–2 light domains roll up to "[Name]'s killing it — X, Y, and N more". | PRD-D-4 §A (A-1) | P2 | |
| LATE-5 | Lately | milestone expand → `InlineAnswerFlow` | Tapping a milestone expands ≤5 of the friend's actual questions and lets you answer **in place** (no navigation). | PRD-D-4 Correction 2 | P1 | |
| LATE-6 | Lately | `POST /api/lately/milestone/answer` (`route.ts:91-185`) | Correct milestone answer writes **full** mastery credit + author credit + territory promotion + friend fan-out; repeat-correct = 0 (dedup). | PRD-D-4 Correction 2 | **P1** | Data integrity — must not double-credit. |
| LATE-7 | Lately | milestone answer grader outage (`route.ts:79-87`) | Outage returns **503, unscored** (fail-safe). | v11.2 §8.8a | P1 | See XCUT-1. |
| LATE-8 | Lately | unread bell badge (`Nav.tsx:137-145`) | Bell shows unread count; opening `/activities` marks read. | PRD-D-4 | P2 | Badge is a count here (not the old "dot" claim). |

---

## 7. Question Bank & Authoring

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| QB-1 | Questions | `/questions` (nav) | Primary nav "Questions" opens the bank with All/Mine/Saved style filtering. | v11.2 §8.12 (Questions in nav) | P1 | |
| QB-2 | Questions | `QuestionForm.tsx` create (FAB `?create=1`) | "Write a question" composer opens from the FAB and from `/questions`. | v11.2 §8.5 | P1 | |
| QB-3 | Questions | destinations panel (`QuestionForm.tsx:632-634`) | Three destinations: **Save to bank** (locked ON), **Share with all friends** (toggle, default ON), **Send to specific friends** (toggle, default OFF, opens picker). | v11.2 §8.5.2 | P1 | Matches reinstated-broadcast spec exactly. |
| QB-4 | Questions | private visibility interaction (`QuestionForm.tsx:178`) | Setting visibility=private disables/clears both share destinations. | v11.2 §8.5.2 | P2 | |
| QB-5 | Questions | save confirmation copy (`QuestionForm.tsx:727`) | Confirmation reads "Saved to your bank only." / "Sent directly…" / "…see this in their feed" per destination. | v11.2 §8.5.2 (simplified copy) | P2 | No "opens [Domain] as declared territory" in the toast. |
| QB-6 | Questions | first-author orientation panel (`QuestionForm.tsx:464-474`) | First-ever author (zero authored questions) sees the §16.12 panel; it never reappears after first save. | v11.2 §16.12 (locked copy) | P2 | Copy must match the locked v11.4 text (no "on your map"). Driven by `/api/me/has-authored-question`. |
| QB-7 | Questions | edit/delete own + unused (`/api/questions/[id]`) | You can edit/delete only your own questions that haven't been used in games. | v11.2 §8.5/§8.13 | P2 | |
| QB-8 | Questions | LLM answer suggestion (`/api/questions/suggest-answer`) | "Suggest answer" returns a candidate; failure degrades gracefully. | v11.2 §8.5 | P2 | |
| QB-9 | Questions | authorship opens declared territory (`/api/questions` POST) | Writing a question in a new domain opens it as **declared** territory in your KB. | v11.2 §8.4.3 Path 2 | **P1** | Data integrity — verify a new authored domain appears on the map (no longer visually muted per §8.4.8). |

---

## 8. Send-to-Friend

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| SEND-1 | Send | `SendQuestionDrawer.tsx` / `SendQuestionAction` | From a feed card, daily/round summary, or composer, pick a recipient + optional ≤200-char message and send. | v11.2 §8.3 | P1 | Reachable from multiple surfaces. |
| SEND-2 | Send | `POST /api/questions/send` (rate limit) | Sending a 6th question to the same recipient in one day returns 429. | v11.2 §8.3 (5/day/recipient) | P2 | |
| SEND-3 | Send | recipient → pinned `direct_sent` | Recipient sees the question pinned in their **Sent** tab with "[Name] sent you this". | v11.2 §8.3; PRD-D-1 | P1 | |
| SEND-4 | Send | **no creator points for sender** | Sending and having the recipient answer awards the **sender nothing** (author credit still flows to the question's author). | v11.2 §8.3.4 (creator points removed) | **P1** | Data integrity — verify no sender mastery event fires. |
| SEND-5 | Send | **SMS on send** (`api/questions/send/route.ts:132`) | Sending a question currently **fires a real SMS** to the recipient when Twilio env is set. | v11.2 §8.11 (v11.4): **no SMS in Phase 1** | **P1** | **DIVERGENCE — see XCUT-2.** Tester: confirm whether SMS actually leaves in the deployed env. |

---

## 9. Knowledge

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| KNOW-1 | Knowledge | `/knowledge` (nav) | Primary nav "Knowledge" shows the mastery portrait (declared + demonstrated domains). | v11.2 §8.12, §8.4 | P1 | |
| KNOW-2 | Knowledge | declared vs demonstrated rendering (`DomainCircle`) | Declared and demonstrated circles render **identically** (no muted/outlined fill). | v11.2 §8.4.8 (visual withdrawal) | P2 | The old PRD-AUDIT "spider graph still present" concern: verify current view modes; visual distinction is intentionally gone. |
| KNOW-3 | Knowledge | `/knowledge/[domain]` detail | Domain page shows tier/progress and a visibility control (private/friends/public). | v11.2 §8.4 | P1 | |
| KNOW-4 | Knowledge | per-domain visibility (`PROFILE_DOMAIN_VISIBILITY`) | Setting a domain to private removes it from friend/public views. | v11.2 §8.4 | **P1** | Privacy integrity. |
| KNOW-5 | Knowledge | "Grow your map" copy (`knowledge/page.tsx`) | Copy surfaces **all three** growth paths (Feed/direct-send/game answers, plus authorship). | v11.2 §8.4.11 (locked copy) | P2 | v11.0 audit said copy only mentioned direct-send; verify the lock landed. |
| KNOW-6 | Knowledge | map tidy/merge (`/api/knowledge/tidy`) | "Tidy up my map" merges duplicate domains; rate-limited once/24h. | v11.2 §8.4 (domain merge) | P2 | |
| KNOW-7 | Knowledge | tier labels (everywhere) | All tier labels read **Establishing / Familiar / Solid / Mastery** — no Curious/Explorer/Scholar/Sage or Versed/Fluent/Master anywhere. | v11.2 §8.4.8 (v11.5 canonical) | **P1** | Verified in code: retired label sets are **gone** (`knowledge-tier-copy.ts`, `difficulty-copy.ts`). Spot-check profile & domain pages to confirm. |
| KNOW-8 | Knowledge | streaks surfacing | Confirm whether a streak metric is still surfaced on Knowledge. | v11.2 non-goal (streaks not surfaced) | P2 | Old audit flagged "On a streak" copy; verify in current code whether it persists (potential divergence). |

---

## 10. Profile & Account

Note: the PRD §8.12 5th nav item is labelled **"Account" → `/account`**, but code ships **"Profile" → `/users/me`** (`Nav.tsx:14`) and **there is no `/account` route**. Treat this as a label/route divergence (XCUT-5).

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| ACCT-1 | Account | `/users/me` → `/users/[id]` (`users/me/page.tsx:19`) | Profile nav redirects to your canonical profile self-view. | v11.2 §8.12 (Account) | P1 | Route is `/users/me`, not `/account`. |
| ACCT-2 | Account | display name + handle inline edit | Edit display name (2–30) and handle (3–20, regex, 30-day cooldown). | v11.2 §8.9-style settings | P2 | Handle cooldown enforced server-side. |
| ACCT-3 | Account | section visibility (`/api/account/visibility`) | Toggle knowledge_base / friends_list / authored_questions among public/friends/private and confirm it affects others' views. | v11.2 §8.4 (visibility) | **P1** | Privacy integrity. |
| ACCT-4 | Account | discoverability (`/api/account/discoverability`) | Toggle contacts / mutual-friends / niche-match discoverability. | PRD-D-2 `[v12]` | P1 | Niche-match is v12; v11.2 silent. |
| ACCT-5 | Account | reminders (`/api/account/reminders`) | Toggle SMS/email reminder opt-in; setting a pending email triggers a verification email. | v11.2 §8.11 (SMS deferred) | P1 | **Tension:** SMS reminders are deferred per §8.11; verify toggling SMS-on does not actually start sending (XCUT-2). |
| ACCT-6 | Account | email verify (`/verify-email`, `/api/account/email/verify/*`) | Click the emailed link → email confirmed; expired/duplicate paths show correct copy. | (v12 reminders) `[v12]` | P2 | Reachable only via emailed token. |
| ACCT-7 | Account | invite token (`/api/account/invite-token` + `/rotate`) | Generate/copy your evergreen invite URL (`/u/[handle]/[token]`); rotating invalidates the old one. | PRD-D-2 / B-Friends `[v12]` | P1 | Requires a handle first. |
| ACCT-8 | Account | adaptive level (`/api/account/adaptive-level`) | Adaptive difficulty level is displayed (read-only). | v11.2 §3.4 | P2 | No user-set endpoint (read-only is intended). |
| ACCT-9 | Account | delete account (`DELETE /api/account`) | Type "DELETE" → account + sessions + data removed; subsequent requests are unauthenticated. | (data integrity) | **P1** | Destructive — verify scope and that it fully signs out. |
| ACCT-10 | Account | dev tools surfaced in profile | Dev-only actions (reset session, noon reset, test game, points diagnostic, flags) appear under owner self-view. | v11.2 §5.3 | P2 | **Verify these dev links are hidden/blocked in production** (see DEV section). |

---

## 11. Friends & Invitations `[v12 — B-Friends / PRD-D-2]`

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| FRND-1 | Friends | `/friends` (nav, `FriendsHubPage.tsx`) | Friends hub lists mutual friends + "Find friends" + "Add friend" actions. | v11.2 §8.12 (Friends in nav) | P1 | |
| FRND-2 | Friends | `/friends/find` (`friends/find/page.tsx`) | Search by handle/phone, contact matches, "People you invited" reflection, "Invite someone new". | PRD-D-2 | P1 | "Suggested via mutual friends" is a **"Coming soon" placeholder** — verify it's inert. |
| FRND-3 | Friends | friend request lifecycle (`/api/friend-requests/[id]/{accept,ignore,cancel,remove}`) | Send → accept/ignore → friendship state transitions correctly; ignore sets 24h cooldown. | PRD-D-2 | P1 | |
| FRND-4 | Invite | `/invite/[token]` (SMS-style landing) | Logged-out invitee sees inviter card; "see the note" routes to `/login?invitationToken=…`; expired/accepted/invalid states render. | v11.2 §7.x; PRD-D-2 | **P0** | First step of the invited-user funnel. |
| FRND-5 | Invite | `/u/[handle]/[token]` (evergreen link) | Logged-out → login with invite params; logged-in-as-inviter → `/friends`; logged-in-as-other → "Add friend" + inviter profile. | PRD-D-2 | P1 | |
| FRND-6 | Invite | end-to-end accept (`verify-otp` → `acceptFriendInvitation`) | New invitee completing login creates the inviter↔invitee friendship and seeds interests. | PRD-D-2; v11.2 §7.3 | **P0** | The whole invited-onboarding journey hinges on this. |
| FRND-7 | Invite | create invitation (`POST /api/friend-invitations`) | Create an SMS invite with up to 3 suggested interests; rate limits (12/hr user, 4/hr/phone, cooldowns) enforced. | PRD-D-2 | P1 | |
| FRND-8 | Invite | **invite SMS send** (`friend-invitations` POST) | Creating an invite currently builds + sends a real SMS. | v11.2 §8.11 (v11.4): no SMS | P1 | **DIVERGENCE — XCUT-2.** Confirm whether the invite SMS leaves. (If SMS is off, the invite URL must be surfaced in-app so the funnel still works.) |
| FRND-9 | Friends | contact matching (`/api/contact-hashes`, `/matches`) | Upload hashed contacts → see matches (requires `PHONE_HASH_SALT`). | PRD-D-2 | P2 | Matching silently no-ops if salt unset; verify prod has salt. |
| FRND-10 | Profile | friend profile view (`/users/[id]`) | A friend's profile shows common ground, mutual friends, top domains, authored questions; non-friends see the gated minimal card. | PRD-D-2; v11.2 §8.4 (visibility) | **P1** | Privacy integrity — non-friends must NOT see knowledge/questions. |
| FRND-11 | Profile | `/users/[id]/knowledge` | Friend's full knowledge map respects per-domain visibility (private hidden). | v11.2 §8.4 | **P1** | Privacy integrity. |
| FRND-12 | Discovery | niche-match (`/api/users/recent`, write-activity) | A stranger answering your question surfaces as `niche_match_answered_your_question` in Lately. | PRD-D-2 | P2 | v12; verify it appears and respects discoverability opt-out. |

---

## 12. Biweekly Ceremony

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| CERE-1 | Ceremony | `/ceremony/[ceremonyId]` (`ceremony/[ceremonyId]/page.tsx`) | Cinematic, tap-to-advance beats render; null beats are skipped; an all-null ceremony is never shown. | v11.2 §8.1.33 | P1 | |
| CERE-2 | Ceremony | beats content | Up to 5 beats: Crossed, Discovered, Shaped, Aligned, Gave — in order. | v11.2 §8.1.33 | P1 | |
| CERE-3 | Ceremony | solo-mode suppression (`payload.mode`) | In **solo** mode, Beat 3 (Shaped) and Beat 4 (Aligned) are suppressed; Beat 5 (Gave) still renders. | v11.2 §8.1.32 | **P1** | Data correctness — Beat 4 must be cycle-scoped, never a stale lifetime-overlap friend. |
| CERE-4 | Ceremony | friend fallbacks (`beat1FriendFallback`, `beat5FriendFallback`) | When the user's own Beat 1/5 is null, a friend-fallback view may fill the slot (respecting private-domain exclusion on Beat 1). | v11.2 §8.1.33 | P1 | Privacy: private domains excluded from fallback names/counts. |
| CERE-5 | Ceremony | `viewedAt` (`/api/ceremony/[id]/viewed`) | First view sets `viewedAt`; the Home pin then disappears. | v11.2 §8.1.x | P2 | |
| CERE-6 | Ceremony | share card (`ShareCard`, `/api/ceremony/[id]/share-token`) | Copy-link + save-image work; `/share/ceremony/[token]` public page shows a safe subset (no raw user IDs). | v11.2 §8.1.x | P1 | Public route is auth-exempt in `proxy.ts`. |
| CERE-7 | Ceremony | **cron cadence** (`vercel.json`, `api/cron/weekly-ceremony/route.ts`) | Confirm a given user receives a ceremony on a **14-day** cycle, not weekly. | v11.2 §8.1.30 (biweekly, 14-day) | **P1** | **DIVERGENCE TO VERIFY:** cron is named `weekly-ceremony`, runs daily (`0 8 * * *`), dedups only within **6 days** (`RECENT_FIRE_LOOKBACK_DAYS=6`). A 6-day dedup permits roughly *weekly* fires — confirm the 14-day gate actually holds per user. |
| CERE-8 | Ceremony | eligibility (`§8.1.31`) | A user with **zero** mastery events in the cycle gets **no** ceremony. | v11.2 §8.1.31 | P2 | |
| CERE-9 | Ceremony | author-credit Beat 5 math | Beat 5 "Gave" total = sum of `author_credit` mastery events where `answeredByUserId != userId`, one decimal; self-answers excluded. | v11.2 §8.1.33 §16.16 | **P1** | Data integrity (author-credit windowed model). |

---

## 13. Reactions, Recheck, Grade-dispute

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| RX-1 | Reactions | `/api/reactions` (+ `/[id]/reply`) | React to a question with a canned set or custom note (≤160 chars); self-reaction blocked; reply marks replied. | v11.2 §8.10b (160 chars) | P2 | |
| RX-2 | Reactions | **reaction SMS** (`reactions.ts:92`) | A reaction currently fires a real SMS to the recipient. | v11.2 §8.11 (no SMS) | P1 | **DIVERGENCE — XCUT-2.** |
| RX-3 | Recheck | `/api/{daily,feed}/.../recheck`, `/api/replay/grade` | After a wrong answer, "recheck" re-grades; an accepted near-miss flips to correct and adjusts mastery. | v11.2 §8.x grading | P1 | Verify recheck cannot be abused to farm points. |
| RX-4 | Dispute | `GradeDispute` table / recheck path | A disputed grade is recorded and resolvable. | v11.2 §3.x | P2 | Confirm a UI path exists or note it's API-only. |

---

## 14. Cross-cutting / Production readiness

| ID | Area | Surface | What to verify | Expected per PRD §x | Priority | Notes / known divergence |
|---|---|---|---|---|---|---|
| XCUT-1 | Grading | `src/server/grading.ts:60-105`, `src/lib/llm.ts:184` | On LLM grader timeout (8s, 2 attempts) every answer surface returns **503 / unscored** and persists **no verdict**. | v11.2 §8.8a (integrity) | **P0** | **FAIL-SAFE — confirmed across daily, catch-up, feed, joshing-game, lately, replay.** The old "grading-fails-to-wrong" hazard is NOT present; type system (`status:'unscored'` has no `result`) prevents treating outage as a verdict. Tester: simulate outage and confirm the user is told to retry, not marked wrong. |
| XCUT-2 | SMS | `src/server/sms.ts:36-44` + 6 call sites | Determine whether the deployed environment actually sends SMS. `sendSms` sends whenever `TWILIO_*` env is present (it only no-ops when env is **missing**), and `env-check.ts` **requires** those vars in prod. | v11.2 §8.11 (v11.4): **zero SMS in Phase 1** | **P1** | **DIVERGENCE.** Active senders: ceremony `fire-ceremony.ts:126`, reactions `reactions.ts:92`, direct-send `questions/send:132`, broadcast `questions/route.ts:382`, joshing-game answer `:125/:144`, daily-reminder cron `daily-assignments:92`. PRD says none should fire. Remediation note calls these "dead spec" but they are still wired and ungated. |
| XCUT-3 | Cron | `vercel.json` | Confirm Daily Five actually appears at the noon reset. **`/api/cron/daily-assignments` is NOT scheduled in `vercel.json`** (only `weekly-ceremony`, `vet-questions`, `expire-friend-requests`, `pool-refill`). | v11.2 §6.2 (five waiting) | **P0** | **VERIFY:** if daily generation is lazy (on page load) this is fine; if it relies on the unscheduled cron, the core ritual silently breaks. The `pool-refill` cron (`0 9 * * *`) may be the real source. Must be confirmed by hand. |
| XCUT-4 | Cron | `vercel.json` crons | `weekly-ceremony`, `vet-questions`, `expire-friend-requests`, `pool-refill` all run on schedule and authenticate via `CRON_SECRET`. | v11.2 §9 (prod readiness) | P1 | Cron names drifted from PRD (biweekly→weekly); see CERE-7. |
| XCUT-5 | Nav | `src/components/Nav.tsx:10-14` | Bottom nav is Home / Friends / Questions / Knowledge / Profile; Activities is the header bell; FAB opens the question composer. | v11.2 §8.12 | P1 | **Minor divergence:** PRD says 5th item "Account → `/account`"; code ships "Profile → `/users/me`" and `/account` does not exist. |
| XCUT-6 | Routing | `src/proxy.ts` + `check-middleware` skill | Confirm **no `src/middleware.ts`** exists (it breaks Next 16; reverted 5+ times). | CLAUDE.md / commit `635abc6` | P1 | Do NOT add middleware.ts even though remediation 1.1 suggests it. |
| XCUT-7 | Env | `src/env-check.ts` | App boots only with `DATABASE_URL`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, `TWILIO_*`, and `JWT_SECRET`/`AUTH_SECRET`. | v11.2 §9 | P1 | `.env.example` is known-incomplete vs this list (missing `CRON_SECRET`, Twilio uncommented). Note: requiring Twilio while SMS is "deferred" is what makes XCUT-2 live. |
| XCUT-8 | Build | (manual) | `npm run build` completes cleanly in the deploy environment. | v11.2 §9 | **P0** | Not run here. Old audit hit `spawn EPERM` (environment-specific). Must be confirmed before trust. |
| XCUT-9 | Phone hash | `PHONE_HASH_SALT` (CLAUDE.md) | Production has `PHONE_HASH_SALT` set (enforced at boot); contact matching and `User.phone_hash` depend on it. | CLAUDE.md | P1 | Rotating it invalidates all contact hashes. |

---

## 15. End-to-end journeys (PRD-AUDIT §10 + the two added by the task)

Verdicts reflect **current code** (the §10 verdicts in the archived audit are stale).

| # | Journey | Verdict | Path / breakpoints |
|---|---|---|---|
| J1 | **New-user onboarding** | ✅ INTACT | `/invite/[token]` or `/u/[h]/[t]` → `/login` (`000000`) → invite gate → `/onboarding` (seeded interests, 2/3 warmup) → save → `/`. Funnel depends on the invite URL being surfaced in-app **if** SMS is off (see FRND-8). |
| J2 | **Daily ritual** | ✅ INTACT | `/` → `/daily/setup` → `/daily` (answer 5 + 0–2 bonus) → `/daily/summary`. **Caveat XCUT-3:** confirm queue generation without a scheduled `daily-assignments` cron. |
| J3 | **Sending a question** | ✅ INTACT (1 divergence) | Composer → destinations → `/api/questions/send` → recipient's **Sent** tab pinned. Divergence: fires SMS (XCUT-2 / SEND-5); sender earns no creator points (SEND-4, correct). |
| J4 | **Receiving / playing** | ⚠️ CHANGED | The v11.0 "receive & play a Joshing Game" journey is **DEFERRED** (game creation disabled). The live equivalent — receiving a direct-sent/broadcast question and answering it in the Feed — is **INTACT** (FEED-2/3/8). |
| J5 | **Lately / feed engagement** | ✅ INTACT | Home feed + `/activities` Lately + milestone inline-answer (LATE-5/6). The old "`/feed` shows friends list" bug is **gone** — there is no top-level `/feed` page anymore (only `/feed/debug/*`). |
| J6 | **Biweekly ceremony** | ⚠️ INTACT-WITH-RISK | cron → Home pin → `/ceremony/[id]` → share card → `/share/ceremony/[token]`. **Verify cadence (CERE-7):** cron is daily with a 6-day dedup, not a clean 14-day gate. |
| J7 | **Knowledge exploration** | ✅ INTACT | `/knowledge` → `/knowledge/[domain]` → custom `/daily/setup`. True "Personal Rounds" remain **deferred** (custom daily setup is the substitute). |
| J8 | **Catch-up** | ✅ INTACT | Home `MissedQuestionsCard` → `/daily/catchup` → answer at 0.25× (recovery = 25%, DAILY-8). |

---

## 16. Built-but-unreachable / fail-unsafe / divergent — consolidated flags

**BUILT BUT UNREACHABLE (verify they stay unreachable, or wire them up):**
- `/replay` (`src/app/replay/page.tsx`) — full practice-missed-questions surface with **no inbound nav/link**; URL-only. `[v12]` feature, no PRD-D entry point found. **P1 to triage.**
- `/api/feed/[feedItemId]/thumbsup` — endpoint with **no UI caller**; feed read path ignores `surface_priority_score`. Dormant by design (v11.2 §8.1.11/§16.18). **P2.**
- `friend_answered` feed rows — written but never rendered (PRD-D-1 Stage 5). Verify they never leak into a card. **P1.**
- `/new-game` — renders a "coming soon" message; creation disabled. Deferred (below).
- Dev pages (`/dev/*`, `/feed/debug/friend-coverage`) — see DEV note.

**FAIL-UNSAFE — none found in grading.** XCUT-1: all answer surfaces fail **safe** (503/unscored). This is the single biggest positive delta from the stale PRD-AUDIT.

**DIVERGENT (code conflicts with the governing PRD line) — file:line:**
- **XCUT-2 / SEND-5 / FRND-8 / RX-2 / ACCT-5** — SMS still sends (`src/server/sms.ts:36-44`; senders at `fire-ceremony.ts:126`, `reactions.ts:92`, `questions/send/route.ts:132`, `questions/route.ts:382`, `joshing-games/[id]/answer/route.ts:125,144`, `cron/daily-assignments/route.ts:92`) vs v11.2 §8.11 "zero SMS in Phase 1". **P1.**
- **CERE-7** — `api/cron/weekly-ceremony/route.ts` (name + 6-day dedup, daily run) vs v11.2 §8.1.30 "biweekly / 14-day". **P1, verify.**
- **XCUT-3** — `daily-assignments` cron absent from `vercel.json` vs v11.2 §6.2 daily delivery. **P0, verify generation path.**
- **XCUT-5** — nav 5th item "Profile → `/users/me`" / no `/account` route vs v11.2 §8.12 "Account → `/account`". **P1 (minor).**
- **KNOW-8** — streak surfacing on Knowledge (old audit) vs v11.2 non-goal — verify present/absent in current code. **P2.**
- `.env.example` incomplete vs `env-check.ts` (XCUT-7). **P2.**

---

## 17. Deferred features — confirm UNREACHABLE (do NOT test as P0/P1)

Per v11.2 §5.4, §8.7b, §8.14, §8.15 these are **deferred, not killed**. The single human-checkable step for each is: *confirm there is no user-facing entry point.*

| Feature | Surface in code | Expected per PRD | How to confirm unreachable |
|---|---|---|---|
| **Joshing Game** | `/new-game`, `/games/[id]`, `/games/[id]/summary`, `/api/joshing-games/*` | v11.2 §8.14 deferred | `GAME_CREATION_DISABLED_IN_V11_1 = true` (`api/joshing-games/route.ts:13`); POST returns disabled at `:65`; `/new-game` shows "coming soon"; FAB does not offer game creation. Verify no path creates a game. |
| **Activities tab (old)** | (replaced by Lately) | v11.2 §8.15 deferred | The old standalone Activities **tab** is not in bottom nav. NOTE: the v12 **Lately** stream (`/activities` + Home head) IS the live replacement and is intentionally reachable — don't confuse the two. |
| **Archive** | `src/app/archive/page.tsx`, `/api/archive` | v11.2 §8.7b deferred | Not in primary nav. Old audit said it's reachable via a profile breadcrumb (`archive/page.tsx:214`) — **verify whether that breadcrumb still exists; if so, Archive is reachable contrary to "deferred".** Flag if reachable. |
| **Personal Rounds** | (none — only custom `/daily/setup`) | v11.2 §5.2 deferred | Confirm no distinct non-Daily-consuming "Personal Round" entry exists; custom daily setup is the only path. |

---

## 18. Quick reference — DEV-only pages (must be gated in production)

`/dev/flags`, `/dev/loading-preview`, `/dev/noon-reset`, `/dev/points-diagnostic`, `/dev/reset-session`, `/dev/test-game`, `/feed/debug/friend-coverage`. All require auth (redirect to `/login`); `friend-coverage` additionally checks `FEED_DEBUG_ENABLED`/non-prod. **DEV-1 (P1):** verify the dev links exposed in the profile owner self-view (ACCT-10) are hidden or hard-blocked in production, and that these pages cannot be reached by a normal user.

---

*End of inventory. Every row above is a single human-checkable verification step. Items tagged `[v12]` are governed by the PRD-D-* series because PRD v11.2 is silent on them.*
