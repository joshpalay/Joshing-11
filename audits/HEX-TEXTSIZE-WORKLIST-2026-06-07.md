# Hex-literal & arbitrary-text-size worklist — 2026-06-07

Companion to `audits/SYSTEM-AUDIT-2026-06-07.md` (findings VIS-1, VIS-2).

## Rule applied
- **Convert only exact matches.** A hex literal is converted **only if its value is byte-identical to a design token** in `src/app/globals.css`; an arbitrary `text-[Npx]` / `text-[N rem]` is converted **only if it equals a Tailwind scale step** (root font-size is the default 16px, confirmed — so px↔rem is 1:1 and nothing is resized).
- **Never change a value that has no system equivalent.** Those are listed below, untouched, to review one by one later.
- **Skip SVG `fill`/canvas/`html2canvas` export surfaces and opacity-modifier classes**, even when the value matches a token — `var()` can fail to render there. Listed under "Deferred (matches a token, but unsafe to auto-convert)".
- Comments that merely mention a hex (e.g. `// Figma #4a5d75`) are left alone.

## Token value → name reference (from globals.css)
`#0a1f3d`=`--brand-ink`/`--ink` · `#091729`=`--brand-ink-950` · `#3a4a5f`=`--brand-ink-700` · `#8a8a8a`=`--brand-ink-400` · `#1f3a5a`=`--brand-navy` · `#4a5d75`=`--brand-link` · `#d15e36`=`--brand-orange` · `#f8e6c7`=`--brand-cream` · `#fcf8f2`=`--brand-cream-page` · `#fdfcfb`=`--brand-card` · `#fbf5e9`=`--brand-cream-card` · `#e9e2d2`=`--brand-border` · `#faf4e9`=`--game-card-question` · `#366045`=`--game-correct` · `#5d6f5b`=`--game-correct-soft` · `#c96b4a`=`--game-wrong` · `#c33d14`=`--game-wrong-strong` · `#fbf4e3`=`--primary-foreground` · `#f1ebdd`=`--secondary`/`--muted`/`--accent` · `#eee7d8`=`--border-light` · `#1a1208`=`--warm-ink` · `#696257`=`--warm-ink-700` · `#7d7568`=`--warm-ink-500` · `#8a8070`=`--warm-ink-400` · `#e8e2d6`=`--warm-border` · `#ddd6c7`=`--warm-border-soft` · `#faf8f2`=`--warm-paper` · `#f5f0e8`=`--warm-cream`

Tailwind scale: `text-xs`=12px · `text-sm`=14px · `text-base`=16px · `text-lg`=18px · `text-xl`=1.25rem/20px · `text-2xl`=24px · `text-3xl`=30px · `text-4xl`=36px · `text-5xl`=48px

---

## ✅ CONVERTED — colors (exact token match, safe context)
| File:line | Was | Now |
|---|---|---|
| `activity/ActivityStreamItem.tsx:293,525` | `color: '#fcf8f2'` | `var(--brand-cream-page)` |
| `activity/DirectQuestionAnswer.tsx:99` | `color: '#fcf8f2'` | `var(--brand-cream-page)` |
| `knowledge/KnowledgeOverviewClient.tsx:233,239` | `1px solid #ddd6c7` | `1px solid var(--warm-border-soft)` |
| `knowledge/KnowledgeOverviewClient.tsx:275` | `color: '#1a1208'` | `var(--warm-ink)` |
| `knowledge/KnowledgeOverviewClient.tsx:284` | `color: '#8a8070'` | `var(--warm-ink-400)` |
| `knowledge/KnowledgeOverviewClient.tsx:291` | `color: '#696257'` | `var(--warm-ink-700)` |
| `knowledge/KnowledgeOverviewClient.tsx:304` | `color: '#faf8f2'` | `var(--warm-paper)` |
| `knowledge/RecentlyExpanding.tsx:239` | `1px solid #ddd6c7` | `1px solid var(--warm-border-soft)` |
| `knowledge/RecentlyExpanding.tsx:242,274,288,310` | `color: '#1a1208'` | `var(--warm-ink)` |
| `knowledge/RecentlyExpanding.tsx:298,317` | `color: '#696257'` | `var(--warm-ink-700)` |
| `profile/RecentlyExploringSection.tsx:119,133` | `color: '#1a1208'` | `var(--warm-ink)` |
| `profile/RecentlyExploringSection.tsx:143` | `color: '#696257'` | `var(--warm-ink-700)` |
| `LoadingScreen.tsx:152` | `text-[#1a1208]` | `text-[var(--warm-ink)]` |
| `app/knowledge/page.tsx:635` | `text-[#faf8f2]` | `text-[var(--warm-paper)]` |

