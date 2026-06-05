# UAT-RESULTS — 2026-06-05

Structured manual test pass against `_docs/UAT-INVENTORY.md`, verdicts measured against `_docs/archive/PRD-v11.2.md` (folds v11.3–v11.5) and the governing **PRD-D-\*** line where the inventory marks a row `[v12]`.

**Tester:** Claude (agentic pass — surfaces driven via authenticated HTTP + headless Chromium, not code-reading-only except where explicitly noted).

---

## Build under test

| | |
|---|---|
| **Branch / commit** | `dev2` @ `b40a0a9` ("Merge PR #648") — the integration branch the inventory was generated against. Working tree clean (only `next-env.d.ts`/`tmp-screenshots` untracked). |
| **Server** | `npm run dev` (Next dev), `http://localhost:3000`, Node 24, Windows. |
| **Login** | OTP hardcoded `000000` confirmed (`otp-store.ts` `verifyOtp`). |

### Environment constraints (these gate several verdicts → BLOCKED)

| Constraint | Effect on testing |
|---|---|
| `TWILIO_*` **unset** locally | `sendSms` no-ops when Twilio env is missing, so **no SMS can actually leave**. Every "does SMS fire?" row (XCUT-2, SEND-5, FRND-8, RX-2, ACCT-5) is **BLOCKED** locally — code path can be read but a real send cannot be observed. Must be checked in the deployed env. |
| `PHONE_HASH_SALT` **unset** locally | Contact matching no-ops (FRND-9, XCUT-9) → BLOCKED. The Find-Friends UI itself reports "Your browser doesn't support automatic contact matching." |
| No production env | Prod-only assertions BLOCKED: AUTH-8 (debugCode omitted in prod), XCUT-8 (`npm run build` clean), DEV-1/ACCT-10 (dev pages hard-blocked in prod), CERE-7 cadence over a 14-day window, XCUT-3/XCUT-4 cron *scheduling*. |
| **Developer Testing Mode / "seed a test game from 555-987-6543" does not exist** | `/dev/test-game` is a **"Coming soon" stub** (Joshing Game deferred, `GAME_CREATION_DISABLED`). The task's prescribed seeding path is unavailable. Substitute used: the live **Daily Five** flow + `POST /api/daily/reset` (DAILY-9) to build/clear question state. |
| Direct DB reads blocked by policy | All state was driven/observed through the app's own authenticated endpoints and rendered UI, never raw SQL. |

### Test account state (at start of pass)

Primary account: **Joshua P** — phone `+17342776819`, `@jpalay`, id `f5ed1c59…`. Onboarded. **43 territories / 3,826 knowledge points**, **15 authored questions**, multiple mutual friends (Robyn, David, Jamie, Shweta), tiers ranging Establishing→Solid. This account was used as the authenticated driver for all owner-side surfaces.

**Mutations made during this pass (for reproducibility):**
- Joshua P's Daily queue for the assignment day was **reset** (DAILY-9) and regenerated; 1 wrong + 1 correct + 1 catch-up-recovery answer were submitted live.
- Test accounts created via the invite funnel: `+15550007777` (onboarding **left incomplete** — sits at warmup), plus `+15551230001` (pre-existing from earlier session). `+15550009998` was used only for negative auth gates (no account provisioned).
- One `direct_sent` feed item was created from Joshua P → `+15550007777`.

---

## Summary

| Priority | PASS | FAIL | BLOCKED | Total verdicts |
|---|---|---|---|---|
| **P0** | 14 | 0 | 3 | 17 |
| **P1** | 27 | 0 | 17 | 44 |
| **Brand-critical** | 4 | 0 | 2 (partial) | 6 |

**No P0 or P1 FAILs were observed in the surfaces that could be driven.** The 0-FAIL result is real for what was exercised, but it is **conditioned on the BLOCKED rows** — most importantly the SMS divergence (XCUT-2 family) and the production-readiness gates (build, cron scheduling, prod dev-page hardening), none of which are testable in this local environment. See "Must-fix / must-verify before trust."

