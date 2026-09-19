# Codebase Critique Report

Date: 2026-07-10

## Scope

This report summarizes a broad review of the Joshing v11 repository, including project setup, source structure, representative server flows, auth/session handling, database access, LLM provider abstractions, unfinished stubs, and baseline checks.

## Executive summary

The codebase has strong domain modeling, unusually helpful product-context comments, thoughtful auth/session design, explicit LLM timeout/fallback behavior, and many tests and operational scripts. The biggest improvement opportunities are reducing architectural drift, removing or quarantining unfinished legacy stubs, tightening secret separation, pinning volatile dependencies, and making test/ops workflows more discoverable.

## Strengths

### Rich domain modeling

The database schema encodes important product states as enums, including question visibility, trust tiers, follow states, public status, report status, mastery tiers, and more. This makes core product semantics visible to TypeScript and Drizzle instead of relying on loose strings.

### Thoughtful session design

Session JWTs include invitation and onboarding claims so middleware can avoid database reads on every navigation. Session creation also requires callers to explicitly pass `invitationAccepted: true`, which is a useful guard against accidentally bypassing the invitation gate.

### Operationally aware database client

The Postgres pool is cached on `globalThis` to avoid leaking connections during Next.js hot reloads, has a conservative pool size, and logs pool saturation only when there is contention or near-capacity usage.

### LLM calls have a provider boundary

The OpenAI and Anthropic paths validate keys, support an `LLM_ENABLED=false` kill switch, cache clients, apply timeouts, log usage, and are designed to fail into existing fallback paths. That is the right shape for a product that depends heavily on LLM calls.

### Answer flows include strong safety checks

The feed answer route validates auth, scopes feed items to the current recipient, blocks dismissed/rolled-off items, refuses blocked questions, prevents authors from answering their own questions, and returns a retryable grader-unavailable response rather than marking a player wrong when infrastructure fails.

## Top improvement opportunities

### 1. Remove or quarantine unfinished legacy stubs

Several exported modules still present typed APIs while returning placeholder values:

- `src/lib/games/winner.ts` is deprecated and returns a fake solo/no-winner result.
- `src/lib/knowledge-card.ts` contains Phase 8 TODO functions that return `null`, including through `as unknown as` casts.
- `src/server/profile/portrait.ts` contains exported async functions that return `null as unknown as ...`.

This undermines TypeScript because future callers can import functions that appear non-nullable but return `null` at runtime.

Recommended fixes:

1. Delete truly unused stubs.
2. Move legacy references to an archive folder not imported by app code.
3. Change signatures to return nullable types.
4. Throw explicit not-implemented errors so accidental runtime use fails loudly.
5. Add lint/import restrictions for deprecated modules.

### 2. Consolidate answer-submission side effects

The feed answer route coordinates parsing, state validation, grading, answer-state derivation, mastery writes, question stat updates, feed item updates, author credit, fan-out, and declared-to-demonstrated promotion. Some divergence between answer surfaces is intentional, but duplicated invariants increase drift risk.

Recommended direction: extract a service-level answer command that accepts surface-specific policies while centralizing shared invariants such as blocked-question handling, grader-outage behavior, answer-state derivation, and point computation.

### 3. Tighten production secret separation

`readConfiguredSessionSecret()` falls back to `CRON_SECRET` when no JWT/auth secret exists. This is operationally convenient but couples cron endpoint authorization with user session signing. If the cron secret leaks, the blast radius can include session forgery.

Recommended fix: in production, require a dedicated `JWT_SECRET`, `AUTH_SECRET`, or `NEXTAUTH_SECRET`; do not accept `CRON_SECRET` as a session-signing fallback.

### 4. Pin volatile dependencies

Several important dependencies use `latest`, including LLM SDKs, auth/crypto-related libraries, React, Zod, TypeScript, and ESLint. The lockfile mitigates normal installs, but lockfile regeneration or dependency updates can unexpectedly jump major versions.

Recommended fix: pin volatile production dependencies and upgrade intentionally via dedicated PRs.

### 5. Add LLM provider compatibility checks

The LLM layer contains model-specific assumptions around sampling parameters, thinking defaults, JSON output, timeouts, and usage fields. These assumptions can change as providers evolve.

Recommended fix: add a smoke or compatibility test that validates configured models, structured output behavior, parameter compatibility, timeout handling, and usage logging.

### 6. Move toward schema-enforced LLM output

The OpenAI path currently uses JSON object mode and prompt instructions to preserve output shape. That is workable, but schema-enforced structured output would better match the app's need for strict contracts.

Recommended direction:

- Define Zod schemas for LLM responses.
- Use provider-native schema output where supported.
- Keep fallback parsing for provider differences.
- Log schema validation failures separately from transport failures.

### 7. Ban unsafe `as unknown as` casts outside narrow boundaries

The codebase is generally type-conscious, but `null as unknown as SomeNonNullableType` is high risk. It hides unfinished behavior from both TypeScript and callers.

Recommended fix: add a lint rule or repository convention banning `as unknown as` except in narrow test or serialization boundaries with explicit justification.

### 8. Improve script and ops discoverability

`package.json` exposes many useful smoke tests, ratchet checks, backfills, audits, pool tools, and formatting commands. That is a strength, but it needs a map.

Recommended fix: add `docs/ops.md` or `scripts/README.md` that groups scripts into local development, CI checks, dry-run backfills, apply scripts, cron/debug tools, and incident-response commands.

### 9. Make database pool size configurable

The pool max is hardcoded to `5`, with comments explaining PgBouncer constraints. That default may be right today, but it is environment-specific.

Recommended fix: support `DB_POOL_MAX` with a safe default of `5` and log the configured value.

### 10. Clarify test modes

`npm test -- --runInBand` fails because Vitest does not support Jest's `--runInBand` flag. A full `npm test` run began but did not complete in the review window and surfaced at least one failing `FriendsHubPage` test before continuing.

Recommended fix: add documented test modes such as `test:unit`, `test:ci`, `test:changed`, and possibly app/server-specific splits.

## Suggested priority plan

### Priority 0: correctness and safety

1. Remove `CRON_SECRET` as a production JWT fallback.
2. Replace unsafe nullable stubs with deleted modules, nullable signatures, or explicit thrown errors.
3. Investigate the failing/hanging Vitest run.

### Priority 1: maintainability

1. Extract shared answer-submission command logic.
2. Add script and ops documentation.
3. Split or index the large Drizzle schema file if tooling permits.

### Priority 2: operational maturity

1. Pin volatile dependencies.
2. Make DB pool max configurable.
3. Add LLM provider compatibility smoke tests.

### Priority 3: developer experience

1. Add clear test scripts for common workflows.
2. Add lint restrictions for unsafe casts.
3. Add import restrictions for deprecated/legacy modules.

## Checks performed during review

- `npx tsc --noEmit` passed.
- `npm test -- --runInBand` failed because Vitest does not support Jest's `--runInBand` flag.
- `npm test` started, surfaced at least one failing `FriendsHubPage` test, and did not complete in the review window.
