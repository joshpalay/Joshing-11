import { defineConfig, globalIgnores } from "eslint/config";
import { builtinRules } from "eslint/use-at-your-own-risk";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Token-enforcement rule (2026-05-30 design audit, cross-cutting recommendation).
// The brand system in globals.css `:root` is the source of truth, but it was
// advisory — components kept reaching past it with raw Tailwind palette colors,
// bg-white/text-black, and arbitrary [#hex] classes. This flags those *in
// className* so new/changed components stay on tokens. (Inline-style hex is left
// alone on purpose — central color maps and icon-color props legitimately use it.)
//
// Banned in className:
//   • Tailwind palette utilities — bg-stone-200, text-emerald-700, border-rose-500…
//   • bg-white / bg-black / text-white / text-black (use --brand-card / --brand-ink)
//   • arbitrary hex — bg-[#fff], text-[#1a1208] (use var(--brand-*) / var(--warm-*))
const TOKEN_LINT_REGEX = [
  "\\b(?:bg|text|border|ring|from|to|via|fill|stroke|decoration|divide|accent|caret|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b",
  "\\b(?:bg|text|border|fill|stroke)-(?:white|black)\\b",
  "\\[#[0-9a-fA-F]{3,8}\\]",
].join("|");

const TOKEN_LINT_RULE = {
  "no-restricted-syntax": [
    "error",
    {
      selector: `JSXAttribute[name.name='className'] Literal[value=/${TOKEN_LINT_REGEX}/]`,
      message:
        "Off-system color in className. Use brand design tokens — var(--brand-*)/var(--warm-*), --brand-card (not bg-white), --brand-ink (not text-black) — instead of Tailwind palette colors or arbitrary [#hex]. See globals.css :root.",
    },
  ],
};

// Files that predate the rule and still carry off-system colors. Grandfathered to
// a warning so the build stays green while the backlog is worked down — new files
// (and any cleaned file removed from this list) are held at error. Shrink this
// list; don't add to it. `npm run lint` pins `--max-warnings` to the current
// total warning count so no lane can silently grow. 16 was the old ceiling for
// this lane + unused-vars; by 2026-09-11 those had fallen to 5 (4 colour, 1
// unused-var) and the ceiling had slack. 103 (2026-09-11) = 5 + the 98
// design-canon warnings from DESIGN_LINT_RULES below (its baseline, measured at
// the Phase 5 build: 29 shadow, 28 pill, 15 btn-override, 11 icon, 11
// animate-pulse, 4 Chip). When you clean a file
// off this list or fix a canon site, drop the `--max-warnings` ceiling in
// package.json by the number of warnings it removed. Never raise it.
const TOKEN_LINT_GRANDFATHERED = [
  "src/components/CreateChooser.tsx",
  "src/components/LoadingScreen.tsx",
  "src/components/SendQuestionDrawer.tsx",
  "src/components/TodaysFiveCard.tsx",
  "src/components/feed/AnswerFeedbackSheet.tsx",
  "src/components/feed/AnswerSheet.tsx",
  "src/components/feed/FeedActions.tsx",
  "src/components/friends/ContactMatchBlock.tsx",
  "src/components/friends/FindFriendsSearch.tsx",
  "src/components/games/QuestionRatingButtons.tsx",
  "src/components/knowledge/AskFriendForDomain.tsx",
  "src/components/profile/SharedInterestsOverlap.tsx",
];

// ── Design-canon lint (B-FABLE-DESIGN-CANON-01, Phase 5; _docs/DESIGN-SYSTEM.md §13) ──
// Structural rules that can be checked on a string-literal className. All at
// `warn`: existing code is the baseline (pinned by `--max-warnings` in the lint
// script, which now covers this lane too), new drift shows up as a warning, and
// the number only goes down. Template-string / cn() classNames are not seen
// here — `npm run check:design` (scripts/audit-design-conformance.mjs) covers
// those with line regexes. Do NOT add a grandfather list for these; fix the
// site or lower nothing.
const CLS = "JSXAttribute[name.name='className'] > Literal";
const BTN_OVERRIDE =
  "\\b(?:min-h-\\d+|h-\\d+|rounded-\\S+|text-(?:xs|sm|base|lg)|font-(?:medium|semibold|bold)|bg-\\[)";
