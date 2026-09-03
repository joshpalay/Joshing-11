# Joshing — Invite Link: Staged Build Prompts

*Six stages, run one at a time. Each is a separate Claude Code session. Every prompt ends with "concerns before code" — do not let it start writing until it has raised anything that looks wrong. Stages 5 and 6 are loose ends and admin discoverability turned up along the way, not part of the original four-stage plan; both can run any time after Stage 1.*

**Standing constraint for all four stages: both invitation paths stay available.**
The per-user invite link (`/u/<handle>/<token>`) becomes the default *placement*. The named phone invitation (`AddFriendInvite` → `friendInvitations` → SMS handoff) keeps every capability it has today, including pre-seeded interests, edit-before-click, cancel, and expiry. Nothing in these stages removes, disables, or degrades it. If a stage looks like it requires removing the phone path to work, stop and say so.

Codebase conventions to restate in each session: Drizzle (not Prisma); no `src/middleware.ts` — use `src/proxy.ts` and run `/check-middleware`; Zod on changed API inputs; DB access in `src/server/db/queries/`; Sonnet for generation, Haiku for grading; typecheck with `npx tsc -p tsconfig.typecheck.json`; after hand-writing any migration, reconcile `drizzle/meta/_journal.json` via `node scripts/reconcile-drizzle.mjs` (report-only; `--apply` to write the journal entry) — an unjournaled migration is invisible to the runtime migrator.

Recurring failure mode in this codebase, to guard against in every stage: **a value correct on the server breaks at a boundary another feature reads.** A server change is not done when the route test passes — test the consumer and the render side too.

---

## Stage 1 — One inviter resolver

*Correctness fix. Independent of every design decision in stages 2–4 and safe to ship on its own. Run this first: stages 2 and 3 make the bug it fixes far more visible.*

### Prompt

> Joshing has two ways a player can arrive, and one of them is a second-class citizen in three downstream surfaces.
>
> **The named path** creates a `FriendInvitation` row (`src/server/friends/invitations.ts` → `acceptFriendInvitation`), sets `acceptedAt` and `inviteeUserId`, and calls `upsertInvitationFriendship`.
>
> **The per-user invite-link path** (`/u/<handle>/<token>`, `src/server/friends/user-invite-token.ts` → `acceptUserInviteLink`) calls the same `upsertInvitationFriendship` — creating a mutual approved follow — but writes **no `FriendInvitation` row at all**.
>
> Three surfaces resolve "who invited this user" by querying `friendInvitations` directly, so for a link-arrived player they resolve to nothing:
>
> 1. `src/server/activity/invite-onboarding.ts` — `maybeNotifyInviterOfFirstFive` returns early at the `invitationRow` lookup, so **the inviter is never told their link-joined friend played their first five.**
> 2. `src/server/daily/get-first-session-recap.ts` — the inviter lookup returns nothing, so the new player's first-session recap drops Beat 3 to its no-inviter copy.
> 3. `src/app/page.tsx` — `welcomeInviterName` comes from `getPreSeededInterestsForUser(...).inviterName`, so the welcome tour says "a friend" instead of the inviter's name.
>
> This pattern has already bitten once and was patched locally: `src/app/onboarding/page.tsx` added `hasInviteLinkFriendship` as a second provenance signal to stop link signups redirect-looping. That patch is the precedent — but it is a boolean, and these three sites need the inviter's identity.
>
> **Build one shared resolver and route all call sites through it.**
>
> - Add `getInviterForUser(userId)` in `src/server/db/queries/` returning `{ inviterUserId, inviterName } | null`.
> - Resolution order: (a) the most recently accepted `FriendInvitation` where `inviteeUserId = userId`, exactly as today; (b) failing that, the approved-follow edge left by `upsertInvitationFriendship` — the same signal `hasInviteLinkFriendship` already reads in `src/server/friends/user-invite-token.ts`.
> - For (b): `follows` rows are **hard-deleted** on unfollow (every unfollow/remove path in `src/server/friends/friendships.ts` is a real `DELETE`, not a state change), so "the earliest surviving approved follow edge" is not a stable signal — if the inviter and invitee ever unfollow each other, that query silently reassigns to whichever unrelated follow happens to be earliest at query time. Do not use an unbounded "earliest surviving edge." Instead: the earliest approved follow edge (`followeeId = userId`) whose `approvedAt` falls within **7 days of the user's `users.createdAt`** — the mutual follow from `upsertInvitationFriendship` is written at accept time, which is at or near signup, so this window catches it while excluding any later organic follow. If no edge exists in that window, return `null` — a link-arrived user whose inviter-edge was deleted gets no-inviter treatment (the same fate a named invite gets if its `FriendInvitation` row is hard-deleted), not a misattributed one. State this rule in a comment on `getInviterForUser`.
> - Update all three sites above. Keep the existing `FriendInvitation` branch as the first check so the named path's behaviour is byte-identical.
> - `hasInviteLinkFriendship` and the onboarding gate can stay as they are; do not refactor the onboarding redirect while you are in here.
>
> **Acceptance:** a user created via `/u/<handle>/<token>` gets (1) the inviter notified at their fifth answer, (2) Beat 3 of the first-session recap naming the inviter, (3) the welcome tour naming the inviter. A user created via a named invitation behaves exactly as it does today. Add a unit test per resolution branch, and one test at the consumer level — not just the query — per the boundary rule above.
>
> Raise any concerns before writing code.

