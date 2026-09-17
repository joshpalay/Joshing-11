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
  // Same prefix list as the palette line above. It used to be the short set
  // (bg|text|border|fill|stroke), so `ring-black/5`, `divide-white`,
  // `from-black` and friends slipped through — login/page.tsx was carrying one.
  // Keep the two lists identical.
  "\\b(?:bg|text|border|ring|from|to|via|fill|stroke|decoration|divide|accent|caret|outline)-(?:white|black)\\b",
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
// animate-pulse, 4 Chip). **88 (2026-09-13)** = 103 − the 15 btn-override
// warnings, closed by the button codemod. **63 (2026-09-13)** = 88 − 25 of the
// 29 shadow warnings, closed by the shadow codemod (the other 4 were in
// template strings the selector never saw; `check:design` R1 counts those).
// **52 (2026-09-13)** = 63 − 10 icon buttons folded onto .btn-icon − 1 ceremony
// file now exempt. **41 (2026-09-13)** = 52 − 7 placeholders folded onto
// <Skeleton> − 4 pulsing text labels the selector no longer treats as
// placeholders. **37 (2026-09-13)** = 41 − the last 4 chip shadows, closed by
// ratifying §2.2a. When you clean a file
// off this list or fix a canon site, drop the `--max-warnings` ceiling in
// package.json by the number of warnings it removed. Never raise it.
//
// **18 → 48 (2026-09-17) — the one sanctioned raise, and why it is not a
// regression.** The rule's scope widened from `src/components/**` to `src/**`.
// Nothing got worse; 30 pre-existing violations became VISIBLE that the rule had
// never been able to see, because it stopped at a folder boundary that has no
// design meaning. The alternative — widening the scope and leaving the ceiling
// at 18 — would have meant either failing the build on day one or quietly
// exempting the files, and exempting them is how this hole was dug. So: park
// them as warnings, name each cluster above, and ratchet back down.
// The "never raise it" contract still stands for every other case: a raise is
// legitimate ONLY when the net gets wider, never when the code gets worse, and
// the new number must be the measured count on the day — not a round number
// with headroom.
//
// **48 → 30 (2026-09-17, same day).** LoginPanel — the biggest of the three
// newly-visible clusters, and the most-seen screen in the app — was CLEANED, not
// parked: all 21 sites (19 the lint could see, plus 2 hiding in shared class
// constants the JSXAttribute selector never reads) moved onto
// `--warm-ink` / `--brand-card`, keeping every opacity step exactly as it was.
// The swap is close to invisible because the login screen's own ink token is
// `--warm-ink #1a1208`, a brown-black — the surrounding login/page.tsx was
// already on it; only the panel had been left behind. Four stragglers went with
// it: one `text-white` badge onto `--primary-foreground`, and three
// `ring-black/5` card hairlines onto `--brand-ink`/5, which the rule had never
// flagged because the white/black alternative was missing the `ring` prefix
// (now aligned with the palette line — see TOKEN_LINT_REGEX).
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
  // Added 2026-09-17 when the rule's scope widened from `src/components/**` to
  // `src/**` (see the block above). These are NOT new drift — they are drift the
  // rule could never see, because it stopped at the folder boundary. They are
  // parked as warnings, not exempted, and each needs a real pass:
  //   • share/ceremony/[token] (7, across page + not-found) — a PUBLIC share
  //     landing on a raw `bg-stone-950`/`text-stone-50` dark theme. Strangers see
  //     this page, so it is the least defensible of the two; it needs a proper
  //     dark-surface token set, which does not exist yet.
  //   • TerritorySetupClient (4) — `bg-white/40`-style scrims on the drag surface
  //     whose "raised" register is separately deferred (see RULE_EXEMPT.R6).
  // LoginPanel was the third, and was CLEANED rather than parked on 2026-09-17 —
  // see the ceiling note above. Do not re-add it.
  // Directory glob, NOT the two literal paths: the route segment is `[token]`,
  // and eslint runs these through minimatch, where `[token]` is a character
  // class matching one of t/o/k/e/n — so the literal path silently never
  // matches. Any dynamic-route file added to this list needs the same shape.
  "src/app/share/ceremony/**",
  "src/app/daily/setup/TerritorySetupClient.tsx",
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
    // §7.1 — an animate-pulse PLACEHOLDER BLOCK outside <Skeleton> is drift. A
    // pulsing text label ("Loading questions…") is a different pattern with
    // nothing to stand in for; `text-` separates them. Kept in step with R7's
    // skipLine in scripts/audit-design-conformance.mjs.
    selector: `${CLS}[value=/^(?!.*\\btext-).*\\banimate-pulse\\b/]`,
    message:
      "Loading placeholders use <Skeleton> (DESIGN-SYSTEM §7.1), not animate-pulse boxes.",
  },
  {
    // §1.4 — a button or input is never a pill (sized round icon buttons are
    // §3.4's business). `btn-icon rounded-full` is the sanctioned circular icon
    // button and is excluded: its size-11 comes from the recipe, so the
    // size-N lookahead alone would not spare it.
    selector: `JSXOpeningElement[name.name=/^(?:button|input)$/] > ${CLS}[value=/^(?!.*\\bbtn-icon\\b)(?!.*\\bsize-(?:9|10|11|12|14)\\b).*\\brounded-full\\b/]`,
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
    // §9.2 — killing the focus outline without putting a ring back leaves an
    // element with no focus indicator. `outline-none` is only correct when the
    // same element also draws `ring-*`.
    selector: `${CLS}[value=/^(?!.*\\bring-).*outline-none\\b/]`,
    message:
      "This kills the focus outline and puts nothing back (DESIGN-SYSTEM §9.2). Either drop outline-none and inherit the app's focus ring, or pair it with focus-visible:ring-2 ring-ring ring-offset-2.",
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
  // The weekly ceremony renders as full-bleed saturated "rooms" with reversed
  // type — an immersive surface exempted by DESIGN-SYSTEM §11. Its chrome is
  // tuned to the room (the Exit control takes its colour from the beat's theme
  // and hovers on white/10), so the neutral recipes do not apply. Kept in step
  // with RULE_EXEMPT.R6 in scripts/audit-design-conformance.mjs.
  "src/app/ceremony/**",
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
    // Extended from `src/components/**` to all of `src/**` on 2026-09-17.
    // The components-only scope was a real hole: `knowledge/[domain]`'s answer
    // history rendered grading as `text-green-700` / `text-destructive` —
    // breaking STYLE-GUIDE-COLOR §1's "exactly one correct and one wrong value"
    // — and nothing flagged it for months, because the file lives under
    // `src/app/**`. Route handlers and pages paint the same pixels as
    // components; there was never a reason for the rule to stop at the folder.
    files: ["src/**/*.tsx"],
    // Same exemption list as the design-canon lane: tests, the dev palette, the
    // feed debug page, and the ceremony rooms (immersive saturated surfaces with
    // reversed type, exempted by DESIGN-SYSTEM §11 — their chrome is tuned to the
    // room, and the Exit control hovers on white/10 by design). Before this,
    // dev/ and ceremony/ were exempt from every design lane EXCEPT this one,
    // purely because this one never reached outside src/components.
    ignores: DESIGN_LINT_EXEMPT,
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
