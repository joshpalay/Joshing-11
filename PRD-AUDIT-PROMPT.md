# Claude Code Prompt: PRD ↔ Codebase Audit (per-section)

## Role

You are auditing one section of the Joshing PRD against the current state of the codebase. The PRD is the canonical source of truth, but the code has moved beyond it in places. Your job is to surface every substantive divergence and walk through them with me **one at a time**, recommending which version should win and taking the corresponding action once I decide.

## Inputs

- **Section to audit:** `<FILL IN — e.g., §8.32 Points and Progression System>`
- **PRD:** the canonical spec is the `PRD-D-*` series (`PRD-D-0`–`PRD-D-4`, the "v12 line") plus `DECISIONS.md`; read those first. For sections the D-series doesn't restate, fall back to the archived v11.x diffs: `_docs/archive/PRD-v11.2.md` (folds v11.3 / v11.4 / v11.5 in place), then `_docs/archive/PRD-v11.1.md` for anything v11.2 doesn't override — treat both as superseded/historical context. Older archived files (`_docs/archive/PRD11.md`, `_docs/archive/Joshing_PRD_v10_25 (1).md`) are legacy — ignore them.
- **Codebase:** the working directory you're running in.
- **Backlog file:** `PRD_BACKLOG.md` at repo root. Create with an `# PRD Update Backlog` header if it doesn't exist.

## What counts as a divergence

Surface only **substantive** divergences:

- Mechanics, rules, or formulas differ (e.g., mastery credit values, threshold logic, scoring math)
- Data shapes, enums, or field names differ in ways that affect behavior or external contracts
- User-facing behavior differs (what the player sees, when events fire, copy register, ceremony beat ordering)
- Canonical product concepts are named or defined differently (e.g., "Challenge World" vs older terminology)
- The PRD specifies something the code doesn't implement, or the code implements something the PRD doesn't describe

**Ignore cosmetic differences:** internal variable names that don't surface to users, file/module structure, comment style, formatting, dependency choices.

## Procedure

1. **Read the named PRD section in full.** If it cross-references other sections that are load-bearing for understanding the rules, read those too.
1. **Locate the corresponding code surface.** Search the repo and state which files/modules you're treating as in-scope for the comparison **before** you begin walking divergences.
1. **Build a complete list of divergences.** Don't show it to me yet — just hold it.
1. **State your plan back to me:** the PRD section, the code files in scope, and the count of divergences you found. Wait for my go.
1. **Walk divergences one at a time** using the format below. After each decision, take the corresponding action, confirm it, then move to the next. Do not batch. Do not skip ahead.

## Per-divergence format

```
### Divergence N of M: <short title>

**PRD (§X.YZ):**
> <quoted or close paraphrase>

**Code (`path/to/file.ts:L42`):**
> <quoted code or described behavior, with file:line>

**Why this is substantive:** <one line>

**Recommendation:** PRD | Code | Depends
**Reasoning:** <2–3 sentences>

Which is correct — PRD, Code, or defer?
```

Then stop and wait.

## Recommendation rubric

When recommending, weigh in this order:

1. **Locked product principles.** Invitation-only, player-authored questions, named author consent, wrong-answers-as-discovery, daily-within-season rhythm, ceremony-as-climax, social-first hierarchy, hyper-specific categories.
1. **Internal coherence with adjacent locked systems.** Mastery rules (1.0x first correct / 0 repeat / 0.25x recovery / 0.5x authorship), two-act ceremony, score privacy (numeric private, authorship shareable), Personal Daily as peer card, etc.
1. **Likelihood the code reflects a real design decision** that simply didn't make it back to the PRD vs. drift that should be corrected.
1. **When genuinely uncertain, say "Depends"** and lay out the tradeoff plainly rather than picking.

## Action branches

**If PRD is right → file a GitHub issue.**

```bash
gh issue create \
  --title "[PRD-Audit] §X.YZ: <short title>" \
  --label "prd-audit" \
  --body "$(cat <<'EOF'
**PRD reference:** §X.YZ <section name>
**Code location:** path/to/file.ts:L42

**PRD specifies:**
<one paragraph>

**Code currently does:**
<one paragraph>

**Required change:**
<one paragraph — what the code should become, concrete enough to act on>
EOF
)"
```

Create the `prd-audit` label if missing (`gh label create prd-audit --color "FBCA04" --description "Code diverges from PRD; code needs to change"`). Confirm the issue URL after creation, then move on.

**If Code is right → append to `PRD_BACKLOG.md`.**

```markdown
## §X.YZ — <short title>
- **Date:** YYYY-MM-DD
- **Section affected:** §X.YZ <section name>
- **Current PRD text:** <one-line summary>
- **Code reality:** <one-line summary, with file:line>
- **Proposed PRD update:** <one paragraph, drafted so it can drop into v10.25 with light editing>
```

**If "Depends" or deferred → append under a `## Open Questions` heading in `PRD_BACKLOG.md`**, with the same fields plus:

```markdown
- **Decision needed:** <the specific question I need to resolve>
```

## Completion summary

When the section is fully walked, post:

- Section audited
- Total divergences found
- Issues filed (count + URLs)
- Backlog entries added (count)
- Open questions deferred (count)

Then stop. Do not start the next section unless I name it.

## Before you begin

Confirm:

1. The PRD filename you found and the section name I gave you.
1. The code files you'll audit against it.
1. Your count of divergences.

Then wait for my go.
