# D-AUTH-LOGIN-INVITE-AUDIT-01 — Login & Invitation Flow Audit (READ-ONLY)

**Date:** 2026-06-16
**Status:** Ground-truth audit. No code changed. No fixes proposed.
**Scope:** What `/login` and the invitation flow do **today**, file-grounded. Code wins over PRD prose on every conflict.

---

## 1. File inventory (Phase 0)

### `/login` page + its components

| Path | Role |
|---|---|
| `src/app/login/page.tsx` | Server component. Reads invite params from `searchParams`, resolves the invite **server-side** (`getInvitePrefillByToken`, `resolveInviteLink`), passes `invitePrefill` + `inviteContext` to the client panel. |
| `src/app/login/LoginPanel.tsx` | `'use client'`. The entire multi-step form (`invite` → `phone` → `code` → `profile`). Owns all OTP request/verify fetches. |
| `src/components/TriangleBackground.tsx` | Visual chrome only (rendered by `page.tsx`). |

### Auth API routes under `src/app/api/auth/`

| Path | Role |
|---|---|
| `request-otp/route.ts` | `POST` — phone/invite gate, calls `requestOtp()`. |
| `verify-otp/route.ts` | `POST` — verifies code, mints session, provisions account, accepts invitation. |
| `logout/route.ts` | Logout. |
| `me/route.ts` | Current-user lookup. |
| `refresh-session/route.ts` | Re-mints legacy JWT to add `inv` claim. |
| `refresh-onboarding-claim/route.ts` | Re-mints JWT to add `onb` claim. |

### Invite-link entry points

| Link kind | URL the link points at | Handler | Redirects to |
|---|---|---|---|
| **FriendInvitation** (per-invite token, SMS-style) | `/invite/<token>` | `src/app/invite/[token]/page.tsx` | `/login?invitationToken=<token>` (only when status `valid`) |
| **Per-user evergreen link** (B-Friends-3) | `/u/<handle>/<token>` | `src/app/u/[handle]/[token]/page.tsx` | `/login?inviteHandle=<handle>&inviteUserToken=<token>` (only when logged-out) |

Generation side:
- FriendInvitation URL is built in `src/app/api/friend-invitations/route.ts:611` — `${baseUrl}/invite/${invitation.token}`. The message text is built but **no SMS is sent** — it is returned to the inviter's client to share manually (see §D).
- Per-user link is built in `src/server/friends/user-invite-token.ts:86-90` (`buildInviteUrl` → `/u/<handle>/<token>`), surfaced via `/api/account/invite-token`.

### Pending-invitation / OTP-store call sites

- `getInvitePrefillByToken` — `src/server/friends/invitations.ts:196`; called in `login/page.tsx:60`, `request-otp/route.ts:53`, `verify-otp/route.ts:155`.
- `hasValidPendingInvitationForPhone` — `invitations.ts:330`; called only in `request-otp/route.ts:95`.
- `getValidInvitationForPhone` — `invitations.ts:352`; called in `verify-otp/route.ts:237`.
- `acceptFriendInvitation` — `invitations.ts:533`; called in `verify-otp/route.ts:189,252`.
- `resolveInviteLink` / `acceptUserInviteLink` — `user-invite-token.ts:102,149`; called in `login/page.tsx:62`, `request-otp/route.ts:98`, `verify-otp/route.ts:201,269`.
- `requestOtp` — `otp-store.ts:22`; called in `request-otp/route.ts:61,112`.
- `verifyOtp` — `otp-store.ts:34`; called in `verify-otp/route.ts:169`.

### ORM / convention confirmation

- **Drizzle, not Prisma** — confirmed (`drizzle-orm` imports throughout; schema at `src/server/db/schema.ts`).
- DB access in the auth routes is **partly inline**, not all via `src/server/db/queries/`:
  - `request-otp/route.ts:88-92` runs an inline `db.select(...).from(users)` existing-user lookup.
  - `verify-otp/route.ts:64-68, 91-96` runs inline `findUserByPhone` / `provisionUserForPhone` selects+insert.
  - These read/write `users` directly from the route handler rather than from `src/server/db/queries/`. Flagged per the prompt; not a behavioral finding.
