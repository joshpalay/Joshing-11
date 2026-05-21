---
name: typecheck
description: Run the project's strict TypeScript typecheck, group errors by file, and propose minimal fixes for the worst offenders. Invoke before commits, before PRs, or whenever you want to know how clean main really is.
allowed-tools: Bash(npx tsc:*), Bash(npm:*), Bash(git status:*), Read, Edit, Grep
---

# Strict typecheck

Run `npx tsc -p tsconfig.typecheck.json --noEmit` and analyze the output.

If it passes, just say so and stop.

If it fails:

1. Group every diagnostic by file path.
2. List the 3 files with the most errors, with the count for each.
3. For each of those 3 files, read the file and propose minimal fixes. Prefer:
   - Narrowing types
   - Adding guards or assertions
   - Fixing genuine bugs the type-checker uncovered
   Avoid `any`, `// @ts-ignore`, and `// @ts-expect-error` unless the user explicitly asks. If a type error reveals a real bug (not just a typing gap), call that out explicitly — those are the ones worth fixing first.
4. Do NOT regenerate, stage, or commit `tsconfig.tsbuildinfo` or `tsconfig.typecheck.tsbuildinfo`. These are gitignored; confirm with `git status` before any commit.

End with a one-line summary: total error count, total file count, and whether the proposed fixes will likely clear all of them or only the top 3 files.