## ✅ CONVERTED — text sizes (exact scale match)
| File:line | Was → Now |
|---|---|
| `FeedList.tsx:1331,1341` | `text-[18px]`→`text-lg` |
| `home/RecentActivitySection.tsx:18` | `text-[12px]`→`text-xs` |
| `home/MissedQuestionsCard.tsx:22` | `text-[16px]`→`text-base` |
| `questions/MyQuestionCard.tsx:51,71` | `text-[12px]`→`text-xs`, `text-[18px]`→`text-lg` |
| `feed/AnswerFeedbackSheet.tsx:259` | `text-[12px]`→`text-xs` |
| `feed/SparkleEnvelope.tsx:58` | `text-[24px]`→`text-2xl` |
| `feed/NewTerritoryUndo.tsx:64,69,87` | `text-[14px]`→`text-sm`, `text-[12px]`→`text-xs` |
| `feed/AnsweredByYouCard.tsx:158,265,291` | `text-[14px]`→`text-sm`, `text-[12px]`→`text-xs`, `text-[16px]`→`text-base` |
| `feed/FeedCard.tsx:30,42,97,139` | `text-[16px]`→`text-base`, `text-[24px]`→`text-2xl`, `text-[14px]`→`text-sm` |
| `feed/DirectSentCard.tsx:34` | `text-[14px]`→`text-sm` |
| `feed/FeedActionLink.tsx:21` | `text-[18px]`→`text-lg` |
| `app/login/LoginPanel.tsx:303,413` | `text-[14px]`→`text-sm` |
| `app/login/page.tsx:26,30` | `text-[48px]`→`text-5xl`, `text-[18px]`→`text-lg` |
| `app/knowledge/page.tsx:647` | `text-[1.25rem]`→`text-xl` |

---

## ⏸ DEFERRED — colors that MATCH a token but are unsafe to auto-convert
Review individually; `var()` may not render in these contexts.
- **`html2canvas` export cards:** `knowledge/SharePortraitCard.tsx:18,19`, `knowledge/SharePortraitModal.tsx:59` (`#8a8a8a`,`#faf8f2`).
- **SVG fill / data-viz / icon-prop:** `knowledge/DomainCircle.tsx:61,63,92,96,135,139,177,185,200,205` (`#0a1f3d`,`#8a8a8a`,`#f5f0e8`), `knowledge/PortraitCircles.tsx:333,334,335,581,582,594,617` (`#1a1208`,`#faf8f2`,`#8a8070`,`#f5f0e8`), `OverlapMap.tsx:26` (`#faf8f2`), `profile/CommonGround.tsx:26,27` (`#1f3a5a`,`#d15e36`), `ShareCard.tsx:122` (`#1a1208`).
- **Opacity-modifier / JS color array:** `LoadingScreen.tsx:17,20,157,158` (`#D15E36`,`#F8E6C7`,`#1a1208/20`,`#1a1208/70`).

## ⏸ DEFERRED — colors with NO system match (leave; decide later)
Grouped; full file:line list follows. Candidates for either a new token or a deliberate keep.
- **Near-token off-by-a-bit creams/borders:** `#f8f3eb`,`#c9bea9`,`#eee8dd`,`#eee6d9`,`#fffdf8`,`#e0dbd0`,`#d4cfc7`,`#c8c0b0`,`#eee7d9`,`#fafafa`,`#f4f4f4`,`#f0f0f0`,`#f5f5f5`,`#ffffff`.
- **Near-black inks not in palette:** `#111111`,`#0e0e0e`,`#3a3a3a`,`#1a1a1a` (ReplaySummary, knowledge/page share button, KnowledgeOverviewClient, OverlapMap).
- **Destructive reds (no `--destructive` hex; it's oklch):** `#b42318`,`#8b1f16`,`#8b1a0e`,`#c0392b`,`#a02500`,`#9b3f37`,`#0f5c30`,`#0a7d2a`.
- **Amber/gold one-offs:** `#d9a82e`,`#d9b56c`,`#c8b900`,`#a07e00`,`#deae5c`,`#edd2a3`,`#fff7e8`,`#fffbe6`,`#a98a4c`,`#7c6332`.
- **Per-category data-viz palettes** (PortraitCircles, SharePortraitCard, RecentlyExpanding, RecentlyExploringSection, FeedEmptyArt, ActivityIcon, Nav, QuickAddQuestionModal): `#5a7a2e #2a4a0e #7a5a8a #4a2a5c #8a2a4a #5c0e2a #4a7a5a #1e4e30 #6b5535 #8b7355 #b0a090 #1a6b8a #0e4060 #6b3fa0 #3d1f6b #b07d2e #7a5010 #2e8b57 #0e5c30 #3a6b8a #1a3f5c #c06b1a #8b3e0e #5a6b7a #2a3f50 #c9564d #65a8bb #2f7487 #12284a #e4e4e4 #c9b08c #f0c060 #6d837f #adb19e #8a8a9a #5a5448`, plus dev-only `points-diagnostic`/`friend-coverage` debug colors (`#1e40af #7c00a0`).
- **Test fixtures (ignore):** `feed/__tests__/FeedCards.test.tsx` `#abc123`.

## ⏸ DEFERRED — text sizes with NO scale match (leave; decide later)
Off-scale values, by frequency: `13px`(24), `0.88rem`(11), `10px`(10), `15px`(7), `11px`(7), `0.62rem`(7), `0.82rem`(6), `0.65rem`(6), `17px`(5), `1.45rem`(4), `0.78rem`(4), `0.6rem`(4), `0.68rem`(4), `2rem`(3), `0.9rem`(3), `0.7rem`(3), `9px`(2), `32px`(2), `22px`(2), `0.76rem`(2), `0.72rem`(2), `1.75rem`(1), `1.22rem`(1), `1.1rem`(1), `1.05rem`(1). Heaviest concentrations: `app/knowledge/page.tsx` (~40), `feed/AnswerFeedbackSheet.tsx`, `feed/AnsweredByYouCard.tsx`, `TodaysFiveCard.tsx`, `login/LoginPanel.tsx` (`17px` ×5). The recurring `13px`/`0.88rem`/`0.82rem`/`0.62rem` cluster suggests the design may want 1–2 *new* named steps rather than snapping to the stock scale — a decision, not a mechanical fix.