- Tables: `OtpCode` (`schema.ts:281`), `FriendInvitation` (`schema.ts:1205`), `users.invite_token` (`schema.ts:227`).

---

## 2. As-built flow diagrams (prose, with file/line refs)

### (a) Invite-link new player — FriendInvitation path

1. Invitee taps `/invite/<token>`. `invite/[token]/page.tsx:27` calls `getFriendInvitationLandingByToken`. If `status === 'valid'`, `page.tsx:32` server-redirects to `/login?invitationToken=<token>`. (Expired/accepted/invalid render a static card instead — no redirect.)
2. `proxy.ts:41-42,57` lets the logged-out request through (`/invite/` and `/login` are both pre-auth-allowed).
3. `login/page.tsx:55,60` reads the token and calls `getInvitePrefillByToken(token)`. If the invite is still actionable **and has a recipient phone**, it returns `{ inviterName, inviterUserId, inviterAvatarColor, inviteePhone (server-only), maskedPhone }` (`invitations.ts:196-232`). Only `maskedPhone` + inviter fields cross to the client (`login/page.tsx:64-71`); the raw phone never leaves the server.
4. `LoginPanel` initial step is chosen at `LoginPanel.tsx:197`: `useState<Step>(invitePrefill?.maskedPhone ? 'invite' : 'phone')`. With a resolved prefill, the first screen is the **`invite` step** — a confirmation card reading "*{inviter} invited you to Joshing*" + "*We'll text a code to `(xxx) •••-1234`*" with a **"Send code"** button (`LoginPanel.tsx:586-644`). **There is no field for the invitee to enter or confirm their phone number.**
5. Tapping **Send code** → `sendCodeToInvitePhone` (`LoginPanel.tsx:351`) → `POST /api/auth/request-otp` with `{ invitationToken, useInvitePhone: true, userInvite }` and **no phone**. The server resolves the recipient phone from the token (`request-otp/route.ts:52-61`), calls `requestOtp(prefill.inviteePhone)`, returns `{ ok, maskedPhone, debugCode? }`.
6. Panel sets `invitePhoneMode = true` and advances to the **`code` step** (`LoginPanel.tsx:384-385`), which shows "Enter your code for `(xxx) •••-1234`" (`LoginPanel.tsx:702-710`).
7. Invitee types a code → `verifyCode` (`LoginPanel.tsx:427`) → because `invitePhoneMode && invitationToken`, it sends `buildInviteVerifyOtpRequestBody` (`LoginPanel.tsx:439-441,83-94`): `{ code, invitationToken, useInvitePhone: true, userInvite }` — **still no phone from the client.**
8. `verify-otp/route.ts:154-160` re-resolves the recipient phone from the token, then `verifyOtp(phone, code)` (`route.ts:169`). `000000` is accepted unconditionally (`otp-store.ts:37-39`).
9. No existing user → invite gate re-checked (`getValidInvitationForPhone`, `route.ts:236-245`) → `provisionUserForPhone` (`route.ts:247`) → `acceptFriendInvitation` (`route.ts:252`) → `createSession(..., { invitationAccepted: true, onboardingComplete: false })` (`route.ts:276`).
10. Client reads identity; new accounts have no display name/handle → `shouldCollectProfileIdentity` true → **`profile` step** (`LoginPanel.tsx:465-468`). On save → `router.replace('/')`.

### (b) Invite-link new player — per-user link path (`/u/<handle>/<token>`)

