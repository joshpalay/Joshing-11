# Add Friend Invitation System QA Plan

Use OTP code `000000` for every invite/auth check. OTP verification is intentionally hardcoded for development and testing; this plan must not require or assume any other code.

## Automated test coverage summary

| Area | Status | Coverage added or verified |
| --- | --- | --- |
| Friend invitation creation | PASS | 0, 1, 2, and 3 suggested interests; fourth unique interest rejection; missing display name; invalid US phone; US phone normalization; duplicate pending invite reuse; existing pending invite response. |
| Invite message generation | PASS | Message copy for 0, 1, 2, and 3 interests; valid invite URL; no leaderboard, ranking, score, points, percentage, timer, or urgency copy; no backend SMS send call. |
| Invite security | PASS | Valid token with matching verified phone; wrong verified phone; expired invite; already accepted invite; missing/invalid token; self-invite; failed claim update. |
| Invite landing | PASS | Valid, expired, invalid, and already-used states; inviter display name; suggested interest chips only for valid invites; Continue routes to OTP auth flow. |
| Onboarding | PASS | Invite-seeded interest copy; accept all; partial selection; explicit skip with zero saved invite interests; edited interest save; max five-interest cap; non-invite onboarding copy unaffected. |
| Existing-user friend requests | PASS | Existing user creates a friendship request instead of signup invite; duplicate request prevention; already-friends state; reverse pending request; accept and ignore action routes. |
| Friends page | PASS | Add Friend CTA; incoming request section; pending invites section; active friends section; empty/loading states; no leaderboard/ranking/score mechanics. |
| Knowledge-page “Ask a friend” | PASS | Domain-based Ask a friend modal; domain as first suggested interest; new-friend invite interest normalization; existing-friend handoff copy; no AI filler or gamification copy. |
| Auth regression | PASS | Normal OTP login with `000000`; non-`000000` OTP rejection before invitation acceptance; session creation only after valid OTP and valid invite acceptance. |

## Regression checks

| Regression | Status | Notes |
| --- | --- | --- |
| Existing OTP login flow | PASS | `000000` remains the only successful development/test OTP in route tests. |
| Existing onboarding flow | PASS | No-invite onboarding copy still renders and empty non-invite interest saves remain rejected. |
| Existing invite flows unrelated to Add Friend | PASS | No changes to ceremony/share invite code paths. |
| Existing friendship queries | PASS | Friendship request action tests still use shared helper functions. |
| Existing Knowledge-page flows | PASS | “Write one myself” remains a separate Knowledge-page action; Ask a friend opens only the friend ask modal. |
| Existing navigation | PASS | Invite landing Continue still points to `/login?invitationToken=...`; terminal invite states route to `/login`. |
| Existing mobile auth flow | PASS | Invite acceptance is still gated by verified phone from OTP. |
| Existing session handling | PASS | Sessions are created after successful OTP and valid invite handling only. |

## Hard regression guardrails

| Guardrail | Status | Evidence |
| --- | --- | --- |
| No backend invite SMS sending introduced | PASS | API route tests assert `sendSms` is not called. |
| No open public signup path introduced | PASS | Invite acceptance requires OTP verification and phone-bound claim. |
| No raw invite token leakage in terminal UI states | PASS | Expired, accepted, and invalid landing tests assert terminal state HTML does not include the token. |
| No interests saved before user acceptance | PASS | Onboarding copy and tests keep invite interests preselected until explicit save or explicit skip. |
| No duplicate friendships created | PASS | Existing pending, reverse pending, and already-friends states are covered. |
| No leaderboard/ranking UI introduced on Friends page | PASS | Friends page and invite copy tests reject leaderboard/ranking copy. |
| No percentages or raw point totals introduced | PASS | Friends page and invite copy tests reject percent/point copy. |
| No timers or urgency mechanics introduced | PASS | Invite copy tests reject timer/hurry/urgent copy. |
| No AI-generated filler questions introduced | PASS | Knowledge ask copy tests reject AI-generated/placeholder language. |

## Manual QA checklist

Record each run with browser/device, account phone numbers, invite token, and screenshots where useful. Use OTP `000000`.

