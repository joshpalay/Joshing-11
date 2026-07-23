# Application typography audit and normalization

## Audit scope

The audit covered all shipped React surfaces under `src/app` and `src/components`, including headings, question cards, supporting copy, metadata, controls, navigation, dialogs, forms, errors, empty states, toasts, badges, cards, and list rows. It also inspected inline style objects and Tailwind arbitrary-value utilities.

## Findings

The application had accumulated three visible font voices (Josefin Sans, Cormorant Garamond, and Montserrat), plus historical `mono`, `neutral`, and `display` aliases. Feature code mixed the named Tailwind scale with hundreds of arbitrary pixel/rem sizes. Controls were the largest drift source: button labels ranged from metadata-sized text to body text, used medium through bold weights, and mixed uppercase, title case, sentence case, and custom tracking. Chips and tabs frequently used editorial uppercase treatment even when they were interactive controls. Display and card headings also used overlapping sizes without a stable semantic boundary.

## Normalized system

| Role | Size | Weight | Tracking / case |
| --- | ---: | ---: | --- |
| Display title | 32px | 700 | -0.03em |
| Page title | 24px | 600 | -0.02em |
| Section heading | 17px | 600 | -0.01em |
| Question / card title | 18px | 600 | normal |
| Body | 16px | 400 | normal |
| Supporting | 14px | 400 | normal |
| Metadata | 12px | 500 | normal |
| Eyebrow | 11px | 600 | 0.08em, uppercase |
| Button | 15px | 600 | sentence case |
| Small button | 13px | 600 | sentence case |
| Tab | 14px | 500/600 selected | sentence case |
| Chip / pill | 12px | 600 | sentence case |
| Top navigation | 14px | 600 | sentence case |
| Bottom navigation | 11px | 500/600 selected | sentence case |

Inter is the only font family. The semantic recipes are defined once in `globals.css` and exposed to components through `src/design/typography.ts`. Historical font aliases resolve to Inter to protect older inline and canvas-driven surfaces during migration.

## Verification policy

New feature code must select a semantic role from `typography.ts`; it must not compose `fontSize`, `fontWeight`, or `letterSpacing`. Uppercase remains reserved for non-interactive editorial eyebrow labels. Global control selectors provide a final guard against legacy utility ordering, ensuring buttons, tabs, chips, and pills cannot drift in weight, tracking, or capitalization.