---

## Stage 2 — Topics that ride the link

*Depends on Stage 1's resolver. This is the stage that closes the actual gap.*

### The problem, stated precisely

Onboarding is two screens (`src/app/onboarding/OnboardingFlow.tsx`): `setup` (display name + handle) and `review` (interests). The cultural-anchor step is gone. On `review`, the **only** source of candidate chips is `inviteSuggestions`, derived from the `preSeededInterests` prop, which `src/app/onboarding/page.tsx` gets from `getPreSeededInterestsForUser` — a read of `friendInvitations.preSeededInterests`.

A link joiner has no such row. So `preSeededInterests` is `[]`, `hasSeeds` is false, the list renders *"Nothing yet — add a few below"*, and the only affordance is `AddTopicField`. They must invent three specific topics from a blank screen before the CTA unlocks at `MIN_INTERESTS = 3` — and the obvious answers are refused by `isTooBroadInterest`, which rejects every `STABLE_BROAD_CATEGORIES` bucket and alias.

### Prompt

> Give the per-user invite link a set of topics it carries, so a link-arrived player reaches the onboarding interests screen with suggestions instead of a blank list.
>
> **Storage.** There is nowhere to put this today: `users.inviteToken` is a bare text column, and `preSeededInterests` lives on `friendInvitations`, which the link path never creates. Add `inviteSeedInterests` as a nullable `jsonb` column on `User` via a Drizzle migration, shaped like the existing `friendInvitations.preSeededInterests` payload so `parseInvitationInterests` / `parsePreSeededInterests` can be reused rather than reimplemented. Cap at 3. Reconcile the journal per the standing convention above before moving on.
>
> **Two sources, one fallback.**
> - **Curated:** whatever the user saved in `inviteSeedInterests`.
> - **Automatic (default, when the column is null/empty):** the first three from `getActiveDeclaredInterests(inviterUserId)` (`src/server/db/queries/declared-interests.ts`), which already returns them first-picked first.
>
> The automatic fallback is what makes this useful on day one with zero setup. Do not require the user to configure anything for the link to carry topics.
>
> **Minimal curated-set editor.** Nothing today lets a user set `inviteSeedInterests` — without an editor the "curated" source is dead code. Add a small section to `src/components/profile/settings/PrivacyForm.tsx`, next to the existing rotate-token control: up to 3 topics, add/remove, no reordering UI needed. Save through a new Zod-validated endpoint (or extend the existing invite-token route) that runs saved topics through the same `isTooBroadInterest` check used at onboarding-consumption time before writing — reject too-broad entries at save, don't just filter them silently at read. This is the "editor" Stage 3's topic-count line links to; keep it minimal, it does not need its own review/convergence flow.
>
> **Where they surface.**
> 1. `src/app/u/[handle]/[token]/page.tsx` — `resolveInviteLink` already returns `inviterUserId`. Extend the resolution to include the seed topics and render them on the invite card for a logged-out visitor, as read-only chips under a line naming the inviter. Then carry them through the existing `loginHref` redirect. Respect `profileDomainVisibility` — a domain the inviter has marked non-public must not appear.
> 2. `src/app/login/page.tsx` — the `inviteContext` built from `resolveInviteLink` currently carries name and avatar colour only. Add the topics so the invite card on the login panel shows them too.
> 3. `src/app/onboarding/page.tsx` — when `getPreSeededInterestsForUser` returns no interests, resolve the inviter with **Stage 1's `getInviterForUser`** and read their seed topics as the `preSeededInterests` prop. This is why Stage 1 runs first; do not build a second resolver here.
>
> **The rule that must not be violated.** In `OnboardingFlow.tsx`, `preSeededInterests` currently pre-populates `selectedInterests` in the initial state. That is correct for a named invite — the inviter chose those topics *for that person*. It is wrong for a link, which may be in a bio and reach someone the inviter never had in mind. **Link-sourced seeds must arrive unselected**, rendering only through the existing `renderSuggestionChips` `+` affordance, with `selectedInterests` starting empty and the CTA still locked until 3. Add a prop or a discriminated seed source to carry this distinction; do not infer it from array length or from whether a `FriendInvitation` exists at read time.
>
> Update the `hasSeeds` copy branch so a link joiner gets the "here are a few from {inviter} — take any that are yours" framing rather than either of today's two strings.
>
> **Reuse the existing validation.** Seeds still pass through `isTooBroadInterest`, `assessInterestAnswerability` and `convergeDomain` in `onboarding/page.tsx`. Do not add a parallel path. Note that automatic seeds come from `declaredInterests`, which are already converged canonical domains, so they should pass cleanly — if they do not, that is a finding worth reporting, not a reason to skip the checks.
>
> **Do not touch the named path.** `friendInvitations.preSeededInterests`, the four-step `AddFriendInvite` modal, and the pre-selection behaviour for named invites all stay exactly as they are.
>
> **Acceptance:** a logged-out visitor tapping `/u/<handle>/<token>` sees the inviter's name and up to three topics; after login and the name/handle step, those topics appear as unselected `+` chips on the interests screen with the counter reading "0 selected · pick at least 3 more"; a named-invite arrival still lands with its topics **pre-selected** and its counter reading "3 selected"; an inviter with no declared interests and no curated set produces a link that behaves exactly as today; saving 1–3 topics in the new `PrivacyForm.tsx` editor makes the link show exactly those instead of the automatic fallback, and a too-broad entry is rejected at save with an inline error rather than silently dropped. Test both arrival paths at the render level, not only the query.
>
> Raise any concerns before writing code.