| # | Manual check | Expected result | Result | Severity if failed |
| --- | --- | --- | --- | --- |
| 1 | Create invite with name + phone only. | Invite is created with no suggested interests and a copyable message. | Not executed | Major |
| 2 | Create invite with 3 interests. | Invite is created and all three interests appear in message/landing/onboarding. | Not executed | Major |
| 3 | Copy invite message. | Clipboard contains warm invite copy and invite URL. | Not executed | Minor |
| 4 | Open SMS handoff. | Native SMS composer opens; no backend SMS is sent. | Not executed | Major |
| 5 | Open invite link in logged-out browser. | Invite landing opens without requiring an existing session. | Not executed | Critical |
| 6 | Verify invite landing copy. | Inviter name and suggested interests are correct; no raw token except login link target. | Not executed | Major |
| 7 | Complete OTP with correct phone. | `000000` verifies and accepts matching phone-bound invite. | Not executed | Critical |
| 8 | Verify onboarding seeded interests. | Suggested interests appear preselected with skip/edit/remove guidance. | Not executed | Major |
| 9 | Accept all interests. | All selected invite interests save after user confirmation. | Not executed | Major |
| 10 | Confirm friendship exists afterward. | Inviter and invitee have one active friendship. | Not executed | Critical |
| 11 | Repeat using partial interest selection. | Only selected invite interests save. | Not executed | Major |
| 12 | Repeat using skipped interests. | No invite interests save; onboarding completes only after explicit skip. | Not executed | Major |
| 13 | Attempt invite claim with wrong phone number. | Claim fails with safe invalid-invitation copy; no session/friendship is created. | Not executed | Critical |
| 14 | Verify failure state. | User sees non-sensitive failure copy and can retry/login safely. | Not executed | Major |
| 15 | Invite an existing user. | Existing user receives a pending friend request; no signup invite link is generated. | Not executed | Critical |
| 16 | Accept existing-user friend request. | Request becomes active friendship exactly once. | Not executed | Critical |
| 17 | Ignore existing-user friend request. | Request is declined/ignored and no friendship is created. | Not executed | Major |
| 18 | Use Knowledge-page empty state. | “Ask a friend” opens friend ask flow. | Not executed | Major |
| 19 | Verify domain prefill. | Empty-state domain is the first locked suggested interest. | Not executed | Major |
| 20 | Verify “Write one myself” path. | Question composer path still opens independently. | Not executed | Major |

## Screenshot guidance

Capture screenshots for:

1. Invite creation form with three interests.
2. Copy/SMS handoff screen.
3. Logged-out invite landing with suggested interests.
4. Onboarding seeded interests, partial selection, and skip state.
5. Wrong-phone invite failure.
6. Friends page with pending invite, incoming request, and active friend.
7. Knowledge-page empty state and Ask a friend modal with domain prefill.

## Failure reporting template

- **Feature area:** Creation / Message / Security / Landing / Onboarding / Existing-user request / Friends page / Knowledge integration / Regression
- **Severity:** Critical / Major / Minor / Polish
- **Environment:** Browser, viewport, logged-in/logged-out state, account phones
- **Steps to reproduce:** Numbered exact steps
- **Expected:** What should happen
- **Actual:** What happened
- **Evidence:** Screenshot/video/logs/test output
- **Data cleanup:** Invites, users, friendships, interests to remove/reset

## Regression risk assessment

Overall risk is **Medium** because this flow crosses auth, onboarding, friendship persistence, invite landing pages, and Knowledge-page entry points. The highest-risk areas are phone-bound invite acceptance, duplicate relationship prevention, and onboarding interest persistence. The automated suite now guards those boundaries, while the manual checklist should be run before release on at least one mobile browser and one desktop browser.

## Final recommendation gate

- **Ready** only if all automated tests pass and all manual checklist rows pass.
- **Ready with fixes** if only Minor or Polish manual issues remain and no security/auth/onboarding persistence issues are present.
- **Not ready** if any Critical or unresolved Major issue appears in invite acceptance, OTP, phone matching, friendship creation, or interest persistence.