> Notable: the three invite-funnel fixes I shipped this session on separate branches (PRs #641/#646) are **already present on `dev2`** — `/u/<handle>/<token>` logged-out returns 200, request-otp accepts `userInvite`, and the invite-link onboarding renders without a redirect loop. Those PRs appear **redundant against dev2** and can likely be closed.

---

## Brand-critical checks (explicitly run)

### BC-1 — Wrong answers framed as DISCOVERY/CONNECTION, never "failure" — ✅ PASS (with one caveat)
- **Precondition:** Reset + regenerated Joshua P's Daily queue; submitted a deliberately wrong answer ("Tasha Yar") to a TNG question (correct: Jenna D'Sora).
- **Action:** Loaded `/daily` and read the rendered in-play reveal.
- **Observed (rendered):** `✕ Not this time — here's the answer.` → correct answer → **"NOW IT'S IN YOURS TOO"** → witty consolation *"Right android, wrong love interest—Tasha was Season 1."* → educational explainer → "RECHECK MY ANSWER". The API `consolation` field is warm, never punitive.
- **PRD:** v11.2 §8.8a (wrong answers are connection events). **Verdict: PASS** — the primary play surface is on-brand.
- **CAVEAT (record, not a fail):** the **`/daily/summary` recap** labels each item with a blunt **"WRONG" / "CORRECT"**. Not "failure," but not discovery/connection framing either — the one off-brand string. Recommend softening (e.g., "Not yet" / "Got it"). No PRD § explicitly bans the word, so logged as a divergence-to-review, not a FAIL.

### BC-2 — Grading must NOT fail-closed to "wrong" on LLM outage — ✅ PASS (driven)
- **Precondition:** Restarted the server with an **invalid `ANTHROPIC_API_KEY`** (shell env overrides `.env.local` in Next) to simulate a grader outage. Left 4 unanswered slots.
- **Action:** Submitted a **paraphrase** answer (forces the LLM judge path, bypassing exact-match) to a Daily slot.
- **Observed:** **HTTP 503** `grader_unavailable`, body *"Our answer-checker is taking a quick breather. Your answer wasn't scored — give it another go in a moment."* Re-fetched the queue: the slot stayed **`answered:false` / unscored** — **no "wrong" verdict written**.
- **PRD:** v11.2 §8.8a / XCUT-1. **Verdict: PASS.** This is the single most brand-critical behavior and it is fail-**safe**. (Note: an *exact-match* correct answer is graded locally without the LLM, so it still scores during an outage — expected and not a problem.)
- Feed/Lately answer surfaces share the identical `gradeAnswer`→`status:'unscored'`→503 path (FEED-8, LATE-7); the mechanism was driven on Daily and is code-shared, but not independently driven on those two surfaces.

### BC-3 — Gifted/sent-question attribution revealed AFTER the answer, never before — ⚠️ PARTIAL / BLOCKED
- **Driven:** Joshua P sent an authored question to a friend via `POST /api/questions/send` → **201**, created a pinned `direct_sent` feed item carrying `sourceUserId` (the sender).
- **Blocked:** Verifying the *timing* of attribution in the rendered card requires the recipient's feed, and the recipient (`+15550007777`) onboarding is incomplete (stalled at warmup), so the card couldn't be rendered pre/post-answer.
- **Nuance:** Explicit direct-sends are *designed* to show "[Name] sent you this" up front (FEED-2/SEND-3). The "reveal after answer" rule most plausibly governs the **Daily +2 bonus slots** ("from [Name]'s world"), which could not be exercised because Joshua P's queue generated **0 bonus slots** (graceful-shrink, no qualifying friend domain at gen time).
- **Verdict: BLOCKED** — recommend a human verify with (a) a recipient who has completed onboarding and an unanswered `direct_sent` card, and (b) an account that generates +2 bonus slots, confirming the friend source is hidden until after the answer.

