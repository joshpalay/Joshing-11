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
4. ✅ **C8 — circles** — split into two scales: ProgressionLandscape's tight grid
   uses the continuous, column-bounded `getDomainCircleSize` (fixes the real
   overflow); the PortraitCircles hero keeps its original large, dramatic per-tier
   diameters via `getPortraitCircleSize` (it free-wraps and never overflowed, so it
   stays big — see "portrait restore" below). New `KnowledgeBubble` primitive +
   `domainBubbleGradient` helper shared by KnowledgeCircle / DomainCircle /
   PortraitDomainCircle. Unit tests cover both scales. `SharePortraitCard`'s Bubble
   stays literal (raster).
5. ✅ **Smaller a11y** — Nav inactive tabs → `--brand-ink-700`, labels 9px → 10px;
   GameplayChat reaction pills + "+" button 34px → 44px; both `window.confirm()`
   prompts (unfriend, invite rotation) → inline `.btn-danger`/`.btn-ghost` confirms.

## Also done (follow-ups)

- ✅ **Token-enforcement lint rule** (audit's top cross-cutting recommendation):
  `no-restricted-syntax` in `eslint.config.mjs` flags Tailwind palette colors /
  `bg-white`/`text-black` / arbitrary `[#hex]` in `className` under
  `src/components/**`. It's a **ratchet** — 23 backlog files are grandfathered to
  `warn` (build stays green) while new/cleaned files are held at `error`. The
  grandfather list in `eslint.config.mjs` should shrink over time; don't add to it.
- ✅ **Portrait circles restored** — the C8 rework had shrunk PortraitCircles'
  mastery circles to 168px; reverted to the original 304–384px hero sizes (the
  portrait free-wraps and never overflowed — only the grid did).

## Not done (deliberately out of scope / future)

- **Work down the lint grandfather list** — 23 components still carry off-system
  colors in className (now visible as warnings). Tokenizing them removes each from
  the grandfather list and flips it to enforced.
- **Pre-existing lint errors:** `npm run lint` shows 5 `react-hooks/react` errors
  (e.g. `set-state-in-effect`) in untouched files (AddToBankAction,
  SendQuestionDrawer, useCatchupFlow, DomainRow). They reproduce with all design
  work stashed — separate from this effort.
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
