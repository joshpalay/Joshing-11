# Design token sweep — pick-up prompt

Paste the block below into a future session to resume this work. Full audit
context lives in `audits/design-audit-2026-05-30.md` (findings C1–C8).

---

Pick up the Joshing design-system token sweep from where we left off (work
tracked in `audits/design-audit-2026-05-30.md` — read it first for full context
on the audit findings C1–C8).

**Branch:** `claude/design-audit-fixes`
(PR: https://github.com/joshpalay/Joshing-11/pull/new/claude/design-audit-fixes).
Last commit `21812b0`. Confirm it's still the tip and you're on that branch
before starting — a prior session had commits land on the wrong branch, so
verify `git branch --show-current` and `git log --oneline -6` first.

**Already done (C1–C6 + partial token sweep):** invisible `--accent` fix,
removed fabricated RecentlyExpanding data, off-brand blue progress bar →
`--brand-navy`, game-loop a11y, shared `FeedActionLink`, button consolidation
(deleted shadcn `ui/button`, `.btn-*` utilities are canonical, new `ui/Switch`),
and token sweeps of: feed surfaces, GameplayChat, knowledge/home warm-brown ramp
(now `--warm-ink*` tokens in globals.css), and game summary pills.

**Remaining work, in priority order:**

1. **OverlapMap restyle** (`src/components/OverlapMap.tsx`) — the "brutalist
   inline-style island": `borderRadius:0`, offset `6px 6px 0` shadows, raw
   `#1a1a1a`/`#faf8f2`/`#5a5448`. Decision already made:
   `CREATOR_COLOR`/`RECIPIENT_COLOR` → **navy + orange** (`--brand-navy` /
   `--brand-orange`). Re-tokenize the rest onto brand/warm tokens.
2. **ShareCard / SharePortraitCard / SharePortraitModal** — the `#0e0e0e`
   Courier/Playfair "receipt" palette. First decide *with me* whether this is a
   deliberate rasterized-image style that should stay (and just be documented)
   vs. tokenized.
3. **C7 — card-shell consolidation:** feed has 3 shells (FeedCard top-bar /
   SparkleEnvelope triangle / AnsweredByYouCard left-bar); extract one
   `FeedCardShell`.
4. **C8 — circle-renderer consolidation:** 5 knowledge circle renderers +
   `circle-sizing.ts` non-continuous tier sizes (familiar ≤48px → solid
   156-216px → mastery 304-384px, overflows the column).
5. **Smaller a11y:** Nav 9px mono labels + `text-foreground/55` inactive tabs,
   reaction-pill tap targets, `window.confirm()` replacements.

**Working rules learned the hard way this session:**

- Do git operations **one command per message, sequentially** — never batch
  git/verify steps in parallel (a `grep -c` returning 0 = exit 1 aborts sibling
  calls and leaves half-applied state).
- Read the **real file** before editing — don't edit from a sub-agent's
  paraphrase.
- Leave the 3 unrelated `daily/*` working-tree files alone; they're not part of
  this work.
- Verify after each change: `npx tsc -p tsconfig.typecheck.json` (must be exit 0)
  and `npx vitest run src/components/feed/__tests__/FeedCards.test.tsx`. Note
  ~27 pre-existing test failures are unrelated test-infra issues (vi.mock
  exports, LLM mock `input_tokens`, a DomainCard assertion) — confirm any failure
  reproduces with your changes stashed before worrying about it.

Start with #1 (OverlapMap), commit it, then ask me before #2.
