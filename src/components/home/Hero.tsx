export function Hero({ isComplete }: { isComplete: boolean }) {
  if (isComplete) {
    return (
      <header className="space-y-3">
        <h1 className="text-foreground font-serif text-4xl leading-tight font-semibold md:text-5xl">
          you contain multitudes
        </h1>
        <div
          aria-hidden="true"
          className="h-px w-12"
          style={{ backgroundColor: 'var(--cream-accent, currentColor)' }}
        />
        <p
          className="text-muted-foreground text-[13px] italic"
          style={{ fontFamily: 'var(--font-display), Georgia, serif' }}
        >
          What else is around?
        </p>
      </header>
    )
  }

  return (
    <header className="space-y-3">
      <h1 className="text-foreground font-serif text-4xl leading-tight font-semibold md:text-5xl">
        Today&rsquo;s five
        <br />
        is waiting.
      </h1>
      <div
        aria-hidden="true"
        className="h-px w-12"
        style={{ backgroundColor: 'var(--cream-accent, currentColor)' }}
      />
      <p className="text-muted-foreground text-[13px]">
        Five questions from your world. Play, then see what&rsquo;s around.
      </p>
    </header>
  )
}