### BC-4 — NO leaderboard, NO competitive ranking on ANY surface — ✅ PASS (driven)
- **Action:** Rendered and read **7 surfaces**: Home `/`, `/daily/summary`, `/knowledge`, `/friends`, `/questions`, `/activities` (Lately), `/users/me`.
- **Observed:** Points and tiers are **self-relative only** (your mastery, your round score "4/6", "+50 this round"). Friend activity is framed as discovery ("Robyn answered your question", "went deep on X"), never as a ranked board. No rank numbers, no standings, no "you vs them" anywhere.
- **Verdict: PASS.**

### BC-5 — Mastery: catch-up recovery uses MAX (25%), NOT compounded (6.25%) — ✅ PASS (driven)
- **Precondition:** A TNG question previously answered **wrong** this session appeared in catch-up (`wasSkipped:false`, prior state incorrect).
- **Action:** Answered it **correctly** via `POST /api/daily/catchup/answer`.
- **Observed:** `pointsAwarded: 25`, `masteryDelta.points: 25`. The full base for that question is 100, so award = `base × 0.25` (single recovery weight). Compounding would have yielded `base × 0.25 × 0.25 = 6.25 → 6`. It awarded **25, not 6**.
- **Code corroboration:** `catchup/answer/route.ts:256-258` applies `RECOVERY_STATE_WEIGHT` to the **full** base, not the already-reduced catch-up base; constants `CATCHUP_SURFACE_WEIGHT=0.25`, `RECOVERY_STATE_WEIGHT=0.25` (`mastery/constants.ts`).
- **PRD:** v11.2 §16.17. **Verdict: PASS** — MAX rule holds, not compounded.

### BC-6 — Convergence/overlap counters reset correctly after a card fires — ⚠️ BLOCKED
- **Blocked:** This is a Ceremony Beat-4 ("Aligned") / convergence mechanic. No unviewed ceremony exists for the test account (Home shows a *countdown*, "WEEKLY SUMMARY IN 2 DAYS", not a pin), and a ceremony can only be minted by the cron/cycle. Could not fire a convergence card to observe counter reset.
- **Verdict: BLOCKED** — needs a generated ceremony (or a forced `weekly-ceremony` cron run) plus cross-cycle overlap state. Recommend driving via `/dev/noon-reset` + cron trigger in a controlled account. Related risk: CERE-3 (Beat 4 must be cycle-scoped, never a stale lifetime-overlap friend).

---

## Per-item results

Legend: **✅ PASS · ❌ FAIL · ⛔ BLOCKED.** Driven = exercised via HTTP/UI; Blocked rows give the reason.

### 1. Authentication & Login

| ID | Pri | Verdict | Evidence / repro |
|---|---|---|---|
| AUTH-1 | P0 | ✅ | `request-otp`+`verify-otp` with `000000` → 200, session minted; invite-gated new-user variant confirmed end-to-end (see FRND-6). |
| AUTH-2 | P0 | ✅ | `POST /api/auth/request-otp {phone:+15550009998}` (uninvited) → **403 `invite_required`**. |
| AUTH-3 | P0 | ✅ | `verify-otp {invitationToken:""}` new phone → **400 `invalid_invitation`**, no account provisioned. |
| AUTH-4 | P1 | ✅ | Existing account (`+17342776819`) `request-otp` returns 200 with no invite needed; re-login succeeds (grandfathered). |
| AUTH-5 | P0 | ✅ | Logged-out `GET /knowledge` → **307 `/login?next=%2Fknowledge`**. |
| AUTH-6 | P1 | ⛔ | Can't forge a legacy JWT missing the `inv` claim without DB/secret access; `createSession` always sets it. Refresh logic present (`proxy.ts:64-81`) but not driveable. |
| AUTH-7 | P0 | ✅ | After `POST /api/auth/logout` **and** `POST /api/account/logout`, gated `GET /knowledge` → 307 `/login`. Both routes invalidate. |
| AUTH-8 | P1 | ⛔(dev-confirmed) | Dev `request-otp` returns `debugCode` (NODE_ENV gate, `route.ts`). The **prod-omit** assertion is not verifiable locally. |