// `(?![\\w-])` so the token name `--btn-primary-bg` never reads as a .btn-primary site.
const BTN_CLASS = "\\bbtn-(?:primary|ghost|danger)(?![\\w-])";
const DESIGN_LINT_RULES = [
  {
    // §2.1 — Tailwind shadow utilities are off-register; use var(--shadow-*).
    // Lookbehind excludes `drop-shadow-lg` (a filter, not a box-shadow register).
    selector: `${CLS}[value=/(?<![\\w-])shadow-(?:sm|md|lg|xl|2xl)\\b/]`,
    message:
      "Tailwind shadow utility is off-register (DESIGN-SYSTEM §2.1). Use shadow-[var(--shadow-card)] / -card-strong / -overlay / -stamp.",
  },
  {
    // §3 — no per-site override of a .btn-* recipe (height, radius, size, weight, fill).
    selector: `${CLS}[value=/${BTN_CLASS}.*${BTN_OVERRIDE}|${BTN_OVERRIDE}.*${BTN_CLASS}/]`,
    message:
      "Overriding a .btn-* recipe at the call site (DESIGN-SYSTEM §3). If a surface needs a different button, it is a different type — decide it in the canon, don't restyle it here.",
  },
  {
    // §7.1 — animate-pulse outside <Skeleton> is drift.
    selector: `${CLS}[value=/\\banimate-pulse\\b/]`,
    message: "Loading placeholders use <Skeleton> (DESIGN-SYSTEM §7.1), not animate-pulse boxes.",
  },
  {
    // §1.4 — a button or input is never a pill (sized round icon buttons are §3.4's business).
    selector: `JSXOpeningElement[name.name=/^(?:button|input)$/] > ${CLS}[value=/^(?!.*\\bsize-(?:9|10|11|12|14)\\b).*\\brounded-full\\b/]`,
    message:
      "Buttons and inputs are never pills (DESIGN-SYSTEM §1.4). Use the .btn-* recipe or --radius-xs; rounded-full is for chips, badges, avatars, the FAB and close controls.",
  },
  {
    // §3.4 — hand-rolled round icon button; use .btn-icon (+ rounded-full only for close/FAB).
    selector: `JSXOpeningElement[name.name='button'] > ${CLS}[value=/^(?!.*\\bbtn-icon\\b)(?=.*\\bsize-(?:9|10|11|12|14)\\b).*\\brounded-full\\b/]`,
    message:
      "Hand-rolled icon button (DESIGN-SYSTEM §3.4). Use .btn-icon (44px square, focus ring); add rounded-full only on a sheet close control or the FAB.",
  },
  {
    // §4.1 — Chip geometry is fixed; callers may not re-pad or re-size it.
    selector: `JSXOpeningElement[name.name='Chip'] > ${CLS}[value=/\\b(?:p[xy]-|text-(?:xs|sm|\\[)|rounded-)/]`,
    message:
      "Chip geometry is not overridable (DESIGN-SYSTEM §4.1). Pass colour via className/style if needed; padding, size and radius come from the primitive.",
  },
];
// The colour lane already owns `no-restricted-syntax` (at `error` in components,
// `warn` in grandfathered files). A rule id carries one severity per file, so
// the design lane gets the same core rule under its own id — `canon/restricted-
// syntax` — and stays at `warn` everywhere without touching the colour lane.
const canonPlugin = {
  rules: { "restricted-syntax": builtinRules.get("no-restricted-syntax") },
};
const DESIGN_LINT_EXEMPT = [
  "src/**/__tests__/**",
  "src/**/*.test.tsx",
  "src/app/dev/**",
  "src/app/feed/debug/**",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    "_salvaged/**",
    ".next/**",
    "node_modules/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    ".drizzle-tmp/**",
    "next-env.d.ts",
  ]),
  // Honor the repo-wide `_`-prefix convention for intentionally-unused bindings
  // (e.g. `(..._args) => …`, a parked `_legacyInsertDeclared`). Without this the
  // default rule warns on them, polluting the warning lane that the
  // `--max-warnings` ratchet (see the `lint` script) is meant to hold flat.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    files: ["src/components/**/*.tsx"],
    rules: TOKEN_LINT_RULE,
  },
  {
    files: TOKEN_LINT_GRANDFATHERED,
    rules: {
      "no-restricted-syntax": ["warn", TOKEN_LINT_RULE["no-restricted-syntax"][1]],
    },
  },
  // Design-canon lane (independent rule id, `warn` everywhere, no grandfather list).
  {
    files: ["src/**/*.tsx"],
    ignores: DESIGN_LINT_EXEMPT,
    plugins: { canon: canonPlugin },
    rules: { "canon/restricted-syntax": ["warn", ...DESIGN_LINT_RULES] },
  },
]);

export default eslintConfig;
