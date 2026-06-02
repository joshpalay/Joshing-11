// Decorative art for the bottom of the homepage feed: the empty-state speech
// bubbles and the sparkle divider that separates the empty state from the
// "write a question" prompt. Hand-built inline SVGs (no asset existed) using the
// brand palette from globals.css, in the stroke-based idiom of
// src/components/icons/domain-icons.tsx. Purely presentational + aria-hidden.

export function SpeechBubbleIllustration({ className }: { className?: string }) {
  return (
    <svg
      role="img"
      aria-hidden="true"
      viewBox="0 0 120 96"
      className={className ?? 'h-24 w-auto'}
    >
      {/* sparkle strokes above the bubbles */}
      <g
        stroke="var(--brand-orange)"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      >
        <path d="M62 8v9" />
        <path d="M50 13l4 7" />
        <path d="M74 13l-4 7" />
      </g>

      {/* large cream bubble with three navy dots */}
      <path
        d="M20 30h52a8 8 0 0 1 8 8v16a8 8 0 0 1-8 8H40l-10 11v-11h-10a8 8 0 0 1-8-8V38a8 8 0 0 1 8-8z"
        fill="var(--brand-cream)"
        stroke="var(--brand-rule)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <g fill="var(--brand-ink)">
        <circle cx="34" cy="46" r="3.5" />
        <circle cx="46" cy="46" r="3.5" />
        <circle cx="58" cy="46" r="3.5" />
      </g>

      {/* smaller gray question bubble */}
      <path
        d="M86 50h18a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6h-4l-7 8v-8h-7a6 6 0 0 1-6-6V56a6 6 0 0 1 6-6z"
        fill="#e5e3df"
        stroke="var(--brand-rule)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <text
        x="95"
        y="68"
        textAnchor="middle"
        fontFamily="var(--font-serif), Georgia, serif"
        fontSize="18"
        fontWeight="600"
        fill="var(--brand-ink)"
      >
        ?
      </text>
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
