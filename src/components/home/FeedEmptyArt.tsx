// Decorative art for the bottom of the homepage feed: the empty-state speech
// bubbles and the sparkle divider that separates the empty state from the
// "write a question" prompt. Hand-built inline SVGs (no asset existed) using the
// brand palette from globals.css, in the stroke-based idiom of
// src/components/icons/domain-icons.tsx. Purely presentational + aria-hidden.

// Flat illustration fills sampled directly from the Figma mock — these are
// bespoke art colors with no token equivalent, kept literal. Hoisted to tagged
// constants so the hex-hygiene audit skips them (B-VISUAL-HEX-TOKENIZE-01).
const ART_BUBBLE_BEIGE = '#eee7d9' // raw hex required: Figma illustration fill
const ART_BUBBLE_NAVY = '#12284a' // raw hex required: Figma illustration fill
const ART_BUBBLE_GRAY = '#e4e4e4' // raw hex required: Figma illustration fill
const ART_SPARKLE_TAN = '#c9b08c' // raw hex required: Figma illustration stroke

export function SpeechBubbleIllustration({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      aria-hidden="true"
      viewBox="0 0 120 96"
      className={className ?? 'h-24 w-auto'}
    >
      {/* Colors are sampled directly from the Figma mock illustration (flat
          fills, no borders) rather than mapped to brand tokens — see the tagged
          ART_* constants above. */}

      {/* large beige bubble with three navy dots */}
      <path
        d="M20 30h52a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H40l-10 11v-11h-10a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z"
        fill={ART_BUBBLE_BEIGE}
      />
      <g fill={ART_BUBBLE_NAVY}>
        <circle cx="34" cy="46" r="3.5" />
        <circle cx="46" cy="46" r="3.5" />
        <circle cx="58" cy="46" r="3.5" />
      </g>

      {/* smaller gray question bubble */}
      <path
        d="M86 50h18a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6h-4l-7 8v-8h-7a6 6 0 0 1-6-6V56a6 6 0 0 1 6-6z"
        fill={ART_BUBBLE_GRAY}
      />
      <text
        x="95"
        y="68"
        textAnchor="middle"
        fontFamily="var(--font-serif), Georgia, serif"
        fontSize="18"
        fontWeight="600"
        fill={ART_BUBBLE_NAVY}
      >
        ?
      </text>

      {/* warm-tan sparkle fan above the question bubble */}
      <g stroke={ART_SPARKLE_TAN} strokeWidth={1.8} strokeLinecap="round" fill="none">
        <path d="M98 30v7" />
        <path d="M89 33l3 6" />
        <path d="M107 33l-3 6" />
        <path d="M83 39l4 4" />
        <path d="M113 39l-4 4" />
      </g>
    </svg>
  )
}

export function SparkleDivider({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`flex items-center justify-center gap-4 ${className ?? ''}`}
    >
      <span className="h-px w-16 bg-[var(--brand-rule)]" />
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
        <path
          d="M12 1c.6 5.2 5.8 10.4 11 11-5.2.6-10.4 5.8-11 11-.6-5.2-5.8-10.4-11-11C6.2 11.4 11.4 6.2 12 1z"
          fill="var(--brand-orange)"
        />
      </svg>
      <span className="h-px w-16 bg-[var(--brand-rule)]" />
    </div>
  )
}
