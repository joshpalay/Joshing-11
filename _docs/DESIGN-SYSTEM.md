# Joshing — Design System Reference

A consolidated inventory of every design token, font, component variant, and brand cue currently shipped in the Joshing web app. Use this as the source-of-truth when recreating the system in Figma (variables, styles, components).

Last verified against the codebase on 2026-05-19.

**Source files (single source of truth):**
- Tokens: `src/app/globals.css`
- Fonts: `src/app/layout.tsx`
- Buttons: `src/components/ui/button.tsx`
- Custom icons: `src/components/icons/domain-icons.tsx`
- shadcn config: `components.json`

---

## 1. Colors

All colors are authored in **OKLCh** (perceptually uniform). Hex approximations are provided for Figma input where OKLCh isn't supported; prefer OKLCh in Figma variables if you can.

### 1.1 Semantic tokens — Light mode (`:root`)

| Token | OKLCh | Hex (approx) | Used for |
|---|---|---|---|
| `--background` | `oklch(1 0 0)` | `#ffffff` | App background |
| `--foreground` | `oklch(0.145 0 0)` | `#252525` | Body text |
| `--card` | `oklch(1 0 0)` | `#ffffff` | Card surface |
| `--card-foreground` | `oklch(0.145 0 0)` | `#252525` | Text on cards |
| `--popover` | `oklch(1 0 0)` | `#ffffff` | Popover/menu surface |
| `--popover-foreground` | `oklch(0.145 0 0)` | `#252525` | Text in popovers |
| `--primary` | `oklch(0.205 0 0)` | `#343434` | Primary fill (buttons, etc.) |
| `--primary-foreground` | `oklch(0.985 0 0)` | `#fbfbfb` | Text on primary |
| `--secondary` | `oklch(0.97 0 0)` | `#f6f6f6` | Secondary fill |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `#343434` | Text on secondary |
| `--muted` | `oklch(0.97 0 0)` | `#f6f6f6` | Muted surface |
| `--muted-foreground` | `oklch(0.556 0 0)` | `#8a8a8a` | Muted text |
| `--accent` | `oklch(0.97 0 0)` | `#f6f6f6` | Accent fill (hover states) |
| `--accent-foreground` | `oklch(0.205 0 0)` | `#343434` | Text on accent |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `#dc2626` | Errors, destructive actions |
| `--border` | `oklch(0.922 0 0)` | `#e7e7e7` | Default borders |
| `--input` | `oklch(0.922 0 0)` | `#e7e7e7` | Input borders |
| `--ring` | `oklch(0.708 0 0)` | `#b5b5b5` | Focus rings |

### 1.2 Semantic tokens — Dark mode (`.dark`)

| Token | OKLCh | Hex (approx) |
|---|---|---|
| `--background` | `oklch(0.145 0 0)` | `#252525` |
| `--foreground` | `oklch(0.985 0 0)` | `#fbfbfb` |
| `--card` | `oklch(0.205 0 0)` | `#343434` |
| `--card-foreground` | `oklch(0.985 0 0)` | `#fbfbfb` |
| `--popover` | `oklch(0.205 0 0)` | `#343434` |
| `--popover-foreground` | `oklch(0.985 0 0)` | `#fbfbfb` |
| `--primary` | `oklch(0.922 0 0)` | `#e7e7e7` |
| `--primary-foreground` | `oklch(0.205 0 0)` | `#343434` |
| `--secondary` | `oklch(0.269 0 0)` | `#444444` |
| `--secondary-foreground` | `oklch(0.985 0 0)` | `#fbfbfb` |
| `--muted` | `oklch(0.269 0 0)` | `#444444` |
| `--muted-foreground` | `oklch(0.708 0 0)` | `#b5b5b5` |
| `--accent` | `oklch(0.269 0 0)` | `#444444` |
| `--accent-foreground` | `oklch(0.985 0 0)` | `#fbfbfb` |
| `--destructive` | `oklch(0.704 0.191 22.216)` | `#ef4444` |
| `--border` | `oklch(1 0 0 / 10%)` | `rgba(255,255,255,0.10)` |
| `--input` | `oklch(1 0 0 / 15%)` | `rgba(255,255,255,0.15)` |
| `--ring` | `oklch(0.556 0 0)` | `#8a8a8a` |

