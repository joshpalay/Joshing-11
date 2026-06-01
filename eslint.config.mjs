import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

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
  '\\b(?:bg|text|border|ring|from|to|via|fill|stroke|decoration|divide|accent|caret|outline)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b',
  '\\b(?:bg|text|border|fill|stroke)-(?:white|black)\\b',
  '\\[#[0-9a-fA-F]{3,8}\\]',
].join('|');

const TOKEN_LINT_RULE = {
  'no-restricted-syntax': [
    'error',
    {
      selector: `JSXAttribute[name.name='className'] Literal[value=/${TOKEN_LINT_REGEX}/]`,
      message:
        'Off-system color in className. Use brand design tokens — var(--brand-*)/var(--warm-*), --brand-card (not bg-white), --brand-ink (not text-black) — instead of Tailwind palette colors or arbitrary [#hex]. See globals.css :root.',
    },
  ],
};

// Files that predate the rule and still carry off-system colors. Grandfathered to
// a warning so the build stays green while the backlog is worked down — new files
// (and any cleaned file removed from this list) are held at error. Shrink this
// list; don't add to it.
const TOKEN_LINT_GRANDFATHERED = [
  'src/components/AddToBankAction.tsx',
  'src/components/CreateChooser.tsx',
  'src/components/LoadingScreen.tsx',
  'src/components/QuestionForm.tsx',
  'src/components/SendQuestionDrawer.tsx',
  'src/components/TodaysFiveCard.tsx',
  'src/components/feed/AnswerFeedbackSheet.tsx',
  'src/components/feed/AnswerSheet.tsx',
  'src/components/feed/FeedActions.tsx',
  'src/components/feed/FeedCard.tsx',
  'src/components/feed/SparkleEnvelope.tsx',
  'src/components/friends/ContactMatchBlock.tsx',
  'src/components/friends/FindFriendsSearch.tsx',
  'src/components/games/QuestionRatingButtons.tsx',
  'src/components/home/CeremonyPin.tsx',
  'src/components/knowledge/AskFriendForDomain.tsx',
  'src/components/profile/AuthoredQuestionsFeed.tsx',
  'src/components/profile/InlineEditableField.tsx',
  'src/components/profile/InlineHandleField.tsx',
  'src/components/profile/PreviewBanner.tsx',
  'src/components/profile/SharedInterestsOverlap.tsx',
  'src/components/profile/settings/NotificationsForm.tsx',
  'src/components/replay/ReplaySummary.tsx',
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '_salvaged/**',
    '.next/**',
    'node_modules/**',
    'out/**',
    'build/**',
    'dist/**',
    'coverage/**',
    '.drizzle-tmp/**',
    'next-env.d.ts',
  ]),
  {
    files: ['src/components/**/*.tsx'],
    rules: TOKEN_LINT_RULE,
  },
  {
    files: TOKEN_LINT_GRANDFATHERED,
    rules: {
      'no-restricted-syntax': ['warn', TOKEN_LINT_RULE['no-restricted-syntax'][1]],
    },
  },
]);

export default eslintConfig;
