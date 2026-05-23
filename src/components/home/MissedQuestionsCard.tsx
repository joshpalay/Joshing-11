import Link from 'next/link'

export function MissedQuestionsCard({
  count,
  expiringCount,
}: {
  count: number
  expiringCount: number
}) {
  if (count === 0) return null
  return (
    <div
      className="bg-card text-card-foreground rounded-lg border p-4"
      style={
        expiringCount > 0
          ? {
              borderColor: 'color-mix(in srgb, #b45309 32%, var(--border))',
              boxShadow:
                '0 0 0 1px color-mix(in srgb, #b45309 10%, transparent)',
            }
          : undefined
      }
    >
      <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
        Reinforce what you learned
      </p>
      <p className="text-foreground mt-2 text-sm font-semibold">
        {count === 1 ? '1 question to revisit' : `${count} questions to revisit`}
      </p>
      {expiringCount > 0 ? (
        <p
          className="mt-1 text-xs font-medium tracking-[0.08em] uppercase"
          style={{ color: '#b45309' }}
        >
          {expiringCount} expires tomorrow
        </p>
      ) : null}
      <Link
        href="/daily/catchup"
        className="btn-ghost mt-4 min-h-11 w-full justify-center"
      >
        Catch up →
      </Link>
    </div>
  )
}