Same as (a) except:
- `u/[handle]/[token]/page.tsx:48` resolves via `resolveInviteLink`. Logged-out → redirect to `/login?inviteHandle=...&inviteUserToken=...` (`page.tsx:114`).
- This token is **not phone-targeted**, so `getInvitePrefillByToken` returns nothing → **no `invitePrefill.maskedPhone`** → initial step is **`phone`** (`LoginPanel.tsx:197`). The invitee **does** type their phone here (`continueWithPhone`, `LoginPanel.tsx:391`), which forwards `{ phone, userInvite }`. The link itself satisfies the invite gate at `request-otp/route.ts:96-100` via `resolveInviteLink`.
- An `inviteContext` card still renders above the phone field (`LoginPanel.tsx:654`).

### (c) Cold `/login` visit (no invite context)

1. `proxy.ts`: unauthenticated + `/login` → passes through (`proxy.ts:57`).
2. `login/page.tsx`: no token params → `prefill = null`, `inviteContext = null`.
3. `LoginPanel.tsx:197`: no `maskedPhone` → initial step = **`phone`**. First thing shown is the phone-number field + "What is your phone number?" (`LoginPanel.tsx:646-676`).
4. `continueWithPhone` → `POST /api/auth/request-otp` with `{ phone, userInvite: null }`. With no existing account and no invitation, the gate returns **403 `invite_required`** (`request-otp/route.ts:94-105`).

### (d) Returning player

1. 90-day `joshing_session` httpOnly JWT cookie (`session.ts:15-16,135`).
2. `proxy.ts:44-45` reads `inv`/`onb` straight from the JWT (no DB hit). Valid + `inv:true` + `onb:true` and hitting `/login` → redirected to `/` (`proxy.ts:94-98`).
3. If the cookie is gone/expired → treated as a cold `/login` visit (b/c above). A returning user with an existing account row that has no pending invitation **can still re-authenticate**: `verify-otp` grandfathers existing users past the invite gate (`route.ts:178-224`).

---

## 3. Answers to A–F

### A. What `/login` renders

**A1 — Cold visit, no invite context: phone field first.**
`LoginPanel.tsx:197` `const [step, setStep] = useState<Step>(invitePrefill?.maskedPhone ? 'invite' : 'phone')`. With no prefill the panel renders the `phone` branch (`LoginPanel.tsx:645-676`): a `<label>` "What is your phone number?" and a `tel` input. So a cold visit shows a **phone-number field first**, matching PRD §7.1 step 1.