---

## Stage 3 — Share, don't copy

*UI only. Depends on Stage 2 for the "your link carries N topics" line; everything else is independent.*

### Prompt

> Make the invite link the default way to invite someone, without removing the phone invitation.
>
> **Today.** The link is reachable from exactly two places, both buried: `src/components/profile/settings/PrivacyForm.tsx` (account settings, beside a rotate control) and `src/components/friends/InviteSomeoneNew.tsx` on `/friends/find`, where "Copy invite link" is `btn-ghost` beside `btn-primary` "Text a personal invite". The Friends hub itself (`src/components/FriendsHubPage.tsx`) has **no invite affordance at all** — the standalone block was deliberately removed, and inviting is reached only by typing into the search field and hitting a no-match, which opens the four-step phone modal.
>
> **Three changes.**
>
> 1. **Swap the emphasis in `InviteSomeoneNew.tsx`.** "Share invite link" becomes `btn-primary`; "Text a personal invite" becomes `btn-ghost`. Both stay. The personal invite keeps dispatching `friend-invitations:create-new` exactly as it does now.
>
> 2. **Replace copy with share.** The current handler is `navigator.clipboard.writeText(body.url)` on a bare URL — the user then composes the message themselves every time. Use `navigator.share({ text, url })` with pre-written copy ("I'm playing Joshing — come be my friend."), falling back to the existing clipboard path when `navigator.share` is unavailable, with the same toast. Keep the existing `/api/account/invite-token` fetch and its error states.
>
> 3. **Put the block on the Friends hub.** Add `InviteSomeoneNew` to `FriendsHubPage.tsx` above or beside the existing `FindFriendsSearch`. The no-match → `AddFriendInvite` hand-off (`handleLookupInvite`, and the phone/name seeding it does) must keep working unchanged — this is an addition, not a replacement. Update the stale comment in that file that says the standalone invite block is gone.
>
> **After Stage 2 only:** add a quiet line under the buttons reading how many topics the link currently carries, linking to the editor. If Stage 2 has not shipped, omit the line rather than stubbing it.
>
> **Do not** change `users.inviteToken` generation, `rotateInviteToken`, `resolveInviteLink`, or the `request-otp` / `verify-otp` gates. The link mechanism is correct; this stage is placement and message only.
>
> **Acceptance:** the link is offered as the primary action on both `/friends` and `/friends/find`; the phone invitation is reachable from both in one tap; the share sheet opens with the message pre-filled on a browser that supports it, and copies with a toast on one that does not; the search no-match hand-off still opens the modal seeded with a phone or a name as it does today.
>
> Raise any concerns before writing code.

---

## Stage 4 — Both paths, verified

*Run after 1–3. This is an audit prompt: it reports, it does not build, except for defects it finds and you approve.*

### Prompt

