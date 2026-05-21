---
name: prd-audit
description: Run the project's PRD audit prompt against a specific PRD section and write findings to audits/. Replaces the manual chore(audit) commits that have been ledgering through git.
argument-hint: <PRD section, e.g. "§8.5" or "phase 2 author credit">
allowed-tools: Read, Write, Bash(date:*), Bash(ls:*), Grep, Glob
---

# PRD audit: $ARGUMENTS

Run the audit defined in `PRD-AUDIT-PROMPT.md` against the PRD section: **$ARGUMENTS**.

## Steps

1. Read `PRD-AUDIT-PROMPT.md` to load the audit template. If it does not exist at the repo root, stop and ask the user where it lives.
2. Read the relevant PRD section. The current PRD is `_docs/PRD11.md` (or `_docs/PRD-v11.1.md` if that's the newer one — check both). If `$ARGUMENTS` doesn't pin down a specific section, ask before proceeding rather than guess.
3. Read at least one existing file in `audits/` to match the established format, headers, evidence-citation style, and verdict conventions. Do NOT diverge from the existing style.
4. Execute the audit exactly as the template specifies.
5. Write the result to `audits/$(date +%Y-%m-%d)-{section-slug}-findings.md` where `{section-slug}` is a short lowercase, hyphenated form of `$ARGUMENTS` (e.g. `§8.5` → `phase-8-5`, `author credit` → `author-credit`).
6. Cite every claim with a file path and line number. If a claim can't be cited, mark it as inference, not fact.
7. Do NOT commit. Write the file, report the path, and stop.