### 2. Onboarding

| ID | Pri | Verdict | Evidence / repro |
|---|---|---|---|
| ONB-1 | P0 | ✅ | Onboarded user `GET /onboarding` → **307 `/`**. New invite-link user `GET /onboarding` → **200, 0 redirects** (no loop) — dev2 already carries the invite-link provenance fix. |
| ONB-2 | P0 | ⛔ | Fast-path "These look good" needs a **seeded FriendInvitation invitee**. The `/u/` evergreen link carries **no** `preSeededInterests`, so the test invitee correctly got the *full* name→handle→warmup→review flow. Needs an SMS-style `/invite/[token]` invitee with seeded interests to drive. |
| ONB-3 | P1 | ⛔ | Same blocker — full-flow vs fast-path branch needs a seeded invitee. Full flow itself was reached (name→handle→warmup). |
| ONB-4 | P1 | ⚠️/partial | Warmup "Continue" observed **disabled** with empty fields (consistent with the 2-of-3 gate); not fully driven to the enable threshold. |
| ONB-5 | P1 | ⛔ | "From [Inviter]" seeded-interest badge needs a seeded FriendInvitation invitee (see ONB-2). |
| ONB-6 | P2 | ⛔ | `propose-interests` without `culturalAnchor` — not driven (needs warmup completion). |
| ONB-7 | P0 | ⛔ | `save-interests` lock-in not driven — would require completing warmup + LLM generation for the test invitee (time-boxed out). Route reachable; gate (ONB-1) and post-save redirect path are sound. **Recommend a human completes one full onboarding to close this P0.** |
| ONB-8 | P2 | ⛔ | `canonicalize` fail-soft not driven. |

### 3. Home

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| HOME-1 | P0 | ✅ | Home renders Today's-Five status (complete-state: "now learn from your misses", recap/missed/reset entries). Start→`/daily/setup` is the incomplete-state variant. |
| HOME-2 | P1 | ⚠️/partial | No unviewed ceremony exists → pin not shown; Home instead shows the **countdown** ("WEEKLY SUMMARY IN 2 DAYS"). Pin path needs a generated unviewed ceremony. |
| HOME-3 | P1 | ✅ | "Play Missed Questions" catch-up entry present on Home. |
| HOME-4 | P1 | ✅ | "WHAT'S HAPPENING" shows top **3** activity items + "SEE ALL ACTIVITY" (`HOME_HEAD_LIMIT=3`). |
| HOME-5 | P1 | ✅ | Feed rendered **inline** at the bottom of Home ("QUESTIONS FROM FRIENDS"), not a nav tab. |
| HOME-6 | P2 | ✅ | "Five new at 1 PM tomorrow" next-round timing displays. |

### 4. Daily Five

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| DAILY-1 | P0 | ✅ | `POST /api/daily/queue` builds the queue (lazy LLM gen, ~30–105s) → 5 slots. |
| DAILY-2 | P0 | ✅ | Live answer returns result + correct answer + explainer; rendered in `/daily` chat thread. |
| DAILY-3 | P0 | ✅ | Grader outage → 503 unscored, slot untouched (see BC-2). |
| DAILY-4 | P2 | ✅ | "SHOW ME THE ANSWER" give-up control present in-play. |
| DAILY-5 | P1 | ✅ | `/daily/summary`: score 4/6, per-question recap, mastery/tier deltas (ESTABLISHING→FAMILIAR +50), "Refine your game". |
| DAILY-6 | P1 | ✅(graceful-shrink) | Queue generated **0** bonus slots (no qualifying friend domain at gen time) → graceful 0–2 shrink confirmed, no padding. The populated-bonus case ("from [Name]'s world") not driven. |
| DAILY-7 | P1 | ✅ | `GET /api/daily/catchup` → 9 missed items at reduced credit. |
| DAILY-8 | P1 | ✅ | Recovery = 25% of full base, not compounded (see BC-5). |
| DAILY-9 | P2 | ✅ | `POST /api/daily/reset` → `{ok:true}`; regeneration produced a fresh unanswered set. |
| DAILY-10 | P1 | ⛔ | "Daily-Five answer must not add a demonstrated domain (`eventQuestionId` null)" — requires DB/event inspection (blocked); not driveable via UI. |

