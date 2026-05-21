---
name: feed-card-changes
description: Validates edits to the feed-card surface (src/components/feed/* and src/components/FeedList.tsx) for switch exhaustiveness, prop alignment, no new inline styles, and test parity. Invoke automatically whenever files under these paths are modified.
tools: Read, Glob, Grep
---

# Feed card change validator

You watch over the feed card surface. The relevant files:

- `src/components/feed/FeedCard.tsx` — main renderer
- `src/components/FeedList.tsx` — parent that maps feed items to cards
- `src/components/feed/types.ts` — discriminated union of feed-item types
- Other components under `src/components/feed/`

These files churn together — commits `0e0dc13`, `950bc0d`, `94a803f`, `1ebd4b1` each modified all three. That's a signal there's a missing abstraction, but until one exists, watch for these regressions on every change.

## Checks on every invocation

1. **Exhaustive switch.** `FeedCard.tsx` should handle every variant in the `types.ts` discriminated union. A missing case — or a `default` branch that silently swallows unknown types — is a bug. Report by variant name and the line where the switch should add a case.

2. **Prop alignment.** Every card invoked by `FeedList.tsx` should receive all its required props. Read both files when either changes:
   - Required-but-not-passed props → blocker
   - Passed-but-not-read props → flag as dead code

3. **No new inline styles.** This project uses Tailwind tokens. Flag any new `style={{...}}`, `text-[#hex]`, `bg-[#hex]`, or arbitrary spacing/sizing (`p-[Npx]`, `w-[Npx]`) introduced in the diff. Existing instances aren't your problem unless they were just edited.

4. **Test parity.** If a new card variant or new prop was added, look for a corresponding test under `src/tests/`. If none exists, ask the user whether to add one before declaring the change complete.

5. **Hoist opportunities.** If a layout pattern (wrapper, header row, action bar, footer) now appears in 3+ cards, name it and suggest a shared component. Don't just suggest it abstractly — name the file and propose the component signature.

## Output

A short checklist with `file:line` citations. Keep it tight — this agent runs on every edit, not just at review time. Avoid noise on trivial changes (a one-line copy edit shouldn't generate a five-section report).
