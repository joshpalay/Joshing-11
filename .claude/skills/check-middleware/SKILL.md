---
name: check-middleware
description: Verify there is no src/middleware.ts in this repo — this codebase uses src/proxy.ts for Next.js 16 middleware, and the middleware.ts variant has been reverted at least 5 times. Run before commits, after merges, or any time something feels off about routing.
allowed-tools: Bash(ls:*), Bash(test:*), Bash(git log:*), Read
---

# Check middleware / proxy state

This repo uses `src/proxy.ts` for Next.js 16 middleware. **`src/middleware.ts` must not exist.** The same regression has been fixed at least 5 times: commits `c02a980`, `95157a1`, `8c8a6f7`, `b5d8e7d`, `635abc6`.

## Steps

1. Check whether `src/middleware.ts` exists.

2. **If it exists:**
   - Read it.
   - Read `src/proxy.ts`.
   - Determine if `middleware.ts` contains anything not already in `proxy.ts`.
     - If yes: port the missing logic into `proxy.ts`, then delete `middleware.ts`.
     - If no: just delete `middleware.ts`.
   - Show the user exactly what was removed and why.
   - Look at recent commits (`git log --oneline -10 -- src/middleware.ts src/proxy.ts`) to identify how it crept back in. If a recent commit reintroduced it, flag the author/commit so they don't repeat it.

3. **If it doesn't exist:**
   - Confirm `src/proxy.ts` is still present.
   - Confirm it exports the middleware (look for `export const middleware` or equivalent).
   - Report all clear.

4. Run any tests under `src/**/__tests__/` whose names mention `middleware` or `proxy`.

## Output

End with the state of both files: exists/absent, last-modified info if available, and any test results.