### 1.3 Brand palette — "Ink on Cream" editorial register

Defined in `globals.css` lines 96-103. Hex approximations are authored as comments in source — use them directly in Figma.

| Token | OKLCh | Hex | Role |
|---|---|---|---|
| `--ink` | `oklch(0.14 0.018 55)` | `#1a1208` | Warm near-black (primary editorial ink) |
| `--cream` | `oklch(0.976 0.010 80)` | `#fdfbf6` | Off-white page surface |
| `--cream-warm` | `oklch(0.962 0.018 80)` | `#f5f0e8` | Slightly deeper warm surface |
| `--cream-accent` | `oklch(0.930 0.030 80)` | `#f0e6c8` | Highlight / accent fill |
| `--border-warm` | `oklch(0.876 0.016 80)` | `#ddd6c7` | Warm border on cream |
| `--border-light` | `oklch(0.905 0.010 80)` | `#e8e2d6` | Inner / lighter border |
| `--text-muted-warm` | `oklch(0.600 0.020 60)` | `#696257` | Muted editorial body text |

### 1.4 Functional / status colors

| Token | Value | Use |
|---|---|---|
| `--success` | `#178245` | Correct answers, positive confirmations |
| `--danger` | `var(--destructive)` | Aliased to destructive |
| `--wrong` | `var(--destructive)` | Wrong-answer signal |
| `--user-bubble` (light) | `oklch(0.62 0.18 250)` | User chat bubble fill |
| `--user-bubble` (dark) | `oklch(0.58 0.18 250)` | User chat bubble fill (dark) |
| `--user-bubble-foreground` | `oklch(0.99 0 0)` | Text in user bubble |

### 1.5 Chart scale (grayscale, 5 stops)

| Token | OKLCh |
|---|---|
| `--chart-1` | `oklch(0.87 0 0)` |
| `--chart-2` | `oklch(0.556 0 0)` |
| `--chart-3` | `oklch(0.439 0 0)` |
| `--chart-4` | `oklch(0.371 0 0)` |
| `--chart-5` | `oklch(0.269 0 0)` |

### 1.6 Sidebar tokens