> Stages 1–3 changed the invitation surface. Audit both arrival paths end to end and report findings — do not fix anything without flagging it first.
>
> **The standing product constraint:** the per-user invite link and the named phone invitation are both first-class. The link is the default *placement*; the named invitation retains every capability it has today. Any finding that shows the named path degraded is a blocker.
>
> Walk and report on each of these, naming the file and line for every claim:
>
> **A — The named phone path, unchanged.** `AddFriendInvite` four-step flow (identity → interests → review → handoff); `createFriendInvitation` / `updateFriendInvitation` / `cancelFriendInvitation`; the 14-day `DEFAULT_INVITATION_TTL_MS`; the phone-first login prefill (`getInvitePrefillByToken`, `useInvitePhone`) and its deliberate full-number client exposure; `acceptFriendInvitation`'s `phone_mismatch` rejection; pre-seeded interests arriving **pre-selected** in onboarding.
>
> **B — The link path, complete.** `/u/<handle>/<token>` for logged-out, logged-in-as-someone-else, and logged-in-as-self; `resolveInviteLink` returning null identically for a wrong handle and a wrong token; `request-otp`'s `invitedByLink` gate; `verify-otp` → `acceptUserInviteLink` → mutual approved follow + `backfillInviterFeedItems`; `rotateInviteToken` invalidating the old link immediately; the onboarding provenance gate not redirect-looping.
>
> **C — Parity between them.** For a user who arrived by link: inviter notified at their fifth answer; first-session recap Beat 3 names the inviter; welcome tour names the inviter; seed topics present and **unselected**. For a user who arrived by named invitation: all of the above, with seeds **pre-selected**. Confirm there is exactly one `getInviterForUser` and no second resolver was introduced.
>
> **D — Boundary check.** For every server value Stages 1–3 changed, confirm the consumer and render side were tested, not just the route. This codebase's recurring defect is a value correct on the server and dropped in a client hook.
>
> **E — Known non-blocking observations to confirm or clear.** `src/components/PeopleYouInvited.tsx` is still unimported — it is a management console for outgoing phone invitations (masked numbers, `sms:` hrefs, resend/edit/cancel). Report whether it now has a caller. **Do not delete it** — the phone path is retained by decision, and whether that console gets wired up is an open product question, not a cleanup.
>
> Report as a findings list ranked by severity, each with file, line, and the concrete failure it produces. No fixes without approval.

---

## Stage 5 — Loose ends from Stages 1–2

*Independent of stages 2–4; can run any time after Stage 1 (item 3 also depends on Stage 2). Small fixes bundled into one stage because none is worth its own session.*

### Prompt

> Stages 1 and 2 (the `getInviterForUser` resolver and invite-link seed topics) each surfaced something they didn't fix. Close them out.
>
> **1 — Consumer-level test coverage for `src/app/page.tsx`'s `welcomeInviterName`.** Stage 1 added consumer-level tests for two of the three call sites (`invite-onboarding.ts`, `get-first-session-recap.ts`) but not the third: `welcomeInviterName = normalizePersonName((await getInviterForUser(session.userId))?.inviterName)` in `page.tsx`, which has zero test coverage today — no `page.tsx` test exists anywhere in `src/app`, and mocking the full Home server component (session, `buildHomeEdition`, daily queue, ceremony, missed-return, friend requests, etc.) just to cover one derived line was judged disproportionate at the time. Options, in order of preference: (a) extract the `welcomeInviterName` computation into a small named function in a DB-free-import-adjacent module that can be unit-tested without dragging in the rest of Home's dependency graph, or (b) write the full-page mock if (a) turns out not to be practical. Either way, land coverage for both branches: an inviter resolved (link or named) renders the name, no inviter renders the existing "a friend" fallback in `WelcomeTourScreen`.
>
> **2 — CORRECTED, then fixed — `listInviteReflections` was excluding on the wrong (frozen) relationship model.** The original diagnosis for this item ("queries a table that no longer exists") was wrong — a grep with a too-narrow pattern (`pgTable('Friendship'` on one line) missed the real definition, which wraps the table name onto its own line: `export const friendships = pgTable(\n  'Friendship',\n  ...)` in `src/server/db/schema.ts`. The table exists and is actively read/updated/deleted elsewhere (`account.ts`, `contact-hashes.ts`, the `expire-friend-requests` cron, `instrumentation.ts` guards) — it just has no `db.insert(friendships)` call anywhere. That's the real bug: it's **frozen** (read-only, pre-follow-model), so `listInviteReflections`'s `NOT EXISTS` check against it can never see a friendship formed under the current `follows` model — a same-day mutual follow between the inviter and an invitee sailed straight through and still got listed as "not yet friended." Fixed by keeping the existing SQL check (still correct for pre-follow-model rows) and adding a second exclusion using the `relationship.state === 'friends'` value from `getRelationships` — already fetched in this function for the `isBlocked` filter, so no new follows query was needed. Regression test added (this function had none before).
>
> **3 — Consumer-level test coverage for `src/app/login/page.tsx`'s `inviteContext.topics` wiring.** Stage 2 added `topics: userInviteResolution.seedTopics` to the `inviteContext` object built for the per-user invite-link branch, and both sides of that wiring are independently tested (`resolveInviteLink`'s `seedTopics` field in `src/server/friends/__tests__/user-invite-token.test.ts`, and `LoginPanel`'s chip rendering in `src/app/login/__tests__/LoginPanel.sms.test.tsx`) — but the one-line mapping in `page.tsx` itself has no test, and no `login/page.tsx` test file exists yet. Same judgment call as item 1: this server component pulls in `getSession`, `getInvitePrefillByToken`, and `resolveInviteLink`, so weigh a full mock harness against extracting the `inviteContext` construction into a small pure/testable function before deciding it's worth a dedicated test.
>
> Raise any concerns before writing code.

