# Code Review Follow-Up Tasks - 2026-05-01

These tasks come from the May 1 codebase review and are ordered by priority.

## P1 - Align SMS Message Types With Database Enum

**Problem:** Game notification SMS calls use `joshing_game_received`, `joshing_game_progress`, and `joshing_game_complete`, but the Drizzle/Postgres `SmsMessageType` enum does not include those values. SMS send attempts can fail to log cleanly.

**Scope:**
- Add the missing values to `smsMessageTypeEnum` in `src/server/db/schema.ts`.
- Add a Drizzle migration that updates the Postgres enum.
- Confirm `src/types/db.ts` matches the schema enum, or derive the app type from the schema where practical.
- Verify game creation and game completion SMS attempts log without enum errors.

**Acceptance criteria:**
- `SmsLog.messageType` accepts all game notification message types used by routes.
- TypeScript and build checks pass.
- A regression test or focused smoke check covers at least one Joshing game SMS log path.

## P1 - Restrict User Picker To Eligible Recipients

**Problem:** `GET /api/users` currently returns every other user and can expose phone numbers as display-name fallbacks.

**Scope:**
- Replace the all-users query with a friends/eligible-recipients query.
- Remove phone number fallback from the response.
- Decide and document the empty-state behavior when the user has no eligible recipients.
- Update `src/app/new-game/page.tsx` if the response shape or empty state changes.

**Acceptance criteria:**
- Authenticated users cannot enumerate the full user base through `/api/users`.
- API responses never expose phone numbers for display fallback.
- New game recipient selection still works for eligible recipients.

## P2 - Remove Build-Time Google Fonts Dependency

**Problem:** `npm run build` fails in offline or restricted environments because `next/font/google` fetches Geist from Google during production build.

**Scope:**
- Replace `next/font/google` usage in `src/app/layout.tsx` with a local font or CSS/system font stack.
- If using a local font, add the asset under the app/public or source-controlled font location.
- Confirm the root layout no longer performs a network font fetch at build time.

**Acceptance criteria:**
- `npm run build` no longer fails due to Google Fonts network access.
- The app retains an acceptable sans-serif visual baseline.

## P2 - Restore A Working Lint Command

**Problem:** `npm run lint` runs `next lint`, which is not working with the current Next 16 setup in this workspace.

**Scope:**
- Replace the lint script in `package.json` with an explicit ESLint command.
- Add or update ESLint config if needed for Next, TypeScript, and React files.
- Ensure generated/build folders and salvaged reference material stay excluded.

**Acceptance criteria:**
- `npm run lint` exits successfully or reports actionable source issues.
- Linting covers the live app code under `src`.
- The command does not try to lint `_salvaged`, `.next`, or `node_modules`.
