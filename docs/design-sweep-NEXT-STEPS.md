# Design token sweep — status

Full audit context lives in `audits/design-audit-2026-05-30.md` (findings C1–C8,
gitignored). This file tracks what's been applied on `claude/design-audit-fixes`.

---

## Done

**C1–C6 + first token sweep (earlier sessions):** invisible `--accent` fix,
removed fabricated RecentlyExpanding data, off-brand blue progress bar →
`--brand-navy`, game-loop a11y, shared `FeedActionLink`, button consolidation
(deleted shadcn `ui/button`, `.btn-*` utilities are canonical, new `ui/Switch`),
and token sweeps of feed surfaces, GameplayChat, the knowledge/home warm-brown
ramp (now `--warm-ink*` in globals.css), and the game summary pills.

**Remaining items 1–5 (this session):**

1. ✅ **OverlapMap** — raw `#1a1a1a`/`#faf8f2`/`#5a5448` → `--brand-ink` /
   `--brand-card` / `--brand-ink-700`; player colors → `--brand-navy` /
   `--brand-orange`; SVG circle fills moved to CSS `style` so `var()` resolves;
   raw Courier header → `--font-mono`. Brutalist shape (radius 0, offset shadow)
   kept by agreed scope.
2. ✅ **Share cards** — split by render path: `ShareCard` (live DOM) tokenized
   onto the warm-ink ramp; `SharePortraitModal` buttons → `.btn-*` + error text
   tokenized; `SharePortraitCard` left literal **on purpose** (it's rasterized via
   html2canvas with hand-loaded fonts — documented in a header comment).
3. ✅ **C7 — card-shell consolidation** — new `src/components/feed/FeedCardShell.tsx`;
   FeedCard / SparkleEnvelope (triangle variant) / AnsweredByYouCard all render
   through it. 4 focused shell tests added.
4. ✅ **C8 — circles** — `circle-sizing.ts` reworked to one continuous,
   caller-bounded scale (contiguous tier bands; ProgressionLandscape passes tight
   grid bounds, PortraitCircles roomier hero bounds → no more column overflow);
   new `KnowledgeBubble` primitive + `domainBubbleGradient` helper that
   KnowledgeCircle / DomainCircle / PortraitDomainCircle now share. Unit test
   added for the sizing scale. `SharePortraitCard`'s Bubble stays literal (raster).
5. ✅ **Smaller a11y** — Nav inactive tabs → `--brand-ink-700`, labels 9px → 10px;
   GameplayChat reaction pills + "+" button 34px → 44px; both `window.confirm()`
   prompts (unfriend, invite rotation) → inline `.btn-danger`/`.btn-ghost` confirms.

## Not done (deliberately out of scope / future)

- **Cross-cutting enforcement** (audit's top recommendation): a lint rule against
  raw hex / `bg-white` / Tailwind palette colors in `src/components`, so the token
  discipline stays enforced rather than advisory. Highest-leverage next move.
- **Dark mode** has zero brand tokens (audit MINOR) — still generic gray.
- Misc MINORs: `--font-literata` misnaming, muted-text/orange-link AA contrast,
  ASCII glyphs, toast reimplementations.

## Notes for the next session

- Leave the 3 unrelated `daily/*` working-tree files alone — not part of this work.
- Verify after each change: `npx tsc -p tsconfig.typecheck.json` (exit 0) +
  relevant `vitest` suites. There is **one pre-existing** unrelated test failure —
  `DomainCard.test.tsx` "Your q's" — that reproduces with all design changes
  stashed (one of the ~27 known test-infra failures: `vi.mock` exports, LLM mock
  `input_tokens`, the DomainCard assertion). Don't chase it as a regression.
