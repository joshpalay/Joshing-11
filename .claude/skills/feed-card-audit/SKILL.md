---
name: feed-card-audit
description: Audit the feed-card surface (FeedCard, FeedList, feed/types.ts and friends) for type exhaustiveness, prop alignment, test coverage, styling drift, and missing abstractions. Read-only — proposes changes but never edits.
allowed-tools: Read, Glob, Grep, Bash(ls:*)
---

# Feed card audit

Audit every feed card component in this repo. The high-churn files (`src/components/feed/FeedCard.tsx`, `src/components/FeedList.tsx`, `src/components/feed/types.ts`) move together repeatedly — start with those, then expand to the rest of `src/components/feed/`.

## What to check

For each card variant:

1. **Feed-item types it renders.**
   Cross-reference with the discriminated union in `src/components/feed/types.ts`. Report:
   - Variants in the union that no card handles
   - Cards that handle types not in the union
   - Any default/fallback branch silently swallowing unknown types (this is almost always a bug)

2. **Required props.**
   List the props each card consumes. Flag:
   - Props required in the card's type but never provided by `FeedList.tsx`
   - Props provided by `FeedList.tsx` that the card doesn't read
   - Optional props that are effectively required (will throw if missing)

3. **Test coverage.**
   Glob `src/tests/**` for tests that import each card. If a card has no test, report it. If a test imports the card but doesn't render every variant the card handles, that's a coverage gap worth flagging.

4. **Style drift.**
   Flag any of the following introduced in feed components:
   - Inline `style={{...}}` blocks
   - Hex colors in className (`text-[#abc123]`)
   - Arbitrary Tailwind values (`p-[13px]`, `w-[247px]`)
   - Tailwind classes that duplicate a token from the design system

5. **Duplication.**
   If a layout/styling pattern (shared wrapper, header row, action bar, footer) is repeated in 3+ cards, name it and suggest a shared component. This is exactly the abstraction the repo is currently missing.

## Output

Group findings by card. For every claim, cite the file and line number. End with:
- A summary count of issues by category
- The top 2-3 refactors ranked by leverage

Do not modify any files. This is read-only.