| Token | Light | Dark |
|---|---|---|
| `--sidebar` | `oklch(0.985 0 0)` | `oklch(0.205 0 0)` |
| `--sidebar-foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-primary` | `oklch(0.205 0 0)` | `oklch(0.488 0.243 264.376)` *(violet)* |
| `--sidebar-primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-accent` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` |
| `--sidebar-accent-foreground` | `oklch(0.205 0 0)` | `oklch(0.985 0 0)` |
| `--sidebar-border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` |
| `--sidebar-ring` | `oklch(0.708 0 0)` | `oklch(0.556 0 0)` |

### 1.7 Tailwind utility colors actually used in components

Worth holding as named Figma swatches because they appear directly in component classes:

`stone-50, stone-100, stone-200, stone-800, stone-950`  
`sky-200`

**Now tokenized** (no longer reach for the raw utility): the amber/warning and the
success/error status colors below resolved into semantic tokens in `globals.css :root`.

| Was (raw utility) | Now (token) |
|---|---|
| `amber-50/100` fills, `amber-300` borders, `amber-700/800/900/950` text | `--warning-surface` / `--warning-border` / `--warning` |
| `emerald-600/700` text | `--success` |
| `emerald-50` fill, `emerald-200` border | `--success-surface` / `--success-border` |
| `red-700 / rose-700` text | `--destructive` |
| `red-50 / rose-50` fill, `red-200 / rose-200` border | `--destructive-surface` / `--destructive-border` |

---

## 2. Typography

### 2.1 Font families

Loaded via `next/font/google` in `src/app/layout.tsx`. Each is exposed as a CSS variable so it can be referenced from Tailwind utilities and CSS classes.

| Family | CSS variable | Style | Register / purpose |
|---|---|---|---|
| **Montserrat** | `--font-sans-body` (consumed as `--font-sans`) | Regular weights | Body text, UI labels, default everywhere. (PRD §typography spec'd Inter; Montserrat is the intentional shipped choice — see comment at `layout.tsx:9-10`.) |
| **Caveat** | `--font-handwriting` | Regular | Handwriting register — Personal Record, annotations, signature-style microcopy (F5.1) |
| **Playfair Display** | `--font-display` (also via `--font-literata`) | Italic only | Editorial italic — category names (Categories on Portrait, PortraitCircles labels) (F5.2) |
| System mono | `--font-mono` | — | `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace` |
| System sans fallback | `--font-neutral` | — | `ui-sans-serif, system-ui, -apple-system, sans-serif` |

### 2.2 Type scale

Tailwind defaults; these are the sizes used in components. Add them as Figma text styles.

| Token | rem | px |
|---|---|---|
| `text-xs` | 0.75rem | 12px |
| `text-sm` | 0.875rem | 14px |
| `text-base` | 1rem | 16px |
| `text-lg` | 1.125rem | 18px |
| `text-xl` | 1.25rem | 20px |
| `text-2xl` | 1.5rem | 24px |
| `text-3xl` | 1.875rem | 30px |
| `text-4xl` | 2.25rem | 36px |
| `text-5xl` | 3rem | 48px |

Plus one inline non-standard size from `button.tsx`: **`text-[0.8rem]` = 12.8px** (small-button label).

### 2.3 Font weights in use

| Token | Weight |
|---|---|
| `font-medium` | 500 |
| `font-semibold` | 600 |
| `font-bold` | 700 |

Regular (400) is the implicit default and is heavily used.

---

## 3. Spacing

Tailwind 4px base scale. These are the increments actually referenced in components — Figma spacing variables only need to cover this range.

| Token | rem | px |
|---|---|---|
| `0` | 0 | 0 |
| `0.5` | 0.125rem | 2 |
| `1` | 0.25rem | 4 |
| `1.5` | 0.375rem | 6 |
| `2` | 0.5rem | 8 |
| `2.5` | 0.625rem | 10 |
| `3` | 0.75rem | 12 |
| `4` | 1rem | 16 |
| `5` | 1.25rem | 20 |
| `6` | 1.5rem | 24 |
| `7` | 1.75rem | 28 |
| `8` | 2rem | 32 |
| `12` | 3rem | 48 |
| `14` | 3.5rem | 56 |
| `16` | 4rem | 64 |
| `20` | 5rem | 80 |
| `24` | 6rem | 96 |
| `28` | 7rem | 112 |

### 3.1 Common element heights

| Token | px | Use |
|---|---|---|
| `h-6` | 24 | Button size `xs`, `icon-xs` |
| `h-7` | 28 | Button size `sm`, `icon-sm` |
| `h-8` | 32 | Button size `default`, `icon` |
| `h-9` | 36 | Button size `lg`, `icon-lg` |
| `h-10` (`min-h-10`) | 40 | `.btn-primary`, `.btn-ghost` recipes |
| `h-11` | 44 | Touch-target alt height |
| `h-12` | 48 | Large surfaces |

### 3.2 Breakpoints

| Token | Min width |
|---|---|
| `sm:` | 640px |
| `md:` | 768px (the most common breakpoint in this codebase) |
| `lg:` | 1024px |
| `xl:` | 1280px |
| `2xl:` | 1536px |

Mobile-first: styles without a prefix apply at all sizes; `md:*` upgrades the layout on tablet/desktop.

---

## 4. Radius

Defined in `globals.css` `@theme inline` block as `calc()` multiples of `--radius` (`0.625rem` / 10px).

| Token | Formula | rem | px |
|---|---|---|---|
| `--radius-sm` | `--radius × 0.6` | 0.375rem | 6 |
| `--radius-md` | `--radius × 0.8` | 0.5rem | 8 |
| `--radius-lg` | `--radius × 1.0` | 0.625rem | 10 |
| `--radius-xl` | `--radius × 1.4` | 0.875rem | 14 |
| `--radius-2xl` | `--radius × 1.8` | 1.125rem | 18 |
| `--radius-3xl` | `--radius × 2.2` | 1.375rem | 22 |
| `--radius-4xl` | `--radius × 2.6` | 1.625rem | 26 |
| `rounded-full` | — | — | 9999 |

---

## 5. Shadows & Effects

### 5.1 Shadows

| Token | Value | Use |
|---|---|---|
| `--shadow-paper-rest` | `0 1px 2px rgb(0 0 0 / 0.05)` | Resting "paper" lift on cream surfaces |
| `shadow-sm` (Tailwind) | `0 1px 2px 0 rgb(0 0 0 / 0.05)` | `.card` recipe |
| `shadow-lg` | `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)` | Floating elements |
| `shadow-xl` | `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)` | Modals, popovers |
| `shadow-2xl` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` | Heavy elevation |