**A2 — Arrival from an invitation link: phone is pre-identified server-side, shown only masked.**
- FriendInvitation: entry URL `/invite/<token>` → redirect to `/login?invitationToken=<token>` (`invite/[token]/page.tsx:32`). The recipient phone is resolved **server-side** from the token (`getInvitePrefillByToken`, `invitations.ts:196`) and **never sent raw to the client** — only `maskedPhone` (`login/page.tsx:64-71`; the type comment at `invitations.ts:43-46` states "Never expose this to the client"). It is displayed only in masked form, e.g. "*We'll text a code to `(734) •••-6819`*" (`LoginPanel.tsx:614-617`).
- Per-user link: `/u/<handle>/<token>` → `/login?inviteHandle=...&inviteUserToken=...`. **No phone is pre-identified** (the token isn't phone-bound); only inviter name/color are shown via `inviteContext`.

**A3 — Is there a phone-entry step in the invite path? CRUX.**
It depends on which invite kind:
- **FriendInvitation with a resolvable phone: NO phone-entry step.** The render branch is `step === 'invite'` (`LoginPanel.tsx:586`), whose only actions are **"Send code"** (`sendCodeToInvitePhone`, line 622) and **"Use a different number"** (line 632, which switches to the `phone` step). The invitee never sees or confirms their full number — they go invite-confirmation → code entry. The premise in the audit brief ("invite link directly to a 6-digit code-entry screen") is **substantially correct**, with the nuance that there is a one-tap confirmation interstitial (the `invite` step) before the code field; it is not literally the code field on arrival, but it is **code-first in the sense that matters: no phone possession step**.
- **Per-user link (`/u/...`): YES, phone entry happens** — initial step is `phone` because no `maskedPhone` resolves (`LoginPanel.tsx:197`).

### B. request-otp behavior

**B1 — What it validates/requires (`request-otp/route.ts`).**
- Zod body schema (`route.ts:15-35`): `phone` optional string, `invitationToken` nullish, `useInvitePhone` optional bool, `userInvite` `{handle, token}` nullish. **Phone is optional** because the invite-prefill flow sends none.
- **Invite-prefill branch** (`route.ts:52-68`): if `useInvitePhone && invitationToken`, resolve phone via `getInvitePrefillByToken`; if null → 400 `invalid_invitation`. Otherwise `requestOtp(prefill.inviteePhone)`; returns `{ ok:true, maskedPhone, debugCode? }`. **No phone normalization/US check on this path** — the phone comes from the stored invite, trusted as-is.
- **Manual branch** (`route.ts:70-106`): requires `phone`; `isUsPhoneNumber(rawPhone)` enforces US-only (`route.ts:79-84`); `normalizePhone` (`route.ts:86`). Then existing-user lookup; if none, invite pre-check `hasValidPendingInvitationForPhone(phone)` **OR** `resolveInviteLink(userInvite)` — if neither, 403 `invite_required` (`route.ts:94-105`). Success returns `{ ok:true, phone, debugCode? }`.
- **`debugCode`:** returned **whenever `NODE_ENV !== 'production'`**, on **both** branches (`route.ts:66, 117`). In production it is omitted. Note: the real generated code is returned, not literally `000000` — but since `verifyOtp` accepts `000000` unconditionally everywhere, the debugCode is moot for completing the flow.
- **No rate-limiting on this route.** `getRecentOtpRequestCount` exists in `otp-store.ts:67` but is **not called** here. (PRD §8.11 re-enable checklist item 3 flags rate-limiting as a Phase-2 to-verify.)

**B2 — Can request-otp succeed with no invitation and no account?**
No (on the manual path). The guard is `request-otp/route.ts:94-105`: if `!existingUser`, it requires `invitedByPhone || invitedByLink`, else returns 403. An existing account skips the gate. The invite-prefill branch never reaches this guard, but it required a valid token to get there.

### C. verify-otp behavior

**C1 — What counts as a valid code today.**
`verifyOtp` (`otp-store.ts:34-53`): **`if (code === '000000') return normalized;`** at `otp-store.ts:37-39` — accepted **unconditionally, in all environments including production**, with no DB lookup. Any other code must match a non-expired `OtpCode` row for that phone (`otp-store.ts:41-48`). Since no SMS is ever sent (§D), `000000` is the only code anyone can actually use.

**C2 — What a successful verify mints; does account creation depend on phone provenance?**
- Session minted via `createSession` with claims `{ inv: true, onb: ... }` (`verify-otp/route.ts:208,276`; JWT shape `session.ts:115-119` → `sid`, `inv`, `onb`, `sub=userId`, 90-day exp). `inv` is **always set true** on mint (the gate is enforced *before* minting, not encoded as a variable claim).
- Account row is created at verify time via `provisionUserForPhone` (`verify-otp/route.ts:247`, insert at `session.ts`-adjacent `route.ts:91-96`).
- **Provenance dependency:** account creation depends on **the verified phone plus an invitation gate**, but the binding is loose. For a new user, `verify-otp` requires *either* a usable `invitationToken` *or* a `userInvite` (`route.ts:229-231`). If a token is present it must match the **verified phone** (`getValidInvitationForPhone`, `route.ts:236-245`; and `acceptFriendInvitation` re-checks `inviteePhone === verifiedPhone`, `invitations.ts:566`). **But** a `userInvite` link alone satisfies the gate with **no phone binding at all** (`route.ts:265-273`) — any verified phone can provision an account if it carries a valid `/u/<handle>/<token>`. Existing users bypass the gate entirely (`route.ts:178-224`).

### D. The possession question

**D1 — What proves the invitee possesses the phone number today: nothing.**
- **Phase 1 (current, as-built):** Possession is **not proven at all.** `requestOtp` only generates + stores a code in `OtpCode` (`otp-store.ts:22-32`); **nothing sends it**. `request-otp/route.ts:108-111` carries an explicit TODO: *"when OTP goes live, send the code via SMS here … Today requestOtp() only generates + stores the code; nothing texts it."* And `verifyOtp` accepts `000000` without any lookup (`otp-store.ts:37-39`). So an invitee — or anyone holding the invite link — types `000000` and is in. The number being provisioned is whatever the **inviter** typed when creating the invite (`friend-invitations/route.ts:604-609`), never confirmed against a device the invitee controls. **Phase 1 proves nothing about phone possession.**
- **Phase 2 (deferred, hypothetical):** If `sendSms(phone, code, 'otp', …)` were wired into `requestOtp`/its caller (PRD §8.11 checklist item 1) **and** the `000000` shortcut removed/gated (item 2), then entering a code delivered by SMS to that number would prove the verifier received an SMS at that number — i.e., possession. **None of this is wired today** (`grep` confirms `sendSms` has no call site in the OTP path; its only callers are game/ceremony/reminder paths — themselves "dead spec" per §8.11).

**D2 — Does any screen claim the number is private/secure/verified?**
- The invite step tells the user "*We'll text a code to {masked}*" (`LoginPanel.tsx:615-617`) and the code step says "*Enter your code for {masked}*" (`LoginPanel.tsx:706-709`). **No text is ever sent** (§D1), so the "We'll text a code" claim is not backed by the current flow.
- The footer asserts only Terms agreement (`LoginPanel.tsx:854-867`). **No "Your number is never shared / is private / is verified" footer exists in `LoginPanel.tsx` today** — searched; the brief's example copy is not present in this component. (The masked-phone presentation does *imply* privacy, but there is no explicit privacy assertion string.)

### E. Invite token vs. phone binding

**E1 — Is an invitation bound to a phone at creation?**
- **FriendInvitation: yes, bound at creation.** `createFriendInvitation` requires `inviteePhone` (`invitations.ts:255, 293-304`); the `FriendInvitation.inviteePhone` column is `notNull` (`schema.ts:1210`). The token resolves to that phone via `getInvitePrefillByToken` (`invitations.ts:208,222`), and acceptance re-checks `inviteePhone === verifiedPhone` (`invitations.ts:566`).
- **Per-user link (`/u/<handle>/<token>`): NOT phone-bound.** It resolves only to the inviter (`resolveInviteLink`, `user-invite-token.ts:102-124`) and is an **open, evergreen token anyone with the link can redeem** with any phone. The route comment at `request-otp/route.ts:24-28` states this plainly: "the invitation is NOT phone-targeted … The link itself is the invitation credential."

**E2 — Forwarding the link to a different phone/device.**
- **FriendInvitation forwarded:** The recipient still lands on the `invite` step showing the **original invitee's masked number** and "Send code" texts (would text) **that original number**, not the forwarder's. If they tap **"Use a different number"** / "Change number" (`LoginPanel.tsx:632-642, 736-748`) and enter a *different* phone, `request-otp` runs the manual gate: `hasValidPendingInvitationForPhone(newPhone)` will be **false** (invite is bound to the original phone) and, with no `userInvite`, returns **403 `invite_required`**. So it does **not** gracefully degrade to manual entry for an *arbitrary* phone — manual entry only succeeds for a phone that itself has a pending invitation or an existing account. Even if they push through with `000000` on the original masked number, `acceptFriendInvitation` enforces `inviteePhone === verifiedPhone`. **PRD's "graceful degradation to manual entry" claim is only partially true: the UI offers the affordance, but the gate rejects an uninvited number.**
- **Per-user link forwarded:** Works for anyone — the link is the credential, any phone may redeem it (E1). This is by design (B-Friends-3).

### F. Returning player & edge paths

**F1 — Returning-player identification / cookie / daily SMS.**
- Cookie: `joshing_session`, httpOnly, `sameSite:'lax'`, `secure` in prod, **`maxAge` 90 days** (`session.ts:15-16, 131-137`). JWT also expires in 90d (`session.ts:125`).
- `proxy.ts` identifies via `readSessionClaims` reading `inv`/`onb` from the JWT — no DB read on the steady path (`proxy.ts:44-45`).
- **Daily SMS link: none exists.** Per PRD §8.11 the product sends **no SMS at all** in Phase 1; `grep` confirms no daily-reminder SMS is dispatched into a logged-in deep link. So nothing bypasses `/login` via SMS. Re-entry is: open app → valid cookie → straight in; or expired cookie → `/login`.

**F2 — "Change number" affordance.**
Two buttons, both client-only step switches that drop invite-phone mode:
- `invite` step "Use a different number" (`LoginPanel.tsx:632-642`): sets `invitePhoneMode=false`, `swapStep('phone')`.
- `code` step "Change number" (`LoginPanel.tsx:736-748`): clears the code, sets `invitePhoneMode=false`, `swapStep('phone')`.
Both land on the manual phone field. They do **not** clear the invite token from the URL — the token still rides along into `verify-otp` — but they abandon the prefilled phone, so the user must enter a number that independently passes the gate (see E2).

**F3 — `proxy.ts` redirects + loop risk.**
- Unauthenticated → API: 401 `unauthenticated` (`proxy.ts:48-54`). Page: redirect to `/login?next=…`, except `/login` + `/invite/` + `/u/` pass through (`proxy.ts:57-60`).
- Authenticated, no `inv` claim (legacy): API 401 `session_refresh_required`; page → `/api/auth/refresh-session?next=…` (`proxy.ts:64-81`).
- Authenticated + `inv:true`: API passes; pages get onboarding routing (`proxy.ts:83-113`):
  - `onb:true` + on `/login` or `/onboarding` → redirect to `/` (`proxy.ts:94-98`).
  - `onb:false` → allowed onboarding/auth paths pass; everything else → `/api/auth/refresh-onboarding-claim?next=…` (`proxy.ts:106-113`), which does one DB read, re-mints, and bounces back.
- **Loop risk noted:** an authenticated `onb:false` user whose DB row is genuinely `onboardingComplete:false` and who never completes onboarding will keep being routed to the refresh endpoint, which re-mints `onb:false` and bounces to `next`; the protective factor is that `/onboarding` and `/api/onboarding/*` are in the allow-list (`proxy.ts:88-92`), so the user lands on `/onboarding` without looping. The B-Friends-3 invite-link user is specifically protected by `hasInviteLinkFriendship` (`user-invite-token.ts:133`) being consulted in the onboarding route (per its comment) so they aren't bounced back to `/login`. No infinite loop found in the proxy itself, but the refresh-bounce is a documented redirect hop (the `inv` legacy path and the B-ROOT-404 note at `verify-otp/route.ts:51-58` reference past 404 windows from exactly this kind of hop).

---

## 4. Spec-vs-as-built table (PRD §7.1/§7.2 intent vs. code)

PRD §7.2 has no dedicated heading in the archived v11.2; §7.1 (login flow) and the invite mechanics in §6.1/§8.11 are used as the intent baseline. Code wins on conflict.

| # | PRD intent | As-built reality | Divergence | Severity |
|---|---|---|---|---|
| 1 | §7.1 step 1: "User enters US phone number on `/login`." (phone-first) | Cold visit **is** phone-first (`LoginPanel.tsx:197`). **But** FriendInvitation arrivals start on the `invite` confirmation step → code entry, with **no phone-entry/confirmation step** (`LoginPanel.tsx:586-644`). | Invite path is code-first (no possession step); PRD describes phone-first for all. | **High** — this is the legal/possession concern. |
| 2 | §7.1: phone OTP proves possession of the number. | No SMS sent; `000000` accepted unconditionally (`otp-store.ts:37-39`; TODO `request-otp/route.ts:108-111`). | Phase 1 proves nothing about possession. Documented & intentional per §7.1/§8.11, but real. | **High** (by design, Phase 1) |
| 3 | §7.1: "Phone number is the unique account identifier." | True — `users.phoneNumber` is the key; provisioning is per verified phone (`verify-otp/route.ts:247`). | None. | — |
| 4 | §7.1 invite-required gate via `hasValidPendingInvitationForPhone`. | Enforced on manual path (`request-otp/route.ts:95-105`) and re-checked at verify (`route.ts:236-245`). **But** a per-user `/u/` link satisfies the gate with **no phone binding** (`route.ts:265-273`). | PRD §7.1 describes only the phone-bound invitation; the evergreen-link gate (B-Friends-3) is a later, looser path. | **Medium** |
| 5 | §8.11 / §7.1: code told "out-of-band via the invite SMS." | No invite SMS is sent; the invite link + message are returned to the **inviter's** client to forward manually (`friend-invitations/route.ts:632-643`). | "Invite SMS" does not exist; delivery is manual sharing. | **Medium** |
| 6 | UI: "We'll text a code to {number}." | No text is ever sent (§D). | UI claims an action the system does not perform. | **Medium** |
| 7 | Convention (CLAUDE.md): DB access via `src/server/db/queries/`. | Auth routes query `users` inline (`request-otp/route.ts:88-92`, `verify-otp/route.ts:64-96`). | Convention drift, not behavioral. | **Low** |
| 8 | §8.11 re-enable checklist item 3: confirm rate-limiting on `request-otp`. | No rate-limiting wired; `getRecentOtpRequestCount` unused. | Pre-existing gap to close before Phase 2. | **Low (Phase 1) / High (Phase 2 blocker)** |

---

## 5. The possession finding (plain language)

**Today (Phase 1), the login flow proves nothing about whether the person logging in possesses the phone number being provisioned.** No SMS is sent (`request-otp/route.ts:108-111` TODO; no `sendSms` call in the OTP path), and `verifyOtp` returns success for `000000` in every environment with no database check (`otp-store.ts:37-39`). The number attached to a new FriendInvitation account is the number the **inviter** typed (`friend-invitations/route.ts:604-609`); the invitee confirms nothing about it — and on the invite path they never even see or type it (it is shown only masked, `LoginPanel.tsx:615`). What gates account creation is **invitation provenance** (a valid pending phone-bound FriendInvitation, or any valid per-user link), **not** possession.

**If Phase 2 were wired** — `sendSms(...)` into `requestOtp` and the `000000` shortcut removed or restricted to non-production (PRD §8.11 checklist items 1–2) — then entering a code that was delivered by SMS to that number would prove the verifier could receive a message at that number, i.e., possession. **That wiring does not exist in the current code.**

---

## 6. Open questions for product (not resolved here)

1. **Invite-path possession:** The FriendInvitation flow has no step where the invitee enters/confirms their own number — should the phone-first principle (§7.1 step 1) apply to the invite path too, or is the inviter-asserted number acceptable for Phase 1? (Stated as the audit's motivating concern; left open per the prompt.)
2. **`000000` in production:** §7.1 explicitly locks `000000` for all environments in Phase 1. The §8.11 checklist (item 2) only contemplates gating it "at minimum … non-production" at Phase 2. Is unconditional production acceptance acceptable for the current beta scale?
3. **Per-user link, no phone binding:** `/u/<handle>/<token>` lets *any* verified phone provision an account (`verify-otp/route.ts:265-273`). Is the open, forwardable, non-phone-bound credential intended to remain, and does it interact with the possession concern differently from FriendInvitation?
4. **"We'll text a code" copy** is shown while no SMS is sent. Is that copy acceptable during the SMS-deferred phase, or should it be reconciled with the out-of-band `000000` reality?
5. **Grandfathered re-login:** existing accounts bypass the invite gate on re-login (`verify-otp/route.ts:178-224`; PRD F2.2 marks the recheck-vs-grandfather call as "deferred"). Still deferred?
6. **request-otp rate-limiting** is absent today. Is closing it a Phase-1 concern or strictly a Phase-2 re-enable prerequisite?