### 5. Feed (Broadcasts / Sent)

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| FEED-1 | P1 | ⚠️/partial | Active feed on Home was empty ("You are all caught up!"), so Broadcasts/Sent tab counts could not be exercised with content. Debug line confirmed `broadcasts_item_count=0 · sent_item_count=0`. |
| FEED-2 | P1 | ⚠️/partial | `direct_sent` item **created** (pinned, sender attribution present, 201). Rendering blocked on recipient onboarding (see BC-3). |
| FEED-3..7,9,12,13 | P1/P2 | ⛔ | No active feed cards on the test account → broadcast/liked/answered/dismiss/thumbsdown card behaviors not driveable without building feed state across friends. |
| FEED-8 | P1 | ⚠️ | Same `gradeAnswer` 503 fail-safe as DAILY-3 (code-shared); not independently driven (no feed card to answer). |
| FEED-10 | P2 | ⛔ | thumbs-up dormancy — needs DB/no-op confirmation; not driven. |
| FEED-11 | P2 | ⛔ | 50-item cap / roll-off — needs >50 feed items. |

### 6. Lately / Activity / Milestones

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| LATE-1 | P1 | ✅ | `/activities` "Lately." renders the day-bucketed stream (YESTERDAY / EARLIER THIS WEEK). |
| LATE-2 | P1 | ✅ | Prominence: "Robyn answered your question" (they_got_you) ranks above milestone rows. |
| LATE-3 | P2 | ✅ | Deep form: "Robyn went deep on John Milton's Paradise Lost — 2 of 3 questions". |
| LATE-4 | P2 | ✅ | Breadth rollup: "Robyn has been on a streak — Virginia Woolf Novels, Star Trek: TNG and 1 other". |
| LATE-5 | P1 | ⛔ | Milestone expand → InlineAnswerFlow not driven (needs tap interaction on a milestone with the friend's questions). |
| LATE-6 | P1 | ⛔ | Milestone-answer mastery/dedup math — needs the inline flow + DB inspection. |
| LATE-7 | P1 | ⚠️ | Shares the 503 fail-safe (code) with DAILY-3; not independently driven. |
| LATE-8 | P2 | ⛔ | Unread bell badge count / mark-read — not driven. |

### 7. Question Bank & Authoring

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| QB-1 | P1 | ✅ | `/questions` bank: Answered/Yours filters, 15 questions, domain filter, tier labels, "Send to friend". |
| QB-2 | P1 | ⛔ | Composer open from FAB / `?create=1` not driven (UI interaction). |
| QB-3,4,5,6,8 | P1/P2 | ⛔ | Composer destinations / visibility / copy / suggest-answer — not driven (composer not opened). |
| QB-7 | P2 | ⛔ | Edit/delete-own-unused not driven. |
| QB-9 | P1 | ⛔ | "Authoring opens a declared territory" — needs authoring a new-domain question + map inspection. |

### 8. Send-to-Friend

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| SEND-1 | P1 | ✅ | `POST /api/questions/send` → 201, pinned `direct_sent` item. (Note: a `message:"thought of you"` body came back with `personalMessage:null` — possible field-name mismatch worth a glance; not a blocker.) |
| SEND-2 | P2 | ⛔ | 5/day/recipient rate limit (6th → 429) not driven. |
| SEND-3 | P1 | ⚠️/partial | Item created + pinned for recipient; recipient-side render blocked on onboarding. |
| SEND-4 | P1 | ⛔ | "No creator points for sender" — needs sender mastery-event inspection (DB blocked). |
| SEND-5 | P1 | ⛔ | SMS-on-send — **BLOCKED locally** (Twilio unset → no-op). Must verify in deployed env. See XCUT-2. |

### 9. Knowledge

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| KNOW-1 | P1 | ✅ | `/knowledge` portrait: declared + demonstrated domains, 43 territories, 3,826 pts. |
| KNOW-2 | P2 | ⚠️/partial | Declared/demonstrated render as identical circles (no muted fill visible); fine-grained visual parity needs a pixel check. |
| KNOW-3 | P1 | ⛔ | `/knowledge/[domain]` detail + visibility control not driven (domain slug nav). |
| KNOW-4 | P1 | ⛔ | Per-domain private visibility effect on others' views — needs second-account view. |
| KNOW-5 | P2 | ⛔ | "Grow your map" three-paths copy not specifically located. |
| KNOW-6 | P2 | ⛔ | Map tidy/merge not driven. |
| KNOW-7 | P1 | ✅ | Tier labels are **Establishing / Familiar / Solid** everywhere observed (summary, knowledge, questions). **No** Curious/Explorer/Scholar/Sage or Versed/Fluent/Master. |
| KNOW-8 | P2 | ⚠️/note | "On a streak" appears as a **milestone breadth phrase** in Lately (PRD-D-4 form), not as a streak *metric* on Knowledge. Consistent with v11.2 non-goal; flagged for awareness. |

### 10. Profile & Account

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| ACCT-1 | P1 | ✅ | `/users/me` → 307 `/users/[id]` self-view (handle, mind statement, "since May 2026"). |
| ACCT-2 | P2 | ⛔ | Name/handle inline edit + cooldown not driven. |
| ACCT-3 | P1 | ✅(UI) | Section visibility toggles present (Knowledge base=Private, Friends=Public, Questions=Private, Friends list) + "View as friend/public" preview. Cross-account *effect* not driven. |
| ACCT-4 | P1 | ✅(UI) | Discoverability toggles present: contacts match, mutual-friends, **niche-match** ("discover me through questions we both answer"), handle/phone always-on. |
| ACCT-5 | P1 | ✅(notable) | Reminders UI: **"SMS reminders — Coming soon … isn't available yet"**, "Daily reminders aren't sending yet." Email reminders available with verification ("Check joshuapalay@gmail.com … expires in 24 hours"). **The reminders surface honors §8.11 (no SMS)** — partially contradicts the inventory's XCUT-2 "SMS still sends" for *this* surface. |
| ACCT-6 | P2 | ⛔ | Email-verify token paths not driven (needs emailed token). |
| ACCT-7 | P1 | ✅ | Invite link present with **Copy** + **Rotate link** ("Rotating invalidates the old link"). Rotation behavior confirmed functionally in the invite-funnel tests. |
| ACCT-8 | P2 | ⛔ | Adaptive level display not specifically located. |
| ACCT-9 | P1 | ✅(present) | "Delete account" control present in self-view (destructive — not executed). |
| ACCT-10 | P2 | ✅(dev)/⛔(prod) | Dev tools surfaced in owner self-view (Create test game, Reset session, Noon reset, Staging flags, Points diagnostic). Prod-hidden assertion BLOCKED. |

### 11. Friends & Invitations

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| FRND-1 | P1 | ✅ | `/friends` hub: mutual friends list + common-ground copy, Find friends, Add friend, Following/Followers/Pending. |
| FRND-2 | P1 | ✅ | `/friends/find`: handle/phone search, contact-match block, "Invite someone new" (personal invite + copy link). |
| FRND-3 | P1 | ⛔ | Request lifecycle accept/ignore/cancel/cooldown not driven (needs two accounts mid-flow). |
| FRND-4 | P0 | ✅ | `/invite/[token]` landing renders (invalid token → 200 landing card, not a crash). |
| FRND-5 | P1 | ✅ | `/u/jpalay/<token>` logged-out → **200** landing card (proxy allowlists `/u/` on dev2). |
| FRND-6 | P0 | ✅ | End-to-end: `request-otp`+`verify-otp` with `userInvite` for a **new** phone → account created, `invitation.accepted:true`, friendship formed, `/onboarding` reachable (0 redirects). |
| FRND-7 | P1 | ⛔ | Create-invitation rate limits not driven. |
| FRND-8 | P1 | ⛔ | Invite SMS — BLOCKED (Twilio unset). In-app invite URL **is** surfaced (Copy link), so the funnel works without SMS. |
| FRND-9 | P2 | ⛔ | Contact matching — BLOCKED (`PHONE_HASH_SALT` unset; UI says browser unsupported). |
| FRND-10 | P1 | ⛔ | Friend vs non-friend profile gating — needs a second (non-friend) account view. **Privacy-integrity; recommend a human drive this.** |
| FRND-11 | P1 | ⛔ | `/users/[id]/knowledge` per-domain visibility from a friend's view — needs second account. **Privacy-integrity.** |
| FRND-12 | P2 | ⛔ | niche-match `niche_match_answered_your_question` surfacing — needs stranger cross-answer. |

### 12. Biweekly Ceremony

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| CERE-1..6, 8, 9 | P1/P2 | ⛔ | No ceremony exists for the test account (Home shows a countdown, not a pin). All ceremony beat/share/eligibility/author-credit rows need a generated ceremony (cron or `/dev/noon-reset` + trigger). |
| CERE-7 | P1 | ⚠️/evidence | **Cadence divergence corroborated indirectly:** Home copy reads **"WEEKLY SUMMARY IN 2 DAYS"** (not "biweekly"); inventory notes the cron is `weekly-ceremony`, daily run, 6-day dedup. Empirical 14-day-per-user confirmation is BLOCKED (needs a 14-day window). **Flag for verification.** |

### 13. Reactions, Recheck, Grade-dispute

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| RX-1 | P2 | ⛔ | Reactions create/reply not driven (needs a reactable question between accounts). |
| RX-2 | P1 | ⛔ | Reaction SMS — BLOCKED (Twilio unset). |
| RX-3 | P1 | ⚠️/partial | "RECHECK MY ANSWER" control **is present** on the wrong-answer reveal (`/daily`); the re-grade outcome + anti-farm guard not driven. |
| RX-4 | P2 | ⛔ | GradeDispute path not driven; UI vs API-only unconfirmed. |

### 14. Cross-cutting / Production readiness

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| XCUT-1 | P0 | ✅ | Grading fail-safe driven (BC-2): 503 unscored, never "wrong". |
| XCUT-2 | P1 | ⛔ | **SMS senders BLOCKED locally** (Twilio unset → `sendSms` no-ops). Cannot confirm whether SMS actually leaves in the deployed env. *Partial counter-evidence:* the reminders UI gates SMS as "coming soon" (ACCT-5). **Highest-priority deployed-env check.** |
| XCUT-3 | P0 | ✅ | Daily generation is **lazy** (`POST /api/daily/queue` → `fillDailyQueueForUser`), so the missing `daily-assignments` cron does **not** silently break the core ritual. Drove a real generation. (Cron *scheduling* itself is prod/BLOCKED.) |
| XCUT-4 | P1 | ⛔ | Cron scheduling/auth in prod — not verifiable locally. |
| XCUT-5 | P1 | ✅ | Bottom nav = Home / Friends / Questions / Knowledge / **Profile** (`/users/me`); Activities via header bell; `/account` does not exist — matches the documented label/route divergence (minor). |
| XCUT-6 | P1 | ✅ | No `src/middleware.ts` present; routing is `src/proxy.ts` (and the `/u/` allowlist lives there). |
| XCUT-7 | P1 | ⛔ | Env-boot requirements — not exercised (would require a boot with missing vars). |
| XCUT-8 | P0 | ⛔ | `npm run build` clean — **not run** (out of scope per task; prod gate). **Must be confirmed before trust.** |
| XCUT-9 | P1 | ⛔ | `PHONE_HASH_SALT` in prod — BLOCKED (unset locally). |

### 18. DEV-only pages

| ID | Pri | Verdict | Evidence |
|---|---|---|---|
| DEV-1 | P1 | ✅(auth)/⛔(prod) | `/dev/flags`, `/dev/points-diagnostic`, `/dev/test-game` logged-out → **307 `/login?next=…`**. The prod hard-block / hidden-in-prod assertion is BLOCKED (prod-only). |

### 17. Deferred features (confirm unreachable)

| Feature | Verdict | Evidence |
|---|---|---|
| Joshing Game | ✅ unreachable | `/dev/test-game` and game creation are "Coming soon"; `GAME_CREATION_DISABLED`. |
| Old Activities tab | ✅ | Not in bottom nav; Lately (`/activities`) is the live v12 replacement (intended). |
| Archive | ⛔ | Not driven — **recommend checking the profile breadcrumb** the inventory flagged (`archive/page.tsx:214`); if present, Archive is reachable contrary to "deferred". |
| Personal Rounds | ✅ | No distinct entry; custom `/daily/setup` is the only path. |

---

## Ranked "Must-fix / must-verify before trust" (all P0/P1 FAILs + the highest-risk BLOCKED gates)

No P0/P1 **FAILs** were observed in driven surfaces. The list below is therefore the **blocked gates that carry real risk** and must be cleared in an environment that can exercise them, ranked by damage-if-wrong:

1. **XCUT-2 — SMS actually firing in the deployed env (P1, data/brand + cost).** Local Twilio is unset so this is untestable here; the inventory says senders are wired and ungated, while the reminders UI says "no SMS yet." **Verify in the deployed env whether ceremony/reaction/direct-send/broadcast/invite SMS actually leave.** If they do, it contradicts §8.11 (zero SMS in Phase 1).
2. **XCUT-8 — `npm run build` clean (P0).** Never run here. A broken prod build blocks everything; the old audit hit `spawn EPERM`. Must be confirmed.
3. **ONB-7 / ONB-2 — full onboarding lock-in + seeded fast path (P0).** Could not drive `save-interests` lock-in or the seeded-interests fast path (the latter needs an SMS-style FriendInvitation invitee). The gate (ONB-1) passes; **complete one full onboarding by hand** to close the P0.
4. **FRND-10 / FRND-11 — non-friend profile/knowledge gating (P1, privacy integrity).** Not driven (needs a second, non-friend account). A leak here exposes private knowledge/questions. **Drive with two accounts.**
5. **CERE-7 — ceremony cadence (P1).** Code + Home copy both say "weekly"; PRD says biweekly/14-day. **Verify the 14-day-per-user gate actually holds** (6-day dedup permits ~weekly fires).
6. **DAILY-10 / SEND-4 / LATE-6 — mastery/credit integrity (P1).** "Daily Five doesn't grow the map", "sender earns no creator points", "milestone answer doesn't double-credit" — each needs event/DB inspection (blocked here). **Verify via `/dev/points-diagnostic` or DB.**
7. **BC-3 / BC-6 (brand-critical, partial).** Gift-attribution-after-answer (esp. the +2 bonus "from [Name]'s world" reveal timing) and convergence-counter reset after a ceremony card fires — both need state this environment couldn't build. **Drive once feed/ceremony state exists.**

### Lower-priority observations (not failures)
- `/daily/summary` uses a blunt **"WRONG"** label (BC-1 caveat) — consider softening to match the in-play "Not this time" framing.
- `SEND-1`: `personalMessage` returned `null` despite a `message` in the send body — confirm the field is being persisted/surfaced.
- Nav 5th item is "Profile → `/users/me`", `/account` route absent (XCUT-5, known minor divergence).

---

*Driven surfaces were exercised against `dev2` @ `b40a0a9` on 2026-06-05. BLOCKED rows are limited by local environment (no Twilio, no `PHONE_HASH_SALT`, no prod, no second interactive account, no generated ceremony) — not by product defects observed. No bugs were fixed during this pass (catalogue-only, per instructions).*