### 5.2 Focus / interaction conventions

| Pattern | Class | Effect |
|---|---|---|
| Focus ring | `focus-visible:ring-3 focus-visible:ring-ring/50` | 3px ring at 50% `--ring` opacity |
| Invalid input | `aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20` | Destructive border + 20% ring |
| Press-down | `active:translate-y-px` | 1px downward shift on click |
| Hover dim | `hover:opacity-90` | 90% opacity on primary buttons |
| Disabled | `disabled:pointer-events-none disabled:opacity-50` (buttons) / `opacity-45` (custom recipes) | Greyed + non-interactive |

### 5.3 Transitions

Default `transition-all` / `transition-colors` / `transition-transform`, using Tailwind's default duration (150ms) for most cases.

---

## 6. Component Patterns

### 6.1 Button — variants

From `src/components/ui/button.tsx`. Base classes include: `rounded-lg`, `text-sm`, `font-medium`, `border border-transparent`, `bg-clip-padding`, `transition-all`.

| Variant | Fill | Text | Hover | Notes |
|---|---|---|---|---|
| `default` | `bg-primary` | `text-primary-foreground` | `bg-primary/80` (when rendered as `<a>`) | The standard CTA |
| `outline` | `bg-background` + `border-border` | inherit | `bg-muted` + `text-foreground` | Dark mode: `bg-input/30` → `bg-input/50` |
| `secondary` | `bg-secondary` | `text-secondary-foreground` | `bg-secondary/80` | |
| `ghost` | transparent | inherit | `bg-muted` + `text-foreground` | Dark mode hover: `bg-muted/50` |
| `destructive` | `bg-destructive/10` | `text-destructive` | `bg-destructive/20` | Destructive ring on focus |
| `link` | transparent | `text-primary` | `underline` (offset-4) | |

### 6.2 Button — sizes

| Size | Height | Padding-X | Text | Icon size | Radius |
|---|---|---|---|---|---|
| `xs` | h-6 (24) | px-2 (8) | `text-xs` (12) | size-3 (12) | `min(--radius-md, 10px)` |
| `sm` | h-7 (28) | px-2.5 (10) | `text-[0.8rem]` (12.8) | size-3.5 (14) | `min(--radius-md, 12px)` |
| `default` | h-8 (32) | px-2.5 (10) | `text-sm` (14) | size-4 (16) | `rounded-lg` (10) |
| `lg` | h-9 (36) | px-2.5 (10) | `text-sm` (14) | size-4 (16) | `rounded-lg` (10) |
| `icon` | size-8 (32×32) | — | — | size-4 (16) | `rounded-lg` (10) |
| `icon-xs` | size-6 (24×24) | — | — | size-3 (12) | `min(--radius-md, 10px)` |
| `icon-sm` | size-7 (28×28) | — | — | size-4 (16) | `min(--radius-md, 12px)` |
| `icon-lg` | size-9 (36×36) | — | — | size-4 (16) | `rounded-lg` (10) |

Buttons inside `[data-slot=button-group]` revert to `rounded-lg` regardless of size (so groups align cleanly).

### 6.3 Card recipe

```css
.card {
  @apply rounded-lg border bg-card text-card-foreground shadow-sm;
}
```

In Figma terms:
- Radius: 10px (`--radius-lg`)
- Stroke: 1px `--border`
- Fill: `--card`
- Text: `--card-foreground`
- Shadow: `shadow-sm` (`0 1px 2px 0 rgb(0 0 0 / 0.05)`)

### 6.4 Standalone button recipes (used outside the `<Button>` component)

```css
.btn-primary {
  /* inline-flex, min-h-10 (40px), rounded-md (8px), bg-primary,
     px-4 py-2, text-sm, font-medium, text-primary-foreground,
     transition, hover:opacity-90, disabled:opacity-45 */
}

.btn-ghost {
  /* inline-flex, min-h-10 (40px), rounded-md (8px), border,
     bg-background, px-4 py-2, text-sm, font-medium,
     text-foreground, transition, hover:bg-muted,
     disabled:opacity-45 */
}
```