---

## Stage 6 — Admin links to the new screens/flows

*Independent of stages 1–5; can run any time. Two of these screens have no real-data path to reach them (the link path's login card needs a real invite token; the link path's onboarding step needs a real link-arrived session) — closing that is what makes "add a link" mean something rather than linking to a screen nobody can actually open.*

### Prompt

> Stages 1–3 shipped several screens/flows that have no discoverable entry point from the admin/dev tooling. Add them to the "Developer tools" section (`src/components/profile/settings/AccountActions.tsx`, rendered on the owner's own `/users/[id]` profile) as a new `Growth` `DevToolGroup`, following the exact pattern the existing groups use (`{kind: 'link', icon, title, subtitle, href}`, picked up automatically by `getExistingDevToolHrefs()` for availability-dimming since these all live under `/dev/` or are real routes).
>
> Two of the four links need a small preview surface built first, because there is currently no way to reach that state without a real invite link or a real link-arrived session:
>
> 1. **The per-user invite-link's topic-chip card on `/login`** (Stage 2/3 — `LoginPanel`'s `InviteContextCard` rendering `inviteContext.topics`). `src/app/dev/invite-login/page.tsx` already previews the NAMED phone-first path (`invitePrefill`) with two tabs, but never the per-user LINK path (`inviteContext`) — its own title, "Phone-first invite login," says as much. Add a third preview tab ("Screen 1c — invite-link card" or similar) that renders the same `LoginPanel` with a synthetic `inviteContext` (name + up to 3 synthetic topics, no `invitePrefill`) so the topic-chip card is inspectable. Look-only, matching the existing two tabs — no real token, no real invitation.
> 2. **The link-arrived onboarding interests screen** (Stage 2 — `OnboardingFlow`'s `seedSource="link"`, unselected chips, "here are a few from {inviter}" copy). `src/app/dev/onboarding/intro/page.tsx` always renders with `MOCK_INTERESTS` pre-selected (the named-path experience). Add a `?seedSource=link` query param (mirroring the existing `?walk=1` pattern) that swaps in `seedSource="link"` and adjusts the mock inviter name/copy so the unselected-chips experience is previewable without a real link-arrived session.
>
> Then add the `Growth` group with links to: the new invite-link login-card tab, the new onboarding link-variant, and the two real pages Stage 3 changed placement on — `/friends` and `/friends/find` (both now lead with "Share invite link"; no preview needed, they're live pages any session can reach, but they earned a shortcut since that's literally where the placement change landed).
>
> **Do not** touch the PrivacyForm topic editor (`/users/[id]` itself) — the admin is already on that page when looking at Developer tools, so a self-referential link adds nothing.
>
> Raise any concerns before writing code.

---

## Open, deliberately not decided here

- **Link caps and expiry.** The link is evergreen, uncapped, and rotatable only; named invitations expire in 30 days (`DEFAULT_INVITATION_TTL_MS`, `src/server/friends/invitations.ts:23` — corrected from an earlier "14 days" claim in this doc, per the Stage 4 audit). Decision taken: leave the link evergreen so it can live in a bio. Revisit if the invite-only promise starts mattering more than reach.
- **`PeopleYouInvited`.** Wire it into `/friends` as an outgoing-invitation manager, or leave it dark. Not decided; explicitly not deleted.
- **The post-join nudge** ("Stan just joined — send him his first question") reuses the existing send-a-question flow and is a separate stage, not folded into these four.
