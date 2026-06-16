# B-AUTH-INVITE-PHONE-FIRST-01 — Phone-First Invite Login (BUILD)

**Type:** Build. Implements the contract settled in `D-AUTH-INVITE-PHONE-FIRST-DESIGN-01`.
**Predecessor (design):** `D-AUTH-INVITE-PHONE-FIRST-DESIGN-01` (cite for all decisions); ground-truth audit `D-AUTH-LOGIN-INVITE-AUDIT-01`.
**Date:** 2026-06-16
**Scope:** The FriendInvitation login path (`/invite/<token>` → `/login?invitationToken=<token>`). Does **not** touch OTP/possession/SMS wiring (Phase 2). `000000` stays the universal code.

---

## 0. Resolved open items (from the design §6)

| Item | Resolution |
|---|---|
| §6.1 step shape | **Collapse** the `invite` arrival into the existing `phone` step (§4b), pre-filled with the full invited number and inviter context above the field. The `invite` step is retired. **Guardrail:** all prefill/inviter logic stays conditional on `invitePrefill` so the `/u/<handle>/<token>` per-user-link path (which also enters on `phone`) is undisturbed. |
| §6.2 dead-end secondary action | **Dismiss / return to field.** "Ask {inviter} for a new invite" just closes the soft-state; no re-invite mechanism is built (none exists). |
| §6.3 privacy boundary | **Confirmed surface:** `login/page.tsx` (what crosses to client), the client `InvitePrefill` shape in `LoginPanel.tsx`, and the server `InvitePrefill` comment in `invitations.ts`. Named explicitly below as Phase 0. |
| §6.4 gate signal | **Server distinguishes.** `request-otp` returns a labeled `invite_phone_unclaimed` (403) for the invite path + edited number + no claim, so the client renders the warm dead-end. Gate is **not** loosened: no OTP is sent and the request is still rejected — only the label differs. |

---

## 1. Privacy boundary change (Phase 0 — call it out explicitly)

Per design §2.3, the raw invited phone now crosses to the client **for the FriendInvitation path only**, gated by a valid invitation token resolved server-side at page load.

1. `src/server/friends/invitations.ts` — `InvitePrefill.inviteePhone`: rewrite the "Never expose this to the client" comment to scope the exception to the invite-token-gated prefill path (do not delete it silently). The server type is unchanged in shape.
2. `src/app/login/page.tsx` — the client `invitePrefill` object now carries the full `inviteePhone` (replacing `maskedPhone`, which the client no longer needs). Update the `// Only the masked form crosses…` comment.
3. `src/app/login/LoginPanel.tsx` — client `InvitePrefill` type swaps `maskedPhone` → `inviteePhone`.

---

## 2. Client (`LoginPanel.tsx`)

- **Step union:** drop `'invite'`. Initial step is always `'phone'`.
- **Prefill:** `phone` initialises to `formatUsPhoneInput(invitePrefill.inviteePhone)` when present, else `''`.
- **Retire:** the `invite` step render block, `sendCodeToInvitePhone`, `invitePhoneMode` state, `maskedPhone` state, and `buildInviteVerifyOtpRequestBody`. Verify always uses `buildVerifyOtpRequestBody(phone, code, searchParams)` — the submitted phone is authoritative (design §4 default stance); the token is re-validated against it server-side by the untouched `getValidInvitationForPhone` / `acceptFriendInvitation` (preserves §2.4).
- **request-otp body:** `continueWithPhone` now also sends `invitationToken` (so the server can emit the §6.4 soft signal). Null on the cold / per-user-link paths — no behavior change there.
- **Dead-end (Screen 1b):** when `request-otp` returns `error: 'invite_phone_unclaimed'` and `invitePrefill?.inviteePhone` exists, do not advance — render an inline warm panel (neutral/gold, **not** destructive-red; state carried by wording per accessibility canon):
  > This invite was sent to {full number}. We can use that number, or you can ask {inviter} for a new invite.
  - Primary **Use the invited number** → restores the field to the invited number and proceeds (shared `requestCodeForPhone` helper).
  - Secondary **Ask {inviter} for a new invite** → dismiss (clears the dead-end, returns to the field).
  - Editing the field clears the dead-end.
- **Code step:** display always `formatPhoneForDisplay(phone)` (no more masked branch).

## 3. Server (`request-otp/route.ts`) — the only server change

In the new-user gate-fail branch, when a `invitationToken` is present, return a distinguishable signal instead of the generic 403:

```ts
if (!invitedByPhone && !invitedByLink) {
  if (parsed.data.invitationToken) {
    return NextResponse.json(
      { error: 'invite_phone_unclaimed', message: INVITE_REQUIRED_MESSAGE },
      { status: 403 },
    );
  }
  return NextResponse.json(
    { error: 'invite_required', message: INVITE_REQUIRED_MESSAGE },
    { status: 403 },
  );
}
```

No OTP is sent on either branch; the gate is unchanged. `verify-otp` is **not** touched.

## 4. What must NOT change (design §5)
`verifyOtp`/`000000`; `acceptFriendInvitation`'s `inviteePhone === verifiedPhone`; the cold-visit and `/u/` paths; returning-player path & `proxy.ts`; existing SMS-implying copy (and add no new "we'll text you" promise — "Continue" makes none).

## 5. Tests
- `LoginPanel.test.ts`: drop the `buildInviteVerifyOtpRequestBody` cases (function removed).
- `request-otp/.../route.test.ts`: add a case asserting `invite_phone_unclaimed` (403, no OTP) when a token is present on a no-claim phone; the generic-403 cold-path case stays.
- `verify-otp` tests: unchanged (server untouched).