---

## 7. Iconography

### 7.1 Library

**lucide-react** (set in `components.json` → `"iconLibrary": "lucide"`). All standard UI icons come from lucide.

Common lucide icons in use, grouped:
- **Navigation:** `Home`, `Menu`, `X`, `User`, `Brain`, `Rss`, `Pencil`
- **Actions:** `Send`, `Bookmark`, `Search`, `Settings`, `Plus`, `Edit`, `Trash`
- **Status:** `CheckCircle2`, `Check`, `ThumbsUp`, `ThumbsDown`, `Heart`, `Flag`
- **UI:** `ChevronLeft`, `ChevronRight`, `MoreHorizontal`, `Lock`, `Loader`, `MessageCircleQuestion`, `Clock`
- **Gameplay:** `Gamepad2`, `Sparkles`

Within buttons icons default to **16×16** (`size-4`), 12×12 (`size-3`) in `xs`, 14×14 (`size-3.5`) in `sm`.

### 7.2 Custom domain icons

Hand-drawn SVGs in `src/components/icons/domain-icons.tsx`. All share the same stroke convention:

- `viewBox="0 0 24 24"`
- `fill: none`
- `stroke-width: 1.8`
- `stroke-linecap: round`
- `stroke-linejoin: round`
- Stroke color is parameterized (defaults to `currentColor` via the `color` prop)

| Export | Trivia category |
|---|---|
| `LiteraturePoetryIcon` | Literature → Poetry |
| `LiteratureNovelIcon` | Literature → Novel |
| `ClassicalMusicIcon` | Classical music |
| `OperaIcon` | Opera |
| `HistoryCampaignsIcon` | History → Campaigns |
| `HistoryGeneralIcon` | History → General |
| `PhilosophyIcon` | Philosophy |
| `ScienceIcon` | Science |
| `LanguageIcon` | Language |
| `PopCultureIcon` | Pop culture |
| `FilmTvIcon` | Film & TV |
| `SportIcon` | Sport |
| `DomainInitialIcon` | Generic — letter-in-circle fallback when a domain has no custom glyph |

For Figma: rebuild each as a 24×24 component with a 1.8px round stroke, no fill, and a single color override. Recreate `DomainInitialIcon` as a variant with a configurable letter property.

---

## 8. Brand Register / Voice

Cues sourced from comments and structure in `globals.css` and `layout.tsx`.

**Surface:** "Ink on Cream" editorial register. The default monochrome shadcn surfaces (white/gray) coexist with a warmer brand palette built around `--ink` (warm near-black) on `--cream` / `--cream-warm` / `--cream-accent` surfaces, separated by `--border-warm` / `--border-light` strokes. Reach for the cream palette on long-form / editorial surfaces; use the neutral shadcn semantics for interactive chrome.

**Three typographic registers:**
1. **Body (Montserrat)** — every UI label, paragraph, button. The workhorse.
2. **Handwriting (Caveat)** — applied sparingly: Personal Record, marginal annotations, signature-style microcopy. Suggests a hand on a page.
3. **Editorial italic (Playfair Display)** — italic-only, reserved for category names on Portrait and PortraitCircles labels. Signals "editorial / archival."

**Color space:** OKLCh throughout. Tokens declare lightness + chroma + hue separately, which keeps hue consistent as lightness shifts (important for the warm cream tints). When porting to Figma, prefer entering OKLCh values directly if your Figma version supports it; otherwise use the hex approximations in §1.

**Tone:** quietly editorial, not flashy. Press-state translates by a single pixel (`active:translate-y-px`); hover dims by 10%; the standard shadow is a 5%-alpha 1px lift. Restraint over animation.

---

## 9. Quick reference — files to open while building in Figma

| What | File |
|---|---|
| All color, radius, shadow tokens | `src/app/globals.css` |
| Font loading + family choices | `src/app/layout.tsx` |
| Button variants + sizes | `src/components/ui/button.tsx` |
| Custom domain SVG icons | `src/components/icons/domain-icons.tsx` |
| shadcn / Radix base config | `components.json` |
| Component examples (for screenshots) | `src/components/` (62 files) |
